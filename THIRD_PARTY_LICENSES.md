# Third-Party Licenses

SlopShady is licensed under the [MIT License](LICENSE). The following third-party libraries are included in or referenced by this repository:

## Bundled with the webview frontend (`static/js/lib/`)

| Library | License | Source |
|---------|---------|--------|
| [Webamp](https://webamp.org/) | MIT | Browser-based Winamp clone |
| [Butterchurn](https://github.com/niclas-niclas/butterchurn) | MIT | Milkdrop visualizer renderer for WebGL |
| [LiteGraph.js](https://github.com/jagenjo/litegraph.js) | MIT | Node graph editor |

These are vendored as minified bundles in `static/js/lib/`. Do not hand-edit them.

## Vendored fork (`slopshady/patches/wry/`)

| Library | License | Source |
|---------|---------|--------|
| [wry](https://github.com/tauri-apps/wry) | Apache-2.0 OR MIT | WebView wrapper (locally patched: TLS-ignore + Windows WebView2 shutdown) |

This is a full source copy with local modifications, wired via `[patch.crates-io]` in `slopshady/Cargo.toml`. Must not be upgraded or removed.

## Git submodules

| Library | License | Source | Usage |
|---------|---------|--------|-------|
| [oneamp](https://github.com/all3f0r1/oneamp) | MIT OR Apache-2.0 | Audio player | Native port audio playback (`slopshady-native` path dependency) |
| [projectM](https://github.com/projectM-Visualizer/projectm) | LGPL-2.1 | Music visualizer | Native port Milkdrop integration (dynamically linked via `projectm-install/`) |
| [projectm-presets](https://github.com/projectM-Visualizer/presets-cream-of-the-crop) | See repo | Milkdrop presets | Preset library for projectM |
| [projectm-textures](https://github.com/projectM-Visualizer/presets-milkdrop-texture-pack) | See repo | Milkdrop textures | Texture pack for projectM presets |

### LGPL-2.1 Note (projectM)

projectM is licensed under the GNU Lesser General Public License v2.1. It is **dynamically linked** (via `projectM-4.dll` / `libprojectM.so`) — not statically linked — into the native port binary. This means:

- You can use SlopShady (MIT-licensed) with projectM under the LGPL-2.1 terms without your application being covered by the LGPL.
- Modifications to projectM itself must be released under LGPL-2.1.
- Source code for projectM is available in the `projectm/` submodule.
