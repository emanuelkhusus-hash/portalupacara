/**
 * audio-engine.js - Audio Engine Web Based dengan Kompatibilitas Penuh KoorSMK
 * Dilengkapi Real Sampled General MIDI SoundFonts (FluidR3_GM):
 * - Acoustic Grand Piano (GM 0)
 * - Church Organ (GM 19)
 * - String Ensemble (GM 48)
 * - Trumpet (GM 56)
 * - Brass Section (GM 61 - Marching Brass)
 * - Choir Aahs (GM 52)
 * - French Horn (GM 60)
 *
 * Serta:
 * 1. 3-Band Equalizer (Low, Mid, High rentang -15 dB s.d. +15 dB)
 * 2. Real-time Transpose (-12 s.d. +12 Semitone)
 * 3. Master Volume & Analyser Visualizer
 * 4. Pemutaran MP3, WAV, OGG, & MIDI
 * 5. High-Precision Lookahead Web Audio Scheduler (Zero-Jitter Clock)
 * 6. Concert Hall Acoustic Reverb & Exponential Release Decay Smoothing
 */

const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function midiNoteToKeyName(midiNote) {
  const octave = Math.floor(midiNote / 12) - 1;
  const name = NOTE_NAMES[midiNote % 12];
  return `${name}${octave}`;
}

class CeremonyAudioEngine {
  constructor() {
    this.audioCtx = null;
    this.audioElement = new Audio();
    this.audioElement.crossOrigin = 'anonymous';

    // Audio nodes
    this.sourceNode = null;
    this.eqLow = null;
    this.eqMid = null;
    this.eqHigh = null;
    this.analyser = null;
    this.gainNode = null;

    // Reverb & Ambience Nodes (Karakter Aula / Hall KoorSMK)
    this.reverbConvolver = null;
    this.reverbSendGain = null;
    this.dryGain = null;

    // Status state
    this.currentSemitones = 0;
    this.currentPitch = 1.0;
    this.currentInstrumentMode = 'original'; // original, 0, 19, 48, 56, -1, -2, -3, -4
    this.currentSong = null;
    this.currentBlobUrl = null;
    this.isPlaying = false;
    this.isMidi = false;

    // High-Precision MIDI Synth State (Hardware Lookahead Scheduler)
    this.midiEvents = [];
    this.activeMidiVoices = [];
    this.midiDuration = 0;
    this.midiCurrentTime = 0;
    this.playbackStartAudioCtxTime = 0;
    this.playbackStartOffset = 0;
    this.nextMidiEventIndex = 0;
    this.midiSchedulerTimer = null;
    this.midiProgressTimer = null;

    // SoundFont Caches
    this.loadedSoundfonts = new Set();
    this.audioBufferCache = new Map(); // key -> AudioBuffer

    // Callbacks
    this.onTimeUpdate = null;
    this.onEnded = null;
    this.onPlayStateChange = null;

    this.initAudioElementEvents();

    // Preload instrumen upacara utama di background
    setTimeout(() => {
      this.preloadCeremonySoundfonts();
    }, 1000);
  }

  ensureAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();

      // Equalizer Nodes (Biquad Filter)
      // LOW: Low Shelf pada 200 Hz (-15 s.d. +15 dB)
      this.eqLow = this.audioCtx.createBiquadFilter();
      this.eqLow.type = 'lowshelf';
      this.eqLow.frequency.value = 200;
      this.eqLow.gain.value = 0;

      // MID: Peaking pada 1000 Hz (-15 s.d. +15 dB)
      this.eqMid = this.audioCtx.createBiquadFilter();
      this.eqMid.type = 'peaking';
      this.eqMid.frequency.value = 1000;
      this.eqMid.Q.value = 1.0;
      this.eqMid.gain.value = 0;

      // HIGH: High Shelf pada 3500 Hz (-15 s.d. +15 dB)
      this.eqHigh = this.audioCtx.createBiquadFilter();
      this.eqHigh.type = 'highshelf';
      this.eqHigh.frequency.value = 3500;
      this.eqHigh.gain.value = 0;

      // Reverb Convolver & Mixer (Karakter Hall Reverb Megah layaknya Android KoorSMK / Roland GM)
      this.reverbConvolver = this.audioCtx.createConvolver();
      this.reverbConvolver.buffer = this.buildImpulseResponse(2.0, 2.5);

