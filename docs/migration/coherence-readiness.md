# Coherence migration readiness

This is the current gap audit between GENII Publisher and The Coherence Thesis
Reader. It records migration scope. It does not authorize a Coherence merge,
database change, package publication, or deployment.

## Authorities

The Coherence inventory is pinned to commit
`7e50161cecc0ce6039c36e4738d8c9fc90710e62`, dated 2026-08-18. The audit covers
39 first-parent commits from 2026-07-28 through that ref. It also considers five
direct Reader precursor changes from 2026-07-27 because those changes created the
state, bookmark, audio, and synchronization substrate modified during the audit
window.

The Publisher implementation baseline is the Updates integration candidate at
`74cba43090b287fcb3295e85ebfc0edcb357a024`, stacked on the named Updates route
checkpoint at `ab2b550459d350bf061a9d8e337a91edb1da0e06`.

The audit was read only with respect to Coherence. It did not modify manuscripts,
publishing records, generated output, deployment state, or the current production
application.

## Headline

The first readiness audit made one consequential classification error. It called
progress, bookmarks, search, preferences, focus, offline reading, and playback
host retainable and therefore treated them as already preserved.

A thin host can retain those files during migration. That does not make them
publication-specific. The confirmed product is a complete, opinionated publishing
application with supported overrides. ADR 0015 therefore assigns generic Reader
behavior to Publisher's framework-neutral core and official renderer. Coherence
may temporarily retain its implementations for compatibility or deliberately
select an override, but Publisher cannot claim parity until its default
application supplies the behavior.

The current ledger records 70 capabilities: 37 Reader, 18 narration, and 15
synchronization capabilities.

| Status | Count | Meaning |
| --- | ---: | --- |
| 16 preserved | 16 | The target owner currently implements equivalent behavior. |
| 11 upgraded | 11 | Publisher implements a stronger checked contract. |
| 12 added | 12 | Publisher adds a capability Coherence did not have as a generic contract. |
| 31 planned | 31 | Accepted Publisher scope is not implemented yet. |
| 0 blocked | 0 | No capability is currently blocked by a named repository issue. |

Target ownership is 30 engine capabilities, 29 official renderer capabilities,
9 provider capabilities, and 2 author-tooling capabilities. Publication-specific
state is deliberately excluded from that count rather than mislabeled as generic
host parity.

## What changed in Coherence

### Reader state and progress

Coherence now has a reactive, private, local-first Reader state system. It
sanitizes storage, coordinates atomic updates, notifies other tabs, follows
continuity groups, records opening, scrolling, reading time, returns, manual read,
automatic read, and audio progress, and merges remote state without decreasing
monotonic measurements.

One word-weighted progress percentage now feeds the toolbar, work surfaces,
heatmap, section cards, and recommendations. A completed older revision remains
historical evidence, while changed content appears as updated until the current
revision is read.

Publisher's framework-neutral progress and preference primitives now feed the
first official Reader rail. It records opening, scrolling, and automatic
completion locally and shows the current section percentage. Cross-tab state,
reading-time accumulation, section status surfaces, and recommendations remain
planned.

### Durable passage bookmarks

Bookmarks now cover exact offsets across one or more rendered passages. They can
resolve an exact anchor, follow a renamed anchor by content identity, reanchor by
selected and surrounding text, or report an honest missing or ambiguous state.
They do not silently choose the first plausible location.

The collection is bounded at 1,000 live bookmarks, supports notes, search,
virtualized display, readable export, absorbing deletion tombstones, atomic
remote merge, and accessible single or bulk deletion. Margin markers avoid
mutating or obscuring prose, and bookmark presence reaches progress, section, and
search surfaces.

Publisher now implements the generic range, bookmark, reanchoring, merge,
tombstone, query, and bounded remote-projection primitives. Readable export,
virtualized presentation, margin markers, confirmation controls, and secondary
Reader surfaces remain planned in the official renderer.

### Preferences and focus

Readers can choose a bounded font scale, font, color treatment, motion behavior,
highlight visibility, and four focus strengths. Coherence applies preferences
before paint to avoid a theme flash. Its focus rendering preserves one real text
occurrence, avoids code and strong text, and preserves the text geometry needed
by narration timing and assistive technology.

Publisher now treats pure preference state as framework-neutral. The official
renderer exposes bounded text size, color, motion, highlight, and focus controls,
with distinct focus widths and a reduced-motion contract. Prepaint application
and theme-declared font choices remain planned. Publication fonts, labels,
colors, and defaults remain theme data.

### Search and capability-sliced data

