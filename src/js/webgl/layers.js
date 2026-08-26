/**
 * Layer System
 * Multi-layer shader system with blending modes
 */

import { state, getEl } from '../state.js';
import { BLEND_MODES, COMPOSITE_VS, COMPOSITE_FS, BACKGROUND_FS, PASSTHROUGH_FS, IMAGE_FS, FEEDBACK_FS, MAX_VOICES, VISUALIZER_TYPES, AUDIO_TEXTURE_WAVEFORM_UNIT, AUDIO_TEXTURE_SPECTRUM_UNIT, LAYER_VIDEO_TEXTURE_UNIT, LAYER_IMAGE_TEXTURE_UNIT, LAYER_SRT_TEXTURE_UNIT, LAYER_PARAM_UNIFORMS } from '../config.js';
import { FramebufferManager } from './framebuffers.js';
import { VoiceManager } from './voices.js';
import { EGSystem } from '../features/envelopeGenerators.js';
import { VideoTexture } from '../features/video.js';
import { ScreenCapture } from '../features/screenCapture.js';
import { AudioTexture } from '../features/audio.js';
import { MilkdropFeature } from '../features/milkdrop.js';
import { ModulationMatrix } from '../features/modulationMatrix.js';
import { ScanimateEngine } from '../features/scanimate.js';
import { VisualBrain } from '../features/visualBrain.js';
import { compileUtilityProgram, hexToRgb } from '../utils.js';
import { layerMediaMethods, layerMediaState } from './layerMedia.js';

const ZERO_VOICE_ACTIVE = new Float32Array(MAX_VOICES);

// Single source of truth for plain per-layer defaults. Index-dependent fields
// (enabled, opacity, id, name) and object/function-of-config defaults
// (material, modulationMatrix, voiceMode, input) are handled separately in the
// Layer constructor. Keep in sync with default_layers()/normalize_layer() in
// slopshady/src/state.rs.
const LAYER_DEFAULTS = {
    solo: false,
    volume: 1.0,
    audioMuted: false,
    blendMode: 'normal',
    brightness: 1.0,
    speed: 1.0,
    posX: 0.0,
    posY: 0.0,
    scale: 1.0,
    amount: 1.0,
    rotation: 0.0,
    stretch: 0.0,
    radius: 0.5,
    maskPosX: 0.0,
    maskPosY: 0.0,
    maskSoftness: 0.01,
    // Per-layer feedback state
    feedbackEnabled: false,
    feedbackAmount: 0.5,
    feedbackDecay: 0.9,
    feedbackZoom: 1.0,
    feedbackRotate: 0.0,
    feedbackOffsetX: 0.0,
    feedbackOffsetY: 0.0,
    feedbackSaturation: 1.0,
    feedbackBrightness: 1.0,
    feedbackBlendMode: 0,
    brainEnabled: false,
};

export class Layer {
    constructor(index, config) {
        config = config || {};
        this.index = index;
        this.id = config.id || `layer_${index}`;
        this.name = config.name || (index === 0 ? 'Main' : `Layer ${index}`);
        this.enabled = config.enabled !== undefined ? config.enabled : (index === 0);
        this.opacity = config.opacity !== undefined ? config.opacity : (index === 0 ? 1.0 : 0.0);
        this.material = config.material || { type: 'shader', source: '', params: {}, shaderRef: null };
        if (this.material.shaderRef === undefined) this.material.shaderRef = null;
        this.modulationMatrix = config.modulationMatrix || null;
        this.voiceMode = config.voiceMode || 'poly';
        this.input = config.input || {}; // MIDI input config: { channels: [], noteRange: [min, max] }

        for (const [k, v] of Object.entries(LAYER_DEFAULTS)) {
            this[k] = config[k] !== undefined ? config[k] : v;
        }

        // Voice Manager instance — each layer gets its own
        this.voiceManager = new VoiceManager(MAX_VOICES, this);
        this.voiceManager.setVoiceMode(this.voiceMode);

        // Per-layer envelope generators (4 per layer)
        this._egParamsVersion = 0;
        this.egs = Array.from({ length: 4 }, () => EGSystem.createEG());
        if (config.egs && Array.isArray(config.egs)) {
            for (let i = 0; i < 4; i++) {
                if (config.egs[i]) {
                    EGSystem.setEGParams(this.egs[i], config.egs[i]);
                }
            }
        }
        this.markEGsDirty();
        
        // Runtime GL state (not synced)
        this.program = null;
        this.voiceAware = false; // Set during compilation based on voiceMode
        this.voiceUniformLocs = null; // Cached voice uniform locations
        this._voiceUploadScratch = null; // Per-layer scratch arrays for modulated voice uniform uploads
        this._modulationUniformLocs = new Map();
        this.posLoc = -1;
        this.shaderParams = [];
        this.timeLoc = null;
        this.resLoc = null;
        this.videoLoc = null;
        this.screenLoc = null;
        this.audioWaveformLoc = null;
        this.audioSpectrumLoc = null;
    }
    
    getBlendModeIndex() {
        // blendMode is assigned directly from several call sites, so the index
        // is cached on LayerSystem keyed by the string — any assignment stays
        // correct without notification.
        let idx = LayerSystem._blendIndexCache.get(this.blendMode);
        if (idx === undefined) {
            idx = Math.max(0, BLEND_MODES.indexOf(this.blendMode));
            LayerSystem._blendIndexCache.set(this.blendMode, idx);
        }
        return idx;
    }

    processEGs(deltaTime) {
        for (const eg of this.egs) {
            EGSystem.processEG(eg, deltaTime);
        }
    }

    markEGsDirty() {
        this._egParamsVersion++;
    }
    
    /**
     * Set voice mode and propagate to VoiceManager
     * @param {string} mode - 'poly', 'mono', or 'glide'
     */
    setVoiceMode(mode) {
        this.voiceMode = mode;
        this.voiceManager.setVoiceMode(mode);
    }
    
    /**
     * Set glide time for the voice manager
     * @param {number} time - Glide time in seconds
     */
    setGlideTime(time) {
        this.voiceManager.setGlideTime(time);
    }
}

