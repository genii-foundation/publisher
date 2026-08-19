/*
No alternative license is selected for GENII Publisher Original Code. The alternative-license fields in the required Exhibit A notice below are intentionally unpopulated.

“The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/cpal-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is GENII Publisher.
The Original Developer is not the Initial Developer and is __________. If left blank, the Original Developer is the Initial Developer.
The Initial Developer of the Original Code is GENII Foundation. All portions of the code written by GENII Foundation are Copyright (c) 2026 GENII Foundation. All Rights Reserved.
Contributor ______________________.
Alternatively, the contents of this file may be used under the terms of the _____ license (the [___] License), in which case the provisions of [______] License are applicable instead of those above.
If you wish to allow use of your version of this file only under the terms of the [____] License and not to allow others to use your version of this file under the CPAL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the [___] License. If you do not delete the provisions above, a recipient may use your version of this file under either the CPAL or the [___] License.”
*/

// The renderer-owned host contract.
//
// This is the single source of truth for the files a Next.js host needs in order
// to serve a publication. Author initialization applies it, upgrades migrate
// between its versions, and the packaged host proof consumes it and layers its
// own probes on top. Before it existed the templates lived inline inside the
// proof script, which meant the artifact authors would receive had no name, no
// version, and no way to be applied by a command.
//
// The proof deliberately differs from an author host in two ways, and both are
// the proof's business rather than this template's: it adds probe files that
// assert export shapes, and it replaces `app/layout.tsx` with a variant that
// throws on demand. A file the proof writes that this template does not declare
// is therefore proof scaffolding by construction.

import { PUBLISHER_NEXT_VERSION } from "./index.js";

/**
 * The host contract version.
 *
 * Independent of the package version on purpose. A renderer release that changes
 * no host file does not advance it, and an author upgrading across such a
 * release has no host migration to apply. It advances when the file set, a
 * file's content, or the meaning of an input changes.
 */
export const PUBLISHER_NEXT_HOST_CONTRACT_VERSION = "0.11.0";

/** The renderer that owns this contract. */
export const PUBLISHER_NEXT_HOST_RENDERER =
  "@genii-foundation/publisher-next";

/** Directory holding the catch-all publication route. */
export const PUBLISHER_NEXT_ROUTE_SEGMENT_DIRECTORY = "[...segments]";

/** Host-relative location of the compiled reader artifact. */
export const PUBLISHER_NEXT_READER_DATA_PATH =
  "publication-reader.json";

/** Host-relative location of the lazy client search artifact. */
export const PUBLISHER_NEXT_SEARCH_DATA_PATH =
  "public/publication-reader-search.json";

/** Host-relative location of the lazy publication progress catalog. */
export const PUBLISHER_NEXT_PROGRESS_DATA_PATH =
  "public/publication-reader-progress.json";

/** Client-safe publication identity for framework error surfaces. */
export const PUBLISHER_NEXT_PUBLIC_IDENTITY_DATA_PATH =
  "publication-public-identity.json";

/** Server-only extension projection bound to the exact Reader build. */
export const PUBLISHER_NEXT_EXTENSION_DATA_PATH =
  "publication-extensions.json";

/** Public route serving the build-bound offline work package catalog. */
export const PUBLISHER_NEXT_OFFLINE_CATALOG_HREF =
  "/publication-reader-offline.json";

/** Host-relative location of the generic offline service worker. */
export const PUBLISHER_NEXT_OFFLINE_SERVICE_WORKER_PATH =
  "public/offline-sw.js";

/**
 * Host-relative location of the narration envelope.
 *
 * Under `public/` because a client fetches it, once and lazily, rather than the
 * server importing it. That placement is why adding narration changes no
 * generated file: Next serves `public/` with no configuration, so unlike the
 * reader artifact there is nothing to import and no host file to edit.
 *
 * A measured catalog is 278 KB for 551 clips. That is unremarkable for a file
 * requested when a reader presses play, and unacceptable inside a payload every
 * page loads, which is what carrying it in the reader artifact would have meant.
 */
export const PUBLISHER_NEXT_AUDIO_DATA_PATH =
  "public/publication-audio.json";

/**
 * Host-relative location of the sync envelope.
 *
 * Under `public/` because the browser-facing declaration is public. The generated
 * application and route bridge also read the same bytes on the server so every
 * surface binds to one validated publication and Reader build identity.
 *
 * It carries no provider configuration. That is enforced by the artifact's schema
 * rather than by anything here, because this path is public and a config is
 * author-supplied.
 */
export const PUBLISHER_NEXT_SYNC_DATA_PATH =
  "public/publication-sync.json";

/** Server-side Updates data bound to the Reader build. */
export const PUBLISHER_NEXT_UPDATES_DATA_PATH =
  "publication-updates.json";

