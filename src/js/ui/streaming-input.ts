/**
 * StreamingInputUI — main-thread coordinator for WebSRT receiving.
 *
 * Manages up to 8 concurrent WebSRT input streams. Lazy connection model
 * driven by two sources:
 *   1. Layer routing (acquire/release from layerMixer when a layer picks
 *      WebSRT + Input N).
 *   2. Manual Start button on the selected input.
 * Connection is up iff (layerRefs > 0 || manualStart) for that input.
 *
 * UI: master-detail. Top of panel has an Input selector (1..8) and the
 * analyser-source dropdown. Below: config fields for the SELECTED input,
 * Start/Stop buttons, and a live stats block. Switching the selector saves
 * the current fields and swaps to the new input's stored values.
 *
 * Persisted in localStorage (NOT in WS state — credentials-adjacent).
 */

import { getEl, state } from '../state.js';

const NUM_INPUTS = 8;
const LS_PREFIX = 'slopshady.stream.input.';

// MediaStreamTrackGenerator is not yet in lib.dom.d.ts (TS 5.9). The runtime
// API is Chrome ≥94; declare a minimal surface so the rest of the file type-
// checks without `as any` at every call site.
interface MediaStreamTrackGeneratorLike extends MediaStreamTrack {
    readonly writable: WritableStream<AudioData> | null;
}

type AnyWindow = Window & typeof globalThis & {
    MediaStreamTrackGenerator?: new (init: { kind: string }) => MediaStreamTrackGeneratorLike;
    __slopshadyAudioCtx?: AudioContext;
    StreamingInputUI?: unknown;
};

interface InputEntry {
    wt: WebTransport | null;
    worker: Worker | null;
    refcount: number;
    manualStart: boolean;
    status: 'idle' | 'connecting' | 'live' | 'closed' | 'error' | string;
    currentFrame: VideoFrame | null;
    handshakeDone: boolean;
    audioTrackGenerator: MediaStreamTrackGeneratorLike | null;
    audioWriter: WritableStreamDefaultWriter<AudioData> | null;
    audioSourceNode: MediaStreamAudioSourceNode | null;
    layerGains: Map<number, GainNode>;
    audioMutedForLayer: Map<number, boolean>;
    layerVolumes: Map<number, number>;
    analyserTap: GainNode | null;
    _analyserConnected: boolean;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    reconnectAttempts: number;
    datagramQueue: ArrayBuffer[];
    _flushPending: boolean;
    _receiveReader: ReadableStreamDefaultReader<Uint8Array> | null;
    _datagramWriter: WritableStreamDefaultWriter<Uint8Array> | null;
    _antiThrottle: { osc: OscillatorNode } | null;
    _tickRaf: number | null;
    lastStats: WorkerStats | null;
}

interface InputConfig {
    url: string;
    name: string;
    latency: number;
}

// Worker → main message discriminated union (matches stream-input-worker.ts).
type WorkerMsg =
    | { type: 'send'; data: ArrayBuffer }
    | { type: 'handshakeComplete' }
    | { type: 'streamInfo'; info: { videoPid: number; videoCodec: string | null; audioPid: number; audioCodec: string | null } }
    | { type: 'videoFrame'; frame: VideoFrame }
    | { type: 'audioData'; data: AudioData }
    | { type: 'stats'; stats: WorkerStats }
    | { type: 'log'; msg: string }
    | { type: 'decoderError'; which: 'video' | 'audio' | 'demux'; msg: string }
    | { type: 'close' }
    | { type: 'initFailed'; msg: string }
    | { type: 'stopped' };

interface WorkerStats {
    bandwidthBps: number;
    rttMs: number;
    elapsedMs: number;
    rxLoss: number;
    rxNak: number;
    rxAck: number;
    rxData: number;
    rxBuffered: number;
    pesVideo: number;
    pesAudio: number;
    spsSeen: boolean;
    ppsSeen: boolean;
    vpsSeen: boolean;
    av1SeqSeen: boolean;
    chunksFed: number;
    framesOutput: number;
    audioChunksFed: number;
    audioFramesOutput: number;
    decoderState: string;
    audioDecoderState: string;
    lastDecoderError: string;
    lastAudioDecoderError: string;
    videoCodec: string;
    audioCodec: string;
    videoWidth: number;
    videoHeight: number;
}

