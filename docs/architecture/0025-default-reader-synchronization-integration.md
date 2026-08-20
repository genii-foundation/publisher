# 0025. Default Reader synchronization integration

Status: accepted

## Context

ADR 0024 established a framework-neutral synchronization coordinator. The
default Reader still needed a browser adapter that could connect that policy to
the provider-neutral route without giving the shared core network, storage,
clock, DOM, environment, or randomness authority.

The integration also needed to preserve local edits made during a request,
retain bookmark deletion tombstones, stop transferring data when consent or an
authenticated session is absent, and leave all local reading usable through an
offline period or provider failure.

## Decision

The official Reader rail is the default browser adapter. It loads complete
publication-scoped progress, bookmark, consent, and engagement state from local
storage. The browser supplies time, connectivity events, same-origin requests,
and engagement identities. The framework-neutral coordinator supplies debounce,
retry, revision tracking, and reconciliation policy.

Only an authenticated session with granted consent can schedule a transfer. The
adapter reads remote state through `GET /api/sync`, reconciles it against the
latest local state, then sends only declared progress, bookmark, and engagement
capabilities through `POST /api/sync`. Consent accompanies the transfer. Neither
reader identity nor publication identity comes from the browser request body.

After the transfer, the adapter reconciles the returned state against its latest
local references again. This preserves edits made while either request was
active. It acknowledges engagement events only by exact identities returned by
the provider. A response using a newer progress or bookmark schema freezes only
that document. Compatible sibling capabilities continue.

The adapter listens for browser online and offline events. Failed transfers use
the coordinator's bounded exponential retry and never remove local state.
Signing out stops new transfers while retaining local consent for a later
session. Confirmed account deletion aborts active work and records revoked local
consent after the provider reports deletion.

## Consequences

The default Reader now has a real consumer for the provider-neutral coordinator.
Provider SDKs and credentials remain outside browser bundles. Supabase remains an
optional server adapter rather than an engine dependency.

The clean packed-host proof completes the rendered mobile account flow through
email consent and code verification. It then verifies persisted progress and
bookmark state, transferred consent, and exact engagement acknowledgement in a
real Chrome session.

Cross-tab notification and richer synchronized-status surfaces remain separate
renderer work. They do not weaken the completed local-first transfer boundary.
