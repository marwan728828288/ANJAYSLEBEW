# PORTING 3-FASE — Extension AUTO SCATER / AUTO RELAX → Worker Web (Node)

Dokumen ini memetakan hasil porting dua extension Chrome (`AUTO SCATER`, `AUTO RELAX`)
menjadi prosesor serverless `web-only` (Node, tanpa `chrome.*`, tanpa DOM, tanpa OCR)
di repositori `deploy-master/`. Semua alur klaim ditarik menjadi **3 fase** yang
diatur dari JSON `worker_config.payload`.

| Peta file | Peran |
|---|---|
| `deploy-master/lib/scater-lib.js` | Port verbatim logika CEK AUTO SCATER (alur `klaim*`, consensus scatter GetBetHistory, `calcHadiah`, token TTL admin/history, `klaimClassifyBonusError`). |
| `deploy-master/lib/relax-lib.js` | Port siklus hidup baris AUTO RELAX: skema 22 field (`makeRow`/`toClaimRow`), parse `user` + `kode` (akhiran `TS`), validators, klasifikasi status, `buildBonusPayload`, `buildSubmitRequest`. |
| `deploy-master/lib/claim-lib.js` | CEK terverifikasi sederhana ala produksi: `verifyClaim` (queryTransactionHistoryListForUser + GetBetHistory), `compareClaim`, `fetchVerdict`. |
| `deploy-master/api/worker.js` | Router tunggal: endpoint publik `/api/submit`, `/api/sitelist`, `/api/track`, endpoint token worker, config/command, dan `/api/worker/process`. |
| `web/supabase/migrate_phase2.sql` | Migrasi kolom fase 2 di `claims` + status `CEK_KOSONG`/`TUNGGU_DATA`. |
| `web/supabase/patch_rules.sql` | Trigger pelindung kolom inti `claims` (worker hanya boleh menulis kolom verifikator). |

---

## 1. Arsitektur 3 fase

