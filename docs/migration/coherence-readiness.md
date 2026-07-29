# Coherence migration readiness

An audit of what The Coherence Thesis actually needs from this engine, measured
against that repository rather than inferred from the objective.

Read-only. Nothing in the Coherence repository was modified to produce this.

Every count of Coherence below was measured against its commit `87ff7cf7`, dated
2026-07-27. Those numbers cannot be checked from this repository, because nothing
here may depend on that one existing, so treat them as a snapshot and remeasure
before relying on them. The claims about this engine are checked by the test suite
and are noted as such where they appear.

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

**8,007 ledger entries, of which 4,518 are routes and 3,489 are aliases.** Broken
down by kind:

| Kind | Count |
| --- | --- |
| `section-alias` | 3,255 |
| `section` | 2,194 |
| `reader` | 1,190 |
| `chapter` | 960 |
| `route-alias` | 234 |
| `part` | 146 |
| `volume` | 28 |

So the addressable surface is 4,518 routes over 3,300 hierarchical units, and the
redirect surface is 3,489. Both are under the engine's 10,000 redirect cap.

**Redirect capacity is not the problem.** The curated alias ledgers hold 232
entries and the generated ledger marks 3,489 routes as aliases. Those are different
populations and I have not established which is authoritative for a migration, but
both are well under the cap of 10,000.

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

### 3. A section can have its own URL, and the build path will not make one

I have now been wrong about this twice, in opposite directions, so here is what
running it establishes.

A section route becomes an active server route, and a section is addressable at its
own path. Verified end to end and pinned in `tests/publication-build.test.mjs`:

```
/                                 -> home
/works/first-light                -> work
/works/first-light/low-water      -> section (low-water)
/collections/mornings             -> collection
```

The condition is `activeRouteNames`. A section may declare `routes`, but a route
only becomes active if its name appears in that section's `activeRouteNames`. My
earlier probe set `routes` and `readerLocation` and never set that field, so the
route was never registered and the reader address had no owner. The refusal said a
reader address must use an active server route, and I read it as "there is no way
to make one active" rather than "you did not make this one active". The diagnostic
was correct and my reading was not.

So the route model needs no change, and the correction I published to issue #17
claiming otherwise was wrong. The original framing was right.

What remains true is narrower and unchanged since the first report. Every block in
a work must come from that work's single resolved manuscript, so sections are
divisions of one file rather than separate files. And the build path produces
exactly one section per work: `derivePublicationWorkInputs` calls the one-section
convenience once per work.

So the work is in the build path, and the one thing still to decide is how a
manuscript declares its section boundaries and their routes. Splitting on headings
couples a URL to prose an author edits. Declaring boundaries in the work manifest is
a schema addition and holds still when a heading is renamed. That is a smaller
question than a route model change, and the engine already supports whichever
answer it gets.

### 4. Audio is a schema definition and nothing else

`publication.schema.json` defines an `audio` block with an adapter package and
config. No implementation exists in the renderer or the reader. Grepping both
packages for audio returns exactly one hit, in the schema.

Coherence has an audio player with word-level interaction, which is two islands
plus supporting library code, and published audio under `publishing/audio`. The
islands are host-retainable. What is not is whatever the artifact must carry to
align audio with words: if per-word timing has to reach the client, it has to be
in the reader artifact, and the artifact has no place for it.

### 5. Sync is a schema definition and nothing else

Same finding. `SyncConfiguration` exists in the schema. A word-boundary search for
sync across the renderer and reader returns nothing. My first search returned
matches and all of them were the word "async", which is worth recording as a
caution about this kind of audit.

Coherence has `src/lib/reader-sync.ts`, Supabase browser and server clients, an
auth callback route, and an account API route. The engine's own interface rule
says local progress is private by default and remote sync must not be added
without explicit product approval, so sync arguably belongs in the host
permanently. If so, the schema field is misleading and should say what it is for.

## Scale, measured

I ran the pipeline at Coherence's size rather than recommending that somebody do
it. Each work is a directory with a manifest and a short manuscript, built through
`buildPublicationReader` on Node 22.12.0.

| Works | Build | Artifact | Active routes | Peak RSS |
| --- | --- | --- | --- | --- |
| 100 | 347 ms | 0.2 MB | 101 | 108 MB |
| 1,000 | 3.1 s | 2.5 MB | 1,001 | 217 MB |
| 3,300 | 9.0 s | 8.1 MB | 3,301 | 387 MB |
| 4,999 | 14.0 s | 12.3 MB | 5,000 | 478 MB |
| 5,000 | refused in 11 ms | none | none | `schema.resource_limit` |

The cap and the refusal code are checked by the suite. The timings are one machine
on one day and are recorded to show the shape of the curve, not as a promise.

Four things this establishes.

**The pipeline handles Coherence's size.** Roughly 2.8 ms per work, linear across
the range, and about 9 seconds at 3,300 units. Nothing degrades nonlinearly.

**The ceiling is enforced properly.** One work past the declared cap of 4,999 is
refused in 11 milliseconds with a named diagnostic, rather than timing out or
exhausting memory. That is the behaviour a limit should have.

**Memory is the constraint worth watching.** Peak resident set reaches 478 MB at
the cap and 707 MB across a two-case run. A continuous integration runner with a
small memory allowance would fail here before anything else did.

**A 12 MB artifact never reaches a browser.** The generated host imports the
artifact with a JSON import assertion, which would be alarming if any of it shipped
to a client. It does not: the renderer's server entry point imports `server-only`,
no client code references the reader, and none of the rendering components are
client components. Verified rather than assumed, because 12 MB to a phone would end
the project.

## What is not blocked

The nine volumes are Markdown manuscripts with per-volume metadata, which is
exactly the shape the loader and compiler already ingest. The content pipeline
handles the volume of work Coherence represents. Its structure is the problem, not
its size.

## Recommended order

1. Decide how a manuscript declares its section boundaries and their routes, then
   teach the build path to emit them. The route model already serves section URLs,
   so this is a build path change and one schema question rather than a protocol
   redesign. Issue #17, corrected twice by this document, most recently back toward
   its original framing.
2. Decide the Updates adapter shape, accounting for pagination and a derived
   view. Issue #16, also corrected by this document.
3. Give redirects an identifier target, or give the engine a way to resolve a
   section identifier to its current route while compiling redirects. 136 of
   Coherence's aliases point at section identifiers and cannot be expressed today.
   Measured, not assumed.
4. Decide whether audio timing data belongs in the reader artifact. That decides
   whether audio is an engine feature or a host one.
5. Decide whether sync is engine scope at all, and if not, remove or annotate the
   schema field so it stops implying an implementation.

Items 3 through 5 are decidable now and none requires a release.

Scale is measured and is not a blocker. Memory at the ceiling is the one operational
number worth carrying into deployment planning.

## What this audit does not establish

It counts, classifies, and measures. It has not run Coherence's own manuscripts
through the engine, because the build path emits one section per work
and Coherence needs 3,300 of them addressed. The protocol serves those addresses
already; nothing has taught the build path to produce them.

Every count here came from the repository as it stands. None of it came from
reading the objective and inferring what must be true.
