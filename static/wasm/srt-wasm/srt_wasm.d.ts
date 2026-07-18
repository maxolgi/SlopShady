/* tslint:disable */
/* eslint-disable */

/**
 * An action JS must take.
 */
export class SrtAction {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    takeData(): Uint8Array;
    readonly data: Uint8Array;
    /**
     * 0 = SendDatagram, 1 = DeliverMessage, 2 = HandshakeComplete,
     * 3 = WaitForData, 4 = Close, 5 = Log.
     */
    readonly kind: number;
    readonly text: string;
    readonly wait_ms: number;
}

/**
 * Browser-side SRT receiver.
 */
export class SrtReceiver {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Latest SRT socket statistics.
     */
    getStats(): SrtStats;
    /**
     * Feed an incoming WebTransport datagram (raw SRT packet bytes).
     * Returns actions JS should perform: send datagrams, deliver messages, etc.
     */
    handle_datagram(bytes: Uint8Array, now_us: number): SrtAction[];
    /**
     * True if the peer shut down or the connection errored out.
     */
    isClosed(): boolean;
    /**
     * True once the HSv5 handshake has completed and data plane is running.
     */
    isHandshakeComplete(): boolean;
    /**
     * Construct a fresh receiver. Local socket id is randomized internally.
     */
    constructor();
    /**
     * Construct with a custom TSBPD latency (milliseconds).
     */
    static newWithLatency(latency_ms: number): SrtReceiver;
    /**
     * `seed` reserved for deterministic local_sockid assignment in tests.
     * (For now we just use ConnInitSettings::default which calls OsRng via rand.)
     */
    static newWithSeed(_seed: number): SrtReceiver;
    /**
     * Periodic tick. JS calls this every ~10ms (setTimeout) to advance the
     * state machine even when no datagrams arrive.
     */
    poll(now_us: number): SrtAction[];
    /**
     * Feed upstream TS data into the SRT sender half of the DuplexConnection.
     * Returns actions (SendDatagram with data packets, etc.) that JS must process.
     * No-op if the handshake hasn't completed yet.
     */
    sendMessage(bytes: Uint8Array, now_us: number): SrtAction[];
}

export class SrtStats {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly bandwidthBps: number;
    readonly elapsedMs: number;
    readonly rttMs: number;
    readonly rxAck: number;
    readonly rxBelated: number;
    readonly rxBuffered: number;
    readonly rxBytes: number;
    readonly rxData: number;
    readonly rxDropped: number;
    readonly rxLoss: number;
    readonly rxNak: number;
    readonly rxRetransmit: number;
    readonly txBuffered: number;
    readonly txBytes: number;
    readonly txData: number;
    readonly txLoss: number;
    readonly txRetransmit: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_srtaction_free: (a: number, b: number) => void;
    readonly __wbg_srtreceiver_free: (a: number, b: number) => void;
    readonly __wbg_srtstats_free: (a: number, b: number) => void;
    readonly srtaction_data: (a: number) => [number, number];
    readonly srtaction_kind: (a: number) => number;
    readonly srtaction_takeData: (a: number) => [number, number];
    readonly srtaction_text: (a: number) => [number, number];
    readonly srtaction_wait_ms: (a: number) => number;
    readonly srtreceiver_getStats: (a: number) => number;
    readonly srtreceiver_handle_datagram: (a: number, b: number, c: number, d: number) => [number, number];
    readonly srtreceiver_isClosed: (a: number) => number;
    readonly srtreceiver_isHandshakeComplete: (a: number) => number;
    readonly srtreceiver_new: () => number;
    readonly srtreceiver_newWithLatency: (a: number) => number;
    readonly srtreceiver_newWithSeed: (a: number) => number;
    readonly srtreceiver_poll: (a: number, b: number) => [number, number];
    readonly srtreceiver_sendMessage: (a: number, b: number, c: number, d: number) => [number, number];
    readonly srtstats_bandwidthBps: (a: number) => number;
    readonly srtstats_rttMs: (a: number) => number;
    readonly srtstats_rxAck: (a: number) => number;
    readonly srtstats_rxBelated: (a: number) => number;
    readonly srtstats_rxBuffered: (a: number) => number;
    readonly srtstats_rxBytes: (a: number) => number;
    readonly srtstats_rxData: (a: number) => number;
    readonly srtstats_rxDropped: (a: number) => number;
    readonly srtstats_rxLoss: (a: number) => number;
    readonly srtstats_rxNak: (a: number) => number;
    readonly srtstats_rxRetransmit: (a: number) => number;
    readonly srtstats_txBuffered: (a: number) => number;
    readonly srtstats_txBytes: (a: number) => number;
    readonly srtstats_txData: (a: number) => number;
    readonly srtstats_txLoss: (a: number) => number;
    readonly srtstats_txRetransmit: (a: number) => number;
    readonly srtstats_elapsedMs: (a: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_drop_slice: (a: number, b: number) => void;
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
