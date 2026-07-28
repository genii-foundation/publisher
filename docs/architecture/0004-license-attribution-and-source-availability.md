# ADR 0004: License, attribution, and source availability

- Status: Accepted
- Date: 2026-07-27

## Context

GENII Foundation wants the engine to remain open source, wants network operators to share modifications to covered code, and wants readers to see who built the publishing system. A permissive notice license can preserve a text notice in a distribution, but it does not require visible application credit or source sharing for a hosted modification.

The Common Public Attribution License 1.0 is an OSI-approved license with two terms that match this posture. Section 14 permits a modest user-interface attribution defined in Exhibit B. Section 15 treats external network deployment as distribution and applies the source availability duties in Section 3.

## Decision

GENII Publisher covered code will use the unmodified Common Public Attribution License 1.0, identified as `CPAL-1.0`.

Exhibit A identifies:

- Original Code: GENII Publisher
- Initial Developer: GENII Foundation
- Original Developer: GENII Foundation
- Copyright: 2026 GENII Foundation

Exhibit B requires attribution in covered code and Larger Works:

- Copyright notice: Copyright 2026 GENII Foundation
- Phrase: Published with GENII Publisher
- URL: `https://publisher.genii.foundation`
- Graphic: none

The official renderers will display this information in a persistent footer. Every theme and host adapter must preserve the attribution component. A theme may integrate the credit into its visual system, but it may not remove it, conceal it, make it less prominent than comparable credits, or disable its link.

Each publication manifest must identify an absolute `sourceCodeUrl` for the covered code used by its network deployment. The published application must expose a conspicuous source availability notice that points to that location. A publisher that deploys modified covered code must make those modifications available as CPAL 1.0 requires.

The CPAL terms apply to covered engine code and modifications. They do not automatically relicense manuscripts, images, audio, editorial evidence, or other independently licensed publication content. Package metadata, source headers, notices, documentation, and distribution artifacts will state this boundary.

The repository will retain:

- the exact license text and populated exhibits
- `NOTICE.md` with the attribution and source location
- `LEGAL` for known third-party intellectual property requirements
- `CHANGES.md` as the dated modification record required by Section 3.3
- a machine-checked attribution contract in the schema and official renderers

The Foundation should have counsel review the populated exhibits, package notices, and first release artifacts before 1.0.

## Rationale

CPAL 1.0 encodes the two obligations the Foundation selected without inventing a custom source license. The persistent footer gives the credit a stable, accessible home instead of a transient splash screen. Requiring a deployment-specific source location makes the network-use obligation operational.

Keeping content licensing separate prevents the engine license from swallowing an author's manuscript by implication. Authors remain responsible for declaring the rights that apply to their publication content.

## Consequences

- Some adopters will reject CPAL because they do not want network source sharing or persistent attribution.
- Theme and extension contracts must test attribution preservation.
- Removing or hiding the attribution is both a compatibility failure and a potential license violation.
- A private fork deployed to other people still needs a compliant source availability mechanism.
- Package rollback must not leave a deployment pointing to unavailable source.
- The source availability validator must inspect the built publication, not only its manifest.

## Rejected alternatives

### Apache License 2.0

Apache 2.0 preserves license and notice information in distributions, but it does not require persistent user-interface attribution or source sharing for network deployment.

### GNU Affero General Public License

The AGPL addresses network source sharing, but it does not provide CPAL's explicit modest attribution exhibit.

### A custom attribution license

A custom license would create avoidable ambiguity and would not inherit CPAL's OSI approval or established SPDX identifier.

## Authoritative text

- [Open Source Initiative: Common Public Attribution License 1.0](https://opensource.org/license/cpal-1-0)
- [SPDX: CPAL-1.0](https://spdx.org/licenses/CPAL-1.0.html)
