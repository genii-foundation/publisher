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

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PUBLISHER_NEXT_HOST_CONTRACT_VERSION,
  PUBLISHER_NEXT_HOST_CAPABILITIES,
  PUBLISHER_NEXT_HOST_MIGRATIONS,
  PUBLISHER_NEXT_HOST_RENDERER,
  PUBLISHER_NEXT_EXTENSION_DATA_PATH,
  PUBLISHER_NEXT_OFFLINE_CATALOG_HREF,
  PUBLISHER_NEXT_OFFLINE_SERVICE_WORKER_PATH,
  PUBLISHER_NEXT_READER_DATA_PATH,
  PUBLISHER_NEXT_PROGRESS_DATA_PATH,
  PUBLISHER_NEXT_PUBLIC_IDENTITY_DATA_PATH,
  PUBLISHER_NEXT_SEARCH_DATA_PATH,
  PUBLISHER_NEXT_ROUTE_SEGMENT_DIRECTORY,
  createPublisherNextHostTemplate,
} from "../packages/next/dist/host.js";

const nextManifest = JSON.parse(
  await readFile(
    new URL("../packages/next/package.json", import.meta.url),
    "utf8",
  ),
);

const input = Object.freeze({
  hostPackageName: "probe-host",
  dependencies: Object.freeze({
    "@genii-foundation/publisher-next": "0.1.0-alpha.0",
    next: "16.3.1",
  }),
  devDependencies: Object.freeze({ typescript: "5.9.4" }),
  overrides: Object.freeze({ postcss: "8.5.24" }),
});

function template(overrides = {}) {
  return createPublisherNextHostTemplate({
    ...input,
    ...overrides,
  });
}

function contentsOf(result, path) {
  const file = result.files.find(
    (entry) => entry.path === path,
  );
  assert.ok(file, `expected the contract to declare ${path}`);
  return file.contents;
}

