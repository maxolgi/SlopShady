/**
 * Scanimate Panel UI
 * All control panel UI + event wiring for the Scanimate engine
 */

import { state, getEl } from '../state.js';
import { Sync } from '../features/sync.js';
import { initSlider } from './slider.js';
import { ti, escapeAttr as _escTip } from './tooltips.js';

const LOCK_MODE_OPTIONS = [
    { value: '0', label: 'Free' },
    { value: '1', label: 'V-Lock' },
    { value: '2', label: 'H-Lock' },
    { value: '3', label: 'Slave' },
];

const LOCK_TARGET_OPTIONS = Array.from({ length: 8 }, (_, i) => ({
    value: String(i), label: `Osc ${i + 1}`
}));

const sliderApis = new Map();
let _syncTimer = null;
let _oscRafId = null;
let _animRafId = null;
let _lastAnimTime = 0;
let _lastSegmentCount = -1;

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function syncDropdown(menuId, value) {
    const menu = typeof menuId === 'string' ? document.getElementById(menuId) : menuId;
    if (!menu) return;
    const items = menu.querySelectorAll('.dropdown__item');
    let activeLabel = '';
    items.forEach(item => {
        const isActive = item.dataset.value === String(value);
        item.classList.toggle('active', isActive);
        if (isActive) activeLabel = item.textContent;
    });
    const dd = menu.closest('.dropdown');
    const btn = dd?.querySelector('.dropdown__selected span');
    if (btn && activeLabel) btn.textContent = activeLabel;
}

function debounceSync() {
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => {
        Sync.send({ scanimate: state.scanimate });
        _syncTimer = null;
    }, 150);
}

function bumpConfigVersion() {
    state.scanimate.configVersion++;
}

function initSimpleSlider(id, path, format) {
    const el = getEl(id);
    if (!el) return null;
    const parts = path.split('.');
    const read = () => {
        let obj = state.scanimate;
        for (const p of parts) {
            if (obj == null) return 0;
            obj = obj[p];
        }
        return obj ?? 0;
    };
    const write = (v) => {
        let obj = state.scanimate;
        for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
        obj[parts[parts.length - 1]] = v;
    };
    const api = initSlider(el, {
        format: format || (v => v.toFixed(2)),
        onChange: (v) => { write(v); debounceSync(); },
    });
    if (api) {
        api.setValue(read());
        sliderApis.set(id, api);
    }
    return api;
}

function buildOscBank() {
    const insert = getEl('scanimate-osc-insert');
    if (!insert) return;

    const html = state.scanimate.oscillators.map((osc, i) => {
        const lockItems = LOCK_MODE_OPTIONS.map(o => {
            const sel = String(o.value) === String(osc.lockMode) ? ' active' : '';
            return `<div class="dropdown__item${sel}" data-value="${o.value}">${o.label}</div>`;
        }).join('');
        const lockLabel = LOCK_MODE_OPTIONS.find(o => String(o.value) === String(osc.lockMode))?.label || 'Free';

        const targetItems = LOCK_TARGET_OPTIONS.map(o => {
            const sel = String(o.value) === String(osc.lockTarget) ? ' active' : '';
            return `<div class="dropdown__item${sel}" data-value="${o.value}">${o.label}</div>`;
        }).join('');
        const targetLabel = LOCK_TARGET_OPTIONS.find(o => String(o.value) === String(osc.lockTarget))?.label || 'Osc 1';

        return `
            <div class="panel-section" data-osc="${i}" data-expand-hide>
                <span class="content-title">${i + 1}</span>
                <button class="tool-btn${osc.enabled ? ' active' : ''}" data-osc-toggle="${i}" data-tooltip="${_escTip(ti('SC_OSC_TOGGLE', {n: i+1}))}">Osc ${i + 1}</button>
                <div class="dropdown" data-osc-lockmode="${i}" data-tooltip="${_escTip(ti('SC_OSC_LOCK_MODE', {n: i+1}))}">
                    <button class="dropdown__selected tool-btn"><span>${escapeAttr(lockLabel)}</span></button>
                    <div class="dropdown__menu">${lockItems}</div>
                </div>
                <div class="dropdown" data-osc-locktarget="${i}" data-tooltip="${_escTip(ti('SC_OSC_LOCK_TARGET', {n: i+1}))}">
                    <button class="dropdown__selected tool-btn"><span>${escapeAttr(targetLabel)}</span></button>
                    <div class="dropdown__menu">${targetItems}</div>
                </div>
                <div class="slider scanimate-osc-slider" data-osc-freq="${i}" data-min="0.1" data-max="20" data-step="0.1" data-tooltip="${_escTip(ti('SC_OSC_FREQ', {n: i+1}))}">
                    <div class="slider__header">
                        <span class="slider__label">Freq</span>
                        <span class="slider__value">${osc.freqMult.toFixed(1)}</span>
                    </div>
                    <div class="slider__track"><div class="slider__fill"><div class="slider__handle"></div></div></div>
                </div>
                <div class="slider scanimate-osc-slider" data-osc-phase="${i}" data-min="0" data-max="1" data-step="0.01" data-tooltip="${_escTip(ti('SC_OSC_PHASE', {n: i+1}))}">
                    <div class="slider__header">
                        <span class="slider__label">Phase</span>
                        <span class="slider__value">${osc.phaseOffset.toFixed(2)}</span>
                    </div>
                    <div class="slider__track"><div class="slider__fill"><div class="slider__handle"></div></div></div>
                </div>
                <div class="slider scanimate-osc-slider" data-osc-amp="${i}" data-min="0" data-max="1" data-step="0.01" data-tooltip="${_escTip(ti('SC_OSC_AMP', {n: i+1}))}">
                    <div class="slider__header">
                        <span class="slider__label">Amp</span>
                        <span class="slider__value">${osc.amplitude.toFixed(2)}</span>
                    </div>
                    <div class="slider__track"><div class="slider__fill"><div class="slider__handle"></div></div></div>
                </div>
                <canvas data-osc-canvas="${i}" width="116" height="30"></canvas>
            </div>
        `;
    }).join('');

    insert.outerHTML = html;
}

