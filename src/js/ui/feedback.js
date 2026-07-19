import { state, getEl } from '../state.js';
import { LayerSystem } from '../webgl/layers.js';
import { FramebufferManager } from '../webgl/framebuffers.js';
import { Sync } from '../features/sync.js';
import { initSlider } from './slider.js';

const BLEND_LABELS = ['Mix', 'Add', 'Multiply', 'Screen', 'Overlay', 'Lighten', 'Darken', 'Subtract', 'Difference'];

const FEEDBACK_PARAMS = [
    { param: 'feedbackAmount', def: 0.5 },
    { param: 'feedbackDecay', def: 0.9 },
    { param: 'feedbackZoom', def: 1.0 },
    { param: 'feedbackRotate', def: 0 },
    { param: 'feedbackOffsetX', def: 0 },
    { param: 'feedbackOffsetY', def: 0 },
    { param: 'feedbackSaturation', def: 1.0 },
    { param: 'feedbackBrightness', def: 1.0 },
];

const sliderControllers = new Map();

function wireFeedbackSlider(slider, onChange) {
    const param = slider.dataset.param;
    const fbDefault = FEEDBACK_PARAMS.find(p => p.param === param);
    const ctrl = initSlider(slider, {
        defaultValue: fbDefault ? fbDefault.def : undefined,
        onChange,
        onCommit: () => Sync.send(LayerSystem.getState()),
    });
    if (ctrl) sliderControllers.set(slider, ctrl);
}

export const FeedbackUI = {
    init() {
        this._initGlobalFeedback();
        this._initLayerFeedback();
        this.updateFromState();
    },

    _initGlobalFeedback() {
        const enableBtn = getEl('feedbackEnabled');
        if (enableBtn) {
            enableBtn.addEventListener('click', () => {
                enableBtn.classList.toggle('active');
                LayerSystem.masterState.feedbackEnabled = enableBtn.classList.contains('active');
                enableBtn.textContent = LayerSystem.masterState.feedbackEnabled ? 'On' : 'Off';
                Sync.send(LayerSystem.getState());
            });
        }

        const section = getEl('feedback-section');
        if (section) {
            section.querySelectorAll('.slider[data-param^="feedback"]').forEach(slider => {
                wireFeedbackSlider(slider, (val) => {
                    LayerSystem.masterState[slider.dataset.param] = val;
                });
            });
        }

        const blendMenu = getEl('feedback-blend-menu');
        if (blendMenu) {
            blendMenu.querySelectorAll('.dropdown__item').forEach(item => {
                item.addEventListener('dropdown-select', () => {
                    const value = parseInt(item.dataset.value);
                    LayerSystem.masterState.feedbackBlendMode = value;
                    this._syncDropdownActive('feedback-blend-menu', value);
                    const selected = document.querySelector('#feedback-blend-dropdown span');
                    if (selected) selected.textContent = BLEND_LABELS[value] || 'Mix';
                    Sync.send(LayerSystem.getState());
                });
            });
        }
    },

    _initLayerFeedback() {
        for (let n = 0; n < 8; n++) {
            const enableBtn = getEl(`mix-feedback-enabled-${n}`);
            if (enableBtn) {
                enableBtn.addEventListener('click', () => {
                    const layer = LayerSystem.layers[n];
                    if (layer) {
                        enableBtn.classList.toggle('active');
                        layer.feedbackEnabled = enableBtn.classList.contains('active');
                        if (layer.feedbackEnabled) {
                            FramebufferManager.ensureLayerFeedbackFBOs(n);
                        } else {
                            FramebufferManager.destroyLayerFeedbackFBOs(n);
                        }
                        Sync.send(LayerSystem.getState());
                    }
                });
            }

            const container = getEl(`mix-feedback-controls-${n}`);
            if (container) {
                container.querySelectorAll('.slider[data-param^="feedback"]').forEach(slider => {
                    const param = slider.dataset.param;
                    wireFeedbackSlider(slider, (val) => {
                        const layer = LayerSystem.layers[n];
                        if (layer) layer[param] = val;
                    });
                });
            }

            const blendMenu = getEl(`mix-feedback-blend-menu-${n}`);
            if (blendMenu) {
                blendMenu.querySelectorAll('.dropdown__item').forEach(item => {
                    item.addEventListener('dropdown-select', () => {
                        const layer = LayerSystem.layers[n];
                        if (layer) {
                            const value = parseInt(item.dataset.value);
                            layer.feedbackBlendMode = value;
                            this._syncDropdownActive(`mix-feedback-blend-menu-${n}`, value);
                            const selected = document.querySelector(`#mix-feedback-blend-dropdown-${n} span`);
                            if (selected) selected.textContent = BLEND_LABELS[value] || 'Mix';
                            Sync.send(LayerSystem.getState());
                        }
                    });
                });
            }
        }
    },

    _syncDropdownActive(menuId, value) {
        const menu = getEl(menuId);
        if (!menu) return;
        menu.querySelectorAll('.dropdown__item').forEach(item => {
            item.classList.toggle('active', parseInt(item.dataset.value) === value);
        });
    },

    updateFromState() {
        this._updateGlobalFeedbackFromState();
        this._updateLayerFeedbackFromState();
    },

    _updateGlobalFeedbackFromState() {
        const enableBtn = getEl('feedbackEnabled');
        if (enableBtn) {
            const enabled = LayerSystem.masterState.feedbackEnabled;
            enableBtn.classList.toggle('active', enabled);
            enableBtn.textContent = enabled ? 'On' : 'Off';
        }

        const section = getEl('feedback-section');
        if (section) {
            for (const { param, def } of FEEDBACK_PARAMS) {
                const val = LayerSystem.masterState[param] ?? def;
                const slider = section.querySelector(`.slider[data-param="${param}"]`);
                if (slider) {
                    const ctrl = sliderControllers.get(slider);
                    if (ctrl) ctrl.setValue(val);
                }
            }
        }

        const blendMode = LayerSystem.masterState.feedbackBlendMode ?? 0;
        this._syncDropdownActive('feedback-blend-menu', blendMode);
        const selected = document.querySelector('#feedback-blend-dropdown span');
        if (selected) selected.textContent = BLEND_LABELS[blendMode] || 'Mix';
    },

    _updateLayerFeedbackFromState() {
        for (let n = 0; n < 8; n++) {
            const layer = LayerSystem.layers[n];
            if (!layer) continue;

            const enableBtn = getEl(`mix-feedback-enabled-${n}`);
            if (enableBtn) {
                enableBtn.classList.toggle('active', layer.feedbackEnabled);
            }

            const container = getEl(`mix-feedback-controls-${n}`);
            if (container) {
                for (const { param, def } of FEEDBACK_PARAMS) {
                    const val = layer[param] ?? def;
                    const slider = container.querySelector(`.slider[data-param="${param}"]`);
                    if (slider) {
                        const ctrl = sliderControllers.get(slider);
                        if (ctrl) ctrl.setValue(val);
                    }
                }

                const blendMode = layer.feedbackBlendMode ?? 0;
                this._syncDropdownActive(`mix-feedback-blend-menu-${n}`, blendMode);
                const selected = document.querySelector(`#mix-feedback-blend-dropdown-${n} span`);
                if (selected) selected.textContent = BLEND_LABELS[blendMode] || 'Mix';
            }
        }
    }
};
