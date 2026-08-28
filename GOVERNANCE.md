# Governance

GENII Publisher is an open source project maintained by GENII Foundation. This
document describes the repository decision process. It does not create a legal
entity, assign intellectual property beyond the repository license, or replace
the CPAL 1.0 terms.

## Project scope

The project owns the generic publication protocol, compiler, Reader runtime,
reference renderer, optional provider adapters, author lifecycle tooling, and
release validation. Publication manuscripts, editorial evidence, credentials,
provider state, deployment history, and publication identity remain with each
author repository.

Changes that move this boundary require an architecture decision before code.
Publication-specific behavior does not become engine policy merely because one
publication needs it.

## Roles

- Contributors propose focused issues and pull requests under
  [CONTRIBUTING.md](CONTRIBUTING.md).
- Maintainers review changes, protect repository boundaries, and decide whether
  a proposal is ready to merge.
- Release reviewers verify the exact tagged source, provenance records, retained
  archives, public attribution surface, and trusted publishing controls.
- Qualified counsel reviews licensing and provenance claims that require legal
  judgment. Automated evidence does not substitute for that review.

Repository permissions identify the people currently assigned to maintainer and
release roles. A role is authority for its stated decision, not permission to
bypass another required review.

## Decisions

Ordinary corrections use a focused pull request with tests and change records.
Protocol meaning, package boundaries, capability authority, security promises,
and migration semantics require an architecture decision under
[`docs/architecture/`](docs/architecture/). A later decision may supersede an
earlier one, but the earlier record remains as history.

The decision record must state the problem, accepted boundary, rejected
alternatives, compatibility effect, and evidence required. Maintainers resolve
technical disagreements through the smallest testable contract. If the dispute
changes licensing, attribution, provenance, credentials, provider state, or
publication ownership, work stops until the responsible reviewer decides it.

## Releases

No individual command grants release authority. A public release requires all of
the following:

1. A clean exact version tag whose package versions agree.
2. Accepted package-affecting provenance records and final byte-bound receipts.
3. Maintainer review and every required counsel review.
4. A deployed attribution and schema surface that matches repository bytes.
5. Trusted npm publishers bound to the reviewed workflow and protected
   `npm-publish` environment.
6. Exact retained archives that pass preparation, reverification, portability,
   and public-surface checks.

The manual release workflow publishes sequentially because npm package versions
are immutable and multi-package publication is not transactional. If any upload
fails, maintainers preserve the retained evidence and stop. They do not rebuild
or replace an accepted version.

## Security

Security reports follow [SECURITY.md](SECURITY.md). Security settings are part of
release governance, not optional repository decoration. The first public release
remains blocked until a private reporting channel and the reviewed repository
security controls exist.

## Changes to governance

A governance change uses a focused pull request and records the change in
`CHANGES.md`. It may clarify process immediately. It may not retroactively grant
release, provenance, legal, migration, database, credential, or deployment
authority.
