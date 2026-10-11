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
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { publishPreparedRelease } from "./publish-release.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function digest(algorithm, bytes, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

async function createFixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "publisher-trusted-release-")),
  );
  const manifestPath = join(root, "release-manifest.json");
  const npmCliPath = join(root, "npm-cli.js");
  const npmConfigPath = join(root, "trusted.npmrc");
  await writeFile(npmCliPath, "process.exitCode = 0;\n");
  await chmod(npmCliPath, 0o755);
  await writeFile(
    npmConfigPath,
    "registry=https://registry.npmjs.org/\nprovenance=true\n",
  );
  const packageDescriptors = [
    ["schemas/", "@genii-foundation/publisher-schema"],
    ["packages/content/", "@genii-foundation/publisher-content"],
    ["packages/reader/", "@genii-foundation/publisher-reader"],
    ["packages/publisher/", "@genii-foundation/publisher"],
    ["packages/next/", "@genii-foundation/publisher-next"],
    ["packages/sync-supabase/", "@genii-foundation/publisher-sync-supabase"],
  ];
  const archivePaths = [];
  const packages = [];
  for (const [packageRoot, name] of packageDescriptors) {
    const archiveBytes = Buffer.from(`exact release archive ${packageRoot}\n`);
    const archiveName = `${name.replace("@genii-foundation/", "genii-foundation-")}-0.1.0-alpha.0.tgz`;
    const archivePath = join(root, archiveName);
    await writeFile(archivePath, archiveBytes);
    archivePaths.push(archivePath);
    packages.push({
      root: packageRoot,
      name,
      version: "0.1.0-alpha.0",
      archive: archiveName,
      fileCount: 1,
      sha256: `sha256:${digest("sha256", archiveBytes, "hex")}`,
      integrity: `sha512-${digest("sha512", archiveBytes, "base64")}`,
      shasum: digest("sha1", archiveBytes, "hex"),
      files: ["package/package.json"],
      packageFiles: ["package.json"],
      size: archiveBytes.length,
    });
  }
  const manifest = {
    schemaVersion: "1.0.0",
    packageManager: {
      name: "npm",
      version: "10.9.0",
    },
    tag: "next",
    packages,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const environment = {
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request-token",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example.test/oidc",
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/tags/v0.1.0-alpha.0",
    GITHUB_REF_NAME: "v0.1.0-alpha.0",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REPOSITORY: "genii-foundation/publisher",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_WORKFLOW_REF:
      "genii-foundation/publisher/.github/workflows/publish.yml@refs/tags/v0.1.0-alpha.0",
    NPM_CONFIG_USERCONFIG: npmConfigPath,
    npm_execpath: npmCliPath,
    npm_node_execpath: process.execPath,
  };
  return {
    archivePaths,
    environment,
    manifest,
    manifestPath,
    root,
  };
}

function successfulNpm(calls, version = "11.5.1") {
  return (command, args, options) => {
    calls.push({ args, command, options });
    return {
      status: 0,
      stdout: args[1] === "--version" ? `${version}\n` : undefined,
    };
  };
}

function trustedGit(environment, { dirty = false, head } = {}) {
  return (_command, args) => {
    if (args.includes("status")) {
      return dirty ? " M package.json\n" : "";
    }
    return `${head ?? environment.GITHUB_SHA}\n`;
  };
}

test("trusted publication rechecks and publishes only the exact retained archive", async (t) => {
  const fixture = await createFixture();
  t.after(async () => rm(fixture.root, { force: true, recursive: true }));
  const calls = [];

  const result = publishPreparedRelease({
    argv: ["--manifest", fixture.manifestPath],
    environment: fixture.environment,
    execFileImpl: trustedGit(fixture.environment),
    spawnImpl: successfulNpm(calls),
    versions: { node: "24.4.0" },
  });

  assert.deepEqual(result, {
    npmVersion: "11.5.1",
    packageCount: 6,
    tag: "next",
  });
  assert.equal(calls.length, 7);
  assert.deepEqual(calls[1].args.slice(1), [
    "publish",
    fixture.archivePaths[0],
    "--access",
    "public",
    "--tag",
    "next",
    "--provenance",
  ]);
});

