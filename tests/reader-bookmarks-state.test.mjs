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
  MAXIMUM_LIVE_READER_BOOKMARKS,
  MAXIMUM_READER_BOOKMARKS_INPUT_BYTES,
  MAXIMUM_READER_BOOKMARKS_REMOTE_BYTES,
  MAXIMUM_READER_BOOKMARKS_SERIALIZED_BYTES,
  MAXIMUM_TOTAL_READER_BOOKMARKS,
  addReaderBookmark,
  countReaderBookmarks,
  createEmptyReaderBookmarksState,
  createReaderBookmarksExportFileName,
  createReaderBookmarksStorageKey,
  createReaderBookmarksTextExport,
  listLiveReaderBookmarks,
  mergeReaderBookmarksStates,
  parseReaderBookmarksState,
  pruneReaderBookmarksToRemoteBudget,
  queryReaderBookmarks,
  readerBookmarksByteSize,
  readerBookmarksFitRemoteBudget,
  removeReaderBookmark,
  resolveReaderBookmark,
  sanitizeReaderBookmarksState,
  serializeReaderBookmarksState,
  updateReaderBookmarkNote,
} from "../packages/reader/dist/bookmarks.js";
import {
  resolveReaderPassageRange,
  validateReaderPassageRange,
} from "../packages/reader/dist/passage-range.js";

const publicationId = "field-notes";
const workId = "observations";
const sectionContinuityId = "opening";
const HASH_A = `sha256:${"1".repeat(64)}`;
const HASH_B = `sha256:${"2".repeat(64)}`;
const HASH_C = `sha256:${"3".repeat(64)}`;

function context(now = 1_000) {
  return { publicationId, now };
}

function block(id, text, contentHash) {
  return {
    id,
    kind: "paragraph",
    markdown: text,
    text,
    readerAddress: null,
    domId: null,
    wordCount: text.split(/\s+/u).filter(Boolean).length,
    contentHash,
  };
}

function point(blockId, blockContentHash, offset, overrides = {}) {
  return {
    workId,
    sectionContinuityId,
    blockId,
    blockContentHash,
    offset,
    ...overrides,
  };
}

function range(
  startId = "first",
  startHash = HASH_A,
  startOffset = 0,
  endId = startId,
  endHash = startHash,
  endOffset = startOffset + 4,
) {
  return {
    start: point(startId, startHash, startOffset),
    end: point(endId, endHash, endOffset),
  };
}

function input(id = "mark-1", overrides = {}) {
  return {
    id,
    workId,
    sectionContinuityId,
    href: "/observations/opening/#first",
    quote: "beta",
    prefix: "alpha ",
    suffix: " gamma",
    range: range("first", HASH_A, 6, "first", HASH_A, 10),
    ...overrides,
  };
}

