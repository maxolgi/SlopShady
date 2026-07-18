/**
 * Envelope Generator System
 * Per-layer ADSR envelope generators with delay, hold, loop, and curve shapes
 */

export const EG_DEFAULTS = {
    attack: 0.1,
    decay: 0.3,
    sustain: 0.7,
    release: 0.5,
    delay: 0,
    hold: 0,
    loop: 'oneshot',
    curveShape: 'linear'
};

function applyCurve(t, shape) {
    if (shape === 'exp') return t * t;
    if (shape === 'log') return Math.log10(t * 9 + 1);
    return t;
}

export const EGSystem = {
    createEG(defaults) {
        const d = defaults || EG_DEFAULTS;
        return {
            attack: d.attack ?? EG_DEFAULTS.attack,
            decay: d.decay ?? EG_DEFAULTS.decay,
            sustain: d.sustain ?? EG_DEFAULTS.sustain,
            release: d.release ?? EG_DEFAULTS.release,
            delay: d.delay ?? EG_DEFAULTS.delay,
            hold: d.hold ?? EG_DEFAULTS.hold,
            loop: d.loop ?? EG_DEFAULTS.loop,
            curveShape: d.curveShape ?? EG_DEFAULTS.curveShape,
            state: 'idle',
            value: 0,
            startValue: 0,
            velocity: 0,
            _elapsed: 0,
            _gateActive: false
        };
    },

    triggerEG(eg, velocity) {
        if (!eg) return;
        eg.velocity = Math.max(0, Math.min(1, velocity));
        eg._gateActive = true;
        eg.startValue = eg.value;
        eg._elapsed = 0;

        if (eg.delay > 0) {
            eg.state = 'delay';
        } else {
            eg.state = 'attack';
        }

        document.dispatchEvent(new CustomEvent('eg-trigger', {
            detail: { velocity: eg.velocity, state: eg.state }
        }));
    },

    releaseEG(eg) {
        if (!eg) return;
        eg._gateActive = false;
        if (eg.state !== 'idle') {
            eg.state = 'release';
            eg._elapsed = 0;
            eg.startValue = eg.value;

            document.dispatchEvent(new CustomEvent('eg-release', {
                detail: { state: eg.state }
            }));
        }
    },

    processEG(eg, deltaTime) {
        if (!eg || eg.state === 'idle') {
            if (eg) eg.value = 0;
            return;
        }

        eg._elapsed += deltaTime;
        const cs = eg.curveShape || 'linear';

        switch (eg.state) {
            case 'delay':
                if (eg._elapsed >= eg.delay) {
                    eg._elapsed -= eg.delay;
                    eg.state = 'attack';
                    eg.startValue = 0;
                }
                eg.value = 0;
                break;

            case 'attack': {
                if (eg.attack <= 0 || eg._elapsed >= eg.attack) {
                    eg.value = eg.velocity;
                    const overflow = eg.attack > 0 ? eg._elapsed - eg.attack : 0;
                    eg._elapsed = overflow;
                    eg.startValue = eg.value;
                    if (eg.hold > 0) {
                        eg.state = 'hold';
                    } else {
                        eg.state = 'decay';
                    }
                } else {
                    const t = applyCurve(eg._elapsed / eg.attack, cs);
                    eg.value = eg.startValue + (eg.velocity - eg.startValue) * t;
                }
                break;
            }

            case 'hold':
                eg.value = eg.velocity;
                if (eg._elapsed >= eg.hold) {
                    eg._elapsed -= eg.hold;
                    eg.startValue = eg.value;
                    eg.state = 'decay';
                }
                break;

            case 'decay': {
                const targetValue = eg.sustain * eg.velocity;
                if (eg.decay <= 0 || eg._elapsed >= eg.decay) {
                    eg.value = targetValue;
                    eg._elapsed = 0;
                    eg.state = 'sustain';
                } else {
                    const t = applyCurve(eg._elapsed / eg.decay, cs);
                    eg.value = eg.startValue - (eg.startValue - targetValue) * t;
                }
                break;
            }

            case 'sustain':
                eg.value = eg.sustain * eg.velocity;
                break;

            case 'release': {
                if (eg.release <= 0 || eg._elapsed >= eg.release) {
                    eg.value = 0;
                    eg.state = 'idle';

                    if (eg.loop === 'loop' && eg._gateActive) {
                        eg.state = eg.delay > 0 ? 'delay' : 'attack';
                        eg.startValue = 0;
                        eg._elapsed = 0;
                    }
                } else {
                    const t = applyCurve(eg._elapsed / eg.release, cs);
                    eg.value = eg.startValue * (1 - t);
                }
                break;
            }
        }
    },

    setEGParams(eg, params) {
        if (!eg || !params) return;
        if (params.attack !== undefined) eg.attack = Math.max(0, params.attack);
        if (params.decay !== undefined) eg.decay = Math.max(0, params.decay);
        if (params.sustain !== undefined) eg.sustain = Math.max(0, Math.min(1, params.sustain));
        if (params.release !== undefined) eg.release = Math.max(0, params.release);
        if (params.delay !== undefined) eg.delay = Math.max(0, params.delay);
        if (params.hold !== undefined) eg.hold = Math.max(0, params.hold);
        if (params.loop !== undefined) eg.loop = params.loop;
        if (params.curveShape !== undefined) eg.curveShape = params.curveShape;
    },

    resetEG(eg) {
        if (!eg) return;
        Object.assign(eg, {
            attack: EG_DEFAULTS.attack,
            decay: EG_DEFAULTS.decay,
            sustain: EG_DEFAULTS.sustain,
            release: EG_DEFAULTS.release,
            delay: EG_DEFAULTS.delay,
            hold: EG_DEFAULTS.hold,
            loop: EG_DEFAULTS.loop,
            curveShape: EG_DEFAULTS.curveShape,
            state: 'idle',
            value: 0,
            startValue: 0,
            velocity: 0,
            _elapsed: 0,
            _gateActive: false
        });
    }
};
