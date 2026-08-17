/**
 * VisualBrain Engine
 * GPU-accelerated concatenative visual synthesis inspired by SampleBrain.
 * 3-pass pipeline: Feature Extraction (MRT) → Block Matching → Render
 * Applied as a per-layer post-processing effect.
 */

import { state } from '../state.js';
import { compileUtilityProgram } from '../utils.js';
import {
    VB_FEATURE_VS, VB_FEATURE_FS,
    VB_MATCH_FS, VB_RENDER_FS,
    COMPOSITE_VS
} from '../config.js';

const MAX_CORPUS = 4096;
const FDIM = 6;
const ATLAS_GRID = 64;
const SEED_COUNT = 600;

function createTex(gl, w, h, filter, wrap) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (w > 0 && h > 0) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    return t;
}

function createFBO(gl, w, h) {
    const tex = createTex(gl, w, h, gl.LINEAR, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, texture: tex, width: w, height: h };
}

export const VisualBrain = {
    initialized: false,
    featureProgram: null,
    matchProgram: null,
    renderProgram: null,

    featureFBO: null,
    featureTex0: null,
    featureTex1: null,

    matchFBO: null,
    matchTex: null,

    brainTempFBO: null,

    corpusFeatureTex0: null,
    corpusFeatureTex1: null,
    atlasTex: null,

    corpusFeatures: null,
    corpusCount: 0,
    atlasDirty: true,
    corpusFeaturesDirty: true,
    _frameCount: 0,
    _cachedGridW: 0,
    _cachedGridH: 0,
    _cachedFBOW: 0,
    _cachedFBOH: 0,
    _atlasBlockSize: 0,

    locs: { feature: {}, match: {}, render: {} },

    init() {
        const gl = state.gl;
        if (!gl) return;

        this.featureProgram = compileUtilityProgram(gl, VB_FEATURE_FS, VB_FEATURE_VS);
        this.matchProgram = compileUtilityProgram(gl, VB_MATCH_FS, VB_FEATURE_VS);
        this.renderProgram = compileUtilityProgram(gl, VB_RENDER_FS, VB_FEATURE_VS);

        if (!this.featureProgram || !this.matchProgram || !this.renderProgram) {
            return;
        }

        this._cacheUniformLocs(gl);

        this.corpusFeatures = new Float32Array(MAX_CORPUS * FDIM);

        this.initialized = true;
 
    },

    _cacheUniformLocs(gl) {
        const fu = (prog, names) => {
            const o = {};
            names.forEach(n => o[n] = gl.getUniformLocation(prog, n));
            return o;
        };
        this.locs.feature = fu(this.featureProgram, [
            'uInput', 'uResolution', 'uBlockSize', 'uGridSize'
        ]);
        this.locs.match = fu(this.matchProgram, [
            'uInputFeatures0', 'uInputFeatures1',
            'uCorpusFeatures0', 'uCorpusFeatures1',
            'uCorpusCount', 'uColorWeight'
        ]);
        this.locs.render = fu(this.renderProgram, [
            'uVideo', 'uAtlas', 'uMatchMap', 'uAudioTex',
            'uResolution', 'uGridSize', 'uBlockSize', 'uAtlasGridSize',
            'uTime', 'uBlend', 'uGrid', 'uScanline', 'uGlitch',
            'uAudioReact', 'uCorpusCount', 'uBrightness'
        ]);
    },

    _ensureTextures(gl, gridW, gridH, canvasW, canvasH) {
        const gridChanged = (gridW !== this._cachedGridW || gridH !== this._cachedGridH);
        const sizeChanged = (canvasW !== this._cachedFBOW || canvasH !== this._cachedFBOH);

        if (!this.featureTex0 || gridChanged) {
            if (this.featureFBO) gl.deleteFramebuffer(this.featureFBO);
            if (this.featureTex0) gl.deleteTexture(this.featureTex0);
            if (this.featureTex1) gl.deleteTexture(this.featureTex1);

            this.featureTex0 = createTex(gl, gridW, gridH, gl.NEAREST, gl.CLAMP_TO_EDGE);
            this.featureTex1 = createTex(gl, gridW, gridH, gl.NEAREST, gl.CLAMP_TO_EDGE);

            this.featureFBO = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.featureFBO);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.featureTex0, 0);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.featureTex1, 0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            this._cachedGridW = gridW;
            this._cachedGridH = gridH;
        }

        if (!this.matchTex || gridChanged) {
            if (this.matchFBO) gl.deleteFramebuffer(this.matchFBO);
            if (this.matchTex) gl.deleteTexture(this.matchTex);

            this.matchTex = createTex(gl, gridW, gridH, gl.NEAREST, gl.CLAMP_TO_EDGE);
            this.matchFBO = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.matchFBO);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.matchTex, 0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        if (!this.brainTempFBO || sizeChanged) {
            if (this.brainTempFBO) {
                gl.deleteFramebuffer(this.brainTempFBO.fbo);
                gl.deleteTexture(this.brainTempFBO.texture);
            }
            this.brainTempFBO = createFBO(gl, canvasW, canvasH);
            this._cachedFBOW = canvasW;
            this._cachedFBOH = canvasH;
        }

        if (!this.corpusFeatureTex0) {
            this.corpusFeatureTex0 = createTex(gl, MAX_CORPUS, 1, gl.NEAREST, gl.CLAMP_TO_EDGE);
            this.corpusFeatureTex1 = createTex(gl, MAX_CORPUS, 1, gl.NEAREST, gl.CLAMP_TO_EDGE);
        }

        this._ensureAtlasTex(gl);
    },

    _ensureAtlasTex(gl) {
        const bs = state.visualBrain.blockSize;
        if (!this.atlasTex || this._atlasBlockSize !== bs) {
            if (this.atlasTex) gl.deleteTexture(this.atlasTex);
            this.atlasTex = createTex(gl, ATLAS_GRID * bs, ATLAS_GRID * bs, gl.NEAREST, gl.CLAMP_TO_EDGE);
            this._atlasBlockSize = bs;
        }
    },

    _bindQuad(gl) {
        const buf = state.quadBuffer;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    },

    _drawQuad(gl) {
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    _getGridDims() {
        const cw = state.canvas.width;
        const ch = state.canvas.height;
        const bs = state.visualBrain.blockSize;
        return [Math.floor(cw / bs), Math.floor(ch / bs)];
    },

    processLayer(layer, layerFBO, currentTime) {
        const gl = state.gl;
        if (!gl || !this.initialized) return;
        if (this.corpusCount === 0) return;

        const bs = state.visualBrain.blockSize;
        const cw = layerFBO.width;
        const ch = layerFBO.height;
        const [gridW, gridH] = this._getGridDims();
        if (gridW < 1 || gridH < 1) return;

        this._ensureTextures(gl, gridW, gridH, cw, ch);
        this._frameCount++;

        this._passFeatureExtraction(gl, layerFBO.texture, gridW, gridH, bs, cw, ch);

        if (this.corpusFeaturesDirty) this._uploadCorpusFeatures(gl);

        this._passBlockMatching(gl, gridW, gridH);

        if (state.visualBrain.isRecording && this._frameCount % 8 === 0) {
            this._recordBlocks(gl, layerFBO.texture, gridW, gridH, bs, cw, ch);
        }

        this._passRender(gl, this.brainTempFBO, layerFBO.texture, gridW, gridH, bs, cw, ch, currentTime, layer.brightness || 1.0);

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.brainTempFBO.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, layerFBO.fbo);
        gl.blitFramebuffer(0, 0, cw, ch, 0, 0, cw, ch, gl.COLOR_BUFFER_BIT, gl.LINEAR);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    },

    _passFeatureExtraction(gl, inputTex, gridW, gridH, bs, canvasW, canvasH) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.featureFBO);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        gl.viewport(0, 0, gridW, gridH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.featureProgram);
        this._bindQuad(gl);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTex);
        gl.uniform1i(this.locs.feature.uInput, 0);
        gl.uniform2f(this.locs.feature.uResolution, canvasW, canvasH);
        gl.uniform1f(this.locs.feature.uBlockSize, bs);
        gl.uniform2f(this.locs.feature.uGridSize, gridW, gridH);

        this._drawQuad(gl);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    },

    _passBlockMatching(gl, gridW, gridH) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.matchFBO);
        gl.viewport(0, 0, gridW, gridH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.matchProgram);
        this._bindQuad(gl);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.featureTex0);
        gl.uniform1i(this.locs.match.uInputFeatures0, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.featureTex1);
        gl.uniform1i(this.locs.match.uInputFeatures1, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.corpusFeatureTex0);
        gl.uniform1i(this.locs.match.uCorpusFeatures0, 2);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this.corpusFeatureTex1);
        gl.uniform1i(this.locs.match.uCorpusFeatures1, 3);

        gl.uniform1i(this.locs.match.uCorpusCount, this.corpusCount);
        gl.uniform1f(this.locs.match.uColorWeight, state.visualBrain.colorWeight);

        this._drawQuad(gl);
    },

    _passRender(gl, outputFBO, inputTex, gridW, gridH, bs, canvasW, canvasH, time, brightness) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, outputFBO.fbo);
        gl.viewport(0, 0, outputFBO.width, outputFBO.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.renderProgram);
        this._bindQuad(gl);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTex);
        gl.uniform1i(this.locs.render.uVideo, 0);

        if (this.atlasDirty) this._uploadAtlas(gl);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
        gl.uniform1i(this.locs.render.uAtlas, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.matchTex);
        gl.uniform1i(this.locs.render.uMatchMap, 2);

        if (state.audioSpectrumTexture) {
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, state.audioSpectrumTexture);
        }
        gl.uniform1i(this.locs.render.uAudioTex, 3);

        gl.uniform2f(this.locs.render.uResolution, canvasW, canvasH);
        gl.uniform2f(this.locs.render.uGridSize, gridW, gridH);
        gl.uniform1f(this.locs.render.uBlockSize, bs);
        gl.uniform2f(this.locs.render.uAtlasGridSize, ATLAS_GRID, ATLAS_GRID);
        gl.uniform1f(this.locs.render.uTime, time);
        gl.uniform1f(this.locs.render.uBlend, state.visualBrain.blendAmount);
        gl.uniform1f(this.locs.render.uGrid, state.visualBrain.showGrid ? 1.0 : 0.0);
        gl.uniform1f(this.locs.render.uScanline, state.visualBrain.showScanline ? 1.0 : 0.0);
        gl.uniform1f(this.locs.render.uGlitch, state.visualBrain.glitchAmount);
        gl.uniform1f(this.locs.render.uAudioReact,
            state.visualBrain.audioEnabled ? state.visualBrain.audioDrive : 0.0);
        gl.uniform1f(this.locs.render.uCorpusCount, this.corpusCount);
        gl.uniform1f(this.locs.render.uBrightness, brightness);

        this._drawQuad(gl);
    },

    _extractFeaturesCPU(imageData, bx, by, bs) {
        const d = imageData.data;
        const w = imageData.width;
        let r = 0, g = 0, b = 0, cnt = 0;
        const step = Math.max(1, Math.floor(bs / 6));
        for (let dy = 0; dy < bs; dy += step) {
            for (let dx = 0; dx < bs; dx += step) {
                const idx = ((by + dy) * w + (bx + dx)) * 4;
                r += d[idx]; g += d[idx + 1]; b += d[idx + 2];
                cnt++;
            }
        }
        if (cnt === 0) return [0, 0, 0, 0, 0, 0];
        r /= cnt; g /= cnt; b /= cnt;
        const meanLum = 0.299 * r + 0.587 * g + 0.114 * b;
        let variance = 0, edgeH = 0, edgeV = 0, edgeCnt = 0;
        for (let dy = 0; dy < bs; dy += step) {
            for (let dx = 0; dx < bs; dx += step) {
                const idx = ((by + dy) * w + (bx + dx)) * 4;
                const lum = 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
                variance += (lum - meanLum) * (lum - meanLum);
                if (dx + step < bs) {
                    const idx2 = ((by + dy) * w + (bx + dx + step)) * 4;
                    edgeH += Math.abs(0.299 * d[idx2] + 0.587 * d[idx2 + 1] + 0.114 * d[idx2 + 2] - lum);
                }
                if (dy + step < bs) {
                    const idx3 = ((by + dy + step) * w + (bx + dx)) * 4;
                    edgeV += Math.abs(0.299 * d[idx3] + 0.587 * d[idx3 + 1] + 0.114 * d[idx3 + 2] - lum);
                }
                edgeCnt++;
            }
        }
        variance /= cnt;
        edgeH /= Math.max(1, edgeCnt);
        edgeV /= Math.max(1, edgeCnt);
        return [
            r / 255, g / 255, b / 255,
            Math.min(1, variance / 3000),
            Math.min(1, edgeH / 60),
            Math.min(1, edgeV / 60)
        ];
    },

    _recordBlocks(gl, inputTex, gridW, gridH, bs, canvasW, canvasH) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.featureFBO);
        const fdata0 = new Uint8Array(gridW * gridH * 4);
        const fdata1 = new Uint8Array(gridW * gridH * 4);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.UNSIGNED_BYTE, fdata0);
        gl.readBuffer(gl.COLOR_ATTACHMENT1);
        gl.readPixels(0, 0, gridW, gridH, gl.RGBA, gl.UNSIGNED_BYTE, fdata1);

        const frameBuffer = new Uint8Array(canvasW * canvasH * 4);
        const tmpFBO = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, tmpFBO);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, inputTex, 0);
        gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, frameBuffer);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(tmpFBO);

        for (let by = 0; by < gridH; by += 2) {
            for (let bx = 0; bx < gridW; bx += 2) {
                if (this.corpusCount >= MAX_CORPUS) return;
                const ci = by * gridW + bx;
                const f0r = fdata0[ci * 4] / 255, f0g = fdata0[ci * 4 + 1] / 255;
                const f0b = fdata0[ci * 4 + 2] / 255, f0a = fdata0[ci * 4 + 3] / 255;
                const f1r = fdata1[ci * 4] / 255, f1g = fdata1[ci * 4 + 1] / 255;
                const features = [f0r, f0g, f0b, f0a, f1r, f1g];

                let tooSimilar = false;
                const checkStart = Math.max(0, this.corpusCount - 40);
                for (let c = checkStart; c < this.corpusCount; c++) {
                    const off = c * FDIM;
                    const dr = features[0] - this.corpusFeatures[off];
                    const dg = features[1] - this.corpusFeatures[off + 1];
                    const db = features[2] - this.corpusFeatures[off + 2];
                    if (dr * dr + dg * dg + db * db < 0.0008) { tooSimilar = true; break; }
                }
                if (tooSimilar) continue;

                this.corpusFeatures.set(features, this.corpusCount * FDIM);
                this._blitBlockToAtlas(gl, frameBuffer, canvasW, canvasH, bx * bs, by * bs, bs, this.corpusCount);
                this.corpusCount++;
            }
        }
        this.corpusFeaturesDirty = true;
        state.visualBrain.corpusCount = this.corpusCount;
    },

    _blitBlockToAtlas(gl, frameBuf, srcW, srcH, sx, sy, bs, corpusIdx) {
        const ax = (corpusIdx % ATLAS_GRID) * bs;
        const ay = Math.floor(corpusIdx / ATLAS_GRID) * bs;

        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = bs;
        tmpCanvas.height = bs;
        const tc = tmpCanvas.getContext('2d');
        const blockData = tc.createImageData(bs, bs);
        for (let dy = 0; dy < bs; dy++) {
            for (let dx = 0; dx < bs; dx++) {
                const si = ((sy + dy) * srcW + (sx + dx)) * 4;
                const di = (dy * bs + dx) * 4;
                blockData.data[di] = frameBuf[si];
                blockData.data[di + 1] = frameBuf[si + 1];
                blockData.data[di + 2] = frameBuf[si + 2];
                blockData.data[di + 3] = frameBuf[si + 3];
            }
        }
        tc.putImageData(blockData, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, ax, ay, bs, bs, gl.RGBA, gl.UNSIGNED_BYTE, tmpCanvas);
    },

    _uploadCorpusFeatures(gl) {
        const data0 = new Uint8Array(MAX_CORPUS * 4);
        const data1 = new Uint8Array(MAX_CORPUS * 4);
        for (let i = 0; i < this.corpusCount; i++) {
            const off = i * FDIM;
            const f = this.corpusFeatures;
            data0[i * 4] = Math.round(f[off] * 255);
            data0[i * 4 + 1] = Math.round(f[off + 1] * 255);
            data0[i * 4 + 2] = Math.round(f[off + 2] * 255);
            data0[i * 4 + 3] = Math.round(f[off + 3] * 255);
            data1[i * 4] = Math.round(f[off + 4] * 255);
            data1[i * 4 + 1] = Math.round(f[off + 5] * 255);
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.corpusFeatureTex0);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.corpusCount, 1, gl.RGBA, gl.UNSIGNED_BYTE, data0);

        gl.bindTexture(gl.TEXTURE_2D, this.corpusFeatureTex1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.corpusCount, 1, gl.RGBA, gl.UNSIGNED_BYTE, data1);

        this.corpusFeaturesDirty = false;
    },

    _uploadAtlas(gl) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
        this.atlasDirty = false;
    },

    seedCorpus() {
        this.clearCorpus();
        const bs = state.visualBrain.blockSize;
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = bs;
        tmpCanvas.height = bs;
        const tc = tmpCanvas.getContext('2d');
        const gl = state.gl;
        this._ensureAtlasTex(gl);

        for (let i = 0; i < SEED_COUNT && this.corpusCount < MAX_CORPUS; i++) {
            tc.clearRect(0, 0, bs, bs);
            const type = i % 11;

            if (type < 2) {
                tc.fillStyle = `hsl(${Math.random()*360},${40+Math.random()*60}%,${20+Math.random()*60}%)`;
                tc.fillRect(0, 0, bs, bs);
            } else if (type < 4) {
                const h1 = Math.random() * 360, h2 = Math.random() * 360;
                const ang = Math.random() * Math.PI;
                const g = tc.createLinearGradient(
                    bs/2+Math.cos(ang)*bs/2, bs/2+Math.sin(ang)*bs/2,
                    bs/2-Math.cos(ang)*bs/2, bs/2-Math.sin(ang)*bs/2
                );
                g.addColorStop(0, `hsl(${h1},70%,50%)`);
                g.addColorStop(1, `hsl(${h2},70%,50%)`);
                tc.fillStyle = g;
                tc.fillRect(0, 0, bs, bs);
            } else if (type < 5) {
                const h = Math.random() * 360;
                const g2 = tc.createRadialGradient(bs/2, bs/2, 0, bs/2, bs/2, bs*0.5);
                g2.addColorStop(0, `hsl(${h},80%,70%)`);
                g2.addColorStop(1, `hsl(${(h+180)%360},60%,20%)`);
                tc.fillStyle = g2;
                tc.fillRect(0, 0, bs, bs);
            } else if (type < 7) {
                const half = bs / 2;
                tc.fillStyle = `hsl(${Math.random()*360},60%,40%)`;
                tc.fillRect(0, 0, bs, bs);
                tc.fillStyle = `hsl(${Math.random()*360},60%,60%)`;
                tc.fillRect(0, 0, half, half);
                tc.fillRect(half, half, half, half);
            } else if (type < 8) {
                tc.fillStyle = `hsl(${Math.random()*360},50%,30%)`;
                tc.fillRect(0, 0, bs, bs);
                tc.fillStyle = `hsl(${Math.random()*360},50%,70%)`;
                for (let s = 0; s < bs; s += 4) tc.fillRect(s, 0, 2, bs);
            } else if (type < 9) {
                const imgD = tc.createImageData(bs, bs);
                const bR = Math.random() * 255, bG = Math.random() * 255, bB = Math.random() * 255;
                for (let p = 0; p < bs * bs; p++) {
                    const n = (Math.random() - 0.5) * 130;
                    imgD.data[p * 4] = Math.max(0, Math.min(255, bR + n));
                    imgD.data[p * 4 + 1] = Math.max(0, Math.min(255, bG + n));
                    imgD.data[p * 4 + 2] = Math.max(0, Math.min(255, bB + n));
                    imgD.data[p * 4 + 3] = 255;
                }
                tc.putImageData(imgD, 0, 0);
            } else if (type < 10) {
                tc.fillStyle = `hsl(${Math.random()*360},65%,45%)`;
                tc.fillRect(0, 0, bs, bs);
                tc.fillStyle = `hsl(${Math.random()*360},65%,55%)`;
                tc.beginPath();
                tc.moveTo(0, 0); tc.lineTo(bs, 0); tc.lineTo(bs, bs); tc.closePath();
                tc.fill();
            } else {
                tc.fillStyle = `hsl(${Math.random()*360},50%,35%)`;
                tc.fillRect(0, 0, bs, bs);
                tc.fillStyle = `hsl(${Math.random()*360},50%,65%)`;
                tc.fillRect(bs*0.2, bs*0.2, bs*0.6, bs*0.6);
                tc.fillStyle = `hsl(${Math.random()*360},50%,35%)`;
                tc.fillRect(bs*0.35, bs*0.35, bs*0.3, bs*0.3);
            }

            const imgData = tc.getImageData(0, 0, bs, bs);
            const features = this._extractFeaturesCPU(imgData, 0, 0, bs);
            this.corpusFeatures.set(features, this.corpusCount * FDIM);

            const ax = (this.corpusCount % ATLAS_GRID) * bs;
            const ay = Math.floor(this.corpusCount / ATLAS_GRID) * bs;
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, ax, ay, bs, bs, gl.RGBA, gl.UNSIGNED_BYTE, tmpCanvas);

            this.corpusCount++;
        }

        this.corpusFeaturesDirty = true;
        this.atlasDirty = false;
        state.visualBrain.corpusCount = this.corpusCount;
        return this.corpusCount;
    },

    clearCorpus() {
        this.corpusCount = 0;
        this.corpusFeatures = new Float32Array(MAX_CORPUS * FDIM);
        this.corpusFeaturesDirty = true;
        this.atlasDirty = true;
        state.visualBrain.corpusCount = 0;

        if (state.gl && this.atlasTex) {
            const gl = state.gl;
            const bs = state.visualBrain.blockSize;
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ATLAS_GRID * bs, ATLAS_GRID * bs, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            this._atlasBlockSize = bs;
        }
    },

    setBlockSize(bs) {
        state.visualBrain.blockSize = bs;
        this._cachedGridW = 0;
        this._cachedGridH = 0;
        this.clearCorpus();
    },

    getCorpusCount() {
        return this.corpusCount;
    },

    getGridDims() {
        return this._getGridDims();
    }
};
