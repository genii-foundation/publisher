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

import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";
import addFormats from "ajv-formats";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = join(packageRoot, "src");
const distRoot = join(packageRoot, "dist");
const tsconfigPath = join(packageRoot, "tsconfig.json");
const packageManifestPath = join(packageRoot, "package.json");
const sourceNoticePath = join(packageRoot, "SOURCE-NOTICE");
const caseFoldingGeneratorPath = join(
  packageRoot,
  "scripts",
  "generate-case-folding.mjs",
);
const generatedValidatorsPath = join(
  distRoot,
  "generated-validators.js",
);
const validatorDefinitions = Object.freeze([
  {
    exportName: "publicationValidator",
    fileName: "publication.schema.json",
  },
  {
    exportName: "workValidator",
    fileName: "work.schema.json",
  },
  {
    exportName: "collectionValidator",
    fileName: "collection.schema.json",
  },
  {
    exportName: "contentEnvelopeValidator",
    fileName: "content-envelope.schema.json",
  },
  {
    exportName: "readerEnvelopeValidator",
    fileName: "reader-envelope.schema.json",
  },
  {
    exportName: "audioCatalogValidator",
    fileName: "audio-catalog.schema.json",
  },
  {
    exportName: "audioEnvelopeValidator",
    fileName: "audio-envelope.schema.json",
  },
  {
    exportName: "syncEnvelopeValidator",
    fileName: "sync-envelope.schema.json",
  },
]);
const embeddedRuntimeDefinitions = Object.freeze([
  {
    moduleId: "ajv/dist/runtime/ucs2length",
    packageName: "ajv",
  },
  {
    moduleId: "ajv/dist/runtime/equal",
    packageName: "ajv",
  },
  {
    moduleId: "ajv-formats/dist/formats",
    packageName: "ajv-formats",
  },
  {
    moduleId: "fast-deep-equal",
    packageName: "fast-deep-equal",
  },
]);

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

function verifyGeneratedCaseFolding() {
  const result = spawnSync(
    process.execPath,
    [caseFoldingGeneratorPath],
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
      `Unicode case-fold table verification exited with status ${result.status ?? "unknown"}.`,
    );
  }
}

function assertExactDevelopmentDependency(
  packageManifest,
  packageName,
  installedManifest,
) {
  const expectedVersion = packageManifest.devDependencies?.[packageName];
  if (typeof expectedVersion !== "string") {
    throw new Error(
      `schemas/package.json must pin ${packageName} as a development dependency.`,
    );
  }
  if (installedManifest.version !== expectedVersion) {
    throw new Error(
      `Installed ${packageName} ${installedManifest.version} does not match the exact package pin ${expectedVersion}.`,
    );
  }
}

