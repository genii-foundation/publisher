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

// The host contract migration registry.
//
// Migrations here are data, not code. A host contract is already a pure function
// of its inputs, so upgrading between two versions needs no executable step: the
// new file set is computed and diffed against what the engine recorded writing.
// What an edge adds is the part a diff cannot supply, which is why the edge
// exists at all: a summary an author can read, and any manual step the tooling
// must not perform on their behalf.
//
// That is also what makes the third-party rule in ADR 0012 cost nothing. Nobody
// needs to execute foreign code during a mutation, because there is nothing for
// that code to do.
//
// Edges are sequential and the target owns them. The version being migrated to
// declares the whole chain leading to itself, so a host never has to consult a
// registry from a version it is leaving. Shortcut edges are refused: they
// multiply the combinations that must be tested and are where migration tooling
// accumulates paths nobody exercises.

export interface HostContractMigrationEdge {
  /** Contract version this edge starts from. */
  readonly from: string;
  /** Contract version this edge arrives at. */
  readonly to: string;
  /** One line an author can read to know what changed. */
  readonly summary: string;
  /**
   * Steps the tooling refuses to perform. Present when an edge needs something
   * outside the engine's authority, such as a provider setting or a database
   * change. A plan carrying these is reported as gated.
   */
  readonly manualSteps?: readonly string[];
}

export interface HostContractMigrationPath {
  readonly from: string;
  readonly to: string;
  readonly edges: readonly HostContractMigrationEdge[];
  /** Every manual step across the path, in order, with duplicates preserved. */
  readonly manualSteps: readonly string[];
}

