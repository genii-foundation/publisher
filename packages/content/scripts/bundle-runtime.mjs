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

import {
  build as buildWithEsbuild,
  version as installedEsbuildVersion,
} from "esbuild";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const distRoot = join(packageRoot, "dist");
const markdownOutputPath = join(distRoot, "markdown.js");
const frozenRuntimeRoot = join(distRoot, "runtime");
const frozenRuntimePath = join(frozenRuntimeRoot, "markdown-parser.js");
const stagingRoot = join(packageRoot, "node_modules");
const markerPath = join(stagingRoot, ".genii-publisher-runtime-bundle.json");
const packageManifestPath = join(packageRoot, "package.json");
const workspaceLockPath = join(workspaceRoot, "package-lock.json");
const sourceNoticePath = join(packageRoot, "SOURCE-NOTICE");
const frozenRuntimeImport =
  'import { fromMarkdown, toString } from "./runtime/markdown-parser.js";';
const upstreamRuntimeImports = [
  'import { fromMarkdown } from "mdast-util-from-markdown";',
  'import { toString } from "mdast-util-to-string";',
].join("\n");
const supplementalLicenses = new Map([
  [
    "@unicode/unicode-15.1.0",
    {
      source: join(
        packageRoot,
        "third-party-licenses",
        "unicode-15.1.0-LICENSE-MIT.txt",
      ),
      target: "LICENSE-MIT.txt",
    },
  ],
]);

function packagePath(path) {
  return path.split(sep).join("/");
}

function sourceNoticeComment(sourceNotice) {
  const body = sourceNotice.endsWith("\n")
    ? sourceNotice
    : `${sourceNotice}\n`;
  return `/*\n${body}*/\n`;
}

function assertInside(root, candidate) {
  const relativePath = relative(resolve(root), resolve(candidate));
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(`Refusing to modify an unsafe bundle path: ${candidate}`);
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
      throw new Error(`Runtime dependency ${name} lacks an immutable lock entry.`);
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
    throw new Error("bundleDependencies must name the Markdown runtime roots.");
  }

  for (const name of directNames) {
    const requestedVersion = manifest.dependencies?.[name];
    const lockedVersion = lock.packages?.[`node_modules/${name}`]?.version;
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
    packageName: manifest.name,
    packageVersion: manifest.version,
    directNames: [...directNames].sort(),
    packages: collectClosure(lock, directNames),
  };
}

