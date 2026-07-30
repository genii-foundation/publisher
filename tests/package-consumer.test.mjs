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
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { satisfies } from "semver";

import {
  assertReleaseTag,
  expectedReleaseTag,
} from "../schemas/scripts/check-release-tag.mjs";

const npmExecPath = process.env.npm_execpath;
if (npmExecPath === undefined || npmExecPath.length === 0) {
  throw new Error(
    "The package consumer test must run through npm so npm_execpath identifies the exact npm CLI.",
  );
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaPackageRoot = join(repositoryRoot, "schemas");
const schemaSourceRoot = join(schemaPackageRoot, "src");
const sourceNoticePath = join(schemaPackageRoot, "SOURCE-NOTICE");
const releaseTagScriptPath = join(
  schemaPackageRoot,
  "scripts",
  "check-release-tag.mjs",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: 10 * 1024 * 1024,
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
  const env = { ...process.env };
  delete env.npm_config_tag;
  if (tag !== undefined) {
    env.npm_config_tag = tag;
  }

  return spawnSync(process.execPath, [releaseTagScriptPath], {
    cwd: schemaPackageRoot,
    encoding: "utf8",
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function toPackagePath(path) {
  return path.split(sep).join("/");
}

function collectRuntimeLockPackages(workspaceLock, directDependencies) {
  const packageEntries = {};
  const pending = Object.keys(directDependencies);
  const visited = new Set();

  while (pending.length > 0) {
    const packageName = pending.pop();
    if (packageName === undefined || visited.has(packageName)) {
      continue;
    }
    visited.add(packageName);

    const packagePath = `node_modules/${packageName}`;
    const lockedPackage = workspaceLock.packages[packagePath];
    assert.ok(lockedPackage, `Missing locked runtime package ${packageName}.`);
    const portableLock = structuredClone(lockedPackage);
    delete portableLock.dev;
    delete portableLock.devOptional;
    packageEntries[packagePath] = portableLock;

    for (const dependencyName of Object.keys({
      ...lockedPackage.dependencies,
      ...lockedPackage.optionalDependencies,
    })) {
      pending.push(dependencyName);
    }
  }

  return packageEntries;
}

async function listFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        throw new Error(`Unexpected non-file package entry: ${path}`);
      }
    }
  }

  await visit(root);
  return files;
}

async function removeOwnedTempDirectory(path) {
  const resolvedTempRoot = await realpath(tmpdir());
  const resolvedTarget = await realpath(path);

  if (
    dirname(resolvedTarget) !== resolvedTempRoot ||
    !basename(resolvedTarget).startsWith("genii-publisher-package-consumer-")
  ) {
    throw new Error(
      `Refusing to remove unexpected temporary directory: ${resolvedTarget}`,
    );
  }

  await rm(resolvedTarget, { force: true, recursive: true });
}

