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
export const PUBLISHER_NEXT_HOST_CONTRACT_VERSION = "0.1.0";

/** The renderer that owns this contract. */
export const PUBLISHER_NEXT_HOST_RENDERER =
  "@genii-foundation/publisher-next";

/** Directory holding the catch-all publication route. */
export const PUBLISHER_NEXT_ROUTE_SEGMENT_DIRECTORY = "[...segments]";

/** Host-relative location of the compiled reader artifact. */
export const PUBLISHER_NEXT_READER_DATA_PATH =
  "publication-reader.json";

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
 * Empty because 0.1.0 is the first contract, so no host can be on an earlier
 * one. An upgrade that does not move contract versions needs no edge, and any
 * other pair is refused for want of a route, which is the right answer until a
 * real contract change adds one.
 *
 * A renderer with nothing to migrate still exports this, empty, rather than
 * omitting it. Absent and empty would then be indistinguishable, and a renderer
 * that misnamed the export would silently upgrade with no route, skipping the
 * manual steps an edge exists to announce.
 */
export const PUBLISHER_NEXT_HOST_MIGRATIONS: readonly PublisherNextHostMigration[] =
  Object.freeze([]);

export interface PublisherNextHostTemplateInput {
  /** Package name for the generated host manifest. */
  readonly hostPackageName: string;
  /** Exact dependency specifiers, including the engine packages and the framework peers. */
  readonly dependencies: Readonly<Record<string, string>>;
  /** Exact development dependency specifiers. */
  readonly devDependencies: Readonly<Record<string, string>>;
  /** Package manager overrides the renderer requires of its host. */
  readonly overrides: unknown;
  /** Error identity input, embedded into the host so it is reviewable in the repository. */
  readonly errorIdentity: unknown;
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
  readonly files: readonly PublisherNextHostFile[];
}

function lines(...values: readonly string[]): string {
  return `${values.join("\n")}\n`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
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
      contents: json({
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
        'import { createPublisherNextConfig, createPublisherNextRoutePlan } from "@genii-foundation/publisher-next/config";',
        "",
        "const routePlan = createPublisherNextRoutePlan(reader);",
        "if (!routePlan.valid) {",
        "  throw new Error(JSON.stringify(routePlan.diagnostics));",
        "}",
        "export default createPublisherNextConfig(routePlan.value);",
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
        `import reader from "./${PUBLISHER_NEXT_READER_DATA_PATH}" with { type: "json" };`,
        'import { createPublicationNextApplication } from "@genii-foundation/publisher-next/server";',
        "",
        "const created = await createPublicationNextApplication({ reader });",
        "if (!created.valid) {",
        "  throw new Error(JSON.stringify(created.diagnostics));",
        "}",
        '/** @type {import("@genii-foundation/publisher-next/server").PublicationNextApplication} */',
        "export const application = created.value;",
      ),
    },
    {
      path: "publisher-error-identity.ts",
      contents: lines(
        'import { createPublisherNextErrorIdentity } from "@genii-foundation/publisher-next/client";',
        "",
        `const result = createPublisherNextErrorIdentity(${JSON.stringify(input.errorIdentity, null, 2)});`,
        "if (!result.valid) {",
        "  throw new Error(JSON.stringify(result.diagnostics));",
        "}",
        "export const publisherErrorIdentity = result.value;",
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
    files: Object.freeze(
      files.map((file) => Object.freeze({ ...file })),
    ),
  });
}
