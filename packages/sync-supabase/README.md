# Reference Supabase synchronization schema

The database half of reader synchronization: tables, row level security, bounds,
retention, grants, and one function that takes a lock.

## Why this is still private

The official host now owns stable email authentication, session, callback, and
account deletion routes. The server export supplies a provider for those routes
using exact Supabase dependencies and server-only environment configuration.

The package remains private until its remote data synchronization client, legal
bundle, packed-consumer proof, provenance evidence, and release lifecycle are
complete. Route mounting is no longer the blocker.

## Server configuration

An author selects the provider in `publisher.config.ts`:

```ts
import { definePublisherNextHostConfig } from "@genii-foundation/publisher-next/server/sync";
import { createPublisherSupabaseSyncProvider } from "@genii-foundation/publisher-sync-supabase/server";

export default definePublisherNextHostConfig({
  syncProvider: createPublisherSupabaseSyncProvider(),
});
```

The server reads `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service role
key is used only after the route contract has accepted a same-origin deletion
request and the anonymous server client has authenticated the current reader.

## What the migrations encode, and why each part matters

None of the following is incidental. A provider that recreated these tables without
them would present the same interface and be a downgrade.

**Row level security on every table, with ownership as the policy.** A reader may
read and write their own row and no other. Without it the anonymous key reaches
every row in the table.

**Explicit Data API grants, with anonymous access revoked.** Row level security is
not trusted alone. When automatic table exposure is off, the API still needs table
privileges, and an unauthenticated reader is kept out by revocation rather than by
the absence of a policy.

**A pinned, empty `search_path` on every function.** A function that resolves
unqualified names through a caller-controlled search path can be made to call
something else entirely. Every function here sets `search_path = ''` and fully
qualifies its references.

**Size bounds on every blob and every text column.** A self-registered account
reaches these tables with the public anonymous key, so the client's own limits are
not a security boundary. The bounds are generous against measured real data and
finite against an attacker.

**Publication scope on every reader row.** Progress, bookmarks, consent, event
identity, and retention are keyed by both authenticated reader and validated
publication ID. One provider project can serve several publications without one
publication replacing or evicting another's state.

**Retention on the append-only event log.** Events are capped per reader and
publication and the oldest are trimmed on insert, so one account cannot grow one
publication's history without bound.

**A merge function that takes a lock.** Bookmarks are one row per reader holding a
document. A whole-row upsert loses changes when two devices read the same row and
write different sets. The function creates or locks the caller's row, merges each
incoming record while holding that lock, and returns the merged document, so
concurrent calls observe one another instead of replacing one another. Rolling it
back means restoring the lost-update race and is not a harmless permissions change.

**Tombstones rather than absence.** A deletion travels between devices as a record.
Without that, whichever device still holds a live copy resurrects what another
device deleted.

## Capabilities

Keyed to the engine's closed vocabulary, so a publication declaring a capability
gets the table that serves it:

| Capability | Table | Shape |
| --- | --- | --- |
| `progress` | `reader_progress` | one row per reader and publication, a document |
| `bookmarks` | `reader_bookmarks` | one row per reader and publication, a document with tombstones, merged under a lock |
| `engagement` | `reader_engagement_events` | append only, per-reader retention |
| `account-deletion` | none | a function that removes every row a reader owns |

Consent is not a capability. It is a precondition, pinned to opt-in for every
synchronizing publication, and it has a table because the grant has to be recorded
somewhere.

## Applying it

```bash
supabase db push
```

Migrations are ordered by filename and are written to be re-runnable.

Migration `0007_publication_scope.sql` preserves rows created by earlier private
package versions under `__legacy_unscoped__`. That marker is not a valid
publication ID and current operations reject it. Before enabling a current data
client against an upgraded project, review those rows and explicitly assign each
one to its real publication. Do not infer the mapping when a project has served
more than one publication.

The server export implements the provider-neutral `/api/sync` contract. It reads
the authenticated user from the cookie-scoped Supabase client, takes publication
identity only from Publisher's validated provider context, and never accepts
either identity from browser data. Progress and consent use publication-scoped
upserts, bookmarks use the locked merge function, and engagement retries use the
publication-scoped client event identity.
