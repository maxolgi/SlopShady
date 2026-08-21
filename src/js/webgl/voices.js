/**
 * Voice Manager
 * Polyphonic voice allocation with mono/glide modes
 * Each Layer gets a VoiceManager instance for up to 4 visual voices
 * Per-voice EGs control amplitude during release and attack
 */

import { MAX_VOICES } from '../config.js';
import { state } from '../state.js';
import { EGSystem } from '../features/envelopeGenerators.js';
import { LFOEngine } from '../features/lfoEngine.js';

const STEAL_FADE_DURATION = 0.05;

export class VoiceManager {
    constructor(maxVoices = MAX_VOICES, layer = null) {
        this.maxVoices = maxVoices;
        this.layer = layer;
        this.voiceMode = 'poly';
        this.glideTime = 0.1;
        this._activeVoiceCount = 0;
        this._uniformArrays = null;
        this._syncedEgVersion = -1;

        this.voices = [];
        for (let i = 0; i < maxVoices; i++) {
            this.voices.push({
                active: false,
                releasing: false,
                note: 0,
                velocity: 0,
                startTime: 0,
                releaseTime: 0,
                position: { x: 0.5, y: 0.5 },
                scale: 1.0,
                rotation: 0,
                usePos: true,
                useScale: true,
                useRotate: true,
                glideFrom: 0,
                glideStart: 0,
                egs: Array.from({ length: 4 }, () => EGSystem.createEG()),
                _fadeInProgress: 0
            });
        }

        this.lastNote = 0;
        this.monoNoteStack = [];
    }

    _syncEGParams(voice) {
        if (!this.layer || !this.layer.egs) return;
        for (let i = 0; i < voice.egs.length; i++) {
            if (this.layer.egs[i]) {
                EGSystem.setEGParams(voice.egs[i], this.layer.egs[i]);
            }
        }
    }

    _triggerEGs(voice, velocity) {
        this._syncEGParams(voice);
        for (const eg of voice.egs) {
            EGSystem.triggerEG(eg, velocity);
        }
    }

    _releaseEGs(voice) {
        for (const eg of voice.egs) {
            EGSystem.releaseEG(eg);
        }
    }

    trigger(note, velocity) {
        const now = performance.now();

        if (this.voiceMode === 'mono' || this.voiceMode === 'glide') {
            const voice = this.voices[0];

            const stackIdx = this.monoNoteStack.indexOf(note);
            const isNewNote = stackIdx === -1;
            if (isNewNote) {
                this.monoNoteStack.push(note);
                this._activeVoiceCount++;
            }

            if (voice.releasing) {
                voice.releasing = false;
            }

            if (this.voiceMode === 'glide' && voice.active && voice.note !== note) {
                voice.glideFrom = voice.note;
                voice.glideStart = now;
            }

            voice._fadeInProgress = 0;
            voice.active = true;
            voice.note = note;
            voice.velocity = velocity;
            voice.startTime = now;

            this._triggerEGs(voice, velocity / 127);
            this.lastNote = note;
        } else {
            const voice = this._allocateVoice();
            const wasActive = voice.active;

            voice._fadeInProgress = wasActive ? STEAL_FADE_DURATION : 0;
            voice.releasing = false;
            voice.active = true;
            voice.note = note;
            voice.velocity = velocity;
            voice.startTime = now;
            voice.releaseTime = 0;

            this._triggerEGs(voice, velocity / 127);
            if (!wasActive) this._activeVoiceCount++;
            this.lastNote = note;
        }

        for (let i = 0; i < state.lfos.length; i++) {
            if (state.lfos[i].keySync) {
                LFOEngine.resetPhase(i);
            }
        }
    }

    release(note) {
        const now = performance.now();

        if (this.voiceMode === 'mono' || this.voiceMode === 'glide') {
            const stackIdx = this.monoNoteStack.indexOf(note);
            if (stackIdx !== -1) {
                this.monoNoteStack.splice(stackIdx, 1);
            }

            if (this.monoNoteStack.length > 0) {
                const prevNote = this.monoNoteStack[this.monoNoteStack.length - 1];
                const voice = this.voices[0];
                if (this.voiceMode === 'glide') {
                    voice.glideFrom = voice.note;
                    voice.glideStart = now;
                }
                voice.note = prevNote;
                voice.velocity = voice.velocity || 100;
                voice.releasing = false;
                this._triggerEGs(voice, voice.velocity / 127);
                this.lastNote = prevNote;
            } else {
                const voice = this.voices[0];
                if (voice.note === note && !voice.releasing) {
                    voice.releasing = true;
                    voice.releaseTime = now;
                    this._releaseEGs(voice);
                    this._activeVoiceCount = Math.max(0, this._activeVoiceCount - 1);
                }
            }
        } else {
            const voice = this.voices.find(v => v.note === note && v.active && !v.releasing);
            if (voice) {
                voice.releasing = true;
                voice.releaseTime = now;
                this._releaseEGs(voice);
                this._activeVoiceCount = Math.max(0, this._activeVoiceCount - 1);
            }
        }
    }

