# AUTO CEK SCATER LIVE — Web Klaim BANDAR80

Web publik untuk menerima klaim scatter dari user. **User tidak perlu extension** —
klaim dikirim ke database Supabase, lalu **"otak"** (extension di komputer pemilik
sistem) yang mengambil, memverifikasi, menginput ke web bonus tujuan situs, dan
menentukan approve/reject.

> Status: **produksi terproteksi**. File `index.html`, `dashboard.html`, dan `sb.js`
> di repo ini berisi JS terobfuskasi (built output). Source yang bisa dibaca
> disimpan privat; panduan membentuk ulang ada di `build/` + `TUTORIAL.md`.

## Struktur
- `index.html` — form klaim publik (hasil build, JS diobfuskasi).
- `dashboard.html` — meja owner + arsip hasil (hasil build, JS diobfuskasi).
- `sb.js` — helper REST ke Supabase (obfuskasi).
- `supabase/setup.sql` — tabel `claims` + `sites`, kebijakan RLS anon, seed situs.
- `build/` — tooling: `node build/build.mjs` membentuk ulang `deploy/` + `dist-extension/`.
- `TUTORIAL.md` — setup Supabase, hosting (Vercel / GitHub Pages), extension.

## Alur kerja (1 otak → banyak situs)
1. User isi form → row `status=PENDING` masuk tabel `claims`.
2. Extension (di PC owner) polling row PENDING, verifikasi betting/scatter ke data asli (RELAX AA).
3. Double-check: kalau cocok, diinput ke **web bonus tujuan situs** lewat kolom `sites.bonus_url`.
4. Setelah diinput, logika auto-cek scatter berjalan → sesuai = approve, tidak = reject.
5. Status row diupdate real-time dan tampil di `dashboard.html`.

## Setup cepat
1. Supabase: jalankan `supabase/setup.sql` sekali (SQL Editor).
2. Hosting: sudah aktif di **GitHub Pages**; mau pakai **Vercel** → ikut `TUTORIAL.md`.
3. Extension terproteksi dipasang dari `AUTO_SCATER_EXTENSION_PROTECTED_v2.zip`.
4. Daftarkan situs di tabel `sites`, isi `bonus_url` yang benar, baru `active=true`.
   Situs `active=false` **tidak** akan diinput ke web bonus manapun (aman dari salah input).
## Otomasi dari Panel Master (tanpa extension)
- Buka Panel Master -> tab *Otomasi* (izin pantau/approve) untuk lihat daemon & kirim perintah.
- Endpoint: GET /api/worker (status), POST /api/worker/config (parameter), POST /api/worker/command (pause|resume|poll_now|reload|shutdown).
- Setup sekali saja: jalankan isi web/supabase/worker.sql di Supabase > SQL Editor (buat worker_config/worker_state/worker_commands).
- Jalankan daemon: node bot/worker.js (CDP via bot/open-chrome.ps1). Tanpa tabel worker_* daemon tetap berjalan mode lokal.
