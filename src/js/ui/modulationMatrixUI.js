/**
 * Modulation Matrix UI
 * Grid view with detail panel for editing source→dest routings.
 */

import { state, getEl } from '../state.js';
import { LayerSystem } from '../webgl/layers.js';
import { Sync } from '../features/sync.js';
import { initSlider } from './slider.js';
import { escapeHtml, createDebouncedSync } from '../utils.js';
import { T, escapeAttr } from './tooltips.js';
import { MODULATION_SOURCES, DEFAULT_MODULATION_ENTRY, DEFAULT_OSC_ADDRESSES, MAX_VOICES } from '../config.js';
import { MidiLearn } from '../features/midi.js';
import { OscLearn } from '../features/osc.js';

const scheduleSync = createDebouncedSync(() => Sync.send(LayerSystem.getState()));

const CURVE_OPTIONS = [
    { value: 'linear', label: 'Linear' },
    { value: 'exp', label: 'Exp' },
    { value: 'log', label: 'Log' }
];

const UNIFORM_TO_LAYER_PROP = {
    'u_opacity': 'opacity', 'u_brightness': 'brightness', 'u_speed': 'speed',
    'u_posX': 'posX', 'u_posY': 'posY', 'u_scale': 'scale', 'u_radius': 'radius',
    'u_amount': 'amount', 'u_rotation': 'rotation', 'u_stretch': 'stretch',
    'u_maskPosX': 'maskPosX', 'u_maskPosY': 'maskPosY', 'u_maskSoftness': 'maskSoftness',
};

const SOURCE_ABBREV = {
    note: 'Note', velocity: 'Vel', cc: 'CC', osc: 'OSC', aftertouch: 'AT', pitchbend: 'PB',
    kbd: 'Kbd', eg0: 'EG0', eg1: 'EG1', eg2: 'EG2', eg3: 'EG3',
    lfo1: 'L1', lfo2: 'L2', lfo3: 'L3', lfo4: 'L4',
    audio_peak: 'PK', audio_band_low: 'Lo', audio_band_mid: 'Mid', audio_band_high: 'Hi',
    macro1: 'M1', macro2: 'M2', macro3: 'M3', macro4: 'M4',
    macro5: 'M5', macro6: 'M6', macro7: 'M7', macro8: 'M8',
};

function _getBaseValue(dest, layer) {
    const prop = UNIFORM_TO_LAYER_PROP[dest];
    if (prop && layer) {
        const v = layer[prop];
        return Number.isFinite(v) ? v : null;
    }
    return null;
}

function _getSourceLabel(src) {
    return SOURCE_ABBREV[src] || src;
}

function _buildSourceConfig(source, dest) {
    if (source === 'osc') {
        return { address: DEFAULT_OSC_ADDRESSES[dest] || '/ch/1' };
    }
    return {};
}

