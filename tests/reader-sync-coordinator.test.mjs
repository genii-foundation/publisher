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
  removeReaderBookmark,
} from "../packages/reader/dist/bookmarks.js";
import {
  createEmptyReaderProgressState,
  recordReaderSectionProgress,
} from "../packages/reader/dist/progress.js";
import {
  beginReaderSyncAttempt,
  acknowledgeReaderEngagementEvents,
  addReaderEngagementEvent,
  completeReaderSyncAttempt,
  createEmptyReaderEngagementState,
  createReaderSyncCoordinatorState,
  createReaderSyncConsent,
  grantReaderSyncConsent,
  noteReaderSyncChange,
  parseReaderSyncConsent,
  readerEngagementEventsForTransfer,
  reconcileReaderSyncState,
  revokeReaderSyncConsent,
  serializeReaderSyncConsent,
  setReaderSyncOnline,
} from "../packages/reader/dist/sync.js";

const publicationId = "field-notes";
const HASH = `sha256:${"1".repeat(64)}`;

function section() {
  return {
    id: "opening",
    role: "section",
    title: "Opening",
    parentId: null,
    childIds: [],
    depth: 0,
    order: 0,
    routes: {},
    activeRouteNames: [],
    readerAddress: null,
    domId: null,
    continuity: {
      id: "opening",
      legacyIds: [],
      progressGroups: [["opening"]],
      historicalSectionIds: [],
    },
    navigable: true,
    blocks: [],
    previousId: null,
    nextId: null,
    wordCount: 100,
    readingMinutes: 1,
    contentHash: HASH,
  };
}

function bookmarkInput() {
  const point = {
    workId: "observations",
    sectionContinuityId: "opening",
    blockId: "first",
    blockContentHash: HASH,
    offset: 0,
  };
  return {
    id: "mark-1",
    workId: "observations",
    sectionContinuityId: "opening",
    href: "/observations/opening/#first",
    quote: "beta",
    prefix: "alpha ",
    suffix: " gamma",
    range: { start: point, end: { ...point, offset: 4 } },
  };
}

test("debounce, reconnect, and retry are explicit clock-driven state", () => {
  let state = createReaderSyncCoordinatorState(publicationId);
  state = noteReaderSyncChange(state, 1_000, { debounceMs: 500 });
  state = noteReaderSyncChange(state, 1_100, { debounceMs: 500 });
  assert.equal(beginReaderSyncAttempt(state, 1_599), null);
  const attempt = beginReaderSyncAttempt(state, 1_600);
  assert.equal(attempt.revision, 2);

  state = completeReaderSyncAttempt(
    attempt.state,
    attempt.revision,
    false,
    2_000,
    { retryBaseMs: 1_000 },
  );
  assert.equal(state.nextAttemptAt, 3_000);
  assert.equal(beginReaderSyncAttempt(state, 2_999), null);

  state = setReaderSyncOnline(state, false, 2_500);
  assert.equal(state.phase, "offline");
  state = noteReaderSyncChange(state, 2_600);
  assert.equal(state.revision, 3);
  state = setReaderSyncOnline(state, true, 4_000);
  assert.equal(state.nextAttemptAt, 4_000);
  assert.equal(beginReaderSyncAttempt(state, 4_000).revision, 3);
});

test("an edit made during a request is scheduled immediately after success", () => {
  let state = noteReaderSyncChange(
    createReaderSyncCoordinatorState(publicationId),
    1_000,
    { debounceMs: 0 },
  );
  const attempt = beginReaderSyncAttempt(state, 1_000);
  state = noteReaderSyncChange(attempt.state, 1_100);
  assert.equal(state.revision, 2);
  assert.equal(state.inFlightRevision, 1);
  state = completeReaderSyncAttempt(state, 1, true, 1_200);
  assert.equal(state.acknowledgedRevision, 1);
  assert.equal(state.phase, "waiting");
  assert.equal(state.nextAttemptAt, 1_200);
  assert.equal(beginReaderSyncAttempt(state, 1_200).revision, 2);
});

