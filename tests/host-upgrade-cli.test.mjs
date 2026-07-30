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

// The upgrade and rollback commands, end to end.
//
// These drive the real executable against real Git repositories with a real
// renderer installed into node_modules, because that is the only arrangement
// that proves the pieces meet. The library tests already cover each layer in
// isolation, and every defect these have found so far lived in the seam.
//
// The renderer here is deliberately not the Next one. A third-party renderer
// exercises the same contract, so a passing suite says the boundary is real
// rather than that the engine can talk to itself.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const executable = fileURLToPath(
  new URL(
    "../packages/publisher/bin/genii-publisher.mjs",
    import.meta.url,
  ),
);

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

function run(hostRoot, args) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: hostRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const rendererName = "@example/renderer";

/**
 * Writes a renderer generation into the host's node_modules.
 *
 * Upgrading is what happens when this is called a second time with a different
 * contract, which is exactly how an author experiences it: the package on disk
 * changes underneath a host that has not moved yet.
 */
function installRenderer(
  hostRoot,
  {
    contractVersion = "0.1.0",
    version = "1.2.3",
    files = [
      { path: "app/page.tsx", contents: "export default null;\n" },
      { path: "app/layout.tsx", contents: "export default null;\n" },
    ],
    migrations = [],
    omitMigrations = false,
  } = {},
) {
  const packageRoot = join(
    hostRoot,
    "node_modules",
    ...rendererName.split("/"),
  );
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: rendererName,
        version,
        type: "module",
        exports: { "./host": "./host.js" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const declared = [
    {
      path: "package.json",
      contents: null,
    },
    ...files,
  ];
  writeFileSync(
    join(packageRoot, "host.js"),
    [
      `export const PUBLISHER_NEXT_HOST_CONTRACT_VERSION = ${JSON.stringify(
        contractVersion,
      )};`,
      'export const PUBLISHER_NEXT_HOST_CAPABILITIES = { routeKinds: ["home", "work", "collection", "section", "updates"] };',
      omitMigrations
        ? "// registry deliberately absent"
        : `export const PUBLISHER_NEXT_HOST_MIGRATIONS = ${JSON.stringify(
            migrations,
          )};`,
      "export function createPublisherNextHostTemplate(input) {",
      "  return {",
      "    contractVersion: PUBLISHER_NEXT_HOST_CONTRACT_VERSION,",
      `    renderer: ${JSON.stringify(rendererName)},`,
      `    rendererVersion: ${JSON.stringify(version)},`,
      `    files: ${JSON.stringify(declared)}.map((file) =>`,
      "      file.contents === null",
      "        ? {",
      "            path: file.path,",
      "            contents:",
      "              JSON.stringify({ name: input.hostPackageName }, null, 2) +",
      '              "\\n",',
      "          }",
      "        : file,",
      "    ),",
      "  };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}

function workspace(t, rendererOptions = {}) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-upgrade-cli-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const hostRoot = join(root, "host");
  mkdirSync(hostRoot);
  git(hostRoot, ["init", "--quiet", "--initial-branch=main"]);
  writeFileSync(
    join(hostRoot, ".gitignore"),
    "node_modules/\n.publisher/\n",
    "utf8",
  );
  installRenderer(hostRoot, rendererOptions);
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "initial"]);
  return { root, hostRoot };
}

function planHashFrom(stdout) {
  const match = /^Plan\s+(sha256:[a-f0-9]{64})$/mu.exec(stdout);
  assert.ok(match, `expected a plan hash in:\n${stdout}`);
  return match[1];
}

/** Initializes a host and commits the result, the way an author would. */
function initialize(hostRoot) {
  const planned = run(hostRoot, ["init", "plan", "--renderer", rendererName]);
  assert.equal(planned.status, 0, planned.stderr);
  const applied = run(hostRoot, [
    "init",
    "apply",
    "--renderer",
    rendererName,
    "--plan",
    planHashFrom(planned.stdout),
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "initialize"]);
  return applied;
}

// ------------------------------------------------------- upgrade plan

test("a host on the installed contract has nothing to upgrade", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);

  const planned = run(hostRoot, [
    "upgrade",
    "plan",
    "--renderer",
    rendererName,
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /Already on the installed contract/u);
});

