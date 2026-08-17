/**
 * OSC System
 * Open Sound Control input via the native UDP bridge (osc.rs).
 * Mirrors MIDISystem: parses /noteon /noteoff /cc /pitchbend /channelpressure
 * addresses and feeds the existing MIDISystem handlers, so all downstream
 * voice triggering, modulation, macros, and dispatched events just work.
 *
 * Schema:
 *   /note/{ch}          [volts, velocity]           V/Oct (0V=C4/60); vel absent=max, 0=off
 *   /noteon             [channel, note, velocity]   0-127
 *   /noteoff            [channel, note]
 *   /cc                 [channel, cc, value]        0-127
 *   /pitchbend          [channel, value]            -1.0..1.0
 *   /channelpressure    [channel, value]            0-127
 *   /ch/{n}             [value]                     0.0..1.0  (modulation source)
 */

import { state, getEl } from '../state.js';
import { MIDISystem } from './midi.js';
import { getSliderController } from '../ui/slider.js';
import { selectDropdownItem } from '../ui/bottom-panel.js';
import { LayerSystem } from '../webgl/layers.js';
import { Sync } from './sync.js';
import { CodeDials } from '../ui/codeDials.js';

export const OscLearn = {
    _callback: null,

    start(callback) {
        this._callback = callback;
    },

    cancel() {
        this._callback = null;
    },

    resolve(address) {
        if (this._callback === null) return false;
        const cb = this._callback;
        this._callback = null;
        cb(address);
        return true;
    },

    isActive() {
        return this._callback !== null;
    }
};

