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
import { createHash } from "node:crypto";
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
  PUBLISHER_APPLY_RECEIPT_FORMAT,
  PUBLISHER_APPLY_RECEIPT_PATH,
  readApplyReceipt,
  serializePublisherApplyReceipt,
  writeApplyReceipt,
} from "../packages/publisher/dist/node/lifecycle/apply-receipt.js";
import {
  PUBLISHER_HOST_STATE_PATH,
} from "../packages/publisher/dist/node/lifecycle/host-state.js";
import {
  applyHostInitialization,
  planHostInitialization,
} from "../packages/publisher/dist/node/lifecycle/init.js";
import {
  applyHostRollback,
  planHostRollback,
} from "../packages/publisher/dist/node/lifecycle/rollback.js";
import {
  applyHostUpgrade,
  planHostUpgrade,
} from "../packages/publisher/dist/node/lifecycle/upgrade.js";

const renderer = "@example/renderer";

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

function contract(version, files, rendererVersion = "1.0.0") {
  return { contractVersion: version, renderer, rendererVersion, files };
}

const v1 = contract("0.1.0", [
  { path: "package.json", contents: '{"name":"host"}\n' },
  { path: "app/page.tsx", contents: "export default null;\n" },
  { path: "pages/_error.tsx", contents: "export default null;\n" },
]);

const v2 = contract(
  "0.2.0",
  [
    { path: "package.json", contents: '{"name":"host","v":2}\n' },
    { path: "app/page.tsx", contents: "export default null;\n" },
    { path: "app/layout.tsx", contents: "export default null;\n" },
  ],
  "2.0.0",
);

const edges = Object.freeze([
  { from: "0.1.0", to: "0.2.0", summary: "Move error handling into app." },
]);

function workspace(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-rollback-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  // The host root is the repository root, which rollback requires so the
  // receipt's paths and Git's paths mean the same thing.
  const hostRoot = join(root, "host");
  mkdirSync(hostRoot);
  git(hostRoot, ["init", "--quiet", "--initial-branch=main"]);
  writeFileSync(
    join(hostRoot, ".gitignore"),
    ".publisher/\n",
    "utf8",
  );
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "initial"]);
  return { root, hostRoot, journalDirectory: join(root, "journal") };
}

function snapshot(root) {
  const files = {};
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".publisher") {
        continue;
      }
      const path = join(directory, entry.name);
      const key = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(path, key);
      } else {
        files[key] = createHash("sha256")
          .update(readFileSync(path))
          .digest("hex");
      }
    }
  };
  visit(root, "");
  return files;
}

function initialize(hostRoot, journalDirectory, template = v1) {
  const plan = planHostInitialization({
    hostRoot,
    template,
    layout: "canonical",
    enginePackages: { [renderer]: "1.0.0" },
  });
  return applyHostInitialization({
    hostRoot,
    journalDirectory,
    plan,
    expectedPlanHash: plan.planHash,
  });
}

function upgrade(hostRoot, journalDirectory) {
  const plan = planHostUpgrade({
    hostRoot,
    template: v2,
    migrationEdges: edges,
    enginePackages: { [renderer]: "2.0.0" },
  });
  return applyHostUpgrade({
    hostRoot,
    journalDirectory,
    plan,
    expectedPlanHash: plan.planHash,
  });
}

function rollback(hostRoot, journalDirectory) {
  const plan = planHostRollback({ hostRoot });
  return {
    plan,
    result: applyHostRollback({
      hostRoot,
      journalDirectory,
      plan,
      expectedPlanHash: plan.planHash,
    }),
  };
}

// -------------------------------------------------------------- receipts

test("an apply records the baseline commit and what it wrote", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  const applied = initialize(hostRoot, journalDirectory);

  const receipt = readApplyReceipt(hostRoot);
  assert.ok(receipt);
  assert.equal(receipt.operation, "initialize");
  assert.equal(receipt.baselineCommit, applied.baselineCommit);
  assert.equal(receipt.fromContractVersion, null);
  assert.equal(receipt.toContractVersion, "0.1.0");
  assert.deepEqual(
    receipt.files.map(({ path }) => path),
    [
      "app/page.tsx",
      "package.json",
      "pages/_error.tsx",
      PUBLISHER_HOST_STATE_PATH,
    ],
  );
  assert.ok(
    receipt.files.every(({ sha256 }) => sha256 !== null),
    "an initialization writes every path it records",
  );
});

test("an upgrade records the contract versions it moved between", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "initialize"]);

  upgrade(hostRoot, journalDirectory);
  const receipt = readApplyReceipt(hostRoot);
  assert.equal(receipt.operation, "upgrade");
  assert.equal(receipt.fromContractVersion, "0.1.0");
  assert.equal(receipt.toContractVersion, "0.2.0");
  const dropped = receipt.files.find(
    ({ path }) => path === "pages/_error.tsx",
  );
  assert.equal(
    dropped.sha256,
    null,
    "a removal is recorded as having left nothing behind",
  );
});

