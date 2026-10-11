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
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type {
  CompilationSourceInput,
} from "@genii-foundation/publisher-content";
import {
  CANONICAL_PUBLICATION_MANIFEST_PATH,
  normalizePortableRepositoryText,
  parseJsonWithUniqueObjectKeys,
  portableRepositoryPathIdentity,
  portableRepositorySegmentIdentity,
  resolvePublicationSourcesForContentCompilation,
  STRICT_JSON_DIAGNOSTIC_CODES,
  validateAudioCatalogShape,
  validateCollectionShape,
  validatePublicationPreflight,
  validatePublicationShape,
  validateWorkShape,
  validateUpdatesCatalogShape,
} from "@genii-foundation/publisher-schema";
import type {
  CollectionManifest,
  Diagnostic,
  PublicationManifest,
  ResolvedPublicationSourceGraph,
  ValidationResult,
  WorkManifest,
} from "@genii-foundation/publisher-schema";

import {
  attachDocumentPath,
  invalidResult,
  loaderDiagnostic,
  LoaderFailure,
  operatingSystemErrorCode,
  sortAndFreezeDiagnostics,
} from "./diagnostics.js";
import {
  filesystemIdentityKey,
  nodePublicationFileSystem,
  sameDirectoryIdentity,
  sameFileIdentity,
} from "./filesystem-identity.js";
import type {
  DirectoryNameReadResult,
  FileSystemNodeIdentity,
  PublicationFileSystem,
} from "./filesystem-identity.js";
import {
  PUBLISHER_SOURCE_LOADER_LIMITS,
} from "./types.js";
import type {
  LoadedAudioCatalog,
  LoadedUpdatesCatalog,
  LoadedPublicationCompilationSources,
  LoadPublicationCompilationSourcesInput,
} from "./types.js";
import {
  PUBLISHER_VERSION,
} from "../index.js";

const JSON_MEDIA_TYPE = "application/json";
const MARKDOWN_MEDIA_TYPE = "text/markdown; charset=utf-8";
const textDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
const textEncoder = new TextEncoder();
const nameDecoder = new TextDecoder("utf-8", {
  fatal: true,
  // TextDecoder otherwise consumes a leading U+FEFF as a byte-order mark.
  ignoreBOM: true,
});
const trustedLoadedPublicationSnapshots = new WeakSet<object>();

interface RootSnapshot {
  readonly requestedRoot: string;
  readonly realRoot: string;
  readonly identity: FileSystemNodeIdentity;
}

interface DirectorySnapshot {
  readonly logicalPath: string;
  readonly identity: FileSystemNodeIdentity;
}

interface CachedDirectoryNames {
  readonly aliasNameCounts: ReadonlyMap<string, number>;
  readonly entryCount: number;
  readonly exactNameCounts: ReadonlyMap<string, number>;
  readonly identity: FileSystemNodeIdentity;
  readonly nameBytes: number;
  readonly pathBytes: number;
}

interface WalkedSource {
  readonly absolutePath: string;
  readonly directories: readonly DirectorySnapshot[];
  readonly identity: FileSystemNodeIdentity;
  readonly logicalPath: string;
}

interface CapturedTextSource {
  readonly source: CompilationSourceInput & {
    readonly contents: string;
    readonly rawBytes: Uint8Array;
  };
  readonly walk: WalkedSource;
}

interface LoaderState {
  readonly captured: CapturedTextSource[];
  readonly directoryNames: Map<string, CachedDirectoryNames>;
  readonly fileSystemIdentityOwners: Map<string, string>;
  readonly logicalOwners: Map<string, string>;
  readonly root: RootSnapshot;
  directoryEntryCount: number;
  directoryNameBytes: number;
  directoryPathBytes: number;
  totalBytes: bigint;
}

function fail(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>>,
  documentPath?: string,
): never {
  throw new LoaderFailure(
    loaderDiagnostic(
      code,
      path,
      message,
      keyword,
      params,
      documentPath,
    ),
  );
}

function inspectInput(
  input: unknown,
):
  | LoadPublicationCompilationSourcesInput
  | Diagnostic {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return loaderDiagnostic(
      "loader.input.invalid",
      "",
      "Publication source loader input must be one plain object.",
      "inputShape",
      { reason: "notPlainObject" },
    );
  }

  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(input);
    keys = Reflect.ownKeys(input);
  } catch {
    return loaderDiagnostic(
      "loader.input.invalid",
      "",
      "Publication source loader input cannot be inspected safely.",
      "inputShape",
      { reason: "uninspectable" },
    );
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.some((key) => typeof key !== "string") ||
    keys.length !== 1 ||
    !keys.includes("publicationRoot")
  ) {
    return loaderDiagnostic(
      "loader.input.invalid",
      "",
      "Publication source loader input must contain only publicationRoot.",
      "inputShape",
      { reason: "unexpectedProperties" },
    );
  }

  const values: Record<string, unknown> = {};
  try {
    for (const key of keys) {
      if (typeof key !== "string") {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return loaderDiagnostic(
          "loader.input.invalid",
          `/${key}`,
          "Publication source loader properties must be enumerable data properties.",
          "inputShape",
          { reason: "nonDataProperty" },
        );
      }
      values[key] = descriptor.value;
    }
  } catch {
    return loaderDiagnostic(
      "loader.input.invalid",
      "",
      "Publication source loader input cannot be inspected safely.",
      "inputShape",
      { reason: "uninspectable" },
    );
  }

  if (
    typeof values.publicationRoot !== "string" ||
    values.publicationRoot.length === 0 ||
    values.publicationRoot.length > 32_768
  ) {
    return loaderDiagnostic(
      "loader.input.invalid",
      "/publicationRoot",
      "publicationRoot must be a non-empty absolute path string.",
      "inputShape",
      { reason: "publicationRootType" },
    );
  }
  if (!isAbsolute(values.publicationRoot)) {
    return loaderDiagnostic(
      "loader.root.relative",
      "/publicationRoot",
      "publicationRoot must be absolute.",
      "absolutePath",
      {},
    );
  }
  return Object.freeze({
    publicationRoot: values.publicationRoot,
  });
}

