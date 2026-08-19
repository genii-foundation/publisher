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
  PUBLISHER_NEXT_READER_DATA_PATH,
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
    next: "16.2.12",
  }),
  devDependencies: Object.freeze({ typescript: "5.9.4" }),
  overrides: Object.freeze({ postcss: "8.5.24" }),
  errorIdentity: Object.freeze({
    publication: Object.freeze({ language: "en" }),
  }),
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
      "app/auth/callback/route.ts",
      "app/error.tsx",
      "app/global-error.tsx",
      "app/layout.tsx",
      "app/not-found.tsx",
      "app/page.tsx",
      "next-env.d.ts",
      "next.config.mjs",
      "package.json",
      "pages/404.tsx",
      "pages/500.tsx",
      "pages/_app.tsx",
      "pages/_document.tsx",
      "pages/_error.tsx",
      "proxy.ts",
      "publisher-application.js",
      "publisher-error-identity.ts",
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
  assert.ok(PUBLISHER_NEXT_HOST_CAPABILITIES.dataArtifacts.includes("search"));
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
  ]);
});

test("dormant synchronization routes fail closed without provider detail", () => {
  const result = template();
  for (const path of [
    "app/auth/callback/route.ts",
    "app/api/account/route.ts",
  ]) {
    const contents = contentsOf(result, path);
    assert.match(contents, /status: 404/u);
    assert.match(contents, /Not found\./u);
    assert.doesNotMatch(contents, /provider|supabase|credential|environment/ui);
  }
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

  const identity = contentsOf(
    template(),
    "publisher-error-identity.ts",
  );
  assert.ok(identity.includes('"language": "en"'));

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
