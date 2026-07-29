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

// The apply receipt.
//
// Recording the baseline commit is what makes rollback possible at all. Without
// it, undoing an apply would mean asking an author which commit they were on
// before running a command that did not tell them.
//
// The receipt also records what each path held after the apply. Rollback uses
// those hashes as preimages, so a file the author has touched since is a conflict
// rather than something rollback quietly reverts.
//
// It lives under the tool's own directory rather than being committed. An apply
// that has not been committed yet is exactly when rollback matters, and by the
// time the change is committed, Git history is the durable record and the receipt
// has nothing to add.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const PUBLISHER_APPLY_RECEIPT_FORMAT =
  "genii-publisher-apply-receipt-1";

/** Host-relative location, inside the tool's own working directory. */
export const PUBLISHER_APPLY_RECEIPT_PATH = join(
  ".publisher",
  "last-apply.json",
);

export interface PublisherAppliedFile {
  readonly path: string;
  /** Hash the apply left at this path, or null when the apply removed it. */
  readonly sha256: string | null;
}

export interface PublisherApplyReceipt {
  readonly format: string;
  readonly operation: "initialize" | "upgrade";
  readonly planHash: string;
  /** Commit the tree was at before the apply. Rollback returns here. */
  readonly baselineCommit: string;
  readonly renderer: string;
  /** Null for an initialization, which had no prior contract. */
  readonly fromContractVersion: string | null;
  readonly toContractVersion: string;
  readonly files: readonly PublisherAppliedFile[];
}

export class PublisherApplyReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublisherApplyReceiptError";
  }
}

const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function serializePublisherApplyReceipt(
  receipt: PublisherApplyReceipt,
): string {
  return `${JSON.stringify(
    {
      format: PUBLISHER_APPLY_RECEIPT_FORMAT,
      operation: receipt.operation,
      planHash: receipt.planHash,
      baselineCommit: receipt.baselineCommit,
      renderer: receipt.renderer,
      fromContractVersion: receipt.fromContractVersion,
      toContractVersion: receipt.toContractVersion,
      files: [...receipt.files]
        .sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        )
        .map((file) => ({ path: file.path, sha256: file.sha256 })),
    },
    null,
    2,
  )}\n`;
}

export function parsePublisherApplyReceipt(
  text: string,
): PublisherApplyReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PublisherApplyReceiptError(
      "The apply receipt is not valid JSON.",
    );
  }
  if (!isPlainObject(parsed)) {
    throw new PublisherApplyReceiptError(
      "The apply receipt must contain a JSON object.",
    );
  }
  if (parsed.format !== PUBLISHER_APPLY_RECEIPT_FORMAT) {
    throw new PublisherApplyReceiptError(
      `The apply receipt has format ${JSON.stringify(parsed.format)}, which this engine does not understand.`,
    );
  }
  if (
    parsed.operation !== "initialize" &&
    parsed.operation !== "upgrade"
  ) {
    throw new PublisherApplyReceiptError(
      "The apply receipt operation must be initialize or upgrade.",
    );
  }
  if (
    typeof parsed.baselineCommit !== "string" ||
    !commitPattern.test(parsed.baselineCommit)
  ) {
    throw new PublisherApplyReceiptError(
      "The apply receipt must record a full baseline commit.",
    );
  }
  if (
    typeof parsed.planHash !== "string" ||
    !hashPattern.test(parsed.planHash)
  ) {
    throw new PublisherApplyReceiptError(
      "The apply receipt must record a prefixed plan hash.",
    );
  }
  if (
    typeof parsed.renderer !== "string" ||
    parsed.renderer.length === 0
  ) {
    throw new PublisherApplyReceiptError(
      "The apply receipt must name a renderer.",
    );
  }
  if (
    parsed.fromContractVersion !== null &&
    typeof parsed.fromContractVersion !== "string"
  ) {
    throw new PublisherApplyReceiptError(
      "The apply receipt fromContractVersion must be a string or null.",
    );
  }
  if (typeof parsed.toContractVersion !== "string") {
    throw new PublisherApplyReceiptError(
      "The apply receipt must record the contract version it moved to.",
    );
  }
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new PublisherApplyReceiptError(
      "The apply receipt must record at least one changed path.",
    );
  }
  const files: PublisherAppliedFile[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of parsed.files.entries()) {
    if (!isPlainObject(entry)) {
      throw new PublisherApplyReceiptError(
        `The apply receipt files[${index}] must be an object.`,
      );
    }
    const path = entry.path;
    if (typeof path !== "string" || path.length === 0) {
      throw new PublisherApplyReceiptError(
        `The apply receipt files[${index}].path must be a nonempty string.`,
      );
    }
    if (seen.has(path)) {
      throw new PublisherApplyReceiptError(
        `The apply receipt lists ${JSON.stringify(path)} twice.`,
      );
    }
    seen.add(path);
    const sha256 = entry.sha256;
    if (
      sha256 !== null &&
      (typeof sha256 !== "string" || !hashPattern.test(sha256))
    ) {
      throw new PublisherApplyReceiptError(
        `The apply receipt files[${index}].sha256 must be a prefixed sha256 digest or null.`,
      );
    }
    files.push(Object.freeze({ path, sha256 }));
  }

  return Object.freeze({
    format: PUBLISHER_APPLY_RECEIPT_FORMAT,
    operation: parsed.operation,
    planHash: parsed.planHash,
    baselineCommit: parsed.baselineCommit,
    renderer: parsed.renderer,
    fromContractVersion: parsed.fromContractVersion,
    toContractVersion: parsed.toContractVersion,
    files: Object.freeze(files),
  });
}

export function applyReceiptPath(hostRoot: string): string {
  return join(hostRoot, PUBLISHER_APPLY_RECEIPT_PATH);
}

export function writeApplyReceipt(
  hostRoot: string,
  receipt: PublisherApplyReceipt,
): void {
  const path = applyReceiptPath(hostRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    serializePublisherApplyReceipt(receipt),
    "utf8",
  );
}

export function readApplyReceipt(
  hostRoot: string,
): PublisherApplyReceipt | null {
  const path = applyReceiptPath(hostRoot);
  if (!existsSync(path)) {
    return null;
  }
  return parsePublisherApplyReceipt(readFileSync(path, "utf8"));
}

/**
 * Removes the receipt.
 *
 * Called after a rollback, because the apply it describes no longer happened and
 * a receipt for an undone change would invite rolling back twice.
 */
export function clearApplyReceipt(hostRoot: string): void {
  rmSync(applyReceiptPath(hostRoot), { force: true });
}

export function hashReceiptContents(contents: string): string {
  return `sha256:${createHash("sha256")
    .update(contents, "utf8")
    .digest("hex")}`;
}
