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
import test from "node:test";

import {
  resolveHostContractMigrationPath,
  validateHostContractMigrations,
} from "../packages/publisher/dist/node/lifecycle/migrations.js";

function edge(from, to, extra = {}) {
  return { from, to, summary: `${from} to ${to}`, ...extra };
}

const chain = Object.freeze([
  edge("0.1.0", "0.2.0"),
  edge("0.2.0", "0.3.0"),
  edge("0.3.0", "1.0.0"),
]);

// ------------------------------------------------------------ validation

test("a single unbroken chain validates and is returned in order", () => {
  const edges = validateHostContractMigrations({
    targetVersion: "1.0.0",
    // Declared out of order on purpose: chain order is derived, not trusted.
    edges: [chain[2], chain[0], chain[1]],
  });
  assert.deepEqual(
    edges.map(({ from, to }) => `${from}->${to}`),
    ["0.1.0->0.2.0", "0.2.0->0.3.0", "0.3.0->1.0.0"],
  );
});

test("an empty registry is valid and means no upgrade is possible", () => {
  assert.deepEqual(
    validateHostContractMigrations({
      targetVersion: "1.0.0",
      edges: [],
    }),
    [],
  );
});

test("a fork is refused, because it means the renderer has not decided", () => {
  assert.throws(
    () =>
      validateHostContractMigrations({
        targetVersion: "1.0.0",
        edges: [
          edge("0.1.0", "0.2.0"),
          edge("0.1.0", "0.3.0"),
          edge("0.3.0", "1.0.0"),
        ],
      }),
    /declares two edges out of 0\.1\.0/u,
  );
});

test("two edges into one version are refused", () => {
  assert.throws(
    () =>
      validateHostContractMigrations({
        targetVersion: "1.0.0",
        edges: [
          edge("0.1.0", "1.0.0"),
          edge("0.2.0", "1.0.0"),
        ],
      }),
    /declares two edges into 1\.0\.0/u,
  );
});

test("a registry that never reaches the target is refused", () => {
  assert.throws(
    () =>
      validateHostContractMigrations({
        targetVersion: "1.0.0",
        edges: [edge("0.1.0", "0.2.0")],
      }),
    /none arrives at the target version 1\.0\.0/u,
  );
});

test("an edge stranded off the chain is refused rather than ignored", () => {
  // A shortcut edge is exactly this shape: it exists, it looks helpful, and it
  // is not on the path anybody tests.
  assert.throws(
    () =>
      validateHostContractMigrations({
        targetVersion: "1.0.0",
        edges: [...chain, edge("0.9.0", "0.9.1")],
      }),
    /not on the chain ending at 1\.0\.0: 0\.9\.0 to 0\.9\.1/u,
  );
});

test("a cycle is refused", () => {
  assert.throws(
    () =>
      validateHostContractMigrations({
        targetVersion: "1.0.0",
        edges: [
          edge("0.1.0", "0.2.0"),
          edge("0.2.0", "0.1.0"),
          edge("0.2.0", "1.0.0"),
        ],
      }),
    /declares two edges out of 0\.2\.0|cycles through/u,
  );
});

test("a malformed edge is refused with the field named", () => {
  const cases = [
    [{ from: "0.1.0", to: "0.1.0", summary: "x" }, /starts and ends at 0\.1\.0/u],
    [{ from: "0.1.0", to: "1.0.0" }, /must carry a nonempty summary/u],
    [
      { from: "0.1.0", to: "1.0.0", summary: "   " },
      /must carry a nonempty summary/u,
    ],
    [{ from: "^0.1.0", to: "1.0.0", summary: "x" }, /must be an exact contract version/u],
    [{ from: "0.1.0", to: "latest", summary: "x" }, /must be an exact contract version/u],
    [null, /must be an object/u],
    [
      { from: "0.1.0", to: "1.0.0", summary: "x", manualSteps: "nope" },
      /manualSteps that are not an array/u,
    ],
    [
      { from: "0.1.0", to: "1.0.0", summary: "x", manualSteps: [""] },
      /declares an empty manual step/u,
    ],
  ];
  for (const [candidate, pattern] of cases) {
    assert.throws(
      () =>
        validateHostContractMigrations({
          targetVersion: "1.0.0",
          edges: [candidate],
        }),
      pattern,
      `expected ${JSON.stringify(candidate)} to be refused`,
    );
  }
});

test("a target version that is not exact is refused", () => {
  assert.throws(
    () =>
      validateHostContractMigrations({
        targetVersion: "^1.0.0",
        edges: [],
      }),
    /targetVersion must be an exact contract version/u,
  );
});

