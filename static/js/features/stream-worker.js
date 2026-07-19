/**
 * stream-worker.js — module worker for WebSRT publishing.
 *
 * Loads two WASM modules (srt-wasm + ts-muxer-wasm), runs the SRT receiver that
 * both ingests incoming datagrams and publishes upstream TS, and exchanges
 * datagrams with the main thread (StreamingUI). Owns the Opus AudioEncoder
 * (fed from a transferred AudioWorklet MessagePort).
 *
 * Message protocol (main → worker):
 *   { type:'init', latencyMs, videoCodec, epochMs }
 *                                              load wasm, build rx+muxer, start poll/stats loops
 *   { type:'video', data, timestamp, isKey }   one encoded video chunk (H.264/HEVC Annex B, or AV1 raw OBUs)
 *   { type:'audio-port', port }                MessagePort owned by the StreamAudioProcessor
 *                                              (Phase 2 — replaces the old 'audio' message;
 *                                              AudioEncoder runs in the worker)
 *   { type:'datagram', data }                  one WebTransport datagram from gateway
 *   { type:'tick' }                            rAF-driven poll wakeup (supplements setInterval)
 *   { type:'stop' }                            stop loops, flush remaining TS
 *
 * Message protocol (worker → main):
 *   { type:'send', data }            datagram to ship via WebTransport
 *   { type:'handshakeComplete' }     SRT handshake finished, may publish
 *   { type:'stats', stats }          SrtStats snapshot
 *   { type:'log', msg }              informational/log line
 *   { type:'close' }                 SRT connection closed
 *   { type:'initFailed', msg }       worker WASM/muxer init failed (no retry)
 *   { type:'stopped' }               ack of `stop` — safe to terminate
 */
import init, { SrtReceiver } from '/wasm/srt-wasm/srt_wasm.js';
import initMux, { TsMuxer } from '/wasm/ts-muxer-wasm/ts_muxer_wasm.js';

let rx = null;
let muxer = null;
let pollTimer = null;
let statsTimer = null;
let wasmReady = false;
let videoCodec = 'h264';
let spsPps = null; // Annex B SPS+PPS bytes (from encoder avcC description); prepended on keyframes
let lastPoll = 0;
let driftWarned = false;
let epochMs = 0;          // stream-epoch in performance.now() ms (audio PTS reference)
let audioEncoder = null;
let audioPort = null;

const nowUs = () => performance.now() * 1000;

/**
 * Drive the SRT receiver state machine once. Called from both the setInterval
 * fallback and from rAF-driven `tick` messages. Includes a drift watchdog:
 * if the gap between polls exceeds 60ms (vs the 10ms target), log once per
 * throttling episode so the problem is visible in the console.
 */
function pollOnce() {
    const now = performance.now();
    if (lastPoll > 0) {
        const delta = now - lastPoll;
        if (delta > 60) {
            if (!driftWarned) {
                postMessage({ type: 'log', msg: `worker poll throttled; delta=${Math.round(delta)}ms` });
                driftWarned = true;
            }
        } else if (delta < 30) {
            driftWarned = false; // back to normal cadence
        }
    }
    lastPoll = now;
    if (rx) processActions(rx.poll(nowUs()));
}

async function ensureWasm() {
    if (wasmReady) return;
    await Promise.all([
        init({ module_or_path: '/wasm/srt-wasm/srt_wasm_bg.wasm' }),
        initMux({ module_or_path: '/wasm/ts-muxer-wasm/ts_muxer_wasm_bg.wasm' }),
    ]);
    wasmReady = true;
}