function initOscSliders() {
    document.querySelectorAll('.scanimate-osc-slider').forEach(el => {
        const freqIdx = el.dataset.oscFreq;
        const phaseIdx = el.dataset.oscPhase;
        const ampIdx = el.dataset.oscAmp;
        const idx = freqIdx !== undefined ? parseInt(freqIdx, 10)
            : phaseIdx !== undefined ? parseInt(phaseIdx, 10)
            : ampIdx !== undefined ? parseInt(ampIdx, 10)
            : -1;
        if (idx < 0) return;

        const prop = freqIdx !== undefined ? 'freqMult'
            : phaseIdx !== undefined ? 'phaseOffset'
            : 'amplitude';
        const fmt = prop === 'freqMult' ? (v => v.toFixed(1)) : (v => v.toFixed(2));
        const api = initSlider(el, {
            format: fmt,
            onChange: (v) => {
                state.scanimate.oscillators[idx][prop] = v;
                bumpConfigVersion();
                debounceSync();
            },
        });
        if (api) {
            api.setValue(state.scanimate.oscillators[idx][prop]);
            sliderApis.set(`osc-${idx}-${prop}`, api);
        }
    });
}

function wireOscToggles() {
    document.querySelectorAll('[data-osc-toggle]').forEach(el => {
        const idx = parseInt(el.dataset.oscToggle, 10);
        el.addEventListener('click', () => {
            state.scanimate.oscillators[idx].enabled = !state.scanimate.oscillators[idx].enabled;
            el.classList.toggle('active', state.scanimate.oscillators[idx].enabled);
            bumpConfigVersion();
            debounceSync();
        });
    });
}

function wireOscDropdowns() {
    document.querySelectorAll('[data-osc-lockmode]').forEach(dd => {
        const idx = parseInt(dd.dataset.oscLockmode, 10);
        dd.addEventListener('dropdown-select', (e) => {
            state.scanimate.oscillators[idx].lockMode = parseInt(e.detail.value, 10);
            bumpConfigVersion();
            debounceSync();
        });
    });
    document.querySelectorAll('[data-osc-locktarget]').forEach(dd => {
        const idx = parseInt(dd.dataset.oscLocktarget, 10);
        dd.addEventListener('dropdown-select', (e) => {
            state.scanimate.oscillators[idx].lockTarget = parseInt(e.detail.value, 10);
            bumpConfigVersion();
            debounceSync();
        });
    });
}

