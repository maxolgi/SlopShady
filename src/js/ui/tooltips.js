/**
 * Tooltip System
 * Centralized tooltip text registry and display engine for SlopShady
 */

import { SETTINGS_KEYS } from '../config.js';

const T = {
    TAB_MIX: 'Layer mixer and compositing · 8 layers with blend modes',
    TAB_CODE: 'Shader code editor and code dials for real-time parameter control',
    TAB_PLAYER: 'MIDI file player and Webamp audio playback',
    TAB_STREAM: 'Live stream (WebSRT) and recording · Ctrl+Shift+R',
    TAB_SCANIMATE: 'Scanimate analog-style video synthesis engine',
    TAB_VOICES: 'LFOs, macros, modulation matrix, voice mode, MIDI, EG',
    TAB_FEEDBACK: 'Frame feedback effects · ` (backtick)',
    TAB_LLM: 'AI chat for shader generation and live tuning',
    TAB_SETTINGS: 'Settings, rendering options, color correction',

    LAYER_BTN: 'Select layer {n} · Ctrl+{n}',

    MIX_SWITCH: 'Crossfade all layer opacity to selected layer · Insert',
    MIX_CAMERA: 'Toggle webcam texture input (iVideo uniform)',
    MIX_SCREEN: 'Toggle screen/desktop capture texture (iScreen uniform)',
    MIX_CAMERA_DEVICE: 'Select which camera to use',
    MIX_MIDI_DEVICE: 'Select which MIDI input device to listen to, or All MIDI Devices',
    MIX_DEVICE_EXPAND: 'Camera and monitor device selection',
    MIX_BG_EXPAND: 'Background color, source type, and image/video settings',
    MIX_EDIT_EXPAND: 'Per-layer source material editor',
    MIX_CONTROLS_EXPAND: 'Layer parameters: brightness, speed, position, scale, rotation, etc.',
    MIX_MASK_EXPAND: 'Layer mask: radius, center position, softness/feather',
    MIX_PLAYLIST_EXPAND: 'Shader playlist sequencer with crossfade transitions',
    MIX_BRAIN_EXPAND: 'VisualBrain — concatenative visual synthesis from corpus of image blocks',
    MIX_BRAIN_TOGGLE: 'Enable Brain effect on layer {n} — re-renders output using corpus-matched blocks',
    MIX_BG_TOGGLE: 'Toggle background layer visibility',
    MIX_BG_COLOR: 'Background solid color picker',
    MIX_BG_TYPE: 'Background source type: Solid, Image, Video, Camera, or Screen',

    PL_PLAY: 'Play playlist · Ctrl+Shift+Space',
    PL_STOP: 'Stop playlist playback',
    PL_PREV: 'Skip to previous playlist entry',
    PL_NEXT: 'Skip to next playlist entry',
    PL_LOOP: 'Toggle playlist looping',
    PL_ADD_CURRENT: 'Add current shader to playlist',
    PL_ADD_FROM_SHADER: 'Add selected saved shader to playlist',
    PL_CLEAR: 'Clear entire playlist',
    PL_EXPORT: 'Export playlist as JSON file',
    PL_IMPORT: 'Import playlist from JSON file',
    PL_PROGRESS: 'Playlist playback progress',

    CODE_LAYER_PREV: 'Select previous layer for editing · keys 1-8',
    CODE_LAYER_NEXT: 'Select next layer for editing · keys 1-8',
    CODE_ZOOM_OUT: 'Decrease code editor and dial font size',
    CODE_ZOOM_IN: 'Increase code editor and dial font size',
    CODE_EDIT_EXPAND: 'Toggle shader source code editor textarea',
    CODE_PAUSE: 'Play/Pause shader animation · Space',
    CODE_COMPILE: 'Recompile current shader from source',
    CODE_TIME: 'Time scrub position (0-1000%) — only when paused',
    CODE_TIME_FINE: 'Fine time offset (±10%) — only when paused',
    CODE_HELP: 'Code dial keyboard shortcuts reference',
    CODE_DIAL: 'Code dial {n}',

    PLAYER_DROP: 'Click or drag a .mid file to load for playback',
    PLAYER_PLAY: 'Play loaded MIDI file',
    PLAYER_PAUSE: 'Pause MIDI playback',
    PLAYER_STOP: 'Stop MIDI playback and reset to start',
    PLAYER_PROGRESS: 'Seek position within MIDI file',

    STREAM_START: 'Start/stop live stream over WebSRT · Ctrl+Insert',
    STREAM_RECORD: 'Record canvas via the WebSRT encoder to a .ts file · Ctrl+Shift+R (works with or without an active stream)',
    STREAM_GATEWAY: 'WebSRT gateway WebTransport URL (e.g. https://127.0.0.1:4433/wt)',
    STREAM_GATEWAY_WEB_PORT: 'Port of the gateway\'s built-in HTTPS web server, where cert-hash.js lives (default 5173). Used to fetch the cert hash for self-signed pinning · persists',
    STREAM_NAME: 'Stream name viewers connect to (?stream=<name>)',
    STREAM_CODEC: 'Video codec for the live stream. AV1 is the most reliably supported on this machine · persists',
    STREAM_ABR: 'Adaptive bitrate: auto-reduce encoder bitrate when the SRT sender queue grows (experimental — tune constants in streaming.js) · persists',
    STREAM_CBR: 'Constant bitrate: encoder targets a steady bitrate instead of variable. Reduces packet bursts during complex scenes (recommended for streaming) · persists',
    STREAM_INPUT_SELECTOR: 'Which of the 8 WebSRT input slots to configure (1-8). Each slot stores its own gateway URL / stream name / latency.',
    STREAM_INPUT_TOGGLE: 'Start or stop the WebSRT connection for the selected input. Connection also opens automatically when a layer routes here.',
    STREAM_INPUT_TOGGLE_ALL: 'Start all configured inputs, or stop all running inputs.',
    STREAM_INPUT_URL: 'Gateway web URL for the selected input — the page you browse to (e.g. https://host:8443/?stream=name). The WT port and cert hash are discovered automatically from cert-hash.js.',
    STREAM_INPUT_NAME: 'Stream name to subscribe to (?stream=<name>) for the selected input. Must match the name the publisher sends to the gateway.',
    STREAM_INPUT_LATENCY: 'SRT TSBPD latency (ms) for the selected input — rule of thumb: 4× WT RTT',
    STREAM_INPUT_STATUS: 'Live status of the selected input (idle / connecting / live · mbps · RTT · loss)',
    STREAM_INPUT_STATS: 'Detailed stats for the selected input: video codec + dims, audio codec, decode counters, transport counters.',
    STREAM_INPUT_ANALYSER: 'Source node feeding the audio analyser that drives audio-reactive visuals. Webamp = existing path; Input N = decoded WebSRT audio',

    SC_INPUT_EXPAND: 'Input source: URL, file upload, or active shader',
    SC_OSC_EXPAND: '8 oscillators driving wave deformation and deflection',
    SC_PATCH_EXPAND: 'Route modulation sources (LFOs, audio, MIDI) to Scanimate parameters',
    SC_ENABLED: 'Enable/disable the Scanimate video synthesis engine',
    SC_FIT: 'Input fit mode: Cover, Contain, or Stretch',
    SC_SPEED: 'Playback speed multiplier (0-5x)',
    SC_WAVE_X: 'Horizontal wave deformation depth',
    SC_WAVE_Y: 'Vertical wave deformation depth',
    SC_ROTATION: 'Deflection rotation angle (radians)',
    SC_BARREL: 'Barrel distortion amount',
    SC_WARP_ITERS: 'Domain warp iterations (1-5) — more = complex deformation',
    SC_SEGMENTS: 'Number of screen segments with independent depth',
    SC_ANIM_ENABLED: 'Enable keyframe animation system',
    SC_ANIM_LOOP: 'Loop animation playback between initial and final states',
    SC_ANIM_PLAY: 'Play animation from initial to final state',
    SC_SET_INITIAL: 'Capture current state as animation start · Ctrl+click to clear',
    SC_SET_FINAL: 'Capture current state as animation end · Ctrl+click to clear',
    SC_ANIM_DURATION: 'Animation duration in seconds',
    SC_ANIM_RATE_A: 'Oscillator A rate multiplier during animation',
    SC_ANIM_RATE_B: 'Oscillator B rate multiplier during animation',
    SC_ANIM_PROGRESS: 'Manual animation progress scrub (0-100%)',
    SC_COLOR_ENABLED: 'Enable dual-color cycling effect',
    SC_COLOR_A: 'Color A for cycling palette',
    SC_COLOR_B: 'Color B for cycling palette',
    SC_COLOR_C: 'Color C for cycling palette',
    SC_CYCLE_SPEED: 'Color cycling speed (0-5)',
    SC_BRIGHTNESS_BOOST: 'Colorizer brightness boost (0-3)',
    SC_CRT_SCANLINES: 'Toggle CRT scanline effect',
    SC_CRT_GLOW: 'Toggle phosphor glow effect',
    SC_SCANLINE_INTENSITY: 'Scanline darkness intensity (0-0.5)',
    SC_PHOSPHOR: 'Phosphor glow amount (0-2)',
    SC_CRT_CHROMATIC: 'Toggle chromatic aberration (RGB channel shift)',
    SC_CRT_VIGNETTE: 'Toggle edge vignette darkening',
    SC_RGB_SHIFT: 'Chromatic aberration amount (0-0.05)',
    SC_VIGNETTE: 'Vignette intensity (0-2)',
    SC_FB_ENABLED: 'Enable Scanimate frame feedback',
    SC_FB_AMOUNT: 'Scanimate feedback mix amount (0-1)',
    SC_FB_DECAY: 'Scanimate feedback decay rate (0-1)',

    SC_OSC_TOGGLE: 'Enable/disable oscillator {n}',
    SC_OSC_FREQ: 'Oscillator {n} frequency multiplier (0.1-20)',
    SC_OSC_PHASE: 'Oscillator {n} phase offset (0-1)',
    SC_OSC_AMP: 'Oscillator {n} amplitude (0-1)',
    SC_OSC_LOCK_MODE: 'Oscillator {n} phase lock mode: Free, V-Lock, H-Lock, or Slave',
    SC_OSC_LOCK_TARGET: 'Oscillator {n} sync target oscillator',

    VOICE_LFO_EXPAND: '4 LFOs with configurable waveform, rate, BPM sync, and key sync',
    VOICE_MACRO_EXPAND: '8 user-assignable macro knobs (0-1) for modulation',
    VOICE_MATRIX_EXPAND: 'Modulation matrix: route any source to any destination',
    VOICE_VOICE_EXPAND: 'Voice mode (Poly/Mono/Glide), glide time, and voice status',
    VOICE_MIDI_EXPAND: 'MIDI input channel filter and note range settings',
    VOICE_EG_EXPAND: '4 ADSR envelope generators with loop and curve shapes',
    VOICE_KB_EXPAND: 'On-screen piano keyboard for triggering voices',

    LFO_BPM: 'Global BPM for LFO sync (20-300)',
    LFO_WAVEFORM: 'LFO {n} waveform: Sine, Square, Triangle, Saw, S&H, or Noise',
    LFO_RATE: 'LFO {n} frequency in Hz (0.1-20)',
    LFO_EXPAND: 'Show/hide advanced LFO {n} parameters',
    LFO_PHASE: 'LFO {n} phase offset (0-1)',
    LFO_AMP: 'LFO {n} output amplitude (0-1)',
    LFO_OFFSET: 'LFO {n} DC offset (-1 to 1)',
    LFO_SYNC: 'Sync LFO {n} rate to global BPM',
    LFO_SYNC_RATE: 'LFO {n} beat division: 1/1, 1/2, 1/4, 1/8, 1/16',
    LFO_KEYSYNC: 'Reset LFO {n} phase on each MIDI note-on',

    VOICE_MODE_POLY: 'Polyphonic mode — up to 4 simultaneous voices with voice stealing',
    VOICE_MODE_MONO: 'Monophonic mode — single voice, last-note priority',
    VOICE_MODE_GLIDE: 'Glide mode — monophonic with portamento between notes',
    VOICE_GLIDE_TIME: 'Portamento glide time (0-2s)',
    MIDI_CHANNEL_ALL: 'Listen to all MIDI channels (omni)',
    MIDI_CHANNEL: 'Listen only to MIDI channel {n}',
    MIDI_NOTE_MIN: 'Minimum MIDI note for input filter (0-127)',
    MIDI_NOTE_MAX: 'Maximum MIDI note for input filter (0-127)',

    VOICE_OSC_EXPAND: 'OSC input configuration — port, enable, and live message monitor',
    OSC_PORT: 'UDP port the OSC bridge listens on (1-65535). Apply requires restart to take effect.',
    OSC_PORT_APPLY: 'Save the OSC port — requires process restart to bind the new port',
    OSC_ENABLE: 'Enable/disable forwarding of OSC messages to the voice/modulation system',
    OSC_MONITOR: 'Last received OSC message (address + args)',

    EG_DELAY: 'EG {n} delay time before attack starts',
    EG_ATTACK: 'EG {n} attack ramp time',
    EG_HOLD: 'EG {n} hold time at peak level',
    EG_DECAY: 'EG {n} decay to sustain level',
    EG_SUSTAIN: 'EG {n} sustain level (0-1)',
    EG_RELEASE: 'EG {n} release time after note-off',
    EG_LOOP: 'EG {n} loop mode: One-Shot, Loop, or Retrigger',
    EG_CURVE: 'EG {n} curve shape: Linear, Exponential, or Logarithmic',
    EG_TRIGGER: 'Manually trigger EG {n} envelope for testing',

    OSK_OCTAVE_DOWN: 'Shift keyboard down one octave',
    OSK_OCTAVE_UP: 'Shift keyboard up one octave',

    FB_ENABLED: 'Toggle global frame feedback on/off · ` (backtick)',
    FB_BLEND: 'Feedback blend mode for compositing',
    FB_AMOUNT: 'Feedback mix amount (0-1)',
    FB_DECAY: 'Feedback decay/fade rate (0-1)',
    FB_ZOOM: 'Feedback zoom factor (0.5-2)',
    FB_ROTATE: 'Feedback rotation (-pi to pi)',
    FB_OFFSET_X: 'Horizontal feedback offset (-0.5 to 0.5)',
    FB_OFFSET_Y: 'Vertical feedback offset (-0.5 to 0.5)',
    FB_SATURATION: 'Feedback saturation adjustment (0-3)',
    FB_BRIGHTNESS: 'Feedback brightness adjustment (0-3)',

    SETTINGS_HIDE: 'Hide/show the entire bottom panel · Tab',
    SETTINGS_SYNC: 'Toggle WebSocket state sync across browser clients',
    SETTINGS_NODES: 'Visual node graph editor for connecting sources and effects',
    SETTINGS_RENDERING: 'Canvas resolution, FBO precision, and debug info',
    SETTINGS_HELP: 'Keyboard shortcuts and usage guide',
    SETTINGS_CONFIG: 'Capture settings, LLM config',
    SETTINGS_TOGGLE_TOOLTIPS: 'Enable/disable hover tooltips',
    SETTINGS_COLOR: 'Primary color correction: lift/gamma/gain, curves, scopes, LUTs',
    SETTINGS_DEBUG_EXPAND: 'WebGL debug info: renderer, extensions, format probes',
    SETTINGS_WIRES: 'Show/hide node graph connection wires',
    SETTINGS_AUTO: 'Auto-arrange node graph layout',
    SETTINGS_FIT: 'Fit entire node graph into view',
    NODE_BACKGROUND: 'Background material: color, image, video, or screen capture',
    NODE_LAYER: 'Layer {n}: shader, opacity, blend mode, modulation routing',
    NODE_LFO: 'LFO {n}: low-frequency oscillator — rate, waveform, amplitude',
    NODE_EG: 'Envelope Generator {n}: ADSRH parameters — attack, decay, sustain, release',
    NODE_VOICE: 'Voice {n}: polyphonic voice — note, velocity, position',
    NODE_AUDIO: 'Audio analysis: peak level, low/mid/high frequency bands',
    NODE_MIDI: 'MIDI input: note, velocity, CC, aftertouch, pitch bend',
    NODE_MACRO: 'Macro {n}: global parameter slider, routes to any destination',
    NODE_KEYBOARD: 'On-screen keyboard: note output for voice triggering',
    NODE_COMPOSITE: 'Layer compositor: blends all 8 layers with blend modes',
    NODE_FEEDBACK: 'Master feedback: delay, decay, zoom, rotation transforms',
    NODE_LAYER_FB: 'Per-layer feedback: individual feedback loop for layer {n}',
    NODE_VISUALIZER: 'Audio visualizer: waveform, spectrum, circular, oscilloscope',
    NODE_VISUALBRAIN: 'VisualBrain: GPU concatenative visual synthesis',
    NODE_OUTPUT: 'Final screen output',
    SETTINGS_PRECISION: 'Framebuffer pixel format (RGBA8, RGBA16F, RGBA32F)',
    SETTINGS_RESOLUTION: 'Canvas output resolution: scale factor or fixed broadcast size (720p/1080p/4K)',
    SETTINGS_DBG_REFRESH: 'Refresh WebGL debug information display',
    SETTINGS_API_URL: 'LLM API endpoint URL (e.g. LM Studio server)',
    SETTINGS_BEARER: 'API authentication bearer token',
    SETTINGS_REFRESH_MODELS: 'Fetch available models from the API endpoint',
    SETTINGS_MODEL_IMAGE: 'Vision model — used for image analysis and live tuning',
    SETTINGS_MODEL_TEXT: 'Text model — used for shader generation and chat',
    SETTINGS_CAPTURE_RES: 'Screenshot resolution scale: Full, Half, or Quarter',
    SETTINGS_FORMAT: 'Screenshot format: PNG (lossless) or WebP (compressed)',
    SETTINGS_QUALITY: 'WebP compression quality (10-100%)',
    SETTINGS_MAX_ITER: 'Max AI iterations per live tuning session (1-100)',
    SETTINGS_RESET: 'Clear all localStorage and reset to defaults',
    SETTINGS_SAVE: 'Export full state as JSON file · Ctrl+S',

    COLOR_LIFT: 'Shadows / lift control for primary color correction',
    COLOR_GAMMA: 'Midtones / gamma control for primary color correction',
    COLOR_GAIN: 'Highlights / gain control for primary color correction',
    COLOR_CURVE_MASTER: 'Master luminance curve',
    COLOR_CURVE_RGB: 'Individual RGB channel curves',
    COLOR_CURVE_HSL: 'Hue/Saturation/Lightness curves',
    COLOR_CURVE_LUM: 'Luminance-only curve',
    COLOR_SCOPE_WAVE: 'Waveform monitor — brightness distribution',
    COLOR_SCOPE_VECTOR: 'Vectorscope — color/chroma distribution',
    COLOR_SCOPE_HIST: 'Histogram — tonal range distribution',
    COLOR_SCOPE_RGBP: 'RGB Parade — per-channel levels',
    COLOR_LUT: 'Look-up table selection for color space conversion',
    COLOR_LUT_LOAD: 'Load a custom .cube LUT file',
    COLOR_LUT_SAVE: 'Export current color correction as LUT',

    LLM_MODE_SHADER: 'Shader mode — LLM generates GLSL fragment shader code',
    LLM_MODE_CHAT: 'Chat mode — LLM general conversation',
    LLM_SEND: 'Send message to LLM · Ctrl+Enter · click while pending = cancel',
    LLM_SEND_IMAGE: 'Capture screenshot and send with message for visual analysis',
    LLM_CLEAR: 'Clear conversation history',
    LLM_PROMPT: 'Enter your request or instruction for the AI',
    LT_START: 'Start iterative AI tuning session with screenshot feedback',
    LT_STOP: 'Stop the active live tuning session',
    LT_PROMPT: 'Describe the visual goal the AI should work toward',

    LAYER_TYPE: 'Layer {n} material type (Shader, Image, Video, Webcam, etc.)',
    LAYER_SHADER: 'Layer {n} shader — select from saved shader library',
    LAYER_BLEND: 'Layer {n} blend mode for compositing with layers below',
    LAYER_SOLO: 'Solo layer {n} — mute all other layers',
    LAYER_SHOW: 'Toggle layer {n} visibility · Shift+{n}',
    LAYER_VOLUME: 'Layer {n} audio volume for WebSRT input (0-100%)',
    LAYER_AUDIO_MUTE: 'Mute layer {n} WebSRT audio',
    LAYER_OPACITY: 'Layer {n} opacity (0-100%)',
    LAYER_BRIGHTNESS: 'Layer {n} brightness (u_brightness, 0-3)',
    LAYER_SPEED: 'Layer {n} time speed multiplier (u_speed, 0-5)',
    LAYER_POS_X: 'Layer {n} horizontal position offset (u_posX, -1 to 1)',
    LAYER_POS_Y: 'Layer {n} vertical position offset (u_posY, -1 to 1)',
    LAYER_SCALE: 'Layer {n} scale factor (u_scale, 0.1-5)',
    LAYER_AMOUNT: 'Layer {n} intensity/amount (u_amount, 0-3)',
    LAYER_ROTATION: 'Layer {n} rotation in radians (u_rotation, -pi to pi)',
    LAYER_STRETCH: 'Layer {n} stretch factor (u_stretch, -2 to 2)',
    LAYER_RADIUS: 'Layer {n} mask radius (u_radius, 0-2)',
    LAYER_MASK_X: 'Layer {n} mask center X position (u_maskPosX, -1 to 1)',
    LAYER_MASK_Y: 'Layer {n} mask center Y position (u_maskPosY, -1 to 1)',
    LAYER_SOFTNESS: 'Layer {n} mask feather/softness (u_maskSoftness, 0-1)',

    LAYER_FB_ENABLED: 'Toggle per-layer frame feedback for layer {n}',
    LAYER_FB_BLEND: 'Layer {n} feedback blend mode',
    LAYER_FB_AMOUNT: 'Layer {n} feedback mix amount (0-1)',
    LAYER_FB_DECAY: 'Layer {n} feedback decay (0-1)',
    LAYER_FB_ZOOM: 'Layer {n} feedback zoom (0.5-2)',
    LAYER_FB_ROTATE: 'Layer {n} feedback rotation (-pi to pi)',
    LAYER_FB_OX: 'Layer {n} feedback horizontal offset (-0.5 to 0.5)',
    LAYER_FB_OY: 'Layer {n} feedback vertical offset (-0.5 to 0.5)',
    LAYER_FB_SAT: 'Layer {n} feedback saturation (0-3)',
    LAYER_FB_BRT: 'Layer {n} feedback brightness (0-3)',

    VB_BLOCK_SIZE: 'Brain block size in pixels — smaller = finer matching, larger = bolder',
    VB_RECORD: 'Record blocks from active Brain layers into the corpus',
    VB_SEED: 'Generate 600 synthetic blocks (gradients, noise, patterns) for the corpus',
    VB_CLEAR: 'Clear the entire brain corpus',
    VB_BLEND: 'Brain blend — mix between original layer output and corpus-matched output (0-100%)',
    VB_GLITCH: 'Glitch intensity — chromatic aberration and displacement on poor matches (0-100%)',
    VB_COLOR_W: 'Color weight for block matching — higher = prioritize color similarity',
    VB_GRID: 'Toggle block grid overlay on Brain output',
    VB_SCANLINE: 'Toggle CRT scanline sweep effect on Brain output',
    VB_AUDIO: 'Enable microphone for audio-reactive Brain modulation',
    VB_AUDIO_DRIVE: 'Audio reactivity drive — how much audio affects Brain output',

    MACRO_NAME: 'Macro {n} label name',
    MACRO_SLIDER: 'Macro {n} value (0-1) — routable as modulation source',
    MACRO_LEARN: 'Start MIDI CC learn for macro {n} — move a knob to assign',
    MACRO_CLEAR_CC: 'Unassign the MIDI CC from macro {n}',

    MOD_CC: 'MIDI CC number for this modulation route',
    MOD_OSC: 'OSC address for this modulation route (e.g. /ch/1)',
    MOD_AMOUNT: 'Modulation amount / depth',
    MOD_CURVE: 'Modulation curve: Linear, Exponential (x²), or Logarithmic',
    MOD_LEARN: 'Start MIDI CC learn for this route — move a knob to assign',
    MOD_ENABLE: 'Enable/disable this modulation route',

    CODE_DIAL_VALUE: 'Click to type a value directly',
    CODE_DIAL_MOD: 'Add an LFO/modulation route to this parameter',

    PATCH_AMOUNT: 'Patch modulation amount',
    PATCH_CURVE: 'Patch curve: Linear, Exponential, or Logarithmic',
    PATCH_TOGGLE: 'Enable/disable this patch route',
    PATCH_DELETE: 'Delete this patch route entirely',
    PATCH_CLOSE: 'Close the patch editor',

    PL_ENTRY_NAME: 'Playlist entry name',
    PL_ENTRY_DURATION: 'Duration in seconds before advancing',
    PL_ENTRY_FADE_IN: 'Fade-in duration in seconds',
    PL_ENTRY_FADE_OUT: 'Fade-out duration in seconds',
    PL_ENTRY_MIDI: 'MIDI note (0-127) to trigger this entry',
    PL_ENTRY_DELETE: 'Remove this entry from playlist',

    MODAL_CLOSE: 'Close the shader source code viewer',

    RESIZE_HANDLE: 'Drag to resize panel height · double-click to minimize',
};

