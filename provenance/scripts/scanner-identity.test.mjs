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
import {
  appendFileSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
} from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SCANNER_IDENTITY_ALGORITHM,
  SCANNER_IDENTITY_INPUT_PATHS,
  SCANNER_IDENTITY_MAX_FILES,
  createScannerIdentity,
} from "./scanner-identity.mjs";

const testRootPrefix = "publisher-scanner-identity-test-";
const repositoryRoot = realpathSync(
  join(dirname(fileURLToPath(import.meta.url)), "../.."),
);
const closurePackageNames = Object.freeze(
  [
    "b4a",
    "bare-events",
    "bare-fs",
    "bare-path",
    "bare-stream",
    "bare-url",
    "events-universal",
    "fast-fifo",
    "streamx",
    "tar-stream",
    "teex",
    "text-decoder",
  ].sort(),
);

function removeTestRoot(path) {
  const resolvedPath = realpathSync(path);
  if (
    dirname(resolvedPath) !== realpathSync(tmpdir()) ||
    !basename(resolvedPath).startsWith(testRootPrefix)
  ) {
    throw new Error(
      `Refusing to remove unexpected test root ${resolvedPath}.`,
    );
  }
  rmSync(resolvedPath, {
    force: true,
    recursive: true,
  });
}

function copiedRepository(t) {
  const sourceIdentity = createScannerIdentity({
    repositoryRoot,
  });
  const copiedRoot = mkdtempSync(
    join(realpathSync(tmpdir()), testRootPrefix),
  );
  t.after(() => {
    removeTestRoot(copiedRoot);
  });
  for (const entry of sourceIdentity.files) {
    const sourcePath = join(
      repositoryRoot,
      ...entry.path.split("/"),
    );
    const destinationPath = join(
      copiedRoot,
      ...entry.path.split("/"),
    );
    mkdirSync(dirname(destinationPath), {
      recursive: true,
    });
    copyFileSync(sourcePath, destinationPath);
  }
  const copiedIdentity = createScannerIdentity({
    repositoryRoot: copiedRoot,
  });
  assert.deepEqual(copiedIdentity, sourceIdentity);
  return Object.freeze({
    copiedIdentity,
    copiedRoot,
  });
}

function entryFor(identity, path) {
  const entry = identity.files.find(
    (candidate) => candidate.path === path,
  );
  assert.ok(entry, `Missing scanner identity entry ${path}.`);
  return entry;
}

test("scanner identity is deterministic and binds the exact runtime closure", () => {
  const first = createScannerIdentity({
    repositoryRoot,
  });
  const second = createScannerIdentity({
    repositoryRoot,
  });

  assert.deepEqual(second, first);
  assert.equal(
    first.algorithm,
    SCANNER_IDENTITY_ALGORITHM,
  );
  assert.match(first.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.fileCount, first.files.length);
  assert.ok(first.fileCount <= SCANNER_IDENTITY_MAX_FILES);
  assert.deepEqual(
    first.files.map((entry) => entry.path),
    first.files
      .map((entry) => entry.path)
      .toSorted(),
  );
  for (const path of SCANNER_IDENTITY_INPUT_PATHS) {
    entryFor(first, path);
  }

  const packageNames = first.files
    .filter(
      (entry) =>
        entry.path.startsWith("node_modules/") &&
        entry.path.endsWith("/package.json"),
    )
    .map((entry) => {
      const manifest = JSON.parse(
        readFileSync(
          join(repositoryRoot, ...entry.path.split("/")),
          "utf8",
        ),
      );
      return manifest.name;
    })
    .sort();
  assert.deepEqual(packageNames, closurePackageNames);
  assert.equal(
    JSON.parse(
      readFileSync(
        join(repositoryRoot, "node_modules/tar-stream/package.json"),
        "utf8",
      ),
    ).version,
    "3.2.0",
  );
});

test("same-version installed runtime tampering changes scanner identity", (t) => {
  const { copiedIdentity, copiedRoot } =
    copiedRepository(t);
  const targetPath = "node_modules/tar-stream/index.js";
  const absoluteTarget = join(
    copiedRoot,
    ...targetPath.split("/"),
  );
  const manifestPath = join(
    copiedRoot,
    "node_modules/tar-stream/package.json",
  );
  assert.equal(
    JSON.parse(readFileSync(manifestPath, "utf8")).version,
    "3.2.0",
  );
  appendFileSync(
    absoluteTarget,
    "\n// same-version byte tampering\n",
    "utf8",
  );

  const tamperedIdentity = createScannerIdentity({
    repositoryRoot: copiedRoot,
  });
  assert.notEqual(
    tamperedIdentity.sha256,
    copiedIdentity.sha256,
  );
  assert.notEqual(
    entryFor(tamperedIdentity, targetPath).sha256,
    entryFor(copiedIdentity, targetPath).sha256,
  );
  assert.equal(
    JSON.parse(readFileSync(manifestPath, "utf8")).version,
    "3.2.0",
  );
});

test("archive reader changes alter scanner identity", (t) => {
  const { copiedIdentity, copiedRoot } =
    copiedRepository(t);
  const targetPath =
    "provenance/scripts/archive-reader.mjs";
  appendFileSync(
    join(copiedRoot, ...targetPath.split("/")),
    "\n// scanner identity mutation proof\n",
    "utf8",
  );

  const changedIdentity = createScannerIdentity({
    repositoryRoot: copiedRoot,
  });
  assert.notEqual(
    changedIdentity.sha256,
    copiedIdentity.sha256,
  );
  assert.notEqual(
    entryFor(changedIdentity, targetPath).sha256,
    entryFor(copiedIdentity, targetPath).sha256,
  );
});

