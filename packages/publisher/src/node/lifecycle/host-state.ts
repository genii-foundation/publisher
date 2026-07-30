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

// Durable author host integration state.
//
// `publisher.host.json` is committed rather than ignored. It records which host
// contract an author is on, which engine versions they pinned, which layout they
// use, and the content hash of every renderer-managed file at the moment it was
// written. Those hashes are the whole reason the file exists: without them an
// upgrade cannot tell an author's deliberate edit from a file it wrote itself,
// so it must either overwrite local work or refuse to touch anything.
//
// It lives here rather than in the schema package. The schema package owns the
// publication protocol, which is what a publication is. Host integration state is
// what one repository did to serve it, and making the protocol package
// responsible for author host layout would put a machine-owned integration
// detail inside the contract that publications are validated against.
//
// Validation is strict and total. This file is read to decide whether writing to
// someone's repository is safe, so a field that is present but malformed has to
// fail rather than be coerced into a default.

import { createHash } from "node:crypto";

export const PUBLISHER_HOST_STATE_FORMAT =
  "genii-publisher-host-state-1";

/** Committed at the host root. */
export const PUBLISHER_HOST_STATE_PATH = "publisher.host.json";

export type PublisherHostLayout = "canonical" | "declared";

export interface PublisherHostManagedFile {
  /** POSIX path relative to the host root. */
  readonly path: string;
  /** `sha256:<hex>` of the content the engine last wrote. */
  readonly sha256: string;
}

export interface PublisherHostState {
  readonly format: string;
  /** Renderer package that owns the host contract. */
  readonly renderer: string;
  /** Exact renderer package version. */
  readonly rendererVersion: string;
  /** Host contract version, which advances independently of the package version. */
  readonly hostContractVersion: string;
  readonly layout: PublisherHostLayout;
  /** Exact engine package versions this host is pinned to, sorted by name. */
  readonly enginePackages: Readonly<Record<string, string>>;
  /** Every renderer-managed file, sorted by path. */
  readonly managedFiles: readonly PublisherHostManagedFile[];
}

export class PublisherHostStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublisherHostStateError";
  }
}

const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const exactVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requireString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} field ${field} must be a nonempty string.`,
    );
  }
  return value;
}

function requireExactVersion(
  value: unknown,
  field: string,
): string {
  const text = requireString(value, field);
  if (!exactVersionPattern.test(text)) {
    // Floating ranges are refused because a host that cannot say which engine
    // built it cannot be migrated deterministically.
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} field ${field} must be an exact version, not ${JSON.stringify(text)}.`,
    );
  }
  return text;
}

/**
 * Parses and fully validates host state.
 *
 * Rejects unknown fields. A field this version does not understand means the
 * file was written by a different one, and silently ignoring it would mean acting
 * on a partial reading of someone else's repository state.
 */
