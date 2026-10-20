/**
 * app.js - Logika Utama Upacara Player
 * Integrasi Antarmuka List, Audio Engine, IndexedDB, dan Google Drive Downloader
 */

// State Aplikasi
const state = {
  songs: [],
  activeSongId: null,
  activeFilter: 'all',
  searchQuery: '',
  isOnline: navigator.onLine,
  currentVolume: 1.0,
  isMuted: false,
  isDownloadingBatch: false
};

// ==========================================
// Inisialisasi Aplikasi saat Dokumen Siap
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  initNetworkStatus();
  initEqualizerControls();
  initTransposeControls();
  initInstrumentChips();
  initNowPlayingControls();
  initModals();
  initVisualizer();
  registerServiceWorker();

  await loadInitialSongs();
  updateStorageStats();
});

// ==========================================
// Service Worker (PWA Offline Support)
// ==========================================
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('ServiceWorker registered:', reg.scope))
      .catch(err => console.log('ServiceWorker error:', err));
  }
}

// ==========================================
// Status Jaringan (Online / Offline Lapangan)
// ==========================================
function initNetworkStatus() {
  const badge = document.getElementById('networkBadge');
  const text = document.getElementById('networkText');

  function update() {
    state.isOnline = navigator.onLine;
    if (state.isOnline) {
      badge.className = 'badge-status online';
      text.textContent = 'Online';
    } else {
      badge.className = 'badge-status offline';
      text.textContent = 'Mode Lapangan (Offline)';
    }
  }

  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// ==========================================
// Sumber Katalog Lagu (Lokal songs.json atau GitHub Repo CDN)
// ==========================================
const DEFAULT_SONG_SOURCE = 'https://cdn.jsdelivr.net/gh/emanuelkhusus-hash/upacarasong@main/songs.json';
const FALLBACK_SONG_SOURCE = 'https://emanuelkhusus-hash.github.io/upacarasong/songs.json';

function normalizeCatalogUrl(url) {
  if (!url) return DEFAULT_SONG_SOURCE;
  let u = url.trim();
  if (u === '' || u === 'songs.json') return DEFAULT_SONG_SOURCE;

  // Jika dimasukkan link repo GitHub (e.g. https://github.com/owner/repo)
  const ghMatch = u.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)/i);
  if (ghMatch) {
    const owner = ghMatch[1];
    const repo = ghMatch[2].replace(/\.git$/, '');
    return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@main/songs.json`;
  }

  // Jika dimasukkan URL github.io (e.g. https://owner.github.io/repo atau https://owner.github.io/repo/)
  const ioMatch = u.match(/^https?:\/\/([^\/]+)\.github\.io\/([^\/]+)\/?$/i);
  if (ioMatch) {
    const owner = ioMatch[1];
    const repo = ioMatch[2];
    return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@main/songs.json`;
  }

  // Jika belum berakhiran .json
  if (!u.endsWith('.json')) {
    u = u.endsWith('/') ? `${u}songs.json` : `${u}/songs.json`;
  }
  return u;
}

function getCatalogSourceUrl() {
  const saved = localStorage.getItem('upacara_song_source_url');
  return saved ? normalizeCatalogUrl(saved) : DEFAULT_SONG_SOURCE;
}

function setCatalogSourceUrl(url) {
  if (!url || url.trim() === '' || url.trim() === DEFAULT_SONG_SOURCE) {
    localStorage.removeItem('upacara_song_source_url');
  } else {
    const cleanUrl = normalizeCatalogUrl(url);
    localStorage.setItem('upacara_song_source_url', cleanUrl);
  }
}

