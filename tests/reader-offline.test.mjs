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
import test from "node:test";

import {
  createReaderOfflineCatalog,
  parseReaderOfflineCatalog,
  serializeReaderOfflineCatalog,
} from "../packages/reader/dist/offline.js";

const READER_BUILD_ID = `sha256:${"1".repeat(64)}`;
const RENDERER_BUILD_ID = `sha256:${"2".repeat(64)}`;
const NARRATION_HASH = `sha256:${"3".repeat(64)}`;
const FIRST_WORK_HASH = `sha256:${"4".repeat(64)}`;
const SECOND_WORK_HASH = `sha256:${"5".repeat(64)}`;

function section(id) {
  return { id };
}

function reader() {
  return {
    publicationId: "field-notes",
    buildId: READER_BUILD_ID,
    works: [
      {
        id: "first-work",
        title: "First Work",
        route: "/works/first/",
        contentHash: FIRST_WORK_HASH,
        sections: [section("first-opening"), section("first-closing")],
      },
      {
        id: "second-work",
        title: "Second Work",
        route: "/works/second/",
        contentHash: SECOND_WORK_HASH,
        sections: [section("second-opening")],
      },
    ],
    collections: [
      {
        id: "collected",
        route: "/collections/notes/",
        workIds: ["first-work"],
      },
    ],
    assets: [
      {
        id: "shared-mark",
        href: "/assets/mark.svg",
        mediaType: "image/svg+xml",
        hash: `sha256:${"6".repeat(64)}`,
      },
      {
        id: "first-cover",
        workId: "first-work",
        href: "/assets/first.webp",
        mediaType: "image/webp",
        hash: `sha256:${"7".repeat(64)}`,
      },
      {
        id: "second-cover",
        workId: "second-work",
        href: "/assets/second.webp",
        mediaType: "image/webp",
        hash: `sha256:${"8".repeat(64)}`,
      },
    ],
    routes: {
      active: [
        { path: "/", target: { kind: "home" } },
        {
          path: "/collections/notes/",
          target: { kind: "collection", collectionId: "collected" },
        },
        {
          path: "/works/first/",
          target: { kind: "work", workId: "first-work" },
        },
        {
          path: "/works/first/opening/",
          target: {
            kind: "section",
            workId: "first-work",
            sectionId: "first-opening",
            routeName: "reader",
          },
        },
        {
          path: "/works/second/",
          target: { kind: "work", workId: "second-work" },
        },
      ],
      redirects: [
        { from: "/old/first/", to: "/older/first/", status: 308 },
        { from: "/older/first/", to: "/works/first/", status: 308 },
        { from: "/old/second/", to: "/works/second/", status: 308 },
      ],
    },
  };
}

function narration() {
  return {
    publicationId: "field-notes",
    readerBuildId: READER_BUILD_ID,
    voices: [
      {
        id: "calm",
        label: "Calm",
        clips: [
          {
            sectionId: "first-opening",
            audioVersionId: "first-opening.v1",
            href: "/audio/first-opening.opus",
            byteSize: 1_000,
            timingsByteSize: 200,
          },
          {
            sectionId: "second-opening",
            audioVersionId: "second-opening.v1",
            href: "https://media.example.org/second-opening.opus",
            byteSize: 900,
          },
        ],
        narratedSectionCount: 2,
        unnarratedSectionCount: 1,
      },
      {
        id: "bright",
        label: "Bright",
        clips: [
          {
            sectionId: "first-opening",
            audioVersionId: "first-opening.v2",
            href: "/audio/bright-first-opening.mp3",
            byteSize: 1_200,
          },
        ],
        narratedSectionCount: 1,
        unnarratedSectionCount: 2,
      },
    ],
    statistics: { voiceCount: 2, clipCount: 3, sectionCount: 3 },
  };
}

function createCatalog() {
  return createReaderOfflineCatalog({
    reader: reader(),
    rendererBuildId: RENDERER_BUILD_ID,
    catalogHref: "/publication-reader-offline.json",
    sharedResources: [
      { href: "/publication-reader-search.json", kind: "data" },
      { href: "/publication-reader-progress.json", kind: "data" },
      { href: "/publication-audio.json", kind: "data" },
    ],
    narration: { catalogHash: NARRATION_HASH, envelope: narration() },
  });
}

