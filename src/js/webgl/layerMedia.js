/**
 * Layer Material Renderers
 * Material-specific rendering methods extracted from layers.js and reattached
 * to LayerSystem via Object.assign at the end of layers.js. All methods are
 * written as normal shorthand methods so `this` binds to LayerSystem when
 * invoked as this.renderImage(...) etc.
 */

import { state } from '../state.js';
import { COMPOSITE_VS, AUDIO_TEXTURE_WAVEFORM_UNIT, AUDIO_TEXTURE_SPECTRUM_UNIT, LAYER_VIDEO_TEXTURE_UNIT, LAYER_IMAGE_TEXTURE_UNIT, LAYER_SRT_TEXTURE_UNIT } from '../config.js';
import { MilkdropFeature } from '../features/milkdrop.js';
import { StreamingInputUI } from '../ui/streaming-input.js';
import { compileUtilityProgram } from '../utils.js';

// Owned media state (reassigned onto LayerSystem at the end of layers.js so
// existing this.imageCache-style access keeps working).
// Image texture cache: { sourceUrl -> { texture, width, height, loading, error } }
const imageCache = new Map();

// Video cache: { sourceUrl -> { video, texture, loading, error, ready } }
const videoCache = new Map();

// Text rasterization cache: { raster-inputs key -> { texture } }. FIFO,
// capped at 9 so every possible text consumer (8 layers + background)
// can stay resident without thrash.
const _textCache = new Map();

