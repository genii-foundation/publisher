-- Scope every synchronized row by both authenticated reader and publication.
--
-- Earlier private-package migrations used one row per user. That collides when a
-- single Supabase project serves more than one publication. Existing rows cannot
-- be assigned to a publication safely because the old schema did not record one.
-- They are preserved under a reserved marker that no valid Publisher publication
-- ID can use. An author may map that marker to a reviewed publication ID explicitly.

alter table public.reader_sync_consent
  add column if not exists publication_id text;
alter table public.reader_progress
  add column if not exists publication_id text;
alter table public.reader_bookmarks
  add column if not exists publication_id text;
alter table public.reader_engagement_events
  add column if not exists publication_id text;

update public.reader_sync_consent
set publication_id = '__legacy_unscoped__'
where publication_id is null;
update public.reader_progress
set publication_id = '__legacy_unscoped__'
where publication_id is null;
update public.reader_bookmarks
set publication_id = '__legacy_unscoped__'
where publication_id is null;
update public.reader_engagement_events
set publication_id = '__legacy_unscoped__'
where publication_id is null;

alter table public.reader_sync_consent
  alter column publication_id set not null;
alter table public.reader_progress
  alter column publication_id set not null;
alter table public.reader_bookmarks
  alter column publication_id set not null;
alter table public.reader_engagement_events
  alter column publication_id set not null;

alter table public.reader_sync_consent
  drop constraint if exists reader_sync_consent_publication_id,
  add constraint reader_sync_consent_publication_id
    check (
      publication_id = '__legacy_unscoped__'
      or (
        char_length(publication_id) between 1 and 128
        and publication_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
      )
    );
alter table public.reader_progress
  drop constraint if exists reader_progress_publication_id,
  add constraint reader_progress_publication_id
    check (
      publication_id = '__legacy_unscoped__'
      or (
        char_length(publication_id) between 1 and 128
        and publication_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
      )
    );
alter table public.reader_bookmarks
  drop constraint if exists reader_bookmarks_publication_id,
  add constraint reader_bookmarks_publication_id
    check (
      publication_id = '__legacy_unscoped__'
      or (
        char_length(publication_id) between 1 and 128
        and publication_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
      )
    );
alter table public.reader_engagement_events
  drop constraint if exists reader_engagement_events_publication_id,
  add constraint reader_engagement_events_publication_id
    check (
      publication_id = '__legacy_unscoped__'
      or (
        char_length(publication_id) between 1 and 128
        and publication_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
      )
    );

alter table public.reader_sync_consent
  drop constraint if exists reader_sync_consent_pkey,
  add constraint reader_sync_consent_pkey
    primary key (user_id, publication_id);
alter table public.reader_progress
  drop constraint if exists reader_progress_pkey,
  add constraint reader_progress_pkey
    primary key (user_id, publication_id);
alter table public.reader_bookmarks
  drop constraint if exists reader_bookmarks_pkey,
  add constraint reader_bookmarks_pkey
    primary key (user_id, publication_id);

alter table public.reader_engagement_events
  drop constraint if exists reader_engagement_events_user_id_client_event_id_key,
  drop constraint if exists reader_engagement_events_user_publication_event_key,
  add constraint reader_engagement_events_user_publication_event_key
    unique (user_id, publication_id, client_event_id);

drop index if exists public.reader_engagement_events_user_event_at_idx;
drop index if exists public.reader_engagement_events_user_publication_event_at_idx;
create index reader_engagement_events_user_publication_event_at_idx
  on public.reader_engagement_events (
    user_id,
    publication_id,
    event_at desc
  );

-- Retention is per reader and publication. One busy publication cannot evict a
-- reader's event history from another publication using the same provider project.
create or replace function public.prune_reader_engagement_events()
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
    and publication_id = new.publication_id
    and id not in (
      select id
      from public.reader_engagement_events
      where user_id = new.user_id
        and publication_id = new.publication_id
      order by event_at desc
      limit max_events
    );
  return null;
end;
$$;

-- Replace the old unscoped merge signature. Keeping it callable would allow an
-- older client to write the reserved legacy row and recreate the collision.
drop function if exists public.merge_reader_bookmarks(jsonb, integer);

