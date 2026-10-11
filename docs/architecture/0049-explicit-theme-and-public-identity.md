# ADR 0049: Explicit host theme and public identity artifact

- Status: Accepted
- Date: 2026-08-19

## Context

The renderer documented an explicit custom theme adapter, but the generated host
never imported one. It always called `createPublicationNextApplication` without a
theme, so every initialized publication used the bundled default.

The host also embedded an error identity passed to the template. The author
lifecycle supplied an empty object because initialization can happen before a
Reader artifact exists. The generated `publisher-error-identity.ts` therefore
failed validation. The packed host proof did not expose this because it bypassed
the lifecycle and supplied a complete identity directly.

Importing the full Reader envelope into client error boundaries is not an
acceptable repair. It can place manuscript blocks in browser chunks that need
only a title, language, home route, attribution, and theme tokens. Resolving a
manifest package string is also not acceptable. A package name in publication
data records provenance. It does not grant code execution authority.

## Decision

The author selects a custom renderer theme through an optional,
author-owned `publisher.theme.mjs` module. That module explicitly imports and
exports one installed `ResolvedPublisherNextTheme`. When it is absent, the host
aliases the same virtual module to the renderer's bundled default theme.

Both `publisher-application.js` and `publisher-error-identity.ts` import that
virtual module. The server application validates the complete resolved adapter.
The client-safe error bridge configures the same adapter and passes its resulting
tokens through the existing closed error identity validator.

`publisher.theme.mjs` is reserved author configuration. Lifecycle policy never
writes or rewrites it. The publication manifest's theme package remains identity
data and is never resolved as an import.

Every Publisher build emits `publication-public-identity.json`. It contains only
these fields:

- schema version
- publication ID
- engine version
- Reader build ID
- canonical home path
- validated public publication identity and attribution

The build ID is the exact Reader build ID. Build, check, and status treat this as
a required renderer data artifact. The error bridge imports it instead of the
Reader envelope, so manuscript blocks cannot enter client error chunks through
this path.

The official host contract advances from `0.9.0` to `0.10.0`. The migration adds
the default theme adapter, virtual module declaration, public identity import,
and theme wiring. Selecting a custom package is a manual author action, not a
migration action.

The lifecycle now passes exact existing `package.json` bytes through the host
template unchanged. Installing the renderer and a custom theme before
initialization must not be undone by initialization itself. A proof host with no
existing manifest still receives the renderer's canonical package template.

## Evidence

The packed host proof creates and packs an independent theme package, installs it
into a clean host, selects it through `publisher.theme.mjs`, performs a frozen
offline reinstall, builds the real Next application, and requires its unique
accent on ordinary pages plus static 404 and 500 pages. It also continues to scan
browser chunks for manuscript sentinels.

The real renderer lifecycle proof initializes through the author command, builds
the Reader and public identity artifacts, and reaches a current `0.10.0` host.
Both neutral fixture publications exercise the required identity artifact.

## Consequences

A custom theme is now a real supported host input rather than documentation for
a low-level API. The same package controls normal pages and error surfaces.

Changing `publisher.theme.mjs` is an ordinary author review and deployment
change. It does not require a host migration unless the renderer contract itself
changes.

The public identity artifact is generated output. Authors must commit it or
ignore it under the same policy as the Reader, search, progress, Updates, audio,
and synchronization artifacts.

A custom theme package must remain browser safe. Its configuration function can
run in client error chunks, so it cannot depend on credentials, server-only
modules, manuscript data, or host provider configuration.

## Rejected alternatives

- Resolve `publication.json` theme package strings dynamically. This converts
  provenance data into execution authority.
- Import the Reader artifact into `app/error.tsx`. This risks bundling manuscript
  data into browser error chunks.
- Keep a generic default identity for errors. This makes publication title,
  source attribution, and selected theme disagree precisely when the application
  fails.
- Execute theme migration code. Theme selection is author configuration and does
  not need filesystem mutation authority.
