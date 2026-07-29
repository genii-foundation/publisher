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

// Host initialization.
//
// Planning is read-only and answers one question: what would change. Applying
// takes a plan, proves the tree still matches what the plan was computed
// against, and writes through the transaction. The split exists so an author can
// read the whole change before any of it happens.
//
// Two repositories are served. An empty one receives the canonical layout. An
// established one is adopted, which adds host integration and records the layout
// without moving a single source file. Adoption is not a lesser path: the first
// real migration target is a repository whose structure predates the engine.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import {
  hashReceiptContents,
  writeApplyReceipt,
} from "./apply-receipt.js";
import { resolveGitBaseline } from "./git-baseline.js";
import {
  PUBLISHER_HOST_STATE_PATH,
  type PublisherHostLayout,
  type PublisherHostState,
  hashManagedFileContents,
  parsePublisherHostState,
  serializePublisherHostState,
} from "./host-state.js";
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

/** A renderer host contract, as the renderer's own `./host` export produces it. */
export interface HostContractTemplate {
  readonly contractVersion: string;
  readonly renderer: string;
  readonly rendererVersion: string;
  readonly files: readonly {
    readonly path: string;
    readonly contents: string;
  }[];
}

export interface HostInitializationPlanInput {
  /** Absolute, canonical host root. */
  readonly hostRoot: string;
  readonly template: HostContractTemplate;
  readonly layout: PublisherHostLayout;
  /** Exact engine package versions this host will pin. */
  readonly enginePackages: Readonly<Record<string, string>>;
  /** Roots the publication declares for sources and durable state. */
  readonly protectedRoots?: readonly string[];
}

export type HostInitializationOutcome =
  | "initialize"
  | "alreadyInitialized"
  | "conflicted";

export interface HostInitializationPlan {
  readonly outcome: HostInitializationOutcome;
  /** Stable across directories, so the same host plans identically anywhere. */
  readonly planHash: string;
  readonly layout: PublisherHostLayout;
  readonly hostContractVersion: string;
  readonly renderer: string;
  readonly rendererVersion: string;
  readonly mutations: readonly HostFileMutation[];
  readonly classifications: readonly HostFileClassification[];
  readonly conflicts: readonly HostFileClassification[];
}

export class HostInitializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostInitializationError";
  }
}

function readHostStateIfPresent(
  hostRoot: string,
): PublisherHostState | null {
  const path = join(hostRoot, PUBLISHER_HOST_STATE_PATH);
  if (!existsSync(path)) {
    return null;
  }
  return parsePublisherHostState(readFileSync(path, "utf8"));
}

/**
 * Computes the mutation set and classifies it, writing nothing.
 *
 * The host state file is part of the mutation set rather than a side effect,
 * so it is subject to the same policy, the same conflict detection, and the same
 * transaction as every other file it describes.
 */
