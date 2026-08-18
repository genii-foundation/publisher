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

import { satisfies, valid, validRange } from "semver";

import {
  CANONICAL_PUBLICATION_MANIFEST_PATH,
  MAXIMUM_PROTOCOL_DIAGNOSTICS,
  PUBLICATION_PROTOCOL_LIMITS,
  isPathWithinRoot,
  isReservedHostIntegrationPath,
  portableRepositoryPathIdentity,
  resolvePublicationLayout,
  resolveWorkSourcePaths,
  validatePublicationResourceLimits,
} from "./layout.js";
import type {
  ResolvedPublicationLayout,
  ResolvedWorkSourcePaths,
} from "./layout.js";
import type {
  CollectionManifest,
  Diagnostic,
  PublicationManifest,
  ValidationResult,
  WorkManifest,
} from "./types.js";
import {
  REQUIRED_ATTRIBUTION,
} from "./attribution.js";
import { immutableSnapshot } from "./immutability.js";
import {
  inspectCanonicalRoutePath,
  isAbsoluteHttpUrl,
  type CanonicalRoutePathIssue,
} from "./routes.js";

export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze({
  publication: "1.0",
  work: "1.0",
  collection: "1.0",
  content: "1.0",
});

export interface SemanticValidationInput {
  readonly publication: PublicationManifest;
  readonly engineVersion: string;
  readonly workManifests: ReadonlyMap<string, WorkManifest>;
  readonly collectionManifests: ReadonlyMap<string, CollectionManifest>;
}

export interface PublicationPreflightInput {
  readonly publication: PublicationManifest;
  readonly engineVersion: string;
}

export interface ResolvedWorkSource extends ResolvedWorkSourcePaths {
  readonly referenceIndex: number;
  readonly referencePointer: string;
  readonly manifest: WorkManifest;
}

export interface ResolvedCollectionSource {
  readonly collectionId: string;
  readonly manifestPath: string;
  readonly referenceIndex: number;
  readonly referencePointer: string;
  readonly manifest: CollectionManifest;
}

export interface ResolvedPublicationSourceGraph {
  readonly layout: ResolvedPublicationLayout;
  readonly works: readonly ResolvedWorkSource[];
  readonly collections: readonly ResolvedCollectionSource[];
}

interface ActiveRoute {
  readonly route: string;
  readonly path: string;
  readonly documentPath: string;
  readonly kind: "home" | "updates" | "work" | "collection";
  readonly id?: string;
}

interface RedirectRecord {
  readonly from: string;
  readonly to: string;
  readonly index: number;
  readonly internalTarget: boolean;
  readonly validSource: boolean;
  readonly validTarget: boolean;
}

interface RedirectResolution {
  readonly kind: "active" | "cycle" | "external" | "unresolved";
  readonly terminalRoute: string;
}

interface SourcePathOwner {
  readonly role:
    | "collection-manifest"
    | "manuscript"
    | "publication-manifest"
    | "work-manifest";
  readonly entityId?: string;
  readonly documentPath: string;
  readonly pointer: string;
}

const EXACT_SEMVER =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_EXACT_SEMVER_LENGTH = 256;
const ROUTE_TOKEN = /\{[^{}]*\}/g;

function diagnostic(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>>,
  documentPath = CANONICAL_PUBLICATION_MANIFEST_PATH,
): Diagnostic {
  return {
    severity: "error",
    code,
    documentPath,
    path,
    message,
    keyword,
    params,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`,
    )
    .join(",")}}`;
}

function sortDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  const maximumDetails = MAXIMUM_PROTOCOL_DIAGNOSTICS - 1;
  const sorted = [...diagnostics].sort(compareDiagnostics);
  const totalDiagnostics =
    diagnosticCollectorTotals.get(diagnostics) ??
    diagnostics.length;
  const omittedDiagnostics = Math.max(
    0,
    totalDiagnostics - maximumDetails,
  );
  const bounded = sorted.slice(0, maximumDetails);
  if (omittedDiagnostics > 0) {
    bounded.push(
      diagnostic(
        "validation.diagnostics_truncated",
        "",
        "Further protocol diagnostics were omitted after the fixed reporting limit.",
        "diagnosticLimit",
        {
          maximumDiagnostics:
            MAXIMUM_PROTOCOL_DIAGNOSTICS,
          omittedDiagnostics,
        },
      ),
    );
  }
  return bounded.sort(compareDiagnostics);
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    compareText(left.documentPath ?? "", right.documentPath ?? "") ||
    compareText(left.path, right.path) ||
    compareText(left.code, right.code) ||
    compareText(left.schemaPath ?? "", right.schemaPath ?? "") ||
    compareText(left.keyword, right.keyword) ||
    compareText(left.message, right.message) ||
    compareText(left.severity, right.severity) ||
    compareText(stableSerialize(left.params), stableSerialize(right.params))
  );
}

const diagnosticCollectorTotals =
  new WeakMap<readonly Diagnostic[], number>();

function createDiagnosticCollector(): Diagnostic[] {
  const retained: Diagnostic[] = [];
  diagnosticCollectorTotals.set(retained, 0);
  Object.defineProperty(retained, "push", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: (...items: Diagnostic[]): number => {
      const maximumDetails = MAXIMUM_PROTOCOL_DIAGNOSTICS - 1;
      let total =
        diagnosticCollectorTotals.get(retained) ??
        retained.length;

      for (const item of items) {
        const nestedOmitted =
          item.keyword === "diagnosticLimit" &&
          typeof item.params.omittedDiagnostics === "number" &&
          Number.isSafeInteger(item.params.omittedDiagnostics) &&
          item.params.omittedDiagnostics >= 0
            ? item.params.omittedDiagnostics
            : undefined;
        if (nestedOmitted !== undefined) {
          total += nestedOmitted;
          continue;
        }
        total += 1;
        let low = 0;
        let high = retained.length;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          const current = retained[middle];
          if (
            current !== undefined &&
            compareDiagnostics(current, item) < 0
          ) {
            low = middle + 1;
          } else {
            high = middle;
          }
        }

        if (low >= maximumDetails) {
          continue;
        }
        if (retained.length < maximumDetails) {
          retained.length += 1;
        }
        for (
          let index = retained.length - 1;
          index > low;
          index -= 1
        ) {
          retained[index] = retained[index - 1] as Diagnostic;
        }
        retained[low] = item;
      }

      diagnosticCollectorTotals.set(retained, total);
      return retained.length;
    },
  });
  return retained;
}

