# Third-Party Licenses

SlopShady is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-or-later). The following third-party libraries are included in or referenced by this repository:

## Bundled with the frontend (`static/lib/`)

| Library | License | Source |
|---------|---------|--------|
| [Webamp](https://webamp.org/) | MIT | Browser-based Winamp clone |
| [Butterchurn](https://github.com/jberg/butterchurn) | MIT | Milkdrop visualizer renderer for WebGL |
| [Butterchurn Presets](https://github.com/jberg/butterchurn-presets) | MIT | Milkdrop preset collections (base + extra) |
| [LiteGraph.js](https://github.com/jagenjo/litegraph.js) | MIT | Node graph editor |

These are vendored as minified bundles in `static/lib/`. Do not hand-edit them.

## Git submodule

| Library | License | Source | Usage |
|---------|---------|--------|-------|
| [QuicSRT-wasm](https://github.com/maxolgi/QuicSRT-wasm) | MPL-2.0 | Browser engine (SRT receiver + TS demux/mux) | Builds the emcc engine module + JS wrappers staged under `static/vendor/QuicSRT-wasm/` (built by `build.rs`). Embeds [libquicsrt](https://github.com/maxolgi/libquicsrt) (MPL-2.0), which pins a fork of [srt](https://github.com/maxolgi/srt) (MPL-2.0 / Apache-2.0) as a nested submodule |

### MPL-2.0 source-availability notice (QuicSRT engine artifacts)

The compiled engine module under `static/vendor/QuicSRT-wasm/build/`
(`srt_engine.mjs` + `srt_engine.wasm`) is derived from MPL-2.0-licensed
source (QuicSRT-wasm, libquicsrt, and the srt fork). MPL-2.0 §3.2 requires
that the corresponding source be made available. The SlopShady source tree
satisfies this obligation via the `vendor/QuicSRT-wasm/` git submodule and
its nested `deps/libquicsrt` / `deps/srt` submodules, which contain the
full source at the pinned commits. `build.rs` reproduces the artifacts from
that source by invoking `emcmake`/`cmake`/`em++` directly.
`static/vendor/QuicSRT-wasm/` is gitignored and regenerated on demand; to
build manually:

```bash
git submodule update --init vendor/QuicSRT-wasm   # populate the engine sources
git -C vendor/QuicSRT-wasm submodule update --init deps/libquicsrt
git -C vendor/QuicSRT-wasm/deps/libquicsrt submodule update --init deps/srt
cargo build                                       # build.rs links the engine
```

MPL-2.0 §3.3 permits combining MPL-licensed code with AGPL-3.0-covered
code: the combined work may be distributed under AGPL-3.0, while individual
MPL-licensed files (the QuicSRT-wasm / libquicsrt / srt sources) remain
under MPL-2.0. The engine module is served to the browser as a separate
asset and is not linked into the Rust binary.
