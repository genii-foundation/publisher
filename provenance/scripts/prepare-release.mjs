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
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  assertReleaseTag,
} from "../../packages/publisher/scripts/check-release-tag.mjs";
import {
  preparePackageArchives,
  resolveExactNpmInvocation,
  verifyPreparedPackageArchives,
} from "./package-artifacts.mjs";
import {
  runReleaseGate,
} from "./release-gate.mjs";

const repositoryRoot = fileURLToPath(
  new URL("../../", import.meta.url),
);

function parseArguments(argv) {
  const options = {
    outputDirectory: undefined,
    tag: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      options.outputDirectory = argv[++index];
    } else if (argument === "--tag") {
      options.tag = argv[++index];
    } else {
      throw new Error(
        `Unknown release preparation option ${argument}`,
      );
    }
  }
  if (
    typeof options.outputDirectory !== "string" ||
    options.outputDirectory.length === 0 ||
    !isAbsolute(options.outputDirectory)
  ) {
    throw new Error(
      "Release preparation requires --output <absolute-empty-directory>.",
    );
  }
  if (
    options.tag !== undefined &&
    (
      typeof options.tag !== "string" ||
      options.tag.length === 0
    )
  ) {
    throw new Error("--tag requires a nonempty npm tag.");
  }
  return Object.freeze({
    outputDirectory: resolve(options.outputDirectory),
    tag: options.tag,
  });
}

function isPublishablePackage(packageRoot) {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  return (
    manifest.private !== true &&
    manifest.publishConfig?.access === "public"
  );
}

export function discoverPublishablePackageRoots() {
  const roots = [];
  const schemaRoot = join(repositoryRoot, "schemas");
  if (isPublishablePackage(schemaRoot)) {
    roots.push("schemas/");
  }
  for (const entry of readdirSync(
    join(repositoryRoot, "packages"),
    { withFileTypes: true },
  ).sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (!entry.isDirectory()) {
      continue;
    }
    const absoluteRoot = join(
      repositoryRoot,
      "packages",
      entry.name,
    );
    if (isPublishablePackage(absoluteRoot)) {
      roots.push(`packages/${entry.name}/`);
    }
  }
  if (roots.length === 0) {
    throw new Error("No publishable workspace packages were found.");
  }
  return Object.freeze(roots.sort());
}

export function createReleaseManifest(
  tag,
  npmInvocation,
  archives,
) {
  return Object.freeze({
    schemaVersion: "1.0.0",
    packageManager: Object.freeze({
      name: "npm",
      version: npmInvocation.npmVersion,
    }),
    tag: tag ?? "latest",
    packages: Object.freeze(
      [...archives.values()].map((archive) =>
        Object.freeze({
          root: archive.root,
          name: archive.name,
          version: archive.version,
          archive: basename(archive.archivePath),
          fileCount: archive.fileCount,
          sha256: archive.sha256,
          integrity: archive.integrity,
          shasum: archive.shasum,
          files: archive.files,
          packageFiles: archive.packageFiles,
          size: archive.size,
        })
      ),
    ),
  });
}

export async function prepareRelease(
  argv = process.argv.slice(2),
) {
  const options = parseArguments(argv);
  const packageRoots = discoverPublishablePackageRoots();
  const npmInvocation = resolveExactNpmInvocation({
    repositoryRoot,
  });
  const preparation = await preparePackageArchives({
    repositoryRoot,
    packageRoots,
    npmInvocation,
    outputDirectory: options.outputDirectory,
  });
  let accepted = false;
  try {
    let archives = await verifyPreparedPackageArchives({
      repositoryRoot,
      expectedPackageRoots: packageRoots,
      npmInvocation,
      prepared: preparation.archives,
    });
    for (const archive of archives.values()) {
      assertReleaseTag(archive.version, options.tag, "the --tag argument");
    }
    const result = await runReleaseGate({
      preparedPackageArchives: archives,
      repositoryRoot,
    });
    archives = await verifyPreparedPackageArchives({
      repositoryRoot,
      expectedPackageRoots: packageRoots,
      npmInvocation,
      prepared: archives,
    });
    const manifestPath = join(
      preparation.candidateDirectory,
      "release-manifest.json",
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        createReleaseManifest(
          options.tag,
          npmInvocation,
          archives,
        ),
        null,
        2,
      )}\n`,
      {
        encoding: "utf8",
        flag: "wx",
      },
    );
    accepted = true;
    return Object.freeze({
      archives,
      count: result.count,
      manifestPath,
    });
  } finally {
    if (accepted) {
      preparation.dispose();
    } else {
      preparation.discard();
    }
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await prepareRelease();
    console.log(
      `Prepared ${result.archives.size} exact release candidate(s) and accepted ${result.count} provenance record(s).`,
    );
    console.log(`Release manifest: ${result.manifestPath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
