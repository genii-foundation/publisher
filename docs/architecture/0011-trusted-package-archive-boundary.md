# ADR 0011: Trusted package archive boundary

- Status: Accepted
- Date: 2026-07-28

## Context

Provenance auditing inspects the exact tarballs a release would publish. It needs each archive's byte identity, its complete member inventory, and the bytes of every member it scans for leaked source.

The first implementation shelled out to `tar`: once per archive to list members, then once more per member to extract it. Three problems followed from that shape.

It was a machine-time denial of service. A real Content candidate holds 8,307 members inside 947,253 compressed bytes. An all-package audit was killed after 73.62 seconds having produced no result and 62.56 seconds of user CPU. The per-member allowance was 100,000, so a hostile candidate had four orders of magnitude of headroom in which to make an audit unfinishable.

It trusted an untrusted dependency. Whichever `tar` appeared first on `PATH` decided what the archive contained. That process also flattened member types into text, mishandled names containing newlines, and could not report whether a member was a regular file, a device, or a link.

It hashed one set of bytes and parsed another. The archive was read to compute its digests, then reopened to be listed and extracted. Nothing bound the second read to the first. The retained-candidate path made this concrete: it hashed a candidate, then reopened it, so the verified bytes and the parsed bytes were only related by hope.

`tar-stream` is the pinned parser, but a parser is not custody. Measured against 3.2.0, it accepts an archive with no end-of-archive blocks; accepts a single end block; parses and yields a member smuggled after the end blocks; discards member padding without proving it is zero; treats the eight checksum bytes of an otherwise zero block as ignorable, because its checksum routine skips them; emits symbolic links, hard links, block and character devices, FIFOs, contiguous files, and unknown type flags as ordinary entries; keeps a non-empty `linkname` on a member that declares itself a regular file; decodes member names with lossy UTF-8, so invalid bytes become U+FFFD; reparses a PAX `size` with `parseInt` over attacker-supplied text; and emits a directory member without skipping a non-zero declared body, which leaves its cursor pointing at attacker-chosen bytes it will read as the next header.

## Decision

`provenance/scripts/archive-reader.mjs` owns the only path by which provenance tooling learns what an archive contains. No external process participates.

`readPackageArchive` performs one streamed pass. It walks the pathname, refuses a symbolic link or a non-regular file, requires the caller's path to already be its own canonical spelling, and opens one descriptor with read-only, no-follow, and non-blocking flags where the platform supplies them. It compares descriptor identity against the walked file, requires exactly one hard link, and streams the compressed bytes from that descriptor while computing SHA-1, SHA-256, and SHA-512 over the same bytes. Those bytes are decompressed once, audited block by block, and parsed once. Every member body is read in full, both to keep the parser aligned with the stream and to hash the member; only bodies the caller's `captureFile` predicate selects are retained. Descriptor and pathname identity are checked again before the result is accepted, and the whole sequence runs inside one wall-clock deadline that a caller may tighten but never raise.

`createRawTarAuditor` sits between decompression and the parser and enforces what the parser does not: 512-byte alignment, zero member padding, at least two end-of-archive blocks, only zero bytes after the archive ends, fully zero end blocks including their checksum field, only allowed member type flags, and no declared body on a directory member. It replicates the parser's promotion of a type-flag-0 member whose name ends in a separator to a directory, because a disagreement about where a body ends would let one of the two resynchronize on bytes the other treats as content.

Numeric field decoding is the sharpest edge in the whole boundary, so it has an explicit contract: the auditor must return the same value the parser returns, or return a value its own range check refuses. It must never return a different accepted value. Both decoders accepting different sizes is the one outcome that desynchronizes the cursors while both keep walking, and the window it opens is bounded only by the per-member ceiling, with every invariant unenforced inside it. Being stricter than the parser is safe, because the archive is then refused outright. A differential test compares the two decoders over a hand-picked and adversarial corpus, with the parser's own algorithm transcribed as the oracle, so a dependency update that changes it fails the suite rather than silently reopening the gap.

