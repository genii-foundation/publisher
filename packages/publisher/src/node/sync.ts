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

// What a publication offers to synchronize.
//
// The sync block has been in the schema from the beginning and no code has ever
// read it. Its capability list accepted any identifier, so a publication could
// declare a capability no provider implements and find out from a reader whose
// data never arrived. The vocabulary is closed now, and this module is what makes
// the declaration reach something: a declaration nothing reads is decoration.
//
// The privacy default is enforced by shape rather than by policy. `consent` is
// pinned to opt-in and `localFallback` to true in the manifest schema, and both
// are carried into the artifact instead of left implicit, so a client cannot be
// built against a publication that quietly relaxed either one.
//
// The provider is recorded and never executed, for the same reason the audio
// adapter is: a third-party package is data to read, not code to run in order to
// decide what a publication is.
//
// One thing this deliberately does not carry is the provider's configuration. The
// artifact is served publicly, and a provider config is author-supplied: it may
// hold a project reference, an endpoint, or a key nobody meant to publish. The
// schema has no field for it and refuses additional properties, so the mistake is
// unavailable rather than merely discouraged.

import { canonicalizeJson } from "@genii-foundation/publisher-content";
import {
  SYNC_CAPABILITIES,
  validateSyncEnvelopeShape,
} from "@genii-foundation/publisher-schema";
import type {
  Diagnostic,
  JSONValue,
  SyncCapability,
  SyncConfiguration,
  SyncEnvelope,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import {
  loaderDiagnostic,
  sortAndFreezeDiagnostics,
} from "./diagnostics.js";
import {
  PUBLISHER_VERSION,
} from "../index.js";

const SYNC_ENVELOPE_SCHEMA_URL =
  "https://publisher.genii.foundation/schemas/sync-envelope.schema.json" as const;
const SYNC_ENVELOPE_SCHEMA_VERSION = "1.0" as const;

/** The data artifact identifier synchronization is published under. */
export const SYNC_DATA_ARTIFACT = "sync";

export interface ResolvedPublicationSync {
  readonly providerPackage: string;
  readonly capabilities: readonly SyncCapability[];
}

function syncDiagnostic(
  code: string,
  path: string,
  message: string,
  params: Readonly<Record<string, unknown>>,
): Diagnostic {
  return loaderDiagnostic(code, path, message, "sync", params);
}

/**
 * Checks a declared sync block beyond what the schema can express.
 *
 * The schema closes the capability vocabulary, so this is left with the checks
 * that need more than one field at a time.
 */
export function resolvePublicationSync(
  sync: SyncConfiguration,
): ValidationResult<ResolvedPublicationSync> {
  const diagnostics: Diagnostic[] = [];

  // Belt and braces against a caller that built a manifest in memory rather than
  // validating one. The schema refuses these, and a publication reaching this
  // module has been through it, but this module is exported and an exported entry
  // point that trusts its input is a hole waiting for a second caller.
  const unknown = sync.capabilities.filter(
    (capability) => !SYNC_CAPABILITIES.includes(capability),
  );
  for (const capability of unknown) {
    diagnostics.push(
      syncDiagnostic(
        "sync.capability.unknown",
        "/sync/capabilities",
        `"${capability}" is not a capability this engine recognizes. Declare one of ${SYNC_CAPABILITIES.join(", ")}, or remove it.`,
        { capability, known: SYNC_CAPABILITIES },
      ),
    );
  }

  // Enforced here as well as in the schema, because these two are the privacy
  // default. A schema constant protects a manifest read from disk; this protects
  // every other route into the engine.
  if (sync.consent !== "opt-in") {
    diagnostics.push(
      syncDiagnostic(
        "sync.consent.not_opt_in",
        "/sync/consent",
        "Synchronization is opt-in and cannot be declared otherwise. A reader's progress is private until they ask for it to travel.",
        { declared: sync.consent },
      ),
    );
  }
  if (sync.localFallback !== true) {
    diagnostics.push(
      syncDiagnostic(
        "sync.local_fallback.required",
        "/sync/localFallback",
        "Synchronization is additive to local reading and cannot be a precondition for it. A reader who declines, or whose provider is unreachable, still reads.",
        { declared: sync.localFallback },
      ),
    );
  }

  if (diagnostics.length > 0) {
    return Object.freeze({
      valid: false as const,
      diagnostics: sortAndFreezeDiagnostics(diagnostics),
    });
  }

  return Object.freeze({
    valid: true as const,
    value: Object.freeze({
      providerPackage: sync.provider.package,
      // Sorted, so the artifact does not change when an author reorders a list
      // whose order carries no meaning.
      capabilities: Object.freeze([...sync.capabilities].sort()),
    }),
    diagnostics: Object.freeze([]),
  });
}

export interface BuildSyncEnvelopeInput {
  readonly sync: ResolvedPublicationSync;
  readonly publicationId: string;
  /** The reader artifact's build identity, carried verbatim. */
  readonly buildId: string;
}

export interface BuiltSyncEnvelope {
  readonly envelope: SyncEnvelope;
  /** Canonical JSON text, exactly as it would be written. */
  readonly text: string;
}

/**
 * Builds the artifact that tells a client what may be synchronized.
 *
 * Validated before it is returned, because the engine writes this one and serves
 * it publicly.
 */
export function buildSyncEnvelope(
  input: BuildSyncEnvelopeInput,
): ValidationResult<BuiltSyncEnvelope> {
  const envelope = {
    $schema: SYNC_ENVELOPE_SCHEMA_URL,
    schemaVersion: SYNC_ENVELOPE_SCHEMA_VERSION,
    publicationId: input.publicationId,
    engineVersion: PUBLISHER_VERSION,
    buildId: input.buildId,
    // Package only. There is no config field to copy into, which is the point.
    provider: { package: input.sync.providerPackage },
    consent: "opt-in" as const,
    localFallback: true as const,
    capabilities: input.sync.capabilities,
  };

  const validated = validateSyncEnvelopeShape(envelope);
  if (!validated.valid) {
    return Object.freeze({
      valid: false as const,
      diagnostics: sortAndFreezeDiagnostics([...validated.diagnostics]),
    });
  }

  let text: string;
  try {
    text = `${canonicalizeJson(envelope as unknown as JSONValue)}\n`;
  } catch (error) {
    return Object.freeze({
      valid: false as const,
      diagnostics: sortAndFreezeDiagnostics([
        syncDiagnostic(
          "sync.envelope.unserializable",
          "",
          `The sync envelope could not be serialized: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { reason: "unserializableEnvelope" },
        ),
      ]),
    });
  }

  return Object.freeze({
    valid: true as const,
    value: Object.freeze({ envelope: validated.value, text }),
    diagnostics: Object.freeze([]),
  });
}
