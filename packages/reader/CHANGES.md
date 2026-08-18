# Changes

This file records changes to GENII Publisher covered code as required by CPAL 1.0 Section 3.3. GENII Publisher reader is derived directly from GENII Publisher Original Code provided by GENII Foundation. Contributors must append a dated summary. Do not rewrite prior entries.

## 2026-08-18, GENII Foundation

- Preserved stable Updates view identities and pagination authority through Reader projection and runtime validation.

## 2026-08-13, GENII Foundation

- Added browser-safe preference and progress subpaths for the default Reader application.
- Added publication-scoped, immutable preferences with bounded typography, appearance, motion, highlighting, and focus controls.
- Added continuity-aware local progress with revision detection, deterministic monotonic merges, hostile-input sanitization, resource bounds, and word-weighted aggregate percentage.
- Added exact passage ranges with unique content-hash relocation and explicit ambiguity for moved blocks.
- Added publication-scoped bookmarks with bounded notes and context, quote reanchoring, deterministic search and serialization, absorbing tombstones, and local and remote byte budgets.
- Added a Reader-build-bound search artifact with Unicode-aware matching and original-text snippet offsets.
- Kept time, storage, DOM, network, environment, and randomness authority outside the framework-neutral state core.

## 2026-07-28, GENII Foundation

- Established the framework-neutral reader projection and runtime package boundary.
- Added exact dependencies on the GENII Publisher content and schema packages.
- Added self-contained build, release-tag, source, and legal packaging infrastructure.
- Proved the packed root and browser entry points, both declaration surfaces, and a byte-identical rebuild from the shipped source.
- Defined explicit public and preview audience filtering without automatic catalog exposure.
- Added deterministic reader projection, canonical serialization, artifact hashing, and Node-side build identity verification.
- Added a browser-safe immutable runtime for exact address lookup, scoped navigation, and non-unique block relocation candidates.
- Defined exact block-local Markdown ranges and explicit section and block DOM identities.
- Derived work, section, and block content hashes only from public reader semantics and verified them at the Node integrity boundary.
- Detached reader inputs before validation, serialization, artifact hashing, and artifact return.
- Bound unanchored section addresses to their own work or section route and removed object-order selection among browser-equivalent aliases.
- Rejected malformed Unicode fragments, browser-repaired URL spellings, unusable absolute HTTP hosts, embedded URL credentials, and invalid block-local UTF-16 ranges at the runtime boundary.
- Bounded exact SemVer and continuity validation and replaced repeated navigation scans with a linear first-position index.
- Made public runtime object arguments fail closed when property descriptors, inheritance, symbols, or proxy traps make their meaning ambiguous.
- Snapshotted the explicit projection audience and each public runtime argument record once so stateful accessors or proxies cannot compose one request from conflicting states.
- Proved reader artifacts omit extension capability grants in both neutral fixture publications.
- Added a renderer-neutral CommonMark link application boundary with an exact bundled parser closure that preserves visible prose, respects UTF-16 source ranges, and rejects unsafe Markdown contexts.
- Rejected reader envelopes with more than 100,000 aggregate collection work references before building relational indexes.
- Added schema-owned preflight before detachment and indexing, shared envelope limits, fail-fast structural validation, and deterministic exact-count runtime diagnostic retention.
- Built release candidates without PATH-dependent nested npm calls, required the exact provenance-attested tarball, and rejected direct package-directory publication.
