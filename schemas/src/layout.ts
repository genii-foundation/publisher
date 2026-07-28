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

import type {
  Diagnostic,
  PublicationManifest,
  SourcePath,
  ValidationResult,
  WorkManifest,
} from "./types.js";
import { immutableSnapshot } from "./immutability.js";

export const CANONICAL_PUBLICATION_MANIFEST_PATH = "publication.json";
export const CANONICAL_WORKS_ROOT = "publication/works";
export const CANONICAL_WORK_MANIFEST_TEMPLATE = "{workId}/work.json";
export const CANONICAL_COLLECTIONS_ROOT = "publication/collections";
export const CANONICAL_COLLECTION_MANIFEST_TEMPLATE =
  "{collectionId}/collection.json";
export const CANONICAL_ASSETS_ROOT = "publication/assets";
export const CANONICAL_CONTINUITY_ROOT = "publication/continuity";
export const CANONICAL_OUTPUT_ROOT = ".publisher";

export const CANONICAL_LAYOUT = Object.freeze({
  publicationManifestPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
  works: Object.freeze({
    root: CANONICAL_WORKS_ROOT,
    manifestTemplate: CANONICAL_WORK_MANIFEST_TEMPLATE,
  }),
  collections: Object.freeze({
    root: CANONICAL_COLLECTIONS_ROOT,
    manifestTemplate: CANONICAL_COLLECTION_MANIFEST_TEMPLATE,
  }),
  assetsRoot: CANONICAL_ASSETS_ROOT,
  continuityRoot: CANONICAL_CONTINUITY_ROOT,
  outputRoot: CANONICAL_OUTPUT_ROOT,
});

export interface ResolvedManifestReference {
  readonly id: string;
  readonly manifestPath: string;
  readonly referenceIndex: number;
  readonly referencePointer: string;
}

export interface ResolvedManifestLayout {
  readonly root: string;
  readonly manifestTemplate: string;
  readonly manifests: readonly ResolvedManifestReference[];
}

export interface ResolvedPublicationLayout {
  readonly mode: "canonical" | "declared";
  readonly publicationManifestPath: string;
  readonly works: ResolvedManifestLayout;
  readonly collections: ResolvedManifestLayout;
  readonly assetsRoot: string;
  readonly continuityRoot: string;
  readonly outputRoot: string;
}

const WINDOWS_OR_POSIX_ABSOLUTE_PATH = /^(?:[A-Za-z]:|\\\\|\/\/|\/)/;
const ASCII_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const PERCENT_ENCODED_OCTET = /%[0-9a-f]{2}/i;
const URL_QUERY_OR_FRAGMENT_METACHARACTER = /[?#]/;
const WINDOWS_FORBIDDEN_FILENAME_CHARACTER = /[<>:"|?*]/;
const WINDOWS_RESERVED_DEVICE_BASENAME =
  /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;

function diagnostic(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>>,
  documentPath?: string,
): Diagnostic {
  const base = { severity: "error" as const, code, path, message, keyword, params };
  return documentPath === undefined ? base : { ...base, documentPath };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      compareText(left.documentPath ?? "", right.documentPath ?? "") ||
      compareText(left.path, right.path) ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message),
  );
}

/**
 * Validates the path invariants needed before any caller may hand a path to a
 * filesystem API. Shape validation is intentionally not a prerequisite.
 */
