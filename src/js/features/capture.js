/**
 * Capture Module
 * Handles canvas screenshot functionality
 * Uses deferred capture to avoid preserveDrawingBuffer overhead
 */

import { state, getEl } from '../state.js';

function captureNextFrame() {
    return new Promise(resolve => {
        state.capturePending.push(resolve);
    });
}

export const Capture = {
    async canvas() {
        const scale = parseFloat(getEl('captureResolution').value);
        const format = getEl('captureFormat').value;
        const quality = (state.captureQuality || 80) / 100;

        const dataUrl = await captureNextFrame();

        if (scale === 1 && format === 'png') {
            return dataUrl;
        }

        const temp = document.createElement('canvas');
        temp.width = Math.max(1, Math.floor(state.canvas.width * scale));
        temp.height = Math.max(1, Math.floor(state.canvas.height * scale));
        temp.getContext('2d').drawImage(state.canvas, 0, 0, temp.width, temp.height);

        if (format === 'webp') {
            const webp = temp.toDataURL('image/webp', quality);
            if (webp.length > 1000) return webp;
        }
        return temp.toDataURL('image/png');
    }
};
