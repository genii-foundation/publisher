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

import {
  READER_BOOKMARKS_SCHEMA_VERSION,
  mergeReaderBookmarksStates,
  pruneReaderBookmarksToRemoteBudget,
  sanitizeReaderBookmarksState,
  serializeReaderBookmarksState,
  type ReaderBookmarksState,
} from "./bookmarks.js";
import {
  READER_PROGRESS_SCHEMA_VERSION,
  mergeReaderProgressStates,
  sanitizeReaderProgressState,
  serializeReaderProgressState,
  type ReaderProgressState,
} from "./progress.js";

export const DEFAULT_READER_SYNC_DEBOUNCE_MS = 750;
export const DEFAULT_READER_SYNC_RETRY_MS = 2_000;
export const MAXIMUM_READER_SYNC_RETRY_MS = 60_000;
export const READER_SYNC_CONSENT_SCHEMA_VERSION = 1 as const;
export const READER_SYNC_CONSENT_STORAGE_PREFIX =
  "genii.publisher.reader.sync-consent";
export const READER_ENGAGEMENT_SCHEMA_VERSION = 1 as const;
export const READER_ENGAGEMENT_STORAGE_PREFIX =
  "genii.publisher.reader.engagement";
export const MAXIMUM_READER_ENGAGEMENT_EVENTS = 2_000;
export const MAXIMUM_READER_ENGAGEMENT_TRANSFER_EVENTS = 256;

export const READER_ENGAGEMENT_EVENT_TYPES = Object.freeze([
  "section_opened",
  "section_visibility_ended",
  "scroll_milestone",
  "read_threshold_crossed",
  "manual_mark_read",
  "section_returned",
  "navigation_source_used",
  "search_submitted",
  "search_result_clicked",
  "recommendation_shown",
  "recommendation_clicked",
  "updated_notice_shown",
  "updated_notice_clicked",
  "audio_started",
  "audio_paused",
  "audio_resumed",
  "audio_completed",
  "audio_seconds_listened",
  "bookmark_added",
  "bookmark_removed",
] as const);

export type ReaderEngagementEventType =
  (typeof READER_ENGAGEMENT_EVENT_TYPES)[number];

export interface ReaderSyncConsent {
  readonly schemaVersion: typeof READER_SYNC_CONSENT_SCHEMA_VERSION;
  readonly publicationId: string;
  readonly copyVersion: string;
  readonly granted: boolean;
  readonly grantedAt: number | null;
  readonly revokedAt: number | null;
}

export interface ReaderEngagementEvent {
  readonly clientEventId: string;
  readonly eventType: ReaderEngagementEventType;
  readonly eventAt: number;
  readonly sectionId?: string;
  readonly contentHash?: string;
  readonly route?: string;
  readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
  readonly syncedAt?: number;
}

export interface ReaderEngagementState {
  readonly schemaVersion: typeof READER_ENGAGEMENT_SCHEMA_VERSION;
  readonly publicationId: string;
  readonly events: readonly ReaderEngagementEvent[];
}

export type ReaderSyncPhase = "idle" | "waiting" | "in-flight" | "offline";

export interface ReaderSyncCoordinatorState {
  readonly publicationId: string;
  readonly phase: ReaderSyncPhase;
  readonly online: boolean;
  readonly revision: number;
  readonly acknowledgedRevision: number;
  readonly inFlightRevision: number | null;
  readonly nextAttemptAt: number | null;
  readonly failureCount: number;
}

export interface ReaderSyncAttempt {
  readonly revision: number;
  readonly state: ReaderSyncCoordinatorState;
}

export interface ReaderSyncScheduleOptions {
  readonly debounceMs?: number;
  readonly retryBaseMs?: number;
}

export interface ReaderSyncRemoteDocument {
  readonly value: unknown;
  readonly schemaVersion: number;
}

export interface ReaderSyncRemoteState {
  readonly progress: ReaderSyncRemoteDocument | null;
  readonly bookmarks: ReaderSyncRemoteDocument | null;
}

export type ReaderSyncMergeStatus =
  | "absent"
  | "current"
  | "schema-ahead";

export interface ReaderSyncReconciliation {
  readonly progress: ReaderProgressState;
  readonly bookmarks: ReaderBookmarksState;
  readonly progressStatus: ReaderSyncMergeStatus;
  readonly bookmarksStatus: ReaderSyncMergeStatus;
  readonly transferProgress: ReaderProgressState | null;
  readonly transferBookmarks: ReaderBookmarksState | null;
}

