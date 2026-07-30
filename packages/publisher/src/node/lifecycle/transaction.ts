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

// The transactional host writer.
//
// This is the only code permitted to change files in an author repository. It
// exists because the alternative to a transaction is a command that fails
// halfway through someone else's repository and leaves them to work out which
// half.
//
// Three properties matter, in this order.
//
// It never writes without first proving the tree is in the state the plan was
// computed against. A file that matches neither its expected preimage nor its
// intended postimage is a local modification, and the only correct response is a
// reviewable conflict.
//
// It is all or nothing. Every replacement is staged in the target's own
// directory and renamed into place, so each individual file changes atomically,
// and a failure at any point restores every file already touched.
//
// It survives process death. A journal is written before the first mutation and
// removed only after the last one succeeds, so a journal found on disk means a
// previous run died midway. Recovery restores the baseline from the journal's
// backups rather than guessing at intent, because a half-written tree is the
// worst possible place to start inferring what someone meant.

import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  lstatSync,
  writeFileSync,
  writeSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Journal format identifier. A journal from another version is not recoverable by this one. */
export const HOST_TRANSACTION_JOURNAL_FORMAT =
  "genii-publisher-host-transaction-1";

/** Suffix for same-directory staging files. */
const stagingSuffix = ".publisher-staged";

export interface HostFileMutation {
  /** POSIX path relative to the host root. */
  readonly path: string;
  /**
   * The content hash the file must currently have, as `sha256:<hex>`, or null
   * when the plan expects the file not to exist.
   */
  readonly expected: string | null;
  /**
   * Exact bytes to write, or null to remove the file.
   *
   * Removal exists because a host contract can drop a file between versions, and
   * an upgrade that only writes would leave an orphan the renderer no longer
   * owns and the recorded state no longer describes. A removal is still governed
   * by `expected`, so a file an author has edited is a conflict rather than a
   * deletion.
   */
  readonly contents: string | null;
}

export type HostFileState =
  /** Matches its expected preimage and is ready to be written. */
  | "pending"
  /** Already holds the intended postimage. */
  | "applied"
  /** Matches neither, so an author or another tool changed it. */
  | "conflicted";

export interface HostFileClassification {
  readonly path: string;
  readonly state: HostFileState;
  /** Present hash, or null when the file does not exist. */
  readonly present: string | null;
  readonly expected: string | null;
  /** Intended hash, or null when the mutation removes the file. */
  readonly intended: string | null;
}

export interface HostTransactionOutcome {
  readonly outcome: "applied" | "alreadyApplied";
  readonly changed: readonly string[];
  readonly classifications: readonly HostFileClassification[];
}

export class HostTransactionError extends Error {
  readonly conflicts: readonly HostFileClassification[];

  constructor(
    message: string,
    conflicts: readonly HostFileClassification[] = [],
  ) {
    super(message);
    this.name = "HostTransactionError";
    this.conflicts = Object.freeze([...conflicts]);
  }
}

export function hashHostFileContents(contents: string): string {
  return `sha256:${createHash("sha256")
    .update(contents, "utf8")
    .digest("hex")}`;
}

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Resolves one host-relative path to an absolute path inside the root.
 *
 * Rejects absolute paths, parent traversal, and any component that is a
 * symbolic link. A symlink anywhere in the chain would let a write land outside
 * the tree the caller authorized, and checking the final component alone is not
 * enough because an intermediate directory can be a link.
 */
/**
 * Resolves a host-relative path to an absolute one, refusing anything unsafe.
 *
 * Exported because it is the only correct way to turn a declared host path into
 * a filesystem path, and generated output has to go through the same gate as a
 * lifecycle mutation. A second implementation would be a second set of bugs.
 */
export function resolveHostFilePath(
  root: string,
  hostPath: string,
): string {
  return resolveHostPath(root, hostPath);
}

