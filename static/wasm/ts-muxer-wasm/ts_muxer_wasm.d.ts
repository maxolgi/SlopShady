/* tslint:disable */
/* eslint-disable */

export class TsMuxer {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    poll(): Uint8Array;
    push_audio(data: Uint8Array, pts_us: number): void;
    push_video(data: Uint8Array, pts_us: number, dts_us: number, is_keyframe: boolean): void;
    setVideoCodec(codec: string): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_tsmuxer_free: (a: number, b: number) => void;
    readonly tsmuxer_new: () => number;
    readonly tsmuxer_poll: (a: number) => [number, number];
    readonly tsmuxer_push_audio: (a: number, b: number, c: number, d: number) => void;
    readonly tsmuxer_push_video: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly tsmuxer_setVideoCodec: (a: number, b: number, c: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
