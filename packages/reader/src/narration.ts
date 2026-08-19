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
  ReaderSection,
  Sha256Digest,
} from "@genii-foundation/publisher-schema/reader";

export const READER_NARRATION_PREFERENCES_SCHEMA_VERSION = 1 as const;
export const READER_NARRATION_PLAYBACK_RATES = Object.freeze([
  0.75,
  1,
  1.25,
  1.5,
  2,
] as const);
export const MAXIMUM_READER_NARRATION_SERIALIZED_BYTES = 67_108_864;
export const MAXIMUM_READER_NARRATION_TIMING_SERIALIZED_BYTES = 134_217_728;
export const MINIMUM_READER_NARRATION_EXACT_TIMING_RATIO = 0.6;
export const MAXIMUM_READER_NARRATION_INTERPOLATED_WORD_RUN = 12;

export interface ReaderNarrationClip {
  readonly sectionId: string;
  readonly audioVersionId: string;
  readonly href: string;
  readonly format?: "mp3" | "opus" | "wav";
  readonly byteSize?: number;
  readonly timingsByteSize?: number;
  readonly durationSeconds?: number;
}

export interface ReaderNarrationVoice {
  readonly id: string;
  readonly label: string;
  readonly provider?: string;
  readonly model?: string;
  readonly clips: readonly ReaderNarrationClip[];
  readonly narratedSectionCount: number;
  readonly unnarratedSectionCount: number;
}

export interface ReaderNarrationEnvelope {
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly voices: readonly ReaderNarrationVoice[];
  readonly statistics: {
    readonly voiceCount: number;
    readonly clipCount: number;
    readonly sectionCount: number;
  };
}

export interface ReaderNarrationIdentity {
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
}

export interface ReaderNarrationNavigationIntent {
  readonly publicationId: string;
  readonly sectionId: string;
  readonly href: string;
}

export interface ReaderNarrationNavigationIdentity {
  readonly publicationId: string;
}

export interface ReaderNarrationWordTiming {
  readonly charStart: number;
  readonly charEnd: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly match: "exact" | "interpolated";
}

export interface ReaderNarrationTimingDocument {
  readonly version: 1;
  readonly sectionId: string;
  readonly audioVersionId: string;
  readonly voiceId: string;
  readonly textCharacters: number;
  readonly durationSeconds: number;
  readonly exactWordCount: number;
  readonly interpolatedWordCount: number;
  readonly words: readonly ReaderNarrationWordTiming[];
}

export interface ReaderNarrationTimingIdentity {
  readonly sectionId: string;
  readonly audioVersionId: string;
  readonly voiceId: string;
  readonly textCharacters: number;
  readonly timingsByteSize: number;
}

export interface ReaderNarrationSectionTextProfile {
  readonly text: string;
  readonly textCharacters: number;
  readonly titleWordCount: number;
  readonly bodyWordCount: number;
}

export interface ReaderNarrationPreferences {
  readonly schemaVersion: typeof READER_NARRATION_PREFERENCES_SCHEMA_VERSION;
  readonly selectedVoiceId: string | null;
  readonly playbackRate: typeof READER_NARRATION_PLAYBACK_RATES[number];
}

const AUDIO_SCHEMA =
  "https://publisher.genii.foundation/schemas/audio-envelope.schema.json";
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const OPAQUE_VERSION_ID = STABLE_ID;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const ROOT_CLIP_HREF =
  /^\/(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.+\/$)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;
const MAXIMUM_VOICES = 64;
const MAXIMUM_CLIPS = 50_000;
const MAXIMUM_TIMING_WORDS = 1_000_000;
const NARRATION_WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'’·ˈ]*/gu;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (
      code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > MAXIMUM_READER_NARRATION_SERIALIZED_BYTES) return bytes;
  }
  return bytes;
}

function plainRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
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

function hasKeys(
  record: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const actual = Object.keys(record).sort(compareText);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(record, key)) &&
    actual.every((key) => allowed.has(key));
}

function stableId(value: unknown, maximum = 128): value is string {
  return typeof value === "string" &&
    value.length <= maximum &&
    STABLE_ID.test(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum;
}

function boundedInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum;
}

function readerHref(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 8_192 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\\u0000-\u0020\u007f]/u.test(value);
}

function positiveNumber(value: unknown, maximum: number): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= maximum;
}

