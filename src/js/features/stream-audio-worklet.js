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
 *   { ts: number (microseconds since stream start, on the audio clock),
 *     data: Float32Array (FRAME_SIZE * NUM_CHANNELS samples) }
 *
 * Data layout: planar — [channel0 * FRAME_SIZE samples, channel1 * FRAME_SIZE].
 * Matches AudioData format 'f32-planar'.
 *
 * Frame size: derived from the context sample rate — Math.round(sampleRate / 50)
 * samples = 20ms (Opus default). Typical values: 960 @ 48kHz, 882 @ 44.1kHz.
 *
 * 128-sample blocks (the AudioWorklet render quantum) don't divide a 20ms
 * frame evenly (960/128 = 7.5 at 48kHz), so the processor buffers across
 * calls and emits when the buffer fills.
 *
 * Timestamps: AudioWorkletGlobalScope does NOT expose `performance`; only the
 * `currentTime` global (AudioContext clock, in seconds) and `currentFrame`.
 * Main passes the stream-epoch base time via processorOptions; the worklet
 * sends `(currentTime - baseTime) * 1e6` microseconds, which the worker uses
 * directly as AudioData.timestamp. This puts audio PTS on a clock that starts
 * at zero when streaming starts, matching how video PTS is computed in
 * StreamingUI.captureFrame (`(performance.now() - epochMs) * 1000`). The two
 * clocks (audio hardware vs system) drift slightly over time but stay close
 * enough for live-stream A/V sync.
 *
 * numberOfOutputs is 1 (not 0) and process() zeroes the output buffers, then
 * the main thread connects `node → ctx.destination`. Web Audio is pull-based
 * from ctx.destination: a node with no output path to destination is never
 * pulled, so its process() never runs and no audio is captured. Outputting
 * silence on a path to destination establishes the pull without doubling the
 * audible signal (zeros mixed into destination = no audible change).
 */

const FRAME_SIZE = Math.round(sampleRate / 50); // 20ms; typical 960 @48k, 882 @44.1k
const NUM_CHANNELS = 2;

class StreamAudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this._ch0 = new Float32Array(FRAME_SIZE);
        this._ch1 = new Float32Array(FRAME_SIZE);
        this._filled = 0;     // samples filled in current frame, per channel
        // processorOptions.baseTime is ctx.currentTime captured on the main
        // thread at stream start. Subtracting it gives a clock that starts at
        // 0 when streaming starts.
        const opts = (options && options.processorOptions) || {};
        this._baseTime = (typeof opts.baseTime === 'number') ? opts.baseTime : 0;
    }

    /**
     * @param {Float32Array[][]} inputs  - inputs[channel][sample]
     * @param {Float32Array[][]} outputs - we write silence here (see header)
     * @returns {boolean} true to keep the processor alive
     */
    process(inputs, outputs) {
        // Zero outputs regardless of input — we exist to tap, not to emit.
        // Without this, connecting node → ctx.destination would double audio.
        const out = outputs[0];
        if (out) {
            for (let c = 0; c < out.length; c++) out[c].fill(0);
        }

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
                // Planar stereo: [ch0 (FRAME_SIZE) || ch1 (FRAME_SIZE)]
                const outFrame = new Float32Array(FRAME_SIZE * NUM_CHANNELS);
                outFrame.set(this._ch0, 0);
                outFrame.set(this._ch1, FRAME_SIZE);
                // AudioWorkletGlobalScope.currentTime (seconds) — NOT
                // performance.now(), which is unavailable here.
                const tsUs = Math.round((currentTime - this._baseTime) * 1_000_000);
                this.port.postMessage({ ts: tsUs, data: outFrame }, [outFrame.buffer]);
                this._filled = 0;
            }
        }
        return true;
    }
}

registerProcessor('stream-audio-processor', StreamAudioProcessor);

