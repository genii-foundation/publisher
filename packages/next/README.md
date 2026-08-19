# `@genii-foundation/publisher-next`

This package is the opinionated Next.js reference renderer for GENII Publisher. It turns one validated reader envelope into server-rendered publication pages, exact route resolution, an immutable application identity, data-only themes, and request-time continuity redirects.

The package is prerelease software. Its API may change before 1.0 through explicit versioned migrations.

## Boundary

The renderer owns:

- the publication shell, safe Markdown renderer, ordinary HTML anchors, adjacent heading actions, and accessible table regions
- home, work, collection, section, and optional Updates page resolution
- the persistent linked GENII Publisher footer and publication source link
- one closed theme-token API
- exact redirect status, exact internal path and query behavior, and semantically equivalent external destinations through Next.js Proxy
- canonical trailing-slash redirects
- deterministic application-manifest identity

A theme can change validated colors, fonts, dimensions, and spacing. It cannot replace the shell, manuscript renderer, source link, or attribution footer. The renderer ships local Reader state, lazy default narration playback, optional provider-neutral synchronization, two engine-owned server extension slots, one isolated client extension mount, declarative extension pages, and closed extension request handlers. It does not claim static export support.

Progress and complete bookmark documents share one publication-scoped reactive
store. Its atomic updater always sees the latest in-memory snapshot. Same-tab
writers notify each other directly, native storage events converge separate
tabs, and canonically equal replacements cause no write or render churn. A
stable empty server snapshot preserves hydration, while unavailable browser
persistence leaves the current tab's in-memory reading state usable.

The root layout applies one bounded, publication-scoped preference document
before body paint. It accepts only the complete Reader preference schema and
the renderer's closed value policy. Invalid or unavailable storage leaves the
server defaults untouched. The hydrated Reader then parses the same document
through the framework-neutral contract and owns every later change. See
[ADR 0055](../../docs/architecture/0055-reader-preference-prepaint.md).

Passage selection and bookmark markers share one renderer text coordinate
system. It excludes adjacent controls and status text from canonical manuscript
offsets and measured rectangles, while leaving those controls available to
assistive technology. Marker geometry therefore remains stable as transient
Reader interface text changes.

The default Listen panel fetches the build-bound narration envelope only when a
reader opens it. One persistent media element supplies play, pause, seek, bounded
speed, remembered voice choice, 15-second back and forward jumps, previous and
next movement, and automatic queue continuation. Playback attempt identity keeps
an older rejected play promise from changing a newer clip's state. It joins
section identities to the lazy progress catalog for human
titles and canonical destinations, while exact duration and coverage remain
honest when clips omit duration. Closing the panel does not destroy playback.
When a clip declares timings, playback starts before one bounded sidecar request.
The result must match the exact clip and spoken-text profile before it can mark
an existing server-rendered word. No duplicate manuscript text is introduced,
and timing failure cannot stop audio or reading. The client export offers a
cancelable, publication-bound section playback request. The player consumes it
only after the requested section and destination exactly match the selected
voice and lazy build-bound progress catalog. A root-layout provider owns the
media element and open panel while each routed rail controls that persistent
state. Playback therefore survives current-section and cross-route Next.js
navigation. Ordinary link behavior wins when the player cannot consume the
request.

The Offline panel downloads one complete immutable package per work. Each
package includes its publication documents, lazy Reader data, assets, discovered
Next.js dependencies, and every declared narration clip and timing sidecar. The
browser stages and verifies a replacement before switching one active metadata
record, so failure leaves the previous complete version usable. A work without
narration remains a complete text package. The service worker is registered only
after an explicit download. It leaves API, authentication, and framework flight
requests alone, uses network-first document and asset delivery, and falls back
to the active package before the runtime cache. Disconnected links request full
documents. Public search is limited to installed works, local bookmarks remain
available, and cached audio uses temporary revoked blob URLs for reliable media
playback. See [ADR 0046](../../docs/architecture/0046-atomic-offline-publication-packages.md).

## Supported toolchain

The reference author host pins the complete renderer toolchain. Do not use version ranges in a publication repository.

