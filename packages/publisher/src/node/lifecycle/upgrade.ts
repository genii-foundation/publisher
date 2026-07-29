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

// Host upgrade.
//
// An upgrade is the diff between what the engine recorded writing and what the
// installed contract now produces. That is the whole idea, and it is why nothing
// executable is needed: the recorded hashes say what the engine put there, the
// new contract says what belongs there, and the difference is the change.
//
// The recorded hashes are also what makes local modification detectable. Without
// them an upgrade could only overwrite blindly or refuse to touch anything, and
// both are wrong.
//
// Files the old contract owned and the new one does not are removed, so an
// upgraded host does not accumulate orphans the renderer no longer tracks. Those
// removals carry the recorded hash as their preimage, so a file an author edited
// after the engine wrote it is a conflict rather than a deletion.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { resolveGitBaseline } from "./git-baseline.js";
import {
  PUBLISHER_HOST_STATE_PATH,
  type PublisherHostState,
  hashManagedFileContents,
  parsePublisherHostState,
  serializePublisherHostState,
} from "./host-state.js";
import type { HostContractTemplate } from "./init.js";
import {
  type HostContractMigrationEdge,
  type HostContractMigrationPath,
  resolveHostContractMigrationPath,
} from "./migrations.js";
import {
  assertHostMutationsPermitted,
  createHostMutationAuthority,
  type HostMutationRole,
} from "./policy.js";
import {
  type HostFileClassification,
  type HostFileMutation,
  applyHostMutations,
  classifyHostMutations,
} from "./transaction.js";

export interface HostUpgradePlanInput {
  /** Absolute, canonical host root. */
  readonly hostRoot: string;
  /** The contract the installed renderer now produces. */
  readonly template: HostContractTemplate;
  /** The installed renderer's migration registry. */
  readonly migrationEdges: readonly HostContractMigrationEdge[];
  /** Exact engine package versions this host will pin after upgrading. */
  readonly enginePackages: Readonly<Record<string, string>>;
  readonly protectedRoots?: readonly string[];
}

export type HostUpgradeOutcome =
  | "upgrade"
  | "alreadyCurrent"
  | "conflicted";

export interface HostUpgradePlan {
  readonly outcome: HostUpgradeOutcome;
  readonly planHash: string;
  readonly fromContractVersion: string;
  readonly toContractVersion: string;
  readonly renderer: string;
  readonly rendererVersion: string;
  readonly migrationPath: HostContractMigrationPath;
  /** Steps the tooling refuses to perform. A plan carrying any is gated. */
  readonly manualSteps: readonly string[];
  readonly mutations: readonly HostFileMutation[];
  readonly classifications: readonly HostFileClassification[];
  readonly conflicts: readonly HostFileClassification[];
  /** Paths the old contract owned that the new one does not. */
  readonly removed: readonly string[];
}

export class HostUpgradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostUpgradeError";
  }
}

function readRecordedState(hostRoot: string): PublisherHostState {
  const path = join(hostRoot, PUBLISHER_HOST_STATE_PATH);
  if (!existsSync(path)) {
    throw new HostUpgradeError(
      `This host has no ${PUBLISHER_HOST_STATE_PATH}, so there is nothing to upgrade from. Initialize it first.`,
    );
  }
  return parsePublisherHostState(readFileSync(path, "utf8"));
}

/**
 * Computes the upgrade mutation set and classifies it, writing nothing.
 */
