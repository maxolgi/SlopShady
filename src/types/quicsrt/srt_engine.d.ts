// Type declarations for vendor/QuicSRT-wasm/js/srt_engine.js — the C++
// engine wrapper around the emcc module (harness/receiver.cpp +
// js/engine_shim.c). Emscripten emits no .d.ts (wasm-pack did), so
// SlopShady authors these; build.rs stages them next to the wrappers in
// the submodule tree (untracked there) so tsc resolves the vendored TS's
// relative '../../js/srt_engine.js' specifiers.
//
// Surface mirrors the old wasm-bindgen srt_wasm.d.ts with the deltas
// documented in the wrapper header:
//   - init() takes no module_or_path (the module URL is fixed, relative
//     to the wrapper's own location)
//   - sendMessage returns the C ABI int, not SrtAction[]: >0 bytes
//     accepted (resume from offset), 0 empty, -1 send buffer full,
//     -2 closed, -3 not handshaked, -4 invalid, -5 error
//   - actions/stats are plain JS objects (free() is a no-op)

/** An action JS must take (plain object in the C++ engine). */
export declare class SrtAction {
    free(): void;
    takeData(): Uint8Array;
    readonly data: Uint8Array | null;
    /** 0 = SendDatagram, 1 = DeliverMessage, 2 = HandshakeComplete, 3 = WaitForData, 4 = Close, 5 = Log. */
    readonly kind: number;
    /** Deliver actions only: TSBPD release deadline in µs since the receiver epoch (0.0 in the C++ engine — release happens inside srt). */
    readonly schedUs: number;
    readonly text: string;
    readonly wait_ms: number;
}

/** Latest SRT socket statistics (plain object; pre-connection all zeros). */
export declare class SrtStats {
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

/** Browser-side SRT receiver over the C++ engine. */
export declare class SrtReceiver {
    free(): void;
    getStats(): SrtStats;
    /** Feed an incoming WebTransport datagram; returns actions JS must perform. now_us is accepted but ignored (engine keeps real clocks on its pthreads). */
    handle_datagram(bytes: Uint8Array, now_us: number): SrtAction[];
    isClosed(): boolean;
    isHandshakeComplete(): boolean;
    static newWithLatency(latency_ms: number): SrtReceiver;
    static newWithLatencyAndRtt(latency_ms: number, initial_rtt_ms: number): SrtReceiver;
    /** Periodic tick. now_us accepted but ignored. */
    poll(now_us: number): SrtAction[];
    /**
     * Feed upstream TS into the SRT sender half. Returns the C ABI int:
     * >0 bytes accepted (possibly partial — resume from that offset),
     * 0 empty buffer, -1 send buffer full until timeout_ms, -2 closed,
     * -3 not handshaked, -4 invalid arg, -5 error. The engine frames the
     * buffer itself; fragmented packets surface as kind-0 actions on the
     * next handle_datagram/poll drain.
     */
    sendMessage(bytes: Uint8Array, timeout_ms?: number): number;
}

/** Idempotent module load (shared with demux/muxer wrappers — one heap). */
export default function init(): Promise<unknown>;
