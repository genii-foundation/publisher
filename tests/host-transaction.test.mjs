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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HOST_TRANSACTION_JOURNAL_FORMAT,
  applyHostMutations,
  classifyHostMutations,
  hashHostFileContents,
  recoverHostTransaction,
} from "../packages/publisher/dist/node/lifecycle/transaction.js";

function workspace(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-host-transaction-")),
  );
  t.after(() => {
    // Permissions are relaxed first, because a test that locks a directory to
    // force a failure would otherwise make its own cleanup fail.
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        try {
          chmodSync(join(root, entry.name), 0o700);
        } catch {
          // Already removable.
        }
      }
    }
    rmSync(root, { recursive: true, force: true });
  });
  const hostRoot = join(root, "host");
  mkdirSync(hostRoot);
  return {
    root,
    hostRoot,
    journalDirectory: join(root, "journal"),
  };
}

function mutation(path, contents, expected = null) {
  return { path, contents, expected };
}

function treeSnapshot(root) {
  const files = {};
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, {
      withFileTypes: true,
    })) {
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
// does not enforce it, in which case the caller skips rather than asserting on
// behaviour the platform does not have.
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

// ------------------------------------------------------------ happy paths

test("a clean mutation set is applied and creates missing directories", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  const result = applyHostMutations({
    root: hostRoot,
    journalDirectory,
    mutations: [
      mutation("app/page.tsx", "export default null;\n"),
      mutation("package.json", '{"name":"host"}\n'),
      mutation("pages/nested/deep/_app.tsx", "export default null;\n"),
    ],
  });

  assert.equal(result.outcome, "applied");
  assert.deepEqual(
    [...result.changed].sort(),
    ["app/page.tsx", "package.json", "pages/nested/deep/_app.tsx"],
  );
  assert.equal(
    readFileSync(join(hostRoot, "app", "page.tsx"), "utf8"),
    "export default null;\n",
  );
  assert.equal(
    readFileSync(
      join(hostRoot, "pages", "nested", "deep", "_app.tsx"),
      "utf8",
    ),
    "export default null;\n",
  );
  // The journal exists only for the duration of the transaction.
  assert.equal(existsSync(journalDirectory), false);
  // No staging file survives.
  assert.deepEqual(
    Object.keys(treeSnapshot(hostRoot)).filter((path) =>
      path.includes("publisher-staged"),
    ),
    [],
  );
});

test("reapplying the same mutation set reports alreadyApplied and writes nothing", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  const mutations = [
    mutation("package.json", '{"name":"host"}\n'),
    mutation("app/page.tsx", "export default null;\n"),
  ];
  applyHostMutations({ root: hostRoot, journalDirectory, mutations });
  const before = treeSnapshot(hostRoot);

  const second = applyHostMutations({
    root: hostRoot,
    journalDirectory,
    mutations,
  });

  assert.equal(second.outcome, "alreadyApplied");
  assert.deepEqual(second.changed, []);
  assert.deepEqual(treeSnapshot(hostRoot), before);
});

test("an update from a known preimage is applied", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  writeFileSync(join(hostRoot, "package.json"), "old\n", "utf8");
  const result = applyHostMutations({
    root: hostRoot,
    journalDirectory,
    mutations: [
      mutation(
        "package.json",
        "new\n",
        hashHostFileContents("old\n"),
      ),
    ],
  });
  assert.equal(result.outcome, "applied");
  assert.equal(
    readFileSync(join(hostRoot, "package.json"), "utf8"),
    "new\n",
  );
});

// --------------------------------------------------------------- conflicts

test("a locally modified file becomes a conflict rather than an overwrite", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  writeFileSync(
    join(hostRoot, "package.json"),
    "the author edited this\n",
    "utf8",
  );
  const before = treeSnapshot(hostRoot);

  assert.throws(
    () =>
      applyHostMutations({
        root: hostRoot,
        journalDirectory,
        mutations: [
          mutation(
            "package.json",
            "renderer content\n",
            hashHostFileContents("what the renderer last wrote\n"),
          ),
        ],
      }),
    (error) => {
      assert.match(error.message, /must be reviewed rather than overwritten/u);
      assert.equal(error.conflicts.length, 1);
      assert.equal(error.conflicts[0].path, "package.json");
      assert.equal(error.conflicts[0].state, "conflicted");
      return true;
    },
  );
  assert.deepEqual(
    treeSnapshot(hostRoot),
    before,
    "a refused transaction must not change anything",
  );
});

