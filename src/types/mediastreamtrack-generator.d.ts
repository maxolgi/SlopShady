// MediaStreamTrackGenerator (Insertable Streams / WebCodecs) — Chrome
// ships it behind no flag since 94, but TS 5.9's DOM/WebWorker libs still
// don't declare it. Ambient declaration copied from the QuicSRT-rust
// repo's web/src/wasm.d.ts (dropped from QuicSRT-wasm's page/vendor copy
// because upstream bundles with esbuild, which ignores types).
interface MediaStreamTrackGenerator extends MediaStreamTrack {
  writable: WritableStream;
}

declare var MediaStreamTrackGenerator: {
  prototype: MediaStreamTrackGenerator;
  new (init: { kind: 'audio' | 'video' }): MediaStreamTrackGenerator;
};
