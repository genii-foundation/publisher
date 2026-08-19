# 0018. Dormant synchronization route surfaces

Status: accepted

## Context

Synchronization needs an authentication callback and an account deletion route.
Their public paths belong to the application contract, but host initialization
does not know whether a later publication will enable synchronization. ADR 0015
therefore requires both surfaces in every official host and requires them to fail
closed when no provider is configured.

The reference Supabase package currently supplies database migrations only. It
does not yet supply server handlers, credentials, or a validated delegation
interface. Generating provider-specific behavior now would claim authority the
host contract does not have.

## Decision

Host contract 0.4.0 always generates these route modules:

- `app/auth/callback/route.ts`
- `app/api/account/route.ts`

The dormant routes return the same opaque JSON 404. They do not read query
parameters, cookies, environment variables, provider packages, or the public
synchronization envelope. They expose no provider name or configuration state.

This checkpoint fixes route ownership and upgrade continuity only. A later host
contract may replace the dormant implementations with validated provider
delegation. That change must preserve the paths, keep configuration server only,
check same-origin account deletion before invoking provider code, and retain the
dormant response when synchronization is absent.

## Consequences

Initialization remains publication independent. Enabling synchronization later
does not add new public paths. A publication without synchronization gains no
live authentication or deletion endpoint.

Provider delegation, session handling, privileged account deletion, and the
default synchronization interface remain planned. No database or credential is
touched by this contract.
