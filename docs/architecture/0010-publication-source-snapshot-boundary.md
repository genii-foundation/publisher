# ADR 0010: Publication source snapshot boundary

- Status: Accepted
- Date: 2026-07-28

## Context

The schema and content packages are pure. They accept already loaded values and never choose which repository files deserve trust. The application package needs one Node.js boundary that turns an author repository into the exact in-memory source set those packages compile.

A declared path is not sufficient filesystem authority. A repository may contain symbolic links, hard links, pipes, sockets, wrong-case names, decomposed Unicode names, hostile undeclared files, or a source that changes during a build. An ordinary read by pathname can cross the approved root or block forever on a file replaced with a FIFO. An unbounded read can exhaust the process before a later size check gets a vote. Filesystems remain delightfully committed to making ontology an operational concern.

The host also contains executable integration files. In particular, `publisher.config.ts` configures the consuming application. It is not publication content and must never become an indirect source declaration.

## Decision

`@genii-foundation/publisher/node` owns the read-only source snapshot boundary. Its public loader accepts one plain object containing only an absolute `publicationRoot`. The installed package's `PUBLISHER_VERSION` is the engine version used for compatibility validation. A caller cannot claim another installed version.

`engine.compatibility` is a SemVer range over GENII Publisher package releases. It is distinct from manifest and artifact `schemaVersion` values. Compiled envelopes carry the exact installed Publisher package version as `engineVersion`.

The public `compileLoadedPublicationContent` orchestrator accepts only the exact object identity returned by the installed public loader. A module-private weak brand rejects copied, reconstructed, cross-instance, or injected-filesystem seam snapshots. The exported TypeScript snapshot type also carries a module-private nominal key, so ordinary consumers cannot hand-construct a value that claims loader authority. The internal seam remains useful for deterministic adversarial tests, but it cannot mint compilation authority. The orchestrator owns `engineVersion`, `publication`, `sourceGraph`, and `sources`; callers supply adapter output and optional resolved extension data. It rejects any attempt to inject one of the loader-owned fields.

The first loader slice reads, in this order:

1. `publication.json`
2. work manifests in publication catalog order
3. collection manifests in publication catalog order
4. manuscripts in resolved work order

It reads no assets, audio catalogs, continuity records, extension sources, provider state, Git data, environment variables, clock data, or network resources in this slice. Later source roles must extend the same boundary rather than reopen the repository independently.

Declared layout remains protocol data in `publication.json`. Each work manifest owns its manuscript and work asset paths. `publisher.config.ts` remains host integration. It is a reserved path across manifest, manuscript, root, asset, continuity, audio, extension, compiler asset, and output authority. The loader never reads, imports, or evaluates it.

Before filesystem inspection, the loader requires the publication root to use its lexically canonical absolute spelling. This rejects trailing separators and dot segments before POSIX `lstat` can follow a final directory symlink through those spellings.

Before accepting a declared source, the loader:

- requires exact NFC repository paths and byte-exact filesystem spelling
- rejects sibling ambiguity under the schema-owned portable segment identity
- rejects symbolic links in every descendant segment and the final component
- rejects multiply linked or nonregular source files and cross-device descendants
- resolves the final real path and checks root containment
- rejects duplicate logical ownership and duplicate device and inode identity
- opens with read-only, no-follow, and nonblocking flags where the platform supplies them
- compares descriptor identity with the walked file before reading
- reads the descriptor twice from position zero, each time at most the smaller of the role limit and remaining publication budget, plus one detection byte
- requires both reads to have the expected exact length and identical bytes
- compares descriptor identity again after both reads
- walks the path again after capture
- rechecks every captured path and the root before returning
- decodes text with fatal UTF-8 semantics

The fixed initial limits are:

- 1 MiB per manifest
- 16 MiB per manuscript
- 20,000 declared source files
- 100,000 collection work references across all collections
- 32 MiB across the complete snapshot

The source count shares the schema protocol's `maximumCompilationSources` value. The maximum manifest catalogs produce 19,996 required manifest and manuscript sources, so a shape-valid catalog cannot fail only because the loader chose a smaller independent ceiling.

Directory enumeration is limited to 20,000 entries and 4 MiB of names per directory. One complete load may retain at most 100,000 directory entries, 16 MiB of names, 4 MiB of logical directory paths, and 20,000 directory snapshots. Raw manifest JSON is limited to 1 MiB, 128 container levels with the root counted as level 1, and 100,000 tokens. The loader checks aggregate collection membership after each collection manifest and before semantic relationship expansion or manuscript loading.

Every public shape validator first captures one descriptor-based, canonically ordered, frozen snapshot. Validation and returned values use only that snapshot. Stateful accessors and proxies cannot change a document between validation and use. Envelope snapshots enforce the shared root counts plus aggregate section, block, collection membership, route, continuity, and nested-reference limits before full JSON-domain or generated-schema traversal. They also enforce 128 container levels with the root counted as level 1 and a 5,000,000-node combined budget.

Generated JSON Schema validation runs in deterministic fail-fast mode. Branching keywords may emit the small set of errors needed to explain their failed alternatives, but validation does not allocate a document-wide all-errors graph for a near-limit hostile document. JSON-domain, semantic, content, and reader relational collectors continue counting within the preflight budget. They retain the lexicographically smallest 255 diagnostic details, add one deterministic truncation diagnostic when required, and report the exact omitted total. A resource preflight failure returns the deterministic breached limit diagnostics before structural traversal.