```json
{
  "private": true,
  "type": "module",
  "engines": {
    "node": "22.12.0",
    "npm": "10.9.0"
  },
  "packageManager": "npm@10.9.0",
  "overrides": {
    "next@16.2.12": {
      "postcss": "8.5.24",
      "sharp": "0.35.3"
    }
  },
  "dependencies": {
    "@genii-foundation/publisher-next": "0.1.0-alpha.0",
    "next": "16.2.12",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@types/node": "22.20.1",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "typescript": "7.0.2"
  }
}
```

The package also accepts Node.js 24 and 26 through its declared engine range, and CI verifies those major lines. Node.js 22.12.0 and npm 10.9.0 are the exact reference-host pins.

The `overrides` object is mandatory. Package-manager overrides declared by a dependency do not propagate into the consuming root. Copy `PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES` from the installed renderer into the root `package.json`, regenerate the root lockfile, inspect the diff, and commit it. The clean-host proof generates that lockfile from one clean resolution, reinstalls it offline with `npm ci`, resolves Nano ID 3.3.18, PostCSS 8.5.24, and Sharp 0.35.3 beneath Next.js 16.2.12, produces a real WebP through Next Image Optimization, and reports zero production vulnerabilities. An engine upgrade that changes this exported object is a host migration, not a casual dependency bump.

## Thin host

Create one module that loads the generated reader artifact and resolves the application. Package names are imported explicitly. The renderer never imports a package name found in untrusted manifest data.

This minimal resolver assumes that the reader has no Updates route. A reader with an Updates route must pass the adapter shown below.

```js
// publisher.mjs
import {
  createPublicationNextApplication,
} from "@genii-foundation/publisher-next/server";
import reader from "./.publisher/reader/publication-reader.json" with {
  type: "json",
};

const result = await createPublicationNextApplication({ reader });

if (!result.valid) {
  throw new Error(JSON.stringify(result.diagnostics, null, 2));
}

/** @type {import("@genii-foundation/publisher-next/server").PublicationNextApplication} */
export const publisher = result.value;
```

`@genii-foundation/publisher-next/server` is protected by the `server-only` marker. The package root does not export application creation or any other server API. Importing the server entry from a Client Component fails the Next build, and importing it as an ordinary Node module outside the supported Next server condition fails closed.

Give the origin root route its own page. A root-level optional catch-all does not reliably prerender a closed route set in Next.js 16. This wrapper renders whichever declared target owns `/`. The publication home route may remain non-root and will then render through the required catch-all.

```tsx
// app/page.tsx
import { publisher } from "../publisher.mjs";

export const generateMetadata =
  publisher.generateRootMetadata;

export default publisher.RootPage;
```

Use one required catch-all App Router page for every non-root route. Keep `dynamicParams` as the literal `false`.

```tsx
// app/[...segments]/page.tsx
import { publisher } from "../../publisher.mjs";

export const dynamicParams = false;
export const generateStaticParams =
  publisher.generateStaticParams;
export const generateMetadata = publisher.generateMetadata;

export default publisher.Page;
```

The page boundary accepts the framework's logical route segments and performs at most one percent-decoding pass. It is not the authority for raw public URL spelling. Proxy inspects the raw request path before Next.js can collapse browser-equivalent spellings onto the same route parameters.

Use the engine layout and structural stylesheet.

```tsx
// app/layout.tsx
import "@genii-foundation/publisher-next/styles.css";
import type { Viewport } from "next";

import { publisher } from "../publisher.mjs";

export const viewport: Viewport = {
  initialScale: 1,
  width: "device-width",
};

export default publisher.RootLayout;
```

Use the engine-owned not-found page. It keeps the source link and required attribution on unknown routes.

```tsx
// app/not-found.tsx
import { publisher } from "../publisher.mjs";

export default publisher.NotFoundPage;
```

Supply one public, manuscript-free identity for every framework error surface. The generated host reads publication identity from `publication-public-identity.json` and configures the same explicit theme module as the server application. It never imports the Reader artifact, manuscript data, provider configuration, or the server entry into a client error boundary.

