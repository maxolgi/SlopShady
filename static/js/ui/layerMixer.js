/**
 * Layer Mixer Module
 * UI for managing multi-layer shader system
 */

import { state, getEl } from '../state.js';
import { BLEND_MODE_OPTIONS } from '../config.js';
import { LayerSystem } from '../webgl/layers.js';
import { Sync } from '../features/sync.js';
import { escapeHtml } from '../utils.js';
import { MilkdropFeature } from '../features/milkdrop.js';
import { CodeDials } from './codeDials.js';
import { ContentBrowser } from './contentBrowser.js';
import { AudioTexture } from '../features/audio.js';
import { initSlider, getSliderController } from './slider.js';
import { ti, escapeAttr } from './tooltips.js';

const TYPE_OPTIONS = [
    { value: 'shader', label: 'Shader' },
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' },
    { value: 'webcam', label: 'Webcam' },
    { value: 'screen', label: 'Screen' },
    { value: 'text', label: 'Text' },
    { value: 'visualizer', label: 'Visualizer' },
    { value: 'milkdrop', label: 'Milkdrop' },
    { value: 'scanimate', label: 'Scanimate' },
];

const BLEND_OPTIONS = [
    { value: 'normal', label: 'Normal' },
    { value: 'add', label: 'Add' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'lighten', label: 'Lighten' },
    { value: 'darken', label: 'Darken' },
    { value: 'subtract', label: 'Subtract' },
    { value: 'difference', label: 'Difference' },
];

const sliderControllers = new Map();

const FB_BLEND_OPTIONS = [
    { value: '0', label: 'Mix' },
    { value: '1', label: 'Add' },
    { value: '2', label: 'Mul' },
    { value: '3', label: 'Scr' },
    { value: '4', label: 'Ovr' },
    { value: '5', label: 'Lgt' },
    { value: '6', label: 'Drk' },
    { value: '7', label: 'Sub' },
    { value: '8', label: 'Dif' },
];

const FB_SLIDERS = [
    { param: 'feedbackAmount', label: 'Amt', min: 0, max: 1, def: 0.5, fill: 50, tip: 'LAYER_FB_AMOUNT' },
    { param: 'feedbackDecay', label: 'Dcy', min: 0, max: 1, def: 0.9, fill: 90, tip: 'LAYER_FB_DECAY' },
    { param: 'feedbackZoom', label: 'Zm', min: 0.5, max: 2, def: 1.0, fill: 25, tip: 'LAYER_FB_ZOOM' },
    { param: 'feedbackRotate', label: 'Rot', min: -3.14, max: 3.14, def: 0, fill: 50, tip: 'LAYER_FB_ROTATE' },
    { param: 'feedbackOffsetX', label: 'OX', min: -0.5, max: 0.5, def: 0, fill: 50, tip: 'LAYER_FB_OX' },
    { param: 'feedbackOffsetY', label: 'OY', min: -0.5, max: 0.5, def: 0, fill: 50, tip: 'LAYER_FB_OY' },
    { param: 'feedbackSaturation', label: 'Sat', min: 0, max: 3, def: 1.0, fill: 33, tip: 'LAYER_FB_SAT' },
    { param: 'feedbackBrightness', label: 'Brt', min: 0, max: 3, def: 1.0, fill: 33, tip: 'LAYER_FB_BRT' },
];

const CONTROLS_SLIDERS = [
    { param: 'brightness', label: 'Brt', min: 0, max: 3, def: 1.0, tip: 'LAYER_BRIGHTNESS' },
    { param: 'speed', label: 'Spd', min: 0, max: 5, def: 1.0, tip: 'LAYER_SPEED' },
    { param: 'posX', label: 'P.X', min: -1, max: 1, def: 0.0, tip: 'LAYER_POS_X' },
    { param: 'posY', label: 'P.Y', min: -1, max: 1, def: 0.0, tip: 'LAYER_POS_Y' },
    { param: 'scale', label: 'Scl', min: 0.1, max: 5, def: 1.0, tip: 'LAYER_SCALE' },
    { param: 'amount', label: 'Amt', min: 0, max: 3, def: 1.0, tip: 'LAYER_AMOUNT' },
    { param: 'rotation', label: 'Rot', min: -3.14, max: 3.14, def: 0.0, tip: 'LAYER_ROTATION' },
    { param: 'stretch', label: 'Str', min: -2, max: 2, def: 0.0, tip: 'LAYER_STRETCH' },
];

const MASK_SLIDERS = [
    { param: 'radius', label: 'Rad', min: 0, max: 2, def: 0.5, tip: 'LAYER_RADIUS' },
    { param: 'maskPosX', label: 'M.X', min: -1, max: 1, def: 0.0, tip: 'LAYER_MASK_X' },
    { param: 'maskPosY', label: 'M.Y', min: -1, max: 1, def: 0.0, tip: 'LAYER_MASK_Y' },
    { param: 'maskSoftness', label: 'Sft', min: 0, max: 1, def: 0.01, tip: 'LAYER_SOFTNESS' },
];

const LAYER_PARAM_SLIDERS = [...CONTROLS_SLIDERS, ...MASK_SLIDERS];

function dropdownHtml(btnId, menuId, options, selected, tooltip) {
    const items = options.map(o => {
        const sel = o.value === selected ? ' active' : '';
        return `<div class="dropdown__item${sel}" data-value="${o.value}">${o.label}</div>`;
    }).join('');
    const selLabel = (options.find(o => o.value === selected) || options[0]).label;
    const tt = tooltip ? ` data-tooltip="${escapeAttr(tooltip)}"` : '';
    return `<div class="dropdown">
        <button class="dropdown__selected tool-btn" id="${btnId}"${tt}>
            <span>${selLabel}</span>
        </button>
        <div class="dropdown__menu" id="${menuId}">${items}</div>
    </div>`;
}

function slidersHtml(sliders, channelIdx) {
    const n = channelIdx + 1;
    return sliders.map(s => {
        const fillPct = Math.round(((s.def - s.min) / (s.max - s.min)) * 100);
        const tt = s.tip ? ` data-tooltip="${escapeAttr(ti(s.tip, {n}))}"` : '';
        return `<div class="slider" id="mix-${s.param}-slider-${channelIdx}" data-min="${s.min}" data-max="${s.max}" data-step="0.01"${tt}>
        <div class="slider__header">
            <span class="slider__label">${s.label}</span>
            <span class="slider__value" id="mix-${s.param}-value-${channelIdx}">${s.def.toFixed(2)}</span>
        </div>
        <div class="slider__track">
            <div class="slider__fill slider__fill--modulated"></div>
            <div class="slider__fill" data-fill="${fillPct}">
                <div class="slider__handle"></div>
            </div>
        </div>
    </div>`;
    }).join('');
}

