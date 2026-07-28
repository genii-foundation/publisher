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

import type { Diagnostic } from "@genii-foundation/publisher-schema";

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
      : (JSON.parse(serialized) as Readonly<
          Record<string, unknown>
        >);
  } catch {
    return { reason: "unserializableDiagnosticParameters" };
  }
}

function stableParams(
  value: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify(sanitizeParams(value));
}

export function diagnostic(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>>,
): Diagnostic {
  return {
    code,
    severity: "error",
    path,
    message,
    keyword,
    params: sanitizeParams(params),
  };
}

export function sortDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return diagnostics
    .map((item) => ({
      ...item,
      params: sanitizeParams(item.params),
    }))
    .sort(
      (left, right) =>
        compareText(
          left.documentPath ?? "",
          right.documentPath ?? "",
        ) ||
        compareText(left.path, right.path) ||
        compareText(left.code, right.code) ||
        compareText(left.keyword, right.keyword) ||
        compareText(left.message, right.message) ||
        compareText(
          stableParams(left.params),
          stableParams(right.params),
        ),
    );
}