export function validateRepositoryRelativePath(
  value: string,
  pointer: string,
  documentPath?: string,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (value.length === 0) {
    diagnostics.push(
      diagnostic(
        "path.empty",
        pointer,
        "Repository paths must not be empty.",
        "safeRelativePath",
        { value },
        documentPath,
      ),
    );
    return diagnostics;
  }

  const segments = value.split("/");
  if (segments.includes(".")) {
    diagnostics.push(
      diagnostic(
        "path.current_directory",
        pointer,
        "Repository paths must not contain current-directory segments.",
        "safeRelativePath",
        { value },
        documentPath,
      ),
    );
  }

  if (value.includes("\\")) {
    diagnostics.push(
      diagnostic(
        "path.backslash",
        pointer,
        "Repository paths must use POSIX separators, not backslashes.",
        "safeRelativePath",
        { value },
        documentPath,
      ),
    );
  }

  if (WINDOWS_OR_POSIX_ABSOLUTE_PATH.test(value)) {
    diagnostics.push(
      diagnostic(
        "path.absolute",
        pointer,
        "Repository paths must be relative.",
        "safeRelativePath",
        { value },
        documentPath,
      ),
    );
  }

  if (segments.includes("..")) {
    diagnostics.push(
      diagnostic(
        "path.traversal",
        pointer,
        "Repository paths must not traverse to a parent directory.",
        "safeRelativePath",
        { value },
        documentPath,
      ),
    );
  }

  if (value.includes("//") || value.endsWith("/")) {
    diagnostics.push(
      diagnostic(
        "path.empty_segment",
        pointer,
        "Repository paths must not contain empty path segments.",
        "safeRelativePath",
        { value },
        documentPath,
      ),
    );
  }

  if (PERCENT_ENCODED_OCTET.test(value)) {
    diagnostics.push(
      diagnostic(
        "path.percent_encoding",
        pointer,
        "Repository paths must not contain percent-encoded octets.",
        "portableRelativePath",
        { value },
        documentPath,
      ),
    );
  }

  if (URL_QUERY_OR_FRAGMENT_METACHARACTER.test(value)) {
    diagnostics.push(
      diagnostic(
        "path.url_metacharacter",
        pointer,
        "Repository paths must not contain URL query or fragment metacharacters.",
        "portableRelativePath",
        { value },
        documentPath,
      ),
    );
  }

  if (ASCII_CONTROL_CHARACTER.test(value)) {
    diagnostics.push(
      diagnostic(
        "path.control_character",
        pointer,
        "Repository paths must not contain ASCII control characters.",
        "portableRelativePath",
        { value },
        documentPath,
      ),
    );
  }

  const windowsForbiddenSegments = segments.filter((segment) =>
    WINDOWS_FORBIDDEN_FILENAME_CHARACTER.test(segment),
  );
  if (windowsForbiddenSegments.length > 0) {
    diagnostics.push(
      diagnostic(
        "path.windows_forbidden_character",
        pointer,
        "Repository path segments must not contain Windows-forbidden filename characters.",
        "portableRelativePath",
        { value, segments: windowsForbiddenSegments },
        documentPath,
      ),
    );
  }

  const windowsReservedSegments = segments.filter((segment) =>
    WINDOWS_RESERVED_DEVICE_BASENAME.test(segment),
  );
  if (windowsReservedSegments.length > 0) {
    diagnostics.push(
      diagnostic(
        "path.windows_reserved_name",
        pointer,
        "Repository path segments must not use Windows reserved device names.",
        "portableRelativePath",
        { value, segments: windowsReservedSegments },
        documentPath,
      ),
    );
  }

  const windowsTrailingSegments = segments.filter(
    (segment) => segment.endsWith(".") || segment.endsWith(" "),
  );
  if (windowsTrailingSegments.length > 0) {
    diagnostics.push(
      diagnostic(
        "path.windows_trailing_character",
        pointer,
        "Repository path segments must not end with a dot or space.",
        "portableRelativePath",
        { value, segments: windowsTrailingSegments },
        documentPath,
      ),
    );
  }

  return immutableSnapshot(sortDiagnostics(diagnostics));
}

export function isPathWithinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function joinRepositoryPath(root: string, child: string): string {
  if (root.endsWith("/")) {
    return `${root}${child}`;
  }

  return `${root}/${child}`;
}

