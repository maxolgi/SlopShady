/**
 * MIDI System
 * Web MIDI API integration for polyphonic visual voices.
 * Routes note-on/note-off to layer voices, CC to modulation.
 */

import { state, getEl } from '../state.js';
import { SETTINGS_KEYS } from '../config.js';
import { loadFromLocalStorage, saveToLocalStorage } from '../utils.js';

export const MidiLearn = {
    _callback: null,

    start(callback) {
        this._callback = callback;
    },

    cancel() {
        this._callback = null;
    },

    resolve(cc) {
        if (this._callback === null) return false;
        const cb = this._callback;
        this._callback = null;
        cb(cc);
        return true;
    },

    isActive() {
        return this._callback !== null;
    }
};

export const MIDISystem = {
    access: null,
    inputs: [],
    enabled: false,
    available: true,      // Set to false if Web MIDI API cannot be initialized
    _unavailableReason: '',
    _selectedDeviceId: null,  // null = all devices; otherwise a MIDIInput.id

    // Forward reference — set during init
    _layerSystem: null,

    /**
     * Set dependencies (called from main.js to avoid circular imports)
     */
    setDependencies(deps) {
        this._layerSystem = deps.LayerSystem;
    },

    /**
     * Initialize Web MIDI API
     * @returns {Promise<boolean>} Whether MIDI was successfully initialized
     */
    async init() {
        // If previously determined permanently unavailable, don't retry
        if (this.available === false) return false;

        this._selectedDeviceId = loadFromLocalStorage(SETTINGS_KEYS.midiDeviceId, '') || null;

        // Wire up the device dropdown (safe to call before access is granted)
        this._initDeviceDropdown();

        if (navigator.requestMIDIAccess) {
            try {
                this.access = await navigator.requestMIDIAccess();
                this.access.onstatechange = () => this._updateInputs();
                this._updateInputs();
                this.enabled = true;
                this.available = true;
                console.log('%c🎹 MIDI System initialized', 'color:#0ff');
                return true;
            } catch (err) {
                this.available = false;
                this._unavailableReason = err.message || 'MIDI access denied';
                console.warn('MIDISystem: requestMIDIAccess failed:', err);
            }
        }

        this.available = false;
        this._unavailableReason = 'MIDI not available';
        console.info('MIDISystem:', this._unavailableReason);
        this._updateStatusUI();
        this._populateDeviceMenu();
        return false;
    },

    /**
     * Update connected MIDI inputs list and bind handlers
     */
    _updateInputs() {
        if (!this.access) return;
        // Clear all existing handlers first
        for (const input of this.inputs) {
            input.onmidimessage = null;
        }
        this.inputs = Array.from(this.access.inputs.values());
        // Bind only the selected device, or all if none selected
        for (const input of this.inputs) {
            if (this._selectedDeviceId === null || input.id === this._selectedDeviceId) {
                input.onmidimessage = (msg) => this._handleMessage(msg);
            }
        }
        this._updateStatusUI();
        this._populateDeviceMenu();
    },

    /**
     * Wire up the MIDI device dropdown menu listener
     */
    _initDeviceDropdown() {
        const menu = getEl('midi-device-menu');
        if (!menu) return;
        menu.addEventListener('dropdown-select', (e) => {
            const value = e.target.dataset.value;
            this._selectedDeviceId = value || null;
            saveToLocalStorage(SETTINGS_KEYS.midiDeviceId, this._selectedDeviceId || '');
            // Rebind handlers for the new selection
            this._updateInputs();
        });
    },

    /**
     * Populate the MIDI device dropdown menu from connected inputs
     */
    _populateDeviceMenu() {
        const menu = getEl('midi-device-menu');
        if (!menu) return;
        const dropdown = getEl('midi-device-dropdown');
        menu.innerHTML = '';

        // "All MIDI Devices" default option
        const allItem = document.createElement('div');
        allItem.className = 'dropdown__item' + (this._selectedDeviceId === null ? ' active' : '');
        allItem.textContent = 'All MIDI Devices';
        allItem.dataset.value = '';
        menu.appendChild(allItem);

        if (this.inputs.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'dropdown__item';
            empty.textContent = 'No MIDI devices';
            menu.appendChild(empty);
        } else {
            this.inputs.forEach((input, i) => {
                const item = document.createElement('div');
                item.className = 'dropdown__item' + (this._selectedDeviceId === input.id ? ' active' : '');
                item.textContent = input.name || `MIDI Device ${i + 1}`;
                item.dataset.value = input.id;
                menu.appendChild(item);
            });
        }

        // Update the dropdown label to reflect the current selection
        if (dropdown) {
            const span = dropdown.querySelector('span');
            if (span) {
                if (this._selectedDeviceId === null) {
                    span.textContent = 'All MIDI Devices';
                } else {
                    const selected = this.inputs.find(inp => inp.id === this._selectedDeviceId);
                    span.textContent = selected ? (selected.name || 'MIDI Device') : 'All MIDI Devices';
                }
            }
        }
    },

    /**
     * Handle incoming MIDI message
     * @param {WebGLMIDIMessageEvent} msg - MIDI message event
     */
    _handleMessage(msg) {
        if (!this.enabled || !this.access) return;
        const [status, data1, data2] = msg.data;
        const type = status & 0xF0;
        const channel = status & 0x0F;

        // Note On (type 0x90 with velocity > 0)
        if (type === 0x90 && data2 > 0) {
            this._handleNoteOn(channel, data1, data2);
        }
        // Note Off (type 0x80, or type 0x90 with velocity 0)
        else if (type === 0x80 || (type === 0x90 && data2 === 0)) {
            this._handleNoteOff(channel, data1);
        }
        // Control Change (type 0xB0)
        else if (type === 0xB0) {
            this._handleCC(channel, data1, data2);
        }
        // Pitch Bend (type 0xE0)
        else if (type === 0xE0) {
            const value = ((data1 | (data2 << 7)) / 8192) - 1;
            state.pitchBend[channel] = value;
            document.dispatchEvent(new CustomEvent('midi-pitchbend', {
                detail: { channel, value }
            }));
        }
        // Channel Pressure (type 0xD0)
        else if (type === 0xD0) {
            state.channelPressure[channel] = data1;
            document.dispatchEvent(new CustomEvent('midi-channelpressure', {
                detail: { channel, value: data1 }
            }));
        }
    },

    /**
     * Handle MIDI Note On
     * @param {number} channel - MIDI channel (0-15)
     * @param {number} note - MIDI note number (0-127)
     * @param {number} velocity - MIDI velocity (0-127)
     */
    _handleNoteOn(channel, note, velocity) {
        if (!this._layerSystem) return;

        for (const layer of this._layerSystem.layers) {
            if (!layer.enabled || !layer.voiceManager || layer.voiceMode === 'off') continue;
            if (!this._shouldReceive(layer, channel, note)) continue;

            layer.voiceManager.trigger(note, velocity);
        }

        // Dispatch custom event for UI updates
        document.dispatchEvent(new CustomEvent('midi-noteon', {
            detail: { channel, note, velocity }
        }));
    },

    /**
     * Handle MIDI Note Off
     * @param {number} channel - MIDI channel (0-15)
     * @param {number} note - MIDI note number (0-127)
     */
    _handleNoteOff(channel, note) {
        if (!this._layerSystem) return;

        for (const layer of this._layerSystem.layers) {
            if (!layer.voiceManager || layer.voiceMode === 'off') continue;
            layer.voiceManager.release(note);
        }

        // Dispatch custom event for UI updates
        document.dispatchEvent(new CustomEvent('midi-noteoff', {
            detail: { channel, note }
        }));
    },

    /**
     * Handle MIDI Control Change
     * @param {number} channel - MIDI channel (0-15)
     * @param {number} cc - CC number (0-127)
     * @param {number} value - CC value (0-127)
     */
    _handleCC(channel, cc, value) {
        const normalizedValue = value / 127;

        // Store for modulation system
        state.midiCCValues[cc] = normalizedValue;

        // Handle MIDI learn
        MidiLearn.resolve(cc);

        // Dispatch custom event for UI updates
        document.dispatchEvent(new CustomEvent('midi-cc', {
            detail: { channel, cc, value, normalizedValue }
        }));

        // Route CC to assigned macros
        for (const macro of state.macros) {
            if (macro.cc === cc) {
                macro.value = normalizedValue;
                document.dispatchEvent(new CustomEvent('macro-change', {
                    detail: { macro, value: normalizedValue }
                }));
            }
        }
    },

    /**
     * Check if a layer should receive MIDI for the given channel/note
     * @param {object} layer - Layer instance
     * @param {number} channel - MIDI channel
     * @param {number} note - MIDI note
     * @returns {boolean}
     */
    _shouldReceive(layer, channel, note) {
        const input = layer.input || {};
        if (input.channels && Array.isArray(input.channels) && !input.channels.includes(channel)) {
            return false;
        }
        if (input.noteRange && Array.isArray(input.noteRange)) {
            if (note < input.noteRange[0] || note > input.noteRange[1]) {
                return false;
            }
        }
        return true;
    },

    /**
     * Get list of connected MIDI input device names
     * @returns {string[]}
     */
    getInputNames() {
        if (!this.access) return [];
        return this.inputs.map(input => input.name || 'Unknown Device');
    },

    /**
     * Update the MIDI status UI element
     */
    _updateStatusUI() {
        const statusEl = getEl('midiStatus');
        if (!statusEl) return;

        if (!this.available) {
            statusEl.className = 'mod-status-item';
            statusEl.innerHTML = `<span>🎹</span> <span>MIDI: ${this._unavailableReason || 'Unavailable'}</span>`;
            return;
        }

        if (!this.enabled) {
            statusEl.className = 'mod-status-item';
            statusEl.innerHTML = '<span>🎹</span> <span>MIDI: Off</span>';
            return;
        }

        const count = this.inputs.length;
        const statusText = count > 0 ? `On (${count} device${count > 1 ? 's' : ''})` : 'On (no devices)';
        statusEl.className = 'mod-status-item active';
        statusEl.innerHTML = `<span>🎹</span> <span>MIDI: ${statusText}</span>`;
    },

    /**
     * Shut down MIDI system
     */
    destroy() {
        if (this.access) {
            for (const input of this.inputs) {
                input.onmidimessage = null;
            }
            this.access.onstatechange = null;
        }
        this.access = null;
        this.inputs = [];
        this.enabled = false;
    }
};
