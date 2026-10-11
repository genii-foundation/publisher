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
  createReaderProgressCatalog,
  parseReaderProgressCatalog,
  serializeReaderProgressCatalog,
} from "../packages/reader/dist/progress-catalog.js";

const BUILD_HASH = `sha256:${"0".repeat(64)}`;
const CONTENT_HASH = `sha256:${"1".repeat(64)}`;

function reader() {
  const section = (id, title, navigable = true) => ({
    id,
    title,
    navigable,
    readerAddress: { path: "/field-notes/", anchor: id },
    continuity: {
      id: `${id}-current`,
      legacyIds: [`${id}-old`],
      progressGroups: [[`${id}-current`, `${id}-old`]],
      historicalSectionIds: [`${id}-historical`],
    },
    wordCount: 100,
    contentHash: CONTENT_HASH,
  });
  return {
    publicationId: "field-notes",
    buildId: BUILD_HASH,
    works: [{
      id: "notes",
      title: "Field Notes",
      route: "/field-notes/",
      sections: [
        section("opening", "Opening"),
        section("hidden", "Hidden", false),
        section("closing", "Closing"),
      ],
    }],
  };
}

test("progress catalog projects navigable continuity without manuscript text", () => {
  const catalog = createReaderProgressCatalog(reader());
  assert.equal(catalog.entries.length, 2);
  assert.deepEqual(catalog.entries[0], {
    id: "opening",
    continuity: {
      id: "opening-current",
      legacyIds: ["opening-old"],
      progressGroups: [["opening-current", "opening-old"]],
      historicalSectionIds: ["opening-historical"],
    },
    contentHash: CONTENT_HASH,
    wordCount: 100,
    workId: "notes",
    workTitle: "Field Notes",
    title: "Opening",
    href: "/field-notes/#opening",
    order: 0,
  });
  assert.equal("blocks" in catalog.entries[0], false);
  assert.equal(Object.isFrozen(catalog.entries[0].continuity.progressGroups[0]), true);

  const parsed = parseReaderProgressCatalog(
    serializeReaderProgressCatalog(catalog),
    { publicationId: "field-notes", readerBuildId: BUILD_HASH },
  );
  assert.deepEqual(parsed, catalog);
});

test("progress catalog parser rejects identity drift and malformed continuity", () => {
  const catalog = createReaderProgressCatalog(reader());
  const serialized = serializeReaderProgressCatalog(catalog);
  assert.equal(parseReaderProgressCatalog(serialized, {
    publicationId: "another-publication",
    readerBuildId: BUILD_HASH,
  }), null);

  const malformed = JSON.parse(serialized);
  malformed.entries[0].continuity.progressGroups = [];
  assert.equal(parseReaderProgressCatalog(JSON.stringify(malformed), {
    publicationId: "field-notes",
    readerBuildId: BUILD_HASH,
  }), null);

  const unowned = JSON.parse(serialized);
  unowned.entries[0].continuity.progressGroups = [["not-owned"]];
  assert.equal(parseReaderProgressCatalog(JSON.stringify(unowned), {
    publicationId: "field-notes",
    readerBuildId: BUILD_HASH,
  }), null);

  const collision = JSON.parse(serialized);
  collision.entries[1].continuity.historicalSectionIds = ["opening-old"];
  assert.equal(parseReaderProgressCatalog(JSON.stringify(collision), {
    publicationId: "field-notes",
    readerBuildId: BUILD_HASH,
  }), null);
});
