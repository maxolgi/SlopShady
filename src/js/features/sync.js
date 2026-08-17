/**
 * Sync Module
 * WebSocket synchronization for real-time collaboration
 */

import { state, getEl } from '../state.js';
import { migrateMidiMappings } from '../utils/migrate.js';

// Forward declarations - will be set by main.js
let WebGL, Shaders, CodeDials, Conversation, LayerSystem, LayerMixer, VoiceUI, FeedbackUI, PlaylistSystem, PlaylistUI, modulationMatrixUI, MacrosUI, ScanimatePanel, ScanimatePatchBay, OSCUI;

export function setSyncDependencies(deps) {
    WebGL = deps.WebGL;
    Shaders = deps.Shaders;
    CodeDials = deps.CodeDials;
    Conversation = deps.Conversation;
    LayerSystem = deps.LayerSystem;
    LayerMixer = deps.LayerMixer;
    VoiceUI = deps.VoiceUI;
    FeedbackUI = deps.FeedbackUI;
    PlaylistSystem = deps.PlaylistSystem;
    PlaylistUI = deps.PlaylistUI;
    modulationMatrixUI = deps.modulationMatrixUI;
    MacrosUI = deps.MacrosUI;
    ScanimatePanel = deps.ScanimatePanel;
    ScanimatePatchBay = deps.ScanimatePatchBay;
    OSCUI = deps.OSCUI;
}