function validateUniqueIds(
  entries: readonly { readonly id: string }[],
  basePointer: string,
  code: string,
  kind: string,
  diagnostics: Diagnostic[],
): void {
  const firstIndexById = new Map<string, number>();

  entries.forEach((entry, index) => {
    const firstIndex = firstIndexById.get(entry.id);
    if (firstIndex === undefined) {
      firstIndexById.set(entry.id, index);
      return;
    }

    diagnostics.push(
      diagnostic(
        code,
        `${basePointer}/${index}/id`,
        `Duplicate ${kind} ID "${entry.id}".`,
        "uniqueId",
        { id: entry.id, firstIndex, duplicateIndex: index, kind },
      ),
    );
  });
}

function validateEngineCompatibility(
  publication: PublicationManifest,
  engineVersion: string,
  diagnostics: Diagnostic[],
): void {
  const normalizedVersion =
    engineVersion.length <= MAX_EXACT_SEMVER_LENGTH &&
      EXACT_SEMVER.test(engineVersion)
      ? valid(engineVersion)
      : null;
  if (
    normalizedVersion === null
  ) {
    diagnostics.push(
      diagnostic(
        "engine.version.invalid",
        "",
        `The installed engine version "${engineVersion}" is not canonical SemVer.`,
        "semver",
        { engineVersion },
      ),
    );
    return;
  }

  const compatibility = publication.engine.compatibility;
  const normalizedRange = validRange(compatibility);
  if (normalizedRange === null) {
    diagnostics.push(
      diagnostic(
        "engine.compatibility.invalid",
        "/engine/compatibility",
        `The engine compatibility range "${compatibility}" is not a valid SemVer range.`,
        "semverRange",
        { compatibility },
      ),
    );
    return;
  }

  if (!satisfies(engineVersion, normalizedRange)) {
    diagnostics.push(
      diagnostic(
        "engine.compatibility.unsatisfied",
        "/engine/compatibility",
        `Engine ${engineVersion} does not satisfy ${compatibility}.`,
        "semverRange",
        { engineVersion, compatibility, normalizedRange },
      ),
    );
  }
}

function validateSchemaVersion(
  actual: string,
  expected: string,
  documentPath: string,
  diagnostics: Diagnostic[],
): void {
  if (actual === expected) {
    return;
  }

  diagnostics.push(
    diagnostic(
      "schema_version.unsupported",
      "/schemaVersion",
      `Schema version "${actual}" is unsupported; this runtime accepts "${expected}".`,
      "supportedSchemaVersion",
      { actual, expected },
      documentPath,
    ),
  );
}

function validateAbsoluteHttpUrl(
  value: string,
  path: string,
  code: string,
  subject: string,
  diagnostics: Diagnostic[],
  documentPath = CANONICAL_PUBLICATION_MANIFEST_PATH,
): boolean {
  if (isAbsoluteHttpUrl(value)) {
    return true;
  }
  diagnostics.push(
    diagnostic(
      code,
      path,
      `${subject} must be an absolute HTTP or HTTPS URL without embedded credentials.`,
      "absoluteHttpUrl",
      { value },
      documentPath,
    ),
  );
  return false;
}

function validatePublicationUrls(
  publication: PublicationManifest,
  diagnostics: Diagnostic[],
): void {
  if (publication.publication.canonicalUrl !== undefined) {
    validateAbsoluteHttpUrl(
      publication.publication.canonicalUrl,
      "/publication/canonicalUrl",
      "publication.canonical_url.invalid",
      "The publication canonical URL",
      diagnostics,
    );
  }

  if (publication.publication.publisher.url !== undefined) {
    validateAbsoluteHttpUrl(
      publication.publication.publisher.url,
      "/publication/publisher/url",
      "publication.publisher_url.invalid",
      "The publisher URL",
      diagnostics,
    );
  }
}

function validateAttribution(
  publication: PublicationManifest,
  diagnostics: Diagnostic[],
): void {
  const attribution = publication.attribution as unknown as Readonly<
    Record<string, unknown>
  >;

  for (const [field, expected] of Object.entries(REQUIRED_ATTRIBUTION)) {
    const actual = attribution[field];
    if (actual === expected) {
      continue;
    }

    diagnostics.push(
      diagnostic(
        "attribution.fixed_value",
        `/attribution/${field}`,
        `The persistent footer attribution field "${field}" must not change.`,
        "const",
        { field, expected, actual },
      ),
    );
  }

  validateAbsoluteHttpUrl(
    publication.attribution.sourceCodeUrl,
    "/attribution/sourceCodeUrl",
    "attribution.source_code_url.invalid",
    "The network source URL",
    diagnostics,
  );
}

