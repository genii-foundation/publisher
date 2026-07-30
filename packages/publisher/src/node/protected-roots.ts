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

// Where a publication says its sources live.
//
// The mutation policy has always taken protected roots as input, and its own
// reasoning says they come from the publication's declared roots rather than from
// a hardcoded list, because the engine has no other way to know where a given
// publication keeps its manuscripts. That decision was recorded and never wired
// up, so the only way to get the protection was to pass a command line flag that
// repeated what the manifest already said. An author who did not know to pass it
// got no protection at all, and a renderer aiming its artifact into a manuscript
// directory was obeyed.
//
// So the manifest is read here and the roots come from it. The flag still exists
// and adds to the set rather than replacing it, because a repository can hold
// things the manifest has no reason to mention.
//
// A manifest that exists but cannot be understood is a refusal rather than an
// empty set. Returning nothing would turn an unreadable manifest into an
// unprotected tree, which is the failure this module exists to remove. A manifest
// that is simply absent is fine: a host being initialized before anything has
// been authored has nothing to protect yet.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export class ProtectedRootsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtectedRootsError";
  }
}

/** Manifest filename at a publication root. */
export const PUBLICATION_MANIFEST_FILENAME = "publication.json";

export interface PublicationProtectedRootsInput {
  /** Absolute, canonical host root. Protected roots are relative to this. */
  readonly hostRoot: string;
  /** Absolute, canonical publication root holding the manifest. */
  readonly publicationRoot: string;
  /** Roots the caller adds, such as a command line flag. */
  readonly additional?: readonly string[];
}

/**
 * Resolves the roots nothing may be written into, host-relative.
 *
 * Reads the publication manifest for its declared source roots and translates
 * them onto the host root, which may be an ancestor of the publication root.
 */
export function resolvePublicationProtectedRoots(
  input: PublicationProtectedRootsInput,
): readonly string[] {
  if (!isAbsolute(input.hostRoot) || !isAbsolute(input.publicationRoot)) {
    throw new ProtectedRootsError(
      "Host root and publication root must both be absolute paths.",
    );
  }
  const hostRoot = resolve(input.hostRoot);
  const publicationRoot = resolve(input.publicationRoot);
  const roots = new Set<string>(
    (input.additional ?? []).map(normalize).filter((root) => root.length > 0),
  );

  const manifestPath = join(
    publicationRoot,
    PUBLICATION_MANIFEST_FILENAME,
  );
  if (!existsSync(manifestPath)) {
    // Nothing authored yet. Initializing a host before writing a publication is
    // an ordinary thing to do, and there are no sources to protect.
    return freeze(roots);
  }

  const declared = readDeclaredSourceRoots(manifestPath);

  // A publication root outside the host has no host-relative path, so its source
  // roots cannot name anything inside the host. The path resolver already refuses
  // to write outside the host, so there is nothing left to protect here.
  const publicationPrefix = relative(hostRoot, publicationRoot);
  if (
    publicationPrefix === ".." ||
    publicationPrefix.startsWith(`..${sep}`) ||
    isAbsolute(publicationPrefix)
  ) {
    return freeze(roots);
  }

  const prefix = publicationPrefix.split(sep).filter(Boolean).join("/");
  for (const root of declared) {
    roots.add(prefix.length === 0 ? root : `${prefix}/${root}`);
  }
  return freeze(roots);
}

function readDeclaredSourceRoots(
  manifestPath: string,
): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new ProtectedRootsError(
      `${manifestPath} could not be read as JSON, so the engine cannot tell which paths hold your sources. ` +
        `Refusing rather than treating your publication as unprotected: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new ProtectedRootsError(
      `${manifestPath} is not a JSON object, so the engine cannot tell which paths hold your sources.`,
    );
  }
  const boundaries = (parsed as { boundaries?: unknown }).boundaries;
  if (boundaries === null || typeof boundaries !== "object") {
    throw new ProtectedRootsError(
      `${manifestPath} declares no boundaries, so the engine cannot tell which paths hold your sources.`,
    );
  }
  const sourceRoots = (boundaries as { sourceRoots?: unknown })
    .sourceRoots;
  if (!Array.isArray(sourceRoots) || sourceRoots.length === 0) {
    throw new ProtectedRootsError(
      `${manifestPath} declares no boundaries.sourceRoots, so the engine cannot tell which paths hold your sources.`,
    );
  }
  const resolved: string[] = [];
  for (const [index, entry] of sourceRoots.entries()) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new ProtectedRootsError(
        `${manifestPath} has an unusable boundaries.sourceRoots[${index}].`,
      );
    }
    // Checked before normalizing, not after. Normalizing drops empty segments,
    // which silently turns "/etc" into "etc": an absolute root, which is a
    // manifest error, would have become a relative one and been obeyed as a
    // different instruction. A test found that in this file.
    if (
      entry.startsWith("/") ||
      isAbsolute(entry) ||
      entry.includes("\0") ||
      entry.includes("\\") ||
      entry
        .split("/")
        .some((segment) => segment === "." || segment === "..")
    ) {
      throw new ProtectedRootsError(
        `${manifestPath} declares an unusable source root ${JSON.stringify(entry)}.`,
      );
    }
    const normalized = normalize(entry);
    if (normalized.length === 0) {
      throw new ProtectedRootsError(
        `${manifestPath} declares an unusable source root ${JSON.stringify(entry)}.`,
      );
    }
    resolved.push(normalized);
  }
  return resolved;
}

function normalize(root: string): string {
  const withoutTrailing = root.endsWith("/") ? root.slice(0, -1) : root;
  return withoutTrailing.split(sep).filter(Boolean).join("/");
}

function freeze(roots: ReadonlySet<string>): readonly string[] {
  return Object.freeze([...roots].sort());
}
