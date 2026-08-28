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

import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertReleaseTag } from "../../packages/publisher/scripts/check-release-tag.mjs";
import { discoverPublishablePackageRoots } from "./prepare-release.mjs";
import { readPreparedArchives } from "./verify-release.mjs";

const trustedRepository = "genii-foundation/publisher";
const trustedWorkflowPath = ".github/workflows/publish.yml";
const preparedNpmVersion = "10.9.0";
const minimumPublishingNpmVersion = Object.freeze([11, 5, 1]);
const trustedNpmConfiguration =
  "registry=https://registry.npmjs.org/\nprovenance=true\n";
const repositoryRoot = realpathSync(fileURLToPath(
  new URL("../../", import.meta.url),
));

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha512Integrity(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function sha1(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

function assertExactNpmVersion(version) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(
    version,
  );
  if (match === null) {
    throw new Error("Trusted publication requires one exact npm version.");
  }
  const actual = match.slice(1).map(Number);
  for (let index = 0; index < minimumPublishingNpmVersion.length; index += 1) {
    if (actual[index] > minimumPublishingNpmVersion[index]) {
      return;
    }
    if (actual[index] < minimumPublishingNpmVersion[index]) {
      throw new Error("Trusted publication requires npm 11.5.1 or newer.");
    }
  }
}

function assertTrustedEnvironment(environment, versions) {
  if (
    environment.GITHUB_ACTIONS !== "true" ||
    environment.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    environment.GITHUB_REPOSITORY !== trustedRepository ||
    environment.GITHUB_REF_TYPE !== "tag" ||
    typeof environment.GITHUB_REF_NAME !== "string" ||
    environment.GITHUB_REF_NAME.length === 0 ||
    environment.GITHUB_REF !== `refs/tags/${environment.GITHUB_REF_NAME}` ||
    environment.GITHUB_WORKFLOW_REF !==
      `${trustedRepository}/${trustedWorkflowPath}@${environment.GITHUB_REF}` ||
    !/^[0-9a-f]{40}$/u.test(environment.GITHUB_SHA ?? "") ||
    typeof environment.ACTIONS_ID_TOKEN_REQUEST_URL !== "string" ||
    environment.ACTIONS_ID_TOKEN_REQUEST_URL.length === 0 ||
    typeof environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN !== "string" ||
    environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length === 0
  ) {
    throw new Error(
      "Trusted publication requires the exact tagged GitHub Actions OIDC workflow.",
    );
  }
  if (
    environment.NODE_AUTH_TOKEN !== undefined ||
    environment.NPM_TOKEN !== undefined ||
    Object.keys(environment).some(
      (name) => /^npm_config_/iu.test(name) && /auth|token/iu.test(name),
    )
  ) {
    throw new Error("Trusted publication refuses registry bearer-token variables.");
  }
  if (!/^24\.[0-9]+\.[0-9]+$/u.test(versions.node)) {
    throw new Error("Trusted publication requires Node.js 24.");
  }
}

function resolvePublishingNpm(environment, processExecPath) {
  if (
    typeof environment.npm_execpath !== "string" ||
    !isAbsolute(environment.npm_execpath)
  ) {
    throw new Error("npm_execpath must identify the trusted publishing npm CLI.");
  }
  const npmCliPath = realpathSync(environment.npm_execpath);
  const npmStat = lstatSync(npmCliPath);
  if (npmStat.isSymbolicLink() || !npmStat.isFile() || npmStat.nlink !== 1) {
    throw new Error("The trusted publishing npm CLI must be one regular file.");
  }
  if (
    typeof environment.npm_node_execpath !== "string" ||
    !isAbsolute(environment.npm_node_execpath) ||
    !isAbsolute(processExecPath) ||
    realpathSync(environment.npm_node_execpath) !== realpathSync(processExecPath)
  ) {
    throw new Error("npm_node_execpath must match the trusted Node executable.");
  }
  if (
    typeof environment.NPM_CONFIG_USERCONFIG !== "string" ||
    !isAbsolute(environment.NPM_CONFIG_USERCONFIG) ||
    resolve(environment.NPM_CONFIG_USERCONFIG) !==
      environment.NPM_CONFIG_USERCONFIG
  ) {
    throw new Error("Trusted publication requires one canonical npm configuration file.");
  }
  const configurationStat = lstatSync(environment.NPM_CONFIG_USERCONFIG);
  if (
    configurationStat.isSymbolicLink() ||
    !configurationStat.isFile() ||
    configurationStat.nlink !== 1 ||
    configurationStat.size !== Buffer.byteLength(trustedNpmConfiguration) ||
    realpathSync(environment.NPM_CONFIG_USERCONFIG) !==
      environment.NPM_CONFIG_USERCONFIG ||
    readFileSync(environment.NPM_CONFIG_USERCONFIG, "utf8") !==
      trustedNpmConfiguration
  ) {
    throw new Error("Trusted publication requires the exact token-free npm configuration.");
  }
  return npmCliPath;
}

function assertTrustedGitCheckout(environment, execFileImpl) {
  const git = (args) => execFileImpl(
    "git",
    ["-C", repositoryRoot, ...args],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
  if (
    git(["rev-parse", "HEAD"]) !== environment.GITHUB_SHA ||
    git(["rev-parse", `${environment.GITHUB_REF}^{commit}`]) !==
      environment.GITHUB_SHA ||
    git(["status", "--porcelain=v1", "--untracked-files=all"]) !== ""
  ) {
    throw new Error(
      "Trusted publication requires the exact clean tagged GitHub checkout.",
    );
  }
}

function runNpm({ args, environment, npmCliPath, processExecPath, spawnImpl }) {
  const result = spawnImpl(processExecPath, [npmCliPath, ...args], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
    stdio: args[0] === "publish" ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Trusted npm ${args[0]} exited with status ${result.status ?? "unknown"}.`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

function inspectArchive(archive) {
  const statBefore = lstatSync(archive.archivePath);
  if (
    statBefore.isSymbolicLink() ||
    !statBefore.isFile() ||
    statBefore.nlink !== 1 ||
    statBefore.size !== archive.size ||
    realpathSync(archive.archivePath) !== archive.archivePath
  ) {
    throw new Error(`Release archive ${archive.name} changed before publication.`);
  }
  const bytes = readFileSync(archive.archivePath);
  const statAfter = lstatSync(archive.archivePath);
  if (
    statAfter.dev !== statBefore.dev ||
    statAfter.ino !== statBefore.ino ||
    statAfter.size !== statBefore.size ||
    statAfter.mtimeMs !== statBefore.mtimeMs ||
    sha256(bytes) !== archive.sha256 ||
    sha512Integrity(bytes) !== archive.integrity ||
    sha1(bytes) !== archive.shasum
  ) {
    throw new Error(`Release archive ${archive.name} failed exact publication identity.`);
  }
}

export function publishPreparedRelease({
  argv = process.argv.slice(2),
  environment = process.env,
  execFileImpl = execFileSync,
  processExecPath = process.execPath,
  spawnImpl = spawnSync,
  versions = process.versions,
} = {}) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--manifest" ||
    typeof argv[1] !== "string" ||
    !isAbsolute(argv[1]) ||
    resolve(argv[1]) !== argv[1]
  ) {
    throw new Error(
      "Trusted publication requires --manifest <absolute-release-manifest-path>.",
    );
  }
  assertTrustedEnvironment(environment, versions);
  assertTrustedGitCheckout(environment, execFileImpl);
  const npmCliPath = resolvePublishingNpm(environment, processExecPath);
  const npmVersion = runNpm({
    args: ["--version"],
    environment,
    npmCliPath,
    processExecPath,
    spawnImpl,
  });
  assertExactNpmVersion(npmVersion);
  const manifest = readPreparedArchives(argv[1]);
  if (manifest.npmVersion !== preparedNpmVersion) {
    throw new Error("Trusted publication requires archives prepared by npm 10.9.0.");
  }
  const archives = [...manifest.archives.values()];
  const expectedRoots = discoverPublishablePackageRoots();
  const actualRoots = archives.map((archive) => archive.root).sort();
  if (
    actualRoots.length !== expectedRoots.length ||
    actualRoots.some((root, index) => root !== expectedRoots[index])
  ) {
    throw new Error("Trusted publication requires the complete publishable package census.");
  }
  for (const archive of archives) {
    const packageManifest = JSON.parse(
      readFileSync(`${repositoryRoot}/${archive.root}package.json`, "utf8"),
    );
    if (
      packageManifest.name !== archive.name ||
      packageManifest.version !== archive.version ||
      packageManifest.private === true ||
      packageManifest.publishConfig?.access !== "public"
    ) {
      throw new Error(
        `Release archive ${archive.root} does not match current publishable package metadata.`,
      );
    }
  }
  const versionsInRelease = new Set(archives.map((archive) => archive.version));
  if (
    versionsInRelease.size !== 1 ||
    environment.GITHUB_REF_NAME !== `v${archives[0].version}`
  ) {
    throw new Error("The trusted Git tag must exactly match every package version.");
  }
  for (const archive of archives) {
    assertReleaseTag(
      archive.version,
      manifest.tag,
      "the prepared release manifest tag field",
    );
    inspectArchive(archive);
  }
  for (const archive of archives) {
    inspectArchive(archive);
    runNpm({
      args: [
        "publish",
        archive.archivePath,
        "--access",
        "public",
        "--tag",
        manifest.tag,
        "--provenance",
      ],
      environment,
      npmCliPath,
      processExecPath,
      spawnImpl,
    });
    inspectArchive(archive);
  }
  return Object.freeze({
    npmVersion,
    packageCount: archives.length,
    tag: manifest.tag,
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = publishPreparedRelease();
    console.log(
      `Published ${result.packageCount} exact package archive(s) with npm ${result.npmVersion} under tag ${result.tag}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
