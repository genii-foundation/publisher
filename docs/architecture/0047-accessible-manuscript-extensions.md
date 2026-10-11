# ADR 0047: Accessible manuscript extensions

Status: accepted

## Context

The official renderer already owns safe Markdown presentation and preserves the
exact Reader block as the manuscript authority. Two generic Coherence Reader
behaviors remained outside Publisher: copy actions beside addressable headings
and horizontally scrollable tables exposed as named keyboard regions.

A renderer can add either feature by replacing manuscript elements. That gives
an interaction component authority over source text, heading levels, table
cells, links, focus markup, and narration anchors. It also makes useful content
depend on hydration. Both outcomes violate the Reader boundary.

## Decision

Publisher keeps every heading and table cell server rendered from the exact
block Markdown. Extension components may add adjacent controls or accessibility
containers. They may not replace, edit, reorder, or duplicate manuscript text.

Every addressable heading receives one adjacent client copy action. The server
renders the heading first with its owned level, text, block identity, and DOM
anchor. The action receives only the validated heading title and canonical
Reader address. It is hidden until hydration, exposes a specific accessible
name, copies one absolute URL, and announces success or failure through one
polite status. Reading and heading navigation remain complete without
JavaScript.

The renderer recognizes bounded pipe syntax only when the validated Reader block
kind is `table`. It requires a header delimiter, one through 128 columns, and no
more than 4,096 body rows. Malformed or unequal rows remain ordinary Markdown
text. A recognized table receives a stable caption, column header scope,
declared alignment, and a keyboard focusable horizontal region. Cell content
still passes through the existing safe inline Markdown, focus, narration, link,
image, and HTML refusal rules. The author adapter remains responsible for the
plain block text used by search and narration.

The table wrapper owns scrolling and accessibility only. The Reader block owns
all visible cell text. The heading action owns clipboard interaction only. No
new protocol field, route, application identity input, author configuration, or
third party dependency is introduced.

## Consequences

Long tables remain readable inside narrow viewports without widening the page.
Keyboard and assistive technology users receive a named region and real column
headers. Linkable headings gain a consistent action while remaining ordinary
headings in server HTML.

The deliberately small pipe table grammar matches the current migration need.
Escaped pipe cells, multiline cells, row headers, captions supplied by authors,
and richer table syntax require a future reviewed content contract. The
renderer does not guess those semantics.

Themes may restyle the wrapper and adjacent action. They still cannot replace
manuscript text or remove required focus visibility.

## Rejected alternatives

### Let a client component render the complete heading or table

This makes text depend on hydration and gives interaction code manuscript
ownership.

### Install a broad Markdown table extension in the renderer only

That would add a dependency and accept syntax the content compiler does not yet
identify as a distinct semantic block. The bounded renderer seam requires an
adapter-classified table and is explicit about what it recognizes.

### Add copy links inside heading text

The control would become part of the heading accessible name and manuscript
selection. An adjacent action preserves both.
