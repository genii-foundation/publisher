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
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  opendirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const SCANNER_IDENTITY_ALGORITHM =
  "sha256-scanner-runtime-closure-v1";
export const SCANNER_IDENTITY_MAX_FILES = 1024;

const maximumFileBytes = 64 * 1024 * 1024;
const maximumTotalBytes = 256 * 1024 * 1024;
const maximumDirectories = 4096;
const maximumDirectoryEntries = 8192;
const maximumEntriesPerDirectory = 2048;
const maximumNameBytes = 1024 * 1024;
const maximumPackages = 128;
const tarStreamName = "tar-stream";
const tarStreamVersion = "3.2.0";
const scannerInputPaths = Object.freeze(
  [
    "package-lock.json",
    "package.json",
    "provenance/receipt.schema.json",
    "provenance/record.schema.json",
    "provenance/scripts/archive-reader.mjs",
    "provenance/scripts/audit.mjs",
    "provenance/scripts/package-artifacts.mjs",
    "provenance/scripts/scanner-identity.mjs",
    "provenance/scripts/stable-claims.mjs",
    "provenance/scripts/validate.mjs",
  ].sort(compareText),
);

export const SCANNER_IDENTITY_INPUT_PATHS =
  scannerInputPaths;

function compareText(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sha256(value) {
  return `sha256:${createHash("sha256")
    .update(value)
    .digest("hex")}`;
}

function isContained(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (
      pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent)
    )
  );
}

function repositoryPath(repositoryRoot, absolutePath) {
  if (!isContained(repositoryRoot, absolutePath)) {
    throw new Error(
      `Scanner identity path escapes the repository: ${absolutePath}`,
    );
  }
  const path = relative(repositoryRoot, absolutePath)
    .split(sep)
    .join("/");
  if (
    path.length === 0 ||
    path
      .split("/")
      .some(
        (segment) =>
          segment.length === 0 ||
          segment === "." ||
          segment === ".." ||
          /[\u0000-\u001f\u007f\\]/u.test(segment),
      )
  ) {
    throw new Error(
      `Scanner identity path is not portable: ${path}`,
    );
  }
  return path;
}

function assertSameFileState(before, after, path) {
  const fields = [
    "dev",
    "ino",
    "mode",
    "nlink",
    "size",
    "mtimeNs",
    "ctimeNs",
  ];
  if (
    fields.some((field) => before[field] !== after[field])
  ) {
    throw new Error(
      `Scanner identity input changed while it was read: ${path}`,
    );
  }
}

function assertCanonicalDirectory(
  context,
  requestedPath,
) {
  const path = resolve(requestedPath);
  if (!isContained(context.repositoryRoot, path)) {
    throw new Error(
      `Scanner dependency directory escapes the repository: ${path}`,
    );
  }
  const stat = lstatSync(path, {
    bigint: true,
  });
  if (!stat.isDirectory()) {
    throw new Error(
      `Scanner dependency directory is not a real directory: ${path}`,
    );
  }
  if (stat.dev !== context.repositoryDevice) {
    throw new Error(
      `Scanner dependency directory crosses a filesystem boundary: ${path}`,
    );
  }
  if (realpathSync(path) !== path) {
    throw new Error(
      `Scanner dependency directory contains a symbolic link: ${path}`,
    );
  }
  return Object.freeze({
    path,
    stat,
  });
}

function readStableFile(context, requestedPath) {
  const path = resolve(requestedPath);
  if (!isContained(context.repositoryRoot, path)) {
    throw new Error(
      `Scanner identity file escapes the repository: ${path}`,
    );
  }
  const before = lstatSync(path, {
    bigint: true,
  });
  if (!before.isFile()) {
    throw new Error(
      `Scanner identity input is not a regular file: ${path}`,
    );
  }
  if (before.nlink !== 1n) {
    throw new Error(
      `Scanner identity input must not be hard linked: ${path}`,
    );
  }
  if (before.dev !== context.repositoryDevice) {
    throw new Error(
      `Scanner identity input crosses a filesystem boundary: ${path}`,
    );
  }
  if (before.size > BigInt(maximumFileBytes)) {
    throw new Error(
      `Scanner identity input exceeds ${maximumFileBytes} bytes: ${path}`,
    );
  }
  if (realpathSync(path) !== path) {
    throw new Error(
      `Scanner identity input contains a symbolic link: ${path}`,
    );
  }

  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(
    path,
    fsConstants.O_RDONLY | noFollow,
  );
  let bytes;
  try {
    const opened = fstatSync(descriptor, {
      bigint: true,
    });
    assertSameFileState(before, opened, path);
    bytes = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor, {
      bigint: true,
    });
    assertSameFileState(opened, afterRead, path);
  } finally {
    closeSync(descriptor);
  }

  const afterClose = lstatSync(path, {
    bigint: true,
  });
  assertSameFileState(before, afterClose, path);
  return Object.freeze({
    bytes,
    path,
    state: afterClose,
  });
}

