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
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { pack as packTar } from "tar-stream";

import {
  auditPackages,
  auditRecord,
  createDestinationManifest,
  listChangedEntries,
  listChangedPaths,
  pathsForRecord,
  sha256,
  verifyCoverage,
  verifyInstalledInputs,
} from "./audit.mjs";
import { createReceiptValidator } from "./validate.mjs";

const sourceRepository =
  "https://example.test/upstream/source";
const destinationRepository =
  "https://example.test/genii/publisher";
const artifactUrl =
  "https://example.test/upstream/source-data.txt";

function runGit(repositoryRoot, arguments_) {
  return execFileSync("git", ["-C", repositoryRoot, ...arguments_], {
    encoding: "utf8",
  }).trim();
}

async function writeFiles(repositoryRoot, files) {
  for (const [filePath, contents] of Object.entries(files)) {
    const absolutePath = join(repositoryRoot, filePath);
    await mkdir(join(absolutePath, ".."), {
      recursive: true,
    });
    await writeFile(absolutePath, contents, "utf8");
  }
}

async function createRepository(repositoryRoot, files) {
  await mkdir(repositoryRoot, {
    recursive: true,
  });
  runGit(repositoryRoot, ["init", "--quiet"]);
  runGit(repositoryRoot, [
    "config",
    "user.email",
    "provenance@example.test",
  ]);
  runGit(repositoryRoot, [
    "config",
    "user.name",
    "Provenance Test",
  ]);
  await writeFiles(repositoryRoot, files);
  runGit(repositoryRoot, ["add", "."]);
  runGit(repositoryRoot, [
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return runGit(repositoryRoot, ["rev-parse", "HEAD"]);
}

function evidence(filePath, contents, lineEnd) {
  return {
    path: filePath,
    sha256: sha256(contents),
    role: "source-code",
    license: "third-party",
    lineStart: 1,
    lineEnd,
    description: "Synthetic audit evidence.",
  };
}

test("the offline audit binds coverage, source evidence, similarity, regeneration, and package leakage", async (context) => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "publisher-provenance-test-"),
  );
  context.after(async () => {
    await rm(temporaryRoot, {
      force: true,
      recursive: true,
    });
  });

  const sourceRoot = join(temporaryRoot, "source");
  const destinationRoot = join(temporaryRoot, "destination");
  const artifactPath = join(temporaryRoot, "source-data.txt");
  const sourceCode = [
    "export function calculatePortableIdentity(input, options) {",
    "  const normalized = normalizePortablePath(input);",
    "  const folded = applyUnicodeCaseFold(normalized);",
    "  const segments = splitPathSegments(folded);",
    "  const checked = verifyPortableSegments(segments, options);",
    "  return serializePortableIdentity(checked, options);",
    "}",
    "",
  ].join("\n");
  const destinationCode =
    `${sourceCode}// Independently formatted fixture.\n`;
  const specification = "Synthetic immutable specification.\n";
  const artifact = "Synthetic upstream data artifact.\n";
  const sourceRef = await createRepository(sourceRoot, {
    "source.ts": sourceCode,
  });
  const destinationBaseRef = await createRepository(
    destinationRoot,
    {
      "package.json": `${JSON.stringify({
        engines: {
          npm: "10.9.0",
        },
        name: "synthetic-audit-workspace",
        packageManager: "npm@10.9.0",
        private: true,
        type: "module",
        version: "0.0.0",
        workspaces: [
          "package",
        ],
      }, null, 2)}\n`,
      "package-lock.json": `${JSON.stringify({
        lockfileVersion: 3,
        name: "synthetic-audit-workspace",
        packages: {
          "": {
            engines: {
              npm: "10.9.0",
            },
            name: "synthetic-audit-workspace",
            version: "0.0.0",
            workspaces: [
              "package",
            ],
          },
          "node_modules/audit-fixture": {
            link: true,
            resolved: "package",
          },
          package: {
            name: "audit-fixture",
            version: "1.0.0",
          },
        },
        requires: true,
        version: "0.0.0",
      }, null, 2)}\n`,
      "package/README.md": "Safe package.\n",
      "package/package.json": `${JSON.stringify({
        name: "audit-fixture",
        repository: {
          directory: "package",
          type: "git",
          url: "https://example.test/audit-fixture.git",
        },
        version: "1.0.0",
      }, null, 2)}\n`,
      "mutate.mjs":
        "import { appendFileSync } from \"node:fs\";\nappendFileSync(\"target.ts\", \"// mutation\\\\n\");\n",
      "specification.md": specification,
      "target.ts": "export const original = true;\n",
      "LICENSE": "Synthetic old license.\n",
      "verify.mjs": [
        "import { readFileSync } from \"node:fs\";",
        "if (readFileSync(process.argv[2], \"utf8\") !== \"Synthetic upstream data artifact.\\n\") {",
        "  throw new Error(\"artifact substitution failed\");",
        "}",
        "process.stdout.write(\"regeneration verified\\n\");",
        "",
      ].join("\n"),
    },
  );
  await writeFile(artifactPath, artifact, "utf8");
  await writeFiles(destinationRoot, {
    "package/README.md":
      "The forbidden coherence-thesis marker must not ship.\n",
    "provenance/records/self.json": "{}\n",
    "target.ts": destinationCode,
  });
  await writeFile(
    join(destinationRoot, "package", "image.png"),
    Buffer.from([
      0,
      1,
      2,
      3,
    ]),
  );
  await unlink(join(destinationRoot, "LICENSE"));

  const record = {
    schemaVersion: "1.2.0",
    recordId: "2026-07-28-synthetic-audit",
    status: "draft",
    classification: "fresh-cpal",
    batch: {
      batchId: "2026-07-28-synthetic-audit",
      destinationRepository,
      destinationBaseRef,
      destinationPaths: [
        "LICENSE",
        "package/",
        "target.ts",
      ],
      summary: "Synthetic provenance audit.",
    },
    auditedSource: {
      repository: sourceRepository,
      ref: sourceRef,
      evidence: [
        evidence("source.ts", sourceCode, 7),
      ],
    },
    additionalSources: [
      {
        kind: "artifact",
        url: artifactUrl,
        version: "1.0.0",
        sha256: sha256(artifact),
        license: "third-party",
        description: "Synthetic artifact.",
      },
    ],
    specifications: {
      repository: destinationRepository,
      ref: destinationBaseRef,
      evidence: [
        evidence(
          "specification.md",
          specification,
          1,
        ),
      ],
    },
    audit: {
      coverageMode: "working-tree",
      ccSourcePaths: [],
      packageRoots: [
        "package/",
      ],
      forbiddenPackagePatterns: [
        "coherence-thesis",
      ],
      verificationCommands: [
        {
          argv: [
            "node",
            "verify.mjs",
            `artifact:${artifactUrl}`,
          ],
          description: "Verify deterministic regeneration.",
        },
      ],
      installedInputs: [],
    },
    treatment: {
      summary: "Synthetic fresh implementation.",
      copiedSource: false,
      copiedTests: false,
      implementationAccess: "observed",
      sourceLicenseTreatment: "not-applicable",
      rightsDocument: null,
      blocker: null,
    },
    scans: {
      performedAt: "2026-07-28T20:32:06Z",
      scope: "Synthetic audit scope.",
      exactBlob: {
        method: "Synthetic exact scan.",
      },
      normalizedLine: {
        method: "Synthetic normalized-line scan.",
      },
      tokenShingle: {
        method: "Synthetic token scan.",
      },
      ccPhrase: {
        method: "Synthetic prose scan.",
      },
      packageLeak: {
        method: "Synthetic package scan.",
      },
    },
    review: {
      reviewerType: "automated",
      reviewerId: "synthetic-audit",
      releaseApprovalRequired: true,
      notes: "Synthetic review.",
    },
    documentation: {
      notice: {
        status: "not-needed",
        paths: [],
        reason: "Synthetic fixture.",
      },
      legal: {
        status: "not-needed",
        paths: [],
        reason: "Synthetic fixture.",
      },
      changes: {
        status: "not-needed",
        paths: [],
        reason: "Synthetic fixture.",
      },
      thirdPartyNotices: {
        status: "not-needed",
        paths: [],
        reason: "Synthetic fixture.",
      },
    },
  };
  const changedPaths = listChangedPaths(
    destinationRoot,
    destinationBaseRef,
  );
  assert.deepEqual(changedPaths, [
    "LICENSE",
    "package/README.md",
    "package/image.png",
    "target.ts",
  ]);
  const changedEntries = listChangedEntries(
    destinationRoot,
    destinationBaseRef,
  );
  assert.deepEqual(changedEntries, [
    {
      path: "LICENSE",
      status: "deleted",
    },
    {
      path: "package/README.md",
      status: "present",
    },
    {
      path: "package/image.png",
      status: "present",
    },
    {
      path: "target.ts",
      status: "present",
    },
  ]);
  assert.deepEqual(
    pathsForRecord(record, changedEntries),
    changedEntries,
  );
  assert.deepEqual(verifyCoverage([record], changedEntries), {
    changedPathCount: 4,
    uncoveredPaths: [],
  });
  assert.throws(
    () =>
      verifyCoverage(
        [record],
        [
          ...changedEntries,
          {
            path: "uncovered.txt",
            status: "present",
          },
        ],
      ),
    /lack a working-tree provenance record/u,
  );

  const firstManifest = createDestinationManifest(
    destinationRoot,
    changedEntries,
  );
  const secondManifest = createDestinationManifest(
    destinationRoot,
    [...changedEntries].reverse(),
  );
  assert.deepEqual(firstManifest, secondManifest);
  assert.deepEqual(
    firstManifest.entries.map((entry) => entry.path),
    changedPaths,
  );
  assert.equal(firstManifest.deletedCount, 1);
  assert.deepEqual(firstManifest.entries[0], {
    path: "LICENSE",
    status: "deleted",
    sha256: null,
  });

  const auditArguments = {
    record,
    destinationRoot,
    changedEntries,
    sourceMap: new Map([
      [sourceRepository, sourceRoot],
    ]),
    artifactMap: new Map([
      [artifactUrl, artifactPath],
    ]),
  };
  const receipt = await auditRecord(auditArguments);
  const repeatedReceipt = await auditRecord(auditArguments);
  assert.deepEqual(receipt, repeatedReceipt);
  assert.equal(receipt.sources.length, 3);
  assert.ok(
    receipt.sources.every((source) => source.verified),
  );
  assert.equal(receipt.scans.exactBlob.outcome, "clear");
  assert.equal(
    receipt.scans.tokenShingle.outcome,
    "expected-match",
  );
  assert.ok(receipt.scans.tokenShingle.matchCount > 0);
  assert.equal(
    receipt.scans.ccPhrase.outcome,
    "not-applicable",
  );
  assert.equal(
    receipt.scans.packageLeak.outcome,
    "expected-match",
  );
  assert.ok(receipt.scans.packageLeak.matchCount > 0);
  assert.equal(receipt.packageArchives.length, 1);
  assert.equal(
    receipt.packageArchives[0].fileCount,
    receipt.packageArchives[0].files.length,
  );
  assert.ok(
    receipt.packageArchives[0].files.includes(
      "package/package.json",
    ),
  );
  assert.ok(
    receipt.scanExclusions.some(
      (exclusion) =>
        exclusion.document === "package/image.png" &&
        exclusion.scans.includes("normalizedLine"),
    ),
  );
  assert.ok(
    receipt.scanExclusions.some(
      (exclusion) =>
        exclusion.document ===
          "package/:package/image.png" &&
        exclusion.scans.includes("packageLeak"),
    ),
  );
  assert.equal(receipt.verificationCommands[0].exitCode, 0);

  const validateReceipt = await createReceiptValidator();
  assert.deepEqual(validateReceipt(receipt), {
    valid: true,
    errors: [],
  });

  await writeFile(
    join(destinationRoot, "target.ts"),
    Buffer.from([
      0xff,
    ]),
  );
  await assert.rejects(
    async () =>
      auditRecord({
        ...auditArguments,
        skipPackages: true,
      }),
    /invalid UTF-8/u,
  );
  await writeFile(
    join(destinationRoot, "target.ts"),
    Buffer.from("invalid\0text", "utf8"),
  );
  await assert.rejects(
    async () =>
      auditRecord({
        ...auditArguments,
        skipPackages: true,
      }),
    /undeclared binary NUL byte/u,
  );
  await writeFile(
    join(destinationRoot, "target.ts"),
    Buffer.alloc(16 * 1024 * 1024 + 1, 0x61),
  );
  await assert.rejects(
    async () =>
      auditRecord({
        ...auditArguments,
        skipPackages: true,
      }),
    /exceeds the 16777216-byte text limit/u,
  );
  await writeFile(
    join(destinationRoot, "target.ts"),
    destinationCode,
    "utf8",
  );

  const badHash = structuredClone(record);
  badHash.auditedSource.evidence[0].sha256 = sha256(
    "tampered",
  );
  await assert.rejects(
    async () =>
      auditRecord({
        ...auditArguments,
        record: badHash,
      }),
    /expected sha256/u,
  );

  const badRange = structuredClone(record);
  badRange.auditedSource.evidence[0].lineEnd = 99;
  await assert.rejects(
    async () =>
      auditRecord({
        ...auditArguments,
        record: badRange,
      }),
    /but the file has/u,
  );

  const badRef = structuredClone(record);
  badRef.auditedSource.ref =
    "0000000000000000000000000000000000000000";
  await assert.rejects(
    async () =>
      auditRecord({
        ...auditArguments,
        record: badRef,
      }),
  );

  const badArtifact = structuredClone(record);
  badArtifact.additionalSources[0].sha256 = sha256(
    "tampered",
  );
  await assert.rejects(
    async () =>
      auditRecord({
        ...auditArguments,
        record: badArtifact,
      }),
    /expected sha256/u,
  );

  const writeMode = structuredClone(record);
  writeMode.audit.verificationCommands[0].argv = [
    "node",
    "verify.mjs",
    "--import-unicode-data",
  ];
  await assert.rejects(
    async () =>
      auditRecord({
        ...auditArguments,
        record: writeMode,
      }),
    /must not select a write or import mode/u,
  );

  const mutatingCommand = structuredClone(record);
  mutatingCommand.audit.verificationCommands[0].argv = [
    "node",
    "mutate.mjs",
  ];
  await assert.rejects(
    async () =>
      auditRecord({
        ...auditArguments,
        record: mutatingCommand,
      }),
    /modified the repository/u,
  );
});

