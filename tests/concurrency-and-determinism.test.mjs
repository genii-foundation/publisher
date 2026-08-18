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

// Two properties nothing was asserting, both found by probing rather than reading.
//
// The artifact must be byte identical across supported Node versions. If it is not,
// then `build --check` in continuous integration reports a stale artifact forever
// against an author who built it on a different runtime, and the only fix anyone
// would find is to stop running the check.
//
// Two applies at once must not both fail. They used to: both passed the journal
// existence check, then trampled each other's staged files and died with a raw
// ENOENT naming an internal staged path. The tree was restored correctly in every
// run, so the safety property held, but the work did not get done and neither
// author was told anything actionable. Creating the journal exclusively closes the
// gap, so one apply completes and the other is refused by name.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPublicationReader,
} from "../packages/publisher/dist/node.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const executable = join(
  repositoryRoot,
  "packages",
  "publisher",
  "bin",
  "genii-publisher.mjs",
);
const nextPackageRoot = join(repositoryRoot, "packages", "next");
const servable = join(repositoryRoot, "fixtures", "canonical-tide-tables");

// ------------------------------------------------------------ determinism

/**
 * Digests recorded from every supported runtime.
 *
 * Pinned deliberately. A test that only compares one runtime against itself
 * proves the build is repeatable, not that it is portable, and portability is the
 * property `build --check` depends on. Measured on 22.12.0, 24.18.0, and 26.4.0.
 */
const expectedDigests = Object.freeze({
  "canonical-tide-tables":
    "02989c86def31920e6d4ea753e0bd138",
  // Updates targets now carry their stable view identity, so these two Reader
  // artifacts moved together. Remeasured on 22.12.0, 24.18.0, and 26.4.0.
  "canonical-field-notes":
    "dcc268d4ceb100671132a77e6daacdd0",
  "declared-night-dispatch":
    "aa20f88a42b68f8eb1d3b0646763967c",
  "canonical-narrated-tides":
    "4a26cdd81b0374c8c2ef4140d086a7b0",
});

for (const [fixture, expected] of Object.entries(expectedDigests)) {
  test(`${fixture} builds to the same bytes on every supported runtime`, async () => {
    const built = await buildPublicationReader({
      publicationRoot: join(repositoryRoot, "fixtures", fixture),
      audience: "public",
    });
    assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
    const digest = createHash("sha256")
      .update(built.value.text, "utf8")
      .digest("hex")
      .slice(0, 32);
    assert.equal(
      digest,
      expected,
      `${fixture} changed shape. If that was intended, update the pinned digest and ` +
        `check it on 22.12.0, 24.18.0, and 26.4.0, because an artifact that differs ` +
        `between runtimes makes build --check permanently stale.`,
    );
  });
}

// ------------------------------------------------------------ concurrency

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

/** A host with the shipped renderer, ready to initialize. */
function host(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "publisher-race-")));
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
  cpSync(servable, hostRoot, { recursive: true });
  mkdirSync(join(hostRoot, "node_modules", "@genii-foundation"), {
    recursive: true,
  });
  symlinkSync(
    nextPackageRoot,
    join(hostRoot, "node_modules", "@genii-foundation", "publisher-next"),
    "dir",
  );
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "the publication"]);
  return hostRoot;
}

