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
import { createHash } from "node:crypto";
import {
  chmodSync,
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
  PUBLISHER_HOST_STATE_PATH,
  parsePublisherHostState,
} from "../packages/publisher/dist/node/lifecycle/host-state.js";
import {
  applyHostInitialization,
  planHostInitialization,
} from "../packages/publisher/dist/node/lifecycle/init.js";
import {
  applyHostUpgrade,
  planHostUpgrade,
} from "../packages/publisher/dist/node/lifecycle/upgrade.js";

const renderer = "@example/renderer";
const enginePackages = Object.freeze({ [renderer]: "1.0.0" });

function contract(version, files, rendererVersion = "1.0.0") {
  return {
    contractVersion: version,
    renderer,
    rendererVersion,
    files,
  };
}

const v1 = contract("0.1.0", [
  { path: "package.json", contents: '{"name":"host"}\n' },
  { path: "app/page.tsx", contents: "export default null;\n" },
  { path: "pages/_error.tsx", contents: "export default null;\n" },
]);

// Rewrites one file, adds one, and drops pages/_error.tsx.
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
    mkdtempSync(join(tmpdir(), "publisher-host-upgrade-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const hostRoot = join(root, "host");
  mkdirSync(hostRoot);
  return { root, hostRoot, journalDirectory: join(root, "journal") };
}

function snapshot(root) {
  const files = {};
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
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

// Locks a directory so a write inside it fails. Returns false when the platform
// does not enforce it, in which case the caller skips.
function lockDirectory(t, path) {
  try {
    chmodSync(path, 0o500);
  } catch {
    return false;
  }
  t.after(() => {
    try {
      chmodSync(path, 0o700);
    } catch {
      // Already restored.
    }
  });
  try {
    writeFileSync(join(path, ".probe"), "probe");
    rmSync(join(path, ".probe"), { force: true });
    chmodSync(path, 0o700);
    return false;
  } catch {
    return true;
  }
}

function initialize(hostRoot, journalDirectory, template = v1) {
  const plan = planHostInitialization({
    hostRoot,
    template,
    layout: "canonical",
    enginePackages,
  });
  applyHostInitialization({
    hostRoot,
    journalDirectory,
    plan,
    expectedPlanHash: plan.planHash,
    skipGitBaseline: true,
  });
  return plan;
}

function planUpgrade(hostRoot, overrides = {}) {
  return planHostUpgrade({
    hostRoot,
    template: v2,
    migrationEdges: edges,
    enginePackages: { [renderer]: "2.0.0" },
    ...overrides,
  });
}

function applyUpgrade(hostRoot, journalDirectory, plan, overrides = {}) {
  return applyHostUpgrade({
    hostRoot,
    journalDirectory,
    plan,
    expectedPlanHash: plan.planHash,
    skipGitBaseline: true,
    ...overrides,
  });
}

// ------------------------------------------------------------ happy path

test("an upgrade writes changed files, adds new ones, and removes dropped ones", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  assert.ok(existsSync(join(hostRoot, "pages", "_error.tsx")));

  const plan = planUpgrade(hostRoot);
  assert.equal(plan.outcome, "upgrade");
  assert.equal(plan.fromContractVersion, "0.1.0");
  assert.equal(plan.toContractVersion, "0.2.0");
  assert.deepEqual(plan.removed, ["pages/_error.tsx"]);
  assert.deepEqual(
    plan.migrationPath.edges.map(({ from, to }) => `${from}->${to}`),
    ["0.1.0->0.2.0"],
  );

  const result = applyUpgrade(hostRoot, journalDirectory, plan);
  assert.equal(result.outcome, "applied");
  assert.equal(result.fromContractVersion, "0.1.0");
  assert.equal(result.toContractVersion, "0.2.0");

  assert.equal(
    readFileSync(join(hostRoot, "package.json"), "utf8"),
    '{"name":"host","v":2}\n',
    "a changed file is rewritten",
  );
  assert.ok(
    existsSync(join(hostRoot, "app", "layout.tsx")),
    "a new file is added",
  );
  assert.equal(
    existsSync(join(hostRoot, "pages", "_error.tsx")),
    false,
    "a dropped file is removed rather than orphaned",
  );

  const state = parsePublisherHostState(
    readFileSync(join(hostRoot, PUBLISHER_HOST_STATE_PATH), "utf8"),
  );
  assert.equal(state.hostContractVersion, "0.2.0");
  assert.equal(state.rendererVersion, "2.0.0");
  assert.deepEqual(
    state.managedFiles.map(({ path }) => path),
    ["app/layout.tsx", "app/page.tsx", "package.json"],
    "the recorded file set no longer mentions the dropped file",
  );
  assert.equal(
    state.layout,
    "canonical",
    "an upgrade does not change the layout the host was adopted under",
  );
});

test("upgrading a host already on the target reports alreadyCurrent", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  const plan = planUpgrade(hostRoot);
  applyUpgrade(hostRoot, journalDirectory, plan);
  const before = snapshot(hostRoot);

  const second = planUpgrade(hostRoot);
  assert.equal(second.outcome, "alreadyCurrent");
  assert.deepEqual(second.migrationPath.edges, []);
  const result = applyUpgrade(hostRoot, journalDirectory, second);
  assert.equal(result.outcome, "alreadyApplied");
  assert.deepEqual(snapshot(hostRoot), before);
});

