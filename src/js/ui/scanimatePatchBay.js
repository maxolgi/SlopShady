/**
 * Scanimate Patch Bay
 * Grid-style modulation matrix with Scanimate-specific destinations
 */

import { state, getEl } from '../state.js';
import { Sync } from '../features/sync.js';
import { initSlider } from './slider.js';
import { MODULATION_SOURCES, MODULATION_CURVES } from '../config.js';
import { T, escapeAttr } from './tooltips.js';
import { createDebouncedSync } from '../utils.js';

const SCANIMATE_SOURCES = [
    ...MODULATION_SOURCES,
    'osc0_raw', 'osc1_raw', 'osc2_raw', 'osc3_raw',
    'osc4_raw', 'osc5_raw', 'osc6_raw', 'osc7_raw',
];

const SCANIMATE_DESTINATIONS = [
    { value: 'u_deflectionX', label: 'Deflect X' },
    { value: 'u_deflectionY', label: 'Deflect Y' },
    { value: 'u_rotation', label: 'Rotation' },
    { value: 'u_barrel', label: 'Barrel' },
    { value: 'u_segmentShift', label: 'Seg Shift' },
    { value: 'u_colorCycle', label: 'Color Cycle' },
    { value: 'u_brightnessBoost', label: 'Brightness' },
    { value: 'u_scanlineIntensity', label: 'Scanline Int' },
    { value: 'u_glowAmount', label: 'Glow Amt' },
    { value: 'u_chromaticAmount', label: 'Chromatic' },
    { value: 'u_vignetteAmount', label: 'Vignette' },
    { value: 'u_feedbackAmount', label: 'Feedback Amt' },
    { value: 'osc0_freq', label: 'Osc1 Freq' },
    { value: 'osc1_freq', label: 'Osc2 Freq' },
    { value: 'osc2_freq', label: 'Osc3 Freq' },
    { value: 'osc3_freq', label: 'Osc4 Freq' },
    { value: 'osc4_freq', label: 'Osc5 Freq' },
    { value: 'osc5_freq', label: 'Osc6 Freq' },
    { value: 'osc6_freq', label: 'Osc7 Freq' },
    { value: 'osc7_freq', label: 'Osc8 Freq' },
    { value: 'osc0_amp', label: 'Osc1 Amp' },
    { value: 'osc1_amp', label: 'Osc2 Amp' },
    { value: 'osc2_amp', label: 'Osc3 Amp' },
    { value: 'osc3_amp', label: 'Osc4 Amp' },
    { value: 'osc4_amp', label: 'Osc5 Amp' },
    { value: 'osc5_amp', label: 'Osc6 Amp' },
    { value: 'osc6_amp', label: 'Osc7 Amp' },
    { value: 'osc7_amp', label: 'Osc8 Amp' },
];

const SOURCE_ABBREV = {
    note: 'Note', velocity: 'Vel', cc: 'CC', aftertouch: 'AT', pitchbend: 'PB',
    kbd: 'Kbd', eg0: 'EG0', eg1: 'EG1', eg2: 'EG2', eg3: 'EG3',
    lfo1: 'L1', lfo2: 'L2', lfo3: 'L3', lfo4: 'L4',
    audio_peak: 'PK', audio_band_low: 'Lo', audio_band_mid: 'Mid', audio_band_high: 'Hi',
    macro1: 'M1', macro2: 'M2', macro3: 'M3', macro4: 'M4',
    macro5: 'M5', macro6: 'M6', macro7: 'M7', macro8: 'M8',
    osc0_raw: 'O1', osc1_raw: 'O2', osc2_raw: 'O3', osc3_raw: 'O4',
    osc4_raw: 'O5', osc5_raw: 'O6', osc6_raw: 'O7', osc7_raw: 'O8',
};

const CURVE_OPTIONS = ['linear', 'exponential', 'logarithmic', 'sine', 'smooth'];

let _gridEditor = null;

const scheduleSync = createDebouncedSync(() => Sync.send({ scanimate: state.scanimate }));

function getMatrix() {
    if (!Array.isArray(state.scanimate.patchMatrix)) {
        state.scanimate.patchMatrix = [];
    }
    return state.scanimate.patchMatrix;
}

