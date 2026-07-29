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

// Writing the reader artifact into a host.
//
// This does not go through the lifecycle transaction, and the reason is a real
// distinction rather than convenience. The transaction exists to protect files an
// author owns: it requires a clean Git tree so a rollback can get back, and it
// treats a file that matches neither its expected preimage nor its intended
// result as a conflict to review. Both are correct for a host contract and wrong
// for generated output. Requiring a clean tree before every build would make
// building during ordinary work impossible, and refusing to overwrite a stale
// artifact would refuse the entire point of the command.
//
// So the artifact gets its own writer. What it does not get is its own idea of
// which paths are writable. It goes through the same mutation policy and the same
// path resolver as a lifecycle mutation, because the destination is declared by a
// renderer, and a renderer is a third-party package.
//
// The collision check is the part worth reading twice. A renderer that declares
// its artifact path as one of its own contract files would have every build
// silently overwrite that file. The policy cannot catch it, because a path listed
// in an allowlist is allowed by construction. It is checked here, case-folded,
// because on a case-insensitive filesystem "App/Page.tsx" and "app/page.tsx" are
// the same file and only one of the two spellings is in the list.

import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  createHostMutationAuthority,
} from "./lifecycle/policy.js";
import {
  PUBLISHER_HOST_STATE_PATH,
} from "./lifecycle/host-state.js";
import {
  resolveHostFilePath,
} from "./lifecycle/transaction.js";

export class ArtifactDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactDestinationError";
  }
}

function foldPath(path: string): string {
  // Case folding plus NFC would be more thorough, but the contract paths this
  // compares against are ASCII by policy, and toLowerCase is exactly what a
  // case-insensitive filesystem does to them.
  return path.toLowerCase();
}

export interface ArtifactDestinationInput {
  /** Absolute, canonical host root. */
  readonly hostRoot: string;
  /** Host-relative path the renderer declares for its reader data. */
  readonly readerDataPath: string;
  /** Paths the renderer's host contract owns. */
  readonly rendererManagedPaths: readonly string[];
  /** Roots holding publication sources or durable state. */
  readonly protectedRoots?: readonly string[];
}

export interface ArtifactDestination {
  readonly hostRelativePath: string;
  readonly absolutePath: string;
}

/**
 * Decides where the artifact may be written, refusing everything else.
 *
 * The renderer declares the path, so this treats it as untrusted input from a
 * third-party package rather than as a configuration value.
 */
export function resolveArtifactDestination(
  input: ArtifactDestinationInput,
): ArtifactDestination {
  if (!isAbsolute(input.hostRoot)) {
    throw new ArtifactDestinationError(
      "Host root must be an absolute path.",
    );
  }
  const hostRoot = resolve(input.hostRoot);
  const declared = input.readerDataPath;

  if (typeof declared !== "string" || declared.length === 0) {
    throw new ArtifactDestinationError(
      `The renderer declared an unusable reader data path: ${JSON.stringify(
        declared,
      )}`,
    );
  }

  // The artifact is machine-owned output, so it is authorized in the engine role
  // and nothing else. Naming it here is what the allowlist is for; every hard
  // denial in the policy still applies and is checked first.
  const authority = createHostMutationAuthority({
    rendererManagedPaths: input.rendererManagedPaths,
    engineManagedPaths: [declared],
    ...(input.protectedRoots === undefined
      ? {}
      : { protectedRoots: input.protectedRoots }),
  });
  const decision = authority.authorize(declared, "engineManaged");
  if (!decision.allowed) {
    throw new ArtifactDestinationError(
      `The renderer declared a reader data path the engine will not write: ${declared}\n${decision.reason}`,
    );
  }

  // A path in an allowlist is allowed by construction, so a renderer pointing its
  // artifact at one of its own contract files, or at the engine's state file,
  // cannot be caught by the policy. It is caught here.
  //
  // The reserved host configuration path is deliberately absent. The policy
  // already refuses it in every role, and repeating it here would imply this
  // layer is what protects it.
  const reserved = new Map<string, string>([
    [
      foldPath(PUBLISHER_HOST_STATE_PATH),
      "the engine's own host state file",
    ],
  ]);
  for (const managed of input.rendererManagedPaths) {
    reserved.set(
      foldPath(managed),
      "a file the renderer's host contract owns",
    );
  }
  const collision = reserved.get(foldPath(declared));
  if (collision !== undefined) {
    throw new ArtifactDestinationError(
      `The renderer declared ${declared} for its reader data, but that is ${collision}. ` +
        "Every build would overwrite it.",
    );
  }

  // Symlink traversal, escaping the root, and descending through a file are all
  // decided by the same resolver the lifecycle transaction uses.
  const absolutePath = resolveHostFilePath(hostRoot, declared);
  return Object.freeze({
    hostRelativePath: declared,
    absolutePath,
  });
}

/**
 * Removes a staged artifact left by an interrupted write.
 *
 * A missing file is the normal case and not an error. Anything else is reported,
 * because a staged file that cannot be removed will block every later apply and
 * the author needs to know which file and why.
 */
