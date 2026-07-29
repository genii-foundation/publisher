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

// The host remembers its renderer, and that record is authority.
//
// This exists because of a demonstrated failure. A host initialized with one
// renderer, built with another, wrote the artifact at the second renderer's
// declared path, printed "Written.", and exited zero. The host's own generated
// code went on importing the first renderer's path, which did not exist. A green
// build and a broken site, with the failure surfacing later and somewhere else.
//
// The first test in this file is that scenario.

import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  authorHost,
  git,
  installRenderer,
  runPublisher as run,
} from "./author-host-fixture.mjs";

// ------------------------------------------------------- the regression

test("building through a renderer the host did not record is refused", (t) => {
  const { hostRoot } = authorHost(t, {
    renderers: ["@example/alpha", "@example/beta"],
  });

  const built = run(hostRoot, ["build", "--renderer", "@example/beta"]);
  assert.equal(built.status, 1, `must not report success:\n${built.stdout}`);
  assert.match(built.stderr, /initialized with @example\/alpha/u);
  assert.match(built.stderr, /you asked for @example\/beta/u);
  // The author has to be told what the consequence is, or the refusal reads as
  // bookkeeping rather than as the thing that saved them.
  assert.match(built.stderr, /reports success/u);

  assert.equal(
    existsSync(join(hostRoot, "beta-reader.json")),
    false,
    "the wrong renderer's artifact must not exist",
  );
  assert.equal(
    existsSync(join(hostRoot, "alpha-reader.json")),
    false,
    "and the refusal must not have written the right one either",
  );
});

test("the recorded renderer is used when none is asked for", (t) => {
  const { hostRoot } = authorHost(t, {
    renderers: ["@example/alpha", "@example/beta"],
  });

  // No flag. The default is the Next package, which is not installed here, so a
  // pass proves the host's own record was used rather than the default.
  const built = run(hostRoot, ["build"]);
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /Artifact\s+alpha-reader\.json/u);

  // The artifact is where the host's generated code imports from. That is the
  // whole point.
  const generated = readFileSync(join(hostRoot, "alpha-app.js"), "utf8");
  assert.match(generated, /\.\/alpha-reader\.json/u);
  assert.ok(existsSync(join(hostRoot, "alpha-reader.json")));
});

test("naming the recorded renderer explicitly is accepted", (t) => {
  const { hostRoot } = authorHost(t);
  const built = run(hostRoot, ["build", "--renderer", "@example/alpha"]);
  assert.equal(built.status, 0, built.stderr);
});

test("upgrade also refuses a renderer the host did not record", (t) => {
  const { hostRoot } = authorHost(t, {
    renderers: ["@example/alpha", "@example/beta"],
  });
  const planned = run(hostRoot, [
    "upgrade",
    "plan",
    "--renderer",
    "@example/beta",
  ]);
  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /initialized with @example\/alpha/u);
});

test("building an uninitialized host is refused with what to do next", (t) => {
  const { hostRoot } = authorHost(t, { initialize: false });
  const built = run(hostRoot, ["build", "--renderer", "@example/alpha"]);
  assert.equal(built.status, 1);
  assert.match(built.stderr, /not an initialized host/u);
  assert.match(built.stderr, /genii-publisher init plan/u);
  // Nothing reads a reader artifact in an uninitialized host, so writing one
  // would only leave a file to be puzzled over later.
  assert.equal(existsSync(join(hostRoot, "alpha-reader.json")), false);
});

test("an unusable state file is refused rather than read as uninitialized", (t) => {
  const { hostRoot } = authorHost(t);
  writeFileSync(join(hostRoot, "publisher.host.json"), "{ not json\n", "utf8");

  const built = run(hostRoot, ["build"]);
  assert.equal(built.status, 1);
  assert.match(built.stderr, /not a usable host state file/u);
  // Treating it as uninitialized would let a corrupted host be initialized over
  // the top of itself, losing the record of what it was.
  assert.match(built.stderr, /Restore it from version control/u);
});

// ---------------------------------------------------------------- status

test("status on a healthy host reports nothing to do and exits zero", (t) => {
  const { hostRoot } = authorHost(t);
  assert.equal(run(hostRoot, ["build"]).status, 0);
  // Healthy means the artifact has been dealt with. An uncommitted one is a
  // pending decision, which status reports as an action of its own.
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "the artifact"]);

  const status = run(hostRoot, ["status"]);
  assert.equal(status.status, 0, status.stdout);
  assert.match(status.stdout, /Renderer\s+@example\/alpha/u);
  assert.match(status.stdout, /recorded 0\.1\.0, installed 0\.1\.0/u);
  assert.match(status.stdout, /alpha-reader\.json is current/u);
  assert.match(status.stdout, /^Nothing to do\.$/mu);
});

test("status reports a stale artifact as an action and exits nonzero", (t) => {
  const { hostRoot } = authorHost(t);
  assert.equal(run(hostRoot, ["build"]).status, 0);
  writeFileSync(
    join(hostRoot, "alpha-reader.json"),
    '{"stale":true}\n',
    "utf8",
  );

  const status = run(hostRoot, ["status"]);
  assert.equal(status.status, 1);
  assert.match(status.stdout, /is stale/u);
  assert.match(status.stdout, /build the reader artifact/u);
});

test("status reports an available upgrade", (t) => {
  const { hostRoot } = authorHost(t);
  installRenderer(hostRoot, "@example/alpha", {
    contractVersion: "0.2.0",
    version: "2.0.0",
  });

  const status = run(hostRoot, ["status"]);
  assert.equal(status.status, 1);
  assert.match(status.stdout, /recorded 0\.1\.0, installed 0\.2\.0/u);
  assert.match(status.stdout, /upgrade available/u);
  assert.match(status.stdout, /upgrade to the installed host contract/u);
});