export const LayerMixer = {
    generateChannels() {
        const container = getEl('mix-channels-container');
        if (!container) return;

        let html = '';
        for (let i = 0; i < 8; i++) {
            const first = i === 0;
            const opacityDisplay = first ? '100%' : '0%';
            const opacityFill = first ? ' data-fill="100"' : '';

            const n = i + 1;
            html += `<div class="panel-section mix-channel" data-expand-hide>
                <span class="content-title">${n}</span>
                <div class="mix-mix-controls">
                    ${dropdownHtml(`mix-type-dropdown-${i}`, `mix-type-menu-${i}`, TYPE_OPTIONS, 'shader', ti('LAYER_TYPE', {n}))}
                    ${dropdownHtml(`mix-shader-dropdown-${i}`, `mix-shader-menu-${i}`, [{ value: 'none', label: '--' }], 'none', ti('LAYER_SHADER', {n}))}
                    ${dropdownHtml(`mix-blend-dropdown-${i}`, `mix-blend-menu-${i}`, BLEND_OPTIONS, 'normal', ti('LAYER_BLEND', {n}))}
                    <div class="tool-grid tool-grid--2x2">
                        <button class="tool-btn" id="mix-solo-${i}" data-tooltip="${escapeAttr(ti('LAYER_SOLO', {n}))}">Solo</button>
                        <button class="tool-btn" id="mix-mute-${i}" data-tooltip="${escapeAttr(ti('LAYER_MUTE', {n}))}">Mute</button>
                    </div>
                    <button class="tool-btn" id="mix-brain-${i}" data-tooltip="${escapeAttr(ti('MIX_BRAIN_TOGGLE', {n}))}">Brain</button>
                    <div class="slider" id="mix-opacity-slider-${i}" data-tooltip="${escapeAttr(ti('LAYER_OPACITY', {n}))}">
                        <div class="slider__header">
                            <span class="slider__label">Opacity</span>
                            <span class="slider__value" id="mix-opacity-value-${i}">${opacityDisplay}</span>
                        </div>
                        <div class="slider__track">
                            <div class="slider__fill slider__fill--modulated"></div>
                            <div class="slider__fill"${opacityFill}>
                                <div class="slider__handle"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="mix-controls-panel-${i}" class="mix-controls-panel">
                    ${slidersHtml(CONTROLS_SLIDERS, i)}
                </div>
                <div id="mix-mask-panel-${i}" class="mix-mask-panel">
                    ${slidersHtml(MASK_SLIDERS, i)}
                </div>
                <div id="mix-edit-source-container-${i}" class="mix-edit-controls"></div>
            </div>`;
        }

        container.insertAdjacentHTML('beforebegin', html);
        container.remove();

        this._generateFeedbackColumns();
    },

    _generateFeedbackColumns() {
        const feedbackPanel = document.querySelector('[data-panel="effects"]');
        if (!feedbackPanel) return;

        let html = '';
        for (let i = 0; i < 8; i++) {
            const n = i + 1;
            html += `<div class="panel-section" id="mix-feedback-controls-${i}" data-expand-hide>
                <button class="tool-btn" id="mix-feedback-enabled-${i}" data-tooltip="${escapeAttr(ti('LAYER_FB_ENABLED', {n}))}">${n}</button>
                ${dropdownHtml(`mix-feedback-blend-dropdown-${i}`, `mix-feedback-blend-menu-${i}`, FB_BLEND_OPTIONS, '0', ti('LAYER_FB_BLEND', {n}))}
                ${FB_SLIDERS.map(s => `<div class="slider" data-min="${s.min}" data-max="${s.max}" data-step="0.01" data-param="${s.param}" data-tooltip="${escapeAttr(ti(s.tip, {n}))}">
                    <div class="slider__header">
                        <span class="slider__label">${s.label}</span>
                        <span class="slider__value">${s.def.toFixed(2)}</span>
                    </div>
                    <div class="slider__track">
                        <div class="slider__fill" data-fill="${s.fill}">
                            <div class="slider__handle"></div>
                        </div>
                    </div>
                </div>`).join('')}
            </div>`;
        }

        feedbackPanel.insertAdjacentHTML('beforeend', html);
    },

    init() {
        // Wire up bottom panel mix controls
        const mixPanelSections = document.querySelectorAll('.content-panel[data-panel="mix"] > .panel-section[data-expand-hide]');
        for (let i = 0; i < 8; i++) {
            const idx = i;
            
            // Type dropdown
            const typeMenu = getEl(`mix-type-menu-${i}`);
            if (typeMenu) {
                typeMenu.querySelectorAll('.dropdown__item').forEach(item => {
                    item.addEventListener('mousedown', () => {
                        this.onLayerMaterialTypeChange(idx, item.dataset.value);
                    });
                    item.addEventListener('dropdown-select', () => {
                        this.onLayerMaterialTypeChange(idx, item.dataset.value);
                    });
                });
            }
            
            // Blend dropdown
            const blendMenu = getEl(`mix-blend-menu-${i}`);
            if (blendMenu) {
                blendMenu.querySelectorAll('.dropdown__item').forEach(item => {
                    item.addEventListener('mousedown', () => {
                        this.setBlendMode(idx, item.dataset.value);
                    });
                    item.addEventListener('dropdown-select', () => {
                        this.setBlendMode(idx, item.dataset.value);
                    });
                });
            }
            
            // Solo/Mute/Brain
            const soloBtn = getEl(`mix-solo-${i}`);
            if (soloBtn) {
                soloBtn.addEventListener('click', () => this.toggleSolo(idx));
            }
            const muteBtn = getEl(`mix-mute-${i}`);
            if (muteBtn) {
                muteBtn.addEventListener('click', () => this.toggleMute(idx));
            }
            const brainBtn = getEl(`mix-brain-${i}`);
            if (brainBtn) {
                brainBtn.addEventListener('click', () => this.toggleBrain(idx));
            }
            
            // Opacity slider
            const slider = getEl(`mix-opacity-slider-${i}`);
            if (slider) {
                const ctrl = initSlider(slider, {
                    min: 0, max: 1, step: 0.01, defaultValue: i === 0 ? 1 : 0,
                    format: v => Math.round(v * 100) + '%',
                    onChange: (val) => { this.setLayerOpacity(idx, val); },
                });
                if (ctrl) sliderControllers.set(slider, ctrl);
            }
            
            // Layer parameter sliders
            for (const s of LAYER_PARAM_SLIDERS) {
                const pSlider = getEl(`mix-${s.param}-slider-${idx}`);
                if (pSlider) {
                    const pCtrl = initSlider(pSlider, {
                        min: s.min, max: s.max, step: 0.01, defaultValue: s.def,
                        format: v => v.toFixed(2),
                        onChange: (val) => {
                            const layer = LayerSystem.layers[idx];
                            if (layer) {
                                layer[s.param] = val;
                                this.sendUpdate();
                            }
                        },
                    });
                    if (pCtrl) sliderControllers.set(pSlider, pCtrl);
                }
            }
            
            // Click on panel-section to select layer (skip controls)
            const panelSection = mixPanelSections[i];
            if (panelSection) {
                panelSection.addEventListener('click', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                        if (!e.target.closest('.slider')) {
                            panelSection.querySelectorAll('.slider').forEach(sliderEl => {
                                const ctrl = getSliderController(sliderEl);
                                if (ctrl) ctrl.reset();
                            });
                        }
                        this.selectLayer(idx);
                        return;
                    }
                    if (e.target.closest('.mix-mix-controls') || e.target.closest('.mix-edit-controls') || e.target.closest('.mix-controls-panel') || e.target.closest('.mix-mask-panel')) {
                        return;
                    }
                    this.selectLayer(idx);
                });
            }
        }
        
        // BG controls in bottom panel
        const mixBgToggle = getEl('mix-bg-toggle');
        if (mixBgToggle) {
            mixBgToggle.addEventListener('click', () => this.toggleBgEnabled());
        }
        const mixBgColor = getEl('mix-bg-color');
        if (mixBgColor) {
            mixBgColor.addEventListener('input', () => {
                this.setBgColor(mixBgColor.value);
            });
        }
        const mixBgTypeMenu = getEl('mix-bg-type-menu');
        if (mixBgTypeMenu) {
            mixBgTypeMenu.querySelectorAll('.dropdown__item').forEach(item => {
                item.addEventListener('mousedown', () => {
                    this.onBackgroundMaterialTypeChange(item.dataset.value);
                });
                item.addEventListener('dropdown-select', () => {
                    this.onBackgroundMaterialTypeChange(item.dataset.value);
                });
            });
        }
        
        // Switch button - crossfade
        const switchBtn = getEl('mix-switch-btn');
        if (switchBtn) {
            switchBtn.addEventListener('click', () => this.crossfadeToSelected());
        }

        this.renderEditTab();

        // Click on edit panel-sections to select layer
        const editPanelSections = document.querySelectorAll('[data-panel="mix"] > .panel-section[data-expand-hide]');
        for (let i = 0; i < 8; i++) {
            const idx = i;
            const section = editPanelSections[i];
            if (section) {
                section.addEventListener('click', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                        if (!e.target.closest('.slider')) {
                            section.querySelectorAll('.slider').forEach(sliderEl => {
                                const ctrl = getSliderController(sliderEl);
                                if (ctrl) ctrl.reset();
                            });
                        }
                        this.selectLayer(idx);
                        return;
                    }
                    if (e.target.closest('.mix-mix-controls') || e.target.closest('.mix-edit-controls') || e.target.closest('.mix-controls-panel') || e.target.closest('.mix-mask-panel')) {
                        return;
                    }
                    const mixPanel = document.querySelector('.content-panel[data-panel="mix"]');
                    if (mixPanel && !mixPanel.classList.contains('mix--edit-mode')) return;
                    this.selectLayer(idx);
                });
            }
        }

        // Edit panel BG controls
        const editBgColor = getEl('edit-bg-color');
        if (editBgColor) {
            editBgColor.addEventListener('input', () => {
                LayerSystem.backgroundState.material.source = editBgColor.value;
                this.updateUI();
                this.sendUpdate();
            });
        }
        const editBgToggle = getEl('edit-bg-toggle');
        if (editBgToggle) {
            editBgToggle.addEventListener('click', () => this.toggleBgEnabled());
        }
        const editBgTypeMenu = getEl('edit-bg-type-menu');
        if (editBgTypeMenu) {
            editBgTypeMenu.querySelectorAll('.dropdown__item').forEach(item => {
                item.addEventListener('mousedown', () => {
                    this.onBackgroundMaterialTypeChange(item.dataset.value);
                });
                item.addEventListener('dropdown-select', () => {
                    this.onBackgroundMaterialTypeChange(item.dataset.value);
                });
            });
        }

        document.addEventListener('shaders-changed', () => {
            this._rebuildShaderDropdowns();
        });

        document.addEventListener('factory-shaders-loaded', () => {
            this._rebuildShaderDropdowns();
        });

    },
    
    renderEditTab() {
        this.renderBackgroundSourceControls();
        
        for (let i = 0; i < 8; i++) {
            const layer = LayerSystem.layers[i];
            if (!layer) continue;
            const container = getEl(`mix-edit-source-container-${i}`);
            if (container) {
                this.renderLayerSourceControls(i, container);
            }
        }
    },
    
    _dropdownHtml(id, options, selected, menuClass) {
        const items = options.map(o => {
            const sel = o.value === selected ? ' active' : '';
            return `<div class="dropdown__item${sel}" data-value="${o.value}">${o.label}</div>`;
        }).join('');
        const selLabel = (options.find(o => o.value === selected) || options[0]).label;
        const cls = menuClass ? ` ${menuClass}` : '';
        return `<div class="dropdown">
            <button class="dropdown__selected tool-btn" id="${id}-dropdown">
                <span>${selLabel}</span>
            </button>
            <div class="dropdown__menu${cls}" id="${id}-menu">${items}</div>
        </div>`;
    },

    _sliderHtml(id, label, min, max, value) {
        const display = Number.isInteger(value) ? value : value.toFixed(2);
        return `<div class="slider" id="${id}-slider" data-min="${min}" data-max="${max}" data-initial-value="${value}">
            <div class="slider__header">
                <span class="slider__label">${label}</span>
                <span class="slider__value" id="${id}-value">${display}</span>
            </div>
            <div class="slider__track">
                <div class="slider__fill">
                    <div class="slider__handle"></div>
                </div>
            </div>
        </div>`;
    },

    _buildFitDropdown(prefix, params) {
        const fit = params.fit || 'contain';
        return this._dropdownHtml(`${prefix}-fit`, [
            { value: 'contain', label: 'Contain' },
            { value: 'cover', label: 'Cover' },
            { value: 'stretch', label: 'Stretch' }
        ], fit);
    },

    _buildSourceHtml(type, prefix, source, params) {
        const cleanSource = (source && !source.startsWith('#')) ? escapeHtml(source) : '';
        switch (type) {
            case 'solid':
            case 'shader':
                return '';
            case 'image':
                return `<span class="content-label">URL</span>
                    <input type="text" id="${prefix}-url" placeholder="https://..." value="${cleanSource}">
                    <span class="content-label">File</span>
                    <input type="file" id="${prefix}-file" accept="image/*">
                    <span class="content-label">Fit</span>
                    ${this._buildFitDropdown(prefix, params)}`;
            case 'video':
                return `<span class="content-label">URL</span>
                    <input type="text" id="${prefix}-url" placeholder="https://..." value="${cleanSource}">
                    <span class="content-label">File</span>
                    <input type="file" id="${prefix}-file" accept="video/*">
                    <span class="content-label">Fit</span>
                    ${this._buildFitDropdown(prefix, params)}`;
            case 'webcam':
            case 'screen':
                return `<span class="content-label">Fit</span>
                    ${this._buildFitDropdown(prefix, params)}`;
            case 'text':
                return `<span class="content-label">Text</span>
                    <textarea id="${prefix}-content" rows="2" placeholder="Enter text...">${escapeHtml(source)}</textarea>
                    <span class="content-label">Font</span>
                    <input type="text" id="${prefix}-font" placeholder="48px Arial" value="${escapeHtml(params.font || '48px Arial')}">
                    <div class="tool-grid tool-grid--2x2">
                        <div class="color-grid">
                            <span class="content-label">Color</span>
                            <input type="color" class="bg-color" id="${prefix}-color" value="${params.color || '#ffffff'}">
                        </div>
                        <div class="color-grid">
                            <span class="content-label">BG</span>
                            <input type="color" class="bg-color" id="${prefix}-bgcolor" value="${params.backgroundColor || '#000000'}">
                        </div>
                    </div>
                    <span class="content-label">Align</span>
                    ${this._dropdownHtml(`${prefix}-align`, [
                        { value: 'left', label: 'Left' },
                        { value: 'center', label: 'Center' },
                        { value: 'right', label: 'Right' }
                    ], params.align || 'center')}`;
            case 'visualizer': {
                const vizType = params.visualizerType || 'waveform';
                const gain = params.gain ?? 1.0;
                const thickness = params.thickness ?? 0.02;
                const freqMax = params.freqMax ?? 1.0;
                return `<span class="content-label">Type</span>
                    ${this._dropdownHtml(`${prefix}-vizType`, [
                        { value: 'waveform', label: 'Waveform' },
                        { value: 'spectrum', label: 'Spectrum' },
                        { value: 'circular', label: 'Circular' },
                        { value: 'oscilloscope', label: 'Oscilloscope' }
                    ], vizType)}
                    ${this._sliderHtml(`${prefix}-gain`, 'Gain', 0.1, 5, gain)}
                    ${this._sliderHtml(`${prefix}-thickness`, 'Thickness', 0.001, 0.1, thickness)}
                    <span class="content-label">Color</span>
                    <div class="color-grid">
                        <input type="color" class="bg-color" id="${prefix}-color" value="${params.color || '#00ffff'}">
                    </div>
                    <span class="content-label">Mode</span>
                    ${this._dropdownHtml(`${prefix}-mode`,
                        vizType === 'oscilloscope' ? [
                            { value: '0', label: 'XY' },
                            { value: '1', label: 'Lissajous' },
                            { value: '2', label: 'Dots' }
                        ] : vizType === 'circular' ? [
                            { value: '0', label: 'Bars' },
                            { value: '1', label: 'Filled' },
                            { value: '2', label: 'Dots' }
                        ] : [
                            { value: '0', label: 'Line' },
                            { value: '1', label: 'Filled' },
                            { value: '2', label: 'Dots' }
                        ], String(params.mode ?? 0))}
                    ${this._sliderHtml(`${prefix}-freqMax`, 'Freq Max', 0.05, 1.0, freqMax)}`;
            }
            case 'milkdrop': {
                const blendTime = MilkdropFeature.initialized ? MilkdropFeature.getBlendTime() : (params.blendTime ?? 2.0);
                const resolution = MilkdropFeature.initialized ? MilkdropFeature.resolution : (params.resolution || 'canvas');
                const presetIdx = MilkdropFeature.initialized ? MilkdropFeature.currentIndex : (params.presetIndex ?? 0);
                const presetCount = MilkdropFeature.presetCount;
                const presetOptions = presetCount > 0
                    ? Array.from({ length: presetCount }, (_, i) => ({ value: String(i), label: MilkdropFeature.getPresetName(i) }))
                    : [{ value: '0', label: 'No presets loaded' }];
                return `<span class="content-label">Resolution</span>
                    ${this._dropdownHtml(`${prefix}-resolution`, [
                        { value: 'canvas', label: 'Canvas' },
                        { value: '3840x2160', label: '4K' },
                        { value: '1920x1080', label: '1080p' },
                        { value: '960x540', label: '540p' },
                        { value: '512x512', label: '512²' }
                    ], resolution)}
                    <span class="content-label">Preset</span>
                    ${this._dropdownHtml(`${prefix}-preset`, presetOptions, String(presetIdx), 'dropdown__menu--scrollable')}
                    <div class="tool-grid tool-grid--2x1">
                        <button class="tool-btn" id="${prefix}-prev-preset">&#9664;</button>
                        <button class="tool-btn" id="${prefix}-next-preset">&#9654;</button>
                    </div>
                    ${this._sliderHtml(`${prefix}-blendTime`, 'Blend Time', 0.0, 5.0, blendTime)}
                    <span class="content-label">Fit</span>
                    ${this._buildFitDropdown(prefix, params)}`;
            }
            default:
                return '';
        }
    },

    _readDropdownValue(id) {
        const menu = getEl(`${id}-menu`);
        if (!menu) return '';
        const active = menu.querySelector('.dropdown__item.active');
        return active ? active.dataset.value : '';
    },

    _syncDropdownActive(menuId, value) {
        const menu = getEl(menuId);
        if (!menu) return;
        menu.querySelectorAll('.dropdown__item').forEach(item => {
            item.classList.toggle('active', item.dataset.value === value);
        });
    },

    _buildShaderMenuItems() {
        let html = '<div class="dropdown__item" data-value="none">--</div>';

        const factoryShaders = ContentBrowser._manifest?.shaders || [];
        if (factoryShaders.length > 0) {
            html += '<div class="dropdown__item dropdown__item--header">Factory</div>';
            for (const s of factoryShaders) {
                html += `<div class="dropdown__item" data-value="factory:${escapeHtml(s.id)}">${escapeHtml(s.name)}</div>`;
            }
        }

        if (state.savedShaders.length > 0) {
            html += '<div class="dropdown__item dropdown__item--header">Saved</div>';
            for (const s of state.savedShaders) {
                const shortName = s.name.split(/ [-\/] /)[0];
                html += `<div class="dropdown__item" data-value="saved:${escapeHtml(s.id)}">${escapeHtml(shortName)}</div>`;
            }
        }

        return html;
    },

    _buildMilkdropMenuItems() {
        const count = MilkdropFeature.presetCount;
        if (count === 0) return '<div class="dropdown__item" data-value="none">No presets loaded</div>';
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `<div class="dropdown__item" data-value="milkdrop:${i}">${escapeHtml(MilkdropFeature.getPresetName(i))}</div>`;
        }
        return html;
    },

    _rebuildShaderDropdowns() {
        for (let i = 0; i < 8; i++) {
            const layer = LayerSystem.layers[i];
            const menu = getEl(`mix-shader-menu-${i}`);
            if (!menu) continue;

            const type = layer?.material?.type || 'shader';
            let itemsHtml;

            if (type === 'milkdrop') {
                menu.classList.add('dropdown__menu--scrollable');
                itemsHtml = this._buildMilkdropMenuItems();
            } else {
                menu.classList.remove('dropdown__menu--scrollable');
                itemsHtml = this._buildShaderMenuItems();
            }

            menu.innerHTML = itemsHtml;

            menu.querySelectorAll('.dropdown__item[data-value]').forEach(item => {
                const handler = () => {
                    const val = item.dataset.value;
                    if (val.startsWith('milkdrop:')) {
                        this._onMilkdropPresetSelect(i, parseInt(val.split(':')[1]));
                    } else {
                        this.onShaderSelect(i, val);
                    }
                };
                item.addEventListener('mousedown', handler);
                item.addEventListener('dropdown-select', handler);
            });

            this._syncShaderDropdownDisplay(i);
        }
    },

    _syncShaderDropdownDisplay(layerIndex) {
        const layer = LayerSystem.layers[layerIndex];
        const selectedSpan = document.querySelector(`#mix-shader-dropdown-${layerIndex} span`);
        const menu = getEl(`mix-shader-menu-${layerIndex}`);
        if (!selectedSpan || !menu) return;

        const type = layer?.material?.type || 'shader';

        if (type === 'milkdrop') {
            const idx = MilkdropFeature.currentIndex;
            selectedSpan.textContent = MilkdropFeature.getPresetName(idx) || `Preset ${idx}`;
            this._syncDropdownActive(`mix-shader-menu-${layerIndex}`, `milkdrop:${idx}`);
            return;
        }

        let refValue = 'none';
        let displayText = '--';

        if (layer?.material?.shaderRef) {
            const ref = layer.material.shaderRef;
            if (ref.type === 'factory') {
                refValue = `factory:${ref.id}`;
                const entry = ContentBrowser.getFactoryEntry(ref.id);
                displayText = entry ? entry.name : ref.id;
            } else if (ref.type === 'saved') {
                refValue = `saved:${ref.id}`;
                const shader = state.savedShaders.find(s => s.id === ref.id);
                displayText = shader ? shader.name.split(/ [-\/] /)[0] : ref.id;
            }
        }

        selectedSpan.textContent = displayText;
        this._syncDropdownActive(`mix-shader-menu-${layerIndex}`, refValue);
    },

    _onMilkdropPresetSelect(layerIndex, presetIndex) {
        if (presetIndex < 0 || presetIndex >= MilkdropFeature.presetCount) return;
        MilkdropFeature.loadPresetByIndex(presetIndex);
        this.syncAllMilkdropLayers(presetIndex);
        this.refreshAllMilkdropDropdowns();
        this._syncShaderDropdownDisplay(layerIndex);
        this.sendUpdate();
    },

    async onShaderSelect(layerIndex, value) {
        const layer = LayerSystem.layers[layerIndex];
        if (!layer) return;

        if (value === 'none') {
            layer.material.source = '';
            layer.material.shaderRef = null;
            if (layer.program) {
                state.gl.deleteProgram(layer.program);
                layer.program = null;
            }
            this._syncShaderDropdownDisplay(layerIndex);
            this.sendUpdate();
            return;
        }

        const [type, id] = value.split(':');
        let code = null;
        let name = id;

        if (type === 'factory') {
            code = await ContentBrowser.getShaderCode(id);
            const entry = ContentBrowser.getFactoryEntry(id);
            if (entry) name = entry.name;
        } else if (type === 'saved') {
            const shader = state.savedShaders.find(s => s.id === id);
            if (shader) {
                code = shader.code;
                name = shader.name;
            }
        }

        if (!code) return;

        layer.material.type = 'shader';
        layer.material.source = code;
        layer.material.shaderRef = { type, id };

        if (layerIndex === state.selectedLayer) {
            getEl('shaderCode').value = code;
            if (window.WebGL) window.WebGL.initShader();
        } else {
            if (window.WebGL) window.WebGL.compileForLayer(layerIndex);
        }

        this._syncShaderDropdownDisplay(layerIndex);
        this.updateUI();
    },

    _readSliderValue(id, min, max) {
        const sliderEl = document.querySelector(`#${id}-slider`);
        if (sliderEl) {
            const ctrl = sliderControllers.get(sliderEl);
            if (ctrl) return ctrl.getValue();
        }
        const fill = sliderEl?.querySelector('.slider__fill');
        if (!fill) return min;
        const widthVal = fill.style.getPropertyValue('--fill-width') || '0%';
        const pct = parseFloat(widthVal) / 100;
        return min + pct * (max - min);
    },

    _readSourceValues(type, prefix) {
        switch (type) {
            case 'image':
            case 'video': {
                const urlInput = getEl(`${prefix}-url`);
                const fileInput = getEl(`${prefix}-file`);
                let source = '';
                if (fileInput && fileInput.files.length > 0) {
                    source = URL.createObjectURL(fileInput.files[0]);
                } else if (urlInput) {
                    source = urlInput.value;
                }
                return { source, params: { fit: this._readDropdownValue(`${prefix}-fit`) || 'contain' } };
            }
            case 'webcam':
            case 'screen':
                return { source: '', params: { fit: this._readDropdownValue(`${prefix}-fit`) || 'contain' } };
            case 'text': {
                const contentInput = getEl(`${prefix}-content`);
                const fontInput = getEl(`${prefix}-font`);
                const colorInput = getEl(`${prefix}-color`);
                const bgColorInput = getEl(`${prefix}-bgcolor`);
                return {
                    source: contentInput?.value || '',
                    params: {
                        font: fontInput?.value || '48px Arial',
                        color: colorInput?.value || '#ffffff',
                        backgroundColor: bgColorInput?.value || '#000000',
                        align: this._readDropdownValue(`${prefix}-align`) || 'center'
                    }
                };
            }
            case 'visualizer': {
                const vizColorInput = getEl(`${prefix}-color`);
                return {
                    source: '',
                    params: {
                        visualizerType: this._readDropdownValue(`${prefix}-vizType`) || 'waveform',
                        gain: parseFloat(this._readSliderValue(`${prefix}-gain`, 0.1, 5).toFixed(2)),
                        thickness: parseFloat(this._readSliderValue(`${prefix}-thickness`, 0.001, 0.1).toFixed(4)),
                        color: vizColorInput?.value || '#00ffff',
                        mode: parseInt(this._readDropdownValue(`${prefix}-mode`) || '0'),
                        freqMax: parseFloat(this._readSliderValue(`${prefix}-freqMax`, 0.05, 1.0).toFixed(2))
                    }
                };
            }
            case 'milkdrop': {
                const presetVal = parseInt(this._readDropdownValue(`${prefix}-preset`), 10);
                return {
                    source: '',
                    params: {
                        blendTime: parseFloat(this._readSliderValue(`${prefix}-blendTime`, 0.0, 5.0).toFixed(1)),
                        fit: this._readDropdownValue(`${prefix}-fit`) || 'cover',
                        resolution: this._readDropdownValue(`${prefix}-resolution`) || 'canvas',
                        presetIndex: isNaN(presetVal) ? 0 : presetVal
                    }
                };
            }
            default:
                return null;
        }
    },

    _wireAutoSave(containerId, save) {
        const container = getEl(containerId);
        if (!container) return;

        container.querySelectorAll('.dropdown__item').forEach(item => {
            item.addEventListener('dropdown-select', () => save());
        });

        container.querySelectorAll('.slider').forEach(slider => {
            const ctrl = initSlider(slider, {
                onChange: () => save(),
                onCommit: () => save(),
            });
            if (ctrl) sliderControllers.set(slider, ctrl);
        });

        container.querySelectorAll('input[type="text"], textarea').forEach(input => {
            input.addEventListener('blur', save);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') input.blur();
            });
        });

        container.querySelectorAll('input[type="file"]').forEach(input => {
            input.addEventListener('change', save);
        });

        container.querySelectorAll('input[type="color"]').forEach(input => {
            input.addEventListener('input', save);
        });
    },

    renderBackgroundSourceControls() {
        const container = getEl('edit-bg-source-container');
        if (!container) return;

        const material = LayerSystem.backgroundState.material;
        const type = material.type || 'solid';

        container.innerHTML = this._buildSourceHtml(type, `edit-bg-${type}`, material.source, material.params || {});

        if (type !== 'solid') {
            this._wireAutoSave('edit-bg-source-container', () => {
                const values = this._readSourceValues(type, `edit-bg-${type}`);
                if (values) {
                    material.source = values.source;
                    material.params = values.params;
                }
                this.sendUpdate();
            });
        }
    },

    renderLayerSourceControls(layerIndex, container) {
        const layer = LayerSystem.layers[layerIndex];
        if (!layer) return;

        const type = layer.material?.type || 'shader';

        if (type === 'visualizer') {
            const currentParams = layer.material?.params || {};
            // Ensure visualizerType is set (default to waveform)
            if (!currentParams.visualizerType) {
                currentParams.visualizerType = 'waveform';
            }
            // Ensure other params have default values
            if (typeof currentParams.gain !== 'number') {
                currentParams.gain = 1.0;
            }
            if (typeof currentParams.thickness !== 'number') {
                currentParams.thickness = 0.02;
            }
            if (!currentParams.color) {
                currentParams.color = '#00ffff';
            }
            if (typeof currentParams.mode !== 'number') {
                currentParams.mode = 0;
            }
            if (typeof currentParams.freqMax !== 'number') {
                currentParams.freqMax = 1.0;
            }
            // Update the layer's params
            layer.material.params = currentParams;
        }

        container.innerHTML = this._buildSourceHtml(type, `edit-${type}-${layerIndex}`, layer.material?.source || '', layer.material?.params || {});

        if (type !== 'shader') {
            this._wireAutoSave(`mix-edit-source-container-${layerIndex}`, () => {
                const values = this._readSourceValues(type, `edit-${type}-${layerIndex}`);
                if (values) {
                    layer.material.source = values.source;
                    layer.material.params = values.params;
                    if (type === 'milkdrop') {
                        if (typeof values.params.blendTime === 'number') {
                            MilkdropFeature.setBlendTime(values.params.blendTime);
                        }
                        if (values.params.resolution) {
                            MilkdropFeature.setResolution(values.params.resolution);
                        }
                        if (typeof values.params.presetIndex === 'number') {
                            MilkdropFeature.loadPresetByIndex(values.params.presetIndex);
                        }
                        this.syncAllMilkdropLayers(
                            typeof values.params.presetIndex === 'number' ? values.params.presetIndex : MilkdropFeature.currentIndex,
                            values.params.blendTime,
                            values.params.resolution,
                            values.params.fit
                        );
                        this.refreshAllMilkdropDropdowns();
                    }
                }
                // Ensure audio textures are enabled for visualizer layers
                if (type === 'visualizer' && !state.audioTextureEnabled) {
                    AudioTexture.enable();
                }
                this.sendUpdate();
            });
        }

        if (type === 'milkdrop') {
            const prefix = `edit-milkdrop-${layerIndex}`;
            const prevBtn = getEl(`${prefix}-prev-preset`);
            const nextBtn = getEl(`${prefix}-next-preset`);

            if (prevBtn) prevBtn.addEventListener('click', () => {
                const count = MilkdropFeature.presetCount || 1;
                const newIdx = (MilkdropFeature.currentIndex - 1 + count) % count;
                if (MilkdropFeature.initialized) MilkdropFeature.loadPresetByIndex(newIdx);
                this.syncAllMilkdropLayers(newIdx, MilkdropFeature.getBlendTime(), MilkdropFeature.resolution, layer.material.params.fit);
                this.refreshAllMilkdropDropdowns();
                this.sendUpdate();
            });
            if (nextBtn) nextBtn.addEventListener('click', () => {
                const count = MilkdropFeature.presetCount || 1;
                const newIdx = (MilkdropFeature.currentIndex + 1) % count;
                if (MilkdropFeature.initialized) MilkdropFeature.loadPresetByIndex(newIdx);
                this.syncAllMilkdropLayers(newIdx, MilkdropFeature.getBlendTime(), MilkdropFeature.resolution, layer.material.params.fit);
                this.refreshAllMilkdropDropdowns();
                this.sendUpdate();
            });

            const params = layer.material?.params || {};
            if (params.resolution && MilkdropFeature.initialized) {
                MilkdropFeature.setResolution(params.resolution);
            }
            if (typeof params.presetIndex === 'number') {
                if (MilkdropFeature.initialized && MilkdropFeature.currentIndex !== params.presetIndex) {
                    MilkdropFeature.loadPresetByIndex(params.presetIndex);
                }
                this.refreshAllMilkdropDropdowns();
            }
            if (typeof params.blendTime === 'number' && MilkdropFeature.initialized) {
                MilkdropFeature.setBlendTime(params.blendTime);
            }
        }
    },
    
    refreshAllMilkdropDropdowns() {
        for (let i = 0; i < LayerSystem.layers.length; i++) {
            const l = LayerSystem.layers[i];
            if (l?.material?.type === 'milkdrop') {
                const p = `edit-milkdrop-${i}`;
                const idx = String(MilkdropFeature.currentIndex);
                this._syncDropdownActive(`${p}-preset-menu`, idx);
                const ddBtn = getEl(`${p}-preset-dropdown`);
                const activeItem = document.querySelector(`#${p}-preset-menu .dropdown__item[data-value="${idx}"]`);
                if (ddBtn) ddBtn.querySelector('span').textContent = activeItem ? activeItem.textContent : 'No preset';

                const res = MilkdropFeature.resolution;
                this._syncDropdownActive(`${p}-resolution-menu`, res);
                const resBtn = getEl(`${p}-resolution-dropdown`);
                const resItem = document.querySelector(`#${p}-resolution-menu .dropdown__item[data-value="${res}"]`);
                if (resBtn) resBtn.querySelector('span').textContent = resItem ? resItem.textContent : 'Canvas';

                const fit = l.material.params.fit || 'cover';
                this._syncDropdownActive(`${p}-fit-menu`, fit);
                const fitBtn = getEl(`${p}-fit-dropdown`);
                const fitItem = document.querySelector(`#${p}-fit-menu .dropdown__item[data-value="${fit}"]`);
                if (fitBtn) fitBtn.querySelector('span').textContent = fitItem ? fitItem.textContent : 'Cover';

                this._syncShaderDropdownDisplay(i);
            }
        }
    },

    syncAllMilkdropLayers(newIdx, blendTime, resolution, fit) {
        for (let i = 0; i < LayerSystem.layers.length; i++) {
            const l = LayerSystem.layers[i];
            if (l?.material?.type === 'milkdrop') {
                l.material.params.presetIndex = newIdx;
                if (blendTime !== undefined) l.material.params.blendTime = blendTime;
                if (resolution !== undefined) l.material.params.resolution = resolution;
                if (fit !== undefined) l.material.params.fit = fit;
            }
        }
    },

    onBackgroundMaterialTypeChange(newType) {
        const oldType = LayerSystem.backgroundState.material.type;
        if (oldType === newType) return;

        LayerSystem.backgroundState.material.type = newType;
        LayerSystem.backgroundState.material.params = {};

        this.updateUI();
        this.renderBackgroundSourceControls();
        this.sendUpdate();
    },

    onLayerMaterialTypeChange(layerIndex, newType) {
        const layer = LayerSystem.layers[layerIndex];
        if (!layer) return;

        const oldType = layer.material?.type;
        if (oldType === newType) return;

        // Set type and clear source
        layer.material.type = newType;
        layer.material.source = '';

        // Set default params based on type
        if (newType === 'visualizer') {
            layer.material.params = {
                visualizerType: 'waveform',
                gain: 1.0,
                thickness: 0.02,
                color: '#00ffff',
                mode: 0,
                freqMax: 1.0
            };
            // Ensure audio textures are enabled for visualizer
            if (!state.audioTextureEnabled) {
                AudioTexture.enable();
            }
        } else if (newType === 'milkdrop') {
            layer.material.params = {
                blendTime: MilkdropFeature.initialized ? MilkdropFeature.getBlendTime() : 2.0,
                fit: 'cover',
                resolution: MilkdropFeature.initialized ? MilkdropFeature.resolution : 'canvas',
                presetIndex: MilkdropFeature.initialized ? MilkdropFeature.currentIndex : 0
            };
        } else if (newType === 'scanimate') {
            layer.material.params = {};
        } else {
            layer.material.params = {};
        }

        // Re-render source controls for this layer
        const container = getEl(`mix-edit-source-container-${layerIndex}`);
        if (container) {
            this.renderLayerSourceControls(layerIndex, container);
        }

        // Rebuild the second dropdown to show appropriate items for the new type
        this._rebuildShaderDropdowns();

        // Sync
        this.sendUpdate();
    },
    
    setLayerOpacity(index, value) {
        if (LayerSystem.layers[index]) {
            LayerSystem.layers[index].opacity = parseFloat(value);
            this.sendUpdate();
        }
    },
    
    toggleSolo(index) {
        const layer = LayerSystem.layers[index];
        if (layer) {
            layer.solo = !layer.solo;
            this.updateUI();
            this.sendUpdate();
        }
    },
    
    toggleMute(index) {
        const layer = LayerSystem.layers[index];
        if (layer) {
            layer.enabled = !layer.enabled;
            this.updateUI();
            this.sendUpdate();
        }
    },

    toggleBrain(index) {
        const layer = LayerSystem.layers[index];
        if (layer) {
            layer.brainEnabled = !layer.brainEnabled;
            const btn = getEl(`mix-brain-${index}`);
            if (btn) btn.classList.toggle('active', layer.brainEnabled);
            this.sendUpdate();
        }
    },
    
    setBlendMode(index, mode) {
        if (LayerSystem.layers[index]) {
            LayerSystem.layers[index].blendMode = mode;
            this.sendUpdate();
        }
    },
    
    setBgColor(hex) {
        LayerSystem.backgroundState.material.source = hex;
        this.sendUpdate();
    },
    
    toggleBgEnabled() {
        LayerSystem.backgroundState.enabled = !LayerSystem.backgroundState.enabled;
        this.updateUI();
        this.sendUpdate();
    },
    
    selectLayer(index) {
        if (index < 0 || index >= 8) return;
        if (index === state.selectedLayer) return;
        
        state.previousLayer = state.selectedLayer;
        state.selectedLayer = index;
        const newLayer = LayerSystem.layers[index];
        
        if (newLayer) {
            const layerCode = newLayer.material.source || '';
            getEl('shaderCode').value = layerCode;
            
            state.shaderParams = newLayer.shaderParams || [];
            
            CodeDials.render();
            
            const status = getEl('status');
            status.innerHTML = `🎨 Selected Layer ${index + 1}: <span class="status-highlight-cyan">${escapeHtml(newLayer.name)}</span>`;
            setTimeout(() => status.textContent = '', 2000);
        }
        
        this.updateUI();
        this.updateLayerEditorIndicator();
        
        // Dispatch layer-select event for VoiceUI
        document.dispatchEvent(new CustomEvent('layer-select', { detail: { index } }));
    },
    
    crossfadeToSelected() {
        if (this._isCrossfading) return;
        this._isCrossfading = true;

        const switchBtn = getEl('mix-switch-btn');
        if (switchBtn) switchBtn.classList.add('active');

        const selectedIndex = state.selectedLayer;
        const startOpacities = LayerSystem.layers.map(l => l.opacity);
        const durationMs = 300;
        const startTime = performance.now();

        const animate = (now) => {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / durationMs, 1);

            for (let i = 0; i < 8; i++) {
                const layer = LayerSystem.layers[i];
                if (!layer) continue;
                const target = (i === selectedIndex) ? 1 : 0;
                layer.opacity = startOpacities[i] + (target - startOpacities[i]) * t;
            }

            this.updateUI();

            if (t < 1) {
                this._crossfadeRaf = requestAnimationFrame(animate);
            } else {
                this._isCrossfading = false;
                this._crossfadeRaf = null;
                if (switchBtn) switchBtn.classList.remove('active');
                this.sendUpdate();
            }
        };

        this._crossfadeRaf = requestAnimationFrame(animate);
    },

    updateLayerEditorIndicator() {
        const nameDisplay = getEl('layerEditorName');
        if (nameDisplay) {
            nameDisplay.textContent = `Layer ${state.selectedLayer + 1}`;
        }
    },
    
    sendUpdate() {
        Sync.send(LayerSystem.getState());
    },
    
    updateUI() {
        for (let i = 0; i < 8; i++) {
            const layer = LayerSystem.layers[i];
            if (!layer) continue;
            
            // Update bottom panel mix controls
            const mixSoloBtn = getEl(`mix-solo-${i}`);
            const mixMuteBtn = getEl(`mix-mute-${i}`);
            const mixBlendSelected = document.querySelector(`#mix-blend-dropdown-${i} span`);
            const mixTypeSelected = document.querySelector(`#mix-type-dropdown-${i} span`);
            const mixSliderEl = getEl(`mix-opacity-slider-${i}`);
            const mixSliderValue = getEl(`mix-opacity-value-${i}`);
            
            if (mixSoloBtn) mixSoloBtn.classList.toggle('active', !!layer.solo);
            if (mixMuteBtn) mixMuteBtn.classList.toggle('active', !layer.enabled);
            if (mixBlendSelected) {
                const blend = layer.blendMode || 'normal';
                mixBlendSelected.textContent = blend.charAt(0).toUpperCase() + blend.slice(1);
                this._syncDropdownActive(`mix-blend-menu-${i}`, blend);
            }
            if (mixTypeSelected) {
                const typeLabel = layer.material?.type || 'shader';
                mixTypeSelected.textContent = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
                this._syncDropdownActive(`mix-type-menu-${i}`, typeLabel);
            }
            if (mixSliderEl) {
                const ctrl = sliderControllers.get(mixSliderEl);
                if (ctrl) {
                    ctrl.setValue(layer.opacity);
                } else {
                    const fill = mixSliderEl.querySelector('.slider__fill');
                    if (fill) fill.style.setProperty('--fill-width', Math.round(layer.opacity * 100) + '%');
                    if (mixSliderValue) mixSliderValue.textContent = Math.round(layer.opacity * 100) + '%';
                }
            }

            // Sync layer parameter sliders
            for (const s of LAYER_PARAM_SLIDERS) {
                const pSliderEl = getEl(`mix-${s.param}-slider-${i}`);
                if (pSliderEl) {
                    const pCtrl = sliderControllers.get(pSliderEl);
                    if (pCtrl) {
                        pCtrl.setValue(layer[s.param] ?? s.def);
                    }
                }
            }

            this._syncShaderDropdownDisplay(i);
        }
        
        ['mix', 'edit'].forEach(panel => {
            document.querySelectorAll(`[data-panel="${panel}"] > .panel-section[data-expand-hide]`).forEach((section, idx) => {
                section.classList.toggle('selected', idx === state.selectedLayer);
            });
        });
        
        // Update bottom panel background controls
        const mixBgToggle = getEl('mix-bg-toggle');
        const mixBgColor = getEl('mix-bg-color');
        const mixBgTypeSelected = document.querySelector('#mix-bg-type-dropdown span');
        
        if (mixBgToggle) mixBgToggle.classList.toggle('active', LayerSystem.backgroundState.enabled);
        if (mixBgColor) mixBgColor.value = LayerSystem.backgroundState.material.source || '#000000';
        if (mixBgTypeSelected) {
            const bgType = LayerSystem.backgroundState.material.type || 'solid';
            mixBgTypeSelected.textContent = bgType.charAt(0).toUpperCase() + bgType.slice(1);
            this._syncDropdownActive('mix-bg-type-menu', bgType);
        }
        
        // Update edit panel BG controls
        const editBgColor = getEl('edit-bg-color');
        const editBgToggle = getEl('edit-bg-toggle');
        const editBgTypeSelected = document.querySelector('#edit-bg-type-dropdown span');
        
        if (editBgColor) editBgColor.value = LayerSystem.backgroundState.material.source || '#000000';
        if (editBgToggle) editBgToggle.classList.toggle('active', LayerSystem.backgroundState.enabled);
        if (editBgTypeSelected) {
            const bgType = LayerSystem.backgroundState.material.type || 'solid';
            editBgTypeSelected.textContent = bgType.charAt(0).toUpperCase() + bgType.slice(1);
            this._syncDropdownActive('edit-bg-type-menu', bgType);
        }
        
        this.updateLayerEditorIndicator();
    },

    updateModulatedSliders() {
        for (let i = 0; i < 8; i++) {
            const layer = LayerSystem.layers[i];
            if (!layer) continue;
            const mp = layer._modulatedParams;
            if (!mp) continue;

            const opacitySlider = getEl(`mix-opacity-slider-${i}`);
            if (opacitySlider) {
                const ctrl = getSliderController(opacitySlider);
                if (ctrl) {
                    const val = layer._modulatedOpacity !== undefined ? layer._modulatedOpacity : layer.opacity;
                    ctrl.setModulatedValue(val);
                }
            }

            for (const s of LAYER_PARAM_SLIDERS) {
                const pSlider = getEl(`mix-${s.param}-slider-${i}`);
                if (pSlider) {
                    const ctrl = getSliderController(pSlider);
                    if (ctrl && mp[s.param] !== undefined) {
                        ctrl.setModulatedValue(mp[s.param]);
                    }
                }
            }
        }
    }
};
