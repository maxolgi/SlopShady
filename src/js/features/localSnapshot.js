/**
 * LocalSnapshot
 * Snapshots the full performance state to localStorage so a plain page
 * refresh restores the session even with server sync disabled (the default).
 *
 * Restore runs after the server's init state is applied and only when sync
 * is off — with sync on, the server is the source of truth (it has been
 * receiving updates all along).
 */

import { state, getEl } from '../state.js';
import { Sync } from './sync.js';
import { LayerSystem } from '../webgl/layers.js';
import { LayerMixer } from '../ui/layerMixer.js';
import { PlaylistSystem } from './playlist.js';
import { CodeDials } from '../ui/codeDials.js';
import { SETTINGS_KEYS } from '../config.js';

const SAVE_INTERVAL_MS = 3000;

export const LocalSnapshot = {
    init() {
        // Restore after the server's init state lands. This listener is
        // registered after main.js's own sync-init-done handler, so
        // Sync.enabled is already settled when it runs.
        document.addEventListener('sync-init-done', () => {
            if (!Sync.enabled) this.restore();
        }, { once: true });

        setInterval(() => this.save(), SAVE_INTERVAL_MS);
        window.addEventListener('pagehide', () => this.save());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.save();
        });
    },

    build() {
        return {
            ...LayerSystem.getState(),
            shaderCode: getEl('shaderCode').value,
            codeDialValues: { ...state.codeDialValues },
            codeDialOriginals: { ...state.codeDialOriginals },
            savedShaders: state.savedShaders,
            currentShaderId: state.currentShaderId,
            modulationRoutes: state.modulationRoutes,
            layerModulationMatrices: state.layerModulationMatrices,
            lfos: state.lfos.map(l => ({
                rate: l.rate, waveform: l.waveform, phaseOffset: l.phaseOffset,
                amplitude: l.amplitude, dcOffset: l.dcOffset,
                syncMode: l.syncMode, syncRate: l.syncRate, keySync: l.keySync
            })),
            bpm: state.bpm,
            isPaused: state.isPaused,
            manualTime: state.manualTime,
            playlist: PlaylistSystem.getState(),
            macros: state.macros.map(m => ({ name: m.name, value: m.value, cc: m.cc })),
            scanimate: state.scanimate,
            oscPort: state.oscPort,
            oscBind: state.oscBind,
            oscEnabled: state.oscEnabled,
            selectedLayer: state.selectedLayer,
            timestamp: Date.now()
        };
    },

    save() {
        try {
            localStorage.setItem(SETTINGS_KEYS.localSnapshot, JSON.stringify(this.build()));
        } catch (e) {
            console.warn('LocalSnapshot: save failed:', e);
        }
    },

    restore() {
        let snap = null;
        try {
            snap = JSON.parse(localStorage.getItem(SETTINGS_KEYS.localSnapshot) || 'null');
        } catch (e) {
            try { localStorage.removeItem(SETTINGS_KEYS.localSnapshot); } catch (_) {}
        }
        if (!snap || typeof snap !== 'object' || !Array.isArray(snap.layers)) return;

        // Shader sources compiled during server init — layers whose source
        // changes below need a recompile (the fullState path only compiles
        // layers that lack a program, and stale programs exist by now).
        const before = LayerSystem.layers.map(l => l.material?.source || '');

        Sync._applyingRemote = true;
        try {
            Sync._applyFields(snap, true);
        } finally {
            Sync._applyingRemote = false;
        }

        // Recompile every layer whose shader source differs
        const snapSources = snap.layers.map(l => l.material?.source || '');
        LayerSystem.layers.forEach((l, i) => {
            if (snapSources[i] && snapSources[i] !== before[i]) {
                window.WebGL.compileForLayer(i);
            }
        });

        // The fullState path skips dial values (normally re-derived from
        // code) — apply the snapshot's explicitly
        Object.assign(state.codeDialValues, snap.codeDialValues || {});
        Object.assign(state.codeDialOriginals, snap.codeDialOriginals || {});

        // Re-select the snapshot's layer (swaps textarea + shaderParams)
        if (Number.isInteger(snap.selectedLayer) && snap.selectedLayer !== state.selectedLayer) {
            LayerMixer.selectLayer(Math.max(0, Math.min(7, snap.selectedLayer)));
        }

        // Overlay dial values onto the selected layer's params
        const layer = LayerSystem.layers[state.selectedLayer];
        if (layer?.shaderParams) {
            for (const p of layer.shaderParams) {
                if (p.key in state.codeDialValues) p.currentValue = state.codeDialValues[p.key];
            }
            state.shaderParams = layer.shaderParams;
        }
        CodeDials.render();

        console.log('%c💾 Local snapshot restored', 'color:#0ff');
    }
};