export function planHostUpgrade(
  input: HostUpgradePlanInput,
): HostUpgradePlan {
  if (!isAbsolute(input.hostRoot)) {
    throw new HostUpgradeError(
      "Host root must be an absolute path.",
    );
  }
  const hostRoot = resolve(input.hostRoot);
  const recorded = readRecordedState(hostRoot);

  if (recorded.renderer !== input.template.renderer) {
    throw new HostUpgradeError(
      `This host is integrated with ${recorded.renderer}, so it cannot be upgraded using ${input.template.renderer}. Changing renderer is not an upgrade.`,
    );
  }

  // Resolved before anything is read from disk, so a host on a version this
  // target never knew about is told that rather than shown a file diff it cannot
  // act on.
  const migrationPath = resolveHostContractMigrationPath({
    fromVersion: recorded.hostContractVersion,
    targetVersion: input.template.contractVersion,
    edges: input.migrationEdges,
  });

  const recordedHashes = new Map(
    recorded.managedFiles.map((file) => [file.path, file.sha256]),
  );
  const contractPaths = new Set(
    input.template.files.map((file) => file.path),
  );

  const managedFiles = input.template.files
    .map((file) => ({
      path: file.path,
      sha256: hashManagedFileContents(file.contents),
    }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );

  const nextState: PublisherHostState = {
    format: "",
    renderer: input.template.renderer,
    rendererVersion: input.template.rendererVersion,
    hostContractVersion: input.template.contractVersion,
    layout: recorded.layout,
    enginePackages: input.enginePackages,
    managedFiles,
  } as PublisherHostState;

  const removed = recorded.managedFiles
    .map((file) => file.path)
    .filter((path) => !contractPaths.has(path))
    .sort();

  const mutations: HostFileMutation[] = [
    ...input.template.files.map((file) => ({
      path: file.path,
      contents: file.contents,
      // A file the engine already wrote carries its recorded hash, which is what
      // turns an author's later edit into a conflict. A file new in this contract
      // expects nothing.
      expected: recordedHashes.get(file.path) ?? null,
    })),
    ...removed.map((path) => ({
      path,
      contents: null,
      expected: recordedHashes.get(path) ?? null,
    })),
    {
      path: PUBLISHER_HOST_STATE_PATH,
      contents: serializePublisherHostState(nextState),
      expected: hashManagedFileContents(
        serializePublisherHostState(recorded),
      ),
    },
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );

  const requests: { path: string; role: HostMutationRole }[] =
    mutations.map((mutation) => ({
      path: mutation.path,
      role:
        mutation.path === PUBLISHER_HOST_STATE_PATH
          ? ("engineManaged" as const)
          : ("rendererManaged" as const),
    }));
  const authority = createHostMutationAuthority({
    // Both the new contract's paths and the ones being removed. A removed path
    // was renderer-managed, so removing it is renderer authority, but it is no
    // longer in the contract and would otherwise be refused as undeclared.
    // Hard denials and protected roots still apply to both.
    rendererManagedPaths: [...contractPaths, ...removed],
    engineManagedPaths: [PUBLISHER_HOST_STATE_PATH],
    ...(input.protectedRoots === undefined
      ? {}
      : { protectedRoots: input.protectedRoots }),
  });
  assertHostMutationsPermitted(authority, requests);

  const classifications = classifyHostMutations(hostRoot, mutations);
  const conflicts = classifications.filter(
    (entry) => entry.state === "conflicted",
  );
  const pending = classifications.filter(
    (entry) => entry.state === "pending",
  );

  let outcome: HostUpgradeOutcome;
  if (conflicts.length > 0) {
    outcome = "conflicted";
  } else if (pending.length === 0) {
    outcome = "alreadyCurrent";
  } else {
    outcome = "upgrade";
  }

  const hash = createHash("sha256");
  hash.update("genii-publisher-host-upgrade-1\n");
  hash.update(`${input.template.renderer}\n`);
  hash.update(`${input.template.rendererVersion}\n`);
  hash.update(`${recorded.hostContractVersion}\n`);
  hash.update(`${input.template.contractVersion}\n`);
  // The route is part of what was reviewed. Reaching the same target by a
  // different chain is a different change, even when the resulting files match.
  for (const edge of migrationPath.edges) {
    hash.update(`${edge.from}>${edge.to}\0`);
  }
  for (const mutation of mutations) {
    hash.update(mutation.path);
    hash.update("\0");
    hash.update(
      mutation.contents === null
        ? "removed"
        : hashManagedFileContents(mutation.contents),
    );
    hash.update("\0");
    hash.update(mutation.expected ?? "");
    hash.update("\0");
  }

  return Object.freeze({
    outcome,
    planHash: `sha256:${hash.digest("hex")}`,
    fromContractVersion: recorded.hostContractVersion,
    toContractVersion: input.template.contractVersion,
    renderer: input.template.renderer,
    rendererVersion: input.template.rendererVersion,
    migrationPath,
    manualSteps: migrationPath.manualSteps,
    mutations: Object.freeze(mutations),
    classifications,
    conflicts: Object.freeze(conflicts),
    removed: Object.freeze(removed),
  });
}

export interface HostUpgradeApplyInput {
  readonly hostRoot: string;
  readonly plan: HostUpgradePlan;
  readonly journalDirectory: string;
  readonly expectedPlanHash: string;
  /**
   * Confirms the operator has read the manual steps. Required when the plan
   * carries any.
   *
   * The engine cannot verify a database change or a provider setting, so the most
   * it can honestly do is refuse to continue until told the steps have been seen.
   * Proceeding silently would report success for work nobody did.
   */
  readonly acknowledgedManualSteps?: boolean;
  /** Only for exercising the writer in isolation. */
  readonly skipGitBaseline?: boolean;
}

export interface HostUpgradeApplyResult {
  readonly outcome: "applied" | "alreadyApplied";
  readonly changed: readonly string[];
  readonly planHash: string;
  readonly fromContractVersion: string;
  readonly toContractVersion: string;
  readonly baselineCommit: string | null;
}

export function applyHostUpgrade(
  input: HostUpgradeApplyInput,
): HostUpgradeApplyResult {
  if (input.plan.planHash !== input.expectedPlanHash) {
    throw new HostUpgradeError(
      `The plan changed since it was reviewed. Expected ${input.expectedPlanHash} but the plan is ${input.plan.planHash}.`,
    );
  }
  if (input.plan.outcome === "conflicted") {
    throw new HostUpgradeError(
      `${input.plan.conflicts.length} host file(s) differ from what the engine last wrote, so they must be reviewed rather than overwritten:\n${input.plan.conflicts
        .map((conflict) => `  ${conflict.path}`)
        .join("\n")}`,
    );
  }
  if (
    input.plan.manualSteps.length > 0 &&
    input.acknowledgedManualSteps !== true
  ) {
    throw new HostUpgradeError(
      `This upgrade requires ${input.plan.manualSteps.length} step(s) the engine will not perform:\n${input.plan.manualSteps
        .map((step) => `  ${step}`)
        .join(
          "\n",
        )}\nConfirm they have been read before applying.`,
    );
  }

  const baseline =
    input.skipGitBaseline === true
      ? null
      : resolveGitBaseline(input.hostRoot);

  const result = applyHostMutations({
    root: input.hostRoot,
    mutations: input.plan.mutations,
    journalDirectory: input.journalDirectory,
  });

  return Object.freeze({
    outcome: result.outcome,
    changed: result.changed,
    planHash: input.plan.planHash,
    fromContractVersion: input.plan.fromContractVersion,
    toContractVersion: input.plan.toContractVersion,
    baselineCommit: baseline === null ? null : baseline.commit,
  });
}
