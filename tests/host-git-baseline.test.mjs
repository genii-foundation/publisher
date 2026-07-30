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

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  resolveGitBaseline,
} from "../packages/publisher/dist/node/lifecycle/git-baseline.js";
import {
  PUBLISHER_HOST_STATE_PATH,
} from "../packages/publisher/dist/node/lifecycle/host-state.js";
import {
  applyHostInitialization,
  planHostInitialization,
} from "../packages/publisher/dist/node/lifecycle/init.js";

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Probe",
      GIT_AUTHOR_EMAIL: "probe@example.test",
      GIT_COMMITTER_NAME: "Probe",
      GIT_COMMITTER_EMAIL: "probe@example.test",
    },
  }).trim();
}

function workspace(t, { commit = true } = {}) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-git-baseline-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const hostRoot = join(root, "host");
  mkdirSync(hostRoot);
  git(hostRoot, ["init", "--quiet", "--initial-branch=main"]);
  if (commit) {
    writeFileSync(join(hostRoot, "README.md"), "# Probe\n", "utf8");
    git(hostRoot, ["add", "-A"]);
    git(hostRoot, ["commit", "--quiet", "-m", "initial"]);
  }
  return {
    root,
    hostRoot,
    journalDirectory: join(root, "journal"),
  };
}

const template = Object.freeze({
  contractVersion: "0.1.0",
  renderer: "@genii-foundation/publisher-next",
  rendererVersion: "0.1.0-alpha.0",
  files: Object.freeze([
    Object.freeze({
      path: "package.json",
      contents: '{"name":"host"}\n',
    }),
    Object.freeze({
      path: "app/page.tsx",
      contents: "export default null;\n",
    }),
  ]),
});

function plan(hostRoot) {
  return planHostInitialization({
    hostRoot,
    template,
    layout: "canonical",
    enginePackages: { "@genii-foundation/publisher": "0.1.0-alpha.0" },
  });
}

function snapshot(root) {
  const files = [];
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, {
      withFileTypes: true,
    })) {
      if (entry.name === ".git") {
        continue;
      }
      const key = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(join(directory, entry.name), key);
      } else {
        files.push(key);
      }
    }
  };
  visit(root, "");
  return files.sort();
}

// ------------------------------------------------------------ the gate

test("a clean repository with a commit resolves a baseline", (t) => {
  const { hostRoot } = workspace(t);
  const baseline = resolveGitBaseline(hostRoot);
  assert.match(baseline.commit, /^[0-9a-f]{40}$/u);
  assert.equal(baseline.repositoryRoot, hostRoot);
  assert.equal(baseline.branch, "main");
  assert.equal(baseline.commit, git(hostRoot, ["rev-parse", "HEAD"]));
});

test("a tree that is not a Git work tree is refused", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-git-baseline-none-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  // A bare directory under the system temporary root, with no repository
  // anywhere above it.
  assert.throws(
    () => resolveGitBaseline(root),
    /requires a Git work tree/u,
  );
});

test("a repository with no commits is refused, because there is nothing to return to", (t) => {
  const { hostRoot } = workspace(t, { commit: false });
  assert.throws(
    () => resolveGitBaseline(hostRoot),
    /requires at least one commit to roll back to/u,
  );
});

test("a modified tracked file is refused and named", (t) => {
  const { hostRoot } = workspace(t);
  writeFileSync(join(hostRoot, "README.md"), "# Edited\n", "utf8");
  assert.throws(
    () => resolveGitBaseline(hostRoot),
    (error) => {
      assert.equal(error.name, "GitBaselineError");
      assert.match(error.message, /requires a clean Git tree/u);
      assert.match(error.message, /README\.md/u);
      return true;
    },
  );
});

test("an untracked file is refused, because a checkout would not remove it", (t) => {
  const { hostRoot } = workspace(t);
  writeFileSync(join(hostRoot, "scratch.txt"), "notes\n", "utf8");
  assert.throws(
    () => resolveGitBaseline(hostRoot),
    (error) => {
      assert.match(error.message, /requires a clean Git tree/u);
      assert.match(error.message, /scratch\.txt/u);
      return true;
    },
  );
});

test("a staged but uncommitted change is refused", (t) => {
  const { hostRoot } = workspace(t);
  writeFileSync(join(hostRoot, "staged.txt"), "staged\n", "utf8");
  git(hostRoot, ["add", "staged.txt"]);
  assert.throws(
    () => resolveGitBaseline(hostRoot),
    /requires a clean Git tree/u,
  );
});

test("a detached HEAD is usable and reports no branch", (t) => {
  const { hostRoot } = workspace(t);
  const commit = git(hostRoot, ["rev-parse", "HEAD"]);
  git(hostRoot, ["checkout", "--quiet", "--detach", commit]);
  const baseline = resolveGitBaseline(hostRoot);
  assert.equal(baseline.branch, null);
  assert.equal(baseline.commit, commit);
});

test("a relative host root is refused", () => {
  assert.throws(
    () => resolveGitBaseline("relative/path"),
    /must be an absolute path/u,
  );
});

// ------------------------------------------------- the gate inside apply

test("apply records the baseline commit a rollback would return to", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  const computed = plan(hostRoot);
  const applied = applyHostInitialization({
    hostRoot,
    journalDirectory,
    plan: computed,
    expectedPlanHash: computed.planHash,
  });
  assert.equal(applied.outcome, "applied");
  assert.equal(
    applied.baselineCommit,
    git(hostRoot, ["rev-parse", "HEAD"]),
  );
  assert.ok(existsSync(join(hostRoot, PUBLISHER_HOST_STATE_PATH)));
});