export function planHostInitialization(
  input: HostInitializationPlanInput,
): HostInitializationPlan {
  const hostRoot = resolve(input.hostRoot);
  if (!isAbsolute(input.hostRoot)) {
    throw new HostInitializationError(
      "Host root must be an absolute path.",
    );
  }
  if (input.template.files.length === 0) {
    throw new HostInitializationError(
      "The renderer host contract declares no files.",
    );
  }

  const existing = readHostStateIfPresent(hostRoot);
  if (
    existing !== null &&
    existing.renderer !== input.template.renderer
  ) {
    throw new HostInitializationError(
      `This host is already initialized for ${existing.renderer}, so it cannot be initialized for ${input.template.renderer}.`,
    );
  }

  const priorHashes = new Map(
    (existing?.managedFiles ?? []).map((file) => [
      file.path,
      file.sha256,
    ]),
  );

  // The state file records the hashes of every other managed file, so it is
  // computed after them and then included in the same set.
  const managedFiles = input.template.files
    .map((file) => ({
      path: file.path,
      sha256: hashManagedFileContents(file.contents),
    }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );

  const state: PublisherHostState = {
    format: "",
    renderer: input.template.renderer,
    rendererVersion: input.template.rendererVersion,
    hostContractVersion: input.template.contractVersion,
    layout: input.layout,
    enginePackages: input.enginePackages,
    managedFiles,
  } as PublisherHostState;
  const stateContents = serializePublisherHostState(state);

  const mutations: HostFileMutation[] = [
    ...input.template.files.map((file) => ({
      path: file.path,
      contents: file.contents,
      // On a first initialization nothing should exist. On a repeat the expected
      // preimage is whatever the engine last recorded writing, which is what
      // turns an author's edit into a conflict instead of an overwrite.
      expected: priorHashes.get(file.path) ?? null,
    })),
    {
      path: PUBLISHER_HOST_STATE_PATH,
      contents: stateContents,
      expected:
        existing === null
          ? null
          : hashManagedFileContents(
              serializePublisherHostState(existing),
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
    rendererManagedPaths: input.template.files.map(
      (file) => file.path,
    ),
    engineManagedPaths: [PUBLISHER_HOST_STATE_PATH],
    // Omitted rather than passed as undefined, because the package compiles with
    // exact optional property types.
    ...(input.protectedRoots === undefined
      ? {}
      : { protectedRoots: input.protectedRoots }),
  });
  // Authorized before the tree is even read, so a contract that reached beyond
  // its authority is refused whatever the host happens to contain.
  assertHostMutationsPermitted(authority, requests);

  const classifications = classifyHostMutations(hostRoot, mutations);
  const conflicts = classifications.filter(
    (entry) => entry.state === "conflicted",
  );
  const pending = classifications.filter(
    (entry) => entry.state === "pending",
  );

  let outcome: HostInitializationOutcome;
  if (conflicts.length > 0) {
    outcome = "conflicted";
  } else if (pending.length === 0) {
    outcome = "alreadyInitialized";
  } else {
    outcome = "initialize";
  }

  // Hashed over host-relative paths and content hashes only. No absolute path
  // participates, so the same host in two checkouts produces the same plan.
  const hash = createHash("sha256");
  hash.update("genii-publisher-host-initialization-1\n");
  hash.update(`${input.template.renderer}\n`);
  hash.update(`${input.template.rendererVersion}\n`);
  hash.update(`${input.template.contractVersion}\n`);
  hash.update(`${input.layout}\n`);
  for (const mutation of mutations) {
    hash.update(mutation.path);
    hash.update("\0");
    // A removal is distinguished by a marker rather than an absent field, so a
    // plan that removes a file can never hash the same as one that leaves it
    // alone. The marker is not a valid digest, so it cannot collide with one.
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
    layout: input.layout,
    hostContractVersion: input.template.contractVersion,
    renderer: input.template.renderer,
    rendererVersion: input.template.rendererVersion,
    mutations: Object.freeze(mutations),
    classifications,
    conflicts: Object.freeze(conflicts),
  });
}

export interface HostInitializationApplyInput {
  readonly hostRoot: string;
  readonly plan: HostInitializationPlan;
  readonly journalDirectory: string;
  /**
   * The plan hash the caller intends to apply. Supplying it proves the caller is
   * applying the plan it reviewed rather than one recomputed since.
   */
  readonly expectedPlanHash: string;
  /**
   * Skips the Git baseline gate. Only for exercising the writer in isolation:
   * every author-facing path leaves it on, because rollback is a checkout of the
   * commit the gate records.
   */
  readonly skipGitBaseline?: boolean;
}

export interface HostInitializationApplyResult {
  readonly outcome: "applied" | "alreadyApplied";
  readonly changed: readonly string[];
  readonly planHash: string;
  /** The commit a rollback returns to, or null when the gate was skipped. */
  readonly baselineCommit: string | null;
}

/**
 * Applies a plan.
 *
 * Refuses a plan whose hash does not match what the caller reviewed, and refuses
 * a conflicted plan outright. Everything else goes through the transaction, so a
 * failure restores the tree.
 */
export function applyHostInitialization(
  input: HostInitializationApplyInput,
): HostInitializationApplyResult {
  if (input.plan.planHash !== input.expectedPlanHash) {
    throw new HostInitializationError(
      `The plan changed since it was reviewed. Expected ${input.expectedPlanHash} but the plan is ${input.plan.planHash}.`,
    );
  }
  if (input.plan.outcome === "conflicted") {
    throw new HostInitializationError(
      `${input.plan.conflicts.length} host file(s) differ from what the engine last wrote, so they must be reviewed rather than overwritten:\n${input.plan.conflicts
        .map((conflict) => `  ${conflict.path}`)
        .join("\n")}`,
    );
  }

  // The gate runs here rather than in the command layer, so calling apply
  // directly cannot bypass it.
  const baseline =
    input.skipGitBaseline === true
      ? null
      : resolveGitBaseline(input.hostRoot);

  const result = applyHostMutations({
    root: input.hostRoot,
    mutations: input.plan.mutations,
    journalDirectory: input.journalDirectory,
  });

  if (baseline !== null && result.outcome === "applied") {
    writeApplyReceipt(input.hostRoot, {
      format: "",
      operation: "initialize",
      planHash: input.plan.planHash,
      baselineCommit: baseline.commit,
      renderer: input.plan.renderer,
      fromContractVersion: null,
      toContractVersion: input.plan.hostContractVersion,
      files: input.plan.mutations.map((mutation) => ({
        path: mutation.path,
        sha256:
          mutation.contents === null
            ? null
            : hashReceiptContents(mutation.contents),
      })),
    });
  }

  return Object.freeze({
    outcome: result.outcome,
    changed: result.changed,
    planHash: input.plan.planHash,
    baselineCommit: baseline === null ? null : baseline.commit,
  });
}