function validateOriginRelativeRoute(
  value: unknown,
  path: string,
  documentPath: string,
  diagnostics: Diagnostic[],
  requiredToken?: "{workId}" | "{collectionId}" | "{page}",
): boolean {
  let routeValid = true;
  if (typeof value !== "string") {
    diagnostics.push(
      diagnostic(
        "route.type",
        path,
        "Routes must be strings.",
        "originRelativeRoute",
        { value },
        documentPath,
      ),
    );
    return false;
  }

  const tokens: readonly string[] = value.match(ROUTE_TOKEN) ?? [];
  const unmatchedBraces = value.replaceAll(ROUTE_TOKEN, "");
  let concreteRoute: string | undefined;
  if (requiredToken === undefined) {
    if (
      tokens.length > 0 ||
      unmatchedBraces.includes("{") ||
      unmatchedBraces.includes("}")
    ) {
      diagnostics.push(
        diagnostic(
          "route.template_token_unexpected",
          path,
          "Concrete routes must not contain template tokens.",
          "routeTemplate",
          { value },
          documentPath,
        ),
      );
      routeValid = false;
    } else {
      concreteRoute = value;
    }
  } else {
    const requiredTokenCount = tokens.filter(
      (token) => token === requiredToken,
    ).length;
    let tokenValid = true;
    if (requiredTokenCount === 0) {
      tokenValid = false;
      routeValid = false;
      diagnostics.push(
        diagnostic(
          "route.template_token_required",
          path,
          `Route template must contain ${requiredToken}.`,
          "routeTemplate",
          { value, requiredToken },
          documentPath,
        ),
      );
    }
    if (
      requiredTokenCount > 1 ||
      tokens.some((token) => token !== requiredToken) ||
      unmatchedBraces.includes("{") ||
      unmatchedBraces.includes("}")
    ) {
      tokenValid = false;
      routeValid = false;
      diagnostics.push(
        diagnostic(
          "route.template_token_invalid",
          path,
          `Route template must contain exactly one ${requiredToken} token.`,
          "routeTemplate",
          { value, requiredToken, tokens },
          documentPath,
        ),
      );
    }
    if (tokenValid) {
      concreteRoute = value.replace(
        requiredToken,
        "-".repeat(requiredToken.length),
      );
    }
  }

  if (concreteRoute !== undefined) {
    const inspection = inspectCanonicalRoutePath(concreteRoute);
    if (!inspection.valid) {
      routeValid = false;
      const routeDiagnostic = canonicalRouteDiagnostic(
        inspection.issue,
        value,
        path,
        documentPath,
      );
      diagnostics.push(routeDiagnostic);
    }
  }

  return routeValid;
}

function canonicalRouteDiagnostic(
  issue: CanonicalRoutePathIssue,
  value: string,
  path: string,
  documentPath: string,
): Diagnostic {
  const details: Readonly<
    Record<
      CanonicalRoutePathIssue,
      {
        readonly code: string;
        readonly keyword: string;
        readonly message: string;
      }
    >
  > = {
    backslash: {
      code: "route.backslash",
      keyword: "canonicalRoute",
      message: "Canonical routes must use forward slashes.",
    },
    character: {
      code: "route.character",
      keyword: "canonicalRoute",
      message:
        "Canonical routes may use only RFC 3986 path characters and slashes.",
    },
    "control-character": {
      code: "route.control_character",
      keyword: "canonicalRoute",
      message: "Canonical routes must not contain control characters.",
    },
    "dot-segment": {
      code: "route.dot_segment",
      keyword: "canonicalRoute",
      message: "Canonical routes must not contain dot segments.",
    },
    "empty-segment": {
      code: "route.empty_segment",
      keyword: "canonicalRoute",
      message: "Canonical routes must not contain empty interior segments.",
    },
    length: {
      code: "route.length",
      keyword: "routeLength",
      message:
        "Canonical serialized routes must contain between 1 and 2048 ASCII characters.",
    },
    "origin-relative": {
      code: "route.origin_relative",
      keyword: "canonicalRoute",
      message: "Canonical routes must begin with exactly one slash.",
    },
    "percent-encoded-ascii": {
      code: "route.percent_encoding",
      keyword: "canonicalRoute",
      message:
        "Canonical routes must not percent encode ASCII characters.",
    },
    "percent-encoding-case": {
      code: "route.percent_encoding",
      keyword: "canonicalRoute",
      message:
        "Canonical routes must use uppercase hexadecimal percent encoding.",
    },
    "percent-encoding-syntax": {
      code: "route.percent_encoding",
      keyword: "canonicalRoute",
      message: "Canonical routes must contain complete percent-encoded octets.",
    },
    "percent-encoding-utf8": {
      code: "route.percent_encoding",
      keyword: "canonicalRoute",
      message:
        "Canonical routes must use valid UTF-8 percent encoding for non-ASCII characters.",
    },
    "raw-non-ascii": {
      code: "route.raw_non_ascii",
      keyword: "canonicalRoute",
      message:
        "Canonical routes must percent encode non-ASCII characters as uppercase UTF-8 octets.",
    },
    type: {
      code: "route.type",
      keyword: "canonicalRoute",
      message: "Canonical routes must be strings.",
    },
    "unicode-normalization": {
      code: "route.unicode_normalization",
      keyword: "canonicalRoute",
      message:
        "Canonical routes must decode to Unicode Normalization Form C text.",
    },
    whitespace: {
      code: "route.whitespace",
      keyword: "canonicalRoute",
      message: "Canonical routes must not contain Unicode whitespace.",
    },
  };
  const detail = details[issue];

  return diagnostic(
    detail.code,
    path,
    detail.message,
    detail.keyword,
    { issue, value },
    documentPath,
  );
}

function addActiveRoute(
  candidate: ActiveRoute,
  activeRoutes: Map<string, ActiveRoute>,
  diagnostics: Diagnostic[],
): void {
  const first = activeRoutes.get(candidate.route);
  if (first === undefined) {
    activeRoutes.set(candidate.route, candidate);
    return;
  }

  diagnostics.push(
    diagnostic(
      "route.active_collision",
      candidate.path,
      `Active route "${candidate.route}" is already assigned.`,
      "uniqueActiveRoute",
      {
        route: candidate.route,
        kind: candidate.kind,
        id: candidate.id,
        firstKind: first.kind,
        firstId: first.id,
        firstDocumentPath: first.documentPath,
        firstPath: first.path,
      },
      candidate.documentPath,
    ),
  );
}