test("reconciliation preserves in-flight progress edits and bookmark tombstones", () => {
  const currentSection = section();
  let sentProgress = createEmptyReaderProgressState(publicationId);
  sentProgress = recordReaderSectionProgress(sentProgress, currentSection, {
    now: 1_000,
    percent: 20,
    scrollPercent: 20,
  });
  let currentProgress = recordReaderSectionProgress(sentProgress, currentSection, {
    now: 2_000,
    percent: 70,
    scrollPercent: 70,
  });

  let remoteBookmarks = addReaderBookmark(
    createEmptyReaderBookmarksState(publicationId),
    bookmarkInput(),
    { publicationId, now: 1_000 },
  );
  const currentBookmarks = removeReaderBookmark(
    remoteBookmarks,
    "mark-1",
    { publicationId, now: 2_000 },
  );
  const reconciled = reconcileReaderSyncState(
    currentProgress,
    currentBookmarks,
    {
      progress: { value: sentProgress, schemaVersion: 1 },
      bookmarks: { value: remoteBookmarks, schemaVersion: 1 },
    },
    { publicationId, now: 2_000 },
  );
  assert.equal(reconciled.progress.entries.opening.percent, 70);
  assert.equal(reconciled.bookmarks.bookmarks["mark-1"].deletedAt, 2_000);
  assert.equal(reconciled.transferProgress.entries.opening.percent, 70);
  assert.equal(reconciled.transferBookmarks.bookmarks["mark-1"].deletedAt, 2_000);
});

test("schema-ahead remote documents freeze only their own capability", () => {
  const progress = createEmptyReaderProgressState(publicationId);
  const bookmarks = createEmptyReaderBookmarksState(publicationId);
  const reconciled = reconcileReaderSyncState(
    progress,
    bookmarks,
    {
      progress: { value: {}, schemaVersion: 2 },
      bookmarks: null,
    },
    { publicationId, now: 1_000 },
  );
  assert.equal(reconciled.progressStatus, "schema-ahead");
  assert.equal(reconciled.transferProgress, null);
  assert.equal(reconciled.bookmarksStatus, "absent");
  assert.notEqual(reconciled.transferBookmarks, null);
});

test("consent is publication scoped and bound to the displayed copy", () => {
  const empty = createReaderSyncConsent(publicationId, "reader-sync-consent-1");
  const granted = grantReaderSyncConsent(empty, 1_000);
  assert.equal(granted.granted, true);
  assert.equal(granted.grantedAt, 1_000);
  const parsed = parseReaderSyncConsent(
    serializeReaderSyncConsent(granted),
    publicationId,
    "reader-sync-consent-1",
  );
  assert.deepEqual(parsed, granted);
  assert.equal(
    parseReaderSyncConsent(
      serializeReaderSyncConsent(granted),
      publicationId,
      "reader-sync-consent-2",
    ).granted,
    false,
  );
  const revoked = revokeReaderSyncConsent(granted, 2_000);
  assert.equal(revoked.granted, false);
  assert.equal(revoked.grantedAt, 1_000);
  assert.equal(revoked.revokedAt, 2_000);
});

test("engagement retries are idempotent and acknowledge only sent IDs", () => {
  let state = createEmptyReaderEngagementState(publicationId);
  const first = {
    clientEventId: "event-1",
    eventType: "section_opened",
    eventAt: 1_000,
    sectionId: "opening",
  };
  state = addReaderEngagementEvent(state, first);
  state = addReaderEngagementEvent(state, first);
  assert.equal(state.events.length, 1);
  const sent = readerEngagementEventsForTransfer(state);
  state = addReaderEngagementEvent(state, {
    clientEventId: "event-2",
    eventType: "scroll_milestone",
    eventAt: 1_100,
  });
  state = acknowledgeReaderEngagementEvents(
    state,
    sent.map((event) => event.clientEventId),
    1_200,
  );
  assert.equal(state.events[0].syncedAt, 1_200);
  assert.equal(state.events[1].syncedAt, undefined);
  assert.deepEqual(
    readerEngagementEventsForTransfer(state).map((event) => event.clientEventId),
    ["event-2"],
  );
});
