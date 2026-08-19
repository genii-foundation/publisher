# Publication source protocol

Status: initial architecture contract

The root `publication.json` file describes one publication without choosing a web framework, database, hosting provider, or editorial voice. It owns publication identity, ordered catalog references, capability configuration, routes, continuity, source boundaries, and engine attribution. It does not duplicate work or collection metadata.

The author source protocol has three JSON Schemas:

- `schemas/publication.schema.json` validates root `publication.json`.
- `schemas/work.schema.json` validates each authoritative `work.json`.
- `schemas/collection.schema.json` validates each authoritative `collection.json`.

The generated `schemas/content-envelope.schema.json` contract validates the deterministic compiler result. Its authority and identity rules are documented in [Publication content envelope](./content-envelope.md).

Renderer adapters consume normalized data produced from these sources. An author repository pins the installed engine, theme, extension, audio, and sync packages in its package manifest and lockfile.

## Minimal publication

Root `publication.json`:

```json
{
  "$schema": "https://publisher.genii.foundation/schemas/publication.schema.json",
  "schemaVersion": "1.0",
  "publication": {
    "id": "field-notes",
    "title": "Field Notes",
    "language": "en",
    "canonicalUrl": "https://notes.example.org",
    "publisher": {
      "name": "Example Press",
      "url": "https://example.org"
    }
  },
  "engine": {
    "compatibility": ">=1.0.0 <2.0.0"
  },
  "layout": {
    "mode": "canonical"
  },
  "works": [
    {
      "id": "first-essay"
    }
  ],
  "collections": [
    {
      "id": "essays"
    }
  ],
  "routes": {
    "home": "/",
    "work": "/works/{workId}",
    "collection": "/collections/{collectionId}"
  },
  "boundaries": {
    "sourceRoots": ["publication"],
    "outputRoots": [".publisher"]
  },
  "attribution": {
    "placement": "footer",
    "copyright": "Copyright 2026 GENII Foundation",
    "text": "Published with GENII Publisher",
    "url": "https://publisher.genii.foundation",
    "sourceCodeUrl": "https://github.com/example/field-notes"
  }
}
```

Canonical `publication/works/first-essay/work.json`:

```json
{
  "$schema": "https://publisher.genii.foundation/schemas/work.schema.json",
  "schemaVersion": "1.0",
  "id": "first-essay",
  "title": "First Essay",
  "language": "en",
  "publicationState": "published",
  "manuscript": "manuscript.md",
  "assets": "assets"
}
```

Canonical `publication/collections/essays/collection.json`:

```json
{
  "$schema": "https://publisher.genii.foundation/schemas/collection.schema.json",
  "schemaVersion": "1.0",
  "id": "essays",
  "title": "Essays",
  "workIds": ["first-essay"]
}
```

The ID in every referenced source manifest must equal the ID in its root catalog reference.

## Authority and ordering

`publication.json` owns the order of top level work and collection references. A `collection.json` owns its ordered `workIds`. A `work.json` owns that work's title, language, publication state, route, source locations, and metadata. A `collection.json` owns that collection's title, description, route, work membership, and metadata.

This division prevents title, route, and state drift between catalog and source files. The normalized compiler output may repeat resolved metadata for efficient readers, but generated repetition never becomes author source.

Every ID is stable. Renaming a title, changing a domain, or moving a source file must not change it. Work and collection IDs are unique within a publication. A work may belong to zero, one, or many collections.

## Version and engine compatibility

`schemaVersion` versions each source contract. The current schemas accept exactly `1.0`. That contract remains prerelease until the first public package release. After that release, an incompatible protocol will ship as a distinct schema contract with an explicit migration. The prerelease JavaScript package API may still evolve through documented changes, but a released source schema version cannot silently change meaning.

`engine.compatibility` is a SemVer range evaluated by the engine validator. JSON Schema only checks that the range is present. The author repository must still pin an exact engine package version and commit its lockfile. Compatibility is a claim about which engines may read the source protocol. It is not a dependency resolver.

Unknown properties are rejected throughout the protocol except inside package owned `config` and publication owned `metadata` objects. This catches misspellings while leaving namespaced integrations room to evolve.

## Hybrid layout

Canonical mode is the default opinionated layout:

- Publication manifest: `publication.json`
- Work root: `publication/works`
- Work manifest template: `{workId}/work.json`
- Collection root: `publication/collections`
- Collection manifest template: `{collectionId}/collection.json`
- Shared assets: `publication/assets`
- Continuity records: `publication/continuity`
- Disposable output and cache: `.publisher`

Declared mode keeps the same semantic roles while allowing individual roots and manifest templates to move:

