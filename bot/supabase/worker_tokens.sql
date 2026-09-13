-- Token hasil Header Harvester (extension Chrome biasa) utk daemon CEK.
-- JALANKAN SEKALI di Supabase SQL Editor.
create table if not exists worker_tokens (
  id bigint generated always as identity primary key,
  host text not null,
  base text,
  headers jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create index if not exists worker_tokens_host_time_idx
  on worker_tokens (host, captured_at desc);

alter table worker_tokens enable row level security;

drop policy if exists wt_insert_anon on worker_tokens;
create policy wt_insert_anon on worker_tokens
  for insert to anon with check (true);

drop policy if exists wt_select_anon on worker_tokens;
create policy wt_select_anon on worker_tokens
  for select to anon using (true);

drop policy if exists wt_delete_anon on worker_tokens;
create policy wt_delete_anon on worker_tokens
  for delete to anon using (true);