const OSC_ADDR = {
    // Global
    MIX_SWITCH: ' · OSC /mix/switch',
    MIX_CAMERA: ' · OSC /mix/camera',
    MIX_SCREEN: ' · OSC /mix/screen',
    // Background
    MIX_BG_TOGGLE: ' · OSC /mix/bg',
    MIX_BG_TYPE: ' · OSC /mix/bg/type',
    // Playlist
    PL_PLAY: ' · OSC /mix/pl/play',
    PL_STOP: ' · OSC /mix/pl/stop',
    PL_PREV: ' · OSC /mix/pl/prev',
    PL_NEXT: ' · OSC /mix/pl/next',
    PL_LOOP: ' · OSC /mix/pl/loop',
    PL_ADD_CURRENT: ' · OSC /mix/pl/add',
    PL_CLEAR: ' · OSC /mix/pl/clear',
    // Brain
    VB_BLOCK_SIZE: ' · OSC /mix/brain/size',
    VB_RECORD: ' · OSC /mix/brain/record',
    VB_SEED: ' · OSC /mix/brain/seed',
    VB_CLEAR: ' · OSC /mix/brain/clear',
    VB_BLEND: ' · OSC /mix/brain/blend',
    VB_GLITCH: ' · OSC /mix/brain/glitch',
    VB_COLOR_W: ' · OSC /mix/brain/color',
    VB_GRID: ' · OSC /mix/brain/grid',
    VB_SCANLINE: ' · OSC /mix/brain/scan',
    VB_AUDIO: ' · OSC /mix/brain/mic',
    VB_AUDIO_DRIVE: ' · OSC /mix/brain/audio',
    // Per-layer
    LAYER_TYPE: ' · OSC /mix/{n}/input',
    LAYER_SHADER: ' · OSC /mix/{n}/preset',
    LAYER_BLEND: ' · OSC /mix/{n}/blend',
    LAYER_SOLO: ' · OSC /mix/{n}/solo',
    LAYER_SHOW: ' · OSC /mix/{n}/show',
    LAYER_VOLUME: ' · OSC /mix/{n}/volume',
    LAYER_AUDIO_MUTE: ' · OSC /mix/{n}/audioMute',
    MIX_BRAIN_TOGGLE: ' · OSC /mix/{n}/brain',
    LAYER_OPACITY: ' · OSC /mix/{n}/opacity',
    LAYER_BRIGHTNESS: ' · OSC /mix/{n}/brightness',
    LAYER_SPEED: ' · OSC /mix/{n}/speed',
    LAYER_POS_X: ' · OSC /mix/{n}/posX',
    LAYER_POS_Y: ' · OSC /mix/{n}/posY',
    LAYER_SCALE: ' · OSC /mix/{n}/scale',
    LAYER_AMOUNT: ' · OSC /mix/{n}/amount',
    LAYER_ROTATION: ' · OSC /mix/{n}/rotation',
    LAYER_STRETCH: ' · OSC /mix/{n}/stretch',
    LAYER_RADIUS: ' · OSC /mix/{n}/radius',
    LAYER_MASK_X: ' · OSC /mix/{n}/maskX',
    LAYER_MASK_Y: ' · OSC /mix/{n}/maskY',
    LAYER_SOFTNESS: ' · OSC /mix/{n}/maskSoft',
    // Per-layer feedback
    LAYER_FB_ENABLED: ' · OSC /mix/{n}/fb',
    LAYER_FB_BLEND: ' · OSC /mix/{n}/fb/blend',
    LAYER_FB_AMOUNT: ' · OSC /mix/{n}/fb/amount',
    LAYER_FB_DECAY: ' · OSC /mix/{n}/fb/decay',
    LAYER_FB_ZOOM: ' · OSC /mix/{n}/fb/zoom',
    LAYER_FB_ROTATE: ' · OSC /mix/{n}/fb/rotate',
    LAYER_FB_OX: ' · OSC /mix/{n}/fb/offsetX',
    LAYER_FB_OY: ' · OSC /mix/{n}/fb/offsetY',
    LAYER_FB_SAT: ' · OSC /mix/{n}/fb/sat',
    LAYER_FB_BRT: ' · OSC /mix/{n}/fb/brt',
    // Code panel — global controls
    CODE_LAYER_PREV: ' · OSC /code/prev',
    CODE_LAYER_NEXT: ' · OSC /code/next',
    CODE_ZOOM_IN: ' · OSC /code/zoomIn',
    CODE_ZOOM_OUT: ' · OSC /code/zoomOut',
    CODE_PAUSE: ' · OSC /code/pause',
    CODE_COMPILE: ' · OSC /code/compile',
    CODE_TIME: ' · OSC /code/time',
    CODE_TIME_FINE: ' · OSC /code/fine',
    // Code panel — per-layer dials (dynamic, added via ti() in codeDials.js)
    CODE_DIAL: ' · OSC /code/{layer}/dial/{n}',
};

