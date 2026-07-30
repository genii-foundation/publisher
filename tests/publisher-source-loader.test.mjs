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
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadPublicationCompilationSources,
} from "../packages/publisher/dist/node.js";
import {
  nodePublicationFileSystem,
} from "../packages/publisher/dist/node/filesystem-identity.js";
import {
  loadPublicationCompilationSourcesWithFileSystem,
} from "../packages/publisher/dist/node/loader.js";
import {
  PUBLISHER_SOURCE_LOADER_LIMITS,
} from "../packages/publisher/dist/node/types.js";
import {
  PUBLICATION_PROTOCOL_LIMITS,
  STRICT_JSON_DIAGNOSTIC_CODES,
  STRICT_JSON_LIMITS,
} from "../schemas/dist/index.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureRoot = join(repositoryRoot, "fixtures");
const textDecoder = new TextDecoder("utf-8");
const textEncoder = new TextEncoder();

const CANONICAL_PATHS = Object.freeze([
  "publication.json",
  "publication/works/rain-gauge/work.json",
  "publication/collections/weather-observations/collection.json",
  "publication/works/rain-gauge/manuscript.md",
]);

const DECLARED_PATHS = Object.freeze([
  "publication.json",
  "archive/texts/signal-lantern/record.json",
  "oddities/platform-card.json",
  "lists/after-dark/index.json",
  "archive/texts/signal-lantern/text.md",
  "archive/pages/platform-bell.md",
]);

const FILESYSTEM_CAPABILITY_UNAVAILABLE_CODES = Object.freeze({
  fifo: new Set([
    "EACCES",
    "ENOENT",
    "ENOSYS",
    "ENOTSUP",
    "EOPNOTSUPP",
    "EPERM",
  ]),
  hardLink: new Set([
    "EACCES",
    "EMLINK",
    "ENOSYS",
    "ENOTSUP",
    "EOPNOTSUPP",
    "EPERM",
  ]),
  exactUtf8Name: new Set([
    "EACCES",
    "EEXIST",
    "EILSEQ",
    "EINVAL",
    "ENOENT",
    "ENOTSUP",
    "EOPNOTSUPP",
    "EPERM",
  ]),
  portableNameAlias: new Set([
    "EACCES",
    "EEXIST",
    "EINVAL",
    "ENOTSUP",
    "EOPNOTSUPP",
    "EPERM",
  ]),
  symbolicLink: new Set([
    "EACCES",
    "ENOSYS",
    "ENOTSUP",
    "EOPNOTSUPP",
    "EPERM",
  ]),
});

function validationMessage(result) {
  return JSON.stringify(result.diagnostics, null, 2);
}

test("loader and protocol share one compilation-source ceiling", () => {
  assert.equal(
    PUBLISHER_SOURCE_LOADER_LIMITS.maximumSourceFiles,
    PUBLICATION_PROTOCOL_LIMITS.maximumCompilationSources,
  );
});

