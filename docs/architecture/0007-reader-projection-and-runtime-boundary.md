# ADR 0007: Reader projection and runtime boundary

- Status: Accepted
- Date: 2026-07-28

## Context

The content envelope contains everything needed to audit compilation, including source paths, source geometry, producer identities, extension payloads, and arbitrary metadata. A browser does not need that authority. Shipping it would expose authoring details, bind rendering to compiler internals, and make draft filtering a framework concern.

The browser still needs one deterministic publication model for server rendering, client navigation, exact addresses, continuity, links, assets, and relocation. It must work without Next.js, React, Supabase, an audio provider, Node.js, filesystem access, network access, clock access, or mutable process state.

## Decision

GENII Publisher defines a schema-owned reader envelope and a framework-neutral reader package.

The Node entry point projects a fully validated content envelope:

```ts
projectPublicationReader(
  envelope: PublicationContentEnvelope,
  options: { audience: "public" | "preview" },
): ValidationResult<PublicationReaderEnvelope>
```

Projection requires an explicit audience. It never guesses from environment variables, deployment names, or framework mode.

The projector reads that audience once from an explicit own data property before it filters any record. Accessors, hidden or inherited values, symbols, and inconsistent proxy traps fail closed.

The public audience includes published, unlisted, and archived works and collections. It excludes drafts and their direct routes. The preview audience includes every state. A collection without an explicit state is published. Collection state controls only the collection, while work state controls only the work. Filtering may leave a retained collection with no work IDs.

Unlisted and archived records remain directly addressable but do not enter a default catalog. A renderer must make catalog inclusion explicit. Presence in the reader envelope is not permission to advertise an item.

Work-owned assets follow their work's audience. An asset without a work ID is publication-public and appears in both audiences. A source adapter must not place preview-only material in the shared asset set.

Links from excluded source works disappear. A semantic link from retained content to an excluded target also disappears. A source-backed link embedded in retained Markdown must not become a dangling or revealing link, so projection fails if its target is excluded.

The projection copies only browser-authorized fields:

- publication identity and complete fixed attribution
- works, collections, hierarchy, navigation, and continuity
- Markdown blocks and plain text
- explicit section and block reader addresses and DOM IDs
- public assets, links, active routes, redirects, and statistics
- exact content source identity

It excludes source authority, source paths, source spans, raw hashes, adapter and metric producer identities, extension configuration, extension payloads, arbitrary metadata, provider state, credentials, progress, preferences, analytics, audio state, and sync state.

Source-backed link occurrences become one block-local Markdown range. The fixed profile uses UTF-16 code-unit offsets into exact `block.markdown`, with an exclusive end. It never describes offsets into `block.text`.

Sections retain explicit structured reader addresses. An unfragmented section has no DOM ID. An anchored section uses its resolved anchor as its DOM ID. A block beneath an unfragmented section uses its block anchor. A block beneath an anchored section uses `<section-anchor>-<block-anchor>`. A block without a reader address has no DOM ID. The runtime never invents a DOM ID from an internal section or block ID.

The reader envelope carries the source content schema version, publication ID, engine version, compiler version, content build ID, and content hash. Its own reader build ID covers every projected semantic field, the audience, the exact projector version, the complete source identity, and the reader artifact contract. The JSON Schema URL and the self-referential build ID are not part of that hash basis. Serialized byte hashing remains external to the envelope.

A reader entity never reuses the compiler's content hash. A block content hash covers only its kind, exact Markdown, and exact plain text. A section content hash covers its role, title, and ordered block hashes. A work content hash covers its title, optional subtitle and summary, language, and ordered section hashes. The Node boundary recomputes all three layers. This keeps per-entity hashes free of source paths, metadata, adapters, metric producers, routes, identifiers, and other omitted authoring evidence while preserving content-based block relocation.

A draft-only source change alters the content source identity and therefore alters a public reader build ID, even when the public field set remains equal. True cryptographic separation would require separate public and preview content compilation.

The browser subpath exposes a synchronous immutable runtime:

```ts
createPublicationReaderRuntime(
  value: unknown,
): ValidationResult<PublicationReaderRuntime>
```

It validates shape and relational semantics, then builds private maps for exact lookup. It supports scoped work, collection, section, block, and continuity lookup; exact address resolution; within-work section navigation; collection-context work navigation; and all-candidate block relocation by content hash.

Paths compare byte for byte in their canonical stored form. `/x` and `/x/` remain distinct. Fragments contain only well-formed Unicode scalar values and decode exactly once for ownership. A plus sign remains a plus sign. An unknown fragment on a known route does not fall back to the route root. Composite block anchors are complete identities and are never parsed by splitting on punctuation.

Absolute URLs retain one exact ASCII HTTP or HTTPS URI spelling. The runtime rejects credentials, unusable hosts, malformed percent escapes, raw Unicode, whitespace, controls, backslashes, and other browser-repaired input.

An unanchored section address may use only its own work route or an active section route owned by the same section. Home, Updates, collection, and unrelated work routes do not become implicit section hosts. Browser-equivalent fragment aliases may identify the same section. Resolution returns the exact requested serialization as the matched address, so declaration order, object-key order, and canonical JSON sorting cannot select an alias.

Content hashes are not unique. Relocation returns every candidate in publication order and never chooses one by accident.

The browser runtime does not implement SHA-256. The Node package root runs the same structural validation, then recomputes the reader build ID with canonical JSON and Node cryptography. This is one explicit integrity boundary, not two identically named APIs with different promises.

The synchronous browser boundary must remain bounded for hostile serialized input. Exact SemVer validation uses a length cap and linear grammar. Continuity identity uniqueness and section navigation use precomputed sets and indexes rather than repeated deep comparison or scanning. Each public method snapshots its argument record once and rejects accessors, hidden fields, inherited known fields, symbols, and inconsistent proxy traps.

## Consequences

- Renderers consume a stable protocol instead of compiler provenance or generated application modules.
- Public artifacts omit draft records and authoring evidence, but their source identity still commits to the complete compiled snapshot.
- Per-entity hashes commit only to the public content semantics defined by the reader contract.
- Browser code can validate and navigate a reader artifact without Node.js or framework authority.
- Exact addresses, continuity identities, and relocation candidates cannot be overwritten by last-write-wins maps.
- Framework renderers must preserve the fixed footer attribution and source link on every reader page.
- Materializers must copy only assets retained by the selected audience.
- Renderers must sanitize untrusted Markdown. The reader link registry does not prove that arbitrary Markdown or raw HTML contains no unregistered URL.

## Rejected alternatives

### Send the content envelope to the browser

This would expose source and extension evidence, enlarge the payload, and make application code depend on compiler internals.

### Let each renderer project its own reader data

Address ownership, audience filtering, continuity, statistics, and build identity would drift between frameworks.

### Hide unlisted and archived records by deleting them

That would break direct URLs and confuse discoverability policy with publication existence.

### Add synchronous browser cryptography to the runtime

That would enlarge the trusted runtime and duplicate a build-time guarantee. The Node boundary already verifies the artifact before delivery.

### Select the first relocation candidate

Equal content hashes are legitimate. Choosing one by order would turn ambiguous evidence into false certainty.