test("planning writes nothing", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  const before = snapshot(hostRoot);
  planUpgrade(hostRoot);
  assert.deepEqual(snapshot(hostRoot), before);
});

// -------------------------------------------------------------- conflicts

test("an edited file the new contract still owns is a conflict", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  writeFileSync(
    join(hostRoot, "package.json"),
    '{"name":"mine"}\n',
    "utf8",
  );
  const before = snapshot(hostRoot);

  const plan = planUpgrade(hostRoot);
  assert.equal(plan.outcome, "conflicted");
  assert.deepEqual(
    plan.conflicts.map(({ path }) => path),
    ["package.json"],
  );
  assert.throws(
    () => applyUpgrade(hostRoot, journalDirectory, plan),
    /must be reviewed rather than overwritten/u,
  );
  assert.deepEqual(snapshot(hostRoot), before);
});

test("an edited file the new contract drops is a conflict, not a deletion", (t) => {
  // The case that would quietly destroy work: the author customized a file, and
  // the upgrade's answer for it is removal. A diff would not show them the loss
  // because the file would simply be gone.
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  writeFileSync(
    join(hostRoot, "pages", "_error.tsx"),
    "export default function Mine() { return null; }\n",
    "utf8",
  );
  const before = snapshot(hostRoot);

  const plan = planUpgrade(hostRoot);
  assert.equal(plan.outcome, "conflicted");
  assert.deepEqual(
    plan.conflicts.map(({ path }) => path),
    ["pages/_error.tsx"],
  );
  assert.equal(plan.conflicts[0].intended, null, "the intent was removal");

  assert.throws(
    () => applyUpgrade(hostRoot, journalDirectory, plan),
    /must be reviewed rather than overwritten/u,
  );
  assert.deepEqual(
    snapshot(hostRoot),
    before,
    "the author's customization must survive",
  );
  assert.equal(
    readFileSync(join(hostRoot, "pages", "_error.tsx"), "utf8"),
    "export default function Mine() { return null; }\n",
  );
});

test("tampering with a recorded hash surfaces the file as a conflict", (t) => {
  // The security-relevant part of the recorded state is the hashes. If an author
  // rewrites one, the engine must not accept the corresponding file as untouched,
  // because that is how a local edit would be silently overwritten.
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  const statePath = join(hostRoot, PUBLISHER_HOST_STATE_PATH);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const target = state.managedFiles.find(
    ({ path }) => path === "package.json",
  );
  target.sha256 = `sha256:${"1".repeat(64)}`;
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const plan = planUpgrade(hostRoot);
  assert.equal(plan.outcome, "conflicted");
  assert.ok(
    plan.conflicts.some(({ path }) => path === "package.json"),
    "the file whose recorded hash was altered must be treated as modified",
  );
});

test("a state file whose formatting was altered is a conflict", (t) => {
  // The recorded state is compared by content hash, so reformatting it is
  // indistinguishable from editing it and is reported the same way.
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  const statePath = join(hostRoot, PUBLISHER_HOST_STATE_PATH);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  writeFileSync(statePath, `${JSON.stringify(state)}\n`, "utf8");

  const plan = planUpgrade(hostRoot);
  assert.equal(plan.outcome, "conflicted");
  assert.ok(
    plan.conflicts.some(
      ({ path }) => path === PUBLISHER_HOST_STATE_PATH,
    ),
  );
});

// ------------------------------------------------------------ preconditions

test("upgrading an uninitialized host is refused", (t) => {
  const { hostRoot } = workspace(t);
  assert.throws(
    () => planUpgrade(hostRoot),
    /no publisher\.host\.json, so there is nothing to upgrade from/u,
  );
});

test("changing renderer is refused rather than treated as an upgrade", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  assert.throws(
    () =>
      planUpgrade(hostRoot, {
        template: { ...v2, renderer: "@example/other" },
      }),
    /Changing renderer is not an upgrade/u,
  );
});

test("a host on a version the target never knew about is refused", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  assert.throws(
    () =>
      planUpgrade(hostRoot, {
        // The registry only knows how to arrive from 0.9.0.
        migrationEdges: [
          { from: "0.9.0", to: "0.2.0", summary: "unrelated" },
        ],
      }),
    /No migration path from contract 0\.1\.0 to 0\.2\.0/u,
  );
});