export interface ReaderSyncReconciliationContext {
  readonly publicationId: string;
  readonly now: number;
}

const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function requirePublicationId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    !STABLE_ID.test(value)
  ) {
    throw new TypeError("The publication ID must be a portable stable identifier.");
  }
}

function requireNow(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError("now must be a nonnegative epoch millisecond integer.");
  }
}

function requireCopyVersion(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64) {
    throw new TypeError("The consent copy version must contain 1 to 64 characters.");
  }
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function readPlainDataRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function sanitizeEngagementEvent(value: unknown): ReaderEngagementEvent | null {
  const event = readPlainDataRecord(value);
  if (event === null) return null;
  const allowed = new Set([
    "clientEventId", "eventType", "eventAt", "sectionId",
    "contentHash", "route", "payload", "syncedAt",
  ]);
  if (Object.keys(event).some((key) => !allowed.has(key))) return null;
  if (
    typeof event.clientEventId !== "string" ||
    event.clientEventId.length < 1 || event.clientEventId.length > 128 ||
    typeof event.eventType !== "string" ||
    !READER_ENGAGEMENT_EVENT_TYPES.includes(event.eventType as ReaderEngagementEventType) ||
    !isTimestamp(event.eventAt) ||
    !(event.syncedAt === undefined || isTimestamp(event.syncedAt))
  ) return null;
  for (const [key, maximum] of [["sectionId", 128], ["contentHash", 128], ["route", 512]] as const) {
    const candidate = event[key];
    if (candidate !== undefined && (typeof candidate !== "string" || candidate.length > maximum)) return null;
  }
  const rawPayload = event.payload === undefined ? undefined : readPlainDataRecord(event.payload);
  if (rawPayload === null || rawPayload !== undefined && Object.keys(rawPayload).length > 64) return null;
  if (rawPayload !== undefined) {
    for (const candidate of Object.values(rawPayload)) {
      if (
        candidate !== null &&
        typeof candidate !== "string" &&
        typeof candidate !== "number" &&
        typeof candidate !== "boolean"
      ) return null;
      if (typeof candidate === "number" && !Number.isFinite(candidate)) return null;
      if (typeof candidate === "string" && candidate.length > 2_048) return null;
    }
  }
  return Object.freeze({
    clientEventId: event.clientEventId,
    eventType: event.eventType as ReaderEngagementEventType,
    eventAt: event.eventAt,
    ...(event.sectionId === undefined ? {} : { sectionId: event.sectionId as string }),
    ...(event.contentHash === undefined ? {} : { contentHash: event.contentHash as string }),
    ...(event.route === undefined ? {} : { route: event.route as string }),
    ...(rawPayload === undefined ? {} : {
      payload: Object.freeze({ ...rawPayload }) as Readonly<
        Record<string, string | number | boolean | null>
      >,
    }),
    ...(event.syncedAt === undefined ? {} : { syncedAt: event.syncedAt as number }),
  });
}

function consentStorageKey(publicationId: string): string {
  return `${READER_SYNC_CONSENT_STORAGE_PREFIX}.v${READER_SYNC_CONSENT_SCHEMA_VERSION}.${publicationId}`;
}

function engagementStorageKey(publicationId: string): string {
  return `${READER_ENGAGEMENT_STORAGE_PREFIX}.v${READER_ENGAGEMENT_SCHEMA_VERSION}.${publicationId}`;
}

export function createReaderSyncConsentStorageKey(publicationId: string): string {
  requirePublicationId(publicationId);
  return consentStorageKey(publicationId);
}

export function createReaderEngagementStorageKey(publicationId: string): string {
  requirePublicationId(publicationId);
  return engagementStorageKey(publicationId);
}

export function createReaderSyncConsent(
  publicationId: string,
  copyVersion: string,
): ReaderSyncConsent {
  requirePublicationId(publicationId);
  requireCopyVersion(copyVersion);
  return Object.freeze({
    schemaVersion: READER_SYNC_CONSENT_SCHEMA_VERSION,
    publicationId,
    copyVersion,
    granted: false,
    grantedAt: null,
    revokedAt: null,
  });
}

