-- The account-deletion capability, database half.
--
-- Removing a reader's rows is something the reader may do for themselves, so it is
-- a function they may execute rather than an administrative action. Deleting the
-- authentication user is the other half and needs a privileged server route, which
-- is an open decision recorded in ADR 0014.
--
-- One function rather than four client deletes. Four separate statements can fail
-- part way and leave a reader who asked to be forgotten partly remembered.

create or replace function public.delete_reader_sync_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid := auth.uid();
begin
  if requester is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  delete from public.reader_engagement_events where user_id = requester;
  delete from public.reader_bookmarks where user_id = requester;
  delete from public.reader_progress where user_id = requester;
  -- Consent last. While any reader data remains, the record of the grant under
  -- which it was stored should remain with it.
  delete from public.reader_sync_consent where user_id = requester;
end;
$$;

comment on function public.delete_reader_sync_data() is
  'Removes every synchronized row the authenticated reader owns, in one statement.';

revoke all
on function public.delete_reader_sync_data()
from public, anon;

grant execute
on function public.delete_reader_sync_data()
to authenticated;
