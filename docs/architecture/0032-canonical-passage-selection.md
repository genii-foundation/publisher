# 0032. Canonical passage selection

Status: accepted

## Context

The framework-neutral bookmark contract stores portable block IDs, block content
hashes, UTF-16 offsets, quote text, context, and a canonical destination. The
official renderer could display, query, export, and delete bookmarks, but a reader
could not create one from rendered manuscript text.

Browser selections use DOM nodes and visible-text offsets. Reader blocks use
canonical plain text. Markdown can introduce nested emphasis, links, and other
elements, so copying a DOM offset directly into the bookmark document would
silently corrupt anchors. A selection can also cross navigation, headings,
sections, or content whose rendered text no longer matches the Reader artifact.

## Decision

The official renderer owns a DOM selection adapter. It accepts exactly one
non-collapsed range wholly inside the current manuscript section. Both endpoints
must resolve to rendered elements carrying declared Reader block IDs. Every
candidate block's complete visible `textContent` must exactly equal its canonical
Reader block text before offsets are translated with a DOM Range.

The adapter trims boundary whitespace, joins adjacent selected Reader blocks with
one newline, caps the quote at the bookmark contract limit, captures bounded
prefix and suffix context, and emits the existing portable passage-range shape.
Selections outside manuscript prose, across sections, in mismatched rendered
text, or without non-whitespace content are refused.

After a pointer, touch, or keyboard selection settles, the renderer positions a
save control beneath it. Document coordinates are clamped against the current
viewport so the complete control remains reachable. Saving atomically adds the
bookmark to the latest reactive document, records a bounded engagement event,
clears the browser selection, and announces the result. No provider or account
is involved.

## Consequences

The default Reader can now create durable local bookmarks from canonical rendered
text. The same bookmark immediately reaches query, export, cross-tab, deletion,
and optional synchronization surfaces through the existing store.

The clean packed-host Chrome proof selects a real nested text node on a mobile
viewport, requires the complete action geometry inside that viewport, saves the
passage, and compares the persisted quote and start block ID with the actual DOM
Range.

Margin markers, note editing at capture time, and virtualized collection rendering
remain separate capabilities.
