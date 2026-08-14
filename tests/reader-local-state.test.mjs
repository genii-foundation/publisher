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
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createDefaultReaderPreferences,
  createReaderPreferencesStorageKey,
  parseReaderPreferences,
  serializeReaderPreferences,
  updateReaderPreferences,
} from "../packages/reader/dist/preferences.js";
import {
  MAXIMUM_READER_PROGRESS_ENTRIES,
  MAXIMUM_READER_PROGRESS_SERIALIZED_BYTES,
  calculateReaderAggregateProgress,
  createEmptyReaderProgressState,
  createReaderProgressStorageKey,
  mergeReaderProgressStates,
  parseReaderProgressState,
  recordReaderSectionProgress,
  resolveReaderSectionProgress,
  sanitizeReaderProgressState,
  serializeReaderProgressState,
} from "../packages/reader/dist/progress.js";

const publicationId = "field-notes";
const OLD_HASH = `sha256:${"1".repeat(64)}`;
const NEW_HASH = `sha256:${"2".repeat(64)}`;
const SECOND_HASH = `sha256:${"3".repeat(64)}`;

function section({
  id = "opening",
  continuityId = id,
  legacyIds = [],
  progressGroups = [[continuityId, ...legacyIds]],
  contentHash = OLD_HASH,
  wordCount = 100,
} = {}) {
  return {
    id,
    role: "section",
    title: id,
    parentId: null,
    childIds: [],
    depth: 0,
    order: 0,
    routes: {},
    activeRouteNames: [],
    readerAddress: null,
    domId: null,
    continuity: {
      id: continuityId,
      legacyIds,
      progressGroups,
      historicalSectionIds: [],
    },
    navigable: true,
    blocks: [],
    previousId: null,
    nextId: null,
    wordCount,
    readingMinutes: 1,
    contentHash,
  };
}

function context(now, sections) {
  return { publicationId, now, sections };
}

test("package manifest exposes both browser-safe state entry points", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../packages/reader/package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(manifest.exports["./preferences"], {
    types: "./dist/preferences.d.ts",
    import: "./dist/preferences.js",
  });
  assert.deepEqual(manifest.exports["./progress"], {
    types: "./dist/progress.d.ts",
    import: "./dist/progress.js",
  });
});

test("preferences are publication scoped, bounded, deterministic, and immutable", () => {
  const policy = {
    fontFamilyIds: ["serif", "source-serif", "atkinson"],
    defaultFontFamilyId: "source-serif",
  };
  assert.equal(
    createReaderPreferencesStorageKey(publicationId),
    "genii.publisher.reader.preferences.v1.field-notes",
  );
  assert.throws(() => createReaderPreferencesStorageKey("__proto__"));

  const defaults = createDefaultReaderPreferences(policy);
  assert.deepEqual(defaults, {
    schemaVersion: 1,
    fontScale: 100,
    fontFamilyId: "source-serif",
    colorScheme: "system",
    motion: "system",
    highlights: true,
    focus: "none",
  });
  assert.equal(Object.isFrozen(defaults), true);

  const updated = updateReaderPreferences(
    defaults,
    {
      fontScale: 125,
      fontFamilyId: "atkinson",
      colorScheme: "black",
      motion: "reduced",
      highlights: false,
      focus: "strong",
    },
    policy,
  );
  const serialized = serializeReaderPreferences(updated, policy);
  assert.equal(
    serialized,
    '{"schemaVersion":1,"fontScale":125,"fontFamilyId":"atkinson","colorScheme":"black","motion":"reduced","highlights":false,"focus":"strong"}',
  );
  assert.deepEqual(parseReaderPreferences(serialized, policy), updated);
  assert.equal(Object.isFrozen(updated), true);
});

test("preferences fail closed to defaults on malformed, hostile, or newer storage", () => {
  const defaults = createDefaultReaderPreferences();
  assert.deepEqual(parseReaderPreferences("{"), defaults);
  assert.deepEqual(
    parseReaderPreferences(
      JSON.stringify({
        schemaVersion: 2,
        fontScale: 125,
        colorScheme: "black",
      }),
    ),
    defaults,
  );
  assert.deepEqual(
    parseReaderPreferences(
      '{"schemaVersion":1,"fontScale":99,"fontFamilyId":"__proto__","colorScheme":"sepia","motion":"fast","highlights":"yes","focus":"total"}',
    ),
    defaults,
  );
});