function normalizeNarrationText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function countReaderNarrationWords(value: string): number {
  if (typeof value !== "string") return 0;
  NARRATION_WORD_PATTERN.lastIndex = 0;
  let count = 0;
  while (NARRATION_WORD_PATTERN.exec(value) !== null) count += 1;
  return count;
}

/**
 * Parses the untrusted browser intent used to join section navigation to the
 * default narration queue. The renderer must still require an exact section
 * and href match from its build-bound progress catalog before consuming it.
 */
export function parseReaderNarrationNavigationIntent(
  value: unknown,
  expected: ReaderNarrationNavigationIdentity,
): ReaderNarrationNavigationIntent | null {
  const record = plainRecord(value);
  if (
    record === null ||
    !hasKeys(record, ["publicationId", "sectionId", "href"]) ||
    !stableId(expected.publicationId, 256) ||
    record.publicationId !== expected.publicationId ||
    !stableId(record.sectionId, 256) ||
    !readerHref(record.href)
  ) return null;
  return Object.freeze({
    publicationId: expected.publicationId,
    sectionId: record.sectionId,
    href: record.href,
  });
}

/**
 * Produces the closed spoken-text profile shared by timing producers and the
 * default renderer. A structural first heading repeats the section title and
 * therefore is not spoken twice.
 */
export function createReaderNarrationSectionTextProfile(
  section: Pick<ReaderSection, "title" | "blocks">,
): ReaderNarrationSectionTextProfile {
  const title = section.title.trim();
  const first = section.blocks[0];
  const bodyBlocks = first?.kind === "heading" && first.text === section.title
    ? section.blocks.slice(1)
    : section.blocks;
  const body = normalizeNarrationText(
    bodyBlocks.map((block) => block.text).join(" "),
  );
  const text = `${title}\n\n${body}`.trim();
  return Object.freeze({
    text,
    textCharacters: text.length,
    titleWordCount: countReaderNarrationWords(title),
    bodyWordCount: countReaderNarrationWords(body),
  });
}

export function readerNarrationTimingHref(
  clip: Pick<ReaderNarrationClip, "href" | "timingsByteSize">,
): string | null {
  if (clip.timingsByteSize === undefined) return null;
  const href = clip.href.replace(/\.[^./]+$/u, ".timings.json");
  return href === clip.href || !validClipHref(href) ? null : href;
}

function validClipHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 2 || value.length > 2048) return false;
  if (value.startsWith("/")) {
    return ROOT_CLIP_HREF.test(value);
  }
  if (!/^[\x21-\x7e]+$/.test(value) || value.includes("\\")) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.pathname !== "/" &&
      parsed.href === value;
  } catch {
    return false;
  }
}

function validJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 10_000 &&
      value.every((item) => validJsonValue(item, depth + 1));
  }
  const record = plainRecord(value);
  return record !== null &&
    Object.keys(record).length <= 10_000 &&
    Object.values(record).every((item) => validJsonValue(item, depth + 1));
}

function validSource(value: unknown): boolean {
  const source = plainRecord(value);
  if (
    source === null ||
    !hasKeys(
      source,
      ["adapter", "catalogPath", "catalogSha256"],
      ["generatedAt"],
    ) ||
    !boundedText(source.catalogPath, 1024) ||
    typeof source.catalogSha256 !== "string" ||
    !SHA256_DIGEST.test(source.catalogSha256) ||
    (source.generatedAt !== undefined &&
      (typeof source.generatedAt !== "string" ||
        !Number.isFinite(Date.parse(source.generatedAt))))
  ) return false;
  const adapter = plainRecord(source.adapter);
  return adapter !== null &&
    hasKeys(adapter, ["package"], ["config"]) &&
    typeof adapter.package === "string" &&
    adapter.package.length <= 214 &&
    PACKAGE_NAME.test(adapter.package) &&
    (adapter.config === undefined ||
      (plainRecord(adapter.config) !== null && validJsonValue(adapter.config)));
}

