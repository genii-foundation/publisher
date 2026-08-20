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

"use client";

import type {
  ReaderOfflinePackage,
  ReaderOfflinePackageVersion,
} from "@genii-foundation/publisher-reader/offline";

export const PUBLISHER_READER_OFFLINE_METADATA_CACHE =
  "genii-publisher-offline-metadata-v1";
export const PUBLISHER_READER_OFFLINE_PACKAGE_CACHE_PREFIX =
  "genii-publisher-offline-package-v1-";
export const PUBLISHER_READER_OFFLINE_RECORD_PREFIX =
  "https://publisher.invalid/__offline-package__/";

export interface PublisherReaderOfflinePackageRecord {
  readonly schemaVersion: 1;
  readonly publicationId: string;
  readonly workId: string;
  readonly route: string;
  readonly version: ReaderOfflinePackageVersion;
  readonly cacheName: string;
  readonly resourceHrefs: readonly string[];
  readonly savedAt: string;
}

export interface PublisherReaderOfflinePackageStatus {
  readonly cachedCount: number;
  readonly totalCount: number;
  readonly complete: boolean;
  readonly updateAvailable: boolean;
}

export interface PublisherReaderOfflinePackageProgress
  extends PublisherReaderOfflinePackageStatus {
  readonly currentHref?: string;
}

function recordKey(publicationId: string, workId: string): string {
  return `${PUBLISHER_READER_OFFLINE_RECORD_PREFIX}${
    encodeURIComponent(publicationId)
  }/${encodeURIComponent(workId)}`;
}

function versionKey(version: ReaderOfflinePackageVersion): string {
  return JSON.stringify([
    version.readerBuildId,
    version.rendererBuildId,
    version.workContentHash,
    version.narrationCatalogHash,
  ]);
}

function isRecord(value: unknown): value is PublisherReaderOfflinePackageRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<PublisherReaderOfflinePackageRecord>;
  return record.schemaVersion === 1 &&
    typeof record.publicationId === "string" &&
    typeof record.workId === "string" &&
    typeof record.route === "string" &&
    record.version !== null &&
    typeof record.version === "object" &&
    typeof record.version.readerBuildId === "string" &&
    typeof record.version.rendererBuildId === "string" &&
    typeof record.version.workContentHash === "string" &&
    (record.version.narrationCatalogHash === null ||
      typeof record.version.narrationCatalogHash === "string") &&
    typeof record.cacheName === "string" &&
    record.cacheName.startsWith(PUBLISHER_READER_OFFLINE_PACKAGE_CACHE_PREFIX) &&
    Array.isArray(record.resourceHrefs) &&
    record.resourceHrefs.every((href) => typeof href === "string") &&
    typeof record.savedAt === "string";
}

async function readRecord(
  publicationId: string,
  workId: string,
): Promise<PublisherReaderOfflinePackageRecord | null> {
  try {
    const metadata = await caches.open(PUBLISHER_READER_OFFLINE_METADATA_CACHE);
    const response = await metadata.match(recordKey(publicationId, workId));
    const value: unknown = response === undefined ? null : await response.json();
    return isRecord(value) &&
      value.publicationId === publicationId &&
      value.workId === workId
      ? value
      : null;
  } catch {
    return null;
  }
}

async function writeRecord(
  record: PublisherReaderOfflinePackageRecord,
): Promise<void> {
  const metadata = await caches.open(PUBLISHER_READER_OFFLINE_METADATA_CACHE);
  await metadata.put(
    recordKey(record.publicationId, record.workId),
    new Response(JSON.stringify(record), {
      headers: { "content-type": "application/json" },
    }),
  );
}

async function cachedCount(
  cache: Cache,
  hrefs: readonly string[],
): Promise<number> {
  const matches = await Promise.all(
    hrefs.map((href) => cache.match(href).then(Boolean)),
  );
  return matches.filter(Boolean).length;
}

export async function inspectPublisherReaderOfflinePackage(
  publicationId: string,
  offlinePackage: ReaderOfflinePackage,
): Promise<PublisherReaderOfflinePackageStatus> {
  if (!("caches" in globalThis)) {
    return Object.freeze({
      cachedCount: 0,
      totalCount: offlinePackage.resourceCount,
      complete: false,
      updateAvailable: false,
    });
  }
  const record = await readRecord(publicationId, offlinePackage.workId);
  if (record === null) {
    return Object.freeze({
      cachedCount: 0,
      totalCount: offlinePackage.resourceCount,
      complete: false,
      updateAvailable: false,
    });
  }
  const cache = await caches.open(record.cacheName);
  const count = await cachedCount(cache, record.resourceHrefs);
  return Object.freeze({
    cachedCount: count,
    totalCount: record.resourceHrefs.length,
    complete: record.resourceHrefs.length > 0 &&
      count === record.resourceHrefs.length,
    updateAvailable: versionKey(record.version) !==
      versionKey(offlinePackage.version),
  });
}

function cleanName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 80);
}