function sanitizeEmbeddedCommonJs(source) {
  return source
    .replace(/^.*\.code = ['"]require\([^;\n]+;?\r?\n/gmu, "")
    .replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu, "")
    .replaceAll("require(", "loadModule(")
    .trimEnd();
}

function indent(text, spaces) {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function licenseComment(packageName, licenseText) {
  const safeLicense = licenseText.replaceAll("*/", "* /").trimEnd();
  return [
    "/*",
    `Bundled validator runtime from ${packageName}, used under its terms below.`,
    safeLicense,
    "*/",
  ].join("\n");
}

async function createStandaloneValidators(noticeComment) {
  const ajv = new Ajv2020({
    // JSON-domain and semantic collectors provide bounded exact aggregates.
    // Generated structural validation uses AJV's fail-fast mode so hostile
    // near-limit arrays cannot materialize a document-wide all-errors graph.
    // Branching keywords may still report the small deterministic set needed
    // to explain their failed alternatives.
    allErrors: false,
    coerceTypes: false,
    code: {
      esm: true,
      source: true,
    },
    removeAdditional: false,
    strict: true,
    useDefaults: false,
    validateFormats: true,
  });
  addFormats(ajv);

  for (const definition of validatorDefinitions) {
    const schema = JSON.parse(
      await readFile(join(packageRoot, definition.fileName), "utf8"),
    );
    ajv.addSchema(schema, definition.exportName);
  }

  const validatorExports = Object.fromEntries(
    validatorDefinitions.map(({ exportName }) => [
      exportName,
      exportName,
    ]),
  );
  const validatorSource = standaloneCode(
    ajv,
    validatorExports,
  ).replaceAll("require(", "loadEmbeddedModule(");

  const embeddedModules = await Promise.all(
    embeddedRuntimeDefinitions.map(async (definition) => ({
      ...definition,
      source: sanitizeEmbeddedCommonJs(
        await readFile(
          require.resolve(definition.moduleId),
          "utf8",
        ),
      ),
    })),
  );
  const packageLicenses = new Map();
  for (const definition of embeddedRuntimeDefinitions) {
    if (packageLicenses.has(definition.packageName)) {
      continue;
    }
    const manifestPath = require.resolve(
      `${definition.packageName}/package.json`,
    );
    packageLicenses.set(
      definition.packageName,
      await readFile(join(dirname(manifestPath), "LICENSE"), "utf8"),
    );
  }

  const licenseComments = [...packageLicenses]
    .map(([packageName, license]) =>
      licenseComment(packageName, license),
    )
    .join("\n\n");
  const moduleFactories = embeddedModules
    .map(
      ({ moduleId, source }) =>
        [
          `  ${JSON.stringify(moduleId)}: (module, exports, loadModule) => {`,
          indent(source, 4),
          "  },",
        ].join("\n"),
    )
    .join("\n");
  const embeddedLoader = [
    "const embeddedModuleFactories = Object.freeze({",
    moduleFactories,
    "});",
    "const embeddedModuleCache = new Map();",
    "function loadEmbeddedModule(moduleId) {",
    "  const cached = embeddedModuleCache.get(moduleId);",
    "  if (cached !== undefined) {",
    "    return cached.exports;",
    "  }",
    "  const factory = embeddedModuleFactories[moduleId];",
    "  if (factory === undefined) {",
    '    throw new Error(`Unknown embedded validator module: ${moduleId}`);',
    "  }",
    "  const module = { exports: {} };",
    "  embeddedModuleCache.set(moduleId, module);",
    "  factory(module, module.exports, loadEmbeddedModule);",
    "  return module.exports;",
    "}",
  ].join("\n");

  return [
    noticeComment.trimEnd(),
    licenseComments,
    embeddedLoader,
    validatorSource.trimEnd(),
    "",
  ].join("\n\n");
}

const [packageManifestText, sourceNotice] = await Promise.all([
  readFile(packageManifestPath, "utf8"),
  readFile(sourceNoticePath, "utf8"),
]);
const packageManifest = JSON.parse(packageManifestText);

const installedTypeScriptManifestPath = require.resolve(
  "typescript/package.json",
);
const installedTypeScriptManifest = JSON.parse(
  await readFile(installedTypeScriptManifestPath, "utf8"),
);
assertExactDevelopmentDependency(
  packageManifest,
  "typescript",
  installedTypeScriptManifest,
);
for (const packageName of ["ajv", "ajv-formats"]) {
  const installedManifestPath = require.resolve(
    `${packageName}/package.json`,
  );
  const installedManifest = JSON.parse(
    await readFile(installedManifestPath, "utf8"),
  );
  assertExactDevelopmentDependency(
    packageManifest,
    packageName,
    installedManifest,
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
verifyGeneratedCaseFolding();
await rm(distRoot, { force: true, recursive: true });
runCompiler(compilerPath);
await writeFile(
  generatedValidatorsPath,
  await createStandaloneValidators(noticeComment),
  "utf8",
);

const sourceFiles = (await listFiles(sourceRoot)).filter(
  (path) => path.endsWith(".ts") && !path.endsWith(".d.ts"),
);
const expectedOutputs = new Set([
  "SOURCE-NOTICE",
  "generated-validators.js",
]);

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
