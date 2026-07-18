# Off-Main-Thread Render + Encode Pipeline — Implementation Plan

Move SlopShady's WebGL2 render loop, video/audio capture, encode, streaming, and recording off the main thread into a single combined Web Worker, to eliminate main-thread starvation (especially during panel resize) and unify the stream/record codepaths through WebCodecs.

## Final architecture

```
                   MAIN THREAD                          │    RENDER-WORKER (single)
                                                       │
 DOM/UI (24 files)         MIDI (Web MIDI)             │   OffscreenCanvas + WebGL2
 Webamp (audioPlayer)      OSC dispatch (WebSocket)    │   ├── FramebufferManager
 getUserMedia/getDisplayMedia                          │   ├── LayerSystem + VoiceManager
 Tauri bridge              ───── state-marshal ──────►  │   ├── LFOEngine / EGSystem / ModMatrix
                                                       │   ├── Scanimate / VisualBrain
 AudioWorklet (Opus tap) ───────── MessagePort ─────►  │   ├── VideoEncoder + AudioEncoder
                                                       │   ├── TS muxer + SRT receiver (WASM)
                                                       │   ├── WebTransport (publish)
                                                       │   └── Sinks: StreamSink + RecordSink
                                                       │
                       ◄──── throttled UI snapshot ────┤  (15Hz: modulated params, EG values, voice status, LFO phases)
                       ◄──── time update (10Hz) ───────┤
                       ◄──── shader compile result ────┤
                       ◄──── capture blob ─────────────┤
```

The encoded A/V chunks feed **both** `StreamSink` (SRT/WebTransport) and `RecordSink` (mp4-muxer → file) — one encoder, two sinks. The existing `MediaRecorder` + `canvas.captureStream` path is deleted.

## Scope audit summary

Codebase root: `/home/flibb/SlopShady`. 18 UI/feature/api files touch `state.gl`/`LayerSystem`/`FramebufferManager` directly. The render loop reaches into DOM every frame (time slider read at `core.js:535-536`, writeback at `:578-582`). Per-frame UI callbacks (`:557-573`) read worker-owned state. HTMLVideoElement/Image texture uploads happen synchronously every frame from main. `MediaRecorder`/`toDataURL` break after `transferControlToOffscreen`. butterchurn is a `window` global.

This is not a "move the render loop" task — it's an architectural refactor that touches most of the codebase. Phased so each phase ships value; you can bail at any point if cost/benefit shifts.

---

## Phase 1 — Immediate wins (no architectural change)

### A. Panel resize rAF batching — `static/js/ui/bottom-panel.js:541-550`

Replace unconditional `mousemove` CSS write with rAF coalescing. State: `pendingHeight`, `rafId`. On mousemove: store pending height, schedule rAF if not already scheduled. In rAF callback: apply CSS var, clear rafId. On mouseup: cancel any pending rAF.

### B. CSS containment — `static/css/main.css:1160`

Add `contain: layout style paint;` to `.bottom-panel`. Verify no stacking-context regressions (panel renders above canvas via `z-index: 50`; containment preserves that).

### C. Hardware encode hint — `static/js/ui/streaming.js`

- `_videoConfig()` (line ~594): add `hardwareAcceleration: 'prefer-hardware'`
- `probeCodecs()` probe config (line ~750): same hint, so `supported` reflects HW availability

### Verification
`cargo clean -p slopshady && cargo build --release`, run, stream + drag panel hard. Confirm glitch reduction.

---

## Phase 2 — AudioWorklet audio path

### Goal
Capture audio entirely off the main thread, immune to panel reflow.

### New files
- `static/js/audio/stream-audio-worklet.js` — `AudioWorkletProcessor`. Accumulates 128-sample blocks into 20ms Opus frames (960 samples × 2 channels = 1920 floats), then `port.postMessage` `Float32Array` (transferable).
- `static/js/features/stream-audio.js` — main-side: registers the worklet module via `audioContext.audioWorklet.addModule('/js/audio/stream-audio-worklet.js')`, creates `AudioWorkletNode`, connects `state.audioPlayerAnalyser → node`, transfers the worklet's output `MessagePort` to the (existing, for now) `stream-worker.js`.

