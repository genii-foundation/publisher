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
  validateReaderEnvelopeShape,
  type ContentAddress,
  type ContentRoute,
  type Diagnostic,
  type PublicationReaderEnvelope,
  type ReaderAsset,
  type ReaderBlock,
  type ReaderCollection,
  type ReaderLink,
  type ReaderSection,
  type ReaderWork,
  type ValidationResult,
} from "@genii-foundation/publisher-schema/reader";
import {
  inspectAbsoluteHttpUrl,
  inspectCanonicalRoutePath,
  inspectCanonicalUrlFragment,
} from "@genii-foundation/publisher-schema/routes";

import { diagnostic, sortDiagnostics } from "./diagnostics.js";
import { immutableSnapshot } from "./immutability.js";
import type {
  PublicationReaderRuntime,
  ReaderAddress,
  ReaderAddressResolution,
  ReaderBlockMatch,
  ReaderBlockReference,
  ReaderBlockRelocationQuery,
  ReaderBlockRelocationResult,
  ReaderCollectionWorkNavigation,
  ReaderCollectionWorkReference,
  ReaderLookup,
  ReaderSectionMatch,
  ReaderSectionNavigation,
  ReaderSectionReference,
} from "./runtime-types.js";

type IndexedContentTarget =
  | {
      readonly kind: "section";
      readonly match: ReaderSectionMatch;
    }
  | {
      readonly kind: "block";
      readonly match: ReaderBlockMatch;
    };

const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const ABSENT = Symbol("absent");

const EMPTY_DIAGNOSTICS: readonly Diagnostic[] = Object.freeze([]);
const LOOKUP_NOT_FOUND = Object.freeze({
  status: "not-found",
} as const);
const LOOKUP_INVALID = Object.freeze({
  status: "invalid",
  reason: "reference",
} as const);
const SECTION_NOT_FOUND = Object.freeze({
  status: "not-found",
} as const);
const SECTION_NOT_NAVIGABLE = Object.freeze({
  status: "not-navigable",
} as const);
const INVALID_REFERENCE = Object.freeze({
  status: "invalid-reference",
} as const);
const RELOCATION_NOT_FOUND = Object.freeze({
  status: "not-found",
} as const);

interface RuntimeIndexes {
  readonly workById: Map<string, ReaderWork>;
  readonly collectionById: Map<string, ReaderCollection>;
  readonly sectionByLocation: Map<string, ReaderSectionMatch>;
  readonly blockByLocation: Map<string, ReaderBlockMatch>;
  readonly continuityOwnerById: Map<string, ReaderSectionMatch>;
  readonly routeByPath: Map<string, ContentRoute>;
  readonly contentByAddress: Map<string, IndexedContentTarget>;
  readonly blocksByHash: Map<string, ReaderBlockMatch[]>;
  readonly assetById: Map<string, ReaderAsset>;
}

function locationKey(workId: string, sectionId: string): string {
  return `${workId}\u0000${sectionId}`;
}

function blockLocationKey(
  workId: string,
  sectionId: string,
  blockId: string,
): string {
  return `${workId}\u0000${sectionId}\u0000${blockId}`;
}

type StrictDataRecordSnapshot =
  | {
      readonly valid: true;
      readonly values: ReadonlyMap<string, unknown | typeof ABSENT>;
    }
  | {
      readonly valid: false;
      readonly invalidKey: string;
    };

function snapshotStrictDataRecord(
  value: unknown,
  keys: readonly string[],
): StrictDataRecordSnapshot {
  let inspectedKey = keys[0] ?? "";
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, invalidKey: inspectedKey };
  }
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((ownKey) => typeof ownKey === "symbol")) {
      return { valid: false, invalidKey: inspectedKey };
    }
    const values = new Map<string, unknown | typeof ABSENT>();
    for (const key of keys) {
      inspectedKey = key;
      const hasOwnKey = ownKeys.includes(key);
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      const hasKey = Reflect.has(value, key);
      if (!hasOwnKey) {
        if (descriptor !== undefined || hasKey) {
          return { valid: false, invalidKey: key };
        }
        values.set(key, ABSENT);
        continue;
      }
      if (
        !hasKey ||
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return { valid: false, invalidKey: key };
      }
      values.set(key, descriptor.value);
    }
    return { valid: true, values };
  } catch {
    return { valid: false, invalidKey: inspectedKey };
  }
}

function isReferenceId(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    STABLE_ID.test(value)
  );
}

function isStableReference(value: unknown): value is string {
  return isReferenceId(value, 128);
}

function isContentReference(value: unknown): value is string {
  return isReferenceId(value, 256);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  const compared = new WeakMap<object, WeakSet<object>>();

  while (pending.length > 0) {
    const pair = pending.pop();
    if (pair === undefined) {
      break;
    }
    const [leftValue, rightValue] = pair;
    if (leftValue === rightValue) {
      continue;
    }
    if (
      leftValue === null ||
      rightValue === null ||
      typeof leftValue !== "object" ||
      typeof rightValue !== "object"
    ) {
      return false;
    }
    if (Array.isArray(leftValue) !== Array.isArray(rightValue)) {
      return false;
    }

    let rightValues = compared.get(leftValue);
    if (rightValues?.has(rightValue) === true) {
      continue;
    }
    if (rightValues === undefined) {
      rightValues = new WeakSet();
      compared.set(leftValue, rightValues);
    }
    rightValues.add(rightValue);

    if (Array.isArray(leftValue) && Array.isArray(rightValue)) {
      if (leftValue.length !== rightValue.length) {
        return false;
      }
      for (let index = 0; index < leftValue.length; index += 1) {
        pending.push([leftValue[index], rightValue[index]]);
      }
      continue;
    }

    const leftRecord = leftValue as Record<string, unknown>;
    const rightRecord = rightValue as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    for (const key of leftKeys) {
      if (!Object.hasOwn(rightRecord, key)) {
        return false;
      }
      pending.push([leftRecord[key], rightRecord[key]]);
    }
  }
  return true;
}

function sameAddress(left: ContentAddress, right: ContentAddress): boolean {
  return (
    left.path === right.path &&
    left.anchor === right.anchor
  );
}

function formatAddress(address: ContentAddress): string {
  return address.anchor === undefined
    ? address.path
    : `${address.path}#${address.anchor}`;
}

function addressKey(
  address: ContentAddress,
): string | undefined {
  const pathInspection = inspectCanonicalRoutePath(address.path);
  if (!pathInspection.valid) {
    return undefined;
  }
  if (address.anchor === undefined) {
    return JSON.stringify([address.path]);
  }
  const fragmentInspection = inspectCanonicalUrlFragment(address.anchor);
  if (!fragmentInspection.valid) {
    return undefined;
  }
  return JSON.stringify([address.path, fragmentInspection.decoded]);
}

function frozenMatch(
  work: ReaderWork,
  section: ReaderSection,
): ReaderSectionMatch {
  return Object.freeze({ work, section });
}

function frozenBlockMatch(
  work: ReaderWork,
  section: ReaderSection,
  block: ReaderBlock,
): ReaderBlockMatch {
  return Object.freeze({ work, section, block });
}

function failRuntime(
  diagnostics: readonly Diagnostic[],
): ValidationResult<PublicationReaderRuntime> {
  return immutableSnapshot({
    valid: false,
    diagnostics: sortDiagnostics(diagnostics),
  });
}

function pushCanonicalPathDiagnostic(
  value: string,
  path: string,
  diagnostics: Diagnostic[],
): boolean {
  const inspection = inspectCanonicalRoutePath(value);
  if (inspection.valid) {
    return true;
  }
  diagnostics.push(
    diagnostic(
      "reader.runtime.route_path_invalid",
      path,
      "The route path is not in the canonical browser and host serialization.",
      "canonicalRoutePath",
      { issue: inspection.issue, value },
    ),
  );
  return false;
}

function pushCanonicalFragmentDiagnostic(
  value: string,
  path: string,
  diagnostics: Diagnostic[],
): boolean {
  const inspection = inspectCanonicalUrlFragment(value);
  if (inspection.valid) {
    return true;
  }
  diagnostics.push(
    diagnostic(
      "reader.runtime.fragment_invalid",
      path,
      "The URL fragment cannot be decoded into a portable reader address.",
      "canonicalUrlFragment",
      { issue: inspection.issue, value },
    ),
  );
  return false;
}

