# Coherence adoption plan

- Status: prepared implementation plan, pending review
- Publisher implementation baseline: `dae8cb5e5a634205d9e6f5ab127f578a73d3eec7`
- Coherence acceptance baseline: `74438453f03a1a3f9fa1f9dcf14206fc6d38a6ab`
- Coherence branch authority: committed `origin/main`
- Production authority: unchanged

This plan turns the readiness audit into a reversible sequence for adopting GENII
Publisher in The Coherence Thesis. It authorizes no package publication, database
change, credential change, pull request merge, production deployment, or production
alias change.

The two repositories may live anywhere. Every migration command that needs both
must receive the absolute Publisher path and the absolute clean Coherence worktree
path separately. A relative sibling path is not an accepted migration input.

## Fixed boundaries

Publisher owns generic schemas, compilers, Reader state, rendering, optional
provider interfaces, lifecycle tooling, and validation. Coherence keeps all values
that make the publication itself:

- nine canonical manuscript packages under
  `editorial/sources/volumes/volume-01` through `volume-09`
- voice cards, corpus material, editorial evidence, reviews, and debt
- continuity ledgers and adjudicated historical mappings under
  `publishing/continuity`
- the live audio manifest and immutable audio checkpoints under
  `publishing/audio`
- the durable Updates snapshot under `publishing/updates/snapshot.json`
- art, fonts, social images, publication copy, palette, and motion choices
- the complete `/admin` workbench and its author-only routes
- the existing Supabase project, applied migration history, credentials, and data
- the existing Vercel project, domains, production history, and preview mechanism

Migration tooling may read these sources through declared adapters. It must not
rewrite manuscript prose, editorial evidence, durable publishing records, audio
objects, database state, credentials, or deployment state.

## Baseline facts

The acceptance baseline has the following public route families:

- `/`, `/overview`, `/manuscripts`, `/progress`, and `/progress-icon-lab`
- `/manuscripts/[volumeId]`
- `/manuscripts/[volumeId]/[...route]`
- `/updates`, `/updates/[page]`, `/updates/literary`, and
  `/updates/literary/[page]`
- `/auth/callback` and `/api/account`

The `/manuscripts` route currently redirects to `/`. Exact status codes, trailing
slash behavior, query handling, fragment destinations, canonical volume segments,
route aliases, and every generated section path must be captured from the baseline
rather than inferred from this summary.

The current author application also owns `/admin` and all nested admin routes. It
owns the bench raw route, debt source route, calibration, revisions, guidelines,
and debt interfaces. Those routes remain beside the Publisher Reader. They are not
converted into Publisher extensions merely to make the migration diagram tidy.

The existing deployment uses the current Vercel project with the Next.js framework,
`npm run build`, and the repository's dependency installer. Preview acceptance must
use that same project's ordinary pull request preview. No second Coherence Vercel
project may be created.

## Preconditions that must close first

### Exact host dependencies

The Publisher candidate now requires exact Next.js 16.3.1, React 19.2.8,
React DOM 19.2.8, and its reference TypeScript 7.0.2 toolchain. The Coherence
baseline already pins Next.js 16.3.1 but still pins React 19.2.4, React DOM
19.2.4, and a TypeScript 5 range.

The preview branch must not suppress peer errors or accept two framework copies.
Publisher must validate this exact framework stack before candidate installation.
Coherence must then retain Next.js 16.3.1, adopt the validated React, React DOM,
and TypeScript versions, copy the complete consuming-root overrides, and
regenerate its lockfile with npm 10.9.0. The chosen versions must be exact in
`package.json` and `package-lock.json`, pass both repositories' relevant gates,
and appear once in the installed dependency graph.

### Local state compatibility interface

Publisher namespaces new state by publication identity and the official renderer
now exposes the closed Reader state bootstrap described by ADR 0057. The generic
hook runs before prepaint, receives renderer-derived target keys, is bounded and
deterministic, reports what it copied or refused, leaves legacy keys intact, and
is safe to run again. Coherence preview adoption still requires a
publication-owned adapter plus acceptance fixtures for its exact legacy document
versions. Those fixtures must prove lossless copies and explicit refusal of any
state that cannot be represented safely.