export class HostContractMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostContractMigrationError";
  }
}

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function assertVersion(value: unknown, label: string): string {
  if (typeof value !== "string" || !versionPattern.test(value)) {
    throw new HostContractMigrationError(
      `${label} must be an exact contract version, not ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/**
 * Validates a registry and returns its edges in chain order.
 *
 * The registry must describe one unbroken chain ending at the target version.
 * Anything else is refused rather than interpreted: a fork, a gap, a cycle, or a
 * second edge out of the same version all mean the renderer does not have one
 * answer to how a host gets to it.
 */
export function validateHostContractMigrations(input: {
  readonly targetVersion: string;
  readonly edges: readonly HostContractMigrationEdge[];
}): readonly HostContractMigrationEdge[] {
  const target = assertVersion(input.targetVersion, "targetVersion");
  if (!Array.isArray(input.edges)) {
    throw new HostContractMigrationError(
      "The migration registry must be an array of edges.",
    );
  }

  const normalized = input.edges.map((edge, index) => {
    if (
      edge === null ||
      typeof edge !== "object" ||
      Array.isArray(edge)
    ) {
      throw new HostContractMigrationError(
        `Migration edge ${index} must be an object.`,
      );
    }
    const from = assertVersion(edge.from, `edge ${index} from`);
    const to = assertVersion(edge.to, `edge ${index} to`);
    if (from === to) {
      throw new HostContractMigrationError(
        `Migration edge ${index} starts and ends at ${from}.`,
      );
    }
    if (
      typeof edge.summary !== "string" ||
      edge.summary.trim().length === 0
    ) {
      throw new HostContractMigrationError(
        `Migration edge ${from} to ${to} must carry a nonempty summary, because an author has to be able to read what changed.`,
      );
    }
    if (edge.manualSteps !== undefined) {
      if (!Array.isArray(edge.manualSteps)) {
        throw new HostContractMigrationError(
          `Migration edge ${from} to ${to} declares manualSteps that are not an array.`,
        );
      }
      for (const step of edge.manualSteps) {
        if (typeof step !== "string" || step.trim().length === 0) {
          throw new HostContractMigrationError(
            `Migration edge ${from} to ${to} declares an empty manual step.`,
          );
        }
      }
    }
    return Object.freeze({
      from,
      to,
      summary: edge.summary,
      ...(edge.manualSteps === undefined
        ? {}
        : {
            manualSteps: Object.freeze([...edge.manualSteps]),
          }),
    }) as HostContractMigrationEdge;
  });

  if (normalized.length === 0) {
    return Object.freeze([]);
  }

  const byFrom = new Map<string, HostContractMigrationEdge>();
  const byTo = new Map<string, HostContractMigrationEdge>();
  for (const edge of normalized) {
    if (byFrom.has(edge.from)) {
      // Two ways out of one version is a fork, and a fork means the renderer has
      // not decided how a host reaches it.
      throw new HostContractMigrationError(
        `The migration registry declares two edges out of ${edge.from}, so there is no single path to ${target}.`,
      );
    }
    if (byTo.has(edge.to)) {
      throw new HostContractMigrationError(
        `The migration registry declares two edges into ${edge.to}.`,
      );
    }
    byFrom.set(edge.from, edge);
    byTo.set(edge.to, edge);
  }

  // Exactly one edge must arrive at the target, and following predecessors from
  // there must reach every declared edge without repeating one.
  const finalEdge = byTo.get(target);
  if (finalEdge === undefined) {
    throw new HostContractMigrationError(
      `The migration registry declares edges but none arrives at the target version ${target}.`,
    );
  }
  const chain: HostContractMigrationEdge[] = [];
  const visited = new Set<string>();
  let cursor: HostContractMigrationEdge | undefined = finalEdge;
  while (cursor !== undefined) {
    if (visited.has(cursor.from)) {
      throw new HostContractMigrationError(
        `The migration registry cycles through ${cursor.from}.`,
      );
    }
    visited.add(cursor.from);
    chain.unshift(cursor);
    cursor = byTo.get(cursor.from);
  }
  if (chain.length !== normalized.length) {
    const reachable = new Set(chain);
    const stranded = normalized
      .filter((edge) => !reachable.has(edge))
      .map((edge) => `${edge.from} to ${edge.to}`);
    throw new HostContractMigrationError(
      `The migration registry declares edges that are not on the chain ending at ${target}: ${stranded.join(", ")}.`,
    );
  }

  return Object.freeze(chain);
}

/**
 * Resolves the edges a host must traverse to reach the target.
 *
 * Refuses a version the chain does not mention, and refuses moving backwards. A
 * downgrade is a rollback, which returns to a recorded commit rather than
 * replaying edges in reverse, because an edge describes what changed and not how
 * to undo it.
 */
export function resolveHostContractMigrationPath(input: {
  readonly fromVersion: string;
  readonly targetVersion: string;
  readonly edges: readonly HostContractMigrationEdge[];
}): HostContractMigrationPath {
  const from = assertVersion(input.fromVersion, "fromVersion");
  const target = assertVersion(input.targetVersion, "targetVersion");
  const chain = validateHostContractMigrations({
    targetVersion: target,
    edges: input.edges,
  });

  if (from === target) {
    return Object.freeze({
      from,
      to: target,
      edges: Object.freeze([]),
      manualSteps: Object.freeze([]),
    });
  }

  const startIndex = chain.findIndex((edge) => edge.from === from);
  if (startIndex === -1) {
    const known = chain.length === 0 ? "none" : chain
      .map((edge) => edge.from)
      .concat(target)
      .join(", ");
    // Either the host is on a version this target never knew about, or it is
    // ahead of the target. Both mean there is no sequence of edges to follow,
    // and inventing one is exactly the shortcut the design refuses.
    throw new HostContractMigrationError(
      `No migration path from contract ${from} to ${target}. The target declares a chain over: ${known}.`,
    );
  }

  const edges = chain.slice(startIndex);
  const manualSteps: string[] = [];
  for (const edge of edges) {
    for (const step of edge.manualSteps ?? []) {
      manualSteps.push(step);
    }
  }

  return Object.freeze({
    from,
    to: target,
    edges: Object.freeze(edges),
    manualSteps: Object.freeze(manualSteps),
  });
}