function pushAbsoluteHttpUrlDiagnostic(
  value: string,
  path: string,
  diagnostics: Diagnostic[],
): boolean {
  const inspection = inspectAbsoluteHttpUrl(value);
  if (inspection.valid) {
    return true;
  }
  diagnostics.push(
    diagnostic(
      "reader.runtime.absolute_http_url_invalid",
      path,
      "The URL must be an absolute HTTP or HTTPS URL with a valid host and no embedded credentials.",
      "absoluteHttpUrl",
      { issue: inspection.issue, value },
    ),
  );
  return false;
}

function expectDerivedValue(
  actual: unknown,
  expected: unknown,
  path: string,
  label: string,
  diagnostics: Diagnostic[],
): void {
  if (jsonEqual(actual, expected)) {
    return;
  }
  diagnostics.push(
    diagnostic(
      "reader.runtime.derived_value_mismatch",
      path,
      `${label} does not match the reader envelope relationships.`,
      "derivedValue",
      { actual, expected },
    ),
  );
}

function calculateReadingMinutes(
  wordCount: number,
  wordsPerMinute: number,
): number {
  return wordCount === 0 ? 0 : Math.ceil(wordCount / wordsPerMinute);
}

function splitsSurrogatePair(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) {
    return false;
  }
  const previous = value.charCodeAt(offset - 1);
  const current = value.charCodeAt(offset);
  return (
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff
  );
}

function addUniqueEntity<T>(
  target: Map<string, T>,
  id: string,
  value: T,
  path: string,
  code: string,
  label: string,
  diagnostics: Diagnostic[],
): void {
  if (target.has(id)) {
    diagnostics.push(
      diagnostic(
        code,
        path,
        `${label} "${id}" appears more than once.`,
        "uniqueId",
        { id },
      ),
    );
    return;
  }
  target.set(id, value);
}

function sameSectionMatch(
  left: ReaderSectionMatch,
  right: ReaderSectionMatch,
): boolean {
  return (
    left.work.id === right.work.id &&
    left.section.id === right.section.id
  );
}

function sameContentTarget(
  left: IndexedContentTarget,
  right: IndexedContentTarget,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "section" && right.kind === "section") {
    return sameSectionMatch(left.match, right.match);
  }
  if (left.kind === "block" && right.kind === "block") {
    return (
      sameSectionMatch(left.match, right.match) &&
      left.match.block.id === right.match.block.id
    );
  }
  return false;
}

function registerContinuityIdentity(
  indexes: RuntimeIndexes,
  identity: string,
  owner: ReaderSectionMatch,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const firstOwner = indexes.continuityOwnerById.get(identity);
  if (firstOwner === undefined) {
    indexes.continuityOwnerById.set(identity, owner);
    return;
  }
  if (sameSectionMatch(firstOwner, owner)) {
    return;
  }
  diagnostics.push(
    diagnostic(
      "reader.runtime.continuity_identity_collision",
      path,
      `Continuity identity "${identity}" belongs to more than one section.`,
      "uniqueContinuityOwner",
      {
        identity,
        firstOwner: {
          workId: firstOwner.work.id,
          sectionId: firstOwner.section.id,
        },
        duplicateOwner: {
          workId: owner.work.id,
          sectionId: owner.section.id,
        },
      },
    ),
  );
}

function validateContinuity(
  indexes: RuntimeIndexes,
  match: ReaderSectionMatch,
  sectionPointer: string,
  diagnostics: Diagnostic[],
): void {
  const continuity = match.section.continuity;
  const primaryAndLegacy = new Set<string>();
  const addLineageIdentity = (identity: string, path: string): void => {
    if (primaryAndLegacy.has(identity)) {
      diagnostics.push(
        diagnostic(
          "reader.runtime.continuity_id_duplicate",
          path,
          `Continuity identity "${identity}" repeats within one section lineage.`,
          "uniqueContinuityId",
          { identity },
        ),
      );
      return;
    }
    primaryAndLegacy.add(identity);
  };

  addLineageIdentity(
    continuity.id,
    `${sectionPointer}/continuity/id`,
  );
  continuity.legacyIds.forEach((identity, index) => {
    addLineageIdentity(
      identity,
      `${sectionPointer}/continuity/legacyIds/${index}`,
    );
  });

  if (continuity.progressGroups.length === 0) {
    diagnostics.push(
      diagnostic(
        "reader.runtime.continuity_progress_groups_empty",
        `${sectionPointer}/continuity/progressGroups`,
        "A section lineage must declare at least one progress group.",
        "minItems",
        {},
      ),
    );
  }
  const usedProgressIds = new Set<string>();
  continuity.progressGroups.forEach((group, groupIndex) => {
    group.forEach((identity, identityIndex) => {
      const path =
        `${sectionPointer}/continuity/progressGroups/${groupIndex}/${identityIndex}`;
      if (!primaryAndLegacy.has(identity)) {
        diagnostics.push(
          diagnostic(
            "reader.runtime.continuity_progress_id_unowned",
            path,
            `Progress identity "${identity}" is not owned by this section lineage.`,
            "ownedContinuityId",
            { identity },
          ),
        );
      }
      if (usedProgressIds.has(identity)) {
        diagnostics.push(
          diagnostic(
            "reader.runtime.continuity_progress_id_duplicate",
            path,
            `Progress identity "${identity}" appears in more than one position.`,
            "uniqueProgressId",
            { identity },
          ),
        );
      }
      usedProgressIds.add(identity);
    });
  });
  if (!usedProgressIds.has(continuity.id)) {
    diagnostics.push(
      diagnostic(
        "reader.runtime.continuity_primary_progress_missing",
        `${sectionPointer}/continuity/progressGroups`,
        `Primary continuity identity "${continuity.id}" has no progress group.`,
        "primaryProgressId",
        { identity: continuity.id },
      ),
    );
  }

  registerContinuityIdentity(
    indexes,
    match.section.id,
    match,
    `${sectionPointer}/id`,
    diagnostics,
  );
  registerContinuityIdentity(
    indexes,
    continuity.id,
    match,
    `${sectionPointer}/continuity/id`,
    diagnostics,
  );
  continuity.legacyIds.forEach((identity, index) => {
    registerContinuityIdentity(
      indexes,
      identity,
      match,
      `${sectionPointer}/continuity/legacyIds/${index}`,
      diagnostics,
    );
  });
  continuity.historicalSectionIds.forEach((identity, index) => {
    registerContinuityIdentity(
      indexes,
      identity,
      match,
      `${sectionPointer}/continuity/historicalSectionIds/${index}`,
      diagnostics,
    );
  });
}