// ==========================================
// Muat & Segarkan Katalog Lagu (songs.json + IndexedDB)
// ==========================================
async function reloadSongsList(isManual = false) {
  const btn = document.getElementById('btnReloadSongs');
  if (btn) {
    btn.classList.add('loading');
    btn.disabled = true;
  }

  try {
    const sourceUrl = getCatalogSourceUrl();
    const sep = sourceUrl.includes('?') ? '&' : '?';
    let res;
    
    try {
      // Gunakan timestamp cache-buster dan header no-cache agar selalu membaca perubahan terbaru
      res = await fetch(`${sourceUrl}${sep}nocache=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
      });
    } catch (fetchErr) {
      // Fallback otomatis jika CDN utama terkena batasan/jaringan
      if (sourceUrl === DEFAULT_SONG_SOURCE) {
        console.warn('Gagal mengakses CDN jsDelivr, mencoba fallback ke GitHub Pages:', fetchErr);
        res = await fetch(`${FALLBACK_SONG_SOURCE}?nocache=${Date.now()}`, {
          cache: 'no-store'
        });
      } else {
        throw fetchErr;
      }
    }

    if (res.ok) {
      const data = await res.json();
      const rawSongs = data.songs || [];

      // Resolusi relative directUrl terhadap sourceUrl jika dimuat dari CDN/GitHub eksternal
      state.songs = rawSongs.map(s => {
        let finalUrl = s.directUrl;
        if (finalUrl && !finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
          if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
            const baseUrl = sourceUrl.substring(0, sourceUrl.lastIndexOf('/') + 1);
            try {
              finalUrl = new URL(finalUrl, baseUrl).href;
            } catch (e) {}
          }
        }
        return {
          ...s,
          directUrl: finalUrl
        };
      });
    } else {
      throw new Error(`Status HTTP ${res.status}`);
    }

    // Sinkronisasi status offline (isCached) untuk tiap lagu
    const cachedIds = await window.audioDB.getAllCachedIds();
    state.songs.forEach(s => {
      s.isCached = cachedIds.includes(s.id);
    });

    renderSongsList();
    await updateStorageStats();

    if (isManual) {
      showToast(`✓ Daftar lagu berhasil disegarkan! (${state.songs.length} lagu tersedia)`);
    }
  } catch (err) {
    console.warn('Gagal membaca songs.json:', err);
    if (isManual) {
      showToast(`⚠️ Gagal me-reload songs.json: ${err.message}`, true);
    }
  } finally {
    if (btn) {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }
}

async function loadInitialSongs() {
  await reloadSongsList(false);
}

// ==========================================
// Render Daftar Lagu (Tampilan List Bersih)
// ==========================================
function renderSongsList() {
  const container = document.getElementById('songsListContainer');
  container.innerHTML = '';

  const filtered = state.songs.filter(song => {
    // Filter Kategori
    if (state.activeFilter === 'offline' && !song.isCached) return false;
    if (state.activeFilter !== 'all' && state.activeFilter !== 'offline' && song.category !== state.activeFilter) {
      return false;
    }
    // Filter Pencarian
    if (state.searchQuery.trim() !== '') {
      const q = state.searchQuery.toLowerCase();
      const matchTitle = song.title.toLowerCase().includes(q);
      const matchCat = (song.category || '').toLowerCase().includes(q);
      return matchTitle || matchCat;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="loading-state">
        <p>Tidak ada lagu yang sesuai dengan pencarian / kategori.</p>
      </div>
    `;
    return;
  }

  filtered.forEach((song, index) => {
    const item = document.createElement('div');
    const isPlayingThis = (state.activeSongId === song.id && window.ceremonyAudio.isPlaying);
    item.className = `song-list-item ${isPlayingThis ? 'active-playing' : ''}`;
    item.id = `songItem_${song.id}`;

    // Status offline badge
    let badgeHtml = '';
    if (song.isCached) {
      badgeHtml = `<span class="badge-tag tag-offline">✓ Siap Offline</span>`;
    } else if (song.isDownloading) {
      badgeHtml = `<span class="badge-tag tag-loading">Mengunduh...</span>`;
    } else {
      badgeHtml = `<span class="badge-tag tag-cloud">Belum Diunduh</span>`;
    }

    item.innerHTML = `
      <div class="song-item-info">
        <div class="song-item-index">${index + 1}</div>
        <div class="song-item-text">
          <div class="song-item-title-row">
            <h3 class="song-item-title">${escapeHtml(song.title)}</h3>
            <span class="song-format-badge ${song.isMidi ? 'midi' : 'audio'}">${song.isMidi ? 'MIDI' : 'MP3'}</span>
          </div>
          <div class="song-item-meta">
            <span class="song-item-cat">${escapeHtml(song.category || 'Umum')}</span>
            <span id="badge_${song.id}" class="badge-slot">${badgeHtml}</span>
          </div>
        </div>
      </div>

      <div class="song-item-actions">
        ${isPlayingThis ? `
          <button class="btn-item-ctrl btn-pause" onclick="handleCardPause('${song.id}')" title="Jeda">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            <span>Pause</span>
          </button>
          <button class="btn-item-ctrl btn-stop" onclick="handleCardStop('${song.id}')" title="Stop">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
            <span>Stop</span>
          </button>
        ` : (state.activeSongId === song.id ? `
          <button class="btn-item-ctrl btn-play active" onclick="handleCardPlay('${song.id}')" title="Lanjutkan">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <span>Lanjut</span>
          </button>
          <button class="btn-item-ctrl btn-stop" onclick="handleCardStop('${song.id}')" title="Stop">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
            <span>Stop</span>
          </button>
        ` : `
          <button class="btn-item-ctrl btn-play" onclick="handleCardPlay('${song.id}')" title="Putar Lagu Ini">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <span>Putar</span>
          </button>

          ${!song.isCached ? `
            <button class="btn-item-ctrl btn-dl" onclick="downloadSingleSong('${song.id}')" title="Unduh untuk pemakaian offline">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
              <span class="dl-text">Unduh</span>
            </button>
          ` : `
            <button class="btn-item-ctrl btn-cached" onclick="deleteSongCache('${song.id}')" title="Hapus dari cache perangkat">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          `}
        `)}
      </div>
    `;

    container.appendChild(item);
  });
}

// ==========================================
// Kontrol Playback Lagu
// ==========================================
async function handleCardPlay(songId) {
  const song = state.songs.find(s => s.id === songId);
  if (!song) return;

  // Jika lagu yang sama sedang dipause, lanjutkan resume
  if (state.activeSongId === song.id && !window.ceremonyAudio.isPlaying) {
    window.ceremonyAudio.resume();
    updatePlaybackStateUI(true);
    return;
  }

  // Cek apakah audio sudah ada di IndexedDB
  let audioBlob = await window.audioDB.getAudio(song.id);

  if (!audioBlob) {
    // Jika belum ada di cache, unduh dulu
    updateSongBadgeUI(song.id, 'loading');
    const downloadSuccess = await downloadSingleSong(song.id, true);
    if (downloadSuccess) {
      audioBlob = await window.audioDB.getAudio(song.id);
    }
  }

  try {
    state.activeSongId = song.id;

    if (audioBlob) {
      if (song.isMidi) {
        await window.ceremonyAudio.playMidiBlob(audioBlob, song);
      } else {
        await window.ceremonyAudio.playAudioBlob(audioBlob, song);
      }
    } else {
      // Fallback streaming langsung (dari directUrl repositori atau Google Drive)
      let streamUrl = song.directUrl;
      if (!streamUrl && song.driveId) {
        streamUrl = getGoogleDriveDownloadUrl(song.driveId);
      }
      if (song.isMidi) {
        alert('File MIDI perlu diunduh terlebih dahulu agar dapat disintesis. Silakan klik tombol "Unduh".');
        return;
      }
      if (streamUrl) {
        await window.ceremonyAudio.playAudioUrl(streamUrl, song);
      } else {
        alert('Link audio belum tersedia untuk lagu ini.');
        return;
      }
    }

    updateNowPlayingUI(song);
    updatePlaybackStateUI(true);
    renderSongsList(); // refresh active highlight
  } catch (err) {
    console.error('Gagal memutar audio:', err);
    alert('Terjadi kendala saat memutar file audio: ' + err.message);
  }
}

function handleCardPause(songId) {
  if (state.activeSongId === songId) {
    window.ceremonyAudio.pause();
    updatePlaybackStateUI(false);
    renderSongsList();
  }
}

function handleCardStop(songId) {
  window.ceremonyAudio.stopAll();
  state.activeSongId = null;
  updatePlaybackStateUI(false);
  resetTimeline();
  resetNowPlayingDock();
  renderSongsList();
}

// ==========================================
// Downloader Google Drive & URL Langsung
// Menggunakan drive.usercontent.google.com dengan header CORS bebas
// ==========================================

function getGoogleDriveDownloadUrl(driveId) {
  return `https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=t`;
}

/**
 * Unduh satu lagu dan simpan ke IndexedDB
 */
async function downloadSingleSong(songId, silent = false) {
  const song = state.songs.find(s => s.id === songId);
  if (!song) return false;

  song.isDownloading = true;
  updateSongBadgeUI(song.id, 'loading');

  const candidates = [];
  if (song.directUrl) candidates.push(song.directUrl);
  if (song.driveId) {
    const gdriveUrl = `https://drive.usercontent.google.com/download?id=${song.driveId}&export=download&confirm=t`;
    candidates.push(gdriveUrl);
    candidates.push(`https://corsproxy.io/?url=${encodeURIComponent(gdriveUrl)}`);
    candidates.push(`https://api.allorigins.win/raw?url=${encodeURIComponent(gdriveUrl)}`);
  }

  let blob = null;

  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const fetched = await response.blob();
        if (fetched && fetched.size > 200) {
          blob = fetched;
          break;
        }
      }
    } catch (e) {
      // Coba kandidat berikutnya
    }
  }

  if (!blob || blob.size === 0) {
    song.isDownloading = false;
    updateSongBadgeUI(song.id, 'cloud');
    if (!silent) {
      alert(`Gagal mengunduh "${song.title}".\nPastikan koneksi internet aktif dan link Google Drive dapat diakses publik.`);
    }
    return false;
  }

  try {
    const mime = song.isMidi ? 'audio/midi' : (blob.type || 'audio/mpeg');
    await window.audioDB.saveAudio(song.id, blob, mime, song.title);
    song.isCached = true;
    song.isDownloading = false;

    updateSongBadgeUI(song.id, 'offline');
    updateStorageStats();
    renderSongsList();

    if (!silent) {
      console.log(`Lagu "${song.title}" berhasil diunduh dan disimpan offline.`);
    }
    return true;
  } catch (dbErr) {
    console.error('IndexedDB save error:', dbErr);
    song.isDownloading = false;
    updateSongBadgeUI(song.id, 'cloud');
    return false;
  }
}

