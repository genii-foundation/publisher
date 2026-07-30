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

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  createScannerIdentity,
} from "./scanner-identity.mjs";
import {
  createStableClaimsDigest,
} from "./stable-claims.mjs";
import {
  resolveExactNpmInvocation,
  verifyPreparedPackageArchives,
} from "./package-artifacts.mjs";

// The scanner identity attests the implementation that ran, which lives beside
// this file rather than inside whichever repository is being validated.
const scannerRepositoryRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);

const defaultSchemaUrl = new URL("../record.schema.json", import.meta.url);
const defaultReceiptSchemaUrl = new URL(
  "../receipt.schema.json",
  import.meta.url,
);
const defaultRecordsUrl = new URL("../records/", import.meta.url);
const scanNames = [
  "exactBlob",
  "normalizedLine",
  "tokenShingle",
  "ccPhrase",
  "packageLeak",
];
const declaredBinaryDocumentPattern =
  /\.(?:7z|aiff?|avif|bmp|bz2|eot|flac|gif|gz|ico|jpe?g|m4a|mov|mp3|mp4|ogg|otf|pdf|png|rar|tar|tiff?|ttf|wav|wasm|webm|webp|woff2?|xz|zip)$/iu;

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function addDuplicateErrors(errors, values, location) {
  const seen = new Set();

  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`${location} contains duplicate value ${JSON.stringify(value)}`);
    }
    seen.add(value);
  }
}