```ts
// publisher-error-identity.ts
import {
  createPublisherNextErrorIdentity,
} from "@genii-foundation/publisher-next/client";
import theme from "genii-publisher:theme";
import publicIdentity from "./publication-public-identity.json" with { type: "json" };

const configuredTheme = theme.implementation.configure(theme.config);

if (!configuredTheme.valid) {
  throw new Error(JSON.stringify(configuredTheme.diagnostics));
}

const identity = createPublisherNextErrorIdentity({
  homePath: publicIdentity.homePath,
  publication: publicIdentity.publication,
  theme: configuredTheme.value
});

if (!identity.valid) {
  throw new Error(JSON.stringify(identity.diagnostics));
}

export const publisherErrorIdentity = identity.value;
```

`genii-publisher build` derives the versioned public identity artifact from the validated Reader. Its build ID is the exact Reader build ID. The client-safe factory rejects changed attribution, missing or unsafe source URLs, malformed home routes, and invalid theme tokens. Build and status track this artifact separately, so a publication cannot update its Reader while quietly retaining an old error identity.

Expose the client-safe App Router error boundaries:

```tsx
// app/error.tsx
"use client";

import {
  PublisherNextErrorPage,
  type PublisherNextErrorBoundaryProps,
} from "@genii-foundation/publisher-next/client";

import {
  publisherErrorIdentity,
} from "../publisher-error-identity";

export default function ErrorBoundary(
  props: PublisherNextErrorBoundaryProps,
) {
  return (
    <PublisherNextErrorPage
      {...props}
      identity={publisherErrorIdentity}
    />
  );
}
```

```tsx
// app/global-error.tsx
"use client";

import {
  PublisherNextGlobalErrorPage,
  type PublisherNextErrorBoundaryProps,
} from "@genii-foundation/publisher-next/client";

import {
  publisherErrorIdentity,
} from "../publisher-error-identity";

export default function GlobalErrorBoundary(
  props: PublisherNextErrorBoundaryProps,
) {
  return (
    <PublisherNextGlobalErrorPage
      {...props}
      identity={publisherErrorIdentity}
    />
  );
}
```

Next.js also requires the Pages Router framework fallbacks below. The 404 and 500 files produce attributed static HTML. The generic `_error` file covers the remaining Pages Router framework path.

```tsx
// pages/404.tsx
import {
  PublisherNextFrameworkErrorPage,
} from "@genii-foundation/publisher-next/client";

import {
  publisherErrorIdentity,
} from "../publisher-error-identity";

export default function FrameworkNotFound() {
  return (
    <PublisherNextFrameworkErrorPage
      identity={publisherErrorIdentity}
    />
  );
}
```

```tsx
// pages/500.tsx
import {
  PublisherNextFrameworkErrorPage,
} from "@genii-foundation/publisher-next/client";

import {
  publisherErrorIdentity,
} from "../publisher-error-identity";

export default function FrameworkServerError() {
  return (
    <PublisherNextFrameworkErrorPage
      identity={publisherErrorIdentity}
    />
  );
}
```

```tsx
// pages/_error.tsx
import {
  PublisherNextFrameworkErrorPage,
} from "@genii-foundation/publisher-next/client";

import {
  publisherErrorIdentity,
} from "../publisher-error-identity";

export default function FrameworkError() {
  return (
    <PublisherNextFrameworkErrorPage
      identity={publisherErrorIdentity}
    />
  );
}
```

Load the renderer stylesheet for those Pages Router fallbacks and supply their document shell:

```tsx
// pages/_app.tsx
import "@genii-foundation/publisher-next/styles.css";
import type { AppProps } from "next/app";

export default function PublisherPagesApp({
  Component,
  pageProps,
}: AppProps) {
  return <Component {...pageProps} />;
}
```

```tsx
// pages/_document.tsx
import {
  Head,
  Html,
  Main,
  NextScript,
} from "next/document";

import {
  publisherErrorIdentity,
} from "../publisher-error-identity";

export default function PublisherDocument() {
  return (
    <Html lang={publisherErrorIdentity.publication.language}>
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
```

Expose the continuity handler through the Next.js 16 Proxy convention. This route-time layer exists because the Next config redirect language cannot emit every canonical GENII Publisher path exactly.

