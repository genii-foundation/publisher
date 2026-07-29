# GENII Publisher schema

`@genii-foundation/publisher-schema` contains the framework-neutral source and generated-envelope contracts for a GENII Publisher publication. It validates data and resolves repository paths without reading or writing an author's files.

The package is prerelease software. Its API may change before 1.0 through explicit, documented migrations.

## Public API

- `validatePublicationShape`, `validateWorkShape`, and `validateCollectionShape` apply the Draft 2020-12 JSON Schemas.
- `parseJsonWithUniqueObjectKeys` parses raw manifest text before shape validation. It rejects malformed JSON, duplicate object member names after escape decoding, unpaired UTF-16 surrogates, non-finite numeric conversion, and documents that exceed the fixed size, nesting, or token limits in `STRICT_JSON_LIMITS`.
- `validateContentEnvelopeShape` validates a compiled publication envelope before a renderer or other consumer accepts it.
- `validateReaderEnvelopeShape` validates the strict, public reader projection shape. Full projection identity and relationship validation belongs to the reader package.
- `EXTENSION_CAPABILITIES` and `ExtensionCapability` define the closed initial extension grant vocabulary.
- `inspectCanonicalRoutePath` reports whether a concrete public route has the one canonical serialized form and returns a stable failure reason. `isCanonicalRoutePath` is its type-guard form.
- `inspectCanonicalUrlFragment` validates a well-formed Unicode-scalar fragment and decodes it exactly once. Its successful result carries both the serialized value and the decoded browser ownership key. `isCanonicalUrlFragment` is its type-guard form.
- `inspectAbsoluteHttpUrl` validates exact ASCII HTTP and HTTPS URI serialization with a usable host and no embedded credentials. It rejects whitespace, controls, raw Unicode, malformed percent escapes, backslashes, and other input a browser would silently repair. `isAbsoluteHttpUrl` is its type-guard form.
- `REQUIRED_ATTRIBUTION` and `GENII_PUBLISHER_SOURCE_CODE_URL` expose the renderer-owned CPAL attribution contract through the lightweight `@genii-foundation/publisher-schema/attribution` subpath.
- `resolvePublicationLayout` is the safe pre-load gate for canonical and declared manifest paths, lexical boundaries, and duplicate manifest targets.
- `resolveWorkSourcePaths` is the shared resolver for manifest-relative and repository-relative manuscript and asset paths.
- `validatePublicationSemantics` checks relationships across loaded manifests, route continuity, attribution, protocol versions, and engine compatibility. Success returns a resolved source graph.
- `resolvePublicationSourcesForContentCompilation` is the narrow compiler-only source graph resolver used before adapter-owned section routes exist. It defers only unresolved internal redirect terminal checks. Redirect syntax, duplicate redirect sources, collisions with already-known active routes, and loops remain enforced. A compiler must still perform final redirect validation before accepting or serializing an artifact.
- Shape and semantic validation return deterministic diagnostics with stable codes and document-local JSON Pointer paths. Shape validators capture one canonically ordered frozen snapshot, reject runtime values outside the JSON data model, and validate only that detached value. Generated JSON Schema validation uses fail-fast mode to prevent near-limit hostile arrays from allocating a document-wide all-errors graph. Branching keywords may return the small deterministic set needed to explain their failed alternatives. JSON-domain and semantic collectors retain the lexicographically smallest 255 details with one exact omitted-count sentinel. Semantic diagnostics also identify their source document. Validation never repairs or rewrites input.

Content and reader envelopes receive a browser-safe resource preflight before full traversal. Shared limits cover every root array, aggregate sections, blocks, collection memberships, section routes and references, continuity groups and references, payload source paths, source line starts, active routes, redirects, and a combined 128-level and 5,000,000-node budget. The root is level 1. Raw envelope schemas repeat every local array and map ceiling. Successful shape validation returns the frozen detached snapshot, not the caller-owned object.

The caller owns file access. It shape-validates `publication.json`, resolves the publication layout, applies the filesystem-aware checks below, then loads and shape-validates the referenced work and collection manifests. It supplies those manifests as path-keyed immutable maps to semantic validation. This keeps the protocol package independent of a command-line interface, web framework, host, and deployment provider.

Raw manifest ingestion must call `parseJsonWithUniqueObjectKeys` before any shape validator. `JSON.parse` silently keeps only one value when an object repeats a member name, so it cannot establish an unambiguous protocol document by itself.

Shape validation is not artifact acceptance. A renderer or other content consumer must use `validatePublicationContentEnvelope` from `@genii-foundation/publisher-content`, which applies the public shape validator and the derived identity, source custody, route authority, extension payload, and continuity checks. Calling `validateContentEnvelopeShape` alone proves structure only.

Browser runtimes may import the route primitives alone from `@genii-foundation/publisher-schema/routes`, the renderer-owned attribution constants from `@genii-foundation/publisher-schema/attribution`, and reader-envelope types, constants, and shape validation from `@genii-foundation/publisher-schema/reader`. None of these subpaths loads semantic validation or package-resolution dependencies.

