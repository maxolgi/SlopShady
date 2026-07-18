/**
 * MIDI File Player
 * Parses Standard MIDI Files and drives the visual synthesizer
 * via MIDISystem's _handleNoteOn/_handleNoteOff/_handleCC methods.
 * Uses requestAnimationFrame for tight sync with the render loop.
 */

import { MIDISystem } from './midi.js';

export const MIDIPlayer = {
    _parsed: null,
    _events: [],
    _eventIndex: 0,
    _startTime: 0,
    _startOffset: 0,
    _isPlaying: false,
    _rafId: null,
    _duration: 0,
    _tempoMap: [],
    _ticksPerBeat: 480,
    _notesCache: null,

    // ── Public API ──────────────────────────────────────────────

    async loadFile(file) {
        this.stop();
        const buffer = await file.arrayBuffer();
        this._parsed = this._parseMIDI(new Uint8Array(buffer));
        this._tempoMap = this._buildTempoMap(this._parsed);
        this._events = this._flattenEvents(this._parsed);
        this._duration = this._events.length > 0
            ? this._events[this._events.length - 1].time
            : 0;
        this._eventIndex = 0;
        this._startOffset = 0;
        this._notesCache = null;
    },

    play() {
        if (!this._events.length) return;
        if (this._isPlaying) return;  // Prevent duplicate RAF loops
        this._startTime = performance.now();
        this._isPlaying = true;
        this._scheduleLoop();
    },

    pause() {
        this._isPlaying = false;
        this._startOffset = this.getCurrentTime();
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    },

    stop() {
        this._isPlaying = false;
        this._startOffset = 0;
        this._eventIndex = 0;
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        this._allNotesOff();
    },

    seek(timeSeconds) {
        const wasPlaying = this._isPlaying;
        if (wasPlaying) this.pause();
        this._allNotesOff();  // Release any active voices
        this._startOffset = Math.max(0, Math.min(timeSeconds, this._duration));
        this._eventIndex = this._binarySearchEventIndex(this._startOffset);
        if (wasPlaying) this.play();
    },

    getCurrentTime() {
        if (!this._isPlaying) return this._startOffset;
        return (performance.now() - this._startTime) / 1000 + this._startOffset;
    },

    getDuration() { return this._duration; },

    getNotes() {
        if (this._notesCache) return this._notesCache;
        const notes = [];
        const activeNotes = new Map();
        for (const event of this._events) {
            const key = `${event.channel}-${event.note}`;
            if (event.type === 'noteOn' && event.velocity > 0) {
                const existing = activeNotes.get(key);
                if (existing) {
                    notes.push({ ...existing, end: event.time });  // Implicit close
                }
                activeNotes.set(key, {
                    start: event.time,
                    velocity: event.velocity,
                    channel: event.channel,
                    note: event.note
                });
            } else if (event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0)) {
                const active = activeNotes.get(key);
                if (active) {
                    notes.push({ ...active, end: event.time });
                    activeNotes.delete(key);
                }
            }
        }
        for (const [, active] of activeNotes) {
            notes.push({ ...active, end: this._duration });
        }
        this._notesCache = notes;
        return notes;
    },

    // ── Playback Scheduler ──────────────────────────────────────

    _scheduleLoop() {
        if (!this._isPlaying) return;
        const elapsed = (performance.now() - this._startTime) / 1000 + this._startOffset;

        while (this._eventIndex < this._events.length) {
            const event = this._events[this._eventIndex];
            if (event.time > elapsed) break;
            this._handleEvent(event);
            this._eventIndex++;
        }

        if (this._eventIndex >= this._events.length) {
            const loop = document.getElementById('playerLoop')?.classList.contains('active');
            if (loop) {
                this._allNotesOff();
                this._startOffset = 0;
                this._startTime = performance.now();
                this._eventIndex = 0;
            } else {
                this._isPlaying = false;
                this._allNotesOff();
                document.dispatchEvent(new CustomEvent('midi-player-end'));
                return;
            }
        }
        this._rafId = requestAnimationFrame(() => this._scheduleLoop());
    },

    _handleEvent(event) {
        if (event.type === 'noteOn') {
            MIDISystem._handleNoteOn(event.channel, event.note, event.velocity);
        } else if (event.type === 'noteOff') {
            MIDISystem._handleNoteOff(event.channel, event.note);
        } else if (event.type === 'cc') {
            MIDISystem._handleCC(event.channel, event.cc, event.value);
        }
    },

    _binarySearchEventIndex(targetTime) {
        let low = 0;
        let high = this._events.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (this._events[mid].time <= targetTime) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return low;
    },

    _allNotesOff() {
        for (let ch = 0; ch < 16; ch++) {
            for (let note = 0; note < 128; note++) {
                MIDISystem._handleNoteOff(ch, note);
            }
        }
    },

    // ── MIDI Parser ─────────────────────────────────────────────

    _parseMIDI(data) {
        // Read header
        if (this._readString(data, 0, 4) !== 'MThd') {
            throw new Error('Not a valid MIDI file');
        }
        const headerLen = this._readUint32(data, 4);
        const format = this._readUint16(data, 8);
        const numTracks = this._readUint16(data, 10);
        const division = this._readUint16(data, 12);

        const ticksPerBeat = division; // Assume ticks-per-beat (not SMPTE)

        // Read tracks
        const tracks = [];
        let offset = 8 + headerLen;
        for (let t = 0; t < numTracks; t++) {
            if (this._readString(data, offset, 4) !== 'MTrk') {
                throw new Error(`Invalid track chunk at offset ${offset}`);
            }
            const trackLen = this._readUint32(data, offset + 4);
            const trackData = data.subarray(offset + 8, offset + 8 + trackLen);
            tracks.push(this._parseTrack(trackData));
            offset += 8 + trackLen;
        }

        return { format, numTracks, ticksPerBeat, tracks };
    },

    _parseTrack(data) {
        const events = [];
        let offset = 0;
        let tick = 0;
        let runningStatus = 0;

        while (offset < data.length) {
            // Delta time (VLQ)
            const delta = this._readVLQ(data, offset);
            offset = delta.offset;
            tick += delta.value;

            let byte = data[offset];

            // Meta event
            if (byte === 0xFF) {
                offset++;
                const metaType = data[offset++];
                const len = this._readVLQ(data, offset);
                offset = len.offset;
                if (metaType === 0x51 && len.value === 3) {
                    // Tempo: microseconds per beat
                    const microsPerBeat = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
                    events.push({ tick, type: 'tempo', microsPerBeat });
                } else if (metaType === 0x2F) {
                    // End of track
                    events.push({ tick, type: 'endOfTrack' });
                }
                // Skip other meta events
                offset += len.value;
                continue;
            }

            // SysEx
            if (byte === 0xF0 || byte === 0xF7) {
                offset++;
                const len = this._readVLQ(data, offset);
                offset = len.offset + len.value;
                continue;
            }

            // Running status
            if (byte & 0x80) {
                runningStatus = byte;
                offset++;
            } else {
                byte = runningStatus;
            }

            const type = byte & 0xF0;
            const channel = byte & 0x0F;

            if (type === 0x90) {
                const note = data[offset++];
                const velocity = data[offset++];
                if (velocity === 0) {
                    events.push({ tick, type: 'noteOff', channel, note });
                } else {
                    events.push({ tick, type: 'noteOn', channel, note, velocity });
                }
            } else if (type === 0x80) {
                const note = data[offset++];
                const velocity = data[offset++];
                events.push({ tick, type: 'noteOff', channel, note });
            } else if (type === 0xB0) {
                const cc = data[offset++];
                const value = data[offset++];
                events.push({ tick, type: 'cc', channel, cc, value });
            } else if (type === 0xC0) {
                const program = data[offset++];
                events.push({ tick, type: 'programChange', channel, program });
            } else if (type === 0xD0) {
                offset += 1; // channel pressure: 1 data byte
            } else if (type === 0xE0) {
                offset += 2; // pitch bend: 2 data bytes
            } else if (type === 0xA0) {
                offset += 2; // polyphonic key pressure: 2 data bytes
            }
        }

        return events;
    },

    // ── Tempo Map ───────────────────────────────────────────────

    _buildTempoMap(parsed) {
        const map = [];
        for (const track of parsed.tracks) {
            for (const event of track) {
                if (event.type === 'tempo') {
                    map.push({ tick: event.tick, microsPerBeat: event.microsPerBeat });
                }
            }
        }
        map.sort((a, b) => a.tick - b.tick);
        return map;
    },

    // ── Event Flattener ─────────────────────────────────────────

    _flattenEvents(parsed) {
        const allEvents = [];
        const { ticksPerBeat, tracks } = parsed;

        for (const track of tracks) {
            for (const event of track) {
                if (event.type === 'tempo' || event.type === 'endOfTrack') continue;
                const time = this._ticksToSeconds(event.tick, this._tempoMap, ticksPerBeat);
                allEvents.push({
                    time,
                    type: event.type,
                    channel: event.channel,
                    note: event.note,
                    velocity: event.velocity,
                    cc: event.cc,
                    value: event.value,
                    program: event.program
                });
            }
        }

        allEvents.sort((a, b) => a.time - b.time);
        return allEvents;
    },

    // ── Helpers ─────────────────────────────────────────────────

    _ticksToSeconds(tick, tempoMap, ticksPerBeat) {
        let seconds = 0;
        let lastTick = 0;
        let microsPerBeat = 500000; // default 120 BPM

        for (const { tick: tTick, microsPerBeat: tMPB } of tempoMap) {
            if (tTick >= tick) break;
            seconds += (tTick - lastTick) / ticksPerBeat * (microsPerBeat / 1000000);
            lastTick = tTick;
            microsPerBeat = tMPB;
        }
        seconds += (tick - lastTick) / ticksPerBeat * (microsPerBeat / 1000000);
        return seconds;
    },

    _readVLQ(data, offset) {
        let value = 0;
        let byte;
        do {
            byte = data[offset++];
            value = (value << 7) | (byte & 0x7F);
        } while (byte & 0x80);
        return { value, offset };
    },

    _readString(data, offset, length) {
        let str = '';
        for (let i = 0; i < length; i++) str += String.fromCharCode(data[offset + i]);
        return str;
    },

    _readUint16(data, offset) {
        return (data[offset] << 8) | data[offset + 1];
    },

    _readUint32(data, offset) {
        return (data[offset] << 24) | (data[offset + 1] << 16) |
               (data[offset + 2] << 8) | data[offset + 3];
    }
};
