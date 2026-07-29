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
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  execFileSync,
  spawnSync,
} from "node:child_process";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  createRecordValidator,
} from "./validate.mjs";
import {
  readPackageArchive,
} from "./archive-reader.mjs";
import {
  preparePackageArchives,
  resolveExactNpmInvocation,
  verifyPreparedPackageArchives,
} from "./package-artifacts.mjs";
import {
  createScannerIdentity,
} from "./scanner-identity.mjs";
import {
  createStableClaimsDigest,
} from "./stable-claims.mjs";

const receiptSchema =
  "https://publisher.genii.foundation/schemas/provenance-receipt-1.2.0.schema.json";

// The scanner identity attests the implementation that ran, which lives beside
// this file rather than inside whichever repository is being audited. For a
// self-audit the two coincide, but they are not the same claim.
const scannerRepositoryRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const manifestAlgorithm = "sha256-path-state-content-v2";
const codePathPattern = /\.(?:[cm]?[jt]sx?)$/u;
const declaredBinaryPathPattern =
  /\.(?:7z|aiff?|avif|bmp|bz2|eot|flac|gif|gz|ico|jpe?g|m4a|mov|mp3|mp4|ogg|otf|pdf|png|rar|tar|tiff?|ttf|wav|wasm|webm|webp|woff2?|xz|zip)$/iu;
const selfAuditingPathPatterns = [
  /^provenance\/records\/[^/]+\.json$/u,
  /^provenance\/receipts\/[^/]+\.json$/u,
];
const maximumScannedFileBytes = 16 * 1024 * 1024;
const maximumMatchesPerScan = 10_000;
const tokenShingleWidth = 16;
const minimumDistinctTokenIdentifiers = 6;
const proseWindowWidth = 8;
const textDecoder = new TextDecoder("utf-8", {
  fatal: true,
});

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedRepositoryPath(value) {
  return value.split(sep).join("/");
}

function runGit(repositoryRoot, arguments_, options = {}) {
  return execFileSync("git", ["-C", repositoryRoot, ...arguments_], {
    encoding: options.encoding,
    maxBuffer: options.maxBuffer ?? 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function splitNullTerminated(value) {
  return value.toString("utf8").split("\0").filter(Boolean);
}

function isSelfAuditingPath(filePath) {
  return selfAuditingPathPatterns.some((pattern) =>
    pattern.test(filePath)
  );
}

export function listChangedPaths(
  destinationRoot,
  destinationBaseRef,
  options = {},
) {
  return Object.freeze(
    listChangedEntries(
      destinationRoot,
      destinationBaseRef,
      options,
    ).map((entry) => entry.path),
  );
}

export function listChangedEntries(
  destinationRoot,
  destinationBaseRef,
  {
    includeSelfAuditing = false,
  } = {},
) {
  const tracked = splitNullTerminated(
    runGit(destinationRoot, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      "--diff-filter=ACMRTUXBD",
      destinationBaseRef,
      "--",
    ]),
  );
  const untracked = splitNullTerminated(
    runGit(destinationRoot, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]),
  );
  const paths = [...new Set([...tracked, ...untracked])]
      .map(normalizedRepositoryPath)
      .filter(
        (filePath) =>
          includeSelfAuditing || !isSelfAuditingPath(filePath),
      )
      .sort(compareText);
  return Object.freeze(
    paths.map((filePath) => {
      const absolutePath = resolve(destinationRoot, filePath);
      let stat;
      try {
        stat = lstatSync(absolutePath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          return Object.freeze({
            path: filePath,
            status: "deleted",
          });
        }
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(
          `Changed destination path must be a regular file or deletion: ${filePath}`,
        );
      }
      return Object.freeze({
        path: filePath,
        status: "present",
      });
    }),
  );
}

function entryPath(entry) {
  return typeof entry === "string" ? entry : entry.path;
}

function pathMatchesScope(filePath, scope) {
  return scope.endsWith("/")
    ? filePath.startsWith(scope)
    : filePath === scope;
}

export function pathsForRecord(record, changedEntries) {
  const selected = changedEntries.filter((entry) =>
    record.batch.destinationPaths.some((scope) =>
      pathMatchesScope(entryPath(entry), scope)
    )
  );
  const unusedScopes = record.batch.destinationPaths.filter((scope) =>
    !selected.some((entry) =>
      pathMatchesScope(entryPath(entry), scope)
    )
  );
  if (
    record.audit.coverageMode === "working-tree" &&
    unusedScopes.length > 0
  ) {
    throw new Error(
      `${record.recordId} declares destination paths with no changed file: ${unusedScopes.join(", ")}`,
    );
  }
  return Object.freeze(selected);
}

export function verifyCoverage(records, changedPaths) {
  const workingTreeRecords = records.filter(
    (record) => record.audit.coverageMode === "working-tree",
  );
  const uncovered = changedPaths.filter((entry) =>
    !workingTreeRecords.some((record) =>
      record.batch.destinationPaths.some((scope) =>
        pathMatchesScope(entryPath(entry), scope)
      )
    )
  );
  if (uncovered.length > 0) {
    throw new Error(
      `Changed paths lack a working-tree provenance record:\n${uncovered.map(entryPath).join("\n")}`,
    );
  }
  return {
    changedPathCount: changedPaths.length,
    uncoveredPaths: Object.freeze([]),
  };
}

export function createDestinationManifest(destinationRoot, changedEntries) {
  const entries = changedEntries
    .map((entry) => {
      const filePath = entryPath(entry);
      const status =
        typeof entry === "string" ? "present" : entry.status;
      const absolutePath = resolve(destinationRoot, filePath);
      const repositoryRelative = normalizedRepositoryPath(
        relative(destinationRoot, absolutePath),
      );
      if (
        repositoryRelative === ".." ||
        repositoryRelative.startsWith("../") ||
        isAbsolute(repositoryRelative)
      ) {
        throw new Error(
          `Destination path escapes the repository: ${filePath}`,
        );
      }
      if (status === "deleted") {
        if (existsSync(absolutePath)) {
          throw new Error(
            `Destination tombstone is stale because the path exists: ${filePath}`,
          );
        }
        return Object.freeze({
          path: filePath,
          status,
          sha256: null,
        });
      }
      if (status !== "present") {
        throw new Error(
          `Destination path has unknown state ${JSON.stringify(status)}: ${filePath}`,
        );
      }
      const stat = lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(
          `Destination path must be one regular file: ${filePath}`,
        );
      }
      return Object.freeze({
        path: filePath,
        status,
        sha256: sha256(readFileSync(absolutePath)),
      });
    })
    .sort((left, right) => compareText(left.path, right.path));
  const serialized = entries
    .map((entry) =>
      entry.status === "present"
        ? `P ${entry.sha256.slice("sha256:".length)}  ${entry.path}\n`
        : `D -  ${entry.path}\n`
    )
    .join("");
  return Object.freeze({
    algorithm: manifestAlgorithm,
    entryCount: entries.length,
    deletedCount: entries.filter(
      (entry) => entry.status === "deleted",
    ).length,
    sha256: sha256(serialized),
    entries: Object.freeze(entries),
  });
}