function readIdentityFile(context, requestedPath) {
  const path = resolve(requestedPath);
  const cached = context.filesByPath.get(path);
  if (cached !== undefined) {
    return cached;
  }
  const snapshot = readStableFile(context, path);
  const { bytes } = snapshot;
  context.totalBytes += bytes.byteLength;
  if (context.totalBytes > maximumTotalBytes) {
    throw new Error(
      `Scanner identity inputs exceed ${maximumTotalBytes} aggregate bytes.`,
    );
  }
  const record = Object.freeze({
    bytes,
    path,
    repositoryPath: repositoryPath(
      context.repositoryRoot,
      path,
    ),
    sha256: sha256(bytes),
    state: snapshot.state,
  });
  context.filesByPath.set(path, record);
  return record;
}

function parseJsonFile(context, path, label) {
  const record = readIdentityFile(context, path);
  let text;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(record.bytes);
  } catch (error) {
    throw new Error(`${label} is not UTF-8.`, {
      cause: error,
    });
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, {
      cause: error,
    });
  }
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return Object.freeze({
    record,
    value,
  });
}

function validatePackageName(name, label) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.includes("\\") ||
    name.includes("\u0000") ||
    (
      name.startsWith("@")
        ? name.split("/").length !== 2
        : name.includes("/")
    ) ||
    name.split("/").some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw new Error(`${label} contains an invalid package name.`);
  }
}

function runtimeDependencies(manifest, label) {
  const required = new Set();
  const optional = new Set();
  if (manifest.dependencies !== undefined) {
    if (!isPlainObject(manifest.dependencies)) {
      throw new Error(`${label}.dependencies must be an object.`);
    }
    for (
      const [name, range] of Object.entries(
        manifest.dependencies,
      )
    ) {
      validatePackageName(name, `${label}.dependencies`);
      if (typeof range !== "string" || range.length === 0) {
        throw new Error(
          `${label}.dependencies.${name} must be a nonempty string.`,
        );
      }
      required.add(name);
    }
  }
  if (manifest.optionalDependencies !== undefined) {
    if (!isPlainObject(manifest.optionalDependencies)) {
      throw new Error(
        `${label}.optionalDependencies must be an object.`,
      );
    }
    for (
      const [name, range] of Object.entries(
        manifest.optionalDependencies,
      )
    ) {
      validatePackageName(
        name,
        `${label}.optionalDependencies`,
      );
      if (typeof range !== "string" || range.length === 0) {
        throw new Error(
          `${label}.optionalDependencies.${name} must be a nonempty string.`,
        );
      }
      required.delete(name);
      optional.add(name);
    }
  }
  return Object.freeze({
    optional: [...optional].sort(compareText),
    required: [...required].sort(compareText),
  });
}

function findResolvedPackageRoot(
  context,
  parentManifestPath,
  packageName,
  optional,
) {
  const require = createRequire(parentManifestPath);
  let resolvedEntry;
  try {
    resolvedEntry = require.resolve(packageName);
  } catch (error) {
    if (optional && error?.code === "MODULE_NOT_FOUND") {
      const searchPaths = require.resolve.paths(packageName);
      const hasInstalledCandidate =
        Array.isArray(searchPaths) &&
        searchPaths.some((modulesPath) => {
          const candidate = resolve(
            modulesPath,
            packageName,
          );
          return (
            isContained(
              context.repositoryRoot,
              candidate,
            ) && existsSync(candidate)
          );
        });
      if (!hasInstalledCandidate) {
        return null;
      }
    }
    throw new Error(
      `Cannot resolve scanner runtime dependency ${packageName} from ${repositoryPath(
        context.repositoryRoot,
        parentManifestPath,
      )}.`,
      {
        cause: error,
      },
    );
  }
  if (!isAbsolute(resolvedEntry)) {
    throw new Error(
      `Scanner runtime dependency ${packageName} resolved to a non-file module.`,
    );
  }
  let physicalEntry;
  try {
    physicalEntry = realpathSync(resolvedEntry);
  } catch (error) {
    throw new Error(
      `Cannot resolve scanner runtime dependency ${packageName} entry file.`,
      {
        cause: error,
      },
    );
  }
  const searchPaths = require.resolve.paths(packageName);
  if (!Array.isArray(searchPaths)) {
    throw new Error(
      `Scanner runtime dependency ${packageName} has no package search path.`,
    );
  }
  const matches = [];
  for (const modulesPath of searchPaths) {
    const candidate = resolve(modulesPath, packageName);
    if (!existsSync(candidate)) {
      continue;
    }
    const candidateRealPath = realpathSync(candidate);
    if (
      isContained(candidateRealPath, physicalEntry)
    ) {
      matches.push(candidate);
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `Scanner runtime dependency ${packageName} has ${matches.length} matching installed package roots.`,
    );
  }
  return assertCanonicalDirectory(
    context,
    matches[0],
  ).path;
}

