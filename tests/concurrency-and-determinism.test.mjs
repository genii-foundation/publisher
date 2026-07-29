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
import { execFileSync, spawn } from "node:child_process";
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
  "canonical-field-notes":
    "6a7dcd825ae631ce7f86d69360e374ee",
  "declared-night-dispatch":
    "3f2f621289fbb26231edf4d78562ff5d",
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

/** Starts the executable without waiting, so two can genuinely overlap. */
function start(cwd, args) {
  const child = spawn(process.execPath, [executable, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolve) => {
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
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

test("two applies at once never leave the host half done", async (t) => {
  const hostRoot = host(t);
  const planned = runSync(hostRoot, ["init", "plan"]);
  const planHash = /^Plan\s+(sha256:[a-f0-9]{64})$/mu.exec(planned)?.[1];
  assert.ok(planHash, planned);

  const [first, second] = await Promise.all([
    start(hostRoot, ["init", "apply", "--plan", planHash]),
    start(hostRoot, ["init", "apply", "--plan", planHash]),
  ]);
  const both = [first, second];
  const output = both.map((r) => r.stdout + r.stderr).join("\n");

  // This is a smoke test, not a proof. Whether the two processes actually overlap
  // depends on scheduling, so it cannot be relied on to catch the race. What it
  // does check is that running two applies together never leaves a broken host,
  // whatever the interleaving turns out to be.
  assert.ok(
    existsSync(join(hostRoot, "publisher.host.json")),
    `neither apply completed:\n${output}`,
  );
  assert.equal(
    both.filter((r) => r.status === 0).length >= 1,
    true,
    `expected at least one apply to succeed:\n${output}`,
  );

  // And no raw filesystem error reaches the author. These are what the race used
  // to produce, and they name internal staged paths that mean nothing to anyone.
  assert.equal(
    /ENOENT/u.test(output),
    false,
    `a raw filesystem error escaped:\n${output}`,
  );
  assert.equal(
    /publisher-staged/u.test(output),
    false,
    `an internal staged path escaped:\n${output}`,
  );

  // Whichever lost, if one did, was told what happened rather than shown a stack.
  const loser = both.find((r) => r.status !== 0);
  if (loser !== undefined) {
    assert.match(
      loser.stderr,
      /Another host transaction is already in progress|did not finish/u,
      `the refused apply must explain itself:\n${loser.stderr}`,
    );
  }

  // The tree holds exactly one coherent host state.
  const state = JSON.parse(
    readFileSync(join(hostRoot, "publisher.host.json"), "utf8"),
  );
  assert.equal(state.renderer, "@genii-foundation/publisher-next");
  assert.ok(state.managedFiles.length > 0);

  // Nothing is left over in the journal directory either way.
  assert.equal(
    existsSync(join(hostRoot, ".publisher", "transaction", "transaction.json")),
    false,
    "a journal survived a finished apply",
  );
});

test("a journal left by a crash blocks the next apply by name", async (t) => {
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

  const attempted = await start(hostRoot, [
    "init",
    "apply",
    "--plan",
    planHash,
  ]);
  assert.notEqual(attempted.status, 0);
  assert.match(attempted.stderr, /did not finish/u);
  assert.match(attempted.stderr, /Recover it/u);
  assert.equal(existsSync(join(hostRoot, "publisher.host.json")), false);
});
