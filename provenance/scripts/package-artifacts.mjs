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
  execFileSync,
  spawnSync,
} from "node:child_process";
import {
  constants as fileSystemConstants,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  maximumArchiveBytes,
  maximumArchiveEntries,
  parsePackedManifestJson,
  readPackageArchive,
  sha256,
} from "./archive-reader.mjs";

const temporaryRootPrefix = "publisher-package-artifacts-";
const internalPackagePrefix = "@genii-foundation/";
const maximumPackedManifestBytes = 1024 * 1024;
const npmInvocationStates = new WeakMap();
const preparedArchiveStates = new WeakMap();
const archiveMapStates = new WeakMap();

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalPackageRoot(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    isAbsolute(value)
  ) {
    throw new Error(
      `Package root must be a nonempty relative repository path: ${JSON.stringify(value)}`,
    );
  }
  const withoutTrailingSlash = value.endsWith("/")
    ? value.slice(0, -1)
    : value;
  const segments = withoutTrailingSlash.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw new Error(
      `Package root is not canonical: ${JSON.stringify(value)}`,
    );
  }
  return `${segments.join("/")}/`;
}

function canonicalPackageRoots(values) {
  if (!Array.isArray(values)) {
    throw new Error("packageRoots must be an array.");
  }
  const roots = values.map(canonicalPackageRoot);
  const seen = new Set();
  for (const root of roots) {
    if (seen.has(root)) {
      throw new Error(`Duplicate package root ${root}`);
    }
    seen.add(root);
  }
  return roots;
}

function containedPath(repositoryRoot, repositoryPath, label) {
  const absolutePath = resolve(repositoryRoot, repositoryPath);
  const relativePath = relative(repositoryRoot, absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} escapes the repository: ${repositoryPath}`);
  }
  return absolutePath;
}

function assertRegularFile(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
  return stat;
}

function assertDirectory(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${path}`);
  }
  return stat;
}

function assertOutsideRepository(repositoryRoot, path, label) {
  const relativePath = relative(repositoryRoot, path);
  if (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." &&
      !isAbsolute(relativePath))
  ) {
    throw new Error(`${label} must be outside the source checkout.`);
  }
}

function exactNpmVersion(packageManifest) {
  const manager = packageManifest.packageManager;
  if (
    typeof manager !== "string" ||
    !manager.startsWith("npm@") ||
    manager.length === "npm@".length
  ) {
    throw new Error(
      "The repository packageManager must pin one exact npm version.",
    );
  }
  const version = manager.slice("npm@".length);
  if (packageManifest.engines?.npm !== version) {
    throw new Error(
      `packageManager ${manager} does not match engines.npm ${JSON.stringify(packageManifest.engines?.npm)}.`,
    );
  }
  return version;
}

function environmentWithExactNpm(state) {
  const environment = {
    ...state.environment,
    npm_execpath: state.cliPath,
    npm_node_execpath: state.nodePath,
  };
  const pathName =
    Object.hasOwn(environment, "PATH")
      ? "PATH"
      : Object.hasOwn(environment, "Path")
        ? "Path"
        : "PATH";
  const existingPath = environment[pathName];
  environment[pathName] =
    typeof existingPath === "string" && existingPath.length > 0
      ? `${state.binaryDirectory}${sep === "\\" ? ";" : ":"}${existingPath}`
      : state.binaryDirectory;
  return environment;
}