test("a newer contract is planned, applied, and recorded", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);

  // The renderer on disk advances underneath the host. Nothing in the host has
  // changed yet, which is the state an author is in after npm install.
  installRenderer(hostRoot, {
    contractVersion: "0.2.0",
    version: "2.0.0",
    files: [
      { path: "app/page.tsx", contents: "export default null; // v2\n" },
      { path: "app/error.tsx", contents: "export default null;\n" },
    ],
    migrations: [
      { from: "0.1.0", to: "0.2.0", summary: "replaces the layout with an error boundary" },
    ],
  });

  const planned = run(hostRoot, [
    "upgrade",
    "plan",
    "--renderer",
    rendererName,
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /Contract\s+0\.1\.0 to 0\.2\.0/u);
  assert.match(planned.stdout, /replaces the layout with an error boundary/u);
  // The old contract owned app/layout.tsx and the new one does not, so the
  // upgrade removes it rather than leaving a file nothing claims.
  assert.match(planned.stdout, /remove\s+app\/layout\.tsx/u);
  assert.match(planned.stdout, /write\s+app\/error\.tsx/u);
  // Planning writes nothing.
  assert.ok(existsSync(join(hostRoot, "app", "layout.tsx")));

  const applied = run(hostRoot, [
    "upgrade",
    "apply",
    "--renderer",
    rendererName,
    "--plan",
    planHashFrom(planned.stdout),
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Contract 0\.1\.0 to 0\.2\.0/u);

  assert.equal(existsSync(join(hostRoot, "app", "layout.tsx")), false);
  assert.ok(existsSync(join(hostRoot, "app", "error.tsx")));
  assert.match(
    readFileSync(join(hostRoot, "app", "page.tsx"), "utf8"),
    /\/\/ v2/u,
  );

  const state = JSON.parse(
    readFileSync(join(hostRoot, "publisher.host.json"), "utf8"),
  );
  assert.equal(state.hostContractVersion, "0.2.0");
  const managed = state.managedFiles.map((file) => file.path);
  assert.equal(managed.includes("app/layout.tsx"), false);
  assert.ok(managed.includes("app/error.tsx"));
});

test("a stale plan hash is refused", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);
  installRenderer(hostRoot, {
    contractVersion: "0.2.0",
    version: "2.0.0",
    migrations: [{ from: "0.1.0", to: "0.2.0", summary: "moves on" }],
  });

  const applied = run(hostRoot, [
    "upgrade",
    "apply",
    "--renderer",
    rendererName,
    "--plan",
    `sha256:${"0".repeat(64)}`,
  ]);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /plan changed since it was reviewed/u);
});

test("upgrade apply without a plan hash is refused", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);
  const applied = run(hostRoot, [
    "upgrade",
    "apply",
    "--renderer",
    rendererName,
  ]);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /requires --plan/u);
});

test("a renderer with no migration registry cannot be upgraded to", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);
  installRenderer(hostRoot, {
    contractVersion: "0.2.0",
    version: "2.0.0",
    omitMigrations: true,
  });

  const planned = run(hostRoot, [
    "upgrade",
    "plan",
    "--renderer",
    rendererName,
  ]);
  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /migration registry/u);
  // Absent must not read as empty, because an empty registry would mean no route
  // and therefore no manual steps to report.
  assert.match(planned.stderr, /empty array/u);
});

