# 0030. Contextual Reader breadcrumbs

Status: accepted

## Context

The Reader protocol already carries exact section parent identities, preorder,
depth, and canonical destinations. The official renderer exposed only a flat
work link on section pages and indentation inside its contents panel. A reader
could not see the complete work and section ancestry or identify the active
outline entry.

Breadcrumbs are navigation, not an enhancement that may disappear with client
JavaScript. They must use validated Reader relationships and destinations rather
than reconstructing hierarchy from titles or URL segments.

## Decision

The server renderer follows each section's parent IDs within its owning work,
guards the traversal against repeated identities, and emits a work-first
breadcrumb trail before the section heading. Every ancestor uses the canonical
Reader destination. The current section is plain text with `aria-current`.

The same validated section trail is passed to the hydrated Reader rail. Its
contents panel renders the current section path and marks the matching outline
link with `aria-current`. The client does not infer ancestry from headings,
indentation, or the browser address.

## Consequences

Section context remains visible without JavaScript, while the interactive
contents surface presents the same identity after hydration. Flat works receive
a useful work and current-section trail. Nested works include every declared
ancestor.

Focused renderer tests require the server breadcrumb landmark and active section.
The clean packed-host Chrome proof opens contents on a mobile viewport and
requires the breadcrumb current item to match the active outline item.

A separately projected lazy outline and breadcrumb artifact remains future
capability-slicing work. This checkpoint uses the closed page model already
required to render the current section and contents.
