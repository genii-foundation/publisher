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
  createReaderSearchIndex,
  createReaderSearchTerms,
  foldReaderSearchText,
  parseReaderSearchIndex,
  searchReaderIndex,
  serializeReaderSearchIndex,
} from "../packages/reader/dist/search.js";

const ZERO_HASH = `sha256:${"0".repeat(64)}`;
const ONE_HASH = `sha256:${"1".repeat(64)}`;

function reader() {
  const makeSection = ({ id, title, text, order }) => ({
    id,
    role: "section",
    title,
    parentId: null,
    childIds: [],
    depth: 0,
    order,
    routes: {},
    activeRouteNames: [],
    readerAddress: { path: "/field-notes/", anchor: id },
    domId: id,
    continuity: {
      id,
      legacyIds: [],
      progressGroups: [[id]],
      historicalSectionIds: [],
    },
    navigable: true,
    blocks: [{
      id: `${id}-block`,
      kind: "paragraph",
      markdown: text,
      text,
      readerAddress: {
        path: "/field-notes/",
        anchor: `${id}-block`,
      },
      domId: `${id}-block`,
      wordCount: text.split(/\s+/u).length,
      contentHash: ONE_HASH,
    }],
    previousId: null,
    nextId: null,
    wordCount: text.split(/\s+/u).length,
    readingMinutes: 1,
    contentHash: ONE_HASH,
  });
  return {
    publicationId: "field-notes",
    buildId: ZERO_HASH,
    works: [{
      id: "notes",
      title: "Field Notes",
      language: "en",
      publicationState: "published",
      route: "/field-notes/",
      rootSectionIds: ["opening", "foundations", "nihongo"],
      sections: [
        makeSection({
          id: "opening",
          title: "Opening",
          text: "Café... start here with practical foundations.",
          order: 0,
        }),
        makeSection({
          id: "foundations",
          title: "Foundations",
          text: "A short title match.",
          order: 1,
        }),
        makeSection({
          id: "nihongo",
          title: "日本語",
          text: "日本語の文章です。",
          order: 2,
        }),
      ],
      wordCount: 12,
      readingMinutes: 1,
      contentHash: ONE_HASH,
    }],
  };
}

test("search projects a small artifact bound to the exact Reader build", () => {
  const index = createReaderSearchIndex(reader());
  assert.equal(index.publicationId, "field-notes");
  assert.equal(index.readerBuildId, ZERO_HASH);
  assert.equal(index.entries.length, 3);
  assert.deepEqual(index.entries[0], {
    workId: "notes",
    sectionId: "opening",
    continuityId: "opening",
    workTitle: "Field Notes",
    sectionTitle: "Opening",
    href: "/field-notes/#opening",
    text: "Café... start here with practical foundations.",
    foldedTitle: "field notes opening",
    foldedText: "cafe start here with practical foundations",
    contentHash: ONE_HASH,
    wordCount: 6,
    order: 0,
  });
  const serialized = serializeReaderSearchIndex(index);
  assert.equal(serialized, serializeReaderSearchIndex(index));
  assert.equal(serialized.includes("markdown"), false);
  assert.equal(serialized.includes("assets"), false);
  assert.equal(Object.isFrozen(index), true);
  assert.equal(Object.isFrozen(index.entries), true);
  assert.equal(Object.isFrozen(index.entries[0]), true);
  assert.deepEqual(
    parseReaderSearchIndex(serialized, {
      publicationId: "field-notes",
      readerBuildId: ZERO_HASH,
    }),
    index,
  );
});

test("fetched search artifacts fail closed on identity drift or poisoned folds", () => {
  const serialized = serializeReaderSearchIndex(
    createReaderSearchIndex(reader()),
  );
  assert.equal(
    parseReaderSearchIndex(serialized, {
      publicationId: "field-notes",
      readerBuildId: ONE_HASH,
    }),
    null,
  );
  const poisoned = JSON.parse(serialized);
  poisoned.entries[0].foldedText = "fabricated match";
  assert.equal(
    parseReaderSearchIndex(JSON.stringify(poisoned), {
      publicationId: "field-notes",
      readerBuildId: ZERO_HASH,
    }),
    null,
  );
  const extended = JSON.parse(serialized);
  extended.credentials = "never accepted";
  assert.equal(
    parseReaderSearchIndex(JSON.stringify(extended), {
      publicationId: "field-notes",
      readerBuildId: ZERO_HASH,
    }),
    null,
  );
  assert.equal(
    parseReaderSearchIndex("{", {
      publicationId: "field-notes",
      readerBuildId: ZERO_HASH,
    }),
    null,
  );
});

test("Unicode folding preserves languages and removes Latin diacritics", () => {
  assert.equal(foldReaderSearchText("Café déjà-vu"), "cafe deja vu");
  assert.equal(foldReaderSearchText("日本語の文章です。"), "日本語の文章てす");
  assert.deepEqual(createReaderSearchTerms("CAFÉ café!!!"), ["cafe"]);
  const index = createReaderSearchIndex(reader());
  assert.equal(searchReaderIndex(index, "cafe").length, 1);
  assert.equal(searchReaderIndex(index, "日本語").length, 1);
});

test("snippet offsets map folded punctuation back to the original text", () => {
  const index = createReaderSearchIndex(reader());
  const [cafe] = searchReaderIndex(index, "cafe");
  assert.equal(cafe.snippet.slice(cafe.matchStart, cafe.matchEnd), "Café");
  const [start] = searchReaderIndex(index, "start");
  assert.equal(start.snippetStart, 0);
  assert.equal(start.matchStart, 8);
  assert.equal(start.snippet.slice(start.matchStart, start.matchEnd), "start");
});

test("all terms must match and title matches rank before body-only matches", () => {
  const index = createReaderSearchIndex(reader());
  assert.equal(searchReaderIndex(index, "missing").length, 0);
  assert.equal(searchReaderIndex(index, "practical foundations").length, 1);
  const matches = searchReaderIndex(index, "foundations");
  assert.deepEqual(matches.map(({ entry }) => entry.sectionId), [
    "foundations",
    "opening",
  ]);
  assert.equal(searchReaderIndex(index, "foundations", { limit: 1 }).length, 1);
  assert.deepEqual(searchReaderIndex(index, "!!!"), []);
});

test("the package exports a browser-safe search subpath", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../packages/reader/package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(manifest.exports["./search"], {
    types: "./dist/search.d.ts",
    import: "./dist/search.js",
  });
  const source = await readFile(
    new URL("../packages/reader/dist/search.js", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "window",
    "document",
    "localStorage",
    "fetch(",
    "process.",
    "Date.now",
    "Math.random",
    "node:",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