export function parsePublisherHostState(
  text: string,
): PublisherHostState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} is not valid JSON.`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} must contain a JSON object.`,
    );
  }

  const known = new Set([
    "format",
    "renderer",
    "rendererVersion",
    "hostContractVersion",
    "layout",
    "enginePackages",
    "managedFiles",
  ]);
  for (const key of Object.keys(parsed)) {
    if (!known.has(key)) {
      throw new PublisherHostStateError(
        `${PUBLISHER_HOST_STATE_PATH} declares the unknown field ${JSON.stringify(key)}.`,
      );
    }
  }

  const format = requireString(parsed.format, "format");
  if (format !== PUBLISHER_HOST_STATE_FORMAT) {
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} has format ${JSON.stringify(format)}, which this engine does not understand.`,
    );
  }

  const layout = parsed.layout;
  if (layout !== "canonical" && layout !== "declared") {
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} field layout must be "canonical" or "declared".`,
    );
  }

  if (!isPlainObject(parsed.enginePackages)) {
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} field enginePackages must be an object.`,
    );
  }
  const packageNames = Object.keys(parsed.enginePackages);
  if (packageNames.length === 0) {
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} field enginePackages must name at least one package.`,
    );
  }
  const sortedNames = [...packageNames].sort();
  if (packageNames.some((name, index) => name !== sortedNames[index])) {
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} field enginePackages must be sorted by package name.`,
    );
  }
  const enginePackages: Record<string, string> = {};
  for (const name of packageNames) {
    enginePackages[name] = requireExactVersion(
      (parsed.enginePackages as Record<string, unknown>)[name],
      `enginePackages[${JSON.stringify(name)}]`,
    );
  }

  if (!Array.isArray(parsed.managedFiles)) {
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} field managedFiles must be an array.`,
    );
  }
  const managedFiles: PublisherHostManagedFile[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of parsed.managedFiles.entries()) {
    if (!isPlainObject(entry)) {
      throw new PublisherHostStateError(
        `${PUBLISHER_HOST_STATE_PATH} field managedFiles[${index}] must be an object.`,
      );
    }
    for (const key of Object.keys(entry)) {
      if (key !== "path" && key !== "sha256") {
        throw new PublisherHostStateError(
          `${PUBLISHER_HOST_STATE_PATH} field managedFiles[${index}] declares the unknown field ${JSON.stringify(key)}.`,
        );
      }
    }
    const path = requireString(entry.path, `managedFiles[${index}].path`);
    const sha256 = requireString(
      entry.sha256,
      `managedFiles[${index}].sha256`,
    );
    if (!hashPattern.test(sha256)) {
      throw new PublisherHostStateError(
        `${PUBLISHER_HOST_STATE_PATH} field managedFiles[${index}].sha256 must be a prefixed lowercase sha256 digest.`,
      );
    }
    if (seen.has(path)) {
      throw new PublisherHostStateError(
        `${PUBLISHER_HOST_STATE_PATH} lists ${JSON.stringify(path)} twice.`,
      );
    }
    seen.add(path);
    managedFiles.push(Object.freeze({ path, sha256 }));
  }
  const sortedPaths = managedFiles
    .map(({ path }) => path)
    .sort();
  if (
    managedFiles.some(
      (file, index) => file.path !== sortedPaths[index],
    )
  ) {
    throw new PublisherHostStateError(
      `${PUBLISHER_HOST_STATE_PATH} field managedFiles must be sorted by path.`,
    );
  }

  return Object.freeze({
    format,
    renderer: requireString(parsed.renderer, "renderer"),
    rendererVersion: requireExactVersion(
      parsed.rendererVersion,
      "rendererVersion",
    ),
    hostContractVersion: requireExactVersion(
      parsed.hostContractVersion,
      "hostContractVersion",
    ),
    layout,
    enginePackages: Object.freeze(enginePackages),
    managedFiles: Object.freeze(managedFiles),
  });
}

/**
 * Serializes host state canonically.
 *
 * Field and entry order are fixed so the committed file is stable, which is what
 * keeps an upgrade that changes nothing from producing a diff.
 */
export function serializePublisherHostState(
  state: PublisherHostState,
): string {
  const enginePackages: Record<string, string> = {};
  for (const name of Object.keys(state.enginePackages).sort()) {
    enginePackages[name] = state.enginePackages[name] as string;
  }
  const ordered = {
    format: PUBLISHER_HOST_STATE_FORMAT,
    renderer: state.renderer,
    rendererVersion: state.rendererVersion,
    hostContractVersion: state.hostContractVersion,
    layout: state.layout,
    enginePackages,
    managedFiles: [...state.managedFiles]
      .sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      )
      .map((file) => ({ path: file.path, sha256: file.sha256 })),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Content hash of a managed file, in the form the state records. */
export function hashManagedFileContents(contents: string): string {
  return `sha256:${createHash("sha256")
    .update(contents, "utf8")
    .digest("hex")}`;
}