test("a tree where some files already hold the intended result is completed", (t) => {
  // Every upgrade is this shape: most host files are unchanged between contract
  // versions, so a legitimate change is always a mix of applied and pending.
  //
  // An earlier version refused a mix, reasoning that a half-applied tree meant
  // guessing at intent. It does not. Every pending file carries the exact
  // preimage it must have, every applied file already holds the exact intended
  // bytes, and anything matching neither is a conflict and is refused. Completing
  // the remainder reaches precisely the intended end state.
  const { hostRoot, journalDirectory } = workspace(t);
  const mutations = [
    mutation("a.txt", "a\n"),
    mutation("b.txt", "b\n"),
  ];
  writeFileSync(join(hostRoot, "a.txt"), "a\n", "utf8");

  const result = applyHostMutations({
    root: hostRoot,
    journalDirectory,
    mutations,
  });

  assert.equal(result.outcome, "applied");
  assert.deepEqual(
    result.classifications.map(({ path, state }) => [path, state]),
    [
      ["a.txt", "applied"],
      ["b.txt", "pending"],
    ],
  );
  assert.equal(readFileSync(join(hostRoot, "a.txt"), "utf8"), "a\n");
  assert.equal(readFileSync(join(hostRoot, "b.txt"), "utf8"), "b\n");
});

test("a conflict inside an otherwise partly applied tree is still refused", (t) => {
  // Completing a mix must not become a way to walk past a conflict.
  const { hostRoot, journalDirectory } = workspace(t);
  writeFileSync(join(hostRoot, "a.txt"), "a\n", "utf8");
  writeFileSync(join(hostRoot, "c.txt"), "the author wrote this\n", "utf8");
  const before = treeSnapshot(hostRoot);

  assert.throws(
    () =>
      applyHostMutations({
        root: hostRoot,
        journalDirectory,
        mutations: [
          mutation("a.txt", "a\n"),
          mutation("b.txt", "b\n"),
          mutation(
            "c.txt",
            "engine content\n",
            hashHostFileContents("what the engine last wrote\n"),
          ),
        ],
      }),
    /must be reviewed rather than overwritten/u,
  );
  assert.deepEqual(treeSnapshot(hostRoot), before);
});

test("a mutation set that writes beneath one of its own files is refused", (t) => {
  const { hostRoot } = workspace(t);
  assert.throws(
    () =>
      classifyHostMutations(hostRoot, [
        mutation("a/b", "file\n"),
        mutation("a/b/c", "nested\n"),
      ]),
    /beneath the file "a\/b"/u,
  );
});

test("a duplicated mutation path is refused", (t) => {
  const { hostRoot } = workspace(t);
  assert.throws(
    () =>
      classifyHostMutations(hostRoot, [
        mutation("a.txt", "one\n"),
        mutation("a.txt", "two\n"),
      ]),
    /declares "a\.txt" twice/u,
  );
});

// ------------------------------------------------------------- removals

test("a removal deletes a file whose content matches what the engine wrote", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  writeFileSync(join(hostRoot, "dropped.txt"), "engine wrote this\n", "utf8");

  const result = applyHostMutations({
    root: hostRoot,
    journalDirectory,
    mutations: [
      {
        path: "dropped.txt",
        contents: null,
        expected: hashHostFileContents("engine wrote this\n"),
      },
    ],
  });

  assert.equal(result.outcome, "applied");
  assert.deepEqual(result.changed, ["dropped.txt"]);
  assert.equal(existsSync(join(hostRoot, "dropped.txt")), false);
  assert.equal(existsSync(journalDirectory), false);
});

test("a removal of an already absent file reports alreadyApplied", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  const result = applyHostMutations({
    root: hostRoot,
    journalDirectory,
    mutations: [
      { path: "never-existed.txt", contents: null, expected: null },
    ],
  });
  assert.equal(result.outcome, "alreadyApplied");
  assert.deepEqual(result.changed, []);
});

