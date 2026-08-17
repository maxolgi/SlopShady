import { state } from '../state.js';
import { LFO_BEAT_DIVISIONS, LFO_WAVEFORMS } from '../config.js';

// Beat multiplier per entry of LFO_BEAT_DIVISIONS ('1/4' → 4), kept index-aligned
const BEAT_FACTORS = LFO_BEAT_DIVISIONS.map(div => parseInt(div.split('/')[1], 10));

const _snhState = [0, 0, 0, 0];

function _getEffectiveRate(lfo) {
    if (lfo.syncMode === 'sync') {
        const divIdx = LFO_BEAT_DIVISIONS.indexOf(lfo.syncRate);
        const div = divIdx >= 0 ? BEAT_FACTORS[divIdx] : 4;
        return (state.bpm / 60) * div;
    }
    return lfo.rate;
}

export const LFOEngine = {
    process(deltaTime = 0.016) {
        for (let i = 0; i < state.lfos.length; i++) {
            const lfo = state.lfos[i];
            const effectiveRate = _getEffectiveRate(lfo);
            lfo.phase += deltaTime * effectiveRate;
            if (lfo.phase > 1000) lfo.phase -= 1000;

            if (lfo.waveform === 'snh') {
                const prevStep = Math.floor((lfo.phase - deltaTime * effectiveRate) * 16);
                const currStep = Math.floor(lfo.phase * 16);
                if (currStep !== prevStep || _snhState[i] === undefined) {
                    _snhState[i] = Math.random() * 2 - 1;
                }
            }
        }
    },

    resetPhase(lfoIndex) {
        if (state.lfos[lfoIndex]) {
            state.lfos[lfoIndex].phase = 0;
            _snhState[lfoIndex] = Math.random() * 2 - 1;
        }
    },

    getSNHValue(lfoIndex) {
        return _snhState[lfoIndex] || 0;
    },

    getOutputValue(lfoIndex) {
        const lfo = state.lfos[lfoIndex];
        if (!lfo) return 0;
        const phase = (lfo.phase + lfo.phaseOffset) % 1;
        let waveOut;
        if (lfo.waveform === 'snh') {
            waveOut = this.getSNHValue(lfoIndex);
        } else {
            const fn = Object.prototype.hasOwnProperty.call(LFO_WAVEFORMS, lfo.waveform)
                ? LFO_WAVEFORMS[lfo.waveform] : LFO_WAVEFORMS.sine;
            waveOut = fn(phase);
        }
        const amp = lfo.amplitude ?? 1.0;
        const dc = lfo.dcOffset || 0;
        return waveOut * amp + dc;
    }
};
