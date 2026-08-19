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

import type {
  PublicationReaderEnvelope,
  ReaderSection,
  Sha256Digest,
} from "@genii-foundation/publisher-schema/reader";
import type { ReaderProgressOverviewSection } from "./progress-overview.js";

export const READER_PROGRESS_CATALOG_SCHEMA_VERSION = 1 as const;
export const READER_PROGRESS_CATALOG_ARTIFACT_KIND =
  "publication-reader-progress";
export const READER_PROGRESS_CATALOG_ARTIFACT_MEDIA_TYPE =
  "application/vnd.genii.publisher.reader-progress+json";
export const READER_PROGRESS_CATALOG_ARTIFACT_RELATIVE_PATH =
  "reader/publication-reader-progress.json";
export const MAXIMUM_READER_PROGRESS_CATALOG_ENTRIES = 50_000;
export const MAXIMUM_READER_PROGRESS_CATALOG_SERIALIZED_BYTES = 16_777_216;

export type ReaderProgressCatalogEntry = ReaderProgressOverviewSection;

export interface ReaderProgressCatalog {
  readonly schemaVersion: typeof READER_PROGRESS_CATALOG_SCHEMA_VERSION;
  readonly kind: typeof READER_PROGRESS_CATALOG_ARTIFACT_KIND;
  readonly mediaType: typeof READER_PROGRESS_CATALOG_ARTIFACT_MEDIA_TYPE;
  readonly relativePath: typeof READER_PROGRESS_CATALOG_ARTIFACT_RELATIVE_PATH;
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly entries: readonly ReaderProgressCatalogEntry[];
}

export interface ReaderProgressCatalogIdentity {
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
}

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
    if (bytes > MAXIMUM_READER_PROGRESS_CATALOG_SERIALIZED_BYTES) return bytes;
  }
  return bytes;
}

function plainRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return null;
  }
}

function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(record).sort(compareText);
  const orderedExpected = [...expected].sort(compareText);
  return actual.length === orderedExpected.length &&
    actual.every((key, index) => key === orderedExpected[index]);
}

function validStableId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256 && STABLE_ID.test(value);
}

function validStableIdList(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) &&
    value.length <= maximum &&
    value.every(validStableId) &&
    new Set(value).size === value.length;
}

function sectionHref(workRoute: string, section: ReaderSection): string {
  const address = section.readerAddress;
  if (address === null) return workRoute;
  return address.anchor === undefined
    ? address.path
    : `${address.path}#${address.anchor}`;
}

function freezeEntry(entry: ReaderProgressCatalogEntry): ReaderProgressCatalogEntry {
  return Object.freeze({
    ...entry,
    continuity: Object.freeze({
      id: entry.continuity.id,
      legacyIds: Object.freeze([...entry.continuity.legacyIds]),
      progressGroups: Object.freeze(
        entry.continuity.progressGroups.map((group) => Object.freeze([...group])),
      ),
      historicalSectionIds: Object.freeze([
        ...entry.continuity.historicalSectionIds,
      ]),
    }),
  });
}

export function createReaderProgressCatalog(
  reader: PublicationReaderEnvelope,
): ReaderProgressCatalog {
  const entries: ReaderProgressCatalogEntry[] = [];
  let order = 0;
  for (const work of reader.works) {
    for (const section of work.sections) {
      if (!section.navigable) continue;
      entries.push(freezeEntry({
        id: section.id,
        continuity: section.continuity,
        contentHash: section.contentHash,
        wordCount: section.wordCount,
        workId: work.id,
        workTitle: work.title,
        title: section.title,
        href: sectionHref(work.route, section),
        order,
      }));
      order += 1;
    }
  }
  return Object.freeze({
    schemaVersion: READER_PROGRESS_CATALOG_SCHEMA_VERSION,
    kind: READER_PROGRESS_CATALOG_ARTIFACT_KIND,
    mediaType: READER_PROGRESS_CATALOG_ARTIFACT_MEDIA_TYPE,
    relativePath: READER_PROGRESS_CATALOG_ARTIFACT_RELATIVE_PATH,
    publicationId: reader.publicationId,
    readerBuildId: reader.buildId,
    entries: Object.freeze(entries),
  });
}

export function serializeReaderProgressCatalog(catalog: ReaderProgressCatalog): string {
  return JSON.stringify(catalog);
}