test("a removal of a locally modified file is a conflict, not a deletion", (t) => {
  // The case that matters most: an author edited a file the contract dropped.
  // Deleting it would destroy work that a diff would never show them.
  const { hostRoot, journalDirectory } = workspace(t);
  writeFileSync(
    join(hostRoot, "dropped.txt"),
    "the author changed this\n",
    "utf8",
  );
  const before = treeSnapshot(hostRoot);

  assert.throws(
    () =>
      applyHostMutations({
        root: hostRoot,
        journalDirectory,
        mutations: [
          {
            path: "dropped.txt",
            contents: null,
            expected: hashHostFileContents("engine wrote this\n"),
          },
        ],
      }),
    (error) => {
      assert.match(error.message, /must be reviewed rather than overwritten/u);
      assert.equal(error.conflicts[0].path, "dropped.txt");
      assert.equal(error.conflicts[0].intended, null);
      return true;
    },
  );
  assert.deepEqual(
    treeSnapshot(hostRoot),
    before,
    "the author's file must survive a refused removal",
  );
});

test("a failure after a removal restores the removed file", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  writeFileSync(join(hostRoot, "a-dropped.txt"), "original\n", "utf8");
  const locked = join(hostRoot, "locked");
  mkdirSync(locked);
  if (!lockDirectory(t, locked)) {
    t.skip("This platform does not enforce directory write permissions.");
    return;
  }
  const before = treeSnapshot(hostRoot);

  assert.throws(() =>
    applyHostMutations({
      root: hostRoot,
      journalDirectory,
      mutations: [
        // Sorted first, so the removal happens before the failure.
        {
          path: "a-dropped.txt",
          contents: null,
          expected: hashHostFileContents("original\n"),
        },
        { path: "locked/blocked.txt", contents: "never\n", expected: null },
      ],
    }),
  );

  assert.deepEqual(
    treeSnapshot(hostRoot),
    before,
    "a removed file must come back byte for byte",
  );
  assert.equal(
    readFileSync(join(hostRoot, "a-dropped.txt"), "utf8"),
    "original\n",
  );
});

test("a removal and a write in one set are both applied or neither is", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  writeFileSync(join(hostRoot, "old.txt"), "old\n", "utf8");
  const result = applyHostMutations({
    root: hostRoot,
    journalDirectory,
    mutations: [
      { path: "new.txt", contents: "new\n", expected: null },
      {
        path: "old.txt",
        contents: null,
        expected: hashHostFileContents("old\n"),
      },
    ],
  });
  assert.equal(result.outcome, "applied");
  assert.equal(existsSync(join(hostRoot, "old.txt")), false);
  assert.equal(readFileSync(join(hostRoot, "new.txt"), "utf8"), "new\n");
});

test("a removal leaves an emptied directory in place", (t) => {
  // The transaction did not create it and an author may be keeping it, so
  // removing it would be destroying something this change never made.
  const { hostRoot, journalDirectory } = workspace(t);
  mkdirSync(join(hostRoot, "kept"), { recursive: true });
  writeFileSync(join(hostRoot, "kept", "only.txt"), "only\n", "utf8");
  applyHostMutations({
    root: hostRoot,
    journalDirectory,
    mutations: [
      {
        path: "kept/only.txt",
        contents: null,
        expected: hashHostFileContents("only\n"),
      },
    ],
  });
  assert.equal(existsSync(join(hostRoot, "kept", "only.txt")), false);
  assert.equal(
    existsSync(join(hostRoot, "kept")),
    true,
    "an emptied directory is not this transaction's to remove",
  );
});

test("classification reports a removal without writing", (t) => {
  const { hostRoot } = workspace(t);
  writeFileSync(join(hostRoot, "present.txt"), "engine\n", "utf8");
  const before = treeSnapshot(hostRoot);
  const classifications = classifyHostMutations(hostRoot, [
    {
      path: "present.txt",
      contents: null,
      expected: hashHostFileContents("engine\n"),
    },
    { path: "absent.txt", contents: null, expected: null },
  ]);
  assert.deepEqual(
    classifications.map(({ path, state, intended }) => [
      path,
      state,
      intended,
    ]),
    [
      ["absent.txt", "applied", null],
      ["present.txt", "pending", null],
    ],
  );
  assert.deepEqual(treeSnapshot(hostRoot), before);
});

