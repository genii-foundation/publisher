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

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers.js";

import { PUBLISHER_SYNC_PROVIDER } from "./provider.mjs";

function dataString(record, key) {
  if (record === null || typeof record !== "object") return null;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) return null;
  const value = descriptor.value;
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
    return null;
  }
  return value;
}

function resolvedEnvironment(environment) {
  const url = dataString(environment, "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = dataString(environment, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = dataString(environment, "SUPABASE_SERVICE_ROLE_KEY");
  if (url === null) return { url: null, anonKey, serviceRoleKey };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { url: null, anonKey, serviceRoleKey };
    }
  } catch {
    return { url: null, anonKey, serviceRoleKey };
  }
  return { url, anonKey, serviceRoleKey };
}

export function createPublisherSupabaseSyncProvider(options = {}) {
  const environment = options.environment ?? process.env;
  const readCookies = options.cookies ?? cookies;
  const makeServerClient = options.createServerClient ?? createServerClient;
  const makeAdminClient = options.createClient ?? createClient;

  async function serverClient() {
    const { url, anonKey } = resolvedEnvironment(environment);
    if (url === null || anonKey === null) return null;
    const store = await readCookies();
    return makeServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(values) {
          try {
            for (const { name, value, options: cookieOptions } of values) {
              store.set(name, value, cookieOptions);
            }
          } catch {
            // Static server contexts cannot write cookies. Route handlers can.
          }
        },
      },
    });
  }

  function adminClient() {
    const { url, serviceRoleKey } = resolvedEnvironment(environment);
    if (url === null || serviceRoleKey === null) return null;
    return makeAdminClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  async function authenticatedClient() {
    const client = await serverClient();
    if (client === null) return null;
    const result = await client.auth.getUser();
    const user = result.data?.user;
    if (result.error != null || user == null || typeof user.id !== "string") {
      return null;
    }
    return { client, userId: user.id };
  }

  async function readState(client, publicationId, capabilities) {
    const enabled = new Set(capabilities);
    const [progress, bookmarks, consent] = await Promise.all([
      enabled.has("progress") ? client.from("reader_progress")
        .select("progress, schema_version")
        .eq("publication_id", publicationId)
        .maybeSingle() : Promise.resolve({ data: null, error: null }),
      enabled.has("bookmarks") ? client.from("reader_bookmarks")
        .select("bookmarks, schema_version")
        .eq("publication_id", publicationId)
        .maybeSingle() : Promise.resolve({ data: null, error: null }),
      client.from("reader_sync_consent")
        .select("consent_version, copy_version, granted, granted_at, revoked_at")
        .eq("publication_id", publicationId)
        .maybeSingle(),
    ]);
    if (progress.error != null || bookmarks.error != null || consent.error != null) {
      return null;
    }
    const consentRow = consent.data;
    return {
      progress: progress.data == null ? null : {
        value: progress.data.progress,
        schemaVersion: progress.data.schema_version,
      },
      bookmarks: bookmarks.data == null ? null : {
        value: bookmarks.data.bookmarks,
        schemaVersion: bookmarks.data.schema_version,
      },
      consent: consentRow == null ? null : {
        version: consentRow.consent_version,
        copyVersion: consentRow.copy_version,
        granted: consentRow.granted,
        grantedAt: consentRow.granted_at == null ? null : Date.parse(consentRow.granted_at),
        revokedAt: consentRow.revoked_at == null ? null : Date.parse(consentRow.revoked_at),
      },
    };
  }

  return Object.freeze({
    kind: PUBLISHER_SYNC_PROVIDER.kind,
    package: PUBLISHER_SYNC_PROVIDER.package,
    capabilities: PUBLISHER_SYNC_PROVIDER.capabilities,
    async exchangeAuthCode({ code }) {
      const client = await serverClient();
      if (client === null) return false;
      const result = await client.auth.exchangeCodeForSession(code);
      return result.error == null;
    },
    async requestEmailAuthentication({ email, callbackUrl }) {
      const client = await serverClient();
      if (client === null) return false;
      const result = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callbackUrl },
      });
      return result.error == null;
    },
    async verifyEmailAuthentication({ email, code }) {
      const client = await serverClient();
      if (client === null) return null;
      const result = await client.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (result.error != null || result.data?.user == null) return null;
      return {
        authenticated: true,
        ...(typeof result.data.user.email === "string"
          ? { email: result.data.user.email }
          : {}),
      };
    },
    async getSession() {
      const client = await serverClient();
      if (client === null) return null;
      const result = await client.auth.getUser();
      if (result.error != null) return null;
      if (result.data?.user == null) return { authenticated: false };
      return {
        authenticated: true,
        ...(typeof result.data.user.email === "string"
          ? { email: result.data.user.email }
          : {}),
      };
    },
    async signOut() {
      const client = await serverClient();
      if (client === null) return false;
      const result = await client.auth.signOut();
      return result.error == null;
    },
    async deleteAccount() {
      const client = await serverClient();
      if (client === null) return "unavailable";
      const result = await client.auth.getUser();
      const user = result.data?.user;
      if (result.error != null || user == null || typeof user.id !== "string") {
        return "unauthorized";
      }
      const admin = adminClient();
      if (admin === null) return "unavailable";
      const deleted = await admin.auth.admin.deleteUser(user.id);
      if (deleted.error != null) return "failed";
      await client.auth.signOut();
      return "deleted";
    },
    async readRemoteState({ context }) {
      const authenticated = await authenticatedClient();
      if (authenticated === null) return null;
      return readState(authenticated.client, context.publicationId, context.capabilities);
    },
    async transferRemoteState({ transfer, context }) {
      const authenticated = await authenticatedClient();
      if (authenticated === null) return null;
      const { client, userId } = authenticated;
      const publicationId = context.publicationId;
      if (transfer.progress !== undefined) {
        const result = await client.from("reader_progress").upsert({
          user_id: userId,
          publication_id: publicationId,
          progress: transfer.progress.value,
          schema_version: transfer.progress.schemaVersion,
        }, { onConflict: "user_id,publication_id" });
        if (result.error != null) return null;
      }
      if (transfer.bookmarks !== undefined) {
        const result = await client.rpc("merge_reader_bookmarks", {
          incoming_publication_id: publicationId,
          incoming_bookmarks: transfer.bookmarks.value,
          incoming_schema_version: transfer.bookmarks.schemaVersion,
        });
        if (result.error != null) return null;
      }
      if (transfer.consent !== undefined) {
        const consent = transfer.consent;
        const result = await client.from("reader_sync_consent").upsert({
          user_id: userId,
          publication_id: publicationId,
          consent_version: consent.version,
          copy_version: consent.copyVersion,
          granted: consent.granted,
          granted_at: consent.grantedAt === null ? null : new Date(consent.grantedAt).toISOString(),
          revoked_at: consent.revokedAt === null ? null : new Date(consent.revokedAt).toISOString(),
        }, { onConflict: "user_id,publication_id" });
        if (result.error != null) return null;
      }
      const events = transfer.events ?? [];
      if (events.length > 0) {
        const result = await client.from("reader_engagement_events").upsert(
          events.map((event) => ({
            user_id: userId,
            publication_id: publicationId,
            client_event_id: event.clientEventId,
            event_type: event.eventType,
            event_at: new Date(event.eventAt).toISOString(),
            section_id: event.sectionId ?? null,
            content_hash: event.contentHash ?? null,
            route: event.route ?? null,
            payload: event.payload ?? {},
          })),
          {
            onConflict: "user_id,publication_id,client_event_id",
            ignoreDuplicates: true,
          },
        );
        if (result.error != null) return null;
      }
      const state = await readState(client, publicationId, context.capabilities);
      if (state === null) return null;
      return {
        state,
        uploadedEventIds: events.map((event) => event.clientEventId),
      };
    },
  });
}
