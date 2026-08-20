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

import type { ReaderSection } from "@genii-foundation/publisher-schema/reader";

export const READER_PROGRESS_SCHEMA_VERSION = 1 as const;
export const READER_PROGRESS_STORAGE_PREFIX = "genii.publisher.reader.progress";
export const MAXIMUM_READER_PROGRESS_ENTRIES = 10_000;
export const MAXIMUM_READER_PROGRESS_INPUT_ENTRIES = 20_000;
export const MAXIMUM_READER_PROGRESS_SERIALIZED_BYTES = 8_388_608;
export const MAXIMUM_READER_PROGRESS_CONTINUITY_IDS = 4_096;
export const MAXIMUM_READER_PROGRESS_READ_HASHES = 64;

export const READER_NAVIGATION_SOURCES = Object.freeze([
  "direct",
  "next",
  "previous",
  "contents",
  "outline",
  "search",
  "bookmark",
  "recommendation",
  "chapter",
  "updated",
  "audio",
  "external",
  "restored",
  "unknown",
] as const);

export type ReaderReadMethod = "automatic" | "manual";
export type ReaderNavigationSource =
  (typeof READER_NAVIGATION_SOURCES)[number];
export type ReaderSectionProgressStatus =
  | "unread"
  | "partial"
  | "read"
  | "updated";

export interface ReaderSectionProgress {
  /** Continuity identities whose progress this record covers. */
  readonly continuityIds: readonly string[];
  readonly contentHash: string;
  readonly percent: number;
  readonly scrollPercent: number;
  readonly readingTimeMs: number;
  readonly audioPositionMs: number;
  readonly firstOpenedAt: number | null;
  readonly lastOpenedAt: number | null;
  readonly openCount: number;
  readonly navigationSource: ReaderNavigationSource | null;
  readonly firstReadAt: number | null;
  readonly lastReadAt: number | null;
  readonly readCount: number;
  readonly readMethod: ReaderReadMethod | null;
  readonly readContentHash: string | null;
  /** Bounded evidence of every content revision read on this identity. */
  readonly readContentHashes: readonly string[];
  readonly updatedAt: number;
}

export interface ReaderProgressState {
  readonly schemaVersion: typeof READER_PROGRESS_SCHEMA_VERSION;
  readonly publicationId: string;
  readonly entries: Readonly<Record<string, ReaderSectionProgress>>;
}

export interface ReaderProgressContext {
  readonly publicationId: string;
  /** Epoch milliseconds supplied by the caller. */
  readonly now: number;
  /** Current reader sections used to fold reviewed continuity aliases. */
  readonly sections?: readonly ReaderProgressSection[];
}

export type ReaderProgressSection = Pick<
  ReaderSection,
  "id" | "continuity" | "contentHash" | "wordCount"
>;

export interface ReaderProgressEvent {
  /** Epoch milliseconds supplied by the caller. */
  readonly now: number;
  readonly opened?: boolean;
  readonly navigationSource?: ReaderNavigationSource;
  readonly percent?: number;
  readonly scrollPercent?: number;
  /** A cumulative metric, not a delta. */
  readonly readingTimeMs?: number;
  /** The furthest narrated position reached in this section. */
  readonly audioPositionMs?: number;
  readonly read?: ReaderReadMethod;
}

export interface ReaderSectionProgressIdentity {
  readonly continuityId: string;
  /** Disjoint reviewed progress groups in declaration order. */
  readonly groups: readonly (readonly string[])[];
  readonly aliases: readonly string[];
}

export interface ResolvedReaderSectionProgress {
  readonly identity: ReaderSectionProgressIdentity;
  readonly progress: ReaderSectionProgress | null;
  readonly revisionDetected: boolean;
  readonly status: ReaderSectionProgressStatus;
}

export interface ReaderAggregateProgress {
  readonly percent: number;
  readonly completedWordCount: number;
  readonly totalWordCount: number;
  readonly sectionCount: number;
  readonly statuses: Readonly<
    Record<ReaderSectionProgressStatus, number>
  >;
}

