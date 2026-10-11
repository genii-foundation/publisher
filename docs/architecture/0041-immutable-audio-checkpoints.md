# ADR 0041: Immutable audio checkpoint evidence

Status: accepted

## Context

The public narration catalog proves what a reader may fetch. It does not prove
which source revision, Reader build, pipeline settings, provider model, narrator,
spoken text, remote objects, or timing objects were reviewed before publication.
An author workflow needs that evidence before it can plan selective promotion or
refuse a manuscript release whose narration is stale.

Coherence records this evidence in per-publication-unit checkpoint files. The
generic engine needs the contract and validation, while each publication keeps
ownership of live storage, credentials, narrator policy, and generated media.

## Decision

Publisher defines `audio-checkpoint.schema.json` as immutable author lifecycle
evidence for one publication, checkpoint, and voice. It binds the exact Reader
build, source revision, catalog and settings hashes, adapter version, pipeline
run, provider, model, narrator, recording and remote-verification times, and a
sorted list of narrated units.

Each unit binds its section and audio version identities, spoken-text hash,
duration, alignment counts and source, format, plus exact remote object keys,
byte sizes, and SHA-256 digests for both audio and timing data. The timing object
name is derived from its audio object name. Aggregate counts, duration, and byte
sizes must match the units. `unitsSha256` binds their canonical ordered array.

The content package validates shape and semantic evidence without contacting an
object store. It rejects noncanonical timestamps, verification before recording,
duplicate or unsorted identities, weak alignment, mismatched object names,
aggregate drift, and unit-fingerprint drift. Successful validation returns a
detached immutable snapshot.

## Consequences

A checkpoint is evidence only. Validation does not upload, download, promote,
delete, or rewrite a remote object. It does not interpret provider credentials or
decide which narrator a publication should use.

Selective promotion, exact-base comparison, and manuscript publication guards
remain separate author workflow capabilities. They can now consume one closed,
vendor-neutral evidence contract instead of reverse engineering publication
specific checkpoint files.