test("package lock integrity changes alter scanner identity", (t) => {
  const { copiedIdentity, copiedRoot } =
    copiedRepository(t);
  const lockPath = join(copiedRoot, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.packages["node_modules/tar-stream"].integrity =
    `sha512-${Buffer.alloc(64, 0xa5).toString("base64")}`;
  writeFileSync(
    lockPath,
    `${JSON.stringify(lock, null, 2)}\n`,
    "utf8",
  );

  const changedIdentity = createScannerIdentity({
    repositoryRoot: copiedRoot,
  });
  assert.notEqual(
    changedIdentity.sha256,
    copiedIdentity.sha256,
  );
  assert.notEqual(
    entryFor(changedIdentity, "package-lock.json").sha256,
    entryFor(copiedIdentity, "package-lock.json").sha256,
  );
});

test("scanner identity rejects incomplete registry lock evidence", async (t) => {
  await t.test("missing integrity", (nested) => {
    const { copiedRoot } = copiedRepository(nested);
    const lockPath = join(
      copiedRoot,
      "package-lock.json",
    );
    const lock = JSON.parse(
      readFileSync(lockPath, "utf8"),
    );
    delete lock.packages["node_modules/tar-stream"]
      .integrity;
    writeFileSync(
      lockPath,
      `${JSON.stringify(lock, null, 2)}\n`,
      "utf8",
    );

    assert.throws(
      () =>
        createScannerIdentity({
          repositoryRoot: copiedRoot,
        }),
      /has no registry integrity digest/u,
    );
  });

  await t.test("invalid resolved URL", (nested) => {
    const { copiedRoot } = copiedRepository(nested);
    const lockPath = join(
      copiedRoot,
      "package-lock.json",
    );
    const lock = JSON.parse(
      readFileSync(lockPath, "utf8"),
    );
    lock.packages[
      "node_modules/tar-stream"
    ].resolved =
      "https://packages.example.test/tar-stream-3.2.0.tgz";
    writeFileSync(
      lockPath,
      `${JSON.stringify(lock, null, 2)}\n`,
      "utf8",
    );

    assert.throws(
      () =>
        createScannerIdentity({
          repositoryRoot: copiedRoot,
        }),
      /invalid registry tarball URL/u,
    );
  });
});

test("scanner identity bounds directory enumeration before sorting", (t) => {
  const { copiedRoot } = copiedRepository(t);
  const packageRoot = join(
    copiedRoot,
    "node_modules/tar-stream",
  );
  for (let index = 0; index < 2049; index += 1) {
    writeFileSync(
      join(
        packageRoot,
        `overflow-${String(index).padStart(4, "0")}.txt`,
      ),
      "",
      "utf8",
    );
  }

  assert.throws(
    () =>
      createScannerIdentity({
        repositoryRoot: copiedRoot,
      }),
    /contains more than 2048 entries/u,
  );
});

test("scanner identity rejects symbolic links and hard links", async (t) => {
  await t.test("symbolic link", (nested) => {
    const { copiedRoot } = copiedRepository(nested);
    const targetPath = join(
      copiedRoot,
      "node_modules/tar-stream/index.js",
    );
    const replacement = join(
      copiedRoot,
      "symbolic-link-target.js",
    );
    copyFileSync(targetPath, replacement);
    unlinkSync(targetPath);
    symlinkSync(replacement, targetPath);

    assert.throws(
      () =>
        createScannerIdentity({
          repositoryRoot: copiedRoot,
        }),
      /matching installed package roots|not a regular file|symbolic link/u,
    );
  });

  await t.test("hard link", (nested) => {
    const { copiedRoot } = copiedRepository(nested);
    const targetPath = join(
      copiedRoot,
      "node_modules/tar-stream/index.js",
    );
    const replacement = join(
      copiedRoot,
      "hard-link-target.js",
    );
    copyFileSync(targetPath, replacement);
    unlinkSync(targetPath);
    linkSync(replacement, targetPath);

    assert.throws(
      () =>
        createScannerIdentity({
          repositoryRoot: copiedRoot,
        }),
      /must not be hard linked/u,
    );
  });
});

test("scanner identity rejects missing runtime entry files", (t) => {
  const { copiedRoot } = copiedRepository(t);
  unlinkSync(
    join(
      copiedRoot,
      "node_modules/tar-stream/index.js",
    ),
  );
  assert.throws(
    () =>
      createScannerIdentity({
        repositoryRoot: copiedRoot,
      }),
    /Cannot resolve scanner runtime dependency tar-stream/u,
  );
});

test("scanner identity rejects dependency cycles without recursing forever", (t) => {
  const { copiedRoot } = copiedRepository(t);
  const manifestPath = join(
    copiedRoot,
    "node_modules/tar-stream/package.json",
  );
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  );
  manifest.dependencies["tar-stream"] = "3.2.0";
  writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  assert.throws(
    () =>
      createScannerIdentity({
        repositoryRoot: copiedRoot,
      }),
    /dependency cycle/u,
  );
});
