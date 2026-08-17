import { state } from '../state.js';
import { LayerSystem } from '../webgl/layers.js';
import { Sync } from '../features/sync.js';
import { LFOEngine } from '../features/lfoEngine.js';
import { MODULATION_SOURCES, BLEND_MODES, MAX_VOICES } from '../config.js';

const FLAME_BG = '#2A2A2A';
const FLAME_GRID = '#3D3D3D';
const REFRESH_INTERVAL = 250;
const STORAGE_KEY = 'nodeGraphLayout';

const LAYER_COLORS = [
    '#6B8CAE', '#6B4A8A', '#8C6B4A', '#4A8C8C',
    '#8C4A6B', '#4A8A6B', '#8A8A4A', '#4A6B8A'
];

const WIRE_COLORS = {
    lfo: '#6B8C4A',
    audio: '#4A8C8C',
    midi: '#8C6B4A',
    macro: '#8A4A8A',
    eg: '#8A8A4A'
};

let graph = null;
let lgraphcanvas = null;
let graphCanvas = null;
let nodesRegistered = false;
let _syncing = false;
let _lastRefresh = 0;
let _wiresVisible = true;
let _expandedGroups = new Map();
let _selectedNode = null;
const _wireToModEntry = new Map();

function nodeToLayer(node, prop, value) {
    if (_syncing) return;
    _syncing = true;
    const layer = LayerSystem.layers[node.properties.layerIndex];
    if (layer) {
        layer[prop] = value;
        Sync.send(LayerSystem.getState());
    }
    _syncing = false;
}

function nodeToState(key, value) {
    if (_syncing) return;
    _syncing = true;
    const data = {};
    data[key] = value;
    Sync.send(data);
    _syncing = false;
}

