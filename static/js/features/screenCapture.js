/**
 * Screen Capture Module
 * Handles screen/window/tab capture for shader texture input
 */

import { state, getEl } from '../state.js';
import { showError, loadFromLocalStorage, saveToLocalStorage } from '../utils.js';
import { SETTINGS_KEYS } from '../config.js';

export const ScreenCapture = {
    _selectedMonitorIndex: parseInt(loadFromLocalStorage(SETTINGS_KEYS.screenMonitorIndex, '0')) || 0,

    init() {
        const captureBtn = getEl('captureScreen');
        if (captureBtn) {
            captureBtn.addEventListener('click', () => this.toggle());
        }

        this._populateMonitorMenu();

        const menu = getEl('screen-device-menu');
        if (menu) {
            menu.addEventListener('dropdown-select', (e) => {
                this._selectedMonitorIndex = parseInt(e.target.dataset.value) || 0;
                saveToLocalStorage(SETTINGS_KEYS.screenMonitorIndex, String(this._selectedMonitorIndex));
                if (state.screenEnabled) {
                    this.disable();
                    this.enable();
                }
            });
        }
    },

    async _populateMonitorMenu() {
        const menu = getEl('screen-device-menu');
        if (!menu) return;

        if (window.__TAURI__) {
            try {
                const monitors = await window.__TAURI__.core.invoke('list_monitors');
                menu.innerHTML = '';
                if (monitors.length === 0) {
                    const item = document.createElement('div');
                    item.className = 'dropdown__item';
                    item.textContent = 'No monitors found';
                    menu.appendChild(item);
                    return;
                }
                monitors.forEach((m, i) => {
                    const item = document.createElement('div');
                    item.className = 'dropdown__item' + (this._selectedMonitorIndex === i ? ' active' : '');
                    item.textContent = `${m.name} (${m.width}x${m.height})`;
                    item.dataset.value = String(i);
                    menu.appendChild(item);
                });
                const selected = monitors[this._selectedMonitorIndex];
                if (selected) {
                    const dropdown = getEl('screen-device-dropdown');
                    if (dropdown) dropdown.querySelector('span').textContent = `${selected.name} (${selected.width}x${selected.height})`;
                }
            } catch (e) {
                menu.innerHTML = '<div class="dropdown__item">Failed to list monitors</div>';
            }
        } else {
            menu.innerHTML = '';
            const item = document.createElement('div');
            item.className = 'dropdown__item active';
            item.textContent = 'Browser will prompt...';
            menu.appendChild(item);
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

            return;
        } catch (err) {
            if (!window.__TAURI__) {
                console.error('Screen capture init failed:', err);

                if (err.name !== 'NotAllowedError') {
                    showError('Failed to capture screen: ' + err.message);
                }
                return;
            }
        }

        state.screenEnabled = true;
        this.createTexture();

        const monitorIndex = this._selectedMonitorIndex;
        this._tauriInterval = setInterval(async () => {
            try {
                const base64 = await window.__TAURI__.core.invoke('capture_screen', { monitorIndex });
                const img = new Image();
                img.src = 'data:image/png;base64,' + base64;
                img.onload = () => {
                    state.gl.bindTexture(state.gl.TEXTURE_2D, state.screenTexture);
                    state.gl.texImage2D(state.gl.TEXTURE_2D, 0, state.gl.RGBA,
                        state.gl.RGBA, state.gl.UNSIGNED_BYTE, img);
                };
            } catch (e) {
                console.error('Tauri screen capture failed:', e);
            }
        }, 100);

        const captureBtn = getEl('captureScreen');
        if (captureBtn) {
            captureBtn.classList.add('active');
        }
    },

    async disable() {
        if (this._tauriInterval) {
            clearInterval(this._tauriInterval);
            this._tauriInterval = null;
        }

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
