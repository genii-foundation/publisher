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
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
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

import { build as buildWithEsbuild } from "esbuild";

import {
  assertReleaseTag,
  expectedReleaseTag,
} from "../packages/reader/scripts/check-release-tag.mjs";

const npmExecPath = process.env.npm_execpath;
if (npmExecPath === undefined || npmExecPath.length === 0) {
  throw new Error(
    "The reader package consumer test must run through the exact npm CLI.",
  );
}

const repositoryRoot = fileURLToPath(
  new URL("../", import.meta.url),
);
const schemaRoot = join(repositoryRoot, "schemas");
const contentRoot = join(repositoryRoot, "packages", "content");
const readerRoot = join(repositoryRoot, "packages", "reader");
const releaseTagScriptPath = join(
  readerRoot,
  "scripts",
  "check-release-tag.mjs",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 30 * 1024 * 1024,
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
    cwd: readerRoot,
    encoding: "utf8",
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function packagePath(value) {
  return value.split(sep).join("/");
}

async function pathExists(value) {
  try {
    await access(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function listFiles(root) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, {
      withFileTypes: true,
    });
    entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      } else {
        throw new Error(
          `Unexpected package entry: ${entryPath}`,
        );
      }
    }
  }

  await visit(root);
  return files;
}

function packPackage(root, destination, options = {}) {
  const args = ["pack", "--silent"];
  if (options.ignoreScripts === true) {
    args.push("--ignore-scripts");
  }
  args.push("--json", "--pack-destination", destination, root);
  const results = JSON.parse(
    runNpm(args, {
      cwd: destination,
      label: options.label ?? `pack ${basename(root)}`,
    }),
  );
  assert.equal(results.length, 1);
  return results[0];
}

async function expectedReaderPaths() {
  const sourceFiles = (await listFiles(join(readerRoot, "src"))).filter(
    (sourcePath) =>
      sourcePath.endsWith(".ts") &&
      !sourcePath.endsWith(".d.ts"),
  );
  const scriptFiles = await listFiles(
    join(readerRoot, "scripts"),
  );
  const thirdPartyLicenseFiles = await listFiles(
    join(readerRoot, "third-party-licenses"),
  );
  return [
    "CHANGES.md",
    "LEGAL",
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "SOURCE-NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "dist/SOURCE-NOTICE",
    ...sourceFiles.flatMap((sourcePath) => {
      const stem = packagePath(
        relative(join(readerRoot, "src"), sourcePath),
      ).slice(0, -3);
      return [`dist/${stem}.d.ts`, `dist/${stem}.js`];
    }),
    "package.json",
    ...scriptFiles.map(
      (scriptPath) =>
        `scripts/${packagePath(
          relative(join(readerRoot, "scripts"), scriptPath),
        )}`,
    ),
    ...sourceFiles.map(
      (sourcePath) =>
        `src/${packagePath(
          relative(join(readerRoot, "src"), sourcePath),
        )}`,
    ),
    ...thirdPartyLicenseFiles.map(
      (licensePath) =>
        `third-party-licenses/${packagePath(
          relative(
            join(readerRoot, "third-party-licenses"),
            licensePath,
          ),
        )}`,
    ),
    "tsconfig.json",
  ].sort();
}

async function removeOwnedTempDirectory(targetPath) {
  const tempRoot = await realpath(tmpdir());
  const target = await realpath(targetPath);
  if (
    dirname(target) !== tempRoot ||
    !basename(target).startsWith(
      "genii-publisher-reader-consumer-",
    )
  ) {
    throw new Error(
      `Refusing to remove unexpected path: ${target}`,
    );
  }
  await rm(target, { force: true, recursive: true });
}

