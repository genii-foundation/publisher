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
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPublicationReader,
  projectPublisherExtensions,
  resolvePublisherExtensions,
} from "../packages/publisher/dist/node.js";
import {
  extensionRegistrationsFor,
} from "./extension-fixture.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const publicationRoot = join(
  repositoryRoot,
  "fixtures",
  "canonical-field-notes",
);

function manifest() {
  return {
    extensions: [
      {
        id: "station-index",
        package: "@example/station-index-extension",
        capabilities: ["content.project"],
      },
    ],
  };
}

function registration(overrides = {}) {
  return {
    id: "station-index",
    package: "@example/station-index-extension",
    version: "1.0.0",
    engineCompatibility: ">=0.1.0-alpha.0 <0.2.0",
    capabilities: ["content.project"],
    implementation: {
      kind: "genii.publisher.extension",
      apiVersion: "1.0",
      project() {
        return {
          valid: true,
          value: { serverData: { marker: "STATION_INDEX_SERVER" } },
          diagnostics: [],
        };
      },
    },
    ...overrides,
  };
}

function assertDiagnostic(result, code) {
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some((item) => item.code === code),
    JSON.stringify(result.diagnostics, null, 2),
  );
}

async function routeProjectionInput({
  capabilities = ["host.route"],
  implementation,
} = {}) {
  const built = await buildPublicationReader({
    publicationRoot,
    audience: "public",
    extensions: [registration()],
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  const content = structuredClone(built.value.content);
  content.extensions[0].capabilities = capabilities;
  return {
    content,
    reader: built.value.reader,
    registrations: [registration({
      capabilities: ["content.project", "host.route"],
      implementation: implementation ?? {
        kind: "genii.publisher.extension",
        apiVersion: "1.0",
        routes() {
          return {
            valid: true,
            value: [],
            diagnostics: [],
          };
        },
      },
    })],
  };
}

async function handlerProjectionInput({
  capabilities = ["host.handler"],
  implementation,
} = {}) {
  const built = await buildPublicationReader({
    publicationRoot,
    audience: "public",
    extensions: [registration()],
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  const content = structuredClone(built.value.content);
  content.extensions[0].capabilities = capabilities;
  return {
    content,
    reader: built.value.reader,
    registrations: [registration({
      capabilities: ["content.project", "host.handler"],
      implementation: implementation ?? {
        kind: "genii.publisher.extension",
        apiVersion: "1.0",
        handlers() {
          return {
            valid: true,
            value: [],
            diagnostics: [],
          };
        },
      },
    })],
  };
}

test("a declaration is never treated as an executable extension registration", async () => {
  const result = await buildPublicationReader({
    publicationRoot,
    audience: "public",
  });
  assertDiagnostic(result, "publisher.extension.resolution_missing");
});

test("explicit registration supplies exact identity and build-bound projection", async () => {
  let received;
  const selected = registration({
    version: "1.2.3",
    implementation: {
      kind: "genii.publisher.extension",
      apiVersion: "1.0",
      project(input) {
        received = input;
        return {
          valid: true,
          value: {
            serverData: {
              publicationId: input.content.publicationId,
              payloadIds: input.payloads.map((payload) => payload.id),
            },
          },
          diagnostics: [],
        };
      },
    },
  });
  const result = await buildPublicationReader({
    publicationRoot,
    audience: "public",
    extensions: [selected],
  });
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.value.content.extensions[0].version, "1.2.3");
  assert.equal(result.value.extensions.envelope.readerBuildId, result.value.reader.buildId);
  assert.equal(result.value.extensions.envelope.publicationId, result.value.reader.publicationId);
  assert.equal(result.value.extensions.envelope.extensions[0].version, "1.2.3");
  assert.deepEqual(
    JSON.parse(result.value.extensions.text),
    JSON.parse(JSON.stringify(result.value.extensions.envelope)),
  );
  assert.ok(Object.isFrozen(received));
  assert.ok(Object.isFrozen(received.config));
  assert.ok(Object.isFrozen(received.payloads));
});

test("registration shape, compatibility, grants, and projectors are closed", () => {
  const cases = [
    {
      value: registration({ package: "@example/wrong" }),
      code: "publisher.extension.resolution_missing",
    },
    {
      value: registration({ version: "v1.0.0" }),
      code: "publisher.extension.registration_identity_invalid",
    },
    {
      value: registration({ engineCompatibility: ">=9" }),
      code: "publisher.extension.registration_identity_invalid",
    },
    {
      value: registration({ capabilities: ["renderer.slot"] }),
      code: "publisher.extension.grant_unsupported",
    },
    {
      value: registration({
        implementation: {
          kind: "genii.publisher.extension",
          apiVersion: "1.0",
        },
      }),
      code: "publisher.extension.projector_missing",
    },
    {
      value: { ...registration(), surprise: true },
      code: "publisher.extension.registration_invalid",
    },
  ];
  for (const item of cases) {
    assertDiagnostic(
      resolvePublisherExtensions(manifest(), [item.value]),
      item.code,
    );
  }
  const hostileRegistry = [];
  Object.defineProperty(hostileRegistry, "0", {
    enumerable: true,
    get() {
      throw new Error("PRIVATE_REGISTRY_SECRET");
    },
  });
  hostileRegistry.length = 1;
  assertDiagnostic(
    resolvePublisherExtensions(manifest(), hostileRegistry),
    "publisher.extension.registry_invalid",
  );
  assertDiagnostic(
    resolvePublisherExtensions(
      {
        extensions: [{
          id: "station-index",
          package: "@example/station-index-extension",
          capabilities: ["host.route"],
        }],
      },
      [registration({
        capabilities: ["host.route"],
        implementation: {
          kind: "genii.publisher.extension",
          apiVersion: "1.0",
        },
      })],
    ),
    "publisher.extension.route_projector_missing",
  );
  assertDiagnostic(
    resolvePublisherExtensions(
      {
        extensions: [{
          id: "station-index",
          package: "@example/station-index-extension",
          capabilities: ["host.handler"],
        }],
      },
      [registration({
        capabilities: ["host.handler"],
        implementation: {
          kind: "genii.publisher.extension",
          apiVersion: "1.0",
        },
      })],
    ),
    "publisher.extension.handler_projector_missing",
  );
});

test("projection failures stay diagnostic and browser data needs its grant", async () => {
  const built = await buildPublicationReader({
    publicationRoot,
    audience: "public",
    extensions: extensionRegistrationsFor(publicationRoot),
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  const base = {
    content: built.value.content,
    reader: built.value.reader,
  };
  const cases = [
    {
      project() {
        throw new Error("secret implementation detail");
      },
      code: "publisher.extension.projector_threw",
    },
    {
      project() {
        return { valid: false, diagnostics: [] };
      },
      code: "publisher.extension.projector_invalid",
    },
    {
      project() {
        const result = { value: {}, diagnostics: [] };
        Object.defineProperty(result, "valid", {
          enumerable: true,
          get() {
            throw new Error("PRIVATE_PROJECTOR_SECRET");
          },
        });
        return result;
      },
      code: "publisher.extension.projector_invalid",
    },
    {
      project() {
        return {
          valid: true,
          value: { serverData: { value: Number.NaN } },
          diagnostics: [],
        };
      },
      code: "publisher.extension.projection_json_invalid",
    },
    {
      project() {
        return {
          valid: true,
          value: { clientData: { marker: "BROWSER" } },
          diagnostics: [],
        };
      },
      code: "publisher.extension.client_data_ungranted",
    },
  ];
  for (const item of cases) {
    const selected = registration({
      implementation: {
        kind: "genii.publisher.extension",
        apiVersion: "1.0",
        project: item.project,
      },
    });
    assertDiagnostic(
      await projectPublisherExtensions({ ...base, registrations: [selected] }),
      item.code,
    );
  }
});

test("projection snapshots are deterministic and detached from extension mutation", async () => {
  const source = { nested: { count: 1 } };
  const selected = registration({
    implementation: {
      kind: "genii.publisher.extension",
      apiVersion: "1.0",
      project() {
        return {
          valid: true,
          value: { serverData: source },
          diagnostics: [],
        };
      },
    },
  });
  const first = await buildPublicationReader({
    publicationRoot,
    audience: "public",
    extensions: [selected],
  });
  const second = await buildPublicationReader({
    publicationRoot,
    audience: "public",
    extensions: [selected],
  });
  assert.ok(first.valid && second.valid);
  assert.equal(first.value.extensions.text, second.value.extensions.text);
  source.nested.count = 2;
  assert.equal(
    first.value.extensions.envelope.extensions[0].serverData.nested.count,
    1,
  );
  assert.ok(
    Object.isFrozen(first.value.extensions.envelope.extensions[0].serverData),
  );
});

test("host.route receives narrow frozen input and emits detached build-bound routes", async () => {
  let received;
  const source = { nested: { count: 1 } };
  const input = await routeProjectionInput({
    implementation: {
      kind: "genii.publisher.extension",
      apiVersion: "1.0",
      routes(value) {
        received = value;
        return {
          valid: true,
          value: [{
            id: "field-station",
            path: "/field-station",
            title: "Field station",
            description: "A declared extension page.",
            data: source,
          }],
          diagnostics: [],
        };
      },
    },
  });
  const result = await projectPublisherExtensions(input);
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(Object.keys(received).sort(), [
    "config",
    "payloads",
    "publication",
  ]);
  assert.ok(Object.isFrozen(received));
  assert.ok(Object.isFrozen(received.config));
  assert.ok(Object.isFrozen(received.payloads));
  const route = result.value.envelope.extensions[0].routes[0];
  assert.equal(route.path, "/field-station");
  assert.ok(Object.isFrozen(route));
  assert.ok(Object.isFrozen(route.data));
  source.nested.count = 2;
  assert.equal(route.data.nested.count, 1);
});

test("host.route collisions, invalid JSON, and thrown projectors fail closed", async () => {
  const cases = [
    {
      routes() {
        return {
          valid: true,
          value: [{ id: "home", path: "/", title: "Collision" }],
          diagnostics: [],
        };
      },
      code: "publisher.extension.route_path_collision",
    },
    {
      routes() {
        return {
          valid: true,
          value: [{
            id: "bad-data",
            path: "/bad-data",
            title: "Bad data",
            data: { value: Number.NaN },
          }],
          diagnostics: [],
        };
      },
      code: "publisher.extension.projection_json_invalid",
    },
    {
      routes() {
        throw new Error("PRIVATE_ROUTE_SECRET");
      },
      code: "publisher.extension.route_projector_threw",
    },
  ];
  for (const item of cases) {
    const input = await routeProjectionInput({
      implementation: {
        kind: "genii.publisher.extension",
        apiVersion: "1.0",
        routes: item.routes,
      },
    });
    assertDiagnostic(await projectPublisherExtensions(input), item.code);
  }
});

test("an ungranted route projector stays inert", async () => {
  let invoked = false;
  const input = await routeProjectionInput({
    capabilities: ["content.project"],
    implementation: {
      kind: "genii.publisher.extension",
      apiVersion: "1.0",
      project() {
        return { valid: true, value: {}, diagnostics: [] };
      },
      routes() {
        invoked = true;
        return { valid: true, value: [], diagnostics: [] };
      },
    },
  });
  const result = await projectPublisherExtensions(input);
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(invoked, false);
  assert.equal(result.value.envelope.extensions[0].routes, undefined);
});

test("host.handler receives narrow frozen input and emits detached build-bound handlers", async () => {
  let received;
  const source = { nested: { count: 1 } };
  const input = await handlerProjectionInput({
    implementation: {
      kind: "genii.publisher.extension",
      apiVersion: "1.0",
      handlers(value) {
        received = value;
        return {
          valid: true,
          value: [{
            id: "echo",
            path: "/api/extensions/station-index/echo",
            methods: ["POST", "PUT"],
            data: source,
          }],
          diagnostics: [],
        };
      },
    },
  });
  const result = await projectPublisherExtensions(input);
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(Object.keys(received).sort(), [
    "config",
    "payloads",
    "publication",
  ]);
  assert.ok(Object.isFrozen(received));
  assert.ok(Object.isFrozen(received.config));
  assert.ok(Object.isFrozen(received.payloads));
  const handler = result.value.envelope.extensions[0].handlers[0];
  assert.deepEqual(handler, {
    id: "echo",
    path: "/api/extensions/station-index/echo",
    methods: ["POST", "PUT"],
    data: { nested: { count: 1 } },
  });
  assert.ok(Object.isFrozen(handler));
  assert.ok(Object.isFrozen(handler.methods));
  assert.ok(Object.isFrozen(handler.data));
  source.nested.count = 2;
  assert.equal(handler.data.nested.count, 1);
});

test("host.handler identity, collisions, data, and projectors fail closed", async () => {
  const cases = [
    {
      handler: {
        id: "wrong-owner",
        path: "/api/extensions/another-extension/echo",
        methods: ["POST"],
      },
      code: "publisher.extension.handler_identity_invalid",
    },
    {
      handler: {
        id: "trailing",
        path: "/api/extensions/station-index/trailing/",
        methods: ["POST"],
      },
      code: "publisher.extension.handler_identity_invalid",
    },
    {
      handler: {
        id: "methods",
        path: "/api/extensions/station-index/methods",
        methods: ["POST", "POST"],
      },
      code: "publisher.extension.handler_identity_invalid",
    },
    {
      handler: {
        id: "bad-data",
        path: "/api/extensions/station-index/bad-data",
        methods: ["POST"],
        data: { value: Number.NaN },
      },
      code: "publisher.extension.projection_json_invalid",
    },
  ];
  for (const item of cases) {
    const input = await handlerProjectionInput({
      implementation: {
        kind: "genii.publisher.extension",
        apiVersion: "1.0",
        handlers() {
          return { valid: true, value: [item.handler], diagnostics: [] };
        },
      },
    });
    assertDiagnostic(await projectPublisherExtensions(input), item.code);
  }

  const thrown = await handlerProjectionInput({
    implementation: {
      kind: "genii.publisher.extension",
      apiVersion: "1.0",
      handlers() {
        throw new Error("PRIVATE_HANDLER_PROJECTOR_SECRET");
      },
    },
  });
  assertDiagnostic(
    await projectPublisherExtensions(thrown),
    "publisher.extension.handler_projector_threw",
  );
});

test("an ungranted handler projector stays inert", async () => {
  let invoked = false;
  const input = await handlerProjectionInput({
    capabilities: ["content.project"],
    implementation: {
      kind: "genii.publisher.extension",
      apiVersion: "1.0",
      project() {
        return { valid: true, value: {}, diagnostics: [] };
      },
      handlers() {
        invoked = true;
        return { valid: true, value: [], diagnostics: [] };
      },
    },
  });
  const result = await projectPublisherExtensions(input);
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(invoked, false);
  assert.equal(result.value.envelope.extensions[0].handlers, undefined);
});
