/**
 * Voice UI Module
 * Handles voice mode selector, glide time control, and voice status indicators
 */

import { state, getEl } from '../state.js';
import { MAX_VOICES, LFO_WAVEFORMS } from '../config.js';
import { LayerSystem } from '../webgl/layers.js';
import { Sync } from '../features/sync.js';
import { LFOEngine } from '../features/lfoEngine.js';
import { initSlider } from './slider.js';
import { createDebouncedSync } from '../utils.js';

const scheduleSync = createDebouncedSync(() => Sync.send(LayerSystem.getState()));
const scheduleLFOSync = createDebouncedSync(() => Sync.send({
    lfos: state.lfos.map(l => ({
        rate: l.rate, waveform: l.waveform, phaseOffset: l.phaseOffset,
        amplitude: l.amplitude, dcOffset: l.dcOffset,
        syncMode: l.syncMode, syncRate: l.syncRate, keySync: l.keySync
    })),
    bpm: state.bpm
}));

const sliderControllers = new Map();

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function drawLFOCanvas(i) {
    const canvas = getEl(`lfo-canvas-${i}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const lfo = state.lfos[i];
    if (!lfo) return;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    const mid = H / 2;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(W, mid);
    ctx.stroke();

    const amp = lfo.amplitude ?? 1.0;
    const dc = lfo.dcOffset || 0;
    const isSNH = lfo.waveform === 'snh';

    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    if (isSNH) {
        const steps = 16;
        const stepW = W / steps;
        for (let s = 0; s < steps; s++) {
            const x1 = s * stepW;
            const x2 = (s + 1) * stepW;
            const hash1 = Math.sin(s * 127.1 + 311.7) * 43758.5453;
            const v1 = ((hash1 - Math.floor(hash1)) * 2 - 1) * amp + dc;
            const y1 = mid - v1 * mid * 0.8;
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y1);
            if (s < steps - 1) {
                const hash2 = Math.sin((s + 1) * 127.1 + 311.7) * 43758.5453;
                const v2 = ((hash2 - Math.floor(hash2)) * 2 - 1) * amp + dc;
                const y2 = mid - v2 * mid * 0.8;
                ctx.moveTo(x2, y1);
                ctx.lineTo(x2, y2);
            }
        }
    } else {
        const fn = Object.prototype.hasOwnProperty.call(LFO_WAVEFORMS, lfo.waveform)
            ? LFO_WAVEFORMS[lfo.waveform] : LFO_WAVEFORMS.sine;
        for (let px = 0; px <= W; px++) {
            const phase = px / W;
            const raw = fn(phase);
            const v = raw * amp + dc;
            const y = mid - v * mid * 0.8;
            if (px === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
        }
    }
    ctx.stroke();

    const currentPhase = (lfo.phase + lfo.phaseOffset) % 1;
    const currentOutput = LFOEngine.getOutputValue(i);
    const dotX = currentPhase * W;
    const dotY = mid - currentOutput * mid * 0.8;

    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function midiNoteToName(note) {
    if (note <= 0) return '—';
    const octave = Math.floor(note / 12) - 1;
    const name = NOTE_NAMES[note % 12];
    return `${name}${octave}`;
}

function midiNoteToNameInclusive(note) {
    if (note < 0) return '—';
    const octave = Math.floor(note / 12) - 1;
    const name = NOTE_NAMES[note % 12];
    return `${name}${octave}`;
}

export const VoiceUI = {
    _updateInterval: null,

    init() {
        this.setupVoiceModeButtons();
        this.setupGlideControl();
        this.setupMIDIListeners();
        this.setupMIDIInputFilter();
        this.initLFOControls();
        this.startStatusUpdates();
        
        document.addEventListener('layer-select', () => this.updateForCurrentLayer());
        document.addEventListener('lfos-changed', () => this.applyLFOState());
    },

    setupVoiceModeButtons() {
        const buttons = document.querySelectorAll('[data-voice-mode]');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.voiceMode;
                const layer = LayerSystem.layers[state.selectedLayer];
                if (layer && layer.voiceMode === mode) {
                    this.setVoiceMode('off');
                } else {
                    this.setVoiceMode(mode);
                }
            });
        });
    },

    setupGlideControl() {
        const sliderEl = getEl('glideTimeSlider');
        if (!sliderEl) return;
        const ctrl = initSlider(sliderEl, {
            format: v => v.toFixed(2) + 's',
            onChange: (val) => {
                const layer = LayerSystem.layers[state.selectedLayer];
                if (layer) {
                    layer.setGlideTime(val);
                    scheduleSync();
                }
            },
        });
        if (ctrl) sliderControllers.set('glide', ctrl);
    },

    setupMIDIListeners() {
        // Listen for MIDI note events to update voice status in real-time
        document.addEventListener('midi-noteon', () => {
            this.updateVoiceStatus();
        });
        document.addEventListener('midi-noteoff', () => {
            this.updateVoiceStatus();
        });
    },

    setVoiceMode(mode) {
        const layer = LayerSystem.layers[state.selectedLayer];
        if (!layer) return;

        layer.setVoiceMode(mode);

        if (mode === 'off') {
            document.querySelectorAll('[data-voice-mode]').forEach(btn => {
                btn.classList.remove('active');
            });
        } else {
            document.querySelectorAll('[data-voice-mode]').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.voiceMode === mode);
            });
        }

        scheduleSync();
    },

    setupMIDIInputFilter() {
        const grid = document.getElementById('midiChannelGrid');
        if (!grid) return;

        grid.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-midi-channel]');
            if (!btn) return;

            const layer = LayerSystem.layers[state.selectedLayer];
            if (!layer) return;
            layer.input = layer.input || {};

            const channel = btn.dataset.midiChannel;
            if (channel === 'all') {
                layer.input.channels = undefined;
            } else {
                const ch = parseInt(channel, 10);
                const channels = layer.input.channels;
                if (!Array.isArray(channels)) {
                    layer.input.channels = [ch];
                } else if (channels.includes(ch)) {
                    const next = channels.filter(c => c !== ch);
                    layer.input.channels = next.length > 0 ? next : undefined;
                } else {
                    layer.input.channels = [...channels, ch].sort((a, b) => a - b);
                }
            }

            this._updateChannelButtonStates(layer);
            scheduleSync();
        });

        this._setupNoteRangeSlider('midiNoteMinSlider', 0);
        this._setupNoteRangeSlider('midiNoteMaxSlider', 1);
    },

    _setupNoteRangeSlider(sliderId, rangeIndex) {
        const sliderEl = document.getElementById(sliderId);
        if (!sliderEl) return;
        let ctrl;
        ctrl = initSlider(sliderEl, {
            format: v => midiNoteToNameInclusive(v),
            onChange: (val) => {
                const layer = LayerSystem.layers[state.selectedLayer];
                if (!layer) return;
                layer.input = layer.input || {};
                if (!layer.input.noteRange || !Array.isArray(layer.input.noteRange)) {
                    layer.input.noteRange = [0, 127];
                }
                const otherIndex = rangeIndex === 0 ? 1 : 0;
                const otherValue = layer.input.noteRange[otherIndex];

                if (rangeIndex === 0 && val > otherValue) {
                    layer.input.noteRange[0] = otherValue;
                    layer.input.noteRange[1] = val;
                    this._updateNoteRangeSliderUI(otherIndex);
                } else if (rangeIndex === 1 && val < otherValue) {
                    layer.input.noteRange[0] = val;
                    layer.input.noteRange[1] = otherValue;
                    this._updateNoteRangeSliderUI(otherIndex);
                } else {
                    layer.input.noteRange[rangeIndex] = val;
                }
                scheduleSync();
            },
            onCommit: () => {
                const layer = LayerSystem.layers[state.selectedLayer];
                if (!layer?.input?.noteRange) return;
                const actual = layer.input.noteRange[rangeIndex];
                if (typeof actual === 'number' && ctrl) {
                    ctrl.setValue(actual);
                }
            },
        });
        if (ctrl) sliderControllers.set(`noteRange${rangeIndex}`, ctrl);
    },

    _updateChannelButtonStates(layer) {
        const grid = document.getElementById('midiChannelGrid');
        if (!grid) return;
        const channels = layer.input?.channels;
        const isAll = !Array.isArray(channels);

        grid.querySelectorAll('[data-midi-channel]').forEach(btn => {
            const ch = btn.dataset.midiChannel;
            if (ch === 'all') {
                btn.classList.toggle('active', isAll);
            } else {
                const num = parseInt(ch, 10);
                btn.classList.toggle('active', !isAll && channels.includes(num));
            }
        });
    },

    _updateNoteRangeSliderUI(rangeIndex) {
        const ctrl = sliderControllers.get(`noteRange${rangeIndex}`);
        const layer = LayerSystem.layers[state.selectedLayer];
        if (!layer || !layer.input?.noteRange || layer.input.noteRange.length < 2) return;
        const value = layer.input.noteRange[rangeIndex];
        if (typeof value !== 'number') return;
        if (ctrl) ctrl.setValue(value);
    },

    updateForCurrentLayer() {
        const layer = LayerSystem.layers[state.selectedLayer];
        if (!layer) return;

        // Update voice mode buttons
        document.querySelectorAll('[data-voice-mode]').forEach(btn => {
            btn.classList.toggle('active', layer.voiceMode !== 'off' && btn.dataset.voiceMode === layer.voiceMode);
        });

        const glideCtrl = sliderControllers.get('glide');
        if (glideCtrl && layer.voiceManager) {
            glideCtrl.setValue(layer.voiceManager.glideTime);
        }

        // Update layer indicator
        const indicator = getEl('voiceLayerIndicator');
        if (indicator) {
            indicator.textContent = `Layer ${state.selectedLayer + 1} (${layer.name})`;
        }

        // Update MIDI input filter UI
        this._updateChannelButtonStates(layer);
        this._updateNoteRangeSliderUI(0);
        this._updateNoteRangeSliderUI(1);

        this.updateVoiceStatus();
    },

    updateVoiceStatus() {
        const layer = LayerSystem.layers[state.selectedLayer];
        if (!layer || !layer.voiceManager) return;

        const voices = layer.voiceManager.voices;

        for (let i = 0; i < MAX_VOICES; i++) {
            const statusEl = getEl(`voiceStatus${i}`);
            if (!statusEl) continue;

            const voice = voices[i];
            const isActive = voice.active;

            statusEl.classList.toggle('active', isActive);

            const noteSpan = statusEl.querySelector('.voice-note');
            const velSpan = statusEl.querySelector('.voice-vel');

            if (noteSpan) {
                noteSpan.textContent = isActive ? midiNoteToName(voice.note) : '—';
            }
            if (velSpan) {
                velSpan.textContent = isActive ? `${Math.round(voice.velocity / 127 * 100)}%` : '';
            }
        }
    },

    startStatusUpdates() {
        this._updateInterval = setInterval(() => {
            const voicesPanelActive = document.querySelector('.content-panel[data-panel="voices"]')?.classList.contains('content-panel--active');
            this.updateVoiceStatus();
            this.updateMixerVoiceIndicators();
            if (voicesPanelActive) {
                this.updateLFOCanvases();
            }
        }, 66);
    },

    updateLFOCanvases() {
        for (let i = 0; i < 4; i++) {
            drawLFOCanvas(i);
        }
    },

    updateMixerVoiceIndicators() {
        // Update small voice indicators on the layer mixer strips
        for (let i = 0; i < 8; i++) {
            const layer = LayerSystem.layers[i];
            if (!layer || !layer.voiceManager) continue;

            const strip = getEl(`mixer-strip-${i}`);
            if (!strip) continue;

            // Ensure voice indicator exists
            let indicator = strip.querySelector('.voice-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.className = 'voice-indicator';
                for (let v = 0; v < MAX_VOICES; v++) {
                    const dot = document.createElement('div');
                    dot.className = 'voice-indicator-dot';
                    dot.dataset.voiceIndex = v;
                    indicator.appendChild(dot);
                }
                // Insert after the layer number
                const numEl = strip.querySelector('.layer-number');
                if (numEl && numEl.nextSibling) {
                    strip.insertBefore(indicator, numEl.nextSibling);
                } else if (numEl) {
                    strip.appendChild(indicator);
                }
            }

            // Update dot states
            const dots = indicator.querySelectorAll('.voice-indicator-dot');
            const voices = layer.voiceManager.voices;
            dots.forEach((dot, vi) => {
                dot.classList.toggle('active', voices[vi] && voices[vi].active);
            });
        }
    },

    /**
     * Apply state received from server — sync voice UI to actual layer data.
     * Called by Sync module after LayerSystem.applyState().
     * @param {object} data - State payload that may contain layers array
     */
    applyState(data) {
        if (!data || !data.layers || !Array.isArray(data.layers)) return;

        // Update voice UI for the currently selected layer
        const layerData = data.layers[state.selectedLayer];
        if (!layerData) return;

        const mode = layerData.voiceMode || 'poly';
        document.querySelectorAll('[data-voice-mode]').forEach(btn => {
            btn.classList.toggle('active', mode !== 'off' && btn.dataset.voiceMode === mode);
        });

        // Update glide slider/display from persisted value
        const glideTime = layerData.glideTime !== undefined && layerData.glideTime !== null
            ? layerData.glideTime : 0.1;
        const glideCtrl = sliderControllers.get('glide');
        if (glideCtrl) glideCtrl.setValue(glideTime);

        // Update layer indicator
        const indicator = getEl('voiceLayerIndicator');
        if (indicator) {
            const layer = LayerSystem.layers[state.selectedLayer];
            indicator.textContent = `Layer ${state.selectedLayer + 1} (${layer ? layer.name : ''})`;
        }

        // Update MIDI input filter from persisted layer state
        const layer = LayerSystem.layers[state.selectedLayer];
        if (layer) {
            this._updateChannelButtonStates(layer);
            this._updateNoteRangeSliderUI(0);
            this._updateNoteRangeSliderUI(1);
        }
    },

    applyLFOState() {
        const bpmCtrl = sliderControllers.get('lfo-bpm');
        if (bpmCtrl) bpmCtrl.setValue(state.bpm);

        for (let i = 0; i < 4; i++) {
            const lfo = state.lfos[i];
            if (!lfo) continue;

            const rateCtrl = sliderControllers.get(`lfo-rate-${i}`);
            if (rateCtrl) rateCtrl.setValue(lfo.rate);

            const phaseCtrl = sliderControllers.get(`lfo-phase-${i}`);
            if (phaseCtrl) phaseCtrl.setValue(lfo.phaseOffset);

            const ampCtrl = sliderControllers.get(`lfo-amp-${i}`);
            if (ampCtrl) ampCtrl.setValue(lfo.amplitude);

            const offsetCtrl = sliderControllers.get(`lfo-offset-${i}`);
            if (offsetCtrl) offsetCtrl.setValue(lfo.dcOffset);

            const syncToggle = getEl(`lfo-sync-toggle-${i}`);
            const rateSliderEl = getEl(`lfo-rate-slider-${i}`);
            const syncRateDropdown = document.querySelector(`[data-lfo-sync-rate="${i}"]`);
            if (syncToggle) {
                syncToggle.classList.toggle('active', lfo.syncMode === 'sync');
            }
            if (syncRateDropdown) {
                syncRateDropdown.classList.toggle('hidden', lfo.syncMode !== 'sync');
            }
            if (rateSliderEl) {
                rateSliderEl.classList.toggle('disabled', lfo.syncMode === 'sync');
            }

            const syncRateBtn = getEl(`lfo-sync-rate-${i}`);
            if (syncRateBtn) {
                syncRateBtn.querySelector('span').textContent = lfo.syncRate || '1/4';
            }

            const keySyncToggle = getEl(`lfo-keysync-toggle-${i}`);
            if (keySyncToggle) {
                keySyncToggle.classList.toggle('active', !!lfo.keySync);
            }

            const waveformBtn = getEl(`lfo-waveform-${i}`);
            if (waveformBtn) {
                const displayName = lfo.waveform.charAt(0).toUpperCase() + lfo.waveform.slice(1);
                waveformBtn.querySelector('span').textContent = displayName;
            }

            const waveformMenu = getEl(`lfo-waveform-menu-${i}`);
            if (waveformMenu) {
                waveformMenu.querySelectorAll('.dropdown__item').forEach(item => {
                    item.classList.toggle('active', item.dataset.value === lfo.waveform);
                });
            }

            const syncMenu = getEl(`lfo-sync-rate-menu-${i}`);
            if (syncMenu) {
                syncMenu.querySelectorAll('.dropdown__item').forEach(item => {
                    item.classList.toggle('active', item.dataset.value === lfo.syncRate);
                });
            }

            drawLFOCanvas(i);
        }
    },

    initLFOControls() {
        const lfoSync = scheduleLFOSync;

        // BPM slider
        const bpmSliderEl = getEl('lfo-bpm-slider');
        if (bpmSliderEl) {
            const ctrl = initSlider(bpmSliderEl, {
                format: v => Math.round(v),
                onChange: (val) => {
                    state.bpm = val;
                },
                onCommit: lfoSync,
            });
            if (ctrl) sliderControllers.set('lfo-bpm', ctrl);
        }

        for (let i = 0; i < 4; i++) {
            // Waveform dropdown
            const menu = getEl(`lfo-waveform-menu-${i}`);
            if (menu) {
                menu.querySelectorAll('.dropdown__item').forEach(item => {
                    item.addEventListener('click', () => {
                        if (state.lfos[i]) {
                            state.lfos[i].waveform = item.dataset.value;
                            menu.querySelectorAll('.dropdown__item').forEach(it => it.classList.remove('active'));
                            item.classList.add('active');
                            const btn = getEl(`lfo-waveform-${i}`);
                            if (btn) btn.querySelector('span').textContent = item.textContent;
                            lfoSync();
                        }
                    });
                });
            }

            // Rate slider
            const sliderEl = getEl(`lfo-rate-slider-${i}`);
            if (sliderEl) {
                const ctrl = initSlider(sliderEl, {
                    format: v => v.toFixed(1) + ' Hz',
                    onChange: (val) => {
                        if (state.lfos[i]) {
                            state.lfos[i].rate = val;
                        }
                    },
                    onCommit: lfoSync,
                });
                if (ctrl) sliderControllers.set(`lfo-rate-${i}`, ctrl);
            }

            // Expand button
            const expandBtn = getEl(`lfo-expand-${i}`);
            const advanced = getEl(`lfo-advanced-${i}`);
            if (expandBtn && advanced) {
                expandBtn.addEventListener('click', () => {
                    advanced.classList.toggle('hidden');
                    expandBtn.textContent = advanced.classList.contains('hidden') ? '+' : '\u2212';
                });
            }

            // Phase slider
            const phaseEl = getEl(`lfo-phase-slider-${i}`);
            if (phaseEl) {
                const ctrl = initSlider(phaseEl, {
                    format: v => v.toFixed(2),
                    onChange: (val) => {
                        if (state.lfos[i]) {
                            state.lfos[i].phaseOffset = val;
                        }
                    },
                    onCommit: lfoSync,
                });
                if (ctrl) sliderControllers.set(`lfo-phase-${i}`, ctrl);
            }

            // Amplitude slider
            const ampEl = getEl(`lfo-amp-slider-${i}`);
            if (ampEl) {
                const ctrl = initSlider(ampEl, {
                    format: v => v.toFixed(2),
                    onChange: (val) => {
                        if (state.lfos[i]) {
                            state.lfos[i].amplitude = val;
                        }
                    },
                    onCommit: lfoSync,
                });
                if (ctrl) sliderControllers.set(`lfo-amp-${i}`, ctrl);
            }

            // Offset slider
            const offsetEl = getEl(`lfo-offset-slider-${i}`);
            if (offsetEl) {
                const ctrl = initSlider(offsetEl, {
                    format: v => v.toFixed(2),
                    onChange: (val) => {
                        if (state.lfos[i]) {
                            state.lfos[i].dcOffset = val;
                        }
                    },
                    onCommit: lfoSync,
                });
                if (ctrl) sliderControllers.set(`lfo-offset-${i}`, ctrl);
            }

            // Sync toggle
            const syncToggle = getEl(`lfo-sync-toggle-${i}`);
            const rateSliderEl = getEl(`lfo-rate-slider-${i}`);
            const syncRateDropdown = document.querySelector(`[data-lfo-sync-rate="${i}"]`);
            if (syncToggle) {
                if (state.lfos[i] && state.lfos[i].syncMode === 'sync') {
                    syncToggle.classList.add('active');
                    if (syncRateDropdown) syncRateDropdown.classList.remove('hidden');
                    if (rateSliderEl) rateSliderEl.classList.add('disabled');
                } else {
                    if (syncRateDropdown) syncRateDropdown.classList.add('hidden');
                }
                syncToggle.addEventListener('click', () => {
                    if (state.lfos[i]) {
                        const isSync = state.lfos[i].syncMode === 'sync';
                        state.lfos[i].syncMode = isSync ? 'free' : 'sync';
                        syncToggle.classList.toggle('active', !isSync);
                        if (syncRateDropdown) syncRateDropdown.classList.toggle('hidden', isSync);
                        if (rateSliderEl) rateSliderEl.classList.toggle('disabled', !isSync);
                        lfoSync();
                    }
                });
            } else {
                if (syncRateDropdown) syncRateDropdown.classList.add('hidden');
            }

            // Sync rate dropdown
            const syncMenu = getEl(`lfo-sync-rate-menu-${i}`);
            if (syncMenu) {
                syncMenu.querySelectorAll('.dropdown__item').forEach(item => {
                    item.addEventListener('click', () => {
                        if (state.lfos[i]) {
                            state.lfos[i].syncRate = item.dataset.value;
                            syncMenu.querySelectorAll('.dropdown__item').forEach(it => it.classList.remove('active'));
                            item.classList.add('active');
                            const btn = getEl(`lfo-sync-rate-${i}`);
                            if (btn) btn.querySelector('span').textContent = item.textContent;
                            lfoSync();
                        }
                    });
                });
            }

            // Key sync toggle
            const keySyncToggle = getEl(`lfo-keysync-toggle-${i}`);
            if (keySyncToggle) {
                keySyncToggle.addEventListener('click', () => {
                    if (state.lfos[i]) {
                        state.lfos[i].keySync = !state.lfos[i].keySync;
                        keySyncToggle.classList.toggle('active', state.lfos[i].keySync);
                        lfoSync();
                    }
                });
            }
        }
    },

    destroy() {
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }
        sliderControllers.clear();
    }
};
