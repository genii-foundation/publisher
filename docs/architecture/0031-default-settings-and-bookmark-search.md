# 0031. Default settings and bookmark-aware search

Status: accepted

## Context

The official Reader already rendered publication text search and most preference
controls, but the parity ledger correctly required a complete default interface.
The settings panel omitted the font-family preference. Publication search did not
include a reader's private saved passages or notes, even though both documents
were available in the same reactive client boundary.

Search must not copy private bookmarks into a generated public artifact. Settings
must remain bounded by the publication's declared font policy rather than accept
arbitrary CSS or font names.

## Decision

The settings panel exposes every field in the framework-neutral preference
document: text scale, allowed font family, color scheme, focus strength, motion,
and saved-highlight visibility. Font choices come only from the renderer's closed
publication policy. Every change is sanitized through the shared preference
primitive, applied immediately, and persisted under the publication-scoped key.

The search panel continues to fetch and validate the build-bound public search
artifact only when opened. It separately queries the latest local bookmark
document for selected text, notes, and surrounding context. Saved-passage results
are labeled and rendered before public manuscript results. The combined empty
state appears only when both result sets are empty.

No bookmark or preference is added to the generated search artifact, application
identity, server response, or provider request.

## Consequences

The default settings interface now covers the complete generic preference
contract. Publication search includes private saved passages without weakening
the public artifact boundary or requiring synchronization.

The clean packed-host Chrome proof requires five bounded selects and the highlight
toggle, changes and persists the color scheme, applies it to the document, then
queries a bookmark received reactively from a peer tab through the publication
search surface.

Prepaint preference application and theme-declared font choices beyond the
default serif policy remain separate work. Bookmark presence in progress cards
and other secondary surfaces also remains separate.