```ts
// proxy.ts
import { NextResponse, type NextRequest } from "next/server";

import { publisher } from "./publisher.mjs";

export async function proxy(request: NextRequest) {
  return (await publisher.handleRequest(request)) ?? NextResponse.next();
}
```

Apply the route policy in the Next configuration.

```js
// next.config.mjs
import reader from "./.publisher/reader/publication-reader.json" with {
  type: "json",
};
import {
  createPublisherNextConfig,
  createPublisherNextRoutePlan,
} from "@genii-foundation/publisher-next/config";

const plan = createPublisherNextRoutePlan(reader);

if (!plan.valid) {
  throw new Error(JSON.stringify(plan.diagnostics, null, 2));
}

export default createPublisherNextConfig(plan.value);
```

`next.config.mjs` runs outside the React Server Component condition, so it must use the separate `/config` entry. That entry exposes only route-plan and Next-config construction. It assumes the same generated and already validated reader artifact used by the server application, and it does not repeat complete reader-envelope validation.

Check in the TypeScript configuration used by the packed-host proof:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "incremental": false,
    "module": "esnext",
    "esModuleInterop": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "plugins": [{ "name": "next" }]
  },
  "include": [
    "next-env.d.ts",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts",
    "**/*.ts",
    "**/*.tsx"
  ],
  "exclude": ["node_modules"]
}
```

Check in the corresponding Next declaration file:

```ts
// next-env.d.ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
/// <reference types="next/navigation-types/compat/navigation" />
import "./.next/types/routes.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

The complete renderer integration contains 17 checked-in engine-facing files: `publisher.mjs`, `publisher-error-identity.ts`, `app/page.tsx`, `app/[...segments]/page.tsx`, `app/layout.tsx`, `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`, `pages/404.tsx`, `pages/500.tsx`, `pages/_error.tsx`, `pages/_app.tsx`, `pages/_document.tsx`, `proxy.ts`, `next.config.mjs`, `tsconfig.json`, and `next-env.d.ts`. The host's `package.json`, lockfile, author configuration, and generated reader artifact are separate from this count.

The generated configuration enables Next.js's TypeScript CLI checker because the verified renderer toolchain uses TypeScript 7. It preserves other compatible `experimental` settings. It rejects attempts to disable the checker, set Next's site-wide `trailingSlash` option, define author-level redirects or rewrites, or enable static export. Publisher preserves each declared route's slash spelling through Proxy rather than forcing one site-wide policy.

The generated application artifact is available as `publisher.artifact`. Author tooling writes its exact text to `.publisher/renderers/next/application.json`. Rendering and validation do not write source files.

## Routes and catalog visibility

The renderer dispatches only from validated reader route targets. It does not infer routes from filenames or titles.

The home catalog lists published works and collections. Unlisted and archived works remain available at their declared direct routes. Preview reader envelopes may also render draft routes, but public reader envelopes omit drafts before this package receives them.

Every work route contains the server-rendered manuscript. Section routes render focused sections with ordinary DOM IDs and adjacent-section navigation. Reader text remains available without client JavaScript.

Addressable manuscript headings keep their exact server-rendered level, text,
block identity, and DOM anchor. After hydration, one adjacent button copies the
canonical absolute heading URL and reports success or failure without becoming
part of the heading text. The button remains hidden without JavaScript.

An adapter-classified `table` block with bounded pipe syntax, one header row,
and one delimiter row renders as a named, keyboard-focusable horizontal region.
Column headers retain `scope="col"`, cell alignment follows the delimiter, and
inline content uses the same safe Markdown, focus, narration, link, image, and
HTML refusal behavior as other blocks. Malformed or unequal rows remain ordinary
manuscript text. The author adapter owns the plain block text used by search and
narration. See [ADR 0047](../../docs/architecture/0047-accessible-manuscript-extensions.md).

Validated `block-markdown` source links become ordinary anchors in manuscript blocks and normalized heading content. Semantic relationships remain reader data and do not become visible links. Application creation fails when a source range crosses Markdown structure or otherwise cannot be represented without changing the manuscript.

## Themes

The bundled default theme accepts optional `mode` and `accent` configuration.

```js
import {
  resolveDefaultPublisherNextTheme,
} from "@genii-foundation/publisher-next/theme/default";

const theme = resolveDefaultPublisherNextTheme({
  mode: "dark",
  accent: "#76D3EA",
});
```

