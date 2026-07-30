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
  normalizePortableRepositoryText,
} from "@genii-foundation/publisher-schema";
import type {
  ContentRoute,
  Diagnostic,
  PublicationReaderEnvelope,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import type { PublisherNextRouteParams } from "./types.js";

export interface PublisherNextRoutePlan {
  readonly slashPolicy: "none" | "no-trailing" | "trailing" | "mixed";
  readonly staticParams: readonly PublisherNextRouteParams[];
  readonly resolve: (
    segments: unknown,
  ) =>
    | {
        readonly status: "resolved";
        readonly route: ContentRoute;
      }
    | {
        readonly status: "not-found";
      }
    | {
        readonly status: "invalid";
        readonly issue: string;
      };
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>>,
): Diagnostic {
  return Object.freeze({
    code,
    severity: "error",
    path,
    message,
    keyword,
    params: Object.freeze({ ...params }),
  });
}

function routeSegments(path: string): readonly string[] {
  if (path === "/") {
    return Object.freeze([]);
  }
  const terminalIndex = path.endsWith("/")
    ? path.length - 1
    : path.length;
  return Object.freeze(
    path
      .slice(1, terminalIndex)
      .split("/")
      .map((segment) => decodeURIComponent(segment)),
  );
}

function segmentKey(segments: readonly string[]): string {
  return JSON.stringify(segments);
}

const MAXIMUM_DECODED_ROUTE_BYTES = 2048;
const MAXIMUM_ROUTE_SEGMENTS = 1024;
const textEncoder = new TextEncoder();

function snapshotParams(
  segments: readonly string[],
): PublisherNextRouteParams {
  if (segments.length === 0) {
    return Object.freeze({});
  }
  return Object.freeze({
    segments: Object.freeze([...segments]),
  });
}

function inspectSegments(
  value: unknown,
):
  | { readonly valid: true; readonly value: readonly string[] }
  | { readonly valid: false; readonly issue: string } {
  try {
    if (value === undefined) {
      return { valid: true, value: Object.freeze([]) };
    }
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return { valid: false, issue: "type" };
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(
      value,
      "length",
    );
    const length =
      lengthDescriptor !== undefined &&
      "value" in lengthDescriptor
        ? lengthDescriptor.value
        : undefined;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAXIMUM_ROUTE_SEGMENTS
    ) {
      return { valid: false, issue: "length" };
    }
    if (
      Object.getOwnPropertySymbols(value).length > 0 ||
      Object.getOwnPropertyNames(value).length !== length + 1
    ) {
      return { valid: false, issue: "shape" };
    }
    const segments: string[] = [];
    let decodedRouteBytes = 1;
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        String(index),
      );
      const segment =
        descriptor !== undefined &&
        descriptor.enumerable &&
        "value" in descriptor
          ? descriptor.value
          : undefined;
      if (
        typeof segment !== "string" ||
        segment.length === 0 ||
        segment.includes("/") ||
        segment !== normalizePortableRepositoryText(segment)
      ) {
        return { valid: false, issue: "segment" };
      }
      decodedRouteBytes +=
        (index === 0 ? 0 : 1) +
        textEncoder.encode(segment).byteLength;
      if (decodedRouteBytes > MAXIMUM_DECODED_ROUTE_BYTES) {
        return { valid: false, issue: "bytes" };
      }
      segments.push(segment);
    }
    return {
      valid: true,
      value: Object.freeze(segments),
    };
  } catch {
    return { valid: false, issue: "uninspectable" };
  }
}

export function createPublisherNextRoutePlan(
  reader: PublicationReaderEnvelope,
): ValidationResult<PublisherNextRoutePlan> {
  const nonRootSlashPolicies = new Set(
    reader.routes.active
      .filter(({ path }) => path !== "/")
      .map(({ path }) => path.endsWith("/")),
  );
  const slashPolicy =
    nonRootSlashPolicies.size === 0
      ? "none"
      : nonRootSlashPolicies.size > 1
        ? "mixed"
        : nonRootSlashPolicies.has(true)
          ? "trailing"
          : "no-trailing";
  const routesBySegments = new Map<string, ContentRoute>();
  const staticParams: PublisherNextRouteParams[] = [];

  for (
    let index = 0;
    index < reader.routes.active.length;
    index += 1
  ) {
    const route = reader.routes.active[index];
    if (route === undefined) {
      continue;
    }
    const segments = routeSegments(route.path);
    const key = segmentKey(segments);
    const existing = routesBySegments.get(key);
    if (existing !== undefined) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.route.parameter_collision",
            `/routes/active/${index}/path`,
            "Two active routes collapse to the same decoded Next.js route parameters.",
            "unique",
            Object.freeze({
              first: existing.path,
              second: route.path,
            }),
          ),
        ]),
      });
    }
    routesBySegments.set(key, route);
    staticParams.push(snapshotParams(segments));
  }

  const frozenParams = Object.freeze(staticParams);
  const plan: PublisherNextRoutePlan = Object.freeze({
    slashPolicy,
    staticParams: frozenParams,
    resolve(segments: unknown) {
      const inspected = inspectSegments(segments);
      if (!inspected.valid) {
        return Object.freeze({
          status: "invalid" as const,
          issue: inspected.issue,
        });
      }
      const route = routesBySegments.get(
        segmentKey(inspected.value),
      );
      return route === undefined
        ? Object.freeze({ status: "not-found" as const })
        : Object.freeze({
            status: "resolved" as const,
            route,
          });
    },
  });

  return Object.freeze({
    valid: true,
    value: plan,
    diagnostics: Object.freeze([]),
  });
}
