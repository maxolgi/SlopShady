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
import { mountPlayer } from '/static/vendor/WebSRT/web/src/player/index.js';
import type { PlayerHandle } from '/static/vendor/WebSRT/web/src/player/index.js';

const NUM_INPUTS = 8;
const LS_PREFIX = 'slopshady.stream.input.';

// PTS-paced presentation (mirrors vendor/WebSRT/web/src/render.ts):
// incoming decoded frames are buffered in a small ring and handed to the
// compositor only when their PTS is due. Without this, a decoder burst
// (B-frame reorder + WebCodecs pipeline + postMessage batching) arriving
// between two render polls overwrites the single-slot pending frame and
// the layer skips — visible as ~half-framerate with irregular pacing on
// bursty (higher-RTT) paths.
//
// Cap of 8 absorbs the worker's worst observed burst (4 frames at once
// from a single SRT poll + 4 already buffered). At 1080p each VideoFrame
// is GPU/driver-backed, so the headroom is cheap.
const FRAME_RING_CAP = 8;
// Drop a buffered frame if its PTS is more than this many µs behind the
// presentation clock — it missed its slot. ~3 RAF cycles at 60 Hz.
const LATE_DROP_US = 50_000;
// Reset the PTS↔wall clock mapping when a frame's PTS diverges from the
// expected presentation time by more than this — seek / stream restart /
// recovery from a backgrounded tab.
const CLOCK_RESET_US = 1_000_000;

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
    handle: PlayerHandle | null;
    refcount: number;
    manualStart: boolean;
    status: 'idle' | 'connecting' | 'live' | 'closed' | 'error' | string;
    // Decoded frames awaiting presentation, in decode (PTS) order. Bounded;
    // pushing past FRAME_RING_CAP closes the oldest.
    frameRing: VideoFrame[];
    // Frame most recently handed to the compositor. Held until a newer
    // frame's PTS becomes due, so the layer doesn't flicker between
    // advances. Distinct from frameRing[0] — the render loop may poll
    // faster than source frame rate.
    displayedFrame: VideoFrame | null;
    // Wall-clock ↔ PTS mapping for presentation pacing. Established on
    // first frame; reset on large gap.
    ptsOriginUs: number | null;
    wallOriginMs: number;
    handshakeDone: boolean;
    audioTrackGenerator: MediaStreamTrackGeneratorLike | null;
    audioWriter: WritableStreamDefaultWriter<AudioData> | null;
    audioSourceNode: MediaStreamAudioSourceNode | null;
    layerGains: Map<number, GainNode>;
    audioMutedForLayer: Map<number, boolean>;
    layerVolumes: Map<number, number>;
    analyserTap: GainNode | null;
    _analyserConnected: boolean;
    _antiThrottle: { osc: OscillatorNode } | null;
    _presentRaf: number | null;
    lastStats: any;
}