self.onmessage = async (e) => {
    const m = e.data;
    try {
        if (m.type === 'init') {
            try {
                await ensureWasm();
                rx = SrtReceiver.newWithLatency(m.latencyMs || 120);
                muxer = new TsMuxer();
                videoCodec = m.videoCodec || 'h264';
                epochMs = m.epochMs || 0;
                try { muxer.setVideoCodec(videoCodec); } catch (e) { /* older wasm: ignore */ }
                spsPps = null;
                if (pollTimer) clearInterval(pollTimer);
                pollTimer = setInterval(pollOnce, 10);
                if (statsTimer) clearInterval(statsTimer);
                statsTimer = setInterval(() => {
                    try {
                        const s = rx.getStats();
                        postMessage({ type: 'stats', stats: {
                            bandwidthBps: s.bandwidthBps, rttMs: s.rttMs, elapsedMs: s.elapsedMs,
                            txData: s.txData, txBytes: s.txBytes, txLoss: s.txLoss,
                            txRetransmit: s.txRetransmit, txBuffered: s.txBuffered,
                            rxLoss: s.rxLoss, rxNak: s.rxNak, rxAck: s.rxAck,
                            rxData: s.rxData, rxBuffered: s.rxBuffered,
                        } });
                    } catch (e) { /* rx gone */ }
                }, 2000);
            } catch (initErr) {
                // Surface init failures distinctly so the UI can stop and show
                // a message instead of staying on "Connecting…" forever.
                postMessage({ type: 'initFailed', msg: (initErr && initErr.message) || String(initErr) });
                return;
            }
        } else if (m.type === 'spspps') {
            if (videoCodec === 'av1') return;
            spsPps = new Uint8Array(m.data);
        } else if (m.type === 'video') {
            if (rx && rx.isHandshakeComplete() && muxer) {
                const payload = new Uint8Array(m.data);
                if (videoCodec === 'av1') {
                    // AV1: raw low-overhead OBUs, Sequence Header already in keyframes. No Annex B / SPS-PPS.
                    muxer.push_video(payload, m.timestamp, m.timestamp, m.isKey);
                } else {
                    // H.264/HEVC: convert chunk to Annex B FIRST (avcC/hvcC length-prefix →
                    // start codes), then prepend in-band SPS/PPS on keyframes (avcC encoders
                    // omit them). Doing the prepend BEFORE ensureAnnexB breaks its start-code
                    // sniff — the SPS/PPS prefix is already Annex B, so it bails out and leaves
                    // the IDR slice in length-prefixed form, where parseAnnexB on the viewer
                    // side cannot find it. Result: decoder gets SPS/PPS but no IDR → no frames.
                    const annexB = ensureAnnexB(payload);
                    let nal = annexB;
                    if (m.isKey && spsPps && spsPps.length) {
                        const combined = new Uint8Array(spsPps.length + annexB.length);
                        combined.set(spsPps, 0);
                        combined.set(annexB, spsPps.length);
                        nal = combined;
                    }
                    muxer.push_video(nal, m.timestamp, m.timestamp, m.isKey);
                }
                flushTsToSrt();
            }
        } else if (m.type === 'audio-port') {
            // Phase 2: AudioWorklet tap. The transferred MessagePort delivers
            // { ts, data: Float32Array(1920) } messages directly from the audio
            // render thread. AudioEncoder is constructed lazily on first frame
            // (so init doesn't fail if the encoder isn't available).
            audioPort = m.port;
            let audioFrameCount = 0;
            let audioChunkCount = 0;
            audioPort.onmessage = (e) => {
                const { ts, data } = e.data;
                audioFrameCount++;
                if (audioFrameCount === 1 || audioFrameCount === 50) {
                    console.log(`[stream-worker] audio frame #${audioFrameCount} received`, {
                        ts,
                        dataBytes: data.byteLength,
                        samples: data.length,
                        handshakeComplete: rx ? rx.isHandshakeComplete() : 'no-rx',
                        encoderState: audioEncoder ? audioEncoder.state : 'not-constructed',
                    });
                }
                if (!rx || !rx.isHandshakeComplete() || !muxer) return;
                if (!audioEncoder) {
                    try {
                        audioEncoder = new AudioEncoder({
                            output: (chunk) => {
                                if (!rx || !rx.isHandshakeComplete() || !muxer) return;
                                audioChunkCount++;
                                if (audioChunkCount === 1 || audioChunkCount === 20) {
                                    console.log(`[stream-worker] encoded audio chunk #${audioChunkCount}`, {
                                        bytes: chunk.byteLength,
                                        timestamp: chunk.timestamp,
                                    });
                                }
                                const buf = new ArrayBuffer(chunk.byteLength);
                                chunk.copyTo(new Uint8Array(buf));
                                muxer.push_audio(new Uint8Array(buf), chunk.timestamp);
                                flushTsToSrt();
                            },
                            error: (err) => console.error('[worker] AudioEncoder', err),
                        });
                        audioEncoder.configure({
                            codec: 'opus',
                            sampleRate: 48000,
                            numberOfChannels: 2,
                            bitrate: 128000,
                        });
                        console.log('[stream-worker] AudioEncoder configured', audioEncoder.state);
                    } catch (err) {
                        postMessage({ type: 'log', msg: 'AudioEncoder init failed: ' + (err && err.message || err) });
                        return;
                    }
                }
                // The worklet already converted to microseconds-since-stream-
                // start on the audio clock. Use directly as AudioData.timestamp
                // so video and audio PTS share the same zero origin.
                const audioData = new AudioData({
                    format: 'f32-planar',
                    sampleRate: 48000,
                    numberOfFrames: 960,
                    numberOfChannels: 2,
                    timestamp: ts,
                    data: data,
                });
                if (audioEncoder.encodeQueueSize < 10) {
                    audioEncoder.encode(audioData);
                }
                audioData.close();
            };
        } else if (m.type === 'datagram') {
            if (rx) processActions(rx.handle_datagram(new Uint8Array(m.data), nowUs()));
        } else if (m.type === 'tick') {
            // rAF-driven wakeup from the main thread (kept alive by the
            // anti-throttle oscillator). Supplements setInterval, which
            // Chrome can throttle to ~1Hz when the tab is fully backgrounded.
            pollOnce();
        } else if (m.type === 'stop') {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
            if (audioPort) { try { audioPort.close(); } catch (e) { /* ignore */ } audioPort = null; }
            if (audioEncoder) {
                try { audioEncoder.flush(); } catch (e) { /* ignore */ }
                try { audioEncoder.close(); } catch (e) { /* ignore */ }
                audioEncoder = null;
            }
            if (muxer) flushTsToSrt();
            postMessage({ type: 'stopped' });
        }
    } catch (err) {
        postMessage({ type: 'log', msg: 'worker error: ' + (err && err.message || err) });
    }
};

