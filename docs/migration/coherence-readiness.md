# Coherence migration readiness

This is the current gap audit between GENII Publisher and The Coherence Thesis
Reader. It records migration scope. It does not authorize a Coherence merge,
database change, package publication, or deployment.

## Authorities

The original complete Coherence inventory was pinned to commit
`7e50161cecc0ce6039c36e4738d8c9fc90710e62`, dated 2026-08-18. That audit covers
39 first-parent commits from 2026-07-28 through that ref. It also considers five
direct Reader precursor changes from 2026-07-27 because those changes created the
state, bookmark, audio, and synchronization substrate modified during the audit
window. Focused Reader parity evidence was refreshed read only through current
Coherence `origin/main` at `fe2a1c8c8b6e4df21665afbf6609cf6bef782415`,
dated 2026-08-19. The actionable delta came from bookmark anchoring at
`6ed21e5bc48f747989d3cd580d5bcd24daec686f`, mobile Safari playback isolation at
`7cc32c1dd7421678e01f2df213df75c7e0a3656f`, and dedicated audiobook transport
controls at `b001d42e50a95c6a2f6a4d67bd6b0879bed9cf89`.

The Publisher implementation baseline preceding this focused parity refresh is
`0d295eed5b45e4c17558e5896f0372906260cef9` on
`feat/reader-parity-refresh`.

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
| 42 upgraded | 42 | Publisher implements a stronger checked contract. |
| 12 added | 12 | Publisher adds a capability Coherence did not have as a generic contract. |
| 0 planned | 0 | No inventoried generic capability remains merely planned. |
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
completion locally and shows the current section percentage. Progress and full
bookmark documents now share one reactive renderer store with atomic updates,
same-tab notification, native cross-tab convergence, and stable server
snapshots. The renderer now separates one session opening from scroll samples,
conservatively accumulates visible active reading time, derives returns, shows
the current section status and metrics, and supports explicit completion of the
current revision. The framework neutral Reader now derives the shared weighted
summary, ordered section states, updated-first recommendations, recent reads,
and continuity-aware bookmark presence from one immutable model. The default
Progress interface loads a small identity-bound catalog only when opened, then
renders the publication summary, section map, recommendations, recent reading,
and reactive saved-passage indicators inside the supported mobile viewport.

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
tombstone, query, readable plain-text export, and bounded remote-projection
primitives. The default Reader now searches selected text, notes, and context,
renders an honest empty result, and downloads the complete live collection
without network access. Single and bulk removal now require labeled modal
confirmation, deliberate focus movement, and absorbing synchronization
tombstones. Canonical passage selection now refuses mismatched DOM text and
cross-section ranges before translating visible UTF-16 offsets into portable
block anchors. Its viewport-contained capture editor stores an optional private
note without invalidating the selected range. Exact and uniquely relocated
ranges now receive reactive margin markers outside the manuscript DOM, including
deterministic first measurement in background tabs. One shared DOM text
coordinate system excludes renderer controls from selection offsets, range
resolution, and measured marker rectangles. Marker positions retain document
scroll instead of being clamped in viewport coordinates. The complete 1,000-item
collection now remains searchable and operable while a contained fixed-row
viewport bounds mounted DOM and layout work. Saved-passage presence now reaches
progress, current-section margin markers, and search from the same reactive
private document.

### Preferences and focus

Readers can choose a bounded font scale, font, color treatment, motion behavior,
highlight visibility, and four focus strengths. Coherence applies preferences
before paint to avoid a theme flash. Its focus rendering preserves one real text
occurrence, avoids code and strong text, and preserves the text geometry needed
by narration timing and assistive technology.

Publisher now treats pure preference state as framework-neutral. The official
renderer exposes bounded text size, color, motion, highlight, and focus controls,
with distinct focus widths and a reduced-motion contract. The complete default
interface now includes the font-family field restricted to the renderer's closed
publication policy. The Markdown renderer now emits deterministic focus segments
during server rendering while preserving one exact text occurrence, semantic
strong and code content, selection ranges, bookmark offsets, and assistive text.
Publisher now applies one fully validated, publication-scoped preference
document before body paint. Invalid or oversized storage leaves the server
defaults untouched. The packed host verifies the actual selected background and
text scale with hydration scripts blocked. Theme API 2.0 now owns the ordered
Reader font choices, labels, CSS families, and default. The server default,
prepaint bootstrap, hydrated settings, and independently packed theme all use
that same validated policy.

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
failure, no-result, and bounded result states. It queries the latest private
bookmark document separately and renders saved-passage matches before public
manuscript results without placing private state in the generated artifact.
Search, publication progress, and narration are separate bounded artifacts
fetched only when their interfaces open. Current-page outline and breadcrumbs
remain small
server-supplied renderer context rather than a second client download. The
default section page renders work and section ancestry without JavaScript from
validated parent identities and canonical destinations. The hydrated contents
panel shows the same current path and marks its active outline entry.

