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
import { basename, dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertReleaseTag,
  expectedReleaseTag,
} from "../packages/content/scripts/check-release-tag.mjs";

const npmExecPath = process.env.npm_execpath;
if (npmExecPath === undefined || npmExecPath.length === 0) {
  throw new Error(
    "The content package consumer test must run through the exact npm CLI.",
  );
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaRoot = join(repositoryRoot, "schemas");
const contentRoot = join(repositoryRoot, "packages", "content");
const releaseTagScriptPath = join(
  contentRoot,
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
    cwd: contentRoot,
    encoding: "utf8",
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function packagePath(path) {
  return path.split(sep).join("/");
}

async function pathExists(path) {
  try {
    await access(path);
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
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      } else {
        throw new Error(`Unexpected package entry: ${path}`);
      }
    }
  }
  await visit(root);
  return files;
}

function collectRegistryClosure(workspaceLock, directDependencies) {
  const entries = {};
  const pending = Object.keys(directDependencies);
  const visited = new Set();
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || visited.has(name)) {
      continue;
    }
    visited.add(name);
    const path = `node_modules/${name}`;
    const locked = workspaceLock.packages[path];
    assert.ok(locked, `Missing locked registry package ${name}.`);
    assert.notEqual(locked.link, true, `${name} unexpectedly resolves as a link.`);
    const portable = structuredClone(locked);
    delete portable.dev;
    delete portable.devOptional;
    entries[path] = portable;
    for (const child of Object.keys({
      ...locked.dependencies,
      ...locked.optionalDependencies,
    })) {
      pending.push(child);
    }
  }
  return entries;
}

function bundledLockEntries(contentName, registryClosure) {
  const prefix = `node_modules/${contentName}/`;
  return Object.fromEntries(
    Object.entries(registryClosure).map(([path, locked]) => {
      const portable = structuredClone(locked);
      delete portable.dev;
      delete portable.devOptional;
      delete portable.resolved;
      delete portable.integrity;
      portable.inBundle = true;
      return [`${prefix}${path}`, portable];
    }),
  );
}

async function removeOwnedTempDirectory(path) {
  const tempRoot = await realpath(tmpdir());
  const target = await realpath(path);
  if (
    dirname(target) !== tempRoot ||
    !basename(target).startsWith("genii-publisher-content-consumer-")
  ) {
    throw new Error(`Refusing to remove unexpected path: ${target}`);
  }
  await rm(target, { force: true, recursive: true });
}

function packedPathList(packResult) {
  return packResult.files.map(({ path }) => path).sort();
}

function firstPartyPackedPaths(packResult) {
  return packedPathList(packResult).filter(
    (path) => !path.startsWith("node_modules/"),
  );
}

