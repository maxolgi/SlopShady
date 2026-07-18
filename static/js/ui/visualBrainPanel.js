/**
 * VisualBrain Panel UI
 * Controls for the GPU-accelerated concatenative visual synthesis engine
 */

import { state, getEl } from '../state.js';
import { VisualBrain } from '../features/visualBrain.js';
import { initSlider } from './slider.js';

export const VisualBrainPanel = {
    _statTimer: null,

    init() {
        this._wireBlockSizes();
        this._wireCorpus();
        this._wireSliders();
        this._wireToggles();
        this._wireAudio();
        this._startStatUpdates();
    },

    _wireBlockSizes() {
        document.querySelectorAll('[data-vb-bs]').forEach(btn => {
            btn.addEventListener('click', () => {
                const bs = parseInt(btn.dataset.vbBs);
                VisualBrain.setBlockSize(bs);
                document.querySelectorAll('[data-vb-bs]').forEach(b =>
                    b.classList.toggle('active', parseInt(b.dataset.vbBs) === bs)
                );
                this._updateStats();
            });
        });
    },

    _wireCorpus() {
        const recordBtn = getEl('vb-record');
        if (recordBtn) {
            recordBtn.addEventListener('click', () => {
                const s = state.visualBrain;
                s.isRecording = !s.isRecording;
                recordBtn.classList.toggle('active', s.isRecording);
                recordBtn.querySelector('span').textContent = s.isRecording ? 'Stop' : 'Record';
                this._updateStats();
            });
        }

        const seedBtn = getEl('vb-seed');
        if (seedBtn) {
            seedBtn.addEventListener('click', () => {
                const count = VisualBrain.seedCorpus();
                this._updateStats();
            });
        }

        const clearBtn = getEl('vb-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                VisualBrain.clearCorpus();
                this._updateStats();
            });
        }
    },

    _wireSliders() {
        const blendEl = getEl('vb-blend-slider');
        if (blendEl) {
            initSlider(blendEl, {
                format: v => Math.round(v) + '%',
                onChange: v => {
                    state.visualBrain.blendAmount = v / 100;
                }
            });
        }

        const glitchEl = getEl('vb-glitch-slider');
        if (glitchEl) {
            initSlider(glitchEl, {
                format: v => Math.round(v) + '%',
                onChange: v => {
                    state.visualBrain.glitchAmount = v / 100;
                }
            });
        }

        const colorWEl = getEl('vb-colorw-slider');
        if (colorWEl) {
            initSlider(colorWEl, {
                format: v => (v / 100 * 5).toFixed(1),
                onChange: v => {
                    state.visualBrain.colorWeight = (v / 100) * 5;
                }
            });
        }
    },

    _wireToggles() {
        const gridBtn = getEl('vb-grid');
        if (gridBtn) {
            gridBtn.addEventListener('click', () => {
                state.visualBrain.showGrid = !state.visualBrain.showGrid;
                gridBtn.classList.toggle('active', state.visualBrain.showGrid);
            });
        }

        const scanBtn = getEl('vb-scanline');
        if (scanBtn) {
            scanBtn.classList.add('active');
            scanBtn.addEventListener('click', () => {
                state.visualBrain.showScanline = !state.visualBrain.showScanline;
                scanBtn.classList.toggle('active', state.visualBrain.showScanline);
            });
        }
    },

    _wireAudio() {
        const audioBtn = getEl('vb-audio');
        if (audioBtn) {
            audioBtn.addEventListener('click', () => {
                const s = state.visualBrain;
                if (!s.audioEnabled) {
                    if (!state.audioContext) {
                        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }
                    if (!state.audioAnalyser) {
                        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                            const src = state.audioContext.createMediaStreamSource(stream);
                            state.audioAnalyser = state.audioContext.createAnalyser();
                            state.audioAnalyser.fftSize = 256;
                            src.connect(state.audioAnalyser);
                            s.audioEnabled = true;
                            audioBtn.classList.add('active');
                            audioBtn.querySelector('span').textContent = 'Mic On';
                        }).catch(() => {
                        });
                    } else {
                        s.audioEnabled = true;
                        audioBtn.classList.add('active');
                        audioBtn.querySelector('span').textContent = 'Mic On';
                    }
                } else {
                    s.audioEnabled = false;
                    audioBtn.classList.remove('active');
                    audioBtn.querySelector('span').textContent = 'Mic';
                }
            });
        }

        const driveEl = getEl('vb-audio-drive-slider');
        if (driveEl) {
            initSlider(driveEl, {
                format: v => Math.round(v) + '%',
                onChange: v => {
                    state.visualBrain.audioDrive = v / 100;
                }
            });
        }
    },

    _startStatUpdates() {
        this._statTimer = setInterval(() => this._updateStats(), 500);
    },

    _updateStats() {
        const el = (id) => getEl(id);
        const corpusEl = el('vb-stat-corpus');
        const gridEl = el('vb-stat-grid');
        const layersEl = el('vb-stat-input');

        if (corpusEl) corpusEl.textContent = VisualBrain.getCorpusCount();

        if (gridEl) {
            const [gw, gh] = VisualBrain.getGridDims();
            gridEl.textContent = gw + 'x' + gh;
        }

        if (layersEl) {
            if (typeof window.LayerSystem !== 'undefined') {
                const active = window.LayerSystem.layers.filter(l => l.brainEnabled);
                layersEl.textContent = active.length + '/8 layers';
            }
        }
    }
};