test("offline planning closes each work over documents, data, assets, and narration", () => {
  const catalog = createCatalog();
  assert.equal(catalog.packages.length, 2);
  const first = catalog.packages[0];
  assert.deepEqual(first.version, {
    readerBuildId: READER_BUILD_ID,
    rendererBuildId: RENDERER_BUILD_ID,
    workContentHash: FIRST_WORK_HASH,
    narrationCatalogHash: NARRATION_HASH,
  });
  assert.equal(first.sectionCount, 2);
  assert.equal(first.audioClipCount, 2);
  assert.equal(first.declaredByteSize, 2_400);
  const hrefs = new Set(first.resources.map(({ href }) => href));
  for (const href of [
    "/",
    "/collections/notes/",
    "/works/first/",
    "/works/first/opening/",
    "/old/first/",
    "/older/first/",
    "/publication-reader-offline.json",
    "/publication-reader-search.json",
    "/publication-reader-progress.json",
    "/publication-audio.json",
    "/assets/mark.svg",
    "/assets/first.webp",
    "/audio/first-opening.opus",
    "/audio/first-opening.timings.json",
    "/audio/bright-first-opening.mp3",
  ]) assert.equal(hrefs.has(href), true, `missing ${href}`);
  assert.equal(hrefs.has("/assets/second.webp"), false);
  assert.equal(hrefs.has("/works/second/"), false);
  assert.equal(hrefs.has("/old/second/"), false);
  assert.equal(Object.isFrozen(first.resources), true);
  assert.equal(Object.isFrozen(first.version), true);

  const second = catalog.packages[1];
  assert.equal(second.audioClipCount, 1);
  assert.equal(
    second.resources.some(({ href }) =>
      href === "https://media.example.org/second-opening.opus"),
    true,
  );
});

test("offline packages remain complete without narration", () => {
  const catalog = createReaderOfflineCatalog({
    reader: reader(),
    rendererBuildId: RENDERER_BUILD_ID,
    catalogHref: "/publication-reader-offline.json",
    sharedResources: [],
  });
  assert.equal(catalog.packages[0].audioClipCount, 0);
  assert.equal(catalog.packages[0].version.narrationCatalogHash, null);
  assert.equal(
    catalog.packages[0].resources.some(({ kind }) => kind === "document"),
    true,
  );
});

test("a fetched offline catalog is strict, immutable, and identity bound", () => {
  const catalog = createCatalog();
  const parsed = parseReaderOfflineCatalog(
    serializeReaderOfflineCatalog(catalog),
    {
      publicationId: "field-notes",
      readerBuildId: READER_BUILD_ID,
      rendererBuildId: RENDERER_BUILD_ID,
    },
  );
  assert.deepEqual(parsed, catalog);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.packages[0].resources[0]), true);

  assert.equal(parseReaderOfflineCatalog(
    serializeReaderOfflineCatalog(catalog),
    {
      publicationId: "another-publication",
      readerBuildId: READER_BUILD_ID,
      rendererBuildId: RENDERER_BUILD_ID,
    },
  ), null);

  const extra = structuredClone(catalog);
  extra.packages[0].surprise = true;
  assert.equal(parseReaderOfflineCatalog(extra, {
    publicationId: "field-notes",
    readerBuildId: READER_BUILD_ID,
    rendererBuildId: RENDERER_BUILD_ID,
  }), null);

  const duplicate = structuredClone(catalog);
  duplicate.packages[0].resources.push(duplicate.packages[0].resources[0]);
  duplicate.packages[0].resourceCount += 1;
  duplicate.packages[0].unknownByteSizeCount += 1;
  assert.equal(parseReaderOfflineCatalog(duplicate, {
    publicationId: "field-notes",
    readerBuildId: READER_BUILD_ID,
    rendererBuildId: RENDERER_BUILD_ID,
  }), null);

  const poisoned = structuredClone(catalog);
  poisoned.packages[0].declaredByteSize += 1;
  assert.equal(parseReaderOfflineCatalog(poisoned, {
    publicationId: "field-notes",
    readerBuildId: READER_BUILD_ID,
    rendererBuildId: RENDERER_BUILD_ID,
  }), null);
});

test("the planner rejects ambiguous resources and mismatched narration", () => {
  assert.throws(() => createReaderOfflineCatalog({
    reader: reader(),
    rendererBuildId: RENDERER_BUILD_ID,
    catalogHref: "/publication-reader-offline.json",
    sharedResources: [
      { href: "/publication-reader-offline.json", kind: "asset" },
    ],
  }), /conflicting declarations/);

  const wrongNarration = narration();
  wrongNarration.publicationId = "another-publication";
  assert.throws(() => createReaderOfflineCatalog({
    reader: reader(),
    rendererBuildId: RENDERER_BUILD_ID,
    catalogHref: "/publication-reader-offline.json",
    sharedResources: [],
    narration: { catalogHash: NARRATION_HASH, envelope: wrongNarration },
  }), /identity does not match/);
});
