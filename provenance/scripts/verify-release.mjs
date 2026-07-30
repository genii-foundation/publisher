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

import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  assertReleaseTag,
} from "../../packages/publisher/scripts/check-release-tag.mjs";
import {
  resolveExactNpmInvocation,
  verifyPreparedPackageArchives,
} from "./package-artifacts.mjs";
import {
  discoverPublishablePackageRoots,
} from "./prepare-release.mjs";
import {
  runReleaseGate,
} from "./release-gate.mjs";

const repositoryRoot = fileURLToPath(
  new URL("../../", import.meta.url),
);
const maximumReleaseManifestBytes = 32 * 1024 * 1024;

function manifestArgument(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--manifest" ||
    typeof argv[1] !== "string" ||
    !isAbsolute(argv[1])
  ) {
    throw new Error(
      "Release verification requires --manifest <absolute-release-manifest-path>.",
    );
  }
  return resolve(argv[1]);
}

export function readPreparedArchives(manifestPath) {
  const candidateDirectory = dirname(manifestPath);
  const directoryStat = lstatSync(candidateDirectory);
  if (
    directoryStat.isSymbolicLink() ||
    !directoryStat.isDirectory() ||
    realpathSync(candidateDirectory) !== candidateDirectory
  ) {
    throw new Error(
      "The release manifest parent must be one real directory.",
    );
  }
  const manifestStat = lstatSync(manifestPath);
  if (
    manifestStat.isSymbolicLink() ||
    !manifestStat.isFile() ||
    manifestStat.nlink !== 1 ||
    manifestStat.size < 1 ||
    manifestStat.size > maximumReleaseManifestBytes ||
    realpathSync(manifestPath) !== manifestPath
  ) {
    throw new Error(
      "The release manifest must be one bounded regular file without links.",
    );
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  );
  if (
    manifest?.schemaVersion !== "1.0.0" ||
    manifest.packageManager?.name !== "npm" ||
    typeof manifest.packageManager.version !== "string" ||
    typeof manifest.tag !== "string" ||
    manifest.tag.length === 0 ||
    !Array.isArray(manifest.packages) ||
    manifest.packages.length === 0
  ) {
    throw new Error("The release manifest has an invalid shape.");
  }
  const archives = new Map();
  for (const item of manifest.packages) {
    if (
      typeof item?.root !== "string" ||
      typeof item.name !== "string" ||
      typeof item.version !== "string" ||
      typeof item.archive !== "string" ||
      item.archive !== basename(item.archive) ||
      !item.archive.endsWith(".tgz") ||
      !Number.isSafeInteger(item.fileCount) ||
      item.fileCount < 1 ||
      typeof item.sha256 !== "string" ||
      typeof item.integrity !== "string" ||
      typeof item.shasum !== "string" ||
      !Array.isArray(item.files) ||
      !Array.isArray(item.packageFiles) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 1 ||
      archives.has(item.root)
    ) {
      throw new Error(
        "The release manifest contains an invalid or duplicate package candidate.",
      );
    }
    archives.set(item.root, Object.freeze({
      root: item.root,
      archivePath: join(candidateDirectory, item.archive),
      candidateDirectory,
      fileCount: item.fileCount,
      name: item.name,
      version: item.version,
      sha256: item.sha256,
      integrity: item.integrity,
      shasum: item.shasum,
      files: Object.freeze([...item.files]),
      packageFiles: Object.freeze([...item.packageFiles]),
      size: item.size,
    }));
  }
  return Object.freeze({
    archives,
    npmVersion: manifest.packageManager.version,
    tag: manifest.tag,
  });
}

export async function verifyRelease(
  argv = process.argv.slice(2),
) {
  const manifestPath = manifestArgument(argv);
  const manifest = readPreparedArchives(manifestPath);
  const packageRoots = discoverPublishablePackageRoots();
  const npmInvocation = resolveExactNpmInvocation({
    repositoryRoot,
  });
  if (manifest.npmVersion !== npmInvocation.npmVersion) {
    throw new Error(
      `Release manifest npm ${manifest.npmVersion} does not match invoking npm ${npmInvocation.npmVersion}.`,
    );
  }
  let archives = await verifyPreparedPackageArchives({
    repositoryRoot,
    expectedPackageRoots: packageRoots,
    npmInvocation,
    prepared: manifest.archives,
  });
  for (const archive of archives.values()) {
    assertReleaseTag(
      archive.version,
      manifest.tag,
      "the release manifest tag field",
    );
  }
  const result = await runReleaseGate({
    preparedPackageArchives: archives,
    repositoryRoot,
  });
  archives = await verifyPreparedPackageArchives({
    repositoryRoot,
    expectedPackageRoots: packageRoots,
    npmInvocation,
    prepared: archives,
  });
  return Object.freeze({
    archives,
    count: result.count,
    manifestPath,
    tag: manifest.tag,
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await verifyRelease();
    console.log(
      `Reverified ${result.archives.size} exact release candidate(s) against ${result.count} provenance record(s).`,
    );
    console.log(
      "Publication remains a separate trusted-workflow action using only these exact tarball paths.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
