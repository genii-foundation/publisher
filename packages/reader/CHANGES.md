# Changes

This file records changes to GENII Publisher covered code as required by CPAL 1.0 Section 3.3. GENII Publisher reader is derived directly from GENII Publisher Original Code provided by GENII Foundation. Contributors must append a dated summary. Do not rewrite prior entries.

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
