# Third-Party Licenses

SlopShady is licensed under the [GNU General Public License v3.0](LICENSE) (GPL-3.0-or-later). The following third-party libraries are included in or referenced by this repository:

## Bundled with the webview frontend (`static/lib/`)

| Library | License | Source |
|---------|---------|--------|
| [Webamp](https://webamp.org/) | MIT | Browser-based Winamp clone |
| [Butterchurn](https://github.com/niclas-niclas/butterchurn) | MIT | Milkdrop visualizer renderer for WebGL |
| [LiteGraph.js](https://github.com/jagenjo/litegraph.js) | MIT | Node graph editor |

These are vendored as minified bundles in `static/lib/`. Do not hand-edit them.

## Vendored fork (`slopshady/patches/wry/`)

| Library | License | Source |
|---------|---------|--------|
| [wry](https://github.com/tauri-apps/wry) | Apache-2.0 OR MIT | WebView wrapper (locally patched: TLS-ignore + Windows WebView2 shutdown) |

This is a full source copy with local modifications, wired via `[patch.crates-io]` in `slopshady/Cargo.toml`. Must not be upgraded or removed.

## Git submodule

| Library | License | Source | Usage |
|---------|---------|--------|-------|
| [WebSRT](https://github.com/maxolgi/WebSRT) | MPL-2.0 | Browser SRT sender/receiver | Builds the `srt-wasm`, `ts-muxer-wasm`, and `mpeg2ts-wasm` artifacts under `static/wasm/` (see `scripts/build-wasm.sh`) |
