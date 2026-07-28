# ADR 0005: Content envelope and compiler boundary

- Status: Accepted
- Date: 2026-07-28

## Context

The publication source protocol resolves author-controlled manifests and paths into one normalized source graph. The next boundary must turn that graph, exact source bytes, adapter output, extension payloads, assets, and links into content that renderers, audio packages, sync packages, and extensions can consume without reopening the author repository.

The Coherence Thesis already has mature manuscript tooling, but its compiler also contains publication-specific heading rules, route archaeology, continuity records, Git and GitHub provenance, PDF generation, audio enrichment, browser payload projection, application imports, global paths, and filesystem writes. Copying that implementation into the engine would make one publication's history the accidental public protocol.

GENII Publisher needs deterministic output, stable identity, exact diagnostics, and enough source provenance to explain a build. It must also compile more than one publication in one process without shared state.

## Decision

GENII Publisher defines a schema-owned, versioned content envelope as the sole framework-neutral result of content compilation.

The content package exposes a pure compiler with an explicit input:

```ts
compilePublicationContent(
  input: CompilePublicationContentInput,
): ValidationResult<PublicationContentEnvelope>
```

Every publication-dependent compiler input must be present in `CompilePublicationContentInput`. The current input contains the exact engine version, publication manifest, resolved source graph, in-memory sources, one content input for every work, optional resolved extensions and typed payloads, optional assets and links, and an optional reading-rate policy. Work content carries continuity records and exact adapter and metric producer identities. There is no hidden continuity store or global adapter registry.

The schema package exposes `resolvePublicationSourcesForContentCompilation` for the pre-compilation source pass. That named resolver checks manifest-owned structure while section routes do not yet exist. It defers only unresolved internal redirect terminal checks. Redirect syntax, duplicate redirect sources, collisions with already-known active routes, and loops still fail. The compiler reruns the resolver, compares the result with the injected graph, builds adapter-owned routes, and performs mandatory final redirect validation before returning an envelope. A caller cannot enable the deferred source-resolution mode on final envelope validation.

The content package fixes its compiler version, content schema version, production Markdown parser bundle, and Unicode word-classification profile. The parser bundle resolves the exact production dependency graph during packaging. Node's `--conditions=development` cannot replace it with instrumented code.

The pure compiler may validate, normalize, derive, and hash data. It may not:

- read or write the filesystem
- inspect the current working directory or module location
- read process-global publication state
- read the clock, environment variables, Git, GitHub, or a network
- import generated author data
- import Next.js, React, Vercel, Supabase, an audio provider, or another framework or provider
- mutate its inputs or author source

The envelope schema belongs to the schema layer. The content package emits values that conform to that schema and provides corresponding TypeScript types. Every envelope identifies at least:

- `schemaVersion`
- `publicationId`
- `engineVersion`
- `compilerVersion`
- `buildId`
- ordered works and collections
- normalized sections, blocks, and navigation relationships
- resolved routes, assets, links, and continuity identities
- source authority, exact producer identities, resolved extensions, and typed payloads
- source provenance required for diagnostics and audit

The envelope uses a generic content hierarchy. A work contains an ordered flat section list with stable IDs and explicit `parentId` relationships. Section roles may describe divisions, chapters, sections, or another adapter-defined meaning without making a fixed volume, part, chapter, and section stack normative. The compiler derives roots, children, depth, order, and navigation. Renderers consume that normalized hierarchy instead of inferring structure from source paths or mutable titles.

Every durable section ID comes from an authoritative source declaration or an exact-version content adapter. The compiler validates identity ownership and uniqueness. It never derives a durable section ID from a title, order, route, filesystem path, or traversal collision. A tool may propose missing IDs through an explicit, reviewable source migration, but ordinary compilation never writes or silently revises them.

Source inputs use portable logical paths. Every text source must include the exact `rawBytes` whose fatal UTF-8 decode equals its `contents` string. The compiler rejects malformed bytes, decode mismatches, and unpaired surrogates. It retains raw byte identity, normalizes only line endings, and records normalized identity and geometry separately. Block and source-link spans use normalized UTF-16 code-unit offsets, one-based lines and columns, and exclusive ends. Absolute host paths do not enter the envelope.

