# 0019. Synchronization provider delegation

Status: accepted

## Context

ADR 0018 reserved stable synchronization routes and made them return an opaque
404 while no provider was configured. The next boundary must let an author
activate a provider without putting credentials in the public synchronization
artifact, letting provider code choose redirects or responses, or giving the
source loader authority to execute host configuration.

`publisher.config.ts` is already the author-owned integration seam. The engine
must never read or rewrite it. The generated Next application may import it as
host code during its own build.

## Decision

Host contract 0.5.0 resolves the internal `genii-publisher:config` module to
`publisher.config.ts` when that file exists. Otherwise it resolves to an
engine-owned empty configuration module. Turbopack receives project-relative
aliases so the same contract works in clean packed hosts.

The protected `/server/sync` entry exports a provider-neutral route contract.
It validates the public synchronization envelope, requires the configured
provider package and capability set to match that envelope, and passes the
provider only frozen publication identity and the incoming request.

The engine owns redirect validation and every public response. A provider may
exchange an authentication code or report a fixed account-deletion outcome. It
cannot return an arbitrary redirect, response body, or status. Cross-origin
deletion is rejected before provider code executes. Provider exceptions collapse
to fixed failure responses without provider detail.

The reference Supabase server adapter reads its URL and keys from the server
environment. Authentication uses the anonymous cookie-scoped client. Account
deletion authenticates the current reader before using the service-role client,
deletes that user, and signs out. Missing or malformed configuration fails
closed. The service-role key never enters a public artifact or provider result.

## Consequences

A publication without synchronization keeps the two opaque dormant routes. A
publication declaring synchronization refuses to start unless its author selects
a matching capable provider. Host configuration remains outside source loading,
lifecycle mutation, and public artifacts.

The default browser sign-in, consent, synchronization, sign-out, and deletion
interfaces remain planned. The reference package remains private until those
interfaces, its legal bundle, packed-consumer proof, provenance, and release gate
are complete.
