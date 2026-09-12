-- ============================================================
-- MASTER SECRET (2FA TOTP) — kunci valid tersimpan aman.
-- Jalankan SEKALI setelah worker.sql. Tabel ini TIDAK punya
-- policy RLS sehingga hanya server (service key) yang bisa
-- baca/tulis; kunci TIDAK terekspos publik.
-- Alur: Panel Master -> "Reset Kunci 2FA" -> generate 32
-- karakter base32 valid -> disimpan di sini -> QR valid.
-- ============================================================

create table if not exists master_secret (
  key text primary key,                  -- mis. 'totp'
  value text not null,
  updated_at timestamptz not null default now()
);

alter table master_secret enable row level security;

-- tanpa policy sama sekali: default deny. hanya service role
-- (bypass RLS) yang dapat membaca/menulis.