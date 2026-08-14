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

import type { ReaderBlock } from "@genii-foundation/publisher-schema/reader";

import {
  resolveReaderPassageRange,
  validateReaderPassageRange,
  type ReaderPassageRange,
} from "./passage-range.js";

export const READER_BOOKMARKS_SCHEMA_VERSION = 1 as const;
export const READER_BOOKMARKS_STORAGE_PREFIX =
  "genii.publisher.reader.bookmarks";
export const MAXIMUM_LIVE_READER_BOOKMARKS = 1_000;
export const MAXIMUM_TOTAL_READER_BOOKMARKS = 2_000;
export const MAXIMUM_READER_BOOKMARK_INPUT_ENTRIES = 4_000;
export const MAXIMUM_READER_BOOKMARK_QUOTE_CODE_UNITS = 2_000;
export const MAXIMUM_READER_BOOKMARK_NOTE_CODE_UNITS = 280;
export const MAXIMUM_READER_BOOKMARK_CONTEXT_CODE_UNITS = 80;
export const MAXIMUM_READER_BOOKMARKS_INPUT_BYTES = 2_097_152;
export const MAXIMUM_READER_BOOKMARKS_SERIALIZED_BYTES = 1_048_576;
export const MAXIMUM_READER_BOOKMARKS_REMOTE_BYTES = 262_144;

const MAXIMUM_HREF_CODE_UNITS = 2_048;
const MAXIMUM_REANCHOR_TEXT_CODE_UNITS = 1_000_000;
const MAXIMUM_REANCHOR_CANDIDATES = 64;
const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface ReaderBookmark {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt?: number;
  readonly workId: string;
  readonly sectionContinuityId: string;
  readonly href: string;
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly range: ReaderPassageRange;
  readonly note?: string;
}

export interface ReaderBookmarksState {
  readonly schemaVersion: typeof READER_BOOKMARKS_SCHEMA_VERSION;
  readonly publicationId: string;
  readonly bookmarks: Readonly<Record<string, ReaderBookmark>>;
}

export interface ReaderBookmarksContext {
  readonly publicationId: string;
  /** Nonnegative epoch milliseconds supplied by the caller. */
  readonly now: number;
}

export interface ReaderBookmarkInput {
  readonly id: string;
  readonly workId: string;
  readonly sectionContinuityId: string;
  readonly href: string;
  readonly quote: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly range: ReaderPassageRange;
  readonly note?: string;
}

export interface ReaderBookmarkQuery {
  readonly workId?: string;
  readonly sectionContinuityId?: string;
  readonly text?: string;
}

export interface ReaderBookmarkCounts {
  readonly live: number;
  readonly tombstones: number;
  readonly total: number;
}

export type ReaderBookmarkResolution =
  | {
      readonly status: "exact" | "renamed" | "reanchored";
      readonly range: ReaderPassageRange;
    }
  | { readonly status: "ambiguous" | "missing" | "invalid" };

const INVALID_BOOKMARK_RESOLUTION = Object.freeze({
  status: "invalid",
} as const);
const MISSING_BOOKMARK_RESOLUTION = Object.freeze({
  status: "missing",
} as const);
const AMBIGUOUS_BOOKMARK_RESOLUTION = Object.freeze({
  status: "ambiguous",
} as const);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readAllowedRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some(
        (key) =>
          typeof key !== "string" ||
          !allowed.has(key),
      ) ||
      requiredKeys.some((key) => !ownKeys.includes(key))
    ) {
      return undefined;
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of ownKeys) {
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

function readDictionary(
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
    const dictionary = Object.create(null) as Record<string, unknown>;
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
      Object.defineProperty(dictionary, key, {
        enumerable: true,
        value: descriptor.value,
      });
    }
    return dictionary;
  } catch {
    return undefined;
  }
}

function isStableId(value: unknown, maximumLength = 256): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    !DANGEROUS_KEYS.has(value) &&
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