function runExactNpm(npmInvocation, arguments_, {
  cwd,
  label,
}) {
  const state = npmInvocationStates.get(npmInvocation);
  if (state === undefined) {
    throw new Error("npmInvocation was not created by resolveExactNpmInvocation.");
  }
  const result = spawnSync(
    state.nodePath,
    [state.cliPath, ...arguments_],
    {
      cwd,
      encoding: "utf8",
      env: environmentWithExactNpm(state),
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${label} exited with status ${result.status ?? "unknown"}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

export function resolveExactNpmInvocation({
  repositoryRoot,
  environment = process.env,
  processExecPath = process.execPath,
}) {
  const resolvedRepositoryRoot = realpathSync(resolve(repositoryRoot));
  assertDirectory(resolvedRepositoryRoot, "Repository root");
  const manifestPath = join(resolvedRepositoryRoot, "package.json");
  assertRegularFile(manifestPath, "Repository package manifest");
  const packageManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const expectedVersion = exactNpmVersion(packageManifest);
  const configuredCliPath = environment.npm_execpath;
  if (
    typeof configuredCliPath !== "string" ||
    configuredCliPath.length === 0 ||
    !isAbsolute(configuredCliPath)
  ) {
    throw new Error(
      "npm_execpath must identify the absolute npm CLI that invoked this process.",
    );
  }
  const cliPath = realpathSync(configuredCliPath);
  assertRegularFile(cliPath, "npm_execpath");
  const configuredNodePath = environment.npm_node_execpath;
  if (
    typeof configuredNodePath !== "string" ||
    configuredNodePath.length === 0 ||
    !isAbsolute(configuredNodePath)
  ) {
    throw new Error(
      "npm_node_execpath must identify the absolute Node executable that invoked npm.",
    );
  }
  if (!isAbsolute(processExecPath)) {
    throw new Error("processExecPath must be absolute.");
  }
  const nodePath = realpathSync(processExecPath);
  assertRegularFile(nodePath, "Node executable");
  const npmNodePath = realpathSync(configuredNodePath);
  assertRegularFile(npmNodePath, "npm_node_execpath");
  if (npmNodePath !== nodePath) {
    throw new Error(
      "npm_node_execpath does not match the current Node executable.",
    );
  }
  const versionResult = spawnSync(
    nodePath,
    [cliPath, "--version"],
    {
      cwd: resolvedRepositoryRoot,
      encoding: "utf8",
      env: environment,
      maxBuffer: 1024 * 1024,
    },
  );
  if (versionResult.error !== undefined) {
    throw versionResult.error;
  }
  if (versionResult.status !== 0) {
    throw new Error(
      `Exact npm version check exited with status ${versionResult.status ?? "unknown"}: ${versionResult.stderr}`,
    );
  }
  const version = versionResult.stdout.trim();
  if (version !== expectedVersion) {
    throw new Error(
      `Invoking npm ${version} does not match exact repository pin ${expectedVersion}.`,
    );
  }
  const invocation = Object.freeze({
    cliPath,
    nodePath,
    npmVersion: version,
    repositoryRoot: resolvedRepositoryRoot,
  });
  npmInvocationStates.set(invocation, {
    binaryDirectory: dirname(nodePath),
    cliPath,
    environment: { ...environment },
    nodePath,
    npmVersion: version,
    repositoryRoot: resolvedRepositoryRoot,
  });
  return invocation;
}

function listRepositoryFiles(repositoryRoot) {
  const output = execFileSync(
    "git",
    [
      "-C",
      repositoryRoot,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  const files = output
    .split("\0")
    .filter(Boolean)
    .sort(compareText);
  if (new Set(files).size !== files.length) {
    throw new Error("Git returned duplicate repository paths.");
  }
  return files;
}

function snapshotRepositoryFiles(repositoryRoot, files) {
  return files.map((repositoryPath) => {
    const path = containedPath(
      repositoryRoot,
      repositoryPath,
      "Repository file",
    );
    if (!existsSync(path)) {
      return Object.freeze({
        exists: false,
        path: repositoryPath,
      });
    }
    const stat = assertRegularFile(path, "Repository input");
    const bytes = readFileSync(path);
    return Object.freeze({
      bytes,
      exists: true,
      mode: stat.mode & 0o777,
      path: repositoryPath,
      sha256: sha256(bytes),
    });
  });
}

function stableSnapshotIdentity(snapshot) {
  return snapshot.map((entry) =>
    entry.exists
      ? [entry.path, entry.mode, entry.sha256]
      : [entry.path, null, null]
  );
}

function materializeRepository(repositoryRoot, workspaceRoot) {
  const initialFiles = listRepositoryFiles(repositoryRoot);
  const initialSnapshot = snapshotRepositoryFiles(
    repositoryRoot,
    initialFiles,
  );
  for (const entry of initialSnapshot) {
    if (!entry.exists) {
      continue;
    }
    const destination = containedPath(
      workspaceRoot,
      entry.path,
      "Staged repository file",
    );
    mkdirSync(dirname(destination), {
      recursive: true,
    });
    writeFileSync(destination, entry.bytes, {
      flag: "wx",
      mode: entry.mode,
    });
    chmodSync(destination, entry.mode);
  }
  const finalFiles = listRepositoryFiles(repositoryRoot);
  const finalSnapshot = snapshotRepositoryFiles(
    repositoryRoot,
    finalFiles,
  );
  if (
    JSON.stringify(initialFiles) !== JSON.stringify(finalFiles) ||
    JSON.stringify(stableSnapshotIdentity(initialSnapshot)) !==
      JSON.stringify(stableSnapshotIdentity(finalSnapshot))
  ) {
    throw new Error(
      "The source checkout changed while the package workspace was staged.",
    );
  }
}

function parsePackageManifests(workspaceRoot, packageRoots) {
  const packages = packageRoots.map((root) => {
    const packageRoot = containedPath(
      workspaceRoot,
      root,
      "Package root",
    );
    assertDirectory(packageRoot, `Package root ${root}`);
    const manifestPath = join(packageRoot, "package.json");
    assertRegularFile(manifestPath, `Package manifest ${root}`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      typeof manifest.name !== "string" ||
      manifest.name.length === 0 ||
      typeof manifest.version !== "string" ||
      manifest.version.length === 0
    ) {
      throw new Error(
        `Package ${root} must declare a nonempty name and version.`,
      );
    }
    return Object.freeze({
      manifest,
      packageRoot,
      root,
    });
  });
  const byName = new Map();
  for (const packageRecord of packages) {
    if (byName.has(packageRecord.manifest.name)) {
      throw new Error(
        `Duplicate package name ${packageRecord.manifest.name}`,
      );
    }
    byName.set(packageRecord.manifest.name, packageRecord);
  }
  return {
    byName,
    packages,
  };
}

function internalDependencies(manifest) {
  const names = new Set();
  for (const dependencies of [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ]) {
    if (dependencies === undefined) {
      continue;
    }
    for (const name of Object.keys(dependencies)) {
      if (name.startsWith(internalPackagePrefix)) {
        names.add(name);
      }
    }
  }
  return [...names].sort(compareText);
}

function topologicalPackageOrder(
  packageRecords,
  byName,
  {
    requireComplete = true,
  } = {},
) {
  const dependenciesByName = new Map();
  const dependentsByName = new Map();
  for (const packageRecord of packageRecords) {
    const packageName = packageRecord.manifest.name;
    const dependencies = internalDependencies(packageRecord.manifest);
    const presentDependencies = [];
    for (const dependencyName of dependencies) {
      const dependency = byName.get(dependencyName);
      if (dependency === undefined) {
        if (requireComplete) {
          throw new Error(
            `Package ${packageName} depends on missing internal package ${dependencyName}.`,
          );
        }
        continue;
      }
      presentDependencies.push(dependencyName);
      const expectedVersion =
        packageRecord.manifest.dependencies?.[dependencyName] ??
        packageRecord.manifest.optionalDependencies?.[dependencyName] ??
        packageRecord.manifest.peerDependencies?.[dependencyName];
      if (expectedVersion !== dependency.manifest.version) {
        throw new Error(
          `Package ${packageName} must depend on exact ${dependencyName} version ${dependency.manifest.version}, found ${JSON.stringify(expectedVersion)}.`,
        );
      }
      const dependents = dependentsByName.get(dependencyName) ?? [];
      dependents.push(packageName);
      dependentsByName.set(dependencyName, dependents);
    }
    dependenciesByName.set(
      packageName,
      new Set(presentDependencies),
    );
  }
  const ready = packageRecords
    .filter(
      ({ manifest }) =>
        dependenciesByName.get(manifest.name)?.size === 0,
    )
    .map(({ manifest }) => manifest.name)
    .sort(compareText);
  const ordered = [];
  while (ready.length > 0) {
    const packageName = ready.shift();
    const packageRecord = byName.get(packageName);
    if (packageRecord === undefined) {
      throw new Error(`Missing package record for ${packageName}.`);
    }
    ordered.push(packageRecord);
    const dependents = (
      dependentsByName.get(packageName) ?? []
    ).sort(compareText);
    for (const dependentName of dependents) {
      const dependencies = dependenciesByName.get(dependentName);
      dependencies?.delete(packageName);
      if (dependencies?.size === 0) {
        ready.push(dependentName);
        ready.sort(compareText);
      }
    }
  }
  if (ordered.length !== packageRecords.length) {
    const cyclic = packageRecords
      .map(({ manifest }) => manifest.name)
      .filter(
        (name) =>
          (dependenciesByName.get(name)?.size ?? 0) > 0,
      )
      .sort(compareText);
    throw new Error(
      `Internal package dependency cycle: ${cyclic.join(", ")}`,
    );
  }
  return ordered;
}

function archivePackageFiles(entries) {
  return entries
    .filter((entry) => entry.type === "file")
    .map((entry) => entry.path.slice("package/".length))
    .sort(compareText);
}

export async function inspectPackageArchive({
  archivePath,
  expectedIdentity,
  root,
}) {
  const canonicalRoot = canonicalPackageRoot(root);
  const archive = await readPackageArchive({
    archivePath,
    captureFile: ({ path }) =>
      path === "package/package.json",
    expectedIdentity,
  });
  const manifestEntry = archive.entries.find(
    ({ path }) => path === "package/package.json",
  );
  if (
    manifestEntry === undefined ||
    manifestEntry.type !== "file" ||
    manifestEntry.bytes === undefined
  ) {
    throw new Error(
      `Package archive omits package/package.json: ${archive.archivePath}`,
    );
  }
  if (manifestEntry.size > maximumPackedManifestBytes) {
    throw new Error(
      `Packed package manifest exceeds ${maximumPackedManifestBytes} bytes: ${archive.archivePath}`,
    );
  }
  const manifest = parsePackedManifestJson(
    manifestEntry.bytes,
    archive.archivePath,
  );
  // Every rejection from here down names the archive. An audit inspects several
  // candidates, so a diagnostic that omits which one failed, or that blames a
  // trusted caller argument for attacker-supplied manifest content, is not
  // usable evidence. A manifest body of `null` is a valid JSON document, so the
  // object shape has to be asserted before any property is read.
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    throw new Error(
      `Packed manifest in ${archive.archivePath} is not a JSON object.`,
    );
  }
  if (
    typeof manifest.name !== "string" ||
    manifest.name.length === 0 ||
    typeof manifest.version !== "string" ||
    manifest.version.length === 0
  ) {
    throw new Error(
      `Packed manifest in ${archive.archivePath} lacks a valid name or version.`,
    );
  }
  const declaredRepository = manifest.repository;
  if (
    declaredRepository === null ||
    typeof declaredRepository !== "object" ||
    Array.isArray(declaredRepository) ||
    typeof declaredRepository.directory !== "string" ||
    declaredRepository.directory.length === 0
  ) {
    // npm also accepts a shorthand string repository, which cannot carry the
    // directory a workspace package must declare.
    throw new Error(
      `Packed manifest in ${archive.archivePath} does not declare a repository directory.`,
    );
  }
  let repositoryDirectory;
  try {
    repositoryDirectory = canonicalPackageRoot(
      declaredRepository.directory,
    );
  } catch (error) {
    throw new Error(
      `Packed manifest in ${archive.archivePath} declares an unusable repository directory ${JSON.stringify(declaredRepository.directory)}.`,
      { cause: error },
    );
  }
  if (repositoryDirectory !== canonicalRoot) {
    throw new Error(
      `Packed repository directory ${repositoryDirectory} does not match package root ${canonicalRoot}.`,
    );
  }
  return Object.freeze({
    archivePath: archive.archivePath,
    candidateDirectory: archive.candidateDirectory,
    fileCount: archive.fileCount,
    files: archive.files,
    integrity: archive.integrity,
    name: manifest.name,
    packageFiles: Object.freeze(
      archivePackageFiles(archive.entries),
    ),
    root: canonicalRoot,
    sha256: archive.sha256,
    shasum: archive.shasum,
    size: archive.size,
    version: manifest.version,
  });
}

function equalArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertPackResult(
  packResult,
  physical,
  sourceManifest,
) {
  if (
    packResult.name !== sourceManifest.name ||
    packResult.version !== sourceManifest.version ||
    physical.name !== sourceManifest.name ||
    physical.version !== sourceManifest.version
  ) {
    throw new Error(
      `Packed identity ${physical.name}@${physical.version} does not match source ${sourceManifest.name}@${sourceManifest.version}.`,
    );
  }
  if (
    packResult.integrity !== physical.integrity ||
    packResult.shasum !== physical.shasum
  ) {
    throw new Error(
      `npm pack hashes do not match physical archive ${physical.archivePath}.`,
    );
  }
  const reportedFiles = (packResult.files ?? [])
    .map(({ path }) => path)
    .sort(compareText);
  if (!equalArray(reportedFiles, physical.packageFiles)) {
    throw new Error(
      `npm pack inventory does not match physical archive ${physical.archivePath}.`,
    );
  }
}

async function inspectPackedResult({
  candidateDirectory,
  output,
  packageRecord,
}) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error("npm pack did not return valid JSON.", {
      cause: error,
    });
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("npm pack must return exactly one package result.");
  }
  const packResult = parsed[0];
  if (
    typeof packResult.filename !== "string" ||
    basename(packResult.filename) !== packResult.filename
  ) {
    throw new Error(
      `npm pack returned an unsafe filename ${JSON.stringify(packResult.filename)}.`,
    );
  }
  const archivePath = join(
    candidateDirectory,
    packResult.filename,
  );
  const physical = await inspectPackageArchive({
    archivePath,
    root: packageRecord.root,
  });
  if (dirname(physical.archivePath) !== realpathSync(candidateDirectory)) {
    throw new Error("npm pack archive escaped the candidate directory.");
  }
  assertPackResult(
    packResult,
    physical,
    packageRecord.manifest,
  );
  return physical;
}

function sameArchive(left, right) {
  return (
    left.root === right.root &&
    left.name === right.name &&
    left.version === right.version &&
    left.sha256 === right.sha256 &&
    left.integrity === right.integrity &&
    left.shasum === right.shasum &&
    left.size === right.size &&
    left.fileCount === right.fileCount &&
    equalArray(left.files, right.files) &&
    equalArray(left.packageFiles, right.packageFiles)
  );
}

function validateOutputDirectory(repositoryRoot, outputDirectory) {
  const resolvedOutput = realpathSync(resolve(outputDirectory));
  assertOutsideRepository(
    repositoryRoot,
    resolvedOutput,
    "Package output directory",
  );
  assertDirectory(resolvedOutput, "Package output directory");
  if (readdirSync(resolvedOutput).length !== 0) {
    throw new Error("Package output directory must be empty.");
  }
  return resolvedOutput;
}

async function promoteArchives(
  archives,
  outputDirectory,
) {
  if (readdirSync(outputDirectory).length !== 0) {
    throw new Error(
      "Package output directory changed before archive promotion.",
    );
  }
  const promotedPaths = [];
  try {
    const promoted = [];
    for (const archive of archives) {
      const destination = join(
        outputDirectory,
        basename(archive.archivePath),
      );
      copyFileSync(
        archive.archivePath,
        destination,
        fileSystemConstants.COPYFILE_EXCL,
      );
      promotedPaths.push(destination);
      const physical = await inspectPackageArchive({
        archivePath: destination,
        expectedIdentity: archive,
        root: archive.root,
      });
      if (!sameArchive(archive, physical)) {
        throw new Error(
          `Promoted package archive changed bytes: ${destination}`,
        );
      }
      chmodSync(destination, 0o400);
      promoted.push(physical);
    }
    return promoted;
  } catch (error) {
    for (const path of promotedPaths) {
      if (
        existsSync(path) &&
        dirname(resolve(path)) === outputDirectory
      ) {
        unlinkSync(path);
      }
    }
    throw error;
  }
}

function removeOwnedTemporaryRoot(path) {
  if (!existsSync(path)) {
    return;
  }
  const resolvedTemporaryDirectory = realpathSync(tmpdir());
  const resolvedPath = realpathSync(path);
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    dirname(resolvedPath) !== resolvedTemporaryDirectory ||
    !basename(resolvedPath).startsWith(temporaryRootPrefix)
  ) {
    throw new Error(
      `Refusing to remove unowned package-artifact path: ${resolvedPath}`,
    );
  }
  rmSync(resolvedPath, {
    force: true,
    recursive: true,
  });
}

function cleanupAfterFailure(temporaryRoot, error) {
  try {
    removeOwnedTemporaryRoot(temporaryRoot);
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      "Package preparation and owned temporary cleanup both failed.",
    );
  }
  throw error;
}

