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

// The whole author path, against the renderer that actually ships.
//
// Every other lifecycle test in this repository uses a stub renderer written
// inside the test. Those stubs turned out to be kinder than the real package in
// two ways that mattered, and both produced defects nothing caught. One exported
// "./host" as a bare string, so it resolved under any condition and hid that the
// executable could not resolve the real renderer at all. The other declared no
// capability set, so it hid that a publication could build and produce a host
// that would not boot.
//
// A stub is still the right tool for testing a third-party renderer and for
// forcing failures a real package will not perform on command. It is the wrong
// tool for answering "does this work". So this file answers that, once, with the
// real package, the real executable, a real Git repository, and a publication the
// renderer can actually serve.
//
// If this file passes and the stub-based files pass, the stubs are probably
// honest. If this file fails while they pass, the stubs are lying.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const executable = join(
  repositoryRoot,
  "packages",
  "publisher",
  "bin",
  "genii-publisher.mjs",
);
const nextPackageRoot = join(repositoryRoot, "packages", "next");

/** The only fixture publication the shipped renderer can serve. */
const servableFixture = join(
  repositoryRoot,
  "fixtures",
  "canonical-tide-tables",
);

const realRenderer = "@genii-foundation/publisher-next";

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

function run(cwd, args) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd,
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

/**
 * A host repository with the real renderer installed and a servable publication.
 *
 * The renderer is linked rather than packed. Packing is truer and the package
 * consumer suite already does it; here the point is the lifecycle rather than the
 * tarball, and linking keeps this file fast enough to run every time.
 */
