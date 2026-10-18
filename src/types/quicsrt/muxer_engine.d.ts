// Type declarations for vendor/QuicSRT-wasm/js/muxer_engine.js — the C++
// muxer wrapper around the emcc module's muxer C ABI
// (harness/ts_muxer.cpp). Staged next to the wrapper by build.rs (see
// srt_engine.d.ts for the rationale). Surface mirrors the old
// wasm-bindgen ts_muxer_wasm.d.ts; poll() returns a fresh JS-owned copy
// of whole 188-byte packets.

export declare class TsMuxer {
    free(): void;
    addAudioPid(pid: number, codec: string, channel_count: number): void;
    /** Drain muxed TS packets. Returns a freshly-allocated Uint8Array each call (safe to retain). */
    poll(): Uint8Array;
    push_audio(data: Uint8Array, pts_us: number): void;
    push_pcm(samples: Float32Array, pts_us: number): void;
    /** Like push_pcm, but targets the s302m stream carrying pid (registered via addAudioPid). */
    push_pcm_pid(pid: number, samples: Float32Array, pts_us: number): void;
    push_video(data: Uint8Array, pts_us: number, dts_us: number, is_keyframe: boolean): void;
    setAudioCodec(codec: string, channel_count: number): void;
    setSparseEnabled(enabled: boolean): void;
    setSparseThreshold(ms: number): void;
    setVideoCodec(codec: string): void;
    setVideoEnabled(enabled: boolean): void;
}

/** Idempotent module load (shared with the srt/demux wrappers — one heap). */
export default function init(): Promise<unknown>;
