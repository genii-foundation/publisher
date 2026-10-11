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

import { pathToFileURL } from "node:url";

import { validateProvenanceDirectory } from "./validate.mjs";

const statuses = Object.freeze(["accepted", "blocked", "draft"]);
const scanNames = Object.freeze([
  "exactBlob",
  "normalizedLine",
  "tokenShingle",
  "ccPhrase",
  "packageLeak",
]);
const scanOutcomes = Object.freeze([
  "blocked",
  "clear",
  "expected-match",
  "not-applicable",
]);

function requireRecordSummary(summary) {
  if (
    summary === null ||
    typeof summary !== "object" ||
    typeof summary.recordId !== "string" ||
    !statuses.includes(summary.status) ||
    typeof summary.classification !== "string" ||
    !Array.isArray(summary.packageRoots) ||
    summary.packageRoots.some((root) => typeof root !== "string") ||
    summary.review === null ||
    typeof summary.review !== "object" ||
    typeof summary.review.decision !== "string" ||
    typeof summary.review.reviewerType !== "string" ||
    typeof summary.review.reviewerId !== "string" ||
    typeof summary.review.reviewedAt !== "string" ||
    typeof summary.review.releaseApprovalRequired !== "boolean" ||
    typeof summary.review.notes !== "string" ||
    typeof summary.destinationManifestPresent !== "boolean" ||
    typeof summary.receiptPresent !== "boolean" ||
    summary.scanOutcomes === null ||
    typeof summary.scanOutcomes !== "object" ||
    Object.keys(summary.scanOutcomes).sort().join("\n") !==
      [...scanNames].sort().join("\n") ||
    scanNames.some(
      (scanName) => !scanOutcomes.includes(summary.scanOutcomes[scanName]),
    ) ||
    (
      summary.treatmentBlocker !== null &&
      typeof summary.treatmentBlocker !== "string"
    )
  ) {
    throw new Error("Provenance review requires validated record summaries.");
  }
}

function remainingGates(summary) {
  const gates = [];
  if (summary.status !== "accepted") {
    gates.push("record-acceptance");
  }
  if (summary.review.decision !== "accepted") {
    gates.push("review-decision");
  }
  if (!summary.destinationManifestPresent) {
    gates.push("destination-manifest");
  }
  if (!summary.receiptPresent) {
    gates.push("final-receipt");
  }
  if (summary.review.releaseApprovalRequired) {
    gates.push("release-approval");
  }
  if (summary.treatmentBlocker !== null) {
    gates.push("treatment-blocker");
  }
  return Object.freeze(gates);
}

export function createProvenanceReview(recordSummaries) {
  if (!Array.isArray(recordSummaries) || recordSummaries.length === 0) {
    throw new Error("Provenance review requires at least one record summary.");
  }
  const seen = new Set();
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  const records = recordSummaries.map((summary) => {
    requireRecordSummary(summary);
    if (seen.has(summary.recordId)) {
      throw new Error(`Duplicate provenance review record ${summary.recordId}.`);
    }
    seen.add(summary.recordId);
    counts[summary.status] += 1;
    return Object.freeze({
      recordId: summary.recordId,
      status: summary.status,
      classification: summary.classification,
      packageRoots: Object.freeze([...summary.packageRoots]),
      review: Object.freeze({ ...summary.review }),
      destinationManifestPresent: summary.destinationManifestPresent,
      receiptPresent: summary.receiptPresent,
      scanOutcomes: Object.freeze({ ...summary.scanOutcomes }),
      remainingGates: remainingGates(summary),
    });
  });
  const packageRecords = records.filter(
    (record) => record.packageRoots.length > 0,
  );
  return Object.freeze({
    schemaVersion: "1.0.0",
    recordCount: records.length,
    counts: Object.freeze(counts),
    packageRecordCount: packageRecords.length,
    releasePreparationBlocked: packageRecords.some(
      (record) => record.status !== "accepted",
    ),
    records: Object.freeze(records),
  });
}

export function formatProvenanceReview(report) {
  const lines = [
    "Provenance review status",
    `Records: ${report.recordCount} total, ${report.counts.accepted} accepted, ${report.counts.draft} draft, ${report.counts.blocked} blocked`,
    `Release preparation: ${report.releasePreparationBlocked ? "blocked" : "eligible for the separate release gate"}`,
  ];
  for (const record of report.records) {
    lines.push(
      "",
      `${record.recordId}: ${record.status}, ${record.classification}`,
      `  Packages: ${record.packageRoots.join(", ") || "none"}`,
      `  Review: ${record.review.decision} by ${record.review.reviewerType}/${record.review.reviewerId} at ${record.review.reviewedAt}`,
      `  Final manifest: ${record.destinationManifestPresent ? "present" : "absent"}`,
      `  Final receipt: ${record.receiptPresent ? "present" : "absent"}`,
      `  Scans: ${scanNames.map((scanName) => `${scanName}=${record.scanOutcomes[scanName]}`).join(", ")}`,
      `  Remaining: ${record.remainingGates.join(", ") || "none"}`,
      `  Notes: ${record.review.notes}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function parseReviewArguments(argv) {
  if (argv.length === 0) {
    return Object.freeze({ json: false });
  }
  if (argv.length === 1 && argv[0] === "--json") {
    return Object.freeze({ json: true });
  }
  throw new Error("Provenance review accepts only the optional --json flag.");
}

export async function reviewProvenance({
  argv = process.argv.slice(2),
  validate = validateProvenanceDirectory,
} = {}) {
  const options = parseReviewArguments(argv);
  const validation = await validate();
  const report = createProvenanceReview(validation.recordSummaries);
  return Object.freeze({ options, report });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { options, report } = await reviewProvenance();
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatProvenanceReview(report),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : `${error}`);
    process.exitCode = 1;
  }
}