const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const DANGEROUS_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAXIMUM_COUNTER = 1_000_000_000;
const MAXIMUM_DURATION_MS = 315_576_000_000;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isStableId(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    !DANGEROUS_RECORD_KEYS.has(value) &&
    STABLE_ID.test(value)
  );
}

function requirePublicationId(value: unknown): asserts value is string {
  if (!isStableId(value, 128)) {
    throw new TypeError(
      "The publication ID must be a portable stable identifier.",
    );
  }
}

function requireNow(value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError("now must be a nonnegative epoch millisecond integer.");
  }
}

function readPlainDataRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
      Object.defineProperty(record, key, {
        enumerable: true,
        value: descriptor.value,
      });
    }
    return record;
  } catch {
    return undefined;
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function boundedInteger(
  value: unknown,
  maximum: number,
  fallback = 0,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.min(maximum, Math.floor(value));
}

function boundedPercent(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(clamped * 1_000) / 1_000;
}

function boundedTimestamp(value: unknown, now: number): number | null {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return null;
  }
  return Math.min(value, now);
}

function earlierTimestamp(
  left: number | null,
  right: number | null,
): number | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.min(left, right);
}

function laterTimestamp(
  left: number | null,
  right: number | null,
): number | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.max(left, right);
}

function validNavigationSource(
  value: unknown,
): ReaderNavigationSource | null {
  return READER_NAVIGATION_SOURCES.find(
    (candidate) => candidate === value,
  ) ?? null;
}

function frozenEntry(
  value: ReaderSectionProgress,
): ReaderSectionProgress {
  return Object.freeze({
    continuityIds: Object.freeze([...value.continuityIds]),
    contentHash: value.contentHash,
    percent: value.percent,
    scrollPercent: value.scrollPercent,
    readingTimeMs: value.readingTimeMs,
    audioPositionMs: value.audioPositionMs,
    firstOpenedAt: value.firstOpenedAt,
    lastOpenedAt: value.lastOpenedAt,
    openCount: value.openCount,
    navigationSource: value.navigationSource,
    firstReadAt: value.firstReadAt,
    lastReadAt: value.lastReadAt,
    readCount: value.readCount,
    readMethod: value.readMethod,
    readContentHash: value.readContentHash,
    readContentHashes: Object.freeze([...value.readContentHashes]),
    updatedAt: value.updatedAt,
  });
}

