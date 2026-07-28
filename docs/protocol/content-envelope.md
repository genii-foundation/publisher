# Publication content envelope

Status: initial protocol contract

The content envelope is the sole framework-neutral result of GENII Publisher content compilation. It lets renderers, readers, search, audio, sync, and extensions consume one validated publication snapshot without reopening the author repository or guessing where source files live.

The schema authority is `schemas/content-envelope.schema.json`. The package export is:

```text
@genii-foundation/publisher-schema/content-envelope.schema.json
```

The current envelope schema version is `1.0`.

## Compilation boundary

`compilePublicationContent` accepts:

- the root publication manifest
- the schema runtime's resolved publication source graph
- every required manifest, manuscript, extension source, and referenced asset as an in-memory source input
- one content input for every resolved work
- exact extension resolutions in manifest order and typed content payloads
- optional resolved assets and semantic links
- the exact engine version
- an optional reading-rate policy

Hosts that need adapter-owned section routes use the schema runtime's named `resolvePublicationSourcesForContentCompilation` function. It defers only unresolved internal redirect terminal checks. Redirect syntax, duplicate redirect sources, collisions with already-known active routes, and loops remain enforced. `compilePublicationContent` reruns that resolver, rejects a mismatched injected graph, builds the complete route registry, and performs mandatory final redirect validation. A redirect source cannot collide with an active route or public asset, redirect cycles fail, and every internal chain must terminate at an active route or external URL. The public API does not expose a general switch that disables final validation.

The compiler is framework-neutral and performs no filesystem, environment, clock, Git, network, framework, provider, or output operation. A host may read approved files before this boundary. A later materializer may write a validated artifact. Neither authority is part of the current content package.

A text source must supply both a string `contents` value and its exact `rawBytes`. The compiler performs a fatal UTF-8 decode and requires the decoded string to equal `contents`. It rejects malformed UTF-8, a decode mismatch, and unpaired Unicode surrogates. Provenance records the raw digest and byte length, then records a second digest, byte length, UTF-16 code-unit length, and line-start table after normalizing CRLF and CR line endings to LF. Normalization does not trim, Unicode-normalize, or otherwise rewrite text. Binary sources carry one byte array, which supplies both raw and normalized identity.

## Stable content identity

A work contains an ordered flat list of sections. `parentId` expresses an arbitrary hierarchy, and `role` names adapter-defined meaning such as a division, chapter, or section. The protocol does not impose a volume, part, chapter, and section stack on every publication.

Section IDs are durable authoring identities. They must come from author source or a versioned content adapter. A parent must occur earlier than its children in preorder. The compiler derives child lists, depth, and order for every section. The `navigable` field selects reader units. Previous and next relationships connect only those navigable units, so structural containers do not become accidental reading stops.

The compiler never derives a durable section ID from a title, route, source path, or traversal position. A heading rename is an editorial change, not permission to scramble reader progress, audio identity, and public continuity.

Each section carries an explicit continuity record:

- `id` is its current continuity owner.
- `legacyIds` preserves older identities now owned by the section.
- `progressGroups` declares identity groups that share reader progress.
- `historicalSectionIds` preserves section lineage that must remain attributable to the current owner.

The compiler validates publication-wide continuity ownership. Adapters may supply reviewed compatibility data, but compilation does not infer history from titles or routes.

Each section contains ordered Markdown blocks with adapter-supplied IDs, exact normalized Markdown, adapter-supplied plain text, and an exact source range. All block and link occurrence spans use normalized text geometry. Source offsets count JavaScript UTF-16 code units in the LF-normalized string. Lines and columns are one-based in the envelope. End offsets are exclusive. The compiler rejects ranges outside the normalized source, ranges that split a surrogate pair, block Markdown that differs from its declared slice, overlapping block ranges, and source occurrences outside their section or declared block.

Every section adapter input declares one reader location:

- `work` selects the unfragmented work route.
- `route` selects one named section address exactly.
- `none` is allowed only for a nonnavigable section.

The compiler resolves that declaration to `readerAddress`. It never treats the first route, a route named `canonical`, or object insertion order as public policy. Since an unfragmented work route has one content owner, at most one section in a work may select it.

Every block has a compiler projection `id` and a separate reader `anchor`. The anchor uses the portable content-ID grammar, which excludes percent-encoded fragments. When the section has an unanchored reader address, the block address appends its anchor. When the section has an anchored reader address, the block address appends `<section-anchor>-<block-anchor>`. A block in an unlocated nonnavigable section has no public destination. These final path and decoded-fragment tuples must be unique across the publication. Renderers must assign the resolved fragment as the DOM `id` and locate it with `getElementById` or an escaped selector. Content IDs may contain dots or begin with digits.

