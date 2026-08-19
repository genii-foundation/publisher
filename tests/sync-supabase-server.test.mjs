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
  createPublisherSupabaseSyncProvider,
} from "../packages/sync-supabase/server.mjs";

const configuredEnvironment = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
});

function options(overrides = {}) {
  return {
    environment: configuredEnvironment,
    async cookies() {
      return { getAll() { return []; }, set() {} };
    },
    createServerClient() {
      return {
        auth: {
          async exchangeCodeForSession() { return { error: null }; },
          async getUser() { return { data: { user: { id: "reader-1" } }, error: null }; },
          async signOut() { return { error: null }; },
        },
      };
    },
    createClient() {
      return {
        auth: { admin: { async deleteUser() { return { error: null }; } } },
      };
    },
    ...overrides,
  };
}

test("the reference provider declares the exact closed identity and capabilities", () => {
  const provider = createPublisherSupabaseSyncProvider(options());
  assert.equal(provider.kind, "genii.publisher.sync-provider");
  assert.equal(provider.package, "@genii-foundation/publisher-sync-supabase");
  assert.deepEqual(provider.capabilities, [
    "account-deletion",
    "bookmarks",
    "engagement",
    "progress",
  ]);
  assert.ok(Object.isFrozen(provider));
});

test("missing or malformed server environment fails closed without creating clients", async () => {
  let calls = 0;
  const provider = createPublisherSupabaseSyncProvider(options({
    environment: Object.create(null, {
      NEXT_PUBLIC_SUPABASE_URL: { enumerable: true, get() { throw new Error("secret"); } },
    }),
    createServerClient() { calls += 1; },
    createClient() { calls += 1; },
  }));
  assert.equal(await provider.exchangeAuthCode({ code: "abc" }), false);
  assert.equal(await provider.deleteAccount({}), "unavailable");
  assert.equal(calls, 0);
});

test("auth exchange uses the anonymous server client and scoped cookie adapter", async () => {
  const captured = {};
  const provider = createPublisherSupabaseSyncProvider(options({
    createServerClient(url, key, clientOptions) {
      Object.assign(captured, { url, key, clientOptions });
      return {
        auth: {
          async exchangeCodeForSession(code) {
            captured.code = code;
            return { error: null };
          },
        },
      };
    },
  }));
  assert.equal(await provider.exchangeAuthCode({ code: "proof-code" }), true);
  assert.equal(captured.url, "https://project.supabase.co");
  assert.equal(captured.key, "anon-key");
  assert.equal(captured.code, "proof-code");
  assert.deepEqual(captured.clientOptions.cookies.getAll(), []);
});

test("account deletion authenticates before using the service role", async () => {
  const calls = [];
  const provider = createPublisherSupabaseSyncProvider(options({
    createServerClient() {
      return {
        auth: {
          async getUser() {
            calls.push("get-user");
            return { data: { user: { id: "reader-1" } }, error: null };
          },
          async signOut() { calls.push("sign-out"); return { error: null }; },
        },
      };
    },
    createClient(url, key, clientOptions) {
      calls.push(["admin-client", url, key, clientOptions]);
      return {
        auth: { admin: { async deleteUser(id) { calls.push(["delete", id]); return { error: null }; } } },
      };
    },
  }));
  assert.equal(await provider.deleteAccount({}), "deleted");
  assert.deepEqual(calls.map((entry) => Array.isArray(entry) ? entry[0] : entry), [
    "get-user",
    "admin-client",
    "delete",
    "sign-out",
  ]);
  assert.equal(calls[1][2], "service-role-key");
  assert.deepEqual(calls[1][3].auth, {
    autoRefreshToken: false,
    persistSession: false,
  });
});

test("account deletion maps unauthenticated and provider failures", async () => {
  const unauthorized = createPublisherSupabaseSyncProvider(options({
    createServerClient() {
      return { auth: { async getUser() { return { data: { user: null }, error: null }; } } };
    },
  }));
  assert.equal(await unauthorized.deleteAccount({}), "unauthorized");

  const failed = createPublisherSupabaseSyncProvider(options({
    createClient() {
      return { auth: { admin: { async deleteUser() { return { error: new Error("nope") }; } } } };
    },
  }));
  assert.equal(await failed.deleteAccount({}), "failed");
});
