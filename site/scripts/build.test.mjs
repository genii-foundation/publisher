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
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  publisherPublicLandingSourcePath,
  publisherPublicLandingUrl,
  publisherPublicSchemaSources,
  verifyPublisherPublicSurface,
} from "../../provenance/scripts/verify-public-surface.mjs";
import {
  buildPublisherPublicSite,
  buildPublisherPublicSiteCli,
  checkPublisherPublicSite,
} from "./build.mjs";
import { checkPublisherPublicSiteCli } from "./check.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

async function createRepositoryFixture() {
  const root = await mkdtemp(join(tmpdir(), "publisher-public-site-"));
  const canonicalRoot = await realpath(root);
  execFileSync("git", ["init", "--quiet", canonicalRoot]);
  await copyFile(
    join(repositoryRoot, ".gitignore"),
    join(canonicalRoot, ".gitignore"),
  );
  for (const sourcePath of [
    publisherPublicLandingSourcePath,
    ...publisherPublicSchemaSources.map((authority) => authority.sourcePath),
  ]) {
    const destination = join(canonicalRoot, sourcePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(repositoryRoot, sourcePath), destination);
  }
  return canonicalRoot;
}

function responseFromBuiltSite(outputDirectory, url) {
  const outputPath = url === publisherPublicLandingUrl
    ? "index.html"
    : `schemas/${new URL(url).pathname.split("/").at(-1)}`;
  return async () => {
    const bytes = await readFile(join(outputDirectory, outputPath));
    return new Response(bytes, {
      headers: {
        "content-length": String(bytes.length),
        "content-type": outputPath.endsWith(".html")
          ? "text/html; charset=utf-8"
          : "application/schema+json",
      },
      status: 200,
    });
  };
}

test("the public site build emits one deterministic exact deployment artifact", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));

  const first = buildPublisherPublicSite({ repositoryRoot: root });
  const firstManifest = await readFile(
    join(first.outputDirectory, "public-surface-manifest.json"),
    "utf8",
  );
  await writeFile(join(first.outputDirectory, "stale.txt"), "stale\n");
  const second = buildPublisherPublicSite({ repositoryRoot: root });
  const secondManifest = await readFile(
    join(second.outputDirectory, "public-surface-manifest.json"),
    "utf8",
  );
  const checked = checkPublisherPublicSite({ repositoryRoot: root });

  assert.deepEqual(first, second);
  assert.deepEqual(checked, second);
  assert.equal(first.format, "publisher-public-site-1");
  assert.equal(first.schemas.length, publisherPublicSchemaSources.length);
  assert.equal(firstManifest, secondManifest);
  await assert.rejects(
    readFile(join(second.outputDirectory, "stale.txt")),
    /ENOENT/u,
  );
  assert.deepEqual(
    await readFile(join(second.outputDirectory, "index.html")),
    await readFile(join(root, publisherPublicLandingSourcePath)),
  );

  const responses = new Map([
    [
      publisherPublicLandingUrl,
      responseFromBuiltSite(second.outputDirectory, publisherPublicLandingUrl),
    ],
  ]);
  for (const authority of publisherPublicSchemaSources) {
    responses.set(
      authority.url,
      responseFromBuiltSite(second.outputDirectory, authority.url),
    );
  }
  const verification = await verifyPublisherPublicSurface({
    fetchImpl: async (url) => responses.get(url)(),
    repositoryRoot: root,
  });
  assert.equal(verification.schemas.length, publisherPublicSchemaSources.length);
});

test("the public site check refuses output census and byte drift", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  const built = buildPublisherPublicSite({ repositoryRoot: root });
  const stalePath = join(built.outputDirectory, "stale.txt");
  await writeFile(stalePath, "stale\n");
  assert.throws(
    () => checkPublisherPublicSite({ repositoryRoot: root }),
    /unexpected file census/u,
  );

  await rm(stalePath);
  await writeFile(join(built.outputDirectory, "index.html"), "changed\n");
  assert.throws(
    () => checkPublisherPublicSite({ repositoryRoot: root }),
    /does not match its reviewed source bytes/u,
  );

  buildPublisherPublicSite({ repositoryRoot: root });
  const firstSchema = publisherPublicSchemaSources[0];
  const schemaOutput = join(
    built.outputDirectory,
    "schemas",
    new URL(firstSchema.url).pathname.split("/").at(-1),
  );
  await rm(schemaOutput);
  assert.throws(
    () => checkPublisherPublicSite({ repositoryRoot: root }),
    /unexpected file census/u,
  );

  buildPublisherPublicSite({ repositoryRoot: root });
  await writeFile(
    join(built.outputDirectory, "public-surface-manifest.json"),
    "{}\n",
  );
  assert.throws(
    () => checkPublisherPublicSite({ repositoryRoot: root }),
    /does not match its reviewed source bytes/u,
  );
});

test("the public site check refuses linked deployment files", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  const built = buildPublisherPublicSite({ repositoryRoot: root });
  const landingOutput = join(built.outputDirectory, "index.html");
  await rm(landingOutput);
  await symlink(
    join(root, publisherPublicLandingSourcePath),
    landingOutput,
  );

  assert.throws(
    () => checkPublisherPublicSite({ repositoryRoot: root }),
    /does not match its reviewed source bytes/u,
  );
});

test("the public site build refuses a linked output boundary", async (t) => {
  const root = await createRepositoryFixture();
  const outside = await mkdtemp(join(tmpdir(), "publisher-public-site-outside-"));
  t.after(async () => rm(root, { force: true, recursive: true }));
  t.after(async () => rm(outside, { force: true, recursive: true }));
  await symlink(outside, join(root, "dist"));

  assert.throws(
    () => buildPublisherPublicSite({ repositoryRoot: root }),
    /output parent must be one real directory/u,
  );
  assert.deepEqual(await readFile(join(root, publisherPublicLandingSourcePath)),
    await readFile(join(repositoryRoot, publisherPublicLandingSourcePath)));
});

test("the public site build CLI rejects arguments before writing", () => {
  assert.throws(
    () => buildPublisherPublicSiteCli(["--output", "somewhere"]),
    /accepts no command-line arguments/u,
  );
  assert.throws(
    () => checkPublisherPublicSiteCli(["--output", "somewhere"]),
    /check accepts no command-line arguments/u,
  );
});