```json
{
  "layout": {
    "mode": "declared",
    "overrides": {
      "works": {
        "root": "legacy/books",
        "manifestTemplate": "{workId}/record.json"
      },
      "collections": {
        "root": "editorial/collections",
        "manifestTemplate": "{collectionId}/series.json"
      },
      "assets": "media",
      "continuity": "publishing/continuity"
    }
  }
}
```

Any omitted role or nested field inherits its canonical value. `publication.json` remains at the repository root in protocol version 1 so tools can locate it without framework or host configuration.

Resolution of a work or collection manifest follows this order:

1. A `manifest` path on that root catalog reference wins.
2. The active root and manifest template resolve the ID token.
3. Any unspecified root or template uses its canonical value.

An irregular legacy source may bypass the shared template:

```json
{
  "works": [
    {
      "id": "legacy-preface",
      "manifest": "archive/preface/metadata.json"
    }
  ]
}
```

Catalog level `manifest` overrides are repository relative. They must remain inside a declared source root.

All portable repository paths use POSIX separators and well-formed Unicode 15.1 NFC. Native-script filenames are valid within a 1,024 Unicode-scalar ceiling and the secondary 2,048 UTF-16-code-unit, 4,096 UTF-8-byte, 256-segment, and 255-byte-per-segment ceilings. Paths reject POSIX absolute paths, Windows drive prefixes, backslashes, current and parent directory segments, duplicate or trailing separators, percent-encoded octets, query or fragment metacharacters, ASCII controls, Unicode line and paragraph separators, Unicode bidirectional controls, Windows-forbidden filename characters, Windows reserved device names, and segments ending in an ASCII dot or space.

Portable identity uses the generated Unicode 15.1 full default case fold with CaseFolding statuses C and F, followed by generated Unicode 15.1 canonical decomposition, canonical ordering, and composition. It excludes locale-specific and Turkic mappings. Code points unassigned in Unicode 15.1 behave as inert starters even if later Unicode versions assign them another combining class. It therefore treats full-fold equivalents such as `Straße.md` and `STRASSE.MD`, Greek sigma variants, Unicode 15.1 NFC equivalents, and ordinary case variants as the same repository path. Portable segment identity then removes the trailing ASCII dots and spaces ignored by Win32.

The tables ship inside the browser-safe schema runtime. Build verification regenerates case folding from the exactly pinned `@unicode/unicode-15.1.0` data and normalization from the checked-in, source-hashed Unicode 15.1 normalization data. Runtime identity never imports either source dataset and never consults host Unicode case conversion, locale behavior, or `String.prototype.normalize`.

The display-control exclusion is version independent. It rejects U+061C, U+200E, U+200F, U+202A through U+202E, U+2066 through U+2069, U+2028, and U+2029. U+200C ZERO WIDTH NON-JOINER and U+200D ZERO WIDTH JOINER remain valid because they participate in orthography. Variation selectors and other well-formed NFC characters also retain their exact spelling. The protocol does not erase them or apply a confusable-character mapping.

Filesystem loaders use the same portable identity to reject colliding undeclared siblings. Layout resolution ends at one ingestion boundary. Compilers, renderers, audio packages, sync packages, and extensions consume normalized data instead of reopening the repository to infer paths.

These checks prove lexical safety only. A filesystem loader must resolve every referenced object against an approved real publication root and reject escapes caused by symbolic links, case folding, Unicode normalization, mount behavior, or a source change between validation and access. Passing a schema or pure-runtime check never authorizes a loader to trust string-prefix containment.

## Work source paths

A string `manuscript` or `assets` path in `work.json` is relative to the directory containing that `work.json`. This makes a work portable as one directory:

```json
{
  "manuscript": "manuscript.md",
  "assets": "assets"
}
```

A legacy work may use a repository relative path only with an explicit tag:

```json
{
  "manuscript": {
    "path": "editorial/manuscripts/preface.md",
    "relativeTo": "repository"
  }
}
```

The same tagged form applies to `assets`. A bare string never means repository relative.

If a work declares `assets`, its resolved `assetsPath` must remain inside a declared source root even when the directory is empty and no compiled asset record refers to it. The declaration defines source authority. It does not depend on directory discovery or asset count.

The protocol never authorizes an engine migration to revise manuscript prose. A source migration may update schema fields, path declarations, or host adapter files. Any prose change requires a distinct human supervised editorial operation.

## Themes and extensions

`theme.package` names an installed theme package. Each `extensions` entry has a stable local ID, an installed package name, an explicit ordered capability grant list, and optional package owned configuration. Manifest package references never include versions. Exact versions belong in the author repository package manifest and lockfile.

Every extension must declare a nonempty `capabilities` array with unique members from the closed initial vocabulary:

