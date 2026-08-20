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

export const READER_SEARCH_SCHEMA_VERSION = 1 as const;
export const READER_SEARCH_ARTIFACT_KIND = "publication-reader-search";
export const READER_SEARCH_ARTIFACT_MEDIA_TYPE =
  "application/vnd.genii.publisher.reader-search+json";
export const READER_SEARCH_ARTIFACT_RELATIVE_PATH =
  "reader/publication-reader-search.json";
export const MAXIMUM_READER_SEARCH_QUERY_CODE_UNITS = 256;
export const MAXIMUM_READER_SEARCH_TERMS = 16;
export const MAXIMUM_READER_SEARCH_RESULTS = 100;
export const MAXIMUM_READER_SEARCH_ENTRIES = 50_000;
export const MAXIMUM_READER_SEARCH_SERIALIZED_BYTES = 33_554_432;

export interface ReaderSearchEntry {
  readonly workId: string;
  readonly sectionId: string;
  readonly continuityId: string;
  readonly workTitle: string;
  readonly sectionTitle: string;
  readonly href: string;
  readonly text: string;
  readonly foldedTitle: string;
  readonly foldedText: string;
  readonly contentHash: Sha256Digest;
  readonly wordCount: number;
  readonly order: number;
}

export interface ReaderSearchIndex {
  readonly schemaVersion: typeof READER_SEARCH_SCHEMA_VERSION;
  readonly kind: typeof READER_SEARCH_ARTIFACT_KIND;
  readonly mediaType: typeof READER_SEARCH_ARTIFACT_MEDIA_TYPE;
  readonly relativePath: typeof READER_SEARCH_ARTIFACT_RELATIVE_PATH;
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly entries: readonly ReaderSearchEntry[];
}

export interface ReaderSearchResult {
  readonly entry: ReaderSearchEntry;
  readonly matchedTerms: readonly string[];
  readonly snippet: string;
  readonly snippetStart: number;
  readonly matchStart: number;
  readonly matchEnd: number;
}

export interface ReaderSearchOptions {
  readonly limit?: number;
  readonly snippetCodeUnits?: number;
}

export interface ReaderSearchIdentity {
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
}

interface FoldedText {
  readonly text: string;
  readonly originalOffsets: readonly number[];
}

const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const COMBINING_MARK = /\p{M}/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freezeEntry(entry: ReaderSearchEntry): ReaderSearchEntry {
  return Object.freeze({ ...entry });
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

function plainRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return null;
    }
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        return null;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return null;
      }
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
  return actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort(compareText)[index]);
}

function validStableId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 256 && STABLE_ID.test(value);
}

function appendFolded(
  output: string[],
  offsets: number[],
  value: string,
  originalOffset: number,
): void {
  for (let index = 0; index < value.length; index += 1) {
    output.push(value[index] ?? "");
    offsets.push(originalOffset);
  }
}

function foldWithOffsets(value: string): FoldedText {
  const output: string[] = [];
  const offsets: number[] = [];
  let pendingSpaceOffset: number | null = null;
  let originalOffset = 0;

  for (const originalCharacter of value) {
    const normalized = originalCharacter.normalize("NFKD").toLowerCase();
    let emittedWordCharacter = false;
    for (const character of normalized) {
      if (COMBINING_MARK.test(character)) {
        continue;
      }
      if (LETTER_OR_NUMBER.test(character) || character === "'") {
        if (pendingSpaceOffset !== null && output.length > 0) {
          appendFolded(output, offsets, " ", pendingSpaceOffset);
        }
        pendingSpaceOffset = null;
        appendFolded(output, offsets, character, originalOffset);
        emittedWordCharacter = true;
      }
    }
    if (!emittedWordCharacter) {
      pendingSpaceOffset ??= originalOffset;
    }
    originalOffset += originalCharacter.length;
  }

  return Object.freeze({
    text: output.join(""),
    originalOffsets: Object.freeze(offsets),
  });
}

/** Unicode-aware, punctuation-insensitive folding shared by indexing and query. */
export function foldReaderSearchText(value: string): string {
  return foldWithOffsets(value).text;
}

export function createReaderSearchTerms(query: string): readonly string[] {
  const bounded = query.slice(0, MAXIMUM_READER_SEARCH_QUERY_CODE_UNITS);
  return Object.freeze(
    [...new Set(foldReaderSearchText(bounded).split(" ").filter(Boolean))]
      .slice(0, MAXIMUM_READER_SEARCH_TERMS),
  );
}

function sectionHref(workRoute: string, section: ReaderSection): string {
  const address = section.readerAddress;
  if (address === null) {
    return workRoute;
  }
  return address.anchor === undefined
    ? address.path
    : `${address.path}#${address.anchor}`;
}