function validateContext(context: ReaderBookmarksContext): void {
  requirePublicationId(context.publicationId);
  requireNow(context.now);
}

function isScalarString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isBoundedScalarString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    isScalarString(value) &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function isSafeHref(value: unknown): value is string {
  return (
    isBoundedScalarString(value, 1, MAXIMUM_HREF_CODE_UNITS) &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
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

function clampTimestamp(value: unknown, now: number): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return undefined;
  }
  return Math.min(value, now);
}

function freezeBookmark(value: {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt?: number;
  readonly workId: string;
  readonly sectionContinuityId: string;
  readonly href: string;
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly range: ReaderPassageRange;
  readonly note?: string;
}): ReaderBookmark {
  const bookmark: {
    id: string;
    createdAt: number;
    updatedAt: number;
    deletedAt?: number;
    workId: string;
    sectionContinuityId: string;
    href: string;
    quote: string;
    prefix: string;
    suffix: string;
    range: ReaderPassageRange;
    note?: string;
  } = {
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    workId: value.workId,
    sectionContinuityId: value.sectionContinuityId,
    href: value.href,
    quote: value.quote,
    prefix: value.prefix,
    suffix: value.suffix,
    range: value.range,
  };
  if (value.note !== undefined) {
    bookmark.note = value.note;
  }
  if (value.deletedAt !== undefined) {
    bookmark.deletedAt = value.deletedAt;
  }
  return Object.freeze(bookmark);
}

const BOOKMARK_REQUIRED_KEYS = Object.freeze([
  "id",
  "createdAt",
  "updatedAt",
  "workId",
  "sectionContinuityId",
  "href",
  "quote",
  "prefix",
  "suffix",
  "range",
] as const);
const BOOKMARK_OPTIONAL_KEYS = Object.freeze(["deletedAt", "note"] as const);

function sanitizeBookmark(
  value: unknown,
  now: number,
  expectedId?: string,
): ReaderBookmark | undefined {
  const record = readAllowedRecord(
    value,
    BOOKMARK_REQUIRED_KEYS,
    BOOKMARK_OPTIONAL_KEYS,
  );
  if (
    record === undefined ||
    (Object.hasOwn(record, "note") && record.note === undefined) ||
    (Object.hasOwn(record, "deletedAt") &&
      record.deletedAt === undefined) ||
    !isStableId(record.id, 128) ||
    (expectedId !== undefined && record.id !== expectedId) ||
    !isStableId(record.workId, 128) ||
    !isStableId(record.sectionContinuityId) ||
    !isSafeHref(record.href) ||
    !isBoundedScalarString(
      record.quote,
      1,
      MAXIMUM_READER_BOOKMARK_QUOTE_CODE_UNITS,
    ) ||
    !isBoundedScalarString(
      record.prefix,
      0,
      MAXIMUM_READER_BOOKMARK_CONTEXT_CODE_UNITS,
    ) ||
    !isBoundedScalarString(
      record.suffix,
      0,
      MAXIMUM_READER_BOOKMARK_CONTEXT_CODE_UNITS,
    )
  ) {
    return undefined;
  }
  const note =
    record.note === undefined
      ? undefined
      : isBoundedScalarString(
            record.note,
            1,
            MAXIMUM_READER_BOOKMARK_NOTE_CODE_UNITS,
          )
        ? record.note
        : undefined;
  if (record.note !== undefined && note === undefined) {
    return undefined;
  }
  const range = validateReaderPassageRange(record.range);
  if (
    !range.valid ||
    range.value.start.workId !== record.workId ||
    range.value.start.sectionContinuityId !==
      record.sectionContinuityId
  ) {
    return undefined;
  }
  const createdAt = clampTimestamp(record.createdAt, now);
  const storedUpdatedAt = clampTimestamp(record.updatedAt, now);
  if (createdAt === undefined || storedUpdatedAt === undefined) {
    return undefined;
  }
  const deletedAt =
    record.deletedAt === undefined
      ? undefined
      : clampTimestamp(record.deletedAt, now);
  if (record.deletedAt !== undefined && deletedAt === undefined) {
    return undefined;
  }
  const updatedAt = Math.max(storedUpdatedAt, deletedAt ?? 0);
  return freezeBookmark({
    id: record.id,
    createdAt: Math.min(createdAt, updatedAt),
    updatedAt,
    ...(deletedAt === undefined ? {} : { deletedAt }),
    workId: record.workId,
    sectionContinuityId: record.sectionContinuityId,
    href: record.href,
    quote: record.quote,
    prefix: record.prefix,
    suffix: record.suffix,
    range: range.value,
    ...(note === undefined ? {} : { note }),
  });
}

