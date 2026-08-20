# 0057. Explicit Reader state bootstrap

Status: accepted

## Context

Publisher scopes Reader preferences, progress, bookmarks, synchronization
consent, engagement, and narration choices by publication identity. An existing
publication may have years of private browser state under older keys and older
document shapes. The engine cannot know those keys or reinterpret their values
without absorbing publication-specific behavior.

React migration is too late for appearance preferences. The root prepaint reads
Publisher state before hydration, and the reactive stores read the same state on
their first browser snapshot. A compatibility step must therefore finish in the
document head before either boundary runs.

An untracked inline script would make the rendered application differ while its
manifest identity remained unchanged. An unconstrained host callback could also
produce arbitrarily large markup, break out of its script element, or fail in a
way that prevents Publisher's own prepaint.

## Decision

The Next renderer accepts one optional resolved Reader state bootstrap adapter.
It uses the same explicit package, exact version, renderer compatibility, JSON
configuration, implementation, and validation-result pattern as other renderer
adapters. It is author registered through the server-only Publisher host
configuration. The engine remains unaware of legacy publication names and keys.

The adapter configures once during application creation. Its instance receives a
deeply frozen context containing the validated publication ID, a bootstrap report
key, and target keys created by the framework-neutral Reader key functions. It
returns a synchronous JavaScript function body. The body receives the same frozen
context as `context` and returns this closed report:

```json
{
  "schemaVersion": "1.0",
  "copied": ["preferences"],
  "refused": []
}
```

Copied and refused identifiers are unique, bounded stable labels. The renderer
records the normalized report without timestamps under the supplied report key
and exposes only `completed`, `invalid-report`, or `failed` on the root element.
Thrown details and private values are not reported.

Source is limited to 32,768 UTF-8 bytes. It is syntax checked as a function body
during application creation. HTML script opening, closing, and comment sequences
are refused. Runtime execution is contained in its own script element. The
Publisher preference prepaint follows in a separate script element, so an adapter
failure cannot suppress the core preference reader.

The adapter package, exact version, renderer compatibility, API version,
configuration hash, and source hash are written into application manifest 1.1.
They contribute to the renderer build ID. A bootstrap cannot alter browser
behavior without altering application identity.

The host contract advances from 0.14.0 to 0.15.0 because the generated
application now imports the server-only author configuration and passes its
optional `readerStateBootstrap` value. Adding an adapter is a manual author
choice. It is appropriate only for an explicit compatibility window.

## Compatibility obligations

A publication adapter must copy only values it can validate and translate without
loss. It must never replace an existing valid Publisher value, delete legacy
keys, infer remote ownership, or mutate offline caches. It must be safe to run
again. Rollback relies on the older application finding its original keys
unchanged.

The adapter is trusted author code and can access browser globals. Publisher
contains failures and binds exact source identity, but it does not pretend to
sandbox code the author explicitly installed. Publication-specific adapters and
their sanitized migration fixtures belong in author repositories.

## Consequences

Existing publications can preserve private local reading state without placing
their historical keys in the engine. The migration runs early enough for first
paint and synchronous store initialization. Application artifacts expose exactly
which adapter source was active.

New publications omit the adapter and receive a literal null manifest field. A
completed compatibility window can remove the host configuration, advance the
application identity, and leave both old and new local keys intact for an
author-defined rollback period.
