/**
 * sw.js - Service Worker Upacara Player (Auto-Update UI & Offline PWA)
 * Strategi: Network-First dengan Offline Cache Fallback untuk aset antarmuka.
 * Lagu offline tersimpan persisten di IndexedDB dan TIDAK PERNAH terhapus saat pembaruan tampilan.
 */

const CACHE_NAME = 'upacara-ui-v16';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css?v=16',
  './app.js?v=16',
  './audio-engine.js?v=16',
  './db.js?v=16',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Mengunduh aset antarmuka UI terbaru...');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  // Otomatis bersihkan cache UI versi lama agar tampilan selalu segar
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Membersihkan cache UI lama:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Jangan cache file audio melalui service worker (audio sudah disimpan persisten di IndexedDB)
  if (url.includes('.mp3') || url.includes('.mid') || url.includes('.wav') || url.includes('.ogg')) {
    return;
  }

  // Network-First untuk semua aset tampilan (HTML, CSS, JS)
  // Saat Online: Selalu ambil versi terbaru dari GitHub Pages dan perbarui cache otomatis di latar belakang.
  // Saat Offline: Buka dari cache lokal.
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.url.startsWith(self.location.origin)) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback jika tidak ada internet / offline
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
        });
      })
  );
});
