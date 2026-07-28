# GENII Publisher schema

`@genii-foundation/publisher-schema` contains the framework-neutral source and generated-envelope contracts for a GENII Publisher publication. It validates data and resolves repository paths without reading or writing an author's files.

The package is prerelease software. Its API may change before 1.0 through explicit, documented migrations.

## Public API

- `validatePublicationShape`, `validateWorkShape`, and `validateCollectionShape` apply the Draft 2020-12 JSON Schemas.
- `validateContentEnvelopeShape` validates a compiled publication envelope before a renderer or other consumer accepts it.
- `inspectCanonicalRoutePath` reports whether a concrete public route has the one canonical serialized form and returns a stable failure reason. `isCanonicalRoutePath` is its type-guard form.
- `resolvePublicationLayout` is the safe pre-load gate for canonical and declared manifest paths, lexical boundaries, and duplicate manifest targets.
- `resolveWorkSourcePaths` is the shared resolver for manifest-relative and repository-relative manuscript and asset paths.
- `validatePublicationSemantics` checks relationships across loaded manifests, route continuity, attribution, protocol versions, and engine compatibility. Success returns a resolved source graph.
- `resolvePublicationSourcesForContentCompilation` is the narrow compiler-only source graph resolver used before adapter-owned section routes exist. It defers only unresolved internal redirect terminal checks. Redirect syntax, duplicate redirect sources, collisions with already-known active routes, and loops remain enforced. A compiler must still perform final redirect validation before accepting or serializing an artifact.
- Shape and semantic validation return deterministic diagnostics with stable codes and document-local JSON Pointer paths. Shape validation rejects runtime values outside the JSON data model. Semantic diagnostics also identify their source document. Validation never repairs or rewrites input.

The caller owns file access. It shape-validates `publication.json`, resolves the publication layout, applies the filesystem-aware checks below, then loads and shape-validates the referenced work and collection manifests. It supplies those manifests as path-keyed immutable maps to semantic validation. This keeps the protocol package independent of a command-line interface, web framework, host, and deployment provider.

Shape validation is not artifact acceptance. A renderer or other content consumer must use `validatePublicationContentEnvelope` from `@genii-foundation/publisher-content`, which applies the public shape validator and the derived identity, source custody, route authority, extension payload, and continuity checks. Calling `validateContentEnvelopeShape` alone proves structure only.

Browser runtimes may import the route primitives alone from `@genii-foundation/publisher-schema/routes`. That subpath has no semantic-validator or package-resolution dependency.

Public envelope validation proves internal consistency and validates constraints over the byte lengths and normalized-text geometry declared in the envelope. It does not prove the original source bytes because the envelope does not contain them. Only compilation can perform the fatal UTF-8 comparison and compute source hashes from injected bytes.

The content schema records adapter identity as `{ id, package, version }` and metric identity as `{ id, package, version, profileVersion }`. For the core `unicode-word-count` producer, `package` is `@genii-foundation/publisher-content`, `version` equals the exact content compiler and package version, and `profileVersion` is `15.1.0`.

## Safety boundary

The schemas and pure runtime prove lexical path safety only. Portable repository paths reject absolute paths, Windows drive prefixes, backslashes, current and parent directory segments, empty segments, trailing separators, percent-encoded octets, query or fragment metacharacters, and ASCII controls.

Internal server paths have one canonical serialized form. A path begins with exactly one slash, contains at most 2,048 serialized ASCII characters, and uses only slash plus the raw ASCII `pchar` repertoire, with percent reserved for encoding. Non-ASCII text uses uppercase percent escapes of its UTF-8 bytes, such as `/caf%C3%A9`. Percent-encoded ASCII is forbidden, and decoding must produce valid NFC Unicode without whitespace or control characters. Empty interior segments and current or parent directory segments are invalid. The trailing slash is significant, so `/work` and `/work/` are different valid routes.

The raw JSON Schemas enforce the regular ASCII grammar and canonical UTF-8 byte forms. Complete decoded Unicode and NFC validation belongs to the package runtime. A direct JSON Schema match alone does not prove the NFC requirement.

Manifest validation, compilation, artifact validation, hosts, browser runtimes, and renderers use that exact serialized form. They reject noncanonical paths and never normalize, decode and re-encode, add a slash, or remove one. Queries and fragments never belong in a server path. Compiled section addresses represent an optional fragment as a separate `anchor` field. A legacy public path containing a space needs an explicit host or edge redirect to a renamed canonical public URL. It cannot enter the protocol through silent normalization.

A string that passes these checks is not proof that the referenced filesystem object remains inside the publication root. Every filesystem loader must resolve real paths against an approved root and reject escapes caused by symbolic links, case folding, Unicode normalization, mount behavior, or a source change between validation and access. A loader must use filesystem-aware containment checks instead of trusting string prefixes.

Compiled `sourceAuthority` always records the canonical root manifest path as `publication.json`, along with declared source roots, output roots, and the shared asset root. Every declared work `assetsPath` must remain inside a source root even when it is empty. Every browser-equivalent section content address, defined by its path and decoded optional anchor, has one section owner across the publication. Every section also records an explicit `readerAddress`, and every block records a portable reader `anchor` separate from its compiler projection ID. That anchor has a public destination only when the section has a reader address.

Theme, extension, audio, and sync package references are declarative inputs. The pure schema runtime does not inspect installed packages or decide whether a package supports the active engine and protocol versions. Later engine orchestration owns package resolution, availability, compatibility, and lockfile enforcement. Compiled content records the exact resolved extension version and any typed, source-provenanced extension payloads so downstream consumers never infer package identity from a manifest range.

The raw schemas are also exported:

```text
@genii-foundation/publisher-schema/publication.schema.json
@genii-foundation/publisher-schema/work.schema.json
@genii-foundation/publisher-schema/collection.schema.json
@genii-foundation/publisher-schema/content-envelope.schema.json
```

## Release safety

The source and content schemas currently accept contract version `1.0`. The initial contract remains unpublished while its complete compiler and reader boundary is assembled. The first public package release freezes that contract. After publication, incompatible meaning changes require a new schema version and an explicit migration. The JavaScript package remains prerelease software, so exported convenience APIs may still evolve before package 1.0 without silently changing a published schema version.

Prereleases must publish with an explicit `--tag next`. Stable versions may rely on npm's default `latest` tag or pass `--tag latest` explicitly. The source package checks that rule during `prepublishOnly`, but lifecycle scripts are only defense in depth. Publishing with scripts disabled or publishing a prebuilt tarball can bypass them. The trusted release workflow must inspect the version and requested tag independently, publish from this source directory with lifecycle scripts enabled, and reject any other path.

## License

Covered code is available under CPAL 1.0. External network deployment that lets anyone other than the deployer use the covered code triggers source availability obligations. Graphical publications must preserve the GENII Publisher attribution defined in Exhibit B and the source protocol:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

Every graphical renderer must also expose the validated `sourceCodeUrl` as a conspicuous source availability link alongside the persistent footer attribution. A manifest value alone does not satisfy the renderer interface contract.

See `LICENSE`, `NOTICE.md`, `LEGAL`, `CHANGES.md`, and `SOURCE-NOTICE` in the package.