Coherence projects smaller capability-specific Reader artifacts and loads
bookmark, outline, and breadcrumb data only when a reader opens the related
surface. Text search includes bookmark state and has deliberate keyboard and empty
states.

Publisher now projects a Reader-build-bound search artifact with only navigable
section identity, titles, destinations, plain text, and search fields. Its parser
rejects identity drift and fabricated folds. Unicode and diacritic handling plus
original-text snippet offsets improve on Coherence's ASCII fold. The default
Reader rail fetches that artifact only when search opens and supplies loading,
failure, no-result, and bounded result states. Bookmark-augmented results plus
separate outline and breadcrumb artifacts remain planned.

### Complete offline packages

Downloaded works now include route HTML, Reader data, search, outline,
breadcrumbs, static assets, images, narration clips, and timing sidecars. A new
immutable package is staged and verified before activation. The previous complete
package remains active if replacement fails. Offline navigation uses full
documents because framework flight responses are not part of the package.

Publisher has no equivalent package planner, browser adapter, or service worker
yet. This is accepted engine and renderer scope. Cache names, package grouping,
labels, and publication policy remain author configuration.

### Narration

The current Reader preserves play, pause, seek, rate, queue, voice choice,
word-timed highlighting, section navigation, route changes without lost playback,
offline audio, exact recorded duration, and corpus estimates from measured
narrator pace. Recent changes also repaired navigation timing and audiobook
download contrast.

Publisher now validates, resolves, and materializes a generic narration catalog
and its synchronization envelope. It does not yet ship the default player. ADR
0015 supersedes the earlier claim that playback should remain outside the engine
application.

Per-word timing data does not belong in the reader artifact. It remains in lazy
narration sidecars bound to the narration catalog and exact Reader build.

Coherence also added immutable per-unit audio checkpoints, selective promotion,
and a manuscript publication guard. The generic engine should own schemas,
validation, dry-run planning, exact-base comparison, selected-unit promotion, and
evidence matching. Checkpoint values, live manifests, provider verification,
narrator policy, and generated audio remain publication or provider state.

### Synchronization

The current Publisher candidate carries the closed synchronization capability
vocabulary, public envelope, privacy invariants, and reference Supabase schema.
The schema preserves local fallback, explicit opt in, row ownership, bounded
payloads, atomic bookmark merge, absorbing tombstones, and complete reader-data
deletion.

The official host now owns stable email authentication, session, callback, and
account deletion paths. Every route returns the same opaque 404 for an
unsynchronized publication. An author can select a matching provider through
server-only host configuration. The renderer owns input bounds, safe callback
redirects, same-origin state changes, and fixed responses. The default Reader
records versioned opt-in consent, supports email links and code entry, reads the
session, signs out, and confirms account deletion without removing local reading
data. The reference Supabase adapter keeps the service-role key server only.
The provider-neutral server route and reference adapter now transfer remote
progress, bookmarks, engagement, and consent without exposing a provider SDK or
accepting reader or publication identity from the browser. The local-first
browser coordinator, including reconciliation, retry, and in-flight edits,
remains planned.
The reference provider now scopes every stored row, bookmark lock, event
identity, and retention query by both publication and authenticated reader.
Existing unscoped rows are preserved under a reserved legacy marker for explicit
review instead of being guessed into a publication.

### Toolbar, Markdown, and accessibility

The latest Reader standardizes toolbar geometry, keeps menus reachable inside
desktop and mobile viewports, refines empty states, moves bookmark indicators into
the margin, improves progress icons, and fixes audiobook download contrast.
Markdown rendering gained safer hierarchy behavior, heading actions, and
keyboard-focusable labeled table regions.

The official renderer now supplies one viewport-bounded rail, mobile bottom
controls, keyboard focus, reduced motion, and dark and black reading modes. Table
regions, heading actions, bookmark margin markers, and publication-specific
dimensions, icons, copy, palette, and branded motion remain theme or publication
choices.

## Current Publisher strengths

Publisher already has substantial foundation work that the old audit did not:

- strict publication, content, Reader, audio, and synchronization schemas
- canonical and declared source layouts
- trusted source loading and package archive inspection
- deterministic content compilation and Reader projection
- exact Reader lookup, navigation, continuity, address, and relocation runtime
- server-rendered Next pages with no-JavaScript manuscript text
- fixed linked attribution and attributed error surfaces
- renderer-owned host templates
- reader, audio, synchronization, and application artifact materialization
- transactional author initialization, upgrade, rollback, and mutation policy
- a reference Supabase synchronization package
- packed offline consumer and browser proofs

This is no longer the broken source-loader handoff described by the first project
continuity note. The remaining distance is application parity and Coherence
adoption, not recovery of the foundation.

