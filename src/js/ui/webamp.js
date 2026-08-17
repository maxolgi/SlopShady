import Webamp from '../../lib/webamp.min.mjs';
import { state } from '../state.js';
import { AudioTexture } from '../features/audio.js';
import { MilkdropFeature } from '../features/milkdrop.js';

export const WebampUI = {
    instance: null,
    isPlaying: false,

    async init() {
        if (!Webamp.browserIsSupported()) {
            return;
        }

        const container = document.getElementById('webamp-container');
        if (!container) return;

        this.instance = new Webamp({
            windowLayout: {
                main: { position: { top: 0, left: 0 } },
                equalizer: { position: { top: 0, left: 0 } },
                playlist: { position: { top: 0, left: 0 } },
            },
            enableHotkeys: false,
            zIndex: 60,
        });

        try {
            await this.instance.renderWhenReady(container);

            const webampEl = document.getElementById('webamp');
            if (webampEl) {
                container.appendChild(webampEl);
                this._containWindows(webampEl, container);
            }

            this._wireAudioTexture();
            this._wirePlaybackState();
        } catch (err) {
        }
    },

    _containWindows(webampEl, container) {
        const mainWindow = document.getElementById('main-window');
        const eqWindow = document.getElementById('equalizer-window');
        const plWindow = document.getElementById('playlist-window');

        webampEl.querySelectorAll('.draggable').forEach(el => {
            el.classList.remove('draggable');
        });

        if (plWindow) {
            plWindow.style.width = '';
            plWindow.style.height = '';
        }

        const grid = document.createElement('div');
        grid.id = 'webamp-grid';
        grid.appendChild(mainWindow);
        if (eqWindow) grid.appendChild(eqWindow);
        if (plWindow) grid.appendChild(plWindow);

        webampEl.innerHTML = '';
        webampEl.appendChild(grid);

        setTimeout(() => {
            this._resizePlaylist();
            if (mainWindow && eqWindow) {
                if (this._playlistObserver) this._playlistObserver.disconnect();
                this._playlistObserver = new ResizeObserver(() => this._resizePlaylist());
                this._playlistObserver.observe(mainWindow);
                this._playlistObserver.observe(eqWindow);
            }
        }, 500);
    },

    _resizePlaylist() {
        const mainWindow = document.getElementById('main-window');
        const eqWindow = document.getElementById('equalizer-window');
        const plWindow = document.getElementById('playlist-window');
        if (!mainWindow || !eqWindow || !plWindow) return;

        const targetHeight = mainWindow.offsetHeight + eqWindow.offsetHeight;
        plWindow.style.setProperty('height', targetHeight + 'px', 'important');
    },

    _wireAudioTexture() {
        if (!this.instance || !this.instance.media) return;
        const analyser = this.instance.media.getAnalyser();
        if (analyser) {
            state.audioPlayerAnalyser = analyser;
            AudioTexture.enable();
            MilkdropFeature.init(analyser);
        }
    },

    _wirePlaybackState() {
        if (!this.instance) return;

        this.instance.onTrackDidChange((track) => {
            if (track) {
                this.isPlaying = true;
                state.audioTextureEnabled = true;
            }
        });
    },

    play() {
        if (this.instance) this.instance.play();
    },

    pause() {
        if (this.instance) this.instance.pause();
    },

    stop() {
        this.isPlaying = false;
        if (this.instance) this.instance.stop();
    },

    setVolume(vol) {
        if (this.instance) this.instance.setVolume(Math.round(vol * 100));
    },

    appendTracks(tracks) {
        if (this.instance) {
            this.instance.appendTracks(tracks);
        }
    },

    close() {
        this.isPlaying = false;
        if (this.instance) this.instance.close();
    },

    reopen() {
        if (this.instance) this.instance.reopen();
    }
};