export function validateRecordSemantics(record) {
  const errors = [];
  const repositoryEvidenceGroups = [
    ["auditedSource", record.auditedSource],
    ["specifications", record.specifications],
    ...record.additionalSources
      .filter((source) => source.kind === "git")
      .map((source, index) => [
        `additionalSources[${index}]`,
        source,
      ]),
  ];

  for (const [evidenceGroupName, evidenceGroup] of repositoryEvidenceGroups) {
    const evidencePaths = evidenceGroup.evidence.map((item) => item.path);

    addDuplicateErrors(errors, evidencePaths, `${evidenceGroupName}.evidence`);

    for (const [index, evidence] of evidenceGroup.evidence.entries()) {
      if (evidence.lineEnd < evidence.lineStart) {
        errors.push(
          `${evidenceGroupName}.evidence[${index}].lineEnd must be greater than or equal to lineStart`,
        );
      }
    }
  }

  addDuplicateErrors(
    errors,
    record.additionalSources.map((source) =>
      source.kind === "git"
        ? `git:${source.repository}@${source.ref}`
        : `artifact:${source.url}@${source.version}`,
    ),
    "additionalSources",
  );

  addDuplicateErrors(
    errors,
    record.batch.destinationPaths,
    "batch.destinationPaths",
  );
  addDuplicateErrors(
    errors,
    record.audit.installedInputs.map(
      (input) => input.installedPath,
    ),
    "audit.installedInputs installed paths",
  );
  addDuplicateErrors(
    errors,
    record.audit.installedInputs.map(
      (input) =>
        `${input.sourceRepository}@${input.sourceRef}:${input.sourcePath}`,
    ),
    "audit.installedInputs source identities",
  );
  const gitEvidence = new Set(
    repositoryEvidenceGroups.flatMap(([, source]) =>
      source.evidence.map(
        (evidence) =>
          `${source.repository}@${source.ref}:${evidence.path}`,
      )
    ),
  );
  for (const [index, input] of
    record.audit.installedInputs.entries()) {
    const identity =
      `${input.sourceRepository}@${input.sourceRef}:${input.sourcePath}`;
    if (!gitEvidence.has(identity)) {
      errors.push(
        `audit.installedInputs[${index}] must map to declared Git evidence`,
      );
    }
  }

  for (const scanName of scanNames) {
    const scan = record.scans[scanName];

    if (
      (scan.outcome === "clear" || scan.outcome === "not-applicable") &&
      scan.matchCount !== 0
    ) {
      errors.push(
        `scans.${scanName}.matchCount must be 0 when outcome is ${scan.outcome}`,
      );
    }

    if (scan.outcome === "expected-match" && scan.matchCount < 1) {
      errors.push(
        `scans.${scanName}.matchCount must be at least 1 when outcome is expected-match`,
      );
    }

    if (record.status === "accepted" && scan.outcome === "blocked") {
      errors.push(
        `scans.${scanName}.outcome cannot be blocked for an accepted record`,
      );
    }

    if (
      record.status === "accepted" &&
      record.classification === "fresh-cpal"
    ) {
      const expectedOutcome =
        (
          scanName === "ccPhrase" &&
          record.audit.ccSourcePaths.length === 0
        ) ||
        (
          scanName === "packageLeak" &&
          record.audit.packageRoots.length === 0
        )
          ? "not-applicable"
          : "clear";
      if (
        scan.outcome !== expectedOutcome ||
        scan.matchCount !== 0
      ) {
        errors.push(
          `scans.${scanName} must be ${expectedOutcome} with 0 matches for fresh-cpal`,
        );
      }
    }
  }

  if (
    record.status === "accepted" &&
    record.audit.packageRoots.length > 0 &&
    (record.scans.packageLeak.outcome !== "clear" ||
      record.scans.packageLeak.matchCount !== 0)
  ) {
    errors.push(
      "scans.packageLeak must be clear with 0 matches when publishable packages are audited",
    );
  }

  if (record.status === "accepted" && record.review.decision !== "accepted") {
    errors.push(
      "review.decision must be accepted when status is accepted",
    );
  }

  if (
    record.status === "accepted" &&
    (record.audit.destinationManifest === null ||
      record.audit.receipt === null)
  ) {
    errors.push(
      "accepted records require an immutable destination manifest and receipt",
    );
  }
  if (
    record.audit.destinationManifest !== null &&
    record.audit.destinationManifest.deletedCount >
      record.audit.destinationManifest.entryCount
  ) {
    errors.push(
      "audit.destinationManifest.deletedCount cannot exceed entryCount",
    );
  }

  if (record.status === "draft") {
    if (record.review.decision !== "pending") {
      errors.push("review.decision must be pending when status is draft");
    }
    if (
      record.audit.destinationManifest !== null ||
      record.audit.receipt !== null
    ) {
      errors.push(
        "draft records must not claim a final destination manifest or receipt",
      );
    }
  }

  if (
    record.status === "blocked" &&
    (record.classification !== "blocked" ||
      record.treatment.blocker === null)
  ) {
    errors.push(
      "blocked status requires blocked classification and a treatment blocker",
    );
  }

  if (
    record.classification === "blocked" &&
    record.status !== "blocked"
  ) {
    errors.push("blocked classification requires blocked status");
  }

  if (
    record.classification === "relicensed-cpal" &&
    record.treatment.rightsDocument === null
  ) {
    errors.push(
      "treatment.rightsDocument is required for relicensed-cpal",
    );
  }

  for (const [name, outcome] of Object.entries(record.documentation)) {
    if (outcome.status === "updated" && outcome.paths.length === 0) {
      errors.push(
        `documentation.${name}.paths must identify an updated file`,
      );
    }

    if (outcome.status === "not-needed" && outcome.paths.length !== 0) {
      errors.push(
        `documentation.${name}.paths must be empty when no update was needed`,
      );
    }
  }

  return errors;
}

export function formatSchemaErrors(schemaErrors = []) {
  return schemaErrors.map((error) => {
    const location = error.instancePath || "/";
    return `${location} ${error.message}`;
  });
}

