const sliderRegistry = new WeakMap();

export function getSliderController(el) {
    return sliderRegistry.get(el) || null;
}

export function initSlider(el, options = {}) {
    const track = el.querySelector('.slider__track');
    const fill = el.querySelector('.slider__fill:not(.slider__fill--modulated)');
    const valueDisplay = el.querySelector('.slider__value');
    if (!track || !fill) return null;

    const min = options.min ?? parseFloat(el.dataset.min ?? 0);
    const max = options.max ?? parseFloat(el.dataset.max ?? 1);
    const step = options.step ?? parseFloat(el.dataset.step ?? 0);
    const enabled = options.enabled ?? (() => true);
    const defaultValue = options.defaultValue ?? (el.dataset.initialValue !== undefined ? parseFloat(el.dataset.initialValue) : min);

    const defaultFormat = (v) => {
        const decimals = Math.abs(max - min) < 10 ? 2 : 1;
        return v.toFixed(decimals);
    };
    const format = options.format ?? defaultFormat;

    let currentValue = min;

    const initialValue = options.value ?? (el.dataset.initialValue !== undefined ? parseFloat(el.dataset.initialValue) : undefined);
    if (initialValue !== undefined && !isNaN(initialValue)) {
        const pct = (max - min) !== 0 ? (initialValue - min) / (max - min) : 0;
        currentValue = initialValue;
        fill.style.setProperty('--fill-width', (Math.max(0, Math.min(1, pct)) * 100) + '%');
        if (valueDisplay) valueDisplay.textContent = format(initialValue);
    }

    function updateFromPercent(pct) {
        pct = Math.max(0, Math.min(1, pct));
        fill.style.setProperty('--fill-width', (pct * 100) + '%');
        let val = min + pct * (max - min);
        if (step > 0) val = Math.round(val / step) * step;
        currentValue = val;
        if (valueDisplay) valueDisplay.textContent = format(val);
        return val;
    }

    function handleEvent(e) {
        if (!enabled()) return;
        const rect = track.getBoundingClientRect();
        let pct = (e.clientX - rect.left) / rect.width;
        const val = updateFromPercent(pct);
        if (options.onChange) options.onChange(val);
    }

    track.addEventListener('mousedown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            if (!enabled()) return;
            const pct = (max - min) !== 0 ? (defaultValue - min) / (max - min) : 0;
            const val = updateFromPercent(pct);
            if (options.onChange) options.onChange(val);
            if (options.onCommit) options.onCommit(val);
            return;
        }
        handleEvent(e);
        const onMove = (ev) => handleEvent(ev);
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (options.onCommit) options.onCommit(currentValue);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    track.addEventListener('dblclick', (e) => {
        if (!enabled()) return;
        const pct = (max - min) !== 0 ? (defaultValue - min) / (max - min) : 0;
        const val = updateFromPercent(pct);
        if (options.onChange) options.onChange(val);
        if (options.onCommit) options.onCommit(val);
    });

    el.addEventListener('wheel', (e) => {
        if (!enabled()) return;
        e.preventDefault();
        const increment = step > 0 ? step : (max - min) / 50;
        const delta = -Math.sign(e.deltaY) * increment;
        const newVal = Math.max(min, Math.min(max, currentValue + delta));
        const pct = (max - min) !== 0 ? (newVal - min) / (max - min) : 0;
        updateFromPercent(pct);
        if (options.onChange) options.onChange(currentValue);
        if (options.onCommit) options.onCommit(currentValue);
    }, { passive: false });

    const modulatedFill = el.querySelector('.slider__fill--modulated');

    const api = {
        setValue(value, triggerCallbacks = false) {
            const pct = (max - min) !== 0 ? (value - min) / (max - min) : 0;
            const val = updateFromPercent(pct);
            if (triggerCallbacks) {
                if (options.onChange) options.onChange(val);
                if (options.onCommit) options.onCommit(val);
            }
        },
        getValue() {
            return currentValue;
        },
        reset() {
            const pct = (max - min) !== 0 ? (defaultValue - min) / (max - min) : 0;
            const val = updateFromPercent(pct);
            if (options.onChange) options.onChange(val);
            if (options.onCommit) options.onCommit(val);
        },
        setModulatedValue(value) {
            if (!modulatedFill) return;
            if (value === null || value === undefined) {
                modulatedFill.style.setProperty('--modulated-width', '0%');
                return;
            }
            const pct = (max - min) !== 0 ? (value - min) / (max - min) : 0;
            modulatedFill.style.setProperty('--modulated-width', (Math.max(0, Math.min(1, pct)) * 100) + '%');
        },
        el
    };

    sliderRegistry.set(el, api);
    return api;
}

export function sliderHTML(label, value, min, max, step, attrs = '') {
    const display = Number.isInteger(value) ? value : value.toFixed(step < 0.1 ? 2 : 1);
    return `<div class="slider" data-min="${min}" data-max="${max}" data-step="${step}" data-initial-value="${value}" ${attrs}>
        <div class="slider__header">
            <span class="slider__label">${label}</span>
            <span class="slider__value">${display}</span>
        </div>
        <div class="slider__track">
            <div class="slider__fill slider__fill--modulated"></div>
            <div class="slider__fill">
                <div class="slider__handle"></div>
            </div>
        </div>
    </div>`;
}
