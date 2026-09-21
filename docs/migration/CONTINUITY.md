(AI Generated).

# GENII Publisher cross-machine continuity

Updated September 21, 2026. Temporary operational handoff, not a release certificate.
Delete this file only after the full goal is complete and lasting decisions and
evidence have been incorporated into the ordinary project documentation.

## Resume from these branches

- Engine: `genii-foundation/publisher`, `feat/embedded-page-renderer-current`.
- Consumer: `genii-foundation/coherence-thesis`, `feat/publisher-current-adoption`.
- Engine implementation and matrix checkpoint: `06a9e59a02664ed3362fbd69b24774ca7d45ee07`.
- Consumer implementation checkpoint: `4de8baa80e2a4f5cc230c015f71adcab32ec049c`.
- Fetch the latest branch heads. Later handoff-only commits preserve these ancestors.
- Both branches target `main`; draft PRs preserve unfinished work, not merge approval.
- Consumer handoff: https://github.com/genii-foundation/coherence-thesis/blob/feat/publisher-current-adoption/docs/GENII-PUBLISHER-CONTINUITY.md

On September 21 the user explicitly authorized pushing both working branches and
creating their PRs for cross-machine continuation. This overrides the earlier
hold on pushing this candidate. It is not visual acceptance, merge approval,
package publication permission, or permission to deploy or mutate provider state.

## Establish the goal on the destination machine

Create a real persistent goal using the available goal controls, without inventing
a token budget. Verify its state rather than merely writing a plan. Use this objective:

Complete GENII Publisher 1.0 as a separate open-source publishing foundation.
Continuously audit and incorporate current generic Coherence Reader functionality.
Complete the opinionated renderer, named Updates views, narration, offline reading,
optional Supabase synchronization, author lifecycle tooling, provenance, security,
documentation, release validation, and an unrelated second-publication portability
proof. Prepare a reversible Coherence migration using its existing deployment
project. Preserve canonical content, historical evidence, and user work. Do not
create a second Coherence Vercel project. Do not publish packages, merge, deploy,
mutate databases, change credentials, accept provenance records, or change external
security settings without fresh explicit authority. Complete only when the entire
objective is supported by current evidence and required approvals.

The source task was `01a01735-113f-74b3-88ef-7f5aa333cc49`; its goal is blocked,
not completed. New-machine goal state must be established independently. If a
conflicting unfinished goal prevents creation, use supported controls or ask the
user to clear it. Never falsify completion or edit internal application storage.
The old overnight automation is paused and expired. Do not recreate it.

## First actions

1. Locate existing repositories, fetch these exact branches, and verify the two
   checkpoint ancestors. Use durable task worktrees, not primary main or temporary
   directories. If a repository is absent, ask for acquisition/transfer direction.
2. Read root and applicable nested AGENTS.md files and relevant skills.
3. Read this file, the consumer handoff, `2026-09-07-system-audit.md`,
   `coherence-readiness.md`, `coherence-extraction-inventory.md`, and
   `coherence-adoption-plan.md` in this directory. Read ADRs 0058 and 0060 through
   0064, `docs/guides/rehearsing-a-release.md`, and the provenance records.
4. Derive a requirement-by-requirement completion ledger. Separate implementation,
   validation, author acceptance, publication, and deployment. Do not trust old
   prose calling an earlier checkpoint current.
5. Recheck upstream changes and current security advisories. The saved runtime
   results are dated evidence, not a security guarantee for future dependencies.

## Engine checkpoint and evidence

Important commits: `16b2064`, `ca2c55d`, `1bfe5b2`, `b519a20`, `06a9e59`.

- Archive scanning now rejects hidden compressed tails, copied trailers, optional
  gzip metadata, and concatenated/empty-prefix member bypasses. It requires one
  metadata-free member, complete raw DEFLATE consumption, and independent CRC/size
  checks, while preserving existing tar, identity, size, and deadline protections.
- The build-only fast-uri dependency is 3.1.7.
- Next.js is pinned to 16.3.3 and Sharp to 0.35.4. Manifests, overrides, provider
  peer, notices, templates, and runtime assertions agree. Recheck advisories now.
- Host contract 0.19.0 requires an explicit author dependency/lockfile migration.
  Never silently rewrite an existing author's package manifest.