### Modified files
- `static/js/ui/streaming.js` — replace the `MediaStreamTrackProcessor` + `_pumpAudio` block (lines ~296-324) with `StreamAudio.init(state.audioPlayerAnalyser, worker)`; transfer the MessagePort via the existing `init` message: `{ type: 'init', ..., audioPort: port }`, `[port]`.
- `static/js/features/stream-worker.js` — accept `audioPort` in `init`; on message, construct `AudioEncoder({ output: ... })`, configure Opus 48kHz stereo 128kbps, and for each `Float32Array` build `new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: 960, numberOfChannels: 2, timestamp, data: float32 })` and `audioEncoder.encode(audioData)`.

### Why this works during panel drag
AudioWorkletProcessor runs on the audio render thread, scheduled by the OS audio device, not by rAF or main-thread scheduling. Panel reflow can't starve it.

### Verification
Stream + extreme panel drag for 30s. Capture on viewer side, confirm continuous Opus audio with no dropouts.

---

## Phase 3 (E1) — Worker skeleton + format probe

**Critical go/no-go gate.** If the worker GL context doesn't expose the same float texture formats as main, E is dead and we revert to Phase 1+2.

### New files
- `static/js/webgl/render-worker-protocol.js` — shared message-type constants used by both sides.
- `static/js/webgl/render-worker.js` — empty skeleton. Receives `OffscreenCanvas`, creates `gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false })`, queries extensions, runs a copy of `FramebufferManager.probeFormats()` body, posts `{ type: 'formats', extensions, supportedFormats, fboFormat }` back.

### Modified files
- `static/js/webgl/core.js` — feature-gate via `state.useRenderWorker` (read from `localStorage` or `?renderWorker=1`). If set: `const offscreen = canvas.transferControlToOffscreen(); worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);` and skip the current init path. Otherwise current path.
- `static/js/main.js` — spawn `render-worker.js` if `state.useRenderWorker`.

### Verification
Open `?renderWorker=1`, check console. Worker logs `formats`; main logs diff vs current main-side `FramebufferManager.formatTable`. **Gate**: formats match. If `EXT_color_buffer_float` or `OES_texture_float_linear` are absent in worker, stop E.

---

## Phase 4 (E2) — State ownership boundary

### Goal
Define the wire protocol before moving logic. Foundation for everything below.

### New files
- `static/js/state-marshal.js` — exports `Marshal` singleton:
  - `Marshal.local(patch)` — apply patch to local `state` only (main-owned fields).
  - `Marshal.remote(patch)` — apply locally + `postMessage` to render-worker (shared fields).
  - `Marshal.onSnapshot(handler)` — register handler for worker→main UI snapshots.
  - Internally tracks which fields are "shared" vs "main-only" via an allowlist.
- `static/js/webgl/render-worker-protocol.js` (extended) — full message type catalog:
  - **main → worker** (state changes): `setLayerConfig { index, patch }`, `setDial { layerIndex, dialKey, value }`, `setMacro { index, value }`, `setMidiCC { ch, cc, value }`, `setChannelPressure { ch, value }`, `setPitchBend { ch, value }`, `setOscValue { address, value }`, `setAudioModulators { peak, low, mid, high }` (throttled), `triggerVoice { layerIndex, note, vel }`, `releaseVoice { layerIndex, note }`, `setModulation { layerIndex, entry }`, `removeModulation { layerIndex, entryId }`, `setResolutionScale { scale }`, `setScanimateConfig { patch }`, `setVisualBrainConfig { patch }`, `pushVideoFrame { bitmap }`, `pushScreenFrame { bitmap }`, `pushAudioTexture { waveform, spectrum }`, `pushMilkdropFrame { bitmap }`, `recompileShader { layerIndex, source }`, `requestCapture { id }`, `startStream { ... }`, `stopStream`, `startRecord { path, sink }`, `stopRecord`.
  - **worker → main**: `ready`, `formats`, `renderedFrame { time }` (10Hz), `uiSnapshot { modulatedParams, modulatedDials, lfoPhases, egValues, voiceStatus }` (15Hz), `shaderCompiled { layerIndex, error, params }`, `captureResult { id, blob }`, `streamStats`, `streamStatus`, `recordProgress`.