function registerNodeTypes() {
    if (nodesRegistered) return;
    nodesRegistered = true;

    LiteGraph.NODE_TITLE_HEIGHT = 20;
    LiteGraph.NODE_SLOT_HEIGHT = 16;
    LiteGraph.NODE_WIDTH = 160;
    LiteGraph.NODE_MIN_WIDTH = 120;
    LiteGraph.NODE_COLLAPSED_RADIUS = 8;
    LiteGraph.NODE_COLLAPSED_WIDTH = 100;
    LiteGraph.CANVAS_GRID_SIZE = 20;
    LiteGraph.NODE_TITLE_COLOR = '#3D3D3D';
    LiteGraph.NODE_DEFAULT_COLOR = '#4A4A4A';
    LiteGraph.NODE_DEFAULT_BGCOLOR = '#2A2A2A';
    LiteGraph.NODE_DEFAULT_BOXCOLOR = '#6B8CAE';
    LiteGraph.NODE_DEFAULT_SHAPE = 'box';

    function BackgroundNode() {
        this.addOutput("texture", "image");
        this.properties = { type: 'solid', color: '#000000' };
        this.addWidget("combo", "Type", this.properties.type, v => { this.properties.type = v; }, {
            values: ["solid", "image", "video", "webcam", "screen", "text"]
        });
        this.addWidget("text", "Color", this.properties.color, v => { this.properties.color = v; });
        this.size = [160, 70];
    }
    BackgroundNode.title = "Background";
    BackgroundNode.title_color = "#555555";
    LiteGraph.registerNodeType("node/background", BackgroundNode);

    function LayerNode() {
        this.addInput("texture", "image");
        this.addInput("mod", "number");
        this.addOutput("texture", "image");
        this.properties = {
            layerIndex: 0, name: 'Layer', opacity: 1.0,
            blendMode: 'normal', enabled: true, solo: false, materialType: 'shader'
        };
        this.addWidget("text", "Name", this.properties.name, v => {
            this.properties.name = v;
            nodeToLayer(this, 'name', v);
        });
        this.addWidget("slider", "Opacity", this.properties.opacity, v => {
            this.properties.opacity = v;
            nodeToLayer(this, 'opacity', v);
        }, { min: 0, max: 1, step: 0.01 });
        this.addWidget("combo", "Blend", this.properties.blendMode, v => {
            this.properties.blendMode = v;
            nodeToLayer(this, 'blendMode', v);
        }, { values: BLEND_MODES });
        this.addWidget("toggle", "Enabled", this.properties.enabled, v => {
            this.properties.enabled = v;
            nodeToLayer(this, 'enabled', v);
        });
        this.addWidget("toggle", "Solo", this.properties.solo, v => {
            this.properties.solo = v;
            nodeToLayer(this, 'solo', v);
        });
        this.size = [200, 150];
    }
    LayerNode.title = "Layer";
    LayerNode.prototype.onDblClick = function() {
        const layer = LayerSystem.layers[this.properties.layerIndex];
        if (layer) {
            showShaderModal(this.properties.name, layer.material ? layer.material.source : '', this.properties.layerIndex);
        }
        toggleLayerGroup(this);
    };
    LayerNode.prototype.onDrawForeground = function(ctx) {
        if (!this.properties.enabled) {
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.fillRect(0, 0, this.size[0], this.size[1]);
        }
        if (this.properties.solo) {
            ctx.fillStyle = '#FFD700';
            ctx.font = '9px monospace';
            ctx.fillText('SOLO', this.size[0] - 30, 12);
        }
        if (this.properties.materialType !== 'shader') {
            ctx.fillStyle = '#888';
            ctx.font = '9px monospace';
            ctx.fillText(this.properties.materialType.toUpperCase(), 4, this.size[1] - 4);
        }
    };
    LayerNode.prototype.onConnectionsChange = handleConnectionChange;
    LiteGraph.registerNodeType("node/layer", LayerNode);

    function VoiceNode() {
        this.addOutput("value", "number");
        this.properties = { voiceIndex: 0, layerIndex: 0, active: false, note: 0, velocity: 0 };
        this.size = [120, 40];
    }
    VoiceNode.title = "Voice";
    VoiceNode.title_color = "#888888";
    LiteGraph.registerNodeType("node/voice", VoiceNode);

    function EGNode() {
        this.addOutput("value", "number");
        this.properties = {
            egIndex: 0, layerIndex: 0, attack: 0.1, decay: 0.3,
            sustain: 0.7, release: 0.5, state: 'idle', value: 0
        };
        this.addWidget("slider", "Atk", this.properties.attack, v => {
            this.properties.attack = v;
            updateEG(this);
        }, { min: 0, max: 5, step: 0.01 });
        this.addWidget("slider", "Dec", this.properties.decay, v => {
            this.properties.decay = v;
            updateEG(this);
        }, { min: 0, max: 5, step: 0.01 });
        this.addWidget("slider", "Sus", this.properties.sustain, v => {
            this.properties.sustain = v;
            updateEG(this);
        }, { min: 0, max: 1, step: 0.01 });
        this.addWidget("slider", "Rel", this.properties.release, v => {
            this.properties.release = v;
            updateEG(this);
        }, { min: 0, max: 5, step: 0.01 });
        this.size = [140, 110];
    }
    EGNode.title = "EG";
    EGNode.title_color = WIRE_COLORS.eg;
    EGNode.prototype.onDrawForeground = function(ctx) {
        const li = this.properties.layerIndex;
        const ei = this.properties.egIndex;
        const layer = LayerSystem.layers[li];
        if (!layer || !layer.egs[ei]) return;
        const eg = layer.egs[ei];
        const x = 4, y = this.size[1] - 20, w = this.size[0] - 8, h = 14;
        ctx.fillStyle = '#1A1A1A';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = WIRE_COLORS.eg;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const segs = [eg.attack, eg.decay, eg.sustain, eg.release];
        const total = segs[0] + segs[1] + segs[3] + 0.1;
        let cx = x;
        ctx.moveTo(cx, y + h);
        cx += (segs[0] / total) * w;
        ctx.lineTo(cx, y);
        cx += (segs[1] / total) * w;
        ctx.lineTo(cx, y + (1 - eg.sustain) * h);
        cx += 0.1 / total * w;
        cx += (segs[3] / total) * w;
        ctx.lineTo(cx, y + h);
        ctx.stroke();
        const stateColors = { idle: '#555', attack: '#8A8', decay: '#AA8', sustain: '#8A8A4A', release: '#A88', delay: '#888' };
        ctx.fillStyle = stateColors[eg.state] || '#555';
        ctx.font = '8px monospace';
        ctx.fillText(eg.state.toUpperCase(), 4, 10);
    };

    function updateEG(node) {
        if (_syncing) return;
        _syncing = true;
        const layer = LayerSystem.layers[node.properties.layerIndex];
        if (layer && layer.egs[node.properties.egIndex]) {
            const eg = layer.egs[node.properties.egIndex];
            eg.attack = node.properties.attack;
            eg.decay = node.properties.decay;
            eg.sustain = node.properties.sustain;
            eg.release = node.properties.release;
        }
        _syncing = false;
    }
    LiteGraph.registerNodeType("node/eg", EGNode);

    function LFONode() {
        this.addOutput("value", "number");
        this.properties = {
            lfoIndex: 0, rate: 1, waveform: 'sine',
            amplitude: 1.0, dcOffset: 0, phase: 0
        };
        this.addWidget("text", "Rate", this.properties.rate, v => {
            this.properties.rate = parseFloat(v) || 1;
            updateLFO(this);
        });
        this.addWidget("combo", "Wave", this.properties.waveform, v => {
            this.properties.waveform = v;
            updateLFO(this);
        }, { values: ["sine", "square", "saw", "triangle", "snh", "noise"] });
        this.addWidget("slider", "Amp", this.properties.amplitude, v => {
            this.properties.amplitude = v;
            updateLFO(this);
        }, { min: 0, max: 2, step: 0.01 });
        this.addWidget("slider", "DC", this.properties.dcOffset, v => {
            this.properties.dcOffset = v;
            updateLFO(this);
        }, { min: -1, max: 1, step: 0.01 });
        this.size = [160, 120];
    }
    LFONode.title = "LFO";
    LFONode.title_color = WIRE_COLORS.lfo;
    LFONode.prototype.onDrawForeground = function(ctx) {
        const lfo = state.lfos[this.properties.lfoIndex];
        if (!lfo) return;
        const x = 4, y = this.size[1] - 24, w = this.size[0] - 8, h = 18;
        ctx.fillStyle = '#1A1A1A';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = WIRE_COLORS.lfo;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i <= w; i++) {
            const phase = (i / w + lfo.phase) % 1;
            let val = 0;
            if (lfo.waveform === 'sine') val = Math.sin(phase * Math.PI * 2);
            else if (lfo.waveform === 'square') val = phase < 0.5 ? 1 : -1;
            else if (lfo.waveform === 'saw') val = 2 * phase - 1;
            else if (lfo.waveform === 'triangle') val = 1 - 4 * Math.abs(phase - 0.5);
            else val = Math.sin(phase * Math.PI * 2);
            const py = y + h / 2 - (val * lfo.amplitude * h / 2.5);
            if (i === 0) ctx.moveTo(x + i, py);
            else ctx.lineTo(x + i, py);
        }
        ctx.stroke();
    };

    function updateLFO(node) {
        if (_syncing) return;
        _syncing = true;
        const idx = node.properties.lfoIndex;
        if (state.lfos[idx]) {
            state.lfos[idx].rate = node.properties.rate;
            state.lfos[idx].waveform = node.properties.waveform;
            state.lfos[idx].amplitude = node.properties.amplitude;
            state.lfos[idx].dcOffset = node.properties.dcOffset;
            Sync.send({
                lfos: state.lfos.map(l => ({
                    rate: l.rate, waveform: l.waveform, phaseOffset: l.phaseOffset,
                    amplitude: l.amplitude, dcOffset: l.dcOffset,
                    syncMode: l.syncMode, syncRate: l.syncRate, keySync: l.keySync
                }))
            });
        }
        _syncing = false;
    }
    LiteGraph.registerNodeType("node/lfo", LFONode);

    function AudioNode() {
        this.addOutput("peak", "number");
        this.addOutput("bandLow", "number");
        this.addOutput("bandMid", "number");
        this.addOutput("bandHigh", "number");
        this.properties = { gain: 1.0 };
        this.addWidget("slider", "Gain", this.properties.gain, v => {
            this.properties.gain = v;
        }, { min: 0, max: 2, step: 0.01 });
        this.size = [140, 110];
    }
    AudioNode.title = "Audio";
    AudioNode.title_color = WIRE_COLORS.audio;
    AudioNode.prototype.onDrawForeground = function(ctx) {
        const mod = state.audioModulators;
        if (!mod) return;
        const bands = [mod.peak, mod.bandLow, mod.bandMid, mod.bandHigh];
        const x = 4, bw = (this.size[0] - 12) / 4, bh = 20, y = this.size[1] - 24;
        for (let i = 0; i < 4; i++) {
            const v = Math.min(bands[i], 1);
            ctx.fillStyle = '#1A1A1A';
            ctx.fillRect(x + i * (bw + 2), y, bw, bh);
            ctx.fillStyle = WIRE_COLORS.audio;
            ctx.fillRect(x + i * (bw + 2), y + bh * (1 - v), bw, bh * v);
        }
    };
    LiteGraph.registerNodeType("node/audio", AudioNode);

    function MIDINode() {
        this.addOutput("note", "number");
        this.addOutput("velocity", "number");
        this.addOutput("cc", "number");
        this.addOutput("aftertouch", "number");
        this.addOutput("pitchbend", "number");
        this.properties = { channel: 0, ccNumber: 1 };
        this.addWidget("combo", "Ch", this.properties.channel, v => {
            this.properties.channel = v;
        }, { values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] });
        this.addWidget("slider", "CC#", this.properties.ccNumber, v => {
            this.properties.ccNumber = v;
        }, { min: 0, max: 127, step: 1 });
        this.size = [140, 140];
    }
    MIDINode.title = "MIDI";
    MIDINode.title_color = WIRE_COLORS.midi;
    LiteGraph.registerNodeType("node/midi", MIDINode);

    function MacroNode() {
        this.addOutput("value", "number");
        this.properties = { macroIndex: 0, name: 'Macro', value: 0.5 };
        this.addWidget("text", "Name", this.properties.name, v => {
            this.properties.name = v;
            updateMacro(this);
        });
        this.addWidget("slider", "Value", this.properties.value, v => {
            this.properties.value = v;
            updateMacro(this);
        }, { min: 0, max: 1, step: 0.01 });
        this.size = [140, 70];
    }
    MacroNode.title = "Macro";
    MacroNode.title_color = WIRE_COLORS.macro;

    function updateMacro(node) {
        if (_syncing) return;
        _syncing = true;
        const idx = node.properties.macroIndex;
        if (state.macros[idx]) {
            state.macros[idx].name = node.properties.name;
            state.macros[idx].value = node.properties.value;
        }
        _syncing = false;
    }
    LiteGraph.registerNodeType("node/macro", MacroNode);

    function KeyboardNode() {
        this.addOutput("note", "number");
        this.properties = {};
        this.size = [100, 40];
    }
    KeyboardNode.title = "Keyboard";
    KeyboardNode.title_color = "#8C6B4A";
    LiteGraph.registerNodeType("node/keyboard", KeyboardNode);

    function CompositeNode() {
        this.addInput("base", "image");
        for (let i = 0; i < 8; i++) this.addInput("L" + i, "image");
        this.addOutput("result", "image");
        this.properties = {};
        this.size = [180, 200];
    }
    CompositeNode.title = "Composite";
    CompositeNode.title_color = "#8A6B4A";
    LiteGraph.registerNodeType("node/composite", CompositeNode);

    function FeedbackNode() {
        this.addInput("current", "image");
        this.addInput("previous", "image");
        this.addOutput("result", "image");
        this.properties = { amount: 0.5, decay: 0.9, zoom: 1.0, rotate: 0.0 };
        this.addWidget("slider", "Amount", this.properties.amount, v => {
            this.properties.amount = v;
            updateMasterFeedback(this);
        }, { min: 0, max: 1, step: 0.01 });
        this.addWidget("slider", "Decay", this.properties.decay, v => {
            this.properties.decay = v;
            updateMasterFeedback(this);
        }, { min: 0, max: 1, step: 0.01 });
        this.addWidget("slider", "Zoom", this.properties.zoom, v => {
            this.properties.zoom = v;
            updateMasterFeedback(this);
        }, { min: 0.5, max: 2, step: 0.01 });
        this.addWidget("slider", "Rotate", this.properties.rotate, v => {
            this.properties.rotate = v;
            updateMasterFeedback(this);
        }, { min: -1, max: 1, step: 0.01 });
        this.size = [160, 130];
    }
    FeedbackNode.title = "Feedback";
    FeedbackNode.title_color = "#8A4A6B";

    function updateMasterFeedback(node) {
        if (_syncing) return;
        _syncing = true;
        if (LayerSystem.masterState) {
            LayerSystem.masterState.feedbackAmount = node.properties.amount;
            LayerSystem.masterState.feedbackDecay = node.properties.decay;
            LayerSystem.masterState.feedbackZoom = node.properties.zoom;
            LayerSystem.masterState.feedbackRotate = node.properties.rotate;
            Sync.send({ master: LayerSystem.masterState });
        }
        _syncing = false;
    }
    LiteGraph.registerNodeType("node/feedback", FeedbackNode);

    function LayerFeedbackNode() {
        this.addInput("current", "image");
        this.addInput("previous", "image");
        this.addOutput("result", "image");
        this.properties = { layerIndex: 0, amount: 0.5, decay: 0.9, zoom: 1.0, rotate: 0.0 };
        this.addWidget("slider", "Amount", this.properties.amount, v => {
            this.properties.amount = v;
            updateLayerFeedback(this);
        }, { min: 0, max: 1, step: 0.01 });
        this.addWidget("slider", "Decay", this.properties.decay, v => {
            this.properties.decay = v;
            updateLayerFeedback(this);
        }, { min: 0, max: 1, step: 0.01 });
        this.addWidget("slider", "Zoom", this.properties.zoom, v => {
            this.properties.zoom = v;
            updateLayerFeedback(this);
        }, { min: 0.5, max: 2, step: 0.01 });
        this.addWidget("slider", "Rotate", this.properties.rotate, v => {
            this.properties.rotate = v;
            updateLayerFeedback(this);
        }, { min: -1, max: 1, step: 0.01 });
        this.size = [160, 130];
    }
    LayerFeedbackNode.title = "Layer FB";
    LayerFeedbackNode.title_color = "#8A4A6B";

    function updateLayerFeedback(node) {
        if (_syncing) return;
        _syncing = true;
        const layer = LayerSystem.layers[node.properties.layerIndex];
        if (layer) {
            layer.feedbackAmount = node.properties.amount;
            layer.feedbackDecay = node.properties.decay;
            layer.feedbackZoom = node.properties.zoom;
            layer.feedbackRotate = node.properties.rotate;
            Sync.send(LayerSystem.getState());
        }
        _syncing = false;
    }
    LiteGraph.registerNodeType("node/layer-feedback", LayerFeedbackNode);

    function VisualizerNode() {
        this.addInput("audio", "audio");
        this.addOutput("texture", "image");
        this.properties = { type: 'waveform', gain: 1.0, thickness: 0.02 };
        this.addWidget("combo", "Type", this.properties.type, v => { this.properties.type = v; }, {
            values: ["waveform", "spectrum", "circular", "oscilloscope"]
        });
        this.addWidget("slider", "Gain", this.properties.gain, v => { this.properties.gain = v; }, { min: 0.1, max: 5, step: 0.1 });
        this.addWidget("slider", "Thick", this.properties.thickness, v => { this.properties.thickness = v; }, { min: 0.001, max: 0.1, step: 0.001 });
        this.size = [180, 100];
    }
    VisualizerNode.title = "Visualizer";
    VisualizerNode.title_color = "#4A8A6B";
    LiteGraph.registerNodeType("node/visualizer", VisualizerNode);

    function VisualBrainNode() {
        this.addInput("texture", "image");
        this.addOutput("texture", "image");
        this.properties = { blendAmount: 1.0, glitchAmount: 0.3, colorWeight: 3.0 };
        this.addWidget("slider", "Blend", this.properties.blendAmount, v => { this.properties.blendAmount = v; }, { min: 0, max: 1, step: 0.01 });
        this.addWidget("slider", "Glitch", this.properties.glitchAmount, v => { this.properties.glitchAmount = v; }, { min: 0, max: 1, step: 0.01 });
        this.addWidget("slider", "Color", this.properties.colorWeight, v => { this.properties.colorWeight = v; }, { min: 0, max: 10, step: 0.1 });
        this.size = [160, 100];
    }
    VisualBrainNode.title = "VisualBrain";
    VisualBrainNode.title_color = "#4A6B8A";
    LiteGraph.registerNodeType("node/visualbrain", VisualBrainNode);

    function OutputNode() {
        this.addInput("texture", "image");
        this.properties = {};
        this.size = [120, 40];
    }
    OutputNode.title = "Output";
    OutputNode.title_color = "#C44B4B";
    LiteGraph.registerNodeType("node/output", OutputNode);
}