function validateLockEntry(
  context,
  packageRoot,
  manifest,
) {
  const lockPath = repositoryPath(
    context.repositoryRoot,
    packageRoot,
  );
  const lockEntry = context.packageLock.packages[lockPath];
  if (!isPlainObject(lockEntry)) {
    throw new Error(
      `package-lock.json does not bind installed package ${lockPath}.`,
    );
  }
  if (
    typeof manifest.version !== "string" ||
    manifest.version.length === 0 ||
    lockEntry.version !== manifest.version
  ) {
    throw new Error(
      `Installed package ${lockPath} does not match its locked version.`,
    );
  }
  if (typeof lockEntry.integrity !== "string") {
    throw new Error(
      `Locked package ${lockPath} has no registry integrity digest.`,
    );
  }
  const integrityMatch =
    /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(
      lockEntry.integrity,
    );
  if (integrityMatch === null) {
    throw new Error(
      `Locked package ${lockPath} has an invalid registry integrity digest.`,
    );
  }
  const integrityBytes = Buffer.from(
    integrityMatch[1],
    "base64",
  );
  if (
    integrityBytes.byteLength !== 64 ||
    integrityBytes.toString("base64") !== integrityMatch[1]
  ) {
    throw new Error(
      `Locked package ${lockPath} has a noncanonical registry integrity digest.`,
    );
  }

  let resolvedUrl;
  try {
    resolvedUrl = new URL(lockEntry.resolved);
  } catch (error) {
    throw new Error(
      `Locked package ${lockPath} has no valid registry tarball URL.`,
      {
        cause: error,
      },
    );
  }
  const unscopedName = manifest.name.includes("/")
    ? manifest.name.slice(manifest.name.lastIndexOf("/") + 1)
    : manifest.name;
  const expectedPath =
    `/${manifest.name}/-/${unscopedName}-${manifest.version}.tgz`;
  if (
    resolvedUrl.origin !== "https://registry.npmjs.org" ||
    resolvedUrl.username.length !== 0 ||
    resolvedUrl.password.length !== 0 ||
    resolvedUrl.search.length !== 0 ||
    resolvedUrl.hash.length !== 0 ||
    resolvedUrl.pathname !== expectedPath
  ) {
    throw new Error(
      `Locked package ${lockPath} has an invalid registry tarball URL.`,
    );
  }
}

function collectPackageClosure(
  context,
  packageRoot,
  expectedName,
  ancestry,
) {
  if (ancestry.includes(packageRoot)) {
    throw new Error(
      `Scanner runtime dependency cycle reaches ${repositoryPath(
        context.repositoryRoot,
        packageRoot,
      )}.`,
    );
  }
  if (context.packageRoots.has(packageRoot)) {
    return;
  }
  context.discoveredPackageRoots.add(packageRoot);
  if (
    context.discoveredPackageRoots.size > maximumPackages
  ) {
    throw new Error(
      `Scanner runtime closure exceeds ${maximumPackages} packages.`,
    );
  }
  const manifestPath = join(packageRoot, "package.json");
  const { value: manifest } = parseJsonFile(
    context,
    manifestPath,
    `${expectedName} package manifest`,
  );
  if (manifest.name !== expectedName) {
    throw new Error(
      `Resolved scanner runtime dependency ${expectedName} has package name ${String(
        manifest.name,
      )}.`,
    );
  }
  validateLockEntry(context, packageRoot, manifest);
  if (
    expectedName === tarStreamName &&
    manifest.version !== tarStreamVersion
  ) {
    throw new Error(
      `Scanner requires ${tarStreamName} ${tarStreamVersion}, found ${String(
        manifest.version,
      )}.`,
    );
  }

  const nextAncestry = [...ancestry, packageRoot];
  const dependencies = runtimeDependencies(
    manifest,
    `${expectedName} package manifest`,
  );
  for (const dependencyName of dependencies.required) {
    const dependencyRoot = findResolvedPackageRoot(
      context,
      manifestPath,
      dependencyName,
      false,
    );
    collectPackageClosure(
      context,
      dependencyRoot,
      dependencyName,
      nextAncestry,
    );
  }
  for (const dependencyName of dependencies.optional) {
    const dependencyRoot = findResolvedPackageRoot(
      context,
      manifestPath,
      dependencyName,
      true,
    );
    if (dependencyRoot !== null) {
      collectPackageClosure(
        context,
        dependencyRoot,
        dependencyName,
        nextAncestry,
      );
    }
  }
  context.packageRoots.add(packageRoot);
}

