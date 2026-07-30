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
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  sep,
} from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertReleaseTag,
  expectedReleaseTag,
} from "../packages/publisher/scripts/check-release-tag.mjs";

const npmExecPath = process.env.npm_execpath;
if (npmExecPath === undefined || npmExecPath.length === 0) {
  throw new Error(
    "The Publisher package consumer test must run through the exact npm CLI.",
  );
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaRoot = join(repositoryRoot, "schemas");
const contentRoot = join(repositoryRoot, "packages", "content");
const publisherRoot = join(repositoryRoot, "packages", "publisher");
const readerRoot = join(repositoryRoot, "packages", "reader");
const releaseTagScript = join(
  publisherRoot,
  "scripts",
  "check-release-tag.mjs",
);
const publicationFixture = join(
  repositoryRoot,
  "fixtures",
  "canonical-field-notes",
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
  return spawnSync(process.execPath, [releaseTagScript], {
    cwd: publisherRoot,
    encoding: "utf8",
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function packagePath(path) {
  return path.split(sep).join("/");
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

async function removeOwnedTempDirectory(path) {
  const tempRoot = await realpath(tmpdir());
  const target = await realpath(path);
  if (
    dirname(target) !== tempRoot ||
    !basename(target).startsWith(
      "genii-publisher-application-consumer-",
    )
  ) {
    throw new Error(`Refusing to remove unexpected path: ${target}`);
  }
  await rm(target, { force: true, recursive: true });
}

function packPackage(root, destination) {
  const output = runNpm(
    [
      "pack",
      "--silent",
      "--json",
      "--pack-destination",
      destination,
      root,
    ],
    {
      cwd: destination,
      label: `pack ${basename(root)}`,
    },
  );
  const results = JSON.parse(output);
  assert.equal(results.length, 1);
  return results[0];
}

async function expectedPublisherPackagePaths() {
  const sourceFiles = (await listFiles(join(publisherRoot, "src"))).filter(
    (path) => path.endsWith(".ts") && !path.endsWith(".d.ts"),
  );
  const scriptFiles = await listFiles(join(publisherRoot, "scripts"));
  const binaryFiles = await listFiles(join(publisherRoot, "bin"));
  return [
    "CHANGES.md",
    "LEGAL",
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "SOURCE-NOTICE",
    "THIRD_PARTY_NOTICES.md",
    // The author lifecycle executable ships with the package, because an author
    // runs it out of their own installation.
    ...binaryFiles.map(
      (binary) =>
        `bin/${packagePath(
          relative(join(publisherRoot, "bin"), binary),
        )}`,
    ),
    "dist/SOURCE-NOTICE",
    ...sourceFiles.flatMap((source) => {
      const stem = packagePath(
        relative(join(publisherRoot, "src"), source),
      ).slice(0, -3);
      return [`dist/${stem}.d.ts`, `dist/${stem}.js`];
    }),
    "package.json",
    ...scriptFiles.map(
      (script) =>
        `scripts/${packagePath(
          relative(join(publisherRoot, "scripts"), script),
        )}`,
    ),
    ...sourceFiles.map(
      (source) =>
        `src/${packagePath(
          relative(join(publisherRoot, "src"), source),
        )}`,
    ),
    "tsconfig.json",
  ].sort();
}

test("Publisher release lifecycle enforces prerelease and stable npm tags", () => {
  assert.equal(expectedReleaseTag("1.0.0-alpha.1"), "next");
  assert.equal(expectedReleaseTag("1.0.0"), "latest");
  assert.throws(
    () => expectedReleaseTag("not-a-version"),
    /not valid SemVer/,
  );
  assert.doesNotThrow(() =>
    assertReleaseTag("1.0.0-alpha.1", "next"),
  );
  assert.throws(
    () => assertReleaseTag("1.0.0-alpha.1", undefined),
    /--tag next/,
  );
  assert.throws(
    () => assertReleaseTag("1.0.0-alpha.1", "latest"),
    /--tag next/,
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

test("packed Publisher application installs offline and loads an unrelated publication", async () => {
  const [publisherManifest, workspaceManifest] = await Promise.all([
    readFile(join(publisherRoot, "package.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(join(repositoryRoot, "package.json"), "utf8").then(
      JSON.parse,
    ),
  ]);
  assert.equal(
    runNpm(["--version"], { label: "npm version check" }),
    workspaceManifest.engines.npm,
  );
  assert.equal(publisherManifest.publishConfig.access, "public");
  assert.equal(publisherManifest.publishConfig.provenance, true);
  assert.equal(
    Object.hasOwn(publisherManifest.publishConfig, "tag"),
    false,
  );
  assert.equal(
    publisherManifest.scripts.prepublishOnly,
    "node ../../provenance/scripts/reject-directory-publish.mjs",
  );
  assert.deepEqual(publisherManifest.exports["./node"], {
    types: "./dist/node.d.ts",
    node: "./dist/node.js",
  });
  assert.equal(publisherManifest.devDependencies.esbuild, "0.27.0");
  // Pinned deliberately. The application package's dependency surface is what a
  // consumer installs, so growing it is an edit somebody makes on purpose rather
  // than a thing that happens to them.
  assert.deepEqual(publisherManifest.dependencies, {
    "@genii-foundation/publisher-content": "0.1.0-alpha.0",
    "@genii-foundation/publisher-reader": "0.1.0-alpha.0",
    "@genii-foundation/publisher-schema": "0.1.0-alpha.0",
  });

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "genii-publisher-application-consumer-"),
  );
  try {
    const packDirectory = join(temporaryRoot, "pack");
    const consumerDirectory = join(temporaryRoot, "consumer");
    await Promise.all([
      mkdir(packDirectory),
      mkdir(consumerDirectory),
    ]);

    const schemaPack = packPackage(schemaRoot, packDirectory);
    const contentPack = packPackage(contentRoot, packDirectory);
    const readerPack = packPackage(readerRoot, packDirectory);
    const publisherPack = packPackage(publisherRoot, packDirectory);
    assert.deepEqual(
      publisherPack.files.map(({ path }) => path).sort(),
      await expectedPublisherPackagePaths(),
    );

    const tarball = (packResult) =>
      `file:${packagePath(
        relative(
          consumerDirectory,
          join(packDirectory, packResult.filename),
        ),
      )}`;
    await writeFile(
      join(consumerDirectory, "package.json"),
      `${JSON.stringify(
        {
          name: "publisher-packed-consumer",
          version: "1.0.0",
          private: true,
          type: "module",
          dependencies: {
            "@genii-foundation/publisher":
              tarball(publisherPack),
            "@genii-foundation/publisher-content":
              tarball(contentPack),
            "@genii-foundation/publisher-reader":
              tarball(readerPack),
            "@genii-foundation/publisher-schema":
              tarball(schemaPack),
          },
          devDependencies: {
            "@types/node":
              publisherManifest.devDependencies["@types/node"],
            esbuild: publisherManifest.devDependencies.esbuild,
            typescript:
              publisherManifest.devDependencies.typescript,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    runNpm(
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd: consumerDirectory,
        label: "clean Publisher consumer install",
      },
    );
    await rm(join(consumerDirectory, "node_modules"), {
      force: true,
      recursive: true,
    });
    runNpm(
      [
        "ci",
        "--ignore-scripts",
        "--offline",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd: consumerDirectory,
        label: "offline frozen Publisher consumer install",
      },
    );
    runNpm(
      ["audit", "--omit=dev", "--audit-level=low"],
      {
        cwd: consumerDirectory,
        label: "Publisher consumer production audit",
      },
    );

    const declarationProbe = join(consumerDirectory, "declarations.ts");
    const declarationConfig = join(consumerDirectory, "tsconfig.json");
    await Promise.all([
      writeFile(
        declarationProbe,
        `import {
  PUBLISHER_VERSION,
  type CompilationSourceInput,
  type Diagnostic,
  type PublicationManifest,
  type ResolvedPublicationSourceGraph,
} from "@genii-foundation/publisher";
import {
  compileLoadedPublicationContent,
  loadPublicationCompilationSources,
  PUBLISHER_SOURCE_LOADER_LIMITS,
  type CompileLoadedPublicationContentInput,
  type LoadedPublicationCompilationSources,
  type LoadPublicationCompilationSourcesInput,
  type LoadPublicationCompilationSourcesResult,
  type PublicationSourceLoaderLimits,
} from "@genii-foundation/publisher/node";

const input: LoadPublicationCompilationSourcesInput = {
  publicationRoot: "/absolute/publication",
};
const pending: Promise<LoadPublicationCompilationSourcesResult> =
  loadPublicationCompilationSources(input);
const version: string = PUBLISHER_VERSION;
const limits: PublicationSourceLoaderLimits =
  PUBLISHER_SOURCE_LOADER_LIMITS;
const source: CompilationSourceInput = {
  path: "publication.json",
  role: "publication-manifest",
  mediaType: "application/json",
  contents: "{}",
  rawBytes: new TextEncoder().encode("{}"),
};
declare const publication: PublicationManifest;
declare const sourceGraph: ResolvedPublicationSourceGraph;
// @ts-expect-error Loader snapshots are opaque and cannot be constructed.
const forged: LoadedPublicationCompilationSources = {
  publication,
  sourceGraph,
  sources: [source],
};
declare const compileInput: CompileLoadedPublicationContentInput;
const compiled = compileLoadedPublicationContent(compileInput);
async function useLoaded(): Promise<readonly Diagnostic[]> {
  const result = await pending;
  if (!result.valid) {
    return result.diagnostics;
  }
  const loaded: LoadedPublicationCompilationSources = result.value;
  const validation = compileLoadedPublicationContent({
    loaded,
    works: [],
  });
  return validation.diagnostics;
}
void [version, limits, forged, compiled, useLoaded];
`,
        "utf8",
      ),
      writeFile(
        declarationConfig,
        `${JSON.stringify(
          {
            compilerOptions: {
              exactOptionalPropertyTypes: true,
              lib: ["ES2022", "DOM"],
              module: "NodeNext",
              moduleResolution: "NodeNext",
              noEmit: true,
              skipLibCheck: false,
              strict: true,
              target: "ES2022",
              types: ["node"],
            },
            files: ["declarations.ts"],
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
    ]);
    run(
      process.execPath,
      [
        join(
          consumerDirectory,
          "node_modules",
          "typescript",
          "bin",
          "tsc",
        ),
        "--project",
        declarationConfig,
      ],
      {
        cwd: consumerDirectory,
        label: "clean Publisher declaration consumer",
      },
    );

    const browserEntry = join(
      consumerDirectory,
      "browser-entry.mjs",
    );
    const browserBundle = join(
      consumerDirectory,
      "browser-bundle.mjs",
    );
    const browserMetafile = join(
      consumerDirectory,
      "browser-bundle-meta.json",
    );
    const esbuildCli = join(
      consumerDirectory,
      "node_modules",
      "esbuild",
      "bin",
      "esbuild",
    );
    await writeFile(
      browserEntry,
      `import { PUBLISHER_VERSION } from "@genii-foundation/publisher";
globalThis.publisherVersion = PUBLISHER_VERSION;
`,
      "utf8",
    );
    run(
      process.execPath,
      [
        esbuildCli,
        browserEntry,
        "--bundle",
        "--platform=browser",
        "--conditions=browser",
        "--format=esm",
        `--outfile=${browserBundle}`,
        `--metafile=${browserMetafile}`,
        "--log-level=warning",
      ],
      {
        cwd: consumerDirectory,
        label: "browser-condition Publisher root bundle",
      },
    );
    const [browserCode, browserMetadata] = await Promise.all([
      readFile(browserBundle, "utf8"),
      readFile(browserMetafile, "utf8").then(JSON.parse),
    ]);
    assert.match(browserCode, /0\.1\.0-alpha\.0/);
    assert.equal(browserCode.includes("node:"), false);
    assert.equal(
      Object.keys(browserMetadata.inputs).some(
        (path) =>
          path.includes(
            "@genii-foundation/publisher/dist/node",
          ),
      ),
      false,
    );

    const browserNodeEntry = join(
      consumerDirectory,
      "browser-node-entry.mjs",
    );
    await writeFile(
      browserNodeEntry,
      `import { loadPublicationCompilationSources } from "@genii-foundation/publisher/node";
void loadPublicationCompilationSources;
`,
      "utf8",
    );
    const browserNodeResult = spawnSync(
      process.execPath,
      [
        esbuildCli,
        browserNodeEntry,
        "--bundle",
        "--platform=browser",
        "--conditions=browser",
        "--format=esm",
        "--log-level=warning",
        `--outfile=${join(
          consumerDirectory,
          "browser-node-bundle.mjs",
        )}`,
      ],
      {
        cwd: consumerDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    assert.notEqual(browserNodeResult.status, 0);
    assert.match(
      browserNodeResult.stderr,
      /Could not resolve "@genii-foundation\/publisher\/node"/,
    );

    const consumerPublicationRoot = join(
      consumerDirectory,
      "publication",
    );
    await cp(publicationFixture, consumerPublicationRoot, {
      recursive: true,
      verbatimSymlinks: true,
    });
    const verifierPath = join(consumerDirectory, "verify.mjs");
    await writeFile(
      verifierPath,
      `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compileMarkdownWork } from "@genii-foundation/publisher-content";
import { PUBLISHER_VERSION } from "@genii-foundation/publisher";
import {
  compileLoadedPublicationContent,
  loadPublicationCompilationSources,
  PUBLISHER_SOURCE_LOADER_LIMITS,
} from "@genii-foundation/publisher/node";

assert.equal(PUBLISHER_VERSION, "0.1.0-alpha.0");
assert.equal(PUBLISHER_SOURCE_LOADER_LIMITS.maximumSourceFiles, 20_000);
const rootModule = await readFile(
  new URL("./node_modules/@genii-foundation/publisher/dist/index.js", import.meta.url),
  "utf8",
);
assert.equal(rootModule.includes("node:"), false);
const publicationRoot = join(import.meta.dirname, "publication");
const result = await loadPublicationCompilationSources({
  publicationRoot,
});
assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
assert.deepEqual(
  result.value.sources.map(({ path, role }) => [path, role]),
  [
    ["publication.json", "publication-manifest"],
    ["publication/works/rain-gauge/work.json", "work-manifest"],
    ["publication/collections/weather-observations/collection.json", "collection-manifest"],
    ["publication/works/rain-gauge/manuscript.md", "manuscript"],
  ],
);
for (const source of result.value.sources) {
  const disk = new Uint8Array(await readFile(join(publicationRoot, source.path)));
  assert.deepEqual(source.rawBytes, disk);
  assert.equal(Object.isFrozen(source), true);
}
const manuscript = result.value.sources.find(
  ({ role }) => role === "manuscript",
);
assert.ok(manuscript);
const workSource = result.value.sourceGraph.works[0];
assert.ok(workSource);
const adapted = compileMarkdownWork({
  workId: workSource.workId,
  sectionId: workSource.workId + "-root",
  title: workSource.manifest.title,
  sourcePath: manuscript.path,
  markdown: manuscript.contents,
});
assert.equal(adapted.valid, true, JSON.stringify(adapted.diagnostics));
const resolvedExtensions = (result.value.publication.extensions ?? []).map(
  (extension) => ({
    id: extension.id,
    package: extension.package,
    version: PUBLISHER_VERSION,
    capabilities: extension.capabilities,
  }),
);
const compiled = compileLoadedPublicationContent({
  loaded: result.value,
  works: [adapted.value.work],
  extensions: resolvedExtensions,
});
assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics));
assert.equal(compiled.value.engineVersion, PUBLISHER_VERSION);
const rejectedOverride = compileLoadedPublicationContent({
  loaded: result.value,
  works: [adapted.value.work],
  engineVersion: "9.9.9",
});
assert.equal(rejectedOverride.valid, false);
assert.equal(
  rejectedOverride.diagnostics[0].code,
  "publisher.compile_input.invalid",
);
assert.equal(JSON.stringify(result).includes(publicationRoot), false);
`,
      "utf8",
    );
    run(process.execPath, [verifierPath], {
      cwd: consumerDirectory,
      label: "packed Publisher consumer verification",
    });
  } finally {
    await removeOwnedTempDirectory(temporaryRoot);
  }
});
