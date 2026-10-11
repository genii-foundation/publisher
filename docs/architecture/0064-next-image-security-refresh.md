# 0064. Next.js and image dependency security refresh

Status: accepted for local implementation, release approval outstanding

## Evidence

The September 8 packed-host production audit rejects Next.js 16.3.1 and Sharp
0.35.3. The full Node 24 run passes 1,142 tests and fails this security gate,
with two intentional skips. It does not establish a Node-specific runtime bug.

The upstream Next.js advisories identify 16.3.3 as patched for
[Windows-hosted remote execution](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)
and [AVIF image optimization remote execution](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4).
Sharp 0.35.4 addresses the affected libheif dependency.

## Exact stack

Replace only the Next.js 16.3.1 and Sharp 0.35.3 pins from ADR 0058 with
Next.js 16.3.3 and Sharp 0.35.4. Preserve the React, TypeScript, Nano ID,
PostCSS, and supported Node major contracts. The renderer manifest, provider
peer, consuming-root overrides, generated template, notices, and runtime
assertions must agree. Historical validation records retain their old versions.
Host contract 0.19.0 adds an explicit manual dependency and lockfile migration;
it does not silently rewrite an existing author's package manifest.

The packed host must again pass production audit, frozen reinstall, real image
optimization, source preservation, full build, and browser checks. The unrelated
six-package publication rehearsal must pass against the same source candidate.
Full validation on Node 24.18.0 with npm 10.9.0 and Chrome enabled now passes
1,143 tests with two intentional skips and no failures. The packed-host audit,
real image optimization, browser checks, and unrelated six-package rehearsal
all pass. The local log is `next-security-node24-validation.log`.
The preceding Node 22 run passed those same packed and browser proofs but
failed one stale CLI version assertion. All 28 focused template and CLI tests
passed after that assertion was corrected. Final full runs against checkpoint
`b519a20` also pass on Node 22.12.0 and Node 26.4.0, each with 1,143 passes,
two intentional skips, and zero failures. Both enabled Chrome and the
six-package publication rehearsal. The logs are
`next-security-node22-final-validation.log` and
`next-security-node26-validation.log`. This verifies the supported Node major
matrix locally; no cross-platform claim follows from these macOS runs.

Coherence's review candidate is not changed by this engine patch. Adopting the
new package bytes and host dependencies requires a separate local review. No
package publication, provider mutation, merge, or deployment is authorized.
