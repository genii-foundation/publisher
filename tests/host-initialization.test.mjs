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
  PUBLISHER_HOST_STATE_PATH,
  parsePublisherHostState,
} from "../packages/publisher/dist/node/lifecycle/host-state.js";
import {
  applyHostInitialization,
  planHostInitialization,
} from "../packages/publisher/dist/node/lifecycle/init.js";

const enginePackages = Object.freeze({
  "@genii-foundation/publisher": "0.1.0-alpha.0",
  "@genii-foundation/publisher-next": "0.1.0-alpha.0",
});

function template(overrides = {}) {
  return {
    contractVersion: "0.1.0",
    renderer: "@genii-foundation/publisher-next",
    rendererVersion: "0.1.0-alpha.0",
    files: [
      { path: "package.json", contents: '{"name":"host"}\n' },
      { path: "app/page.tsx", contents: "export default null;\n" },
      {
        path: "pages/_app.tsx",
        contents: "export default null;\n",
      },
    ],
    ...overrides,
  };
}

function workspace(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-host-init-")),
  );
  t.after(() => {
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

function snapshot(root) {
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

function plan(hostRoot, overrides = {}) {
  return planHostInitialization({
    hostRoot,
    template: template(),
    layout: "canonical",
    enginePackages,
    ...overrides,
  });
}

function apply(hostRoot, journalDirectory, computed) {
  return applyHostInitialization({
    hostRoot,
    journalDirectory,
    plan: computed,
    expectedPlanHash: computed.planHash,
  });
}

// ------------------------------------------------- clean canonical host

test("a clean canonical host is planned and then initialized", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);

  const computed = plan(hostRoot);
  assert.equal(computed.outcome, "initialize");
  assert.equal(computed.layout, "canonical");
  assert.match(computed.planHash, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(
    computed.mutations.map(({ path }) => path),
    [
      "app/page.tsx",
      "package.json",
      "pages/_app.tsx",
      PUBLISHER_HOST_STATE_PATH,
    ],
    "the state file is part of the mutation set, not a side effect",
  );
  assert.deepEqual(
    snapshot(hostRoot),
    {},
    "planning must not write anything",
  );

  const applied = apply(hostRoot, journalDirectory, computed);
  assert.equal(applied.outcome, "applied");
  assert.equal(applied.changed.length, 4);

  const state = parsePublisherHostState(
    readFileSync(join(hostRoot, PUBLISHER_HOST_STATE_PATH), "utf8"),
  );
  assert.equal(state.layout, "canonical");
  assert.equal(state.hostContractVersion, "0.1.0");
  assert.equal(state.renderer, "@genii-foundation/publisher-next");
  assert.deepEqual(
    state.managedFiles.map(({ path }) => path),
    ["app/page.tsx", "package.json", "pages/_app.tsx"],
    "the state records the renderer files, and does not list itself",
  );
  assert.equal(existsSync(journalDirectory), false);
});

// ----------------------------------------------------- adopted host

test("an established declared-layout repository is adopted without moving sources", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  // Pre-existing publication material, in a layout that predates the engine.
  mkdirSync(join(hostRoot, "editorial", "volumes"), {
    recursive: true,
  });
  writeFileSync(
    join(hostRoot, "editorial", "volumes", "one.md"),
    "# Volume One\n",
    "utf8",
  );
  writeFileSync(
    join(hostRoot, "publication.json"),
    '{"id":"probe"}\n',
    "utf8",
  );
  const before = snapshot(hostRoot);

  const computed = plan(hostRoot, {
    layout: "declared",
    protectedRoots: ["editorial"],
  });
  assert.equal(computed.outcome, "initialize");
  const applied = apply(hostRoot, journalDirectory, computed);
  assert.equal(applied.outcome, "applied");

  const after = snapshot(hostRoot);
  assert.equal(
    after["editorial/volumes/one.md"],
    before["editorial/volumes/one.md"],
    "adoption must not touch a manuscript",
  );
  assert.equal(
    after["publication.json"],
    before["publication.json"],
    "adoption must not rewrite the publication manifest",
  );
  assert.equal(
    parsePublisherHostState(
      readFileSync(join(hostRoot, PUBLISHER_HOST_STATE_PATH), "utf8"),
    ).layout,
    "declared",
  );
});

test("a contract that reaches into a declared root is refused before the tree is read", (t) => {
  const { hostRoot } = workspace(t);
  assert.throws(
    () =>
      plan(hostRoot, {
        protectedRoots: ["editorial"],
        template: template({
          files: [
            { path: "package.json", contents: "{}\n" },
            {
              path: "editorial/volumes/one.md",
              contents: "# Rewritten\n",
            },
          ],
        }),
      }),
    (error) => {
      assert.equal(error.name, "HostMutationPolicyError");
      assert.match(
        error.message,
        /editorial\/volumes\/one\.md: Refused because it is inside the declared root/u,
      );
      return true;
    },
  );
});

// ------------------------------------------------ already initialized

test("initializing an already initialized host reports alreadyInitialized and writes nothing", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  apply(hostRoot, journalDirectory, plan(hostRoot));
  const before = snapshot(hostRoot);

  const second = plan(hostRoot);
  assert.equal(second.outcome, "alreadyInitialized");
  assert.deepEqual(second.conflicts, []);

  const applied = apply(hostRoot, journalDirectory, second);
  assert.equal(applied.outcome, "alreadyApplied");
  assert.deepEqual(applied.changed, []);
  assert.deepEqual(snapshot(hostRoot), before);
});

