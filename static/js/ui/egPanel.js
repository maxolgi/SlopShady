import { EG_DEFAULTS, EGSystem } from '../features/envelopeGenerators.js';
import { state } from '../state.js';
import { initSlider } from './slider.js';
import { ti, escapeAttr } from './tooltips.js';

let _layerSystem = null;

export function setEGPanelLayerSystem(ls) {
    _layerSystem = ls;
}

function getSelectedLayer() {
    if (!_layerSystem) return null;
    return _layerSystem.layers[state.selectedLayer] || null;
}

const _onChangeCallbacks = [];

const EG_CONFIG = {
    delay: { min: 0, max: 2, step: 0.01, label: 'Dly', tip: 'EG_DELAY' },
    attack: { min: 0, max: 5, step: 0.01, label: 'A', tip: 'EG_ATTACK' },
    hold: { min: 0, max: 2, step: 0.01, label: 'Hld', tip: 'EG_HOLD' },
    decay: { min: 0, max: 5, step: 0.01, label: 'D', tip: 'EG_DECAY' },
    sustain: { min: 0, max: 1, step: 0.01, label: 'S', tip: 'EG_SUSTAIN' },
    release: { min: 0, max: 5, step: 0.01, label: 'R', tip: 'EG_RELEASE' }
};

const SLIDER_ORDER = ['delay', 'attack', 'hold', 'decay', 'sustain', 'release'];

const NUM_EGS = 4;

const sliderControllers = new Map();

function isTimeParam(param) {
    return param !== 'sustain';
}

function egSliderHTML(egIndex, param, value) {
    const cfg = EG_CONFIG[param];
    const suffix = isTimeParam(param) ? 's' : '';
    const display = value.toFixed(2) + suffix;
    const n = egIndex + 1;
    const tt = cfg.tip ? ` data-tooltip="${escapeAttr(ti(cfg.tip, {n}))}"` : '';
    return `<div class="slider" data-eg="${egIndex}" data-param="${param}" data-min="${cfg.min}" data-max="${cfg.max}" data-step="${cfg.step}"${tt}>
        <div class="slider__header">
            <span class="slider__label">${cfg.label}</span>
            <span class="slider__value">${display}</span>
        </div>
        <div class="slider__track">
            <div class="slider__fill">
                <div class="slider__handle"></div>
            </div>
        </div>
    </div>`;
}

function _setDropdownValue(dropdown, value) {
    const items = dropdown.querySelectorAll('.dropdown__item');
    let matched = null;
    items.forEach(item => {
        item.classList.toggle('active', item.dataset.value === value);
        if (item.dataset.value === value) matched = item;
    });
    const btn = dropdown.querySelector('.dropdown__selected span');
    if (btn && matched) btn.textContent = matched.textContent;
}

function egSlidersHTML(i) {
    const d = EG_DEFAULTS;
    const sliders = SLIDER_ORDER.map(p => egSliderHTML(i, p, d[p])).join('');
    return `
        <div class="eg-graph-container">
            <canvas class="eg-graph-canvas" width="200" height="60" data-eg-canvas="${i}"></canvas>
        </div>
        ${sliders}`;
}

function egControlsHTML(i) {
    const n = i + 1;
    return `
        <div class="dropdown" data-field="loop" data-tooltip="${escapeAttr(ti('EG_LOOP', {n}))}">
            <button class="dropdown__selected tool-btn"><span>One-Shot</span></button>
            <div class="dropdown__menu">
                <div class="dropdown__item active" data-value="oneshot">One-Shot</div>
                <div class="dropdown__item" data-value="loop">Loop</div>
                <div class="dropdown__item" data-value="retrigger">Retrig</div>
            </div>
        </div>
        <div class="dropdown" data-field="curveShape" data-tooltip="${escapeAttr(ti('EG_CURVE', {n}))}">
            <button class="dropdown__selected tool-btn"><span>Lin</span></button>
            <div class="dropdown__menu">
                <div class="dropdown__item active" data-value="linear">Lin</div>
                <div class="dropdown__item" data-value="exp">Exp</div>
                <div class="dropdown__item" data-value="log">Log</div>
            </div>
        </div>
        <button class="tool-btn" data-eg-trigger="${i}" data-tooltip="${escapeAttr(ti('EG_TRIGGER', {n}))}">&#9654;</button>`;
}

