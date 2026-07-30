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

// The Git baseline gate.
//
// Rollback is a checkout of the commit that was recorded before apply, which
// means Git is the rollback authority rather than anything this engine writes.
// The alternative was trusting a backup format of our own, with no external
// verifier, in exactly the situation where our own code has already failed once.
//
// Three conditions, and each one is about being able to get back:
//
// A work tree, because there is nothing to check out of otherwise.
//
// A commit at HEAD, because an empty repository offers nothing to return to. A
// repository with no commits looks recoverable and is not.
//
// A clean tree including untracked files. Uncommitted work is invisible to a
// checkout, so a rollback would silently discard it. Refusing is the only
// outcome that cannot lose an author's work, even though it is the one that
// annoys an author with an unrelated scratch file.

import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

export interface GitBaseline {
  /** Exact commit apply was performed against. Rollback returns here. */
  readonly commit: string;
  /** Absolute repository root, which may be an ancestor of the host root. */
  readonly repositoryRoot: string;
  /** Branch name, or null on a detached HEAD. */
  readonly branch: string | null;
}

export class GitBaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitBaselineError";
  }
}

/**
 * Reads one path as it stood at a commit.
 *
 * Returns null when the commit did not contain it, which rollback treats as
 * "this file should not exist afterwards". Distinguishing absent from empty
 * matters: an empty file at the baseline must come back as an empty file, not be
 * deleted.
 */
export function readFileAtCommit(
  repositoryRoot: string,
  commit: string,
  hostRelativePath: string,
): string | null {
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new GitBaselineError(
      `Refusing to read from an unusable commit ${JSON.stringify(commit)}.`,
    );
  }
  const listed = git(repositoryRoot, [
    "ls-tree",
    "--name-only",
    "-z",
    commit,
    "--",
    hostRelativePath,
  ]);
  if (listed.status !== 0) {
    throw new GitBaselineError(
      `Could not inspect ${hostRelativePath} at ${commit}: ${listed.stderr.trim()}`,
    );
  }
  if (listed.stdout.replace(/\0/gu, "").trim().length === 0) {
    return null;
  }
  const shown = git(repositoryRoot, [
    "show",
    `${commit}:${hostRelativePath}`,
  ]);
  if (shown.status !== 0) {
    throw new GitBaselineError(
      `Could not read ${hostRelativePath} at ${commit}: ${shown.stderr.trim()}`,
    );
  }
  return shown.stdout;
}

function git(
  cwd: string,
  args: readonly string[],
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    // A pager or an editor would hang a non-interactive command forever.
    env: {
      ...process.env,
      GIT_PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (result.error !== undefined) {
    throw new GitBaselineError(
      `Git could not be run, which apply requires: ${result.error.message}`,
    );
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Suffix the transaction gives a file it has staged but not yet renamed. */
const STAGING_SUFFIX = ".publisher-staged";

/**
 * Whether a status line names a file the engine staged rather than author work.
 *
 * A staged file exists only between a write and its rename, so a second command
 * running concurrently can observe one. Counting it as uncommitted work made the
 * gate refuse and tell the author to commit or stash a file the engine had just
 * created and was about to remove. Continuous integration found exactly that: one
 * apply reported writing nineteen files while the other refused, quoting
 * "?? app/[...segments]/page.tsx.publisher-staged".
 *
 * Never author work, because the suffix is engine owned. A leftover from a crash no
 * longer blocks an apply either, which is the right outcome now that recovery
 * removes them and a later write to the same path consumes them.
 *
 * Porcelain v1 quotes a path containing unusual characters, so both spellings are
 * accepted here.
 */
function namesAnEngineStagedFile(line: string): boolean {
  return (
    line.endsWith(STAGING_SUFFIX) ||
    line.endsWith(`${STAGING_SUFFIX}"`)
  );
}

/**
 * Resolves and verifies the Git baseline for a host root.
 *
 * Returns the commit a rollback would return to. Throws when the tree cannot
 * offer that guarantee.
 */
export function resolveGitBaseline(hostRoot: string): GitBaseline {
  if (typeof hostRoot !== "string" || !isAbsolute(hostRoot)) {
    throw new GitBaselineError(
      "Host root must be an absolute path.",
    );
  }
  const root = resolve(hostRoot);

  const insideWorkTree = git(root, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (
    insideWorkTree.status !== 0 ||
    insideWorkTree.stdout.trim() !== "true"
  ) {
    throw new GitBaselineError(
      `Apply requires a Git work tree, because rollback is a checkout of the commit recorded before it: ${root}`,
    );
  }

  const repositoryRoot = git(root, [
    "rev-parse",
    "--show-toplevel",
  ]);
  if (repositoryRoot.status !== 0) {
    throw new GitBaselineError(
      `Could not resolve the Git repository root for ${root}.`,
    );
  }

  const head = git(root, ["rev-parse", "HEAD"]);
  if (head.status !== 0) {
    throw new GitBaselineError(
      `Apply requires at least one commit to roll back to, and this repository has none: ${root}`,
    );
  }
  const commit = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new GitBaselineError(
      `Git reported an unusable HEAD commit ${JSON.stringify(commit)} for ${root}.`,
    );
  }

  // Untracked files count. A checkout does not remove them, so a rollback would
  // leave them behind and an author would be told the tree was restored when it
  // was not.
  const status = git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status.status !== 0) {
    throw new GitBaselineError(
      `Could not read Git status for ${root}: ${status.stderr.trim()}`,
    );
  }
  const dirty = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !namesAnEngineStagedFile(line));
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 10);
    const remainder =
      dirty.length > shown.length
        ? `\n  and ${dirty.length - shown.length} more`
        : "";
    throw new GitBaselineError(
      `Apply requires a clean Git tree, because uncommitted work is invisible to the checkout a rollback performs and would be lost. Commit or stash these first:\n${shown
        .map((line) => `  ${line}`)
        .join("\n")}${remainder}`,
    );
  }

  const branch = git(root, [
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  const branchName =
    branch.status === 0 ? branch.stdout.trim() : "";

  return Object.freeze({
    commit,
    repositoryRoot: repositoryRoot.stdout.trim(),
    branch:
      branchName === "" || branchName === "HEAD" ? null : branchName,
  });
}
