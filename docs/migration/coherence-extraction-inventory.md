# Coherence extraction inventory

- Status: migration planning baseline
- Audit date: 2026-07-27
- Coherence source: `genii-foundation/coherence-thesis`
- Audited ref: `origin/main`
- Audited commit: `654a2c36ba825ee191e67ded3b193ff4e0acde24`

This historical extraction baseline is retained for provenance. Current adoption
work follows the exact, reversible sequence in
[`coherence-adoption-plan.md`](coherence-adoption-plan.md) and the refreshed
capability evidence in [`coherence-readiness.md`](coherence-readiness.md).

## Purpose

This inventory separates reusable publishing technology from The Coherence Thesis. It records current paths and required boundaries without copying source code, manuscript text, publication data, or assets.

The audit reads the committed `origin/main` Git tree. The local Coherence checkout was one commit behind that ref, so working-tree files were not used as authority.

## Classification rules

- Extract after inversion: Reusable behavior may move into GENII Publisher after publication assumptions become injected contracts.
- Author-owned: The file or history remains in the Coherence repository. The engine may read it through a declared interface.
- Optional adapter: The behavior belongs in a separately installable engine package and must not become a core runtime requirement.
- Disposable output: The path is generated, ignored, replaceable, and excluded from source packages.
- License review: The path cannot move until its copyright, license, notices, and embedded content are resolved.

## Generic extraction candidates

No current source directory is safe to copy wholesale. Each candidate below contains reusable behavior, but several also contain Coherence names, fixed volume semantics, global paths, or author publication state.

- `scripts/manuscripts/io.ts`
  - Reusable behavior: Markdown block handling, hashing, word counts, reading time, and deterministic file helpers.
  - Boundary: Move pure content operations below the compiler. Remove imports from `src/lib/`. Accept file access through explicit compiler context.
- `scripts/manuscripts/types.ts`
  - Reusable behavior: Compiled section, hierarchy, continuity, route, provenance, and search shapes.
  - Boundary: Replace volume-specific types with the versioned work and collection protocol. Publish one schema-owned type source for compiler and reader.
- `scripts/manuscripts/shared.ts`
  - Reusable behavior: Catalog construction, route resolution, continuity validation, search construction, and provenance joins.
  - Boundary: Split into focused content, continuity, route, and catalog modules. Inject normalized publication input, continuity records, provenance, semantic references, and route policy.
- `scripts/manuscripts/import-markdown.ts`
  - Reusable behavior: Deterministic source import and section materialization.
  - Boundary: Turn start markers, source discovery, hierarchy, and routes into layout and publication adapters. Do not preserve Coherence volume assumptions as defaults.
- `scripts/manuscripts/compile.ts`
  - Reusable behavior: Catalog and browser payload production.
  - Boundary: Convert to a framework-neutral compiler that emits versioned envelopes. Inject presentation labels and outline construction. Keep PDF and public-directory materialization in separate outputs.
- `scripts/manuscripts/validate.ts`
  - Reusable behavior: Catalog, route, continuity, and generated freshness checks.
  - Boundary: Split generic protocol checks from Coherence corpus checks. A generic validator cannot require nine volumes or Coherence ledger counts.
- `scripts/manuscripts/semantic-references.ts`
  - Reusable behavior: Reviewed semantic link application.
  - Boundary: Accept a registry and Markdown services as inputs. The current editorial registry remains author-owned.
- `scripts/manuscripts/preserve-links.ts`, `scripts/manuscripts/record-routes.ts`, and `scripts/manuscripts/audit-historical-links.ts`
  - Reusable behavior: Route lineage planning, continuity preservation, and historical resolution.
  - Boundary: Extract pure planning and validation. The author repository supplies Git history, historical source paths, and durable continuity records. Durable writes remain explicit host operations.
- `scripts/manuscripts/pdf.ts`
  - Reusable behavior: PDF layout and download manifest generation.
  - Boundary: Extract a renderer with publication metadata, fonts, filenames, and visual identity as inputs. Remove Coherence titles, art, and fallback labels.
- `src/lib/markdown-blocks.ts`, `src/lib/markdown-inline.ts`, `src/lib/reading-time.ts`, and `src/lib/manuscript-labels.ts`
  - Reusable behavior: Content parsing, reading-time calculation, and hierarchy labels.
  - Boundary: Move framework-neutral primitives below both compiler and reader. Replace volume labels with work and collection label policy.
