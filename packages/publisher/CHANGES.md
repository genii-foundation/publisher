# Changes

This file records changes to GENII Publisher covered code as required by CPAL 1.0 Section 3.3. The GENII Publisher application package is derived directly from GENII Publisher Original Code provided by GENII Foundation. Contributors must append a dated summary. Do not rewrite prior entries.

## 2026-08-19, GENII Foundation

- Added a versioned public identity projection bound to each exact Reader build and materialized it as a required renderer data artifact.
- Preserved exact installed host package metadata while generating the renderer contract.
- Added versioned, inspectable local preview candidate identity for exact worktree, branch, commit, state, and source bytes.
- Added fail-closed capture and verification for unstable files, symbolic links, special paths, unresolved indexes, submodules, and concurrent Git changes.
- Exposed read-only preview identity and verification commands with packed-package consumer proof.

## 2026-08-18, GENII Foundation

- Projected, materialized, checked, and reported the required progress catalog beside each Reader artifact.
- Loaded and validated declared Updates catalogs and emitted canonical envelopes bound to the exact Reader build.
- Materialized and checked Updates alongside Reader, search, narration, and synchronization artifacts.

## 2026-08-13, GENII Foundation

- Added deterministic search artifact projection to every publication build.
- Required renderer-declared search capability and destination before any build output is written.
- Materialized and checked the search artifact atomically beside the Reader, narration, and synchronization artifacts.
- Compiled author-declared Markdown section structure into durable Reader hierarchy, routes, continuity, and section-local block ranges.
- Refused stale, orphaned, out-of-order, and route-less navigable section declarations with manuscript-aware diagnostics.

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
- Added committed author host integration state and host initialization, with read-only planning, a directory-independent plan hash the apply step must be given, reviewable conflicts over locally modified files, and adoption of an established declared layout without moving any source.
- Required a clean Git work tree with a commit before any lifecycle apply, recorded the commit a rollback returns to, and proved that returning to it restores the pre-apply tree exactly.
- Added the genii-publisher executable with init plan, init apply, and recover, resolving the renderer host contract from the author's own installation and refusing to apply a plan hash the operator did not review.
- Extended the transactional host writer to remove files a host contract no longer owns, governed by the same expected preimage so an author-edited file is a conflict rather than a deletion.
- Added the host contract migration registry, which validates one unbroken target-owned chain, refuses forks, gaps, cycles, and stranded shortcut edges, and resolves the sequential edges a host must traverse along with any manual gates.
- Added host upgrade planning and application, which diffs the installed contract against the recorded state, removes files the contract no longer owns, gates on manual steps the engine will not perform, and corrected the mixed-tree refusal that had made upgrades impossible.
- Added the apply receipt and surgical host rollback, which restores exactly the recorded paths from the recorded baseline commit through the transaction, refuses a file changed since the apply, and leaves unrelated untracked work alone.