### Complete offline packages

Downloaded works now include route HTML, Reader data, search, outline,
breadcrumbs, static assets, images, narration clips, and timing sidecars. A new
immutable package is staged and verified before activation. The previous complete
package remains active if replacement fails. Offline navigation uses full
documents because framework flight responses are not part of the package.

Publisher now projects one strict immutable package per work. Each package binds
the Reader, renderer, work content, and optional narration catalog, then closes
over canonical and historical documents, shared Reader artifacts, assets, all
matching voice clips, timing sidecars, and discovered Next.js dependencies. The
browser stages and verifies every resource before switching one active metadata
pointer. A failed replacement leaves the previous complete cache active. The
generic worker is installed only after an explicit download, leaves framework
and private traffic alone, and falls back from the network to active packages
and then its runtime cache. Offline links use full document navigation. Public
search is scoped to installed works, local bookmarks remain available, and
cached clips play through temporary revoked blob URLs. The clean packed-host
Chrome proof exercises the complete disconnected path.

### Narration

The current Reader preserves play, pause, seek, rate, queue, voice choice,
word-timed highlighting, section navigation, route changes without lost playback,
offline audio, exact recorded duration, and corpus estimates from measured
narrator pace. Recent changes also repaired navigation timing and audiobook
download contrast.

Publisher validates, resolves, and materializes a generic narration catalog and
its build-bound envelope. The official renderer now fetches that envelope only
when Listen opens. Its persistent default player supplies play, pause, 15-second
back and forward jumps, seek, bounded speed, remembered voice choice, ordered
queue movement, automatic queue continuation, exact declared duration, queue
position, timed-clip coverage, and unnarrated coverage. One user-authorized media
element survives clip and route changes. Playback attempt identity prevents a
stale rejected promise from pausing or reporting failure against a newer clip. A
strict browser parser refuses stale identity, unsafe URLs,
duplicate section coverage, malformed statistics, and oversized input. The
packed-host Chrome proof exercises a real recording and persists the chosen
voice and speed. When a clip declares timings, playback starts first and then
requests the derived sidecar with a short bound. The strict parser binds exact
bytes, section, audio version, voice, spoken-text length, monotonic word ranges,
alignment quality, and interpolation limits. Existing server-rendered words are
the only highlight anchors, so the manuscript retains one accessible text
occurrence. The Chrome proof requires one post-play timing request, an active
word, and unchanged manuscript text. A closed publication-bound navigation
intent now starts or resumes one exact narrated section only after its canonical
destination matches the build-bound progress catalog. The persistent player
is owned by the root layout, so routed rails keep playback and the open Listen
panel through current-section and cross-route Next.js navigation. Invalid or
unready requests retain ordinary link behavior.
The Chrome proof covers destination mismatch refusal and both navigation cases.
ADR 0015 supersedes the earlier claim that playback should remain outside the
engine application. ADR 0045 records the routed playback boundary.

Per-word timing data does not belong in the reader artifact. It remains in lazy
narration sidecars bound to the narration catalog and exact Reader build.

Coherence also added immutable per-unit audio checkpoints, selective promotion,
and a manuscript publication guard. The generic engine should own schemas,
validation, dry-run planning, exact-base comparison, selected-unit promotion, and
evidence matching. Checkpoint values, live manifests, provider verification,
narrator policy, and generated audio remain publication or provider state.

Publisher now owns the checkpoint schema and semantic evidence validator. One
checkpoint binds the exact Reader build, source revision, catalog, settings,
adapter, pipeline run, provider, model, narrator, spoken-text hashes, remote audio
and timing objects, aggregate statistics, and canonical ordered-unit fingerprint.
Validation is detached and immutable. It never contacts storage or performs
promotion. ADR 0041 records the boundary.

Publisher now also owns exact-base selective promotion planning. One pure dry run
requires exact checkpoint coverage, narrator identity, one current clip per
selected section, a canonical public HTTPS object base, and the caller's exact
base catalog hash. It replaces only the selected clips, preserves every other
clip and narrator, validates the candidate, and returns both catalog hashes. It
does not contact storage or write the live catalog. ADR 0042 records the boundary.