test("the host contract declares exactly the author host file set", () => {
  const result = template();
  assert.deepEqual(
    result.files.map(({ path }) => path),
    [
      `app/${PUBLISHER_NEXT_ROUTE_SEGMENT_DIRECTORY}/page.tsx`,
      "app/api/account/route.ts",
      "app/api/auth/start/route.ts",
      "app/api/auth/verify/route.ts",
      "app/api/session/route.ts",
      "app/api/sync/route.ts",
      "app/auth/callback/route.ts",
      "app/error.tsx",
      "app/global-error.tsx",
      "app/layout.tsx",
      "app/not-found.tsx",
      "app/page.tsx",
      "app/publication-reader-offline.json/route.ts",
      "next-env.d.ts",
      "next.config.mjs",
      "package.json",
      "pages/404.tsx",
      "pages/500.tsx",
      "pages/_app.tsx",
      "pages/_document.tsx",
      "pages/_error.tsx",
      "proxy.ts",
      "public/offline-sw.js",
      "publisher-application.js",
      "publisher-config.d.ts",
      "publisher-default-config.js",
      "publisher-default-extensions.js",
      "publisher-default-theme.js",
      "publisher-error-identity.ts",
      "publisher-extensions.d.ts",
      "publisher-sync-routes.js",
      "publisher-theme.d.ts",
      "tsconfig.json",
    ],
  );
  assert.equal(
    result.contractVersion,
    PUBLISHER_NEXT_HOST_CONTRACT_VERSION,
  );
  assert.equal(result.renderer, PUBLISHER_NEXT_HOST_RENDERER);
  assert.equal(result.rendererVersion, nextManifest.version);
  assert.equal(
    result.readerDataPath,
    PUBLISHER_NEXT_READER_DATA_PATH,
  );
  assert.equal(result.searchDataPath, PUBLISHER_NEXT_SEARCH_DATA_PATH);
  assert.equal(result.progressDataPath, PUBLISHER_NEXT_PROGRESS_DATA_PATH);
  assert.equal(
    result.publicIdentityDataPath,
    PUBLISHER_NEXT_PUBLIC_IDENTITY_DATA_PATH,
  );
  assert.equal(result.extensionDataPath, PUBLISHER_NEXT_EXTENSION_DATA_PATH);
  assert.equal(result.offlineCatalogHref, PUBLISHER_NEXT_OFFLINE_CATALOG_HREF);
  assert.equal(PUBLISHER_NEXT_OFFLINE_SERVICE_WORKER_PATH, "public/offline-sw.js");
  assert.ok(PUBLISHER_NEXT_HOST_CAPABILITIES.dataArtifacts.includes("offline"));
  assert.ok(PUBLISHER_NEXT_HOST_CAPABILITIES.dataArtifacts.includes("search"));
  assert.ok(PUBLISHER_NEXT_HOST_CAPABILITIES.dataArtifacts.includes("progress"));
  assert.ok(PUBLISHER_NEXT_HOST_CAPABILITIES.dataArtifacts.includes("extensions"));
  assert.ok(PUBLISHER_NEXT_HOST_CAPABILITIES.routeKinds.includes("extension"));
  assert.deepEqual(PUBLISHER_NEXT_HOST_MIGRATIONS, [
    {
      from: "0.1.0",
      to: "0.2.0",
      summary:
        "Add the required lazy search artifact destination to the official host contract.",
    },
    {
      from: "0.2.0",
      to: "0.3.0",
      summary:
        "Add the server-side Updates artifact and connect it to the generated application.",
    },
    {
      from: "0.3.0",
      to: "0.4.0",
      summary:
        "Add dormant fail-closed synchronization route surfaces to every official host.",
    },
    {
      from: "0.4.0",
      to: "0.5.0",
      summary:
        "Bind synchronization routes to optional author-owned host configuration through a server-only provider contract.",
      manualSteps: [
        "Regenerate and review package-lock.json so the required Nano ID 3.3.18 override is installed.",
      ],
    },
    {
      from: "0.5.0",
      to: "0.6.0",
      summary:
        "Add provider-neutral email authentication and session route surfaces for the default reader controls.",
    },
    {
      from: "0.6.0",
      to: "0.7.0",
      summary:
        "Add provider-neutral publication-scoped Reader data transfer routes.",
    },
    {
      from: "0.7.0",
      to: "0.8.0",
      summary:
        "Add the required lazy progress catalog destination to the official host contract.",
    },
    {
      from: "0.8.0",
      to: "0.9.0",
      summary:
        "Add the build-bound offline catalog route and generic service worker to the official host contract.",
    },
    {
      from: "0.9.0",
      to: "0.10.0",
      summary:
        "Connect an explicit author theme module and client-safe public identity artifact to every official host surface.",
      manualSteps: [
        "Add publisher.theme.mjs only when selecting a separately installed custom theme package.",
      ],
    },
    {
      from: "0.10.0",
      to: "0.11.0",
      summary:
        "Connect explicit author extension registration and build-bound server slot data to the official host.",
      manualSteps: [
        "Add publisher.extensions.mjs when the publication manifest declares extensions, importing each separately installed extension package explicitly.",
      ],
    },
    {
      from: "0.11.0",
      to: "0.12.0",
      summary:
        "Declare the device-width viewport required by mobile Reader controls and extension surfaces.",
    },
    {
      from: "0.12.0",
      to: "0.13.0",
      summary:
        "Add build-time declarative extension pages to the official route plan.",
    },
    {
      from: "0.13.0",
      to: "0.14.0",
      summary:
        "Await closed extension request handlers in the official Proxy boundary.",
    },
    {
      from: "0.14.0",
      to: "0.15.0",
      summary:
        "Connect an optional build-bound Reader state bootstrap through the server-only author configuration.",
      manualSteps: [
        "Add readerStateBootstrap to publisher.config.ts only while an explicit legacy local-state compatibility window is active.",
      ],
    },
    {
      from: "0.15.0",
      to: "0.16.0",
      summary:
        "Refresh the checked Next declaration file for the exact Next.js 16.3.1 generated type roots.",
    },
    {
      from: "0.16.0",
      to: "0.17.0",
      summary:
        "Extend the Reader state bootstrap input contract with an optional separately bounded state projection.",
      manualSteps: [
        "If readerStateBootstrap is configured, update its implementation apiVersion from 1.0 to 1.1 and review the optional createProjection input before acknowledging this migration.",
      ],
    },
  ]);
});

