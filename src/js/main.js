/**
 * Main Entry Point
 * SlopShady - WebGL Shader Editor
 * Initializes all modules and starts the application
 */

import { state, getEl } from './state.js';
import { WebGL } from './webgl/core.js';
import { DEFAULT_SHADER_CODE, SETTINGS_KEYS } from './config.js';
import { FramebufferManager } from './webgl/framebuffers.js';
import { LayerSystem } from './webgl/layers.js';

import { MIDISystem } from './features/midi.js';
import { OSCSystem } from './features/osc.js';
import { MIDIPlayer } from './features/midiPlayer.js';
import { VideoTexture } from './features/video.js';
import { ScreenCapture } from './features/screenCapture.js';
import { Capture } from './features/capture.js';
import { AudioTexture } from './features/audio.js';
import { Sync, setSyncDependencies } from './features/sync.js';
import { ToggleSystem } from './utils/toggleSystem.js';
import { Shaders } from './api/shaders.js';
import { Conversation } from './api/conversation.js';
import { Models } from './api/models.js';
import { LLM } from './api/llm.js';
import { LiveTuning } from './api/liveTuning.js';
import { CodeDials } from './ui/codeDials.js';
import { LayerMixer } from './ui/layerMixer.js';
import { VoiceUI } from './ui/voiceUI.js';
import { OSCUI } from './ui/oscUI.js';
import { initEGPanel, setEGPanelLayerSystem, refreshPanel } from './ui/egPanel.js';
import { initSlider } from './ui/slider.js';
import { Keyboard } from './ui/keyboard.js';
import { DragAndDrop } from './ui/dragAndDrop.js';
import { initSettingsPersistence, saveState, loadLocalPreferences } from './ui/persistence.js';
import { loadFromLocalStorage } from './utils.js';
import { OnScreenKeyboard } from './ui/onScreenKeyboard.js';
import { FeedbackUI } from './ui/feedback.js';
import { PlayerUI } from './ui/player.js';
import { WebampUI } from './ui/webamp.js';
import { StreamingUI } from './ui/streaming.js';
import { StreamingInputUI } from './ui/streaming-input.js';
import { PlaylistSystem } from './features/playlist.js';
import { PlaylistUI } from './ui/playlistUI.js';
import { ContentBrowser } from './ui/contentBrowser.js';
import { BottomPanel } from './ui/bottom-panel.js';
import { NodeGraph } from './ui/nodeGraph.js';
import { modulationMatrixUI } from './ui/modulationMatrixUI.js';
import { MacrosUI } from './ui/macros.js';
import { ScanimateEngine } from './features/scanimate.js';
import { ScanimatePanel } from './ui/scanimatePanel.js';
import { ScanimatePatchBay } from './ui/scanimatePatchBay.js';
import { VisualBrain } from './features/visualBrain.js';
import { VisualBrainPanel } from './ui/visualBrainPanel.js';
import { applyTooltips } from './ui/tooltips.js';

// Set up circular dependencies
setSyncDependencies({
    WebGL,
    Shaders,
    CodeDials,
    Conversation,
    LayerSystem,
    LayerMixer,
    VoiceUI,
    FeedbackUI,
    PlaylistSystem,
    PlaylistUI,
    modulationMatrixUI,
    MacrosUI,
    ScanimatePanel,
    ScanimatePatchBay,
    OSCUI
});

// Set up MIDI dependencies
MIDISystem.setDependencies({
    LayerSystem
});

// Set up Playlist dependencies
PlaylistSystem.setDependencies({
    WebGL,
    LayerSystem,
    Shaders,
    LayerMixer,
    CodeDials
});

// Expose modules as globals to break circular dependencies with core.js
// (core.js imports Shaders, Conversation, LayerMixer → they can't import core.js back)
window.WebGL = WebGL;
window.CodeDials = CodeDials;
window.Conversation = Conversation;
window.ScanimateEngine = ScanimateEngine;