function countTextLines(bytes) {
  if (bytes.length === 0) {
    return 0;
  }
  const text = textDecoder.decode(bytes);
  const lines = text.split(/\r\n|\r|\n/u);
  return /(?:\r\n|\r|\n)$/u.test(text)
    ? lines.length - 1
    : lines.length;
}

function verifyEvidenceBytes(sourceLabel, evidence, bytes) {
  const actualHash = sha256(bytes);
  if (actualHash !== evidence.sha256) {
    throw new Error(
      `${sourceLabel}:${evidence.path} has ${actualHash}, expected ${evidence.sha256}`,
    );
  }
  const lineCount = countTextLines(bytes);
  if (
    evidence.lineStart < 1 ||
    evidence.lineEnd < evidence.lineStart ||
    evidence.lineEnd > lineCount
  ) {
    throw new Error(
      `${sourceLabel}:${evidence.path} cites lines ${evidence.lineStart}-${evidence.lineEnd}, but the file has ${lineCount} line(s)`,
    );
  }
  return Object.freeze({
    path: evidence.path,
    sha256: actualHash,
    lineStart: evidence.lineStart,
    lineEnd: evidence.lineEnd,
  });
}

function resolveCommit(repositoryRoot, ref) {
  const commit = runGit(
    repositoryRoot,
    ["rev-parse", "--verify", `${ref}^{commit}`],
    { encoding: "utf8" },
  ).trim();
  if (commit !== ref) {
    throw new Error(
      `${ref} resolves to ${commit}; provenance requires the exact commit object`,
    );
  }
  return commit;
}

function repositoryFiles(repositoryRoot, ref) {
  return splitNullTerminated(
    runGit(repositoryRoot, [
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      ref,
    ]),
  ).sort(compareText);
}

function gitFile(repositoryRoot, ref, filePath) {
  return runGit(repositoryRoot, ["show", `${ref}:${filePath}`]);
}

function gitSourceVerification(
  source,
  repositoryRoot,
  scanAllTracked,
) {
  resolveCommit(repositoryRoot, source.ref);
  const evidence = source.evidence.map((item) =>
    verifyEvidenceBytes(
      `${source.repository}@${source.ref}`,
      item,
      gitFile(repositoryRoot, source.ref, item.path),
    )
  );
  const scannedPaths = scanAllTracked
    ? repositoryFiles(repositoryRoot, source.ref)
    : source.evidence.map((item) => item.path);
  const documents = scannedPaths.map((filePath) =>
    Object.freeze({
      label: `${source.repository}@${source.ref}:${filePath}`,
      path: filePath,
      bytes: gitFile(repositoryRoot, source.ref, filePath),
    })
  );
  return {
    verification: Object.freeze({
      kind: "git",
      source: source.repository,
      identity: source.ref,
      verified: true,
      evidence: Object.freeze(evidence),
    }),
    documents: Object.freeze(documents),
  };
}

function artifactSourceVerification(source, localPath) {
  if (localPath === undefined) {
    return {
      verification: Object.freeze({
        kind: "artifact",
        source: source.url,
        identity: source.version,
        verified: false,
        evidence: Object.freeze([]),
      }),
      documents: Object.freeze([]),
    };
  }
  const bytes = readFileSync(localPath);
  const actualHash = sha256(bytes);
  if (actualHash !== source.sha256) {
    throw new Error(
      `${source.url} has ${actualHash}, expected ${source.sha256}`,
    );
  }
  return {
    verification: Object.freeze({
      kind: "artifact",
      source: source.url,
      identity: source.version,
      verified: true,
      evidence: Object.freeze([
        Object.freeze({
          path: source.url,
          sha256: actualHash,
          lineStart: 1,
          lineEnd: Math.max(1, countTextLines(bytes)),
        }),
      ]),
    }),
    documents: Object.freeze([
      Object.freeze({
        label: `${source.url}@${source.version}`,
        path: source.url,
        bytes,
      }),
    ]),
  };
}

