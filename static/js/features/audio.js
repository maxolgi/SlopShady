/**
 * Audio Texture Module
 * Provides waveform and spectrum data as WebGL LUMINANCE textures for shaders
 */

import { state } from '../state.js';
import { AUDIO_FFT_SIZE } from '../config.js';

function setupTextureParams(gl, texture) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

export const AudioTexture = {
    init() {
        if (!state.gl) return;
        const gl = state.gl;
        // 1x1 placeholder textures so shaders don't fail when no audio is active
        state.audioWaveformTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, state.audioWaveformTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([128]));
        setupTextureParams(gl, state.audioWaveformTexture);

        state.audioSpectrumTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, state.audioSpectrumTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([0]));
        setupTextureParams(gl, state.audioSpectrumTexture);
    },

    enable() {
        state.audioTextureEnabled = true;
        const gl = state.gl;
        if (gl) {
            if (state.audioWaveformTexture) gl.deleteTexture(state.audioWaveformTexture);
            if (state.audioSpectrumTexture) gl.deleteTexture(state.audioSpectrumTexture);
        }
        this.createTextures();
    },

    disable() {
        const gl = state.gl;
        if (gl) {
            if (state.audioWaveformTexture) gl.deleteTexture(state.audioWaveformTexture);
            if (state.audioSpectrumTexture) gl.deleteTexture(state.audioSpectrumTexture);
        }
        state.audioWaveformTexture = null;
        state.audioSpectrumTexture = null;
        state.audioModulators = { peak: 0, bandLow: 0, bandMid: 0, bandHigh: 0 };
        state.audioTextureEnabled = false;
    },

    createTextures() {
        if (!state.gl) return;
        const gl = state.gl;
        const fftSize = AUDIO_FFT_SIZE;
        const binCount = fftSize / 2;

        state.audioWaveformTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, state.audioWaveformTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, fftSize, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
        setupTextureParams(gl, state.audioWaveformTexture);

        state.audioSpectrumTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, state.audioSpectrumTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, binCount, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
        setupTextureParams(gl, state.audioSpectrumTexture);
    },

    update() {
        if (!state.audioTextureEnabled) return;
        const analyser = state.audioPlayerAnalyser || state.audioAnalyser;
        if (!analyser || !state.gl) return;

        const gl = state.gl;
        const fftSize = analyser.fftSize;
        const binCount = analyser.frequencyBinCount;

        if (!state.audioWaveformData || state.audioWaveformData.length !== fftSize)
            state.audioWaveformData = new Uint8Array(fftSize);
        if (!state.audioSpectrumData || state.audioSpectrumData.length !== binCount)
            state.audioSpectrumData = new Uint8Array(binCount);

        if (state.audioWaveformTexture) {
            analyser.getByteTimeDomainData(state.audioWaveformData);
            gl.bindTexture(gl.TEXTURE_2D, state.audioWaveformTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, fftSize, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, state.audioWaveformData);
        }
        if (state.audioSpectrumTexture) {
            analyser.getByteFrequencyData(state.audioSpectrumData);
            gl.bindTexture(gl.TEXTURE_2D, state.audioSpectrumTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, binCount, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, state.audioSpectrumData);
        }

        this.computeAudioModulators();
    },

    computeAudioModulators() {
        const analyser = state.audioPlayerAnalyser || state.audioAnalyser;
        if (!analyser || !state.audioSpectrumData) {
            state.audioModulators = { peak: 0, bandLow: 0, bandMid: 0, bandHigh: 0 };
            return;
        }

        const data = state.audioSpectrumData;
        const len = data.length;
        if (!len) return;

        // Peak: average of all bins
        let peakSum = 0;
        for (let i = 0; i < len; i++) peakSum += data[i];
        state.audioModulators.peak = peakSum / (len * 255);

        // Bands: split into thirds
        const third = Math.floor(len / 3);
        let low = 0, mid = 0, high = 0;
        for (let i = 0; i < third; i++) low += data[i];
        for (let i = third; i < third * 2; i++) mid += data[i];
        for (let i = third * 2; i < len; i++) high += data[i];
        state.audioModulators.bandLow = low / (third * 255);
        state.audioModulators.bandMid = mid / (third * 255);
        state.audioModulators.bandHigh = high / ((len - third * 2) * 255);
    },

};