The compiler computes full SHA-256 digests through one specified canonical serialization. `buildId` is algorithm-qualified and identifies the complete semantic compilation result. The build identity includes every source, source-authority root, adapter and metric producer identity, section, continuity record, extension resolution, typed payload, asset, link, route, statistic, and version that can affect the envelope. It excludes timestamps, absolute paths, current working directory, Git state, network state, and other host accidents. Word counts use bundled Unicode 15.1 Letter and Number data instead of the host runtime's Unicode tables. The same complete inputs must produce byte-identical envelopes and the same `buildId` on every supported machine.

Every downstream projection, including renderer data, search, outline, breadcrumbs, progress, bookmarks, PDF manifests, and audio catalogs, carries the envelope's exact `schemaVersion`, `publicationId`, `engineVersion`, and `buildId`. A consumer rejects artifacts from different builds instead of combining them.

Each work records its adapter producer as `{ id, package, version }` and its metric producer as `{ id, package, version, profileVersion }`. The core metric producer is `unicode-word-count` from `@genii-foundation/publisher-content`. Its `version` is the exact compiler and package version, currently `0.1.0-alpha.0`, and its `profileVersion` is the Unicode word-profile version `15.1.0`. It derives block counts and rejects overrides. A custom producer must identify its exact package and profile versions and supply a non-negative integer count for every block. The compiler preserves that producer identity and uses the supplied counts when deriving section, work, and publication totals.

The envelope's `sourceAuthority` records the canonical `publicationManifestPath` as `publication.json`, declared source roots, declared disposable output roots, and the resolved shared asset root. The compiler rejects source and output overlap, a shared asset root outside source authority, an undeclared artifact output root, and source-owned records outside the declared roots. The repository-root publication manifest remains the one explicit exception because it establishes those boundaries. Every declared work `assetsPath` must remain inside a source root even when the directory is empty and contributes no asset records.

Asset hrefs are plain concrete origin-relative route paths. They are not `ContentAddress` values and cannot carry a query, fragment, route template, or absolute URL. Each exact section `ContentAddress`, including its optional anchor, has one section owner across the publication. Section reader locations may use structured anchors, but every non-active address must use an active server route as its base path. Resolved links may use one validated fragment or an absolute credential-free HTTP URL.

The publication manifest declares extensions in resolution order. The host supplies one matching ID, package, and exact version for every declaration in the same order. The compiler does not load or execute those packages. Typed content payloads carry a stable ID, extension owner, absolute schema URL, required `sourcePaths` array, JSON data, and derived content hash. The array may be empty; every listed path must match injected `extension` source provenance owned by the same extension. The core records the schema URL but does not fetch or execute it.

Downstream extension projections consume the validated envelope and emit separate artifacts. They do not mutate the canonical envelope. Canonical extension data enters compilation only through explicit typed payloads, assets, links, continuity, metadata, or versioned adapter output.

## Planned Node loader and materializer

Filesystem access belongs in a separate Node.js loader and materializer boundary.

A secure Node loader is planned but is not part of the current content package. It will consume the schema runtime's resolved source graph and an explicit publication root. It must resolve real filesystem identities, reject escapes caused by symbolic links, case folding, Unicode normalization, mounts, or source changes during loading, and read each approved source once. It will not discover alternative manuscripts or infer undeclared paths.

A materializer is also planned and is not a current API. It will write only beneath declared disposable output roots. It must build a complete candidate in a staging location, validate every artifact and shared build identity, then replace the prior output atomically. A failed compile or projection must leave the prior complete output intact. It must never write an author source root or durable continuity record.

Renderer and capability packages own their projections. The compiler does not write framework routes, public directories, PDFs, audio objects, database records, or provider configuration.

## Content adapters

A content adapter translates one work's source format into stable normalized sections and blocks. Its ID, package, and exact version participate in build identity. Adapter output is injected compiler input, not a license to reopen repository paths.

The current `compileMarkdownWork` helper is the neutral CommonMark adapter primitive. It requires explicit work and root-section IDs, emits one section, and derives content-addressed block projection IDs. It does not infer a multi-section hierarchy, title-derived durable IDs, continuity history, or publication-specific heading rules. A future adapter package may build richer work input around this primitive. If authoring source lacks stable section identities, a separate migration command must propose durable declarations for human review before they become a published contract.