- `src/lib/manuscript-data.ts`
  - Reusable behavior: Catalog indexes, route lookup, navigation, outline, and progress projections.
  - Boundary: Replace the global generated catalog import with `createPublicationRuntime(catalog)`. Import protocol types instead of declaring a second catalog model.
- `src/lib/reader-state.ts`, `src/lib/reader-bookmarks.ts`, `src/lib/reader-engagement.ts`, `src/lib/reader-progress-store.ts`, `src/lib/reader-preferences.ts`, `src/lib/reader-selection.ts`, `src/lib/reader-text-search.ts`, and `src/lib/section-progress.ts`
  - Reusable behavior: Local progress, bookmarks, preferences, engagement, selection, and search.
  - Boundary: Extract to reader core. Scope keys and events by `publicationId`. Preserve readers for every legacy Coherence key during migration. Remote sync remains outside this package.
- `src/lib/reader-data.ts`
  - Reusable behavior: Browser payload loading and browser-facing data shapes.
  - Boundary: Consume protocol-generated endpoints through an injected data loader. Remove volume-named shards and duplicated types.
- `src/components/MarkdownBody.tsx`, `src/components/SectionReader.tsx`, `src/components/ChapterReader.tsx`, `src/components/ManuscriptNavigation.tsx`, reader islands, toolbar primitives, search, outline, bookmark, settings, and share components
  - Reusable behavior: Accessible server rendering and enhanced reader behavior.
  - Boundary: Extract reusable components into reader and Next.js renderer packages. Supply publication runtime, labels, routes, enabled capabilities, theme slots, and attribution through props or context.
- `src/app/manuscripts/`, `src/app/progress/`, `src/app/overview/`, `src/app/updates/`, `src/app/sitemap.ts`, and `src/app/robots.ts`
  - Reusable behavior: Next.js route patterns for a complete publication.
  - Boundary: Convert to route factories or thin reference adapters. The author host keeps small checked-in route files because a package cannot own the host's Next.js route tree.
- `src/app/reset.css` and structural portions of `src/app/globals.css`
  - Reusable behavior: Reader layout, accessibility, focus, toolbar, dialog, and responsive structure.
  - Boundary: Split structural CSS, default theme tokens, and Coherence overrides. The current `src/app/globals.css` is 7,324 lines and is not a movable unit.
- `scripts/updates/`, `src/lib/updates.ts`, `src/lib/updates-pagination.ts`, and `src/components/UpdatesPageContent.tsx`
  - Reusable behavior: Complete Git history collection, snapshot validation, pagination, and Updates rendering.
  - Boundary: Inject repository, branch, path classifiers, deployment URL policy, and display copy. The snapshot and history remain author-owned.
- `scripts/repository/source-boundary.ts`, `scripts/repository/validate-markdown-links.ts`, and parts of `scripts/repository/layout.ts`
  - Reusable behavior: Source protection, link validation, and layout diagnostics.
  - Boundary: Rebuild around the publication manifest, canonical layout, declared layout, and structured diagnostic codes. Keep Coherence-only path and file-count checks in Coherence.
- `scripts/dev/preview.mjs`, `scripts/dev/production-preview.mjs`, and `scripts/dev/playwright-server-mode.ts`
  - Reusable behavior: Local process control and preview lifecycle.
  - Boundary: Extract only if the commands can operate on an installed host without Coherence path or package assumptions.
- `public/offline-sw.js` and offline reader modules
  - Reusable behavior: Offline application and audio cache behavior.
  - Boundary: Parameterize cache identity, publication origin, versioning, and output paths. Treat service-worker installation as a renderer concern.
- `tests/e2e/` and unit tests beside candidate modules
  - Reusable behavior: Reader, accessibility, continuity, audio, sync, and responsive contracts.
  - Boundary: Separate generic contract tests from Coherence parity tests. Generic tests use neutral fixtures. Coherence tests remain in the author repository.

## Author-owned Coherence files and history

These paths stay in The Coherence Thesis. A migration may add a declared-layout manifest and thin host adapters, but it must not relocate or rewrite these sources merely to match the engine default.

### Manuscripts and editorial authority