// ------------------------------------------------------------ path safety

test("unsafe mutation paths are refused", (t) => {
  const { hostRoot } = workspace(t);
  for (const [label, path] of [
    ["absolute", "/etc/passwd"],
    ["parent traversal", "../escape.txt"],
    ["embedded traversal", "app/../../escape.txt"],
    ["empty segment", "app//page.tsx"],
    ["dot segment", "app/./page.tsx"],
    ["backslash", "app\\page.tsx"],
    ["trailing dot", "app/page."],
    ["trailing space", "app/page "],
    ["empty", ""],
  ]) {
    assert.throws(
      () => classifyHostMutations(hostRoot, [mutation(path, "x\n")]),
      /not a relative POSIX path|unusable segment|escapes the host root/u,
      `expected ${label} to be refused`,
    );
  }
});

test("a symbolic link anywhere in the path is refused", (t) => {
  const { root, hostRoot } = workspace(t);
  const outside = join(root, "outside");
  mkdirSync(outside);

  let linked = false;
  try {
    symlinkSync(outside, join(hostRoot, "app"), "dir");
    linked = true;
  } catch (error) {
    t.skip(`Symbolic links are unavailable (${error.code}).`);
  }
  if (!linked) {
    return;
  }

  // The final component is a normal name; the escape is the linked ancestor,
  // which is why checking only the target would not be enough.
  assert.throws(
    () =>
      classifyHostMutations(hostRoot, [
        mutation("app/page.tsx", "x\n"),
      ]),
    /traverses a symbolic link/u,
  );
  assert.equal(
    readdirSync(outside).length,
    0,
    "nothing may be written through the link",
  );
});

test("a mutation target that is a directory is refused", (t) => {
  const { hostRoot } = workspace(t);
  mkdirSync(join(hostRoot, "app"));
  assert.throws(
    () => classifyHostMutations(hostRoot, [mutation("app", "x\n")]),
    /not a regular file/u,
  );
});

test("a non canonical or missing host root is refused", (t) => {
  const { root, hostRoot } = workspace(t);
  assert.throws(
    () => classifyHostMutations("relative/path", []),
    /must be an absolute path/u,
  );
  assert.throws(
    () => classifyHostMutations(join(root, "missing"), []),
    /does not exist/u,
  );
  let linked = false;
  try {
    symlinkSync(hostRoot, join(root, "linked-host"), "dir");
    linked = true;
  } catch (error) {
    t.skip(`Symbolic links are unavailable (${error.code}).`);
  }
  if (linked) {
    assert.throws(
      () => classifyHostMutations(join(root, "linked-host"), []),
      /must already be canonical/u,
    );
  }
});

// ------------------------------------------------- failure and recovery

test("a failure partway through restores every file it had already written", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  // Pre-existing content that the transaction updates, so rollback has to
  // restore bytes rather than merely delete.
  writeFileSync(join(hostRoot, "a-first.txt"), "original\n", "utf8");
  const locked = join(hostRoot, "locked");
  mkdirSync(locked);
  if (!lockDirectory(t, locked)) {
    t.skip("This platform does not enforce directory write permissions.");
    return;
  }
  const before = treeSnapshot(hostRoot);

  assert.throws(() =>
    applyHostMutations({
      root: hostRoot,
      journalDirectory,
      mutations: [
        // Sorted order puts these first, so both are written before the failure.
        mutation(
          "a-first.txt",
          "updated\n",
          hashHostFileContents("original\n"),
        ),
        mutation("b-created.txt", "created\n"),
        mutation("created/nested.txt", "nested\n"),
        // Fails: the directory is not writable.
        mutation("locked/blocked.txt", "never\n"),
      ],
    }),
  );

  assert.deepEqual(
    treeSnapshot(hostRoot),
    before,
    "every written file must be restored byte for byte",
  );
  assert.equal(
    readFileSync(join(hostRoot, "a-first.txt"), "utf8"),
    "original\n",
  );
  assert.equal(existsSync(join(hostRoot, "b-created.txt")), false);
  assert.equal(
    existsSync(join(hostRoot, "created")),
    false,
    "a directory this transaction created must be removed again",
  );
  assert.equal(
    existsSync(journalDirectory),
    false,
    "a rolled back transaction leaves no journal",
  );
});

