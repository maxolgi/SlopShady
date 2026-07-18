use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

pub type SharedState = Map<String, Value>;

pub struct AppState {
    pub data: Arc<RwLock<SharedState>>,
    pub persist_path: std::path::PathBuf,
    pub broadcast_tx: broadcast::Sender<String>,
    pub tuning: crate::live_tuning::TuningState,
    /// Native OSC UDP bridge supervisor. Hot-swappable via the WS handler when
    /// oscPort/oscBind change. Initialized empty; spawned from main().
    pub osc: std::sync::Mutex<crate::osc::OscBridge>,
}

pub fn default_layers(shader_source: &str) -> Vec<Value> {
    let mut layers = Vec::with_capacity(8);
    for i in 0..8 {
        let name = if i == 0 { "Main".to_string() } else { format!("Layer {i}") };
        let opacity = if i == 0 { 1.0 } else { 0.0 };
        let source = if i == 0 { shader_source.to_string() } else { String::new() };
        let voice_mode = "poly";
        layers.push(json!({
            "id": format!("layer_{i}"),
            "name": name,
            "enabled": i == 0,
            "solo": false,
            "opacity": opacity,
            "blendMode": "normal",
            "material": {
                "type": "shader",
                "source": source,
                "params": {}
            },
            "modulationMatrix": [],
            "voiceMode": voice_mode,
            "glideTime": 0.1,
        }));
    }
    layers
}

pub fn normalize_layer(layer: &mut Value, index: usize) {
    let name = if index == 0 { "Main".to_string() } else { format!("Layer {index}") };
    let opacity = if index == 0 { 1.0 } else { 0.0 };
    let voice_mode = "poly";
    let defaults = json!({
        "id": format!("layer_{index}"),
        "name": name,
        "enabled": index == 0,
        "solo": false,
        "opacity": opacity,
        "blendMode": "normal",
        "material": {"type": "shader", "source": "", "params": {}},
        "modulationMatrix": [],
        "voiceMode": voice_mode,
        "glideTime": 0.1,
    });

    if !layer.is_object() {
        *layer = defaults;
        return;
    }

    let mat_default = json!({"type": "shader", "source": "", "params": {}});
    let has_material = layer.get("material").map_or(false, |m| m.is_object());
    if !has_material {
        layer["material"] = mat_default;
    } else {
        let mat = layer.get_mut("material").unwrap();
        if mat.get("type").is_none() {
            mat["type"] = json!("shader");
        }
        if mat.get("source").is_none() {
            mat["source"] = json!("");
        }
        if mat.get("params").is_none() {
            mat["params"] = json!({});
        }
        if mat.get("shaderRef").is_none() {
            mat["shaderRef"] = Value::Null;
        }
    }

    if let Some(defaults_obj) = defaults.as_object() {
        for (key, default_val) in defaults_obj {
            if key == "material" {
                continue;
            }
            let current = layer.get(key);
            if current.is_none() || current == Some(&Value::Null) {
                layer[key] = default_val.clone();
            }
        }
    }
}

pub fn normalize_playlist_entry(entry: &mut Value, index: usize) {
    let defaults = json!({
        "id": format!("pl_{index}"),
        "name": format!("Entry {}", index + 1),
        "shaderCode": "",
        "layerIndex": 0,
        "duration": 30,
        "fadeIn": 2,
        "fadeOut": 2,
        "midiNote": null,
    });

    if !entry.is_object() {
        *entry = defaults;
        return;
    }

    if let Some(defaults_obj) = defaults.as_object() {
        for (key, default_val) in defaults_obj {
            let current = entry.get(key);
            if current.is_none() || current == Some(&Value::Null) {
                entry[key] = default_val.clone();
            }
        }
    }
}