- `editorial/sources/volumes/volume-01/` through `editorial/sources/volumes/volume-09/`
- `editorial/sources/corpus/master-ledger.md`
- `editorial/sources/corpus/semantic-links.json`
- `editorial/sources/overview/coherence-thesis.json`
- `editorial/reviews/`
- `editorial/audits/`
- `editorial/debt/`
- `editorial/standards/`
- `editorial/schemas/`
- `editorial/templates/`
- `editorial/guides/`
- `editorial/AGENTS.md` and `editorial/README.md`

The declared-layout adapter should map the current volume packages to normalized works and map their order into a Coherence collection. The adapter must preserve every `editorialId`, `volumeId`, `sourcePath`, `voiceCardPath`, and `historicalSourcePaths` value.

Current editorial schemas and templates may look reusable, but `NOTICE` places them under the content license. Independent GENII editorial packages must be created as a separate, intentionally licensed product. They are not engine files in disguise.

### Durable publication state

- `publishing/continuity/aliases.json`
- `publishing/continuity/historical-section-mappings.json`
- `publishing/continuity/route-aliases.json`
- `publishing/continuity/route-ledger.json`
- `publishing/continuity/section-ledger.json`
- `publishing/continuity/section-lineage.json`
- `publishing/continuity/version-provenance.json`
- `publishing/audio/manifest.json`
- `publishing/updates/snapshot.json`
- `publishing/guides/`
- `publishing/AGENTS.md` and `publishing/README.md`

The engine may validate these records and propose reviewable changes. Build, preview, test, compile, and ordinary upgrade commands must not write them.

### Publication identity and deployment

- `public/art/`
- `public/share/`
- Coherence copy and metadata in `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/overview/page.tsx`, `src/app/progress/page.tsx`, and the manuscript routes
- Coherence identity in `src/lib/brand-identity.ts`, `src/lib/site-url.ts`, `src/components/ToolbarBrandIsland.tsx`, and `src/components/SiteShell.tsx`
- Coherence route and deployment policy currently embedded in `src/lib/updates.ts`
- `vercel.json`, `.env.example`, `.env.audio.example`, and the linked Vercel project configuration
- `supabase/config.toml` and the applied migration history under `supabase/migrations/`
- `.github/workflows/ci.yml`, `.github/CODEOWNERS`, repository instructions, and `.agents/`
- the complete Git history, including historical manuscript paths and every commit used by the Updates page

The host will retain Coherence-specific route files until equivalent engine factories pass parity. Its persistent footer must add the required `Published with GENII Publisher` attribution without removing Coherence copyright, content licensing, custodian credit, or source links.

## Optional audio boundary

Audio is a supported 1.0 capability, but a publication must build and read correctly when audio is absent.

- Generic audio protocol
  - Current paths: `src/lib/audio-manifest.ts`, `src/lib/audio-timings.ts`, `src/lib/audio-text.ts`, `src/lib/audio-voices.ts`, and `src/lib/audio-word-anchors.ts`.
  - Disposition: Extract framework-neutral schemas, version validation, immutable clip identity, timings, and text preparation. Use normalized work and section identities.
- Generic playback
  - Current paths: `src/lib/audio-playback.ts`, `src/lib/audio-queue.ts`, `src/lib/audio-events.ts`, `src/components/AudioPlayerIsland.tsx`, and `src/components/ReaderAudioWordInteractionIsland.tsx`.
  - Disposition: Extract into optional reader audio packages. Inject data loaders, event namespace, cache namespace, and enabled state.
- Offline audio
  - Current paths: `src/lib/audio-offline-cache.ts`, `src/components/OfflineSupportIsland.tsx`, and `public/offline-sw.js`.
  - Disposition: Extract with publication-scoped caches and work-based packs. Preserve legacy Coherence cache cleanup and migration in the host.
- Fish Audio provider
  - Current paths: `scripts/audio/fish-generate.ts`, `scripts/audio/fish-generator.ts`, and `scripts/audio/fish-run-resume.ts`.
  - Disposition: Keep outside core. Derive an optional provider package after removing Coherence sample section IDs and compiler imports.
- Local alignment
  - Current paths: `scripts/audio/mlx-whisper-aligner.ts` and `scripts/audio/mlx-whisper-worker.py`.
  - Disposition: Keep as optional production tooling. It must not be installed or executed by ordinary readers or builds.
