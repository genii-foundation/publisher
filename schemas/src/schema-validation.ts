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

import { immutableSnapshot } from "./immutability.js";
import {
  snapshotPublicationEnvelopeForValidation,
  type EnvelopeResourceLimitViolation,
  type PublicationEnvelopeKind,
} from "./envelope-resource-limits.js";
import {
  audioCatalogValidator,
  audioCheckpointValidator,
  audioEnvelopeValidator,
  collectionValidator,
  contentEnvelopeValidator,
  publicationValidator,
  readerEnvelopeValidator,
  syncEnvelopeValidator,
  updatesCatalogValidator,
  updatesEnvelopeValidator,
  workValidator,
} from "./generated-validators.js";
import type {
  StandaloneValidationError,
  StandaloneValidateFunction,
} from "./generated-validators.js";
import type {
  AudioClipCatalog,
  AudioCheckpoint,
  AudioEnvelope,
  CollectionManifest,
  Diagnostic,
  ManifestByKind,
  ManifestKind,
  PublicationManifest,
  SyncEnvelope,
  UpdatesCatalog,
  UpdatesEnvelope,
  ValidationResult,
  WorkManifest,
} from "./types.js";
import type { PublicationContentEnvelope } from "./content-types.js";
import type { PublicationReaderEnvelope } from "./reader-types.js";

export const SHAPE_DIAGNOSTIC_CODES = Object.freeze({
  additionalProperty: "schema.additional_property",
  const: "schema.const",
  enum: "schema.enum",
  format: "schema.format",
  invalid: "schema.invalid",
  maxItems: "schema.max_items",
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
  truncated: "schema.diagnostics_truncated",
});

export const MAXIMUM_SHAPE_DIAGNOSTICS = 256;

/**
 * Explanations for refusals whose reason is not visible in the schema.
 *
 * Keyed by schema path, because that is what identifies the exact constraint and it
 * keeps the explanation beside the rule rather than in whichever caller happens to
 * surface it.
 *
 * This exists for one narrow case and should not become a home for restating
 * ordinary type errors. The attribution constants are fixed for a licensing reason
 * that nothing in the schema conveys, and "must be equal to constant" alongside
 * "Copyright 2026 GENII Foundation" reads as the engine demanding an author credit
 * the Foundation for their own book. That is the first wall a new author meets, and
 * it was the first thing that stopped me when I authored a publication against this
 * engine.
 *
 * The code, keyword, and params are untouched. Only the sentence a person reads
 * gains the reason.
 */
const SCHEMA_PATH_EXPLANATIONS: Readonly<Record<string, string>> =
  Object.freeze({
    "#/$defs/attribution/properties/copyright/const":
      "This engine is licensed under CPAL 1.0, which requires that the Original Developer's attribution be displayed, so the notice is fixed and cannot be rewritten. It is not a claim over your work. Your own copyright has no field in this manifest yet, and sourceCodeUrl is the one attribution field you set.",
    "#/$defs/attribution/properties/text/const":
      "The attribution phrase is part of the CPAL 1.0 notice this engine must display, so it is fixed. sourceCodeUrl is the one attribution field you set.",
    "#/$defs/attribution/properties/url/const":
      "The attribution URL is part of the CPAL 1.0 notice this engine must display, so it is fixed. sourceCodeUrl is the one attribution field you set.",
    "#/$defs/attribution/properties/placement/const":
      "The attribution notice must appear in the footer, which is where CPAL 1.0 attribution is displayed for this engine.",
  });

function explainedMessage(
  message: string,
  schemaPath: string | undefined,
): string {
  const explanation =
    schemaPath === undefined
      ? undefined
      : SCHEMA_PATH_EXPLANATIONS[schemaPath];
  return explanation === undefined
    ? message
    : `${message}. ${explanation}`;
}

