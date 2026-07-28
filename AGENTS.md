# Agent Instructions

This repository is the canonical source for GENII Publisher. Read this file first, then read the nearest nested `AGENTS.md` for the files you touch.

## Authority boundaries

- Keep engine code generic. Never add publication-specific manuscripts, brands, route inventories, credentials, provider identifiers, or editorial voice.
- Treat `schemas/` and accepted architecture decisions as protocol authority.
- Treat fixtures as replaceable proof publications, not production content.
- Keep author manuscripts, editorial evidence, continuity records, and deployment history in author repositories.
- Build, preview, test, compile, and validation commands must not modify author source or durable publishing state.
- Engine tooling must never rewrite manuscript prose automatically.

## Architecture

- Preserve the opinionated canonical layout and the fully supported declared-layout mode.
- Keep protocol and content packages independent of Next.js, React, Vercel, Supabase, and any audio vendor.
- Put framework integration in renderer packages and provider behavior in optional adapters.
- Require explicit context and injected publication data. Do not import generated author data from global paths.
- Version every generated artifact envelope with `schemaVersion`, `publicationId`, `engineVersion`, and `buildId`.
- Keep upgrade steps explicit, reviewable, reversible, and safe to rerun.
- Use exact engine package versions in author repositories.

## Attribution and licensing

- Covered code is licensed under CPAL 1.0.
- Preserve the populated Exhibit A and Exhibit B terms.
- The persistent GENII Publisher footer attribution is a product and license invariant.
- Themes may restyle the attribution within the design system, but they may not remove it, conceal it, reduce its prominence below comparable credits, or break its link.
- Keep `CHANGES.md`, `LEGAL`, `NOTICE.md`, package metadata, and source headers consistent with the licensing policy.
- Duplicate the populated Exhibit A text from `SOURCE-NOTICE` in every covered source file whose format permits it. When a file's structure cannot contain the notice, keep `SOURCE-NOTICE` or an exact copy in that file's directory.
- Never copy manuscript prose, publication assets, or material with incompatible licensing into this repository.

## Engineering

- Prefer the smallest complete abstraction with a real consumer.
- Search for an existing package, helper, type, validator, or fixture before creating another.
- Keep package dependencies one way: schema, then content, then reader, then framework or provider adapters.
- Pin development tools exactly in the lockfile. Publish packages with exact internal dependency versions.
- Add deterministic tests for protocol compatibility, package contents, migrations, source boundaries, and attribution.
- Use Node.js 22 for the reference toolchain.

## Validation

Run focused checks while iterating. Before a commit, run:

```bash
npm run validate
```

Do not claim a migration, package, or release works without testing the packed artifact and a clean consumer installation.

## Git and external posts

- Use one focused branch for each coherent change.
- Use Conventional Commit branch prefixes such as `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, or `test/`.
- Never put an agent product name in a branch, commit, pull request, issue, or release title.
- Any body posted to GitHub or another external service on the user's behalf must begin with `(AI Generated).` followed by a blank line.
- Preserve unrelated work. Never reset, replace, or delete user changes.
- Open completed pull requests in ready state. State the exact missing gate for incomplete work.

## Production boundary

- Do not create a second Coherence Vercel project.
- Use the existing Coherence preview deployment for migration acceptance.
- Do not merge the final Coherence migration or deploy it to production without fresh explicit user approval.