pub fn sanitize_layer_modulation_matrices(value: &mut Value) {
    let mut lmm = match value.take() {
        Value::Array(arr) => arr,
        _ => {
            *value = json!([[], [], [], [], [], [], [], []]);
            return;
        }
    };

    while lmm.len() < 8 {
        lmm.push(json!([]));
    }
    lmm.truncate(8);

    let sanitized: Vec<Value> = lmm
        .into_iter()
        .map(|matrix| {
            let entries = match matrix {
                Value::Array(arr) => arr,
                _ => vec![],
            };
            Value::Array(entries.into_iter().filter(|e| e.is_object()).collect())
        })
        .collect();

    *value = Value::Array(sanitized);
}

pub fn load_state(persist_path: &Path) -> SharedState {
    let mut base = Map::new();
    base.insert("shaderCode".into(), json!(""));
    base.insert("codeDialValues".into(), json!({}));
    base.insert("codeDialOriginals".into(), json!({}));
    base.insert("isPaused".into(), json!(false));
    base.insert("manualTime".into(), json!(0));
    base.insert("modulationRoutes".into(), json!([]));
    base.insert(
        "layerModulationMatrices".into(),
        json!([[], [], [], [], [], [], [], []]),
    );
    base.insert("savedShaders".into(), json!([]));
    base.insert("currentShaderId".into(), Value::Null);
    base.insert("layers".into(), Value::Array(default_layers("")));

    base.insert("oscPort".into(), json!(8101));
    base.insert("oscBind".into(), json!("0.0.0.0"));
    base.insert("oscEnabled".into(), json!(true));

    base.insert(
        "backgroundLayer".into(),
        json!({
            "enabled": true,
            "material": {"type": "solid", "source": "#000000"}
        }),
    );

    base.insert(
        "master".into(),
        json!({
            "feedbackEnabled": false,
            "feedbackAmount": 0.5,
            "feedbackZoom": 1.0,
            "feedbackRotate": 0.0,
        }),
    );

    base.insert(
        "playlist".into(),
        json!({
            "entries": [],
            "isPlaying": false,
            "currentIndex": -1,
            "loop": true,
            "defaultDuration": 30,
            "defaultFadeIn": 2,
            "defaultFadeOut": 2,
        }),
    );

    base.insert(
        "recorder".into(),
        json!({
            "isRecording": false,
            "format": "webm",
            "codec": "vp9",
            "bitrate": 50000000,
            "fps": 60,
            "resolution": "1080p",
        }),
    );

    base.insert(
        "player".into(),
        json!({
            "audioFile": null,
            "midiFile": null,
            "isPlaying": false,
            "currentTime": 0,
            "duration": 0,
            "loop": false,
            "gain": 1.0,
        }),
    );

    base.insert(
        "modulationSources".into(),
        json!({
            "lfos": [
                {"waveform": "sine", "rate": 1.0, "sync": false, "phase": 0},
                {"waveform": "square", "rate": 0.5, "sync": false, "phase": 0},
                {"waveform": "saw", "rate": 2.0, "sync": false, "phase": 0},
                {"waveform": "triangle", "rate": 1.5, "sync": false, "phase": 0},
            ],
            "egs": [
                {"attack": 0.1, "decay": 0.3, "sustain": 0.7, "release": 0.5, "state": "idle", "value": 0},
                {"attack": 0.05, "decay": 0.2, "sustain": 0.5, "release": 0.3, "state": "idle", "value": 0},
            ],
            "audioMods": [
                {"mode": "gate", "threshold": 0.3, "attack": 0.01, "release": 0.1},
                {"mode": "spectrum", "band": "low", "threshold": 0.2},
                {"mode": "spectrum", "band": "mid", "threshold": 0.2},
                {"mode": "spectrum", "band": "high", "threshold": 0.2},
            ],
        }),
    );

    let mut scanimate_oscillators = vec![json!({
        "enabled": true,
        "freqMult": 0.3,
        "phaseOffset": 0.0,
        "lockMode": 0,
        "lockTarget": 0,
        "amplitude": 0.15,
    })];
    for _ in 0..7 {
        scanimate_oscillators.push(json!({
            "enabled": false,
            "freqMult": 1.0,
            "phaseOffset": 0.0,
            "lockMode": 0,
            "lockTarget": 0,
            "amplitude": 0.1,
        }));
    }

    base.insert(
        "scanimate".into(),
        json!({
            "enabled": false,
            "source": "",
            "fit": "cover",
            "speed": 1.0,
            "oscillators": scanimate_oscillators,
            "deflection": {
                "waveXDepth": 0.04,
                "waveYDepth": 0.03,
                "rotation": 0.0,
                "barrelAmount": 0.0,
                "segmentCount": 1,
                "segmentThresholds": [0.0, 0.25, 0.5, 0.75],
                "segmentDepthMultipliers": [1.0, 1.0, 1.0, 1.0, 1.0],
                "domainWarpIterations": 3,
            },
            "animation": {
                "enabled": false,
                "rateA": 1.0,
                "rateB": 1.0,
                "duration": 5.0,
                "loop": false,
                "initialState": null,
                "finalState": null,
                "_progress": 0,
            },
            "colorizer": {
                "enabled": true,
                "colorA": "#00ccff",
                "colorB": "#ff33aa",
                "colorC": "#ffee33",
                "colorCycleSpeed": 1.0,
                "brightnessBoost": 0.9,
            },
            "crt": {
                "scanlinesEnabled": true,
                "scanlineIntensity": 0.08,
                "glowEnabled": true,
                "glowAmount": 0.3,
                "chromaticEnabled": false,
                "chromaticAmount": 0.008,
                "vignetteEnabled": true,
                "vignetteAmount": 0.6,
            },
            "feedback": {
                "enabled": false,
                "amount": 0.5,
                "decay": 0.9,
            },
            "patchMatrix": [],
        }),
    );

    if persist_path.exists() {
        if let Ok(content) = fs::read_to_string(persist_path) {
            if let Ok(saved) = serde_json::from_str::<Value>(&content) {
                match saved {
                    Value::Object(saved_map) => {
                        for (k, v) in saved_map {
                            base.insert(k, v);
                        }

                        if !base.contains_key("layers") {
                            base.insert(
                                "layers".into(),
                                Value::Array(default_layers(
                                    base.get("shaderCode")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or(""),
                                )),
                            );
                        } else {
                            let layers = base.get_mut("layers").unwrap();
                            if let Some(layers_arr) = layers.as_array_mut() {
                                for i in 0..std::cmp::min(layers_arr.len(), 8) {
                                    normalize_layer(&mut layers_arr[i], i);
                                }
                            }
                        }

                        if let Some(playlist) = base.get_mut("playlist") {
                            if playlist.is_object() {
                                if let Some(entries) =
                                    playlist.get_mut("entries").and_then(|e| e.as_array_mut())
                                {
                                    for (i, entry) in entries.iter_mut().enumerate() {
                                        normalize_playlist_entry(entry, i);
                                    }
                                }
                                let pl = playlist.as_object_mut().unwrap();
                                pl.entry(String::from("isPlaying"))
                                    .or_insert_with(|| json!(false));
                                pl.entry(String::from("currentIndex"))
                                    .or_insert_with(|| json!(-1));
                                pl.entry(String::from("loop"))
                                    .or_insert_with(|| json!(true));
                                pl.entry(String::from("defaultDuration"))
                                    .or_insert_with(|| json!(30));
                                pl.entry(String::from("defaultFadeIn"))
                                    .or_insert_with(|| json!(2));
                                pl.entry(String::from("defaultFadeOut"))
                                    .or_insert_with(|| json!(2));
                            }
                        }

                        if let Some(lmm) = base.get_mut("layerModulationMatrices") {
                            sanitize_layer_modulation_matrices(lmm);
                        }
                    }
                    Value::Array(saved_arr) => {
                        base.insert("savedShaders".into(), Value::Array(saved_arr));
                    }
                    _ => {}
                }
            }
        }
    }

    base
}

pub async fn persist_state(state: &SharedState, path: &Path) {
    match serde_json::to_string_pretty(state) {
        Ok(json_str) => {
            if let Err(e) = tokio::fs::write(path, json_str).await {
                tracing::error!("Failed to persist state: {}", e);
            }
        }
        Err(e) => {
            tracing::error!("Failed to serialize state: {}", e);
        }
    }
}
