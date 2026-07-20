/**
 * stream-input-worker.ts — module worker for WebSRT receiving.
 *
 * Receives SRT over WebTransport datagrams (driven by the main thread),
 * demuxes MPEG-TS via mpeg2ts-wasm, decodes video + audio via WebCodecs
 * using upstream WebSRT's VideoPipeline + Opus/Aac audio pipelines, and
 * posts transferable VideoFrame / AudioData back to the main thread for
 * layer texture upload + MediaStreamTrackGenerator pacing.
 *
 * Codec correctness (AVCC length-prefixing, HEVC hvcC building, AV1 OBU
 * sequence-header handling, Opus TOC stereo detect, AAC ADTS → ASC) all
 * live in upstream `vendor/WebSRT/web/src/decode.ts` — this worker is
 * glue only.
 *
 * Message protocol (main → worker):
 *   { type:'init', latencyMs }              load wasm, build rx+demuxer, start poll loop
 *   { type:'datagram', data }               one WebTransport datagram from gateway
 *   { type:'tick' }                         rAF-driven poll wakeup (supplements setInterval)
 *   { type:'stop' }                         stop loops, flush decoders
 *
 * Message protocol (worker → main):
 *   { type:'send', data }                   datagram to ship via WebTransport (ACK/NAK)
 *   { type:'handshakeComplete' }            SRT handshake finished, may receive
 *   { type:'streamInfo', info }             PMT parsed: { videoPid, videoCodec, audioPid, audioCodec }
 *   { type:'videoFrame', frame }            decoded VideoFrame (transferred)
 *   { type:'audioData', data }              decoded AudioData (transferred)
 *   { type:'stats', stats }                 SrtStats snapshot + decoder counters
 *   { type:'log', msg }                     informational/log line
 *   { type:'decoderError', which, msg }     Video/AudioDecoder error (visible in UI)
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
let pollTimer: ReturnType<typeof setInterval> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let wasmReady = false;
let lastPoll = 0;
let driftWarned = false;

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

const nowUs = (): number => performance.now() * 1000;

function postLog(msg: string): void {
    postMessage({ type: 'log', msg });
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
            try {
                await ensureWasm();
                rx = SrtReceiver.newWithLatency(m.latencyMs || 300);
                demuxer = await Demuxer.create({
                    onPmt: handlePmt,
                    onPes: handlePes,
                    onError: (msg: string) => {
                        postLog('demux err: ' + msg);
                        postDecoderError('demux', msg);
                    },
                });
                if (pollTimer) clearInterval(pollTimer);
                pollTimer = setInterval(pollOnce, 10);
                if (statsTimer) clearInterval(statsTimer);
                statsTimer = setInterval(emitStats, 2000);
            } catch (initErr) {
                postMessage({
                    type: 'initFailed',
                    msg: (initErr && initErr.message) || String(initErr),
                });
                return;
            }
        } else if (m.type === 'datagram') {
            if (rx) processActions(rx.handle_datagram(new Uint8Array(m.data), nowUs()));
        } else if (m.type === 'tick') {
            pollOnce();
        } else if (m.type === 'stop') {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
            if (video) { video.reset(); video = null; }
            if (opusAudio) { opusAudio.reset(); opusAudio = null; }
            if (aacAudio) { aacAudio.reset(); aacAudio = null; }
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

function pollOnce(): void {
    const now = performance.now();
    if (lastPoll > 0) {
        const delta = now - lastPoll;
        if (delta > 60) {
            if (!driftWarned) {
                postLog(`worker poll throttled; delta=${Math.round(delta)}ms`);
                driftWarned = true;
            }
        } else if (delta < 30) {
            driftWarned = false;
        }
    }
    lastPoll = now;
    if (rx) processActions(rx.poll(nowUs()));
}

/**
 * Dispatch SrtAction[]: send datagrams back to main (ACK/NAK to gateway),
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
                const d = a.takeData().buffer;
                postMessage({ type: 'send', data: d }, [d]);
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
            postMessage({ type: 'videoFrame', frame }, [frame]);
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
    | { type: 'init'; latencyMs: number }
    | { type: 'datagram'; data: ArrayBuffer }
    | { type: 'tick' }
    | { type: 'stop' };
