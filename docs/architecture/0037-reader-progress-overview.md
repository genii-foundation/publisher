# 0037. Reader progress overview

Status: accepted

## Context

Publication progress, section states, recommendations, recent reading, and
bookmark indicators must agree. Recomputing each surface separately would let
continuity aliases, revised content, weighting, or deletion tombstones produce
conflicting answers.

The model must remain usable in a browser without taking storage, network,
clock, DOM, or manuscript authority. It must also consume a small section
projection instead of the complete Reader envelope.

## Decision

The framework neutral Reader package owns one pure progress overview
derivation. Its section input contains only identity, continuity, content hash,
word count, title, destination, work context, and order. Existing full Reader
sections remain structurally compatible with the smaller progress contract.

The overview resolves every section through the canonical continuity engine,
computes one word weighted aggregate, and exposes ordered section status. Live
bookmarks match any reviewed continuity alias. Recommendations place updated
sections first, then incomplete sections in publication order, with stable
deduplication and bounded output. Recently read sections require actual read
evidence and sort by the latest read timestamp.

Progress and bookmark documents from different publications are rejected.
Malformed list limits fail to an empty bounded list instead of expanding work.
The returned model and its collections are immutable.

## Consequences

Every future progress surface can consume one deterministic model. A revised
section can remain historically complete in the weighted aggregate while still
appearing first as content worth revisiting. Bookmark signals survive reviewed
continuity renames without scanning manuscript text.

The progress interface, lazy progress artifact, heatmap presentation, and
engagement events remain separate implementation work. This decision does not
upgrade the parity ledger by itself.
