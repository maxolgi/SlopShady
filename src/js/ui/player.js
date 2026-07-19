import { Sync } from '../features/sync.js';
import { MIDIPlayer } from '../features/midiPlayer.js';
import { getEl } from '../state.js';
import { initSlider } from './slider.js';

export const PlayerUI = {
    midiData: null,
    isPlaying: false,
    _midiLoaded: false,
    _progressRaf: null,
    _progressSlider: null,

    
    init() {
        const midiDrop = getEl('midiDropZone');
        const midiInput = getEl('midiFileInput');
        
        const playBtn = getEl('playerPlay');
        const pauseBtn = getEl('playerPause');
        const stopBtn = getEl('playerStop');
        const progress = getEl('playerProgress');
        
        if (!midiDrop) return;
        
        midiDrop.addEventListener('click', () => midiInput.click());
        midiInput.addEventListener('change', (e) => this.loadMIDI(e.target.files[0]));
        
        playBtn.addEventListener('click', () => this.play());
        pauseBtn.addEventListener('click', () => this.pause());
        stopBtn.addEventListener('click', () => this.stop());
        
        if (progress) {
            progress.disabled = false;
            this._progressSlider = initSlider(progress, {
                defaultValue: 0,
                onChange: (val) => {
                    if (this._midiLoaded) {
                        const duration = MIDIPlayer.getDuration();
                        MIDIPlayer.seek((val / 100) * duration);
                        this._drawPianoRoll();
                    }
                }
            });
        }
        
        midiDrop.addEventListener('dragover', (e) => {
            e.preventDefault();
            midiDrop.classList.add('file-drop-zone--active');
        });
        midiDrop.addEventListener('dragleave', () => {
            midiDrop.classList.remove('file-drop-zone--active');
        });
        midiDrop.addEventListener('drop', (e) => {
            e.preventDefault();
            midiDrop.classList.remove('file-drop-zone--active');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.loadMIDI(files[0]);
            }
        });
        
        document.addEventListener('midi-player-end', () => {
            this._stopProgressLoop();
            this.isPlaying = false;
            getEl('playerPlay').disabled = false;
            getEl('playerPause').disabled = true;
        });
    },
    
    async loadMIDI(file) {
        if (!file) return;
        try {
            await MIDIPlayer.loadFile(file);
        } catch (err) {
            const midiZone = getEl('midiDropZone');
            if (midiZone) midiZone.querySelector('div:last-of-type').textContent = 'Error: ' + err.message;
            return;
        }
        this._midiLoaded = true;
        
        const container = getEl('pianoRollContainer');
        if (container) container.classList.add('visible');
        
        this._drawPianoRoll();
        
        const duration = MIDIPlayer.getDuration();
        const notes = MIDIPlayer.getNotes();
        const durEl = getEl('pianoRollDuration');
        if (durEl) durEl.textContent = this._formatTime(duration);
        const infoEl = getEl('pianoRollInfo');
        if (infoEl) infoEl.textContent = `${notes.length} notes`;
        
        getEl('midiDropZone').querySelector('div:last-of-type').textContent = file.name;
        
        getEl('playerPlay').disabled = false;
        
        Sync.send({ player: { midiFile: file.name } });
    },
    
    play() {
        if (this._midiLoaded) {
            MIDIPlayer.play();
            this.isPlaying = true;
            getEl('playerPlay').disabled = true;
            getEl('playerPause').disabled = false;
            getEl('playerStop').disabled = false;
            this._startProgressLoop();
        }
    },
    
    pause() {
        if (this._midiLoaded) {
            MIDIPlayer.pause();
            this._stopProgressLoop();
            this.isPlaying = false;
            getEl('playerPlay').disabled = false;
            getEl('playerPause').disabled = true;
        }
    },
    
    stop() {
        if (this._midiLoaded) {
            MIDIPlayer.stop();
            this._stopProgressLoop();
            this._drawPianoRoll();
            this.isPlaying = false;
            getEl('playerPlay').disabled = false;
            getEl('playerPause').disabled = true;
            getEl('playerStop').disabled = true;
        }
    },
    
    _startProgressLoop() {
        this._stopProgressLoop();
        const update = () => {
            if (!this.isPlaying) return;
            const current = MIDIPlayer.getCurrentTime();
            const duration = MIDIPlayer.getDuration();
            if (duration > 0) {
                const pct = (current / duration) * 100;
                if (this._progressSlider) this._progressSlider.setValue(pct);
                this._updatePlayhead(current, duration);
                const timeEl = getEl('pianoRollTime');
                if (timeEl) timeEl.textContent = this._formatTime(current);
            }
            this._progressRaf = requestAnimationFrame(update);
        };
        update();
    },
    
    _stopProgressLoop() {
        if (this._progressRaf) {
            cancelAnimationFrame(this._progressRaf);
            this._progressRaf = null;
        }
    },
    
    _drawPianoRoll() {
        const canvas = getEl('pianoRollCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const notes = MIDIPlayer.getNotes();
        const duration = MIDIPlayer.getDuration();
        const w = canvas.width;
        const h = canvas.height;
        
        ctx.clearRect(0, 0, w, h);
        
        if (!notes.length || duration === 0) return;
        
        let minNote = 127, maxNote = 0;
        for (const n of notes) {
            if (n.note < minNote) minNote = n.note;
            if (n.note > maxNote) maxNote = n.note;
        }
        const range = Math.max(maxNote - minNote, 12);
        
        for (const n of notes) {
            const x = (n.start / duration) * w;
            const nw = Math.max(((n.end - n.start) / duration) * w, 1);
            const y = h - ((n.note - minNote) / range) * h * 0.9 - h * 0.05;
            const nh = Math.max(h / range, 2);
            const brightness = 0.4 + (n.velocity / 127) * 0.6;
            ctx.fillStyle = `rgba(0, 255, 255, ${brightness})`;
            ctx.fillRect(x, y - nh / 2, nw, nh);
        }
    },
    
    _updatePlayhead(current, duration) {
        const playhead = getEl('pianoRollPlayhead');
        if (!playhead || duration === 0) return;
        playhead.style.left = ((current / duration) * 100) + '%';
    },
    
    _formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
};
