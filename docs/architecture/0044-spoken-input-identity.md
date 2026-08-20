# ADR 0044: Spoken input identity

Status: accepted

## Context

Narration must become stale when words a reader hears change. It should remain
current when an author changes only presentation markup or whitespace that does
not change those words. A provider-specific audio version token cannot prove
either condition because Publisher deliberately treats `audioVersionId` as
opaque for catalog compatibility.

Coherence removes presentation markup before narration, trims the section title,
collapses body whitespace, joins title and body with one blank line, and hashes
that exact spoken text. Publisher's default renderer already constructs the same
closed text profile for playback and timing alignment.

## Decision

The content package exposes `createSpokenInputIdentity` as a pure engine helper.
The caller supplies a stable section identity, title, and presentation-free
spoken body. The helper trims outer title whitespace, collapses every body
whitespace run to one ordinary space, and joins nonempty title and body with two
newline characters.

The result carries the canonical title, body, complete spoken text, its exact
UTF-16 character count, and a full lowercase SHA-256 digest. The function rejects
unknown properties, unsafe records, invalid section identities, empty or
oversized titles, oversized spoken text, and unpaired Unicode surrogates. Its
output is detached and immutable.

Markdown parsing remains adapter owned. The engine accepts presentation-free
text because source formats differ. The author pipeline may use the returned
spoken text for generation and must record the returned digest in immutable
checkpoint evidence. The publication guard can then compare that digest without
reading source files or trusting provider naming conventions.

## Consequences

Whitespace-only body edits and outer title spacing preserve spoken identity.
Title, body, punctuation, or other audible input changes produce a new identity.
The renderer text profile and engine identity are checked against each other in
the test suite so timing, playback, generation, and publication evidence cannot
quietly normalize text differently.

Legacy `audioVersionId` values remain opaque. The section identity and spoken
text digest form a separate evidence pair, so adopting this contract does not
rename published objects or reinterpret an existing catalog.