```
         /api/submit (publik)                GitHub Actions cron (*/5 utk /api/worker/process)
                  │                                          │
                  ▼                                          ▼
          [claims PENDING] ─────────────────────────►  /api/worker/process
                                                              │
   ┌──────────────────────────────────────────────────────────▼────────────────────────────┐
   │  A. CEK        B. INPUT                      C. VERDICT / AUTO-POLL                       │
   │  worker →      kirim tiket ke situs bonus     polling status approve / reject              │
   │  admin         bila payload.bonus_submit      bila payload.verdict_poll diset              │
   │  X-Access-     di-set (template config        (fetchVerdict dari record admin,             │
   │  Token →       → posisi kolom input_site/     atau klasifikasi TOSTA_OK/TOSTA_FAIL         │
   │  history API   input_tipe/auto_col9/10)       relax-lib)                                   │
   └────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Fase A — CEK (verifikasi tiket).** Worker memanggil history API milik situs admin dengan
header `X-Access-Token` (di-paste di panel → `worker_tokens`):
`GET <base>/game-oc/ida/transaction/history/queryTransactionHistoryListForUser` untuk mencocokkan
kode tiket (debit > 0, game 65/74), lalu `POST public-api.<domain>/.../History/GetBetHistory` untuk
scatter aktual (consensus `dt.bh.bd`). Output: `SESUAI` / `TIDAK_SESUAI` / `CEK_KOSONG` / `TUNGGU_DATA` /
`NO_TOKEN`. Implementasi: `claim-lib.verifyClaim` + `scater-lib.klaimQueryHistoryList` /
`klaimFetchScatterPgFi`.

**Fase B — INPUT (tiket → situs bonus).** Aktif **hanya bila `payload.bonus_submit` di-set**.
Worker membangun payload via `relax-lib.buildBonusPayload` (site/tipe/UserID/Kode/bet/scatter) dan
`relax-lib.buildSubmitRequest` (template ber-`{{placeholders}}`), lalu mengirim HTTP ke `bonus_submit.url`
dengan `max_retry` percobaan. Tanpa `bonus_submit`, fase B di-skip — klaim berhenti di hasil CEK.

**Fase C — VERDICT / auto.** Aktif **bila `payload.verdict_poll` diset**. Worker melakukan polling
verdict (approve/reject) lewat salah satu jalur yang tersedia: `claim-lib.fetchVerdict` (membaca status
record dari admin history) dan/atau klasifikasi `TOSTA_OK`/`TOSTA_FAIL` di `relax-lib`. Hasil akhir
menulis `APPROVED` / `REJECTED` pada `claims`. Jika jalur verdict tidak tersedia (mis. tidak ada record
admin), klaim tetap `SESUAI`/`INPUT_OK` dengan `last_polled_at` dicatat untuk siklus berikutnya.

---

## 2. Pemetaan fase ↔ komponen extension ↔ kolom `claims`

| Fase | Komponen extension asli | Port web-only (file/fungsi) | Kolom `claims` |
|---|---|---|---|
| A — CEK | AUTO SCATER `klaim*`/`runQueue` · AUTO RELAX `cekHistory` | `scater-lib.js` (`verifyClaim`, consensus scatter, `calcHadiah`, `getHistoryToken`/`saveHistoryToken`/`setRefreshSession`, `klaimClassifyBonusError`) · `claim-lib.js` (`verifyClaim`, `compareClaim`) | `status`=VERIFYING, `match`, `actual_bet`, `actual_scatter`, `hadiah`, `total_free_spin`, `transaction_id`, `profit`, `balance`, `spin_type`, `symbols`, `payout_detail`, `free_spin_detail`, `has_ts`, `secure_status`, `secure_detail`, `detail`/`label` |
| B — INPUT | AUTO RELAX queue + `content.js` (isi DOM/API situs bonus) | `relax-lib.js` (`buildBonusPayload`, `buildSubmitRequest`, `TOSTA_OK`/`TOSTA_FAIL`) · `api/worker.js` (hanya bila `payload.bonus_submit`) | `status`=INPUTTING, `input_attempts`, `input_site`, `input_tipe`, `auto_col9`, `auto_col10` → `INPUT_OK` / `INPUT_FAIL` |
| C — VERDICT | AUTO RELAX polling approve/reject di livechat/halaman tiket | `claim-lib.js` `fetchVerdict` · `relax-lib.js` `classifySecureStatus`/`classifyHistoryStatus` (hanya bila `payload.verdict_poll`) | `status`=APPROVED / REJECTED, `verdict`, `verdict_at`, `last_polled_at`, `label` |

Kolom selain di atas (kolom inti: `id`, `claim_no`, `site`, `user_id`, `kode_tiket`, `betting`,
`scatter`, `mode`, `site_label`, `created_at`) dikunci oleh trigger `web/supabase/patch_rules.sql`
(`claims_protect_update`) — worker hanya boleh menulis kolom verifikator.

Status enum saat ini: `PENDING`, `QUEUED`, `VERIFYING`, `SESUAI`, `TIDAK_SESUAI`, `INPUTTING`,
`INPUT_OK`, `INPUT_FAIL`, `CEK_KOSONG`, `TUNGGU_DATA`, `ERROR`, `NO_TOKEN`, `ID_SALAH`,
`APPROVED`, `REJECTED`.

---

## 3. Config worker (`worker_config.payload` JSON)

Semua nilai non-rahasia disimpan di kolom `worker_config.payload` (diubah lewat Panel Master →
`POST /api/worker/config`). Struktur:

| Field | Tipe | Keterangan |
|---|---|---|
| `sites[]` | array | Definisi situs (`siteId`, `label`, `host`, `historyHost`, `apiHost`, `gameId`, `active`) untuk pemilihan token admin per klaim. |
| `bonus_domain` | string | Domain utama situs bonus (contoh di seed: `bonussmb.com`). |
| `bonus_submit` | object | Mengaktifkan fase B: `url`, `method`, `headers`, `body` (template `{{placeholders}}`), `max_retry`. |
| `verdict_poll` | object | Mengaktifkan fase C (polling verdict otomatis). |

### 3.1 Contoh JSON lengkap

```json
{
  "sites": [
    {
      "siteId": "bandar80",
      "label": "BANDAR80",
      "host": "bandar80.idrbo2.com",
      "historyHost": "bandar80.idrbo2.com",
      "apiHost": "bandar80.idrbo2.com",
      "gameId": "74",
      "active": true
    }
  ],
  "bonus_domain": "bonussmb.com",
  "bonus_submit": {
    "url": "https://bonussmb.com/<endpoint-nyata>",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json"
    },
    "body": "{\"site\":\"{{site}}\",\"tipe\":\"{{tipe}}\",\"UserID\":\"{{UserID}}\",\"Kode\":\"{{Kode}}\",\"bet\":{{bet}},\"scatter\":{{scatter}},\"bonusToken\":\"{{bonusToken}}\"}",
    "max_retry": 3
  },
  "verdict_poll": {
    "active": true
  }
}
```

> **Catatan HONEST — jangan mengarang endpoint.** URL `bonus_submit.url` adalah nilai yang **wajib
> dipastikan dari DevTools** pada sesi login bonus milik sendiri (`perlu dipastikan dari DevTools`).
> Di seed, `sites.bonus_url` = `https://bonussmb.com/tickets` adalah URL halaman, **bukan** endpoint
> API submit — jangan dipakai sebagai `bonus_submit.url` tanpa verifikasi.