function indexWorks(
  envelope: PublicationReaderEnvelope,
  indexes: RuntimeIndexes,
  diagnostics: Diagnostic[],
): void {
  const wordsPerMinute = envelope.statistics.wordsPerMinute;
  envelope.works.forEach((work, workIndex) => {
    const workPointer = `/works/${workIndex}`;
    addUniqueEntity(
      indexes.workById,
      work.id,
      work,
      `${workPointer}/id`,
      "reader.runtime.work_id_duplicate",
      "Work ID",
      diagnostics,
    );
    pushCanonicalPathDiagnostic(
      work.route,
      `${workPointer}/route`,
      diagnostics,
    );
    if (envelope.audience === "public" && work.publicationState === "draft") {
      diagnostics.push(
        diagnostic(
          "reader.runtime.public_draft_work",
          `${workPointer}/publicationState`,
          "A public reader envelope cannot contain a draft work.",
          "audienceVisibility",
          { workId: work.id },
        ),
      );
    }

    const sectionIndexById = new Map<string, number>();
    const childrenByParentId = new Map<string, string[]>();
    for (const [sectionIndex, section] of work.sections.entries()) {
      const firstIndex = sectionIndexById.get(section.id);
      if (firstIndex === undefined) {
        sectionIndexById.set(section.id, sectionIndex);
      } else {
        diagnostics.push(
          diagnostic(
            "reader.runtime.section_id_duplicate",
            `${workPointer}/sections/${sectionIndex}/id`,
            `Section ID "${section.id}" appears more than once in work "${work.id}".`,
            "uniqueSectionId",
            { firstIndex, duplicateIndex: sectionIndex, workId: work.id },
          ),
        );
      }
      if (section.parentId !== null) {
        const children = childrenByParentId.get(section.parentId) ?? [];
        children.push(section.id);
        childrenByParentId.set(section.parentId, children);
      }
    }

    const depthById = new Map<string, number>();
    const navigableIds = work.sections
      .filter(({ navigable }) => navigable)
      .map(({ id }) => id);
    const firstNavigablePositionById = new Map<string, number>();
    navigableIds.forEach((id, index) => {
      if (!firstNavigablePositionById.has(id)) {
        firstNavigablePositionById.set(id, index);
      }
    });
    work.sections.forEach((section, sectionIndex) => {
      const sectionPointer = `${workPointer}/sections/${sectionIndex}`;
      const match = frozenMatch(work, section);
      const key = locationKey(work.id, section.id);
      if (!indexes.sectionByLocation.has(key)) {
        indexes.sectionByLocation.set(key, match);
      }

      expectDerivedValue(
        section.order,
        sectionIndex,
        `${sectionPointer}/order`,
        "Section order",
        diagnostics,
      );
      const parentIndex =
        section.parentId === null
          ? undefined
          : sectionIndexById.get(section.parentId);
      if (
        section.parentId !== null &&
        (parentIndex === undefined || parentIndex >= sectionIndex)
      ) {
        diagnostics.push(
          diagnostic(
            "reader.runtime.section_parent_invalid",
            `${sectionPointer}/parentId`,
            `Section "${section.id}" does not have an earlier preorder parent.`,
            "preorderParent",
            {
              parentId: section.parentId,
              parentIndex,
              sectionIndex,
              workId: work.id,
            },
          ),
        );
      }
      const expectedDepth =
        section.parentId === null
          ? 0
          : (depthById.get(section.parentId) ?? -1) + 1;
      depthById.set(section.id, expectedDepth);
      expectDerivedValue(
        section.depth,
        expectedDepth,
        `${sectionPointer}/depth`,
        "Section depth",
        diagnostics,
      );
      expectDerivedValue(
        section.childIds,
        childrenByParentId.get(section.id) ?? [],
        `${sectionPointer}/childIds`,
        "Section child IDs",
        diagnostics,
      );

      validateContinuity(
        indexes,
        match,
        sectionPointer,
        diagnostics,
      );

      const blockIdFirstIndex = new Map<string, number>();
      section.blocks.forEach((block, blockIndex) => {
        const blockPointer = `${sectionPointer}/blocks/${blockIndex}`;
        const firstIndex = blockIdFirstIndex.get(block.id);
        if (firstIndex === undefined) {
          blockIdFirstIndex.set(block.id, blockIndex);
        } else {
          diagnostics.push(
            diagnostic(
              "reader.runtime.block_id_duplicate",
              `${blockPointer}/id`,
              `Block ID "${block.id}" appears more than once in section "${section.id}".`,
              "uniqueBlockId",
              {
                firstIndex,
                duplicateIndex: blockIndex,
                sectionId: section.id,
                workId: work.id,
              },
            ),
          );
        }
        const blockMatch = frozenBlockMatch(work, section, block);
        const blockKey = blockLocationKey(work.id, section.id, block.id);
        if (!indexes.blockByLocation.has(blockKey)) {
          indexes.blockByLocation.set(blockKey, blockMatch);
        }
        const sameHash = indexes.blocksByHash.get(block.contentHash) ?? [];
        sameHash.push(blockMatch);
        indexes.blocksByHash.set(block.contentHash, sameHash);
      });

      const expectedSectionWordCount = section.blocks.reduce(
        (total, block) => total + block.wordCount,
        0,
      );
      expectDerivedValue(
        section.wordCount,
        expectedSectionWordCount,
        `${sectionPointer}/wordCount`,
        "Section word count",
        diagnostics,
      );
      expectDerivedValue(
        section.readingMinutes,
        calculateReadingMinutes(expectedSectionWordCount, wordsPerMinute),
        `${sectionPointer}/readingMinutes`,
        "Section reading time",
        diagnostics,
      );

      const navigationIndex =
        firstNavigablePositionById.get(section.id) ?? -1;
      const expectedPrevious =
        section.navigable && navigationIndex > 0
          ? (navigableIds[navigationIndex - 1] ?? null)
          : null;
      const expectedNext =
        section.navigable &&
        navigationIndex >= 0 &&
        navigationIndex < navigableIds.length - 1
          ? (navigableIds[navigationIndex + 1] ?? null)
          : null;
      expectDerivedValue(
        section.previousId,
        expectedPrevious,
        `${sectionPointer}/previousId`,
        "Previous navigable section",
        diagnostics,
      );
      expectDerivedValue(
        section.nextId,
        expectedNext,
        `${sectionPointer}/nextId`,
        "Next navigable section",
        diagnostics,
      );
    });

    const expectedRootIds = work.sections
      .filter(({ parentId }) => parentId === null)
      .map(({ id }) => id);
    expectDerivedValue(
      work.rootSectionIds,
      expectedRootIds,
      `${workPointer}/rootSectionIds`,
      "Work root section IDs",
      diagnostics,
    );
    const expectedWorkWordCount = work.sections.reduce(
      (total, section) => total + section.wordCount,
      0,
    );
    expectDerivedValue(
      work.wordCount,
      expectedWorkWordCount,
      `${workPointer}/wordCount`,
      "Work word count",
      diagnostics,
    );
    expectDerivedValue(
      work.readingMinutes,
      calculateReadingMinutes(expectedWorkWordCount, wordsPerMinute),
      `${workPointer}/readingMinutes`,
      "Work reading time",
      diagnostics,
    );
  });
}

function indexCollections(
  envelope: PublicationReaderEnvelope,
  indexes: RuntimeIndexes,
  diagnostics: Diagnostic[],
): void {
  envelope.collections.forEach((collection, collectionIndex) => {
    const pointer = `/collections/${collectionIndex}`;
    addUniqueEntity(
      indexes.collectionById,
      collection.id,
      collection,
      `${pointer}/id`,
      "reader.runtime.collection_id_duplicate",
      "Collection ID",
      diagnostics,
    );
    pushCanonicalPathDiagnostic(
      collection.route,
      `${pointer}/route`,
      diagnostics,
    );
    if (
      envelope.audience === "public" &&
      collection.publicationState === "draft"
    ) {
      diagnostics.push(
        diagnostic(
          "reader.runtime.public_draft_collection",
          `${pointer}/publicationState`,
          "A public reader envelope cannot contain a draft collection.",
          "audienceVisibility",
          { collectionId: collection.id },
        ),
      );
    }
    collection.workIds.forEach((workId, workIndex) => {
      if (!indexes.workById.has(workId)) {
        diagnostics.push(
          diagnostic(
            "reader.runtime.collection_work_unknown",
            `${pointer}/workIds/${workIndex}`,
            `Collection "${collection.id}" references unknown work "${workId}".`,
            "knownWork",
            { collectionId: collection.id, workId },
          ),
        );
      }
    });
  });
}

function indexAssets(
  envelope: PublicationReaderEnvelope,
  indexes: RuntimeIndexes,
  diagnostics: Diagnostic[],
): void {
  const assetIndexByHref = new Map<string, number>();
  envelope.assets.forEach((asset, assetIndex) => {
    const pointer = `/assets/${assetIndex}`;
    addUniqueEntity(
      indexes.assetById,
      asset.id,
      asset,
      `${pointer}/id`,
      "reader.runtime.asset_id_duplicate",
      "Asset ID",
      diagnostics,
    );
    const firstHrefIndex = assetIndexByHref.get(asset.href);
    if (firstHrefIndex === undefined) {
      assetIndexByHref.set(asset.href, assetIndex);
    } else {
      diagnostics.push(
        diagnostic(
          "reader.runtime.asset_href_duplicate",
          `${pointer}/href`,
          `Asset href "${asset.href}" appears more than once.`,
          "uniqueAssetHref",
          { firstIndex: firstHrefIndex, duplicateIndex: assetIndex },
        ),
      );
    }
    pushCanonicalPathDiagnostic(
      asset.href,
      `${pointer}/href`,
      diagnostics,
    );
    if (
      asset.workId !== undefined &&
      !indexes.workById.has(asset.workId)
    ) {
      diagnostics.push(
        diagnostic(
          "reader.runtime.asset_work_unknown",
          `${pointer}/workId`,
          `Asset "${asset.id}" references unknown work "${asset.workId}".`,
          "knownWork",
          { assetId: asset.id, workId: asset.workId },
        ),
      );
    }
  });
}

