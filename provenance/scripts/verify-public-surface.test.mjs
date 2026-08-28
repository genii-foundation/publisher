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
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
} from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  publisherPublicLandingUrl,
  publisherPublicSchemaSources,
  verifyPublisherPublicSurface,
  verifyPublisherPublicSurfaceCli,
} from "./verify-public-surface.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const landingHtml = `<!doctype html>
<html lang="en">
  <head><title>GENII Publisher</title></head>
  <body>
    <h1>GENII Publisher</h1>
    <p>GENII Foundation</p>
    <p>Published with GENII Publisher</p>
    <a href="https://github.com/genii-foundation/publisher">Source</a>
  </body>
</html>
`;

async function createRepositoryFixture() {
  const root = await mkdtemp(join(tmpdir(), "publisher-public-surface-"));
  const canonicalRoot = await realpath(root);
  execFileSync("git", ["init", "--quiet", canonicalRoot]);
  for (const authority of publisherPublicSchemaSources) {
    const destination = join(canonicalRoot, authority.sourcePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(
      join(repositoryRoot, authority.sourcePath),
      destination,
    );
  }
  return canonicalRoot;
}

function publicResponse(bytes, contentType) {
  return new Response(bytes, {
    headers: {
      "content-length": String(Buffer.byteLength(bytes)),
      "content-type": contentType,
    },
    status: 200,
  });
}

async function createPublicResponses(root) {
  const responses = new Map([
    [
      publisherPublicLandingUrl,
      () => publicResponse(landingHtml, "text/html; charset=utf-8"),
    ],
  ]);
  for (const authority of publisherPublicSchemaSources) {
    const bytes = await readFile(join(root, authority.sourcePath));
    responses.set(
      authority.url,
      () => publicResponse(bytes, "application/schema+json"),
    );
  }
  return responses;
}

function fetchFromResponses(responses, calls = []) {
  return async (url, options) => {
    calls.push({ options, url });
    const createResponse = responses.get(url);
    if (createResponse === undefined) {
      throw new Error(`Unexpected public URL ${url}`);
    }
    return createResponse();
  };
}

test("the public surface verifier binds the landing page and every exact schema", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  const responses = await createPublicResponses(root);
  const calls = [];
  const first = await verifyPublisherPublicSurface({
    fetchImpl: fetchFromResponses(responses, calls),
    repositoryRoot: root,
  });
  const second = await verifyPublisherPublicSurface({
    fetchImpl: fetchFromResponses(responses),
    repositoryRoot: root,
  });

  assert.deepEqual(first, second);
  assert.equal(first.format, "publisher-public-surface-1");
  assert.equal(first.schemas.length, publisherPublicSchemaSources.length);
  assert.match(first.sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    calls.length,
    publisherPublicSchemaSources.length + 1,
  );
  for (const call of calls) {
    assert.equal(call.options.redirect, "manual");
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test("the public surface verifier fails closed on local schema authority drift", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  const responses = await createPublicResponses(root);
  const first = publisherPublicSchemaSources[0];
  const parsed = JSON.parse(
    await readFile(join(root, first.sourcePath), "utf8"),
  );
  parsed.$id = publisherPublicSchemaSources[1].url;
  await writeFile(
    join(root, first.sourcePath),
    `${JSON.stringify(parsed)}\n`,
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /invalid or duplicate \$id/u,
  );
});

test("the public surface verifier fails when the reviewed schema census changes", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  await writeFile(
    join(root, "schemas", "unreviewed.schema.json"),
    '{"$id":"https://publisher.genii.foundation/schemas/unreviewed.schema.json"}\n',
  );
  const responses = await createPublicResponses(root);
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /source census does not match/u,
  );
});

test("the public surface verifier rejects invalid UTF-8 authorities", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  const responses = await createPublicResponses(root);
  await writeFile(
    join(root, publisherPublicSchemaSources[0].sourcePath),
    Buffer.from([0xff]),
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /valid UTF-8 JSON/u,
  );

  await copyFile(
    join(repositoryRoot, publisherPublicSchemaSources[0].sourcePath),
    join(root, publisherPublicSchemaSources[0].sourcePath),
  );
  responses.set(
    publisherPublicLandingUrl,
    () => publicResponse(
      Buffer.concat([Buffer.from(landingHtml), Buffer.from([0xff])]),
      "text/html",
    ),
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /must contain valid UTF-8/u,
  );
});

test("the public surface verifier rejects changed remote schema bytes", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  const responses = await createPublicResponses(root);
  const authority = publisherPublicSchemaSources[0];
  responses.set(
    authority.url,
    () => publicResponse('{"changed":true}\n', "application/schema+json"),
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /does not match/u,
  );

  const exactBytes = await readFile(join(root, authority.sourcePath));
  responses.set(
    authority.url,
    () => publicResponse(exactBytes, "text/plain"),
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /must be served as JSON Schema data/u,
  );
});

test("the public surface verifier requires the complete attributed landing page", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  const responses = await createPublicResponses(root);
  responses.set(
    publisherPublicLandingUrl,
    () => publicResponse("<h1>GENII Publisher</h1>", "text/html"),
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /missing required marker/u,
  );

  responses.set(
    publisherPublicLandingUrl,
    () => publicResponse(landingHtml, "application/json"),
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /must be served as text\/html/u,
  );
});

test("the public surface verifier rejects redirects and response URL substitution", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  const responses = await createPublicResponses(root);
  responses.set(
    publisherPublicLandingUrl,
    () => new Response(null, {
      headers: { location: "https://example.com/" },
      status: 302,
    }),
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /direct HTTP 200/u,
  );

  const substituted = publicResponse(landingHtml, "text/html");
  Object.defineProperty(substituted, "url", {
    value: "https://example.com/",
  });
  responses.set(publisherPublicLandingUrl, () => substituted);
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /direct HTTP 200/u,
  );
});

test("the public surface verifier bounds declared and streamed response bytes", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  const responses = await createPublicResponses(root);
  responses.set(
    publisherPublicLandingUrl,
    () => new Response(landingHtml, {
      headers: {
        "content-length": String(256 * 1024 + 1),
        "content-type": "text/html",
      },
    }),
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /exceeds its byte limit/u,
  );

  responses.set(
    publisherPublicLandingUrl,
    () => new Response(Buffer.alloc(256 * 1024 + 1, 97), {
      headers: { "content-type": "text/html" },
    }),
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /exceeds its byte limit/u,
  );

  responses.set(
    publisherPublicLandingUrl,
    () => new Response(landingHtml, {
      headers: {
        "content-length": "1",
        "content-type": "text/html",
      },
    }),
  );
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: fetchFromResponses(responses),
      repositoryRoot: root,
    }),
    /does not match its Content-Length/u,
  );
});

test("the public surface verifier bounds an uncooperative request", async (t) => {
  const root = await createRepositoryFixture();
  t.after(async () => rm(root, { force: true, recursive: true }));
  await assert.rejects(
    verifyPublisherPublicSurface({
      fetchImpl: () => new Promise(() => {}),
      repositoryRoot: root,
      requestTimeoutMilliseconds: 5,
    }),
    /exceeded its request deadline/u,
  );
});

test("the public surface CLI rejects arguments before network access", async () => {
  await assert.rejects(
    verifyPublisherPublicSurfaceCli(["--surprise"]),
    /accepts no command-line arguments/u,
  );
});