function parseContinuity(value: unknown): ReaderProgressCatalogEntry["continuity"] | null {
  const record = plainRecord(value);
  if (
    record === null ||
    !hasExactKeys(record, [
      "id",
      "legacyIds",
      "progressGroups",
      "historicalSectionIds",
    ]) ||
    !validStableId(record.id) ||
    !validStableIdList(record.legacyIds, 4_096) ||
    !validStableIdList(record.historicalSectionIds, 4_096) ||
    !Array.isArray(record.progressGroups) ||
    record.progressGroups.length < 1 ||
    record.progressGroups.length > 4_096
  ) return null;
  const progressGroups: string[][] = [];
  const primaryAndLegacy = new Set([record.id, ...record.legacyIds]);
  if (primaryAndLegacy.size !== record.legacyIds.length + 1) return null;
  const usedProgressIds = new Set<string>();
  for (const group of record.progressGroups) {
    if (!validStableIdList(group, 4_096) || group.length < 1) return null;
    for (const id of group) {
      if (!primaryAndLegacy.has(id) || usedProgressIds.has(id)) return null;
      usedProgressIds.add(id);
    }
    progressGroups.push([...group]);
  }
  if (!usedProgressIds.has(record.id)) return null;
  const aliases = new Set([
    record.id,
    ...record.legacyIds,
    ...record.historicalSectionIds,
  ]);
  for (const group of progressGroups) {
    for (const id of group) aliases.add(id);
  }
  if (aliases.size > 4_096) return null;
  return Object.freeze({
    id: record.id,
    legacyIds: Object.freeze([...record.legacyIds]),
    progressGroups: Object.freeze(
      progressGroups.map((group) => Object.freeze(group)),
    ),
    historicalSectionIds: Object.freeze([...record.historicalSectionIds]),
  });
}

/** Parses untrusted fetched progress data and binds it to the expected Reader. */
export function parseReaderProgressCatalog(
  serialized: string,
  expected: ReaderProgressCatalogIdentity,
): ReaderProgressCatalog | null {
  if (
    typeof serialized !== "string" ||
    utf8ByteLength(serialized) > MAXIMUM_READER_PROGRESS_CATALOG_SERIALIZED_BYTES ||
    !validStableId(expected.publicationId) ||
    !SHA256_DIGEST.test(expected.readerBuildId)
  ) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  const record = plainRecord(value);
  if (
    record === null ||
    !hasExactKeys(record, [
      "schemaVersion",
      "kind",
      "mediaType",
      "relativePath",
      "publicationId",
      "readerBuildId",
      "entries",
    ]) ||
    record.schemaVersion !== READER_PROGRESS_CATALOG_SCHEMA_VERSION ||
    record.kind !== READER_PROGRESS_CATALOG_ARTIFACT_KIND ||
    record.mediaType !== READER_PROGRESS_CATALOG_ARTIFACT_MEDIA_TYPE ||
    record.relativePath !== READER_PROGRESS_CATALOG_ARTIFACT_RELATIVE_PATH ||
    record.publicationId !== expected.publicationId ||
    record.readerBuildId !== expected.readerBuildId ||
    !Array.isArray(record.entries) ||
    record.entries.length > MAXIMUM_READER_PROGRESS_CATALOG_ENTRIES
  ) return null;

  const entries: ReaderProgressCatalogEntry[] = [];
  const identities = new Set<string>();
  const continuityOwners = new Set<string>();
  for (let order = 0; order < record.entries.length; order += 1) {
    const entry = plainRecord(record.entries[order]);
    if (
      entry === null ||
      !hasExactKeys(entry, [
        "id",
        "continuity",
        "contentHash",
        "wordCount",
        "workId",
        "workTitle",
        "title",
        "href",
        "order",
      ]) ||
      !validStableId(entry.id) ||
      !validStableId(entry.workId) ||
      typeof entry.workTitle !== "string" ||
      entry.workTitle.length > 2_048 ||
      typeof entry.title !== "string" ||
      entry.title.length > 2_048 ||
      typeof entry.href !== "string" ||
      entry.href.length > 8_192 ||
      !entry.href.startsWith("/") ||
      typeof entry.contentHash !== "string" ||
      !SHA256_DIGEST.test(entry.contentHash) ||
      !Number.isSafeInteger(entry.wordCount) ||
      (entry.wordCount as number) < 0 ||
      entry.order !== order
    ) return null;
    const continuity = parseContinuity(entry.continuity);
    if (continuity === null) return null;
    const identity = `${entry.workId}\u0000${entry.id}\u0000${continuity.id}`;
    if (identities.has(identity)) return null;
    identities.add(identity);
    const ownedContinuity = new Set([
      entry.id,
      continuity.id,
      ...continuity.legacyIds,
      ...continuity.historicalSectionIds,
    ]);
    for (const ownedIdentity of ownedContinuity) {
      if (continuityOwners.has(ownedIdentity)) return null;
      continuityOwners.add(ownedIdentity);
    }
    entries.push(freezeEntry({
      id: entry.id,
      continuity,
      contentHash: entry.contentHash as Sha256Digest,
      wordCount: entry.wordCount as number,
      workId: entry.workId,
      workTitle: entry.workTitle,
      title: entry.title,
      href: entry.href,
      order,
    }));
  }
  return Object.freeze({
    schemaVersion: READER_PROGRESS_CATALOG_SCHEMA_VERSION,
    kind: READER_PROGRESS_CATALOG_ARTIFACT_KIND,
    mediaType: READER_PROGRESS_CATALOG_ARTIFACT_MEDIA_TYPE,
    relativePath: READER_PROGRESS_CATALOG_ARTIFACT_RELATIVE_PATH,
    publicationId: expected.publicationId,
    readerBuildId: expected.readerBuildId,
    entries: Object.freeze(entries),
  });
}