function operatingSystemErrorCode(error) {
  return error !== null &&
    typeof error === "object" &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function unavailableCapabilityCode(capability, error) {
  const code = operatingSystemErrorCode(error);
  return code !== undefined &&
    FILESYSTEM_CAPABILITY_UNAVAILABLE_CODES[capability].has(code)
    ? code
    : undefined;
}

async function tryCreateSymbolicLink(target, path, type) {
  try {
    await symlink(target, path, type);
    return { created: true };
  } catch (error) {
    const code = unavailableCapabilityCode("symbolicLink", error);
    if (code !== undefined) {
      return { created: false, code };
    }
    throw error;
  }
}

async function requireSymbolicLink(t, target, path, type) {
  const result = await tryCreateSymbolicLink(target, path, type);
  if (!result.created) {
    t.skip(`Symbolic links are unavailable (${result.code}).`);
    return false;
  }
  return true;
}

async function requireHardLink(t, existingPath, newPath) {
  try {
    await link(existingPath, newPath);
    return true;
  } catch (error) {
    const code = unavailableCapabilityCode("hardLink", error);
    if (code === undefined) {
      throw error;
    }
    t.skip(`Hard links are unavailable (${code}).`);
    return false;
  }
}

async function requirePortableNameAlias(t, path) {
  try {
    await writeFile(path, "ambiguous sibling", {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch (error) {
    const code = unavailableCapabilityCode(
      "portableNameAlias",
      error,
    );
    if (code === undefined) {
      throw error;
    }
    t.skip(
      `The current filesystem cannot represent this portable name alias (${code}).`,
    );
    return false;
  }
}

async function requireExactUtf8FileName(
  t,
  directory,
  name,
  contents,
) {
  try {
    await writeFile(join(directory, name), contents, {
      flag: "wx",
    });
    const expectedBytes = Buffer.from(name, "utf8");
    const entries = await readdir(directory, {
      encoding: "buffer",
    });
    if (
      entries.some((entry) =>
        Buffer.from(entry).equals(expectedBytes),
      )
    ) {
      return true;
    }
    t.skip(
      "The current filesystem does not preserve this UTF-8 filename exactly.",
    );
    return false;
  } catch (error) {
    const code = unavailableCapabilityCode(
      "exactUtf8Name",
      error,
    );
    if (code === undefined) {
      throw error;
    }
    t.skip(
      `The current filesystem cannot represent this exact UTF-8 filename (${code}).`,
    );
    return false;
  }
}

function assertValid(result) {
  assert.equal(result.valid, true, validationMessage(result));
  return result.value;
}

function assertInvalid(result, expectedCode) {
  assert.equal(result.valid, false, "Expected source loading to fail.");
  assert.equal(
    result.diagnostics.some(({ code }) => code === expectedCode),
    true,
    `Expected ${expectedCode} in ${validationMessage(result)}.`,
  );
  return result.diagnostics;
}

function assertDeeplyFrozen(value, seen = new Set()) {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    assertDeeplyFrozen(child, seen);
  }
}

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (value === null || typeof value !== "object") {
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return output;
  }
  for (const item of Object.values(value)) {
    collectStrings(item, output);
  }
  return output;
}

async function assertPrivateDiagnostics(result, publicationRoot) {
  const absoluteSpellings = new Set([
    publicationRoot,
    await realpath(dirname(publicationRoot)),
  ]);
  try {
    absoluteSpellings.add(await realpath(publicationRoot));
  } catch {
    // A missing root has no second spelling to inspect.
  }

  for (const value of collectStrings(result.diagnostics)) {
    for (const absolutePath of absoluteSpellings) {
      assert.equal(
        value.includes(absolutePath),
        false,
        `Diagnostic leaked absolute path ${absolutePath}: ${value}`,
      );
    }
  }
  assertDeeplyFrozen(result);
}

async function copyFixture(t, name) {
  const temporaryParent = await mkdtemp(
    join(tmpdir(), "genii-publisher-source-loader-"),
  );
  t.after(() => rm(temporaryParent, { force: true, recursive: true }));
  const publicationRoot = join(temporaryParent, name);
  await cp(join(fixtureRoot, name), publicationRoot, {
    recursive: true,
  });
  return publicationRoot;
}

async function emptyTemporaryDirectory(t, label) {
  const temporaryParent = await mkdtemp(
    join(tmpdir(), "genii-publisher-source-loader-"),
  );
  t.after(() => rm(temporaryParent, { force: true, recursive: true }));
  const directory = join(temporaryParent, label);
  await mkdir(directory);
  return directory;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loaderInput(publicationRoot) {
  return { publicationRoot };
}

function identityWith(identity, changes) {
  return Object.freeze({
    ...identity,
    ...changes,
  });
}

function wrapNodeFileSystem(overrides = {}) {
  return Object.freeze({
    lstat: (absolutePath) =>
      overrides.lstat === undefined
        ? nodePublicationFileSystem.lstat(absolutePath)
        : overrides.lstat(
            absolutePath,
            nodePublicationFileSystem.lstat,
          ),
    openReadOnlyNoFollow: (absolutePath) =>
      overrides.openReadOnlyNoFollow === undefined
        ? nodePublicationFileSystem.openReadOnlyNoFollow(absolutePath)
        : overrides.openReadOnlyNoFollow(
            absolutePath,
            nodePublicationFileSystem.openReadOnlyNoFollow,
          ),
    readDirectoryNames: (
      absolutePath,
      maximumEntries,
      maximumNameBytes,
    ) =>
      overrides.readDirectoryNames === undefined
        ? nodePublicationFileSystem.readDirectoryNames(
            absolutePath,
            maximumEntries,
            maximumNameBytes,
          )
        : overrides.readDirectoryNames(
            absolutePath,
            maximumEntries,
            maximumNameBytes,
            nodePublicationFileSystem.readDirectoryNames,
          ),
    realpath: (absolutePath) =>
      overrides.realpath === undefined
        ? nodePublicationFileSystem.realpath(absolutePath)
        : overrides.realpath(
            absolutePath,
            nodePublicationFileSystem.realpath,
          ),
  });
}

function directoryBudgetTotals(directoryReads) {
  assert.equal(
    new Set(directoryReads.map(({ logicalPath }) => logicalPath)).size,
    directoryReads.length,
    "The aggregate-budget seam unexpectedly re-read a cached directory.",
  );
  return directoryReads.reduce(
    (totals, read) => ({
      entries: totals.entries + read.entryCount,
      nameBytes: totals.nameBytes + read.nameBytes,
      pathBytes: totals.pathBytes + read.pathBytes,
      snapshots: totals.snapshots + 1,
    }),
    {
      entries: 0,
      nameBytes: 0,
      pathBytes: 0,
      snapshots: 0,
    },
  );
}

async function virtualPublicationFileSystem(
  t,
  label,
  sourceFiles,
) {
  const publicationRoot = await emptyTemporaryDirectory(t, label);
  const realRoot = await realpath(publicationRoot);
  const fileBytes = new Map();
  const directories = new Set([realRoot]);
  const children = new Map([[realRoot, new Set()]]);

  function ensureDirectory(absolutePath) {
    if (directories.has(absolutePath)) {
      return;
    }
    const parent = dirname(absolutePath);
    assert.ok(
      absolutePath.startsWith(`${realRoot}${sep}`),
      `Virtual directory escaped its publication root: ${absolutePath}`,
    );
    ensureDirectory(parent);
    directories.add(absolutePath);
    children.set(absolutePath, new Set());
    children.get(parent).add(basename(absolutePath));
  }

  for (const [logicalPath, contents] of sourceFiles) {
    const absolutePath = resolve(
      realRoot,
      ...logicalPath.split("/"),
    );
    assert.ok(
      absolutePath.startsWith(`${realRoot}${sep}`),
      `Virtual source escaped its publication root: ${logicalPath}`,
    );
    ensureDirectory(dirname(absolutePath));
    children.get(dirname(absolutePath)).add(basename(absolutePath));
    fileBytes.set(
      absolutePath,
      Buffer.from(contents, "utf8"),
    );
  }

  const identities = new Map();
  let inode = 10n;
  for (const absolutePath of [
    ...[...directories].sort(),
    ...[...fileBytes.keys()].sort(),
  ]) {
    const bytes = fileBytes.get(absolutePath);
    identities.set(
      absolutePath,
      Object.freeze({
        dev: 1n,
        ino: inode,
        mode: bytes === undefined ? 0o40755n : 0o100644n,
        nlink: 1n,
        size: BigInt(bytes?.byteLength ?? 0),
        mtimeNs: 1n,
        ctimeNs: 1n,
        kind: bytes === undefined ? "directory" : "file",
      }),
    );
    inode += 1n;
  }

  const telemetry = {
    directoryReads: [],
    openedByteTotal: 0,
    openedPaths: [],
  };

  function logicalPath(absolutePath) {
    return relative(realRoot, absolutePath)
      .split(sep)
      .join("/");
  }

  function requiredIdentity(absolutePath) {
    const identity = identities.get(resolve(absolutePath));
    if (identity !== undefined) {
      return identity;
    }
    const error = new Error(`Missing virtual path: ${absolutePath}`);
    error.code = "ENOENT";
    throw error;
  }

  const fileSystem = Object.freeze({
    lstat: async (absolutePath) =>
      requiredIdentity(absolutePath),
    openReadOnlyNoFollow: async (absolutePath) => {
      const normalizedPath = resolve(absolutePath);
      const bytes = fileBytes.get(normalizedPath);
      if (bytes === undefined) {
        requiredIdentity(normalizedPath);
        const error = new Error(
          `Virtual path is not a file: ${absolutePath}`,
        );
        error.code = "EISDIR";
        throw error;
      }
      const identity = requiredIdentity(normalizedPath);
      telemetry.openedPaths.push(logicalPath(normalizedPath));
      telemetry.openedByteTotal += bytes.byteLength;
      return Object.freeze({
        close: async () => {},
        readFile: async (maximumBytes, expectedBytes) => {
          const capacity = Math.min(
            maximumBytes + 1,
            expectedBytes + 1,
          );
          return new Uint8Array(bytes.subarray(0, capacity));
        },
        stat: async () => identity,
      });
    },
    readDirectoryNames: async (
      absolutePath,
      maximumEntries,
      maximumNameBytes,
    ) => {
      const normalizedPath = resolve(absolutePath);
      const identity = requiredIdentity(normalizedPath);
      assert.equal(identity.kind, "directory");
      const names = [...children.get(normalizedPath)]
        .sort()
        .map((name) => textEncoder.encode(name));
      const nameBytes = names.reduce(
        (total, name) => total + name.byteLength,
        0,
      );
      telemetry.directoryReads.push({
        logicalPath: logicalPath(normalizedPath),
        entryCount: names.length,
        nameBytes,
        pathBytes: textEncoder.encode(
          logicalPath(normalizedPath),
        ).byteLength,
      });
      if (
        names.length > maximumEntries ||
        nameBytes > maximumNameBytes
      ) {
        return Object.freeze({ complete: false });
      }
      return Object.freeze({
        complete: true,
        names: Object.freeze(names),
      });
    },
    realpath: async (absolutePath) => {
      const normalizedPath = resolve(absolutePath);
      requiredIdentity(normalizedPath);
      return normalizedPath;
    },
  });

  return {
    fileSystem,
    publicationRoot: realRoot,
    telemetry,
  };
}

function aggregateLimitPublication(
  workIds,
  collectionIds = [],
  options = {},
) {
  return {
    $schema:
      "https://publisher.genii.foundation/schemas/publication.schema.json",
    schemaVersion: "1.0",
    publication: {
      id: "aggregate-limit-publication",
      title: "Aggregate Limit Publication",
      language: "en",
      publisher: {
        name: "Aggregate Limit Press",
      },
    },
    engine: {
      compatibility: ">=0.1.0-alpha.0 <2.0.0",
    },
    layout: options.nestedCollectionManifests
      ? {
          mode: "declared",
          overrides: {
            collections: {
              manifestTemplate:
                "{collectionId}/d/collection.json",
            },
          },
        }
      : {
          mode: "canonical",
        },
    works: workIds.map((id) => ({ id })),
    collections: collectionIds.map((id) => ({ id })),
    routes: {
      home: "/",
      work: "/works/{workId}",
      collection: "/collections/{collectionId}",
    },
    continuity: {
      redirects: [],
    },
    boundaries: {
      sourceRoots: ["publication"],
      outputRoots: [".publisher"],
    },
    attribution: {
      placement: "footer",
      copyright: "Copyright 2026 GENII Foundation",
      text: "Published with GENII Publisher",
      url: "https://publisher.genii.foundation",
      sourceCodeUrl:
        "https://github.com/genii-foundation/publisher",
    },
  };
}

function aggregateLimitWork(id, manuscript) {
  return {
    $schema:
      "https://publisher.genii.foundation/schemas/work.schema.json",
    schemaVersion: "1.0",
    id,
    title: `Work ${id}`,
    language: "en",
    publicationState: "published",
    route: `/works/${id}`,
    manuscript,
  };
}

function aggregateLimitCollection(id, workId) {
  return {
    $schema:
      "https://publisher.genii.foundation/schemas/collection.schema.json",
    schemaVersion: "1.0",
    id,
    title: `Collection ${id}`,
    publicationState: "published",
    route: `/collections/${id}`,
    workIds: [workId],
  };
}

function aggregateLimitIds(prefix, count) {
  return Array.from(
    { length: count },
    (_, index) =>
      `${prefix}${index.toString(36).padStart(3, "0")}`,
  );
}

test("loads canonical and declared publications from arbitrary absolute roots with exact deterministic sources", async (t) => {
  for (const [fixtureName, expectedPaths] of [
    ["canonical-field-notes", CANONICAL_PATHS],
    ["declared-night-dispatch", DECLARED_PATHS],
  ]) {
    await t.test(fixtureName, async (t) => {
      const publicationRoot = await copyFixture(t, fixtureName);
      assert.equal(publicationRoot.startsWith(repositoryRoot), false);

      const result = await loadPublicationCompilationSources(
        loaderInput(publicationRoot),
      );
      const loaded = assertValid(result);

      assert.deepEqual(
        loaded.sources.map(({ path }) => path),
        expectedPaths,
      );
      assert.deepEqual(
        loaded.sources.map(({ role }) => role),
        expectedPaths.map((path, index) => {
          if (index === 0) {
            return "publication-manifest";
          }
          if (path.endsWith(".md")) {
            return "manuscript";
          }
          return path.includes("collection") ||
            path.includes("/lists/") ||
            path.startsWith("lists/")
            ? "collection-manifest"
            : "work-manifest";
        }),
      );

      for (const source of loaded.sources) {
        const expectedBytes = await readFile(
          join(publicationRoot, source.path),
        );
        assert.deepEqual(
          Buffer.from(source.rawBytes),
          expectedBytes,
          `${source.path} did not preserve its exact bytes`,
        );
        assert.equal(
          source.contents,
          textDecoder.decode(expectedBytes),
          `${source.path} did not preserve its exact UTF-8 text`,
        );
        assert.equal(Object.isFrozen(source), true);
      }

      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(loaded), true);
      assert.equal(Object.isFrozen(loaded.sources), true);
      assert.equal(Object.isFrozen(loaded.publication), true);
      assert.equal(Object.isFrozen(loaded.sourceGraph), true);
      assertDeeplyFrozen(loaded.publication);
      assertDeeplyFrozen(loaded.sourceGraph);
      assert.equal(JSON.stringify(loaded).includes(publicationRoot), false);
    });
  }
});

test("does not discover, import, or traverse undeclared hostile repository entries", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const outside = await emptyTemporaryDirectory(t, "outside");
  const hostileText = "HOSTILE_SENTINEL_MUST_NOT_BE_READ";
  await writeFile(
    join(publicationRoot, "publisher.config.ts"),
    `throw new Error(${JSON.stringify(hostileText)});\n`,
    "utf8",
  );
  await writeFile(
    join(publicationRoot, "private-secret.txt"),
    hostileText,
    "utf8",
  );
  await writeFile(join(outside, "escape.txt"), hostileText, "utf8");
  const undeclaredSymbolicLink = await tryCreateSymbolicLink(
    join(outside, "escape.txt"),
    join(
      publicationRoot,
      "publication",
      "works",
      "rain-gauge",
      "undeclared-link",
    ),
    "file",
  );
  if (!undeclaredSymbolicLink.created) {
    t.diagnostic(
      `Undeclared symbolic-link probe omitted because symbolic links are unavailable (${undeclaredSymbolicLink.code}).`,
    );
  }
  await mkdir(
    join(publicationRoot, "publication", "works", "undeclared-work"),
    { recursive: true },
  );
  await writeFile(
    join(
      publicationRoot,
      "publication",
      "works",
      "undeclared-work",
      "work.json",
    ),
    "{not json",
    "utf8",
  );

  const loaded = assertValid(
    await loadPublicationCompilationSources(loaderInput(publicationRoot)),
  );
  assert.deepEqual(
    loaded.sources.map(({ path }) => path),
    CANONICAL_PATHS,
  );
  assert.equal(
    loaded.sources.some(({ contents }) => contents.includes(hostileText)),
    false,
  );
});

test("never inspects publisher.config.ts when a manifest declares it as source", async (t) => {
  for (const role of ["work-manifest", "manuscript"]) {
    await t.test(role, async (t) => {
      const publicationRoot = await copyFixture(
        t,
        "canonical-field-notes",
      );
      const configPath = join(
        publicationRoot,
        "publisher.config.ts",
      );
      const sentinel = "RESERVED_HOST_CONFIG_SENTINEL";
      await writeFile(configPath, sentinel, "utf8");
      if (role === "work-manifest") {
        const publicationPath = join(
          publicationRoot,
          "publication.json",
        );
        const publication = await readJson(publicationPath);
        publication.works[0].manifest = "publisher.config.ts";
        await writeJson(publicationPath, publication);
      } else {
        const workPath = join(
          publicationRoot,
          "publication",
          "works",
          "rain-gauge",
          "work.json",
        );
        const work = await readJson(workPath);
        work.manuscript = {
          path: "publisher.config.ts",
          relativeTo: "repository",
        };
        await writeJson(workPath, work);
      }

      const configAccesses = [];
      const observe = (operation, absolutePath) => {
        if (absolutePath === configPath) {
          configAccesses.push(operation);
        }
      };
      const fileSystem = wrapNodeFileSystem({
        lstat: async (absolutePath, next) => {
          observe("lstat", absolutePath);
          return next(absolutePath);
        },
        openReadOnlyNoFollow: async (absolutePath, next) => {
          observe("open", absolutePath);
          return next(absolutePath);
        },
        realpath: async (absolutePath, next) => {
          observe("realpath", absolutePath);
          return next(absolutePath);
        },
      });
      const result =
        await loadPublicationCompilationSourcesWithFileSystem(
          loaderInput(publicationRoot),
          fileSystem,
        );
      assertInvalid(result, "source.path_reserved");
      assert.deepEqual(configAccesses, []);
      assert.equal(
        JSON.stringify(result.diagnostics).includes(sentinel),
        false,
      );
      await assertPrivateDiagnostics(result, publicationRoot);
    });
  }
});

test("rejects invalid input without invoking accessors", async () => {
  assertInvalid(
    await loadPublicationCompilationSources(undefined),
    "loader.input.invalid",
  );
  assertInvalid(
    await loadPublicationCompilationSources({
      publicationRoot: "relative/publication",
    }),
    "loader.root.relative",
  );
  assertInvalid(
    await loadPublicationCompilationSources({
      publicationRoot: resolve("/tmp/publication"),
      extra: true,
    }),
    "loader.input.invalid",
  );

  let getterCalls = 0;
  const accessorInput = {
    get publicationRoot() {
      getterCalls += 1;
      throw new Error("must not execute");
    },
  };
  assertInvalid(
    await loadPublicationCompilationSources(accessorInput),
    "loader.input.invalid",
  );
  assert.equal(getterCalls, 0);
});

test("rejects missing, non-directory, and symbolic-link publication roots without leaking absolute paths", async (t) => {
  const directory = await emptyTemporaryDirectory(t, "roots");
  const missing = join(directory, "missing-publication");
  const missingResult = await loadPublicationCompilationSources(
    loaderInput(missing),
  );
  assertInvalid(missingResult, "loader.root.missing");
  await assertPrivateDiagnostics(missingResult, missing);

  const fileRoot = join(directory, "publication-file");
  await writeFile(fileRoot, "not a directory", "utf8");
  const fileResult = await loadPublicationCompilationSources(
    loaderInput(fileRoot),
  );
  assertInvalid(fileResult, "loader.root.not_directory");
  await assertPrivateDiagnostics(fileResult, fileRoot);

  const realRoot = join(directory, "real-publication");
  await mkdir(realRoot);
  for (const noncanonicalRealRoot of [
    `${realRoot}${sep}`,
    `${realRoot}${sep}.${sep}`,
    `${realRoot}${sep}..${sep}real-publication`,
  ]) {
    const result = await loadPublicationCompilationSources(
      loaderInput(noncanonicalRealRoot),
    );
    assertInvalid(result, "loader.root.noncanonical");
    await assertPrivateDiagnostics(result, noncanonicalRealRoot);
  }

  const linkRoot = join(directory, "linked-publication");
  if (
    !(await requireSymbolicLink(
      t,
      realRoot,
      linkRoot,
      "dir",
    ))
  ) {
    return;
  }
  const linkResult = await loadPublicationCompilationSources(
    loaderInput(linkRoot),
  );
  assertInvalid(linkResult, "loader.root.symlink");
  await assertPrivateDiagnostics(linkResult, linkRoot);

  for (const noncanonicalLinkRoot of [
    `${linkRoot}${sep}`,
    `${linkRoot}${sep}.${sep}`,
    `${linkRoot}${sep}..${sep}linked-publication`,
  ]) {
    const result = await loadPublicationCompilationSources(
      loaderInput(noncanonicalLinkRoot),
    );
    assertInvalid(result, "loader.root.noncanonical");
    await assertPrivateDiagnostics(result, noncanonicalLinkRoot);
  }
});

test("rejects missing sources, malformed JSON, and malformed UTF-8 with private deterministic diagnostics", async (t) => {
  await t.test("missing required manifest", async (t) => {
    const publicationRoot = await copyFixture(
      t,
      "canonical-field-notes",
    );
    await unlink(
      join(
        publicationRoot,
        "publication",
        "works",
        "rain-gauge",
        "work.json",
      ),
    );
    const result = await loadPublicationCompilationSources(
      loaderInput(publicationRoot),
    );
    assertInvalid(result, "loader.source.missing");
    await assertPrivateDiagnostics(result, publicationRoot);
  });

  for (const [label, relativePath] of [
    ["publication manifest", "publication.json"],
    [
      "work manifest",
      "publication/works/rain-gauge/work.json",
    ],
  ]) {
    await t.test(`malformed JSON in ${label}`, async (t) => {
      const publicationRoot = await copyFixture(
        t,
        "canonical-field-notes",
      );
      await writeFile(
        join(publicationRoot, relativePath),
        "{\"unterminated\":",
        "utf8",
      );
      const result = await loadPublicationCompilationSources(
        loaderInput(publicationRoot),
      );
      assertInvalid(result, "loader.manifest.json_invalid");
      await assertPrivateDiagnostics(result, publicationRoot);
    });
  }

  for (const [label, relativePath] of [
    ["publication manifest", "publication.json"],
    [
      "work manifest",
      "publication/works/rain-gauge/work.json",
    ],
  ]) {
    await t.test(
      `escaped-equivalent duplicate member in ${label}`,
      async (t) => {
        const publicationRoot = await copyFixture(
          t,
          "canonical-field-notes",
        );
        const manifestPath = join(publicationRoot, relativePath);
        const contents = await readFile(manifestPath, "utf8");
        const duplicated = contents.replace(
          '  "schemaVersion": "1.0",',
          '  "\\u0073chemaVersion": "1.0",\n  "schemaVersion": "1.0",',
        );
        assert.notEqual(duplicated, contents);
        await writeFile(manifestPath, duplicated, "utf8");

        const result = await loadPublicationCompilationSources(
          loaderInput(publicationRoot),
        );
        const diagnostics = assertInvalid(
          result,
          "loader.manifest.json_duplicate_member",
        );
        const duplicate = diagnostics.find(
          ({ code }) =>
            code === "loader.manifest.json_duplicate_member",
        );
        assert.equal(duplicate.path, "/schemaVersion");
        assert.equal(
          duplicate.params.parserCode,
          "json.duplicate_member",
        );
        assert.equal(duplicate.documentPath, relativePath);
        await assertPrivateDiagnostics(result, publicationRoot);
      },
    );
  }

  await t.test(
    "escaped lone surrogate in a manifest string",
    async (t) => {
      const publicationRoot = await copyFixture(
        t,
        "canonical-field-notes",
      );
      const relativePath = "publication.json";
      const manifestPath = join(publicationRoot, relativePath);
      const contents = await readFile(manifestPath, "utf8");
      const invalidUnicode = contents.replace(
        '"schemaVersion": "1.0"',
        '"schemaVersion": "\\ud800"',
      );
      assert.notEqual(invalidUnicode, contents);
      await writeFile(manifestPath, invalidUnicode, "utf8");

      const result = await loadPublicationCompilationSources(
        loaderInput(publicationRoot),
      );
      const diagnostics = assertInvalid(
        result,
        "loader.manifest.json_invalid",
      );
      const invalid = diagnostics.find(
        ({ code }) => code === "loader.manifest.json_invalid",
      );
      assert.equal(invalid.path, "/schemaVersion");
      assert.equal(
        invalid.params.parserCode,
        "json.unpaired_surrogate",
      );
      assert.equal(invalid.documentPath, relativePath);
      await assertPrivateDiagnostics(result, publicationRoot);
    },
  );

  await t.test("malformed manuscript UTF-8", async (t) => {
    const publicationRoot = await copyFixture(
      t,
      "canonical-field-notes",
    );
    await writeFile(
      join(
        publicationRoot,
        "publication",
        "works",
        "rain-gauge",
        "manuscript.md",
      ),
      Uint8Array.from([0x23, 0x20, 0xc3, 0x28]),
    );
    const result = await loadPublicationCompilationSources(
      loaderInput(publicationRoot),
    );
    assertInvalid(result, "loader.source.utf8_invalid");
    await assertPrivateDiagnostics(result, publicationRoot);
  });
});

test("maps strict JSON depth and token ceilings to deterministic loader diagnostics", async (t) => {
  const cases = [
    {
      label: "depth",
      contents:
        "[".repeat(STRICT_JSON_LIMITS.maximumDepth + 1) +
        "0" +
        "]".repeat(STRICT_JSON_LIMITS.maximumDepth + 1),
      path: "/0".repeat(STRICT_JSON_LIMITS.maximumDepth),
      keyword: "maximumDepth",
      params: {
        maximumDepth: STRICT_JSON_LIMITS.maximumDepth,
        offset: STRICT_JSON_LIMITS.maximumDepth,
        logicalPath: "publication.json",
        parserCode:
          STRICT_JSON_DIAGNOSTIC_CODES.depthExceeded,
      },
    },
    {
      label: "token",
      contents:
        "[" +
        "0,".repeat(STRICT_JSON_LIMITS.maximumTokens) +
        "0]",
      path: `/${STRICT_JSON_LIMITS.maximumTokens - 1}`,
      keyword: "maximumTokens",
      params: {
        kind: "scalar",
        maximumTokens: STRICT_JSON_LIMITS.maximumTokens,
        offset: STRICT_JSON_LIMITS.maximumTokens * 2 - 1,
        logicalPath: "publication.json",
        parserCode:
          STRICT_JSON_DIAGNOSTIC_CODES.tokenLimitExceeded,
      },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.label, async (t) => {
      assert.ok(
        Buffer.byteLength(fixture.contents, "utf8") <=
          PUBLISHER_SOURCE_LOADER_LIMITS.maximumManifestBytes,
        "The parser-limit fixture crossed the earlier manifest byte limit.",
      );
      const publicationRoot = await copyFixture(
        t,
        "canonical-field-notes",
      );
      await writeFile(
        join(publicationRoot, "publication.json"),
        fixture.contents,
        "utf8",
      );
      const openedPaths = [];
      const fileSystem = wrapNodeFileSystem({
        openReadOnlyNoFollow: async (absolutePath, next) => {
          openedPaths.push(absolutePath);
          return next(absolutePath);
        },
      });

      const result =
        await loadPublicationCompilationSourcesWithFileSystem(
          loaderInput(publicationRoot),
          fileSystem,
        );
      const diagnostics = assertInvalid(
        result,
        "loader.manifest.json_limit_exceeded",
      );
      assert.equal(diagnostics.length, 1);
      const diagnostic = diagnostics[0];
      assert.equal(
        diagnostic.code,
        "loader.manifest.json_limit_exceeded",
      );
      assert.equal(diagnostic.documentPath, "publication.json");
      assert.equal(diagnostic.path, fixture.path);
      assert.equal(diagnostic.keyword, fixture.keyword);
      assert.deepEqual(diagnostic.params, fixture.params);
      assert.deepEqual(
        openedPaths,
        [
          join(
            await realpath(publicationRoot),
            "publication.json",
          ),
        ],
        "The parser limit did not stop later source I/O.",
      );
      await assertPrivateDiagnostics(result, publicationRoot);
    });
  }
});

test("rejects symbolic-link parents, symbolic-link files, and nonregular declared sources", async (t) => {
  await t.test("symbolic-link parent", async (t) => {
    const publicationRoot = await copyFixture(
      t,
      "canonical-field-notes",
    );
    const worksRoot = join(publicationRoot, "publication", "works");
    const original = join(worksRoot, "rain-gauge");
    const target = join(worksRoot, "rain-gauge-target");
    await rename(original, target);
    if (
      !(await requireSymbolicLink(
        t,
        target,
        original,
        "dir",
      ))
    ) {
      return;
    }

    const result = await loadPublicationCompilationSources(
      loaderInput(publicationRoot),
    );
    assertInvalid(result, "loader.path.symlink");
    await assertPrivateDiagnostics(result, publicationRoot);
  });

  await t.test("symbolic-link final source", async (t) => {
    const publicationRoot = await copyFixture(
      t,
      "canonical-field-notes",
    );
    const workRoot = join(
      publicationRoot,
      "publication",
      "works",
      "rain-gauge",
    );
    const original = join(workRoot, "work.json");
    const target = join(workRoot, "work-target.json");
    await rename(original, target);
    if (
      !(await requireSymbolicLink(
        t,
        target,
        original,
        "file",
      ))
    ) {
      return;
    }

    const result = await loadPublicationCompilationSources(
      loaderInput(publicationRoot),
    );
    assertInvalid(result, "loader.path.symlink");
    await assertPrivateDiagnostics(result, publicationRoot);
  });

  await t.test("nonregular final source", async (t) => {
    const publicationRoot = await copyFixture(
      t,
      "canonical-field-notes",
    );
    const manuscript = join(
      publicationRoot,
      "publication",
      "works",
      "rain-gauge",
      "manuscript.md",
    );
    await unlink(manuscript);
    await mkdir(manuscript);

    const result = await loadPublicationCompilationSources(
      loaderInput(publicationRoot),
    );
    assertInvalid(result, "loader.source.not_file");
    await assertPrivateDiagnostics(result, publicationRoot);
  });
});

test("a regular source swapped to a FIFO cannot block descriptor opening", async (t) => {
  const commandProbe = spawnSync("mkfifo", [], {
    encoding: "utf8",
  });
  if (commandProbe.error !== undefined) {
    const code = unavailableCapabilityCode(
      "fifo",
      commandProbe.error,
    );
    if (code !== undefined) {
      t.skip(`FIFO creation is unavailable (${code}).`);
      return;
    }
    throw commandProbe.error;
  }
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const relativeManuscript =
    "publication/works/rain-gauge/manuscript.md";
  const manuscriptPath = join(
    publicationRoot,
    relativeManuscript,
  );
  const originalIdentity =
    await nodePublicationFileSystem.lstat(manuscriptPath);
  await unlink(manuscriptPath);
  const fifo = spawnSync("mkfifo", [manuscriptPath], {
    encoding: "utf8",
  });
  if (fifo.error !== undefined) {
    const code = unavailableCapabilityCode("fifo", fifo.error);
    if (code !== undefined) {
      t.skip(`FIFO creation is unavailable (${code}).`);
      return;
    }
    throw fifo.error;
  }
  assert.equal(
    fifo.status,
    0,
    `${fifo.stdout}\n${fifo.stderr}`,
  );
  const realRoot = await realpath(publicationRoot);
  const realManuscriptPath = join(
    realRoot,
    relativeManuscript,
  );
  const serializedIdentity = JSON.stringify({
    ...originalIdentity,
    dev: originalIdentity.dev.toString(),
    ino: originalIdentity.ino.toString(),
    mode: originalIdentity.mode.toString(),
    nlink: originalIdentity.nlink.toString(),
    size: originalIdentity.size.toString(),
    mtimeNs: originalIdentity.mtimeNs.toString(),
    ctimeNs: originalIdentity.ctimeNs.toString(),
  });
  const childSource = `
import {
  nodePublicationFileSystem,
} from ${JSON.stringify(
    new URL(
      "../packages/publisher/dist/node/filesystem-identity.js",
      import.meta.url,
    ).href,
  )};
import {
  loadPublicationCompilationSourcesWithFileSystem,
} from ${JSON.stringify(
    new URL(
      "../packages/publisher/dist/node/loader.js",
      import.meta.url,
    ).href,
  )};

const serialized = JSON.parse(process.env.PUBLISHER_FIFO_IDENTITY);
const identity = Object.freeze({
  ...serialized,
  dev: BigInt(serialized.dev),
  ino: BigInt(serialized.ino),
  mode: BigInt(serialized.mode),
  nlink: BigInt(serialized.nlink),
  size: BigInt(serialized.size),
  mtimeNs: BigInt(serialized.mtimeNs),
  ctimeNs: BigInt(serialized.ctimeNs),
});
const target = process.env.PUBLISHER_FIFO_PATH;
const fileSystem = Object.freeze({
  ...nodePublicationFileSystem,
  lstat: (absolutePath) =>
    absolutePath === target
      ? Promise.resolve(identity)
      : nodePublicationFileSystem.lstat(absolutePath),
});
const result =
  await loadPublicationCompilationSourcesWithFileSystem(
    { publicationRoot: process.env.PUBLISHER_FIFO_ROOT },
    fileSystem,
  );
process.stdout.write(JSON.stringify(result));
`;
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", childSource],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PUBLISHER_FIFO_IDENTITY: serializedIdentity,
        PUBLISHER_FIFO_PATH: realManuscriptPath,
        PUBLISHER_FIFO_ROOT: publicationRoot,
      },
      timeout: 5_000,
    },
  );
  assert.equal(
    child.error?.code,
    undefined,
    `FIFO child did not terminate: ${child.error?.message}`,
  );
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assertInvalid(result, "loader.source.changed");
  assert.equal(
    result.diagnostics.some(
      ({ params }) => params.reason === "openIdentityMismatch",
    ),
    true,
    validationMessage(result),
  );
});

