# Tutorial Setup — Web Klaim BANDAR80 (Vercel / GitHub Pages)

Panduan lengkap menyiapkan web klaim mulai nol: database, hosting, sampai
memasang extension yang sudah diproteksi.

---

## 1. Database Supabase

1. Buat project di [supabase.com](https://supabase.com) (bebas, pakai password sendiri).
2. Buka **SQL Editor** → tempel isi `supabase/setup.sql` → **Run**.
   - Ini membuat tabel `claims` + `sites`, kebijakan RLS, proteksi trigger, dan seed situs.
   - ⚠️ **PENTING (v2):** script `setup.sql` sekarang berisi `drop table`
     (`claims`, `sites`) — menjalankannya **menghapus seluruh data klaim lama**.
     Pastikan sudah tidak butuh data lama sebelum Run.
   - Efek RLS v2:
     - Klaim dari web dipaksa `status=PENDING` (tidak bisa spoof).
     - Kolom inti klaim (site/user_id/kode_tiket/betting/scatter/mode) tidak bisa
       diutak-atik lewat API, hanya status verifikasi yang bisa diubah worker.
     - `status` dibatasi enum resmi.
     - DELETE hanya untuk status FINAL (arsip selesai) → klaim yang masih
       diproses tidak bisa dihapus orang lain.
     - Rate-limit 60 klaim/jam per user id.
3. Catat **Project URL** dan **publishable key** (`sb_publishable_...`) dari
   **Project Settings → API**. Key ini memang publik (dilindungi RLS).

> Jangan pernah memasang service/secret key di file web.

---

## 2. Hosting

### Opsi A — GitHub Pages (sudah aktif)
Repo ini sudah punya file produksi (JS-nya diobfuskasi). Cukup:
`Settings → Pages → Source: Deploy from a branch → main / (root)`.

### Opsi B — Vercel (opsional, bisa dipakai sebagai link utama)
1. Masuk [vercel.com](https://vercel.com) → **New Project** → import repo ini.
2. Framework Preset: **Other**.
3. Build Command: biarkan kosong (folder ini sudah berisi hasil build),
   Output Directory: biarkan kosong (root).
   → File di root langsung disajikan. Tidak perlu env var untuk jalan.
4. **Deploy**. DNS custom (`vercel domains add bandar80.my-domain.com`) atau
   pakai link `*.vercel.app` hasil generate.

Variabel env `SUPABASE_URL` / `SUPABASE_KEY` hanya dipakai kalau kamu mau
membentuk ulang build dari *source privat* dengan nilai berbeda —
tidak wajib untuk cara di atas.

---

## 3. Memasang Extension (versi terproteksi)

Extension = "otak" yang jalan di komputer **kamu sendiri** (bukan untuk dibagikan).

1. Ekstrak `AUTO_SCATER_EXTENSION_PROTECTED_v2.zip`.
2. Buka `chrome://extensions` → aktifkan **Developer mode**.
3. Klik **Load unpacked** → pilih folder hasil ekstrak.
4. Isi kode owner di `popup.js`/`background.js` bila diminta (jangan pernah
   memakai service key di sini — hanya kode owner).
5. Buka `web_claim_dashboard.html` (di folder extension) untuk meja owner,
   atau pakai `dashboard.html` online sembari tetap terproteksi.

### Cara membentuk ulang (jika ganti project Supabase / edit fitur)
Source yang bisa dibaca disimpan **di luar repo** (privat). Setelah meng-edit
file di folder `web/` (index.html, dashboard.html, sb.js):

```powershell
cd build
npm install
$env:SUPABASE_URL='https://PROJECT.supabase.co'
$env:SUPABASE_KEY='sb_publishable_...'
node build.mjs
```

Output ada di `deploy/` (web) dan `dist-extension/` (extension). Salin isi
`deploy/` ke root repo (atau langsung deploy ke Vercel), dan ekstrak
`dist-extension/` saat pasang extension. Semua JS dibuat tidak terbaca oleh
`javascript-obfuscator` di langkah ini.

---

## 4. Catatan jujur soal "tidak bisa ditiru"

- **JS obfuscation** melindungi dari salinan/copy-paste cepat dan membingungkan
  pembaca biasa. Seseorang yang tekun tetap bisa membaca hasil obfuskasi.
- **Data aman oleh Supabase RLS** (rule di `setup.sql`), ditambah trigger:
  insert dipaksa PENDING, kolom inti terkunci, delete hanya status FINAL,
  rate-limit anti-spam.
- Sudah diuji (build uji tersedia): **XSS** — 15 payload (termasuk mXSS
  `math`/`svg`, template injection, `on*` handler) semuanya di-neutralkan oleh
  escaping; **SQL injection** terhadap REST — semua probe ditolak/dikembalikan
  kosong (PostgREST parameterized + Cloudflare WAF); **status/header** —
  HTTP→HTTPS redirect, HSTS, CSP aktif (di hosting statis: `X-Frame-Options`
  dsb. harus via Vercel `vercel.json`).
- **Keterbatasan yang jujur (tahap ini):** karena tidak ada login owner,
  siapa pun dengan publishable key tetap bisa **membaca** klaim (tabel claims
  `SELECT` publik, dibutuhkan fitur "lacak status" & dashboard tanpa login)
  dan **menghapus** arsip status FINAL. Kolom inti & pelaksanaan proses tetap
  aman. Untuk menutup ini sepenuhnya, upgrade berikutnya: **Supabase Auth +
  policy `auth.role()='authenticated'`** (login owner di dashboard & extension).
- Proteksi terkuat justru: repo **privat** + extension **tidak dibagikan**.
  Ubah repo ini jadi **Private** untuk menutup akses baca kode publik.
# Otomasi Web (autoscater1-master)
Panel Master -> tab Otomasi mengontrol daemon bot/worker.js lewat endpoint /api/worker/*. Terapkan dulu web/supabase/worker.sql di Supabase SQL Editor.