function writeJson(filePath, value) {
  return writeFile(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function collectModuleClosure(entryPath, packageRoot) {
  const files = [];
  const externalSpecifiers = new Set();
  const pending = [entryPath];
  const visited = new Set();
  const importPattern =
    /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];/gu;

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (modulePath === undefined || visited.has(modulePath)) {
      continue;
    }
    visited.add(modulePath);
    const relativePath = relative(packageRoot, modulePath);
    assert.equal(
      relativePath.startsWith("..") || isAbsolutePath(relativePath),
      false,
      `Module closure escaped the reader package: ${modulePath}`,
    );
    const source = await readFile(modulePath, "utf8");
    files.push({ path: modulePath, source });
    importPattern.lastIndex = 0;
    for (
      let match = importPattern.exec(source);
      match !== null;
      match = importPattern.exec(source)
    ) {
      const specifier = match[1];
      if (specifier.startsWith(".")) {
        pending.push(resolve(dirname(modulePath), specifier));
      } else {
        externalSpecifiers.add(specifier);
      }
    }
  }

  return {
    files: files.sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    externalSpecifiers: [...externalSpecifiers].sort(),
  };
}

function isAbsolutePath(value) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value);
}

function collectRegistryClosure(lock, directNames) {
  const closure = new Map();
  const pending = [...directNames];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || closure.has(name)) {
      continue;
    }
    const entry = lock.packages?.[`node_modules/${name}`];
    assert.ok(entry, `Missing lock entry for ${name}.`);
    assert.equal(entry.link, undefined, `${name} must be registry-backed.`);
    assert.equal(typeof entry.version, "string");
    assert.equal(typeof entry.resolved, "string");
    assert.equal(typeof entry.integrity, "string");
    closure.set(name, entry);
    pending.push(
      ...Object.keys({
        ...entry.dependencies,
        ...entry.optionalDependencies,
      }),
    );
  }
  return closure;
}

function firstPartyPackedPaths(packResult) {
  return packResult.files
    .map(({ path }) => path)
    .filter((path) => !path.startsWith("node_modules/"))
    .sort();
}

test("reader release lifecycle enforces prerelease and stable npm tags", () => {
  assert.equal(expectedReleaseTag("1.0.0-alpha.1"), "next");
  assert.equal(expectedReleaseTag("1.0.0"), "latest");
  assert.throws(
    () => assertReleaseTag("not-a-version", "next"),
    /not valid SemVer/,
  );
  assert.doesNotThrow(() =>
    assertReleaseTag("1.0.0", undefined),
  );
  assert.doesNotThrow(() =>
    assertReleaseTag("1.0.0", "latest"),
  );
  assert.throws(
    () => assertReleaseTag("1.0.0", "next"),
    /--tag latest/,
  );

  const acceptedTag = runReleaseTagCheck("next");
  assert.equal(acceptedTag.status, 0, acceptedTag.stderr);
  for (const rejectedTag of [undefined, "latest", "beta"]) {
    const result = runReleaseTagCheck(rejectedTag);
    assert.notEqual(
      result.status,
      0,
      `Tag ${rejectedTag ?? "(absent)"} should be rejected.`,
    );
    assert.match(result.stderr, /--tag next/);
  }
});