The reader envelope is an audience-specific projection, not a second authoring source. It records its own reader build identity and the exact content-envelope identity it projects. Its fixed `textProfile` defines block-local Markdown offsets as unnormalized UTF-16 code units with exclusive end boundaries. Sections and blocks carry explicit nullable reader addresses and DOM IDs. Source-backed links use those block-local Markdown ranges rather than repository provenance.

The reader schema excludes arbitrary metadata, repository paths, source provenance, extension declarations, capability grants, configuration, payloads, provider state, credentials, progress, bookmarks, preferences, analytics, audio state, and sync state. Public assets retain only the identity, public href, media type, hash, and optional work owner that a reader needs. Every collection records its effective publication state rather than asking a browser to infer inheritance. A retained collection may have an empty `workIds` array after audience filtering removes draft works.

Public envelope validation proves internal consistency and validates constraints over the byte lengths and normalized-text geometry declared in the envelope. It does not prove the original source bytes because the envelope does not contain them. Only compilation can perform the fatal UTF-8 comparison and compute source hashes from injected bytes.

The content schema records adapter identity as `{ id, package, version }` and metric identity as `{ id, package, version, profileVersion }`. For the core `unicode-word-count` producer, `package` is `@genii-foundation/publisher-content`, `version` equals the exact content compiler and package version, and `profileVersion` is `15.1.0`.

## Safety boundary

The schemas and pure runtime prove lexical path safety only. Portable repository paths may use up to 1,024 well-formed Unicode scalar values in Unicode 15.1 NFC, subject to secondary ceilings of 2,048 UTF-16 code units, 4,096 UTF-8 bytes, 256 segments, and 255 UTF-8 bytes per segment. They reject absolute paths, Windows drive prefixes, backslashes, current and parent directory segments, empty segments, trailing separators, percent-encoded octets, query or fragment metacharacters, ASCII controls, Unicode line and paragraph separators, Unicode bidirectional controls, Windows-forbidden filename characters, Windows reserved device names, and segments ending in an ASCII dot or space.

Repository identity applies the bundled Unicode 15.1 full default case-fold mappings with CaseFolding statuses C and F, then a bundled Unicode 15.1 canonical normalizer. It does not use locale-sensitive or Turkic mappings, `String.prototype.normalize`, or host Unicode tables. Code points unassigned in Unicode 15.1 retain canonical combining class zero and have no decomposition in this profile even if a later Unicode release assigns them. Windows segment identity then removes the trailing ASCII dots and spaces that Win32 ignores. Native-script filenames such as `出版/作品/第一章.md` remain valid. Full-fold equivalents such as `Straße.md` and `STRASSE.MD`, sigma variants, Unicode 15.1 NFC equivalents, case variants, and Windows trailing-dot or trailing-space aliases have one portable identity.

The display-control policy uses fixed explicit code-point ranges. It rejects U+061C, U+200E, U+200F, U+202A through U+202E, U+2066 through U+2069, U+2028, and U+2029. It preserves U+200C ZERO WIDTH NON-JOINER, U+200D ZERO WIDTH JOINER, variation selectors, and other well-formed NFC characters because those can carry orthographic or emoji meaning. The protocol does not erase or confusable-map those characters. They retain exact byte spelling and remain distinct unless Unicode 15.1 default case folding and NFC make them equivalent.

Internal server paths have one canonical serialized form. A path begins with exactly one slash, contains at most 2,048 serialized ASCII characters, and uses only slash plus the raw ASCII `pchar` repertoire, with percent reserved for encoding. Non-ASCII text uses uppercase percent escapes of its UTF-8 bytes, such as `/caf%C3%A9`. Percent-encoded ASCII is forbidden, and decoding must produce Unicode 15.1 NFC without whitespace or control characters. Route and fragment inspection uses the same bundled normalizer as repository paths, never host Unicode tables. Empty interior segments and current or parent directory segments are invalid. The trailing slash is significant, so `/work` and `/work/` are different valid routes.

The raw JSON Schemas enforce the regular ASCII grammar, well-formed surrogate pairs, and canonical UTF-8 byte forms. Complete decoded Unicode and NFC validation belongs to the package runtime. A direct JSON Schema match alone does not prove the NFC requirement or semantic URL validity.

Manifest validation, compilation, artifact validation, hosts, browser runtimes, and renderers use that exact serialized form. They reject noncanonical paths and never normalize, decode and re-encode, add a slash, or remove one. Queries and fragments never belong in a server path. Compiled section addresses represent an optional fragment as a separate `anchor` field. A legacy public path containing a space needs an explicit host or edge redirect to a renamed canonical public URL. It cannot enter the protocol through silent normalization.

