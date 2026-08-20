# 0023. Provider-neutral Reader data transfer

Status: accepted

## Context

Authentication alone does not synchronize Reader data. The browser still needs
a stable route to read and transfer progress, bookmarks, consent, and engagement
without importing a provider SDK or supplying its own user or publication ID.

Direct browser access would expose provider details and let the request choose
scope. An unchecked provider response could also place arbitrary data into the
Reader application.

## Decision

The official host owns one `/api/sync` route. A read returns the authenticated
reader's state for the validated publication. A state-changing request accepts a
bounded closed payload, rejects cross-origin requests, permits only declared
capabilities, and delegates a detached value to the configured provider.

The provider context supplies publication identity from the validated build-bound
synchronization artifact. The provider derives reader identity from its server
session. Neither identity is accepted from the browser payload.

Progress and bookmarks retain independent schema versions. Consent retains its
copy version and grant or revocation times. Engagement events are bounded and
identified by a client event ID so providers can deduplicate retries.

Provider responses pass through the renderer's closed validation before they are
serialized. Provider failures become one opaque unavailable response. The route
never returns provider errors or credentials.

## Consequences

The same browser coordinator can use any conforming provider. The reference
Supabase adapter performs all data access with its cookie-scoped server client,
uses the locked bookmark merge function, and binds every operation to the trusted
publication context.

The route is transfer substrate, not the local-first coordinator. Browser
reconciliation, retry, debounce, and edits during an in-flight request remain a
separate framework-neutral responsibility. Local Reader state stays authoritative
and available when this route cannot be reached.