export function grantReaderSyncConsent(
  consent: ReaderSyncConsent,
  now: number,
): ReaderSyncConsent {
  requireNow(now);
  requirePublicationId(consent.publicationId);
  requireCopyVersion(consent.copyVersion);
  return Object.freeze({
    schemaVersion: READER_SYNC_CONSENT_SCHEMA_VERSION,
    publicationId: consent.publicationId,
    copyVersion: consent.copyVersion,
    granted: true,
    grantedAt: now,
    revokedAt: null,
  });
}

export function revokeReaderSyncConsent(
  consent: ReaderSyncConsent,
  now: number,
): ReaderSyncConsent {
  requireNow(now);
  requirePublicationId(consent.publicationId);
  requireCopyVersion(consent.copyVersion);
  return Object.freeze({
    schemaVersion: READER_SYNC_CONSENT_SCHEMA_VERSION,
    publicationId: consent.publicationId,
    copyVersion: consent.copyVersion,
    granted: false,
    grantedAt: consent.grantedAt,
    revokedAt: now,
  });
}

export function serializeReaderSyncConsent(consent: ReaderSyncConsent): string {
  requirePublicationId(consent.publicationId);
  requireCopyVersion(consent.copyVersion);
  return JSON.stringify(consent);
}

export function parseReaderSyncConsent(
  serialized: string | null | undefined,
  publicationId: string,
  copyVersion: string,
): ReaderSyncConsent {
  const fallback = createReaderSyncConsent(publicationId, copyVersion);
  if (typeof serialized !== "string" || serialized.length > 1_024) return fallback;
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (
      value.schemaVersion !== READER_SYNC_CONSENT_SCHEMA_VERSION ||
      value.publicationId !== publicationId ||
      value.copyVersion !== copyVersion ||
      typeof value.granted !== "boolean" ||
      !(value.grantedAt === null || isTimestamp(value.grantedAt)) ||
      !(value.revokedAt === null || isTimestamp(value.revokedAt))
    ) return fallback;
    return Object.freeze({
      schemaVersion: READER_SYNC_CONSENT_SCHEMA_VERSION,
      publicationId,
      copyVersion,
      granted: value.granted,
      grantedAt: value.grantedAt as number | null,
      revokedAt: value.revokedAt as number | null,
    });
  } catch {
    return fallback;
  }
}

export function createEmptyReaderEngagementState(
  publicationId: string,
): ReaderEngagementState {
  requirePublicationId(publicationId);
  return Object.freeze({
    schemaVersion: READER_ENGAGEMENT_SCHEMA_VERSION,
    publicationId,
    events: Object.freeze([]),
  });
}

export function addReaderEngagementEvent(
  state: ReaderEngagementState,
  event: ReaderEngagementEvent,
): ReaderEngagementState {
  requirePublicationId(state.publicationId);
  const sanitized = sanitizeEngagementEvent(event);
  if (sanitized === null) throw new TypeError("The engagement event is invalid.");
  if (state.events.some((candidate) => candidate.clientEventId === sanitized.clientEventId)) return state;
  const appended = [...state.events, sanitized];
  const unsynced = appended.filter((candidate) => candidate.syncedAt === undefined);
  const synced = appended.filter((candidate) => candidate.syncedAt !== undefined);
  const retained = unsynced.length >= MAXIMUM_READER_ENGAGEMENT_EVENTS
    ? unsynced.slice(-MAXIMUM_READER_ENGAGEMENT_EVENTS)
    : [...synced.slice(-(MAXIMUM_READER_ENGAGEMENT_EVENTS - unsynced.length)), ...unsynced]
      .sort((left, right) => left.eventAt - right.eventAt || left.clientEventId.localeCompare(right.clientEventId));
  return Object.freeze({
    schemaVersion: READER_ENGAGEMENT_SCHEMA_VERSION,
    publicationId: state.publicationId,
    events: Object.freeze(retained),
  });
}

export function readerEngagementEventsForTransfer(
  state: ReaderEngagementState,
): readonly ReaderEngagementEvent[] {
  requirePublicationId(state.publicationId);
  return Object.freeze(
    state.events
      .filter((event) => event.syncedAt === undefined)
      .slice(0, MAXIMUM_READER_ENGAGEMENT_TRANSFER_EVENTS),
  );
}