test("a contract reaching into a declared root is refused before the tree is read", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  mkdirSync(join(hostRoot, "editorial"), { recursive: true });
  writeFileSync(
    join(hostRoot, "editorial", "one.md"),
    "# Volume One\n",
    "utf8",
  );
  assert.throws(
    () =>
      planUpgrade(hostRoot, {
        protectedRoots: ["editorial"],
        template: contract("0.2.0", [
          { path: "package.json", contents: "{}\n" },
          {
            path: "editorial/one.md",
            contents: "# Rewritten\n",
          },
        ]),
      }),
    /inside the declared root editorial/u,
  );
  assert.equal(
    readFileSync(join(hostRoot, "editorial", "one.md"), "utf8"),
    "# Volume One\n",
  );
});

// ------------------------------------------------------------ plan binding

test("applying a plan hash that was not reviewed is refused", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  const plan = planUpgrade(hostRoot);
  const before = snapshot(hostRoot);
  assert.throws(
    () =>
      applyHostUpgrade({
        hostRoot,
        journalDirectory,
        plan,
        expectedPlanHash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        skipGitBaseline: true,
      }),
    /plan changed since it was reviewed/u,
  );
  assert.deepEqual(snapshot(hostRoot), before);
});

test("the migration route is part of the plan hash", (t) => {
  // Reaching the same target by a different chain is a different change, even
  // when the resulting files are identical.
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  const direct = planUpgrade(hostRoot);
  const viaIntermediate = planUpgrade(hostRoot, {
    migrationEdges: [
      { from: "0.1.0", to: "0.1.5", summary: "step one" },
      { from: "0.1.5", to: "0.2.0", summary: "step two" },
    ],
  });
  assert.deepEqual(
    viaIntermediate.migrationPath.edges.map(({ to }) => to),
    ["0.1.5", "0.2.0"],
  );
  assert.notEqual(direct.planHash, viaIntermediate.planHash);
});

// ------------------------------------------------------------ manual gates

test("an upgrade carrying manual steps refuses to apply until they are acknowledged", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  const gated = planUpgrade(hostRoot, {
    migrationEdges: [
      {
        from: "0.1.0",
        to: "0.2.0",
        summary: "Move error handling into app.",
        manualSteps: [
          "Run the database migration.",
          "Rotate the provider key.",
        ],
      },
    ],
  });
  assert.deepEqual(gated.manualSteps, [
    "Run the database migration.",
    "Rotate the provider key.",
  ]);
  const before = snapshot(hostRoot);

  assert.throws(
    () => applyUpgrade(hostRoot, journalDirectory, gated),
    (error) => {
      assert.match(
        error.message,
        /requires 2 step\(s\) the engine will not perform/u,
      );
      assert.match(error.message, /Run the database migration\./u);
      return true;
    },
  );
  assert.deepEqual(
    snapshot(hostRoot),
    before,
    "a gated upgrade must not write before it is acknowledged",
  );

  const result = applyUpgrade(hostRoot, journalDirectory, gated, {
    acknowledgedManualSteps: true,
  });
  assert.equal(result.outcome, "applied");
});

test("an upgrade with no manual steps needs no acknowledgement", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);
  const plan = planUpgrade(hostRoot);
  assert.deepEqual(plan.manualSteps, []);
  assert.equal(
    applyUpgrade(hostRoot, journalDirectory, plan).outcome,
    "applied",
  );
});

// ------------------------------------------------------------ atomicity

test("an upgrade that fails partway restores the pre-upgrade host", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  initialize(hostRoot, journalDirectory);

  // A directory the upgrade must write into, made unwritable so the failure
  // happens after earlier mutations have already been made. Classification
  // passes, which is the point: the failure has to occur during the write.
  const locked = join(hostRoot, "locked");
  mkdirSync(locked);
  const before = snapshot(hostRoot);
  if (!lockDirectory(t, locked)) {
    t.skip("This platform does not enforce directory write permissions.");
    return;
  }

  const plan = planUpgrade(hostRoot, {
    template: contract(
      "0.2.0",
      [
        { path: "package.json", contents: '{"name":"host","v":2}\n' },
        { path: "app/page.tsx", contents: "export default null;\n" },
        { path: "locked/blocked.tsx", contents: "export default null;\n" },
      ],
      "2.0.0",
    ),
  });
  assert.equal(plan.outcome, "upgrade");

  assert.throws(() => applyUpgrade(hostRoot, journalDirectory, plan));

  assert.deepEqual(
    snapshot(hostRoot),
    before,
    "every file the upgrade touched must be restored, including the one it removed",
  );
  assert.equal(
    parsePublisherHostState(
      readFileSync(join(hostRoot, PUBLISHER_HOST_STATE_PATH), "utf8"),
    ).hostContractVersion,
    "0.1.0",
    "the recorded version must not advance when the upgrade failed",
  );
  assert.equal(
    existsSync(join(hostRoot, "pages", "_error.tsx")),
    true,
    "a file the failed upgrade would have removed must come back",
  );
  assert.equal(existsSync(journalDirectory), false);
});
