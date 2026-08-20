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
          async signInWithOtp() { return { error: null }; },
          async verifyOtp() {
            return { data: { user: { id: "reader-1", email: "reader@example.com" } }, error: null };
          },
          async getUser() {
            return { data: { user: { id: "reader-1", email: "reader@example.com" } }, error: null };
          },
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

test("email authentication and session methods use only the cookie-scoped client", async () => {
  const calls = [];
  const provider = createPublisherSupabaseSyncProvider(options({
    createServerClient() {
      return {
        auth: {
          async signInWithOtp(input) {
            calls.push(["start", input]);
            return { error: null };
          },
          async verifyOtp(input) {
            calls.push(["verify", input]);
            return {
              data: { user: { id: "reader-1", email: "reader@example.com" } },
              error: null,
            };
          },
          async getUser() {
            calls.push(["session"]);
            return {
              data: { user: { id: "reader-1", email: "reader@example.com" } },
              error: null,
            };
          },
          async signOut() {
            calls.push(["sign-out"]);
            return { error: null };
          },
        },
      };
    },
    createClient() {
      throw new Error("authentication must not create an administrative client");
    },
  }));
  assert.equal(await provider.requestEmailAuthentication({
    email: "reader@example.com",
    callbackUrl: "https://reader.example/auth/callback",
  }), true);
  assert.deepEqual(await provider.verifyEmailAuthentication({
    email: "reader@example.com",
    code: "12345678",
  }), {
    authenticated: true,
    email: "reader@example.com",
  });
  assert.deepEqual(await provider.getSession({}), {
    authenticated: true,
    email: "reader@example.com",
  });
  assert.equal(await provider.signOut({}), true);
  assert.deepEqual(calls, [
    ["start", {
      email: "reader@example.com",
      options: { emailRedirectTo: "https://reader.example/auth/callback" },
    }],
    ["verify", {
      email: "reader@example.com",
      token: "12345678",
      type: "email",
    }],
    ["session"],
    ["sign-out"],
  ]);
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

test("remote transfer derives reader and publication scope on the server", async () => {
  const calls = [];
  const rows = {
    reader_progress: { progress: { schemaVersion: 1, publicationId: "field-notes", entries: {} }, schema_version: 1 },
    reader_bookmarks: { bookmarks: { bookmarks: {} }, schema_version: 1 },
    reader_sync_consent: {
      consent_version: 1,
      copy_version: "reader-sync-consent-1",
      granted: true,
      granted_at: "2026-08-18T00:00:00.000Z",
      revoked_at: null,
    },
  };
  function query(table) {
    return {
      select(columns) { calls.push(["select", table, columns]); return this; },
      eq(column, value) { calls.push(["eq", table, column, value]); return this; },
      async maybeSingle() { return { data: rows[table] ?? null, error: null }; },
      async upsert(value, options) { calls.push(["upsert", table, value, options]); return { error: null }; },
    };
  }
  const provider = createPublisherSupabaseSyncProvider(options({
    createServerClient() {
      return {
        auth: {
          async getUser() {
            calls.push(["get-user"]);
            return { data: { user: { id: "reader-1" } }, error: null };
          },
        },
        from: query,
        async rpc(name, input) {
          calls.push(["rpc", name, input]);
          return { error: null };
        },
      };
    },
  }));
  const context = {
    publicationId: "field-notes",
    capabilities: ["bookmarks", "engagement", "progress"],
  };
  const read = await provider.readRemoteState({ context });
  assert.equal(read.progress.value.publicationId, "field-notes");
  assert.ok(calls.some((entry) => entry[0] === "eq" && entry[2] === "publication_id" && entry[3] === "field-notes"));

  const transferred = await provider.transferRemoteState({
    context,
    transfer: {
      progress: { value: rows.reader_progress.progress, schemaVersion: 1 },
      bookmarks: { value: rows.reader_bookmarks.bookmarks, schemaVersion: 1 },
      consent: {
        version: 1,
        copyVersion: "reader-sync-consent-1",
        granted: true,
        grantedAt: Date.parse("2026-08-18T00:00:00.000Z"),
        revokedAt: null,
      },
      events: [{ clientEventId: "event-1", eventType: "section_opened", eventAt: 1 }],
    },
  });
  assert.deepEqual(transferred.uploadedEventIds, ["event-1"]);
  const progressWrite = calls.find((entry) => entry[0] === "upsert" && entry[1] === "reader_progress");
  assert.equal(progressWrite[2].user_id, "reader-1");
  assert.equal(progressWrite[2].publication_id, "field-notes");
  assert.deepEqual(progressWrite[3], { onConflict: "user_id,publication_id" });
  const bookmarkMerge = calls.find((entry) => entry[0] === "rpc");
  assert.equal(bookmarkMerge[2].incoming_publication_id, "field-notes");
  const eventWrite = calls.find((entry) => entry[0] === "upsert" && entry[1] === "reader_engagement_events");
  assert.equal(eventWrite[2][0].user_id, "reader-1");
  assert.equal(eventWrite[2][0].publication_id, "field-notes");
  assert.deepEqual(eventWrite[3], {
    onConflict: "user_id,publication_id,client_event_id",
    ignoreDuplicates: true,
  });
});
