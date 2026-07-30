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
import { execFileSync, spawnSync } from "node:child_process";
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
import { dirname, join } from "node:path";
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

// A renderer installed the way an author would have one: a real package in the
// host's node_modules exposing the ./host subpath. The CLI resolves it rather
// than importing a renderer statically, so a third-party renderer works too.
function installRenderer(hostRoot, name = "@example/renderer") {
  const packageRoot = join(hostRoot, "node_modules", ...name.split("/"));
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "1.2.3",
        type: "module",
        exports: { "./host": "./host.js" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(packageRoot, "host.js"),
    [
      "export const PUBLISHER_NEXT_HOST_CONTRACT_VERSION = \"0.1.0\";",
      "export function createPublisherNextHostTemplate(input) {",
      "  return {",
      "    contractVersion: PUBLISHER_NEXT_HOST_CONTRACT_VERSION,",
      `    renderer: ${JSON.stringify(name)},`,
      "    rendererVersion: \"1.2.3\",",
      "    files: [",
      "      {",
      "        path: \"package.json\",",
      "        contents: JSON.stringify({ name: input.hostPackageName }, null, 2) + \"\\n\",",
      "      },",
      "      { path: \"app/page.tsx\", contents: \"export default null;\\n\" },",
      "    ],",
      "  };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return packageRoot;
}

function workspace(t, { renderer = true, commit = true } = {}) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-cli-")),
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
  if (renderer) {
    installRenderer(hostRoot);
  }
  if (commit) {
    git(hostRoot, ["add", "-A"]);
    git(hostRoot, ["commit", "--quiet", "-m", "initial"]);
  }
  return { root, hostRoot };
}

function hostFiles(root) {
  const files = [];
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, {
      withFileTypes: true,
    })) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === ".publisher"
      ) {
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

function planHashFrom(stdout) {
  const match = /^Plan\s+(sha256:[a-f0-9]{64})$/mu.exec(stdout);
  assert.ok(match, `expected a plan hash in:\n${stdout}`);
  return match[1];
}

// ------------------------------------------------------------ basics

test("help and version are available and exit zero", (t) => {
  const { hostRoot } = workspace(t);
  const help = run(hostRoot, ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /genii-publisher <command>/u);
  assert.match(help.stdout, /init plan/u);

  const version = run(hostRoot, ["--version", "init", "plan"]);
  assert.equal(version.status, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/u);
});

test("no command prints usage and exits nonzero", (t) => {
  const { hostRoot } = workspace(t);
  const result = run(hostRoot, []);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /genii-publisher <command>/u);
});

test("an unknown command and an unknown option are refused", (t) => {
  const { hostRoot } = workspace(t);
  const unknownCommand = run(hostRoot, ["frobnicate"]);
  assert.equal(unknownCommand.status, 1);
  assert.match(unknownCommand.stderr, /Unknown command "frobnicate"/u);

  const unknownOption = run(hostRoot, ["init", "plan", "--wat"]);
  assert.equal(unknownOption.status, 1);
  assert.match(unknownOption.stderr, /Unknown option "--wat"/u);

  const missingValue = run(hostRoot, ["init", "plan", "--layout"]);
  assert.equal(missingValue.status, 1);
  assert.match(missingValue.stderr, /--layout requires a value/u);

  const badLayout = run(hostRoot, [
    "init",
    "plan",
    "--layout",
    "sideways",
  ]);
  assert.equal(badLayout.status, 1);
  assert.match(
    badLayout.stderr,
    /--layout must be canonical or declared/u,
  );
});