async function rootSnapshot(
  requestedRoot: string,
  fileSystem: PublicationFileSystem,
): Promise<RootSnapshot> {
  const canonicalRoot = resolve(requestedRoot);
  if (canonicalRoot !== requestedRoot) {
    fail(
      "loader.root.noncanonical",
      "/publicationRoot",
      "The publication root must use its lexically canonical absolute spelling.",
      "canonicalPath",
      { reason: "noncanonicalRootSpelling" },
    );
  }

  let requestedIdentity: FileSystemNodeIdentity;
  try {
    requestedIdentity = await fileSystem.lstat(canonicalRoot);
  } catch (error) {
    if (operatingSystemErrorCode(error) === "ENOENT") {
      fail(
        "loader.root.missing",
        "/publicationRoot",
        "The publication root does not exist.",
        "existingDirectory",
        {},
      );
    }
    fail(
      "loader.load_failed",
      "/publicationRoot",
      "The publication root could not be inspected.",
      "filesystemRead",
      { reason: "rootInspectionFailed" },
    );
  }
  if (requestedIdentity.kind === "symbolic-link") {
    fail(
      "loader.root.symlink",
      "/publicationRoot",
      "The publication root must not be a symbolic link.",
      "noSymbolicLinks",
      {},
    );
  }
  if (requestedIdentity.kind !== "directory") {
    fail(
      "loader.root.not_directory",
      "/publicationRoot",
      "The publication root must be a directory.",
      "directory",
      {},
    );
  }

  let realRoot: string;
  let realIdentity: FileSystemNodeIdentity;
  try {
    realRoot = await fileSystem.realpath(canonicalRoot);
    realIdentity = await fileSystem.lstat(realRoot);
  } catch {
    fail(
      "loader.root.changed",
      "/publicationRoot",
      "The publication root changed while its identity was captured.",
      "stableIdentity",
      { reason: "realpathFailed" },
    );
  }
  if (
    realIdentity.kind !== "directory" ||
    !sameDirectoryIdentity(requestedIdentity, realIdentity)
  ) {
    fail(
      "loader.root.changed",
      "/publicationRoot",
      "The publication root changed while its identity was captured.",
      "stableIdentity",
      { reason: "identityMismatch" },
    );
  }
  return Object.freeze({
    requestedRoot: canonicalRoot,
    realRoot,
    identity: realIdentity,
  });
}

function byteIdentity(value: Uint8Array): string {
  let identity = "";
  for (const byte of value) {
    identity += byte.toString(16).padStart(2, "0");
  }
  return identity;
}

