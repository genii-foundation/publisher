# `@genii-foundation/publisher-reader`

This package projects a validated GENII Publisher content envelope into deterministic reader data, constructs framework-neutral lookup behavior over that projection, and supplies local-first state primitives for a complete default reader.

The package is prerelease software. Its API may change before 1.0 through explicit versioned migrations.

## Boundary

The serialized reader envelope contains renderable publication structure, Markdown blocks, public addresses, link locations, assets, routes, statistics, and the complete fixed Publisher attribution. It omits repository paths, source provenance, extension declarations, capability grants, configuration, payloads, provider state, credentials, progress, bookmarks, preferences, analytics, audio state, and sync state.

Projection and full validation are build-time Node.js operations. Browser code should import the `runtime`, `preferences`, `progress`, `passage-range`, `bookmarks`, `sync`, or `search` subpath. These subpaths contain no filesystem, network, environment, process, DOM, storage, clock, or randomness access.

The runtime never chooses a primary collection, rewrites routes, trims trailing slashes, or infers a canonical reader address from object order. Callers supply collection context explicitly when a work belongs to more than one collection.

Projection reads one explicit own `audience` data property before filtering. Accessors, hidden or inherited values, symbols, and inconsistent proxy traps fail closed rather than changing audience while projection is in progress.

## Audience projection

Projection requires an explicit `public` or `preview` audience.

| Publication state | Public artifact | Direct route | Default catalog |
| --- | --- | --- | --- |
| `published` | Included | Included | Included |
| `unlisted` | Included | Included | Excluded |
| `archived` | Included | Included | Excluded |
| `draft` | Excluded | Excluded | Excluded |

Preview artifacts include every state. A collection without a declared state is treated as published. Collection state controls the collection only, while work state controls the work. A retained collection may have an empty `workIds` list after draft works are removed.

Assets with a `workId` follow that work's audience. Assets without a `workId` are publication-public and appear in both audiences. Publication compilers must not use shared assets for preview-only material.

## Addresses and links

Sections and blocks carry explicit structured reader addresses and DOM IDs. The runtime compares canonical paths byte for byte, decodes a fragment exactly once for lookup, preserves plus signs, and never repairs trailing slashes. An unknown fragment on a valid route does not fall back to the route root.

An unanchored section address must use that section's work route or an active section route owned by the same section. Home, Updates, collection, and unrelated work routes cannot acquire section content through an accidental address collision. Browser-equivalent fragment aliases may name one section, but resolution reports the exact requested address rather than whichever alias appeared first in an object.

Fragments must contain well-formed Unicode scalar values. The runtime rejects lone UTF-16 surrogate code units before a browser can replace them with U+FFFD and collapse distinct addresses. Publication URLs, source links, external link targets, and external redirects must use exact ASCII HTTP or HTTPS URI serialization with a usable host and no credentials. Input that depends on browser repair, including whitespace, controls, raw Unicode, malformed percent escapes, or backslashes, is invalid.

Source-backed link ranges use the fixed `genii-reader-block-markdown` profile. Offsets are UTF-16 code units into exact `block.markdown`, scoped to one block, with an exclusive end boundary. They are not offsets into `block.text`.

The projected link registry does not prove that arbitrary Markdown or embedded HTML contains no other URLs. Renderers must sanitize untrusted Markdown. A compiler that requires complete internal-link coverage needs a separate parsing invariant.

### Applying source-backed links

Import `applyReaderLinksToMarkdown` from
`@genii-foundation/publisher-reader/markdown` when a renderer needs Markdown
with source-backed ReaderLinks attached. The helper accepts one validated
`ReaderBlock` and only the `block-markdown` ReaderLinks for that block. It
returns a `ValidationResult<string>` and never mutates either input.

The helper parses the exact block with the bundled, lockfile-pinned CommonMark
parser, checks each UTF-16 range against the syntax tree, inserts links from
the end of the block toward the beginning, then reparses the result. It
accepts a range inside one text node or around one complete emphasis or
strong container. It rejects duplicate and overlapping ranges, partial
formatting, node-crossing ranges, malformed Unicode boundaries, existing
link, code, or image contexts, and every attempted application in a block
containing raw HTML. The final parse must preserve the original prose and
formatting after the introduced link wrappers are removed.

The helper uses each validated `link.href` as the destination. Semantic
ReaderLinks carry navigation meaning without a source span, so callers must
handle them outside this API.

## Integrity boundary

The browser runtime validates JSON shape, relational consistency, address ownership, navigation, link ranges, statistics, and attribution without Node.js or cryptographic authority. The package root adds canonical SHA-256 verification through `validatePublicationReaderEnvelope`.

Before detachment, full shape traversal, or relational indexing, the browser runtime applies the schema-owned envelope resource preflight. It bounds works, collections, assets, links, active routes, redirects, aggregate sections, blocks, collection memberships, section routes and references, continuity groups and references, nesting depth, and total nodes. The collection-membership ceiling is 100,000 references. The preflight captures one frozen detached snapshot, generated structural validation uses fail-fast mode, and runtime relationship diagnostics retain the lexicographically smallest 255 details plus one exact omitted-count record. A failed branching keyword may return the small deterministic set needed to explain its alternatives. Renderers must still bound network response and JSON parsing sizes outside this package because those allocations occur before a JavaScript value reaches the runtime.

