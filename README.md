# GENII Publisher

GENII Publisher is an opinionated, open source publishing application for authors and institutions. It will provide the complete path from a manuscript repository to a durable, accessible publication while keeping each author's content, history, identity, and deployment under that author's control.

Implementation has begun. The schema runtime, framework-neutral content compiler, and strict reader-envelope contract are built and tested from their packed artifacts, but no npm release exists yet.

## Product contract

- The engine lives in this repository. A publication lives in a separate, thin host repository.
- The default layout is canonical and deliberately opinionated.
- A declared-layout mode is a fully supported escape hatch for established repositories.
- Publications may override themes and add extensions through explicit capability grants without forking the engine.
- Works and collections are first-class protocol concepts.
- The initial renderer uses Next.js. The content protocol remains framework neutral.
- Audio and Supabase synchronization belong to the 1.0 scope as optional capabilities.
- Engine upgrades are exact, reviewable migrations with backups, validation, and rollback.
- Editorial profiles may be distributed as independent packages. They do not belong to the core engine.
- Engine tooling never rewrites manuscript prose automatically.

## Ownership boundary

GENII Publisher owns the generic schema, compiler, reader, optional adapters, migration framework, and validation contracts.

Each publication repository owns its manuscripts, editorial evidence, assets, configuration, route continuity, deployment history, credentials, and provider state. A build or preview may read publication sources, but it must not modify them.

## Planned package surface

| Package | Responsibility |
| --- | --- |
| `@genii-foundation/publisher` | Umbrella dependency, application integration, and author commands |
| `@genii-foundation/publisher-schema` | Versioned publication protocol and validators |
| `@genii-foundation/publisher-content` | Framework-neutral content model and compilation primitives |
| `@genii-foundation/publisher-reader` | Deterministic reader projection, framework-neutral runtime behavior, and shared presentation contracts |
| `@genii-foundation/publisher-next` | Next.js reference renderer and host adapters |
| `@genii-foundation/publisher-audio` | Optional audio catalog and playback contracts |
| `@genii-foundation/publisher-sync-supabase` | Optional Supabase synchronization adapter |
| `@genii-foundation/publisher-updates` | Author-repository history and Updates generation |

The package boundaries will be proven against a neutral fixture before code moves from any existing publication.

## Attribution and source

GENII Publisher is licensed under the Common Public Attribution License 1.0. External network deployment that lets anyone other than the deployer use the covered code triggers source availability duties.

Every rendered publication will retain a persistent footer credit:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

The credit links to `https://publisher.genii.foundation`. The license and its populated attribution exhibit define the controlling obligation.

Every graphical renderer must also show the publication manifest's `sourceCodeUrl` as a conspicuous source availability link alongside the persistent footer attribution. Recording the URL in a manifest without rendering it does not satisfy the GENII Publisher interface contract.

GENII Publisher source code is available at [github.com/genii-foundation/publisher](https://github.com/genii-foundation/publisher).

## First release gates

The first public package release remains blocked until `publisher.genii.foundation` serves the attribution landing page and stable schema URLs, npm trusted publishing is bound to the release workflow, and the exact prerelease tag is verified. A source package passing local tests is not a public release. Metaphysics has tried this trick before.

## Coherence migration gate

The Coherence Thesis will use its existing preview deployments for migration acceptance. This project will not create a second Coherence Vercel project. The final Coherence migration, merge, and production deployment require fresh approval after manual acceptance.
