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
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import exportedApplicationManifestSchema from "@genii-foundation/publisher-next/application-manifest.schema.json" with {
  type: "json",
};

import {
  resolveDefaultPublisherNextTheme,
} from "../packages/next/dist/index.js";
import {
  createPublicationNextApplication,
} from "../packages/next/dist/server/application.js";
import {
  createFixtureReader,
} from "./next-fixture.mjs";

const APPLICATION_MANIFEST_SCHEMA_URL =
  "https://publisher.genii.foundation/schemas/next-application-manifest.schema.json";
const APPLICATION_MANIFEST_SCHEMA_EXPORT =
  "./application-manifest.schema.json";
const repositoryRoot = new URL("../", import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(relativePath, repositoryRoot), "utf8"),
  );
}

const [applicationManifestSchema, nextPackageManifest] =
  await Promise.all([
    readJson("packages/next/application-manifest.schema.json"),
    readJson("packages/next/package.json"),
  ]);

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

const validateApplicationManifest = ajv.compile(
  applicationManifestSchema,
);

function validationMessage() {
  return ajv.errorsText(validateApplicationManifest.errors, {
    separator: "\n",
  });
}

function assertValid(manifest) {
  assert.equal(
    validateApplicationManifest(manifest),
    true,
    validationMessage(),
  );
}

function assertInvalid(manifest) {
  assert.equal(
    validateApplicationManifest(manifest),
    false,
    "Expected the application manifest schema to reject the value.",
  );
}

async function createRealApplicationManifest() {
  const created = await createPublicationNextApplication({
    reader: await createFixtureReader({ includeUpdates: false }),
    theme: resolveDefaultPublisherNextTheme(),
  });
  assert.equal(
    created.valid,
    true,
    JSON.stringify(created.diagnostics, null, 2),
  );
  return created.value.manifest;
}

test("the raw schema identity matches its public package export", () => {
  assert.equal(
    applicationManifestSchema.$id,
    APPLICATION_MANIFEST_SCHEMA_URL,
  );
  assert.equal(
    nextPackageManifest.exports[
      APPLICATION_MANIFEST_SCHEMA_EXPORT
    ],
    APPLICATION_MANIFEST_SCHEMA_EXPORT,
  );
  assert.deepEqual(
    exportedApplicationManifestSchema,
    applicationManifestSchema,
  );
});

test("the real Next application manifest satisfies the raw schema", async () => {
  const manifest = await createRealApplicationManifest();
  assert.equal(manifest.theme.apiVersion, "2.0");
  assertValid(manifest);
});

test("the application manifest schema rejects unknown properties", async () => {
  const manifest = await createRealApplicationManifest();
  for (const mutate of [
    (candidate) => {
      candidate.unexpected = true;
    },
    (candidate) => {
      candidate.source.unexpected = true;
    },
    (candidate) => {
      candidate.theme.unexpected = true;
    },
    (candidate) => {
      candidate.continuity.unexpected = true;
    },
  ]) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    assertInvalid(candidate);
  }
});

test("the application manifest schema rejects invalid digests", async () => {
  const manifest = await createRealApplicationManifest();
  const manifestWithUpdates = structuredClone(manifest);
  manifestWithUpdates.updates = {
    package: "@example/updates",
    version: "1.0.0",
    rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
    apiVersion: "1.0",
    configHash: `sha256:${"0".repeat(64)}`,
    viewHash: `sha256:${"1".repeat(64)}`,
  };
  assertValid(manifestWithUpdates);
  for (const mutate of [
    (candidate) => {
      candidate.buildId = "sha256:not-a-digest";
    },
    (candidate) => {
      candidate.source.readerBuildId = `sha256:${"A".repeat(64)}`;
    },
    (candidate) => {
      candidate.theme.configHash = "sha256:1234";
    },
    (candidate) => {
      candidate.theme.tokensHash = "not-a-digest";
    },
  ]) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    assertInvalid(candidate);
  }
  manifestWithUpdates.updates.viewHash = "not-a-digest";
  assertInvalid(manifestWithUpdates);
});

test("the application manifest schema rejects invalid continuity counts", async () => {
  const manifest = await createRealApplicationManifest();
  for (const [field, value] of [
    ["explicitRedirectCount", -1],
    ["explicitRedirectCount", 0.5],
    ["canonicalSlashRedirectCount", -1],
    ["canonicalSlashRedirectCount", 1.25],
  ]) {
    const candidate = structuredClone(manifest);
    candidate.continuity[field] = value;
    assertInvalid(candidate);
  }
});

test("the application manifest schema rejects invalid adapter API and package fields", async () => {
  const manifest = await createRealApplicationManifest();
  for (const mutate of [
    (candidate) => {
      candidate.theme.apiVersion = "1.0";
    },
    (candidate) => {
      candidate.theme.package = "@GENII Foundation/theme";
    },
    (candidate) => {
      candidate.updates = {
        package: "Bad Package",
        version: "1.0.0",
        rendererCompatibility: "^1.0.0",
        apiVersion: "1.0",
        configHash: `sha256:${"0".repeat(64)}`,
      };
    },
    (candidate) => {
      candidate.updates = {
        package: "@example/updates",
        version: "1.0.0",
        rendererCompatibility: "^1.0.0",
        apiVersion: "2.0",
        configHash: `sha256:${"0".repeat(64)}`,
      };
    },
  ]) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    assertInvalid(candidate);
  }
});

test("the application manifest schema records every implemented extension renderer grant", async () => {
  const manifest = structuredClone(
    await createRealApplicationManifest(),
  );
  manifest.extensions = {
    schemaVersion: "1.0",
    buildId: `sha256:${"1".repeat(64)}`,
    entries: [{
      id: "reader-tools",
      package: "@example/reader-tools",
      version: "1.0.0",
      capabilities: [
        "content.project",
        "renderer.slot",
        "renderer.client",
      ],
      projectionHash: `sha256:${"2".repeat(64)}`,
      rendererApiVersion: "1.0",
      rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
      hostApiVersion: null,
      hostCompatibility: null,
    }],
  };
  assertValid(manifest);
  manifest.extensions.entries[0].capabilities.push("host.route");
  manifest.extensions.entries[0].hostApiVersion = "1.0";
  manifest.extensions.entries[0].hostCompatibility =
    ">=0.1.0-alpha.0 <0.2.0";
  assertValid(manifest);
  manifest.extensions.entries[0].capabilities.push("host.handler");
  assertInvalid(manifest);
});
