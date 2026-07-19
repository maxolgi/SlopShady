/**
 * Framebuffer Manager
 * Handles WebGL framebuffer creation and management
 */

import { state } from '../state.js';

const CANDIDATE_FORMATS = [
    { key: 'rgba8',   internalFormat: 'RGBA8',            type: 'UNSIGNED_BYTE',                   bpp: 4,  needsFloatLinear: false, label: 'RGBA8 (8-bit)' },
    { key: 'rgba4',   internalFormat: 'RGBA4',            type: 'UNSIGNED_SHORT_4_4_4_4',          bpp: 2,  needsFloatLinear: false, label: 'RGBA4 (4-bit)' },
    { key: 'rgb5a1',  internalFormat: 'RGB5_A1',          type: 'UNSIGNED_SHORT_5_5_5_1',          bpp: 2,  needsFloatLinear: false, label: 'RGB5_A1 (5-5-5-1)' },
    { key: 'rgb10a2', internalFormat: 'RGB10_A2',         type: 'UNSIGNED_INT_2_10_10_10_REV',     bpp: 4,  needsFloatLinear: false, label: 'RGB10_A2 (10-10-10-2)' },
    { key: 'srgb8a8', internalFormat: 'SRGB8_ALPHA8',     type: 'UNSIGNED_BYTE',                   bpp: 4,  needsFloatLinear: false, label: 'sRGB8_A8 (gamma)' },
    { key: 'rgba16f', internalFormat: 'RGBA16F',          type: 'HALF_FLOAT',                      bpp: 8,  needsFloatLinear: false, label: 'RGBA16F (half-float)' },
    { key: 'rgba32f', internalFormat: 'RGBA32F',          type: 'FLOAT',                           bpp: 16, needsFloatLinear: true,  label: 'RGBA32F (float)' },
];