function validateUpdatesRoutes(
  publication: PublicationManifest,
  activeRoutes: Map<string, ActiveRoute>,
  diagnostics: Diagnostic[],
): void {
  const declared = publication.routes.updates;
  if (declared === undefined) {
    return;
  }
  const routes =
    typeof declared === "string"
      ? [{ id: "updates", path: declared }]
      : declared;
  const ids = new Map<string, number>();
  const paginationPaths = new Map<string, number>();
  routes.forEach((route, index) => {
    const basePath =
      typeof declared === "string"
        ? "/routes/updates"
        : `/routes/updates/${index}`;
    const firstIdIndex = ids.get(route.id);
    if (firstIdIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "route.updates_view_id_duplicate",
          `${basePath}/id`,
          `Updates view id "${route.id}" is already declared.`,
          "uniqueItems",
          { id: route.id, firstIndex: firstIdIndex, index },
        ),
      );
    } else {
      ids.set(route.id, index);
    }

    if (
      validateOriginRelativeRoute(
        route.path,
        typeof declared === "string" ? basePath : `${basePath}/path`,
        CANONICAL_PUBLICATION_MANIFEST_PATH,
        diagnostics,
      )
    ) {
      addActiveRoute(
        {
          route: route.path,
          path:
            typeof declared === "string" ? basePath : `${basePath}/path`,
          documentPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
          kind: "updates",
          id: route.id,
        },
        activeRoutes,
        diagnostics,
      );
    }

    if (route.pagination === undefined) {
      return;
    }
    const paginationPath = `${basePath}/pagination/path`;
    validateOriginRelativeRoute(
      route.pagination.path,
      paginationPath,
      CANONICAL_PUBLICATION_MANIFEST_PATH,
      diagnostics,
      "{page}",
    );
    const firstPaginationIndex = paginationPaths.get(
      route.pagination.path,
    );
    if (firstPaginationIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "route.updates_pagination_duplicate",
          paginationPath,
          "Updates pagination templates must be unique.",
          "uniqueItems",
          {
            path: route.pagination.path,
            firstIndex: firstPaginationIndex,
            index,
          },
        ),
      );
    } else {
      paginationPaths.set(route.pagination.path, index);
    }
  });
}

function validateRoutes(
  input: SemanticValidationInput,
  layout: ResolvedPublicationLayout | undefined,
  diagnostics: Diagnostic[],
): ReadonlyMap<string, ActiveRoute> {
  const publication = input.publication;
  const activeRoutes = new Map<string, ActiveRoute>();
  const homeValid = validateOriginRelativeRoute(
    publication.routes.home,
    "/routes/home",
    CANONICAL_PUBLICATION_MANIFEST_PATH,
    diagnostics,
  );
  if (homeValid) {
    addActiveRoute(
      {
        route: publication.routes.home,
        path: "/routes/home",
        documentPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
        kind: "home",
      },
      activeRoutes,
      diagnostics,
    );
  }

  validateUpdatesRoutes(publication, activeRoutes, diagnostics);

  const workTemplateValid = validateOriginRelativeRoute(
    publication.routes.work,
    "/routes/work",
    CANONICAL_PUBLICATION_MANIFEST_PATH,
    diagnostics,
    "{workId}",
  );
  const collectionReferences = publication.collections ?? [];
  let collectionTemplateValid = false;
  if (
    collectionReferences.length > 0 &&
    publication.routes.collection === undefined
  ) {
    diagnostics.push(
      diagnostic(
        "route.collection.required",
        "/routes/collection",
        "A collection route is required when the publication has collections.",
        "required",
        { collectionCount: collectionReferences.length },
      ),
    );
  } else if (publication.routes.collection !== undefined) {
    collectionTemplateValid = validateOriginRelativeRoute(
      publication.routes.collection,
      "/routes/collection",
      CANONICAL_PUBLICATION_MANIFEST_PATH,
      diagnostics,
      "{collectionId}",
    );
  }

  const workReferences =
    layout?.works.manifests ??
    publication.works.map((reference, index) => ({
      id: reference.id,
      manifestPath: "",
      referenceIndex: index,
      referencePointer: `/works/${index}`,
    }));
  for (const reference of workReferences) {
    const work =
      reference.manifestPath.length === 0
        ? undefined
        : input.workManifests.get(reference.manifestPath);
    if (work?.route !== undefined) {
      const routeValid = validateOriginRelativeRoute(
        work.route,
        "/route",
        reference.manifestPath,
        diagnostics,
      );
      if (routeValid) {
        addActiveRoute(
          {
            route: work.route,
            path: "/route",
            documentPath: reference.manifestPath,
            kind: "work",
            id: reference.id,
          },
          activeRoutes,
          diagnostics,
        );
      }
    } else if (workTemplateValid) {
      const route = publication.routes.work.replaceAll(
        "{workId}",
        reference.id,
      );
      if (
        validateOriginRelativeRoute(
          route,
          "/routes/work",
          CANONICAL_PUBLICATION_MANIFEST_PATH,
          diagnostics,
        )
      ) {
        addActiveRoute(
          {
            route,
            path: "/routes/work",
            documentPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
            kind: "work",
            id: reference.id,
          },
          activeRoutes,
          diagnostics,
        );
      }
    }
  }

  const resolvedCollectionReferences =
    layout?.collections.manifests ??
    collectionReferences.map((reference, index) => ({
      id: reference.id,
      manifestPath: "",
      referenceIndex: index,
      referencePointer: `/collections/${index}`,
    }));
  for (const reference of resolvedCollectionReferences) {
    const collection =
      reference.manifestPath.length === 0
        ? undefined
        : input.collectionManifests.get(reference.manifestPath);
    if (collection?.route !== undefined) {
      const routeValid = validateOriginRelativeRoute(
        collection.route,
        "/route",
        reference.manifestPath,
        diagnostics,
      );
      if (routeValid) {
        addActiveRoute(
          {
            route: collection.route,
            path: "/route",
            documentPath: reference.manifestPath,
            kind: "collection",
            id: reference.id,
          },
          activeRoutes,
          diagnostics,
        );
      }
    } else if (
      collectionTemplateValid &&
      publication.routes.collection !== undefined
    ) {
      const route = publication.routes.collection.replaceAll(
        "{collectionId}",
        reference.id,
      );
      if (
        validateOriginRelativeRoute(
          route,
          "/routes/collection",
          CANONICAL_PUBLICATION_MANIFEST_PATH,
          diagnostics,
        )
      ) {
        addActiveRoute(
          {
            route,
            path: "/routes/collection",
            documentPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
            kind: "collection",
            id: reference.id,
          },
          activeRoutes,
          diagnostics,
        );
      }
    }
  }

  return activeRoutes;
}