test("a host initialized for another renderer is refused", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  apply(hostRoot, journalDirectory, plan(hostRoot));
  assert.throws(
    () =>
      plan(hostRoot, {
        template: template({ renderer: "@example/other-renderer" }),
      }),
    /already initialized for @genii-foundation\/publisher-next/u,
  );
});

// ------------------------------------------------------- conflicts

test("a locally modified managed file becomes a conflict rather than an overwrite", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  apply(hostRoot, journalDirectory, plan(hostRoot));
  writeFileSync(
    join(hostRoot, "app", "page.tsx"),
    "export default function Mine() { return null; }\n",
    "utf8",
  );
  const before = snapshot(hostRoot);

  const computed = plan(hostRoot);
  assert.equal(computed.outcome, "conflicted");
  assert.deepEqual(
    computed.conflicts.map(({ path }) => path),
    ["app/page.tsx"],
  );

  assert.throws(
    () => apply(hostRoot, journalDirectory, computed),
    /must be reviewed rather than overwritten/u,
  );
  assert.deepEqual(
    snapshot(hostRoot),
    before,
    "a refused apply must leave the author's edit intact",
  );
});

test("a file the author created where the contract expects nothing is a conflict", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  mkdirSync(join(hostRoot, "app"), { recursive: true });
  writeFileSync(
    join(hostRoot, "app", "page.tsx"),
    "the author got here first\n",
    "utf8",
  );
  const before = snapshot(hostRoot);

  const computed = plan(hostRoot);
  assert.equal(computed.outcome, "conflicted");
  assert.throws(
    () => apply(hostRoot, journalDirectory, computed),
    /must be reviewed rather than overwritten/u,
  );
  assert.deepEqual(snapshot(hostRoot), before);
});

// -------------------------------------------------------- plan binding

test("applying a plan whose hash was not the one reviewed is refused", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  const computed = plan(hostRoot);
  assert.throws(
    () =>
      applyHostInitialization({
        hostRoot,
        journalDirectory,
        plan: computed,
        expectedPlanHash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      }),
    /plan changed since it was reviewed/u,
  );
  assert.deepEqual(
    snapshot(hostRoot),
    {},
    "a refused apply writes nothing",
  );
});

test("the plan hash is stable across directories and changes with content", (t) => {
  const first = workspace(t);
  const second = workspace(t);
  assert.equal(
    plan(first.hostRoot).planHash,
    plan(second.hostRoot).planHash,
    "the same host must plan identically in two checkouts",
  );

  const changed = plan(first.hostRoot, {
    template: template({
      files: [
        { path: "package.json", contents: '{"name":"different"}\n' },
      ],
    }),
  });
  assert.notEqual(changed.planHash, plan(first.hostRoot).planHash);

  const relabelled = plan(first.hostRoot, { layout: "declared" });
  assert.notEqual(
    relabelled.planHash,
    plan(first.hostRoot).planHash,
    "the layout is part of what was reviewed",
  );
});

