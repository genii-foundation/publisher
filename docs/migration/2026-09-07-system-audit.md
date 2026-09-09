# Publisher completion audit, September 7, 2026

This audit resumes from Publisher `ab4c573` and Coherence `c1809f6`.
It distinguishes implementation, executable evidence, author acceptance, and
public release. No result here authorizes publication or production changes.

## September 8 security recheck

The complete Node 24.18.0 run against `1bfe5b2` finished with 1,142 passes,
one failure, and two intentional skips. The live production dependency audit
inside the packed-host proof rejected Next.js 16.3.1 and Sharp 0.35.3 for newly
indexed critical and high advisories. The independent six-package publication
rehearsal passed. This is a dependency security failure, not demonstrated Node
24 incompatibility. See `completion-node24-validation.log` for the exact run.

ADR 0064 proposes Next.js 16.3.3, Sharp 0.35.4, and an explicit host contract
0.19.0 dependency migration. The manifests, root overrides, provider peer,
templates, notices, and runtime assertions are updated together. npm initially
retained the old Sharp install despite the new override; a targeted dependency
refresh was necessary. The fresh workspace audit reports zero vulnerabilities.
The first repaired-stack full Node 22 run passes the packed-host Chrome proof
and independent six-package publication rehearsal, with 1,142 passes and one
failure caused by an old 0.18.0 CLI contract assertion. That assertion now
expects the explicit 0.19.0 migration. All 28 focused template and CLI tests pass.
The corrected full Node 24.18.0 run with npm 10.9.0 and Chrome enabled passes
1,143 tests with two intentional skips and zero failures, including the packed
host and unrelated six-package publication. The exact local output is
`next-security-node24-validation.log`. Final full Node 22 and Node 26 matrix
checks remain open. The new source bytes also require a fresh provenance scan;
the earlier receipt candidates cannot establish their source identity. Prior
zero-vulnerability observations are dated history, not perpetual release evidence.

Coherence remains clean at `4de8baa` awaiting local preview review. It has not
adopted these new package bytes. No dependency update here authorizes publication,
deployment, provider mutation, or a production migration.

## Verified baseline

- Fresh upstream fetches leave Publisher main at `22557b4` and Coherence main
  at `20740657`. The existing Coherence capability inventory covers that upstream
  Reader ref. Local migration work is substantially newer and remains unmerged.
- Node 22.12.0 and npm 10.9.0 completed Publisher validation with 1,141 passing
  tests, two skips, and no failures. This run did not enable the optional browser.
- The independent canonical publication installed all six packed packages,
  performed an offline reinstall, built with Next, served its routes, and
  preserved its source bytes. That rehearsal checks server HTML, not hydration.
- A separate packed-host browser harness already exists in
  `packages/next/scripts/packaged-host-proof.mjs`. Its browser path is enabled by
  `PUBLISHER_NEXT_BROWSER_EXECUTABLE`, and the browser CI job supplies it.
  Ordinary local validation alone does not exercise that path.

## Findings and disposition

### Build dependency vulnerability

The original lockfile selected fast-uri 3.1.5 through Ajv. The live npm audit
reported four high-severity advisories affecting that dependency. The schema
compiler uses Ajv at build time; its clean-consumer test explicitly verifies that
Ajv and fast-uri are absent from a production installation. No exploitable
Publisher request path has been established by this finding.

Updated only the fast-uri lock entry to 3.1.7, within Ajv's existing range.
The subsequent npm audit reported zero vulnerabilities. Complete validation of
the updated dependency also passed with Chrome enabled: 1,141 passes, two skips,
and zero failures. The log is local and ignored, `completion-audit-validation.log`.

Reference: [fast-uri maintainer advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc).

### Archive audit tail bypass

Independent code review found that trailer equality did not prove complete gzip
input consumption. A bounded adversarial fixture containing a benign archive,
a zero byte, hidden compressed source, and a copied benign trailer was accepted
by the scanner. The new rejection regression failed before the repair.

A second regression proved that optional gzip comments could also carry
unscanned data. The reader now accepts one metadata-free gzip header, frames off
its fixed header and trailer, and requires a single raw DEFLATE decoder to
consume the complete descriptor-bound framed body. This refuses concatenated
members, including an empty first member hiding a later metadata-bearing member.
The existing trailer CRC and length, raw tar, member, deadline, and size checks
remain intact. Tests cover copied-trailer tails within one input chunk and across
chunk boundaries, optional comments, and empty-prefix member smuggling. This
concerns adversarial archive acceptance, not evidence that any real candidate
contains hidden data.

The repaired reader passes all 74 archive tests on Node 22.12.0, 24.18.0, and
26.4.0. The integrated archive and audit suite passes 79 tests under the exact
npm invocation. Complete browser-enabled validation passes 1,143 tests with two
intentional skips and no failures, including actual package and independent
publication rehearsals. The local log is `archive-repair-validation.log`.