function sanitizeEntry(
  value: unknown,
  now: number,
  entryKey: string,
): ReaderSectionProgress | undefined {
  const record = readPlainDataRecord(value);
  if (
    record === undefined ||
    typeof record.contentHash !== "string" ||
    !SHA256_DIGEST.test(record.contentHash)
  ) {
    return undefined;
  }

  let firstOpenedAt = boundedTimestamp(record.firstOpenedAt, now);
  let lastOpenedAt = boundedTimestamp(record.lastOpenedAt, now);
  if (firstOpenedAt !== null && lastOpenedAt !== null) {
    const earliest = Math.min(firstOpenedAt, lastOpenedAt);
    const latest = Math.max(firstOpenedAt, lastOpenedAt);
    firstOpenedAt = earliest;
    lastOpenedAt = latest;
  } else if (firstOpenedAt !== null || lastOpenedAt !== null) {
    const onlyTimestamp = firstOpenedAt ?? lastOpenedAt;
    firstOpenedAt = onlyTimestamp;
    lastOpenedAt = onlyTimestamp;
  }
  const openCount =
    firstOpenedAt === null
      ? 0
      : Math.max(
          1,
          boundedInteger(record.openCount, MAXIMUM_COUNTER, 1),
        );

  let firstReadAt = boundedTimestamp(record.firstReadAt, now);
  let lastReadAt = boundedTimestamp(record.lastReadAt, now);
  if (firstReadAt !== null && lastReadAt !== null) {
    const earliest = Math.min(firstReadAt, lastReadAt);
    const latest = Math.max(firstReadAt, lastReadAt);
    firstReadAt = earliest;
    lastReadAt = latest;
  } else if (firstReadAt !== null || lastReadAt !== null) {
    const onlyTimestamp = firstReadAt ?? lastReadAt;
    firstReadAt = onlyTimestamp;
    lastReadAt = onlyTimestamp;
  }
  const readCount =
    firstReadAt === null
      ? 0
      : Math.max(
          1,
          boundedInteger(record.readCount, MAXIMUM_COUNTER, 1),
        );
  const readContentHash =
    firstReadAt !== null &&
    typeof record.readContentHash === "string" &&
    SHA256_DIGEST.test(record.readContentHash)
      ? record.readContentHash
      : null;
  const rawReadContentHashes = firstReadAt !== null &&
    Array.isArray(record.readContentHashes)
    ? record.readContentHashes
    : [];
  const readContentHashes = [...new Set([
    ...rawReadContentHashes.filter(
      (hash): hash is string =>
        typeof hash === "string" && SHA256_DIGEST.test(hash),
    ),
    ...(readContentHash === null ? [] : [readContentHash]),
  ])]
    .sort(compareText)
    .slice(0, MAXIMUM_READER_PROGRESS_READ_HASHES);
  const readMethod =
    firstReadAt !== null &&
    (record.readMethod === "automatic" || record.readMethod === "manual")
      ? record.readMethod
      : null;

  const rawContinuityIds = Array.isArray(record.continuityIds)
    ? record.continuityIds
    : [];
  const continuityIds = [...new Set([
    entryKey,
    ...rawContinuityIds.filter((id): id is string =>
      isStableId(id, 256),
    ),
  ])]
    .sort(compareText)
    .slice(0, MAXIMUM_READER_PROGRESS_CONTINUITY_IDS);

  return frozenEntry({
    continuityIds,
    contentHash: record.contentHash,
    percent: boundedPercent(record.percent),
    scrollPercent: boundedPercent(record.scrollPercent),
    readingTimeMs: boundedInteger(
      record.readingTimeMs,
      MAXIMUM_DURATION_MS,
    ),
    audioPositionMs: boundedInteger(
      record.audioPositionMs,
      MAXIMUM_DURATION_MS,
    ),
    firstOpenedAt,
    lastOpenedAt,
    openCount,
    navigationSource:
      firstOpenedAt === null
        ? null
        : validNavigationSource(record.navigationSource),
    firstReadAt,
    lastReadAt,
    readCount,
    readMethod,
    readContentHash,
    readContentHashes,
    updatedAt: boundedTimestamp(record.updatedAt, now) ?? 0,
  });
}

function chooseNavigationSource(
  left: ReaderSectionProgress,
  right: ReaderSectionProgress,
): ReaderNavigationSource | null {
  const leftTime = left.lastOpenedAt ?? -1;
  const rightTime = right.lastOpenedAt ?? -1;
  if (leftTime !== rightTime) {
    return leftTime > rightTime
      ? left.navigationSource
      : right.navigationSource;
  }
  const candidates = [left.navigationSource, right.navigationSource]
    .filter((value): value is ReaderNavigationSource => value !== null)
    .sort(compareText);
  return candidates[0] ?? null;
}

function readDescriptorRank(method: ReaderReadMethod | null): number {
  return method === "manual" ? 2 : method === "automatic" ? 1 : 0;
}

function chooseReadDescriptor(
  left: ReaderSectionProgress,
  right: ReaderSectionProgress,
): Pick<
  ReaderSectionProgress,
  "readContentHash" | "readMethod"