export const OSCSystem = {
    enabled: true,
    available: true,
    port: 8101,
    _monitorThrottle: null,
    _ws: null,
    _wsReconnectDelay: 1000,
    _wsMaxReconnectDelay: 15000,

    /**
     * Initialize — open a dedicated WebSocket to the OSC bridge so OSC
     * delivery works even when state-sync is disabled (the default).
     */
    init() {
        this.enabled = state.oscEnabled !== false;
        this.port = state.oscPort ?? 8101;

        // Pick up oscPort/oscEnabled after the initial state arrives from server
        document.addEventListener('sync-init-done', () => {
            this.port = state.oscPort ?? 8101;
            this.enabled = state.oscEnabled !== false;
        }, { once: true });

        this._connectWs();
        console.log(`%c📡 OSC System initialized (udp :${this.port})`, 'color:#0ff');
    },

    /**
     * Open a dedicated WebSocket to /ws for OSC packet delivery,
     * independent of the sync toggle. Only `osc` messages are dispatched.
     */
    _connectWs() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${location.host}/ws`;
        const ws = new WebSocket(url);
        this._ws = ws;

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'osc') {
                    this._handleMessage(msg.address, msg.args);
                }
            } catch (e) {
                // Ignore non-JSON or malformed frames — this socket is OSC-only
            }
        };

        ws.onopen = () => {
            this._wsReconnectDelay = 1000;
        };

        ws.onclose = () => {
            setTimeout(() => this._connectWs(), this._wsReconnectDelay);
            this._wsReconnectDelay = Math.min(this._wsReconnectDelay * 1.5, this._wsMaxReconnectDelay);
        };

        ws.onerror = () => {};
    },

    /**
     * Handle an incoming OSC message and route to MIDISystem.
     * @param {string} address - OSC address pattern (e.g. "/noteon")
     * @param {Array} args - argument array (numbers from JSON)
     */
    _handleMessage(address, args) {
        if (state.oscEnabled === false) return;
        if (!Array.isArray(args)) return;

        const argInt = (i, fallback = 0) => {
            const v = args[i];
            if (v === null || v === undefined) return fallback;
            const n = Number(v);
            return Number.isFinite(n) ? Math.floor(n) : fallback;
        };
        const argNum = (i, fallback = 0) => {
            const v = args[i];
            if (v === null || v === undefined) return fallback;
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        };

        // Strip trailing slash, lowercase for case-insensitive match
        const addr = (address || '').toLowerCase().replace(/\/+$/, '');

        if (addr.startsWith('/mix/')) {
            this._handleMix(addr, args);
            this._updateMonitor(address, args);
            return;
        }

        if (addr.startsWith('/code/')) {
            this._handleCode(addr, args);
            this._updateMonitor(address, args);
            return;
        }

        const noteMatch = addr.match(/^\/note\/(\d+)$/);
        if (noteMatch) {
            const channel = parseInt(noteMatch[1], 10);
            // V/Oct convention: arg 0 is a voltage (0V = C4 / MIDI 60, 1V/octave).
            // Matches VCV Rack's native CV (e.g. -3V = C1/note 24, +3V = C7/note 96).
            const volts = argNum(0, 0);
            const note = Math.max(0, Math.min(127, Math.round(60 + volts * 12)));
            // Velocity: absent → max (127); 0..1 (gate) → scaled; >1 → direct 0-127.
            const rawVel = argNum(1, NaN);
            let velocity;
            if (isNaN(rawVel)) velocity = 127;
            else if (rawVel <= 1) velocity = Math.round(rawVel * 127);
            else velocity = Math.round(rawVel);
            if (velocity === 0) {
                MIDISystem._handleNoteOff(channel, note);
            } else {
                MIDISystem._handleNoteOn(channel, note, velocity);
            }
        } else switch (addr) {
            case '/noteon':
            case '/on':
            case '/n': {
                // Standard MIDI convention: velocity 0 === note-off
                const velocity = argInt(2, 100);
                if (velocity === 0) {
                    MIDISystem._handleNoteOff(argInt(0), argInt(1));
                } else {
                    MIDISystem._handleNoteOn(argInt(0), argInt(1), velocity);
                }
                break;
            }
            case '/noteoff':
            case '/off':
                MIDISystem._handleNoteOff(argInt(0), argInt(1));
                break;
            case '/cc':
            case '/control':
            case '/controlchange':
                MIDISystem._handleCC(argInt(0), argInt(1), argInt(2));
                break;
            case '/pitchbend':
            case '/pitch':
            case '/pb': {
                const channel = argInt(0);
                const value = argNum(1);
                state.pitchBend[channel] = value;
                document.dispatchEvent(new CustomEvent('midi-pitchbend', {
                    detail: { channel, value }
                }));
                break;
            }
            case '/channelpressure':
            case '/aftertouch':
            case '/cp': {
                const channel = argInt(0);
                const value = argInt(1);
                state.channelPressure[channel] = value;
                document.dispatchEvent(new CustomEvent('midi-channelpressure', {
                    detail: { channel, value }
                }));
                break;
            }
            default:
                if (OscLearn.resolve(address)) break;
                if (args.length > 0) {
                    const v = Number(args[0]);
                    if (Number.isFinite(v)) {
                        state.oscValues[address] = v;
                        document.dispatchEvent(new CustomEvent('osc-value', {
                            detail: { address, value: v }
                        }));
                    }
                }
                break;
        }

        this._updateMonitor(address, args);
    },

    /**
     * Update the live message monitor (throttled to ~10fps).
     */
    _updateMonitor(address, args) {
        if (this._monitorThrottle) return;
        this._monitorThrottle = setTimeout(() => {
            this._monitorThrottle = null;
            const el = getEl('oscMonitor');
            if (!el) return;
            const argStr = args.map(a => {
                if (typeof a === 'number') {
                    return Number.isInteger(a) ? String(a) : a.toFixed(3);
                }
                return JSON.stringify(a);
            }).join(' ');
            el.textContent = `${address} ${argStr}`.trim();
        }, 100);
    },

    /**
     * Toggle semantics: no arg → flip; 0 → off; nonzero → on.
     */
    _oscToggle(id, args) {
        const el = getEl(id);
        if (!el) return;
        if (args.length === 0) {
            el.click();
        } else {
            const want = Number(args[0]) !== 0;
            const isActive = el.classList.contains('active');
            if (want !== isActive) el.click();
        }
    },

    /**
     * Slider semantics: raw value in native range, clamped. Triggers
     * onChange/onCommit so state updates and sync fires.
     */
    _oscSlider(el, args) {
        if (!el || args.length === 0) return;
        const v = Number(args[0]);
        if (!Number.isFinite(v)) return;
        const api = getSliderController(el);
        if (api) api.setValue(v, true);
    },

    /**
     * Dropdown semantics: string → case-insensitive match against
     * data-value; int → 0-based index. Delegates to selectDropdownItem.
     */
    _oscDropdown(menuId, args) {
        if (args.length === 0) return;
        const menu = getEl(menuId);
        if (!menu) return;

        let item = null;
        const arg = args[0];
        if (typeof arg === 'string') {
            const lower = arg.toLowerCase();
            const items = menu.querySelectorAll('.dropdown__item');
            for (const it of items) {
                if (it.dataset.value && it.dataset.value.toLowerCase() === lower) {
                    item = it;
                    break;
                }
            }
        } else {
            const idx = Math.floor(Number(arg));
            const items = menu.querySelectorAll('.dropdown__item');
            if (idx >= 0 && idx < items.length) item = items[idx];
        }
        if (item) selectDropdownItem(item);
    },

    /**
     * Route /mix/... addresses to mix-panel UI controls.
     */
    _handleMix(addr, args) {
        const parts = addr.split('/').filter(Boolean); // ['mix', ...rest]
        const section = parts[1];
        const sub = parts[2];

        // ── Global momentary/toggle controls ──
        if (parts.length === 2) {
            switch (section) {
                case 'switch': { const el = getEl('mix-switch-btn'); if (el) el.click(); return; }
                case 'camera':  return this._oscToggle('enableVideo', args);
                case 'screen':  return this._oscToggle('captureScreen', args);
                case 'bg':      return this._oscToggle('mix-bg-toggle', args);
            }
            return;
        }

        // ── Background type ──
        if (section === 'bg' && sub === 'type') {
            return this._oscDropdown('mix-bg-type-menu', args);
        }

        // ── Playlist ──
        if (section === 'pl') {
            const click = (id) => { const el = getEl(id); if (el) el.click(); };
            switch (sub) {
                case 'play':  click('plPlay');  return;
                case 'stop':  click('plStop');  return;
                case 'prev':  click('plPrev');  return;
                case 'next':  click('plNext');  return;
                case 'loop':  return this._oscToggle('plLoop', args);
                case 'add':   click('plAddCurrent'); return;
                case 'clear': click('plClearAll'); return;
            }
            return;
        }

        // ── Brain (VisualBrain) ──
        if (section === 'brain') {
            switch (sub) {
                case 'size': {
                    const size = Math.floor(Number(args[0]));
                    const btn = document.querySelector(`[data-vb-bs="${size}"]`);
                    if (btn) btn.click();
                    return;
                }
                case 'record': { const el = getEl('vb-record'); if (el) el.click(); return; }
                case 'seed':   { const el = getEl('vb-seed');   if (el) el.click(); return; }
                case 'clear':  { const el = getEl('vb-clear');  if (el) el.click(); return; }
                case 'blend':  return this._oscSlider(getEl('vb-blend-slider'), args);
                case 'glitch': return this._oscSlider(getEl('vb-glitch-slider'), args);
                case 'color':  return this._oscSlider(getEl('vb-colorw-slider'), args);
                case 'grid':   return this._oscToggle('vb-grid', args);
                case 'scan':   return this._oscToggle('vb-scanline', args);
                case 'mic':    return this._oscToggle('vb-audio', args);
                case 'audio':  return this._oscSlider(getEl('vb-audio-drive-slider'), args);
            }
            return;
        }

        // ── Per-layer ({n} = 1-8 in OSC, 0-7 internal) ──
        const layerNum = parseInt(section, 10);
        if (layerNum >= 1 && layerNum <= 8) {
            const i = layerNum - 1;

            // ── Feedback sub-section: /mix/{n}/fb/... ──
            if (sub === 'fb') {
                const fbAction = parts[3];
                if (!fbAction) return this._oscToggle(`mix-feedback-enabled-${i}`, args);
                if (fbAction === 'blend') return this._oscDropdown(`mix-feedback-blend-menu-${i}`, args);

                const fbParamMap = {
                    amount: 'feedbackAmount', decay: 'feedbackDecay', zoom: 'feedbackZoom',
                    rotate: 'feedbackRotate', offsetX: 'feedbackOffsetX', offsetY: 'feedbackOffsetY',
                    sat: 'feedbackSaturation', brt: 'feedbackBrightness',
                };
                const fbParam = fbParamMap[fbAction];
                if (fbParam) {
                    const container = getEl(`mix-feedback-controls-${i}`);
                    if (container) {
                        const slider = container.querySelector(`[data-param="${fbParam}"]`);
                        return this._oscSlider(slider, args);
                    }
                }
                return;
            }

            // ── Layer controls ──
            if (sub === 'input')  return this._oscDropdown(`mix-type-menu-${i}`, args);
            if (sub === 'preset') return this._oscDropdown(`mix-shader-menu-${i}`, args);
            if (sub === 'blend')  return this._oscDropdown(`mix-blend-menu-${i}`, args);
            if (sub === 'solo')      return this._oscToggle(`mix-solo-${i}`, args);
            if (sub === 'show')      return this._oscToggle(`mix-show-${i}`, args);
            if (sub === 'audioMute') return this._oscToggle(`mix-audio-mute-${i}`, args);
            if (sub === 'brain')     return this._oscToggle(`mix-brain-${i}`, args);

            const sliderParamMap = {
                opacity: 'opacity', volume: 'volume', brightness: 'brightness', speed: 'speed',
                posX: 'posX', posY: 'posY', scale: 'scale', amount: 'amount',
                rotation: 'rotation', stretch: 'stretch', radius: 'radius',
                maskX: 'maskPosX', maskY: 'maskPosY', maskSoft: 'maskSoftness',
            };
            const paramKey = sliderParamMap[sub];
            if (paramKey) return this._oscSlider(getEl(`mix-${paramKey}-slider-${i}`), args);
        }
    },

    /**
     * Route /code/... addresses to code-panel UI controls and per-layer dials.
     */
    _handleCode(addr, args) {
        const parts = addr.split('/').filter(Boolean); // ['code', ...rest]
        const section = parts[1];

        // ── Layer-indexed controls: /code/{n}/... ──
        const layerNum = parseInt(section, 10);
        if (layerNum >= 1 && layerNum <= 8) {
            const i = layerNum - 1;
            const sub = parts[2];

            // Reset all dials on layer: /code/{n}/reset
            if (sub === 'reset') {
                const layer = LayerSystem.layers[i];
                if (!layer?.shaderParams) return;
                const resetVals = {};
                for (const param of layer.shaderParams) {
                    if (param.key.startsWith('cd')) {
                        param.currentValue = param.originalValue;
                        state.codeDialValues[param.key] = param.originalValue;
                        resetVals[param.key] = param.originalValue;
                    }
                }
                Sync.sendDialDebounced(resetVals);
                if (state.selectedLayer === i) CodeDials.render();
                return;
            }

            // Individual dial: /code/{n}/dial/{idx}[/reset]
            if (sub === 'dial') {
                const idx = parseInt(parts[3], 10);
                if (isNaN(idx) || idx < 0) return;
                const dialKey = 'cd' + idx;
                const layer = LayerSystem.layers[i];
                const param = layer?.shaderParams?.find(p => p.key === dialKey);
                if (!param) return;

                // Reset individual: /code/{n}/dial/{idx}/reset
                if (parts[4] === 'reset') {
                    param.currentValue = param.originalValue;
                    state.codeDialValues[dialKey] = param.originalValue;
                    Sync.sendDialDebounced({ [dialKey]: param.originalValue });
                    if (state.selectedLayer === i) CodeDials.render();
                    return;
                }

                // Set value: /code/{n}/dial/{idx} [value]
                if (args.length === 0) return;
                const v = Number(args[0]);
                if (!Number.isFinite(v)) return;
                param.currentValue = v;
                state.codeDialValues[dialKey] = v;
                Sync.sendDialDebounced({ [dialKey]: v });
                if (state.selectedLayer === i) CodeDials.render();
                return;
            }
            return;
        }

        // ── Global controls ──
        switch (section) {
            case 'prev':   { const el = getEl('layerPrev');  if (el) el.click(); return; }
            case 'next':   { const el = getEl('layerNext');  if (el) el.click(); return; }
            case 'zoomIn': { const el = getEl('zoomIn');     if (el) el.click(); return; }
            case 'zoomOut':{ const el = getEl('zoomOut');    if (el) el.click(); return; }
            case 'pause':  return this._oscToggle('pausePlay', args);
            case 'compile': {
                // #recompile listens on mousedown, not click
                const el = getEl('recompile');
                if (el) el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                return;
            }
            case 'time':   return this._oscSlider(getEl('timeSliderWrap'), args);
            case 'fine':   return this._oscSlider(getEl('timeSliderFineWrap'), args);
        }
    },

    /**
     * Shut down OSC system
     */
    destroy() {
        this.enabled = false;
        if (this._ws) {
            this._ws.onclose = null;
            this._ws.close();
            this._ws = null;
        }
    }
};