The Coherence adapter must map these legacy keys:

| Concern | Coherence keys |
| --- | --- |
| Progress | `coherence-reader-progress-v2`, then `coherence-reader-progress-v1` |
| Bookmarks | `coherence-reader-bookmarks-v2`, then `coherence-reader-bookmarks-v1` |
| Preferences | `coherence-reader-preferences-v1` |
| Consent | `coherence-reader-sync-consent-v1` |
| Engagement | `coherence-reader-events-v1` |
| Last sync display | `coherence-reader-last-synced-at-v1` |
| Narration | `coherence-audio-voice-v3`, then versions 2 and 1 |

The target Publisher keys are derived through the exported key functions with the
accepted Coherence publication ID. The adapter may not hardcode a second copy of
Publisher key syntax. During the rollback window it must dual-read and preserve the
legacy values. Any dual-write behavior must be limited to fields that can be mapped
without loss and must have round-trip tests. Legacy cache names are evidence for
offline-package replacement, not mutable state to rename in place.

### Supabase adapter choice

`@genii-foundation/publisher-sync-supabase` is currently private at version
`0.0.0`. It is not one of the five exact release candidates. Its seven reference
migrations also do not match the six dated migrations committed in Coherence.

The first preview therefore keeps Coherence's current Supabase behavior behind a
Coherence-owned implementation of the Publisher provider interface. It uses the
existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` configuration in the existing deployment. It may not
apply Publisher migrations, reinterpret existing rows, or accept publication or
reader identity from browser input.

Replacing that bridge with the reference package is a later reviewed migration.
It requires a publishable packed provider, an exact schema compatibility report,
a linked migration dry run, explicit handling of existing rows, and separate
database authority. No database migration is part of this adoption plan.

## Phase 1: Refresh immutable evidence

1. Fetch both remotes and record the exact remote commits. Do not reset either
   branch when it has advanced.
2. Refresh the Publisher parity ledger against the newest Coherence `origin/main`.
   If a newer commit changes generic Reader behavior, update Publisher before
   pinning the migration baseline.
3. Capture a baseline manifest from committed Coherence source. Include every
   tracked file under `editorial` and `publishing` with its byte digest.
4. Capture the complete active and historical route census. Record request path,
   status, redirect location, canonical destination, page identity, and every
   fragment referenced by continuity records or generated navigation.
5. Record the package manifest, lockfile digest, Node and npm versions, current
   production deployment identity, current Updates head, audio catalog identity,
   and the names of committed Supabase migrations. Do not record secrets.
6. Save representative sanitized local-state fixtures for every legacy key and
   edge case. Never copy a real reader's private state into the repository.

Every evidence artifact must name both exact commits. A newer Coherence commit
invalidates only the affected comparisons, but the acceptance candidate cannot
silently combine evidence from different refs.

## Phase 2: Create an isolated Coherence branch

The current primary Coherence checkout is not a migration surface. Migration work
starts from a separate clean Git worktree created from current `origin/main`, with
a focused branch such as `feat/publisher-migration-preview`. The worktree location
is explicit and need not share a parent with Publisher.

Before any edit, record a clean status, the exact baseline commit, and the worktree
path. Read the root instructions and every nested `AGENTS.md` governing files that
will change. If the branch cannot start cleanly, stop. Never stash, reset, or alter
the existing primary checkout to manufacture a clean baseline.

## Phase 3: Prepare exact package candidates

Build and verify exact candidate archives from the accepted Publisher commit with
Node.js 22.12.0 and npm 10.9.0. The initial set is:

1. `@genii-foundation/publisher-schema`
2. `@genii-foundation/publisher-content`
3. `@genii-foundation/publisher-reader`
4. `@genii-foundation/publisher`
5. `@genii-foundation/publisher-next`

Record each archive path, package version, byte digest, and Publisher commit. Run
the full second-publication release rehearsal against those same bytes. Candidate
preparation and installation do not publish packages and do not accept provenance
records.

The Coherence preview branch must consume exact versions or exact reviewed archives.
It may not use workspace links, floating ranges, a mutable package directory, or a
registry tag. A deployment preview that cannot reproduce the same package bytes is
not acceptance evidence.

## Phase 4: Generate declared publication manifests

Add Coherence-owned author tooling that reads, but never edits, the current volume
packages, generated manuscript catalog, and durable continuity records. It emits a
reviewable Publisher manifest and one work manifest per volume into an author-owned
configuration path.

Each work manifest keeps the existing `volumeId`, canonical title, source path,
and public volume route. Its section declarations preserve the committed section
IDs, preorder hierarchy, navigability, canonical routes, continuity IDs, legacy
IDs, progress groups, and historical section IDs. Exact Markdown block selectors
only locate boundaries. They never derive identity from headings.

Generation must fail on a stale or ambiguous selector, a route collision, a
missing historical mapping, an unrepresented section, a byte change in a
manuscript, or any attempt to write below `editorial` or `publishing`. The generated
manifest census must compare exactly with the baseline catalog before host work
continues.

The declared source roots include the canonical volume packages. The protected
roots include all of `editorial` and `publishing`. Disposable output remains under
ignored Publisher and existing Coherence generated roots.

## Phase 5: Integrate the host without absorbing the workbench

Run Publisher initialization in declared-layout plan mode and retain its conflict
report as migration evidence. Existing Coherence application files are expected to
conflict. Do not apply that plan over author files.

Prepare reviewed host patches with these ownership rules:

- Publisher owns the public Reader root, catch-all Reader route, generated Reader
  data routes, error surfaces, offline worker, and provider-neutral Reader APIs.
- Coherence retains every `/admin` page and handler, plus admin-only styling and
  data access.
- The shared root layout may host Publisher's prepaint, offline, and narration
  providers. It must still render nested admin pages without importing manuscript
  payloads into browser chunks.
- Coherence-owned configuration selects the theme, extensions, sync provider, and
  publication data. Manifest package names never import executable code.
- Existing public art and fonts remain in Coherence. A Coherence theme package or
  adapter selects them without copying those assets into Publisher.
- Publisher attribution remains persistent, linked, conspicuous, and present on
  every Reader and error surface. Admin-only pages need not impersonate Reader
  pages to satisfy that rule.

After the selected patches match the reviewed host contract, initialize or upgrade
the host through a plan hash and commit `publisher.host.json`. Any deliberately
author-owned file must sit outside the renderer-managed set. A later lifecycle
command must detect its edits as author input, not silently replace them.

## Phase 6: Bind Updates, narration, and sync

The Updates adapter remains Coherence-owned. It reads the complete Git history and
the durable snapshot at the exact acceptance ref, applies Coherence's literary path
classification and title corrections, and emits Publisher's ordinary and literary
named views. Compare every entry, page boundary, link, timestamp, and total with the
baseline. A missing commit is fatal.

The narration adapter reads `publishing/audio/manifest.json` and immutable
checkpoints. It maps existing voice, clip, duration, spoken-text, and timing
identities into Publisher envelopes without uploading, regenerating, promoting, or
rewriting audio. Every public clip must have matching accepted evidence. A build
with narration disabled must also succeed.

The Coherence sync bridge implements only the Publisher provider interface. It
continues using the existing authenticated session and committed Coherence schema.
It must preserve explicit consent, local-only operation, schema-ahead refusal,
atomic bookmark behavior, sign-out, and account deletion. Test fixtures and an
isolated local database may be used. The production database may not.

## Phase 7: Prove local acceptance

Run the following classes of evidence against the exact candidate commit:

1. Re-run the immutable `editorial` and `publishing` digest manifest after every
   build, preview, validation, upgrade, rollback, and intentionally failed apply.
2. Compare the complete route census with the baseline, including status codes,
   redirects, trailing slash behavior, fragments, and historical destinations.
3. Run the full Coherence `npm run validate:ui` gate with the exact pinned Node and
   npm versions.
4. Build the production application and run the managed local preview.
5. Verify representative routes with JavaScript disabled, including prose,
   navigation, tables, links, metadata, attribution, and error surfaces.
6. Run desktop and mobile browser coverage for menus, keyboard access, screen
   readers, prepaint, reduced motion, contrast, geometry, progress, search,
   bookmarks, narration, and offline reading.
7. Seed sanitized legacy state, load the candidate, verify exact or documented
   monotonic translation, reload, simulate rollback, and prove the preserved legacy
   state remains readable.
8. Install a work from a cold browser, disconnect transport, reload, navigate,
   search, edit bookmarks, and play timed narration. A failed replacement must
   leave the prior complete package active.
9. Verify `/admin` and every nested admin route still loads with its expected
   authorization and source boundaries.

Save the local preview candidate identity using Publisher's exact candidate
inventory. The evidence must bind the canonical worktree, branch, full commit,
dirty state, file bytes, package archive digests, and validation results.

## Phase 8: Use the existing deployment preview

Push the reviewed Coherence migration branch and open one pull request against
`main`. The pull request body must state that it is a migration preview and that it
must not merge. Let the existing Coherence Vercel project create its ordinary pull
request preview.

Record the preview URL, deployment commit, package archive digests or exact
versions, build log identity, and local candidate identity. Confirm that the
preview belongs to the existing Vercel project and has no production alias.

Run the same route, no-JavaScript, mobile, accessibility, state-fixture, narration,
offline, Updates, and admin checks against the preview where the environment allows
them. Authentication checks use only approved test accounts and must not alter the
production database. If the existing preview environment shares production data,
skip mutating sync tests and retain the local isolated-database result.

## Acceptance evidence

The migration may be presented for human acceptance only when one evidence index
maps an exact candidate to all fourteen gates:

1. Exact current and historical routes, redirects, fragments, hierarchy, and
   continuity.
2. Byte-identical manuscripts and durable publishing records through success,
   rollback, and failure paths.
3. Useful no-JavaScript manuscript text, navigation, tables, links, and
   attribution.
4. Local reading without account or network, with explicit publication-scoped
   synchronization.
5. Verified legacy state translation, preserved old keys, and tested rollback
   readability.
6. One word-weighted progress result across all surfaces, including historical
   completion through revisions.
7. Bookmark exact, renamed, reanchored, missing, ambiguous, merge, tombstone,
   thousand-item, export, and accessibility cases.
8. Spoken-content audio identity with matching immutable clip and timing evidence.
9. Cold offline reload, navigation, search, bookmarks, timed narration, and retained
   package behavior after a failed update.
10. Desktop and mobile viewport, keyboard, screen-reader, geometry, prepaint,
    reduced-motion, and contrast evidence.
11. Packed consumers, supported Node matrix, exact pins, deterministic artifacts,
    protected source, transactional migration, and rollback.
12. The unrelated second publication release rehearsal against the same five
    candidate archives.
13. The exact Coherence candidate repository validation, local preview, existing
    Vercel preview, and candidate identity evidence.
14. Fresh separate author approval before any merge, database mutation, package
    release, or production deployment.

A green technical gate is not approval. Any candidate commit, package byte, lockfile,
manifest, environment, or preview deployment change invalidates the affected
evidence and requires review again.

## Rollback

Before merge, rollback is deletion of the migration branch and its separate
worktree. The primary Coherence checkout, `main`, production deployment, database,
credentials, audio objects, legacy local keys, and durable source remain unchanged.

During preview, rollback is closing or reverting the preview branch. The existing
production deployment remains current. A preview failure never triggers a second
project or a production alias change.

The final migration cannot merge under this plan without fresh explicit approval.
If a separately approved merge later reaches production and fails, application
rollback uses an approved Git revert and the existing Vercel project's prior known
good deployment. Database rollback is not implied. Because this plan applies no
database migration and retains legacy browser keys, those state surfaces remain
available to the prior application.

Keep the prior compatible Publisher package bytes, previous Coherence commit,
accepted route census, and rollback validation receipt until the production
verification window is explicitly closed.

## Authority checkpoints

Stop and request fresh authority before any of the following:

- accepting provenance records or publishing any package
- applying a Supabase migration or changing database data
- changing provider credentials or Vercel project configuration
- uploading, promoting, or deleting narration assets
- merging the Coherence migration pull request
- assigning a production alias or deploying the migration to production

The migration preview, even when perfect, is a proposal. Production remains where
it is until the author approves the exact commit and evidence set.