/**
 * Unduh Semua Lagu (Batch Downloader)
 */
async function downloadAllSongs() {
  if (state.isDownloadingBatch) return;

  const toDownload = state.songs.filter(s => !s.isCached && (s.driveId || s.directUrl));
  if (toDownload.length === 0) {
    alert('Semua lagu sudah tersimpan offline di perangkat Anda!');
    return;
  }

  state.isDownloadingBatch = true;
  const progressCard = document.getElementById('batchProgressCard');
  const progressText = document.getElementById('batchProgressText');
  const progressPercent = document.getElementById('batchProgressPercent');
  const progressBarFill = document.getElementById('batchProgressBarFill');

  progressCard.style.display = 'block';

  let completed = 0;
  for (let i = 0; i < toDownload.length; i++) {
    const s = toDownload[i];
    const pct = Math.round((completed / toDownload.length) * 100);
    progressText.textContent = `Mengunduh (${i + 1}/${toDownload.length}): ${s.title}...`;
    progressPercent.textContent = `${pct}%`;
    progressBarFill.style.width = `${pct}%`;

    await downloadSingleSong(s.id, true);
    completed++;
  }

  progressBarFill.style.width = '100%';
  progressPercent.textContent = '100%';
  progressText.textContent = 'Semua lagu berhasil disimpan offline!';

  setTimeout(() => {
    progressCard.style.display = 'none';
    state.isDownloadingBatch = false;
    updateStorageStats();
    renderSongsList();
  }, 1500);
}