function canonicalBookmarkObject(bookmark: ReaderBookmark): object {
  return {
    id: bookmark.id,
    createdAt: bookmark.createdAt,
    updatedAt: bookmark.updatedAt,
    ...(bookmark.deletedAt === undefined
      ? {}
      : { deletedAt: bookmark.deletedAt }),
    workId: bookmark.workId,
    sectionContinuityId: bookmark.sectionContinuityId,
    href: bookmark.href,
    quote: bookmark.quote,
    prefix: bookmark.prefix,
    suffix: bookmark.suffix,
    range: {
      start: {
        workId: bookmark.range.start.workId,
        sectionContinuityId:
          bookmark.range.start.sectionContinuityId,
        blockId: bookmark.range.start.blockId,
        blockContentHash: bookmark.range.start.blockContentHash,
        offset: bookmark.range.start.offset,
      },
      end: {
        workId: bookmark.range.end.workId,
        sectionContinuityId: bookmark.range.end.sectionContinuityId,
        blockId: bookmark.range.end.blockId,
        blockContentHash: bookmark.range.end.blockContentHash,
        offset: bookmark.range.end.offset,
      },
    },
    ...(bookmark.note === undefined ? {} : { note: bookmark.note }),
  };
}

function canonicalBookmarkText(bookmark: ReaderBookmark): string {
  return JSON.stringify(canonicalBookmarkObject(bookmark));
}

function prioritizeBookmarks(
  bookmarks: readonly ReaderBookmark[],
): readonly ReaderBookmark[] {
  const tombstones = bookmarks
    .filter((bookmark) => bookmark.deletedAt !== undefined)
    .sort((left, right) => {
      const deletedDifference =
        (right.deletedAt ?? 0) - (left.deletedAt ?? 0);
      if (deletedDifference !== 0) {
        return deletedDifference;
      }
      const updatedDifference = right.updatedAt - left.updatedAt;
      return updatedDifference === 0
        ? compareText(left.id, right.id)
        : updatedDifference;
    });
  const live = bookmarks
    .filter((bookmark) => bookmark.deletedAt === undefined)
    .sort((left, right) => {
      const updatedDifference = right.updatedAt - left.updatedAt;
      if (updatedDifference !== 0) {
        return updatedDifference;
      }
      const createdDifference = right.createdAt - left.createdAt;
      return createdDifference === 0
        ? compareText(left.id, right.id)
        : createdDifference;
    })
    .slice(0, MAXIMUM_LIVE_READER_BOOKMARKS);
  return Object.freeze(
    [...tombstones, ...live].slice(0, MAXIMUM_TOTAL_READER_BOOKMARKS),
  );
}

function freezeState(
  publicationId: string,
  bookmarks: readonly ReaderBookmark[],
): ReaderBookmarksState {
  const record = Object.create(null) as Record<string, ReaderBookmark>;
  for (const bookmark of [...bookmarks].sort((left, right) =>
    compareText(left.id, right.id)
  )) {
    Object.defineProperty(record, bookmark.id, {
      enumerable: true,
      value: bookmark,
    });
  }
  Object.freeze(record);
  return Object.freeze({
    schemaVersion: READER_BOOKMARKS_SCHEMA_VERSION,
    publicationId,
    bookmarks: record,
  });
}

