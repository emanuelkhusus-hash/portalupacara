/**
 * db.js - IndexedDB Manager untuk Upacara Player
 * Menyimpan audio blob (MP3 / MIDI) secara lokal dan persisten di browser.
 * Sekali diunduh, lagu akan selalu siap pakai tanpa perlu koneksi internet.
 */

const DB_NAME = 'UpacaraPlayerDB';
const DB_VERSION = 1;
const STORE_NAME = 'songs_cache';
const META_STORE = 'custom_songs';

class AudioDatabase {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Simpan Blob audio ke IndexedDB
   * @param {string} id ID unik lagu
   * @param {Blob} blob File biner audio
   * @param {string} mimeType Tipe audio
   * @param {string} fileName Nama file asli
   */
  async saveAudio(id, blob, mimeType = 'audio/mpeg', fileName = '') {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const record = {
        id,
        blob,
        mimeType,
        fileName,
        size: blob.size,
        savedAt: new Date().toISOString()
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Ambil Blob audio berdasarkan ID lagu
   * @param {string} id 
   * @returns {Promise<Blob|null>}
   */
  async getAudio(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          resolve(req.result.blob);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Cek apakah lagu sudah terunduh secara lokal
   * @param {string} id 
   * @returns {Promise<boolean>}
   */
  async isCached(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Hapus audio cache untuk satu lagu
   * @param {string} id 
   */
  async deleteAudio(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Dapatkan semua ID lagu yang tersimpan di cache lokal
   */
  async getAllCachedIds() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Hitung total kapasitas cache yang dipakai
   */
  async getStorageStats() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = req.result || [];
        let totalBytes = 0;
        records.forEach(r => { totalBytes += (r.size || 0); });
        resolve({
          count: records.length,
          totalBytes: totalBytes,
          formatted: (totalBytes / (1024 * 1024)).toFixed(2) + ' MB'
        });
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Simpan metadata custom song yang ditambahkan oleh pengguna
   */
  async saveCustomSong(song) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      const req = store.put(song);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Ambil semua metadata custom songs
   */
  async getCustomSongs() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(META_STORE, 'readonly');
      const store = tx.objectStore(META_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Hapus custom song metadata
   */
  async deleteCustomSong(id) {
    if (!this.db) await this.init();
    await this.deleteAudio(id);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Bersihkan semua audio cache
   */
  async clearAllCache() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
}

// Global instance
window.audioDB = new AudioDatabase();