async function deleteSongCache(songId) {
  const song = state.songs.find(s => s.id === songId);
  const songName = song ? song.title : 'lagu';
  if (confirm(`Hapus cache offline untuk "${songName}"?`)) {
    await window.audioDB.deleteAudio(songId);
    if (song) song.isCached = false;
    updateStorageStats();
    renderSongsList();
  }
}

function updateSongBadgeUI(songId, status) {
  const badgeWrap = document.getElementById(`badge_${songId}`);
  if (!badgeWrap) return;
  if (status === 'offline') {
    badgeWrap.innerHTML = `<span class="badge-tag tag-offline">✓ Siap Offline</span>`;
  } else if (status === 'loading') {
    badgeWrap.innerHTML = `<span class="badge-tag tag-loading">Mengunduh...</span>`;
  } else {
    badgeWrap.innerHTML = `<span class="badge-tag tag-cloud">Belum Diunduh</span>`;
  }
}

async function updateStorageStats() {
  const stats = await window.audioDB.getStorageStats();
  document.getElementById('storageText').textContent = `${stats.count} Lagu (${stats.formatted})`;
}

// ==========================================
// Equalizer UI Controls (Kompatibel KoorSMK)
// Slider: 0..2000, 1000 = 0 dB (rentang -15 s.d. +15 dB)
// ==========================================
function initEqualizerControls() {
  const sbLow = document.getElementById('sbEqLow');
  const sbMid = document.getElementById('sbEqMid');
  const sbHigh = document.getElementById('sbEqHigh');
  const btnReset = document.getElementById('btnEqReset');

  function sliderToDb(progress) {
    return ((progress - 1000) * 15.0) / 1000.0;
  }

  function formatDb(db) {
    if (db > 0) return `+${db.toFixed(1)} dB`;
    if (db < 0) return `${db.toFixed(1)} dB`;
    return '0 dB';
  }

  sbLow.addEventListener('input', (e) => {
    const db = sliderToDb(parseInt(e.target.value));
    document.getElementById('tvEqLowVal').textContent = formatDb(db);
    window.ceremonyAudio.setEqGain('low', db);
  });

  sbMid.addEventListener('input', (e) => {
    const db = sliderToDb(parseInt(e.target.value));
    document.getElementById('tvEqMidVal').textContent = formatDb(db);
    window.ceremonyAudio.setEqGain('mid', db);
  });

  sbHigh.addEventListener('input', (e) => {
    const db = sliderToDb(parseInt(e.target.value));
    document.getElementById('tvEqHighVal').textContent = formatDb(db);
    window.ceremonyAudio.setEqGain('high', db);
  });

  btnReset.addEventListener('click', () => {
    sbLow.value = 1000;
    sbMid.value = 1000;
    sbHigh.value = 1000;
    document.getElementById('tvEqLowVal').textContent = '0 dB';
    document.getElementById('tvEqMidVal').textContent = '0 dB';
    document.getElementById('tvEqHighVal').textContent = '0 dB';
    window.ceremonyAudio.resetEqualizer();
  });
}

