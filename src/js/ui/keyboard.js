/**
 * Keyboard Module
 * Handles keyboard shortcuts and hotkeys
 */

import { state, getEl, momentaryKeys } from '../state.js';
import { DIAL_KEY_MAP } from '../config.js';
import { LayerMixer } from './layerMixer.js';
import { LayerSystem } from '../webgl/layers.js';
import { Shaders } from '../api/shaders.js';
import { Sync } from '../features/sync.js';
import { saveState, saveShadersOnly, loadShadersOnly, loadState } from './persistence.js';
import { escapeHtml, toggleFullscreen } from '../utils.js';
import { RecorderUI } from './recorder.js';
import { StreamingUI } from './streaming.js';
import { FeedbackUI } from './feedback.js';
import { WebGL } from '../webgl/core.js';
import { CodeDials } from './codeDials.js';
import { Conversation } from '../api/conversation.js';
import { PlaylistSystem } from '../features/playlist.js';
import { MilkdropFeature } from '../features/milkdrop.js';
import { ContentBrowser } from './contentBrowser.js';

export const Keyboard = {
    init() {
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
    },
    
    isTypingInInput() {
        const active = document.activeElement;
        if (!active) return false;
        return active.tagName === 'INPUT' || 
               active.tagName === 'TEXTAREA' || 
               active.tagName === 'SELECT' ||
               active.isContentEditable;
    },
    
    handleKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Backspace') {
            e.preventDefault();
            if (confirm('Master reset: clear ALL settings and state?')) {
                localStorage.clear();
                location.reload();
            }
            return;
        }

        // Ctrl+Insert: Start/Stop live stream (must precede the bare Insert crossfade handler below)
        if ((e.ctrlKey || e.metaKey) && e.key === 'Insert') {
            e.preventDefault();
            StreamingUI.isStreaming ? StreamingUI.stop() : StreamingUI.start();
            return;
        }

        // Ctrl+Shift+S: Save shaders list only (must precede the Ctrl+S handler below)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            saveShadersOnly();
            return;
        }

        // Global shortcuts
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            saveState();
        }
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            toggleFullscreen();
        }
        
        if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
            e.preventDefault();
        }
        
        // Ctrl+Shift+R: Start/Stop recording
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
            e.preventDefault();
            RecorderUI.isRecording ? RecorderUI.stopRecording() : RecorderUI.startRecording();
            return;
        }
        
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
            const keyNum = parseInt(e.key);
            if (keyNum >= 1 && keyNum <= 8) {
                e.preventDefault();
                LayerMixer.selectLayer(keyNum - 1);
            }
        }
        
        // Shift+1-8: Toggle layer enabled
        if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const codeMatch = e.code?.match(/^Digit(\d)$/);
            if (codeMatch) {
                const keyNum = parseInt(codeMatch[1]);
                if (keyNum >= 1 && keyNum <= 8) {
                    e.preventDefault();
                    const layer = LayerSystem.layers[keyNum];
                    if (layer) {
                        layer.enabled = !layer.enabled;
                        LayerMixer.updateUI();
                        LayerMixer.sendUpdate();
                    }
                    return;
                }
            }
        }
        
        // Ctrl+Shift+L: Toggle modulation matrix
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
            e.preventDefault();
            const voicesBtn = document.querySelector('.tool-btn--module[data-module="voices"]');
            const voicesPanel = document.querySelector('.content-panel[data-panel="voices"]');
            if (voicesBtn && voicesPanel) {
                document.querySelectorAll('.tool-btn--module').forEach(b => b.classList.remove('active'));
                voicesBtn.classList.add('active');
                document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('content-panel--active'));
                voicesPanel.classList.add('content-panel--active');
            }
            const matrixSection = document.getElementById('modulation-grid-section');
            if (matrixSection) matrixSection.scrollIntoView({ behavior: 'smooth' });
            return;
        }
        
        // ` or ~ : Toggle feedback
        if (e.key === '`' || e.key === '~') {
            e.preventDefault();
            LayerSystem.masterState.feedbackEnabled = !LayerSystem.masterState.feedbackEnabled;
            FeedbackUI.updateFromState();
            Sync.send(LayerSystem.getState());
            return;
        }
        
        if (this.isTypingInInput()) return;

        if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (e.key === 'Delete') {
                e.preventDefault();
                const currentIndex = state.savedShaders.findIndex(s => s.id === state.currentShaderId);
                if (currentIndex >= 0) {
                    const deletedShader = state.savedShaders[currentIndex];
                    const deletedName = deletedShader.name;

                    state.savedShaders.splice(currentIndex, 1);
                    Sync.send({ savedShaders: state.savedShaders });

                    if (state.savedShaders.length === 0) {
                        state.currentShaderId = null;
                        Shaders.render();
                        const status = getEl('status');
                        status.innerHTML = `⌨️ <span class="status-highlight-red">Shift+Delete</span> Deleted: <span class="status-highlight-cyan">${escapeHtml(deletedName)}</span> (no shaders left)`;
                        setTimeout(() => status.textContent = '', 2000);
 
                    } else {
                        const loadIndex = currentIndex < state.savedShaders.length ? currentIndex : state.savedShaders.length - 1;
                        const shader = state.savedShaders[loadIndex];
                        state.currentShaderId = shader.id;
                        getEl('shaderCode').value = shader.code;
                        WebGL.initShader();
                        CodeDials.render();
                        Conversation.updateTokenCount();
                        Shaders.render();

                        const status = getEl('status');
                        status.innerHTML = `⌨️ <span class="status-highlight-red">Shift+Delete</span> Deleted: <span class="status-highlight-cyan">${escapeHtml(deletedName)}</span> → Loaded: <span class="status-highlight-green">${escapeHtml(shader.name)}</span>`;
                        setTimeout(() => status.textContent = '', 2000);
 
                    }
                }
                return;
            }
        }

        // +/- : Next/Previous shader
        if (e.key === '=' || e.key === '+') {
            e.preventDefault();
            this._navigateShader(1);
            return;
        }
        if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            this._navigateShader(-1);
            return;
        }

        // Spacebar: Pause/Play / Ctrl+Shift+Space: Playlist toggle
        if (e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            if (e.ctrlKey && e.shiftKey) {
                // Ctrl+Shift+Space: Start/Stop playlist
                PlaylistSystem.isPlaying ? PlaylistSystem.stop() : PlaylistSystem.start();
            } else {
                // Space: Pause/Play time
                getEl('pausePlay').click();
            }
        }

        // Tab: Toggle bottom panel
        if (e.key === 'Tab') {
            e.preventDefault();
            const bottomPanel = document.getElementById('bottom-panel');
            const hideBtn = document.getElementById('view-hide-btn');
            if (bottomPanel) {
                bottomPanel.classList.toggle('hidden');
                const isHidden = bottomPanel.classList.contains('hidden');
                if (hideBtn) {
                    hideBtn.textContent = isHidden ? 'Show' : 'Hide';
                    hideBtn.classList.toggle('active', isHidden);
                }
            }
        }
        
        // Code dial controls
        if (!e.ctrlKey && !e.metaKey) {
            const dialIndex = DIAL_KEY_MAP.indexOf(e.key.toLowerCase());
            if (dialIndex >= 0) {
                const dialKey = 'cd' + dialIndex;
                const selectedLayer = LayerSystem.layers[state.selectedLayer];
                const param = selectedLayer?.shaderParams?.find(p => p.key === dialKey);
                if (!param) return;
                
                const keyLower = e.key.toLowerCase();
                
                if (e.altKey && e.shiftKey) {
                    e.preventDefault();
                    const originalValue = param.originalValue;
                    param.currentValue = originalValue;
                    state.codeDialValues[dialKey] = originalValue;
                    Sync.sendDialDebounced({ [dialKey]: originalValue });
                    return;
                }
                
                if (e.altKey) {
                    e.preventDefault();
                    const newValue = param.currentValue / 2;
                    param.currentValue = newValue;
                    state.codeDialValues[dialKey] = newValue;
                    Sync.sendDialDebounced({ [dialKey]: newValue });
                    return;
                }
                
                if (e.shiftKey) {
                    e.preventDefault();
                    const newValue = param.currentValue * 2;
                    param.currentValue = newValue;
                    state.codeDialValues[dialKey] = newValue;
                    Sync.sendDialDebounced({ [dialKey]: newValue });
                    return;
                }
                
                e.preventDefault();
                if (!momentaryKeys.has(dialKey)) {
                    momentaryKeys.set(dialKey, param.currentValue);
                    const newValue = param.currentValue * 2;
                    param.currentValue = newValue;
                    state.codeDialValues[dialKey] = newValue;
                    Sync.sendDialDebounced({ [dialKey]: newValue });
                }
            }
            
            // Backspace: Reset all dials
            if (e.key === 'Backspace') {
                e.preventDefault();
                const selectedLayer = LayerSystem.layers[state.selectedLayer];
                if (!selectedLayer?.shaderParams) return;
                
                let resetCount = 0;
                const resetVals = {};
                for (const param of selectedLayer.shaderParams) {
                    if (param.key.startsWith('cd')) {
                        param.currentValue = param.originalValue;
                        state.codeDialValues[param.key] = param.originalValue;
                        resetVals[param.key] = param.originalValue;
                        resetCount++;
                    }
                }
                momentaryKeys.clear();
                
                if (resetCount > 0) {
                    Sync.sendDialDebounced(resetVals);
                }
            }
            
            // Number keys 1-8 select layers
            if (!e.shiftKey && !e.altKey) {
                const keyCode = e.keyCode;
                if (keyCode >= 49 && keyCode <= 56) {
                    e.preventDefault();
                    LayerMixer.selectLayer(keyCode - 49);
                }
            }

            // Insert key triggers switch (crossfade)
            if (e.keyCode === 45) {
                e.preventDefault();
                LayerMixer.crossfadeToSelected();
            }

            // Delete key switches to previous layer
            if (e.keyCode === 46) {
                e.preventDefault();
                LayerMixer.selectLayer(state.previousLayer);
            }
        }
    },
    
    async _navigateShader(direction) {
        const selectedLayer = LayerSystem.layers[state.selectedLayer];
        const type = selectedLayer?.material?.type;

        if (type === 'milkdrop') {
            if (MilkdropFeature.presetCount === 0) return;
            if (direction > 0) {
                MilkdropFeature.nextPreset();
            } else {
                MilkdropFeature.prevPreset();
            }
            const newIdx = MilkdropFeature.currentIndex;
            LayerMixer.syncAllMilkdropLayers(newIdx);
            LayerMixer.refreshAllMilkdropDropdowns();
            LayerMixer.sendUpdate();
            return;
        }

        if (type !== 'shader' && type !== undefined) return;

        const allShaders = [];
        for (const s of state.savedShaders) {
            allShaders.push({ type: 'saved', id: s.id, name: s.name, code: s.code });
        }
        for (const s of (ContentBrowser._manifest?.shaders || [])) {
            allShaders.push({ type: 'factory', id: s.id, name: s.name });
        }
        if (allShaders.length === 0) return;

        const ref = selectedLayer?.material?.shaderRef;
        let currentIndex = -1;
        if (ref) {
            currentIndex = allShaders.findIndex(s => s.type === ref.type && s.id === ref.id);
        }
        if (currentIndex < 0) currentIndex = state.currentShaderId
            ? allShaders.findIndex(s => s.type === 'saved' && s.id === state.currentShaderId)
            : -1;

        let nextIndex = currentIndex < 0 ? 0 : currentIndex + direction;
        if (nextIndex < 0 || nextIndex >= allShaders.length) return;

        const target = allShaders[nextIndex];
        let code = target.code || null;
        if (target.type === 'factory') {
            code = await ContentBrowser.getShaderCode(target.id);
        }
        if (!code) return;

        if (target.type === 'saved') state.currentShaderId = target.id;

        getEl('shaderCode').value = code;
        if (selectedLayer) {
            selectedLayer.material.source = code;
            selectedLayer.material.shaderRef = { type: target.type, id: target.id };
            WebGL.initShader();
        } else {
            WebGL.initShader();
        }

        CodeDials.render();
        Conversation.updateTokenCount();
        Shaders.render();
    },

    handleKeyUp(e) {
        const dialIndex = DIAL_KEY_MAP.indexOf(e.key.toLowerCase());
        if (dialIndex >= 0) {
            const dialKey = 'cd' + dialIndex;
            if (momentaryKeys.has(dialKey)) {
                const selectedLayer = LayerSystem.layers[state.selectedLayer];
                const param = selectedLayer?.shaderParams?.find(p => p.key === dialKey);
                if (param) {
                    const originalValue = momentaryKeys.get(dialKey);
                    param.currentValue = originalValue;
                    state.codeDialValues[dialKey] = originalValue;
                    Sync.sendDialDebounced({ [dialKey]: originalValue });
                }
                momentaryKeys.delete(dialKey);
            }
        }
    }
};