// Builds one real gzipped package archive through the pinned tar-stream packer.
async function buildGzippedPackageArchive(members) {
  const packer = packTar();
  for (const [name, body] of members) {
    packer.entry({ mode: 0o644, name }, body);
  }
  packer.finalize();
  const chunks = [];
  for await (const chunk of packer) {
    chunks.push(chunk);
  }
  return gzipSync(Buffer.concat(chunks));
}

function retainedArchiveDescriptor({
  archivePath,
  bytes,
  candidateDirectory,
  files,
}) {
  return {
    archivePath,
    candidateDirectory,
    fileCount: files.length,
    files,
    integrity:
      `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    name: "archive-fixture",
    packageFiles: files.map((filePath) =>
      filePath.slice("package/".length),
    ),
    root: "package/",
    sha256: sha256(bytes),
    shasum: createHash("sha1").update(bytes).digest("hex"),
    size: bytes.length,
    version: "1.0.0",
  };
}

test("package auditing reads archives in process and fails closed on an unreadable candidate", async (context) => {
  const temporaryRoot = await realpath(
    await mkdtemp(
      join(tmpdir(), "publisher-provenance-archive-test-"),
    ),
  );
  context.after(async () => {
    await rm(temporaryRoot, {
      force: true,
      recursive: true,
    });
  });
  const repositoryRoot = join(temporaryRoot, "repository");
  const candidateDirectory = join(temporaryRoot, "candidates");
  const fakeBin = join(temporaryRoot, "fake-bin");
  const sentinelPath = join(
    temporaryRoot,
    "external-archive-tool-was-executed",
  );
  await mkdir(candidateDirectory);
  const packedManifest = `${JSON.stringify({
    name: "archive-fixture",
    repository: {
      directory: "package",
      type: "git",
      url: "https://example.test/archive-fixture.git",
    },
    version: "1.0.0",
  }, null, 2)}\n`;
  await writeFiles(repositoryRoot, {
    "package.json": `${JSON.stringify({
      engines: {
        npm: "10.9.0",
      },
      name: "archive-audit-workspace",
      packageManager: "npm@10.9.0",
      private: true,
      version: "0.0.0",
    }, null, 2)}\n`,
    "package/package.json": packedManifest,
  });

  // Every external archive tool the old scanner could have reached is replaced
  // by a script that would succeed and leave a trace. The audit must never
  // execute one, so the trace must never appear.
  const fakeTools = {};
  for (const tool of [
    "bsdtar",
    "gtar",
    "gunzip",
    "gzip",
    "tar",
  ]) {
    fakeTools[tool] = [
      "#!/bin/sh",
      `touch ${JSON.stringify(sentinelPath)}`,
      "printf 'package/package.json\\n'",
      "exit 0",
      "",
    ].join("\n");
  }
  await writeFiles(fakeBin, fakeTools);
  for (const tool of Object.keys(fakeTools)) {
    await chmod(join(fakeBin, tool), 0o755);
  }

  const archivePath = join(
    candidateDirectory,
    "archive-fixture-1.0.0.tgz",
  );

  function auditInChildProcess(retained) {
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          `import { resolveExactNpmInvocation } from ${JSON.stringify(new URL("./package-artifacts.mjs", import.meta.url).href)};`,
          `import { auditPackages } from ${JSON.stringify(new URL("./audit.mjs", import.meta.url).href)};`,
          `const repositoryRoot = ${JSON.stringify(repositoryRoot)};`,
          "const npmInvocation = resolveExactNpmInvocation({ repositoryRoot });",
          `const preparedPackageArchives = new Map([["package/", ${JSON.stringify(retained)}]]);`,
          "await auditPackages(repositoryRoot, [\"package/\"], [], undefined, { npmInvocation, preparedPackageArchives });",
        ].join("\n"),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
        },
      },
    );
  }

  const validBytes = await buildGzippedPackageArchive([
    ["package/package.json", packedManifest],
  ]);
  await writeFile(archivePath, validBytes);
  const accepted = auditInChildProcess(
    retainedArchiveDescriptor({
      archivePath,
      bytes: validBytes,
      candidateDirectory,
      files: [
        "package/package.json",
      ],
    }),
  );
  assert.equal(
    accepted.status,
    0,
    `a real gzipped candidate must audit cleanly: ${accepted.stderr}`,
  );

  // The same retained shape over bytes that are not a gzip stream. The hashes
  // match the corrupt bytes, so the read reaches decompression rather than
  // failing on identity, and the failure must name the archive.
  const corruptBytes = Buffer.from(
    "synthetic retained archive bytes\n",
  );
  await writeFile(archivePath, corruptBytes);
  const refused = auditInChildProcess(
    retainedArchiveDescriptor({
      archivePath,
      bytes: corruptBytes,
      candidateDirectory,
      files: [
        "package/package.json",
      ],
    }),
  );
  assert.notEqual(refused.status, 0);
  assert.match(
    refused.stderr,
    /Package archive could not be decompressed and parsed/u,
  );
  assert.match(
    refused.stderr,
    /archive-fixture-1\.0\.0\.tgz/u,
    "the failure must name the candidate it refused",
  );

  await assert.rejects(
    async () => realpath(sentinelPath),
    /ENOENT/u,
    "no external archive tool may be executed by a package audit",
  );
});

test("installed inputs are byte-bound to exact Git evidence despite an unchanged package version", async (context) => {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "publisher-provenance-input-test-"),
  );
  context.after(async () => {
    await rm(temporaryRoot, {
      force: true,
      recursive: true,
    });
  });
  const installedPath =
    "node_modules/example/package.json";
  const original =
    "{\"name\":\"example\",\"version\":\"1.0.0\"}\n";
  const sourceRef = "a".repeat(40);
  await writeFiles(temporaryRoot, {
    [installedPath]: original,
  });
  const record = {
    auditedSource: {
      repository: sourceRepository,
      ref: sourceRef,
      evidence: [
        evidence("package.json", original, 1),
      ],
    },
    additionalSources: [],
    specifications: {
      repository: destinationRepository,
      ref: "b".repeat(40),
      evidence: [
        evidence("specification.md", "specification\n", 1),
      ],
    },
    audit: {
      installedInputs: [
        {
          installedPath,
          sourceRepository,
          sourceRef,
          sourcePath: "package.json",
        },
      ],
    },
  };
  assert.deepEqual(
    verifyInstalledInputs(record, temporaryRoot),
    [
      {
        ...record.audit.installedInputs[0],
        sha256: sha256(original),
      },
    ],
  );

  await writeFiles(temporaryRoot, {
    [installedPath]:
      "{\"name\":\"example\",\"version\":\"1.0.0\",\"tampered\":true}\n",
  });
  assert.throws(
    () => verifyInstalledInputs(record, temporaryRoot),
    /expected source evidence/u,
  );
});
