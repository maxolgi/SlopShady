# Phase 3 — Complete WebSRT Reception Integration

## Context

SlopShady is the showcase app for the WebSRT library (which the user also
wrote). The publishing path (browser → gateway) has worked for a while.
The reception path (gateway → browser) also worked, but with a hand-rolled
demuxer and decoder in `stream-input-worker.js`.

The migration goal: stop reimplementing WebSRT's demuxer + decoder in
SlopShady and instead **import them from the upstream `vendor/WebSRT/`
submodule**. This required introducing TypeScript support (the build
pipeline restructure: `src/js/` migration, `tsconfig.{json,emit.json,
vendor.json}`, `build.rs` rewrite). All of that infrastructure is in
place and works.

The migration is half-done:
- ✓ Decoder: `stream-input-worker.ts` imports `VideoPipeline`,
  `OpusAudioPipeline`, `AacAudioPipeline` from upstream `decode.ts`.
- ✗ Demuxer: `stream-input-worker.ts` still uses the raw
  `mpeg2ts_wasm.js` `TsDemuxer` directly with hand-rolled event dispatch,
  dropping `kind=3` (random_access) and `kind=4` (error) events.
- ✗ `tsconfig.vendor.json` explicitly **excludes** `demux.ts` from
  compilation, blocking the integration goal.

Plus several smaller bugs found during investigation (see Steps 2–4).

## Goal

SlopShady's reception worker uses upstream WebSRT's `Demuxer` class
(not raw `TsDemuxer`), and the upstream import is fully type-checked
(no `@ts-ignore`). Both publish and receive paths work at runtime.

## Success criteria

1. `cargo build` from `slopshady/` succeeds.
2. `npx tsc -p tsconfig.{json,emit.json,vendor.json} --noEmit` all clean.
3. `static/vendor/WebSRT/web/src/demux.js` exists in build output.
4. No `@ts-ignore` on upstream imports (types flow through).
5. Runtime: configure WebSRT input, route layer, video renders + audio
   plays (manual verification by user).
6. Demuxer errors visible in UI (not silently dropped).
7. Layer volume slider respects non-1.0 values when unmuted.
8. Background-tab throttle does not stall SRT state machine.

## Out of scope (deferred)

- **Publish-side scope creep** in `streaming.js` (+124/−6: CBR toggle,
  flow-control credits, HW-first/SW-fallback codec probe) and
  `keyboard.js` (`Ctrl+Shift+S` rebind). Unrelated to reception; should
  be split into a follow-up "publish-path robustness" PR. Not touched
  here.