> {
  const leftTime = left.lastReadAt ?? -1;
  const rightTime = right.lastReadAt ?? -1;
  if (leftTime !== rightTime) {
    return leftTime > rightTime
      ? {
          readContentHash: left.readContentHash,
          readMethod: left.readMethod,
        }
      : {
          readContentHash: right.readContentHash,
          readMethod: right.readMethod,
        };
  }
  const leftRank = readDescriptorRank(left.readMethod);
  const rightRank = readDescriptorRank(right.readMethod);
  if (leftRank !== rightRank) {
    return leftRank > rightRank
      ? {
          readContentHash: left.readContentHash,
          readMethod: left.readMethod,
        }
      : {
          readContentHash: right.readContentHash,
          readMethod: right.readMethod,
        };
  }
  const leftHash = left.readContentHash ?? "";
  const rightHash = right.readContentHash ?? "";
  return compareText(leftHash, rightHash) <= 0
    ? {
        readContentHash: left.readContentHash,
        readMethod: left.readMethod,
      }
    : {
        readContentHash: right.readContentHash,
        readMethod: right.readMethod,
      };
}

function chooseObservedContentHash(
  left: ReaderSectionProgress,
  right: ReaderSectionProgress,
): string {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt
      ? left.contentHash
      : right.contentHash;
  }
  return compareText(left.contentHash, right.contentHash) <= 0
    ? left.contentHash
    : right.contentHash;
}

function mergeEntries(
  left: ReaderSectionProgress,
  right: ReaderSectionProgress,
): ReaderSectionProgress {
  const readDescriptor = chooseReadDescriptor(left, right);
  return frozenEntry({
    continuityIds: [...new Set([
      ...left.continuityIds,
      ...right.continuityIds,
    ])]
      .sort(compareText)
      .slice(0, MAXIMUM_READER_PROGRESS_CONTINUITY_IDS),
    contentHash: chooseObservedContentHash(left, right),
    percent: Math.max(left.percent, right.percent),
    scrollPercent: Math.max(left.scrollPercent, right.scrollPercent),
    readingTimeMs: Math.max(left.readingTimeMs, right.readingTimeMs),
    audioPositionMs: Math.max(left.audioPositionMs, right.audioPositionMs),
    firstOpenedAt: earlierTimestamp(
      left.firstOpenedAt,
      right.firstOpenedAt,
    ),
    lastOpenedAt: laterTimestamp(left.lastOpenedAt, right.lastOpenedAt),
    openCount: Math.max(left.openCount, right.openCount),
    navigationSource: chooseNavigationSource(left, right),
    firstReadAt: earlierTimestamp(left.firstReadAt, right.firstReadAt),
    lastReadAt: laterTimestamp(left.lastReadAt, right.lastReadAt),
    readCount: Math.max(left.readCount, right.readCount),
    readMethod: readDescriptor.readMethod,
    readContentHash: readDescriptor.readContentHash,
    readContentHashes: [...new Set([
      ...left.readContentHashes,
      ...right.readContentHashes,
    ])]
      .sort(compareText)
      .slice(0, MAXIMUM_READER_PROGRESS_READ_HASHES),
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
  });
}

function freezeState(
  publicationId: string,
  candidateEntries: ReadonlyMap<string, ReaderSectionProgress>,
): ReaderProgressState {
  // Stable key ranking makes bounded merge associative. A recency-ranked cap
  // can discard an old entry before a later merge updates the same key, which
  // makes three-device convergence depend on merge order.
  const retained = [...candidateEntries.entries()]
    .sort((left, right) => compareText(left[0], right[0]))
    .slice(0, MAXIMUM_READER_PROGRESS_ENTRIES);
  const entries = Object.create(null) as Record<
    string,
    ReaderSectionProgress
  >;
  for (const [key, entry] of retained) {
    Object.defineProperty(entries, key, {
      enumerable: true,
      value: entry,
    });
  }
  Object.freeze(entries);
  return Object.freeze({
    schemaVersion: READER_PROGRESS_SCHEMA_VERSION,
    publicationId,
    entries,
  });
}

function emptyState(publicationId: string): ReaderProgressState {
  return freezeState(publicationId, new Map());
}