function showShaderModal(name, code, layerIndex) {
    const title = document.getElementById('modal-title');
    const codeEl = document.getElementById('modal-code');
    const modal = document.getElementById('shader-modal');
    if (title) title.textContent = 'Layer ' + (layerIndex + 1) + ': ' + name;
    if (codeEl) codeEl.textContent = code || '(no shader code)';
    if (modal) modal.classList.add('modal-open');
}

function closeShaderModal() {
    const modal = document.getElementById('shader-modal');
    if (modal) modal.classList.remove('modal-open');
}

function resizeGraphCanvas() {
    if (!graphCanvas || !graph) return;
    graphCanvas.width = graphCanvas.clientWidth;
    graphCanvas.height = graphCanvas.clientHeight;
    graph.setDirtyCanvas(true);
}

function createNode(type, pos) {
    const node = LiteGraph.createNode(type);
    if (!node) return null;
    node.pos = [pos[0], pos[1]];
    graph.add(node);
    return node;
}

function buildGraphFromLayers() {
    if (!graph) return;
    graph.clear();
    _wireToModEntry.clear();
    _syncing = true;

    const layers = LayerSystem.layers || [];
    const sourceX = 50;
    const sourceX2 = 230;
    const layerX = 450;
    const pipelineX = 900;

    const lfoNodes = [];
    for (let i = 0; i < 4; i++) {
        const lfo = state.lfos[i];
        const node = createNode("node/lfo", [sourceX, 30 + i * 100]);
        if (!node) continue;
        node.properties.lfoIndex = i;
        node.properties.rate = lfo.rate;
        node.properties.waveform = lfo.waveform;
        node.properties.amplitude = lfo.amplitude;
        node.properties.dcOffset = lfo.dcOffset;
        node.title = 'LFO ' + (i + 1);
        if (node.widgets) {
            node.widgets[0].value = lfo.rate;
            node.widgets[1].value = lfo.waveform;
            node.widgets[2].value = lfo.amplitude;
            node.widgets[3].value = lfo.dcOffset;
        }
        lfoNodes.push(node);
    }

    const audioNode = createNode("node/audio", [sourceX, 30 + 4 * 100]);
    if (audioNode) audioNode.title = "Audio";

    const midiNode = createNode("node/midi", [sourceX, 30 + 5 * 100]);
    if (midiNode) midiNode.title = "MIDI";

    const macroNodes = [];
    for (let i = 0; i < 8; i++) {
        const macro = state.macros[i];
        const node = createNode("node/macro", [sourceX2, 30 + i * 70]);
        if (!node) continue;
        node.properties.macroIndex = i;
        node.properties.name = macro.name;
        node.properties.value = macro.value;
        node.title = macro.name;
        if (node.widgets) {
            node.widgets[0].value = macro.name;
            node.widgets[1].value = macro.value;
        }
        macroNodes.push(node);
    }

    const kbdNode = createNode("node/keyboard", [sourceX2, 30 + 8 * 70]);

    const bgNode = createNode("node/background", [layerX - 200, 250]);
    if (bgNode) {
        bgNode.title = "Background";
        const bs = LayerSystem.backgroundState;
        if (bs && bs.material) {
            bgNode.properties.type = bs.material.type || 'solid';
            bgNode.properties.color = bs.material.source || '#000000';
            if (bgNode.widgets) {
                bgNode.widgets[0].value = bgNode.properties.type;
                bgNode.widgets[1].value = bgNode.properties.color;
            }
        }
    }

    const layerNodes = [];
    for (let i = 0; i < Math.min(layers.length, 8); i++) {
        const layer = layers[i];
        const y = 30 + i * 110;
        const node = createNode("node/layer", [layerX, y]);
        if (!node) continue;
        node.properties.layerIndex = i;
        node.properties.name = layer.name || 'Layer ' + (i + 1);
        node.properties.opacity = layer.opacity;
        node.properties.blendMode = layer.blendMode;
        node.properties.enabled = layer.enabled;
        node.properties.solo = layer.solo;
        node.properties.materialType = layer.material ? layer.material.type || 'shader' : 'shader';
        node.title = layer.name || 'Layer ' + (i + 1);
        node.title_color = LAYER_COLORS[i % 8];
        if (node.widgets) {
            node.widgets[0].value = node.properties.name;
            node.widgets[1].value = node.properties.opacity;
            node.widgets[2].value = node.properties.blendMode;
            node.widgets[3].value = node.properties.enabled;
            node.widgets[4].value = node.properties.solo;
        }
        layerNodes.push(node);
    }

    const compositeNode = createNode("node/composite", [pipelineX, 200]);
    if (compositeNode) compositeNode.title = "Composite";

    const feedbackNode = createNode("node/feedback", [pipelineX + 220, 200]);
    if (feedbackNode) {
        feedbackNode.title = "Master Feedback";
        const ms = LayerSystem.masterState;
        if (ms) {
            feedbackNode.properties.amount = ms.feedbackAmount != null ? ms.feedbackAmount : 0.5;
            feedbackNode.properties.decay = ms.feedbackDecay != null ? ms.feedbackDecay : 0.9;
            feedbackNode.properties.zoom = ms.feedbackZoom != null ? ms.feedbackZoom : 1.0;
            feedbackNode.properties.rotate = ms.feedbackRotate != null ? ms.feedbackRotate : 0.0;
            if (feedbackNode.widgets) {
                feedbackNode.widgets[0].value = feedbackNode.properties.amount;
                feedbackNode.widgets[1].value = feedbackNode.properties.decay;
                feedbackNode.widgets[2].value = feedbackNode.properties.zoom;
                feedbackNode.widgets[3].value = feedbackNode.properties.rotate;
            }
        }
    }

    const outputNode = createNode("node/output", [pipelineX + 420, 200]);
    if (outputNode) outputNode.title = "Output";

    if (bgNode && compositeNode) {
        bgNode.connect(0, compositeNode, 0);
    }

    for (let i = 0; i < layerNodes.length; i++) {
        if (compositeNode) {
            layerNodes[i].connect(0, compositeNode, i + 1);
        }
    }

    if (compositeNode && feedbackNode) {
        compositeNode.connect(0, feedbackNode, 0);
    }
    if (feedbackNode && outputNode) {
        feedbackNode.connect(0, outputNode, 0);
    }

    const allEntries = [];
    for (let li = 0; li < layers.length; li++) {
        const matrix = layers[li].modulationMatrix || state.layerModulationMatrices[li] || [];
        for (const entry of matrix) {
            if (!entry.enabled) continue;
            allEntries.push(Object.assign({}, entry, { _layerIndex: li }));
        }
    }

    const audioSlotMap = { audio_peak: 0, audio_band_low: 1, audio_band_mid: 2, audio_band_high: 3 };
    const midiSlotMap = { note: 0, velocity: 1, cc: 2, aftertouch: 3, pitchbend: 4 };

    for (const entry of allEntries) {
        let srcNode = null;
        let srcSlot = 0;
        const src = entry.source || '';

        if (src.startsWith('lfo')) {
            const idx = parseInt(src.replace('lfo', ''), 10) - 1;
            if (idx >= 0 && idx < lfoNodes.length) {
                srcNode = lfoNodes[idx];
                srcSlot = 0;
            }
        } else if (src.startsWith('audio_')) {
            srcNode = audioNode;
            srcSlot = audioSlotMap[src] || 0;
        } else if (midiSlotMap[src] !== undefined) {
            srcNode = midiNode;
            srcSlot = midiSlotMap[src];
        } else if (src.startsWith('eg')) {
            continue;
        } else if (src.startsWith('macro')) {
            const idx = parseInt(src.replace('macro', ''), 10) - 1;
            if (idx >= 0 && idx < macroNodes.length) {
                srcNode = macroNodes[idx];
                srcSlot = 0;
            }
        } else if (src === 'kbd') {
            srcNode = kbdNode;
            srcSlot = 0;
        }

        if (srcNode && layerNodes[entry._layerIndex]) {
            srcNode.connect(srcSlot, layerNodes[entry._layerIndex], 1);
        }
    }

    graph.setDirtyCanvas(true);
    _syncing = false;
}

