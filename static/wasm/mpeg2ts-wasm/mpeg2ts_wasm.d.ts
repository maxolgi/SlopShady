/* tslint:disable */
/* eslint-disable */

/**
 * Flat struct-of-arrays snapshot of the demuxer's analysis state. wasm-bindgen
 * serializes parallel `Vec`s far more cheaply than nested objects, so every
 * per-PID table is laid out as `[field0_pid0, field0_pid1, …]` etc. The JS
 * consumer zips them by index.
 *
 * Field layout conventions:
 *   - `pids` is the key array for `pid_stats`; all per-PID scalar vectors
 *     (`pesCounts`, `byteTotals`, `bitratesMbps`, …) are parallel to it.
 *   - `scramblingCounts` / `afControlCounts` are flat 4×N (4 values per PID).
 *   - `nalStats` is flat 9×M (9 values per video PID: I/P/B/IDR/SPS/PPS/SEI/AUD/NonIDR).
 *   - `ringNalOffsets` has N+1 entries; packet i's NAL types are
 *     `ringNal[offsets[i] .. offsets[i+1]]`.
 */
export class DebugSnapshot {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
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

/**
 * Browser-facing demuxer.
 */
export class TsDemuxer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Snapshot the full analysis state for the debug panel. Owned by JS —
     * cheap to call every ~250ms. Iteration order is by ascending PID so the
     * flat arrays are stable across calls for the same stream.
     */
    debugSnapshot(): DebugSnapshot;
    /**
     * Feed raw TS bytes (any length). Returns events emitted during parsing.
     */
    feed(bytes: Uint8Array): TsEvent[];
    constructor();
}

/**
 * A TS event JS consumes.
 */
export class TsEvent {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * For PMT events: flat array of [pid0, stream_type0, pid1, stream_type1, ...].
     */
    pmtEntries(): Uint16Array;
    /**
     * For PMT events: per-entry registration-descriptor format identifier
     * (4-char ASCII, e.g. "AV01"/"Opus"/"HEVC"). Empty string when the entry
     * had no registration descriptor (ffmpeg/OBS AV1 + most private streams).
     */
    pmtFormatIds(): string[];
    readonly data: Uint8Array;
    readonly dts: number;
    /**
     * 0 = pat, 1 = pmt, 2 = pes, 3 = random_access, 4 = error
     */
    readonly kind: number;
    readonly pid: number;
    readonly program_num: number;
    readonly pts: number;
    readonly randomAccess: boolean;
    readonly stream_type: number;
    readonly text: string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_debugsnapshot_free: (a: number, b: number) => void;
    readonly __wbg_tsdemuxer_free: (a: number, b: number) => void;
    readonly __wbg_tsevent_free: (a: number, b: number) => void;
    readonly debugsnapshot_afControlCounts: (a: number) => [number, number];
    readonly debugsnapshot_bitratesMbps: (a: number) => [number, number];
    readonly debugsnapshot_byteTotals: (a: number) => [number, number];
    readonly debugsnapshot_ccErrors: (a: number) => [number, number];
    readonly debugsnapshot_errorMsg: (a: number) => [number, number];
    readonly debugsnapshot_errorT: (a: number) => [number, number];
    readonly debugsnapshot_lastDts: (a: number) => [number, number];
    readonly debugsnapshot_lastPts: (a: number) => [number, number];
    readonly debugsnapshot_nalPids: (a: number) => [number, number];
    readonly debugsnapshot_nalStats: (a: number) => [number, number];
    readonly debugsnapshot_pcrIntervalsMs: (a: number) => [number, number];
    readonly debugsnapshot_pcrJitterMs: (a: number) => [number, number];
    readonly debugsnapshot_pcrPids: (a: number) => [number, number];
    readonly debugsnapshot_pesCounts: (a: number) => [number, number];
    readonly debugsnapshot_pids: (a: number) => [number, number];
    readonly debugsnapshot_pmtFormatIds: (a: number) => [number, number];
    readonly debugsnapshot_pmtPid: (a: number) => number;
    readonly debugsnapshot_pmtPids: (a: number) => [number, number];
    readonly debugsnapshot_pmtStreamTypes: (a: number) => [number, number];
    readonly debugsnapshot_programNum: (a: number) => number;
    readonly debugsnapshot_ptsJumps: (a: number) => [number, number];
    readonly debugsnapshot_pusiCounts: (a: number) => [number, number];
    readonly debugsnapshot_raCounts: (a: number) => [number, number];
    readonly debugsnapshot_ringDts: (a: number) => [number, number];
    readonly debugsnapshot_ringKind: (a: number) => [number, number];
    readonly debugsnapshot_ringNal: (a: number) => [number, number];
    readonly debugsnapshot_ringNalOffsets: (a: number) => [number, number];
    readonly debugsnapshot_ringPid: (a: number) => [number, number];
    readonly debugsnapshot_ringPts: (a: number) => [number, number];
    readonly debugsnapshot_ringPusi: (a: number) => [number, number];
    readonly debugsnapshot_ringRa: (a: number) => [number, number];
    readonly debugsnapshot_ringSize: (a: number) => [number, number];
    readonly debugsnapshot_ringT: (a: number) => [number, number];
    readonly debugsnapshot_ringTei: (a: number) => [number, number];
    readonly debugsnapshot_scramblingCounts: (a: number) => [number, number];
    readonly debugsnapshot_teiCounts: (a: number) => [number, number];
    readonly tsdemuxer_debugSnapshot: (a: number) => number;
    readonly tsdemuxer_feed: (a: number, b: number, c: number) => [number, number];
    readonly tsdemuxer_new: () => number;
    readonly tsevent_data: (a: number) => [number, number];
    readonly tsevent_dts: (a: number) => number;
    readonly tsevent_kind: (a: number) => number;
    readonly tsevent_pid: (a: number) => number;
    readonly tsevent_pmtEntries: (a: number) => [number, number];
    readonly tsevent_pmtFormatIds: (a: number) => [number, number];
    readonly tsevent_program_num: (a: number) => number;
    readonly tsevent_pts: (a: number) => number;
    readonly tsevent_randomAccess: (a: number) => number;
    readonly tsevent_stream_type: (a: number) => number;
    readonly tsevent_text: (a: number) => [number, number];
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