A string that passes these checks is not proof that the referenced filesystem object remains inside the publication root. Every filesystem loader must resolve real paths against an approved root and reject escapes caused by symbolic links, case folding, Unicode normalization, mount behavior, or a source change between validation and access. A loader must use filesystem-aware containment checks instead of trusting string prefixes.

Compiled `sourceAuthority` always records the canonical root manifest path as `publication.json`, along with declared source roots, output roots, and the shared asset root. Every declared work `assetsPath` must remain inside a source root even when it is empty. Every browser-equivalent section content address, defined by its path and decoded optional anchor, has one section owner across the publication. Every section also records an explicit `readerAddress`, and every block records a portable reader `anchor` separate from its compiler projection ID. That anchor has a public destination only when the section has a reader address.

Exact package and artifact SemVer strings contain at most 256 characters and use a bounded grammar. Continuity group identity uniqueness is enforced by the semantic content and reader runtimes with linear sets rather than deep array comparison in the raw envelope schema.

Theme, extension, audio, and sync package references are declarative inputs. Every extension requires a nonempty ordered array of unique grants from `content.project`, `renderer.slot`, `renderer.client`, `host.route`, and `host.handler`. The pure schema runtime does not inspect installed packages or decide whether a package supports the active engine and protocol versions. Later engine orchestration owns package resolution, availability, compatibility, and lockfile enforcement. Resolved extension input must repeat the manifest grants exactly and in the same order. Compiled content records that order, the exact resolved extension version, and any typed, source-provenanced extension payloads so downstream consumers never infer package identity or authority from a manifest range.

The raw schemas are also exported:

```text
@genii-foundation/publisher-schema/publication.schema.json
@genii-foundation/publisher-schema/work.schema.json
@genii-foundation/publisher-schema/collection.schema.json
@genii-foundation/publisher-schema/content-envelope.schema.json
@genii-foundation/publisher-schema/reader-envelope.schema.json
```

## Release safety

The source and content schemas currently accept contract version `1.0`. The initial contract remains unpublished while its complete compiler and reader boundary is assembled. The first public package release freezes that contract. After publication, incompatible meaning changes require a new schema version and an explicit migration. The JavaScript package remains prerelease software, so exported convenience APIs may still evolve before package 1.0 without silently changing a published schema version.

Prereleases must publish with an explicit `--tag next`. Stable versions use `latest`. The trusted release workflow builds every package through its full lifecycle with the exact pinned npm CLI, requires every working-tree provenance record to be accepted and live-bound to the current Git diff, scans the resulting candidate tarballs, validates the tag against the versions inside those archives, and retains those exact files. It may publish only those retained paths. Direct package-directory publication fails by design because it would let npm rebuild different bytes after provenance acceptance. Lifecycle scripts remain defense in depth, so npm publishing credentials must reject workflows that disable scripts or substitute another tarball.

## Unicode regeneration

The checked-in generator binds four inputs:

- the exact installed files consumed from `@unicode/unicode-15.1.0` version 1.6.17
- preserved official Unicode 15.1.0 `UnicodeData.txt`, SHA-256 `2fc713e6a31a87c4850a37fe2caffa4218180fadb5de86b43a143ddb4581fb86`
- the bundled normalization JSON derived byte-for-byte from that raw file
- preserved official Unicode 15.1.0 `NormalizationTest.txt`, SHA-256 `871238e37e3be0696ec2bd0891119a041b052da1a84485eda05a5438724b223e`

Every ordinary schema build verifies both raw checksums, re-derives and compares the normalization JSON, runs all official NFC conformance cases against the generated tables, regenerates the expected TypeScript in memory, and compares it to the checked-in source. The workspace test gate then runs the full official conformance suite against the compiled public `normalizePortableRepositoryText` export.

This command performs the ordinary read-only check:

```bash
node scripts/generate-case-folding.mjs
```

`--check-unicode-data /path/to/UnicodeData.txt` can compare a separately supplied artifact to the same derived snapshot. `--import-unicode-data` and `--write` are maintainer update operations. Review their resulting raw and derived data, generated code, conformance results, notices, licenses, and protocol effects before committing them. Release and provenance validation use only read-only checks.

## License

Covered code is available under CPAL 1.0. External network deployment that lets anyone other than the deployer use the covered code triggers source availability obligations. Graphical publications must preserve the GENII Publisher attribution defined in Exhibit B and the source protocol:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

Every graphical renderer must also expose the validated `sourceCodeUrl` as a conspicuous source availability link alongside the persistent footer attribution. A manifest value alone does not satisfy the renderer interface contract.

See `LICENSE`, `NOTICE.md`, `LEGAL`, `CHANGES.md`, and `SOURCE-NOTICE` in the package.

The bundled Unicode case-fold table remains under its upstream MIT license.
The bundled normalization data remains under the Unicode License V3. See
`THIRD_PARTY_NOTICES.md`,
`third-party-licenses/unicode-15.1.0-LICENSE-MIT.txt`, and
`third-party-licenses/unicode-data-LICENSE.txt`.