Custom theme packages return the complete closed token shape. The renderer rejects extra fields, accessors, mutable aliases, invalid CSS values, unreadable contrast, incompatible version ranges, and dimensions that could collapse the publication surface.

Theme API 2.0 requires the theme to declare the ordered Reader font choices and
their default. Themes written for API 1.0 must add this policy and update their
adapter version before use.

A separately published theme package can expose this complete adapter:

```ts
import {
  validatePublisherNextThemeInstance,
  type PublisherNextTheme,
  type ResolvedPublisherNextTheme,
} from "@genii-foundation/publisher-next/theme";

const implementation: PublisherNextTheme = {
  kind: "genii.publisher.next-theme",
  apiVersion: "2.0",
  configure() {
    return validatePublisherNextThemeInstance({
      tokens: {
        color: {
          canvas: "#F7F4ED",
          surface: "#FFFFFF",
          text: "#182326",
          mutedText: "#4C5A5E",
          accent: "#005A6E",
          focus: "#8A3500",
          border: "#C5CDCE"
        },
        typography: {
          bodyFamily: "Charter, Cambria, serif",
          headingFamily: "Avenir Next, Segoe UI, sans-serif",
          monoFamily: "SFMono-Regular, Consolas, monospace",
          baseSize: "1.0625rem",
          lineHeight: 1.72,
          defaultReaderFontFamilyId: "serif",
          readerFontFamilies: [
            {
              id: "serif",
              label: "Serif",
              family: "Charter, Cambria, serif"
            },
            {
              id: "field-sans",
              label: "Field sans",
              family: "Avenir Next, Segoe UI, sans-serif"
            }
          ]
        },
        layout: {
          readingMeasure: "68ch",
          pageGutter: "1.25rem",
          sectionGap: "3rem",
          controlRadius: "0.375rem"
        }
      }
    });
  }
};

export const theme: ResolvedPublisherNextTheme = {
  package: "@example/publisher-theme",
  version: "1.0.0",
  rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
  config: {},
  implementation
};
```

The host imports that package explicitly and passes `theme` to `createPublicationNextApplication`. Manifest package strings remain identity data, never import authority.

The generated host provides the bundled theme by default. Select the separately
installed package in author-owned host code:

```js
// publisher.theme.mjs
export { theme as default } from "@example/publisher-theme";
```

The lifecycle never creates or rewrites this file. Next resolves it through the
closed `genii-publisher:theme` host alias, and both the server application and
client-safe error identity use the same adapter. A custom theme package must be
browser safe because its configuration function also runs in client error
chunks.

## Extensions

The official renderer implements `renderer.slot` through two fixed server
slots, `page.before-main` and `page.after-main`. It implements
`renderer.client` through one fixed `page.client` mount after both server slots.
All three sit inside the engine-owned `main` element and before the required
attribution footer. The not-found and framework error surfaces do not invoke
extensions.

Install an extension package explicitly and register it in author-owned host
code:

```js
// publisher.extensions.mjs
import extension from "@example/publication-extension";

export default Object.freeze([extension]);
```

The manifest package string is provenance, never import authority. The generated
host loads `publication-extensions.json`, imports the author registry through
`genii-publisher:extensions`, and passes both to
`createPublicationNextApplication`. The renderer verifies exact publication,
Reader build, registry order, package, version, grants, artifact hash, adapter
API, and compatibility before rendering.

A slot adapter receives only its slot name, page kind and path, public
publication identity, optional work and section identity, and its own
build-projected `serverData`. It never receives manuscript blocks, the Reader
envelope, source evidence, another extension's data, provider configuration, or
shell authority. The renderer wraps output in an engine-owned `aside` naming the
extension and slot.

A client adapter is an explicitly imported Client Component reference on the
same renderer object:

```js
// client.js
"use client";

export function Client({ clientData, mount, page }) {
  return <button type="button">{clientData.label}</button>;
}
```

