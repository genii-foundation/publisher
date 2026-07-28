# `@genii-foundation/publisher-reader`

This package projects a validated GENII Publisher content envelope into deterministic reader data and constructs framework-neutral lookup behavior over that projection.

The package is prerelease software. Its API may change before 1.0 through explicit versioned migrations.

## Boundary

The serialized reader envelope contains renderable publication structure, Markdown blocks, public addresses, link locations, assets, routes, statistics, and the complete fixed Publisher attribution. It omits repository paths, source provenance, extension declarations, capability grants, configuration, payloads, provider state, credentials, progress, bookmarks, preferences, analytics, audio state, and sync state.

Projection and full validation are build-time Node.js operations. Browser code should import `@genii-foundation/publisher-reader/runtime`, which constructs immutable in-memory indexes without filesystem, network, environment, process, clock, or randomness access.

The runtime never chooses a primary collection, rewrites routes, trims trailing slashes, or infers a canonical reader address from object order. Callers supply collection context explicitly when a work belongs to more than one collection.

Projection reads one explicit own `audience` data property before filtering. Accessors, hidden or inherited values, symbols, and inconsistent proxy traps fail closed rather than changing audience while projection is in progress.

## Audience projection

Projection requires an explicit `public` or `preview` audience.

| Publication state | Public artifact | Direct route | Default catalog |
| --- | --- | --- | --- |
| `published` | Included | Included | Included |
| `unlisted` | Included | Included | Excluded |
| `archived` | Included | Included | Excluded |
| `draft` | Excluded | Excluded | Excluded |

Preview artifacts include every state. A collection without a declared state is treated as published. Collection state controls the collection only, while work state controls the work. A retained collection may have an empty `workIds` list after draft works are removed.

Assets with a `workId` follow that work's audience. Assets without a `workId` are publication-public and appear in both audiences. Publication compilers must not use shared assets for preview-only material.

## Addresses and links

Sections and blocks carry explicit structured reader addresses and DOM IDs. The runtime compares canonical paths byte for byte, decodes a fragment exactly once for lookup, preserves plus signs, and never repairs trailing slashes. An unknown fragment on a valid route does not fall back to the route root.

An unanchored section address must use that section's work route or an active section route owned by the same section. Home, Updates, collection, and unrelated work routes cannot acquire section content through an accidental address collision. Browser-equivalent fragment aliases may name one section, but resolution reports the exact requested address rather than whichever alias appeared first in an object.

Fragments must contain well-formed Unicode scalar values. The runtime rejects lone UTF-16 surrogate code units before a browser can replace them with U+FFFD and collapse distinct addresses. Publication URLs, source links, external link targets, and external redirects must use exact ASCII HTTP or HTTPS URI serialization with a usable host and no credentials. Input that depends on browser repair, including whitespace, controls, raw Unicode, malformed percent escapes, or backslashes, is invalid.

Source-backed link ranges use the fixed `genii-reader-block-markdown` profile. Offsets are UTF-16 code units into exact `block.markdown`, scoped to one block, with an exclusive end boundary. They are not offsets into `block.text`.

The projected link registry does not prove that arbitrary Markdown or embedded HTML contains no other URLs. Renderers must sanitize untrusted Markdown. A compiler that requires complete internal-link coverage needs a separate parsing invariant.

## Integrity boundary

The browser runtime validates JSON shape, relational consistency, address ownership, navigation, link ranges, statistics, and attribution without Node.js or cryptographic authority. The package root adds canonical SHA-256 verification through `validatePublicationReaderEnvelope`.

Entity content hashes are reader-owned and contain no omitted compiler metadata. A block hash covers its kind, exact Markdown, and exact plain text. A section hash covers its role, title, and ordered block hashes. A work hash covers its title, optional subtitle and summary, language, and ordered section hashes. The Node validator recomputes every entity hash. Block relocation therefore follows visible block content rather than adapter configuration, source provenance, metrics, routes, or identifiers.

The reader build ID covers every projected semantic field and the complete source content identity. A draft-only source change therefore changes a public reader build ID even when its projected public fields do not change. Cryptographically separate public and preview identities would require separate source compilation, not a substituted subset hash.

Validation first detaches an immutable snapshot from the caller. Serialization, byte hashing, and returned artifacts all use that same validated snapshot, so accessors or stateful objects cannot change the emitted artifact after validation.

Runtime method arguments become one detached record before any field is interpreted. Accessors, hidden properties, inherited fields, symbols, and inconsistent proxy traps fail closed instead of becoming omitted optional values or cross-state requests.

## Attribution

Every graphical renderer that consumes this package must display:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

The credit must link to `https://publisher.genii.foundation`. The renderer must also expose the reader envelope attribution field `sourceCodeUrl` as a conspicuous source link.

## License and source

This package is licensed under CPAL 1.0. Network deployment triggers the source-sharing duties described in the license.

Canonical source: `https://github.com/genii-foundation/publisher`
