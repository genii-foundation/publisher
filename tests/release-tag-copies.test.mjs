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

// The five copies of the release tag guard must stay one thing.
//
// Each publishable package carries its own copy, because a published package
// cannot reach into the workspace for a script its own prepublish hook runs. That
// duplication is deliberate. What is not deliberate is drift: a fix applied to one
// copy and not the others is silent, and a consumer installing one package gets a
// different rule from the next.
//
// This file existed the moment I found five identical files with nothing asserting
// that they were identical. Byte equality is the whole claim.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const scriptName = join("scripts", "check-release-tag.mjs");

/**
 * Every publishable workspace root that carries the guard.
 *
 * Discovered rather than listed, so a new package cannot be added with its own
 * divergent copy and go unnoticed.
 */
function copies() {
  const roots = [
    "schemas",
    ...readdirSync(join(repositoryRoot, "packages"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join("packages", entry.name)),
  ];
  return roots
    .filter((root) => existsSync(join(repositoryRoot, root, scriptName)))
    .map((root) => ({
      root,
      path: join(repositoryRoot, root, scriptName),
      text: readFileSync(join(repositoryRoot, root, scriptName), "utf8"),
    }));
}

const found = copies();

test("every publishable package that can publish carries the guard", () => {
  const publishable = [
    "schemas",
    ...readdirSync(join(repositoryRoot, "packages"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join("packages", entry.name)),
  ].filter((root) => {
    const manifestPath = join(repositoryRoot, root, "package.json");
    if (!existsSync(manifestPath)) {
      return false;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return manifest.private !== true;
  });

  for (const root of publishable) {
    assert.ok(
      found.some((copy) => copy.root === root),
      `${root} is publishable but carries no ${scriptName}`,
    );
  }
  // Guarding the guard. If discovery finds nothing, byte equality below is
  // vacuously true across an empty set.
  assert.ok(
    found.length >= 4,
    `expected several copies, found ${found.length}`,
  );
});

test("all copies of the release tag guard are byte identical", () => {
  const digests = new Map();
  for (const copy of found) {
    const digest = createHash("sha256").update(copy.text, "utf8").digest("hex");
    const existing = digests.get(digest);
    digests.set(digest, existing === undefined ? [copy.root] : [...existing, copy.root]);
  }
  assert.equal(
    digests.size,
    1,
    `the guard has drifted into ${digests.size} versions:\n${[...digests.entries()]
      .map(([digest, roots]) => `  ${digest.slice(0, 12)}  ${roots.join(", ")}`)
      .join("\n")}`,
  );
});

test("the guard names the source of the tag rather than assuming one", () => {
  // The defect this parameter fixes: one message named npm_config_tag for all
  // three callers, so two thirds of the time it told an operator to set an
  // environment variable that has no effect on the command they had just run.
  const [first] = found;
  assert.ok(first);
  assert.match(
    first.text,
    /tagSource = "npm_config_tag"/u,
    "the source must default to the environment variable for lifecycle hooks",
  );
  assert.match(
    first.text,
    /\$\{tagSource\} did not supply a release tag/u,
    "and the message must name whichever source the caller passed",
  );
  // The remedy must state the requirement rather than prescribe an argument. The
  // first version of this fix named the right source and then told an operator
  // verifying a manifest to pass --tag, which is not a thing that command takes.
  assert.equal(
    first.text.includes("Pass --tag"),
    false,
    "the message must not instruct passing an argument the caller may not accept",
  );
});

test("every caller passes the source it actually reads", () => {
  const callers = [
    {
      path: join(repositoryRoot, "provenance", "scripts", "prepare-release.mjs"),
      reads: "options.tag",
      names: '"the --tag argument"',
    },
    {
      path: join(repositoryRoot, "provenance", "scripts", "verify-release.mjs"),
      reads: "manifest.tag",
      names: '"the release manifest tag field"',
    },
  ];
  for (const caller of callers) {
    const text = readFileSync(caller.path, "utf8");
    assert.ok(
      text.includes(caller.reads),
      `${caller.path} no longer reads ${caller.reads}`,
    );
    assert.ok(
      text.includes(caller.names),
      `${caller.path} reads ${caller.reads} but does not tell the guard so, which is how the message went wrong`,
    );
  }
});
