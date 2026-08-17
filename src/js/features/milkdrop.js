import { state } from '../state.js';

export const MilkdropFeature = {
    _visualizer: null,
    _canvas: null,
    _presets: [],
    _presetNames: [],
    _currentIndex: 0,
    _initialized: false,
    _analyser: null,
    _blendTime: 2.0,
    _resolution: 'canvas',

    RESOLUTIONS: {
        'canvas': null,
        '3840x2160': [3840, 2160],
        '1920x1080': [1920, 1080],
        '960x540': [960, 540],
        '512x512': [512, 512],
    },

    get initialized() {
        return this._initialized;
    },

    get presetCount() {
        if (this._presetNames.length > 0) return this._presetNames.length;
        this._loadPresets();
        return this._presetNames.length;
    },

    getPresetName(index) {
        if (this._presetNames.length === 0) this._loadPresets();
        return this._presetNames[index] || '';
    },

    get currentIndex() {
        return this._currentIndex;
    },

    get currentPresetName() {
        return this._presetNames[this._currentIndex] || '';
    },

    get resolution() {
        return this._resolution;
    },

    getResolutionDimensions() {
        const dims = this.RESOLUTIONS[this._resolution];
        if (!dims) return [state.canvas?.width || 512, state.canvas?.height || 512];
        return dims;
    },

    init(analyser) {
        if (this._initialized) return;

        const bc = window.butterchurn;
        if (!bc) {
            console.warn('Milkdrop: butterchurn not loaded');
            return;
        }

        const butterchurnLib = bc.default || bc;

        this._analyser = analyser;

        this._canvas = document.createElement('canvas');
        const [w, h] = this.getResolutionDimensions();
        this._canvas.width = w;
        this._canvas.height = h;

        const audioContext = analyser ? analyser.context : new (window.AudioContext || window.webkitAudioContext)();

        this._visualizer = butterchurnLib.createVisualizer(audioContext, this._canvas, {
            width: w,
            height: h,
            meshWidth: 32,
            meshHeight: 24,
            pixelRatio: 1
        });

        if (analyser) {
            this._visualizer.connectAudio(analyser);
        }

        this._loadPresets();

        if (this._presets.length > 0) {
            this._visualizer.loadPreset(this._presets[0], 0.0);
            this._currentIndex = 0;
        }

        this._createTexture();

        state.milkdropVisualizer = this._visualizer;
        state.milkdropCanvas = this._canvas;
        this._initialized = true;
    },

    _loadPresets() {
        const basePresets = window.base || {};
        const extraPresets = window.extra || {};

        const baseObj = basePresets.default || basePresets;
        const extraObj = extraPresets.default || extraPresets;

        const allPresets = {};

        if (typeof baseObj === 'object' && baseObj !== null) {
            Object.assign(allPresets, baseObj);
        }
        if (typeof extraObj === 'object' && extraObj !== null) {
            Object.assign(allPresets, extraObj);
        }

        this._presetNames = Object.keys(allPresets);
        this._presets = this._presetNames.map(name => allPresets[name]);
    },

    _createTexture() {
        const gl = state.gl;
        if (!gl) return;

        if (state.milkdropTexture) {
            gl.deleteTexture(state.milkdropTexture);
        }

        state.milkdropTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, state.milkdropTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    },

    render() {
        if (!this._initialized || !this._visualizer || !state.milkdropEnabled) return;

        this._visualizer.render();

        const gl = state.gl;
        if (!gl || !state.milkdropTexture) return;

        gl.bindTexture(gl.TEXTURE_2D, state.milkdropTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this._canvas);
    },

    nextPreset() {
        if (!this._visualizer || this._presets.length === 0) return;
        this._currentIndex = (this._currentIndex + 1) % this._presets.length;
        this._visualizer.loadPreset(this._presets[this._currentIndex], this._blendTime);
    },

    prevPreset() {
        if (!this._visualizer || this._presets.length === 0) return;
        this._currentIndex = (this._currentIndex - 1 + this._presets.length) % this._presets.length;
        this._visualizer.loadPreset(this._presets[this._currentIndex], this._blendTime);
    },

    loadPresetByIndex(index) {
        if (!this._visualizer || index < 0 || index >= this._presets.length) return;
        this._currentIndex = index;
        this._visualizer.loadPreset(this._presets[index], this._blendTime);
    },

    setResolution(resString) {
        if (!this.RESOLUTIONS.hasOwnProperty(resString)) return;
        this._resolution = resString;
        const [w, h] = this.getResolutionDimensions();
        this.resize(w, h);
        this._createTexture();
    },

    setBlendTime(seconds) {
        this._blendTime = seconds;
    },

    getBlendTime() {
        return this._blendTime;
    },

    resize(width, height) {
        if (!this._visualizer || !this._canvas) return;
        this._canvas.width = width;
        this._canvas.height = height;
        this._visualizer.setRendererSize(width, height);
    }
};
