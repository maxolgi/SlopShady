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
 * Conventions: singleton object, init() wires DOM buttons via getEl, state
 * read from ../state.js. Streaming is frontend-local state — it does NOT use
 * Sync.send().
 */
import { state, getEl } from '../state.js';
import { StreamAudio } from '../features/stream-audio.js';

const RECONNECT_RETRY_MS = 100;

const TIMER_WORKER_SRC = `
let id = null;
onmessage = (e) => {
  if (typeof e.data === 'number') {
    if (id) clearInterval(id);
    id = setInterval(() => postMessage('tick'), e.data);
  } else if (e.data === 'stop') {
    if (id) { clearInterval(id); id = null; }
  }
};
`;

export const StreamingUI = {
    // ---- runtime handles ----
    worker: null,
    transport: null,
    isStreaming: false,
    isRecording: false,
    _spawnedFresh: false,
    _epoch: 0,
    _forceKeyframe: false,
    _handshakeDone: false,
    // Backgrounded-tab timer worker. When the tab is hidden, requestAnimationFrame
    // throttles to ~1Hz which would collapse the capture pump; this worker posts
    // 'tick' at 1000/_fps to keep captureFrame() running at the target framerate.
    // Null when the tab is visible (the render loop's rAF drives capture instead).
    _bgWorker: null,
    // Bound visibilitychange listener, stored so stop()/_abortSession() can remove it.
    _visHandler: null,
    // Flow-control credits: worker grants N credits (initial 4, then 1 per
    // encoded chunk emitted). Main decrements per frame sent and refuses to
    // send when 0. Bounds the in-flight frame count between main and worker
    // so complex scenes that slow the encoder can't accumulate an unbounded
    // backlog in the postMessage queue (which would arrive at the muxer as a
    // stale-PTS burst and surface as TS CC errors + pixilation on the viewer).
    _frameCredits: 0,
    datagramQueue: [],
    reconnectTimer: null,
    reconnectAttempts: 0,
    _closing: false,
    _wantStream: false,
    _receiveReader: null,
    _lastEncDims: null,
    _encW: 0,
    _encH: 0,
    _flushPending: false,

    // ---- config ----
    gatewayUrl: 'https://127.0.0.1:4433/wt',
    gatewayWebPort: 5173,
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
        if (!startBtn) return;
        startBtn.addEventListener('click', () => this.isStreaming ? this.stop() : this.start());
        const recBtn = getEl('streamRecord');
        if (recBtn) recBtn.addEventListener('click', () => this.isRecording ? this.stopRecord() : this.startRecord());
        // Restore last-used gateway URL / stream name (overrides HTML defaults).
        this._loadPersisted();
        const urlEl = getEl('stream-gateway-url');
        const nameEl = getEl('stream-name');
        const webPortEl = getEl('stream-gateway-web-port');
        if (urlEl) urlEl.addEventListener('change', () => this._savePersisted());
        if (nameEl) nameEl.addEventListener('change', () => this._savePersisted());
        if (webPortEl) webPortEl.addEventListener('change', () => this._savePersisted());
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
            const webPortEl = getEl('stream-gateway-web-port');
            if (url) { if (urlEl) urlEl.value = url; this.gatewayUrl = url; }
            if (name) { if (nameEl) nameEl.value = name; this.streamName = name; }
            const webPort = localStorage.getItem('slopshady.stream.gatewayWebPort');
            if (webPort) { if (webPortEl) webPortEl.value = webPort; this.gatewayWebPort = Number(webPort) || 5173; }
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
            const webPortEl = getEl('stream-gateway-web-port');
            if (urlEl && urlEl.value.trim()) { this.gatewayUrl = urlEl.value.trim(); localStorage.setItem('slopshady.stream.gatewayUrl', this.gatewayUrl); }
            if (nameEl && nameEl.value.trim()) { this.streamName = nameEl.value.trim(); localStorage.setItem('slopshady.stream.name', this.streamName); }
            if (webPortEl && webPortEl.value.trim()) { this.gatewayWebPort = Number(webPortEl.value) || 5173; localStorage.setItem('slopshady.stream.gatewayWebPort', String(this.gatewayWebPort)); }
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

    /**
     * Bring up the shared capture → encode → mux pipeline if it isn't already
     * running: worker (VideoEncoder + TsMuxer + SRT receiver WASM), audio tap,
     * and the background-tab capture keep-alive. Idempotent — a no-op when a
     * worker is already alive (e.g. record started while streaming). Sets
     * `_spawnedFresh` so callers know whether they're driving a fresh worker.
     *
     * Stream and record SHARE this pipeline. The WebTransport transport is
     * wired separately by start(); recording is engaged by posting `startRecord`
     * to the worker (buffering muxed TS for a .ts download on stop).
     *
     * Returns false (with a status message) if WebCodecs/codec setup fails.
     */
    async _ensurePipeline() {
        // Encoder tuning inputs (clamped defensively; NaN/empty → keep current).
        this._readBitrateInput();
        // Reset adaptation state — begin at the user-set target.
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

        // Capability gate (WebCodecs required for both stream and record).
        if (typeof VideoEncoder === 'undefined') {
            this._setStatus('WebCodecs unavailable — use Chrome/Edge via --no-browser');
            return false;
        }

        // Pick a supported codec from the probe (muxer-supported: h264/hevc/av1).
        let probe = this._codecProbe;
        if (!probe) probe = await this.probeCodecs();
        if (!probe.webcodecs) {
            this._setStatus('WebCodecs unavailable — use Chrome/Edge via --no-browser');
            return false;
        }
        const usable = probe.video.filter((v) => v.supported && v.usable);
        if (!usable.length) {
            const alts = probe.video.filter((v) => v.supported).map((v) => v.codec).join(', ') || 'none';
            this._setStatus('No usable video encoder. Browser supports: ' + alts);
            return false;
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
                return false;
            }
        }

        // Pipeline already up (e.g. record started while streaming) — reuse it.
        if (this.worker) { this._spawnedFresh = false; return true; }

        this._epoch = performance.now();
        this._handshakeDone = false;
        // Reset flow-control credits from any prior session. The worker grants
        // fresh credits at init.
        this._frameCredits = 0;
        this._encW = state.canvas.width & ~1;
        this._encH = state.canvas.height & ~1;

        // Spawn the module worker (loads both WASM modules). Pass the stream-
        // epoch (ms) so the worker can stamp audio PTS on the same clock as video.
        this.worker = new Worker('/js/features/stream-worker.js', { type: 'module' });
        this.worker.onmessage = (e) => this.onWorkerMessage(e.data);
        // Look up the probe result for the selected codec to find which HW mode
        // actually passed probe (HW if available and clean, null if HW flaked
        // and SW was the fallback). Without this the worker would blindly
        // prefer-HW and could fail at encode time where the probe just flaked.
        const probeEntry = this._codecProbe && this._codecProbe.video.find(v => v.codec === this._codec);
        const videoHwMode = probeEntry ? probeEntry.hwMode : null;
        this.worker.postMessage({
            type: 'init',
            latencyMs: this._latencyMs,
            initialRttMs: this._initialRttMs,
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

        // Audio (Opus) — AudioWorklet taps the Webamp analyser and ships Float32
        // frames directly to the worker via a transferred MessagePort. The
        // AudioEncoder lives in the worker. Video-only fallback on worklet failure.
        if (state.audioPlayerAnalyser) {
            StreamAudio.init(state.audioPlayerAnalyser, this.worker).then((ok) => {
                if (!ok) this._setStatus('Audio tap failed — ' + (this.isRecording ? 'recording' : 'streaming') + ' video-only');
            });
        }

        // Keep captureFrame() alive when this tab is backgrounded. rAF throttles
        // to ~1Hz in background tabs, so spawn a timer worker that ticks at the
        // target fps; terminate it again on return to the foreground.
        this._visHandler = () => {
            if (document.hidden) this._startBgTimer();
            else this._stopBgTimer();
        };
        document.addEventListener('visibilitychange', this._visHandler);
        if (document.hidden) this._startBgTimer();

        this._spawnedFresh = true;
        return true;
    },

    async start() {
        // Stream-specific inputs (gateway URL / name / web port).
        const urlEl = getEl('stream-gateway-url');
        const nameEl = getEl('stream-name');
        const webPortEl = getEl('stream-gateway-web-port');
        if (urlEl && urlEl.value.trim()) this.gatewayUrl = urlEl.value.trim();
        if (nameEl && nameEl.value.trim()) this.streamName = nameEl.value.trim();
        if (webPortEl && webPortEl.value.trim()) this.gatewayWebPort = Number(webPortEl.value) || 5173;
        this._savePersisted();

        // Reconnect-safety: if a stale transport exists (manual re-start while
        // streaming, or a half-torn-down session), tear it down before rebuilding.
        // _abortSession posts `stop` to the worker so an in-flight recording is
        // finalized/delivered; isRecording (user intent) persists and is resumed
        // on the fresh worker below. A worker-only session (recording with no
        // transport) is REUSED as the shared pipeline — recording is uninterrupted.
        if (this.transport) await this._abortSession();

        if (!(await this._ensurePipeline())) return;

        this.isStreaming = true;
        this._handshakeDone = false;
        this._frameCredits = 0;
        // Resume recording on a freshly-spawned worker if the user was recording
        // (e.g. stream reconnect mid-record → the prior segment was already
        // delivered as a .ts; this starts a new segment on the new worker).
        // When the worker was reused (start stream while recording), recording
        // is already active — do NOT re-post startRecord (would wipe the buffer).
        if (this.isRecording && this._spawnedFresh && this.worker) {
            try { this.worker.postMessage({ type: 'startRecord' }); } catch (e) { /* ignore */ }
        }

        // Capability gate (WebTransport — stream-specific).
        if (typeof WebTransport === 'undefined') {
            this._setStatus('WebTransport unavailable — run with --no-browser and open https://localhost:8100 in Chrome/Edge');
            this.isStreaming = false;
            return;
        }

        this._wantStream = true;

        // Try direct WebTransport (CA validation) first — works for real certs.
        // Falls back to hash pinning via backend proxy for self-signed certs.
        const wtUrl = `${this.gatewayUrl}?publish=${encodeURIComponent(this.streamName)}`;
        let connected = false;

        try {
            this.transport = new WebTransport(wtUrl);
            await this.transport.ready;
            connected = true;
        } catch (directErr) {
            // Likely self-signed cert — fetch hash via backend proxy and retry with pinning
            let hash = null;
            try {
                const resp = await fetch('/api/stream/cert-hash?url=' + encodeURIComponent(this.gatewayUrl) + '&webPort=' + this.gatewayWebPort, { cache: 'no-store' });
                if (!resp.ok) throw new Error('proxy HTTP ' + resp.status);
                hash = (await resp.json()).hash ?? null;
            } catch (e) {
                this._setStatus('WebTransport failed and cert hash fetch failed: ' + (e && e.message || e));
                this.isStreaming = false;
                this._scheduleReconnect();
                return;
            }
            if (!hash) {
                this._setStatus('WebTransport failed and no cert hash available from gateway');
                this.isStreaming = false;
                this._scheduleReconnect();
                return;
            }
            try {
                this.transport = new WebTransport(wtUrl, {
                    serverCertificateHashes: [{ algorithm: 'sha-256', value: this._hexToBytes(hash) }],
                });
                await this.transport.ready;
                connected = true;
            } catch (e) {
                this._setStatus('WebTransport connect failed: ' + (e && e.message || e));
                this.isStreaming = false;
                this._scheduleReconnect();
                return;
            }
        }

        if (!connected) {
            this.isStreaming = false;
            this._scheduleReconnect();
            return;
        }

        this._closing = false;
        this.transport.closed.then(
            () => this._handleTransportDrop(),
            () => this._handleTransportDrop(),
        );

        // Datagram writer.
        this._datagramWriter = this.transport.datagrams.writable.getWriter();
        try {
            const wtStats = await this.transport.getStats();
            if (wtStats && typeof wtStats.smoothedRtt === 'number' && wtStats.smoothedRtt > 0) this._initialRttMs = wtStats.smoothedRtt;
        } catch { /* getStats not supported */ }

        // Receive loop (datagrams from gateway → worker).
        this._receiveLoop();

        // Buttons + status.
        const startBtn = getEl('startStream');
        if (startBtn) startBtn.classList.add('active');
        this._setStatus('Connecting…');
    },

    /**
     * Begin recording to a .ts file via the WebSRT encoder. Spawns the shared
     * pipeline if no stream is active (standalone record); otherwise engages
     * the record sink on the existing worker (record-while-streaming). The
     * worker buffers muxed TS; stopRecord() (or any teardown) delivers it.
     */
    async startRecord() {
        if (this.isRecording) return;
        this.isRecording = true;   // set intent before _ensurePipeline so it's reflected on spawn
        if (!(await this._ensurePipeline())) {
            this.isRecording = false;
            return;
        }
        if (this.worker) {
            try { this.worker.postMessage({ type: 'startRecord' }); } catch (e) { /* ignore */ }
        }
        const btn = getEl('streamRecord');
        if (btn) btn.classList.add('active');
        if (!this.isStreaming) this._setStatus('Recording · ' + this.streamName);
    },

    /**
     * Stop recording and download the .ts. If a stream is active, the pipeline
     * stays up for streaming; otherwise it is torn down (it only existed for
     * the recording).
     */
    async stopRecord() {
        if (!this.isRecording) return;
        this.isRecording = false;
        if (this.worker) {
            try { this.worker.postMessage({ type: 'stopRecord' }); } catch (e) { /* ignore */ }
            // 'recordData' arrives via onWorkerMessage → _downloadRecord.
        }
        const btn = getEl('streamRecord');
        if (btn) btn.classList.remove('active');
        if (!this.isStreaming) {
            // Pipeline only existed for the recording — tear it down. The worker's
            // stop handler is a no-op for recording (stopRecord already finalized).
            await this._abortSession();
            this._setStatus('Stopped');
        }
    },

    /** Build a .ts Blob from the worker's buffer and trigger a download. */
    _downloadRecord(buffer) {
        try {
            const blob = new Blob([buffer], { type: 'video/mp2t' });
            const url = URL.createObjectURL(blob);
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const a = document.createElement('a');
            a.href = url;
            a.download = `slopshady-${ts}.ts`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { console.warn('record download failed', e); }
    },

    async stop() {
        if (!this.isStreaming && !this.worker) return; // re-entrancy guard
        this.isStreaming = false;
        this._wantStream = false;

        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

        if (this.isRecording) {
            // Recording owns the pipeline now — drop ONLY the transport so
            // capture + encode keep running for the .ts sink.
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
            this._handshakeDone = false;
        } else {
            // Full teardown — worker `stop` finalizes any in-flight recording
            // (none here, isRecording is false) before terminate.
            await this._abortSession();
        }

        this.reconnectAttempts = 0;

        const startBtn = getEl('startStream');
        if (startBtn) startBtn.classList.remove('active');
        this._setStatus(this.isRecording ? ('Recording · ' + this.streamName) : 'Stopped');
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
        } else if (msg.type === 'recordData') {
            // Finalized .ts from the worker (stopRecord, or a teardown while
            // recording was active). Download it.
            this._downloadRecord(msg.data);
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
        if (this.isStreaming) this._handleTransportDrop();
    },

    _flushIncoming() {
        if (!this.datagramQueue.length || !this.worker) return;
        const batch = this.datagramQueue;
        this.datagramQueue = [];
        for (const buf of batch) {
            this.worker.postMessage({ type: 'datagram', data: buf }, [buf]);
        }
    },

    _handleTransportDrop() {
        if (!this.isStreaming || this._closing || this.reconnectTimer) return;
        this._abortSession();
        this._handshakeDone = false;
        this._setStatus('Stream closed');
        this._scheduleReconnect();
    },

    _scheduleReconnect() {
        if (this.reconnectTimer || !this._wantStream) return;
        const immediate = this.reconnectAttempts === 0;
        this.reconnectAttempts++;
        this._setStatus('Reconnecting…');
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.start();
        }, immediate ? 0 : RECONNECT_RETRY_MS);
    },

    /** Worker init (WASM/muxer) failed — stop without retry, surface the reason. */
    _handleInitFailed(reason) {
        this.isStreaming = false;
        this._handshakeDone = false;
        this._clearRecordOnAbort();
        this._abortSession();
        const startBtn = getEl('startStream');
        if (startBtn) startBtn.classList.remove('active');
        this._setStatus('Init failed: ' + reason);
        // No reconnect — WASM modules won't reload without a fresh start()
        // and an immediate retry would just hit the same failure.
    },

    /** Worker's VideoEncoder rejected config or threw at runtime — stop
     *  without retry (the encoder is gone), surface the reason. */
    _handleVideoEncoderFailed(reason) {
        this.isStreaming = false;
        this._handshakeDone = false;
        this._clearRecordOnAbort();
        this._abortSession();
        const startBtn = getEl('startStream');
        if (startBtn) startBtn.classList.remove('active');
        this._setStatus('VideoEncoder error: ' + reason);
        // No reconnect — a runtime encoder failure would just recur.
    },

    /** Called from the render loop (core.js) each frame while streaming.
     *  Captures one even-dimensioned VideoFrame (H.264 rejects odd sizes) and
     *  transfers it to the worker; the worker owns the VideoEncoder. */
    captureFrame() {
        if (!this.worker || !(this._handshakeDone || this.isRecording)) return;
        // Flow control: skip capture if worker hasn't granted a credit. This
        // is the critical guard against postMessage backlog during complex
        // scenes where the encoder can't keep up with capture rate.
        if (this._frameCredits <= 0) return;
        // rAF-driven wakeup for the worker's SRT poll. When the tab is
        // backgrounded a timer worker drives this tick at the target fps (rAF
        // would otherwise throttle to ~1Hz); the worker's setInterval(10) is a
        // fallback that can be throttled without it.
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
            const entry = this._codecProbe && this._codecProbe.video.find(v => v.codec === this._codec);
            const hwTag = entry && entry.hwMode === 'prefer-hardware' ? 'HW' : 'SW';
            cfgEl.textContent = `${this._codec} · ${hwTag} · ${w}x${h} · ${bitrateStr} · ${this._fps}fps · keyframe ${this._keyframeMs}ms · latency ${this._latencyMs}ms`;
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
        // Even-clamp to match the worker's encW/encH (canvas.width & ~1) so the
        // probe tests the exact dims the encoder will be configured with.
        const w = ((state.canvas && state.canvas.width) || 1280) & ~1;
        const h = ((state.canvas && state.canvas.height) || 720) & ~1;
        if (out.webcodecs) {
            for (const c of this._videoCandidates) {
                let ok = false;
                let hwMode = null;  // null = SW, 'prefer-hardware' = HW passed
                try {
                    const fam = this._codecFamily(c.codec);
                    // Align with the worker's videoConfig(): include bitrateMode
                    // and avc.format so isConfigSupported reflects the config the
                    // encoder will actually receive (avoids the probe claiming HW
                    // supported for a config the worker never sends).
                    const baseCfg = {
                        codec: c.codec, width: w, height: h,
                        bitrate: this._videoBitrate, framerate: this._fps, latencyMode: 'realtime',
                        bitrateMode: this._cbrEnabled ? 'constant' : 'variable',
                    };
                    if (fam === 'h264') baseCfg.avc = { format: 'avc' };
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
            const hw = v.hwMode === 'prefer-hardware' ? 'HW' : 'SW';
            let line = `${v.label} · ${hw}`;
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
     * Spawn the backgrounded-tab timer worker. Posts 'tick' at 1000/_fps; each
     * tick calls captureFrame(). Kept in sync with the WebSRT demo's schedulePump.
     */
    _startBgTimer() {
        if (this._bgWorker) return;
        try {
            const w = new Worker(URL.createObjectURL(new Blob([TIMER_WORKER_SRC], { type: 'application/javascript' })));
            w.onmessage = () => this.captureFrame();
            w.postMessage(1000 / this._fps);
            this._bgWorker = w;
        } catch (e) { /* Worker unavailable; rAF continues but throttles when backgrounded */ }
    },

    _stopBgTimer() {
        if (!this._bgWorker) return;
        try { this._bgWorker.terminate(); } catch (e) { /* ignore */ }
        this._bgWorker = null;
    },

    /**
     * Clear the record intent + button when the pipeline is being torn down for
     * an unrecoverable reason (init/encoder failure). The worker's `stop`
     * handler (invoked by _abortSession) still finalizes + delivers the .ts
     * recorded so far; this just resets local UI state.
     */
    _clearRecordOnAbort() {
        if (!this.isRecording) return;
        this.isRecording = false;
        const btn = getEl('streamRecord');
        if (btn) btn.classList.remove('active');
    },

    /**
     * Tear down the live session handles WITHOUT flipping button state. Used by
     * reconnect-safety and transport-drop. Posts `stop` to the worker so it can
     * flush + finalize any in-flight recording (delivering a .ts via
     * 'recordData'), then terminates after a short grace. Async — callers that
     * rebuild immediately should await to avoid spawning a second worker while
     * the old one finalizes.
     */
    async _abortSession() {
        this._closing = true;
        if (this._visHandler) { document.removeEventListener('visibilitychange', this._visHandler); this._visHandler = null; }
        this._stopBgTimer();
        if (this._receiveReader) { try { this._receiveReader.cancel(); } catch (e) { /* ignore */ } this._receiveReader = null; }
        // VideoEncoder lives in the worker (Phase 3); terminating the worker reaps it.
        StreamAudio.stop();
        if (this.transport) { try { this.transport.close(); } catch (e) { /* ignore */ } this.transport = null; }
        if (this._datagramWriter) { try { this._datagramWriter.releaseLock(); } catch (e) { /* ignore */ } this._datagramWriter = null; }
        // Null the worker reference SYNCHRONOUSLY before awaiting, so a concurrent
        // start()/_ensurePipeline (e.g. a reconnect timer firing during the stop
        // grace window) sees no worker and spawns a fresh one instead of reusing
        // one that is mid-finalization. The finalize still runs against the local
        // reference; recordData/stopped are handled by onWorkerMessage + the temp
        // listener below (neither depends on this.worker).
        const worker = this.worker;
        this.worker = null;
        if (worker) {
            try { worker.postMessage({ type: 'stop' }); } catch (e) { /* ignore */ }
            // Give the worker up to 200ms to ack (it flushes remaining TS and
            // finalizes a recording in its stop handler). A misbehaving worker
            // can't hang teardown.
            await new Promise((resolve) => {
                let done = false;
                const finish = () => { if (done) return; done = true; worker.removeEventListener('message', onMsg); clearTimeout(timer); resolve(); };
                const onMsg = (e) => { if (e.data && e.data.type === 'stopped') finish(); };
                const timer = setTimeout(finish, 200);
                worker.addEventListener('message', onMsg);
            });
            try { worker.terminate(); } catch (e) { /* ignore */ }
        }
        this.datagramQueue.length = 0;
        this._flushPending = false;
    },
};

if (typeof window !== 'undefined') { window.StreamingUI = StreamingUI; window.__state = state; }