function ti(key, params) {
    let text = T[key];
    if (!text) return '';
    if (OSC_ADDR[key]) text += OSC_ADDR[key];
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            text = text.replaceAll(`{${k}}`, v);
        }
    }
    return text;
}

function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let tooltipEl = null;
let showTimeout = null;
let currentTarget = null;
let tooltipsEnabled = localStorage.getItem(SETTINGS_KEYS.tooltipsEnabled) !== 'false';

function initTooltipEngine() {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltipEl);

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);

    const btn = document.getElementById('toggle-tooltips');
    if (btn) {
        btn.classList.toggle('active', tooltipsEnabled);
        btn.addEventListener('click', () => {
            tooltipsEnabled = !tooltipsEnabled;
            btn.classList.toggle('active', tooltipsEnabled);
            localStorage.setItem(SETTINGS_KEYS.tooltipsEnabled, String(tooltipsEnabled));
            if (!tooltipsEnabled) hide();
        });
    }
}

function onOver(e) {
    if (!tooltipsEnabled) return;
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    if (target === currentTarget) return;
    clearTimeout(showTimeout);
    currentTarget = target;
    showTimeout = setTimeout(() => show(target), 400);
}

function onOut(e) {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    const related = e.relatedTarget;
    if (target.contains(related)) return;
    clearTimeout(showTimeout);
    currentTarget = null;
    hide();
}