function initEGPanel() {
    for (let i = 0; i < NUM_EGS; i++) {
        const a = document.getElementById(`section-eg-${i}a`);
        const b = document.getElementById(`section-eg-${i}b`);
        if (a) a.innerHTML = egSlidersHTML(i);
        if (b) b.innerHTML = egControlsHTML(i);
    }
    initializeCanvasContexts();
    attachEventListeners();
    drawInitialCurves();
}

const canvasContexts = new Map();

function initializeCanvasContexts() {
    const canvases = document.querySelectorAll('[data-eg-canvas]');
    canvases.forEach(canvas => {
        const egIndex = parseInt(canvas.dataset.egCanvas);
        const ctx = canvas.getContext('2d');
        canvasContexts.set(egIndex, ctx);
    });
}

function attachEventListeners() {
    document.querySelectorAll('[id^="section-eg-"][id$="a"] .slider').forEach(sliderEl => {
        const egIndex = parseInt(sliderEl.dataset.eg);
        const param = sliderEl.dataset.param;
        const suffix = isTimeParam(param) ? 's' : '';

        const ctrl = initSlider(sliderEl, {
            value: EG_DEFAULTS[param],
            defaultValue: EG_DEFAULTS[param],
            format: v => v.toFixed(2) + suffix,
            onChange: (val) => {
                const layer = getSelectedLayer();
                if (layer && layer.egs && layer.egs[egIndex]) {
                    EGSystem.setEGParams(layer.egs[egIndex], { [param]: val });
                    drawEGCurve(egIndex, layer.egs[egIndex]);
                }
                notifyChange(egIndex, param, val);
            },
        });
        if (ctrl) sliderControllers.set(sliderEl, ctrl);
    });

    for (let i = 0; i < NUM_EGS; i++) {
        const section = document.getElementById(`voices-section-eg-${i}b`);
        if (!section) continue;
        section.querySelectorAll('.dropdown').forEach(dropdownEl => {
            const setting = dropdownEl.dataset.field;
            dropdownEl.addEventListener('dropdown-select', (e) => {
                const layer = getSelectedLayer();
                if (layer && layer.egs && layer.egs[i]) {
                    EGSystem.setEGParams(layer.egs[i], { [setting]: e.detail.value });
                    drawEGCurve(i, layer.egs[i]);
                }
            });
        });
    }

    document.querySelectorAll('[data-eg-trigger]').forEach(btn => {
        const egIndex = parseInt(btn.dataset.egTrigger);
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const layer = getSelectedLayer();
            if (layer && layer.voiceManager && layer.voiceManager.voices[0] && layer.voiceManager.voices[0].egs) {
                EGSystem.triggerEG(layer.voiceManager.voices[0].egs[egIndex], 1.0);
            } else if (layer && layer.egs && layer.egs[egIndex]) {
                EGSystem.triggerEG(layer.egs[egIndex], 1.0);
            }
        });
    });
}

function drawInitialCurves() {
    const layer = getSelectedLayer();
    for (let i = 0; i < NUM_EGS; i++) {
        const eg = layer && layer.egs && layer.egs[i] ? layer.egs[i] : EG_DEFAULTS;
        drawEGCurve(i, eg);
    }
}

function applyCurveVisual(t, shape) {
    if (shape === 'exp') return t * t;
    if (shape === 'log') return Math.log10(t * 9 + 1);
    return t;
}

