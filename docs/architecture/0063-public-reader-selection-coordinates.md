# ADR 0063: Public Reader selection coordinates

- Status: Accepted
- Date: 2026-08-30

## Context

ADR 0032 defines canonical passage selection. ADR 0053 gives selection capture
and bookmark markers one shared DOM text coordinate implementation that excludes
renderer interface descendants from manuscript offsets and geometry.

That implementation was private to the official Reader. An established host
using the embedded page boundary can retain its current bookmark owner during a
reversible migration, but it must not reproduce Publisher's DOM walking,
transient interface exclusion, offset translation, or rectangle measurement.
Two coordinate implementations can agree on plain paragraphs and still corrupt
portable offsets when Markdown creates nested elements or Publisher adds an
adjacent control.

## Decision

The browser safe `@genii-foundation/publisher-next/client` entry exports the
existing canonical functions below. Each export is the same function object used
by the official Reader, not a wrapper or a second implementation.

- `readPublisherReaderSelection`
- `publisherReaderTextContent`
- `publisherReaderTextPointForOffset`
- `publisherReaderTextRange`
- `publisherReaderTextVerticalBounds`

The entry also exports `PublisherReaderSelection`,
`PublisherReaderTextPoint`, and `PublisherReaderTextVerticalBounds` as public
types.

`publisherReaderTextContent(root)` concatenates accepted descendant text nodes
in document order. Publisher transient interface descendants are excluded by
the renderer's existing private markup policy. The root must expose an owner
document. A `Document` node or another root without an owner document is a
caller error and throws `TypeError`.

`publisherReaderTextPointForOffset(root, offset)` accepts only a nonnegative
safe integer. It resolves the offset over the same accepted text nodes. An
offset at a text node boundary resolves to the end of the preceding node. An
offset beyond the accepted text, or a root with no accepted descendant text,
returns `null`. The same document ownership precondition applies.

`publisherReaderTextRange(start, end)` requires both points to belong to the
same document. Invalid boundaries, a collapsed result, or a browser exception
returns `null`.

`publisherReaderTextVerticalBounds(range)` measures the accepted text
rectangles and returns the minimum viewport `top` and maximum viewport `bottom`.
Empty rectangles and rectangles with no width or height do not grant geometry.
If no accepted rectangle remains, the function returns `null`.

`readPublisherReaderSelection(selection, workId, section, fallbackPath)` keeps
the complete ADR 0032 contract. It accepts exactly one noncollapsed range wholly
inside the exact rendered section, requires both endpoints to resolve to
declared blocks, admits only block elements whose complete accepted text equals
the corresponding block in the supplied validated `ReaderSection`, and returns
a frozen portable bookmark input plus clamped document coordinates for the save
control. A mismatched endpoint block, cross-section range, empty quote, invalid
offset, or quote over the contract limit returns `null`.

A host must supply the exact validated `ReaderSection` and work identity that
own the rendered page. The export does not authorize reconstruction from DOM
attributes, use with a different Reader build, or trust of arbitrary section
data. The private transient interface attribute, text walker, raw offset helper,
and client rectangle collector remain unexported. Hosts receive one complete
safe seam rather than the pieces needed to redefine the policy.

These functions read browser DOM and geometry only when called. Importing the
client entry remains safe without browser globals. The functions do not read or
write storage, create bookmarks, publish events, synchronize state, navigate,
fetch, or mount interface controls.

This decision extends ADR 0032 and ADR 0053. It does not replace their portable
bookmark, text ownership, or official Reader behavior.

## Evidence

A focused public entry test compares every exported function by object identity
with the canonical internal module and rejects export of the private policy
helpers. It also verifies the emitted public type declarations.

The packed Next consumer inspects the shipped client declaration, rebuilds the
package from its shipped source to byte-identical distribution files, imports
the packed public client entry, and compares every public function with the
packed canonical implementation. The complete packed host declaration probe
also imports all five functions and all three public types through the supported
package subpath.

## Consequences

An embedded transition host can preserve its existing bookmark store and user
interface while adopting Publisher's exact selection and geometry authority.
Future changes to transient interface exclusion or DOM coordinate behavior flow
through one public implementation.

The host still owns when to read a selection, how to display a save control, and
whether to persist the returned bookmark input. Publisher's official Reader
remains the only built-in owner of its storage, engagement events, bookmark
interface, and synchronization behavior.

Changing any exported name, type, boundary rule, null condition, transient text
policy, or coordinate basis is now a public client API change.

## Rejected alternatives

- Export the transient interface attribute and let hosts write their own DOM
  traversal. That exposes a renderer implementation detail and permits policy
  drift.
- Export only the selection adapter. Bookmark marker adoption also needs the
  same content, point, range, and vertical measurement authority.
- Export every private helper. The raw walker, offset, and rectangle pieces make
  it easier to create an incomplete coordinate system than to use the complete
  safe seam.
- Copy the helpers into an author repository. Duplicate code would become a
  second coordinate authority on its first edit.