The pure narration publication guard now takes exact base and candidate catalog
hashes, changed section, audio version, and spoken-text identities, validated
checkpoints, the current publication and Reader build, and one canonical public
object base. It checks every current narrator, refuses narrator removal, and
requires the published URL, format, audio bytes, timing bytes, and duration to
match immutable evidence exactly. Git comparison and checkpoint discovery remain
author workflow responsibilities. ADR 0043 records the boundary.

The engine now derives a separate full spoken-text identity from the trimmed
title and normalized presentation-free body. It returns the exact canonical text
used by generation, timing, and the renderer profile, while legacy
`audioVersionId` values remain opaque. Presentation parsing remains adapter owned.
ADR 0044 records the boundary.

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
browser coordinator now connects the default Reader to the provider-neutral
route. It debounces local revisions, pauses offline, retries with a bound,
reconciles the latest local state after each request, refuses schema-ahead
capabilities independently, and acknowledges engagement events by exact
identity. The packed-host Chrome proof completes code sign-in and verifies
progress, bookmarks, consent, and engagement acknowledgement through the real
Reader interface.
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
controls, keyboard focus, reduced motion, dark and black reading modes, exact
adjacent heading copy actions, and labeled horizontally scrollable table regions.
The server retains the heading and cell text. Hydrated code owns only clipboard
interaction, while the table wrapper owns only access and scrolling. Bookmark
margin markers and publication-specific dimensions, icons, copy, palette, and
branded motion remain theme or publication choices.

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

### Atomic offline packages

The framework-neutral Reader now emits a bounded per-work package catalog that
is complete with or without narration. The official renderer supplies visible
download and update state, dynamic dependency discovery, staged verification,
atomic activation, retained failure recovery, and a generic network-first
service worker. The browser proof installs a work, cuts transport, performs a
cold document load, restricts search to that work, retains bookmarks, plays
cached audio, applies cached timings, and follows a link through a fresh offline
document. ADR 0046 records the boundary.

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

### Exact local preview candidate identity

Publisher now captures a versioned, inspectable inventory for every present
tracked or untracked, nonignored candidate path. Exact file bytes and raw
symbolic-link targets are bound to the canonical worktree, branch or detached
state, full commit, and dirty state. Capture rejects unresolved indexes,
submodules, path ambiguity, special files, unstable descriptor reads, and Git or
directory changes observed during capture. Saved evidence is authenticated again
before verification. ADR 0048 records the engine and host-preview boundary.

### Cross-publication theme portability

The canonical packed-host proof now creates, packs, installs, and selects an
independent publication theme package through author-owned host configuration.
That theme controls both ordinary Reader pages and every framework error
surface. The host consumes a small Reader-build-bound public identity artifact
for client error attribution, and the proof rejects manuscript text in those
browser chunks. Author initialization also preserves the exact existing package
manifest while adding managed host files. ADR 0049 records this boundary.

This closes the theme and public-identity portion of the unrelated-publication
gate. A full second-publication release rehearsal must still exercise the other
override contracts before Coherence migration acceptance.

## Remaining migration gap

The following are accepted scope, not release blockers waiting for another
product decision:

1. Adopt Coherence through a reviewed migration plan with dual-read or
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
6. Add cross-tab synchronization notifications over the stable server routes.
7. Add exact-base narration promotion application.
8. Build offline dependency closure over the final route, Reader, and audio graph.
9. Prove the Coherence Updates adapter and migration compatibility.
10. Prove the same contracts with an unrelated second publication.

The foundation portability evidence now includes two neutral publication shapes,
an independently packed theme, and an independently packed extension. The clean
host performs a frozen offline reinstall, renders both extension slots, hydrates
an isolated extension client, contains its deliberate failure, and proves that
server and client projection data are absent from static browser chunks. This
closes the generic override proof. It does not replace the separate exact
Coherence candidate and preview acceptance gates below.

The release rehearsal now binds that portability evidence to the exact five
publishable package candidates. A clean canonical Field Notes repository installs
those tarballs, repeats the install offline from its lockfile, runs the shipped
author lifecycle, builds the official production host, and serves home, work, and
Updates routes with separately packed theme and extension overrides. Source bytes
and candidate digests are checked before and after. Provenance acceptance remains
an independent human gate, so this proof cannot silently turn rehearsal into
release authorization.

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
`tests/coherence-parity-ledger.mjs`. Any future planned capability remains a
failure of the release claim even when a temporary Coherence implementation works.
