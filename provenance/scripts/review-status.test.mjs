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
  createProvenanceReview,
  formatProvenanceReview,
  parseReviewArguments,
  reviewProvenance,
} from "./review-status.mjs";

function summary(overrides = {}) {
  return {
    recordId: "record-one",
    status: "draft",
    classification: "fresh-cpal",
    packageRoots: ["packages/example/"],
    destinationManifestPresent: false,
    receiptPresent: false,
    treatmentBlocker: null,
    review: {
      decision: "pending",
      reviewerType: "automated",
      reviewerId: "review-bot",
      reviewedAt: "2026-08-28T00:00:00Z",
      releaseApprovalRequired: true,
      notes: "Human review remains required.",
    },
    scanOutcomes: {
      exactBlob: "clear",
      normalizedLine: "clear",
      tokenShingle: "clear",
      ccPhrase: "clear",
      packageLeak: "clear",
    },
    ...overrides,
  };
}

test("the committed provenance records produce one exact review gate", async () => {
  const { options, report } = await reviewProvenance({ argv: [] });

  assert.deepEqual(options, { json: false });
  assert.equal(report.schemaVersion, "1.0.0");
  assert.equal(report.recordCount, 4);
  assert.deepEqual(report.counts, {
    accepted: 0,
    blocked: 0,
    draft: 4,
  });
  assert.equal(report.packageRecordCount, 4);
  assert.equal(report.releasePreparationBlocked, true);
  assert.deepEqual(
    report.records.map((record) => record.recordId),
    [
      "2026-07-28-foundation-extraction",
      "2026-07-28-publisher-source-loader",
      "2026-07-28-unicode-portability-preservation",
      "2026-08-28-supabase-provider-package",
    ],
  );
  for (const record of report.records) {
    assert.deepEqual(record.remainingGates, [
      "record-acceptance",
      "review-decision",
      "destination-manifest",
      "final-receipt",
      "release-approval",
    ]);
  }
});

test("accepted and blocked records report distinct remaining work", () => {
  const baseline = summary();
  const report = createProvenanceReview([
    summary({
      recordId: "accepted-record",
      status: "accepted",
      destinationManifestPresent: true,
      receiptPresent: true,
      review: {
        ...baseline.review,
        decision: "accepted",
        reviewerType: "maintainer",
        releaseApprovalRequired: false,
      },
    }),
    summary({
      recordId: "blocked-record",
      status: "blocked",
      classification: "blocked",
      packageRoots: [],
      treatmentBlocker: "Rights evidence is missing.",
      review: {
        ...baseline.review,
        decision: "rejected",
        releaseApprovalRequired: false,
      },
    }),
  ]);

  assert.equal(report.releasePreparationBlocked, false);
  assert.deepEqual(report.records[0].remainingGates, []);
  assert.deepEqual(report.records[1].remainingGates, [
    "record-acceptance",
    "review-decision",
    "destination-manifest",
    "final-receipt",
    "treatment-blocker",
  ]);
});

test("human and JSON modes are exact and unknown arguments fail", () => {
  const report = createProvenanceReview([summary()]);
  const formatted = formatProvenanceReview(report);

  assert.match(formatted, /^Provenance review status\n/u);
  assert.match(formatted, /Release preparation: blocked/u);
  assert.match(
    formatted,
    /Scans: exactBlob=clear, normalizedLine=clear, tokenShingle=clear, ccPhrase=clear, packageLeak=clear/u,
  );
  assert.match(
    formatted,
    /Remaining: record-acceptance, review-decision, destination-manifest, final-receipt, release-approval/u,
  );
  assert.match(formatted, /Notes: Human review remains required\./u);
  assert.deepEqual(parseReviewArguments(["--json"]), { json: true });
  assert.throws(
    () => parseReviewArguments(["--write"]),
    /accepts only the optional --json flag/u,
  );
});

test("review projections reject malformed and duplicate summaries", () => {
  assert.throws(
    () => createProvenanceReview([]),
    /at least one record summary/u,
  );
  assert.throws(
    () => createProvenanceReview([{}]),
    /validated record summaries/u,
  );
  const missingScan = summary();
  delete missingScan.scanOutcomes.packageLeak;
  assert.throws(
    () => createProvenanceReview([missingScan]),
    /validated record summaries/u,
  );
  assert.throws(
    () => createProvenanceReview([summary({ treatmentBlocker: undefined })]),
    /validated record summaries/u,
  );
  assert.throws(
    () => createProvenanceReview([summary(), summary()]),
    /Duplicate provenance review record/u,
  );
});
