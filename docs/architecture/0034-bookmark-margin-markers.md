# 0034. Bookmark margin markers

Status: accepted

## Context

Saved passages need a visible return point in the manuscript. Wrapping selected
text, inserting marker elements into rendered prose, or painting a browser
highlight would create competing ownership of the text DOM. Narration, selection,
assistive technology, and author themes all depend on that DOM remaining stable.

Stored bookmark ranges may also refer to an earlier revision. A marker cannot
silently attach to the first plausible text when the engine reports a missing or
ambiguous passage.

## Decision

The official renderer resolves current-section bookmarks through the
framework-neutral bookmark resolver. It renders a marker only for an exact,
uniquely renamed, or uniquely reanchored range. The DOM adapter also requires
each participating rendered block's complete visible text to match its canonical
Reader block before translating UTF-16 offsets back into DOM text points.

Each accepted range becomes a document-positioned portal button beside the
manuscript. Its transparent hit area contains a visible bookmark icon and margin
line, but no marker, wrapper, or browser highlight enters the manuscript subtree.
The existing highlight preference controls the complete surface. Activating a
marker opens the existing bookmark panel, filters it to the selected passage, and
focuses its query field.

The first measurement after a bookmark or preference change is synchronous so a
background tab does not wait for a throttled animation frame. Resize, font, and
layout-shift churn is coalesced through animation frames. Returning a hidden tab
to visibility also forces an immediate measurement.

## Consequences

Saved passages now have stable, accessible manuscript landmarks without changing
or obscuring canonical prose. Missing and ambiguous bookmarks remain available
in collection, search, export, and deletion surfaces, but they receive no false
manuscript marker.

The clean packed-host Chrome proof creates a real bookmark while a peer tab keeps
the Reader page in the background. It requires a mobile-contained transparent
marker, a visible icon and line before the prose, a minimum 44-pixel target, no
marker inside the manuscript subtree, focused navigation into the matching saved
passage, and complete removal when highlights are disabled.

Virtualized large-collection presentation remains a separate capability.
