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

import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readlink,
  realpath,
} from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  canonicalizeJson,
  sha256,
} from "@genii-foundation/publisher-content";
import type {
  Sha256Digest,
} from "@genii-foundation/publisher-content";

export const PREVIEW_CANDIDATE_IDENTITY_VERSION = "1.0" as const;

export const PREVIEW_CANDIDATE_LIMITS = Object.freeze({
  maximumBranchBytes: 1_024,
  maximumEntries: 100_000,
  maximumFileBytes: 512 * 1024 * 1024,
  maximumGitOutputBytes: 32 * 1024 * 1024,
  maximumPathBytes: 16 * 1024 * 1024,
  maximumTotalBytes: 4 * 1024 * 1024 * 1024,
  maximumWorktreePathBytes: 64 * 1024,
});

export type PreviewCandidateEntryKind = "file" | "symbolic-link";

export interface PreviewCandidateEntry {
  /** Git-relative UTF-8 path, with slash separators. */
  readonly path: string;
  readonly kind: PreviewCandidateEntryKind;
  /** Regular file contents or raw symbolic-link target bytes. */
  readonly bytes: number;
  readonly sha256: Sha256Digest;
}

export interface PreviewCandidateIdentity {
  readonly schemaVersion: typeof PREVIEW_CANDIDATE_IDENTITY_VERSION;
  /** Canonical absolute path that distinguishes this Git worktree locally. */
  readonly worktreeRoot: string;
  /** Branch name, or null when HEAD is detached. */
  readonly branch: string | null;
  /** Exact commit at HEAD while the candidate bytes were captured. */
  readonly commit: string;
  /** Whether tracked, staged, or untracked Git state differs from HEAD. */
  readonly dirty: boolean;
  /** Exact present tracked and untracked, nonignored source tree. */
  readonly candidate: {
    readonly digest: Sha256Digest;
    readonly entries: readonly PreviewCandidateEntry[];
    readonly entryCount: number;
    readonly byteCount: number;
  };
  /** Binds the worktree, branch, commit, state, and candidate tree. */
  readonly identityDigest: Sha256Digest;
}

export interface CapturePreviewCandidateIdentityInput {
  readonly hostRoot: string;
}

export type PreviewCandidateMismatch =
  | "branch"
  | "candidate"
  | "commit"
  | "dirty"
  | "identity"
  | "worktree";

export interface VerifyPreviewCandidateIdentityInput {
  readonly hostRoot: string;
  readonly expected: PreviewCandidateIdentity | unknown;
}

export interface PreviewCandidateVerification {
  readonly matches: boolean;
  readonly mismatches: readonly PreviewCandidateMismatch[];
  readonly expected: PreviewCandidateIdentity;
  readonly actual: PreviewCandidateIdentity;
}

export class PreviewCandidateIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewCandidateIdentityError";
  }
}

interface GitSnapshot {
  readonly branch: string | null;
  readonly commit: string;
  readonly dirty: boolean;
  readonly paths: readonly string[];
  readonly token: string;
  readonly worktreeRoot: string;
}

interface GitResult {
  readonly status: number;
  readonly stderr: Uint8Array;
  readonly stdout: Uint8Array;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
const noFollowFlag =
  typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
const nonblockingFlag =
  typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function decodeUtf8(value: Uint8Array, label: string): string {
  try {
    return utf8.decode(value);
  } catch {
    throw new PreviewCandidateIdentityError(
      `${label} is not valid UTF-8, so it cannot be represented in portable preview evidence.`,
    );
  }
}

function utf8ByteLength(value: string, label: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new PreviewCandidateIdentityError(
          `${label} contains an unpaired Unicode surrogate.`,
        );
      }
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new PreviewCandidateIdentityError(
        `${label} contains an unpaired Unicode surrogate.`,
      );
    }
  }
  return Buffer.byteLength(value, "utf8");
}

