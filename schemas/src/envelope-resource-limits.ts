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

import { PUBLICATION_PROTOCOL_LIMITS } from "./protocol-limits.js";

export type PublicationEnvelopeKind = "content" | "generic" | "reader";

export interface EnvelopeResourceLimitViolation {
  readonly actualItems: number;
  readonly keyword: "maxItems" | "maxProperties" | "maximum";
  readonly maximumItems: number;
  readonly path: string;
  readonly resource: string;
}

export type EnvelopeSnapshotResult =
  | {
      readonly valid: true;
      readonly value: unknown;
      readonly violations: readonly EnvelopeResourceLimitViolation[];
    }
  | {
      readonly valid: false;
      readonly path: string;
      readonly reason:
        | "cyclicReference"
        | "resourceLimit"
        | "uninspectableEnvelope";
      readonly violations: readonly EnvelopeResourceLimitViolation[];
    };

type SnapshotContainer = Record<string, unknown> | unknown[];

interface SnapshotFrame {
  readonly depth: number;
  readonly exit?: boolean;
  readonly path: readonly string[];
  readonly snapshot: SnapshotContainer;
  readonly source: object;
}

interface ResourceCounter {
  actualItems: number;
  readonly maximumItems: number;
  readonly path: string;
  readonly resource: string;
}

const NUMERIC_PATH_TOKEN = /^(?:0|[1-9][0-9]*)$/;

function addBounded(left: number, right: number): number {
  return left > Number.MAX_SAFE_INTEGER - right
    ? Number.MAX_SAFE_INTEGER
    : left + right;
}

function isNumericPathToken(value: string | undefined): boolean {
  return value !== undefined && NUMERIC_PATH_TOKEN.test(value);
}

function pointer(path: readonly string[]): string {
  return path.length === 0
    ? ""
    : `/${path
        .map((token) => token.replaceAll("~", "~0").replaceAll("/", "~1"))
        .join("/")}`;
}

