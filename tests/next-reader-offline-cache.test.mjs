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
import { afterEach, beforeEach, test } from "node:test";

import {
  PUBLISHER_READER_OFFLINE_METADATA_CACHE,
  PUBLISHER_READER_OFFLINE_RECORD_PREFIX,
  inspectPublisherReaderOfflinePackage,
  installPublisherReaderOfflinePackage,
  matchPublisherReaderOfflineResponse,
  publisherReaderOfflineWorkIds,
} from "../packages/next/dist/client/reader-offline-cache.js";

const publicationId = "field-notes";
const workId = "first-work";
const recordKey = `${PUBLISHER_READER_OFFLINE_RECORD_PREFIX}${publicationId}/${workId}`;
const oldCacheName = "genii-publisher-offline-package-v1-field-notes-first-work-old";
const digest = (value) => `sha256:${value.repeat(64)}`;
const offlinePackage = {
  workId,
  title: "First Work",
  route: "/works/first/",
  version: {
    readerBuildId: digest("1"),
    rendererBuildId: digest("2"),
    workContentHash: digest("3"),
    narrationCatalogHash: null,
  },
  sectionCount: 1,
  audioClipCount: 0,
  resourceCount: 2,
  declaredByteSize: 0,
  unknownByteSizeCount: 2,
  resources: [
    { href: "/works/first/", kind: "document" },
    { href: "/publication-reader-offline.json", kind: "data" },
  ],
};

function oldRecord() {
  return JSON.stringify({
    schemaVersion: 1,
    publicationId,
    workId,
    route: "/works/first/",
    version: {
      readerBuildId: digest("0"),
      rendererBuildId: digest("2"),
      workContentHash: digest("0"),
      narrationCatalogHash: null,
    },
    cacheName: oldCacheName,
    resourceHrefs: ["/old-document/"],
    savedAt: "2026-08-18T00:00:00.000Z",
  });
}

function installCaches(seed = {}) {
  const stores = new Map(Object.entries(seed).map(([name, entries]) => [
    name,
    new Map(Object.entries(entries)),
  ]));
  const keyFor = (key) => typeof key === "string"
    ? key
    : key instanceof URL
      ? key.href
      : key.url;
  const open = (name) => {
    const store = stores.get(name) ?? new Map();
    stores.set(name, store);
    return {
      match: (key) => {
        const body = store.get(keyFor(key));
        return Promise.resolve(body === undefined
          ? undefined
          : new Response(body, {
              headers: { "content-type": "application/json" },
            }));
      },
      put: async (key, response) => {
        store.set(keyFor(key), await response.text());
      },
      keys: () => Promise.resolve([...store.keys()].map((key) =>
        new Request(new URL(key, "https://publisher.test").href))),
    };
  };
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      open: (name) => Promise.resolve(open(name)),
      delete: (name) => Promise.resolve(stores.delete(name)),
    },
  });
  return stores;
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://publisher.test" } },
  });
});

afterEach(() => {
  delete globalThis.caches;
  delete globalThis.fetch;
  delete globalThis.window;
});

test("a failed replacement keeps the previous complete package active", async () => {
  const stores = installCaches({
    [PUBLISHER_READER_OFFLINE_METADATA_CACHE]: { [recordKey]: oldRecord() },
    [oldCacheName]: { "/old-document/": "old" },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: () => Promise.resolve(new Response("unavailable", { status: 503 })),
  });

  await assert.rejects(
    installPublisherReaderOfflinePackage(publicationId, offlinePackage, () => {}),
    /Unable to download/,
  );
  assert.equal(stores.get(oldCacheName).has("/old-document/"), true);
  assert.equal(
    stores.get(PUBLISHER_READER_OFFLINE_METADATA_CACHE).get(recordKey),
    oldRecord(),
  );
});

test("activation switches one pointer only after every resource verifies", async () => {
  const stores = installCaches({
    [PUBLISHER_READER_OFFLINE_METADATA_CACHE]: { [recordKey]: oldRecord() },
    [oldCacheName]: { "/old-document/": "old" },
  });
  const fetched = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (href) => {
      fetched.push(href);
      assert.equal(stores.get(oldCacheName).has("/old-document/"), true);
      return Promise.resolve(new Response(`bytes for ${href}`, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }));
    },
  });

  const progress = [];
  const status = await installPublisherReaderOfflinePackage(
    publicationId,
    offlinePackage,
    (value) => progress.push(value),
  );
  assert.deepEqual(fetched, [
    "/works/first/",
    "/publication-reader-offline.json",
  ]);
  assert.equal(status.complete, true);
  assert.equal(status.updateAvailable, false);
  assert.equal(stores.has(oldCacheName), false);
  const record = JSON.parse(
    stores.get(PUBLISHER_READER_OFFLINE_METADATA_CACHE).get(recordKey),
  );
  assert.notEqual(record.cacheName, oldCacheName);
  assert.deepEqual(record.resourceHrefs, fetched);
  assert.equal(progress.at(-1).complete, true);
  assert.deepEqual(await publisherReaderOfflineWorkIds(publicationId), [workId]);
  assert.equal(
    await (await matchPublisherReaderOfflineResponse("/works/first/")).text(),
    "bytes for /works/first/",
  );
  assert.deepEqual(
    await inspectPublisherReaderOfflinePackage(publicationId, offlinePackage),
    { cachedCount: 2, totalCount: 2, complete: true, updateAvailable: false },
  );
});
