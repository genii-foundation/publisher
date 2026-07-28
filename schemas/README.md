# GENII Publisher schema

`@genii-foundation/publisher-schema` contains the framework-neutral source contracts for a GENII Publisher publication. It validates data and resolves repository paths without reading or writing an author's files.

The package is prerelease software. Its API may change before 1.0 through explicit, documented migrations.

## Public API

- `validatePublicationShape`, `validateWorkShape`, and `validateCollectionShape` apply the Draft 2020-12 JSON Schemas.
- `resolvePublicationLayout` is the safe pre-load gate for canonical and declared manifest paths, lexical boundaries, and duplicate manifest targets.
- `resolveWorkSourcePaths` is the shared resolver for manifest-relative and repository-relative manuscript and asset paths.
- `validatePublicationSemantics` checks relationships across loaded manifests, route continuity, attribution, protocol versions, and engine compatibility. Success returns a resolved source graph.
- Shape and semantic validation return deterministic diagnostics with stable codes and document-local JSON Pointer paths. Shape validation rejects runtime values outside the JSON data model. Semantic diagnostics also identify their source document. Validation never repairs or rewrites input.

The caller owns file access. It shape-validates `publication.json`, resolves the publication layout, applies the filesystem-aware checks below, then loads and shape-validates the referenced work and collection manifests. It supplies those manifests as path-keyed immutable maps to semantic validation. This keeps the protocol package independent of a command-line interface, web framework, host, and deployment provider.

## Safety boundary

The schemas and pure runtime prove lexical path safety only. Portable repository paths reject absolute paths, Windows drive prefixes, backslashes, current and parent directory segments, empty segments, trailing separators, percent-encoded octets, query or fragment metacharacters, and ASCII controls. Internal routes apply corresponding origin-relative rules. `/` is the only route that may end in a slash.

A string that passes these checks is not proof that the referenced filesystem object remains inside the publication root. Every filesystem loader must resolve real paths against an approved root and reject escapes caused by symbolic links, case folding, Unicode normalization, mount behavior, or a source change between validation and access. A loader must use filesystem-aware containment checks instead of trusting string prefixes.

Theme, extension, audio, and sync package references are declarative inputs. The pure schema runtime does not inspect installed packages or decide whether a package supports the active engine and protocol versions. Later engine orchestration owns package resolution, availability, compatibility, and lockfile enforcement.

The raw schemas are also exported:

```text
@genii-foundation/publisher-schema/publication.schema.json
@genii-foundation/publisher-schema/work.schema.json
@genii-foundation/publisher-schema/collection.schema.json
```

## Release safety

Prereleases must publish with an explicit `--tag next`. Stable versions may rely on npm's default `latest` tag or pass `--tag latest` explicitly. The source package checks that rule during `prepublishOnly`, but lifecycle scripts are only defense in depth. Publishing with scripts disabled or publishing a prebuilt tarball can bypass them. The trusted release workflow must inspect the version and requested tag independently, publish from this source directory with lifecycle scripts enabled, and reject any other path.

## License

Covered code is available under CPAL 1.0. External network deployment that lets anyone other than the deployer use the covered code triggers source availability obligations. Graphical publications must preserve the GENII Publisher attribution defined in Exhibit B and the source protocol:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

Every graphical renderer must also expose the validated `sourceCodeUrl` as a conspicuous source availability link alongside the persistent footer attribution. A manifest value alone does not satisfy the renderer interface contract.

See `LICENSE`, `NOTICE.md`, `LEGAL`, `CHANGES.md`, and `SOURCE-NOTICE` in the package.