test("trusted publication rejects environment, token, runtime, tag, and byte drift", async (t) => {
  const fixture = await createFixture();
  t.after(async () => rm(fixture.root, { force: true, recursive: true }));
  const attempt = (overrides = {}) => publishPreparedRelease({
    argv: ["--manifest", fixture.manifestPath],
    environment: {
      ...fixture.environment,
      ...overrides.environment,
    },
    execFileImpl: trustedGit(
      {
        ...fixture.environment,
        ...overrides.environment,
      },
      overrides.git,
    ),
    spawnImpl: successfulNpm([], overrides.npmVersion),
    versions: { node: overrides.nodeVersion ?? "24.4.0" },
  });

  assert.throws(
    () => attempt({ environment: { GITHUB_EVENT_NAME: "push" } }),
    /exact tagged GitHub Actions OIDC workflow/u,
  );
  assert.throws(
    () => attempt({ environment: { NODE_AUTH_TOKEN: "secret" } }),
    /refuses registry bearer-token/u,
  );
  assert.throws(
    () => attempt({ npmVersion: "11.5.0" }),
    /npm 11\.5\.1 or newer/u,
  );
  assert.throws(
    () => attempt({ nodeVersion: "22.12.0" }),
    /requires Node\.js 24/u,
  );
  assert.throws(
    () => attempt({ git: { dirty: true } }),
    /exact clean tagged GitHub checkout/u,
  );
  assert.throws(
    () => attempt({ environment: {
      GITHUB_REF: "refs/tags/v0.1.0",
      GITHUB_REF_NAME: "v0.1.0",
      GITHUB_WORKFLOW_REF:
        "genii-foundation/publisher/.github/workflows/publish.yml@refs/tags/v0.1.0",
    } }),
    /tag must exactly match/u,
  );

  const incompleteManifest = {
    ...fixture.manifest,
    packages: fixture.manifest.packages.slice(0, -1),
  };
  await writeFile(
    fixture.manifestPath,
    `${JSON.stringify(incompleteManifest)}\n`,
  );
  assert.throws(
    () => attempt(),
    /complete publishable package census/u,
  );
  await writeFile(
    fixture.manifestPath,
    `${JSON.stringify(fixture.manifest)}\n`,
  );
  await writeFile(fixture.archivePaths[0], "changed archive bytes\n");
  assert.throws(
    () => attempt(),
    /changed before publication|failed exact publication identity/u,
  );
});

test("trusted publication requires the exact token-free npm configuration", async (t) => {
  const fixture = await createFixture();
  t.after(async () => rm(fixture.root, { force: true, recursive: true }));
  await writeFile(
    fixture.environment.NPM_CONFIG_USERCONFIG,
    "//registry.npmjs.org/:_authToken=secret\n",
  );
  assert.throws(
    () => publishPreparedRelease({
      argv: ["--manifest", fixture.manifestPath],
      environment: fixture.environment,
      execFileImpl: trustedGit(fixture.environment),
      spawnImpl: successfulNpm([]),
      versions: { node: "24.4.0" },
    }),
    /exact token-free npm configuration/u,
  );
});

test("the trusted workflow pins its tag, evidence, runtime, OIDC, and environment gates", async () => {
  const workflow = await readFile(
    join(repositoryRoot, ".github", "workflows", "publish.yml"),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(
    workflow,
    /^\s+(?:pull_request|push|release|schedule):/mu,
  );
  assert.match(workflow, /environment: npm-publish/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /node-version: 22\.12\.0/u);
  assert.match(workflow, /npm install --global npm@10\.9\.0/u);
  assert.match(workflow, /release:prepare/u);
  assert.match(workflow, /release:verify --/u);
  assert.match(workflow, /release:verify-public-surface/u);
  assert.match(
    workflow,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u,
  );
  assert.match(workflow, /node-version: 24\.x/u);
  assert.match(workflow, /npm install --global npm@11\.5\.1/u);
  assert.match(workflow, /release:publish --/u);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/u);
  assert.doesNotMatch(workflow, /continue-on-error/u);
  assert.equal(workflow.match(/release:publish --/gu)?.length, 1);
  assert.ok(
    workflow.indexOf("release:prepare") <
      workflow.indexOf("release:verify --") &&
    workflow.indexOf("release:verify --") <
      workflow.indexOf("release:verify-public-surface") &&
    workflow.indexOf("release:verify-public-surface") <
      workflow.indexOf("actions/upload-artifact@") &&
    workflow.indexOf("actions/upload-artifact@") <
      workflow.indexOf("release:publish --"),
  );
});