export function acknowledgeReaderEngagementEvents(
  state: ReaderEngagementState,
  clientEventIds: readonly string[],
  now: number,
): ReaderEngagementState {
  requireNow(now);
  const acknowledged = new Set(clientEventIds);
  return Object.freeze({
    schemaVersion: READER_ENGAGEMENT_SCHEMA_VERSION,
    publicationId: state.publicationId,
    events: Object.freeze(state.events.map((event) =>
      acknowledged.has(event.clientEventId) && event.syncedAt === undefined
        ? Object.freeze({ ...event, syncedAt: now })
        : event)),
  });
}

export function serializeReaderEngagementState(
  state: ReaderEngagementState,
): string {
  requirePublicationId(state.publicationId);
  return JSON.stringify(state);
}

export function parseReaderEngagementState(
  serialized: string | null | undefined,
  publicationId: string,
): ReaderEngagementState {
  const empty = createEmptyReaderEngagementState(publicationId);
  if (typeof serialized !== "string" || serialized.length > 2_097_152) return empty;
  try {
    const value = JSON.parse(serialized) as { schemaVersion?: unknown; publicationId?: unknown; events?: unknown };
    if (value.schemaVersion !== 1 || value.publicationId !== publicationId || !Array.isArray(value.events)) return empty;
    let state = empty;
    for (const candidate of value.events.slice(-MAXIMUM_READER_ENGAGEMENT_EVENTS)) {
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      try {
        state = addReaderEngagementEvent(state, candidate as ReaderEngagementEvent);
      } catch {
        // Invalid stored events are discarded independently.
      }
    }
    return state;
  } catch {
    return empty;
  }
}

function boundedDelay(value: unknown, fallback: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAXIMUM_READER_SYNC_RETRY_MS) {
    return fallback;
  }
  return value as number;
}

function freezeCoordinator(
  value: ReaderSyncCoordinatorState,
): ReaderSyncCoordinatorState {
  return Object.freeze({ ...value });
}

export function createReaderSyncCoordinatorState(
  publicationId: string,
  online = true,
): ReaderSyncCoordinatorState {
  requirePublicationId(publicationId);
  if (typeof online !== "boolean") {
    throw new TypeError("online must be a boolean.");
  }
  return freezeCoordinator({
    publicationId,
    phase: online ? "idle" : "offline",
    online,
    revision: 0,
    acknowledgedRevision: 0,
    inFlightRevision: null,
    nextAttemptAt: null,
    failureCount: 0,
  });
}

export function noteReaderSyncChange(
  state: ReaderSyncCoordinatorState,
  now: number,
  options: ReaderSyncScheduleOptions = {},
): ReaderSyncCoordinatorState {
  requireNow(now);
  const debounceMs = boundedDelay(options.debounceMs, DEFAULT_READER_SYNC_DEBOUNCE_MS);
  const revision = state.revision + 1;
  if (!Number.isSafeInteger(revision)) {
    throw new RangeError("The synchronization revision limit was reached.");
  }
  if (!state.online) {
    return freezeCoordinator({
      ...state,
      phase: "offline",
      revision,
      nextAttemptAt: null,
    });
  }
  if (state.inFlightRevision !== null) {
    return freezeCoordinator({ ...state, revision });
  }
  return freezeCoordinator({
    ...state,
    phase: "waiting",
    revision,
    nextAttemptAt: now + debounceMs,
  });
}

export function setReaderSyncOnline(
  state: ReaderSyncCoordinatorState,
  online: boolean,
  now: number,
): ReaderSyncCoordinatorState {
  requireNow(now);
  if (typeof online !== "boolean") throw new TypeError("online must be a boolean.");
  if (!online) {
    return freezeCoordinator({
      ...state,
      online: false,
      phase: "offline",
      nextAttemptAt: null,
    });
  }
  if (state.online) return state;
  const pending = state.revision > state.acknowledgedRevision;
  return freezeCoordinator({
    ...state,
    online: true,
    phase: state.inFlightRevision === null && pending ? "waiting" : state.inFlightRevision === null ? "idle" : "in-flight",
    nextAttemptAt: state.inFlightRevision === null && pending ? now : null,
  });
}

export function beginReaderSyncAttempt(
  state: ReaderSyncCoordinatorState,
  now: number,
): ReaderSyncAttempt | null {
  requireNow(now);
  if (
    !state.online ||
    state.inFlightRevision !== null ||
    state.revision <= state.acknowledgedRevision ||
    state.nextAttemptAt === null ||
    now < state.nextAttemptAt
  ) return null;
  const revision = state.revision;
  return Object.freeze({
    revision,
    state: freezeCoordinator({
      ...state,
      phase: "in-flight",
      inFlightRevision: revision,
      nextAttemptAt: null,
    }),
  });
}

