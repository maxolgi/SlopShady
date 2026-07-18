/**
 * stream-audio.js — main-thread bridge between the Webamp analyser tap and
 * the stream worker's audio encoder.
 *
 * Adds the AudioWorklet module to the analyser's AudioContext, creates an
 * AudioWorkletNode, connects analyser → node, and transfers the node's port
 * to the stream worker. After that, audio frames flow worklet → worker with
 * no main-thread hop.
 *
 * Phase 2 of the off-main-thread pipeline plan.
 *
 * Conventions follow recorder.js / streaming.js: singleton object.
 */

import { state } from '../state.js';

export const StreamAudio = {
    _node: null,
    _analyser: null,
    _workletAdded: new WeakSet(),

    /**
     * @param {AnalyserNode} analyser   state.audioPlayerAnalyser
     * @param {Worker}       worker     stream worker (receives audio-port message)
     * @returns {Promise<boolean>}      true if tap was installed successfully
     */
    async init(analyser, worker) {
        if (!analyser || !worker) return false;
        // Clean up any prior instance (stream restart / reconnect).
        this.stop();

        const ctx = analyser.context;
        try {
            // addModule is per-context; cache via WeakSet so we don't re-add on
            // every stream start (re-adding throws and is wasteful).
            if (!this._workletAdded.has(ctx)) {
                await ctx.audioWorklet.addModule('/js/features/stream-audio-worklet.js');
                this._workletAdded.add(ctx);
            }
        } catch (e) {
            console.warn('[StreamAudio] worklet addModule failed; streaming will be video-only', e);
            return false;
        }

        let node;
        try {
            node = new AudioWorkletNode(ctx, 'stream-audio-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 0,
                channelCount: 2,
                channelCountMode: 'explicit',
                channelInterpretation: 'speakers',
            });
        } catch (e) {
            console.warn('[StreamAudio] AudioWorkletNode construction failed', e);
            return false;
        }

        analyser.connect(node);
        // node has no outputs; audio is tapped and discarded (the analyser
        // continues to feed its existing graph — visualizers etc.).

        // Hand the port to the worker. After this, node.port is neutered on
        // the main side; the worker owns the other end.
        try {
            worker.postMessage({ type: 'audio-port', port: node.port }, [node.port]);
        } catch (e) {
            console.warn('[StreamAudio] failed to transfer port to worker', e);
            try { node.disconnect(); } catch (e2) { /* ignore */ }
            return false;
        }

        this._node = node;
        this._analyser = analyser;
        return true;
    },

    stop() {
        if (this._node) {
            try { this._node.disconnect(); } catch (e) { /* ignore */ }
            this._node = null;
        }
        // We don't disconnect the analyser itself — it may feed other listeners
        // (visualizers, etc.) and we only ever connected our own node to it.
        this._analyser = null;
    },
};

if (typeof window !== 'undefined') window.StreamAudio = StreamAudio;
