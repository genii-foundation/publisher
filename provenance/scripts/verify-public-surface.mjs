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

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import {
  isAbsolute,
  join,
  resolve,
} from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

export const publisherPublicLandingUrl =
  "https://publisher.genii.foundation/";
export const publisherPublicLandingSourcePath = "site/index.html";

export const publisherPublicSchemaSources = Object.freeze([
  ["schemas/audio-catalog.schema.json", "audio-catalog.schema.json"],
  ["schemas/audio-checkpoint.schema.json", "audio-checkpoint.schema.json"],
  ["schemas/audio-envelope.schema.json", "audio-envelope.schema.json"],
  ["schemas/collection.schema.json", "collection.schema.json"],
  ["schemas/content-envelope.schema.json", "content-envelope.schema.json"],
  ["schemas/publication.schema.json", "publication.schema.json"],
  ["schemas/reader-envelope.schema.json", "reader-envelope.schema.json"],
  ["schemas/sync-envelope.schema.json", "sync-envelope.schema.json"],
  ["schemas/updates-catalog.schema.json", "updates-catalog.schema.json"],
  ["schemas/updates-envelope.schema.json", "updates-envelope.schema.json"],
  ["schemas/work.schema.json", "work.schema.json"],
  [
    "packages/next/application-manifest.schema.json",
    "next-application-manifest.schema.json",
  ],
  [
    "provenance/record.schema.json",
    "provenance-record-1.2.0.schema.json",
  ],
  [
    "provenance/receipt.schema.json",
    "provenance-receipt-1.2.0.schema.json",
  ],
].map(([sourcePath, publicName]) => Object.freeze({
  sourcePath,
  url: `${publisherPublicLandingUrl}schemas/${publicName}`,
})));

const defaultRepositoryRoot = realpathSync(fileURLToPath(
  new URL("../../", import.meta.url),
));
const maximumLandingBytes = 256 * 1024;
const maximumSchemaBytes = 256 * 1024;
const maximumTotalBytes = 2 * 1024 * 1024;
const defaultRequestTimeoutMilliseconds = 10_000;
const allowedSchemaMediaTypes = new Set([
  "application/json",
  "application/schema+json",
]);
const landingMarkers = Object.freeze([
  "GENII Publisher",
  "GENII Foundation",
  "Published with GENII Publisher",
  "https://github.com/genii-foundation/publisher",
]);
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

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
  throw new TypeError("The public surface receipt must contain JSON data only.");
}

function assertRepositoryRoot(repositoryRoot) {
  if (
    typeof repositoryRoot !== "string" ||
    !isAbsolute(repositoryRoot) ||
    resolve(repositoryRoot) !== repositoryRoot
  ) {
    throw new Error("The repository root must be one canonical absolute path.");
  }
  const stat = lstatSync(repositoryRoot);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    realpathSync(repositoryRoot) !== repositoryRoot
  ) {
    throw new Error("The repository root must be one real directory.");
  }
}

function readBoundedSourceFile({
  maximumBytes,
  repositoryRoot,
  sourcePath,
}) {
  const absolutePath = join(repositoryRoot, sourcePath);
  const stat = lstatSync(absolutePath);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size < 1 ||
    stat.size > maximumBytes ||
    realpathSync(absolutePath) !== absolutePath
  ) {
    throw new Error(
      `Public surface source ${sourcePath} must be one bounded regular file without links.`,
    );
  }
  return readFileSync(absolutePath);
}

