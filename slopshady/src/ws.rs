use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde_json::{json, Map, Value};
use std::sync::Arc;

use crate::state::AppState;

static ALLOWED_KEYS: &[&str] = &[
    "shaderCode",
    "codeDialValues",
    "codeDialOriginals",
    "isPaused",
    "manualTime",
    "modulationRoutes",
    "layerModulationMatrices",
    "savedShaders",
    "currentShaderId",
    "layers",
    "backgroundLayer",
    "master",
    "playlist",
    "recorder",
    "modulationSources",
    "player",
    "scanimate",
    "oscPort",
    "oscBind",
    "oscEnabled",
];

static PERSIST_KEYS: &[&str] = &[
    "modulationRoutes",
    "layerModulationMatrices",
    "isPaused",
    "layers",
    "master",
    "backgroundLayer",
    "playlist",
    "recorder",
    "modulationSources",
    "player",
    "scanimate",
    "oscPort",
    "oscBind",
    "oscEnabled",
];

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();

    let init_data = {
        let data = state.data.read().await;
        json!({"type": "init", "data": data.clone()})
    };
    if sender
        .send(Message::Text(init_data.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    let mut broadcast_rx = state.broadcast_tx.subscribe();

    let state_for_write = state.clone();

    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            let text = match msg {
                Message::Text(t) => t,
                _ => continue,
            };

            let text_str = text.to_string();

            let parsed: Value = match serde_json::from_str(&text_str) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if parsed.get("type").and_then(|v| v.as_str()) != Some("update") {
                continue;
            }

            let incoming_data = match parsed.get("data").and_then(|v| v.as_object()) {
                Some(obj) => obj,
                None => continue,
            };

            let mut should_persist = false;
            let mut persist_always = false;
            let mut has_shader_code = false;
            let mut osc_changed = false;
            let mut sanitized_data: Map<String, Value> = Map::new();

            {
                let mut shared = state_for_write.data.write().await;

                for (key, mut value) in incoming_data.clone().into_iter() {
                    if !ALLOWED_KEYS.contains(&key.as_str()) {
                        continue;
                    }

                    if key == "layerModulationMatrices" {
                        crate::state::sanitize_layer_modulation_matrices(&mut value);
                    }

                    shared.insert(key.clone(), value.clone());
                    sanitized_data.insert(key.clone(), value);

                    if key == "savedShaders" {
                        persist_always = true;
                    } else if key == "shaderCode" {
                        has_shader_code = true;
                    }

                    if key == "oscPort" || key == "oscBind" {
                        osc_changed = true;
                    }

                    if PERSIST_KEYS.contains(&key.as_str()) {
                        should_persist = true;
                    }
                }

                if has_shader_code {
                    let shader_code_val = shared.get("shaderCode").cloned();
                    if let Some(layers) =
                        shared.get_mut("layers").and_then(|v| v.as_array_mut())
                    {
                        if let Some(layer0) = layers.first_mut() {
                            if let Some(mat) = layer0.get_mut("material") {
                                if mat.is_object() {
                                    if let Some(Value::String(code)) = shader_code_val {
                                        mat["source"] = json!(code);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if persist_always || has_shader_code || should_persist {
                let shared = state_for_write.data.read().await;
                crate::state::persist_state(&shared, &state_for_write.persist_path).await;
            }

            let broadcast_msg = json!({"type": "update", "data": sanitized_data}).to_string();
            let _ = state_for_write.broadcast_tx.send(broadcast_msg);

            // Hot-swap the OSC UDP bridge when oscPort/oscBind change.
            // Runs on a blocking thread because restart joins the old listener
            // (it exits within ~100ms via the socket read timeout) to release
            // the port before the new listener binds.
            if osc_changed {
                let (bind, port) = {
                    let shared = state_for_write.data.read().await;
                    let port = shared
                        .get("oscPort")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(8101) as u16;
                    let bind = shared
                        .get("oscBind")
                        .and_then(|v| v.as_str())
                        .unwrap_or("0.0.0.0")
                        .to_string();
                    (bind, port)
                };
                let osc_state = state_for_write.clone();
                tokio::task::spawn_blocking(move || {
                    let mut osc = osc_state.osc.lock().unwrap();
                    osc.restart(osc_state.clone(), bind, port);
                });
            }
        }
    });

    let send_task = tokio::spawn(async move {
        while let Ok(msg) = broadcast_rx.recv().await {
            if sender
                .send(Message::Text(msg.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    tokio::select! {
        _ = recv_task => {},
        _ = send_task => {},
    }
}
