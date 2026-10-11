# 0022. Publication-scoped synchronization storage

Status: accepted

## Context

The reference synchronization schema originally keyed progress, bookmarks, and
consent by authenticated user alone. Engagement identifiers and retention were
also user scoped. That works only while one provider project serves one
publication. A second publication would overwrite the same reader's documents,
deduplicate unrelated events, and evict history across publication boundaries.

The old rows contain no publication evidence. A migration cannot infer their
owner without guessing, and silent guessing would be data corruption wearing a
helpful hat.

## Decision

Every synchronized table is keyed or uniquely constrained by both user identity
and the validated Publisher publication ID. Bookmark locking, engagement
deduplication, engagement retention, progress, and consent all use the same
scope.

The forward migration preserves existing rows under
`__legacy_unscoped__`. This marker is outside the valid Publisher publication ID
grammar, and new provider operations reject it. An author may remap preserved
rows only after reviewing which publication owns them. The migration never
assigns a live publication identity on circumstantial evidence.

The old unscoped bookmark merge signature is removed. Its replacement requires a
publication ID, locks only that publication's row, and retains the existing
schema-version and tombstone rules.

Account deletion still removes every row owned by the authenticated user across
all publications. Deleting an authentication account is an account-wide act, not
a publication preference.

## Consequences

A single Supabase project can safely serve several Publisher publications. A
reader's state in one publication cannot replace or evict state in another.

Existing private-package installations require an explicit legacy-row review.
Rows remain stored and inaccessible to current clients until that mapping is
made. This is deliberate. Preserved uncertainty is safer than invented identity.

The provider-neutral transfer contract must always supply publication identity
from the validated synchronization context. It may never accept publication
identity from an untrusted browser payload.