Editorial analysis and supervised prose proposals remain separate packages. A content adapter may report malformed or ambiguous structure, but it may not rewrite manuscript prose.

## Failure contract

`compileMarkdownWork`, `compilePublicationContent`, and `validatePublicationContentEnvelope` return discriminated `ValidationResult` values. Failure returns deterministic diagnostics and no partial value. Malformed, semantically invalid, or safely uninspectable input does not escape those public entry points as an exception.

Compilation proves the relationship between supplied text and its original `rawBytes`. The envelope retains identities, lengths, and normalized geometry, not those bytes. Public envelope validation can prove internal consistency and agreement with the declared geometry. It cannot repeat the original decode or source hashing without source bytes.

Serialization is deliberately strict. `serializePublicationContentEnvelope` revalidates its input and throws `TypeError` for an invalid envelope. `createPublicationContentArtifact` inherits that behavior. Neither function writes output. Hosts must retain the last complete artifact until compilation, semantic validation, serialization, and every required projection succeed.

## Coherence Thesis boundary

The Coherence Thesis migration will use a dedicated adapter outside the generic compiler. Its existing `volumeId` values map to stable work identities. Its `editorialId` values remain editorial package identities and source metadata.

The Coherence adapter owns all behavior needed to reproduce the existing publication, including:

- the nine-volume inventory and its ordering
- legacy reader start markers and heading grammar
- synthetic front matter and structural opener behavior
- current section, chapter, part, and continuity identities
- numeric and historical `/manuscripts/` routes
- reviewed section lineage, aliases, route ledgers, and historical source paths
- curated overview and semantic-reference transforms
- existing version and audio compatibility data

These rules are migration compatibility, not generic publishing semantics. No core package may import Coherence manifests, routes, editorial voice, or parser constants.

Coherence acceptance remains in the author repository. Its golden gate compares exact work and section inventories, current and historical routes, continuity ownership, content hashes, paragraph anchors, semantic references, audio version identities, and rendered preview behavior. Compilation and migration do not authorize a production deployment.

## Rationale

One immutable envelope gives every consumer the same content and build identity. Explicit inputs make compilation reproducible, testable, and safe to run concurrently. A generic hierarchy supports essays, books, collections, and established publications without encoding Coherence's structure as a universal law.

Separating the secure loader, pure compiler, projections, and materializer gives each boundary one kind of authority. The loader may read approved source. The compiler may transform injected data. Projections may derive consumer-specific views. The materializer may replace disposable output. None may revise manuscript prose or durable publishing decisions.

## Consequences

- The schema layer owns and versions the content envelope contract before the content package publishes a stable API.
- Canonical and declared layouts compile through the same source graph and compiler.
- Compiler tests can prove byte-identical output across directories, clocks, Git states, and concurrent publications.
- Every renderer and capability package must reject a mismatched envelope or projection build identity.
- New source formats require versioned adapters with deterministic contract tests.
- Rich authoring adapters must supply durable section identities; the current Markdown helper requires the root-section identity explicitly.
- Coherence-specific parsing and continuity remain in its migration adapter until parity is accepted.
- Ambient Git and hosting state do not define content identity. Reviewed canonical data can enter only through an explicit compiler input.

## Rejected alternatives

### Extract the Coherence compiler as the core

This would publish one manuscript's hierarchy, routes, title heuristics, history, and application coupling as engine behavior.

### Let the compiler discover repository paths

Discovery would duplicate the schema runtime's authority and make builds depend on current working directory, path coincidences, and undeclared files.

### Derive stable IDs from headings

Titles and ordering are editorial content. Deriving identity from them makes a rename or insertion capable of breaking routes, progress, audio, and continuity.

### Make renderer payloads the compiler protocol

Search, breadcrumbs, progress, PDF, and audio have different consumers and release rates. Treating one projection as canonical would couple content identity to the first renderer.

### Use Git revisions as build identity

A Git revision can change without content changing, can omit uncommitted source, and may not exist in an archive. Content identity must come from the complete semantic compilation input.