function sameBytes(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function containedByRoot(
  root: string,
  candidate: string,
): boolean {
  const path = relative(root, candidate);
  return (
    path === "" ||
    (!isAbsolute(path) &&
      path !== ".." &&
      !path.startsWith(`..${sep}`))
  );
}

async function readBoundedDirectoryNames(
  state: LoaderState,
  absolutePath: string,
  logicalDirectoryPath: string,
  expectedIdentity: FileSystemNodeIdentity,
  sourcePath: string,
  segmentIndex: number,
  fileSystem: PublicationFileSystem,
): Promise<CachedDirectoryNames> {
  let before: FileSystemNodeIdentity;
  try {
    before = await fileSystem.lstat(absolutePath);
  } catch {
    fail(
      "loader.source.changed",
      "",
      `Source "${sourcePath}" changed while its parent directory was inspected.`,
      "stableIdentity",
      {
        logicalPath: sourcePath,
        directoryPath: logicalDirectoryPath,
        reason: "parentIdentityUnavailable",
        segmentIndex,
      },
      sourcePath,
    );
  }
  if (!sameDirectoryIdentity(expectedIdentity, before)) {
    fail(
      "loader.source.changed",
      "",
      `Source "${sourcePath}" changed while its parent directory was inspected.`,
      "stableIdentity",
      {
        logicalPath: sourcePath,
        directoryPath: logicalDirectoryPath,
        reason: "parentIdentityMismatch",
        segmentIndex,
      },
      sourcePath,
    );
  }

  const cached = state.directoryNames.get(logicalDirectoryPath);
  if (
    cached !== undefined &&
    sameDirectoryIdentity(cached.identity, before)
  ) {
    return cached;
  }

  let read: DirectoryNameReadResult;
  try {
    read = await fileSystem.readDirectoryNames(
      absolutePath,
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectoryEntries,
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectoryNameBytes,
    );
  } catch {
    fail(
      "loader.source.read_failed",
      "",
      `Source "${sourcePath}" could not be resolved.`,
      "filesystemRead",
      {
        logicalPath: sourcePath,
        directoryPath: logicalDirectoryPath,
        reason: "parentDirectoryUnreadable",
        segmentIndex,
      },
      sourcePath,
    );
  }
  if (!read.complete) {
    fail(
      "loader.directory.too_large",
      "",
      `Directory containing source "${sourcePath}" exceeds a fixed enumeration limit.`,
      "boundedDirectoryEnumeration",
      {
        logicalPath: sourcePath,
        directoryPath: logicalDirectoryPath,
        maximumDirectoryEntries:
          PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectoryEntries,
        maximumDirectoryNameBytes:
          PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectoryNameBytes,
        segmentIndex,
      },
      sourcePath,
    );
  }

  let after: FileSystemNodeIdentity;
  try {
    after = await fileSystem.lstat(absolutePath);
  } catch {
    fail(
      "loader.source.changed",
      "",
      `Source "${sourcePath}" changed while its parent directory was enumerated.`,
      "stableIdentity",
      {
        logicalPath: sourcePath,
        directoryPath: logicalDirectoryPath,
        reason: "parentIdentityUnavailableAfterRead",
        segmentIndex,
      },
      sourcePath,
    );
  }
  if (!sameDirectoryIdentity(before, after)) {
    fail(
      "loader.source.changed",
      "",
      `Source "${sourcePath}" changed while its parent directory was enumerated.`,
      "stableIdentity",
      {
        logicalPath: sourcePath,
        directoryPath: logicalDirectoryPath,
        reason: "parentIdentityChangedDuringRead",
        segmentIndex,
      },
      sourcePath,
    );
  }
  const names = read.names.map((name) => new Uint8Array(name));
  const entryCount = names.length;
  const nameBytes = names.reduce(
    (total, name) => total + name.byteLength,
    0,
  );
  const exactNameCounts = new Map<string, number>();
  const aliasNameCounts = new Map<string, number>();
  for (const name of names) {
    const exactIdentity = byteIdentity(name);
    exactNameCounts.set(
      exactIdentity,
      (exactNameCounts.get(exactIdentity) ?? 0) + 1,
    );
    try {
      const aliasIdentity = portableRepositorySegmentIdentity(
        nameDecoder.decode(name),
      );
      aliasNameCounts.set(
        aliasIdentity,
        (aliasNameCounts.get(aliasIdentity) ?? 0) + 1,
      );
    } catch {
      // Undeclared non-UTF-8 directory entries cannot match a valid source.
    }
  }
  const pathBytes = textEncoder.encode(
    logicalDirectoryPath,
  ).byteLength;
  const replacing = cached !== undefined;
  const nextEntryCount =
    state.directoryEntryCount -
    (cached?.entryCount ?? 0) +
    entryCount;
  const nextNameBytes =
    state.directoryNameBytes -
    (cached?.nameBytes ?? 0) +
    nameBytes;
  const nextPathBytes =
    state.directoryPathBytes -
    (cached?.pathBytes ?? 0) +
    pathBytes;
  const nextSnapshotCount =
    state.directoryNames.size + (replacing ? 0 : 1);
  if (
    nextEntryCount >
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryEntriesTotal ||
    nextNameBytes >
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryNameBytesTotal ||
    nextPathBytes >
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryPathBytesTotal ||
    nextSnapshotCount >
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectorySnapshots
  ) {
    fail(
      "loader.directory_set.too_large",
      "",
      "The publication source snapshot exceeds its fixed directory enumeration budget.",
      "boundedDirectoryEnumeration",
      {
        logicalPath: sourcePath,
        directoryPath: logicalDirectoryPath,
        maximumDirectoryEntriesTotal:
          PUBLISHER_SOURCE_LOADER_LIMITS
            .maximumDirectoryEntriesTotal,
        maximumDirectoryNameBytesTotal:
          PUBLISHER_SOURCE_LOADER_LIMITS
            .maximumDirectoryNameBytesTotal,
        maximumDirectoryPathBytesTotal:
          PUBLISHER_SOURCE_LOADER_LIMITS
            .maximumDirectoryPathBytesTotal,
        maximumDirectorySnapshots:
          PUBLISHER_SOURCE_LOADER_LIMITS
            .maximumDirectorySnapshots,
        segmentIndex,
      },
      sourcePath,
    );
  }
  state.directoryEntryCount = nextEntryCount;
  state.directoryNameBytes = nextNameBytes;
  state.directoryPathBytes = nextPathBytes;
  const snapshot = Object.freeze({
    aliasNameCounts,
    entryCount,
    exactNameCounts,
    identity: after,
    nameBytes,
    pathBytes,
  });
  state.directoryNames.set(logicalDirectoryPath, snapshot);
  return snapshot;
}

async function walkSource(
  state: LoaderState,
  logicalPath: string,
  fileSystem: PublicationFileSystem,
): Promise<WalkedSource> {
  const root = state.root;
  const segments = logicalPath.split("/");
  let absoluteParent = root.realRoot;
  let logicalParent = "";
  let parentIdentity = root.identity;
  const directories: DirectorySnapshot[] = [];

  for (
    let segmentIndex = 0;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    const segment = segments[segmentIndex] ?? "";
    if (normalizePortableRepositoryText(segment) !== segment) {
      fail(
        "loader.path.not_nfc",
        "",
        `Source path "${logicalPath}" contains a non-NFC segment.`,
        "nfcPath",
        { logicalPath, segmentIndex },
        logicalPath,
      );
    }

    const directory = await readBoundedDirectoryNames(
      state,
      absoluteParent,
      logicalParent,
      parentIdentity,
      logicalPath,
      segmentIndex,
      fileSystem,
    );
    const expectedBytes = textEncoder.encode(segment);
    const exactCount =
      directory.exactNameCounts.get(byteIdentity(expectedBytes)) ?? 0;
    const aliasCount =
      directory.aliasNameCounts.get(
        portableRepositorySegmentIdentity(segment),
      ) ?? 0;
    if (exactCount !== 1) {
      if (aliasCount > 0) {
        fail(
          "loader.path.spelling_mismatch",
          "",
          `Source path "${logicalPath}" does not match the filesystem spelling exactly.`,
          "exactFilesystemSpelling",
          { logicalPath, segmentIndex },
          logicalPath,
        );
      }
      fail(
        "loader.source.missing",
        "",
        `Required source "${logicalPath}" does not exist.`,
        "requiredSource",
        { logicalPath, segmentIndex },
        logicalPath,
      );
    }
    if (aliasCount !== 1) {
      fail(
        "loader.path.identity_ambiguous",
        "",
        `Source path "${logicalPath}" has an ambiguous portable filesystem identity.`,
        "uniqueFilesystemIdentity",
        {
          logicalPath,
          segmentIndex,
          equivalentEntryCount: aliasCount,
        },
        logicalPath,
      );
    }

    const absolutePath = join(absoluteParent, segment);
    let identity: FileSystemNodeIdentity;
    try {
      identity = await fileSystem.lstat(absolutePath);
    } catch {
      fail(
        "loader.source.missing",
        "",
        `Required source "${logicalPath}" disappeared while it was resolved.`,
        "requiredSource",
        {
          logicalPath,
          reason: "identityUnavailable",
          segmentIndex,
        },
        logicalPath,
      );
    }
    if (identity.kind === "symbolic-link") {
      fail(
        "loader.path.symlink",
        "",
        `Source path "${logicalPath}" traverses a symbolic link.`,
        "noSymbolicLinks",
        { logicalPath, segmentIndex },
        logicalPath,
      );
    }
    if (identity.dev !== root.identity.dev) {
      fail(
        "loader.path.cross_device",
        "",
        `Source path "${logicalPath}" crosses the publication filesystem device.`,
        "singleFilesystemDevice",
        { logicalPath, segmentIndex },
        logicalPath,
      );
    }

    const final = segmentIndex === segments.length - 1;
    if (!final && identity.kind !== "directory") {
      fail(
        "loader.source.missing",
        "",
        `Required source "${logicalPath}" has a non-directory parent.`,
        "requiredSource",
        {
          logicalPath,
          reason: "parentNotDirectory",
          segmentIndex,
        },
        logicalPath,
      );
    }
    if (final && identity.kind !== "file") {
      fail(
        "loader.source.not_file",
        "",
        `Required source "${logicalPath}" is not a regular file.`,
        "regularFile",
        { logicalPath, nodeKind: identity.kind },
        logicalPath,
      );
    }
    if (final && identity.nlink !== 1n) {
      fail(
        "loader.source.hard_link",
        "",
        `Required source "${logicalPath}" has more than one filesystem link.`,
        "singleFilesystemLink",
        { logicalPath },
        logicalPath,
      );
    }

    logicalParent =
      logicalParent.length === 0
        ? segment
        : `${logicalParent}/${segment}`;
    if (!final) {
      directories.push(
        Object.freeze({
          logicalPath: logicalParent,
          identity,
        }),
      );
      absoluteParent = absolutePath;
      parentIdentity = identity;
      continue;
    }

    let realCandidate: string;
    try {
      realCandidate = await fileSystem.realpath(absolutePath);
    } catch {
      fail(
        "loader.source.changed",
        "",
        `Required source "${logicalPath}" changed during path resolution.`,
        "stableIdentity",
        { logicalPath, reason: "realpathFailed" },
        logicalPath,
      );
    }
    if (!containedByRoot(root.realRoot, realCandidate)) {
      fail(
        "loader.path.symlink",
        "",
        `Source path "${logicalPath}" resolves outside the publication root.`,
        "rootContainment",
        { logicalPath, reason: "realpathEscape" },
        logicalPath,
      );
    }
    return Object.freeze({
      absolutePath,
      directories: Object.freeze(directories),
      identity,
      logicalPath,
    });
  }

  fail(
    "loader.source.missing",
    "",
    "Required source path is empty.",
    "requiredSource",
    { logicalPath },
    logicalPath,
  );
}

function sameWalk(
  before: WalkedSource,
  after: WalkedSource,
): boolean {
  if (
    before.logicalPath !== after.logicalPath ||
    !sameFileIdentity(before.identity, after.identity) ||
    before.directories.length !== after.directories.length
  ) {
    return false;
  }
  return before.directories.every((directory, index) => {
    const current = after.directories[index];
    return (
      current !== undefined &&
      current.logicalPath === directory.logicalPath &&
      sameDirectoryIdentity(
        directory.identity,
        current.identity,
      )
    );
  });
}

async function verifyRoot(
  root: RootSnapshot,
  fileSystem: PublicationFileSystem,
): Promise<void> {
  let requestedIdentity: FileSystemNodeIdentity;
  let realRoot: string;
  let realIdentity: FileSystemNodeIdentity;
  try {
    requestedIdentity = await fileSystem.lstat(root.requestedRoot);
    realRoot = await fileSystem.realpath(root.requestedRoot);
    realIdentity = await fileSystem.lstat(root.realRoot);
  } catch {
    fail(
      "loader.root.changed",
      "/publicationRoot",
      "The publication root changed before loading completed.",
      "stableIdentity",
      { reason: "identityUnavailable" },
    );
  }
  if (
    realRoot !== root.realRoot ||
    !sameDirectoryIdentity(root.identity, requestedIdentity) ||
    !sameDirectoryIdentity(root.identity, realIdentity)
  ) {
    fail(
      "loader.root.changed",
      "/publicationRoot",
      "The publication root changed before loading completed.",
      "stableIdentity",
      { reason: "identityMismatch" },
    );
  }
}

function registerLogicalOwner(
  state: LoaderState,
  logicalPath: string,
  owner: string,
): void {
  const pathIdentity =
    portableRepositoryPathIdentity(logicalPath);
  const firstOwner = state.logicalOwners.get(pathIdentity);
  if (firstOwner !== undefined) {
    fail(
      "loader.source.identity_duplicate",
      "",
      `Source "${logicalPath}" is assigned more than one logical owner.`,
      "uniqueSourceIdentity",
      {
        logicalPath,
        firstOwner,
        duplicateOwner: owner,
        reason: "logicalPath",
      },
      logicalPath,
    );
  }
  state.logicalOwners.set(pathIdentity, owner);
}

async function captureTextSource(
  state: LoaderState,
  fileSystem: PublicationFileSystem,
  input: {
    readonly logicalPath: string;
    readonly role:
      | "audio-catalog"
      | "collection-manifest"
      | "manuscript"
      | "publication-manifest"
      | "updates-catalog"
      | "work-manifest";
    readonly entityId?: string;
    readonly mediaType: string;
    readonly maximumBytes: number;
  },
): Promise<CapturedTextSource> {
  const owner = `${input.role}:${input.entityId ?? ""}`;
  registerLogicalOwner(state, input.logicalPath, owner);
  const walk = await walkSource(
    state,
    input.logicalPath,
    fileSystem,
  );
  if (
    walk.identity.size < 0n ||
    walk.identity.size > BigInt(input.maximumBytes)
  ) {
    fail(
      "loader.source.too_large",
      "",
      `Source "${input.logicalPath}" exceeds its fixed byte limit.`,
      "maximumBytes",
      {
        logicalPath: input.logicalPath,
        role: input.role,
        maximumBytes: input.maximumBytes,
      },
      input.logicalPath,
    );
  }
  const remainingTotalBytes =
    BigInt(PUBLISHER_SOURCE_LOADER_LIMITS.maximumTotalBytes) -
    state.totalBytes;
  if (walk.identity.size > remainingTotalBytes) {
    fail(
      "loader.source_set.too_large",
      "",
      "The publication source snapshot exceeds its fixed total byte limit.",
      "maximumTotalBytes",
      {
        logicalPath: input.logicalPath,
        maximumTotalBytes:
          PUBLISHER_SOURCE_LOADER_LIMITS.maximumTotalBytes,
      },
      input.logicalPath,
    );
  }
  const boundedReadBytes = Math.min(
    input.maximumBytes,
    Number(remainingTotalBytes),
  );

  const identityKey = filesystemIdentityKey(walk.identity);
  const firstIdentityOwner =
    state.fileSystemIdentityOwners.get(identityKey);
  if (firstIdentityOwner !== undefined) {
    fail(
      "loader.source.identity_duplicate",
      "",
      `Source "${input.logicalPath}" shares a filesystem identity with another source.`,
      "uniqueSourceIdentity",
      {
        logicalPath: input.logicalPath,
        firstOwner: firstIdentityOwner,
        duplicateOwner: owner,
        reason: "filesystemIdentity",
      },
      input.logicalPath,
    );
  }
  state.fileSystemIdentityOwners.set(identityKey, owner);

  let opened;
  try {
    opened = await fileSystem.openReadOnlyNoFollow(
      walk.absolutePath,
    );
  } catch (error) {
    const code = operatingSystemErrorCode(error);
    if (code === "ELOOP") {
      fail(
        "loader.path.symlink",
        "",
        `Source "${input.logicalPath}" became a symbolic link before it opened.`,
        "noSymbolicLinks",
        { logicalPath: input.logicalPath, reason: "openNoFollow" },
        input.logicalPath,
      );
    }
    fail(
      "loader.source.read_failed",
      "",
      `Source "${input.logicalPath}" could not be opened.`,
      "filesystemRead",
      { logicalPath: input.logicalPath, reason: "openFailed" },
      input.logicalPath,
    );
  }

  let bytes: Uint8Array | undefined;
  let captureFailure: unknown;
  try {
    const openedIdentity = await opened.stat();
    if (!sameFileIdentity(walk.identity, openedIdentity)) {
      fail(
        "loader.source.changed",
        "",
        `Source "${input.logicalPath}" changed before it was read.`,
        "stableIdentity",
        {
          logicalPath: input.logicalPath,
          reason: "openIdentityMismatch",
        },
        input.logicalPath,
      );
    }
    const firstReadBytes = await opened.readFile(
      boundedReadBytes,
      Number(openedIdentity.size),
    );
    const verificationBytes = await opened.readFile(
      boundedReadBytes,
      Number(openedIdentity.size),
    );
    const afterReadIdentity = await opened.stat();
    if (
      !sameFileIdentity(openedIdentity, afterReadIdentity) ||
      BigInt(firstReadBytes.byteLength) !== openedIdentity.size ||
      BigInt(verificationBytes.byteLength) !== openedIdentity.size
    ) {
      fail(
        "loader.source.changed",
        "",
        `Source "${input.logicalPath}" changed while it was read.`,
        "stableIdentity",
        {
          logicalPath: input.logicalPath,
          reason: "readIdentityMismatch",
        },
        input.logicalPath,
      );
    }
    if (!sameBytes(firstReadBytes, verificationBytes)) {
      fail(
        "loader.source.changed",
        "",
        `Source "${input.logicalPath}" returned different bytes across repeatable reads.`,
        "stableBytes",
        {
          logicalPath: input.logicalPath,
          reason: "readBytesMismatch",
        },
        input.logicalPath,
      );
    }
    bytes = firstReadBytes;
  } catch (error) {
    captureFailure = error;
  }
  try {
    await opened.close();
  } catch {
    if (captureFailure === undefined) {
      fail(
        "loader.source.read_failed",
        "",
        `Source "${input.logicalPath}" could not be closed safely.`,
        "filesystemRead",
        { logicalPath: input.logicalPath, reason: "closeFailed" },
        input.logicalPath,
      );
    }
  }
  if (captureFailure !== undefined) {
    if (captureFailure instanceof LoaderFailure) {
      throw captureFailure;
    }
    fail(
      "loader.source.read_failed",
      "",
      `Source "${input.logicalPath}" could not be read.`,
      "filesystemRead",
      { logicalPath: input.logicalPath, reason: "readFailed" },
      input.logicalPath,
    );
  }
  if (bytes === undefined) {
    fail(
      "loader.source.read_failed",
      "",
      `Source "${input.logicalPath}" did not produce a byte snapshot.`,
      "filesystemRead",
      { logicalPath: input.logicalPath, reason: "emptyReadState" },
      input.logicalPath,
    );
  }

  const afterReadWalk = await walkSource(
    state,
    input.logicalPath,
    fileSystem,
  );
  if (!sameWalk(walk, afterReadWalk)) {
    fail(
      "loader.source.changed",
      "",
      `Source "${input.logicalPath}" changed during loading.`,
      "stableIdentity",
      { logicalPath: input.logicalPath, reason: "pathIdentityMismatch" },
      input.logicalPath,
    );
  }

  state.totalBytes += BigInt(bytes.byteLength);
  if (
    state.totalBytes >
    BigInt(PUBLISHER_SOURCE_LOADER_LIMITS.maximumTotalBytes)
  ) {
    fail(
      "loader.source_set.too_large",
      "",
      "The publication source snapshot exceeds its fixed total byte limit.",
      "maximumTotalBytes",
      {
        maximumTotalBytes:
          PUBLISHER_SOURCE_LOADER_LIMITS.maximumTotalBytes,
      },
    );
  }

  let contents: string;
  try {
    contents = textDecoder.decode(bytes);
  } catch {
    fail(
      "loader.source.utf8_invalid",
      "",
      `Source "${input.logicalPath}" is not well-formed UTF-8.`,
      "utf8",
      { logicalPath: input.logicalPath, role: input.role },
      input.logicalPath,
    );
  }
  const rawBytes = bytes;
  const source = Object.freeze({
    path: input.logicalPath,
    role: input.role,
    ...(input.entityId === undefined
      ? {}
      : { entityId: input.entityId }),
    mediaType: input.mediaType,
    contents,
    rawBytes,
  }) as CapturedTextSource["source"];
  const captured = Object.freeze({
    source,
    walk,
  });
  state.captured.push(captured);
  return captured;
}

function parseJson(
  captured: CapturedTextSource,
): unknown {
  const parsed = parseJsonWithUniqueObjectKeys(
    captured.source.contents,
  );
  if (parsed.valid) {
    return parsed.value;
  }

  const diagnostic = parsed.diagnostics[0];
  if (diagnostic === undefined) {
    fail(
      "loader.manifest.json_invalid",
      "",
      `Manifest "${captured.source.path}" could not be parsed safely as JSON.`,
      "json",
      {
        logicalPath: captured.source.path,
        reason: "missingParserDiagnostic",
      },
      captured.source.path,
    );
  }
  const duplicate =
    diagnostic.code ===
    STRICT_JSON_DIAGNOSTIC_CODES.duplicateMember;
  const limitExceeded =
    diagnostic.code === STRICT_JSON_DIAGNOSTIC_CODES.depthExceeded ||
    diagnostic.code === STRICT_JSON_DIAGNOSTIC_CODES.sizeExceeded ||
    diagnostic.code ===
      STRICT_JSON_DIAGNOSTIC_CODES.tokenLimitExceeded;
  fail(
    duplicate
      ? "loader.manifest.json_duplicate_member"
      : limitExceeded
        ? "loader.manifest.json_limit_exceeded"
        : "loader.manifest.json_invalid",
    diagnostic.path,
    duplicate
      ? `Manifest "${captured.source.path}" contains a duplicate JSON object member name.`
      : limitExceeded
        ? `Manifest "${captured.source.path}" exceeds the fixed JSON parser limits.`
        : `Manifest "${captured.source.path}" is not valid protocol JSON.`,
    diagnostic.keyword,
    {
      ...diagnostic.params,
      logicalPath: captured.source.path,
      parserCode: diagnostic.code,
    },
    captured.source.path,
  );
}

function freezeSource(
  source: CapturedTextSource["source"],
): CompilationSourceInput {
  return Object.freeze({
    path: source.path,
    role: source.role,
    ...(source.entityId === undefined
      ? {}
      : { entityId: source.entityId }),
    mediaType: source.mediaType,
    contents: source.contents,
    rawBytes: source.rawBytes,
  });
}

function freezeStructuredValue<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      freezeStructuredValue(item);
    }
    return Object.freeze(value);
  }
  for (const key of Object.keys(value)) {
    freezeStructuredValue(
      (value as Readonly<Record<string, unknown>>)[key],
    );
  }
  return Object.freeze(value);
}