function stagingCacheName(
  publicationId: string,
  offlinePackage: ReaderOfflinePackage,
): string {
  const nonce = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${PUBLISHER_READER_OFFLINE_PACKAGE_CACHE_PREFIX}${
    cleanName(publicationId)
  }-${cleanName(offlinePackage.workId)}-${cleanName(nonce)}`;
}

function localDependencyHref(value: string, base: string): string | null {
  try {
    const origin = window.location.origin;
    const url = new URL(value, new URL(base, origin).href);
    if (url.origin !== origin || url.hash !== "") return null;
    if (
      !url.pathname.startsWith("/_next/static/") &&
      !url.pathname.startsWith("/_next/image/") &&
      !url.pathname.startsWith("/assets/")
    ) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function srcsetHrefs(value: string): string[] {
  return value.split(",").map((candidate) =>
    candidate.trim().split(/\s+/u)[0] ?? "").filter(Boolean);
}

async function responseDependencies(
  response: Response,
  requestedHref: string,
): Promise<string[]> {
  const type = response.headers.get("content-type") ?? "";
  const output = new Set<string>();
  if (type.includes("text/html") && typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(
      await response.clone().text(),
      "text/html",
    );
    for (const element of document.querySelectorAll(
      "link[href], script[src], img[src], source[src], audio[src], video[src]",
    )) {
      const value = element.getAttribute("href") ?? element.getAttribute("src");
      if (value !== null) {
        const href = localDependencyHref(value, requestedHref);
        if (href !== null) output.add(href);
      }
    }
    for (const element of document.querySelectorAll("img[srcset], source[srcset]")) {
      const value = element.getAttribute("srcset");
      if (value === null) continue;
      for (const candidate of srcsetHrefs(value)) {
        const href = localDependencyHref(candidate, requestedHref);
        if (href !== null) output.add(href);
      }
    }
  } else if (type.includes("text/css")) {
    const css = await response.clone().text();
    for (const match of css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gu)) {
      const href = localDependencyHref(match[2] ?? "", requestedHref);
      if (href !== null) output.add(href);
    }
  }
  return [...output];
}

async function portableResponse(
  response: Response,
  requestedHref: string,
): Promise<Response> {
  const requested = new URL(requestedHref, window.location.origin);
  const final = new URL(response.url || requested.href, requested.href);
  if (final.origin !== requested.origin) {
    throw new Error(`Offline resource redirected outside its declared origin: ${requestedHref}`);
  }
  if (!response.redirected) return response.clone();
  return new Response(await response.clone().arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function installPublisherReaderOfflinePackage(
  publicationId: string,
  offlinePackage: ReaderOfflinePackage,
  onProgress: (progress: PublisherReaderOfflinePackageProgress) => void,
): Promise<PublisherReaderOfflinePackageStatus> {
  if (!("caches" in globalThis) || !("fetch" in globalThis)) {
    throw new Error("Offline downloads are not supported by this browser.");
  }
  const previous = await readRecord(publicationId, offlinePackage.workId);
  const cacheName = stagingCacheName(publicationId, offlinePackage);
  const cache = await caches.open(cacheName);
  const queue = offlinePackage.resources.map(({ href }) => href);
  const queued = new Set(queue);
  let activated = false;

  try {
    for (let index = 0; index < queue.length; index += 1) {
      const href = queue[index]!;
      const response = await fetch(href, {
        cache: "reload",
        credentials: "omit",
      });
      if (!response.ok) {
        throw new Error(`Unable to download ${href}: ${response.status}`);
      }
      await cache.put(href, await portableResponse(response, href));
      for (const dependency of await responseDependencies(response, href)) {
        if (queued.has(dependency)) continue;
        queued.add(dependency);
        queue.push(dependency);
      }
      onProgress(Object.freeze({
        cachedCount: index + 1,
        totalCount: queue.length,
        complete: false,
        updateAvailable: previous !== null,
        currentHref: href,
      }));
    }
    const verified = await cachedCount(cache, queue);
    if (verified !== queue.length) {
      throw new Error("The offline package could not be verified after download.");
    }
    await writeRecord(Object.freeze({
      schemaVersion: 1,
      publicationId,
      workId: offlinePackage.workId,
      route: offlinePackage.route,
      version: offlinePackage.version,
      cacheName,
      resourceHrefs: Object.freeze([...queue]),
      savedAt: new Date().toISOString(),
    }));
    activated = true;
    if (previous !== null && previous.cacheName !== cacheName) {
      await caches.delete(previous.cacheName).catch(() => false);
    }
  } catch (error) {
    if (!activated) await caches.delete(cacheName).catch(() => false);
    throw error;
  }
  const status = await inspectPublisherReaderOfflinePackage(
    publicationId,
    offlinePackage,
  );
  onProgress(status);
  return status;
}

export async function publisherReaderOfflineWorkIds(
  publicationId: string,
): Promise<readonly string[]> {
  if (!("caches" in globalThis)) return Object.freeze([]);
  try {
    const metadata = await caches.open(PUBLISHER_READER_OFFLINE_METADATA_CACHE);
    const keys = await metadata.keys();
    const records = await Promise.all(keys
      .filter((request) => request.url.startsWith(PUBLISHER_READER_OFFLINE_RECORD_PREFIX))
      .map(async (request) => {
        try {
          const response = await metadata.match(request);
          const value: unknown = response === undefined ? null : await response.json();
          return isRecord(value) && value.publicationId === publicationId
            ? value
            : null;
        } catch {
          return null;
        }
      }));
    return Object.freeze(records
      .filter((record): record is PublisherReaderOfflinePackageRecord =>
        record !== null)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
      .map(({ workId }) => workId));
  } catch {
    return Object.freeze([]);
  }
}

export async function matchPublisherReaderOfflineResponse(
  request: RequestInfo | URL,
): Promise<Response | undefined> {
  if (!("caches" in globalThis)) return undefined;
  try {
    const metadata = await caches.open(PUBLISHER_READER_OFFLINE_METADATA_CACHE);
    const keys = await metadata.keys();
    const records = await Promise.all(keys.map(async (key) => {
      const response = await metadata.match(key);
      const value: unknown = response === undefined ? null : await response.json();
      return isRecord(value) ? value : null;
    }));
    for (const record of records
      .filter((value): value is PublisherReaderOfflinePackageRecord => value !== null)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt))) {
      const response = await (await caches.open(record.cacheName)).match(request);
      if (response !== undefined) return response;
    }
  } catch {}
  return undefined;
}