function autoLayout() {
    if (!graph) return;
    const nodes = graph._nodes;
    if (!nodes || !nodes.length) return;

    const sources = [];
    const layerNodes = [];
    const pipeline = [];
    const other = [];

    for (const node of nodes) {
        const t = node.type;
        if (t === 'node/lfo' || t === 'node/audio' || t === 'node/midi' || t === 'node/macro' || t === 'node/keyboard') {
            sources.push(node);
        } else if (t === 'node/layer') {
            layerNodes.push(node);
        } else if (t === 'node/composite' || t === 'node/feedback' || t === 'node/layer-feedback' || t === 'node/output') {
            pipeline.push(node);
        } else {
            other.push(node);
        }
    }

    layerNodes.sort((a, b) => (a.properties.layerIndex || 0) - (b.properties.layerIndex || 0));

    sources.forEach((node, i) => { node.pos = [50, 30 + i * 80]; });
    layerNodes.forEach((node, i) => { node.pos = [400, 30 + i * 100]; });
    pipeline.forEach((node, i) => { node.pos = [800 + i * 200, 200]; });
    other.forEach((node, i) => { node.pos = [400, 30 + layerNodes.length * 100 + 50 + i * 80]; });

    graph.setDirtyCanvas(true);
}

function fitToView() {
    if (!lgraphcanvas || !graph) return;
    const nodes = graph._nodes;
    if (!nodes || !nodes.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
        minX = Math.min(minX, node.pos[0]);
        minY = Math.min(minY, node.pos[1]);
        maxX = Math.max(maxX, node.pos[0] + (node.size[0] || 160));
        maxY = Math.max(maxY, node.pos[1] + (node.size[1] || 100));
    }

    const graphW = maxX - minX;
    const graphH = maxY - minY;
    const canvasW = graphCanvas.clientWidth || 800;
    const canvasH = graphCanvas.clientHeight || 600;
    const margin = 50;

    const scaleX = graphW > 0 ? (canvasW - margin * 2) / graphW : 1;
    const scaleY = graphH > 0 ? (canvasH - margin * 2) / graphH : 1;
    const scale = Math.min(scaleX, scaleY, 2.0);

    lgraphcanvas.scale = scale;
    lgraphcanvas.offset[0] = margin - minX * scale;
    lgraphcanvas.offset[1] = margin - minY * scale;
    graph.setDirtyCanvas(true);
}

