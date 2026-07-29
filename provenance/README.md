# Migration provenance

Every extraction or migration batch records where its requirements came from, what source material was inspected, how implementation was produced, which license treatment applies, and what checks support the classification.

The ledger is evidence, not a substitute for the licenses or legal review.

## Classifications

The record format accepts only these classifications:

- `fresh-cpal`: New GENII Publisher expression. No source code or tests were copied. Observing another implementation must be disclosed, so this classification does not claim a formal clean-room process.
- `apache-preserved`: Apache 2.0 source or tests were copied and remain under an explicit Apache boundary with required notices.
- `relicensed-cpal`: Source or tests were copied into CPAL-covered code under documented relicensing authority. The public record must identify the private rights document and its checksum without publishing the document.
- `cc-host-only`: CC-licensed publication material remains in the author repository. It does not enter a Publisher package.
- `third-party-preserved`: Separately licensed material is redistributed with its original license and notices.
- `blocked`: Provenance, rights, notices, or scan evidence is incomplete.

Git authorship, repository access, and review authority do not prove relicensing authority. A `relicensed-cpal` record therefore requires a dated rights document ID, SHA-256 checksum, scope, authorizing parties, and secure custodian.

## Record requirements

Each JSON record identifies:

- whether the record is a `draft`, `accepted`, or `blocked`
- the exact 40-character destination base ref
- every exact audited Git ref and pinned external artifact
- SHA-256 hashes and line citations for source evidence
- the destination scopes assigned to the record, including deleted paths
- the treatment and whether source code or tests were copied
- every installed dependency file whose bytes feed a generated artifact
- fixed scan outcomes for exact blobs, normalized lines, token shingles, CC phrases, and package leakage
- any read-only regeneration commands
- an explicit review decision and reviewer identity
- license, notice, legal, and change-documentation effects

Records use [record.schema.json](record.schema.json). Final audit receipts use [receipt.schema.json](receipt.schema.json). The validator also checks lifecycle consistency, manifest construction, source identity, installed-input mappings, scan counts and exclusions, package roots, regeneration results, classification-specific outcomes, and unique evidence paths.

A draft must keep its destination manifest and receipt fields null. An accepted record must name a receipt by repository path and SHA-256 hash. That receipt contains present-file hashes, deterministic deletion tombstones, the scanner runtime closure identity, verified source identities, installed-input hashes, evidence checks, scan matches, narrowly declared binary exclusions, regeneration results, and packed package hashes. A canonical stable-claims digest binds classification, sources, specifications, destination and CC scopes, package policy, treatment, scan methods, review metadata, documentation, and verification commands. Only lifecycle results such as timestamps, decisions, outcomes, manifest pointers, and receipt pointers are excluded.

Run:

```bash
npm run provenance:validate
```

The command validates every JSON file under `provenance/records/` and every referenced receipt. For accepted working-tree records, it also recomputes current Git coverage, the full destination manifest, deletion tombstones, the current scanner runtime closure identity, installed-input hashes, package archives, package leakage, and package scan exclusions. Package reconstruction runs through the exact npm CLI that invoked the workspace command. It does not fetch source repositories, publish rights documents, or modify source.

Release preparation requires at least one working-tree record, requires every provenance record that names a publishable package root to be accepted, and requires an explicit empty output directory outside the repository. Every current publishable package root must also remain covered by an accepted working-tree record:

```bash
npm run release:prepare -- \
  --output /absolute/path/to/empty-release-directory \
  --tag next
```

The command builds one lifecycle-complete tarball for every publishable package in an owned clean workspace, validates those exact files through the release provenance gate, validates the release tag against each archived version, and retains the accepted files in the requested directory. Draft records therefore block release preparation by design.

Immediately before any authorized publication, the trusted workflow must recheck the retained files:

```bash
npm run release:verify -- \
  --manifest /absolute/path/to/empty-release-directory/release-manifest.json
```

Direct package-directory publication is forbidden by every publishable package. The trusted release workflow may publish only the exact tarball paths named by the freshly reverified manifest. npm uploads a tarball input without rerunning the package-directory lifecycle, so this path sends the same bytes that passed provenance. A regression fixture gives its directory publication a failing `prepublishOnly` hook, then proves that `npm publish --dry-run <candidate.tgz>` succeeds with the candidate's exact integrity, shasum, and file inventory. The workflow must never rerun `npm pack`, rebuild a package, or substitute another archive between verification and `npm publish <exact-tarball-path>`. `release:verify` is deliberately inert and never publishes. The repository still lacks an authorized trusted-publishing workflow, so public release remains blocked until that separate credential-bound path exists and invokes verification immediately before each exact archive upload. Package lifecycle scripts remain defense in depth. Publishing with scripts disabled, publishing an arbitrary tarball, or bypassing the trusted workflow can evade local guards, so npm publishing credentials must remain bound to that workflow.

## Scanner identity

A receipt records which scanner implementation produced it, as a composite `sha256-scanner-runtime-closure-v1` digest over a sorted component list. The closure is the checked-in scanner, schema, and lock inputs plus every installed file in the exact runtime dependency closure of the pinned `tar-stream` version. It currently spans 162 files.

The identity is computed from where the scanner lives, not from the repository being audited. For a self-audit the two coincide, but they are different claims: the receipt asserts what ran, and live validation asks whether that implementation is still the one installed here.

`auditRecord` captures the identity before any subprocess runs and recomputes it after the receipt is built. Declared regeneration and verification commands execute inside an audit, so an audit whose own scanner changed underneath it cannot attribute its results to one implementation and fails closed.

