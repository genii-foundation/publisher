# 0014. Narration boundary

Status: accepted

## Context

The publication schema has always declared an `audio` block with a required
adapter package and an optional catalog path. A layout rule validated that the
catalog path was well formed and inside a declared source root. Nothing read the
file, nothing resolved the adapter, and nothing reached a reader.

A working publication with narration already exists, so the shape of the problem
could be measured rather than guessed. That measurement contradicted this
project's own earlier audit, which had recorded that per-word timing data would
have to enter the reader artifact and that the artifact had no place for it.

What the measurement showed:

- The catalog is one file a client fetches once, lazily, and often not at all.
  Measured at 278 KB for 551 clips.
- Per-clip word timings live in a sidecar beside each clip, fetched only when a
  reader plays that clip.
- The catalog records each sidecar's byte size and never its URL. Carrying URLs
  per clip measured about 88 KB of added weight.
- Word anchors are computed on the client from rendered text, so no per-word data
  is transmitted at all.
- `audioVersionId` is composed by the pipeline as a section identifier followed by
  its own digest of the section text: sha256 over newline-normalized body text,
  truncated to sixteen characters.

Two further facts about this engine settled the rest. The renderer has no audio
surface: narration is rendered by client code in the author's own host, so there
is nothing for the engine to call. And the content compiler refuses a source that
is not part of the resolved publication graph, which a catalog is not.

## Decision

**Narration is two documents, not one.** A catalog is a source an author's
pipeline publishes, and it keeps the field names published catalogs already use so
that existing ones validate unchanged. An audio envelope is the engine's own
artifact, follows the envelope convention, and is materialized for a client to
fetch.

**The reader artifact carries no narration.** Not clip URLs, not timings, not
sizes. The two-tier arrangement above is adopted rather than replaced, because a
278 KB addition to a payload every page loads would be a regression against a
design that already works.

**`audioVersionId` is opaque.** The engine does not derive it, interpret it, or
compare it against any hash of its own. Whether prose has changed enough to
warrant re-recording is a pipeline policy question, and the pipeline's digest is
not the engine's. An engine that imposed its own derivation would judge every clip
in an existing catalog stale on first run, and the remedy would be regenerating
real narration.

**The engine checks only what needs no derivation.** A clip names a section the
publication contains. A voice does not claim two recordings of one section. A clip
is not listed twice. A voice identifier is not reused. Ceilings hold. Two voices
narrating one section is allowed, since the rule is one recording per voice per
section.

**Coverage is data, not a diagnostic.** A publication part way through generating
narration is a normal state. Refusing to build until every section is narrated
would make the first run impossible, so coverage is counted and reported.

**A catalog is not a content source.** It stays out of the content envelope's
provenance, because nothing in the reader artifact derives from it. Its digest is
recorded in the audio envelope instead, and that digest is the only thing binding
the two.

**The audio envelope carries the reader artifact's build identity verbatim.** Not
a recomputed one. Both artifacts of a build therefore agree on it, and a client
holding two that disagree knows one is stale without diffing them.

**The declared adapter is recorded, never executed.** The schema requires it and
the engine resolves nothing from it. This follows the rule host capabilities and
migration edges already follow: a third-party package is data to be read, not code
to be run in order to decide what a publication is. There is also nothing to run,
because the renderer has no audio surface. The record reaches the envelope so that
reproducing a narration run does not require guessing which tool produced it.

**Narration declared without a catalog is refused.** Since the adapter is not
executed, a catalog is the only route by which clips reach a build, and the
combination previously produced silence with no explanation.

**Renderer support is declared as data and read as optional.** A renderer
predating narration declares no data artifacts and keeps working; absent therefore
means none, never assumed support. Present and malformed is refused, so a renderer
that meant to declare support and got the shape wrong is not read as declaring
none. A renderer claiming support while naming no path is refused too, because
guessing a path would be the engine inventing part of a third-party contract.

**The host contract version does not advance for this.** It advances when the file
set, a file's content, or the meaning of an input changes. The envelope lands under
`public/`, which the reference renderer serves with no configuration, so no
generated file changes and no existing host needs migrating. Bumping it would have
demanded a migration edge for a move with nothing to migrate.

**One artifact writer, not two.** The reader artifact's writer was already generic.
Narration needs the same atomic write, the same staged-file cleanup, and the same
refusal to aim output at a renderer's own contract file, so the writer is shared.
A second copy would be a second place for the staged-orphan defect to return.

**`build --check` fails when either artifact is stale.** Reporting only the reader
artifact would exit zero on a host shipping current prose beside narration of text
that no longer exists, which is worse than a plain failure because nothing looks
wrong.

## Consequences

Playback stays in the host. The player, its word-level interaction, its offline
cache, and its voice selection are client code an author owns, and none of it
moves into the engine merely because narration is now an engine concern.

An author's pipeline keeps deciding when to re-record. The engine will report a
clip for a section that no longer exists, and will not report a clip whose text has
changed, because it cannot know. Publications that want that guarantee should
regenerate the catalog whenever prose changes; the envelope's catalog digest makes
a stale catalog detectable by anything that keeps the previous digest.

A publication cannot yet narrate individual chapters of a work. The engine
produces one section per work, so a catalog covering many sections of one
manuscript will report every one of them as unknown. That is correct behaviour and
it makes narration for a multi-section publication depend on section boundaries
landing first.

Naming an adapter that does not exist builds cleanly. That is intended, and the
fixture in this repository does it deliberately so the property stays tested. A
contributor who later wants the adapter executed is changing this decision, not
completing it.
