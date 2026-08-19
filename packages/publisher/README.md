# `@genii-foundation/publisher`

This package is the public application and Node.js orchestration boundary for GENII Publisher.

The package is prerelease software. Its API may change before 1.0 through explicit, versioned migrations.

## Entry points

The package root is safe to import in browsers. It exposes the exact Publisher version and shared public types without importing filesystem, process, network, framework, or provider modules.

`@genii-foundation/publisher/node` owns trusted build-time access to author repositories. Its public source snapshot loader accepts one explicit absolute publication root and returns validated in-memory source. The returned TypeScript type is opaque and can only be obtained from the loader API. `compileLoadedPublicationContent` accepts only the exact snapshot object issued by that public loader, injects the installed `PUBLISHER_VERSION`, and combines it with explicit adapter output. A copied, hand-built, or injected-filesystem seam snapshot is not accepted. Browser code must never import the Node entry point.

Declared layout overrides are protocol data in `publication.json`. A host may use `publisher.config.ts` for provider integration, `publisher.theme.mjs` for explicit theme selection, and `publisher.extensions.mjs` for explicit extension registration. The source snapshot loader does not execute or inspect any of these reserved files.

## Extension registration

Manifest package names record provenance. They are never import instructions.
Install each extension package explicitly, then register it in author-owned host
code:

```js
// publisher.extensions.mjs
import stationIndex from "@example/station-index-extension";

export default Object.freeze([stationIndex]);
```

The registration supplies its exact package version, engine compatibility,
supported capabilities, and implementation. Every manifest declaration must
match one registration in declaration order. Publisher invokes
`content.project` only when granted and materializes its canonical result in a
Reader-build-bound extension artifact. A separate `host.route` grant invokes
the extension's build-time route projector with public publication identity,
its own config and payloads, and its own optional server projection. Publisher
validates canonical paths and collisions before recording those descriptors in
the same artifact. `publisher.extensions.mjs` is never
created, rewritten, or treated as publication source by lifecycle commands.

## Source snapshot boundary

The Node loader accepts one lexically canonical absolute publication root. It reads only the root publication manifest, its declared work and collection manifests, and the manuscripts resolved from those manifests. It does not discover alternative manuscripts, recursively ingest asset trees, execute packages, inspect Git state, contact a network, read the clock, or write author source.

The loader rejects symbolic links, multiply linked or non-regular source files, real paths outside the approved root, device changes visible through filesystem metadata, duplicate physical identities, and source identity changes detected before and after exact file-descriptor reads. Rejecting every source whose filesystem link count is not one prevents an otherwise valid in-root path from aliasing a same-device file outside the publication root. It reads each descriptor twice from position zero with the same fixed bound and accepts the bytes only when both exact reads match. This detects ordinary concurrent in-place rewrites even when size and timestamps appear unchanged. The accepted source counts once against the 32 MiB publication budget.

Directory scanning uses the schema-owned portable segment identity. That identity combines bundled Unicode 15.1 full default case folding and NFC with Windows trailing-dot and trailing-space normalization, so an undeclared sibling such as `work.json.` cannot make a repository platform dependent. The loader decodes text with fatal UTF-8 semantics and preserves the exact bytes supplied to the framework-neutral compiler.

The two matching reads do not make the repository tree an atomic snapshot. A malicious writer can toggle content between observations, and concurrent writes that leave no observable byte or identity change can escape the check. Portable Node.js filesystem APIs also cannot make privileged same-device mount replacement or hostile concurrent parent-directory mutation impossible. Those attacks are outside this package's guarantee. A stronger adversarial-local-filesystem claim would require platform-specific native path-resolution primitives.

The returned source graph contains portable repository paths only. Absolute paths, inode values, device identities, timestamps, and other host-specific state never enter compiled artifacts.

## Local preview identity

`capturePreviewCandidateIdentity` records the canonical Git worktree, branch or
detached state, full HEAD commit, dirty state, and every present tracked or
untracked, nonignored candidate path. Each regular file or symbolic-link target
has an exact byte count and SHA-256 digest. `verifyPreviewCandidateIdentity`
recaptures the worktree and reports which top-level identity facts changed.
`parsePreviewCandidateIdentity` authenticates saved evidence before it is trusted.

The matching commands are:

```sh
genii-publisher preview identity --host /absolute/host --json > .publisher/preview.json
genii-publisher preview verify --host /absolute/host --identity .publisher/preview.json
```

The evidence path must be ignored. Otherwise writing the evidence adds a new
untracked candidate file and correctly makes the saved identity stale. Both
commands are read only. They do not start or stop a preview server. A host preview
manager records its URL and process beside this engine-owned candidate evidence.

Ignored dependencies, generated output, credentials, and local state are outside
the candidate claim. Capture refuses unmerged indexes, submodules, symbolic-link
parents, special files, path escapes, unstable reads, and Git or directory changes
observed during capture.

The initial loader limits are 1 MiB per manifest, 16 MiB per manuscript, 20,000 source files, 100,000 collection work references, and 32 MiB of accepted source bytes. Directory enumeration is limited to 20,000 entries and 4 MiB of names per directory, plus 100,000 entries, 16 MiB of names, 4 MiB of logical directory paths, and 20,000 cached directory snapshots across one load. Raw manifest JSON is limited to 1 MiB, 128 container levels with the root counted as level 1, and 100,000 tokens. The collection-membership ceiling is checked incrementally after each collection manifest and before semantic relationship expansion or any manuscript open. Every limit is checked before the corresponding unbounded work or source open.

The loader result is recursively frozen except for byte-array elements, which JavaScript cannot freeze. The content compiler copies and verifies byte arrays before hashing them. Mutating returned bytes cannot silently change a successful compilation.

## Package boundaries

The application package depends on exact versions of:

- `@genii-foundation/publisher-schema` for manifest shape, layout, semantic validation, and the normalized source graph
- `@genii-foundation/publisher-content` for compilation source contracts

The Node boundary does not import Next.js, React, Vercel, Supabase, audio providers, sync providers, themes, editorial packages, or publication-specific code.

## Attribution

Every graphical renderer built with GENII Publisher must display:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

The credit must link to `https://publisher.genii.foundation`. The renderer must also expose the validated publication `attribution.sourceCodeUrl` as a conspicuous source link.

## License and source

This package is licensed under CPAL 1.0. Network deployment triggers the source-sharing duties described in the license.

Canonical source: `https://github.com/genii-foundation/publisher`