// ---------------------------------------------------------- rolling back

test("rolling back an initialization returns the tree to its pre-apply state", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  const before = snapshot(hostRoot);
  initialize(hostRoot, journalDirectory);
  assert.ok(Object.keys(snapshot(hostRoot)).length > Object.keys(before).length);

  const { plan, result } = rollback(hostRoot, journalDirectory);
  assert.equal(plan.outcome, "rollback");
  assert.equal(result.outcome, "applied");
  assert.deepEqual(
    snapshot(hostRoot),
    before,
    "every file the apply created is gone again",
  );
  assert.equal(
    existsSync(join(hostRoot, PUBLISHER_HOST_STATE_PATH)),
    false,
  );
  assert.equal(
    existsSync(join(hostRoot, PUBLISHER_APPLY_RECEIPT_PATH)),
    false,
    "the receipt is cleared, so the same apply cannot be rolled back twice",
  );
});

test("rolling back an upgrade restores the previous contract exactly", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "initialize"]);
  const before = snapshot(hostRoot);

  upgrade(hostRoot, journalDirectory);
  assert.ok(existsSync(join(hostRoot, "app", "layout.tsx")));
  assert.equal(existsSync(join(hostRoot, "pages", "_error.tsx")), false);

  const { result } = rollback(hostRoot, journalDirectory);
  assert.equal(result.outcome, "applied");
  assert.deepEqual(
    snapshot(hostRoot),
    before,
    "the upgrade is undone byte for byte",
  );
  assert.equal(
    existsSync(join(hostRoot, "app", "layout.tsx")),
    false,
    "a file the upgrade added is removed again",
  );
  assert.equal(
    readFileSync(join(hostRoot, "pages", "_error.tsx"), "utf8"),
    "export default null;\n",
    "a file the upgrade removed comes back from the baseline commit",
  );
});

test("rollback leaves unrelated untracked work alone", (t) => {
  // A broad checkout followed by a clean would delete this. Reverting a
  // lifecycle apply must not be a reason to lose an unrelated file.
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  writeFileSync(
    join(hostRoot, "my-notes.txt"),
    "unrelated work\n",
    "utf8",
  );

  rollback(hostRoot, journalDirectory);
  assert.equal(
    readFileSync(join(hostRoot, "my-notes.txt"), "utf8"),
    "unrelated work\n",
    "an untracked file the apply never touched must survive",
  );
});

test("nothing to roll back when no apply was recorded", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  const plan = planHostRollback({ hostRoot });
  assert.equal(plan.outcome, "nothingToRollBack");
  assert.equal(plan.receipt, null);
  const result = applyHostRollback({
    hostRoot,
    journalDirectory,
    plan,
    expectedPlanHash: plan.planHash,
  });
  assert.equal(result.outcome, "alreadyApplied");
  assert.deepEqual(result.restored, []);
});

test("a second rollback has nothing left to do", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  rollback(hostRoot, journalDirectory);
  const plan = planHostRollback({ hostRoot });
  assert.equal(plan.outcome, "nothingToRollBack");
});

// -------------------------------------------------------------- conflicts

test("a file changed since the apply is a conflict rather than reverted", (t) => {
  // Rollback must not be a way to discard work done after the apply.
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  writeFileSync(
    join(hostRoot, "app", "page.tsx"),
    "export default function Mine() { return null; }\n",
    "utf8",
  );
  const before = snapshot(hostRoot);

  const plan = planHostRollback({ hostRoot });
  assert.equal(plan.outcome, "conflicted");
  assert.deepEqual(
    plan.conflicts.map(({ path }) => path),
    ["app/page.tsx"],
  );
  assert.throws(
    () =>
      applyHostRollback({
        hostRoot,
        journalDirectory,
        plan,
        expectedPlanHash: plan.planHash,
      }),
    /rolling back would discard that work/u,
  );
  assert.deepEqual(snapshot(hostRoot), before);
  assert.ok(
    existsSync(join(hostRoot, PUBLISHER_APPLY_RECEIPT_PATH)),
    "a refused rollback keeps the receipt, so it can be retried",
  );
});

test("a rollback plan hash that was not reviewed is refused", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  const plan = planHostRollback({ hostRoot });
  const before = snapshot(hostRoot);
  assert.throws(
    () =>
      applyHostRollback({
        hostRoot,
        journalDirectory,
        plan,
        expectedPlanHash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      }),
    /rollback plan changed since it was reviewed/u,
  );
  assert.deepEqual(snapshot(hostRoot), before);
});

// -------------------------------------------------------------- receipts

test("a malformed receipt is refused rather than guessed at", (t) => {
  const { hostRoot } = workspace(t);
  mkdirSync(join(hostRoot, ".publisher"), { recursive: true });
  writeFileSync(
    join(hostRoot, PUBLISHER_APPLY_RECEIPT_PATH),
    `${JSON.stringify({
      format: "something-else",
      operation: "upgrade",
    })}\n`,
    "utf8",
  );
  assert.throws(
    () => planHostRollback({ hostRoot }),
    /does not understand/u,
  );
});

