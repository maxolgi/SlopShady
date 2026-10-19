# SlopShady — repo-specific guidance

Rust backend (`slopshady/`, axum + tokio) + TypeScript/JavaScript frontend embedded into the binary at compile time via `rust-embed`. Single binary at runtime; Node + `npm` are contributor-time only (for `tsc`). See `CONTRIBUTING.md` for full build/conventions; `README.md` for feature/uniform reference; `SECURITY.md` for caveats.

## QuicSRT-wasm submodule: bump-first rule (READ THIS FIRST)

`vendor/QuicSRT-wasm/` is a git submodule pinned to ONE commit. It goes stale. The
user iterates on QuicSRT constantly and runs builds newer than this pin, so the
tree you can read is frequently behind what the user actually runs.

Why the frequent bumps: SlopShady and the QuicSRT stack are developed in lockstep
right now. The user tests them together while making many engine changes, so the
pin is kept synced to latest origin/master to avoid confusion (stale vendored code
≠ what the user actually runs). This should taper off once QuicSRT stabilizes;
until then, bump readily and commit the pin advance as a normal step (see
"Pulling QuicSRT-wasm changes").

Before reasoning about anything under `vendor/QuicSRT-wasm/` — the engine
(harness/), the JS wrappers (js/), the player TS (page/vendor/), or the C++
gateway it talks to — bump:

    git submodule update --remote vendor/QuicSRT-wasm   # advance working tree to latest origin/master
    ( cd slopshady && cargo build )                     # rebuilds the stale engine via build.rs

Bump when (non-exhaustive — when in doubt, bump):
- The user reports behavior in QuicSRT, the engine, SRT/WebTransport, the
  wrappers, or the player TS.
- You cannot find a file/module/path under `vendor/QuicSRT-wasm/` that the user
  references.
- You are about to cite `vendor/QuicSRT-wasm/` line numbers or claim "the
  vendored version does/doesn't X."

Never conclude "this is old / not implemented" from a stale tree. Bump, re-read,
then reason. Advancing the working tree is free and non-destructive; it only
moves the checkout forward. Committing the advanced pin is a separate, intentional
step (see "Pulling QuicSRT-wasm changes" below) — agents commit bumps, never push.

Verify: `git -C vendor/QuicSRT-wasm log --oneline -1` shows a recent commit and
the file/module you were missing now exists.

**Never edit source files under `vendor/QuicSRT-wasm/`.** It is the upstream
QuicSRT-wasm repo, vendored read-only via submodule — SlopShady consumes it (the
emcc engine module + JS wrappers + player TS), it does not own it. The only
intended mutations of that working tree are bumping the pin
(`git submodule update --remote`) and the build-time staging build.rs performs
(link output in `build/`, and SlopShady-authored wrapper `.d.ts` staged into
`js/` — both untracked there, regenerated every build). Never modify, create, or
delete tracked source files there.

A change requested in SlopShady is solved **in SlopShady** (`src/js/`,
`slopshady/src/*.rs`, static assets). If you conclude the real fix must live in
QuicSRT-wasm (engine C++, wrappers, or player TS), stop — that is the boundary.
Do not edit the library to resolve a SlopShady-side request. Describe the exact
QuicSRT-wasm edit to the user verbatim (file, lines, diff); the user applies it
in QuicSRT-wasm (commit + push), then you bump the pin here.

## Source layout

- **`src/js/`** — frontend source (`.ts` for new files; `.js` for legacy files migrated opportunistically). This is what you edit.
- **`static/js/`** — build output, gitignored. Regenerated from `src/js/` by `slopshady/build.rs` on every `cargo build`. **Do not edit.**
- **`static/{css,wasm,lib,content,*.html}`** — static assets, served as-is.
- **`src/types/`** — TypeScript ambient declarations for vendored globals (`litegraph`, `butterchurn`, `webamp`) and AudioWorklet processor globals not in `lib.dom.d.ts`.

## Build & run

One-time setup (after clone or submodule bump):

```bash
git submodule update --init vendor/QuicSRT-wasm
git -C vendor/QuicSRT-wasm submodule update --init deps/libquicsrt
git -C vendor/QuicSRT-wasm/deps/libquicsrt submodule update --init deps/srt
npm install                          # installs typescript dev dependency
# Emscripten toolchain (build.rs links the engine with emcmake/cmake/em++):
#   git clone https://github.com/emscripten-core/emsdk ~/emsdk
#   ~/emsdk/emsdk install latest && ~/emsdk/emsdk activate latest
# (upstream QuicSRT-wasm CI pins 6.0.8; also needs cmake + ninja + a C++17 compiler)
```