function removeOwnedPromotedArchives(state) {
  if (
    state.outputDirectory === undefined ||
    state.promotedFileIdentities.size === 0
  ) {
    return;
  }
  const outputDirectory = state.outputDirectory;
  assertDirectory(
    outputDirectory,
    "Promoted package output directory",
  );
  if (realpathSync(outputDirectory) !== outputDirectory) {
    throw new Error(
      `Promoted package output directory changed identity: ${outputDirectory}`,
    );
  }
  assertOutsideRepository(
    state.repositoryRoot,
    outputDirectory,
    "Promoted package output directory",
  );
  for (const [path, identity] of state.promotedFileIdentities) {
    if (!existsSync(path)) {
      continue;
    }
    if (
      dirname(path) !== outputDirectory ||
      realpathSync(dirname(path)) !== outputDirectory
    ) {
      throw new Error(
        `Refusing to remove promoted archive outside its owned directory: ${path}`,
      );
    }
    const stat = assertRegularFile(
      path,
      "Promoted package archive",
    );
    if (
      stat.nlink !== 1 ||
      stat.dev !== identity.dev ||
      stat.ino !== identity.ino
    ) {
      throw new Error(
        `Refusing to remove a replaced promoted package archive: ${path}`,
      );
    }
  }
  for (const path of state.promotedFileIdentities.keys()) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}

