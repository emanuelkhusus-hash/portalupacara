# 🇮🇩 Upacara Player - Pengiring Upacara Bendera & Koor

Aplikasi web modern berbasis **PWA (Progressive Web App)** yang dirancang khusus untuk memutar dan mengiringi lagu-lagu upacara bendera serta paduan suara (koor) sekolah/instansi. Dapat dihosting gratis melalui **GitHub Pages**, mendukung lagu dari **Google Drive**, serta memiliki sistem **Offline Caching (IndexedDB)** sehingga bisa dipakai di lapangan upacara tanpa memerlukan koneksi internet.

Proyek ini dibangun dengan kompatibilitas penuh dari aplikasi Android **KoorSMK** (`E:\Sand_Box\Program Android\KoorSMK`).

---

## ✨ Fitur Utama & Kompatibilitas KoorSMK

| Fitur | KoorSMK (Android) | Upacara Player (Web) | Deskripsi |
|---|---|---|---|
| **Transpose Nada** | `btnMinus`, `btnPlus`, `currentSemitones` | **Transpose -12 s.d. +12** | Menggeser nada koor secara *real-time* dengan formula $2^{(\text{semitones}/12)}$ agar sesuai dengan jangkauan vokal paduan suara. |
| **Equalizer Suara** | `sbEqLow`, `sbEqMid`, `sbEqHigh` (-15dB s.d. +15dB) | **3-Band Biquad EQ + Reset** | Mengatur LOW (Bass 200Hz), MID (Vokal 1kHz), dan HIGH (Treble 3.5kHz) untuk menyesuaikan karakter speaker/corong lapangan. |
| **Preset Instrumen** | `cgInstruments` (Piano, Organ, Strings, Trumpet, Megah, Marching Brass, Simfoni, Fanfare) | **Multi-mode Sound & MIDI Synth** | Memberikan karakter suara instrumen upacara yang gagah dan megah. |
| **Kontrol Tiap Lagu** | Play, Pause, Stop per kartu lagu | **Item Card Controls** | Tombol besar responsif untuk meminimalkan salah pencet saat memandu prosesi upacara. |
| **Offline Ready** | Local Storage Android | **IndexedDB + Service Worker** | Lagu diunduh satu kali dan disimpan permanen di memori browser. Siap diputar tanpa internet. |
| **Cloud Storage** | Local Storage Picker | **Google Drive Direct Integration** | Menggunakan Google Drive untuk menyimpan file audio/MIDI agar mudah dibagikan ke petugas upacara lain. |

---

## 🚀 Cara Kerja Download & Offline Cache

1. Saat pertama kali membuka halaman web, Anda akan melihat daftar lagu upacara dengan status **Belum Diunduh** (badge kuning).
2. Klik tombol **"Unduh Semua Offline"** (atau tombol unduh pada masing-masing lagu).
3. Lagu akan diunduh dan disimpan ke dalam **IndexedDB** di browser perangkat Anda.
4. Status lagu akan berubah menjadi **✓ Siap Offline** (badge hijau).
5. Pada upacara berikutnya (besok, minggu depan, atau kapan pun), Anda **tidak perlu mengunduh lagi**. Bahkan jika laptop atau ponsel Anda **dimatikan internetnya / mode pesawat di lapangan**, semua lagu tetap berputar lancar!

---

## 📁 Cara Mengisi Lagu Menggunakan Google Drive

Anda dapat memasukkan lagu baru langsung melalui menu **"Tambah Lagu"** di aplikasi web, atau memperbarui berkas `songs.json`.