export function repositoryDirectoryName(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

export interface ResolvedWorkSourcePaths {
  readonly workId: string;
  readonly manifestPath: string;
  readonly manuscriptPath: string;
  readonly assetsPath?: string;
}

function resolveSourcePath(
  source: SourcePath,
  pointer: "/manuscript" | "/assets",
  manifestPath: string,
  diagnostics: Diagnostic[],
): string {
  const repositoryRelative = typeof source !== "string";
  const sourcePath = typeof source === "string" ? source : source.path;
  const sourceDiagnostics = validateRepositoryRelativePath(
    sourcePath,
    pointer,
    manifestPath,
  );
  diagnostics.push(...sourceDiagnostics);

  const manifestDirectory = repositoryDirectoryName(manifestPath);
  const resolvedPath =
    repositoryRelative || manifestDirectory.length === 0
      ? sourcePath
      : joinRepositoryPath(manifestDirectory, sourcePath);

  if (sourceDiagnostics.length === 0) {
    diagnostics.push(
      ...validateRepositoryRelativePath(resolvedPath, pointer, manifestPath),
    );
  }

  return resolvedPath;
}

/**
 * Resolves all file paths owned by one already loaded work manifest. This is
 * the single public source-path boundary used by semantic validation and
 * downstream compilers.
 */
export function resolveWorkSourcePaths(
  manifestPath: string,
  work: WorkManifest,
): ValidationResult<ResolvedWorkSourcePaths> {
  const diagnostics = [
    ...validateRepositoryRelativePath(manifestPath, "", manifestPath),
  ];
  const manuscriptPath = resolveSourcePath(
    work.manuscript,
    "/manuscript",
    manifestPath,
    diagnostics,
  );
  const assetsPath =
    work.assets === undefined
      ? undefined
      : resolveSourcePath(work.assets, "/assets", manifestPath, diagnostics);

  if (diagnostics.length > 0) {
    return immutableSnapshot({
      valid: false,
      diagnostics: sortDiagnostics(diagnostics),
    });
  }

  return immutableSnapshot({
    valid: true,
    value:
      assetsPath === undefined
        ? {
            workId: work.id,
            manifestPath,
            manuscriptPath,
          }
        : {
            workId: work.id,
            manifestPath,
            manuscriptPath,
            assetsPath,
          },
    diagnostics: [],
  });
}

function layoutSourcePointer(
  publication: PublicationManifest,
  role: "works" | "collections" | "assets" | "continuity",
  field?: "root",
): string {
  if (publication.layout.mode !== "declared") {
    return "/layout";
  }

  const override = publication.layout.overrides[role];
  if (override === undefined) {
    return "/layout";
  }

  if (field !== undefined) {
    if (
      typeof override === "object" &&
      field in override &&
      override[field] !== undefined
    ) {
      return `/layout/overrides/${role}/${field}`;
    }

    return "/layout";
  }

  return `/layout/overrides/${role}`;
}

function validateSourceContainment(
  sourcePath: string,
  pointer: string,
  sourceRoots: readonly string[],
  diagnostics: Diagnostic[],
  context: Readonly<Record<string, unknown>>,
): void {
  if (
    sourceRoots.length === 0 ||
    validateRepositoryRelativePath(
      sourcePath,
      pointer,
      CANONICAL_PUBLICATION_MANIFEST_PATH,
    ).length > 0
  ) {
    return;
  }

  if (!sourceRoots.some((root) => isPathWithinRoot(sourcePath, root))) {
    diagnostics.push(
      diagnostic(
        "boundary.source_outside_root",
        pointer,
        `Source "${sourcePath}" is outside every declared source root.`,
        "sourceContainment",
        { sourcePath, sourceRoots, ...context },
        CANONICAL_PUBLICATION_MANIFEST_PATH,
      ),
    );
  }
}

function validatePublicationBoundaries(
  publication: PublicationManifest,
  layout: ResolvedPublicationLayout,
  diagnostics: Diagnostic[],
): void {
  const sourceRoots: string[] = [];
  publication.boundaries.sourceRoots.forEach((sourceRoot, index) => {
    const pathDiagnostics = validateRepositoryRelativePath(
      sourceRoot,
      `/boundaries/sourceRoots/${index}`,
      CANONICAL_PUBLICATION_MANIFEST_PATH,
    );
    diagnostics.push(...pathDiagnostics);
    if (pathDiagnostics.length === 0) {
      sourceRoots.push(sourceRoot);
    }
  });

  const outputRoots: string[] = [];
  publication.boundaries.outputRoots.forEach((outputRoot, index) => {
    const pathDiagnostics = validateRepositoryRelativePath(
      outputRoot,
      `/boundaries/outputRoots/${index}`,
      CANONICAL_PUBLICATION_MANIFEST_PATH,
    );
    diagnostics.push(...pathDiagnostics);
    if (pathDiagnostics.length === 0) {
      outputRoots.push(outputRoot);
    }
  });

  sourceRoots.forEach((sourceRoot, sourceIndex) => {
    outputRoots.forEach((outputRoot, outputIndex) => {
      if (
        !isPathWithinRoot(sourceRoot, outputRoot) &&
        !isPathWithinRoot(outputRoot, sourceRoot)
      ) {
        return;
      }

      diagnostics.push(
        diagnostic(
          "boundary.source_output_overlap",
          `/boundaries/outputRoots/${outputIndex}`,
          `Source root "${sourceRoot}" overlaps output root "${outputRoot}".`,
          "disjointRoots",
          { sourceRoot, sourceIndex, outputRoot, outputIndex },
          CANONICAL_PUBLICATION_MANIFEST_PATH,
        ),
      );
    });
  });

  if (
    outputRoots.length > 0 &&
    !outputRoots.some((outputRoot) =>
      isPathWithinRoot(layout.outputRoot, outputRoot),
    )
  ) {
    diagnostics.push(
      diagnostic(
        "boundary.output_root_missing",
        "/boundaries/outputRoots",
        `Canonical output root "${layout.outputRoot}" is outside every declared output root.`,
        "outputContainment",
        { outputRoot: layout.outputRoot, declaredOutputRoots: outputRoots },
        CANONICAL_PUBLICATION_MANIFEST_PATH,
      ),
    );
  }

  const roleSources = [
    {
      path: layout.works.root,
      pointer: layoutSourcePointer(publication, "works", "root"),
      role: "works",
    },
    {
      path: layout.collections.root,
      pointer: layoutSourcePointer(publication, "collections", "root"),
      role: "collections",
    },
    {
      path: layout.assetsRoot,
      pointer: layoutSourcePointer(publication, "assets"),
      role: "assets",
    },
    {
      path: layout.continuityRoot,
      pointer: layoutSourcePointer(publication, "continuity"),
      role: "continuity",
    },
  ] as const;
  for (const source of roleSources) {
    validateSourceContainment(
      source.path,
      source.pointer,
      sourceRoots,
      diagnostics,
      { role: source.role },
    );
  }

  layout.works.manifests.forEach((reference) => {
    validateSourceContainment(
      reference.manifestPath,
      `${reference.referencePointer}${
        publication.works[reference.referenceIndex]?.manifest === undefined
          ? "/id"
          : "/manifest"
      }`,
      sourceRoots,
      diagnostics,
      { kind: "workManifest", id: reference.id },
    );
  });
  layout.collections.manifests.forEach((reference) => {
    validateSourceContainment(
      reference.manifestPath,
      `${reference.referencePointer}${
        publication.collections?.[reference.referenceIndex]?.manifest ===
        undefined
          ? "/id"
          : "/manifest"
      }`,
      sourceRoots,
      diagnostics,
      { kind: "collectionManifest", id: reference.id },
    );
  });

  if (publication.audio?.catalog !== undefined) {
    const audioDiagnostics = validateRepositoryRelativePath(
      publication.audio.catalog,
      "/audio/catalog",
      CANONICAL_PUBLICATION_MANIFEST_PATH,
    );
    diagnostics.push(...audioDiagnostics);
    if (audioDiagnostics.length === 0) {
      validateSourceContainment(
        publication.audio.catalog,
        "/audio/catalog",
        sourceRoots,
        diagnostics,
        { role: "audioCatalog" },
      );
    }
  }
}

function validateUniqueManifestPaths(
  publication: PublicationManifest,
  layout: ResolvedPublicationLayout,
  diagnostics: Diagnostic[],
): void {
  const firstByPath = new Map<
    string,
    {
      readonly id: string;
      readonly kind: "work" | "collection";
      readonly pointer: string;
    }
  >();
  const references = [
    ...layout.works.manifests.map((reference) => ({
      ...reference,
      kind: "work" as const,
      pointer: `${reference.referencePointer}${
        publication.works[reference.referenceIndex]?.manifest === undefined
          ? "/id"
          : "/manifest"
      }`,
    })),
    ...layout.collections.manifests.map((reference) => ({
      ...reference,
      kind: "collection" as const,
      pointer: `${reference.referencePointer}${
        publication.collections?.[reference.referenceIndex]?.manifest ===
        undefined
          ? "/id"
          : "/manifest"
      }`,
    })),
  ];

  for (const reference of references) {
    const first = firstByPath.get(reference.manifestPath);
    if (first === undefined) {
      firstByPath.set(reference.manifestPath, {
        id: reference.id,
        kind: reference.kind,
        pointer: reference.pointer,
      });
      continue;
    }

    diagnostics.push(
      diagnostic(
        "layout.manifest_path_duplicate",
        reference.pointer,
        `Manifest path "${reference.manifestPath}" is assigned more than once.`,
        "uniqueManifestPath",
        {
          manifestPath: reference.manifestPath,
          id: reference.id,
          kind: reference.kind,
          firstId: first.id,
          firstKind: first.kind,
          firstPointer: first.pointer,
        },
        CANONICAL_PUBLICATION_MANIFEST_PATH,
      ),
    );
  }
}

function resolveReferences(
  references: PublicationManifest["works"],
  root: string,
  manifestTemplate: string,
  token: "{workId}" | "{collectionId}",
  pointer: "/works" | "/collections",
  diagnostics: Diagnostic[],
): readonly ResolvedManifestReference[] {
  if (!manifestTemplate.includes(token)) {
    diagnostics.push(
      diagnostic(
        "layout.template_token_missing",
        pointer === "/works"
          ? "/layout/overrides/works/manifestTemplate"
          : "/layout/overrides/collections/manifestTemplate",
        `The manifest template must contain ${token}.`,
        "manifestTemplate",
        { token, manifestTemplate },
        CANONICAL_PUBLICATION_MANIFEST_PATH,
      ),
    );
  }

  return references.map((reference, index) => {
    const referencePointer = `${pointer}/${index}`;
    const generatedPath = joinRepositoryPath(
      root,
      manifestTemplate.replaceAll(token, reference.id),
    );
    const manifestPath = reference.manifest ?? generatedPath;
    const manifestPointer =
      reference.manifest === undefined
        ? `${referencePointer}/id`
        : `${referencePointer}/manifest`;

    diagnostics.push(
      ...validateRepositoryRelativePath(
        manifestPath,
        manifestPointer,
        CANONICAL_PUBLICATION_MANIFEST_PATH,
      ),
    );

    return {
      id: reference.id,
      manifestPath,
      referenceIndex: index,
      referencePointer,
    };
  });
}

export function resolvePublicationLayout(
  publication: PublicationManifest,
): ValidationResult<ResolvedPublicationLayout> {
  const diagnostics: Diagnostic[] = [];
  const declaredOverrides =
    publication.layout.mode === "declared"
      ? publication.layout.overrides
      : undefined;
  const worksRoot =
    declaredOverrides?.works?.root ?? CANONICAL_LAYOUT.works.root;
  const workManifestTemplate =
    declaredOverrides?.works?.manifestTemplate ??
    CANONICAL_LAYOUT.works.manifestTemplate;
  const collectionsRoot =
    declaredOverrides?.collections?.root ?? CANONICAL_LAYOUT.collections.root;
  const collectionManifestTemplate =
    declaredOverrides?.collections?.manifestTemplate ??
    CANONICAL_LAYOUT.collections.manifestTemplate;
  const assetsRoot = declaredOverrides?.assets ?? CANONICAL_LAYOUT.assetsRoot;
  const continuityRoot =
    declaredOverrides?.continuity ?? CANONICAL_LAYOUT.continuityRoot;

  const pathInputs = [
    {
      value: worksRoot,
      pointer:
        declaredOverrides?.works?.root === undefined
          ? "/layout/mode"
          : "/layout/overrides/works/root",
    },
    {
      value: workManifestTemplate,
      pointer:
        declaredOverrides?.works?.manifestTemplate === undefined
          ? "/layout/mode"
          : "/layout/overrides/works/manifestTemplate",
    },
    {
      value: collectionsRoot,
      pointer:
        declaredOverrides?.collections?.root === undefined
          ? "/layout/mode"
          : "/layout/overrides/collections/root",
    },
    {
      value: collectionManifestTemplate,
      pointer:
        declaredOverrides?.collections?.manifestTemplate === undefined
          ? "/layout/mode"
          : "/layout/overrides/collections/manifestTemplate",
    },
    {
      value: assetsRoot,
      pointer:
        declaredOverrides?.assets === undefined
          ? "/layout/mode"
          : "/layout/overrides/assets",
    },
    {
      value: continuityRoot,
      pointer:
        declaredOverrides?.continuity === undefined
          ? "/layout/mode"
          : "/layout/overrides/continuity",
    },
  ] as const;

  for (const input of pathInputs) {
    diagnostics.push(
      ...validateRepositoryRelativePath(
        input.value,
        input.pointer,
        CANONICAL_PUBLICATION_MANIFEST_PATH,
      ),
    );
  }

  const works = resolveReferences(
    publication.works,
    worksRoot,
    workManifestTemplate,
    "{workId}",
    "/works",
    diagnostics,
  );
  const collections = resolveReferences(
    publication.collections ?? [],
    collectionsRoot,
    collectionManifestTemplate,
    "{collectionId}",
    "/collections",
    diagnostics,
  );
  const resolvedLayout: ResolvedPublicationLayout = {
    mode: publication.layout.mode,
    publicationManifestPath: CANONICAL_PUBLICATION_MANIFEST_PATH,
    works: {
      root: worksRoot,
      manifestTemplate: workManifestTemplate,
      manifests: works,
    },
    collections: {
      root: collectionsRoot,
      manifestTemplate: collectionManifestTemplate,
      manifests: collections,
    },
    assetsRoot,
    continuityRoot,
    outputRoot: CANONICAL_OUTPUT_ROOT,
  };

  validateUniqueManifestPaths(publication, resolvedLayout, diagnostics);
  validatePublicationBoundaries(publication, resolvedLayout, diagnostics);

  if (diagnostics.length > 0) {
    return immutableSnapshot({
      valid: false,
      diagnostics: sortDiagnostics(diagnostics),
    });
  }

  return immutableSnapshot({
    valid: true,
    value: resolvedLayout,
    diagnostics: [],
  });
}