function rawBookmark(id, overrides = {}) {
  return {
    ...input(id),
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function rawState(bookmarks, overrides = {}) {
  return {
    schemaVersion: 1,
    publicationId,
    bookmarks,
    ...overrides,
  };
}

test("package manifest exposes browser-safe passage and bookmark entry points", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../packages/reader/package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(manifest.exports["./passage-range"], {
    types: "./dist/passage-range.d.ts",
    import: "./dist/passage-range.js",
  });
  assert.deepEqual(manifest.exports["./bookmarks"], {
    types: "./dist/bookmarks.d.ts",
    import: "./dist/bookmarks.js",
  });
});

test("readable export preserves live quotes, notes, and destinations as inert text", () => {
  let state = createEmptyReaderBookmarksState(publicationId);
  state = addReaderBookmark(
    state,
    input("first", {
      quote: "first line\nsecond line",
      note: "Return here.\nDestination: forged",
    }),
    context(100),
  );
  state = addReaderBookmark(
    state,
    input("gone", { quote: "removed text" }),
    context(101),
  );
  state = removeReaderBookmark(state, "gone", context(102));
  const exported = createReaderBookmarksTextExport(
    state,
    context(1_000),
    {
      publicationTitle: "Field Notes\nBookmarks: forged",
      origin: "https://reader.example",
    },
  );
  assert.equal(
    createReaderBookmarksExportFileName(publicationId),
    "field-notes-saved-passages.txt",
  );
  assert.match(exported, /Bookmarks: 1/u);
  assert.match(exported, /  Field Notes\n  Bookmarks: forged/u);
  assert.match(exported, /  https:\/\/reader\.example\/observations\/opening\/#first/u);
  assert.match(exported, /Selected text:\n  first line\n  second line/u);
  assert.match(exported, /Note:\n  Return here\.\n  Destination: forged/u);
  assert.doesNotMatch(exported, /removed text/u);
  assert.equal(exported.endsWith("\n"), true);
  assert.throws(() => createReaderBookmarksTextExport(
    state,
    context(1_000),
    { publicationTitle: "Field Notes", origin: "javascript:alert(1)" },
  ));
});

test("same-block and multi-block passage ranges resolve in current order", () => {
  const blocks = [
    block("first", "alpha beta gamma", HASH_A),
    block("second", "delta epsilon", HASH_B),
  ];
  const same = resolveReaderPassageRange(
    range("first", HASH_A, 6, "first", HASH_A, 10),
    blocks,
  );
  assert.equal(same.status, "exact");
  assert.equal(same.range.start.offset, 6);

  const spanning = resolveReaderPassageRange(
    range("first", HASH_A, 6, "second", HASH_B, 5),
    blocks,
  );
  assert.equal(spanning.status, "exact");
  assert.equal(spanning.range.end.blockId, "second");
  assert.equal(Object.isFrozen(spanning), true);
  assert.equal(Object.isFrozen(spanning.range), true);
  assert.equal(Object.isFrozen(spanning.range.start), true);

  assert.deepEqual(
    resolveReaderPassageRange(
      range("second", HASH_B, 1, "first", HASH_A, 2),
      blocks,
    ),
    { status: "invalid" },
  );
});

test("a unique content hash relocates a renamed block", () => {
  const resolved = resolveReaderPassageRange(
    range("former", HASH_A, 1, "former", HASH_A, 5),
    [block("current", "alpha beta gamma", HASH_A)],
  );
  assert.equal(resolved.status, "renamed-block");
  assert.equal(resolved.range.start.blockId, "current");
  assert.equal(resolved.range.end.offset, 5);
});

test("duplicate hashes remain ambiguous, and a changed exact ID remains unresolved", () => {
  assert.deepEqual(
    resolveReaderPassageRange(
      range("former", HASH_A, 0, "former", HASH_A, 2),
      [
        block("one", "same", HASH_A),
        block("two", "same", HASH_A),
      ],
    ),
    { status: "ambiguous" },
  );
  assert.deepEqual(
    resolveReaderPassageRange(
      range("first", HASH_A, 0, "first", HASH_A, 2),
      [
        block("first", "revised", HASH_B),
        block("moved", "old", HASH_A),
      ],
    ),
    { status: "missing" },
    "A reused ID with a new hash must not relocate behind the caller's back.",
  );
});

test("passage validation accepts exact plain data only", () => {
  const valid = validateReaderPassageRange(range());
  assert.equal(valid.valid, true);
  assert.equal(Object.isFrozen(valid.value), true);
  assert.equal(
    validateReaderPassageRange({ ...range(), surprise: true }).valid,
    false,
  );
  assert.equal(
    validateReaderPassageRange({
      start: point("first", HASH_A, 4),
      end: point("first", HASH_A, 2),
    }).valid,
    false,
  );
  assert.equal(
    validateReaderPassageRange({
      start: point("first", HASH_A, 0),
      end: point("first", HASH_B, 1),
    }).valid,
    false,
  );
  assert.equal(
    validateReaderPassageRange({
      start: point("first", HASH_A, 0),
      end: point("first", HASH_A, 1, { workId: "elsewhere" }),
    }).valid,
    false,
  );
  assert.deepEqual(
    resolveReaderPassageRange(range("first", HASH_A, 1, "first", HASH_A, 2), [
      block("first", "😀", HASH_A),
    ]),
    { status: "missing" },
    "An offset between a surrogate pair is not a valid selection boundary.",
  );
});

test("add, note, list, query, count, and remove form an immutable local flow", () => {
  let state = createEmptyReaderBookmarksState(publicationId);
  assert.equal(
    createReaderBookmarksStorageKey(publicationId),
    "genii.publisher.reader.bookmarks.v1.field-notes",
  );
  assert.throws(() => createReaderBookmarksStorageKey("__proto__"));

  state = addReaderBookmark(state, input(), context(100));
  assert.deepEqual(countReaderBookmarks(state), {
    live: 1,
    tombstones: 0,
    total: 1,
  });
  assert.throws(() => addReaderBookmark(state, input(), context(101)));
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.bookmarks), true);
  assert.equal(Object.getPrototypeOf(state.bookmarks), null);
  assert.equal(Object.isFrozen(state.bookmarks["mark-1"]), true);
  assert.equal(Object.isFrozen(state.bookmarks["mark-1"].range), true);

  state = updateReaderBookmarkNote(
    state,
    "mark-1",
    "Check the tide table.",
    context(200),
  );
  assert.equal(state.bookmarks["mark-1"].note, "Check the tide table.");
  assert.equal(listLiveReaderBookmarks(state).length, 1);
  assert.equal(queryReaderBookmarks(state, { text: "TIDE" }).length, 1);
  assert.equal(
    queryReaderBookmarks(state, { sectionContinuityId: "other" }).length,
    0,
  );

  state = updateReaderBookmarkNote(state, "mark-1", null, context(300));
  assert.equal(state.bookmarks["mark-1"].note, undefined);
  state = removeReaderBookmark(state, "mark-1", context(400));
  assert.deepEqual(countReaderBookmarks(state), {
    live: 0,
    tombstones: 1,
    total: 1,
  });
  assert.equal(state.bookmarks["mark-1"].deletedAt, 400);
  assert.throws(() => addReaderBookmark(state, input(), context(500)));
  assert.throws(() =>
    updateReaderBookmarkNote(state, "mark-1", "resurrect", context(500))
  );
});