The engine mounts it only with a `renderer.client` grant. It receives
`page.client`, the same narrow page context as server slots, and only its own
build-projected `clientData`. It never receives `serverData`, manuscript blocks,
the Reader envelope, another extension's data, provider configuration, or shell
authority. An engine-owned wrapper names the extension and mount. An engine-owned
client error boundary replaces a failed extension with a small unavailable
message while preserving the manuscript and attribution.

Browser projection data is public data. It may be serialized into server HTML
and the React transport, but it is not compiled into the extension package.
The packed proof requires the client module in browser chunks, keeps both
projection sentinels out of those static chunks, hydrates a real interaction,
and contains a deliberate client failure.

With a `host.route` grant, the extension implementation may project an ordered
list of canonical public page descriptors during the Publisher build. The
official Next registration must also provide a compatible `host` adapter:

```js
host: {
  kind: "genii.publisher.next-host-extension",
  apiVersion: "1.0",
  rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
  renderRoute({ page, serverData }) {
    return <StationIndex data={page.data} station={serverData} />;
  },
}
```

The route projector receives only public publication identity, its own config
and payloads, and its own server projection when separately granted. The host
adapter receives only the issued immutable extension page and its own optional
server data. Publisher owns the canonical path, metadata, static parameters,
slash continuity, heading, shell, error surfaces, slots, client mount, and
required attribution. Route data is server data and is not sent to client
extension props.

With a `host.handler` grant, the build implementation projects exact request
descriptors inside `/api/extensions/<extension-id>`:

```js
implementation: {
  kind: "genii.publisher.extension",
  apiVersion: "1.0",
  handlers() {
    return {
      valid: true,
      diagnostics: [],
      value: [{
        id: "callback",
        path: "/api/extensions/station-index/callback",
        methods: ["POST"],
        data: { operation: "refresh" },
      }],
    };
  },
}
```

The compatible official host adapter supplies `handleRequest`:

```js
host: {
  kind: "genii.publisher.next-host-extension",
  apiVersion: "1.0",
  rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
  async handleRequest({ handler, request, serverData }) {
    const payload = await request.json();
    return Response.json({
      operation: handler.data.operation,
      publicationId: serverData.publicationId,
      received: payload,
    });
  },
}
```

Publisher matches the pathname exactly, enforces the declared methods, and
reads at most 1,048,576 request body bytes before invoking the adapter. The
adapter receives a detached standard Request, its immutable descriptor, and
only its own optional server projection. It must return a standard Response.
Thrown values, invalid responses, and framework control headers become a generic
`500` without exposing the private failure. Unmatched paths fall through to the
host.

Capability grants decide which documented interface Publisher invokes, but
they do not sandbox explicitly imported JavaScript.

## Updates

If the reader declares an Updates route, the host must supply either one compatible Updates adapter or a validated Updates envelope bound to that Reader build. Supplying both is an error. The generated host uses the envelope written by the Publisher build, so no authoring adapter executes inside Next. GENII Publisher never fabricates publication history.

Each named view is loaded once while the application is created. GENII Publisher validates and freezes the result, hashes all views into `manifest.updates.viewHash` and the application build identity, then renders every element itself. A declared pagination template expands into static pages from page two onward, while the canonical route owns page one. Repeated page renders reuse the snapshot. Adapters cannot return React nodes, metadata, scripts, styles, HTML, event handlers, or arbitrary element properties. Text that resembles markup remains escaped text.

```ts
import type {
  ResolvedPublisherNextUpdates,
} from "@genii-foundation/publisher-next/server";

export const updates: ResolvedPublisherNextUpdates = {
  package: "@example/publication-updates",
  version: "1.0.0",
  rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
  config: {},
  implementation: {
    kind: "genii.publisher.next-updates",
    apiVersion: "1.0",
    configure() {
      return {
        valid: true,
        diagnostics: [],
        value: {
          async load(page) {
            return {
              title: "Updates",
              description: `Publication history for ${page.publication.title}.`,
              emptyMessage: "No updates have been published.",
              entries: [
                {
                  id: "release-2026-07-28",
                  title: "Initial release",
                  summary: "Published the first reader edition.",
                  publishedAt: "2026-07-28",
                  href: page.path,
                },
              ],
            };
          },
        },
      };
    },
  },
};
```

