# Protocol fixtures

These directories model unrelated, invented publications. They exist to prove that GENII Publisher can ingest both its opinionated canonical layout and a declared legacy layout without relying on any particular title, catalog size, route shape, brand, or manuscript structure.

`canonical-field-notes` uses the default roots and manifest names. It also declares a theme, an optional audio adapter, and a `station-index` extension with the single `content.project` grant.

`canonical-tide-tables` proves that Updates remains optional. `canonical-field-notes` supplies one compact legacy Updates route and a plain catalog. `declared-night-dispatch` supplies named ordinary and literary views with paginated routes. The shipped Next renderer serves all three without executing authoring code.

`canonical-structured-essay` declares three durable sections inside one Markdown manuscript. Its work manifest owns IDs, preorder hierarchy, public routes, and continuity while exact block selectors locate section boundaries without deriving identity from headings.

`declared-night-dispatch` moves both catalog roots, changes both manifest templates, and gives one work an irregular repository-relative manifest path. It also declares a `margin-notes` extension with ordered `content.project` and `renderer.slot` grants, plus opt-in sync with a local fallback.

The JSON configuration and structural support files are GENII Publisher fixture code covered by `CPAL-1.0`. Each directory containing JSON has a `SOURCE-NOTICE` because JSON cannot carry the required Exhibit A notice.

The short manuscript and sample asset files are invented fixture content and are separately offered under `CC0-1.0`. The full Creative Commons legal code is in `LICENSE-content`. The content SPDX markers and that license file apply only to the invented material. They must not be treated as engine defaults or production editorial material.