test("quote and context reanchor revised content without choosing an ambiguity", () => {
  const state = addReaderBookmark(
    createEmptyReaderBookmarksState(publicationId),
    input(),
    context(100),
  );
  const bookmark = state.bookmarks["mark-1"];
  const reanchored = resolveReaderBookmark(bookmark, [
    block("first", "new alpha beta gamma ending", HASH_B),
  ]);
  assert.equal(reanchored.status, "reanchored");
  assert.equal(reanchored.range.start.offset, 10);
  assert.equal(reanchored.range.end.offset, 14);
  assert.equal(reanchored.range.start.blockContentHash, HASH_B);

  const ambiguousBookmark = addReaderBookmark(
    createEmptyReaderBookmarksState(publicationId),
    input("ambiguous", { prefix: "", suffix: "" }),
    context(100),
  ).bookmarks.ambiguous;
  assert.deepEqual(
    resolveReaderBookmark(ambiguousBookmark, [
      block("first", "beta and beta", HASH_B),
    ]),
    { status: "ambiguous" },
  );

  const overlappingBookmark = addReaderBookmark(
    createEmptyReaderBookmarksState(publicationId),
    input("overlapping", {
      quote: "aaa",
      prefix: "",
      suffix: "",
    }),
    context(100),
  ).bookmarks.overlapping;
  assert.deepEqual(
    resolveReaderBookmark(overlappingBookmark, [
      block("first", "aaaa", HASH_B),
    ]),
    { status: "ambiguous" },
    "Overlapping quote occurrences are still distinct candidates.",
  );
});

test("quote reanchoring can span adjacent blocks", () => {
  const bookmark = addReaderBookmark(
    createEmptyReaderBookmarksState(publicationId),
    input("spanning", {
      quote: "tail\nhead",
      prefix: "",
      suffix: "",
    }),
    context(100),
  ).bookmarks.spanning;
  const resolved = resolveReaderBookmark(bookmark, [
    block("first", "lead tail", HASH_B),
    block("second", "head close", HASH_C),
  ]);
  assert.equal(resolved.status, "reanchored");
  assert.equal(resolved.range.start.blockId, "first");
  assert.equal(resolved.range.start.offset, 5);
  assert.equal(resolved.range.end.blockId, "second");
  assert.equal(resolved.range.end.offset, 4);
});

test("bookmark resolution preserves exact and unique renamed ranges", () => {
  const bookmark = addReaderBookmark(
    createEmptyReaderBookmarksState(publicationId),
    input(),
    context(100),
  ).bookmarks["mark-1"];
  assert.equal(
    resolveReaderBookmark(bookmark, [
      block("first", "alpha beta gamma", HASH_A),
    ]).status,
    "exact",
  );
  assert.equal(
    resolveReaderBookmark(bookmark, [
      block("renamed", "alpha beta gamma", HASH_A),
    ]).status,
    "renamed",
  );
});

