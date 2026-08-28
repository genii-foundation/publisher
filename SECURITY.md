# Security policy

## Supported versions

GENII Publisher has no public package release yet. The current
`0.1.0-alpha.0` workspace is a release candidate, not a supported production
version. Supported version ranges and security update policy will be recorded
here before the first public release.

## Reporting a vulnerability

Do not put exploit details, credentials, private publication data, or an
unpatched vulnerability in a public issue.

GitHub private vulnerability reporting is the intended repository channel. It
must be enabled before the first public release. Until it is enabled, contact a
repository maintainer through an already established private channel and share
only enough information to establish a secure reporting path. If no private
channel exists, do not disclose sensitive details publicly.

A useful report identifies the affected package and exact version, the smallest
reproduction, the security boundary crossed, expected and actual behavior, and
whether publication content, credentials, browser state, provider state, or
release archives may be exposed. Remove real secrets and author material from
the reproduction.

Maintainers should acknowledge a private report, preserve the original evidence,
classify the affected boundary, and coordinate a fix and disclosure. This policy
does not promise a response deadline while the project has no supported public
release.

## Scope

Security-sensitive project surfaces include:

- source loading, realpath containment, package resolution, and artifact
  materialization
- Reader browser storage, offline caches, service workers, and optional
  synchronization
- extension grants, server slots, routes, handlers, and client mounts
- release provenance, package archives, trusted publishing, public schemas, and
  source availability
- the official Next.js host contract and required consuming-root dependency
  overrides

Author manuscripts, credentials, databases, deployment accounts, and provider
state belong to the publication repository or provider. A report may concern an
engine defect that affects those assets, but this repository must not receive
their real contents or credentials.

## Repository controls

On 2026-08-28, GitHub reported private vulnerability reporting, Dependabot
security updates, secret scanning, and push protection as disabled for the public
repository. This dated observation can become stale. Recheck it immediately
before release. Enabling or changing repository security settings is an external
administrative action and requires explicit authority.

The release remains blocked while no private vulnerability reporting channel
exists. A clean dependency audit does not waive that gate.