function isDeclaredBinaryPath(filePath) {
  return declaredBinaryPathPattern.test(filePath);
}

function createScanExclusionRecorder() {
  const exclusions = new Map();
  return Object.freeze({
    record(document, scanName) {
      if (!isDeclaredBinaryPath(document.path)) {
        throw new Error(
          `Only declared binary file types may be excluded from text scans: ${document.label}`,
        );
      }
      const fingerprint = sha256(document.bytes);
      const key = `${document.label}\0${fingerprint}`;
      const existing = exclusions.get(key);
      if (existing === undefined) {
        exclusions.set(key, {
          document: document.label,
          sha256: fingerprint,
          reason: "declared-binary-file-type",
          scans: new Set([scanName]),
        });
      } else {
        existing.scans.add(scanName);
      }
    },
    values() {
      return Object.freeze(
        [...exclusions.values()]
          .map((exclusion) =>
            Object.freeze({
              document: exclusion.document,
              sha256: exclusion.sha256,
              reason: exclusion.reason,
              scans: Object.freeze(
                [...exclusion.scans].sort(compareText),
              ),
            })
          )
          .sort((left, right) =>
            compareText(left.document, right.document)
          ),
      );
    },
  });
}

function decodeText(document, scanName, exclusionRecorder) {
  if (isDeclaredBinaryPath(document.path)) {
    exclusionRecorder.record(document, scanName);
    return undefined;
  }
  if (document.bytes.length > maximumScannedFileBytes) {
    throw new Error(
      `${scanName} cannot scan ${document.label}: ${document.bytes.length} bytes exceeds the ${maximumScannedFileBytes}-byte text limit`,
    );
  }
  if (document.bytes.includes(0)) {
    throw new Error(
      `${scanName} cannot scan ${document.label}: undeclared binary NUL byte`,
    );
  }
  try {
    return textDecoder.decode(document.bytes);
  } catch (error) {
    throw new Error(
      `${scanName} cannot scan ${document.label}: invalid UTF-8`,
      { cause: error },
    );
  }
}

function destinationDocuments(destinationRoot, entries) {
  return entries
    .filter((entry) => entry.status === "present")
    .map((entry) =>
      Object.freeze({
        label: entry.path,
        path: entry.path,
        bytes: readFileSync(resolve(destinationRoot, entry.path)),
      })
    );
}

function scanResult(matches, notApplicable = false) {
  const bounded = matches.slice(0, maximumMatchesPerScan);
  if (matches.length > maximumMatchesPerScan) {
    throw new Error(
      `A provenance scan produced more than ${maximumMatchesPerScan} matches`,
    );
  }
  return Object.freeze({
    outcome: notApplicable
      ? "not-applicable"
      : matches.length === 0
        ? "clear"
        : "expected-match",
    matchCount: matches.length,
    matches: Object.freeze(bounded),
  });
}

function exactBlobScan(sourceDocuments, destination) {
  const sourceHashes = new Map();
  for (const document of sourceDocuments) {
    const fingerprint = sha256(document.bytes);
    if (!sourceHashes.has(fingerprint)) {
      sourceHashes.set(fingerprint, document);
    }
  }
  const matches = [];
  for (const document of destination) {
    const fingerprint = sha256(document.bytes);
    const source = sourceHashes.get(fingerprint);
    if (source !== undefined) {
      matches.push(
        Object.freeze({
          source: source.label,
          destination: document.path,
          fingerprint,
        }),
      );
    }
  }
  return scanResult(matches);
}