function git(
  cwd: string,
  args: readonly string[],
  acceptedStatuses: readonly number[] = [0],
): GitResult {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "buffer",
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
    },
    maxBuffer: PREVIEW_CANDIDATE_LIMITS.maximumGitOutputBytes,
  });
  if (result.error !== undefined) {
    throw new PreviewCandidateIdentityError(
      `Git could not inspect the preview candidate: ${result.error.message}`,
    );
  }
  const status = result.status ?? 1;
  const stdout = new Uint8Array(result.stdout ?? new Uint8Array());
  const stderr = new Uint8Array(result.stderr ?? new Uint8Array());
  if (!acceptedStatuses.includes(status)) {
    const detail = decodeUtf8(stderr, "Git error output").trim();
    throw new PreviewCandidateIdentityError(
      `Git ${args[0] ?? "command"} failed with status ${status}${
        detail.length === 0 ? "." : `: ${detail}`
      }`,
    );
  }
  return Object.freeze({ status, stderr, stdout });
}

function withoutFinalLineFeed(value: Uint8Array, label: string): string {
  if (value.byteLength === 0 || value[value.byteLength - 1] !== 0x0a) {
    throw new PreviewCandidateIdentityError(
      `Git did not terminate ${label} with one line feed.`,
    );
  }
  const body = value.subarray(0, value.byteLength - 1);
  if (body.includes(0x0a) || body.includes(0x0d)) {
    throw new PreviewCandidateIdentityError(
      `${label} contains a line break and cannot be represented unambiguously.`,
    );
  }
  return decodeUtf8(body, label);
}

function splitNullTerminated(
  value: Uint8Array,
  label: string,
): readonly Uint8Array[] {
  if (value.byteLength === 0) {
    return Object.freeze([]);
  }
  if (value[value.byteLength - 1] !== 0) {
    throw new PreviewCandidateIdentityError(
      `Git returned an unterminated ${label} list.`,
    );
  }
  const entries: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < value.byteLength; index += 1) {
    if (value[index] !== 0) {
      continue;
    }
    if (index === start) {
      throw new PreviewCandidateIdentityError(
        `Git returned an empty entry in its ${label} list.`,
      );
    }
    entries.push(value.subarray(start, index));
    start = index + 1;
  }
  return Object.freeze(entries);
}

function assertCandidatePath(path: string): void {
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.includes("\0") ||
    isAbsolute(path) ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new PreviewCandidateIdentityError(
      `Git returned an unsafe candidate path ${JSON.stringify(path)}.`,
    );
  }
  utf8ByteLength(path, "Candidate path");
}

function pathsFrom(value: Uint8Array, label: string): readonly string[] {
  const raw = splitNullTerminated(value, label);
  const paths: string[] = [];
  let pathBytes = 0;
  for (const bytes of raw) {
    pathBytes += bytes.byteLength;
    if (pathBytes > PREVIEW_CANDIDATE_LIMITS.maximumPathBytes) {
      throw new PreviewCandidateIdentityError(
        `Candidate paths exceed ${PREVIEW_CANDIDATE_LIMITS.maximumPathBytes.toLocaleString("en-US")} bytes.`,
      );
    }
    const path = decodeUtf8(bytes, `Git ${label} path`);
    assertCandidatePath(path);
    paths.push(path);
  }
  return Object.freeze(paths);
}

function assertUsableIndex(cwd: string): void {
  const unmerged = git(cwd, ["ls-files", "--unmerged", "-z"]).stdout;
  if (unmerged.byteLength > 0) {
    throw new PreviewCandidateIdentityError(
      "A preview candidate cannot be captured from an unmerged Git index.",
    );
  }
  for (const record of splitNullTerminated(
    git(cwd, ["ls-files", "--stage", "-z"]).stdout,
    "staged file",
  )) {
    const tab = record.indexOf(0x09);
    if (tab < 0) {
      throw new PreviewCandidateIdentityError(
        "Git returned a malformed staged file record.",
      );
    }
    const metadata = decodeUtf8(record.subarray(0, tab), "Git index metadata");
    const match = /^(\d{6}) [0-9a-f]+ 0$/u.exec(metadata);
    if (match === null) {
      throw new PreviewCandidateIdentityError(
        `Git returned unusable index metadata ${JSON.stringify(metadata)}.`,
      );
    }
    if (match[1] === "160000") {
      const path = decodeUtf8(record.subarray(tab + 1), "Git submodule path");
      throw new PreviewCandidateIdentityError(
        `Preview identity does not guess the bytes behind Git submodule ${JSON.stringify(path)}. Capture that repository separately.`,
      );
    }
  }
}