/** Projects the public Reader envelope into the smaller artifact search needs. */
export function createReaderSearchIndex(
  reader: PublicationReaderEnvelope,
): ReaderSearchIndex {
  const entries: ReaderSearchEntry[] = [];
  let order = 0;
  for (const work of reader.works) {
    for (const section of work.sections) {
      if (!section.navigable) {
        continue;
      }
      const text = section.blocks.map((block) => block.text).join("\n\n");
      const title = `${work.title} ${section.title}`;
      entries.push(freezeEntry({
        workId: work.id,
        sectionId: section.id,
        continuityId: section.continuity.id,
        workTitle: work.title,
        sectionTitle: section.title,
        href: sectionHref(work.route, section),
        text,
        foldedTitle: foldReaderSearchText(title),
        foldedText: foldReaderSearchText(text),
        contentHash: section.contentHash,
        wordCount: section.wordCount,
        order,
      }));
      order += 1;
    }
  }
  return Object.freeze({
    schemaVersion: READER_SEARCH_SCHEMA_VERSION,
    kind: READER_SEARCH_ARTIFACT_KIND,
    mediaType: READER_SEARCH_ARTIFACT_MEDIA_TYPE,
    relativePath: READER_SEARCH_ARTIFACT_RELATIVE_PATH,
    publicationId: reader.publicationId,
    readerBuildId: reader.buildId,
    entries: Object.freeze(entries),
  });
}

export function serializeReaderSearchIndex(index: ReaderSearchIndex): string {
  return JSON.stringify({
    schemaVersion: index.schemaVersion,
    kind: index.kind,
    mediaType: index.mediaType,
    relativePath: index.relativePath,
    publicationId: index.publicationId,
    readerBuildId: index.readerBuildId,
    entries: index.entries.map((entry) => ({
      workId: entry.workId,
      sectionId: entry.sectionId,
      continuityId: entry.continuityId,
      workTitle: entry.workTitle,
      sectionTitle: entry.sectionTitle,
      href: entry.href,
      text: entry.text,
      foldedTitle: entry.foldedTitle,
      foldedText: entry.foldedText,
      contentHash: entry.contentHash,
      wordCount: entry.wordCount,
      order: entry.order,
    })),
  });
}

/** Parses an untrusted fetched artifact and binds it to the expected Reader. */
export function parseReaderSearchIndex(
  serialized: string,
  expected: ReaderSearchIdentity,
): ReaderSearchIndex | null {
  if (
    typeof serialized !== "string" ||
    utf8ByteLength(serialized) > MAXIMUM_READER_SEARCH_SERIALIZED_BYTES ||
    !validStableId(expected.publicationId) ||
    !SHA256_DIGEST.test(expected.readerBuildId)
  ) {
    return null;
  }
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
    record.schemaVersion !== READER_SEARCH_SCHEMA_VERSION ||
    record.kind !== READER_SEARCH_ARTIFACT_KIND ||
    record.mediaType !== READER_SEARCH_ARTIFACT_MEDIA_TYPE ||
    record.relativePath !== READER_SEARCH_ARTIFACT_RELATIVE_PATH ||
    record.publicationId !== expected.publicationId ||
    record.readerBuildId !== expected.readerBuildId ||
    !Array.isArray(record.entries) ||
    record.entries.length > MAXIMUM_READER_SEARCH_ENTRIES
  ) {
    return null;
  }

  const entries: ReaderSearchEntry[] = [];
  const identities = new Set<string>();
  for (let order = 0; order < record.entries.length; order += 1) {
    const entry = plainRecord(record.entries[order]);
    if (
      entry === null ||
      !hasExactKeys(entry, [
        "workId",
        "sectionId",
        "continuityId",
        "workTitle",
        "sectionTitle",
        "href",
        "text",
        "foldedTitle",
        "foldedText",
        "contentHash",
        "wordCount",
        "order",
      ]) ||
      !validStableId(entry.workId) ||
      !validStableId(entry.sectionId) ||
      !validStableId(entry.continuityId) ||
      typeof entry.workTitle !== "string" ||
      entry.workTitle.length > 2_048 ||
      typeof entry.sectionTitle !== "string" ||
      entry.sectionTitle.length > 2_048 ||
      typeof entry.href !== "string" ||
      entry.href.length > 8_192 ||
      !entry.href.startsWith("/") ||
      typeof entry.text !== "string" ||
      entry.text.length > 4_194_304 ||
      typeof entry.foldedTitle !== "string" ||
      typeof entry.foldedText !== "string" ||
      entry.foldedTitle !==
        foldReaderSearchText(`${entry.workTitle} ${entry.sectionTitle}`) ||
      entry.foldedText !== foldReaderSearchText(entry.text) ||
      typeof entry.contentHash !== "string" ||
      !SHA256_DIGEST.test(entry.contentHash) ||
      !Number.isSafeInteger(entry.wordCount) ||
      (entry.wordCount as number) < 0 ||
      entry.order !== order
    ) {
      return null;
    }
    const identity = `${entry.workId}\u0000${entry.sectionId}\u0000${entry.continuityId}`;
    if (identities.has(identity)) {
      return null;
    }
    identities.add(identity);
    entries.push(freezeEntry({
      workId: entry.workId,
      sectionId: entry.sectionId,
      continuityId: entry.continuityId,
      workTitle: entry.workTitle,
      sectionTitle: entry.sectionTitle,
      href: entry.href,
      text: entry.text,
      foldedTitle: entry.foldedTitle,
      foldedText: entry.foldedText,
      contentHash: entry.contentHash as Sha256Digest,
      wordCount: entry.wordCount as number,
      order,
    }));
  }
  return Object.freeze({
    schemaVersion: READER_SEARCH_SCHEMA_VERSION,
    kind: READER_SEARCH_ARTIFACT_KIND,
    mediaType: READER_SEARCH_ARTIFACT_MEDIA_TYPE,
    relativePath: READER_SEARCH_ARTIFACT_RELATIVE_PATH,
    publicationId: expected.publicationId,
    readerBuildId: expected.readerBuildId,
    entries: Object.freeze(entries),
  });
}

