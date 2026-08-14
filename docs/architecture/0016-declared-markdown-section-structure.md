# ADR 0016: Declared Markdown section structure

Status: Accepted

Date: 2026-08-13

## Context

The content and Reader protocols already support many sections, nested hierarchy,
independent routes, and continuity identities. The first generic build path did
not. It compiled one Markdown manuscript into one section.

Deriving durable section identity from headings would make routine wording edits
change progress, bookmarks, narration references, and public URLs. Established
publications also need to preserve identities that no longer resemble their
visible headings.

## Decision

A work manifest may declare `sections` in preorder. Each declaration owns:

- a durable section ID and title
- an optional role and parent ID
- an optional canonical route and navigability
- optional continuity identity, legacy IDs, progress groups, and historical IDs
- an exact source boundary selector

A boundary selector is either the document start or the exact kind and text of a
Markdown block, with an optional one-based occurrence. Selectors locate content.
They do not derive section IDs, hierarchy, continuity, or routes.

The first declaration must begin at the document or first block. Each later
boundary must occur strictly after the previous one. Every later navigable
section needs an explicit route. A missing or reordered boundary refuses the
build with a diagnostic naming the manuscript and declaration pointer.

Works without declarations retain the one-section compiler for simple
publications. This keeps the opinionated path small without limiting established
or structurally rich publications.

## Consequences

Authors can edit heading wording only after updating the matching selector, so
structural drift is reviewable. Public identity remains explicit protocol data.
Adapters may generate declarations for adoption, but generated candidates require
human review before they become author source.

The Coherence migration must produce declarations from its current continuity
and route authorities, compare the resulting Reader artifact to its accepted
section census, and commit those declarations in the thin author repository. The
engine will not import Coherence-specific heading rules.