test("the packed reader rebuilds and proves root, declarations, and content-free browser runtime", async () => {
  const [
    workspaceManifest,
    schemaManifest,
    contentManifest,
    readerManifest,
    semverManifest,
    workspaceLock,
  ] = await Promise.all([
    readFile(join(repositoryRoot, "package.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(join(schemaRoot, "package.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(join(contentRoot, "package.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(join(readerRoot, "package.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(
      join(repositoryRoot, "node_modules", "semver", "package.json"),
      "utf8",
    ).then(JSON.parse),
    readFile(
      join(repositoryRoot, "package-lock.json"),
      "utf8",
    ).then(JSON.parse),
  ]);

  assert.equal(
    schemaManifest.dependencies[semverManifest.name],
    semverManifest.version,
  );
  assert.equal(
    readerManifest.dependencies[schemaManifest.name],
    schemaManifest.version,
  );
  assert.equal(
    readerManifest.dependencies[contentManifest.name],
    contentManifest.version,
  );
  assert.deepEqual(readerManifest.exports["./runtime"], {
    types: "./dist/runtime.d.ts",
    import: "./dist/runtime.js",
  });
  assert.deepEqual(readerManifest.exports["./markdown"], {
    types: "./dist/markdown.d.ts",
    import: "./dist/markdown.js",
  });
  assert.equal(
    readerManifest.dependencies["mdast-util-from-markdown"],
    "2.0.3",
  );
  assert.deepEqual(readerManifest.bundleDependencies, [
    "mdast-util-from-markdown",
  ]);
  const bundledClosure = collectRegistryClosure(
    workspaceLock,
    readerManifest.bundleDependencies,
  );
  const expectedBundledNames = [...bundledClosure.keys()].sort();
  assert.equal(readerManifest.publishConfig.access, "public");
  assert.equal(readerManifest.publishConfig.provenance, true);
  assert.equal(
    readerManifest.engines.node,
    ">=22.12.0 <23 || >=24.0.0 <25 || >=26.0.0 <27",
  );
  assert.equal(
    runNpm(["--version"], { label: "npm version check" }),
    workspaceManifest.engines.npm,
  );

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "genii-publisher-reader-consumer-"),
  );
  try {
    const packRoot = join(temporaryRoot, "pack");
    const consumerRoot = join(temporaryRoot, "consumer");
    const rebuildRoot = join(temporaryRoot, "rebuild");
    await Promise.all([
      mkdir(packRoot),
      mkdir(consumerRoot),
      mkdir(rebuildRoot),
    ]);

    const schemaPack = packPackage(schemaRoot, packRoot, {
      ignoreScripts: true,
      label: "packed schema dependency",
    });
    const semverPack = packPackage(
      join(repositoryRoot, "node_modules", "semver"),
      packRoot,
      {
        ignoreScripts: true,
        label: "packed external runtime dependency",
      },
    );
    const contentPack = packPackage(contentRoot, packRoot, {
      label: "packed content dependency with lifecycle",
    });
    const readerPack = packPackage(readerRoot, packRoot, {
      label: "packed reader artifact with lifecycle",
    });
    assert.deepEqual(
      firstPartyPackedPaths(readerPack),
      await expectedReaderPaths(),
    );
    assert.deepEqual(
      [...readerPack.bundled].sort(),
      expectedBundledNames,
    );
    assert.equal(
      await pathExists(join(readerRoot, "node_modules")),
      false,
      "postpack must remove the temporary dependency bundle.",
    );
    const thirdPartyNotices = await readFile(
      join(readerRoot, "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    for (const name of expectedBundledNames) {
      const version = bundledClosure.get(name)?.version;
      assert.equal(typeof version, "string");
      assert.ok(
        thirdPartyNotices.includes(`| \`${name}\` | ${version} |`),
        `Third-party notice omits bundled ${name}@${version}.`,
      );
    }

    const readerTarball = join(packRoot, readerPack.filename);
    const schemaTarball = join(packRoot, schemaPack.filename);
    const semverTarball = join(packRoot, semverPack.filename);
    const contentTarball = join(packRoot, contentPack.filename);
    run("tar", ["-xzf", readerTarball, "-C", rebuildRoot], {
      cwd: temporaryRoot,
      label: "packed reader source extraction",
    });
    const extractedReaderRoot = join(rebuildRoot, "package");
    const shippedDist = new Map(
      await Promise.all(
        (await listFiles(join(extractedReaderRoot, "dist"))).map(
          async (filePath) => [
            packagePath(
              relative(join(extractedReaderRoot, "dist"), filePath),
            ),
            await readFile(filePath),
          ],
        ),
      ),
    );
    await rm(join(extractedReaderRoot, "node_modules"), {
      force: true,
      recursive: true,
    });
    await symlink(
      join(repositoryRoot, "node_modules"),
      join(extractedReaderRoot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    runNpm(["run", "build"], {
      cwd: extractedReaderRoot,
      label: "packed reader source rebuild with exact workspace toolchain",
    });
    const rebuiltDistPaths = (
      await listFiles(join(extractedReaderRoot, "dist"))
    )
      .map((filePath) =>
        packagePath(
          relative(join(extractedReaderRoot, "dist"), filePath),
        ),
      )
      .sort();
    assert.deepEqual(rebuiltDistPaths, [...shippedDist.keys()].sort());
    for (const distPath of rebuiltDistPaths) {
      assert.deepEqual(
        await readFile(join(extractedReaderRoot, "dist", distPath)),
        shippedDist.get(distPath),
        `Packed rebuild changed dist/${distPath}.`,
      );
    }

    const manifest = {
      name: "genii-publisher-reader-browser-proof",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {
        [schemaManifest.name]: `file:${packagePath(
          relative(consumerRoot, schemaTarball),
        )}`,
        [contentManifest.name]: `file:${packagePath(
          relative(consumerRoot, contentTarball),
        )}`,
        [readerManifest.name]: `file:${packagePath(
          relative(consumerRoot, readerTarball),
        )}`,
      },
      overrides: {
        [semverManifest.name]: `file:${packagePath(
          relative(consumerRoot, semverTarball),
        )}`,
      },
    };
    await writeJson(join(consumerRoot, "package.json"), manifest);
    const npmCache = join(temporaryRoot, "npm-cache");
    runNpm(
      [
        "install",
        "--offline",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--cache",
        npmCache,
      ],
      {
        cwd: consumerRoot,
        label: "production-only reader install",
      },
    );

    const installedReaderRoot = join(
      consumerRoot,
      "node_modules",
      "@genii-foundation",
      "publisher-reader",
    );
    const installedContentRoot = join(
      consumerRoot,
      "node_modules",
      "@genii-foundation",
      "publisher-content",
    );
    assert.deepEqual(
      (await listFiles(installedReaderRoot))
        .map((filePath) =>
          packagePath(relative(installedReaderRoot, filePath)),
        )
        .filter((path) => !path.startsWith("node_modules/"))
        .sort(),
      await expectedReaderPaths(),
    );
    for (const name of expectedBundledNames) {
      const dependencyRoot = join(
        installedReaderRoot,
        "node_modules",
        ...name.split("/"),
      );
      const installedManifest = JSON.parse(
        await readFile(
          join(dependencyRoot, "package.json"),
          "utf8",
        ),
      );
      assert.equal(
        installedManifest.version,
        bundledClosure.get(name)?.version,
        `${name} differs from the parser closure packed with the reader.`,
      );
      assert.equal(
        (await readdir(dependencyRoot)).some((entry) =>
          entry.toLowerCase().startsWith("license"),
        ),
        true,
        `Bundled ${name} omitted its license file.`,
      );
    }
    assert.equal(
      await pathExists(
        join(consumerRoot, "node_modules", "typescript"),
      ),
      false,
      "Production proof must not install the development compiler.",
    );

    const sourceNotice = await readFile(
      join(readerRoot, "SOURCE-NOTICE"),
      "utf8",
    );
    const noticeComment = `/*\n${
      sourceNotice.endsWith("\n")
        ? sourceNotice
        : `${sourceNotice}\n`
    }*/\n`;
    for (const packageFile of await expectedReaderPaths()) {
      if (
        packageFile.startsWith("src/") ||
        packageFile.startsWith("scripts/") ||
        (packageFile.startsWith("dist/") &&
          packageFile !== "dist/SOURCE-NOTICE")
      ) {
        assert.ok(
          (
            await readFile(
              join(installedReaderRoot, packageFile),
              "utf8",
            )
          ).startsWith(noticeComment),
          `${packageFile} lacks the exact Exhibit A notice.`,
        );
      }
    }

    const rootProof = `
      import assert from "node:assert/strict";
      import { hashCanonicalJson } from "@genii-foundation/publisher-content";
      import {
        READER_PROJECTOR_VERSION,
        createPublicationReaderArtifact,
        projectPublicationReader,
        serializePublicationReaderEnvelope,
        validatePublicationReaderEnvelope,
      } from "@genii-foundation/publisher-reader";
      import {
        applyReaderLinksToMarkdown,
      } from "@genii-foundation/publisher-reader/markdown";

      const digest = "sha256:" + "0".repeat(64);
      const envelope = {
        "$schema": "https://publisher.genii.foundation/schemas/reader-envelope.schema.json",
        schemaVersion: "1.0",
        publicationId: "portable-reader",
        engineVersion: "1.0.0",
        readerVersion: READER_PROJECTOR_VERSION,
        buildId: digest,
        source: {
          kind: "publication-content",
          schemaVersion: "1.0",
          publicationId: "portable-reader",
          engineVersion: "1.0.0",
          compilerVersion: "0.1.0-alpha.0",
          buildId: digest,
          contentHash: digest,
        },
        artifact: {
          kind: "publication-reader",
          mediaType: "application/vnd.genii.publisher.reader+json",
          relativePath: "reader/publication-reader.json",
        },
        audience: "public",
        textProfile: {
          id: "genii-reader-block-markdown",
          version: "1.0",
          representation: "markdown",
          normalization: "none",
          offsetUnit: "utf-16-code-unit",
          rangeScope: "block",
          endBoundary: "exclusive",
        },
        publication: {
          id: "portable-reader",
          title: "Portable Reader",
          language: "en",
          publisher: { name: "Example Publisher" },
          attribution: {
            placement: "footer",
            copyright: "Copyright 2026 GENII Foundation",
            text: "Published with GENII Publisher",
            url: "https://publisher.genii.foundation",
            sourceCodeUrl: "https://github.com/genii-foundation/publisher",
          },
        },
        works: [],
        collections: [],
        assets: [],
        links: [],
        routes: {
          active: [{ path: "/", target: { kind: "home" } }],
          redirects: [],
        },
        statistics: {
          workCount: 0,
          collectionCount: 0,
          sectionCount: 0,
          blockCount: 0,
          wordCount: 0,
          readingMinutes: 0,
          wordsPerMinute: 220,
        },
      };
      const {
        "$schema": ignoredSchema,
        buildId: ignoredBuildId,
        ...buildBasis
      } = envelope;
      void [ignoredSchema, ignoredBuildId];
      envelope.buildId = hashCanonicalJson(buildBasis);

      const projected = projectPublicationReader(
        {},
        { audience: "public" },
      );
      assert.equal(projected.valid, false);
      const linked = applyReaderLinksToMarkdown(
        {
          id: "opening",
          kind: "paragraph",
          markdown: "Portable prose",
          text: "Portable prose",
          readerAddress: null,
          domId: null,
          wordCount: 2,
          contentHash: digest,
        },
        [{
          id: "portable-link",
          source: {
            kind: "block-markdown",
            workId: "portable-work",
            sectionId: "opening",
            blockId: "opening",
            range: { start: 0, end: 8 },
          },
          target: {
            kind: "external",
            url: "https://example.com/",
          },
          href: "https://example.com/",
        }],
      );
      assert.equal(linked.valid, true, JSON.stringify(linked.diagnostics));
      assert.equal(
        linked.value,
        "[Portable](<https://example.com/>) prose",
      );
      const validated = validatePublicationReaderEnvelope(envelope);
      assert.equal(
        validated.valid,
        true,
        JSON.stringify(validated.diagnostics),
      );
      const serialized = serializePublicationReaderEnvelope(
        validated.value,
      );
      const artifact = createPublicationReaderArtifact(validated.value);
      assert.equal(artifact.text, serialized);
      assert.equal(artifact.envelope.buildId, envelope.buildId);
      assert.match(artifact.hash, /^sha256:[0-9a-f]{64}$/);
      console.log("reader-root-ok");
    `;
    const rootProofOutput = run(
      process.execPath,
      ["--input-type=module", "--eval", rootProof],
      {
        cwd: consumerRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          TZ: "UTC",
        },
        label: "installed reader root API proof",
      },
    );
    assert.equal(rootProofOutput, "reader-root-ok");

    const typeConsumer = `
      import {
        READER_PROJECTOR_VERSION,
        createPublicationReaderArtifact,
        projectPublicationReader,
        serializePublicationReaderEnvelope,
        validatePublicationReaderEnvelope,
        type ProjectPublicationReaderOptions,
        type PublicationReaderArtifact,
        type PublicationReaderEnvelope,
        type ValidationResult,
      } from "@genii-foundation/publisher-reader";
      import {
        createPublicationReaderRuntime,
        type PublicationReaderRuntime,
        type ReaderAddress,
        type ReaderAddressResolution,
      } from "@genii-foundation/publisher-reader/runtime";
      import {
        applyReaderLinksToMarkdown,
        type ReaderBlockMarkdownLink,
      } from "@genii-foundation/publisher-reader/markdown";

      declare const input: unknown;
      declare const envelope: PublicationReaderEnvelope;
      const options: ProjectPublicationReaderOptions = {
        audience: "public",
      };
      const projected: ValidationResult<PublicationReaderEnvelope> =
        projectPublicationReader(input, options);
      const validated: ValidationResult<PublicationReaderEnvelope> =
        validatePublicationReaderEnvelope(envelope);
      const serialized: string =
        serializePublicationReaderEnvelope(envelope);
      const artifact: PublicationReaderArtifact =
        createPublicationReaderArtifact(envelope);
      const runtime: ValidationResult<PublicationReaderRuntime> =
        createPublicationReaderRuntime(envelope);
      const address: ReaderAddress = { path: "/" };
      declare const block: import(
        "@genii-foundation/publisher-reader"
      ).ReaderBlock;
      declare const links: readonly ReaderBlockMarkdownLink[];
      const linked: ValidationResult<string> =
        applyReaderLinksToMarkdown(block, links);
      declare const resolution: ReaderAddressResolution;
      void [
        READER_PROJECTOR_VERSION,
        projected,
        validated,
        serialized,
        artifact,
        runtime,
        address,
        linked,
        resolution,
      ];
    `;
    await Promise.all([
      writeFile(
        join(consumerRoot, "consumer.ts"),
        typeConsumer,
        "utf8",
      ),
      writeJson(join(consumerRoot, "tsconfig.json"), {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          strict: true,
        },
        include: ["consumer.ts"],
      }),
    ]);
    const installedTypeScriptManifest = JSON.parse(
      await readFile(
        join(
          repositoryRoot,
          "node_modules",
          "typescript",
          "package.json",
        ),
        "utf8",
      ),
    );
    assert.equal(
      installedTypeScriptManifest.version,
      readerManifest.devDependencies.typescript,
    );
    run(
      process.execPath,
      [
        join(
          repositoryRoot,
          "node_modules",
          "typescript",
          "bin",
          "tsc",
        ),
        "-p",
        join(consumerRoot, "tsconfig.json"),
      ],
      {
        cwd: consumerRoot,
        label: "installed reader declaration proof",
      },
    );

    const runtimeClosure = await collectModuleClosure(
      join(installedReaderRoot, "dist", "runtime.js"),
      installedReaderRoot,
    );
    assert.deepEqual(runtimeClosure.externalSpecifiers, [
      "@genii-foundation/publisher-schema/reader",
      "@genii-foundation/publisher-schema/routes",
    ]);
    const runtimeSource = runtimeClosure.files
      .map(({ source }) => source)
      .join("\n");
    for (const forbidden of [
      "@genii-foundation/publisher-content",
      "node:",
      "react",
      "next/",
      "@supabase/",
      "process.env",
      "fetch(",
    ]) {
      assert.equal(
        runtimeSource.includes(forbidden),
        false,
        `Browser runtime closure contains forbidden dependency ${forbidden}.`,
      );
    }

    await rm(installedContentRoot, {
      force: true,
      recursive: true,
    });
    assert.equal(await pathExists(installedContentRoot), false);

    const runtimeEntry = join(
      installedReaderRoot,
      "dist",
      "runtime.js",
    );
    const browserBundle = await buildWithEsbuild({
      absWorkingDir: consumerRoot,
      entryPoints: [runtimeEntry],
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      treeShaking: true,
      write: false,
    });
    assert.equal(browserBundle.outputFiles.length, 1);
    const bundledReferences = [
      ...Object.keys(browserBundle.metafile.inputs),
      ...Object.values(browserBundle.metafile.inputs).flatMap(
        ({ imports }) => imports.map(({ path }) => path),
      ),
      ...Object.values(browserBundle.metafile.outputs).flatMap(
        ({ imports }) => imports.map(({ path }) => path),
      ),
    ];
    for (const reference of bundledReferences) {
      assert.equal(
        reference.includes(
          "@genii-foundation/publisher-content",
        ),
        false,
        `Browser bundle resolved the content package through ${reference}.`,
      );
      assert.equal(
        reference.startsWith("node:"),
        false,
        `Browser bundle retained Node builtin ${reference}.`,
      );
    }
    const bundledRuntime = browserBundle.outputFiles[0].text;
    assert.equal(
      bundledRuntime.includes(
        "@genii-foundation/publisher-content",
      ),
      false,
    );
    assert.doesNotMatch(
      bundledRuntime,
      /(?:^|["'])node:[a-z0-9_/-]+/imu,
    );

    const browserProof = `
      import assert from "node:assert/strict";
      import {
        createPublicationReaderRuntime,
      } from "@genii-foundation/publisher-reader/runtime";

      const digest = "sha256:" + "0".repeat(64);
      const envelope = {
        "$schema": "https://publisher.genii.foundation/schemas/reader-envelope.schema.json",
        schemaVersion: "1.0",
        publicationId: "portable-reader",
        engineVersion: "1.0.0",
        readerVersion: "0.1.0-alpha.0",
        buildId: digest,
        source: {
          kind: "publication-content",
          schemaVersion: "1.0",
          publicationId: "portable-reader",
          engineVersion: "1.0.0",
          compilerVersion: "0.1.0-alpha.0",
          buildId: digest,
          contentHash: digest,
        },
        artifact: {
          kind: "publication-reader",
          mediaType: "application/vnd.genii.publisher.reader+json",
          relativePath: "reader/publication-reader.json",
        },
        audience: "public",
        textProfile: {
          id: "genii-reader-block-markdown",
          version: "1.0",
          representation: "markdown",
          normalization: "none",
          offsetUnit: "utf-16-code-unit",
          rangeScope: "block",
          endBoundary: "exclusive",
        },
        publication: {
          id: "portable-reader",
          title: "Portable Reader",
          language: "en",
          publisher: { name: "Example Publisher" },
          attribution: {
            placement: "footer",
            copyright: "Copyright 2026 GENII Foundation",
            text: "Published with GENII Publisher",
            url: "https://publisher.genii.foundation",
            sourceCodeUrl: "https://github.com/genii-foundation/publisher",
          },
        },
        works: [],
        collections: [],
        assets: [],
        links: [],
        routes: {
          active: [{ path: "/", target: { kind: "home" } }],
          redirects: [],
        },
        statistics: {
          workCount: 0,
          collectionCount: 0,
          sectionCount: 0,
          blockCount: 0,
          wordCount: 0,
          readingMinutes: 0,
          wordsPerMinute: 220,
        },
      };
      const result = createPublicationReaderRuntime(envelope);
      assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
      assert.deepEqual(result.value.lookupWork("absent"), {
        status: "not-found",
      });
      assert.deepEqual(result.value.resolveAddress({ path: "/" }), {
        status: "resolved",
        requestedAddress: { path: "/" },
        route: { path: "/", target: { kind: "home" } },
        content: null,
      });
      assert.equal(Object.isFrozen(result.value.envelope), true);
      console.log("browser-runtime-ok");
    `;
    const proofOutput = run(
      process.execPath,
      ["--input-type=module", "--eval", browserProof],
      {
        cwd: consumerRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          TZ: "UTC",
        },
        label: "content-free browser runtime proof",
      },
    );
    assert.equal(proofOutput, "browser-runtime-ok");
  } finally {
    await removeOwnedTempDirectory(temporaryRoot);
  }
});
