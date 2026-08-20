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
import test from "node:test";

import {
  createPublisherReaderStore,
} from "../packages/next/dist/client/reader-store.js";

const storageKey = "genii.publisher.reader.test.v1.portable-reader";

function emptyState() {
  return Object.freeze({ count: 0 });
}

function parseState(serialized) {
  if (typeof serialized !== "string") return emptyState();
  try {
    const value = JSON.parse(serialized);
    return Number.isSafeInteger(value?.count) && value.count >= 0
      ? Object.freeze({ count: value.count })
      : emptyState();
  } catch {
    return emptyState();
  }
}

function serializeState(value) {
  if (!Number.isSafeInteger(value.count) || value.count < 0) {
    throw new TypeError("The test state is invalid.");
  }
  return JSON.stringify({ count: value.count });
}

function createSharedTabs() {
  const storage = new Map();
  const tabs = [];

  function createTab({ failWrites = false } = {}) {
    const listeners = new Set();
    const tab = {
      writes: 0,
      publishes: 0,
      environment: {
        read(key) {
          return storage.get(key) ?? null;
        },
        write(key, serialized) {
          tab.writes += 1;
          if (failWrites) throw new Error("Storage unavailable.");
          storage.set(key, serialized);
          for (const candidate of tabs) {
            if (candidate === tab) continue;
            for (const listener of candidate.listeners) {
              listener({ storageKey: key, serialized });
            }
          }
        },
        publish(signal) {
          tab.publishes += 1;
          for (const listener of listeners) listener(signal);
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      listeners,
    };
    tabs.push(tab);
    return tab;
  }

  return { createTab, storage };
}

function createStore(environment) {
  return createPublisherReaderStore({
    storageKey,
    parse: parseState,
    serialize: serializeState,
    empty: emptyState,
    environment,
  });
}

test("atomic updates use one latest in-memory snapshot", () => {
  const { createTab } = createSharedTabs();
  const tab = createTab();
  const store = createStore(tab.environment);
  const serverSnapshot = store.getServerSnapshot();
  const sources = [];
  let renders = 0;
  const unsubscribeSnapshot = store.subscribe(() => {
    renders += 1;
  });
  const unsubscribeChanges = store.subscribeChanges((source) => {
    sources.push(source);
  });

  assert.strictEqual(store.getServerSnapshot(), serverSnapshot);
  assert.deepEqual(store.read(), { count: 0 });
  store.update((current) => Object.freeze({ count: current.count + 1 }));
  store.update((current) => Object.freeze({ count: current.count + 1 }));
  const beforeNoop = { renders, writes: tab.writes };
  store.update((current) => current);

  assert.deepEqual(store.getSnapshot(), { count: 2 });
  assert.deepEqual(sources, ["local", "local"]);
  assert.deepEqual(
    { renders, writes: tab.writes },
    beforeNoop,
    "an updater returning the same reference must do no work",
  );
  unsubscribeChanges();
  unsubscribeSnapshot();
  assert.equal(tab.listeners.size, 0);
});

test("independent stores in one tab converge through the same-tab signal", () => {
  const { createTab } = createSharedTabs();
  const tab = createTab();
  const first = createStore(tab.environment);
  const second = createStore(tab.environment);
  const secondSources = [];
  const unsubscribeFirst = first.subscribe(() => undefined);
  const unsubscribeSecond = second.subscribeChanges((source) => {
    secondSources.push(source);
  });

  first.write(Object.freeze({ count: 7 }));

  assert.deepEqual(first.getSnapshot(), { count: 7 });
  assert.deepEqual(second.getSnapshot(), { count: 7 });
  assert.deepEqual(secondSources, ["external"]);
  assert.equal(tab.writes, 1);
  assert.equal(tab.publishes, 1);
  unsubscribeFirst();
  unsubscribeSecond();
});

test("stores in separate tabs converge through the storage signal", () => {
  const { createTab } = createSharedTabs();
  const firstTab = createTab();
  const secondTab = createTab();
  const first = createStore(firstTab.environment);
  const second = createStore(secondTab.environment);
  const secondSources = [];
  const unsubscribeFirst = first.subscribe(() => undefined);
  const unsubscribeSecond = second.subscribeChanges((source) => {
    secondSources.push(source);
  });

  first.update((current) => Object.freeze({ count: current.count + 3 }));
  const beforeEquivalentSignal = [...secondSources];
  firstTab.environment.write(storageKey, JSON.stringify({ count: 3 }));

  assert.deepEqual(second.getSnapshot(), { count: 3 });
  assert.deepEqual(secondSources, beforeEquivalentSignal);
  assert.deepEqual(secondSources, ["external"]);
  assert.equal(firstTab.publishes, 1);
  assert.equal(secondTab.publishes, 0);
  unsubscribeFirst();
  unsubscribeSecond();
});

test("same-tab memory converges even when persistence is unavailable", () => {
  const { createTab, storage } = createSharedTabs();
  const tab = createTab({ failWrites: true });
  const first = createStore(tab.environment);
  const second = createStore(tab.environment);
  const unsubscribeFirst = first.subscribe(() => undefined);
  const unsubscribeSecond = second.subscribe(() => undefined);

  first.write(Object.freeze({ count: 11 }));

  assert.deepEqual(first.getSnapshot(), { count: 11 });
  assert.deepEqual(second.getSnapshot(), { count: 11 });
  assert.equal(storage.has(storageKey), false);
  unsubscribeFirst();
  unsubscribeSecond();
});

test("remote replacement notifies without being mislabeled as a local edit", () => {
  const { createTab } = createSharedTabs();
  const tab = createTab();
  const store = createStore(tab.environment);
  const sources = [];
  const unsubscribe = store.subscribeChanges((source) => {
    sources.push(source);
  });

  store.write(Object.freeze({ count: 5 }), "remote");
  const beforeEquivalentWrite = {
    publishes: tab.publishes,
    sources: [...sources],
    writes: tab.writes,
  };
  store.write(Object.freeze({ count: 5 }), "remote");

  assert.deepEqual(store.getSnapshot(), { count: 5 });
  assert.deepEqual(sources, ["remote"]);
  assert.deepEqual(
    {
      publishes: tab.publishes,
      sources,
      writes: tab.writes,
    },
    beforeEquivalentWrite,
    "a canonically equal replacement must not bounce across tabs",
  );
  unsubscribe();
});

test("serialization failure leaves the prior snapshot and storage untouched", () => {
  const { createTab, storage } = createSharedTabs();
  const tab = createTab();
  const store = createStore(tab.environment);
  store.write(Object.freeze({ count: 2 }));

  assert.throws(
    () => store.write(Object.freeze({ count: -1 })),
    /test state is invalid/u,
  );
  assert.deepEqual(store.getSnapshot(), { count: 2 });
  assert.equal(storage.get(storageKey), JSON.stringify({ count: 2 }));
});
