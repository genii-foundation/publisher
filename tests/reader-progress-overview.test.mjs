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
  addReaderBookmark,
  createEmptyReaderBookmarksState,
} from "../packages/reader/dist/bookmarks.js";
import {
  createReaderProgressOverview,
} from "../packages/reader/dist/progress-overview.js";
import {
  createEmptyReaderProgressState,
  recordReaderSectionProgress,
} from "../packages/reader/dist/progress.js";

const publicationId = "field-notes";
const OLD_HASH = `sha256:${"1".repeat(64)}`;
const NEW_HASH = `sha256:${"2".repeat(64)}`;
const SECOND_HASH = `sha256:${"3".repeat(64)}`;
const THIRD_HASH = `sha256:${"4".repeat(64)}`;

function section({
  id,
  continuityId = id,
  aliases = [],
  contentHash,
  order,
}) {
  return {
    id,
    continuity: {
      id: continuityId,
      legacyIds: aliases,
      progressGroups: [[continuityId, ...aliases]],
      historicalSectionIds: [],
    },
    contentHash,
    wordCount: 100,
    workId: "observations",
    workTitle: "Observations",
    title: id[0].toUpperCase() + id.slice(1),
    href: `/readings/${id}`,
    order,
  };
}

function bookmarkRange(sectionContinuityId) {
  const point = (offset) => ({
    workId: "observations",
    sectionContinuityId,
    blockId: "paragraph",
    blockContentHash: OLD_HASH,
    offset,
  });
  return { start: point(0), end: point(4) };
}

test("progress overview combines canonical status, recommendations, recent reading, and bookmarks", () => {
  const oldOpening = section({
    id: "opening",
    continuityId: "opening-current",
    aliases: ["opening-old"],
    contentHash: OLD_HASH,
    order: 0,
  });
  const sections = [
    { ...oldOpening, contentHash: NEW_HASH },
    section({ id: "middle", contentHash: SECOND_HASH, order: 1 }),
    section({ id: "closing", contentHash: THIRD_HASH, order: 2 }),
  ];
  let progress = createEmptyReaderProgressState(publicationId);
  progress = recordReaderSectionProgress(progress, oldOpening, {
    now: 10,
    percent: 100,
    read: "manual",
  });
  progress = recordReaderSectionProgress(progress, sections[2], {
    now: 20,
    percent: 100,
    read: "automatic",
  });
  progress = recordReaderSectionProgress(progress, sections[1], {
    now: 30,
    percent: 50,
  });

  let bookmarks = createEmptyReaderBookmarksState(publicationId);
  bookmarks = addReaderBookmark(bookmarks, {
    id: "opening-note",
    workId: "observations",
    sectionContinuityId: "opening-old",
    href: "/readings/opening",
    quote: "Open",
    prefix: "",
    suffix: "ing",
    range: bookmarkRange("opening-old"),
  }, { publicationId, now: 40 });

  const overview = createReaderProgressOverview(
    progress,
    bookmarks,
    sections.reverse(),
  );
  assert.deepEqual(overview.aggregate, {
    percent: 83,
    completedWordCount: 250,
    totalWordCount: 300,
    sectionCount: 3,
    statuses: {
      unread: 0,
      partial: 1,
      read: 1,
      updated: 1,
    },
  });
  assert.deepEqual(
    overview.sections.map(({ sectionId, status, percent, bookmarked }) => ({
      sectionId,
      status,
      percent,
      bookmarked,
    })),
    [
      { sectionId: "opening", status: "updated", percent: 100, bookmarked: true },
      { sectionId: "middle", status: "partial", percent: 50, bookmarked: false },
      { sectionId: "closing", status: "read", percent: 100, bookmarked: false },
    ],
  );
  assert.equal(overview.bookmarkedSectionCount, 1);
  assert.deepEqual(overview.recommendations, [
    {
      sectionId: "opening",
      title: "Opening",
      href: "/readings/opening",
      reason: "updated",
      bookmarked: true,
    },
    {
      sectionId: "middle",
      title: "Middle",
      href: "/readings/middle",
      reason: "continue",
      bookmarked: false,
    },
  ]);
  assert.deepEqual(overview.recentlyRead, [
    {
      sectionId: "closing",
      title: "Closing",
      href: "/readings/closing",
      readAt: 20,
      bookmarked: false,
    },
    {
      sectionId: "opening",
      title: "Opening",
      href: "/readings/opening",
      readAt: 10,
      bookmarked: true,
    },
  ]);
  assert.equal(Object.isFrozen(overview), true);
  assert.equal(Object.isFrozen(overview.sections), true);
});

test("progress overview bounds lists and refuses mixed publication state", () => {
  const sections = [section({
    id: "opening",
    contentHash: OLD_HASH,
    order: 0,
  })];
  const progress = createEmptyReaderProgressState(publicationId);
  const bookmarks = createEmptyReaderBookmarksState(publicationId);
  const overview = createReaderProgressOverview(progress, bookmarks, sections, {
    recommendationLimit: 0,
    recentlyReadLimit: -1,
  });
  assert.deepEqual(overview.recommendations, []);
  assert.deepEqual(overview.recentlyRead, []);
  assert.throws(
    () => createReaderProgressOverview(
      progress,
      createEmptyReaderBookmarksState("another-publication"),
      sections,
    ),
    /must belong to one publication/u,
  );
});
