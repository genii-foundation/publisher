/*
No alternative license is selected for GENII Publisher Original Code. The alternative-license fields in the required Exhibit A notice below are intentionally unpopulated.

“The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/cpal-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is GENII Publisher.
The Original Developer is not the Initial Developer and is __________. If left blank, the Original Developer is the Initial Developer.
The Initial Developer of the Original Code is GENII Foundation. All portions of the code written by GENII Foundation are Copyright (c) 2026 GENII Foundation. All Rights Reserved.
Contributor ______________________.
Alternatively, the contents of this file may be used under the terms of the _____ license (the [___] License), in which case the provisions of [______] License are applicable instead of those above.
If you wish to allow use of your version of this file only under the terms of the [____] License and not to allow others to use your version of this file under the CPAL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the [___] License. If you do not delete the provisions above, a recipient may use your version of this file under either the CPAL or the [___] License.”
*/

// Every generic Reader, narration, and synchronization capability observed in
// the migration publication, and where each one lives after this engine takes
// over.
//
// This exists because "no functionality is lost" is a claim, and a claim about
// dozens of features is worth nothing unless something enumerates them. The
// enumeration is the point. A capability nobody wrote down is a capability nobody
// notices the absence of until a reader does.
//
// The inventory was taken from a deployed publication with narration and
// cross-device synchronization in production. It records capabilities rather than
// files, because a file that moves is not a loss and a feature that quietly stops
// working is.
//
// Nothing here depends on that repository existing. Each entry names its own
// evidence inside this one, and the test beside this file checks that the evidence
// is real.
//
// `home` says who owns the capability in the target architecture:
//
//   engine    this engine implements it
//   renderer  the official renderer implements the default interface
//   provider  the reference provider package implements it
//   host      publication-specific application code owns it
//   author    an author's own tooling, outside any published package
//
// `status` says what happened to it:
//
//   preserved  works as before, wherever it now lives
//   upgraded   works better than before, and `why` says how
//   added      did not exist before
//   planned    is accepted scope but is not implemented yet
//   blocked    cannot work yet, and `blockedBy` names the decision it waits on
//
// A `planned` status is deliberately uncomfortable. It prevents an accepted
// product responsibility from being described as preserved merely because the
// migration publication still has an older implementation.

/** @typedef {"engine" | "renderer" | "provider" | "host" | "author"} ParityHome */
/** @typedef {"preserved" | "upgraded" | "added" | "planned" | "blocked"} ParityStatus */

export const COHERENCE_PARITY_SOURCE = Object.freeze({
  repository: "https://github.com/genii-foundation/coherence-thesis",
  ref: "423a21202ff32c5f879ca9f10e0607c1579b97a4",
  observedThrough: "2026-08-19",
});