function disposePreparedState(state, {
  removePromoted,
}) {
  let removalError;
  if (removePromoted && !state.discarded) {
    try {
      removeOwnedPromotedArchives(state);
      state.discarded = true;
    } catch (error) {
      removalError = error;
    }
  }
  try {
    if (!state.disposed) {
      removeOwnedTemporaryRoot(state.temporaryRoot);
      state.disposed = true;
    }
  } catch (cleanupError) {
    if (removalError !== undefined) {
      throw new AggregateError(
        [removalError, cleanupError],
        "Promoted archive discard and temporary cleanup both failed.",
      );
    }
    throw cleanupError;
  }
  if (removalError !== undefined) {
    throw removalError;
  }
}

export async function preparePackageArchives({
  repositoryRoot,
  packageRoots,
  npmInvocation,
  outputDirectory,
}) {
  const invocationState = npmInvocationStates.get(npmInvocation);
  if (invocationState === undefined) {
    throw new Error("npmInvocation was not created by resolveExactNpmInvocation.");
  }
  const resolvedRepositoryRoot = realpathSync(resolve(repositoryRoot));
  if (resolvedRepositoryRoot !== invocationState.repositoryRoot) {
    throw new Error(
      "npmInvocation belongs to a different repository root.",
    );
  }
  const requestedRoots = canonicalPackageRoots(packageRoots);
  if (requestedRoots.length === 0) {
    throw new Error("At least one package root is required.");
  }
  const resolvedOutput =
    outputDirectory === undefined
      ? undefined
      : validateOutputDirectory(
          resolvedRepositoryRoot,
          outputDirectory,
        );
  const temporaryRoot = realpathSync(
    mkdtempSync(
      join(tmpdir(), temporaryRootPrefix),
    ),
  );
  chmodSync(temporaryRoot, 0o700);
  try {
    const workspaceRoot = join(temporaryRoot, "workspace");
    const temporaryCandidateDirectory = join(
      temporaryRoot,
      "candidates",
    );
    mkdirSync(workspaceRoot);
    mkdirSync(temporaryCandidateDirectory);
    materializeRepository(
      resolvedRepositoryRoot,
      workspaceRoot,
    );
    runExactNpm(
      npmInvocation,
      [
        "ci",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd: workspaceRoot,
        label: "Clean package-artifact dependency installation",
      },
    );
    const {
      byName,
      packages,
    } = parsePackageManifests(
      workspaceRoot,
      requestedRoots,
    );
    const orderedPackages = topologicalPackageOrder(
      packages,
      byName,
    );
    const byRoot = new Map();
    for (const packageRecord of orderedPackages) {
      const output = runExactNpm(
        npmInvocation,
        [
          "pack",
          "--json",
          "--silent",
          "--ignore-scripts=false",
          "--pack-destination",
          temporaryCandidateDirectory,
          ".",
        ],
        {
          cwd: packageRecord.packageRoot,
          label: `Lifecycle pack ${packageRecord.root}`,
        },
      );
      const physical = await inspectPackedResult({
        candidateDirectory: temporaryCandidateDirectory,
        output,
        packageRecord,
      });
      if (byRoot.has(physical.root)) {
        throw new Error(
          `Lifecycle pack produced duplicate root ${physical.root}.`,
        );
      }
      byRoot.set(physical.root, physical);
    }
    const orderedRoots = orderedPackages.map(({ root }) => root);
    const orderedArchives = orderedRoots.map((root) => {
      const archive = byRoot.get(root);
      if (archive === undefined) {
        throw new Error(`Lifecycle pack omitted package root ${root}.`);
      }
      return archive;
    });
    const finalArchives =
      resolvedOutput === undefined
        ? orderedArchives
        : await promoteArchives(orderedArchives, resolvedOutput);
    const archiveMap = new Map(
      finalArchives.map((archive) => [
        archive.root,
        archive,
      ]),
    );
    const promotedFileIdentities = new Map(
      resolvedOutput === undefined
        ? []
        : finalArchives.map((archive) => {
            const stat = assertRegularFile(
              archive.archivePath,
              "Promoted package archive",
            );
            return [
              archive.archivePath,
              Object.freeze({
                dev: stat.dev,
                ino: stat.ino,
              }),
            ];
          }),
    );
    const prepared = Object.freeze({
      archives: archiveMap,
      candidateDirectory:
        resolvedOutput ?? temporaryCandidateDirectory,
      discard() {
        const state = preparedArchiveStates.get(prepared);
        if (state === undefined) {
          throw new Error("Unknown prepared package archive set.");
        }
        disposePreparedState(state, {
          removePromoted: true,
        });
      },
      dispose() {
        const state = preparedArchiveStates.get(prepared);
        if (state === undefined) {
          throw new Error("Unknown prepared package archive set.");
        }
        disposePreparedState(state, {
          removePromoted: false,
        });
      },
    });
    const preparedState = {
      archives: archiveMap,
      candidateDirectory:
        resolvedOutput ?? temporaryCandidateDirectory,
      discarded: false,
      disposed: false,
      npmCliPath: invocationState.cliPath,
      npmNodePath: invocationState.nodePath,
      npmVersion: invocationState.npmVersion,
      outputDirectory: resolvedOutput,
      promotedFileIdentities,
      repositoryRoot: resolvedRepositoryRoot,
      roots: orderedRoots,
      temporaryRoot,
    };
    preparedArchiveStates.set(prepared, preparedState);
    archiveMapStates.set(archiveMap, preparedState);
    return prepared;
  } catch (error) {
    return cleanupAfterFailure(temporaryRoot, error);
  }
}

