/**
 * StreamingUI — main-thread coordinator for WebSRT publishing.
 *
 * Captures the WebGL canvas as transferable VideoFrames (one GPU copy + one
 * postMessage per frame) and ships them to a module worker that runs the
 * VideoEncoder + TS muxer + SRT receiver WASM + Opus AudioEncoder, exchanging
 * datagrams with the WebSRT gateway over WebTransport. All CPU-heavy encode
 * work is off-main (Phase 3 moved VideoEncoder to the worker; AudioEncoder
 * followed in Phase 2).
 *
 * Audio path: an AudioWorklet (see features/stream-audio.js +
 * features/stream-audio-worklet.js) taps the Webamp analyser and ships 20ms
 * Float32 frames directly to the worker via a transferred MessagePort. The
 * AudioEncoder lives in the worker. Capture and encode are both off the main
 * thread — panel reflow cannot starve audio.
 *
 * Conventions follow recorder.js: singleton object, init() wires DOM buttons
 * via getEl, state read from ../state.js. Streaming is frontend-local state —
 * it does NOT use Sync.send().
 */
import { state, getEl } from '../state.js';
import { StreamAudio } from '../features/stream-audio.js';

export const StreamingUI = {
    // ---- runtime handles ----
    worker: null,
    transport: null,
    isStreaming: false,
    _epoch: 0,
    _forceKeyframe: false,
    _handshakeDone: false,
    // Flow-control credits: worker grants N credits (initial 2, then 1 per
    // encoded chunk emitted). Main decrements per frame sent and refuses to
    // send when 0. Bounds the in-flight frame count between main and worker
    // so complex scenes that slow the encoder can't accumulate an unbounded
    // backlog in the postMessage queue (which would arrive at the muxer as a
    // stale-PTS burst and surface as TS CC errors + pixilation on the viewer).
    _frameCredits: 0,
    datagramQueue: [],
    reconnectTimer: null,
    reconnectAttempts: 0,
    _keyframeInterval: null,
    _receiveReader: null,
    _lastEncDims: null,
    _encW: 0,
    _encH: 0,
    _flushPending: false,

    // ---- config ----
    gatewayUrl: 'https://127.0.0.1:4433/wt',
    streamName: 'slopshady',
    _videoBitrate: 8_000_000,       // user-set target bitrate (bps)
    _currentBitrate: 8_000_000,     // live bitrate (adapted when ABR is on; equals target otherwise)
    _fps: 60,
    _latencyMs: 300,
    _keyframeMs: 2000,
    _codec: 'avc1.640028',
    _selectedCodec: null,
    _codecProbe: null,

    // ---- constant bitrate (CBR) ----
    // ON by default for streaming — produces a steady bitrate instead of
    // variable, which reduces packet bursts during complex scenes and keeps
    // SRT's send buffer predictably loaded. Toggle off for VBR (higher
    // instantaneous quality at the cost of burst risk).
    _cbrEnabled: true,

    // ---- adaptive bitrate (ABR) ----
    // OFF by default — experimental; tune the constants below and re-test before
    // relying on it. See `_handleAbrStats` for the adaptation logic.
    _abrEnabled: false,
    _highMarkCount: 0,
    _lowMarkCount: 0,
    // SRT's `txBuffered` stat is the sender's unacked-packet queue depth, in
    // packets (1316-byte payloads). At 8 Mbps, one packet ≈ 1.3 ms of video, so
    // 80 packets ≈ ~100 ms of buffered data — a reasonable "network can't keep
    // up" signal. These are STARTING GUESSES pending empirical tuning. To tune:
    // change a constant below and reload the page; no rebuild needed for JS-only
    // changes. Each adaptation event is logged to the console as `[ABR] …`.
    _ABR_HIGH_MARK: 80,        // txBuffered packets → consider downshift
    _ABR_LOW_MARK: 10,         // txBuffered packets → consider upshift
    _ABR_HIGH_CONSEC: 3,       // consecutive high samples before downshift
    _ABR_LOW_CONSEC: 8,        // consecutive low samples before upshift
    _ABR_DOWN_FACTOR: 0.75,    // multiply bitrate by this on downshift
    _ABR_UP_FACTOR: 1.10,      // multiply bitrate by this on upshift
    _ABR_MIN_BITRATE: 500_000, // floor (bps)
    // Candidates probed on load. `usable` = our muxer (H.264/HEVC/AV1 Annex B
    // or OBU) + viewer can carry it. `family` groups entries in the dropdown.
    _videoCandidates: [
        // H.264 (avc1 = <profile byte><constraint byte><level byte>)
        // 0x42=Baseline, 0x4D=Main, 0x64=High; level: 0x1F=3.1, 0x28=4.0, 0x29=4.1, 0x2A=4.2, 0x32=5.0, 0x33=5.1, 0x34=5.2
        { family: 'h264', codec: 'avc1.42E01F', label: 'H.264 Baseline 3.1', usable: true },
        { family: 'h264', codec: 'avc1.42E028', label: 'H.264 Baseline 4.0', usable: true },
        { family: 'h264', codec: 'avc1.4D401F', label: 'H.264 Main 3.1',    usable: true },
        { family: 'h264', codec: 'avc1.4D4028', label: 'H.264 Main 4.0',    usable: true },
        { family: 'h264', codec: 'avc1.4D4029', label: 'H.264 Main 4.1',    usable: true },
        { family: 'h264', codec: 'avc1.640028', label: 'H.264 High 4.0',    usable: true },
        { family: 'h264', codec: 'avc1.640029', label: 'H.264 High 4.1',    usable: true },
        { family: 'h264', codec: 'avc1.64002A', label: 'H.264 High 4.2',    usable: true },
        { family: 'h264', codec: 'avc1.640032', label: 'H.264 High 5.0',    usable: true },
        { family: 'h264', codec: 'avc1.640033', label: 'H.264 High 5.1',    usable: true },
        // HEVC (hev1.<profile>.<compat>.L<level*30>.B<constraint>)
        // Main profile=1, compat=6; L120=4.0, L123=4.1, L150=5.0, L153=5.1
        { family: 'hevc', codec: 'hev1.1.6.L120.B0', label: 'HEVC Main 4.0',  usable: true },
        { family: 'hevc', codec: 'hev1.1.6.L123.B0', label: 'HEVC Main 4.1',  usable: true },
        { family: 'hevc', codec: 'hev1.1.6.L150.B0', label: 'HEVC Main 5.0',  usable: true },
        { family: 'hevc', codec: 'hev1.1.6.L153.B0', label: 'HEVC Main 5.1',  usable: true },
        // AV1 (av01.<profile>.<LL><tier>.<DD>)
        // profile 0=Main, 1=High, 2=Professional; LL=level (DECIMAL 2-digit); tier M/H; DD=bit-depth (DECIMAL 2-digit)
        // Levels (common): 04=4.0, 05=5.0, 08=8.0, 0A=10.0, 0D=13.0
        { family: 'av1',  codec: 'av01.0.04M.08', label: 'AV1 Main L4.0 8-bit',  usable: true },
        { family: 'av1',  codec: 'av01.0.04M.10', label: 'AV1 Main L4.0 10-bit', usable: true },
        { family: 'av1',  codec: 'av01.0.05M.08', label: 'AV1 Main L5.0 8-bit',  usable: true },
        { family: 'av1',  codec: 'av01.0.05M.10', label: 'AV1 Main L5.0 10-bit', usable: true },
        { family: 'av1',  codec: 'av01.0.08M.08', label: 'AV1 Main L8.0 8-bit',  usable: true },
        { family: 'av1',  codec: 'av01.0.08M.10', label: 'AV1 Main L8.0 10-bit', usable: true },
        // VP9 — not wired into the muxer, leave marked unusable
        { family: 'vp9',  codec: 'vp09.00.10.08', label: 'VP9', usable: false, note: 'not wired' },
    ],
    _audioCandidates: [
        { codec: 'opus', label: 'Opus', usable: true },
        { codec: 'mp4a.40.2', label: 'AAC-LC', usable: false, note: 'disabled (Opus-only)' },
    ],

    init() {
        const startBtn = getEl('startStream');
        const stopBtn = getEl('stopStream');
        if (!startBtn) return;
        startBtn.addEventListener('click', () => this.start());
        stopBtn.addEventListener('click', () => this.stop());
        // Restore last-used gateway URL / stream name (overrides HTML defaults).
        this._loadPersisted();
        const urlEl = getEl('stream-gateway-url');
        const nameEl = getEl('stream-name');
        if (urlEl) urlEl.addEventListener('change', () => this._savePersisted());
        if (nameEl) nameEl.addEventListener('change', () => this._savePersisted());
        for (const id of ['stream-fps', 'stream-latency', 'stream-keyframe']) {
            const el = getEl(id);
            if (el) el.addEventListener('change', () => this._savePersisted());
        }
        // Bitrate input: persist + live-update target (and apply immediately if
        // ABR is off, so the slider takes effect mid-stream without restart).
        const bitrateEl = getEl('stream-bitrate');
        if (bitrateEl) bitrateEl.addEventListener('change', () => {
            this._savePersisted();
            this._readBitrateInput();
            if (!this._abrEnabled) {
                this._currentBitrate = this._videoBitrate;
                this._applyBitrate();
            }
        });
        // ABR toggle.
        const abrBtn = getEl('stream-abr-toggle');
        if (abrBtn) abrBtn.addEventListener('click', () => this._toggleAbr());
        this._syncAbrButton();
        // CBR toggle.
        const cbrBtn = getEl('stream-cbr-toggle');
        if (cbrBtn) cbrBtn.addEventListener('click', () => this._toggleCbr());
        this._syncCbrButton();
        const codecDd = getEl('stream-codec-dropdown');
        if (codecDd) codecDd.addEventListener('dropdown-select', (e) => {
            this._selectedCodec = e.detail.value;
            try { localStorage.setItem('slopshady.stream.codec', this._selectedCodec); } catch (err) { /* ignore */ }
        });
        // Probe codecs on load and list results in the panel (diagnostic).
        this.probeCodecs().catch((e) => console.warn('codec probe', e));
    },

    _loadPersisted() {
        try {
            const url = localStorage.getItem('slopshady.stream.gatewayUrl');
            const name = localStorage.getItem('slopshady.stream.name');
            const urlEl = getEl('stream-gateway-url');
            const nameEl = getEl('stream-name');
            if (url) { if (urlEl) urlEl.value = url; this.gatewayUrl = url; }
            if (name) { if (nameEl) nameEl.value = name; this.streamName = name; }
            const codec = localStorage.getItem('slopshady.stream.codec');
            if (codec) this._selectedCodec = codec;
            // Encoder tuning inputs (clamped at read time in start()).
            const setNum = (id, key) => {
                const v = localStorage.getItem(key);
                if (v == null) return;
                const el = getEl(id);
                if (el) el.value = v;
            };
            setNum('stream-bitrate', 'slopshady.stream.bitrate');
            setNum('stream-fps', 'slopshady.stream.fps');
            setNum('stream-latency', 'slopshady.stream.latency');
            setNum('stream-keyframe', 'slopshady.stream.keyframe');
            const abr = localStorage.getItem('slopshady.stream.abr');
            this._abrEnabled = abr === '1';
            // CBR defaults to ON; only flip off if explicitly stored as '0'.
            const cbr = localStorage.getItem('slopshady.stream.cbr');
            this._cbrEnabled = cbr === null ? true : cbr !== '0';
        } catch (e) { /* localStorage unavailable */ }
    },

    _savePersisted() {
        try {
            const urlEl = getEl('stream-gateway-url');
            const nameEl = getEl('stream-name');
            if (urlEl && urlEl.value.trim()) { this.gatewayUrl = urlEl.value.trim(); localStorage.setItem('slopshady.stream.gatewayUrl', this.gatewayUrl); }
            if (nameEl && nameEl.value.trim()) { this.streamName = nameEl.value.trim(); localStorage.setItem('slopshady.stream.name', this.streamName); }
            const saveNum = (id, key) => {
                const el = getEl(id);
                if (el && el.value !== '') localStorage.setItem(key, el.value);
            };
            saveNum('stream-bitrate', 'slopshady.stream.bitrate');
            saveNum('stream-fps', 'slopshady.stream.fps');
            saveNum('stream-latency', 'slopshady.stream.latency');
            saveNum('stream-keyframe', 'slopshady.stream.keyframe');
            localStorage.setItem('slopshady.stream.abr', this._abrEnabled ? '1' : '0');
            localStorage.setItem('slopshady.stream.cbr', this._cbrEnabled ? '1' : '0');
        } catch (e) { /* ignore */ }
    },

    async start() {
        // Read UI inputs (with defaults fallback) on every start (also covers reconnects).
        const urlEl = getEl('stream-gateway-url');
        const nameEl = getEl('stream-name');
        if (urlEl && urlEl.value.trim()) this.gatewayUrl = urlEl.value.trim();
        if (nameEl && nameEl.value.trim()) this.streamName = nameEl.value.trim();
        // Encoder tuning inputs (clamped defensively; NaN/empty → keep current).
        this._readBitrateInput();
        // Reset adaptation state at stream start — begin at the user-set target.
        this._currentBitrate = this._videoBitrate;
        this._highMarkCount = 0;
        this._lowMarkCount = 0;
        const fpsEl = getEl('stream-fps');
        if (fpsEl && fpsEl.value !== '') {
            const fps = parseInt(fpsEl.value, 10);
            if (Number.isFinite(fps)) this._fps = Math.max(1, Math.min(120, fps));
        }
        const latencyEl = getEl('stream-latency');
        if (latencyEl && latencyEl.value !== '') {
            const lat = parseInt(latencyEl.value, 10);
            if (Number.isFinite(lat)) this._latencyMs = Math.max(20, Math.min(8000, lat));
        }
        const keyframeEl = getEl('stream-keyframe');
        if (keyframeEl && keyframeEl.value !== '') {
            const kf = parseInt(keyframeEl.value, 10);
            if (Number.isFinite(kf)) this._keyframeMs = Math.max(100, Math.min(60000, kf));
        }
        this._savePersisted();

        // Reconnect-safety: tear down any stale session resources before rebuilding.
        // (stop() is the full teardown with button updates; this only clears handles.)
        if (this.worker || this.transport) this._abortSession();

        this.isStreaming = true;
        this._epoch = performance.now();
        this._handshakeDone = false;
        // Reset flow-control credits from any prior session. The worker
        // grants fresh credits at init.
        this._frameCredits = 0;

        // 1) Capability gate
        if (typeof WebTransport === 'undefined' || typeof VideoEncoder === 'undefined') {
            this._setStatus('WebTransport/WebCodecs unavailable — run with --no-browser and open https://localhost:8100 in Chrome/Edge');
            this.isStreaming = false;
            return;
        }

        // 1b) Pick a supported codec from the probe (pick a muxer-supported codec: h264/hevc/av1).
        let probe = this._codecProbe;
        if (!probe) probe = await this.probeCodecs();
        if (!probe.webcodecs) {
            this._setStatus('WebCodecs unavailable — use Chrome/Edge via --no-browser');
            this.isStreaming = false;
            return;
        }
        const usable = probe.video.filter((v) => v.supported && v.usable);
        if (!usable.length) {
            const alts = probe.video.filter((v) => v.supported).map((v) => v.codec).join(', ') || 'none';
            this._setStatus('No usable video encoder. Browser supports: ' + alts);
            this.isStreaming = false;
            return;
        }
        const sel = this._selectedCodec && usable.find((v) => v.codec === this._selectedCodec);
        this._codec = (sel || usable[0]).codec;

        if (state.audioPlayerAnalyser) {
            let opusSupported = false;
            try {
                const r = await AudioEncoder.isConfigSupported({
                    codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000,
                });
                opusSupported = !!(r && r.supported);
            } catch (e) { opusSupported = false; }
            if (!opusSupported) {
                this._setStatus('Opus AudioEncoder unsupported');
                this.isStreaming = false;
                return;
            }
        }

        // 2) Fetch server cert hash via same-origin backend proxy (honors the
        //    gateway host from this.gatewayUrl; backend ignores the self-signed
        //    Vite cert and dodges browser CORS/cert-trust issues).
        let hash = null;
        try {
            const resp = await fetch('/api/stream/cert-hash?url=' + encodeURIComponent(this.gatewayUrl), { cache: 'no-store' });
            if (!resp.ok) throw new Error('proxy HTTP ' + resp.status);
            const j = await resp.json();
            hash = j.hash ?? null;
        } catch (e) {
            this._setStatus('Cert hash fetch failed: ' + (e && e.message || e));
            this.isStreaming = false;
            this._scheduleReconnect();
            return;
        }

        // 3) Connect WebTransport
        try {
            const url = `${this.gatewayUrl}?publish=${encodeURIComponent(this.streamName)}`;
            const opts = {};
            if (hash) {
                opts.serverCertificateHashes = [{ algorithm: 'sha-256', value: this._hexToBytes(hash) }];
            }
            this.transport = new WebTransport(url, opts);
            await this.transport.ready;
            this._datagramWriter = this.transport.datagrams.writable.getWriter();
        } catch (e) {
            this._setStatus('WebTransport connect failed: ' + (e && e.message || e));
            this.isStreaming = false;
            this._scheduleReconnect();
            return;
        }

        // 4) Spawn worker (module worker; loads both WASM modules).
        //    Pass the stream-epoch (ms) so the worker can stamp audio PTS
        //    on the same clock as video.
        this.worker = new Worker('/js/features/stream-worker.js', { type: 'module' });
        this.worker.onmessage = (e) => this.onWorkerMessage(e.data);
        this._encW = state.canvas.width & ~1;
        this._encH = state.canvas.height & ~1;
        // Look up the probe result for the selected codec to find which HW
        // mode actually passed probe (HW if it was available and probed clean,
        // null if HW flaked and SW was used as fallback). Without this the
        // worker would blindly prefer-HW and could fail at encode time on the
        // same machines where the probe just flaked.
        const probeEntry = this._codecProbe && this._codecProbe.video.find(v => v.codec === this._codec);
        const videoHwMode = probeEntry ? probeEntry.hwMode : null;
        this.worker.postMessage({
            type: 'init',
            latencyMs: this._latencyMs,
            videoCodec: this._codecFamily(this._codec),
            videoCodecString: this._codec,
            videoHwMode,
            // Send _currentBitrate (which equals target when ABR is off; may
            // differ when ABR is on). Subsequent changes are pushed via
            // setBitrate messages — see _applyBitrate.
            videoBitrate: this._currentBitrate,
            videoFps: this._fps,
            cbrEnabled: this._cbrEnabled,
            encW: this._encW,
            encH: this._encH,
            keyframeMs: this._keyframeMs,
            epochMs: this._epoch,
        });

        // 5) VideoEncoder now lives in the worker (Phase 3). Main thread
        //    captures VideoFrames from the canvas and posts them transferable;
        //    the worker owns the encoder and runs Annex B / SPS-PPS / muxer.

        // 6) Audio (Opus) — AudioWorklet taps the Webamp analyser and ships
        //    Float32 frames directly to the worker via a transferred
        //    MessagePort. AudioEncoder lives in the worker (see stream-worker.js
        //    audio-port handler). Capture AND encode are off the main thread —
        //    panel reflow can no longer starve audio. Video-only fallback if the
        //    worklet fails to load.
        if (state.audioPlayerAnalyser) {
            StreamAudio.init(state.audioPlayerAnalyser, this.worker).then((ok) => {
                if (!ok) this._setStatus('Audio tap failed — streaming video-only');
            });
        }

        // 7) Receive loop (datagrams from gateway → worker)
        this._receiveLoop();

        // 8) Periodic keyframe (captureFrame handles resize reconfigure)
        this._keyframeInterval = setInterval(() => {
            this._forceKeyframe = true;
        }, this._keyframeMs);

        // 8b) Prevent the browser from throttling this tab's requestAnimationFrame
        //     when backgrounded/occluded — otherwise the render loop (and thus
        //     captureFrame) drops to ~1Hz whenever the user looks at the viewer.
        this._startAntiThrottle();

        // 9) Update buttons + status
        const startBtn = getEl('startStream');
        const stopBtn = getEl('stopStream');
        if (startBtn) startBtn.classList.add('active');
        if (stopBtn) stopBtn.classList.remove('disabled');
        this._setStatus('Connecting…');
    },

    async stop() {
        if (!this.isStreaming && !this.worker) return; // re-entrancy guard
        this.isStreaming = false;

        if (this._keyframeInterval) { clearInterval(this._keyframeInterval); this._keyframeInterval = null; }
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        this._stopAntiThrottle();

        this._handshakeDone = false;

        // VideoEncoder lives in the worker (Phase 3); it is closed when the
        // worker receives `stop` (or is terminated below).
        // Audio tap is torn down via StreamAudio (disconnects the AudioWorkletNode).
        // The AudioEncoder lives in the worker and is closed when the worker
        // receives `stop` (or is terminated below).
        StreamAudio.stop();
        if (this._receiveReader) {
            try { await this._receiveReader.cancel(); } catch (e) { /* ignore */ }
            this._receiveReader = null;
        }
        if (this._datagramWriter) {
            try { this._datagramWriter.releaseLock(); } catch (e) { /* ignore */ }
            this._datagramWriter = null;
        }
        if (this.transport) {
            try { await this.transport.close(); } catch (e) { /* ignore */ }
            this.transport = null;
        }
        if (this.worker) {
            const worker = this.worker;
            try { worker.postMessage({ type: 'stop' }); } catch (e) { /* ignore */ }
            // Give the worker up to 200ms to ack (it flushes remaining TS in
            // its stop handler). A misbehaving worker can't hang teardown.
            await new Promise((resolve) => {
                let done = false;
                const finish = () => { if (done) return; done = true; worker.removeEventListener('message', onMsg); clearTimeout(timer); resolve(); };
                const onMsg = (e) => { if (e.data && e.data.type === 'stopped') finish(); };
                const timer = setTimeout(finish, 200);
                worker.addEventListener('message', onMsg);
            });
            try { worker.terminate(); } catch (e) { /* ignore */ }
            this.worker = null;
        }

        this.datagramQueue.length = 0;
        this._flushPending = false;
        this.reconnectAttempts = 0;

        const startBtn = getEl('startStream');
        const stopBtn = getEl('stopStream');
        if (startBtn) startBtn.classList.remove('active');
        if (stopBtn) stopBtn.classList.add('disabled');
        this._setStatus('Stopped');
    },

    onWorkerMessage(msg) {
        if (msg.type === 'send') {
            if (this._datagramWriter) {
                try { this._datagramWriter.write(new Uint8Array(msg.data)); }
                catch (e) { console.warn('WT send failed', e); }
            }
        } else if (msg.type === 'handshakeComplete') {
            this._handshakeDone = true;
            this._forceKeyframe = true; // first muxed frame must be a keyframe (SPS/PPS+IDR)
            this.reconnectAttempts = 0;
            this._setStatus('Streaming · ' + this.streamName);
        } else if (msg.type === 'stats') {
            if (this._abrEnabled) this._handleAbrStats(msg.stats);
            this._renderStats(msg.stats);
        } else if (msg.type === 'log') {
            console.log('[worker]', msg.msg);
        } else if (msg.type === 'initFailed') {
            this._handleInitFailed(msg.msg);
        } else if (msg.type === 'requestKeyframe') {
            // Worker dropped a frame due to backpressure — force a keyframe on
            // the next successful capture so the viewer recovers quickly.
            this._forceKeyframe = true;
        } else if (msg.type === 'frameCredit') {
            // Worker grants credits after each encode completes (or when it
            // drops a frame). Bounded in-flight count prevents postMessage
            // backlog during slow-encode scenes.
            this._frameCredits += (typeof msg.count === 'number') ? msg.count : 1;
        } else if (msg.type === 'videoEncoderFailed') {
            this._handleVideoEncoderFailed(msg.msg);
        } else if (msg.type === 'close') {
            this._handshakeDone = false;
            this._setStatus('Stream closed');
            if (this.isStreaming) this._scheduleReconnect();
        }
    },

    async _receiveLoop() {
        const reader = this.transport.datagrams.readable.getReader();
        this._receiveReader = reader;
        try {
            while (this.isStreaming) {
                const { done, value } = await reader.read();
                if (done) break;
                this.datagramQueue.push(value.buffer);
                if (this.datagramQueue.length >= 16) {
                    this._flushIncoming();
                } else if (this._flushPending !== true) {
                    this._flushPending = true;
                    setTimeout(() => { this._flushPending = false; this._flushIncoming(); }, 0);
                }
            }
        } catch (e) {
            console.warn('recv', e);
        }
        this._flushIncoming();
    },

    _flushIncoming() {
        if (!this.datagramQueue.length || !this.worker) return;
        const batch = this.datagramQueue;
        this.datagramQueue = [];
        for (const buf of batch) {
            this.worker.postMessage({ type: 'datagram', data: buf }, [buf]);
        }
    },

    _scheduleReconnect() {
        if (this.reconnectTimer || !this.isStreaming) return;
        const delay = Math.min(2000 * (2 ** this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        this._setStatus(`Reconnecting in ${Math.round(delay / 1000)}s…`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.start();
        }, delay);
    },

    /** Worker init (WASM/muxer) failed — stop without retry, surface the reason. */
    _handleInitFailed(reason) {
        this.isStreaming = false;
        this._handshakeDone = false;
        this._abortSession();
        const startBtn = getEl('startStream');
        const stopBtn = getEl('stopStream');
        if (startBtn) startBtn.classList.remove('active');
        if (stopBtn) stopBtn.classList.add('disabled');
        this._setStatus('Init failed: ' + reason);
        // No reconnect — WASM modules won't reload without a fresh start()
        // and an immediate retry would just hit the same failure.
    },

    /** Worker's VideoEncoder rejected config or threw at runtime — stop
     *  without retry (the encoder is gone), surface the reason. */
    _handleVideoEncoderFailed(reason) {
        this.isStreaming = false;
        this._handshakeDone = false;
        this._abortSession();
        const startBtn = getEl('startStream');
        const stopBtn = getEl('stopStream');
        if (startBtn) startBtn.classList.remove('active');
        if (stopBtn) stopBtn.classList.add('disabled');
        this._setStatus('VideoEncoder error: ' + reason);
        // No reconnect — a runtime encoder failure would just recur.
    },

    /** Called from the render loop (core.js) each frame while streaming.
     *  Captures one even-dimensioned VideoFrame (H.264 rejects odd sizes) and
     *  transfers it to the worker; the worker owns the VideoEncoder. */
    captureFrame() {
        if (!this.worker || !this._handshakeDone) return;
        // Flow control: skip capture if worker hasn't granted a credit. This
        // is the critical guard against postMessage backlog during complex
        // scenes where the encoder can't keep up with capture rate.
        if (this._frameCredits <= 0) return;
        // rAF-driven wakeup for the worker's SRT poll. The oscillator on the
        // main thread keeps rAF (and thus this tick) alive when the tab is
        // backgrounded; the worker's setInterval(10) is a fallback that can
        // be throttled to ~1Hz without this.
        this.worker.postMessage({ type: 'tick' });
        const ew = state.canvas.width & ~1;
        const eh = state.canvas.height & ~1;
        if (ew < 2 || eh < 2) return;
        if (ew !== this._encW || eh !== this._encH) {
            this._encW = ew;
            this._encH = eh;
            // Canvas resized — the cached codec-support probe was taken at the
            // previous dims; AV1 HW encoders in particular have level/dim caps.
            // Invalidate so the next start() re-probes at the new resolution.
            this._codecProbe = null;
            // Worker owns the VideoEncoder — tell it to reconfigure for new dims.
            this.worker.postMessage({ type: 'resize', width: ew, height: eh });
            this._forceKeyframe = true;
        }
        const frame = new VideoFrame(state.canvas, {
            timestamp: (performance.now() - this._epoch) * 1000,
            visibleRect: { x: 0, y: 0, width: ew, height: eh },
        });
        this.worker.postMessage({
            type: 'frame',
            frame,
            isKey: this._forceKeyframe,
        }, [frame]);
        this._forceKeyframe = false;
        this._frameCredits--;
    },

    _codecFamily(codec) {
        const c = (codec || '').toLowerCase();
        if (c.startsWith('av01')) return 'av1';
        if (c.startsWith('hev1') || c.startsWith('hvc1')) return 'hevc';
        if (c.startsWith('avc1') || c.startsWith('avc3')) return 'h264';
        if (c.startsWith('vp09')) return 'vp9';
        return 'other';
    },

    /** Read #stream-bitrate (Mbps) into _videoBitrate (bps), clamped. */
    _readBitrateInput() {
        const el = getEl('stream-bitrate');
        if (!el || el.value === '') return;
        const mbps = parseFloat(el.value);
        if (Number.isFinite(mbps)) {
            this._videoBitrate = Math.max(100_000, Math.min(100_000_000, Math.round(mbps * 1e6)));
        }
    },

    /** Push the current bitrate to the worker's VideoEncoder. Called on ABR
     *  shifts and on manual bitrate-slider changes. The worker reconfigures
     *  its encoder; if no encoder is live yet, the value is captured at init. */
    _applyBitrate() {
        if (!this.worker) return;
        try { this.worker.postMessage({ type: 'setBitrate', bitrate: this._currentBitrate }); }
        catch (e) { console.warn('[ABR] apply failed', e); }
    },

    _toggleAbr() {
        this._abrEnabled = !this._abrEnabled;
        this._highMarkCount = 0;
        this._lowMarkCount = 0;
        // On either transition, snap back to the user-set target so the user
        // sees a known-good baseline. Adaptation will resume from here if ON.
        this._currentBitrate = this._videoBitrate;
        this._applyBitrate();
        this._syncAbrButton();
        try { localStorage.setItem('slopshady.stream.abr', this._abrEnabled ? '1' : '0'); } catch (e) { /* ignore */ }
        console.log('[ABR]', this._abrEnabled ? 'enabled' : 'disabled', 'bitrate', this._currentBitrate);
    },

    _syncAbrButton() {
        const btn = getEl('stream-abr-toggle');
        if (btn) btn.classList.toggle('active', !!this._abrEnabled);
    },

    /** Toggle CBR/VBR. Pushes the new mode to the worker, which reconfigures
     *  its VideoEncoder. CBR is the safer default for streaming — predictable
     *  bitrate, no burst risk during complex scenes. VBR gives higher
     *  instantaneous quality at the cost of burst risk. */
    _toggleCbr() {
        this._cbrEnabled = !this._cbrEnabled;
        this._syncCbrButton();
        try { localStorage.setItem('slopshady.stream.cbr', this._cbrEnabled ? '1' : '0'); } catch (e) { /* ignore */ }
        if (this.worker) {
            try { this.worker.postMessage({ type: 'setBitrateMode', cbr: this._cbrEnabled }); }
            catch (e) { console.warn('[CBR] apply failed', e); }
        }
        console.log('[CBR]', this._cbrEnabled ? 'enabled (constant)' : 'disabled (variable)');
    },

    _syncCbrButton() {
        const btn = getEl('stream-cbr-toggle');
        if (btn) btn.classList.toggle('active', !!this._cbrEnabled);
    },

    /**
     * Adaptive bitrate: watch SRT sender queue depth (txBuffered, in packets)
     * and step the encoder bitrate down when the network can't keep up, back
     * up when it recovers. Hysteresis via consecutive-sample counts. All
     * shifts are logged to the console as `[ABR] …` for tuning. Constants
     * are starting guesses — see the `_ABR_*` fields at the top of this module.
     */
    _handleAbrStats(s) {
        const txb = s.txBuffered || 0;
        if (txb > this._ABR_HIGH_MARK) {
            this._highMarkCount++;
            this._lowMarkCount = 0;
            if (this._highMarkCount >= this._ABR_HIGH_CONSEC && this._currentBitrate > this._ABR_MIN_BITRATE) {
                const from = this._currentBitrate;
                this._currentBitrate = Math.max(this._ABR_MIN_BITRATE, Math.round(this._currentBitrate * this._ABR_DOWN_FACTOR));
                this._applyBitrate();
                console.log('[ABR] downshift', { txBuffered: txb, from, to: this._currentBitrate });
                this._highMarkCount = 0;
            }
        } else if (txb < this._ABR_LOW_MARK) {
            this._lowMarkCount++;
            this._highMarkCount = 0;
            if (this._lowMarkCount >= this._ABR_LOW_CONSEC && this._currentBitrate < this._videoBitrate) {
                const from = this._currentBitrate;
                this._currentBitrate = Math.min(this._videoBitrate, Math.round(this._currentBitrate * this._ABR_UP_FACTOR));
                this._applyBitrate();
                console.log('[ABR] upshift', { txBuffered: txb, from, to: this._currentBitrate });
                this._lowMarkCount = 0;
            }
        } else {
            this._highMarkCount = 0;
            this._lowMarkCount = 0;
        }
    },

    _setStatus(s) {
        const el = getEl('stream-status');
        if (el) el.textContent = s;
    },

    _renderStats(s) {
        const el = getEl('stream-stats');
        if (el && s) {
            const mbps = (s.bandwidthBps || 0) / 1e6;
            const abrTag = this._abrEnabled ? ' ABR' : '';
            el.textContent = `↑${mbps.toFixed(1)}Mbps${abrTag} · RTT ${(s.rttMs || 0).toFixed(0)}ms · txLoss ${Math.round(s.txLoss || 0)} · txRetx ${Math.round(s.txRetransmit || 0)} · txBuf ${Math.round(s.txBuffered || 0)}`;
        }
        const cfgEl = getEl('stream-config');
        if (cfgEl) {
            const w = this._encW || (state.canvas.width & ~1);
            const h = this._encH || (state.canvas.height & ~1);
            const cur = (this._currentBitrate / 1e6).toFixed(1);
            const tgt = (this._videoBitrate / 1e6).toFixed(1);
            const bitrateStr = (this._abrEnabled && this._currentBitrate !== this._videoBitrate)
                ? `${cur}Mbps→${tgt}Mbps (adapted)`
                : `${tgt}Mbps`;
            cfgEl.textContent = `${this._codec} · ${w}x${h} · ${bitrateStr} · ${this._fps}fps · keyframe ${this._keyframeMs}ms · latency ${this._latencyMs}ms`;
        }
    },

    /** Probe VideoEncoder/AudioEncoder codec support; cache + render in the panel.
     *  For H.264/HEVC/AV1, probes HW first then falls back to SW — without the SW
     *  fallback, the supported list goes intermittent because the HW probe
     *  (NVENC session limit, GPU process mid-init after refresh, OS power-state
     *  GPU switch) can flake even when SW encode (always bundled with Chrome)
     *  would work fine. */
    async probeCodecs() {
        const out = { webcodecs: typeof VideoEncoder !== 'undefined', video: [], audio: [] };
        const w = (state.canvas && state.canvas.width) || 1280;
        const h = (state.canvas && state.canvas.height) || 720;
        if (out.webcodecs) {
            for (const c of this._videoCandidates) {
                let ok = false;
                let hwMode = null;  // null = SW, 'prefer-hardware' = HW passed
                try {
                    const fam = this._codecFamily(c.codec);
                    const baseCfg = {
                        codec: c.codec, width: w, height: h,
                        bitrate: this._videoBitrate, framerate: this._fps, latencyMode: 'realtime',
                    };
                    if (fam === 'h264' || fam === 'hevc' || fam === 'av1') {
                        // Try HW first; if it fails (intermittent HW availability),
                        // fall back to SW — Chrome always bundles openh264 for H.264.
                        const hwR = await VideoEncoder.isConfigSupported({
                            ...baseCfg, hardwareAcceleration: 'prefer-hardware',
                        });
                        if (hwR && hwR.supported) {
                            ok = true;
                            hwMode = 'prefer-hardware';
                        } else {
                            const swR = await VideoEncoder.isConfigSupported(baseCfg);
                            ok = !!(swR && swR.supported);
                            hwMode = null;
                        }
                    } else {
                        const r = await VideoEncoder.isConfigSupported(baseCfg);
                        ok = !!(r && r.supported);
                        hwMode = null;
                    }
                } catch (e) { ok = false; hwMode = null; }
                out.video.push({ ...c, supported: ok, hwMode });
            }
            for (const c of this._audioCandidates) {
                let ok = false;
                try {
                    const r = await AudioEncoder.isConfigSupported({
                        codec: c.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000,
                    });
                    ok = !!(r && r.supported);
                } catch (e) { ok = false; }
                out.audio.push({ ...c, supported: ok });
            }
        }
        this._codecProbe = out;
        this._renderCodecs(out);
        this._renderCodecDropdown(out);
        return out;
    },

    /** Populate the codec dropdown with supported+usable candidates, grouped by
     *  family. Default selection: persisted codec if still usable, else first
     *  supported AV1, else first usable entry. */
    _renderCodecDropdown(probe) {
        const menu = getEl('stream-codec-menu');
        if (!menu || !probe) return;
        const usable = probe.video.filter((v) => v.supported && v.usable);
        const labelFor = (codec) => (usable.find((v) => v.codec === codec) || {}).label || codec;
        const familyOrder = ['h264', 'hevc', 'av1', 'vp9'];
        const familyLabel = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' };
        // Persisted selection honored only if still usable; else prefer AV1,
        // else fall back to the first usable entry (current behavior).
        const persisted = this._selectedCodec && usable.find((v) => v.codec === this._selectedCodec)
            ? this._selectedCodec : null;
        const chosen = persisted
            || (usable.find((v) => v.codec.startsWith('av01')) || {}).codec
            || (usable[0] || {}).codec
            || null;
        this._selectedCodec = chosen;
        menu.innerHTML = '';
        for (const fam of familyOrder) {
            const entries = usable.filter((v) => v.family === fam);
            if (!entries.length) continue;
            const header = document.createElement('div');
            header.className = 'dropdown__item dropdown__item--header';
            header.textContent = familyLabel[fam] || fam.toUpperCase();
            menu.appendChild(header);
            for (const v of entries) {
                const item = document.createElement('div');
                item.className = 'dropdown__item' + (v.codec === chosen ? ' active' : '');
                item.dataset.value = v.codec;
                item.textContent = v.label;
                menu.appendChild(item);
            }
        }
        const span = document.querySelector('#stream-codec-dropdown .dropdown__selected span');
        if (span && chosen) span.textContent = labelFor(chosen);
    },

    _renderCodecs(probe) {
        const el = getEl('stream-codecs');
        if (!el) return;
        if (!probe) { el.textContent = ''; return; }
        if (!probe.webcodecs) {
            el.textContent = 'WebCodecs unavailable — open in Chrome/Edge (--no-browser)';
            return;
        }
        // Only list supported encoders — hides unsupported candidates so the
        // panel reflects what's actually selectable in the dropdown.
        const lines = [];
        for (const v of probe.video) {
            if (!v.supported) continue;
            let line = `${v.label}`;
            if (v.note) line += ` — ${v.note}`;
            lines.push(line);
        }
        for (const a of probe.audio) {
            if (!a.supported) continue;
            let line = `${a.label}`;
            if (a.note) line += ` — ${a.note}`;
            lines.push(line);
        }
        el.textContent = lines.join('\n');
    },

    _hexToBytes(hex) {
        if (hex.length !== 64) throw new Error('cert hash must be 64 hex chars, got ' + hex.length);
        const bytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    },

    /**
     * Play a near-silent oscillator so the browser treats this tab as producing
     * audio and does NOT throttle its requestAnimationFrame when backgrounded or
     * occluded. Without this, the WebGL render loop (and captureFrame) drops to
     * ~1Hz whenever the user switches to the viewer tab, collapsing the stream.
     */
    _startAntiThrottle() {
        if (this._antiThrottle) return;
        try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            g.gain.value = 0.0001;
            osc.connect(g).connect(ctx.destination);
            osc.start();
            this._antiThrottle = { ctx, osc };
            if (ctx.state === 'suspended') ctx.resume().catch(() => { /* ignore */ });
        } catch (e) { /* Web Audio unavailable; tab will throttle if backgrounded */ }
    },

    _stopAntiThrottle() {
        if (!this._antiThrottle) return;
        try { this._antiThrottle.osc.stop(); } catch (e) { /* ignore */ }
        try { this._antiThrottle.ctx.close(); } catch (e) { /* ignore */ }
        this._antiThrottle = null;
    },

    /**
     * Tear down the live session handles WITHOUT flipping button state. Used at
     * the top of start() on a reconnect so we don't leak a second worker/transport.
     */
    _abortSession() {
        if (this._keyframeInterval) { clearInterval(this._keyframeInterval); this._keyframeInterval = null; }
        this._stopAntiThrottle();
        if (this._receiveReader) { try { this._receiveReader.cancel(); } catch (e) { /* ignore */ } this._receiveReader = null; }
        // VideoEncoder lives in the worker (Phase 3); terminating the worker reaps it.
        StreamAudio.stop();
        if (this.transport) { try { this.transport.close(); } catch (e) { /* ignore */ } this.transport = null; }
        if (this.worker) { try { this.worker.terminate(); } catch (e) { /* ignore */ } this.worker = null; }
        this.datagramQueue.length = 0;
        this._flushPending = false;
    },
};

if (typeof window !== 'undefined') { window.StreamingUI = StreamingUI; window.__state = state; }