const SCHEMA_CODE_BY_KEYWORD: Readonly<Record<string, string>> = {
  additionalProperties: SHAPE_DIAGNOSTIC_CODES.additionalProperty,
  const: SHAPE_DIAGNOSTIC_CODES.const,
  enum: SHAPE_DIAGNOSTIC_CODES.enum,
  format: SHAPE_DIAGNOSTIC_CODES.format,
  maxItems: SHAPE_DIAGNOSTIC_CODES.maxItems,
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

function escapeJsonPointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function appendJsonPointerToken(path: string, token: string): string {
  return `${path}/${escapeJsonPointerToken(token)}`;
}

function diagnosticPath(error: StandaloneValidationError): string {
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

const boundedDiagnosticTotals =
  new WeakMap<readonly Diagnostic[], number>();

function createBoundedDiagnosticCollector(): Diagnostic[] {
  const retained: Diagnostic[] = [];
  boundedDiagnosticTotals.set(retained, 0);
  Object.defineProperty(retained, "push", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: (...items: Diagnostic[]): number => {
      const maximumDetails = MAXIMUM_SHAPE_DIAGNOSTICS - 1;
      let total =
        boundedDiagnosticTotals.get(retained) ??
        retained.length;
      for (const item of items) {
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
      boundedDiagnosticTotals.set(retained, total);
      return retained.length;
    },
  });
  return retained;
}

function boundedDiagnostics(
  diagnostics: readonly Diagnostic[],
  omittedDiagnostics = 0,
): readonly Diagnostic[] {
  const maximumDetails = MAXIMUM_SHAPE_DIAGNOSTICS - 1;
  const sorted = [...diagnostics].sort(compareDiagnostics);
  const totalDiagnostics =
    boundedDiagnosticTotals.get(diagnostics) ??
    diagnostics.length;
  const omitted =
    omittedDiagnostics +
    Math.max(0, totalDiagnostics - maximumDetails);
  if (omitted === 0) {
    return sorted;
  }
  return [
    ...sorted.slice(0, maximumDetails),
    {
      code: SHAPE_DIAGNOSTIC_CODES.truncated,
      severity: "error" as const,
      path: "",
      message:
        "Further schema diagnostics were omitted after the fixed reporting limit.",
      keyword: "diagnosticLimit",
      params: {
        maximumDiagnostics: MAXIMUM_SHAPE_DIAGNOSTICS,
        omittedDiagnostics: omitted,
      },
    },
  ].sort(compareDiagnostics);
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
  const diagnostics = createBoundedDiagnosticCollector();
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
    const keys = Reflect.ownKeys(objectValue).sort((left, right) => {
      if (typeof left === "symbol") {
        return typeof right === "symbol"
          ? compareText(String(left), String(right))
          : -1;
      }
      if (typeof right === "symbol") {
        return 1;
      }
      return compareText(left, right);
    });
    const childFrames: JsonTraversalFrame[] = [];
    for (const key of keys) {
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

      childFrames.push({
        path: appendJsonPointerToken(frame.path, key),
        value: descriptor.value,
      });
    }

    for (let index = childFrames.length - 1; index >= 0; index -= 1) {
      const childFrame = childFrames[index];
      if (childFrame !== undefined) {
        stack.push(childFrame);
      }
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

  return boundedDiagnostics(diagnostics);
}

function envelopeResourceDiagnostic(
  violation: EnvelopeResourceLimitViolation,
  kind: PublicationEnvelopeKind,
): Diagnostic {
  const subject = kind === "generic" ? "manifest" : "envelope";
  return {
    code: "schema.resource_limit",
    severity: "error",
    path: violation.path,
    message:
      `The ${subject} exceeds the fixed ${violation.resource} limit of ${violation.maximumItems.toLocaleString("en-US")}.`,
    keyword: violation.keyword,
    params: {
      resource: violation.resource,
      actualItems: violation.actualItems,
      maximumItems: violation.maximumItems,
    },
  };
}

function createDiagnostics(
  errors: readonly StandaloneValidationError[] | null | undefined,
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

  const diagnostics = createBoundedDiagnosticCollector();
  for (const error of errors) {
    diagnostics.push({
        code: diagnosticCode(error.keyword),
        severity: "error",
        path: diagnosticPath(error),
        message: explainedMessage(
          error.message ?? "The value does not satisfy the schema.",
          error.schemaPath,
        ),
        keyword: error.keyword,
        params: { ...error.params },
        schemaPath: error.schemaPath,
      });
  }
  return boundedDiagnostics(diagnostics);
}

function validatePreparedShape<T>(
  validator: StandaloneValidateFunction<T>,
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

function invalidSnapshotResult(
  snapshot: {
    readonly path: string;
    readonly reason:
      | "cyclicReference"
      | "resourceLimit"
      | "uninspectableEnvelope";
    readonly violations: readonly EnvelopeResourceLimitViolation[];
  },
  input: unknown,
  kind: PublicationEnvelopeKind,
): ValidationResult<never> {
  if (snapshot.reason === "resourceLimit") {
    return immutableSnapshot({
      valid: false,
      diagnostics: snapshot.violations
        .map((violation) => envelopeResourceDiagnostic(violation, kind))
        .sort(compareDiagnostics),
    });
  }
  if (snapshot.reason === "cyclicReference") {
    return immutableSnapshot({
      valid: false,
      diagnostics: [
        nonJsonDiagnostic(
          snapshot.path,
          "cyclicReference",
          "object",
        ),
      ],
    });
  }
  return immutableSnapshot({
    valid: false,
    diagnostics: [
      nonJsonDiagnostic(
        snapshot.path,
        "uninspectableValue",
        typeof input,
      ),
    ],
  });
}

function validateShape<T>(
  validator: StandaloneValidateFunction<T>,
  input: unknown,
): ValidationResult<T> {
  const snapshot = snapshotPublicationEnvelopeForValidation(
    input,
    "generic",
  );
  if (!snapshot.valid) {
    return invalidSnapshotResult(snapshot, input, "generic");
  }
  return validatePreparedShape(validator, snapshot.value);
}

function validateEnvelopeShape<T>(
  validator: StandaloneValidateFunction<T>,
  input: unknown,
  kind: PublicationEnvelopeKind,
): ValidationResult<T> {
  const snapshot = snapshotPublicationEnvelopeForValidation(input, kind);
  if (!snapshot.valid) {
    return invalidSnapshotResult(snapshot, input, kind);
  }
  return validatePreparedShape(validator, snapshot.value);
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

export function validateContentEnvelopeShape(
  input: unknown,
): ValidationResult<PublicationContentEnvelope> {
  return validateEnvelopeShape(
    contentEnvelopeValidator,
    input,
    "content",
  );
}

export function validateReaderEnvelopeShape(
  input: unknown,
): ValidationResult<PublicationReaderEnvelope> {
  return validateEnvelopeShape(
    readerEnvelopeValidator,
    input,
    "reader",
  );
}

/**
 * Validates a published audio clip catalog.
 *
 * A source document rather than an engine artifact, so it goes through the
 * generic snapshot path alongside the manifests instead of the envelope path.
 * The catalog carries no build identity by design: the engine emits a separate
 * audio envelope that is bound to a build, and conflating the two would let a
 * stale catalog claim to describe a publication it predates.
 */
export function validateAudioCatalogShape(
  input: unknown,
): ValidationResult<AudioClipCatalog> {
  return validateShape(audioCatalogValidator, input);
}

/** Validates immutable author lifecycle evidence for one narration checkpoint. */
export function validateAudioCheckpointShape(
  input: unknown,
): ValidationResult<AudioCheckpoint> {
  return validateShape(audioCheckpointValidator, input);
}

/**
 * Validates a materialized audio envelope.
 *
 * The engine writes this one, so validating it is validating the engine's own
 * output. That is the point: an artifact a client fetches should be refused here
 * rather than at a reader's browser.
 */
export function validateAudioEnvelopeShape(
  input: unknown,
): ValidationResult<AudioEnvelope> {
  return validateShape(audioEnvelopeValidator, input);
}

/**
 * Validates a materialized sync envelope.
 *
 * The engine writes this one and serves it publicly, so refusing a bad shape here
 * beats discovering it in a browser.
 */
export function validateSyncEnvelopeShape(
  input: unknown,
): ValidationResult<SyncEnvelope> {
  return validateShape(syncEnvelopeValidator, input);
}

export function validateUpdatesCatalogShape(
  input: unknown,
): ValidationResult<UpdatesCatalog> {
  return validateShape(updatesCatalogValidator, input);
}

export function validateUpdatesEnvelopeShape(
  input: unknown,
): ValidationResult<UpdatesEnvelope> {
  return validateShape(updatesEnvelopeValidator, input);
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
