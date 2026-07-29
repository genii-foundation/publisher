# Coherence migration readiness

An audit of what The Coherence Thesis actually needs from this engine, measured
against that repository rather than inferred from the objective.

Read-only. Nothing in the Coherence repository was modified to produce this.

## Why this exists

The migration was blocked on two decisions, and "blocked" was doing a lot of work
in that sentence. Nobody had measured the distance. This turns it into a list.

The headline: the distance is much larger than the open issues suggest, and most
of it is not the engine's problem. Sorting which is which is the useful part.

## What Coherence is

Nine volumes. Twelve route patterns, which expand to 8,007 live URLs. Forty-seven
components, twenty-six of them client-interactive islands. Seventy-one library
modules. Supabase-backed progress sync with authentication. Seven continuity
ledgers holding 10,551 entries.

The twelve routes:

```
/                                      /progress
/overview                              /updates
/manuscripts                           /updates/[page]
/manuscripts/[volumeId]                /updates/literary
/manuscripts/[volumeId]/[...route]     /updates/literary/[page]
/auth/callback                         /api/account
```

## What the engine is

The renderer is about 2,700 lines: an application, a pages component, a Markdown
component, an attribution footer, and an error boundary. It renders a publication
from a reader artifact. That is the whole of it.

Counting features against features would give a ratio that reads like an
indictment and would be the wrong conclusion, because most of Coherence's surface
does not need to move into the engine at all.

## The distinction that matters

An engine command only writes the files its renderer's host contract declares.
Anything else in the repository is untouched by init, upgrade, and rollback, and
an upgrade removes only paths the previous contract owned. So a host can keep its
own routes, its own components, and its own client code beside the generated ones.

That splits Coherence's surface in two.

**Host-retainable.** Features that consume the reader artifact and render in the
author's own code. These do not block the migration and should not move into the
engine merely because they exist. Bookmarks (four components), progress display
(five), search, offline support, the overview map, cover flow, tile reveal, page
fade, toolbar islands, engagement, reading heatmap. Roughly twenty of the
twenty-six islands.

**Engine-required.** Anything that determines a public URL, the artifact's
contents, or what the server renders. A host cannot retain these because the
engine owns route resolution and the artifact.

## Engine-required gaps, in order of consequence

### 1. Updates, and it is narrower than issue #16 says

Issue #16 called this unimplemented. That is wrong and the correction matters.
The renderer already has the interface: `ResolvedPublisherNextUpdates`, carrying a
package, version, renderer compatibility, config, and an implementation, and
`createPublicationNextApplication` accepts it and serves the route.

The real gap is that nothing lets an author supply one. The generated host calls
`createPublicationNextApplication({ reader })` and there is no manifest field, no
resolution rule, and no host contract wiring for an Updates adapter. So the
capability exists and is unreachable.

Coherence needs more than one Updates route: `/updates`, `/updates/[page]`,
`/updates/literary`, and `/updates/literary/[page]`. The engine's route model has
a single `updates` route path. Pagination and a second view are not expressible.

Whatever shape the adapter decision takes, it has to account for a paginated
Updates route and a second derived view over the same data.

### 2. Route shape and URL preservation

Coherence serves `/manuscripts/{volumeId}` and `/manuscripts/{volumeId}/{...route}`.
The engine's work route template is configurable, so `/manuscripts/{workId}` is
expressible. The nested per-section path under a work is the question: the engine
gives a work one route and its sections their own declared routes, which may or
may not compose into the same URLs.

This is the one gap where being wrong is unrecoverable, because a changed URL is a
broken link somebody else published. So I measured it rather than recommending
that somebody measure it.

| Ledger | Entries | Shape |
| --- | --- | --- |
| `route-ledger.json` | 8,007 | `{href, kind, targetContinuityIds}` |
| `section-ledger.json` | 1,211 | routes |
| `section-lineage.json` | 551 | sections |
| `version-provenance.json` | 550 | entries |
| `aliases.json` | 136 | `{sourceHref, targetSectionId, note}` |
| `route-aliases.json` | 62 | `{sourceHref, targetHref, note}` |
| `historical-section-mappings.json` | 34 | mappings |