function assertInvocationMatchesPrepared(
  npmInvocation,
  preparedState,
) {
  const invocationState = npmInvocationStates.get(npmInvocation);
  if (invocationState === undefined) {
    throw new Error("npmInvocation was not created by resolveExactNpmInvocation.");
  }
  if (
    invocationState.repositoryRoot !== preparedState.repositoryRoot ||
    invocationState.cliPath !== preparedState.npmCliPath ||
    invocationState.nodePath !== preparedState.npmNodePath ||
    invocationState.npmVersion !== preparedState.npmVersion
  ) {
    throw new Error(
      "Prepared package archives belong to a different exact npm invocation.",
    );
  }
}

function validateRetainedCandidateDirectory(
  repositoryRoot,
  candidateDirectory,
) {
  if (
    typeof candidateDirectory !== "string" ||
    candidateDirectory.length === 0 ||
    !isAbsolute(candidateDirectory)
  ) {
    throw new Error(
      "Every retained package archive must identify one absolute candidateDirectory.",
    );
  }
  const requestedDirectory = resolve(candidateDirectory);
  assertDirectory(
    requestedDirectory,
    "Retained package candidate directory",
  );
  const resolvedDirectory = realpathSync(requestedDirectory);
  if (resolvedDirectory !== requestedDirectory) {
    throw new Error(
      `Retained package candidate directory must not traverse a symbolic link: ${requestedDirectory}`,
    );
  }
  assertOutsideRepository(
    repositoryRoot,
    resolvedDirectory,
    "Retained package candidate directory",
  );
  return resolvedDirectory;
}

