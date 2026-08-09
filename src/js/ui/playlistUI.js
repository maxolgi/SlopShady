/**
 * Playlist UI Module
 * UI panel for the preset playlist system.
 * Follows LayerMixer patterns.
 */

import { state, getEl } from '../state.js';
import { PlaylistSystem } from '../features/playlist.js';
import { Sync } from '../features/sync.js';
import { LayerSystem } from '../webgl/layers.js';
import { initSlider } from './slider.js';
import { T } from './tooltips.js';

export const PlaylistUI = {

    _dragSrcIndex: null,

    init() {
        this._bindTransport();
        this._bindAddControls();
        this._bindFooter();
        this._startProgressListener();
        this.render();
    },

    // ─── Transport Controls ───

    _bindTransport() {
        const play = getEl('plPlay');
        const stop = getEl('plStop');
        const prev = getEl('plPrev');
        const next = getEl('plNext');
        const loop = getEl('plLoop');

        if (play) play.addEventListener('click', () => {
            PlaylistSystem.start();
            this.render();
        });
        if (stop) stop.addEventListener('click', () => {
            PlaylistSystem.stop();
            this.render();
        });
        if (prev) prev.addEventListener('click', () => {
            const idx = PlaylistSystem.currentIndex - 1;
            if (idx >= 0) PlaylistSystem.goToEntry(idx);
            this.render();
        });
        if (next) next.addEventListener('click', () => {
            const idx = PlaylistSystem.currentIndex + 1;
            if (idx < PlaylistSystem.entries.length) PlaylistSystem.goToEntry(idx);
            this.render();
        });
        if (loop) loop.addEventListener('click', () => {
            loop.classList.toggle('active');
            PlaylistSystem.loop = loop.classList.contains('active');
            Sync.send({ playlist: PlaylistSystem.getState() });
        });
    },

    // ─── Add Controls ───

    _bindAddControls() {
        const addCurrent = getEl('plAddCurrent');
        const addShaderSelect = getEl('plAddShaderSelect');
        const addFromShader = getEl('plAddFromShader');

        if (addCurrent) addCurrent.addEventListener('click', () => {
            const selectedLayer = state.selectedLayer ?? 0;
            const layer = LayerSystem?.layers?.[selectedLayer];
            const code = layer?.material?.source || getEl('shaderCode')?.value || '';
            PlaylistSystem.addEntry({
                name: 'Shader ' + (PlaylistSystem.entries.length + 1),
                shaderCode: code,
                layerIndex: selectedLayer,
            });
            this.render();
        });

        if (addFromShader && addShaderSelect) addFromShader.addEventListener('click', () => {
            const shaderId = addShaderSelect.value;
            if (!shaderId) return;
            PlaylistSystem.addEntryFromShaderId(shaderId);
            this.render();
        });
    },

    // ─── Footer ───

    _bindFooter() {
        const clearAll = getEl('plClearAll');
        const exportBtn = getEl('plExport');
        const importBtn = getEl('plImport');
        const importFile = getEl('plImportFile');

        if (clearAll) clearAll.addEventListener('click', () => {
            PlaylistSystem.clearEntries();
            this.render();
        });

        if (exportBtn) exportBtn.addEventListener('click', () => {
            const json = PlaylistSystem.exportJSON();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'playlist.json';
            a.click();
            URL.revokeObjectURL(url);
        });

        if (importBtn && importFile) importBtn.addEventListener('click', () => {
            importFile.click();
        });

        if (importFile) importFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (PlaylistSystem.importJSON(ev.target.result)) {
                    this.render();
                }
            };
            reader.readAsText(file);
            importFile.value = '';
        });
    },

    // ─── Progress Updates ───

    _startProgressListener() {
        document.addEventListener('playlist-progress', (e) => {
            this._updateProgressBar(e.detail);
        });
    },

    _updateProgressBar(detail) {
        const bar = getEl('plProgressBar');
        const text = getEl('plProgressText');
        if (!bar || !text) return;
        const pct = Math.round((detail.progress || 0) * 100);
        const fill = bar.querySelector('.slider__fill');
        if (fill) fill.style.setProperty('--fill-width', pct + '%');
        const elapsed = detail.elapsed ? detail.elapsed.toFixed(1) : '0.0';
        const duration = detail.duration ? detail.duration.toFixed(1) : '0.0';
        const idx = detail.currentIndex ?? 0;
        const name = PlaylistSystem.entries[idx]?.name || '';
        text.textContent = `${elapsed}s / ${duration}s — ${name}`;
    },

    // ─── Render ───

    render() {
        this._updateTransportState();
        this._updateShaderDropdown();
        this.renderEntries();
    },

    _updateTransportState() {
        const play = getEl('plPlay');
        const stop = getEl('plStop');
        const loop = getEl('plLoop');
        const bar = getEl('plProgressBar');
        const text = getEl('plProgressText');

        if (play) play.disabled = PlaylistSystem.isPlaying;
        if (stop) stop.disabled = !PlaylistSystem.isPlaying;
        if (loop) loop.classList.toggle('active', PlaylistSystem.loop);
        if (bar) {
            const fill = bar.querySelector('.slider__fill');
            if (!PlaylistSystem.isPlaying && fill) fill.style.setProperty('--fill-width', '0%');
        }
        if (text && !PlaylistSystem.isPlaying) {
            text.textContent = PlaylistSystem.entries.length > 0
                ? `${PlaylistSystem.entries.length} entries — stopped`
                : 'No entries';
        }
    },

    _updateShaderDropdown() {
        const select = getEl('plAddShaderSelect');
        if (!select) return;

        const current = select.value;
        select.innerHTML = '<option value="">-- Saved Shaders --</option>';
        for (const s of state.savedShaders) {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            select.appendChild(opt);
        }
        select.value = current;
    },

    renderEntries() {
        const container = getEl('plEntries');
        if (!container) return;

        if (PlaylistSystem.entries.length === 0) {
            container.innerHTML = '<div class="pl-empty">No playlist entries. Add shaders above.</div>';
            return;
        }

        container.innerHTML = '';
        PlaylistSystem.entries.forEach((entry, idx) => {
            const row = document.createElement('div');
            row.className = 'pl-entry' + (idx === PlaylistSystem.currentIndex && PlaylistSystem.isPlaying ? ' pl-entry-active' : '');
            row.draggable = true;
            row.dataset.index = idx;

            // Drag events for reordering
            row.addEventListener('dragstart', (e) => {
                this._dragSrcIndex = idx;
                e.dataTransfer.effectAllowed = 'move';
                row.classList.add('pl-entry-dragging');
            });
            row.addEventListener('dragend', () => {
                row.classList.remove('pl-entry-dragging');
                this._dragSrcIndex = null;
            });
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                if (this._dragSrcIndex !== null && this._dragSrcIndex !== idx) {
                    PlaylistSystem.moveEntry(this._dragSrcIndex, idx);
                    this.render();
                }
            });

            // Index badge
            const indexBadge = document.createElement('span');
            indexBadge.className = 'pl-entry-index';
            indexBadge.textContent = idx + 1;

            // Name input
            const nameInput = document.createElement('input');
            nameInput.className = 'pl-entry-name';
            nameInput.type = 'text';
            nameInput.value = entry.name;
            nameInput.dataset.tooltip = T.PL_ENTRY_NAME;
            nameInput.addEventListener('change', () => {
                PlaylistSystem.updateEntry(entry.id, { name: nameInput.value });
            });

            // Duration
            const durationInput = document.createElement('input');
            durationInput.className = 'pl-entry-field';
            durationInput.type = 'number';
            durationInput.min = '0.5';
            durationInput.max = '600';
            durationInput.step = '0.5';
            durationInput.value = entry.duration ?? 30;
            durationInput.dataset.tooltip = T.PL_ENTRY_DURATION;
            durationInput.addEventListener('change', () => {
                PlaylistSystem.updateEntry(entry.id, { duration: parseFloat(durationInput.value) || 30 });
            });

            // Fade In
            const fadeInInput = document.createElement('input');
            fadeInInput.className = 'pl-entry-field';
            fadeInInput.type = 'number';
            fadeInInput.min = '0';
            fadeInInput.max = '30';
            fadeInInput.step = '0.1';
            fadeInInput.value = entry.fadeIn ?? 2;
            fadeInInput.dataset.tooltip = T.PL_ENTRY_FADE_IN;
            fadeInInput.addEventListener('change', () => {
                PlaylistSystem.updateEntry(entry.id, { fadeIn: parseFloat(fadeInInput.value) || 0 });
            });

            // Fade Out
            const fadeOutInput = document.createElement('input');
            fadeOutInput.className = 'pl-entry-field';
            fadeOutInput.type = 'number';
            fadeOutInput.min = '0';
            fadeOutInput.max = '30';
            fadeOutInput.step = '0.1';
            fadeOutInput.value = entry.fadeOut ?? 2;
            fadeOutInput.dataset.tooltip = T.PL_ENTRY_FADE_OUT;
            fadeOutInput.addEventListener('change', () => {
                PlaylistSystem.updateEntry(entry.id, { fadeOut: parseFloat(fadeOutInput.value) || 0 });
            });

            // MIDI Note
            const midiInput = document.createElement('input');
            midiInput.className = 'pl-entry-field pl-entry-midi';
            midiInput.type = 'number';
            midiInput.min = '0';
            midiInput.max = '127';
            midiInput.value = entry.midiNote ?? '';
            midiInput.placeholder = 'MIDI';
            midiInput.dataset.tooltip = T.PL_ENTRY_MIDI;
            midiInput.addEventListener('change', () => {
                const val = midiInput.value.trim();
                PlaylistSystem.updateEntry(entry.id, { midiNote: val ? parseInt(val) : null });
            });

            // Delete button
            const delBtn = document.createElement('button');
            delBtn.className = 'tool-btn tool-btn--ghost';
            delBtn.textContent = '✕';
            delBtn.dataset.tooltip = T.PL_ENTRY_DELETE;
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                PlaylistSystem.removeEntry(entry.id);
                this.render();
            });

            // Labels row
            const labels = document.createElement('div');
            labels.className = 'pl-entry-labels';
            labels.innerHTML = '<span>dur</span><span>in</span><span>out</span><span>note</span>';

            // Fields row
            const fields = document.createElement('div');
            fields.className = 'pl-entry-fields';
            fields.append(durationInput, fadeInInput, fadeOutInput, midiInput);

            // Right side container
            const right = document.createElement('div');
            right.className = 'pl-entry-right';
            right.append(labels, fields);

            row.append(indexBadge, nameInput, right, delBtn);
            container.appendChild(row);
        });
    },
};
