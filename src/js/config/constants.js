/**
 * Constants
 * Non-shader configuration constants split from config.js
 */

import {
    VISUALIZER_WAVEFORM_FS,
    VISUALIZER_SPECTRUM_FS,
    VISUALIZER_CIRCULAR_FS,
    VISUALIZER_OSCILLOSCOPE_FS
} from './shaders.js';

// =============== CONSTANTS ===============
export const SHADER_BUILTINS = new Set([
    'iTime', 'iResolution', 'iMouse', 'iFrame', 'iTimeDelta', 'iFrameRate', 'iSampleRate', 'iDate',
    'gl_FragCoord', 'gl_FragColor', 'pi', 'void', 'float', 'int', 'return', 'for', 'if', 'else', 
    'while', 'break', 'continue', 'in', 'out', 'inout', 'uniform', 'varying', 'attribute', 'const', 
    'struct', 'precision', 'highp', 'mediump', 'lowp', 'abs', 'sin', 'cos', 'tan', 'pow', 'exp', 
    'log', 'sqrt', 'length', 'dot', 'normalize', 'mix', 'smoothstep', 'clamp', 'min', 'max', 
    'floor', 'ceil', 'fract', 'mod', 'reflect', 'refract', 'cross', 'vec2', 'vec3', 'vec4', 
    'mat2', 'mat3', 'mat4'
]);

// =============== BLEND MODES ===============
export const BLEND_MODES = ['normal', 'add', 'multiply', 'screen', 'overlay', 'lighten', 'darken', 'subtract', 'difference'];

export const BLEND_MODE_OPTIONS = [
    { value: 'normal', label: 'Normal' },
    { value: 'add', label: 'Add' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'lighten', label: 'Lighten' },
    { value: 'darken', label: 'Darken' },
    { value: 'subtract', label: 'Subtract' },
    { value: 'difference', label: 'Difference' }
];

// =============== DIAL KEY MAP ===============
export const DIAL_KEY_MAP = ['q','w','e','r','t','y','u','i','o','p','a','s','d','f','g','h','j','k','l','z','x','c','v','b','n','m'];

// =============== SETTINGS KEYS ===============
export const SETTINGS_KEYS = {
    apiUrl: 'slopshady_apiUrl',
    bearerKey: 'slopshady_bearerKey',
    llmConnection: 'slopshady_llmConnection',
    modelNameImage: 'slopshady_modelNameImage',
    modelNameText: 'slopshady_modelNameText',
    captureResolution: 'slopshady_captureResolution',
    captureFormat: 'slopshady_captureFormat',
    captureQuality: 'slopshady_captureQuality',
    liveTuningMaxIterations: 'slopshady_liveTuningMaxIterations',
    syncEnabled: 'slopshady_syncEnabled',
    tooltipsEnabled: 'slopshady_tooltipsEnabled',
    fboFormat: 'slopshady_fboFormat',
    resolutionScale: 'slopshady_resolutionScale',
    cameraDeviceId: 'slopshady_cameraDeviceId',
    screenMonitorIndex: 'slopshady_screenMonitorIndex',
    midiDeviceId: 'slopshady_midiDeviceId',
};

// =============== MODULATION CURVES ===============
export const MODULATION_CURVES = {
    linear: x => x,
    exponential: x => x * x,
    exp: x => x * x,
    logarithmic: x => Math.log10(x * 9 + 1),
    log: x => Math.log10(x * 9 + 1),
    sine: x => Math.sin(x * Math.PI / 2),
    smooth: x => x * x * (3 - 2 * x)
};

// =============== MODULATION SOURCES ===============
export const MODULATION_SOURCES = [
    'note', 'velocity', 'cc', 'osc', 'aftertouch', 'pitchbend',
    'kbd', 'eg0', 'eg1', 'eg2', 'eg3', 'lfo1', 'lfo2', 'lfo3', 'lfo4',
    'audio_peak', 'audio_band_low', 'audio_band_mid', 'audio_band_high',
    'macro1', 'macro2', 'macro3', 'macro4', 'macro5', 'macro6', 'macro7', 'macro8'
];

// =============== DEFAULT OSC ADDRESSES ===============
export const DEFAULT_OSC_ADDRESSES = {
    'u_opacity': '/ch/1',
    'u_brightness': '/ch/2',
    'u_speed': '/ch/3',
    'u_posX': '/ch/4',
    'u_posY': '/ch/5',
    'u_scale': '/ch/6',
    'u_radius': '/ch/7',
    'u_amount': '/ch/8',
    'u_rotation': '/ch/9',
    'u_stretch': '/ch/10',
    'u_maskPosX': '/ch/11',
    'u_maskPosY': '/ch/12',
    'u_maskSoftness': '/ch/13',
};