test("packed schema tarball installs and works in an offline consumer", async () => {
  const [workspaceManifest, schemaPackageManifest, workspaceLock] =
    await Promise.all([
      readFile(join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
      readFile(join(schemaPackageRoot, "package.json"), "utf8").then(JSON.parse),
      readFile(join(repositoryRoot, "package-lock.json"), "utf8").then(
        JSON.parse,
      ),
    ]);
  assert.equal(
    satisfies(process.versions.node, workspaceManifest.engines.node),
    true,
    `Node ${process.versions.node} does not satisfy ${workspaceManifest.engines.node}.`,
  );

  const npmVersion = runNpm(["--version"], { label: "npm version check" });
  assert.equal(
    npmVersion,
    workspaceManifest.engines.npm,
    `Expected npm ${workspaceManifest.engines.npm}, received ${npmVersion}.`,
  );
  assert.equal(schemaPackageManifest.publishConfig.access, "public");
  assert.equal(schemaPackageManifest.publishConfig.provenance, true);
  assert.equal(
    schemaPackageManifest.scripts.prepublishOnly,
    "node ../provenance/scripts/reject-directory-publish.mjs",
  );
  assert.deepEqual(schemaPackageManifest.dependencies, {
    semver: "7.8.5",
  });
  assert.equal(schemaPackageManifest.devDependencies.ajv, "8.20.0");
  assert.equal(
    schemaPackageManifest.devDependencies["ajv-formats"],
    "3.0.1",
  );
  assert.equal(
    schemaPackageManifest.devDependencies[
      "@unicode/unicode-15.1.0"
    ],
    "1.6.17",
  );
  assert.equal(
    Object.hasOwn(schemaPackageManifest.publishConfig, "tag"),
    false,
    "publishConfig.tag must remain unset so prereleases require an explicit non-default tag and stable releases resolve to npm's default latest tag.",
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
    const rejectedResult = runReleaseTagCheck(rejectedTag);
    assert.notEqual(
      rejectedResult.status,
      0,
      `Tag ${rejectedTag ?? "(absent)"} should be rejected.`,
    );
    assert.match(rejectedResult.stderr, /--tag next/);
  }

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "genii-publisher-package-consumer-"),
  );

  try {
    const packDirectory = join(temporaryRoot, "pack");
    const consumerDirectory = join(temporaryRoot, "consumer");
    const rebuildDirectory = join(temporaryRoot, "rebuild");
    await Promise.all([
      mkdir(packDirectory),
      mkdir(consumerDirectory),
      mkdir(rebuildDirectory),
    ]);

    const packJson = runNpm(
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        packDirectory,
        schemaPackageRoot,
      ],
      {
        cwd: temporaryRoot,
        label: "npm pack with scripts disabled",
      },
    );
    const packResults = JSON.parse(packJson);
    assert.equal(packResults.length, 1);

    const [packResult] = packResults;
    const tarballPath = join(packDirectory, packResult.filename);
    const packedPaths = packResult.files
      .map(({ path }) => path)
      .sort();

    const allSourceFiles = (await listFiles(schemaSourceRoot)).filter(
      (path) => path.endsWith(".ts"),
    );
    const sourceFiles = allSourceFiles.filter(
      (path) => !path.endsWith(".d.ts"),
    );
    const expectedDistPaths = sourceFiles.flatMap((sourceFile) => {
      const sourcePath = toPackagePath(
        relative(schemaSourceRoot, sourceFile),
      );
      const stem = sourcePath.slice(0, -".ts".length);
      return [`dist/${stem}.d.ts`, `dist/${stem}.js`];
    });
    expectedDistPaths.push("dist/generated-validators.js");
    const expectedSourcePaths = allSourceFiles.map(
      (sourceFile) =>
        `src/${toPackagePath(relative(schemaSourceRoot, sourceFile))}`,
    );
    const expectedScriptPaths = (
      await listFiles(join(schemaPackageRoot, "scripts"))
    ).map(
      (scriptFile) =>
        `scripts/${toPackagePath(
          relative(join(schemaPackageRoot, "scripts"), scriptFile),
        )}`,
    );
    const expectedPackedPaths = [
      "CHANGES.md",
      "LEGAL",
      "LICENSE",
      "NOTICE.md",
      "README.md",
      "SOURCE-NOTICE",
      "THIRD_PARTY_NOTICES.md",
      "audio-catalog.schema.json",
      "audio-envelope.schema.json",
      "collection.schema.json",
      "content-envelope.schema.json",
      "dist/SOURCE-NOTICE",
      ...expectedDistPaths,
      "package.json",
      "publication.schema.json",
      "reader-envelope.schema.json",
      "sync-envelope.schema.json",
      ...expectedScriptPaths,
      ...expectedSourcePaths,
      "third-party-data/NormalizationTest-15.1.0.txt",
      "third-party-data/UnicodeData-15.1.0.txt",
      "third-party-data/unicode-normalization-15.1.0.json",
      "third-party-licenses/unicode-15.1.0-LICENSE-MIT.txt",
      "third-party-licenses/unicode-data-LICENSE.txt",
      "tsconfig.json",
      "work.schema.json",
    ].sort();
    assert.deepEqual(packedPaths, expectedPackedPaths);

    const tarballSpecifier = `file:${toPackagePath(
      relative(consumerDirectory, tarballPath),
    )}`;
    const consumerManifest = {
      name: "genii-publisher-schema-consumer-proof",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {
        [schemaPackageManifest.name]: tarballSpecifier,
      },
    };
    const consumerLock = {
      name: consumerManifest.name,
      version: consumerManifest.version,
      lockfileVersion: workspaceLock.lockfileVersion,
      requires: true,
      packages: {
        "": {
          name: consumerManifest.name,
          version: consumerManifest.version,
          dependencies: consumerManifest.dependencies,
        },
        [`node_modules/${schemaPackageManifest.name}`]: {
          version: schemaPackageManifest.version,
          resolved: tarballSpecifier,
          integrity: packResult.integrity,
          license: schemaPackageManifest.license,
          dependencies: schemaPackageManifest.dependencies,
          engines: schemaPackageManifest.engines,
        },
        ...collectRuntimeLockPackages(
          workspaceLock,
          schemaPackageManifest.dependencies,
        ),
      },
    };
    await Promise.all([
      writeFile(
        join(consumerDirectory, "package.json"),
        `${JSON.stringify(consumerManifest, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        join(consumerDirectory, "package-lock.json"),
        `${JSON.stringify(consumerLock, null, 2)}\n`,
        "utf8",
      ),
    ]);

    const npmCache = runNpm(["config", "get", "cache"], {
      cwd: temporaryRoot,
      label: "npm cache lookup",
    });

    run("tar", ["-xzf", tarballPath, "-C", rebuildDirectory], {
      cwd: temporaryRoot,
      label: "packed source extraction",
    });
    const extractedPackageRoot = join(rebuildDirectory, "package");
    const packedDistPaths = [
      "dist/SOURCE-NOTICE",
      ...expectedDistPaths,
    ].sort();
    const packedDistContents = new Map(
      await Promise.all(
        packedDistPaths.map(async (path) => [
          path,
          await readFile(join(extractedPackageRoot, path)),
        ]),
      ),
    );
    await symlink(
      join(repositoryRoot, "node_modules"),
      join(extractedPackageRoot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    runNpm(["run", "build"], {
      cwd: extractedPackageRoot,
      label: "packed source rebuild with exact workspace toolchain",
    });
    const rebuiltDistPaths = (
      await listFiles(join(extractedPackageRoot, "dist"))
    )
      .map(
        (path) =>
          `dist/${toPackagePath(
            relative(join(extractedPackageRoot, "dist"), path),
          )}`,
      )
      .sort();
    assert.deepEqual(rebuiltDistPaths, packedDistPaths);
    for (const path of rebuiltDistPaths) {
      assert.deepEqual(
        await readFile(join(extractedPackageRoot, path)),
        packedDistContents.get(path),
        `${path} differs from the output shipped in the packed artifact.`,
      );
    }

    runNpm(
      [
        "ci",
        "--offline",
        "--ignore-scripts",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--cache",
        npmCache,
      ],
      {
        cwd: consumerDirectory,
        label: "offline tarball installation",
      },
    );
    for (const buildOnlyPackage of [
      "ajv",
      "ajv-formats",
      "@unicode/unicode-15.1.0",
      "fast-deep-equal",
      "fast-uri",
    ]) {
      await assert.rejects(
        realpath(
          join(
            consumerDirectory,
            "node_modules",
            buildOnlyPackage,
          ),
        ),
        (error) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT",
        `${buildOnlyPackage} must not be installed in the production consumer.`,
      );
    }

    const installedPackageRoot = join(
      consumerDirectory,
      "node_modules",
      "@genii-foundation",
      "publisher-schema",
    );
    const installedPaths = (await listFiles(installedPackageRoot))
      .map((path) => toPackagePath(relative(installedPackageRoot, path)))
      .sort();
    assert.deepEqual(installedPaths, expectedPackedPaths);

    const sourceNotice = await readFile(sourceNoticePath, "utf8");
    const noticeBody = sourceNotice.endsWith("\n")
      ? sourceNotice
      : `${sourceNotice}\n`;
    const noticeComment = `/*\n${noticeBody}*/\n`;
    assert.equal(
      await readFile(
        join(installedPackageRoot, "dist", "SOURCE-NOTICE"),
        "utf8",
      ),
      sourceNotice,
    );

    for (const path of installedPaths.filter(
      (entry) =>
        (entry.startsWith("dist/") && entry !== "dist/SOURCE-NOTICE") ||
        entry.startsWith("scripts/") ||
        entry.startsWith("src/"),
    )) {
      const contents = await readFile(join(installedPackageRoot, path), "utf8");
      assert.ok(
        contents.startsWith(noticeComment),
        `${path} must carry the exact Exhibit A notice.`,
      );
    }

    const consumerProof = `
      import assert from "node:assert/strict";
      import {
        EXTENSION_CAPABILITIES,
        PORTABLE_REPOSITORY_CASE_FOLDING_VERSION,
        PORTABLE_REPOSITORY_NORMALIZATION_VERSION,
        inspectCanonicalRoutePath,
        isCanonicalRoutePath,
        normalizePortableRepositoryText,
        portableRepositoryPathIdentity,
        validateContentEnvelopeShape,
        validatePublicationShape,
        validateRepositoryRelativePath,
        validateWorkShape,
      } from "@genii-foundation/publisher-schema";
      import {
        inspectCanonicalUrlFragment as inspectBrowserFragment,
        inspectCanonicalRoutePath as inspectBrowserRoute,
      } from "@genii-foundation/publisher-schema/routes";
      import {
        READER_ENVELOPE_SCHEMA_URL,
        READER_TEXT_PROFILE,
        inspectCanonicalUrlFragment as inspectReaderFragment,
        validateReaderEnvelopeShape,
      } from "@genii-foundation/publisher-schema/reader";
      import contentEnvelopeSchema from "@genii-foundation/publisher-schema/content-envelope.schema.json" with { type: "json" };
      import readerEnvelopeSchema from "@genii-foundation/publisher-schema/reader-envelope.schema.json" with { type: "json" };
      import workSchema from "@genii-foundation/publisher-schema/work.schema.json" with { type: "json" };

      assert.equal(
        workSchema.$id,
        "https://publisher.genii.foundation/schemas/work.schema.json",
      );
      assert.equal(typeof validatePublicationShape, "function");
      assert.equal(typeof validateContentEnvelopeShape, "function");
      assert.deepEqual(EXTENSION_CAPABILITIES, [
        "content.project",
        "renderer.slot",
        "renderer.client",
        "host.route",
        "host.handler",
      ]);
      assert.equal(PORTABLE_REPOSITORY_CASE_FOLDING_VERSION, "15.1.0");
      assert.equal(PORTABLE_REPOSITORY_NORMALIZATION_VERSION, "15.1.0");
      assert.equal(
        portableRepositoryPathIdentity("Werke/Straße.md"),
        portableRepositoryPathIdentity("WERKE/STRASSE.MD"),
      );
      const unicodeVersionDrift = "q\\u{1ACF}\\u0323";
      assert.equal(
        normalizePortableRepositoryText(unicodeVersionDrift),
        unicodeVersionDrift,
      );
      assert.equal(
        portableRepositoryPathIdentity(unicodeVersionDrift),
        unicodeVersionDrift,
      );
      assert.deepEqual(
        validateRepositoryRelativePath(
          \`publication/\${unicodeVersionDrift}.md\`,
          "/path",
        ),
        [],
      );
      assert.deepEqual(
        validateRepositoryRelativePath("出版/作品/第一章.md", "/path"),
        [],
      );
      assert.deepEqual(inspectCanonicalRoutePath("/caf%C3%A9/"), {
        valid: true,
        value: "/caf%C3%A9/",
      });
      assert.deepEqual(inspectCanonicalRoutePath("/café/"), {
        valid: false,
        issue: "raw-non-ascii",
      });
      assert.equal(isCanonicalRoutePath("/caf%C3%A9/"), true);
      assert.equal(isCanonicalRoutePath("/caf%c3%a9/"), false);
      assert.deepEqual(inspectBrowserRoute("/%E6%9D%B1%E4%BA%AC/"), {
        valid: true,
        value: "/%E6%9D%B1%E4%BA%AC/",
      });
      assert.deepEqual(inspectBrowserFragment("%61"), {
        valid: true,
        value: "%61",
        decoded: "a",
      });
      assert.deepEqual(inspectReaderFragment("+"), {
        valid: true,
        value: "+",
        decoded: "+",
      });
      assert.equal(
        contentEnvelopeSchema.$id,
        "https://publisher.genii.foundation/schemas/content-envelope.schema.json",
      );
      assert.equal(readerEnvelopeSchema.$id, READER_ENVELOPE_SCHEMA_URL);
      assert.equal(READER_TEXT_PROFILE.id, "genii-reader-block-markdown");
      assert.equal(READER_TEXT_PROFILE.representation, "markdown");
      assert.equal(validateReaderEnvelopeShape({}).valid, false);
      const result = validateWorkShape({
        schemaVersion: "1.0",
        id: "installed-proof",
        title: "Installed Proof",
        language: "en",
        publicationState: "draft",
        manuscript: "原稿/第一章.md",
      });
      assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    `;
    run(process.execPath, ["--input-type=module", "--eval", consumerProof], {
      cwd: consumerDirectory,
      label: "installed package public export proof",
    });

    const installedRuntimePaths = installedPaths.filter(
      (path) => path.startsWith("dist/") && path.endsWith(".js"),
    );
    for (const path of installedRuntimePaths) {
      const contents = await readFile(
        join(installedPackageRoot, path),
        "utf8",
      );
      assert.doesNotMatch(
        contents,
        /["']node:fs(?:\/promises)?["']/,
        `${path} must not hold filesystem read authority.`,
      );
      assert.doesNotMatch(
        contents,
        /\b(?:import|export)\s+[^;\n]*\bfrom\s+["'](?:ajv(?:\/|["'])|ajv-formats(?:\/|["']))/,
        `${path} must not resolve schema compiler modules at runtime.`,
      );
      assert.doesNotMatch(
        contents,
        /\brequire\s*\(/,
        `${path} must not contain unresolved CommonJS module loads.`,
      );
      assert.doesNotMatch(
        contents,
        /@unicode\/unicode-15\.1\.0\/Case_Folding/,
        `${path} must not load the Unicode data package at runtime.`,
      );
      assert.doesNotMatch(
        contents,
        /\.normalize\s*\(/,
        `${path} must not consult host Unicode normalization tables.`,
      );
    }

    const browserEntryPath = join(
      consumerDirectory,
      "browser-case-folding-proof.mjs",
    );
    const browserBundlePath = join(
      consumerDirectory,
      "browser-case-folding-proof.bundle.mjs",
    );
    await writeFile(
      browserEntryPath,
      `
import {
  normalizePortableRepositoryText,
  portableRepositoryPathIdentity,
  validateRepositoryRelativePath,
} from "@genii-foundation/publisher-schema";

const unicodeVersionDrift = "q\\u{1ACF}\\u0323";
if (
  portableRepositoryPathIdentity("Werke/Straße.md") !==
  portableRepositoryPathIdentity("WERKE/STRASSE.MD")
) {
  throw new Error("Unicode case-fold identity failed.");
}
if (
  normalizePortableRepositoryText(unicodeVersionDrift) !==
    unicodeVersionDrift ||
  portableRepositoryPathIdentity(unicodeVersionDrift) !==
    unicodeVersionDrift
) {
  throw new Error("Pinned Unicode 15.1 normalization failed.");
}
if (
  validateRepositoryRelativePath("出版/作品/第一章.md", "/path").length !== 0
) {
  throw new Error("Native-script repository path failed.");
}
`,
      "utf8",
    );
    run(
      join(repositoryRoot, "node_modules", "esbuild", "bin", "esbuild"),
      [
        browserEntryPath,
        "--bundle",
        "--format=esm",
        "--platform=browser",
        `--outfile=${browserBundlePath}`,
      ],
      {
        cwd: consumerDirectory,
        label: "packed schema browser bundle proof",
      },
    );
    const browserBundle = await readFile(browserBundlePath, "utf8");
    assert.doesNotMatch(browserBundle, /\bnode:/);
    assert.doesNotMatch(
      browserBundle,
      /@unicode\/unicode-15\.1\.0\/Case_Folding/,
    );
    run(process.execPath, [browserBundlePath], {
      cwd: consumerDirectory,
      label: "packed schema browser bundle execution",
    });

    for (const schemaFileName of [
      "audio-catalog.schema.json",
      "audio-envelope.schema.json",
      "collection.schema.json",
      "content-envelope.schema.json",
      "publication.schema.json",
      "reader-envelope.schema.json",
      "sync-envelope.schema.json",
      "work.schema.json",
    ]) {
      await rename(
        join(installedPackageRoot, schemaFileName),
        join(installedPackageRoot, `${schemaFileName}.unavailable`),
      );
    }
    const isolatedRuntimeProof = `
      import assert from "node:assert/strict";
      import {
        validateAudioCatalogShape,
        validateAudioEnvelopeShape,
        validateCollectionShape,
        validateSyncEnvelopeShape,
        validateContentEnvelopeShape,
        validatePublicationShape,
        validateReaderEnvelopeShape,
        validateWorkShape,
      } from "@genii-foundation/publisher-schema";

      const validWork = validateWorkShape({
        schemaVersion: "1.0",
        id: "isolated-runtime",
        title: "Isolated Runtime",
        language: "en",
        publicationState: "draft",
        manuscript: "manuscript.md",
      });
      assert.equal(
        validWork.valid,
        true,
        JSON.stringify(validWork.diagnostics),
      );
      const validCatalog = validateAudioCatalogShape({
        version: 1,
        voices: [],
      });
      assert.equal(
        validCatalog.valid,
        true,
        JSON.stringify(validCatalog.diagnostics),
      );
      for (const result of [
        validatePublicationShape({}),
        validateCollectionShape({}),
        validateContentEnvelopeShape({}),
        validateReaderEnvelopeShape({}),
        validateAudioCatalogShape({}),
        validateAudioEnvelopeShape({}),
        validateSyncEnvelopeShape({}),
      ]) {
        assert.equal(result.valid, false);
        assert.ok(result.diagnostics.length > 0);
      }
    `;
    run(
      process.execPath,
      ["--input-type=module", "--eval", isolatedRuntimeProof],
      {
        cwd: consumerDirectory,
        label: "filesystem-independent standalone validator proof",
      },
    );

    const typeConsumer = `
      import {
        PORTABLE_REPOSITORY_CASE_FOLDING_VERSION,
        PORTABLE_REPOSITORY_NORMALIZATION_VERSION,
        inspectCanonicalRoutePath,
        isCanonicalRoutePath,
        normalizePortableRepositoryText,
        portableRepositoryPathIdentity,
        validateContentEnvelopeShape,
        validatePublicationShape,
        validateReaderEnvelopeShape,
        type CanonicalRoutePathInspection,
        type ExtensionCapability,
        type PublicationContentEnvelope,
        type PublicationManifest,
        type PublicationReaderEnvelope,
        type ValidationResult,
      } from "@genii-foundation/publisher-schema";
      import {
        inspectCanonicalUrlFragment,
        inspectCanonicalRoutePath as inspectBrowserRoute,
      } from "@genii-foundation/publisher-schema/routes";
      import {
        READER_TEXT_PROFILE,
        inspectCanonicalUrlFragment as inspectReaderFragment,
        validateReaderEnvelopeShape as validateBrowserReaderEnvelopeShape,
        type PublicationReaderEnvelope as BrowserPublicationReaderEnvelope,
      } from "@genii-foundation/publisher-schema/reader";

      declare const publication: PublicationManifest;
      const capability: ExtensionCapability = "renderer.slot";
      void capability;
      void PORTABLE_REPOSITORY_CASE_FOLDING_VERSION;
      void PORTABLE_REPOSITORY_NORMALIZATION_VERSION;
      void normalizePortableRepositoryText("Cafe\\u0301");
      void portableRepositoryPathIdentity("Werke/Straße.md");
      const result: ValidationResult<PublicationManifest> =
        validatePublicationShape(publication);
      void result;
      declare const envelope: PublicationContentEnvelope;
      const envelopeResult: ValidationResult<PublicationContentEnvelope> =
        validateContentEnvelopeShape(envelope);
      void envelopeResult;
      declare const readerEnvelope: PublicationReaderEnvelope;
      const readerEnvelopeResult: ValidationResult<PublicationReaderEnvelope> =
        validateReaderEnvelopeShape(readerEnvelope);
      void readerEnvelopeResult;
      const browserReaderEnvelope: BrowserPublicationReaderEnvelope =
        readerEnvelope;
      void validateBrowserReaderEnvelopeShape(browserReaderEnvelope);
      void READER_TEXT_PROFILE;
      declare const routeValue: unknown;
      const routeInspection: CanonicalRoutePathInspection =
        inspectCanonicalRoutePath(routeValue);
      if (isCanonicalRoutePath(routeValue)) {
        const canonicalRoute: string = routeValue;
        void canonicalRoute;
      }
      void routeInspection;
      void inspectBrowserRoute;
      void inspectCanonicalUrlFragment;
      void inspectReaderFragment;
    `;
    const typeConsumerConfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        strict: true,
      },
      include: ["consumer.ts"],
    };
    await Promise.all([
      writeFile(
        join(consumerDirectory, "consumer.ts"),
        typeConsumer,
        "utf8",
      ),
      writeFile(
        join(consumerDirectory, "tsconfig.json"),
        `${JSON.stringify(typeConsumerConfig, null, 2)}\n`,
        "utf8",
      ),
    ]);
    run(
      process.execPath,
      [
        join(repositoryRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        join(consumerDirectory, "tsconfig.json"),
      ],
      {
        cwd: consumerDirectory,
        label: "installed package declaration proof",
      },
    );
  } finally {
    await removeOwnedTempDirectory(temporaryRoot);
  }
});