test("the checked Next declaration file matches the exact framework generator", () => {
  assert.equal(
    contentsOf(template(), "next-env.d.ts"),
    [
      '/// <reference types="next" />',
      '/// <reference types="next/image-types/global" />',
      '/// <reference types="next/navigation-types/compat/navigation" />',
      'import "./.next/types/routes.d.ts";',
      'import "./.next/types/root-params.d.ts";',
      "",
      "// NOTE: This file should not be edited",
      "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
      "",
    ].join("\n"),
  );
});

test("the Proxy awaits closed request dispatch before falling through", () => {
  const proxy = contentsOf(template(), "proxy.ts");
  assert.match(proxy, /export async function proxy\(request: NextRequest\)/u);
  assert.match(proxy, /await application\.handleRequest\(request\)/u);
  assert.match(proxy, /\?\? NextResponse\.next\(\)/u);
});

test("the App Router layout declares the mobile viewport", () => {
  const layout = contentsOf(template(), "app/layout.tsx");
  assert.match(layout, /import type \{ Viewport \} from "next";/u);
  assert.match(layout, /export const viewport: Viewport = \{/u);
  assert.match(layout, /initialScale: 1/u);
  assert.match(layout, /width: "device-width"/u);
});

test("offline host files expose only generic cache and catalog contracts", () => {
  const result = template();
  const route = contentsOf(result, "app/publication-reader-offline.json/route.ts");
  assert.match(route, /createReaderOfflineCatalog/u);
  assert.match(route, /rendererBuildId/u);
  assert.doesNotMatch(route, /publisher-application|next\/link|next\/navigation/u);
  assert.match(route, /reader-offline\+json/u);
  const worker = contentsOf(result, PUBLISHER_NEXT_OFFLINE_SERVICE_WORKER_PATH);
  assert.match(worker, /networkFirst/u);
  assert.match(worker, /searchParams\.has\("_rsc"\)/u);
  assert.match(worker, /headers\.get\("rsc"\)/u);
  assert.match(worker, /next-router-state-tree/u);
  assert.match(worker, /response\.status !== 206/u);
  assert.match(worker, /if \(request\.headers\.has\("range"\)\) return false;/u);
  assert.match(worker, /request\.headers\.has\("range"\)/u);
  assert.match(worker, /matchActivePackage/u);
  assert.match(worker, /genii-publisher-offline-metadata-v1/u);
  assert.doesNotMatch(worker, /coherence|manuscripts|audio-clips/ui);
});

test("synchronization routes delegate through the checked server-only bridge", () => {
  const result = template();
  for (const path of [
    "app/auth/callback/route.ts",
    "app/api/account/route.ts",
    "app/api/auth/start/route.ts",
    "app/api/auth/verify/route.ts",
    "app/api/session/route.ts",
    "app/api/sync/route.ts",
  ]) {
    const contents = contentsOf(result, path);
    assert.match(contents, /publisher-sync-routes\.js/u);
    assert.doesNotMatch(contents, /supabase|credential|environment/ui);
  }
  const bridge = contentsOf(result, "publisher-sync-routes.js");
  assert.match(bridge, /genii-publisher:config/u);
  assert.match(bridge, /publication-sync\.json/u);
  assert.match(bridge, /createPublisherNextSyncRoutes/u);
  const nextConfig = contentsOf(result, "next.config.mjs");
  assert.match(nextConfig, /publisher\.config\.ts/u);
  assert.match(nextConfig, /publisher-default-config\.js/u);
  assert.match(nextConfig, /publisher\.theme\.mjs/u);
  assert.match(nextConfig, /publisher-default-theme\.js/u);
  assert.match(nextConfig, /publisher\.extensions\.mjs/u);
  assert.match(nextConfig, /publisher-default-extensions\.js/u);
  assert.match(nextConfig, /genii-publisher:extensions/u);
  assert.match(nextConfig, /genii-publisher:theme/u);
  assert.match(nextConfig, /publication-public-identity\.json/u);
  assert.match(nextConfig, /does not match the exact Reader build/u);
  assert.match(nextConfig, /resolveAlias/u);
});

test("the file list is sorted, unique, and frozen", () => {
  const result = template();
  const paths = result.files.map(({ path }) => path);
  assert.deepEqual(paths, [...paths].sort());
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.files));
  for (const file of result.files) {
    assert.ok(Object.isFrozen(file));
  }
});