async function finalIdentityPass(
  state: LoaderState,
  fileSystem: PublicationFileSystem,
): Promise<void> {
  await verifyRoot(state.root, fileSystem);
  for (const captured of state.captured) {
    const current = await walkSource(
      state,
      captured.source.path,
      fileSystem,
    );
    if (!sameWalk(captured.walk, current)) {
      fail(
        "loader.source.changed",
        "",
        `Source "${captured.source.path}" changed before loading completed.`,
        "stableIdentity",
        {
          logicalPath: captured.source.path,
          reason: "finalIdentityMismatch",
        },
        captured.source.path,
      );
    }
  }
  await verifyRoot(state.root, fileSystem);
}

function successfulResult(
  publication: PublicationManifest,
  sourceGraph: ResolvedPublicationSourceGraph,
  sources: readonly CompilationSourceInput[],
  audioCatalog?: LoadedAudioCatalog,
  updatesCatalog?: LoadedUpdatesCatalog,
): ValidationResult<LoadedPublicationCompilationSources> {
  const frozenPublication = freezeStructuredValue(publication);
  const frozenSourceGraph = freezeStructuredValue(sourceGraph);
  const loaded = Object.freeze({
    publication: frozenPublication,
    sourceGraph: frozenSourceGraph,
    sources: Object.freeze(sources),
    // Absent rather than present and empty when no catalog is declared. A
    // publication with no narration and a publication whose catalog failed to
    // resolve must not look alike to anything downstream.
    ...(audioCatalog === undefined
      ? {}
      : { audioCatalog: freezeStructuredValue(audioCatalog) }),
    ...(updatesCatalog === undefined
      ? {}
      : { updatesCatalog: freezeStructuredValue(updatesCatalog) }),
  }) as LoadedPublicationCompilationSources;
  return Object.freeze({
    valid: true as const,
    value: loaded,
    diagnostics: Object.freeze([]),
  });
}