function serializeCanonical(state: ReaderBookmarksState): string {
  const bookmarks: Record<string, object> = Object.create(null) as Record<
    string,
    object
  >;
  for (const id of Object.keys(state.bookmarks).sort(compareText)) {
    const bookmark = state.bookmarks[id];
    if (bookmark !== undefined) {
      Object.defineProperty(bookmarks, id, {
        enumerable: true,
        value: canonicalBookmarkObject(bookmark),
      });
    }
  }
  return JSON.stringify({
    schemaVersion: READER_BOOKMARKS_SCHEMA_VERSION,
    publicationId: state.publicationId,
    bookmarks,
  });
}

function stateWithinBudget(
  publicationId: string,
  prioritized: readonly ReaderBookmark[],
  maximumBytes: number,
): ReaderBookmarksState {
  let low = 0;
  let high = prioritized.length;
  let accepted = freezeState(publicationId, []);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = freezeState(
      publicationId,
      prioritized.slice(0, middle),
    );
    if (utf8ByteLength(serializeCanonical(candidate)) <= maximumBytes) {
      accepted = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return accepted;
}

function boundedState(
  publicationId: string,
  bookmarks: readonly ReaderBookmark[],
  maximumBytes = MAXIMUM_READER_BOOKMARKS_SERIALIZED_BYTES,
): ReaderBookmarksState {
  return stateWithinBudget(
    publicationId,
    prioritizeBookmarks(bookmarks),
    maximumBytes,
  );
}

export function createReaderBookmarksStorageKey(
  publicationId: string,
): string {
  requirePublicationId(publicationId);
  return `${READER_BOOKMARKS_STORAGE_PREFIX}.v${READER_BOOKMARKS_SCHEMA_VERSION}.${publicationId}`;
}

export function createEmptyReaderBookmarksState(
  publicationId: string,
): ReaderBookmarksState {
  requirePublicationId(publicationId);
  return freezeState(publicationId, []);
}

export function sanitizeReaderBookmarksState(
  value: unknown,
  context: ReaderBookmarksContext,
): ReaderBookmarksState {
  validateContext(context);
  const state = readAllowedRecord(value, [
    "schemaVersion",
    "publicationId",
    "bookmarks",
  ]);
  if (
    state === undefined ||
    state.schemaVersion !== READER_BOOKMARKS_SCHEMA_VERSION ||
    state.publicationId !== context.publicationId
  ) {
    return createEmptyReaderBookmarksState(context.publicationId);
  }
  const dictionary = readDictionary(state.bookmarks);
  if (dictionary === undefined) {
    return createEmptyReaderBookmarksState(context.publicationId);
  }
  const ids = Object.keys(dictionary).sort(compareText);
  if (ids.length > MAXIMUM_READER_BOOKMARK_INPUT_ENTRIES) {
    return createEmptyReaderBookmarksState(context.publicationId);
  }
  const bookmarks: ReaderBookmark[] = [];
  for (const id of ids) {
    if (!isStableId(id, 128)) {
      continue;
    }
    const bookmark = sanitizeBookmark(dictionary[id], context.now, id);
    if (bookmark !== undefined) {
      bookmarks.push(bookmark);
    }
  }
  return boundedState(context.publicationId, bookmarks);
}

export function parseReaderBookmarksState(
  serialized: string | null | undefined,
  context: ReaderBookmarksContext,
): ReaderBookmarksState {
  validateContext(context);
  if (
    typeof serialized !== "string" ||
    utf8ByteLength(serialized) > MAXIMUM_READER_BOOKMARKS_INPUT_BYTES
  ) {
    return createEmptyReaderBookmarksState(context.publicationId);
  }
  try {
    return sanitizeReaderBookmarksState(JSON.parse(serialized), context);
  } catch {
    return createEmptyReaderBookmarksState(context.publicationId);
  }
}

export function serializeReaderBookmarksState(
  state: ReaderBookmarksState,
  context: ReaderBookmarksContext,
): string {
  const sanitized = sanitizeReaderBookmarksState(state, context);
  return serializeCanonical(sanitized);
}

export function readerBookmarksByteSize(
  state: ReaderBookmarksState,
  context: ReaderBookmarksContext,
): number {
  return utf8ByteLength(serializeReaderBookmarksState(state, context));
}

export function pruneReaderBookmarksState(
  state: ReaderBookmarksState,
  context: ReaderBookmarksContext,
  maximumBytes = MAXIMUM_READER_BOOKMARKS_SERIALIZED_BYTES,
): ReaderBookmarksState {
  validateContext(context);
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 128 ||
    maximumBytes > MAXIMUM_READER_BOOKMARKS_SERIALIZED_BYTES
  ) {
    throw new RangeError("The bookmark byte budget is outside its safe range.");
  }
  const sanitized = sanitizeReaderBookmarksState(state, context);
  return boundedState(
    context.publicationId,
    Object.values(sanitized.bookmarks),
    maximumBytes,
  );
}