export function validateReceiptSemantics(receipt) {
  const errors = [];
  const manifestEntries = receipt.destinationManifest.entries;

  if (
    receipt.destinationManifest.entryCount !==
    manifestEntries.length
  ) {
    errors.push(
      "destinationManifest.entryCount must equal destinationManifest.entries.length",
    );
  }
  const deletedCount = manifestEntries.filter(
    (entry) => entry.status === "deleted",
  ).length;
  if (receipt.destinationManifest.deletedCount !== deletedCount) {
    errors.push(
      "destinationManifest.deletedCount must equal the number of deleted entries",
    );
  }

  const manifestPaths = manifestEntries.map((entry) => entry.path);
  addDuplicateErrors(
    errors,
    manifestPaths,
    "destinationManifest.entries",
  );
  const sortedManifestPaths = [...manifestPaths].sort();
  if (
    manifestPaths.some(
      (filePath, index) => filePath !== sortedManifestPaths[index],
    )
  ) {
    errors.push(
      "destinationManifest.entries must be sorted by repository path",
    );
  }

  const serializedManifest = manifestEntries
    .map((entry) =>
      entry.status === "present"
        ? `P ${entry.sha256.slice("sha256:".length)}  ${entry.path}\n`
        : `D -  ${entry.path}\n`,
    )
    .join("");
  if (
    receipt.destinationManifest.sha256 !==
    sha256(serializedManifest)
  ) {
    errors.push(
      "destinationManifest.sha256 does not match its path and content-hash entries",
    );
  }

  addDuplicateErrors(
    errors,
    receipt.installedInputs.map(
      (input) => input.installedPath,
    ),
    "installedInputs installed paths",
  );
  const sortedInstalledPaths = receipt.installedInputs
    .map((input) => input.installedPath)
    .sort();
  if (
    receipt.installedInputs.some(
      (input, index) =>
        input.installedPath !== sortedInstalledPaths[index],
    )
  ) {
    errors.push("installedInputs must be sorted by installedPath");
  }

  addDuplicateErrors(
    errors,
    receipt.scanExclusions.map((exclusion) => exclusion.document),
    "scanExclusions",
  );
  const sortedExclusionDocuments = receipt.scanExclusions
    .map((exclusion) => exclusion.document)
    .sort();
  if (
    receipt.scanExclusions.some(
      (exclusion, index) =>
        exclusion.document !== sortedExclusionDocuments[index],
    )
  ) {
    errors.push("scanExclusions must be sorted by document");
  }
  for (const [index, exclusion] of
    receipt.scanExclusions.entries()) {
    if (!declaredBinaryDocumentPattern.test(exclusion.document)) {
      errors.push(
        `scanExclusions[${index}].document is not a declared binary file type`,
      );
    }
    const sortedScans = [...exclusion.scans].sort();
    if (
      exclusion.scans.some(
        (scan, scanIndex) => scan !== sortedScans[scanIndex],
      )
    ) {
      errors.push(
        `scanExclusions[${index}].scans must be sorted`,
      );
    }
  }

  for (const [index, source] of receipt.sources.entries()) {
    if (source.verified && source.evidence.length === 0) {
      errors.push(
        `sources[${index}].evidence must not be empty when verified is true`,
      );
    }
    if (!source.verified && source.evidence.length !== 0) {
      errors.push(
        `sources[${index}].evidence must be empty when verified is false`,
      );
    }
    addDuplicateErrors(
      errors,
      source.evidence.map((item) => item.path),
      `sources[${index}].evidence`,
    );
  }
  addDuplicateErrors(
    errors,
    receipt.sources.map(
      (source) =>
        `${source.kind}:${source.source}@${source.identity}`,
    ),
    "sources",
  );

  for (const scanName of scanNames) {
    const scan = receipt.scans[scanName];
    if (scan.matchCount !== scan.matches.length) {
      errors.push(
        `scans.${scanName}.matchCount must equal matches.length`,
      );
    }
    if (
      (scan.outcome === "clear" ||
        scan.outcome === "not-applicable") &&
      scan.matchCount !== 0
    ) {
      errors.push(
        `scans.${scanName}.matchCount must be 0 when outcome is ${scan.outcome}`,
      );
    }
    if (
      scan.outcome === "expected-match" &&
      scan.matchCount === 0
    ) {
      errors.push(
        `scans.${scanName}.matchCount must be at least 1 when outcome is expected-match`,
      );
    }
  }

  // The scanner identity's composite digest is computed over its sorted
  // component list, so an unsorted, short, or duplicated list cannot reproduce
  // the digest it claims.
  if (
    receipt.scanner.fileCount !== receipt.scanner.files.length
  ) {
    errors.push(
      "scanner.fileCount must equal scanner.files.length",
    );
  }
  addDuplicateErrors(
    errors,
    receipt.scanner.files.map((entry) => entry.path),
    "scanner.files",
  );
  const sortedScannerPaths = receipt.scanner.files
    .map((entry) => entry.path)
    .sort();
  if (
    receipt.scanner.files.some(
      (entry, index) =>
        entry.path !== sortedScannerPaths[index],
    )
  ) {
    errors.push("scanner.files must be sorted by path");
  }

  addDuplicateErrors(
    errors,
    receipt.packageArchives.map((archive) => archive.root),
    "packageArchives",
  );
  for (const [index, archive] of receipt.packageArchives.entries()) {
    if (archive.fileCount !== archive.files.length) {
      errors.push(
        `packageArchives[${index}].fileCount must equal files.length`,
      );
    }
    addDuplicateErrors(
      errors,
      archive.files,
      `packageArchives[${index}].files`,
    );
    const sortedFiles = [...archive.files].sort();
    if (
      archive.files.some(
        (filePath, fileIndex) =>
          filePath !== sortedFiles[fileIndex],
      )
    ) {
      errors.push(
        `packageArchives[${index}].files must be sorted`,
      );
    }
  }

  return errors;
}

