/**
 * Persistence Module
 * Handles save/load state functionality
 */

import { state, getEl } from '../state.js';
import { Sync } from '../features/sync.js';
import { Shaders } from '../api/shaders.js';
import { saveToLocalStorage, loadFromLocalStorage, showError, setDropdownValue } from '../utils.js';
import { SETTINGS_KEYS, MODULATION_SOURCES } from '../config.js';
import { WebGL } from '../webgl/core.js';
import { LayerSystem } from '../webgl/layers.js';
import { modulationMatrixUI } from './modulationMatrixUI.js';
import { Conversation } from '../api/conversation.js';
import { CodeDials } from './codeDials.js';
import { initSlider } from './slider.js';
import { migrateMidiMappings } from '../utils/migrate.js';

export function saveState() {
    const data = {
        shaderCode: getEl('shaderCode').value,
        apiUrl: getEl('apiUrl').value,
        modelNameImage: getEl('modelNameImage').value,
        modelNameText: getEl('modelNameText').value,
        captureResolution: getEl('captureResolution').value,
        captureFormat: getEl('captureFormat').value,
        captureQuality: state.captureQuality,
        liveTuningMaxIterations: getEl('liveTuningMaxIterations').value,
        bearerKey: getEl('bearerKey').value,
        codeDialOriginals: state.codeDialOriginals,
        llmMode: state.llmMode,
        conversationHistory: state.conversationHistory,
        modulationRoutes: state.modulationRoutes,
        layerModulationMatrices: state.layerModulationMatrices,
        savedShaders: state.savedShaders,
        lfos: state.lfos.map(l => ({ rate: l.rate, waveform: l.waveform, phaseOffset: l.phaseOffset })),
        timestamp: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slopshady-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
 
}

export function saveShadersOnly() {
    const data = {
        type: 'shaders-only',
        savedShaders: state.savedShaders,
        count: state.savedShaders.length,
        timestamp: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shaders-list-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
 
}

export function loadShadersOnly(data) {
    if (!data.savedShaders || !Array.isArray(data.savedShaders)) {
        showError('No shaders found in this file');
        return false;
    }
    
    let addedCount = 0;
    let skippedCount = 0;

    const shadersToLoad = data.savedShaders;
 

    for (const shader of shadersToLoad) {
        if (!shader.code) {
            skippedCount++;
            continue;
        }
        
        const trimmedCode = shader.code.trim();
        const isDuplicate = state.savedShaders.some(
            s => s.code.trim() === trimmedCode
        );
        if (isDuplicate) {
            skippedCount++;
            continue;
        }
        
        const newShader = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            name: shader.name || 'Unnamed Shader',
            code: shader.code,
            timestamp: new Date().toISOString()
        };
        state.savedShaders.push(newShader);
        addedCount++;
    }
    
    Sync.send({ savedShaders: state.savedShaders });
    Shaders.render();
    
 
    const status = getEl('status');
    status.innerHTML = `📂 Loaded <span class="status-highlight-green">${addedCount}</span> shaders, skipped <span class="status-highlight-orange">${skippedCount}</span> duplicates`;
    setTimeout(() => status.textContent = '', 3000);
    return true;
}

export function loadState(data) {
    if (data.shaderCode) getEl('shaderCode').value = data.shaderCode;
    if (data.apiUrl) getEl('apiUrl').value = data.apiUrl;
    if (data.bearerKey) getEl('bearerKey').value = data.bearerKey;
    if (data.modelNameImage) {
        getEl('modelNameImage').value = data.modelNameImage;
        setDropdownValue('modelSelectImage-menu', data.modelNameImage);
    }
    if (data.modelNameText) {
        getEl('modelNameText').value = data.modelNameText;
        setDropdownValue('modelSelectText-menu', data.modelNameText);
    }
    if (data.captureResolution) {
        getEl('captureResolution').value = data.captureResolution;
        setDropdownValue('captureResolution-menu', data.captureResolution);
    }
    if (data.captureFormat) {
        getEl('captureFormat').value = data.captureFormat;
        setDropdownValue('captureFormat-menu', data.captureFormat);
    }
    if (data.captureQuality) state.captureQuality = parseInt(data.captureQuality);
    if (data.liveTuningMaxIterations) getEl('liveTuningMaxIterations').value = data.liveTuningMaxIterations;
    if (data.codeDialOriginals) {
        state.codeDialOriginals = data.codeDialOriginals;
        Object.assign(state.codeDialValues, data.codeDialOriginals);
    }
    if (data.llmMode) {
        state.llmMode = data.llmMode;
    } else if (data.chatMode !== undefined) {
        state.llmMode = data.chatMode ? 'chat' : 'shader';
    }
    if (data.conversationHistory) state.conversationHistory = data.conversationHistory;
    if (data.modulationRoutes) {
        state.modulationRoutes = data.modulationRoutes;
    }
    if (data.savedShaders) {
        state.savedShaders = data.savedShaders;
        Sync.send({ savedShaders: state.savedShaders });
        Shaders.render();
    }
    if (data.layerModulationMatrices !== undefined) {
        state.layerModulationMatrices = Array.isArray(data.layerModulationMatrices)
            ? data.layerModulationMatrices
            : Array.from({ length: 8 }, () => []);
        while (state.layerModulationMatrices.length < 8) state.layerModulationMatrices.push([]);
        state.layerModulationMatrices.length = 8;
        for (let i = 0; i < 8; i++) {
            const layer = LayerSystem.layers?.[i];
            if (layer) layer.modulationMatrix = state.layerModulationMatrices[i];
        }
        if (modulationMatrixUI) modulationMatrixUI.render();
    }
    if (data.lfos && Array.isArray(data.lfos)) {
        for (let i = 0; i < 4; i++) {
            if (data.lfos[i]) {
                if (state.lfos[i]) {
                    state.lfos[i].rate = data.lfos[i].rate ?? 1;
                    state.lfos[i].waveform = data.lfos[i].waveform ?? 'sine';
                    state.lfos[i].phaseOffset = data.lfos[i].phaseOffset ?? 0;
                }
            }
        }
    }

    // One-time migration: copy global modulationRoutes to Layer 0's modulation matrix
    if (Array.isArray(state.modulationRoutes) && state.modulationRoutes.length > 0) {
        const hasMatrixEntries = state.layerModulationMatrices.some(m => m.length > 0);
        if (!hasMatrixEntries) {
            state.layerModulationMatrices[0] = state.modulationRoutes
                .filter(r => r && typeof r === 'object')
                .map(route => {
                    let source = route.source || 'note';
                    let sourceConfig = {};
                    if (typeof source === 'string' && source.startsWith('midi_cc_')) {
                        const ccNum = parseInt(source.replace('midi_cc_', ''), 10);
                        if (Number.isFinite(ccNum)) {
                            source = 'cc';
                            sourceConfig.cc = ccNum;
                        }
                    }
                    if (route.lfoRate != null && Number.isFinite(route.lfoRate)) {
                        sourceConfig.lfoRate = route.lfoRate;
                    }
                    if (!MODULATION_SOURCES.includes(source)) {
                        source = 'note';
                    }
                    return {
                        id: route.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (Date.now() + Math.random())),
                        source,
                        sourceConfig,
                        destination: route.target || 'u_param_cd0',
                        amount: Number.isFinite(route.amount) ? route.amount : 1,
                        curve: route.curve || 'linear',
                        min: Number.isFinite(route.outputMin) ? route.outputMin : 0,
                        max: Number.isFinite(route.outputMax) ? route.outputMax : 1,
                        enabled: route.enabled !== false
                    };
                });
            // Mirror into LayerSystem
            const layer0 = LayerSystem.layers?.[0];
            if (layer0) layer0.modulationMatrix = state.layerModulationMatrices[0];
            // Re-render per-layer matrix UI
            if (typeof modulationMatrixUI !== 'undefined' && modulationMatrixUI.render) {
                modulationMatrixUI.render();
            }
            // Clear modulationRoutes so migration doesn't run again
            state.modulationRoutes = [];
        }
    }

    // One-time migration: convert old midiMappings to per-layer modulation matrix entries
    migrateMidiMappings(data);

    WebGL.initShader();
    Conversation.render();
    Conversation.updateTokenCount();
    CodeDials.render();
    
 
}

