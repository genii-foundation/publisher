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

export const READER_PREFERENCES_SCHEMA_VERSION = 1 as const;
export const READER_PREFERENCES_STORAGE_PREFIX =
  "genii.publisher.reader.preferences";
export const MAXIMUM_READER_PREFERENCES_SERIALIZED_BYTES = 16_384;

export const READER_FONT_SCALES = Object.freeze([
  85,
  90,
  95,
  100,
  105,
  110,
  115,
  120,
  125,
] as const);
export const READER_COLOR_SCHEMES = Object.freeze([
  "system",
  "light",
  "dark",
  "black",
] as const);
export const READER_MOTION_PREFERENCES = Object.freeze([
  "system",
  "reduced",
  "full",
] as const);
export const READER_FOCUS_LEVELS = Object.freeze([
  "none",
  "light",
  "normal",
  "strong",
] as const);

export type ReaderFontScale = (typeof READER_FONT_SCALES)[number];
export type ReaderColorScheme = (typeof READER_COLOR_SCHEMES)[number];
export type ReaderMotionPreference =
  (typeof READER_MOTION_PREFERENCES)[number];
export type ReaderFocusLevel = (typeof READER_FOCUS_LEVELS)[number];

export interface ReaderPreferences {
  readonly schemaVersion: typeof READER_PREFERENCES_SCHEMA_VERSION;
  readonly fontScale: ReaderFontScale;
  readonly fontFamilyId: string;
  readonly colorScheme: ReaderColorScheme;
  readonly motion: ReaderMotionPreference;
  readonly highlights: boolean;
  readonly focus: ReaderFocusLevel;
}

export interface ReaderPreferencesPolicy {
  /** Stable font IDs that a publication theme can actually render. */
  readonly fontFamilyIds?: readonly string[];
  /** Defaults to the generic `serif` family. */
  readonly defaultFontFamilyId?: string;
}

export type ReaderPreferencesUpdate = Partial<
  Omit<ReaderPreferences, "schemaVersion">
>;

const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const DANGEROUS_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

interface NormalizedPolicy {
  readonly defaultFontFamilyId: string;
  readonly fontFamilyIds: ReadonlySet<string>;
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

function requireStableId(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  if (!isStableId(value, maximumLength)) {
    throw new TypeError(`${label} must be a portable stable identifier.`);
  }
}

function normalizePolicy(
  policy: ReaderPreferencesPolicy | undefined,
): NormalizedPolicy {
  const defaultFontFamilyId = policy?.defaultFontFamilyId ?? "serif";
  requireStableId(defaultFontFamilyId, "The default font family ID", 128);

  const ids = new Set<string>(["serif", defaultFontFamilyId]);
  for (const id of policy?.fontFamilyIds ?? []) {
    requireStableId(id, "Every font family ID", 128);
    ids.add(id);
  }

  return Object.freeze({
    defaultFontFamilyId,
    fontFamilyIds: ids,
  });
}

function isAllowedValue<T extends string | number>(
  allowed: readonly T[],
  value: unknown,
): value is T {
  return allowed.some((candidate) => candidate === value);
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

function freezePreferences(
  value: Omit<ReaderPreferences, "schemaVersion">,
): ReaderPreferences {
  return Object.freeze({
    schemaVersion: READER_PREFERENCES_SCHEMA_VERSION,
    fontScale: value.fontScale,
    fontFamilyId: value.fontFamilyId,
    colorScheme: value.colorScheme,
    motion: value.motion,
    highlights: value.highlights,
    focus: value.focus,
  });
}

export function createReaderPreferencesStorageKey(
  publicationId: string,
): string {
  requireStableId(publicationId, "The publication ID", 128);
  return `${READER_PREFERENCES_STORAGE_PREFIX}.v${READER_PREFERENCES_SCHEMA_VERSION}.${publicationId}`;
}

export function createDefaultReaderPreferences(
  policy?: ReaderPreferencesPolicy,
): ReaderPreferences {
  const normalizedPolicy = normalizePolicy(policy);
  return freezePreferences({
    fontScale: 100,
    fontFamilyId: normalizedPolicy.defaultFontFamilyId,
    colorScheme: "system",
    motion: "system",
    highlights: true,
    focus: "none",
  });
}

export function sanitizeReaderPreferences(
  value: unknown,
  policy?: ReaderPreferencesPolicy,
): ReaderPreferences {
  const normalizedPolicy = normalizePolicy(policy);
  const defaults = createDefaultReaderPreferences(policy);
  const record = readPlainDataRecord(value);
  if (
    record === undefined ||
    record.schemaVersion !== READER_PREFERENCES_SCHEMA_VERSION
  ) {
    return defaults;
  }

  return freezePreferences({
    fontScale: isAllowedValue(READER_FONT_SCALES, record.fontScale)
      ? record.fontScale
      : defaults.fontScale,
    fontFamilyId:
      typeof record.fontFamilyId === "string" &&
      normalizedPolicy.fontFamilyIds.has(record.fontFamilyId)
        ? record.fontFamilyId
        : defaults.fontFamilyId,
    colorScheme: isAllowedValue(
      READER_COLOR_SCHEMES,
      record.colorScheme,
    )
      ? record.colorScheme
      : defaults.colorScheme,
    motion: isAllowedValue(READER_MOTION_PREFERENCES, record.motion)
      ? record.motion
      : defaults.motion,
    highlights:
      typeof record.highlights === "boolean"
        ? record.highlights
        : defaults.highlights,
    focus: isAllowedValue(READER_FOCUS_LEVELS, record.focus)
      ? record.focus
      : defaults.focus,
  });
}

export function parseReaderPreferences(
  serialized: string | null | undefined,
  policy?: ReaderPreferencesPolicy,
): ReaderPreferences {
  if (
    typeof serialized !== "string" ||
    utf8ByteLength(serialized) > MAXIMUM_READER_PREFERENCES_SERIALIZED_BYTES
  ) {
    return createDefaultReaderPreferences(policy);
  }
  try {
    return sanitizeReaderPreferences(JSON.parse(serialized), policy);
  } catch {
    return createDefaultReaderPreferences(policy);
  }
}

export function updateReaderPreferences(
  current: ReaderPreferences,
  update: ReaderPreferencesUpdate,
  policy?: ReaderPreferencesPolicy,
): ReaderPreferences {
  const currentRecord = readPlainDataRecord(current);
  const updateRecord = readPlainDataRecord(update);
  if (updateRecord === undefined) {
    return sanitizeReaderPreferences(currentRecord, policy);
  }
  return sanitizeReaderPreferences(
    {
      ...currentRecord,
      ...updateRecord,
      schemaVersion: READER_PREFERENCES_SCHEMA_VERSION,
    },
    policy,
  );
}

export function serializeReaderPreferences(
  value: ReaderPreferences,
  policy?: ReaderPreferencesPolicy,
): string {
  const preferences = sanitizeReaderPreferences(value, policy);
  return JSON.stringify({
    schemaVersion: preferences.schemaVersion,
    fontScale: preferences.fontScale,
    fontFamilyId: preferences.fontFamilyId,
    colorScheme: preferences.colorScheme,
    motion: preferences.motion,
    highlights: preferences.highlights,
    focus: preferences.focus,
  });
}
