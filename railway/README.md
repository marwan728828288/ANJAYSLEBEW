# Railway deployment (Bandar80)

Server selalu-hidup pengganti serverless Vercel untuk mesin klaim 3 fase
(A CEK → B INPUT → C VERDICT) + dashboard statis + opsi `Playwright`
(klik Approve/Reject di halaman bonus secara nyata).

## Kenapa Railway membunuh "ribet"-nya Vercel
- Tanpa cold start → token/state tidak hangus sesering serverless.
- Loop pipeline jalan via `setInterval` internal (POLL_INTERVAL_MS),
  bukan cron Hobby Vercel (yang cuma harian) / GitHub Actions ping.
- Satu proses = semua `/api/*` + `/api/worker/*` + `/app/*` + dashboard.
- `RAILWAY_PLAYWRIGHT=true` → browser chromium tersedia untuk klik
  otomatis approve/reject di situs bonus (tidak mungkin di serverless).

## Cara deploy di Railway (dashbboard)
1. `New Project → Deploy from GitHub → ANJAYSLEBEW`.
2. Root Directory: biarkan **kosong** (repo root).
3. Dockerfile path otomatis terdeteksi (`railway/Dockerfile`).
4. Tambahkan **volume** mount ke `/data` bila ingin Playwright
   (sesi login bot disimpan di sana).
5. Isi env berikut (Variabel di bawah), lalu Deploy.

## Env yang wajib
| Nama | Contoh | Keterangan |
|---|---|---|
| `SUPABASE_URL` | `https://xxx.supabase.co` | URL proyek Supabase |
| `SUPABASE_KEY` | `sb_publishable_...` | anon/publishable key |
| `SUPABASE_SERVICE_KEY` | `sb_secret_...` | SERVICE KEY (wajib utk semua admin) |
| `OWNER_SECRET` | string panjang acak | signature HMAC sesi. **SAMAKAN dengan nilai di Vercel** agar sesi yang sudah ada tetap valid |
| `OWNER_PIN` | PIN (atau `sha256:<hex>`) | PIN login owner |
| `OWNER_2FA_OFF` | `true` | opsional; matikan 2FA |
| `OWNER_TOTP_SECRET` | base32 | daftarkan lewat `/api/auth/setup2fa` (lebih aman disimpan di DB) |
| `OWNER_USERNAME` / `OWNER_PASSWORD` | — | opsional, login tahap-1 |
| `PORT` | `3000` | otomatis diisi Railway |
| `PUBLIC_BASE_URL` | `https://xxx.up.railway.app` | dipakai `/api/health` |

## Env opsional server ini
| Nama | Default | Keterangan |
|---|---|---|
| `POLL_INTERVAL_MS` | `300000` | siklus pipeline (5 menit) |
| `SERVE_WEB` | `true` | sajikan dashboard `web/` (same-origin → sesi aman) |
| `ALLOW_ORIGINS` | — | daftar origin (koma) bila dashboard tetap di Vercel |
| `RAILWAY_PLAYWRIGHT` | `false` | aktifkan bot klik; perlu Docker `ARG PLAYWRIGHT=true` |
| `BONUS_SITE_URL` | — | halaman login situs bonus (wajib utk bot) |
| `BONUS_TICKETS_URL` | — | halaman daftar tiket; boleh `{{kode}} {{site}} {{bonusToken}}` |
| `BONUS_ROW_SELECTOR` | `table tbody tr` | pemilih baris tiket |
| `BONUS_APPROVE_TEXT` / `BONUS_REJECT_TEXT` | `Approve` / `Reject` | teks tombol |
| `BONUS_STATE_DIR` | `/data` | volume penyimpanan sesi bot |

## Endpoint tambahan (Railway only)
- `GET /app/status` — status loop pipeline + bot + uptime.
- `POST /app/bonus/login` `{url}` — login bot di situs bonus (1×),
   sesi disimpan (`/data/bonus-state.json`) + screenshot.
- `POST /app/bonus/click` `{kode,action:'APPROVE'|'REJECT',site}` —
   cari baris berisi kode lalu klik tombol.
- `GET /app/bonus/state` — status sesi bot.

## Catatan jujur
- Selektor bot (baris/tombol) menyesuaikan HTML situs bonus Anda:
  telisik via DevTools dulu bila data/klik gagal.
- Sesi banner bonus: tiap kadaluarsa, `POST /app/bonus/login` ulang.
- PIN/HMAC: bila `OWNER_SECRET` berubah, semua sesi owner/staff lama ikut
  hangus (login ulang). Jika dashboard pernah eksis di Vercel, jaga
  `OWNER_SECRET` sama nilainya.
- CORS: `_lib.originOk` menerima origin .vercel.app secara otomatis;
  origin lain ditambahkan lewat `ALLOW_ORIGINS`.