test("status reports a managed file that no longer matches", (t) => {
  const { hostRoot } = authorHost(t);
  writeFileSync(
    join(hostRoot, "alpha-app.js"),
    "// edited by hand\n",
    "utf8",
  );

  const status = run(hostRoot, ["status"]);
  assert.equal(status.status, 1);
  assert.match(status.stdout, /modified\s+alpha-app\.js/u);
  assert.match(status.stdout, /no longer match/u);
});

test("status on an uninitialized host says so and exits nonzero", (t) => {
  const { hostRoot } = authorHost(t, { initialize: false });
  const status = run(hostRoot, ["status"]);
  assert.equal(status.status, 1);
  assert.match(status.stdout, /Not an initialized host/u);
  assert.match(status.stdout, /initialize this host/u);
});

test("status reports a renderer the host records but cannot resolve", (t) => {
  const { hostRoot } = authorHost(t);
  rmSync(join(hostRoot, "node_modules", "@example", "alpha"), {
    recursive: true,
    force: true,
  });

  const status = run(hostRoot, ["status"]);
  assert.equal(status.status, 1);
  assert.match(status.stdout, /not resolvable/u);
  assert.match(status.stdout, /install @example\/alpha/u);
});

test("status writes nothing", (t) => {
  const { hostRoot } = authorHost(t);
  const before = git(hostRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  assert.equal(run(hostRoot, ["status"]).status, 1, "no artifact yet");
  assert.equal(
    git(hostRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
    before,
    "status must not change the tree",
  );
});

test("status emits machine readable output on request", (t) => {
  const { hostRoot } = authorHost(t);
  assert.equal(run(hostRoot, ["build"]).status, 0);
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "the artifact"]);

  const status = run(hostRoot, ["status", "--json"]);
  assert.equal(status.status, 0, status.stdout);
  const report = JSON.parse(status.stdout);
  assert.equal(report.initialized, true);
  assert.equal(report.renderer, "@example/alpha");
  assert.equal(report.upgradeAvailable, false);
  assert.deepEqual(report.conflictedFiles, []);
  assert.deepEqual(report.actions, []);
  assert.equal(report.artifact.outcome, "current");
  assert.equal(report.artifactTracking, "tracked");
});

// ------------------------------------------------- artifact tracking

test("status names an artifact that is neither committed nor ignored", (t) => {
  const { hostRoot } = authorHost(t);
  assert.equal(run(hostRoot, ["build"]).status, 0);

  // The state every fresh host lands in. Both upgrade and rollback need a clean
  // tree, and this artifact makes the tree dirty forever, so they would refuse
  // with a complaint about a file the engine itself wrote.
  const status = run(hostRoot, ["status"]);
  assert.equal(status.status, 1);
  assert.match(status.stdout, /neither committed nor ignored/u);
  assert.match(
    status.stdout,
    /decide whether alpha-reader\.json is committed or ignored/u,
  );
  assert.match(status.stdout, /upgrade and rollback need a clean tree/u);

  // And the refusal it predicts is real, not hypothetical.
  const planned = run(hostRoot, ["upgrade", "plan"]);
  assert.equal(planned.status, 0, "planning still works, it writes nothing");
  installRenderer(hostRoot, "@example/alpha", {
    contractVersion: "0.2.0",
    version: "2.0.0",
    migrations: [{ from: "0.1.0", to: "0.2.0", summary: "moves on" }],
  });
  const replanned = run(hostRoot, ["upgrade", "plan"]);
  const hash = /Plan\s+(sha256:[a-f0-9]{64})/u.exec(replanned.stdout)?.[1];
  assert.ok(hash);
  const applied = run(hostRoot, ["upgrade", "apply", "--plan", hash]);
  assert.equal(applied.status, 1);
  assert.match(applied.stderr, /requires a clean Git tree/u);
  assert.match(applied.stderr, /alpha-reader\.json/u);
});

test("committing the artifact clears the tracking action", (t) => {
  const { hostRoot } = authorHost(t);
  assert.equal(run(hostRoot, ["build"]).status, 0);
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "the artifact"]);

  const status = run(hostRoot, ["status"]);
  assert.equal(status.status, 0, status.stdout);
  assert.equal(status.stdout.includes("neither committed nor ignored"), false);
  assert.match(status.stdout, /^Nothing to do\.$/mu);
});

test("ignoring the artifact also clears the tracking action", (t) => {
  const { hostRoot } = authorHost(t);
  writeFileSync(
    join(hostRoot, ".gitignore"),
    "node_modules/\n.publisher/\nalpha-reader.json\n",
    "utf8",
  );
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "ignore the artifact"]);
  assert.equal(run(hostRoot, ["build"]).status, 0);

  const status = run(hostRoot, ["status"]);
  assert.equal(status.status, 0, status.stdout);
  assert.match(status.stdout, /\(ignored by Git\)/u);
  assert.match(status.stdout, /^Nothing to do\.$/mu);

  // Ignored means the tree stays clean, so an upgrade is not blocked.
  installRenderer(hostRoot, "@example/alpha", {
    contractVersion: "0.2.0",
    version: "2.0.0",
    migrations: [{ from: "0.1.0", to: "0.2.0", summary: "moves on" }],
  });
  const planned = run(hostRoot, ["upgrade", "plan"]);
  const hash = /Plan\s+(sha256:[a-f0-9]{64})/u.exec(planned.stdout)?.[1];
  assert.ok(hash);
  const applied = run(hostRoot, ["upgrade", "apply", "--plan", hash]);
  assert.equal(applied.status, 0, applied.stderr);
});
