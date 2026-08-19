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
  canonicalizeJson,
  hashCanonicalJson,
} from "@genii-foundation/publisher-content";
import type {
  ResolvedExtensionInput,
} from "@genii-foundation/publisher-content";
import {
  EXTENSION_CAPABILITIES,
} from "@genii-foundation/publisher-schema";
import type {
  CompiledContentPayload,
  CompiledExtension,
  Diagnostic,
  ExtensionCapability,
  JSONValue,
  PublicationContentEnvelope,
  PublicationManifest,
  PublicationReaderEnvelope,
  Sha256Digest,
  ValidationResult,
} from "@genii-foundation/publisher-schema";
import {
  satisfies,
  valid,
  validRange,
} from "semver";

import {
  PUBLISHER_VERSION,
} from "../index.js";
import {
  invalidResult,
  loaderDiagnostic,
  sortAndFreezeDiagnostics,
} from "./diagnostics.js";

export const PUBLISHER_EXTENSION_API_VERSION = "1.0";
export const PUBLISHER_EXTENSION_DATA_SCHEMA_VERSION = "1.0";

export interface PublisherExtensionProjectInput {
  readonly content: PublicationContentEnvelope;
  readonly config: Readonly<Record<string, JSONValue>>;
  readonly payloads: readonly CompiledContentPayload[];
}

export interface PublisherExtensionProjection {
  readonly serverData?: JSONValue;
  readonly clientData?: JSONValue;
}

export interface PublisherExtensionImplementation {
  readonly kind: "genii.publisher.extension";
  readonly apiVersion: typeof PUBLISHER_EXTENSION_API_VERSION;
  readonly project?: (
    input: PublisherExtensionProjectInput,
  ) =>
    | ValidationResult<PublisherExtensionProjection>
    | Promise<ValidationResult<PublisherExtensionProjection>>;
}

export interface PublisherExtensionRegistration {
  readonly id: string;
  readonly package: string;
  readonly version: string;
  readonly engineCompatibility: string;
  readonly capabilities: readonly ExtensionCapability[];
  readonly implementation: PublisherExtensionImplementation;
  readonly renderer?: unknown;
}

export interface ResolvedPublisherExtensions {
  readonly compilerInputs: readonly ResolvedExtensionInput[];
  readonly registrations: readonly PublisherExtensionRegistration[];
}

export interface PublisherExtensionDataEntry {
  readonly id: string;
  readonly package: string;
  readonly version: string;
  readonly capabilities: readonly ExtensionCapability[];
  readonly config: Readonly<Record<string, JSONValue>>;
  readonly serverData?: JSONValue;
  readonly clientData?: JSONValue;
}

export interface PublisherExtensionDataEnvelope {
  readonly schemaVersion:
    typeof PUBLISHER_EXTENSION_DATA_SCHEMA_VERSION;
  readonly publicationId: string;
  readonly engineVersion: string;
  readonly readerBuildId: Sha256Digest;
  readonly extensions: readonly PublisherExtensionDataEntry[];
  readonly buildId: Sha256Digest;
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>> = {},
): Diagnostic {
  return loaderDiagnostic(code, path, message, keyword, params);
}

function inspectRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Readonly<Record<string, unknown>> | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return null;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as Record<string, PropertyDescriptor>;
    const keys = Object.keys(descriptors);
    const allowed = new Set([...required, ...optional]);
    if (
      keys.some((key) => !allowed.has(key)) ||
      required.some((key) => !Object.hasOwn(descriptors, key))
    ) {
      return null;
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return null;
      }
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch {
    return null;
  }
}