export function readPublisherPublicSurfaceAuthority({
  repositoryRoot = defaultRepositoryRoot,
} = {}) {
  assertRepositoryRoot(repositoryRoot);
  let schemaCensus;
  try {
    schemaCensus = execFileSync(
      "git",
      [
        "-C",
        repositoryRoot,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        "*.schema.json",
      ],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    throw new Error("The public schema source census could not be read from Git.");
  }
  const actualSourcePaths = schemaCensus
    .split("\0")
    .filter((value) => value.length > 0)
    .sort();
  const expectedSourcePaths = publisherPublicSchemaSources
    .map((authority) => authority.sourcePath)
    .sort();
  if (
    actualSourcePaths.length !== expectedSourcePaths.length ||
    actualSourcePaths.some(
      (sourcePath, index) => sourcePath !== expectedSourcePaths[index],
    )
  ) {
    throw new Error(
      "The repository public schema source census does not match the reviewed authority list.",
    );
  }
  const seenUrls = new Set();
  const schemas = [];
  for (const authority of publisherPublicSchemaSources) {
    const bytes = readBoundedSourceFile({
      maximumBytes: maximumSchemaBytes,
      repositoryRoot,
      sourcePath: authority.sourcePath,
    });
    let parsed;
    try {
      parsed = JSON.parse(fatalUtf8Decoder.decode(bytes));
    } catch {
      throw new Error(
        `Public schema source ${authority.sourcePath} must contain valid UTF-8 JSON.`,
      );
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype ||
      parsed.$id !== authority.url ||
      seenUrls.has(parsed.$id)
    ) {
      throw new Error(
        `Public schema source ${authority.sourcePath} has an invalid or duplicate $id.`,
      );
    }
    seenUrls.add(parsed.$id);
    schemas.push(Object.freeze({
      bytes,
      sourcePath: authority.sourcePath,
      url: authority.url,
    }));
  }
  return Object.freeze({
    landingBytes: readBoundedSourceFile({
      maximumBytes: maximumLandingBytes,
      repositoryRoot,
      sourcePath: publisherPublicLandingSourcePath,
    }),
    schemas: Object.freeze(schemas),
  });
}

function mediaType(response) {
  const value = response.headers?.get?.("content-type");
  return typeof value === "string"
    ? value.split(";", 1)[0].trim().toLowerCase()
    : "";
}

function declaredLength(response, maximumBytes, url) {
  const value = response.headers?.get?.("content-length");
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Public response ${url} has an invalid Content-Length.`);
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > maximumBytes) {
    throw new Error(`Public response ${url} exceeds its byte limit.`);
  }
  return length;
}

async function readBoundedBody(response, maximumBytes, url) {
  const expectedLength = declaredLength(response, maximumBytes, url);
  if (response.body === null || typeof response.body?.getReader !== "function") {
    throw new Error(`Public response ${url} has no readable body.`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) {
        break;
      }
      if (!(item.value instanceof Uint8Array)) {
        throw new Error(`Public response ${url} returned an invalid body chunk.`);
      }
      bytes += item.value.byteLength;
      if (bytes > maximumBytes) {
        throw new Error(`Public response ${url} exceeds its byte limit.`);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (expectedLength !== undefined && expectedLength !== bytes) {
    throw new Error(`Public response ${url} does not match its Content-Length.`);
  }
  return Buffer.concat(chunks, bytes);
}

async function requestPublicBytes({
  fetchImpl,
  maximumBytes,
  timeoutMilliseconds,
  url,
}) {
  const controller = new AbortController();
  let timer;
  let timedOut = false;
  const operation = (async () => {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/schema+json, application/json, text/html;q=0.8",
      },
      redirect: "manual",
      signal: controller.signal,
    });
    if (
      response === null ||
      typeof response !== "object" ||
      response.status !== 200 ||
      response.redirected !== false ||
      (typeof response.url === "string" &&
        response.url.length > 0 &&
        response.url !== url)
    ) {
      throw new Error(`Public response ${url} must be one direct HTTP 200 response.`);
    }
    const bytes = await readBoundedBody(response, maximumBytes, url);
    return Object.freeze({
      bytes,
      mediaType: mediaType(response),
    });
  })();
  operation.catch(() => {});
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`Public response ${url} exceeded its request deadline.`));
    }, timeoutMilliseconds);
  });
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (timedOut) {
      throw new Error(`Public response ${url} exceeded its request deadline.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyPublisherPublicSurface({
  fetchImpl = globalThis.fetch,
  repositoryRoot = defaultRepositoryRoot,
  requestTimeoutMilliseconds = defaultRequestTimeoutMilliseconds,
} = {}) {
  assertRepositoryRoot(repositoryRoot);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Public surface verification requires a fetch implementation.");
  }
  if (
    !Number.isSafeInteger(requestTimeoutMilliseconds) ||
    requestTimeoutMilliseconds < 1 ||
    requestTimeoutMilliseconds > 60_000
  ) {
    throw new TypeError("The public request deadline must be between 1 and 60000 milliseconds.");
  }

  const authority = readPublisherPublicSurfaceAuthority({ repositoryRoot });
  const landing = await requestPublicBytes({
    fetchImpl,
    maximumBytes: maximumLandingBytes,
    timeoutMilliseconds: requestTimeoutMilliseconds,
    url: publisherPublicLandingUrl,
  });
  if (landing.mediaType !== "text/html") {
    throw new Error("The Publisher public landing page must be served as text/html.");
  }
  let landingText;
  try {
    landingText = fatalUtf8Decoder.decode(landing.bytes);
  } catch {
    throw new Error("The Publisher public landing page must contain valid UTF-8.");
  }
  for (const marker of landingMarkers) {
    if (!landingText.includes(marker)) {
      throw new Error(
        `The Publisher public landing page is missing required marker ${JSON.stringify(marker)}.`,
      );
    }
  }
  if (!landing.bytes.equals(authority.landingBytes)) {
    throw new Error(
      `The Publisher public landing page does not match ${publisherPublicLandingSourcePath}.`,
    );
  }

  let totalBytes = landing.bytes.length;
  const schemas = [];
  for (const schema of authority.schemas) {
    const publicResponse = await requestPublicBytes({
      fetchImpl,
      maximumBytes: maximumSchemaBytes,
      timeoutMilliseconds: requestTimeoutMilliseconds,
      url: schema.url,
    });
    if (!allowedSchemaMediaTypes.has(publicResponse.mediaType)) {
      throw new Error(
        `Public schema ${schema.url} must be served as JSON Schema data.`,
      );
    }
    if (!publicResponse.bytes.equals(schema.bytes)) {
      throw new Error(
        `Public schema ${schema.url} does not match ${schema.sourcePath}.`,
      );
    }
    totalBytes += publicResponse.bytes.length;
    if (totalBytes > maximumTotalBytes) {
      throw new Error("The Publisher public surface exceeds its total byte limit.");
    }
    schemas.push({
      bytes: publicResponse.bytes.length,
      sha256: sha256(publicResponse.bytes),
      sourcePath: schema.sourcePath,
      url: schema.url,
    });
  }

  const basis = {
    format: "publisher-public-surface-1",
    landing: {
      bytes: landing.bytes.length,
      sha256: sha256(landing.bytes),
      sourcePath: publisherPublicLandingSourcePath,
      url: publisherPublicLandingUrl,
    },
    schemas,
    totalBytes,
  };
  return Object.freeze({
    ...basis,
    sha256: sha256(canonicalJson(basis)),
  });
}

export async function verifyPublisherPublicSurfaceCli(
  argv = process.argv.slice(2),
) {
  if (argv.length !== 0) {
    throw new Error("Public surface verification accepts no command-line arguments.");
  }
  return verifyPublisherPublicSurface();
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const receipt = await verifyPublisherPublicSurfaceCli();
    console.log(
      `Verified the Publisher landing page and ${receipt.schemas.length} exact public schema(s).`,
    );
    console.log(`Public surface receipt: ${receipt.sha256}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
