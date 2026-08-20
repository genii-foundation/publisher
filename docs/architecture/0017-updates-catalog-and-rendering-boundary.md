# 0017. Updates catalog and rendering boundary

## Status

Accepted on 2026-08-18.

## Context

Publication Updates begin as author history, but a Reader should not need Git,
repository paths, deployment policy, or publication-specific title corrections.
The initial renderer could accept one in-memory adapter view. The generated host
could not configure it, and one anonymous route could not represent Coherence's
ordinary and literary views or their pagination.

Copying Coherence history logic into Publisher would make one publication's path
classification a generic rule. Executing an authoring adapter inside the web host
would also give request-time code authority over a repository concern that should
have ended during the build.

## Decision

The publication manifest may declare an `updates` block with an adapter package
reference and a catalog path. The adapter is provenance data. Publisher does not
resolve or execute it.

An authoring pipeline owns history interpretation and writes a plain catalog. The
catalog names the publication and one or more stable views. Each view contains
plain text entries and safe links. Publisher loads it through the bounded source
loader, validates exact publication and route identities, rejects duplicate or
missing views and entries, and emits a canonical Updates envelope.

The envelope carries the exact Reader build identity, engine version, declared
adapter record, catalog path, and digest of the exact source text. It remains a
separate artifact because Updates can be large and change independently from
Reader prose.

The official Next host imports the envelope on the server. The renderer rejects
an artifact for another publication or Reader build. It loads every named view
once, hashes the full snapshot into application identity, and owns markup,
metadata, navigation, and safe text rendering.

A canonical Updates route owns page one. When a route declares a pagination path
containing `{page}`, the renderer derives pages two through the final bounded
page from catalog length and page size. Generated paths enter the same collision
checked static route plan as Reader routes.

The legacy string route remains supported and maps to view identity `updates`.
Advanced publications use an array of route declarations with stable IDs.

## Consequences

- Author repositories retain Git history, path classification, corrections, and
  durable snapshots.
- Publisher builds are deterministic and need no repository discovery beyond the
  one declared catalog path.
- Generated hosts contain no authoring adapter execution.
- A stale Updates artifact fails before rendering.
- Named views and pagination are portable protocol data, not Coherence defaults.
- Custom in-memory renderer adapters remain available for hosts that deliberately
  provide them, but generated hosts use the materialized envelope.

## Rejected alternatives

### Interpret Git in the engine

This would encode repository conventions, literary classification, and correction
policy as generic publishing semantics.

### Execute the adapter in Next

This would move build-time repository authority into the deployed application and
make a static publication depend on author tooling at request time.

### Put every entry in the Reader envelope

This would make every Reader page carry history data it usually does not need and
would make an Updates-only change alter prose artifact identity.

### Generate page one at a numbered path

This would split canonical authority. The declared canonical route remains page
one, and numbered templates begin at page two.
