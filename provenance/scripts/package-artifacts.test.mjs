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
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  readPackageArchive,
} from "./archive-reader.mjs";
import {
  inspectPackageArchive,
  preparePackageArchives,
  resolveExactNpmInvocation,
  verifyPreparedPackageArchives,
} from "./package-artifacts.mjs";
import {
  createReleaseManifest,
} from "./prepare-release.mjs";
import {
  readPreparedArchives,
} from "./verify-release.mjs";

const testRootPrefix = "publisher-package-artifacts-test-";
const realRepositoryRoot = realpathSync(
  join(dirname(fileURLToPath(import.meta.url)), "../.."),
);
const exactNpmExecPath = process.env.npm_execpath;
if (
  exactNpmExecPath === undefined ||
  exactNpmExecPath.length === 0
) {
  throw new Error(
    "Package artifact tests must run through the exact npm CLI.",
  );
}

function writeJson(path, value) {
  writeFileSync(
    path,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function runGit(repositoryRoot, arguments_) {
  return execFileSync(
    "git",
    ["-C", repositoryRoot, ...arguments_],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

function removeOwnedTestRoot(path) {
  if (!existsSync(path)) {
    return;
  }
  const resolved = realpathSync(path);
  if (
    dirname(resolved) !== realpathSync(tmpdir()) ||
    !basename(resolved).startsWith(testRootPrefix)
  ) {
    throw new Error(`Refusing to remove unexpected test path ${resolved}.`);
  }
  rmSync(resolved, {
    force: true,
    recursive: true,
  });
}

function packageLock({
  packages,
  rootManifest,
}) {
  const entries = {
    "": {
      engines: rootManifest.engines,
      name: rootManifest.name,
      version: rootManifest.version,
      workspaces: rootManifest.workspaces,
    },
  };
  for (const packageRecord of packages) {
    const root = packageRecord.root.slice(0, -1);
    entries[`node_modules/${packageRecord.manifest.name}`] = {
      link: true,
      resolved: root,
    };
    entries[root] = {
      dependencies: packageRecord.manifest.dependencies,
      name: packageRecord.manifest.name,
      version: packageRecord.manifest.version,
    };
    if (entries[root].dependencies === undefined) {
      delete entries[root].dependencies;
    }
  }
  return {
    lockfileVersion: 3,
    name: rootManifest.name,
    packages: entries,
    requires: true,
    version: rootManifest.version,
  };
}

function createFixture({
  failing = false,
  includeDependency = true,
} = {}) {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), testRootPrefix),
  );
  const repositoryRoot = join(temporaryRoot, "repository");
  const outputDirectory = join(temporaryRoot, "output");
  mkdirSync(repositoryRoot);
  mkdirSync(outputDirectory);
  const rootManifest = {
    engines: {
      npm: "10.9.0",
    },
    name: "package-artifact-test-workspace",
    packageManager: "npm@10.9.0",
    private: true,
    type: "module",
    version: "0.0.0",
    workspaces: ["packages/*"],
  };
  const base = {
    root: "packages/base/",
    manifest: {
      files: ["dist", "package.json", "src"],
      name: "@genii-foundation/z-package-artifact-base",
      repository: {
        directory: "packages/base",
        type: "git",
        url: "https://example.test/package-artifacts.git",
      },
      scripts: {
        postpack: "node ./scripts/postpack.mjs",
        prepack: "node ./scripts/prepack.mjs",
        prepublishOnly: "node ./scripts/reject-publish.mjs",
      },
      type: "module",
      version: "1.0.0-alpha.0",
    },
    prepack: failing
      ? [
          'import { mkdirSync, realpathSync, writeFileSync } from "node:fs";',
          "const observedNodePath = realpathSync(process.execPath);",
          "if (observedNodePath !== realpathSync(process.env.npm_node_execpath)) throw new Error(\"Lifecycle Node does not match npm_node_execpath.\");",
          'mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });',
          'writeFileSync(new URL("../dist/base.js", import.meta.url), "export const built = true;\\n");',
          'writeFileSync(new URL("../dist/node-path.txt", import.meta.url), observedNodePath + "\\n");',
          "process.exit(17);",
          "",
        ].join("\n")
      : [
          'import { mkdirSync, realpathSync, writeFileSync } from "node:fs";',
          "const observedNodePath = realpathSync(process.execPath);",
          "if (observedNodePath !== realpathSync(process.env.npm_node_execpath)) throw new Error(\"Lifecycle Node does not match npm_node_execpath.\");",
          'mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });',
          'writeFileSync(new URL("../dist/base.js", import.meta.url), "export const built = true;\\n");',
          'writeFileSync(new URL("../dist/node-path.txt", import.meta.url), observedNodePath + "\\n");',
          "",
        ].join("\n"),
  };
  const dependent = {
    root: "packages/dependent/",
    manifest: {
      dependencies: {
        [base.manifest.name]: base.manifest.version,
      },
      files: ["dist", "package.json", "src"],
      name: "@genii-foundation/a-package-artifact-dependent",
      repository: {
        directory: "packages/dependent",
        type: "git",
        url: "https://example.test/package-artifacts.git",
      },
      scripts: {
        postpack: "node ./scripts/postpack.mjs",
        prepack: "node ./scripts/prepack.mjs",
        prepublishOnly: "node ./scripts/reject-publish.mjs",
      },
      type: "module",
      version: "1.0.0-alpha.0",
    },
    prepack: [
      'import { existsSync, mkdirSync, writeFileSync } from "node:fs";',
      'const dependencyOutput = new URL("../../base/dist/base.js", import.meta.url);',
      'if (!existsSync(dependencyOutput)) throw new Error("Base package was not built first.");',
      'mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });',
      'writeFileSync(new URL("../dist/dependent.js", import.meta.url), "export const built = true;\\n");',
      "",
    ].join("\n"),
  };
  const packages = includeDependency
    ? [base, dependent]
    : [base];
  writeJson(join(repositoryRoot, "package.json"), rootManifest);
  writeJson(
    join(repositoryRoot, "package-lock.json"),
    packageLock({
      packages,
      rootManifest,
    }),
  );
  for (const packageRecord of packages) {
    const packageRoot = join(
      repositoryRoot,
      packageRecord.root,
    );
    mkdirSync(join(packageRoot, "scripts"), {
      recursive: true,
    });
    mkdirSync(join(packageRoot, "src"), {
      recursive: true,
    });
    writeJson(
      join(packageRoot, "package.json"),
      packageRecord.manifest,
    );
    writeFileSync(
      join(packageRoot, "src", "index.js"),
      "export const source = true;\n",
      "utf8",
    );
    writeFileSync(
      join(packageRoot, "scripts", "prepack.mjs"),
      packageRecord.prepack,
      "utf8",
    );
    writeFileSync(
      join(packageRoot, "scripts", "postpack.mjs"),
      [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(new URL("../postpack-ran.txt", import.meta.url), "yes\\n");',
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(packageRoot, "scripts", "reject-publish.mjs"),
      "process.exit(91);\n",
      "utf8",
    );
  }
  runGit(repositoryRoot, ["init", "--quiet"]);
  runGit(repositoryRoot, ["add", "--all"]);
  return {
    base,
    dependent,
    outputDirectory,
    repositoryRoot,
    temporaryRoot,
  };
}

function exactInvocation(repositoryRoot, environment = process.env) {
  return resolveExactNpmInvocation({
    environment,
    processExecPath: process.execPath,
    repositoryRoot,
  });
}

function publishDryRun({
  archivePath,
  invocation,
  repositoryRoot,
}) {
  const result = spawnSync(
    invocation.nodePath,
    [
      invocation.cliPath,
      "publish",
      "--dry-run",
      "--json",
      "--tag",
      "next",
      archivePath,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 30 * 1024 * 1024,
    },
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function cloneRetainedArchives(archives) {
  return new Map(
    [...archives].map(([root, archive]) => [
      root,
      Object.freeze({
        ...archive,
        files: Object.freeze([...archive.files]),
        packageFiles: Object.freeze([
          ...archive.packageFiles,
        ]),
      }),
    ]),
  );
}

test("lifecycle candidates are topologically built, physically verified, and promoted unchanged", async () => {
  const fixture = createFixture();
  let prepared;
  try {
    const beforeStatus = runGit(
      fixture.repositoryRoot,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    );
    const environment = {
      ...process.env,
      npm_config_ignore_scripts: "true",
    };
    const invocation = exactInvocation(
      fixture.repositoryRoot,
      environment,
    );
    prepared = await preparePackageArchives({
      npmInvocation: invocation,
      outputDirectory: fixture.outputDirectory,
      packageRoots: [
        fixture.dependent.root,
        fixture.base.root,
      ],
      repositoryRoot: fixture.repositoryRoot,
    });
    assert.deepEqual(
      [...prepared.archives.keys()],
      [
        fixture.base.root,
        fixture.dependent.root,
      ],
      "returned archives must preserve internal dependency order",
    );
    assert.equal(
      existsSync(
        join(
          fixture.repositoryRoot,
          "packages",
          "base",
          "dist",
        ),
      ),
      false,
      "candidate builds must not create source-checkout dist",
    );
    assert.equal(
      runGit(
        fixture.repositoryRoot,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      ),
      beforeStatus,
      "candidate preparation must not change the source checkout",
    );
    const verified = await verifyPreparedPackageArchives({
      expectedPackageRoots: [
        fixture.dependent.root,
        fixture.base.root,
      ],
      npmInvocation: invocation,
      prepared,
      repositoryRoot: fixture.repositoryRoot,
    });
    assert.deepEqual(
      [...verified.keys()],
      [
        fixture.base.root,
        fixture.dependent.root,
      ],
    );
    const dependentArchive = verified.get(
      fixture.dependent.root,
    );
    const baseArchive = verified.get(fixture.base.root);
    assert.ok(dependentArchive);
    assert.ok(baseArchive);
    assert.deepEqual(
      [
        ...(await verifyPreparedPackageArchives({
          expectedPackageRoots: [
            fixture.dependent.root,
          ],
          npmInvocation: invocation,
          prepared: new Map([
            [
              fixture.dependent.root,
              dependentArchive,
            ],
          ]),
          repositoryRoot: fixture.repositoryRoot,
        })).keys(),
      ],
      [fixture.dependent.root],
      "a retained per-record subset must preserve its relative dependency order",
    );
    assert.equal(
      dependentArchive.files.includes(
        "package/dist/dependent.js",
      ),
      true,
    );
    assert.equal(
      baseArchive.files.includes("package/dist/base.js"),
      true,
    );
    const archivedNodePathArchive = await readPackageArchive({
      archivePath: baseArchive.archivePath,
      captureFile: ({ path }) =>
        path === "package/dist/node-path.txt",
    });
    const archivedNodePath = archivedNodePathArchive.entries
      .find(({ path }) => path === "package/dist/node-path.txt")
      .bytes.toString("utf8")
      .trim();
    assert.equal(
      archivedNodePath,
      invocation.nodePath,
      "lifecycle Node must equal the attested npm_node_execpath",
    );
    assert.deepEqual(
      await inspectPackageArchive({
        archivePath: dependentArchive.archivePath,
        root: fixture.dependent.root,
      }),
      dependentArchive,
    );
    const publishCandidate = publishDryRun({
      archivePath: dependentArchive.archivePath,
      invocation,
      repositoryRoot: fixture.repositoryRoot,
    });
    assert.equal(
      publishCandidate.integrity,
      dependentArchive.integrity,
    );
    assert.equal(
      publishCandidate.shasum,
      dependentArchive.shasum,
    );
    assert.deepEqual(
      publishCandidate.files
        .map(({ path }) => path)
        .sort(),
      [...dependentArchive.packageFiles].sort(),
    );
    await assert.rejects(
      async () =>
        verifyPreparedPackageArchives({
          expectedPackageRoots: [fixture.base.root],
          npmInvocation: invocation,
          prepared,
          repositoryRoot: fixture.repositoryRoot,
        }),
      /root set mismatch/,
    );
    await assert.rejects(
      async () =>
        verifyPreparedPackageArchives({
          expectedPackageRoots: [
            fixture.base.root,
            fixture.base.root,
          ],
          npmInvocation: invocation,
          prepared,
          repositoryRoot: fixture.repositoryRoot,
        }),
      /Duplicate package root/,
    );
    prepared.dispose();
    prepared.dispose();
    assert.equal(
      existsSync(dependentArchive.archivePath),
      true,
      "dispose must retain caller-owned promoted candidates",
    );
    assert.equal(
      (await verifyPreparedPackageArchives({
        expectedPackageRoots: [
          fixture.dependent.root,
          fixture.base.root,
        ],
        npmInvocation: invocation,
        prepared,
        repositoryRoot: fixture.repositoryRoot,
      })).size,
      2,
    );
    chmodSync(dependentArchive.archivePath, 0o600);
    const tampered = readFileSync(dependentArchive.archivePath);
    tampered[tampered.length - 1] ^= 0xff;
    writeFileSync(dependentArchive.archivePath, tampered);
    await assert.rejects(
      async () =>
        verifyPreparedPackageArchives({
          expectedPackageRoots: [
            fixture.dependent.root,
            fixture.base.root,
          ],
          npmInvocation: invocation,
          prepared,
          repositoryRoot: fixture.repositoryRoot,
        }),
    );
  } finally {
    prepared?.dispose();
    removeOwnedTestRoot(fixture.temporaryRoot);
  }
});

test("temporary candidates are removed by idempotent owned disposal", async () => {
  const fixture = createFixture({
    includeDependency: false,
  });
  let prepared;
  try {
    const invocation = exactInvocation(fixture.repositoryRoot);
    prepared = await preparePackageArchives({
      npmInvocation: invocation,
      packageRoots: [fixture.base.root],
      repositoryRoot: fixture.repositoryRoot,
    });
    const [archive] = prepared.archives.values();
    assert.ok(archive);
    assert.equal(existsSync(archive.archivePath), true);
    prepared.dispose();
    prepared.dispose();
    assert.equal(existsSync(archive.archivePath), false);
    await assert.rejects(
      async () =>
        verifyPreparedPackageArchives({
          expectedPackageRoots: [fixture.base.root],
          npmInvocation: invocation,
          prepared,
          repositoryRoot: fixture.repositoryRoot,
        }),
      /disposed/,
    );
  } finally {
    prepared?.dispose();
    removeOwnedTestRoot(fixture.temporaryRoot);
  }
});

test("prepack failure removes owned staging and never promotes a partial candidate", async () => {
  const fixture = createFixture({
    failing: true,
    includeDependency: false,
  });
  try {
    const invocation = exactInvocation(fixture.repositoryRoot);
    const beforeTemporaryRoots = readdirSync(tmpdir())
      .filter((name) =>
        name.startsWith("publisher-package-artifacts-")
      )
      .sort();
    await assert.rejects(
      async () =>
        preparePackageArchives({
          npmInvocation: invocation,
          outputDirectory: fixture.outputDirectory,
          packageRoots: [fixture.base.root],
          repositoryRoot: fixture.repositoryRoot,
        }),
      /status 17/,
    );
    assert.deepEqual(readdirSync(fixture.outputDirectory), []);
    assert.deepEqual(
      readdirSync(tmpdir())
        .filter((name) =>
          name.startsWith("publisher-package-artifacts-")
        )
        .sort(),
      beforeTemporaryRoots,
    );
    assert.equal(
      existsSync(
        join(
          fixture.repositoryRoot,
          "packages",
          "base",
          "dist",
        ),
      ),
      false,
    );
  } finally {
    removeOwnedTestRoot(fixture.temporaryRoot);
  }
});

test("exact npm and complete internal root identity fail closed", async () => {
  const fixture = createFixture();
  try {
    const fakeNpm = join(
      fixture.temporaryRoot,
      "fake-npm-cli.mjs",
    );
    writeFileSync(
      fakeNpm,
      'process.stdout.write("0.0.0\\n");\n',
      "utf8",
    );
    assert.throws(
      () =>
        exactInvocation(fixture.repositoryRoot, {
          ...process.env,
          npm_execpath: fakeNpm,
        }),
      /does not match exact repository pin/,
    );
    assert.throws(
      () =>
        exactInvocation(fixture.repositoryRoot, {
          ...process.env,
          npm_execpath: "",
        }),
      /npm_execpath/,
    );
    assert.throws(
      () => {
        const environment = {
          ...process.env,
        };
        delete environment.npm_node_execpath;
        return exactInvocation(
          fixture.repositoryRoot,
          environment,
        );
      },
      /npm_node_execpath/,
    );
    assert.throws(
      () =>
        exactInvocation(fixture.repositoryRoot, {
          ...process.env,
          npm_node_execpath: fakeNpm,
        }),
      /does not match the current Node executable/,
    );
    const invocation = exactInvocation(fixture.repositoryRoot);
    assert.equal(
      invocation.nodePath,
      realpathSync(process.execPath),
    );
    await assert.rejects(
      async () =>
        preparePackageArchives({
          npmInvocation: invocation,
          packageRoots: [fixture.dependent.root],
          repositoryRoot: fixture.repositoryRoot,
        }),
      /missing internal package/,
    );
    mkdirSync(join(fixture.outputDirectory, "not-empty"));
    await assert.rejects(
      async () =>
        preparePackageArchives({
          npmInvocation: invocation,
          outputDirectory: fixture.outputDirectory,
          packageRoots: [
            fixture.base.root,
            fixture.dependent.root,
          ],
          repositoryRoot: fixture.repositoryRoot,
        }),
      /must be empty/,
    );
  } finally {
    removeOwnedTestRoot(fixture.temporaryRoot);
  }
});

test("fresh retained maps are source-bound, path-bound, tamper-evident, and discardable", async () => {
  const fixture = createFixture({
    includeDependency: false,
  });
  let prepared;
  try {
    const invocation = exactInvocation(fixture.repositoryRoot);
    prepared = await preparePackageArchives({
      npmInvocation: invocation,
      outputDirectory: fixture.outputDirectory,
      packageRoots: [fixture.base.root],
      repositoryRoot: fixture.repositoryRoot,
    });
    prepared.dispose();
    const retained = cloneRetainedArchives(
      prepared.archives,
    );
    const verified = await verifyPreparedPackageArchives({
      expectedPackageRoots: [fixture.base.root],
      npmInvocation: invocation,
      prepared: retained,
      repositoryRoot: fixture.repositoryRoot,
    });
    const archive = verified.get(fixture.base.root);
    assert.ok(archive);
    const releaseManifestPath = join(
      archive.candidateDirectory,
      "release-manifest.json",
    );
    writeJson(
      releaseManifestPath,
      createReleaseManifest(
        "next",
        invocation,
        verified,
      ),
    );
    const retainedRoundTrip = readPreparedArchives(
      releaseManifestPath,
    );
    assert.equal(retainedRoundTrip.npmVersion, "10.9.0");
    assert.equal(retainedRoundTrip.tag, "next");
    assert.deepEqual(
      [
        ...(await verifyPreparedPackageArchives({
          expectedPackageRoots: [fixture.base.root],
          npmInvocation: invocation,
          prepared: retainedRoundTrip.archives,
          repositoryRoot: fixture.repositoryRoot,
        })).keys(),
      ],
      [fixture.base.root],
    );

    const badHash = cloneRetainedArchives(retained);
    badHash.set(
      fixture.base.root,
      Object.freeze({
        ...badHash.get(fixture.base.root),
        sha256: "sha256:00",
      }),
    );
    await assert.rejects(
      async () =>
        verifyPreparedPackageArchives({
          expectedPackageRoots: [fixture.base.root],
          npmInvocation: invocation,
          prepared: badHash,
          repositoryRoot: fixture.repositoryRoot,
        }),
      /does not match the expected retained identity/,
    );

    const linkedArchive = join(
      archive.candidateDirectory,
      "linked-candidate.tgz",
    );
    symlinkSync(archive.archivePath, linkedArchive);
    const symlinked = cloneRetainedArchives(retained);
    symlinked.set(
      fixture.base.root,
      Object.freeze({
        ...symlinked.get(fixture.base.root),
        archivePath: linkedArchive,
      }),
    );
    await assert.rejects(
      async () =>
        verifyPreparedPackageArchives({
          expectedPackageRoots: [fixture.base.root],
          npmInvocation: invocation,
          prepared: symlinked,
          repositoryRoot: fixture.repositoryRoot,
        }),
      /regular file/,
    );
    unlinkSync(linkedArchive);

    const hardLinkedArchive = join(
      archive.candidateDirectory,
      "hard-linked-candidate.tgz",
    );
    linkSync(archive.archivePath, hardLinkedArchive);
    const hardLinked = cloneRetainedArchives(retained);
    hardLinked.set(
      fixture.base.root,
      Object.freeze({
        ...hardLinked.get(fixture.base.root),
        archivePath: hardLinkedArchive,
      }),
    );
    await assert.rejects(
      async () =>
        verifyPreparedPackageArchives({
          expectedPackageRoots: [fixture.base.root],
          npmInvocation: invocation,
          prepared: hardLinked,
          repositoryRoot: fixture.repositoryRoot,
        }),
      /exactly one hard link/,
    );
    unlinkSync(hardLinkedArchive);

    const manifestPath = join(
      fixture.repositoryRoot,
      fixture.base.root,
      "package.json",
    );
    const originalManifest = readFileSync(
      manifestPath,
      "utf8",
    );
    const changedManifest = JSON.parse(originalManifest);
    changedManifest.version = "1.0.0-alpha.1";
    writeJson(manifestPath, changedManifest);
    await assert.rejects(
      async () =>
        verifyPreparedPackageArchives({
          expectedPackageRoots: [fixture.base.root],
          npmInvocation: invocation,
          prepared: retained,
          repositoryRoot: fixture.repositoryRoot,
        }),
      /does not match current source identity/,
    );
    writeFileSync(manifestPath, originalManifest, "utf8");

    prepared.discard();
    prepared.discard();
    assert.equal(existsSync(archive.archivePath), false);
  } finally {
    prepared?.discard();
    removeOwnedTestRoot(fixture.temporaryRoot);
  }
});

test("real Content and Reader lifecycle candidates retain their physical runtime closures", {
  timeout: 180_000,
}, async () => {
  const packageRoots = [
    "packages/reader/",
    "packages/content/",
    "schemas/",
  ];
  const beforeStatus = runGit(
    realRepositoryRoot,
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ],
  );
  const invocation = exactInvocation(realRepositoryRoot);
  const prepared = await preparePackageArchives({
    npmInvocation: invocation,
    packageRoots,
    repositoryRoot: realRepositoryRoot,
  });
  try {
    const verified = await verifyPreparedPackageArchives({
      expectedPackageRoots: packageRoots,
      npmInvocation: invocation,
      prepared: cloneRetainedArchives(prepared.archives),
      repositoryRoot: realRepositoryRoot,
    });
    assert.deepEqual(
      [...verified.keys()],
      [
        "schemas/",
        "packages/content/",
        "packages/reader/",
      ],
    );
    const content = verified.get("packages/content/");
    const reader = verified.get("packages/reader/");
    assert.ok(content);
    assert.ok(reader);
    assert.equal(
      content.files.includes(
        "package/node_modules/mdast-util-from-markdown/package.json",
      ),
      true,
    );
    assert.equal(
      content.files.includes(
        "package/node_modules/@unicode/unicode-15.1.0/package.json",
      ),
      true,
    );
    assert.equal(
      reader.files.includes(
        "package/node_modules/mdast-util-from-markdown/package.json",
      ),
      true,
    );
    for (const archive of [content, reader]) {
      assert.equal(
        archive.files.some((path) =>
          path.startsWith("package/dist/")
        ),
        true,
      );
      const publishCandidate = publishDryRun({
        archivePath: archive.archivePath,
        invocation,
        repositoryRoot: realRepositoryRoot,
      });
      assert.equal(
        publishCandidate.integrity,
        archive.integrity,
      );
      assert.equal(
        publishCandidate.shasum,
        archive.shasum,
      );
      assert.deepEqual(
        publishCandidate.files
          .map(({ path }) => path)
          .sort(),
        [...archive.packageFiles].sort(),
      );
      assert.equal(
        (await inspectPackageArchive({
          archivePath: archive.archivePath,
          root: archive.root,
        })).sha256,
        archive.sha256,
      );
    }
  } finally {
    prepared.dispose();
  }
  assert.equal(
    runGit(
      realRepositoryRoot,
      [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ],
    ),
    beforeStatus,
  );
});
