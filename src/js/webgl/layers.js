/**
 * Layer System
 * Multi-layer shader system with blending modes
 */

import { state, getEl } from '../state.js';
import { BLEND_MODES, COMPOSITE_VS, COMPOSITE_FS, BACKGROUND_FS, PASSTHROUGH_FS, IMAGE_FS, FEEDBACK_FS, MAX_VOICES, VISUALIZER_TYPES, AUDIO_TEXTURE_WAVEFORM_UNIT, AUDIO_TEXTURE_SPECTRUM_UNIT, LAYER_PARAM_UNIFORMS } from '../config.js';
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
import { StreamingInputUI } from '../ui/streaming-input.js';
import { compileUtilityProgram, hexToRgb } from '../utils.js';

export class Layer {
    constructor(index, config) {
        config = config || {};
        this.index = index;
        this.id = config.id || `layer_${index}`;
        this.name = config.name || (index === 0 ? 'Main' : `Layer ${index}`);
        this.enabled = config.enabled !== undefined ? config.enabled : (index === 0);
        this.solo = config.solo !== undefined ? config.solo : false;
        this.opacity = config.opacity !== undefined ? config.opacity : (index === 0 ? 1.0 : 0.0);
        this.volume = config.volume !== undefined ? config.volume : 1.0;
        this.audioMuted = config.audioMuted !== undefined ? config.audioMuted : false;
        this.blendMode = config.blendMode || 'normal';
        this.material = config.material || { type: 'shader', source: '', params: {}, shaderRef: null };
        if (this.material.shaderRef === undefined) this.material.shaderRef = null;
        this.modulationMatrix = config.modulationMatrix || null;
        this.voiceMode = config.voiceMode || 'poly';
        this.input = config.input || {}; // MIDI input config: { channels: [], noteRange: [min, max] }

        // Per-layer feedback state
        this.feedbackEnabled = config.feedbackEnabled || false;
        this.feedbackAmount = config.feedbackAmount !== undefined ? config.feedbackAmount : 0.5;
        this.feedbackDecay = config.feedbackDecay !== undefined ? config.feedbackDecay : 0.9;
        this.feedbackZoom = config.feedbackZoom !== undefined ? config.feedbackZoom : 1.0;
        this.feedbackRotate = config.feedbackRotate !== undefined ? config.feedbackRotate : 0.0;
        this.feedbackOffsetX = config.feedbackOffsetX !== undefined ? config.feedbackOffsetX : 0.0;
        this.feedbackOffsetY = config.feedbackOffsetY !== undefined ? config.feedbackOffsetY : 0.0;
        this.feedbackSaturation = config.feedbackSaturation !== undefined ? config.feedbackSaturation : 1.0;
        this.feedbackBrightness = config.feedbackBrightness !== undefined ? config.feedbackBrightness : 1.0;
        this.feedbackBlendMode = config.feedbackBlendMode !== undefined ? config.feedbackBlendMode : 0;
        
        this.brainEnabled = config.brainEnabled || false;
        
        // VS 2 standard visual parameters
        this.brightness = config.brightness !== undefined ? config.brightness : 1.0;
        this.speed = config.speed !== undefined ? config.speed : 1.0;
        this.posX = config.posX !== undefined ? config.posX : 0.0;
        this.posY = config.posY !== undefined ? config.posY : 0.0;
        this.scale = config.scale !== undefined ? config.scale : 1.0;
        this.radius = config.radius !== undefined ? config.radius : 0.5;
        this.amount = config.amount !== undefined ? config.amount : 1.0;
        this.rotation = config.rotation !== undefined ? config.rotation : 0.0;
        this.stretch = config.stretch !== undefined ? config.stretch : 0.0;
        this.maskPosX = config.maskPosX !== undefined ? config.maskPosX : 0.0;
        this.maskPosY = config.maskPosY !== undefined ? config.maskPosY : 0.0;
        this.maskSoftness = config.maskSoftness !== undefined ? config.maskSoftness : 0.01;
        
        // Voice Manager instance — each layer gets its own
        this.voiceManager = new VoiceManager(MAX_VOICES, this);
        this.voiceManager.setVoiceMode(this.voiceMode);

        // Per-layer envelope generators (4 per layer)
        this.egs = Array.from({ length: 4 }, () => EGSystem.createEG());
        if (config.egs && Array.isArray(config.egs)) {
            for (let i = 0; i < 4; i++) {
                if (config.egs[i]) {
                    EGSystem.setEGParams(this.egs[i], config.egs[i]);
                }
            }
        }
        
        // Runtime GL state (not synced)
        this.program = null;
        this.voiceAware = false; // Set during compilation based on voiceMode
        this.voiceUniformLocs = null; // Cached voice uniform locations
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
        return Math.max(0, BLEND_MODES.indexOf(this.blendMode));
    }