Regular workflow:

```bash
cd slopshady                  # ALWAYS build from here
cargo run                     # default gui build, https://localhost:8100
cargo run -- --no-gui         # server-only (still gui feature, no control panel)
cargo run --no-default-features -- --no-gui   # pure HTTPS server, no GUI compiled in
cargo build --release         # release binary is the real run target
```

`cargo build` automatically runs `build.rs` which:
1. Builds the QuicSRT C++ engine from `vendor/QuicSRT-wasm/` (libquicsrt receiver-only flavor + srt static lib via `emcmake`/`cmake`, then the single emcc module `srt_engine.mjs` + `.wasm` via `em++`) and stages `js/` + `build/` + the tsc-emitted `page/vendor/` as siblings under `static/vendor/QuicSRT-wasm/`. Gated on an mtime check so untouched builds skip the cmake/em++ work. The engine uses pthreads (SharedArrayBuffer) — the server sends COOP/COEP headers so the document is cross-origin isolated.
2. Mirrors `src/js/**/*.{js,mjs}` to `static/js/` byte-for-byte (preserves hand-formatted source — tsc's printer reformats, so we bypass it for `.js`).
3. If any `.ts` files exist under `src/js/`, invokes `tsc` to compile them into `static/js/`.

For live-edit iteration, run `npm run watch` in a second terminal — `tsc --watch` recompiles changed `.ts` files in <500ms. You still need `cargo build` to re-embed into the binary (or touch any `.rs` file).

### TypeScript conventions

- **New files are `.ts`.** Existing `.js` files stay `.js` until touched for other reasons — migrate opportunistically, one file per PR.
- **Import specifiers must use `.js` extension** even in `.ts` files (`moduleResolution: "Bundler"` resolves `./foo.js` to `./foo.ts` source). This keeps emitted output stable.
- **`tsconfig.json`** is at the repo root. `allowJs: true, checkJs: false` — existing JS works as-is; new TS gets full type-checking.
- **Vendored globals** (`LiteGraph`, `butterchurn`, `Webamp`) are typed as `any` in `src/types/*.d.ts` for now. Tightening is a follow-up.
- **Workers / AudioWorklet** use the same `tsconfig` — `lib` includes both `DOM` and `WebWorker`. The AudioWorklet processor globals (`AudioWorkletProcessor`, `registerProcessor`, `currentFrame`, `sampleRate`) come from `src/types/audioworklet-globals.d.ts`.
- **Engine wrapper imports** use absolute specifiers like `'/static/vendor/QuicSRT-wasm/js/srt_engine.js'` — `tsconfig.paths` maps the vendor root so tsc resolves the emitted `.d.ts`. The wrapper `.d.ts` files themselves are SlopShady-authored in `src/types/quicsrt/` (emcc emits no types, unlike wasm-pack) and staged into the submodule's `js/` by build.rs so the vendored TS's relative `'../../js/*.js'` imports resolve.

### QuicSRT engine

The browser engine (SRT receiver + TS demux + TS muxer, one emcc module over the real srt codebase) is built from the `vendor/QuicSRT-wasm/` submodule. `build.rs` links it automatically when the staged artifacts under `static/vendor/QuicSRT-wasm/build/` are missing or older than the sources — no manual step required. That tree is gitignored (regenerated, not committed). You can force a rebuild anytime by deleting `static/vendor/QuicSRT-wasm/`. `build.rs` invokes `emcmake`/`cmake`/`em++` directly (mirroring upstream `build.sh`, no shell, so it works on any OS); the emsdk toolchain is located via `$EMSDK`, then `~/emsdk`, then PATH.

Layout contract: `js/` (wrappers) and `build/` (engine module) must stay siblings of the tsc-emitted `page/vendor/` under `static/vendor/QuicSRT-wasm/` — `engine_module.js` imports `'../build/srt_engine.mjs'` relative to itself, the emcc module self-imports to spawn its pthread workers and fetches its `.wasm` relative to itself, and the vendored TS imports the wrappers via `'../../js/*.js'`. Keep this layout intact or every relative import breaks.

### QuicSRT-wasm dependency tree (two layers of pinning)

1. **`vendor/QuicSRT-wasm/` is a git submodule.** SlopShady's git records the exact commit (the `gitlink` entry). This is the only layer SlopShady ever touches.
2. **Its nested submodules** (`deps/libquicsrt`, which itself pins `deps/srt` — the srt fork — plus WT-only `deps/lsquic` that never builds here) ride the QuicSRT-wasm commit. Advancing them is a QuicSRT-wasm-repo operation, not a SlopShady one.

#### Pulling QuicSRT-wasm changes (the only SlopShady-side operation)

Whether the engine C++, the wrappers, the player TS, or the nested libquicsrt/srt pins moved, the SlopShady-side step is identical — bump the submodule pin:

```bash
git submodule update --remote vendor/QuicSRT-wasm   # advance the pin to latest origin/master
cargo build                                         # build.rs relinks the stale engine
git add vendor/QuicSRT-wasm && git commit -m "chore(quicsrt): bump submodule"
```

That's it. Never `cd vendor/QuicSRT-wasm` to commit from the SlopShady side — that crosses the submodule boundary and creates orphaned local commits that don't survive a future `git submodule update`. Nested-dep bumps belong in the QuicSRT-wasm repo.

**Commit posture:** committing in SlopShady is expected as part of normal work —
you do not need to ask first. This covers the bump commit above and your own
completed change units. (This overrides the generic "never commit unless asked"
for this repo.) You never commit in QuicSRT-wasm — but since you never modify its
tracked sources either, that side never arises.

- Default port `8100`, OSC UDP `0.0.0.0:8101`, `--data-dir` defaults to `.` (CWD). `shaders.json`, `cert.pem`, `key.pem` are written into `--data-dir` and are gitignored.
- Two Cargo features: `gui` (default; egui control panel via `eframe`) vs no-default-features (HTTPS server only, no GUI compiled in). MIDI runs in the browser regardless.
- Linux `gui` builds need an OpenGL stack (eframe `glow` backend); no `libgtk-3-dev`/`libwebkit2gtk` needed.

### Non-obvious build quirks

- **`build.rs` runs on every `cargo build`.** It mirrors `src/js/` → `static/js/` before `rust-embed` evaluates. Editing under `src/js/` triggers `cargo:rerun-if-changed`, so cargo rebuilds automatically.
- **Static-only edits DO re-embed now** (Phase 1 change) — `build.rs` reruns on any `src/js/` change, which forces rust-embed to re-evaluate. The old "touch a `.rs` file" workaround is no longer needed.
- **No live-reload.** Frontend changes still need `cargo build` + restart. `tsc --watch` only speeds up the TS compilation half.

## Verification

**CI exists: `.github/workflows/build.yml`.** The `check` job (ubuntu) runs advisory `cargo fmt --check` / `cargo clippy`, `cargo test`, and `npm run typecheck`; the `build` job produces Linux/Windows/macOS release artifacts and publishes a GitHub Release. No `rustfmt.toml`/`clippy.toml` — match surrounding style.

- `cargo check` from `slopshady/` (must pass before submitting).
- Run the release binary and exercise the affected feature in the UI.
- `cargo test` from `slopshady-native/` only applies to the native port (see below).

## Repo shape gotchas

- **`slopshady-native/`, `oneamp/`, and `projectm/` are referenced extensively in README/CONTRIBUTING but DO NOT exist in this repo** (no `.gitmodules`). This is the backend repo only. Ignore native-port instructions here.
- Backend is Rust only — there is no `server.py` or Node server.
- `static/lib/` (butterchurn, litegraph, webamp) is vendored and minified. **Do not hand-edit.**
- **`vendor/QuicSRT-wasm/` is a git submodule** (github.com/maxolgi/QuicSRT-wasm) — the C++ engine (one emcc module: SRT receiver + TS demux + TS muxer), its JS wrappers, and the player TS (`page/vendor/`). `build.rs` links and stages it into `static/vendor/QuicSRT-wasm/` automatically; do not hand-edit that tree (gitignored, regenerated). Bumping is a normal operation: `git submodule update --remote` + `cargo build`. Nested deps (`deps/libquicsrt`, `deps/srt`) ride the submodule commit — see "QuicSRT-wasm dependency tree" above.
- The old `vendor/WebSRT/` Rust submodule is gone; the Rust stack survives only as the upstream "oracle" gateway in the QuicSRT repos. Never re-add it for SlopShady-side work.
- Entry points: `slopshady/src/main.rs` (CLI, server/gui startup), `gui.rs` (egui control panel: Start/Stop/Open Browser), `server.rs` (axum router + `#[folder = "../static/"]` embed), `ws.rs` (WebSocket state sync + `PERSIST_KEYS`), `llm.rs` (LLM proxy + `validate_lm_url`), `live_tuning.rs` (server-side tuning loop), `osc.rs` (UDP OSC bridge), `state.rs` (load/save/normalize). Frontend entry: `static/js/main.js`.

## Frontend conventions (`static/js/`, `static/css/`)

- ES6 modules with relative paths. No framework. `camelCase` for vars/funcs; `PascalCase` for module singletons (`WebGL`, `MIDISystem`). Each module exports a singleton or `init()` wired in `main.js`.
- **All CSS lives in `static/css/`. No inline styles.** Move any inline styles you find.
- **Reuse existing UI patterns** — do not invent new classes/wrappers: `.dropdown`, `.tool-btn` / `.tool-grid` / `.tool-group`, `.panel-section` + `.content-title`, `.slider`, `.knob-group` + `.knob`, `.toggle-group` + `.toggle`.
- **Every interactive UI element MUST have a tooltip — no exceptions.** Add a key to `T` in `static/js/ui/tooltips.js`; for static HTML also add to `STATIC_MAP`; for dynamic markup use `ti('KEY', {n})`. Parameterized tooltips use `{n}` for the layer/control index.
- Cycles between webgl/core.js ↔ api|ui singletons and layers.js ↔ features/scanimate.js are broken via `window.*` globals set in `main.js` (`window.WebGL`, `window.LayerSystem`) — do not convert these to static imports.
- Everything else uses setter injection (`setSyncDependencies` in `sync.js`, `setDependencies` on MIDISystem/PlaylistSystem); prefer static imports when no cycle exists.

## Shader / uniform constraints

- **NOT implemented** despite appearing in help text or Shadertoy examples — shaders using these will fail to compile: `iMouse`, `iFrame`, `iTimeDelta`, `iFrameRate`, `iSampleRate`, `iDate`, `gl_FragColor` (use `fragColor`).
- Implemented: `iTime`, `iResolution`, `iVideo`, `iScreen`, `fragColor`, `gl_FragCoord`, `u_audioWaveform`, `u_audioSpectrum`, layer params (`u_brightness`, `u_posX`, …), voice uniforms.
- Code dials: numeric literals extracted into `u_param_cd0`..`u_param_cd25` (max 26). **Common constants** (`0`, `1`, `2`, `π`, `2π`, etc., per `COMMON_CONSTANTS` in `config.js`) **are NOT extracted**; nor are `const` values, loop bounds, array sizes, preprocessor lines, or GLSL keywords/built-in function names.
- WebGL2 context uses `preserveDrawingBuffer: false`; screenshots use a deferred-capture pattern (`state.capturePending`) inside the render loop, not the drawing buffer.
- **Layer 0 = "Main".** On `shaderCode` updates the value is mirrored into `layers[0].material.source` in `ws.rs` — keep in sync if you touch layer 0. There are 8 layers (indices 0–7).
- New per-layer state fields must be added both to `LAYER_DEFAULTS` in `src/js/webgl/layers.js` and to `default_layers`/`normalize_layer` in `slopshady/src/state.rs`.
- Same rule for scanimate and LFO/modulation-source defaults: they exist in `state.js` (`state.scanimate`, `state.lfos`, `state.macros`) AND as json! defaults in `load_state()` in `slopshady/src/state.rs` — add new fields to both sides.

## Security constraints

- `bearerKey` (LLM API credential) is forwarded to the upstream OpenAI-compatible endpoint and **included in plaintext in full-state JSON exports** (`Ctrl+S` / "Save to JSON"). It is NOT written to `shaders.json` (not in `PERSIST_KEYS`) and never committed. Shaders-only exports omit it.
- HTTPS server binds `0.0.0.0:8100`, OSC binds `0.0.0.0:8101` — reachable on the LAN, **no auth** (single-user local by design). Self-signed cert generated into `--data-dir` on first run; the GUI launches the web app in the system browser, which shows the usual self-signed cert warning (no TLS bypass — accept it once).
- LLM endpoint URL is validated to reject non-`http`/`https` schemes (`validate_lm_url` in `llm.rs`) — preserve this if you touch the proxy.
- The cert-hash proxy (`/api/stream/cert-hash` in `server.rs`) gates `danger_accept_invalid_certs` with `closed_network_host()` — self-signed acceptance only for loopback/private/link-local IPs, dotless hostnames, and `.local`/`.lan`/`.internal` names; public hosts require PKI-valid certs. Preserve this if you touch the proxy.

## Submitting changes

PR against `main`. Ensure `cargo check` passes from `slopshady/`. Describe verification (no CI to fall back on).
- A `vendor/WebSRT/` submodule bump needs no extra step — `build.rs` rebuilds WASM on the next `cargo build`. Nothing under `static/wasm/` is committed (gitignored).