### Modified files
This phase doesn't change behavior. It only adds the protocol and the marshal. No production code path uses it yet.

### Verification
Round-trip unit-style console checks: every state field listed in the protocol round-trips through `Marshal.remote` → worker echoes back → main verifies.

---

## Phase 5 (E3) — Pure-GL modules to worker

### Goal
`FramebufferManager` and `WebGL` core (init/resize/setupQuad) live in worker; main has a `WebGLProxy` with identical API.

### Modified files
- `static/js/webgl/framebuffers.js` — make the singleton worker-constructable (it already is mostly; just ensure no DOM access). Move probe logic into worker.
- `static/js/webgl/core.js` — split: keep a thin `WebGL` proxy on main that delegates `init`/`resize`/`compileProgram`/`initShader`/`compileForLayer`/`render` to worker via marshal. The actual implementations move to a new `static/js/webgl/core-worker.js` loaded only inside the worker.
- `static/js/webgl/render-worker.js` — accept `init`, `resize`, accept `compileShader` requests, return `shaderCompiled` responses (with extracted params).
- Every file that imports `WebGL` from `webgl/core.js` — works unchanged because the proxy has the same shape. The change is internal to `core.js`.

### Verification
Load `?renderWorker=1`, open a shader. Confirm it renders. Trigger `WebGL.resize()` (window resize) — confirm FBOs resize correctly. Probe `FramebufferManager.formatTable` — should be populated from the worker's reported formats.

---

## Phase 6 (E4) — LayerSystem + render loop + features into worker

The big one. **No way to plan every line in advance** — this is where iterative execution matters. The moves and integration points are specified; specifics emerge during execution.

### Move into worker
- `static/js/webgl/layers.js` (Layer + LayerSystem) — biggest module
- `static/js/webgl/voices.js` (VoiceManager)
- `static/js/features/lfoEngine.js`
- `static/js/features/envelopeGenerators.js`
- `static/js/features/modulationMatrix.js`
- `static/js/features/scanimate.js`
- `static/js/features/visualBrain.js`

### Per-frame DOM writes replaced by worker→main messages
- `core.js:535-536` (paused-state time scrub reads `timeSlider`) → main sends `timeScrub { value }` on slider input, worker stores latest.
- `core.js:578-582` (every-6-frame time slider writeback + display) → worker sends `timeUpdate { percent, displayText }` at 10Hz, main writes DOM.
- `core.js:557-573` (throttled UI callbacks reading `_modulatedParams`/`voiceManager.voices`/`lfos[i].phase`/`entry._lastOutputValue`) → worker publishes `uiSnapshot` at 15Hz; main UI modules read from snapshot instead of live objects.

### DOM events replaced
- `envelopeGenerators.js:57,70` (`document.dispatchEvent('eg-trigger'/'eg-release')`) → worker sends `egTrigger { layerIndex, voiceIndex, egIndex }` / `egRelease`. `egPanel.js` listens via marshal.