function toggleWires() {
    if (!lgraphcanvas) return;
    _wiresVisible = !_wiresVisible;
    lgraphcanvas.links_render_mode = _wiresVisible ? 0 : 2;
    if (graph) graph.setDirtyCanvas(true);
}

function getWireColor(link) {
    if (!link || !graph) return '#666';
    const originNode = graph.getNodeById(link.origin_id);
    if (!originNode) return '#666';
    switch (originNode.type) {
        case 'node/lfo': return WIRE_COLORS.lfo;
        case 'node/audio': return WIRE_COLORS.audio;
        case 'node/midi': return WIRE_COLORS.midi;
        case 'node/macro': return WIRE_COLORS.macro;
        case 'node/eg': return WIRE_COLORS.eg;
        default: return '#666';
    }
}

function toggleLayerGroup(layerNode) {
    const li = layerNode.properties.layerIndex;
    if (_expandedGroups.has(li)) {
        const group = _expandedGroups.get(li);
        for (const node of group.nodes) {
            if (graph && node) graph.remove(node);
        }
        _expandedGroups.delete(li);
        if (graph) graph.setDirtyCanvas(true);
        return;
    }

    const layer = LayerSystem.layers[li];
    if (!layer) return;

    const group = { nodes: [] };
    const baseX = layerNode.pos[0] + 220;
    const baseY = layerNode.pos[1];

    const egNodes = [];
    for (let ei = 0; ei < 4; ei++) {
        const eg = layer.egs[ei];
        const node = createNode("node/eg", [baseX, baseY + ei * 80]);
        if (!node) continue;
        node.properties.egIndex = ei;
        node.properties.layerIndex = li;
        node.properties.attack = eg.attack;
        node.properties.decay = eg.decay;
        node.properties.sustain = eg.sustain;
        node.properties.release = eg.release;
        node.title = 'EG ' + (ei + 1);
        node.title_color = WIRE_COLORS.eg;
        if (node.widgets) {
            node.widgets[0].value = eg.attack;
            node.widgets[1].value = eg.decay;
            node.widgets[2].value = eg.sustain;
            node.widgets[3].value = eg.release;
        }
        egNodes.push(node);
        group.nodes.push(node);
    }

    for (const egNode of egNodes) {
        egNode.connect(0, layerNode, 1);
    }

    if (layer.feedbackEnabled) {
        const fbNode = createNode("node/layer-feedback", [baseX, baseY + 4 * 80]);
        if (fbNode) {
            fbNode.properties.layerIndex = li;
            fbNode.properties.amount = layer.feedbackAmount;
            fbNode.properties.decay = layer.feedbackDecay;
            fbNode.properties.zoom = layer.feedbackZoom;
            fbNode.properties.rotate = layer.feedbackRotate;
            fbNode.title = 'Layer ' + (li + 1) + ' FB';
            if (fbNode.widgets) {
                fbNode.widgets[0].value = fbNode.properties.amount;
                fbNode.widgets[1].value = fbNode.properties.decay;
                fbNode.widgets[2].value = fbNode.properties.zoom;
                fbNode.widgets[3].value = fbNode.properties.rotate;
            }
            group.nodes.push(fbNode);
        }
    }

    for (let vi = 0; vi < MAX_VOICES; vi++) {
        const vm = layer.voiceManager;
        const voice = vm.voices[vi];
        const vNode = createNode("node/voice", [baseX + 160, baseY + vi * 40]);
        if (!vNode) continue;
        vNode.properties.voiceIndex = vi;
        vNode.properties.layerIndex = li;
        vNode.properties.active = voice && voice.active;
        vNode.properties.note = voice ? voice.note : 0;
        vNode.properties.velocity = voice ? voice.velocity : 0;
        vNode.title = 'V' + (vi + 1) + (vNode.properties.active ? ' ON' : '');
        group.nodes.push(vNode);
    }

    _expandedGroups.set(li, group);
    if (graph) graph.setDirtyCanvas(true);
}