function resolveHostPath(root: string, hostPath: string): string {
  if (
    typeof hostPath !== "string" ||
    hostPath.length === 0 ||
    hostPath.startsWith("/") ||
    isAbsolute(hostPath) ||
    hostPath.includes("\0") ||
    hostPath.includes("\\")
  ) {
    throw new HostTransactionError(
      `Host mutation path is not a relative POSIX path: ${JSON.stringify(hostPath)}`,
    );
  }
  const segments = hostPath.split("/");
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.endsWith(".") ||
      segment.endsWith(" ")
    ) {
      throw new HostTransactionError(
        `Host mutation path has an unusable segment: ${JSON.stringify(hostPath)}`,
      );
    }
  }
  const absolute = join(root, ...segments);
  const relativeToRoot = relative(root, absolute);
  if (
    relativeToRoot.length === 0 ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeToRoot)
  ) {
    throw new HostTransactionError(
      `Host mutation path escapes the host root: ${JSON.stringify(hostPath)}`,
    );
  }

  // Every existing ancestor, and the target itself, must be a real entry rather
  // than a link. Missing ancestors are created by this transaction and are
  // therefore not links.
  let walked = root;
  for (const segment of segments) {
    walked = join(walked, segment);
    let entry;
    try {
      entry = lstatSync(walked);
    } catch {
      break;
    }
    if (entry.isSymbolicLink()) {
      throw new HostTransactionError(
        `Host mutation path traverses a symbolic link: ${JSON.stringify(hostPath)}`,
      );
    }
    if (walked !== absolute && !entry.isDirectory()) {
      throw new HostTransactionError(
        `Host mutation path descends through a file: ${JSON.stringify(hostPath)}`,
      );
    }
    if (walked === absolute && !entry.isFile()) {
      throw new HostTransactionError(
        `Host mutation target is not a regular file: ${JSON.stringify(hostPath)}`,
      );
    }
  }
  return absolute;
}

function readIfPresent(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Classifies every mutation against the tree without writing anything.
 *
 * Planning uses this to report, and apply uses it to decide, so both answer from
 * one implementation rather than two that can disagree.
 */
export function classifyHostMutations(
  root: string,
  mutations: readonly HostFileMutation[],
): readonly HostFileClassification[] {
  const canonicalRoot = assertHostRoot(root);
  const seen = new Set<string>();
  const ordered = [...mutations].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const classifications: HostFileClassification[] = [];
  for (const mutation of ordered) {
    if (seen.has(mutation.path)) {
      throw new HostTransactionError(
        `Host mutation set declares ${JSON.stringify(mutation.path)} twice.`,
      );
    }
    seen.add(mutation.path);
    const absolute = resolveHostPath(canonicalRoot, mutation.path);
    const intended =
      mutation.contents === null
        ? null
        : hashHostFileContents(mutation.contents);
    const bytes = readIfPresent(absolute);
    const present = bytes === null ? null : hashBytes(bytes);
    let state: HostFileState;
    if (present === intended) {
      state = "applied";
    } else if (present === mutation.expected) {
      state = "pending";
    } else {
      state = "conflicted";
    }
    classifications.push(
      Object.freeze({
        path: mutation.path,
        state,
        present,
        expected: mutation.expected,
        intended,
      }),
    );
  }

  // A mutation set that writes a file and also writes something beneath it is
  // internally inconsistent: whichever order it is applied in, one of the two
  // cannot exist. Refusing it here means the transaction never discovers the
  // contradiction halfway through, when the only remedy is a rollback.
  for (const mutation of ordered) {
    const segments = mutation.path.split("/");
    let ancestor = segments[0] as string;
    for (let depth = 1; depth < segments.length; depth += 1) {
      if (seen.has(ancestor)) {
        throw new HostTransactionError(
          `Host mutation set writes ${JSON.stringify(mutation.path)} beneath the file ${JSON.stringify(ancestor)}.`,
        );
      }
      ancestor = `${ancestor}/${segments[depth] as string}`;
    }
  }

  return Object.freeze(classifications);
}

function assertHostRoot(root: string): string {
  if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) {
    throw new HostTransactionError(
      "Host root must be an absolute path.",
    );
  }
  const requested = resolve(root);
  let resolved: string;
  try {
    resolved = realpathSync(requested);
  } catch (error) {
    throw new HostTransactionError(
      `Host root does not exist: ${requested}`,
      [],
    );
  }
  if (resolved !== requested) {
    throw new HostTransactionError(
      `Host root must already be canonical, but it resolves to ${resolved}: ${requested}`,
    );
  }
  if (!statSync(resolved).isDirectory()) {
    throw new HostTransactionError(
      `Host root is not a directory: ${resolved}`,
    );
  }
  return resolved;
}

interface JournalEntry {
  readonly path: string;
  /** Hash of the content that was present before this transaction, or null. */
  readonly priorHash: string | null;
  /** Backup file name inside the journal directory, or null when nothing existed. */
  readonly backup: string | null;
  /** Null when the entry removes the file. */
  readonly intended: string | null;
}