async function gitSnapshot(hostRoot: string): Promise<GitSnapshot> {
  const inside = withoutFinalLineFeed(
    git(hostRoot, ["rev-parse", "--is-inside-work-tree"]).stdout,
    "worktree state",
  );
  if (inside !== "true") {
    throw new PreviewCandidateIdentityError(
      `${hostRoot} is not inside a Git worktree.`,
    );
  }
  const reportedRoot = withoutFinalLineFeed(
    git(hostRoot, ["rev-parse", "--show-toplevel"]).stdout,
    "worktree root",
  );
  if (!isAbsolute(reportedRoot)) {
    throw new PreviewCandidateIdentityError(
      `Git reported a nonabsolute worktree root ${JSON.stringify(reportedRoot)}.`,
    );
  }
  const worktreeRoot = await realpath(reportedRoot);
  if (
    utf8ByteLength(worktreeRoot, "Git worktree root") >
    PREVIEW_CANDIDATE_LIMITS.maximumWorktreePathBytes
  ) {
    throw new PreviewCandidateIdentityError(
      "Git worktree root exceeds the preview evidence path limit.",
    );
  }
  const fromRoot = relative(worktreeRoot, hostRoot);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new PreviewCandidateIdentityError(
      `The host root ${hostRoot} is outside Git worktree ${worktreeRoot}.`,
    );
  }
  const commit = withoutFinalLineFeed(
    git(worktreeRoot, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout,
    "HEAD commit",
  );
  if (!COMMIT.test(commit)) {
    throw new PreviewCandidateIdentityError(
      `Git reported an unusable HEAD commit ${JSON.stringify(commit)}.`,
    );
  }
  const branchResult = git(
    worktreeRoot,
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    [0, 1],
  );
  const branch =
    branchResult.status === 1
      ? null
      : withoutFinalLineFeed(branchResult.stdout, "branch name");
  if (branch !== null && branch.length === 0) {
    throw new PreviewCandidateIdentityError(
      "Git reported an empty branch name.",
    );
  }
  if (
    branch !== null &&
    utf8ByteLength(branch, "Git branch name") >
      PREVIEW_CANDIDATE_LIMITS.maximumBranchBytes
  ) {
    throw new PreviewCandidateIdentityError(
      "Git branch name exceeds the preview evidence limit.",
    );
  }

  assertUsableIndex(worktreeRoot);
  const tracked = git(worktreeRoot, ["ls-files", "--cached", "-z"]).stdout;
  const untracked = git(worktreeRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]).stdout;
  const status = git(worktreeRoot, [
    "status",
    "--porcelain=v2",
    "--untracked-files=all",
    "-z",
  ]).stdout;
  const paths = [...pathsFrom(tracked, "tracked file"), ...pathsFrom(untracked, "untracked file")];
  paths.sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  if (paths.length > PREVIEW_CANDIDATE_LIMITS.maximumEntries) {
    throw new PreviewCandidateIdentityError(
      `Candidate has ${paths.length.toLocaleString("en-US")} paths, above the ${PREVIEW_CANDIDATE_LIMITS.maximumEntries.toLocaleString("en-US")} entry limit.`,
    );
  }
  for (let index = 1; index < paths.length; index += 1) {
    if (paths[index - 1] === paths[index]) {
      throw new PreviewCandidateIdentityError(
        `Git returned candidate path ${JSON.stringify(paths[index])} more than once.`,
      );
    }
  }
  const snapshotHash = createHash("sha256");
  const frame = (label: string, value: string | Uint8Array): void => {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
    snapshotHash
      .update(label)
      .update("\0")
      .update(bytes.byteLength.toString())
      .update("\0")
      .update(bytes);
  };
  frame("domain", "genii-publisher-preview-git-snapshot-v1");
  frame("worktree", worktreeRoot);
  frame("branch", branch ?? "");
  frame("commit", commit);
  frame("tracked", tracked);
  frame("untracked", untracked);
  frame("status", status);
  const token = snapshotHash.digest("hex");
  return Object.freeze({
    branch,
    commit,
    dirty: status.byteLength > 0,
    paths: Object.freeze(paths),
    token,
    worktreeRoot,
  });
}