- `content.project` permits a framework-neutral build-time projector over validated content. It emits separate artifacts and cannot mutate the canonical content envelope.
- `renderer.slot` permits server-rendered output only in renderer-declared slots.
- `renderer.client` permits explicitly authorized client code and browser data.
- `host.route` permits declarative public page routes subject to canonical route and collision validation.
- `host.handler` permits server request handlers through host-owned factories and validation.

No grant implies another, and there is no wildcard. Package configuration, package exports, and installed metadata cannot widen the author-reviewed grant list. Publisher orchestration implements `content.project` plus build-time `host.route` projection. The official Next renderer implements `renderer.slot`, `renderer.client`, and declarative `host.route` pages. `host.handler` remains a separate unimplemented surface.

Package configuration must contain JSON data only. Secrets do not belong in `publication.json`. Providers resolve private credentials from their runtime environment.

Extension order is significant and governs extension resolution. Capability order is exact reviewed serialization and content identity, not precedence. An engine must reject duplicate extension IDs and packages that do not declare compatibility with the active engine protocol.

The manifest records extension identity, capability grants, and configuration, not an installed version. Engine orchestration resolves exactly one installed ID, package, exact semantic version, and exact ordered grant list for every declaration in manifest order. Missing, extra, reordered, mismatched, unknown, or duplicate grants fail validation. An extension may then contribute typed JSON payloads. Each payload declares a stable ID, its extension owner, an absolute credential-free schema URL, its author-source paths, and JSON data. The compiled envelope retains and hashes the exact ordered grants, extension version, payload data, and source identities. Core compilation records the schema URL but does not fetch or execute it.

Capability grants control which interfaces the engine invokes and which data it supplies. They do not sandbox package installation, module import, Node.js execution, filesystem access, network access, or process authority.

Editorial packages are independent inputs, not engine internals. A foundation or publisher may release voice profiles, style rules, schemas, and supervised editorial commands as separately versioned packages. The author repository chooses and configures them.

The pure schema runtime validates package reference syntax and manifest relationships only. It does not inspect an installation. Engine orchestration requires an explicit author registration with exact extension version and compatible engine range. Author package metadata and the lockfile remain the installation authority.

## Optional audio, Updates, and sync

The presence of `audio` enables an audio adapter. Its optional catalog is a repository relative source path. The adapter contract determines the catalog contents.

The presence of `updates` names an authoring adapter and a required repository
relative catalog path. The adapter interprets author-owned history, path
classification, and title corrections outside the engine. Publisher records the
package reference, reads only the declared plain JSON catalog, checks its
publication and named views against `routes.updates`, and emits a separate
Reader-build-bound envelope. A compact string route uses the stable view identity
`updates`. An array declares stable view IDs, canonical paths, and optional page
templates with bounded page sizes.

The presence of `sync` enables an installed provider for the listed capabilities. `sync.capabilities` is an independent provider feature list, not the closed `extensions[].capabilities` grant vocabulary. Sync is always opt in and must preserve a local fallback. Absence of `sync` means reading progress and preferences remain local. The generic protocol contains no provider project IDs, database tables, credentials, or vendor specific policy.

## Routes and continuity

Route templates use `{workId}` and `{collectionId}` tokens. Renderer adapters translate those semantic templates into their own routing mechanism. A publication with collection references must provide a collection route template.

Internal routes use one canonical ASCII serialization. A concrete path is origin relative, begins with exactly one slash, and contains at most 2,048 serialized characters. Its raw grammar is slash plus the ASCII `pchar` repertoire, with percent reserved for encoding. Non-ASCII text uses uppercase percent escapes of its UTF-8 bytes:

```text
/caf%C3%A9
/%E6%9D%B1%E4%BA%AC/
```

Percent-encoded ASCII is forbidden. Decoding must produce Unicode 15.1 NFC without whitespace or control characters. Route and fragment inspectors use the bundled Unicode 15.1 normalizer rather than host Unicode tables. Network-path references, backslashes, queries, fragments, empty interior segments, and current or parent directory segments are invalid.

Validators reject noncanonical routes and never normalize them. Manifest data, compiled artifacts, the host, browser code, and other runtimes all use the exact same serialized value. They do not decode and re-encode it. Both trailing-slash policies are valid, but the slash remains significant: `/works/essay` and `/works/essay/` are distinct routes. Work and collection templates retain their one required semantic token while their literal portions obey this grammar.

An established public path that contains spaces cannot become a canonical protocol route, including by replacing a space with percent-encoded ASCII. A migration must either rename that public URL or retain it through an explicit redirect at the host or edge boundary. The engine will not silently repair it, because that would make the browser, host, manifest, and compiled artifact disagree about route identity.

