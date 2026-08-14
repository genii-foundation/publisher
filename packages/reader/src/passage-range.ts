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
  ReaderBlock,
  Sha256Digest,
} from "@genii-foundation/publisher-schema/reader";

export interface ReaderPassagePoint {
  readonly workId: string;
  readonly sectionContinuityId: string;
  readonly blockId: string;
  readonly blockContentHash: Sha256Digest;
  /** UTF-16 code-unit offset into the exact ReaderBlock text. */
  readonly offset: number;
}

export interface ReaderPassageRange {
  readonly start: ReaderPassagePoint;
  readonly end: ReaderPassagePoint;
}

export type ReaderPassageRangeValidation =
  | {
      readonly valid: true;
      readonly value: ReaderPassageRange;
    }
  | {
      readonly valid: false;
      readonly reason:
        | "shape"
        | "identity"
        | "hash"
        | "offset"
        | "scope"
        | "order";
    };

export type ReaderPassageRangeResolution =
  | {
      readonly status: "exact" | "renamed-block";
      readonly range: ReaderPassageRange;
    }
  | {
      readonly status: "ambiguous";
    }
  | {
      readonly status: "missing";
    }
  | {
      readonly status: "invalid";
    };

const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const POINT_KEYS = Object.freeze([
  "workId",
  "sectionContinuityId",
  "blockId",
  "blockContentHash",
  "offset",
] as const);

const INVALID_RESOLUTION = Object.freeze({ status: "invalid" } as const);
const MISSING_RESOLUTION = Object.freeze({ status: "missing" } as const);
const AMBIGUOUS_RESOLUTION = Object.freeze({
  status: "ambiguous",
} as const);

function readExactRecord(
  value: unknown,
  keys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some(
        (key) =>
          typeof key !== "string" ||
          !keys.includes(key),
      )
    ) {
      return undefined;
    }
    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
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

function isStableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    !DANGEROUS_KEYS.has(value) &&
    STABLE_ID.test(value)
  );
}

function freezePoint(value: {
  readonly workId: string;
  readonly sectionContinuityId: string;
  readonly blockId: string;
  readonly blockContentHash: Sha256Digest;
  readonly offset: number;
}): ReaderPassagePoint {
  return Object.freeze({
    workId: value.workId,
    sectionContinuityId: value.sectionContinuityId,
    blockId: value.blockId,
    blockContentHash: value.blockContentHash,
    offset: value.offset,
  });
}

function freezeRange(
  start: ReaderPassagePoint,
  end: ReaderPassagePoint,
): ReaderPassageRange {
  return Object.freeze({ start, end });
}

function validatePoint(
  value: unknown,
):
  | { readonly valid: true; readonly value: ReaderPassagePoint }
  | { readonly valid: false; readonly reason: "shape" | "identity" | "hash" | "offset" } {
  const record = readExactRecord(value, POINT_KEYS);
  if (record === undefined) {
    return Object.freeze({ valid: false, reason: "shape" });
  }
  if (
    !isStableId(record.workId) ||
    !isStableId(record.sectionContinuityId) ||
    !isStableId(record.blockId)
  ) {
    return Object.freeze({ valid: false, reason: "identity" });
  }
  if (
    typeof record.blockContentHash !== "string" ||
    !SHA256_DIGEST.test(record.blockContentHash)
  ) {
    return Object.freeze({ valid: false, reason: "hash" });
  }
  if (
    typeof record.offset !== "number" ||
    !Number.isSafeInteger(record.offset) ||
    record.offset < 0
  ) {
    return Object.freeze({ valid: false, reason: "offset" });
  }
  return Object.freeze({
    valid: true,
    value: freezePoint({
      workId: record.workId,
      sectionContinuityId: record.sectionContinuityId,
      blockId: record.blockId,
      blockContentHash: record.blockContentHash as Sha256Digest,
      offset: record.offset,
    }),
  });
}

/**
 * Validates and detaches a stored range without consulting publication data.
 * Cross-block order is checked when the range is resolved against ordered blocks.
 */
export function validateReaderPassageRange(
  value: unknown,
): ReaderPassageRangeValidation {
  const record = readExactRecord(value, ["start", "end"]);
  if (record === undefined) {
    return Object.freeze({ valid: false, reason: "shape" });
  }
  const start = validatePoint(record.start);
  if (!start.valid) {
    return start;
  }
  const end = validatePoint(record.end);
  if (!end.valid) {
    return end;
  }
  if (
    start.value.workId !== end.value.workId ||
    start.value.sectionContinuityId !== end.value.sectionContinuityId
  ) {
    return Object.freeze({ valid: false, reason: "scope" });
  }
  if (
    start.value.blockId === end.value.blockId &&
    start.value.blockContentHash !== end.value.blockContentHash
  ) {
    return Object.freeze({ valid: false, reason: "hash" });
  }
  if (
    start.value.blockId === end.value.blockId &&
    start.value.offset > end.value.offset
  ) {
    return Object.freeze({ valid: false, reason: "order" });
  }
  return Object.freeze({
    valid: true,
    value: freezeRange(start.value, end.value),
  });
}

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset < 0 || offset > text.length) {
    return false;
  }
  if (offset === 0 || offset === text.length) {
    return true;
  }
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return !(
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  );
}