function refreshNodeStates() {
    if (!graph || _syncing) return;
    _syncing = true;

    const nodes = graph._nodes;
    if (!nodes) { _syncing = false; return; }

    for (const node of nodes) {
        switch (node.type) {
            case 'node/lfo': {
                const idx = node.properties.lfoIndex;
                if (idx !== undefined && state.lfos[idx]) {
                    const val = LFOEngine.getOutputValue(idx);
                    node.properties.phase = state.lfos[idx].phase;
                    node.title = 'LFO ' + (idx + 1) + ' (' + val.toFixed(2) + ')';
                }
                break;
            }
            case 'node/audio': {
                const mod = state.audioModulators;
                if (mod) {
                    node.title = 'Audio (peak: ' + mod.peak.toFixed(2) + ')';
                }
                break;
            }
            case 'node/layer': {
                const li = node.properties.layerIndex;
                const layer = LayerSystem.layers[li];
                if (layer) {
                    node.properties.opacity = layer.opacity;
                    node.properties.blendMode = layer.blendMode;
                    node.properties.enabled = layer.enabled;
                    node.properties.solo = layer.solo;
                    if (node.widgets) {
                        node.widgets[1].value = layer.opacity;
                        node.widgets[2].value = layer.blendMode;
                        node.widgets[3].value = layer.enabled;
                        node.widgets[4].value = layer.solo;
                    }
                    const badge = layer.enabled ? '\u25CF' : '\u25CB';
                    const solo = layer.solo ? ' S' : '';
                    node.title = badge + ' ' + (layer.name || 'Layer ' + (li + 1)) + solo;
                }
                break;
            }
            case 'node/eg': {
                const li = node.properties.layerIndex;
                const ei = node.properties.egIndex;
                const layer = LayerSystem.layers[li];
                if (layer && layer.egs[ei]) {
                    const eg = layer.egs[ei];
                    // Use first active voice's per-voice EG for live state display
                    let liveEg = eg;
                    if (layer.voiceManager && layer.voiceManager.voices) {
                        const activeVoice = layer.voiceManager.voices.find(v => v.active && v.egs && v.egs[ei]);
                        if (activeVoice) liveEg = activeVoice.egs[ei];
                    }
                    node.properties.state = liveEg.state;
                    node.properties.value = liveEg.value;
                    node.properties.attack = eg.attack;
                    node.properties.decay = eg.decay;
                    node.properties.sustain = eg.sustain;
                    node.properties.release = eg.release;
                    if (node.widgets) {
                        node.widgets[0].value = eg.attack;
                        node.widgets[1].value = eg.decay;
                        node.widgets[2].value = eg.sustain;
                        node.widgets[3].value = eg.release;
                    }
                    node.title = 'EG ' + (ei + 1) + ' (' + liveEg.state + ': ' + liveEg.value.toFixed(2) + ')';
                }
                break;
            }
            case 'node/macro': {
                const mi = node.properties.macroIndex;
                if (state.macros[mi]) {
                    node.properties.value = state.macros[mi].value;
                    node.properties.name = state.macros[mi].name;
                    if (node.widgets) {
                        node.widgets[1].value = state.macros[mi].value;
                    }
                    node.title = state.macros[mi].name + ' (' + state.macros[mi].value.toFixed(2) + ')';
                }
                break;
            }
            case 'node/feedback': {
                const ms = LayerSystem.masterState;
                if (ms) {
                    node.properties.amount = ms.feedbackAmount != null ? ms.feedbackAmount : 0.5;
                    node.properties.decay = ms.feedbackDecay != null ? ms.feedbackDecay : 0.9;
                    node.properties.zoom = ms.feedbackZoom != null ? ms.feedbackZoom : 1.0;
                    node.properties.rotate = ms.feedbackRotate != null ? ms.feedbackRotate : 0.0;
                    if (node.widgets) {
                        node.widgets[0].value = node.properties.amount;
                        node.widgets[1].value = node.properties.decay;
                        node.widgets[2].value = node.properties.zoom;
                        node.widgets[3].value = node.properties.rotate;
                    }
                }
                break;
            }
            case 'node/voice': {
                const li = node.properties.layerIndex;
                const vi = node.properties.voiceIndex;
                const layer = LayerSystem.layers[li];
                if (layer && layer.voiceManager && layer.voiceManager.voices[vi]) {
                    const voice = layer.voiceManager.voices[vi];
                    node.properties.active = voice.active;
                    node.properties.note = voice.note || 0;
                    node.properties.velocity = voice.velocity || 0;
                    node.title = 'V' + (vi + 1) + (voice.active ? ' ON n' + voice.note : '');
                }
                break;
            }
        }
    }

    _syncing = false;
}