test("a journal left by a crashed run blocks the next apply until it is recovered", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  mkdirSync(journalDirectory, { recursive: true });
  mkdirSync(join(journalDirectory, "backups"), { recursive: true });
  writeFileSync(
    join(journalDirectory, "backups", "0000-package.json"),
    "baseline\n",
  );
  writeFileSync(
    join(journalDirectory, "transaction.json"),
    `${JSON.stringify({
      format: HOST_TRANSACTION_JOURNAL_FORMAT,
      root: hostRoot,
      entries: [
        {
          path: "package.json",
          priorHash: hashHostFileContents("baseline\n"),
          backup: "0000-package.json",
          intended: hashHostFileContents("half written\n"),
        },
        {
          path: "created/new.txt",
          priorHash: null,
          backup: null,
          intended: hashHostFileContents("new\n"),
        },
      ],
      createdDirectories: [join(hostRoot, "created")],
    })}\n`,
  );
  // The state a crash would have left behind.
  writeFileSync(
    join(hostRoot, "package.json"),
    "half written\n",
    "utf8",
  );
  mkdirSync(join(hostRoot, "created"));
  writeFileSync(join(hostRoot, "created", "new.txt"), "new\n", "utf8");

  assert.throws(
    () =>
      applyHostMutations({
        root: hostRoot,
        journalDirectory,
        mutations: [mutation("other.txt", "x\n")],
      }),
    /did not finish\. Recover it before applying another/u,
  );

  const recovery = recoverHostTransaction({ journalDirectory });
  assert.equal(recovery.recovered, true);
  assert.deepEqual(
    [...recovery.restored].sort(),
    ["created/new.txt", "package.json"],
  );
  assert.equal(
    readFileSync(join(hostRoot, "package.json"), "utf8"),
    "baseline\n",
    "recovery restores the baseline bytes",
  );
  assert.equal(
    existsSync(join(hostRoot, "created", "new.txt")),
    false,
  );
  assert.equal(existsSync(join(hostRoot, "created")), false);
  assert.equal(existsSync(journalDirectory), false);

  // Recovery does not then apply anything, so a following apply starts from the
  // restored baseline and succeeds.
  const applied = applyHostMutations({
    root: hostRoot,
    journalDirectory,
    mutations: [mutation("other.txt", "x\n")],
  });
  assert.equal(applied.outcome, "applied");
});

test("recovery is a no-op when no journal exists", (t) => {
  const { journalDirectory } = workspace(t);
  const result = recoverHostTransaction({ journalDirectory });
  assert.equal(result.recovered, false);
  assert.deepEqual(result.restored, []);
});

test("a journal in an unrecognized format is refused rather than guessed at", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  mkdirSync(journalDirectory, { recursive: true });
  writeFileSync(
    join(journalDirectory, "transaction.json"),
    `${JSON.stringify({
      format: "something-else-1",
      root: hostRoot,
      entries: [],
      createdDirectories: [],
    })}\n`,
  );
  assert.throws(
    () => recoverHostTransaction({ journalDirectory }),
    /unrecognized format/u,
  );
});

// ------------------------------------------------------------ classification

test("classification reports state without writing anything", (t) => {
  const { hostRoot } = workspace(t);
  writeFileSync(join(hostRoot, "applied.txt"), "done\n", "utf8");
  writeFileSync(join(hostRoot, "conflicted.txt"), "edited\n", "utf8");
  const before = treeSnapshot(hostRoot);

  const classifications = classifyHostMutations(hostRoot, [
    mutation("pending.txt", "will be written\n"),
    mutation("applied.txt", "done\n"),
    mutation(
      "conflicted.txt",
      "renderer\n",
      hashHostFileContents("previous renderer\n"),
    ),
  ]);

  assert.deepEqual(
    classifications.map(({ path, state }) => [path, state]),
    [
      ["applied.txt", "applied"],
      ["conflicted.txt", "conflicted"],
      ["pending.txt", "pending"],
    ],
    "classification is reported in sorted path order",
  );
  assert.deepEqual(
    treeSnapshot(hostRoot),
    before,
    "classification must not write",
  );
});