function sameNode(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function hashDescriptor(
  handle: Awaited<ReturnType<typeof open>>,
  expectedBytes: number,
): Promise<Sha256Digest> {
  const hash = createHash("sha256");
  const buffer = new Uint8Array(64 * 1024);
  let position = 0;
  while (position < expectedBytes) {
    const wanted = Math.min(buffer.byteLength, expectedBytes - position);
    const { bytesRead } = await handle.read(buffer, 0, wanted, position);
    if (bytesRead === 0) {
      break;
    }
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  if (position !== expectedBytes) {
    throw new PreviewCandidateIdentityError(
      `A candidate file changed size while it was being read. Expected ${expectedBytes.toLocaleString("en-US")} bytes and read ${position.toLocaleString("en-US")}.`,
    );
  }
  const extra = new Uint8Array(1);
  if ((await handle.read(extra, 0, 1, position)).bytesRead !== 0) {
    throw new PreviewCandidateIdentityError(
      "A candidate file grew while it was being read.",
    );
  }
  return `sha256:${hash.digest("hex")}`;
}

async function regularFileEntry(
  absolutePath: string,
  path: string,
  before: BigIntStats,
): Promise<PreviewCandidateEntry> {
  if (before.size > BigInt(PREVIEW_CANDIDATE_LIMITS.maximumFileBytes)) {
    throw new PreviewCandidateIdentityError(
      `${path} exceeds the ${PREVIEW_CANDIDATE_LIMITS.maximumFileBytes.toLocaleString("en-US")} byte per-file limit.`,
    );
  }
  const bytes = Number(before.size);
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | noFollowFlag | nonblockingFlag,
  );
  try {
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || !sameNode(before, openedBefore)) {
      throw new PreviewCandidateIdentityError(
        `${path} changed identity before its bytes could be read.`,
      );
    }
    const first = await hashDescriptor(handle, bytes);
    const second = await hashDescriptor(handle, bytes);
    const openedAfter = await handle.stat({ bigint: true });
    if (first !== second || !sameNode(openedBefore, openedAfter)) {
      throw new PreviewCandidateIdentityError(
        `${path} changed while its preview bytes were being captured.`,
      );
    }
    const pathAfter = await lstat(absolutePath, { bigint: true });
    if (!pathAfter.isFile() || !sameNode(openedAfter, pathAfter)) {
      throw new PreviewCandidateIdentityError(
        `${path} no longer names the file whose bytes were captured.`,
      );
    }
    return Object.freeze({ path, kind: "file", bytes, sha256: first });
  } finally {
    await handle.close();
  }
}

async function symbolicLinkEntry(
  absolutePath: string,
  path: string,
  before: BigIntStats,
): Promise<PreviewCandidateEntry> {
  const target = new Uint8Array(
    await readlink(absolutePath, { encoding: "buffer" }),
  );
  if (target.byteLength > PREVIEW_CANDIDATE_LIMITS.maximumFileBytes) {
    throw new PreviewCandidateIdentityError(
      `${path} has a symbolic-link target above the per-file byte limit.`,
    );
  }
  const after = await lstat(absolutePath, { bigint: true });
  if (!after.isSymbolicLink() || !sameNode(before, after)) {
    throw new PreviewCandidateIdentityError(
      `${path} changed while its symbolic-link target was being captured.`,
    );
  }
  return Object.freeze({
    path,
    kind: "symbolic-link",
    bytes: target.byteLength,
    sha256: sha256(target),
  });
}