test("manual steps gate an apply until acknowledged", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);
  installRenderer(hostRoot, {
    contractVersion: "0.2.0",
    version: "2.0.0",
    migrations: [
      {
        from: "0.1.0",
        to: "0.2.0",
        summary: "requires a provider setting",
        manualSteps: ["Enable the image optimizer in your hosting provider."],
      },
    ],
  });

  const planned = run(hostRoot, [
    "upgrade",
    "plan",
    "--renderer",
    rendererName,
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /Manual steps this tooling will not perform/u);
  assert.match(planned.stdout, /Enable the image optimizer/u);
  // The suggested command carries the flag, so an author is not left guessing.
  assert.match(planned.stdout, /--acknowledge-manual-steps/u);
  const planHash = planHashFrom(planned.stdout);

  const refused = run(hostRoot, [
    "upgrade",
    "apply",
    "--renderer",
    rendererName,
    "--plan",
    planHash,
  ]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /the engine will not perform/u);
  // The refusal repeats the step, so an author reading only the failure still
  // learns what is being asked of them.
  assert.match(refused.stderr, /Enable the image optimizer/u);
  assert.match(
    readFileSync(join(hostRoot, "publisher.host.json"), "utf8"),
    /"hostContractVersion": "0\.1\.0"/u,
  );

  const applied = run(hostRoot, [
    "upgrade",
    "apply",
    "--renderer",
    rendererName,
    "--plan",
    planHash,
    "--acknowledge-manual-steps",
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(
    readFileSync(join(hostRoot, "publisher.host.json"), "utf8"),
    /"hostContractVersion": "0\.2\.0"/u,
  );
});

test("a locally modified host file conflicts and nothing is written", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);
  writeFileSync(
    join(hostRoot, "app", "page.tsx"),
    "export default null; // mine\n",
    "utf8",
  );
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "local edit"]);
  installRenderer(hostRoot, {
    contractVersion: "0.2.0",
    version: "2.0.0",
    migrations: [{ from: "0.1.0", to: "0.2.0", summary: "moves on" }],
  });

  const planned = run(hostRoot, [
    "upgrade",
    "plan",
    "--renderer",
    rendererName,
  ]);
  assert.equal(planned.status, 1, "a conflicted plan must not report success");
  assert.match(planned.stdout, /CONFLICT\s+app\/page\.tsx/u);
  assert.match(planned.stdout, /Nothing has been written/u);
  assert.match(
    readFileSync(join(hostRoot, "app", "page.tsx"), "utf8"),
    /\/\/ mine/u,
  );
});

// ------------------------------------------------------------ rollback

test("a host with no recorded apply has nothing to roll back", (t) => {
  const { hostRoot } = workspace(t);
  const planned = run(hostRoot, ["rollback", "plan"]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /No recorded apply to roll back/u);
});

test("rolling back an upgrade restores the previous contract exactly", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);
  const before = {
    page: readFileSync(join(hostRoot, "app", "page.tsx"), "utf8"),
    layout: readFileSync(join(hostRoot, "app", "layout.tsx"), "utf8"),
    state: readFileSync(join(hostRoot, "publisher.host.json"), "utf8"),
  };

  installRenderer(hostRoot, {
    contractVersion: "0.2.0",
    version: "2.0.0",
    files: [
      { path: "app/page.tsx", contents: "export default null; // v2\n" },
      { path: "app/error.tsx", contents: "export default null;\n" },
    ],
    migrations: [{ from: "0.1.0", to: "0.2.0", summary: "moves on" }],
  });
  const planned = run(hostRoot, [
    "upgrade",
    "plan",
    "--renderer",
    rendererName,
  ]);
  const applied = run(hostRoot, [
    "upgrade",
    "apply",
    "--renderer",
    rendererName,
    "--plan",
    planHashFrom(planned.stdout),
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  // The apply tells the author how to undo it, which is the whole point of
  // recording a baseline.
  assert.match(applied.stdout, /rollback plan/u);

  const rollbackPlan = run(hostRoot, ["rollback", "plan"]);
  assert.equal(rollbackPlan.status, 0, rollbackPlan.stderr);
  assert.match(rollbackPlan.stdout, /Undoing\s+upgrade sha256:[a-f0-9]{64}/u);
  // app/error.tsx did not exist at the baseline, so rolling back removes it.
  assert.match(rollbackPlan.stdout, /remove\s+app\/error\.tsx/u);

  const rolledBack = run(hostRoot, [
    "rollback",
    "apply",
    "--plan",
    planHashFrom(rollbackPlan.stdout),
  ]);
  assert.equal(rolledBack.status, 0, rolledBack.stderr);

  assert.equal(
    readFileSync(join(hostRoot, "app", "page.tsx"), "utf8"),
    before.page,
  );
  assert.equal(
    readFileSync(join(hostRoot, "app", "layout.tsx"), "utf8"),
    before.layout,
  );
  assert.equal(
    readFileSync(join(hostRoot, "publisher.host.json"), "utf8"),
    before.state,
  );
  assert.equal(existsSync(join(hostRoot, "app", "error.tsx")), false);

  // The receipt is spent, so a second rollback is not offered.
  const again = run(hostRoot, ["rollback", "plan"]);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /No recorded apply to roll back/u);
});

