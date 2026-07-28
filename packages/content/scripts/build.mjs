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

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = join(packageRoot, "src");
const distRoot = join(packageRoot, "dist");
const tsconfigPath = join(packageRoot, "tsconfig.json");
const packageManifestPath = join(packageRoot, "package.json");
const sourceNoticePath = join(packageRoot, "SOURCE-NOTICE");

function assertSafeDistPath() {
  const resolvedPackageRoot = resolve(packageRoot);
  const resolvedDistRoot = resolve(distRoot);

  if (
    dirname(resolvedDistRoot) !== resolvedPackageRoot ||
    basename(resolvedDistRoot) !== "dist"
  ) {
    throw new Error(
      `Refusing to clean unexpected build directory: ${resolvedDistRoot}`,
    );
  }
}

function toPackagePath(path) {
  return path.split(sep).join("/");
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
        throw new Error(`Unexpected non-file build entry: ${path}`);
      }
    }
  }

  await visit(root);
  return files;
}

function runCompiler(compilerPath) {
  const result = spawnSync(
    process.execPath,
    [compilerPath, "-p", tsconfigPath],
    {
      cwd: packageRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `TypeScript compiler exited with status ${result.status ?? "unknown"}.`,
    );
  }
}

const [packageManifestText, sourceNotice] = await Promise.all([
  readFile(packageManifestPath, "utf8"),
  readFile(sourceNoticePath, "utf8"),
]);
const packageManifest = JSON.parse(packageManifestText);
const expectedTypeScriptVersion = packageManifest.devDependencies?.typescript;

if (typeof expectedTypeScriptVersion !== "string") {
  throw new Error(
    "packages/content/package.json must pin a TypeScript development dependency.",
  );
}

const installedTypeScriptManifestPath = require.resolve(
  "typescript/package.json",
);
const installedTypeScriptManifest = JSON.parse(
  await readFile(installedTypeScriptManifestPath, "utf8"),
);

if (installedTypeScriptManifest.version !== expectedTypeScriptVersion) {
  throw new Error(
    `Installed TypeScript ${installedTypeScriptManifest.version} does not match the exact package pin ${expectedTypeScriptVersion}.`,
  );
}

const compilerPath = join(
  dirname(installedTypeScriptManifestPath),
  "bin",
  "tsc",
);
const noticeBody = sourceNotice.endsWith("\n")
  ? sourceNotice
  : `${sourceNotice}\n`;
const noticeComment = `/*\n${noticeBody}*/\n`;

assertSafeDistPath();
await rm(distRoot, { force: true, recursive: true });
runCompiler(compilerPath);

const builtTypes = await import(
  new URL(
    `../dist/types.js?version=${encodeURIComponent(packageManifest.version)}`,
    import.meta.url,
  )
);
if (builtTypes.CONTENT_COMPILER_VERSION !== packageManifest.version) {
  throw new Error(
    `Compiler constant ${builtTypes.CONTENT_COMPILER_VERSION ?? "(missing)"} does not match package version ${packageManifest.version}.`,
  );
}

const sourceFiles = (await listFiles(sourceRoot)).filter(
  (path) => path.endsWith(".ts") && !path.endsWith(".d.ts"),
);
const expectedOutputs = new Set(["SOURCE-NOTICE"]);

for (const sourceFile of sourceFiles) {
  const sourcePath = toPackagePath(relative(sourceRoot, sourceFile));
  const stem = sourcePath.slice(0, -".ts".length);
  expectedOutputs.add(`${stem}.js`);
  expectedOutputs.add(`${stem}.d.ts`);
}

await writeFile(join(distRoot, "SOURCE-NOTICE"), sourceNotice, "utf8");

const emittedFiles = await listFiles(distRoot);
for (const emittedFile of emittedFiles) {
  const emittedPath = toPackagePath(relative(distRoot, emittedFile));

  if (emittedPath.endsWith(".d.ts")) {
    const declaration = await readFile(emittedFile, "utf8");
    const noticedDeclaration = declaration.startsWith(noticeComment)
      ? declaration
      : `${noticeComment}${declaration}`;
    await writeFile(emittedFile, noticedDeclaration, "utf8");
  }
}

const finalFiles = await listFiles(distRoot);
const finalPaths = finalFiles
  .map((path) => toPackagePath(relative(distRoot, path)))
  .sort();
const expectedPaths = [...expectedOutputs].sort();

if (JSON.stringify(finalPaths) !== JSON.stringify(expectedPaths)) {
  throw new Error(
    `Build output differs from the exact expected file set.\nExpected: ${expectedPaths.join(", ")}\nActual: ${finalPaths.join(", ")}`,
  );
}

for (const outputFile of finalFiles) {
  const outputPath = toPackagePath(relative(distRoot, outputFile));

  if (outputPath === "SOURCE-NOTICE") {
    const copiedNotice = await readFile(outputFile, "utf8");
    if (copiedNotice !== sourceNotice) {
      throw new Error("dist/SOURCE-NOTICE does not match SOURCE-NOTICE.");
    }
    continue;
  }

  const contents = await readFile(outputFile, "utf8");
  if (!contents.startsWith(noticeComment)) {
    throw new Error(
      `Emitted source file is missing the exact Exhibit A notice: ${outputPath}`,
    );
  }
}