export function completeReaderSyncAttempt(
  state: ReaderSyncCoordinatorState,
  revision: number,
  succeeded: boolean,
  now: number,
  options: ReaderSyncScheduleOptions = {},
): ReaderSyncCoordinatorState {
  requireNow(now);
  if (state.inFlightRevision !== revision) {
    throw new TypeError("The synchronization attempt does not match the active revision.");
  }
  if (typeof succeeded !== "boolean") throw new TypeError("succeeded must be a boolean.");
  if (!state.online) {
    return freezeCoordinator({
      ...state,
      phase: "offline",
      inFlightRevision: null,
      nextAttemptAt: null,
    });
  }
  if (succeeded) {
    const acknowledgedRevision = Math.max(state.acknowledgedRevision, revision);
    const pending = state.revision > acknowledgedRevision;
    return freezeCoordinator({
      ...state,
      phase: pending ? "waiting" : "idle",
      acknowledgedRevision,
      inFlightRevision: null,
      nextAttemptAt: pending ? now : null,
      failureCount: 0,
    });
  }
  const retryBaseMs = Math.max(1, boundedDelay(options.retryBaseMs, DEFAULT_READER_SYNC_RETRY_MS));
  const failureCount = Math.min(30, state.failureCount + 1);
  const retryMs = Math.min(
    MAXIMUM_READER_SYNC_RETRY_MS,
    retryBaseMs * (2 ** Math.min(10, failureCount - 1)),
  );
  return freezeCoordinator({
    ...state,
    phase: "waiting",
    inFlightRevision: null,
    nextAttemptAt: now + retryMs,
    failureCount,
  });
}

export function reconcileReaderSyncState(
  currentProgress: ReaderProgressState,
  currentBookmarks: ReaderBookmarksState,
  remote: ReaderSyncRemoteState,
  context: ReaderSyncReconciliationContext,
): ReaderSyncReconciliation {
  requirePublicationId(context.publicationId);
  requireNow(context.now);
  const progressContext = { publicationId: context.publicationId, now: context.now };
  const bookmarkContext = { publicationId: context.publicationId, now: context.now };
  const localProgress = sanitizeReaderProgressState(currentProgress, progressContext);
  const localBookmarks = sanitizeReaderBookmarksState(currentBookmarks, bookmarkContext);

  let progress = localProgress;
  let progressStatus: ReaderSyncMergeStatus = "absent";
  let transferProgress: ReaderProgressState | null = localProgress;
  if (remote.progress !== null) {
    if (remote.progress.schemaVersion > READER_PROGRESS_SCHEMA_VERSION) {
      progressStatus = "schema-ahead";
      transferProgress = null;
    } else {
      const remoteProgress = sanitizeReaderProgressState(remote.progress.value, progressContext);
      progress = mergeReaderProgressStates(localProgress, remoteProgress, progressContext);
      progressStatus = "current";
      transferProgress = serializeReaderProgressState(progress, progressContext) ===
        serializeReaderProgressState(remoteProgress, progressContext) ? null : progress;
    }
  }

  let bookmarks = localBookmarks;
  let bookmarksStatus: ReaderSyncMergeStatus = "absent";
  let transferBookmarks: ReaderBookmarksState | null =
    pruneReaderBookmarksToRemoteBudget(localBookmarks, bookmarkContext);
  if (remote.bookmarks !== null) {
    if (remote.bookmarks.schemaVersion > READER_BOOKMARKS_SCHEMA_VERSION) {
      bookmarksStatus = "schema-ahead";
      transferBookmarks = null;
    } else {
      const remoteBookmarks = sanitizeReaderBookmarksState(remote.bookmarks.value, bookmarkContext);
      bookmarks = mergeReaderBookmarksStates(localBookmarks, remoteBookmarks, bookmarkContext);
      bookmarksStatus = "current";
      const bounded = pruneReaderBookmarksToRemoteBudget(bookmarks, bookmarkContext);
      transferBookmarks = serializeReaderBookmarksState(bounded, bookmarkContext) ===
        serializeReaderBookmarksState(remoteBookmarks, bookmarkContext) ? null : bounded;
    }
  }

  return Object.freeze({
    progress,
    bookmarks,
    progressStatus,
    bookmarksStatus,
    transferProgress,
    transferBookmarks,
  });
}