function validateRouteTarget(
  route: ContentRoute,
  routeIndex: number,
  indexes: RuntimeIndexes,
  diagnostics: Diagnostic[],
): void {
  const pointer = `/routes/active/${routeIndex}/target`;
  switch (route.target.kind) {
    case "home":
    case "updates":
      return;
    case "work":
      if (!indexes.workById.has(route.target.workId)) {
        diagnostics.push(
          diagnostic(
            "reader.runtime.route_work_unknown",
            pointer,
            `Active route references unknown work "${route.target.workId}".`,
            "knownRouteTarget",
            { workId: route.target.workId },
          ),
        );
      }
      return;
    case "collection":
      if (!indexes.collectionById.has(route.target.collectionId)) {
        diagnostics.push(
          diagnostic(
            "reader.runtime.route_collection_unknown",
            pointer,
            `Active route references unknown collection "${route.target.collectionId}".`,
            "knownRouteTarget",
            { collectionId: route.target.collectionId },
          ),
        );
      }
      return;
    case "section": {
      const match = indexes.sectionByLocation.get(
        locationKey(route.target.workId, route.target.sectionId),
      );
      const address = match?.section.routes[route.target.routeName];
      if (
        match === undefined ||
        address === undefined ||
        address.anchor !== undefined ||
        address.path !== route.path ||
        !match.section.activeRouteNames.includes(route.target.routeName)
      ) {
        diagnostics.push(
          diagnostic(
            "reader.runtime.route_section_invalid",
            pointer,
            "Active section route does not match an owned unanchored section address.",
            "ownedActiveSectionRoute",
            { route },
          ),
        );
      }
    }
  }
}

function indexRoutes(
  envelope: PublicationReaderEnvelope,
  indexes: RuntimeIndexes,
  diagnostics: Diagnostic[],
): void {
  envelope.routes.active.forEach((route, routeIndex) => {
    const path = `/routes/active/${routeIndex}/path`;
    pushCanonicalPathDiagnostic(route.path, path, diagnostics);
    if (indexes.routeByPath.has(route.path)) {
      diagnostics.push(
        diagnostic(
          "reader.runtime.active_route_duplicate",
          path,
          `Active route "${route.path}" appears more than once.`,
          "uniqueActiveRoute",
          { route: route.path },
        ),
      );
    } else {
      indexes.routeByPath.set(route.path, route);
    }
    validateRouteTarget(route, routeIndex, indexes, diagnostics);
  });

  const homeRoutes = envelope.routes.active.filter(
    ({ target }) => target.kind === "home",
  );
  if (homeRoutes.length !== 1) {
    diagnostics.push(
      diagnostic(
        "reader.runtime.home_route_count",
        "/routes/active",
        "A reader envelope must contain exactly one home route.",
        "routeCardinality",
        { actual: homeRoutes.length, expected: 1 },
      ),
    );
  }
  const updateRoutes = envelope.routes.active.filter(
    ({ target }) => target.kind === "updates",
  );
  if (updateRoutes.length > 1) {
    diagnostics.push(
      diagnostic(
        "reader.runtime.updates_route_count",
        "/routes/active",
        "A reader envelope may contain at most one Updates route.",
        "routeCardinality",
        { actual: updateRoutes.length, maximum: 1 },
      ),
    );
  }

  const expected: ContentRoute[] = [];
  if (homeRoutes[0] !== undefined) {
    expected.push(homeRoutes[0]);
  }
  if (updateRoutes[0] !== undefined) {
    expected.push(updateRoutes[0]);
  }
  for (const work of envelope.works) {
    expected.push({
      path: work.route,
      target: { kind: "work", workId: work.id },
    });
    for (const section of work.sections) {
      for (const routeName of section.activeRouteNames) {
        const address = section.routes[routeName];
        if (address === undefined || address.anchor !== undefined) {
          continue;
        }
        expected.push({
          path: address.path,
          target: {
            kind: "section",
            workId: work.id,
            sectionId: section.id,
            routeName,
          },
        });
      }
    }
  }
  for (const collection of envelope.collections) {
    expected.push({
      path: collection.route,
      target: {
        kind: "collection",
        collectionId: collection.id,
      },
    });
  }
  expectDerivedValue(
    envelope.routes.active,
    expected,
    "/routes/active",
    "Active route registry",
    diagnostics,
  );
}

function registerContentAddress(
  indexes: RuntimeIndexes,
  address: ContentAddress,
  target: IndexedContentTarget,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const key = addressKey(address);
  if (key === undefined) {
    return;
  }
  const firstTarget = indexes.contentByAddress.get(key);
  if (firstTarget === undefined) {
    indexes.contentByAddress.set(key, target);
    return;
  }
  if (sameContentTarget(firstTarget, target)) {
    return;
  }
  diagnostics.push(
    diagnostic(
      "reader.runtime.content_address_collision",
      path,
      `Reader address "${formatAddress(address)}" belongs to more than one content target.`,
      "uniqueContentAddress",
      {
        address,
        firstKind: firstTarget.kind,
        duplicateKind: target.kind,
      },
    ),
  );
}

