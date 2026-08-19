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
  SYNC_CAPABILITIES,
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

export type PublisherSyncSession =
  | { readonly authenticated: false }
  | {
      readonly authenticated: true;
      readonly email?: string;
    };

export interface PublisherSyncRemoteDocument {
  readonly value: Readonly<Record<string, unknown>>;
  readonly schemaVersion: number;
}

export interface PublisherSyncConsentRecord {
  readonly version: number;
  readonly copyVersion: string;
  readonly granted: boolean;
  readonly grantedAt: number | null;
  readonly revokedAt: number | null;
}

export interface PublisherSyncEngagementEvent {
  readonly clientEventId: string;
  readonly eventType: string;
  readonly eventAt: number;
  readonly sectionId?: string;
  readonly contentHash?: string;
  readonly route?: string;
  readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PublisherSyncRemoteState {
  readonly progress: PublisherSyncRemoteDocument | null;
  readonly bookmarks: PublisherSyncRemoteDocument | null;
  readonly consent: PublisherSyncConsentRecord | null;
}

export interface PublisherSyncTransferInput {
  readonly progress?: PublisherSyncRemoteDocument;
  readonly bookmarks?: PublisherSyncRemoteDocument;
  readonly consent?: PublisherSyncConsentRecord;
  readonly events?: readonly PublisherSyncEngagementEvent[];
}

export interface PublisherSyncTransferResult {
  readonly state: PublisherSyncRemoteState;
  readonly uploadedEventIds: readonly string[];
}

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
  requestEmailAuthentication(input: {
    readonly email: string;
    readonly callbackUrl: string;
    readonly request: Request;
    readonly context: PublisherNextSyncProviderContext;
  }): Promise<boolean>;
  verifyEmailAuthentication(input: {
    readonly email: string;
    readonly code: string;
    readonly request: Request;
    readonly context: PublisherNextSyncProviderContext;
  }): Promise<PublisherSyncSession | null>;
  getSession(input: {
    readonly request: Request;
    readonly context: PublisherNextSyncProviderContext;
  }): Promise<PublisherSyncSession | null>;
  signOut(input: {
    readonly request: Request;
    readonly context: PublisherNextSyncProviderContext;
  }): Promise<boolean>;
  deleteAccount(input: {
    readonly request: Request;
    readonly context: PublisherNextSyncProviderContext;
  }): Promise<PublisherSyncAccountDeletionResult>;
  readRemoteState(input: {
    readonly request: Request;
    readonly context: PublisherNextSyncProviderContext;
  }): Promise<PublisherSyncRemoteState | null>;
  transferRemoteState(input: {
    readonly transfer: PublisherSyncTransferInput;
    readonly request: Request;
    readonly context: PublisherNextSyncProviderContext;
  }): Promise<PublisherSyncTransferResult | null>;
}

export interface PublisherNextSyncRoutes {
  readonly authStart: (request: Request) => Promise<Response>;
  readonly authCallback: (request: Request) => Promise<Response>;
  readonly authVerify: (request: Request) => Promise<Response>;
  readonly sessionRead: (request: Request) => Promise<Response>;
  readonly sessionDelete: (request: Request) => Promise<Response>;
  readonly accountDeletion: (request: Request) => Promise<Response>;
  readonly syncRead: (request: Request) => Promise<Response>;
  readonly syncTransfer: (request: Request) => Promise<Response>;
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
  return Response.json({ error }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function jsonValue(status: number, value: unknown): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function redirect(location: URL): Response {
  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "no-store",
      location: location.href,
    },
  });
}

function dormantRoutes(): PublisherNextSyncRoutes {
  const notFound = async (): Promise<Response> => json(404, "Not found.");
  return Object.freeze({
    authStart: notFound,
    authCallback: notFound,
    authVerify: notFound,
    sessionRead: notFound,
    sessionDelete: notFound,
    accountDeletion: notFound,
    syncRead: notFound,
    syncTransfer: notFound,
  });
}

async function boundedJson(
  request: Request,
  maximumBytes = 8192,
): Promise<Readonly<Record<string, unknown>> | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      return null;
    }
  }
  if (request.body === null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(parsed);
    if (Object.getOwnPropertySymbols(parsed).length > 0) return null;
    for (const descriptor of Object.values(descriptors)) {
      if (!descriptor.enumerable || !("value" in descriptor)) return null;
    }
    return Object.freeze(Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    ));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function exactString(
  value: Readonly<Record<string, unknown>>,
  key: string,
  maximum: number,
): string | null {
  const keys = Object.keys(value);
  if (!keys.includes(key)) return null;
  const candidate = value[key];
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > maximum
  ) {
    return null;
  }
  return candidate;
}

