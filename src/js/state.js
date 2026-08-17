/**
 * State Management
 * Global application state
 */

import { DIAL_KEY_MAP } from './config.js';

// =============== STATE ===============
export const state = {
    gl: null,
    canvas: null,
    program: null,
    quadBuffer: null,
    timeLoc: null,
    resLoc: null,
    videoLoc: null,
    startTime: Date.now(),
    isPaused: false,
    manualTime: 0,
    loopSeconds: 25.13,
    llmMode: 'shader',
    conversationHistory: [],
    isLiveTuning: false,
    liveTuningIteration: 0,
    wasPausedBeforeTuning: false,
    codeDialValues: {},
    codeDialOriginals: {},
    floatingDialEl: null,
    codeDialZoom: 1.0,
    frameCount: 0,
    selectedLayer: 0,
    previousLayer: 0,
    modulationRoutes: [],
    layerModulationMatrices: Array.from({ length: 8 }, () => [
        { id: 1, source: 'cc', sourceConfig: {}, destination: '', amount: 1.0, curve: 'linear', enabled: false }
    ]),
    channelPressure: {},
    pitchBend: {},
    audioContext: null,
    audioAnalyser: null,
    audioData: null,
    audioWaveformTexture: null,
    audioSpectrumTexture: null,
    audioWaveformData: null,
    audioSpectrumData: null,
    audioTextureEnabled: false,
    audioPlayerAnalyser: null,
    midiAccess: null,
    midiCCValues: {},
    oscValues: {},
    oscPort: 8101,
    oscBind: '0.0.0.0',
    oscEnabled: true,
    lfos: [
        { rate: 1, waveform: 'sine', phaseOffset: 0, phase: 0, amplitude: 1.0, dcOffset: 0, syncMode: 'free', syncRate: '1/4', keySync: false },
        { rate: 1, waveform: 'sine', phaseOffset: 0, phase: 0, amplitude: 1.0, dcOffset: 0, syncMode: 'free', syncRate: '1/4', keySync: false },
        { rate: 1, waveform: 'sine', phaseOffset: 0, phase: 0, amplitude: 1.0, dcOffset: 0, syncMode: 'free', syncRate: '1/4', keySync: false },
        { rate: 1, waveform: 'sine', phaseOffset: 0, phase: 0, amplitude: 1.0, dcOffset: 0, syncMode: 'free', syncRate: '1/4', keySync: false }
    ],
    bpm: 120,
    macros: Array.from({ length: 8 }, (_, i) => ({
        name: `Macro ${i + 1}`,
        value: 0.5,
        cc: null
    })),
    audioModulators: { peak: 0, bandLow: 0, bandMid: 0, bandHigh: 0 },
    mousePos: { x: 0.5, y: 0.5 },
    shaderParams: [], // Array of {key, location, value, uniformName}
    useUniformParams: true, // Enable uniform-based parameter modulation
    savedShaders: [], // Array of {id, name, code, timestamp}
    currentShaderId: null, // ID of currently loaded shader
    videoElement: null,
    videoTexture: null,
    videoEnabled: false,
    videoStream: null,
    screenElement: null,
    screenTexture: null,
    screenEnabled: false,
    screenStream: null,
    milkdropVisualizer: null,
    milkdropCanvas: null,
    milkdropTexture: null,
    milkdropEnabled: false,
    renderStarted: false,
    isStreaming: false,
    contextLost: false,
    capturePending: [],
    resolutionScale: 1,
    fboFormat: 'rgba8',
    supportedFormats: {},
    glExtensions: { colorBufferFloat: false, colorBufferHalfFloat: false, floatLinear: false },
    midiPlayerState: {
        loaded: false,
        fileName: '',
        duration: 0,
        noteCount: 0,
        trackCount: 0
    },
    captureQuality: 80,
    visualBrain: {
        blockSize: 16,
        isRecording: false,
        corpusCount: 0,
        blendAmount: 1.0,
        glitchAmount: 0.3,
        colorWeight: 3.0,
        showGrid: false,
        showScanline: true,
        audioEnabled: false,
        audioDrive: 0.5,
        matchTime: 0,
    },
    scanimate: {
        enabled: false,
        source: '',
        fit: 'cover',
        speed: 1.0,
        configVersion: 0,
        oscillators: [
            { enabled: true, freqMult: 0.3, phaseOffset: 0.0, lockMode: 0, lockTarget: 0, amplitude: 0.15 },
            ...Array.from({ length: 7 }, () => ({
                enabled: false, freqMult: 1.0, phaseOffset: 0.0, lockMode: 0, lockTarget: 0, amplitude: 0.1,
            })),
        ],
        deflection: {
            waveXDepth: 0.04,
            waveYDepth: 0.03,
            rotation: 0.0,
            barrelAmount: 0.0,
            segmentCount: 1,
            segmentThresholds: [0.0, 0.25, 0.5, 0.75],
            segmentDepthMultipliers: [1.0, 1.0, 1.0, 1.0, 1.0],
            domainWarpIterations: 3,
        },
        animation: {
            enabled: false,
            playing: false,
            rateA: 1.0,
            rateB: 1.0,
            duration: 5.0,
            loop: false,
            initialState: null,
            finalState: null,
            _progress: 0,
        },
        colorizer: {
            enabled: true,
            colorA: '#00ccff',
            colorB: '#ff33aa',
            colorC: '#ffee33',
            colorCycleSpeed: 1.0,
            brightnessBoost: 0.9,
        },
        crt: {
            scanlinesEnabled: true,
            scanlineIntensity: 0.08,
            glowEnabled: true,
            glowAmount: 0.3,
            chromaticEnabled: false,
            chromaticAmount: 0.008,
            vignetteEnabled: true,
            vignetteAmount: 0.6,
        },
        feedback: {
            enabled: false,
            amount: 0.5,
            decay: 0.9,
        },
        patchMatrix: [],
    },
};

// DOM element cache
export const dom = {};

// Momentary keys tracking (for keyboard shortcuts)
export const momentaryKeys = new Map(); // dialKey -> originalValue

/**
 * Get DOM element with caching
 * @param {string} id - Element ID
 * @returns {HTMLElement}
 */
export function getEl(id) {
    if (!dom[id]?.isConnected) {
        dom[id] = document.getElementById(id);
    }
    return dom[id];
}
