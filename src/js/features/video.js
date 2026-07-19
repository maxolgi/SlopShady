/**
 * Video Texture Module
 * Handles webcam video input for shader texture
 */

import { state, getEl } from '../state.js';
import { showError, loadFromLocalStorage, saveToLocalStorage } from '../utils.js';
import { SETTINGS_KEYS } from '../config.js';

export const VideoTexture = {
    _selectedDeviceId: null,

    init() {
        this._selectedDeviceId = loadFromLocalStorage(SETTINGS_KEYS.cameraDeviceId, '') || null;
        state.videoElement = document.createElement('video');
        state.videoElement.autoplay = true;
        state.videoElement.playsInline = true;
        state.videoElement.muted = true;
        getEl('enableVideo').addEventListener('click', () => this.toggle());

        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices.enumerateDevices().then(devices => {
                this._populateCameraMenu(devices);
            }).catch(() => {});
            navigator.mediaDevices.addEventListener('devicechange', () => {
                navigator.mediaDevices.enumerateDevices().then(devices => {
                    this._populateCameraMenu(devices);
                }).catch(() => {});
            });
        }

        const menu = getEl('camera-device-menu');
        if (menu) {
            menu.addEventListener('dropdown-select', (e) => {
                this._selectedDeviceId = e.target.dataset.value || null;
                saveToLocalStorage(SETTINGS_KEYS.cameraDeviceId, this._selectedDeviceId || '');
                if (state.videoEnabled) {
                    this.disable();
                    this.enable();
                }
            });
        }
    },

    _populateCameraMenu(devices) {
        const menu = getEl('camera-device-menu');
        if (!menu) return;
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        menu.innerHTML = '';
        if (videoDevices.length === 0) {
            const item = document.createElement('div');
            item.className = 'dropdown__item';
            item.textContent = 'No cameras found';
            menu.appendChild(item);
            return;
        }
        const defaultItem = document.createElement('div');
        defaultItem.className = 'dropdown__item' + (!this._selectedDeviceId ? ' active' : '');
        defaultItem.textContent = 'Default Camera';
        defaultItem.dataset.value = '';
        menu.appendChild(defaultItem);
        videoDevices.forEach((device, i) => {
            const item = document.createElement('div');
            item.className = 'dropdown__item' + (this._selectedDeviceId === device.deviceId ? ' active' : '');
            item.textContent = device.label || `Camera ${i + 1}`;
            item.dataset.value = device.deviceId;
            menu.appendChild(item);
        });
        const dropdown = getEl('camera-device-dropdown');
        if (dropdown && this._selectedDeviceId) {
            const selected = videoDevices.find(d => d.deviceId === this._selectedDeviceId);
            if (selected) {
                dropdown.querySelector('span').textContent = selected.label || 'Camera';
            }
        }
    },
    
    async toggle() {
        if (state.videoEnabled) {
            await this.disable();
        } else {
            await this.enable();
        }
    },
    
    async enable() {
        try {
            const constraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 } } };
            if (this._selectedDeviceId) {
                constraints.video.deviceId = { exact: this._selectedDeviceId };
            }
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            state.videoStream = stream;
            state.videoElement.srcObject = stream;
            
            state.videoElement.onloadedmetadata = () => {
                state.videoEnabled = true;
                this.createTexture();
                getEl('enableVideo').classList.add('active');
                state.videoElement.play();
            };

            navigator.mediaDevices.enumerateDevices().then(devices => {
                this._populateCameraMenu(devices);
            }).catch(() => {});
        } catch (err) {
            console.error('Camera init failed:', err);
        if (err.name === 'NotAllowedError') {
            showError('Camera permission denied. Run: sudo usermod -aG video,render $(whoami) then re-login.');
        } else if (err.name === 'NotFoundError') {
            showError('No camera found. Check that a camera is connected.');
        } else {
            showError('Failed to access camera: ' + err.message);
        }
        }
    },
    
    async disable() {
        if (state.videoStream) {
            state.videoStream.getTracks().forEach(track => track.stop());
            state.videoStream = null;
        }
        state.videoElement.srcObject = null;
        state.videoEnabled = false;
        
        if (state.videoTexture) {
            state.gl.deleteTexture(state.videoTexture);
            state.videoTexture = null;
        }
        
        getEl('enableVideo').classList.remove('active');
    },
    
    createTexture() {
        if (!state.gl) return;
        state.videoTexture = state.gl.createTexture();
        state.gl.bindTexture(state.gl.TEXTURE_2D, state.videoTexture);
        state.gl.texImage2D(state.gl.TEXTURE_2D, 0, state.gl.RGBA, 1, 1, 0, state.gl.RGBA, state.gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
        state.gl.texParameteri(state.gl.TEXTURE_2D, state.gl.TEXTURE_WRAP_S, state.gl.CLAMP_TO_EDGE);
        state.gl.texParameteri(state.gl.TEXTURE_2D, state.gl.TEXTURE_WRAP_T, state.gl.CLAMP_TO_EDGE);
        state.gl.texParameteri(state.gl.TEXTURE_2D, state.gl.TEXTURE_MIN_FILTER, state.gl.LINEAR);
        state.gl.texParameteri(state.gl.TEXTURE_2D, state.gl.TEXTURE_MAG_FILTER, state.gl.LINEAR);
    },
    
    update() {
        if (!state.videoEnabled || !state.videoTexture || !state.videoElement || state.videoElement.readyState < 2) return;
        
        state.gl.bindTexture(state.gl.TEXTURE_2D, state.videoTexture);
        state.gl.texImage2D(state.gl.TEXTURE_2D, 0, state.gl.RGBA, state.gl.RGBA, state.gl.UNSIGNED_BYTE, state.videoElement);
    }
};
