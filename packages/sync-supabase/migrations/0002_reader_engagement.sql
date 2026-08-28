-- The engagement capability: an append-only event log with retention.
--
-- Write-only from a client by design. It is never selected back and deliberately
-- has no UPDATE grant, which is why it is not the pattern for a collection a reader
-- edits.

create table if not exists
public.reader_engagement_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  client_event_id text not null,
  event_type text not null,
  event_at timestamptz not null,
  section_id text,
  content_hash text,
  route text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint publisher_event_reader_fk
    foreign key (user_id)
    references auth.users (id)
    on delete cascade,
  unique (user_id, client_event_id)
);

alter table public.reader_engagement_events
  enable row level security;

drop policy if exists "Reader events are owned by the user"
  on public.reader_engagement_events;
create policy "Reader events are owned by the user"
on public.reader_engagement_events
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Bounds on every column a client controls.
alter table public.reader_engagement_events
  drop constraint if exists publisher_event_payload_size,
  add constraint publisher_event_payload_size
    check (pg_column_size(payload) <= 8192);

alter table public.reader_engagement_events
  drop constraint if exists publisher_event_type_length,
  add constraint publisher_event_type_length
    check (char_length(event_type) between 1 and 64);

alter table public.reader_engagement_events
  drop constraint if exists publisher_client_event_length,
  add constraint publisher_client_event_length
    check (char_length(client_event_id) between 1 and 128);

alter table public.reader_engagement_events
  drop constraint if exists publisher_event_section_length,
  add constraint publisher_event_section_length
    check (
      section_id is null
      or char_length(section_id) <= 128
    );

alter table public.reader_engagement_events
  drop constraint if exists publisher_event_hash_length,
  add constraint publisher_event_hash_length
    check (
      content_hash is null
      or char_length(content_hash) <= 128
    );

alter table public.reader_engagement_events
  drop constraint if exists publisher_event_route_length,
  add constraint publisher_event_route_length
    check (route is null or char_length(route) <= 512);

create index if not exists publisher_event_retention_order_idx
  on public.reader_engagement_events (
    user_id,
    event_at desc
  );

-- Retention. Caps stored events per reader and trims the oldest beyond the cap on
-- insert, so one account cannot grow the table without bound.
create or replace function
public.prune_reader_engagement_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_events constant integer := 5000;
begin
  delete from public.reader_engagement_events
  where user_id = new.user_id
    and id not in (
      select id
      from public.reader_engagement_events
      where user_id = new.user_id
      order by event_at desc
      limit max_events
    );
  return null;
end;
$$;

drop trigger if exists reader_engagement_events_prune
  on public.reader_engagement_events;
create trigger reader_engagement_events_prune
after insert on public.reader_engagement_events
for each row
execute function public.prune_reader_engagement_events();
