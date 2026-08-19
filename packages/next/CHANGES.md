# Changes

This file records changes to GENII Publisher covered code as required by CPAL 1.0 Section 3.3. GENII Publisher Next.js renderer is derived directly from GENII Publisher Original Code provided by GENII Foundation. Contributors must append a dated summary. Do not rewrite prior entries.

## 2026-08-18, GENII Foundation

- Advanced the host contract to 0.4.0 with dormant authentication callback and account deletion routes that return an opaque 404 until provider delegation is configured.
- Advanced the host contract to 0.3.0 with a server-side Updates artifact and a sequential migration edge.
- Rendered build-bound named Updates views, expanded bounded pagination into static routes, and kept metadata and navigation renderer owned.

## 2026-08-13, GENII Foundation

- Advanced the host contract to 0.2.0 with a required public destination for the lazy, Reader-build-bound search artifact.
- Declared search as an official renderer data capability and provided the sequential 0.1.0 to 0.2.0 migration edge.
- Added the default responsive Reader rail with section navigation, lazy search, local progress, saved bookmark access, reading preferences, focus treatments, reduced motion, and mobile-safe panels while retaining server-rendered manuscript text.
- Extended the packed host proof to materialize the required search artifact used by the default Reader interface.

## 2026-07-28, GENII Foundation

- Established the official Next.js server-rendered publication adapter.
- Added exact home, work, collection, section, and Updates route dispatch from validated reader targets.
- Kept published catalog visibility separate from direct unlisted and archived routes.
- Added safe server-rendered Markdown, ordinary section and block anchors, accessible navigation, and no-JavaScript manuscript text.
- Added a closed data-only theme contract with strict shape, CSS, contrast, font, and dimension validation.
- Kept the linked GENII Publisher credit and publication source link on publication and engine-owned not-found pages outside theme and Updates control.
- Loaded each closed plain-data Updates view once, validated and froze it, restricted its links to publication authority, and hashed it into application identity before engine-owned rendering.
- Added deterministic renderer application manifests bound to reader, theme, Updates view, and continuity identities.
- Added request-time continuity, per-route canonical slash redirects, and attributed rejection of browser-equivalent raw path aliases through the Next.js Proxy surface.
- Split the origin root page from the closed required catch-all so Next.js prerenders every declared route, including a non-root home and canonical Unicode and literal-plus paths.
- Added an engine-owned not-found page that preserves the required attribution and publication source link.
- Kept raw route serialization in Proxy while allowing one framework-parameter decoding pass after that boundary.
- Rejected conflicting Next routing configuration, site-wide slash policy, and unsupported static export when request-time continuity is required.
- Split browser-safe root exports, protected `/server` APIs, configuration-only `/config` APIs, and client-safe `/client` error components.
- Added the complete 17-file renderer integration with checked-in TypeScript configuration and a no-source-mutation build proof.
- Added public-only error identity, App Router error boundaries, and attributed Pages Router 404, 500, and framework fallbacks.
- Added packed thin-host build, export, static HTML, redirect, canonical-alias rejection, runtime failure, and byte-identical rebuild proofs.
- Required consuming roots to copy the exact PostCSS 8.5.24 and sharp 0.35.3 override, commit the lockfile, and reinstall with `npm ci`.
- Proved zero production audit findings, exact patched dependency resolution, loaded libvips, and actual WebP optimization in the clean packed host.
- Proved that Client Components cannot import the server entry and that attributed browser error chunks contain no manuscript text.
- Proved attributed static 404 and 500 HTML, forced runtime and root-layout 500 responses without secret leakage, and attributed hydration of both App Router error boundaries in Chrome.
- Made Exhibit B values renderer owned at runtime, added a branded client-safe error identity validator, removed the raw continuity constructor from the public server entry, and kept a linked canonical source fallback for invalid low-level callers.
- Required release through an exact provenance-attested tarball and rejected direct package-directory publication.
- Added the versioned renderer-owned host contract behind a ./host export, with a contract version independent of the package version, and made the packaged host proof consume it instead of carrying its own copies of the host files.