The earlier provenance scan used the earlier scanner. New source-audit evidence
must use the repaired scanner; its separate local output is
`provenance-repaired-scanner-audit.log`. Historical receipt identities are not
rewritten, and neither scan results nor parser fixes accept provenance records.

### Coherence theme proof drift

The saved import-closure repair allows the real Next compiler to finish. The
runtime verifier then exposed an independent stale assertion: it omitted the
21 alternate-palette variables introduced by the accepted theme implementation.
The revised check verifies all seven colors in each of the light, dark, and
black palettes and rejects missing or changed declarations.

The actual build retains five compiled font families and 48 font assets. Its
changed theme stylesheet and application identity need current receipts. Old
offline browser receipts must remain historical until that browser proof is
rerun successfully. Updating a runner digest alone is not browser evidence.

### Remaining acceptance work

1. The existing packed-host browser path is now verified with the updated
   dependency. It initially failed because its one-palette fixture still expected
   a fixed black canvas. The fixture now declares all alternate palettes and
   asserts its distinctive near-black canvas before hydration. Both the focused
   Chrome run and the complete Chrome-enabled validation pass. This exercises
   Reader tools, prepaint, extensions, attribution, and offline behavior without
   changing the production theme contract.
2. Complete Coherence's theme and offline proof refresh, then the full executable
   and browser gates against one frozen candidate.
3. Reconcile current content, route, fragment, narration, state migration, and
   embedded-host limits. The existing proof explicitly does not establish full
   Reader route parity or full content parity.
4. Verify the actual local Reader and admin previews, record exact identity, and
   request author acceptance before any push or migration decision.
5. Recheck provenance acceptance and external release readiness. Draft provenance,
   protected publishing setup, public schema hosting, and security administration
   remain separate gates. Do not convert local tests into release authority.

This is an in-progress audit, not a completion or release certificate.

## Preserved historical theme evidence

The historical offline receipt boundary remains tied to Publisher `4f89852`
and the 230,307-byte theme runner identified in Coherence's existing ledger.
These prior values are preserved here as historical evidence, not current output:

| Field | Historical SHA-256 |
| --- | --- |
| Application | `3264739aa08b6e4b5f8523fd4b516d7c2e8b54af15a457dce00727fd0d1312d3` |
| Application artifact | `4a58e3c67fac313dcd462c4913d3bb5afa79a4c31262ec8ef2ce5987c9d027be` |
| Theme tokens | `a241690a22206464d9948bce0c6d3dd9de3cdfe0cb4f25a96e3fa953384a0845` |
| Compiled CSS | `2e29e06f5ef7fed1b8a9018d771735de9fc06f2324d0fc4ca9e5628101ead9f4` |
| Root style | `40aac74280221113b0ee7f402f2a662cfb3a8278a047666a8710e5e06277b49d` |
| Offline catalog | `10ae79134d117c35b6fd013603b62981768286c763cae40b655fbb821222843f` |

The new theme's exact default Next build passes with application identity
`152211b1cfac21af95376ebbff21e54771128e397206d2142ff9966b82a89eb9`.
Two live observations agreed on its catalog and stylesheet identities. Its
full Coherence offline browser acceptance remains separate and in progress.

Coherence checkpoint `df62bbe9` now passes the isolated Cardinal offline browser
proof with all 90 semantic documents checked sequentially. The unchanged
per-document tree ceiling no longer incorrectly limits the combined publication
tree, and the total cache-byte ceiling remains enforced. Cold offline reading,
search, navigation, rollback, atomic replacement, existing-cache preservation,
runtime artifact preservation, and generated-host cleanup all pass. Browser
evidence is `sha256:1e1a99d4e3cdbff5c7e4ac039328a47715e29c2b64353c04b63c5af723de0383`.
This is isolated-host evidence, not established-host migration acceptance.

The provenance review command still reports four draft records and no accepted
records. That command summarizes recorded scans; it is not a fresh retained-package
source audit and does not approve provenance or release.

A separate fresh `provenance:audit` completed successfully against all four
records after checkpoint `16b2064`. It used existing local source repositories
and Unicode artifacts, without cloning or issuing accepted receipts. Every
scan was clear or an explicitly expected match. The local ignored log is
`provenance-completion-audit.log`. Its record dates remain the original audit
record dates, not the date of this rerun. Human provenance acceptance and release
authorization remain outstanding.

## Fresh external release checks

On September 7, GitHub's read-only API still reports zero environments for
`genii-foundation/publisher` and only the active CI workflow on the remote default
branch. The required protected `npm-publish` environment and release workflow
are not available there. DNS queries for A, AAAA, and CNAME records at
`publisher.genii.foundation` each return NXDOMAIN, and the public-surface verifier
fails to fetch. npm account trusted-publisher settings remain unverified. These
are separate release blockers. No external settings were changed.

The same read-only check confirms private vulnerability reporting is disabled,
as are Dependabot security updates, secret scanning, and push protection. The
security policy's pre-release reporting gate is still open. The repaired archive
regressions use synthetic data and remain local; no exploit details were posted
to an external service.