function safeSession(value: PublisherSyncSession | null): PublisherSyncSession | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  let authenticated: unknown;
  let email: unknown;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => key !== "authenticated" && key !== "email")) return null;
    authenticated = exactDataProperty(value, "authenticated");
    email = keys.includes("email") ? exactDataProperty(value, "email") : undefined;
  } catch {
    return null;
  }
  if (authenticated === false && email === undefined) {
    return Object.freeze({ authenticated: false });
  }
  if (
    authenticated === true &&
    (email === undefined ||
      (typeof email === "string" && email.length > 0 && email.length <= 320))
  ) {
    return Object.freeze({
      authenticated: true,
      ...(email === undefined ? {} : { email }),
    });
  }
  return null;
}

function plainDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    for (const descriptor of Object.values(descriptors)) {
      if (!descriptor.enumerable || !("value" in descriptor)) return null;
    }
    return Object.freeze(Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
    ));
  } catch {
    return null;
  }
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
}

function safeNonnegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function safeEpochMilliseconds(value: unknown): number | null {
  const timestamp = safeNonnegativeInteger(value);
  return timestamp !== null && timestamp <= 8_640_000_000_000_000 ? timestamp : null;
}

function safeRemoteDocument(value: unknown, maximumBytes: number): PublisherSyncRemoteDocument | null {
  const record = plainDataRecord(value);
  if (record === null || !exactKeys(record, ["value", "schemaVersion"])) return null;
  const payloadRecord = plainDataRecord(record.value);
  const schemaVersion = safeNonnegativeInteger(record.schemaVersion);
  if (payloadRecord === null || schemaVersion === null || schemaVersion < 1) return null;
  try {
    const serialized = JSON.stringify(payloadRecord);
    if (new TextEncoder().encode(serialized).byteLength > maximumBytes) return null;
    const detached = plainDataRecord(JSON.parse(serialized));
    if (detached === null) return null;
    return Object.freeze({ value: detached, schemaVersion });
  } catch {
    return null;
  }
}

function safeConsent(value: unknown): PublisherSyncConsentRecord | null {
  const record = plainDataRecord(value);
  if (
    record === null ||
    !exactKeys(record, ["version", "copyVersion", "granted", "grantedAt", "revokedAt"])
  ) return null;
  const version = safeNonnegativeInteger(record.version);
  const grantedAt = record.grantedAt === null ? null : safeEpochMilliseconds(record.grantedAt);
  const revokedAt = record.revokedAt === null ? null : safeEpochMilliseconds(record.revokedAt);
  if (
    version === null || version < 1 ||
    typeof record.copyVersion !== "string" ||
    record.copyVersion.length < 1 || record.copyVersion.length > 64 ||
    typeof record.granted !== "boolean" ||
    grantedAt === null && record.grantedAt !== null ||
    revokedAt === null && record.revokedAt !== null
  ) return null;
  return Object.freeze({
    version,
    copyVersion: record.copyVersion,
    granted: record.granted,
    grantedAt,
    revokedAt,
  });
}

function safeEngagementEvent(value: unknown): PublisherSyncEngagementEvent | null {
  const record = plainDataRecord(value);
  if (
    record === null ||
    !exactKeys(record, ["clientEventId", "eventType", "eventAt"], ["sectionId", "contentHash", "route", "payload"])
  ) return null;
  const eventAt = safeEpochMilliseconds(record.eventAt);
  if (
    typeof record.clientEventId !== "string" || record.clientEventId.length < 1 || record.clientEventId.length > 128 ||
    typeof record.eventType !== "string" || record.eventType.length < 1 || record.eventType.length > 64 ||
    eventAt === null
  ) return null;
  for (const [key, maximum] of [["sectionId", 128], ["contentHash", 128], ["route", 512]] as const) {
    const candidate = record[key];
    if (candidate !== undefined && (typeof candidate !== "string" || candidate.length > maximum)) return null;
  }
  const payload = record.payload === undefined ? undefined : plainDataRecord(record.payload);
  if (payload === null) return null;
  if (payload !== undefined) {
    if (Object.keys(payload).length > 64) return null;
    for (const candidate of Object.values(payload)) {
      if (candidate !== null && typeof candidate !== "string" && typeof candidate !== "number" && typeof candidate !== "boolean") return null;
      if (typeof candidate === "number" && !Number.isFinite(candidate)) return null;
    }
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 8192) return null;
  }
  return Object.freeze({
    clientEventId: record.clientEventId,
    eventType: record.eventType,
    eventAt,
    ...(record.sectionId === undefined ? {} : { sectionId: record.sectionId as string }),
    ...(record.contentHash === undefined ? {} : { contentHash: record.contentHash as string }),
    ...(record.route === undefined ? {} : { route: record.route as string }),
    ...(payload === undefined ? {} : { payload: payload as Readonly<Record<string, string | number | boolean | null>> }),
  });
}