### 3.2 Placeholder

`relax-lib.buildSubmitRequest` mengisi placeholder di `body`/URL dari field klaim & konfigurasi:

| Placeholder | Sumber |
|---|---|
| `{{site}}` | `buildBonusPayload` (siteId klaim) |
| `{{tipe}}` | `buildBonusPayload` (jenis bonus / tipe klaim) |
| `{{UserID}}` | `buildBonusPayload` (`user_id` klaim) |
| `{{Kode}}` | `buildBonusPayload` (`kode_tiket` klaim) |
| `{{bet}}` | `buildBonusPayload` (`betting` klaim) |
| `{{scatter}}` | `buildBonusPayload` (`scatter` klaim) |
| `{{bonusToken}}` | **dari `worker_tokens.headers['X-Access-Token']`** baris terbaru utk host yang cocok (bonus_domain / host situs) |

`{{bonusToken}}` tidak disimpan terpisah — diisikan saat build request dari `worker_tokens` yang
di-paste di panel Sesi Admin. Aturan ini disalin dari pola `scater-lib`/`claim-lib` yang memakai
`X-Access-Token` sebagai `?t=` di GetBetHistory.

---

## 4. Alur status (teks panah)

```
                       (token hilang/expired)
 PENDING ────────────► NO_TOKEN ◄────────── paste token baru di panel
    │
    ▼
 VERIFYING ──── history kosong & retry habis ──► CEK_KOSONG
    │                                                        TUNGGU_DATA
    │── history kosong / scatter belum siap (retry) ─────────────────┘
    │                                                        │
    │── bet/scatter/game tidak cocok ──► TIDAK_SESUAI ──► REJECTED
    │
    ▼
 SESUAI ──── (bila payload.bonus_submit kosong ─► langsung fase C)
    │
    ▼
 INPUTTING ──── berhasil ──► INPUT_OK ──► (bila payload.verdict_poll)
    │
    │── gagal / max_retry habis ──► INPUT_FAIL (bisa retry: input_attempts++)
    │
    ▼
  polling verdict ── approve ──► APPROVED
                  └── reject ──► REJECTED
```