Three findings.

**8,007 live routes.** `route-ledger.json` records the current public surface, not
history. The engine has to generate that many active routes and the reader artifact
has to carry them. Nothing in the audit says it cannot, but no fixture is within
three orders of magnitude of it, so it is untested at that scale.

**The redirect count fits, comfortably.** The genuinely redirect-shaped ledgers are
`route-aliases.json`, `aliases.json`, and `historical-section-mappings.json`,
totalling 232 entries against the engine's `continuity.redirects` cap of 10,000.
Capacity is not the problem.

**Expressiveness is the problem.** `route-aliases.json` maps `sourceHref` to
`targetHref` and translates directly. `aliases.json` maps `sourceHref` to a
`targetSectionId`, and the engine's redirect takes a path, not an identifier. Those
136 entries cannot be expressed without resolving each section id to its current
route at build time, and the engine has no mechanism that does that.

This is the failure mode worth being frightened of. A redirect that resolves to the
wrong path still returns 200, so it does not look like breakage. It looks like the
wrong chapter.

The aliases also show that Coherence has already changed its own URL scheme once
and kept both alive: current routes look like `/manuscripts/1/`, while aliases
reference `/manuscripts/humanitys-most-viable-future/...`. The redirect machinery is
load-bearing in production today, not a precaution.

### 3. Audio is a schema definition and nothing else

`publication.schema.json` defines an `audio` block with an adapter package and
config. No implementation exists in the renderer or the reader. Grepping both
packages for audio returns exactly one hit, in the schema.

Coherence has an audio player with word-level interaction, which is two islands
plus supporting library code, and published audio under `publishing/audio`. The
islands are host-retainable. What is not is whatever the artifact must carry to
align audio with words: if per-word timing has to reach the client, it has to be
in the reader artifact, and the artifact has no place for it.

### 4. Sync is a schema definition and nothing else

Same finding. `SyncConfiguration` exists in the schema. A word-boundary search for
sync across the renderer and reader returns nothing. My first search returned
matches and all of them were the word "async", which is worth recording as a
caution about this kind of audit.

Coherence has `src/lib/reader-sync.ts`, Supabase browser and server clients, an
auth callback route, and an account API route. The engine's own interface rule
says local progress is private by default and remote sync must not be added
without explicit product approval, so sync arguably belongs in the host
permanently. If so, the schema field is misleading and should say what it is for.

## What is not blocked

The nine volumes are Markdown manuscripts with per-volume metadata, which is
exactly the shape the loader and compiler already ingest. Nothing in the audit
suggests the content pipeline is the problem.

## Recommended order

1. Decide the Updates adapter shape, accounting for pagination and a derived
   view. Issue #16, corrected by this document.
2. Give redirects an identifier target, or give the engine a way to resolve a
   section identifier to its current route while compiling redirects. 136 of
   Coherence's aliases point at section identifiers and cannot be expressed today.
   Measured, not assumed.
3. Decide whether audio timing data belongs in the reader artifact. That decides
   whether audio is an engine feature or a host one.
4. Decide whether sync is engine scope at all, and if not, remove or annotate the
   schema field so it stops implying an implementation.

Items 2 through 4 are decidable now and none requires a release.

Also worth doing before the migration: build a publication at Coherence's scale.
The largest fixture has two works, and Coherence has 8,007 routes. Every
performance and limit characteristic of the loader, compiler, projector, and
artifact is unmeasured in that region.

## What this audit does not establish

It counts and classifies. It has not run Coherence against the engine, because the
engine cannot yet serve an Updates route and Coherence has four of them, so the
first honest end-to-end attempt is blocked behind item 1.

Every count here came from the repository as it stands. None of it came from
reading the objective and inferring what must be true.