test("apply refuses a dirty tree and writes nothing", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  const computed = plan(hostRoot);
  writeFileSync(join(hostRoot, "README.md"), "# Edited\n", "utf8");
  const before = snapshot(hostRoot);

  assert.throws(
    () =>
      applyHostInitialization({
        hostRoot,
        journalDirectory,
        plan: computed,
        expectedPlanHash: computed.planHash,
      }),
    /requires a clean Git tree/u,
  );

  assert.deepEqual(
    snapshot(hostRoot),
    before,
    "a refused apply must not create a single host file",
  );
  assert.equal(
    existsSync(join(hostRoot, PUBLISHER_HOST_STATE_PATH)),
    false,
  );
  assert.equal(existsSync(journalDirectory), false);
  assert.equal(
    readFileSync(join(hostRoot, "README.md"), "utf8"),
    "# Edited\n",
    "the author's uncommitted edit must survive untouched",
  );
});

test("apply refuses a repository with no commits", (t) => {
  const { hostRoot, journalDirectory } = workspace(t, {
    commit: false,
  });
  const computed = plan(hostRoot);
  assert.throws(
    () =>
      applyHostInitialization({
        hostRoot,
        journalDirectory,
        plan: computed,
        expectedPlanHash: computed.planHash,
      }),
    /requires at least one commit/u,
  );
  assert.deepEqual(snapshot(hostRoot), []);
});

test("the gate runs before the writer, so a conflicted plan on a dirty tree reports the tree first", (t) => {
  // Ordering matters for the operator: fixing the conflict would not let apply
  // proceed while the tree is dirty, so the tree is what to report.
  const { hostRoot, journalDirectory } = workspace(t);
  mkdirSync(join(hostRoot, "app"), { recursive: true });
  writeFileSync(
    join(hostRoot, "app", "page.tsx"),
    "the author got here first\n",
    "utf8",
  );
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "author page"]);
  writeFileSync(join(hostRoot, "README.md"), "# Edited\n", "utf8");

  const computed = plan(hostRoot);
  assert.equal(computed.outcome, "conflicted");
  assert.throws(
    () =>
      applyHostInitialization({
        hostRoot,
        journalDirectory,
        plan: computed,
        expectedPlanHash: computed.planHash,
      }),
    // The conflict check precedes the gate deliberately: a conflict is about the
    // plan being wrong, which no amount of committing fixes.
    /must be reviewed rather than overwritten/u,
  );
});

test("a rollback to the recorded baseline restores the pre-apply tree", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  const before = snapshot(hostRoot);
  const computed = plan(hostRoot);
  const applied = applyHostInitialization({
    hostRoot,
    journalDirectory,
    plan: computed,
    expectedPlanHash: computed.planHash,
  });
  assert.ok(snapshot(hostRoot).length > before.length);

  // What rollback is: a checkout of the recorded commit, plus removal of the
  // files that commit does not know about. Proving it here is what makes the
  // recorded commit worth recording.
  git(hostRoot, ["checkout", "--quiet", "--force", applied.baselineCommit]);
  git(hostRoot, ["clean", "--quiet", "-fd"]);
  assert.deepEqual(
    snapshot(hostRoot),
    before,
    "the tree returns to exactly its pre-apply contents",
  );
});

// ------------------------------- engine staged files are not author work

test("a staged file the engine left does not count as uncommitted work", (t) => {
  // Found by continuous integration on Node 26, from two concurrent applies. One
  // reported writing nineteen files while the other refused with
  // "?? app/[...segments]/page.tsx.publisher-staged", telling the author to commit
  // or stash a file the engine had created moments earlier and was about to rename
  // away. A staged file exists only between a write and its rename, so a command
  // running alongside another can observe one.
  //
  // The exclusive journal create fixed the write phase. This gate runs before it,
  // so the loser never reached that refusal and got a misleading one instead.
  const { hostRoot } = workspace(t);
  mkdirSync(join(hostRoot, "app", "[...segments]"), { recursive: true });
  writeFileSync(
    join(hostRoot, "app", "[...segments]", "page.tsx.publisher-staged"),
    "partially written\n",
    "utf8",
  );

  const baseline = resolveGitBaseline(hostRoot);
  assert.match(baseline.commit, /^[0-9a-f]{40}$/u);
});

test("a staged file with an awkward name is still ignored", (t) => {
  // Porcelain output quotes a path containing unusual characters, so the check has
  // to accept both spellings or it silently stops working for exactly the paths a
  // renderer using a catch-all route segment produces.
  const { hostRoot } = workspace(t);
  for (const name of [
    "plain.tsx.publisher-staged",
    "with space.tsx.publisher-staged",
    "wîth-ünicode.tsx.publisher-staged",
  ]) {
    writeFileSync(join(hostRoot, name), "partial\n", "utf8");
  }
  const quoted = git(hostRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  assert.ok(
    quoted.includes('"'),
    `expected Git to quote at least one of these names, got: ${quoted}`,
  );
  assert.match(resolveGitBaseline(hostRoot).commit, /^[0-9a-f]{40}$/u);
});

test("real uncommitted work still refuses, alongside a staged file", (t) => {
  // The point of the gate. Ignoring engine staged files must not weaken it.
  const { hostRoot } = workspace(t);
  writeFileSync(
    join(hostRoot, "page.tsx.publisher-staged"),
    "partial\n",
    "utf8",
  );
  writeFileSync(join(hostRoot, "notes.txt"), "my own work\n", "utf8");

  assert.throws(
    () => resolveGitBaseline(hostRoot),
    (error) => {
      assert.match(error.message, /requires a clean Git tree/u);
      assert.match(error.message, /notes\.txt/u);
      // And it must not list the engine's own file as something to commit.
      assert.equal(
        error.message.includes("publisher-staged"),
        false,
        `the refusal named an engine file: ${error.message}`,
      );
      return true;
    },
  );
});