test("a receipt naming a short commit is refused", (t) => {
  const { hostRoot } = workspace(t);
  mkdirSync(join(hostRoot, ".publisher"), { recursive: true });
  writeFileSync(
    join(hostRoot, PUBLISHER_APPLY_RECEIPT_PATH),
    `${JSON.stringify({
      format: PUBLISHER_APPLY_RECEIPT_FORMAT,
      host: hostRoot,
      operation: "upgrade",
      planHash: `sha256:${"a".repeat(64)}`,
      baselineCommit: "abc1234",
      renderer,
      fromContractVersion: "0.1.0",
      toContractVersion: "0.2.0",
      files: [{ path: "package.json", sha256: null }],
    })}\n`,
    "utf8",
  );
  assert.throws(
    () => planHostRollback({ hostRoot }),
    /must record a full baseline commit/u,
  );
});

test("planning a rollback writes nothing", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  const before = snapshot(hostRoot);
  planHostRollback({ hostRoot });
  assert.deepEqual(snapshot(hostRoot), before);
});

// ---------------------------------------- a receipt belongs to one host

test("a receipt written for another host is refused", (t) => {
  // Demonstrated before the fix, in the arrangement this project actually uses.
  // Two worktrees of one repository share an object database, so the recorded
  // baseline commit resolves in either. Both trees hold byte identical contract
  // files from the commit, so the recorded digests match too. Rollback in the
  // second tree accepted the first tree's receipt, planned to remove nineteen
  // files against another branch's baseline, and exited zero.
  const { hostRoot } = workspace(t);
  const elsewhere = join(hostRoot, "..", "other-host");
  mkdirSync(elsewhere, { recursive: true });

  writeApplyReceipt(elsewhere, {
    format: PUBLISHER_APPLY_RECEIPT_FORMAT,
    operation: "initialize",
    planHash: `sha256:${"a".repeat(64)}`,
    baselineCommit: "b".repeat(40),
    renderer: "@example/alpha",
    fromContractVersion: null,
    toContractVersion: "0.1.0",
    files: [{ path: "app/page.tsx", sha256: null }],
  });

  // Carried across, exactly as copying .publisher between checkouts would.
  mkdirSync(join(hostRoot, ".publisher"), { recursive: true });
  writeFileSync(
    join(hostRoot, PUBLISHER_APPLY_RECEIPT_PATH),
    readFileSync(join(elsewhere, PUBLISHER_APPLY_RECEIPT_PATH), "utf8"),
    "utf8",
  );

  assert.throws(
    () => readApplyReceipt(hostRoot),
    (error) => {
      assert.match(error.message, /written for a different host/u);
      // Both hosts named, because "wrong host" without saying which two is not
      // something an author can act on.
      assert.ok(error.message.includes(elsewhere.replace(/\/\.\.\//u, "/")) || error.message.includes("other-host"));
      assert.ok(error.message.includes(hostRoot));
      return true;
    },
  );
});

test("a receipt for this host is accepted", (t) => {
  const { hostRoot } = workspace(t);
  writeApplyReceipt(hostRoot, {
    format: PUBLISHER_APPLY_RECEIPT_FORMAT,
    operation: "upgrade",
    planHash: `sha256:${"c".repeat(64)}`,
    baselineCommit: "d".repeat(40),
    renderer: "@example/alpha",
    fromContractVersion: "0.1.0",
    toContractVersion: "0.2.0",
    files: [{ path: "app/page.tsx", sha256: null }],
  });
  const receipt = readApplyReceipt(hostRoot);
  assert.ok(receipt);
  assert.equal(receipt.host, hostRoot);
  assert.equal(receipt.operation, "upgrade");
});

test("the serializer carries every field the type requires", (t) => {
  // The trap that bit me writing this. The serializer rebuilds the object from an
  // explicit field list rather than spreading it, so a field added to the type and
  // not added here is dropped on write and then reported as missing on read. The
  // symptom was that a freshly written receipt was rejected by its own reader.
  const { hostRoot } = workspace(t);
  const receipt = {
    format: PUBLISHER_APPLY_RECEIPT_FORMAT,
    host: hostRoot,
    operation: "initialize",
    planHash: `sha256:${"e".repeat(64)}`,
    baselineCommit: "f".repeat(40),
    renderer: "@example/alpha",
    fromContractVersion: null,
    toContractVersion: "0.1.0",
    files: [{ path: "app/page.tsx", sha256: null }],
  };
  const written = JSON.parse(serializePublisherApplyReceipt(receipt));
  for (const key of Object.keys(receipt)) {
    assert.ok(
      Object.hasOwn(written, key),
      `serialization dropped ${key}, which the reader will then reject`,
    );
  }
});