test("a missing renderer produces an instruction rather than a resolution failure", (t) => {
  const { hostRoot } = workspace(t, { renderer: false });
  const result = run(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/renderer",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not resolve @example\/renderer\/host/u);
  assert.match(result.stderr, /npm install --save-dev @example\/renderer/u);
});

// --------------------------------------------------------- plan and apply

test("init plan reports what would change and writes nothing", (t) => {
  const { hostRoot } = workspace(t);
  const before = hostFiles(hostRoot);

  const result = run(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/renderer",
  ]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Renderer\s+@example\/renderer 1\.2\.3/u);
  assert.match(result.stdout, /Layout\s+canonical/u);
  assert.match(result.stdout, /write\s+app\/page\.tsx/u);
  assert.match(result.stdout, /write\s+publisher\.host\.json/u);
  assert.match(result.stdout, /Nothing has been yet\./u);
  assert.match(result.stdout, /init apply --host .* --plan sha256:/u);

  assert.deepEqual(
    hostFiles(hostRoot),
    before,
    "planning must not write a single file",
  );
});

test("init apply refuses without the reviewed plan hash", (t) => {
  const { hostRoot } = workspace(t);
  const result = run(hostRoot, [
    "init",
    "apply",
    "--renderer",
    "@example/renderer",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires --plan <hash>/u);
  assert.equal(
    existsSync(join(hostRoot, "publisher.host.json")),
    false,
  );
});

test("init apply refuses a plan hash that was not the one computed", (t) => {
  const { hostRoot } = workspace(t);
  const result = run(hostRoot, [
    "init",
    "apply",
    "--renderer",
    "@example/renderer",
    "--plan",
    "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /plan changed since it was reviewed/u);
  assert.deepEqual(
    hostFiles(hostRoot),
    [".gitignore"],
    "a refused apply writes nothing",
  );
});

test("plan then apply initializes the host, and applying twice is a no-op", (t) => {
  const { hostRoot } = workspace(t);
  const planned = run(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/renderer",
  ]);
  const hash = planHashFrom(planned.stdout);

  const applied = run(hostRoot, [
    "init",
    "apply",
    "--renderer",
    "@example/renderer",
    "--plan",
    hash,
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Initialized /u);
  assert.match(applied.stdout, /Baseline commit [0-9a-f]{40}/u);
  assert.match(applied.stdout, /publisher\.host\.json/u);

  assert.deepEqual(hostFiles(hostRoot), [
    ".gitignore",
    "app/page.tsx",
    "package.json",
    "publisher.host.json",
  ]);
  // The host manifest is the renderer's, produced from the contract.
  assert.equal(
    JSON.parse(
      readFileSync(join(hostRoot, "package.json"), "utf8"),
    ).name,
    "publication-host",
  );

  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "initialize"]);

  const second = run(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/renderer",
  ]);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /Already initialized\. Nothing to apply\./u);

  const reapplied = run(hostRoot, [
    "init",
    "apply",
    "--renderer",
    "@example/renderer",
    "--plan",
    planHashFrom(second.stdout),
  ]);
  assert.equal(reapplied.status, 0, reapplied.stderr);
  assert.match(reapplied.stdout, /Already initialized\. Nothing changed\./u);
});

test("a conflicted plan exits nonzero so a script cannot mistake it for success", (t) => {
  const { hostRoot } = workspace(t);
  mkdirSync(join(hostRoot, "app"), { recursive: true });
  writeFileSync(
    join(hostRoot, "app", "page.tsx"),
    "the author got here first\n",
    "utf8",
  );
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "author page"]);

  const planned = run(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/renderer",
  ]);
  assert.equal(
    planned.status,
    1,
    "a refusal must not exit zero",
  );
  assert.match(planned.stdout, /CONFLICT\s+app\/page\.tsx/u);
  assert.match(planned.stdout, /Nothing has been written\./u);

  const applied = run(hostRoot, [
    "init",
    "apply",
    "--renderer",
    "@example/renderer",
    "--plan",
    planHashFrom(planned.stdout),
  ]);
  assert.equal(applied.status, 1);
  assert.match(
    applied.stderr,
    /must be reviewed rather than overwritten/u,
  );
  assert.equal(
    readFileSync(join(hostRoot, "app", "page.tsx"), "utf8"),
    "the author got here first\n",
    "the author's file must survive",
  );
});