// -------------------------------------------------------- host state

test("the recorded state round trips and rejects tampering", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  apply(hostRoot, journalDirectory, plan(hostRoot));
  const statePath = join(hostRoot, PUBLISHER_HOST_STATE_PATH);
  const text = readFileSync(statePath, "utf8");
  const state = parsePublisherHostState(text);
  assert.equal(state.enginePackages["@genii-foundation/publisher"], "0.1.0-alpha.0");

  for (const [label, mutate] of [
    [
      "an unknown field",
      (value) => ({ ...value, surprise: true }),
    ],
    [
      "an unknown format",
      (value) => ({ ...value, format: "something-else" }),
    ],
    [
      "a floating version",
      (value) => ({ ...value, rendererVersion: "^0.1.0" }),
    ],
    [
      "an unsorted managed file list",
      (value) => ({
        ...value,
        managedFiles: [...value.managedFiles].reverse(),
      }),
    ],
    [
      "a malformed hash",
      (value) => ({
        ...value,
        managedFiles: value.managedFiles.map((file, index) =>
          index === 0 ? { ...file, sha256: "sha256:short" } : file,
        ),
      }),
    ],
    [
      "an unusable layout",
      (value) => ({ ...value, layout: "whatever" }),
    ],
  ]) {
    assert.throws(
      () =>
        parsePublisherHostState(
          JSON.stringify(mutate(JSON.parse(text)), null, 2),
        ),
      (error) => {
        assert.equal(error.name, "PublisherHostStateError");
        return true;
      },
      `expected ${label} to be refused`,
    );
  }
});

test("a host whose state file is unreadable is refused rather than reinitialized", (t) => {
  const { hostRoot } = workspace(t);
  writeFileSync(
    join(hostRoot, PUBLISHER_HOST_STATE_PATH),
    "{ not json\n",
    "utf8",
  );
  assert.throws(
    () => plan(hostRoot),
    /is not valid JSON/u,
  );
});

// --------------------------------------------------------- hostile paths

test("a contract declaring a hostile path is refused", (t) => {
  const { hostRoot } = workspace(t);
  for (const path of [
    "../escape.tsx",
    "/absolute.tsx",
    "app/../../escape.tsx",
    "app//page.tsx",
    "trailing.",
    "back\\slash.tsx",
    ".git/config",
    ".env",
    "node_modules/next/index.js",
    "publisher.config.ts",
  ]) {
    assert.throws(
      () =>
        plan(hostRoot, {
          template: template({
            files: [{ path, contents: "x\n" }],
          }),
        }),
      (error) => {
        assert.equal(
          error.name,
          "HostMutationPolicyError",
          `${path} must be refused by the policy`,
        );
        return true;
      },
      `expected ${path} to be refused`,
    );
  }
});

test("a symbolic link in the host tree is refused rather than followed", (t) => {
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
  assert.throws(
    () => plan(hostRoot),
    /traverses a symbolic link/u,
  );
  assert.equal(
    readdirSync(outside).length,
    0,
    "nothing may be written through the link",
  );
});

test("a non-ASCII managed path is carried through unchanged", (t) => {
  const { hostRoot, journalDirectory } = workspace(t);
  // The host contract is engine-authored, but nothing in the transaction depends
  // on ASCII, so a renderer that names a file this way still works.
  const computed = plan(hostRoot, {
    template: template({
      files: [
        { path: "package.json", contents: "{}\n" },
        { path: "app/café/page.tsx", contents: "export default null;\n" },
      ],
    }),
  });
  assert.equal(computed.outcome, "initialize");
  apply(hostRoot, journalDirectory, computed);
  assert.equal(
    readFileSync(
      join(hostRoot, "app", "café", "page.tsx"),
      "utf8",
    ),
    "export default null;\n",
  );
});

test("an empty contract is refused", (t) => {
  const { hostRoot } = workspace(t);
  assert.throws(
    () => plan(hostRoot, { template: template({ files: [] }) }),
    /declares no files/u,
  );
});
