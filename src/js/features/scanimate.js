/**
 * Scanimate Engine
 * 4-pass pipeline: Deflect → Colorize → Feedback → CRT
 * With oscillator phase-locking, patch bay modulation, and correct feedback routing.
 */

import { state } from '../state.js';
import { FramebufferManager } from '../webgl/framebuffers.js';
import { compileUtilityProgram, hexToRgb } from '../utils.js';
import { MODULATION_CURVES } from '../config.js';
import {
    SCANIMATE_DEFLECT_FS,
    SCANIMATE_COLORIZE_FS,
    SCANIMATE_FEEDBACK_FS,
    SCANIMATE_CRT_FS
} from '../config.js';
import { ModulationMatrix } from './modulationMatrix.js';

const V_RATE = 59.94;
const H_RATE = 15734.0;

const PATCH_DEST_SCALE = {
    u_deflectionX: 0.5,
    u_deflectionY: 0.5,
    u_rotation: Math.PI,
    u_barrel: 1.0,
    u_segmentShift: 1.0,
    u_colorCycle: 2.0,
    u_brightnessBoost: 3.0,
    u_scanlineIntensity: 0.5,
    u_glowAmount: 2.0,
    u_chromaticAmount: 0.05,
    u_vignetteAmount: 2.0,
    u_feedbackAmount: 1.0,
    osc_freq: 20.0,
    osc_amp: 1.0,
};

