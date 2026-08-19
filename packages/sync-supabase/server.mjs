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
  });
}