function drawEGCurve(egIndex, eg) {
    const ctx = canvasContexts.get(egIndex);
    if (!ctx) return;

    const delay = eg.delay ?? 0;
    const attack = eg.attack ?? 0.1;
    const hold = eg.hold ?? 0;
    const decay = eg.decay ?? 0.3;
    const sustain = eg.sustain ?? 0.7;
    const release = eg.release ?? 0.5;
    const cs = eg.curveShape || 'linear';

    const canvas = ctx.canvas;
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const y = (height - 20) * (i / 4) + 10;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    const sustainVisualTime = 0.3;
    const totalTime = Math.max(delay + attack + hold + decay + sustainVisualTime + release, 0.5);
    const graphWidth = width - 20;
    const graphHeight = height - 20;
    const startX = 10;
    const startY = height - 10;

    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const points = [];
    const SEGMENT_STEPS = 20;

    let x = startX;
    let y = startY;
    points.push({ x, y });

    if (delay > 0) {
        x += (delay / totalTime) * graphWidth;
        points.push({ x, y });
    }

    if (attack > 0) {
        const segW = (attack / totalTime) * graphWidth;
        const targetY = startY - graphHeight;
        for (let s = 1; s <= SEGMENT_STEPS; s++) {
            const t = s / SEGMENT_STEPS;
            const cv = applyCurveVisual(t, cs);
            const px = x + segW * t;
            const py = y + (targetY - y) * cv;
            points.push({ x: px, y: py });
        }
        x += segW;
        y = targetY;
    } else {
        y = startY - graphHeight;
    }

    if (hold > 0) {
        x += (hold / totalTime) * graphWidth;
        points.push({ x, y });
    }

    const sustainY = startY - (sustain * graphHeight);
    if (decay > 0) {
        const segW = (decay / totalTime) * graphWidth;
        const prevY = y;
        for (let s = 1; s <= SEGMENT_STEPS; s++) {
            const t = s / SEGMENT_STEPS;
            const cv = applyCurveVisual(t, cs);
            const px = x + segW * t;
            const py = prevY + (sustainY - prevY) * cv;
            points.push({ x: px, y: py });
        }
        x += segW;
        y = sustainY;
    } else {
        y = sustainY;
    }

    const sustainEndX = x + (sustainVisualTime / totalTime) * graphWidth;
    points.push({ x: sustainEndX, y: sustainY });
    x = sustainEndX;

    if (release > 0) {
        const segW = (release / totalTime) * graphWidth;
        const prevY = y;
        for (let s = 1; s <= SEGMENT_STEPS; s++) {
            const t = s / SEGMENT_STEPS;
            const cv = applyCurveVisual(t, cs);
            const px = x + segW * t;
            const py = prevY + (startY - prevY) * cv;
            points.push({ x: px, y: py });
        }
        x += segW;
        y = startY;
    } else {
        y = startY;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    ctx.fillStyle = '#ff0';
    const pr = 3;
    const boundaryIndices = [];
    let idx = 0;
    boundaryIndices.push(idx);
    idx += (delay > 0 ? 1 : 0);
    boundaryIndices.push(idx + (attack > 0 ? SEGMENT_STEPS : 0));
    idx += (attack > 0 ? SEGMENT_STEPS : 0);
    idx += (hold > 0 ? 1 : 0);
    boundaryIndices.push(idx + (decay > 0 ? SEGMENT_STEPS : 0));
    idx += (decay > 0 ? SEGMENT_STEPS : 0);
    boundaryIndices.push(idx + 1);

    for (const bi of boundaryIndices) {
        if (bi < points.length) {
            ctx.beginPath();
            ctx.arc(points[bi].x, points[bi].y, pr, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.fillStyle = '#888';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    const labelY = height - 2;
    let lx = startX;

    if (delay > 0.15) {
        const dx = (delay / totalTime) * graphWidth;
        ctx.fillText('Dly', lx + dx / 2, labelY);
        lx += dx;
    } else if (delay > 0) {
        lx += (delay / totalTime) * graphWidth;
    }

    if (attack > 0.15) {
        const ax = (attack / totalTime) * graphWidth;
        ctx.fillText('A', lx + ax / 2, labelY);
        lx += ax;
    } else if (attack > 0) {
        lx += (attack / totalTime) * graphWidth;
    }

    if (hold > 0.15) {
        const hx = (hold / totalTime) * graphWidth;
        ctx.fillText('H', lx + hx / 2, labelY);
        lx += hx;
    } else if (hold > 0) {
        lx += (hold / totalTime) * graphWidth;
    }

    if (decay > 0.15) {
        const ddx = (decay / totalTime) * graphWidth;
        ctx.fillText('D', lx + ddx / 2, labelY);
        lx += ddx;
    } else if (decay > 0) {
        lx += (decay / totalTime) * graphWidth;
    }

    const sx = (sustainVisualTime / totalTime) * graphWidth;
    ctx.fillText('S', lx + sx / 2, labelY);
    lx += sx;

    if (release > 0.15) {
        const rx = (release / totalTime) * graphWidth;
        ctx.fillText('R', lx + rx / 2, labelY);
    }

    return { points, totalTime, graphWidth, startX, startY, graphHeight,
             delay, attack, hold, decay, sustain, release, sustainVisualTime };
}

function computeDotPosition(eg, layout) {
    if (!layout || eg.state === 'idle') return null;

    const { totalTime, graphWidth, startX, startY, graphHeight,
            delay, attack, hold, decay, sustain, release, sustainVisualTime } = layout;

    let elapsed = eg._elapsed;
    const cs = eg.curveShape || 'linear';

    switch (eg.state) {
        case 'delay': {
            const dur = delay || 0.001;
            const t = Math.min(elapsed / dur, 1);
            const x = startX + ((delay * t) / totalTime) * graphWidth;
            return { x, y: startY };
        }
        case 'attack': {
            const delayW = (delay / totalTime) * graphWidth;
            const dur = attack || 0.001;
            const t = Math.min(elapsed / dur, 1);
            const cv = applyCurveVisual(t, cs);
            const segW = (attack / totalTime) * graphWidth;
            const x = startX + delayW + segW * t;
            const sv = eg.startValue || 0;
            const peakY = startY - graphHeight;
            const startYval = startY - sv * graphHeight;
            const y = startYval + (peakY - startYval) * cv;
            return { x, y };
        }
        case 'hold': {
            const offset = ((delay + attack) / totalTime) * graphWidth;
            const dur = hold || 0.001;
            const t = Math.min(elapsed / dur, 1);
            const segW = (hold / totalTime) * graphWidth;
            const x = startX + offset + segW * t;
            const y = startY - graphHeight;
            return { x, y };
        }
        case 'decay': {
            const offset = ((delay + attack + hold) / totalTime) * graphWidth;
            const dur = decay || 0.001;
            const t = Math.min(elapsed / dur, 1);
            const cv = applyCurveVisual(t, cs);
            const segW = (decay / totalTime) * graphWidth;
            const x = startX + offset + segW * t;
            const peakY = startY - graphHeight;
            const targetY = startY - (sustain * graphHeight);
            const y = peakY + (targetY - peakY) * cv;
            return { x, y };
        }
        case 'sustain': {
            const offset = ((delay + attack + hold + decay) / totalTime) * graphWidth;
            const segW = (sustainVisualTime / totalTime) * graphWidth;
            const y = startY - (sustain * graphHeight);
            return { x: startX + offset + segW * 0.5, y };
        }
        case 'release': {
            const offset = ((delay + attack + hold + decay + sustainVisualTime) / totalTime) * graphWidth;
            const dur = release || 0.001;
            const t = Math.min(elapsed / dur, 1);
            const cv = applyCurveVisual(t, cs);
            const segW = (release / totalTime) * graphWidth;
            const x = startX + offset + segW * t;
            const releaseStartY = startY - (eg.startValue || 0) * graphHeight;
            const y = releaseStartY + (startY - releaseStartY) * cv;
            return { x, y };
        }
    }
    return null;
}

function updateEGVisualization(egIndex, eg) {
    const ctx = canvasContexts.get(egIndex);
    if (!ctx) return;

    const layout = drawEGCurve(egIndex, eg);
    if (!layout) return;

    const dotPos = computeDotPosition(eg, layout);
    if (!dotPos) return;

    ctx.save();
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(dotPos.x, dotPos.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function getEGState(egIndex) {
    const layer = getSelectedLayer();
    if (layer && layer.egs && layer.egs[egIndex]) return layer.egs[egIndex];
    return null;
}

function setEGValue(egIndex, param, value) {
    if (egIndex < 0 || egIndex >= NUM_EGS) return;
    if (!EG_CONFIG[param]) return;

    const config = EG_CONFIG[param];
    const clampedValue = Math.max(config.min, Math.min(config.max, value));

    const layer = getSelectedLayer();
    if (layer && layer.egs && layer.egs[egIndex]) {
        EGSystem.setEGParams(layer.egs[egIndex], { [param]: clampedValue });
    }

    const slider = document.querySelector(`#section-eg-${egIndex}a .slider[data-eg="${egIndex}"][data-param="${param}"]`);
    if (slider) {
        const ctrl = sliderControllers.get(slider);
        if (ctrl) ctrl.setValue(clampedValue);
    }

    const eg = layer && layer.egs && layer.egs[egIndex] ? layer.egs[egIndex] : { ...EG_DEFAULTS };
    drawEGCurve(egIndex, eg);
}

function refreshPanel() {
    const layer = getSelectedLayer();
    for (let i = 0; i < NUM_EGS; i++) {
        const eg = layer && layer.egs && layer.egs[i] ? layer.egs[i] : EG_DEFAULTS;

        for (const param of SLIDER_ORDER) {
            const slider = document.querySelector(`#section-eg-${i}a .slider[data-eg="${i}"][data-param="${param}"]`);
            if (slider) {
                const ctrl = sliderControllers.get(slider);
                if (ctrl) ctrl.setValue(eg[param] ?? EG_DEFAULTS[param]);
            }
        }

        const loopVal = eg.loop || 'oneshot';
        const loopDropdown = document.querySelector(`#voices-section-eg-${i}b .dropdown[data-field="loop"]`);
        if (loopDropdown) _setDropdownValue(loopDropdown, loopVal);

        const curveVal = eg.curveShape || 'linear';
        const curveDropdown = document.querySelector(`#voices-section-eg-${i}b .dropdown[data-field="curveShape"]`);
        if (curveDropdown) _setDropdownValue(curveDropdown, curveVal);

        drawEGCurve(i, eg);
    }
}

function onEGChange(callback) {
    _onChangeCallbacks.push(callback);

    return function unsubscribe() {
        const index = _onChangeCallbacks.indexOf(callback);
        if (index !== -1) {
            _onChangeCallbacks.splice(index, 1);
        }
    };
}

function notifyChange(egIndex, param, value) {
    _onChangeCallbacks.forEach(callback => {
        try {
            callback(egIndex, param, value);
        } catch (err) {
        }
    });
}

function resetEG(egIndex) {
    const layer = getSelectedLayer();
    if (layer && layer.egs && layer.egs[egIndex]) {
        EGSystem.resetEG(layer.egs[egIndex]);
        const eg = layer.egs[egIndex];
        for (const param of SLIDER_ORDER) {
            setEGValue(egIndex, param, eg[param]);
        }
        const loopDropdown = document.querySelector(`#voices-section-eg-${egIndex}b .dropdown[data-field="loop"]`);
        if (loopDropdown) _setDropdownValue(loopDropdown, eg.loop);
        const curveDropdown = document.querySelector(`#voices-section-eg-${egIndex}b .dropdown[data-field="curveShape"]`);
        if (curveDropdown) _setDropdownValue(curveDropdown, eg.curveShape);
        drawEGCurve(egIndex, eg);
    }
}

function destroyEGPanel() {
    sliderControllers.clear();
    canvasContexts.clear();
    _onChangeCallbacks.length = 0;
}

export {
    initEGPanel,
    drawEGCurve,
    updateEGVisualization,
    getEGState,
    setEGValue,
    onEGChange,
    resetEG,
    destroyEGPanel,
    refreshPanel
};