export async function createRecordValidator({
  schemaUrl = defaultSchemaUrl,
} = {}) {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);

  return (record) => {
    if (!validateSchema(record)) {
      return {
        valid: false,
        errors: formatSchemaErrors(validateSchema.errors),
      };
    }

    const errors = validateRecordSemantics(record);
    return {
      valid: errors.length === 0,
      errors,
    };
  };
}

export async function createReceiptValidator({
  schemaUrl = defaultReceiptSchemaUrl,
} = {}) {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);

  return (receipt) => {
    if (!validateSchema(receipt)) {
      return {
        valid: false,
        errors: formatSchemaErrors(validateSchema.errors),
      };
    }
    const errors = validateReceiptSemantics(receipt);
    return {
      valid: errors.length === 0,
      errors,
    };
  };
}

function compareReceiptToRecord(record, receipt) {
  const errors = [];
  if (receipt.recordId !== record.recordId) {
    errors.push(
      `receipt recordId ${JSON.stringify(receipt.recordId)} does not match ${JSON.stringify(record.recordId)}`,
    );
  }
  if (receipt.destinationBaseRef !== record.batch.destinationBaseRef) {
    errors.push("receipt destinationBaseRef does not match the record");
  }
  if (receipt.performedAt !== record.scans.performedAt) {
    errors.push("receipt performedAt does not match scans.performedAt");
  }
  if (
    receipt.destinationManifest.algorithm !==
      record.audit.destinationManifest.algorithm ||
    receipt.destinationManifest.entryCount !==
      record.audit.destinationManifest.entryCount ||
    receipt.destinationManifest.deletedCount !==
      record.audit.destinationManifest.deletedCount ||
    receipt.destinationManifest.sha256 !==
      record.audit.destinationManifest.sha256
  ) {
    errors.push("receipt destination manifest does not match the record");
  }
  const expectedStableClaims = createStableClaimsDigest(record);
  if (
    receipt.stableClaims.algorithm !==
      expectedStableClaims.algorithm ||
    receipt.stableClaims.sha256 !== expectedStableClaims.sha256
  ) {
    errors.push(
      "receipt stableClaims digest does not match the record",
    );
  }
  for (const scanName of scanNames) {
    const recorded = record.scans[scanName];
    const received = receipt.scans[scanName];
    if (
      received.outcome !== recorded.outcome ||
      received.matchCount !== recorded.matchCount
    ) {
      errors.push(
        `receipt scans.${scanName} does not match the record outcome`,
      );
    }
  }

  const expectedSources = [
    {
      kind: "git",
      source: record.auditedSource.repository,
      identity: record.auditedSource.ref,
      evidence: record.auditedSource.evidence,
    },
    ...record.additionalSources.map((source) =>
      source.kind === "git"
        ? {
            kind: "git",
            source: source.repository,
            identity: source.ref,
            evidence: source.evidence,
          }
        : {
            kind: "artifact",
            source: source.url,
            identity: source.version,
            evidence: [
              {
                path: source.url,
                sha256: source.sha256,
                lineStart: 1,
              },
            ],
          }
    ),
    {
      kind: "git",
      source: record.specifications.repository,
      identity: record.specifications.ref,
      evidence: record.specifications.evidence,
    },
  ];
  if (receipt.sources.length !== expectedSources.length) {
    errors.push("receipt sources do not match the record source set");
  } else {
    for (const [index, expected] of expectedSources.entries()) {
      const received = receipt.sources[index];
      if (
        received.kind !== expected.kind ||
        received.source !== expected.source ||
        received.identity !== expected.identity
      ) {
        errors.push(
          `receipt sources[${index}] does not match the record source set`,
        );
      }
      if (received.evidence.length !== expected.evidence.length) {
        errors.push(
          `receipt sources[${index}].evidence does not match the record`,
        );
      } else {
        for (const [
          evidenceIndex,
          expectedEvidence,
        ] of expected.evidence.entries()) {
          const receivedEvidence =
            received.evidence[evidenceIndex];
          if (
            receivedEvidence.path !== expectedEvidence.path ||
            receivedEvidence.sha256 !== expectedEvidence.sha256 ||
            receivedEvidence.lineStart !==
              expectedEvidence.lineStart ||
            (
              expected.kind === "git" &&
              receivedEvidence.lineEnd !==
                expectedEvidence.lineEnd
            )
          ) {
            errors.push(
              `receipt sources[${index}].evidence[${evidenceIndex}] does not match the record`,
            );
          }
        }
      }
    }
  }

  if (receipt.sources.some((source) => !source.verified)) {
    errors.push("accepted record receipts require every source to be verified");
  }

  const expectedCommands = record.audit.verificationCommands.map(
    (command) => command.argv,
  );
  if (receipt.verificationCommands.length !== expectedCommands.length) {
    errors.push(
      "receipt verificationCommands do not match the record",
    );
  } else {
    for (const [index, expectedArgv] of expectedCommands.entries()) {
      const received = receipt.verificationCommands[index];
      if (
        received.argv.length !== expectedArgv.length ||
        received.argv.some(
          (argument, argumentIndex) =>
            argument !== expectedArgv[argumentIndex],
        )
      ) {
        errors.push(
          `receipt verificationCommands[${index}] does not match the record`,
        );
      }
    }
  }
  if (
    receipt.verificationCommands.some(
      (command) => command.exitCode !== 0,
    )
  ) {
    errors.push(
      "accepted record receipts require every verification command to pass",
    );
  }

  const expectedInstalledInputs = [...record.audit.installedInputs]
    .sort((left, right) =>
      left.installedPath.localeCompare(right.installedPath)
    );
  const installedEvidenceHashes = new Map(
    [
      record.auditedSource,
      ...record.additionalSources.filter(
        (source) => source.kind === "git",
      ),
      record.specifications,
    ].flatMap((source) =>
      source.evidence.map((evidence) => [
        `${source.repository}@${source.ref}:${evidence.path}`,
        evidence.sha256,
      ])
    ),
  );
  if (
    receipt.installedInputs.length !==
    expectedInstalledInputs.length
  ) {
    errors.push(
      "receipt installedInputs do not match audit.installedInputs",
    );
  } else {
    for (const [index, expected] of
      expectedInstalledInputs.entries()) {
      const received = receipt.installedInputs[index];
      if (
        received.installedPath !== expected.installedPath ||
        received.sourceRepository !==
          expected.sourceRepository ||
        received.sourceRef !== expected.sourceRef ||
        received.sourcePath !== expected.sourcePath ||
        received.sha256 !==
          installedEvidenceHashes.get(
            `${expected.sourceRepository}@${expected.sourceRef}:${expected.sourcePath}`,
          )
      ) {
        errors.push(
          `receipt installedInputs[${index}] does not match the record`,
        );
      }
    }
  }

  const expectedPackageRoots = [...record.audit.packageRoots].sort();
  const receivedPackageRoots = receipt.packageArchives
    .map((archive) => archive.root)
    .sort();
  if (
    expectedPackageRoots.length !== receivedPackageRoots.length ||
    expectedPackageRoots.some(
      (packageRoot, index) =>
        packageRoot !== receivedPackageRoots[index],
    )
  ) {
    errors.push(
      "receipt packageArchives do not match audit.packageRoots",
    );
  }
  return errors;
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function validateLiveWorkingRecords({
  records,
  repositoryRootUrl,
  releaseMode,
  preparedPackageArchives,
  failures,
}) {
  const packageRecords = records.filter(
    ({ record, valid }) =>
      valid && record.audit.packageRoots.length > 0,
  );
  const workingRecords = records.filter(
    ({ record, valid }) =>
      valid && record.audit.coverageMode === "working-tree",
  );
  if (releaseMode && workingRecords.length === 0) {
    failures.push(
      "release mode requires at least one working-tree provenance record",
    );
    return;
  }
  if (releaseMode) {
    for (const { recordName, record } of packageRecords) {
      if (record.status !== "accepted") {
        failures.push(
          `${recordName}: release mode requires every package-affecting provenance record to be accepted, found ${record.status} ${record.audit.coverageMode} record`,
        );
      }
    }
  }
  const acceptedRecords = workingRecords.filter(
    ({ record, receipt, receiptValid }) =>
      record.status === "accepted" &&
      receipt !== undefined &&
      receiptValid,
  );
  const repositoryRoot = fileURLToPath(repositoryRootUrl);
  let releaseNpmInvocation;
  let verifiedReleaseArchives;
  if (releaseMode) {
    if (!(preparedPackageArchives instanceof Map)) {
      failures.push(
        "release mode requires the exact prepared package archive map",
      );
      return;
    }
    const expectedPackageRoots = [
      ...new Set(
        workingRecords.flatMap(
          ({ record }) => record.audit.packageRoots,
        ),
      ),
    ].sort();
    try {
      releaseNpmInvocation =
        resolveExactNpmInvocation({
          repositoryRoot,
        });
      verifiedReleaseArchives =
        await verifyPreparedPackageArchives({
          repositoryRoot,
          expectedPackageRoots,
          npmInvocation: releaseNpmInvocation,
          prepared: preparedPackageArchives,
        });
    } catch (error) {
      failures.push(
        `release package candidates are invalid: ${error.message}`,
      );
      return;
    }
  }
  if (acceptedRecords.length === 0) {
    return;
  }

  const {
    auditPackages,
    createDestinationManifest,
    listChangedEntries,
    pathsForRecord,
    sha256: auditSha256,
    verifyCoverage,
    verifyInstalledInputs,
  } = await import("./audit.mjs");
  const byBaseRef = new Map();
  for (const item of acceptedRecords) {
    const baseRef = item.record.batch.destinationBaseRef;
    const group = byBaseRef.get(baseRef) ?? [];
    group.push(item);
    byBaseRef.set(baseRef, group);
  }

  for (const [baseRef, acceptedGroup] of byBaseRef) {
    let changedEntries;
    try {
      changedEntries = listChangedEntries(
        repositoryRoot,
        baseRef,
      );
      const coverageRecords = workingRecords
        .filter(
          ({ record }) =>
            record.batch.destinationBaseRef === baseRef &&
            (!releaseMode || record.status === "accepted"),
        )
        .map(({ record }) => record);
      verifyCoverage(coverageRecords, changedEntries);
    } catch (error) {
      failures.push(
        `live working-tree coverage for ${baseRef}: ${error.message}`,
      );
      continue;
    }

    for (const {
      recordName,
      record,
      receipt,
    } of acceptedGroup) {
      let selectedEntries;
      let liveManifest;
      try {
        selectedEntries = pathsForRecord(
          record,
          changedEntries,
        );
        if (selectedEntries.length === 0) {
          throw new Error(
            "accepted working-tree manifest cannot be empty",
          );
        }
        liveManifest = createDestinationManifest(
          repositoryRoot,
          selectedEntries,
        );
      } catch (error) {
        failures.push(
          `${recordName}: live destination manifest: ${error.message}`,
        );
        continue;
      }
      if (!equalJson(liveManifest, receipt.destinationManifest)) {
        failures.push(
          `${recordName}: receipt destination manifest is stale relative to the current Git diff`,
        );
      }
      const summary = {
        algorithm: liveManifest.algorithm,
        entryCount: liveManifest.entryCount,
        deletedCount: liveManifest.deletedCount,
        sha256: liveManifest.sha256,
      };
      if (!equalJson(summary, record.audit.destinationManifest)) {
        failures.push(
          `${recordName}: record destination manifest is stale relative to the current Git diff`,
        );
      }
      try {
        const selectedPathSet = new Set(
          selectedEntries.map((entry) => entry.path),
        );
        const expectedDestinationExclusions = [];
        for (const entry of selectedEntries) {
          if (
            entry.status !== "present" ||
            !declaredBinaryDocumentPattern.test(entry.path)
          ) {
            continue;
          }
          const scans = [
            "normalizedLine",
          ];
          if (record.audit.ccSourcePaths.length > 0) {
            scans.push("ccPhrase");
          }
          scans.sort();
          expectedDestinationExclusions.push({
            document: entry.path,
            sha256: sha256(
              await readFile(
                resolve(repositoryRoot, entry.path),
              ),
            ),
            reason: "declared-binary-file-type",
            scans,
          });
        }
        expectedDestinationExclusions.sort((left, right) =>
          left.document.localeCompare(right.document)
        );
        const recordedDestinationExclusions =
          receipt.scanExclusions.filter((exclusion) =>
            selectedPathSet.has(exclusion.document)
          );
        if (
          !equalJson(
            expectedDestinationExclusions,
            recordedDestinationExclusions,
          )
        ) {
          failures.push(
            `${recordName}: current destination scan exclusions do not match the receipt`,
          );
        }
      } catch (error) {
        failures.push(
          `${recordName}: could not verify current destination scan exclusions: ${error.message}`,
        );
      }

      try {
        // Recomputed against the running scanner, not the audited repository.
        // The receipt claims which implementation produced it, so the check is
        // whether that implementation is still the one installed here.
        const currentScanner = createScannerIdentity({
          repositoryRoot: scannerRepositoryRoot,
        });
        if (
          receipt.scanner.algorithm !==
            currentScanner.algorithm ||
          receipt.scanner.sha256 !== currentScanner.sha256 ||
          receipt.scanner.fileCount !==
            currentScanner.fileCount ||
          !equalJson(
            receipt.scanner.files,
            currentScanner.files,
          )
        ) {
          failures.push(
            `${recordName}: receipt scanner identity does not match the current scanner runtime closure`,
          );
        }
      } catch (error) {
        failures.push(
          `${recordName}: could not verify the current scanner runtime closure: ${error.message}`,
        );
      }

      try {
        const packages = await auditPackages(
          repositoryRoot,
          record.audit.packageRoots,
          record.audit.forbiddenPackagePatterns,
          undefined,
          {
            npmInvocation: releaseNpmInvocation,
            preparedPackageArchives:
              verifiedReleaseArchives,
          },
        );
        if (
          !equalJson(
            packages.archives,
            receipt.packageArchives,
          )
        ) {
          failures.push(
            `${recordName}: packed package archives are stale relative to the current package contents`,
          );
        }
        if (
          !equalJson(
            packages.result,
            receipt.scans.packageLeak,
          )
        ) {
          failures.push(
            `${recordName}: current package leak result does not match the receipt`,
          );
        }
        const recordedPackageExclusions =
          receipt.scanExclusions.filter((exclusion) =>
            exclusion.scans.includes("packageLeak")
          );
        if (
          !equalJson(
            packages.scanExclusions,
            recordedPackageExclusions,
          )
        ) {
          failures.push(
            `${recordName}: current packed-package scan exclusions do not match the receipt`,
          );
        }
      } catch (error) {
        failures.push(
          `${recordName}: could not audit current package archives: ${error.message}`,
        );
      }

      try {
        const installedInputs = verifyInstalledInputs(
          record,
          repositoryRoot,
        );
        if (
          !equalJson(
            installedInputs,
            receipt.installedInputs,
          )
        ) {
          failures.push(
            `${recordName}: installed inputs are stale relative to the receipt`,
          );
        }
      } catch (error) {
        failures.push(
          `${recordName}: could not verify installed inputs: ${error.message}`,
        );
      }
    }
  }
}

export async function validateProvenanceDirectory({
  recordsUrl = defaultRecordsUrl,
  schemaUrl = defaultSchemaUrl,
  receiptSchemaUrl = defaultReceiptSchemaUrl,
  repositoryRootUrl,
  releaseMode = false,
  preparedPackageArchives,
} = {}) {
  const resolvedRepositoryRootUrl =
    repositoryRootUrl ?? new URL("../../", recordsUrl);
  const validateRecord = await createRecordValidator({ schemaUrl });
  const validateReceipt = await createReceiptValidator({
    schemaUrl: receiptSchemaUrl,
  });
  const entries = await readdir(recordsUrl, { withFileTypes: true });
  const recordNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  if (recordNames.length === 0) {
    throw new Error("No provenance records found.");
  }

  const failures = [];
  const recordIds = new Set();
  const records = [];

  for (const recordName of recordNames) {
    let record;

    try {
      record = JSON.parse(
        await readFile(new URL(recordName, recordsUrl), "utf8"),
      );
    } catch (error) {
      failures.push(`${recordName}: invalid JSON: ${error.message}`);
      continue;
    }

    const result = validateRecord(record);
    for (const error of result.errors) {
      failures.push(`${recordName}: ${error}`);
    }

    if (`${record.recordId}.json` !== recordName) {
      failures.push(
        `${recordName}: filename must equal recordId plus .json`,
      );
    }

    if (recordIds.has(record.recordId)) {
      failures.push(`${recordName}: duplicate recordId ${record.recordId}`);
    }
    recordIds.add(record.recordId);
    const recordState = {
      record,
      recordName,
      valid: result.valid,
      receipt: undefined,
      receiptValid: false,
    };
    records.push(recordState);

    if (result.valid && record.audit.receipt !== null) {
      const receiptUrl = new URL(
        record.audit.receipt.path,
        resolvedRepositoryRootUrl,
      );
      let receiptBytes;
      let receipt;
      try {
        receiptBytes = await readFile(receiptUrl);
        receipt = JSON.parse(receiptBytes.toString("utf8"));
      } catch (error) {
        failures.push(
          `${recordName}: could not read receipt ${record.audit.receipt.path}: ${error.message}`,
        );
        continue;
      }

      const actualReceiptHash = sha256(receiptBytes);
      if (actualReceiptHash !== record.audit.receipt.sha256) {
        failures.push(
          `${recordName}: receipt hash ${actualReceiptHash} does not match ${record.audit.receipt.sha256}`,
        );
      }

      const receiptResult = validateReceipt(receipt);
      recordState.receipt = receipt;
      recordState.receiptValid = receiptResult.valid;
      for (const error of receiptResult.errors) {
        failures.push(
          `${recordName}: receipt ${record.audit.receipt.path}: ${error}`,
        );
      }
      if (receiptResult.valid) {
        const comparisonErrors = compareReceiptToRecord(
          record,
          receipt,
        );
        if (comparisonErrors.length > 0) {
          recordState.receiptValid = false;
        }
        for (const error of comparisonErrors) {
          failures.push(
            `${recordName}: receipt ${record.audit.receipt.path}: ${error}`,
          );
        }
      }
    }
  }

  await validateLiveWorkingRecords({
    records,
    repositoryRootUrl: resolvedRepositoryRootUrl,
    releaseMode,
    preparedPackageArchives,
    failures,
  });

  if (failures.length > 0) {
    throw new Error(`Provenance validation failed:\n${failures.join("\n")}`);
  }

  return {
    count: recordNames.length,
    recordNames,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await validateProvenanceDirectory();
    console.log(`Validated ${result.count} provenance record(s).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