- **Upstream `Demuxer.dispatch()` leak.** `vendor/WebSRT/web/src/demux.ts`
  iterates `TsEvent`s without calling `e.free()`, leaking the WASM heap
  one event at a time. This is an upstream library bug (it affects
  upstream's own viewer too). File separately on the WebSRT repo; do
  not patch from SlopShady.

## Steps

### Step 1 — Use upstream `Demuxer` (THE integration goal)
**Files**: `src/js/features/stream-input-worker.ts`, `tsconfig.vendor.json`

- Remove raw-WASM imports:
  ```ts
  // delete:
  import initDemux, { TsDemuxer } from '/wasm/mpeg2ts-wasm/mpeg2ts_wasm.js';
  import type { TsEvent } from '/wasm/mpeg2ts-wasm/mpeg2ts_wasm.js';
  ```
- Add upstream import:
  ```ts
  import { Demuxer } from '/static/vendor/WebSRT/web/src/demux.js';
  ```
- `init` handler: `demuxer = await Demuxer.create({ onPmt, onPes, onError })`
  (async — currently `new TsDemuxer()` is sync).
- Replace `feedTs()` + `handlePmt()` + `handlePes()` with callback bodies.
  PMT routing logic (which PID is video/audio, codec label resolution)
  stays — that's SlopShady's glue. Just delete the manual `kind===1/2`
  dispatch + manual `pmtEntries()`/`pmtFormatIds()` extraction.
- `onError` callback → `postLog('demux err: ' + msg)` +
  `postDecoderError('demux', msg)`. Fixes silent drop of `kind=4`.
- `tsconfig.vendor.json`: remove `"vendor/WebSRT/web/src/demux.ts"` from
  `exclude`.

**Verify**: `cargo build` emits `static/vendor/WebSRT/web/src/demux.js`.

### Step 2 — Fix `tick` loop (HIGH bug)
**File**: `src/js/ui/streaming-input.ts`

Reception worker's `tick` handler is dead code — main coordinator has
the `_antiThrottle` oscillator but no rAF loop posting `{type:'tick'}`.
Background-tab throttling will starve the SRT poll loop → late ACK/NAK
→ retransmit storms. Publishing side gets this right (`streaming.js:562`).

- In `_connect`, after `worker.postMessage({ type: 'init', ... })`, start
  a rAF loop that posts `{type:'tick'}` to the worker ~60Hz while
  `entry.worker` is alive.
- Cancel the rAF in `_disconnect` and `_abortConnect`.

**Verify**: `grep "type:'tick'" src/js/ui/streaming-input.ts` returns
at least one site.

### Step 3 — Fix layer mute/volume ordering (MEDIUM bug)
**File**: `src/js/ui/streaming-input.ts`

`setLayerMute` (line 227) resets gain to hardcoded `1.0` on unmute,
ignoring the layer's actual volume. `setLayerVolume` is mute-aware but
`layerMixer.js` calls them in the wrong order (volume then mute) in
`_onWebSRTInputSelect` and `_changeLayerType` → gain stuck at `1.0`
when layer has `audioMuted: false, volume: 0.5`.

- Make `setLayerMute` volume-aware: cache last-applied volume per
  `(inputIdx, layerIdx)` (a new `Map<number, number>` on `InputEntry`),
  restore it on unmute instead of hardcoded `1.0`.

**Verify**: route a layer with `volume=0.5, audioMuted=false`; gain
node value = 0.5 not 1.0 (use Web Audio inspector).

### Step 4 — Commit missing WASM artifacts (MEDIUM)
**Cmd**: `git add static/wasm/mpeg2ts-wasm/`

`srt-wasm` and `ts-muxer-wasm` are tracked; `mpeg2ts-wasm` was missed.
Fresh clones currently 404 on `/wasm/mpeg2ts-wasm/mpeg2ts_wasm.js`.

**Verify**: `git ls-files static/wasm/mpeg2ts-wasm/` lists 6 files.

### Step 5 — Drop `@ts-ignore`, restore type checking
**Files**: `tsconfig.vendor.json`, `slopshady/build.rs`,
`tsconfig.emit.json`, `src/js/features/stream-input-worker.ts`

Currently the upstream decode import is `@ts-ignore`'d, so every
method call on `VideoPipeline`/`OpusAudioPipeline`/`AacAudioPipeline`
is `any`. If upstream renames a method in a submodule bump, tsc won't
catch it.

- `tsconfig.vendor.json`: add `"declaration": true` so vendor emit
  produces `.d.ts` files alongside the `.js`.
- `slopshady/build.rs`: reorder so vendor tsc runs BEFORE SlopShady
  tsc, so the `.d.ts` files exist when slopshady compiles.
- `tsconfig.emit.json`: add `paths` mapping:
  `"/static/vendor/WebSRT/web/src/*": ["static/vendor/WebSRT/web/src/*"]`
- `src/js/features/stream-input-worker.ts`: remove the `@ts-ignore`
  block (lines 39–43).

**Verify**: temporarily rename an upstream method call (typo) in the
worker; `npx tsc -p tsconfig.emit.json --noEmit` catches it; revert.

### Step 6 — Cleanup (OPTIONAL, no behavior change)
**Files**: `src/js/features/stream-input-worker.ts`, `src/js/webgl/layers.js`

- Replace 13× `(self as unknown as Worker).postMessage(...)` with bare
  `postMessage(...)` (matches publishing worker style).
- Remove dead `counters.chunksFed` / `counters.audioChunksFed` fields
  (never incremented; `??` fallbacks in `emitStats` are dead).
- `webgl/layers.js`: fix `frame.codedWidth?.[0]` →
  `frame.codedWidth || frame.displayWidth || entry.w` (`codedWidth` is
  a number per WebCodecs spec, not an array).

### Step 7 — DEFERRED: Split publish-side scope creep
See "Out of scope" above. Not done in this pass.

### Step 8 — Doc updates
**Files**: `THIRD_PARTY_LICENSES.md`, `CONTRIBUTING.md`, `AGENTS.md`,
`README.md`

Update stale `static/js/lib/` references → `static/lib/` in 8 places
(the rename was functional but docs weren't updated).

### Step 9 — Manual smoke test (user)
- `cargo build --release` from `slopshady/`.
- Start WebSRT gateway + ffmpeg/OBS streamer on LAN.
- Configure SlopShady input, route a layer, verify:
  - Video renders
  - Audio plays
  - Background-tab doesn't kill stream
  - Demuxer errors show if stream is malformed