// ==========================================
// Transpose Controls (Kompatibel KoorSMK)
// ==========================================
function initTransposeControls() {
  let semitones = 0;
  const tvLabel = document.getElementById('tvPitchLabel');
  const tvDetail = document.getElementById('tvPitchDetail');
  const btnMinus = document.getElementById('btnMinus');
  const btnPlus = document.getElementById('btnPlus');
  const btnReset = document.getElementById('btnTransposeReset');

  function updateTransposeUI() {
    const result = window.ceremonyAudio.setTranspose(semitones);
    const sign = semitones > 0 ? '+' : '';
    tvLabel.textContent = `Transpose: ${sign}${semitones}`;

    if (semitones === 0) {
      tvDetail.textContent = 'Nada Asli (Pitch 1.00x)';
    } else {
      tvDetail.textContent = `Rasio Pitch: ${result.pitchRatio.toFixed(2)}x`;
    }
  }

  btnMinus.addEventListener('click', () => {
    semitones--;
    updateTransposeUI();
  });

  btnPlus.addEventListener('click', () => {
    semitones++;
    updateTransposeUI();
  });

  btnReset.addEventListener('click', () => {
    semitones = 0;
    updateTransposeUI();
  });
}

// ==========================================
// Instrumen MIDI Chips (Kompatibel KoorSMK)
// ==========================================
function initInstrumentChips() {
  const container = document.getElementById('instrumentChips');
  const label = document.getElementById('activeInstrumentLabel');
  const chips = container.querySelectorAll('.chip');

  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const mode = chip.dataset.mode;
      const text = chip.textContent.trim();
      label.textContent = `Mode: ${text}`;
      window.ceremonyAudio.setInstrumentMode(mode);
    });
  });
}

