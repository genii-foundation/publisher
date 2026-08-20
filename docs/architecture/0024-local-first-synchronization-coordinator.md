# 0024. Local-first synchronization coordinator

Status: accepted

## Context

The provider-neutral route can transfer Reader data, but a browser needs policy
for timing, offline periods, failures, schema changes, and edits made while a
request is active. Putting that policy directly in a React component would make
the hardest state transitions depend on effects and timers that are difficult to
prove independently.

## Decision

The Reader package owns a framework-neutral synchronization state machine. The
host supplies time, connectivity changes, storage, and transport results. The
state machine debounces local revisions, pauses offline, retries with bounded
exponential delay, and records the exact revision held by an active request.

A successful request acknowledges only the revision it carried. If local state
changed while that request was active, the newer revision remains pending and is
scheduled immediately.

Reconciliation merges the latest local progress and bookmarks with the returned
remote documents. Progress remains monotonic. Bookmark deletion tombstones remain
absorbing. A remote schema newer than the Reader freezes only that capability,
leaving compatible sibling capabilities available.

Consent is publication scoped and bound to the displayed copy version.
Engagement events use caller-supplied identities and time, a bounded local queue,
idempotent insertion, bounded transfer batches, and acknowledgement by exact sent
identity. Events added during a request remain unsynchronized.

## Consequences

React, another browser renderer, or a native shell can consume the same tested
policy. The core opens no storage, network, clock, environment, DOM, or randomness
authority.

The default Reader still needs to connect this coordinator to `/api/sync`. That
integration is a separate checkpoint and remains required before client
coordination parity is complete. ADR 0025 records completion of that integration.
