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
  current_record jsonb;
  choose_incoming boolean;
  incoming_updated_at numeric;
  current_updated_at numeric;
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

  if jsonb_typeof(incoming_bookmarks) is distinct from 'object'
    or jsonb_typeof(incoming_bookmarks -> 'bookmarks') is distinct from 'object'
  then
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

      -- A tombstone is absorbing. Bookmark identifiers are never reused, so a live
      -- record carrying an identifier that has been deleted cannot be a legitimate
      -- later resurrection, whatever its timestamp says. Comparing timestamps first
      -- would let a device with a skewed clock undelete somebody's bookmark.
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

comment on function public.merge_reader_bookmarks(jsonb, integer) is
  'Atomically merges the authenticated reader bookmark document under a row lock.';

-- The merge function becomes the only client write path. SELECT stays for initial
-- hydration and DELETE stays for explicit reader-data deletion under the table's
-- ownership policy.
revoke insert, update
on table public.reader_bookmarks
from authenticated;

revoke all
on function public.merge_reader_bookmarks(jsonb, integer)
from public, anon;

grant execute
on function public.merge_reader_bookmarks(jsonb, integer)
to authenticated;