function continuityAliasMap(
  sections: readonly ReaderProgressSection[] | undefined,
): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  const orderedSections = [...(sections ?? [])].sort((left, right) =>
    compareText(left.continuity.id, right.continuity.id),
  );
  for (const section of orderedSections) {
    const identity = createReaderSectionProgressIdentity(section);
    for (const group of identity.groups) {
      const canonicalId = group.includes(identity.continuityId)
        ? identity.continuityId
        : group[0];
      if (canonicalId === undefined) {
        continue;
      }
      for (const alias of group) {
        const existing = aliases.get(alias);
        if (
          existing === undefined ||
          compareText(canonicalId, existing) < 0
        ) {
          aliases.set(alias, canonicalId);
        }
      }
    }
  }
  return aliases;
}

function sanitizeStateRecord(
  value: unknown,
  context: ReaderProgressContext,
): ReaderProgressState {
  const record = readPlainDataRecord(value);
  if (
    record === undefined ||
    record.schemaVersion !== READER_PROGRESS_SCHEMA_VERSION ||
    record.publicationId !== context.publicationId
  ) {
    return emptyState(context.publicationId);
  }
  const rawEntries = readPlainDataRecord(record.entries);
  if (rawEntries === undefined) {
    return emptyState(context.publicationId);
  }

  const aliases = continuityAliasMap(context.sections);
  const entries = new Map<string, ReaderSectionProgress>();
  const keys = Object.keys(rawEntries)
    .filter((key) => isStableId(key, 256))
    .sort(compareText)
    .slice(0, MAXIMUM_READER_PROGRESS_INPUT_ENTRIES);
  for (const key of keys) {
    const entry = sanitizeEntry(rawEntries[key], context.now, key);
    if (entry === undefined) {
      continue;
    }
    const canonicalKey = aliases.get(key) ?? key;
    const existing = entries.get(canonicalKey);
    entries.set(
      canonicalKey,
      existing === undefined ? entry : mergeEntries(existing, entry),
    );
  }
  return freezeState(context.publicationId, entries);
}

function canonicalEntry(entry: ReaderSectionProgress): object {
  return {
    continuityIds: entry.continuityIds,
    contentHash: entry.contentHash,
    percent: entry.percent,
    scrollPercent: entry.scrollPercent,
    readingTimeMs: entry.readingTimeMs,
    audioPositionMs: entry.audioPositionMs,
    firstOpenedAt: entry.firstOpenedAt,
    lastOpenedAt: entry.lastOpenedAt,
    openCount: entry.openCount,
    navigationSource: entry.navigationSource,
    firstReadAt: entry.firstReadAt,
    lastReadAt: entry.lastReadAt,
    readCount: entry.readCount,
    readMethod: entry.readMethod,
    readContentHash: entry.readContentHash,
    readContentHashes: entry.readContentHashes,
    updatedAt: entry.updatedAt,
  };
}

function stateToSerializable(state: ReaderProgressState): object {
  const entries = Object.create(null) as Record<string, object>;
  for (const key of Object.keys(state.entries).sort(compareText)) {
    const entry = state.entries[key];
    if (entry !== undefined) {
      Object.defineProperty(entries, key, {
        enumerable: true,
        value: canonicalEntry(entry),
      });
    }
  }
  return {
    schemaVersion: state.schemaVersion,
    publicationId: state.publicationId,
    entries,
  };
}

export function createReaderProgressStorageKey(publicationId: string): string {
  requirePublicationId(publicationId);
  return `${READER_PROGRESS_STORAGE_PREFIX}.v${READER_PROGRESS_SCHEMA_VERSION}.${publicationId}`;
}

export function createEmptyReaderProgressState(
  publicationId: string,
): ReaderProgressState {
  requirePublicationId(publicationId);
  return emptyState(publicationId);
}

