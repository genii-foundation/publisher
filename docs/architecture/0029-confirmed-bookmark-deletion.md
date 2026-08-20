# 0029. Confirmed bookmark deletion

Status: accepted

## Context

The Reader bookmark document already uses absorbing tombstones so deletion can
survive delayed and clock-skewed synchronization. The official renderer did not
expose deletion. Adding a direct remove button without confirmation would make a
small pointer or keyboard mistake durable across connected devices.

Readers also need to clear a complete saved-passage collection without repeating
the same action hundreds of times.

## Decision

The official bookmark panel exposes single and bulk removal as explicit requests.
Each request opens a labeled modal confirmation inside the bounded Reader panel.
Focus moves to the destructive confirmation, Escape and Cancel return focus to
the requesting control, and a completed action returns focus to bookmark search.

Single removal applies one framework-neutral tombstone. Bulk removal applies the
same tombstone operation to the latest reactive bookmark document for every live
bookmark using one shared timestamp and one atomic store update. The renderer
does not delete storage keys, discard existing tombstones, or create a second
bulk-deletion representation.

The confirmation explains that removal applies to this browser and any connected
synchronization account. No account is required, and local removal remains useful
when synchronization is absent or interrupted.

## Consequences

Deletion uses the same monotonic merge and synchronization path as every other
bookmark update. Another tab receives the resulting complete document through
the established storage event.

The clean packed-host Chrome proof requests and cancels a single removal, verifies
focus and retained content, confirms one removal, confirms bulk removal of the
remaining collection, and requires two persisted tombstones with no live
bookmarks.

Undo is deliberately absent because tombstones are absorbing. A future recovery
feature would require a new explicit data contract rather than silently reviving
deleted synchronized state.
