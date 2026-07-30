# ADR 0012: Author lifecycle contracts and mutation policy

- Status: Accepted
- Date: 2026-07-28

## Context

[ADR 0003](./0003-capability-upgrade-and-migration-lifecycle.md) accepted the author lifecycle in principle: exact engine pins, a migration plan and compatibility report, reviewable host patches, conflict refusal over locally modified adapters, a recoverable backup point, and rollback instructions. It named the pieces the tooling would need and left their shapes open.

None of it exists yet. `@genii-foundation/publisher/node` exports source loading and trusted compilation and nothing else: no executable, no target release descriptor, no durable host state, no plan or receipt shape, no migration registry, no host contract version, no transactional writer, no rollback path.

The renderer's host contract is in a worse position than merely unimplemented. It exists only as inline file templates inside `packages/next/scripts/packaged-host-proof.mjs`, a 1,972-line script that also does browser automation, PNG synthesis, and port allocation. Twenty-two host files are written there, three of them proof-only probes, and the proof's `app/layout.tsx` carries a deliberate error injection an author host must never receive. There is no artifact an author command could apply, and no version to migrate between.

An upgrade command is a program that rewrites someone else's repository. The interesting question is not what it can do but what it is forbidden to do, and how that is enforced when the code deciding is itself supplied by a migration.

## Decision

### Renderer-owned host contract

Each renderer package owns and ships one versioned host template. `@genii-foundation/publisher-next` exports `PUBLISHER_NEXT_HOST_CONTRACT_VERSION` and a pure function producing the exact host file set for a given set of inputs. The contract version is independent of the package version: a package release that does not change host files does not advance it, and an author upgrading across such releases has no host migration to apply.

The template is the single source of truth. `packaged-host-proof.mjs` consumes it and layers its probes and its error injection on top, so the proof can no longer drift from what authors receive. A host file the proof writes but the template does not is proof scaffolding by construction.

### Durable author state

Every initialized host commits `publisher.host.json`. It records the host contract version, the renderer that owns it, the exact engine package versions, the layout mode, and the content hash of every renderer-managed file at the moment it was written.

It is committed rather than ignored. Uncommitted integration state cannot be reviewed in a diff, reproduced in continuous integration, or used to detect local modification, and those are the three things it exists for.

### Layout modes

`init` serves two repositories. An empty repository receives the opinionated canonical layout. An established repository is adopted: host integration is added and its declared layout is recorded, with no source file moved. Adoption is not a lesser path. The Coherence Thesis is a declared-layout repository whose structure predates the engine, so adoption is the path its own migration takes.

### Mutation policy

One module owns write authority. A migration declares intent and receives a decision; it never decides for itself. A migration that could grant itself authority is not a boundary.

Permitted, and only when the plan names the exact path:

- renderer-managed host integration files, when the current content hash matches a known revision of that template
- JSON-pointer-scoped edits to publication, work, and collection manifests, surfaced in the plan diff before apply

Denied unconditionally, with no override, flag, or capability grant:

- manuscript files and raw publication assets
- durable continuity records, audio state, and Updates state
- credentials, provider state, and deployment configuration
- database operations of any kind
- declared source roots, which are default-deny

`publisher.config.ts` is host code. It is never executed to discover content or migration authority, consistent with the source snapshot boundary.

### Third-party packages

Third-party themes and extensions declare static compatibility metadata and manual instructions. They do not execute migration code. The extension capability system was designed for render-time reads, and a transactional filesystem mutation is not the place to discover that it generalizes. This may be revisited when a real theme needs it, which is a smaller decision to make later than to unmake.

### Planning is read-only

`plan` reads the host and writes only under `.publisher/`. It emits a canonically serialized, content-hashed plan, a compatibility report, a reviewable diff, rollback instructions, and any manual gates. Plan hashes are stable across directories, so the same host in two checkouts produces the same plan.

Resolving an exact target happens inside an owned temporary workspace with lifecycle scripts disabled, and the plan is bound to the exact integrity of what was resolved. `apply` is then fully offline: it installs nothing and fetches nothing.

### Apply is transactional

`apply` verifies the plan hash, the exact target CLI, a clean Git baseline, and every preimage before it writes. It rejects symlink and path-alias escapes, stages same-directory replacements, and keeps a crash journal with backups so an interrupted run restores itself.

Repeat application reports `alreadyApplied` only when every postimage matches.

This record originally also refused a mixed tree, where some files already hold the intended result and others do not, on the reasoning that a half-applied state means guessing at intent. That was wrong on both counts and is corrected here. It made upgrades impossible, because every upgrade leaves most host files unchanged between contract versions and is therefore always a mix. And nothing is guessed: every pending file carries the exact preimage it must currently have, every applied file already holds the exact intended bytes, and anything matching neither is a conflict that is refused. The cases the refusal was reaching for are each covered elsewhere, by the journal for a run that died midway and by conflict detection for an author's edit.

Git is required. Apply refuses a non-Git or dirty tree, and rollback is a checkout of the recorded pre-apply commit. Git is the rollback authority: the alternative is trusting a backup format we wrote ourselves, with no external verifier, in exactly the situation where our own code has already failed once. Database changes remain a separately authorized forward repair or rollback, never implied by a package rollback.

### Migrations

Migrations are deterministic sequential host-contract edges with no shortcut edges and a documented support window. Shortcut edges multiply the combinations that must be tested and are where migration tooling accumulates paths nobody exercises.

The target owns the registry, so the version being migrated to decides how to get there.

### Package manager

npm 10.9.0 exactly, for 1.0. The repository already pins it, verifies `npm_execpath` at runtime, and builds release candidates through the invoking CLI. A second package manager means a second lockfile integrity story for the scanner runtime closure, which is a security surface rather than a convenience.

## Consequences

This slice delivers the host contract, the durable state, the mutation policy, and `init`. Upgrade, rollback, and the migration registry follow on these contracts and are not implemented here. Naming them now is what keeps the contracts from being shaped only by the first command that uses them.

Extracting the host template changes no author-visible behavior, but it is a prerequisite: until the proof and the author path read the same artifact, initialization cannot claim to produce a host the proof validates.

`publisher.host.json` becomes a reviewed file in author repositories. Its content hashes make local modification detectable, which is what turns an overwrite into a reviewable conflict.

Adoption means the engine supports two layouts indefinitely rather than migrating everyone to one. That cost is accepted because the alternative is asking established publications to restructure in the same change that adopts the engine.

Requiring Git excludes authors who do not use it. That is a real exclusion, accepted because a rollback guarantee resting on a bespoke journal is a guarantee only until the journal has its own bug.

## Rejected alternatives

- Let migrations decide their own write authority from declared capabilities. A boundary a migration can widen is documentation, not enforcement.
- Ignore `publisher.host.json` rather than commit it. Local modification then becomes undetectable, and every upgrade either overwrites author edits or refuses to touch anything.
- Support canonical layout only in 1.0. Coherence would need a bespoke migration outside the supported tooling, and unsupported paths built for one repository tend to stay.
- Allow shortcut migration edges between distant host contract versions. Faster for the author, untestable in combination, and the failure surfaces in someone else's repository.
- Make apply repair a partial state it finds. Requires inferring intent from a half-written tree, which is precisely the state in which inference is least reliable.
- Write plans outside `.publisher/`. Planning would then mutate the host it is supposed to be reporting on.
