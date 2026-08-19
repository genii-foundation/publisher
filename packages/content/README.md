# GENII Publisher content

`@genii-foundation/publisher-content` contains the framework-neutral content compilation primitives for GENII Publisher.

The package consumes publication contracts from the exact `@genii-foundation/publisher-schema` version declared in its package metadata. It accepts validated, injected publication data and emits deterministic, versioned content envelopes. It does not discover author files, import generated host data, or depend on Next.js, React, Vercel, Supabase, or an audio provider.

The package is prerelease software. Its API may change before 1.0 through explicit, documented migrations.

## Current API

- `compileMarkdownWork` creates one neutral CommonMark work input from an injected Markdown string and explicit durable work and root-section IDs. It emits separate block projection IDs and public anchors plus an explicit work or named-route reader location.
- `compilePublicationContent` accepts one complete in-memory publication input and returns a validated `PublicationContentEnvelope`.
- `validatePublicationContentEnvelope` performs JSON Schema and semantic validation. It recomputes hierarchy, navigation, routes, redirects, links, assets, extension payload ownership, statistics, content hashes, and build identity from the data retained in the envelope.
- `serializePublicationContentEnvelope` validates an envelope and emits canonical JSON followed by one LF.
- `createPublicationContentArtifact` returns serialized text, artifact metadata, and the text hash. It does not write a file.
- `validateAudioCheckpoint` validates immutable narration evidence against the public checkpoint schema, canonical timestamps, source and model identity, sorted units, derived timing object names, alignment quality, exact aggregate statistics, and the canonical unit fingerprint. It never contacts or mutates an object store.
- `planAudioCheckpointPromotion` validates one current audio catalog and checkpoint, requires the exact base catalog hash and exact selected-unit coverage, preserves every unselected clip and narrator, and returns a validated immutable candidate plus both catalog hashes. It is a dry run with no storage or write authority.

`resolvePublicationSourcesForContentCompilation` is a current export of `@genii-foundation/publisher-schema`. Hosts use that named resolver before adapters have supplied section routes. It defers only unresolved internal redirect terminal checks. Redirect syntax, duplicate redirect sources, collisions with already-known active routes, and loops still fail. `compilePublicationContent` reruns the resolver and compares its result with the injected source graph. It then validates redirects again against the complete route registry. Final redirect validation is mandatory because adapter-owned section routes do not exist at source-resolution time.

The package does not currently export a filesystem loader, extension loader, projection runner, or artifact materializer. Those planned integration layers will sit outside the compiler. Canonical and declared layouts are already resolved by the schema package. File access, realpath containment, package loading, and atomic output replacement remain host responsibilities.

## Input contracts

The compiler requires stable section IDs from author source or an exact-version adapter. It never derives durable identity from a mutable title, route, path, or traversal position. The neutral Markdown helper emits one section and content-addressed block projection IDs. It does not infer a publication hierarchy.

Adapter work records, resolved extension data, payloads, assets, and links are output from explicitly installed in-process producers. They are trusted application code, not an isolation boundary. Aggregate count checks limit accidental expansion after a producer returns. They cannot sandbox a hostile producer that can allocate, loop, read, or terminate the process before returning. Hosts that execute untrusted producers need a separate process boundary with operating-system resource limits.

Every text `CompilationSourceInput` must include `contents` and the exact `rawBytes` from which that string was decoded. The compiler performs a fatal UTF-8 decode and rejects a mismatch. It records raw byte identity, normalizes only CRLF and CR line endings to LF, and records normalized identity separately. Block and link ranges address the normalized string. Their offsets count JavaScript UTF-16 code units, their lines and columns are one-based, and their end positions are exclusive.

Each work records exact adapter and metric producer identities. Omitting `metrics` selects the core producer:

```json
{
  "id": "unicode-word-count",
  "package": "@genii-foundation/publisher-content",
  "version": "0.1.0-alpha.0",
  "profileVersion": "15.1.0"
}
```

Every metric identity has `{ id, package, version, profileVersion }`. For the core producer, `version` is the exact `@genii-foundation/publisher-content` compiler and package version, while `profileVersion` identifies the bundled Unicode 15.1.0 word profile. The example shows the current prerelease. The core producer derives every block word count and rejects supplied overrides. A custom producer must identify its package, exact package version, and exact profile version and supply a non-negative integer `wordCount` for every block. The chosen identity and counts participate in content identity.

Publication extensions resolve in manifest order. The `extensions` input must contain exactly one matching ID and package for every declaration, in the same order, with an exact semantic version and the manifest's exact ordered capability grants. The compiler rejects missing, extra, reordered, mismatched, unknown, or duplicate grants. Compiled extensions retain the grants, and their order participates in content and build identity. Payloads declare an extension owner, an absolute credential-free HTTP schema URL, a required `sourcePaths` array, JSON data, and a stable ID. The array may be empty; every listed path must resolve to an injected `extension` source owned by the same extension. The core records the schema URL but does not fetch or execute it. Payloads are sorted by ID, hashed, and linked back through each extension's derived `payloadIds`.

The envelope copies the manifest's `sourceRoots` and `outputRoots` into `sourceAuthority`, records the canonical `publicationManifestPath` as `publication.json`, and records the resolved shared asset root. Every injected source except that root publication manifest must remain inside a declared source root. Source and output roots must not overlap, the shared asset root must be inside a source root, and the artifact output root must be declared. A work's declared `assetsPath` must remain inside a source root even when the directory is empty and no asset record is emitted.