async function loadWithFileSystem(
  input: unknown,
  fileSystem: PublicationFileSystem,
): Promise<ValidationResult<LoadedPublicationCompilationSources>> {
  const inspected = inspectInput(input);
  if ("code" in inspected) {
    return invalidResult([inspected]);
  }

  try {
    const root = await rootSnapshot(
      inspected.publicationRoot,
      fileSystem,
    );
    const state: LoaderState = {
      captured: [],
      directoryNames: new Map(),
      directoryEntryCount: 0,
      directoryNameBytes: 0,
      directoryPathBytes: 0,
      fileSystemIdentityOwners: new Map(),
      logicalOwners: new Map(),
      root,
      totalBytes: 0n,
    };
    const publicationSource = await captureTextSource(
      state,
      fileSystem,
      {
        logicalPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
        role: "publication-manifest",
        mediaType: JSON_MEDIA_TYPE,
        maximumBytes:
          PUBLISHER_SOURCE_LOADER_LIMITS.maximumManifestBytes,
      },
    );
    const publicationShape = validatePublicationShape(
      parseJson(publicationSource),
    );
    if (!publicationShape.valid) {
      return invalidResult(
        attachDocumentPath(
          publicationShape.diagnostics,
          CANONICAL_PUBLICATION_MANIFEST_PATH,
        ),
      );
    }
    const publication = publicationShape.value;
    const sourceFileCount =
      1 +
      publication.works.length * 2 +
      (publication.collections?.length ?? 0) +
      (publication.audio?.catalog === undefined ? 0 : 1) +
      (publication.updates?.catalog === undefined ? 0 : 1);
    if (
      sourceFileCount >
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumSourceFiles
    ) {
      return invalidResult([
        loaderDiagnostic(
          "loader.source_set.too_large",
          "",
          "The publication declares more source files than the loader limit.",
          "maximumSourceFiles",
          {
            maximumSourceFiles:
              PUBLISHER_SOURCE_LOADER_LIMITS.maximumSourceFiles,
            declaredSourceFiles: sourceFileCount,
          },
        ),
      ]);
    }
    const preflight = validatePublicationPreflight({
      publication,
      engineVersion: PUBLISHER_VERSION,
    });
    if (!preflight.valid) {
      return invalidResult(preflight.diagnostics);
    }
    const layout = preflight;

    const workSources: CapturedTextSource[] = [];
    const workManifests = new Map<string, WorkManifest>();
    for (const reference of layout.value.works.manifests) {
      const captured = await captureTextSource(
        state,
        fileSystem,
        {
          logicalPath: reference.manifestPath,
          role: "work-manifest",
          entityId: reference.id,
          mediaType: JSON_MEDIA_TYPE,
          maximumBytes:
            PUBLISHER_SOURCE_LOADER_LIMITS.maximumManifestBytes,
        },
      );
      workSources.push(captured);
      const shaped = validateWorkShape(parseJson(captured));
      if (!shaped.valid) {
        return invalidResult(
          attachDocumentPath(
            shaped.diagnostics,
            reference.manifestPath,
          ),
        );
      }
      workManifests.set(reference.manifestPath, shaped.value);
    }

    const collectionSources: CapturedTextSource[] = [];
    const collectionManifests =
      new Map<string, CollectionManifest>();
    let collectionWorkReferenceCount = 0;
    for (const reference of layout.value.collections.manifests) {
      const captured = await captureTextSource(
        state,
        fileSystem,
        {
          logicalPath: reference.manifestPath,
          role: "collection-manifest",
          entityId: reference.id,
          mediaType: JSON_MEDIA_TYPE,
          maximumBytes:
            PUBLISHER_SOURCE_LOADER_LIMITS.maximumManifestBytes,
        },
      );
      collectionSources.push(captured);
      const shaped = validateCollectionShape(parseJson(captured));
      if (!shaped.valid) {
        return invalidResult(
          attachDocumentPath(
            shaped.diagnostics,
            reference.manifestPath,
          ),
        );
      }
      collectionWorkReferenceCount += shaped.value.workIds.length;
      if (
        collectionWorkReferenceCount >
        PUBLISHER_SOURCE_LOADER_LIMITS
          .maximumCollectionWorkReferences
      ) {
        return invalidResult([
          loaderDiagnostic(
            "loader.source_graph.too_large",
            "/collections",
            "The publication declares more collection work references than the loader limit.",
            "maximumCollectionWorkReferences",
            {
              actualItems: collectionWorkReferenceCount,
              maximumItems:
                PUBLISHER_SOURCE_LOADER_LIMITS
                  .maximumCollectionWorkReferences,
              triggeringManifestPath: reference.manifestPath,
            },
            CANONICAL_PUBLICATION_MANIFEST_PATH,
          ),
        ]);
      }
      collectionManifests.set(
        reference.manifestPath,
        shaped.value,
      );
    }

    const semantic =
      resolvePublicationSourcesForContentCompilation({
        publication,
        engineVersion: PUBLISHER_VERSION,
        workManifests,
        collectionManifests,
      });
    if (!semantic.valid) {
      return invalidResult(semantic.diagnostics);
    }

    const manuscriptSources: CapturedTextSource[] = [];
    for (const work of semantic.value.works) {
      manuscriptSources.push(
        await captureTextSource(state, fileSystem, {
          logicalPath: work.manuscriptPath,
          role: "manuscript",
          entityId: work.workId,
          mediaType: MARKDOWN_MEDIA_TYPE,
          maximumBytes:
            PUBLISHER_SOURCE_LOADER_LIMITS.maximumManuscriptBytes,
        }),
      );
    }

    // Captured last, so that a catalog problem is reported against a publication
    // whose works and manuscripts have already resolved. An author who has both a
    // broken manuscript and a broken catalog should hear about the manuscript.
    let audioCatalog: LoadedAudioCatalog | undefined;
    const declaredCatalogPath = publication.audio?.catalog;
    if (declaredCatalogPath !== undefined) {
      const captured = await captureTextSource(state, fileSystem, {
        logicalPath: declaredCatalogPath,
        role: "audio-catalog",
        mediaType: JSON_MEDIA_TYPE,
        maximumBytes:
          PUBLISHER_SOURCE_LOADER_LIMITS.maximumAudioCatalogBytes,
      });
      const shaped = validateAudioCatalogShape(parseJson(captured));
      if (!shaped.valid) {
        return invalidResult(
          attachDocumentPath(shaped.diagnostics, declaredCatalogPath),
        );
      }
      const { contents } = captured.source;
      if (typeof contents !== "string") {
        return invalidResult([
          loaderDiagnostic(
            "loader.audio_catalog.not_text",
            "/audio/catalog",
            `The clip catalog at ${declaredCatalogPath} did not load as text.`,
            "textSource",
            { logicalPath: declaredCatalogPath },
            declaredCatalogPath,
          ),
        ]);
      }
      audioCatalog = {
        path: declaredCatalogPath,
        catalog: shaped.value,
        text: contents,
      };
    }

    let updatesCatalog: LoadedUpdatesCatalog | undefined;
    const declaredUpdatesCatalogPath = publication.updates?.catalog;
    if (declaredUpdatesCatalogPath !== undefined) {
      const captured = await captureTextSource(state, fileSystem, {
        logicalPath: declaredUpdatesCatalogPath,
        role: "updates-catalog",
        mediaType: JSON_MEDIA_TYPE,
        maximumBytes:
          PUBLISHER_SOURCE_LOADER_LIMITS.maximumUpdatesCatalogBytes,
      });
      const shaped = validateUpdatesCatalogShape(parseJson(captured));
      if (!shaped.valid) {
        return invalidResult(
          attachDocumentPath(
            shaped.diagnostics,
            declaredUpdatesCatalogPath,
          ),
        );
      }
      const { contents } = captured.source;
      if (typeof contents !== "string") {
        return invalidResult([
          loaderDiagnostic(
            "loader.updates_catalog.not_text",
            "/updates/catalog",
            `The Updates catalog at ${declaredUpdatesCatalogPath} did not load as text.`,
            "textSource",
            { logicalPath: declaredUpdatesCatalogPath },
            declaredUpdatesCatalogPath,
          ),
        ]);
      }
      updatesCatalog = {
        path: declaredUpdatesCatalogPath,
        catalog: shaped.value,
        text: contents,
      };
    }

    await finalIdentityPass(state, fileSystem);

    return successfulResult(
      publication,
      semantic.value,
      [
        freezeSource(publicationSource.source),
        ...workSources.map(({ source }) =>
          freezeSource(source),
        ),
        ...collectionSources.map(({ source }) =>
          freezeSource(source),
        ),
        ...manuscriptSources.map(({ source }) =>
          freezeSource(source),
        ),
      ],
      audioCatalog,
      updatesCatalog,
    );
  } catch (error) {
    if (error instanceof LoaderFailure) {
      return invalidResult([error.diagnostic]);
    }
    return invalidResult([
      loaderDiagnostic(
        "loader.load_failed",
        "",
        "Publication source loading failed safely.",
        "containedFailure",
        { reason: "unexpectedFailure" },
      ),
    ]);
  }
}

export function loadPublicationCompilationSourcesWithFileSystem(
  input: unknown,
  fileSystem: PublicationFileSystem,
): Promise<ValidationResult<LoadedPublicationCompilationSources>> {
  return loadWithFileSystem(input, fileSystem);
}

export async function loadPublicationCompilationSources(
  input: LoadPublicationCompilationSourcesInput,
): Promise<ValidationResult<LoadedPublicationCompilationSources>> {
  const result = await loadWithFileSystem(
    input,
    nodePublicationFileSystem,
  );
  if (result.valid) {
    trustedLoadedPublicationSnapshots.add(result.value);
  }
  return result;
}

/**
 * Internal package boundary used by the public compilation orchestrator.
 * This function is deliberately not re-exported from the package entry point.
 */
export function isTrustedLoadedPublicationSnapshot(
  value: unknown,
): value is LoadedPublicationCompilationSources {
  return (
    value !== null &&
    typeof value === "object" &&
    trustedLoadedPublicationSnapshots.has(value)
  );
}