export function readerBookmarksFitRemoteBudget(
  state: ReaderBookmarksState,
  context: ReaderBookmarksContext,
): boolean {
  return (
    readerBookmarksByteSize(state, context) <=
    MAXIMUM_READER_BOOKMARKS_REMOTE_BYTES
  );
}

export function pruneReaderBookmarksToRemoteBudget(
  state: ReaderBookmarksState,
  context: ReaderBookmarksContext,
): ReaderBookmarksState {
  return pruneReaderBookmarksState(
    state,
    context,
    MAXIMUM_READER_BOOKMARKS_REMOTE_BYTES,
  );
}

function sanitizeBookmarkInput(
  value: unknown,
  now: number,
): ReaderBookmark | undefined {
  const record = readAllowedRecord(
    value,
    [
      "id",
      "workId",
      "sectionContinuityId",
      "href",
      "quote",
      "range",
    ],
    ["prefix", "suffix", "note"],
  );
  if (record === undefined) {
    return undefined;
  }
  for (const key of ["prefix", "suffix", "note"]) {
    if (Object.hasOwn(record, key) && record[key] === undefined) {
      return undefined;
    }
  }
  return sanitizeBookmark(
    {
      id: record.id,
      createdAt: now,
      updatedAt: now,
      workId: record.workId,
      sectionContinuityId: record.sectionContinuityId,
      href: record.href,
      quote: record.quote,
      prefix: record.prefix ?? "",
      suffix: record.suffix ?? "",
      range: record.range,
      ...(record.note === undefined ? {} : { note: record.note }),
    },
    now,
  );
}

function assertStateCanRetain(
  beforeCount: number,
  next: ReaderBookmarksState,
  id: string,
): void {
  if (
    Object.keys(next.bookmarks).length <= beforeCount ||
    !Object.hasOwn(next.bookmarks, id)
  ) {
    throw new RangeError(
      "The bookmark cannot fit within the bounded bookmark state.",
    );
  }
}

export function addReaderBookmark(
  state: ReaderBookmarksState,
  input: ReaderBookmarkInput,
  context: ReaderBookmarksContext,
): ReaderBookmarksState {
  validateContext(context);
  const current = sanitizeReaderBookmarksState(state, context);
  const bookmark = sanitizeBookmarkInput(input, context.now);
  if (bookmark === undefined) {
    throw new TypeError("The bookmark input is invalid.");
  }
  if (Object.hasOwn(current.bookmarks, bookmark.id)) {
    throw new RangeError(
      "A live bookmark or tombstone already owns this bookmark ID.",
    );
  }
  if (countReaderBookmarks(current).live >= MAXIMUM_LIVE_READER_BOOKMARKS) {
    throw new RangeError("The live bookmark limit has been reached.");
  }
  const next = boundedState(context.publicationId, [
    ...Object.values(current.bookmarks),
    bookmark,
  ]);
  assertStateCanRetain(
    Object.keys(current.bookmarks).length,
    next,
    bookmark.id,
  );
  return next;
}