// =============== DEFAULT MODULATION ENTRY ===============
export const DEFAULT_MODULATION_ENTRY = {
    id: '',
    source: 'cc',
    sourceConfig: {},
    destination: '',
    amount: 1.0,
    curve: 'linear',
    enabled: false
};

// =============== LFO WAVEFORMS ===============
export const LFO_WAVEFORMS = {
    sine: phase => Math.sin(phase * Math.PI * 2),
    square: phase => phase < 0.5 ? 1 : -1,
    saw: phase => 2 * phase - 1,
    triangle: phase => 1 - 4 * Math.abs(phase - 0.5),
    snh: phase => {
        const idx = Math.floor(phase * 16);
        const x = Math.sin(idx * 127.1 + 311.7) * 43758.5453;
        return (x - Math.floor(x)) * 2 - 1;
    },
    noise: phase => {
        const idx = Math.floor(phase * 256);
        const nextIdx = (idx + 1) % 256;
        const x1 = Math.sin(idx * 127.1 + 311.7) * 43758.5453;
        const x2 = Math.sin(nextIdx * 127.1 + 311.7) * 43758.5453;
        const v1 = (x1 - Math.floor(x1)) * 2 - 1;
        const v2 = (x2 - Math.floor(x2)) * 2 - 1;
        const frac = (phase * 256) - idx;
        return v1 + (v2 - v1) * frac;
    }
};

export const LFO_BEAT_DIVISIONS = ['1/1', '1/2', '1/4', '1/8', '1/16'];

// =============== AUDIO TEXTURE ===============
export const AUDIO_FFT_SIZE = 256;
export const AUDIO_TEXTURE_WAVEFORM_UNIT = 3;
export const AUDIO_TEXTURE_SPECTRUM_UNIT = 4;

// =============== LAYER MEDIA TEXTURE UNITS ===============
export const LAYER_VIDEO_TEXTURE_UNIT = 5;
export const LAYER_IMAGE_TEXTURE_UNIT = 6;
export const LAYER_SRT_TEXTURE_UNIT = 7;

// =============== VISUALIZER TYPES ===============
export const VISUALIZER_TYPES = {
    waveform: { name: 'Waveform', shader: VISUALIZER_WAVEFORM_FS },
    spectrum: { name: 'Spectrum', shader: VISUALIZER_SPECTRUM_FS },
    circular: { name: 'Circular Spectrum', shader: VISUALIZER_CIRCULAR_FS },
    oscilloscope: { name: 'Oscilloscope (XY)', shader: VISUALIZER_OSCILLOSCOPE_FS }
};

export const VISUALIZER_DEFAULT_PARAMS = {
    visualizerType: 'waveform',
    gain: 1.0,
    thickness: 0.02,
    color: '#00ffff',
    mode: 0,
    freqMax: 1.0
};

// =============== COMMON CONSTANTS (for code parsing) ===============
export const COMMON_CONSTANTS = new Set([
    '0', '0.0', '1', '1.0', '-1', '-1.0', '2', '2.0', '-2', '-2.0',
    '3', '3.0', '4', '4.0', '5', '5.0', '6', '6.0', '7', '7.0', '8', '8.0', '9', '9.0',
    '3.14159', '3.141592', '3.1415926', '3.14159265', '3.141592653', '3.1415926535', '3.14159265359',
    '6.28318', '6.283185', '1.57079', '1.570796'
]);

// =============== FEEDBACK PARAMS ===============
export const FEEDBACK_PARAMS = [
    { param: 'feedbackAmount', label: 'Amt', min: 0, max: 1, def: 0.5, fill: 50, tip: 'LAYER_FB_AMOUNT' },
    { param: 'feedbackDecay', label: 'Dcy', min: 0, max: 1, def: 0.9, fill: 90, tip: 'LAYER_FB_DECAY' },
    { param: 'feedbackZoom', label: 'Zm', min: 0.5, max: 2, def: 1.0, fill: 25, tip: 'LAYER_FB_ZOOM' },
    { param: 'feedbackRotate', label: 'Rot', min: -3.14, max: 3.14, def: 0, fill: 50, tip: 'LAYER_FB_ROTATE' },
    { param: 'feedbackOffsetX', label: 'OX', min: -0.5, max: 0.5, def: 0, fill: 50, tip: 'LAYER_FB_OX' },
    { param: 'feedbackOffsetY', label: 'OY', min: -0.5, max: 0.5, def: 0, fill: 50, tip: 'LAYER_FB_OY' },
    { param: 'feedbackSaturation', label: 'Sat', min: 0, max: 3, def: 1.0, fill: 33, tip: 'LAYER_FB_SAT' },
    { param: 'feedbackBrightness', label: 'Brt', min: 0, max: 3, def: 1.0, fill: 33, tip: 'LAYER_FB_BRT' },
];
