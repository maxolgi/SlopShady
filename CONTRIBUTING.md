# Contributing to SlopShady

Thanks for your interest in improving SlopShady! This guide covers building the project and the conventions to follow.

## Building

SlopShady is a Rust application with a vanilla-JS frontend embedded at compile time. Frontend source lives in `src/js/` (TypeScript + legacy JS); `build.rs` mirrors it to `static/js/` and embeds it into the binary. There is no Node/Python runtime dependency, but building from source needs a few one-time tools.

### Prerequisites (one-time setup)

```bash
git submodule update --init --recursive   # populate vendor/WebSRT/ (WASM crate sources)
npm install                                # installs typescript (for tsc)
cargo install wasm-pack                    # builds the three WASM crates
rustup target add wasm32-unknown-unknown   # required by wasm-pack
```

### Build

```bash
cd slopshady
cargo run                 # HTTPS :8100, opens the egui control panel (default gui build)
cargo run -- --no-gui     # server-only, don't open the control panel
cargo build --release     # optimized binary (~8-12 MB)
```

Two build configurations, switched by Cargo features:

- **Default (`gui`)**: small egui control panel (via `eframe`) — Start/Stop the HTTPS server, then **Open Browser** to open the web app in the system browser. Linux needs an OpenGL stack (eframe `glow` backend); no `libgtk-3-dev`/`libwebkit2gtk` required.
- **`--no-default-features`**: pure HTTPS server, no GUI compiled in. MIDI still works (it runs in the browser via the Web MIDI API).

### Build quirks

- **The release binary is the run target.** Verify changes with `cargo build --release` (not debug), running `target/release/slopshady`.
- **Static assets are embedded at compile time** via `rust-embed` (`#[folder = "../static/"]` in `slopshady/src/server.rs`). There is no live-reload — frontend changes need a `cargo build` + restart.
- **Frontend edits re-embed automatically.** `build.rs` emits `cargo:rerun-if-changed` for `src/js/`, so editing frontend source triggers a re-embed on the next `cargo build`. No `cargo clean` needed. (For live-edit iteration, run `npm run watch` in a second terminal — `tsc --watch` recompiles changed `.ts` files in <500ms; you still need `cargo build` to re-embed.)

## Architecture

| Component | Location | Tech |
|-----------|----------|------|
| Backend binary | `slopshady/` (Cargo crate) | Rust, axum + tokio |
| Frontend | `static/` (`slopshady.html` + `js/`, `css/`, `content/`) | Vanilla JS, ES6 modules, WebGL2 |
| Embedded assets | `slopshady/src/server.rs` (`rust-embed`, `#[folder = "../static/"]`) | compiled into the binary |
| State persistence | `shaders.json` (in `--data-dir`) | JSON file |

Rust is the only backend. There is no `server.py`.

See [README.md](README.md) for the full feature set, API endpoints, shader uniforms, and modulation system.

## Code style

### Rust
- Follow the existing module layout in `slopshady/src/`.
- No `rustfmt.toml`/`clippy.toml` is present; match surrounding style.
- Verify with `cargo check` from `slopshady/` before submitting.

### Frontend (`static/js/`)
- ES6 modules with relative paths. No framework, plain DOM.
- `camelCase` for variables and functions; `PascalCase` for module singletons (`WebGL`, `MIDISystem`).
- Each module exports a singleton or an `init()` function wired in `main.js`.
- `static/lib/` contains vendored minified bundles (butterchurn, litegraph, webamp). **Do not hand-edit these.**
- **All CSS goes in `static/css/`.** No inline styles. If you find inline styles, move them.

### UI patterns
When adding UI elements, reuse the established patterns — do not invent new ones:

- **Dropdown menus**: `.dropdown` > `.dropdown__selected.tool-btn` > `span` + `svg`, `.dropdown__menu` > `.dropdown__item`
- **Tool buttons**: `.tool-btn` inside `.tool-grid` or `.tool-group`
- **Sections**: `.panel-section` with `.content-title` and content inside
- **Sliders**: `.slider` > `.slider__header` > `.slider__label` + `.slider__value`, `.slider__track` > `.slider__fill` > `.slider__handle`
- **Knobs**: `.knob-group` > `.knob`, `.knob__label`, `.knob__value`
- **Toggles**: `.toggle-group` > `.toggle` + `.content-label`

If you're about to write a new CSS class or add a wrapper div, stop and find the existing pattern first.

## Tooltip requirement

**Every interactive UI element must have a tooltip — no exceptions.** When adding buttons/sliders/dropdowns/toggles:

1. Add a key to the `T` object in `static/js/ui/tooltips.js`.
2. Static HTML → add it to `STATIC_MAP` (selector → key).
3. Dynamically generated → add `data-tooltip` via `ti('KEY', {n})` in the template string.
4. Parameterized tooltips use `{n}` for layer/control number (see `LAYER_SOLO`, `LFO_RATE`).

## Testing

There is **no test suite, linter, or CI**. Verify changes by:

1. `cargo build --release` from `slopshady/`.
2. Run the release binary and exercise the affected feature in the UI.

## Key constraints

- **8 layers** (indices 0–7): material, blend mode, opacity, modulation matrix. Layer 0 = "Main".
- **Code dials**: numeric literals in shaders are extracted into `u_param_cdN` uniforms (max 26). Values in `COMMON_CONSTANTS` (`config.js`) are excluded (0, 1, 2, pi, etc.).
- **Implemented uniforms**: `iTime`, `iResolution`, `iVideo`, `iScreen`, `fragColor`, `gl_FragCoord`, `u_param_cdN`, layer params (`u_brightness`, `u_posX`, …), voice uniforms. `iMouse`, `iFrame`, `iTimeDelta` appear in help text but are **not implemented** — do not rely on them.
- On `shaderCode` updates, the value is mirrored into `layers[0].material.source` in `ws.rs` — keep this in sync if you touch layer 0.
- WebGL2 context uses `preserveDrawingBuffer: false`. Screenshots use a deferred-capture pattern (`state.capturePending`), not the drawing buffer.

## Submitting changes

1. Open a pull request against `main`.
2. Ensure `cargo check` passes from `slopshady/`.