export interface PublisherNextHostCapabilities {
  /**
   * Route target kinds the generated host can serve.
   *
   * A kind absent from this list is one the host cannot serve, and a publication
   * whose artifact contains it must be refused before anything is written rather
   * than at server startup.
   */
  readonly routeKinds: readonly string[];
  /**
   * Generated data artifacts, beyond the reader artifact, this host has somewhere
   * to put and something to serve them with.
   *
   * Read as optional by the engine so that a renderer predating this field still
   * resolves. Absent therefore means none, which is the same rule the rest of this
   * declaration follows: an absent claim is refused rather than assumed.
   */
  readonly dataArtifacts: readonly string[];
}

/**
 * What the generated host can actually serve.
 *
 * This exists because a publication declaring an Updates route built cleanly and
 * then produced a host that threw on boot. The generated application is created
 * with the reader alone, so it has no Updates adapter to give, and the renderer
 * refuses. The build said "Written." and the site did not run.
 *
 * Declared as data rather than as a function the engine calls, for the same
 * reason migration edges are data: a renderer is a third-party package, and the
 * engine must be able to decide what a host can serve without executing anything
 * that package supplies.
 *
 * Updates is served from a materialized artifact. The authoring adapter that
 * interprets source history never runs in this host.
 */
export const PUBLISHER_NEXT_HOST_CAPABILITIES: PublisherNextHostCapabilities =
  Object.freeze({
    routeKinds: Object.freeze([
      "home",
      "work",
      "collection",
      "section",
      "updates",
    ]),
    dataArtifacts: Object.freeze([
      "audio",
      "extensions",
      "offline",
      "progress",
      "public-identity",
      "search",
      "sync",
      "updates",
    ]),
  });

export interface PublisherNextHostMigration {
  /** Contract version this edge starts from. */
  readonly from: string;
  /** Contract version this edge arrives at. */
  readonly to: string;
  /** One line an author can read to know what changed. */
  readonly summary: string;
  /** Steps the tooling refuses to perform, such as a provider setting. */
  readonly manualSteps?: readonly string[];
}

/**
 * Every host contract move this renderer knows how to make.
 *
 * A renderer with nothing to migrate still exports this, empty, rather than
 * omitting it. Absent and empty would then be indistinguishable, and a renderer
 * that misnamed the export would silently upgrade with no route, skipping the
 * manual steps an edge exists to announce.
 */
export const PUBLISHER_NEXT_HOST_MIGRATIONS: readonly PublisherNextHostMigration[] =
  Object.freeze([
    Object.freeze({
      from: "0.1.0",
      to: "0.2.0",
      summary:
        "Add the required lazy search artifact destination to the official host contract.",
    }),
    Object.freeze({
      from: "0.2.0",
      to: "0.3.0",
      summary:
        "Add the server-side Updates artifact and connect it to the generated application.",
    }),
    Object.freeze({
      from: "0.3.0",
      to: "0.4.0",
      summary:
        "Add dormant fail-closed synchronization route surfaces to every official host.",
    }),
    Object.freeze({
      from: "0.4.0",
      to: "0.5.0",
      summary:
        "Bind synchronization routes to optional author-owned host configuration through a server-only provider contract.",
      manualSteps: Object.freeze([
        "Regenerate and review package-lock.json so the required Nano ID 3.3.18 override is installed.",
      ]),
    }),
    Object.freeze({
      from: "0.5.0",
      to: "0.6.0",
      summary:
        "Add provider-neutral email authentication and session route surfaces for the default reader controls.",
    }),
    Object.freeze({
      from: "0.6.0",
      to: "0.7.0",
      summary:
        "Add provider-neutral publication-scoped Reader data transfer routes.",
    }),
    Object.freeze({
      from: "0.7.0",
      to: "0.8.0",
      summary:
        "Add the required lazy progress catalog destination to the official host contract.",
    }),
    Object.freeze({
      from: "0.8.0",
      to: "0.9.0",
      summary:
        "Add the build-bound offline catalog route and generic service worker to the official host contract.",
    }),
    Object.freeze({
      from: "0.9.0",
      to: "0.10.0",
      summary:
        "Connect an explicit author theme module and client-safe public identity artifact to every official host surface.",
      manualSteps: Object.freeze([
        "Add publisher.theme.mjs only when selecting a separately installed custom theme package.",
      ]),
    }),
    Object.freeze({
      from: "0.10.0",
      to: PUBLISHER_NEXT_HOST_CONTRACT_VERSION,
      summary:
        "Connect explicit author extension registration and build-bound server slot data to the official host.",
      manualSteps: Object.freeze([
        "Add publisher.extensions.mjs when the publication manifest declares extensions, importing each separately installed extension package explicitly.",
      ]),
    }),
  ]);