function removeStagedArtifact(staged: string): void {
  try {
    rmSync(staged, { force: true });
  } catch (error) {
    throw new ArtifactDestinationError(
      `A staged artifact from an interrupted build could not be removed: ${staged}\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function hashArtifactText(text: string): string {
  return `sha256:${createHash("sha256")
    .update(text, "utf8")
    .digest("hex")}`;
}

/**
 * The staged path a write for this destination would use.
 *
 * Exported so a reporting command can notice a leftover from an interrupted build
 * without duplicating how the name is derived.
 */
export function stagedArtifactPathFor(
  destination: ArtifactDestination,
): string {
  return join(
    dirname(destination.absolutePath),
    `.${hashArtifactText(destination.hostRelativePath).slice(7, 23)}.artifact.tmp`,
  );
}

export type ArtifactWriteOutcome = "written" | "current";

export interface ArtifactWriteResult {
  readonly outcome: ArtifactWriteOutcome;
  readonly hostRelativePath: string;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * Writes the artifact, atomically, only when its content would change.
 *
 * Skipping an identical write is not an optimization. It keeps the file's
 * modification time stable, so a watching build tool does not rebuild in a loop
 * because the publisher rewrote a byte-identical file.
 */
export function writeReaderArtifact(input: {
  readonly destination: ArtifactDestination;
  readonly text: string;
}): ArtifactWriteResult {
  const { absolutePath, hostRelativePath } = input.destination;
  const sha256 = hashArtifactText(input.text);
  const bytes = Buffer.byteLength(input.text, "utf8");

  const directory = dirname(absolutePath);
  // Staged in the destination directory, not a temporary directory, because a
  // rename across filesystems is a copy and stops being atomic.
  const staged = join(
    directory,
    `.${hashArtifactText(hostRelativePath).slice(7, 23)}.artifact.tmp`,
  );

  // Removed before anything else, including before the already-current shortcut
  // below. A build killed between staging and renaming leaves this file, the
  // catch that would have removed it never runs, and nothing else knows the name.
  // It is untracked and not ignored, so the tree stays dirty and every later
  // apply and upgrade refuses over a file the author never created and cannot
  // interpret.
  //
  // Doing it before the shortcut matters: an author whose build was killed runs
  // build again, and the second run usually finds the artifact already current and
  // used to return without ever reaching this path.
  removeStagedArtifact(staged);

  let existing: string | null;
  try {
    existing = readFileSync(absolutePath, "utf8");
  } catch {
    existing = null;
  }
  if (existing === input.text) {
    return Object.freeze({
      outcome: "current" as const,
      hostRelativePath,
      sha256,
      bytes,
    });
  }

  mkdirSync(directory, { recursive: true });
  try {
    const descriptor = openSync(staged, "w", 0o644);
    try {
      writeSync(descriptor, input.text, 0, "utf8");
      // An artifact that survives the crash only in the page cache is an artifact
      // the next build cannot trust, and this file is what the host imports.
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(staged, absolutePath);
  } catch (error) {
    try {
      rmSync(staged, { force: true });
    } catch {
      // Nothing useful to do. The staged name is deterministic, so the next run
      // overwrites it rather than accumulating debris.
    }
    throw error;
  }

  return Object.freeze({
    outcome: "written" as const,
    hostRelativePath,
    sha256,
    bytes,
  });
}

export type ArtifactCheckOutcome =
  | "current"
  | "stale"
  | "missing";

export interface ArtifactCheckResult {
  readonly outcome: ArtifactCheckOutcome;
  readonly hostRelativePath: string;
  /** Hash the build produced. */
  readonly expected: string;
  /** Hash on disk, or null when there is nothing there. */
  readonly actual: string | null;
}

/**
 * Compares the artifact on disk against what a build produces, writing nothing.
 *
 * This is what a continuous integration job runs to prove a committed artifact
 * is current, which is the only way a repository that commits generated output
 * can tell whether it was regenerated.
 */
export function checkReaderArtifact(input: {
  readonly destination: ArtifactDestination;
  readonly text: string;
}): ArtifactCheckResult {
  const expected = hashArtifactText(input.text);
  let existing: string;
  try {
    // A directory at the artifact path reads as missing rather than throwing,
    // because the answer to "is it current" is no either way.
    if (statSync(input.destination.absolutePath).isDirectory()) {
      return Object.freeze({
        outcome: "missing" as const,
        hostRelativePath: input.destination.hostRelativePath,
        expected,
        actual: null,
      });
    }
    existing = readFileSync(input.destination.absolutePath, "utf8");
  } catch {
    return Object.freeze({
      outcome: "missing" as const,
      hostRelativePath: input.destination.hostRelativePath,
      expected,
      actual: null,
    });
  }
  const actual = hashArtifactText(existing);
  return Object.freeze({
    outcome: actual === expected ? ("current" as const) : ("stale" as const),
    hostRelativePath: input.destination.hostRelativePath,
    expected,
    actual,
  });
}
