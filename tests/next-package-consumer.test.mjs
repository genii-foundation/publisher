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
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertReleaseTag,
  expectedReleaseTag,
} from "../packages/next/scripts/check-release-tag.mjs";

const npmExecPath = process.env.npm_execpath;
if (npmExecPath === undefined || npmExecPath.length === 0) {
  throw new Error(
    "The Next package consumer test must run through the exact npm CLI.",
  );
}

const repositoryRoot = fileURLToPath(
  new URL("../", import.meta.url),
);
const nextRoot = join(repositoryRoot, "packages", "next");
const releaseTagScriptPath = join(
  nextRoot,
  "scripts",
  "check-release-tag.mjs",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 30 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${options.label ?? basename(command)} exited with status ${result.status ?? "unknown"}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

function runNpm(args, options = {}) {
  return run(process.execPath, [npmExecPath, ...args], {
    ...options,
    label: options.label ?? `npm ${args[0] ?? ""}`.trim(),
  });
}

function runReleaseTagCheck(tag) {
  const environment = { ...process.env };
  delete environment.npm_config_tag;
  if (tag !== undefined) {
    environment.npm_config_tag = tag;
  }
  return spawnSync(process.execPath, [releaseTagScriptPath], {
    cwd: nextRoot,
    encoding: "utf8",
    env: environment,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function packagePath(value) {
  return value.split(sep).join("/");
}

async function listFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, {
      withFileTypes: true,
    });
    entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      } else {
        throw new Error(`Unexpected package entry: ${entryPath}`);
      }
    }
  }

  await visit(root);
  return files;
}

async function expectedPackedPaths() {
  const recursiveRoots = [
    "dist",
    "src",
    "third-party-licenses",
  ];
  const recursiveFiles = (
    await Promise.all(
      recursiveRoots.map(async (root) =>
        (await listFiles(join(nextRoot, root))).map((filePath) =>
          packagePath(relative(nextRoot, filePath)),
        ),
      ),
    )
  ).flat();
  return [
    "CHANGES.md",
    "LEGAL",
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "SOURCE-NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "application-manifest.schema.json",
    "package.json",
    "scripts/build.mjs",
    "scripts/check-release-tag.mjs",
    "styles.css",
    "tsconfig.json",
    ...recursiveFiles,
  ].sort();
}

async function removeOwnedTemporaryRoot(targetPath) {
  const realTempRoot = await realpath(tmpdir());
  const realTarget = await realpath(targetPath);
  if (
    dirname(realTarget) !== realTempRoot ||
    !basename(realTarget).startsWith(
      "genii-publisher-next-consumer-",
    )
  ) {
    throw new Error(
      `Refusing to remove unexpected path: ${realTarget}`,
    );
  }
  await rm(realTarget, {
    force: true,
    recursive: true,
  });
}

test("Next release lifecycle enforces prerelease and stable npm tags", async () => {
  const manifest = JSON.parse(
    await readFile(join(nextRoot, "package.json"), "utf8"),
  );
  assert.equal(
    manifest.scripts.prepublishOnly,
    "node ./scripts/check-release-tag.mjs",
  );
  assert.equal(expectedReleaseTag("1.0.0-alpha.1"), "next");
  assert.equal(expectedReleaseTag("1.0.0"), "latest");
  assert.throws(
    () => assertReleaseTag("not-a-version", "next"),
    /not valid SemVer/,
  );
  assert.doesNotThrow(() => assertReleaseTag("1.0.0", undefined));
  assert.doesNotThrow(() => assertReleaseTag("1.0.0", "latest"));
  assert.throws(
    () => assertReleaseTag("1.0.0", "next"),
    /--tag latest/,
  );

  const acceptedTag = runReleaseTagCheck("next");
  assert.equal(acceptedTag.status, 0, acceptedTag.stderr);
  for (const rejectedTag of [undefined, "latest", "beta"]) {
    const result = runReleaseTagCheck(rejectedTag);
    assert.notEqual(
      result.status,
      0,
      `Tag ${rejectedTag ?? "(absent)"} should be rejected.`,
    );
    assert.match(result.stderr, /--tag next/);
  }
});

