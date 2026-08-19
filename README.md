# GENII Publisher

GENII Publisher is an opinionated, open source publishing application for authors and institutions. It will provide the complete path from a manuscript repository to a durable, accessible publication while keeping each author's content, history, identity, and deployment under that author's control.

Implementation has begun. The schema runtime, framework-neutral content compiler, strict reader-envelope contract, explicit extension grants, and server-rendered Next.js reference application are built and tested from packed artifacts, but no npm release exists yet.

## Publishing something

[Publishing a publication](docs/guides/publishing-a-publication.md) is the whole
author path, with real command output. Start there.

[Rehearsing a release](docs/guides/rehearsing-a-release.md) covers the release
scripts, what they require, and which gate currently stops them.

## Product contract

- The engine lives in this repository. A publication lives in a separate, thin host repository.
- The default layout is canonical and deliberately opinionated.
- A declared-layout mode is a fully supported escape hatch for established repositories.
- Publications can inject validated themes and explicitly registered extensions. Build-time content, route, and handler projection, official Next server slots, isolated client mounts, declarative pages, and closed request handlers are implemented.
- Works and collections are first-class protocol concepts.
- The initial renderer uses Next.js. The content protocol remains framework neutral.
- Audio and Supabase synchronization belong to the 1.0 scope as optional capabilities.
- Engine upgrades are exact, reviewable migrations with backups, validation, and rollback.
- Editorial profiles may be distributed as independent packages. They do not belong to the core engine.
- Engine tooling never rewrites manuscript prose automatically.

## Ownership boundary

GENII Publisher owns the generic schema, compiler, reader, renderer, optional adapters, migration framework, and validation contracts. Those package boundaries and their neutral proofs exist now. Public release infrastructure and reviewed Coherence adoption remain 1.0 work.

Each publication repository owns its manuscripts, editorial evidence, assets, configuration, route continuity, deployment history, credentials, and provider state. A build or preview may read publication sources, but it must not modify them.

Migration and extraction decisions are recorded in the machine-validated [provenance ledger](provenance/README.md). The ledger distinguishes fresh implementation, preserved source licenses, documented relicensing, host-only creative material, third-party material, and blocked provenance.

## Planned package surface

| Package | Responsibility |
| --- | --- |
| `@genii-foundation/publisher` | Umbrella dependency, application integration, and author commands |
| `@genii-foundation/publisher-schema` | Versioned publication protocol and validators |
| `@genii-foundation/publisher-content` | Framework-neutral content model and compilation primitives |
| `@genii-foundation/publisher-reader` | Deterministic reader projection, framework-neutral runtime behavior, and shared presentation contracts |
| `@genii-foundation/publisher-next` | Server-rendered Next.js application, data-only themes, and exact host continuity |
| `@genii-foundation/publisher-audio` | Optional audio catalog and playback contracts |
| `@genii-foundation/publisher-sync-supabase` | Optional Supabase synchronization adapter |
| `@genii-foundation/publisher-updates` | Author-repository history and Updates generation |

The implemented package boundaries are proven against two invented neutral fixtures. The packed canonical host installs independent theme and extension packages, performs a frozen offline reinstall, renders extension server slots, an interactive client mount, a declarative extension page, and an exact namespaced request handler, preserves the theme across framework error surfaces, and keeps manuscript plus extension server data out of client chunks.

## Attribution and source

GENII Publisher is licensed under the Common Public Attribution License 1.0. External network deployment that lets anyone other than the deployer use the covered code triggers source availability duties.

Every rendered publication will retain a persistent footer credit:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

The credit links to `https://publisher.genii.foundation`. The license and its populated attribution exhibit define the controlling obligation.

Every graphical renderer must also show the publication manifest's `attribution.sourceCodeUrl` as a conspicuous source availability link alongside the persistent footer attribution. Recording the URL in a manifest without rendering it does not satisfy the GENII Publisher interface contract.

GENII Publisher source code is available at [github.com/genii-foundation/publisher](https://github.com/genii-foundation/publisher).

## First release gates

The first public package release remains blocked until `publisher.genii.foundation` serves the attribution landing page and stable schema URLs, npm trusted publishing is bound to the release workflow, and the exact prerelease tag is verified. The release workflow must build, attest, retain, and reverify one exact tarball per package, then upload those same paths without rebuilding. Direct package-directory publication is forbidden. A source package passing local tests is not a public release. Metaphysics has tried this trick before.

## Coherence migration gate

The Coherence Thesis will use its existing preview deployments for migration acceptance. This project will not create a second Coherence Vercel project. The final Coherence migration, merge, and production deployment require fresh approval after manual acceptance.
