-- Explicit Data API privileges, with anonymous access revoked.
--
-- Row level security is not trusted on its own. When automatic table exposure is
-- disabled the API still needs table privileges, and an unauthenticated reader is
-- kept out by revocation rather than by the absence of a policy.
--
-- The event log gets no UPDATE. It is append only, and a client that could rewrite
-- history in it would be able to rewrite its own retention.

grant usage on schema public to authenticated;

revoke all on table public.reader_sync_consent from anon;
revoke all on table public.reader_progress from anon;
revoke all on table public.reader_bookmarks from anon;
revoke all on table public.reader_engagement_events from anon;
revoke all on sequence public.reader_engagement_events_id_seq from anon;

grant select, insert, update, delete
on table public.reader_sync_consent
to authenticated;

grant select, insert, update, delete
on table public.reader_progress
to authenticated;

grant select, insert, update, delete
on table public.reader_bookmarks
to authenticated;

grant select, insert, delete
on table public.reader_engagement_events
to authenticated;

grant usage, select
on sequence public.reader_engagement_events_id_seq
to authenticated;