// ------------------------------------------------------- path resolution

test("a path walks every intermediate edge in order", () => {
  const path = resolveHostContractMigrationPath({
    fromVersion: "0.1.0",
    targetVersion: "1.0.0",
    edges: chain,
  });
  assert.deepEqual(
    path.edges.map(({ from, to }) => `${from}->${to}`),
    ["0.1.0->0.2.0", "0.2.0->0.3.0", "0.3.0->1.0.0"],
    "a host two versions behind traverses both edges rather than jumping",
  );
  assert.equal(path.from, "0.1.0");
  assert.equal(path.to, "1.0.0");
});

test("a path starting midway skips only the edges already behind it", () => {
  const path = resolveHostContractMigrationPath({
    fromVersion: "0.3.0",
    targetVersion: "1.0.0",
    edges: chain,
  });
  assert.deepEqual(
    path.edges.map(({ from, to }) => `${from}->${to}`),
    ["0.3.0->1.0.0"],
  );
});

test("a host already on the target needs no edges", () => {
  const path = resolveHostContractMigrationPath({
    fromVersion: "1.0.0",
    targetVersion: "1.0.0",
    edges: chain,
  });
  assert.deepEqual(path.edges, []);
  assert.deepEqual(path.manualSteps, []);
});

test("a version the target never knew about is refused", () => {
  assert.throws(
    () =>
      resolveHostContractMigrationPath({
        fromVersion: "0.0.9",
        targetVersion: "1.0.0",
        edges: chain,
      }),
    (error) => {
      assert.equal(error.name, "HostContractMigrationError");
      assert.match(
        error.message,
        /No migration path from contract 0\.0\.9 to 1\.0\.0/u,
      );
      // The refusal names what the target does know, so an author can tell
      // whether they are behind the chain or ahead of it.
      assert.match(error.message, /0\.1\.0, 0\.2\.0, 0\.3\.0, 1\.0\.0/u);
      return true;
    },
  );
});

test("a host ahead of the target is refused rather than downgraded", () => {
  // Replaying edges backwards is not a downgrade. An edge says what changed, not
  // how to undo it, so going back is a rollback to a recorded commit instead.
  assert.throws(
    () =>
      resolveHostContractMigrationPath({
        fromVersion: "1.0.0",
        targetVersion: "0.2.0",
        edges: [chain[0]],
      }),
    /No migration path from contract 1\.0\.0 to 0\.2\.0/u,
  );
});

test("an empty registry cannot move a host at all", () => {
  assert.throws(
    () =>
      resolveHostContractMigrationPath({
        fromVersion: "0.1.0",
        targetVersion: "1.0.0",
        edges: [],
      }),
    /No migration path from contract 0\.1\.0 to 1\.0\.0/u,
  );
});

// ---------------------------------------------------------- manual steps

test("manual steps accumulate across every traversed edge in order", () => {
  const path = resolveHostContractMigrationPath({
    fromVersion: "0.1.0",
    targetVersion: "1.0.0",
    edges: [
      edge("0.1.0", "0.2.0", {
        manualSteps: ["Rotate the provider key."],
      }),
      edge("0.2.0", "0.3.0"),
      edge("0.3.0", "1.0.0", {
        manualSteps: [
          "Run the database migration.",
          "Confirm the preview deployment.",
        ],
      }),
    ],
  });
  assert.deepEqual(path.manualSteps, [
    "Rotate the provider key.",
    "Run the database migration.",
    "Confirm the preview deployment.",
  ]);
});

test("manual steps behind a host are not reported to it", () => {
  const path = resolveHostContractMigrationPath({
    fromVersion: "0.3.0",
    targetVersion: "1.0.0",
    edges: [
      edge("0.1.0", "0.2.0", {
        manualSteps: ["Already done long ago."],
      }),
      edge("0.2.0", "0.3.0"),
      edge("0.3.0", "1.0.0", {
        manualSteps: ["Still to do."],
      }),
    ],
  });
  assert.deepEqual(
    path.manualSteps,
    ["Still to do."],
    "a host does not inherit gates from versions it already passed",
  );
});

test("a resolved path and its edges are frozen", () => {
  const path = resolveHostContractMigrationPath({
    fromVersion: "0.1.0",
    targetVersion: "1.0.0",
    edges: chain,
  });
  assert.ok(Object.isFrozen(path));
  assert.ok(Object.isFrozen(path.edges));
  assert.ok(Object.isFrozen(path.manualSteps));
  for (const item of path.edges) {
    assert.ok(Object.isFrozen(item));
  }
});
