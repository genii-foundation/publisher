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

import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  publisherPublicLandingSourcePath,
  publisherPublicSchemaSources,
  readPublisherPublicSurfaceAuthority,
} from "../../provenance/scripts/verify-public-surface.mjs";

const defaultRepositoryRoot = realpathSync(
  fileURLToPath(new URL("../../", import.meta.url)),
);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("The public site manifest must contain JSON data only.");
}

function prepareOutputParent(repositoryRoot) {
  const outputParent = join(repositoryRoot, "dist");
  mkdirSync(outputParent, { recursive: true });
  const stat = lstatSync(outputParent);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    realpathSync(outputParent) !== outputParent
  ) {
    throw new Error("The public site output parent must be one real directory.");
  }
  return outputParent;
}

function removeExistingOutput(outputDirectory) {
  let stat;
  try {
    stat = lstatSync(outputDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("The public site output must be absent or one real directory.");
  }
  rmSync(outputDirectory, { recursive: true });
}

function writeExclusive(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx", mode: 0o644 });
}

export function buildPublisherPublicSite({
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  const authority = readPublisherPublicSurfaceAuthority({ repositoryRoot });
  const outputParent = prepareOutputParent(repositoryRoot);
  const outputDirectory = join(outputParent, "public-site");
  const stagingDirectory = join(
    outputParent,
    `.public-site-${process.pid}-${randomUUID()}`,
  );
  mkdirSync(stagingDirectory, { mode: 0o755 });

  try {
    const landingOutputPath = "index.html";
    writeExclusive(
      join(stagingDirectory, landingOutputPath),
      authority.landingBytes,
    );
    const schemas = authority.schemas.map((schema, index) => {
      const publicName = new URL(
        publisherPublicSchemaSources[index].url,
      ).pathname.split("/").at(-1);
      const outputPath = `schemas/${publicName}`;
      writeExclusive(join(stagingDirectory, outputPath), schema.bytes);
      return {
        bytes: schema.bytes.length,
        outputPath,
        sha256: sha256(schema.bytes),
        sourcePath: schema.sourcePath,
        url: schema.url,
      };
    });
    const basis = {
      format: "publisher-public-site-1",
      landing: {
        bytes: authority.landingBytes.length,
        outputPath: landingOutputPath,
        sha256: sha256(authority.landingBytes),
        sourcePath: publisherPublicLandingSourcePath,
      },
      schemas,
    };
    const receipt = {
      ...basis,
      sha256: sha256(canonicalJson(basis)),
    };
    writeExclusive(
      join(stagingDirectory, "public-surface-manifest.json"),
      `${canonicalJson(receipt)}\n`,
    );
    removeExistingOutput(outputDirectory);
    renameSync(stagingDirectory, outputDirectory);
    return Object.freeze({
      ...receipt,
      outputDirectory,
    });
  } catch (error) {
    rmSync(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}

export function buildPublisherPublicSiteCli(argv = process.argv.slice(2)) {
  if (argv.length !== 0) {
    throw new Error("The public site build accepts no command-line arguments.");
  }
  return buildPublisherPublicSite();
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const receipt = buildPublisherPublicSiteCli();
    console.log(
      `Built the Publisher public site with ${receipt.schemas.length} schema(s).`,
    );
    console.log(`Public site receipt: ${receipt.sha256}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