Block `contentHash` values cover content, not anchors. This allows bookmark recovery to recognize unchanged content after an anchor repair. The section hash includes each block ID, anchor, and content hash, so an anchor change still changes the section, work, content, and build identities.

The neutral `compileMarkdownWork` helper requires explicit work and root-section IDs. It uses CommonMark block boundaries and derives separate content-addressed projection IDs and public anchors. Those values are deterministic, but they do not replace durable section identity or reviewed continuity records.

Every work records an adapter producer as `{ id, package, version }` and a metric producer as `{ id, package, version, profileVersion }`. Every version is exact SemVer. Omitting a metric producer selects `unicode-word-count` from `@genii-foundation/publisher-content`. Its `version` equals the exact content compiler and package version, currently `0.1.0-alpha.0`, and its `profileVersion` is `15.1.0`. The core profile derives counts and rejects block-level overrides. Its word counts use the Letter and Number general categories from the bundled Unicode 15.1.0 data. They do not depend on the Unicode tables built into the host JavaScript runtime. ASCII and typographic apostrophes join adjacent word characters.

A custom metric producer must supply its exact package and profile versions and a non-negative integer word count for every block. The compiler preserves and hashes the custom producer identity and supplied counts. It still derives section, work, and publication totals and applies the envelope's explicit integer words-per-minute policy.

The published content package executes a prebuilt bundle of the exact production Markdown parser graph. The bundle contains no conditional parser imports, so Node's `--conditions=development` cannot select instrumented development code. Packaging rejects development and debug modules, external runtime imports, and parser access to the environment, filesystem, network, clock, or randomness.

## Envelope identity

Every envelope carries:

- `$schema`
- `schemaVersion`
- `publicationId`
- exact `engineVersion`
- exact `compilerVersion`
- algorithm-qualified `buildId`
- `hashes.sourceSet`
- `hashes.content`

Digests use lowercase full SHA-256 values in `sha256:<hex>` form. Canonical JSON follows RFC 8785 ordering and scalar serialization and rejects values outside the interoperable JSON data model.

`sourceSet` covers sorted logical source paths, roles, entity identities, media types, source kind, text encoding, raw byte lengths and hashes, normalized byte lengths and hashes, and normalized text geometry. `content` covers publication, source authority, work, producer, section, block, collection, extension, payload, asset, link, route, redirect, and statistics semantics. `buildId` covers the protocol and compiler versions, exact engine version, artifact boundary, source-set hash, and content hash.

Each extension payload has a stable ID, extension owner, absolute credential-free HTTP schema URL, required `sourcePaths` array, JSON data, and its own content hash. The source-path array may be empty. The core validates the schema URL but does not fetch the schema or execute extension code.

No timestamp, absolute path, working directory, Git revision, or deployment state enters these identities. Equal inputs produce byte-identical envelopes on supported runtimes. Changing raw line endings changes the raw source identity, `sourceSet`, and `buildId`. It leaves normalized manuscript semantics unchanged. A text asset retains its exact raw asset hash in content, so changing that asset's line endings also changes the `content` hash.

## Source authority

`sourceAuthority` records the canonical `publicationManifestPath` as `publication.json`, copies the publication manifest's declared `sourceRoots` and `outputRoots`, and adds the source graph's resolved shared asset root. Every source-owned record other than that repository-root publication manifest must remain inside a declared source root. Source and output roots cannot overlap. The shared asset root must sit inside a source root, and the artifact output root must be one of the declared output roots.

If a work declares an asset directory, its resolved `assetsPath` remains a source-authority boundary even when the directory is empty and no resolved asset record points into it. The compiler and public envelope validator require every such path to remain inside a declared source root.

The envelope records logical repository-relative paths, not filesystem capability. A planned secure Node loader will enforce realpath, symbolic-link, case-folding, Unicode-normalization, mount, and read-consistency rules before compilation. The current compiler verifies the injected logical authority but does not read or inspect a host filesystem.

## Routes, assets, links, and extensions

The active route registry names each home, Updates, work, collection, and section route owner. Server paths are concrete, globally unique, origin-relative values with one canonical ASCII serialization. A path begins with exactly one slash and contains at most 2,048 serialized characters. Its raw grammar is slash plus the ASCII `pchar` repertoire, with percent reserved for encoding. Non-ASCII text uses uppercase percent escapes of its UTF-8 bytes. Percent-encoded ASCII is forbidden. Decoding must produce valid NFC Unicode without whitespace or control characters. Empty interior segments and current or parent directory segments are invalid.

Manifest data, compiler input, content envelopes, hosts, browsers, and runtimes use that same exact form. Validators reject noncanonical values and never normalize them. They do not decode and re-encode a path or add or remove its trailing slash. `/work` and `/work/` therefore remain distinct routes. A server path never contains a query or fragment.

