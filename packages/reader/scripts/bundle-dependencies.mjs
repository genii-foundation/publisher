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
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const stagingRoot = join(packageRoot, "node_modules");
const markerPath = join(
  stagingRoot,
  ".genii-publisher-reader-bundle.json",
);
const packageManifestPath = join(packageRoot, "package.json");
const workspaceLockPath = join(workspaceRoot, "package-lock.json");

function assertInside(root, candidate) {
  const relativePath = relative(resolve(root), resolve(candidate));
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(
      `Refusing to modify an unsafe bundle path: ${candidate}`,
    );
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function collectClosure(lock, directNames) {
  const packages = new Map();
  const pending = [...directNames];

  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || packages.has(name)) {
      continue;
    }
    const entry = lock.packages?.[`node_modules/${name}`];
    if (
      entry === undefined ||
      entry.link === true ||
      typeof entry.version !== "string" ||
      typeof entry.resolved !== "string" ||
      typeof entry.integrity !== "string"
    ) {
      throw new Error(
        `Bundled dependency ${name} lacks an immutable lock entry.`,
      );
    }
    packages.set(name, {
      name,
      version: entry.version,
      integrity: entry.integrity,
    });
    pending.push(
      ...Object.keys({
        ...entry.dependencies,
        ...entry.optionalDependencies,
      }),
    );
  }

  return [...packages.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

async function readBundlePlan() {
  const [manifest, lock] = await Promise.all([
    readFile(packageManifestPath, "utf8").then(JSON.parse),
    readFile(workspaceLockPath, "utf8").then(JSON.parse),
  ]);
  const directNames = manifest.bundleDependencies;
  if (
    !Array.isArray(directNames) ||
    directNames.length === 0 ||
    directNames.some((name) => typeof name !== "string")
  ) {
    throw new Error(
      "bundleDependencies must name the CommonMark runtime root.",
    );
  }
  for (const name of directNames) {
    const requestedVersion = manifest.dependencies?.[name];
    const lockedVersion =
      lock.packages?.[`node_modules/${name}`]?.version;
    if (
      typeof requestedVersion !== "string" ||
      requestedVersion !== lockedVersion
    ) {
      throw new Error(
        `Bundled dependency ${name} must use its exact locked version.`,
      );
    }
  }
  return {
    format: 1,
    packageName: manifest.name,
    packageVersion: manifest.version,
    directNames: [...directNames].sort(),
    packages: collectClosure(lock, directNames),
  };
}

async function readMarker() {
  if (!(await pathExists(markerPath))) {
    throw new Error(
      `Refusing to clean unowned dependency staging directory: ${stagingRoot}`,
    );
  }
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  if (
    marker?.format !== 1 ||
    !Array.isArray(marker.packages) ||
    marker.packages.some(
      (entry) =>
        typeof entry?.name !== "string" ||
        typeof entry?.version !== "string" ||
        typeof entry?.integrity !== "string",
    )
  ) {
    throw new Error(`Dependency staging marker is invalid: ${markerPath}`);
  }
  return marker;
}

async function clean() {
  if (!(await pathExists(stagingRoot))) {
    return;
  }
  const marker = await readMarker();
  for (const entry of marker.packages) {
    const target = join(stagingRoot, ...entry.name.split("/"));
    assertInside(stagingRoot, target);
    await rm(target, { force: true, recursive: true });
  }

  for (const scope of new Set(
    marker.packages
      .map(({ name }) => name.split("/"))
      .filter((parts) => parts.length === 2)
      .map(([scopeName]) => scopeName),
  )) {
    const scopeRoot = join(stagingRoot, scope);
    assertInside(stagingRoot, scopeRoot);
    if (
      (await pathExists(scopeRoot)) &&
      (await readdir(scopeRoot)).length === 0
    ) {
      await rmdir(scopeRoot);
    }
  }

  await rm(markerPath);
  const remaining = await readdir(stagingRoot);
  if (remaining.length !== 0) {
    throw new Error(
      `Refusing to remove dependency staging root with unexpected entries: ${remaining.join(", ")}`,
    );
  }
  await rmdir(stagingRoot);
}

async function stage() {
  if (await pathExists(stagingRoot)) {
    await clean();
  }
  const plan = await readBundlePlan();
  await mkdir(stagingRoot);

  try {
    for (const entry of plan.packages) {
      const source = join(
        workspaceRoot,
        "node_modules",
        ...entry.name.split("/"),
      );
      const target = join(
        stagingRoot,
        ...entry.name.split("/"),
      );
      assertInside(join(workspaceRoot, "node_modules"), source);
      assertInside(stagingRoot, target);

      const installedManifest = JSON.parse(
        await readFile(join(source, "package.json"), "utf8"),
      );
      if (installedManifest.version !== entry.version) {
        throw new Error(
          `Installed ${entry.name} ${installedManifest.version} does not match locked ${entry.version}.`,
        );
      }
      const entries = await readdir(source);
      if (
        !entries.some((name) =>
          name.toLowerCase().startsWith("license"),
        )
      ) {
        throw new Error(
          `Bundled dependency ${entry.name} does not ship a license file.`,
        );
      }

      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, {
        dereference: true,
        recursive: true,
        verbatimSymlinks: false,
      });
    }
    await writeFile(
      markerPath,
      `${JSON.stringify(plan, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    await writeFile(
      markerPath,
      `${JSON.stringify(plan, null, 2)}\n`,
      "utf8",
    );
    await clean();
    throw error;
  }
}

const action = process.argv[2];
if (action === "stage") {
  await stage();
} else if (action === "clean") {
  await clean();
} else {
  throw new Error(
    "Expected bundle-dependencies action: stage or clean.",
  );
}
