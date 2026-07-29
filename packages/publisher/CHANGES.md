# Changes

This file records changes to GENII Publisher covered code as required by CPAL 1.0 Section 3.3. The GENII Publisher application package is derived directly from GENII Publisher Original Code provided by GENII Foundation. Contributors must append a dated summary. Do not rewrite prior entries.

## 2026-07-28, GENII Foundation

- Established the browser-safe application package and separate Node.js orchestration entry point.
- Added exact dependencies on the GENII Publisher schema and content packages.
- Added self-contained build, release-tag, source, and legal packaging infrastructure.
- Defined the read-only publication source snapshot boundary without importing framework, provider, editorial, or publication-specific behavior.
- Documented the portable filesystem guarantee and its explicit privileged local-filesystem exclusions.
- Rejected malformed, duplicate-member, and over-limit raw manifests before shape validation.
- Added a loader-issued snapshot brand and official compilation orchestrator that owns the installed engine version and all source authority.
- Added repeatable bounded descriptor reads, shared cross-platform path aliases, fixed source and directory ceilings, and fail-closed race diagnostics.
- Proved the packed application in an offline clean consumer and added focused Linux, macOS, and Windows loader gates.
- Rejected more than 100,000 publication-wide collection work references before relationship expansion or manuscript loading.
- Prevented the injected filesystem test seam from minting a trusted public compilation snapshot and rejected multiply linked source files.
- Made the public loaded-source type nominal so TypeScript consumers cannot mistake a hand-built object for loader-issued compilation authority.
- Rejected noncanonical publication-root spellings before filesystem inspection so trailing separators and dot segments cannot hide a final directory symlink from `lstat`.
- Required release through an exact provenance-attested tarball and rejected direct package-directory publication.
- Added the transactional host writer that lifecycle commands mutate author repositories through, with preimage verification, reviewable conflicts, same-directory atomic replacement, a crash journal, and automatic restore.
- Added the centralized lifecycle mutation policy, which is default-deny, checks hard-denied categories before any allowlist so declaring a path cannot grant authority over it, and protects publication sources and durable state through the publication's own declared roots.