function inspectArray(
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors.length;
    const length = lengthDescriptor !== undefined &&
        "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > maximumLength
    ) {
      return null;
    }
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return null;
      }
      snapshot.push(descriptor.value);
    }
    if (
      Object.keys(descriptors).some((key) =>
        key !== "length" &&
        (!Number.isSafeInteger(Number(key)) ||
          Number(key) < 0 ||
          Number(key) >= length ||
          String(Number(key)) !== key)
      )
    ) {
      return null;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function isCapability(value: unknown): value is ExtensionCapability {
  return typeof value === "string" &&
    EXTENSION_CAPABILITIES.includes(value as ExtensionCapability);
}

function cloneCapabilities(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): readonly ExtensionCapability[] {
  const inspected = inspectArray(value, EXTENSION_CAPABILITIES.length);
  if (inspected === null || inspected.length === 0) {
    diagnostics.push(
      diagnostic(
        "publisher.extension.capabilities_invalid",
        path,
        "An extension registration must declare a nonempty supported capability list.",
        "minItems",
      ),
    );
    return Object.freeze([]);
  }
  const capabilities: ExtensionCapability[] = [];
  const seen = new Set<string>();
  inspected.forEach((capability, index) => {
    if (!isCapability(capability) || seen.has(capability)) {
      diagnostics.push(
        diagnostic(
          "publisher.extension.capability_invalid",
          `${path}/${index}`,
          "Extension registrations use the closed unique capability vocabulary.",
          "extensionCapability",
          { capability },
        ),
      );
      return;
    }
    seen.add(capability);
    capabilities.push(capability);
  });
  return Object.freeze(capabilities);
}

function snapshotJson(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): JSONValue | undefined {
  try {
    const text = canonicalizeJson(value as JSONValue);
    return JSON.parse(text) as JSONValue;
  } catch {
    diagnostics.push(
      diagnostic(
        "publisher.extension.projection_json_invalid",
        path,
        "Extension projection data must be finite canonical JSON data.",
        "jsonData",
      ),
    );
    return undefined;
  }
}

function freezeJson(value: JSONValue): JSONValue {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      freezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function resolvePublisherExtensions(
  publication: PublicationManifest,
  registrationsInput: unknown,
): ValidationResult<ResolvedPublisherExtensions> {
  const diagnostics: Diagnostic[] = [];
  const declared = publication.extensions ?? [];
  const registrationInputs = inspectArray(registrationsInput, 1_000);
  if (registrationInputs === null) {
    return invalidResult([
      diagnostic(
        "publisher.extension.registry_invalid",
        "/extensions",
        "The author extension registry must export an array.",
        "type",
      ),
    ]);
  }
  const byId = new Map<string, PublisherExtensionRegistration>();
  registrationInputs.forEach((value, index) => {
    const path = `/extensions/${index}`;
    const record = inspectRecord(
      value,
      [
        "id",
        "package",
        "version",
        "engineCompatibility",
        "capabilities",
        "implementation",
      ],
      ["renderer"],
    );
    if (record === null) {
      diagnostics.push(
        diagnostic(
          "publisher.extension.registration_invalid",
          path,
          "Extension registrations must use the closed registration shape.",
          "properties",
        ),
      );
      return;
    }
    const id = record.id;
    const packageName = record.package;
    const version = record.version;
    const engineCompatibility = record.engineCompatibility;
    const capabilities = cloneCapabilities(
      record.capabilities,
      `${path}/capabilities`,
      diagnostics,
    );
    const implementationRecord = inspectRecord(
      record.implementation,
      ["kind", "apiVersion"],
      ["project"],
    );
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof packageName !== "string" ||
      packageName.length === 0 ||
      typeof version !== "string" ||
      valid(version) !== version ||
      typeof engineCompatibility !== "string" ||
      validRange(engineCompatibility) === null ||
      !satisfies(PUBLISHER_VERSION, engineCompatibility, {
        includePrerelease: true,
      }) ||
      implementationRecord === null ||
      implementationRecord.kind !== "genii.publisher.extension" ||
      implementationRecord.apiVersion !== PUBLISHER_EXTENSION_API_VERSION ||
      (implementationRecord.project !== undefined &&
        typeof implementationRecord.project !== "function")
    ) {
      diagnostics.push(
        diagnostic(
          "publisher.extension.registration_identity_invalid",
          path,
          "Extension registration identity, compatibility, or implementation is invalid.",
          "extensionRegistration",
        ),
      );
      return;
    }
    if (
      capabilities.includes("content.project") &&
      typeof implementationRecord.project !== "function"
    ) {
      diagnostics.push(
        diagnostic(
          "publisher.extension.projector_missing",
          `${path}/implementation/project`,
          "An extension supporting content.project must supply its projector.",
          "required",
        ),
      );
    }
    if (byId.has(id)) {
      diagnostics.push(
        diagnostic(
          "publisher.extension.registration_duplicate",
          `${path}/id`,
          `Extension registration "${id}" appears more than once.`,
          "uniqueItems",
          { id },
        ),
      );
      return;
    }
    byId.set(id, Object.freeze({
      id,
      package: packageName,
      version,
      engineCompatibility,
      capabilities,
      implementation: Object.freeze({
        kind: "genii.publisher.extension" as const,
        apiVersion: PUBLISHER_EXTENSION_API_VERSION,
        ...(implementationRecord.project === undefined
          ? {}
          : {
              project: implementationRecord.project as NonNullable<
                PublisherExtensionImplementation["project"]
              >,
            }),
      }) as PublisherExtensionImplementation,
      ...(record.renderer === undefined
        ? {}
        : { renderer: record.renderer }),
    }));
  });

  const selected: PublisherExtensionRegistration[] = [];
  const compilerInputs: ResolvedExtensionInput[] = [];
  declared.forEach((extension, index) => {
    const path = `/publication/extensions/${index}`;
    const registration = byId.get(extension.id);
    if (
      registration === undefined ||
      registration.package !== extension.package
    ) {
      diagnostics.push(
        diagnostic(
          "publisher.extension.resolution_missing",
          path,
          `Declared extension "${extension.id}" has no matching explicit author registration.`,
          "extensionResolution",
          { id: extension.id, package: extension.package },
        ),
      );
      return;
    }
    const unsupported = extension.capabilities.filter(
      (capability) => !registration.capabilities.includes(capability),
    );
    if (unsupported.length > 0) {
      diagnostics.push(
        diagnostic(
          "publisher.extension.grant_unsupported",
          `${path}/capabilities`,
          `Extension "${extension.id}" does not support every granted capability.`,
          "extensionCapability",
          { unsupported },
        ),
      );
      return;
    }
    selected.push(registration);
    compilerInputs.push(Object.freeze({
      id: extension.id,
      package: extension.package,
      version: registration.version,
      capabilities: Object.freeze([...extension.capabilities]),
    }));
  });

  if (diagnostics.length > 0) {
    return invalidResult(diagnostics);
  }
  return Object.freeze({
    valid: true as const,
    value: Object.freeze({
      compilerInputs: Object.freeze(compilerInputs),
      registrations: Object.freeze(selected),
    }),
    diagnostics: sortAndFreezeDiagnostics([]),
  });
}

export async function projectPublisherExtensions(input: {
  readonly content: PublicationContentEnvelope;
  readonly reader: PublicationReaderEnvelope;
  readonly registrations: readonly PublisherExtensionRegistration[];
}): Promise<ValidationResult<{
  readonly envelope: PublisherExtensionDataEnvelope;
  readonly text: string;
}>> {
  const diagnostics: Diagnostic[] = [];
  const entries: PublisherExtensionDataEntry[] = [];
  for (const [index, compiled] of input.content.extensions.entries()) {
    const registration = input.registrations[index];
    if (
      registration === undefined ||
      registration.id !== compiled.id ||
      registration.package !== compiled.package ||
      registration.version !== compiled.version
    ) {
      diagnostics.push(
        diagnostic(
          "publisher.extension.projection_identity_mismatch",
          `/extensions/${index}`,
          "Extension projection registration does not match compiled identity.",
          "identity",
        ),
      );
      continue;
    }
    let projection: PublisherExtensionProjection = {};
    if (compiled.capabilities.includes("content.project")) {
      let result: unknown;
      try {
        result = await registration.implementation.project?.(
          Object.freeze({
            content: input.content,
            config: compiled.config ?? Object.freeze({}),
            payloads: Object.freeze(
              compiled.payloadIds.map((payloadId) =>
                input.content.payloads.find(({ id }) => id === payloadId),
              ).filter(
                (payload): payload is CompiledContentPayload =>
                  payload !== undefined,
              ),
            ),
          }),
        );
      } catch {
        diagnostics.push(
          diagnostic(
            "publisher.extension.projector_threw",
            `/extensions/${index}`,
            `Extension "${compiled.id}" threw while projecting content.`,
            "extensionProjector",
          ),
        );
        continue;
      }
      const resultRecord = inspectRecord(
        result,
        ["valid", "value", "diagnostics"],
      );
      if (
        resultRecord === null ||
        resultRecord.valid !== true ||
        !Array.isArray(resultRecord.diagnostics)
      ) {
        diagnostics.push(
          diagnostic(
            "publisher.extension.projector_invalid",
            `/extensions/${index}`,
            `Extension "${compiled.id}" did not return a valid projection result.`,
            "extensionProjector",
          ),
        );
        continue;
      }
      const inspected = inspectRecord(
        resultRecord.value,
        [],
        ["serverData", "clientData"],
      );
      if (inspected === null) {
        diagnostics.push(
          diagnostic(
            "publisher.extension.projection_invalid",
            `/extensions/${index}`,
            "Extension projections use the closed serverData and clientData shape.",
            "properties",
          ),
        );
        continue;
      }
      const serverData = inspected.serverData === undefined
        ? undefined
        : snapshotJson(
            inspected.serverData,
            `/extensions/${index}/serverData`,
            diagnostics,
          );
      const clientData = inspected.clientData === undefined
        ? undefined
        : snapshotJson(
            inspected.clientData,
            `/extensions/${index}/clientData`,
            diagnostics,
          );
      if (
        clientData !== undefined &&
        !compiled.capabilities.includes("renderer.client")
      ) {
        diagnostics.push(
          diagnostic(
            "publisher.extension.client_data_ungranted",
            `/extensions/${index}/clientData`,
            "An extension cannot emit browser data without renderer.client authority.",
            "extensionCapability",
          ),
        );
        continue;
      }
      projection = Object.freeze({
        ...(serverData === undefined
          ? {}
          : { serverData: freezeJson(serverData) }),
        ...(clientData === undefined
          ? {}
          : { clientData: freezeJson(clientData) }),
      });
    }
    entries.push(Object.freeze({
      id: compiled.id,
      package: compiled.package,
      version: compiled.version,
      capabilities: Object.freeze([...compiled.capabilities]),
      config: compiled.config ?? Object.freeze({}),
      ...projection,
    }));
  }
  if (diagnostics.length > 0) {
    return invalidResult(diagnostics);
  }
  const basis = Object.freeze({
    schemaVersion: PUBLISHER_EXTENSION_DATA_SCHEMA_VERSION,
    publicationId: input.reader.publicationId,
    engineVersion: input.reader.engineVersion,
    readerBuildId: input.reader.buildId,
    extensions: Object.freeze(entries),
  });
  const buildId = hashCanonicalJson(basis as unknown as JSONValue);
  const envelope: PublisherExtensionDataEnvelope = Object.freeze({
    ...basis,
    buildId,
  });
  return Object.freeze({
    valid: true as const,
    value: Object.freeze({
      envelope,
      text: `${canonicalizeJson(envelope as unknown as JSONValue)}\n`,
    }),
    diagnostics: sortAndFreezeDiagnostics([]),
  });
}