function formatTooltip(text) {
    const sep = ' · ';
    const idx = text.indexOf(sep);
    if (idx === -1) return `<span class="tooltip__desc">${escapeAttr(text)}</span>`;
    const desc = text.substring(0, idx);
    const shortcut = text.substring(idx + sep.length);
    return `<span class="tooltip__desc">${escapeAttr(desc)}</span><span class="tooltip__sep"> · </span><span class="tooltip__shortcut">${escapeAttr(shortcut)}</span>`;
}

function show(target) {
    const text = target.dataset.tooltip;
    if (!text) return;
    tooltipEl.innerHTML = formatTooltip(text);
    tooltipEl.classList.add('tooltip--visible');
    position(target);
}

function position(target) {
    const rect = target.getBoundingClientRect();
    tooltipEl.classList.remove('tooltip--below');
    tooltipEl.style.left = '0px';
    tooltipEl.style.top = '0px';

    requestAnimationFrame(() => {
        const ttRect = tooltipEl.getBoundingClientRect();
        let left = rect.left + rect.width / 2;
        let top = rect.top - 6;

        if (rect.top < ttRect.height + 12) {
            top = rect.bottom + 6;
            tooltipEl.classList.add('tooltip--below');
        }

        left = Math.max(ttRect.width / 2 + 4, Math.min(left, window.innerWidth - ttRect.width / 2 - 4));

        tooltipEl.style.left = left + 'px';
        tooltipEl.style.top = top + 'px';
    });
}

