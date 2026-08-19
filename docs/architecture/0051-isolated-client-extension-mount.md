# ADR 0051: Isolated client extension mount

- Status: Accepted
- Date: 2026-08-19

## Context

ADR 0050 established explicit extension registration, build-time projection,
and server slots. It deliberately left `renderer.client`, `host.route`, and
`host.handler` unimplemented so code, routing, and request authority would not
arrive as one security decision.

Publisher already permits a `content.project` implementation to return
`clientData` when the manifest grants `renderer.client`. The official Next
renderer rejected that data. Authors therefore had no supported way to attach a
separately packaged interactive surface without editing the renderer shell or
passing manuscript-bearing Reader data into a Client Component.

The client surface must preserve server-rendered reading, exact capability
grants, extension data isolation, attribution, and the server-only boundary.

## Decision

The official Next renderer implements `renderer.client` through one fixed mount
named `page.client`. It follows `page.after-main` inside the engine-owned `main`
element and remains before the required attribution footer. Not-found and
framework error pages do not invoke it.

An extension renderer adapter may supply `Client`, a React Client Component
reference imported explicitly by the author registry. The extension package
owns the `"use client"` module boundary. The engine never discovers a client
entry point from manifest data or package exports.

The adapter receives only:

- the literal `page.client` mount name
- the same narrow page context used by server slots
- its own canonical build-projected `clientData`, when present

It never receives `serverData`, manuscript blocks, the Reader envelope, source
evidence, another extension's projection, theme authority, provider
configuration, routing authority, or request authority.

The renderer invokes `Client` only when `renderer.client` is present in the
exact build-bound capability list. A client projection without that grant fails
closed. A granted client surface without a compatible `Client` reference also
fails application creation. An ungranted adapter entry remains inert and cannot
widen the manifest grant.

The engine wraps each client surface in a `div` naming the extension and
`page.client`. An engine-owned Client Component error boundary contains render
and interaction failures. Its fallback identifies only the extension ID and
states that the extension is unavailable. It does not expose the thrown value.
The manuscript, navigation, shell, and attribution remain mounted.

Client projection data is intentionally public. Next may serialize it into
server HTML and the React transport for hydration. The data remains separate
from the Reader envelope and is not compiled into static extension code.
`serverData` never enters client props.

The extension artifact hash, projection hash, package version, capability list,
adapter API version, and renderer compatibility already participate in
application identity. No second client identity is needed. Changing client data
changes the projection and application hashes. Changing client code requires an
extension package version change.

Capability checks remain dispatch controls, not a JavaScript sandbox. Explicitly
imported client code has ordinary browser authority. It cannot hold server
secrets because all browser code and supplied client data are public.

`host.route` and `host.handler` remain unimplemented and require separate
decisions.

This decision supersedes only the `renderer.client` deferral in ADR 0050. The
rest of ADR 0050 remains accepted.

## Evidence

Focused application tests prove the fixed mount, narrow page context, isolated
client projection, inert ungranted adapters, required compatible component,
closed capability vocabulary, and deterministic application identity.

The independent packed extension now ships a real `"use client"` entry, projects
distinct server and client sentinels, and installs through a frozen offline
reinstallation. The Next production build must include the client implementation
in static browser chunks while excluding both projection sentinels from those
chunks. Server HTML contains the public client projection for hydration.

The Chrome proof waits for the extension button, verifies the exact client
projection and fixed mount, clicks it to prove hydrated state, then triggers a
deliberate client render failure. The engine-owned fallback appears while the
manuscript heading and required attribution remain visible.

## Consequences

Authors can add isolated interactive publication features without modifying the
official shell or exposing manuscript data to generic client code.

Extension packages must provide a reviewed Client Component entry and increment
their package version when that code changes.

The client mount is intentionally narrow. It cannot add routes, handlers,
metadata, framework error UI, shell replacements, or attribution changes.

Browser data must be suitable for public delivery. Private configuration and
credentials belong in server-only host integrations, never `clientData`.

## Rejected alternatives

- Pass the Reader envelope to client extensions. This would place manuscript
  blocks and unrelated publication state into a generic browser boundary.
- Let each extension choose an arbitrary mount selector. This would permit shell,
  navigation, manuscript, and attribution replacement.
- Infer a client module from package exports. Export presence is not author
  consent and manifest strings are not import authority.
- Let client failures reach the application error boundary. One optional feature
  should not replace the readable page.
- Treat the capability as browser isolation. Imported code retains ordinary
  browser authority and must be reviewed before installation.
