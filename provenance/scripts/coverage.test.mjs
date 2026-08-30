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
  createWorkingTreeCoverageReport,
  parseCoverageArguments,
  validateWorkingTreeProvenanceCoverage,
} from "./coverage.mjs";

const sourceLoaderRecordUrl = new URL(
  "../records/2026-07-28-publisher-source-loader.json",
  import.meta.url,
);

function record(overrides = {}) {
  return {
    recordId: "record-one",
    batch: {
      destinationBaseRef: "a".repeat(40),
      destinationPaths: ["covered/"],
    },
    audit: {
      coverageMode: "working-tree",
    },
    ...overrides,
  };
}

test("the committed working tree has complete provenance coverage", async () => {
  const report = await validateWorkingTreeProvenanceCoverage();

  assert.equal(report.schemaVersion, "1.0.0");
  assert.equal(
    report.destinationBaseRef,
    "2116921e5bf079aceff25575fa9932d2f41c05e8",
  );
  assert.ok(report.changedPathCount > 0);
  assert.deepEqual(report.uncoveredPaths, []);
  assert.equal(report.workingTreeRecordCount, 4);
  assert.deepEqual(
    report.records.map((entry) => entry.recordId),
    [
      "2026-07-28-foundation-extraction",
      "2026-07-28-publisher-source-loader",
      "2026-07-28-unicode-portability-preservation",
      "2026-08-28-supabase-provider-package",
    ],
  );
  assert.ok(report.records.every((entry) => entry.selectedPathCount > 0));
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.records), true);
});

test("release policies remain in the live source-loader scope", async () => {
  const sourceLoaderRecord = JSON.parse(
    await readFile(sourceLoaderRecordUrl, "utf8"),
  );

  for (const policyPath of ["GOVERNANCE.md", "SECURITY.md"]) {
    assert.ok(
      sourceLoaderRecord.batch.destinationPaths.includes(policyPath),
      policyPath,
    );
  }
  const policyRecord = structuredClone(sourceLoaderRecord);
  policyRecord.batch.destinationPaths = ["GOVERNANCE.md", "SECURITY.md"];
  assert.doesNotThrow(() =>
    createWorkingTreeCoverageReport(
      [policyRecord],
      [
        { path: "GOVERNANCE.md", status: "present" },
        { path: "SECURITY.md", status: "present" },
      ],
    )
  );
});

test("coverage fails closed on an uncovered path or unused scope", () => {
  assert.throws(
    () =>
      createWorkingTreeCoverageReport(
        [record()],
        [{ path: "uncovered/file.mjs", status: "present" }],
      ),
    /Changed paths lack a working-tree provenance record/u,
  );
  assert.throws(
    () =>
      createWorkingTreeCoverageReport(
        [
          record({
            batch: {
              destinationBaseRef: "a".repeat(40),
              destinationPaths: ["covered/", "unused/"],
            },
          }),
        ],
        [{ path: "covered/file.mjs", status: "present" }],
      ),
    /declares destination paths with no changed file/u,
  );
});

test("coverage requires one shared base and accepts no arguments", () => {
  assert.throws(
    () => createWorkingTreeCoverageReport([], []),
    /at least one record/u,
  );
  assert.throws(
    () =>
      createWorkingTreeCoverageReport(
        [
          record(),
          record({
            recordId: "record-two",
            batch: {
              destinationBaseRef: "b".repeat(40),
              destinationPaths: ["other/"],
            },
          }),
        ],
        [
          { path: "covered/file.mjs", status: "present" },
          { path: "other/file.mjs", status: "present" },
        ],
      ),
    /share one destination base ref/u,
  );
  assert.deepEqual(parseCoverageArguments([]), {});
  assert.throws(
    () => parseCoverageArguments(["--json"]),
    /accepts no arguments/u,
  );
});