Continuity redirects preserve previously published paths. A redirect source is always an origin relative route. Its target may be an origin relative route or an absolute, credential-free HTTP or HTTPS URL. Redirect records are publication data, not generated cache. JSON Schema rejects unsupported redirect status codes. The semantic validator rejects redirect loops, duplicate sources, conflicts with active canonical routes, and internal redirect chains that end without an active route or external URL.

Adapter-owned section locations enter the compiled content envelope as a path and optional anchor. Each exact content address has one section owner across the publication. A non-active address must use an active server route as its base path.

## Source and output boundaries

The root `publication.json` is an implicit author controlled source manifest. The compiled envelope records that canonical path as `sourceAuthority.publicationManifestPath`. `boundaries.sourceRoots` declares the subordinate author controlled source trees that it may reference. `boundaries.outputRoots` declares paths the compiler may replace. The declared source and output roots must not overlap. Every layout override, catalog manifest override, work manuscript, and declared work asset root must resolve within a source root. Asset-root containment still applies when the directory is empty. Generated files must stay within an output root.

`.publisher` is the canonical disposable output and cache root. It is never author source. Build, preview, validation, import, and migration commands must not modify source roots unless the command is an explicit source migration with a human review gate.

A renderer may maintain its own host output directory, but that directory is a renderer adapter concern. The framework-neutral protocol does not make `public`, a Next.js route tree, or any other host convention normative.

## Attribution and network source

Every valid publication manifest carries the engine attribution contract:

- Placement is the persistent publication footer.
- Copyright notice is `Copyright 2026 GENII Foundation`.
- Visible text is `Published with GENII Publisher`.
- The attribution link is `https://publisher.genii.foundation`.
- `sourceCodeUrl` is an absolute, credential-free HTTP or HTTPS URL where users of a network deployment can obtain the corresponding covered source code and deployed modifications.

Themes, extensions, and renderer adapters may style the attribution accessibly, but they may not hide it, remove it, alter its text or target, or make it dismissible. The engine must render it on every reader page.

Every graphical renderer must expose `sourceCodeUrl` as a conspicuous source availability notice alongside the persistent footer attribution on every reader page. The notice must be visible without developer tools and link to the corresponding covered source. A manifest value alone does not satisfy this interface requirement or prove that the source remains available.

`sourceCodeUrl` concerns code covered by the engine license. It does not assign a license to manuscripts, images, audio, editorial records, or other publication content. Each author controls those rights separately. The CPAL 1.0 license text remains authoritative if this protocol and the license differ.

## Semantic validation beyond JSON Schema

JSON Schema validates shape and lexical string constraints. The pure schema runtime also verifies relationships that depend only on injected manifest data:

- SemVer compatibility with the engine version injected by orchestration.
- Unique publication, work, collection, and extension identities.
- Exact ID agreement between catalog references and source manifests.
- Valid collection references and required route tokens.
- Safe, nonoverlapping source and output roots.
- Resolved source containment within declared source roots.
- Redirect uniqueness, destination validity, and loop freedom.
- Absolute, credential-free HTTP or HTTPS network source URL syntax.
- Preservation of the fixed footer attribution contract.

This pure validation does not inspect installed theme, extension, audio, or sync packages. The author package manifest and lockfile establish package availability and exact installation. Engine integration validates the explicit adapter identity and compatibility before invocation.

`validatePublicationSemantics` performs complete manifest-owned route and redirect checks. A content compiler may call the narrower `resolvePublicationSourcesForContentCompilation` before adapter-owned section routes exist. That function deliberately defers only redirect terminal resolution. The compiler must register adapter routes and perform final redirect, asset, and public-path authority validation before it accepts or serializes a content envelope. The narrow resolver is not an artifact acceptance API.

The narrow resolver still enforces redirect syntax, duplicate-source rejection, collisions with already-known active routes, and loop detection. Only an unresolved internal chain's terminal check waits for adapter routes.

The compiled envelope records metric producer identity as `{ id, package, version, profileVersion }`. For the core word counter, the package is `@genii-foundation/publisher-content`, `version` equals the exact compiler and package version, and `profileVersion` is the bundled Unicode profile version `15.1.0`.

`validatePublicationContentEnvelope` proves the artifact's internal consistency and agreement with its declared byte and normalized-text geometry. Original source bytes are absent from the envelope, so public artifact validation cannot repeat compilation's fatal UTF-8 comparison or independently recompute source hashes.

Validation returns structured diagnostics with stable codes and JSON Pointer locations. It does not rewrite any source file or manuscript. Filesystem loaders retain the separate real-path containment duties described above.
