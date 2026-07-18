/**
 * Playlist System
 * Preset playlist engine for automated shader sequencing with transitions.
 * ES module singleton following existing feature patterns (sync.js, midi.js).
 */

import { state, getEl } from '../state.js';
import { Sync } from './sync.js';

// Forward declarations — set by main.js via setDependencies()
let WebGL, LayerSystem, Shaders, LayerMixer, CodeDials;

let _idCounter = 0;
function _uid() {
    return 'pl_' + Date.now().toString(36) + '_' + (++_idCounter);
}

export const PlaylistSystem = {
    entries: [],
    isPlaying: false,
    currentIndex: -1,
    loop: true,
    defaultDuration: 30,
    defaultFadeIn: 2,
    defaultFadeOut: 2,

    _applyingRemote: false,
    _timers: [],       // setTimeout ids
    _animFrameIds: {},
    _progressInterval: null,

    /**
     * Set dependencies to avoid circular imports
     */
    setDependencies(deps) {
        WebGL = deps.WebGL;
        LayerSystem = deps.LayerSystem;
        Shaders = deps.Shaders;
        LayerMixer = deps.LayerMixer;
        CodeDials = deps.CodeDials;
    },

    // ─── Entry Management ───

    addEntry(options = {}) {
        const entry = {
            id: _uid(),
            name: options.name || 'Untitled',
            shaderCode: options.shaderCode || '',
            layerIndex: options.layerIndex ?? state.selectedLayer ?? 0,
            duration: options.duration ?? this.defaultDuration,
            fadeIn: options.fadeIn ?? this.defaultFadeIn,
            fadeOut: options.fadeOut ?? this.defaultFadeOut,
            midiNote: options.midiNote ?? null,
        };
        this.entries.push(entry);
        this._sync();
        return entry;
    },

    addEntryFromShaderId(shaderId, options = {}) {
        const shader = state.savedShaders.find(s => s.id === shaderId);
        if (!shader) return null;
        return this.addEntry({
            ...options,
            name: options.name || shader.name,
            shaderCode: shader.code,
        });
    },

    removeEntry(entryId) {
        const idx = this.entries.findIndex(e => e.id === entryId);
        if (idx === -1) return;
        this.entries.splice(idx, 1);
        if (this.entries.length === 0) {
            this.currentIndex = -1;
        } else if (this.currentIndex >= this.entries.length) {
            this.currentIndex = this.entries.length - 1;
        }
        this._sync();
    },

    moveEntry(oldIndex, newIndex) {
        if (oldIndex < 0 || oldIndex >= this.entries.length) return;
        if (newIndex < 0 || newIndex >= this.entries.length) return;
        const [entry] = this.entries.splice(oldIndex, 1);
        this.entries.splice(newIndex, 0, entry);
        if (this.isPlaying) {
            if (this.currentIndex === oldIndex) {
                this.currentIndex = newIndex;
            } else if (oldIndex < this.currentIndex && newIndex >= this.currentIndex) {
                this.currentIndex--;
            } else if (oldIndex > this.currentIndex && newIndex <= this.currentIndex) {
                this.currentIndex++;
            }
        }
        this._sync();
    },

    updateEntry(entryId, updates) {
        const entry = this.entries.find(e => e.id === entryId);
        if (!entry) return;
        Object.assign(entry, updates);
        this._sync();
    },

    clearEntries() {
        this.stop();
        this.entries = [];
        this.currentIndex = -1;
        this._sync();
    },

    // ─── Playback ───

    start(fromIndex) {
        if (this.entries.length === 0) return;
        this.stop();
        this.isPlaying = true;
        this.currentIndex = (fromIndex !== undefined) ? fromIndex : (this.currentIndex >= 0 ? this.currentIndex : 0);
        if (this.currentIndex >= this.entries.length) this.currentIndex = 0;
        this.loadEntry(this.currentIndex);
        this._startProgressInterval();
        this._sync();
    },

    stop() {
        this.isPlaying = false;
        this._clearTransitions();
        this._stopProgressInterval();
        this._sync();
    },

    advance() {
        if (!this.isPlaying) return;
        let next = this.currentIndex + 1;
        if (next >= this.entries.length) {
            if (this.loop) {
                next = 0;
            } else {
                this.stop();
                return;
            }
        }
        this.currentIndex = next;
        this.loadEntry(next);
    },

    goToEntry(index) {
        if (index < 0 || index >= this.entries.length) return;
        this._clearTransitions();
        this.currentIndex = index;
        if (this.isPlaying) {
            this.loadEntry(index);
        } else {
            this.start(index);
        }
    },

    /**
     * Load a playlist entry onto its target layer.
     * Pattern follows sync.js _applyFullState: set material.source then compile.
     */
    loadEntry(index) {
        this._playStartTime = Date.now();
        const entry = this.entries[index];
        if (!entry) return;

        const layerIdx = entry.layerIndex;
        const layer = LayerSystem.layers[layerIdx];
        if (!layer) return;

        // Set shader source and compile — same pattern as sync.js _applyFullState
        if (entry.shaderCode) {
            layer.material.source = entry.shaderCode;
            WebGL.compileForLayer(layerIdx);
        }

        // Enable the layer
        layer.enabled = true;

        // Fade in: animate opacity from 0 to 1
        if (entry.fadeIn > 0) {
            this._animateOpacity(layerIdx, 0, 1, entry.fadeIn);
        } else {
            layer.opacity = 1;
        }

        // Schedule transitions for this entry
        this._scheduleTransitions(entry);

        // Ensure render loop is running (compileForLayer doesn't start it)
        if (layer.program && !state.renderStarted) {
            if (!state.program) {
                state.program = layer.program;
                state.timeLoc = layer.timeLoc;
                state.resLoc = layer.resLoc;
            }
            state.renderStarted = true;
            state.canvas.classList.add('rendering');
            WebGL.render();
        }

        if (LayerMixer && typeof LayerMixer.updateUI === 'function') {
            LayerMixer.updateUI();
        }
    },

    // ─── Scheduling ───

    _scheduleTransitions(entry) {
        const duration = entry.duration || this.defaultDuration;
        const fadeOut = entry.fadeOut ?? this.defaultFadeOut;
        const layerIdx = entry.layerIndex;

        // Schedule fade-out
        const fadeOutStart = Math.max(0, (duration - fadeOut) * 1000);
        const fadeOutTimer = setTimeout(() => {
            if (entry.fadeOut > 0) {
                const layer = LayerSystem.layers[layerIdx];
                const fromOpacity = layer ? layer.opacity : 1;
                this._animateOpacity(layerIdx, fromOpacity, 0, entry.fadeOut);
            }
        }, fadeOutStart);
        this._timers.push(fadeOutTimer);

        // Schedule advance
        const advanceTimer = setTimeout(() => {
            this.advance();
        }, duration * 1000);
        this._timers.push(advanceTimer);
    },

    /**
     * Animate layer opacity using requestAnimationFrame
     */
    _animateOpacity(layerIndex, from, to, durationSec) {
        const layer = LayerSystem.layers[layerIndex];
        if (!layer) return;
        const durationMs = durationSec * 1000;
        const startTime = performance.now();

        // Cancel any running animation for this specific layer
        if (this._animFrameIds[layerIndex]) {
            cancelAnimationFrame(this._animFrameIds[layerIndex]);
        }

        const animate = (now) => {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / durationMs, 1);
            layer.opacity = from + (to - from) * t;
            if (LayerMixer && typeof LayerMixer.updateUI === 'function') {
                LayerMixer.updateUI();
            }
            if (t < 1) {
                this._animFrameIds[layerIndex] = requestAnimationFrame(animate);
            } else {
                delete this._animFrameIds[layerIndex];
            }
        };
        this._animFrameIds[layerIndex] = requestAnimationFrame(animate);
    },

    _clearTransitions() {
        for (const id of this._timers) {
            clearTimeout(id);
        }
        this._timers = [];
        for (const key of Object.keys(this._animFrameIds)) {
            cancelAnimationFrame(this._animFrameIds[key]);
        }
        this._animFrameIds = {};
    },

    // ─── Progress Tracking ───

    _startProgressInterval() {
        this._stopProgressInterval();
        this._playStartTime = Date.now();
        this._progressInterval = setInterval(() => {
            const entry = this.entries[this.currentIndex];
            if (!entry) return;
            const elapsed = (Date.now() - this._playStartTime) / 1000;
            const duration = entry.duration || this.defaultDuration;
            const progress = Math.min(elapsed / duration, 1);
            document.dispatchEvent(new CustomEvent('playlist-progress', {
                detail: { currentIndex: this.currentIndex, progress, elapsed, duration }
            }));
        }, 250);
    },

    _stopProgressInterval() {
        if (this._progressInterval) {
            clearInterval(this._progressInterval);
            this._progressInterval = null;
        }
        this._playStartTime = 0;
    },

    // ─── MIDI Triggering ───

    triggerByMidiNote(note) {
        const idx = this.entries.findIndex(e => e.midiNote === note);
        if (idx !== -1) {
            this.goToEntry(idx);
        }
    },

    // ─── Sync Integration ───

    getState() {
        return {
            entries: this.entries.map(e => ({ ...e })),
            isPlaying: this.isPlaying,
            currentIndex: this.currentIndex,
            loop: this.loop,
            defaultDuration: this.defaultDuration,
            defaultFadeIn: this.defaultFadeIn,
            defaultFadeOut: this.defaultFadeOut,
        };
    },

    applyState(playlistState) {
        if (!playlistState || typeof playlistState !== 'object') return;
        this._applyingRemote = true;
        try {
            if (Array.isArray(playlistState.entries)) {
                this.entries = playlistState.entries;
            }
            if (typeof playlistState.isPlaying === 'boolean') {
                // Don't auto-start on remote; just reflect state
                this.isPlaying = playlistState.isPlaying;
            }
            if (typeof playlistState.currentIndex === 'number') {
                this.currentIndex = playlistState.currentIndex;
            }
            if (typeof playlistState.loop === 'boolean') {
                this.loop = playlistState.loop;
            }
            if (typeof playlistState.defaultDuration === 'number') {
                this.defaultDuration = playlistState.defaultDuration;
            }
            if (typeof playlistState.defaultFadeIn === 'number') {
                this.defaultFadeIn = playlistState.defaultFadeIn;
            }
            if (typeof playlistState.defaultFadeOut === 'number') {
                this.defaultFadeOut = playlistState.defaultFadeOut;
            }
        } finally {
            this._applyingRemote = false;
        }
    },

    // ─── Import / Export ───

    exportJSON() {
        return JSON.stringify(this.getState(), null, 2);
    },

    importJSON(json) {
        try {
            const data = typeof json === 'string' ? JSON.parse(json) : json;
            if (data && typeof data === 'object') {
                this.stop();
                this.applyState(data);
                this._sync();
                return true;
            }
        } catch (e) {
            console.error('Playlist import failed:', e);
        }
        return false;
    },

    // ─── Internal ───

    _sync() {
        if (this._applyingRemote) return;
        Sync.send({ playlist: this.getState() });
    },

    /**
     * Initialize event listeners (MIDI note-on)
     */
    _initListeners() {
        document.addEventListener('midi-noteon', (e) => {
            if (e.detail && typeof e.detail.note === 'number') {
                this.triggerByMidiNote(e.detail.note);
            }
        });
    },
};

// Auto-init event listeners on module load
PlaylistSystem._initListeners();