interface Journal {
  readonly format: string;
  readonly root: string;
  readonly entries: readonly JournalEntry[];
  readonly createdDirectories: readonly string[];
}

/**
 * Writes the journal, refusing to overwrite one another process just created.
 *
 * The existsSync check above catches a journal left by a crash, and it is the
 * better message for that case. It cannot catch a second apply that started in the
 * gap between that check and this write. Two concurrent applies both passed it,
 * then trampled each other's staged files and died with a raw ENOENT naming an
 * internal staged path. The tree was restored correctly every time I ran it, so
 * the safety property held, but neither author was told anything they could act
 * on.
 *
 * Creating the journal exclusively closes the gap: the first apply proceeds and
 * the second is refused before it writes anything.
 */
function createJournalExclusively(path: string, contents: string): void {
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o644);
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "EEXIST"
    ) {
      throw new HostTransactionError(
        `Another host transaction is already in progress. Wait for it to finish, or recover it if it did not: ${path}`,
      );
    }
    throw error;
  }
  try {
    writeSync(descriptor, contents, 0, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeFileDurably(path: string, contents: string): void {
  const descriptor = openSync(path, "w", 0o644);
  try {
    writeSync(descriptor, contents, 0, "utf8");
    // The journal is only useful if it survives the crash it exists to describe.
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Applies a mutation set transactionally.
 *
 * Returns `alreadyApplied` only when every file already holds its intended
 * postimage. A tree in which some files are applied and others are pending is a
 * partial state and is refused rather than completed, because the plan was
 * computed against a baseline that no longer exists.
 */
export function applyHostMutations(input: {
  readonly root: string;
  readonly mutations: readonly HostFileMutation[];
  readonly journalDirectory: string;
}): HostTransactionOutcome {
  const root = assertHostRoot(input.root);
  const journalDirectory = resolve(input.journalDirectory);
  const journalPath = join(journalDirectory, "transaction.json");

  if (existsSync(journalPath)) {
    throw new HostTransactionError(
      `A previous host transaction did not finish. Recover it before applying another: ${journalPath}`,
    );
  }

  const classifications = classifyHostMutations(root, input.mutations);
  const conflicts = classifications.filter(
    (entry) => entry.state === "conflicted",
  );
  if (conflicts.length > 0) {
    throw new HostTransactionError(
      `${conflicts.length} host file(s) differ from both the expected baseline and the intended result, so they must be reviewed rather than overwritten.`,
      conflicts,
    );
  }
  const pending = classifications.filter(
    (entry) => entry.state === "pending",
  );
  if (pending.length === 0) {
    return Object.freeze({
      outcome: "alreadyApplied" as const,
      changed: Object.freeze([]),
      classifications,
    });
  }
  // A mix of applied and pending files is completed rather than refused.
  //
  // An earlier version refused it, on the reasoning that a half-applied tree
  // means guessing at intent. That reasoning was wrong, and it made upgrades
  // impossible: every upgrade leaves most host files unchanged between contract
  // versions, so a legitimate upgrade is always a mix.
  //
  // Nothing is guessed here. Every pending file carries the exact preimage it
  // must currently have, every applied file already holds the exact bytes this
  // set intends, and anything matching neither is a conflict and has already been
  // refused above. Completing the remainder therefore reaches precisely the
  // intended end state. The dangerous cases the refusal was reaching for are each
  // covered elsewhere: a run that died midway leaves a journal that blocks the
  // next apply, and an author's edit is a conflict.

  const ordered = [...input.mutations].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );

  mkdirSync(journalDirectory, { recursive: true });
  const backupsDirectory = join(journalDirectory, "backups");
  mkdirSync(backupsDirectory, { recursive: true });

  const entries: JournalEntry[] = [];
  const createdDirectories: string[] = [];
  const writtenPaths: string[] = [];

  // Directories this transaction has to create, deepest last so rollback can
  // remove them deepest first.
  for (const mutation of ordered) {
    const absolute = join(root, ...mutation.path.split("/"));
    let directory = dirname(absolute);
    const missing: string[] = [];
    while (directory !== root && !existsSync(directory)) {
      missing.unshift(directory);
      directory = dirname(directory);
    }
    for (const path of missing) {
      if (!createdDirectories.includes(path)) {
        createdDirectories.push(path);
      }
    }
  }

  for (const mutation of ordered) {
    const absolute = join(root, ...mutation.path.split("/"));
    const bytes = readIfPresent(absolute);
    const backupName =
      bytes === null
        ? null
        : `${entries.length.toString().padStart(4, "0")}-${mutation.path.replace(
            /[^A-Za-z0-9._-]/g,
            "_",
          )}`;
    if (bytes !== null && backupName !== null) {
      writeFileSync(join(backupsDirectory, backupName), bytes);
    }
    entries.push({
      path: mutation.path,
      priorHash: bytes === null ? null : hashBytes(bytes),
      backup: backupName,
      intended:
        mutation.contents === null
          ? null
          : hashHostFileContents(mutation.contents),
    });
  }

  const journal: Journal = {
    format: HOST_TRANSACTION_JOURNAL_FORMAT,
    root,
    entries,
    createdDirectories,
  };
  // Written and flushed before the first mutation, so a crash always leaves a
  // journal that describes strictly more than what was changed.
  createJournalExclusively(
    journalPath,
    `${JSON.stringify(journal, null, 2)}\n`,
  );

  try {
    for (const path of createdDirectories) {
      mkdirSync(path, { recursive: true });
    }
    for (const mutation of ordered) {
      const absolute = join(root, ...mutation.path.split("/"));
      if (mutation.contents === null) {
        rmSync(absolute, { force: true });
        writtenPaths.push(absolute);
        if (readIfPresent(absolute) !== null) {
          throw new HostTransactionError(
            `Host file still exists after being removed: ${mutation.path}`,
          );
        }
        // A directory left empty by a removal is not itself removed. This
        // transaction did not create it, and an author may be keeping it.
        continue;
      }
      const staged = `${absolute}${stagingSuffix}`;
      // Staged in the target's own directory so the rename is a same
      // filesystem operation and therefore atomic.
      writeFileDurably(staged, mutation.contents);
      renameSync(staged, absolute);
      writtenPaths.push(absolute);
      const verify = readIfPresent(absolute);
      if (
        verify === null ||
        hashBytes(verify) !== hashHostFileContents(mutation.contents)
      ) {
        throw new HostTransactionError(
          `Host file did not hold its intended content after being written: ${mutation.path}`,
        );
      }
    }
  } catch (error) {
    restoreFromJournal(journal, backupsDirectory);
    rmSync(journalDirectory, { recursive: true, force: true });
    throw error;
  }

  rmSync(journalDirectory, { recursive: true, force: true });

  return Object.freeze({
    outcome: "applied" as const,
    changed: Object.freeze(ordered.map((mutation) => mutation.path)),
    classifications,
  });
}

function restoreFromJournal(
  journal: Journal,
  backupsDirectory: string,
): void {
  // Reverse order, so a directory is only considered for removal after the files
  // inside it have been dealt with.
  for (const entry of [...journal.entries].reverse()) {
    const absolute = join(journal.root, ...entry.path.split("/"));
    // A process killed between staging a file and renaming it leaves the staged
    // sibling behind. Recovery used to leave it too, exit zero, and report
    // success, which left the tree dirty over a file the engine had written. The
    // next apply then refused on the clean tree gate, blaming the author for
    // something recovery had promised to clean up. It was also why the created
    // directory pass below did nothing: the directory was not empty.
    //
    // The suffix is engine owned, so removing it cannot touch an author's file.
    rmSync(`${absolute}${stagingSuffix}`, { force: true });
    if (entry.backup === null) {
      // Nothing was there before, so restoring means the file should not exist.
      // That is true whether this entry wrote a new file or removed an absent
      // one.
      rmSync(absolute, { force: true });
      continue;
    }
    const backupPath = join(backupsDirectory, entry.backup);
    if (existsSync(backupPath)) {
      writeFileSync(absolute, readFileSync(backupPath));
    }
  }
  for (const path of [...journal.createdDirectories].reverse()) {
    try {
      if (readdirSync(path).length !== 0) {
        // Something else put content here. Removing it would destroy work this
        // transaction did not create.
        continue;
      }
      // `rmdirSync` rather than `rmSync`, which refuses a directory unless it is
      // told to recurse and would therefore throw here. Refusing to remove a
      // non-empty directory is the guard, so it belongs in the call.
      rmdirSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
}

/**
 * Restores the baseline described by a journal left behind by a crashed run.
 *
 * Deliberately does not then apply anything. After recovery the tree is back at
 * its baseline and the operator can rerun apply, having been told what happened.
 * Continuing automatically would mean acting on a plan whose baseline was last
 * verified before a crash.
 */
/**
 * Recovers an interrupted transaction, refusing a journal that does not describe
 * this host.
 *
 * The root is required and checked, and it used to be neither. Recovery read
 * `journal.root` out of the file and wrote there, so a journal naming another
 * directory made recovery modify that directory instead. Demonstrated: a journal
 * placed in one host overwrote a file in an unrelated one and reported success,
 * and an entry path of `../sibling.txt` deleted a file outside the host entirely.
 *
 * Every path in a journal is now validated the same way a mutation is, because a
 * journal is a file on disk and the apply path has always treated paths from
 * outside itself as untrusted. Recovery is the one place that did not, and it is
 * the command the tool tells authors to run.
 *
 * A repository can force-add `.publisher/transaction/transaction.json` past the
 * usual ignore rules, so this is reachable by cloning a repository and following
 * the tool's own advice. The more ordinary case is copying `.publisher` between
 * checkouts, which used to make recovery operate silently on the wrong tree.
 */
/**
 * Refuses a journal whose paths reach outside the host.
 *
 * Entry paths go through the same resolver a mutation uses, so traversal, absolute
 * paths, and symbolic links are refused identically. Backup names must be plain
 * filenames, because they are joined into the backups directory and a name
 * containing a separator would read a file from anywhere.
 */
function assertJournalPathsAreInside(
  journal: Journal,
  root: string,
  journalPath: string,
): void {
  for (const entry of journal.entries) {
    try {
      resolveHostFilePath(root, entry.path);
    } catch (error) {
      throw new HostTransactionError(
        `Journal entry ${JSON.stringify(entry.path)} is not a usable host path, so ${journalPath} will not be recovered: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (entry.backup !== null) {
      if (
        typeof entry.backup !== "string" ||
        entry.backup.length === 0 ||
        entry.backup.includes("/") ||
        entry.backup.includes("\\") ||
        entry.backup === "." ||
        entry.backup === ".."
      ) {
        throw new HostTransactionError(
          `Journal entry for ${JSON.stringify(entry.path)} names a backup outside the backups directory, so ${journalPath} will not be recovered: ${JSON.stringify(entry.backup)}`,
        );
      }
    }
  }
  for (const directory of journal.createdDirectories) {
    const resolved = resolve(directory);
    const relativeToRoot = relative(root, resolved);
    if (
      relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${sep}`) ||
      isAbsolute(relativeToRoot)
    ) {
      throw new HostTransactionError(
        `Journal names a created directory outside the host, so ${journalPath} will not be recovered: ${directory}`,
      );
    }
  }
}

export function recoverHostTransaction(input: {
  readonly root: string;
  readonly journalDirectory: string;
}): {
  readonly recovered: boolean;
  readonly restored: readonly string[];
} {
  const root = assertHostRoot(input.root);
  const journalDirectory = resolve(input.journalDirectory);
  const journalPath = join(journalDirectory, "transaction.json");
  if (!existsSync(journalPath)) {
    return Object.freeze({ recovered: false, restored: Object.freeze([]) });
  }
  const journal = JSON.parse(
    readFileSync(journalPath, "utf8"),
  ) as Journal;
  if (journal.format !== HOST_TRANSACTION_JOURNAL_FORMAT) {
    throw new HostTransactionError(
      `Host transaction journal has an unrecognized format ${JSON.stringify(journal.format)}: ${journalPath}`,
    );
  }
  if (typeof journal.root !== "string" || resolve(journal.root) !== root) {
    throw new HostTransactionError(
      `This journal describes a different host and will not be recovered here.\n` +
        `  journal names: ${String(journal.root)}\n` +
        `  this host is:  ${root}\n` +
        `Recover it from the host it belongs to, or delete ${journalDirectory} if it arrived here by accident.`,
    );
  }
  assertJournalPathsAreInside(journal, root, journalPath);
  restoreFromJournal(journal, join(journalDirectory, "backups"));
  rmSync(journalDirectory, { recursive: true, force: true });
  return Object.freeze({
    recovered: true,
    restored: Object.freeze(journal.entries.map((entry) => entry.path)),
  });
}