function safeTransfer(
  value: Readonly<Record<string, unknown>>,
  capabilities: readonly SyncCapability[],
): PublisherSyncTransferInput | null {
  if (!exactKeys(value, [], ["progress", "bookmarks", "consent", "events"]) || Object.keys(value).length === 0) return null;
  const enabled = new Set(capabilities);
  const progress = value.progress === undefined ? undefined : safeRemoteDocument(value.progress, 262_144);
  const bookmarks = value.bookmarks === undefined ? undefined : safeRemoteDocument(value.bookmarks, 4_194_304);
  const consent = value.consent === undefined ? undefined : safeConsent(value.consent);
  let events: readonly PublisherSyncEngagementEvent[] | undefined;
  if (value.events !== undefined) {
    if (!Array.isArray(value.events) || value.events.length > 256) return null;
    const inspected = value.events.map(safeEngagementEvent);
    if (inspected.some((event) => event === null)) return null;
    events = Object.freeze(inspected as PublisherSyncEngagementEvent[]);
  }
  if (
    value.progress !== undefined && (progress === null || !enabled.has("progress")) ||
    value.bookmarks !== undefined && (bookmarks === null || !enabled.has("bookmarks")) ||
    value.events !== undefined && (!enabled.has("engagement")) ||
    value.consent !== undefined && consent === null
  ) return null;
  const validProgress = progress === null ? undefined : progress;
  const validBookmarks = bookmarks === null ? undefined : bookmarks;
  const validConsent = consent === null ? undefined : consent;
  return Object.freeze({
    ...(validProgress === undefined ? {} : { progress: validProgress }),
    ...(validBookmarks === undefined ? {} : { bookmarks: validBookmarks }),
    ...(validConsent === undefined ? {} : { consent: validConsent }),
    ...(events === undefined ? {} : { events }),
  });
}

function safeRemoteState(
  value: unknown,
  capabilities?: readonly SyncCapability[],
): PublisherSyncRemoteState | null {
  const record = plainDataRecord(value);
  if (record === null || !exactKeys(record, ["progress", "bookmarks", "consent"])) return null;
  const progress = record.progress === null ? null : safeRemoteDocument(record.progress, 262_144);
  const bookmarks = record.bookmarks === null ? null : safeRemoteDocument(record.bookmarks, 4_194_304);
  const consent = record.consent === null ? null : safeConsent(record.consent);
  if (progress === null && record.progress !== null || bookmarks === null && record.bookmarks !== null || consent === null && record.consent !== null) return null;
  if (capabilities !== undefined) {
    const enabled = new Set(capabilities);
    if (progress !== null && !enabled.has("progress") || bookmarks !== null && !enabled.has("bookmarks")) return null;
  }
  return Object.freeze({ progress, bookmarks, consent });
}