function addManifestEntry(context, path) {
  const record = readIdentityFile(context, path);
  if (context.manifestPaths.has(record.repositoryPath)) {
    throw new Error(
      `Scanner identity contains duplicate file ${record.repositoryPath}.`,
    );
  }
  context.manifestPaths.add(record.repositoryPath);
  context.entries.push(
    Object.freeze({
      path: record.repositoryPath,
      sha256: record.sha256,
    }),
  );
  if (
    context.entries.length > SCANNER_IDENTITY_MAX_FILES
  ) {
    throw new Error(
      `Scanner identity exceeds ${SCANNER_IDENTITY_MAX_FILES} files.`,
    );
  }
}

function readBoundedDirectoryNames(context, path) {
  const directory = opendirSync(path);
  const names = [];
  const seenNames = new Set();
  try {
    while (true) {
      const entry = directory.readSync();
      if (entry === null) {
        break;
      }
      if (seenNames.has(entry.name)) {
        throw new Error(
          `Scanner dependency directory contains duplicate entry ${entry.name}: ${path}`,
        );
      }
      seenNames.add(entry.name);
      names.push(entry.name);
      context.directoryEntryCount += 1;
      context.nameBytes += Buffer.byteLength(
        entry.name,
        "utf8",
      );
      if (names.length > maximumEntriesPerDirectory) {
        throw new Error(
          `Scanner dependency directory contains more than ${maximumEntriesPerDirectory} entries: ${path}`,
        );
      }
      if (
        context.directoryEntryCount >
        maximumDirectoryEntries
      ) {
        throw new Error(
          `Scanner runtime closure exceeds ${maximumDirectoryEntries} directory entries.`,
        );
      }
      if (context.nameBytes > maximumNameBytes) {
        throw new Error(
          `Scanner runtime closure exceeds ${maximumNameBytes} path-name bytes.`,
        );
      }
    }
  } finally {
    directory.closeSync();
  }
  return names.sort(compareText);
}

function collectPackageFiles(
  context,
  directory,
) {
  const { path, stat } = assertCanonicalDirectory(
    context,
    directory,
  );
  const directoryIdentity = `${stat.dev}:${stat.ino}`;
  if (context.directoryIdentities.has(directoryIdentity)) {
    throw new Error(
      `Scanner dependency directory cycle or alias reaches ${path}.`,
    );
  }
  context.directoryIdentities.add(directoryIdentity);
  if (
    context.directoryIdentities.size > maximumDirectories
  ) {
    throw new Error(
      `Scanner runtime closure exceeds ${maximumDirectories} directories.`,
    );
  }
  const names = readBoundedDirectoryNames(
    context,
    path,
  );
  for (const name of names) {
    if (
      name.length === 0 ||
      name === "." ||
      name === ".." ||
      /[/\\\u0000-\u001f\u007f]/u.test(name)
    ) {
      throw new Error(
        `Scanner dependency contains a nonportable path entry in ${path}.`,
      );
    }
    if (name === "node_modules") {
      continue;
    }
    const childPath = join(path, name);
    const childStat = lstatSync(childPath, {
      bigint: true,
    });
    if (childStat.isDirectory()) {
      collectPackageFiles(
        context,
        childPath,
      );
      continue;
    }
    if (childStat.isFile()) {
      addManifestEntry(context, childPath);
      continue;
    }
    throw new Error(
      `Scanner dependency contains a symbolic link or special file: ${childPath}`,
    );
  }
}

