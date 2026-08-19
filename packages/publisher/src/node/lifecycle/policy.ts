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

// Write authority for author repositories.
//
// One module decides what a lifecycle command may change. A migration declares
// intent and receives a decision; it never decides for itself. A boundary a
// migration can widen is documentation rather than enforcement, which is the
// whole reason this is a separate module with no knowledge of who is asking.
//
// The shape is default-deny. Rather than enumerate everything forbidden, which
// is a list that is wrong the moment an author invents a directory, a path must
// be explicitly named as belonging to a permitted role. A hard-denied category is
// then checked FIRST, so naming a path cannot buy authority over it: a future
// migration that declared a manuscript as renderer-managed would still be
// refused.
//
// Manuscript and asset protection comes from the publication's declared roots
// rather than from a hardcoded directory list, because the engine has no other
// way to know where a given publication keeps them. That is the same authority
// the source snapshot boundary already relies on, and a manifest that fails to
// declare a root is a manifest error the loader rejects on its own terms.

/** What a caller claims a path is, which determines which allowlist applies. */
export type HostMutationRole =
  /** A file the renderer's host contract owns. */
  | "rendererManaged"
  /** Machine-owned engine integration state. */
  | "engineManaged"
  /** A publication, work, or collection manifest, edited by JSON pointer only. */
  | "manifest";

export interface HostMutationAuthorityInput {
  /** Paths the renderer's host contract declares, host-relative and POSIX. */
  readonly rendererManagedPaths: readonly string[];
  /** Paths the engine owns, such as the committed host state file. */
  readonly engineManagedPaths: readonly string[];
  /** Manifest paths eligible for pointer-scoped structural edits. */
  readonly manifestPaths?: readonly string[];
  /**
   * Roots the publication declares for its own sources, assets, continuity,
   * audio, and provider state. Everything beneath them is refused.
   */
  readonly protectedRoots?: readonly string[];
}

export interface HostMutationDecision {
  readonly allowed: boolean;
  readonly path: string;
  readonly role: HostMutationRole | null;
  /** Why, in terms an operator reading a refused plan can act on. */
  readonly reason: string;
}

/**
 * Categories no role can reach, checked before any allowlist.
 *
 * Deliberately small and engine-generic. Repository metadata and installed
 * dependencies are never publication content; a dotenv file is credentials by
 * convention across the ecosystem; and the tool's own working directory is not
 * something a host mutation may rewrite.
 */
const hardDeniedRoots = Object.freeze([
  ".git",
  ".publisher",
  "node_modules",
]);

const hardDeniedExact = Object.freeze([".env"]);

const hardDeniedPrefixes = Object.freeze([".env."]);

/** Reserved across every source role and never read, imported, or evaluated. */
export const RESERVED_HOST_CONFIG_PATH = "publisher.config.ts";

/** Author-owned executable extension registration, never managed by the engine. */
export const RESERVED_HOST_EXTENSIONS_PATH = "publisher.extensions.mjs";

/** Author-owned executable theme selection, never managed by the engine. */
export const RESERVED_HOST_THEME_PATH = "publisher.theme.mjs";

function normalizeRoot(root: string): string {
  return root.endsWith("/") ? root.slice(0, -1) : root;
}

function isBeneath(path: string, root: string): boolean {
  const normalized = normalizeRoot(root);
  return path === normalized || path.startsWith(`${normalized}/`);
}

function structurallyUnusable(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) {
    return "the path is empty";
  }
  if (path.includes("\0")) {
    return "the path contains NUL";
  }
  if (path.includes("\\")) {
    return "the path contains a backslash";
  }
  if (path.startsWith("/")) {
    return "the path is absolute";
  }
  for (const segment of path.split("/")) {
    if (segment.length === 0) {
      return "the path has an empty segment";
    }
    if (segment === "." || segment === "..") {
      return "the path has a dot or dot-dot segment";
    }
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      return "a path segment ends with a dot or a space";
    }
  }
  return null;
}

export interface HostMutationAuthority {
  /** Decides one path in one claimed role. */
  authorize(
    path: string,
    role: HostMutationRole,
  ): HostMutationDecision;
  /**
   * Decides a whole set, returning every refusal. Callers report all of them
   * rather than the first, because an operator fixing one at a time learns the
   * shape of the boundary slowly and expensively.
   */
  authorizeAll(
    requests: readonly { path: string; role: HostMutationRole }[],
  ): readonly HostMutationDecision[];
}