export function createReaderSectionProgressIdentity(
  section: ReaderProgressSection,
): ReaderSectionProgressIdentity {
  const continuityId = section.continuity.id;
  const groups = section.continuity.progressGroups
    .map((group) =>
      [...new Set(group)]
        .filter((value) => isStableId(value, 256))
        .sort(compareText),
    )
    .filter((group) => group.length > 0);
  if (!groups.some((group) => group.includes(continuityId))) {
    groups.unshift([continuityId]);
  }
  const aliases = [...new Set(groups.flat())].sort(compareText);
  return Object.freeze({
    continuityId,
    groups: Object.freeze(
      groups.map((group) => Object.freeze([...group])),
    ),
    aliases: Object.freeze(aliases),
  });
}

export function sanitizeReaderProgressState(
  value: unknown,
  context: ReaderProgressContext,
): ReaderProgressState {
  requirePublicationId(context.publicationId);
  requireNow(context.now);
  return sanitizeStateRecord(value, context);
}

export function parseReaderProgressState(
  serialized: string | null | undefined,
  context: ReaderProgressContext,
): ReaderProgressState {
  requirePublicationId(context.publicationId);
  requireNow(context.now);
  if (
    typeof serialized !== "string" ||
    utf8ByteLength(serialized) > MAXIMUM_READER_PROGRESS_SERIALIZED_BYTES
  ) {
    return emptyState(context.publicationId);
  }
  try {
    return sanitizeStateRecord(JSON.parse(serialized), context);
  } catch {
    return emptyState(context.publicationId);
  }
}

export function serializeReaderProgressState(
  value: ReaderProgressState,
  context: ReaderProgressContext,
): string {
  const state = sanitizeReaderProgressState(value, context);
  const serialized = JSON.stringify(stateToSerializable(state));
  if (utf8ByteLength(serialized) > MAXIMUM_READER_PROGRESS_SERIALIZED_BYTES) {
    throw new RangeError("Reader progress exceeds its serialized byte limit.");
  }
  return serialized;
}

export function mergeReaderProgressStates(
  local: ReaderProgressState,
  remote: ReaderProgressState,
  context: ReaderProgressContext,
): ReaderProgressState {
  const left = sanitizeReaderProgressState(local, context);
  const right = sanitizeReaderProgressState(remote, context);
  const entries = new Map<string, ReaderSectionProgress>();
  for (const state of [left, right]) {
    for (const key of Object.keys(state.entries)) {
      const entry = state.entries[key];
      if (entry === undefined) {
        continue;
      }
      const existing = entries.get(key);
      entries.set(
        key,
        existing === undefined ? entry : mergeEntries(existing, entry),
      );
    }
  }
  return freezeState(context.publicationId, entries);
}

function maximumUpdatedAt(value: unknown): number {
  const stateRecord = readPlainDataRecord(value);
  const entriesRecord = readPlainDataRecord(stateRecord?.entries);
  if (entriesRecord === undefined) {
    return 0;
  }
  let maximum = 0;
  for (const key of Object.keys(entriesRecord)) {
    const entry = readPlainDataRecord(entriesRecord[key]);
    if (
      entry !== undefined &&
      typeof entry.updatedAt === "number" &&
      Number.isSafeInteger(entry.updatedAt) &&
      entry.updatedAt >= 0
    ) {
      maximum = Math.max(maximum, entry.updatedAt);
    }
  }
  return maximum;
}

function entriesForProgressGroup(
  state: ReaderProgressState,
  group: readonly string[],
): readonly ReaderSectionProgress[] {
  const groupIds = new Set(group);
  const entries: ReaderSectionProgress[] = [];
  for (const [key, entry] of Object.entries(state.entries)) {
    if (
      groupIds.has(key) ||
      entry.continuityIds.some((id) => groupIds.has(id))
    ) {
      entries.push(entry);
    }
  }
  return entries;
}

function mergeProgressEntries(
  entries: readonly ReaderSectionProgress[],
): ReaderSectionProgress | undefined {
  let merged: ReaderSectionProgress | undefined;
  for (const entry of entries) {
    merged = merged === undefined ? entry : mergeEntries(merged, entry);
  }
  return merged;
}

