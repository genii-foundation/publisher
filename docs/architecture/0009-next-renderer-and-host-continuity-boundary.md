# ADR 0009: Next.js renderer and host continuity boundary

- Status: Accepted
- Date: 2026-07-28

## Context

The reader envelope now supplies a complete, framework-neutral publication projection. GENII Publisher needs one opinionated graphical renderer that proves this protocol can become a real author application without moving publication policy back into each host repository.

Next.js supplies server rendering, metadata, static parameter generation, and a request-time Proxy surface. Its configuration redirect language treats several valid canonical route characters as pattern syntax. A literal plus sign in a destination, for example, cannot both pass Next validation and remain in the exact canonical serialization. Percent encoding that ASCII character would be browser-equivalent but would violate ADR 0006.

Next route matching can also collapse distinct raw path spellings into the same decoded parameters. Encoded ASCII, lowercase percent escapes, and the canonical path may therefore look identical after framework matching. The renderer needs raw request authority before that collapse.

Next exposes one site-wide trailing-slash option, while the publication protocol preserves slash spelling per route. Established publications may validly mix those spellings. The adapter cannot force one global policy without breaking declared-layout support.

Some historical URLs cannot enter the protocol at all. ADR 0006 keeps spaces, percent-encoded ASCII aliases, malformed escapes, and other noncanonical paths out of manifests. Those URLs still need a governed continuity boundary before the renderer.

Themes, Updates adapters, and future extensions also need clear limits. A nominal theme system that can replace the shell or hide required credit is a shell plugin wearing a tasteful hat. An Updates adapter that returns React nodes or metadata has the same problem with more timestamps.

## Decision

The official initial renderer is one package, `@genii-foundation/publisher-next`. The reference author host pins Node.js 22.12.0, npm 10.9.0, Next.js 16.2.12, React 19.2.8, React DOM 19.2.8, TypeScript 7.0.2, `@types/node` 22.20.1, `@types/react` 19.2.17, and `@types/react-dom` 19.2.3. Other supported Node.js major lines remain separate CI lanes. Author repositories use exact versions and commit their lockfile.

The package:

- fully validates one reader envelope before creating an application
- dispatches only from recorded active route targets
- supplies one root page, one required catch-all App Router page with `dynamicParams` set to false, and one engine-owned not-found page
- accepts logical framework route segments with at most one percent-decoding pass
- preserves the canonical ASCII route registry while assigning raw request serialization to Proxy
- preserves trailing-slash authority per route, including mixed policies
- server renders home, work, collection, section, and optional Updates pages
- includes complete manuscript text without client JavaScript
- renders Markdown without raw HTML execution
- retains explicit section and block DOM identities
- lists only published works and collections on the home catalog
- preserves direct routes for unlisted and archived works
- requires an explicit Updates adapter exactly when an Updates route exists
- loads one closed Updates view once during application creation
- validates and freezes the Updates view, hashes it into application identity, and renders its markup and metadata inside the engine
- returns one deterministic application manifest and artifact

Themes are pure data adapters. The first theme API accepts one complete closed token object for colors, font stacks, typography, dimensions, and spacing. The renderer validates contrast and visible layout bounds. Themes cannot replace components, Markdown behavior, the shell, the source link, or the attribution footer.

Updates adapters return plain text and link data. They cannot return React nodes, metadata, scripts, styles, HTML, event handlers, or arbitrary element properties. Internal links must exactly match a declared active route, asset href, redirect source, section reader address, or block reader address. External links must be canonical, credential-free HTTPS URLs.

The fixed footer is renderer owned and appears on every publication page, the engine-owned not-found page, attributed static framework 404 and 500 pages, and the hydrated App Router error boundaries. It displays and links the required GENII Publisher attribution and exposes the publication source URL.

The package exposes client-safe error components only through `@genii-foundation/publisher-next/client`. The host supplies `app/error.tsx`, `app/global-error.tsx`, `pages/404.tsx`, `pages/500.tsx`, `pages/_error.tsx`, `pages/_app.tsx`, and `pages/_document.tsx`. Those files receive one fixed public identity containing the home route, publication identity, attribution, and configured theme. They do not import the reader artifact or server application.

Raw App Router error HTTP shells remain framework-generic before hydration. The user-visible hydrated error boundary contains the persistent linked attribution and source URL. The packed-host proof checks attributed static 404 and 500 HTML, 500 statuses and secret redaction for forced runtime and root-layout failures, and attributed browser chunks that contain no manuscript sentinels. A dedicated Chrome CI job verifies that `app/error.tsx` and `app/global-error.tsx` hydrate into the attributed interface with a visibly rendered source link.

Continuity runs through an engine-owned request handler exported by the thin host as Next.js Proxy. The handler:

- compares exact request path serialization
- applies manifest redirects with their exact status
- preserves incoming queries for internal redirects
- does not copy incoming queries to external origins
- emits exact canonical internal path and query characters without Next pattern rewriting
- allows WHATWG and Next.js URL serialization to canonicalize external destinations without changing their meaning
- owns 308 redirects from noncanonical slash spellings of active routes unless an explicit manifest redirect owns that spelling
- returns an attributed 404 when a browser-equivalent alias uses a noncanonical raw serialization for an active route

