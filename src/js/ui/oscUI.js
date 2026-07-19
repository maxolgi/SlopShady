/**
 * OSC UI Module
 * Wires the OSC panel controls: port input + Apply button, Enable toggle.
 * Persists via Sync.send({ oscPort, oscEnabled }) which the Rust backend
 * writes to shaders.json (see ws.rs PERSIST_KEYS).
 */

import { state, getEl } from '../state.js';
import { Sync } from '../features/sync.js';

export const OSCUI = {
    init() {
        const portInput = getEl('oscPortInput');
        const portApply = getEl('oscPortApply');
        const enableToggle = getEl('oscEnableToggle');

        if (portInput && portApply) {
            // Initialize from state once sync delivers it
            document.addEventListener('sync-init-done', () => {
                if (state.oscPort !== undefined) portInput.value = state.oscPort;
                this._syncEnableToggle();
            }, { once: true });

            portApply.addEventListener('click', () => {
                const v = parseInt(portInput.value, 10);
                if (!Number.isFinite(v) || v < 1 || v > 65535) return;
                state.oscPort = v;
                Sync.send({ oscPort: v });
                portApply.classList.add('active');
                setTimeout(() => portApply.classList.remove('active'), 200);
            });
        }

        if (enableToggle) {
            enableToggle.addEventListener('click', () => {
                const next = !(state.oscEnabled !== false);
                state.oscEnabled = next;
                enableToggle.classList.toggle('active', next);
                Sync.send({ oscEnabled: next });
            });
        }
    },

    /**
     * Sync the toggle's active class with state.oscEnabled.
     */
    _syncEnableToggle() {
        const enableToggle = getEl('oscEnableToggle');
        if (!enableToggle) return;
        enableToggle.classList.toggle('active', state.oscEnabled !== false);
    },

    applyState(data) {
        const portInput = getEl('oscPortInput');
        if (portInput && data.oscPort !== undefined && document.activeElement !== portInput) {
            portInput.value = data.oscPort;
        }
        if (data.oscEnabled !== undefined) {
            this._syncEnableToggle();
        }
    }
};
