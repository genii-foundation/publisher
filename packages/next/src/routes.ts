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
  PUBLICATION_PROTOCOL_LIMITS,
  normalizePortableRepositoryText,
  validateUpdatesEnvelopeShape,
} from "@genii-foundation/publisher-schema";
import {
  inspectCanonicalRoutePath,
} from "@genii-foundation/publisher-schema/routes";
import {
  canonicalizeJson,
  hashCanonicalJson,
} from "@genii-foundation/publisher-content";
import type {
  ContentRoute,
  Diagnostic,
  JSONValue,
  PublicationReaderEnvelope,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

export type PublisherNextPlannedRoute = ContentRoute | {
  readonly path: string;
  readonly target: {
    readonly kind: "updates";
    readonly viewId: string;
    readonly pagination: {
      readonly path: string;
      readonly pageSize: number;
    };
    readonly pageNumber: number;
    readonly previousPath?: string;
    readonly nextPath?: string;
  };
} | {
  readonly path: string;
  readonly target: {
    readonly kind: "extension";
    readonly extensionId: string;
    readonly routeId: string;
    readonly title: string;
    readonly description?: string;
    readonly data?: JSONValue;
  };
};

import type { PublisherNextRouteParams } from "./types.js";

export interface PublisherNextRoutePlan {
  readonly slashPolicy: "none" | "no-trailing" | "trailing" | "mixed";
  readonly staticParams: readonly PublisherNextRouteParams[];
  readonly activePaths: readonly string[];
  readonly resolve: (
    segments: unknown,
  ) =>
    | {
        readonly status: "resolved";
        readonly route: PublisherNextPlannedRoute;
      }
    | {
        readonly status: "not-found";
      }
    | {
        readonly status: "invalid";
        readonly issue: string;
      };
}

const EXTENSION_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;

function exactJsonObject(
  value: JSONValue | undefined,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, JSONValue>> | null {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    return null;
  }
  return value as Readonly<Record<string, JSONValue>>;
}

function extensionRoutesFor(
  reader: PublicationReaderEnvelope,
  extensionData: unknown,
): ValidationResult<readonly PublisherNextPlannedRoute[]> {
  if (extensionData === undefined) {
    return Object.freeze({
      valid: true,
      value: Object.freeze([]),
      diagnostics: Object.freeze([]),
    });
  }
  let data: JSONValue;
  try {
    data = JSON.parse(canonicalizeJson(extensionData as JSONValue)) as JSONValue;
  } catch {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.extension.routes_data_invalid",
          "/extensionData",
          "Extension route data must be finite canonical JSON.",
          "json",
          {},
        ),
      ]),
    });
  }
  const envelope = exactJsonObject(data, [
    "schemaVersion",
    "publicationId",
    "engineVersion",
    "readerBuildId",
    "extensions",
    "buildId",
  ]);
  if (envelope === null) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.extension.routes_data_shape_invalid",
          "/extensionData",
          "Extension route data must use the closed build-bound artifact shape.",
          "properties",
          {},
        ),
      ]),
    });
  }
  const extensions = envelope.extensions;
  const buildId = envelope.buildId;
  const basis = Object.freeze({
    schemaVersion: envelope.schemaVersion,
    publicationId: envelope.publicationId,
    engineVersion: envelope.engineVersion,
    readerBuildId: envelope.readerBuildId,
    extensions,
  });
  if (
    envelope.schemaVersion !== "1.0" ||
    envelope.publicationId !== reader.publicationId ||
    envelope.engineVersion !== reader.engineVersion ||
    envelope.readerBuildId !== reader.buildId ||
    typeof buildId !== "string" ||
    !SHA256_DIGEST.test(buildId) ||
    hashCanonicalJson(basis as JSONValue) !== buildId ||
    !Array.isArray(extensions) ||
    extensions.length === 0 ||
    extensions.length > 1_000
  ) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.extension.routes_data_identity_invalid",
          "/extensionData",
          "Extension route data must belong to this exact Reader build.",
          "identity",
          {},
        ),
      ]),
    });
  }
  const planned: PublisherNextPlannedRoute[] = [];
  const seenExtensionIds = new Set<string>();
  const ownedPaths = new Set([
    ...reader.routes.active.map(({ path }) => path),
    ...reader.routes.redirects.map(({ from }) => from),
  ]);
  for (const [extensionIndex, value] of extensions.entries()) {
    const path = `/extensionData/extensions/${extensionIndex}`;
    const entry = exactJsonObject(
      value,
      ["id", "package", "version", "capabilities", "config"],
      ["serverData", "clientData", "routes"],
    );
    if (
      entry === null ||
      typeof entry.id !== "string" ||
      !EXTENSION_ID.test(entry.id) ||
      seenExtensionIds.has(entry.id)
    ) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.extension.route_entry_invalid",
            path,
            "Extension route entries must use the closed extension artifact shape.",
            "properties",
            {},
          ),
        ]),
      });
    }
    seenExtensionIds.add(entry.id);
    const capabilities = entry.capabilities;
    const routes = entry.routes;
    const granted = Array.isArray(capabilities) &&
      capabilities.length > 0 &&
      capabilities.every(
        (capability, index) =>
          typeof capability === "string" &&
          capabilities.indexOf(capability) === index,
      ) &&
      capabilities.includes("host.route");
    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.extension.route_grant_invalid",
            `${path}/capabilities`,
            "Extension route capabilities must be one nonempty unique string list.",
            "extensionCapability",
            {},
          ),
        ]),
      });
    }
    if ((granted && !Array.isArray(routes)) || (!granted && routes !== undefined)) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.extension.route_grant_invalid",
            `${path}/routes`,
            "Declarative routes require the host.route grant, and every host.route grant requires a route list.",
            "extensionCapability",
            {},
          ),
        ]),
      });
    }
    if (!granted || !Array.isArray(routes)) {
      continue;
    }
    const localRouteIds = new Set<string>();
    for (const [routeIndex, routeValue] of routes.entries()) {
      const routePath = `${path}/routes/${routeIndex}`;
      const route = exactJsonObject(
        routeValue,
        ["id", "path", "title"],
        ["description", "data"],
      );
      if (
        route === null ||
        typeof route.id !== "string" ||
        !EXTENSION_ID.test(route.id) ||
        localRouteIds.has(route.id) ||
        typeof route.path !== "string" ||
        !inspectCanonicalRoutePath(route.path).valid ||
        ownedPaths.has(route.path) ||
        typeof route.title !== "string" ||
        route.title.length === 0 ||
        route.title.length > 512 ||
        route.title.includes("\u0000") ||
        (route.description !== undefined &&
          (typeof route.description !== "string" ||
            route.description.length === 0 ||
            route.description.length > 4_000 ||
            route.description.includes("\u0000"))) ||
        planned.length + reader.routes.active.length >=
          PUBLICATION_PROTOCOL_LIMITS.maximumActiveRoutes
      ) {
        return Object.freeze({
          valid: false,
          diagnostics: Object.freeze([
            diagnostic(
              "next.extension.route_invalid",
              routePath,
              "Extension routes require a bounded ID, canonical path, public text, and finite JSON data.",
              "route",
              {},
            ),
          ]),
        });
      }
      localRouteIds.add(route.id);
      ownedPaths.add(route.path);
      planned.push(Object.freeze({
        path: route.path,
        target: Object.freeze({
          kind: "extension" as const,
          extensionId: entry.id,
          routeId: route.id,
          title: route.title,
          ...(route.description === undefined ? {} : { description: route.description }),
          ...(route.data === undefined ? {} : { data: route.data }),
        }),
      }));
    }
  }
  return Object.freeze({
    valid: true,
    value: Object.freeze(planned),
    diagnostics: Object.freeze([]),
  });
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
  updatesData?: unknown,
  extensionData?: unknown,
): ValidationResult<PublisherNextRoutePlan> {
  const routes: PublisherNextPlannedRoute[] = [...reader.routes.active];
  if (updatesData !== undefined) {
    const validated = validateUpdatesEnvelopeShape(updatesData);
    if (!validated.valid) {
      return validated;
    }
    if (
      validated.value.publicationId !== reader.publicationId ||
      validated.value.buildId !== reader.buildId
    ) {
      return Object.freeze({
        valid: false as const,
        diagnostics: Object.freeze([
          diagnostic(
            "next.updates.data_stale",
            "/updatesData",
            "The Updates artifact is not bound to this Reader build.",
            "identity",
            {},
          ),
        ]),
      });
    }
    const expectedViewIds = new Set(
      reader.routes.active.flatMap((route) =>
        route.target.kind === "updates"
          ? [route.target.viewId]
          : [],
      ),
    );
    const seenViewIds = new Set<string>();
    for (const [index, view] of validated.value.views.entries()) {
      if (seenViewIds.has(view.id)) {
        return Object.freeze({
          valid: false as const,
          diagnostics: Object.freeze([
            diagnostic(
              "next.updates.view_duplicate",
              `/updatesData/views/${index}/id`,
              `The Updates artifact declares view "${view.id}" more than once.`,
              "uniqueItems",
              { viewId: view.id },
            ),
          ]),
        });
      }
      if (!expectedViewIds.has(view.id)) {
        return Object.freeze({
          valid: false as const,
          diagnostics: Object.freeze([
            diagnostic(
              "next.updates.view_undeclared",
              `/updatesData/views/${index}/id`,
              `The Updates artifact declares view "${view.id}" without a matching Reader route.`,
              "route",
              { viewId: view.id },
            ),
          ]),
        });
      }
      seenViewIds.add(view.id);
    }
    for (const viewId of expectedViewIds) {
      if (!seenViewIds.has(viewId)) {
        return Object.freeze({
          valid: false as const,
          diagnostics: Object.freeze([
            diagnostic(
              "next.updates.view_missing",
              "/updatesData/views",
              `Reader Updates route "${viewId}" has no matching artifact view.`,
              "required",
              { viewId },
            ),
          ]),
        });
      }
    }
    const viewById = new Map(
      validated.value.views.map((view) => [view.id, view] as const),
    );
    for (const route of reader.routes.active) {
      if (
        route.target.kind !== "updates" ||
        route.target.pagination === undefined
      ) {
        continue;
      }
      const view = viewById.get(route.target.viewId);
      if (view === undefined) {
        continue;
      }
      const totalPages = Math.max(
        1,
        Math.ceil(
          view.entries.length / route.target.pagination.pageSize,
        ),
      );
      for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
        routes.push(Object.freeze({
          path: route.target.pagination.path.replace(
            "{page}",
            String(pageNumber),
          ),
          target: Object.freeze({
            kind: "updates" as const,
            viewId: route.target.viewId,
            pagination: route.target.pagination,
            pageNumber,
            previousPath:
              pageNumber === 2
                ? route.path
                : route.target.pagination.path.replace(
                    "{page}",
                    String(pageNumber - 1),
                  ),
            ...(pageNumber === totalPages
              ? {}
              : {
                  nextPath: route.target.pagination.path.replace(
                    "{page}",
                    String(pageNumber + 1),
                  ),
                }),
          }),
        }));
      }
      const canonicalIndex = routes.indexOf(route);
      if (canonicalIndex >= 0 && totalPages > 1) {
        routes[canonicalIndex] = Object.freeze({
          path: route.path,
          target: Object.freeze({
            ...route.target,
            pageNumber: 1,
            nextPath: route.target.pagination.path.replace("{page}", "2"),
          }),
        });
      }
    }
  }
  const extensionRoutes = extensionRoutesFor(reader, extensionData);
  if (!extensionRoutes.valid) {
    return extensionRoutes;
  }
  routes.push(...extensionRoutes.value);
  if (routes.length > PUBLICATION_PROTOCOL_LIMITS.maximumActiveRoutes) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.route.count_exceeded",
          "/routes/active",
          "The expanded route plan exceeds the protocol route limit.",
          "maxItems",
          { maximum: PUBLICATION_PROTOCOL_LIMITS.maximumActiveRoutes },
        ),
      ]),
    });
  }
  const nonRootSlashPolicies = new Set(
    routes
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
  const routesBySegments = new Map<string, PublisherNextPlannedRoute>();
  const staticParams: PublisherNextRouteParams[] = [];

  for (
    let index = 0;
    index < routes.length;
    index += 1
  ) {
    const route = routes[index];
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
  const activePaths = Object.freeze(routes.map(({ path }) => path));
  const plan: PublisherNextRoutePlan = Object.freeze({
    slashPolicy,
    staticParams: frozenParams,
    activePaths,
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
