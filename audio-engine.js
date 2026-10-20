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

    // Status state
    this.currentSemitones = 0;
    this.currentPitch = 1.0;
    this.currentInstrumentMode = 'original'; // original, 0, 19, 48, 56, -1, -2, -3, -4
    this.currentSong = null;
    this.currentBlobUrl = null;
    this.isPlaying = false;
    this.isMidi = false;

    // MIDI Synth State
    this.midiEvents = [];
    this.midiTimeouts = [];
    this.activeMidiVoices = [];
    this.midiDuration = 0;
    this.midiCurrentTime = 0;
    this.midiInterval = null;

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

    // Jika sedang memutar MIDI, re-trigger nada
    if (this.isPlaying && this.isMidi && this.currentSong) {
      const curTime = this.midiCurrentTime;
      this.stopMidi();
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
      // Periksa apakah script sudah ada
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
    // Muat instrumen upacara paling umum: Grand Piano, Strings, Trumpet, Marching Brass
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
        // Harmoni orkestra megah: perpaduan Strings luas dengan terompet/brass bertenaga
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
        // Karakter korps musik upacara lapangan: Terompet melodi tajam + Seksi Brass pengiring
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
        // Karakter simfoni megah klasik: French Horn berwibawa berpadu gesekan Strings
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

      const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer);
      this.audioBufferCache.set(cacheKey, audioBuffer);
      return audioBuffer;
    } catch (e) {
      console.warn(`Gagal decode sampel audio untuk ${cacheKey}:`, e);
      return null;
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
  // Parser & Pemutar MIDI dengan Sampel Nyata
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

  playMidiEvents(startFromTime = 0) {
    this.stopMidi();
    this.midiCurrentTime = startFromTime;
    this.isPlaying = true;
    if (this.onPlayStateChange) this.onPlayStateChange(true);

    this.midiEvents.forEach(evt => {
      if (evt.time >= startFromTime) {
        const delayMs = (evt.time - startFromTime) * 1000;
        const tid = setTimeout(() => {
          this.executeMidiEvent(evt);
        }, delayMs);
        this.midiTimeouts.push(tid);
      }
    });

    this.midiInterval = setInterval(() => {
      this.midiCurrentTime += 0.25;
      if (this.onTimeUpdate) {
        this.onTimeUpdate({
          currentTime: Math.min(this.midiCurrentTime, this.midiDuration),
          duration: this.midiDuration,
          progress: Math.min(100, (this.midiCurrentTime / (this.midiDuration || 1)) * 100)
        });
      }

      if (this.midiCurrentTime >= this.midiDuration) {
        this.stopMidi();
        this.isPlaying = false;
        if (this.onPlayStateChange) this.onPlayStateChange(false);
        if (this.onEnded) this.onEnded();
      }
    }, 250);
  }

  executeMidiEvent(evt) {
    if (evt.type === 'noteOn' && evt.velocity > 0) {
      const transposedNote = Math.max(21, Math.min(108, evt.note + this.currentSemitones));
      this.triggerMidiVoice(transposedNote, evt.velocity, evt.track, evt.channel);
    } else if (evt.type === 'noteOff' || (evt.type === 'noteOn' && evt.velocity === 0)) {
      const transposedNote = Math.max(21, Math.min(108, evt.note + this.currentSemitones));
      this.releaseMidiVoice(transposedNote, evt.track, evt.channel);
    }
  }

  /**
   * Pemicu Suara Sampel Asli SoundFont (Acoustic Grand Piano, Strings, Trumpet, Brass, French Horn, dll.)
   * Mendukung multi-voicing / dual layering untuk karakter Megah, Marching Brass, & Simfoni
   */
  async triggerMidiVoice(midiNote, velocity, trackIndex, channel) {
    if (!this.audioCtx) return;

    // Ambil daftar instrumen/suara untuk nada ini
    const voices = this.getVoicesForEvent(this.currentInstrumentMode, channel, midiNote);
    if (!voices || voices.length === 0) return;

    const noteKey = midiNoteToKeyName(midiNote);
    const now = this.audioCtx.currentTime;
    const baseVel = Math.max(0.1, velocity / 127);

    for (const vConfig of voices) {
      const audioBuffer = await this.getOrDecodeAudioBuffer(vConfig.inst, noteKey);
      if (audioBuffer) {
        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;

        const gain = this.audioCtx.createGain();
        const voiceGain = baseVel * (vConfig.vol || 1.0) * 0.85;
        gain.gain.setValueAtTime(voiceGain, now);

        source.connect(gain);
        gain.connect(this.eqLow); // Terhubung ke 3-Band Equalizer

        source.start(now);

        this.activeMidiVoices.push({
          note: midiNote,
          track: trackIndex,
          channel: channel,
          inst: vConfig.inst,
          isBuffer: true,
          source,
          gain
        });
      } else {
        // Fallback synthesizer jika sampel belum siap
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);

        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(3200, now);

        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(baseVel * 0.25, now + 0.05);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.eqLow);

        osc.start(now);

        this.activeMidiVoices.push({
          note: midiNote,
          track: trackIndex,
          channel: channel,
          inst: vConfig.inst,
          isBuffer: false,
          osc,
          gain
        });
      }
    }
  }

  releaseMidiVoice(midiNote, trackIndex, channel) {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;

    // Melepaskan seluruh suara (termasuk layer ganda) tanpa break prematur
    for (let i = this.activeMidiVoices.length - 1; i >= 0; i--) {
      const v = this.activeMidiVoices[i];
      if (v.note === midiNote && v.track === trackIndex && (channel === undefined || v.channel === channel)) {
        if (v.isBuffer) {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setValueAtTime(Math.max(0.001, v.gain.gain.value), now);
          v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
          try { v.source.stop(now + 0.18); } catch (e) {}
        } else {
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setValueAtTime(Math.max(0.001, v.gain.gain.value), now);
          v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
          try { v.osc.stop(now + 0.12); } catch (e) {}
        }
        this.activeMidiVoices.splice(i, 1);
      }
    }
  }

  pauseMidi() {
    this.midiTimeouts.forEach(t => clearTimeout(t));
    this.midiTimeouts = [];
    clearInterval(this.midiInterval);
    this.silenceActiveVoices();
  }

  resumeMidi() {
    this.playMidiEvents(this.midiCurrentTime);
  }

  seekMidi(seconds) {
    this.playMidiEvents(seconds);
  }

  stopMidi() {
    this.midiTimeouts.forEach(t => clearTimeout(t));
    this.midiTimeouts = [];
    clearInterval(this.midiInterval);
    this.silenceActiveVoices();
    this.midiCurrentTime = 0;
  }

  silenceActiveVoices() {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;
    this.activeMidiVoices.forEach(v => {
      try {
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

// Global instance
window.ceremonyAudio = new CeremonyAudioEngine();