test("newer schemas, publication mismatches, malformed data, and hostile keys fail closed", () => {
  const empty = createEmptyReaderBookmarksState(publicationId);
  assert.deepEqual(parseReaderBookmarksState("{", context()), empty);
  assert.deepEqual(
    sanitizeReaderBookmarksState(
      rawState({}, { schemaVersion: 2 }),
      context(),
    ),
    empty,
  );
  assert.deepEqual(
    sanitizeReaderBookmarksState(
      rawState({ "mark-1": rawBookmark("mark-1") }, {
        publicationId: "another-publication",
      }),
      context(),
    ),
    empty,
  );
  assert.deepEqual(
    sanitizeReaderBookmarksState(
      { ...rawState({}), unexpected: true },
      context(),
    ),
    empty,
  );
  assert.deepEqual(
    sanitizeReaderBookmarksState(
      rawState({
        "undefined-note": rawBookmark("undefined-note", { note: undefined }),
      }),
      context(),
    ),
    empty,
    "An explicitly undefined optional field is not plain JSON data.",
  );

  const bookmarks = Object.create(null);
  Object.defineProperty(bookmarks, "__proto__", {
    enumerable: true,
    value: rawBookmark("__proto__"),
  });
  bookmarks.constructor = rawBookmark("constructor");
  bookmarks["safe-mark"] = rawBookmark("safe-mark");
  const sanitized = sanitizeReaderBookmarksState(
    rawState(bookmarks),
    context(),
  );
  assert.deepEqual(Object.keys(sanitized.bookmarks), ["safe-mark"]);
  assert.equal(Object.getPrototypeOf(sanitized.bookmarks), null);
  assert.equal(Object.hasOwn(sanitized.bookmarks, "__proto__"), false);
});

test("future timestamps clamp to explicit now", () => {
  const state = sanitizeReaderBookmarksState(
    rawState({
      future: rawBookmark("future", {
        createdAt: 9_999,
        updatedAt: 9_999,
        deletedAt: 9_999,
      }),
    }),
    context(500),
  );
  assert.equal(state.bookmarks.future.createdAt, 500);
  assert.equal(state.bookmarks.future.updatedAt, 500);
  assert.equal(state.bookmarks.future.deletedAt, 500);
});

test("tombstones absorb later and clock-skewed live updates", () => {
  let deleted = addReaderBookmark(
    createEmptyReaderBookmarksState(publicationId),
    input(),
    context(100),
  );
  deleted = removeReaderBookmark(deleted, "mark-1", context(200));
  const laterLive = sanitizeReaderBookmarksState(
    rawState({
      "mark-1": rawBookmark("mark-1", {
        createdAt: 100,
        updatedAt: 9_000,
        note: "A later write must still lose.",
      }),
    }),
    context(10_000),
  );
  const merged = mergeReaderBookmarksStates(
    deleted,
    laterLive,
    context(10_000),
  );
  assert.equal(merged.bookmarks["mark-1"].deletedAt, 200);
  assert.equal(countReaderBookmarks(merged).live, 0);
  const repeated = mergeReaderBookmarksStates(
    laterLive,
    merged,
    context(10_000),
  );
  assert.equal(repeated.bookmarks["mark-1"].deletedAt, 200);
});

test("merge is commutative, idempotent, and stable at equal timestamps", () => {
  const left = sanitizeReaderBookmarksState(
    rawState({
      shared: rawBookmark("shared", { note: "zeta" }),
      left: rawBookmark("left"),
    }),
    context(500),
  );
  const right = sanitizeReaderBookmarksState(
    rawState({
      shared: rawBookmark("shared", { note: "alpha" }),
      right: rawBookmark("right"),
    }),
    context(500),
  );
  const leftFirst = mergeReaderBookmarksStates(left, right, context(500));
  const rightFirst = mergeReaderBookmarksStates(right, left, context(500));
  const leftText = serializeReaderBookmarksState(leftFirst, context(500));
  assert.equal(
    leftText,
    serializeReaderBookmarksState(rightFirst, context(500)),
  );
  assert.equal(
    leftText,
    serializeReaderBookmarksState(
      mergeReaderBookmarksStates(leftFirst, leftFirst, context(500)),
      context(500),
    ),
  );
  assert.equal(leftFirst.bookmarks.shared.note, "alpha");
});

