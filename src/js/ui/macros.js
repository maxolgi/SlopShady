import { state, getEl } from '../state.js';
import { initSlider } from './slider.js';
import { Sync } from '../features/sync.js';
import { ti, escapeAttr as _escapeAttr } from './tooltips.js';
import { MidiLearn } from '../features/midi.js';
import { createDebouncedSync } from '../utils.js';

const NUM_MACROS = 8;
const sliderApis = new Map();
const scheduleSync = createDebouncedSync(() => {
    Sync.send({ macros: state.macros.map(m => ({ name: m.name, value: m.value, cc: m.cc })) });
});

export const MacrosUI = {
    init() {
        this.container = getEl('macro-controls');
        if (!this.container) return;
        this.render();
        document.addEventListener('macro-change', () => this.updateSliders());
    },

    render() {
        if (!this.container) return;
        sliderApis.clear();

        this.container.innerHTML = state.macros.map((macro, i) => {
            const ccLabel = macro.cc !== null ? `CC ${macro.cc}` : 'Learn';
            const n = i + 1;
            return `
                <div class="macro-row" data-macro="${i}">
                    <input type="text" class="macro-name" value="${_escapeAttr(macro.name)}" maxlength="12" data-macro-name="${i}" data-tooltip="${_escapeAttr(ti('MACRO_NAME', {n}))}">
                    <div class="slider macro-slider" data-macro-slider="${i}" data-min="0" data-max="1" data-step="0.01" data-tooltip="${_escapeAttr(ti('MACRO_SLIDER', {n}))}">
                        <div class="slider__header">
                            <span class="slider__label">Val</span>
                            <span class="slider__value">${macro.value.toFixed(2)}</span>
                        </div>
                        <div class="slider__track">
                            <div class="slider__fill">
                                <div class="slider__handle"></div>
                            </div>
                        </div>
                    </div>
                    <button class="tool-btn ${macro.cc !== null ? 'active' : ''}" data-action="learn-macro" data-macro-index="${i}" data-tooltip="${_escapeAttr(ti('MACRO_LEARN', {n}))}">${ccLabel}</button>
                    <button class="tool-btn" data-action="clear-macro-cc" data-macro-index="${i}" data-tooltip="${_escapeAttr(ti('MACRO_CLEAR_CC', {n}))}">✕</button>
                </div>
            `;
        }).join('');

        this.container.querySelectorAll('.macro-name').forEach(input => {
            input.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.macroName, 10);
                state.macros[idx].name = e.target.value || `Macro ${idx + 1}`;
                scheduleSync();
            });
        });

        this.container.querySelectorAll('[data-macro-slider]').forEach(sliderEl => {
            const idx = parseInt(sliderEl.dataset.macroSlider, 10);
            const api = initSlider(sliderEl, {
                min: 0, max: 1, step: 0.01,
                format: v => v.toFixed(2),
                onChange: (val) => {
                    state.macros[idx].value = val;
                },
                onCommit: scheduleSync
            });
            if (api) {
                api.setValue(state.macros[idx].value);
                sliderApis.set(idx, api);
            }
        });

        this.container.querySelectorAll('[data-action="learn-macro"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.macroIndex, 10);
                this._startLearn(idx);
            });
        });

        this.container.querySelectorAll('[data-action="clear-macro-cc"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.macroIndex, 10);
                state.macros[idx].cc = null;
                this.render();
                scheduleSync();
            });
        });
    },

    _startLearn(idx) {
        this.container.querySelectorAll('[data-action="learn-macro"]').forEach(b => {
            const bi = parseInt(b.dataset.macroIndex, 10);
            b.textContent = bi === idx ? 'Listening...' : (state.macros[bi].cc !== null ? `CC ${state.macros[bi].cc}` : 'Learn');
            b.classList.toggle('active', false);
        });

        MidiLearn.start((cc) => {
            state.macros[idx].cc = cc;
            this.render();
            scheduleSync();
        });
    },

    updateSliders() {
        for (let i = 0; i < NUM_MACROS; i++) {
            const api = sliderApis.get(i);
            if (api) api.setValue(state.macros[i].value);
        }
    },

    applyState(data) {
        if (!data || !data.macros || !Array.isArray(data.macros)) return;
        for (let i = 0; i < NUM_MACROS; i++) {
            if (data.macros[i]) {
                if (data.macros[i].name !== undefined) state.macros[i].name = data.macros[i].name;
                if (data.macros[i].value !== undefined) state.macros[i].value = data.macros[i].value;
                if (data.macros[i].cc !== undefined) state.macros[i].cc = data.macros[i].cc;
            }
        }
        this.render();
    }
};