function validateSectionAddresses(
  envelope: PublicationReaderEnvelope,
  indexes: RuntimeIndexes,
  diagnostics: Diagnostic[],
): void {
  const hasAuthorizedUnanchoredOwner = (
    work: ReaderWork,
    section: ReaderSection,
    address: ContentAddress,
  ): boolean => {
    if (address.anchor !== undefined || address.path === work.route) {
      return true;
    }
    const routeOwner = indexes.routeByPath.get(address.path);
    return (
      routeOwner?.target.kind === "section" &&
      routeOwner.target.workId === work.id &&
      routeOwner.target.sectionId === section.id
    );
  };
  envelope.works.forEach((work, workIndex) => {
    work.sections.forEach((section, sectionIndex) => {
      const pointer = `/works/${workIndex}/sections/${sectionIndex}`;
      const match = indexes.sectionByLocation.get(
        locationKey(work.id, section.id),
      );
      if (match === undefined) {
        return;
      }

      for (const [routeName, address] of Object.entries(
        section.routes,
      ).sort(([left], [right]) => compareText(left, right))) {
        const addressPointer = `${pointer}/routes/${routeName}`;
        pushCanonicalPathDiagnostic(
          address.path,
          `${addressPointer}/path`,
          diagnostics,
        );
        if (address.anchor !== undefined) {
          pushCanonicalFragmentDiagnostic(
            address.anchor,
            `${addressPointer}/anchor`,
            diagnostics,
          );
        }
        if (!indexes.routeByPath.has(address.path)) {
          diagnostics.push(
            diagnostic(
              "reader.runtime.address_base_route_unknown",
              `${addressPointer}/path`,
              `Section address "${routeName}" has no active base route.`,
              "activeAddressBase",
              { address, routeName, sectionId: section.id, workId: work.id },
            ),
          );
        }
        if (!hasAuthorizedUnanchoredOwner(work, section, address)) {
          diagnostics.push(
            diagnostic(
              "reader.runtime.unanchored_address_owner_mismatch",
              addressPointer,
              `Unanchored section address "${routeName}" does not use its own work route or a server route owned by that section.`,
              "ownedUnanchoredAddress",
              {
                address,
                routeName,
                routeOwner: indexes.routeByPath.get(address.path) ?? null,
                sectionId: section.id,
                workId: work.id,
              },
            ),
          );
        }
        registerContentAddress(
          indexes,
          address,
          Object.freeze({
            kind: "section",
            match,
          }),
          addressPointer,
          diagnostics,
        );
      }

      for (const [activeIndex, routeName] of
        section.activeRouteNames.entries()) {
        const address = section.routes[routeName];
        if (address === undefined) {
          diagnostics.push(
            diagnostic(
              "reader.runtime.active_route_name_unknown",
              `${pointer}/activeRouteNames/${activeIndex}`,
              `Active route name "${routeName}" has no section address.`,
              "knownRouteName",
              { routeName },
            ),
          );
          continue;
        }
        if (address.anchor !== undefined) {
          diagnostics.push(
            diagnostic(
              "reader.runtime.active_route_anchored",
              `${pointer}/activeRouteNames/${activeIndex}`,
              `Anchored section address "${routeName}" cannot own a server route.`,
              "serverRoute",
              { address, routeName },
            ),
          );
        }
      }

      if (section.navigable && section.readerAddress === null) {
        diagnostics.push(
          diagnostic(
            "reader.runtime.reader_address_required",
            `${pointer}/readerAddress`,
            `Navigable section "${section.id}" has no reader address.`,
            "navigableReaderAddress",
            { sectionId: section.id, workId: work.id },
          ),
        );
      }
      const expectedSectionDomId =
        section.readerAddress?.anchor ?? null;
      expectDerivedValue(
        section.domId,
        expectedSectionDomId,
        `${pointer}/domId`,
        "Section DOM ID",
        diagnostics,
      );
      if (section.readerAddress !== null) {
        const address = section.readerAddress;
        pushCanonicalPathDiagnostic(
          address.path,
          `${pointer}/readerAddress/path`,
          diagnostics,
        );
        if (address.anchor !== undefined) {
          pushCanonicalFragmentDiagnostic(
            address.anchor,
            `${pointer}/readerAddress/anchor`,
            diagnostics,
          );
        }
        const usesWorkRoute =
          address.path === work.route && address.anchor === undefined;
        const usesNamedAddress = Object.values(section.routes).some(
          (candidate) => sameAddress(candidate, address),
        );
        if (!usesWorkRoute && !usesNamedAddress) {
          diagnostics.push(
            diagnostic(
              "reader.runtime.reader_address_unowned",
              `${pointer}/readerAddress`,
              `Reader address for section "${section.id}" is not owned by that section.`,
              "ownedReaderAddress",
              { address, sectionId: section.id, workId: work.id },
            ),
          );
        }
        if (!indexes.routeByPath.has(address.path)) {
          diagnostics.push(
            diagnostic(
              "reader.runtime.reader_address_base_route_unknown",
              `${pointer}/readerAddress/path`,
              "A reader address must use an active server route as its base.",
              "activeReaderAddressBase",
              { address, sectionId: section.id, workId: work.id },
            ),
          );
        }
        registerContentAddress(
          indexes,
          address,
          Object.freeze({
            kind: "section",
            match,
          }),
          `${pointer}/readerAddress`,
          diagnostics,
        );
      }

      section.blocks.forEach((block, blockIndex) => {
        const blockPointer = `${pointer}/blocks/${blockIndex}`;
        const blockMatch = indexes.blockByLocation.get(
          blockLocationKey(work.id, section.id, block.id),
        );
        if (section.readerAddress === null) {
          expectDerivedValue(
            block.readerAddress,
            null,
            `${blockPointer}/readerAddress`,
            "Block reader address",
            diagnostics,
          );
          expectDerivedValue(
            block.domId,
            null,
            `${blockPointer}/domId`,
            "Block DOM ID",
            diagnostics,
          );
          return;
        }
        if (block.readerAddress === null) {
          diagnostics.push(
            diagnostic(
              "reader.runtime.block_reader_address_required",
              `${blockPointer}/readerAddress`,
              `Block "${block.id}" is missing its derived reader address.`,
              "derivedBlockAddress",
              { blockId: block.id, sectionId: section.id, workId: work.id },
            ),
          );
          return;
        }

        const blockAddress = block.readerAddress;
        pushCanonicalPathDiagnostic(
          blockAddress.path,
          `${blockPointer}/readerAddress/path`,
          diagnostics,
        );
        if (blockAddress.anchor !== undefined) {
          pushCanonicalFragmentDiagnostic(
            blockAddress.anchor,
            `${blockPointer}/readerAddress/anchor`,
            diagnostics,
          );
        }
        if (
          blockAddress.path !== section.readerAddress.path ||
          blockAddress.anchor === undefined
        ) {
          diagnostics.push(
            diagnostic(
              "reader.runtime.block_reader_address_invalid",
              `${blockPointer}/readerAddress`,
              `Block "${block.id}" does not share its section reader route and a concrete anchor.`,
              "derivedBlockAddress",
              {
                blockAddress,
                sectionAddress: section.readerAddress,
              },
            ),
          );
        } else if (section.readerAddress.anchor !== undefined) {
          const prefix = `${section.readerAddress.anchor}-`;
          const suffix = blockAddress.anchor.startsWith(prefix)
            ? blockAddress.anchor.slice(prefix.length)
            : "";
          if (!isContentReference(suffix)) {
            diagnostics.push(
              diagnostic(
                "reader.runtime.block_reader_anchor_invalid",
                `${blockPointer}/readerAddress/anchor`,
                `Block "${block.id}" anchor is not derived from its qualified section anchor.`,
                "derivedBlockAnchor",
                {
                  actual: blockAddress.anchor,
                  sectionAnchor: section.readerAddress.anchor,
                },
              ),
            );
          }
        } else if (!isContentReference(blockAddress.anchor)) {
          diagnostics.push(
            diagnostic(
              "reader.runtime.block_reader_anchor_invalid",
              `${blockPointer}/readerAddress/anchor`,
              `Block "${block.id}" anchor is not a portable unqualified content ID.`,
              "derivedBlockAnchor",
              {
                actual: blockAddress.anchor,
                sectionAnchor: null,
              },
            ),
          );
        }
        expectDerivedValue(
          block.domId,
          blockAddress.anchor ?? null,
          `${blockPointer}/domId`,
          "Block DOM ID",
          diagnostics,
        );
        if (blockMatch !== undefined) {
          registerContentAddress(
            indexes,
            blockAddress,
            Object.freeze({
              kind: "block",
              match: blockMatch,
            }),
            `${blockPointer}/readerAddress`,
            diagnostics,
          );
        }
      });
    });
  });
}

function validateAssetAuthority(
  envelope: PublicationReaderEnvelope,
  indexes: RuntimeIndexes,
  diagnostics: Diagnostic[],
): void {
  envelope.assets.forEach((asset, index) => {
    const activeRoute = indexes.routeByPath.get(asset.href);
    if (activeRoute !== undefined) {
      diagnostics.push(
        diagnostic(
          "reader.runtime.asset_route_collision",
          `/assets/${index}/href`,
          `Asset href "${asset.href}" collides with an active route.`,
          "disjointPublicTargets",
          { route: activeRoute },
        ),
      );
    }
  });
}

function validateInternalHref(
  href: string,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!href.startsWith("/")) {
    return;
  }
  const separator = href.indexOf("#");
  const route = separator < 0 ? href : href.slice(0, separator);
  const fragment = separator < 0 ? undefined : href.slice(separator + 1);
  pushCanonicalPathDiagnostic(route, path, diagnostics);
  if (fragment !== undefined) {
    pushCanonicalFragmentDiagnostic(fragment, path, diagnostics);
  }
}

function expectedLinkHref(
  link: ReaderLink,
  indexes: RuntimeIndexes,
): string | undefined {
  switch (link.target.kind) {
    case "external":
      return link.target.url;
    case "asset":
      return indexes.assetById.get(link.target.assetId)?.href;
    case "collection":
      return indexes.collectionById.get(link.target.collectionId)?.route;
    case "work":
      return indexes.workById.get(link.target.workId)?.route;
    case "section": {
      const section = indexes.sectionByLocation.get(
        locationKey(link.target.workId, link.target.sectionId),
      )?.section;
      const address = section?.routes[link.target.routeName];
      return address === undefined ? undefined : formatAddress(address);
    }
  }
}