      this.reverbSendGain = this.audioCtx.createGain();
      this.reverbSendGain.gain.value = 0.22; // Kehangatan ruang gema 22%

      this.dryGain = this.audioCtx.createGain();
      this.dryGain.gain.value = 0.85; // Sinyal utama jernih

      this.reverbSendGain.connect(this.reverbConvolver);
      this.reverbConvolver.connect(this.eqLow);
      this.dryGain.connect(this.eqLow);

      // Analyser Node untuk visualizer audio
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;

      // Master Gain
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 1.0;

      // Hubungkan chain audio: Low -> Mid -> High -> Gain -> Analyser -> Destination
      this.eqLow.connect(this.eqMid);
      this.eqMid.connect(this.eqHigh);
      this.eqHigh.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      // Hubungkan HTML5 Audio element ke Web Audio Chain
      try {
        this.sourceNode = this.audioCtx.createMediaElementSource(this.audioElement);
        this.sourceNode.connect(this.eqLow);
      } catch (err) {
        console.warn('MediaElementSource already connected or error:', err);
      }
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  buildImpulseResponse(duration = 2.0, decay = 2.5) {
    const sampleRate = (this.audioCtx && this.audioCtx.sampleRate) ? this.audioCtx.sampleRate : 44100;
    const length = Math.floor(sampleRate * duration);
    const impulse = (this.audioCtx || new (window.AudioContext || window.webkitAudioContext)()).createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const n = i / length;
      const env = Math.pow(1 - n, decay);
      left[i] = (Math.random() * 2 - 1) * env;
      right[i] = (Math.random() * 2 - 1) * env;
    }
    return impulse;
  }

  initAudioElementEvents() {
    this.audioElement.addEventListener('timeupdate', () => {
      if (!this.isMidi && this.onTimeUpdate) {
        this.onTimeUpdate({
          currentTime: this.audioElement.currentTime,
          duration: this.audioElement.duration || 0,
          progress: (this.audioElement.currentTime / (this.audioElement.duration || 1)) * 100
        });
      }
    });

    this.audioElement.addEventListener('ended', () => {
      this.isPlaying = false;
      if (this.onPlayStateChange) this.onPlayStateChange(false);
      if (this.onEnded) this.onEnded();
    });

    this.audioElement.addEventListener('pause', () => {
      if (!this.isMidi) {
        this.isPlaying = false;
        if (this.onPlayStateChange) this.onPlayStateChange(false);
      }
    });

    this.audioElement.addEventListener('play', () => {
      if (!this.isMidi) {
        this.isPlaying = true;
        if (this.onPlayStateChange) this.onPlayStateChange(true);
      }
    });
  }

  // ==========================================
  // Equalizer Control (Persis seperti KoorSMK)
  // Slider progress: 0..2000, tengah=1000 (0 dB)
  // Range: -15.0 dB s.d. +15.0 dB
  // ==========================================

  setEqGain(band, dbValue) {
    this.ensureAudioContext();
    const clampedDb = Math.max(-15, Math.min(15, dbValue));
    if (band === 'low' && this.eqLow) {
      this.eqLow.gain.setTargetAtTime(clampedDb, this.audioCtx.currentTime, 0.05);
    } else if (band === 'mid' && this.eqMid) {
      this.eqMid.gain.setTargetAtTime(clampedDb, this.audioCtx.currentTime, 0.05);
    } else if (band === 'high' && this.eqHigh) {
      this.eqHigh.gain.setTargetAtTime(clampedDb, this.audioCtx.currentTime, 0.05);
    }
  }

  resetEqualizer() {
    this.setEqGain('low', 0);
    this.setEqGain('mid', 0);
    this.setEqGain('high', 0);
  }

  // ==========================================
  // Transpose Control (Kompatibilitas KoorSMK)
  // currentPitch = 2 ^ (currentSemitones / 12)
  // ==========================================

  setTranspose(semitones) {
    this.currentSemitones = semitones;
    this.currentPitch = Math.pow(2.0, semitones / 12.0);

    if (!this.isMidi) {
      if ('preservesPitch' in this.audioElement) {
        this.audioElement.preservesPitch = false;
      } else if ('mozPreservesPitch' in this.audioElement) {
        this.audioElement.mozPreservesPitch = false;
      } else if ('webkitPreservesPitch' in this.audioElement) {
        this.audioElement.webkitPreservesPitch = false;
      }
      this.audioElement.playbackRate = this.currentPitch;
    } else {
      if (this.isPlaying && this.isMidi && this.currentSong) {
        const curTime = this.midiCurrentTime;
        const needed = this.getInstrumentsForMode(this.currentInstrumentMode);
        this.stopMidi();
        this.predecodeMidiNotes(needed).then(() => {
          this.playMidiEvents(curTime);
        });
      }
    }
    return {
      semitones: this.currentSemitones,
      pitchRatio: this.currentPitch
    };
  }

  setVolume(vol0to1) {
    this.ensureAudioContext();
    const vol = Math.max(0, Math.min(1, vol0to1));
    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(vol, this.audioCtx.currentTime, 0.05);
    }
    this.audioElement.volume = vol;
  }

  async setInstrumentMode(mode) {
    this.currentInstrumentMode = mode;
    // Preload instrumen yang bersangkutan
    const needed = this.getInstrumentsForMode(mode);
    for (const inst of needed) {
      await this.loadSoundfont(inst);
    }

    // Jika sedang memutar MIDI, re-trigger nada dengan instrumen baru
    if (this.isPlaying && this.isMidi && this.currentSong) {
      const curTime = this.midiCurrentTime;
      this.stopMidi();
      await this.predecodeMidiNotes(needed);
      this.playMidiEvents(curTime);
    }
  }

  // ==========================================
  // SoundFont Loader & AudioBuffer Decoder
  // ==========================================

  async loadSoundfont(instName) {
    if (this.loadedSoundfonts.has(instName) && window.MIDI && window.MIDI.Soundfont && window.MIDI.Soundfont[instName]) {
      return window.MIDI.Soundfont[instName];
    }

    return new Promise((resolve) => {
      const existing = document.querySelector(`script[data-soundfont="${instName}"]`);
      if (existing && window.MIDI && window.MIDI.Soundfont && window.MIDI.Soundfont[instName]) {
        this.loadedSoundfonts.add(instName);
        resolve(window.MIDI.Soundfont[instName]);
        return;
      }

      const script = document.createElement('script');
      script.setAttribute('data-soundfont', instName);
      script.src = `./soundfonts/${instName}-mp3.js`;
      script.onload = () => {
        this.loadedSoundfonts.add(instName);
        console.log(`[SoundFont] Berhasil memuat sampel suara asli: ${instName}`);
        resolve((window.MIDI && window.MIDI.Soundfont) ? window.MIDI.Soundfont[instName] : null);
      };
      script.onerror = () => {
        console.warn(`[SoundFont] Gagal memuat file soundfont lokal untuk ${instName}`);
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }

  async preloadCeremonySoundfonts() {
    const primary = ['acoustic_grand_piano', 'string_ensemble_1', 'brass_section', 'trumpet'];
    for (const inst of primary) {
      await this.loadSoundfont(inst);
    }
  }

  getInstrumentsForMode(mode) {
    switch (mode) {
      case '0':
        return ['acoustic_grand_piano'];
      case '19':
        return ['church_organ'];
      case '48':
        return ['string_ensemble_1'];
      case '56':
        return ['trumpet'];
      case '-1': // Megah (Strings + Trumpet + Brass)
        return ['string_ensemble_1', 'trumpet', 'brass_section'];
      case '-2': // Marching Brass (Trumpet + Brass Section)
        return ['trumpet', 'brass_section'];
      case '-3': // Simfoni Upacara (French Horn + Strings + Brass)
        return ['french_horn', 'string_ensemble_1', 'brass_section'];
      case '-4': // Fanfare (Trumpet + French Horn + Brass)
        return ['trumpet', 'french_horn', 'brass_section'];
      default: // Original Upacara (Church Organ)
        return ['church_organ', 'string_ensemble_1', 'trumpet'];
    }
  }

  /**
   * Mengembalikan daftar instrumen dan bobot volume untuk nada tertentu.
   * Mendukung dual-layering dan pemisahan melodi/bas cerdas berdasarkan channel dan pitch.
   */
  getVoicesForEvent(mode, channel, midiNote) {
    // Channel 9 di MIDI adalah perkusi/drum: abaikan agar tidak menimbulkan nada fals
    if (channel === 9) {
      return [];
    }

    // Nada melodi (register tinggi atau channel 2)
    const isMelody = (channel === 2 || midiNote >= 54);

    switch (mode) {
      case '0':
        return [{ inst: 'acoustic_grand_piano', vol: 1.0 }];

      case '19':
        return [{ inst: 'church_organ', vol: 1.0 }];

      case '48':
        return [{ inst: 'string_ensemble_1', vol: 1.0 }];

      case '56':
        return [{ inst: 'trumpet', vol: 1.0 }];

      case '-1': // 👑 MEGAH (STRINGS + BRASS)
        if (isMelody) {
          return [
            { inst: 'string_ensemble_1', vol: 0.8 },
            { inst: 'trumpet', vol: 0.65 }
          ];
        } else {
          return [
            { inst: 'string_ensemble_1', vol: 0.8 },
            { inst: 'brass_section', vol: 0.65 }
          ];
        }

      case '-2': // 🥁 MARCHING BRASS (KORSIK LAPANGAN)
        if (isMelody) {
          return [
            { inst: 'trumpet', vol: 0.95 },
            { inst: 'brass_section', vol: 0.35 }
          ];
        } else {
          return [
            { inst: 'brass_section', vol: 0.95 }
          ];
        }

      case '-3': // 🏛️ SIMFONI UPACARA (FRENCH HORN & STRINGS)
        if (isMelody) {
          return [
            { inst: 'french_horn', vol: 0.85 },
            { inst: 'string_ensemble_1', vol: 0.65 }
          ];
        } else {
          return [
            { inst: 'string_ensemble_1', vol: 0.85 },
            { inst: 'brass_section', vol: 0.45 }
          ];
        }

      case '-4': // ⚜️ FANFARE
        if (isMelody) {
          return [
            { inst: 'trumpet', vol: 0.9 },
            { inst: 'french_horn', vol: 0.7 }
          ];
        } else {
          return [
            { inst: 'brass_section', vol: 0.85 }
          ];
        }

      default: // Original: Church Organ pengiring upacara
        return [{ inst: 'church_organ', vol: 1.0 }];
    }
  }

  /**
   * Decode base64 data URI ke AudioBuffer dengan memori caching instan
   */
  async getOrDecodeAudioBuffer(instName, noteKey) {
    const cacheKey = `${instName}_${noteKey}`;
    if (this.audioBufferCache.has(cacheKey)) {
      return this.audioBufferCache.get(cacheKey);
    }

    if (!window.MIDI || !window.MIDI.Soundfont || !window.MIDI.Soundfont[instName]) {
      return null;
    }

    const dataUri = window.MIDI.Soundfont[instName][noteKey];
    if (!dataUri) return null;

    try {
      const base64Data = dataUri.split(',')[1];
      const binaryStr = window.atob(base64Data);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      this.ensureAudioContext();
      const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer);
      this.audioBufferCache.set(cacheKey, audioBuffer);
      return audioBuffer;
    } catch (e) {
      console.warn(`Gagal decode sampel audio untuk ${cacheKey}:`, e);
      return null;
    }
  }

  /**
   * Pre-decode seluruh sampel not yang digunakan dalam lagu sebelum pemutaran dimulai
   * Mencegah stutter dan penundaan not pertama
   */
  async predecodeMidiNotes(instruments) {
    if (!this.audioCtx) return;
    const uniqueNotes = new Set();
    for (const evt of this.midiEvents) {
      if ((evt.type === 'noteOn' || evt.type === 'noteOff') && typeof evt.note === 'number') {
        const transposedNote = Math.max(21, Math.min(108, evt.note + this.currentSemitones));
        uniqueNotes.add(transposedNote);
      }
    }

    const decodePromises = [];
    for (const inst of instruments) {
      for (const note of uniqueNotes) {
        const noteKey = midiNoteToKeyName(note);
        const cacheKey = `${inst}_${noteKey}`;
        if (!this.audioBufferCache.has(cacheKey)) {
          decodePromises.push(this.getOrDecodeAudioBuffer(inst, noteKey));
        }
      }
    }

    if (decodePromises.length > 0) {
      try {
        await Promise.all(decodePromises);
      } catch (err) {
        console.warn('Catatan: Beberapa sampel sedang didecode secara bertahap:', err);
      }
    }
  }

  // ==========================================
  // Pemutaran File Audio Standar (MP3 / WAV)
  // ==========================================

  async playAudioBlob(blob, songInfo) {
    this.ensureAudioContext();
    this.stopAll();

    this.currentSong = songInfo;
    this.isMidi = false;

    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
    }
    this.currentBlobUrl = URL.createObjectURL(blob);
    this.audioElement.src = this.currentBlobUrl;

    this.setTranspose(this.currentSemitones);

    try {
      await this.audioElement.play();
      this.isPlaying = true;
      if (this.onPlayStateChange) this.onPlayStateChange(true);
    } catch (err) {
      console.error('Error saat memutar audio:', err);
      throw err;
    }
  }

  async playAudioUrl(url, songInfo) {
    this.ensureAudioContext();
    this.stopAll();

    this.currentSong = songInfo;
    this.isMidi = false;
    this.audioElement.src = url;

    this.setTranspose(this.currentSemitones);

    try {
      await this.audioElement.play();
      this.isPlaying = true;
      if (this.onPlayStateChange) this.onPlayStateChange(true);
    } catch (err) {
      console.error('Error saat memutar url:', err);
      throw err;
    }
  }

  pause() {
    if (this.isMidi) {
      this.pauseMidi();
    } else {
      this.audioElement.pause();
    }
    this.isPlaying = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  resume() {
    this.ensureAudioContext();
    if (this.isMidi) {
      this.resumeMidi();
    } else {
      this.audioElement.play();
    }
    this.isPlaying = true;
    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  seek(seconds) {
    if (this.isMidi) {
      this.seekMidi(seconds);
    } else {
      this.audioElement.currentTime = seconds;
    }
  }

  stopAll() {
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
    this.stopMidi();
    this.isPlaying = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  // ==========================================
  // Parser & Pemutar MIDI dengan High-Precision Engine
  // ==========================================

  async playMidiBlob(blob, songInfo) {
    this.ensureAudioContext();
    this.stopAll();

    this.currentSong = songInfo;
    this.isMidi = true;

    // Pastikan soundfont yang dibutuhkan sudah termuat
    const needed = this.getInstrumentsForMode(this.currentInstrumentMode);
    for (const inst of needed) {
      await this.loadSoundfont(inst);
    }

    const arrayBuffer = await blob.arrayBuffer();
    this.parseAndLoadMidi(arrayBuffer);

    // Pre-decode seluruh sampel not sebelum play
    await this.predecodeMidiNotes(needed);

    this.playMidiEvents(0);
  }

  parseAndLoadMidi(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    this.midiEvents = [];
    this.midiDuration = 0;

    // Cek header 'MThd'
    if (bytes[0] !== 0x4D || bytes[1] !== 0x54 || bytes[2] !== 0x68 || bytes[3] !== 0x64) {
      console.warn('File bukan MIDI MThd standar.');
      return;
    }

    const trackCount = (bytes[10] << 8) | bytes[11];
    const timeDivision = (bytes[12] << 8) | bytes[13];

    let ticksPerQuarter = (timeDivision & 0x8000) === 0 ? timeDivision : 96;
    let usPerQuarter = 500000; // Default 120 BPM

    let ptr = 14;
    const allTracksEvents = [];

    for (let t = 0; t < trackCount && ptr < bytes.length; t++) {
      if (bytes[ptr] !== 0x4D || bytes[ptr + 1] !== 0x54 || bytes[ptr + 2] !== 0x72 || bytes[ptr + 3] !== 0x6B) {
        break;
      }
      ptr += 4;
      const trackLength = (bytes[ptr] << 24) | (bytes[ptr + 1] << 16) | (bytes[ptr + 2] << 8) | bytes[ptr + 3];
      ptr += 4;
      const trackEnd = ptr + trackLength;

      let currentTicks = 0;
      let runningStatus = 0;

      while (ptr < trackEnd && ptr < bytes.length) {
        let deltaTime = 0;
        let b = 0;
        do {
          b = bytes[ptr++];
          deltaTime = (deltaTime << 7) | (b & 0x7F);
        } while (b & 0x80);

        currentTicks += deltaTime;

        let status = bytes[ptr];
        if (status < 0x80) {
          status = runningStatus;
        } else {
          ptr++;
          runningStatus = status;
        }

        const eventType = status >> 4;
        const channel = status & 0x0F;

        if (status === 0xFF) {
          const metaType = bytes[ptr++];
          let metaLen = 0;
          let mb = 0;
          do {
            mb = bytes[ptr++];
            metaLen = (metaLen << 7) | (mb & 0x7F);
          } while (mb & 0x80);

          if (metaType === 0x51 && metaLen === 3) {
            usPerQuarter = (bytes[ptr] << 16) | (bytes[ptr + 1] << 8) | bytes[ptr + 2];
          }
          ptr += metaLen;
        } else if (status === 0xF0 || status === 0xF7) {
          let sysexLen = 0;
          let sb = 0;
          do {
            sb = bytes[ptr++];
            sysexLen = (sysexLen << 7) | (sb & 0x7F);
          } while (sb & 0x80);
          ptr += sysexLen;
        } else if (eventType === 0x9) {
          const note = bytes[ptr++];
          const velocity = bytes[ptr++];
          allTracksEvents.push({
            track: t,
            ticks: currentTicks,
            type: velocity > 0 ? 'noteOn' : 'noteOff',
            channel,
            note,
            velocity
          });
        } else if (eventType === 0x8) {
          const note = bytes[ptr++];
          const velocity = bytes[ptr++];
          allTracksEvents.push({
            track: t,
            ticks: currentTicks,
            type: 'noteOff',
            channel,
            note,
            velocity
          });
        } else if (eventType === 0xC) {
          const program = bytes[ptr++];
          allTracksEvents.push({
            track: t,
            ticks: currentTicks,
            type: 'programChange',
            channel,
            program
          });
        } else {
          if (eventType === 0xA || eventType === 0xB || eventType === 0xE) {
            ptr += 2;
          }
        }
      }
      ptr = trackEnd;
    }

    allTracksEvents.sort((a, b) => a.ticks - b.ticks);

    const secondsPerTick = (usPerQuarter / 1000000) / ticksPerQuarter;
    this.midiEvents = allTracksEvents.map(e => ({
      ...e,
      time: e.ticks * secondsPerTick
    }));

    if (this.midiEvents.length > 0) {
      this.midiDuration = this.midiEvents[this.midiEvents.length - 1].time + 1.5;
    }
  }

  /**
   * Lookahead Scheduler Berbasis Hardware Audio Clock (Sample-Accurate Timing)
   * Mengeliminasi jitter setTimeout dan menjadikan pemutaran mulus 100%
   */
  playMidiEvents(startFromTime = 0) {
    this.stopMidi();
    this.ensureAudioContext();

    this.midiCurrentTime = Math.max(0, startFromTime);
    this.playbackStartAudioCtxTime = this.audioCtx.currentTime;
    this.playbackStartOffset = this.midiCurrentTime;
    this.isPlaying = true;
    if (this.onPlayStateChange) this.onPlayStateChange(true);

    // Cari index event pertama yang >= posisi saat ini
    this.nextMidiEventIndex = 0;
    while (
      this.nextMidiEventIndex < this.midiEvents.length &&
      this.midiEvents[this.nextMidiEventIndex].time < this.midiCurrentTime
    ) {
      this.nextMidiEventIndex++;
    }

    // Web Audio Lookahead Engine (Presisi Hardware Zero-Jitter)
    const scheduleAheadTime = 0.20; // Jadwalkan 200ms ke depan langsung ke hardware audio thread
    const lookaheadIntervalMs = 25; // Loop scheduler per 25ms

    const scheduleTick = () => {
      if (!this.isPlaying || !this.isMidi || !this.audioCtx) return;

      const currentCtxTime = this.audioCtx.currentTime;
      const songPlayTime = (currentCtxTime - this.playbackStartAudioCtxTime) + this.playbackStartOffset;
      this.midiCurrentTime = songPlayTime;

      const scheduleUntilSongTime = songPlayTime + scheduleAheadTime;

      while (
        this.nextMidiEventIndex < this.midiEvents.length &&
        this.midiEvents[this.nextMidiEventIndex].time <= scheduleUntilSongTime
      ) {
        const evt = this.midiEvents[this.nextMidiEventIndex];
        const eventOffset = evt.time - this.playbackStartOffset;
        const targetCtxTime = Math.max(currentCtxTime, this.playbackStartAudioCtxTime + eventOffset);

        this.executeScheduledMidiEvent(evt, targetCtxTime);
        this.nextMidiEventIndex++;
      }

      // Cek apakah lagu telah selesai
      if (songPlayTime >= this.midiDuration) {
        this.stopMidi();
        this.isPlaying = false;
        if (this.onPlayStateChange) this.onPlayStateChange(false);
        if (this.onEnded) this.onEnded();
      }
    };

    scheduleTick();
    this.midiSchedulerTimer = setInterval(scheduleTick, lookaheadIntervalMs);

    // Update progress bar UI secara mulus
    this.midiProgressTimer = setInterval(() => {
      if (!this.isPlaying || !this.isMidi) return;
      if (this.onTimeUpdate) {
        this.onTimeUpdate({
          currentTime: Math.min(this.midiCurrentTime, this.midiDuration),
          duration: this.midiDuration,
          progress: Math.min(100, (this.midiCurrentTime / (this.midiDuration || 1)) * 100)
        });
      }
    }, 100);
  }

  executeScheduledMidiEvent(evt, exactTime) {
    const transposedNote = Math.max(21, Math.min(108, evt.note + this.currentSemitones));
    if (evt.type === 'noteOn' && evt.velocity > 0) {
      this.triggerMidiVoice(transposedNote, evt.velocity, evt.track, evt.channel, exactTime);
    } else if (evt.type === 'noteOff' || (evt.type === 'noteOn' && evt.velocity === 0)) {
      this.releaseMidiVoice(transposedNote, evt.track, evt.channel, exactTime);
    }
  }

  /**
   * Pemicu Suara Sampel Asli SoundFont dengan Precise Audio Hardware Clock
   * Menghilangkan klik digital dan mengalirkan sinyal ke Reverb Bus & Master EQ
   */
  triggerMidiVoice(midiNote, velocity, trackIndex, channel, exactStartTime) {
    if (!this.audioCtx) return;

    const voices = this.getVoicesForEvent(this.currentInstrumentMode, channel, midiNote);
    if (!voices || voices.length === 0) return;

    const noteKey = midiNoteToKeyName(midiNote);
    const targetTime = Math.max(this.audioCtx.currentTime, exactStartTime || this.audioCtx.currentTime);
    const baseVel = Math.max(0.1, velocity / 127);

    for (const vConfig of voices) {
      const cacheKey = `${vConfig.inst}_${noteKey}`;
      const audioBuffer = this.audioBufferCache.get(cacheKey);

      // Cek apakah mode adalah Church Organ (Original / 19) atau Simfoni Upacara (-3)
      const isOriginalClassic = (
        this.currentInstrumentMode === 'original' ||
        this.currentInstrumentMode === '19' ||
        this.currentInstrumentMode === '-3' ||
        vConfig.inst === 'church_organ'
      );

      if (audioBuffer) {
        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;

        const gain = this.audioCtx.createGain();
        const voiceGain = baseVel * (vConfig.vol || 1.0) * 0.85;

        if (isOriginalClassic) {
          // Versi Asli: Attack instan dan tegas, tanpa jeda ramp
          gain.gain.setValueAtTime(voiceGain, targetTime);
          source.connect(gain);
          // Langsung ke EQ tanpa gema buatan (reverb) agar suara organ & brass simfoni tetap jernih dan berwibawa
          gain.connect(this.eqLow);
        } else {
          // Mode lainnya: Soft attack 5ms & Ambience Hall Reverb
          gain.gain.setValueAtTime(0.0001, targetTime);
          gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, voiceGain), targetTime + 0.005);
          source.connect(gain);

          if (this.dryGain) gain.connect(this.dryGain);
          else gain.connect(this.eqLow);

          if (this.reverbSendGain) gain.connect(this.reverbSendGain);
        }

        source.start(targetTime);

        this.activeMidiVoices.push({
          note: midiNote,
          track: trackIndex,
          channel: channel,
          inst: vConfig.inst,
          isBuffer: true,
          isOriginalClassic,
          source,
          gain,
          voiceGain,
          targetTime
        });
      } else {
        // Fallback cepat jika sampel belum siap di cache (synthesizer lembut)
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, targetTime);

        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3000, targetTime);

        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(0.0001, targetTime);
        gain.gain.exponentialRampToValueAtTime(baseVel * 0.22, targetTime + 0.02);

        osc.connect(filter);
        filter.connect(gain);

        if (isOriginalClassic) {
          gain.connect(this.eqLow);
        } else {
          if (this.dryGain) gain.connect(this.dryGain);
          else gain.connect(this.eqLow);
          if (this.reverbSendGain) gain.connect(this.reverbSendGain);
        }

        osc.start(targetTime);

        this.activeMidiVoices.push({
          note: midiNote,
          track: trackIndex,
          channel: channel,
          inst: vConfig.inst,
          isBuffer: false,
          isOriginalClassic,
          osc,
          gain,
          voiceGain: baseVel * 0.22,
          targetTime
        });
      }
    }
  }

  releaseMidiVoice(midiNote, trackIndex, channel, exactStopTime) {
    if (!this.audioCtx) return;
    const targetStop = Math.max(this.audioCtx.currentTime, exactStopTime || this.audioCtx.currentTime);

    for (let i = this.activeMidiVoices.length - 1; i >= 0; i--) {
      const v = this.activeMidiVoices[i];
      if (v.note === midiNote && v.track === trackIndex && (channel === undefined || v.channel === channel)) {
        if (v.isBuffer) {
          try {
            v.gain.gain.cancelScheduledValues(targetStop);
            v.gain.gain.setValueAtTime(Math.max(0.001, v.voiceGain || 0.5), targetStop);
            if (v.isOriginalClassic) {
              // Persis seperti versi sebelumnya: pelepasan 0.15 detik yang tegas & bersih
              v.gain.gain.exponentialRampToValueAtTime(0.0001, targetStop + 0.15);
              v.source.stop(targetStop + 0.18);
            } else {
              // Mode orkestra lainnya: pelepasan lembut 0.20 detik
              v.gain.gain.exponentialRampToValueAtTime(0.0001, targetStop + 0.20);
              v.source.stop(targetStop + 0.22);
            }
          } catch (e) {}
        } else {
          try {
            v.gain.gain.cancelScheduledValues(targetStop);
            v.gain.gain.setValueAtTime(Math.max(0.001, v.voiceGain || 0.2), targetStop);
            v.gain.gain.exponentialRampToValueAtTime(0.0001, targetStop + 0.12);
            v.osc.stop(targetStop + 0.14);
          } catch (e) {}
        }
        this.activeMidiVoices.splice(i, 1);
      }
    }
  }

  pauseMidi() {
    if (this.midiSchedulerTimer) clearInterval(this.midiSchedulerTimer);
    if (this.midiProgressTimer) clearInterval(this.midiProgressTimer);
    this.midiSchedulerTimer = null;
    this.midiProgressTimer = null;
    this.silenceActiveVoices();
  }

  resumeMidi() {
    this.playMidiEvents(this.midiCurrentTime);
  }

  seekMidi(seconds) {
    this.playMidiEvents(seconds);
  }

  stopMidi() {
    if (this.midiSchedulerTimer) clearInterval(this.midiSchedulerTimer);
    if (this.midiProgressTimer) clearInterval(this.midiProgressTimer);
    this.midiSchedulerTimer = null;
    this.midiProgressTimer = null;
    this.silenceActiveVoices();
    this.midiCurrentTime = 0;
    this.nextMidiEventIndex = 0;
  }

  silenceActiveVoices() {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    this.activeMidiVoices.forEach(v => {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(0.0001, now);
        if (v.isBuffer) v.source.stop(now + 0.02);
        else v.osc.stop(now + 0.02);
      } catch (e) {}
    });
    this.activeMidiVoices = [];
  }

  // ==========================================
  // Visualizer Analyser Data
  // ==========================================
  getVisualizerData() {
    if (!this.analyser) return new Uint8Array(0);
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }
}

// Inisialisasi Singleton Audio Engine Global
window.ceremonyAudio = new CeremonyAudioEngine();
