# ADR 0052: Declarative extension page routes

- Status: Accepted
- Date: 2026-08-19

## Context

The closed extension vocabulary has always reserved `host.route` for
declarative public pages and `host.handler` for server request handling. ADR
0050 and ADR 0051 intentionally deferred both. The official host now has
explicit package registration, a build-bound extension artifact, server slots,
and one contained client mount. It still refuses an extension that requests a
public page.

A page route and a request handler are different powers. A static page needs a
canonical path, public metadata, deterministic data, server rendering, and the
ordinary publication shell. It does not need access to a Request, HTTP method,
headers, cookies, credentials, arbitrary status codes, or response headers.
Implementing both capabilities through one adapter would erase that boundary.

## Decision

Publisher implements `host.route` as a build-time route projection followed by
a renderer-specific page adapter. `host.handler` remains unimplemented.

An explicitly registered extension may provide an implementation method named
`routes` when its reviewed manifest grants `host.route`. Publisher invokes it
during the ordinary build. The method receives only:

- public publication identity
- its own JSON configuration
- its own compiled payloads
- its own `serverData` when the separate `content.project` grant produced it

It does not receive the Reader envelope, manuscript blocks, another
extension's data, host paths, environment variables, credentials, or a Request.
The two grants remain independent. A route-only extension can project routes
without `content.project`. A content projector cannot create routes without
`host.route`.

The route projector returns an ordered array. Each entry contains a stable
extension-local ID, one canonical serialized public path, a title, an optional
description, and optional finite JSON data. Publisher snapshots and deeply
freezes the result. It rejects malformed IDs, unsafe paths, duplicate IDs,
duplicate paths, excessive route counts, invalid JSON, collisions with active
publication routes, and collisions with redirect sources. Thrown values and
private diagnostics never enter public output.

The descriptors live in the existing build-bound extension artifact. They are
covered by each entry's projection hash and by the artifact build ID. They do
not enter the Reader envelope and do not grant browser access.

The official Next registration may provide one `host` adapter with kind
`genii.publisher.next-host-extension`, API version `1.0`, a compatible renderer
range, and `renderRoute`. The adapter is required only when `host.route` is
granted. An ungranted adapter remains inert.

The Next renderer validates the extension artifact again. It expands route
descriptors into the closed route plan, rejects canonical and decoded parameter
collisions, includes them in static parameters and slash continuity, and issues
an immutable `extension` page model. Metadata title, description, canonical
URL, publication header, Reader controls, extension slots, client mount, and
required attribution remain engine owned.

`renderRoute` receives only the issued extension page and that extension's own
optional `serverData`. It returns server-rendered page body content. The engine
renders the route title and optional description before that body. A thrown
value fails the required route without revealing the value. The adapter cannot
replace the shell, metadata, continuity, error pages, or attribution.

Extension route pages may be cached by the ordinary service worker after a
visit. They are not silently added to every work's explicit offline package.
An offline package closure for extension-owned pages would need a separate data
and asset ownership decision.

The official host contract advances from `0.12.0` to `0.13.0` because
`next.config.mjs` must read the extension artifact when constructing the exact
route plan.

This decision supersedes only the `host.route` deferral in ADR 0050 and ADR
0051. Their other decisions remain accepted.

## Evidence

Publisher tests must prove narrow build input, independent grants, deterministic
projection, canonical validation, collision refusal, bounded output, and inert
ungranted methods.

Next tests must prove exact adapter identity, static parameter expansion,
metadata ownership, route and slash collision refusal, server-only route data,
ordinary slots and client context, attribution, and failure without thrown-value
leakage.

The independently packed extension must contribute a real page. The clean host
must build and serve that page from the installed package, preserve required
attribution, and keep route data out of static browser chunks.

## Consequences

Authors can install extension-owned static pages without editing App Router
files or granting request handling.

Route descriptors are public build data. Secrets and private configuration do
not belong in route data.

An extension package version must change when its route projection or host
adapter changes.

Dynamic APIs, webhooks, callbacks, streaming responses, mutation endpoints, and
custom response control still require the separate `host.handler` decision.

## Rejected alternatives

- Treat Next rewrites as extension routes. Rewrites bypass Publisher route
  identity, collision validation, continuity, and attribution.
- Let client extensions register pages at runtime. Static generation and
  no-JavaScript reading would no longer be reliable.
- Put extension routes into the Reader envelope. Host integration authority
  does not belong in the framework-neutral reading projection.
- Pass the Request to `renderRoute`. That is request-handler authority under a
  different name.
- Add every extension page to every offline work package. The protocol has not
  assigned data and asset closure for those pages.