test("a dirty tree is refused by the command", (t) => {
  const { hostRoot } = workspace(t);
  const planned = run(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/renderer",
  ]);
  writeFileSync(join(hostRoot, "scratch.txt"), "notes\n", "utf8");

  const applied = run(hostRoot, [
    "init",
    "apply",
    "--renderer",
    "@example/renderer",
    "--plan",
    planHashFrom(planned.stdout),
  ]);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /requires a clean Git tree/u);
  assert.match(applied.stderr, /scratch\.txt/u);
  assert.equal(
    existsSync(join(hostRoot, "publisher.host.json")),
    false,
  );
});

// ------------------------------------------------------- declared layout

test("a declared layout is recorded and protected roots are honoured", (t) => {
  const { hostRoot } = workspace(t);
  mkdirSync(join(hostRoot, "editorial"), { recursive: true });
  writeFileSync(
    join(hostRoot, "editorial", "one.md"),
    "# Volume One\n",
    "utf8",
  );
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "manuscript"]);

  const planned = run(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/renderer",
    "--layout",
    "declared",
    "--protected-root",
    "editorial",
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /Layout\s+declared/u);

  const applied = run(hostRoot, [
    "init",
    "apply",
    "--renderer",
    "@example/renderer",
    "--layout",
    "declared",
    "--protected-root",
    "editorial",
    "--plan",
    planHashFrom(planned.stdout),
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(
    readFileSync(join(hostRoot, "editorial", "one.md"), "utf8"),
    "# Volume One\n",
    "adoption must not touch the manuscript",
  );
  assert.equal(
    JSON.parse(
      readFileSync(join(hostRoot, "publisher.host.json"), "utf8"),
    ).layout,
    "declared",
  );
});

// -------------------------------------------------------------- json mode

test("json output is machine readable and carries the plan hash", (t) => {
  const { hostRoot } = workspace(t);
  const result = run(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/renderer",
    "--json",
  ]);
  assert.equal(result.status, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.outcome, "initialize");
  assert.match(plan.planHash, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(
    plan.mutations.map(({ path }) => path).sort(),
    ["app/page.tsx", "package.json", "publisher.host.json"],
  );
});

// --------------------------------------------------------------- recover

test("recover reports nothing to do on a clean host", (t) => {
  const { hostRoot } = workspace(t);
  const result = run(hostRoot, ["recover"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No interrupted apply to recover\./u);
});

test("recover restores the baseline left by an interrupted apply", (t) => {
  const { hostRoot } = workspace(t);
  const journalDirectory = join(hostRoot, ".publisher", "transaction");
  mkdirSync(join(journalDirectory, "backups"), { recursive: true });
  writeFileSync(
    join(journalDirectory, "backups", "0000-notes.txt"),
    "baseline\n",
  );
  writeFileSync(
    join(journalDirectory, "transaction.json"),
    `${JSON.stringify({
      format: "genii-publisher-host-transaction-1",
      root: hostRoot,
      entries: [
        {
          path: "notes.txt",
          priorHash: "sha256:unused",
          backup: "0000-notes.txt",
          intended: "sha256:unused",
        },
      ],
      createdDirectories: [],
    })}\n`,
  );
  writeFileSync(join(hostRoot, "notes.txt"), "half written\n", "utf8");

  const result = run(hostRoot, ["recover"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Restored the baseline for 1 file/u);
  assert.equal(
    readFileSync(join(hostRoot, "notes.txt"), "utf8"),
    "baseline\n",
  );
  assert.equal(existsSync(journalDirectory), false);
});

// -------------------------------------------------------------- host root

test("a missing host root is refused", (t) => {
  const { root, hostRoot } = workspace(t);
  const result = run(hostRoot, [
    "init",
    "plan",
    "--host",
    join(root, "nowhere"),
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /host root does not exist/u);
});

test("the host root defaults to the working directory", (t) => {
  const { hostRoot } = workspace(t);
  const result = run(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/renderer",
  ]);
  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    new RegExp(`Host\\s+${hostRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"),
  );
});