function parseClip(value: unknown): ReaderNarrationClip | null {
  const clip = plainRecord(value);
  if (
    clip === null ||
    !hasKeys(
      clip,
      ["sectionId", "audioVersionId", "href"],
      ["format", "byteSize", "timingsByteSize", "durationSeconds"],
    ) ||
    !stableId(clip.sectionId) ||
    typeof clip.audioVersionId !== "string" ||
    clip.audioVersionId.length > 256 ||
    !OPAQUE_VERSION_ID.test(clip.audioVersionId) ||
    !validClipHref(clip.href) ||
    (clip.format !== undefined &&
      clip.format !== "mp3" && clip.format !== "opus" && clip.format !== "wav") ||
    (clip.byteSize !== undefined &&
      (!boundedInteger(clip.byteSize, 4_294_967_296) || clip.byteSize < 1)) ||
    (clip.timingsByteSize !== undefined &&
      (!boundedInteger(clip.timingsByteSize, 134_217_728) ||
        clip.timingsByteSize < 1)) ||
    (clip.durationSeconds !== undefined &&
      !positiveNumber(clip.durationSeconds, 86_400))
  ) return null;
  return Object.freeze({
    sectionId: clip.sectionId,
    audioVersionId: clip.audioVersionId,
    href: clip.href,
    ...(clip.format === undefined ? {} : { format: clip.format }),
    ...(clip.byteSize === undefined ? {} : { byteSize: clip.byteSize }),
    ...(clip.timingsByteSize === undefined
      ? {}
      : { timingsByteSize: clip.timingsByteSize }),
    ...(clip.durationSeconds === undefined
      ? {}
      : { durationSeconds: clip.durationSeconds }),
  });
}

/** Parses untrusted fetched narration data and binds it to one Reader build. */
export function parseReaderNarrationEnvelope(
  serialized: string,
  expected: ReaderNarrationIdentity,
): ReaderNarrationEnvelope | null {
  if (
    typeof serialized !== "string" ||
    utf8ByteLength(serialized) > MAXIMUM_READER_NARRATION_SERIALIZED_BYTES ||
    !stableId(expected.publicationId) ||
    !SHA256_DIGEST.test(expected.readerBuildId)
  ) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  const envelope = plainRecord(value);
  if (
    envelope === null ||
    !hasKeys(envelope, [
      "$schema",
      "schemaVersion",
      "publicationId",
      "engineVersion",
      "buildId",
      "source",
      "voices",
      "statistics",
    ]) ||
    envelope.$schema !== AUDIO_SCHEMA ||
    envelope.schemaVersion !== "1.0" ||
    envelope.publicationId !== expected.publicationId ||
    envelope.buildId !== expected.readerBuildId ||
    !boundedText(envelope.engineVersion, 128) ||
    !validSource(envelope.source) ||
    !Array.isArray(envelope.voices) ||
    envelope.voices.length > MAXIMUM_VOICES
  ) return null;

  const voices: ReaderNarrationVoice[] = [];
  const voiceIds = new Set<string>();
  let clipCount = 0;
  for (const value of envelope.voices) {
    const voice = plainRecord(value);
    if (
      voice === null ||
      !hasKeys(
        voice,
        ["id", "label", "clips", "narratedSectionCount", "unnarratedSectionCount"],
        ["provider", "model"],
      ) ||
      !stableId(voice.id) ||
      voiceIds.has(voice.id) ||
      !boundedText(voice.label, 256) ||
      (voice.provider !== undefined && !boundedText(voice.provider, 128)) ||
      (voice.model !== undefined && !boundedText(voice.model, 128)) ||
      !Array.isArray(voice.clips) ||
      !boundedInteger(voice.narratedSectionCount, MAXIMUM_CLIPS) ||
      !boundedInteger(voice.unnarratedSectionCount, MAXIMUM_CLIPS)
    ) return null;
    voiceIds.add(voice.id);
    const clips: ReaderNarrationClip[] = [];
    const sectionIds = new Set<string>();
    for (const value of voice.clips) {
      const clip = parseClip(value);
      if (clip === null || sectionIds.has(clip.sectionId)) return null;
      sectionIds.add(clip.sectionId);
      clips.push(clip);
      clipCount += 1;
      if (clipCount > MAXIMUM_CLIPS) return null;
    }
    if (voice.narratedSectionCount !== clips.length) return null;
    voices.push(Object.freeze({
      id: voice.id,
      label: voice.label,
      ...(voice.provider === undefined ? {} : { provider: voice.provider }),
      ...(voice.model === undefined ? {} : { model: voice.model }),
      clips: Object.freeze(clips),
      narratedSectionCount: voice.narratedSectionCount,
      unnarratedSectionCount: voice.unnarratedSectionCount,
    }));
  }

  const statistics = plainRecord(envelope.statistics);
  if (
    statistics === null ||
    !hasKeys(statistics, ["voiceCount", "clipCount", "sectionCount"]) ||
    !boundedInteger(statistics.voiceCount, MAXIMUM_VOICES) ||
    !boundedInteger(statistics.clipCount, MAXIMUM_CLIPS) ||
    !boundedInteger(statistics.sectionCount, MAXIMUM_CLIPS) ||
    statistics.voiceCount !== voices.length ||
    statistics.clipCount !== clipCount ||
    voices.some((voice) =>
      voice.narratedSectionCount + voice.unnarratedSectionCount !==
        statistics.sectionCount)
  ) return null;

  return Object.freeze({
    publicationId: expected.publicationId,
    readerBuildId: expected.readerBuildId,
    voices: Object.freeze(voices),
    statistics: Object.freeze({
      voiceCount: statistics.voiceCount,
      clipCount: statistics.clipCount,
      sectionCount: statistics.sectionCount,
    }),
  });
}