export const modulationMatrixUI = {
    _sliderApis: new Map(),
    _gridEditor: null,

    init() {
        this.gridContainer = getEl('modulation-grid-rows');
        this.setupEventDelegation();
        document.addEventListener('layer-select', () => this.render());
        this.render();
    },

    setupEventDelegation() {
        const clickHandler = (e) => {
            const learnBtn = e.target.closest('[data-action="learn-cc"]');
            if (learnBtn) {
                const detail = learnBtn.closest('.matrix-grid-detail');
                if (!detail) return;
                const entry = this._getOrCreateEntryFromDetail(detail);
                if (!entry) return;
                document.querySelectorAll('[data-action="learn-cc"]').forEach(b => {
                    b.textContent = 'Learn';
                    b.classList.remove('active');
                });
                if (entry.source === 'osc') {
                    OscLearn.start((address) => {
                        entry.sourceConfig = entry.sourceConfig || {};
                        entry.sourceConfig.address = address;
                        this.render();
                        scheduleSync();
                    });
                } else {
                    MidiLearn.start((cc) => {
                        entry.source = 'cc';
                        entry.sourceConfig = entry.sourceConfig || {};
                        entry.sourceConfig.cc = cc;
                        this.render();
                        scheduleSync();
                    });
                }
                learnBtn.textContent = 'Learning...';
                learnBtn.classList.add('active');
                return;
            }

            const enabledBtn = e.target.closest('[data-action="toggle-enabled"]');
            if (enabledBtn) {
                const detail = enabledBtn.closest('.matrix-grid-detail');
                if (!detail) return;
                const entry = this._getOrCreateEntryFromDetail(detail);
                if (!entry) return;
                const enabled = !enabledBtn.classList.contains('active');
                entry.enabled = enabled;
                this._mirrorToLayer();
                scheduleSync();
                this.render();
                return;
            }

            const gridCell = e.target.closest('[data-grid-cell="1"]');
            if (gridCell) {
                if (this._gridEditor
                    && this._gridEditor.source === gridCell.dataset.source
                    && this._gridEditor.dest === gridCell.dataset.dest) {
                    this._gridEditor = null;
                } else {
                    this._gridEditor = {
                        source: gridCell.dataset.source,
                        dest: gridCell.dataset.dest,
                    };
                }
                this.render();
                return;
            }
        };

        const changeHandler = (e) => {
            const ccInput = e.target.closest('[data-field="cc"]');
            if (ccInput) {
                const detail = ccInput.closest('.matrix-grid-detail');
                if (!detail) return;
                const entry = this._getOrCreateEntryFromDetail(detail);
                if (!entry) return;
                const val = parseInt(ccInput.value, 10);
                if (!isNaN(val) && val >= 0 && val <= 127) {
                    entry.sourceConfig = entry.sourceConfig || {};
                    entry.sourceConfig.cc = val;
                    this._mirrorToLayer();
                    scheduleSync();
                }
                return;
            }

            const oscInput = e.target.closest('[data-field="osc-address"]');
            if (oscInput) {
                const detail = oscInput.closest('.matrix-grid-detail');
                if (!detail) return;
                const entry = this._getOrCreateEntryFromDetail(detail);
                if (!entry) return;
                const addr = oscInput.value.trim();
                if (addr) {
                    entry.sourceConfig = entry.sourceConfig || {};
                    entry.sourceConfig.address = addr;
                    this._mirrorToLayer();
                    scheduleSync();
                }
            }
        };

        const dropdownHandler = (e) => {
            const dropdown = e.target.closest('.dropdown');
            if (!dropdown) return;
            const detail = dropdown.closest('.matrix-grid-detail');
            if (!detail) return;
            const entry = this._getOrCreateEntryFromDetail(detail);
            if (!entry) return;

            const field = dropdown.dataset.field;
            if (field === 'curve') {
                entry.curve = e.detail.value;
                this._mirrorToLayer();
                scheduleSync();
                this.render();
                return;
            }
        };

        this.gridContainer.addEventListener('click', clickHandler);
        this.gridContainer.addEventListener('change', changeHandler);
        this.gridContainer.addEventListener('dropdown-select', dropdownHandler);
    },

    _getOrCreateEntryFromDetail(detail) {
        const entryId = detail.dataset.entryId;
        if (entryId) return this._getEntry(entryId);

        const { source, dest } = this._gridEditor || {};
        if (!source || !dest) return null;

        let entry = this._findEntry(source, dest);
        if (!entry) {
            const matrix = this._getMatrix();
            const id = Date.now() + Math.random();
            entry = {
                ...DEFAULT_MODULATION_ENTRY,
                source,
                destination: dest,
                sourceConfig: _buildSourceConfig(source, dest),
                id,
            };
            matrix.push(entry);
            this._mirrorToLayer();
        }
        return entry;
    },

    _getEntry(entryId) {
        const matrix = this._getMatrix();
        return matrix.find(e => String(e.id) === String(entryId));
    },

    _getMatrix() {
        const layerIndex = state.selectedLayer;
        let matrix = state.layerModulationMatrices[layerIndex];
        if (!Array.isArray(matrix)) {
            matrix = [];
            state.layerModulationMatrices[layerIndex] = matrix;
        }
        return matrix;
    },

    _mirrorToLayer() {
        const layer = LayerSystem.layers[state.selectedLayer];
        if (layer) {
            layer.modulationMatrix = this._getMatrix();
        }
    },

    _findEntry(source, dest) {
        const matrix = this._getMatrix();
        return matrix.find(e => e.source === source && e.destination === dest) || null;
    },

    getUniformOptions(layerIndex) {
        const layer = LayerSystem.layers[layerIndex];
        const options = [];
        const extras = [
            { value: 'u_opacity', label: 'Alpha' },
            { value: 'u_brightness', label: 'Brightness' },
            { value: 'u_speed', label: 'Speed' },
            { value: 'u_posX', label: 'Position X' },
            { value: 'u_posY', label: 'Position Y' },
            { value: 'u_scale', label: 'Scale' },
            { value: 'u_radius', label: 'Radius' },
            { value: 'u_amount', label: 'Amount' },
            { value: 'u_rotation', label: 'Rotation' },
            { value: 'u_stretch', label: 'Stretch' },
            { value: 'u_maskPosX', label: 'Mask Pos X' },
            { value: 'u_maskPosY', label: 'Mask Pos Y' },
            { value: 'u_maskSoftness', label: 'Mask Softness' },
        ];
        const voiceExtras = [
            { value: 'u_voicePosX', label: 'Voice Pos X (All)' },
            { value: 'u_voicePosY', label: 'Voice Pos Y (All)' },
            { value: 'u_voiceScale', label: 'Voice Scale (All)' },
            { value: 'u_voiceRotation', label: 'Voice Rotation (All)' },
        ];
        const modDests = new Set();
        if (layer && layer.modulationMatrix) {
            for (const entry of layer.modulationMatrix) {
                if (entry.destination) modDests.add(entry.destination);
            }
        }
        for (let v = 0; v < MAX_VOICES; v++) {
            voiceExtras.push(
                { value: `u_voicePosX[${v}]`, label: `Voice ${v + 1} Pos X`, gated: true },
                { value: `u_voicePosY[${v}]`, label: `Voice ${v + 1} Pos Y`, gated: true },
                { value: `u_voiceScale[${v}]`, label: `Voice ${v + 1} Scale`, gated: true },
                { value: `u_voiceRotation[${v}]`, label: `Voice ${v + 1} Rotation`, gated: true },
            );
        }
        for (const e of extras) {
            if (!options.some(o => o.value === e.value)) {
                options.push(e);
            }
        }
        if (layer && layer.modulationMatrix) {
            for (const entry of layer.modulationMatrix) {
                const dest = entry.destination;
                if (dest && !options.some(o => o.value === dest)) {
                    options.push({ value: dest, label: dest.replace(/^u_param_/, '') });
                }
            }
        }
        for (const e of voiceExtras) {
            if (e.gated && !modDests.has(e.value)) continue;
            if (!options.some(o => o.value === e.value)) {
                options.push(e);
            }
        }
        return options;
    },

    render() {
        this._sliderApis.clear();
        this._renderGridView();
    },

    _renderGridView() {
        const matrix = this._getMatrix();
        const srcCount = MODULATION_SOURCES.length;
        const srcLabels = MODULATION_SOURCES.map(s => _getSourceLabel(s));
        const dests = this.getUniformOptions(state.selectedLayer);

        let gridHtml = `<div class="matrix-grid" style="--source-count:${srcCount}">`;
        gridHtml += `<div class="matrix-grid__corner"></div>`;
        for (const sl of srcLabels) {
            gridHtml += `<div class="matrix-grid__col-header" title="${escapeHtml(sl)}">${escapeHtml(sl)}</div>`;
        }

        for (const d of dests) {
            gridHtml += `<div class="matrix-grid__row-header" title="${escapeHtml(d.label)}">${escapeHtml(d.label)}</div>`;
            for (let si = 0; si < srcCount; si++) {
                const src = MODULATION_SOURCES[si];
                const entry = matrix.find(e => e.source === src && e.destination === d.value);
                const active = entry && entry.enabled;
                const amt = entry ? Math.abs(Number.isFinite(entry.amount) ? entry.amount : 0) : 0;
                const amtText = entry ? entry.amount.toFixed(1) : '';
                const activeClass = active ? ' matrix-grid__cell--active' : '';
                const selectedClass = (this._gridEditor && this._gridEditor.source === src && this._gridEditor.dest === d.value) ? ' matrix-grid__cell--selected' : '';
                const opacity = active ? Math.max(0.15, Math.min(0.5, amt * 0.5)) : (entry ? 0.08 : 0);
                const bg = active
                    ? `background:rgba(74,170,136,${opacity.toFixed(2)})`
                    : (entry ? `background:rgba(74,170,136,0.08)` : '');
                gridHtml += `<div class="matrix-grid__cell${activeClass}${selectedClass}" data-grid-cell="1" data-source="${escapeHtml(src)}" data-dest="${escapeHtml(d.value)}" style="${bg}" title="${escapeHtml(src)} \u2192 ${escapeHtml(d.label)}">${escapeHtml(amtText)}</div>`;
            }
        }
        gridHtml += '</div>';

        const detailHtml = this._gridEditor ? this._gridDetailHtml() : '';
        this.gridContainer.innerHTML = `<div class="matrix-grid-layout">${gridHtml}${detailHtml}</div>`;
        this._initAllSliders();
    },

    _gridDetailHtml() {
        if (!this._gridEditor) return '';
        const { source, dest } = this._gridEditor;
        const layer = LayerSystem.layers[state.selectedLayer];
        const entry = this._findEntry(source, dest);

        const allDests = this.getUniformOptions(state.selectedLayer);
        const destOpt = allDests.find(d => d.value === dest);
        const label = escapeHtml(destOpt ? destOpt.label : dest);

        const baseVal = _getBaseValue(dest, layer);
        const baseStr = baseVal !== null ? baseVal.toFixed(2) : '\u2014';
        let totalOffset = 0;
        if (entry && entry.enabled && Number.isFinite(entry._lastOutputValue)) {
            totalOffset = entry._lastOutputValue;
        }
        const modStr = baseVal !== null
            ? (baseVal + totalOffset).toFixed(2)
            : (totalOffset !== 0 ? totalOffset.toFixed(2) : '\u2014');

        const currentSource = entry ? entry.source : source;
        const sourceLabel = escapeHtml(_getSourceLabel(currentSource));

        const curve = entry ? (entry.curve || 'linear') : 'linear';
        const curveItems = CURVE_OPTIONS.map(o => {
            const sel = o.value === curve ? ' active' : '';
            return `<div class="dropdown__item${sel}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</div>`;
        }).join('');
        const curveLabel = CURVE_OPTIONS.find(o => o.value === curve)?.label || curve;

        const amount = entry ? (Number.isFinite(entry.amount) ? entry.amount : 1.0) : 1.0;
        const ccVal = (currentSource === 'cc' && entry && Number.isFinite(entry.sourceConfig?.cc))
            ? Math.max(0, Math.min(127, Math.floor(entry.sourceConfig.cc)))
            : 1;
        const ccDisabled = currentSource !== 'cc';
        const oscVal = (currentSource === 'osc' && entry && entry.sourceConfig?.address)
            ? entry.sourceConfig.address
            : (DEFAULT_OSC_ADDRESSES[dest] || '/ch/1');
        const oscDisabled = currentSource !== 'osc';
        const enabled = entry ? entry.enabled : false;

        const idAttr = entry
            ? `data-entry-id="${escapeAttr(String(entry.id))}"`
            : '';

        return `
            <div class="matrix-grid-detail" ${idAttr}>
                <span class="content-title">${sourceLabel} \u2192 ${label}</span>
                <span class="content-label">Base: ${escapeHtml(baseStr)}  Mod: ${escapeHtml(modStr)}</span>
                <div class="mod-matrix-viz">
                    <div class="mod-matrix-viz__bar mod-matrix-viz__bar--source" style="--viz-width:0%"></div>
                    <div class="mod-matrix-viz__bar mod-matrix-viz__bar--output" style="--viz-width:0%"></div>
                </div>
                ${!ccDisabled ? `
                <span class="content-label">CC#</span>
                <input type="number" min="0" max="127" value="${escapeHtml(String(ccVal))}" data-field="cc" data-tooltip="${T.MOD_CC}">
                ` : ''}
                ${!oscDisabled ? `
                <span class="content-label">OSC</span>
                <input type="text" value="${escapeHtml(oscVal)}" data-field="osc-address" data-tooltip="${T.MOD_OSC}">
                ` : ''}
                <div class="slider" data-field="amount" data-tooltip="${T.MOD_AMOUNT}">
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
                <div class="dropdown" data-field="curve" data-tooltip="${T.MOD_CURVE}">
                    <button class="dropdown__selected tool-btn"><span>${escapeHtml(curveLabel)}</span></button>
                    <div class="dropdown__menu">${curveItems}</div>
                </div>
                <div class="tool-grid tool-grid--2x1">
                    <button class="tool-btn" data-action="learn-cc" data-tooltip="${T.MOD_LEARN}">Learn</button>
                    <button class="tool-btn ${enabled ? 'active' : ''}" data-action="toggle-enabled" data-tooltip="${T.MOD_ENABLE}">Enable</button>
                </div>
            </div>
        `;
    },

    _initAllSliders() {
        this.gridContainer.querySelectorAll('.slider').forEach(sliderEl => {
            const field = sliderEl.dataset.field;
            if (field !== 'amount') return;

            const detail = sliderEl.closest('.matrix-grid-detail');
            if (!detail) return;
            const entryId = detail.dataset.entryId;

            if (entryId) {
                const entry = this._getEntry(entryId);
                if (!entry) return;
                const initial = Number.isFinite(entry.amount) ? entry.amount : 1.0;
                const api = initSlider(sliderEl, {
                    min: -1, max: 1, step: 0.01, defaultValue: 1.0,
                    format: v => v.toFixed(2),
                    onChange: (val) => {
                        entry.amount = val;
                        this._mirrorToLayer();
                        this._updateCell(entry.source, entry.destination);
                    },
                    onCommit: scheduleSync,
                });
                if (api) {
                    api.setValue(initial);
                    this._sliderApis.set(`${entryId}-amount`, api);
                }
                return;
            }

            if (!this._gridEditor) return;
            const { source, dest } = this._gridEditor;
            const api = initSlider(sliderEl, {
                min: -1, max: 1, step: 0.01, defaultValue: 1.0,
                format: v => v.toFixed(2),
                onChange: (val) => {
                    let entry = this._findEntry(source, dest);
                    if (!entry) {
                        const matrix = this._getMatrix();
                        const id = Date.now() + Math.random();
                        entry = {
                            ...DEFAULT_MODULATION_ENTRY,
                            source,
                            destination: dest,
                            sourceConfig: _buildSourceConfig(source, dest),
                            amount: val,
                            id,
                        };
                        matrix.push(entry);
                        this._mirrorToLayer();
                    }
                    entry.amount = val;
                    this._mirrorToLayer();
                    this._updateCell(source, dest);
                },
                onCommit: () => {
                    scheduleSync();
                    this.render();
                },
            });
            if (api) {
                api.setValue(1.0);
                this._sliderApis.set(`phantom-${source}-${dest}-amount`, api);
            }
        });
    },

    applyState(data) {
        if (!data) return;
        let needsRender = false;

        if (data.layers && Array.isArray(data.layers)) {
            for (let i = 0; i < data.layers.length; i++) {
                if (data.layers[i].modulationMatrix !== undefined) {
                    state.layerModulationMatrices[i] = data.layers[i].modulationMatrix || [];
                    const layer = LayerSystem.layers[i];
                    if (layer) layer.modulationMatrix = state.layerModulationMatrices[i];
                    needsRender = true;
                }
            }
        }

        if (data.layerModulationMatrices && Array.isArray(data.layerModulationMatrices)) {
            for (let i = 0; i < data.layerModulationMatrices.length; i++) {
                state.layerModulationMatrices[i] = data.layerModulationMatrices[i] || [];
                const layer = LayerSystem.layers[i];
                if (layer) layer.modulationMatrix = state.layerModulationMatrices[i];
            }
            needsRender = true;
        }

        if (needsRender) this.render();
    },

    updateVisualizer() {
        const rows = this.gridContainer.querySelectorAll('.matrix-grid-detail');
        for (const row of rows) {
            const entryId = row.dataset.entryId;
            if (!entryId) continue;
            const entry = this._getEntry(entryId);
            if (!entry) continue;

            const sourceBar = row.querySelector('.mod-matrix-viz__bar--source');
            const outputBar = row.querySelector('.mod-matrix-viz__bar--output');
            if (!sourceBar || !outputBar) continue;

            let sv, ov;
            if (entry.enabled) {
                sv = entry._lastSourceValue ?? 0;
                ov = entry._lastOutputValue ?? 0;
                entry._lastVizSource = sv;
                entry._lastVizOutput = ov;
            } else {
                sv = entry._lastVizSource ?? 0;
                ov = entry._lastVizOutput ?? 0;
            }

            sourceBar.style.setProperty('--viz-width', (Math.max(0, Math.min(1, sv)) * 100) + '%');
            outputBar.style.setProperty('--viz-width', (Math.max(0, Math.min(1, (ov + 1) / 2)) * 100) + '%');
        }
    },

    _updateCell(source, dest) {
        const cell = this.gridContainer.querySelector(`[data-grid-cell="1"][data-source="${CSS.escape(source)}"][data-dest="${CSS.escape(dest)}"]`);
        if (!cell) return;
        const entry = this._findEntry(source, dest);
        const active = entry && entry.enabled;
        const amt = entry ? Math.abs(Number.isFinite(entry.amount) ? entry.amount : 0) : 0;
        cell.textContent = entry ? entry.amount.toFixed(1) : '';
        const opacity = active ? Math.max(0.15, Math.min(0.5, amt * 0.5)) : (entry ? 0.08 : 0);
        cell.style.background = active
            ? `rgba(74,170,136,${opacity.toFixed(2)})`
            : (entry ? `rgba(74,170,136,0.08)` : '');
        cell.classList.toggle('matrix-grid__cell--active', !!active);
    },
};