Asset `href` values are plain concrete origin-relative route paths. Every route path uses the same canonical ASCII serialization as manifests, artifacts, hosts, and browser runtimes. It begins with exactly one slash, contains at most 2,048 serialized characters, and uses only slash plus the raw ASCII `pchar` repertoire, with percent reserved for encoding. Non-ASCII text uses uppercase percent escapes of its UTF-8 bytes. Percent-encoded ASCII is forbidden, and decoding must produce valid NFC Unicode without whitespace or controls. A trailing slash remains significant. The compiler and validator reject noncanonical input and never normalize it.

Asset paths cannot contain a query or fragment and cannot collide with another asset, an active route, or a redirect source. Section reader locations use structured `{ path, anchor? }` addresses. Each exact path and browser-decoded optional anchor tuple has one section owner across the publication. Fragment validation rejects the browser's `:~:` fragment-directive delimiter, including percent-encoded forms. Every non-active address, including one with an anchor, must use the path of an active server route. An unanchored section address, including the selected reader address, must use that section's work route or an active section route owned by the same section. It cannot implicitly attach content to home, Updates, a collection, or another work. Resolved link hrefs may use one validated fragment or an exact ASCII, credential-free HTTP or HTTPS URI. URL validation rejects input that depends on browser repair.

Adapter sections declare `readerLocation` as `work`, `route`, or `none`. The compiler resolves it to an explicit `readerAddress`; it never chooses from route-map order. Navigable sections cannot select `none`, and only one section may own an unfragmented work route. Blocks carry a reader `anchor` separate from their compiler `id`. The anchor becomes public only when its section has a reader address. The compiler qualifies block anchors beneath anchored section locations and rejects publication-wide section and block address collisions.

Block content hashes intentionally exclude the public anchor. A pure anchor repair preserves content relocation evidence, while the section and every parent build identity still change because section identity includes the anchor.

## Deterministic runtime

The published tarball contains a prebuilt Markdown parser bundle from the exact locked production graph. The bundle has no external parser imports and rejects development modules, debug code, environment access, filesystem access, network access, clocks, and randomness during packaging. Node's `--conditions=development` cannot select a different parser implementation for a fixed release.

The package also bundles Unicode 15.1 word-classification data. The supported Node range is explicit in package metadata and is exercised across Node 22, 24, and 26. Host Unicode updates and package export conditions therefore cannot alter compiler output for a fixed release.

## Failure contract

`compileMarkdownWork`, `compilePublicationContent`, and `validatePublicationContentEnvelope` return a discriminated `ValidationResult`. Invalid or uninspectable input returns `valid: false` with deterministic diagnostics and no partial value. These entry points do not throw merely because an input has the wrong shape, contains accessors, or fails semantic validation.

Compilation rejects oversized aggregate input before section, block, asset, link, extension, or payload processing. The fixed ceilings are 20,000 sources, 4,999 works, 9,997 collections, 100,000 collection work references, 50,000 sections, 100,000 blocks, 50,000 assets, 100,000 links, 512 extensions, 10,000 payloads, and 100,000 payload source-path references. The source and collection-membership ceilings are shared with the publication protocol and application loader. Envelope validation captures one frozen detached snapshot and applies the same root counts plus route, nested-reference, depth, and node budgets before full traversal. Generated structural validation uses fail-fast mode and may return the small deterministic error set required by a failed branching keyword. JSON-domain and semantic diagnostics retain at most 256 records in deterministic order and include one exact omitted-count record when further details were omitted. Serialization and artifact construction use the validated snapshot rather than reading caller state again.

Compilation checks supplied `rawBytes` against text before the envelope exists. Public envelope validation proves internal consistency and validates the declared byte and normalized-text geometry retained in the artifact. It cannot decode or hash the original bytes again because the envelope does not contain them. Independent source attestation requires separate access to the original bytes.

Serialization has a stricter contract. `serializePublicationContentEnvelope` throws `TypeError` when validation fails, and `createPublicationContentArtifact` inherits that behavior. Neither function writes output. A future materializer must preserve the last complete artifact when compilation, validation, serialization, or projection fails.

## Release safety

This package pins its internal schema dependency to one exact version. Prereleases require the `next` tag and stable versions use `latest`.

The trusted release workflow builds and bundles this package in an owned clean workspace with the exact pinned npm CLI, scans and attests that candidate tarball, validates its archived version and requested tag, and publishes only the same retained file. Direct package-directory publication is forbidden because it would rebuild the package after attestation. Lifecycle scripts remain defense in depth. The workflow must independently verify the exact schema dependency, source revision, and publication order, and the referenced schema version must already be available.

## License

Covered code is available under CPAL 1.0. External network deployment that lets anyone other than the deployer use the covered code triggers source availability obligations. Graphical publications must preserve the GENII Publisher attribution defined in Exhibit B:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

Every graphical renderer must also expose the publication's validated source location as a conspicuous source availability link alongside the persistent footer attribution.

See `LICENSE`, `NOTICE.md`, `LEGAL`, `CHANGES.md`, `SOURCE-NOTICE`, `THIRD_PARTY_NOTICES.md`, and `third-party-licenses/` in the package.