function hide() {
    tooltipEl.classList.remove('tooltip--visible');
}

const STATIC_MAP = [
    ['[data-module="mix"]', 'TAB_MIX'],
    ['[data-module="codedials"]', 'TAB_CODE'],
    ['[data-module="player"]', 'TAB_PLAYER'],
    ['[data-module="stream"]', 'TAB_STREAM'],
    ['[data-module="scanimate"]', 'TAB_SCANIMATE'],
    ['[data-module="voices"]', 'TAB_VOICES'],
    ['[data-module="effects"]', 'TAB_FEEDBACK'],
    ['[data-module="llm"]', 'TAB_LLM'],
    ['[data-module="settings"]', 'TAB_SETTINGS'],

    ['#mix-switch-btn', 'MIX_SWITCH'],
    ['#enableVideo', 'MIX_CAMERA'],
    ['#captureScreen', 'MIX_SCREEN'],
    ['#device-btn', 'MIX_DEVICE_EXPAND'],
    ['#camera-device-dropdown', 'MIX_CAMERA_DEVICE'],
    ['#midi-device-dropdown', 'MIX_MIDI_DEVICE'],
    ['#mix-bg-btn', 'MIX_BG_EXPAND'],
    ['#mix-edit-mode', 'MIX_EDIT_EXPAND'],
    ['#mix-controls-btn', 'MIX_CONTROLS_EXPAND'],
    ['#mix-mask-btn', 'MIX_MASK_EXPAND'],
    ['#mix-playlist-toggle', 'MIX_PLAYLIST_EXPAND'],
    ['#mix-brain-btn', 'MIX_BRAIN_EXPAND'],
    ['#mix-bg-toggle', 'MIX_BG_TOGGLE'],
    ['#mix-bg-color', 'MIX_BG_COLOR'],
    ['#mix-bg-type-dropdown', 'MIX_BG_TYPE'],

    ['#plPlay', 'PL_PLAY'],
    ['#plStop', 'PL_STOP'],
    ['#plPrev', 'PL_PREV'],
    ['#plNext', 'PL_NEXT'],
    ['#plLoop', 'PL_LOOP'],
    ['#plAddCurrent', 'PL_ADD_CURRENT'],
    ['#plAddFromShader', 'PL_ADD_FROM_SHADER'],
    ['#plClearAll', 'PL_CLEAR'],
    ['#plExport', 'PL_EXPORT'],
    ['#plImport', 'PL_IMPORT'],
    ['#plProgressBar', 'PL_PROGRESS'],

    ['[data-vb-bs="8"]', 'VB_BLOCK_SIZE'],
    ['[data-vb-bs="16"]', 'VB_BLOCK_SIZE'],
    ['[data-vb-bs="32"]', 'VB_BLOCK_SIZE'],
    ['#vb-record', 'VB_RECORD'],
    ['#vb-seed', 'VB_SEED'],
    ['#vb-clear', 'VB_CLEAR'],
    ['#vb-blend-slider', 'VB_BLEND'],
    ['#vb-glitch-slider', 'VB_GLITCH'],
    ['#vb-colorw-slider', 'VB_COLOR_W'],
    ['#vb-grid', 'VB_GRID'],
    ['#vb-scanline', 'VB_SCANLINE'],
    ['#vb-audio', 'VB_AUDIO'],
    ['#vb-audio-drive-slider', 'VB_AUDIO_DRIVE'],

    ['#code-edit-mode', 'CODE_EDIT_EXPAND'],
    ['#pausePlay', 'CODE_PAUSE'],
    ['#recompile', 'CODE_COMPILE'],
    ['#timeSliderWrap', 'CODE_TIME'],
    ['#timeSliderFineWrap', 'CODE_TIME_FINE'],

    ['#midiDropZone', 'PLAYER_DROP'],
    ['#playerPlay', 'PLAYER_PLAY'],
    ['#playerPause', 'PLAYER_PAUSE'],
    ['#playerStop', 'PLAYER_STOP'],
    ['#playerProgress', 'PLAYER_PROGRESS'],

    ['#startStream', 'STREAM_START'],
    ['#streamRecord', 'STREAM_RECORD'],
    ['#stream-gateway-url', 'STREAM_GATEWAY'],
    ['#stream-gateway-web-port', 'STREAM_GATEWAY_WEB_PORT'],
    ['#stream-name', 'STREAM_NAME'],
    ['#stream-codec-dropdown .dropdown__selected', 'STREAM_CODEC'],
    ['#stream-abr-toggle', 'STREAM_ABR'],
    ['#stream-cbr-toggle', 'STREAM_CBR'],
    ['#stream-input-analyser-dropdown .dropdown__selected', 'STREAM_INPUT_ANALYSER'],
    ['#stream-input-selector .dropdown__selected', 'STREAM_INPUT_SELECTOR'],
    ['#stream-input-toggle', 'STREAM_INPUT_TOGGLE'],
    ['#stream-input-toggle-all', 'STREAM_INPUT_TOGGLE_ALL'],
    ['#stream-input-url', 'STREAM_INPUT_URL'],
    ['#stream-input-name', 'STREAM_INPUT_NAME'],
    ['#stream-input-latency', 'STREAM_INPUT_LATENCY'],
    ['#stream-input-status', 'STREAM_INPUT_STATUS'],
    ['#stream-input-stats', 'STREAM_INPUT_STATS'],

    ['#scanimate-input-btn', 'SC_INPUT_EXPAND'],
    ['#scanimate-osc-btn', 'SC_OSC_EXPAND'],
    ['#scanimate-patch-btn', 'SC_PATCH_EXPAND'],
    ['#scanimate-enabled-toggle', 'SC_ENABLED'],
    ['#scanimate-fit-dropdown .dropdown__selected', 'SC_FIT'],
    ['#scanimate-speed-slider', 'SC_SPEED'],
    ['#scanimate-waveXDepth-slider', 'SC_WAVE_X'],
    ['#scanimate-waveYDepth-slider', 'SC_WAVE_Y'],
    ['#scanimate-rotation-slider', 'SC_ROTATION'],
    ['#scanimate-barrelAmount-slider', 'SC_BARREL'],
    ['#scanimate-domainWarpIterations-slider', 'SC_WARP_ITERS'],
    ['#scanimate-segmentCount-dropdown .dropdown__selected', 'SC_SEGMENTS'],
    ['#scanimate-anim-enabled', 'SC_ANIM_ENABLED'],
    ['#scanimate-anim-loop', 'SC_ANIM_LOOP'],
    ['#scanimate-anim-play', 'SC_ANIM_PLAY'],
    ['#scanimate-set-initial', 'SC_SET_INITIAL'],
    ['#scanimate-set-final', 'SC_SET_FINAL'],
    ['#scanimate-anim-duration-slider', 'SC_ANIM_DURATION'],
    ['#scanimate-anim-rateA-slider', 'SC_ANIM_RATE_A'],
    ['#scanimate-anim-rateB-slider', 'SC_ANIM_RATE_B'],
    ['#scanimate-anim-progress-slider', 'SC_ANIM_PROGRESS'],
    ['#scanimate-colorizer-enabled', 'SC_COLOR_ENABLED'],
    ['#scanimate-colorA-btn', 'SC_COLOR_A'],
    ['#scanimate-colorB-btn', 'SC_COLOR_B'],
    ['#scanimate-colorC-btn', 'SC_COLOR_C'],
    ['#scanimate-colorCycleSpeed-slider', 'SC_CYCLE_SPEED'],
    ['#scanimate-brightnessBoost-slider', 'SC_BRIGHTNESS_BOOST'],
    ['#scanimate-crt-scanlines', 'SC_CRT_SCANLINES'],
    ['#scanimate-crt-glow', 'SC_CRT_GLOW'],
    ['#scanimate-scanlineIntensity-slider', 'SC_SCANLINE_INTENSITY'],
    ['#scanimate-glowAmount-slider', 'SC_PHOSPHOR'],
    ['#scanimate-crt-chromatic', 'SC_CRT_CHROMATIC'],
    ['#scanimate-crt-vignette', 'SC_CRT_VIGNETTE'],
    ['#scanimate-chromaticAmount-slider', 'SC_RGB_SHIFT'],
    ['#scanimate-vignetteAmount-slider', 'SC_VIGNETTE'],
    ['#scanimate-feedback-enabled', 'SC_FB_ENABLED'],
    ['#scanimate-feedback-amount-slider', 'SC_FB_AMOUNT'],
    ['#scanimate-feedback-decay-slider', 'SC_FB_DECAY'],

    ['#voices-lfo-btn', 'VOICE_LFO_EXPAND'],
    ['#voices-macro-btn', 'VOICE_MACRO_EXPAND'],
    ['#voices-modgrid-btn', 'VOICE_MATRIX_EXPAND'],
    ['#voices-voice-btn', 'VOICE_VOICE_EXPAND'],
    ['#voices-midi-btn', 'VOICE_MIDI_EXPAND'],
    ['#voices-osc-btn', 'VOICE_OSC_EXPAND'],
    ['#voices-eg-btn', 'VOICE_EG_EXPAND'],
    ['#voices-kb-btn', 'VOICE_KB_EXPAND'],
    ['#lfo-bpm-slider', 'LFO_BPM'],

    ['#voiceModePoly', 'VOICE_MODE_POLY'],
    ['#voiceModeMono', 'VOICE_MODE_MONO'],
    ['#voiceModeGlide', 'VOICE_MODE_GLIDE'],
    ['#glideTimeSlider', 'VOICE_GLIDE_TIME'],
    ['[data-midi-channel="all"]', 'MIDI_CHANNEL_ALL'],
    ['#midiNoteMinSlider', 'MIDI_NOTE_MIN'],
    ['#midiNoteMaxSlider', 'MIDI_NOTE_MAX'],

    ['#oscPortInput', 'OSC_PORT'],
    ['#oscPortApply', 'OSC_PORT_APPLY'],
    ['#oscEnableToggle', 'OSC_ENABLE'],
    ['#oscMonitor', 'OSC_MONITOR'],

    ['#oskOctaveDown', 'OSK_OCTAVE_DOWN'],
    ['#oskOctaveUp', 'OSK_OCTAVE_UP'],

    ['#feedbackEnabled', 'FB_ENABLED'],
    ['#feedback-blend-dropdown', 'FB_BLEND'],
    ['[data-panel="effects"] [data-param="feedbackAmount"]', 'FB_AMOUNT'],
    ['[data-panel="effects"] [data-param="feedbackDecay"]', 'FB_DECAY'],
    ['[data-panel="effects"] [data-param="feedbackZoom"]', 'FB_ZOOM'],
    ['[data-panel="effects"] [data-param="feedbackRotate"]', 'FB_ROTATE'],
    ['[data-panel="effects"] [data-param="feedbackOffsetX"]', 'FB_OFFSET_X'],
    ['[data-panel="effects"] [data-param="feedbackOffsetY"]', 'FB_OFFSET_Y'],
    ['[data-panel="effects"] [data-param="feedbackSaturation"]', 'FB_SATURATION'],
    ['[data-panel="effects"] [data-param="feedbackBrightness"]', 'FB_BRIGHTNESS'],

    ['#view-hide-btn', 'SETTINGS_HIDE'],
    ['#toggle-sync', 'SETTINGS_SYNC'],
    ['[data-expand-target="nodes-section"]', 'SETTINGS_NODES'],
    ['#settings-rendering-toggle', 'SETTINGS_RENDERING'],
    ['#help-btn', 'SETTINGS_HELP'],
    ['#config-btn', 'SETTINGS_CONFIG'],
    ['[data-expand-target="color-section"]', 'SETTINGS_COLOR'],
    ['#settings-debug-mode', 'SETTINGS_DEBUG_EXPAND'],
    ['#toggle-wires', 'SETTINGS_WIRES'],
    ['#toggle-autolayout', 'SETTINGS_AUTO'],
    ['#btn-fit', 'SETTINGS_FIT'],
    ['#precision-dropdown', 'SETTINGS_PRECISION'],
    ['#resolution-dropdown', 'SETTINGS_RESOLUTION'],
    ['#dbg-refresh', 'SETTINGS_DBG_REFRESH'],
    ['#apiUrl', 'SETTINGS_API_URL'],
    ['#bearerKey', 'SETTINGS_BEARER'],
    ['#refreshModels', 'SETTINGS_REFRESH_MODELS'],
    ['#modelSelectImage-dropdown .dropdown__selected', 'SETTINGS_MODEL_IMAGE'],
    ['#modelSelectText-dropdown .dropdown__selected', 'SETTINGS_MODEL_TEXT'],
    ['#captureResolution-dropdown .dropdown__selected', 'SETTINGS_CAPTURE_RES'],
    ['#captureFormat-dropdown .dropdown__selected', 'SETTINGS_FORMAT'],
    ['#captureQualitySlider', 'SETTINGS_QUALITY'],
    ['#liveTuningMaxIterations', 'SETTINGS_MAX_ITER'],
    ['#resetSettings', 'SETTINGS_RESET'],
    ['#saveSettings', 'SETTINGS_SAVE'],

    ['#color-section .knob-group:nth-child(1) .knob', 'COLOR_LIFT'],
    ['#color-section .knob-group:nth-child(2) .knob', 'COLOR_GAMMA'],
    ['#color-section .knob-group:nth-child(3) .knob', 'COLOR_GAIN'],
    ['#color-section [data-expand-target="color-section"] ~ .panel-section .tool-btn--radio:nth-child(1)', 'COLOR_CURVE_MASTER'],
    ['#lut-dropdown', 'COLOR_LUT'],

    ['#modeShader', 'LLM_MODE_SHADER'],
    ['#modeChat', 'LLM_MODE_CHAT'],
    ['#askLLM', 'LLM_SEND'],
    ['#askLLMWithImage', 'LLM_SEND_IMAGE'],
    ['#clearHistory', 'LLM_CLEAR'],
    ['#userMessage', 'LLM_PROMPT'],
    ['#startLiveTuning', 'LT_START'],
    ['#stopLiveTuning', 'LT_STOP'],
    ['#liveTuningPrompt', 'LT_PROMPT'],

    ['#modal-close', 'MODAL_CLOSE'],
    ['#panel-resize-handle', 'RESIZE_HANDLE'],
];

