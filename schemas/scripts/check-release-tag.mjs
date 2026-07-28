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

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "semver";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const packageManifestPath = new URL("../package.json", import.meta.url);

export function expectedReleaseTag(version) {
  const parsedVersion = parse(version);
  if (parsedVersion === null) {
    throw new Error(`Package version is not valid SemVer: ${version}`);
  }

  return parsedVersion.prerelease.length > 0 ? "next" : "latest";
}

export function assertReleaseTag(version, actualTag) {
  const expectedTag = expectedReleaseTag(version);

  if (actualTag === undefined || actualTag.length === 0) {
    if (expectedTag === "latest") {
      return;
    }

    throw new Error(
      `npm_config_tag is required. Publish ${version} with --tag ${expectedTag}.`,
    );
  }

  if (actualTag !== expectedTag) {
    throw new Error(
      `Refusing to publish ${version} with tag ${actualTag}. Use --tag ${expectedTag}.`,
    );
  }
}

async function main() {
  const packageManifest = JSON.parse(
    await readFile(packageManifestPath, "utf8"),
  );
  assertReleaseTag(packageManifest.version, process.env.npm_config_tag);
}

const invokedPath =
  process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === resolve(packageRoot, "scripts", "check-release-tag.mjs")) {
  await main();
}
