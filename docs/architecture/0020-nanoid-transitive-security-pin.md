# 0020. Nano ID transitive security pin

Status: accepted

## Context

The official Next renderer already requires exact consuming-root overrides for
PostCSS and Sharp because dependency-package overrides do not propagate. On
2026-08-18, the production audit reported high-severity advisory
`GHSA-2v37-7h3g-55p8` against Nano ID 3.3.16 beneath the pinned PostCSS 8.5.24
dependency graph. The affected custom generator can loop indefinitely for a zero
size input. Nano ID 3.3.18 fixes the advisory within the compatible major line.

## Decision

`PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES` and this workspace pin Nano ID 3.3.18
beneath Next 16.2.12. The packed-host proof resolves the exact version, performs
an offline frozen reinstall, runs the production audit, and refuses any
vulnerability finding.

## Consequences

Consuming hosts must regenerate and commit their lockfile when adopting host
contract 0.5.0. The override remains mandatory until the pinned Next and PostCSS
graph resolves a nonvulnerable Nano ID without it.