test("serialization is canonical regardless of source property order", () => {
  const forward = sanitizeReaderBookmarksState(
    rawState({
      zebra: rawBookmark("zebra"),
      alpha: rawBookmark("alpha"),
    }),
    context(),
  );
  const reverse = sanitizeReaderBookmarksState(
    rawState({
      alpha: rawBookmark("alpha"),
      zebra: rawBookmark("zebra"),
    }),
    context(),
  );
  const serialized = serializeReaderBookmarksState(forward, context());
  assert.equal(serialized, serializeReaderBookmarksState(reverse, context()));
  assert.ok(serialized.indexOf('"alpha"') < serialized.indexOf('"zebra"'));
  assert.deepEqual(parseReaderBookmarksState(serialized, context()), forward);
});

test("count and byte caps prune deterministically", () => {
  const many = Object.create(null);
  for (let index = 0; index < MAXIMUM_TOTAL_READER_BOOKMARKS + 100; index += 1) {
    const id = `mark-${String(index).padStart(4, "0")}`;
    many[id] = rawBookmark(id, {
      deletedAt: index + 1,
      updatedAt: index + 1,
    });
  }
  const bounded = sanitizeReaderBookmarksState(rawState(many), context(10_000));
  assert.ok(countReaderBookmarks(bounded).total <= MAXIMUM_TOTAL_READER_BOOKMARKS);
  assert.ok(
    readerBookmarksByteSize(bounded, context(10_000)) <=
      MAXIMUM_READER_BOOKMARKS_SERIALIZED_BYTES,
  );
  assert.ok(
    Object.hasOwn(
      bounded.bookmarks,
      `mark-${String(MAXIMUM_TOTAL_READER_BOOKMARKS + 99).padStart(4, "0")}`,
    ),
    "Newest tombstones survive deterministic pruning first.",
  );

  const large = Object.create(null);
  for (let index = 0; index < MAXIMUM_LIVE_READER_BOOKMARKS; index += 1) {
    const id = `large-${String(index).padStart(4, "0")}`;
    large[id] = rawBookmark(id, {
      quote: `${String(index).padStart(4, "0")}${"x".repeat(1_996)}`,
      updatedAt: index,
    });
  }
  const byteBounded = sanitizeReaderBookmarksState(
    rawState(large),
    context(10_000),
  );
  assert.ok(
    readerBookmarksByteSize(byteBounded, context(10_000)) <=
      MAXIMUM_READER_BOOKMARKS_SERIALIZED_BYTES,
  );
  assert.ok(
    countReaderBookmarks(byteBounded).live <
      MAXIMUM_LIVE_READER_BOOKMARKS,
  );
  assert.deepEqual(
    parseReaderBookmarksState(
      "x".repeat(MAXIMUM_READER_BOOKMARKS_INPUT_BYTES + 1),
      context(),
    ),
    createEmptyReaderBookmarksState(publicationId),
  );
});

test("the live cap rejects a new bookmark, and remote pruning honors its budget", () => {
  const full = Object.create(null);
  for (let index = 0; index < MAXIMUM_LIVE_READER_BOOKMARKS; index += 1) {
    const id = `live-${String(index).padStart(4, "0")}`;
    full[id] = rawBookmark(id, { updatedAt: index });
  }
  const state = sanitizeReaderBookmarksState(rawState(full), context(10_000));
  assert.throws(() =>
    addReaderBookmark(state, input("one-more"), context(10_001))
  );

  assert.equal(readerBookmarksFitRemoteBudget(state, context(10_000)), false);
  const remote = pruneReaderBookmarksToRemoteBudget(state, context(10_000));
  assert.ok(
    readerBookmarksByteSize(remote, context(10_000)) <=
      MAXIMUM_READER_BOOKMARKS_REMOTE_BYTES,
  );
  assert.equal(readerBookmarksFitRemoteBudget(remote, context(10_000)), true);
});

test("malformed bookmarks cannot be resolved", () => {
  assert.deepEqual(resolveReaderBookmark({ id: "partial" }, []), {
    status: "invalid",
  });
  const deleted = {
    ...rawBookmark("deleted"),
    deletedAt: 100,
  };
  assert.deepEqual(resolveReaderBookmark(deleted, []), {
    status: "invalid",
  });
});

test("browser bookmark modules use no ambient authority", async () => {
  const source = (
    await Promise.all(
      ["passage-range.js", "bookmarks.js"].map((name) =>
        readFile(
          new URL(`../packages/reader/dist/${name}`, import.meta.url),
          "utf8",
        )
      ),
    )
  ).join("\n");
  for (const forbidden of [
    "window.",
    "document.",
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
