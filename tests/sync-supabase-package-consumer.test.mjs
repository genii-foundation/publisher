/*
No alternative license is selected for GENII Publisher Original Code. The alternative-license fields in the required Exhibit A notice below are intentionally unpopulated.

“The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/cpal-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is GENII Publisher.
The Original Developer is not the Initial Developer and is __________. If left blank, the Original Developer is the Initial Developer.
The Initial Developer of the Original Code is GENII Foundation. All portions of the code written by GENII Foundation are Copyright (c) 2026 GENII Foundation. All Rights Reserved.
Contributor ______________________.
Alternatively, the contents of this file may be used under the terms of the _____ license (the [___] License), in which case the provisions of [______] License are applicable instead of those above.
If you wish to allow use of your version of this file only under the terms of the [____] License and not to allow others to use your version under the CPAL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the [___] License. If you do not delete the provisions above, a recipient may use your version under either the CPAL or the [___] License.”
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

const npmExecPath = process.env.npm_execpath;
if (npmExecPath === undefined || npmExecPath.length === 0) {
  throw new Error(
    "The Supabase package consumer test must run through the exact npm CLI.",
  );
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const packageRoot = join(repositoryRoot, "packages", "sync-supabase");

function runNpm(args, options = {}) {
  const result = spawnSync(process.execPath, [npmExecPath, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 30 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      [
        `${options.label ?? `npm ${args[0]}`} exited with status ${result.status}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

async function removeOwnedTemporaryRoot(path) {
  const realTemporaryRoot = await realpath(tmpdir());
  const realTarget = await realpath(path);
  if (
    dirname(realTarget) !== realTemporaryRoot ||
    !basename(realTarget).startsWith("genii-publisher-sync-consumer-")
  ) {
    throw new Error(`Refusing to remove unexpected path ${realTarget}.`);
  }
  await rm(realTarget, { force: true, recursive: true });
}

const expectedPackageFiles = [
  "CHANGES.md",
  "LEGAL",
  "LICENSE",
  "NOTICE.md",
  "README.md",
  "SOURCE-NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "migrations/0001_reader_sync_core.sql",
  "migrations/0002_reader_engagement.sql",
  "migrations/0003_reader_bookmarks.sql",
  "migrations/0004_reader_sync_api_grants.sql",
  "migrations/0005_atomic_bookmark_merge.sql",
  "migrations/0006_reader_data_deletion.sql",
  "migrations/0007_publication_scope.sql",
  "package.json",
  "provider.mjs",
  "scripts/check-release-tag.mjs",
  "server-entry.mjs",
  "server.mjs",
  "third-party-licenses/next-LICENSE-MIT.txt",
  "third-party-licenses/server-only-LICENSE-MIT.txt",
  "third-party-licenses/supabase-js-LICENSE-MIT.txt",
  "third-party-licenses/supabase-ssr-LICENSE-MIT.txt",
].sort();

test("the packed Supabase provider installs into a clean inert consumer", async () => {
  const temporaryRoot = await realpath(
    await mkdtemp(join(tmpdir(), "genii-publisher-sync-consumer-")),
  );
  try {
    const packed = JSON.parse(
      runNpm(
        [
          "pack",
          "--silent",
          "--json",
          "--pack-destination",
          temporaryRoot,
          packageRoot,
        ],
        { cwd: temporaryRoot, label: "pack Supabase provider" },
      ),
    );
    assert.equal(packed.length, 1);
    const [archive] = packed;
    assert.ok(archive);
    assert.equal(
      archive.name,
      "@genii-foundation/publisher-sync-supabase",
    );
    assert.equal(archive.version, "0.1.0-alpha.0");
    assert.deepEqual(
      archive.files.map(({ path }) => path).sort(),
      expectedPackageFiles,
    );

    const consumerRoot = join(temporaryRoot, "consumer");
    await mkdir(consumerRoot);
    const nextVersion = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ).peerDependencies.next;
    await writeFile(
      join(consumerRoot, "package.json"),
      `${JSON.stringify({
        name: "sync-provider-consumer",
        version: "1.0.0",
        private: true,
        type: "module",
        dependencies: {
          "@genii-foundation/publisher-sync-supabase":
            `file:${join(temporaryRoot, archive.filename)}`,
          next: nextVersion,
        },
      }, null, 2)}\n`,
      "utf8",
    );
    runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: consumerRoot,
      label: "install packed Supabase provider",
    });
    await writeFile(
      join(consumerRoot, "inspect.mjs"),
      [
        'import { PUBLISHER_SYNC_PROVIDER } from "@genii-foundation/publisher-sync-supabase";',
        'if (PUBLISHER_SYNC_PROVIDER.package !== "@genii-foundation/publisher-sync-supabase") throw new Error("provider drift");',
        'const server = import.meta.resolve("@genii-foundation/publisher-sync-supabase/server");',
        'if (!server.endsWith("/server-entry.mjs")) throw new Error(`server export drift: ${server}`);',
        'console.log(JSON.stringify({ capabilities: PUBLISHER_SYNC_PROVIDER.capabilities, server }));',
        "",
      ].join("\n"),
      "utf8",
    );
    const inspected = spawnSync(process.execPath, ["inspect.mjs"], {
      cwd: consumerRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.equal(inspected.status, 0, inspected.stderr);
    const receipt = JSON.parse(inspected.stdout);
    assert.deepEqual(receipt.capabilities, [
      "account-deletion",
      "bookmarks",
      "engagement",
      "progress",
    ]);
    assert.match(receipt.server, /server-entry\.mjs$/u);

    const installedManifest = JSON.parse(
      await readFile(
        join(
          consumerRoot,
          "node_modules",
          "@genii-foundation",
          "publisher-sync-supabase",
          "package.json",
        ),
        "utf8",
      ),
    );
    assert.equal(installedManifest.private, undefined);
    assert.equal(installedManifest.publishConfig.access, "public");
  } finally {
    await removeOwnedTemporaryRoot(temporaryRoot);
  }
});