export function updateReaderBookmarkNote(
  state: ReaderBookmarksState,
  id: string,
  note: string | null,
  context: ReaderBookmarksContext,
): ReaderBookmarksState {
  validateContext(context);
  if (!isStableId(id, 128)) {
    throw new TypeError("The bookmark ID is invalid.");
  }
  if (
    note !== null &&
    !isBoundedScalarString(
      note,
      1,
      MAXIMUM_READER_BOOKMARK_NOTE_CODE_UNITS,
    )
  ) {
    throw new TypeError("The bookmark note is invalid.");
  }
  const current = sanitizeReaderBookmarksState(state, context);
  const bookmark = current.bookmarks[id];
  if (bookmark === undefined || bookmark.deletedAt !== undefined) {
    throw new RangeError("Only a live bookmark can receive a note.");
  }
  const updatedAt = Math.max(bookmark.updatedAt, context.now);
  const updated =
    note === null
      ? freezeBookmark({
          id: bookmark.id,
          createdAt: bookmark.createdAt,
          updatedAt,
          workId: bookmark.workId,
          sectionContinuityId: bookmark.sectionContinuityId,
          href: bookmark.href,
          quote: bookmark.quote,
          prefix: bookmark.prefix,
          suffix: bookmark.suffix,
          range: bookmark.range,
        })
      : freezeBookmark({ ...bookmark, updatedAt, note });
  return boundedState(
    context.publicationId,
    Object.values(current.bookmarks).map((candidate) =>
      candidate.id === id ? updated : candidate
    ),
  );
}

export function removeReaderBookmark(
  state: ReaderBookmarksState,
  id: string,
  context: ReaderBookmarksContext,
): ReaderBookmarksState {
  validateContext(context);
  if (!isStableId(id, 128)) {
    throw new TypeError("The bookmark ID is invalid.");
  }
  const current = sanitizeReaderBookmarksState(state, context);
  const bookmark = current.bookmarks[id];
  if (bookmark === undefined || bookmark.deletedAt !== undefined) {
    return current;
  }
  const deletionTime = Math.max(bookmark.updatedAt, context.now);
  const tombstone = freezeBookmark({
    ...bookmark,
    updatedAt: deletionTime,
    deletedAt: deletionTime,
  });
  return boundedState(
    context.publicationId,
    Object.values(current.bookmarks).map((candidate) =>
      candidate.id === id ? tombstone : candidate
    ),
  );
}

export function listLiveReaderBookmarks(
  state: ReaderBookmarksState,
): readonly ReaderBookmark[] {
  return Object.freeze(
    Object.values(state.bookmarks)
      .filter((bookmark) => bookmark.deletedAt === undefined)
      .sort((left, right) => {
        const difference = right.updatedAt - left.updatedAt;
        return difference === 0
          ? compareText(left.id, right.id)
          : difference;
      }),
  );
}

export function countReaderBookmarks(
  state: ReaderBookmarksState,
): ReaderBookmarkCounts {
  let live = 0;
  let tombstones = 0;
  for (const bookmark of Object.values(state.bookmarks)) {
    if (bookmark.deletedAt === undefined) {
      live += 1;
    } else {
      tombstones += 1;
    }
  }
  return Object.freeze({
    live,
    tombstones,
    total: live + tombstones,
  });
}