    processEGs(deltaTime) {
        for (const eg of this.egs) {
            EGSystem.processEG(eg, deltaTime);
        }
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
    
    // Image texture cache: { sourceUrl -> { texture, width, height, loading, error } }
    imageCache: new Map(),
    
    // Video cache: { sourceUrl -> { video, texture, loading, error, ready } }
    videoCache: new Map(),
    
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
        return this.layers.some(l => l.solo && l.enabled);
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
        
        // Determine which layers to render
        const soloActive = this.hasSolo();
        const renderableLayers = this.layers.filter(layer => {
            if (!layer.enabled) return false;
            if (soloActive) return layer.solo;
            return true;
        });

        state.milkdropEnabled = renderableLayers.some(l => l.material?.type === 'milkdrop');
        
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
            
            // Copy feedback result to compositeFBO for final output
            gl.bindFramebuffer(gl.FRAMEBUFFER, FramebufferManager.compositeFBO.fbo);
            gl.viewport(0, 0, FramebufferManager.compositeFBO.width, FramebufferManager.compositeFBO.height);
            
            gl.useProgram(this.passthroughProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, FramebufferManager.feedbackFBO.texture);
            if (this.passthroughTexLoc) gl.uniform1i(this.passthroughTexLoc, 0);
            
            this._drawQuad(this.passthroughPosLoc);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        
        // 4. Final output
        const finalFBO = FramebufferManager.compositeFBO;
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

        const vm = layer.voiceManager;

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
                return;
            }
            this.renderText(layer, layerFBO);
            return;
        }

        // Handle image material type
        if (layer.material && layer.material.type === 'image') {
            // Skip if no image source
            if (!layer.material.source || layer.material.source.trim() === '') {
                return;
            }
            this.renderImage(layer, layerFBO);
            return;
        }

        // Handle video material type
        if (layer.material && layer.material.type === 'video') {
            // Skip if no video source
            if (!layer.material.source || layer.material.source.trim() === '') {
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
                return;
            }
            this.renderVideo(layer, layerFBO);
            return;
        }

        // Handle webcam material type
        if (layer.material && layer.material.type === 'webcam') {
            // Check if webcam is enabled and texture exists
            if (!state.videoEnabled || !state.videoTexture || !state.videoElement) {
                return;
            }
            this.renderWebcam(layer, layerFBO);
            return;
        }

        // Handle screen capture material type
        if (layer.material && layer.material.type === 'screen') {
            // Check if screen capture is enabled and texture exists
            if (!state.screenEnabled || !state.screenTexture || !state.screenElement) {
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
            }
            return;
        }

        // Handle milkdrop material type
        if (layer.material && layer.material.type === 'milkdrop') {
            if (!state.milkdropTexture) return;
            this.renderMilkdrop(layer, layerFBO);
            return;
        }

        // Handle scanimate material type
        if (layer.material && layer.material.type === 'scanimate') {
            ScanimateEngine.renderLayer(layer, layerFBO, currentTime);
            return;
        }

        // Handle WebSRT input type — upload latest decoded VideoFrame.
        if (layer.material && layer.material.type === 'websrt') {
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
                for (let i = 0; i < MAX_VOICES; i++) {
                    const isActive = layer.voiceMode === 'off' ? 0.0 : voiceUniforms.u_voiceActive[i];
                    const vOff = (_modVoiceUniforms && _modVoiceUniforms[i]) || {};
                    if (locs.active[i]) gl.uniform1f(locs.active[i], isActive);
                    if (locs.note[i]) gl.uniform1f(locs.note[i], voiceUniforms.u_voiceNote[i]);
                    if (locs.velocity[i]) gl.uniform1f(locs.velocity[i], voiceUniforms.u_voiceVelocity[i]);
                    if (locs.eg[i]) gl.uniform1f(locs.eg[i], voiceUniforms.u_voiceEG[i]);
                    if (locs.posX[i]) gl.uniform1f(locs.posX[i], voiceUniforms.u_voicePosX[i] + (vOff.posX || 0));
                    if (locs.posY[i]) gl.uniform1f(locs.posY[i], voiceUniforms.u_voicePosY[i] + (vOff.posY || 0));
                    if (locs.scale[i]) gl.uniform1f(locs.scale[i], voiceUniforms.u_voiceScale[i] + (vOff.scale || 0));
                    if (locs.rotation[i]) gl.uniform1f(locs.rotation[i], voiceUniforms.u_voiceRotation[i] + (vOff.rotation || 0));
                    if (locs.usePos[i]) gl.uniform1f(locs.usePos[i], voiceUniforms.u_voiceUsePos[i]);
                    if (locs.useScale[i]) gl.uniform1f(locs.useScale[i], voiceUniforms.u_voiceUseScale[i]);
                    if (locs.useRot[i]) gl.uniform1f(locs.useRot[i], voiceUniforms.u_voiceUseRot[i]);
                }
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

        this._drawQuad(layer.posLoc);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    
    _drawQuad(posLoc) {
        const gl = state.gl;
        if (!gl || posLoc < 0) return;
        
        gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
        
        // Create or update texture
        if (!this.textTexture) {
            this.textTexture = gl.createTexture();
        }
        
        gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, null);
        
        // Render texture to framebuffer using passthrough shader
        if (this.passthroughProgram) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, layerFBO.fbo);
            gl.viewport(0, 0, layerFBO.width, layerFBO.height);
            
            gl.useProgram(this.passthroughProgram);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
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

        if (!source) return;
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
        const frame = StreamingInputUI.latestVideoFrame(inputIndex);
        if (!frame) { this._clearLayerFBO(layerFBO); return; }

        // Lazy per-layer texture cache.
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

        // Upload only when a new VideoFrame is available. The PTS-paced
        // `latestVideoFrame` returns the same reference across multiple RAFs
        // when source fps < display fps (e.g., 30 fps OBS on a 60 Hz display
        // returns the same frame for ~2 RAFs); re-uploading the identical
        // bytes every RAF wastes GPU/host bandwidth and main-thread time.
        // Identity compare is correct — `displayedFrame` is a stable
        // reference until `_advanceDisplayedFrame` shifts it.
        if (entry.lastFrame !== frame) {
            gl.bindTexture(gl.TEXTURE_2D, entry.tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
            entry.w = frame.codedWidth || frame.displayWidth || entry.w;
            entry.h = frame.codedHeight || frame.displayHeight || entry.h;
            entry.lastFrame = frame;
        }

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
            ready: false
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

        if (!source) return;

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
            gl.bindTexture(gl.TEXTURE_2D, videoData.texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
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
        if (!state.videoEnabled || !state.videoTexture || !state.videoElement) return;
        
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
        if (!state.screenEnabled || !state.screenTexture || !state.screenElement) return;

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
