/**
 * stream-worker.js — module worker for WebSRT publishing.
 *
 * Loads two WASM modules (srt-wasm + ts-muxer-wasm), runs the SRT receiver that
 * both ingests incoming datagrams and publishes upstream TS, and exchanges
 * datagrams with the main thread (StreamingUI). Owns the Opus AudioEncoder
 * (fed from a transferred AudioWorklet MessagePort) and, since Phase 3, the
 * VideoEncoder — the main thread posts transferable VideoFrames captured from
 * the WebGL canvas; the worker owns encode + Annex B / SPS-PPS / muxer work.
 *
 * Message protocol (main → worker):
 *   { type:'init', latencyMs, videoCodec, videoCodecString, videoBitrate,
 *     videoFps, videoHwMode, cbrEnabled, encW, encH, keyframeMs, epochMs }
 *                                              load wasm, build rx+muxer, construct
 *                                              + configure VideoEncoder, start poll/stats loops
 *                                              (videoHwMode: 'prefer-hardware' if HW probe
 *                                              passed on main, null for SW fallback)
 *   { type:'frame', frame, isKey }            one VideoFrame captured from the canvas
 *                                              (transferable; worker encodes + closes it)
 *   { type:'resize', width, height }          canvas resized — worker reconfigures VideoEncoder
 *   { type:'setBitrate', bitrate }            ABR / manual bitrate change — worker reconfigures
 *                                              VideoEncoder (restores the adaptive-bitrate path that
 *                                              became inert when VideoEncoder moved to the worker)
 *   { type:'setBitrateMode', cbr }            CBR (true) ↔ VBR (false) toggle from main
 *   { type:'audio-port', port }               MessagePort owned by the StreamAudioProcessor
 *                                              (Phase 2 — replaces the old 'audio' message;
 *                                              AudioEncoder runs in the worker)
 *   { type:'datagram', data }                 one WebTransport datagram from gateway
 *   { type:'tick' }                           rAF-driven poll wakeup (supplements setInterval)
 *   { type:'stop' }                           stop loops, flush remaining TS
 *
 * Message protocol (worker → main):
 *   { type:'send', data }            datagram to ship via WebTransport
 *   { type:'handshakeComplete' }     SRT handshake finished, may publish
 *   { type:'stats', stats }          SrtStats snapshot
 *   { type:'log', msg }              informational/log line
 *   { type:'close' }                 SRT connection closed
 *   { type:'initFailed', msg }       worker WASM/muxer/VideoEncoder init failed (no retry)
 *   { type:'requestKeyframe' }       VideoEncoder backpressure — frame dropped; main forces
 *                                    a keyframe on the next capture (Phase 1 recovery)
 *   { type:'frameCredit', count }    flow-control credit grant — main may send N more frames.
 *                                    Issued: 4 at init, 1 per encoded chunk, 1 per drop.
 *                                    Bounds in-flight count to prevent postMessage backlog
 *                                    during slow-encode scenes.
 *   { type:'videoEncoderFailed', msg } VideoEncoder rejected config or threw at runtime
 *   { type:'stopped' }               ack of `stop` — safe to terminate
 */
import init, { SrtReceiver } from '/wasm/srt-wasm/srt_wasm.js';
import initMux, { TsMuxer } from '/wasm/ts-muxer-wasm/ts_muxer_wasm.js';

let rx = null;
let muxer = null;
let pollTimer = null;
let statsTimer = null;
let wasmReady = false;
let videoCodec = 'h264';          // family: h264 / hevc / av1 (Annex B vs AV1 routing)
let videoCodecString = 'avc1.640028'; // exact codec string for VideoEncoder.configure
let videoBitrate = 8_000_000;     // bps (initial value from init; updated via setBitrate)
let videoFps = 60;
let frameCount = 0;
let keyframeInterval = 60;
let videoHwMode = null;           // 'prefer-hardware' if HW probe passed; null for SW
let cbrEnabled = true;            // CBR (constant) vs VBR (variable); set via init + setBitrateMode
let encW = 1280;
let encH = 720;
let spsPps = null;                // Annex B SPS+PPS bytes (from encoder avcC description); prepended on keyframes
let lastPoll = 0;
let driftWarned = false;
let lastTxBytes = 0;
let lastStatsTime = 0;
let epochMs = 0;          // stream-epoch in performance.now() ms (audio PTS reference)
let audioEncoder = null;
let audioPort = null;
let videoEncoder = null;

