# ADR 0042: Exact base selective audio promotion planning

Status: accepted

## Context

An immutable narration checkpoint proves which remote objects were reviewed. It
does not decide how those objects change a public narration catalog. Promotion
must replace only the selected publication units and narrator, preserve every
other catalog entry, and refuse a catalog that changed after planning began.

Coherence has a publication specific selective promotion script. Publisher needs
the generic planning contract without absorbing its volume model, live manifest,
storage client, credentials, or write authority.

## Decision

The content package exposes `planAudioCheckpointPromotion` as a pure dry run. It
validates the current audio catalog and one immutable checkpoint, then requires a
caller supplied SHA-256 digest of the exact base catalog. A mismatch fails before
a candidate is returned.

The selected section identities must exactly equal the checkpoint units. The
catalog must contain exactly one matching narrator and exactly one current clip
for every selected section. Narrator label, provider, and model must match the
checkpoint. A remotely verified checkpoint cannot predate the current catalog.

The planner derives selected clip URLs from one canonical public HTTPS object
base and the checkpoint object keys. It replaces only those clips, preserves
their catalog positions, preserves every unselected clip and every other
narrator, and advances the advisory catalog timestamp to the checkpoint's remote
verification time. It validates the candidate and returns both exact catalog
hashes in one detached immutable plan.

## Consequences

Planning does not read or write a file, contact an object store, inspect
credentials, or mutate either input. The plan is not authority to publish. A
separate author workflow must compare `baseCatalogSha256` with the live catalog
again immediately before an atomic write.

The checkpoint's source catalog hash remains generation evidence. It is not
reinterpreted as the current public audio catalog hash. Publication guards and
the write side of catalog promotion remain separate capabilities.
