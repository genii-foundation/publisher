# ADR 0006: Canonical public route serialization

- Status: Accepted
- Date: 2026-07-28

## Context

Every public address crosses several boundaries: author manifests, compiler inputs, generated artifacts, browser APIs, framework adapters, and hosts. Those systems do not preserve every human-readable path spelling. Browsers serialize spaces and non-ASCII characters with percent encoding, while percent escapes themselves admit aliases through hex case and encoded ASCII.

The initial prerelease schemas allowed raw Unicode and spaces while rejecting percent-encoded octets. A browser could therefore serialize a schema-valid route differently from the value used for collision checks and build identity. The reader runtime cannot safely compare or own addresses under that contract.

GENII Publisher must support international slugs, preserve exact route identity, and keep established publications online without letting historical URL accidents become permanent ambiguity in the framework-neutral protocol.

## Decision

GENII Publisher stores each public route in one canonical ASCII serialized form.

A concrete route:

- begins with exactly one slash
- contains between 1 and 2,048 serialized ASCII characters
- uses raw RFC 3986 `pchar` characters and slash
- reserves percent exclusively for complete uppercase hexadecimal octets
- represents every non-ASCII character with its UTF-8 percent-encoded octets
- never percent encodes an ASCII character
- decodes as valid UTF-8 in Unicode Normalization Form C
- contains no decoded whitespace, C0 controls, or C1 controls
- contains no empty interior segment or current or parent directory segment
- contains no query, fragment, backslash, or route-template syntax

Route templates contain exactly one declared literal token, either `{workId}` or `{collectionId}`. Their remaining characters obey the same grammar. The compiler validates each generated concrete route again after token substitution, including the 2,048 character limit.

Validators reject noncanonical values. They never repair, decode and re-encode, recase, add a slash, or remove one. `/work` and `/work/` are distinct valid routes.

The exact stored string is authoritative in manifests, compiler inputs, content envelopes, reader projections, browser runtimes, framework adapters, and host configuration. Collision checks and hashes use that string. Repository filesystem paths remain a separate protocol with separate safety rules.

JSON Schema enforces the regular portion of the grammar, including ASCII serialization and valid canonical UTF-8 byte forms. The schema runtime performs the complete decoded Unicode and NFC checks. Consumers that need the complete contract use the exported runtime validator rather than treating a raw JSON Schema match as semantic validation.

An established public path outside this grammar does not enter the content protocol as a redirect source. The publication moves to a reviewed canonical URL and preserves the old address with an explicit host or edge redirect. Migration tooling may inventory and propose those changes, but it does not silently rename public addresses.

## Consequences

- Browser and host serialization cannot create a second spelling for a valid protocol route.
- International routes remain available through stable uppercase UTF-8 percent encoding.
- Route changes alter affected content hashes, reader identities, and artifact hashes.
- Migrations must update active routes, internal links, assets, and protocol continuity records atomically.
- Legacy paths containing spaces or other forbidden ASCII characters need separately tested boundary redirects.
- Framework adapters must preserve the publication's trailing-slash choice.

## Rejected alternatives

### Store logical Unicode and serialize at each boundary

This would give manifests and browsers different address strings. Every adapter would need normalization logic, and collision checks could disagree.

### Accept equivalent literal and percent-encoded ASCII

This would admit multiple spellings for one browser destination and reopen alias, traversal, and ownership ambiguity.

### Normalize invalid routes during validation

Silent repair would change public identity and build hashes without an explicit migration decision.

### Require one trailing-slash policy

Either policy is safe when it is exact. Forcing one would create needless migrations and break established URLs.