const nowUs = () => performance.now() * 1000;

/**
 * Drive the SRT receiver state machine once. Called from both the setInterval
 * fallback and from rAF-driven `tick` messages. Includes a drift watchdog:
 * if the gap between polls exceeds 60ms (vs the 5ms target), log once per
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
                rx = m.initialRttMs !== undefined
                    ? SrtReceiver.newWithLatencyAndRtt(m.latencyMs || 120, m.initialRttMs)
                    : SrtReceiver.newWithLatency(m.latencyMs || 120);
                muxer = new TsMuxer();
                videoCodec = m.videoCodec || 'h264';
                epochMs = m.epochMs || 0;
                // Phase 3: VideoEncoder config (was on main; moved off-main).
                videoCodecString = m.videoCodecString || videoCodecString;
                videoBitrate = m.videoBitrate || videoBitrate;
                videoFps = m.videoFps || videoFps;
                frameCount = 0;
                keyframeInterval = Math.max(1, Math.round(videoFps * 2));
                // HW mode is what actually passed probe on main — avoids blindly
                // preferring HW when the probe flaked and SW was the fallback.
                videoHwMode = (typeof m.videoHwMode === 'string') ? m.videoHwMode : null;
                if (typeof m.cbrEnabled === 'boolean') cbrEnabled = m.cbrEnabled;
                encW = m.encW || encW;
                encH = m.encH || encH;
                try { muxer.setVideoCodec(videoCodec); } catch (e) { /* older wasm: ignore */ }
                spsPps = null;
                if (pollTimer) clearInterval(pollTimer);
                pollTimer = setInterval(pollOnce, 5);
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
                // Phase 3: construct + configure VideoEncoder in the worker.
                try {
                    videoEncoder = new VideoEncoder({
                        output: (chunk, meta) => {
                            if (!rx || !rx.isHandshakeComplete() || !muxer) return;
                            // H.264 keyframes carry SPS/PPS only in the avcC
                            // description; extract them now (avcC → Annex B) so
                            // they can be prepended in-band on the keyframe NAL.
                            if (videoCodec === 'h264' && chunk.type === 'key') {
                                const desc = meta && meta.decoderConfig ? meta.decoderConfig.description : null;
                                if (desc) {
                                    spsPps = parseAvcCToAnnexB(desc);
                                }
                            }
                            const payload = new Uint8Array(chunk.byteLength);
                            chunk.copyTo(payload);
                            let nal;
                            if (videoCodec === 'av1') {
                                // AV1: raw low-overhead OBUs, Sequence Header already in keyframes. No Annex B / SPS-PPS.
                                nal = payload;
                            } else {
                                // H.264/HEVC: convert chunk to Annex B FIRST (avcC/hvcC length-prefix →
                                // start codes), then prepend in-band SPS/PPS on keyframes (avcC encoders
                                // omit them). Doing the prepend BEFORE ensureAnnexB breaks its start-code
                                // sniff — the SPS/PPS prefix is already Annex B, so it bails out and leaves
                                // the IDR slice in length-prefixed form, where parseAnnexB on the viewer
                                // side cannot find it. Result: decoder gets SPS/PPS but no IDR → no frames.
                                const annexB = ensureAnnexB(payload);
                                if (chunk.type === 'key' && spsPps && spsPps.length) {
                                    nal = new Uint8Array(spsPps.length + annexB.length);
                                    nal.set(spsPps, 0);
                                    nal.set(annexB, spsPps.length);
                                } else {
                                    nal = annexB;
                                }
                            }
                            muxer.push_video(nal, chunk.timestamp, chunk.timestamp, chunk.type === 'key');
                            flushTsToSrt();
                            // Flow control: grant one credit back per encoded
                            // chunk so main can capture the next frame. Without
                            // this, main's _frameCredits drains to 0 during
                            // slow encodes and capture pauses — which is the
                            // point (prevents postMessage backlog).
                            postMessage({ type: 'frameCredit', count: 1 });
                        },
                        error: (err) => {
                            console.error('[worker] VideoEncoder', err);
                            postMessage({ type: 'videoEncoderFailed', msg: (err && err.message) || String(err) });
                        },
                    });
                    const vcfg = videoConfig();
                    videoEncoder.configure(vcfg);
                    // Grant initial credits so main can start shipping frames
                    // immediately. 4 = small pipeline; main can capture the
                    // next frame while the previous is still encoding.
                    postMessage({ type: 'frameCredit', count: 4 });
                } catch (err) {
                    postMessage({ type: 'initFailed', msg: 'VideoEncoder init failed: ' + ((err && err.message) || err) });
                    return;
                }
            } catch (initErr) {
                // Surface init failures distinctly so the UI can stop and show
                // a message instead of staying on "Connecting…" forever.
                postMessage({ type: 'initFailed', msg: (initErr && initErr.message) || String(initErr) });
                return;
            }
        } else if (m.type === 'frame') {
            // Phase 3: one transferable VideoFrame from the main-thread canvas.
            // Worker owns encode + Annex B / SPS-PPS / muxer; closes the frame
            // after encode (or on any early-out path — frames must not leak).
            if (!videoEncoder || videoEncoder.state !== 'configured') {
                try { m.frame.close(); } catch (e) { /* ignore */ }
                // Return the credit main spent on this frame so it can retry
                // once the encoder is ready.
                postMessage({ type: 'frameCredit', count: 1 });
                return;
            }
            if (videoEncoder.encodeQueueSize > 8) {
                // Backpressure: drop this frame silently. Do NOT post
                // `requestKeyframe` — forcing a keyframe here creates a
                // feedback loop (keyframe is large → encoder stays slow →
                // queue stays full → another forced keyframe …) that
                // progressively destabilizes the stream during complex
                // scenes like layer crossfades. The periodic keyframe
                // interval on main (default 2 s) is enough for the viewer
                // to recover once the queue drains.
                try { m.frame.close(); } catch (e) { /* ignore */ }
                postMessage({ type: 'frameCredit', count: 1 });
                return;
            }
            const forceKey = m.isKey || frameCount === 0 || frameCount % keyframeInterval === 0;
            frameCount++;
            try {
                videoEncoder.encode(m.frame, { keyFrame: forceKey });
            } catch (e) {
                console.warn('[worker] encode failed', e);
                postMessage({ type: 'frameCredit', count: 1 });
            }
            try { m.frame.close(); } catch (e) { /* ignore */ }
            // NOTE: credit for this frame is granted in the encoder's output
            // callback when the encoded chunk is emitted. That's the true
            // "slot freed" point — keeps main's capture rate locked to the
            // encoder's actual throughput.
        } else if (m.type === 'resize') {
            // Phase 3: main signaled a canvas-size change — reconfigure the
            // encoder for the new even dims before the next frame arrives.
            encW = m.width;
            encH = m.height;
            if (videoEncoder && videoEncoder.state === 'configured') {
                try { videoEncoder.configure(videoConfig()); }
                catch (e) { console.warn('[worker] reconfigure failed', e); }
            }
        } else if (m.type === 'setBitrate') {
            // ABR / manual bitrate change from main. Reconfigure the live
            // encoder. Restores the adaptive-bitrate path that became inert
            // when VideoEncoder moved to the worker in Phase 3.
            videoBitrate = m.bitrate | 0;
            if (videoEncoder && videoEncoder.state === 'configured') {
                try { videoEncoder.configure(videoConfig()); }
                catch (e) { console.warn('[worker] bitrate reconfigure failed', e); }
            }
        } else if (m.type === 'setBitrateMode') {
            // CBR ↔ VBR toggle from main.
            cbrEnabled = !!m.cbr;
            if (videoEncoder && videoEncoder.state === 'configured') {
                try { videoEncoder.configure(videoConfig()); }
                catch (e) { console.warn('[worker] bitrate-mode reconfigure failed', e); }
            }
        } else if (m.type === 'audio-port') {
            // Phase 2: AudioWorklet tap. The transferred MessagePort delivers
            // { ts, data: Float32Array(1920) } messages directly from the audio
            // render thread. AudioEncoder is constructed lazily on first frame
            // (so init doesn't fail if the encoder isn't available).
            audioPort = m.port;
            audioPort.onmessage = (e) => {
                const { ts, data } = e.data;
                if (!rx || !rx.isHandshakeComplete() || !muxer) return;
                if (!audioEncoder) {
                    try {
                        audioEncoder = new AudioEncoder({
                            output: (chunk) => {
                                if (!rx || !rx.isHandshakeComplete() || !muxer) return;
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
            if (videoEncoder) {
                try { videoEncoder.flush(); } catch (e) { /* ignore */ }
                try { videoEncoder.close(); } catch (e) { /* ignore */ }
                videoEncoder = null;
            }
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
 * Build the VideoEncoder config for the current codec/dims/bitrate. Uses
 * videoBitrate directly (no ABR — adaptive bitrate still lives on main and is
 * a follow-up to wire through to the worker).
 */
function videoConfig() {
    const cfg = {
        codec: videoCodecString,
        width: encW,
        height: encH,
        bitrate: videoBitrate,
        framerate: videoFps,
        latencyMode: 'realtime',
        // CBR produces a steady bitrate (better for streaming: no bursts during
        // complex scenes that the network can't absorb). VBR trades steady
        // rate for higher instantaneous quality on hard frames.
        bitrateMode: cbrEnabled ? 'constant' : 'variable',
    };
    if (videoCodec === 'h264') cfg.avc = { format: 'avc' };
    // Apply the HW mode that actually passed probe on main. videoHwMode is
    // 'prefer-hardware' when HW probed clean, or null when HW flaked (NVENC
    // session limit, GPU mid-init after refresh, OS GPU switch) and SW was
    // used as the fallback. Without this guard the worker would blindly
    // prefer-HW and could fail at configure() time.
    if (videoHwMode) cfg.hardwareAcceleration = videoHwMode;
    return cfg;
}

/**
 * Parse an avcC decoder-config record (VideoEncoder meta.description) into
 * Annex B bytes: 00 00 00 01 <SPS> 00 00 00 01 <PPS>. The viewer needs
 * SPS/PPS in-band; avcC-mode encoders only expose them via description.
 */
function parseAvcCToAnnexB(desc) {
    const d = desc instanceof ArrayBuffer
        ? new Uint8Array(desc)
        : new Uint8Array(desc.buffer, desc.byteOffset || 0, desc.byteLength);
    const parts = [];
    let p = 5; // skip version, profile, compat, level, lengthSize
    if (d.length <= p) return null;
    const numSPS = d[p] & 0x1f; p++;
    for (let i = 0; i < numSPS && p + 2 <= d.length; i++) {
        const len = (d[p] << 8) | d[p + 1]; p += 2;
        if (len <= 0 || p + len > d.length) break;
        parts.push([0, 0, 0, 1]);
        parts.push(d.subarray(p, p + len));
        p += len;
    }
    if (p < d.length) {
        const numPPS = d[p]; p++;
        for (let i = 0; i < numPPS && p + 2 <= d.length; i++) {
            const len = (d[p] << 8) | d[p + 1]; p += 2;
            if (len <= 0 || p + len > d.length) break;
            parts.push([0, 0, 0, 1]);
            parts.push(d.subarray(p, p + len));
            p += len;
        }
    }
    if (parts.length === 0) return null;
    let total = 0;
    for (const x of parts) total += x.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
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
