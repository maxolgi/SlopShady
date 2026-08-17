/**
 * On-Screen Piano Keyboard
 * Visual piano keyboard for testing MIDI/EGs without hardware
 * Triggers the same voice system as physical MIDI
 */

import { LayerSystem } from '../webgl/layers.js';
import { state } from '../state.js';

// Note names for display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Default: 2 octaves starting at C3 (MIDI note 48)
const DEFAULT_START_NOTE = 48;
const DEFAULT_END_NOTE = 71;

// Key geometry constants
const WHITE_KEY_WIDTH = 28;
const WHITE_KEY_HEIGHT = 120;
const BLACK_KEY_WIDTH = 18;
const BLACK_KEY_HEIGHT = 80;

// Which notes are black keys (indices within octave: 1=C#, 3=D#, 6=F#, 8=G#, 10=A#)
const BLACK_KEY_INDICES = new Set([1, 3, 6, 8, 10]);

export const OnScreenKeyboard = {
    container: null,
    keysContainer: null,
    startNote: DEFAULT_START_NOTE,
    endNote: DEFAULT_END_NOTE,
    activeNotes: new Set(), // Currently pressed notes (for visual feedback)
    isMouseDown: false,
    touchNotes: new Map(), // Map touch IDs to notes
    _docListenersAttached: false,

    /**
     * Initialize the on-screen keyboard
     * @param {HTMLElement} container - Container element to inject keyboard into
     */
    init(container) {
        if (!container) {
            return false;
        }

        this.container = container;
        this.container.className = 'osk-container custom-scrollbar';
        
        // Create keys container
        this.keysContainer = document.createElement('div');
        this.keysContainer.className = 'osk-keys';
        this.container.appendChild(this.keysContainer);

        // Build the keyboard
        this._buildKeyboard();

        // Setup global event listeners
        this._setupEventListeners();

        return true;
    },

    /**
     * Build the keyboard DOM structure
     */
    _buildKeyboard() {
        if (!this.keysContainer) return;

        // Clear existing keys
        this.keysContainer.innerHTML = '';

        // Calculate white keys and their positions
        const whiteKeys = [];
        const blackKeys = [];
        let whiteKeyIndex = 0;

        for (let note = this.startNote; note <= this.endNote; note++) {
            const noteInOctave = note % 12;
            const isBlack = BLACK_KEY_INDICES.has(noteInOctave);

            if (isBlack) {
                blackKeys.push({
                    note,
                    noteName: NOTE_NAMES[noteInOctave],
                    left: (whiteKeyIndex * WHITE_KEY_WIDTH) - (BLACK_KEY_WIDTH / 2)
                });
            } else {
                whiteKeys.push({
                    note,
                    noteName: NOTE_NAMES[noteInOctave],
                    index: whiteKeyIndex,
                    left: whiteKeyIndex * WHITE_KEY_WIDTH
                });
                whiteKeyIndex++;
            }
        }

        // Create white keys first (bottom layer)
        for (const keyData of whiteKeys) {
            const key = this._createKey(keyData, 'white');
            this.keysContainer.appendChild(key);
        }

        // Create black keys on top
        for (const keyData of blackKeys) {
            const key = this._createKey(keyData, 'black');
            this.keysContainer.appendChild(key);
        }

        // Set container width
        this.keysContainer.style.setProperty('--osk-width', `${whiteKeyIndex * WHITE_KEY_WIDTH}px`);
    },

    /**
     * Create a single key element
     */
    _createKey(keyData, type) {
        const key = document.createElement('div');
        key.className = type === 'white' ? 'osk-white-key' : 'osk-black-key';
        key.dataset.note = keyData.note;
        const fullName = `${keyData.noteName}${Math.floor(keyData.note / 12) - 1}`;
        key.dataset.noteName = fullName;
        key.dataset.tooltip = `MIDI note ${keyData.note} (${fullName})`;

        key.style.setProperty('--osk-key-left', `${keyData.left}px`);

        // Touch/mouse events
        key.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.triggerKey(keyData.note, 100);
        });

        key.addEventListener('mouseenter', (e) => {
            if (this.isMouseDown && !this.activeNotes.has(keyData.note)) {
                this.triggerKey(keyData.note, 100);
            }
        });

        key.addEventListener('mouseup', (e) => {
            e.preventDefault();
            this.releaseKey(keyData.note);
        });

        key.addEventListener('mouseleave', (e) => {
            if (this.activeNotes.has(keyData.note)) {
                this.releaseKey(keyData.note);
            }
        });

        // Touch events
        key.addEventListener('touchstart', (e) => {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                const existingNote = this.touchNotes.get(touch.identifier);
                if (existingNote !== undefined && existingNote !== keyData.note) {
                    this.releaseKey(existingNote);
                }
                this.touchNotes.set(touch.identifier, keyData.note);
                this.triggerKey(keyData.note, 100);
            }
        }, { passive: false });

        key.addEventListener('touchend', (e) => {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                const note = this.touchNotes.get(touch.identifier);
                if (note !== undefined) {
                    this.releaseKey(note);
                    this.touchNotes.delete(touch.identifier);
                }
            }
        }, { passive: false });

        key.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            for (const touch of e.changedTouches) {
                const note = this.touchNotes.get(touch.identifier);
                if (note !== undefined) {
                    this.releaseKey(note);
                    this.touchNotes.delete(touch.identifier);
                }
            }
        }, { passive: false });

        return key;
    },

    /**
     * Setup global event listeners
     */
    _setupEventListeners() {
        // Document-level listeners persist across re-init — attach them only once
        if (!this._docListenersAttached) {
            // Track mouse state for drag-to-play
            document.addEventListener('mousedown', () => {
                this.isMouseDown = true;
            });

            document.addEventListener('mouseup', () => {
                this.isMouseDown = false;
                // Release all notes on mouse up
                this.releaseAllKeys();
            });

            // Reflect incoming notes (MIDI hardware, OSC, or any other source) on
            // the piano visuals. Visual-only — voices are already triggered by the
            // dispatcher (MIDISystem._handleNoteOn), so we must NOT call triggerKey
            // here (that would re-trigger voices and loop via midi-noteon).
            document.addEventListener('midi-noteon', (e) => {
                const note = e.detail?.note;
                if (note == null) return;
                this.activeNotes.add(note);
                this._updateKeyVisual(note, true);
            });
            document.addEventListener('midi-noteoff', (e) => {
                const note = e.detail?.note;
                if (note == null) return;
                this.activeNotes.delete(note);
                this._updateKeyVisual(note, false);
            });

            this._docListenersAttached = true;
        }

        // Prevent context menu on keyboard
        this.container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    },

    /**
     * Trigger a note (called by click/touch or programmatically)
     * @param {number} note - MIDI note number
     * @param {number} velocity - Velocity 0-127 (default 100)
     */
    triggerKey(note, velocity = 100) {
        if (note < this.startNote || note > this.endNote) return;

        // Update visual state
        this.activeNotes.add(note);
        this._updateKeyVisual(note, true);

        // Trigger voices on all enabled layers (same as MIDI)
        for (const layer of LayerSystem.layers) {
            if (!layer.enabled || !layer.voiceManager || layer.voiceMode === 'off') continue;
            layer.voiceManager.trigger(note, velocity);
        }

        // Dispatch custom event for UI updates (same as MIDI)
        document.dispatchEvent(new CustomEvent('midi-noteon', {
            detail: { channel: 0, note, velocity }
        }));
    },

    /**
     * Release a note (called by mouseup/touchend or programmatically)
     * @param {number} note - MIDI note number
     */
    releaseKey(note) {
        if (note < this.startNote || note > this.endNote) return;

        // Update visual state
        this.activeNotes.delete(note);
        this._updateKeyVisual(note, false);

        // Release voices on all layers (same as MIDI)
        for (const layer of LayerSystem.layers) {
            if (!layer.voiceManager || layer.voiceMode === 'off') continue;
            layer.voiceManager.release(note);
        }

        // Dispatch custom event for UI updates (same as MIDI)
        document.dispatchEvent(new CustomEvent('midi-noteoff', {
            detail: { channel: 0, note }
        }));
    },

    /**
     * Release all currently active keys
     */
    releaseAllKeys() {
        // Copy the set to avoid modification during iteration
        const notes = Array.from(this.activeNotes);
        for (const note of notes) {
            this.releaseKey(note);
        }
        this.activeNotes.clear();
        this.touchNotes.clear();
    },

    /**
     * Update visual state of a key
     */
    _updateKeyVisual(note, isActive) {
        const key = this.keysContainer?.querySelector(`[data-note="${note}"]`);
        if (key) {
            key.classList.toggle('osk-key-active', isActive);
        }
    },

    /**
     * Set the note range for the keyboard
     * @param {number} startNote - Starting MIDI note
     * @param {number} endNote - Ending MIDI note
     */
    setKeyRange(startNote, endNote) {
        // Release any active notes before rebuilding
        this.releaseAllKeys();

        this.startNote = Math.max(0, Math.min(127, startNote));
        this.endNote = Math.max(0, Math.min(127, endNote));

        if (this.endNote <= this.startNote) {
            this.endNote = this.startNote + 23; // Default to ~2 octaves
        }

        this._buildKeyboard();
    },

    /**
     * Get current note range
     * @returns {object} { startNote, endNote }
     */
    getKeyRange() {
        return {
            startNote: this.startNote,
            endNote: this.endNote
        };
    },

    /**
     * Shift the keyboard up or down by octaves
     * @param {number} octaves - Number of octaves to shift (positive = up, negative = down)
     */
    shiftOctave(octaves) {
        const semitones = octaves * 12;
        let newStart = this.startNote + semitones;
        let newEnd = this.endNote + semitones;

        // Clamp to valid MIDI range
        if (newStart < 0) {
            newEnd += -newStart;
            newStart = 0;
        }
        if (newEnd > 127) {
            newStart -= (newEnd - 127);
            newEnd = 127;
        }
        if (newStart < 0) newStart = 0;

        this.setKeyRange(newStart, newEnd);
    },

    /**
     * Destroy the keyboard and clean up
     */
    destroy() {
        this.releaseAllKeys();
        if (this.container) {
            this.container.innerHTML = '';
            this.container.className = '';
        }
        this.keysContainer = null;
    }
};