export function recordReaderSectionProgress(
  state: ReaderProgressState,
  section: ReaderProgressSection,
  event: ReaderProgressEvent,
): ReaderProgressState {
  requirePublicationId(state.publicationId);
  requireNow(event.now);
  const latestStateTime = maximumUpdatedAt(state);
  if (event.now < latestStateTime) {
    throw new RangeError(
      "Reader progress events must not precede the latest state update.",
    );
  }
  const cleanState = sanitizeReaderProgressState(state, {
    publicationId: state.publicationId,
    now: event.now,
    sections: [section],
  });
  const identity = createReaderSectionProgressIdentity(section);
  const current = resolveReaderSectionProgress(cleanState, section).progress ??
    undefined;

  const baseline =
    current ??
    frozenEntry({
      continuityIds: identity.aliases,
      contentHash: section.contentHash,
      percent: 0,
      scrollPercent: 0,
      readingTimeMs: 0,
      audioPositionMs: 0,
      firstOpenedAt: null,
      lastOpenedAt: null,
      openCount: 0,
      navigationSource: null,
      firstReadAt: null,
      lastReadAt: null,
      readCount: 0,
      readMethod: null,
      readContentHash: null,
      readContentHashes: [],
      updatedAt: 0,
    });
  const navigationSource = validNavigationSource(event.navigationSource);
  const opened = event.opened === true || navigationSource !== null;
  const percent = Math.max(
    baseline.percent,
    boundedPercent(event.percent, baseline.percent),
  );
  const explicitRead =
    event.read === "automatic" || event.read === "manual"
      ? event.read
      : null;
  const inferredRead =
    explicitRead === null &&
    typeof event.percent === "number" &&
    boundedPercent(event.percent) >= 100 &&
    !baseline.readContentHashes.includes(section.contentHash)
      ? "automatic"
      : null;
  const readMethod = explicitRead ?? inferredRead;
  const readNow = readMethod !== null;

  const nextEntry = frozenEntry({
    continuityIds: identity.aliases,
    contentHash: section.contentHash,
    percent: readNow ? 100 : percent,
    scrollPercent: Math.max(
      baseline.scrollPercent,
      boundedPercent(event.scrollPercent, baseline.scrollPercent),
    ),
    readingTimeMs: Math.max(
      baseline.readingTimeMs,
      boundedInteger(
        event.readingTimeMs,
        MAXIMUM_DURATION_MS,
        baseline.readingTimeMs,
      ),
    ),
    audioPositionMs: Math.max(
      baseline.audioPositionMs,
      boundedInteger(
        event.audioPositionMs,
        MAXIMUM_DURATION_MS,
        baseline.audioPositionMs,
      ),
    ),
    firstOpenedAt: opened
      ? baseline.firstOpenedAt ?? event.now
      : baseline.firstOpenedAt,
    lastOpenedAt: opened ? event.now : baseline.lastOpenedAt,
    openCount: opened
      ? Math.min(MAXIMUM_COUNTER, baseline.openCount + 1)
      : baseline.openCount,
    navigationSource: opened
      ? navigationSource ?? baseline.navigationSource
      : baseline.navigationSource,
    firstReadAt: readNow
      ? baseline.firstReadAt ?? event.now
      : baseline.firstReadAt,
    lastReadAt: readNow ? event.now : baseline.lastReadAt,
    readCount: readNow
      ? Math.min(MAXIMUM_COUNTER, baseline.readCount + 1)
      : baseline.readCount,
    readMethod: readNow ? readMethod : baseline.readMethod,
    readContentHash: readNow
      ? section.contentHash
      : baseline.readContentHash,
    readContentHashes: readNow
      ? [...new Set([
          ...baseline.readContentHashes,
          section.contentHash,
        ])]
          .sort(compareText)
          .slice(0, MAXIMUM_READER_PROGRESS_READ_HASHES)
      : baseline.readContentHashes,
    updatedAt: event.now,
  });

  const entries = new Map<string, ReaderSectionProgress>();
  const aliasSet = new Set(identity.aliases);
  for (const key of Object.keys(cleanState.entries)) {
    const entry = cleanState.entries[key];
    if (!aliasSet.has(key) && entry !== undefined) {
      entries.set(key, entry);
    }
  }
  entries.set(identity.continuityId, nextEntry);
  return freezeState(state.publicationId, entries);
}