export interface PublisherNextHostTemplateInput {
  /** Package name for the generated host manifest. */
  readonly hostPackageName: string;
  /**
   * Exact existing host package manifest bytes.
   *
   * Present for an installed author host. The renderer carries those bytes
   * through unchanged rather than replacing the manifest that made the renderer
   * resolvable in the first place. Omit only when constructing a new proof host.
   */
  readonly packageJsonText?: string;
  /** Exact dependency specifiers, including the engine packages and the framework peers. */
  readonly dependencies: Readonly<Record<string, string>>;
  /** Exact development dependency specifiers. */
  readonly devDependencies: Readonly<Record<string, string>>;
  /** Package manager overrides the renderer requires of its host. */
  readonly overrides: unknown;
}

export interface PublisherNextHostFile {
  /** POSIX path relative to the host root. */
  readonly path: string;
  readonly contents: string;
}

export interface PublisherNextHostTemplate {
  readonly contractVersion: string;
  readonly renderer: string;
  readonly rendererVersion: string;
  readonly readerDataPath: string;
  /** Where the required capability-sliced search artifact belongs. */
  readonly searchDataPath: string;
  /** Where the required capability-sliced progress artifact belongs. */
  readonly progressDataPath: string;
  /** Where the required client-safe public identity artifact belongs. */
  readonly publicIdentityDataPath: string;
  /** Where build-bound server extension projections belong. */
  readonly extensionDataPath: string;
  /** Public href from which the renderer serves its offline package catalog. */
  readonly offlineCatalogHref: string;
  /**
   * Where the narration envelope belongs, when this renderer can serve one.
   *
   * Optional in the shape the engine reads, because a renderer predating
   * narration declares none and must keep working.
   */
  readonly audioDataPath?: string;
  /** Where the sync envelope belongs, when this renderer can serve one. */
  readonly syncDataPath?: string;
  /** Where the server-side Updates envelope belongs. */
  readonly updatesDataPath?: string;
  readonly files: readonly PublisherNextHostFile[];
}

