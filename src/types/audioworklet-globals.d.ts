// AudioWorklet processor-side globals. These run inside AudioWorkletGlobalScope
// which is NOT in lib.dom.d.ts. Used by features/stream-audio-worklet.js.

declare abstract class AudioWorkletProcessor {
    readonly port: MessagePort;
}

declare function registerProcessor(
    name: string,
    processorCtor: { new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor }
): void;

declare const currentFrame: number;
declare const currentTime: number;
declare const sampleRate: number;
