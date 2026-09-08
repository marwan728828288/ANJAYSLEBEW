-- ============================================================
-- STAFF & PERAN (Master web) — jalankan di SQL Editor Supabase
-- Akses hanya lewat API master (pakai SUPABASE_SERVICE_KEY),
-- jadi RLS mengunci dari publik/anon.
-- ============================================================

create table if not exists public.staff (
  id         uuid primary key default gen_random_uuid(),
  username   text unique not null,
  pass_hash  text not null,              -- sha256:hex (tidak bisa dibalik)
  fullname   text not null default '',
  role       text not null default 'staff',   -- 'admin' | 'staff'
  perms      text[] not null default '{}',    -- ringkas|datalaim|approve|hapus|pantau|staff
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff enable row level security;

-- PUBLIK/ANON TIDAK BOLEH APA-APA. API master memakai service key
-- (bypass RLS), jadi tanpa policy sama sekali pun aman.
-- Policy di bawah sebagai pertahanan berlapis: menolak semua anon.
drop policy if exists p_staff_all on public.staff;
create policy p_staff_all on public.staff for all using (false) with check (false);

comment on table public.staff is 'Akun staff panel master. Dikelola via API master (service key).';