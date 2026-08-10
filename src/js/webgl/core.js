/**
 * WebGL Core Module
 * Handles WebGL context initialization and management
 */

import { state, getEl } from '../state.js';
import { VERTEX_SHADER, DEFAULT_SHADER_CODE, LAYER_UNIFORMS_DECL, VOICE_UNIFORMS_DECL, VOICE_SHADER_WRAPPER, MAX_VOICES, SHADER_BUILTINS, COMMON_CONSTANTS } from '../config.js';
import { Sync } from '../features/sync.js';
import { Shaders } from '../api/shaders.js';
import { LayerSystem } from './layers.js';
import { LayerMixer } from '../ui/layerMixer.js';
import { CodeDials } from '../ui/codeDials.js';
import { Conversation } from '../api/conversation.js';
import { FramebufferManager } from './framebuffers.js';

import { LFOEngine } from '../features/lfoEngine.js';
import { updateEGVisualization } from '../ui/egPanel.js';
import { modulationMatrixUI } from '../ui/modulationMatrixUI.js';
import { NodeGraph } from '../ui/nodeGraph.js';
import { StreamingUI } from '../ui/streaming.js';

let lastFrameTime = performance.now();

export const WebGL = {
    init() {
        state.canvas = getEl('canvas');
        state.gl = state.canvas.getContext('webgl2', { preserveDrawingBuffer: false });
        if (!state.gl) {
            alert('WebGL2 not supported... Time to upgrade your hardware.');
            return false;
        }

        const cbf = state.gl.getExtension('EXT_color_buffer_float');
        state.glExtensions.colorBufferFloat = !!cbf;

        const cbhf = state.gl.getExtension('EXT_color_buffer_half_float');
        state.glExtensions.colorBufferHalfFloat = !!cbhf;

        const fl = state.gl.getExtension('OES_texture_float_linear');
        state.glExtensions.floatLinear = !!fl;

        FramebufferManager.probeFormats();

        this.setupQuad();
        this.resize();
        window.addEventListener('resize', () => this.resize());

        state.canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            state.contextLost = true;
            console.warn('WebGL context lost — waiting for restore');
        }, false);

        state.canvas.addEventListener('webglcontextrestored', () => {
            console.log('WebGL context restored — reinitializing');
            state.contextLost = false;
            const cbf = state.gl.getExtension('EXT_color_buffer_float');
            state.glExtensions.colorBufferFloat = !!cbf;
            const cbhf = state.gl.getExtension('EXT_color_buffer_half_float');
            state.glExtensions.colorBufferHalfFloat = !!cbhf;
            const fl = state.gl.getExtension('OES_texture_float_linear');
            state.glExtensions.floatLinear = !!fl;
            FramebufferManager.probeFormats();
            FramebufferManager.init(state.canvas.width, state.canvas.height);
            this.setupQuad();
            LayerSystem.compileUtilityPrograms();
            for (let i = 0; i < LayerSystem.layers.length; i++) {
                const layer = LayerSystem.layers[i];
                if (layer.material?.source) {
                    this.compileForLayer(i);
                }
            }
            if (state.program) {
                this.render();
            }
        }, false);

        return true;
    },
    
    resize() {
        const fixed = /^(\d+)x(\d+)$/.exec(state.resolutionScale);
        if (fixed) {
            state.canvas.width = parseInt(fixed[1], 10);
            state.canvas.height = parseInt(fixed[2], 10);
        } else {
            const scale = state.resolutionScale === 'dpr'
                ? (window.devicePixelRatio || 1)
                : (parseFloat(state.resolutionScale) || 1);
            state.canvas.width = Math.round(window.innerWidth * scale);
            state.canvas.height = Math.round(window.innerHeight * scale);
        }
        state.gl.viewport(0, 0, state.canvas.width, state.canvas.height);
        FramebufferManager.resize(state.canvas.width, state.canvas.height);
    },
    
    setupQuad() {
        const positions = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
        state.quadBuffer = state.gl.createBuffer();
        state.gl.bindBuffer(state.gl.ARRAY_BUFFER, state.quadBuffer);
        state.gl.bufferData(state.gl.ARRAY_BUFFER, positions, state.gl.STATIC_DRAW);
    },
    
    createShader(type, source) {
        const shader = state.gl.createShader(type);
        state.gl.shaderSource(shader, source);
        state.gl.compileShader(shader);
        if (!state.gl.getShaderParameter(shader, state.gl.COMPILE_STATUS)) {
            const error = state.gl.getShaderInfoLog(shader);
            return { error, type: type === state.gl.VERTEX_SHADER ? 'vertex' : 'fragment' };
        }
        return shader;
    },
    
    extractParams(code) {
        const params = [];
        const normalizedCode = code.replace(/\r\n/g, '\n');
        const lines = normalizedCode.split('\n');
        let globalPos = 0;
        let idx = 0;

        for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('#')) {
                globalPos += line.length + 1;
                continue;
            }
            
            if (trimmedLine.startsWith('const ')) {
                globalPos += line.length + 1;
                continue;
            }
            
            const isForLoop = trimmedLine.startsWith('for') || line.includes('for(');
            let inForLoopExpr = false;
            let parenDepth = 0;
            let inArrayBrackets = false;
            let bracketDepth = 0;
            let sawIdentifierBeforeBracket = false;
            let i = 0;
            
            while (i < line.length) {
                if (line[i] === '/' && line[i+1] === '/') {
                    break;
                }
                
                if (line.trim().length === 0) {
                    i++;
                    continue;
                }
                
                if (isForLoop) {
                    if (line[i] === '(') {
                        parenDepth++;
                        inForLoopExpr = true;
                    }
                    if (line[i] === ')') {
                        parenDepth--;
                        if (parenDepth <= 0) {
                            inForLoopExpr = false;
                        }
                    }
                }
                
                if (line[i] === '[') {
                    bracketDepth++;
                    const before = line.substring(0, i);
                    sawIdentifierBeforeBracket = /[a-zA-Z_]\w*\s*$/.test(before);
                    inArrayBrackets = true;
                }
                if (line[i] === ']') {
                    bracketDepth--;
                    if (bracketDepth <= 0) {
                        inArrayBrackets = false;
                        sawIdentifierBeforeBracket = false;
                    }
                }
                
                if (inForLoopExpr) {
                    i++;
                    continue;
                }
                
                if (inArrayBrackets && bracketDepth === 1 && sawIdentifierBeforeBracket) {
                    const before = line.substring(0, i).toLowerCase();
                    const isDeclaration = /\b(vec|mat|int|float|uint|bool|sampler)\d*\s+[a-zA-Z_]/.test(before);
                    if (isDeclaration) {
                        i++;
                        continue;
                    }
                }
                
                if (i > 0 && /[a-zA-Z_]/.test(line[i-1])) {
                    i++;
                    continue;
                }
                
                const numMatch = line.substring(i).match(/^(-?\d+(\.\d+)?([eE][-+]?\d+)?)/);
                if (numMatch) {
                    const numStr = numMatch[0];
                    const num = parseFloat(numStr);
                    const nextChar = line[i + numStr.length];
                    
                    if (numStr.endsWith('.')) {
                        i++;
                        continue;
                    }
                    
                    if (!isNaN(num) && numStr.length > 0 && 
                        !SHADER_BUILTINS.has(numStr) && 
                        !COMMON_CONSTANTS.has(numStr) &&
                        !(nextChar && /[a-zA-Z_]/.test(nextChar))) {
                        params.push({
                            key: 'cd' + idx,
                            originalValue: num,
                            currentValue: num,
                            pos: globalPos + i,
                            str: numStr
                        });
                        idx++;
                        i += numStr.length;
                        continue;
                    } else {
                        i += numStr.length;
                        continue;
                    }
                }
                i++;
            }
            globalPos += line.length + 1;
        }
        return params;
    },
    
    transformShaderWithUniforms(code, params) {
        const sorted = [...params].sort((a, b) => b.pos - a.pos);
        let transformed = code;
        
        for (const param of sorted) {
            const uniformName = `u_param_${param.key}`;
            transformed = transformed.substring(0, param.pos) + uniformName + transformed.substring(param.pos + param.str.length);
        }
        
        return transformed;
    },
    
    compileProgram(fsBody, useUniforms = true) {
        let params = [];
        let transformedBody = fsBody;

        if (useUniforms && state.useUniformParams) {
            params = this.extractParams(fsBody);
            if (params.length > 0) {
                transformedBody = this.transformShaderWithUniforms(fsBody, params);
            }
        }

        let paramUniforms = '';
        if (params.length > 0) {
            paramUniforms = '\n// Auto-generated parameter uniforms\n';
            params.forEach(p => {
                paramUniforms += `uniform float u_param_${p.key};\n`;
            });
        }

        const strippedBody = transformedBody
            .replace(/^\s*#version\s+.*$/gm, '')
            .replace(/^\s*precision\s+.*$/gm, '')
            .replace(/^\s*uniform\s+.*$/gm, '')
            .replace(/\bout\s+(?:highp\s+|mediump\s+|lowp\s+)?vec4\s+fragColor\s*;/, '');

        const header = `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime;${paramUniforms}
uniform sampler2D iVideo;
uniform sampler2D iScreen;
uniform sampler2D iLayerVideo;
uniform sampler2D iLayerImage;
uniform sampler2D iLayerSRT;
uniform vec2 u_layerTexRes;
uniform sampler2D u_audioWaveform;
uniform sampler2D u_audioSpectrum;
${LAYER_UNIFORMS_DECL}
${VOICE_UNIFORMS_DECL}
out vec4 fragColor;
`;
        const fsSource = header + strippedBody;

        const vs = this.createShader(state.gl.VERTEX_SHADER, VERTEX_SHADER);
        const fs = this.createShader(state.gl.FRAGMENT_SHADER, fsSource);

        if (vs?.error) return { error: `Vertex shader error: ${vs.error}`, transformedSource: fsSource };
        if (fs?.error) return { error: `Fragment shader error: ${fs.error}`, transformedSource: fsSource };
        if (!vs || !fs) return { error: 'Unknown shader creation error', transformedSource: fsSource };

        const prog = state.gl.createProgram();
        state.gl.attachShader(prog, vs);
        state.gl.attachShader(prog, fs);
        state.gl.linkProgram(prog);

        if (!state.gl.getProgramParameter(prog, state.gl.LINK_STATUS)) {
            const error = state.gl.getProgramInfoLog(prog);
            state.gl.deleteShader(vs);
            state.gl.deleteShader(fs);
            return { error: `Program link error: ${error}`, transformedSource: fsSource };
        }

        state.gl.deleteShader(vs);
        state.gl.deleteShader(fs);

        const voiceUniformLocs = this._cacheVoiceUniformLocations(prog);

        return { program: prog, params, voiceAware: true, voiceUniformLocs, transformedSource: fsSource };
    },
    
    /**
     * Cache voice uniform locations for efficient per-frame setting
     * @param {WebGLProgram} program
     * @returns {object} Cached uniform locations
     */
    _cacheVoiceUniformLocations(program) {
        const gl = state.gl;
        if (!gl || !program) return null;
        
        const locs = {
            active: [],
            note: [],
            velocity: [],
            posX: [],
            posY: [],
            scale: [],
            rotation: [],
            usePos: [],
            useScale: [],
            useRot: [],
            eg: [],
            eg0: gl.getUniformLocation(program, 'u_eg0'),
            eg1: gl.getUniformLocation(program, 'u_eg1'),
            eg2: gl.getUniformLocation(program, 'u_eg2'),
            eg3: gl.getUniformLocation(program, 'u_eg3'),
            pitchBend: gl.getUniformLocation(program, 'u_pitchBend'),
            channelPressure: gl.getUniformLocation(program, 'u_channelPressure'),
            kbdNote: gl.getUniformLocation(program, 'u_kbdNote')
        };
        
        for (let i = 0; i < MAX_VOICES; i++) {
            locs.active.push(gl.getUniformLocation(program, `u_voiceActive[${i}]`));
            locs.note.push(gl.getUniformLocation(program, `u_voiceNote[${i}]`));
            locs.velocity.push(gl.getUniformLocation(program, `u_voiceVelocity[${i}]`));
            locs.eg.push(gl.getUniformLocation(program, `u_voiceEG[${i}]`));
            locs.posX.push(gl.getUniformLocation(program, `u_voicePosX[${i}]`));
            locs.posY.push(gl.getUniformLocation(program, `u_voicePosY[${i}]`));
            locs.scale.push(gl.getUniformLocation(program, `u_voiceScale[${i}]`));
            locs.rotation.push(gl.getUniformLocation(program, `u_voiceRotation[${i}]`));
            locs.usePos.push(gl.getUniformLocation(program, `u_voiceUsePos[${i}]`));
            locs.useScale.push(gl.getUniformLocation(program, `u_voiceUseScale[${i}]`));
            locs.useRot.push(gl.getUniformLocation(program, `u_voiceUseRot[${i}]`));
        }
        
        // Layer parameter uniform locations
        locs.layerParams = {
            brightness: gl.getUniformLocation(program, 'u_brightness'),
            speed: gl.getUniformLocation(program, 'u_speed'),
            posX: gl.getUniformLocation(program, 'u_posX'),
            posY: gl.getUniformLocation(program, 'u_posY'),
            scale: gl.getUniformLocation(program, 'u_scale'),
            radius: gl.getUniformLocation(program, 'u_radius'),
            amount: gl.getUniformLocation(program, 'u_amount'),
            rotation: gl.getUniformLocation(program, 'u_rotation'),
            stretch: gl.getUniformLocation(program, 'u_stretch'),
            maskPosX: gl.getUniformLocation(program, 'u_maskPosX'),
            maskPosY: gl.getUniformLocation(program, 'u_maskPosY'),
            maskSoftness: gl.getUniformLocation(program, 'u_maskSoftness')
        };

        return locs;
    },
    
    initShader(opts = {}) {
        const code = getEl('shaderCode').value;
        const result = this.compileProgram(code, state.useUniformParams);
        
        if (result?.error) {
            return { error: result.error };
        }
        
        if (result && result.program) {
            const selectedLayer = LayerSystem.layers[state.selectedLayer];
            if (selectedLayer) {
                if (selectedLayer.program) {
                    state.gl.deleteProgram(selectedLayer.program);
                }
                
                selectedLayer.program = result.program;
                selectedLayer._modulationUniformLocs.clear();
                selectedLayer.voiceAware = !!result.voiceAware;
                selectedLayer.voiceUniformLocs = result.voiceUniformLocs || null;
                selectedLayer.timeLoc = state.gl.getUniformLocation(result.program, 'iTime');
                selectedLayer.resLoc = state.gl.getUniformLocation(result.program, 'iResolution');
                selectedLayer.videoLoc = state.gl.getUniformLocation(result.program, 'iVideo');
                selectedLayer.screenLoc = state.gl.getUniformLocation(result.program, 'iScreen');
                selectedLayer.layerVideoLoc = state.gl.getUniformLocation(result.program, 'iLayerVideo');
                selectedLayer.layerImageLoc = state.gl.getUniformLocation(result.program, 'iLayerImage');
                selectedLayer.layerSrtLoc = state.gl.getUniformLocation(result.program, 'iLayerSRT');
                selectedLayer.layerTexResLoc = state.gl.getUniformLocation(result.program, 'u_layerTexRes');
                selectedLayer.audioWaveformLoc = state.gl.getUniformLocation(result.program, 'u_audioWaveform');
                selectedLayer.audioSpectrumLoc = state.gl.getUniformLocation(result.program, 'u_audioSpectrum');
                selectedLayer.posLoc = state.gl.getAttribLocation(result.program, 'position');
                
                selectedLayer.shaderParams = [];
                if (result.params) {
                    for (const param of result.params) {
                        const location = state.gl.getUniformLocation(result.program, `u_param_${param.key}`);
                        selectedLayer.shaderParams.push({
                            key: param.key,
                            location: location,
                            originalValue: param.originalValue,
                            currentValue: param.originalValue
                        });
                    }
                }
                
                selectedLayer.material.source = code;
                selectedLayer.enabled = true;
                
                // Only sync global state for layer 0 (legacy compatibility)
                if (state.selectedLayer === 0) {
                    if (state.program) state.gl.deleteProgram(state.program);
                    state.program = result.program;
                    state.timeLoc = selectedLayer.timeLoc;
                    state.resLoc = selectedLayer.resLoc;
                    state.videoLoc = selectedLayer.videoLoc;
                    state.screenLoc = selectedLayer.screenLoc;
                    state.shaderParams = selectedLayer.shaderParams;
                }
                
                Sync.send(LayerSystem.getState());
            }
            
            state.shaderParams = selectedLayer ? selectedLayer.shaderParams : [];
            state.codeDialValues = {};
            state.codeDialOriginals = {};
            if (result.params) {
                for (const param of result.params) {
                    state.codeDialValues[param.key] = param.originalValue;
                    state.codeDialOriginals[param.key] = param.originalValue;
                }
            }
            
            const timeMatch = code.match(/iTime\s*\*\s*([0-9.]+)/i);
            const mult = timeMatch ? parseFloat(timeMatch[1]) : 1;
            state.loopSeconds = (2 * Math.PI) / mult;
            
            if (!state.floatingDialEl) {
                CodeDials.render();
            }
            
            if (opts.save) Shaders.save(code);
            
            if (state.renderStarted) {
                LayerMixer.updateUI();
            }

            Sync.send({
                shaderCode: code,
                codeDialValues: { ...state.codeDialValues },
                codeDialOriginals: { ...state.codeDialOriginals }
            });

            // Start render loop if not already running
            if (!state.renderStarted) {
                state.renderStarted = true;
                state.canvas.classList.add('rendering');
                this.render();
            }

            return { success: true };
        }
        return { error: 'Unknown compilation error' };
    },
    
    compileForLayer(layerIndex) {
        const layer = LayerSystem.layers[layerIndex];
        if (!layer || !layer.material.source) {
            return { error: 'No shader source' };
        }
        
        const result = this.compileProgram(layer.material.source, state.useUniformParams);
        
        if (result?.error) {
            return { error: result.error };
        }
        
        if (result && result.program) {
            const ownedGlobal = (layer.program != null && state.program === layer.program);
            if (layer.program) {
                if (ownedGlobal) state.program = null;
                state.gl.deleteProgram(layer.program);
            }
            
            layer.program = result.program;
            layer._modulationUniformLocs.clear();
            layer.voiceAware = !!result.voiceAware;
            layer.voiceUniformLocs = result.voiceUniformLocs || null;
            layer.timeLoc = state.gl.getUniformLocation(result.program, 'iTime');
            layer.resLoc = state.gl.getUniformLocation(result.program, 'iResolution');
            layer.videoLoc = state.gl.getUniformLocation(result.program, 'iVideo');
            layer.screenLoc = state.gl.getUniformLocation(result.program, 'iScreen');
            layer.layerVideoLoc = state.gl.getUniformLocation(result.program, 'iLayerVideo');
            layer.layerImageLoc = state.gl.getUniformLocation(result.program, 'iLayerImage');
            layer.layerSrtLoc = state.gl.getUniformLocation(result.program, 'iLayerSRT');
            layer.layerTexResLoc = state.gl.getUniformLocation(result.program, 'u_layerTexRes');
            layer.audioWaveformLoc = state.gl.getUniformLocation(result.program, 'u_audioWaveform');
            layer.audioSpectrumLoc = state.gl.getUniformLocation(result.program, 'u_audioSpectrum');
            layer.posLoc = state.gl.getAttribLocation(result.program, 'position');
            
            layer.shaderParams = [];
            if (result.params) {
                for (const param of result.params) {
                    const location = state.gl.getUniformLocation(result.program, `u_param_${param.key}`);
                    layer.shaderParams.push({
                        key: param.key,
                        location: location,
                        originalValue: param.originalValue,
                        currentValue: param.originalValue
                    });
                }
            }

            if (ownedGlobal || layerIndex === state.selectedLayer) {
                state.program = result.program;
                state.timeLoc = layer.timeLoc;
                state.resLoc = layer.resLoc;
                state.videoLoc = layer.videoLoc;
                state.screenLoc = layer.screenLoc;
                state.shaderParams = layer.shaderParams;
            }
            
            return { success: true };
        }
        
        return { error: 'Unknown compilation error' };
    },
    
    render() {
        if (!state.program || state.contextLost) return;
        state.gl.useProgram(state.program);

        let currentTime = 0;
        if (state.isPaused) {
            const percent = parseInt(getEl('timeSlider').value) / 10;
            const fine = parseInt(getEl('timeSliderFine').value) / 10;
            currentTime = ((percent + fine) / 100 * state.loopSeconds);
        } else {
            const elapsed = (Date.now() - state.startTime) / 1000;
            state.manualTime = elapsed;
            currentTime = elapsed;
        }

        state.gl.uniform1f(state.timeLoc, currentTime);
        state.gl.uniform3f(state.resLoc, state.canvas.width, state.canvas.height, 1.0);

        const frameNow = performance.now();
        const deltaTime = Math.min((frameNow - lastFrameTime) / 1000, 0.1);
        lastFrameTime = frameNow;

        LFOEngine.process(deltaTime);

        // Process per-layer envelope generators
        for (const layer of LayerSystem.layers) {
            layer.processEGs(deltaTime);
        }
        if (state.frameCount % 6 === 0) {
            const sel = LayerSystem.layers[state.selectedLayer];
            if (sel) {
                for (let i = 0; i < 4; i++) {
                    let eg = sel.egs[i];
                    if (sel.voiceManager && sel.voiceManager.voices) {
                        const activeVoice = sel.voiceManager.voices.find(v => v.active && v.egs && v.egs[i]);
                        if (activeVoice) eg = activeVoice.egs[i];
                    }
                    updateEGVisualization(i, eg);
                }
            }
            modulationMatrixUI.updateVisualizer();
            LayerMixer.updateModulatedSliders();
            CodeDials.updateModArc();
            NodeGraph.refresh();
        }

        if (state.frameCount % 6 === 0 && !state.isPaused) {
            const elapsed = (Date.now() - state.startTime) / 1000;
            const pct = ((elapsed % state.loopSeconds) / state.loopSeconds);
            getEl('timeSlider').value = Math.floor(pct * 1000);
            const fill = getEl('timeSliderWrap')?.querySelector('.slider__fill');
            if (fill) fill.style.setProperty('--fill-width', (pct * 100) + '%');
            getEl('timeDisplay').textContent = Math.round(pct * 100) + '%';
        }

        if (LayerSystem.compositeProgram && LayerSystem.layers.length > 0) {
            if (state.selectedLayer === 0 && state.program && LayerSystem.layers[0]) {
                LayerSystem.layers[0].program = state.program;
                LayerSystem.layers[0].timeLoc = state.timeLoc;
                LayerSystem.layers[0].resLoc = state.resLoc;
                LayerSystem.layers[0].videoLoc = state.videoLoc;
                LayerSystem.layers[0].screenLoc = state.screenLoc;
                LayerSystem.layers[0].shaderParams = state.shaderParams || [];
            }
            LayerSystem.render(currentTime, deltaTime);
        }

        if (state.capturePending) {
            const resolve = state.capturePending;
            state.capturePending = null;
            resolve(state.canvas.toDataURL('image/png'));
        }

        if (StreamingUI.isStreaming || StreamingUI.isRecording) {
            StreamingUI.captureFrame();
        }

        state.frameCount++;
        requestAnimationFrame(() => this.render());
    }
};