- npm initially retained old Sharp despite the changed override. Check actual
  installed resolution; manifest text alone was insufficient.
- Full local validation with Chrome passed on Node 22.12.0, 24.18.0, and 26.4.0,
  with npm 10.9.0: 1,145 tests, 1,143 passes, two intentional skips, zero failures
  per run. These were macOS runs, not fresh Linux/Windows CI evidence.
- The six-package neutral-publication rehearsal tests install, frozen offline
  reinstall, production build, routes, source preservation, and archive identity.
  A separate packed-host proof tests actual browser behavior. Do not conflate them.
- A fresh source audit at `06a9e59` passed all four records with no unexpected
  matches or package leaks. All records remain draft. Record dates in the audit
  summary are historical fields, not fresh execution timestamps.

`continuity-evidence.json` preserves the structured audit summary and the original
validation-log hashes and totals without copying raw machine-specific logs.
The summary binds the checkpoint above, not subsequent documentation edits.
Raw logs can be regenerated. No accepted provenance receipt was issued.

September 21 handoff verification reran full `npm run validate` on Node 22.12.0
with Chrome enabled: 1,143 passed, two intentional skips, zero failures out of
1,145 tests. The dependency installation audit reported zero vulnerabilities.
This run includes package, second-publication, and browser checks, but is not a
fresh external-source provenance audit or human acceptance. The companion draft
PR is https://github.com/genii-foundation/coherence-thesis/pull/239.
Its September 21 dependency audit reports four vulnerable dependency records
in the older consumer stack. Resolve those before release; see its handoff.

## Reproduce validation and provenance

Use Node 22.12.0 and npm 10.9.0 for the reference toolchain. Resolve executable
paths on the destination machine. The supported runtime matrix also includes
Node 24 and 26. Do not change globally selected runtimes unnecessarily.

- Install the exact lockfile using the pinned npm.
- Run `npm run validate` with `PUBLISHER_NEXT_BROWSER_EXECUTABLE` set to the actual
  installed Chrome path to enable the optional browser proof.
- Run `npm run release:rehearse` for the six-package portability proof when needed.
- Run `npm run provenance:coverage` and `npm run provenance:review`.
- For fresh source scans use `npm run provenance:audit` with its `--summary` mode
  and the recorded source/artifact mappings. Read the command schema first.

Required source authorities are recorded in `provenance/records/`: the Coherence
repository, `https://github.com/node-unicode/unicode-15.1.0`, and
`https://github.com/node-unicode/node-unicode-data`, at their exact recorded refs.
Unicode inputs are `https://www.unicode.org/Public/15.1.0/ucd/UnicodeData.txt`,
`https://www.unicode.org/Public/15.1.0/ucd/NormalizationTest.txt`, and the recorded
license artifact, whose local copy is
`schemas/third-party-licenses/unicode-data-LICENSE.txt`.
Use existing verified inputs where available; otherwise recover and verify their
recorded identities. Do not use arbitrary current revisions or transfer secrets.

## Remaining completion gates

The consumer still uses older `ab4c5733764ee3a24ad9bcbe9bf2d85b61c032ba` package
archives. It has not adopted the repaired engine or host stack. Follow its handoff.

Audit every explicit objective against real consumers and behavior: Reader state,
bookmarks, search, preferences, accessibility, themes, no-JavaScript output,
ordinary/literary Updates, narration/timing, offline lifecycle, optional sync,
author upgrades/recovery, licensing, provenance, and portability. Inventory labels
and passing unit tests alone do not prove full integration or migration parity.

Historical external release checks found draft provenance, missing protected
`npm-publish` environment, a release workflow not present on remote main, unresolved
public schema hosting, unverified npm trusted publishing, and missing repository
security settings. Recheck read-only. Do not fix external configuration without
authorization. Provenance acceptance remains a separate human/legal review gate.

## Operating constraints

Never overlap proofs or mutate source, previews, or generated artifacts while a
proof snapshots that same worktree. Poll live process handles rather than starting
replacement work after an observation timeout. Preserve historical receipts.
No publication prose, private Reader state, credentials, or provider secrets belong
in the engine. Preserve CPAL notices and mandatory persistent attribution.
Checkpoint coherent work. Do not run unchanged passing suites in endless loops.
If no safe meaningful work remains, report the exact approval needed and follow
the goal's blocked-state rules. Never call incomplete work complete.