- Supabase object publication
  - Current path: `scripts/audio/fish-publish-manifest.ts`.
  - Disposition: Split provider output validation from storage upload. Supabase storage is an optional destination adapter, not part of the generic audio protocol.
- Author publication record
  - Current path: `publishing/audio/manifest.json`.
  - Disposition: Keep in Coherence. It records published immutable audio and project-specific public URLs.
- Disposable runs and browser payloads
  - Current paths: `generated/reports/audio-runs/` and `public/data/audio-manifest.json`.
  - Disposition: Regenerate locally. Never copy into the engine repository or package tarballs.

An engine update, host build, or preview must never call audio generation or upload. Generation, alignment, manifest recording, and remote publication remain distinct explicit operations.

## Optional Supabase sync boundary

Local reading progress and bookmarks are reader-core features. Supabase is one optional synchronization adapter.

- Local state and reconciliation
  - Current paths: `src/lib/reader-state.ts`, `src/lib/reader-bookmarks.ts`, `src/lib/reader-engagement.ts`, and `src/lib/reader-progress-store.ts`.
  - Disposition: Extract to reader core with no Supabase imports. Expose provider-neutral state and reconciliation contracts.
- Supabase browser adapter
  - Current paths: `src/lib/reader-sync.ts` and `src/lib/supabase/browser.ts`.
  - Disposition: Extract behind a sync interface. Keep consent, schema-ahead protection, privacy defaults, and local fallback.
- Supabase server adapter
  - Current paths: `src/lib/supabase/server.ts`, `src/app/auth/callback/route.ts`, and `src/app/api/account/route.ts`.
  - Disposition: Package provider services and expose thin Next.js route factories. The host owns environment variables and destructive account-deletion authority.
- Sync interface
  - Current paths: `src/components/ToolbarProgressIsland.tsx` and `src/components/ProgressCloudBadge.tsx`.
  - Disposition: Split the current combined local-state, auth, consent, and provider interface. Render local progress without loading the provider package when sync is disabled.
- Database contract
  - Current paths: `supabase/migrations/20260630000000_reader_sync.sql` through `supabase/migrations/20260727000000_atomic_reader_bookmark_merge.sql`, plus `supabase/tests/reader_bookmark_merge.sql`.
  - Disposition: Derive a clean adapter migration set for new publications. Preserve Coherence's applied migration files and remote history in Coherence.
- Project configuration
  - Current path: `supabase/config.toml`.
  - Disposition: Keep in Coherence. It names the Coherence local project and host-specific ports and auth settings.

Installing or rolling back an engine package does not apply or reverse a database migration. Every remote database action requires its own dry run, backup and rollback analysis, and explicit authority.

## Disposable generated output

The following current paths are ignored and must remain disposable:

- `generated/manuscripts/sections/`
- `generated/manuscripts/catalog.json`
- `generated/reports/imports/`
- `generated/reports/semantic-links/`
- `generated/reports/audio-runs/`
- `generated/updates/snapshot.json`
- `public/data/audio-manifest.json`
- `public/data/reader-sections.json`
- `public/data/progress-sections.json`
- `public/data/bookmark-sections.json`
- `public/data/breadcrumbs/`
- `public/data/search-index.json`
- `public/data/outline.json`
- `public/data/pdf-downloads.json`
- `public/downloads/sections/`
- `public/downloads/manuscripts/`
- `public/downloads/.pdf-build-cache.json`
- `node_modules/.cache/coherence-thesis/manuscripts-prepare.json`
- `.next/`, `.next-e2e/`, `out/`, coverage, and browser reports

No file from these paths belongs in the engine repository, a package source tree, or an author migration patch. New generated envelopes must carry `schemaVersion`, `publicationId`, `engineVersion`, and `buildId`. The engine's canonical disposable root is `.publisher/`; a renderer may materialize additional output only inside declared output roots.

## Mixed-license hazards

`NOTICE`, `LICENSE`, and `LICENSE-content` are the authority for the current Coherence tree.

- Apache software entering a CPAL repository
  - Evidence: `scripts/`, application structure in `src/`, `supabase/`, tests, and operational documentation are mapped to Apache License 2.0.
  - Treatment: Do not remove Apache notices or label copied files as solely CPAL without documented relicensing authority. Either obtain the necessary rights, preserve a mixed-license boundary, or implement new CPAL code from behavior and tests. Record provenance in `NOTICE.md`, `LEGAL`, and `CHANGES.md`.
