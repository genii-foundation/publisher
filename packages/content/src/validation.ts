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
  inspectCanonicalRoutePath,
  inspectCanonicalUrlFragment,
  isAbsoluteHttpUrl,
  type Diagnostic,
} from "@genii-foundation/publisher-schema";

const EXACT_SEMVER_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_EXACT_SEMVER_LENGTH = 256;

export const EXACT_SEMVER = Object.freeze({
  test(value: string): boolean {
    return (
      value.length <= MAX_EXACT_SEMVER_LENGTH &&
      EXACT_SEMVER_PATTERN.test(value)
    );
  },
});
export const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const PACKAGE_NAME =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function diagnostic(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>>,
  documentPath?: string,
): Diagnostic {
  const safeParams = sanitizeParams(params);
  const result = {
    code,
    severity: "error" as const,
    path,
    message,
    keyword,
    params: safeParams,
  };
  return documentPath === undefined
    ? result
    : { ...result, documentPath };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sanitizeParams(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? {}
      : (JSON.parse(serialized) as Readonly<Record<string, unknown>>);
  } catch {
    return { reason: "unserializableDiagnosticParameters" };
  }
}

function stableParams(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(sanitizeParams(value));
}

export function sortDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return diagnostics
    .map((item) => ({ ...item, params: sanitizeParams(item.params) }))
    .sort(
    (left, right) =>
      compareText(left.documentPath ?? "", right.documentPath ?? "") ||
      compareText(left.path, right.path) ||
      compareText(left.code, right.code) ||
      compareText(left.keyword, right.keyword) ||
      compareText(left.message, right.message) ||
      compareText(stableParams(left.params), stableParams(right.params)),
    );
}

function validatePortableId(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  maximumLength: number,
  keyword: "contentId" | "stableId",
  documentPath?: string,
): boolean {
  if (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    STABLE_ID.test(value)
  ) {
    return true;
  }
  diagnostics.push(
    diagnostic(
      "content.id.invalid",
      path,
      typeof value === "string"
        ? `"${value}" is not a portable stable identifier.`
        : "The value is not a portable stable identifier.",
      keyword,
      typeof value === "string"
        ? { value }
        : { actualType: value === null ? "null" : typeof value },
      documentPath,
    ),
  );
  return false;
}

export function validateStableId(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  documentPath?: string,
): boolean {
  return validatePortableId(
    value,
    path,
    diagnostics,
    128,
    "stableId",
    documentPath,
  );
}

export function validateContentId(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  documentPath?: string,
): boolean {
  return validatePortableId(
    value,
    path,
    diagnostics,
    256,
    "contentId",
    documentPath,
  );
}

export function validatePackageName(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): boolean {
  if (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 214 &&
    PACKAGE_NAME.test(value)
  ) {
    return true;
  }
  diagnostics.push(
    diagnostic(
      "content.package.invalid",
      path,
      "A producer package must be a portable npm package name.",
      "packageName",
      typeof value === "string"
        ? { value }
        : { actualType: value === null ? "null" : typeof value },
    ),
  );
  return false;
}

export function validateUrlFragment(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): boolean {
  const inspection = inspectCanonicalUrlFragment(value);
  if (inspection.valid) {
    return true;
  }
  diagnostics.push(
    diagnostic(
      "content.fragment.invalid",
      path,
      "A URL fragment must be a non-empty portable RFC 3986 fragment without its leading hash.",
      "urlFragment",
      typeof value === "string"
        ? { issue: inspection.issue, value }
        : {
            actualType: value === null ? "null" : typeof value,
            issue: inspection.issue,
          },
    ),
  );
  return false;
}

export function validateRoute(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  documentPath?: string,
): boolean {
  if (typeof value !== "string") {
    diagnostics.push(
      diagnostic(
        "content.route.invalid",
        path,
        "The value is not a concrete origin-relative route.",
        "route",
        { actualType: value === null ? "null" : typeof value },
        documentPath,
      ),
    );
    return false;
  }

  const inspection = inspectCanonicalRoutePath(value);
  if (inspection.valid) {
    return true;
  }
  diagnostics.push(
    diagnostic(
      "content.route.invalid",
      path,
      `"${value}" is not a concrete origin-relative route.`,
      "route",
      { issue: inspection.issue, value },
      documentPath,
    ),
  );
  return false;
}

export function validateAbsoluteHttpUrl(value: unknown): boolean {
  return isAbsoluteHttpUrl(value);
}

export function validateResolvedHref(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): boolean {
  if (typeof value === "string" && value.startsWith("/")) {
    const firstFragment = value.indexOf("#");
    if (firstFragment === -1) {
      return validateRoute(value, path, diagnostics);
    }

    const route = value.slice(0, firstFragment);
    const anchor = value.slice(firstFragment + 1);
    const oneFragment = !anchor.includes("#");
    const validRoute = validateRoute(route, path, diagnostics);
    const anchorDiagnostics: Diagnostic[] = [];
    const validAnchor = validateUrlFragment(
      anchor,
      path,
      anchorDiagnostics,
    );

    if (validRoute && oneFragment && validAnchor) {
      return true;
    }
    if (validRoute) {
      diagnostics.push(
        diagnostic(
          "content.href.anchor_invalid",
          path,
          "An internal link must contain exactly one portable URL fragment.",
          "resolvedHref",
          {
            anchor,
            fragmentCount: value.split("#").length - 1,
          },
        ),
      );
    }
    return false;
  }

  if (validateAbsoluteHttpUrl(value)) {
    return true;
  }

  diagnostics.push(
    diagnostic(
      "content.href.invalid",
      path,
      typeof value === "string"
        ? `"${value}" is neither a concrete route nor a credential-free HTTP URL.`
        : "The value is neither a concrete route nor a credential-free HTTP URL.",
      "resolvedHref",
      typeof value === "string"
        ? { value }
        : { actualType: value === null ? "null" : typeof value },
    ),
  );
  return false;
}