test("Next package metadata pins one verified renderer stack", async () => {
  const [workspaceManifest, workspaceLock, nextManifest] =
    await Promise.all([
      readFile(join(repositoryRoot, "package.json"), "utf8").then(
        JSON.parse,
      ),
      readFile(join(repositoryRoot, "package-lock.json"), "utf8").then(
        JSON.parse,
      ),
      readFile(join(nextRoot, "package.json"), "utf8").then(JSON.parse),
    ]);
  assert.equal(
    runNpm(["--version"], { label: "npm version check" }),
    workspaceManifest.engines.npm,
  );
  assert.equal(
    nextManifest.engines.node,
    workspaceManifest.engines.node,
  );
  assert.equal(nextManifest.publishConfig.access, "public");
  assert.equal(nextManifest.publishConfig.provenance, true);
  assert.equal(Object.hasOwn(nextManifest.publishConfig, "tag"), false);
  assert.deepEqual(nextManifest.peerDependencies, {
    next: "16.2.12",
    react: "19.2.8",
    "react-dom": "19.2.8",
  });
  assert.deepEqual(
    workspaceManifest.overrides,
    nextManifest.publisherHostOverrides,
  );
  for (const [packageName, version] of Object.entries({
    ...nextManifest.dependencies,
    ...nextManifest.devDependencies,
    ...nextManifest.peerDependencies,
  })) {
    const installed = workspaceLock.packages[
      `node_modules/${packageName}`
    ];
    if (packageName.startsWith("@genii-foundation/")) {
      assert.equal(version, "0.1.0-alpha.0", packageName);
    } else {
      assert.equal(installed?.version, version, packageName);
    }
  }
  assert.deepEqual(nextManifest.exports["./server"], {
    types: "./dist/server/index.d.ts",
    import: "./dist/server/index.js",
  });
  assert.deepEqual(nextManifest.exports["./client"], {
    types: "./dist/client/index.d.ts",
    import: "./dist/client/index.js",
  });
  assert.deepEqual(nextManifest.exports["./config"], {
    types: "./dist/config.d.ts",
    import: "./dist/config.js",
  });
  assert.deepEqual(nextManifest.exports["./theme/default"], {
    types: "./dist/theme/default.d.ts",
    import: "./dist/theme/default.js",
  });
  assert.equal(
    nextManifest.exports["./styles.css"],
    "./styles.css",
  );
  assert.equal(
    nextManifest.exports["./application-manifest.schema.json"],
    "./application-manifest.schema.json",
  );
});

test("packed Next source rebuilds to byte-identical distribution files", async () => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "genii-publisher-next-consumer-"),
  );
  try {
    const packRoot = join(temporaryRoot, "pack");
    const rebuildRoot = join(temporaryRoot, "rebuild");
    await Promise.all([
      mkdir(packRoot),
      mkdir(rebuildRoot),
    ]);
    const packResult = JSON.parse(
      runNpm(
        [
          "pack",
          "--silent",
          "--json",
          "--pack-destination",
          packRoot,
          nextRoot,
        ],
        {
          cwd: packRoot,
          label: "packed Next renderer with lifecycle",
        },
      ),
    )[0];
    assert.ok(packResult);
    assert.deepEqual(
      packResult.files.map(({ path }) => path).sort(),
      await expectedPackedPaths(),
    );
    assert.equal(
      packResult.files.some(
        ({ path }) => path === "scripts/packaged-host-proof.mjs",
      ),
      false,
    );

    const tarball = join(packRoot, packResult.filename);
    run("tar", ["-xzf", tarball, "-C", rebuildRoot], {
      cwd: temporaryRoot,
      label: "packed Next source extraction",
    });
    const extractedRoot = join(rebuildRoot, "package");
    const shippedDist = new Map(
      await Promise.all(
        (await listFiles(join(extractedRoot, "dist"))).map(
          async (filePath) => [
            packagePath(
              relative(join(extractedRoot, "dist"), filePath),
            ),
            await readFile(filePath),
          ],
        ),
      ),
    );
    await symlink(
      join(repositoryRoot, "node_modules"),
      join(extractedRoot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    runNpm(["run", "build"], {
      cwd: extractedRoot,
      label: "packed Next source rebuild",
    });
    const rebuiltPaths = (
      await listFiles(join(extractedRoot, "dist"))
    )
      .map((filePath) =>
        packagePath(
          relative(join(extractedRoot, "dist"), filePath),
        ),
      )
      .sort();
    assert.deepEqual(rebuiltPaths, [...shippedDist.keys()].sort());
    for (const distPath of rebuiltPaths) {
      assert.deepEqual(
        await readFile(join(extractedRoot, "dist", distPath)),
        shippedDist.get(distPath),
        `Packed rebuild changed dist/${distPath}.`,
      );
    }
  } finally {
    await removeOwnedTemporaryRoot(temporaryRoot);
  }
});
