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
import {
  execFileSync,
  spawnSync,
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  auditPackages,
  createDestinationManifest,
  listChangedEntries,
  sha256,
} from "./audit.mjs";
import {
  createScannerIdentity,
} from "./scanner-identity.mjs";
import {
  createStableClaimsDigest,
} from "./stable-claims.mjs";
import {
  preparePackageArchives,
  resolveExactNpmInvocation,
} from "./package-artifacts.mjs";
import {
  createReceiptValidator,
  createRecordValidator,
  validateProvenanceDirectory,
} from "./validate.mjs";

const foundationRecordUrl = new URL(
  "../records/2026-07-28-foundation-extraction.json",
  import.meta.url,
);
const sourceLoaderRecordUrl = new URL(
  "../records/2026-07-28-publisher-source-loader.json",
  import.meta.url,
);
const unicodeRecordUrl = new URL(
  "../records/2026-07-28-unicode-portability-preservation.json",
  import.meta.url,
);
const foundationRecord = JSON.parse(
  await readFile(foundationRecordUrl, "utf8"),
);
const sourceLoaderRecord = JSON.parse(
  await readFile(sourceLoaderRecordUrl, "utf8"),
);
const unicodeRecord = JSON.parse(
  await readFile(unicodeRecordUrl, "utf8"),
);
const validateRecord = await createRecordValidator();
const validateReceipt = await createReceiptValidator();
const repositoryRoot = fileURLToPath(
  new URL("../../", import.meta.url),
);
// The scanner identity attests the implementation that ran, so it is always
// computed from where the scanner lives, never from an audited temporary root.
const scannerRepositoryRoot = repositoryRoot;