function parseWordTiming(
  value: unknown,
  previousCharEnd: number,
  previousStartSeconds: number,
  textCharacters: number,
  durationSeconds: number,
): ReaderNarrationWordTiming | null {
  const word = plainRecord(value);
  if (
    word === null ||
    !hasKeys(word, [
      "charStart",
      "charEnd",
      "startSeconds",
      "endSeconds",
      "match",
    ]) ||
    !boundedInteger(word.charStart, textCharacters) ||
    !boundedInteger(word.charEnd, textCharacters) ||
    word.charStart < previousCharEnd ||
    word.charEnd <= word.charStart ||
    typeof word.startSeconds !== "number" ||
    !Number.isFinite(word.startSeconds) ||
    word.startSeconds < previousStartSeconds ||
    word.startSeconds < 0 ||
    typeof word.endSeconds !== "number" ||
    !Number.isFinite(word.endSeconds) ||
    word.endSeconds < word.startSeconds ||
    word.endSeconds > durationSeconds ||
    (word.match !== "exact" && word.match !== "interpolated")
  ) return null;
  return Object.freeze({
    charStart: word.charStart,
    charEnd: word.charEnd,
    startSeconds: word.startSeconds,
    endSeconds: word.endSeconds,
    match: word.match,
  });
}

/** Parses one untrusted timing sidecar and binds it to its exact clip text. */
export function parseReaderNarrationTimingDocument(
  serialized: string,
  expected: ReaderNarrationTimingIdentity,
): ReaderNarrationTimingDocument | null {
  if (
    typeof serialized !== "string" ||
    !stableId(expected.sectionId) ||
    typeof expected.audioVersionId !== "string" ||
    expected.audioVersionId.length > 256 ||
    !OPAQUE_VERSION_ID.test(expected.audioVersionId) ||
    !stableId(expected.voiceId) ||
    !boundedInteger(expected.textCharacters, 16_777_216) ||
    expected.textCharacters < 1 ||
    !boundedInteger(
      expected.timingsByteSize,
      MAXIMUM_READER_NARRATION_TIMING_SERIALIZED_BYTES,
    ) ||
    expected.timingsByteSize < 1
  ) return null;
  const serializedBytes = utf8ByteLength(serialized);
  if (
    serializedBytes !== expected.timingsByteSize ||
    serializedBytes > MAXIMUM_READER_NARRATION_TIMING_SERIALIZED_BYTES
  ) return null;

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  const document = plainRecord(value);
  if (
    document === null ||
    !hasKeys(document, [
      "version",
      "sectionId",
      "audioVersionId",
      "voiceId",
      "textCharacters",
      "durationSeconds",
      "exactWordCount",
      "interpolatedWordCount",
      "words",
    ]) ||
    document.version !== 1 ||
    document.sectionId !== expected.sectionId ||
    document.audioVersionId !== expected.audioVersionId ||
    document.voiceId !== expected.voiceId ||
    document.textCharacters !== expected.textCharacters ||
    !positiveNumber(document.durationSeconds, 86_400) ||
    !boundedInteger(document.exactWordCount, MAXIMUM_TIMING_WORDS) ||
    !boundedInteger(document.interpolatedWordCount, MAXIMUM_TIMING_WORDS) ||
    !Array.isArray(document.words) ||
    document.words.length < 1 ||
    document.words.length > MAXIMUM_TIMING_WORDS ||
    document.exactWordCount + document.interpolatedWordCount !==
      document.words.length
  ) return null;

  const words: ReaderNarrationWordTiming[] = [];
  let previousCharEnd = 0;
  let previousStartSeconds = 0;
  let exactWordCount = 0;
  let interpolatedWordCount = 0;
  let interpolatedRun = 0;
  let longestInterpolatedRun = 0;
  for (const value of document.words) {
    const word = parseWordTiming(
      value,
      previousCharEnd,
      previousStartSeconds,
      expected.textCharacters,
      document.durationSeconds,
    );
    if (word === null) return null;
    words.push(word);
    previousCharEnd = word.charEnd;
    previousStartSeconds = word.startSeconds;
    if (word.match === "exact") {
      exactWordCount += 1;
      interpolatedRun = 0;
    } else {
      interpolatedWordCount += 1;
      interpolatedRun += 1;
      longestInterpolatedRun = Math.max(
        longestInterpolatedRun,
        interpolatedRun,
      );
    }
  }
  if (
    exactWordCount !== document.exactWordCount ||
    interpolatedWordCount !== document.interpolatedWordCount ||
    exactWordCount / words.length <
      MINIMUM_READER_NARRATION_EXACT_TIMING_RATIO ||
    longestInterpolatedRun > MAXIMUM_READER_NARRATION_INTERPOLATED_WORD_RUN
  ) return null;

  return Object.freeze({
    version: 1,
    sectionId: expected.sectionId,
    audioVersionId: expected.audioVersionId,
    voiceId: expected.voiceId,
    textCharacters: expected.textCharacters,
    durationSeconds: document.durationSeconds,
    exactWordCount,
    interpolatedWordCount,
    words: Object.freeze(words),
  });
}

