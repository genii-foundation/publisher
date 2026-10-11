# 0059. Bounded Reader state projection

Status: accepted

## Context

ADR 0057 introduced a closed Reader state bootstrap whose executable function
body is limited to 32,768 UTF-8 bytes. That boundary is sufficient for migration
logic, but a mature publication can require a much larger committed identity
census to translate historical section, block, and content hashes. Putting that
census into executable source would weaken review, transport, and resource
boundaries.

The translation census is public publication metadata. Private Reader state
still exists only in the browser. The renderer needs a way to deliver the public
mapping before preference prepaint without exposing server configuration or
allowing unbounded work during application creation.

## Decision

Reader state bootstrap API 1.1 adds one optional `createProjection(context)`
method. The adapter returns a plain JSON object. The renderer supplies the same
frozen publication context to `createProjection` and `createSource`, calls each
at most once, and owns this browser envelope:

```json
{
  "buildId": "sha256:reader-build",
  "data": {},
  "engineVersion": "1.0.0",
  "publicationId": "publication-id",
  "schemaVersion": "1.0"
}
```

The renderer snapshots data descriptors without invoking accessors. It rejects
custom prototypes, symbols, sparse arrays, cycles, functions, big integers,
nonfinite numbers, and unpaired Unicode surrogates. Shared objects are counted
and serialized at each occurrence. The data root has depth 1 and counts as one
container. The fixed renderer envelope does not consume the depth, container,
or entry quotas. Snapshot byte accounting and bootstrap source generation use
renderer-captured serialization intrinsics, so projection callbacks cannot
replace the bytes that are counted, hashed, or executed.

The renderer-owned `engineVersion` and Reader `buildId` make this a complete
downstream artifact envelope. An adapter cannot forge those fields. The complete
canonical envelope is limited to 8,388,608 UTF-8 bytes, depth 64,
100,000 object or array occurrences, and 1,000,000 total object properties or
array elements. Serialization counts bytes incrementally and stops at the
boundary. The final inline bootstrap script is independently limited to
16,777,216 UTF-8 bytes because JavaScript string encoding can expand canonical
JSON. The exact script size multiplied by the static route count is limited to
134,217,728 bytes so one projection cannot create unbounded duplicate HTML.

The renderer hashes the exact canonical envelope bytes, including publication,
engine, and Reader build identity. Application manifest
1.2 records projection schema version, byte size, and hash, or literal `null`
when the optional projector is absent. That descriptor contributes to the
application build ID beside adapter package, version, compatibility, API
version, configuration hash, and executable source hash.

The browser receives canonical projection text inside the existing bootstrap
script. The transport escapes HTML parser tokens and JavaScript line separators,
parses with `JSON.parse`, freezes the complete tree, and passes it as the second
ordinary function argument beside the frozen context. It creates no projection
global and writes no projection data into the normalized migration report or
root attributes.

All projection bytes are public. They may contain committed publication-owned
identity and translation tables. They must never contain credentials, tokens,
private Reader state, user identifiers, or values derived from local storage,
cookies, request headers, sessions, or provider configuration.

The host contract advances from 0.16.0 to 0.17.0 because the meaning of the
existing `readerStateBootstrap` input changes even though the generated host file
set does not. The contract migration requires authors with an existing bootstrap
to advance its API from 1.0 to 1.1 before acknowledging the upgrade.

## Compatibility obligations

The projection does not relax ADR 0057. The executable adapter must still
validate private legacy values, preserve every legacy byte, leave an existing
valid Publisher target unchanged, refuse lossy or ambiguous translations, and
remain safe to run again. A projection is translation evidence, not authority to
guess missing identities.

Publication adapters and sanitized full-census fixtures remain author-owned.
Any projection that exceeds a renderer boundary requires an explicit reviewed
contract change. It must never be truncated silently.

## Consequences

Large public translation maps no longer compete with the executable source
limit. Projection changes alter application identity deterministically, while
private browser state stays outside build artifacts, HTML, diagnostics, and
reports.

Applications without a projector retain the same runtime behavior and record a
null projection descriptor. Existing API 1.0 bootstrap adapters must advance to
API 1.1 before use with this renderer.