- Creative work inside technical paths
  - Evidence: Original user-facing copy embedded in `src/` is CC BY-SA 4.0.
  - Treatment: Parameterize copy and use neutral fixtures. Do not transfer Coherence titles, descriptions, slogans, footer copy, or artwork into engine defaults.
- Editorial material that appears generic
  - Evidence: `editorial/schemas/`, `editorial/standards/`, `editorial/templates/`, reviews, debt, and source records are mapped to CC BY-SA 4.0.
  - Treatment: Keep them in Coherence. Publish independent editorial packages with their own explicit license and provenance if the Foundation wants reusable voices or standards.
- Durable publishing records
  - Evidence: `publishing/continuity/` and `publishing/audio/manifest.json` follow the creative work they describe.
  - Treatment: Keep them author-owned. Engine tests use invented neutral records.
- Generated derivatives
  - Evidence: `generated/`, `public/data/`, and `public/downloads/` inherit the licenses of their source material.
  - Treatment: Exclude them from packages and migration commits. Regenerate them inside the consuming repository.
- Third-party fonts
  - Evidence: `fonts/` contains PT Serif and PT Mono with SIL Open Font License texts.
  - Treatment: Do not absorb the directory by default. If a theme redistributes a font, carry the exact font license and notices and verify package contents.
- Art and social images
  - Evidence: `public/art/` and `public/share/` are creative work.
  - Treatment: Keep them in Coherence and exercise parity through host-owned assets.
- Dependency licenses
  - Evidence: `package-lock.json` records third-party packages under their own terms.
  - Treatment: Build a fresh engine dependency graph, audit every distributed dependency, and preserve required notices. Do not use the Coherence lockfile as an engine lockfile.

The extraction should prefer new generic interfaces and neutral implementations over a history filter. A blind path copy would move mixed creative material, Coherence URLs, and provider state into a CPAL package. That would be licensing by archaeological accident, which is not a recognized branch of jurisprudence.

## Dependency cycles and wrong-way edges

The target dependency direction is schema, then content, then reader, then framework or provider adapters. The current tree violates that direction in several places.

- `scripts/manuscripts/compile.ts` dynamically imports `src/lib/manuscript-data.ts`, which statically imports `generated/manuscripts/catalog.json` produced by the compiler.
  - Problem: This is a build-time cycle with correctness depending on import timing and module cache state.
  - Inversion: Move outline construction to a pure function that accepts the freshly built catalog. Create the runtime from injected catalog data after compilation.
- `scripts/manuscripts/compile.ts` and `scripts/manuscripts/shared.ts` import `src/lib/manuscript-labels.ts`.
  - Problem: The content compiler depends on the reader application for labels and route semantics.
  - Inversion: Move generic labels and route policy into content or schema packages. Pass publication-specific labels through configuration.
- `scripts/manuscripts/io.ts` and `scripts/manuscripts/semantic-references.ts` import Markdown and reading-time utilities from `src/lib/`.
  - Problem: Build tooling depends on application code.
  - Inversion: Move the pure utilities below both compiler and renderer.
- `scripts/manuscripts/shared.ts` calls `scripts/repository/layout.ts`, which reads fixed globals from `scripts/repository/paths.ts`.
  - Problem: Catalog compilation requires the Coherence layout, exactly nine volume packages, fixed overview files, and durable publishing files.
  - Inversion: Resolve canonical or declared layout first. Pass normalized manifests and records into the compiler. Keep the nine-volume assertion in Coherence validation.
- `scripts/manuscripts/shared.ts` reads aliases, route ledgers, lineage, provenance, semantic registry, overview, Git revision, and volume manifests from global paths.
  - Problem: The compiler has hidden author-repository dependencies and cannot compile a neutral publication in memory.
  - Inversion: Introduce an explicit `CompilationContext` carrying normalized publication data and services. File-system adapters construct that context.
- `scripts/manuscripts/types.ts`, `src/lib/manuscript-data.ts`, and `src/lib/reader-data.ts` declare overlapping catalog and payload types.
  - Problem: Compiler and runtime contracts can drift without a protocol version bump.
  - Inversion: Generate or export types from the versioned schema package. Make artifact envelopes explicit and validated at every boundary.