export const FramebufferManager = {
    fbos: [],
    compositeFBO: null,
    compositeFBO2: null,
    feedbackFBO: null,
    feedbackFBO2: null,
    layerFeedbackFBOs: [],
    layerFeedbackFBOs2: [],
    scanimateTempFBO: null,
    scanimateTempFBO2: null,
    scanimateFeedbackFBO: null,
    scanimateFeedbackFBO2: null,
    scanimateOutputFBO: null,
    currentWidth: 0,
    currentHeight: 0,
    formatTable: CANDIDATE_FORMATS,

    probeFormats() {
        const gl = state.gl;
        if (!gl) return;

        const supported = {};
        for (const fmt of CANDIDATE_FORMATS) {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl[fmt.internalFormat], 1, 1, 0, gl.RGBA, gl[fmt.type], null);

            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            supported[fmt.key] = (status === gl.FRAMEBUFFER_COMPLETE);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(fbo);
            gl.deleteTexture(tex);
        }

        state.supportedFormats = supported;

        if (!supported[state.fboFormat]) {
            state.fboFormat = 'rgba8';
        }
    },

    _getFormatSpec() {
        const fmt = CANDIDATE_FORMATS.find(f => f.key === state.fboFormat);
        if (!fmt) return CANDIDATE_FORMATS[0];
        return fmt;
    },

    _createFBO(width, height) {
        const gl = state.gl;
        if (!gl) return null;

        const fmt = this._getFormatSpec();

        if (!state.supportedFormats[fmt.key]) {
            const fallback = CANDIDATE_FORMATS[0];
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl[fallback.internalFormat], width, height, 0, gl.RGBA, gl[fallback.type], null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return { fbo, texture, width, height };
        }

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl[fmt.internalFormat], width, height, 0, gl.RGBA, gl[fmt.type], null);

        const needsNearest = fmt.needsFloatLinear && !state.glExtensions.floatLinear;
        const filter = needsNearest ? gl.NEAREST : gl.LINEAR;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteTexture(texture);
            gl.deleteFramebuffer(fbo);
            return null;
        }
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        
        return { fbo, texture, width, height };
    },
    
    init(width, height) {
        width = Math.max(1, width);
        height = Math.max(1, height);
        
        this.destroy();
        
        this.currentWidth = width;
        this.currentHeight = height;
        
        // Create 8 layer FBOs
        this.fbos = [];
        for (let i = 0; i < 8; i++) {
            const fboObj = this._createFBO(width, height);
            if (!fboObj) {
                console.warn(`FramebufferManager: Layer FBO ${i} creation failed`);
            }
            this.fbos.push(fboObj);
        }
        
        // Create ping-pong composite pair
        this.compositeFBO = this._createFBO(width, height);
        this.compositeFBO2 = this._createFBO(width, height);
        
        // Create dedicated feedback ping-pong pair (separate from composite)
        this.feedbackFBO = this._createFBO(width, height);
        this.feedbackFBO2 = this._createFBO(width, height);

        // Create per-layer feedback ping-pong pairs (lazy — null until needed)
        this.layerFeedbackFBOs = new Array(8).fill(null);
        this.layerFeedbackFBOs2 = new Array(8).fill(null);

        this.scanimateTempFBO = this._createFBO(width, height);
        this.scanimateTempFBO2 = this._createFBO(width, height);
        this.scanimateFeedbackFBO = this._createFBO(width, height);
        this.scanimateFeedbackFBO2 = this._createFBO(width, height);
        this.scanimateOutputFBO = this._createFBO(width, height);

        this._clearFBO(this.scanimateTempFBO);
        this._clearFBO(this.scanimateTempFBO2);
        this._clearFBO(this.scanimateFeedbackFBO);
        this._clearFBO(this.scanimateFeedbackFBO2);
        this._clearFBO(this.scanimateOutputFBO);

        if (!this.compositeFBO || !this.compositeFBO2) {
            console.warn('FramebufferManager: Composite FBOs not created');
        }
        if (!this.feedbackFBO || !this.feedbackFBO2) {
            console.warn('FramebufferManager: Feedback FBOs not created');
        }
    },
    
    _clearFBO(fbo) {
        if (!fbo) return;
        const gl = state.gl;
        if (!gl) return;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
        gl.viewport(0, 0, fbo.width, fbo.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    
    getLayerFBO(index) {
        if (index < 0 || index >= this.fbos.length) {
            return null;
        }
        return this.fbos[index];
    },

    ensureLayerFeedbackFBOs(index) {
        if (index < 0 || index >= 8) return;
        if (this.layerFeedbackFBOs[index] && this.layerFeedbackFBOs2[index]) return;

        const w = this.currentWidth || 1;
        const h = this.currentHeight || 1;
        this.layerFeedbackFBOs[index] = this._createFBO(w, h);
        this.layerFeedbackFBOs2[index] = this._createFBO(w, h);
    },

    destroyLayerFeedbackFBOs(index) {
        const gl = state.gl;
        if (index < 0 || index >= 8 || !gl) return;

        for (const arr of [this.layerFeedbackFBOs, this.layerFeedbackFBOs2]) {
            const fbo = arr[index];
            if (fbo) {
                if (fbo.fbo) gl.deleteFramebuffer(fbo.fbo);
                if (fbo.texture) gl.deleteTexture(fbo.texture);
            }
            arr[index] = null;
        }
    },
    
    resize(width, height) {
        width = Math.max(1, width);
        height = Math.max(1, height);
        
        if (width === this.currentWidth && height === this.currentHeight) return;
        
        this.init(width, height);
    },
    
    destroy() {
        const gl = state.gl;
        if (!gl) return;
        
        for (const fboObj of this.fbos) {
            if (fboObj) {
                if (fboObj.fbo) gl.deleteFramebuffer(fboObj.fbo);
                if (fboObj.texture) gl.deleteTexture(fboObj.texture);
            }
        }
        this.fbos = [];
        
        if (this.compositeFBO) {
            if (this.compositeFBO.fbo) gl.deleteFramebuffer(this.compositeFBO.fbo);
            if (this.compositeFBO.texture) gl.deleteTexture(this.compositeFBO.texture);
            this.compositeFBO = null;
        }
        if (this.compositeFBO2) {
            if (this.compositeFBO2.fbo) gl.deleteFramebuffer(this.compositeFBO2.fbo);
            if (this.compositeFBO2.texture) gl.deleteTexture(this.compositeFBO2.texture);
            this.compositeFBO2 = null;
        }
        
        // Clean up feedback FBOs
        if (this.feedbackFBO) {
            if (this.feedbackFBO.fbo) gl.deleteFramebuffer(this.feedbackFBO.fbo);
            if (this.feedbackFBO.texture) gl.deleteTexture(this.feedbackFBO.texture);
            this.feedbackFBO = null;
        }
        if (this.feedbackFBO2) {
            if (this.feedbackFBO2.fbo) gl.deleteFramebuffer(this.feedbackFBO2.fbo);
            if (this.feedbackFBO2.texture) gl.deleteTexture(this.feedbackFBO2.texture);
            this.feedbackFBO2 = null;
        }
        
        // Clean up per-layer feedback FBOs
        for (let i = 0; i < this.layerFeedbackFBOs.length; i++) {
            const fbo = this.layerFeedbackFBOs[i];
            if (fbo) {
                if (fbo.fbo) gl.deleteFramebuffer(fbo.fbo);
                if (fbo.texture) gl.deleteTexture(fbo.texture);
            }
        }
        this.layerFeedbackFBOs = new Array(8).fill(null);

        for (let i = 0; i < this.layerFeedbackFBOs2.length; i++) {
            const fbo = this.layerFeedbackFBOs2[i];
            if (fbo) {
                if (fbo.fbo) gl.deleteFramebuffer(fbo.fbo);
                if (fbo.texture) gl.deleteTexture(fbo.texture);
            }
        }
        this.layerFeedbackFBOs2 = new Array(8).fill(null);

        // Clean up scanimate FBOs
        for (const key of ['scanimateTempFBO', 'scanimateTempFBO2', 'scanimateFeedbackFBO', 'scanimateFeedbackFBO2', 'scanimateOutputFBO']) {
            const fbo = this[key];
            if (fbo) {
                if (fbo.fbo) gl.deleteFramebuffer(fbo.fbo);
                if (fbo.texture) gl.deleteTexture(fbo.texture);
            }
            this[key] = null;
        }

        this.currentWidth = 0;
        this.currentHeight = 0;
    }
};
