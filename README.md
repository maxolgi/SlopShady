# SlopShady - GLSL Shader Editor with AI Integration

A real-time WebGL2 GLSL shader editor featuring AI-powered shader generation via LM Studio, modulation routing with audio/MIDI/LFO inputs, live tuning with visual feedback, and comprehensive keyboard/mouse controls.

## Table of Contents

- [Features](#features)
- [Getting Started](#getting-started)
- [Architecture](#architecture)
- [Capture & Export](#capture--export)
- [Live Stream (WebSRT)](#live-stream-websrt)
- [Live Tuning](#live-tuning)
- [Content Browser](#content-browser)
- [Scanimate Engine](#scanimate-engine)
- [VisualBrain Engine](#visualbrain-engine)
- [Playlist System](#playlist-system)
- [Color Correction](#color-correction)
- [Webamp & Milkdrop](#webamp--milkdrop)
- [Node Graph](#node-graph)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Mouse Controls](#mouse-controls)
- [Save/Load System](#saveload-system)
- [Shader Uniforms](#shader-uniforms)
- [Modulation System](#modulation-system)
- [Technical Notes](#technical-notes)
- [Browser Requirements](#browser-requirements)
- [License](#license)

---

## Features

- **Real-time Shader Editing**: Write and preview GLSL fragment shaders instantly
- **Multi-Layer Compositing**: 8 independent layers with blend modes (normal, add, multiply, screen, overlay, etc.), per-layer opacity, positioning, scaling, rotation, and masking
- **Voice System**: Polyphonic voice rendering with MIDI note triggering, per-voice position/scale/rotation transforms, and envelope generator support
- **Code Dials**: Extract numeric literals from shaders for real-time adjustment without recompilation
- **Modulation Routing**: Route audio, MIDI, LFOs, envelope generators, macros, and keyboard input to shader parameters and layer controls
- **AI Shader Generation**: Generate shaders using local LLMs via LM Studio or compatible APIs
- **Live Tuning**: Iterative shader refinement with AI using screenshot feedback
- **Video Texture**: Use webcam as a texture input for shaders
- **Audio Reactivity**: Audio analysis (volume, frequency bands) for shader modulation with waveform/spectrum visualizers
- **MIDI Support**: Connect MIDI controllers for hardware-driven modulation, plus MIDI file playback
- **Shader Library**: Save, load, and manage shaders with no storage limit
- **Screenshot Capture**: Export shader output as PNG or WebP with configurable resolution and quality
- **Video Recording**: Record shader output as WebM video with configurable codec, bitrate, and resolution
- **Live Stream**: Publish the canvas + Webamp audio over WebSRT (WebTransport + SRT) with H.264 / HEVC / AV1 + Opus, adaptive or constant bitrate
- **Playlist**: Automated shader sequencing with configurable duration, crossfade, MIDI triggering, and loop mode
- **Feedback Effect**: Global and per-layer frame feedback with configurable zoom, rotation, blend mode, saturation, and decay
- **Sync**: Beat-synced LFOs with configurable BPM
- **Scanimate Engine**: 4-pass pipeline (Deflect → Colorize → Feedback → CRT) with 8 oscillators, patch bay modulation, keyframe animation, and domain warping
- **VisualBrain Engine**: GPU-accelerated concatenative visual synthesis with block-matching corpus, glitch effects, and audio reactivity
- **Content Browser**: Browse and load 80 built-in factory shaders (plasma, voronoi, tunnels, fractals, etc.)
- **Color Correction**: Lift/gamma/gain controls, RGB/HSL/Lum curves, waveform/vectorscope/histogram scopes, and .cube LUT support
- **Webamp Integration**: Built-in Winamp clone (Webamp) with Milkdrop visualizer presets (via Butterchurn)
- **Node Graph**: Visual node-based compositing editor (via LiteGraph) for connecting sources, shaders, LFOs, audio, and MIDI
- **Screen Capture**: Use desktop/window/tab capture as a shader texture input (`iScreen` uniform)
- **On-Screen Keyboard**: Trigger voices with the built-in keyboard, octave up/down controls

---

## Capture & Export

Capture the current shader output as an image for AI analysis or export.

### Capture Settings

| Setting | Options | Description |
|----------|----------|-------------|
| **Resolution** | Full (1x), Half (0.5x), Quarter (0.25x) | Scale factor for output dimensions |
| **Format** | PNG (lossless), WebP (compressed) | Image format and compression |
| **Quality** | 10-100% | WebP compression quality (ignored for PNG) |

### When Captures Are Used

1. **Send with Image**: Automatically captures current frame for AI analysis
2. **Live Tuning**: AI captures screenshots via `get_screenshot()` tool
3. **Manual capture**: Not directly exposed (use browser screenshot tools)

### Capture Details

- **PNG**: Lossless, larger file size, best for prints
- **WebP**: Lossy compression, smaller file size, best for sharing/web
- **Quality 80%**: Good balance between size and quality
- **WebP 100%**: Near-PNG quality with compression
- **WebP 10%**: Maximum compression, visible artifacts

Screenshots are encoded as base64 data URLs for transmission to the LLM API.

---

## Live Stream (WebSRT)

Publish the canvas and Webamp audio to a WebSRT gateway for browser viewing. The pipeline runs almost entirely off the main thread:

```
canvas → VideoFrame (WebCodecs, main thread, 1 GPU copy + postMessage/frame)
       → module worker: VideoEncoder → TS muxer (ts-muxer-wasm) → SRT sender (srt-wasm)
                                                                → WebTransport datagrams
Webamp analyser → AudioWorklet → worker: Opus AudioEncoder → TS muxer → SRT → WebTransport
```

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| **Gateway URL** | `https://127.0.0.1:4433/wt` | WebTransport URL of your WebSRT gateway |
| **Stream name** | `slopshady` | Viewers connect with `?stream=<name>` |
| **Codec** | AV1 (auto-detected) | H.264 / HEVC / AV1; codecs are probed on load and filtered to what the local muxer + viewer can carry |
| **Bitrate** | 8 Mbps | Target video bitrate (live-adjustable when ABR is off) |
| **FPS** | 60 | Capture rate |
| **Latency** | 300 ms | SRT latency buffer |
| **Keyframe** | 2000 ms | Keyframe interval |
| **Constant Bitrate (CBR)** | On | Steady bitrate — reduces packet bursts in complex scenes (recommended) |
| **Adaptive Bitrate (ABR)** | Off | Auto-reduce target when the SRT sender queue grows (experimental — tune constants in `streaming.js`) |

### Architecture notes

- Audio is Opus-only (AAC is listed but disabled). The Webamp analyser tap ships 20 ms Float32 frames straight to the worker via a transferred `MessagePort`.
- A flow-control credit scheme bounds in-flight frames between the main thread and the worker so complex scenes cannot accumulate an unbounded backlog (which would arrive at the muxer as a stale-PTS burst).
- The gateway cert hash is fetched via the local `/api/stream/cert-hash` proxy so the browser pins it for WebTransport without a separate trust flow.
- Streaming state is frontend-local (localStorage) — it is **not** synced over `Sync.send()` and does not appear in `shaders.json`.

### Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Insert` | Start/Stop live stream |

---

## Getting Started

Single binary, no Python or Node dependencies. Frontend assets are embedded into the binary at compile time.

1. Install [Rust](https://rustup.rs/)

2. Clone and build:
   ```bash
   git clone https://github.com/YOUR_USER/SlopShadyRust.git
   cd SlopShadyRust/slopshady
   cargo run
   ```

3. The server starts on **https://localhost:8100**. The default build (`webview` feature) opens a native desktop window; the `--no-default-features` build opens your system browser instead (pass `--no-browser` to skip auto-opening).

Options:
```bash
cargo run -- --port 8200          # custom port
cargo run -- --data-dir /path     # custom data directory (shaders.json, certs)
cargo run -- --no-browser         # server-only build: don't auto-open
cargo run -- --osc-port 9000      # custom OSC UDP port (default 8101)
cargo run -- --osc-bind 127.0.0.1 # OSC bind address (default 0.0.0.0)
cargo build --release             # optimized binary (~8-12 MB)
```

> Linux `webview` builds require GTK development libraries (`libgtk-3-dev`). To build a pure HTTPS server with no native window, use `cargo run --no-default-features`.

### Next Steps

Configure LM Studio URL in Settings (default: `http://localhost:1234/v1/`). The backend proxies `/chat/completions` and `/models` from there.

### Status Messages

The status bar (bottom of Reply panel) displays:
- **✅ Success**: Shader compiled, saved, or loaded
- **❌ Errors**: Compilation errors, API failures
- **⏹ Cancelled**: User cancelled a request
- **💭 Processing**: AI thinking, generating response
- **🔄 Progress**: Live tuning iterations, loading models

Status messages auto-clear after 3 seconds (except errors).

### Console Logging

Open browser dev console (F12) to see detailed debug output:
- **Green**: Shader saves, successful operations
- **Cyan**: UI toggles, mode changes
- **Blue**: Modulation, video, system status
- **Yellow**: Warnings (e.g., shader list trimmed)

---

## Architecture

SlopShady consists of two components:

| Component | Location | Technology | Responsibility |
|-----------|----------|------------|----------------|
| **Frontend** | `static/slopshady.html` + `static/js/` | Vanilla JS, ES6 modules | WebGL2 rendering, multi-layer compositing, UI, audio/MIDI, modulation, keyboard shortcuts, canvas capture |
| **Backend (Rust)** | `slopshady/` | Rust, axum, tokio | LLM API proxy, WebSocket state sync, state persistence, live tuning orchestration, self-signed HTTPS |

### Why a Server?

- **Browser CORS restriction**: Browsers cannot directly call arbitrary HTTP endpoints from JavaScript. The server proxies all LLM API calls.
- **Live Tuning orchestration**: The server runs the iterative AI tuning loop, enabling longer-running sessions without browser timeout.
- **State synchronization**: All connected clients share state via WebSocket (`/ws`). State is persisted server-side to `shaders.json`.

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /` | GET | Serves the main HTML frontend |
| `WS /ws` | WebSocket | Real-time state sync between all clients |
| `POST /api/chat/completions` | POST | Proxies streaming chat to LLM API |
| `POST /api/models` | POST | Proxies model list request to LLM API |
| `POST /api/live-tuning/start` | POST | Starts server-side tuning SSE stream |
| `POST /api/live-tuning/screenshot` | POST | Receives canvas screenshots during tuning |
| `POST /api/live-tuning/shader-result` | POST | Receives shader compilation results during tuning |
| `POST /api/live-tuning/stop` | POST | Aborts active tuning session |
| `GET /api/shaders/download` | GET | Downloads the `shaders.json` file |
| `GET /api/screen-capture` | GET | Returns a base64 PNG of the primary monitor (webview build only) |
| `GET /api/stream/cert-hash?url=<gateway>` | GET | Proxies the WebSRT gateway's `cert-hash.js` so the browser can pin it for WebTransport (same-origin; avoids CORS + self-signed trust prompts) |

---

## Live Tuning

Iterative shader refinement using AI with screenshot feedback.

### How It Works

1. Enter a tuning goal (e.g., "Make the colors more vibrant")
2. Click **Start** to begin the tuning session
3. The AI:
    - Receives a screenshot of current shader state
    - Analyzes the visual and generates modifications
    - Loads new shader code
    - Repeats until satisfied or max iterations reached
4. Click **Stop** to end early, or the session ends when max iterations are reached

### AI Tools Available During Tuning

| Tool | Description |
|------|-------------|
| `load_shader` | Load complete modified shader code |
| `get_screenshot` | Capture current shader state for analysis |

### Live Tuning Log

The tuning session displays a log of all actions:
- **Info messages** (gray): Session start, iterations, goals
- **Tool calls** (cyan): When AI executes a tool
- **Results** (green): Tool execution outcomes
- **Errors** (red): Failures or compilation errors
- **Finish** (yellow): Session completion with summary

Each entry includes a timestamp for tracking progress.

### Live Tuning Process

```
1. User provides goal → Initial screenshot captured in browser
2. Server sends screenshot + goal to LLM
3. LLM responds with tool calls (load_shader, get_screenshot)
4. Server executes tool calls:
   - `load_shader`: Server sends shader code → Browser receives SSE event → Shader compiled
   - `get_screenshot`: Server requests screenshot → Browser captures and POSTs to server
5. Loop repeats until max iterations reached or user stops the session
```

The process runs automatically with minimal user intervention.

---

## Content Browser

Browse and load from a library of 80 built-in factory shaders. Factory shaders are stored in `static/content/shaders/factory/` and cataloged in `static/content/manifest.json`.

### Shader Categories

| Category | Examples |
|----------|---------|
| **Classic** | Plasma Waves, Mandelbrot, Starfield, Lava Lamp, Fractal Noise |
| **Geometric** | Voronoi Cells, Hex Tiles, Grid Pulse, Kaleidoscope, Mosaic |
| **Organic** | Cloud Drift, Fire Ball, Bioluminescent Deep Sea, Bioluminescent Fluid Cells |
| **Water** | Ripple Pond, Ocean Waves, Ethereal Underwater Flow |
| **Effects** | Tunnel, Neon Rings, Rainbow Swirl, Chromatic Aberration, Aurora, Lightning |
| **Cyberpunk** | Cyberpunk Glitch, Cyberpunk Neon Grid, Cyberpunk Retro Sun Grid, Cyberpunk Neural Net, Cyberpunk Data Stream |
| **Synthwave** | Synthwave Gridscape, Synthwave Gridscape Max, Synthwave Gridscape Ultimate, Retrowave Horizon |
| **Flow** | Obsidian Flow (multiple variants), Liquid Metal Flow, Liquid Gold Flow, Liquid Neon Fluid, Liquid Chrome Kaleidoscope |
| **Cosmic** | Cosmic Nebula, Cosmic Nebula Flow, Cosmic Nebula Starfield, Nebula Swirl, Nebula Dream |
| **Audio-Reactive** | Audio Pulse, Audio Bars, Audio Ring, Voice Wave, Voice Blobs, MIDI Chromatic, MIDI Keys, Mod Playground |

---

## Scanimate Engine

A retro-style video synthesis engine inspired by the Scanimate analog video synthesizer. Runs as a 4-pass WebGL pipeline:

1. **Deflect**: Oscillator-driven wave deformation (horizontal/vertical distortion, barrel, domain warp)
2. **Colorize**: Dual-color cycling with brightness boost
3. **Feedback**: Frame-to-frame accumulation with decay
4. **CRT**: Post-processing with scanlines, glow, chromatic aberration, and vignette

### Oscillators

8 oscillators with configurable frequency multiplier (0.1–20), phase offset (0–1), amplitude (0–1), and lock mode:

| Lock Mode | Description |
|-----------|-------------|
| **Free** | Independent frequency, no sync |
| **V-Lock** | Phase-locked to vertical sync rate (59.94 Hz) |
| **H-Lock** | Phase-locked to horizontal sync rate (15734 Hz) |
| **Slave** | Follows the phase of another oscillator (configurable target) |

### Patch Bay

Route modulation sources (LFOs, audio, MIDI, macros, raw oscillator output) to any Scanimate parameter: deflection, rotation, barrel, segment shift, color cycle, brightness, scanline intensity, glow, chromatic aberration, vignette, feedback amount, or individual oscillator frequency/amplitude.

### Segment Thresholds

Divide the screen into independent zones with configurable threshold positions and depth multipliers for per-segment wave deformation.

### Animation System

Keyframe between initial and final states:
- Capture any state as **initial** or **final** (Ctrl+click to clear)
- Configurable duration, rate curves (rate A for progress speed, rate B for easing)
- Loop mode for continuous playback
- Manual progress scrub slider

### Source Input

Use any image URL, file upload, or the active shader as the Scanimate input.

---

## VisualBrain Engine

A GPU-accelerated concatenative visual synthesis engine inspired by SampleBrain. Analyzes the current frame in blocks, matches them against a learned corpus, and reassembles the output from corpus blocks.

### 3-Pass Pipeline

1. **Feature Extraction** (MRT): Extracts color and edge features per block from the input texture
2. **Block Matching**: Finds the closest corpus block for each grid cell using color and edge similarity
3. **Render**: Composites the matched blocks from the atlas, blended with the original input

### Controls

| Control | Description |
|---------|-------------|
| **Block Size** | 8px, 16px, or 32px — smaller = finer matching, larger = bolder |
| **Blend** | Mix between original layer output and corpus-matched output (0–100%) |
| **Glitch** | Chromatic aberration and displacement on poor matches (0–100%) |
| **Color Weight** | Prioritize color similarity over edge similarity in matching |
| **Grid Overlay** | Toggle block grid overlay on output |
| **Scanline** | Toggle CRT scanline sweep effect |
| **Audio Reactive** | Enable microphone input to modulate matching with audio drive |

### Corpus Management

- **Seed**: Generate 600 synthetic blocks (gradients, noise, patterns) for the corpus
- **Record**: Capture blocks from active Brain layers into the corpus (every 8th frame, max 4096 blocks)
- **Clear**: Reset the entire corpus

---

## Playlist System

Automated shader sequencing with configurable duration, transitions, and MIDI triggering.

### Features

- **Entries**: Each entry stores a shader, target layer, duration, fade-in time, and fade-out time
- **Crossfade**: Smooth opacity transitions between entries using `requestAnimationFrame`
- **Loop Mode**: Continuous playback or single pass
- **MIDI Triggering**: Assign a MIDI note (0–127) to any entry for instant jumping
- **Progress Tracking**: Real-time progress bar with elapsed/duration display

### Controls

| Control | Shortcut | Description |
|---------|----------|-------------|
| **Play** | `Ctrl+Shift+Space` | Start or resume playlist playback |
| **Stop** | — | Stop playback |
| **Previous/Next** | — | Skip to adjacent entry |
| **Add Current** | — | Add current shader to playlist |
| **Add from Shader** | — | Add a saved shader to playlist |
| **Export/Import** | — | Save/load playlist as JSON |
| **Clear** | — | Remove all entries |

---

## Color Correction

A comprehensive color grading panel with professional tools:

### Primary Controls

- **Lift / Gamma / Gain knobs**: Shadows, midtones, and highlights adjustment
- **Radius / Angle knobs**: For targeted color correction

### Curves

- **Master luminance curve**: Overall brightness/contrast
- **RGB channel curves**: Individual red, green, blue adjustment
- **HSL curves**: Hue, saturation, lightness adjustment
- **Luminance-only curve**: Brightness without color shift

### Scopes

- **Waveform monitor**: Brightness distribution across the frame
- **Vectorscope**: Color/chroma distribution
- **Histogram**: Tonal range distribution
- **RGB Parade**: Per-channel levels

### LUT Support

- **LUT dropdown**: Select from built-in look-up tables
- **Load .cube**: Import custom .cube LUT files
- **Save LUT**: Export current color correction as a .cube file

---

## Webamp & Milkdrop

Built-in [Webamp](https://webamp.org/) (Winamp in the browser) for audio playback with Milkdrop music visualization.

- **Webamp**: Full Winamp-like audio player supporting `.mp3`, `.wav`, `.ogg`, and other browser-supported formats
- **Milkdrop**: Real-time music visualization using [Butterchurn](https://github.com/niclas-niclas/butterchurn) (Milkdrop preset renderer for WebGL)
- Audio output from Webamp feeds into the modulation system (audio peak, frequency bands)
- Webamp is contained within the UI panel for seamless integration

---

## Node Graph

A visual node-based compositing editor powered by [LiteGraph.js](https://github.com/jagenjo/litegraph.js).

### Node Types

| Node | Inputs | Outputs | Description |
|------|--------|---------|-------------|
| **Source** | — | texture | Generates a solid color, image, video, or texture |
| **Shader** | texture | texture, params | Applies GLSL shader processing; double-click to view source |
| **LFO** | — | value | Low-frequency oscillator modulation source |
| **Audio** | — | level | Audio analysis output (peak, bands) |
| **MIDI** | — | note, velocity | MIDI input (note, velocity, CC) |
| **Visualizer** | audio | texture | Audio-reactive visualization (waveform, spectrum, circular, oscilloscope) |
| **Composite** | base + 8× layer | result | Composite 8 layers with selectable blend mode |
| **Feedback** | current, previous | result | Frame feedback with configurable delay |
| **Output** | texture | — | Final render output |

Nodes can be connected by dragging from outputs to inputs to build visual processing graphs.

---

## Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save full state to JSON file |
| `Ctrl+Shift+S` | Save shaders list only to JSON file |
| `Ctrl+Insert` | Start/Stop live stream |
| `Ctrl+F` | Toggle fullscreen mode |
| `Ctrl+M` | (reserved) |
| `Ctrl+Shift+R` | Start/Stop video recording |
| `Ctrl+Shift+Space` | Start/Stop playlist playback |
| `Ctrl+Shift+L` | Open modulation matrix panel |
| `Ctrl+Shift+Backspace` | Master reset: clear ALL settings and state |
| `Tab` | Toggle bottom panel visibility |
| `Space` | Pause/Play shader animation |
| `Backspace` | Reset ALL code dials to defaults |

### Layer Selection

| Shortcut | Action |
|----------|--------|
| `1`–`8` | Select layer 1–8 |
| `Ctrl+1`–`Ctrl+8` | Select layer 1–8 |
| `Shift+1`–`Shift+8` | Toggle layer 1–8 enabled/disabled |
| `Insert` | Crossfade all layers to selected layer |
| `Delete` | Switch back to previous layer |

### Shader Navigation

| Shortcut | Action |
|----------|--------|
| `+` / `=` | Load next shader (saved + factory combined list) |
| `-` / `_` | Load previous shader |
| `Shift+Delete` | Delete current shader, load next |
| `` ` `` / `~` | Toggle global frame feedback |

### Code Dials

| Shortcut | Action |
|----------|--------|
| Letter key (hold) | Momentary 2× multiplier |
| `Shift+Letter` | Permanently double value |
| `Alt+Letter` | Permanently halve value |
| `Alt+Shift+Letter` | Reset to original value |

---

## Mouse Controls

| Action | Result |
|--------|--------|
| Single-click canvas | Toggle bottom panel visibility |
| Double-click canvas | Toggle fullscreen mode |
| Click code dial | Open floating dial for fine control |
| Drag floating dial | Rotate to adjust value exponentially |
| Scroll on floating dial | Fine adjustment of value |
| Click value display (floating dial) | Open text input for direct entry |
| Drag panel resize handle | Resize bottom panel height vertically |
| Double-click resize handle | Minimize panel to minimum height |
| Click modulation route bar (disabled) | Set frozen value at click position |
| Drag modulation handle (disabled) | Fine-tune frozen value |
| Click shader in Shaders list | Load that shader |
| Shift+Click shader in Shaders list | Delete that shader |
| Click Load button on code block | Replace current shader with loaded code |

---

## Save/Load System

### Auto-Save

State is automatically synced to the server via WebSocket and persisted to `shaders.json`. Changes to shaders, modulation routes, layer settings, playlist, and other shared state are saved immediately on mutation.

### Manual Save

- **Ctrl+S**: Exports full state JSON (shaders, settings, conversation, modulation routes)
- **Ctrl+Shift+S**: Exports shaders-only JSON for sharing
- **Save to JSON button** (Settings): Manual export from Settings panel

### Load via Drag & Drop

1. Drag any `.json` save file onto the window
2. Shaders-only files append to existing list (duplicates skipped)
3. Full save files replace everything

### Reset Settings

The **Reset Settings** button in the Settings panel:
- Clears all saved data from localStorage
- Requires confirmation dialog
- Automatically reloads the page
- Restores all settings to defaults

**Warning**: This will delete:
- All saved shaders
- API configuration
- Conversation history
- Modulation routes
- Custom settings

### JSON Structure (Full Save)

> **Security warning:** The full save JSON exports your Bearer token (`bearerKey`) in plaintext. Do not share full save files publicly if they contain authentication credentials.

```json
{
  "shaderCode": "...",
  "apiUrl": "...",
  "modelNameImage": "...",
  "modelNameText": "...",
  "captureResolution": "...",
  "captureFormat": "...",
  "captureQuality": 80,
  "liveTuningMaxIterations": "...",
  "bearerKey": "...",
  "codeDialOriginals": {...},
  "chatMode": false,
  "conversationHistory": [...],
  "modulationRoutes": [...],
  "layerModulationMatrices": [[...], [...], ...],
  "savedShaders": [...],
  "lfos": [{"rate": 1, "waveform": "sine", "phaseOffset": 0}, ...],
  "timestamp": "..."
}
```

### JSON Structure (Shaders Only)

```json
{
  "type": "shaders-only",
  "savedShaders": [...],
  "count": 10,
  "timestamp": "..."
}
```

---

## Shader Uniforms

### Available Uniforms

| Uniform | Type | Description |
|---------|------|-------------|
| `iTime` | float | Elapsed time in seconds |
| `iResolution` | vec3 | Canvas width, height, 1.0 |
| `fragColor` | vec4 | Output color (auto-declared as `out vec4 fragColor`) |
| `gl_FragCoord` | vec4 | Built-in pixel coordinates (GLSL ES 3.0) |
| `iVideo` | sampler2D | Camera/webcam texture (when Camera is enabled) |
| `iScreen` | sampler2D | Screen capture texture (when Screen is enabled) |
| `u_audioWaveform` | sampler2D | 256-sample time-domain audio waveform (LUMINANCE) |
| `u_audioSpectrum` | sampler2D | 128-bin frequency-domain audio spectrum (LUMINANCE) |

### Layer Parameter Uniforms

These are always injected and can be modulated via the modulation matrix:

| Uniform | Default | Description |
|---------|---------|-------------|
| `u_brightness` | 1.0 | Brightness multiplier |
| `u_speed` | 1.0 | Time speed multiplier |
| `u_posX` | 0.0 | Horizontal position offset |
| `u_posY` | 0.0 | Vertical position offset |
| `u_scale` | 1.0 | Scale factor |
| `u_radius` | 0.5 | Mask radius |
| `u_amount` | 1.0 | General intensity/amount |
| `u_rotation` | 0.0 | Rotation angle (radians) |
| `u_stretch` | 0.0 | Stretch factor |
| `u_maskPosX` | 0.0 | Mask center X |
| `u_maskPosY` | 0.0 | Mask center Y |
| `u_maskSoftness` | 0.01 | Mask feather/softness |

### Voice System Uniforms

Each layer supports up to 4 polyphonic voices (MIDI or on-screen keyboard). When voice mode is active:

| Uniform | Type | Description |
|---------|------|-------------|
| `u_voiceActive[4]` | float | 1.0 if voice is active, 0.0 otherwise |
| `u_voiceNote[4]` | float | MIDI note number (0-127) |
| `u_voiceVelocity[4]` | float | Velocity normalized 0-1 |
| `u_voicePosX[4]` | float | Per-voice X offset |
| `u_voicePosY[4]` | float | Per-voice Y offset |
| `u_voiceScale[4]` | float | Per-voice scale |
| `u_voiceRotation[4]` | float | Per-voice rotation |
| `u_voiceEG[4]` | float | Per-voice envelope generator value (0-1) |
| `u_pitchBend` | float | Global pitch bend |
| `u_channelPressure` | float | Global aftertouch / channel pressure |
| `u_kbdNote` | float | Latest active note |
| `u_eg0`..`u_eg3` | float | Per-layer envelope generator values |

The engine renders `main()` once per active voice with transformed UVs and accumulates results weighted by `u_voiceVelocity[i] * u_voiceEG[i]`.

Example voice-reactive pattern:
```glsl
float voiceSum = 0.0;
for (int i = 0; i < 4; i++) {
    if (u_voiceActive[i] > 0.5) {
        float note = u_voiceNote[i] / 127.0;
        voiceSum += note * u_voiceVelocity[i] * u_voiceEG[i];
    }
}
col *= voiceSum;
```

### Code Dials (Auto-Generated Parameter Uniforms)

When numeric literals are extracted from shader code, they are replaced with uniforms:
```glsl
uniform float u_param_cd0;  // First extracted number
uniform float u_param_cd1;  // Second extracted number
// ... up to u_param_cd25 (26 max)
```

These uniforms are automatically bound to extracted code dials and are **modulation targets** — they can be driven by LFOs, envelope generators, audio analysis, MIDI CC, aftertouch, pitchbend, keyboard, or macros. Each dial is mapped to a keyboard key (`q`–`m`) for real-time adjustment.

Common constants (0, 1, 2, π, 2π) are NOT extracted. See [Keyboard Shortcuts](#keyboard-shortcuts) for code dial controls.

### Video Textures

```glsl
// Webcam (when Camera enabled)
vec4 cam = texture(iVideo, uv);  // uv is vec2(0.0-1.0)

// Screen capture (when Screen Capture enabled)
vec4 screen = texture(iScreen, uv);
```

Webcam video is mirrored horizontally (selfie view). Screen capture provides the selected desktop/window/tab content. Use `1.0 - gl_FragCoord.y/iResolution.y` for Y flip if needed.

### Audio Textures

```glsl
// Waveform (time domain, 256 samples, values ~0.0-1.0 centered at 0.5)
float wave = texture(u_audioWaveform, vec2(uv.x, 0.5)).r;

// Spectrum (frequency domain, 128 bins, use pow for log-scale mapping)
float freq = texture(u_audioSpectrum, vec2(pow(uv.x, 2.0), 0.5)).r;

// Audio-reactive brightness from bass
float bass = texture(u_audioSpectrum, vec2(0.1, 0.5)).r;
col *= 0.5 + bass;
```

### Not Implemented — Do Not Use

> **Warning:** The following uniforms are referenced in some help text and Shadertoy examples but are **NOT implemented** in SlopShady. Shaders using them will fail to compile:
>
> `iMouse`, `iFrame`, `iTimeDelta`, `iFrameRate`, `iSampleRate`, `iDate`, `gl_FragColor`

### Time Control

The time slider provides manual control when paused:
- **Coarse slider**: 0-1000% of loop
- **Fine slider**: ±10% adjustment (enabled only when paused)
- **Loop detection**: Automatically calculates based on `iTime * multiplier` pattern

If your shader uses `iTime * 0.5`, the loop is 4π seconds. The slider maps to this loop.

---

## MIDI & OSC Input

SlopShady accepts musical input from **MIDI** (Web MIDI API) and **OSC** (native UDP bridge). Both feed the same per-layer voice and modulation engine, so notes and controls behave identically regardless of source.

### MIDI (Web MIDI API)

- **Note On/Off** → triggers up to 4 polyphonic voices per layer (respecting the layer's `voiceMode` and input filter).
- **Control Change (CC)** → modulation source `cc` (configurable CC number); also assignable to macros.
- **Pitch Bend** → `pitchbend` source (range -1..1).
- **Channel Pressure / Aftertouch** → `aftertouch` source.
- **Per-layer input filter**: MIDI channel (All or 1–16) and note range (min/max), set in the Voices > MIDI panel.
- Requires HTTPS (Web MIDI API constraint).

### OSC (native UDP bridge)

A built-in UDP listener decodes OSC packets and routes them through the same handlers as MIDI. Default port **8101**; configurable via `--osc-port` and `--osc-bind` CLI flags, and **hot-swappable from the UI** (Voices > OSC panel → Apply). The setting persists to `shaders.json`.

| Address | Args | Description |
|---------|------|-------------|
| `/note/{ch}` | `[V/oct, vel?]` | V/Oct pitch (0V = C4 / MIDI 60, 1V per octave); velocity omitted → max, `0` → note-off |
| `/noteon` · `/on` · `/n` | `[ch, note, vel]` | MIDI-style integer note; `vel 0` → note-off |
| `/noteoff` · `/off` | `[ch, note]` | Note off |
| `/cc` · `/control` · `/controlchange` | `[ch, cc, val]` | Control change, 0–127 |
| `/pitchbend` · `/pitch` · `/pb` | `[ch, val]` | Pitch bend, -1..1 |
| `/channelpressure` · `/aftertouch` · `/cp` | `[ch, val]` | Channel pressure, 0–127 |
| `/ch/{n}` | `[value]` | Generic 0–1 modulation source (OSC-Learn assignable) |

Notes arrive at the voice system exactly like MIDI notes. CC / pitchbend / aftertouch map to the same modulation sources (`cc`, `pitchbend`, `aftertouch`).

### Voice System

Each layer has its own voice manager with up to **4 polyphonic voices**. `voiceMode` per layer:

- **Poly** — multiple simultaneous voices with voice stealing (default for all layers, including Main).
- **Mono** — single voice, last-note priority.
- **Glide** — mono with portamento between notes.
- **Off** — ignores note input.

Voices drive the `u_voiceActive` / `u_voiceNote` / `u_voiceVelocity` / `u_voiceEG` uniforms (see [Shader Uniforms](#shader-uniforms)).

---

## Modulation System

### Overview

SlopShady has a per-layer synth-style modulation matrix that routes sources to destinations. Any source can drive any destination with configurable amount and curve.

### Modulation Sources

| Source | Description |
|--------|-------------|
| `note` | Active voice note (0-127, normalized) — via MIDI or OSC |
| `velocity` | Active voice velocity (0-1) — via MIDI or OSC |
| `cc` | MIDI/OSC CC value (configurable CC number, 0-1) |
| `aftertouch` | Channel pressure / aftertouch — via MIDI or OSC |
| `pitchbend` | Pitch bend wheel — via MIDI or OSC (-1..1) |
| `kbd` | Keyboard note (same as note) |
| `eg0`..`eg3` | Envelope generators (per-layer) |
| `lfo1`..`lfo4` | LFOs (sine, square, triangle, saw, S&H, noise) |
| `lfo_sine` | LFO 1 output as sine waveform |
| `lfo_square` | LFO 1 output as square waveform |
| `lfo_triangle` | LFO 1 output as triangle waveform |
| `lfo_saw` | LFO 1 output as saw waveform |
| `audio_peak` | Overall audio level |
| `audio_band_low` | Low frequency band |
| `audio_band_mid` | Mid frequency band |
| `audio_band_high` | High frequency band |
| `macro1`..`macro8` | User macro knobs (0-1) |

### Modulation Destinations

- **Layer parameters**: `u_opacity`, `u_brightness`, `u_speed`, `u_posX`, `u_posY`, `u_scale`, `u_radius`, `u_amount`, `u_rotation`, `u_stretch`, `u_maskPosX`, `u_maskPosY`, `u_maskSoftness`
- **Voice parameters**: `u_voicePosX`, `u_voicePosY`, `u_voiceScale`, `u_voiceRotation` (all voices or indexed per-voice: `u_voicePosX[0]`–`u_voicePosX[3]`, etc.)
- **Code dials**: `u_param_cd0`..`u_param_cd25`

### Modulation Curves

| Curve | Function |
|-------|----------|
| Linear | `x` |
| Exponential | `x²` |
| Logarithmic | `log10(x * 9 + 1)` |

### LFOs

4 LFOs with configurable waveform, rate (Hz or BPM-synced), amplitude, phase offset, and DC offset.

- **Waveforms**: sine, square, triangle, saw, sample & hold, noise
- **BPM sync**: 1/1, 1/2, 1/4, 1/8, 1/16 beat divisions
- **Key sync**: resets LFO phase on MIDI note-on

### Envelope Generators

4 envelope generators per layer with:
- **Phases**: Delay → Attack → Hold → Decay → Sustain → Release
- **Loop mode**: One-Shot, Loop, or Retrigger
- **Curve shapes**: Linear, Exponential, Logarithmic
- **Triggered by**: MIDI note-ons or manual trigger button

---

## Technical Notes

### Parameter Extraction

The shader compiler extracts numeric literals from your code and replaces them with uniform variables (`u_param_cd0`, `u_param_cd1`, etc.). This transformation happens at compile time, enabling real-time modulation without recompilation.

#### Filtering Rules

The following are NOT extracted as code dials:
- **Common integers and decimals**: `0`, `0.0`, `1`, `1.0`, `-1`, `-1.0`, `2`, `2.0`, `3`–`9`, etc.
- **Mathematical constants**: `3.14159`, `6.28318`, `1.57079` (π, 2π, π/2)
- **Preprocessor directives**: Lines starting with `#` (e.g., `#version`, `#define`)
- **Const declarations**: Values inside `const` definitions
- **For loop expressions**: Loop bounds must remain constant
- **Array sizes**: Declaration sizes like `vec2 arr[10]` are preserved
- **Built-in function names**: `sin`, `cos`, `tan`, etc.
- **GLSL type names and keywords**: `float`, `vec2`, `mat3`, etc.

#### Extracted Values

Numbers matching these patterns become dials:
- Negative and positive numbers: `-0.5`, `3.5`, `100.0`
- Scientific notation: `1.5e-3`, `2.5E2`
- Numbers not immediately followed by letters/underscores

### Compilation Error Recovery

When an AI-generated shader fails to compile, the system automatically:
1. Extracts the error message from the GLSL compiler
2. Sends the error back to the LLM with context
3. Requests a corrected version
4. Repeats until successful or user cancels

This happens transparently—no manual intervention needed.

### Streaming Responses

The LLM responses stream in real-time, with:
- **Live text rendering**: Characters appear as they arrive
- **Status updates**: Shows "Thinking...", "Generating response..."
- **Code block detection**: Automatically wraps detected GLSL in syntax-highlighted blocks
- **Thinking blocks**: `antThinking` tags are rendered as collapsible yellow sections
- **Blinking cursor**: Indicates streaming is active

### Cancel Requests

Click "Send" while a request is pending to cancel it. The abort controller stops the fetch request and resets the button state.

### Drag & Drop Loading

Drop any `.json` file anywhere on the page to load it:
- **Full save files**: Replace all settings, shaders, and state
- **Shaders-only files**: Merge into existing shader list (duplicates skipped)
- **Invalid files**: Console warning displayed, no action taken

### Panel Resizing

The bottom panel can be resized by dragging the handle on its top edge. Double-click the handle to minimize to minimum height.

### Performance Tips

- Use precision qualifiers (`/* highp */`, `/* lowp */`) to help GPU
- Reduce loop iterations in fragment shaders
- Disable modulation routes when not in use
- Pause animation when editing to reduce GPU load
- Lower screenshot resolution for faster AI analysis

### WebGL2 Context

The application creates a WebGL2 context with `preserveDrawingBuffer: false` for performance. Screenshots are captured via a deferred-capture pattern (`state.capturePending`) that resolves inside the render loop's `requestAnimationFrame` callback, reading the canvas before the buffer is swapped.

### Shader Auto-Save

Every shader that compiles successfully is automatically saved to the shader library. Duplicate code is detected by comparing trimmed shader source, preventing the same shader from being saved twice. The current shader is highlighted with a green border and ▶ indicator in the list.

### Default Shader

The application loads with "Obsidian Flow / Kinetic Bismuth" as the default shader, featuring:
- Recursive domain warping with non-Euclidean fluid dynamics
- Fractal Brownian Motion-esque layering with angular "Bismuth" steps
- Iridescent metal color palette (deep purples, golds, neon cyans)
- Metallic sheen lighting that reacts to distortion
- Soft natural vignette with high-pass contrast

---

## Browser Requirements

- **WebGL2** support required
- **getUserMedia** for camera/audio access
- **getDisplayMedia** for screen capture (optional)
- **Web MIDI API** for MIDI support (optional; requires HTTPS)
- Modern browser with ES6+ JavaScript support

---

## Project Structure

```
├── slopshady/                 # Rust backend (the only Cargo crate in this repo)
│   ├── Cargo.toml             # deps + [patch.crates-io] wry override
│   ├── Cargo.lock             # committed (app binary)
│   ├── build.rs               # Windows icon resource
│   ├── icon.ico               # Windows binary icon
│   ├── src/
│   │   ├── main.rs            # Entry point, CLI args, server/webview startup
│   │   ├── state.rs           # State load/save/normalize
│   │   ├── server.rs          # axum router, static file serving, stream cert-hash proxy
│   │   ├── ws.rs              # WebSocket handler, state sync, OSC hot-swap
│   │   ├── llm.rs             # LLM API proxy (models, chat/completions) + URL validator
│   │   ├── live_tuning.rs     # Iterative tuning loop
│   │   ├── osc.rs             # Native OSC UDP bridge
│   │   ├── screen.rs          # Native screen capture (webview feature only)
│   │   └── cert.rs            # Self-signed cert generation
│   └── patches/
│       └── wry/               # Locally-patched wry fork (see note below)
├── README.md
├── CONTRIBUTING.md            # Build steps, conventions, tooltip policy
├── SECURITY.md                # Vulnerability reporting + security caveats
├── LICENSE
├── slopshady.desktop          # Linux desktop entry
├── shaders.json               # Persisted state (auto-generated, gitignored)
├── cert.pem                   # Self-signed HTTPS cert (auto-generated, gitignored)
├── key.pem                    # Self-signed HTTPS key (auto-generated, gitignored)
├── static/
│   ├── slopshady.html         # Main frontend HTML
│   ├── css/
│   │   ├── main.css           # Application styles
│   │   ├── webamp.css         # Webamp overlay styles
│   │   └── litegraph.css      # Node graph editor styles
│   ├── js/
│   │   ├── main.js            # Entry point
│   │   ├── state.js           # Application state
│   │   ├── config.js          # Constants, templates, uniform defs
│   │   ├── utils.js           # Shared utilities
│   │   ├── webgl/             # WebGL2 rendering engine
│   │   ├── features/          # Audio, MIDI, OSC, LFO, modulation, playlist, Scanimate, VisualBrain,
│   │   │                      #   stream-worker (encoder+SRT+WASM), stream-audio(-worklet)
│   │   ├── ui/                # All DOM/panel UI modules (incl. streaming.js)
│   │   ├── api/               # LLM chat, live tuning, model listing, shaders
│   │   └── utils/             # Migration helpers
│   ├── lib/                   # Vendored third-party libraries (butterchurn, litegraph, webamp)
│   ├── wasm/
│   │   ├── srt-wasm/          # Browser-side SRT receiver/sender (used by stream-worker)
│   │   └── ts-muxer-wasm/     # MPEG-TS muxer (used by stream-worker)
│   └── content/
│       ├── manifest.json      # Factory shader catalog
│       └── shaders/factory/   # 80 built-in GLSL shaders
```

> **Note on `slopshady/patches/wry/`**: this is a full vendored copy of the [`wry`](https://github.com/tauri-apps/wry) crate with local modifications (TLS-ignore + the Windows WebView2 shutdown path). It is wired in via `[patch.crates-io]` in `slopshady/Cargo.toml` and **must not be upgraded or removed** — the default `webview` build depends on these patches. Build from inside `slopshady/` so the relative patch path resolves.

---

## License

SlopShady is free software: you can redistribute it and/or modify it under the terms of the [MIT License](LICENSE).

Third-party libraries are subject to their respective licenses (see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)):

| Library | License | Component |
|---------|---------|-----------|
| [Webamp](https://webamp.org/) | MIT | Browser Winamp clone (`static/lib/`) |
| [Butterchurn](https://github.com/niclas-niclas/butterchurn) | MIT | Milkdrop visualizer for WebGL (`static/lib/`) |
| [LiteGraph.js](https://github.com/jagenjo/litegraph.js) | MIT | Node graph editor (`static/lib/`) |
| [wry](https://github.com/tauri-apps/wry) (patched fork) | Apache-2.0/MIT | WebView wrapper (`slopshady/patches/wry/`) |
| [srt-wasm](https://github.com/maxolgi/WebSRT/tree/master/crates/srt-wasm) | MPL-2.0 | SRT receiver/sender WASM (`static/wasm/srt-wasm/`), built from `vendor/WebSRT/` submodule |
| [ts-muxer-wasm](https://github.com/maxolgi/WebSRT/tree/master/crates/ts-muxer-wasm) | MPL-2.0 | MPEG-TS muxer WASM (`static/wasm/ts-muxer-wasm/`), built from `vendor/WebSRT/` submodule |
| [mpeg2ts-wasm](https://github.com/maxolgi/WebSRT/tree/master/crates/mpeg2ts-wasm) | MPL-2.0 | MPEG-TS demuxer WASM (`static/wasm/mpeg2ts-wasm/`), built from `vendor/WebSRT/` submodule |