export const layerMediaMethods = {
    _drawQuad(posLoc) {
        const gl = state.gl;
        if (!gl || posLoc < 0) return;
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    /**
     * Bind per-layer media textures for layers with shaderMode enabled.
     * Maps media source by layer type:
     *   video  → upload + bind iLayerVideo (unit 5) from params.mediaUrl
     *   image  → bind iLayerImage (unit 6) from params.mediaUrl
     *   websrt → upload latest VideoFrame + bind iLayerSRT (unit 7) from params.inputIndex
     * Also sets u_layerTexRes to the active media texture's resolution.
     */
    _bindLayerMedia(layer) {
        const gl = state.gl;
        if (!gl || !layer) return;
        const params = layer.material?.params;
        if (!params?.shaderMode) return;
        const type = layer.material?.type;

        if (type === 'video' && layer.layerVideoLoc) {
            const url = params.mediaUrl;
            if (!url) return;
            const vd = this._ensureVideoTexture(url, params);
            if (!vd?.texture) return;
            if (vd.ready && vd.video && !vd.video.paused && vd.video.currentTime > 0) {
                this._uploadVideoFrame(vd, vd.video);
            }
            gl.activeTexture(gl.TEXTURE0 + LAYER_VIDEO_TEXTURE_UNIT);
            gl.bindTexture(gl.TEXTURE_2D, vd.texture);
            gl.uniform1i(layer.layerVideoLoc, LAYER_VIDEO_TEXTURE_UNIT);
            if (layer.layerTexResLoc) gl.uniform2f(layer.layerTexResLoc, vd.width, vd.height);
        } else if (type === 'image' && layer.layerImageLoc) {
            const url = params.mediaUrl;
            if (!url) return;
            const id = this._ensureImageTexture(url);
            if (!id?.texture) return;
            gl.activeTexture(gl.TEXTURE0 + LAYER_IMAGE_TEXTURE_UNIT);
            gl.bindTexture(gl.TEXTURE_2D, id.texture);
            gl.uniform1i(layer.layerImageLoc, LAYER_IMAGE_TEXTURE_UNIT);
            if (layer.layerTexResLoc) gl.uniform2f(layer.layerTexResLoc, id.width, id.height);
        } else if (type === 'websrt' && layer.layerSrtLoc) {
            const inputIndex = params.inputIndex;
            if (!Number.isFinite(inputIndex)) return;
            const entry = this._uploadLayerSrtFrame(layer, inputIndex);
            if (!entry) return;
            gl.activeTexture(gl.TEXTURE0 + LAYER_SRT_TEXTURE_UNIT);
            gl.bindTexture(gl.TEXTURE_2D, entry.tex);
            gl.uniform1i(layer.layerSrtLoc, LAYER_SRT_TEXTURE_UNIT);
            if (layer.layerTexResLoc) gl.uniform2f(layer.layerTexResLoc, entry.w || 0, entry.h || 0);
        }
    },

    /**
     * Upload the latest WebSRT VideoFrame for a layer into its per-layer GL
     * texture. Shared by both renderWebSRT (websrt layer type) and
     * _bindLayerMedia (shader-mode layers).
     * @returns {object|null} entry { tex, w, h, lastFrame } or null
     */
    _uploadLayerSrtFrame(layer, inputIndex) {
        const gl = state.gl;
        if (!gl || !Number.isFinite(inputIndex)) return null;
        const frame = StreamingInputUI.latestVideoFrame(inputIndex);
        if (!frame) return null;

        if (!this._websrtTextures) this._websrtTextures = new Map();
        let entry = this._websrtTextures.get(layer.index);
        if (!entry) {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            entry = { tex, w: 0, h: 0, lastFrame: null };
            this._websrtTextures.set(layer.index, entry);
        }

        if (entry.lastFrame !== frame) {
            gl.bindTexture(gl.TEXTURE_2D, entry.tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            const fw = frame.codedWidth || frame.displayWidth || entry.w;
            const fh = frame.codedHeight || frame.displayHeight || entry.h;
            if (fw !== entry.w || fh !== entry.h || entry.w === 0) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
                entry.w = fw;
                entry.h = fh;
            } else {
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame);
            }
            entry.lastFrame = frame;
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        }
        return entry;
    },

    /**
     * Upload the current frame of a cached video element into its GL texture.
     * Reallocates via texImage2D only when the video dimensions changed;
     * texSubImage2D otherwise. Stamped against the render frame counter so
     * the plain-video and shader-mode paths sharing one videoCache entry
     * never upload the same video twice in a frame.
     */
    _uploadVideoFrame(vd, video) {
        const gl = state.gl;
        if (vd.lastUploadFrame === this._frameStamp) return;
        gl.bindTexture(gl.TEXTURE_2D, vd.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        if (video.videoWidth !== vd.uploadW || video.videoHeight !== vd.uploadH || vd.uploadW === 0) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
            vd.uploadW = video.videoWidth;
            vd.uploadH = video.videoHeight;
        } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
        }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        vd.lastUploadFrame = this._frameStamp;
    },

    /**
     * Render audio visualizer material for a layer
     */
    _renderVisualizer(layer, layerFBO, vizConfig, vizTypeKey) {
        const gl = state.gl;
        if (!gl) return;

        // Lazy-compile the visualizer shader (separate from layer.program to avoid conflicts)
        // Use vizTypeKey (e.g., 'waveform') for comparison, not vizConfig.name (e.g., 'Waveform')
        if (!layer._vizProgram || layer._vizTypeKey !== vizTypeKey) {
            // Clean up old program if type changed
            if (layer._vizProgram && layer._vizTypeKey !== vizTypeKey) {
                gl.deleteProgram(layer._vizProgram);
                layer._vizProgram = null;
                layer._vizUniforms = null; // Clear cached uniform locations
            }

            const result = compileUtilityProgram(gl, vizConfig.shader, COMPOSITE_VS);
            if (!result) {
                return;
            }
            layer._vizProgram = result;
            layer._vizTypeKey = vizTypeKey; // Store type key, not display name
            layer._vizType = vizConfig.name; // Keep display name for reference
            layer._vizPosLoc = gl.getAttribLocation(result, 'position');

            // Cache uniform locations for better performance
            layer._vizUniforms = {
                iTime: gl.getUniformLocation(result, 'iTime'),
                iResolution: gl.getUniformLocation(result, 'iResolution'),
                u_audioWaveform: gl.getUniformLocation(result, 'u_audioWaveform'),
                u_audioSpectrum: gl.getUniformLocation(result, 'u_audioSpectrum'),
                u_gain: gl.getUniformLocation(result, 'u_gain'),
                u_thickness: gl.getUniformLocation(result, 'u_thickness'),
                u_color: gl.getUniformLocation(result, 'u_color'),
                u_mode: gl.getUniformLocation(result, 'u_mode'),
                u_freqMax: gl.getUniformLocation(result, 'u_freqMax')
            };
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
        gl.viewport(0, 0, layerFBO.width, layerFBO.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(layer._vizProgram);

        const uniforms = layer._vizUniforms;

        if (uniforms.iTime) gl.uniform1f(uniforms.iTime, state.isPaused ? state.manualTime : (Date.now() - state.startTime) / 1000);
        if (uniforms.iResolution) gl.uniform3f(uniforms.iResolution, layerFBO.width, layerFBO.height, 1.0);

        if (state.audioTextureEnabled && state.audioWaveformTexture && uniforms.u_audioWaveform) {
            gl.activeTexture(gl.TEXTURE0 + AUDIO_TEXTURE_WAVEFORM_UNIT);
            gl.bindTexture(gl.TEXTURE_2D, state.audioWaveformTexture);
            gl.uniform1i(uniforms.u_audioWaveform, AUDIO_TEXTURE_WAVEFORM_UNIT);
        }
        if (state.audioTextureEnabled && state.audioSpectrumTexture && uniforms.u_audioSpectrum) {
            gl.activeTexture(gl.TEXTURE0 + AUDIO_TEXTURE_SPECTRUM_UNIT);
            gl.bindTexture(gl.TEXTURE_2D, state.audioSpectrumTexture);
            gl.uniform1i(uniforms.u_audioSpectrum, AUDIO_TEXTURE_SPECTRUM_UNIT);
        }

        const params = layer.material.params || {};

        // Set uniforms with defaults if not specified
        const gain = (typeof params.gain === 'number') ? params.gain : 1.0;
        const thickness = (typeof params.thickness === 'number') ? params.thickness : 0.02;
        const color = params.color || '#00ffff';
        const mode = (typeof params.mode === 'number') ? params.mode : 0;
        const freqMax = (typeof params.freqMax === 'number') ? params.freqMax : 1.0;

        if (uniforms.u_gain) gl.uniform1f(uniforms.u_gain, gain);
        if (uniforms.u_thickness) gl.uniform1f(uniforms.u_thickness, thickness);
        if (uniforms.u_color) {
            const r = parseInt(color.slice(1, 3), 16) / 255;
            const g = parseInt(color.slice(3, 5), 16) / 255;
            const b = parseInt(color.slice(5, 7), 16) / 255;
            gl.uniform3f(uniforms.u_color, r, g, b);
        }
        if (uniforms.u_mode) gl.uniform1i(uniforms.u_mode, mode);
        if (uniforms.u_freqMax) gl.uniform1f(uniforms.u_freqMax, freqMax);

        this._drawQuad(layer._vizPosLoc);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    /**
     * Render text material to a WebGL texture
     * @param {Layer} layer - The layer with text material
     * @param {object} layerFBO - The framebuffer object to render to
     */
    renderText(layer, layerFBO) {
        const gl = state.gl;
        if (!gl) return;

        const material = layer.material;
        const text = material.source || '';
        const params = material.params || {};

        // Text styling parameters with defaults
        const font = params.font || '48px Arial';
        const color = params.color || '#ffffff';
        const backgroundColor = params.backgroundColor || '#000000';
        const align = params.align || 'center';

        // Create or reuse offscreen canvas
        if (!this.textCanvas) {
            this.textCanvas = document.createElement('canvas');
            this.textCanvas.width = layerFBO.width;
            this.textCanvas.height = layerFBO.height;
            this.textCtx = this.textCanvas.getContext('2d');
        }

        // Resize canvas if framebuffer size changed
        if (this.textCanvas.width !== layerFBO.width || this.textCanvas.height !== layerFBO.height) {
            this.textCanvas.width = layerFBO.width;
            this.textCanvas.height = layerFBO.height;
        }

        // Rasterizing + uploading text is expensive for static content — cache
        // the uploaded texture keyed on every rasterization input ('\u0000'
        // can't appear in any of these values).
        const key = [text, font, color, backgroundColor, align, layerFBO.width, layerFBO.height].join('\u0000');
        let entry = this._textCache.get(key);

        if (!entry) {
            const ctx = this.textCtx;
            const canvas = this.textCanvas;

            // Clear canvas with background color
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Set text properties
            ctx.font = font;
            ctx.fillStyle = color;
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';

            // Calculate text position based on alignment
            let x = canvas.width / 2;
            const y = canvas.height / 2;

            if (align === 'left') {
                x = 20;
            } else if (align === 'right') {
                x = canvas.width - 20;
            }

            // Draw text
            ctx.fillText(text, x, y);

            // Create texture and upload raster
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.bindTexture(gl.TEXTURE_2D, null);

            entry = { texture };
            this._textCache.set(key, entry);

            // Enforce cache size limit
            if (this._textCache.size > 9) {
                const oldestKey = this._textCache.keys().next().value;
                const oldEntry = this._textCache.get(oldestKey);
                if (oldEntry && oldEntry.texture) {
                    gl.deleteTexture(oldEntry.texture);
                }
                this._textCache.delete(oldestKey);
            }
        }

        // Render texture to framebuffer using passthrough shader
        if (this.passthroughProgram) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
            gl.viewport(0, 0, layerFBO.width, layerFBO.height);

            gl.useProgram(this.passthroughProgram);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, entry.texture);
            if (this.passthroughTexLoc) gl.uniform1i(this.passthroughTexLoc, 0);

            this._drawQuad(this.passthroughPosLoc);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
    },

    /**
     * Synchronously ensure an image texture is loading for `source`.
     * Kicks off `loadImageTexture` (fire-and-forget) if not yet cached, then
     * returns the current cache entry (texture may still be null while the
     * image decodes). Used by the synchronous render path so the frame loop
     * never blocks on image decode.
     * @param {string} source - Image URL or data URI
     * @returns {object|null} Cache entry { texture, width, height, loading }
     */
    _ensureImageTexture(source) {
        if (!this.imageCache.has(source)) {
            this.loadImageTexture(source);
        }
        return this.imageCache.get(source) || null;
    },

    /**
     * Synchronously ensure a video texture is loading for `source`.
     * Kicks off `loadVideoTexture` (fire-and-forget) if not yet cached, then
     * returns the current cache entry. The render path updates the GL texture
     * from the video element each frame once `ready` is true.
     * @param {string} source - Video URL
     * @param {object} params - Video parameters
     * @returns {object|null} Cache entry { video, texture, ready, ... }
     */
    _ensureVideoTexture(source, params) {
        if (!this.videoCache.has(source)) {
            this.loadVideoTexture(source, params);
        }
        return this.videoCache.get(source) || null;
    },

    /**
     * Clear a layer FBO to transparent. Used when a media layer's source is
     * still loading so no stale frame is shown.
     * @param {object} fbo - Framebuffer object { fbo, width, height }
     */
    _clearLayerFBO(fbo) {
        const gl = state.gl;
        if (!gl || !fbo) return;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
        gl.viewport(0, 0, fbo.width, fbo.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    /**
     * Load an image and create a WebGL texture
     * @param {string} source - Image URL or data URI
     * @returns {Promise<object>} - Resolves with { texture, width, height }
     */
    async loadImageTexture(source) {
        const gl = state.gl;
        if (!gl) return null;

        // Check cache first
        if (this.imageCache.has(source)) {
            const cached = this.imageCache.get(source);
            if (!cached.loading) {
                return cached;
            }
            if (cached._loadPromise) {
                await cached._loadPromise;
            }
            return cached;
        }

        // Create cache entry
        const cacheEntry = {
            texture: null,
            width: 0,
            height: 0,
            loading: true,
            error: null
        };
        let resolveLoad;
        cacheEntry._loadPromise = new Promise(r => { resolveLoad = r; });
        this.imageCache.set(source, cacheEntry);

        // Enforce cache size limit
        if (this.imageCache.size > 50) {
            const firstKey = this.imageCache.keys().next().value;
            const oldEntry = this.imageCache.get(firstKey);
            if (oldEntry && oldEntry.texture) {
                gl.deleteTexture(oldEntry.texture);
            }
            this.imageCache.delete(firstKey);
        }

        try {
            // Load image
            const img = new Image();
            img.crossOrigin = 'anonymous';

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = source;
            });

            // Create WebGL texture
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.bindTexture(gl.TEXTURE_2D, null);

            // Update cache entry
            cacheEntry.texture = texture;
            cacheEntry.width = img.width;
            cacheEntry.height = img.height;
            cacheEntry.loading = false;
            resolveLoad();

            return cacheEntry;
        } catch (err) {
            cacheEntry.error = err;
            cacheEntry.loading = false;
            resolveLoad();
            return null;
        }
    },

    /**
     * Render image material to a WebGL texture
     * @param {Layer} layer - The layer with image material
     * @param {object} layerFBO - The framebuffer object to render to
     */
    renderImage(layer, layerFBO) {
        const gl = state.gl;
        if (!gl || !this.imageProgram) return;

        const material = layer.material;
        const source = material.source;
        const params = material.params || {};
        const fitMode = params.fit || 'cover';

        if (!source) {
            this._clearLayerFBO(layerFBO);
            return;
        }
        // Ensure the texture is loading (fire-and-forget). Render only once the
        // image has decoded — until then clear the FBO so no stale frame shows.
        const imageData = this._ensureImageTexture(source);
        if (!imageData || !imageData.texture) {
            this._clearLayerFBO(layerFBO);
            return;
        }

        // Map fit mode to integer
        const fitModeInt = {
            'cover': 0,
            'contain': 1,
            'stretch': 2
        }[fitMode] || 0;

        // Render to framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
        gl.viewport(0, 0, layerFBO.width, layerFBO.height);

        gl.useProgram(this.imageProgram);

        // Bind texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, imageData.texture);
        if (this.imageUniforms.u_image) {
            gl.uniform1i(this.imageUniforms.u_image, 0);
        }

        // Set uniforms
        if (this.imageUniforms.u_imageRes) {
            gl.uniform2f(this.imageUniforms.u_imageRes, imageData.width, imageData.height);
        }
        if (this.imageUniforms.u_canvasRes) {
            gl.uniform2f(this.imageUniforms.u_canvasRes, layerFBO.width, layerFBO.height);
        }
        if (this.imageUniforms.u_fitMode) {
            gl.uniform1i(this.imageUniforms.u_fitMode, fitModeInt);
        }
        if (this.imageUniforms.u_flipY) {
            gl.uniform1f(this.imageUniforms.u_flipY, 0.0); // Normal for images
        }

        this._drawQuad(this.imagePosLoc);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    /**
     * Render a WebSRT input VideoFrame to the layer FBO. Reuses the image
     * shader (cover/contain/stretch). One texture per layer index, uploaded
     * fresh each frame from the latest decoded VideoFrame.
     */
    renderWebSRT(layer, layerFBO) {
        const gl = state.gl;
        if (!gl || !this.imageProgram) return;
        const inputIndex = layer.material?.params?.inputIndex;
        if (!Number.isFinite(inputIndex)) { this._clearLayerFBO(layerFBO); return; }

        const entry = this._uploadLayerSrtFrame(layer, inputIndex);
        if (!entry) { this._clearLayerFBO(layerFBO); return; }

        const fitModeInt = {
            'cover': 0, 'contain': 1, 'stretch': 2,
        }[layer.material?.params?.fit || 'cover'] || 0;

        gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
        gl.viewport(0, 0, layerFBO.width, layerFBO.height);
        gl.useProgram(this.imageProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, entry.tex);
        if (this.imageUniforms.u_image) gl.uniform1i(this.imageUniforms.u_image, 0);
        if (this.imageUniforms.u_imageRes) gl.uniform2f(this.imageUniforms.u_imageRes, entry.w || layerFBO.width, entry.h || layerFBO.height);
        if (this.imageUniforms.u_canvasRes) gl.uniform2f(this.imageUniforms.u_canvasRes, layerFBO.width, layerFBO.height);
        if (this.imageUniforms.u_fitMode) gl.uniform1i(this.imageUniforms.u_fitMode, fitModeInt);
        if (this.imageUniforms.u_flipY) gl.uniform1f(this.imageUniforms.u_flipY, 0.0);
        this._drawQuad(this.imagePosLoc);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    /**
     * Load a video and create a WebGL texture
     * @param {string} source - Video URL
     * @param {object} params - Video parameters { loop, autoplay }
     * @returns {Promise<object>} - Resolves with { video, texture, ready }
     */
    async loadVideoTexture(source, params) {
        const gl = state.gl;
        if (!gl) return null;

        const loop = params.loop !== false; // Default true
        const autoplay = params.autoplay !== false; // Default true

        // Check cache first
        if (this.videoCache.has(source)) {
            const cached = this.videoCache.get(source);
            if (!cached.loading) {
                // Ensure video is playing if autoplay is enabled
                if (autoplay && cached.video && cached.video.paused && cached.ready) {
                    cached.video.play().catch(() => {});
                }
                return cached;
            }
            if (cached._loadPromise) {
                await cached._loadPromise;
            }
            return cached;
        }

        // Create cache entry
        const cacheEntry = {
            video: null,
            texture: null,
            width: 0,
            height: 0,
            loading: true,
            error: null,
            ready: false,
            uploadW: 0,
            uploadH: 0,
            lastUploadFrame: 0
        };
        let resolveLoad;
        cacheEntry._loadPromise = new Promise(r => { resolveLoad = r; });
        this.videoCache.set(source, cacheEntry);

        // Enforce cache size limit
        if (this.videoCache.size > 50) {
            const firstKey = this.videoCache.keys().next().value;
            const oldEntry = this.videoCache.get(firstKey);
            if (oldEntry && oldEntry.texture) {
                gl.deleteTexture(oldEntry.texture);
            }
            this.videoCache.delete(firstKey);
        }

        try {
            // Create video element
            const video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            video.loop = loop;
            video.muted = true; // Required for autoplay
            video.playsInline = true; // Required for mobile

            // Wait for metadata to load
            await new Promise((resolve, reject) => {
                video.onloadedmetadata = () => {
                    cacheEntry.width = video.videoWidth;
                    cacheEntry.height = video.videoHeight;
                    cacheEntry.ready = true;
                    resolve();
                };
                video.onerror = reject;
                video.src = source;
            });

            // Create WebGL texture
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            // Initialize with empty texture (will be updated each frame)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.bindTexture(gl.TEXTURE_2D, null);

            // Update cache entry
            cacheEntry.video = video;
            cacheEntry.texture = texture;
            cacheEntry.loading = false;
            resolveLoad();

            // Start playback if autoplay enabled
            if (autoplay) {
                video.play().catch(() => {});
            }

            return cacheEntry;
        } catch (err) {
            cacheEntry.error = err;
            cacheEntry.loading = false;
            resolveLoad();
            return null;
        }
    },

    /**
     * Render video material to a WebGL texture
     * @param {Layer} layer - The layer with video material
     * @param {object} layerFBO - The framebuffer object to render to
     */
    renderVideo(layer, layerFBO) {
        const gl = state.gl;
        if (!gl || !this.imageProgram) return;

        const material = layer.material;
        const source = material.source;
        const params = material.params || {};
        const fitMode = params.fit || 'cover';

        if (!source) {
            this._clearLayerFBO(layerFBO);
            return;
        }

        // Ensure the video texture is loading (fire-and-forget). Render only
        // once metadata has loaded and a texture exists.
        const videoData = this._ensureVideoTexture(source, params);
        if (!videoData || !videoData.video || !videoData.texture) {
            this._clearLayerFBO(layerFBO);
            return;
        }

        const video = videoData.video;

        // Update texture from video frame if video is ready and playing
        if (videoData.ready && !video.paused && video.currentTime > 0) {
            this._uploadVideoFrame(videoData, video);
        }

        // Map fit mode to integer
        const fitModeInt = {
            'cover': 0,
            'contain': 1,
            'stretch': 2
        }[fitMode] || 0;

        // Render to framebuffer using image shader
        gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
        gl.viewport(0, 0, layerFBO.width, layerFBO.height);

        gl.useProgram(this.imageProgram);

        // Bind texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, videoData.texture);
        if (this.imageUniforms.u_image) {
            gl.uniform1i(this.imageUniforms.u_image, 0);
        }

        // Set uniforms
        if (this.imageUniforms.u_imageRes) {
            gl.uniform2f(this.imageUniforms.u_imageRes, videoData.width, videoData.height);
        }
        if (this.imageUniforms.u_canvasRes) {
            gl.uniform2f(this.imageUniforms.u_canvasRes, layerFBO.width, layerFBO.height);
        }
        if (this.imageUniforms.u_fitMode) {
            gl.uniform1i(this.imageUniforms.u_fitMode, fitModeInt);
        }
        if (this.imageUniforms.u_flipY) {
            gl.uniform1f(this.imageUniforms.u_flipY, 0.0); // Normal for video files
        }

        this._drawQuad(this.imagePosLoc);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    /**
     * Render webcam material to a WebGL texture
     * @param {Layer} layer - The layer with webcam material
     * @param {object} layerFBO - The framebuffer object to render to
     */
    renderWebcam(layer, layerFBO) {
        const gl = state.gl;
        if (!gl || !this.imageProgram) return;

        // Check if webcam is enabled and texture exists
        if (!state.videoEnabled || !state.videoTexture || !state.videoElement) {
            this._clearLayerFBO(layerFBO);
            return;
        }

        const params = layer.material.params || {};
        const fitMode = params.fit || 'cover';

        // Get video dimensions
        const videoWidth = state.videoElement.videoWidth || 1280;
        const videoHeight = state.videoElement.videoHeight || 720;

        // Map fit mode to integer
        const fitModeInt = {
            'cover': 0,
            'contain': 1,
            'stretch': 2
        }[fitMode] || 0;

        // Render to framebuffer using image shader
        gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
        gl.viewport(0, 0, layerFBO.width, layerFBO.height);

        gl.useProgram(this.imageProgram);

        // Bind webcam texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, state.videoTexture);
        if (this.imageUniforms.u_image) {
            gl.uniform1i(this.imageUniforms.u_image, 0);
        }

        // Set uniforms
        if (this.imageUniforms.u_imageRes) {
            gl.uniform2f(this.imageUniforms.u_imageRes, videoWidth, videoHeight);
        }
        if (this.imageUniforms.u_canvasRes) {
            gl.uniform2f(this.imageUniforms.u_canvasRes, layerFBO.width, layerFBO.height);
        }
        if (this.imageUniforms.u_fitMode) {
            gl.uniform1i(this.imageUniforms.u_fitMode, fitModeInt);
        }
        if (this.imageUniforms.u_flipY) {
            gl.uniform1f(this.imageUniforms.u_flipY, 1.0); // Flip Y for webcam
        }

        this._drawQuad(this.imagePosLoc);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    /**
     * Render screen capture material to a WebGL texture
     * @param {Layer} layer - The layer with screen capture material
     * @param {object} layerFBO - The framebuffer object to render to
     */
    renderScreen(layer, layerFBO) {
        const gl = state.gl;
        if (!gl || !this.imageProgram) return;

        // Check if screen capture is enabled and texture exists
        if (!state.screenEnabled || !state.screenTexture || !state.screenElement) {
            this._clearLayerFBO(layerFBO);
            return;
        }

        const params = layer.material.params || {};
        const fitMode = params.fit || 'cover';

        // Get screen dimensions
        const screenWidth = state.screenElement.videoWidth || 1920;
        const screenHeight = state.screenElement.videoHeight || 1080;

        // Map fit mode to integer
        const fitModeInt = {
            'cover': 0,
            'contain': 1,
            'stretch': 2
        }[fitMode] || 0;

        // Render to framebuffer using image shader
        gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
        gl.viewport(0, 0, layerFBO.width, layerFBO.height);

        gl.useProgram(this.imageProgram);

        // Bind screen texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, state.screenTexture);
        if (this.imageUniforms.u_image) {
            gl.uniform1i(this.imageUniforms.u_image, 0);
        }

        // Set uniforms
        if (this.imageUniforms.u_imageRes) {
            gl.uniform2f(this.imageUniforms.u_imageRes, screenWidth, screenHeight);
        }
        if (this.imageUniforms.u_canvasRes) {
            gl.uniform2f(this.imageUniforms.u_canvasRes, layerFBO.width, layerFBO.height);
        }
        if (this.imageUniforms.u_fitMode) {
            gl.uniform1i(this.imageUniforms.u_fitMode, fitModeInt);
        }
        if (this.imageUniforms.u_flipY) {
            gl.uniform1f(this.imageUniforms.u_flipY, 1.0); // Flip Y for screen capture
        }

        this._drawQuad(this.imagePosLoc);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    renderMilkdrop(layer, layerFBO) {
        const gl = state.gl;
        if (!gl || !this.imageProgram || !state.milkdropTexture) return;

        const params = layer.material.params || {};
        const fitMode = params.fit || 'cover';

        const fitModeInt = {
            'cover': 0,
            'contain': 1,
            'stretch': 2
        }[fitMode] || 0;

        gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
        gl.viewport(0, 0, layerFBO.width, layerFBO.height);

        gl.useProgram(this.imageProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, state.milkdropTexture);
        if (this.imageUniforms.u_image) {
            gl.uniform1i(this.imageUniforms.u_image, 0);
        }

        if (this.imageUniforms.u_imageRes) {
            const [imgW, imgH] = MilkdropFeature.getResolutionDimensions();
            gl.uniform2f(this.imageUniforms.u_imageRes, imgW, imgH);
        }
        if (this.imageUniforms.u_canvasRes) {
            gl.uniform2f(this.imageUniforms.u_canvasRes, layerFBO.width, layerFBO.height);
        }
        if (this.imageUniforms.u_fitMode) {
            gl.uniform1i(this.imageUniforms.u_fitMode, fitModeInt);
        }
        if (this.imageUniforms.u_flipY) {
            gl.uniform1f(this.imageUniforms.u_flipY, 1.0);
        }

        this._drawQuad(this.imagePosLoc);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
};

// Owned media state, reassigned onto LayerSystem at the end of layers.js so
// existing this.imageCache-style access and external window.LayerSystem
// lookups keep working unchanged.
export const layerMediaState = { imageCache, videoCache, _textCache };
