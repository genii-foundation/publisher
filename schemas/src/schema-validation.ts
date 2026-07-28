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

import { readFileSync } from "node:fs";

import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { immutableSnapshot } from "./immutability.js";
import type {
  CollectionManifest,
  Diagnostic,
  ManifestByKind,
  ManifestKind,
  PublicationManifest,
  ValidationResult,
  WorkManifest,
} from "./types.js";

type SchemaDocument = Readonly<Record<string, unknown>>;

export const SHAPE_DIAGNOSTIC_CODES = Object.freeze({
  additionalProperty: "schema.additional_property",
  const: "schema.const",
  enum: "schema.enum",
  format: "schema.format",
  invalid: "schema.invalid",
  maxLength: "schema.max_length",
  minItems: "schema.min_items",
  minLength: "schema.min_length",
  minProperties: "schema.min_properties",
  nonJsonValue: "schema.non_json_value",
  not: "schema.not",
  oneOf: "schema.one_of",
  pattern: "schema.pattern",
  required: "schema.required",
  type: "schema.type",
  uniqueItems: "schema.unique_items",
});

const SCHEMA_CODE_BY_KEYWORD: Readonly<Record<string, string>> = {
  additionalProperties: SHAPE_DIAGNOSTIC_CODES.additionalProperty,
  const: SHAPE_DIAGNOSTIC_CODES.const,
  enum: SHAPE_DIAGNOSTIC_CODES.enum,
  format: SHAPE_DIAGNOSTIC_CODES.format,
  maxLength: SHAPE_DIAGNOSTIC_CODES.maxLength,
  minItems: SHAPE_DIAGNOSTIC_CODES.minItems,
  minLength: SHAPE_DIAGNOSTIC_CODES.minLength,
  minProperties: SHAPE_DIAGNOSTIC_CODES.minProperties,
  not: SHAPE_DIAGNOSTIC_CODES.not,
  oneOf: SHAPE_DIAGNOSTIC_CODES.oneOf,
  pattern: SHAPE_DIAGNOSTIC_CODES.pattern,
  required: SHAPE_DIAGNOSTIC_CODES.required,
  type: SHAPE_DIAGNOSTIC_CODES.type,
  uniqueItems: SHAPE_DIAGNOSTIC_CODES.uniqueItems,
};

function readSchema(fileName: string): SchemaDocument {
  return JSON.parse(
    readFileSync(new URL(`../${fileName}`, import.meta.url), "utf8"),
  ) as SchemaDocument;
}

const ajv = new Ajv2020({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
  useDefaults: false,
  validateFormats: true,
});

addFormats(ajv);

const publicationValidator = ajv.compile<PublicationManifest>(
  readSchema("publication.schema.json"),
);
const workValidator = ajv.compile<WorkManifest>(
  readSchema("work.schema.json"),
);
const collectionValidator = ajv.compile<CollectionManifest>(
  readSchema("collection.schema.json"),
);

function escapeJsonPointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function appendJsonPointerToken(path: string, token: string): string {
  return `${path}/${escapeJsonPointerToken(token)}`;
}

function diagnosticPath(error: ErrorObject): string {
  if (
    error.keyword === "required" &&
    "missingProperty" in error.params &&
    typeof error.params.missingProperty === "string"
  ) {
    return appendJsonPointerToken(
      error.instancePath,
      error.params.missingProperty,
    );
  }

  if (
    error.keyword === "additionalProperties" &&
    "additionalProperty" in error.params &&
    typeof error.params.additionalProperty === "string"
  ) {
    return appendJsonPointerToken(
      error.instancePath,
      error.params.additionalProperty,
    );
  }

  return error.instancePath;
}

function diagnosticCode(keyword: string): string {
  return SCHEMA_CODE_BY_KEYWORD[keyword] ?? SHAPE_DIAGNOSTIC_CODES.invalid;
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    compareText(left.path, right.path) ||
    compareText(left.code, right.code) ||
    compareText(left.schemaPath ?? "", right.schemaPath ?? "") ||
    compareText(left.message, right.message)
  );
}

interface JsonTraversalFrame {
  readonly path: string;
  readonly value: unknown;
  readonly exit?: boolean;
}

function nonJsonDiagnostic(
  path: string,
  reason: string,
  actualType: string,
): Diagnostic {
  return {
    code: SHAPE_DIAGNOSTIC_CODES.nonJsonValue,
    severity: "error",
    path,
    message:
      "Manifest values must be JSON-compatible plain records, arrays, and primitives.",
    keyword: "jsonValue",
    params: { actualType, reason },
  };
}