The allowed member shapes are a regular file and an empty directory. Type flags are allowlisted at the raw layer as the header bytes `0x00`, `0x30`, and `0x35`, rather than blocklisting the flags that carry archive metadata. A blocklist has to enumerate every value the parser gives meaning to, and missing one is silent: `toType` maps both 28 and 30 to `gnu-long-path`, so header bytes `0x4c` and `0x4e` are equivalent to it, and banning only `0x4c` leaves the ban bypassable by a single byte and a recomputed checksum. Symbolic links, hard links, contiguous files, block and character devices, FIFOs, PAX headers, GNU long paths and long link paths, and every unassigned flag are therefore refused before the parser sees them, and a member arriving with PAX attributes or a non-empty `linkname` is refused again at the entry layer.

Member paths must sit under the exact `package/` prefix and consist only of printable ASCII, excluding the Windows-reserved `< > : " | ? *` and the backslash. Segments may not be empty, `.`, or `..`, may not end in a dot or a space, which Win32 ignores, and may not be a reserved Win32 device name such as `nul`, `con`, `aux`, `prn`, `com1` through `com9`, or `lpt1` through `lpt9`, with or without an extension. Those names resolve to character devices in every directory, so an extractor would open one, discard the member body, and leave a member the receipt attests absent from disk. U+FFFD is refused with its own diagnostic, because a replacement character means the header carried bytes that were not valid UTF-8 rather than that an author typed one. Duplicate paths, a path declared as both a file and a directory, a member nested under a file, and paths colliding under portable identity are all refused. Because the path is restricted to printable ASCII, an ASCII lower-casing is the exact case fold and NFC is the identity function, so portable identity needs no Unicode table.

Ancestor conflicts are resolved by folded key rather than by exact spelling. An exact-case lookup would accept `package/Foo` beside `package/foo/bar`, since neither is a duplicate and their folded keys differ. That archive cannot be extracted on a case-insensitive filesystem: `tar -xzf` fails with `Not a directory` and one of the two attested members never reaches disk.

That restriction is measured rather than assumed. A pack of every current package produced 8,442 unique member paths using only `a-z`, `A-Z`, `0-9`, `/`, `.`, `_`, `-`, and `@`, with no non-ASCII character, no control character, no Windows-reserved character, no directory entry, no segment ending in a dot or space, no case collision, and a longest path of 116 bytes.

The gzip container itself is proven to cover the whole file. Hashing every byte establishes what the artifact contains, but not that every byte was examined, and those are different claims. `createGunzip` decompresses the first gzip member and then discards trailing input, treating a leading zero byte as ignorable padding, so a file shaped as a benign member, one `0x00`, then a second member decompresses to the benign tar alone. The structural auditor never sees the tail, the member inventory omits it, the leak scan never decodes it, and the receipt still attests the digests of the entire file while a consumer recovers the payload with `gunzip`. That is a hole straight through the purpose of a leaked-source scan.

The fix uses the container's own framing. A gzip member ends with the CRC-32 and the modulo-2^32 length of its own uncompressed data, so requiring the last eight bytes of the file to describe everything that was decompressed proves the file is exactly one member ending at end of file. Trailing padding, trailing garbage, and concatenated members all fail it, and the first two bytes are required to be the gzip magic. Real `npm pack` output is a single member, so nothing legitimate is affected.

An archive must contain exactly one `package/package.json`. `parsePackedManifestJson` refuses a leading byte order mark on the raw bytes, decodes with fatal UTF-8 semantics, parses, and then refuses any object that declares one key twice. `JSON.parse` keeps the last occurrence of a duplicate key, so a manifest carrying two `name` values would present one identity to this scanner and possibly another to a different reader.

`expectedIdentity` accepts a descriptor previously returned for the same bytes and refuses any mismatch in size, SHA-256, SHA-512 integrity, SHA-1 shasum, member count, or member inventory. A stale size is refused before anything is decompressed. The comparison covers content identity only. It never compares `archivePath` or `candidateDirectory`, because archive promotion deliberately reads a freshly copied path while asserting the identity of the descriptor it copied from, and it ignores fields it does not own, because a package descriptor also carries a name, version, root, and stripped file list.

This is what removes the retained-candidate window. The retained descriptor's claimed identity is carried into the single read instead of being checked against a separate one. `assertRetainedDescriptorShape` still validates the descriptor's shape and range, but it performs no filesystem read.