async function candidateEntry(
  worktreeRoot: string,
  path: string,
  directories: Map<string, BigIntStats>,
): Promise<PreviewCandidateEntry | null> {
  const segments = path.split("/");
  let parent = worktreeRoot;
  for (const segment of segments.slice(0, -1)) {
    parent = join(parent, segment);
    let identity = directories.get(parent);
    if (identity === undefined) {
      try {
        identity = await lstat(parent, { bigint: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
      if (!identity.isDirectory() || identity.isSymbolicLink()) {
        throw new PreviewCandidateIdentityError(
          `${path} passes through a non-directory or symbolic-link parent ${parent}.`,
        );
      }
      directories.set(parent, identity);
    }
  }
  const absolutePath = join(worktreeRoot, ...segments);
  let before: BigIntStats;
  try {
    before = await lstat(absolutePath, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (before.isFile()) {
    return regularFileEntry(absolutePath, path, before);
  }
  if (before.isSymbolicLink()) {
    return symbolicLinkEntry(absolutePath, path, before);
  }
  throw new PreviewCandidateIdentityError(
    `${path} is neither a regular file nor a symbolic link, so its preview bytes are undefined.`,
  );
}

function candidateDigest(entries: readonly PreviewCandidateEntry[]): Sha256Digest {
  return sha256(
    canonicalizeJson({
      domain: "genii-publisher-preview-candidate-v1",
      entries,
    } as never),
  );
}

function completeIdentity(
  snapshot: GitSnapshot,
  entries: readonly PreviewCandidateEntry[],
): PreviewCandidateIdentity {
  const frozenEntries = Object.freeze([...entries]);
  const byteCount = frozenEntries.reduce((sum, entry) => sum + entry.bytes, 0);
  const candidate = Object.freeze({
    digest: candidateDigest(frozenEntries),
    entries: frozenEntries,
    entryCount: frozenEntries.length,
    byteCount,
  });
  const core = {
    schemaVersion: PREVIEW_CANDIDATE_IDENTITY_VERSION,
    worktreeRoot: snapshot.worktreeRoot,
    branch: snapshot.branch,
    commit: snapshot.commit,
    dirty: snapshot.dirty,
    candidate,
  };
  return Object.freeze({
    ...core,
    identityDigest: sha256(
      canonicalizeJson({
        domain: "genii-publisher-preview-identity-v1",
        identity: core,
      } as never),
    ),
  });
}

function assertCanonicalHostRoot(hostRoot: string): Promise<string> {
  if (
    typeof hostRoot !== "string" ||
    !isAbsolute(hostRoot) ||
    resolve(hostRoot) !== hostRoot
  ) {
    throw new PreviewCandidateIdentityError(
      "Preview identity requires a lexically canonical absolute host root.",
    );
  }
  return realpath(hostRoot).then((canonical) => {
    if (canonical !== hostRoot) {
      throw new PreviewCandidateIdentityError(
        `Preview identity requires the canonical host root ${canonical}, not ${hostRoot}.`,
      );
    }
    return canonical;
  });
}

/**
 * Captures one exact Git candidate tree without writing or contacting a remote.
 *
 * The candidate is every present tracked or untracked, nonignored path. Ignored
 * dependencies, build output, credentials, and local state are deliberately not
 * claimed. The caller should capture after a managed preview has finished any
 * source-generating startup work.
 */
export async function capturePreviewCandidateIdentity(
  input: CapturePreviewCandidateIdentityInput,
): Promise<PreviewCandidateIdentity> {
  const hostRoot = await assertCanonicalHostRoot(input.hostRoot);
  const before = await gitSnapshot(hostRoot);
  const directories = new Map<string, BigIntStats>();
  const rootIdentity = await lstat(before.worktreeRoot, { bigint: true });
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink()) {
    throw new PreviewCandidateIdentityError(
      `Git worktree root is not a stable directory: ${before.worktreeRoot}`,
    );
  }
  directories.set(before.worktreeRoot, rootIdentity);
  const entries: PreviewCandidateEntry[] = [];
  const missingPaths: string[] = [];
  let byteCount = 0;
  for (const path of before.paths) {
    const entry = await candidateEntry(before.worktreeRoot, path, directories);
    if (entry === null) {
      missingPaths.push(path);
      continue;
    }
    byteCount += entry.bytes;
    if (byteCount > PREVIEW_CANDIDATE_LIMITS.maximumTotalBytes) {
      throw new PreviewCandidateIdentityError(
        `Candidate bytes exceed the ${PREVIEW_CANDIDATE_LIMITS.maximumTotalBytes.toLocaleString("en-US")} byte total limit.`,
      );
    }
    entries.push(entry);
  }
  for (const path of missingPaths) {
    const absolutePath = join(before.worktreeRoot, ...path.split("/"));
    try {
      await lstat(absolutePath, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
    throw new PreviewCandidateIdentityError(
      `${path} appeared while candidate bytes were being captured.`,
    );
  }
  for (const [path, identity] of directories) {
    const current = await lstat(path, { bigint: true });
    if (!current.isDirectory() || !sameNode(identity, current)) {
      throw new PreviewCandidateIdentityError(
        `Candidate directory changed while bytes were being captured: ${path}`,
      );
    }
  }
  const after = await gitSnapshot(hostRoot);
  if (before.token !== after.token) {
    throw new PreviewCandidateIdentityError(
      "Git branch, commit, index, status, or candidate paths changed during preview capture. Retry from a stable worktree.",
    );
  }
  return completeIdentity(before, entries);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PreviewCandidateIdentityError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new PreviewCandidateIdentityError(
      `${label} must contain exactly ${wanted.join(", ")}.`,
    );
  }
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !HASH.test(value)) {
    throw new PreviewCandidateIdentityError(
      `${label} must be a canonical SHA-256 digest.`,
    );
  }
  return value as Sha256Digest;
}

function boundedInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new PreviewCandidateIdentityError(
      `${label} must be an integer from 0 through ${maximum.toLocaleString("en-US")}.`,
    );
  }
  return value as number;
}

/** Parses and authenticates the internal digests of saved preview evidence. */
export function parsePreviewCandidateIdentity(
  value: unknown,
): PreviewCandidateIdentity {
  const root = record(value, "Preview identity");
  exactKeys(
    root,
    [
      "branch",
      "candidate",
      "commit",
      "dirty",
      "identityDigest",
      "schemaVersion",
      "worktreeRoot",
    ],
    "Preview identity",
  );
  if (root.schemaVersion !== PREVIEW_CANDIDATE_IDENTITY_VERSION) {
    throw new PreviewCandidateIdentityError(
      `Unsupported preview identity version ${JSON.stringify(root.schemaVersion)}.`,
    );
  }
  if (
    typeof root.worktreeRoot !== "string" ||
    !isAbsolute(root.worktreeRoot) ||
    resolve(root.worktreeRoot) !== root.worktreeRoot ||
    utf8ByteLength(root.worktreeRoot, "Preview identity worktreeRoot") >
      PREVIEW_CANDIDATE_LIMITS.maximumWorktreePathBytes
  ) {
    throw new PreviewCandidateIdentityError(
      "Preview identity worktreeRoot must be a canonical absolute path.",
    );
  }
  if (
    root.branch !== null &&
    (typeof root.branch !== "string" ||
      root.branch.length === 0 ||
      utf8ByteLength(root.branch, "Preview identity branch") >
        PREVIEW_CANDIDATE_LIMITS.maximumBranchBytes)
  ) {
    throw new PreviewCandidateIdentityError(
      "Preview identity branch must be a nonempty string or null.",
    );
  }
  if (typeof root.commit !== "string" || !COMMIT.test(root.commit)) {
    throw new PreviewCandidateIdentityError(
      "Preview identity commit must be a full Git object identifier.",
    );
  }
  if (typeof root.dirty !== "boolean") {
    throw new PreviewCandidateIdentityError(
      "Preview identity dirty must be a boolean.",
    );
  }
  const rawCandidate = record(root.candidate, "Preview candidate");
  exactKeys(
    rawCandidate,
    ["byteCount", "digest", "entries", "entryCount"],
    "Preview candidate",
  );
  if (!Array.isArray(rawCandidate.entries)) {
    throw new PreviewCandidateIdentityError(
      "Preview candidate entries must be an array.",
    );
  }
  if (rawCandidate.entries.length > PREVIEW_CANDIDATE_LIMITS.maximumEntries) {
    throw new PreviewCandidateIdentityError(
      "Preview candidate contains too many entries.",
    );
  }
  const entries: PreviewCandidateEntry[] = [];
  let prior: string | null = null;
  let pathBytes = 0;
  let byteCount = 0;
  for (const [index, rawEntry] of rawCandidate.entries.entries()) {
    const item = record(rawEntry, `Preview candidate entry ${index}`);
    exactKeys(item, ["bytes", "kind", "path", "sha256"], `Preview candidate entry ${index}`);
    if (typeof item.path !== "string") {
      throw new PreviewCandidateIdentityError(
        `Preview candidate entry ${index} path must be a string.`,
      );
    }
    assertCandidatePath(item.path);
    pathBytes += utf8ByteLength(item.path, `Preview candidate entry ${index} path`);
    if (pathBytes > PREVIEW_CANDIDATE_LIMITS.maximumPathBytes) {
      throw new PreviewCandidateIdentityError(
        "Preview candidate paths exceed the evidence limit.",
      );
    }
    if (
      prior !== null &&
      Buffer.compare(Buffer.from(prior, "utf8"), Buffer.from(item.path, "utf8")) >= 0
    ) {
      throw new PreviewCandidateIdentityError(
        "Preview candidate entries must be uniquely sorted by UTF-8 path bytes.",
      );
    }
    prior = item.path;
    if (item.kind !== "file" && item.kind !== "symbolic-link") {
      throw new PreviewCandidateIdentityError(
        `Preview candidate entry ${index} has an unsupported kind.`,
      );
    }
    const bytes = boundedInteger(
      item.bytes,
      PREVIEW_CANDIDATE_LIMITS.maximumFileBytes,
      `Preview candidate entry ${index} bytes`,
    );
    byteCount += bytes;
    if (byteCount > PREVIEW_CANDIDATE_LIMITS.maximumTotalBytes) {
      throw new PreviewCandidateIdentityError(
        "Preview candidate byte total exceeds the evidence limit.",
      );
    }
    entries.push(Object.freeze({
      path: item.path,
      kind: item.kind,
      bytes,
      sha256: digest(item.sha256, `Preview candidate entry ${index} sha256`),
    }));
  }
  const entryCount = boundedInteger(
    rawCandidate.entryCount,
    PREVIEW_CANDIDATE_LIMITS.maximumEntries,
    "Preview candidate entryCount",
  );
  const statedBytes = boundedInteger(
    rawCandidate.byteCount,
    PREVIEW_CANDIDATE_LIMITS.maximumTotalBytes,
    "Preview candidate byteCount",
  );
  if (entryCount !== entries.length || statedBytes !== byteCount) {
    throw new PreviewCandidateIdentityError(
      "Preview candidate counts do not match its entries.",
    );
  }
  const expectedCandidateDigest = candidateDigest(entries);
  if (digest(rawCandidate.digest, "Preview candidate digest") !== expectedCandidateDigest) {
    throw new PreviewCandidateIdentityError(
      "Preview candidate digest does not authenticate its entries.",
    );
  }
  const candidate = Object.freeze({
    digest: expectedCandidateDigest,
    entries: Object.freeze(entries),
    entryCount,
    byteCount,
  });
  const core = {
    schemaVersion: PREVIEW_CANDIDATE_IDENTITY_VERSION,
    worktreeRoot: root.worktreeRoot,
    branch: root.branch,
    commit: root.commit,
    dirty: root.dirty,
    candidate,
  } as const;
  const expectedIdentityDigest = sha256(
    canonicalizeJson({
      domain: "genii-publisher-preview-identity-v1",
      identity: core,
    } as never),
  );
  if (digest(root.identityDigest, "Preview identity digest") !== expectedIdentityDigest) {
    throw new PreviewCandidateIdentityError(
      "Preview identity digest does not authenticate the saved evidence.",
    );
  }
  return Object.freeze({ ...core, identityDigest: expectedIdentityDigest });
}

/** Recaptures a host and explains every top-level reason saved evidence is stale. */
export async function verifyPreviewCandidateIdentity(
  input: VerifyPreviewCandidateIdentityInput,
): Promise<PreviewCandidateVerification> {
  const expected = parsePreviewCandidateIdentity(input.expected);
  const actual = await capturePreviewCandidateIdentity({ hostRoot: input.hostRoot });
  const mismatches: PreviewCandidateMismatch[] = [];
  if (expected.worktreeRoot !== actual.worktreeRoot) mismatches.push("worktree");
  if (expected.branch !== actual.branch) mismatches.push("branch");
  if (expected.commit !== actual.commit) mismatches.push("commit");
  if (expected.dirty !== actual.dirty) mismatches.push("dirty");
  if (expected.candidate.digest !== actual.candidate.digest) mismatches.push("candidate");
  if (expected.identityDigest !== actual.identityDigest) mismatches.push("identity");
  return Object.freeze({
    matches: mismatches.length === 0,
    mismatches: Object.freeze(mismatches),
    expected,
    actual,
  });
}