test("progress follows reviewed continuity groups and detects a read revision", () => {
  const former = section({
    id: "old-opening",
    continuityId: "old-opening",
  });
  let state = createEmptyReaderProgressState(publicationId);
  state = recordReaderSectionProgress(state, former, {
    now: 1_000,
    opened: true,
    navigationSource: "direct",
    percent: 100,
    scrollPercent: 100,
    read: "manual",
  });
  assert.equal(resolveReaderSectionProgress(state, former).status, "read");

  const renamed = section({
    id: "opening",
    continuityId: "opening",
    legacyIds: ["old-opening"],
    progressGroups: [["opening", "old-opening"]],
    contentHash: NEW_HASH,
  });
  state = sanitizeReaderProgressState(state, context(2_000, [renamed]));
  assert.deepEqual(Object.keys(state.entries), ["opening"]);
  const revised = resolveReaderSectionProgress(state, renamed);
  assert.equal(revised.status, "updated");
  assert.equal(revised.revisionDetected, true);
  assert.equal(revised.progress.readContentHash, OLD_HASH);

  state = recordReaderSectionProgress(state, renamed, {
    now: 2_500,
    opened: true,
    navigationSource: "direct",
  });
  assert.equal(
    resolveReaderSectionProgress(state, renamed).status,
    "updated",
    "Opening a revised section must not infer that its new revision was read.",
  );

  state = recordReaderSectionProgress(state, renamed, {
    now: 3_000,
    read: "manual",
  });
  assert.equal(resolveReaderSectionProgress(state, renamed).status, "read");
  assert.equal(state.entries.opening.readCount, 2);
  assert.equal(state.entries.opening.readContentHash, NEW_HASH);
});

test("split and merge lineages use the least-complete reviewed progress group", () => {
  const combined = section({
    id: "combined",
    continuityId: "combined",
    legacyIds: ["former-a", "former-b"],
    progressGroups: [["combined"], ["former-a", "former-b"]],
    contentHash: NEW_HASH,
  });
  const raw = {
    schemaVersion: 1,
    publicationId,
    entries: {
      combined: {
        continuityIds: ["combined"],
        contentHash: NEW_HASH,
        percent: 100,
        scrollPercent: 100,
        readingTimeMs: 1_000,
        audioPositionMs: 0,
        firstOpenedAt: 1,
        lastOpenedAt: 1,
        openCount: 1,
        navigationSource: "direct",
        firstReadAt: null,
        lastReadAt: null,
        readCount: 0,
        readMethod: null,
        readContentHash: null,
        readContentHashes: [],
        updatedAt: 1,
      },
      "former-b": {
        continuityIds: ["former-b"],
        contentHash: OLD_HASH,
        percent: 30,
        scrollPercent: 40,
        readingTimeMs: 500,
        audioPositionMs: 0,
        firstOpenedAt: 2,
        lastOpenedAt: 2,
        openCount: 1,
        navigationSource: "direct",
        firstReadAt: null,
        lastReadAt: null,
        readCount: 0,
        readMethod: null,
        readContentHash: null,
        readContentHashes: [],
        updatedAt: 2,
      },
    },
  };
  const state = sanitizeReaderProgressState(raw, context(10, [combined]));
  assert.deepEqual(Object.keys(state.entries), ["combined", "former-a"]);
  const resolved = resolveReaderSectionProgress(state, combined);
  assert.equal(resolved.progress.percent, 30);
  assert.equal(resolved.status, "partial");
});

test("reading the current revision remains absorbing when a later old revision arrives", () => {
  const current = section({ contentHash: NEW_HASH });
  const old = section({ contentHash: OLD_HASH });
  let currentState = createEmptyReaderProgressState(publicationId);
  currentState = recordReaderSectionProgress(currentState, current, {
    now: 2_000,
    read: "manual",
  });
  let oldState = createEmptyReaderProgressState(publicationId);
  oldState = recordReaderSectionProgress(oldState, old, {
    now: 3_000,
    read: "manual",
  });
  const merged = mergeReaderProgressStates(
    currentState,
    oldState,
    context(3_000, [current]),
  );
  assert.deepEqual(merged.entries.opening.readContentHashes, [
    OLD_HASH,
    NEW_HASH,
  ]);
  assert.equal(resolveReaderSectionProgress(merged, current).status, "read");
});

test("out-of-order local events refuse to rewind a newer state", () => {
  const current = section();
  let state = createEmptyReaderProgressState(publicationId);
  state = recordReaderSectionProgress(state, current, {
    now: 2_000,
    percent: 50,
  });
  assert.throws(
    () => recordReaderSectionProgress(state, current, {
      now: 1_000,
      percent: 75,
    }),
    /must not precede/,
  );
  assert.equal(state.entries.opening.updatedAt, 2_000);
  assert.equal(state.entries.opening.percent, 50);
});