/** Drain muxed TS packets and hand them to the SRT receiver for upstream send. */
function flushTsToSrt() {
    if (!rx || !muxer) return;
    const ts = muxer.poll();
    if (ts && ts.length > 0) processActions(rx.sendMessage(ts, nowUs()));
}

/**
 * Dispatch SrtAction[] back to the main thread.
 * kind: 0=SendDatagram, 1=DeliverMessage, 2=HandshakeComplete,
 *       3=WaitForData, 4=Close, 5=Log
 */
function processActions(actions) {
    if (!actions) return;
    for (const a of actions) {
        const k = a.kind;
        if (k === 0) {                    // SendDatagram
            const d = a.takeData().buffer;
            postMessage({ type: 'send', data: d }, [d]);
        } else if (k === 2) {             // HandshakeComplete
            postMessage({ type: 'handshakeComplete' });
        } else if (k === 4) {             // Close
            postMessage({ type: 'close' });
        } else if (k === 5) {             // Log
            postMessage({ type: 'log', msg: a.text });
        }
        // k === 1 (DeliverMessage) and k === 3 (WaitForData) need no main-thread action.
    }
}

/**
 * Convert WebCodecs video encoder output to MPEG-TS Annex B (start codes).
 * - If already Annex B (begins 00 00 01 or 00 00 00 01): pass through.
 * - Else assume 4-byte big-endian length-prefixed NALs (HEVC/hvcC default)
 *   and rewrite each prefix to 00 00 00 01.
 */
function ensureAnnexB(data) {
    if (data.length >= 4 && data[0] === 0 && data[1] === 0 &&
        ((data[2] === 0 && data[3] === 1) || data[2] === 1)) {
        return data;
    }
    const parts = [];
    let total = 0;
    let pos = 0;
    while (pos + 4 <= data.length) {
        const len = (data[pos] * 0x1000000) + (data[pos + 1] * 0x10000) + (data[pos + 2] * 0x100) + data[pos + 3];
        pos += 4;
        if (len <= 0 || pos + len > data.length) break;
        parts.push([0, 0, 0, 1]);
        parts.push(data.subarray(pos, pos + len));
        total += 4 + len;
        pos += len;
    }
    if (total === 0) return data; // unable to parse; leave untouched
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}
