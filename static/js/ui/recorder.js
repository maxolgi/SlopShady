import { Sync } from '../features/sync.js';
import { getEl } from '../state.js';
import { initSlider } from './slider.js';

export const RecorderUI = {
    mediaRecorder: null,
    recordedChunks: [],
    isRecording: false,
    format: 'webm',
    resolution: '1080p',
    fps: 60,
    bitrate: 25,

    init() {
        const startBtn = getEl('startRecording');
        const stopBtn = getEl('stopRecording');

        if (!startBtn) return;

        startBtn.addEventListener('click', () => this.startRecording());
        stopBtn.addEventListener('click', () => this.stopRecording());

        const formatMenu = getEl('rec-format-menu');
        if (formatMenu) {
            const handler = (e) => {
                const item = e.target.closest('.dropdown__item');
                if (!item) return;
                this.format = item.dataset.value;
                Sync.send({ recorder: { codec: this.format === 'webm-vp8' ? 'vp8' : 'vp9' } });
            };
            formatMenu.addEventListener('dropdown-select', handler);
            formatMenu.addEventListener('mousedown', handler);
        }

        const resolutionMenu = getEl('rec-resolution-menu');
        if (resolutionMenu) {
            const handler = (e) => {
                const item = e.target.closest('.dropdown__item');
                if (!item) return;
                this.resolution = item.dataset.value;
                Sync.send({ recorder: { resolution: this.resolution } });
            };
            resolutionMenu.addEventListener('dropdown-select', handler);
            resolutionMenu.addEventListener('mousedown', handler);
        }

        const fpsMenu = getEl('rec-fps-menu');
        if (fpsMenu) {
            const handler = (e) => {
                const item = e.target.closest('.dropdown__item');
                if (!item) return;
                this.fps = parseInt(item.dataset.value);
                Sync.send({ recorder: { fps: this.fps } });
            };
            fpsMenu.addEventListener('dropdown-select', handler);
            fpsMenu.addEventListener('mousedown', handler);
        }

        const bitrateSlider = getEl('rec-bitrate-slider');
        if (bitrateSlider) {
            initSlider(bitrateSlider, {
                min: 1, max: 100, step: 1,
                format: v => Math.round(v) + ' Mbps',
                onChange: (val) => { RecorderUI.bitrate = Math.round(val); },
            });
        }
    },

    startRecording() {
        const canvas = getEl('canvas');
        if (!canvas) return;

        const stream = canvas.captureStream(this.fps);
        const mimeType = this.format === 'webm-vp8' ? 'video/webm;codecs=vp8' : 'video/webm;codecs=vp9';

        this.mediaRecorder = new MediaRecorder(stream, { mimeType });
        this.recordedChunks = [];

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.recordedChunks.push(e.data);
        };

        this.mediaRecorder.onstop = () => this.saveRecording();

        this.mediaRecorder.start();
        this.isRecording = true;

        const startBtn = getEl('startRecording');
        const stopBtn = getEl('stopRecording');
        if (startBtn) startBtn.classList.add('active');
        if (stopBtn) stopBtn.classList.remove('disabled');

        Sync.send({ recorder: { isRecording: true } });
    },

    stopRecording() {
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;

        this.mediaRecorder.stop();
        this.isRecording = false;

        const startBtn = getEl('startRecording');
        const stopBtn = getEl('stopRecording');
        if (startBtn) startBtn.classList.remove('active');
        if (stopBtn) stopBtn.classList.add('disabled');

        Sync.send({ recorder: { isRecording: false } });
    },

    saveRecording() {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const a = document.createElement('a');
        a.href = url;
        a.download = `slopshady-${timestamp}.webm`;
        a.click();

        URL.revokeObjectURL(url);
        this.recordedChunks = [];
    }
};