function validateExternalRedirectTarget(
  value: string,
  path: string,
  diagnostics: Diagnostic[],
): boolean {
  return validateAbsoluteHttpUrl(
    value,
    path,
    "continuity.redirect.external_target_invalid",
    "External redirect targets",
    diagnostics,
  );
}

function validateRedirects(
  publication: PublicationManifest,
  activeRoutes: ReadonlyMap<string, ActiveRoute>,
  diagnostics: Diagnostic[],
  deferInternalTerminalResolution = false,
): void {
  const redirects = publication.continuity?.redirects ?? [];
  const records: RedirectRecord[] = [];
  const firstBySource = new Map<string, RedirectRecord>();

  redirects.forEach((redirect, index) => {
    const fromPath = `/continuity/redirects/${index}/from`;
    const toPath = `/continuity/redirects/${index}/to`;
    const validSource = validateOriginRelativeRoute(
      redirect.from,
      fromPath,
      CANONICAL_PUBLICATION_MANIFEST_PATH,
      diagnostics,
    );
    const internalTarget = redirect.to.startsWith("/");
    const validTarget = internalTarget
      ? validateOriginRelativeRoute(
          redirect.to,
          toPath,
          CANONICAL_PUBLICATION_MANIFEST_PATH,
          diagnostics,
        )
      : validateExternalRedirectTarget(redirect.to, toPath, diagnostics);
    const record = {
      from: redirect.from,
      to: redirect.to,
      index,
      internalTarget,
      validSource,
      validTarget,
    };
    records.push(record);

    const first = firstBySource.get(redirect.from);
    if (first !== undefined) {
      diagnostics.push(
        diagnostic(
          "continuity.redirect.duplicate_source",
          fromPath,
          `Redirect source "${redirect.from}" is declared more than once.`,
          "uniqueRedirectSource",
          {
            source: redirect.from,
            firstIndex: first.index,
            duplicateIndex: index,
          },
        ),
      );
    } else if (validSource) {
      firstBySource.set(redirect.from, record);
    }

    if (validSource && activeRoutes.has(redirect.from)) {
      diagnostics.push(
        diagnostic(
          "continuity.redirect.active_route_source",
          fromPath,
          `Redirect source "${redirect.from}" collides with an active route.`,
          "inactiveRedirectSource",
          { source: redirect.from, activeRoute: activeRoutes.get(redirect.from) },
        ),
      );
    }
  });

  const resolutionByRoute = new Map<string, RedirectResolution>();

  const resolveRedirectRoute = (startRoute: string): RedirectResolution => {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let cursor = startRoute;
    let resolution: RedirectResolution | undefined;

    while (resolution === undefined) {
      if (activeRoutes.has(cursor)) {
        resolution = { kind: "active", terminalRoute: cursor };
        break;
      }

      const memoized = resolutionByRoute.get(cursor);
      if (memoized !== undefined) {
        resolution = memoized;
        break;
      }

      const repeatedAt = pathIndex.get(cursor);
      if (repeatedAt !== undefined) {
        const cycle = path.slice(repeatedAt);
        const closedCycle = [...cycle, cycle[0] ?? cursor];
        let anchorIndex = Number.MAX_SAFE_INTEGER;
        for (const route of cycle) {
          anchorIndex = Math.min(
            anchorIndex,
            firstBySource.get(route)?.index ?? Number.MAX_SAFE_INTEGER,
          );
        }
        diagnostics.push(
          diagnostic(
            "continuity.redirect.loop",
            `/continuity/redirects/${
              anchorIndex === Number.MAX_SAFE_INTEGER ? 0 : anchorIndex
            }/to`,
            `Redirects form a loop: ${closedCycle.join(" -> ")}.`,
            "acyclicRedirects",
            { routes: closedCycle },
          ),
        );
        resolution = {
          kind: "cycle",
          terminalRoute: cycle[0] ?? cursor,
        };
        break;
      }

      pathIndex.set(cursor, path.length);
      path.push(cursor);
      const redirect = firstBySource.get(cursor);
      if (redirect === undefined || !redirect.validTarget) {
        resolution = { kind: "unresolved", terminalRoute: cursor };
      } else if (!redirect.internalTarget) {
        resolution = { kind: "external", terminalRoute: redirect.to };
      } else {
        cursor = redirect.to;
      }
    }

    for (const route of path) {
      resolutionByRoute.set(route, resolution);
    }
    return resolution;
  };

  for (const source of firstBySource.keys()) {
    resolveRedirectRoute(source);
  }

  for (const start of records) {
    if (!start.validSource || !start.validTarget || !start.internalTarget) {
      continue;
    }

    const resolution = resolveRedirectRoute(start.to);
    if (
      resolution.kind === "unresolved" &&
      !deferInternalTerminalResolution
    ) {
      diagnostics.push(
        diagnostic(
          "continuity.redirect.internal_target_unresolved",
          `/continuity/redirects/${start.index}/to`,
          `Internal redirect chain from "${start.from}" does not terminate at an active route or external HTTP URL.`,
          "activeRedirectTarget",
          {
            source: start.from,
            target: start.to,
            terminalRoute: resolution.terminalRoute,
            terminatedAtExternalRoute: false,
          },
        ),
      );
    }
  }
}

function validateSourceContainment(
  sourcePath: string,
  path: "/manuscript" | "/assets",
  documentPath: string,
  sourceRoots: readonly string[],
  diagnostics: Diagnostic[],
): void {
  if (!sourceRoots.some((root) => isPathWithinRoot(sourcePath, root))) {
    diagnostics.push(
      diagnostic(
        "boundary.source_outside_root",
        path,
        `Source "${sourcePath}" is outside every declared source root.`,
        "sourceContainment",
        { sourcePath, sourceRoots },
        documentPath,
      ),
    );
  }
}