test("enforces exact filesystem spelling and NFC logical paths", async (t) => {
  await t.test("NFC native-script declared paths", async (t) => {
    const publicationRoot = await copyFixture(
      t,
      "canonical-field-notes",
    );
    const publicationPath = join(publicationRoot, "publication.json");
    const publication = await readJson(publicationPath);
    const declaredWorkPath = "出版/作品/第一章/work.json";
    const declaredManuscriptPath = "出版/作品/第一章/原稿.md";
    publication.works[0].manifest = declaredWorkPath;
    publication.boundaries.sourceRoots.push("出版");
    await writeJson(publicationPath, publication);

    const canonicalWorkRoot = join(
      publicationRoot,
      "publication",
      "works",
      "rain-gauge",
    );
    const declaredWorkRoot = join(
      publicationRoot,
      "出版",
      "作品",
      "第一章",
    );
    await mkdir(declaredWorkRoot, { recursive: true });
    const work = await readJson(join(canonicalWorkRoot, "work.json"));
    work.manuscript = "原稿.md";
    await writeJson(join(publicationRoot, declaredWorkPath), work);
    const manuscriptBytes = await readFile(
      join(canonicalWorkRoot, "manuscript.md"),
    );
    await writeFile(
      join(publicationRoot, declaredManuscriptPath),
      manuscriptBytes,
    );

    const result = await loadPublicationCompilationSources(
      loaderInput(publicationRoot),
    );
    const loaded = assertValid(result);
    assert.equal(
      loaded.sourceGraph.works[0].manifestPath,
      declaredWorkPath,
    );
    assert.equal(
      loaded.sourceGraph.works[0].manuscriptPath,
      declaredManuscriptPath,
    );
    assert.deepEqual(
      loaded.sources
        .filter(({ entityId }) => entityId === "rain-gauge")
        .map(({ path }) => path),
      [declaredWorkPath, declaredManuscriptPath],
    );
    assert.deepEqual(
      [
        ...loaded.sources.find(
          ({ path }) => path === declaredManuscriptPath,
        ).rawBytes,
      ],
      [...manuscriptBytes],
    );
  });

  await t.test("Unicode 15.1 NFC is stable across supported Node versions", async (t) => {
    const publicationRoot = await copyFixture(
      t,
      "canonical-field-notes",
    );
    const publicationPath = join(publicationRoot, "publication.json");
    const publication = await readJson(publicationPath);
    const stableName = "q\u{1acf}\u0323.json";
    const stablePath =
      `publication/works/rain-gauge/${stableName}`;
    const workRoot = join(
      publicationRoot,
      "publication",
      "works",
      "rain-gauge",
    );
    await writeFile(
      join(workRoot, stableName),
      await readFile(join(workRoot, "work.json")),
      { flag: "wx" },
    );
    publication.works[0].manifest = stablePath;
    await writeJson(publicationPath, publication);

    const loaded = assertValid(
      await loadPublicationCompilationSources(
        loaderInput(publicationRoot),
      ),
    );
    assert.equal(
      loaded.sourceGraph.works[0].manifestPath,
      stablePath,
    );
  });

  await t.test("leading U+FEFF in a declared filename", async (t) => {
    const publicationRoot = await copyFixture(
      t,
      "canonical-field-notes",
    );
    const publicationPath = join(publicationRoot, "publication.json");
    const publication = await readJson(publicationPath);
    const declaredName = "\ufeffwork.json";
    const declaredPath =
      `publication/works/rain-gauge/${declaredName}`;
    const workRoot = join(
      publicationRoot,
      "publication",
      "works",
      "rain-gauge",
    );
    const workBytes = await readFile(join(workRoot, "work.json"));
    if (
      !(await requireExactUtf8FileName(
        t,
        workRoot,
        declaredName,
        workBytes,
      ))
    ) {
      return;
    }
    publication.works[0].manifest = declaredPath;
    await writeJson(publicationPath, publication);

    const loaded = assertValid(
      await loadPublicationCompilationSources(
        loaderInput(publicationRoot),
      ),
    );
    assert.equal(
      loaded.sourceGraph.works[0].manifestPath,
      declaredPath,
    );
    assert.equal(
      loaded.sources.some(({ path }) => path === declaredPath),
      true,
    );
  });

  await t.test("case spelling mismatch", async (t) => {
    const publicationRoot = await copyFixture(
      t,
      "canonical-field-notes",
    );
    const workRoot = join(
      publicationRoot,
      "publication",
      "works",
      "rain-gauge",
    );
    const expected = join(workRoot, "work.json");
    const intermediate = join(workRoot, "rename-intermediate");
    const mismatched = join(workRoot, "Work.json");
    await rename(expected, intermediate);
    await rename(intermediate, mismatched);

    const result = await loadPublicationCompilationSources(
      loaderInput(publicationRoot),
    );
    assertInvalid(result, "loader.path.spelling_mismatch");
    await assertPrivateDiagnostics(result, publicationRoot);
  });

  await t.test("non-NFC logical path", async (t) => {
    const publicationRoot = await copyFixture(
      t,
      "canonical-field-notes",
    );
    const publicationPath = join(publicationRoot, "publication.json");
    const publication = await readJson(publicationPath);
    const decomposedPath =
      "publication/works/rain-gauge/cafe\u0301.json";
    publication.works[0].manifest = decomposedPath;
    await writeJson(publicationPath, publication);
    await writeFile(
      join(publicationRoot, decomposedPath),
      await readFile(
        join(
          publicationRoot,
          "publication",
          "works",
          "rain-gauge",
          "work.json",
        ),
      ),
    );

    const result = await loadPublicationCompilationSources(
      loaderInput(publicationRoot),
    );
    assertInvalid(result, "path.not_nfc");
    await assertPrivateDiagnostics(result, publicationRoot);
  });
});

