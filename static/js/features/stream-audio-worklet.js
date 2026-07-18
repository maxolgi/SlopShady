/**
 * stream-audio-worklet.js — AudioWorkletProcessor that taps the Webamp
 * analyser and ships 20ms Opus-ready Float32 frames to its MessagePort
 * (transferred to the stream worker on init).
 *
 * Runs on the audio render thread — immune to main-thread panel reflow.
 * Phase 2 of the off-main-thread render+encode pipeline plan.
 *
 * Why a worklet, not MediaStreamTrackProcessor (the previous design):
 * MSTP's reader loop ran on the main thread (StreamingUI._pumpAudio). When
 * the main thread was busy with bottom-panel layout reflow during a drag,
 * no audio chunks were pulled and the AudioEncoder starved → audible
 * glitches. The worklet runs at audio-thread priority, scheduled by the OS
 * audio device, so panel reflow cannot interrupt it.
 *
 * Output protocol (worklet → port owner, normally the stream worker):
 *   { ts: number (performance.now() in ms, wallclock),
 *     data: Float32Array (FRAME_SIZE * NUM_CHANNELS samples) }
 *
 * Data layout: planar — [channel0 * FRAME_SIZE samples, channel1 * FRAME_SIZE].
 * Matches AudioData format 'f32-planar'.
 *
 * Frame size: 960 samples @ 48kHz = 20ms (Opus default).
 *
 * 128-sample blocks (the AudioWorklet render quantum) don't divide 960 evenly
 * (960/128 = 7.5), so the processor buffers across calls and emits when the
 * buffer fills.
 */

const FRAME_SIZE = 960;       // 20ms at 48kHz
const NUM_CHANNELS = 2;

class StreamAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._ch0 = new Float32Array(FRAME_SIZE);
        this._ch1 = new Float32Array(FRAME_SIZE);
        this._filled = 0;     // samples filled in current frame, per channel
    }

    /**
     * @param {Float32Array[][]} inputs - inputs[channel][sample] = sample value
     * @returns {boolean} true to keep the processor alive
     */
    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;
        const inCh0 = input[0];
        if (!inCh0 || inCh0.length === 0) return true;
        // Upmix mono → stereo (duplicate) so the muxer always sees 2 channels.
        const inCh1 = input[1] || input[0];

        let inIdx = 0;
        const n = inCh0.length;
        while (inIdx < n) {
            const space = FRAME_SIZE - this._filled;
            const chunk = Math.min(space, n - inIdx);
            this._ch0.set(inCh0.subarray(inIdx, inIdx + chunk), this._filled);
            this._ch1.set(inCh1.subarray(inIdx, inIdx + chunk), this._filled);
            this._filled += chunk;
            inIdx += chunk;

            if (this._filled >= FRAME_SIZE) {
                // Planar stereo: [ch0 (960) || ch1 (960)]
                const out = new Float32Array(FRAME_SIZE * NUM_CHANNELS);
                out.set(this._ch0, 0);
                out.set(this._ch1, FRAME_SIZE);
                // performance.now() in worklets shares the main thread's time
                // origin, so this is comparable to the epoch sent in init.
                this.port.postMessage({ ts: performance.now(), data: out }, [out.buffer]);
                this._filled = 0;
            }
        }
        return true;
    }
}

registerProcessor('stream-audio-processor', StreamAudioProcessor);