function indexAndValidateLinks(
  envelope: PublicationReaderEnvelope,
  indexes: RuntimeIndexes,
  diagnostics: Diagnostic[],
): void {
  const firstIndexById = new Map<string, number>();
  envelope.links.forEach((link, linkIndex) => {
    const pointer = `/links/${linkIndex}`;
    const firstIndex = firstIndexById.get(link.id);
    if (firstIndex === undefined) {
      firstIndexById.set(link.id, linkIndex);
    } else {
      diagnostics.push(
        diagnostic(
          "reader.runtime.link_id_duplicate",
          `${pointer}/id`,
          `Link ID "${link.id}" appears more than once.`,
          "uniqueLinkId",
          { firstIndex, duplicateIndex: linkIndex },
        ),
      );
    }

    const sectionMatch = indexes.sectionByLocation.get(
      locationKey(link.source.workId, link.source.sectionId),
    );
    if (sectionMatch === undefined) {
      diagnostics.push(
        diagnostic(
          "reader.runtime.link_source_unknown",
          `${pointer}/source`,
          `Link "${link.id}" references an unknown source section.`,
          "knownContentLocation",
          { source: link.source },
        ),
      );
    }
    const blockMatch =
      link.source.blockId === undefined
        ? undefined
        : indexes.blockByLocation.get(
            blockLocationKey(
              link.source.workId,
              link.source.sectionId,
              link.source.blockId,
            ),
          );
    if (link.source.blockId !== undefined && blockMatch === undefined) {
      diagnostics.push(
        diagnostic(
          "reader.runtime.link_source_block_unknown",
          `${pointer}/source/blockId`,
          `Link "${link.id}" references an unknown source block.`,
          "knownContentLocation",
          { blockId: link.source.blockId },
        ),
      );
    }
    if (link.source.kind === "block-markdown" && blockMatch !== undefined) {
      const { start, end } = link.source.range;
      const markdown = blockMatch.block.markdown;
      if (
        end <= start ||
        end > markdown.length ||
        splitsSurrogatePair(markdown, start) ||
        splitsSurrogatePair(markdown, end)
      ) {
        diagnostics.push(
          diagnostic(
            "reader.runtime.link_markdown_range_invalid",
            `${pointer}/source/range`,
            `Link "${link.id}" does not occupy a valid UTF-16 range in its block Markdown.`,
            "blockMarkdownRange",
            {
              blockId: blockMatch.block.id,
              end,
              markdownLength: markdown.length,
              start,
            },
          ),
        );
      }
    }

    if (link.target.kind === "external") {
      pushAbsoluteHttpUrlDiagnostic(
        link.target.url,
        `${pointer}/target/url`,
        diagnostics,
      );
    }
    if (!link.href.startsWith("/")) {
      pushAbsoluteHttpUrlDiagnostic(
        link.href,
        `${pointer}/href`,
        diagnostics,
      );
    }
    validateInternalHref(link.href, `${pointer}/href`, diagnostics);
    const expectedHref = expectedLinkHref(link, indexes);
    if (expectedHref === undefined) {
      diagnostics.push(
        diagnostic(
          "reader.runtime.link_target_unknown",
          `${pointer}/target`,
          `Link "${link.id}" references an unknown target.`,
          "knownLinkTarget",
          { target: link.target },
        ),
      );
    } else {
      expectDerivedValue(
        link.href,
        expectedHref,
        `${pointer}/href`,
        "Resolved link href",
        diagnostics,
      );
    }
  });
}

type ParsedInternalHref =
  | {
      readonly valid: true;
      readonly address: ContentAddress;
    }
  | {
      readonly valid: false;
    };

function parseInternalHref(value: string): ParsedInternalHref {
  const separator = value.indexOf("#");
  const path = separator < 0 ? value : value.slice(0, separator);
  const pathInspection = inspectCanonicalRoutePath(path);
  if (!pathInspection.valid) {
    return { valid: false };
  }
  if (separator < 0) {
    return { valid: true, address: { path } };
  }
  const anchor = value.slice(separator + 1);
  const fragmentInspection = inspectCanonicalUrlFragment(anchor);
  if (!fragmentInspection.valid) {
    return { valid: false };
  }
  return { valid: true, address: { path, anchor } };
}

function validateRedirects(
  envelope: PublicationReaderEnvelope,
  indexes: RuntimeIndexes,
  diagnostics: Diagnostic[],
): void {
  const redirectBySource = new Map<
    string,
    PublicationReaderEnvelope["routes"]["redirects"][number]
  >();
  const redirectIndexBySource = new Map<string, number>();
  const assetHrefSet = new Set(envelope.assets.map(({ href }) => href));

  envelope.routes.redirects.forEach((redirect, redirectIndex) => {
    const pointer = `/routes/redirects/${redirectIndex}`;
    pushCanonicalPathDiagnostic(
      redirect.from,
      `${pointer}/from`,
      diagnostics,
    );
    const firstIndex = redirectIndexBySource.get(redirect.from);
    if (firstIndex === undefined) {
      redirectIndexBySource.set(redirect.from, redirectIndex);
      redirectBySource.set(redirect.from, redirect);
    } else {
      diagnostics.push(
        diagnostic(
          "reader.runtime.redirect_source_duplicate",
          `${pointer}/from`,
          `Redirect source "${redirect.from}" appears more than once.`,
          "uniqueRedirectSource",
          { firstIndex, duplicateIndex: redirectIndex },
        ),
      );
    }
    if (indexes.routeByPath.has(redirect.from)) {
      diagnostics.push(
        diagnostic(
          "reader.runtime.redirect_active_route_collision",
          `${pointer}/from`,
          `Redirect source "${redirect.from}" collides with an active route.`,
          "inactiveRedirectSource",
          { source: redirect.from },
        ),
      );
    }
    if (assetHrefSet.has(redirect.from)) {
      diagnostics.push(
        diagnostic(
          "reader.runtime.redirect_asset_collision",
          `${pointer}/from`,
          `Redirect source "${redirect.from}" collides with an asset href.`,
          "disjointPublicTargets",
          { source: redirect.from },
        ),
      );
    }
    if (!redirect.to.startsWith("/")) {
      pushAbsoluteHttpUrlDiagnostic(
        redirect.to,
        `${pointer}/to`,
        diagnostics,
      );
    }
    validateInternalHref(redirect.to, `${pointer}/to`, diagnostics);
  });

  type Resolution = "active" | "cycle" | "external" | "unresolved";
  const memo = new Map<string, Resolution>();
  const resolve = (start: string): Resolution => {
    const visited: string[] = [];
    const visitedIndex = new Map<string, number>();
    let cursor = start;
    let resolution: Resolution | undefined;
    while (resolution === undefined) {
      if (indexes.routeByPath.has(cursor)) {
        resolution = "active";
        break;
      }
      const cached = memo.get(cursor);
      if (cached !== undefined) {
        resolution = cached;
        break;
      }
      if (visitedIndex.has(cursor)) {
        resolution = "cycle";
        break;
      }
      visitedIndex.set(cursor, visited.length);
      visited.push(cursor);
      const redirect = redirectBySource.get(cursor);
      if (redirect === undefined) {
        resolution = "unresolved";
        break;
      }
      if (!redirect.to.startsWith("/")) {
        resolution = "external";
        break;
      }
      const parsed = parseInternalHref(redirect.to);
      if (!parsed.valid) {
        resolution = "unresolved";
        break;
      }
      if (parsed.address.anchor !== undefined) {
        const key = addressKey(parsed.address);
        resolution =
          indexes.routeByPath.has(parsed.address.path) &&
          key !== undefined &&
          indexes.contentByAddress.has(key)
            ? "active"
            : "unresolved";
        break;
      }
      cursor = parsed.address.path;
    }
    for (const path of visited) {
      memo.set(path, resolution);
    }
    return resolution;
  };

  envelope.routes.redirects.forEach((redirect, redirectIndex) => {
    if (!redirect.to.startsWith("/")) {
      return;
    }
    const parsed = parseInternalHref(redirect.to);
    const resolution =
      parsed.valid && parsed.address.anchor !== undefined
        ? (
            indexes.routeByPath.has(parsed.address.path) &&
            indexes.contentByAddress.has(addressKey(parsed.address) ?? "")
              ? "active"
              : "unresolved"
          )
        : parsed.valid
          ? resolve(parsed.address.path)
          : "unresolved";
    if (resolution === "active" || resolution === "external") {
      return;
    }
    diagnostics.push(
      diagnostic(
        resolution === "cycle"
          ? "reader.runtime.redirect_cycle"
          : "reader.runtime.redirect_target_unresolved",
        `/routes/redirects/${redirectIndex}/to`,
        resolution === "cycle"
          ? `Redirect chain from "${redirect.from}" contains a cycle.`
          : `Redirect chain from "${redirect.from}" has no retained active or external target.`,
        resolution === "cycle"
          ? "acyclicRedirects"
          : "resolvedRedirect",
        { source: redirect.from, target: redirect.to },
      ),
    );
  });
}

