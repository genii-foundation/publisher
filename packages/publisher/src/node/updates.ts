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

import { createHash } from "node:crypto";

import { canonicalizeJson } from "@genii-foundation/publisher-content";
import {
  validateUpdatesEnvelopeShape,
} from "@genii-foundation/publisher-schema";
import type {
  Diagnostic,
  JSONValue,
  PackageReference,
  PublicationRoutes,
  UpdatesCatalog,
  UpdatesCatalogView,
  UpdatesEnvelope,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import { PUBLISHER_VERSION } from "../index.js";
import {
  loaderDiagnostic,
  sortAndFreezeDiagnostics,
} from "./diagnostics.js";

const UPDATES_ENVELOPE_SCHEMA_URL =
  "https://publisher.genii.foundation/schemas/updates-envelope.schema.json" as const;

export interface ResolvePublicationUpdatesInput {
  readonly catalog: UpdatesCatalog;
  readonly declaredCatalogPath: string;
  readonly publicationId: string;
  readonly routes: PublicationRoutes;
}

export interface ResolvedPublicationUpdates {
  readonly declaredCatalogPath: string;
  readonly views: readonly UpdatesCatalogView[];
}

function updatesDiagnostic(
  code: string,
  path: string,
  message: string,
  params: Readonly<Record<string, unknown>>,
  documentPath?: string,
): Diagnostic {
  return loaderDiagnostic(
    code,
    path,
    message,
    "updates",
    params,
    documentPath,
  );
}

function declaredViewIds(routes: PublicationRoutes): readonly string[] {
  if (routes.updates === undefined) {
    return Object.freeze([]);
  }
  return typeof routes.updates === "string"
    ? Object.freeze(["updates"])
    : Object.freeze(routes.updates.map(({ id }) => id));
}

export function resolvePublicationUpdates(
  input: ResolvePublicationUpdatesInput,
): ValidationResult<ResolvedPublicationUpdates> {
  const diagnostics: Diagnostic[] = [];
  const expectedIds = declaredViewIds(input.routes);
  const expected = new Set(expectedIds);
  const seenViews = new Set<string>();

  if (input.catalog.publicationId !== input.publicationId) {
    diagnostics.push(
      updatesDiagnostic(
        "updates.catalog.publication_mismatch",
        "/publicationId",
        `The Updates catalog belongs to publication "${input.catalog.publicationId}", not "${input.publicationId}".`,
        {
          actualPublicationId: input.catalog.publicationId,
          expectedPublicationId: input.publicationId,
        },
        input.declaredCatalogPath,
      ),
    );
  }

  for (const [viewIndex, view] of input.catalog.views.entries()) {
    if (seenViews.has(view.id)) {
      diagnostics.push(
        updatesDiagnostic(
          "updates.catalog.view_duplicate",
          `/views/${viewIndex}/id`,
          `The Updates catalog declares view "${view.id}" more than once.`,
          { viewId: view.id },
          input.declaredCatalogPath,
        ),
      );
    }
    seenViews.add(view.id);
    if (!expected.has(view.id)) {
      diagnostics.push(
        updatesDiagnostic(
          "updates.catalog.view_undeclared",
          `/views/${viewIndex}/id`,
          `The Updates catalog declares view "${view.id}", but no Updates route uses that identity.`,
          { viewId: view.id, expectedViewIds: expectedIds },
          input.declaredCatalogPath,
        ),
      );
    }
    const entries = new Set<string>();
    for (const [entryIndex, entry] of view.entries.entries()) {
      if (entries.has(entry.id)) {
        diagnostics.push(
          updatesDiagnostic(
            "updates.catalog.entry_duplicate",
            `/views/${viewIndex}/entries/${entryIndex}/id`,
            `View "${view.id}" declares entry "${entry.id}" more than once.`,
            { viewId: view.id, entryId: entry.id },
            input.declaredCatalogPath,
          ),
        );
      }
      entries.add(entry.id);
    }
  }

  for (const viewId of expectedIds) {
    if (!seenViews.has(viewId)) {
      diagnostics.push(
        updatesDiagnostic(
          "updates.catalog.view_missing",
          "/views",
          `Updates route "${viewId}" has no matching catalog view.`,
          { viewId },
          input.declaredCatalogPath,
        ),
      );
    }
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
      declaredCatalogPath: input.declaredCatalogPath,
      views: input.catalog.views,
    }),
    diagnostics: Object.freeze([]),
  });
}

export interface BuildUpdatesEnvelopeInput {
  readonly updates: ResolvedPublicationUpdates;
  readonly adapter: PackageReference;
  readonly publicationId: string;
  readonly buildId: string;
  readonly catalogText: string;
}

export interface BuiltUpdatesEnvelope {
  readonly envelope: UpdatesEnvelope;
  readonly text: string;
}

export function buildUpdatesEnvelope(
  input: BuildUpdatesEnvelopeInput,
): ValidationResult<BuiltUpdatesEnvelope> {
  const envelope = {
    $schema: UPDATES_ENVELOPE_SCHEMA_URL,
    schemaVersion: "1.0" as const,
    publicationId: input.publicationId,
    engineVersion: PUBLISHER_VERSION,
    buildId: input.buildId,
    source: {
      adapter: {
        package: input.adapter.package,
        ...(input.adapter.config === undefined
          ? {}
          : { config: input.adapter.config }),
      },
      catalogPath: input.updates.declaredCatalogPath,
      catalogSha256: `sha256:${createHash("sha256")
        .update(input.catalogText, "utf8")
        .digest("hex")}`,
    },
    views: input.updates.views,
  };
  const validated = validateUpdatesEnvelopeShape(envelope);
  if (!validated.valid) {
    return Object.freeze({
      valid: false as const,
      diagnostics: sortAndFreezeDiagnostics(validated.diagnostics),
    });
  }

  try {
    const text = `${canonicalizeJson(envelope as unknown as JSONValue)}\n`;
    return Object.freeze({
      valid: true as const,
      value: Object.freeze({ envelope: validated.value, text }),
      diagnostics: Object.freeze([]),
    });
  } catch (error) {
    return Object.freeze({
      valid: false as const,
      diagnostics: sortAndFreezeDiagnostics([
        updatesDiagnostic(
          "updates.envelope.unserializable",
          "",
          `The Updates envelope could not be serialized: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { reason: "unserializableEnvelope" },
          input.updates.declaredCatalogPath,
        ),
      ]),
    });
  }
}
