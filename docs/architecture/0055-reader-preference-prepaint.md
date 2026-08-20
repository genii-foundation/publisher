# 0055. Reader preference prepaint

Status: accepted

Supersedes the prepaint portions of ADR 0031 and ADR 0036.

## Context

The default Reader persisted appearance preferences safely, but it loaded and
applied them from a React effect. A returning reader could therefore see the
server defaults before hydration changed the color scheme, text scale, motion,
focus, and saved passage treatment.

The renderer also placed theme color variables directly on its root element.
The existing light, dark, and black selectors could record a selected scheme
without overriding those inline defaults. Attribute checks alone did not prove
that the selected colors actually painted.

## Decision

The official root layout renders one small bootstrap script in the document
head before the body. Its storage key is derived from the validated publication
identity. The script reads only that key, enforces the Reader preference byte
ceiling, requires the complete seven field schema, checks every value against
the closed renderer policy, and changes the root element only after the whole
document is valid. Storage, parsing, encoding, or DOM failure has no visible
effect.

The bootstrap sets only the established Reader data attributes and font scale
variable. It does not fetch, inspect cookies, open provider state, infer a
publication, or copy manuscript data. The hydrated Reader parses the same
stored document through the framework neutral preference contract and remains
the owner of later changes.

The light, dark, and black scheme rules deliberately override the inline theme
defaults. This gives the reader's selected scheme precedence over the initial
theme palette. Theme declared Reader font choices and theme specific scheme
palettes require a separate versioned contract.

## Consequences

Returning readers receive their accepted appearance before manuscript paint,
including when renderer hydration scripts are unavailable. Invalid, oversized,
or policy incompatible preference data leaves the server defaults untouched.

The root element permits the intentional attribute difference during hydration.
The clean packed host proof blocks external JavaScript, supplies a valid saved
preference document, and verifies the actual black background plus every root
preference value before any hydrated Reader code can run.