function validateEnvelopeIdentity(
  envelope: PublicationReaderEnvelope,
  diagnostics: Diagnostic[],
): void {
  expectDerivedValue(
    envelope.publicationId,
    envelope.publication.id,
    "/publicationId",
    "Publication ID",
    diagnostics,
  );
  expectDerivedValue(
    envelope.source.publicationId,
    envelope.publicationId,
    "/source/publicationId",
    "Source publication ID",
    diagnostics,
  );
  expectDerivedValue(
    envelope.source.engineVersion,
    envelope.engineVersion,
    "/source/engineVersion",
    "Source engine version",
    diagnostics,
  );
  if (envelope.publication.canonicalUrl !== undefined) {
    pushAbsoluteHttpUrlDiagnostic(
      envelope.publication.canonicalUrl,
      "/publication/canonicalUrl",
      diagnostics,
    );
  }
  if (envelope.publication.publisher.url !== undefined) {
    pushAbsoluteHttpUrlDiagnostic(
      envelope.publication.publisher.url,
      "/publication/publisher/url",
      diagnostics,
    );
  }
  pushAbsoluteHttpUrlDiagnostic(
    envelope.publication.attribution.sourceCodeUrl,
    "/publication/attribution/sourceCodeUrl",
    diagnostics,
  );
}

function validateStatistics(
  envelope: PublicationReaderEnvelope,
  diagnostics: Diagnostic[],
): void {
  const sectionCount = envelope.works.reduce(
    (total, work) => total + work.sections.length,
    0,
  );
  const blockCount = envelope.works.reduce(
    (total, work) =>
      total +
      work.sections.reduce(
        (sectionTotal, section) =>
          sectionTotal + section.blocks.length,
        0,
      ),
    0,
  );
  const wordCount = envelope.works.reduce(
    (total, work) => total + work.wordCount,
    0,
  );
  const expected = {
    workCount: envelope.works.length,
    collectionCount: envelope.collections.length,
    sectionCount,
    blockCount,
    wordCount,
    readingMinutes: calculateReadingMinutes(
      wordCount,
      envelope.statistics.wordsPerMinute,
    ),
    wordsPerMinute: envelope.statistics.wordsPerMinute,
  };
  expectDerivedValue(
    envelope.statistics,
    expected,
    "/statistics",
    "Reader statistics",
    diagnostics,
  );
}

function buildIndexes(
  envelope: PublicationReaderEnvelope,
  diagnostics: Diagnostic[],
): RuntimeIndexes {
  const indexes: RuntimeIndexes = {
    workById: new Map(),
    collectionById: new Map(),
    sectionByLocation: new Map(),
    blockByLocation: new Map(),
    continuityOwnerById: new Map(),
    routeByPath: new Map(),
    contentByAddress: new Map(),
    blocksByHash: new Map(),
    assetById: new Map(),
  };

  validateEnvelopeIdentity(envelope, diagnostics);
  indexWorks(envelope, indexes, diagnostics);
  indexCollections(envelope, indexes, diagnostics);
  indexAssets(envelope, indexes, diagnostics);
  indexRoutes(envelope, indexes, diagnostics);
  validateSectionAddresses(envelope, indexes, diagnostics);
  validateAssetAuthority(envelope, indexes, diagnostics);
  indexAndValidateLinks(envelope, indexes, diagnostics);
  validateRedirects(envelope, indexes, diagnostics);
  validateStatistics(envelope, diagnostics);
  return indexes;
}

function parseSectionReference(
  value: unknown,
): ReaderSectionReference | undefined {
  const snapshot = snapshotStrictDataRecord(value, [
    "workId",
    "sectionId",
  ]);
  if (!snapshot.valid) {
    return undefined;
  }
  const workId = snapshot.values.get("workId");
  const sectionId = snapshot.values.get("sectionId");
  if (!isStableReference(workId) || !isContentReference(sectionId)) {
    return undefined;
  }
  return { workId, sectionId };
}

function parseBlockReference(
  value: unknown,
): ReaderBlockReference | undefined {
  const snapshot = snapshotStrictDataRecord(value, [
    "workId",
    "sectionId",
    "blockId",
  ]);
  if (!snapshot.valid) {
    return undefined;
  }
  const workId = snapshot.values.get("workId");
  const sectionId = snapshot.values.get("sectionId");
  const blockId = snapshot.values.get("blockId");
  if (
    !isStableReference(workId) ||
    !isContentReference(sectionId) ||
    !isContentReference(blockId)
  ) {
    return undefined;
  }
  return { workId, sectionId, blockId };
}

function parseCollectionWorkReference(
  value: unknown,
): ReaderCollectionWorkReference | undefined {
  const snapshot = snapshotStrictDataRecord(value, [
    "collectionId",
    "workId",
  ]);
  if (!snapshot.valid) {
    return undefined;
  }
  const collectionId = snapshot.values.get("collectionId");
  const workId = snapshot.values.get("workId");
  if (!isStableReference(collectionId) || !isStableReference(workId)) {
    return undefined;
  }
  return { collectionId, workId };
}

function createLookup<T>(value: T | undefined): ReaderLookup<T> {
  return value === undefined
    ? LOOKUP_NOT_FOUND
    : Object.freeze({ status: "found", value });
}

type InvalidAddressResolution = Extract<
  ReaderAddressResolution,
  { readonly status: "invalid" }
>;

function parseRequestedAddress(
  value: unknown,
): InvalidAddressResolution | ReaderAddress {
  const snapshot = snapshotStrictDataRecord(value, ["path", "anchor"]);
  if (!snapshot.valid) {
    return Object.freeze({
      status: "invalid",
      component: snapshot.invalidKey === "anchor" ? "anchor" : "path",
      issue: "type",
    });
  }
  const path = snapshot.values.get("path");
  const pathInspection = inspectCanonicalRoutePath(path);
  if (!pathInspection.valid) {
    return Object.freeze({
      status: "invalid",
      component: "path",
      issue: pathInspection.issue,
    });
  }
  const candidateAnchor = snapshot.values.get("anchor");
  if (
    candidateAnchor === ABSENT ||
    candidateAnchor === undefined
  ) {
    return Object.freeze({ path: pathInspection.value });
  }
  const fragmentInspection = inspectCanonicalUrlFragment(candidateAnchor);
  if (!fragmentInspection.valid) {
    return Object.freeze({
      status: "invalid",
      component: "anchor",
      issue: fragmentInspection.issue,
    });
  }
  return Object.freeze({
    path: pathInspection.value,
    anchor: fragmentInspection.value,
  });
}

function isInvalidAddressResult(
  value: InvalidAddressResolution | ReaderAddress,
): value is InvalidAddressResolution {
  return "status" in value;
}