export const StreamingInputUI = {
    // Per-input runtime state. See InputEntry.
    _inputs: new Array<InputEntry | null>(NUM_INPUTS).fill(null),
    _selectedInput: 0,

    _audioCtx: null as AudioContext | null,
    _analyser: null as AudioNode | null,
    _analyserSource: 'webamp' as string,

    init(): void {
        this._renderPanel();
        this._loadAll();
        // Show selected input's stored values.
        this._renderSelectedConfig();
        this._renderAnalyserMenu();

        // Wire selector dropdown.
        const selDd = getEl('stream-input-selector');
        if (selDd) {
            selDd.addEventListener('dropdown-select', (e: Event) => {
                const detail = (e as CustomEvent).detail || {};
                const m = /^input-(\d+)$/.exec(detail.value || '');
                if (!m) return;
                this._selectInput(parseInt(m[1], 10));
            });
        }
        // Wire analyser dropdown.
        const analyserDd = getEl('stream-input-analyser-dropdown');
        if (analyserDd) {
            analyserDd.addEventListener('dropdown-select', (e: Event) => {
                const detail = (e as CustomEvent).detail || {};
                this._analyserSource = detail.value || 'webamp';
                try { localStorage.setItem('slopshady.stream.analyserSource', this._analyserSource); } catch (err) { /* ignore */ }
                this._applyAnalyserRouting();
                this._syncAnalyserDropdownDisplay();
            });
        }
        // Wire Start/Stop buttons.
        const startBtn = getEl('stream-input-start');
        const stopBtn = getEl('stream-input-stop');
        if (startBtn) startBtn.addEventListener('click', () => this._toggleStart());
        if (stopBtn) stopBtn.addEventListener('click', () => this._toggleStart());
        // Wire field changes to persist + refresh analyser labels. Listen on
        // 'input' (every keystroke) rather than 'change' (blur-only) so the
        // value is in localStorage even if the user clicks Start mid-typing.
        for (const key of ['url', 'name', 'latency']) {
            const el = getEl(`stream-input-${key}`);
            if (el) el.addEventListener('input', () => this._saveSelected());
        }
    },

    setAnalyser(analyserNode: AudioNode | null): void {
        this._analyser = analyserNode;
        this._applyAnalyserRouting();
    },

    setAudioContext(ctx: AudioContext | null): void {
        this._audioCtx = ctx;
    },

    // ---------- Public API ----------

    /**
     * Layer routed to input N. Increments layer refcount; opens connection
     * on 0→1 (or while manualStart is on, no-op).
     */
    acquire(inputIndex: number): void {
        if (inputIndex < 0 || inputIndex >= NUM_INPUTS) return;
        const entry = this._ensureEntry(inputIndex);
        entry.refcount++;
        if (entry.refcount === 1 && !entry.manualStart) {
            this._connect(inputIndex);
        }
    },

    /**
     * Layer unroutes from input N. Decrements layer refcount; closes
     * connection on 1→0 if manualStart is off.
     */
    release(inputIndex: number): void {
        if (inputIndex < 0 || inputIndex >= NUM_INPUTS) return;
        const entry = this._inputs[inputIndex];
        if (!entry) return;
        entry.refcount = Math.max(0, entry.refcount - 1);
        if (entry.refcount === 0 && !entry.manualStart) {
            this._disconnect(inputIndex);
        }
    },

    latestVideoFrame(inputIndex: number): VideoFrame | null {
        const entry = this._inputs[inputIndex];
        return entry ? entry.currentFrame : null;
    },

    getInputName(inputIndex: number): string {
        if (inputIndex < 0 || inputIndex >= NUM_INPUTS) return '';
        try { return localStorage.getItem(LS_PREFIX + inputIndex + '.name') || ''; }
        catch (e) { return ''; }
    },

    setLayerVolume(inputIndex: number, layerIndex: number, volume: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry) return;
        if (!entry.layerVolumes) entry.layerVolumes = new Map();
        entry.layerVolumes.set(layerIndex, volume);
        const gain = this._ensureLayerGain(inputIndex, layerIndex);
        if (!gain) return;
        const muted = entry.audioMutedForLayer?.get(layerIndex) || false;
        const target = muted ? 0 : volume;
        try { gain.gain.setTargetAtTime(target, this._audioCtx!.currentTime, 0.01); }
        catch (e) { /* ctx not ready */ }
    },

    setLayerMute(inputIndex: number, layerIndex: number, muted: boolean): void {
        const entry = this._inputs[inputIndex];
        if (!entry) return;
        if (!entry.audioMutedForLayer) entry.audioMutedForLayer = new Map();
        entry.audioMutedForLayer.set(layerIndex, !!muted);
        const gain = entry.layerGains.get(layerIndex);
        if (gain) {
            // Restore the last-set volume on unmute instead of hardcoded 1.0.
            const vol = entry.layerVolumes?.get(layerIndex) ?? 1.0;
            const target = muted ? 0 : vol;
            try { gain.gain.setTargetAtTime(target, this._audioCtx!.currentTime, 0.01); }
            catch (e) { /* ctx not ready */ }
        }
    },

    removeLayerTap(inputIndex: number, layerIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry) return;
        const gain = entry.layerGains.get(layerIndex);
        if (gain) {
            try { entry.audioSourceNode?.disconnect(gain); } catch (e) { /* ignore */ }
            try { gain.disconnect(); } catch (e) { /* ignore */ }
            entry.layerGains.delete(layerIndex);
            entry.audioMutedForLayer?.delete(layerIndex);
            entry.layerVolumes?.delete(layerIndex);
        }
    },

    // ---------- Start/Stop button ----------

    _toggleStart(): void {
        const i = this._selectedInput;
        const entry = this._ensureEntry(i);
        if (entry.worker || entry.manualStart) {
            // Stopping. Always disconnect even if layers still hold refs — the
            // next acquire() (layer source toggle) will reconnect if needed.
            entry.manualStart = false;
            this._disconnect(i);
        } else {
            // Starting.
            entry.manualStart = true;
            this._connect(i);
        }
        this._syncStartStopButtons();
    },

    _syncStartStopButtons(): void {
        const i = this._selectedInput;
        const entry = this._inputs[i];
        const live = !!(entry && (entry.worker || entry.manualStart));
        const startBtn = getEl('stream-input-start');
        const stopBtn = getEl('stream-input-stop');
        if (startBtn) startBtn.classList.toggle('active', live);
        if (stopBtn) stopBtn.classList.toggle('disabled', !live);
    },

    // ---------- Selector swap ----------

    _selectInput(i: number): void {
        if (i === this._selectedInput) return;
        this._saveSelected();
        this._selectedInput = i;
        this._renderSelectedConfig();
        this._renderStatsBlock();
        this._syncStartStopButtons();
        this._syncSelectorDisplay();
    },

    _syncSelectorDisplay(): void {
        const span = document.querySelector('#stream-input-selector .dropdown__selected span');
        if (span) {
            const i = this._selectedInput;
            const name = this.getInputName(i);
            span.textContent = name ? `Input ${i + 1} · ${name}` : `Input ${i + 1}`;
        }
        const menu = getEl('stream-input-selector-menu');
        if (menu) {
            menu.querySelectorAll('.dropdown__item').forEach(item => {
                item.classList.toggle('active', (item as HTMLElement).dataset.value === `input-${this._selectedInput}`);
            });
        }
    },

    // ---------- Connection lifecycle ----------

    _ensureEntry(i: number): InputEntry {
        if (!this._inputs[i]) {
            this._inputs[i] = {
                wt: null, worker: null,
                refcount: 0, manualStart: false,
                status: 'idle', currentFrame: null,
                handshakeDone: false,
                audioTrackGenerator: null, audioWriter: null, audioSourceNode: null,
                layerGains: new Map(), audioMutedForLayer: new Map(),
                layerVolumes: new Map(),
                analyserTap: null, _analyserConnected: false,
                reconnectTimer: null, reconnectAttempts: 0,
                datagramQueue: [], _flushPending: false,
                _receiveReader: null, _datagramWriter: null,
                _antiThrottle: null, _tickRaf: null, lastStats: null,
            };
        }
        return this._inputs[i]!;
    },

    async _connect(inputIndex: number): Promise<void> {
        // Persist the current DOM values before reading — covers the case
        // where the user typed a URL and clicked Start without blurring the
        // field (no 'input' event would have fired for the final value).
        if (inputIndex === this._selectedInput) this._saveSelected();
        const cfg = this._readConfig(inputIndex);
        if (!cfg.url || !cfg.name) {
            this._setStatus(inputIndex, 'missing url/name');
            this._syncStartStopButtons();
            return;
        }
        if (typeof WebTransport === 'undefined') {
            this._setStatus(inputIndex, 'WebTransport unavailable');
            return;
        }
        const entry = this._ensureEntry(inputIndex);
        if (entry.reconnectTimer) { clearTimeout(entry.reconnectTimer); entry.reconnectTimer = null; }
        if (entry.worker || entry.wt) await this._abortConnect(inputIndex);

        entry.status = 'connecting';
        this._setStatus(inputIndex, 'Connecting…');
        this._syncStartStopButtons();

        // Fetch cert hash.
        let hash = null as string | null;
        try {
            const resp = await fetch('/api/stream/cert-hash?url=' + encodeURIComponent(cfg.url), { cache: 'no-store' });
            if (!resp.ok) throw new Error('proxy HTTP ' + resp.status);
            const j = await resp.json();
            hash = j.hash ?? null;
        } catch (e) {
            this._setStatus(inputIndex, 'Cert hash fetch failed');
            this._scheduleReconnect(inputIndex);
            return;
        }

        try {
            const url = `${cfg.url}?stream=${encodeURIComponent(cfg.name)}`;
            const opts: WebTransportOptions = {};
            if (hash) opts.serverCertificateHashes = [{ algorithm: 'sha-256', value: this._hexToBytes(hash) }];
            entry.wt = new WebTransport(url, opts);
            await entry.wt.ready;
        } catch (e) {
            this._setStatus(inputIndex, 'WT connect failed: ' + ((e as Error)?.message || e));
            entry.wt = null;
            this._scheduleReconnect(inputIndex);
            return;
        }

        entry.worker = new Worker('/js/features/stream-input-worker.js', { type: 'module' });
        entry.worker.onmessage = (e: MessageEvent) => this._onWorkerMessage(inputIndex, e.data as WorkerMsg);
        entry.worker.postMessage({ type: 'init', latencyMs: cfg.latency });

        this._startReceiveLoop(inputIndex);
        this._startAntiThrottle(inputIndex);
        this._startTickLoop(inputIndex);
    },

    async _disconnect(inputIndex: number): Promise<void> {
        const entry = this._inputs[inputIndex];
        if (!entry) return;
        if (entry.reconnectTimer) { clearTimeout(entry.reconnectTimer); entry.reconnectTimer = null; }
        this._stopTickLoop(inputIndex);
        this._stopAntiThrottle(inputIndex);
        if (entry.currentFrame) { try { entry.currentFrame.close(); } catch (e) { /* ignore */ } entry.currentFrame = null; }
        this._teardownAudio(inputIndex);
        if (entry.worker) {
            const worker = entry.worker;
            try { worker.postMessage({ type: 'stop' }); } catch (e) { /* ignore */ }
            await new Promise<void>((resolve) => {
                let done = false;
                const finish = () => { if (done) return; done = true; worker.removeEventListener('message', onMsg); clearTimeout(timer); resolve(); };
                const onMsg = (e: MessageEvent) => { if (e.data && e.data.type === 'stopped') finish(); };
                const timer = setTimeout(finish, 200);
                worker.addEventListener('message', onMsg);
            });
            try { worker.terminate(); } catch (e) { /* ignore */ }
            entry.worker = null;
        }
        if (entry.wt) { try { await entry.wt.close(); } catch (e) { /* ignore */ } entry.wt = null; }
        entry.handshakeDone = false;
        entry.status = 'idle';
        entry.lastStats = null;
        entry._datagramWriter = null;
        entry._receiveReader = null;
        this._setStatus(inputIndex, '');
        this._renderStatsBlock();
        this._syncStartStopButtons();
    },

    _scheduleReconnect(inputIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry) return;
        // Only reconnect if we still want to be up.
        if (entry.refcount === 0 && !entry.manualStart) return;
        if (entry.reconnectTimer) return;
        const delay = Math.min(2000 * (2 ** entry.reconnectAttempts), 30000);
        entry.reconnectAttempts++;
        this._setStatus(inputIndex, `Reconnect in ${Math.round(delay / 1000)}s…`);
        entry.reconnectTimer = setTimeout(() => {
            entry.reconnectTimer = null;
            this._abortConnect(inputIndex).then(() => this._connect(inputIndex));
        }, delay);
    },

    async _abortConnect(inputIndex: number): Promise<void> {
        const entry = this._inputs[inputIndex];
        if (!entry) return;
        this._stopTickLoop(inputIndex);
        if (entry.worker) { try { entry.worker.terminate(); } catch (e) { /* ignore */ } entry.worker = null; }
        if (entry.wt) { try { await entry.wt.close(); } catch (e) { /* ignore */ } entry.wt = null; }
    },

    // ---------- Worker message dispatch ----------

    _onWorkerMessage(inputIndex: number, msg: WorkerMsg): void {
        const entry = this._inputs[inputIndex];
        if (!entry) return;
        if (msg.type === 'send') {
            if (entry.wt) {
                try {
                    if (!entry._datagramWriter) entry._datagramWriter = entry.wt.datagrams.writable.getWriter();
                    entry._datagramWriter.write(new Uint8Array(msg.data));
                } catch (e) { /* ignore */ }
            }
        } else if (msg.type === 'handshakeComplete') {
            entry.handshakeDone = true;
            entry.reconnectAttempts = 0;
            entry.status = 'live';
            this._setStatus(inputIndex, 'Live · ' + (this._readConfig(inputIndex).name || ''));
            if (inputIndex === this._selectedInput) this._syncStartStopButtons();
        } else if (msg.type === 'streamInfo') {
            // Don't overwrite 'live' with codec-info status; just refresh stats block.
            if (inputIndex === this._selectedInput) this._renderStatsBlock();
        } else if (msg.type === 'videoFrame') {
            if (entry.currentFrame) { try { entry.currentFrame.close(); } catch (e) { /* ignore */ } }
            entry.currentFrame = msg.frame;
        } else if (msg.type === 'audioData') {
            this._handleAudioData(inputIndex, msg.data);
        } else if (msg.type === 'stats') {
            entry.lastStats = msg.stats;
            if (inputIndex === this._selectedInput) {
                this._setStatus(inputIndex, this._formatStatusLine(entry, msg.stats));
                this._renderStatsBlock();
            }
        } else if (msg.type === 'decoderError') {
            console.warn(`[stream-input ${inputIndex}] ${msg.which} decoder:`, msg.msg);
            if (inputIndex === this._selectedInput) this._renderStatsBlock();
        } else if (msg.type === 'log') {
            console.log(`[stream-input ${inputIndex}]`, msg.msg);
        } else if (msg.type === 'close') {
            entry.handshakeDone = false;
            entry.status = 'closed';
            this._setStatus(inputIndex, 'Closed');
            this._scheduleReconnect(inputIndex);
        } else if (msg.type === 'initFailed') {
            this._setStatus(inputIndex, 'Init failed: ' + msg.msg);
            entry.status = 'error';
            this._syncStartStopButtons();
        }
    },

    // ---------- Receive loop ----------

    async _startReceiveLoop(inputIndex: number): Promise<void> {
        const entry = this._inputs[inputIndex];
        if (!entry || !entry.wt) return;
        const reader = entry.wt.datagrams.readable.getReader();
        entry._receiveReader = reader;
        try {
            while (entry.worker && entry.wt) {
                const { done, value } = await reader.read();
                if (done) break;
                entry.datagramQueue.push(value!.buffer);
                if (entry.datagramQueue.length >= 16) {
                    this._flushIncoming(inputIndex);
                } else if (entry._flushPending !== true) {
                    entry._flushPending = true;
                    setTimeout(() => {
                        entry._flushPending = false;
                        this._flushIncoming(inputIndex);
                    }, 0);
                }
            }
        } catch (e) {
            console.warn(`[stream-input ${inputIndex}] recv`, e);
        }
        this._flushIncoming(inputIndex);
    },

    _flushIncoming(inputIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry || !entry.worker || !entry.datagramQueue || !entry.datagramQueue.length) return;
        const batch = entry.datagramQueue;
        entry.datagramQueue = [];
        for (const buf of batch) {
            try { entry.worker.postMessage({ type: 'datagram', data: buf }, [buf]); }
            catch (e) { /* worker gone */ }
        }
    },

    // ---------- Audio graph ----------

    _handleAudioData(inputIndex: number, audioData: AudioData): void {
        const entry = this._inputs[inputIndex];
        if (!entry) { try { audioData.close(); } catch (e) { /* ignore */ } return; }
        if (!entry.audioTrackGenerator) {
            const MTG = (window as AnyWindow).MediaStreamTrackGenerator;
            if (!MTG) {
                try { audioData.close(); } catch (e) { /* ignore */ }
                return;
            }
            try {
                const gen = new MTG({ kind: 'audio' });
                const writer = gen.writable!.getWriter();
                const stream = new MediaStream([gen]);
                entry.audioTrackGenerator = gen;
                entry.audioWriter = writer;
                const ctx = this._ensureAudioCtx();
                entry.audioSourceNode = ctx.createMediaStreamSource(stream);
                for (const [layerIndex, gain] of entry.layerGains) {
                    entry.audioSourceNode.connect(gain);
                }
                if (this._analyserSource === `websrt:${inputIndex}`) {
                    if (!entry.analyserTap) entry.analyserTap = this._ensureAnalyserTap(inputIndex);
                    try { entry.audioSourceNode.connect(entry.analyserTap!); } catch (e) { /* ignore */ }
                    entry._analyserConnected = true;
                }
            } catch (e) {
                console.warn(`[stream-input ${inputIndex}] audio source init failed`, e);
                try { audioData.close(); } catch (err) { /* ignore */ }
                return;
            }
        }
        try { entry.audioWriter!.write(audioData); }
        catch (e) { try { audioData.close(); } catch (err) { /* ignore */ } }
    },

    _ensureLayerGain(inputIndex: number, layerIndex: number): GainNode | null {
        const entry = this._inputs[inputIndex];
        if (!entry) return null;
        let gain = entry.layerGains.get(layerIndex);
        if (gain) return gain;
        const ctx = this._ensureAudioCtx();
        gain = ctx.createGain();
        gain.gain.value = 1.0;
        gain.connect(ctx.destination);
        entry.layerGains.set(layerIndex, gain);
        if (entry.audioSourceNode) entry.audioSourceNode.connect(gain);
        return gain;
    },

    _ensureAnalyserTap(inputIndex: number): GainNode | null {
        const entry = this._inputs[inputIndex];
        if (!entry) return null;
        if (entry.analyserTap) return entry.analyserTap;
        const ctx = this._ensureAudioCtx();
        const tap = ctx.createGain();
        tap.gain.value = 1.0;
        const analyser = this._resolveAnalyser();
        if (analyser) tap.connect(analyser);
        entry.analyserTap = tap;
        return tap;
    },

    _resolveAnalyser(): AudioNode | null {
        return this._analyser || (state as Record<string, unknown>).audioPlayerAnalyser as AudioNode | null || null;
    },

    _applyAnalyserRouting(): void {
        for (let i = 0; i < NUM_INPUTS; i++) {
            const entry = this._inputs[i];
            if (!entry || !entry.audioSourceNode) continue;
            const should = (this._analyserSource === `websrt:${i}`);
            const has = entry._analyserConnected;
            if (should && !has) {
                if (!entry.analyserTap) entry.analyserTap = this._ensureAnalyserTap(i);
                try { entry.audioSourceNode.connect(entry.analyserTap!); } catch (e) { /* ignore */ }
                entry._analyserConnected = true;
            } else if (!should && has) {
                try { entry.audioSourceNode.disconnect(entry.analyserTap!); } catch (e) { /* ignore */ }
                entry._analyserConnected = false;
            }
        }
    },

    _teardownAudio(inputIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry) return;
        for (const [, gain] of entry.layerGains) {
            try { entry.audioSourceNode?.disconnect(gain); } catch (e) { /* ignore */ }
            try { gain.disconnect(); } catch (e) { /* ignore */ }
        }
        entry.layerGains.clear();
        if (entry.analyserTap) {
            try { entry.audioSourceNode?.disconnect(entry.analyserTap); } catch (e) { /* ignore */ }
            try { entry.analyserTap.disconnect(); } catch (e) { /* ignore */ }
            entry.analyserTap = null;
        }
        entry._analyserConnected = false;
        if (entry.audioWriter) { try { entry.audioWriter.close(); } catch (e) { /* ignore */ } entry.audioWriter = null; }
        if (entry.audioTrackGenerator) { try { entry.audioTrackGenerator.track.stop(); } catch (e) { /* ignore */ } entry.audioTrackGenerator = null; }
        if (entry.audioSourceNode) { try { entry.audioSourceNode.disconnect(); } catch (e) { /* ignore */ } entry.audioSourceNode = null; }
    },

    _ensureAudioCtx(): AudioContext {
        if (this._audioCtx) return this._audioCtx;
        const w = window as AnyWindow;
        if (typeof window !== 'undefined' && w.__slopshadyAudioCtx) {
            this._audioCtx = w.__slopshadyAudioCtx;
            return this._audioCtx;
        }
        try {
            this._audioCtx = new AudioContext();
            if (this._audioCtx!.state === 'suspended') this._audioCtx!.resume().catch(() => { /* ignore */ });
        } catch (e) { /* Web Audio unavailable */ }
        return this._audioCtx!;
    },

    // ---------- Anti-throttle ----------

    _startTickLoop(inputIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry || entry._tickRaf !== null) return;
        const loop = () => {
            const e = this._inputs[inputIndex];
            // Stop the loop when the worker goes away (disconnect/abort).
            if (!e || !e.worker) {
                if (e) e._tickRaf = null;
                return;
            }
            try { e.worker.postMessage({ type: 'tick' }); } catch (err) { /* worker gone */ }
            e._tickRaf = requestAnimationFrame(loop);
        };
        entry._tickRaf = requestAnimationFrame(loop);
    },

    _stopTickLoop(inputIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry || entry._tickRaf === null) return;
        cancelAnimationFrame(entry._tickRaf);
        entry._tickRaf = null;
    },

    _startAntiThrottle(inputIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry || entry._antiThrottle) return;
        const ctx = this._ensureAudioCtx();
        if (!ctx) return;
        try {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            g.gain.value = 0.0001;
            osc.connect(g).connect(ctx.destination);
            osc.start();
            entry._antiThrottle = { osc };
        } catch (e) { /* ignore */ }
    },

    _stopAntiThrottle(inputIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry || !entry._antiThrottle) return;
        try { entry._antiThrottle.osc.stop(); } catch (e) { /* ignore */ }
        entry._antiThrottle = null;
    },

    // ---------- Rendering ----------

    _renderPanel(): void {
        // Selector dropdown items (1..8) + analyser dropdown items.
        const selMenu = getEl('stream-input-selector-menu');
        if (selMenu) {
            let html = '';
            for (let i = 0; i < NUM_INPUTS; i++) {
                const name = this.getInputName(i);
                const label = name ? `Input ${i + 1} · ${name}` : `Input ${i + 1}`;
                html += `<div class="dropdown__item${i === this._selectedInput ? ' active' : ''}" data-value="input-${i}">${label}</div>`;
            }
            selMenu.innerHTML = html;
        }
        this._syncSelectorDisplay();
    },

    _renderAnalyserMenu(): void {
        const menu = getEl('stream-input-analyser-menu');
        if (!menu) return;
        let items = `<div class="dropdown__item${this._analyserSource === 'webamp' ? ' active' : ''}" data-value="webamp">Webamp</div>`;
        for (let i = 0; i < NUM_INPUTS; i++) {
            const name = this.getInputName(i) || `Input ${i + 1}`;
            const v = `websrt:${i}`;
            items += `<div class="dropdown__item${this._analyserSource === v ? ' active' : ''}" data-value="${v}">${name}</div>`;
        }
        menu.innerHTML = items;
        this._syncAnalyserDropdownDisplay();
    },

    _renderSelectedConfig(): void {
        const i = this._selectedInput;
        // Always source from localStorage here. This runs on init AND on
        // selector swaps; in both cases we want LS as the source of truth
        // (user edits flow DOM → LS via _saveSelected, so LS is current).
        let cfg: InputConfig;
        try {
            const latStr = localStorage.getItem(LS_PREFIX + i + '.latency') || '300';
            const lat = parseInt(latStr, 10);
            cfg = {
                url: localStorage.getItem(LS_PREFIX + i + '.url') || '',
                name: localStorage.getItem(LS_PREFIX + i + '.name') || '',
                latency: Number.isFinite(lat) ? Math.max(20, Math.min(8000, lat)) : 300,
            };
        } catch (e) {
            cfg = { url: '', name: '', latency: 300 };
        }
        const urlEl = getEl('stream-input-url') as HTMLInputElement | null;
        const nameEl = getEl('stream-input-name') as HTMLInputElement | null;
        const latEl = getEl('stream-input-latency') as HTMLInputElement | null;
        if (urlEl) urlEl.value = cfg.url;
        if (nameEl) nameEl.value = cfg.name;
        if (latEl) latEl.value = String(cfg.latency);
        // Refresh analyser menu labels too (in case names changed).
        this._renderAnalyserMenu();
        // Refresh selector label.
        this._syncSelectorDisplay();
    },

    _syncAnalyserDropdownDisplay(): void {
        const span = document.querySelector('#stream-input-analyser-dropdown .dropdown__selected span');
        if (!span) return;
        if (this._analyserSource === 'webamp') { span.textContent = 'Webamp'; return; }
        const m = /^websrt:(\d+)$/.exec(this._analyserSource);
        if (m) {
            const i = parseInt(m[1], 10);
            span.textContent = this.getInputName(i) || `Input ${i + 1}`;
        }
    },

    _readConfig(inputIndex: number): InputConfig {
        // Read from DOM if the selector is currently on this input; else from localStorage.
        if (inputIndex === this._selectedInput) {
            const urlEl = getEl('stream-input-url') as HTMLInputElement | null;
            const nameEl = getEl('stream-input-name') as HTMLInputElement | null;
            const latEl = getEl('stream-input-latency') as HTMLInputElement | null;
            const url = (urlEl?.value || '').trim();
            const name = (nameEl?.value || '').trim();
            const latRaw = latEl?.value;
            const lat = parseInt(latRaw || '', 10);
            return {
                url, name,
                latency: Number.isFinite(lat) ? Math.max(20, Math.min(8000, lat)) : 300,
            };
        }
        try {
            const latStr = localStorage.getItem(LS_PREFIX + inputIndex + '.latency') || '300';
            const lat = parseInt(latStr, 10);
            return {
                url: localStorage.getItem(LS_PREFIX + inputIndex + '.url') || '',
                name: localStorage.getItem(LS_PREFIX + inputIndex + '.name') || '',
                latency: Number.isFinite(lat) ? Math.max(20, Math.min(8000, lat)) : 300,
            };
        } catch (e) { return { url: '', name: '', latency: 300 }; }
    },

    _loadAll(): void {
        try {
            const src = localStorage.getItem('slopshady.stream.analyserSource');
            if (src) this._analyserSource = src;
        } catch (e) { /* ignore */ }
    },

    _saveSelected(): void {
        const i = this._selectedInput;
        try {
            const urlEl = getEl('stream-input-url') as HTMLInputElement | null;
            const nameEl = getEl('stream-input-name') as HTMLInputElement | null;
            const latEl = getEl('stream-input-latency') as HTMLInputElement | null;
            const url = (urlEl?.value || '').trim();
            const name = (nameEl?.value || '').trim();
            const lat = latEl?.value;
            if (url) localStorage.setItem(LS_PREFIX + i + '.url', url); else localStorage.removeItem(LS_PREFIX + i + '.url');
            if (name) localStorage.setItem(LS_PREFIX + i + '.name', name); else localStorage.removeItem(LS_PREFIX + i + '.name');
            if (lat) localStorage.setItem(LS_PREFIX + i + '.latency', lat);
        } catch (e) { /* ignore */ }
        // Selector + analyser dropdown labels may have changed.
        this._renderPanel();
        this._renderAnalyserMenu();
    },

    _setStatus(inputIndex: number, s: string): void {
        if (inputIndex !== this._selectedInput) return;
        const el = getEl('stream-input-status');
        if (el) el.textContent = s;
    },

    _formatStatusLine(entry: InputEntry, stats: WorkerStats): string {
        const cfg = this._readConfig(this._selectedInput);
        const name = cfg.name || '';
        if (entry.status === 'live' && stats) {
            const mbps = (stats.bandwidthBps || 0) / 1e6;
            return `Live · ${name} · ↓${mbps.toFixed(1)}Mbps · RTT ${(stats.rttMs || 0).toFixed(0)}ms · rxLoss ${Math.round(stats.rxLoss || 0)}`;
        }
        if (entry.status === 'connecting') return 'Connecting…';
        if (entry.status === 'closed') return 'Closed';
        if (entry.status === 'error') return 'Error';
        return '';
    },

    _renderStatsBlock(): void {
        const el = getEl('stream-input-stats');
        if (!el) return;
        const i = this._selectedInput;
        const entry = this._inputs[i];
        const stats = entry?.lastStats;
        if (!entry || !entry.worker) {
            el.textContent = '';
            return;
        }
        if (!stats) {
            el.textContent = 'Waiting for stream info…';
            return;
        }
        const videoLine = stats.videoCodec
            ? `${stats.videoCodec}${stats.videoWidth ? ' · ' + stats.videoWidth + '×' + stats.videoHeight : ''}`
            : '—';
        const audioLine = stats.audioCodec || '—';
        const framesLine = `${stats.framesOutput || 0} frames · queue ${stats.decoderState === 'configured' ? 'live' : stats.decoderState}`;
        const transportLine = `rxBytes ${((stats.rxData || 0) / 1e6).toFixed(1)}MB · rxAck ${Math.round(stats.rxAck || 0)} · rxNak ${Math.round(stats.rxNak || 0)} · rxBuffered ${Math.round(stats.rxBuffered || 0)}`;
        const chunksLine = `pes v:${stats.pesVideo || 0} a:${stats.pesAudio || 0} · fed v:${stats.chunksFed || 0} a:${stats.audioChunksFed || 0} · out a:${stats.audioFramesOutput || 0}`;
        let errLine = '';
        if (stats.lastDecoderError) errLine = `\nVideo err: ${stats.lastDecoderError}`;
        if (stats.lastAudioDecoderError) errLine += `\nAudio err: ${stats.lastAudioDecoderError}`;
        el.textContent =
            `Video: ${videoLine}\n` +
            `Audio: ${audioLine}\n` +
            `Decode: ${framesLine}\n` +
            `Transport: ${transportLine}\n` +
            `Counters: ${chunksLine}` +
            errLine;
    },

    _hexToBytes(hex: string): Uint8Array {
        if (hex.length !== 64) throw new Error('cert hash must be 64 hex chars, got ' + hex.length);
        const bytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    },
};

if (typeof window !== 'undefined') (window as AnyWindow).StreamingInputUI = StreamingInputUI;