function resourceAtPath(
  kind: PublicationEnvelopeKind,
  path: readonly string[],
): {
  readonly maximumItems: number;
  readonly path: string;
  readonly resource: string;
} | undefined {
  const [root, firstIndex, nested, secondIndex, leaf] = path;
  if (path.length === 1) {
    switch (root) {
      case "sources":
        return kind === "content"
          ? {
              maximumItems:
                PUBLICATION_PROTOCOL_LIMITS.maximumCompilationSources,
              path: "/sources",
              resource: "sources",
            }
          : undefined;
      case "extensions":
        return kind === "content"
          ? {
              maximumItems: PUBLICATION_PROTOCOL_LIMITS.maximumExtensions,
              path: "/extensions",
              resource: "extensions",
            }
          : undefined;
      case "payloads":
        return kind === "content"
          ? {
              maximumItems: PUBLICATION_PROTOCOL_LIMITS.maximumPayloads,
              path: "/payloads",
              resource: "payloads",
            }
          : undefined;
      case "works":
        return {
          maximumItems: PUBLICATION_PROTOCOL_LIMITS.maximumWorks,
          path: "/works",
          resource: "works",
        };
      case "collections":
        return {
          maximumItems: PUBLICATION_PROTOCOL_LIMITS.maximumCollections,
          path: "/collections",
          resource: "collections",
        };
      case "assets":
        return {
          maximumItems: PUBLICATION_PROTOCOL_LIMITS.maximumAssets,
          path: "/assets",
          resource: "assets",
        };
      case "links":
        return {
          maximumItems: PUBLICATION_PROTOCOL_LIMITS.maximumLinks,
          path: "/links",
          resource: "links",
        };
    }
  }

  if (
    root === "sources" &&
    isNumericPathToken(firstIndex) &&
    nested === "normalizedLineStarts" &&
    path.length === 3
  ) {
    return {
      maximumItems:
        PUBLICATION_PROTOCOL_LIMITS.maximumSourceLineStarts,
      path: "/sources",
      resource: "source line starts",
    };
  }

  if (
    root === "sourceAuthority" &&
    path.length === 2 &&
    (firstIndex === "sourceRoots" || firstIndex === "outputRoots")
  ) {
    return {
      maximumItems:
        firstIndex === "sourceRoots"
          ? PUBLICATION_PROTOCOL_LIMITS.maximumSourceRoots
          : PUBLICATION_PROTOCOL_LIMITS.maximumOutputRoots,
      path: `/sourceAuthority/${firstIndex}`,
      resource:
        firstIndex === "sourceRoots" ? "source roots" : "output roots",
    };
  }

  if (
    root === "extensions" &&
    isNumericPathToken(firstIndex) &&
    (nested === "capabilities" || nested === "payloadIds") &&
    path.length === 3
  ) {
    return {
      maximumItems:
        nested === "capabilities"
          ? PUBLICATION_PROTOCOL_LIMITS
              .maximumExtensionCapabilityReferences
          : PUBLICATION_PROTOCOL_LIMITS
              .maximumExtensionPayloadReferences,
      path: "/extensions",
      resource:
        nested === "capabilities"
          ? "extension capability references"
          : "extension payload references",
    };
  }

  if (
    root === "routes" &&
    path.length === 2 &&
    (firstIndex === "active" || firstIndex === "redirects")
  ) {
    return {
      maximumItems:
        firstIndex === "active"
          ? PUBLICATION_PROTOCOL_LIMITS.maximumActiveRoutes
          : PUBLICATION_PROTOCOL_LIMITS.maximumRedirects,
      path: `/routes/${firstIndex}`,
      resource:
        firstIndex === "active" ? "active routes" : "redirects",
    };
  }

  if (
    root === "payloads" &&
    isNumericPathToken(firstIndex) &&
    nested === "sourcePaths" &&
    path.length === 3
  ) {
    return {
      maximumItems:
        PUBLICATION_PROTOCOL_LIMITS.maximumPayloadSourcePaths,
      path: "/payloads",
      resource: "payload source paths",
    };
  }

  if (
    root === "collections" &&
    isNumericPathToken(firstIndex) &&
    nested === "workIds" &&
    path.length === 3
  ) {
    return {
      maximumItems:
        PUBLICATION_PROTOCOL_LIMITS.maximumCollectionWorkReferences,
      path: "/collections",
      resource: "collection work references",
    };
  }

  if (
    root === "works" &&
    isNumericPathToken(firstIndex) &&
    path.length === 3
  ) {
    if (nested === "sections") {
      return {
        maximumItems: PUBLICATION_PROTOCOL_LIMITS.maximumSections,
        path: "/works",
        resource: "sections",
      };
    }
    if (nested === "rootSectionIds") {
      return {
        maximumItems:
          PUBLICATION_PROTOCOL_LIMITS.maximumSectionReferences,
        path: "/works",
        resource: "section references",
      };
    }
  }

  if (
    root === "works" &&
    isNumericPathToken(firstIndex) &&
    nested === "sections" &&
    isNumericPathToken(secondIndex) &&
    path.length === 5
  ) {
    if (leaf === "blocks") {
      return {
        maximumItems: PUBLICATION_PROTOCOL_LIMITS.maximumBlocks,
        path: "/works",
        resource: "blocks",
      };
    }
    if (
      leaf === "childIds" ||
      leaf === "activeRouteNames"
    ) {
      return {
        maximumItems:
          PUBLICATION_PROTOCOL_LIMITS.maximumSectionReferences,
        path: "/works",
        resource: "section references",
      };
    }
    if (leaf === "routes") {
      return {
        maximumItems:
          PUBLICATION_PROTOCOL_LIMITS.maximumSectionRoutes,
        path: "/works",
        resource: "section routes",
      };
    }
  }

  if (
    root === "works" &&
    isNumericPathToken(firstIndex) &&
    nested === "sections" &&
    isNumericPathToken(secondIndex) &&
    leaf === "continuity" &&
    path.length === 6
  ) {
    const continuityField = path[5];
    if (
      continuityField === "legacyIds" ||
      continuityField === "historicalSectionIds"
    ) {
      return {
        maximumItems:
          PUBLICATION_PROTOCOL_LIMITS.maximumContinuityReferences,
        path: "/works",
        resource: "continuity references",
      };
    }
    if (continuityField === "progressGroups") {
      return {
        maximumItems:
          PUBLICATION_PROTOCOL_LIMITS.maximumContinuityGroups,
        path: "/works",
        resource: "continuity groups",
      };
    }
  }

  if (
    root === "works" &&
    isNumericPathToken(firstIndex) &&
    nested === "sections" &&
    isNumericPathToken(secondIndex) &&
    leaf === "continuity" &&
    path[5] === "progressGroups" &&
    isNumericPathToken(path[6]) &&
    path.length === 7
  ) {
    return {
      maximumItems:
        PUBLICATION_PROTOCOL_LIMITS.maximumContinuityReferences,
      path: "/works",
      resource: "continuity references",
    };
  }

  return undefined;
}

function createSnapshotContainer(source: object): SnapshotContainer {
  if (Array.isArray(source)) {
    return [];
  }
  const prototype = Reflect.getPrototypeOf(source);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Envelope records must use a plain prototype.");
  }
  return {};
}

