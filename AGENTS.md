# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---
Never revove these guidelines, only edit below.
---

# SlopShady — repo-specific guidance

Rust backend (`slopshady/`, axum + tokio) + TypeScript/JavaScript frontend embedded into the binary at compile time via `rust-embed`. Single binary at runtime; Node + `npm` are contributor-time only (for `tsc`). See `CONTRIBUTING.md` for full build/conventions; `README.md` for feature/uniform reference; `SECURITY.md` for caveats.

## WebSRT submodule: bump-first rule (READ THIS FIRST)

`vendor/WebSRT/` is a git submodule pinned to ONE commit. It goes stale. The
user iterates on WebSRT constantly and runs builds newer than this pin, so the
tree you can read is frequently behind what the user actually runs.

Why the frequent bumps: SlopShady and WebSRT are developed in lockstep right now.
The user tests them together while making many WebSRT changes, so the pin is kept
synced to latest origin/master to avoid confusion (stale vendored code ≠ what the
user actually runs). This should taper off once WebSRT stabilizes; until then,
bump readily and commit the pin advance as a normal step (see "Pulling WebSRT
changes").

Before reasoning about anything under `vendor/WebSRT/` — gateway, SRT,
WebTransport, the three WASM crates, or the `web/` frontend — bump:

    git submodule update --remote vendor/WebSRT   # advance working tree to latest origin/master
    ( cd slopshady && cargo build )               # rebuilds stale WASM via build.rs

Bump when (non-exhaustive — when in doubt, bump):
- The user reports behavior in WebSRT, the gateway, SRT/WebTransport, WASM, or the `web/` UI.
- You cannot find a file/module/path under `vendor/WebSRT/` that the user references.
- You are about to cite `vendor/WebSRT/` line numbers or claim "the vendored version does/doesn't X."

Never conclude "this is old / not implemented" from a stale tree. Bump, re-read,
then reason. Advancing the working tree is free and non-destructive; it only
moves the checkout forward. Committing the advanced pin is a separate, intentional
step (see "Pulling WebSRT changes" below) — agents commit bumps, never push.

Verify: `git -C vendor/WebSRT log --oneline -1` shows a recent commit and the
file/module you were missing now exists.

**Never edit files under `vendor/WebSRT/`.** It is the upstream WebSRT library,
vendored read-only via submodule — SlopShady consumes it (WASM + web assets), it
does not own it. The only intended mutation of that working tree is bumping the
pin (`git submodule update --remote`); never modify, create, or delete source
files there.

A change requested in SlopShady is solved **in SlopShady** (`src/js/`,
`slopshady/src/*.rs`, static assets). If you conclude the real fix must live in
WebSRT, stop — that is the boundary. Do not edit the library to resolve a
SlopShady-side request. Describe the exact WebSRT edit to the user verbatim
(file, lines, diff); the user applies it in WebSRT (commit + push), then you bump
the pin here.

## Source layout

- **`src/js/`** — frontend source (`.ts` for new files; `.js` for legacy files migrated opportunistically). This is what you edit.
- **`static/js/`** — build output, gitignored. Regenerated from `src/js/` by `slopshady/build.rs` on every `cargo build`. **Do not edit.**
- **`static/{css,wasm,lib,content,*.html}`** — static assets, served as-is.
- **`src/types/`** — TypeScript ambient declarations for vendored globals (`litegraph`, `butterchurn`, `webamp`) and AudioWorklet processor globals not in `lib.dom.d.ts`.

## Build & run

One-time setup (after clone or submodule bump):

```bash
git submodule update --init --recursive
npm install                          # installs typescript dev dependency
cargo install wasm-pack             # required — build.rs builds WASM on demand
rustup target add wasm32-unknown-unknown   # required by wasm-pack
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
1. Builds the three WebSRT WASM crates into `static/wasm/` if missing or stale (invoking `wasm-pack` directly; gated on an mtime check so untouched builds skip the ~8s wasm-pack overhead).
2. Mirrors `src/js/**/*.{js,mjs}` to `static/js/` byte-for-byte (preserves hand-formatted source — tsc's printer reformats, so we bypass it for `.js`).
3. If any `.ts` files exist under `src/js/`, invokes `tsc` to compile them into `static/js/`.

For live-edit iteration, run `npm run watch` in a second terminal — `tsc --watch` recompiles changed `.ts` files in <500ms. You still need `cargo build` to re-embed into the binary (or touch any `.rs` file).

### TypeScript conventions

- **New files are `.ts`.** Existing `.js` files stay `.js` until touched for other reasons — migrate opportunistically, one file per PR.
- **Import specifiers must use `.js` extension** even in `.ts` files (`moduleResolution: "Bundler"` resolves `./foo.js` to `./foo.ts` source). This keeps emitted output stable.
- **`tsconfig.json`** is at the repo root. `allowJs: true, checkJs: false` — existing JS works as-is; new TS gets full type-checking.
- **Vendored globals** (`LiteGraph`, `butterchurn`, `Webamp`) are typed as `any` in `src/types/*.d.ts` for now. Tightening is a follow-up.
- **Workers / AudioWorklet** use the same `tsconfig` — `lib` includes both `DOM` and `WebWorker`. The AudioWorklet processor globals (`AudioWorkletProcessor`, `registerProcessor`, `currentFrame`, `sampleRate`) come from `src/types/audioworklet-globals.d.ts`.
- **WASM imports** use absolute specifiers like `'/wasm/srt-wasm/srt_wasm.js'` — `tsconfig.paths` maps these to `static/wasm/*` so tsc resolves the `.d.ts` emitted by wasm-pack.

### WebSRT WASM crates

`srt-wasm`, `ts-muxer-wasm`, and `mpeg2ts-wasm` are built from the `vendor/WebSRT/` submodule. `build.rs` rebuilds them automatically when the artifacts under `static/wasm/` are missing or older than the crate sources — no manual step required. `static/wasm/` is gitignored (regenerated, not committed). You can force a rebuild anytime by deleting `static/wasm/`. (`scripts/build-wasm.sh` has been removed; `build.rs` now invokes `wasm-pack` directly, so no shell is required on any platform.)

Requires `wasm-pack` (`cargo install wasm-pack`) and the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`). Output is byte-stable for a given toolchain version.

### WebSRT dependency tree (three layers of pinning)

1. **`vendor/WebSRT/` is a git submodule.** SlopShady's git records the exact WebSRT commit (the `gitlink` entry). This is the only layer SlopShady ever touches.
2. **`srt-protocol` and `mpeg2ts` are git deps** wired via `[patch.crates-io]` in `vendor/WebSRT/Cargo.toml` (~lines 43–45), pointing at the forks `github.com/maxolgi/srt-rs` and `github.com/maxolgi/mpeg2ts`. **Neither has a `rev` pin** — they track the default branch. Despite the `git+https` form, they are **not submodules**; Cargo fetches them into its registry cache on demand.
3. **The exact rev used at build is frozen in `vendor/WebSRT/Cargo.lock`.** The lock lives inside the submodule, so advancing a dep rev (`cargo update -p srt-protocol`) is a **WebSRT-repo operation**, not a SlopShady one. Do it when working in WebSRT, commit + push there, then pull the result into SlopShady via the bump below.

#### Pulling WebSRT changes (the only SlopShady-side operation)

Whether WebSRT itself changed or its `srt-rs`/`mpeg2ts` deps moved, the SlopShady-side step is identical — bump the submodule pin:

```bash
git submodule update --remote vendor/WebSRT      # advance the pin to latest origin/master
cargo build                                      # build.rs rebuilds stale WASM
git add vendor/WebSRT && git commit -m "chore(websrt): bump submodule"
```

That's it. Never `cd vendor/WebSRT` to commit from the SlopShady side — that crosses the submodule boundary and creates orphaned local commits that don't survive a future `git submodule update`. Dep-rev bumps belong in the WebSRT repo.

**Commit posture:** committing in SlopShady is expected as part of normal work —
you do not need to ask first. This covers the bump commit above and your own
completed change units. (This overrides the generic "never commit unless asked"
for this repo.) You never commit in WebSRT — but since you never modify WebSRT
either, that side never arises.

- Default port `8100`, OSC UDP `0.0.0.0:8101`, `--data-dir` defaults to `.` (CWD). `shaders.json`, `cert.pem`, `key.pem` are written into `--data-dir` and are gitignored.
- Two Cargo features: `gui` (default; egui control panel via `eframe`) vs no-default-features (HTTPS server only, no GUI compiled in). MIDI runs in the browser regardless.
- Linux `gui` builds need an OpenGL stack (eframe `glow` backend); no `libgtk-3-dev`/`libwebkit2gtk` needed.

### Non-obvious build quirks

- **`build.rs` runs on every `cargo build`.** It mirrors `src/js/` → `static/js/` before `rust-embed` evaluates. Editing under `src/js/` triggers `cargo:rerun-if-changed`, so cargo rebuilds automatically.
- **Static-only edits DO re-embed now** (Phase 1 change) — `build.rs` reruns on any `src/js/` change, which forces rust-embed to re-evaluate. The old "touch a `.rs` file" workaround is no longer needed.
- **No live-reload.** Frontend changes still need `cargo build` + restart. `tsc --watch` only speeds up the TS compilation half.

## Verification

**There is no test suite, linter, formatter, or CI.** No `rustfmt.toml`/`clippy.toml` — match surrounding style.

- `cargo check` from `slopshady/` (must pass before submitting).
- Run the release binary and exercise the affected feature in the UI.
- `cargo test` from `slopshady-native/` only applies to the native port (see below).

## Repo shape gotchas

- **`slopshady-native/`, `oneamp/`, and `projectm/` are referenced extensively in README/CONTRIBUTING but DO NOT exist in this repo** (no `.gitmodules`). This is the backend repo only. Ignore native-port instructions here.
- Backend is Rust only — there is no `server.py` or Node server.
- `static/lib/` (butterchurn, litegraph, webamp) is vendored and minified. **Do not hand-edit.**
- **`vendor/WebSRT/` is a git submodule** (github.com/maxolgi/WebSRT) — source for the three WASM crates. `build.rs` rebuilds them into `static/wasm/` automatically; do not hand-edit `static/wasm/{srt-wasm,ts-muxer-wasm,mpeg2ts-wasm}/` (gitignored, regenerated). The submodule pins a specific commit for reproducibility, but bumping is a normal operation: `git submodule update` + `cargo build`. The `srt-protocol` + `mpeg2ts` forks are wired via `[patch.crates-io]` inside the submodule workspace — **no `rev` pin** (track default branch); the exact built rev is frozen in `vendor/WebSRT/Cargo.lock`. See the "WebSRT dependency tree" section above for the full bump workflow.
- `static/wasm/` is regenerated by `build.rs` (invokes `wasm-pack` directly; gitignored).
- Entry points: `slopshady/src/main.rs` (CLI, server/gui startup), `gui.rs` (egui control panel: Start/Stop/Open Browser), `server.rs` (axum router + `#[folder = "../static/"]` embed), `ws.rs` (WebSocket state sync + `PERSIST_KEYS`), `llm.rs` (LLM proxy + `validate_lm_url`), `live_tuning.rs` (server-side tuning loop), `osc.rs` (UDP OSC bridge), `state.rs` (load/save/normalize). Frontend entry: `static/js/main.js`.

## Frontend conventions (`static/js/`, `static/css/`)

- ES6 modules with relative paths. No framework. `camelCase` for vars/funcs; `PascalCase` for module singletons (`WebGL`, `MIDISystem`). Each module exports a singleton or `init()` wired in `main.js`.
- **All CSS lives in `static/css/`. No inline styles.** Move any inline styles you find.
- **Reuse existing UI patterns** — do not invent new classes/wrappers: `.dropdown`, `.tool-btn` / `.tool-grid` / `.tool-group`, `.panel-section` + `.content-title`, `.slider`, `.knob-group` + `.knob`, `.toggle-group` + `.toggle`.
- **Every interactive UI element MUST have a tooltip — no exceptions.** Add a key to `T` in `static/js/ui/tooltips.js`; for static HTML also add to `STATIC_MAP`; for dynamic markup use `ti('KEY', {n})`. Parameterized tooltips use `{n}` for the layer/control index.

## Shader / uniform constraints

- **NOT implemented** despite appearing in help text or Shadertoy examples — shaders using these will fail to compile: `iMouse`, `iFrame`, `iTimeDelta`, `iFrameRate`, `iSampleRate`, `iDate`, `gl_FragColor` (use `fragColor`).
- Implemented: `iTime`, `iResolution`, `iVideo`, `iScreen`, `fragColor`, `gl_FragCoord`, `u_audioWaveform`, `u_audioSpectrum`, layer params (`u_brightness`, `u_posX`, …), voice uniforms.
- Code dials: numeric literals extracted into `u_param_cd0`..`u_param_cd25` (max 26). **Common constants** (`0`, `1`, `2`, `π`, `2π`, etc., per `COMMON_CONSTANTS` in `config.js`) **are NOT extracted**; nor are `const` values, loop bounds, array sizes, preprocessor lines, or GLSL keywords/built-in function names.
- WebGL2 context uses `preserveDrawingBuffer: false`; screenshots use a deferred-capture pattern (`state.capturePending`) inside the render loop, not the drawing buffer.
- **Layer 0 = "Main".** On `shaderCode` updates the value is mirrored into `layers[0].material.source` in `ws.rs` — keep in sync if you touch layer 0. There are 8 layers (indices 0–7).

## Security constraints

- `bearerKey` (LLM API credential) is forwarded to the upstream OpenAI-compatible endpoint and **included in plaintext in full-state JSON exports** (`Ctrl+S` / "Save to JSON"). It is NOT written to `shaders.json` (not in `PERSIST_KEYS`) and never committed. Shaders-only exports omit it.
- HTTPS server binds `0.0.0.0:8100`, OSC binds `0.0.0.0:8101` — reachable on the LAN, **no auth** (single-user local by design). Self-signed cert generated into `--data-dir` on first run; the GUI launches the web app in the system browser, which shows the usual self-signed cert warning (no TLS bypass — accept it once).
- LLM endpoint URL is validated to reject non-`http`/`https` schemes (`validate_lm_url` in `llm.rs`) — preserve this if you touch the proxy.

## Submitting changes

PR against `main`. Ensure `cargo check` passes from `slopshady/`. Describe verification (no CI to fall back on).
- A `vendor/WebSRT/` submodule bump needs no extra step — `build.rs` rebuilds WASM on the next `cargo build`. Nothing under `static/wasm/` is committed (gitignored).

