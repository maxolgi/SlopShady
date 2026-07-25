/**
 * stream-input-worker.ts — module worker for WebSRT receiving.
 *
 * Owns the WebTransport connection directly (constructed in the worker),
 * receives SRT over datagrams, demuxes MPEG-TS via mpeg2ts-wasm, decodes
 * video + audio via WebCodecs using upstream WebSRT's VideoPipeline +
 * Opus/Aac audio pipelines, and posts transferable VideoFrame / AudioData
 * back to the main thread for layer texture upload + MediaStreamTrackGenerator
 * pacing.
 *
 * Codec correctness (AVCC length-prefixing, HEVC hvcC building, AV1 OBU
 * sequence-header handling, Opus TOC stereo detect, AAC ADTS → ASC) all
 * live in upstream `vendor/WebSRT/web/src/decode.ts` — this worker is
 * glue only.
 *
 * Message protocol (main → worker):
 *   { type:'init', url, certHash, latencyMs }  load wasm, open WebTransport, build rx+demuxer, start race loop
 *   { type:'stop' }                             tear down WT + loops, flush decoders
 *
 * Message protocol (worker → main):
 *   { type:'handshakeComplete' }            SRT handshake finished, may receive
 *   { type:'streamInfo', info }             PMT parsed: { videoPid, videoCodec, audioPid, audioCodec }
 *   { type:'videoFrame', frame }            decoded VideoFrame (transferred)
 *   { type:'audioData', data }              decoded AudioData (transferred)
 *   { type:'stats', stats }                 SrtStats snapshot + decoder counters
 *   { type:'log', msg }                     informational/log line
 *   { type:'decoderError', which, msg }     Video/AudioDecoder error (visible in UI)
 *   { type:'error', msg }                    WebTransport connect/drop failure (main reconnects)
 *   { type:'close' }                        SRT connection closed
 *   { type:'initFailed', msg }              worker WASM init failed (no retry)
 *   { type:'stopped' }                      ack of `stop` — safe to terminate
 */

import init, { SrtReceiver } from '/wasm/srt-wasm/srt_wasm.js';
import type { SrtAction } from '/wasm/srt-wasm/srt_wasm.js';
import { Demuxer } from '/static/vendor/WebSRT/web/src/demux.js';
import { VideoPipeline, OpusAudioPipeline, AacAudioPipeline } from '/static/vendor/WebSRT/web/src/decode.js';

// MPEG-TS stream types we route on.
const ST_H264 = 0x1b;
const ST_HEVC = 0x24;
const ST_AAC = 0x0f;
const ST_PRIVATE = 0x06; // Opus or AV1; disambiguate via registration descriptor

type VideoCodecLabel = 'h264' | 'hevc' | 'av1' | null;
type AudioKind = 'opus' | 'aac' | null;

let rx: SrtReceiver | null = null;
let demuxer: Demuxer | null = null;
let wt: WebTransport | null = null;
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
// Generation counter — bumped on every init/stop so a stale race loop (from
// a previous session on this worker) exits instead of overlapping the new one.
let gen = 0;
let epoch = 0;
let inited = false;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let wasmReady = false;

let outgoing: { type: 'videoFrame'; frame: VideoFrame }[] = [];

// Stream routing (populated from PMT).
let videoPid = -1;
let audioPid = -1;
let videoStreamType = -1;
let audioStreamType = -1;
let videoFormatId = '';
let audioFormatId = '';

// Pipelines (lazy-created on first PMT). `opusAudio`/`aacAudio` are typed as
// the upstream subclass types — inherited methods (`feed`/`reset`/`getStats`)
// are visible via the prototype chain. `null` until PMT resolves the codec.
let video: VideoPipeline | null = null;
let opusAudio: OpusAudioPipeline | null = null;
let aacAudio: AacAudioPipeline | null = null;
let videoCodecLabel: VideoCodecLabel = null;
let audioKind: AudioKind = null;

