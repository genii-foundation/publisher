# 0021. Reader authentication and consent boundary

Status: accepted

## Context

ADR 0019 established a server-only provider boundary for callback exchange and
account deletion. That was enough to make the privileged route safe, but not
enough for the default Reader to offer sign-in. A provider-specific browser
client would expose framework and vendor behavior inside the renderer, while an
author-supplied component would make every publication rebuild the same account
interface.

Local reading must remain useful without an account. Authentication failures,
declined consent, and provider outages cannot become manuscript failures.

## Decision

The official host owns provider-neutral routes for starting email
authentication, verifying a one-time email code, reading the current session,
signing out, callback exchange, and deleting an account. The renderer owns input
bounds, same-origin checks, redirects, status codes, and response shapes. A
provider returns narrow values and never returns a response object.

The public synchronization artifact enables the Reader surface and supplies only
its closed capability declaration. It does not carry credentials or provider
configuration. The renderer checks that the artifact belongs to the exact Reader
build before exposing the controls, then binds that declaration into the
deterministic application manifest.

The default Reader records an explicit, publication-scoped consent decision with
a copy version before it requests authentication. Sign-out and account deletion
leave local progress and bookmarks intact. Account deletion requires a separate
confirmation and is shown only when the publication declares that capability.

Provider errors collapse to fixed renderer messages. An absent synchronization
artifact leaves every route dormant and omits the account surface. Manuscript
text remains server rendered in either state.

The host contract advances to 0.6.0 because three managed route files and one
managed application input changed.

## Consequences

The reference Supabase adapter can implement the complete email authentication
and session boundary without a browser Supabase client. Its anonymous key remains
server configured, even though Supabase permits that key to be public.

This decision does not yet synchronize progress, bookmarks, engagement, or the
consent record to a remote provider. Those data operations remain a separate
browser synchronization slice with local state as the default authority.

The packed host proof must exercise both the HTTP routes and the hydrated consent
and code-entry flow. A static component snapshot is not sufficient evidence for
session behavior.