export const LayerSystem = {
    layers: [],
    backgroundState: { enabled: true, material: { type: 'solid', source: '#000000' } },
    masterState: { feedbackEnabled: false, feedbackAmount: 0.5, feedbackDecay: 0.9, feedbackZoom: 1.0, feedbackRotate: 0.0, feedbackOffsetX: 0.0, feedbackOffsetY: 0.0 },
    
    // Compiled utility programs
    compositeProgram: null,
    compositeUniforms: {},
    backgroundProgram: null,
    passthroughProgram: null,
    imageProgram: null,
    feedbackProgram: null,
    feedbackUniforms: {},
    imageUniforms: {},
    
    // Reused render-loop state — avoids per-frame allocations in the hot path
    _renderableScratch: [],
    _frameStamp: 0,
    _blendIndexCache: new Map(),
    // FBO holding the frame's final image for the screen blit: compositeFBO,
    // or the post-swap feedbackFBO when master feedback ran (compositeFBO is
    // NOT the final image in that case).
    _finalOutputFBO: null,
    
    init(layerConfigs, bgState, masterState) {
        this.layers = [];
        const configs = layerConfigs || [];
        for (let i = 0; i < 8; i++) {
            this.layers.push(new Layer(i, configs[i] || null));
        }
        
        if (bgState) {
            this.backgroundState = {
                enabled: bgState.enabled !== undefined ? bgState.enabled : true,
                material: bgState.material || { type: 'solid', source: '#000000' }
            };
        }
        if (masterState) {
            this.masterState = {
                feedbackEnabled: masterState.feedbackEnabled || false,
                feedbackAmount: masterState.feedbackAmount !== undefined ? masterState.feedbackAmount : 0.5,
                feedbackDecay: masterState.feedbackDecay !== undefined ? masterState.feedbackDecay : 0.9,
                feedbackZoom: masterState.feedbackZoom !== undefined ? masterState.feedbackZoom : 1.0,
                feedbackRotate: masterState.feedbackRotate !== undefined ? masterState.feedbackRotate : 0.0,
                feedbackOffsetX: masterState.feedbackOffsetX !== undefined ? masterState.feedbackOffsetX : 0.0,
                feedbackOffsetY: masterState.feedbackOffsetY !== undefined ? masterState.feedbackOffsetY : 0.0,
                feedbackSaturation: masterState.feedbackSaturation !== undefined ? masterState.feedbackSaturation : 1.0,
                feedbackBrightness: masterState.feedbackBrightness !== undefined ? masterState.feedbackBrightness : 1.0,
                feedbackBlendMode: masterState.feedbackBlendMode !== undefined ? masterState.feedbackBlendMode : 0
            };
        }
        
        this.compileUtilityPrograms();
    },
    
    hasSolo() {
        for (let i = 0; i < this.layers.length; i++) {
            if (this.layers[i].solo && this.layers[i].enabled) return true;
        }
        return false;
    },
    
    compileUtilityPrograms() {
        const gl = state.gl;
        if (!gl) return;
        
        this.compositeProgram = compileUtilityProgram(gl, COMPOSITE_FS, COMPOSITE_VS);
        if (this.compositeProgram) {
            this.compositeUniforms = {
                u_base: gl.getUniformLocation(this.compositeProgram, 'u_base'),
                u_layer: gl.getUniformLocation(this.compositeProgram, 'u_layer'),
                u_opacity: gl.getUniformLocation(this.compositeProgram, 'u_opacity'),
                u_blendMode: gl.getUniformLocation(this.compositeProgram, 'u_blendMode'),
                u_posX: gl.getUniformLocation(this.compositeProgram, 'u_posX'),
                u_posY: gl.getUniformLocation(this.compositeProgram, 'u_posY'),
                u_scale: gl.getUniformLocation(this.compositeProgram, 'u_scale'),
                u_rotation: gl.getUniformLocation(this.compositeProgram, 'u_rotation'),
                u_brightness: gl.getUniformLocation(this.compositeProgram, 'u_brightness'),
                u_amount: gl.getUniformLocation(this.compositeProgram, 'u_amount'),
                u_radius: gl.getUniformLocation(this.compositeProgram, 'u_radius'),
                u_stretch: gl.getUniformLocation(this.compositeProgram, 'u_stretch'),
                u_maskPosX: gl.getUniformLocation(this.compositeProgram, 'u_maskPosX'),
                u_maskPosY: gl.getUniformLocation(this.compositeProgram, 'u_maskPosY'),
                u_maskSoftness: gl.getUniformLocation(this.compositeProgram, 'u_maskSoftness')
            };
            this.compositePosLoc = gl.getAttribLocation(this.compositeProgram, 'position');
        }
        
        this.backgroundProgram = compileUtilityProgram(gl, BACKGROUND_FS, COMPOSITE_VS);
        if (this.backgroundProgram) {
            this.bgColorLoc = gl.getUniformLocation(this.backgroundProgram, 'u_bgColor');
            this.backgroundPosLoc = gl.getAttribLocation(this.backgroundProgram, 'position');
        }
        
        this.passthroughProgram = compileUtilityProgram(gl, PASSTHROUGH_FS, COMPOSITE_VS);
        if (this.passthroughProgram) {
            this.passthroughTexLoc = gl.getUniformLocation(this.passthroughProgram, 'u_texture');
            this.passthroughPosLoc = gl.getAttribLocation(this.passthroughProgram, 'position');
        }
        
        this.imageProgram = compileUtilityProgram(gl, IMAGE_FS, COMPOSITE_VS);
        if (this.imageProgram) {
            this.imageUniforms = {
                u_image: gl.getUniformLocation(this.imageProgram, 'u_image'),
                u_imageRes: gl.getUniformLocation(this.imageProgram, 'u_imageRes'),
                u_canvasRes: gl.getUniformLocation(this.imageProgram, 'u_canvasRes'),
                u_fitMode: gl.getUniformLocation(this.imageProgram, 'u_fitMode'),
                u_flipY: gl.getUniformLocation(this.imageProgram, 'u_flipY')
            };
            this.imagePosLoc = gl.getAttribLocation(this.imageProgram, 'position');
        }
        
        this.feedbackProgram = compileUtilityProgram(gl, FEEDBACK_FS, COMPOSITE_VS);
        if (this.feedbackProgram) {
            this.feedbackUniforms = {
                u_currentFrame: gl.getUniformLocation(this.feedbackProgram, 'u_currentFrame'),
                u_lastFrame: gl.getUniformLocation(this.feedbackProgram, 'u_lastFrame'),
                u_feedbackAmount: gl.getUniformLocation(this.feedbackProgram, 'u_feedbackAmount'),
                u_decay: gl.getUniformLocation(this.feedbackProgram, 'u_decay'),
                u_zoom: gl.getUniformLocation(this.feedbackProgram, 'u_zoom'),
                u_rotate: gl.getUniformLocation(this.feedbackProgram, 'u_rotate'),
                u_offset: gl.getUniformLocation(this.feedbackProgram, 'u_offset'),
                u_saturation: gl.getUniformLocation(this.feedbackProgram, 'u_saturation'),
                u_brightness: gl.getUniformLocation(this.feedbackProgram, 'u_brightness'),
                u_blendMode: gl.getUniformLocation(this.feedbackProgram, 'u_blendMode'),
                iResolution: gl.getUniformLocation(this.feedbackProgram, 'iResolution')
            };
            this.feedbackPosLoc = gl.getAttribLocation(this.feedbackProgram, 'position');
        }
    },
    
    /**
     * Render background material (solid, image, or video) to composite FBO
     * @param {object} compositeFBO - The framebuffer to render to
     */
    renderBackground(compositeFBO) {
        const gl = state.gl;
        if (!gl || !compositeFBO) return;

        const material = this.backgroundState.material || { type: 'solid', source: '#000000' };

        if (material.type === 'solid') {
            gl.bindFramebuffer(gl.FRAMEBUFFER, compositeFBO.fbo);
            gl.viewport(0, 0, compositeFBO.width, compositeFBO.height);
            if (!this.backgroundProgram) {
                gl.clearColor(0, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                return;
            }
            gl.useProgram(this.backgroundProgram);
            const rgb = hexToRgb(material.source || '#000000');
            if (this.bgColorLoc) gl.uniform3f(this.bgColorLoc, rgb[0], rgb[1], rgb[2]);
            this._drawQuad(this.backgroundPosLoc);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return;
        }

        const syntheticLayer = { material };
        const renderMethod = {
            image: this.renderImage,
            video: this.renderVideo,
            webcam: this.renderWebcam,
            screen: this.renderScreen,
            text: this.renderText,
        }[material.type];

        if (renderMethod) {
            renderMethod.call(this, syntheticLayer, compositeFBO);
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, compositeFBO.fbo);
            gl.viewport(0, 0, compositeFBO.width, compositeFBO.height);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
    },

    render(currentTime, deltaTime = 0.016) {
        const gl = state.gl;
        if (!gl) return;

        // One shared VAO serves every quad draw this frame (setupQuad pins
        // 'position' to attrib 0 in every program via bindAttribLocation).
        gl.bindVertexArray(state.quadVAO);

        this._frameStamp++;

        VideoTexture.update();
        ScreenCapture.update();
        AudioTexture.update();
        MilkdropFeature.render();
        
        const cw = state.canvas.width;
        const ch = state.canvas.height;
        
        // Process all voice managers (glide interpolation, etc.)
        for (const layer of this.layers) {
            if (layer.voiceManager && layer.voiceMode !== 'off') {
                layer.voiceManager.process(deltaTime);
            }
        }
        
        // 1. Render background to compositeFBO
        if (this.backgroundState.enabled && FramebufferManager.compositeFBO) {
            this.renderBackground(FramebufferManager.compositeFBO);
        } else if (FramebufferManager.compositeFBO) {
            const bgFBO = FramebufferManager.compositeFBO;
            gl.bindFramebuffer(gl.FRAMEBUFFER, bgFBO.fbo);
            gl.viewport(0, 0, bgFBO.width, bgFBO.height);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        
        // Determine which layers to render (reused scratch array — no per-frame alloc)
        const soloActive = this.hasSolo();
        const renderableLayers = this._renderableScratch;
        renderableLayers.length = 0;
        let milkdropActive = false;
        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            if (!layer.enabled) continue;
            if (soloActive) {
                if (!layer.solo) continue;
            } else {
                // _modulatedOpacity is only refreshed while the layer renders, so
                // gate on the max of base + last modulated: otherwise a layer that
                // hits 0 in one of them can never come back (stale 0 locks it out).
                const effOpacity = Math.max(layer.opacity, layer._modulatedOpacity ?? 0);
                if (effOpacity < 0.004) continue;
            }
            if (layer.material?.type === 'milkdrop') milkdropActive = true;
            renderableLayers.push(layer);
        }

        state.milkdropEnabled = milkdropActive;
        
        // 2. For each renderable layer: render shader → composite
        for (const layer of renderableLayers) {
            // Skip layers that need a per-layer shader program but don't have one.
            // Material types here use a shared program (imageProgram / dedicated
            // engine) and don't need layer.program to be set.
            const programlessTypes = ['visualizer', 'milkdrop', 'scanimate', 'websrt', 'image', 'video', 'webcam', 'screen', 'text'];
            if (!layer.program && !programlessTypes.includes(layer.material?.type)) continue;

            this.renderLayerToTexture(layer, currentTime);

            const layerFBO = FramebufferManager.getLayerFBO(layer.index);
            const compositeFBO = FramebufferManager.compositeFBO;
            const compositeFBO2 = FramebufferManager.compositeFBO2;

            if (!layerFBO || !compositeFBO || !compositeFBO2 || !this.compositeProgram) continue;

            // Apply VisualBrain effect if enabled on this layer
            if (layer.brainEnabled) {
                VisualBrain.processLayer(layer, layerFBO, currentTime);
            }

            // Apply per-layer feedback if enabled
            let processedTexture = layerFBO.texture;
            if (layer.feedbackEnabled && this.feedbackProgram) {
                FramebufferManager.ensureLayerFeedbackFBOs(layer.index);
                const feedbackSrcFBO = FramebufferManager.layerFeedbackFBOs[layer.index];
                const feedbackDstFBO = FramebufferManager.layerFeedbackFBOs2[layer.index];
                if (feedbackSrcFBO && feedbackDstFBO) {
                    // Render feedback to dst FBO
                    gl.bindFramebuffer(gl.FRAMEBUFFER, feedbackDstFBO.fbo);
                    gl.viewport(0, 0, feedbackDstFBO.width, feedbackDstFBO.height);

                    gl.useProgram(this.feedbackProgram);

                    // Bind current layer frame
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, layerFBO.texture);
                    gl.uniform1i(this.feedbackUniforms.u_currentFrame, 0);

                    // Bind last feedback frame from this layer's FBOs
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, feedbackSrcFBO.texture);
                    gl.uniform1i(this.feedbackUniforms.u_lastFrame, 1);

                    // Set layer feedback parameters
                    gl.uniform1f(this.feedbackUniforms.u_feedbackAmount, layer.feedbackAmount);
                    gl.uniform1f(this.feedbackUniforms.u_decay, layer.feedbackDecay);
                    gl.uniform1f(this.feedbackUniforms.u_zoom, layer.feedbackZoom);
                    gl.uniform1f(this.feedbackUniforms.u_rotate, layer.feedbackRotate);
                    gl.uniform2f(this.feedbackUniforms.u_offset, layer.feedbackOffsetX, layer.feedbackOffsetY);
                    gl.uniform1f(this.feedbackUniforms.u_saturation, layer.feedbackSaturation ?? 1.0);
                    gl.uniform1f(this.feedbackUniforms.u_brightness, layer.feedbackBrightness ?? 1.0);
                    gl.uniform1i(this.feedbackUniforms.u_blendMode, layer.feedbackBlendMode ?? 0);
                    gl.uniform2f(this.feedbackUniforms.iResolution, feedbackDstFBO.width, feedbackDstFBO.height);

                    this._drawQuad(this.feedbackPosLoc);

                    // Swap layer feedback FBOs for next frame
                    FramebufferManager.layerFeedbackFBOs[layer.index] = feedbackDstFBO;
                    FramebufferManager.layerFeedbackFBOs2[layer.index] = feedbackSrcFBO;

                    processedTexture = feedbackDstFBO.texture;
                }
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, compositeFBO2.fbo);
            gl.viewport(0, 0, compositeFBO2.width, compositeFBO2.height);

            gl.useProgram(this.compositeProgram);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, compositeFBO.texture);
            gl.uniform1i(this.compositeUniforms.u_base, 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, processedTexture);
            gl.uniform1i(this.compositeUniforms.u_layer, 1);

            gl.uniform1f(this.compositeUniforms.u_opacity, layer._modulatedOpacity !== undefined ? layer._modulatedOpacity : layer.opacity);
            gl.uniform1i(this.compositeUniforms.u_blendMode, layer.getBlendModeIndex());

            const mp = layer._modulatedParams || {};
            if (this.compositeUniforms.u_posX) gl.uniform1f(this.compositeUniforms.u_posX, mp.posX ?? layer.posX ?? 0);
            if (this.compositeUniforms.u_posY) gl.uniform1f(this.compositeUniforms.u_posY, mp.posY ?? layer.posY ?? 0);
            if (this.compositeUniforms.u_scale) gl.uniform1f(this.compositeUniforms.u_scale, mp.scale ?? layer.scale ?? 1);
            if (this.compositeUniforms.u_rotation) gl.uniform1f(this.compositeUniforms.u_rotation, mp.rotation ?? layer.rotation ?? 0);
            if (this.compositeUniforms.u_brightness) gl.uniform1f(this.compositeUniforms.u_brightness, mp.brightness ?? layer.brightness ?? 1);
            if (this.compositeUniforms.u_amount) gl.uniform1f(this.compositeUniforms.u_amount, mp.amount ?? layer.amount ?? 1);
            if (this.compositeUniforms.u_radius) gl.uniform1f(this.compositeUniforms.u_radius, mp.radius ?? layer.radius ?? 0.5);
            if (this.compositeUniforms.u_stretch) gl.uniform1f(this.compositeUniforms.u_stretch, mp.stretch ?? layer.stretch ?? 0);
            if (this.compositeUniforms.u_maskPosX) gl.uniform1f(this.compositeUniforms.u_maskPosX, mp.maskPosX ?? layer.maskPosX ?? 0);
            if (this.compositeUniforms.u_maskPosY) gl.uniform1f(this.compositeUniforms.u_maskPosY, mp.maskPosY ?? layer.maskPosY ?? 0);
            if (this.compositeUniforms.u_maskSoftness) gl.uniform1f(this.compositeUniforms.u_maskSoftness, mp.maskSoftness ?? layer.maskSoftness ?? 0.01);

            this._drawQuad(this.compositePosLoc);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            // Swap compositeFBO / compositeFBO2
            const temp = FramebufferManager.compositeFBO;
            FramebufferManager.compositeFBO = FramebufferManager.compositeFBO2;
            FramebufferManager.compositeFBO2 = temp;
        }
        
        // 3. Apply feedback effect after all layers are composited
        this._finalOutputFBO = FramebufferManager.compositeFBO;
        if (this.masterState.feedbackEnabled && this.feedbackProgram && FramebufferManager.feedbackFBO && FramebufferManager.feedbackFBO2) {
            // Use dedicated feedback FBOs to avoid feedback loop with composite FBOs
            const currentFBO = FramebufferManager.compositeFBO;  // Source: current frame
            const feedbackSrcFBO = FramebufferManager.feedbackFBO;  // Source: last feedback output
            const feedbackDstFBO = FramebufferManager.feedbackFBO2; // Destination: new feedback output
            
            gl.bindFramebuffer(gl.FRAMEBUFFER, feedbackDstFBO.fbo);
            gl.viewport(0, 0, feedbackDstFBO.width, feedbackDstFBO.height);
            
            gl.useProgram(this.feedbackProgram);
            
            // Bind current frame (from compositeFBO)
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, currentFBO.texture);
            gl.uniform1i(this.feedbackUniforms.u_currentFrame, 0);
            
            // Bind last feedback frame (from feedbackFBO - NOT the destination!)
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, feedbackSrcFBO.texture);
            gl.uniform1i(this.feedbackUniforms.u_lastFrame, 1);
            
            // Set feedback parameters
            gl.uniform1f(this.feedbackUniforms.u_feedbackAmount, this.masterState.feedbackAmount);
            gl.uniform1f(this.feedbackUniforms.u_decay, this.masterState.feedbackDecay);
            gl.uniform1f(this.feedbackUniforms.u_zoom, this.masterState.feedbackZoom);
            gl.uniform1f(this.feedbackUniforms.u_rotate, this.masterState.feedbackRotate);
            gl.uniform2f(this.feedbackUniforms.u_offset, this.masterState.feedbackOffsetX, this.masterState.feedbackOffsetY);
            gl.uniform1f(this.feedbackUniforms.u_saturation, this.masterState.feedbackSaturation ?? 1.0);
            gl.uniform1f(this.feedbackUniforms.u_brightness, this.masterState.feedbackBrightness ?? 1.0);
            gl.uniform1i(this.feedbackUniforms.u_blendMode, this.masterState.feedbackBlendMode ?? 0);
            gl.uniform2f(this.feedbackUniforms.iResolution, feedbackDstFBO.width, feedbackDstFBO.height);
            
            this._drawQuad(this.feedbackPosLoc);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            
            // Swap feedback FBOs for next frame
            let tempFBO = FramebufferManager.feedbackFBO;
            FramebufferManager.feedbackFBO = FramebufferManager.feedbackFBO2;
            FramebufferManager.feedbackFBO2 = tempFBO;

            // The swapped-in feedbackFBO holds the final composited+feedback
            // image; step 4 samples it directly. No copy-back into
            // compositeFBO — next frame's background fully rewrites it.
            this._finalOutputFBO = FramebufferManager.feedbackFBO;
        }
        
        // 4. Final output
        const finalFBO = this._finalOutputFBO;
        if (finalFBO && this.passthroughProgram) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, cw, ch);
            
            gl.useProgram(this.passthroughProgram);
            
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, finalFBO.texture);
            if (this.passthroughTexLoc) gl.uniform1i(this.passthroughTexLoc, 0);
            
            this._drawQuad(this.passthroughPosLoc);
        }
    },
    
    renderLayerToTexture(layer, currentTime) {
        const gl = state.gl;
        if (!gl) return;

        const layerFBO = FramebufferManager.getLayerFBO(layer.index);
        if (!layerFBO) return;

        layer._modulatedOpacity = undefined;

        let _mpBrightness = layer.brightness;
        let _mpSpeed = layer.speed;
        let _mpPosX = layer.posX;
        let _mpPosY = layer.posY;
        let _mpScale = layer.scale;
        let _mpRadius = layer.radius;
        let _mpAmount = layer.amount;
        let _mpRotation = layer.rotation;
        let _mpStretch = layer.stretch;
        let _mpMaskPosX = layer.maskPosX;
        let _mpMaskPosY = layer.maskPosY;
        let _mpMaskSoftness = layer.maskSoftness;
        let _mpOpacity = layer.opacity;

        layer._modulatedOpacity = _mpOpacity;
        layer._modulatedParams = {
            brightness: _mpBrightness,
            speed: _mpSpeed,
            posX: _mpPosX,
            posY: _mpPosY,
            scale: _mpScale,
            radius: _mpRadius,
            amount: _mpAmount,
            rotation: _mpRotation,
            stretch: _mpStretch,
            maskPosX: _mpMaskPosX,
            maskPosY: _mpMaskPosY,
            maskSoftness: _mpMaskSoftness,
            opacity: _mpOpacity,
        };

        // Run modulation matrix — applies to _modulatedParams for all material types
        // (rotation, brightness, scale etc. affect the composite step regardless of source)
        let _modLayerUniforms = null;
        let _modVoiceUniforms = null;
        layer._modulatedShaderParams = {};
        if (layer.modulationMatrix && layer.modulationMatrix.length > 0) {
            const modResult = ModulationMatrix.update(0, layer);
            _modLayerUniforms = modResult.layerUniforms;
            _modVoiceUniforms = modResult.voiceUniforms;
            for (const [uniformName, value] of Object.entries(_modLayerUniforms)) {
                if (LAYER_PARAM_UNIFORMS.has(uniformName)) {
                    const paramName = uniformName.replace('u_', '');
                    layer._modulatedParams[paramName] += value;
                    if (paramName === 'opacity') layer._modulatedOpacity += value;
                } else {
                    layer._modulatedShaderParams[uniformName] = value;
                }
            }
        }

        // Handle text material type
        if (layer.material && layer.material.type === 'text') {
            // Skip if no text content
            if (!layer.material.source || layer.material.source.trim() === '') {
                this._clearLayerFBO(layerFBO);
                return;
            }
            this.renderText(layer, layerFBO);
            return;
        }

        // Handle image material type
        if (layer.material && layer.material.type === 'image' && !layer.material.params?.shaderMode) {
            // Skip if no image source
            if (!layer.material.source || layer.material.source.trim() === '') {
                this._clearLayerFBO(layerFBO);
                return;
            }
            this.renderImage(layer, layerFBO);
            return;
        }

        // Handle video material type
        if (layer.material && layer.material.type === 'video' && !layer.material.params?.shaderMode) {
            // Skip if no video source
            if (!layer.material.source || layer.material.source.trim() === '') {
                this._clearLayerFBO(layerFBO);
                return;
            }
            // Validate that source looks like a URL (starts with http, https, blob, or is a relative path)
            const source = layer.material.source;
            const isValidUrl = source.startsWith('http://') ||
                               source.startsWith('https://') ||
                               source.startsWith('blob:') ||
                               source.startsWith('data:') ||
                               (!source.includes('\n') && !source.includes('{'));
            if (!isValidUrl) {
                this._clearLayerFBO(layerFBO);
                return;
            }
            this.renderVideo(layer, layerFBO);
            return;
        }

        // Handle webcam material type
        if (layer.material && layer.material.type === 'webcam') {
            // Check if webcam is enabled and texture exists
            if (!state.videoEnabled || !state.videoTexture || !state.videoElement) {
                this._clearLayerFBO(layerFBO);
                return;
            }
            this.renderWebcam(layer, layerFBO);
            return;
        }

        // Handle screen capture material type
        if (layer.material && layer.material.type === 'screen') {
            // Check if screen capture is enabled and texture exists
            if (!state.screenEnabled || !state.screenTexture || !state.screenElement) {
                this._clearLayerFBO(layerFBO);
                return;
            }
            this.renderScreen(layer, layerFBO);
            return;
        }

        // Handle visualizer material type
        if (layer.material && layer.material.type === 'visualizer') {
            const vizType = layer.material.params?.visualizerType || 'waveform';
            const vizConfig = VISUALIZER_TYPES[vizType];
            if (vizConfig && vizConfig.shader) {
                // Ensure audio textures are enabled for visualizer layers
                if (!state.audioTextureEnabled) {
                    AudioTexture.enable();
                }
                this._renderVisualizer(layer, layerFBO, vizConfig, vizType);
            } else {
                this._clearLayerFBO(layerFBO);
            }
            return;
        }

        // Handle milkdrop material type
        if (layer.material && layer.material.type === 'milkdrop') {
            if (!state.milkdropTexture) {
                this._clearLayerFBO(layerFBO);
                return;
            }
            this.renderMilkdrop(layer, layerFBO);
            return;
        }

        // Handle scanimate material type
        if (layer.material && layer.material.type === 'scanimate') {
            ScanimateEngine.renderLayer(layer, layerFBO, currentTime);
            return;
        }

        // Handle WebSRT input type — upload latest decoded VideoFrame.
        if (layer.material && layer.material.type === 'websrt' && !layer.material.params?.shaderMode) {
            this.renderWebSRT(layer, layerFBO);
            return;
        }

        if (!layer.program) return;
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
        gl.viewport(0, 0, layerFBO.width, layerFBO.height);
        
        // Clear the framebuffer to prevent garbage data
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.useProgram(layer.program);
        
        if (layer.resLoc) gl.uniform3f(layer.resLoc, layerFBO.width, layerFBO.height, 1.0);
        
        // Set shader parameter uniforms (code dials, modulation)
        for (const param of layer.shaderParams) {
            if (param.location) {
                gl.uniform1f(param.location, param.currentValue);
            }
        }
        
        // Set voice uniforms
        if (layer.voiceManager) {
            const voiceUniforms = layer.voiceManager.getUniforms();
            const locs = layer.voiceUniformLocs;

            if (locs) {
                if (!layer._voiceUploadScratch) {
                    layer._voiceUploadScratch = {
                        posX: new Float32Array(MAX_VOICES),
                        posY: new Float32Array(MAX_VOICES),
                        scale: new Float32Array(MAX_VOICES),
                        rotation: new Float32Array(MAX_VOICES)
                    };
                }
                const scratch = layer._voiceUploadScratch;
                for (let i = 0; i < MAX_VOICES; i++) {
                    const vOff = (_modVoiceUniforms && _modVoiceUniforms[i]) || {};
                    scratch.posX[i] = voiceUniforms.u_voicePosX[i] + (vOff.posX || 0);
                    scratch.posY[i] = voiceUniforms.u_voicePosY[i] + (vOff.posY || 0);
                    scratch.scale[i] = voiceUniforms.u_voiceScale[i] + (vOff.scale || 0);
                    scratch.rotation[i] = voiceUniforms.u_voiceRotation[i] + (vOff.rotation || 0);
                }
                if (locs.active) gl.uniform1fv(locs.active, layer.voiceMode === 'off' ? ZERO_VOICE_ACTIVE : voiceUniforms.u_voiceActive);
                if (locs.note) gl.uniform1fv(locs.note, voiceUniforms.u_voiceNote);
                if (locs.velocity) gl.uniform1fv(locs.velocity, voiceUniforms.u_voiceVelocity);
                if (locs.eg) gl.uniform1fv(locs.eg, voiceUniforms.u_voiceEG);
                if (locs.posX) gl.uniform1fv(locs.posX, scratch.posX);
                if (locs.posY) gl.uniform1fv(locs.posY, scratch.posY);
                if (locs.scale) gl.uniform1fv(locs.scale, scratch.scale);
                if (locs.rotation) gl.uniform1fv(locs.rotation, scratch.rotation);
                if (locs.usePos) gl.uniform1fv(locs.usePos, voiceUniforms.u_voiceUsePos);
                if (locs.useScale) gl.uniform1fv(locs.useScale, voiceUniforms.u_voiceUseScale);
                if (locs.useRot) gl.uniform1fv(locs.useRot, voiceUniforms.u_voiceUseRot);
                // u_eg0-3: aggregate (max) of active voices' per-voice EG values
                const vm = layer.voiceManager;
                for (let eg = 0; eg < 4; eg++) {
                    const loc = locs['eg' + eg];
                    if (!loc) continue;
                    let max = 0;
                    if (vm && vm.voices) {
                        for (const v of vm.voices) {
                            if ((v.active || v.releasing) && v.egs && v.egs[eg]) {
                                if (v.egs[eg].value > max) max = v.egs[eg].value;
                            }
                        }
                    }
                    gl.uniform1f(loc, max);
                }
                if (locs.pitchBend) gl.uniform1f(locs.pitchBend, layer.voiceManager.getPitchBend());
                if (locs.channelPressure) gl.uniform1f(locs.channelPressure, layer.voiceManager.getChannelPressure());
                if (locs.kbdNote) gl.uniform1f(locs.kbdNote, layer.voiceManager.getLatestNote());
            }
        }

        // Write code dial shader uniforms from cached mod matrix result
        if (_modLayerUniforms) {
            for (const [uniformName, value] of Object.entries(_modLayerUniforms)) {
                if (!LAYER_PARAM_UNIFORMS.has(uniformName)) {
                    let loc = layer._modulationUniformLocs.get(uniformName);
                    if (loc === undefined) {
                        loc = gl.getUniformLocation(layer.program, uniformName);
                        layer._modulationUniformLocs.set(uniformName, loc);
                    }
                    if (loc !== null && Number.isFinite(value)) {
                        const param = layer.shaderParams.find(p => 'u_param_' + p.key === uniformName);
                        const baseValue = param ? param.currentValue : 0;
                        gl.uniform1f(loc, baseValue + value);
                    }
                }
            }
        }

        // Set time uniform with speed applied (after EG modulation)
        if (layer.timeLoc) gl.uniform1f(layer.timeLoc, currentTime * layer._modulatedParams.speed);

        // Set layer parameter uniforms
        if (layer.voiceUniformLocs?.layerParams) {
            const lp = layer.voiceUniformLocs.layerParams;
            const mp = layer._modulatedParams;
            if (lp.brightness) gl.uniform1f(lp.brightness, mp.brightness);
            if (lp.speed) gl.uniform1f(lp.speed, mp.speed);
            if (lp.posX) gl.uniform1f(lp.posX, mp.posX);
            if (lp.posY) gl.uniform1f(lp.posY, mp.posY);
            if (lp.scale) gl.uniform1f(lp.scale, mp.scale);
            if (lp.radius) gl.uniform1f(lp.radius, mp.radius);
            if (lp.amount) gl.uniform1f(lp.amount, mp.amount);
            if (lp.rotation) gl.uniform1f(lp.rotation, mp.rotation);
            if (lp.stretch) gl.uniform1f(lp.stretch, mp.stretch);
            if (lp.maskPosX) gl.uniform1f(lp.maskPosX, mp.maskPosX);
            if (lp.maskPosY) gl.uniform1f(lp.maskPosY, mp.maskPosY);
            if (lp.maskSoftness) gl.uniform1f(lp.maskSoftness, mp.maskSoftness);
        }
        
        if (state.videoEnabled && state.videoTexture && layer.videoLoc) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, state.videoTexture);
            gl.uniform1i(layer.videoLoc, 1);
        }

        if (state.screenEnabled && state.screenTexture && layer.screenLoc) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, state.screenTexture);
            gl.uniform1i(layer.screenLoc, 2);
        }

        // Audio waveform texture
        if (state.audioTextureEnabled && state.audioWaveformTexture && layer.audioWaveformLoc) {
            gl.activeTexture(gl.TEXTURE0 + AUDIO_TEXTURE_WAVEFORM_UNIT);
            gl.bindTexture(gl.TEXTURE_2D, state.audioWaveformTexture);
            gl.uniform1i(layer.audioWaveformLoc, AUDIO_TEXTURE_WAVEFORM_UNIT);
        }

        // Audio spectrum texture
        if (state.audioTextureEnabled && state.audioSpectrumTexture && layer.audioSpectrumLoc) {
            gl.activeTexture(gl.TEXTURE0 + AUDIO_TEXTURE_SPECTRUM_UNIT);
            gl.bindTexture(gl.TEXTURE_2D, state.audioSpectrumTexture);
            gl.uniform1i(layer.audioSpectrumLoc, AUDIO_TEXTURE_SPECTRUM_UNIT);
        }

        // Per-layer media textures (shader-mode layers)
        this._bindLayerMedia(layer);

        this._drawQuad(layer.posLoc);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    
    getState() {
        return {
            layers: this.layers.map(l => ({
                id: l.id,
                name: l.name,
                enabled: l.enabled,
                solo: l.solo,
                opacity: l.opacity,
                volume: l.volume,
                audioMuted: l.audioMuted,
                blendMode: l.blendMode,
                material: {
                    type: l.material.type,
                    source: l.material.source,
                    params: { ...(l.material.params || {}) },
                    shaderRef: l.material.shaderRef || null
                },
                modulationMatrix: l.modulationMatrix,
                voiceMode: l.voiceMode,
                glideTime: l.voiceManager ? l.voiceManager.glideTime : 0.1,
                input: l.input ? { ...l.input } : {},
                feedbackEnabled: l.feedbackEnabled,
                feedbackAmount: l.feedbackAmount,
                feedbackDecay: l.feedbackDecay,
                feedbackZoom: l.feedbackZoom,
                feedbackRotate: l.feedbackRotate,
                feedbackOffsetX: l.feedbackOffsetX,
                feedbackOffsetY: l.feedbackOffsetY,
                feedbackSaturation: l.feedbackSaturation,
                feedbackBrightness: l.feedbackBrightness,
                feedbackBlendMode: l.feedbackBlendMode,
                brightness: l.brightness ?? 1.0,
                speed: l.speed ?? 1.0,
                posX: l.posX ?? 0.0,
                posY: l.posY ?? 0.0,
                scale: l.scale ?? 1.0,
                radius: l.radius ?? 0.5,
                amount: l.amount ?? 1.0,
                rotation: l.rotation ?? 0.0,
                stretch: l.stretch ?? 0.0,
                maskPosX: l.maskPosX ?? 0.0,
                maskPosY: l.maskPosY ?? 0.0,
                maskSoftness: l.maskSoftness ?? 0.01,
                egs: l.egs ? l.egs.map(eg => ({
                    attack: eg.attack,
                    decay: eg.decay,
                    sustain: eg.sustain,
                    release: eg.release,
                    delay: eg.delay,
                    hold: eg.hold,
                    loop: eg.loop,
                    curveShape: eg.curveShape
                })) : undefined
            })),
            backgroundLayer: {
                enabled: this.backgroundState.enabled,
                material: {
                    type: this.backgroundState.material.type,
                    source: this.backgroundState.material.source,
                    params: { ...(this.backgroundState.material.params || {}) }
                }
            },
            master: { ...this.masterState }
        };
    },
    
    applyState(data) {
        if (!data) return;
        
        const layersToRecompile = [];
        
        if (data.layers && Array.isArray(data.layers)) {
            for (const layerData of data.layers) {
                const idx = layerData.index !== undefined ? layerData.index :
                            this.layers.findIndex(l => l.id === layerData.id);
                if (idx >= 0 && idx < this.layers.length) {
                    const layer = this.layers[idx];
                    
                    if (layerData.material && layerData.material.source) {
                        const newSource = layerData.material.source;
                        const oldSource = layer.material?.source || '';
                        if (newSource !== oldSource) {
                            layersToRecompile.push(idx);
                        }
                    }
                    
                    if (layerData.id !== undefined) layer.id = layerData.id;
                    if (layerData.name !== undefined) layer.name = layerData.name;
                    if (layerData.enabled !== undefined) layer.enabled = layerData.enabled;
                    if (layerData.solo !== undefined) layer.solo = layerData.solo;
                    if (layerData.opacity !== undefined) layer.opacity = layerData.opacity;
                    if (layerData.volume !== undefined) layer.volume = layerData.volume;
                    if (layerData.audioMuted !== undefined) layer.audioMuted = layerData.audioMuted;
                    if (layerData.blendMode !== undefined) layer.blendMode = layerData.blendMode;
                    if (layerData.material) {
                        layer.material = {
                            type: layerData.material.type || 'shader',
                            source: layerData.material.source || '',
                            params: layerData.material.params || {},
                            shaderRef: layerData.material.shaderRef || null
                        };
                    }
                    if (layerData.modulationMatrix !== undefined) layer.modulationMatrix = layerData.modulationMatrix;
                    if (layerData.voiceMode !== undefined) {
                        layer.voiceMode = layerData.voiceMode;
                        if (layer.voiceManager) layer.voiceManager.setVoiceMode(layerData.voiceMode);
                    }
                    if (layerData.glideTime !== undefined && layer.voiceManager) {
                        layer.voiceManager.setGlideTime(layerData.glideTime);
                    }
                    if (layerData.input !== undefined) {
                        layer.input = { ...layerData.input };
                    }
                    if (layerData.feedbackEnabled !== undefined) layer.feedbackEnabled = layerData.feedbackEnabled;
                    if (layerData.feedbackAmount !== undefined) layer.feedbackAmount = layerData.feedbackAmount;
                    if (layerData.feedbackDecay !== undefined) layer.feedbackDecay = layerData.feedbackDecay;
                    if (layerData.feedbackZoom !== undefined) layer.feedbackZoom = layerData.feedbackZoom;
                    if (layerData.feedbackRotate !== undefined) layer.feedbackRotate = layerData.feedbackRotate;
                    if (layerData.feedbackOffsetX !== undefined) layer.feedbackOffsetX = layerData.feedbackOffsetX;
                    if (layerData.feedbackOffsetY !== undefined) layer.feedbackOffsetY = layerData.feedbackOffsetY;
                    if (layerData.feedbackSaturation !== undefined) layer.feedbackSaturation = layerData.feedbackSaturation;
                    if (layerData.feedbackBrightness !== undefined) layer.feedbackBrightness = layerData.feedbackBrightness;
                    if (layerData.feedbackBlendMode !== undefined) layer.feedbackBlendMode = layerData.feedbackBlendMode;
                    layer.brightness = layerData.brightness !== undefined ? layerData.brightness : 1.0;
                    layer.speed = layerData.speed !== undefined ? layerData.speed : 1.0;
                    layer.posX = layerData.posX !== undefined ? layerData.posX : 0.0;
                    layer.posY = layerData.posY !== undefined ? layerData.posY : 0.0;
                    layer.scale = layerData.scale !== undefined ? layerData.scale : 1.0;
                    layer.radius = layerData.radius !== undefined ? layerData.radius : 0.5;
                    layer.amount = layerData.amount !== undefined ? layerData.amount : 1.0;
                    layer.rotation = layerData.rotation !== undefined ? layerData.rotation : 0.0;
                    layer.stretch = layerData.stretch !== undefined ? layerData.stretch : 0.0;
                    layer.maskPosX = layerData.maskPosX !== undefined ? layerData.maskPosX : 0.0;
                    layer.maskPosY = layerData.maskPosY !== undefined ? layerData.maskPosY : 0.0;
                    layer.maskSoftness = layerData.maskSoftness !== undefined ? layerData.maskSoftness : 0.01;
                    if (layerData.egs && Array.isArray(layerData.egs) && layer.egs) {
                        for (let i = 0; i < Math.min(layerData.egs.length, 4); i++) {
                            EGSystem.setEGParams(layer.egs[i], layerData.egs[i]);
                        }
                        layer.markEGsDirty();
                    }
                }
            }
        }
        
        if (data.backgroundLayer) {
            if (data.backgroundLayer.enabled !== undefined) this.backgroundState.enabled = data.backgroundLayer.enabled;
            if (data.backgroundLayer.material) {
                this.backgroundState.material = {
                    type: data.backgroundLayer.material.type || 'solid',
                    source: data.backgroundLayer.material.source || '#000000',
                    params: data.backgroundLayer.material.params || {}
                };
            }
        }
        
        if (data.master) {
            if (data.master.feedbackEnabled !== undefined) this.masterState.feedbackEnabled = data.master.feedbackEnabled;
            if (data.master.feedbackAmount !== undefined) this.masterState.feedbackAmount = data.master.feedbackAmount;
            if (data.master.feedbackDecay !== undefined) this.masterState.feedbackDecay = data.master.feedbackDecay;
            if (data.master.feedbackZoom !== undefined) this.masterState.feedbackZoom = data.master.feedbackZoom;
            if (data.master.feedbackRotate !== undefined) this.masterState.feedbackRotate = data.master.feedbackRotate;
            if (data.master.feedbackOffsetX !== undefined) this.masterState.feedbackOffsetX = data.master.feedbackOffsetX;
            if (data.master.feedbackOffsetY !== undefined) this.masterState.feedbackOffsetY = data.master.feedbackOffsetY;
            if (data.master.feedbackSaturation !== undefined) this.masterState.feedbackSaturation = data.master.feedbackSaturation;
            if (data.master.feedbackBrightness !== undefined) this.masterState.feedbackBrightness = data.master.feedbackBrightness;
            if (data.master.feedbackBlendMode !== undefined) this.masterState.feedbackBlendMode = data.master.feedbackBlendMode;
        }
        
        return layersToRecompile;
    }
};

// Reattach material renderers extracted into layerMedia.js. Methods are
// shorthand (not arrows) so `this` still binds to LayerSystem when called as
// this.renderImage(...) etc.
Object.assign(LayerSystem, layerMediaMethods);

// Media caches owned by layerMedia.js — reassigned here so existing
// this.imageCache-style access and external window.LayerSystem.imageCache
// lookups keep working unchanged.
Object.assign(LayerSystem, layerMediaState);