function realHost(t, { publication = servableFixture } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "publisher-real-")));
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
  writeFileSync(
    join(hostRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "real-renderer-lifecycle-host",
        private: true,
        type: "module",
        scripts: {
          build: "next build",
          start: "next start",
        },
        dependencies: {
          [realRenderer]: "0.1.0-alpha.0",
        },
        devDependencies: {
          typescript: "7.0.2",
        },
        overrides: {
          postcss: "8.5.24",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  cpSync(publication, hostRoot, { recursive: true });
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

function planHashFrom(stdout) {
  const match = /^Plan\s+(sha256:[a-f0-9]{64})$/mu.exec(stdout);
  assert.ok(match, `expected a plan hash in:\n${stdout}`);
  return match[1];
}

function commitAll(hostRoot, message) {
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", message]);
}

// ------------------------------------------------------- the whole path

test("the real renderer takes a publication from nothing to a current artifact", (t) => {
  const hostRoot = realHost(t);

  // Not initialized yet.
  const before = run(hostRoot, ["status"]);
  assert.equal(before.status, 1);
  assert.match(before.stdout, /Not an initialized host/u);

  // Plan. No --renderer, so this also proves the default renderer resolves,
  // which it could not do at all before the resolver was replaced.
  const planned = run(hostRoot, ["init", "plan"]);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(
    planned.stdout,
    new RegExp(`Renderer\\s+${realRenderer.replace("/", "\\/")}`, "u"),
  );
  assert.match(planned.stdout, /Layout\s+canonical/u);
  // The real contract is substantial. A stub's two files would not have caught a
  // failure that only appears with a nested route directory.
  const writes = [...planned.stdout.matchAll(/^ {2}write {4}(\S+)$/gmu)].map(
    ([, path]) => path,
  );
  assert.ok(
    writes.length >= 10,
    `expected the real contract to write many files, got ${writes.length}`,
  );
  assert.ok(writes.includes("publisher.host.json"));
  assert.ok(
    writes.some((path) => path.includes("[...segments]")),
    `expected the catch-all route directory among ${writes.join(", ")}`,
  );

  // Apply.
  const applied = run(hostRoot, [
    "init",
    "apply",
    "--plan",
    planHashFrom(planned.stdout),
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Baseline commit [0-9a-f]{40}/u);
  for (const path of writes) {
    assert.ok(
      existsSync(join(hostRoot, ...path.split("/"))),
      `${path} was planned but not written`,
    );
  }
  commitAll(hostRoot, "initialize");

  // The recorded state names the real renderer, which every later command reads.
  const state = JSON.parse(
    readFileSync(join(hostRoot, "publisher.host.json"), "utf8"),
  );
  assert.equal(state.renderer, realRenderer);
  assert.equal(state.hostContractVersion, "0.10.0");
  const hostManifest = JSON.parse(
    readFileSync(join(hostRoot, "package.json"), "utf8"),
  );
  assert.equal(hostManifest.dependencies[realRenderer], "0.1.0-alpha.0");
  assert.equal(hostManifest.devDependencies.typescript, "7.0.2");
  assert.equal(hostManifest.overrides.postcss, "8.5.24");

  // Status now wants an artifact.
  const middle = run(hostRoot, ["status"]);
  assert.equal(middle.status, 1);
  assert.match(middle.stdout, /is missing/u);
  assert.match(middle.stdout, /build the reader artifact/u);

  // Build. Again no --renderer.
  const built = run(hostRoot, ["build"]);
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /^Written\.$/mu);

  // The artifact is where the generated host imports it from. This is the check
  // that the renderer-mismatch guard exists to protect, verified here against the
  // renderer's real declared path rather than a stub's.
  const artifactPath = /Artifact\s+(\S+)/u.exec(built.stdout)?.[1];
  assert.ok(artifactPath);
  assert.ok(existsSync(join(hostRoot, ...artifactPath.split("/"))));
  const importers = readdirSync(hostRoot).filter((name) =>
    name.endsWith(".mjs") || name.endsWith(".js"),
  );
  const imported = importers.some((name) =>
    readFileSync(join(hostRoot, name), "utf8").includes(artifactPath),
  );
  assert.ok(
    imported,
    `nothing in the host imports ${artifactPath}, which is the failure the recorded renderer exists to prevent`,
  );

  commitAll(hostRoot, "the artifact");

  // Everything done.
  const after = run(hostRoot, ["status"]);
  assert.equal(after.status, 0, after.stdout);
  assert.match(after.stdout, /^Nothing to do\.$/mu);
  assert.equal(run(hostRoot, ["build", "--check"]).status, 0);
});

test("the real renderer reports no upgrade when nothing has moved", (t) => {
  const hostRoot = realHost(t);
  const planned = run(hostRoot, ["init", "plan"]);
  assert.equal(
    run(hostRoot, ["init", "apply", "--plan", planHashFrom(planned.stdout)])
      .status,
    0,
  );
  commitAll(hostRoot, "initialize");

  const upgrade = run(hostRoot, ["upgrade", "plan"]);
  assert.equal(upgrade.status, 0, upgrade.stderr);
  assert.match(upgrade.stdout, /Already on the installed contract/u);
  // The real registry is empty, and an empty registry must not read as a missing
  // one. That distinction only exists because a stub could have either.
  assert.equal(upgrade.stderr.includes("migration registry"), false);
});

test("rolling back an initialization of the real contract removes all of it", (t) => {
  const hostRoot = realHost(t);
  const planned = run(hostRoot, ["init", "plan"]);
  const writes = [...planned.stdout.matchAll(/^ {2}write {4}(\S+)$/gmu)].map(
    ([, path]) => path,
  );
  assert.equal(
    run(hostRoot, ["init", "apply", "--plan", planHashFrom(planned.stdout)])
      .status,
    0,
  );
  commitAll(hostRoot, "initialize");

  // Something of the author's, untracked, that a broad checkout and clean would
  // have deleted.
  writeFileSync(join(hostRoot, "my-notes.txt"), "keep me\n", "utf8");

  const rollback = run(hostRoot, ["rollback", "plan"]);
  assert.equal(rollback.status, 0, rollback.stderr);
  const applied = run(hostRoot, [
    "rollback",
    "apply",
    "--plan",
    planHashFrom(rollback.stdout),
  ]);
  assert.equal(applied.status, 0, applied.stderr);

  for (const path of writes) {
    assert.equal(
      existsSync(join(hostRoot, ...path.split("/"))),
      false,
      `${path} survived the rollback`,
    );
  }
  assert.equal(readFileSync(join(hostRoot, "my-notes.txt"), "utf8"), "keep me\n");
  // The publication is untouched, because it is inside a declared source root.
  assert.ok(existsSync(join(hostRoot, "publication.json")));
  assert.ok(
    existsSync(
      join(hostRoot, "publication", "works", "first-light", "manuscript.md"),
    ),
  );
});

test("the real renderer serves a publication with materialized Updates", (t) => {
  const hostRoot = realHost(t, {
    publication: join(repositoryRoot, "fixtures", "canonical-field-notes"),
  });
  const planned = run(hostRoot, ["init", "plan"]);
  assert.equal(
    run(hostRoot, ["init", "apply", "--plan", planHashFrom(planned.stdout)])
      .status,
    0,
  );
  commitAll(hostRoot, "initialize");

  const built = run(hostRoot, ["build"]);
  assert.equal(built.status, 0, built.stderr);
  assert.ok(existsSync(join(hostRoot, "publication-reader.json")));
  assert.ok(existsSync(join(hostRoot, "publication-public-identity.json")));
  assert.ok(existsSync(join(hostRoot, "publication-updates.json")));
});

// ------------------------------------------- the stubs must match reality

/** What the engine reads out of a renderer's host module. */
const requiredHostExports = Object.freeze([
  "createPublisherNextHostTemplate",
  "PUBLISHER_NEXT_HOST_MIGRATIONS",
  "PUBLISHER_NEXT_HOST_CAPABILITIES",
]);

test("the real renderer provides everything the engine reads", async () => {
  const module = await import(
    join(nextPackageRoot, "dist", "host.js")
  );
  for (const name of requiredHostExports) {
    assert.ok(
      Object.hasOwn(module, name),
      `the engine reads ${name} and the shipped renderer does not export it`,
    );
  }
  assert.equal(typeof module.createPublisherNextHostTemplate, "function");
  assert.ok(Array.isArray(module.PUBLISHER_NEXT_HOST_MIGRATIONS));
  assert.ok(
    Array.isArray(module.PUBLISHER_NEXT_HOST_CAPABILITIES.routeKinds),
  );
});

test("the shared stub renderer provides everything the real one does", async (t) => {
  // The point of this file: a stub that offers less than the real package hides
  // defects, which is what happened twice. Comparing the surfaces keeps a stub
  // from silently falling behind when the engine starts reading something new.
  const { installRenderer } = await import("./author-host-fixture.mjs");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "publisher-stub-")));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  installRenderer(root, "@example/alpha");
  const stub = await import(
    join(root, "node_modules", "@example", "alpha", "host.js")
  );
  for (const name of requiredHostExports) {
    assert.ok(
      Object.hasOwn(stub, name),
      `the stub renderer omits ${name}, which the engine reads`,
    );
  }
});