function runSync(cwd, args) {
  const result = execFileSync(process.execPath, [executable, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return result;
}

test("the journal is created exclusively, so a second apply cannot race in", () => {
  // A timing test cannot be trusted here and I proved that on myself. My first
  // version of this file spawned two applies and asserted the good outcome; it
  // passed with the fix reverted, because two spawned processes do not reliably
  // overlap inside the test runner even though the same two race every time from a
  // shell. A test that cannot fail is worse than no test.
  //
  // So the guarantee is asserted where it lives. The journal must be created with
  // an exclusive open, because the existsSync check above it cannot see a second
  // apply that starts in the gap between the check and the write.
  const source = readFileSync(
    join(
      repositoryRoot,
      "packages",
      "publisher",
      "src",
      "node",
      "lifecycle",
      "transaction.ts",
    ),
    "utf8",
  );
  assert.match(
    source,
    /openSync\(path, "wx", 0o644\)/u,
    "the journal must be created exclusively, or two concurrent applies both proceed",
  );
  assert.match(
    source,
    /Another host transaction is already in progress/u,
    "and the loser must be told what happened rather than shown a filesystem error",
  );
  // The plain durable write must not be what creates the journal.
  const journalWrite = /writeFileDurably\(journalPath/u.test(source);
  assert.equal(
    journalWrite,
    false,
    "the journal is being written non-exclusively again",
  );
});

test("a second apply cannot damage a completed one", (t) => {
  // This replaces a test that spawned two applies at once and asserted the good
  // outcome. It caused two continuous integration failures: the first found a real
  // defect, the second was my own assertion allowing only one of two legitimate
  // refusals. Whether two spawned processes overlap is scheduling dependent, so it
  // could neither be relied on to catch the race nor trusted when it went red.
  //
  // Every property it reached for is asserted deterministically instead. The
  // exclusive journal create is checked in the source above. A journal left behind
  // blocking the next apply is the test below. Engine staged files not counting as
  // author work is in host-git-baseline. Recovery removing them is in
  // host-transaction.
  //
  // What is left is the invariant an author cares about, and it can be sequenced
  // rather than raced: applying twice must leave the host complete, and the second
  // attempt must refuse rather than write over the first.
  const hostRoot = host(t);
  const planned = runSync(hostRoot, ["init", "plan"]);
  const planHash = /^Plan\s+(sha256:[a-f0-9]{64})$/mu.exec(planned)?.[1];
  assert.ok(planHash, planned);

  const first = execFileSync(
    process.execPath,
    [executable, "init", "apply", "--plan", planHash],
    { cwd: hostRoot, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } },
  );
  assert.match(first, /file\(s\) written/u);
  const state = readFileSync(join(hostRoot, "publisher.host.json"), "utf8");

  // Deliberately not committed, which is the state the winner leaves and the state
  // the loser met on the loaded runner.
  const second = spawnSync(
    process.execPath,
    [executable, "init", "apply", "--plan", planHash],
    { cwd: hostRoot, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } },
  );
  assert.notEqual(second.status, 0, "a second apply must refuse");
  // The plan hash catches it before the Git gate does, which is the better order:
  // the plan computed against the original tree no longer describes this one, and
  // saying so names the actual problem rather than the tree being dirty.
  assert.match(second.stderr, /plan changed since it was reviewed/u);
  // Not a bare filesystem error, and not blaming the author for an engine file.
  // Those were the two real defects behind the removed test.
  assert.equal(/ENOENT/u.test(second.stderr), false, second.stderr);
  assert.equal(
    /publisher-staged/u.test(second.stderr),
    false,
    `the refusal named an engine staged file:\n${second.stderr}`,
  );

  // The completed host is untouched by the refusal.
  assert.equal(
    readFileSync(join(hostRoot, "publisher.host.json"), "utf8"),
    state,
  );
  assert.equal(
    existsSync(join(hostRoot, ".publisher", "transaction", "transaction.json")),
    false,
    "a journal survived a refused apply",
  );
});

test("a journal left by a crash blocks the next apply by name", (t) => {
  const hostRoot = host(t);
  const planned = runSync(hostRoot, ["init", "plan"]);
  const planHash = /^Plan\s+(sha256:[a-f0-9]{64})$/mu.exec(planned)?.[1];
  assert.ok(planHash);

  // Exactly what an interrupted apply leaves behind.
  mkdirSync(join(hostRoot, ".publisher", "transaction"), { recursive: true });
  writeFileSync(
    join(hostRoot, ".publisher", "transaction", "transaction.json"),
    '{"format":"stale"}\n',
    "utf8",
  );

  const attempted = spawnSync(
    process.execPath,
    [executable, "init", "apply", "--plan", planHash],
    { cwd: hostRoot, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } },
  );
  assert.notEqual(attempted.status, 0);
  assert.match(attempted.stderr, /did not finish/u);
  assert.match(attempted.stderr, /Recover it/u);
  assert.equal(existsSync(join(hostRoot, "publisher.host.json")), false);
});