### Langkah Pengaturan File di Google Drive:
1. Siapkan file audio Anda (format `.mp3`, `.wav`, `.ogg`, atau `.mid`).
2. Buka [Google Drive](https://drive.google.com/) dan upload file tersebut.
3. Klik kanan pada file audio &rarr; pilih **Bagikan (Share)** &rarr; **Bagikan**.
4. Pada bagian **Akses Umum (General Access)**, ubah dari *Dibatasi (Restricted)* menjadi **"Siapa saja yang memiliki link" (Anyone with the link)** dengan peran *Pelihat (Viewer)*.
5. Klik **Salin Link (Copy link)**.
6. Buka Upacara Player, klik **"Tambah Lagu"**, lalu tempel (*paste*) link tersebut. Sistem akan otomatis mengekstrak ID file Google Drive Anda!

Contoh format link yang didukung:
- `https://drive.google.com/file/d/1A2b3C4d5E6f7G.../view?usp=sharing`
- Atau langsung ID-nya saja: `1A2b3C4d5E6f7G...`

---

## 🌐 Cara Mengunggah ke GitHub Pages (Gratis)

Agar halaman web ini dapat diakses oleh siapa saja (rekan guru, pembina OSIS, atau petugas upacara lainnya), ikuti langkah berikut:

### Langkah 1: Buat Repository di GitHub
1. Buka [GitHub.com](https://github.com/) dan buat repository baru (misalnya dengan nama: `upacara-player`).
2. Pilih opsi **Public**.

### Langkah 2: Upload File ke Repository
Upload seluruh file yang ada di folder ini:
- `index.html`
- `style.css`
- `app.js`
- `audio-engine.js`
- `db.js`
- `songs.json`
- `sw.js`
- `manifest.json`

Atau jika menggunakan Git Bash / Terminal:
```bash
git init
git add .
git commit -m "Inisialisasi Upacara Player PWA"
git branch -M main
git remote add origin https://github.com/USERNAME/upacara-player.git
git push -u origin main
```

### Langkah 3: Aktifkan GitHub Pages
1. Di halaman repository GitHub Anda, klik menu **Settings** (ikon gerigi).
2. Di bilah menu sebelah kiri, klik **Pages**.
3. Di bagian **Build and deployment** &rarr; **Branch**:
   - Pilih branch: **`main`** (atau `master`).
   - Pilih folder: **`/(root)`**.
   - Klik tombol **Save**.
4. Tunggu sekitar 1–2 menit, GitHub akan menampilkan alamat website Anda, contohnya:
   `https://USERNAME.github.io/upacara-player/`
5. Selesai! Website siap digunakan oleh seluruh petugas upacara.

---

## 📱 Menginstal Sebagai Aplikasi (PWA) di Laptop / HP

Karena web ini dilengkapi dengan *Progressive Web App (PWA)*:
- **Di Google Chrome (Laptop/PC):** Klik ikon install (komputer dengan tanda panah ke bawah) di ujung kanan bilah URL untuk menginstal ke desktop.
- **Di HP Android:** Buka di Chrome &rarr; tekan titik tiga di pojok kanan atas &rarr; pilih **"Tambahkan ke Layar Utama" (Add to Home screen)**.
Aplikasi akan terpasang layaknya aplikasi native tanpa memakan memori besar!

---

## 🛠️ Struktur File Proyek

```text
📁 Upacara/
├── 📁 audio/               # Berkas audio lokal (MP3 & MIDI) siap di-hosting
├── 📁 soundfonts/          # Sampel audio asli General MIDI (Piano, Organ, Strings, Brass)
├── 📄 index.html          # Antarmuka web utama
├── 📄 style.css           # Desain CSS high-contrast ramah outdoor & smartphone
├── 📄 app.js              # Logika kontrol, offline IndexedDB & sinkronisasi UI
├── 📄 audio-engine.js     # Web Audio API: 3-band EQ, Transpose Semitone, & SoundFont Synth
├── 📄 db.js               # Storage engine IndexedDB untuk offline audio blobs
├── 📄 songs.json          # Katalog default lagu upacara bendera
├── 📄 sw.js               # Service Worker untuk PWA offline caching
├── 📄 manifest.json       # Metadata instalasi PWA
└── 📄 README.md           # Panduan lengkap penggunaan & deployment
```