// 0x06 PIDs with no registration descriptor — content-probe on first PES.
const probePids: Set<number> = new Set();

// Diagnostic counters reported in `stats` every 2s. Field names preserved
// from the previous hand-rolled worker so the main-thread UI's stats block
// keeps rendering without changes.
const counters = {
    pesVideo: 0,
    pesAudio: 0,
    spsSeen: false,
    ppsSeen: false,
    vpsSeen: false,
    av1SeqSeen: false,
    framesOutput: 0,
    audioFramesOutput: 0,
    decoderState: 'unconfigured' as string,
    audioDecoderState: 'unconfigured' as string,
    lastDecoderError: '',
    lastAudioDecoderError: '',
    videoCodec: '',
    audioCodec: '',
    videoWidth: 0,
    videoHeight: 0,
};

function postLog(msg: string): void {
    postMessage({ type: 'log', msg });
}

function flushOutgoing(): void {
    if (outgoing.length === 0) return;
    const transfer: Transferable[] = [];
    for (const m of outgoing) {
        transfer.push(m.frame);
    }
    postMessage({ type: 'batch', msgs: outgoing }, transfer);
    outgoing = [];
}

function hexToBytes(hex: string): Uint8Array {
    if (hex.length !== 64) throw new Error('cert hash must be 64 hex chars, got ' + hex.length);
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

function postDecoderError(which: 'video' | 'audio' | 'demux', err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (which === 'video') counters.lastDecoderError = msg;
    else if (which === 'audio') counters.lastAudioDecoderError = msg;
    postMessage({ type: 'decoderError', which, msg });
}

// ---------------------------------------------------------------------------
// Worker-side audio pipeline subclasses.
//
// Upstream's OpusAudioPipeline / AacAudioPipeline route decoded AudioData to
// a local MediaStreamTrackGenerator or AudioWorklet (their viewer plays audio
// on the same thread that decodes). SlopShady decodes in the worker but
// owns the audio graph + MSTG on the main thread, so we override the routing
// to transfer AudioData across the postMessage boundary. The parsing logic
// (Opus TOC stereo detection, AAC ADTS header decode, ASC building) all comes
// from upstream unchanged.

class WorkerOpusPipeline extends OpusAudioPipeline {
    constructor() {
        super({
            onError: (e: unknown) => postDecoderError('audio', e),
            onReady: () => { /* no-op — no local audio device */ },
        });
    }

    // Bypass MediaStreamTrackGenerator / AudioWorklet setup. The worker has
    // no audio device; decoded frames transfer to main via routeFrame below.
    protected async initOutput(): Promise<void> {
        // Parent class gates feed()/reset() on `configured`; mimic the
        // flag the parent's own initOutput() would set.
        (this as any).configured = true;
    }

    // Hand the decoded AudioData to main instead of writing to a local MSTG.
    protected routeFrame(frame: AudioData): void {
        counters.audioFramesOutput++;
        postMessage({ type: 'audioData', data: frame }, [frame]);
    }
}

class WorkerAacPipeline extends AacAudioPipeline {
    constructor() {
        super({
            onError: (e: unknown) => postDecoderError('audio', e),
            onReady: () => { /* no-op */ },
        });
    }

    protected async initOutput(): Promise<void> {
        (this as any).configured = true;
    }

    protected routeFrame(frame: AudioData): void {
        counters.audioFramesOutput++;
        postMessage({ type: 'audioData', data: frame }, [frame]);
    }
}

// ---------------------------------------------------------------------------
// Worker message dispatch.

self.onmessage = async (e: MessageEvent) => {
    const m = e.data as WorkerCmd;
    try {
        if (m.type === 'init') {
            await doInit(m.url, m.certHash, m.latencyMs);
        } else if (m.type === 'stop') {
            gen++;
            doStop();
            flushOutgoing();
            postMessage({ type: 'stopped' });
        }
    } catch (err) {
        postLog('worker error: ' + (err && err.message || err));
    }
};

async function ensureWasm(): Promise<void> {
    if (wasmReady) return;
    await init({ module_or_path: '/wasm/srt-wasm/srt_wasm_bg.wasm' });
    // mpeg2ts-wasm init is handled internally by Demuxer.create(); no
    // need to pre-init here.
    wasmReady = true;
}

// Construct WebTransport in the worker, seed SRT's RTT from QUIC's smoothed
// RTT, then start the self-driving race loop. `myGen` snapshots the current
// generation so any step can bail if a newer init/stop superseded this one.
async function doInit(url: string, certHash: string | null, latencyMs: number): Promise<void> {
    const myGen = ++gen;
    // WASM load failure is terminal (retrying won't help) — keep the
    // dedicated initFailed channel the main thread already handles.
    try {
        await ensureWasm();
        if (myGen !== gen) return;
    } catch (wasmErr) {
        postMessage({
            type: 'initFailed',
            msg: (wasmErr && wasmErr.message) || String(wasmErr),
        });
        return;
    }

    try {
        epoch = performance.now();
        // Reset per-session routing so a re-init on this worker can't leak
        // a previous stream's PID/codec decisions into the new one.
        videoPid = -1;
        audioPid = -1;
        videoStreamType = -1;
        audioStreamType = -1;
        videoFormatId = '';
        audioFormatId = '';
        videoCodecLabel = null;
        audioKind = null;
        probePids.clear();

        const opts: WebTransportOptions = {};
        if (certHash) {
            opts.serverCertificateHashes = [{ algorithm: 'sha-256', value: hexToBytes(certHash) as BufferSource }];
        }
        wt = new WebTransport(url, opts);
        await wt.ready;
        if (myGen !== gen) { try { wt.close(); } catch (e) { /* ignore */ } return; }

        // Seed SRT's RTT from QUIC's smoothed RTT for accurate cold-start
        // retransmit timing (draft-sharabayko-srt-over-quic §4.5).
        let initialRttMs: number | undefined;
        try {
            const wtStats = await (wt as any).getStats();
            if (wtStats && typeof wtStats.smoothedRtt === 'number' && wtStats.smoothedRtt > 0) {
                initialRttMs = wtStats.smoothedRtt;
            }
        } catch (e) { /* getStats not supported */ }

        rx = initialRttMs !== undefined
            ? SrtReceiver.newWithLatencyAndRtt(latencyMs || 300, initialRttMs)
            : SrtReceiver.newWithLatency(latencyMs || 300);

        demuxer = await Demuxer.create({
            onPmt: handlePmt,
            onPes: handlePes,
            onError: (msg: string) => {
                postLog('demux err: ' + msg);
                postDecoderError('demux', msg);
            },
        });
        if (myGen !== gen) return;

        reader = wt.datagrams.readable.getReader();
        writer = wt.datagrams.writable.getWriter();
        wt.closed
            .then(() => { if (myGen === gen) postMessage({ type: 'close' }); })
            .catch((e: unknown) => {
                if (myGen === gen) {
                    postMessage({ type: 'error', msg: 'WT closed: ' + (e instanceof Error ? e.message : String(e)) });
                }
            });

        inited = true;

        if (statsTimer) clearInterval(statsTimer);
        statsTimer = setInterval(emitStats, 2000);

        runSrtLoop(myGen);
    } catch (connErr) {
        if (myGen === gen) {
            postMessage({
                type: 'error',
                msg: 'WT connect failed: ' + ((connErr && connErr.message) || String(connErr)),
            });
            doStop();
        }
    }
}

function doStop(): void {
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    const w = wt;
    wt = null;
    reader = null;
    writer = null;
    rx = null;
    demuxer = null;
    if (video) { try { video.reset(); } catch (e) { /* ignore */ } video = null; }
    if (opusAudio) { try { opusAudio.reset(); } catch (e) { /* ignore */ } opusAudio = null; }
    if (aacAudio) { try { aacAudio.reset(); } catch (e) { /* ignore */ } aacAudio = null; }
    inited = false;
    if (w) { try { w.close(); } catch (e) { /* ignore */ } }
}

// Self-driving SRT loop: race the next WebTransport datagram read against a
// 5ms timeout so the state machine is polled even when datagrams are sparse.
// `myGen !== gen` (or rx/inited cleared) breaks the loop so reconnects don't
// stack overlapping readers. Mirrors vendor/WebSRT/web/src/worker.ts.
async function runSrtLoop(myGen: number): Promise<void> {
    const r = reader;
    if (!r) return;
    let readPromise = r.read();

    for (;;) {
        if (myGen !== gen || !rx || !inited) break;

        const POLL_MS = 5;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const readWithLabel = readPromise.then(
            (result) => ({ kind: 'dgram' as const, result }),
            (err: unknown) => ({ kind: 'read_error' as const, err }),
        );
        const tickPromise = new Promise<{ kind: 'tick' }>((resolve) => {
            timeoutId = setTimeout(() => resolve({ kind: 'tick' }), POLL_MS);
        });

        const winner = await Promise.race([readWithLabel, tickPromise]);
        if (timeoutId !== undefined) clearTimeout(timeoutId);

        if (myGen !== gen || !rx || !inited) break;

        const nowUs = (performance.now() - epoch) * 1000;

        if (winner.kind === 'dgram') {
            if (winner.result.done || !winner.result.value) break;
            processActions(rx.handle_datagram(new Uint8Array(winner.result.value), nowUs));
            readPromise = r.read();
        } else if (winner.kind === 'read_error') {
            if (myGen === gen) {
                postLog('wt read: ' + (winner.err instanceof Error ? winner.err.message : String(winner.err)));
            }
            break;
        }

        processActions(rx.poll(nowUs));
        flushOutgoing();
    }
}

// SendDatagram SrtAction path: write the ACK/NAK bytes straight to the WT
// datagram writer the worker owns. No main-thread round-trip.
function writeDatagram(bytes: Uint8Array): void {
    const w = writer;
    if (!w) return;
    try {
        w.write(bytes).catch((e: unknown) => {
            postLog('wt write: ' + (e instanceof Error ? e.message : String(e)));
        });
    } catch (e: unknown) {
        postLog('wt write: ' + (e instanceof Error ? e.message : String(e)));
    }
}

/**
 * Dispatch SrtAction[]: write ACK/NAK datagrams straight to WebTransport,
 * feed TS bytes from DeliverMessage into the demuxer, surface handshake/close/log.
 * kind: 0=SendDatagram, 1=DeliverMessage, 2=HandshakeComplete,
 *       3=WaitForData, 4=Close, 5=Log.
 */
function processActions(actions: SrtAction[] | undefined): void {
    if (!actions) return;
    for (const a of actions) {
        const k = a.kind;
        try {
            if (k === 0) {
                writeDatagram(a.takeData());
            } else if (k === 1) {
                if (demuxer) feedTs(a.takeData());
            } else if (k === 2) {
                postMessage({ type: 'handshakeComplete' });
            } else if (k === 4) {
                postMessage({ type: 'close' });
            } else if (k === 5) {
                postLog(a.text);
            }
        } finally {
            a.free();
        }
    }
}

function feedTs(bytes: Uint8Array): void {
    if (demuxer) demuxer.feed(bytes);
}

function handlePmt(entries: { pid: number; streamType: number; formatId: string | null }[]): void {
    let newVideo = false;
    let newAudio = false;
    for (const e of entries) {
        const pid = e.pid;
        const st = e.streamType;
        const fid = e.formatId || '';
        if (videoPid < 0 && isVideoStream(st, fid)) {
            videoPid = pid;
            videoStreamType = st;
            videoFormatId = fid;
            newVideo = true;
        } else if (audioPid < 0 && isAudioStream(st, fid)) {
            audioPid = pid;
            audioStreamType = st;
            audioFormatId = fid;
            newAudio = true;
        } else if (st === ST_PRIVATE && !fid) {
            // 0x06 with no registration descriptor — defer until first PES
            // content-probe distinguishes AV1 from Opus.
            probePids.add(pid);
        }
    }

    if (newVideo) {
        videoCodecLabel = resolveVideoCodec(videoStreamType, videoFormatId);
        constructVideoPipeline();
    }
    if (newAudio) {
        audioKind = resolveAudioKind(audioStreamType, audioFormatId);
        constructAudioPipeline();
    }

    if (newVideo || newAudio) {
        postMessage({
            type: 'streamInfo',
            info: {
                videoPid,
                videoCodec: videoCodecLabel,
                audioPid,
                audioCodec: audioKind,
            },
        });
    }
}

function isVideoStream(st: number, fid: string): boolean {
    if (st === ST_H264 || st === ST_HEVC) return true;
    if (fid === 'HEVC' || fid === 'AV01') return true;
    return false;
}

function isAudioStream(st: number, fid: string): boolean {
    if (st === 0x0F || st === 0x11) return true; // AAC
    if (fid === 'Opus' || fid === 'AC-3' || fid === 'EAC-3') return true;
    return false;
}

function resolveVideoCodec(st: number, fid: string): VideoCodecLabel {
    if (st === ST_H264) return 'h264';
    if (st === ST_HEVC || fid === 'HEVC') return 'hevc';
    if (fid === 'AV01') return 'av1';
    return null;
}

function resolveAudioKind(st: number, fid: string): AudioKind {
    if (fid === 'Opus') return 'opus';
    if (st === 0x0F || st === 0x11) return 'aac';
    return null;
}

function constructVideoPipeline(): void {
    if (video) return;
    if (typeof VideoDecoder === 'undefined') return;
    video = new VideoPipeline({
        onFrame: (frame: VideoFrame) => {
            counters.framesOutput++;
            counters.videoWidth = frame.displayWidth || frame.codedWidth || counters.videoWidth;
            counters.videoHeight = frame.displayHeight || frame.codedHeight || counters.videoHeight;
            outgoing.push({ type: 'videoFrame', frame });
        },
        onError: (e: unknown) => postDecoderError('video', e),
        onConfigured: (info: { width: number; height: number; profile: number; level: number }) => {
            counters.videoWidth = info.width || counters.videoWidth;
            counters.videoHeight = info.height || counters.videoHeight;
            counters.spsSeen = true;
            counters.ppsSeen = true;
            if (videoCodecLabel === 'hevc') counters.vpsSeen = true;
            if (videoCodecLabel === 'av1') counters.av1SeqSeen = true;
            postLog(`VideoPipeline configured: ${videoCodecLabel} ${info.width}×${info.height} (profile ${info.profile} level ${info.level})`);
        },
    });
    if (videoCodecLabel) video.setCodecHint(videoCodecLabel);
    counters.videoCodec = videoCodecLabel ?? '';
}

function constructAudioPipeline(): void {
    if (opusAudio || aacAudio) return;
    if (typeof AudioDecoder === 'undefined') return;
    if (audioKind === 'opus') {
        opusAudio = new WorkerOpusPipeline();
        counters.audioCodec = 'opus';
    } else if (audioKind === 'aac') {
        aacAudio = new WorkerAacPipeline();
        counters.audioCodec = 'mp4a.40.2';
    }
}

function handlePes(pid: number, pts: number | null, _dts: number | null, bytes: Uint8Array, ra: boolean): void {
    // Content-probe unresolved 0x06 PIDs on first PES.
    if (probePids.has(pid)) {
        probePids.delete(pid);
        if (looksLikeAv1(bytes)) {
            videoPid = pid;
            videoStreamType = ST_PRIVATE;
            videoCodecLabel = 'av1';
            constructVideoPipeline();
            video?.setCodecHint('av1');
        } else {
            audioPid = pid;
            audioStreamType = ST_PRIVATE;
            audioKind = 'opus';
            constructAudioPipeline();
        }
        postMessage({
            type: 'streamInfo',
            info: {
                videoPid,
                videoCodec: videoCodecLabel,
                audioPid,
                audioCodec: audioKind,
            },
        });
    }

    if (pid === videoPid && video) {
        counters.pesVideo++;
        video.feed(bytes, pts, ra);
    } else if (pid === audioPid) {
        counters.pesAudio++;
        if (opusAudio) opusAudio.feed(bytes, pts);
        else if (aacAudio) aacAudio.feed(bytes, pts);
    }
}

/**
 * Content-probe: does this PES payload look like an AV1 low-overhead OBU
 * stream? Mirrors upstream's worker.ts `looksLikeAv1`. Used to disambiguate
 * descriptor-less 0x06 PIDs (ffmpeg/OBS emit AV1 + Opus with no registration
 * descriptor).
 */
function looksLikeAv1(payload: Uint8Array): boolean {
    if (payload.length < 2) return false;
    const b = payload[0];
    if ((b & 0x80) !== 0) return false; // forbidden bit
    if ((b & 0x01) !== 0) return false; // reserved bit
    const type = (b >> 3) & 0x0f;
    if (type !== 1 && type !== 2 && type !== 6) return false;
    const hasSize = (b >> 1) & 0x01;
    if (hasSize === 0) return false;
    const extFlag = (b >> 2) & 0x01;
    let p = 1 + extFlag;
    let size = 0;
    let shift = 0;
    while (p < payload.length) {
        const byte = payload[p++];
        size |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
        if (shift > 28) return false;
    }
    return p + size <= payload.length;
}

function emitStats(): void {
    if (!rx) return;
    try {
        const s = rx.getStats();
        const vStats = video?.getStats();
        const aStats = opusAudio?.getStats() ?? aacAudio?.getStats();
        postMessage({
            type: 'stats',
            stats: {
                bandwidthBps: s.bandwidthBps, rttMs: s.rttMs, elapsedMs: s.elapsedMs,
                rxLoss: s.rxLoss, rxNak: s.rxNak, rxAck: s.rxAck,
                rxData: s.rxData, rxBuffered: s.rxBuffered,
                pesVideo: counters.pesVideo, pesAudio: counters.pesAudio,
                spsSeen: counters.spsSeen, ppsSeen: counters.ppsSeen,
                vpsSeen: counters.vpsSeen, av1SeqSeen: counters.av1SeqSeen,
                chunksFed: vStats?.decodedCount ?? 0,
                framesOutput: counters.framesOutput,
                audioChunksFed: aStats?.packetsDecoded ?? 0,
                audioFramesOutput: counters.audioFramesOutput,
                decoderState: vStats?.decoderState ?? 'unconfigured',
                audioDecoderState: aStats?.decoderState ?? 'unconfigured',
                lastDecoderError: counters.lastDecoderError,
                lastAudioDecoderError: counters.lastAudioDecoderError,
                videoCodec: vStats?.codecString ?? counters.videoCodec,
                audioCodec: aStats?.codec ?? counters.audioCodec,
                videoWidth: vStats?.codedWidth ?? counters.videoWidth,
                videoHeight: vStats?.codedHeight ?? counters.videoHeight,
            },
        });
    } catch (err) { /* rx gone */ }
}

// Type-only declarations for the main → worker message discriminated union.
type WorkerCmd =
    | { type: 'init'; url: string; certHash: string | null; latencyMs: number }
    | { type: 'stop' };