export const ScanimateEngine = {
    initialized: false,
    deflectProgram: null,
    colorizeProgram: null,
    feedbackProgram: null,
    crtProgram: null,
    blackTexture: null,

    _oscCache: { time: -1, configVersion: -1, result: null },
    _patchCache: { hash: '', configVersion: -1, result: null },

    locs: {},

    init() {
        const gl = state.gl;
        if (!gl) return;

        this.deflectProgram = compileUtilityProgram(gl, SCANIMATE_DEFLECT_FS);
        this.colorizeProgram = compileUtilityProgram(gl, SCANIMATE_COLORIZE_FS);
        this.feedbackProgram = compileUtilityProgram(gl, SCANIMATE_FEEDBACK_FS);
        this.crtProgram = compileUtilityProgram(gl, SCANIMATE_CRT_FS);

        if (!this.deflectProgram || !this.colorizeProgram || !this.feedbackProgram || !this.crtProgram) {
            console.error('ScanimateEngine: Failed to compile one or more programs');
            return;
        }

        this.locs.deflect = {
            u_source: gl.getUniformLocation(this.deflectProgram, 'u_source'),
            u_resolution: gl.getUniformLocation(this.deflectProgram, 'u_resolution'),
            u_time: gl.getUniformLocation(this.deflectProgram, 'u_time'),
            u_speed: gl.getUniformLocation(this.deflectProgram, 'u_speed'),
            u_deflectionX: gl.getUniformLocation(this.deflectProgram, 'u_deflectionX'),
            u_deflectionY: gl.getUniformLocation(this.deflectProgram, 'u_deflectionY'),
            u_rotation: gl.getUniformLocation(this.deflectProgram, 'u_rotation'),
            u_barrelAmount: gl.getUniformLocation(this.deflectProgram, 'u_barrelAmount'),
            u_segmentCount: gl.getUniformLocation(this.deflectProgram, 'u_segmentCount'),
            u_segmentThresholds: gl.getUniformLocation(this.deflectProgram, 'u_segmentThresholds'),
            u_segmentDepthMultipliers: gl.getUniformLocation(this.deflectProgram, 'u_segmentDepthMultipliers'),
            u_domainWarpIterations: gl.getUniformLocation(this.deflectProgram, 'u_domainWarpIterations'),
            u_oscValue: gl.getUniformLocation(this.deflectProgram, 'u_oscValue'),
            u_waveXDepth: gl.getUniformLocation(this.deflectProgram, 'u_waveXDepth'),
            u_waveYDepth: gl.getUniformLocation(this.deflectProgram, 'u_waveYDepth'),
            u_segmentShift: gl.getUniformLocation(this.deflectProgram, 'u_segmentShift'),
            pos: gl.getAttribLocation(this.deflectProgram, 'position'),
        };

        this.locs.colorize = {
            u_source: gl.getUniformLocation(this.colorizeProgram, 'u_source'),
            u_colorizerEnabled: gl.getUniformLocation(this.colorizeProgram, 'u_colorizerEnabled'),
            u_colorA: gl.getUniformLocation(this.colorizeProgram, 'u_colorA'),
            u_colorB: gl.getUniformLocation(this.colorizeProgram, 'u_colorB'),
            u_colorC: gl.getUniformLocation(this.colorizeProgram, 'u_colorC'),
            u_colorCycle: gl.getUniformLocation(this.colorizeProgram, 'u_colorCycle'),
            u_brightnessBoost: gl.getUniformLocation(this.colorizeProgram, 'u_brightnessBoost'),
            pos: gl.getAttribLocation(this.colorizeProgram, 'position'),
        };

        this.locs.feedback = {
            u_currentFrame: gl.getUniformLocation(this.feedbackProgram, 'u_currentFrame'),
            u_lastFrame: gl.getUniformLocation(this.feedbackProgram, 'u_lastFrame'),
            u_feedbackAmount: gl.getUniformLocation(this.feedbackProgram, 'u_feedbackAmount'),
            u_decay: gl.getUniformLocation(this.feedbackProgram, 'u_decay'),
            pos: gl.getAttribLocation(this.feedbackProgram, 'position'),
        };

        this.locs.crt = {
            u_source: gl.getUniformLocation(this.crtProgram, 'u_source'),
            u_resolution: gl.getUniformLocation(this.crtProgram, 'u_resolution'),
            u_scanlinesEnabled: gl.getUniformLocation(this.crtProgram, 'u_scanlinesEnabled'),
            u_scanlineIntensity: gl.getUniformLocation(this.crtProgram, 'u_scanlineIntensity'),
            u_glowEnabled: gl.getUniformLocation(this.crtProgram, 'u_glowEnabled'),
            u_glowAmount: gl.getUniformLocation(this.crtProgram, 'u_glowAmount'),
            u_chromaticEnabled: gl.getUniformLocation(this.crtProgram, 'u_chromaticEnabled'),
            u_chromaticAmount: gl.getUniformLocation(this.crtProgram, 'u_chromaticAmount'),
            u_vignetteEnabled: gl.getUniformLocation(this.crtProgram, 'u_vignetteEnabled'),
            u_vignetteAmount: gl.getUniformLocation(this.crtProgram, 'u_vignetteAmount'),
            pos: gl.getAttribLocation(this.crtProgram, 'position'),
        };

        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.blackTexture = tex;

        this.initialized = true;
    },

    _drawQuad(posLoc) {
        const gl = state.gl;
        if (!gl || posLoc < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    _computeOscillators(time) {
        if (time === this._oscCache.time && state.scanimate.configVersion === this._oscCache.configVersion && this._oscCache.result) {
            return this._oscCache.result;
        }

        const sc = state.scanimate;
        const values = new Float32Array(8);
        const rawSines = new Float32Array(8);
        const phases = new Float32Array(8);

        for (let i = 0; i < 8; i++) {
            const osc = sc.oscillators[i];
            if (!osc || !osc.enabled) {
                values[i] = 0.0;
                rawSines[i] = 0.0;
                phases[i] = 0.0;
                continue;
            }

            const t = time * sc.speed;
            const freq = osc.freqMult;
            const offset = osc.phaseOffset * Math.PI * 2;
            let phase;

            switch (osc.lockMode) {
                case 1:
                    phase = (t * V_RATE % 1) * freq * Math.PI * 2 + offset;
                    break;
                case 2:
                    phase = (t * H_RATE % 1) * freq * Math.PI * 2 + offset;
                    break;
                case 3: {
                    const ti = osc.lockTarget;
                    if (ti >= 0 && ti < 8 && ti !== i) {
                        phase = phases[ti] + offset;
                    } else {
                        phase = t * freq * Math.PI * 2 + offset;
                    }
                    break;
                }
                default:
                    phase = t * freq * Math.PI * 2 + offset;
                    break;
            }

            phases[i] = phase;
            rawSines[i] = Math.sin(phase);
            values[i] = rawSines[i] * osc.amplitude;
        }

        const result = { values, rawSines, phases };
        this._oscCache = { time, configVersion: state.scanimate.configVersion, result };
        return result;
    },

    _getPatchSourceValue(source, sourceConfig, oscRawSines) {
        const oscMatch = source.match(/^osc(\d+)_raw$/);
        if (oscMatch) {
            const idx = parseInt(oscMatch[1], 10);
            if (idx >= 0 && idx < 8) return (oscRawSines[idx] + 1) / 2;
            return 0.5;
        }
        return ModulationMatrix.getSourceValue(source, sourceConfig, null, null, null);
    },

    _applyPatchCurve(value, curve) {
        const curveFn = MODULATION_CURVES[curve] || MODULATION_CURVES.linear;
        const result = curveFn(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)));
        return Math.max(0, Math.min(1, result));
    },

    _hashPatchMatrix(matrix, oscRawSines) {
        let h = matrix.length + '|';
        for (const e of matrix) {
            if (e.enabled) h += e.source + e.destination + (e.amount ?? 0).toFixed(3) + (e.curve || 'lin');
        }
        for (let i = 0; i < 8; i++) h += '|' + oscRawSines[i].toFixed(5);
        return h;
    },

    _evaluatePatchBay(oscRawSines) {
        const sc = state.scanimate;
        const matrix = sc.patchMatrix || [];
        const hash = this._hashPatchMatrix(matrix, oscRawSines);
        if (hash === this._patchCache.hash && state.scanimate.configVersion === this._patchCache.configVersion && this._patchCache.result) {
            return this._patchCache.result;
        }

        const offsets = {
            deflectionX: 0, deflectionY: 0,
            rotation: 0, barrel: 0, segmentShift: 0,
            colorCycle: 0, brightnessBoost: 0,
            scanlineIntensity: 0, glowAmount: 0,
            chromaticAmount: 0, vignetteAmount: 0,
            feedbackAmount: 0,
            oscFreq: new Float32Array(8),
            oscAmp: new Float32Array(8),
        };

        for (const entry of matrix) {
            if (!entry.enabled) continue;
            const amount = Number.isFinite(entry.amount) ? entry.amount : 1.0;
            const sv = this._getPatchSourceValue(entry.source, entry.sourceConfig || {}, oscRawSines);
            const curved = this._applyPatchCurve(sv, entry.curve);
            const value = curved * amount;

            switch (entry.destination) {
                case 'u_deflectionX': offsets.deflectionX += value * PATCH_DEST_SCALE.u_deflectionX; break;
                case 'u_deflectionY': offsets.deflectionY += value * PATCH_DEST_SCALE.u_deflectionY; break;
                case 'u_rotation': offsets.rotation += value * PATCH_DEST_SCALE.u_rotation; break;
                case 'u_barrel': offsets.barrel += value * PATCH_DEST_SCALE.u_barrel; break;
                case 'u_segmentShift': offsets.segmentShift += value * PATCH_DEST_SCALE.u_segmentShift; break;
                case 'u_colorCycle': offsets.colorCycle += value * PATCH_DEST_SCALE.u_colorCycle; break;
                case 'u_brightnessBoost': offsets.brightnessBoost += value * PATCH_DEST_SCALE.u_brightnessBoost; break;
                case 'u_scanlineIntensity': offsets.scanlineIntensity += value * PATCH_DEST_SCALE.u_scanlineIntensity; break;
                case 'u_glowAmount': offsets.glowAmount += value * PATCH_DEST_SCALE.u_glowAmount; break;
                case 'u_chromaticAmount': offsets.chromaticAmount += value * PATCH_DEST_SCALE.u_chromaticAmount; break;
                case 'u_vignetteAmount': offsets.vignetteAmount += value * PATCH_DEST_SCALE.u_vignetteAmount; break;
                case 'u_feedbackAmount': offsets.feedbackAmount += value * PATCH_DEST_SCALE.u_feedbackAmount; break;
                default: {
                    const freqM = entry.destination.match(/^osc(\d+)_freq$/);
                    if (freqM) {
                        const idx = parseInt(freqM[1], 10);
                        if (idx >= 0 && idx < 8) offsets.oscFreq[idx] += value * PATCH_DEST_SCALE.osc_freq;
                        break;
                    }
                    const ampM = entry.destination.match(/^osc(\d+)_amp$/);
                    if (ampM) {
                        const idx = parseInt(ampM[1], 10);
                        if (idx >= 0 && idx < 8) offsets.oscAmp[idx] += value * PATCH_DEST_SCALE.osc_amp;
                        break;
                    }
                }
            }
        }

        this._patchCache = { hash, configVersion: state.scanimate.configVersion, result: offsets };
        return offsets;
    },

    _resolveSourceTexture(layer) {
        const sc = state.scanimate;
        const src = sc.source;
        if (/^[0-7]$/.test(src)) {
            const layerFBO = FramebufferManager.getLayerFBO(parseInt(src));
            return layerFBO ? layerFBO.texture : this.blackTexture;
        }
        if (src && src.length > 0) {
            const cacheKey = src;
            const imgCache = window.LayerSystem?.imageCache;
            if (imgCache) {
                const cached = imgCache.get(cacheKey);
                if (cached && !cached.loading && cached.texture) {
                    return cached.texture;
                }
                if (!cached && window.LayerSystem?.loadImageTexture) {
                    window.LayerSystem.loadImageTexture(cacheKey);
                }
            }
        }
        return this.blackTexture;
    },

    renderLayer(layer, layerFBO, currentTime) {
        const gl = state.gl;
        if (!gl || !this.initialized) return;

        const sc = state.scanimate;

        if (!sc.enabled) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
            gl.viewport(0, 0, layerFBO.width, layerFBO.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return;
        }

        const tempFBO = FramebufferManager.scanimateTempFBO;
        const tempFBO2 = FramebufferManager.scanimateTempFBO2;
        const feedbackFBO = FramebufferManager.scanimateFeedbackFBO;
        const feedbackFBO2 = FramebufferManager.scanimateFeedbackFBO2;

        if (!tempFBO || !tempFBO2 || !feedbackFBO || !feedbackFBO2) return;

        const sourceTexture = this._resolveSourceTexture(layer);
        const osc = this._computeOscillators(currentTime);
        const po = this._evaluatePatchBay(osc.rawSines);

        for (let i = 0; i < 8; i++) {
            osc.values[i] = Math.sin(osc.phases[i]) * Math.max(0, sc.oscillators[i].amplitude + po.oscAmp[i]);
        }

        const def = sc.deflection;
        const col = sc.colorizer;
        const fb = sc.feedback;
        const crt = sc.crt;

        const deflectionX = po.deflectionX;
        const deflectionY = po.deflectionY;
        const rotation = def.rotation + po.rotation;
        const barrelAmount = Math.max(0, def.barrelAmount + po.barrel);
        const segmentShift = po.segmentShift;
        const colorCycle = currentTime * sc.speed * col.colorCycleSpeed + po.colorCycle;
        const brightnessBoost = Math.max(0, col.brightnessBoost + po.brightnessBoost);
        const scanlineIntensity = Math.max(0, crt.scanlineIntensity + po.scanlineIntensity);
        const glowAmount = Math.max(0, crt.glowAmount + po.glowAmount);
        const chromaticAmount = Math.max(0, crt.chromaticAmount + po.chromaticAmount);
        const vignetteAmount = Math.max(0, crt.vignetteAmount + po.vignetteAmount);
        const feedbackAmount = fb.enabled ? Math.max(0, Math.min(1, fb.amount + po.feedbackAmount)) : 1.0;
        const feedbackDecay = fb.enabled ? fb.decay : 1.0;

        // Pass 1: Deflect → tempFBO
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO.fbo);
        gl.viewport(0, 0, tempFBO.width, tempFBO.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.deflectProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.uniform1i(this.locs.deflect.u_source, 0);
        gl.uniform2f(this.locs.deflect.u_resolution, tempFBO.width, tempFBO.height);
        gl.uniform1f(this.locs.deflect.u_time, currentTime);
        gl.uniform1f(this.locs.deflect.u_speed, sc.speed);
        gl.uniform1f(this.locs.deflect.u_deflectionX, deflectionX);
        gl.uniform1f(this.locs.deflect.u_deflectionY, deflectionY);
        gl.uniform1f(this.locs.deflect.u_rotation, rotation);
        gl.uniform1f(this.locs.deflect.u_barrelAmount, barrelAmount);
        gl.uniform1i(this.locs.deflect.u_segmentCount, def.segmentCount);
        if (this.locs.deflect.u_segmentThresholds) {
            gl.uniform1fv(this.locs.deflect.u_segmentThresholds, new Float32Array(def.segmentThresholds));
        }
        if (this.locs.deflect.u_segmentDepthMultipliers) {
            gl.uniform1fv(this.locs.deflect.u_segmentDepthMultipliers, new Float32Array(def.segmentDepthMultipliers));
        }
        gl.uniform1i(this.locs.deflect.u_domainWarpIterations, def.domainWarpIterations);
        if (this.locs.deflect.u_oscValue) {
            gl.uniform1fv(this.locs.deflect.u_oscValue, osc.values);
        }
        gl.uniform1f(this.locs.deflect.u_waveXDepth, def.waveXDepth);
        gl.uniform1f(this.locs.deflect.u_waveYDepth, def.waveYDepth);
        if (this.locs.deflect.u_segmentShift) {
            gl.uniform1f(this.locs.deflect.u_segmentShift, segmentShift);
        }
        this._drawQuad(this.locs.deflect.pos);

        // Pass 2: Colorize → tempFBO2
        gl.bindFramebuffer(gl.FRAMEBUFFER, tempFBO2.fbo);
        gl.viewport(0, 0, tempFBO2.width, tempFBO2.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.colorizeProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tempFBO.texture);
        gl.uniform1i(this.locs.colorize.u_source, 0);
        gl.uniform1i(this.locs.colorize.u_colorizerEnabled, col.enabled ? 1 : 0);
        const cA = hexToRgb(col.colorA);
        const cB = hexToRgb(col.colorB);
        const cC = hexToRgb(col.colorC);
        gl.uniform3f(this.locs.colorize.u_colorA, cA[0], cA[1], cA[2]);
        gl.uniform3f(this.locs.colorize.u_colorB, cB[0], cB[1], cB[2]);
        gl.uniform3f(this.locs.colorize.u_colorC, cC[0], cC[1], cC[2]);
        gl.uniform1f(this.locs.colorize.u_colorCycle, colorCycle);
        gl.uniform1f(this.locs.colorize.u_brightnessBoost, brightnessBoost);
        this._drawQuad(this.locs.colorize.pos);

        let crtSourceTexture;

        if (fb.enabled) {
            // Pass 3: Feedback → feedbackFBO2
            gl.bindFramebuffer(gl.FRAMEBUFFER, feedbackFBO2.fbo);
            gl.viewport(0, 0, feedbackFBO2.width, feedbackFBO2.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.useProgram(this.feedbackProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tempFBO2.texture);
            gl.uniform1i(this.locs.feedback.u_currentFrame, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, feedbackFBO.texture);
            gl.uniform1i(this.locs.feedback.u_lastFrame, 1);
            gl.uniform1f(this.locs.feedback.u_feedbackAmount, feedbackAmount);
            gl.uniform1f(this.locs.feedback.u_decay, feedbackDecay);
            this._drawQuad(this.locs.feedback.pos);

            // Ping-pong swap for next frame
            FramebufferManager.scanimateFeedbackFBO = feedbackFBO2;
            FramebufferManager.scanimateFeedbackFBO2 = feedbackFBO;

            crtSourceTexture = feedbackFBO2.texture;
        } else {
            crtSourceTexture = tempFBO2.texture;
        }

        // Pass 4: CRT → layerFBO (outputFBO no longer needed in pipeline)
        gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
        gl.viewport(0, 0, layerFBO.width, layerFBO.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.crtProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, crtSourceTexture);
        gl.uniform1i(this.locs.crt.u_source, 0);
        gl.uniform2f(this.locs.crt.u_resolution, layerFBO.width, layerFBO.height);
        gl.uniform1i(this.locs.crt.u_scanlinesEnabled, crt.scanlinesEnabled ? 1 : 0);
        gl.uniform1f(this.locs.crt.u_scanlineIntensity, scanlineIntensity);
        gl.uniform1i(this.locs.crt.u_glowEnabled, crt.glowEnabled ? 1 : 0);
        gl.uniform1f(this.locs.crt.u_glowAmount, glowAmount);
        gl.uniform1i(this.locs.crt.u_chromaticEnabled, crt.chromaticEnabled ? 1 : 0);
        gl.uniform1f(this.locs.crt.u_chromaticAmount, chromaticAmount);
        gl.uniform1i(this.locs.crt.u_vignetteEnabled, crt.vignetteEnabled ? 1 : 0);
        gl.uniform1f(this.locs.crt.u_vignetteAmount, vignetteAmount);
        this._drawQuad(this.locs.crt.pos);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
};
