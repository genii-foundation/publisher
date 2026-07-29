# Provenance changes

This file records changes to the migration provenance system.

## 2026-07-28, GENII Foundation

- Added the closed provenance record schema and validator.
- Added semantic checks for licensing treatment, scans, review, and relicensing evidence.
- Recorded the initial fresh neutral implementation audit against exact Publisher and Coherence refs.
- Added draft and accepted record lifecycles with byte-bound audit receipts.
- Added an offline deterministic audit for path coverage, exact refs, evidence hashes and ranges, content similarity, CC phrases, package leakage, and read-only regeneration checks.
- Split the secure source-loader work into a fresh CPAL record and a third-party-preserved Unicode record.
- Preserved the MIT case-fold data and Unicode License V3 normalization-data sources, hashes, licenses, notices, and deterministic generated table.
- Marked the earlier foundation extraction record as a draft because its scan claims were not bound to a destination manifest or retained package archives.
- Bound material record assertions to a deterministic stable-claims digest with narrowly defined lifecycle exclusions.
- Replaced present-file-only manifests with live Git manifests that include deterministic deletion tombstones and reject empty or stale accepted records.
- Made text and archive scanning fail closed, with byte-bound exclusions limited to declared binary file types.
- Bound every installed Unicode npm file consumed by generation to exact upstream Git evidence and rejected same-version byte tampering.
- Added live accepted-record checks for current Git coverage, scanner bytes, installed inputs, packed package archives, leakage results, and scan exclusions.
- Added a release provenance gate so draft or stale records cannot authorize publication.
- Replaced script-disabled archive reconstruction with exact npm lifecycle candidates built in an owned clean workspace, scanned and retained as the only permitted publish inputs.
- Added package-directory publication guards so the trusted release workflow cannot build different bytes after provenance acceptance.
- Required every package-affecting historical or working-tree provenance record to be accepted before release.
- Preserved the official Unicode 15.1 normalization suite and ran every NFC conformance case against both generated tables and the compiled public normalizer.
- Replaced the per-member external archive processes with one bounded, trusted, single-descriptor streamed reader and recorded its threat model in ADR 0011.
- Removed the retained-candidate window that hashed an archive and then reopened it to parse, binding the recorded identity into the same read.
- Refused smuggled post-terminator members, nonzero padding, missing end-of-archive blocks, checksum-field smuggling, archive metadata members, nonregular member types, link targets on regular members, and portable member path collisions.
- Parsed the packed manifest with fatal UTF-8 decoding and refused byte order marks and duplicate object keys.
- Replaced the single-file receipt scanner hash with the composite scanner runtime closure identity, bumped the receipt schema to 1.2.0, and added scanner component count, uniqueness, and ordering checks.
- Documented that the exact registry tarball URL policy intentionally refuses mirrored and private registry lockfile entries.
- Refused a package archive member nested under a file whose case differs, which a case-insensitive filesystem cannot extract, and refused reserved Windows device names in any member path segment.
- Made every packed manifest rejection name the archive it refused and fail as a stated rejection rather than a null dereference or a caller-argument diagnostic.
- Bound the package archive size decoder to the parser's exact numeric field semantics and allowlisted member type flags at the raw layer, closing two cursor desynchronization paths.
- Required a package archive to be exactly one gzip member ending at end of file, verified against the container's own CRC-32 and length trailer, so bytes hidden after the member can no longer be attested without being examined or scanned.