function retainedCandidateDirectory(
  repositoryRoot,
  archives,
  ownedState,
) {
  const declaredDirectories = new Set();
  for (const archive of archives.values()) {
    if (
      archive === null ||
      typeof archive !== "object"
    ) {
      throw new Error(
        "Retained package archive descriptors must be objects.",
      );
    }
    declaredDirectories.add(archive.candidateDirectory);
  }
  if (declaredDirectories.size !== 1) {
    throw new Error(
      "Retained package archives must share exactly one candidateDirectory.",
    );
  }
  const [declaredDirectory] = declaredDirectories;
  const candidateDirectory =
    validateRetainedCandidateDirectory(
      repositoryRoot,
      declaredDirectory,
    );
  if (
    ownedState !== undefined &&
    candidateDirectory !== ownedState.candidateDirectory
  ) {
    throw new Error(
      "Prepared package archives escaped their owned candidate directory.",
    );
  }
  return candidateDirectory;
}

// Bounded shape validation for a retained descriptor. This deliberately performs
// no filesystem read: the descriptor's claimed identity is carried into the
// single streamed inspection as `expectedIdentity`, so the archive is opened,
// hashed, and parsed exactly once. The previous flow hashed the file here and
// then reopened it to parse, which left a window in which the verified bytes and
// the parsed bytes could differ.
function assertRetainedDescriptorShape(
  archive,
  candidateDirectory,
) {
  if (
    typeof archive.archivePath !== "string" ||
    archive.archivePath.length === 0 ||
    !isAbsolute(archive.archivePath)
  ) {
    throw new Error(
      "Retained package archive paths must be absolute.",
    );
  }
  const archivePath = resolve(archive.archivePath);
  if (
    dirname(archivePath) !== candidateDirectory ||
    archive.candidateDirectory !== candidateDirectory
  ) {
    throw new Error(
      `Retained package archive is outside its candidate directory: ${archivePath}`,
    );
  }
  if (
    !Number.isSafeInteger(archive.size) ||
    archive.size < 1 ||
    archive.size > maximumArchiveBytes
  ) {
    throw new Error(
      `Retained package archive size is outside the accepted range: ${archivePath}`,
    );
  }
  if (
    !Number.isSafeInteger(archive.fileCount) ||
    archive.fileCount < 1 ||
    archive.fileCount > maximumArchiveEntries
  ) {
    throw new Error(
      `Retained package archive entry count is outside the accepted range: ${archivePath}`,
    );
  }
  for (const field of ["sha256", "integrity", "shasum"]) {
    if (
      typeof archive[field] !== "string" ||
      archive[field].length === 0
    ) {
      throw new Error(
        `Retained package archive ${field} is missing: ${archivePath}`,
      );
    }
  }
  if (
    !Array.isArray(archive.files) ||
    archive.files.length !== archive.fileCount
  ) {
    throw new Error(
      `Retained package archive inventory does not match its entry count: ${archivePath}`,
    );
  }
}