interface InputConfig {
    url: string;
    name: string;
    latency: number;
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
        // Wire Start/Stop toggle + Start-All/Stop-All toggle.
        const toggleBtn = getEl('stream-input-toggle');
        if (toggleBtn) toggleBtn.addEventListener('click', () => this._toggleStart());
        const toggleAllBtn = getEl('stream-input-toggle-all');
        if (toggleAllBtn) toggleAllBtn.addEventListener('click', () => this._toggleAll());
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
        if (!entry) return null;
        return entry.displayedFrame;
    },

    /**
     * Push a freshly decoded frame into the PTS-paced ring and refresh the
     * wall-clock ↔ PTS mapping. Called from the SDK `decodedframe` event
     * handler.
     */
    _acceptVideoFrame(inputIndex: number, frame: VideoFrame): void {
        const entry = this._inputs[inputIndex];
        if (!entry) { try { frame.close(); } catch (e) { /* ignore */ } return; }
        if (entry.ptsOriginUs === null) {
            entry.ptsOriginUs = frame.timestamp;
            entry.wallOriginMs = performance.now();
        } else {
            const nowPtsUs = entry.ptsOriginUs + (performance.now() - entry.wallOriginMs) * 1000;
            if (Math.abs(frame.timestamp - nowPtsUs) > CLOCK_RESET_US) {
                entry.ptsOriginUs = frame.timestamp;
                entry.wallOriginMs = performance.now();
            }
        }
        entry.frameRing.push(frame);
        // On overflow drop the *oldest* (head) frame, not the newest. A
        // full ring means the consumer is already behind, so shedding the
        // head (earliest PTS) trims accumulated latency under backpressure
        // rather than buffering stale frames the user hasn't seen. Matches
        // the WebSRT vendor viewer (render.ts).
        while (entry.frameRing.length > FRAME_RING_CAP) {
            const old = entry.frameRing.shift();
            try { old?.close(); } catch (e) { /* ignore */ }
        }
    },

    /**
     * Drop buffered frames that missed their PTS slot, then advance
     * `displayedFrame` to the next due frame if one is available. Holds
     * the current `displayedFrame` when no new frame is due yet so the
     * compositor can keep re-uploading it without flicker.
     */
    _advanceDisplayedFrame(inputIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry || entry.ptsOriginUs === null) return;
        const nowPtsUs = entry.ptsOriginUs + (performance.now() - entry.wallOriginMs) * 1000;
        while (entry.frameRing.length > 1 && entry.frameRing[0].timestamp < nowPtsUs - LATE_DROP_US) {
            const old = entry.frameRing.shift();
            try { old?.close(); } catch (e) { /* ignore */ }
        }
        if (entry.frameRing.length > 0 && entry.frameRing[0].timestamp <= nowPtsUs) {
            const next = entry.frameRing.shift()!;
            if (entry.displayedFrame && entry.displayedFrame !== next) {
                try { entry.displayedFrame.close(); } catch (e) { /* ignore */ }
            }
            entry.displayedFrame = next;
        }
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
        if (entry.handle || entry.manualStart) {
            // Stopping. Always disconnect even if layers still hold refs — the
            // next acquire() (layer source toggle) will reconnect if needed.
            entry.manualStart = false;
            this._disconnect(i);
        } else {
            // Starting.
            entry.manualStart = true;
            this._connect(i);
        }
        this._syncToggleButton();
        this._syncToggleAllButton();
    },

    _toggleAll(): void {
        // If any input is currently running, stop all. Else start all.
        const anyRunning = this._inputs.some(e => e && (e.handle || e.manualStart));
        for (let i = 0; i < NUM_INPUTS; i++) {
            const cfg = this._readConfig(i);
            if (!cfg.url || !cfg.name) continue; // skip unconfigured
            const entry = this._ensureEntry(i);
            const isRunning = !!(entry.handle || entry.manualStart);
            if (anyRunning && isRunning) {
                entry.manualStart = false;
                this._disconnect(i);
            } else if (!anyRunning && !isRunning) {
                entry.manualStart = true;
                this._connect(i);
            }
        }
        this._syncToggleButton();
        this._syncToggleAllButton();
    },

    _syncToggleButton(): void {
        const i = this._selectedInput;
        const entry = this._inputs[i];
        const live = !!(entry && (entry.handle || entry.manualStart));
        const btn = getEl('stream-input-toggle');
        if (btn) {
            btn.textContent = live ? '⏹ Stop' : '▶ Start';
            btn.classList.toggle('active', live);
        }
    },

    _syncToggleAllButton(): void {
        const anyRunning = this._inputs.some(e => e && (e.handle || e.manualStart));
        const btn = getEl('stream-input-toggle-all');
        if (btn) {
            btn.textContent = anyRunning ? '⏹ Stop All' : '▶ Start All';
            btn.classList.toggle('active', anyRunning);
        }
    },

    // ---------- Selector swap ----------

    _selectInput(i: number): void {
        if (i === this._selectedInput) return;
        this._saveSelected();
        this._selectedInput = i;
        this._renderSelectedConfig();
        this._renderStatsBlock();
        this._syncToggleButton(); this._syncToggleAllButton();
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
                handle: null,
                refcount: 0, manualStart: false,
                status: 'idle',
                frameRing: [], displayedFrame: null,
                ptsOriginUs: null, wallOriginMs: 0,
                handshakeDone: false,
                audioTrackGenerator: null, audioWriter: null, audioSourceNode: null,
                layerGains: new Map(), audioMutedForLayer: new Map(),
                layerVolumes: new Map(),
                analyserTap: null, _analyserConnected: false,
                _antiThrottle: null, _presentRaf: null, lastStats: null,
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
        if (!cfg.url) {
            this._setStatus(inputIndex, 'missing gateway URL');
            this._syncToggleButton(); this._syncToggleAllButton();
            return;
        }
        // cfg.url is the gateway WEB URL — the page the user browses to
        // (e.g. https://host:8443/?stream=cv-1). The stream name comes from the
        // explicit field if set, else from the URL's ?stream=.
        let webUrl: URL;
        try { webUrl = new URL(cfg.url); }
        catch {
            this._setStatus(inputIndex, 'invalid gateway URL');
            this._syncToggleButton(); this._syncToggleAllButton();
            return;
        }
        const stream = cfg.name || webUrl.searchParams.get('stream') || '';
        if (!stream) {
            this._setStatus(inputIndex, 'missing stream name');
            this._syncToggleButton(); this._syncToggleAllButton();
            return;
        }
        if (typeof WebTransport === 'undefined') {
            this._setStatus(inputIndex, 'WebTransport unavailable');
            return;
        }
        const entry = this._ensureEntry(inputIndex);

        entry.status = 'connecting';
        this._setStatus(inputIndex, 'Connecting…');
        this._syncToggleButton(); this._syncToggleAllButton();

        // One proxy fetch at the web origin yields the cert hash (hex for
        // self-signed, null for PKI) AND the WT port — both advertised by
        // cert-hash.js. We then mount against the WT endpoint directly.
        let hash = null as string | null;
        let wtPort = null as number | null;
        try {
            const resp = await fetch('/api/stream/cert-hash?url=' + encodeURIComponent(cfg.url), { cache: 'no-store' });
            if (!resp.ok) throw new Error('proxy HTTP ' + resp.status);
            const j = await resp.json();
            hash = j.hash ?? null;
            wtPort = j.wtPort ?? null;
        } catch (e) {
            this._setStatus(inputIndex, 'Cert hash fetch failed');
            return;
        }

        entry.handle = mountPlayer(null, {
            decodeInWorker: true,
            workerUrl: '/static/vendor/WebSRT/web/src/worker.js',
            host: webUrl.hostname,
            port: wtPort || 4433,
            stream,
            certHash: hash,
            latencyMs: cfg.latency,
        });
        this._wireHandleEvents(inputIndex, entry.handle);
        entry.handle.connect();

        this._startAntiThrottle(inputIndex);
        this._startPresentLoop(inputIndex);
    },

    async _disconnect(inputIndex: number): Promise<void> {
        const entry = this._inputs[inputIndex];
        if (!entry) return;
        this._stopPresentLoop(inputIndex);
        this._stopAntiThrottle(inputIndex);
        for (const f of entry.frameRing) { try { f.close(); } catch (e) { /* ignore */ } }
        entry.frameRing = [];
        if (entry.displayedFrame) { try { entry.displayedFrame.close(); } catch (e) { /* ignore */ } entry.displayedFrame = null; }
        entry.ptsOriginUs = null;
        this._teardownAudio(inputIndex);
        if (entry.handle) {
            try { entry.handle.disconnect(); } catch (e) { /* ignore */ }
            try { entry.handle.destroy(); } catch (e) { /* ignore */ }
            entry.handle = null;
        }
        entry.handshakeDone = false;
        entry.status = 'idle';
        entry.lastStats = null;
        this._setStatus(inputIndex, '');
        this._renderStatsBlock();
        this._syncToggleButton(); this._syncToggleAllButton();
    },

    // ---------- SDK event dispatch ----------

    _wireHandleEvents(i: number, handle: PlayerHandle): void {
        handle.addEventListener('decodedframe', (e: Event) => {
            const frame = (e as CustomEvent<VideoFrame>).detail;
            this._acceptVideoFrame(i, frame);
        });
        handle.addEventListener('decodedaudio', (e: Event) => {
            const data = (e as CustomEvent<AudioData>).detail;
            this._handleAudioData(i, data);
        });
        handle.addEventListener('stats', (e: Event) => {
            const detail = (e as CustomEvent<{ stats: any; demux: any }>).detail;
            this._onStats(i, detail);
        });
        handle.addEventListener('open', () => {
            const entry = this._inputs[i];
            if (!entry) return;
            entry.handshakeDone = true;
            entry.status = 'live';
            this._setStatus(i, 'Connected · awaiting video…');
            if (i === this._selectedInput) { this._syncToggleButton(); this._syncToggleAllButton(); }
        });
        handle.addEventListener('canplay', () => {
            const entry = this._inputs[i];
            if (!entry) return;
            entry.status = 'live';
            this._setStatus(i, 'Live · ' + (this._readConfig(i).name || ''));
            if (i === this._selectedInput) { this._syncToggleButton(); this._syncToggleAllButton(); }
        });
        handle.addEventListener('waiting', () => {
            this._setStatus(i, 'Reconnecting…');
        });
        handle.addEventListener('error', (e: Event) => {
            const detail = (e as CustomEvent<{ message: string }>).detail;
            console.warn(`[stream-input ${i}]`, detail?.message);
            if (i === this._selectedInput) this._renderStatsBlock();
        });
    },

    _onStats(i: number, detail: { stats: any; demux: any }): void {
        const entry = this._inputs[i];
        if (!entry) return;
        entry.lastStats = detail.stats;
        if (i === this._selectedInput) {
            this._setStatus(i, this._formatStatusLine(entry, detail.stats));
            this._renderStatsBlock();
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

    // Self-driven presentation loop (mirrors vendor/WebSRT/web/src/render.ts
    // startRafLoop). Advances the PTS-paced ring every animation frame
    // regardless of whether a layer polled latestVideoFrame() this cycle,
    // so the ring drains at display-refresh rate and latency can't build
    // up when a bound layer is hidden/offscreen/busy.
    _startPresentLoop(inputIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry || entry._presentRaf !== null) return;
        const loop = () => {
            const e = this._inputs[inputIndex];
            // Stop the loop when the handle goes away (disconnect).
            if (!e || !e.handle) {
                if (e) e._presentRaf = null;
                return;
            }
            this._advanceDisplayedFrame(inputIndex);
            e._presentRaf = requestAnimationFrame(loop);
        };
        entry._presentRaf = requestAnimationFrame(loop);
    },

    _stopPresentLoop(inputIndex: number): void {
        const entry = this._inputs[inputIndex];
        if (!entry || entry._presentRaf === null) return;
        cancelAnimationFrame(entry._presentRaf);
        entry._presentRaf = null;
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

    _formatStatusLine(entry: InputEntry, stats: any): string {
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
        if (!entry || !entry.handle) {
            el.textContent = '';
            return;
        }
        if (!stats) {
            el.textContent = 'Waiting for stream info…';
            return;
        }
        const vs = stats.videoStats;
        const as = stats.audioStats;
        const videoLine = vs?.codecString
            ? `${vs.codecString}${vs.codedWidth ? ' · ' + vs.codedWidth + '×' + vs.codedHeight : ''}`
            : '—';
        const audioLine = as?.codec || '—';
        const framesLine = `${vs?.decodedCount || 0} frames · dropped ${vs?.droppedFrames || 0} · ${vs?.decodeFps ? vs.decodeFps.toFixed(0) + 'fps · ' : ''}${vs?.decoderState || '—'}`;
        const transportLine = `rxBytes ${((stats.rxData || 0) / 1e6).toFixed(1)}MB · rxAck ${Math.round(stats.rxAck || 0)} · rxNak ${Math.round(stats.rxNak || 0)} · rxBuffered ${Math.round(stats.rxBuffered || 0)}`;
        el.textContent =
            `Video: ${videoLine}\n` +
            `Audio: ${audioLine}\n` +
            `Decode: ${framesLine}\n` +
            `Transport: ${transportLine}`;
    },
};

if (typeof window !== 'undefined') (window as AnyWindow).StreamingInputUI = StreamingInputUI;