test("rolling back an initialization removes what it created", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);
  assert.ok(existsSync(join(hostRoot, "publisher.host.json")));

  const rollbackPlan = run(hostRoot, ["rollback", "plan"]);
  assert.equal(rollbackPlan.status, 0, rollbackPlan.stderr);
  assert.match(rollbackPlan.stdout, /Undoing\s+init/u);

  const rolledBack = run(hostRoot, [
    "rollback",
    "apply",
    "--plan",
    planHashFrom(rollbackPlan.stdout),
  ]);
  assert.equal(rolledBack.status, 0, rolledBack.stderr);
  assert.equal(existsSync(join(hostRoot, "publisher.host.json")), false);
  assert.equal(existsSync(join(hostRoot, "app", "page.tsx")), false);
  // package.json existed before initializing only if the host had one. This
  // fixture did not, so it goes away too.
  assert.equal(existsSync(join(hostRoot, "package.json")), false);
  // What the author brought stays.
  assert.ok(existsSync(join(hostRoot, ".gitignore")));
});

test("a file touched since the apply blocks rollback and keeps the receipt", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);
  writeFileSync(
    join(hostRoot, "app", "page.tsx"),
    "export default null; // edited after the apply\n",
    "utf8",
  );

  const planned = run(hostRoot, ["rollback", "plan"]);
  assert.equal(planned.status, 1, "a conflicted rollback must not exit zero");
  assert.match(planned.stdout, /CONFLICT\s+app\/page\.tsx/u);

  const refused = run(hostRoot, [
    "rollback",
    "apply",
    "--plan",
    planHashFrom(planned.stdout),
  ]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /would discard that work/u);
  assert.match(
    readFileSync(join(hostRoot, "app", "page.tsx"), "utf8"),
    /edited after the apply/u,
  );

  // Restoring the file makes the rollback available again. A refusal must be a
  // pause, not a dead end, so the receipt survives it.
  const state = JSON.parse(
    readFileSync(join(hostRoot, "publisher.host.json"), "utf8"),
  );
  assert.ok(
    state.managedFiles.some((file) => file.path === "app/page.tsx"),
    "the conflicted file must still be recorded as managed",
  );
  writeFileSync(
    join(hostRoot, "app", "page.tsx"),
    "export default null;\n",
    "utf8",
  );
  const retried = run(hostRoot, ["rollback", "plan"]);
  assert.equal(retried.status, 0, retried.stderr);
  assert.match(retried.stdout, /Undoing\s+init/u);
});

test("rollback leaves unrelated untracked work alone", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);
  writeFileSync(join(hostRoot, "my-notes.txt"), "keep me\n", "utf8");

  const planned = run(hostRoot, ["rollback", "plan"]);
  assert.equal(planned.status, 0, planned.stderr);
  const rolledBack = run(hostRoot, [
    "rollback",
    "apply",
    "--plan",
    planHashFrom(planned.stdout),
  ]);
  assert.equal(rolledBack.status, 0, rolledBack.stderr);

  // A checkout of the baseline followed by a clean would have deleted this. That
  // is why rollback restores recorded paths rather than resetting the tree.
  assert.equal(
    readFileSync(join(hostRoot, "my-notes.txt"), "utf8"),
    "keep me\n",
  );
  assert.equal(existsSync(join(hostRoot, "publisher.host.json")), false);
});

test("rollback apply without a plan hash is refused", (t) => {
  const { hostRoot } = workspace(t);
  initialize(hostRoot);
  const refused = run(hostRoot, ["rollback", "apply"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /requires --plan/u);
});