export function readerNarrationTimingIndexForSeconds(
  timings: ReaderNarrationTimingDocument,
  seconds: number,
): number | null {
  if (
    timings.words.length === 0 ||
    typeof seconds !== "number" ||
    !Number.isFinite(seconds)
  ) return null;
  let low = 0;
  let high = timings.words.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const timing = timings.words[middle];
    if (timing === undefined) return null;
    if (seconds < timing.startSeconds) high = middle - 1;
    else if (seconds > timing.endSeconds) low = middle + 1;
    else return middle;
  }
  return Math.max(0, Math.min(low - 1, timings.words.length - 1));
}

export function createReaderNarrationPreferences(): ReaderNarrationPreferences {
  return Object.freeze({
    schemaVersion: READER_NARRATION_PREFERENCES_SCHEMA_VERSION,
    selectedVoiceId: null,
    playbackRate: 1,
  });
}

export function createReaderNarrationPreferencesStorageKey(
  publicationId: string,
): string {
  if (!stableId(publicationId)) throw new TypeError("Invalid publication identity.");
  return `genii.publisher.reader.${publicationId}.narration`;
}

export function parseReaderNarrationPreferences(
  serialized: string | null,
): ReaderNarrationPreferences {
  if (serialized === null || utf8ByteLength(serialized) > 4096) {
    return createReaderNarrationPreferences();
  }
  try {
    const value = plainRecord(JSON.parse(serialized));
    if (
      value === null ||
      !hasKeys(value, ["schemaVersion", "selectedVoiceId", "playbackRate"]) ||
      value.schemaVersion !== READER_NARRATION_PREFERENCES_SCHEMA_VERSION ||
      (value.selectedVoiceId !== null && !stableId(value.selectedVoiceId)) ||
      !READER_NARRATION_PLAYBACK_RATES.includes(
        value.playbackRate as typeof READER_NARRATION_PLAYBACK_RATES[number],
      )
    ) return createReaderNarrationPreferences();
    return Object.freeze({
      schemaVersion: READER_NARRATION_PREFERENCES_SCHEMA_VERSION,
      selectedVoiceId: value.selectedVoiceId as string | null,
      playbackRate: value.playbackRate as typeof READER_NARRATION_PLAYBACK_RATES[number],
    });
  } catch {
    return createReaderNarrationPreferences();
  }
}

export function serializeReaderNarrationPreferences(
  preferences: ReaderNarrationPreferences,
): string {
  const parsed = parseReaderNarrationPreferences(JSON.stringify(preferences));
  return JSON.stringify(parsed);
}