function safeTransferResult(
  value: unknown,
  capabilities: readonly SyncCapability[],
): PublisherSyncTransferResult | null {
  const record = plainDataRecord(value);
  if (record === null || !exactKeys(record, ["state", "uploadedEventIds"]) || !Array.isArray(record.uploadedEventIds) || record.uploadedEventIds.length > 256) return null;
  const state = safeRemoteState(record.state, capabilities);
  if (state === null) return null;
  const uploadedEventIds = record.uploadedEventIds;
  if (uploadedEventIds.some((id) => typeof id !== "string" || id.length < 1 || id.length > 128)) return null;
  return Object.freeze({ state, uploadedEventIds: Object.freeze([...uploadedEventIds]) as readonly string[] });
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

function safeCapabilities(value: unknown): readonly SyncCapability[] {
  if (!Array.isArray(value)) {
    throw new TypeError("The synchronization provider must declare its capabilities.");
  }
  let descriptors: Readonly<Record<string, PropertyDescriptor>>;
  let keys: readonly PropertyKey[];
  try {
    descriptors = Object.getOwnPropertyDescriptors(value) as Readonly<
      Record<string, PropertyDescriptor>
    >;
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError("The synchronization provider capabilities could not be inspected.");
  }
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 4) {
    throw new TypeError("The synchronization provider must declare its capabilities.");
  }
  const expectedKeys = new Set<PropertyKey>(["length"]);
  for (let index = 0; index < length; index += 1) {
    expectedKeys.add(String(index));
  }
  if (keys.some((key) => !expectedKeys.has(key))) {
    throw new TypeError("The synchronization provider capabilities contain an unsupported field.");
  }
  const allowed = new Set<unknown>(SYNC_CAPABILITIES);
  const capabilities: SyncCapability[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      !allowed.has(descriptor.value)
    ) {
      throw new TypeError("The synchronization provider declares an unsupported capability.");
    }
    capabilities.push(descriptor.value as SyncCapability);
  }
  if (new Set(capabilities).size !== capabilities.length) {
    throw new TypeError("The synchronization provider declares a capability twice.");
  }
  return Object.freeze(capabilities);
}

