/**
 * ModulationMatrix Engine
 * Per-layer synth-style modulation matrix.
 * Sources (LFO, EG, CC, audio, etc.) route to layer params or shader uniforms.
 * Output is an additive offset: source=0 → offset=0 (base value unchanged),
 * source=1 with amount=0.5 → offset=+0.5 added to base.
 */

import { state } from '../state.js';
import { MODULATION_SOURCES, MAX_VOICES, LFO_WAVEFORMS, MODULATION_CURVES } from '../config.js';
import { LFOEngine } from './lfoEngine.js';

const VOICE_DEST_INDEXED = /^u_voice(PosX|PosY|Scale|Rotation)\[(\d+)\]$/i;
const VOICE_DEST_ALL = /^u_voice(PosX|PosY|Scale|Rotation)$/i;
const VOICE_PARAM_KEY = { posx: 'posX', posy: 'posY', scale: 'scale', rotation: 'rotation' };
const PER_VOICE_SOURCES = new Set(['note', 'velocity', 'kbd', 'eg0', 'eg1', 'eg2', 'eg3']);

export const ModulationMatrix = {
    update(deltaTime, layer) {
        const vm = layer.voiceManager;
        const entries = layer.modulationMatrix || [];
        const layerUniforms = {};
        const voiceUniforms = {};
        const activeVoices = vm && vm.voices ? vm.voices.filter(v => v.active) : [];

        for (const entry of entries) {
            if (!entry.enabled) continue;
            const amount = Number.isFinite(entry.amount) ? entry.amount : 1.0;
            const isPerVoice = PER_VOICE_SOURCES.has(entry.source);

            // Indexed voice destination: u_voicePosX[0]
            const idxMatch = entry.destination.match(VOICE_DEST_INDEXED);
            if (idxMatch) {
                const paramKey = VOICE_PARAM_KEY[idxMatch[1].toLowerCase()];
                const vi = parseInt(idxMatch[2], 10);
                if (vi < 0 || vi >= MAX_VOICES) continue;
                if (!vm || !vm.voices) continue;
                const voice = vm.voices[vi];

                let sv, value;
                if (isPerVoice) {
                    if (!voice || !voice.active) continue;
                    sv = this.getSourceValue(entry.source, entry.sourceConfig, voice, vm, layer);
                    value = this.applyCurve(sv, entry.curve) * amount;
                } else {
                    sv = this.getSourceValue(entry.source, entry.sourceConfig, null, vm, layer);
                    value = this.applyCurve(sv, entry.curve) * amount;
                }

                entry._lastSourceValue = sv;
                entry._lastOutputValue = value;
                voiceUniforms[vi] = voiceUniforms[vi] || {};
                voiceUniforms[vi][paramKey] = (voiceUniforms[vi][paramKey] || 0) + value;
                continue;
            }

            // Unindexed voice destination: u_voicePosX (all voices)
            const allMatch = entry.destination.match(VOICE_DEST_ALL);
            if (allMatch) {
                const paramKey = VOICE_PARAM_KEY[allMatch[1].toLowerCase()];

                if (isPerVoice) {
                    if (!vm || !vm.voices) continue;
                    for (let vi = 0; vi < MAX_VOICES; vi++) {
                        const voice = vm.voices[vi];
                        if (!voice || !voice.active) continue;
                        const sv = this.getSourceValue(entry.source, entry.sourceConfig, voice, vm, layer);
                        const value = this.applyCurve(sv, entry.curve) * amount;
                        entry._lastSourceValue = sv;
                        entry._lastOutputValue = value;
                        voiceUniforms[vi] = voiceUniforms[vi] || {};
                        voiceUniforms[vi][paramKey] = (voiceUniforms[vi][paramKey] || 0) + value;
                    }
                } else {
                    const sv = this.getSourceValue(entry.source, entry.sourceConfig, null, vm, layer);
                    const value = this.applyCurve(sv, entry.curve) * amount;
                    entry._lastSourceValue = sv;
                    entry._lastOutputValue = value;
                    for (let vi = 0; vi < MAX_VOICES; vi++) {
                        voiceUniforms[vi] = voiceUniforms[vi] || {};
                        voiceUniforms[vi][paramKey] = (voiceUniforms[vi][paramKey] || 0) + value;
                    }
                }
                continue;
            }

            // Layer-level destination (existing behavior)
            let value = 0;
            let sv;
            if (isPerVoice && activeVoices.length) {
                for (const voice of activeVoices) {
                    sv = this.getSourceValue(entry.source, entry.sourceConfig, voice, vm, layer);
                    const curved = this.applyCurve(sv, entry.curve);
                    value += curved * amount;
                }
            } else {
                sv = this.getSourceValue(entry.source, entry.sourceConfig, null, vm, layer);
                const curved = this.applyCurve(sv, entry.curve);
                value = curved * amount;
            }
            entry._lastSourceValue = sv;
            entry._lastOutputValue = value;
            layerUniforms[entry.destination] = (layerUniforms[entry.destination] || 0) + value;
        }

        return { layerUniforms, voiceUniforms };
    },

    getSourceValue(source, sourceConfig, voice, voiceManager, layer) {
        const cfg = sourceConfig || {};
        let raw = 0;

        switch (source) {
            case 'note':
                raw = voice ? voice.note / 127 : 0;
                break;

            case 'velocity':
                raw = voice ? voice.velocity / 127 : 0;
                break;

            case 'cc': {
                const cc = cfg.cc ?? 1;
                raw = Object.hasOwn(state.midiCCValues, cc) ? state.midiCCValues[cc] : 0;
                break;
            }

            case 'osc': {
                const addr = cfg.address ?? '';
                raw = addr && Object.hasOwn(state.oscValues, addr) ? state.oscValues[addr] : 0;
                break;
            }

            case 'aftertouch': {
                const ch = voice?.channel ?? 1;
                raw = Object.hasOwn(state.channelPressure, ch) ? state.channelPressure[ch] / 127 : 0;
                break;
            }

            case 'pitchbend': {
                const ch = voice?.channel ?? 1;
                const val = Object.hasOwn(state.pitchBend, ch) ? state.pitchBend[ch] : 0;
                raw = (val + 1) / 2;
                break;
            }

            case 'kbd':
                raw = voice && Number.isFinite(voice.note) ? voice.note / 127 : 0;
                break;

            case 'eg0':
                raw = voice && voice.egs ? voice.egs[0].value : (layer && layer.egs && layer.egs[0] ? layer.egs[0].value : 0);
                break;
            case 'eg1':
                raw = voice && voice.egs ? voice.egs[1].value : (layer && layer.egs && layer.egs[1] ? layer.egs[1].value : 0);
                break;
            case 'eg2':
                raw = voice && voice.egs ? voice.egs[2].value : (layer && layer.egs && layer.egs[2] ? layer.egs[2].value : 0);
                break;
            case 'eg3':
                raw = voice && voice.egs ? voice.egs[3].value : (layer && layer.egs && layer.egs[3] ? layer.egs[3].value : 0);
                break;

            case 'lfo1':
            case 'lfo2':
            case 'lfo3':
            case 'lfo4': {
                const lfoIndex = parseInt(source.replace('lfo', '')) - 1;
                const out = LFOEngine.getOutputValue(lfoIndex);
                raw = Math.max(0, Math.min(1, (out + 1) / 2));
                break;
            }
            case 'lfo_sine':
            case 'lfo_square':
            case 'lfo_triangle':
            case 'lfo_saw': {
                const waveform = source.replace('lfo_', '');
                const lfo = state.lfos[0];
                if (lfo) {
                        const fn = Object.prototype.hasOwnProperty.call(LFO_WAVEFORMS, waveform) ? LFO_WAVEFORMS[waveform] : LFO_WAVEFORMS.sine;
                    const phase = (lfo.phase + lfo.phaseOffset) % 1;
                    const val = fn(phase);
                    const amp = lfo.amplitude !== undefined ? lfo.amplitude : 1.0;
                    const dc = lfo.dcOffset || 0;
                    raw = Math.max(0, Math.min(1, (val * amp + dc + 1) / 2));
                }
                break;
            }

            case 'audio_peak':
                raw = state.audioModulators?.peak ?? 0;
                break;
            case 'audio_band_low':
                raw = state.audioModulators?.bandLow ?? 0;
                break;
            case 'audio_band_mid':
                raw = state.audioModulators?.bandMid ?? 0;
                break;
            case 'audio_band_high':
                raw = state.audioModulators?.bandHigh ?? 0;
                break;

            case 'macro1': case 'macro2': case 'macro3': case 'macro4':
            case 'macro5': case 'macro6': case 'macro7': case 'macro8': {
                const mi = parseInt(source.replace('macro', '')) - 1;
                raw = state.macros[mi]?.value ?? 0.5;
                break;
            }

            default:
                raw = 0;
        }

        return Number.isFinite(raw) ? raw : 0;
    },

    applyCurve(value, curve) {
        if (!Number.isFinite(value)) return 0;
        const curveFn = MODULATION_CURVES[curve] || MODULATION_CURVES.linear;
        const result = curveFn(Math.max(0, Math.min(1, value)));
        return Math.max(0, Math.min(1, result));
    }
};