function createRuntime(
  envelope: PublicationReaderEnvelope,
  indexes: RuntimeIndexes,
): PublicationReaderRuntime {
  const lookupWork = (id: string): ReaderLookup<ReaderWork> => {
    try {
      return isStableReference(id)
        ? createLookup(indexes.workById.get(id))
        : LOOKUP_INVALID;
    } catch {
      return LOOKUP_INVALID;
    }
  };

  const lookupCollection = (
    id: string,
  ): ReaderLookup<ReaderCollection> => {
    try {
      return isStableReference(id)
        ? createLookup(indexes.collectionById.get(id))
        : LOOKUP_INVALID;
    } catch {
      return LOOKUP_INVALID;
    }
  };

  const lookupSection = (
    value: ReaderSectionReference,
  ): ReaderLookup<ReaderSectionMatch> => {
    try {
      const reference = parseSectionReference(value);
      return reference === undefined
        ? LOOKUP_INVALID
        : createLookup(
            indexes.sectionByLocation.get(
              locationKey(reference.workId, reference.sectionId),
            ),
          );
    } catch {
      return LOOKUP_INVALID;
    }
  };

  const lookupBlock = (
    value: ReaderBlockReference,
  ): ReaderLookup<ReaderBlockMatch> => {
    try {
      const reference = parseBlockReference(value);
      return reference === undefined
        ? LOOKUP_INVALID
        : createLookup(
            indexes.blockByLocation.get(
              blockLocationKey(
                reference.workId,
                reference.sectionId,
                reference.blockId,
              ),
            ),
          );
    } catch {
      return LOOKUP_INVALID;
    }
  };

  const lookupContinuityOwner = (
    identity: string,
  ): ReaderLookup<ReaderSectionMatch> => {
    try {
      return isContentReference(identity)
        ? createLookup(indexes.continuityOwnerById.get(identity))
        : LOOKUP_INVALID;
    } catch {
      return LOOKUP_INVALID;
    }
  };

  const resolveAddress = (
    value: ReaderAddress,
  ): ReaderAddressResolution => {
    try {
      const requestedAddress = parseRequestedAddress(value);
      if (isInvalidAddressResult(requestedAddress)) {
        return requestedAddress;
      }
      const baseRoute =
        indexes.routeByPath.get(requestedAddress.path) ?? null;
      if (baseRoute === null) {
        return Object.freeze({
          status: "not-found",
          requestedAddress,
          baseRoute: null,
        });
      }
      const key = addressKey(requestedAddress);
      const indexedContent =
        key === undefined ? undefined : indexes.contentByAddress.get(key);
      if (
        requestedAddress.anchor !== undefined &&
        indexedContent === undefined
      ) {
        return Object.freeze({
          status: "not-found",
          requestedAddress,
          baseRoute,
        });
      }
      const content =
        indexedContent === undefined
          ? null
          : Object.freeze({
              ...indexedContent,
              matchedAddress: requestedAddress,
            });
      return Object.freeze({
        status: "resolved",
        requestedAddress,
        route: baseRoute,
        content,
      });
    } catch {
      return Object.freeze({
        status: "invalid",
        component: "path",
        issue: "type",
      });
    }
  };

  const sectionNavigation = (
    value: ReaderSectionReference,
  ): ReaderSectionNavigation => {
    try {
      const reference = parseSectionReference(value);
      if (reference === undefined) {
        return INVALID_REFERENCE;
      }
      const current = indexes.sectionByLocation.get(
        locationKey(reference.workId, reference.sectionId),
      );
      if (current === undefined) {
        return SECTION_NOT_FOUND;
      }
      if (!current.section.navigable) {
        return SECTION_NOT_NAVIGABLE;
      }
      const previous =
        current.section.previousId === null
          ? null
          : (
              indexes.sectionByLocation.get(
                locationKey(
                  current.work.id,
                  current.section.previousId,
                ),
              ) ?? null
            );
      const next =
        current.section.nextId === null
          ? null
          : (
              indexes.sectionByLocation.get(
                locationKey(current.work.id, current.section.nextId),
              ) ?? null
            );
      return Object.freeze({
        status: "resolved",
        current,
        previous,
        next,
      });
    } catch {
      return INVALID_REFERENCE;
    }
  };

  const collectionWorkNavigation = (
    value: ReaderCollectionWorkReference,
  ): ReaderCollectionWorkNavigation => {
    try {
      const reference = parseCollectionWorkReference(value);
      if (reference === undefined) {
        return INVALID_REFERENCE;
      }
      const collection = indexes.collectionById.get(
        reference.collectionId,
      );
      if (collection === undefined) {
        return Object.freeze({ status: "collection-not-found" });
      }
      const current = indexes.workById.get(reference.workId);
      if (current === undefined) {
        return Object.freeze({ status: "work-not-found" });
      }
      const currentIndex = collection.workIds.indexOf(reference.workId);
      if (currentIndex < 0) {
        return Object.freeze({ status: "work-not-in-collection" });
      }
      const previousId = collection.workIds[currentIndex - 1];
      const nextId = collection.workIds[currentIndex + 1];
      const previous =
        previousId === undefined
          ? null
          : (indexes.workById.get(previousId) ?? null);
      const next =
        nextId === undefined
          ? null
          : (indexes.workById.get(nextId) ?? null);
      return Object.freeze({
        status: "resolved",
        collection,
        current,
        previous,
        next,
      });
    } catch {
      return INVALID_REFERENCE;
    }
  };

  const findBlockRelocations = (
    value: ReaderBlockRelocationQuery,
  ): ReaderBlockRelocationResult => {
    try {
      const query = snapshotStrictDataRecord(value, [
        "contentHash",
        "scope",
      ]);
      if (!query.valid) {
        return Object.freeze({
          status: "invalid",
          reason:
            query.invalidKey === "contentHash" ? "hash" : "scope",
        });
      }
      const contentHash = query.values.get("contentHash");
      if (
        typeof contentHash !== "string" ||
        !SHA256_DIGEST.test(contentHash)
      ) {
        return Object.freeze({ status: "invalid", reason: "hash" });
      }
      const scope = snapshotStrictDataRecord(
        query.values.get("scope"),
        ["kind", "workId", "sectionId"],
      );
      if (!scope.valid) {
        return Object.freeze({ status: "invalid", reason: "scope" });
      }
      const kind = scope.values.get("kind");
      let candidates = indexes.blocksByHash.get(contentHash) ?? [];
      if (kind === "publication") {
        // Publication scope retains the source work, section, and block order.
      } else if (kind === "work") {
        const workId = scope.values.get("workId");
        if (
          !isStableReference(workId) ||
          !indexes.workById.has(workId)
        ) {
          return Object.freeze({ status: "invalid", reason: "scope" });
        }
        candidates = candidates.filter(
          (candidate) => candidate.work.id === workId,
        );
      } else if (kind === "section") {
        const workId = scope.values.get("workId");
        const sectionId = scope.values.get("sectionId");
        if (
          !isStableReference(workId) ||
          !isContentReference(sectionId) ||
          !indexes.sectionByLocation.has(
            locationKey(workId, sectionId),
          )
        ) {
          return Object.freeze({ status: "invalid", reason: "scope" });
        }
        candidates = candidates.filter(
          (candidate) =>
            candidate.work.id === workId &&
            candidate.section.id === sectionId,
        );
      } else {
        return Object.freeze({ status: "invalid", reason: "scope" });
      }
      if (candidates.length === 0) {
        return RELOCATION_NOT_FOUND;
      }
      return Object.freeze({
        status: "found",
        candidates: Object.freeze([...candidates]),
      });
    } catch {
      return Object.freeze({ status: "invalid", reason: "scope" });
    }
  };

  return Object.freeze({
    envelope,
    lookupWork,
    lookupCollection,
    lookupSection,
    lookupBlock,
    lookupContinuityOwner,
    resolveAddress,
    sectionNavigation,
    collectionWorkNavigation,
    findBlockRelocations,
  });
}

/**
 * Validates a serialized reader envelope and creates private browser indexes.
 *
 * This boundary verifies structural and relational integrity. The package root
 * performs the separate SHA-256 build identity check before publication.
 */
export function createPublicationReaderRuntime(
  value: unknown,
): ValidationResult<PublicationReaderRuntime> {
  try {
    const snapshot = immutableSnapshot(value);
    const shape = validateReaderEnvelopeShape(snapshot);
    if (!shape.valid) {
      return failRuntime(shape.diagnostics);
    }
    const envelope = shape.value;
    const diagnostics: Diagnostic[] = [];
    const indexes = buildIndexes(envelope, diagnostics);
    if (diagnostics.length > 0) {
      return failRuntime(diagnostics);
    }
    return Object.freeze({
      valid: true,
      value: createRuntime(envelope, indexes),
      diagnostics: EMPTY_DIAGNOSTICS,
    });
  } catch {
    return failRuntime([
      diagnostic(
        "reader.runtime.validation_failed",
        "",
        "Reader runtime creation could not safely inspect the supplied value.",
        "semanticValidation",
        { reason: "uninspectableEnvelope" },
      ),
    ]);
  }
}

export type {
  PublicationReaderRuntime,
  ReaderAddress,
  ReaderAddressResolution,
  ReaderBlockMatch,
  ReaderBlockReference,
  ReaderBlockRelocationQuery,
  ReaderBlockRelocationResult,
  ReaderCollectionWorkNavigation,
  ReaderCollectionWorkReference,
  ReaderContentTarget,
  ReaderLookup,
  ReaderRelocationScope,
  ReaderRoute,
  ReaderSectionMatch,
  ReaderSectionNavigation,
  ReaderSectionReference,
} from "./runtime-types.js";
