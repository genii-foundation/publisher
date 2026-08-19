/*
No alternative license is selected for GENII Publisher Original Code. The alternative-license fields in the required Exhibit A notice below are intentionally unpopulated.

“The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/cpal-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is GENII Publisher.
The Original Developer is not the Initial Developer and is __________. If left blank, the Original Developer is the Initial Developer.
The Initial Developer of the Original Code is GENII Foundation. All portions of the code written by GENII Foundation are Copyright (c) 2026 GENII Foundation. All Rights Reserved.
Contributor ______________________.
Alternatively, the contents of this file may be used under the terms of the _____ license (the [___] License), in which case the provisions of [______] License are applicable instead of those above.
If you wish to allow use of your version of this file only under the terms of the [____] License and not to allow others to use your version under the CPAL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the [___] License. If you do not delete the provisions above, a recipient may use your version under either the CPAL or the [___] License.”
*/

import assert from "node:assert/strict";
import test from "node:test";

import {
  createPublisherNextSyncRoutes,
  definePublisherNextHostConfig,
} from "../packages/next/dist/server/sync-routes.js";

const sync = Object.freeze({
  $schema: "https://publisher.genii.foundation/schemas/sync-envelope.schema.json",
  schemaVersion: "1.0",
  publicationId: "field-notes",
  engineVersion: "0.1.0-alpha.0",
  buildId: `sha256:${"a".repeat(64)}`,
  provider: Object.freeze({ package: "@example/provider" }),
  consent: "opt-in",
  localFallback: true,
  capabilities: Object.freeze(["account-deletion", "progress"]),
});

function provider(overrides = {}) {
  return Object.freeze({
    kind: "genii.publisher.sync-provider",
    package: "@example/provider",
    capabilities: Object.freeze([
      "account-deletion",
      "bookmarks",
      "engagement",
      "progress",
    ]),
    async exchangeAuthCode() {
      return true;
    },
    async deleteAccount() {
      return "deleted";
    },
    ...overrides,
  });
}

test("host configuration is closed and never invokes accessors", () => {
  assert.deepEqual(definePublisherNextHostConfig({}), {});
  assert.throws(
    () => definePublisherNextHostConfig({ unknown: true }),
    /unsupported field/u,
  );
  assert.throws(
    () => definePublisherNextHostConfig({
      get syncProvider() {
        throw new Error("secret");
      },
    }),
    /data property/u,
  );
});

test("an absent synchronization artifact produces two opaque dormant routes", async () => {
  const routes = createPublisherNextSyncRoutes({
    get provider() {
      throw new Error("must not inspect a provider while synchronization is absent");
    },
  });
  for (const response of await Promise.all([
    routes.authCallback(new Request("https://reader.example/auth/callback?code=secret")),
    routes.accountDeletion(new Request("https://reader.example/api/account", { method: "DELETE" })),
  ])) {
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found." });
  }
});

test("declared synchronization requires a matching capable provider", () => {
  assert.throws(
    () => createPublisherNextSyncRoutes({ sync }),
    /supplied no provider/u,
  );
  assert.throws(
    () => createPublisherNextSyncRoutes({
      sync,
      provider: provider({ package: "@example/other" }),
    }),
    /does not match/u,
  );
  assert.throws(
    () => createPublisherNextSyncRoutes({
      sync,
      provider: provider({ capabilities: Object.freeze(["progress"]) }),
    }),
    /account-deletion/u,
  );
});

test("the callback bounds its code and owns safe same-origin redirects", async () => {
  const calls = [];
  const routes = createPublisherNextSyncRoutes({
    sync,
    homePath: "/library",
    provider: provider({
      async exchangeAuthCode(input) {
        calls.push(input);
        return true;
      },
    }),
  });
  const response = await routes.authCallback(new Request(
    "https://reader.example/auth/callback?code=abc&next=https%3A%2F%2Fevil.example",
  ));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://reader.example/library");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].code, "abc");
  assert.equal(calls[0].context.publicationId, "field-notes");
  assert.ok(Object.isFrozen(calls[0].context));

  const missing = await routes.authCallback(new Request(
    "https://reader.example/auth/callback?next=/private",
  ));
  assert.equal(missing.headers.get("location"), "https://reader.example/library?auth=error");
  assert.equal(calls.length, 1);
});

test("provider callback failures collapse to one public error redirect", async () => {
  const routes = createPublisherNextSyncRoutes({
    sync,
    provider: provider({
      async exchangeAuthCode() {
        throw new Error("provider secret");
      },
    }),
  });
  const response = await routes.authCallback(new Request(
    "https://reader.example/auth/callback?code=abc",
  ));
  assert.equal(response.headers.get("location"), "https://reader.example/?auth=error");
  assert.equal(await response.text(), "");
});

test("account deletion rejects cross-origin requests before provider execution", async () => {
  let calls = 0;
  const routes = createPublisherNextSyncRoutes({
    sync,
    provider: provider({
      async deleteAccount() {
        calls += 1;
        return "deleted";
      },
    }),
  });
  const response = await routes.accountDeletion(new Request(
    "https://reader.example/api/account",
    { method: "DELETE", headers: { origin: "https://evil.example" } },
  ));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Invalid origin." });
  assert.equal(calls, 0);
});

test("account deletion maps provider outcomes without provider-controlled responses", async () => {
  for (const [result, status, body] of [
    ["deleted", 200, { ok: true }],
    ["unauthorized", 401, { error: "Unauthorized." }],
    ["unavailable", 503, { error: "Synchronization is unavailable." }],
    ["failed", 500, { error: "Account deletion failed." }],
  ]) {
    const routes = createPublisherNextSyncRoutes({
      sync,
      provider: provider({ async deleteAccount() { return result; } }),
    });
    const response = await routes.accountDeletion(new Request(
      "https://reader.example/api/account",
      { method: "DELETE", headers: { origin: "https://reader.example" } },
    ));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
  }
  const invalid = createPublisherNextSyncRoutes({
    sync,
    provider: provider({ async deleteAccount() { return "provider-chosen"; } }),
  });
  const response = await invalid.accountDeletion(new Request(
    "https://reader.example/api/account",
    { method: "DELETE", headers: { origin: "https://reader.example" } },
  ));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Account deletion failed." });
});