function handleConnectionChange(inputOrOutput, slot, connected, link) {
    if (_syncing || !link) return;
    if (inputOrOutput !== LiteGraph.INPUT || slot !== 1) return;

    const originNode = graph.getNodeById(link.origin_id);
    const targetNode = graph.getNodeById(link.target_id);
    if (!originNode || !targetNode) return;

    if (targetNode.type !== 'node/layer') return;

    const layerIndex = targetNode.properties.layerIndex;
    const layer = LayerSystem.layers[layerIndex];
    if (!layer) return;

    if (!connected) {
        const entryId = _wireToModEntry.get(link.id);
        if (entryId === undefined) return;
        _wireToModEntry.delete(link.id);
        const stateMatrix = state.layerModulationMatrices[layerIndex];
        if (Array.isArray(stateMatrix)) {
            const si = stateMatrix.findIndex(entry => entry.id === entryId);
            if (si !== -1) stateMatrix.splice(si, 1);
        }
        if (Array.isArray(layer.modulationMatrix)) {
            const li = layer.modulationMatrix.findIndex(entry => entry.id === entryId);
            if (li !== -1) layer.modulationMatrix.splice(li, 1);
        }
        Sync.send(LayerSystem.getState());
        return;
    }

    let source = '';
    let sourceConfig = {};

    if (originNode.type === 'node/lfo') {
        source = 'lfo' + (originNode.properties.lfoIndex + 1);
    } else if (originNode.type === 'node/audio') {
        const slotMap = ['audio_peak', 'audio_band_low', 'audio_band_mid', 'audio_band_high'];
        source = slotMap[link.origin_slot] || 'audio_peak';
    } else if (originNode.type === 'node/midi') {
        const slotMap = ['note', 'velocity', 'cc', 'aftertouch', 'pitchbend'];
        source = slotMap[link.origin_slot] || 'cc';
        if (source === 'cc') sourceConfig = { cc: originNode.properties.ccNumber || 1 };
    } else if (originNode.type === 'node/macro') {
        source = 'macro' + (originNode.properties.macroIndex + 1);
    } else if (originNode.type === 'node/keyboard') {
        source = 'kbd';
    }

    if (!source) return;

    const matrix = state.layerModulationMatrices[layerIndex];
    if (!matrix) return;

    const newEntry = {
        id: Date.now(),
        source: source,
        sourceConfig: sourceConfig,
        destination: 'u_brightness',
        amount: 1.0,
        curve: 'linear',
        enabled: true
    };
    matrix.push(newEntry);

    if (layer.modulationMatrix) {
        layer.modulationMatrix.push(newEntry);
    }

    _wireToModEntry.set(link.id, newEntry.id);

    Sync.send({ layerModulationMatrices: state.layerModulationMatrices });
}

