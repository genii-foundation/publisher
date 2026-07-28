# ADR 0002: Publication structure and content protocol

- Status: Accepted
- Date: 2026-07-27

## Context

Authors need a predictable repository shape so documentation, commands, examples, and support can share one vocabulary. Established publications also have valid historical layouts that cannot be rearranged merely to satisfy a new tool. Supporting arbitrary paths at every engine layer would spread path logic through the compiler, reader, audio pipeline, and sync adapter.

The first renderer will use Next.js, but publication content should outlive any one web framework. The engine also needs a model that can represent one work, many works, and editorial collections without treating Coherence volumes as a universal law of nature.

## Decision

GENII Publisher will use a hybrid canonical path policy.

The opinionated default layout is:

```text
publication.json
publisher.config.ts
publication/
  works/
    <work-id>/
      work.json
      manuscript.md
      assets/
  collections/
    <collection-id>/
      collection.json
  assets/
  continuity/
.publisher/
```

The root `publication.json` defines publication identity and site-wide behavior. Each `work.json` defines a stable work identifier, title, language, ordering metadata, and publication state. A collection contains ordered references to works and may add its own title, description, and route. A work may belong to zero, one, or many collections. Shared publication assets and continuity records remain durable author source. The `.publisher/` directory is disposable generated state and must never contain canonical author source.

The default is canonical because all generated examples, initialization commands, documentation, and diagnostics use it. It is not mandatory.

An established publication may declare another layout in `publisher.config.ts`. The declaration maps its repository paths to the same semantic roles: publication manifest, work metadata, manuscripts, work assets, collections, shared assets, and continuity records. Unspecified roles inherit the canonical defaults. Declared layouts are a fully supported product surface. They receive the same validation, compiler behavior, release compatibility, migration coverage, and issue support as the default layout.

Path resolution ends at one boundary. A layout adapter resolves and validates source files, then produces the normalized content protocol. No compiler, renderer, audio package, sync package, or extension may reopen the repository and infer publication paths independently.

The normalized content protocol will be versioned and framework-neutral. Every generated envelope will identify at least:

- `schemaVersion`
- `publicationId`
- `engineVersion`
- `buildId`
- works and their stable identifiers
- collections and their ordered work references
- semantic links and resolved assets
- source provenance required for diagnostics

Protocol packages must not import Next.js or browser-only modules. The official Next.js renderer will consume this protocol through a publication runtime. Other renderers may consume the same protocol without changing source content.

Editorial packages are independent inputs, not engine internals. A foundation or publisher may release voice profiles, style rules, schemas, and supervised editorial commands as separately versioned packages. The author repository chooses and configures them. Their output may report or propose manuscript changes, but it may not silently revise canonical prose.

## Rationale

One default structure lowers the cost of learning, tooling, and support. The declared-layout escape hatch respects mature repositories and preserves their history. Normalizing both paths at the ingestion boundary prevents a permanent forest of path conditionals.

Works are the durable unit of authorship. Collections express grouping and reading order without changing work identity. A versioned content protocol lets the reader evolve independently from source layout and web framework.

## Consequences

- A publication can begin with the default layout and later declare a custom layout without changing public work identity.
- Every declared-layout feature requires contract tests against both the default fixture and at least one nonstandard fixture.
- Continuity data stays in the author repository and participates in host validation.
- Extensions consume normalized publication data rather than private compiler files.
- A future renderer must honor protocol compatibility instead of importing the Next.js implementation.
- Breaking protocol changes require a new schema version and an explicit migration.

## Rejected alternatives

### Fixed paths only

This is simpler for a new project but forces destructive reorganizations on established publications and turns repository aesthetics into a compatibility gate.

### Arbitrary path discovery

Implicit discovery appears flexible until two plausible manuscripts exist. Builds then depend on heuristics, diagnostics become vague, and every subsystem invents a slightly different map of the same repository.

### Next.js components as the protocol

This would couple canonical content to one renderer and make alternative readers reverse engineer framework behavior.
