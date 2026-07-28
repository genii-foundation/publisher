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
import {
  readFile,
  readdir,
} from "node:fs/promises";
import {
  join,
  relative,
} from "node:path";
import test from "node:test";
import {
  fileURLToPath,
} from "node:url";

const packageRoot = fileURLToPath(
  new URL("../packages/next/", import.meta.url),
);
const sourceRoot = join(packageRoot, "src");

async function sourceFiles(directory = sourceRoot) {
  const files = [];
  const entries = await readdir(directory, {
    withFileTypes: true,
  });
  entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") ||
        entry.name.endsWith(".tsx"))
    ) {
      files.push(path);
    }
  }
  return files;
}

test("publication rendering stays server-only outside the error boundary entry", async () => {
  const forbidden = [
    {
      pattern: /["']use client["']/u,
      label: "client component directive",
    },
    {
      pattern: /\b(?:document|localStorage|navigator|sessionStorage|window)\b/u,
      label: "browser global",
    },
    {
      pattern: /\buse(?:Effect|LayoutEffect|Reducer|Ref|State)\b/u,
      label: "client state hook",
    },
  ];

  for (const filePath of await sourceFiles()) {
    const source = await readFile(filePath, "utf8");
    const sourcePath = relative(packageRoot, filePath);
    if (sourcePath.startsWith("src/client/")) {
      if (sourcePath.endsWith("error.tsx")) {
        assert.match(
          source,
          /["']use client["']/u,
          `${sourcePath} must remain an explicit client boundary.`,
        );
      }
      continue;
    }
    for (const item of forbidden) {
      assert.doesNotMatch(
        source,
        item.pattern,
        `${sourcePath} contains a ${item.label}.`,
      );
    }
  }
});

test("the root, server, and client package entries preserve their boundary", async () => {
  const [rootSource, serverSource, clientSource] =
    await Promise.all([
      readFile(join(sourceRoot, "index.ts"), "utf8"),
      readFile(join(sourceRoot, "server", "index.ts"), "utf8"),
      readFile(join(sourceRoot, "client", "index.ts"), "utf8"),
    ]);
  assert.doesNotMatch(rootSource, /\.\/server\//u);
  assert.match(serverSource, /import "server-only";/u);
  assert.doesNotMatch(clientSource, /\.\/server\//u);
});