The cumulative byte budget is checked from file metadata before the next source is opened. A successfully captured source counts once against the 32 MiB budget even though the descriptor is read twice for stability. These limits keep worst-case byte and UTF-16 allocations inside a practical Node.js process envelope. Raising them requires new measured memory evidence and adversarial tests.

The result contains only portable repository paths, validated values, and exact source bytes. It excludes absolute paths, device and inode values, timestamps, hostnames, and other machine state. Result records, publication metadata, and the resolved source graph are recursively frozen. JavaScript cannot freeze the elements of a `Uint8Array`; each returned byte array is private to that result, but a caller can mutate its elements after return. The compiler copies and verifies each byte array before hashing, so such mutation fails validation unless the text and exact bytes still agree.

Portable segment identity has two explicit layers. `portableRepositoryPathIdentity` applies a generated Unicode 15.1 full default case fold with CaseFolding statuses C and F, then generated Unicode 15.1 NFC. It excludes locale-sensitive and Turkic mappings. Target-filesystem normalization then removes trailing ASCII dots and spaces, which Win32 ignores for ordinary path components. The schema runtime uses the same helper to reject declared trailing-dot and trailing-space segments, while the loader uses it to detect colliding undeclared siblings during directory enumeration.

The compact mapping tables are generated deterministically from the exactly pinned `@unicode/unicode-15.1.0` development dependency and the official Unicode 15.1.0 `UnicodeData.txt` normalization properties. The imported normalization subset records its source URL and SHA-256 checksum. The case-fold data retains its upstream MIT license, and the normalization data retains the Unicode License V3. Schema builds reject stale generated tables. The shipped browser-safe runtime contains the compact tables but no import of either source dataset, Node.js API, compression library, locale service, host case-conversion table, or `String.prototype.normalize`.

The Unicode version is part of repository path, decoded route, and decoded fragment validation rather than an ambient runtime detail. A code point unassigned in Unicode 15.1 has canonical combining class zero and no decomposition in this profile even if a later Unicode release assigns it. For example, `q\u{1ACF}\u0323` remains in that exact order under the pinned profile on every supported Node.js major. Host normalizers from later Unicode releases can reorder it, so they are not protocol authority.

Repository paths may otherwise use up to 1,024 well-formed Unicode scalars within secondary 2,048 UTF-16-code-unit and 4,096 UTF-8-byte limits. The scalar and code-unit limits are both necessary because JSON Schema `maxLength` counts Unicode scalars while JavaScript allocation is measured in UTF-16 code units. The protocol rejects the explicit bidirectional controls U+061C, U+200E, U+200F, U+202A through U+202E, and U+2066 through U+2069, plus the U+2028 line separator and U+2029 paragraph separator. It retains U+200C ZERO WIDTH NON-JOINER and U+200D ZERO WIDTH JOINER because they carry orthographic meaning. Variation selectors and other well-formed Unicode 15.1 NFC characters also remain exact rather than being erased or confusable-mapped.

Expected source ownership is also enforced in the pure semantic and content compiler contracts. No direct compiler caller may rely on `Map` replacement semantics to assign one path to two roles.

The matching positional reads detect ordinary instability, including same-size in-place rewrites whose metadata does not visibly advance. They do not make the tree an atomic whole-repository snapshot. A malicious writer can toggle content between observations, and concurrent writes outside observable byte or identity changes remain out of scope.

The portable Node.js implementation also does not claim protection from a privileged same-device bind mount replacement or every malicious concurrent mutation of a parent directory. Those guarantees require platform-specific descriptor-relative resolution such as Linux `openat2`. Detected changes fail closed. Undetectable privileged local filesystem replacement remains outside the supported threat model.

## Consequences

The loader produces deterministic bytes for its first bounded source slice when observable source identity remains stable. It does not yet claim an atomic snapshot of every asset, audio, continuity, or extension source used by a complete 1.0 build. Undeclared repository files are ignored. Host configuration cannot smuggle itself into compilation through a declared path.

Compatibility checks reflect the installed application package rather than caller testimony. Prerelease fixtures must explicitly include the active prerelease in their compatibility range.

Official host compilation uses the public-loader-issued snapshot and installed application version. The lower-level framework-neutral compiler and injected filesystem seam remain separately testable, but neither is an authority-bearing host entry point.

The loader performs no writes. Compilation, validation, build, and preview commands still cannot modify author source.

Platforms without the required filesystem flags retain the documented portable limitation. Package tests use real filesystems plus an injected private filesystem seam to prove races, cross-device changes, bounded reads, and diagnostic privacy.

## Rejected alternatives

- Accept an `engineVersion` argument from the host. This lets the host bypass the installed-version compatibility gate.
- Accept a structurally similar source snapshot from the host. Structural typing cannot prove that bytes passed through the loader's filesystem and manifest custody checks.
- Execute `publisher.config.ts` to discover source paths. This gives host code authority over content custody and makes a read-only snapshot dependent on arbitrary execution.
- Recursively discover manuscripts and assets. This imports undeclared files and turns repository accidents into publication state.
- Follow symlinks inside the approved root. Symlink targets and identities can change outside manifest review.
- Use `FileHandle.readFile()` and check size afterward. A changed file can allocate without bound before rejection.
- Claim hostile-local-filesystem immunity from portable path APIs. The claim would be false, which is a poor security primitive even by software industry standards.