function assertSourcePackageIdentity(
  repositoryRoot,
  root,
  physical,
) {
  const packageRoot = containedPath(
    repositoryRoot,
    root,
    "Source package root",
  );
  assertDirectory(packageRoot, `Source package root ${root}`);
  const manifestPath = join(packageRoot, "package.json");
  assertRegularFile(
    manifestPath,
    `Source package manifest ${root}`,
  );
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  );
  const repositoryDirectory =
    canonicalPackageRoot(
      manifest.repository?.directory,
    );
  if (
    manifest.name !== physical.name ||
    manifest.version !== physical.version ||
    repositoryDirectory !== root
  ) {
    throw new Error(
      `Physical archive ${physical.name}@${physical.version} does not match current source identity for ${root}.`,
    );
  }
}

export async function verifyPreparedPackageArchives({
  repositoryRoot,
  expectedPackageRoots,
  npmInvocation,
  prepared,
}) {
  const wrapperState = preparedArchiveStates.get(prepared);
  const archives =
    prepared instanceof Map
      ? prepared
      : wrapperState?.archives;
  if (!(archives instanceof Map)) {
    throw new Error(
      "prepared must be a retained package archive Map or a preparation returned by preparePackageArchives.",
    );
  }
  const state =
    archiveMapStates.get(archives) ??
    wrapperState;
  const resolvedRepositoryRoot = realpathSync(resolve(repositoryRoot));
  assertDirectory(
    resolvedRepositoryRoot,
    "Repository root",
  );
  const invocationState = npmInvocationStates.get(npmInvocation);
  if (invocationState === undefined) {
    throw new Error(
      "npmInvocation was not created by resolveExactNpmInvocation.",
    );
  }
  if (
    invocationState.repositoryRoot !== resolvedRepositoryRoot
  ) {
    throw new Error(
      "npmInvocation belongs to a different repository root.",
    );
  }
  if (state !== undefined) {
    if (resolvedRepositoryRoot !== state.repositoryRoot) {
      throw new Error(
        "Prepared package archives belong to a different repository root.",
      );
    }
    assertInvocationMatchesPrepared(npmInvocation, state);
    if (
      state.discarded ||
      (
        state.disposed &&
        state.outputDirectory === undefined
      )
    ) {
      throw new Error(
        "Temporary prepared package archives have been disposed.",
      );
    }
  }
  const expectedRoots = canonicalPackageRoots(
    expectedPackageRoots,
  );
  if (expectedRoots.length === 0) {
    throw new Error(
      "At least one expected package root is required.",
    );
  }
  const actualRoots = [];
  for (const [key, archive] of archives) {
    const canonicalKey = canonicalPackageRoot(key);
    if (canonicalKey !== key) {
      throw new Error(
        `Retained package archive Map key is not canonical: ${JSON.stringify(key)}`,
      );
    }
    if (
      archive === null ||
      typeof archive !== "object" ||
      archive.root !== key
    ) {
      throw new Error(
        `Retained package archive root does not match Map key ${key}.`,
      );
    }
    actualRoots.push(key);
  }
  const expectedSet = [...expectedRoots].sort(compareText);
  const actualSet = [...actualRoots].sort(compareText);
  if (!equalArray(expectedSet, actualSet)) {
    throw new Error(
      `Prepared package root set mismatch. Expected ${expectedSet.join(", ")}, received ${actualSet.join(", ")}.`,
    );
  }
  const candidateDirectory =
    retainedCandidateDirectory(
      resolvedRepositoryRoot,
      archives,
      state,
    );
  const {
    byName,
    packages,
  } = parsePackageManifests(
    resolvedRepositoryRoot,
    expectedRoots,
  );
  const orderedRoots = topologicalPackageOrder(
    packages,
    byName,
    {
      requireComplete: false,
    },
  ).map(({ root }) => root);
  const verified = new Map();
  for (const root of orderedRoots) {
    const stored = archives.get(root);
    if (stored === undefined) {
      throw new Error(`Prepared package root ${root} is missing.`);
    }
    assertRetainedDescriptorShape(
      stored,
      candidateDirectory,
    );
    const physical = await inspectPackageArchive({
      archivePath: stored.archivePath,
      expectedIdentity: stored,
      root,
    });
    if (
      physical.candidateDirectory !== candidateDirectory ||
      stored.archivePath !== physical.archivePath ||
      stored.candidateDirectory !==
        physical.candidateDirectory ||
      !sameArchive(stored, physical)
    ) {
      throw new Error(
        `Prepared package archive changed after preparation: ${stored.archivePath}`,
      );
    }
    assertSourcePackageIdentity(
      resolvedRepositoryRoot,
      root,
      physical,
    );
    verified.set(root, physical);
  }
  const verifiedState =
    state ?? {
      archives: verified,
      candidateDirectory,
      discarded: false,
      disposed: false,
      npmCliPath: invocationState.cliPath,
      npmNodePath: invocationState.nodePath,
      npmVersion: invocationState.npmVersion,
      outputDirectory: candidateDirectory,
      promotedFileIdentities: new Map(),
      repositoryRoot: resolvedRepositoryRoot,
      roots: orderedRoots,
      temporaryRoot: undefined,
    };
  archiveMapStates.set(verified, verifiedState);
  return verified;
}