async function expectedContentPaths() {
  const sourceFiles = (await listFiles(join(contentRoot, "src"))).filter(
    (path) => path.endsWith(".ts") && !path.endsWith(".d.ts"),
  );
  const scriptFiles = await listFiles(join(contentRoot, "scripts"));
  return [
    "CHANGES.md",
    "LEGAL",
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "SOURCE-NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "dist/SOURCE-NOTICE",
    "dist/runtime/markdown-parser.js",
    ...sourceFiles.flatMap((source) => {
      const stem = packagePath(relative(join(contentRoot, "src"), source)).slice(
        0,
        -3,
      );
      return [`dist/${stem}.d.ts`, `dist/${stem}.js`];
    }),
    "package.json",
    ...scriptFiles.map(
      (script) =>
        `scripts/${packagePath(relative(join(contentRoot, "scripts"), script))}`,
    ),
    ...sourceFiles.map(
      (source) =>
        `src/${packagePath(relative(join(contentRoot, "src"), source))}`,
    ),
    "third-party-licenses/unicode-15.1.0-LICENSE-MIT.txt",
    "tsconfig.json",
  ].sort();
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

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("content release lifecycle enforces prerelease and stable npm tags", async () => {
  const manifest = JSON.parse(
    await readFile(join(contentRoot, "package.json"), "utf8"),
  );
  assert.equal(
    manifest.scripts.prepublishOnly,
    "node ../../provenance/scripts/reject-directory-publish.mjs",
  );
  assert.equal(expectedReleaseTag("1.0.0-alpha.1"), "next");
  assert.equal(expectedReleaseTag("1.0.0"), "latest");
  assert.throws(
    () => assertReleaseTag("not-a-version", "next"),
    /not valid SemVer/,
  );
  assert.doesNotThrow(() => assertReleaseTag("1.0.0", undefined));
  assert.doesNotThrow(() => assertReleaseTag("1.0.0", "latest"));
  assert.throws(() => assertReleaseTag("1.0.0", "next"), /--tag latest/);

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

test("packed content freezes its runtime and proves production and development consumers separately", async () => {
  const [workspaceManifest, workspaceLock, schemaManifest, contentManifest] =
    await Promise.all([
      readFile(join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
      readFile(join(repositoryRoot, "package-lock.json"), "utf8").then(
        JSON.parse,
      ),
      readFile(join(schemaRoot, "package.json"), "utf8").then(JSON.parse),
      readFile(join(contentRoot, "package.json"), "utf8").then(JSON.parse),
    ]);

  assert.equal(
    contentManifest.dependencies[schemaManifest.name],
    schemaManifest.version,
  );
  const [nodeMajor, nodeMinor] = process.versions.node
    .split(".")
    .slice(0, 2)
    .map(Number);
  assert.equal(
    nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12),
    true,
    `Node ${process.versions.node} is older than the content runtime floor.`,
  );
  assert.equal(
    nodeMajor < 27,
    true,
    `Node ${process.versions.node} is newer than the verified content runtime ceiling.`,
  );
  assert.equal(
    runNpm(["--version"], { label: "npm version check" }),
    workspaceManifest.engines.npm,
  );
  assert.equal(
    contentManifest.engines.node,
    ">=22.12.0 <23 || >=24.0.0 <25 || >=26.0.0 <27",
  );
  assert.equal(contentManifest.publishConfig.access, "public");
  assert.equal(contentManifest.publishConfig.provenance, true);
  assert.equal(Object.hasOwn(contentManifest.publishConfig, "tag"), false);
  assert.equal(contentManifest.devDependencies.esbuild, "0.27.0");
  assert.equal(
    workspaceLock.packages["node_modules/esbuild"].version,
    contentManifest.devDependencies.esbuild,
  );
  assert.equal(
    contentManifest.scripts.build,
    "node ./scripts/build.mjs && node ./scripts/bundle-runtime.mjs freeze",
  );
  assert.equal(
    contentManifest.scripts.prepack,
    "node ./scripts/build.mjs && node ./scripts/bundle-runtime.mjs freeze && node ./scripts/bundle-runtime.mjs stage",
  );

  const bundledRoots = [...contentManifest.bundleDependencies].sort();
  assert.deepEqual(bundledRoots, [
    "@unicode/unicode-15.1.0",
    "mdast-util-from-markdown",
    "mdast-util-to-string",
  ]);
  const bundledDirectDependencies = Object.fromEntries(
    bundledRoots.map((name) => [name, contentManifest.dependencies[name]]),
  );
  for (const version of Object.values(bundledDirectDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  }
  const bundledClosure = collectRegistryClosure(
    workspaceLock,
    bundledDirectDependencies,
  );
  const expectedBundledNames = Object.keys(bundledClosure)
    .map((path) => path.slice("node_modules/".length))
    .sort();

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "genii-publisher-content-consumer-"),
  );
  try {
    const packRoot = join(temporaryRoot, "pack");
    const productionRoot = join(temporaryRoot, "production");
    const developmentRoot = join(temporaryRoot, "development");
    const rebuildRoot = join(temporaryRoot, "rebuild");
    await Promise.all([
      mkdir(packRoot),
      mkdir(productionRoot),
      mkdir(developmentRoot),
      mkdir(rebuildRoot),
    ]);

    const schemaPack = packPackage(schemaRoot, packRoot, {
      ignoreScripts: true,
      label: "packed schema dependency",
    });
    const contentPack = packPackage(contentRoot, packRoot, {
      label: "packed content artifact with lifecycle",
    });

    assert.deepEqual(
      firstPartyPackedPaths(contentPack),
      await expectedContentPaths(),
    );
    assert.deepEqual([...contentPack.bundled].sort(), expectedBundledNames);
    assert.equal(
      await pathExists(join(contentRoot, "node_modules")),
      false,
      "postpack must remove its temporary runtime staging directory.",
    );

    const thirdPartyNotice = await readFile(
      join(contentRoot, "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    for (const name of expectedBundledNames) {
      const version = workspaceLock.packages[`node_modules/${name}`].version;
      assert.ok(
        thirdPartyNotice.includes(`| \`${name}\` | ${version} |`),
        `Third-party notice omits bundled ${name}@${version}.`,
      );
    }

    const schemaTarball = join(packRoot, schemaPack.filename);
    const contentTarball = join(packRoot, contentPack.filename);
    const schemaSpecifier = `file:${packagePath(
      relative(productionRoot, schemaTarball),
    )}`;
    const contentSpecifier = `file:${packagePath(
      relative(productionRoot, contentTarball),
    )}`;
    const productionManifest = {
      name: "genii-publisher-content-production-proof",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {
        [schemaManifest.name]: schemaSpecifier,
        [contentManifest.name]: contentSpecifier,
      },
    };
    const productionLock = {
      name: productionManifest.name,
      version: productionManifest.version,
      lockfileVersion: workspaceLock.lockfileVersion,
      requires: true,
      packages: {
        "": {
          name: productionManifest.name,
          version: productionManifest.version,
          dependencies: productionManifest.dependencies,
        },
        [`node_modules/${schemaManifest.name}`]: {
          version: schemaManifest.version,
          resolved: schemaSpecifier,
          integrity: schemaPack.integrity,
          license: schemaManifest.license,
          dependencies: schemaManifest.dependencies,
          engines: schemaManifest.engines,
        },
        [`node_modules/${contentManifest.name}`]: {
          version: contentManifest.version,
          resolved: contentSpecifier,
          integrity: contentPack.integrity,
          bundleDependencies: contentManifest.bundleDependencies,
          license: contentManifest.license,
          dependencies: contentManifest.dependencies,
          engines: contentManifest.engines,
        },
        ...collectRegistryClosure(
          workspaceLock,
          schemaManifest.dependencies,
        ),
        ...bundledLockEntries(contentManifest.name, bundledClosure),
      },
    };
    await Promise.all([
      writeJson(join(productionRoot, "package.json"), productionManifest),
      writeJson(join(productionRoot, "package-lock.json"), productionLock),
    ]);

    const npmCache = runNpm(["config", "get", "cache"], {
      cwd: temporaryRoot,
      label: "npm cache lookup",
    });
    runNpm(
      [
        "ci",
        "--offline",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--cache",
        npmCache,
      ],
      { cwd: productionRoot, label: "production-only content install" },
    );

    const installedContentRoot = join(
      productionRoot,
      "node_modules",
      "@genii-foundation",
      "publisher-content",
    );
    const installedSchemaRoot = join(
      productionRoot,
      "node_modules",
      "@genii-foundation",
      "publisher-schema",
    );
    assert.equal(
      JSON.parse(
        await readFile(join(installedSchemaRoot, "package.json"), "utf8"),
      ).version,
      contentManifest.dependencies[schemaManifest.name],
    );
    assert.deepEqual(
      (await listFiles(installedContentRoot))
        .map((path) => packagePath(relative(installedContentRoot, path)))
        .filter((path) => !path.startsWith("node_modules/"))
        .sort(),
      await expectedContentPaths(),
    );
    assert.equal(
      await pathExists(join(productionRoot, "node_modules", "typescript")),
      false,
      "Production proof must not install the development compiler.",
    );

    for (const name of expectedBundledNames) {
      const installedRuntimeRoot = join(
        installedContentRoot,
        "node_modules",
        ...name.split("/"),
      );
      const installedManifest = JSON.parse(
        await readFile(join(installedRuntimeRoot, "package.json"), "utf8"),
      );
      assert.equal(
        installedManifest.version,
        workspaceLock.packages[`node_modules/${name}`].version,
        `${name} differs from the runtime packed with this compiler version.`,
      );
      assert.equal(
        (await readdir(installedRuntimeRoot)).some((entry) =>
          entry.toLowerCase().startsWith("license"),
        ),
        true,
        `Bundled ${name} omitted its license file.`,
      );
    }
    const unicodeLicense = await readFile(
      join(
        installedContentRoot,
        "node_modules",
        "@unicode",
        "unicode-15.1.0",
        "LICENSE-MIT.txt",
      ),
      "utf8",
    );
    assert.equal(
      unicodeLicense,
      await readFile(
        join(
          contentRoot,
          "third-party-licenses",
          "unicode-15.1.0-LICENSE-MIT.txt",
        ),
        "utf8",
      ),
    );
    assert.match(unicodeLicense, /^Copyright Mathias Bynens/m);
    assert.match(unicodeLicense, /Permission is hereby granted/);
    for (const name of bundledRoots) {
      assert.equal(
        await pathExists(
          join(productionRoot, "node_modules", ...name.split("/")),
        ),
        false,
        `${name} escaped the content package's frozen runtime.`,
      );
    }

    const sourceNotice = await readFile(
      join(contentRoot, "SOURCE-NOTICE"),
      "utf8",
    );
    const noticeComment = `/*\n${
      sourceNotice.endsWith("\n") ? sourceNotice : `${sourceNotice}\n`
    }*/\n`;
    for (const path of await expectedContentPaths()) {
      if (
        path.startsWith("src/") ||
        path.startsWith("scripts/") ||
        (path.startsWith("dist/") && path !== "dist/SOURCE-NOTICE")
      ) {
        assert.ok(
          (
            await readFile(join(installedContentRoot, path), "utf8")
          ).startsWith(noticeComment),
          `${path} lacks the exact Exhibit A notice.`,
        );
      }
    }

    const installedMarkdownOutput = await readFile(
      join(installedContentRoot, "dist", "markdown.js"),
      "utf8",
    );
    assert.ok(
      installedMarkdownOutput.includes(
        'from "./runtime/markdown-parser.js"',
      ),
      "Compiled Markdown adapter does not use its frozen parser runtime.",
    );
    assert.equal(
      installedMarkdownOutput.includes('"mdast-util-from-markdown"'),
      false,
      "Compiled Markdown adapter retains the conditional parser export.",
    );
    assert.equal(
      installedMarkdownOutput.includes('"mdast-util-to-string"'),
      false,
      "Compiled Markdown adapter retains the upstream text helper import.",
    );
    const frozenMarkdownRuntime = await readFile(
      join(
        installedContentRoot,
        "dist",
        "runtime",
        "markdown-parser.js",
      ),
      "utf8",
    );
    for (const [authority, pattern] of [
      ["environment", /\bprocess\s*\.\s*env\b/u],
      ["filesystem", /\bnode:(?:fs|fs\/promises)\b/u],
      ["network", /\bnode:(?:dns|http|https|net|tls)\b/u],
      ["network fetch", /\bfetch\s*\(/u],
      ["wall clock", /\bDate\s*\.\s*now\s*\(/u],
      ["wall-clock construction", /\bnew\s+Date\s*\(/u],
      ["high-resolution clock", /\bperformance\s*\.\s*now\s*\(/u],
      ["process clock", /\bprocess\s*\.\s*(?:hrtime|uptime)\s*\(/u],
      ["randomness", /\bMath\s*\.\s*random\s*\(/u],
      ["randomness module", /\bnode:crypto\b/u],
      ["debug package", /node_modules\/(?:debug|ms)\//u],
      ["development export", /node_modules\/[^/\n]+\/dev\//u],
    ]) {
      assert.doesNotMatch(
        frozenMarkdownRuntime,
        pattern,
        `Frozen Markdown runtime contains forbidden ${authority} authority.`,
      );
    }

    const packedText = (
      await Promise.all(
        (await listFiles(installedContentRoot))
          .filter(
            (path) =>
              !path.includes(`${sep}node_modules${sep}`) &&
              !path.endsWith("LICENSE"),
          )
          .map((path) => readFile(path, "utf8").catch(() => "")),
      )
    ).join("\n");
    for (const forbidden of [
      "coherence-thesis",
      "The Coherence Thesis",
      "volume-01",
      "/manuscripts/",
      "supabase.co",
      "vercel.app",
    ]) {
      assert.equal(
        packedText.includes(forbidden),
        false,
        `Packed content leaked publication-specific token ${forbidden}.`,
      );
    }
    const runtimeSource = (
      await Promise.all(
        (await listFiles(join(installedContentRoot, "src"))).map((path) =>
          readFile(path, "utf8"),
        ),
      )
    ).join("\n");
    for (const forbidden of [
      "node:fs",
      "node:child_process",
      "Date.now",
      "new Date(",
      "process.env",
      "fetch(",
    ]) {
      assert.equal(
        runtimeSource.includes(forbidden),
        false,
        `Content runtime contains forbidden authority ${forbidden}.`,
      );
    }

    for (const name of expectedBundledNames) {
      if (name === "@unicode/unicode-15.1.0") {
        continue;
      }
      await rm(
        join(
          installedContentRoot,
          "node_modules",
          ...name.split("/"),
        ),
        { force: true, recursive: true },
      );
    }

    const productionProof = `
      import assert from "node:assert/strict";
      import {
        compileMarkdownWork,
        compilePublicationContent,
        createPublicationContentArtifact,
        serializePublicationContentEnvelope,
        validateAudioCheckpoint,
        validatePublicationContentEnvelope,
      } from "@genii-foundation/publisher-content";
      import {
        resolvePublicationLayout,
        validatePublicationSemantics,
        validatePublicationShape,
        validateWorkShape,
      } from "@genii-foundation/publisher-schema";

      function value(result) {
        assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
        return result.value;
      }

      assert.equal(typeof validateAudioCheckpoint, "function");

      const publication = value(validatePublicationShape({
        "$schema": "https://publisher.genii.foundation/schemas/publication.schema.json",
        schemaVersion: "1.0",
        publication: {
          id: "sample-observatory",
          title: "Sample Observatory",
          language: "en",
          canonicalUrl: "https://sample.invalid",
          publisher: { name: "Example Publisher" },
        },
        engine: { compatibility: ">=1.0.0 <2.0.0" },
        layout: { mode: "canonical" },
        works: [{ id: "sample-work" }],
        collections: [],
        routes: {
          home: "/",
          work: "/works/{workId}",
          collection: "/collections/{collectionId}",
          updates: "/updates",
        },
        continuity: { redirects: [] },
        boundaries: {
          sourceRoots: ["publication"],
          outputRoots: [".publisher"],
        },
        attribution: {
          placement: "footer",
          copyright: "Copyright 2026 GENII Foundation",
          text: "Published with GENII Publisher",
          url: "https://publisher.genii.foundation",
          sourceCodeUrl: "https://github.com/genii-foundation/publisher",
        },
      }));
      const layout = value(resolvePublicationLayout(publication));
      const work = value(validateWorkShape({
        "$schema": "https://publisher.genii.foundation/schemas/work.schema.json",
        schemaVersion: "1.0",
        id: "sample-work",
        title: "A Neutral Sample",
        language: "en",
        publicationState: "published",
        route: "/works/caf%C3%A9/",
        manuscript: "manuscript.md",
      }));
      const workPath = layout.works.manifests[0].manifestPath;
      const workManifests = new Map([[workPath, work]]);
      const sourceGraph = value(validatePublicationSemantics({
        publication,
        engineVersion: "1.0.0",
        workManifests,
        collectionManifests: new Map(),
      }));
      const publicationText = JSON.stringify(publication, null, 2) + "\\n";
      const workText = JSON.stringify(work, null, 2) + "\\n";
      const markdown = "# A Neutral Sample\\n\\nThe packed compiler reads this small publication.\\n";
      const compiledWork = value(compileMarkdownWork({
        workId: "sample-work",
        sectionId: "sample-work-root",
        title: work.title,
        sourcePath: sourceGraph.works[0].manuscriptPath,
        markdown,
      }));
      const envelope = value(compilePublicationContent({
        engineVersion: "1.0.0",
        publication,
        sourceGraph,
        sources: [
          {
            path: layout.publicationManifestPath,
            role: "publication-manifest",
            mediaType: "application/json",
            contents: publicationText,
            rawBytes: new TextEncoder().encode(publicationText),
          },
          {
            path: workPath,
            role: "work-manifest",
            entityId: work.id,
            mediaType: "application/json",
            contents: workText,
            rawBytes: new TextEncoder().encode(workText),
          },
          compiledWork.source,
        ],
        works: [compiledWork.work],
      }));
      const validated = value(validatePublicationContentEnvelope(envelope));
      const serialized = serializePublicationContentEnvelope(validated);
      const artifact = createPublicationContentArtifact(validated);
      assert.equal(JSON.parse(serialized).publicationId, "sample-observatory");
      assert.equal(artifact.text, serialized);
      assert.equal(artifact.envelope.buildId, validated.buildId);
      assert.equal(validated.works[0].route, "/works/caf%C3%A9/");
      assert.deepEqual(validated.works[0].sections[0].readerAddress, {
        path: work.route,
      });
      assert.ok(
        validated.routes.active.some(
          ({ path }) => path === "/works/caf%C3%A9/",
        ),
      );
      assert.notEqual(
        validated.works[0].sections[0].blocks[0].anchor,
        validated.works[0].sections[0].blocks[0].id,
      );
      assert.match(artifact.hash, /^sha256:[a-f0-9]{64}$/);
      console.log(artifact.hash);
    `;
    const defaultRuntimeProof = run(
      process.execPath,
      ["--input-type=module", "--eval", productionProof],
      {
        cwd: productionRoot,
        env: {
          ...process.env,
          DEBUG: "",
          NODE_ENV: "production",
          TZ: "UTC",
        },
        label: "production-installed publication compilation proof",
      },
    );
    assert.match(defaultRuntimeProof, /^sha256:[a-f0-9]{64}$/);
    const developmentConditionProof = run(
      process.execPath,
      [
        "--conditions=development",
        "--input-type=module",
        "--eval",
        productionProof,
      ],
      {
        cwd: productionRoot,
        env: {
          ...process.env,
          DEBUG: "*",
          NODE_ENV: "development",
          TZ: "Pacific/Kiritimati",
        },
        label: "development-condition publication compilation proof",
      },
    );
    assert.equal(
      developmentConditionProof,
      defaultRuntimeProof,
      "Node conditions or ambient runtime state changed compiled content.",
    );

    const developmentSchemaSpecifier = `file:${packagePath(
      relative(developmentRoot, schemaTarball),
    )}`;
    const developmentRegistryDependencies = {
      ...Object.fromEntries(
        Object.entries(contentManifest.dependencies).filter(
          ([name]) => name !== schemaManifest.name,
        ),
      ),
      ...schemaManifest.dependencies,
      ...contentManifest.devDependencies,
    };
    const developmentManifest = {
      name: "genii-publisher-content-development-proof",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: {
        [schemaManifest.name]: developmentSchemaSpecifier,
        ...developmentRegistryDependencies,
      },
    };
    const developmentLock = {
      name: developmentManifest.name,
      version: developmentManifest.version,
      lockfileVersion: workspaceLock.lockfileVersion,
      requires: true,
      packages: {
        "": {
          name: developmentManifest.name,
          version: developmentManifest.version,
          dependencies: developmentManifest.dependencies,
        },
        [`node_modules/${schemaManifest.name}`]: {
          version: schemaManifest.version,
          resolved: developmentSchemaSpecifier,
          integrity: schemaPack.integrity,
          license: schemaManifest.license,
          dependencies: schemaManifest.dependencies,
          engines: schemaManifest.engines,
        },
        ...collectRegistryClosure(
          workspaceLock,
          developmentRegistryDependencies,
        ),
      },
    };
    await Promise.all([
      writeJson(join(developmentRoot, "package.json"), developmentManifest),
      writeJson(join(developmentRoot, "package-lock.json"), developmentLock),
    ]);
    runNpm(
      [
        "ci",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--cache",
        npmCache,
      ],
      { cwd: developmentRoot, label: "isolated development toolchain install" },
    );

    run("tar", ["-xzf", contentTarball, "-C", rebuildRoot], {
      cwd: temporaryRoot,
      label: "extract packed content source",
    });
    const extractedRoot = join(rebuildRoot, "package");
    const shippedDist = new Map(
      await Promise.all(
        (await listFiles(join(extractedRoot, "dist"))).map(async (path) => [
          packagePath(relative(join(extractedRoot, "dist"), path)),
          await readFile(path),
        ]),
      ),
    );
    await rm(join(extractedRoot, "node_modules"), {
      force: true,
      recursive: true,
    });
    await symlink(
      join(developmentRoot, "node_modules"),
      join(extractedRoot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    runNpm(["run", "build"], {
      cwd: extractedRoot,
      env: {
        ...process.env,
        NODE_OPTIONS: "--conditions=development",
      },
      label: "rebuild packed content source with development toolchain",
    });
    const rebuiltPaths = (await listFiles(join(extractedRoot, "dist")))
      .map((path) => packagePath(relative(join(extractedRoot, "dist"), path)))
      .sort();
    assert.deepEqual(rebuiltPaths, [...shippedDist.keys()].sort());
    for (const path of rebuiltPaths) {
      assert.deepEqual(
        await readFile(join(extractedRoot, "dist", path)),
        shippedDist.get(path),
        `Packed rebuild changed dist/${path}.`,
      );
    }

    const typeConsumer = `
      import {
        compilePublicationContent,
        createPublicationContentArtifact,
        planAudioCheckpointPromotion,
        serializePublicationContentEnvelope,
        validateAudioCheckpoint,
        validateAudioPublicationGuard,
        validatePublicationContentEnvelope,
        type AudioCheckpoint,
        type AudioPublicationGuardInput,
        type AudioPublicationGuardReport,
        type AudioPromotionPlan,
        type AudioPromotionPlanInput,
        type CompilePublicationContentInput,
        type ResolvedExtensionInput,
        type SectionReaderLocationInput,
      } from "@genii-foundation/publisher-content";
      import type {
        ExtensionCapability,
        PublicationContentEnvelope,
        ValidationResult,
      } from "@genii-foundation/publisher-schema";

      declare const input: CompilePublicationContentInput;
      declare const envelope: PublicationContentEnvelope;
      declare const checkpoint: AudioCheckpoint;
      declare const promotionInput: AudioPromotionPlanInput;
      declare const publicationGuardInput: AudioPublicationGuardInput;
      const readerLocation: SectionReaderLocationInput = { kind: "work" };
      const capability: ExtensionCapability = "content.project";
      const extension: ResolvedExtensionInput = {
        id: "projection",
        package: "@example/projection-extension",
        version: "1.0.0",
        capabilities: [capability],
      };
      const compiled: ValidationResult<PublicationContentEnvelope> =
        compilePublicationContent(input);
      const validated: ValidationResult<PublicationContentEnvelope> =
        validatePublicationContentEnvelope(envelope);
      const validatedCheckpoint: ValidationResult<AudioCheckpoint> =
        validateAudioCheckpoint(checkpoint);
      const promotion: ValidationResult<AudioPromotionPlan> =
        planAudioCheckpointPromotion(promotionInput);
      const publicationGuard: ValidationResult<AudioPublicationGuardReport> =
        validateAudioPublicationGuard(publicationGuardInput);
      const serialized: string = serializePublicationContentEnvelope(envelope);
      const artifact = createPublicationContentArtifact(envelope);
      void [
        compiled,
        validated,
        validatedCheckpoint,
        promotion,
        publicationGuard,
        serialized,
        artifact,
        readerLocation,
        extension,
      ];
    `;
    await Promise.all([
      writeFile(join(productionRoot, "consumer.ts"), typeConsumer, "utf8"),
      writeJson(join(productionRoot, "tsconfig.json"), {
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
    run(
      process.execPath,
      [
        join(developmentRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        join(productionRoot, "tsconfig.json"),
      ],
      {
        cwd: productionRoot,
        label: "packed declaration proof with isolated development compiler",
      },
    );
  } finally {
    await removeOwnedTempDirectory(temporaryRoot);
  }
});