Each installed component is bound to the lockfile by exact version, canonical SHA-512 integrity, and exact registry tarball URL. That URL check requires the `https://registry.npmjs.org` origin, so **a lockfile resolved through a mirror or a private registry is refused**. This is deliberate. The integrity hash proves which bytes were installed but not which registry published them, and a vendored supply chain is a different one. An organization that mirrors must change this policy through a reviewed decision rather than have it pass silently.

Live validation compares the recorded algorithm, composite digest, component count, and component list, so tampering with the archive reader, the lockfile, or any installed parser file invalidates every accepted receipt.

## Deterministic audit

The audit command accepts local checkouts and source artifacts. It never fetches them. Every Git source must resolve to the exact commit in its record. Every evidence file must match its recorded hash and line range.

This example previews the current batch without writing receipts:

```bash
npm run provenance:audit -- \
  --destination . \
  --source https://github.com/genii-foundation/coherence-thesis=/path/to/coherence-thesis \
  --source https://github.com/node-unicode/unicode-15.1.0=/path/to/unicode-15.1.0 \
  --source https://github.com/node-unicode/node-unicode-data=/path/to/node-unicode-data \
  --artifact https://www.unicode.org/Public/15.1.0/ucd/UnicodeData.txt=/path/to/UnicodeData.txt \
  --artifact https://www.unicode.org/Public/15.1.0/ucd/NormalizationTest.txt=/path/to/NormalizationTest.txt \
  --artifact https://www.unicode.org/license.txt=schemas/third-party-licenses/unicode-data-LICENSE.txt
```

The command fails if a changed or deleted path has no working-tree record, a declared scope selects no changed path, or a working-tree manifest is empty. It hashes every selected present file and records deterministic tombstones for deletions. It verifies source refs, evidence, and exact installed dependency files; runs exact-blob, normalized-line, significant-token, CC-phrase, and package-leak scans; executes declared read-only regeneration checks; and builds each publishable package through its complete lifecycle.

Candidate preparation resolves the absolute `npm_execpath` and `npm_node_execpath` supplied by the invoking workspace command, verifies the exact npm version pinned by the root manifest, copies only the tracked and nonignored working-tree source into an owned temporary workspace, installs the locked workspace offline with scripts disabled, and packs packages in dependency order. Ignored build output and package-local dependency staging never enter from the source checkout. Content and Reader therefore contribute their rebuilt output and complete staged dependency closures to the candidate archive before scanning. The source checkout is read-only throughout this process.

Text scans fail closed when a non-binary file exceeds the byte limit, contains NUL, is not valid UTF-8, or cannot be extracted from a package archive. Only a fixed list of binary file extensions may bypass text decoding. Every such exclusion records the document hash and exact scans skipped. Exact-blob comparison still covers the bytes.

## Package archive reading

Every archive the audit inspects is read by [archive-reader.mjs](scripts/archive-reader.mjs). No external archive process participates, and none may be reintroduced. [ADR 0011](../docs/architecture/0011-trusted-package-archive-boundary.md) records the threat model, the fixed ceilings, and the rejected alternatives.

One call opens one descriptor, hashes the compressed bytes leaving it, decompresses them once, audits the TAR stream block by block, parses its members once, hashes every member body, and captures only the bodies the caller selects. Descriptor and pathname identity are checked before the first byte and again before the result is accepted, inside a single wall-clock deadline a caller can tighten but never raise.

The reader refuses anything it cannot vouch for: a symbolic link or multiply linked candidate, a path that is not already its own canonical spelling, an archive with fewer than two end-of-archive blocks, any nonzero byte after the archive ends, nonzero member padding, an end block carrying data in its checksum field, archive metadata members, every member type other than a regular file and an empty directory, a link target on a regular member, a member path outside the exact `package/` prefix or containing a control character, a reserved character, or a non-ASCII scalar, duplicate and portably colliding paths, a member nested under a file, and any archive that does not hold exactly one `package/package.json`.

A caller that already holds a descriptor for the same bytes passes it as `expectedIdentity`. Size, SHA-256, SHA-512 integrity, SHA-1 shasum, member count, and member inventory are then bound to that record inside the same read, which is why a retained release candidate is never hashed and then reopened. The comparison covers content identity only, so archive promotion can read a freshly copied path while asserting the identity of the descriptor it copied from.

Provenance tooling depends only on Node builtins, `ajv`, and its own sibling scripts. The schema package's strict JSON facility and portable path identity are deliberately not imported: doing so would make `npm run provenance:validate` require a prior build and would put archive parsing outside the bytes the scanner identity attests.

Use `--skip-packages` only for local scanner development. Its output cannot support an accepted record.

Once the code set is stable and review authorizes finalization, write one receipt per working-tree record:

```bash
npm run provenance:audit -- \
  [the same local source mappings] \
  --emit-receipt-dir provenance/receipts
```

Do not overwrite a receipt. If code, scanner, source evidence, package contents, installed inputs, or a regeneration result changes, discard the unaccepted output and run a new audit. Copy each final manifest summary and receipt hash into its record, replace provisional scan outcomes with the receipt outcomes, then change the record to `accepted` only after maintainer review. Never issue receipts before the destination set is stable.

The Unicode preservation record needs the exact Unicode 15.1.0 `UnicodeData.txt` and `NormalizationTest.txt` bytes identified in the record. The bundled license file can verify the Unicode License V3 artifact because its bytes match the pinned source hash. The npm data and generator repositories must be available at their recorded commits. The audit also compares every installed npm file consumed by the generator to exact Git evidence, so a same-version local package mutation fails.

## Rights documents

Keep private rights documents outside this repository. The public ledger stores only:

- an immutable document ID
- the document SHA-256 checksum
- its issue date
- its exact scope
- the authorizing parties
- the secure custodian responsible for producing it during review

Changing any of those facts requires a new reviewed ledger record. Do not overwrite historical records to make a later migration appear authorized earlier.