function validateProvider(
  provider: PublisherNextSyncProvider,
  sync: SyncEnvelope,
): PublisherNextSyncProvider {
  if (provider === null || typeof provider !== "object") {
    throw new TypeError("A synchronization provider is required for this publication.");
  }
  let providerKeys: readonly PropertyKey[];
  try {
    providerKeys = Reflect.ownKeys(provider);
  } catch {
    throw new TypeError("The synchronization provider could not be inspected.");
  }
  const providerFields = new Set<PropertyKey>([
    "kind",
    "package",
    "capabilities",
    "exchangeAuthCode",
    "requestEmailAuthentication",
    "verifyEmailAuthentication",
    "getSession",
    "signOut",
    "deleteAccount",
    "readRemoteState",
    "transferRemoteState",
  ]);
  if (providerKeys.some((key) => !providerFields.has(key))) {
    throw new TypeError("The synchronization provider contains an unsupported field.");
  }
  const kind = exactDataProperty(provider, "kind");
  if (kind !== "genii.publisher.sync-provider") {
    throw new TypeError("The synchronization provider has an unsupported kind.");
  }
  const packageName = exactDataProperty(provider, "package");
  if (packageName !== sync.provider.package) {
    throw new TypeError("The synchronization provider does not match the publication declaration.");
  }
  const capabilities = safeCapabilities(
    exactDataProperty(provider, "capabilities"),
  );
  const offered = new Set<unknown>(capabilities);
  for (const capability of sync.capabilities) {
    if (!offered.has(capability)) {
      throw new TypeError(`The synchronization provider does not serve ${capability}.`);
    }
  }
  const exchangeAuthCode = exactDataProperty(provider, "exchangeAuthCode");
  const requestEmailAuthentication = exactDataProperty(provider, "requestEmailAuthentication");
  const verifyEmailAuthentication = exactDataProperty(provider, "verifyEmailAuthentication");
  const getSession = exactDataProperty(provider, "getSession");
  const signOut = exactDataProperty(provider, "signOut");
  const deleteAccount = exactDataProperty(provider, "deleteAccount");
  const readRemoteState = exactDataProperty(provider, "readRemoteState");
  const transferRemoteState = exactDataProperty(provider, "transferRemoteState");
  for (const [method, implementation] of Object.entries({
    exchangeAuthCode,
    requestEmailAuthentication,
    verifyEmailAuthentication,
    getSession,
    signOut,
    deleteAccount,
    readRemoteState,
    transferRemoteState,
  })) {
    if (typeof implementation !== "function") {
      throw new TypeError(`The synchronization provider must implement ${method}.`);
    }
  }
  return Object.freeze({
    kind,
    package: packageName,
    capabilities,
    exchangeAuthCode: exchangeAuthCode as PublisherNextSyncProvider["exchangeAuthCode"],
    requestEmailAuthentication: requestEmailAuthentication as PublisherNextSyncProvider["requestEmailAuthentication"],
    verifyEmailAuthentication: verifyEmailAuthentication as PublisherNextSyncProvider["verifyEmailAuthentication"],
    getSession: getSession as PublisherNextSyncProvider["getSession"],
    signOut: signOut as PublisherNextSyncProvider["signOut"],
    deleteAccount: deleteAccount as PublisherNextSyncProvider["deleteAccount"],
    readRemoteState: readRemoteState as PublisherNextSyncProvider["readRemoteState"],
    transferRemoteState: transferRemoteState as PublisherNextSyncProvider["transferRemoteState"],
  });
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
    authStart: async (request: Request): Promise<Response> => {
      if (!sameOrigin(request)) return json(403, "Invalid origin.");
      const input = await boundedJson(request);
      if (input === null || Object.keys(input).some((key) => key !== "email" && key !== "next")) {
        return json(400, "Invalid authentication request.");
      }
      const email = exactString(input, "email", 320)?.trim() ?? null;
      const requestedNext = input.next === undefined
        ? homePath
        : typeof input.next === "string" && input.next.length <= 2048
          ? safeNextPath(input.next, homePath)
          : null;
      if (email === null || !email.includes("@") || requestedNext === null) {
        return json(400, "Invalid authentication request.");
      }
      const url = new URL(request.url);
      const callbackUrl = new URL("/auth/callback", url.origin);
      callbackUrl.searchParams.set("next", requestedNext);
      try {
        if (await provider.requestEmailAuthentication({
          email,
          callbackUrl: callbackUrl.href,
          request,
          context,
        }) === true) {
          return jsonValue(202, { ok: true });
        }
      } catch {
        // Provider failures become one public response and reveal no provider detail.
      }
      return json(503, "Authentication could not start.");
    },
    authCallback: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      const next = safeNextPath(url.searchParams.get("next"), homePath);
      if (code === null || code.length === 0 || code.length > 4096) {
        return redirect(new URL(`${homePath}?auth=error`, url.origin));
      }
      try {
        if (await provider.exchangeAuthCode({ code, request, context }) === true) {
          return redirect(new URL(next, url.origin));
        }
      } catch {
        // Provider failures become one public response and reveal no provider detail.
      }
      return redirect(new URL(`${homePath}?auth=error`, url.origin));
    },
    authVerify: async (request: Request): Promise<Response> => {
      if (!sameOrigin(request)) return json(403, "Invalid origin.");
      const input = await boundedJson(request);
      if (input === null || Object.keys(input).some((key) => key !== "email" && key !== "code")) {
        return json(400, "Invalid authentication request.");
      }
      const email = exactString(input, "email", 320)?.trim() ?? null;
      const code = exactString(input, "code", 4096)?.replace(/\s+/gu, "") ?? null;
      if (email === null || !email.includes("@") || code === null || code.length === 0) {
        return json(400, "Invalid authentication request.");
      }
      try {
        const session = safeSession(await provider.verifyEmailAuthentication({
          email,
          code,
          request,
          context,
        }));
        if (session?.authenticated === true) return jsonValue(200, session);
      } catch {
        // Provider failures become one public response and reveal no provider detail.
      }
      return json(401, "Authentication failed.");
    },
    sessionRead: async (request: Request): Promise<Response> => {
      try {
        const session = safeSession(await provider.getSession({ request, context }));
        if (session !== null) return jsonValue(200, session);
      } catch {
        // Provider failures become one public response and reveal no provider detail.
      }
      return json(503, "Synchronization is unavailable.");
    },
    sessionDelete: async (request: Request): Promise<Response> => {
      if (!sameOrigin(request)) return json(403, "Invalid origin.");
      try {
        if (await provider.signOut({ request, context }) === true) {
          return jsonValue(200, { ok: true });
        }
      } catch {
        // Provider failures become one public response and reveal no provider detail.
      }
      return json(503, "Sign out failed.");
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
          return jsonValue(200, { ok: true });
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
    syncRead: async (request: Request): Promise<Response> => {
      try {
        const state = safeRemoteState(await provider.readRemoteState({ request, context }), context.capabilities);
        if (state !== null) return jsonValue(200, state);
      } catch {
        // Provider failures become one public response and reveal no provider detail.
      }
      return json(503, "Synchronization is unavailable.");
    },
    syncTransfer: async (request: Request): Promise<Response> => {
      if (!sameOrigin(request)) return json(403, "Invalid origin.");
      const body = await boundedJson(request, 4_718_592);
      const transfer = body === null ? null : safeTransfer(body, context.capabilities);
      if (transfer === null) return json(400, "Invalid synchronization request.");
      try {
        const result = safeTransferResult(await provider.transferRemoteState({
          transfer,
          request,
          context,
        }), context.capabilities);
        if (result !== null) return jsonValue(200, result);
      } catch {
        // Provider failures become one public response and reveal no provider detail.
      }
      return json(503, "Synchronization is unavailable.");
    },
  });
}
