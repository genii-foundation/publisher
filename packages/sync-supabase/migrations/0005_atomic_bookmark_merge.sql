-- Serialize bookmark synchronization in the database.
--
-- A whole-row upsert loses changes when two devices read the same row and then
-- write different sets. The function below creates or locks the caller's row,
-- merges each incoming record while holding that lock, and returns the complete
-- merged document, so concurrent calls observe one another instead of replacing one
-- another.
--
-- The revocations at the bottom are half the fix and the easier half to omit. With
-- INSERT and UPDATE still granted, a client can bypass the function entirely and the
-- race is exactly as reachable as before. Rolling this migration back therefore
-- restores a lost-update race and is not a harmless permissions change.

create or replace function public.valid_reader_bookmark_document(
  candidate_document jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(candidate_document) = 'object'
    and jsonb_typeof(candidate_document -> 'bookmarks') = 'object',
    false
  );
$$;

create or replace function public.choose_reader_bookmark(
  candidate_record jsonb,
  existing_record jsonb,
  expected_id text
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(candidate_record) is distinct from 'object'
    or candidate_record ->> 'id' is distinct from expected_id
    or jsonb_typeof(candidate_record -> 'updatedAt')
      is distinct from 'number'
  then
    raise exception 'Bookmark candidate is invalid for key: %.', expected_id
      using errcode = '22023';
  end if;

  if existing_record is null then
    return candidate_record;
  end if;

  if jsonb_typeof(existing_record) is distinct from 'object'
    or jsonb_typeof(existing_record -> 'updatedAt')
      is distinct from 'number'
  then
    raise exception 'Stored bookmark is invalid for key: %.', expected_id
      using errcode = '22023';
  end if;

  if (candidate_record ? 'removedAt')
    <> (existing_record ? 'removedAt')
  then
    if candidate_record ? 'removedAt' then
      return candidate_record;
    end if;
    return existing_record;
  end if;

  if (candidate_record ->> 'updatedAt')::numeric
    > (existing_record ->> 'updatedAt')::numeric
  then
    return candidate_record;
  end if;
  return existing_record;
end;
$$;

create or replace function public.merge_reader_bookmarks(
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
begin
  if requester is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  if incoming_schema_version <> 1 then
    raise exception 'Unsupported bookmark schema version: %.',
      incoming_schema_version
      using errcode = '22023';
  end if;

  if not public.valid_reader_bookmark_document(incoming_bookmarks) then
    raise exception 'Invalid bookmark document.'
      using errcode = '22023';
  end if;

  insert into public.reader_bookmarks (
    user_id,
    bookmarks,
    schema_version
  )
  values (
    requester,
    '{"bookmarks":{}}'::jsonb,
    incoming_schema_version
  )
  on conflict (user_id) do nothing;

  -- The lock. Everything after this observes one writer at a time.
  select
    reader_bookmarks.bookmarks,
    reader_bookmarks.schema_version
  into
    current_document,
    current_schema_version
  from public.reader_bookmarks
  where reader_bookmarks.user_id = requester
  for update;

  -- An older client must not quietly rewrite a document a newer one wrote.
  if current_schema_version > incoming_schema_version then
    raise exception
      'Client bookmark schema version % cannot replace stored version %.',
      incoming_schema_version,
      current_schema_version
      using errcode = '22023';
  end if;

  for bookmark_id, incoming_record in
    select key, value
    from jsonb_each(incoming_bookmarks -> 'bookmarks')
  loop
    current_document := jsonb_set(
      current_document,
      array['bookmarks', bookmark_id],
      public.choose_reader_bookmark(
        incoming_record,
        current_document -> 'bookmarks' -> bookmark_id,
        bookmark_id
      ),
      true
    );
  end loop;

  update public.reader_bookmarks
  set
    bookmarks = current_document,
    schema_version = incoming_schema_version
  where reader_bookmarks.user_id = requester;

  return query
    select
      reader_bookmarks.bookmarks,
      reader_bookmarks.schema_version,
      reader_bookmarks.updated_at
    from public.reader_bookmarks
    where reader_bookmarks.user_id = requester;
end;
$$;

comment on function
public.merge_reader_bookmarks(jsonb, integer) is
  'Merges the authenticated reader bookmark document while holding its row lock.';

-- The merge function becomes the only client write path. SELECT stays for initial
-- hydration and DELETE stays for explicit reader-data deletion under the table's
-- ownership policy.
revoke insert, update
on table public.reader_bookmarks
from authenticated;

revoke all
on function public.merge_reader_bookmarks(jsonb, integer)
from public, anon;

revoke all
on function public.valid_reader_bookmark_document(jsonb)
from public, anon;

revoke all
on function public.choose_reader_bookmark(jsonb, jsonb, text)
from public, anon;

grant execute
on function public.merge_reader_bookmarks(jsonb, integer)
to authenticated;