A section route is a named `ContentAddress` with a `path` and optional `anchor`. Each browser-equivalent path and decoded-anchor tuple has one section owner across the publication, though that section may expose the address under more than one local route name. Percent-encoded fragments must be well-formed UTF-8 and cannot encode whitespace, controls, otherwise forbidden fragment characters, or the `:~:` browser fragment-directive delimiter. `activeRouteNames` identifies which named addresses own active server paths. An active address cannot have an anchor. Every non-active address, including one with an anchor, must use the path of an active server route. An unanchored section address must use its own work route or an active section route owned by that same section. It cannot attach section content implicitly to home, Updates, a collection, or another work. The selected `readerAddress` follows the same rule. A resolved reader address can therefore retain a location such as `{ "path": "/reader/", "anchor": "first-reading" }` without smuggling `#first-reading` into the server route registry. The selected reader anchor uses the stricter portable content-ID grammar even though non-reader content addresses may use the general URL-fragment grammar. Redirects retain manifest order after validation.

Absolute URLs use exact ASCII HTTP or HTTPS URI serialization. Validation rejects credentials, unusable hosts, malformed percent escapes, raw Unicode, whitespace, controls, backslashes, and other input a browser would silently repair. The engine never normalizes an invalid URL into an accepted one.

Resolved assets identify a source snapshot, plain public route `href`, media type, SHA-256 hash, and optional work owner. An asset href follows the same canonical concrete route grammar. It cannot contain a query, fragment, route template, or absolute URL. It cannot collide with another asset, an active route, or a redirect source.

Resolved links identify a known work, collection, section, asset, or external target. A link source with `kind: "source"` must include an exact normalized-text `occurrence` span. A source with `kind: "semantic"` declares an unattached semantic relationship and cannot claim occurrence evidence. Both variants identify the source work, section, and optional block. The compiler rejects a link whose href differs from its resolved target.

The publication manifest declares extensions in resolution order. The host resolves exactly one matching package version for each declaration and injects those resolutions in the same order. The compiler neither imports nor executes extension packages. It rejects missing, extra, reordered, or mismatched resolutions.

Typed content payloads let those resolved extensions contribute canonical JSON data without mutating the compiler. Payloads are sorted by ID. Every listed `sourcePath` must identify an injected `extension` source owned by the payload's extension, and one source path cannot belong to two extensions. The envelope derives each extension's ordered `payloadIds` and verifies every payload hash. Extension source provenance participates in `sourceSet`; payload data and producer identity participate in `content`.

Downstream extension projections are separate artifacts. They consume the validated envelope, carry its identity, and cannot mutate it. They do not scan Markdown or reopen asset directories to invent a second account of the same publication.

## Artifact boundary

The artifact's relative path is always:

```text
content/publication-content.json
```

The envelope records that path beneath the layout's resolved output root. The canonical layout therefore uses `.publisher/content/publication-content.json`; declared layout mode may select another approved output root. `serializePublicationContentEnvelope` validates the envelope and emits canonical JSON followed by one final LF. `createPublicationContentArtifact` returns the serialized text and its separate artifact hash. Neither function writes the artifact.

A materializer is planned, not part of the current content package. That later component will write a complete candidate beneath an approved disposable output root, validate every projection's shared build identity, then replace the prior output atomically. Failed compilation or projection must leave the prior complete output untouched.

## Failure contract

`compileMarkdownWork`, `compilePublicationContent`, and `validatePublicationContentEnvelope` return `ValidationResult<T>`. A valid result contains the complete value and an empty diagnostic list. An invalid result contains deterministic diagnostics and no partial value. Malformed, semantically invalid, or safely uninspectable input does not escape these entry points as an exception.

The compiler validates each supplied text source against its original `rawBytes`. Those bytes are not embedded in the envelope. `validatePublicationContentEnvelope` therefore proves envelope internal consistency and validates constraints over declared byte lengths, normalized line geometry, span geometry, ownership, and derived identities. It cannot repeat the fatal UTF-8 decode or independently recompute the recorded source hashes from absent bytes.

`serializePublicationContentEnvelope` differs deliberately. It revalidates its input and throws `TypeError` if the envelope is invalid. `createPublicationContentArtifact` calls the serializer and inherits that behavior. Neither function performs a write, so callers must not discard the last complete artifact until serialization and every later projection have succeeded.

## Consumer rule

Every downstream projection must carry the envelope's exact `schemaVersion`, `publicationId`, `engineVersion`, and `buildId`. A consumer must reject mixed artifacts. Combining search from one build with reader data from another is not graceful degradation. It is a small, avoidable séance.