function saveLayout() {
    if (!graph) return;
    try {
        const data = graph.serialize();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
}

function loadLayout() {
    if (!graph) return false;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        _syncing = true;
        graph.configure(data);
        _syncing = false;
        return true;
    } catch (e) {
        _syncing = false;
        return false;
    }
}

function showInspector(node) {
    const panel = document.getElementById('node-inspector');
    if (!panel) return;
    if (!node) {
        panel.style.display = 'none';
        return;
    }
    _selectedNode = node;
    panel.style.display = 'block';

    const title = document.getElementById('node-inspector-title');
    const props = document.getElementById('node-inspector-props');
    const conns = document.getElementById('node-inspector-conns');

    if (title) title.textContent = node.title + ' (' + (node.type || '') + ')';

    if (props) {
        let html = '';
        for (const [k, v] of Object.entries(node.properties || {})) {
            if (k.startsWith('_')) continue;
            const display = typeof v === 'number' ? v.toFixed(3) : String(v);
            html += '<div class="node-inspector__row"><span class="node-inspector__key">' + k + '</span><span>' + display + '</span></div>';
        }
        props.innerHTML = html;
    }

    if (conns) {
        let html = '';
        if (node.inputs) {
            for (let i = 0; i < node.inputs.length; i++) {
                const input = node.inputs[i];
                if (input.link != null) {
                    const link = graph.links[input.link];
                    if (link) {
                        const srcNode = graph.getNodeById(link.origin_id);
                        html += '<div class="node-inspector__conn-in"><span class="node-inspector__conn-in-arrow">\u2192</span> ' + input.name + ' \u2190 ' + (srcNode ? srcNode.title : '?') + '.' + (srcNode.outputs[link.origin_slot] ? srcNode.outputs[link.origin_slot].name : '?') + '</div>';
                    }
                }
            }
        }
        if (node.outputs) {
            for (let i = 0; i < node.outputs.length; i++) {
                const output = node.outputs[i];
                if (output.links) {
                    for (const linkId of output.links) {
                        const link = graph.links[linkId];
                        if (link) {
                            const tgtNode = graph.getNodeById(link.target_id);
                            html += '<div class="node-inspector__conn-out"><span class="node-inspector__conn-out-arrow">\u2190</span> ' + output.name + ' \u2192 ' + (tgtNode ? tgtNode.title : '?') + '.' + (tgtNode.inputs[link.target_slot] ? tgtNode.inputs[link.target_slot].name : '?') + '</div>';
                        }
                    }
                }
            }
        }
        conns.innerHTML = html || '<div class="node-inspector__empty">No connections</div>';
    }
}

function updateInspector() {
    if (_selectedNode) showInspector(_selectedNode);
}

export const NodeGraph = {
    init() {
        if (typeof LiteGraph === 'undefined') {
            return;
        }

        registerNodeTypes();

        graphCanvas = document.getElementById('graph-canvas');
        if (!graphCanvas) return;

        graph = new LGraph();
        lgraphcanvas = new LGraphCanvas(graphCanvas, graph, {
            autoresize: false,
            background_color: FLAME_BG,
            grid_color: FLAME_GRID,
            clear_background: true
        });

        try {
            lgraphcanvas.showMinimap(0.15);
        } catch (e) {}

        lgraphcanvas.onNodeSelected = function(node) {
            showInspector(node);
        };

        lgraphcanvas.onNodeDeselected = function() {
            showInspector(null);
        };

        lgraphcanvas.onDrawLink = function(ctx, link) {
            if (!link || !graph) return false;
            const color = getWireColor(link);
            const originNode = graph.getNodeById(link.origin_id);
            const targetNode = graph.getNodeById(link.target_id);
            if (!originNode || !targetNode) return false;
            const start = originNode.getOutputNodePos(link.origin_slot);
            const end = targetNode.getInputNodePos(link.target_slot);
            if (!start || !end) return false;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(start[0], start[1]);
            const dx = Math.abs(end[0] - start[0]) * 0.5;
            ctx.bezierCurveTo(start[0] + dx, start[1], end[0] - dx, end[1], end[0], end[1]);
            ctx.stroke();
            return true;
        };

        const modalClose = document.getElementById('modal-close');
        if (modalClose) modalClose.addEventListener('click', closeShaderModal);

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeShaderModal();
        });

        window.addEventListener('resize', () => {
            if (document.body.classList.contains('nodes-view')) resizeGraphCanvas();
        });
    },

    show() {
        if (!graphCanvas) return;
        resizeGraphCanvas();
        _expandedGroups.clear();
        if (!loadLayout()) {
            buildGraphFromLayers();
        }
        graph.start();
    },

    hide() {
        if (graph) {
            saveLayout();
            graph.stop();
        }
    },

    resize() {
        resizeGraphCanvas();
    },

    refresh() {
        const now = performance.now();
        if (now - _lastRefresh < REFRESH_INTERVAL) return;
        _lastRefresh = now;
        refreshNodeStates();
        updateInspector();
    },

    autoLayout() {
        autoLayout();
    },

    fitToView() {
        fitToView();
    },

    toggleWires() {
        toggleWires();
    },

    rebuild() {
        buildGraphFromLayers();
    }
};