export const Sync = {
    enabled: false,
    ws: null,
    _applyingRemote: false,
    _reconnectDelay: 1000,
    _maxReconnectDelay: 15000,
    _dialDebounceTimer: null,
    _dialDebouncePending: null,

    init() {
        this._connect();
    },

    disconnect() {
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        console.log('%c🔌 Sync disconnected (standalone mode)', 'color:#fa0');
    },

    reconnect() {
        this.enabled = true;
        this._connect();
        console.log('%c🔌 Sync reconnecting...', 'color:#0ff');
    },

    _connect() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${location.host}/ws`;
        const ws = new WebSocket(url);
        this.ws = ws;

        ws.onopen = () => {
            console.log('%c🔌 Sync connected', 'color:#0ff');
            this._reconnectDelay = 1000;
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'init') {
                    this._applyFullState(msg.data);
                } else if (msg.type === 'update') {
                    this._applyUpdate(msg.data);
                }
            } catch (e) {
                console.warn('Sync parse error:', e);
            }
        };

        ws.onclose = () => {
            console.log(`%c🔌 Sync disconnected, reconnecting in ${this._reconnectDelay}ms`, 'color:#fa0');
            setTimeout(() => this._connect(), this._reconnectDelay);
            this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, this._maxReconnectDelay);
        };

        ws.onerror = () => {};
    },

    send(data) {
        if (!this.enabled) return;
        if (this._applyingRemote) return;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'update', data }));
        }
    },

    sendDialDebounced(dialValues) {
        if (!this.enabled) return;
        this._dialDebouncePending = dialValues;
        if (!this._dialDebounceTimer) {
            this._dialDebounceTimer = setTimeout(() => {
                if (this._dialDebouncePending) {
                    this.send({ codeDialValues: this._dialDebouncePending });
                    this._dialDebouncePending = null;
                }
                this._dialDebounceTimer = null;
            }, 100);
        }
    },

    _applyFullState(data) {
        this._applyingRemote = true;
        try {
            this._applyFields(data, true);
        } finally {
            this._applyingRemote = false;
        }

        // Start the render loop now that we have a shader (either from server or fallback)
        if (!state.renderStarted) {
            state.renderStarted = true;
            state.canvas.classList.add('rendering');
            WebGL.render();
        }
        document.getElementById('bottom-panel')?.classList.add('rendering');
        document.dispatchEvent(new CustomEvent('sync-init-done'));
    },

    _applyUpdate(data) {
        if (!this.enabled) return;
        this._applyingRemote = true;
        try {
            this._applyFields(data, false);
        } finally {
            this._applyingRemote = false;
        }
    },

    // Shared field-application body for _applyFullState/_applyUpdate. Callers own
    // the _applyingRemote guard; `fullState` gates the init-only divergences
    // (fallback bootstrap, initial layer compile, legacy init, UI refresh conditions).
    _applyFields(data, fullState) {
        // Migrate legacy midiMappings before processing state
        migrateMidiMappings(data);
        if (data.shaderCode && data.shaderCode.trim()) {
            getEl('shaderCode').value = data.shaderCode;
            WebGL.initShader();
        }
        if (data.savedShaders) {
            state.savedShaders = data.savedShaders;
            Shaders.render();
            document.dispatchEvent(new CustomEvent('shaders-changed'));
        }
        // Full state skips falsy ids; updates assign any defined value
        if (fullState ? data.currentShaderId : data.currentShaderId !== undefined) {
            state.currentShaderId = data.currentShaderId;
        }
        if (data.modulationRoutes) {
            state.modulationRoutes = data.modulationRoutes;
        }
        if (data.layerModulationMatrices !== undefined) {
            if (!Array.isArray(data.layerModulationMatrices)) {
                data.layerModulationMatrices = Array.from({ length: 8 }, () => []);
            } else {
                while (data.layerModulationMatrices.length < 8) data.layerModulationMatrices.push([]);
                data.layerModulationMatrices.length = 8;
            }
            state.layerModulationMatrices = data.layerModulationMatrices;
            for (let i = 0; i < 8; i++) {
                if (LayerSystem.layers[i]) {
                    LayerSystem.layers[i].modulationMatrix = data.layerModulationMatrices[i] || [];
                }
            }
        }
        if (data.lfos && Array.isArray(data.lfos)) {
            for (let i = 0; i < 4; i++) {
                if (data.lfos[i] && state.lfos[i]) {
                    state.lfos[i].rate = data.lfos[i].rate ?? state.lfos[i].rate;
                    state.lfos[i].waveform = data.lfos[i].waveform ?? state.lfos[i].waveform;
                    state.lfos[i].phaseOffset = data.lfos[i].phaseOffset ?? state.lfos[i].phaseOffset;
                    state.lfos[i].amplitude = data.lfos[i].amplitude ?? state.lfos[i].amplitude;
                    state.lfos[i].dcOffset = data.lfos[i].dcOffset ?? state.lfos[i].dcOffset;
                    state.lfos[i].syncMode = data.lfos[i].syncMode ?? state.lfos[i].syncMode;
                    state.lfos[i].syncRate = data.lfos[i].syncRate ?? state.lfos[i].syncRate;
                    state.lfos[i].keySync = data.lfos[i].keySync ?? state.lfos[i].keySync;
                }
            }
        }
        if (data.bpm !== undefined) state.bpm = data.bpm;
        if (data.isPaused !== undefined) {
            state.isPaused = data.isPaused;
            getEl('pausePlay').classList.toggle('active', !state.isPaused);
            getEl('timeSliderFineWrap').classList.toggle('slider--dimmed', !state.isPaused);
        }
        if (data.manualTime !== undefined) state.manualTime = data.manualTime;
        if (!fullState) {
            if (data.codeDialValues) {
                Object.assign(state.codeDialValues, data.codeDialValues);
                for (const [key, val] of Object.entries(data.codeDialValues)) {
                    const param = state.shaderParams.find(p => p.key === key);
                    if (param) param.currentValue = val;
                }
                CodeDials.render();
            }
            if (data.codeDialOriginals) {
                Object.assign(state.codeDialOriginals, data.codeDialOriginals);
            }
        }
        if (data.oscPort !== undefined) state.oscPort = data.oscPort;
        if (data.oscEnabled !== undefined) state.oscEnabled = data.oscEnabled;

        // Full state only: server has no shader - use the hardcoded fallback in the textarea
        if (fullState && !(data.shaderCode && data.shaderCode.trim())) {
            const code = getEl('shaderCode').value;
            if (code && code.trim()) {
                WebGL.initShader();
                Sync.send({
                    shaderCode: code,
                    codeDialValues: { ...state.codeDialValues },
                    codeDialOriginals: { ...state.codeDialOriginals },
                    savedShaders: state.savedShaders,
                    currentShaderId: state.currentShaderId,
                    lfos: state.lfos.map(l => ({
                        rate: l.rate, waveform: l.waveform, phaseOffset: l.phaseOffset,
                        amplitude: l.amplitude, dcOffset: l.dcOffset,
                        syncMode: l.syncMode, syncRate: l.syncRate, keySync: l.keySync
                    })),
                    bpm: state.bpm
                });
            }
        }

        // Layer system state
        const hasLayerState = !!(data.layers || data.backgroundLayer || data.master);
        if (hasLayerState) {
            LayerSystem.applyState(data);

            if (fullState) {
                // Recompile all layers with shader sources on initial load
                for (let i = 0; i < LayerSystem.layers.length; i++) {
                    const layer = LayerSystem.layers[i];
                    if (layer.material?.source && !layer.program) {
                        console.log(`%c🔄 Initial compile for Layer ${i}`, 'color:#0ff');
                        WebGL.compileForLayer(i);
                    }
                }
            }
        } else if (fullState && data.shaderCode) {
            // Legacy state without layers - initialize layer system
            LayerSystem.init();
        }
        if (fullState) {
            if (LayerMixer && typeof LayerMixer.renderEditTab === 'function') {
                LayerMixer.renderEditTab();
            }
            if (LayerMixer && typeof LayerMixer.updateUI === 'function') {
                LayerMixer.updateUI();
            }
            if (VoiceUI && typeof VoiceUI.applyState === 'function') {
                VoiceUI.applyState(data);
            }
        } else if (hasLayerState) {
            if (LayerMixer && typeof LayerMixer.updateUI === 'function') {
                LayerMixer.updateUI();
            }
            if (VoiceUI && typeof VoiceUI.applyState === 'function') {
                VoiceUI.applyState(data);
            }
            if (FeedbackUI && typeof FeedbackUI.updateFromState === 'function') {
                FeedbackUI.updateFromState();
            }
        }
        if (modulationMatrixUI && typeof modulationMatrixUI.applyState === 'function') {
            modulationMatrixUI.applyState(data);
        }
        if (data.macros && Array.isArray(data.macros) && MacrosUI && typeof MacrosUI.applyState === 'function') {
            MacrosUI.applyState(data);
        }
        if (data.scanimate && ScanimatePanel && typeof ScanimatePanel.applyState === 'function') {
            ScanimatePanel.applyState(data);
        }
        if (data.scanimate && ScanimatePatchBay && typeof ScanimatePatchBay.applyState === 'function') {
            ScanimatePatchBay.applyState(data);
        }
        if (fullState && FeedbackUI && typeof FeedbackUI.updateFromState === 'function') {
            FeedbackUI.updateFromState();
        }
        // Full state applies OSC UI before playlist state; updates apply playlist first
        if (fullState && OSCUI && typeof OSCUI.applyState === 'function') {
            OSCUI.applyState(data);
        }
        // Playlist state
        if (data.playlist && PlaylistSystem && typeof PlaylistSystem.applyState === 'function') {
            PlaylistSystem.applyState(data.playlist);
            if (PlaylistUI && typeof PlaylistUI.render === 'function') {
                PlaylistUI.render();
            }
        }
        if (!fullState && OSCUI && typeof OSCUI.applyState === 'function') {
            OSCUI.applyState(data);
        }
        if (data.lfos || data.bpm !== undefined) {
            document.dispatchEvent(new CustomEvent('lfos-changed'));
        }
    }
};