create or replace function public.merge_reader_bookmarks(
  incoming_publication_id text,
  incoming_bookmarks jsonb,
  incoming_schema_version integer
)
returns table (
  bookmarks jsonb,
  schema_version integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid := auth.uid();
  current_document jsonb;
  current_schema_version integer;
  bookmark_id text;
  incoming_record jsonb;
  current_record jsonb;
  choose_incoming boolean;
  incoming_updated_at numeric;
  current_updated_at numeric;
begin
  if requester is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if incoming_publication_id = '__legacy_unscoped__'
    or char_length(incoming_publication_id) not between 1 and 128
    or incoming_publication_id !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  then
    raise exception 'Invalid publication ID.'
      using errcode = '22023';
  end if;

  if incoming_schema_version <> 1 then
    raise exception 'Unsupported bookmark schema version: %.',
      incoming_schema_version
      using errcode = '22023';
  end if;

  if jsonb_typeof(incoming_bookmarks) is distinct from 'object'
    or jsonb_typeof(incoming_bookmarks -> 'bookmarks') is distinct from 'object'
  then
    raise exception 'Invalid bookmark document.'
      using errcode = '22023';
  end if;

  insert into public.reader_bookmarks (
    user_id,
    publication_id,
    bookmarks,
    schema_version
  )
  values (
    requester,
    incoming_publication_id,
    '{"bookmarks":{}}'::jsonb,
    incoming_schema_version
  )
  on conflict (user_id, publication_id) do nothing;

  select
    reader_bookmarks.bookmarks,
    reader_bookmarks.schema_version
  into
    current_document,
    current_schema_version
  from public.reader_bookmarks
  where reader_bookmarks.user_id = requester
    and reader_bookmarks.publication_id = incoming_publication_id
  for update;

  if current_schema_version > incoming_schema_version then
    raise exception
      'Remote bookmark schema version % is newer than client version %.',
      current_schema_version,
      incoming_schema_version
      using errcode = '22023';
  end if;

  for bookmark_id, incoming_record in
    select key, value
    from jsonb_each(incoming_bookmarks -> 'bookmarks')
  loop
    if jsonb_typeof(incoming_record) is distinct from 'object'
      or incoming_record ->> 'id' is distinct from bookmark_id
      or jsonb_typeof(incoming_record -> 'updatedAt') is distinct from 'number'
    then
      raise exception 'Invalid bookmark record: %.', bookmark_id
        using errcode = '22023';
    end if;

    current_record :=
      current_document -> 'bookmarks' -> bookmark_id;
    choose_incoming := current_record is null;

    if current_record is not null then
      if jsonb_typeof(current_record) is distinct from 'object'
        or jsonb_typeof(current_record -> 'updatedAt') is distinct from 'number'
      then
        raise exception 'Stored bookmark record is invalid: %.', bookmark_id
          using errcode = '22023';
      end if;

      if (incoming_record ? 'removedAt') <> (current_record ? 'removedAt') then
        choose_incoming := incoming_record ? 'removedAt';
      else
        incoming_updated_at := (incoming_record ->> 'updatedAt')::numeric;
        current_updated_at := (current_record ->> 'updatedAt')::numeric;
        choose_incoming := incoming_updated_at > current_updated_at;
      end if;
    end if;

    if choose_incoming then
      current_document := jsonb_set(
        current_document,
        array['bookmarks', bookmark_id],
        incoming_record,
        true
      );
    end if;
  end loop;

  update public.reader_bookmarks
  set
    bookmarks = current_document,
    schema_version = incoming_schema_version
  where reader_bookmarks.user_id = requester
    and reader_bookmarks.publication_id = incoming_publication_id;

  return query
    select
      reader_bookmarks.bookmarks,
      reader_bookmarks.schema_version,
      reader_bookmarks.updated_at
    from public.reader_bookmarks
    where reader_bookmarks.user_id = requester
      and reader_bookmarks.publication_id = incoming_publication_id;
end;
$$;

comment on function public.merge_reader_bookmarks(text, jsonb, integer) is
  'Atomically merges one publication bookmark document for the authenticated reader.';

revoke all
on function public.merge_reader_bookmarks(text, jsonb, integer)
from public, anon;

grant execute
on function public.merge_reader_bookmarks(text, jsonb, integer)
to authenticated;
