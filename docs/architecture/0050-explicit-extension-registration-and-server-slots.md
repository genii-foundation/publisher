# ADR 0050: Explicit extension registration and server slots

- Status: Accepted
- Date: 2026-08-19

## Context

The publication protocol records extension IDs, package names, configuration,
order, and capability grants. The build previously converted every declaration
into a resolved extension by assigning it the Publisher version. No package had
been imported and no exact extension version had been supplied. Provenance data
was therefore being mistaken for executable identity.

The capability vocabulary already includes `content.project`, `renderer.slot`,
`renderer.client`, `host.route`, and `host.handler`. Invoking all five at once
would combine content projection, browser code, routing, and request handling in
one security decision. The first invocation boundary needs to be complete on its
own and must not imply authority for the remaining grants.

This decision supersedes the fabricated extension-version rule in ADR 0013 and
the server-slot deferral in ADR 0009. Their other decisions remain accepted.

## Decision

An author explicitly registers installed extensions in the author-owned
`publisher.extensions.mjs` module. The default export is an ordered array of
registrations. Each registration supplies its ID, package, exact semantic
version, engine compatibility range, supported capabilities, engine
implementation, and optional renderer adapter.

The manifest package string remains provenance. Publisher never imports a
package named only by publication data. The executable registry is the author's
code review boundary. A declaration with no matching registration fails the
build. The old fabricated Publisher version is removed.

`publisher.extensions.mjs` is reserved host integration code. Source loading,
content compilation, initialization, upgrade, and rollback never read it as
publication content or claim authority to rewrite it. The command imports it
only at the explicit build and status integration boundary.

A `content.project` grant invokes the matching projector after the canonical
content envelope and Reader envelope have validated. The projector receives a
frozen content envelope, its validated JSON configuration, and only its owned
typed payloads. It returns the closed `serverData` and optional `clientData`
shape. Publisher snapshots the result as canonical JSON, rejects nonfinite or
executable values, and emits a separate extension artifact bound to the exact
publication, engine, and Reader build IDs. It cannot mutate the canonical
content or Reader artifacts.

The official Next renderer invokes `renderer.slot` only when that grant appears
in the artifact. Its adapter receives a narrow immutable page context containing
page kind and path, public publication identity, optional work and section
identity, and that extension's `serverData`. It never receives manuscript
blocks, the Reader envelope, source evidence, another extension's data, theme
authority, or provider configuration.

The renderer owns two server slots:

- `page.before-main`
- `page.after-main`

Both remain inside the engine-owned `main` element. Extension output is wrapped
in an engine-owned `aside` naming the extension and slot. The attribution footer
stays outside and after both slots. Framework error pages and the not-found page
do not invoke extension slots.

The Next application verifies the extension artifact's canonical hash, exact
Reader identity, registration order, package and version identity, granted
capabilities, adapter API version, and renderer compatibility before rendering.
The extension artifact and each projection hash participate in the deterministic
Next application identity.

`renderer.client`, `host.route`, and `host.handler` remain unimplemented. The
official renderer rejects browser data in this slice. An installed registration
may contain an adapter for an ungranted surface, but that object is never invoked
and does not widen the manifest grant.

Capability checks are dispatch controls, not a JavaScript sandbox. Explicitly
imported extension code is trusted in-process producer code. A host that does not
trust a package must isolate the process or decline to install it.

The official host contract advances from `0.10.0` to `0.11.0`. It adds the
extension artifact destination, default empty registry alias, author registry
alias, declaration file, and server application wiring. Adding the author
registry for a publication that declares extensions is a manual reviewed step.

## Evidence

Focused tests reject missing, malformed, incompatible, mismatched, duplicated,
over-granted, throwing, and non-JSON registrations and projections. They prove
deterministic detached snapshots, exact build binding, inert ungranted adapters,
narrow slot context, engine-owned placement, and safe failure text.

The real lifecycle proof initializes the official host and materializes the
extension artifact through the author command. The packed portability proof
creates and packs an unrelated extension package, installs it into a clean host,
imports it explicitly through `publisher.extensions.mjs`, performs a frozen
offline reinstall, renders both slots on ordinary pages, and confirms that its
server-only data sentinel is absent from browser chunks.

## Consequences

Extension versions now identify real author registrations rather than the
Publisher package. Build and status fail until every declaration has explicit
code authority.

Authors must commit or ignore `publication-extensions.json` under the same
policy as the Reader, search, progress, Updates, narration, and synchronization
artifacts.

Extensions can add server-rendered material adjacent to an engine-owned page
body without replacing the shell, manuscript renderer, navigation, metadata,
error surfaces, or attribution.

Later client, route, and handler decisions require separate records and evidence.

## Rejected alternatives

- Import manifest package strings dynamically. This turns provenance into code
  execution authority.
- Read package versions from Publisher itself. This fabricates identity for code
  that was never resolved.
- Pass the Reader page object to slot adapters. Work and section pages contain
  manuscript blocks and would erase the projection boundary.
- Let extensions return a complete page or shell. This permits attribution,
  navigation, accessibility, and source availability bypasses.
- Treat grants as isolation. In-process JavaScript retains process authority
  regardless of which interface Publisher dispatches.
