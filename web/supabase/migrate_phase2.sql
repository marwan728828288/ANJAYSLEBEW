-- ============================================================
-- supabase/migrate_phase2.sql  — SEKALI JALAN (aman diulang)
-- Fase 2: kolom proses otomatis worker AUTO RELAX + perluasan
-- status check (tambah CEK_KOSONG & TUNGGU_DATA). Tidak menambah
-- kolom inti ke set pelindung patch_rules (id/claim_no/site/
-- user_id/kode_tiket/betting/scatter/mode/site_label/created_at).
-- AMAN: pakai add column if not exists, tidak ada drop table,
-- tidak menyentuh RLS / trigger patch_rules.sql.
-- ============================================================

-- ---------- KOLOM FASE 2 ----------
alter table public.claims add column if not exists has_ts          boolean     default false;
alter table public.claims add column if not exists hadiah          numeric;
alter table public.claims add column if not exists secure_status   text;
alter table public.claims add column if not exists secure_detail   text;
alter table public.claims add column if not exists input_attempts  int         default 0;
alter table public.claims add column if not exists input_site      text;
alter table public.claims add column if not exists input_tipe      text;
alter table public.claims add column if not exists last_polled_at  timestamptz;
alter table public.claims add column if not exists auto_col9       text;
alter table public.claims add column if not exists auto_col10      text;
alter table public.claims add column if not exists total_free_spin numeric;
alter table public.claims add column if not exists transaction_id  text;
alter table public.claims add column if not exists profit          numeric;
alter table public.claims add column if not exists balance         numeric;
alter table public.claims add column if not exists spin_type       text;
alter table public.claims add column if not exists symbols         jsonb;
alter table public.claims add column if not exists payout_detail   jsonb;
alter table public.claims add column if not exists free_spin_detail jsonb;

-- ---------- STATUS CHECK TERBARU ----------
do $$
begin
  -- lepas check constraint lama (nama boleh beda di tiap proyek),
  -- lalu pasang ulang dengan status terbaru (tambah CEK_KOSONG &
  -- TUNGGU_DATA, semua status lama tetap dipertahankan).
  begin
    alter table public.claims drop constraint if exists claims_status_check;
  exception when others then raise notice 'constraint lama tidak ditemukan (abaikan)';
  end;
end $$;

alter table public.claims
  add constraint claims_status_check
  check (status in (
    'PENDING','QUEUED','VERIFYING','SESUAI','TIDAK_SESUAI',
    'INPUTTING','INPUT_OK','INPUT_FAIL','CEK_KOSONG','TUNGGU_DATA',
    'ERROR','NO_TOKEN','ID_SALAH','APPROVED','REJECTED'
  ));

-- ---------- INDEX ----------
create index if not exists claims_input_idx  on public.claims(secure_status);
create index if not exists claims_has_ts_idx on public.claims(has_ts);

-- ---------- VERIFIKASI ----------
-- 1. Kolom baru fase 2 terpasang
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'claims'
  and column_name in (
    'has_ts','hadiah','secure_status','secure_detail','input_attempts',
    'input_site','input_tipe','last_polled_at','auto_col9','auto_col10',
    'total_free_spin','transaction_id','profit','balance','spin_type',
    'symbols','payout_detail','free_spin_detail'
  )
order by column_name;

-- 2. Constraint status terpasang dengan set terbaru
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.claims'::regclass and contype = 'c';