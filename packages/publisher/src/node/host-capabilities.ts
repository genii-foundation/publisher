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

// Can this host serve this publication.
//
// A build produced an artifact and reported success. The host it was written into
// then threw on boot, because the publication declared an Updates route and the
// generated application is created with the reader alone and so has no Updates
// adapter to give. Nothing in the author path noticed. Both shipped fixtures
// declare that route, so the example a new author copies was the broken case.
//
// The check is against a capability set the renderer declares as data. The engine
// must not execute anything a renderer supplies in order to decide what a host can
// serve, for the same reason migration edges are data rather than code: a renderer
// is a third-party package.
//
// A renderer that declares nothing is refused rather than assumed capable. An
// absent declaration and a declaration of full support are different claims, and
// only one of them is safe to guess at.

import type {
  Diagnostic,
  PublicationReaderEnvelope,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import {
  invalidResult,
  loaderDiagnostic,
  sortAndFreezeDiagnostics,
} from "./diagnostics.js";

export interface HostCapabilities {
  readonly routeKinds: readonly string[];
  /**
   * Generated data artifacts beyond the reader artifact that this host can serve.
   *
   * Read as optional, unlike routeKinds, because renderers predating narration
   * declare no such field and must keep resolving. Absent yields an empty list,
   * so absence still means no support rather than assumed support.
   */
  readonly dataArtifacts: readonly string[];
}

/** The data artifact identifier narration is published under. */
export const AUDIO_DATA_ARTIFACT = "audio";
/** The data artifact identifier lazy full-text search is published under. */
export const SEARCH_DATA_ARTIFACT = "search";

export interface UnsupportedHostFeature {
  /** What the artifact contains that the host cannot serve. */
  readonly feature: string;
  /** Routes that carry it, so an author can find them. */
  readonly paths: readonly string[];
}

/**
 * Reads a renderer's declared capabilities, refusing anything unusable.
 *
 * Returns null when the module declares none, which callers treat as a refusal
 * rather than as unlimited capability.
 */
export function readHostCapabilities(
  module: Readonly<Record<string, unknown>>,
): HostCapabilities | null {
  const declared = module["PUBLISHER_NEXT_HOST_CAPABILITIES"];
  if (declared === null || typeof declared !== "object") {
    return null;
  }
  const routeKinds = (declared as { routeKinds?: unknown }).routeKinds;
  if (!Array.isArray(routeKinds)) {
    return null;
  }
  const kinds: string[] = [];
  for (const kind of routeKinds) {
    if (typeof kind !== "string" || kind.length === 0) {
      return null;
    }
    kinds.push(kind);
  }

  // Optional, so a renderer that predates data artifacts still resolves. Present
  // and malformed is a different claim from absent, though, and is refused: a
  // renderer that meant to declare support and got the shape wrong must not be
  // read as declaring none.
  const declaredArtifacts = (declared as { dataArtifacts?: unknown })
    .dataArtifacts;
  const artifacts: string[] = [];
  if (declaredArtifacts !== undefined) {
    if (!Array.isArray(declaredArtifacts)) {
      return null;
    }
    for (const artifact of declaredArtifacts) {
      if (typeof artifact !== "string" || artifact.length === 0) {
        return null;
      }
      artifacts.push(artifact);
    }
  }

  return Object.freeze({
    routeKinds: Object.freeze(kinds.sort()),
    dataArtifacts: Object.freeze(artifacts.sort()),
  });
}

/**
 * Decides whether this host can carry a generated data artifact.
 *
 * Separate from assertHostCanServe because the question is different. That one
 * asks whether the artifact's contents are servable; this asks whether the host
 * has anywhere to put a second file at all. A renderer with no declared place for
 * narration would otherwise have it written to a path of the engine's invention.
 */
export function assertHostCanCarryDataArtifact(input: {
  readonly artifact: string;
  readonly capabilities: HostCapabilities | null;
  readonly renderer: string;
  readonly declaredPath: string | undefined;
}): ValidationResult<true> {
  const supported =
    input.capabilities !== null &&
    input.capabilities.dataArtifacts.includes(input.artifact);
  const hasPath =
    typeof input.declaredPath === "string" && input.declaredPath.length > 0;

  if (supported && hasPath) {
    return Object.freeze({
      valid: true as const,
      value: true as const,
      diagnostics: Object.freeze([]),
    });
  }

  // One refusal covering both halves, because an author cannot act on them
  // differently: either way this renderer cannot take this artifact, and the fix
  // is a renderer that can.
  const reason = supported
    ? `declares it can carry the ${input.artifact} artifact but names no path for it`
    : `does not declare that it can carry the ${input.artifact} artifact`;
  return invalidResult([
    loaderDiagnostic(
      "host.data_artifact_unsupported",
      "",
      `The renderer ${input.renderer} ${reason}. This publication declares ${input.artifact}, so building it would write a file the host has no way to serve. Use a renderer that supports it, or remove the declaration.`,
      "dataArtifacts",
      {
        artifact: input.artifact,
        renderer: input.renderer,
        declaredArtifacts: input.capabilities?.dataArtifacts ?? null,
      },
    ),
  ]);
}

/**
 * Finds everything in an artifact that the host cannot serve.
 *
 * Reports every unsupported feature rather than the first, because an author
 * removing one route at a time to discover the rest is a slow way to learn a
 * boundary.
 */
export function findUnsupportedHostFeatures(input: {
  readonly reader: PublicationReaderEnvelope;
  readonly capabilities: HostCapabilities;
}): readonly UnsupportedHostFeature[] {
  const supported = new Set(input.capabilities.routeKinds);
  const byKind = new Map<string, string[]>();
  for (const route of input.reader.routes.active) {
    const kind = route.target.kind;
    if (supported.has(kind)) {
      continue;
    }
    const paths = byKind.get(kind);
    if (paths === undefined) {
      byKind.set(kind, [route.path]);
    } else {
      paths.push(route.path);
    }
  }
  return Object.freeze(
    [...byKind.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([kind, paths]) =>
        Object.freeze({
          feature: `${kind} route`,
          paths: Object.freeze(paths.sort()),
        }),
      ),
  );
}

/**
 * Decides whether an artifact may be written into this host.
 *
 * Refusing here rather than at server startup is the whole point. A build that
 * reports success and leaves a host that cannot boot has moved the failure to
 * where it is hardest to explain.
 */
export function assertHostCanServe(input: {
  readonly reader: PublicationReaderEnvelope;
  readonly capabilities: HostCapabilities | null;
  readonly renderer: string;
}): ValidationResult<true> {
  if (input.capabilities === null) {
    return invalidResult([
      diagnostic(
        "host.capabilities_missing",
        "",
        `${input.renderer}/host declares no capability set, so the engine cannot tell what this host is able to serve. ` +
          "A renderer that serves everything still declares it, because an absent declaration and a claim of full support are different claims.",
        { renderer: input.renderer },
      ),
    ]);
  }

  const unsupported = findUnsupportedHostFeatures({
    reader: input.reader,
    capabilities: input.capabilities,
  });
  if (unsupported.length === 0) {
    return Object.freeze({
      valid: true as const,
      value: true as const,
      diagnostics: sortAndFreezeDiagnostics([]),
    });
  }

  return invalidResult(
    unsupported.map((entry) =>
      diagnostic(
        "host.route_kind_unsupported",
        "/routes/active",
        `This publication has ${entry.paths.length} ${entry.feature}(s) that ${input.renderer} cannot serve: ${entry.paths.join(", ")}. ` +
          "Writing the artifact would leave a host that fails to start, so nothing has been written. " +
          "Remove the route from your publication manifest, or use a renderer that serves it.",
        {
          renderer: input.renderer,
          feature: entry.feature,
          paths: entry.paths,
        },
      ),
    ),
  );
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  params: Readonly<Record<string, unknown>>,
): Diagnostic {
  return loaderDiagnostic(code, path, message, "hostCapability", params);
}