Entity content hashes are reader-owned and contain no omitted compiler metadata. A block hash covers its kind, exact Markdown, and exact plain text. A section hash covers its role, title, and ordered block hashes. A work hash covers its title, optional subtitle and summary, language, and ordered section hashes. The Node validator recomputes every entity hash. Block relocation therefore follows visible block content rather than adapter configuration, source provenance, metrics, routes, or identifiers.

The reader build ID covers every projected semantic field and the complete source content identity. A draft-only source change therefore changes a public reader build ID even when its projected public fields do not change. Cryptographically separate public and preview identities would require separate source compilation, not a substituted subset hash.

Validation first detaches an immutable snapshot from the caller. Serialization, byte hashing, and returned artifacts all use that same validated snapshot, so accessors or stateful objects cannot change the emitted artifact after validation.

Runtime method arguments become one detached record before any field is interpreted. Accessors, hidden properties, inherited fields, symbols, and inconsistent proxy traps fail closed instead of becoming omitted optional values or cross-state requests.

## Local reader state

The `preferences` subpath defines the default application controls without choosing a UI or storage provider. Preferences are scoped by a deterministic publication key. Font size uses a bounded 5 percent grid from 85 through 125. Publication themes declare stable font family IDs, with generic `serif` as the default. Color scheme, motion, highlighting, and focus controls are validated, immutable, and serialized in one canonical field order. Malformed or newer stored schemas resolve to defaults.

The `progress` subpath owns local-first reading state. The default behavior remains entirely on the reader's device. A host may persist the returned string in local storage. An optional sync adapter must validate and, when its provider has a smaller payload budget, explicitly project the state it can carry. This package never opens storage or a network connection.

Progress entries use every reviewed continuity progress group from each `ReaderSection`. Aliases within one group fold to a stable owner. A section assembled from several historical groups uses the least complete group's percentage, so a merge cannot manufacture completion from one ancestor. A current interaction covers the complete reviewed lineage. A read records bounded evidence for exact section content hashes, so reading a current revision remains absorbing when an older device later reports a read of the previous revision. Changed content reports `updated` until every reviewed group carries current-revision evidence. Percent, scroll depth, reading time, audio position, latest activity, and counts use absorbing maxima. First activity uses the earliest valid timestamp. Manual read state wins an otherwise equal automatic read tie. Other equal-time choices use lexical order, which makes merging commutative and deterministic.

All mutation, parsing, sanitization, and merge calls that can interpret time require an explicit `now` value in epoch milliseconds. The module never reads the clock. Parsing clamps future timestamps to that value. A local event older than the state's latest accepted update is refused instead of rewinding newer evidence. Parsing also rejects a publication mismatch or newer schema, bounds input bytes and entry counts, and stores entries in a frozen null-prototype record. Aggregate percentage is weighted by each supplied section's current `wordCount`.

The `passage-range` subpath identifies a selection by work, reviewed section continuity identity, block identity, block content hash, and UTF-16 offsets. Resolution accepts a current ordered block list. It preserves a range when its content is exact, relocates a missing block ID only when its content hash has one candidate, and reports duplicate hashes as ambiguous. An existing block ID with a different content hash is revised content and never counts as an exact match.

The `bookmarks` subpath stores caller-identified selections, optional notes, and absorbing deletion tombstones in a publication-scoped versioned document. It bounds every string, input size, output size, live count, and retained tombstone count. Merge is commutative, idempotent, deterministic under equal timestamps, and incapable of reviving an ID once either side has deleted it. A failed range resolution may reanchor by an exact quote plus its bounded context across the section's ordered block text. More than one matching location remains ambiguous.

The bookmark core does not generate IDs, inspect a document, open storage, or contact a sync provider. Hosts supply IDs and time, turn selections into passage ranges, persist the canonical serialization, and decide whether to use the stricter remote byte budget.

The `sync` subpath coordinates local-first transfer without owning a network or storage implementation. Its clock-driven state machine debounces local changes, pauses offline, retries with bounded exponential delay, and schedules edits made during an active request immediately after that request completes. Reconciliation merges the latest local progress and bookmark state with the returned remote documents, so an in-flight edit or deletion tombstone cannot be replaced by an older response. A schema-ahead document freezes only its own capability and never blocks a compatible sibling capability.

## Search artifact

The `search` subpath projects a Reader envelope into a smaller artifact containing only navigable section identity, titles, destinations, plain text, word counts, and the exact Reader build identity. A search surface can load it without downloading Markdown, links, assets, collections, redirects, or unrelated capability state.

Search folding is Unicode aware, case insensitive, punctuation insensitive, and diacritic insensitive. Query terms must all match a title or section body. Title matches rank first, with source order and continuity identity as deterministic ties. Snippet offsets map folded matches back to the original UTF-16 text, so collapsed punctuation and decomposed characters do not move the visible match to the wrong passage.

## Attribution

Every graphical renderer that consumes this package must display:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

The credit must link to `https://publisher.genii.foundation`. The renderer must also expose the reader envelope attribution field `sourceCodeUrl` as a conspicuous source link.

## License and source

This package is licensed under CPAL 1.0. Network deployment triggers the source-sharing duties described in the license.

Canonical source: `https://github.com/genii-foundation/publisher`