The view accepts `title`, optional `description`, optional `emptyMessage`, and a dense `entries` array. Each entry accepts a unique `id`, `title`, optional `summary`, optional ISO date or canonical UTC `publishedAt` value, and optional `href`. An internal `href` must exactly match a declared active route, asset href, redirect source, section reader address, or block reader address. External links must be canonical, credential-free HTTPS URLs. The renderer rejects extra fields and malformed values before producing markup. Page metadata remains engine owned.

Pass the resolved adapter explicitly:

```js
const result = await createPublicationNextApplication({
  reader,
  theme,
  updates,
});
```

Generated hosts instead pass the materialized envelope as `updatesData`. Its
publication and Reader build identities must match exactly.

## Continuity

`publisher.handleRequest` performs three exact operations before route rendering:

- manifest-declared redirects with their exact 301, 302, 307, or 308 status
- 308 redirects from the noncanonical trailing-slash spelling of each active non-root route, unless an explicit manifest redirect owns that spelling
- attributed 404 responses for browser-equivalent aliases whose raw serialization differs from an active canonical route

Internal redirects preserve the exact canonical destination path and the incoming query. External redirects do not copy an incoming query to another origin. Their `Location` header is semantically equivalent to the manifest destination, but WHATWG and Next.js URL serialization may normalize host case, default ports, and dot segments. The generated Next config disables Next URL normalization and automatic slash redirects so the Publisher handler retains authority over incoming publication paths.

Author-defined `next.config` redirects are rejected in this initial boundary because Next executes them before Proxy. Canonical redirect sources belong in the publication manifest.

Historical URLs outside the canonical route grammar cannot enter that manifest. Spaces, percent-encoded ASCII aliases, malformed escapes, and other forbidden spellings belong to a governed provider-edge configuration in the author repository. That configuration must record an exact source, destination, and status; run before Publisher Proxy; and pass preview acceptance tests proving the provider's execution order. Migration tooling may inventory and propose these rules, but it must not silently add them or smuggle invalid paths into reader data.

## Low-level server API

The supported author integration is `createPublicationNextApplication` from `@genii-foundation/publisher-next/server`. The root entry contains browser-safe constants and theme APIs, but no server APIs. The `/server` entry also exports route-plan and Next-config factories for server adapters and focused tests. It imports `server-only`, so Client Components cannot cross that boundary.

`next.config.mjs` must import `createPublisherNextRoutePlan` and `createPublisherNextConfig` from `@genii-foundation/publisher-next/config`, not from `/server`. The config entry is safe in the ordinary Node configuration process and does not expose application rendering. Its helpers do not repeat full reader validation.

Build route plans only from an already validated generated reader artifact. The raw continuity constructor is internal; use the validated application's `handleRequest` so route planning and continuity share one exact reader snapshot. `resolveRoute` consumes logical framework segments, while `handleRequest` owns raw request paths and must run before route rendering. Pass `renderPage` only a page returned by the same application's `resolveRoute`.

Client error components and their types live only at `@genii-foundation/publisher-next/client`. They accept the fixed public error identity described above. They never accept a reader envelope or server application.

## Attribution

Every publication page and the engine-owned not-found page display:

> Copyright 2026 GENII Foundation. Published with GENII Publisher.

The credit links to `https://publisher.genii.foundation`. The renderer reads the fixed Exhibit B values from its own constants rather than trusting caller data. The footer also exposes the validated reader envelope attribution field `sourceCodeUrl` as a conspicuous publication source link. Invalid low-level caller data falls back to the canonical GENII Publisher source instead of removing either link. Themes cannot remove either element through the supported API. The same renderer-owned interface appears on attributed static framework 404 and 500 pages and on hydrated App Router error boundaries.

Raw App Router error HTTP shells remain framework-generic before hydration. Next.js emits those bytes before the client boundary can render. The user-visible hydrated `app/error.tsx` and `app/global-error.tsx` surfaces display the required linked attribution and source URL. This is a graphical interface guarantee, not a claim that every intermediate framework shell contains Publisher markup.

The clean packed host proves attributed static 404 and 500 HTML, 500 statuses for forced runtime and root-layout failures, secret redaction, an illegal Client Component import failure at build time, and attributed browser-boundary chunks that contain no manuscript sentinels. A dedicated Chrome CI job loads both App Router failures, waits for hydration, requires the linked attribution and visibly rendered source link, and rejects either server-only secret from the browser DOM.