test("rejects full Unicode case-fold sibling ambiguity when the filesystem can represent it", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const publicationPath = join(publicationRoot, "publication.json");
  const publication = await readJson(publicationPath);
  const workRoot = join(
    publicationRoot,
    "publication",
    "works",
    "rain-gauge",
  );
  const declaredName = "Straße.json";
  const aliasName = "STRASSE.JSON";
  const declared = join(workRoot, declaredName);
  const alias = join(workRoot, aliasName);
  await writeFile(
    declared,
    await readFile(join(workRoot, "work.json")),
    { flag: "wx" },
  );
  if (!(await requirePortableNameAlias(t, alias))) {
    return;
  }
  publication.works[0].manifest =
    `publication/works/rain-gauge/${declaredName}`;
  await writeJson(publicationPath, publication);

  const result = await loadPublicationCompilationSources(
    loaderInput(publicationRoot),
  );
  assertInvalid(result, "loader.path.identity_ambiguous");
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("rejects case-equivalent sibling ambiguity when the filesystem can represent it", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const workRoot = join(
    publicationRoot,
    "publication",
    "works",
    "rain-gauge",
  );
  const expected = join(workRoot, "work.json");
  const ambiguous = join(workRoot, "WORK.JSON");

  try {
    await writeFile(ambiguous, await readFile(expected), {
      flag: "wx",
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      t.skip(
        "The current filesystem does not permit case-equivalent sibling names.",
      );
      return;
    }
    throw error;
  }

  const result = await loadPublicationCompilationSources(
    loaderInput(publicationRoot),
  );
  assertInvalid(result, "loader.path.identity_ambiguous");
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("rejects Windows trailing-dot and trailing-space sibling aliases when the filesystem can represent them", async (t) => {
  for (const aliasName of ["WORK.JSON.", "work.json "]) {
    await t.test(aliasName, async (t) => {
      const publicationRoot = await copyFixture(
        t,
        "canonical-field-notes",
      );
      const workRoot = join(
        publicationRoot,
        "publication",
        "works",
        "rain-gauge",
      );
      const alias = join(workRoot, aliasName);
      if (!(await requirePortableNameAlias(t, alias))) {
        return;
      }

      const result = await loadPublicationCompilationSources(
        loaderInput(publicationRoot),
      );
      assertInvalid(result, "loader.path.identity_ambiguous");
      await assertPrivateDiagnostics(result, publicationRoot);
    });
  }
});

test("rejects a declared source hard-linked to a file outside the publication root", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const manuscript = join(
    publicationRoot,
    "publication",
    "works",
    "rain-gauge",
    "manuscript.md",
  );
  const outsideSource = join(
    dirname(publicationRoot),
    "outside-manuscript.md",
  );
  await writeFile(outsideSource, "outside source\n", "utf8");
  await unlink(manuscript);
  if (
    !(await requireHardLink(
      t,
      outsideSource,
      manuscript,
    ))
  ) {
    return;
  }

  const result = await loadPublicationCompilationSources(
    loaderInput(publicationRoot),
  );
  const diagnostics = assertInvalid(
    result,
    "loader.source.hard_link",
  );
  const hardLink = diagnostics.find(
    ({ code }) => code === "loader.source.hard_link",
  );
  assert.equal(
    hardLink.documentPath,
    "publication/works/rain-gauge/manuscript.md",
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("rejects two declared sources sharing one hard-link filesystem identity", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const workManifest = join(
    publicationRoot,
    "publication",
    "works",
    "rain-gauge",
    "work.json",
  );
  const collectionManifest = join(
    publicationRoot,
    "publication",
    "collections",
    "weather-observations",
    "collection.json",
  );
  await unlink(collectionManifest);
  if (
    !(await requireHardLink(
      t,
      workManifest,
      collectionManifest,
    ))
  ) {
    return;
  }

  const result = await loadPublicationCompilationSources(
    loaderInput(publicationRoot),
  );
  const diagnostics = assertInvalid(
    result,
    "loader.source.hard_link",
  );
  const hardLink = diagnostics.find(
    ({ code }) => code === "loader.source.hard_link",
  );
  assert.equal(
    hardLink.documentPath,
    "publication/works/rain-gauge/work.json",
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("rejects one logical path assigned to manifest and manuscript roles", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const workManifestPath = join(
    publicationRoot,
    "publication",
    "works",
    "rain-gauge",
    "work.json",
  );
  const work = await readJson(workManifestPath);
  work.manuscript = {
    path: "publication/works/rain-gauge/work.json",
    relativeTo: "repository",
  };
  await writeJson(workManifestPath, work);

  const result = await loadPublicationCompilationSources(
    loaderInput(publicationRoot),
  );
  const diagnostics = assertInvalid(
    result,
    "source.path_owner_collision",
  );
  const duplicate = diagnostics.find(
    ({ code }) => code === "source.path_owner_collision",
  );
  assert.equal(
    duplicate.params.firstRole,
    "work-manifest",
  );
  assert.equal(
    duplicate.params.role,
    "manuscript",
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("uses the installed package version for compatibility and rejects caller forgery", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const publicationPath = join(
    publicationRoot,
    "publication.json",
  );
  const publication = await readJson(publicationPath);
  publication.engine.compatibility = ">=2.0.0 <3.0.0";
  await writeJson(publicationPath, publication);
  const openedPaths = [];
  const fileSystem = wrapNodeFileSystem({
    openReadOnlyNoFollow: async (absolutePath, next) => {
      openedPaths.push(absolutePath);
      return next(absolutePath);
    },
  });
  const incompatible =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  assert.deepEqual(
    openedPaths,
    [join(await realpath(publicationRoot), "publication.json")],
    "Publication preflight must reject an incompatible engine before child manifest I/O.",
  );
  assertInvalid(incompatible, "engine.compatibility.unsatisfied");
  await assertPrivateDiagnostics(incompatible, publicationRoot);

  const forged = await loadPublicationCompilationSources(
    {
      publicationRoot,
      engineVersion: "2.0.0",
    },
  );
  assertInvalid(forged, "loader.input.invalid");
  await assertPrivateDiagnostics(forged, publicationRoot);
});

test("private filesystem seam rejects cross-device traversal without exposing device identities", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const realRoot = await realpath(publicationRoot);
  const publicationPath = join(realRoot, "publication.json");
  const fileSystem = wrapNodeFileSystem({
    lstat: async (absolutePath, next) => {
      const identity = await next(absolutePath);
      return absolutePath === publicationPath
        ? identityWith(identity, { dev: identity.dev + 1n })
        : identity;
    },
  });

  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  assertInvalid(result, "loader.path.cross_device");
  assert.equal(JSON.stringify(result.diagnostics).includes('"dev"'), false);
  assert.equal(JSON.stringify(result.diagnostics).includes('"ino"'), false);
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("node filesystem directory enumeration enforces entry and name-byte bounds", async (t) => {
  const directory = await emptyTemporaryDirectory(
    t,
    "node-directory-enumeration-bounds",
  );
  const entriesDirectory = join(directory, "entries");
  await mkdir(entriesDirectory);
  await writeFile(join(entriesDirectory, "a"), "", "utf8");
  await writeFile(join(entriesDirectory, "b"), "", "utf8");

  const tooManyEntries =
    await nodePublicationFileSystem.readDirectoryNames(
      entriesDirectory,
      1,
      100,
    );
  assert.deepEqual(tooManyEntries, { complete: false });
  const exactEntries =
    await nodePublicationFileSystem.readDirectoryNames(
      entriesDirectory,
      2,
      2,
    );
  assert.equal(exactEntries.complete, true);
  assert.deepEqual(
    exactEntries.names
      .map((name) => textDecoder.decode(name))
      .sort(),
    ["a", "b"],
  );

  const namesDirectory = join(directory, "names");
  await mkdir(namesDirectory);
  await writeFile(join(namesDirectory, "four"), "", "utf8");
  const tooManyNameBytes =
    await nodePublicationFileSystem.readDirectoryNames(
      namesDirectory,
      10,
      3,
    );
  assert.deepEqual(tooManyNameBytes, { complete: false });
  const exactNameBytes =
    await nodePublicationFileSystem.readDirectoryNames(
      namesDirectory,
      1,
      4,
    );
  assert.equal(exactNameBytes.complete, true);
  assert.deepEqual(
    exactNameBytes.names.map((name) => textDecoder.decode(name)),
    ["four"],
  );
});

test("private filesystem seam rejects an over-budget directory before opening source files", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const realRoot = await realpath(publicationRoot);
  let openCalls = 0;
  const fileSystem = wrapNodeFileSystem({
    openReadOnlyNoFollow: async (absolutePath, next) => {
      openCalls += 1;
      return next(absolutePath);
    },
    readDirectoryNames: async (
      absolutePath,
      maximumEntries,
      maximumNameBytes,
      next,
    ) => {
      assert.equal(
        maximumEntries,
        PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectoryEntries,
      );
      assert.equal(
        maximumNameBytes,
        PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectoryNameBytes,
      );
      return absolutePath === realRoot
        ? Object.freeze({ complete: false })
        : next(
            absolutePath,
            maximumEntries,
            maximumNameBytes,
          );
    },
  });
  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  assertInvalid(result, "loader.directory.too_large");
  assert.equal(openCalls, 0);
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("private filesystem seam enforces the aggregate directory-entry budget", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const encoder = new TextEncoder();
  let directoryReads = 0;
  const fileSystem = wrapNodeFileSystem({
    readDirectoryNames: async (
      absolutePath,
      maximumEntries,
      maximumNameBytes,
      next,
    ) => {
      const read = await next(
        absolutePath,
        maximumEntries,
        maximumNameBytes,
      );
      if (!read.complete) {
        return read;
      }
      directoryReads += 1;
      const names = [...read.names];
      while (names.length < maximumEntries) {
        names.push(
          encoder.encode(
            `aggregate-${directoryReads}-${names.length}`,
          ),
        );
      }
      return Object.freeze({
        complete: true,
        names: Object.freeze(names),
      });
    },
  });

  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  assertInvalid(result, "loader.directory_set.too_large");
  assert.ok(
    directoryReads >= 6,
    "The aggregate fixture did not enumerate enough distinct directories.",
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("private filesystem seam independently enforces aggregate directory-name bytes", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const realRoot = await realpath(publicationRoot);
  const directoryReads = [];
  let openCalls = 0;
  const targetNameBytes =
    PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectoryNameBytes - 1;
  const fileSystem = wrapNodeFileSystem({
    openReadOnlyNoFollow: async (absolutePath, next) => {
      openCalls += 1;
      return next(absolutePath);
    },
    readDirectoryNames: async (
      absolutePath,
      maximumEntries,
      maximumNameBytes,
      next,
    ) => {
      const read = await next(
        absolutePath,
        maximumEntries,
        maximumNameBytes,
      );
      if (!read.complete) {
        return read;
      }
      const originalNameBytes = read.names.reduce(
        (total, name) => total + name.byteLength,
        0,
      );
      assert.ok(originalNameBytes < targetNameBytes);
      const filler = new Uint8Array(
        targetNameBytes - originalNameBytes,
      );
      filler.fill(0xff);
      const names = [...read.names, filler];
      directoryReads.push({
        logicalPath: relative(realRoot, absolutePath)
          .split(sep)
          .join("/"),
        entryCount: names.length,
        nameBytes: names.reduce(
          (total, name) => total + name.byteLength,
          0,
        ),
        pathBytes: textEncoder.encode(
          relative(realRoot, absolutePath)
            .split(sep)
            .join("/"),
        ).byteLength,
      });
      return Object.freeze({
        complete: true,
        names: Object.freeze(names),
      });
    },
  });

  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  assertInvalid(result, "loader.directory_set.too_large");

  const beforeFailure = directoryBudgetTotals(
    directoryReads.slice(0, -1),
  );
  const atFailure = directoryBudgetTotals(directoryReads);
  assert.ok(
    beforeFailure.nameBytes <=
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryNameBytesTotal,
  );
  assert.ok(
    atFailure.nameBytes >
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryNameBytesTotal,
  );
  assert.ok(
    atFailure.entries <=
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryEntriesTotal,
  );
  assert.ok(
    atFailure.pathBytes <=
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryPathBytesTotal,
  );
  assert.ok(
    atFailure.snapshots <=
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectorySnapshots,
  );
  assert.ok(
    directoryReads.every(
      ({ entryCount, nameBytes }) =>
        entryCount <=
          PUBLISHER_SOURCE_LOADER_LIMITS
            .maximumDirectoryEntries &&
        nameBytes <=
          PUBLISHER_SOURCE_LOADER_LIMITS
            .maximumDirectoryNameBytes,
    ),
  );
  assert.ok(
    openCalls < CANONICAL_PATHS.length,
    "The loader did not fail before opening every declared source.",
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("private filesystem seam independently enforces aggregate directory-path bytes", async (t) => {
  const workIds = aggregateLimitIds(
    "w",
    PUBLICATION_PROTOCOL_LIMITS.maximumWorks,
  );
  const longSegments = [
    "a".repeat(140),
    "b".repeat(140),
    "c".repeat(140),
  ];
  const manuscriptPath =
    `${longSegments.join("/")}/manuscript.md`;
  const sourceFiles = new Map([
    [
      "publication.json",
      JSON.stringify(aggregateLimitPublication(workIds)),
    ],
  ]);
  for (const workId of workIds) {
    const workRoot = `publication/works/${workId}`;
    sourceFiles.set(
      `${workRoot}/work.json`,
      JSON.stringify(
        aggregateLimitWork(workId, manuscriptPath),
      ),
    );
    sourceFiles.set(
      `${workRoot}/${manuscriptPath}`,
      `# ${workId}\n`,
    );
  }
  const declaredSourceCount = 1 + workIds.length * 2;
  assert.ok(
    declaredSourceCount <=
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumSourceFiles,
  );
  assert.ok(
    Buffer.byteLength(sourceFiles.get("publication.json"), "utf8") <=
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumManifestBytes,
  );

  const {
    fileSystem,
    publicationRoot,
    telemetry,
  } = await virtualPublicationFileSystem(
    t,
    "aggregate-directory-path-bytes",
    sourceFiles,
  );
  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  assertInvalid(result, "loader.directory_set.too_large");

  const beforeFailure = directoryBudgetTotals(
    telemetry.directoryReads.slice(0, -1),
  );
  const atFailure = directoryBudgetTotals(
    telemetry.directoryReads,
  );
  assert.ok(
    beforeFailure.pathBytes <=
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryPathBytesTotal,
  );
  assert.ok(
    atFailure.pathBytes >
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryPathBytesTotal,
  );
  assert.ok(
    atFailure.entries <=
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryEntriesTotal,
  );
  assert.ok(
    atFailure.nameBytes <=
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryNameBytesTotal,
  );
  assert.ok(
    atFailure.snapshots <=
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectorySnapshots,
  );
  assert.ok(
    telemetry.directoryReads.every(
      ({ entryCount, nameBytes }) =>
        entryCount <=
          PUBLISHER_SOURCE_LOADER_LIMITS
            .maximumDirectoryEntries &&
        nameBytes <=
          PUBLISHER_SOURCE_LOADER_LIMITS
            .maximumDirectoryNameBytes,
    ),
  );
  assert.ok(
    telemetry.openedPaths.length < declaredSourceCount,
    "The loader did not fail before opening every declared source.",
  );
  assert.ok(
    telemetry.openedByteTotal <=
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumTotalBytes,
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("private filesystem seam independently enforces aggregate directory snapshots", async (t) => {
  const workIds = aggregateLimitIds(
    "w",
    PUBLICATION_PROTOCOL_LIMITS.maximumWorks,
  );
  const collectionIds = aggregateLimitIds(
    "c",
    PUBLICATION_PROTOCOL_LIMITS.maximumCollections,
  );
  const sourceFiles = new Map([
    [
      "publication.json",
      JSON.stringify(
        aggregateLimitPublication(
          workIds,
          collectionIds,
          { nestedCollectionManifests: true },
        ),
      ),
    ],
  ]);
  for (const workId of workIds) {
    sourceFiles.set(
      `publication/works/${workId}/work.json`,
      JSON.stringify(
        aggregateLimitWork(workId, "manuscript.md"),
      ),
    );
  }
  for (const collectionId of collectionIds) {
    sourceFiles.set(
      `publication/collections/${collectionId}/d/collection.json`,
      JSON.stringify(
        aggregateLimitCollection(collectionId, workIds[0]),
      ),
    );
  }
  const declaredSourceCount =
    1 + workIds.length * 2 + collectionIds.length;
  assert.ok(
    declaredSourceCount <=
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumSourceFiles,
  );
  assert.ok(
    collectionIds.length <=
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumCollectionWorkReferences,
  );
  assert.ok(
    Buffer.byteLength(sourceFiles.get("publication.json"), "utf8") <=
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumManifestBytes,
  );

  const {
    fileSystem,
    publicationRoot,
    telemetry,
  } = await virtualPublicationFileSystem(
    t,
    "aggregate-directory-snapshots",
    sourceFiles,
  );
  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  assertInvalid(result, "loader.directory_set.too_large");

  const beforeFailure = directoryBudgetTotals(
    telemetry.directoryReads.slice(0, -1),
  );
  const atFailure = directoryBudgetTotals(
    telemetry.directoryReads,
  );
  assert.ok(
    beforeFailure.snapshots <=
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectorySnapshots,
  );
  assert.ok(
    atFailure.snapshots >
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectorySnapshots,
  );
  assert.ok(
    atFailure.entries <=
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryEntriesTotal,
  );
  assert.ok(
    atFailure.nameBytes <=
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryNameBytesTotal,
  );
  assert.ok(
    atFailure.pathBytes <=
      PUBLISHER_SOURCE_LOADER_LIMITS
        .maximumDirectoryPathBytesTotal,
  );
  assert.ok(
    telemetry.directoryReads.every(
      ({ entryCount, nameBytes }) =>
        entryCount <=
          PUBLISHER_SOURCE_LOADER_LIMITS
            .maximumDirectoryEntries &&
        nameBytes <=
          PUBLISHER_SOURCE_LOADER_LIMITS
            .maximumDirectoryNameBytes,
    ),
  );
  assert.ok(
    telemetry.openedPaths.length < declaredSourceCount,
    "The loader did not fail before opening every declared source.",
  );
  assert.ok(
    telemetry.openedByteTotal <=
      PUBLISHER_SOURCE_LOADER_LIMITS.maximumTotalBytes,
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("private filesystem seam replaces cached directory counts instead of accumulating them", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const realRoot = await realpath(publicationRoot);
  const worksDirectory = join(
    realRoot,
    "publication",
    "works",
  );
  const collectionManifest = join(
    realRoot,
    "publication",
    "collections",
    "weather-observations",
    "collection.json",
  );
  const encoder = new TextEncoder();
  const targetEntriesPerDirectory = 16_000;
  const readCounts = new Map();
  let replaceWorksDirectory = false;
  const fileSystem = wrapNodeFileSystem({
    lstat: async (absolutePath, next) => {
      const identity = await next(absolutePath);
      return replaceWorksDirectory &&
        absolutePath === worksDirectory
        ? identityWith(identity, { ino: identity.ino + 1n })
        : identity;
    },
    openReadOnlyNoFollow: async (absolutePath, next) => {
      const opened = await next(absolutePath);
      if (absolutePath === collectionManifest) {
        replaceWorksDirectory = true;
      }
      return opened;
    },
    readDirectoryNames: async (
      absolutePath,
      maximumEntries,
      maximumNameBytes,
      next,
    ) => {
      const read = await next(
        absolutePath,
        maximumEntries,
        maximumNameBytes,
      );
      if (!read.complete) {
        return read;
      }
      const readCount = (readCounts.get(absolutePath) ?? 0) + 1;
      readCounts.set(absolutePath, readCount);
      const names = [...read.names];
      while (names.length < targetEntriesPerDirectory) {
        names.push(
          encoder.encode(
            `replacement-${readCount}-${names.length}`,
          ),
        );
      }
      return Object.freeze({
        complete: true,
        names: Object.freeze(names),
      });
    },
  });

  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  const diagnostics = assertInvalid(
    result,
    "loader.source.changed",
  );
  assert.equal(
    diagnostics.some(
      ({ code }) => code === "loader.directory_set.too_large",
    ),
    false,
    "Replacing a cached directory accumulated its old budget.",
  );
  assert.equal(
    readCounts.get(worksDirectory),
    2,
    "The changed directory was not enumerated exactly once per identity.",
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("private filesystem seam detects root replacement at the final identity pass", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const realRoot = await realpath(publicationRoot);
  let replaceRoot = false;
  let rootRealpathReads = 0;
  const fileSystem = wrapNodeFileSystem({
    lstat: async (absolutePath, next) => {
      const identity = await next(absolutePath);
      return replaceRoot &&
        (absolutePath === publicationRoot ||
          absolutePath === realRoot)
        ? identityWith(identity, { ino: identity.ino + 1n })
        : identity;
    },
    realpath: async (absolutePath, next) => {
      const resolved = await next(absolutePath);
      if (absolutePath === publicationRoot) {
        rootRealpathReads += 1;
        if (rootRealpathReads === 2) {
          replaceRoot = true;
        }
      }
      return resolved;
    },
  });

  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  const diagnostics = assertInvalid(result, "loader.root.changed");
  assert.equal(
    diagnostics.some(
      ({ params }) => params.reason === "identityMismatch",
    ),
    true,
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("private filesystem seam detects source changes before, during, and after descriptor reads", async (t) => {
  for (const phase of ["before", "during", "after"]) {
    await t.test(phase, async (t) => {
      const publicationRoot = await copyFixture(
        t,
        "canonical-field-notes",
      );
      const realRoot = await realpath(publicationRoot);
      const publicationPath = join(realRoot, "publication.json");
      let pathIdentityReads = 0;
      const fileSystem = wrapNodeFileSystem({
        lstat: async (absolutePath, next) => {
          const identity = await next(absolutePath);
          if (absolutePath !== publicationPath) {
            return identity;
          }
          pathIdentityReads += 1;
          return phase === "after" && pathIdentityReads === 2
            ? identityWith(identity, {
                ctimeNs: identity.ctimeNs + 1n,
              })
            : identity;
        },
        openReadOnlyNoFollow: async (absolutePath, next) => {
          const opened = await next(absolutePath);
          if (absolutePath !== publicationPath) {
            return opened;
          }
          let descriptorIdentityReads = 0;
          return Object.freeze({
            close: () => opened.close(),
            readFile: (maximumBytes, expectedBytes) =>
              opened.readFile(maximumBytes, expectedBytes),
            stat: async () => {
              const identity = await opened.stat();
              descriptorIdentityReads += 1;
              const shouldChange =
                (phase === "before" &&
                  descriptorIdentityReads === 1) ||
                (phase === "during" &&
                  descriptorIdentityReads === 2);
              return shouldChange
                ? identityWith(identity, {
                    ctimeNs: identity.ctimeNs + 1n,
                  })
                : identity;
            },
          });
        },
      });

      const result =
        await loadPublicationCompilationSourcesWithFileSystem(
          loaderInput(publicationRoot),
          fileSystem,
        );
      const diagnostics = assertInvalid(
        result,
        "loader.source.changed",
      );
      const expectedReason = {
        after: "pathIdentityMismatch",
        before: "openIdentityMismatch",
        during: "readIdentityMismatch",
      }[phase];
      assert.equal(
        diagnostics.some(
          ({ params }) => params.reason === expectedReason,
        ),
        true,
        validationMessage(result),
      );
      await assertPrivateDiagnostics(result, publicationRoot);
    });
  }
});

test("private filesystem seam rejects changed bytes when descriptor metadata remains identical", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const realRoot = await realpath(publicationRoot);
  const publicationPath = join(realRoot, "publication.json");
  let publicationReadCalls = 0;
  const descriptorIdentities = [];
  const fileSystem = wrapNodeFileSystem({
    openReadOnlyNoFollow: async (absolutePath, next) => {
      const opened = await next(absolutePath);
      if (absolutePath !== publicationPath) {
        return opened;
      }
      return Object.freeze({
        close: () => opened.close(),
        readFile: async (maximumBytes, expectedBytes) => {
          const bytes = await opened.readFile(
            maximumBytes,
            expectedBytes,
          );
          publicationReadCalls += 1;
          if (publicationReadCalls !== 2) {
            return bytes;
          }
          const changed = new Uint8Array(bytes);
          changed[0] ^= 1;
          return changed;
        },
        stat: async () => {
          const identity = await opened.stat();
          descriptorIdentities.push(identity);
          return identity;
        },
      });
    },
  });

  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  const diagnostics = assertInvalid(
    result,
    "loader.source.changed",
  );
  assert.equal(publicationReadCalls, 2);
  assert.equal(descriptorIdentities.length, 2);
  assert.deepEqual(
    descriptorIdentities[0],
    descriptorIdentities[1],
    "The injected byte change must not rely on metadata drift.",
  );
  assert.equal(
    diagnostics.some(
      ({ params }) => params.reason === "readBytesMismatch",
    ),
    true,
    validationMessage(result),
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("private filesystem seam preserves a source-change diagnosis when descriptor close also fails", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const realRoot = await realpath(publicationRoot);
  const publicationPath = join(realRoot, "publication.json");
  const fileSystem = wrapNodeFileSystem({
    openReadOnlyNoFollow: async (absolutePath, next) => {
      const opened = await next(absolutePath);
      if (absolutePath !== publicationPath) {
        return opened;
      }
      return Object.freeze({
        close: async () => {
          await opened.close();
          throw Object.assign(new Error("simulated close failure"), {
            code: "EIO",
          });
        },
        readFile: (maximumBytes, expectedBytes) =>
          opened.readFile(maximumBytes, expectedBytes),
        stat: async () => {
          const identity = await opened.stat();
          return identityWith(identity, {
            ctimeNs: identity.ctimeNs + 1n,
          });
        },
      });
    },
  });

  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  const diagnostics = assertInvalid(
    result,
    "loader.source.changed",
  );
  assert.equal(
    diagnostics.some(
      ({ params }) => params.reason === "openIdentityMismatch",
    ),
    true,
  );
  assert.equal(
    diagnostics.some(
      ({ params }) => params.reason === "closeFailed",
    ),
    false,
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("per-source role byte limits reject oversized identities before descriptor open or allocation", async (t) => {
  for (const fixture of [
    {
      label: "manifest",
      logicalPath: "publication.json",
      role: "publication-manifest",
      maximumBytes:
        PUBLISHER_SOURCE_LOADER_LIMITS.maximumManifestBytes,
      expectedOpenedPaths: [],
    },
    {
      label: "manuscript",
      logicalPath:
        "publication/works/rain-gauge/manuscript.md",
      role: "manuscript",
      maximumBytes:
        PUBLISHER_SOURCE_LOADER_LIMITS.maximumManuscriptBytes,
      expectedOpenedPaths: CANONICAL_PATHS.slice(0, 3),
    },
  ]) {
    await t.test(fixture.label, async (t) => {
      const publicationRoot = await copyFixture(
        t,
        "canonical-field-notes",
      );
      const realRoot = await realpath(publicationRoot);
      const targetPath = join(realRoot, fixture.logicalPath);
      const physicalBytes = await readFile(targetPath);
      assert.ok(
        physicalBytes.byteLength < fixture.maximumBytes,
        "The role-limit seam unexpectedly allocated an oversized fixture.",
      );
      const openedPaths = [];
      const fileSystem = wrapNodeFileSystem({
        lstat: async (absolutePath, next) => {
          const identity = await next(absolutePath);
          return absolutePath === targetPath
            ? identityWith(identity, {
                size: BigInt(fixture.maximumBytes + 1),
              })
            : identity;
        },
        openReadOnlyNoFollow: async (absolutePath, next) => {
          openedPaths.push(absolutePath);
          return next(absolutePath);
        },
      });

      const result =
        await loadPublicationCompilationSourcesWithFileSystem(
          loaderInput(publicationRoot),
          fileSystem,
        );
      const diagnostics = assertInvalid(
        result,
        "loader.source.too_large",
      );
      assert.equal(diagnostics.length, 1);
      const diagnostic = diagnostics[0];
      assert.equal(diagnostic.code, "loader.source.too_large");
      assert.equal(diagnostic.documentPath, fixture.logicalPath);
      assert.equal(diagnostic.path, "");
      assert.equal(diagnostic.keyword, "maximumBytes");
      assert.deepEqual(diagnostic.params, {
        logicalPath: fixture.logicalPath,
        role: fixture.role,
        maximumBytes: fixture.maximumBytes,
      });
      assert.deepEqual(
        openedPaths,
        fixture.expectedOpenedPaths.map((logicalPath) =>
          join(realRoot, logicalPath),
        ),
      );
      assert.equal(
        openedPaths.includes(targetPath),
        false,
        "The oversized source was opened before its role limit failed.",
      );
      await assertPrivateDiagnostics(result, publicationRoot);
    });
  }
});

test("cumulative byte limits reject a source before opening or allocating it", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const publicationPath = join(
    publicationRoot,
    "publication.json",
  );
  const publication = await readJson(publicationPath);
  const originalWork = await readJson(
    join(
      publicationRoot,
      "publication",
      "works",
      "rain-gauge",
      "work.json",
    ),
  );
  const workIds = [
    "rain-gauge",
    ...Array.from(
      { length: 39 },
      (_, index) => `field-note-${String(index + 1).padStart(2, "0")}`,
    ),
  ];
  publication.works = workIds.map((id) => ({ id }));
  publication.collections = [];
  await writeJson(publicationPath, publication);
  const padding = "x".repeat(900_000);
  for (const id of workIds) {
    const workRoot = join(
      publicationRoot,
      "publication",
      "works",
      id,
    );
    await mkdir(workRoot, { recursive: true });
    await writeJson(join(workRoot, "work.json"), {
      ...originalWork,
      id,
      title: `Field note ${id}`,
      route: `/works/${id}`,
      metadata: { padding },
    });
  }

  const openedPaths = new Set();
  const fileSystem = wrapNodeFileSystem({
    openReadOnlyNoFollow: async (absolutePath, next) => {
      openedPaths.add(absolutePath);
      return next(absolutePath);
    },
  });
  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  const diagnostics = assertInvalid(
    result,
    "loader.source_set.too_large",
  );
  const limit = diagnostics.find(
    ({ code }) => code === "loader.source_set.too_large",
  );
  assert.equal(
    limit.params.maximumTotalBytes,
    PUBLISHER_SOURCE_LOADER_LIMITS.maximumTotalBytes,
  );
  assert.equal(typeof limit.params.logicalPath, "string");
  assert.equal(
    openedPaths.has(
      join(await realpath(publicationRoot), limit.params.logicalPath),
    ),
    false,
    "The source that crossed the cumulative limit was opened.",
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("aggregate collection membership is rejected before later manifests or manuscripts open", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "canonical-field-notes",
  );
  const publicationPath = join(
    publicationRoot,
    "publication.json",
  );
  const publication = await readJson(publicationPath);
  const fullWorkIds = Array.from(
    { length: PUBLICATION_PROTOCOL_LIMITS.maximumWorks },
    (_, index) => `work-${index}`,
  );
  const collectionSizes = [
    ...Array.from({ length: 20 }, () => fullWorkIds.length),
    21,
    1,
  ];
  publication.collections = collectionSizes.map((_, index) => ({
    id: `collection-${String(index + 1).padStart(2, "0")}`,
  }));
  await writeJson(publicationPath, publication);

  for (const [index, size] of collectionSizes.entries()) {
    const id = publication.collections[index].id;
    const collectionRoot = join(
      publicationRoot,
      "publication",
      "collections",
      id,
    );
    await mkdir(collectionRoot, { recursive: true });
    await writeJson(join(collectionRoot, "collection.json"), {
      schemaVersion: "1.0",
      id,
      title: `Collection ${index + 1}`,
      workIds: fullWorkIds.slice(0, size),
    });
  }

  const openedPaths = new Set();
  const fileSystem = wrapNodeFileSystem({
    openReadOnlyNoFollow: async (absolutePath, next) => {
      openedPaths.add(absolutePath);
      return next(absolutePath);
    },
  });
  const result =
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    );
  const diagnostics = assertInvalid(
    result,
    "loader.source_graph.too_large",
  );
  const limit = diagnostics.find(
    ({ code }) => code === "loader.source_graph.too_large",
  );
  assert.deepEqual(
    {
      actualItems: limit.params.actualItems,
      maximumItems: limit.params.maximumItems,
      triggeringManifestPath:
        limit.params.triggeringManifestPath,
    },
    {
      actualItems: 100_001,
      maximumItems:
        PUBLISHER_SOURCE_LOADER_LIMITS
          .maximumCollectionWorkReferences,
      triggeringManifestPath:
        "publication/collections/collection-21/collection.json",
    },
  );
  const realPublicationRoot = await realpath(publicationRoot);
  assert.equal(
    openedPaths.has(
      join(
        realPublicationRoot,
        "publication",
        "collections",
        "collection-22",
        "collection.json",
      ),
    ),
    false,
    "A collection after the aggregate limit was opened.",
  );
  assert.equal(
    openedPaths.has(
      join(
        realPublicationRoot,
        "publication",
        "works",
        "rain-gauge",
        "manuscript.md",
      ),
    ),
    false,
    "A manuscript was opened after the aggregate limit failed.",
  );
  await assertPrivateDiagnostics(result, publicationRoot);
});

test("private filesystem seam opens each declared source once and invokes two bounded positional descriptor reads", async (t) => {
  const publicationRoot = await copyFixture(
    t,
    "declared-night-dispatch",
  );
  const readCalls = new Map();
  const openCalls = new Map();
  const closeCalls = new Map();
  const descriptorStatCalls = new Map();
  const directoryReadCalls = new Map();
  const maximums = new Map();
  const fileSystem = wrapNodeFileSystem({
    openReadOnlyNoFollow: async (absolutePath, next) => {
      openCalls.set(
        absolutePath,
        (openCalls.get(absolutePath) ?? 0) + 1,
      );
      const opened = await next(absolutePath);
      return Object.freeze({
        close: async () => {
          closeCalls.set(
            absolutePath,
            (closeCalls.get(absolutePath) ?? 0) + 1,
          );
          await opened.close();
        },
        readFile: async (maximumBytes, expectedBytes) => {
          readCalls.set(
            absolutePath,
            (readCalls.get(absolutePath) ?? 0) + 1,
          );
          maximums.set(absolutePath, maximumBytes);
          return opened.readFile(maximumBytes, expectedBytes);
        },
        stat: async () => {
          descriptorStatCalls.set(
            absolutePath,
            (descriptorStatCalls.get(absolutePath) ?? 0) + 1,
          );
          return opened.stat();
        },
      });
    },
    readDirectoryNames: async (
      absolutePath,
      maximumEntries,
      maximumNameBytes,
      next,
    ) => {
      directoryReadCalls.set(
        absolutePath,
        (directoryReadCalls.get(absolutePath) ?? 0) + 1,
      );
      assert.equal(
        maximumEntries,
        PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectoryEntries,
      );
      assert.equal(
        maximumNameBytes,
        PUBLISHER_SOURCE_LOADER_LIMITS.maximumDirectoryNameBytes,
      );
      return next(
        absolutePath,
        maximumEntries,
        maximumNameBytes,
      );
    },
  });

  const loaded = assertValid(
    await loadPublicationCompilationSourcesWithFileSystem(
      loaderInput(publicationRoot),
      fileSystem,
    ),
  );
  assert.deepEqual(
    loaded.sources.map(({ path }) => path),
    DECLARED_PATHS,
  );
  assert.equal(openCalls.size, DECLARED_PATHS.length);
  assert.equal(readCalls.size, DECLARED_PATHS.length);
  assert.equal(closeCalls.size, DECLARED_PATHS.length);
  assert.equal(descriptorStatCalls.size, DECLARED_PATHS.length);
  assert.ok(directoryReadCalls.size > 0);
  for (const count of directoryReadCalls.values()) {
    assert.equal(count, 1, "A stable directory was enumerated twice.");
  }

  for (const [absolutePath, count] of openCalls) {
    assert.equal(count, 1, `${absolutePath} opened more than once`);
    assert.equal(
      readCalls.get(absolutePath),
      2,
      `${absolutePath} did not have exactly two descriptor reads`,
    );
    assert.equal(
      closeCalls.get(absolutePath),
      1,
      `${absolutePath} was not closed exactly once`,
    );
    assert.equal(
      descriptorStatCalls.get(absolutePath),
      2,
      `${absolutePath} did not have exact pre-read and post-read identity checks`,
    );
    assert.equal(
      maximums.get(absolutePath),
      absolutePath.endsWith(".md")
        ? PUBLISHER_SOURCE_LOADER_LIMITS.maximumManuscriptBytes
        : PUBLISHER_SOURCE_LOADER_LIMITS.maximumManifestBytes,
      `${absolutePath} did not receive its role-specific read bound`,
    );
  }
});
