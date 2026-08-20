# 0036. Focus text ownership

Status: accepted

## Context

Reader focus treatment can improve scanning by emphasizing the beginning of
eligible words. A client rewrite after hydration would create a visible delay,
make server and browser markup disagree, and risk duplicating or replacing the
manuscript text used by selection, bookmarks, narration, and assistive
technology.

The treatment must preserve the exact text and UTF-16 offsets that the Reader
engine addresses. It must also respect existing Markdown meaning, especially
strong emphasis and code.

## Decision

The official Next renderer applies one deterministic HAST transformation at the
Markdown boundary. Each eligible word retains one real text occurrence inside a
neutral word span. Nested emphasis spans cover progressive 15, 25, and 35
percent prefixes by Unicode code point. The selected Reader focus preference
only changes CSS font weight and surrounding layout.

Words containing letters and apostrophes are eligible. Numeric tokens remain
unchanged. Descendants of `strong`, `code`, and `pre` remain unchanged so focus
does not override semantic emphasis or literal content.

The transformation runs during server rendering. It does not use generated
content, pseudo elements, hidden copies, or a client text rewrite. The combined
`textContent` therefore remains byte for byte equivalent to the rendered
Markdown text, and DOM ranges can cross the visual emphasis boundaries.

## Consequences

Focus markup is present before hydration and the preference changes only its
presentation. Selection, portable bookmark offsets, narration text ownership,
and accessible reading retain one canonical text source.

The manuscript DOM contains more spans, so tests that care about prose meaning
must inspect semantic text instead of requiring an absence of internal markup.
The clean packed host Chrome proof verifies persisted focus changes, computed
weight, unchanged word and block text, exclusions, cross span passage selection,
bookmark capture, and bookmark marker resolution.

Preference prepaint and theme declared font choices remain separate planned
capabilities.