function lines(...values: readonly string[]): string {
  return `${values.join("\n")}\n`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function publicHref(path: string): string {
  return `/${path.slice(path.lastIndexOf("/") + 1)}`;
}

function offlineServiceWorkerSource(): string {
  return lines(
    'const RUNTIME_CACHE_NAME = "genii-publisher-offline-runtime-v1";',
    'const RUNTIME_CACHE_PREFIX = "genii-publisher-offline-runtime-v";',
    'const METADATA_CACHE_NAME = "genii-publisher-offline-metadata-v1";',
    'const PACKAGE_CACHE_PREFIX = "genii-publisher-offline-package-v1-";',
    'const PACKAGE_RECORD_PREFIX = "https://publisher.invalid/__offline-package__/";',
    "",
    "function shouldHandle(request) {",
    '  if (request.method !== "GET") return false;',
    "  const url = new URL(request.url);",
    "  if (url.origin !== self.location.origin) return false;",
    '  if (request.headers.get("rsc") === "1" || url.searchParams.has("_rsc")) return false;',
    '  if (request.headers.has("next-router-prefetch") || request.headers.has("next-router-state-tree")) return false;',
    '  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return false;',
    '  if (url.pathname === "/offline-sw.js") return false;',
    "  return true;",
    "}",
    "",
    "function isRecord(value) {",
    "  return Boolean(",
    "    value &&",
    '    typeof value === "object" &&',
    "    value.schemaVersion === 1 &&",
    '    typeof value.publicationId === "string" &&',
    '    typeof value.workId === "string" &&',
    '    typeof value.cacheName === "string" &&',
    "    value.cacheName.startsWith(PACKAGE_CACHE_PREFIX) &&",
    "    Array.isArray(value.resourceHrefs) &&",
    '    value.resourceHrefs.every((href) => typeof href === "string") &&',
    '    typeof value.savedAt === "string"',
    "  );",
    "}",
    "",
    "async function activeRecords() {",
    "  try {",
    "    const metadata = await caches.open(METADATA_CACHE_NAME);",
    "    const keys = await metadata.keys();",
    "    const records = await Promise.all(",
    "      keys",
    "        .filter((request) => request.url.startsWith(PACKAGE_RECORD_PREFIX))",
    "        .map(async (request) => {",
    "          try {",
    "            const response = await metadata.match(request);",
    "            const value = response ? await response.json() : null;",
    "            return isRecord(value) ? value : null;",
    "          } catch {",
    "            return null;",
    "          }",
    "        }),",
    "    );",
    "    return records",
    "      .filter(Boolean)",
    "      .sort((left, right) => right.savedAt.localeCompare(left.savedAt));",
    "  } catch {",
    "    return [];",
    "  }",
    "}",
    "",
    "async function matchActivePackage(request) {",
    "  for (const record of await activeRecords()) {",
    "    try {",
    "      const response = await (await caches.open(record.cacheName)).match(request);",
    "      if (response) return response;",
    "    } catch {}",
    "  }",
    "  return undefined;",
    "}",
    "",
    "async function portableResponse(response) {",
    "  if (!response.redirected) return response.clone();",
    "  const finalUrl = new URL(response.url);",
    "  if (finalUrl.origin !== self.location.origin) return null;",
    "  return new Response(await response.clone().arrayBuffer(), {",
    "    status: response.status,",
    "    statusText: response.statusText,",
    "    headers: response.headers,",
    "  });",
    "}",
    "",
    "async function networkFirst(request) {",
    "  const runtime = await caches.open(RUNTIME_CACHE_NAME);",
    "  try {",
    "    const response = await fetch(request);",
    '    if (response.ok && response.status !== 206 && !request.headers.has("range")) {',
    "      const portable = await portableResponse(response);",
    "      if (portable) await runtime.put(request, portable).catch(() => undefined);",
    "    }",
    "    return response;",
    "  } catch (error) {",
    "    const packaged = await matchActivePackage(request);",
    "    if (packaged) return packaged;",
    "    const opportunistic = await runtime.match(request);",
    "    if (opportunistic) return opportunistic;",
    "    throw error;",
    "  }",
    "}",
    "",
    'self.addEventListener("install", (event) => {',
    "  event.waitUntil(self.skipWaiting());",
    "});",
    "",
    'self.addEventListener("activate", (event) => {',
    "  event.waitUntil((async () => {",
    "    const names = await caches.keys();",
    "    await Promise.all(names.map((name) =>",
    "      name.startsWith(RUNTIME_CACHE_PREFIX) && name !== RUNTIME_CACHE_NAME",
    "        ? caches.delete(name)",
    "        : Promise.resolve(false)",
    "    ));",
    "    await self.clients.claim();",
    "  })());",
    "});",
    "",
    'self.addEventListener("fetch", (event) => {',
    "  if (!shouldHandle(event.request)) return;",
    "  event.respondWith(networkFirst(event.request));",
    "});",
  );
}

/**
 * Produces the exact host file set for one set of inputs.
 *
 * Pure. It performs no filesystem access and no resolution, so a caller can
 * compare it against a host on disk without touching that host, which is what
 * lets planning stay read-only.
 */
export function createPublisherNextHostTemplate(
  input: PublisherNextHostTemplateInput,
): PublisherNextHostTemplate {
  const files: PublisherNextHostFile[] = [
    {
      path: "package.json",
      contents:
        input.packageJsonText ??
        json({
          name: input.hostPackageName,
          version: "0.0.0",
          private: true,
          type: "module",
          scripts: {
            build: "next build",
            start: "next start",
          },
          dependencies: input.dependencies,
          overrides: input.overrides,
          devDependencies: input.devDependencies,
        }),
    },
    {
      path: "next.config.mjs",
      contents: lines(
        `import reader from "./${PUBLISHER_NEXT_READER_DATA_PATH}" with { type: "json" };`,
        `import publicIdentity from "./${PUBLISHER_NEXT_PUBLIC_IDENTITY_DATA_PATH}" with { type: "json" };`,
        'import { existsSync, readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        'import { createPublisherNextConfig, createPublisherNextRoutePlan } from "@genii-foundation/publisher-next/config";',
        "",
        `const updatesPath = join(process.cwd(), "${PUBLISHER_NEXT_UPDATES_DATA_PATH}");`,
        'const updatesData = existsSync(updatesPath) ? JSON.parse(readFileSync(updatesPath, "utf8")) : undefined;',
        "const routePlan = createPublisherNextRoutePlan(reader, updatesData);",
        "if (!routePlan.valid) {",
        "  throw new Error(JSON.stringify(routePlan.diagnostics));",
        "}",
        'const publicIdentityKeys = ["buildId", "engineVersion", "homePath", "publication", "publicationId", "schemaVersion"];',
        "const homePath = reader.routes.active.find(({ target }) => target.kind === \"home\")?.path;",
        "if (",
        "  JSON.stringify(Object.keys(publicIdentity).sort()) !== JSON.stringify(publicIdentityKeys) ||",
        '  publicIdentity.schemaVersion !== "1.0" ||',
        "  publicIdentity.publicationId !== reader.publicationId ||",
        "  publicIdentity.engineVersion !== reader.engineVersion ||",
        "  publicIdentity.buildId !== reader.buildId ||",
        "  publicIdentity.homePath !== homePath ||",
        "  JSON.stringify(publicIdentity.publication) !== JSON.stringify(reader.publication)",
        ") {",
        '  throw new TypeError("publication-public-identity.json does not match the exact Reader build.");',
        "}",
        'const authorConfigPath = join(process.cwd(), "publisher.config.ts");',
        'const publisherConfigPath = existsSync(authorConfigPath) ? "./publisher.config.ts" : "./publisher-default-config.js";',
        'const authorThemePath = join(process.cwd(), "publisher.theme.mjs");',
        'const publisherThemePath = existsSync(authorThemePath) ? "./publisher.theme.mjs" : "./publisher-default-theme.js";',
        'const authorExtensionsPath = join(process.cwd(), "publisher.extensions.mjs");',
        'const publisherExtensionsPath = existsSync(authorExtensionsPath) ? "./publisher.extensions.mjs" : "./publisher-default-extensions.js";',
        "export default createPublisherNextConfig(routePlan.value, {",
        "  turbopack: {",
        "    resolveAlias: {",
        '      "genii-publisher:config": publisherConfigPath,',
        '      "genii-publisher:extensions": publisherExtensionsPath,',
        '      "genii-publisher:theme": publisherThemePath,',
        "    },",
        "  },",
        "});",
      ),
    },
    {
      path: "tsconfig.json",
      contents: json({
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          incremental: false,
          module: "esnext",
          esModuleInterop: true,
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "react-jsx",
          plugins: [{ name: "next" }],
        },
        include: [
          "next-env.d.ts",
          ".next/types/**/*.ts",
          ".next/dev/types/**/*.ts",
          "**/*.mts",
          "**/*.ts",
          "**/*.tsx",
        ],
        exclude: ["node_modules"],
      }),
    },
    {
      path: "next-env.d.ts",
      contents: lines(
        '/// <reference types="next" />',
        '/// <reference types="next/image-types/global" />',
        '/// <reference types="next/navigation-types/compat/navigation" />',
        'import "./.next/types/routes.d.ts";',
        "",
        "// NOTE: This file should not be edited",
        "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
      ),
    },
    {
      path: "proxy.ts",
      contents: lines(
        'import { NextResponse, type NextRequest } from "next/server";',
        'import { application } from "./publisher-application.js";',
        "",
        "export function proxy(request: NextRequest) {",
        "  return application.handleRequest(request) ?? NextResponse.next();",
        "}",
      ),
    },
    {
      path: "publisher-application.js",
      contents: lines(
        'import { existsSync, readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        `import reader from "./${PUBLISHER_NEXT_READER_DATA_PATH}" with { type: "json" };`,
        'import extensions from "genii-publisher:extensions";',
        'import theme from "genii-publisher:theme";',
        'import { createPublicationNextApplication } from "@genii-foundation/publisher-next/server";',
        "",
        `const updatesPath = join(process.cwd(), "${PUBLISHER_NEXT_UPDATES_DATA_PATH}");`,
        'const updatesData = existsSync(updatesPath) ? JSON.parse(readFileSync(updatesPath, "utf8")) : undefined;',
        `const syncPath = join(process.cwd(), "${PUBLISHER_NEXT_SYNC_DATA_PATH}");`,
        'const syncData = existsSync(syncPath) ? JSON.parse(readFileSync(syncPath, "utf8")) : undefined;',
        `const audioPath = join(process.cwd(), "${PUBLISHER_NEXT_AUDIO_DATA_PATH}");`,
        'const audioData = existsSync(audioPath) ? JSON.parse(readFileSync(audioPath, "utf8")) : undefined;',
        `const extensionPath = join(process.cwd(), "${PUBLISHER_NEXT_EXTENSION_DATA_PATH}");`,
        'const extensionData = existsSync(extensionPath) ? JSON.parse(readFileSync(extensionPath, "utf8")) : undefined;',
        "const created = await createPublicationNextApplication({ reader, audioData, extensionData, extensions, syncData, theme, updatesData });",
        "if (!created.valid) {",
        "  throw new Error(JSON.stringify(created.diagnostics));",
        "}",
        '/** @type {import("@genii-foundation/publisher-next/server").PublicationNextApplication} */',
        "export const application = created.value;",
      ),
    },
    {
      path: "publisher-extensions.d.ts",
      contents: lines(
        'declare module "genii-publisher:extensions" {',
        "  const extensions: readonly unknown[];",
        "  export default extensions;",
        "}",
      ),
    },
    {
      path: "publisher-default-extensions.js",
      contents: lines(
        "export default Object.freeze([]);",
      ),
    },
    {
      path: "publisher-config.d.ts",
      contents: lines(
        'declare module "genii-publisher:config" {',
        '  import type { PublisherNextHostConfig } from "@genii-foundation/publisher-next/server/sync";',
        "  const config: PublisherNextHostConfig;",
        "  export default config;",
        "}",
      ),
    },
    {
      path: "publisher-default-config.js",
      contents: lines(
        'import { definePublisherNextHostConfig } from "@genii-foundation/publisher-next/server/sync";',
        "",
        "export default definePublisherNextHostConfig({});",
      ),
    },
    {
      path: "publisher-default-theme.js",
      contents: lines(
        'import { resolveDefaultPublisherNextTheme } from "@genii-foundation/publisher-next/theme/default";',
        "",
        "export default resolveDefaultPublisherNextTheme();",
      ),
    },
    {
      path: "publisher-error-identity.ts",
      contents: lines(
        'import { createPublisherNextErrorIdentity } from "@genii-foundation/publisher-next/client";',
        'import theme from "genii-publisher:theme";',
        `import publicIdentity from "./${PUBLISHER_NEXT_PUBLIC_IDENTITY_DATA_PATH}" with { type: "json" };`,
        "",
        "let configuredTheme;",
        "try {",
        "  configuredTheme = theme.implementation.configure(theme.config);",
        "} catch {",
        '  throw new TypeError("The selected Publisher theme threw while configuring the error surface.");',
        "}",
        "if (!configuredTheme.valid) {",
        "  throw new TypeError(JSON.stringify(configuredTheme.diagnostics));",
        "}",
        "const result = createPublisherNextErrorIdentity({",
        "  homePath: publicIdentity.homePath,",
        "  publication: publicIdentity.publication,",
        "  theme: configuredTheme.value,",
        "});",
        "if (!result.valid) {",
        "  throw new Error(JSON.stringify(result.diagnostics));",
        "}",
        "export const publisherErrorIdentity = result.value;",
      ),
    },
    {
      path: "publisher-theme.d.ts",
      contents: lines(
        'declare module "genii-publisher:theme" {',
        '  import type { ResolvedPublisherNextTheme } from "@genii-foundation/publisher-next/theme";',
        "  const theme: ResolvedPublisherNextTheme;",
        "  export default theme;",
        "}",
      ),
    },
    {
      path: "publisher-sync-routes.js",
      contents: lines(
        'import { existsSync, readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        `import reader from "./${PUBLISHER_NEXT_READER_DATA_PATH}" with { type: "json" };`,
        'import publisherConfig from "genii-publisher:config";',
        'import { createPublisherNextSyncRoutes } from "@genii-foundation/publisher-next/server/sync";',
        "",
        `const syncPath = join(process.cwd(), "${PUBLISHER_NEXT_SYNC_DATA_PATH}");`,
        'const sync = existsSync(syncPath) ? JSON.parse(readFileSync(syncPath, "utf8")) : undefined;',
        'const homePath = reader.routes.active.find(({ target }) => target.kind === "home")?.path ?? "/";',
        "export const syncRoutes = createPublisherNextSyncRoutes({",
        "  sync,",
        "  provider: publisherConfig.syncProvider,",
        "  homePath,",
        "});",
      ),
    },
    {
      path: "app/publication-reader-offline.json/route.ts",
      contents: lines(
        'import { existsSync, readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        `import reader from "../../${PUBLISHER_NEXT_READER_DATA_PATH}" with { type: "json" };`,
        'import type { PublicationReaderEnvelope, Sha256Digest } from "@genii-foundation/publisher-schema/reader";',
        'import type { ReaderOfflineResourceInput } from "@genii-foundation/publisher-reader/offline";',
        'import { createReaderOfflineCatalog, parseReaderOfflineCatalog, serializeReaderOfflineCatalog } from "@genii-foundation/publisher-reader/offline";',
        'import { parseReaderNarrationEnvelope } from "@genii-foundation/publisher-reader/narration";',
        "",
        'export const dynamic = "force-dynamic";',
        "",
        "export function GET(request: Request) {",
        "  try {",
        "    const url = new URL(request.url);",
        '    const rendererBuildId = url.searchParams.get("rendererBuildId");',
        "    if (",
        "      url.searchParams.size !== 1 ||",
        '      rendererBuildId === null ||',
        '      !/^sha256:[0-9a-f]{64}$/u.test(rendererBuildId)',
        "    ) {",
        '      return new Response("Invalid renderer identity.\\n", { status: 400 });',
        "    }",
        "    const acceptedRendererBuildId = rendererBuildId as Sha256Digest;",
        "    const acceptedReader = reader as unknown as PublicationReaderEnvelope;",
        `    const audioPath = join(process.cwd(), "${PUBLISHER_NEXT_AUDIO_DATA_PATH}");`,
        '    const audioData = existsSync(audioPath) ? JSON.parse(readFileSync(audioPath, "utf8")) : undefined;',
        "    const narration = audioData === undefined",
        "      ? null",
        "      : parseReaderNarrationEnvelope(JSON.stringify(audioData), {",
        "          publicationId: acceptedReader.publicationId,",
        "          readerBuildId: acceptedReader.buildId,",
        "        });",
        "    const narrationCatalogHash = audioData?.source?.catalogSha256;",
        "    if (",
        "      audioData !== undefined &&",
        "      (narration === null ||",
        '        typeof narrationCatalogHash !== "string" ||',
        '        !/^sha256:[0-9a-f]{64}$/u.test(narrationCatalogHash))',
        "    ) {",
        '      return new Response("Invalid narration artifact.\\n", { status: 500 });',
        "    }",
        "    const acceptedNarrationCatalogHash = narrationCatalogHash as Sha256Digest;",
        '    const catalogHref = `${url.pathname}?rendererBuildId=${encodeURIComponent(acceptedRendererBuildId)}`;',
        "    const sharedResources: ReaderOfflineResourceInput[] = [",
        `      { href: "${publicHref(PUBLISHER_NEXT_SEARCH_DATA_PATH)}", kind: "data" },`,
        `      { href: "${publicHref(PUBLISHER_NEXT_PROGRESS_DATA_PATH)}", kind: "data" },`,
        `      ...(narration === null ? [] : [{ href: "${publicHref(PUBLISHER_NEXT_AUDIO_DATA_PATH)}", kind: "data" as const }]),`,
        "    ];",
        "    const catalog = createReaderOfflineCatalog({",
        "      reader: acceptedReader,",
        "      rendererBuildId: acceptedRendererBuildId,",
        "      catalogHref,",
        "      sharedResources,",
        "      ...(narration === null ? {} : {",
        "        narration: {",
        "          catalogHash: acceptedNarrationCatalogHash,",
        "          envelope: narration,",
        "        },",
        "      }),",
        "    });",
        "    const text = serializeReaderOfflineCatalog(catalog);",
        "    if (parseReaderOfflineCatalog(text, {",
        "      publicationId: acceptedReader.publicationId,",
        "      readerBuildId: acceptedReader.buildId,",
        "      rendererBuildId: acceptedRendererBuildId,",
        "    }) === null) {",
        '      return new Response("Invalid offline catalog.\\n", { status: 500 });',
        "    }",
        "    return new Response(text, {",
        "    headers: {",
        '      "cache-control": "public, max-age=0, must-revalidate",',
        '      "content-type": "application/vnd.genii.publisher.reader-offline+json; charset=utf-8",',
        "    },",
        "  });",
        "  } catch {",
        '    return new Response("Offline catalog creation failed.\\n", { status: 500 });',
        "  }",
        "}",
      ),
    },
    {
      path: PUBLISHER_NEXT_OFFLINE_SERVICE_WORKER_PATH,
      contents: offlineServiceWorkerSource(),
    },
    {
      path: "app/api/auth/start/route.ts",
      contents: lines(
        'import { syncRoutes } from "../../../../publisher-sync-routes.js";',
        "",
        "export const POST = syncRoutes.authStart;",
      ),
    },
    {
      path: "app/api/auth/verify/route.ts",
      contents: lines(
        'import { syncRoutes } from "../../../../publisher-sync-routes.js";',
        "",
        "export const POST = syncRoutes.authVerify;",
      ),
    },
    {
      path: "app/api/account/route.ts",
      contents: lines(
        'import { syncRoutes } from "../../../publisher-sync-routes.js";',
        "",
        "export const DELETE = syncRoutes.accountDeletion;",
      ),
    },
    {
      path: "app/api/session/route.ts",
      contents: lines(
        'import { syncRoutes } from "../../../publisher-sync-routes.js";',
        "",
        "export const GET = syncRoutes.sessionRead;",
        "export const DELETE = syncRoutes.sessionDelete;",
      ),
    },
    {
      path: "app/api/sync/route.ts",
      contents: lines(
        'import { syncRoutes } from "../../../publisher-sync-routes.js";',
        "",
        "export const GET = syncRoutes.syncRead;",
        "export const POST = syncRoutes.syncTransfer;",
      ),
    },
    {
      path: "app/auth/callback/route.ts",
      contents: lines(
        'import { syncRoutes } from "../../../publisher-sync-routes.js";',
        "",
        "export const GET = syncRoutes.authCallback;",
      ),
    },
    {
      path: "app/layout.tsx",
      contents: lines(
        'import "@genii-foundation/publisher-next/styles.css";',
        'import { application } from "../publisher-application.js";',
        "",
        "export default function RootLayout(",
        "  props: Parameters<typeof application.RootLayout>[0],",
        ") {",
        "  return application.RootLayout(props);",
        "}",
      ),
    },
    {
      path: "app/page.tsx",
      contents: lines(
        'import { application } from "../publisher-application.js";',
        "",
        "export const generateMetadata = application.generateRootMetadata;",
        "export default application.RootPage;",
      ),
    },
    {
      path: `app/${PUBLISHER_NEXT_ROUTE_SEGMENT_DIRECTORY}/page.tsx`,
      contents: lines(
        'import { application } from "../../publisher-application.js";',
        "",
        "export const dynamicParams = false;",
        "export const generateStaticParams = application.generateStaticParams;",
        "export const generateMetadata = application.generateMetadata;",
        "export default application.Page;",
      ),
    },
    {
      path: "app/not-found.tsx",
      contents: lines(
        'import { application } from "../publisher-application.js";',
        "",
        "export default application.NotFoundPage;",
      ),
    },
    {
      path: "app/error.tsx",
      contents: lines(
        '"use client";',
        "",
        'import { PublisherNextErrorPage, type PublisherNextErrorBoundaryProps } from "@genii-foundation/publisher-next/client";',
        'import { publisherErrorIdentity } from "../publisher-error-identity";',
        "",
        "export default function ErrorBoundary(",
        "  props: PublisherNextErrorBoundaryProps,",
        ") {",
        "  return (",
        "    <PublisherNextErrorPage",
        "      {...props}",
        "      identity={publisherErrorIdentity}",
        "    />",
        "  );",
        "}",
      ),
    },
    {
      path: "app/global-error.tsx",
      contents: lines(
        '"use client";',
        "",
        'import { PublisherNextGlobalErrorPage, type PublisherNextErrorBoundaryProps } from "@genii-foundation/publisher-next/client";',
        'import { publisherErrorIdentity } from "../publisher-error-identity";',
        "",
        "export default function GlobalErrorBoundary(",
        "  props: PublisherNextErrorBoundaryProps,",
        ") {",
        "  return (",
        "    <PublisherNextGlobalErrorPage",
        "      {...props}",
        "      identity={publisherErrorIdentity}",
        "    />",
        "  );",
        "}",
      ),
    },
    {
      path: "pages/_app.tsx",
      contents: lines(
        'import "@genii-foundation/publisher-next/styles.css";',
        'import type { AppProps } from "next/app";',
        "",
        "export default function PublisherPagesApp({",
        "  Component,",
        "  pageProps,",
        "}: AppProps) {",
        "  return <Component {...pageProps} />;",
        "}",
      ),
    },
    {
      path: "pages/_document.tsx",
      contents: lines(
        'import { Head, Html, Main, NextScript } from "next/document";',
        'import { publisherErrorIdentity } from "../publisher-error-identity";',
        "",
        "export default function PublisherDocument() {",
        "  return (",
        "    <Html lang={publisherErrorIdentity.publication.language}>",
        "      <Head />",
        "      <body>",
        "        <Main />",
        "        <NextScript />",
        "      </body>",
        "    </Html>",
        "  );",
        "}",
      ),
    },
    {
      path: "pages/_error.tsx",
      contents: lines(
        'import { PublisherNextFrameworkErrorPage } from "@genii-foundation/publisher-next/client";',
        'import { publisherErrorIdentity } from "../publisher-error-identity";',
        "",
        "export default function FrameworkError() {",
        "  return (",
        "    <PublisherNextFrameworkErrorPage",
        "      identity={publisherErrorIdentity}",
        "    />",
        "  );",
        "}",
      ),
    },
    {
      path: "pages/404.tsx",
      contents: lines(
        'import { PublisherNextFrameworkErrorPage } from "@genii-foundation/publisher-next/client";',
        'import { publisherErrorIdentity } from "../publisher-error-identity";',
        "",
        "export default function FrameworkNotFound() {",
        "  return (",
        "    <PublisherNextFrameworkErrorPage",
        "      identity={publisherErrorIdentity}",
        "    />",
        "  );",
        "}",
      ),
    },
    {
      path: "pages/500.tsx",
      contents: lines(
        'import { PublisherNextFrameworkErrorPage } from "@genii-foundation/publisher-next/client";',
        'import { publisherErrorIdentity } from "../publisher-error-identity";',
        "",
        "export default function FrameworkServerError() {",
        "  return (",
        "    <PublisherNextFrameworkErrorPage",
        "      identity={publisherErrorIdentity}",
        "    />",
        "  );",
        "}",
      ),
    },
  ];

  // Sorted so the file set, and therefore any hash taken over it, is
  // independent of the order this function happens to build it in.
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );

  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) {
      throw new Error(
        `The Next host contract declares ${file.path} twice.`,
      );
    }
    seen.add(file.path);
  }

  return Object.freeze({
    contractVersion: PUBLISHER_NEXT_HOST_CONTRACT_VERSION,
    renderer: PUBLISHER_NEXT_HOST_RENDERER,
    rendererVersion: PUBLISHER_NEXT_VERSION,
    readerDataPath: PUBLISHER_NEXT_READER_DATA_PATH,
    searchDataPath: PUBLISHER_NEXT_SEARCH_DATA_PATH,
    progressDataPath: PUBLISHER_NEXT_PROGRESS_DATA_PATH,
    publicIdentityDataPath: PUBLISHER_NEXT_PUBLIC_IDENTITY_DATA_PATH,
    extensionDataPath: PUBLISHER_NEXT_EXTENSION_DATA_PATH,
    offlineCatalogHref: PUBLISHER_NEXT_OFFLINE_CATALOG_HREF,
    audioDataPath: PUBLISHER_NEXT_AUDIO_DATA_PATH,
    syncDataPath: PUBLISHER_NEXT_SYNC_DATA_PATH,
    updatesDataPath: PUBLISHER_NEXT_UPDATES_DATA_PATH,
    files: Object.freeze(
      files.map((file) => Object.freeze({ ...file })),
    ),
  });
}