function normalizedLine(value) {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizedLineScan(
  sourceDocuments,
  destination,
  exclusionRecorder,
) {
  const sourceLines = new Map();
  for (const document of sourceDocuments) {
    const text = decodeText(
      document,
      "normalizedLine",
      exclusionRecorder,
    );
    if (text === undefined) {
      continue;
    }
    for (const [index, line] of text.split(/\r\n|\r|\n/u).entries()) {
      const fingerprint = normalizedLine(line);
      if (fingerprint.length < 60 || sourceLines.has(fingerprint)) {
        continue;
      }
      sourceLines.set(fingerprint, {
        label: `${document.label}:${index + 1}`,
      });
    }
  }
  const matches = [];
  for (const document of destination) {
    const text = decodeText(
      document,
      "normalizedLine",
      exclusionRecorder,
    );
    if (text === undefined) {
      continue;
    }
    for (const [index, line] of text.split(/\r\n|\r|\n/u).entries()) {
      const fingerprint = normalizedLine(line);
      const source = sourceLines.get(fingerprint);
      if (source !== undefined) {
        matches.push(
          Object.freeze({
            source: source.label,
            destination: `${document.path}:${index + 1}`,
            fingerprint,
          }),
        );
      }
    }
  }
  return scanResult(matches);
}

function lexicalTokens(value) {
  const withoutCommentsOrStrings = value
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/.*$/gmu, "$1 ")
    .replace(/`(?:\\.|[^`\\])*`/gu, " ")
    .replace(/"(?:\\.|[^"\\])*"/gu, " ")
    .replace(/'(?:\\.|[^'\\])*'/gu, " ");
  return (
    withoutCommentsOrStrings.match(
      /[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?/gu,
    ) ?? []
  ).map((token) => (/^\d/u.test(token) ? "NUMBER" : token));
}

function significantTokenShingles(value) {
  const tokens = lexicalTokens(value);
  const result = new Map();
  for (
    let index = 0;
    index + tokenShingleWidth <= tokens.length;
    index += 1
  ) {
    const window = tokens.slice(index, index + tokenShingleWidth);
    const distinctIdentifiers = new Set(
      window.filter((token) => token !== "NUMBER"),
    );
    if (distinctIdentifiers.size < minimumDistinctTokenIdentifiers) {
      continue;
    }
    const fingerprint = window.join(" ");
    if (!result.has(fingerprint)) {
      result.set(fingerprint, index);
    }
  }
  return result;
}

function tokenShingleScan(
  sourceDocuments,
  destination,
  exclusionRecorder,
) {
  const sourceShingles = new Map();
  for (const document of sourceDocuments) {
    if (!codePathPattern.test(document.path)) {
      continue;
    }
    const text = decodeText(
      document,
      "tokenShingle",
      exclusionRecorder,
    );
    if (text === undefined) {
      continue;
    }
    for (const fingerprint of significantTokenShingles(text).keys()) {
      if (!sourceShingles.has(fingerprint)) {
        sourceShingles.set(fingerprint, document.label);
      }
    }
  }
  const matches = [];
  for (const document of destination) {
    if (!codePathPattern.test(document.path)) {
      continue;
    }
    const text = decodeText(
      document,
      "tokenShingle",
      exclusionRecorder,
    );
    if (text === undefined) {
      continue;
    }
    for (const fingerprint of significantTokenShingles(text).keys()) {
      const source = sourceShingles.get(fingerprint);
      if (source !== undefined) {
        matches.push(
          Object.freeze({
            source,
            destination: document.path,
            fingerprint,
          }),
        );
      }
    }
  }
  return scanResult(matches);
}

function proseWords(value) {
  return (
    value.match(
      /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu,
    ) ?? []
  );
}

function proseWindows(value) {
  const words = proseWords(value);
  const windows = new Map();
  for (
    let index = 0;
    index + proseWindowWidth <= words.length;
    index += 1
  ) {
    const fingerprint = words
      .slice(index, index + proseWindowWidth)
      .join(" ");
    if (!windows.has(fingerprint)) {
      windows.set(fingerprint, index);
    }
  }
  return windows;
}

function ccPhraseScan(
  sourceDocuments,
  destination,
  ccSourcePaths,
  exclusionRecorder,
) {
  if (ccSourcePaths.length === 0) {
    return scanResult([], true);
  }
  const phrases = new Map();
  for (const document of sourceDocuments) {
    if (
      !ccSourcePaths.some((scope) =>
        pathMatchesScope(document.path, scope)
      )
    ) {
      continue;
    }
    const text = decodeText(
      document,
      "ccPhrase",
      exclusionRecorder,
    );
    if (text === undefined) {
      continue;
    }
    for (const fingerprint of proseWindows(text).keys()) {
      if (!phrases.has(fingerprint)) {
        phrases.set(fingerprint, document.label);
      }
    }
  }
  const matches = [];
  for (const document of destination) {
    const text = decodeText(
      document,
      "ccPhrase",
      exclusionRecorder,
    );
    if (text === undefined) {
      continue;
    }
    for (const fingerprint of proseWindows(text).keys()) {
      const source = phrases.get(fingerprint);
      if (source !== undefined) {
        matches.push(
          Object.freeze({
            source,
            destination: document.path,
            fingerprint,
          }),
        );
      }
    }
  }
  return scanResult(matches);
}

// One bounded in-process pass replaces the previous listing process plus one
// extraction process per member. A real Content candidate holds 8,307 members,
// so the old shape spent over a minute of CPU per audit and trusted whichever
// `tar` happened to be first on PATH. The read is bound to the already verified
// descriptor, so the scanned bytes are provably the bytes that passed
// verification rather than whatever the file holds on a second open.
async function scanArchive(
  preparedArchive,
  packageRoot,
  forbiddenPatterns,
  exclusionRecorder,
) {
  const archive = await readPackageArchive({
    archivePath: preparedArchive.archivePath,
    captureFile: () => true,
    expectedIdentity: preparedArchive,
  });
  // `files` renders a directory member with the trailing separator the external
  // listing produced, and its sort order is the order match records are emitted
  // in, so both are preserved exactly.
  const membersByListedPath = new Map(
    archive.entries.map((entry) => [
      entry.type === "directory" ? `${entry.path}/` : entry.path,
      entry,
    ]),
  );
  const matches = [];
  const entries = archive.files;
  for (const entry of entries) {
    const loweredEntry = entry.toLocaleLowerCase("en-US");
    for (const pattern of forbiddenPatterns) {
      if (loweredEntry.includes(pattern.toLocaleLowerCase("en-US"))) {
        matches.push(
          Object.freeze({
            source: `forbidden package pattern ${JSON.stringify(pattern)}`,
            destination: `${packageRoot}:${entry}`,
            fingerprint: pattern,
          }),
        );
      }
    }
    if (entry.endsWith("/")) {
      continue;
    }
    const member = membersByListedPath.get(entry);
    if (member === undefined || member.bytes === undefined) {
      throw new Error(
        `Could not read ${packageRoot}:${entry} for provenance scanning`,
      );
    }
    const document = Object.freeze({
      label: `${packageRoot}:${entry}`,
      path: entry,
      bytes: member.bytes,
    });
    const text = decodeText(
      document,
      "packageLeak",
      exclusionRecorder,
    );
    if (text === undefined) {
      continue;
    }
    const loweredText = text.toLocaleLowerCase("en-US");
    for (const pattern of forbiddenPatterns) {
      if (loweredText.includes(pattern.toLocaleLowerCase("en-US"))) {
        matches.push(
          Object.freeze({
            source: `forbidden package pattern ${JSON.stringify(pattern)}`,
            destination: `${packageRoot}:${entry}`,
            fingerprint: pattern,
          }),
        );
      }
    }
  }
  return {
    matches,
    entries,
  };
}

export async function auditPackages(
  destinationRoot,
  packageRoots,
  forbiddenPatterns,
  exclusionRecorder = createScanExclusionRecorder(),
  {
    npmInvocation,
    preparedPackageArchives,
  } = {},
) {
  if (packageRoots.length === 0) {
    return {
      result: scanResult([], true),
      archives: Object.freeze([]),
      scanExclusions: exclusionRecorder.values(),
    };
  }
  const exactNpmInvocation =
    npmInvocation ??
    resolveExactNpmInvocation({
      repositoryRoot: destinationRoot,
    });
  const ownedPreparation =
    preparedPackageArchives === undefined
      ? await preparePackageArchives({
          repositoryRoot: destinationRoot,
          packageRoots,
          npmInvocation: exactNpmInvocation,
        })
      : undefined;
  const suppliedArchives =
    preparedPackageArchives ?? ownedPreparation.archives;
  const selectedArchives =
    suppliedArchives instanceof Map
      ? new Map(
          packageRoots.map((packageRoot) => [
            packageRoot,
            suppliedArchives.get(packageRoot),
          ]),
        )
      : suppliedArchives;
  try {
    const verifiedArchives =
      await verifyPreparedPackageArchives({
        repositoryRoot: destinationRoot,
        expectedPackageRoots: packageRoots,
        npmInvocation: exactNpmInvocation,
        prepared: selectedArchives,
      });
    const matches = [];
    const archives = [];
    for (const packageRoot of packageRoots) {
      const preparedArchive = verifiedArchives.get(packageRoot);
      if (preparedArchive === undefined) {
        throw new Error(
          `Verified package candidates omitted ${packageRoot}`,
        );
      }
      const archiveScan = await scanArchive(
        preparedArchive,
        packageRoot,
        forbiddenPatterns,
        exclusionRecorder,
      );
      matches.push(...archiveScan.matches);
      archives.push(
        Object.freeze({
          root: packageRoot,
          sha256: preparedArchive.sha256,
          fileCount: archiveScan.entries.length,
          files: Object.freeze(archiveScan.entries),
        }),
      );
    }
    return {
      result: scanResult(matches),
      archives: Object.freeze(archives),
      scanExclusions: exclusionRecorder.values(),
    };
  } finally {
    ownedPreparation?.dispose();
  }
}

function validateVerificationCommand(
  argv,
  destinationRoot,
  selectedPaths,
) {
  if (argv[0] !== "node" || argv.length < 2) {
    throw new Error(
      "Provenance verification commands must invoke one checked-in Node script",
    );
  }
  if (
    argv.some(
      (argument) =>
        argument === "--write" ||
        argument === "--import-unicode-data",
    )
  ) {
    throw new Error(
      "Provenance verification commands must not select a write or import mode",
    );
  }
  const scriptPath = resolve(destinationRoot, argv[1]);
  const repositoryRelative = normalizedRepositoryPath(
    relative(destinationRoot, scriptPath),
  );
  if (
    repositoryRelative === ".." ||
    repositoryRelative.startsWith("../") ||
    isAbsolute(repositoryRelative)
  ) {
    throw new Error(
      `Verification script escapes the repository: ${argv[1]}`,
    );
  }
  const stat = lstatSync(scriptPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      `Verification script must be a regular file: ${argv[1]}`,
    );
  }
  let tracked = true;
  try {
    runGit(destinationRoot, [
      "ls-files",
      "--error-unmatch",
      "--",
      repositoryRelative,
    ]);
  } catch {
    tracked = false;
  }
  if (!tracked && !selectedPaths.includes(repositoryRelative)) {
    throw new Error(
      `Verification script is neither tracked nor bound to the destination manifest: ${argv[1]}`,
    );
  }
}

function workingTreeSnapshot(destinationRoot, destinationBaseRef) {
  const entries = listChangedEntries(
    destinationRoot,
    destinationBaseRef,
    {
      includeSelfAuditing: true,
    },
  );
  return Object.freeze({
    manifest: createDestinationManifest(destinationRoot, entries),
    status: sha256(
      runGit(destinationRoot, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
    ),
  });
}

function resolveVerificationArguments(argv, artifactMap) {
  return argv.map((argument) => {
    if (!argument.startsWith("artifact:https://")) {
      return argument;
    }
    const sourceUrl = argument.slice("artifact:".length);
    const localPath = artifactMap.get(sourceUrl);
    if (localPath === undefined) {
      throw new Error(
        `Verification command requires a local artifact mapping for ${sourceUrl}`,
      );
    }
    return localPath;
  });
}

function runVerificationCommands(
  destinationRoot,
  destinationBaseRef,
  selectedPaths,
  artifactMap,
  commands,
) {
  return commands.map((command) => {
    validateVerificationCommand(
      command.argv,
      destinationRoot,
      selectedPaths,
    );
    const before = workingTreeSnapshot(
      destinationRoot,
      destinationBaseRef,
    );
    const executionArgv = resolveVerificationArguments(
      command.argv,
      artifactMap,
    );
    const execution = spawnSync(
      executionArgv[0],
      executionArgv.slice(1),
      {
        cwd: destinationRoot,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout = Buffer.isBuffer(execution.stdout)
      ? execution.stdout
      : Buffer.alloc(0);
    const stderr = Buffer.isBuffer(execution.stderr)
      ? execution.stderr
      : Buffer.alloc(0);
    const exitCode =
      typeof execution.status === "number"
        ? execution.status
        : 1;
    const after = workingTreeSnapshot(
      destinationRoot,
      destinationBaseRef,
    );
    if (
      before.status !== after.status ||
      before.manifest.sha256 !== after.manifest.sha256
    ) {
      throw new Error(
        `Verification command modified the repository: ${command.argv.join(" ")}`,
      );
    }
    if (execution.error !== undefined) {
      throw execution.error;
    }
    const result = Object.freeze({
      argv: Object.freeze([...command.argv]),
      exitCode,
      stdoutSha256: sha256(stdout),
      stderrSha256: sha256(stderr),
    });
    if (exitCode !== 0) {
      throw new Error(
        `Verification command failed (${exitCode}): ${command.argv.join(" ")}`,
      );
    }
    return result;
  });
}

function sourceMapping(sourceMap, repository, destinationRecord, destinationRoot) {
  if (repository === destinationRecord.batch.destinationRepository) {
    return destinationRoot;
  }
  const mapped = sourceMap.get(repository);
  if (mapped === undefined) {
    throw new Error(
      `No offline source checkout was provided for ${repository}`,
    );
  }
  return mapped;
}

function checkedRepositoryFile(destinationRoot, filePath, label) {
  const absolutePath = resolve(destinationRoot, filePath);
  const repositoryRelative = normalizedRepositoryPath(
    relative(destinationRoot, absolutePath),
  );
  if (
    repositoryRelative === ".." ||
    repositoryRelative.startsWith("../") ||
    isAbsolute(repositoryRelative) ||
    repositoryRelative !== filePath
  ) {
    throw new Error(`${label} escapes the repository: ${filePath}`);
  }
  const stat = lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
  return absolutePath;
}

export function verifyInstalledInputs(record, destinationRoot) {
  const evidenceByIdentity = new Map();
  const gitSources = [
    record.auditedSource,
    ...record.additionalSources.filter(
      (source) => source.kind === "git",
    ),
    record.specifications,
  ];
  for (const source of gitSources) {
    for (const evidence of source.evidence) {
      const key =
        `${source.repository}\0${source.ref}\0${evidence.path}`;
      const previous = evidenceByIdentity.get(key);
      if (
        previous !== undefined &&
        previous.sha256 !== evidence.sha256
      ) {
        throw new Error(
          `Conflicting Git evidence hash for ${source.repository}@${source.ref}:${evidence.path}`,
        );
      }
      evidenceByIdentity.set(key, evidence);
    }
  }
  return Object.freeze(
    record.audit.installedInputs
      .map((input) => {
        const evidence = evidenceByIdentity.get(
          `${input.sourceRepository}\0${input.sourceRef}\0${input.sourcePath}`,
        );
        if (evidence === undefined) {
          throw new Error(
            `Installed input ${input.installedPath} is not bound to declared Git source evidence`,
          );
        }
        const installedPath = checkedRepositoryFile(
          destinationRoot,
          input.installedPath,
          "Installed provenance input",
        );
        const actualHash = sha256(readFileSync(installedPath));
        if (actualHash !== evidence.sha256) {
          throw new Error(
            `Installed input ${input.installedPath} has ${actualHash}, expected source evidence ${evidence.sha256}`,
          );
        }
        return Object.freeze({
          ...input,
          sha256: actualHash,
        });
      })
      .sort((left, right) =>
        compareText(left.installedPath, right.installedPath)
      ),
  );
}

export async function auditRecord({
  record,
  destinationRoot,
  changedEntries,
  changedPaths,
  sourceMap,
  artifactMap,
  skipPackages = false,
  npmInvocation,
  preparedPackageArchives,
}) {
  // Captured before any subprocess runs. Declared regeneration and verification
  // commands execute inside this audit, so the scanner closure is recomputed
  // afterwards and the two must agree.
  const scannerIdentity = createScannerIdentity({
    repositoryRoot: scannerRepositoryRoot,
  });
  resolveCommit(destinationRoot, record.batch.destinationBaseRef);
  const effectiveChangedEntries =
    changedEntries ??
    changedPaths.map((filePath) =>
      Object.freeze({
        path: filePath,
        status: "present",
      })
    );
  const selectedPaths =
    record.audit.coverageMode === "working-tree"
      ? pathsForRecord(record, effectiveChangedEntries)
      : Object.freeze([]);
  if (
    record.audit.coverageMode === "working-tree" &&
    selectedPaths.length === 0
  ) {
    throw new Error(
      `${record.recordId} has an empty working-tree destination manifest`,
    );
  }
  const destinationManifest = createDestinationManifest(
    destinationRoot,
    selectedPaths,
  );
  const destination = destinationDocuments(
    destinationRoot,
    selectedPaths,
  );
  const exclusionRecorder = createScanExclusionRecorder();

  const sourceVerifications = [];
  const scanSources = [];
  const primary = gitSourceVerification(
    record.auditedSource,
    sourceMapping(
      sourceMap,
      record.auditedSource.repository,
      record,
      destinationRoot,
    ),
    record.classification === "fresh-cpal",
  );
  sourceVerifications.push(primary.verification);
  scanSources.push(...primary.documents);

  for (const source of record.additionalSources) {
    if (source.kind === "git") {
      const verification = gitSourceVerification(
        source,
        sourceMapping(
          sourceMap,
          source.repository,
          record,
          destinationRoot,
        ),
        false,
      );
      sourceVerifications.push(verification.verification);
      scanSources.push(...verification.documents);
    } else {
      const verification = artifactSourceVerification(
        source,
        artifactMap.get(source.url),
      );
      sourceVerifications.push(verification.verification);
      scanSources.push(...verification.documents);
    }
  }

  const specifications = gitSourceVerification(
    record.specifications,
    sourceMapping(
      sourceMap,
      record.specifications.repository,
      record,
      destinationRoot,
    ),
    false,
  );
  sourceVerifications.push(specifications.verification);

  if (
    record.status === "accepted" &&
    sourceVerifications.some((source) => !source.verified)
  ) {
    throw new Error(
      `${record.recordId} is accepted but at least one source was not verified`,
    );
  }

  const packageScan = skipPackages
    ? {
        result: scanResult([], record.audit.packageRoots.length === 0),
        archives: Object.freeze([]),
      }
    : await auditPackages(
        destinationRoot,
        record.audit.packageRoots,
        record.audit.forbiddenPackagePatterns,
        exclusionRecorder,
        {
          npmInvocation,
          preparedPackageArchives,
        },
      );
  const installedInputs = verifyInstalledInputs(
    record,
    destinationRoot,
  );
  const receipt = Object.freeze({
    $schema: receiptSchema,
    schemaVersion: "1.2.0",
    recordId: record.recordId,
    performedAt: record.scans.performedAt,
    destinationBaseRef: record.batch.destinationBaseRef,
    destinationManifest,
    stableClaims: createStableClaimsDigest(record),
    scanner: scannerIdentity,
    sources: Object.freeze(sourceVerifications),
    scans: Object.freeze({
      exactBlob: exactBlobScan(scanSources, destination),
      normalizedLine: normalizedLineScan(
        scanSources,
        destination,
        exclusionRecorder,
      ),
      tokenShingle: tokenShingleScan(
        scanSources,
        destination,
        exclusionRecorder,
      ),
      ccPhrase: ccPhraseScan(
        scanSources,
        destination,
        record.audit.ccSourcePaths,
        exclusionRecorder,
      ),
      packageLeak: packageScan.result,
    }),
    verificationCommands: Object.freeze(
      runVerificationCommands(
        destinationRoot,
        record.batch.destinationBaseRef,
        selectedPaths.map((entry) => entry.path),
        artifactMap,
        record.audit.verificationCommands,
      ),
    ),
    packageArchives: packageScan.archives,
    installedInputs,
    scanExclusions: exclusionRecorder.values(),
  });
  const scannerIdentityAfter = createScannerIdentity({
    repositoryRoot: scannerRepositoryRoot,
  });
  if (scannerIdentityAfter.sha256 !== scannerIdentity.sha256) {
    throw new Error(
      `${record.recordId}: the scanner runtime closure changed during the audit, so its results cannot be attributed to one implementation`,
    );
  }
  return receipt;
}

function parseMapping(value, optionName) {
  const separatorIndex = value.indexOf("=");
  if (separatorIndex < 1 || separatorIndex === value.length - 1) {
    throw new Error(
      `${optionName} requires <source>=<local-path>`,
    );
  }
  return [
    value.slice(0, separatorIndex),
    value.slice(separatorIndex + 1),
  ];
}

function parseArguments(argv) {
  const options = {
    artifactMap: new Map(),
    destinationRoot: process.cwd(),
    emitReceipt: undefined,
    emitReceiptDirectory: undefined,
    recordPaths: [],
    skipPackages: false,
    sourceMap: new Map(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--record") {
      options.recordPaths.push(argv[++index]);
    } else if (option === "--destination") {
      options.destinationRoot = resolve(argv[++index]);
    } else if (option === "--source") {
      const [source, localPath] = parseMapping(
        argv[++index],
        "--source",
      );
      options.sourceMap.set(source, resolve(localPath));
    } else if (option === "--artifact") {
      const [source, localPath] = parseMapping(
        argv[++index],
        "--artifact",
      );
      options.artifactMap.set(source, resolve(localPath));
    } else if (option === "--emit-receipt") {
      options.emitReceipt = argv[++index];
    } else if (option === "--emit-receipt-dir") {
      options.emitReceiptDirectory = argv[++index];
    } else if (option === "--skip-packages") {
      options.skipPackages = true;
    } else {
      throw new Error(`Unknown provenance audit option ${option}`);
    }
  }
  if (
    options.emitReceipt !== undefined &&
    options.emitReceiptDirectory !== undefined
  ) {
    throw new Error(
      "--emit-receipt and --emit-receipt-dir are mutually exclusive",
    );
  }
  return options;
}

function defaultRecordPaths(destinationRoot) {
  const recordsRoot = resolve(destinationRoot, "provenance/records");
  return readdirSync(recordsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(recordsRoot, entry.name))
    .sort(compareText);
}

export async function runAuditCli(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const recordPaths =
    options.recordPaths.length === 0
      ? defaultRecordPaths(options.destinationRoot)
      : options.recordPaths.map((recordPath) =>
          resolve(options.destinationRoot, recordPath)
        );
  const validateRecord = await createRecordValidator();
  const records = recordPaths.map((recordPath) => {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    const result = validateRecord(record);
    if (!result.valid) {
      throw new Error(
        `${recordPath} is invalid:\n${result.errors.join("\n")}`,
      );
    }
    return record;
  });
  const baseRefs = new Set(
    records
      .filter((record) => record.audit.coverageMode === "working-tree")
      .map((record) => record.batch.destinationBaseRef),
  );
  if (baseRefs.size !== 1) {
    throw new Error(
      "Working-tree provenance records must share one destination base ref",
    );
  }
  const [destinationBaseRef] = baseRefs;
  const changedEntries = listChangedEntries(
    options.destinationRoot,
    destinationBaseRef,
  );
  verifyCoverage(records, changedEntries);
  const workingTreeRecords = records.filter(
    (record) => record.audit.coverageMode === "working-tree",
  );
  const packageRoots = [
    ...new Set(
      workingTreeRecords.flatMap(
        (record) => record.audit.packageRoots,
      ),
    ),
  ].sort(compareText);
  const npmInvocation =
    options.skipPackages || packageRoots.length === 0
      ? undefined
      : resolveExactNpmInvocation({
          repositoryRoot: options.destinationRoot,
        });
  const preparedPackages =
    options.skipPackages || packageRoots.length === 0
      ? undefined
      : await preparePackageArchives({
          repositoryRoot: options.destinationRoot,
          packageRoots,
          npmInvocation,
        });
  const receipts = [];
  try {
    // Sequential by construction. Each record snapshots the working tree around
    // its verification commands, so auditing two records concurrently would race
    // that comparison against itself.
    for (const record of workingTreeRecords) {
      receipts.push(
        await auditRecord({
          record,
          destinationRoot: options.destinationRoot,
          changedEntries,
          sourceMap: options.sourceMap,
          artifactMap: options.artifactMap,
          skipPackages: options.skipPackages,
          npmInvocation,
          preparedPackageArchives:
            preparedPackages?.archives,
        }),
      );
    }
  } finally {
    preparedPackages?.dispose();
  }

  const serialized = `${JSON.stringify(
    receipts.length === 1 ? receipts[0] : receipts,
    null,
    2,
  )}\n`;
  if (options.emitReceiptDirectory !== undefined) {
    const outputDirectory = resolve(
      options.destinationRoot,
      options.emitReceiptDirectory,
    );
    const outputPaths = receipts.map((receipt) =>
      join(outputDirectory, `${receipt.recordId}.json`)
    );
    const existingOutput = outputPaths.find((outputPath) =>
      existsSync(outputPath)
    );
    if (existingOutput !== undefined) {
      throw new Error(
        `Refusing to overwrite existing receipt ${normalizedRepositoryPath(relative(options.destinationRoot, existingOutput))}`,
      );
    }
    mkdirSync(outputDirectory, {
      recursive: true,
    });
    for (const [index, receipt] of receipts.entries()) {
      const outputPath = outputPaths[index];
      writeFileSync(
        outputPath,
        `${JSON.stringify(receipt, null, 2)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
        },
      );
    }
    process.stdout.write(
      `Wrote ${receipts.length} provenance receipt(s) to ${options.emitReceiptDirectory}.\n`,
    );
  } else if (
    options.emitReceipt === undefined ||
    options.emitReceipt === "-"
  ) {
    process.stdout.write(serialized);
  } else {
    if (receipts.length !== 1) {
      throw new Error(
        "--emit-receipt requires exactly one working-tree record; use --emit-receipt-dir for an audited batch",
      );
    }
    const outputPath = resolve(
      options.destinationRoot,
      options.emitReceipt,
    );
    if (existsSync(outputPath)) {
      throw new Error(
        `Refusing to overwrite existing receipt ${options.emitReceipt}`,
      );
    }
    writeFileSync(outputPath, serialized, {
      encoding: "utf8",
      flag: "wx",
    });
    process.stdout.write(
      `Wrote ${receipts.length} provenance receipt(s) to ${options.emitReceipt}.\n`,
    );
  }
  return receipts;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runAuditCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
