-- The bookmarks capability: one row per reader holding a document, merged under a
-- lock.
--
-- One row with a blob, matching progress rather than the per-entity shape of the
-- event log. That log is write-only from a client and has no UPDATE grant, so it is
-- not the pattern for a collection a reader edits and deletes from.
--
-- The document carries tombstones. A deletion has to travel between devices as a
-- record, or whichever device still holds a live copy resurrects what another
-- device deleted.

create table if not exists public.reader_bookmarks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bookmarks jsonb not null default '{"bookmarks":{}}'::jsonb,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reader_bookmarks enable row level security;

drop policy if exists "Reader bookmarks are owned by the user" on public.reader_bookmarks;
create policy "Reader bookmarks are owned by the user"
on public.reader_bookmarks
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop trigger if exists reader_bookmarks_set_updated_at on public.reader_bookmarks;
create trigger reader_bookmarks_set_updated_at
before update on public.reader_bookmarks
for each row execute function public.set_updated_at();

-- 4 MB. A measured maximum-size set of a thousand records is about 1.1 MB, and this
-- also contains a temporary merge of two disjoint replicas plus tombstones.
alter table public.reader_bookmarks
  drop constraint if exists reader_bookmarks_size,
  add constraint reader_bookmarks_size
    check (pg_column_size(bookmarks) <= 4194304);

alter table public.reader_bookmarks
  drop constraint if exists reader_bookmarks_document_shape,
  add constraint reader_bookmarks_document_shape
    check (
      jsonb_typeof(bookmarks) = 'object'
      and jsonb_typeof(bookmarks -> 'bookmarks') = 'object'
    );