test("the same input produces byte-identical output", () => {
  // Upgrade detection compares a host on disk against this output, so any
  // instability here would read as an author having modified their host.
  const digest = (result) => {
    const hash = createHash("sha256");
    for (const file of result.files) {
      hash.update(file.path);
      hash.update("\0");
      hash.update(file.contents);
      hash.update("\0");
    }
    return hash.digest("hex");
  };
  assert.equal(digest(template()), digest(template()));
});

test("the contract carries no proof scaffolding", () => {
  const result = template();
  const joined = result.files
    .map(({ contents }) => contents)
    .join("\n");
  for (const marker of [
    "PUBLISHER_GLOBAL_ERROR_PROOF",
    "PACKAGED_GLOBAL_ERROR_SECRET",
    "PACKAGED_RUNTIME_ERROR_SECRET",
    "declaration-probe",
    "export-probe",
    "server-import-probe",
    "proof.png",
  ]) {
    assert.equal(
      joined.includes(marker),
      false,
      `an author host must not receive ${marker}`,
    );
  }
  for (const path of result.files.map(({ path }) => path)) {
    assert.equal(
      path.includes("probe"),
      false,
      `an author host must not receive ${path}`,
    );
  }
  // The reader artifact is generated publication data, not a template file.
  assert.equal(
    result.files.some(
      ({ path }) => path === PUBLISHER_NEXT_READER_DATA_PATH,
    ),
    false,
  );
});

test("declared inputs reach the files that need them", () => {
  const manifest = JSON.parse(
    contentsOf(template(), "package.json"),
  );
  assert.equal(manifest.name, "probe-host");
  assert.deepEqual(manifest.dependencies, {
    ...input.dependencies,
  });
  assert.deepEqual(manifest.devDependencies, {
    ...input.devDependencies,
  });
  assert.deepEqual(manifest.overrides, {
    ...input.overrides,
  });
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");

  const existingManifest = '{"name":"existing-host","private":true,"custom":"kept"}\n';
  assert.equal(
    contentsOf(
      template({ packageJsonText: existingManifest }),
      "package.json",
    ),
    existingManifest,
  );

  const application = contentsOf(template(), "publisher-application.js");
  assert.match(application, /genii-publisher:theme/u);
  assert.match(application, /genii-publisher:extensions/u);
  assert.match(application, /genii-publisher:config/u);
  assert.match(
    application,
    /readerStateBootstrap: publisherConfig\.readerStateBootstrap/u,
  );
  assert.match(application, /publication-extensions\.json/u);
  assert.match(application, /extensionData, extensions/u);

  const identity = contentsOf(template(), "publisher-error-identity.ts");
  assert.match(identity, /publication-public-identity\.json/u);
  assert.match(identity, /genii-publisher:theme/u);
  assert.equal(identity.includes("manuscript"), false);

  const renamed = template({
    hostPackageName: "another-host",
  });
  assert.equal(
    JSON.parse(contentsOf(renamed, "package.json")).name,
    "another-host",
  );
});

test("every file that reads the reader artifact points at the declared path", () => {
  const result = template();
  for (const path of [
    "next.config.mjs",
    "publisher-application.js",
  ]) {
    assert.ok(
      contentsOf(result, path).includes(
        `./${PUBLISHER_NEXT_READER_DATA_PATH}`,
      ),
      `${path} must import the reader artifact from the declared path`,
    );
  }
});

test("every declared file ends with exactly one trailing newline", () => {
  // Host files are compared by content hash during upgrade, so a stray or
  // missing terminator would present as a local modification.
  for (const file of template().files) {
    assert.ok(
      file.contents.endsWith("\n"),
      `${file.path} must end with a newline`,
    );
    assert.equal(
      file.contents.endsWith("\n\n"),
      false,
      `${file.path} must not end with a blank line`,
    );
  }
});