function createJsonDomainDiagnostics(input: unknown): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const active = new WeakSet<object>();
  const completed = new WeakSet<object>();
  const stack: JsonTraversalFrame[] = [{ path: "", value: input }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      break;
    }

    const value = frame.value;
    if (frame.exit) {
      const objectValue = value as object;
      active.delete(objectValue);
      completed.add(objectValue);
      continue;
    }

    if (value === null) {
      continue;
    }

    const valueType = typeof value;
    if (valueType === "string" || valueType === "boolean") {
      continue;
    }
    if (valueType === "number") {
      if (!Number.isFinite(value)) {
        diagnostics.push(
          nonJsonDiagnostic(frame.path, "nonFiniteNumber", valueType),
        );
      }
      continue;
    }
    if (valueType !== "object") {
      diagnostics.push(
        nonJsonDiagnostic(frame.path, "unsupportedType", valueType),
      );
      continue;
    }

    const objectValue = value as object;
    if (completed.has(objectValue)) {
      continue;
    }
    if (active.has(objectValue)) {
      diagnostics.push(
        nonJsonDiagnostic(frame.path, "cyclicReference", "object"),
      );
      continue;
    }

    const arrayValue = Array.isArray(objectValue);
    const prototype = Object.getPrototypeOf(objectValue);
    if (
      !arrayValue &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      diagnostics.push(
        nonJsonDiagnostic(frame.path, "nonPlainObject", "object"),
      );
      completed.add(objectValue);
      continue;
    }

    active.add(objectValue);
    stack.push({ ...frame, exit: true });

    let arrayIndexCount = 0;
    for (const key of Reflect.ownKeys(objectValue)) {
      if (arrayValue && key === "length") {
        continue;
      }
      if (typeof key !== "string") {
        diagnostics.push(
          nonJsonDiagnostic(frame.path, "symbolKey", "symbol"),
        );
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        diagnostics.push(
          nonJsonDiagnostic(
            appendJsonPointerToken(frame.path, key),
            "nonDataProperty",
            "property",
          ),
        );
        continue;
      }

      if (arrayValue) {
        const index = Number(key);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= (objectValue as unknown[]).length ||
          String(index) !== key
        ) {
          diagnostics.push(
            nonJsonDiagnostic(
              appendJsonPointerToken(frame.path, key),
              "nonIndexArrayProperty",
              "property",
            ),
          );
          continue;
        }
        arrayIndexCount += 1;
      }

      stack.push({
        path: appendJsonPointerToken(frame.path, key),
        value: descriptor.value,
      });
    }

    if (
      arrayValue &&
      arrayIndexCount !== (objectValue as unknown[]).length
    ) {
      diagnostics.push(
        nonJsonDiagnostic(frame.path, "sparseArray", "array"),
      );
    }
  }

  return diagnostics.sort(compareDiagnostics);
}

function createDiagnostics(
  errors: readonly ErrorObject[] | null | undefined,
): readonly Diagnostic[] {
  if (errors === null || errors === undefined || errors.length === 0) {
    return [
      {
        code: SHAPE_DIAGNOSTIC_CODES.invalid,
        severity: "error",
        path: "",
        message: "The value does not satisfy the schema.",
        keyword: "unknown",
        params: {},
      },
    ];
  }

  return errors
    .map(
      (error): Diagnostic => ({
        code: diagnosticCode(error.keyword),
        severity: "error",
        path: diagnosticPath(error),
        message: error.message ?? "The value does not satisfy the schema.",
        keyword: error.keyword,
        params: { ...error.params },
        schemaPath: error.schemaPath,
      }),
    )
    .sort(compareDiagnostics);
}

function validateShape<T>(
  validator: ValidateFunction<T>,
  input: unknown,
): ValidationResult<T> {
  let jsonDomainDiagnostics: readonly Diagnostic[];
  try {
    jsonDomainDiagnostics = createJsonDomainDiagnostics(input);
  } catch {
    jsonDomainDiagnostics = [
      nonJsonDiagnostic("", "uninspectableValue", typeof input),
    ];
  }
  if (jsonDomainDiagnostics.length > 0) {
    return immutableSnapshot({
      valid: false,
      diagnostics: jsonDomainDiagnostics,
    });
  }

  try {
    if (validator(input)) {
      return Object.freeze({
        valid: true,
        value: input,
        diagnostics: Object.freeze([]),
      });
    }
  } catch {
    return immutableSnapshot({
      valid: false,
      diagnostics: [
        nonJsonDiagnostic("", "uninspectableValue", typeof input),
      ],
    });
  }

  return immutableSnapshot({
    valid: false,
    diagnostics: createDiagnostics(validator.errors),
  });
}

export function validatePublicationShape(
  input: unknown,
): ValidationResult<PublicationManifest> {
  return validateShape(publicationValidator, input);
}

export function validateWorkShape(
  input: unknown,
): ValidationResult<WorkManifest> {
  return validateShape(workValidator, input);
}

export function validateCollectionShape(
  input: unknown,
): ValidationResult<CollectionManifest> {
  return validateShape(collectionValidator, input);
}

export function validateManifestShape<K extends ManifestKind>(
  kind: K,
  input: unknown,
): ValidationResult<ManifestByKind[K]> {
  switch (kind) {
    case "publication":
      return validatePublicationShape(input) as ValidationResult<
        ManifestByKind[K]
      >;
    case "work":
      return validateWorkShape(input) as ValidationResult<ManifestByKind[K]>;
    case "collection":
      return validateCollectionShape(input) as ValidationResult<
        ManifestByKind[K]
      >;
  }
}