function assertRootTarStreamPin(rootManifest, packageLock) {
  const manifestPins = [
    rootManifest.dependencies?.[tarStreamName],
    rootManifest.devDependencies?.[tarStreamName],
    rootManifest.optionalDependencies?.[tarStreamName],
  ].filter((value) => value !== undefined);
  if (
    manifestPins.length !== 1 ||
    manifestPins[0] !== tarStreamVersion
  ) {
    throw new Error(
      `Root package.json must pin ${tarStreamName} exactly to ${tarStreamVersion}.`,
    );
  }
  if (
    !isPlainObject(packageLock.packages) ||
    !isPlainObject(packageLock.packages[""])
  ) {
    throw new Error(
      "package-lock.json must contain a root packages entry.",
    );
  }
  const rootLock = packageLock.packages[""];
  const lockPins = [
    rootLock.dependencies?.[tarStreamName],
    rootLock.devDependencies?.[tarStreamName],
    rootLock.optionalDependencies?.[tarStreamName],
  ].filter((value) => value !== undefined);
  if (
    lockPins.length !== 1 ||
    lockPins[0] !== tarStreamVersion
  ) {
    throw new Error(
      `package-lock.json must pin ${tarStreamName} exactly to ${tarStreamVersion}.`,
    );
  }
}

function assertFilesUnchanged(context) {
  for (const record of context.filesByPath.values()) {
    const repeated = readStableFile(
      context,
      record.path,
    );
    assertSameFileState(
      record.state,
      repeated.state,
      record.path,
    );
    if (sha256(repeated.bytes) !== record.sha256) {
      throw new Error(
        `Scanner identity input changed bytes between verification passes: ${record.path}`,
      );
    }
  }
}

export function createScannerIdentity({
  repositoryRoot,
} = {}) {
  if (
    typeof repositoryRoot !== "string" ||
    repositoryRoot.length === 0
  ) {
    throw new TypeError(
      "createScannerIdentity requires repositoryRoot.",
    );
  }
  const requestedRoot = resolve(repositoryRoot);
  const resolvedRoot = realpathSync(requestedRoot);
  if (resolvedRoot !== requestedRoot) {
    throw new Error(
      `Scanner repository root must not contain a symbolic link: ${requestedRoot}`,
    );
  }
  const repositoryStat = lstatSync(resolvedRoot, {
    bigint: true,
  });
  if (!repositoryStat.isDirectory()) {
    throw new Error(
      `Scanner repository root is not a directory: ${resolvedRoot}`,
    );
  }
  const context = {
    directoryEntryCount: 0,
    directoryIdentities: new Set(),
    discoveredPackageRoots: new Set(),
    entries: [],
    filesByPath: new Map(),
    manifestPaths: new Set(),
    nameBytes: 0,
    packageLock: null,
    packageRoots: new Set(),
    repositoryDevice: repositoryStat.dev,
    repositoryRoot: resolvedRoot,
    totalBytes: 0,
  };

  const rootManifest = parseJsonFile(
    context,
    join(resolvedRoot, "package.json"),
    "Root package.json",
  ).value;
  const packageLock = parseJsonFile(
    context,
    join(resolvedRoot, "package-lock.json"),
    "package-lock.json",
  ).value;
  context.packageLock = packageLock;
  assertRootTarStreamPin(rootManifest, packageLock);

  for (const inputPath of scannerInputPaths) {
    addManifestEntry(
      context,
      join(resolvedRoot, ...inputPath.split("/")),
    );
  }

  const tarStreamRoot = findResolvedPackageRoot(
    context,
    join(resolvedRoot, "package.json"),
    tarStreamName,
    false,
  );
  collectPackageClosure(
    context,
    tarStreamRoot,
    tarStreamName,
    [],
  );
  const packageRoots = [...context.packageRoots].sort(
    (left, right) =>
      compareText(
        repositoryPath(resolvedRoot, left),
        repositoryPath(resolvedRoot, right),
      ),
  );
  for (const packageRoot of packageRoots) {
    collectPackageFiles(
      context,
      packageRoot,
    );
  }

  if (
    context.entries.length === 0 ||
    context.entries.length > SCANNER_IDENTITY_MAX_FILES
  ) {
    throw new Error(
      `Scanner identity must contain between 1 and ${SCANNER_IDENTITY_MAX_FILES} files.`,
    );
  }
  context.entries.sort((left, right) =>
    compareText(left.path, right.path),
  );
  assertFilesUnchanged(context);
  const files = Object.freeze([...context.entries]);
  const serialized = JSON.stringify({
    algorithm: SCANNER_IDENTITY_ALGORITHM,
    files: files.map((entry) => [
      entry.path,
      entry.sha256,
    ]),
  });
  return Object.freeze({
    algorithm: SCANNER_IDENTITY_ALGORITHM,
    fileCount: files.length,
    files,
    sha256: sha256(
      `GENII Publisher scanner identity\n${serialized}`,
    ),
  });
}