test("merges are monotonic, future-safe, and deterministic in either order", () => {
  const currentSection = section();
  let left = createEmptyReaderProgressState(publicationId);
  left = recordReaderSectionProgress(left, currentSection, {
    now: 1_000,
    opened: true,
    navigationSource: "search",
    percent: 20,
    scrollPercent: 40,
    readingTimeMs: 500,
    audioPositionMs: 90,
  });
  let right = createEmptyReaderProgressState(publicationId);
  right = recordReaderSectionProgress(right, currentSection, {
    now: 1_000,
    opened: true,
    navigationSource: "bookmark",
    percent: 30,
    scrollPercent: 10,
    readingTimeMs: 800,
    audioPositionMs: 120,
  });

  const mergedLeft = mergeReaderProgressStates(
    left,
    right,
    context(1_000, [currentSection]),
  );
  const mergedRight = mergeReaderProgressStates(
    right,
    left,
    context(1_000, [currentSection]),
  );
  assert.equal(
    serializeReaderProgressState(
      mergedLeft,
      context(1_000, [currentSection]),
    ),
    serializeReaderProgressState(
      mergedRight,
      context(1_000, [currentSection]),
    ),
  );
  assert.deepEqual(mergedLeft.entries.opening, {
    continuityIds: ["opening"],
    contentHash: OLD_HASH,
    percent: 30,
    scrollPercent: 40,
    readingTimeMs: 800,
    audioPositionMs: 120,
    firstOpenedAt: 1_000,
    lastOpenedAt: 1_000,
    openCount: 1,
    navigationSource: "bookmark",
    firstReadAt: null,
    lastReadAt: null,
    readCount: 0,
    readMethod: null,
    readContentHash: null,
    readContentHashes: [],
    updatedAt: 1_000,
  });

  const future = JSON.parse(
    serializeReaderProgressState(
      mergedLeft,
      context(1_000, [currentSection]),
    ),
  );
  future.entries.opening.firstOpenedAt = 9_999;
  future.entries.opening.lastOpenedAt = 9_999;
  future.entries.opening.updatedAt = 9_999;
  const clamped = sanitizeReaderProgressState(
    future,
    context(2_000, [currentSection]),
  );
  assert.equal(clamped.entries.opening.firstOpenedAt, 2_000);
  assert.equal(clamped.entries.opening.lastOpenedAt, 2_000);
  assert.equal(clamped.entries.opening.updatedAt, 2_000);
});

test("hostile keys, newer schemas, entry caps, and byte caps fail safely", () => {
  assert.equal(
    createReaderProgressStorageKey(publicationId),
    "genii.publisher.reader.progress.v1.field-notes",
  );
  assert.throws(() => createReaderProgressStorageKey("constructor"));
  assert.deepEqual(
    parseReaderProgressState("{", context(100)),
    createEmptyReaderProgressState(publicationId),
  );
  assert.deepEqual(
    parseReaderProgressState(
      JSON.stringify({
        schemaVersion: 2,
        publicationId,
        entries: {},
      }),
      context(100),
    ),
    createEmptyReaderProgressState(publicationId),
  );
  assert.deepEqual(
    parseReaderProgressState(
      "x".repeat(MAXIMUM_READER_PROGRESS_SERIALIZED_BYTES + 1),
      context(100),
    ),
    createEmptyReaderProgressState(publicationId),
  );

  const entries = Object.create(null);
  Object.defineProperty(entries, "__proto__", {
    enumerable: true,
    value: { contentHash: OLD_HASH },
  });
  for (let index = 0; index < MAXIMUM_READER_PROGRESS_ENTRIES + 20; index += 1) {
    entries[`entry-${String(index).padStart(4, "0")}`] = {
      contentHash: OLD_HASH,
      percent: index % 101,
      scrollPercent: 0,
      readingTimeMs: 0,
      audioPositionMs: 0,
      firstOpenedAt: null,
      lastOpenedAt: null,
      openCount: 0,
      navigationSource: null,
      firstReadAt: null,
      lastReadAt: null,
      readCount: 0,
      readMethod: null,
      readContentHash: null,
      updatedAt: index,
    };
  }
  const bounded = sanitizeReaderProgressState(
    { schemaVersion: 1, publicationId, entries },
    context(10_000),
  );
  assert.equal(Object.keys(bounded.entries).length, MAXIMUM_READER_PROGRESS_ENTRIES);
  assert.equal(Object.getPrototypeOf(bounded.entries), null);
  assert.equal(Object.hasOwn(bounded.entries, "__proto__"), false);
  assert.equal(Object.isFrozen(bounded), true);
  assert.equal(Object.isFrozen(bounded.entries), true);
  assert.equal(Object.isFrozen(Object.values(bounded.entries)[0]), true);
});

test("aggregate percent uses current word counts and exposes canonical statuses", () => {
  const first = section({ id: "first", wordCount: 100 });
  const second = section({
    id: "second",
    contentHash: SECOND_HASH,
    wordCount: 300,
  });
  let state = createEmptyReaderProgressState(publicationId);
  state = recordReaderSectionProgress(state, first, {
    now: 1,
    percent: 100,
    read: "automatic",
  });
  state = recordReaderSectionProgress(state, second, {
    now: 2,
    percent: 50,
  });
  const aggregate = calculateReaderAggregateProgress(state, [first, second]);
  assert.deepEqual(aggregate, {
    percent: 63,
    completedWordCount: 250,
    totalWordCount: 400,
    sectionCount: 2,
    statuses: { unread: 0, partial: 1, read: 1, updated: 0 },
  });
  assert.equal(Object.isFrozen(aggregate), true);
  assert.equal(Object.isFrozen(aggregate.statuses), true);
});

test("browser state modules do not reference ambient browser or server authority", async () => {
  const source = (
    await Promise.all(
      ["preferences.js", "progress.js"].map((name) =>
        readFile(
          new URL(`../packages/reader/dist/${name}`, import.meta.url),
          "utf8",
        ),
      ),
    )
  ).join("\n");
  for (const forbidden of [
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "fetch(",
    "process.",
    "Date.now",
    "Math.random",
    "node:",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