// ==========================================
// Now Playing Dock & Master Controls
// ==========================================
function initNowPlayingControls() {
  const disc = document.getElementById('trackDisc');
  const masterSeekbar = document.getElementById('masterSeekbar');
  const masterVolume = document.getElementById('masterVolume');
  const btnMute = document.getElementById('btnMute');
  const btnMasterStop = document.getElementById('btnMasterStop');
  const btnDownloadAll = document.getElementById('btnDownloadAll');

  // Master Stop
  btnMasterStop.addEventListener('click', () => {
    window.ceremonyAudio.stopAll();
    state.activeSongId = null;
    updatePlaybackStateUI(false);
    resetTimeline();
    resetNowPlayingDock();
    renderSongsList();
  });

  // Master Seek
  masterSeekbar.addEventListener('input', (e) => {
    const pct = parseFloat(e.target.value);
    const duration = window.ceremonyAudio.isMidi
      ? window.ceremonyAudio.midiDuration
      : (window.ceremonyAudio.audioElement.duration || 0);
    if (duration > 0) {
      const seekTime = (pct / 100) * duration;
      window.ceremonyAudio.seek(seekTime);
    }
  });

  // Volume
  masterVolume.addEventListener('input', (e) => {
    state.currentVolume = parseFloat(e.target.value);
    window.ceremonyAudio.setVolume(state.currentVolume);
    updateVolumeIcon(state.currentVolume);
  });

  // Mute / Unmute
  btnMute.addEventListener('click', () => {
    state.isMuted = !state.isMuted;
    if (state.isMuted) {
      window.ceremonyAudio.setVolume(0);
      masterVolume.value = 0;
      updateVolumeIcon(0);
    } else {
      window.ceremonyAudio.setVolume(state.currentVolume);
      masterVolume.value = state.currentVolume;
      updateVolumeIcon(state.currentVolume);
    }
  });

  // Batch download button
  btnDownloadAll.addEventListener('click', downloadAllSongs);

  // Reload songs list button
  const btnReloadSongs = document.getElementById('btnReloadSongs');
  if (btnReloadSongs) {
    btnReloadSongs.addEventListener('click', () => {
      reloadSongsList(true);
    });
  }

  // Search & Filter Tabs
  const inputSearch = document.getElementById('inputSearch');
  const btnClearSearch = document.getElementById('btnClearSearch');
  const catTabs = document.querySelectorAll('.filter-tab');

  inputSearch.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    btnClearSearch.style.display = state.searchQuery ? 'block' : 'none';
    renderSongsList();
  });

  btnClearSearch.addEventListener('click', () => {
    inputSearch.value = '';
    state.searchQuery = '';
    btnClearSearch.style.display = 'none';
    renderSongsList();
  });

  catTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      catTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeFilter = tab.dataset.cat;
      renderSongsList();
    });
  });

  // Callback dari audio engine saat waktu lagu berganti
  window.ceremonyAudio.onTimeUpdate = ({ currentTime, duration, progress }) => {
    document.getElementById('tvPlaybackCurrent').textContent = formatTime(currentTime);
    document.getElementById('tvPlaybackDuration').textContent = formatTime(duration);
    masterSeekbar.value = progress;
  };

  // Callback saat lagu selesai
  window.ceremonyAudio.onEnded = () => {
    state.activeSongId = null;
    updatePlaybackStateUI(false);
    resetTimeline();
    resetNowPlayingDock();
    renderSongsList();
  };

  // Callback perubahan status play/pause
  window.ceremonyAudio.onPlayStateChange = (isPlaying) => {
    updatePlaybackStateUI(isPlaying);
  };
}