function drawOscCanvases() {
    const scanimatePanelActive = document.querySelector('.content-panel[data-panel="scanimate"]')?.classList.contains('content-panel--active');
    if (!scanimatePanelActive) {
        _oscRafId = requestAnimationFrame(drawOscCanvases);
        return;
    }
    for (let i = 0; i < 8; i++) {
        const canvas = document.querySelector(`[data-osc-canvas="${i}"]`);
        if (!canvas) continue;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const osc = state.scanimate.oscillators[i];
        if (!osc.enabled) {
            ctx.strokeStyle = '#333';
            ctx.beginPath();
            ctx.moveTo(0, h / 2);
            ctx.lineTo(w, h / 2);
            ctx.stroke();
            continue;
        }

        const freq = osc.freqMult;
        const phase = osc.phaseOffset;
        const t = performance.now() / 1000;

        ctx.strokeStyle = '#4aa888';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
            const xNorm = x / w;
            const val = Math.sin((xNorm * freq * 2 + phase + t * freq) * Math.PI * 2) * osc.amplitude;
            const y = h / 2 - val * (h / 2 - 2);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
    _oscRafId = requestAnimationFrame(drawOscCanvases);
}

function buildSegmentControls() {
    const container = getEl('scanimate-segment-controls');
    if (!container) return;
    const def = state.scanimate.deflection;
    const count = def.segmentCount;

    let html = '';
    for (let i = 0; i < count - 1; i++) {
        const thresh = def.segmentThresholds[i] !== undefined ? def.segmentThresholds[i] : (i + 1) / count;
        html += `<div class="slider" id="scanimate-segThresh-${i}-slider" data-min="0" data-max="1" data-step="0.01" data-initial-value="${thresh.toFixed(2)}">
            <div class="slider__header">
                <span class="slider__label">Thr ${i + 1}</span>
                <span class="slider__value">${thresh.toFixed(2)}</span>
            </div>
            <div class="slider__track"><div class="slider__fill"><div class="slider__handle"></div></div></div>
        </div>`;
    }
    for (let i = 0; i <= count - 1; i++) {
        const mul = def.segmentDepthMultipliers[i] !== undefined ? def.segmentDepthMultipliers[i] : 1.0;
        html += `<div class="slider" id="scanimate-segMul-${i}-slider" data-min="0" data-max="3" data-step="0.01" data-initial-value="${mul.toFixed(2)}">
            <div class="slider__header">
                <span class="slider__label">Depth ${i + 1}</span>
                <span class="slider__value">${mul.toFixed(2)}</span>
            </div>
            <div class="slider__track"><div class="slider__fill"><div class="slider__handle"></div></div></div>
        </div>`;
    }
    container.innerHTML = html;

    for (let i = 0; i < count - 1; i++) {
        const el = getEl(`scanimate-segThresh-${i}-slider`);
        if (el) {
            const idx = i;
            const api = initSlider(el, {
                format: v => v.toFixed(2),
                onChange: (v) => {
                    state.scanimate.deflection.segmentThresholds[idx] = v;
                    debounceSync();
                },
            });
            if (api) {
                api.setValue(state.scanimate.deflection.segmentThresholds[idx]);
                sliderApis.set(`segThresh-${i}`, api);
            }
        }
    }
    for (let i = 0; i <= count - 1; i++) {
        const el = getEl(`scanimate-segMul-${i}-slider`);
        if (el) {
            const idx = i;
            const api = initSlider(el, {
                format: v => v.toFixed(2),
                onChange: (v) => {
                    state.scanimate.deflection.segmentDepthMultipliers[idx] = v;
                    debounceSync();
                },
            });
            if (api) {
                api.setValue(state.scanimate.deflection.segmentDepthMultipliers[idx]);
                sliderApis.set(`segMul-${i}`, api);
            }
        }
    }
}

function snapshotState() {
    const sa = state.scanimate;
    return JSON.parse(JSON.stringify({
        speed: sa.speed,
        oscillators: sa.oscillators,
        deflection: sa.deflection,
        colorizer: sa.colorizer,
        crt: sa.crt,
        feedback: sa.feedback,
        patchMatrix: sa.patchMatrix,
    }));
}

function applySnapshot(snap) {
    const sa = state.scanimate;
    sa.configVersion++;
    if (snap.speed !== undefined) sa.speed = snap.speed;
    if (snap.oscillators) {
        for (let i = 0; i < 8; i++) {
            if (snap.oscillators[i]) {
                Object.assign(sa.oscillators[i], snap.oscillators[i]);
            }
        }
    }
    if (snap.deflection) {
        Object.assign(sa.deflection, snap.deflection);
    }
    if (snap.colorizer) {
        const ck = ['colorA', 'colorB', 'colorC', 'colorCycleSpeed', 'brightnessBoost', 'enabled'];
        for (const k of ck) {
            if (snap.colorizer[k] !== undefined) sa.colorizer[k] = snap.colorizer[k];
        }
    }
    if (snap.crt) {
        const crtK = ['scanlinesEnabled', 'scanlineIntensity', 'glowEnabled', 'glowAmount', 'chromaticEnabled', 'chromaticAmount', 'vignetteEnabled', 'vignetteAmount'];
        for (const k of crtK) {
            if (snap.crt[k] !== undefined) sa.crt[k] = snap.crt[k];
        }
    }
    if (snap.feedback) {
        const fk = ['enabled', 'amount', 'decay'];
        for (const k of fk) {
            if (snap.feedback[k] !== undefined) sa.feedback[k] = snap.feedback[k];
        }
    }
    if (snap.patchMatrix) {
        sa.patchMatrix = JSON.parse(JSON.stringify(snap.patchMatrix));
    }
}

function lerpValue(a, b, t) {
    return a + (b - a) * t;
}

function lerpColor(a, b, t) {
    const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
    const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
    const r = Math.round(lerpValue(pa[0], pb[0], t));
    const g = Math.round(lerpValue(pa[1], pb[1], t));
    const bl = Math.round(lerpValue(pa[2], pb[2], t));
    return '#' + [r, g, bl].map(c => c.toString(16).padStart(2, '0')).join('');
}

function lerpSnapshots(initial, final, t) {
    const result = JSON.parse(JSON.stringify(initial));

    if (typeof initial.speed === 'number' && typeof final.speed === 'number') {
        result.speed = lerpValue(initial.speed, final.speed, t);
    }

    for (let i = 0; i < 8; i++) {
        const oi = initial.oscillators[i];
        const of_ = final.oscillators[i];
        if (oi && of_) {
            result.oscillators[i].freqMult = lerpValue(oi.freqMult, of_.freqMult, t);
            result.oscillators[i].phaseOffset = lerpValue(oi.phaseOffset, of_.phaseOffset, t);
            result.oscillators[i].amplitude = lerpValue(oi.amplitude, of_.amplitude, t);
            result.oscillators[i].lockMode = t < 0.5 ? oi.lockMode : of_.lockMode;
            result.oscillators[i].lockTarget = t < 0.5 ? oi.lockTarget : of_.lockTarget;
            result.oscillators[i].enabled = t < 0.5 ? oi.enabled : of_.enabled;
        }
    }

    if (initial.deflection && final.deflection) {
        const dKeys = ['waveXDepth', 'waveYDepth', 'rotation', 'barrelAmount', 'domainWarpIterations'];
        for (const k of dKeys) {
            if (typeof final.deflection[k] === 'number' && typeof initial.deflection[k] === 'number') {
                result.deflection[k] = lerpValue(initial.deflection[k], final.deflection[k], t);
            }
        }
        result.deflection.segmentCount = t < 0.5 ? initial.deflection.segmentCount : final.deflection.segmentCount;
        if (Array.isArray(initial.deflection.segmentThresholds) && Array.isArray(final.deflection.segmentThresholds)) {
            for (let i = 0; i < Math.min(initial.deflection.segmentThresholds.length, final.deflection.segmentThresholds.length); i++) {
                result.deflection.segmentThresholds[i] = lerpValue(initial.deflection.segmentThresholds[i], final.deflection.segmentThresholds[i], t);
            }
        }
        if (Array.isArray(initial.deflection.segmentDepthMultipliers) && Array.isArray(final.deflection.segmentDepthMultipliers)) {
            for (let i = 0; i < Math.min(initial.deflection.segmentDepthMultipliers.length, final.deflection.segmentDepthMultipliers.length); i++) {
                result.deflection.segmentDepthMultipliers[i] = lerpValue(initial.deflection.segmentDepthMultipliers[i], final.deflection.segmentDepthMultipliers[i], t);
            }
        }
    }

    if (initial.colorizer && final.colorizer) {
        const cNumKeys = ['colorCycleSpeed', 'brightnessBoost'];
        for (const k of cNumKeys) {
            if (typeof final.colorizer[k] === 'number' && typeof initial.colorizer[k] === 'number') {
                result.colorizer[k] = lerpValue(initial.colorizer[k], final.colorizer[k], t);
            }
        }
        if (typeof initial.colorizer.colorA === 'string' && typeof final.colorizer.colorA === 'string') {
            result.colorizer.colorA = lerpColor(initial.colorizer.colorA, final.colorizer.colorA, t);
        }
        if (typeof initial.colorizer.colorB === 'string' && typeof final.colorizer.colorB === 'string') {
            result.colorizer.colorB = lerpColor(initial.colorizer.colorB, final.colorizer.colorB, t);
        }
        if (typeof initial.colorizer.colorC === 'string' && typeof final.colorizer.colorC === 'string') {
            result.colorizer.colorC = lerpColor(initial.colorizer.colorC, final.colorizer.colorC, t);
        }
        result.colorizer.enabled = t < 0.5 ? initial.colorizer.enabled : final.colorizer.enabled;
    }

    if (initial.crt && final.crt) {
        const crtNumKeys = ['scanlineIntensity', 'glowAmount', 'chromaticAmount', 'vignetteAmount'];
        for (const k of crtNumKeys) {
            if (typeof final.crt[k] === 'number' && typeof initial.crt[k] === 'number') {
                result.crt[k] = lerpValue(initial.crt[k], final.crt[k], t);
            }
        }
        result.crt.scanlinesEnabled = t < 0.5 ? initial.crt.scanlinesEnabled : final.crt.scanlinesEnabled;
        result.crt.glowEnabled = t < 0.5 ? initial.crt.glowEnabled : final.crt.glowEnabled;
        result.crt.chromaticEnabled = t < 0.5 ? initial.crt.chromaticEnabled : final.crt.chromaticEnabled;
        result.crt.vignetteEnabled = t < 0.5 ? initial.crt.vignetteEnabled : final.crt.vignetteEnabled;
    }

    if (initial.feedback && final.feedback) {
        if (typeof initial.feedback.amount === 'number' && typeof final.feedback.amount === 'number') {
            result.feedback.amount = lerpValue(initial.feedback.amount, final.feedback.amount, t);
        }
        if (typeof initial.feedback.decay === 'number' && typeof final.feedback.decay === 'number') {
            result.feedback.decay = lerpValue(initial.feedback.decay, final.feedback.decay, t);
        }
        result.feedback.enabled = t < 0.5 ? initial.feedback.enabled : final.feedback.enabled;
    }

    if (Array.isArray(initial.patchMatrix) && Array.isArray(final.patchMatrix)) {
        const maxLen = Math.max(initial.patchMatrix.length, final.patchMatrix.length);
        result.patchMatrix = [];
        for (let i = 0; i < maxLen; i++) {
            const ip = initial.patchMatrix[i];
            const fp = final.patchMatrix[i];
            if (ip && fp) {
                result.patchMatrix[i] = { ...ip, amount: lerpValue(ip.amount ?? 0, fp.amount ?? 0, t), enabled: t < 0.5 ? ip.enabled : fp.enabled };
            } else {
                result.patchMatrix[i] = JSON.parse(JSON.stringify(ip || fp));
            }
        }
    }

    return result;
}

function syncAnimSliders() {
    const sa = state.scanimate;
    const colorA = getEl('scanimate-colorA');
    if (colorA) colorA.value = sa.colorizer.colorA;
    const colorB = getEl('scanimate-colorB');
    if (colorB) colorB.value = sa.colorizer.colorB;
    const colorC = getEl('scanimate-colorC');
    if (colorC) colorC.value = sa.colorizer.colorC;
    const s = (id, val) => {
        const api = sliderApis.get(id);
        if (api) api.setValue(val);
    };
    s('scanimate-scanlineIntensity-slider', sa.crt.scanlineIntensity);
    s('scanimate-glowAmount-slider', sa.crt.glowAmount);
    s('scanimate-chromaticAmount-slider', sa.crt.chromaticAmount);
    s('scanimate-vignetteAmount-slider', sa.crt.vignetteAmount);
    s('scanimate-colorCycleSpeed-slider', sa.colorizer.colorCycleSpeed);
    s('scanimate-brightnessBoost-slider', sa.colorizer.brightnessBoost);
    s('scanimate-waveXDepth-slider', sa.deflection.waveXDepth);
    s('scanimate-waveYDepth-slider', sa.deflection.waveYDepth);
    s('scanimate-rotation-slider', sa.deflection.rotation);
    s('scanimate-barrelAmount-slider', sa.deflection.barrelAmount);
    s('scanimate-speed-slider', sa.speed);
    s('scanimate-feedback-amount-slider', sa.feedback.amount);
    s('scanimate-feedback-decay-slider', sa.feedback.decay);
    s('scanimate-domainWarpIterations-slider', sa.deflection.domainWarpIterations);
}

function applyInterpolatedFrame() {
    const anim = state.scanimate.animation;
    if (!anim.initialState || !anim.finalState) return;
    let t = anim._progress;
    const rateB = anim.rateB || 1.0;
    if (rateB !== 1.0 && t > 0) t = Math.pow(t, rateB);
    applySnapshot(lerpSnapshots(anim.initialState, anim.finalState, t));
    const progressApi = sliderApis.get('scanimate-anim-progress-slider');
    if (progressApi) progressApi.setValue(anim._progress);
    syncAnimSliders();
}

function animationLoop() {
    const anim = state.scanimate.animation;
    if (!anim.enabled || !anim.initialState || !anim.finalState) {
        _animRafId = null;
        return;
    }

    const now = performance.now() / 1000;
    if (_lastAnimTime === 0) _lastAnimTime = now;
    const dt = now - _lastAnimTime;
    _lastAnimTime = now;

    anim._progress = Math.max(0, Math.min(1, anim._progress || 0));

    if (anim.playing) {
        anim._progress = Math.min(1.0, (anim._progress || 0) + (dt * anim.rateA / anim.duration));
        if (anim._progress >= 1.0) {
            if (anim.loop) {
                anim._progress = 0;
            } else {
                anim._progress = 1.0;
                anim.playing = false;
                const playBtn = getEl('scanimate-anim-play');
                if (playBtn) {
                    playBtn.classList.remove('active');
                }
            }
        }
    }

    applyInterpolatedFrame();

    _animRafId = requestAnimationFrame(animationLoop);
}

export const ScanimatePanel = {
    init() {
        buildOscBank();
        initOscSliders();
        wireOscToggles();
        wireOscDropdowns();
        buildSegmentControls();
        _lastSegmentCount = state.scanimate.deflection.segmentCount;

        initSimpleSlider('scanimate-speed-slider', 'speed');
        initSimpleSlider('scanimate-waveXDepth-slider', 'deflection.waveXDepth', v => v.toFixed(3));
        initSimpleSlider('scanimate-waveYDepth-slider', 'deflection.waveYDepth', v => v.toFixed(3));
        initSimpleSlider('scanimate-rotation-slider', 'deflection.rotation');
        initSimpleSlider('scanimate-barrelAmount-slider', 'deflection.barrelAmount');
        initSimpleSlider('scanimate-domainWarpIterations-slider', 'deflection.domainWarpIterations', v => String(Math.round(v)));
        initSimpleSlider('scanimate-anim-duration-slider', 'animation.duration', v => v.toFixed(1) + 's');
        initSimpleSlider('scanimate-anim-rateA-slider', 'animation.rateA');
        initSimpleSlider('scanimate-anim-rateB-slider', 'animation.rateB');
        initSimpleSlider('scanimate-anim-progress-slider', 'animation._progress', v => ((v || 0) * 100).toFixed(1) + '%');
        initSimpleSlider('scanimate-colorCycleSpeed-slider', 'colorizer.colorCycleSpeed');
        initSimpleSlider('scanimate-brightnessBoost-slider', 'colorizer.brightnessBoost');
        initSimpleSlider('scanimate-scanlineIntensity-slider', 'crt.scanlineIntensity', v => v.toFixed(3));
        initSimpleSlider('scanimate-glowAmount-slider', 'crt.glowAmount');
        initSimpleSlider('scanimate-chromaticAmount-slider', 'crt.chromaticAmount', v => v.toFixed(3));
        initSimpleSlider('scanimate-vignetteAmount-slider', 'crt.vignetteAmount');
        initSimpleSlider('scanimate-feedback-amount-slider', 'feedback.amount');
        initSimpleSlider('scanimate-feedback-decay-slider', 'feedback.decay');

        this._wireToggles();
        this._wireInputs();
        this._wireDropdowns();
        this._wireAnimation();

        const anim = state.scanimate.animation;
        if (anim.enabled && anim.initialState && anim.finalState) {
            _lastAnimTime = 0;
            _animRafId = requestAnimationFrame(animationLoop);
        }

        _oscRafId = requestAnimationFrame(drawOscCanvases);
    },

    _wireToggles() {
        const wire = (id, path) => {
            const el = getEl(id);
            if (!el) return;
            const parts = path.split('.');
            const read = () => {
                let obj = state.scanimate;
                for (const p of parts) obj = obj[p];
                return obj;
            };
            const write = (v) => {
                let obj = state.scanimate;
                for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
                obj[parts[parts.length - 1]] = v;
            };
            el.classList.toggle('active', read());
            el.addEventListener('click', () => {
                write(!read());
                el.classList.toggle('active', read());
                debounceSync();
            });
        };
        wire('scanimate-enabled-toggle', 'enabled');
        wire('scanimate-colorizer-enabled', 'colorizer.enabled');
        wire('scanimate-crt-scanlines', 'crt.scanlinesEnabled');
        wire('scanimate-crt-glow', 'crt.glowEnabled');
        wire('scanimate-crt-chromatic', 'crt.chromaticEnabled');
        wire('scanimate-crt-vignette', 'crt.vignetteEnabled');
        wire('scanimate-feedback-enabled', 'feedback.enabled');
        wire('scanimate-anim-loop', 'animation.loop');
    },

    _wireInputs() {
        const urlInput = getEl('scanimate-url');
        if (urlInput) {
            urlInput.value = state.scanimate.source || '';
            urlInput.addEventListener('input', () => {
                state.scanimate.source = urlInput.value;
                if (urlInput.value && window.LayerSystem?.loadImageTexture) {
                    window.LayerSystem.loadImageTexture(urlInput.value);
                }
                debounceSync();
            });
        }

        const fileInput = getEl('scanimate-file');
        if (fileInput) {
            fileInput.addEventListener('change', () => {
                if (fileInput.files.length > 0) {
                    const blobUrl = URL.createObjectURL(fileInput.files[0]);
                    state.scanimate.source = blobUrl;
                    if (urlInput) urlInput.value = blobUrl;
                    if (window.LayerSystem?.loadImageTexture) {
                        window.LayerSystem.loadImageTexture(blobUrl);
                    }
                    debounceSync();
                }
            });
        }

        const colorA = getEl('scanimate-colorA');
        const colorB = getEl('scanimate-colorB');
        const colorC = getEl('scanimate-colorC');
        const wireColor = (input, btnId, stateKey) => {
            if (!input) return;
            const btn = getEl(btnId);
            const applyColor = () => {
                state.scanimate.colorizer[stateKey] = input.value;
                if (btn) btn.style.setProperty('--btn-color', input.value);
                debounceSync();
            };
            input.value = state.scanimate.colorizer[stateKey] || input.value;
            if (btn) {
                btn.style.setProperty('--btn-color', input.value);
                btn.addEventListener('click', () => input.click());
            }
            input.addEventListener('input', applyColor);
        };
        wireColor(colorA, 'scanimate-colorA-btn', 'colorA');
        wireColor(colorB, 'scanimate-colorB-btn', 'colorB');
        wireColor(colorC, 'scanimate-colorC-btn', 'colorC');
    },

    _wireDropdowns() {
        const fitDd = getEl('scanimate-fit-menu');
        if (fitDd) {
            fitDd.addEventListener('dropdown-select', (e) => {
                state.scanimate.fit = e.detail.value;
                debounceSync();
            });
        }

        const segDd = getEl('scanimate-segmentCount-menu');
        if (segDd) {
            segDd.addEventListener('dropdown-select', (e) => {
                state.scanimate.deflection.segmentCount = parseInt(e.detail.value, 10);
                buildSegmentControls();
                debounceSync();
            });
        }
    },

    _wireAnimation() {
        const animToggle = getEl('scanimate-anim-enabled');
        if (animToggle) {
            animToggle.classList.toggle('active', state.scanimate.animation.enabled);
            animToggle.addEventListener('click', () => {
                const anim = state.scanimate.animation;
                anim.enabled = !anim.enabled;
                animToggle.classList.toggle('active', anim.enabled);
                if (anim.enabled) {
                    if (anim.initialState && anim.finalState && !_animRafId) {
                        _lastAnimTime = 0;
                        _animRafId = requestAnimationFrame(animationLoop);
                    }
                } else {
                    if (_animRafId) {
                        cancelAnimationFrame(_animRafId);
                        _animRafId = null;
                    }
                    _lastAnimTime = 0;
                }
                debounceSync();
            });
        }

        const playBtn = getEl('scanimate-anim-play');
        if (playBtn) {
            playBtn.classList.toggle('active', state.scanimate.animation.playing);
            playBtn.addEventListener('click', () => {
                const anim = state.scanimate.animation;
                if (!anim.enabled || !anim.initialState || !anim.finalState) return;
                anim.playing = !anim.playing;
                playBtn.classList.toggle('active', anim.playing);
                if (anim.playing && !_animRafId) {
                    _lastAnimTime = 0;
                    _animRafId = requestAnimationFrame(animationLoop);
                }
                debounceSync();
            });
        }

        const setInitialBtn = getEl('scanimate-set-initial');
        if (setInitialBtn) {
            setInitialBtn.addEventListener('click', (e) => {
                const anim = state.scanimate.animation;
                if (e.ctrlKey || e.metaKey) {
                    anim.initialState = null;
                    anim.playing = false;
                    const pb = getEl('scanimate-anim-play');
                    if (pb) pb.classList.remove('active');
                    if (_animRafId) { cancelAnimationFrame(_animRafId); _animRafId = null; }
                    _lastAnimTime = 0;
                } else {
                    if (anim.enabled && (anim._progress || 0) > 0.001) return;
                    anim.initialState = snapshotState();
                    if (anim.enabled && anim.finalState && !_animRafId) {
                        _lastAnimTime = 0;
                        _animRafId = requestAnimationFrame(animationLoop);
                    }
                }
                debounceSync();
            });
        }

        const setFinalBtn = getEl('scanimate-set-final');
        if (setFinalBtn) {
            setFinalBtn.addEventListener('click', (e) => {
                const anim = state.scanimate.animation;
                if (e.ctrlKey || e.metaKey) {
                    anim.finalState = null;
                    anim.playing = false;
                    const pb = getEl('scanimate-anim-play');
                    if (pb) pb.classList.remove('active');
                    if (_animRafId) { cancelAnimationFrame(_animRafId); _animRafId = null; }
                    _lastAnimTime = 0;
                } else {
                    if (anim.enabled && (anim._progress || 0) < 0.999) return;
                    anim.finalState = snapshotState();
                    if (anim.enabled && anim.initialState && !_animRafId) {
                        _lastAnimTime = 0;
                        _animRafId = requestAnimationFrame(animationLoop);
                    }
                }
                debounceSync();
            });
        }
    },

    updateUI() {
        const sa = state.scanimate;

        const urlInput = getEl('scanimate-url');
        if (urlInput && document.activeElement !== urlInput) urlInput.value = sa.source || '';

        const colorA = getEl('scanimate-colorA');
        if (colorA) colorA.value = sa.colorizer.colorA || '#00ccff';
        const colorB = getEl('scanimate-colorB');
        if (colorB) colorB.value = sa.colorizer.colorB || '#ff33aa';
        const colorC = getEl('scanimate-colorC');
        if (colorC) colorC.value = sa.colorizer.colorC || '#ffee33';

        const syncBtnColor = (btnId, color) => {
            const btn = getEl(btnId);
            if (btn) btn.style.setProperty('--btn-color', color);
        };
        syncBtnColor('scanimate-colorA-btn', sa.colorizer.colorA || '#00ccff');
        syncBtnColor('scanimate-colorB-btn', sa.colorizer.colorB || '#ff33aa');
        syncBtnColor('scanimate-colorC-btn', sa.colorizer.colorC || '#ffee33');

        const syncSlider = (id, val) => {
            const api = sliderApis.get(id);
            if (api) api.setValue(val);
        };

        syncSlider('scanimate-speed-slider', sa.speed);
        syncSlider('scanimate-waveXDepth-slider', sa.deflection.waveXDepth);
        syncSlider('scanimate-waveYDepth-slider', sa.deflection.waveYDepth);
        syncSlider('scanimate-rotation-slider', sa.deflection.rotation);
        syncSlider('scanimate-barrelAmount-slider', sa.deflection.barrelAmount);
        syncSlider('scanimate-domainWarpIterations-slider', sa.deflection.domainWarpIterations);
        syncSlider('scanimate-colorCycleSpeed-slider', sa.colorizer.colorCycleSpeed);
        syncSlider('scanimate-brightnessBoost-slider', sa.colorizer.brightnessBoost);
        syncSlider('scanimate-scanlineIntensity-slider', sa.crt.scanlineIntensity);
        syncSlider('scanimate-glowAmount-slider', sa.crt.glowAmount);
        syncSlider('scanimate-chromaticAmount-slider', sa.crt.chromaticAmount);
        syncSlider('scanimate-vignetteAmount-slider', sa.crt.vignetteAmount);
        syncSlider('scanimate-feedback-amount-slider', sa.feedback.amount);
        syncSlider('scanimate-feedback-decay-slider', sa.feedback.decay);
        syncSlider('scanimate-anim-duration-slider', sa.animation.duration);
        syncSlider('scanimate-anim-rateA-slider', sa.animation.rateA);
        syncSlider('scanimate-anim-rateB-slider', sa.animation.rateB);

        const syncToggle = (id, val) => {
            const el = getEl(id);
            if (el) el.classList.toggle('active', !!val);
        };

        syncToggle('scanimate-enabled-toggle', sa.enabled);
        syncToggle('scanimate-colorizer-enabled', sa.colorizer.enabled);
        syncToggle('scanimate-crt-scanlines', sa.crt.scanlinesEnabled);
        syncToggle('scanimate-crt-glow', sa.crt.glowEnabled);
        syncToggle('scanimate-crt-chromatic', sa.crt.chromaticEnabled);
        syncToggle('scanimate-crt-vignette', sa.crt.vignetteEnabled);
        syncToggle('scanimate-feedback-enabled', sa.feedback.enabled);
        syncToggle('scanimate-anim-enabled', sa.animation.enabled);
        syncToggle('scanimate-anim-loop', sa.animation.loop);

        const playBtn = getEl('scanimate-anim-play');
        if (playBtn) {
            playBtn.classList.toggle('active', sa.animation.playing);
        }

        for (let i = 0; i < 8; i++) {
            const osc = sa.oscillators[i];
            syncSlider(`osc-${i}-freqMult`, osc.freqMult);
            syncSlider(`osc-${i}-phaseOffset`, osc.phaseOffset);
            syncSlider(`osc-${i}-amplitude`, osc.amplitude);

            const toggleEl = document.querySelector(`[data-osc-toggle="${i}"]`);
            if (toggleEl) toggleEl.classList.toggle('active', osc.enabled);

            const lockMenu = document.querySelector(`[data-osc-lockmode="${i}"] .dropdown__menu`);
            if (lockMenu) syncDropdown(lockMenu, osc.lockMode);

            const targetMenu = document.querySelector(`[data-osc-locktarget="${i}"] .dropdown__menu`);
            if (targetMenu) syncDropdown(targetMenu, osc.lockTarget);
        }

        syncDropdown('scanimate-fit-menu', sa.fit);
        syncDropdown('scanimate-segmentCount-menu', sa.deflection.segmentCount);

        if (_lastSegmentCount !== sa.deflection.segmentCount) {
            _lastSegmentCount = sa.deflection.segmentCount;
            buildSegmentControls();
        }
    },

    applyState(data) {
        if (!data || !data.scanimate) return;
        state.scanimate.configVersion++;
        const sa = data.scanimate;

        if (sa.enabled !== undefined) state.scanimate.enabled = sa.enabled;
        if (sa.source !== undefined) state.scanimate.source = sa.source;
        if (sa.fit !== undefined) state.scanimate.fit = sa.fit;
        if (sa.speed !== undefined) state.scanimate.speed = sa.speed;

        if (sa.oscillators) {
            for (let i = 0; i < 8; i++) {
                if (sa.oscillators[i]) {
                    Object.assign(state.scanimate.oscillators[i], sa.oscillators[i]);
                }
            }
        }

        if (sa.deflection) Object.assign(state.scanimate.deflection, sa.deflection);
        if (sa.animation) {
            const a = sa.animation;
            if (a.initialState) { delete a.initialState.enabled; delete a.initialState.source; delete a.initialState.fit; }
            if (a.finalState) { delete a.finalState.enabled; delete a.finalState.source; delete a.finalState.fit; }
            Object.assign(state.scanimate.animation, a);
        }
        if (sa.colorizer) Object.assign(state.scanimate.colorizer, sa.colorizer);
        if (sa.crt) Object.assign(state.scanimate.crt, sa.crt);
        if (sa.feedback) Object.assign(state.scanimate.feedback, sa.feedback);
        if (sa.patchMatrix) state.scanimate.patchMatrix = sa.patchMatrix;

        this.updateUI();
    },
};
