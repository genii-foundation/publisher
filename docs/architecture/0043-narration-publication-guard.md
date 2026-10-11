# ADR 0043: Narration publication evidence guard

Status: accepted

## Context

Changing a heading or manuscript passage can change the words a narrator speaks.
A current audio version identifier in a public catalog is necessary, but it is
not sufficient. The catalog must point to the remotely verified object reviewed
for that exact spoken text, publication, Reader build, and narrator.

Coherence compares manuscript input against a Git base, derives changed spoken
sections, checks every public narrator, and requires matching immutable checkpoint
evidence. Publisher needs the generic evidence decision without absorbing Git
commands, manuscript parsing, repository paths, checkpoint discovery, storage
access, or publication writes.

## Decision

The content package exposes `validateAudioPublicationGuard` as a pure validation
boundary. The caller injects the publication and Reader build identities, exact
base and candidate audio catalogs with their reviewed SHA-256 digests, the exact
changed section, audio version, and spoken-text identities, all candidate
checkpoints, and one canonical public HTTPS object base.

Both catalogs and every supplied checkpoint must pass their complete public
contracts. The guard refuses hash drift, duplicate narrators or changed sections,
unsafe changed-unit records, and removal of a narrator that had published clips
at the base. Every current narrator must have exactly one current clip for every
changed spoken unit.

A supporting checkpoint must match the publication, Reader build, narrator
identity, provider, model, section, audio version, and spoken-text hash. The
catalog clip must exactly match the checkpoint audio object URL, format, audio
bytes, timing bytes, and duration. A successful immutable report names every
changed section, checked narrator, supporting checkpoint, and both catalog
hashes.

## Consequences

Formatting changes that preserve spoken input can remain outside the changed-unit
set. A publication with no changed spoken units needs no checkpoint match. Once
spoken input changes, removing a narrator, deleting its clip, changing only a
catalog token, or pointing at an unreviewed object cannot make the guard pass.

The engine does not decide which Git base to compare, parse manuscripts, discover
checkpoint files, contact storage, or write a catalog. Author tooling must derive
the changed-unit set and inject validated candidate state. Promotion application
remains a separate exact-base mutation workflow.
