-- ============================================================
-- WORKER DAEMON — kontrol otomasi dari Panel Master
-- Jalankan SEKALI di Supabase > SQL Editor setelah setup.sql.
-- Alur:
--   * worker daemon Node (PC owner) = "otak" yang mengeksekusi
--     klaim (verif history + input ke situs bonus via CDP).
--   * worker_config  : parameter kecepatan/mode (diubah dari Panel
--                      Master lewat /api/worker/config).
--   * worker_state   : heartbeat + statistik terakhir yang ditulis
--                      worker tiap ~5 dtk (dibaca Panel Master).
--   * worker_commands: perintah dari Panel Master (pause/resume/
--                      poll_now/reload/shutdown) yang diambil &
--                      dijalankan worker.
-- ============================================================

create table if not exists worker_config (
  id int primary key default 1 check (id = 1),
  mode text not null default 'cdp',            -- 'cdp' | 'api'
  cdp_port int not null default 9222,
  cdp_url_match text not null default 'bonussmb.com',
  poll_interval_ms int not null default 2500,  -- jeda cek antrian
  per_site_concurrent int not null default 2,  -- klaim paralel
  max_retry int not null default 3,
  bonus_domain text not null default 'bonussmb.com',
  enabled boolean not null default true,
  paused boolean not null default false,
  payload jsonb not null default '{}'::jsonb,  -- non-rahasia (mis. today, note)
  updated_at timestamptz not null default now()
);

insert into worker_config (id) values (1) on conflict (id) do nothing;

create table if not exists worker_state (
  id int primary key default 1 check (id = 1),
  online boolean not null default false,
  version text,
  hostname text,
  status text,                                -- running|paused|idle|error|offline
  mode text,
  last_seen timestamptz,
  started_at timestamptz,
  counts jsonb not null default '{}'::jsonb,  -- processed/ok/fail/approved/... 
  current jsonb not null default '{}'::jsonb, -- claim aktif singkat
  detail text,
  updated_at timestamptz not null default now()
);

insert into worker_state (id) values (1) on conflict (id) do nothing;

create table if not exists worker_commands (
  id uuid primary key default gen_random_uuid(),
  action text not null,                       -- start|pause|resume|poll_now|reload|shutdown
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',      -- queued|done|failed
  result text,
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table worker_config  enable row level security;
alter table worker_state   enable row level security;
alter table worker_commands enable row level security;

-- config: worker & panel baca; UPDATE hanya lewat API master (service key)
drop policy if exists worker_config_read on worker_config;
create policy worker_config_read on worker_config for select using (true);

-- state: worker menulis heartbeat via publishable key (anon UPDATE)
drop policy if exists worker_state_read on worker_state;
create policy worker_state_read on worker_state for select using (true);
drop policy if exists worker_state_write on worker_state;
create policy worker_state_write on worker_state
  for update using (true) with check (true);

-- commands: PANEL menulis via API master (service key, tanpa policy); worker
-- baca & tandai selesai via anon. anon TIDAK boleh insert command.
drop policy if exists worker_commands_read on worker_commands;
create policy worker_commands_read on worker_commands for select using (true);
drop policy if exists worker_commands_update on worker_commands;
create policy worker_commands_update on worker_commands
  for update using (true) with check (true);