function registerSourcePathOwner(
  owners: Map<string, SourcePathOwner>,
  sourcePath: string,
  owner: SourcePathOwner,
  diagnostics: Diagnostic[],
): void {
  if (isReservedHostIntegrationPath(sourcePath)) {
    diagnostics.push(
      diagnostic(
        "source.path_reserved",
        owner.pointer,
        `Host integration path "${sourcePath}" cannot be used as publication source.`,
        "reservedHostIntegrationPath",
        {
          sourcePath,
          role: owner.role,
          ...(owner.entityId === undefined
            ? {}
            : { entityId: owner.entityId }),
        },
        owner.documentPath,
      ),
    );
  }
  const sourceIdentity =
    portableRepositoryPathIdentity(sourcePath);
  const first = owners.get(sourceIdentity);
  if (first === undefined) {
    owners.set(sourceIdentity, owner);
    return;
  }
  diagnostics.push(
    diagnostic(
      "source.path_owner_collision",
      owner.pointer,
      `Source path "${sourcePath}" is assigned to more than one publication entity.`,
      "uniqueSourcePathOwner",
      {
        sourcePath,
        role: owner.role,
        ...(owner.entityId === undefined
          ? {}
          : { entityId: owner.entityId }),
        documentPath: owner.documentPath,
        firstRole: first.role,
        ...(first.entityId === undefined
          ? {}
          : { firstEntityId: first.entityId }),
        firstDocumentPath: first.documentPath,
        firstPointer: first.pointer,
      },
      owner.documentPath,
    ),
  );
}

function pathsOverlap(
  left: string,
  right: string,
): boolean {
  return (
    isPathWithinRoot(left, right) ||
    isPathWithinRoot(right, left)
  );
}

interface AssetRootTrieNode {
  readonly children: Map<string, AssetRootTrieNode>;
  firstOwner?: ResolvedWorkSource;
  owner?: ResolvedWorkSource;
}

function conflictingAssetRootOwner(
  root: AssetRootTrieNode,
  assetsPath: string,
): ResolvedWorkSource | undefined {
  let node = root;
  for (
    const segment of
      portableRepositoryPathIdentity(assetsPath).split("/")
  ) {
    if (node.owner !== undefined) {
      return node.owner;
    }
    const child = node.children.get(segment);
    if (child === undefined) {
      return undefined;
    }
    node = child;
  }
  return node.owner ?? node.firstOwner;
}

function registerAssetRootOwner(
  root: AssetRootTrieNode,
  assetsPath: string,
  work: ResolvedWorkSource,
): void {
  let node = root;
  node.firstOwner ??= work;
  for (
    const segment of
      portableRepositoryPathIdentity(assetsPath).split("/")
  ) {
    let child = node.children.get(segment);
    if (child === undefined) {
      child = { children: new Map() };
      node.children.set(segment, child);
    }
    child.firstOwner ??= work;
    node = child;
  }
  node.owner ??= work;
}

function validateAssetRootOwnership(
  sharedAssetsRoot: string,
  works: readonly ResolvedWorkSource[],
  diagnostics: Diagnostic[],
): void {
  const claimedWorkRoots: AssetRootTrieNode = {
    children: new Map(),
  };
  for (const work of works) {
    if (work.assetsPath === undefined) {
      continue;
    }
    if (pathsOverlap(sharedAssetsRoot, work.assetsPath)) {
      diagnostics.push(
        diagnostic(
          "asset.root_owner_overlap",
          "/assets",
          `Work asset root "${work.assetsPath}" overlaps shared asset root "${sharedAssetsRoot}".`,
          "disjointAssetRoots",
          {
            sharedAssetsRoot,
            workAssetsRoot: work.assetsPath,
            workId: work.workId,
          },
          work.manifestPath,
        ),
      );
      continue;
    }
    const first = conflictingAssetRootOwner(
      claimedWorkRoots,
      work.assetsPath,
    );
    if (first !== undefined) {
      diagnostics.push(
        diagnostic(
          "asset.root_owner_overlap",
          "/assets",
          `Work asset root "${work.assetsPath}" overlaps the asset root owned by work "${first.workId}".`,
          "disjointAssetRoots",
          {
            workAssetsRoot: work.assetsPath,
            workId: work.workId,
            firstWorkAssetsRoot: first.assetsPath,
            firstWorkId: first.workId,
            firstDocumentPath: first.manifestPath,
          },
          work.manifestPath,
        ),
      );
      continue;
    }
    registerAssetRootOwner(
      claimedWorkRoots,
      work.assetsPath,
      work,
    );
  }
}