export function queryReaderBookmarks(
  state: ReaderBookmarksState,
  query: ReaderBookmarkQuery = {},
): readonly ReaderBookmark[] {
  const record = readAllowedRecord(
    query,
    [],
    ["workId", "sectionContinuityId", "text"],
  );
  if (record === undefined) {
    throw new TypeError("The bookmark query is invalid.");
  }
  if (record.workId !== undefined && !isStableId(record.workId, 128)) {
    throw new TypeError("The bookmark query work ID is invalid.");
  }
  if (
    record.sectionContinuityId !== undefined &&
    !isStableId(record.sectionContinuityId)
  ) {
    throw new TypeError("The bookmark query section identity is invalid.");
  }
  if (
    record.text !== undefined &&
    !isBoundedScalarString(record.text, 1, 280)
  ) {
    throw new TypeError("The bookmark query text is invalid.");
  }
  const needle =
    typeof record.text === "string" ? record.text.toLowerCase() : null;
  return Object.freeze(
    listLiveReaderBookmarks(state).filter((bookmark) => {
      if (
        typeof record.workId === "string" &&
        bookmark.workId !== record.workId
      ) {
        return false;
      }
      if (
        typeof record.sectionContinuityId === "string" &&
        bookmark.sectionContinuityId !== record.sectionContinuityId
      ) {
        return false;
      }
      if (needle === null) {
        return true;
      }
      return [
        bookmark.quote,
        bookmark.note ?? "",
        bookmark.prefix,
        bookmark.suffix,
      ].some((field) => field.toLowerCase().includes(needle));
    }),
  );
}

function chooseLiveBookmark(
  left: ReaderBookmark,
  right: ReaderBookmark,
): ReaderBookmark {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? left : right;
  }
  return compareText(
    canonicalBookmarkText(left),
    canonicalBookmarkText(right),
  ) <= 0
    ? left
    : right;
}

function chooseTombstone(
  left: ReaderBookmark,
  right: ReaderBookmark,
): ReaderBookmark {
  if (left.deletedAt === undefined) {
    return right;
  }
  if (right.deletedAt === undefined) {
    return left;
  }
  if (left.deletedAt !== right.deletedAt) {
    return left.deletedAt > right.deletedAt ? left : right;
  }
  return chooseLiveBookmark(left, right);
}

export function mergeReaderBookmarksStates(
  left: ReaderBookmarksState,
  right: ReaderBookmarksState,
  context: ReaderBookmarksContext,
): ReaderBookmarksState {
  const first = sanitizeReaderBookmarksState(left, context);
  const second = sanitizeReaderBookmarksState(right, context);
  const ids = new Set([
    ...Object.keys(first.bookmarks),
    ...Object.keys(second.bookmarks),
  ]);
  const merged: ReaderBookmark[] = [];
  for (const id of [...ids].sort(compareText)) {
    const leftBookmark = first.bookmarks[id];
    const rightBookmark = second.bookmarks[id];
    if (leftBookmark === undefined) {
      if (rightBookmark !== undefined) {
        merged.push(rightBookmark);
      }
      continue;
    }
    if (rightBookmark === undefined) {
      merged.push(leftBookmark);
      continue;
    }
    if (
      leftBookmark.deletedAt !== undefined ||
      rightBookmark.deletedAt !== undefined
    ) {
      merged.push(chooseTombstone(leftBookmark, rightBookmark));
    } else {
      merged.push(chooseLiveBookmark(leftBookmark, rightBookmark));
    }
  }
  return boundedState(context.publicationId, merged);
}

interface TextBoundary {
  readonly block: ReaderBlock;
  readonly start: number;
  readonly end: number;
}

function createSectionText(
  blocks: readonly ReaderBlock[],
):
  | {
      readonly text: string;
      readonly boundaries: readonly TextBoundary[];
    }
  | undefined {
  if (!Array.isArray(blocks)) {
    return undefined;
  }
  const seen = new Set<string>();
  const boundaries: TextBoundary[] = [];
  const texts: string[] = [];
  let cursor = 0;
  for (const block of blocks) {
    if (
      block === undefined ||
      !isStableId(block.id) ||
      seen.has(block.id) ||
      !isScalarString(block.text) ||
      !SHA256_DIGEST.test(block.contentHash)
    ) {
      return undefined;
    }
    seen.add(block.id);
    const start = cursor;
    const end = start + block.text.length;
    boundaries.push(Object.freeze({ block, start, end }));
    texts.push(block.text);
    cursor = end + 1;
    if (cursor > MAXIMUM_REANCHOR_TEXT_CODE_UNITS + 1) {
      return undefined;
    }
  }
  const text = texts.join("\n");
  if (text.length > MAXIMUM_REANCHOR_TEXT_CODE_UNITS) {
    return undefined;
  }
  return Object.freeze({
    text,
    boundaries: Object.freeze(boundaries),
  });
}