function updatePlaybackStateUI(isPlaying) {
  const disc = document.getElementById('trackDisc');
  if (isPlaying) {
    disc.classList.add('spinning');
  } else {
    disc.classList.remove('spinning');
  }

  // Highlight list item aktif
  document.querySelectorAll('.song-list-item').forEach(item => {
    const isThisItem = item.id === `songItem_${state.activeSongId}`;
    if (isThisItem && isPlaying) {
      item.classList.add('active-playing');
    } else {
      item.classList.remove('active-playing');
    }
  });
}

function updateNowPlayingUI(song) {
  document.getElementById('npSongTitle').textContent = song.title;
  document.getElementById('npSongSubtitle').textContent = `${song.category || 'Umum'} • Mode: ${song.isMidi ? 'MIDI' : 'Audio'}`;
}

function resetTimeline() {
  document.getElementById('tvPlaybackCurrent').textContent = '00:00';
  document.getElementById('masterSeekbar').value = 0;
}

function resetNowPlayingDock() {
  const title = document.getElementById('npSongTitle');
  const sub = document.getElementById('npSongSubtitle');
  if (title) title.textContent = 'Pilih lagu untuk memulai upacara';
  if (sub) sub.textContent = 'Siap memutar audio dengan kualitas jernih';
}

function updateVolumeIcon(vol) {
  const icon = document.getElementById('iconVolume');
  if (vol === 0) {
    icon.innerHTML = `<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>`;
  } else if (vol < 0.5) {
    icon.innerHTML = `<path d="M7 9v6h4l5 5V4L11 9H7z"/>`;
  } else {
    icon.innerHTML = `<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>`;
  }
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ==========================================
// Visualizer Audio Canvas
// ==========================================
function initVisualizer() {
  const canvas = document.getElementById('visualizerCanvas');
  const ctx = canvas.getContext('2d');

  function draw() {
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!window.ceremonyAudio.isPlaying) {
      // Garis datar saat tidak berputar
      ctx.fillStyle = 'rgba(56, 189, 248, 0.3)';
      ctx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
      return;
    }

    const data = window.ceremonyAudio.getVisualizerData();
    const barWidth = (canvas.width / 16) - 2;
    let x = 0;

    for (let i = 0; i < 16; i++) {
      const val = data[i * 2] || 0;
      const barHeight = Math.max(2, (val / 255) * canvas.height);
      const y = canvas.height - barHeight;

      // Gradasi warna cerah untuk visualisasi
      const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
      grad.addColorStop(0, '#2563EB');
      grad.addColorStop(1, '#38BDF8');

      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barWidth, barHeight);
      x += barWidth + 2;
    }
  }

  draw();
}