async function findInstalledPackageManifest(name) {
  let directory = packageRoot;
  while (true) {
    const candidate = join(
      directory,
      "node_modules",
      ...name.split("/"),
      "package.json",
    );
    if (await pathExists(candidate)) {
      return readFile(candidate, "utf8").then(JSON.parse);
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Runtime dependency ${name} is not installed.`);
    }
    directory = parent;
  }
}

async function assertFrozenRuntime() {
  const [markdownOutput, frozenRuntime] = await Promise.all([
    readFile(markdownOutputPath, "utf8"),
    readFile(frozenRuntimePath, "utf8"),
  ]);

  if (!markdownOutput.includes(frozenRuntimeImport)) {
    throw new Error(
      "Compiled Markdown adapter does not import the frozen parser runtime.",
    );
  }
  for (const specifier of [
    '"mdast-util-from-markdown"',
    '"mdast-util-to-string"',
  ]) {
    if (markdownOutput.includes(specifier)) {
      throw new Error(
        `Compiled Markdown adapter retains condition-sensitive import ${specifier}.`,
      );
    }
  }

  const forbiddenAuthorities = [
    ["environment access", /\bprocess\s*\.\s*env\b/u],
    ["filesystem access", /\bnode:(?:fs|fs\/promises)\b/u],
    ["network access", /\bnode:(?:dns|http|https|net|tls)\b/u],
    ["network fetch", /\bfetch\s*\(/u],
    ["wall-clock access", /\bDate\s*\.\s*now\s*\(/u],
    ["wall-clock construction", /\bnew\s+Date\s*\(/u],
    ["high-resolution clock access", /\bperformance\s*\.\s*now\s*\(/u],
    ["process clock access", /\bprocess\s*\.\s*(?:hrtime|uptime)\s*\(/u],
    ["randomness", /\bMath\s*\.\s*random\s*\(/u],
    ["randomness module", /\bnode:crypto\b/u],
    ["debug runtime", /node_modules\/(?:debug|ms)\//u],
    ["development condition", /node_modules\/[^/\n]+\/dev\//u],
  ];
  for (const [authority, pattern] of forbiddenAuthorities) {
    if (pattern.test(frozenRuntime)) {
      throw new Error(`Frozen Markdown runtime contains ${authority}.`);
    }
  }
}

async function freeze() {
  const [markdownOutput, packageManifest, sourceNotice] = await Promise.all([
    readFile(markdownOutputPath, "utf8"),
    readFile(packageManifestPath, "utf8").then(JSON.parse),
    readFile(sourceNoticePath, "utf8"),
  ]);
  const upstreamImportOccurrences =
    markdownOutput.split(upstreamRuntimeImports).length - 1;
  const frozenImportOccurrences =
    markdownOutput.split(frozenRuntimeImport).length - 1;
  if (
    !(
      (upstreamImportOccurrences === 1 && frozenImportOccurrences === 0) ||
      (upstreamImportOccurrences === 0 && frozenImportOccurrences === 1)
    )
  ) {
    throw new Error(
      "Compiled Markdown adapter must contain exactly one upstream or frozen parser import.",
    );
  }
  const expectedEsbuildVersion = packageManifest.devDependencies?.esbuild;
  if (
    typeof expectedEsbuildVersion !== "string" ||
    expectedEsbuildVersion !== installedEsbuildVersion
  ) {
    throw new Error(
      `Installed esbuild ${installedEsbuildVersion} does not match the exact package pin ${expectedEsbuildVersion ?? "(missing)"}.`,
    );
  }

  for (const name of [
    "mdast-util-from-markdown",
    "mdast-util-to-string",
  ]) {
    if (!packageManifest.bundleDependencies?.includes(name)) {
      throw new Error(`Frozen Markdown runtime root ${name} is not bundled.`);
    }
    const requestedVersion = packageManifest.dependencies?.[name];
    const installedManifest = await findInstalledPackageManifest(name);
    if (
      typeof requestedVersion !== "string" ||
      installedManifest.version !== requestedVersion
    ) {
      throw new Error(
        `Installed ${name} ${installedManifest.version ?? "(missing)"} does not match the exact package pin ${requestedVersion ?? "(missing)"}.`,
      );
    }
  }

  assertInside(distRoot, frozenRuntimeRoot);
  const previousRuntime = (await pathExists(frozenRuntimePath))
    ? await readFile(frozenRuntimePath)
    : undefined;
  await rm(frozenRuntimeRoot, { force: true, recursive: true });
  await mkdir(frozenRuntimeRoot, { recursive: true });

  try {
    const result = await buildWithEsbuild({
      absWorkingDir: workspaceRoot,
      banner: { js: sourceNoticeComment(sourceNotice) },
      bundle: true,
      charset: "utf8",
      conditions: [],
      format: "esm",
      legalComments: "eof",
      logLevel: "silent",
      metafile: true,
      minify: true,
      outfile: frozenRuntimePath,
      packages: "bundle",
      platform: "node",
      sourcemap: false,
      stdin: {
        contents: [
          'export { fromMarkdown } from "mdast-util-from-markdown";',
          'export { toString } from "mdast-util-to-string";',
        ].join("\n"),
        loader: "js",
        resolveDir: packageRoot,
        sourcefile: "markdown-parser-entry.js",
      },
      target: ["node22.12"],
      treeShaking: true,
    });

    const inputPaths = Object.keys(result.metafile.inputs).map(packagePath);
    for (const expectedInput of [
      "node_modules/mdast-util-from-markdown/index.js",
      "node_modules/mdast-util-to-string/index.js",
    ]) {
      if (!inputPaths.some((path) => path.endsWith(expectedInput))) {
        throw new Error(
          `Frozen Markdown runtime omitted production input ${expectedInput}.`,
        );
      }
    }
    for (const forbiddenInput of [
      /node_modules\/debug\//u,
      /node_modules\/ms\//u,
      /node_modules\/[^/]+\/dev\//u,
    ]) {
      const match = inputPaths.find((path) => forbiddenInput.test(path));
      if (match !== undefined) {
        throw new Error(
          `Frozen Markdown runtime selected forbidden conditional input ${match}.`,
        );
      }
    }
    for (const output of Object.values(result.metafile.outputs)) {
      if (output.imports.some(({ external }) => external === true)) {
        throw new Error(
          "Frozen Markdown runtime retained an external runtime import.",
        );
      }
    }

    if (upstreamImportOccurrences === 1) {
      await writeFile(
        markdownOutputPath,
        markdownOutput.replace(upstreamRuntimeImports, frozenRuntimeImport),
        "utf8",
      );
    }
    await assertFrozenRuntime();
  } catch (error) {
    await rm(frozenRuntimeRoot, { force: true, recursive: true });
    if (previousRuntime !== undefined) {
      await mkdir(frozenRuntimeRoot, { recursive: true });
      await writeFile(frozenRuntimePath, previousRuntime);
    }
    throw error;
  }
}

async function readMarker() {
  if (!(await pathExists(markerPath))) {
    throw new Error(
      `Refusing to clean unowned runtime staging directory: ${stagingRoot}`,
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
    throw new Error(`Runtime staging marker is invalid: ${markerPath}`);
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
    if ((await pathExists(scopeRoot)) && (await readdir(scopeRoot)).length === 0) {
      await rmdir(scopeRoot);
    }
  }

  await rm(markerPath);
  const remaining = await readdir(stagingRoot);
  if (remaining.length !== 0) {
    throw new Error(
      `Refusing to remove runtime staging root with unexpected entries: ${remaining.join(", ")}`,
    );
  }
  await rmdir(stagingRoot);
}

async function stage() {
  if (await pathExists(stagingRoot)) {
    await clean();
  }

  await assertFrozenRuntime();
  const plan = await readBundlePlan();
  await mkdir(stagingRoot);

  try {
    for (const entry of plan.packages) {
      const source = join(workspaceRoot, "node_modules", ...entry.name.split("/"));
      const target = join(stagingRoot, ...entry.name.split("/"));
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

      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, {
        dereference: true,
        recursive: true,
        verbatimSymlinks: false,
      });

      const supplementalLicense = supplementalLicenses.get(entry.name);
      if (supplementalLicense !== undefined) {
        const licenseTarget = join(target, supplementalLicense.target);
        assertInside(target, licenseTarget);
        if (await pathExists(licenseTarget)) {
          throw new Error(
            `Refusing to replace an upstream ${entry.name} license file.`,
          );
        }
        await cp(supplementalLicense.source, licenseTarget);
      }
    }

    await writeFile(
      markerPath,
      `${JSON.stringify({ format: 1, ...plan }, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    const incompleteMarker = {
      format: 1,
      ...plan,
    };
    await writeFile(
      markerPath,
      `${JSON.stringify(incompleteMarker, null, 2)}\n`,
      "utf8",
    );
    await clean();
    throw error;
  }
}

const action = process.argv[2];
if (action === "freeze") {
  await freeze();
} else if (action === "stage") {
  await stage();
} else if (action === "clean") {
  await clean();
} else {
  throw new Error(
    "Expected bundle-runtime action: freeze, stage, or clean.",
  );
}