function pointAt(
  bookmark: ReaderBookmark,
  boundaries: readonly TextBoundary[],
  position: number,
  endPoint: boolean,
): ReaderPassageRange["start"] | undefined {
  let selected: TextBoundary | undefined;
  for (const boundary of boundaries) {
    if (
      endPoint
        ? position >= boundary.start && position <= boundary.end
        : position >= boundary.start && position < boundary.end
    ) {
      selected = boundary;
      if (!endPoint || position < boundary.end) {
        break;
      }
    }
  }
  if (selected === undefined) {
    return undefined;
  }
  return Object.freeze({
    workId: bookmark.workId,
    sectionContinuityId: bookmark.sectionContinuityId,
    blockId: selected.block.id,
    blockContentHash: selected.block.contentHash,
    offset: position - selected.start,
  });
}

function reanchorReaderBookmark(
  bookmark: ReaderBookmark,
  blocks: readonly ReaderBlock[],
): ReaderBookmarkResolution {
  const section = createSectionText(blocks);
  if (section === undefined) {
    return INVALID_BOOKMARK_RESOLUTION;
  }
  const candidates: number[] = [];
  let cursor = 0;
  while (cursor <= section.text.length - bookmark.quote.length) {
    const found = section.text.indexOf(bookmark.quote, cursor);
    if (found < 0) {
      break;
    }
    const before = section.text.slice(
      Math.max(0, found - bookmark.prefix.length),
      found,
    );
    const afterStart = found + bookmark.quote.length;
    const after = section.text.slice(
      afterStart,
      afterStart + bookmark.suffix.length,
    );
    if (
      before === bookmark.prefix &&
      after === bookmark.suffix
    ) {
      candidates.push(found);
      if (candidates.length > MAXIMUM_REANCHOR_CANDIDATES) {
        return AMBIGUOUS_BOOKMARK_RESOLUTION;
      }
    }
    cursor = found + 1;
  }
  if (candidates.length === 0) {
    return MISSING_BOOKMARK_RESOLUTION;
  }
  if (candidates.length > 1) {
    return AMBIGUOUS_BOOKMARK_RESOLUTION;
  }
  const startPosition = candidates[0];
  if (startPosition === undefined) {
    return MISSING_BOOKMARK_RESOLUTION;
  }
  const start = pointAt(
    bookmark,
    section.boundaries,
    startPosition,
    false,
  );
  const end = pointAt(
    bookmark,
    section.boundaries,
    startPosition + bookmark.quote.length,
    true,
  );
  if (start === undefined || end === undefined) {
    return MISSING_BOOKMARK_RESOLUTION;
  }
  const range = validateReaderPassageRange({ start, end });
  if (!range.valid) {
    return INVALID_BOOKMARK_RESOLUTION;
  }
  return Object.freeze({ status: "reanchored", range: range.value });
}

export function resolveReaderBookmark(
  value: unknown,
  blocks: readonly ReaderBlock[],
): ReaderBookmarkResolution {
  const bookmark = sanitizeBookmark(value, Number.MAX_SAFE_INTEGER);
  if (bookmark === undefined || bookmark.deletedAt !== undefined) {
    return INVALID_BOOKMARK_RESOLUTION;
  }
  const resolved = resolveReaderPassageRange(bookmark.range, blocks);
  if (resolved.status === "exact") {
    return Object.freeze({ status: "exact", range: resolved.range });
  }
  if (resolved.status === "renamed-block") {
    return Object.freeze({ status: "renamed", range: resolved.range });
  }
  if (resolved.status === "invalid") {
    return INVALID_BOOKMARK_RESOLUTION;
  }
  return reanchorReaderBookmark(bookmark, blocks);
}