function applyStaticLfoTooltips() {
    for (let i = 0; i < 4; i++) {
        const els = [
            [`#lfo-waveform-${i}`, ti('LFO_WAVEFORM', { n: i + 1 })],
            [`#lfo-rate-slider-${i}`, ti('LFO_RATE', { n: i + 1 })],
            [`#lfo-expand-${i}`, ti('LFO_EXPAND', { n: i + 1 })],
            [`#lfo-phase-slider-${i}`, ti('LFO_PHASE', { n: i + 1 })],
            [`#lfo-amp-slider-${i}`, ti('LFO_AMP', { n: i + 1 })],
            [`#lfo-offset-slider-${i}`, ti('LFO_OFFSET', { n: i + 1 })],
            [`#lfo-sync-toggle-${i}`, ti('LFO_SYNC', { n: i + 1 })],
            [`#lfo-sync-rate-${i}`, ti('LFO_SYNC_RATE', { n: i + 1 })],
            [`#lfo-keysync-toggle-${i}`, ti('LFO_KEYSYNC', { n: i + 1 })],
        ];
        for (const [sel, text] of els) {
            const el = document.querySelector(sel);
            if (el) el.dataset.tooltip = text;
        }
    }
}

function applyStaticMidiChannelTooltips() {
    for (let i = 0; i < 16; i++) {
        const el = document.querySelector(`[data-midi-channel="${i}"]`);
        if (el) el.dataset.tooltip = ti('MIDI_CHANNEL', { n: i + 1 });
    }
}

