# 0026. Reactive private Reader store

Status: accepted

## Context

The framework-neutral Reader package supplies immutable progress and bookmark
documents, but separate client surfaces can still lose updates if each keeps a
private React snapshot. A scroll update, audio update, bookmark action, remote
reconciliation, and another tab may all read and write the same publication
state.

The renderer needs one atomic browser boundary without moving storage, DOM, or
React authority into the shared Reader package. It must also preserve
server-rendered reading and stable hydration.

## Decision

The official renderer owns one generic reactive store primitive. A store is
bound to one validated publication-scoped storage key and caller-supplied empty,
parse, and canonical serialization functions. Progress and complete bookmark
documents each consume the same primitive.

Every update is an atomic read, modify, and write against the latest in-memory
snapshot. Returning the same reference performs no work. A canonically equal
replacement also performs no storage write, notification, or render. This
prevents remote reconciliation in one signed-in tab from bouncing unchanged
state through another tab.

Same-tab stores publish a bounded signal carrying the exact serialized value.
Separate tabs converge through the browser's native storage event. React
subscribers and synchronization subscribers receive the same committed
snapshot. Remote replacements are labeled separately so the tab applying a
server response does not schedule that response as a fresh local edit.

The empty server snapshot has stable identity. Browser storage and event access
remain behind an injectable renderer environment. Invalid or unavailable
storage fails to the caller's bounded empty state. A failed persistence write
still commits the in-memory snapshot and notifies same-tab consumers.

## Consequences

The default Reader no longer maintains independent progress and bookmark React
copies. Future progress, bookmark, search, audio, and recommendation surfaces
can subscribe to the same atomic documents without creating another store.

The clean packed-host Chrome proof opens two hydrated Reader tabs. A bookmark
written in the peer tab reaches the first tab through a native storage event and
renders in its bookmark panel. Focused injected-environment tests cover atomic
updates, same-tab convergence, cross-tab convergence, persistence failure,
remote labeling, canonical no-op writes, and serialization refusal.

Engagement and consent remain bounded local documents but are not reactive UI
state in this checkpoint. BroadcastChannel is unnecessary because the storage
event already supplies the required cross-tab contract.