interface BlockIndex {
  readonly blocks: readonly ReaderBlock[];
  readonly byId: ReadonlyMap<string, number>;
  readonly byHash: ReadonlyMap<string, readonly number[]>;
}

function indexBlocks(blocks: readonly ReaderBlock[]): BlockIndex | undefined {
  if (!Array.isArray(blocks)) {
    return undefined;
  }
  const byId = new Map<string, number>();
  const mutableByHash = new Map<string, number[]>();
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (
      block === undefined ||
      !isStableId(block.id) ||
      typeof block.text !== "string" ||
      !SHA256_DIGEST.test(block.contentHash) ||
      byId.has(block.id)
    ) {
      return undefined;
    }
    byId.set(block.id, index);
    const matches = mutableByHash.get(block.contentHash) ?? [];
    matches.push(index);
    mutableByHash.set(block.contentHash, matches);
  }
  const byHash = new Map<string, readonly number[]>();
  for (const [hash, matches] of mutableByHash) {
    byHash.set(hash, Object.freeze([...matches]));
  }
  return Object.freeze({ blocks, byId, byHash });
}

type PointResolution =
  | {
      readonly status: "exact" | "renamed-block";
      readonly point: ReaderPassagePoint;
      readonly blockIndex: number;
    }
  | { readonly status: "ambiguous" | "missing" | "invalid" };

function resolvePoint(
  point: ReaderPassagePoint,
  index: BlockIndex,
): PointResolution {
  const exactIndex = index.byId.get(point.blockId);
  if (exactIndex !== undefined) {
    const exactBlock = index.blocks[exactIndex];
    if (
      exactBlock === undefined ||
      exactBlock.contentHash !== point.blockContentHash ||
      !isUtf16Boundary(exactBlock.text, point.offset)
    ) {
      return MISSING_RESOLUTION;
    }
    return Object.freeze({
      status: "exact",
      point: freezePoint(point),
      blockIndex: exactIndex,
    });
  }

  const hashMatches = index.byHash.get(point.blockContentHash) ?? [];
  if (hashMatches.length === 0) {
    return MISSING_RESOLUTION;
  }
  if (hashMatches.length > 1) {
    return AMBIGUOUS_RESOLUTION;
  }
  const blockIndex = hashMatches[0];
  if (blockIndex === undefined) {
    return MISSING_RESOLUTION;
  }
  const block = index.blocks[blockIndex];
  if (block === undefined || !isUtf16Boundary(block.text, point.offset)) {
    return MISSING_RESOLUTION;
  }
  return Object.freeze({
    status: "renamed-block",
    point: freezePoint({
      workId: point.workId,
      sectionContinuityId: point.sectionContinuityId,
      blockId: block.id,
      blockContentHash: block.contentHash,
      offset: point.offset,
    }),
    blockIndex,
  });
}

/**
 * Resolves a stored range against the current blocks of its one section.
 */
export function resolveReaderPassageRange(
  value: unknown,
  blocks: readonly ReaderBlock[],
): ReaderPassageRangeResolution {
  const validated = validateReaderPassageRange(value);
  if (!validated.valid) {
    return INVALID_RESOLUTION;
  }
  const index = indexBlocks(blocks);
  if (index === undefined) {
    return INVALID_RESOLUTION;
  }
  const start = resolvePoint(validated.value.start, index);
  const end = resolvePoint(validated.value.end, index);
  if (start.status === "invalid" || end.status === "invalid") {
    return INVALID_RESOLUTION;
  }
  if (start.status === "ambiguous" || end.status === "ambiguous") {
    return AMBIGUOUS_RESOLUTION;
  }
  if (start.status === "missing" || end.status === "missing") {
    return MISSING_RESOLUTION;
  }
  if (!("point" in start) || !("point" in end)) {
    return INVALID_RESOLUTION;
  }
  if (
    validated.value.start.blockId !== validated.value.end.blockId &&
    start.point.blockId === end.point.blockId
  ) {
    return AMBIGUOUS_RESOLUTION;
  }
  if (
    start.blockIndex > end.blockIndex ||
    (start.blockIndex === end.blockIndex &&
      start.point.offset > end.point.offset)
  ) {
    return INVALID_RESOLUTION;
  }
  return Object.freeze({
    status:
      start.status === "renamed-block" ||
      end.status === "renamed-block"
        ? "renamed-block"
        : "exact",
    range: freezeRange(start.point, end.point),
  });
}