### HTMLVideoElement/Image texture uploads
- Main runs a per-frame "texture source pump" (in `requestAnimationFrame`): for each of `state.videoElement`, `state.screenElement`, plus per-layer video/image materials that are active, call `createImageBitmap(source)` (async, parallel via `Promise.all`), transfer bitmaps to worker via `pushVideoFrame`/`pushScreenFrame`/`pushLayerImageFrame { layerIndex, bitmap }`.
- Worker uploads via `gl.texImage2D(…, bitmap)`. Adds ~1 frame latency to video/screen — acceptable.
- Per-layer video (`LayerSystem.loadVideoTexture`): the HTMLVideoElement stays on main (worker can't create one); main pumps bitmaps each frame for any layer with a video material.

### Per-layer image textures
`LayerSystem.loadImageTexture` stays main-side as the loader (`new Image()` → `createImageBitmap` → transfer); worker holds the GL texture handle and a worker-side cache keyed by URL.

### Kill the `window.LayerSystem.imageCache` circular dep
`scanimate.js:292-299` reads `window.LayerSystem.imageCache`. Worker owns its own image cache; ScanimateEngine (now in worker) reads from it directly.

### Kill `state.program` / `state.timeLoc` / etc.
Worker-only. The render loop's `LayerSystem.layers[0] ↔ state.program` sync (`core.js:585-592`) becomes a no-op — worker owns layer 0's program directly.

### `Sync.applyState` race
`sync.js:194-206`: main calls `applyState` → marshal sends the full state patch + any recompile requests as one atomic message; worker does `LayerSystem.applyState` + `recompileShader` in sequence inside the message handler. No race.

### Verification
Render-output visual diff vs pre-move (same shader, same layer config). Stream output identical. Every UI control tested one by one: layer mixer (opacity/solo/mute/blend), code dials, voice keys (MIDI + OSK + manual EG), modulation matrix, feedback, playlist, scanimate, visualbrain.

---

## Phase 7 (E5) — VideoEncoder + AudioEncoder + WebTransport into worker

### Goal
Streaming capture fully off main.

### Move into worker
- `VideoEncoder` and the `new VideoFrame(offscreenCanvas, …)` call from `streaming.js:494-501`.
- `WebTransport` setup from `streaming.js:285-258`.
- The existing `stream-worker.js` body (SRT + TS muxer WASM) **merges into `render-worker.js`** — same worker. The SRT/TS code becomes a module imported by render-worker. The TS-muxer WASM init that's currently in stream-worker moves into render-worker's init.
- `AudioEncoder` for stream audio (currently in stream-worker from Phase 2) — same worker.

### Pipeline inside render-worker
```
render loop ─► VideoFrame(offscreenCanvas) ─► VideoEncoder
                                              ├─► StreamSink: TS-muxer ─► SRT ─► WebTransport
AudioWorklet MessagePort ─► AudioEncoder ─────┤
                                              └─► RecordSink: mp4-muxer ─► file (Phase 8)
```

### VideoEncoder config
Lives in worker. Main sends `startStream { codec, bitrate, fps, latency, keyframe, gatewayUrl, streamName, certHash }` and `stopStream`. Worker emits `streamStatus` and `streamStats` messages.

### Existing `static/js/features/stream-worker.js`
Deleted. Its content (init, SRT, TS muxer, stats, datagram protocol) becomes the body of `render-worker.js`'s streaming submodule, plus a new `static/js/webgl/stream-sink.js`.

### Modified main-side files
- `static/js/ui/streaming.js` — gutted. `StreamingUI` becomes a thin UI coordinator: reads form inputs, sends `startStream`/`stopStream` via marshal, listens for `streamStatus`/`streamStats`. No more VideoEncoder/AudioEncoder/WebTransport/worker on main.

### `captureFrame()`
At `core.js:602-604`: removed. The render loop in the worker decides whether to encode each frame (it always does when a sink is active). No main-thread involvement.

### Cert-hash proxy
`server.rs:141-176`: unchanged. Main still fetches it (it's HTTP) and passes the hash to the worker via the `startStream` message.

### Verification
Stream with `?renderWorker=1`. Same OBS/viewer setup. Verify decoded video + audio on viewer side. Confirm main thread is idle during stream (Chrome devtools Performance → Main thread should show near-empty while streaming).

---

## Phase 8 (E6) — Unified WebCodecs recorder

### Goal
One encoder, two sinks. `MediaRecorder` deleted.

### New files
- `static/js/features/av-sink.js` — defines `Sink` interface (`pushVideoChunk(chunk, meta)`, `pushAudioChunk(chunk, meta)`, `flush()`, `close()`). Implementations: `StreamSink` (wraps existing TS-muxer + SRT logic), `RecordSink` (uses mp4-muxer).
- Vendor `mp4-muxer` (or `webm-muxer`) package into `static/js/lib/mp4-muxer.min.js`. Check license compatibility (mp4-muxer is MIT).
- `static/js/webgl/recorder-config.js` — recorder config UI state.

### Modified files
- `static/js/webgl/render-worker.js` — VideoEncoder output callback iterates over active sinks and pushes the chunk to each. Same for AudioEncoder.
- `static/js/ui/recorder.js` — replace `canvas.captureStream(fps)` + `new MediaRecorder` with `Marshal.remote({ type: 'startRecord', config: { videoCodec, audioCodec, container, path } })`. Listen for `recordProgress { ms, bytes }` and `recordComplete { blob }`.
- `static/slopshady.html` — recorder UI stays the same; underlying mechanism changes.

### Encoder sharing subtlety
A single VideoEncoder config serves both sinks if codecs match. If stream is set to H.264 and record to AV1, you need **two** VideoEncoders (each gets its own VideoFrame copy from the OffscreenCanvas). Design decision: for Phase 8, require both sinks to use the same codec (record inherits stream codec, or vice versa). Multi-codec is a follow-up.

### Verification
Start stream + start record simultaneously. Confirm both outputs play correctly. Stop stream while recording continues — record should keep going. Stop record mid-stream — stream continues.

---

## Phase 9 (E7) — Milkdrop

### Approach
Keep Milkdrop on main with its own canvas; ship `ImageBitmap` per frame to worker (same pattern as video/screen textures). Avoids re-bundling butterchurn.

### Modified files
- `static/js/features/milkdrop.js` — after `MilkdropFeature.render()`, call `createImageBitmap(state.milkdropCanvas)` and `Marshal.remote({ type: 'pushMilkdropFrame', bitmap }, [bitmap])`.
- Worker's render loop expects `pushMilkdropFrame` and uploads to `state.milkdropTexture` before layer composite.

~1 frame latency for milkdrop-driven layers — acceptable.

### Verification
Enable Milkdrop on a layer, stream, confirm visual identical to pre-move.

---

## Phase 10 — UI migration tail

Convert each remaining UI/feature/api file to go through the proxy/marshal. Mechanical, extensive. Order:

### Group 1 — pure UI reading worker state (low risk)
- `ui/voiceUI.js` (66ms interval reads voice status → consume `uiSnapshot`)
- `ui/egPanel.js` (manual EG trigger → marshal `triggerVoice`/`triggerEG` message; reads → snapshot)
- `ui/codeDials.js` (slider drag → `setDial`; mod arc → snapshot)
- `ui/modulationMatrixUI.js` (matrix edits → `setModulation`/`removeModulation`; visualizer → snapshot)
- `ui/layerMixer.js` (opacity/solo/mute/blend → `setLayerConfig`; modulated sliders → snapshot; `state.gl.deleteProgram` → marshal `releaseProgram`)
- `ui/feedback.js` (`ensureLayerFeedbackFBOs`/`destroyLayerFeedbackFBOs` → marshal messages)

### Group 2 — UI triggering shader recompiles
- `api/llm.js`, `api/liveTuning.js`, `api/conversation.js`, `api/shaders.js`, `ui/contentBrowser.js`, `ui/keyboard.js`, `ui/persistence.js` — all call `WebGL.initShader()`; go through proxy. Source text ships in message; worker compiles; result returns via `shaderCompiled`.

### Group 3 — feature modules with split responsibilities
- `features/midi.js` — stays main; each event posts `setMidiCC`/`triggerVoice`/`releaseVoice`/`setChannelPressure`/`setPitchBend`.
- `features/osc.js` — stays main; UI dispatch unchanged, numeric results posted to worker.
- `features/video.js`, `features/screenCapture.js` — stay main; add per-frame `createImageBitmap` pump.
- `features/audio.js` — `AnalyserNode.getByteFrequencyData/getByteTimeDomainData` stays main; pump `Uint8Array`s to worker each frame + compute `audioModulators` on main.
- `features/capture.js` — uses `requestCapture`/`captureResult` instead of `toDataURL`.
- `features/sync.js` — wraps `LayerSystem.applyState` in a marshal message that worker applies atomically.
- `features/playlist.js` — loads playlist on main, sends patches to worker.

### Group 4 — bottom-panel internals
- `ui/bottom-panel.js` — precision-dropdown re-inits FBOs via marshal message; pointer handlers stay; `WebGL.resize()` becomes proxy call.

---

## Cross-cutting work (apply throughout)

1. **`getEl` removal in worker paths** — any code that runs in worker can't call `getEl`/`document.*`. Audit `webgl/` and `features/` modules during their move.
2. **Kill `window.WebGL`/`window.LayerSystem` globals** — these exist for circular-dep breaks. After the move, `WebGLProxy` on main replaces `WebGL`; `LayerSystem` lives in worker scope. UI files import `WebGLProxy` instead.
3. **Scanimate `window.LayerSystem.imageCache` circular dep** — ScanimateEngine (in worker) owns its own cache; main never touches it.
4. **`document.dispatchEvent('eg-trigger'/'eg-release')`** — replaced by worker→main `egTrigger`/`egRelease` messages.
5. **`state.canvas.toDataURL`** — replaced by `OffscreenCanvas.convertToBlob` in worker.
6. **Globals shared via `window.__state`** — replaced by `Marshal` snapshots where read by UI.

---

## Execution strategy

- **Batch 1**: Phase 1 + Phase 2. Verify the actual symptom is fixed before committing to E. ~1-2 sessions.
- **Batch 2**: Phase 3 (format probe gate). Half-session. If formats match, proceed. If not, stop here — Phase 1+2 is enough.
- **Batch 3**: Phase 4 (marshal + protocol). Foundation; no behavior change. ~1 session.
- **Batch 4**: Phase 5 (pure GL). Small. ~1 session.
- **Batch 5**: Phase 6 (LayerSystem + render loop). The big one. Multi-session; iterative. Plan to land behind `?renderWorker=1` flag, test exhaustively, then promote to default.
- **Batch 6**: Phase 7 (encoder + transport into worker). ~1 session.
- **Batch 7**: Phase 8 (unified record). ~1 session.
- **Batch 8**: Phase 9 (Milkdrop). Half-session.
- **Batch 9**: Phase 10 (UI migration tail). Multi-session mechanical work.

**Feature flag throughout**: `?renderWorker=1` (persisted via `localStorage`). Lets you A/B the worker path against the current path until confidence is high. Default flip is the very last step.

---

## Risks that can't be fully resolved in plan

1. **Phase 6 specifics**: moving LayerSystem has surprises. The scope audit lists 15+ risk items but each one surfaces real issues only during execution. Expect iteration.
2. **Per-frame texture pump latency**: ~1 frame for video/screen/milkdrop. If you see drift between video-texture layers and shader-driven layers, this is why. Mitigation: pump at higher priority (rAF first thing) and stamp timestamps.
3. **Browser extensions in worker**: if `EXT_color_buffer_float` is missing in worker (some Linux Mesa drivers), Phase 3 fails. We've gated on it.
4. **MIDI latency**: `triggerVoice` round-trip is typically <1ms but is non-zero. Polyphonic playing should be fine; if you see timing issues at fast tempos, that's the cause. Mitigation: batch MIDI events per frame into one message.

---

## Verification commands

No test suite per `AGENTS.md`. Each phase needs manual verification against the release binary:

```
cd slopshady && cargo clean -p slopshady && cargo build --release
target/release/slopshady
```

Phase-specific verification listed under each phase above.