function findEntry(source, dest) {
    return getMatrix().find(e => e.source === source && e.destination === dest) || null;
}

function getNextId() {
    return Date.now() + Math.random();
}

export const ScanimatePatchBay = {
    container: null,
    _sliderApis: new Map(),

    init() {
        this.container = getEl('scanimate-patch-grid');
        if (!this.container) return;
        this._setupEventDelegation();
    },

    _setupEventDelegation() {
        this.container.addEventListener('click', (e) => {
            const cell = e.target.closest('[data-patch-cell]');
            if (cell) {
                _gridEditor = {
                    source: cell.dataset.source,
                    dest: cell.dataset.dest,
                };
                this.render();
                return;
            }

            const closeBtn = e.target.closest('[data-action="patch-close"]');
            if (closeBtn) {
                _gridEditor = null;
                this.render();
                return;
            }

            const toggleBtn = e.target.closest('[data-action="patch-toggle"]');
            if (toggleBtn && _gridEditor) {
                let entry = findEntry(_gridEditor.source, _gridEditor.dest);
                if (!entry) {
                    this.addEntry({ source: _gridEditor.source, destination: _gridEditor.dest, amount: 0, enabled: true });
                    entry = findEntry(_gridEditor.source, _gridEditor.dest);
                }
                if (entry) {
                    entry.enabled = !entry.enabled;
                    scheduleSync();
                }
                this.render();
                return;
            }

            const deleteBtn = e.target.closest('[data-action="patch-delete"]');
            if (deleteBtn && _gridEditor) {
                const entry = findEntry(_gridEditor.source, _gridEditor.dest);
                if (entry) this.removeEntry(String(entry.id));
                _gridEditor = null;
                this.render();
                return;
            }
        });

        this.container.addEventListener('dropdown-select', (e) => {
            const dropdown = e.target.closest('.dropdown');
            if (!dropdown || !_gridEditor) return;
            const field = dropdown.dataset.field;
            const value = e.detail.value;

            if (field === 'patch-curve') {
                let entry = findEntry(_gridEditor.source, _gridEditor.dest);
                if (!entry) {
                    this.addEntry({ source: _gridEditor.source, destination: _gridEditor.dest, amount: 0, curve: value, enabled: true });
                } else {
                    entry.curve = value;
                }
                scheduleSync();
                this.render();
            }
        });
    },

    addEntry(defaults = {}) {
        const matrix = getMatrix();
        matrix.push({
            id: getNextId(),
            source: 'cc',
            destination: '',
            amount: 1.0,
            curve: 'linear',
            enabled: true,
            ...defaults,
        });
        scheduleSync();
    },

    removeEntry(id) {
        const matrix = getMatrix();
        const idx = matrix.findIndex(e => String(e.id) === String(id));
        if (idx !== -1) {
            matrix.splice(idx, 1);
            scheduleSync();
        }
    },

    render() {
        if (!this.container) return;
        this._sliderApis.clear();

        const matrix = getMatrix();
        const srcCount = SCANIMATE_SOURCES.length;
        const srcLabels = SCANIMATE_SOURCES.map(s => SOURCE_ABBREV[s] || s);

        let html = `<div class="matrix-grid" style="--source-count:${srcCount}">`;
        html += '<div class="matrix-grid__corner"></div>';
        for (const sl of srcLabels) {
            html += `<div class="matrix-grid__col-header" title="${escapeAttr(sl)}">${escapeAttr(sl)}</div>`;
        }

        for (const d of SCANIMATE_DESTINATIONS) {
            html += `<div class="matrix-grid__row-header" title="${escapeAttr(d.label)}">${escapeAttr(d.label)}</div>`;
            for (let si = 0; si < srcCount; si++) {
                const src = SCANIMATE_SOURCES[si];
                const entry = matrix.find(e => e.source === src && e.destination === d.value);
                const active = entry && entry.enabled;
                const amt = entry ? Math.abs(Number.isFinite(entry.amount) ? entry.amount : 0) : 0;
                const amtText = entry ? entry.amount.toFixed(1) : '';
                const activeClass = active ? ' matrix-grid__cell--active' : '';
                const opacity = active ? Math.max(0.15, Math.min(1, amt)) : (entry ? 0.08 : 0);
                const bg = active
                    ? `background:rgba(74,170,136,${opacity.toFixed(2)})`
                    : (entry ? 'background:rgba(74,170,136,0.08)' : '');
                html += `<div class="matrix-grid__cell${activeClass}" data-patch-cell="1" data-source="${escapeAttr(src)}" data-dest="${escapeAttr(d.value)}" style="${bg}" title="${escapeAttr(SOURCE_ABBREV[src] || src)} \u2192 ${escapeAttr(d.label)}">${escapeAttr(amtText)}</div>`;
            }
        }
        html += '</div>';

        if (_gridEditor) {
            html += this._editorHtml();
        }

        this.container.innerHTML = html;
        this._initEditorSlider();
    },

    _editorHtml() {
        if (!_gridEditor) return '';
        const { source, dest } = _gridEditor;
        const entry = findEntry(source, dest);
        const amount = entry ? (Number.isFinite(entry.amount) ? entry.amount : 0) : 0;
        const enabled = entry ? entry.enabled : false;
        const curve = entry ? (entry.curve || 'linear') : 'linear';
        const destOpt = SCANIMATE_DESTINATIONS.find(d => d.value === dest);
        const destLabel = destOpt ? destOpt.label : dest;
        const srcLabel = SOURCE_ABBREV[source] || source;

        const curveItems = CURVE_OPTIONS.map(c =>
            `<div class="dropdown__item${c === curve ? ' active' : ''}" data-value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</div>`
        ).join('');

        return `
            <div class="matrix-grid-editor">
                <span class="matrix-grid-editor__label">${escapeAttr(srcLabel)} \u2192 ${escapeAttr(destLabel)}</span>
                <div class="slider" data-field="patch-amount" data-tooltip="${T.PATCH_AMOUNT}">
                    <div class="slider__header">
                        <span class="slider__label">Amt</span>
                        <span class="slider__value">${amount.toFixed(2)}</span>
                    </div>
                    <div class="slider__track">
                        <div class="slider__fill">
                            <div class="slider__handle"></div>
                        </div>
                    </div>
                </div>
                <div class="dropdown" data-field="patch-curve" data-tooltip="${T.PATCH_CURVE}">
                    <button class="dropdown__selected tool-btn"><span>${curve.charAt(0).toUpperCase() + curve.slice(1)}</span></button>
                    <div class="dropdown__menu">${curveItems}</div>
                </div>
                <button class="tool-btn ${enabled ? 'active' : ''}" data-action="patch-toggle" data-tooltip="${T.PATCH_TOGGLE}">${enabled ? 'On' : 'Off'}</button>
                ${entry ? '<button class="tool-btn" data-action="patch-delete" data-tooltip="' + T.PATCH_DELETE + '">Del</button>' : ''}
                <button class="tool-btn" data-action="patch-close" data-tooltip="${T.PATCH_CLOSE}">\u2715</button>
            </div>
        `;
    },

    _initEditorSlider() {
        const sliderEl = this.container.querySelector('[data-field="patch-amount"]');
        if (!sliderEl || !_gridEditor) return;

        const { source, dest } = _gridEditor;
        let entry = findEntry(source, dest);
        const initial = entry ? (Number.isFinite(entry.amount) ? entry.amount : 0) : 0;

        const api = initSlider(sliderEl, {
            min: -1, max: 1, step: 0.01, defaultValue: 0,
            format: v => v.toFixed(2),
            onChange: (val) => {
                if (!entry) {
                    this.addEntry({ source, destination: dest, amount: val, enabled: true });
                    entry = findEntry(source, dest);
                } else {
                    entry.amount = val;
                }
            },
            onCommit: () => {
                scheduleSync();
                this.render();
            },
        });
        if (api) {
            api.setValue(initial);
            this._sliderApis.set('patch-amount', api);
        }
    },

    applyState(data) {
        if (!data?.scanimate?.patchMatrix) return;
        state.scanimate.patchMatrix = data.scanimate.patchMatrix;
        this.render();
    },
};