function defineSnapshotValue(
  snapshot: SnapshotContainer,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(snapshot, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function createViolation(
  counter: ResourceCounter,
  keyword: EnvelopeResourceLimitViolation["keyword"] = "maxItems",
): EnvelopeResourceLimitViolation {
  return Object.freeze({
    actualItems: counter.actualItems,
    keyword,
    maximumItems: counter.maximumItems,
    path: counter.path,
    resource: counter.resource,
  });
}

function compareViolations(
  left: EnvelopeResourceLimitViolation,
  right: EnvelopeResourceLimitViolation,
): number {
  return (
    (left.path < right.path ? -1 : left.path > right.path ? 1 : 0) ||
    (left.resource < right.resource
      ? -1
      : left.resource > right.resource
        ? 1
        : 0) ||
    left.actualItems - right.actualItems
  );
}

/**
 * Detaches an unknown serialized envelope while enforcing browser-safe work
 * budgets. Every property is captured from one data descriptor. Callers then
 * validate and return only this frozen snapshot, so a stateful Proxy cannot
 * change values between resource inspection, shape validation, and use.
 */
export function snapshotPublicationEnvelopeForValidation(
  input: unknown,
  kind: PublicationEnvelopeKind,
): EnvelopeSnapshotResult {
  if (input === null || typeof input !== "object") {
    return Object.freeze({
      valid: true,
      value: input,
      violations: Object.freeze([]),
    });
  }

  let inspectedPath: readonly string[] = [];
  try {
    const sourceRoot = input as object;
    const snapshotRoot = createSnapshotContainer(sourceRoot);
    const pending: SnapshotFrame[] = [
      {
        depth: 1,
        path: [],
        snapshot: snapshotRoot,
        source: sourceRoot,
      },
    ];
    const snapshots: SnapshotContainer[] = [];
    const activeSources = new WeakSet<object>();
    const aggregateCounters = new Map<string, ResourceCounter>();
    const violationByResource = new Map<
      string,
      EnvelopeResourceLimitViolation
    >();
    let nodeCount = 1;

    while (pending.length > 0) {
      const frame = pending.pop();
      if (frame === undefined) {
        break;
      }
      inspectedPath = frame.path;
      if (frame.exit) {
        activeSources.delete(frame.source);
        continue;
      }
      if (
        frame.depth >
        PUBLICATION_PROTOCOL_LIMITS.maximumEnvelopeDepth
      ) {
        return Object.freeze({
          valid: false,
          path: pointer(frame.path),
          reason: "resourceLimit",
          violations: Object.freeze([
            {
              actualItems: frame.depth,
              keyword: "maximum" as const,
              maximumItems:
                PUBLICATION_PROTOCOL_LIMITS.maximumEnvelopeDepth,
              path: pointer(frame.path),
              resource: "envelope depth",
            },
          ]),
        });
      }
      if (activeSources.has(frame.source)) {
        return Object.freeze({
          valid: false,
          path: pointer(frame.path),
          reason: "cyclicReference",
          violations: Object.freeze([]),
        });
      }
      snapshots.push(frame.snapshot);

      const isArray = Array.isArray(frame.source);
      let arrayLength: number | undefined;
      let keys: PropertyKey[];
      let entryCount: number;
      if (isArray) {
        const lengthDescriptor = Reflect.getOwnPropertyDescriptor(
          frame.source,
          "length",
        );
        if (
          lengthDescriptor === undefined ||
          !("value" in lengthDescriptor) ||
          typeof lengthDescriptor.value !== "number" ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0
        ) {
          throw new TypeError("Envelope arrays require a valid length.");
        }
        arrayLength = lengthDescriptor.value;
        entryCount = arrayLength;
        keys = [];
      } else {
        keys = Reflect.ownKeys(frame.source);
        entryCount = keys.length;
      }
      nodeCount = addBounded(nodeCount, entryCount);
      if (
        nodeCount >
        PUBLICATION_PROTOCOL_LIMITS.maximumEnvelopeNodes
      ) {
        return Object.freeze({
          valid: false,
          path: "",
          reason: "resourceLimit",
          violations: Object.freeze([
            {
              actualItems: nodeCount,
              keyword: "maximum" as const,
              maximumItems:
                PUBLICATION_PROTOCOL_LIMITS.maximumEnvelopeNodes,
              path: "",
              resource: "envelope nodes",
            },
          ]),
        });
      }

      const resource = resourceAtPath(kind, frame.path);
      if (resource !== undefined) {
        const counterKey = `${resource.path}\u0000${resource.resource}`;
        const counter =
          aggregateCounters.get(counterKey) ??
          {
            actualItems: 0,
            maximumItems: resource.maximumItems,
            path: resource.path,
            resource: resource.resource,
          };
        counter.actualItems = addBounded(counter.actualItems, entryCount);
        aggregateCounters.set(counterKey, counter);
        if (counter.actualItems > counter.maximumItems) {
          violationByResource.set(
            counterKey,
            createViolation(
              counter,
              isArray ? "maxItems" : "maxProperties",
            ),
          );
          continue;
        }
      }

      activeSources.add(frame.source);
      if (isArray) {
        keys = Reflect.ownKeys(frame.source);
      }
      keys.sort((left, right) => {
        if (typeof left !== "string") {
          return typeof right === "string"
            ? 1
            : String(left).localeCompare(String(right));
        }
        if (typeof right !== "string") {
          return -1;
        }
        if (isArray) {
          if (left === "length") {
            return right === "length" ? 0 : 1;
          }
          if (right === "length") {
            return -1;
          }
          return Number(left) - Number(right);
        }
        return left < right ? -1 : left > right ? 1 : 0;
      });

      const descriptors: {
        readonly key: string;
        readonly value: unknown;
      }[] = [];

      for (const ownKey of keys) {
        if (typeof ownKey !== "string") {
          throw new TypeError("Envelope values cannot use symbol keys.");
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(
          frame.source,
          ownKey,
        );
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new TypeError(
            "Envelope values cannot use accessor properties.",
          );
        }
        if (isArray && ownKey === "length") {
          if (descriptor.value !== arrayLength) {
            throw new TypeError("Envelope arrays require a valid length.");
          }
          continue;
        }
        if (!descriptor.enumerable) {
          throw new TypeError(
            "Envelope values cannot use hidden data properties.",
          );
        }
        descriptors.push({ key: ownKey, value: descriptor.value });
      }

      if (isArray) {
        if (arrayLength === undefined) {
          throw new TypeError("Envelope arrays require a length.");
        }
        if (
          descriptors.length !== arrayLength ||
          descriptors.some(
            ({ key }, index) =>
              !NUMERIC_PATH_TOKEN.test(key) ||
              Number(key) !== index,
          )
        ) {
          throw new TypeError(
            "Envelope arrays must be dense and cannot use named properties.",
          );
        }
      }

      const childFrames: SnapshotFrame[] = [];
      for (const descriptor of descriptors) {
        const child = descriptor.value;
        if (child === null || typeof child !== "object") {
          defineSnapshotValue(frame.snapshot, descriptor.key, child);
          continue;
        }

        inspectedPath = [...frame.path, descriptor.key];
        const childDepth = frame.depth + 1;
        if (
          childDepth >
          PUBLICATION_PROTOCOL_LIMITS.maximumEnvelopeDepth
        ) {
          return Object.freeze({
            valid: false,
            path: pointer(inspectedPath),
            reason: "resourceLimit",
            violations: Object.freeze([
              {
                actualItems: childDepth,
                keyword: "maximum" as const,
                maximumItems:
                  PUBLICATION_PROTOCOL_LIMITS.maximumEnvelopeDepth,
                path: pointer(inspectedPath),
                resource: "envelope depth",
              },
            ]),
          });
        }
        if (activeSources.has(child)) {
          return Object.freeze({
            valid: false,
            path: pointer(inspectedPath),
            reason: "cyclicReference",
            violations: Object.freeze([]),
          });
        }
        const childSnapshot = createSnapshotContainer(child);
        childFrames.push({
          depth: childDepth,
          path: [...frame.path, descriptor.key],
          snapshot: childSnapshot,
          source: child,
        });
        defineSnapshotValue(
          frame.snapshot,
          descriptor.key,
          childSnapshot,
        );
      }
      pending.push({
        ...frame,
        exit: true,
      });
      for (let index = childFrames.length - 1; index >= 0; index -= 1) {
        const childFrame = childFrames[index];
        if (childFrame !== undefined) {
          pending.push(childFrame);
        }
      }
    }

    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      Object.freeze(snapshots[index]);
    }
    if (violationByResource.size > 0) {
      return Object.freeze({
        valid: false,
        path: "",
        reason: "resourceLimit",
        violations: Object.freeze(
          [...violationByResource.values()].sort(compareViolations),
        ),
      });
    }
    return Object.freeze({
      valid: true,
      value: snapshotRoot,
      violations: Object.freeze([]),
    });
  } catch {
    return Object.freeze({
      valid: false,
      path: pointer(inspectedPath),
      reason: "uninspectableEnvelope",
      violations: Object.freeze([]),
    });
  }
}
