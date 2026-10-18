// Type declarations for vendor/QuicSRT-wasm/js/demux_engine.js — the C++
// demuxer wrapper around the emcc module's demux C ABI
// (harness/ts_demux.cpp + nal.cpp + aes3.cpp + meter.cpp). Staged next to
// the wrapper by build.rs (see srt_engine.d.ts for the rationale).
// Surface mirrors the old wasm-bindgen mpeg2ts_wasm.d.ts; events and
// snapshots are plain JS objects whose array getters return fresh
// JS-owned copies (free() is a no-op).

export declare class DebugSnapshot {
    free(): void;
    readonly afControlCounts: Float64Array;
    readonly bitratesMbps: Float64Array;
    readonly byteTotals: Float64Array;
    readonly ccErrors: Float64Array;
    readonly errorMsg: string[];
    readonly errorT: Float64Array;
    readonly lastDts: Float64Array;
    readonly lastPts: Float64Array;
    readonly nalPids: Uint16Array;
    readonly nalStats: Float64Array;
    readonly pcrIntervalsMs: Float64Array;
    readonly pcrJitterMs: Float64Array;
    readonly pcrPids: Uint16Array;
    readonly pesCounts: Float64Array;
    readonly pids: Uint16Array;
    readonly pmtFormatIds: string[];
    readonly pmtPid: number;
    readonly pmtPids: Uint16Array;
    readonly pmtStreamTypes: Uint8Array;
    readonly programNum: number;
    readonly ptsJumps: Float64Array;
    readonly pusiCounts: Float64Array;
    readonly raCounts: Float64Array;
    readonly ringDts: Float64Array;
    readonly ringHex: string[];
    readonly ringKind: Uint8Array;
    readonly ringNal: Uint8Array;
    readonly ringNalOffsets: Uint32Array;
    readonly ringPid: Uint16Array;
    readonly ringPts: Float64Array;
    readonly ringPusi: Uint8Array;
    readonly ringRa: Uint8Array;
    readonly ringSize: Float64Array;
    readonly ringT: Float64Array;
    readonly ringTei: Uint8Array;
    readonly scramblingCounts: Float64Array;
    readonly teiCounts: Float64Array;
}

export declare class MeterSnapshotView {
    free(): void;
    readonly channelCounts: Uint8Array;
    readonly clips: Uint32Array;
    readonly lufs: Float32Array;
    readonly peaks: Float32Array;
    readonly phase: Float32Array;
    readonly pids: Uint16Array;
    readonly rms: Float32Array;
    readonly scopeL: Float32Array;
    readonly scopeR: Float32Array;
    readonly selectedChannel: number;
    readonly selectedPid: number;
    readonly spectrum: Float32Array;
}

/** Browser-facing demuxer over the C++ engine. */
export declare class TsDemuxer {
    free(): void;
    debugSnapshot(): DebugSnapshot;
    /** Feed raw TS bytes (any length); returns events emitted during parsing. */
    feed(bytes: Uint8Array): TsEvent[];
    meter_snapshot(): MeterSnapshotView;
    setMeterSelection(pid: number, channel: number): void;
}

/** A TS event JS consumes (plain object in the C++ engine). */
export declare class TsEvent {
    free(): void;
    /** For PMT events: flat array of [pid0, stream_type0, pid1, stream_type1, ...]. */
    pmtEntries(): Uint16Array;
    /** For PMT events: per-entry registration-descriptor format id ("AV01"/"Opus"/"HEVC", or ""). */
    pmtFormatIds(): string[];
    readonly data: Uint8Array;
    readonly dts: number;
    /** 0 = pat, 1 = pmt, 2 = pes, 3 = random_access, 4 = error, 5 = pcm */
    readonly kind: number;
    readonly nalOffsets: Uint32Array;
    readonly nalTypes: Uint8Array;
    readonly pid: number;
    readonly program_num: number;
    readonly pts: number;
    readonly randomAccess: boolean;
    /** Decoded PCM samples for kind=5 events (interleaved f32). programNum carries channel_count. */
    readonly samples: Float32Array;
    readonly stream_type: number;
    readonly text: string;
}

/** Idempotent module load (shared with the srt/muxer wrappers — one heap). */
export default function init(): Promise<unknown>;
