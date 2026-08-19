# 0038. Lazy Reader progress catalog

Status: accepted

## Context

Publication progress needs identity, continuity, current content hashes, word
counts, titles, routes, and order for every navigable section. The complete
Reader envelope also contains manuscript blocks, Markdown, links, collections,
assets, and unrelated capability state. Shipping that envelope to the browser
for one secondary interface would erase the capability boundary established by
lazy search.

Progress data must also bind to the exact publication and Reader build. A stale
catalog could otherwise report completion against titles, routes, or content
revisions that are no longer current.

## Decision

The framework neutral Reader package owns a versioned progress catalog. The
build projects only navigable section identity, reviewed continuity, content
hash, word count, work context, title, destination, order, publication identity,
and Reader build identity. Manuscript blocks and unrelated Reader state are
excluded.

The browser parser treats the fetched bytes as untrusted. It enforces exact
keys, portable identities, bounded strings and collections, canonical ordering,
valid hashes, unique section ownership, complete continuity groups, and an exact
publication and Reader build match. Invalid data fails closed.

The official Next host contract advances to 0.8.0 and declares the progress
artifact destination and capability. Publisher materializes and checks the
catalog with its other generated artifacts. The Reader fetches it only after the
Progress interface opens.

The default interface derives a word weighted publication summary, ordered
section map, current statuses, updated-first recommendations, recent reading,
and reactive saved-passage indicators from the catalog plus private local state.
Current-section progress remains available when the catalog cannot load.

## Consequences

Progress surfaces no longer need manuscript text or the complete Reader
envelope. Search and progress remain independently cacheable, independently
validated capability slices. A publication with many sections pays the catalog
cost only when a reader asks for publication progress.

Changing the catalog destination is a host contract migration. Changing its
shape requires a new schema version and a parser that can state the supported
identity rather than guessing.