## License and source

This package is licensed under CPAL 1.0. An External Deployment that lets anyone other than the deployer use the covered code triggers the source-availability duties in CPAL Section 15. The license text controls.

Canonical source: `https://github.com/genii-foundation/publisher`

## Dependency override and release evidence

Next.js 16.2.12 otherwise resolves versions affected by four high-severity advisories:

- Nano ID 3.3.16 is affected by [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8), patched in 3.3.18.
- PostCSS 8.4.31 is affected by [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), patched in 8.5.12, and [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849), patched in 8.5.18.
- Optional sharp 0.34.5 is affected by [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), patched in 0.35.0.

`PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES` pins Nano ID 3.3.18, PostCSS 8.5.24, and Sharp 0.35.3 inside the consuming root. The clean packed-host proof resolves once, performs a frozen offline reinstall from the generated lockfile, asserts those exact transitive versions and a loaded libvips version, reports zero production vulnerabilities, and requests an actual optimized WebP. This evidence closes the renderer's former transitive-dependency release gate while the exact override remains in force.

The attributed framework-error gate is also closed. The package supplies separate client-safe error components, the complete host contract wires every required framework surface, and the automated proof checks static, runtime, and hydrated browser behavior.

## Legacy Reader state

An existing publication may register one temporary Reader state bootstrap in
`publisher.config.ts`. The adapter is trusted author code. It configures on the
server and returns a synchronous JavaScript function body for the document head.
Publisher supplies a frozen publication ID, a report key, and target keys derived
by the framework-neutral Reader contracts. The body runs before preference
prepaint and before hydrated stores read local state.

The body must return a version 1.0 report with unique bounded `copied` and
`refused` labels. It must preserve every legacy key, refuse lossy translations,
leave an existing Publisher value unchanged, and be safe to run again. Publisher
contains throws, rejects script escape sequences, limits source to 32,768 UTF-8
bytes, and records a deterministic report without private values. The adapter
identity, configuration hash, and exact source hash contribute to application
manifest 1.1 and its build ID.

```ts
import {
  definePublisherNextHostConfig,
} from "@genii-foundation/publisher-next/server/sync";
import legacyState from "@example/publication-state-bootstrap";

export default definePublisherNextHostConfig({
  readerStateBootstrap: legacyState,
});
```

Remove the adapter after the publication's declared compatibility and rollback
window. Do not delete old browser keys as part of removal. See
[ADR 0057](../../docs/architecture/0057-explicit-reader-state-bootstrap.md).

The generated host reserves `/api/auth/start`, `/api/auth/verify`,
`/api/session`, `/api/sync`, `/auth/callback`, and `/api/account` for optional
synchronization. Every route returns the same opaque 404 when the publication has
no synchronization artifact. An author may select a matching provider through
`publisher.config.ts`. The renderer validates provider identity and capabilities,
owns input bounds, callback redirects, session and deletion responses, and rejects
cross-origin state changes before provider code executes. Provider configuration
and credentials remain server only.

`GET /api/sync` reads the authenticated reader's state for the validated
publication. `POST /api/sync` transfers bounded progress, bookmarks, consent,
and engagement values for declared capabilities. The browser supplies neither a
user ID nor a publication ID. Provider output is validated before it becomes a
response, and provider failures collapse to one opaque unavailable result.

When synchronization is declared, the default Reader adds an account panel. It
records explicit versioned consent before requesting an email link, accepts a
one-time code, reads the session, signs out, and requires separate confirmation
for account deletion. After sign-in, it debounces local revisions, pauses while
offline, retries bounded failures, reconciles progress and bookmark tombstones,
and acknowledges bounded engagement batches through `/api/sync`. A newer remote
schema freezes only its affected capability. Local progress and bookmarks remain
available throughout.

```ts
import { definePublisherNextHostConfig } from "@genii-foundation/publisher-next/server/sync";

export default definePublisherNextHostConfig({
  syncProvider: yourProvider,
});
```

These renderer-specific gates do not supersede the repository-level public release gates in the root README.