// ==========================================
// Modal Panduan & Storage Management
// ==========================================
function initModals() {
  const modalGuide = document.getElementById('modalGuide');
  const btnOpenGuide = document.getElementById('btnOpenGuide');
  const btnCloseGuide = document.getElementById('btnCloseGuide');
  const btnCloseGuideBtn = document.getElementById('btnCloseGuideBtn');
  const btnFooterGuide = document.getElementById('btnFooterGuide');

  if (btnOpenGuide) btnOpenGuide.addEventListener('click', () => { modalGuide.style.display = 'flex'; });
  if (btnFooterGuide) btnFooterGuide.addEventListener('click', () => { modalGuide.style.display = 'flex'; });
  if (btnCloseGuide) btnCloseGuide.addEventListener('click', () => { modalGuide.style.display = 'none'; });
  if (btnCloseGuideBtn) btnCloseGuideBtn.addEventListener('click', () => { modalGuide.style.display = 'none'; });

  // Clear Storage
  const btnClearStorage = document.getElementById('btnClearStorage');
  if (btnClearStorage) {
    btnClearStorage.addEventListener('click', async () => {
      if (confirm('Apakah Anda yakin ingin menghapus SELURUH audio offline yang tersimpan di browser ini?')) {
        await window.audioDB.clearAllCache();
        state.songs.forEach(s => { s.isCached = false; });
        updateStorageStats();
        renderSongsList();
        alert('Seluruh cache audio berhasil dibersihkan.');
      }
    });
  }

  // Modal Sumber Repositori Lagu
  const modalSongSource = document.getElementById('modalSongSource');
  const btnSongSource = document.getElementById('btnSongSource');
  const btnCloseSongSource = document.getElementById('btnCloseSongSource');
  const btnSaveSongSource = document.getElementById('btnSaveSongSource');
  const btnResetDefaultSource = document.getElementById('btnResetDefaultSource');
  const inputSourceUrl = document.getElementById('inputSourceUrl');
  const sourceStatusInfo = document.getElementById('sourceStatusInfo');

  function updateSourceModalInfo() {
    const cur = getCatalogSourceUrl();
    if (cur === DEFAULT_SONG_SOURCE || cur === FALLBACK_SONG_SOURCE) {
      inputSourceUrl.value = '';
      sourceStatusInfo.textContent = 'Status: Menggunakan sumber default (emanuelkhusus-hash/upacarasong)';
    } else {
      inputSourceUrl.value = cur;
      sourceStatusInfo.textContent = `Status: Terhubung ke repositori kustom (${cur})`;
    }
  }

  if (btnSongSource) {
    btnSongSource.addEventListener('click', () => {
      updateSourceModalInfo();
      modalSongSource.style.display = 'flex';
    });
  }

  if (btnCloseSongSource) {
    btnCloseSongSource.addEventListener('click', () => {
      modalSongSource.style.display = 'none';
    });
  }

  if (btnSaveSongSource) {
    btnSaveSongSource.addEventListener('click', async () => {
      const val = inputSourceUrl.value.trim();
      setCatalogSourceUrl(val);
      modalSongSource.style.display = 'none';
      showToast('✓ Sumber repositori lagu berhasil disimpan! Memuat ulang...', false);
      await reloadSongsList(true);
    });
  }

  if (btnResetDefaultSource) {
    btnResetDefaultSource.addEventListener('click', async () => {
      setCatalogSourceUrl('');
      inputSourceUrl.value = '';
      modalSongSource.style.display = 'none';
      showToast('✓ Dikembalikan ke sumber repositori default (upacarasong).', false);
      await reloadSongsList(true);
    });
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==========================================
// Floating Toast Notification
// ==========================================
function showToast(message, isError = false) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'app-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `app-toast ${isError ? 'toast-error' : ''}`;
  toast.innerHTML = `
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(15px)';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3200);
}