function applyStaticColorTooltips() {
    const curveBtns = document.querySelectorAll('#color-section .panel-section:nth-child(2) .tool-btn--radio');
    const curveKeys = ['COLOR_CURVE_MASTER', 'COLOR_CURVE_RGB', 'COLOR_CURVE_HSL', 'COLOR_CURVE_LUM'];
    curveBtns.forEach((btn, i) => {
        if (curveKeys[i]) btn.dataset.tooltip = T[curveKeys[i]];
    });

    const scopeBtns = document.querySelectorAll('#color-section .panel-section:nth-child(4) .tool-btn--radio');
    const scopeKeys = ['COLOR_SCOPE_WAVE', 'COLOR_SCOPE_VECTOR', 'COLOR_SCOPE_HIST', 'COLOR_SCOPE_RGBP'];
    scopeBtns.forEach((btn, i) => {
        if (scopeKeys[i]) btn.dataset.tooltip = T[scopeKeys[i]];
    });

    const lutBtns = document.querySelectorAll('.lut-buttons .tool-btn');
    if (lutBtns[0]) lutBtns[0].dataset.tooltip = T.COLOR_LUT_LOAD;
    if (lutBtns[1]) lutBtns[1].dataset.tooltip = T.COLOR_LUT_SAVE;
}

function applyStaticLayerBtnTooltips() {
    document.querySelectorAll('.layer-btn').forEach(btn => {
        const n = parseInt(btn.dataset.layer, 10) + 1;
        btn.dataset.tooltip = ti('LAYER_BTN', { n });
    });
}

function applyTooltips() {
    initTooltipEngine();

    for (const [selector, key] of STATIC_MAP) {
        const el = document.querySelector(selector);
        if (el) el.dataset.tooltip = ti(key);
    }

    applyStaticLfoTooltips();
    applyStaticMidiChannelTooltips();
    applyStaticColorTooltips();
    applyStaticLayerBtnTooltips();
}

export { T, ti, escapeAttr, applyTooltips };