- `scripts/audio/` imports compiler types and multiple `src/lib/audio-*` modules.
  - Problem: Provider tooling depends on both content internals and reader implementation.
  - Inversion: Put audio schemas and text preparation in a framework-neutral audio protocol. Feed provider jobs normalized sections. Keep playback in reader audio and vendor calls in provider adapters.
- `src/components/ToolbarProgressIsland.tsx` imports local state, Supabase sync, auth, consent, and Next.js navigation directly.
  - Problem: The default reader cannot shed Supabase cleanly, and the provider interface is fused to a 1,049-line component.
  - Inversion: Split local progress UI from an injected sync capability. Load the Supabase adapter only when configured.
- `scripts/updates/generator.ts` imports `src/lib/updates.ts` and the Git helper from `scripts/manuscripts/shared.ts`.
  - Problem: Updates generation depends on reader code and the manuscript compiler. It also inherits Coherence repository and deployment constants.
  - Inversion: Create an updates domain package with injected Git, repository, path classifier, and deployment policy. Render it through the reader package.
- Application routes and `src/components/SiteShell.tsx` import the module-global catalog from `src/lib/manuscript-data.ts`.
  - Problem: Every host is tied to one generated path and one publication singleton.
  - Inversion: Construct one publication runtime in the host and pass it to route factories and the renderer.
- Hardcoded `coherence` storage keys, custom event names, cache names, and invalid cache origins appear across `src/lib/` and reader components.
  - Problem: Two publications on one origin can collide, and migration can strand existing reader state.
  - Inversion: Namespace new state by `publicationId`. Coherence host migrations must read old keys, write new keys transactionally, and retain rollback readers through the announced compatibility window.
- `src/app/globals.css`, `src/components/SiteShell.tsx`, `src/lib/brand-identity.ts`, and reader components combine structure and Coherence presentation.
  - Problem: Theme replacement requires forking core components.
  - Inversion: Separate structural accessibility CSS, default theme tokens, theme slots, publication copy, and host overrides. Keep the attribution component outside removable theme slots.

## Ordered extraction sequence

1. Freeze an acceptance baseline at Coherence commit `654a2c36ba825ee191e67ded3b193ff4e0acde24`. Record route inventory, redirects, generated artifact hashes, browser storage keys, audio manifest identity, Updates head, screenshots, and current production deployment identity. Do not copy generated files into the engine.
2. Finish GENII Publisher governance, CPAL provenance rules, package boundaries, and source-package exclusion tests. Decide how Apache-licensed source will be handled before moving any implementation.
3. Implement the schema package, normalized publication model, canonical layout, and fully supported declared-layout resolver. Prove both layouts with neutral fixtures.
4. Move or reimplement pure Markdown, hashing, reading-time, identity, and route primitives below the compiler. Remove all compiler imports from `src/`.
5. Build a compiler that accepts an explicit context and emits versioned protocol envelopes. Remove the dynamic catalog import and all implicit reads of Coherence paths.
6. Extract continuity and Updates domain logic. Keep durable records, Git history, literary path classification, repository identity, and deployment policy injected by the author host.
7. Extract reader core with publication-scoped local state. Add deterministic legacy-key migration and rollback coverage before Coherence consumes it.
8. Extract the official Next.js renderer and default theme. Convert route files into thin host adapters. Separate structural CSS from Coherence theme overrides and enforce the persistent GENII Publisher footer attribution.
9. Extract optional audio protocol, playback, offline support, provider adapters, and storage adapters. Prove the application with audio absent and with a neutral fake provider.
10. Extract the optional sync interface and Supabase adapter. Prove local-only reading with no Supabase dependencies, then prove the adapter against an isolated local database.
11. Pack every public package and install the tarballs into a clean neutral publication. Verify that package contents contain no Coherence prose, art, URLs, project IDs, generated output, credentials, or incompatible license material.
12. Publish a prerelease only after neutral package installation and a second unrelated publication pass. The second publication must use the canonical layout and a distinct theme or extension.
13. Create a Coherence migration branch that pins exact prerelease versions and selects declared-layout mode. Keep `editorial/`, `publishing/`, public routes, art, Git history, Vercel project, and Supabase migration history in place.
14. Apply reviewable host migrations. Never revise manuscript prose. Regenerate disposable output locally and compare it with the frozen acceptance baseline.
15. Complete existing-project preview acceptance. Stop before final migration merge or production deployment.
16. Request fresh user approval for the exact Coherence migration commit and accepted preview. Merge and allow the existing Vercel project to deploy production only after that approval.
17. Verify production and preserve a tested rollback. Do not run a Supabase migration or audio publication as an incidental part of release.