The fixed ceilings are 256 MiB compressed, 512 MiB decompressed including headers and padding, 100,000 members, 4 KiB per resolved member path, 16 MiB of aggregate member paths, 64 MiB per member body, 1 MiB for the packed manifest, 384 MiB of aggregate member payload, and 60 seconds of wall time per archive. Raising any of them requires new measured evidence and new adversarial tests.

Provenance tooling depends on nothing but Node builtins, `ajv`, and its own sibling scripts. The schema package owns a richer strict JSON facility and the authoritative portable path identity, and neither is imported here. Importing the schema build output would make `provenance:validate` require a prior compile, and it would place archive parsing behavior outside the bytes the scanner identity attests, since that closure covers ten checked-in files and no build output.

## Consequences

The pathological case is no longer pathological. The 8,307-member Content candidate is read in 81.8 milliseconds, and all five current candidates together in 111.8 milliseconds. A synthetic 10,001-member archive is read in 104 milliseconds.

The member inventory the reader reports is byte-identical to what the external listing produced, including the trailing separator on a directory member, so receipts built from it are unchanged in content and key order.

Refusing PAX and GNU long-path members caps a ustar member path at 255 bytes. The 4 KiB path ceiling and the 16 MiB aggregate are therefore defense in depth rather than live bounds, as is the receipt schema's 500-character path limit.

The per-member ceiling is a deliberate tightening. The previous effective bound was whatever the external process would buffer, 256 MiB. A member above 64 MiB is now refused, against a measured maximum of 2,625,136 bytes. The 16 MiB ceiling on decoded text is not enforced here: it belongs to the scanner's `decodeText`, which already owns the declared-binary bypass.

The reader is not a general-purpose extractor. It returns bytes in memory, so the package-consumer tests that extract whole trees to disk for byte-identical rebuild proofs continue to use an external tool, outside this boundary.

Peak memory when every body is captured is the archive's uncompressed payload. The largest current candidate decompresses to 11,211,264 bytes, which is why a capture-everything predicate is acceptable and no streaming capture callback exists.

The measured bounds under adversarial input: an 896 MiB-of-zeros gzip bomb is refused at the 512 MiB decompressed ceiling in about 885 milliseconds without exhausting memory; 100,001 members are refused in about 341 milliseconds with no over-allocation, because the member count is checked before each record is retained; and a 60 MiB single member under a 2 millisecond deadline is torn down at 5 milliseconds, since the deadline aborts the pipeline mid-body rather than only at member boundaries. The conflict resolution that runs after the stream closes is not interruptible, so its cost is bounded by the aggregate path ceiling and checked against the deadline once it returns.

The reader's bytes are now actually attested. Audit receipts record the composite scanner runtime closure identity rather than a single file hash, `auditRecord` recomputes that identity after its subprocesses have run and refuses a mismatch, and live validation recomputes it against the running scanner. Before this, `createScannerIdentity` had no production consumer, so listing `archive-reader.mjs` among its inputs bound nothing that shipped.

Undetectable privileged local filesystem replacement remains outside the supported threat model, as it does for the publication source snapshot boundary. Detected changes fail closed.

## Rejected alternatives

- Keep the external `tar` processes and only bound them. The machine-time cost is inherent to one process per member, and no bound makes an untrusted `PATH` entry an acceptable authority on archive contents.
- Read the whole compressed archive into memory, hash it, then parse `Readable.from([bytes])`. This binds the hashed bytes to the parsed bytes, but it abandons the streamed-descriptor boundary and moves the read outside the parser's deadline.
- Accept PAX headers with bounded validation. Real `npm pack` candidates contain none, and accepting them means letting a loose `parseInt` over attacker text redefine a member's size after its header was audited.
- Canonicalize the caller's path instead of refusing a non-canonical one. A symbolic link anywhere in the chain can be repointed between the walk and the open, and every real caller already resolves its own paths.
- Import the schema package's strict JSON parser and portable path identity. Correct in isolation, but it makes provenance validation depend on a build and puts scanner behavior outside what the scanner identity attests.
- Trust `tar-stream` to reject a malformed archive. It accepts too much, and the list is long enough that the raw auditor is cheaper than auditing each future release of the dependency.
- Preserve the phrase "hashes changed before inspection" in the retained-candidate failure. There is no longer an inspection for the check to precede, and a diagnostic that describes a deleted mechanism is worse than none.