Catatan label/jalur:
- `NO_TOKEN` — tidak ada / `X-Access-Token` expired (detail: "BUTUH SESI ADMIN" / "SESI ADMIN KADALUARSA").
- `TUNGGU_DATA` — CEK ditunda (history kosong / scatter "belum siap", hitungan `cekr=`/`scr=` di `detail`), lalu kembali ke `PENDING`.
- `CEK_KOSONG` — history kosong & retry habis (label "HISTORY KOSONG").
- `TIDAK_SESUAI` → `REJECTED` — bet/scatter berbeda, game bukan Mahjong 1/2, atau tiket tak ditemukan (debit>0).
- `ERROR` — exception tak terduga dalam satu siklus proses.
- `ID_SALAH` — koreksi manual dari panel (bukan hasil proses worker).
- `QUEUED` — antrean menunggu slot prosesor.

---

## 5. Batasan HONEST web-only vs extension asli

| # | Kemampuan extension asli | Keterbatasan web-only (HONEST) | Rencana lanjutan |
|---|---|---|---|
| a | Klik DOM tombol **approve/reject** di halaman bonus (content.js) | **Tidak mungkin** tanpa brauser terhosting atau endpoint API milik situs bonus — worker hanya membaca status dari record admin (`fetchVerdict`). | Brauser terhosting (mis. **Playwright** di VPS) yang login ke halaman bonus, atau integrasi **endpoint bonus API** (perlu dipastikan dari DevTools). |
| b | **OCR layar livechat** (Tesseract) + otomatisasi UI (deteksi assist, screenshot, klik elemen) | **Tidak ada.** Input tidak bisa disimulasikan ke halaman; pengajuan via panel/link publik (`/api/submit`) atau `bonus_submit` API bila endpoint ada. | Brauser terhosting (Playwright) menjalankan `content.js`/OCR; atau `bonus_submit` memakai endpoint API nyata. |
| c | **Sniffer header admin** di background (tangkap otomatis saat login/pakai panel) | Token admin **di-paste manual** setiap masa aktifnya habis (JWT `exp`; TTL token history 55 menit di `scater-lib`). Prosesor menandai `NO_TOKEN` bila token lama/expired. | Harvester/sniffer di brauser terhosting yang menyimpan ulang `X-Access-Token` ke `worker_tokens` otomatis; tetap perlu sesi login yang valid. |

---

## 6. Cara pakai

1. **Deploy Vercel** — push branch `main` ke repo yang terhubung (git push → auto-deploy
   `deploy-master/`). Set env di dashboard Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (atau
   `SUPABASE_KEY`), `OWNER_SECRET`, `OWNER_PIN` (+ `GOOGLE_CLIENT_ID`/`SECRET` bila pakai login Google).
2. **Migrasi DB** — di Supabase SQL Editor, jalankan berurutan: `web/supabase/setup.sql` →
   `web/supabase/worker_tokens.sql` → `web/supabase/worker.sql` → `web/supabase/patch_rules.sql` →
   `web/supabase/migrate_verdict.sql` → **`web/supabase/migrate_phase2.sql`** (tambahkan kolom
   fase-2 & status `CEK_KOSONG`/`TUNGGU_DATA`).
3. **Isi token admin** — buka Panel Master → halaman Worker → Sesi Admin, tempel
   `X-Access-Token` (+ header `X-Agent-*` bila perlu) per host; pilih `base` yang benar.
   Ulangi setiap TTL habis (lihat §5c).
4. **Set payload JSON** — simpan `worker_config.payload` seperti contoh §3.1
   (`sites[]`, `bonus_domain`, dan `bonus_submit`/`verdict_poll` sesuai fase yang aktif).
5. **Pemicu pipeline** — prosesor `/api/worker/process` dipanggil otomatis oleh GitHub Actions
   `process.yml` tiap **5 menit** (header `x-vercel-cron: 1`) plus cron Vercel harian
   `0 0 * * *` di `vercel.json` sebagai fallback; tombol proses manual juga tersedia di panel.

> Satu fungsi serverless + cron dipakai untuk menghemat kuota Hobby; endpoint publik
> digunakan pengguna untuk submit (`/api/submit`), daftar situs (`/api/sitelist`), dan lacak
> status (`/api/track`), sedangkan endpoint token/config/command/process dibatasi hak akses panel.