## Coherence preview acceptance gates

Every gate below must pass on the final migration commit before asking for production approval.

- Source custody: `editorial/` and `publishing/` have no migration-generated changes except an explicitly reviewed manifest or adapter record. No manuscript prose changes appear in the migration diff. Complete Coherence Git history remains intact.
- Exact engine input: Coherence pins exact GENII Publisher package versions in its package manifest and lockfile. The declared layout resolves every current and historical source path without moving source files.
- Engine package proof: Engine validation passes, packed artifacts install in a clean consumer, and package-content checks find no Coherence content, assets, URLs, project IDs, credentials, or disposable output.
- Coherence static gate: `npm run validate:ui` passes from the migration commit. The repository source-boundary, editorial, continuity, Updates, unit, build, and browser checks remain green.
- Generated boundary: Build and preview leave `editorial/` and `publishing/` byte stable. Generated files appear only in ignored output roots. Every generated envelope contains the required identity fields.
- Route continuity: The current canonical routes, historical aliases, fragments, sitemap, robots output, and trailing-slash behavior match the frozen baseline. No redirect loop or lost public route exists.
- Server reading: Manuscript text, section navigation, and essential metadata render without JavaScript on representative work, collection, overview, and historical routes.
- Reader parity: Desktop, mobile, Chromium, and focused WebKit coverage passes for navigation, search, outline, progress, bookmarks, preferences, sharing, heading links, responsive menus, and accessibility.
- Local data migration: Existing Coherence progress, bookmark, preference, engagement, and audio preference keys migrate without loss. New state is publication-scoped. Rollback can still read the preserved state.
- Audio optionality and parity: A build with audio disabled succeeds. The accepted Coherence preview resolves the current immutable audio manifest, hosted clips, timings, queue, word interaction, browser fallback, and offline behavior without upload or regeneration.
- Sync optionality and privacy: A build without Supabase succeeds and keeps local state private. Local database contracts pass for the adapter. Preview auth, consent, merge, schema-ahead protection, sign-out, and account deletion are manually tested only with appropriate test authority and no production database mutation.
- Updates continuity: The Updates snapshot covers complete Coherence history through the required main head. Current and historical manuscript paths retain literary classification. A missing commit fails the build.
- Theme and attribution: Coherence styling and brand remain intact. The persistent footer shows `Published with GENII Publisher`, links to `https://publisher.genii.foundation`, exposes the covered source location, and remains visible and accessible on every reader route.
- Preview destination: The candidate deploys to the existing Coherence Vercel project's preview environment. No second Coherence Vercel project, production alias, or production deployment is created.
- Human acceptance: The user manually accepts the exact preview URL and commit. Technical checks alone do not grant production authority.

## Production authorization and verification gates

Production remains frozen until all preview gates pass.

1. Present the exact migration commit, pull request, package versions, accepted preview URL, validation receipts, known differences, rollback commit, and any database or storage implications.
2. Obtain fresh explicit user approval to merge that exact final Coherence migration and deploy it through the existing Vercel project. Earlier architectural approval, repository creation authority, package publication authority, or preview acceptance does not satisfy this gate.
3. Do not apply Supabase migrations, change provider credentials, publish audio, or mutate storage unless each action receives separate explicit authority and its own dry run.
4. Merge only the approved head. If the head changes, repeat affected validation and request approval again.
5. Verify the existing production domain serves the approved revision, the persistent GENII Publisher attribution and source link, canonical and historical routes, server-rendered prose, local progress, audio, optional sync, and the production Updates entry.
6. If a material parity, privacy, continuity, attribution, or source-availability failure appears, restore the prior Vercel production deployment and revert the host migration. Database rollback is separate and is not implied by application rollback.
7. Keep the previous compatible engine package and host commit available until production verification and the rollback window are complete.
