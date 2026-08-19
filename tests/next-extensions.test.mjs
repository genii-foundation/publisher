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
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  hashCanonicalJson,
} from "../packages/content/dist/index.js";
import {
  buildPublicationReader,
} from "../packages/publisher/dist/node.js";
import {
  createPublicationNextApplication,
} from "../packages/next/dist/server/application.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function extensionRegistration({
  id,
  packageName,
  capabilities,
  calls = [],
  clientCalls = [],
  clientMarker = "EXTENSION_CLIENT_DATA",
  serverMarker = "EXTENSION_SERVER_DATA",
  renderer = true,
  rendererCompatibility = ">=0.1.0-alpha.0 <0.2.0",
}) {
  return {
    id,
    package: packageName,
    version: "1.0.0",
    engineCompatibility: ">=0.1.0-alpha.0 <0.2.0",
    capabilities,
    implementation: {
      kind: "genii.publisher.extension",
      apiVersion: "1.0",
      project({ content, config }) {
        return {
          valid: true,
          value: {
            serverData: {
              marker: serverMarker,
              publicationId: content.publicationId,
              config,
            },
            ...(capabilities.includes("renderer.client")
              ? {
                  clientData: {
                    marker: clientMarker,
                    publicationId: content.publicationId,
                  },
                }
              : {}),
          },
          diagnostics: [],
        };
      },
    },
    ...(renderer
      ? {
          renderer: {
            kind: "genii.publisher.next-extension",
            apiVersion: "1.0",
            rendererCompatibility,
            Client(input) {
              clientCalls.push(input);
              return createElement(
                "button",
                {
                  "data-extension-client": input.clientData?.marker,
                  type: "button",
                },
                `${input.mount}:${input.page.path}`,
              );
            },
            renderSlot(input) {
              calls.push(input);
              return createElement(
                "p",
                { "data-extension-marker": serverMarker },
                `${input.slot}:${input.serverData.marker}`,
              );
            },
          },
        }
      : {}),
  };
}

function clientFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "publisher-client-extension-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const publicationRoot = join(root, "publication");
  cpSync(
    join(repositoryRoot, "fixtures", "canonical-field-notes"),
    publicationRoot,
    { recursive: true },
  );
  const manifestPath = join(publicationRoot, "publication.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.extensions[0].capabilities = [
    "content.project",
    "renderer.client",
  ];
  writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return publicationRoot;
}

