# ADR 0046: Atomic offline publication packages

Status: accepted

## Context

Offline reading is useful only when a downloaded work is complete. Caching a
page while its styles, Reader data, images, narration, or timing sidecars remain
missing creates a misleading partial success. Replacing a complete copy in
place also risks destroying the last usable version when one request fails.

Next.js adds a second boundary. Its internal React Server Component requests are
not durable publication documents. An offline reader must not depend on those
framework responses, and a service worker must not interfere with them while
the publication is online.

## Decision

The framework-neutral Reader owns a pure offline catalog. It projects one
package per work and binds each package to the publication, Reader build,
renderer build, work content, and optional narration catalog. A package closes
over its canonical and historical documents, relevant collection and home
documents, shared Reader data, publication and work assets, every matching voice
clip, and declared timing sidecars. A work with no narration is still complete.

The official renderer serves that catalog from a data-only route. The route
reads the Reader and optional narration artifacts directly. It does not import
the React application. The server-rendered root supplies the exact renderer
build identity as one validated query value, and the catalog includes that exact
URL as a package resource.

The browser adapter stages each replacement in a unique cache. It fetches every
declared resource, discovers same-origin Next.js static, image, and stylesheet
dependencies from downloaded documents, and verifies every queued response.
Only then does one metadata record switch the active package pointer. The prior
cache is deleted after activation. A failure deletes only the staging cache and
leaves the previous complete package active.

The service worker is registered only after a reader explicitly requests a
download. It uses network first for ordinary same-origin documents and assets,
then the active immutable package, then an opportunistic runtime cache. It never
handles API, authentication, React Server Component, or framework router
requests. Range responses are served but are not placed in the runtime cache.
Offline link activation uses a full document navigation so the package never
depends on a framework flight response.

The default Reader exposes work-level download and update state. Offline public
search is restricted to installed work identities, while private bookmarks stay
available from local state. Offline narration reads verified clip and timing
responses from the active package. Cached clips become temporary blob URLs so
same-origin and external media avoid browser range-request differences. Those
URLs are revoked when the clip or connection state changes.

## Consequences

An active package is always a verified complete version. Failed updates cannot
replace it with partial bytes. Package identity changes when the Reader,
renderer, work, or narration catalog changes, so the interface can offer an
explicit update without mutating the existing copy first.

The catalog is public publication data. It carries no local reading state,
credentials, provider configuration, or synchronization payload. Installing a
package is an explicit browser action. Merely opening a publication does not
register a service worker.

The packed host proof must install a real work package, obtain service worker
control, cut network transport, load a cold section document, scope public
search to the installed work, retain local bookmarks, play cached narration,
apply cached word timings, and follow a same-origin link through a fresh offline
document load. Unit proofs separately require failed replacement retention and
activation only after every resource verifies.