// Main application object
const SlopShady = {
    async init() {
        loadLocalPreferences();
        if (!WebGL.init()) return;
        
        if (!getEl('shaderCode').value.trim()) {
            getEl('shaderCode').value = DEFAULT_SHADER_CODE;
        }
        
        FramebufferManager.init(state.canvas.width, state.canvas.height);
        LayerSystem.init();
        window.LayerSystem = LayerSystem;
        ScanimateEngine.init();
        VisualBrain.init();
        
        // Initialize all modules
        Sync.enabled = false;
        Sync.init();
        this.initUI();
        initSettingsPersistence();
        
        document.addEventListener('sync-init-done', () => {
            const syncOn = loadFromLocalStorage(SETTINGS_KEYS.syncEnabled, 'false') === 'true';
            const toggleEl = getEl('toggle-sync');
            if (toggleEl) toggleEl.classList.toggle('active', syncOn);
            Sync.enabled = syncOn;
            if (!syncOn) {
                Sync.disconnect();
            }
        }, { once: true });
        
        // Initialize API modules
        Shaders.init();
        Conversation.render();
        Conversation.updateTokenCount();
        
        // Initialize features
        VideoTexture.init();
        ScreenCapture.init();
        AudioTexture.init();
        CodeDials.init();
        
        // Initialize voice UI, MIDI, OSC, and on-screen keyboard
        VoiceUI.init();
        MIDISystem.init();
        OSCSystem.init();
        OSCUI.init();
        
        // Initialize on-screen keyboard
        const oskContainer = getEl('onScreenKeyboard');
        if (oskContainer) {
            OnScreenKeyboard.init(oskContainer);
        }
        
        // Initialize EG Panel
        setEGPanelLayerSystem(LayerSystem);
        initEGPanel();
        document.addEventListener('layer-select', () => refreshPanel());
        
        // Initialize UI handlers
        Keyboard.init();
        DragAndDrop.init();
        LayerMixer.generateChannels();
        LayerMixer.init();
        FeedbackUI.init();
        PlayerUI.init();
        WebampUI.init();
        StreamingUI.init();
        StreamingInputUI.init();
        PlaylistUI.init();
        ContentBrowser.init();
        BottomPanel.init();
        NodeGraph.init();
        modulationMatrixUI.init();
        MacrosUI.init();
        ScanimatePanel.init();
        ScanimatePatchBay.init();
        VisualBrainPanel.init();
        applyTooltips();
        
        // Delay model fetch
        setTimeout(() => {
            const apiUrl = getEl('apiUrl').value.trim();
            if (apiUrl && apiUrl.startsWith('http')) {
                Models.fetch();
            }
        }, 100);
        
 
    },
    
    initUI() {
        ToggleSystem.init();
        
        // Pause/Play
        getEl('pausePlay').addEventListener('click', () => {
            if (state.isPaused) {
                state.isPaused = false;
                state.startTime = Date.now() - (state.manualTime * 1000);
                getEl('pausePlay').classList.add('active');
                if (this._timeFineSlider) this._timeFineSlider.setValue(0);
                getEl('timeDisplayFine').textContent = '±0.0%';
            } else {
                state.isPaused = true;
                getEl('pausePlay').classList.remove('active');
            }
            Sync.send({ isPaused: state.isPaused, manualTime: state.manualTime });
        });
        
        const timeSliderWrap = getEl('timeSliderWrap');
        const timeFineWrap = getEl('timeSliderFineWrap');
        
        this._timeSlider = initSlider(timeSliderWrap, {
            min: 0, max: 1000, step: 1, defaultValue: 0,
            format: v => Math.round(v / 10) + '%',
            enabled: () => state.isPaused,
            onChange: (val) => {
                getEl('timeSlider').value = Math.round(val);
            }
        });
        this._timeFineSlider = initSlider(timeFineWrap, {
            min: -100, max: 100, step: 1, value: 0, defaultValue: 0,
            format: v => { const sign = v >= 0 ? '+' : ''; return sign + (v / 10).toFixed(1) + '%'; },
            enabled: () => state.isPaused,
            onChange: (val) => {
                getEl('timeSliderFine').value = Math.round(val);
            }
        });
        
        // Mode buttons
        getEl('modeShader').addEventListener('click', () => this.setMode(false));
        getEl('modeChat').addEventListener('click', () => this.setMode(true));
        this.setMode(false);
        
        // LLM buttons
        getEl('askLLM').addEventListener('click', () => LLM.send(false));
        getEl('askLLMWithImage').addEventListener('click', () => LLM.send(true));
        getEl('clearHistory').addEventListener('click', () => Conversation.clear());
        
        // Refresh models
        getEl('refreshModels').addEventListener('click', () => Models.fetch());
        getEl('modelSelectImage-menu').addEventListener('dropdown-select', () => Models.updateImage());
        getEl('modelSelectText-menu').addEventListener('dropdown-select', () => Models.updateText());
        
        // Download shaders.json
        const downloadBtn = getEl('downloadShaders');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                window.open('/api/shaders/download', '_blank');
            });
        }
        
        // Live tuning
        getEl('startLiveTuning').addEventListener('click', () => LiveTuning.start());
        getEl('stopLiveTuning').addEventListener('click', () => LiveTuning.stop(false));
        
        // User message
        getEl('userMessage').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) LLM.send();
        });
        
        // Shader code input
        getEl('recompile').addEventListener('mousedown', () => {
            const btn = getEl('recompile');
            btn.classList.add('active');
            WebGL.initShader({ save: true });
            const up = () => {
                btn.classList.remove('active');
                document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mouseup', up);
        });
        getEl('shaderCode').addEventListener('input', () => CodeDials.render());
        
        // Close dial on outside click
        document.addEventListener('click', (e) => {
            if (state.floatingDialEl && !state.floatingDialEl.contains(e.target)) {
                CodeDials.closeFloatingDial();
            }
        });
        
        // On-screen keyboard octave controls
        const oskOctaveDown = getEl('oskOctaveDown');
        const oskOctaveUp = getEl('oskOctaveUp');
        if (oskOctaveDown) {
            oskOctaveDown.addEventListener('click', () => {
                OnScreenKeyboard.shiftOctave(-1);
                this._updateOSKRangeDisplay();
            });
        }
        if (oskOctaveUp) {
            oskOctaveUp.addEventListener('click', () => {
                OnScreenKeyboard.shiftOctave(1);
                this._updateOSKRangeDisplay();
            });
        }
        this._updateOSKRangeDisplay();
    },
    
    _updateOSKRangeDisplay() {
        const display = getEl('oskRangeDisplay');
        if (display && OnScreenKeyboard.getKeyRange) {
            const range = OnScreenKeyboard.getKeyRange();
            const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const startOctave = Math.floor(range.startNote / 12) - 1;
            const endOctave = Math.floor(range.endNote / 12) - 1;
            const startName = noteNames[range.startNote % 12];
            const endName = noteNames[range.endNote % 12];
            display.textContent = `${startName}${startOctave} - ${endName}${endOctave}`;
        }
    },
    
    setMode(mode) {
        state.chatMode = mode;
        getEl('modeShader').classList.toggle('active', !mode);
        getEl('modeShader').classList.toggle('inactive', !!mode);
        getEl('modeChat').classList.toggle('active', !!mode);
        getEl('modeChat').classList.toggle('inactive', !mode);
    }
};

// Start application
window.addEventListener('load', () => SlopShady.init());