async function buildFixture(name, registration) {
  const built = await buildPublicationReader({
    publicationRoot: join(repositoryRoot, "fixtures", name),
    audience: "public",
    extensions: [registration],
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  return built.value;
}

async function createFromBuild(built, registrations) {
  return createPublicationNextApplication({
    reader: built.reader,
    extensionData: built.extensions.envelope,
    extensions: registrations,
    ...(built.updates === undefined
      ? {}
      : { updatesData: built.updates.envelope }),
  });
}

function assertDiagnostic(result, code) {
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, code, JSON.stringify(result.diagnostics));
}

test("granted server slots render inside main with a narrow immutable context", async () => {
  const calls = [];
  const registration = extensionRegistration({
    id: "margin-notes",
    packageName: "@example/margin-notes-extension",
    capabilities: ["content.project", "renderer.slot"],
    calls,
  });
  const built = await buildFixture("declared-night-dispatch", registration);
  const created = await createFromBuild(built, [registration]);
  assert.ok(created.valid, JSON.stringify(created.diagnostics, null, 2));
  const resolved = created.value.resolveRoute(undefined);
  assert.equal(resolved.status, "resolved");
  const html = renderToStaticMarkup(
    await created.value.renderPage(resolved.page),
  );
  assert.match(
    html,
    /data-publisher-extension="margin-notes" data-publisher-slot="page.before-main"/u,
  );
  assert.match(
    html,
    /data-publisher-extension="margin-notes" data-publisher-slot="page.after-main"/u,
  );
  assert.ok(
    html.indexOf("page.before-main") < html.indexOf("<h1"),
    html,
  );
  assert.ok(
    html.indexOf("page.after-main") < html.indexOf("publisher-attribution"),
    html,
  );
  assert.equal(calls.length, 2);
  for (const input of calls) {
    assert.ok(Object.isFrozen(input));
    assert.ok(Object.isFrozen(input.page));
    assert.deepEqual(Object.keys(input.page).sort(), [
      "kind",
      "path",
      "publication",
    ]);
    assert.equal(Object.hasOwn(input.page, "works"), false);
    assert.equal(Object.hasOwn(input.page, "blocks"), false);
    assert.equal(input.serverData.marker, "EXTENSION_SERVER_DATA");
  }
  assert.equal(created.value.manifest.extensions.entries[0].id, "margin-notes");
  assert.equal(
    created.value.manifest.extensions.entries[0].rendererApiVersion,
    "1.0",
  );
});

test("work slot context carries identity but no manuscript body", async () => {
  const calls = [];
  const registration = extensionRegistration({
    id: "margin-notes",
    packageName: "@example/margin-notes-extension",
    capabilities: ["content.project", "renderer.slot"],
    calls,
  });
  const built = await buildFixture("declared-night-dispatch", registration);
  const created = await createFromBuild(built, [registration]);
  assert.ok(created.valid);
  const workRoute = created.value.reader.routes.active.find(
    ({ target }) => target.kind === "work",
  );
  assert.ok(workRoute);
  const segments = workRoute.path
    .slice(1, workRoute.path.endsWith("/") ? -1 : undefined)
    .split("/")
    .map(decodeURIComponent);
  const resolved = created.value.resolveRoute(segments);
  assert.equal(resolved.status, "resolved");
  await created.value.renderPage(resolved.page);
  const input = calls.at(-1);
  assert.deepEqual(Object.keys(input.page).sort(), [
    "kind",
    "path",
    "publication",
    "work",
  ]);
  assert.deepEqual(Object.keys(input.page.work).sort(), ["id", "title"]);
  assert.equal(JSON.stringify(input.page).includes("blocks"), false);
  assert.equal(JSON.stringify(input.page).includes("markdown"), false);
});

test("granted client code receives only its browser projection at one fixed mount", async (t) => {
  const clientCalls = [];
  const registration = extensionRegistration({
    id: "station-index",
    packageName: "@example/station-index-extension",
    capabilities: ["content.project", "renderer.client"],
    clientCalls,
  });
  const built = await buildPublicationReader({
    publicationRoot: clientFixture(t),
    audience: "public",
    extensions: [registration],
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  const created = await createFromBuild(built.value, [registration]);
  assert.ok(created.valid, JSON.stringify(created.diagnostics, null, 2));
  const resolved = created.value.resolveRoute(undefined);
  assert.equal(resolved.status, "resolved");
  const html = renderToStaticMarkup(
    await created.value.renderPage(resolved.page),
  );
  assert.match(
    html,
    /data-publisher-client="page\.client" data-publisher-extension="station-index"/u,
  );
  assert.match(
    html,
    /data-extension-client="EXTENSION_CLIENT_DATA"/u,
  );
  assert.doesNotMatch(html, /EXTENSION_SERVER_DATA/u);
  assert.equal(clientCalls.length, 1);
  const input = clientCalls[0];
  assert.deepEqual(Object.keys(input).sort(), [
    "clientData",
    "mount",
    "page",
  ]);
  assert.equal(input.mount, "page.client");
  assert.equal(input.clientData.marker, "EXTENSION_CLIENT_DATA");
  assert.equal(Object.hasOwn(input, "serverData"), false);
  assert.equal(Object.hasOwn(input.page, "blocks"), false);
  assert.equal(Object.hasOwn(input.page, "reader"), false);
  assert.equal(
    created.value.manifest.extensions.entries[0].capabilities.includes(
      "renderer.client",
    ),
    true,
  );
});

test("an ungranted renderer object never widens content.project authority", async () => {
  const calls = [];
  const registration = extensionRegistration({
    id: "station-index",
    packageName: "@example/station-index-extension",
    capabilities: ["content.project", "renderer.slot"],
    calls,
  });
  const built = await buildFixture("canonical-field-notes", registration);
  const created = await createFromBuild(built, [registration]);
  assert.ok(created.valid, JSON.stringify(created.diagnostics, null, 2));
  const resolved = created.value.resolveRoute(undefined);
  assert.equal(resolved.status, "resolved");
  const html = renderToStaticMarkup(
    await created.value.renderPage(resolved.page),
  );
  assert.equal(calls.length, 0);
  assert.doesNotMatch(html, /data-publisher-extension/u);
  assert.equal(
    created.value.manifest.extensions.entries[0].rendererApiVersion,
    null,
  );
});

test("artifact identity, registry identity, grants, and adapters fail closed", async () => {
  const registration = extensionRegistration({
    id: "margin-notes",
    packageName: "@example/margin-notes-extension",
    capabilities: ["content.project", "renderer.slot"],
  });
  const built = await buildFixture("declared-night-dispatch", registration);
  const tampered = structuredClone(built.extensions.envelope);
  tampered.extensions[0].serverData.marker = "TAMPERED";
  assertDiagnostic(
    await createPublicationNextApplication({
      reader: built.reader,
      extensionData: tampered,
      extensions: [registration],
      updatesData: built.updates.envelope,
    }),
    "next.extension.data_hash_mismatch",
  );
  const ungrantedClientData = structuredClone(
    built.extensions.envelope,
  );
  ungrantedClientData.extensions[0].clientData = {
    marker: "UNGRANTED",
  };
  ungrantedClientData.buildId = hashCanonicalJson({
    schemaVersion: ungrantedClientData.schemaVersion,
    publicationId: ungrantedClientData.publicationId,
    engineVersion: ungrantedClientData.engineVersion,
    readerBuildId: ungrantedClientData.readerBuildId,
    extensions: ungrantedClientData.extensions,
  });
  assertDiagnostic(
    await createPublicationNextApplication({
      reader: built.reader,
      extensionData: ungrantedClientData,
      extensions: [registration],
      updatesData: built.updates.envelope,
    }),
    "next.extension.client_data_ungranted",
  );
  assertDiagnostic(
    await createFromBuild(built, []),
    "next.extension.registration_set_invalid",
  );
  assertDiagnostic(
    await createFromBuild(built, [{ ...registration, package: "@example/wrong" }]),
    "next.extension.identity_invalid",
  );
  assertDiagnostic(
    await createFromBuild(built, [{ ...registration, renderer: undefined }]),
    "next.extension.renderer_invalid",
  );
  assertDiagnostic(
    await createFromBuild(built, [extensionRegistration({
      id: "margin-notes",
      packageName: "@example/margin-notes-extension",
      capabilities: ["content.project", "renderer.slot"],
      rendererCompatibility: ">=9",
    })]),
    "next.extension.renderer_invalid",
  );
});

test("a client grant requires a compatible client component", async (t) => {
  const registration = extensionRegistration({
    id: "station-index",
    packageName: "@example/station-index-extension",
    capabilities: ["content.project", "renderer.client"],
  });
  const built = await buildPublicationReader({
    publicationRoot: clientFixture(t),
    audience: "public",
    extensions: [registration],
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  assertDiagnostic(
    await createFromBuild(built.value, [{
      ...registration,
      renderer: {
        ...registration.renderer,
        Client: undefined,
      },
    }]),
    "next.extension.renderer_invalid",
  );
});

test("extension projection and renderer identity participate in application identity", async () => {
  const firstRegistration = extensionRegistration({
    id: "margin-notes",
    packageName: "@example/margin-notes-extension",
    capabilities: ["content.project", "renderer.slot"],
    serverMarker: "FIRST",
  });
  const secondRegistration = extensionRegistration({
    id: "margin-notes",
    packageName: "@example/margin-notes-extension",
    capabilities: ["content.project", "renderer.slot"],
    serverMarker: "SECOND",
  });
  const firstBuild = await buildFixture("declared-night-dispatch", firstRegistration);
  const secondBuild = await buildFixture("declared-night-dispatch", secondRegistration);
  const first = await createFromBuild(firstBuild, [firstRegistration]);
  const second = await createFromBuild(secondBuild, [secondRegistration]);
  assert.ok(first.valid && second.valid);
  assert.notEqual(
    first.value.manifest.extensions.buildId,
    second.value.manifest.extensions.buildId,
  );
  assert.notEqual(first.value.manifest.buildId, second.value.manifest.buildId);
});

test("slot failures identify the extension without leaking the thrown value", async () => {
  const registration = extensionRegistration({
    id: "margin-notes",
    packageName: "@example/margin-notes-extension",
    capabilities: ["content.project", "renderer.slot"],
  });
  registration.renderer.renderSlot = () => {
    throw new Error("PRIVATE_RENDERER_SECRET");
  };
  const built = await buildFixture("declared-night-dispatch", registration);
  const created = await createFromBuild(built, [registration]);
  assert.ok(created.valid);
  const resolved = created.value.resolveRoute(undefined);
  assert.equal(resolved.status, "resolved");
  await assert.rejects(
    () => created.value.renderPage(resolved.page),
    (error) => {
      assert.match(error.message, /margin-notes/u);
      assert.doesNotMatch(error.message, /PRIVATE_RENDERER_SECRET/u);
      return true;
    },
  );
});
