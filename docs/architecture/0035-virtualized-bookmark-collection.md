# 0035. Virtualized bookmark collection

Status: accepted

## Context

The bookmark contract deliberately supports 1,000 live saved passages. Rendering
all of them into the Reader panel would make the advertised bound a browser DOM,
layout, and accessibility liability. Search, export, synchronization, and bulk
deletion still need the complete canonical document, so reducing the storage
limit or silently truncating the panel would be dishonest.

The official renderer should not require a mutable third-party measurement cache
for a fixed, bounded collection whose rows can use an opinionated presentation.

## Decision

The bookmark panel filters and sorts the complete live document through the
framework-neutral query contract, then passes the result to a fixed-row virtual
list. Each row owns 160 pixels, clamps its quote to three lines and its note to
two, and retains the passage link and confirmed-removal action. The scroll window
mounts only the rows intersecting the viewport plus four overscan rows in each
direction.

The list exposes its complete logical size through its scroll height and each
mounted item exposes `aria-posinset` and `aria-setsize`. A visible locale-formatted
summary states the filtered count. Query changes return the scroll window to its
start, while collection shrinkage clamps an obsolete scroll position to the new
end.

The virtual list has its own bounded, keyboard-focusable scroll surface. The
mobile renderer reduces that surface further so the search, export, bulk removal,
summary, and list all remain inside the Reader panel.

## Consequences

Collection search still considers all 1,000 saved passages, and export, merge,
and bulk removal still operate on the complete canonical document. Browser DOM
and layout work scale with the visible window instead of the stored collection.

The clean packed-host Chrome proof writes 1,000 valid bookmarks from a peer tab,
clears the prior marker query, and requires a contained mobile scroll surface,
fewer than 100 mounted rows, the exact logical height, absolute row positioning,
and accessible identity for the final bookmark after scrolling to the end.