export function resolveReaderSectionProgress(
  state: ReaderProgressState,
  section: ReaderProgressSection,
): ResolvedReaderSectionProgress {
  const identity = createReaderSectionProgressIdentity(section);
  const groupedEntries = identity.groups.map((group) =>
    entriesForProgressGroup(state, group),
  );
  const uniqueEntries = [...new Set(groupedEntries.flat())];
  const merged = mergeProgressEntries(uniqueEntries);
  const groupPercents = groupedEntries.map((entries) =>
    entries.reduce((maximum, entry) => Math.max(maximum, entry.percent), 0),
  );
  const progress = merged === undefined
    ? undefined
    : frozenEntry({
        ...merged,
        percent: groupPercents.length === 0
          ? merged.percent
          : Math.min(...groupPercents),
      });
  if (progress === undefined) {
    return Object.freeze({
      identity,
      progress: null,
      revisionDetected: false,
      status: "unread",
    });
  }

  const everyGroupReadCurrentRevision = groupedEntries.every((entries) =>
    entries.some((entry) =>
      entry.readContentHashes.includes(section.contentHash),
    ),
  );
  const hasReadEvidence = uniqueEntries.some(
    (entry) => entry.readContentHashes.length > 0,
  );
  const revisionDetected =
    progress.contentHash !== section.contentHash ||
    (hasReadEvidence && !everyGroupReadCurrentRevision);
  let status: ReaderSectionProgressStatus;
  if (hasReadEvidence && !everyGroupReadCurrentRevision) {
    status = "updated";
  } else if (
    everyGroupReadCurrentRevision ||
    (progress.percent >= 100 && progress.contentHash === section.contentHash)
  ) {
    status = "read";
  } else if (
    progress.percent > 0 ||
    progress.scrollPercent > 0 ||
    progress.readingTimeMs > 0 ||
    progress.audioPositionMs > 0 ||
    progress.openCount > 0
  ) {
    status = "partial";
  } else {
    status = "unread";
  }

  return Object.freeze({
    identity,
    progress,
    revisionDetected,
    status,
  });
}

export function calculateReaderAggregateProgress(
  state: ReaderProgressState,
  sections: readonly ReaderProgressSection[],
): ReaderAggregateProgress {
  let totalWordCount = 0;
  let completedWords = 0;
  const statuses: Record<ReaderSectionProgressStatus, number> = {
    unread: 0,
    partial: 0,
    read: 0,
    updated: 0,
  };
  const seen = new Set<string>();
  for (const section of sections) {
    const identity = createReaderSectionProgressIdentity(section);
    if (seen.has(identity.continuityId)) {
      continue;
    }
    seen.add(identity.continuityId);
    const resolved = resolveReaderSectionProgress(state, section);
    statuses[resolved.status] += 1;
    const wordCount =
      Number.isSafeInteger(section.wordCount) && section.wordCount > 0
        ? section.wordCount
        : 0;
    const percent = resolved.progress?.percent ?? 0;
    totalWordCount += wordCount;
    completedWords += wordCount * (percent / 100);
  }
  const completedWordCount = Math.round(completedWords);
  const percent =
    totalWordCount === 0
      ? 0
      : Math.round((completedWords / totalWordCount) * 100);
  return Object.freeze({
    percent,
    completedWordCount,
    totalWordCount,
    sectionCount: seen.size,
    statuses: Object.freeze(statuses),
  });
}