The generated Next configuration disables Next URL normalization and automatic slash redirects. It leaves Next's site-wide `trailingSlash` option unset and rejects a host attempt to set it. It enables the Next.js TypeScript CLI checker required by the verified TypeScript 7 toolchain. It rejects `next.config` redirects and rewrites because they could steal publication route or continuity authority. It rejects static export because the documented host contract always includes request-time Proxy continuity. `next.config.mjs` imports route-plan and config factories from the separate `/config` entry because the configuration process cannot import the protected server entry.

The implemented thin-host contract owns 17 engine-facing checked-in files: `publisher.mjs`, `publisher-error-identity.ts`, `app/page.tsx`, `app/[...segments]/page.tsx`, `app/layout.tsx`, `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`, `pages/404.tsx`, `pages/500.tsx`, `pages/_error.tsx`, `pages/_app.tsx`, `pages/_document.tsx`, `proxy.ts`, `next.config.mjs`, `tsconfig.json`, and `next-env.d.ts`. The host's package metadata, lockfile, author configuration, and generated reader artifact are separate. Checking in the verified TypeScript files lets the build prove that it did not mutate host source.

Separating the origin root page avoids the production fallback failure that Next.js 16 exhibits when a closed route set uses a root-level optional catch-all. The declared publication home may use a non-root route and then renders through the catch-all like any other non-root target. The not-found file keeps required attribution on unknown paths. Package resolution is explicit host code. The renderer never dynamically imports a package name from untrusted manifest data.

Historical URLs outside the canonical route grammar use a provider-edge rule owned by the author repository. Such a rule records one exact source, destination, and status outside the publication manifest. Migration tooling may inventory and propose it, but cannot write or deploy it without review. Preview acceptance must prove that the provider executes the rule before Publisher Proxy. Invalid historical spellings never enter reader artifacts or route hashes.

The supported author API is `createPublicationNextApplication` from the `/server` entry. The root entry does not export server APIs, and `/server` imports `server-only`. Next rejects a Client Component that imports it. Low-level route-plan and Next-config factories are available through `/config` for the ordinary Node configuration process. Callers build plans only from an already validated generated reader artifact, keep each plan paired with the same reader build, and place the continuity handler before route rendering. `renderPage` accepts only pages resolved by the same application.

ADR 0008 grants extension capabilities but does not execute them here. Extension renderer slots, client code, routes, and handlers remain later, separately reviewed surfaces.

Next.js 16.2.12 otherwise resolves PostCSS 8.4.31 and optional sharp 0.34.5, which are covered by high-severity advisories [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849), and [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj). Every consuming root copies `PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES` into its own `overrides` field and commits the resulting lockfile because dependency-package overrides do not propagate. The required override resolves PostCSS 8.5.24 and sharp 0.35.3.

The clean packed-host proof performs one clean dependency resolution, a frozen offline `npm ci` reinstall, a production audit with zero vulnerabilities, exact dependency inspection, and real WebP optimization through sharp. This evidence closes the transitive-dependency gate while the exact override remains in force.

## Consequences

Publication repositories remain thin while retaining deployment, content, theme selection, and adapter configuration.

Rendered prose, Updates, not-found content, and attribution work without JavaScript. The initial renderer is tested as a packed dependency inside a clean host.

The Proxy file is a required host interface, not optional plumbing. Major Publisher upgrades may migrate that interface under the governed upgrade workflow.

Per-route slash authority prevents Next's global route policy from forcing unnecessary URL migrations.

Provider-edge continuity remains provider specific, reviewable, and outside framework-neutral artifacts. A migration is incomplete until preview evidence proves those rules execute before Proxy.

Static export is not a supported claim. A later static adapter would need a separate host contract and evidence.

Arbitrary global CSS can still violate a license through unsupported modification. The supported theme API cannot remove attribution, while CPAL supplies the legal obligation for downstream modifications.

The consuming root owns the override and lockfile. An override in this package cannot protect a host because package-manager overrides do not propagate through dependencies.

Raw App Router error responses can expose a generic framework shell before hydration. The graphical attribution contract applies when the client boundary becomes user visible. Static framework 404 and 500 pages carry attribution in their initial HTML.

## Rejected alternatives

- Let every author repository build its own shell. This recreates the coupling the engine exists to remove.
- Import theme or extension packages dynamically from manifest strings. This turns data into installation and execution authority.
- Encode literal ASCII route characters in Next config destinations. This violates the canonical route contract.
- Accept browser-equivalent raw route aliases. This restores multiple public spellings after ADR 0006 removed them.
- Force one global trailing-slash policy. This breaks valid established routes and declared-layout migrations.
- Put invalid historical URL spellings in publication redirects. Those values are outside the protocol and belong to a reviewed provider-edge boundary.
- Permit arbitrary theme CSS in the first API. This makes layout safety and attribution preservation unverifiable.
- Let Updates adapters render React or metadata. That gives an adapter control over the shell and attribution boundary.
- Fabricate an Updates page when no history adapter exists. This invents publication history.