## Recently closed gap

### Updates integration

Publisher now accepts author-owned plain Updates catalogs, validates stable named
views against Reader route authority, binds the result to one Reader build, and
serves paginated ordinary and literary views through the generated Next host.
Coherence still owns Git interpretation, literary path classification, title
corrections, and its durable snapshot. Migration proof must regenerate that
catalog at the exact acceptance ref and compare every entry and page.

Multi-section compilation is no longer blocked. Work manifests can now declare
preorder section structure with durable IDs, hierarchy, routes, continuity, and
exact Markdown block boundaries. The compiler refuses stale selectors instead of
deriving public identity from headings. Coherence adoption still needs a reviewed
manifest generator and byte-for-byte comparison against its current section
census, but the generic engine contract now exists.

The protocol ceilings remain sufficient for that adoption: 4,999 works, 50,000
sections, and 10,000 continuity redirects.

## Planned application gaps

The following are accepted scope, not release blockers waiting for another
product decision:

1. Finish pure progress and preference state, then add the reactive browser store.
2. Add bookmark export and the default bookmark query interface.
3. Project capability-sliced client artifacts and a default search interface.
4. Add default settings, focus, progress, bookmark, and toolbar components.
5. Add the default narration player and timing interaction.
6. Add atomic offline package planning and official service worker integration.
7. Add the default browser synchronization and account controls.
8. Generalize audio checkpoint, promotion, and manuscript publication guards.
9. Implement multi-view Updates and multi-section build support.
10. Adopt Coherence through a reviewed migration plan with dual-read or
    copy-and-verify state compatibility.

## Material that remains Coherence-owned

Publisher must not absorb:

- manuscripts, voice cards, editorial standards, audits, debt, reviews, or tasks
- adjudicated continuity ledgers and exact historical mappings
- live audio manifests and immutable checkpoint records
- publication Updates history
- Fish, MLX, bucket, narrator, and model policy
- credentials, provider project state, or applied database history
- Coherence storage key names, consent copy, fonts, toolbar copy, art, or palette
- the complete localhost editorial workbench
- Volume-specific structural repairs and the nine-volume ontology

Publisher may own generic schemas, validators, algorithms, and interfaces for
these concerns. It does not own the values that make Coherence itself.

## Dependency order

1. Freeze work, section, block, passage, route, and continuity identity.
2. Make multi-section compilation produce those identities.
3. Project capability-sliced client artifacts.
4. Complete local progress, preferences, bookmarks, ranges, and reactive stores.
5. Add official renderer controls without weakening server-rendered reading.
6. Add provider-neutral synchronization and the two stable server routes.
7. Add default narration playback and author publication guards.
8. Build offline dependency closure over the final route, Reader, and audio graph.
9. Prove the Coherence Updates adapter and migration compatibility.
10. Prove the same contracts with an unrelated second publication.

## Coherence acceptance gates

The migration is not accepted until all of these hold:

1. Every current and historical path, redirect, fragment, hierarchy edge, and
   continuity identity resolves to the same destination and status.
2. Manuscripts and durable publishing records remain byte-identical through
   build, preview, validation, upgrade, rollback, and failed transactions.
3. Manuscript text, navigation, tables, links, and attribution remain useful with
   JavaScript disabled.
4. Local reading works without an account or network. Sync remains explicit opt
   in and isolated by publication and user.
5. Legacy local state is copied and verified or dual-read during the rollback
   window. New storage keys include publication identity.
6. Progress reports one word-weighted percentage across every surface and
   preserves historical completion through revisions.
7. Bookmarks pass exact, renamed, reanchored, missing, ambiguous, merge,
   tombstone, thousand-item, export, and accessibility cases.
8. Audio identity follows spoken content. Changed narrated sections have matching
   immutable reviewed audio and timing evidence for every public narrator.
9. From a cold browser, an installed offline package supports reload, navigation,
   search, bookmarks, and timed narration. A failed update preserves the prior
   complete package.
10. Desktop and mobile browser review proves viewport reachability, keyboard and
    screen-reader behavior, geometry stability, prepaint, reduced motion, and
    contrast.
11. Packed consumers and the supported Node matrix prove exact pins,
    deterministic artifacts, protected source, transactional migration, and
    rollback.
12. A second unrelated publication exercises the generic defaults and override
    contracts.
13. The exact Coherence candidate passes its repository validation and local
    preview gate.
14. The author gives fresh separate approval before merge, database mutation,
    package release, or production deployment.

The machine-checked inventory lives in
`tests/coherence-parity-ledger.mjs`. Planned capabilities remain failures of the
release claim even when their temporary Coherence implementation still works.
