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

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  listChangedEntries,
  pathsForRecord,
  verifyCoverage,
} from "./audit.mjs";
import {
  createRecordValidator,
  validateProvenanceDirectory,
} from "./validate.mjs";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const recordsRoot = new URL("../records/", import.meta.url);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createWorkingTreeCoverageReport(records, changedEntries) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Provenance coverage requires at least one record.");
  }
  if (!Array.isArray(changedEntries)) {
    throw new Error("Provenance coverage requires changed entries.");
  }
  const workingTreeRecords = records.filter(
    (record) => record.audit.coverageMode === "working-tree",
  );
  const baseRefs = new Set(
    workingTreeRecords.map((record) => record.batch.destinationBaseRef),
  );
  if (workingTreeRecords.length === 0 || baseRefs.size !== 1) {
    throw new Error(
      "Working-tree provenance records must share one destination base ref.",
    );
  }
  const coverage = verifyCoverage(records, changedEntries);
  const recordCoverage = workingTreeRecords
    .map((record) =>
      Object.freeze({
        recordId: record.recordId,
        selectedPathCount: pathsForRecord(record, changedEntries).length,
      })
    )
    .sort((left, right) => compareText(left.recordId, right.recordId));
  return Object.freeze({
    schemaVersion: "1.0.0",
    destinationBaseRef: [...baseRefs][0],
    changedPathCount: coverage.changedPathCount,
    uncoveredPaths: coverage.uncoveredPaths,
    workingTreeRecordCount: recordCoverage.length,
    records: Object.freeze(recordCoverage),
  });
}

async function readCommittedRecords() {
  const names = (await readdir(recordsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort(compareText);
  const validateRecord = await createRecordValidator();
  return Promise.all(
    names.map(async (name) => {
      const record = JSON.parse(
        await readFile(new URL(name, recordsRoot), "utf8"),
      );
      const validation = validateRecord(record);
      if (!validation.valid) {
        throw new Error(
          `${name} is invalid:\n${validation.errors.join("\n")}`,
        );
      }
      return record;
    }),
  );
}

export async function validateWorkingTreeProvenanceCoverage({
  destinationRoot = repositoryRoot,
  readRecords = readCommittedRecords,
  validateDirectory = validateProvenanceDirectory,
} = {}) {
  await validateDirectory();
  const records = await readRecords();
  const workingTreeRecords = records.filter(
    (record) => record.audit.coverageMode === "working-tree",
  );
  const baseRefs = new Set(
    workingTreeRecords.map((record) => record.batch.destinationBaseRef),
  );
  if (baseRefs.size !== 1) {
    throw new Error(
      "Working-tree provenance records must share one destination base ref.",
    );
  }
  const [destinationBaseRef] = baseRefs;
  const changedEntries = listChangedEntries(
    destinationRoot,
    destinationBaseRef,
  );
  return createWorkingTreeCoverageReport(records, changedEntries);
}

export function parseCoverageArguments(argv) {
  if (argv.length !== 0) {
    throw new Error("Provenance coverage accepts no arguments.");
  }
  return Object.freeze({});
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    parseCoverageArguments(process.argv.slice(2));
    const report = await validateWorkingTreeProvenanceCoverage();
    process.stdout.write(
      `Covered ${report.changedPathCount} changed path(s) with ${report.workingTreeRecordCount} working-tree provenance record(s).\n`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : `${error}`);
    process.exitCode = 1;
  }
}