function safeSliceBoundary(value: string, offset: number): number {
  if (
    offset > 0 &&
    offset < value.length &&
    /[\uDC00-\uDFFF]/u.test(value[offset] ?? "")
  ) {
    return offset - 1;
  }
  return offset;
}

function createSnippet(
  entry: ReaderSearchEntry,
  terms: readonly string[],
  snippetCodeUnits: number,
): Omit<ReaderSearchResult, "entry" | "matchedTerms"> {
  const folded = foldWithOffsets(entry.text);
  const indexes = terms
    .map((term) => ({ term, index: folded.text.indexOf(term) }))
    .filter((match) => match.index >= 0)
    .sort((left, right) => left.index - right.index || compareText(left.term, right.term));
  const first = indexes[0];
  if (first === undefined) {
    return { snippet: "", snippetStart: 0, matchStart: 0, matchEnd: 0 };
  }
  const originalMatchStart = folded.originalOffsets[first.index] ?? 0;
  const lastFoldedOffset = first.index + Math.max(0, first.term.length - 1);
  const originalLastStart = folded.originalOffsets[lastFoldedOffset] ?? originalMatchStart;
  const originalCharacter = entry.text.codePointAt(originalLastStart);
  const originalMatchEnd = originalLastStart +
    (originalCharacter !== undefined && originalCharacter > 0xffff ? 2 : 1);
  const radius = Math.max(20, Math.min(500, Math.floor(snippetCodeUnits / 2)));
  const snippetStart = safeSliceBoundary(
    entry.text,
    Math.max(0, originalMatchStart - radius),
  );
  const snippetEnd = safeSliceBoundary(
    entry.text,
    Math.min(entry.text.length, originalMatchEnd + radius),
  );
  return {
    snippet: entry.text.slice(snippetStart, snippetEnd),
    snippetStart,
    matchStart: originalMatchStart - snippetStart,
    matchEnd: originalMatchEnd - snippetStart,
  };
}

export function searchReaderIndex(
  index: ReaderSearchIndex,
  query: string,
  options: ReaderSearchOptions = {},
): readonly ReaderSearchResult[] {
  const terms = createReaderSearchTerms(query);
  if (terms.length === 0) {
    return Object.freeze([]);
  }
  const limit = Math.max(
    1,
    Math.min(
      MAXIMUM_READER_SEARCH_RESULTS,
      Number.isSafeInteger(options.limit) ? options.limit ?? 20 : 20,
    ),
  );
  const snippetCodeUnits = Number.isSafeInteger(options.snippetCodeUnits)
    ? options.snippetCodeUnits ?? 180
    : 180;
  const matches = index.entries
    .filter((entry) =>
      terms.every((term) =>
        entry.foldedTitle.includes(term) || entry.foldedText.includes(term),
      ),
    )
    .sort((left, right) => {
      const leftTitleMatches = terms.filter((term) =>
        left.foldedTitle.includes(term),
      ).length;
      const rightTitleMatches = terms.filter((term) =>
        right.foldedTitle.includes(term),
      ).length;
      return rightTitleMatches - leftTitleMatches ||
        left.order - right.order ||
        compareText(left.continuityId, right.continuityId);
    })
    .slice(0, limit)
    .map((entry) => {
      const snippet = createSnippet(entry, terms, snippetCodeUnits);
      return Object.freeze({
        entry,
        matchedTerms: terms,
        ...snippet,
      });
    });
  return Object.freeze(matches);
}