function resolveLoadedSourceGraph(
  input: SemanticValidationInput,
  layout: ResolvedPublicationLayout,
  diagnostics: Diagnostic[],
): Pick<ResolvedPublicationSourceGraph, "works" | "collections"> {
  const knownWorkIds = new Set(input.publication.works.map(({ id }) => id));
  const sourceRoots = input.publication.boundaries.sourceRoots;
  const works: ResolvedWorkSource[] = [];
  const collections: ResolvedCollectionSource[] = [];
  const sourcePathOwners = new Map<string, SourcePathOwner>();
  registerSourcePathOwner(
    sourcePathOwners,
    layout.publicationManifestPath,
    {
      role: "publication-manifest",
      documentPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
      pointer: "",
    },
    diagnostics,
  );
  for (const reference of layout.works.manifests) {
    registerSourcePathOwner(
      sourcePathOwners,
      reference.manifestPath,
      {
        role: "work-manifest",
        entityId: reference.id,
        documentPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
        pointer: reference.referencePointer,
      },
      diagnostics,
    );
  }
  for (const reference of layout.collections.manifests) {
    registerSourcePathOwner(
      sourcePathOwners,
      reference.manifestPath,
      {
        role: "collection-manifest",
        entityId: reference.id,
        documentPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
        pointer: reference.referencePointer,
      },
      diagnostics,
    );
  }

  for (const reference of layout.works.manifests) {
    const work = input.workManifests.get(reference.manifestPath);
    if (work === undefined) {
      diagnostics.push(
        diagnostic(
          "work.manifest.missing",
          reference.referencePointer,
          `No loaded work manifest matches "${reference.manifestPath}".`,
          "referencedManifest",
          { id: reference.id, manifestPath: reference.manifestPath },
        ),
      );
      continue;
    }

    validateSchemaVersion(
      work.schemaVersion,
      SUPPORTED_SCHEMA_VERSIONS.work,
      reference.manifestPath,
      diagnostics,
    );
    if (work.id !== reference.id) {
      diagnostics.push(
        diagnostic(
          "work.id_mismatch",
          "/id",
          `Work manifest ID "${work.id}" does not match catalog ID "${reference.id}".`,
          "crossFileId",
          {
            expectedId: reference.id,
            actualId: work.id,
            referencePointer: reference.referencePointer,
          },
          reference.manifestPath,
        ),
      );
    }

    const sourceResult = resolveWorkSourcePaths(reference.manifestPath, work);
    diagnostics.push(...sourceResult.diagnostics);
    if (sourceResult.valid) {
      registerSourcePathOwner(
        sourcePathOwners,
        sourceResult.value.manuscriptPath,
        {
          role: "manuscript",
          entityId: reference.id,
          documentPath: reference.manifestPath,
          pointer: "/manuscript",
        },
        diagnostics,
      );

      validateSourceContainment(
        sourceResult.value.manuscriptPath,
        "/manuscript",
        reference.manifestPath,
        sourceRoots,
        diagnostics,
      );
      if (sourceResult.value.assetsPath !== undefined) {
        validateSourceContainment(
          sourceResult.value.assetsPath,
          "/assets",
          reference.manifestPath,
          sourceRoots,
          diagnostics,
        );
      }

      works.push({
        ...sourceResult.value,
        referenceIndex: reference.referenceIndex,
        referencePointer: reference.referencePointer,
        manifest: work,
      });
    }
  }

  for (const reference of layout.collections.manifests) {
    const collection = input.collectionManifests.get(reference.manifestPath);
    if (collection === undefined) {
      diagnostics.push(
        diagnostic(
          "collection.manifest.missing",
          reference.referencePointer,
          `No loaded collection manifest matches "${reference.manifestPath}".`,
          "referencedManifest",
          { id: reference.id, manifestPath: reference.manifestPath },
        ),
      );
      continue;
    }

    validateSchemaVersion(
      collection.schemaVersion,
      SUPPORTED_SCHEMA_VERSIONS.collection,
      reference.manifestPath,
      diagnostics,
    );
    if (collection.id !== reference.id) {
      diagnostics.push(
        diagnostic(
          "collection.id_mismatch",
          "/id",
          `Collection manifest ID "${collection.id}" does not match catalog ID "${reference.id}".`,
          "crossFileId",
          {
            expectedId: reference.id,
            actualId: collection.id,
            referencePointer: reference.referencePointer,
          },
          reference.manifestPath,
        ),
      );
    }

    if (
      collection.workIds.length >
      PUBLICATION_PROTOCOL_LIMITS.maximumWorks
    ) {
      diagnostics.push(
        diagnostic(
          "collection.resource_limit",
          "/workIds",
          `Collection workIds exceed the protocol limit of ${PUBLICATION_PROTOCOL_LIMITS.maximumWorks.toLocaleString("en-US")}.`,
          "maxItems",
          {
            resource: "workIds",
            actualItems: collection.workIds.length,
            maximumItems:
              PUBLICATION_PROTOCOL_LIMITS.maximumWorks,
          },
          reference.manifestPath,
        ),
      );
      continue;
    }

    const firstWorkIndex = new Map<string, number>();
    collection.workIds.forEach((workId, index) => {
      const firstIndex = firstWorkIndex.get(workId);
      if (firstIndex !== undefined) {
        diagnostics.push(
          diagnostic(
            "collection.work_id_duplicate",
            `/workIds/${index}`,
            `Collection work ID "${workId}" is declared more than once.`,
            "uniqueItems",
            { workId, firstIndex, duplicateIndex: index },
            reference.manifestPath,
          ),
        );
      } else {
        firstWorkIndex.set(workId, index);
      }

      if (!knownWorkIds.has(workId)) {
        diagnostics.push(
          diagnostic(
            "collection.unknown_work_id",
            `/workIds/${index}`,
            `Collection references unknown work ID "${workId}".`,
            "knownWorkReference",
            { workId, collectionId: collection.id },
            reference.manifestPath,
          ),
        );
      }
    });

    collections.push({
      collectionId: collection.id,
      manifestPath: reference.manifestPath,
      referenceIndex: reference.referenceIndex,
      referencePointer: reference.referencePointer,
      manifest: collection,
    });
  }

  validateAssetRootOwnership(
    layout.assetsRoot,
    works,
    diagnostics,
  );
  return { works, collections };
}

/**
 * Validates every publication-manifest invariant that does not require opening
 * a child manifest. Loaders use this least-authority gate before traversing any
 * work or collection path.
 */