    releaseAll() {
        for (const voice of this.voices) {
            if (voice.active && !voice.releasing) {
                voice.releasing = true;
                this._releaseEGs(voice);
            }
            voice._fadeInProgress = 0;
        }
        this._activeVoiceCount = 0;
        this.monoNoteStack = [];
    }

    _allocateVoice() {
        for (const voice of this.voices) {
            if (!voice.active) return voice;
        }
        let oldest = this.voices[0];
        for (const voice of this.voices) {
            if (voice.startTime < oldest.startTime) {
                oldest = voice;
            }
        }
        return oldest;
    }

    process(deltaTime = 0.016) {
        const egDirty = !!this.layer && this.layer._egParamsVersion !== this._syncedEgVersion;
        if (egDirty) this._syncedEgVersion = this.layer._egParamsVersion;
        for (const voice of this.voices) {
            if (voice.active || voice.releasing) {
                if (egDirty) this._syncEGParams(voice);
                for (const eg of voice.egs) {
                    EGSystem.processEG(eg, deltaTime);
                }

                if (voice._fadeInProgress > 0) {
                    voice._fadeInProgress = Math.max(0, voice._fadeInProgress - deltaTime);
                }

                if (voice.releasing && voice.egs[0].state === 'idle') {
                    voice.active = false;
                    voice.releasing = false;
                }
            }
        }

        if (this.voiceMode !== 'glide') return;

        const voice = this.voices[0];
        if (!voice.active || voice.glideStart === 0) return;

        const now = performance.now();
        const elapsed = (now - voice.glideStart) / 1000;

        if (elapsed < this.glideTime) {
            voice._glideProgress = elapsed / this.glideTime;
        } else {
            voice.glideFrom = voice.note;
            voice._glideProgress = 1.0;
        }
    }

    _getEffectiveNote(voice) {
        if (this.voiceMode === 'glide' && voice._glideProgress !== undefined && voice._glideProgress < 1.0) {
            return voice.glideFrom + (voice.note - voice.glideFrom) * voice._glideProgress;
        }
        return voice.note;
    }

    getUniforms() {
        // Arrays are reused across calls — callers must not retain or mutate them
        if (!this._uniformArrays) {
            this._uniformArrays = {
                u_voiceActive: new Float32Array(this.maxVoices),
                u_voiceNote: new Float32Array(this.maxVoices),
                u_voiceVelocity: new Float32Array(this.maxVoices),
                u_voicePosX: new Float32Array(this.maxVoices),
                u_voicePosY: new Float32Array(this.maxVoices),
                u_voiceScale: new Float32Array(this.maxVoices),
                u_voiceRotation: new Float32Array(this.maxVoices),
                u_voiceUsePos: new Float32Array(this.maxVoices),
                u_voiceUseScale: new Float32Array(this.maxVoices),
                u_voiceUseRot: new Float32Array(this.maxVoices),
                u_voiceEG: new Float32Array(this.maxVoices)
            };
        }
        const u = this._uniformArrays;

        for (let i = 0; i < this.maxVoices; i++) {
            const v = this.voices[i];
            u.u_voiceActive[i] = v.active ? 1.0 : 0.0;
            u.u_voiceNote[i] = this._getEffectiveNote(v);
            u.u_voiceVelocity[i] = v.velocity / 127;
            u.u_voicePosX[i] = v.position.x;
            u.u_voicePosY[i] = v.position.y;
            u.u_voiceScale[i] = v.scale;
            u.u_voiceRotation[i] = v.rotation;
            u.u_voiceUsePos[i] = v.usePos ? 1.0 : 0.0;
            u.u_voiceUseScale[i] = v.useScale ? 1.0 : 0.0;
            u.u_voiceUseRot[i] = v.useRotate ? 1.0 : 0.0;
            u.u_voiceEG[i] = (v.egs && v.egs[0]) ? v.egs[0].value : 0;
        }

        return u;
    }

    setVoiceMode(mode) {
        if (mode !== 'poly' && mode !== 'mono' && mode !== 'glide' && mode !== 'off') return;
        this.voiceMode = mode;
        this.releaseAll();
    }

    setGlideTime(time) {
        this.glideTime = Math.max(0, time);
    }

    getActiveCount() {
        return this.voices.filter(v => v.active).length;
    }

    hasActiveVoices() {
        return this.voices.some(v => v.active);
    }

    getPitchBend() {
        const pb = state.pitchBend;
        for (const ch in pb) {
            if (Object.hasOwn(pb, ch)) {
                return pb[ch];
            }
        }
        return 0;
    }

    getChannelPressure() {
        const cp = state.channelPressure;
        for (const ch in cp) {
            if (Object.hasOwn(cp, ch)) {
                return cp[ch] / 127;
            }
        }
        return 0;
    }

    getLatestNote() {
        if (!this.hasActiveVoices()) return 0;
        if (this.voiceMode === 'mono' || this.voiceMode === 'glide') {
            return this._getEffectiveNote(this.voices[0]);
        }
        const active = this.voices.filter(v => v.active);
        if (!active.length) return 0;
        return active.reduce((a, b) => a.startTime > b.startTime ? a : b).note;
    }
}