export function createHostMutationAuthority(
  input: HostMutationAuthorityInput,
): HostMutationAuthority {
  const allowlists: Record<HostMutationRole, ReadonlySet<string>> = {
    rendererManaged: new Set(input.rendererManagedPaths),
    engineManaged: new Set(input.engineManagedPaths),
    manifest: new Set(input.manifestPaths ?? []),
  };
  const protectedRoots = Object.freeze(
    (input.protectedRoots ?? []).map(normalizeRoot),
  );

  function authorize(
    path: string,
    role: HostMutationRole,
  ): HostMutationDecision {
    const unusable = structurallyUnusable(path);
    if (unusable !== null) {
      return Object.freeze({
        allowed: false,
        path,
        role: null,
        reason: `Refused because ${unusable}.`,
      });
    }

    // Hard denials first. A path named in an allowlist must still not be one of
    // these, so that declaring a path cannot grant authority over it.
    for (const root of hardDeniedRoots) {
      if (isBeneath(path, root)) {
        return Object.freeze({
          allowed: false,
          path,
          role: null,
          reason: `Refused because ${root} is never writable by a lifecycle command.`,
        });
      }
    }
    if (hardDeniedExact.includes(path)) {
      return Object.freeze({
        allowed: false,
        path,
        role: null,
        reason: "Refused because it holds credentials.",
      });
    }
    for (const prefix of hardDeniedPrefixes) {
      if (path.startsWith(prefix)) {
        return Object.freeze({
          allowed: false,
          path,
          role: null,
          reason: "Refused because it holds credentials.",
        });
      }
    }
    if (
      path === RESERVED_HOST_CONFIG_PATH ||
      path === RESERVED_HOST_EXTENSIONS_PATH ||
      path === RESERVED_HOST_THEME_PATH
    ) {
      return Object.freeze({
        allowed: false,
        path,
        role: null,
        reason:
          "Refused because host configuration is author-owned code that the engine never reads or rewrites.",
      });
    }
    for (const root of protectedRoots) {
      if (isBeneath(path, root)) {
        return Object.freeze({
          allowed: false,
          path,
          role: null,
          reason: `Refused because it is inside the declared root ${root}, which holds publication sources or durable state.`,
        });
      }
    }

    const allowlist = allowlists[role];
    if (allowlist === undefined) {
      return Object.freeze({
        allowed: false,
        path,
        role: null,
        reason: `Refused because ${JSON.stringify(String(role))} is not a mutation role.`,
      });
    }
    if (!allowlist.has(path)) {
      return Object.freeze({
        allowed: false,
        path,
        role: null,
        reason: `Refused because it is not declared as ${role}. Nothing is writable unless a contract names it.`,
      });
    }

    return Object.freeze({
      allowed: true,
      path,
      role,
      reason: `Permitted as ${role}.`,
    });
  }

  function authorizeAll(
    requests: readonly { path: string; role: HostMutationRole }[],
  ): readonly HostMutationDecision[] {
    return Object.freeze(
      requests.map((request) =>
        authorize(request.path, request.role),
      ),
    );
  }

  return Object.freeze({ authorize, authorizeAll });
}

export class HostMutationPolicyError extends Error {
  readonly refusals: readonly HostMutationDecision[];

  constructor(refusals: readonly HostMutationDecision[]) {
    super(
      `The mutation policy refused ${refusals.length} path(s):\n${refusals
        .map((refusal) => `  ${refusal.path}: ${refusal.reason}`)
        .join("\n")}`,
    );
    this.name = "HostMutationPolicyError";
    this.refusals = Object.freeze([...refusals]);
  }
}

/** Throws unless every request is permitted, reporting all refusals together. */
export function assertHostMutationsPermitted(
  authority: HostMutationAuthority,
  requests: readonly { path: string; role: HostMutationRole }[],
): void {
  const refusals = authority
    .authorizeAll(requests)
    .filter((decision) => !decision.allowed);
  if (refusals.length > 0) {
    throw new HostMutationPolicyError(refusals);
  }
}