export function validatePublicationPreflight(
  input: PublicationPreflightInput,
): ValidationResult<ResolvedPublicationLayout> {
  const resourceDiagnostics =
    validatePublicationResourceLimits(input.publication);
  if (resourceDiagnostics.length > 0) {
    return immutableSnapshot({
      valid: false,
      diagnostics: resourceDiagnostics,
    });
  }

  const diagnostics = createDiagnosticCollector();
  const layoutResult = resolvePublicationLayout(input.publication);
  diagnostics.push(...layoutResult.diagnostics);
  validateSchemaVersion(
    input.publication.schemaVersion,
    SUPPORTED_SCHEMA_VERSIONS.publication,
    CANONICAL_PUBLICATION_MANIFEST_PATH,
    diagnostics,
  );
  validateEngineCompatibility(
    input.publication,
    input.engineVersion,
    diagnostics,
  );
  validateUniqueIds(
    input.publication.works,
    "/works",
    "work.reference.duplicate_id",
    "work",
    diagnostics,
  );
  validateUniqueIds(
    input.publication.collections ?? [],
    "/collections",
    "collection.reference.duplicate_id",
    "collection",
    diagnostics,
  );
  validateUniqueIds(
    input.publication.extensions ?? [],
    "/extensions",
    "extension.duplicate_id",
    "extension",
    diagnostics,
  );
  validatePublicationUrls(input.publication, diagnostics);
  validateAttribution(input.publication, diagnostics);

  const activeRoutes = new Map<string, ActiveRoute>();
  if (
    validateOriginRelativeRoute(
      input.publication.routes.home,
      "/routes/home",
      CANONICAL_PUBLICATION_MANIFEST_PATH,
      diagnostics,
    )
  ) {
    addActiveRoute(
      {
        route: input.publication.routes.home,
        path: "/routes/home",
        documentPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
        kind: "home",
      },
      activeRoutes,
      diagnostics,
    );
  }
  validateUpdatesRoutes(input.publication, activeRoutes, diagnostics);
  validateOriginRelativeRoute(
    input.publication.routes.work,
    "/routes/work",
    CANONICAL_PUBLICATION_MANIFEST_PATH,
    diagnostics,
    "{workId}",
  );
  const collectionCount =
    input.publication.collections?.length ?? 0;
  if (
    collectionCount > 0 &&
    input.publication.routes.collection === undefined
  ) {
    diagnostics.push(
      diagnostic(
        "route.collection.required",
        "/routes/collection",
        "A collection route is required when the publication has collections.",
        "required",
        { collectionCount },
      ),
    );
  } else if (input.publication.routes.collection !== undefined) {
    validateOriginRelativeRoute(
      input.publication.routes.collection,
      "/routes/collection",
      CANONICAL_PUBLICATION_MANIFEST_PATH,
      diagnostics,
      "{collectionId}",
    );
  }
  validateRedirects(
    input.publication,
    activeRoutes,
    diagnostics,
    true,
  );

  if (diagnostics.length > 0 || !layoutResult.valid) {
    return immutableSnapshot({
      valid: false,
      diagnostics: sortDiagnostics(diagnostics),
    });
  }
  return immutableSnapshot({
    valid: true,
    value: layoutResult.value,
    diagnostics: [],
  });
}

/**
 * Checks relationships between already shape-validated manifests. The caller
 * loads files and injects immutable path keyed maps; this function performs no
 * filesystem access and never mutates publication source.
 */
function validatePublicationSemanticsInternal(
  input: SemanticValidationInput,
  deferRedirectTerminalResolution: boolean,
): ValidationResult<ResolvedPublicationSourceGraph> {
  const resourceDiagnostics =
    validatePublicationResourceLimits(input.publication);
  if (resourceDiagnostics.length > 0) {
    return immutableSnapshot({
      valid: false,
      diagnostics: resourceDiagnostics,
    });
  }
  const diagnostics = createDiagnosticCollector();
  const layoutResult = resolvePublicationLayout(input.publication);
  diagnostics.push(...layoutResult.diagnostics);
  if (layoutResult.valid) {
    let collectionWorkReferenceCount = 0;
    for (const reference of layoutResult.value.collections.manifests) {
      const manifest = input.collectionManifests.get(
        reference.manifestPath,
      );
      if (manifest === undefined) {
        continue;
      }
      collectionWorkReferenceCount += manifest.workIds.length;
      if (
        collectionWorkReferenceCount >
        PUBLICATION_PROTOCOL_LIMITS.maximumCollectionWorkReferences
      ) {
        return immutableSnapshot({
          valid: false,
          diagnostics: [
            diagnostic(
              "publication.resource_limit",
              "/collections",
              `Collection work references exceed the protocol limit of ${PUBLICATION_PROTOCOL_LIMITS.maximumCollectionWorkReferences.toLocaleString("en-US")}.`,
              "maxItems",
              {
                resource: "collectionWorkReferences",
                actualItems: collectionWorkReferenceCount,
                maximumItems:
                  PUBLICATION_PROTOCOL_LIMITS
                    .maximumCollectionWorkReferences,
              },
            ),
          ],
        });
      }
    }
  }

  validateSchemaVersion(
    input.publication.schemaVersion,
    SUPPORTED_SCHEMA_VERSIONS.publication,
    CANONICAL_PUBLICATION_MANIFEST_PATH,
    diagnostics,
  );
  validateEngineCompatibility(
    input.publication,
    input.engineVersion,
    diagnostics,
  );
  validateUniqueIds(
    input.publication.works,
    "/works",
    "work.reference.duplicate_id",
    "work",
    diagnostics,
  );
  validateUniqueIds(
    input.publication.collections ?? [],
    "/collections",
    "collection.reference.duplicate_id",
    "collection",
    diagnostics,
  );
  validateUniqueIds(
    input.publication.extensions ?? [],
    "/extensions",
    "extension.duplicate_id",
    "extension",
    diagnostics,
  );
  validatePublicationUrls(input.publication, diagnostics);
  validateAttribution(input.publication, diagnostics);

  const activeRoutes = validateRoutes(
    input,
    layoutResult.valid ? layoutResult.value : undefined,
    diagnostics,
  );
  validateRedirects(
    input.publication,
    activeRoutes,
    diagnostics,
    deferRedirectTerminalResolution,
  );

  const sources = layoutResult.valid
    ? resolveLoadedSourceGraph(input, layoutResult.value, diagnostics)
    : undefined;
  if (diagnostics.length > 0 || !layoutResult.valid || sources === undefined) {
    return immutableSnapshot({
      valid: false,
      diagnostics: sortDiagnostics(diagnostics),
    });
  }

  return immutableSnapshot({
    valid: true,
    value: {
      layout: layoutResult.value,
      works: sources.works,
      collections: sources.collections,
    },
    diagnostics: [],
  });
}

export function validatePublicationSemantics(
  input: SemanticValidationInput,
): ValidationResult<ResolvedPublicationSourceGraph> {
  return validatePublicationSemanticsInternal(input, false);
}

/**
 * Resolves the manifest-owned source graph before adapter-owned section routes
 * exist. Redirect syntax, source ownership, uniqueness, and cycles are still
 * validated here. A content compiler must validate internal terminal routes
 * after adapter-owned routes exist and before it accepts or serializes an
 * artifact.
 */
export function resolvePublicationSourcesForContentCompilation(
  input: SemanticValidationInput,
): ValidationResult<ResolvedPublicationSourceGraph> {
  return validatePublicationSemanticsInternal(input, true);
}