function validate(record) {
  return validateRecord(structuredClone(record));
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function runGit(repositoryRoot, arguments_) {
  return execFileSync(
    "git",
    ["-C", repositoryRoot, ...arguments_],
    { encoding: "utf8" },
  ).trim();
}

function acceptedFreshRecord() {
  const record = structuredClone(sourceLoaderRecord);
  record.status = "accepted";
  record.review.decision = "accepted";
  record.audit.destinationManifest = {
    algorithm: "sha256-path-state-content-v2",
    entryCount: 1,
    deletedCount: 0,
    sha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  record.audit.receipt = {
    path: "provenance/receipts/example.json",
    sha256:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
  for (const scan of Object.values(record.scans)) {
    if (scan !== record.scans.scope && typeof scan === "object") {
      scan.outcome = "clear";
      scan.matchCount = 0;
    }
  }
  return record;
}

function emptyReceipt() {
  const manifestEntry = {
    path: "example.txt",
    status: "present",
    sha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const manifestHash = hash(
    `P ${manifestEntry.sha256.slice("sha256:".length)}  ${manifestEntry.path}\n`,
  );
  const source = (repository, ref) => ({
    kind: "git",
    source: repository,
    identity: ref,
    verified: true,
    evidence: [
      {
        path: "README.md",
        sha256:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        lineStart: 1,
        lineEnd: 1,
      },
    ],
  });
  return {
    $schema:
      "https://publisher.genii.foundation/schemas/provenance-receipt-1.2.0.schema.json",
    schemaVersion: "1.2.0",
    recordId: "2026-07-28-example-receipt",
    performedAt: "2026-07-28T20:32:06Z",
    destinationBaseRef:
      "2116921e5bf079aceff25575fa9932d2f41c05e8",
    destinationManifest: {
      algorithm: "sha256-path-state-content-v2",
      entryCount: 1,
      deletedCount: 0,
      sha256: manifestHash,
      entries: [
        manifestEntry,
      ],
    },
    stableClaims: {
      algorithm: "sha256-canonical-json-v1",
      sha256:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    },
    scanner: {
      algorithm: "sha256-scanner-runtime-closure-v1",
      fileCount: 2,
      files: [
        {
          path: "provenance/scripts/archive-reader.mjs",
          sha256:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        {
          path: "provenance/scripts/audit.mjs",
          sha256:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
      sha256:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    sources: [
      source(
        "https://github.com/genii-foundation/coherence-thesis",
        "d000fe50882c4664f96dccdea38b4b370dfb368d",
      ),
      source(
        "https://github.com/genii-foundation/publisher",
        "2116921e5bf079aceff25575fa9932d2f41c05e8",
      ),
    ],
    scans: Object.fromEntries(
      [
        "exactBlob",
        "normalizedLine",
        "tokenShingle",
        "ccPhrase",
        "packageLeak",
      ].map((name) => [
        name,
        {
          outcome: "clear",
          matchCount: 0,
          matches: [],
        },
      ]),
    ),
    verificationCommands: [],
    packageArchives: [],
    installedInputs: [],
    scanExclusions: [],
  };
}

test("the committed provenance directory is valid", async () => {
  const result = await validateProvenanceDirectory();

  assert.equal(result.count, 3);
  assert.deepEqual(result.recordNames, [
    "2026-07-28-foundation-extraction.json",
    "2026-07-28-publisher-source-loader.json",
    "2026-07-28-unicode-portability-preservation.json",
  ]);
});

test("release mode requires exact candidates, rejects every package-affecting draft, and guards directory publication", async () => {
  await assert.rejects(
    validateProvenanceDirectory({
      releaseMode: true,
    }),
    (error) => {
      assert.match(
        error.message,
        /release mode requires every package-affecting provenance record to be accepted/u,
      );
      assert.match(
        error.message,
        /2026-07-28-foundation-extraction\.json:.*found draft historical record/u,
      );
      assert.match(
        error.message,
        /requires the exact prepared package archive map/u,
      );
      return true;
    },
  );
  const packageManifestUrls = [
    new URL("../../schemas/package.json", import.meta.url),
    new URL(
      "../../packages/content/package.json",
      import.meta.url,
    ),
    new URL(
      "../../packages/next/package.json",
      import.meta.url,
    ),
    new URL(
      "../../packages/reader/package.json",
      import.meta.url,
    ),
    new URL(
      "../../packages/publisher/package.json",
      import.meta.url,
    ),
  ];
  for (const manifestUrl of packageManifestUrls) {
    const manifest = JSON.parse(
      await readFile(manifestUrl, "utf8"),
    );
    assert.match(
      manifest.scripts.prepublishOnly,
      /provenance\/scripts\/reject-directory-publish\.mjs/u,
    );
  }
  const workspaceManifest = JSON.parse(
    await readFile(
      new URL("../../package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    workspaceManifest.scripts["release:prepare"],
    "node provenance/scripts/prepare-release.mjs",
  );
  assert.equal(
    workspaceManifest.scripts["release:verify"],
    "node provenance/scripts/verify-release.mjs",
  );
});

test("npm refuses direct package-directory publication before it can rebuild", () => {
  const npmExecPath = process.env.npm_execpath;
  assert.equal(
    typeof npmExecPath,
    "string",
    "Run provenance tests through the exact npm CLI.",
  );
  const result = spawnSync(
    process.execPath,
    [
      npmExecPath,
      "publish",
      "--dry-run",
      "--json",
      join(repositoryRoot, "packages", "publisher"),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_tag: "next",
      },
      maxBuffer: 30 * 1024 * 1024,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Direct package-directory publication is forbidden/u,
  );
});

test("all draft provenance records are valid", () => {
  for (const record of [
    foundationRecord,
    sourceLoaderRecord,
    unicodeRecord,
  ]) {
    assert.deepEqual(validate(record), {
      valid: true,
      errors: [],
    });
  }
});

test("unknown fields and abbreviated refs are rejected", () => {
  const unknownField = structuredClone(foundationRecord);
  unknownField.unreviewedClaim = true;
  const unknownFieldResult = validate(unknownField);

  assert.equal(unknownFieldResult.valid, false);
  assert.ok(
    unknownFieldResult.errors.some((error) =>
      error.includes("additional properties"),
    ),
  );

  const abbreviatedRef = structuredClone(foundationRecord);
  abbreviatedRef.auditedSource.ref = "d000fe5";
  const abbreviatedRefResult = validate(abbreviatedRef);

  assert.equal(abbreviatedRefResult.valid, false);
  assert.ok(
    abbreviatedRefResult.errors.some((error) =>
      error.includes("must match pattern"),
    ),
  );
});

test("source evidence requires a full SHA-256 hash and at least one item", () => {
  const badHash = structuredClone(foundationRecord);
  badHash.auditedSource.evidence[0].sha256 = "sha256:5800675e";
  const badHashResult = validate(badHash);

  assert.equal(badHashResult.valid, false);
  assert.ok(
    badHashResult.errors.some((error) =>
      error.includes("must match pattern"),
    ),
  );

  const emptyEvidence = structuredClone(foundationRecord);
  emptyEvidence.auditedSource.evidence = [];
  const emptyEvidenceResult = validate(emptyEvidence);

  assert.equal(emptyEvidenceResult.valid, false);
  assert.ok(
    emptyEvidenceResult.errors.some((error) =>
      error.includes("must NOT have fewer than 1 items"),
    ),
  );
});

test("accepted fresh CPAL records reject every scan match", () => {
  const record = acceptedFreshRecord();
  record.scans.tokenShingle.outcome = "expected-match";
  record.scans.tokenShingle.matchCount = 1;
  const result = validate(record);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.includes(
      "scans.tokenShingle must be clear with 0 matches for fresh-cpal",
    ),
  );
});

test("draft and accepted lifecycle claims are mutually consistent", () => {
  const finalizedDraft = structuredClone(sourceLoaderRecord);
  finalizedDraft.audit.destinationManifest = {
    algorithm: "sha256-path-state-content-v2",
    entryCount: 1,
    deletedCount: 0,
    sha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  assert.ok(
    validate(finalizedDraft).errors.includes(
      "draft records must not claim a final destination manifest or receipt",
    ),
  );

  const unreviewedAccepted = acceptedFreshRecord();
  unreviewedAccepted.review.decision = "pending";
  assert.ok(
    validate(unreviewedAccepted).errors.includes(
      "review.decision must be accepted when status is accepted",
    ),
  );

  const unboundAccepted = acceptedFreshRecord();
  unboundAccepted.audit.receipt = null;
  assert.ok(
    validate(unboundAccepted).errors.includes(
      "accepted records require an immutable destination manifest and receipt",
    ),
  );
});

test("relicensed CPAL records require public rights-document metadata", () => {
  const record = structuredClone(foundationRecord);
  record.classification = "relicensed-cpal";
  record.treatment.copiedSource = true;
  record.treatment.sourceLicenseTreatment = "relicensed";

  const missingRightsResult = validate(record);
  assert.equal(missingRightsResult.valid, false);

  record.treatment.rightsDocument = {
    documentId: "GENII-REL-2026-001",
    sha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    issuedAt: "2026-07-28",
    scope: "Authorizes relicensing of the identified source files for this extraction batch.",
    authorizingParties: [
      "GENII Foundation",
      "Rights holder of record",
    ],
    secureCustodian: "GENII Foundation legal records",
  };
  const completeRightsResult = validate(record);

  assert.deepEqual(completeRightsResult, {
    valid: true,
    errors: [],
  });
});

test("line ranges, evidence paths, and additional sources receive semantic validation", () => {
  const invertedRange = structuredClone(foundationRecord);
  invertedRange.auditedSource.evidence[0].lineStart = 48;
  invertedRange.auditedSource.evidence[0].lineEnd = 6;
  const invertedRangeResult = validate(invertedRange);

  assert.equal(invertedRangeResult.valid, false);
  assert.ok(
    invertedRangeResult.errors.includes(
      "auditedSource.evidence[0].lineEnd must be greater than or equal to lineStart",
    ),
  );

  const duplicatePath = structuredClone(foundationRecord);
  duplicatePath.auditedSource.evidence.push(
    structuredClone(duplicatePath.auditedSource.evidence[0]),
  );
  assert.ok(
    validate(duplicatePath).errors.some((error) =>
      error.includes("contains duplicate value"),
    ),
  );

  const duplicateSource = structuredClone(unicodeRecord);
  duplicateSource.additionalSources.push(
    structuredClone(duplicateSource.additionalSources[1]),
  );
  assert.ok(
    validate(duplicateSource).errors.some((error) =>
      error.includes("additionalSources contains duplicate value"),
    ),
  );

  const unboundInstalledInput = structuredClone(unicodeRecord);
  unboundInstalledInput.audit.installedInputs[0].sourcePath =
    "same-version-but-unverified.js";
  assert.ok(
    validate(unboundInstalledInput).errors.includes(
      "audit.installedInputs[0] must map to declared Git evidence",
    ),
  );
});

test("stable-claims digests bind every material audit assertion and exclude only lifecycle results", () => {
  const baseline = structuredClone(sourceLoaderRecord);
  const originalDigest = createStableClaimsDigest(baseline);
  const mutations = [
    (record) => {
      record.classification = "apache-preserved";
    },
    (record) => {
      record.batch.destinationPaths.push("material-scope/");
    },
    (record) => {
      record.auditedSource.evidence[0].description +=
        " Material change.";
    },
    (record) => {
      record.additionalSources.push({
        kind: "artifact",
        url: "https://example.test/material.txt",
        version: "1.0.0",
        sha256:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        license: "third-party",
        description: "Material source.",
      });
    },
    (record) => {
      record.specifications.evidence[0].lineEnd -= 1;
    },
    (record) => {
      record.audit.coverageMode = "historical";
    },
    (record) => {
      record.audit.ccSourcePaths.push("material-cc/");
    },
    (record) => {
      record.audit.packageRoots.push("material-package/");
    },
    (record) => {
      record.audit.forbiddenPackagePatterns.push(
        "material forbidden phrase",
      );
    },
    (record) => {
      record.audit.verificationCommands.push({
        argv: [
          "node",
          "material-check.mjs",
        ],
        description: "Material verification.",
      });
    },
    (record) => {
      record.audit.installedInputs.push({
        installedPath: "node_modules/material/input.js",
        sourceRepository:
          record.auditedSource.repository,
        sourceRef: record.auditedSource.ref,
        sourcePath: record.auditedSource.evidence[0].path,
      });
    },
    (record) => {
      record.treatment.summary += " Material change.";
    },
    (record) => {
      record.scans.scope += " Material change.";
    },
    (record) => {
      record.scans.exactBlob.method += " Material change.";
    },
    (record) => {
      record.review.notes += " Material change.";
    },
    (record) => {
      record.documentation.notice.reason +=
        " Material change.";
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(baseline);
    mutate(changed);
    assert.notDeepEqual(
      createStableClaimsDigest(changed),
      originalDigest,
    );
  }

  const lifecycleOnly = structuredClone(baseline);
  lifecycleOnly.status = "accepted";
  lifecycleOnly.recordedAt = "2026-07-29T00:00:00Z";
  lifecycleOnly.audit.destinationManifest = {
    algorithm: "sha256-path-state-content-v2",
    entryCount: 1,
    deletedCount: 0,
    sha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  lifecycleOnly.audit.receipt = {
    path: "provenance/receipts/lifecycle.json",
    sha256:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
  lifecycleOnly.scans.performedAt =
    "2026-07-29T00:00:00Z";
  lifecycleOnly.scans.exactBlob.outcome = "clear";
  lifecycleOnly.scans.exactBlob.matchCount = 0;
  lifecycleOnly.scans.exactBlob.evidence =
    "Lifecycle evidence.";
  lifecycleOnly.review.decision = "accepted";
  lifecycleOnly.review.reviewedAt =
    "2026-07-29T00:00:00Z";
  assert.deepEqual(
    createStableClaimsDigest(lifecycleOnly),
    originalDigest,
  );
});

test("receipt validation binds manifest entries and scan counts", () => {
  const receipt = emptyReceipt();
  assert.deepEqual(validateReceipt(receipt), {
    valid: true,
    errors: [],
  });

  const badManifest = structuredClone(receipt);
  badManifest.destinationManifest.entryCount = 2;
  assert.ok(
    validateReceipt(badManifest).errors.includes(
      "destinationManifest.entryCount must equal destinationManifest.entries.length",
    ),
  );

  const badScan = structuredClone(receipt);
  badScan.scans.exactBlob.matchCount = 1;
  assert.ok(
    validateReceipt(badScan).errors.includes(
      "scans.exactBlob.matchCount must equal matches.length",
    ),
  );

  const unverifiedWithEvidence = structuredClone(receipt);
  unverifiedWithEvidence.sources[0].verified = false;
  assert.ok(
    validateReceipt(unverifiedWithEvidence).errors.includes(
      "sources[0].evidence must be empty when verified is false",
    ),
  );
});

test("accepted records bind the exact receipt sources and evidence", async (context) => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "publisher-receipt-test-"),
  );
  context.after(async () => {
    await rm(temporaryRoot, {
      force: true,
      recursive: true,
    });
  });
  const recordsRoot = join(
    temporaryRoot,
    "provenance",
    "records",
  );
  const receiptsRoot = join(
    temporaryRoot,
    "provenance",
    "receipts",
  );
  await mkdir(recordsRoot, {
    recursive: true,
  });
  await mkdir(receiptsRoot, {
    recursive: true,
  });
  await writeFile(
    join(temporaryRoot, "changed.txt"),
    "before\n",
    "utf8",
  );
  await writeFile(
    join(temporaryRoot, "package.json"),
    `${JSON.stringify({
      engines: {
        npm: "10.9.0",
      },
      name: "live-provenance-workspace",
      packageManager: "npm@10.9.0",
      private: true,
      type: "module",
      version: "0.0.0",
      workspaces: [
        "package",
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(temporaryRoot, "package-lock.json"),
    `${JSON.stringify({
      lockfileVersion: 3,
      name: "live-provenance-workspace",
      packages: {
        "": {
          engines: {
            npm: "10.9.0",
          },
          name: "live-provenance-workspace",
          version: "0.0.0",
          workspaces: [
            "package",
          ],
        },
        "node_modules/live-provenance-fixture": {
          link: true,
          resolved: "package",
        },
        package: {
          name: "live-provenance-fixture",
          version: "1.0.0",
        },
      },
      requires: true,
      version: "0.0.0",
    }, null, 2)}\n`,
    "utf8",
  );
  await mkdir(join(temporaryRoot, "package"), {
    recursive: true,
  });
  await writeFile(
    join(temporaryRoot, "package", "package.json"),
    `${JSON.stringify({
      name: "live-provenance-fixture",
      repository: {
        directory: "package",
        type: "git",
        url: "https://example.test/live-provenance-fixture.git",
      },
      version: "1.0.0",
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(temporaryRoot, "package", "index.js"),
    "export const live = true;\n",
    "utf8",
  );
  runGit(temporaryRoot, ["init", "--quiet"]);
  runGit(temporaryRoot, [
    "config",
    "user.email",
    "provenance@example.test",
  ]);
  runGit(temporaryRoot, [
    "config",
    "user.name",
    "Provenance Test",
  ]);
  runGit(temporaryRoot, ["add", "."]);
  runGit(temporaryRoot, [
    "commit",
    "--quiet",
    "-m",
    "base",
  ]);
  const destinationBaseRef = runGit(
    temporaryRoot,
    ["rev-parse", "HEAD"],
  );
  await writeFile(
    join(temporaryRoot, "changed.txt"),
    "after\n",
    "utf8",
  );

  const record = acceptedFreshRecord();
  record.batch.destinationBaseRef = destinationBaseRef;
  record.batch.destinationPaths = [
    "changed.txt",
  ];
  record.audit.packageRoots = [
    "package/",
  ];
  const liveManifest = createDestinationManifest(
    temporaryRoot,
    listChangedEntries(
      temporaryRoot,
      destinationBaseRef,
    ),
  );
  record.audit.destinationManifest = {
    algorithm: liveManifest.algorithm,
    entryCount: liveManifest.entryCount,
    deletedCount: liveManifest.deletedCount,
    sha256: liveManifest.sha256,
  };
  const receipt = emptyReceipt();
  receipt.recordId = record.recordId;
  receipt.performedAt = record.scans.performedAt;
  receipt.destinationBaseRef = destinationBaseRef;
  receipt.destinationManifest = liveManifest;
  receipt.stableClaims = createStableClaimsDigest(record);
  // The receipt claims which scanner implementation produced it, and live
  // validation recomputes that closure from the running scanner rather than from
  // the audited repository, so the fixture records the real identity.
  receipt.scanner = createScannerIdentity({
    repositoryRoot: scannerRepositoryRoot,
  });
  const npmInvocation = resolveExactNpmInvocation({
    repositoryRoot: temporaryRoot,
  });
  const releasePreparation = await preparePackageArchives({
    npmInvocation,
    packageRoots: record.audit.packageRoots,
    repositoryRoot: temporaryRoot,
  });
  context.after(() => {
    releasePreparation.dispose();
  });
  const packageScan = await auditPackages(
    temporaryRoot,
    record.audit.packageRoots,
    record.audit.forbiddenPackagePatterns,
    undefined,
    {
      npmInvocation,
      preparedPackageArchives:
        releasePreparation.archives,
    },
  );
  receipt.scans.packageLeak = packageScan.result;
  receipt.packageArchives = structuredClone(
    packageScan.archives,
  );
  receipt.scanExclusions = structuredClone(
    packageScan.scanExclusions,
  );
  receipt.sources = [
    {
      kind: "git",
      source: record.auditedSource.repository,
      identity: record.auditedSource.ref,
      verified: true,
      evidence: record.auditedSource.evidence.map((item) => ({
        path: item.path,
        sha256: item.sha256,
        lineStart: item.lineStart,
        lineEnd: item.lineEnd,
      })),
    },
    {
      kind: "git",
      source: record.specifications.repository,
      identity: record.specifications.ref,
      verified: true,
      evidence: record.specifications.evidence.map((item) => ({
        path: item.path,
        sha256: item.sha256,
        lineStart: item.lineStart,
        lineEnd: item.lineEnd,
      })),
    },
  ];
  const receiptPath = join(
    receiptsRoot,
    `${record.recordId}.json`,
  );
  const recordPath = join(
    recordsRoot,
    `${record.recordId}.json`,
  );

  async function writeBoundPair() {
    const receiptBytes = Buffer.from(
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    record.audit.receipt = {
      path:
        `provenance/receipts/${record.recordId}.json`,
      sha256: hash(receiptBytes),
    };
    await writeFile(receiptPath, receiptBytes);
    await writeFile(
      recordPath,
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
  }

  await writeBoundPair();
  const validResult = await validateProvenanceDirectory({
    recordsUrl: pathToFileURL(`${recordsRoot}/`),
    repositoryRootUrl: pathToFileURL(`${temporaryRoot}/`),
  });
  assert.equal(validResult.count, 1);
  const releaseResult = await validateProvenanceDirectory({
    recordsUrl: pathToFileURL(`${recordsRoot}/`),
    repositoryRootUrl: pathToFileURL(`${temporaryRoot}/`),
    releaseMode: true,
    preparedPackageArchives:
      releasePreparation.archives,
  });
  assert.equal(releaseResult.count, 1);

  const packageHash =
    receipt.packageArchives[0].sha256;
  receipt.packageArchives[0].sha256 =
    "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  await writeBoundPair();
  await assert.rejects(
    validateProvenanceDirectory({
      recordsUrl: pathToFileURL(`${recordsRoot}/`),
      repositoryRootUrl: pathToFileURL(`${temporaryRoot}/`),
    }),
    /packed package archives are stale/u,
  );
  receipt.packageArchives[0].sha256 = packageHash;

  // Each part of the recorded scanner identity is bound independently: the
  // composite digest, the component count, and the component list.
  const recordedScanner = receipt.scanner;
  for (const mutation of [
    {
      ...recordedScanner,
      sha256:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
    {
      ...recordedScanner,
      fileCount: recordedScanner.fileCount - 1,
      files: recordedScanner.files.slice(1),
    },
    {
      ...recordedScanner,
      files: [
        {
          ...recordedScanner.files[0],
          sha256:
            "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
        ...recordedScanner.files.slice(1),
      ],
    },
  ]) {
    receipt.scanner = mutation;
    await writeBoundPair();
    await assert.rejects(
      validateProvenanceDirectory({
        recordsUrl: pathToFileURL(`${recordsRoot}/`),
        repositoryRootUrl: pathToFileURL(`${temporaryRoot}/`),
      }),
      /receipt scanner identity does not match the current scanner runtime closure/u,
    );
  }
  receipt.scanner = recordedScanner;

  await writeFile(
    join(temporaryRoot, "changed.txt"),
    "changed again\n",
    "utf8",
  );
  await writeBoundPair();
  await assert.rejects(
    validateProvenanceDirectory({
      recordsUrl: pathToFileURL(`${recordsRoot}/`),
      repositoryRootUrl: pathToFileURL(`${temporaryRoot}/`),
    }),
    /destination manifest is stale/u,
  );
  await writeFile(
    join(temporaryRoot, "changed.txt"),
    "before\n",
    "utf8",
  );
  await writeBoundPair();
  await assert.rejects(
    validateProvenanceDirectory({
      recordsUrl: pathToFileURL(`${recordsRoot}/`),
      repositoryRootUrl: pathToFileURL(`${temporaryRoot}/`),
    }),
    /no changed file|cannot be empty/u,
  );
  await writeFile(
    join(temporaryRoot, "changed.txt"),
    "after\n",
    "utf8",
  );

  const reviewNotes = record.review.notes;
  record.review.notes += " Material mutation.";
  await writeBoundPair();
  await assert.rejects(
    validateProvenanceDirectory({
      recordsUrl: pathToFileURL(`${recordsRoot}/`),
      repositoryRootUrl: pathToFileURL(`${temporaryRoot}/`),
    }),
    /stableClaims digest does not match/u,
  );
  record.review.notes = reviewNotes;

  receipt.sources[0].evidence[0].sha256 =
    "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  await writeBoundPair();
  await assert.rejects(
    validateProvenanceDirectory({
      recordsUrl: pathToFileURL(`${recordsRoot}/`),
      repositoryRootUrl: pathToFileURL(`${temporaryRoot}/`),
    }),
    /receipt sources\[0\]\.evidence\[0\] does not match the record/u,
  );
});
