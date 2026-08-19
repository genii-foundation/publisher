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

import {
  validateSyncEnvelopeShape,
} from "@genii-foundation/publisher-schema";
import type {
  SyncCapability,
  SyncEnvelope,
} from "@genii-foundation/publisher-schema";

export type PublisherSyncAccountDeletionResult =
  | "deleted"
  | "failed"
  | "unauthorized"
  | "unavailable";

export interface PublisherNextSyncProviderContext {
  readonly publicationId: string;
  readonly buildId: string;
  readonly capabilities: readonly SyncCapability[];
}

export interface PublisherNextSyncProvider {
  readonly kind: "genii.publisher.sync-provider";
  readonly package: string;
  readonly capabilities: readonly SyncCapability[];
  exchangeAuthCode(input: {
    readonly code: string;
    readonly request: Request;
    readonly context: PublisherNextSyncProviderContext;
  }): Promise<boolean>;
  deleteAccount(input: {
    readonly request: Request;
    readonly context: PublisherNextSyncProviderContext;
  }): Promise<PublisherSyncAccountDeletionResult>;
}

export interface PublisherNextSyncRoutes {
  readonly authCallback: (request: Request) => Promise<Response>;
  readonly accountDeletion: (request: Request) => Promise<Response>;
}

export interface PublisherNextHostConfig {
  readonly syncProvider?: PublisherNextSyncProvider;
}

export function definePublisherNextHostConfig(
  config: PublisherNextHostConfig,
): PublisherNextHostConfig {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError("Publisher host configuration must be an object.");
  }
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(config);
  } catch {
    throw new TypeError("Publisher host configuration could not be inspected.");
  }
  if (keys.some((key) => key !== "syncProvider")) {
    throw new TypeError("Publisher host configuration contains an unsupported field.");
  }
  if (!keys.includes("syncProvider")) {
    return Object.freeze({});
  }
  return Object.freeze({
    syncProvider: exactDataProperty(config, "syncProvider") as PublisherNextSyncProvider,
  });
}

export interface CreatePublisherNextSyncRoutesInput {
  readonly sync?: unknown;
  readonly provider?: PublisherNextSyncProvider;
  readonly homePath?: string;
}

function json(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function dormantRoutes(): PublisherNextSyncRoutes {
  const notFound = async (): Promise<Response> => json(404, "Not found.");
  return Object.freeze({
    authCallback: notFound,
    accountDeletion: notFound,
  });
}

function safeNextPath(value: string | null, fallback: string): string {
  if (
    value === null ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return fallback;
  }
  return value;
}

function exactDataProperty(
  value: object,
  key: PropertyKey,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    throw new TypeError("The synchronization provider could not be inspected.");
  }
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.enumerable !== true
  ) {
    throw new TypeError(`The synchronization provider must declare ${String(key)} as an enumerable data property.`);
  }
  return descriptor.value;
}

function validateProvider(
  provider: PublisherNextSyncProvider,
  sync: SyncEnvelope,
): PublisherNextSyncProvider {
  if (provider === null || typeof provider !== "object") {
    throw new TypeError("A synchronization provider is required for this publication.");
  }
  if (exactDataProperty(provider, "kind") !== "genii.publisher.sync-provider") {
    throw new TypeError("The synchronization provider has an unsupported kind.");
  }
  if (exactDataProperty(provider, "package") !== sync.provider.package) {
    throw new TypeError("The synchronization provider does not match the publication declaration.");
  }
  const capabilities = exactDataProperty(provider, "capabilities");
  if (!Array.isArray(capabilities) || capabilities.length > 4) {
    throw new TypeError("The synchronization provider must declare its capabilities.");
  }
  const offered = new Set<unknown>();
  for (let index = 0; index < capabilities.length; index += 1) {
    const capability = exactDataProperty(capabilities, String(index));
    if (offered.has(capability)) {
      throw new TypeError("The synchronization provider declares a capability twice.");
    }
    offered.add(capability);
  }
  for (const capability of sync.capabilities) {
    if (!offered.has(capability)) {
      throw new TypeError(`The synchronization provider does not serve ${capability}.`);
    }
  }
  for (const method of ["exchangeAuthCode", "deleteAccount"] as const) {
    if (typeof exactDataProperty(provider, method) !== "function") {
      throw new TypeError(`The synchronization provider must implement ${method}.`);
    }
  }
  return provider;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return true;
  }
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function createPublisherNextSyncRoutes(
  input: CreatePublisherNextSyncRoutesInput,
): PublisherNextSyncRoutes {
  if (input.sync === undefined) {
    return dormantRoutes();
  }
  const validated = validateSyncEnvelopeShape(input.sync);
  if (!validated.valid) {
    throw new TypeError("The synchronization artifact is invalid.");
  }
  if (input.provider === undefined) {
    throw new TypeError("This publication declares synchronization but the host supplied no provider.");
  }
  const provider = validateProvider(input.provider, validated.value);
  const homePath = safeNextPath(input.homePath ?? null, "/");
  const context = Object.freeze({
    publicationId: validated.value.publicationId,
    buildId: validated.value.buildId,
    capabilities: Object.freeze([...validated.value.capabilities]),
  });

  return Object.freeze({
    authCallback: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      const next = safeNextPath(url.searchParams.get("next"), homePath);
      if (code === null || code.length === 0 || code.length > 4096) {
        return Response.redirect(new URL(`${homePath}?auth=error`, url.origin));
      }
      try {
        if (await provider.exchangeAuthCode({ code, request, context }) === true) {
          return Response.redirect(new URL(next, url.origin));
        }
      } catch {
        // Provider failures become one public response and reveal no provider detail.
      }
      return Response.redirect(new URL(`${homePath}?auth=error`, url.origin));
    },
    accountDeletion: async (request: Request): Promise<Response> => {
      if (!sameOrigin(request)) {
        return json(403, "Invalid origin.");
      }
      let result: PublisherSyncAccountDeletionResult;
      try {
        result = await provider.deleteAccount({ request, context });
      } catch {
        result = "failed";
      }
      switch (result) {
        case "deleted":
          return Response.json({ ok: true });
        case "unauthorized":
          return json(401, "Unauthorized.");
        case "unavailable":
          return json(503, "Synchronization is unavailable.");
        case "failed":
          return json(500, "Account deletion failed.");
        default:
          return json(500, "Account deletion failed.");
      }
    },
  });
}
