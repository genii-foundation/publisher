-- Reader synchronization: consent, progress, and the shared update trigger.
--
-- Consent comes first because it is a precondition rather than a capability. Every
-- synchronizing publication is opt-in, so the grant has to be recorded before any
-- reader data is worth storing.
--
-- Every table here is owned by exactly one reader. Ownership is the whole access
-- model: row level security decides it, and the Data API grants in 0004 keep an
-- unauthenticated reader out even so.

create table if not exists public.reader_sync_consent (
  user_id uuid primary key references auth.users(id) on delete cascade,
  consent_version integer not null,
  copy_version text not null,
  granted boolean not null default false,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reader_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  progress jsonb not null default '{"sections":{}}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- An empty, immutable search_path with fully qualified references.
--
-- A function that resolves unqualified names through a caller-controlled search
-- path can be made to call something other than what it names. Every function in
-- this package pins it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists reader_sync_consent_set_updated_at on public.reader_sync_consent;
create trigger reader_sync_consent_set_updated_at
before update on public.reader_sync_consent
for each row execute function public.set_updated_at();

drop trigger if exists reader_progress_set_updated_at on public.reader_progress;
create trigger reader_progress_set_updated_at
before update on public.reader_progress
for each row execute function public.set_updated_at();

alter table public.reader_sync_consent enable row level security;
alter table public.reader_progress enable row level security;

drop policy if exists "Reader sync consent is owned by the user" on public.reader_sync_consent;
create policy "Reader sync consent is owned by the user"
on public.reader_sync_consent
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Reader progress is owned by the user" on public.reader_progress;
create policy "Reader progress is owned by the user"
on public.reader_progress
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Roughly 256 KB, far above any real reader and finite against an attacker. A
-- self-registered account reaches this table with the public anonymous key, so the
-- client's own cap is not a security boundary.
alter table public.reader_progress
  drop constraint if exists reader_progress_size,
  add constraint reader_progress_size
    check (pg_column_size(progress) <= 262144);

alter table public.reader_sync_consent
  drop constraint if exists reader_sync_consent_copy_version_len,
  add constraint reader_sync_consent_copy_version_len
    check (char_length(copy_version) between 1 and 64);
