# Third-Party Licenses

SlopShady is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-or-later). The following third-party libraries are included in or referenced by this repository:

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

### MPL-2.0 source-availability notice (WebSRT WASM artifacts)

The compiled WASM blobs under `static/wasm/{srt-wasm,ts-muxer-wasm,mpeg2ts-wasm}/`
are derived from MPL-2.0-licensed source. MPL-2.0 §3.2 requires that the
corresponding source be made available. The SlopShady source tree satisfies
this obligation via the `vendor/WebSRT/` git submodule, which contains the
full WebSRT source at the pinned commit, plus `scripts/build-wasm.sh` which
reproduces the committed artifacts byte-for-byte from that source. To rebuild:

```bash
git submodule update --init --recursive   # populate vendor/WebSRT/
./scripts/build-wasm.sh                   # wasm-pack builds all three crates
```

MPL-2.0 §3.3 permits combining MPL-licensed code with AGPL-3.0-covered
code: the combined work may be distributed under AGPL-3.0, while individual
MPL-licensed files (the WebSRT source) remain under MPL-2.0. The WASM
modules are served to the browser as separate assets and are not linked
into the Rust binary.
