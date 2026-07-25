/**
 * Screen Capture Module
 * Handles screen/window/tab capture for shader texture input
 */

import { state, getEl } from '../state.js';
import { showError } from '../utils.js';

export const ScreenCapture = {
    init() {
        const captureBtn = getEl('captureScreen');
        if (captureBtn) {
            captureBtn.addEventListener('click', () => this.toggle());
        }
    },

    async toggle() {
        if (state.screenEnabled) {
            await this.disable();
        } else {
            await this.enable();
        }
    },

    async enable() {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    displaySurface: 'monitor'
                },
                audio: false
            });

            state.screenStream = stream;

            if (!state.screenElement) {
                state.screenElement = document.createElement('video');
                state.screenElement.autoplay = true;
                state.screenElement.playsInline = true;
            }

            state.screenElement.srcObject = stream;

            stream.getVideoTracks()[0].onended = () => {
                this.disable();
            };

            state.screenElement.onloadedmetadata = () => {
                state.screenEnabled = true;
                this.createTexture();

                const captureBtn = getEl('captureScreen');
                if (captureBtn) {
                    captureBtn.classList.add('active');
                }

                state.screenElement.play();
            };
        } catch (err) {
            console.error('Screen capture init failed:', err);

            if (err.name !== 'NotAllowedError') {
                showError('Failed to capture screen: ' + err.message);
            }
        }
    },

    async disable() {
        if (state.screenStream) {
            state.screenStream.getTracks().forEach(track => track.stop());
            state.screenStream = null;
        }

        if (state.screenElement) {
            state.screenElement.srcObject = null;
        }

        state.screenEnabled = false;

        if (state.screenTexture) {
            state.gl.deleteTexture(state.screenTexture);
            state.screenTexture = null;
        }

        const captureBtn = getEl('captureScreen');
        if (captureBtn) {
            captureBtn.classList.remove('active');
        }
    },

    createTexture() {
        if (!state.gl) return;

        state.screenTexture = state.gl.createTexture();
        state.gl.bindTexture(state.gl.TEXTURE_2D, state.screenTexture);
        state.gl.texImage2D(state.gl.TEXTURE_2D, 0, state.gl.RGBA, 1, 1, 0, state.gl.RGBA, state.gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
        state.gl.texParameteri(state.gl.TEXTURE_2D, state.gl.TEXTURE_WRAP_S, state.gl.CLAMP_TO_EDGE);
        state.gl.texParameteri(state.gl.TEXTURE_2D, state.gl.TEXTURE_WRAP_T, state.gl.CLAMP_TO_EDGE);
        state.gl.texParameteri(state.gl.TEXTURE_2D, state.gl.TEXTURE_MIN_FILTER, state.gl.LINEAR);
        state.gl.texParameteri(state.gl.TEXTURE_2D, state.gl.TEXTURE_MAG_FILTER, state.gl.LINEAR);
        state.gl.bindTexture(state.gl.TEXTURE_2D, null);
    },

    update() {
        if (!state.screenEnabled || !state.screenTexture || !state.screenElement || state.screenElement.readyState < 2) return;

        state.gl.bindTexture(state.gl.TEXTURE_2D, state.screenTexture);
        state.gl.texImage2D(state.gl.TEXTURE_2D, 0, state.gl.RGBA, state.gl.RGBA, state.gl.UNSIGNED_BYTE, state.screenElement);
    }
};
