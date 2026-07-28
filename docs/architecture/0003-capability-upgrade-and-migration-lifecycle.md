# ADR 0003: Capability, upgrade, and migration lifecycle

- Status: Accepted
- Date: 2026-07-27

## Context

GENII Publisher 1.0 must include audio publishing and Supabase-backed sync without making either service compulsory. Authors also need upgrades that remain understandable when engine releases change host interfaces, generated data, persistence keys, or database expectations.

The Coherence Thesis is the first migration target. It already has public URLs, reader behavior, local progress, audio, optional account sync, preview deployments, and production history that must survive extraction. A package update is not permission to change its production site.

## Decision

Audio and Supabase sync are supported optional capabilities in the GENII Publisher 1.0 scope.

The audio capability will separate generic audio metadata, reader playback, and publication interfaces from provider-specific generation or upload adapters. A build or engine upgrade will never generate audio or upload media unless the author invokes an explicit publishing operation.

The sync capability will separate local private reading progress from remote synchronization. Publications work without an account or Supabase project. Enabling Supabase requires an explicit host adapter, publication-owned configuration, and publication-owned database migrations. Package rollback does not imply database rollback.

Author repositories will pin exact engine package versions. Floating ranges are not accepted for production publication dependencies. Engine releases follow semantic versioning and publish compatibility metadata for themes, extensions, protocol schemas, host adapters, and optional capabilities.

The supported upgrade flow is:

1. Create a clean branch and a recoverable backup point.
2. Ask the upgrade command to compare the current and target versions.
3. Produce a migration plan, compatibility report, and reviewable host patches.
4. Apply only the selected migration steps.
5. Validate source boundaries, protocol output, public routes, persistence migration, optional capabilities, and rendered behavior.
6. Build and inspect a preview deployment.
7. Merge and publish only through the author repository's normal authority gates.

Every migration is explicit, versioned, repeatable, and safe to run again or able to detect that it has already run. A migration records its preconditions and changed files. It refuses to overwrite a locally modified adapter without a reviewable conflict. Before changing generated state, browser persistence, or a database, it creates or requires a documented rollback point.

Rollback instructions ship with every migration that changes an author-facing interface or stored state. Rollback may mean reverting the host commit and restoring compatible generated artifacts. Database changes require their own forward repair or separately approved database rollback plan.

Migration commands never revise manuscript prose automatically. Editorial packages may produce evidence, reports, and proposed patches for a human-supervised editorial pass.

For The Coherence Thesis:

- its repository retains manuscripts, history, editorial material, continuity rules, and deployment configuration
- its host pins an accepted GENII Publisher release
- migration acceptance uses its existing preview deployments
- no second Coherence Vercel project is created
- production remains on the current implementation throughout migration acceptance
- final migration merge and any production deployment require fresh, explicit user approval
- exact route, rendering, accessibility, local progress, audio, sync, privacy, and continuity parity are release gates

## Rationale

Optional packages keep the default application complete without forcing authors to adopt an account system, database, or audio provider. Exact pins make every publication build attributable to a known engine release. Explicit migrations turn substantial interface changes into inspectable source changes instead of installation side effects.

Preview acceptance separates technical readiness from production authority. Coherence production is a continuity surface, not a convenient test environment.

## Consequences

- The 1.0 release is incomplete until audio and Supabase sync contracts are documented and tested, even though either capability may be disabled.
- Local reading progress remains available and private when sync is absent.
- Provider credentials stay in the author deployment boundary.
- Upgrade tooling needs a migration registry, compatibility matrix, dry-run report, conflict handling, and rollback documentation.
- Engine continuous integration proves generic fixtures and package installation. Each author repository retains its own editorial, continuity, and differential integration gates.
- Coherence production cannot change merely because engine extraction, package publication, or preview validation succeeds.