export const READER_PARITY = Object.freeze([
  {
    id: "reader.text.server_rendering",
    capability: "Complete manuscript text readable without client JavaScript",
    home: "renderer",
    status: "preserved",
    evidence: { file: "packages/next/src/components/pages.tsx" },
    sourcePaths: ["src/app/manuscripts/[volumeId]/[[...route]]/page.tsx"],
  },
  {
    id: "reader.catalog.navigation",
    capability: "Publication, collection, work, and section navigation",
    home: "renderer",
    status: "preserved",
    evidence: { file: "packages/next/src/components/pages.tsx" },
    sourcePaths: ["src/components/ManuscriptsPage.tsx", "src/components/ChapterReader.tsx"],
  },
  {
    id: "reader.routes.continuity",
    capability: "Canonical Reader addresses and historical redirect continuity",
    home: "engine",
    status: "upgraded",
    why: "Routes and redirects are validated as exact protocol data and dispatched by one runtime instead of being reconstructed independently by pages.",
    evidence: { file: "packages/reader/src/runtime.ts" },
    sourcePaths: ["src/lib/manuscript-data.ts", "src/lib/legacy-route.ts"],
  },
  {
    id: "reader.sections.compilation",
    capability: "All declared manuscript sections and hierarchy reaching the Reader artifact",
    home: "engine",
    status: "added",
    why: "Work manifests now own durable section identities, hierarchy, routes, continuity, and exact source boundaries, so heading edits cannot silently change public identity.",
    evidence: { file: "packages/publisher/src/node/build.ts" },
    sourcePaths: ["src/lib/manuscript-data.ts", "scripts/manuscripts/import-markdown.ts"],
  },
  {
    id: "reader.hierarchy.breadcrumbs",
    capability: "Part and chapter hierarchy with contextual breadcrumbs",
    home: "renderer",
    status: "upgraded",
    why: "Server-rendered work and section ancestry follows validated parent identities and canonical Reader destinations, while the hydrated contents surface presents the same current path and active outline identity.",
    evidence: {
      decision: "docs/architecture/0030-contextual-reader-breadcrumbs.md",
      renderer: "packages/next/src/components/pages.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/ChapterReader.tsx", "src/lib/manuscript-labels.ts"],
  },
  {
    id: "reader.progress.local",
    capability: "Publication-scoped local reading progress without an account",
    home: "engine",
    status: "added",
    why: "The pure state contract makes the local privacy default portable across renderers without granting storage authority to the protocol layer.",
    evidence: { file: "packages/reader/src/progress.ts" },
    sourcePaths: ["src/lib/reader-state.ts"],
  },
  {
    id: "reader.progress.continuity",
    capability: "Progress following declared continuity identities across section changes",
    home: "engine",
    status: "preserved",
    evidence: { file: "packages/reader/src/progress.ts" },
    sourcePaths: ["src/lib/reader-state.ts"],
  },
  {
    id: "reader.progress.canonical_percent",
    capability: "One word-weighted progress percentage shared by every surface",
    home: "engine",
    status: "preserved",
    evidence: { file: "packages/reader/src/progress.ts" },
    sourcePaths: ["src/lib/reader-state.ts", "src/lib/section-progress.ts"],
  },
  {
    id: "reader.progress.revision_status",
    capability: "Read sections marked updated when their content revision changes",
    home: "engine",
    status: "preserved",
    evidence: { file: "packages/reader/src/progress.ts" },
    sourcePaths: ["src/lib/reader-state.ts", "src/lib/section-progress.ts"],
  },
  {
    id: "reader.progress.engagement_metrics",
    capability: "Bounded open, scroll, reading time, return, and audio progress metrics",
    home: "engine",
    status: "preserved",
    evidence: { file: "packages/reader/src/progress.ts" },
    sourcePaths: ["src/lib/reader-state.ts"],
  },
  {
    id: "reader.state.reactive_store",
    capability: "Atomic local updates and cross-tab notification for private Reader state",
    home: "renderer",
    status: "upgraded",
    why: "One generic renderer store supplies stable server snapshots, atomic canonical updates, same-tab notification, native cross-tab convergence, injected test authority, and in-memory continuity when persistence is unavailable. Progress and full bookmark documents consume the same primitive.",
    evidence: {
      store: "packages/next/src/client/reader-store.ts",
      consumer: "packages/next/src/client/reader-rail.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/lib/reader-store.ts", "src/lib/reader-progress-store.ts"],
  },
  {
    id: "reader.progress.default_interface",
    capability: "Default progress controls, section states, and unified percentage display",
    home: "renderer",
    status: "upgraded",
    why: "The official Reader separates one opening from scroll samples, conservatively accumulates visible active reading time, exposes canonical section status, progress, visits, and returns, and supports explicit completion of the current revision through one reactive local document.",
    evidence: {
      decision: "docs/architecture/0027-default-reader-progress-session.md",
      renderer: "packages/next/src/client/reader-rail.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/ToolbarProgressIsland.tsx", "src/components/SectionCardGrid.tsx"],
  },
  {
    id: "reader.progress.map_and_recommendations",
    capability: "Reading heatmap, recent sections, and next section recommendations",
    home: "renderer",
    status: "upgraded",
    why: "One lazy Reader-build-bound catalog now feeds a word-weighted publication map, updated-first recommendations, recent reading, current revision status, and a mobile-contained default interface.",
    evidence: {
      decision: "docs/architecture/0038-lazy-reader-progress-catalog.md",
      engine: "packages/reader/src/progress-catalog.ts",
      renderer: "packages/next/src/client/reader-rail.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/ReaderProgressHeatmapIsland.tsx", "src/lib/reader-state.ts"],
  },
  {
    id: "reader.bookmarks.local",
    capability: "Publication-scoped local bookmarks, passage capture, and notes",
    home: "engine",
    status: "added",
    why: "The generic local document is publication scoped, immutable, bounded, canonical, and independent of storage or network authority. The official renderer refuses DOM text that differs from canonical Reader blocks before translating a same-section selection into portable offsets, then captures an optional private note without losing the validated range.",
    evidence: {
      engine: "packages/reader/src/bookmarks.ts",
      selection: "packages/next/src/client/reader-selection.ts",
      decision: "docs/architecture/0033-optional-bookmark-capture-note.md",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/lib/reader-bookmarks.ts"],
  },
  {
    id: "reader.bookmarks.passage_ranges",
    capability: "Bookmarks spanning exact offsets across one or more rendered passages",
    home: "engine",
    status: "added",
    why: "Portable ranges bind exact UTF-16 offsets, block hashes, work identity, and reviewed section continuity across adjacent blocks.",
    evidence: { file: "packages/reader/src/passage-range.ts" },
    sourcePaths: ["src/lib/reader-passage-range.ts", "src/lib/reader-bookmarks.ts"],
  },
  {
    id: "reader.bookmarks.revision_relocation",
    capability: "Bookmark relocation by content and surrounding text after passage revisions",
    home: "engine",
    status: "upgraded",
    why: "Relocation preserves exact ranges, accepts only unique content-hash renames, and uses bounded quote plus context reanchoring without guessing through ambiguity.",
    evidence: { file: "packages/reader/src/bookmarks.ts" },
    sourcePaths: ["src/lib/reader-passage-range.ts", "src/lib/reader-bookmarks.ts"],
  },
  {
    id: "reader.bookmarks.merge_and_tombstones",
    capability: "Deterministic bookmark merge with absorbing deletion tombstones",
    home: "engine",
    status: "added",
    why: "The merge is commutative and idempotent, resolves equal timestamps deterministically, and prevents either clock skew or later edits from reviving a tombstone.",
    evidence: { file: "packages/reader/src/bookmarks.ts" },
    sourcePaths: ["src/lib/reader-bookmarks.ts", "src/lib/reader-sync.ts"],
  },
  {
    id: "reader.bookmarks.large_collections",
    capability: "Bounded thousand-item bookmark collections with saved-text search and virtualization",
    home: "renderer",
    status: "upgraded",
    why: "The official Reader queries the complete bounded document while mounting only a fixed, overscanned viewport, preserves full collection operations, exposes logical position and size to assistive technology, and contains the scroll surface on mobile.",
    evidence: {
      decision: "docs/architecture/0035-virtualized-bookmark-collection.md",
      renderer: "packages/next/src/client/reader-bookmark-list.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/ToolbarBookmarksIsland.tsx", "src/lib/reader-bookmarks.ts"],
  },
  {
    id: "reader.bookmarks.margin_markers",
    capability: "Stable margin markers instead of prose-obscuring bookmark highlights",
    home: "renderer",
    status: "upgraded",
    why: "The official renderer accepts only exact or uniquely relocated canonical ranges, keeps every marker outside the manuscript subtree, measures immediately in background tabs, and routes the accessible marker into the existing bookmark surface.",
    evidence: {
      decision: "docs/architecture/0034-bookmark-margin-markers.md",
      renderer: "packages/next/src/client/reader-bookmark-markers.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/ReaderBookmarkHighlightIsland.tsx", "src/app/globals.css"],
  },
  {
    id: "reader.bookmarks.safe_deletion",
    capability: "Accessible single and bulk bookmark deletion confirmation",
    home: "renderer",
    status: "upgraded",
    why: "Single and bulk removal use labeled modal confirmation, deliberate focus movement and return, Escape cancellation, one atomic reactive update, and the engine's absorbing synchronization tombstones.",
    evidence: {
      decision: "docs/architecture/0029-confirmed-bookmark-deletion.md",
      renderer: "packages/next/src/client/reader-rail.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/ToolbarBookmarksIsland.tsx"],
  },
  {
    id: "reader.bookmarks.export",
    capability: "Readable bookmark export that preserves selected text, notes, and destinations",
    home: "engine",
    status: "upgraded",
    why: "A versioned plain-text export indents all reader-controlled lines, omits tombstones, preserves complete live quotes, notes, saved times, and destinations, and requires no account or provider.",
    evidence: {
      decision: "docs/architecture/0028-readable-bookmark-export.md",
      engine: "packages/reader/src/bookmarks.ts",
      renderer: "packages/next/src/client/reader-rail.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/lib/reader-export.ts", "src/lib/reader-bookmarks.ts"],
  },
  {
    id: "reader.bookmarks.secondary_surfaces",
    capability: "Bookmark presence in progress, section, and search surfaces",
    home: "renderer",
    status: "upgraded",
    why: "Reactive private bookmark state now appears in publication progress, current-section margin markers, and search results while preserving reviewed continuity aliases.",
    evidence: {
      decision: "docs/architecture/0038-lazy-reader-progress-catalog.md",
      renderer: "packages/next/src/client/reader-rail.tsx",
      markers: "packages/next/src/client/reader-bookmark-markers.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/ReaderProgressHeatmapIsland.tsx", "src/components/SectionCardGrid.tsx", "src/components/SearchMenuIsland.tsx"],
  },
  {
    id: "reader.preferences.state",
    capability: "Publication-scoped font, color, motion, highlight, and focus preferences",
    home: "engine",
    status: "added",
    why: "The generic state contract keeps publication defaults and user choices separate while rejecting malformed or newer storage documents.",
    evidence: { file: "packages/reader/src/preferences.ts" },
    sourcePaths: ["src/lib/reader-preferences.ts"],
  },
  {
    id: "reader.preferences.default_interface",
    capability: "Accessible default settings interface for every Reader preference",
    home: "renderer",
    status: "upgraded",
    why: "The default settings panel exposes every bounded preference, restricts fonts to publication policy, applies changes immediately, and persists them under the publication-scoped key.",
    evidence: {
      decision: "docs/architecture/0031-default-settings-and-bookmark-search.md",
      renderer: "packages/next/src/client/reader-rail.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/ReaderSettingsIsland.tsx"],
  },
  {
    id: "reader.focus.adjustable",
    capability: "Adjustable focus treatment from none through strong",
    home: "renderer",
    status: "added",
    why: "The official Reader rail persists the closed focus vocabulary and applies progressively narrower reading measures without duplicating or replacing manuscript text.",
    evidence: { file: "packages/next/src/client/reader-rail.tsx" },
    sourcePaths: ["src/components/MarkdownBody.tsx", "src/components/ReaderSettingsIsland.tsx"],
  },
  {
    id: "reader.focus.text_ownership",
    capability: "Focus markup preserving one accessible text occurrence and narration offsets",
    home: "renderer",
    status: "upgraded",
    why: "The official renderer transforms eligible Markdown words during server rendering, keeps one exact text occurrence, excludes strong and code content, and proves that focus changes preserve selection, bookmark offsets, and marker resolution.",
    evidence: {
      decision: "docs/architecture/0036-focus-text-ownership.md",
      renderer: "packages/next/src/components/focus-markup.ts",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/MarkdownBody.tsx"],
  },
  {
    id: "reader.artifacts.capability_slices",
    capability: "Small capability-specific Reader artifacts loaded only when their interface opens",
    home: "engine",
    status: "upgraded",
    why: "Search, publication progress, and narration are separate bounded artifacts bound to one Reader build and fetched only when their respective interfaces open.",
    evidence: {
      decision: "docs/architecture/0038-lazy-reader-progress-catalog.md",
      narrationDecision: "docs/architecture/0039-lazy-default-narration-player.md",
      narration: "packages/reader/src/narration.ts",
      progress: "packages/reader/src/progress-catalog.ts",
      search: "packages/reader/src/search.ts",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/lib/reader-data.ts", "scripts/manuscripts/compile.ts"],
  },
  {
    id: "reader.search.index",
    capability: "Deterministic full-text search over public Reader content",
    home: "engine",
    status: "upgraded",
    why: "The build-bound client artifact omits unrelated Reader data, validates fetched identity and folds, supports Unicode and diacritics, and maps matches back to exact original-text snippet offsets.",
    evidence: { file: "packages/reader/src/search.ts" },
    sourcePaths: ["src/lib/reader-text-search.ts"],
  },
  {
    id: "reader.search.default_interface",
    capability: "Keyboard-accessible search with useful empty and bookmark states",
    home: "renderer",
    status: "upgraded",
    why: "The lazy build-bound publication search and latest private bookmark document remain separate, while one labeled interface combines their bounded results and reports an empty state only when neither matches.",
    evidence: {
      decision: "docs/architecture/0031-default-settings-and-bookmark-search.md",
      renderer: "packages/next/src/client/reader-rail.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/SearchMenuIsland.tsx"],
  },
  {
    id: "reader.offline.atomic_packages",
    capability: "Staged immutable publication packages activated atomically for offline reading",
    home: "engine",
    status: "upgraded",
    why: "The pure per-work catalog binds Reader, renderer, work, and optional narration identity. The browser stages and verifies every declared and discovered resource before switching one active metadata pointer, and a failed replacement retains the prior complete cache.",
    evidence: {
      decision: "docs/architecture/0046-atomic-offline-publication-packages.md",
      core: "packages/reader/src/offline.ts",
      adapter: "packages/next/src/client/reader-offline-cache.ts",
      tests: "tests/next-reader-offline-cache.test.mjs",
    },
    sourcePaths: ["src/lib/audio-offline-cache.ts"],
  },
  {
    id: "reader.offline.complete_manuscript",
    capability: "Downloaded works including HTML, Reader data, static assets, and discovered dependencies",
    home: "renderer",
    status: "upgraded",
    why: "Each work package includes canonical and historical documents, shared Reader artifacts, publication and work assets, every matching voice clip and timing sidecar, plus same-origin Next.js dependencies discovered from downloaded HTML and CSS. Text-only works remain complete.",
    evidence: {
      decision: "docs/architecture/0046-atomic-offline-publication-packages.md",
      planner: "packages/reader/src/offline.ts",
      renderer: "packages/next/src/client/reader-offline-provider.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/lib/audio-offline-cache.ts", "public/offline-sw.js"],
  },
  {
    id: "reader.offline.network_fallback",
    capability: "Network-first reading with active package and runtime cache fallbacks",
    home: "renderer",
    status: "upgraded",
    why: "The generic worker leaves private and framework traffic alone, serves ordinary requests network first, then checks active immutable packages and its runtime cache. Offline links force full document navigation instead of depending on a framework flight response.",
    evidence: {
      decision: "docs/architecture/0046-atomic-offline-publication-packages.md",
      host: "packages/next/src/host.ts",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["public/offline-sw.js"],
  },
  {
    id: "reader.toolbar.viewport_access",
    capability: "Toolbar menus that remain reachable and stable in supported viewports",
    home: "renderer",
    status: "added",
    why: "The official rail uses a bounded desktop panel and a viewport-bounded mobile sheet above fixed bottom controls, with visible focus and Escape dismissal.",
    evidence: { file: "packages/next/styles.css" },
    sourcePaths: ["src/app/globals.css", "tests/e2e/toolbar.spec.ts"],
  },
  {
    id: "reader.accessibility.content",
    capability: "Accessible tables, focus states, confirmations, contrast, and reduced motion",
    home: "renderer",
    status: "upgraded",
    why: "The official renderer now combines its existing focus, confirmation, contrast, and reduced-motion behavior with named keyboard-focusable table regions, scoped column headers, declared alignment, and contained horizontal scrolling.",
    evidence: {
      decision: "docs/architecture/0047-accessible-manuscript-extensions.md",
      renderer: "packages/next/src/components/markdown.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
    sourcePaths: ["src/components/MarkdownBody.tsx", "src/app/globals.css"],
  },
  {
    id: "reader.markdown.extension_slots",
    capability: "Accessible heading actions and table regions without surrendering manuscript text ownership",
    home: "renderer",
    status: "upgraded",
    why: "Server components retain exact heading and cell text while narrow extensions add only one adjacent hydrated copy action or one accessibility and scrolling wrapper. Malformed tables remain ordinary Markdown.",
    evidence: {
      decision: "docs/architecture/0047-accessible-manuscript-extensions.md",
      headingAction: "packages/next/src/client/reader-heading-action.tsx",
      renderer: "packages/next/src/components/markdown.tsx",
    },
    sourcePaths: ["src/components/MarkdownBody.tsx"],
  },
  {
    id: "reader.preview.candidate_identity",
    capability: "A local preview proving its exact worktree, branch, commit, and candidate bytes",
    home: "engine",
    status: "planned",
    plannedBy: "docs/architecture/0015-opinionated-reader-application.md",
    sourcePaths: ["scripts/dev/preview.mjs"],
  },
  {
    id: "reader.updates.multiple_views",
    capability: "Paginated publication Updates and a derived literary view",
    home: "renderer",
    status: "upgraded",
    why: "Author-owned catalogs now supply stable named views, Publisher binds them to the Reader build, and the generated host expands bounded pagination without importing publication history rules.",
    evidence: { file: "packages/next/src/routes.ts" },
    sourcePaths: ["src/app/updates/page.tsx", "src/app/updates/literary/page.tsx"],
  },
]);

export const AUDIO_PARITY = Object.freeze([
  {
    id: "audio.identity.spoken_input",
    capability: "Narration identity derived from spoken title and normalized spoken body",
    home: "engine",
    status: "upgraded",
    why: "The engine derives full SHA-256 identity from the exact renderer-compatible spoken text while keeping provider audioVersionId values opaque. It rejects unsafe Unicode and exposes canonical text for author generation evidence.",
    evidence: {
      decision: "docs/architecture/0044-spoken-input-identity.md",
      implementation: "packages/content/src/spoken-input.ts",
      tests: "tests/spoken-input.test.mjs",
    },
    sourcePaths: [
      "scripts/manuscripts/shared.ts",
      "scripts/manuscripts/io.ts",
      "src/lib/audio-text.ts",
      "scripts/audio/verify-manuscript-audio.ts",
    ],
  },
  {
    id: "audio.catalog.contract",
    capability: "A clip catalog naming voices and per-section recordings",
    home: "engine",
    status: "upgraded",
    why: "The published catalog had a TypeScript type and no schema, so a malformed one failed at a reader. It now has a contract, and the deployed 551 clip catalog validates against it unchanged apart from one section identifier that exceeds the engine's bound.",
    evidence: { schema: "audio-catalog.schema.json" },
  },
  {
    id: "audio.catalog.delivery",
    capability: "The catalog reaching a client as one fetchable file",
    home: "engine",
    status: "preserved",
    why: "Fetched once and lazily, exactly as before. The engine materializes it under the renderer's declared public path instead of a copy step.",
    evidence: { export: "buildAudioEnvelope" },
  },
  {
    id: "audio.catalog.cross_check",
    capability: "Catalog entries agreeing with the publication",
    home: "engine",
    status: "added",
    why: "Nothing checked this before. A clip for a renamed or removed section was silently ignored at read time; it is now a build diagnostic naming the section.",
    evidence: { export: "resolvePublicationAudio" },
  },
  {
    id: "audio.catalog.staleness",
    capability: "Noticing that the published catalog no longer matches the build",
    home: "engine",
    status: "added",
    why: "The catalog was copied into the public directory with no binding to a build, so a stale one was indistinguishable from a current one. It now carries the reader artifact's build identity and its own source digest, and build --check fails on either going stale.",
    evidence: { schema: "audio-envelope.schema.json" },
  },
  {
    id: "audio.pipeline.provenance",
    capability: "Knowing which tool produced a narration run",
    home: "engine",
    status: "added",
    why: "The adapter was required by the schema and read by nothing. It is now recorded in the audio envelope with its configuration, so a run can be reproduced without guessing.",
    evidence: { schema: "audio-envelope.schema.json" },
  },
  {
    id: "audio.timings.sidecar",
    capability: "Per-word timings fetched only when a clip plays",
    home: "renderer",
    status: "upgraded",
    engineProvides:
      "the presence and byte size of each sidecar, with its URL derived from the clip href rather than carried",
    why: "Playback starts from the trusted gesture before one bounded sidecar request. The browser parser requires exact declared bytes, clip and voice identity, spoken-text length, monotonic ranges, summary counts, alignment quality, and bounded interpolation before the renderer can consume it.",
    evidence: {
      decision: "docs/architecture/0040-lazy-narration-timings.md",
      core: "packages/reader/src/narration.ts",
      renderer: "packages/next/src/client/reader-narration.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
  },
  {
    id: "audio.timings.alignment",
    capability: "Aligning recognizer output to source words",
    home: "author",
    status: "preserved",
    why: "A generation concern, not a publishing one. The engine never sees a recognizer.",
  },
  {
    id: "audio.anchors.words",
    capability: "Deriving word anchors from rendered text",
    home: "renderer",
    status: "upgraded",
    engineProvides: "the rendered section text the anchors are computed over",
    why: "The server renderer marks words in the existing manuscript text occurrence, publishes only bounded section counts, and requires the accepted timing word sequence to match the rendered body anchors before applying a transient visual class.",
    evidence: {
      decision: "docs/architecture/0040-lazy-narration-timings.md",
      markup: "packages/next/src/components/focus-markup.ts",
      renderer: "packages/next/src/client/reader-narration.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
  },
  {
    id: "audio.playback.engine",
    capability: "Play, pause, seek, rate, and queue across sections",
    home: "renderer",
    status: "upgraded",
    engineProvides: "the resolved clip list per voice, in reader order",
    why: "The official renderer now supplies a lazy build-bound player with play, pause, seek, rate, ordered previous and next controls, automatic queue continuation, and failure isolation that leaves reading available.",
    evidence: {
      decision: "docs/architecture/0039-lazy-default-narration-player.md",
      renderer: "packages/next/src/client/reader-narration.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
  },
  {
    id: "audio.voices.selection",
    capability: "Choosing a voice and remembering the choice",
    home: "renderer",
    status: "upgraded",
    engineProvides: "voices in declared order, each with a label, provider, and model",
    why: "The renderer preserves declared voice order, remembers one publication-scoped voice and bounded speed preference, and retains the current section when the selected voice covers it.",
    evidence: {
      core: "packages/reader/src/narration.ts",
      renderer: "packages/next/src/client/reader-narration.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
  },
  {
    id: "audio.offline.cache",
    capability: "Caching clips for offline listening",
    home: "renderer",
    status: "upgraded",
    engineProvides: "stable clip URLs and byte sizes, so a cache can budget before fetching",
    why: "Every matching voice clip and timing sidecar joins the same atomic work package as documents and Reader data. Offline playback reads the verified cache directly and uses revoked blob URLs for same-origin and external media without weakening package activation.",
    evidence: {
      decision: "docs/architecture/0046-atomic-offline-publication-packages.md",
      renderer: "packages/next/src/client/reader-narration.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
  },
  {
    id: "audio.statistics.duration",
    capability: "Total and per-section recorded duration",
    home: "renderer",
    status: "upgraded",
    engineProvides: "durationSeconds per clip, plus narrated and unnarrated section counts per voice",
    why: "The default player presents exact current-clip time, summed declared recorded duration, timed-clip coverage, queue position, and the selected voice's unnarrated section count without inventing estimates for missing duration.",
    evidence: {
      renderer: "packages/next/src/client/reader-narration.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
  },
  {
    id: "audio.navigation.event",
    capability: "Navigating to a section and starting playback there",
    home: "renderer",
    status: "upgraded",
    why: "A closed publication-bound intent is consumed only when its section and destination exactly match the selected voice and build-bound progress catalog. The persistent player starts or resumes before current-section or cross-route framework navigation, while unhandled requests retain ordinary link fallback.",
    evidence: {
      decision: "docs/architecture/0045-route-preserving-narration-intent.md",
      core: "packages/reader/src/narration.ts",
      event: "packages/next/src/client/reader-narration-navigation.ts",
      persistence: "packages/next/src/client/reader-narration-provider.tsx",
      renderer: "packages/next/src/client/reader-narration.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
  },
  {
    id: "audio.generation.pipeline",
    capability: "Generating narration, resuming a run, publishing clips",
    home: "author",
    status: "preserved",
    why: "Author tooling. The engine ingests what it produces and never runs it, which is why the adapter is recorded rather than executed.",
  },
  {
    id: "audio.checkpoint.evidence",
    capability: "Immutable narration checkpoints with exact object, timing, model, source, and hash evidence",
    home: "engine",
    status: "upgraded",
    why: "The closed checkpoint schema and semantic validator bind the exact Reader build, source revision, catalog, settings, adapter, run, provider, model, narrator, spoken text, remote audio and timing objects, canonical aggregate statistics, and ordered unit fingerprint without contacting storage.",
    evidence: {
      decision: "docs/architecture/0041-immutable-audio-checkpoints.md",
      schema: "audio-checkpoint.schema.json",
      validation: "packages/content/src/audio-checkpoint.ts",
      tests: "tests/audio-checkpoint.test.mjs",
    },
  },
  {
    id: "audio.promotion.selected_unit",
    capability: "Dry-run selective promotion that preserves every unselected publication unit and narrator",
    home: "engine",
    status: "upgraded",
    why: "The pure planner validates one immutable checkpoint, requires the caller's exact base catalog hash and exact selected-unit coverage, preserves every unselected clip and narrator, validates the candidate, and returns both catalog hashes without storage or write authority.",
    evidence: {
      decision: "docs/architecture/0042-exact-base-audio-promotion-planning.md",
      implementation: "packages/content/src/audio-promotion.ts",
      tests: "tests/audio-promotion.test.mjs",
    },
    sourcePaths: [
      "scripts/audio/promote-audio-sections.ts",
      "scripts/audio/promote-audio-volume.ts",
    ],
  },
  {
    id: "audio.publication.guard",
    capability: "Refusal to publish changed spoken content without matching reviewed narration evidence",
    home: "engine",
    status: "upgraded",
    why: "The pure guard binds the publication, Reader build, exact base and candidate catalog hashes, changed audio and spoken-text identities, every public narrator, and the exact checkpoint object URL, format, sizes, and duration. Git comparison and storage stay outside the engine.",
    evidence: {
      decision: "docs/architecture/0043-narration-publication-guard.md",
      implementation: "packages/content/src/audio-publication.ts",
      tests: "tests/audio-publication.test.mjs",
    },
    sourcePaths: ["scripts/audio/verify-manuscript-audio.ts"],
  },
]);

export const SYNC_PARITY = Object.freeze([
  {
    id: "sync.client.coordination",
    capability: "Provider-neutral debounce, reconnect, reconciliation, and edits during an in-flight sync",
    home: "engine",
    status: "upgraded",
    why: "The framework-neutral coordinator owns debounce, offline recovery, bounded retry, schema-ahead refusal, and latest-local reconciliation. The default Reader connects it to the provider-neutral route behind copy-bound consent and keeps storage, time, connectivity, and randomness in the browser adapter.",
    evidence: {
      coordinator: "packages/reader/src/sync.ts",
      renderer: "packages/next/src/client/reader-rail.tsx",
      browserProof: "packages/next/scripts/packaged-host-proof.mjs",
    },
  },
  {
    id: "sync.publication_isolation",
    capability: "Remote Reader data isolated by both publication and user identity",
    home: "provider",
    status: "upgraded",
    why: "Every reference provider row, key, lock, deduplication rule, and retention query is scoped by validated publication identity as well as authenticated reader. Unscoped legacy rows are preserved under a reserved marker rather than guessed into a live publication.",
    evidence: { migration: "0007_publication_scope.sql" },
  },
  {
    id: "sync.progress",
    capability: "Reading position synchronized across devices",
    home: "provider",
    status: "preserved",
    engineProvides: "the progress capability in a closed vocabulary, published to the client",
    evidence: { migration: "0001_reader_sync_core.sql", table: "reader_progress" },
  },
  {
    id: "sync.bookmarks",
    capability: "Bookmarks synchronized across devices without losing edits",
    home: "provider",
    status: "preserved",
    why: "The merge function, its row lock, and the revocation of direct writes are all carried across. Without the revocation the lost-update race is fully reachable, which is the part easiest to drop.",
    evidence: {
      migration: "0005_atomic_bookmark_merge.sql",
      function: "merge_reader_bookmarks",
    },
  },
  {
    id: "sync.bookmarks.tombstones",
    capability: "A deletion travelling between devices instead of being resurrected",
    home: "provider",
    status: "preserved",
    why: "A tombstone is absorbing and is compared before timestamps, so a device with a skewed clock cannot undelete a bookmark.",
    evidence: { migration: "0005_atomic_bookmark_merge.sql" },
  },
  {
    id: "sync.consent",
    capability: "Recording an opt-in grant and its copy version",
    home: "provider",
    status: "preserved",
    engineProvides: "consent pinned to opt-in in the manifest, the engine, and the published artifact",
    why: "Not a capability a reader chooses. It is a precondition, so it is pinned rather than offered.",
    evidence: {
      migration: "0001_reader_sync_core.sql",
      table: "reader_sync_consent",
    },
  },
  {
    id: "sync.engagement",
    capability: "An append-only engagement log with per-reader retention",
    home: "provider",
    status: "preserved",
    why: "Retention, the size bounds, and the absence of an update grant are all carried across. A client that could rewrite entries could rewrite its own retention.",
    evidence: {
      migration: "0002_reader_engagement.sql",
      table: "reader_engagement_events",
    },
  },
  {
    id: "sync.ownership",
    capability: "A reader reaching only their own rows",
    home: "provider",
    status: "preserved",
    why: "Row level security with ownership on both the read and write side, plus explicit privileges with anonymous access revoked, because row level security is not trusted alone.",
    evidence: { migration: "0004_reader_sync_api_grants.sql" },
  },
  {
    id: "sync.bounds",
    capability: "Bounded storage per reader",
    home: "provider",
    status: "preserved",
    why: "A self-registered account reaches these tables with the public anonymous key, so a client cap is not a security boundary. Every reader-controlled blob and text column is bounded in the database.",
    evidence: { migration: "0003_reader_bookmarks.sql" },
  },
  {
    id: "sync.data_deletion",
    capability: "A reader removing every row they own",
    home: "provider",
    status: "upgraded",
    why: "Four separate client deletes became one function. Separate statements can fail part way and leave a reader who asked to be forgotten partly remembered.",
    evidence: {
      migration: "0006_reader_data_deletion.sql",
      function: "delete_reader_sync_data",
    },
  },
  {
    id: "sync.local_fallback",
    capability: "Reading unaffected when a reader declines or a provider is unreachable",
    home: "engine",
    status: "upgraded",
    why: "Previously a property of the client code. It is now pinned in the manifest, re-checked by the engine, and carried into the published artifact, so a client cannot be built against a publication that relaxed it.",
    evidence: { export: "resolvePublicationSync" },
  },
  {
    id: "sync.capability_declaration",
    capability: "A publication declaring what it synchronizes",
    home: "engine",
    status: "upgraded",
    why: "The declaration existed and reached nothing, and its list accepted any identifier. The vocabulary is closed and the declaration is published, so a manifest and an implementation cannot disagree silently.",
    evidence: { schema: "sync-envelope.schema.json" },
  },
  {
    id: "sync.config_containment",
    capability: "Provider configuration staying out of public files",
    home: "engine",
    status: "added",
    why: "Nothing enforced this before because nothing published a sync artifact. The envelope schema has no field for configuration and refuses additional properties, so the mistake is unavailable rather than discouraged.",
    evidence: { schema: "sync-envelope.schema.json" },
  },
  {
    id: "sync.auth.session",
    capability: "Signing in by emailed link or code, and holding a session",
    home: "renderer",
    status: "upgraded",
    why: "The official Reader now records explicit versioned consent before starting sign-in, supports email links and bounded code entry through provider-neutral routes, reads the cookie-scoped session, signs out without removing local data, and keeps every public response under renderer control.",
    evidence: { file: "packages/next/src/client/reader-rail.tsx" },
  },
  {
    id: "sync.account_deletion",
    capability: "Deleting the authentication account itself",
    home: "renderer",
    status: "upgraded",
    why: "The renderer rejects cross-origin requests before provider execution, authenticates the current reader before privileged deletion, fixes every public response, and keeps the service-role key server only.",
    evidence: { file: "packages/sync-supabase/server.mjs" },
  },
]);

export const PARITY_LEDGER = Object.freeze([
  ...READER_PARITY,
  ...AUDIO_PARITY,
  ...SYNC_PARITY,
]);

export const PARITY_HOMES = Object.freeze([
  "author",
  "engine",
  "host",
  "provider",
  "renderer",
]);

export const PARITY_STATUSES = Object.freeze([
  "added",
  "blocked",
  "planned",
  "preserved",
  "upgraded",
]);
