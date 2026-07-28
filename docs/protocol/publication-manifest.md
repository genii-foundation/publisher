# Publication source protocol

Status: initial architecture contract

The root `publication.json` file describes one publication without choosing a web framework, database, hosting provider, or editorial voice. It owns publication identity, ordered catalog references, capability configuration, routes, continuity, source boundaries, and engine attribution. It does not duplicate work or collection metadata.

The protocol has three JSON Schemas:

- `schemas/publication.schema.json` validates root `publication.json`.
- `schemas/work.schema.json` validates each authoritative `work.json`.
- `schemas/collection.schema.json` validates each authoritative `collection.json`.

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

`schemaVersion` versions each source contract. Version 1 uses `major.minor` syntax. A major change may alter meaning or remove a field. A minor change may add optional behavior while preserving older valid sources.

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

All paths use POSIX separators. Absolute paths, parent traversal, and backslashes are invalid. Layout resolution ends at one ingestion boundary. Compilers, renderers, audio packages, sync packages, and extensions consume normalized data instead of reopening the repository to infer paths.

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

The protocol never authorizes an engine migration to revise manuscript prose. A source migration may update schema fields, path declarations, or host adapter files. Any prose change requires a distinct human supervised editorial operation.

## Themes and extensions

`theme.package` names an installed theme package. Each `extensions` entry has a stable local ID, an installed package name, and package owned configuration. Manifest package references never include versions. Exact versions belong in the author repository package manifest and lockfile.

Package configuration must contain JSON data only. Secrets do not belong in `publication.json`. Providers resolve private credentials from their runtime environment.

Extension order is significant. An engine must reject duplicate extension IDs and packages that do not declare compatibility with the active engine protocol.

Editorial packages are independent inputs, not engine internals. A foundation or publisher may release voice profiles, style rules, schemas, and supervised editorial commands as separately versioned packages. The author repository chooses and configures them.

## Optional audio and sync

The presence of `audio` enables an audio adapter. Its optional catalog is a repository relative source path. The adapter contract determines the catalog contents.

The presence of `sync` enables an installed provider for the listed capabilities. Sync is always opt in and must preserve a local fallback. Absence of `sync` means reading progress and preferences remain local. The generic protocol contains no provider project IDs, database tables, credentials, or vendor specific policy.

## Routes and continuity

Route templates use `{workId}` and `{collectionId}` tokens. Renderer adapters translate those semantic templates into their own routing mechanism. A publication with collection references must provide a collection route template.

Continuity redirects preserve previously published paths. A redirect source is always an origin relative route. Its target may be an origin relative route or an absolute URL. Redirect records are publication data, not generated cache. The semantic validator must reject redirect loops, duplicate sources, invalid status transitions, and conflicts with active canonical routes.

## Source and output boundaries

`boundaries.sourceRoots` declares author controlled input. `boundaries.outputRoots` declares paths the compiler may replace. These sets must not overlap. Every layout override, catalog manifest override, and work source must resolve within a source root. Generated files must stay within an output root.

`.publisher` is the canonical disposable output and cache root. It is never author source. Build, preview, validation, import, and migration commands must not modify source roots unless the command is an explicit source migration with a human review gate.

A renderer may maintain its own host output directory, but that directory is a renderer adapter concern. The framework-neutral protocol does not make `public`, a Next.js route tree, or any other host convention normative.

## Attribution and network source

Every valid publication manifest carries the engine attribution contract:

- Placement is the persistent publication footer.
- Copyright notice is `Copyright 2026 GENII Foundation`.
- Visible text is `Published with GENII Publisher`.
- The attribution link is `https://publisher.genii.foundation`.
- `sourceCodeUrl` is an absolute HTTP or HTTPS URL where users of a network deployment can obtain the corresponding covered source code and deployed modifications.

Themes, extensions, and renderer adapters may style the attribution accessibly, but they may not hide it, remove it, alter its text or target, or make it dismissible. The engine must render it on every reader page.

`sourceCodeUrl` concerns code covered by the engine license. It does not assign a license to manuscripts, images, audio, editorial records, or other publication content. Each author controls those rights separately. The CPAL 1.0 license text remains authoritative if this protocol and the license differ.

## Semantic validation beyond JSON Schema

JSON Schema validates shape. The engine validator must also verify:

- SemVer compatibility with the installed engine.
- Unique publication, work, collection, and extension identities.
- Exact ID agreement between catalog references and source manifests.
- Valid collection references and required route tokens.
- Safe, nonoverlapping source and output roots.
- Resolved source containment within declared source roots.
- Redirect uniqueness, destination validity, and loop freedom.
- Installed package availability and package protocol compatibility.
- Public, absolute network source URL syntax.
- Preservation of the fixed footer attribution contract.

Validation returns structured diagnostics with stable codes and JSON Pointer locations. It does not rewrite any source file or manuscript.
