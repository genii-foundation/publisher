# GENII Publisher content

`@genii-foundation/publisher-content` contains the framework-neutral content compilation primitives for GENII Publisher.

The package consumes publication contracts from the exact `@genii-foundation/publisher-schema` version declared in its package metadata. It accepts validated, injected publication data and emits deterministic, versioned content envelopes. It does not discover author files, import generated host data, or depend on Next.js, React, Vercel, Supabase, or an audio provider.

The package is prerelease software. Its API may change before 1.0 through explicit, documented migrations.

## Current API

- `compileMarkdownWork` creates one neutral CommonMark work input from an injected Markdown string and explicit durable work and root-section IDs.
- `compilePublicationContent` accepts one complete in-memory publication input and returns a validated `PublicationContentEnvelope`.
- `validatePublicationContentEnvelope` performs JSON Schema and semantic validation. It recomputes hierarchy, navigation, routes, redirects, links, assets, extension payload ownership, statistics, content hashes, and build identity from the data retained in the envelope.
- `serializePublicationContentEnvelope` validates an envelope and emits canonical JSON followed by one LF.
- `createPublicationContentArtifact` returns serialized text, artifact metadata, and the text hash. It does not write a file.

`resolvePublicationSourcesForContentCompilation` is a current export of `@genii-foundation/publisher-schema`. Hosts use that named resolver before adapters have supplied section routes. It defers only unresolved internal redirect terminal checks. Redirect syntax, duplicate redirect sources, collisions with already-known active routes, and loops still fail. `compilePublicationContent` reruns the resolver and compares its result with the injected source graph. It then validates redirects again against the complete route registry. Final redirect validation is mandatory because adapter-owned section routes do not exist at source-resolution time.

The package does not currently export a filesystem loader, extension loader, projection runner, or artifact materializer. Those planned integration layers will sit outside the compiler. Canonical and declared layouts are already resolved by the schema package. File access, realpath containment, package loading, and atomic output replacement remain host responsibilities.

## Input contracts

The compiler requires stable section IDs from author source or an exact-version adapter. It never derives durable identity from a mutable title, route, path, or traversal position. The neutral Markdown helper emits one section and content-addressed block projection IDs. It does not infer a publication hierarchy.

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

Publication extensions resolve in manifest order. The `extensions` input must contain exactly one matching ID and package for every declaration, in the same order, with an exact semantic version. Payloads declare an extension owner, an absolute credential-free HTTP schema URL, a required `sourcePaths` array, JSON data, and a stable ID. The array may be empty; every listed path must resolve to an injected `extension` source owned by the same extension. The core records the schema URL but does not fetch or execute it. Payloads are sorted by ID, hashed, and linked back through each extension's derived `payloadIds`.

The envelope copies the manifest's `sourceRoots` and `outputRoots` into `sourceAuthority`, records the canonical `publicationManifestPath` as `publication.json`, and records the resolved shared asset root. Every injected source except that root publication manifest must remain inside a declared source root. Source and output roots must not overlap, the shared asset root must be inside a source root, and the artifact output root must be declared. A work's declared `assetsPath` must remain inside a source root even when the directory is empty and no asset record is emitted.

Asset `href` values are plain concrete origin-relative route paths. They cannot contain a query or fragment and cannot collide with another asset, an active route, or a redirect source. Section reader locations use structured `{ path, anchor? }` addresses. Each exact path and optional anchor tuple has one section owner across the publication. Every non-active address, including one with an anchor, must use the path of an active server route. Resolved link hrefs may use one validated fragment or an absolute credential-free HTTP URL.

## Deterministic runtime

The published tarball contains a prebuilt Markdown parser bundle from the exact locked production graph. The bundle has no external parser imports and rejects development modules, debug code, environment access, filesystem access, network access, clocks, and randomness during packaging. Node's `--conditions=development` cannot select a different parser implementation for a fixed release.

The package also bundles Unicode 15.1 word-classification data. The supported Node range is explicit in package metadata and is exercised across Node 22, 24, and 26. Host Unicode updates and package export conditions therefore cannot alter compiler output for a fixed release.

## Failure contract

`compileMarkdownWork`, `compilePublicationContent`, and `validatePublicationContentEnvelope` return a discriminated `ValidationResult`. Invalid or uninspectable input returns `valid: false` with deterministic diagnostics and no partial value. These entry points do not throw merely because an input has the wrong shape, contains accessors, or fails semantic validation.

Compilation checks supplied `rawBytes` against text before the envelope exists. Public envelope validation proves internal consistency and validates the declared byte and normalized-text geometry retained in the artifact. It cannot decode or hash the original bytes again because the envelope does not contain them. Independent source attestation requires separate access to the original bytes.

Serialization has a stricter contract. `serializePublicationContentEnvelope` throws `TypeError` when validation fails, and `createPublicationContentArtifact` inherits that behavior. Neither function writes output. A future materializer must preserve the last complete artifact when compilation, validation, serialization, or projection fails.

## Release safety

This package pins its internal schema dependency to one exact version. Prereleases must publish with an explicit `--tag next`. Stable versions may rely on npm's default `latest` tag or pass `--tag latest` explicitly.

The source package checks the release tag during `prepublishOnly`, but lifecycle scripts are only defense in depth. A trusted release workflow must independently verify the package version, requested tag, exact schema dependency, source revision, and publication order. The referenced schema version must already be available before this package is published.

## License

Covered code is available under CPAL 1.0. External network deployment that lets anyone other than the deployer use the covered code triggers source availability obligations. Graphical publications must preserve the GENII Publisher attribution defined in Exhibit B:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

Every graphical renderer must also expose the publication's validated source location as a conspicuous source availability link alongside the persistent footer attribution.

See `LICENSE`, `NOTICE.md`, `LEGAL`, `CHANGES.md`, `SOURCE-NOTICE`, `THIRD_PARTY_NOTICES.md`, and `third-party-licenses/` in the package.