export function loadLocalPreferences() {
    state.fboFormat = loadFromLocalStorage(SETTINGS_KEYS.fboFormat, 'rgba8');
    state.resolutionScale = loadFromLocalStorage(SETTINGS_KEYS.resolutionScale, '1');
}

export function initSettingsPersistence() {
    // Load saved settings
    getEl('apiUrl').value = loadFromLocalStorage(SETTINGS_KEYS.apiUrl, getEl('apiUrl').value);
    getEl('bearerKey').value = loadFromLocalStorage(SETTINGS_KEYS.bearerKey, '');
    getEl('modelNameImage').value = loadFromLocalStorage(SETTINGS_KEYS.modelNameImage, getEl('modelNameImage').value);
    getEl('modelNameText').value = loadFromLocalStorage(SETTINGS_KEYS.modelNameText, getEl('modelNameText').value);
    const savedRes = loadFromLocalStorage(SETTINGS_KEYS.captureResolution, getEl('captureResolution').value);
    getEl('captureResolution').value = savedRes;
    setDropdownValue('captureResolution-menu', savedRes);
    const savedFmt = loadFromLocalStorage(SETTINGS_KEYS.captureFormat, getEl('captureFormat').value);
    getEl('captureFormat').value = savedFmt;
    setDropdownValue('captureFormat-menu', savedFmt);
    state.captureQuality = parseInt(loadFromLocalStorage(SETTINGS_KEYS.captureQuality, '80'));
    const qualSlider = getEl('captureQualitySlider');
    if (qualSlider) {
        const ctrl = initSlider(qualSlider, {
            min: 10, max: 100, step: 1, defaultValue: 80,
            format: v => v + '%',
            onChange: (val) => { state.captureQuality = val; },
            onCommit: (val) => {
                saveToLocalStorage(SETTINGS_KEYS.captureQuality, val);
            }
        });
        if (ctrl) ctrl.setValue(state.captureQuality);
    }
    
    // Save on change
    getEl('apiUrl').addEventListener('change', (e) => {
        saveToLocalStorage(SETTINGS_KEYS.apiUrl, e.target.value);
    });
    getEl('bearerKey').addEventListener('change', (e) => {
        saveToLocalStorage(SETTINGS_KEYS.bearerKey, e.target.value);
    });
    getEl('modelSelectImage-menu').addEventListener('dropdown-select', (e) => {
        getEl('modelNameImage').value = e.detail.value;
        saveToLocalStorage(SETTINGS_KEYS.modelNameImage, e.detail.value);
    });
    getEl('modelSelectText-menu').addEventListener('dropdown-select', (e) => {
        getEl('modelNameText').value = e.detail.value;
        saveToLocalStorage(SETTINGS_KEYS.modelNameText, e.detail.value);
    });
    getEl('captureResolution-menu').addEventListener('dropdown-select', (e) => {
        getEl('captureResolution').value = e.detail.value;
        saveToLocalStorage(SETTINGS_KEYS.captureResolution, e.detail.value);
    });
    getEl('captureFormat-menu').addEventListener('dropdown-select', (e) => {
        getEl('captureFormat').value = e.detail.value;
        saveToLocalStorage(SETTINGS_KEYS.captureFormat, e.detail.value);
    });
    getEl('liveTuningMaxIterations').addEventListener('change', (e) => {
        saveToLocalStorage(SETTINGS_KEYS.liveTuningMaxIterations, e.target.value);
    });
    
    // Reset button
    getEl('resetSettings').addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all settings?')) {
            try {
                Object.values(SETTINGS_KEYS).forEach(key => {
                    localStorage.removeItem(key);
                });
                alert('Settings reset! The page will now reload.');
                location.reload();
            } catch (e) {
            }
        }
    });
    
    // Save button
    getEl('saveSettings').addEventListener('click', () => {
        saveState();
    });
    
    // Server sync toggle
    getEl('toggle-sync').addEventListener('click', () => {
        const toggle = getEl('toggle-sync');
        const isActive = toggle.classList.toggle('active');
        Sync.enabled = isActive;
        saveToLocalStorage(SETTINGS_KEYS.syncEnabled, String(isActive));
        if (isActive) {
            Sync.reconnect();
        } else {
            Sync.disconnect();
        }
    });
    
 
}


