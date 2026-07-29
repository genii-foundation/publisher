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

// Host rollback.
//
// Git is the rollback authority, but a broad checkout is the wrong instrument. A
// checkout of the baseline commit followed by a clean would also delete untracked
// work an author had nothing to do with this change, and reverting a lifecycle
// apply must not be a reason to lose an unrelated scratch file.
//
// So rollback is surgical. It restores exactly the paths the receipt records, to
// exactly the content the baseline commit held, and it does so through the same
// transaction as an apply. That means it is atomic, it fails closed, and a file
// the author has touched since the apply is a conflict rather than something
// rollback quietly reverts.
//
// A file absent from the baseline commit is removed rather than left behind,
// because it exists only because the apply created it.

import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import {
  type PublisherApplyReceipt,
  clearApplyReceipt,
  readApplyReceipt,
} from "./apply-receipt.js";
import {
  readFileAtCommit,
  resolveGitBaseline,
} from "./git-baseline.js";
import {
  type HostFileClassification,
  type HostFileMutation,
  applyHostMutations,
  classifyHostMutations,
} from "./transaction.js";

export type HostRollbackOutcome =
  | "rollback"
  | "nothingToRollBack"
  | "conflicted";

export interface HostRollbackPlan {
  readonly outcome: HostRollbackOutcome;
  readonly planHash: string;
  /** Null when there is no receipt to roll back. */
  readonly receipt: PublisherApplyReceipt | null;
  readonly mutations: readonly HostFileMutation[];
  readonly classifications: readonly HostFileClassification[];
  readonly conflicts: readonly HostFileClassification[];
  /** Paths that will be removed because the baseline did not contain them. */
  readonly removing: readonly string[];
}

export class HostRollbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostRollbackError";
  }
}

const emptyPlan = (): HostRollbackPlan =>
  Object.freeze({
    outcome: "nothingToRollBack" as const,
    planHash: "sha256:" + createHash("sha256").update("").digest("hex"),
    receipt: null,
    mutations: Object.freeze([]),
    classifications: Object.freeze([]),
    conflicts: Object.freeze([]),
    removing: Object.freeze([]),
  });

/**
 * Computes what returning to the recorded baseline would change, writing nothing.
 */
export function planHostRollback(input: {
  readonly hostRoot: string;
}): HostRollbackPlan {
  if (!isAbsolute(input.hostRoot)) {
    throw new HostRollbackError(
      "Host root must be an absolute path.",
    );
  }
  const hostRoot = resolve(input.hostRoot);
  const receipt = readApplyReceipt(hostRoot);
  if (receipt === null) {
    return emptyPlan();
  }

  // The repository root may be an ancestor of the host root, and Git paths are
  // resolved from the repository. Requiring the two to match keeps the receipt's
  // paths meaningful without a second path translation.
  const baseline = resolveGitBaselineForRollback(hostRoot);
  if (baseline.repositoryRoot !== hostRoot) {
    throw new HostRollbackError(
      `Rollback requires the host root to be the repository root, but the repository root is ${baseline.repositoryRoot}.`,
    );
  }

  const mutations: HostFileMutation[] = [];
  const removing: string[] = [];
  for (const file of receipt.files) {
    const baselineContents = readFileAtCommit(
      hostRoot,
      receipt.baselineCommit,
      file.path,
    );
    if (baselineContents === null) {
      removing.push(file.path);
    }
    mutations.push({
      path: file.path,
      contents: baselineContents,
      // What the apply left there. A file that no longer matches has been touched
      // since, and rollback refuses rather than discarding that work.
      expected: file.sha256,
    });
  }
  mutations.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );

  const classifications = classifyHostMutations(hostRoot, mutations);
  const conflicts = classifications.filter(
    (entry) => entry.state === "conflicted",
  );
  const pending = classifications.filter(
    (entry) => entry.state === "pending",
  );

  let outcome: HostRollbackOutcome;
  if (conflicts.length > 0) {
    outcome = "conflicted";
  } else if (pending.length === 0) {
    outcome = "nothingToRollBack";
  } else {
    outcome = "rollback";
  }

  const hash = createHash("sha256");
  hash.update("genii-publisher-host-rollback-1\n");
  hash.update(`${receipt.planHash}\n`);
  hash.update(`${receipt.baselineCommit}\n`);
  for (const mutation of mutations) {
    hash.update(mutation.path);
    hash.update("\0");
    hash.update(
      mutation.contents === null
        ? "removed"
        : `sha256:${createHash("sha256")
            .update(mutation.contents, "utf8")
            .digest("hex")}`,
    );
    hash.update("\0");
    hash.update(mutation.expected ?? "");
    hash.update("\0");
  }

  return Object.freeze({
    outcome,
    planHash: `sha256:${hash.digest("hex")}`,
    receipt,
    mutations: Object.freeze(mutations),
    classifications,
    conflicts: Object.freeze(conflicts),
    removing: Object.freeze(removing.sort()),
  });
}

// Rollback deliberately does not require a clean tree. The tree is dirty by
// definition, because it holds the apply this is undoing.
function resolveGitBaselineForRollback(hostRoot: string): {
  readonly repositoryRoot: string;
} {
  try {
    return resolveGitBaseline(hostRoot);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    if (/requires a clean Git tree/u.test(message)) {
      // Expected. Everything else, such as a missing work tree or no commit at
      // all, still disqualifies a rollback.
      return { repositoryRoot: hostRoot };
    }
    throw error;
  }
}

export interface HostRollbackApplyInput {
  readonly hostRoot: string;
  readonly plan: HostRollbackPlan;
  readonly journalDirectory: string;
  readonly expectedPlanHash: string;
}

export interface HostRollbackApplyResult {
  readonly outcome: "applied" | "alreadyApplied";
  readonly restored: readonly string[];
  readonly baselineCommit: string | null;
}

/**
 * Restores the recorded baseline.
 *
 * Clears the receipt afterwards, because the apply it describes no longer
 * happened and a receipt for an undone change would invite rolling back twice.
 */
export function applyHostRollback(
  input: HostRollbackApplyInput,
): HostRollbackApplyResult {
  if (input.plan.planHash !== input.expectedPlanHash) {
    throw new HostRollbackError(
      `The rollback plan changed since it was reviewed. Expected ${input.expectedPlanHash} but the plan is ${input.plan.planHash}.`,
    );
  }
  if (input.plan.outcome === "conflicted") {
    throw new HostRollbackError(
      `${input.plan.conflicts.length} host file(s) have changed since the apply, so rolling back would discard that work:\n${input.plan.conflicts
        .map((conflict) => `  ${conflict.path}`)
        .join("\n")}`,
    );
  }
  if (input.plan.receipt === null) {
    return Object.freeze({
      outcome: "alreadyApplied" as const,
      restored: Object.freeze([]),
      baselineCommit: null,
    });
  }

  const result = applyHostMutations({
    root: input.hostRoot,
    mutations: input.plan.mutations,
    journalDirectory: input.journalDirectory,
  });
  clearApplyReceipt(resolve(input.hostRoot));

  return Object.freeze({
    outcome: result.outcome,
    restored: result.changed,
    baselineCommit: input.plan.receipt.baselineCommit,
  });
}
