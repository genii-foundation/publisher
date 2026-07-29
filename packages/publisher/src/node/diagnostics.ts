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
  Diagnostic,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

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
      (key) =>
        `${JSON.stringify(key)}:${stableSerialize(record[key])}`,
    )
    .join(",")}}`;
}

function snapshotValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(snapshotValue));
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      continue;
    }
    result[key] = snapshotValue(descriptor.value);
  }
  return Object.freeze(result);
}

export function loaderDiagnostic(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>>,
  documentPath?: string,
): Diagnostic {
  return Object.freeze({
    severity: "error" as const,
    code,
    ...(documentPath === undefined ? {} : { documentPath }),
    path,
    message,
    keyword,
    params: snapshotValue(params) as Readonly<
      Record<string, unknown>
    >,
  });
}

export function attachDocumentPath(
  diagnostics: readonly Diagnostic[],
  documentPath: string,
): readonly Diagnostic[] {
  return diagnostics.map((item) =>
    Object.freeze({
      ...item,
      documentPath,
      params: snapshotValue(item.params) as Readonly<
        Record<string, unknown>
      >,
    }),
  );
}

export function sortAndFreezeDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return Object.freeze(
    [...diagnostics]
      .map((item) =>
        Object.freeze({
          ...item,
          params: snapshotValue(item.params) as Readonly<
            Record<string, unknown>
          >,
        }),
      )
      .sort(
        (left, right) =>
          compareText(
            left.documentPath ?? "",
            right.documentPath ?? "",
          ) ||
          compareText(left.path, right.path) ||
          compareText(left.code, right.code) ||
          compareText(left.message, right.message) ||
          compareText(
            stableSerialize(left.params),
            stableSerialize(right.params),
          ),
      ),
  );
}

export function invalidResult<T>(
  diagnostics: readonly Diagnostic[],
): ValidationResult<T> {
  return Object.freeze({
    valid: false as const,
    diagnostics: sortAndFreezeDiagnostics(diagnostics),
  });
}

export class LoaderFailure extends Error {
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super("Publication source loading failed.");
    this.name = "LoaderFailure";
    this.diagnostic = diagnostic;
  }
}

export function operatingSystemErrorCode(
  error: unknown,
): string | undefined {
  if (error === null || typeof error !== "object") {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}
