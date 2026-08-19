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
import {
  UNICODE_DEFAULT_CASE_FOLDING_VERSION,
  unicodeFullDefaultCaseFold,
} from "./generated-unicode-case-folding.js";
import { immutableSnapshot } from "./immutability.js";
import {
  normalizePortableRepositoryText,
  PORTABLE_REPOSITORY_NORMALIZATION_VERSION,
} from "./portable-unicode.js";
import { PUBLICATION_PROTOCOL_LIMITS } from "./protocol-limits.js";

export {
  normalizePortableRepositoryText,
  PORTABLE_REPOSITORY_NORMALIZATION_VERSION,
} from "./portable-unicode.js";
export { PUBLICATION_PROTOCOL_LIMITS } from "./protocol-limits.js";

export const CANONICAL_PUBLICATION_MANIFEST_PATH = "publication.json";
export const CANONICAL_WORKS_ROOT = "publication/works";
export const CANONICAL_WORK_MANIFEST_TEMPLATE = "{workId}/work.json";
export const CANONICAL_COLLECTIONS_ROOT = "publication/collections";
export const CANONICAL_COLLECTION_MANIFEST_TEMPLATE =
  "{collectionId}/collection.json";
export const CANONICAL_ASSETS_ROOT = "publication/assets";
export const CANONICAL_CONTINUITY_ROOT = "publication/continuity";
export const CANONICAL_OUTPUT_ROOT = ".publisher";
export const RESERVED_HOST_INTEGRATION_PATHS = Object.freeze([
  "publisher.config.ts",
  "publisher.theme.mjs",
] as const);

export const MAXIMUM_PROTOCOL_DIAGNOSTICS = 256;
export const PORTABLE_REPOSITORY_CASE_FOLDING_VERSION =
  UNICODE_DEFAULT_CASE_FOLDING_VERSION;

/**
 * Returns the filesystem-independent identity used for every repository path
 * comparison in the protocol. It applies the bundled Unicode 15.1 full
 * default case fold, using CaseFolding statuses C and F without locale or
 * Turkic mappings, then normalizes the result to NFC.
 */
export function portableRepositoryPathIdentity(
  path: string,
): string {
  return normalizePortableRepositoryText(
    unicodeFullDefaultCaseFold(path),
  );
}

/**
 * Returns the cross-filesystem identity of one repository path segment.
 * Folding remains a separate protocol decision in
 * portableRepositoryPathIdentity. The target-filesystem layer then removes
 * trailing dots and spaces, which Win32 ignores when resolving ordinary path
 * components.
 */
export function portableRepositorySegmentIdentity(
  segment: string,
): string {
  return portableRepositoryPathIdentity(segment).replace(/[. ]+$/u, "");
}

export function isReservedHostIntegrationPath(
  path: string,
): boolean {
  const identity = portableRepositoryPathIdentity(path);
  return RESERVED_HOST_INTEGRATION_PATHS.some(
    (reservedPath) =>
      portableRepositoryPathIdentity(reservedPath) === identity,
  );
}

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
const BIDIRECTIONAL_CONTROL_CHARACTER =
  /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const UNICODE_LINE_OR_PARAGRAPH_SEPARATOR = /[\u2028\u2029]/u;
const PERCENT_ENCODED_OCTET = /%[0-9a-f]{2}/i;
const URL_QUERY_OR_FRAGMENT_METACHARACTER = /[?#]/;
const WINDOWS_FORBIDDEN_FILENAME_CHARACTER = /[<>:"|?*]/;
const WINDOWS_RESERVED_DEVICE_BASENAME =
  /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;
const MAX_REPOSITORY_PATH_SCALARS = 1024;
const MAX_REPOSITORY_PATH_CODE_UNITS = 2048;
const MAX_REPOSITORY_PATH_BYTES = 4096;
const MAX_REPOSITORY_PATH_SEGMENTS = 256;
const MAX_REPOSITORY_SEGMENT_BYTES = 255;
const pathEncoder = new TextEncoder();

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function unicodeScalarCount(value: string): number {
  let count = 0;
  for (const _character of value) {
    count += 1;
  }
  return count;
}

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

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`,
    )
    .join(",")}}`;
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    compareText(left.documentPath ?? "", right.documentPath ?? "") ||
    compareText(left.path, right.path) ||
    compareText(left.code, right.code) ||
    compareText(left.schemaPath ?? "", right.schemaPath ?? "") ||
    compareText(left.keyword, right.keyword) ||
    compareText(left.message, right.message) ||
    compareText(left.severity, right.severity) ||
    compareText(stableSerialize(left.params), stableSerialize(right.params))
  );
}

function sortDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  const maximumDetails = MAXIMUM_PROTOCOL_DIAGNOSTICS - 1;
  const sorted = [...diagnostics].sort(compareDiagnostics);
  const omittedDiagnostics = Math.max(
    0,
    sorted.length - maximumDetails,
  );
  const bounded = sorted.slice(0, maximumDetails);
  if (omittedDiagnostics > 0) {
    bounded.push(
      diagnostic(
        "validation.diagnostics_truncated",
        "",
        "Further protocol diagnostics were omitted after the fixed reporting limit.",
        "diagnosticLimit",
        {
          maximumDiagnostics:
            MAXIMUM_PROTOCOL_DIAGNOSTICS,
          omittedDiagnostics,
        },
      ),
    );
  }
  return bounded.sort(compareDiagnostics);
}

function validateReservedHostIntegrationUse(
  sourcePath: string,
  pointer: string,
  role: string,
  diagnostics: Diagnostic[],
  documentPath = CANONICAL_PUBLICATION_MANIFEST_PATH,
): void {
  if (!isReservedHostIntegrationPath(sourcePath)) {
    return;
  }
  diagnostics.push(
    diagnostic(
      "source.path_reserved",
      pointer,
      `Host integration path "${sourcePath}" cannot be used as publication source.`,
      "reservedHostIntegrationPath",
      { sourcePath, role },
      documentPath,
    ),
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
  if (value.length > MAX_REPOSITORY_PATH_CODE_UNITS) {
    diagnostics.push(
      diagnostic(
        "path.length",
        pointer,
        "Repository paths must not exceed 2,048 UTF-16 code units.",
        "portableRelativePath",
        {
          actualCodeUnits: value.length,
          maximumCodeUnits: MAX_REPOSITORY_PATH_CODE_UNITS,
        },
        documentPath,
      ),
    );
    return immutableSnapshot(sortDiagnostics(diagnostics));
  }
  if (!isWellFormedUnicode(value)) {
    diagnostics.push(
      diagnostic(
        "path.invalid_unicode",
        pointer,
        "Repository paths must contain only well-formed Unicode scalar values.",
        "portableRelativePath",
        {},
        documentPath,
      ),
    );
    return immutableSnapshot(sortDiagnostics(diagnostics));
  }
  const scalarCount = unicodeScalarCount(value);
  if (scalarCount > MAX_REPOSITORY_PATH_SCALARS) {
    diagnostics.push(
      diagnostic(
        "path.scalar_length",
        pointer,
        "Repository paths must not exceed 1,024 Unicode scalar values.",
        "portableRelativePath",
        {
          actualScalars: scalarCount,
          maximumScalars: MAX_REPOSITORY_PATH_SCALARS,
        },
        documentPath,
      ),
    );
  }
  if (normalizePortableRepositoryText(value) !== value) {
    diagnostics.push(
      diagnostic(
        "path.not_nfc",
        pointer,
        "Repository paths must use Unicode NFC.",
        "portableRelativePath",
        {},
        documentPath,
      ),
    );
  }
  if (BIDIRECTIONAL_CONTROL_CHARACTER.test(value)) {
    diagnostics.push(
      diagnostic(
        "path.bidi_control",
        pointer,
        "Repository paths must not contain bidirectional control characters.",
        "portableRelativePath",
        {},
        documentPath,
      ),
    );
  }
  if (UNICODE_LINE_OR_PARAGRAPH_SEPARATOR.test(value)) {
    diagnostics.push(
      diagnostic(
        "path.unicode_line_separator",
        pointer,
        "Repository paths must not contain Unicode line or paragraph separators.",
        "portableRelativePath",
        {},
        documentPath,
      ),
    );
  }
  const encodedPathBytes = pathEncoder.encode(value).byteLength;
  if (encodedPathBytes > MAX_REPOSITORY_PATH_BYTES) {
    diagnostics.push(
      diagnostic(
        "path.byte_length",
        pointer,
        "Repository paths must not exceed 4,096 UTF-8 bytes.",
        "portableRelativePath",
        {
          actualBytes: encodedPathBytes,
          maximumBytes: MAX_REPOSITORY_PATH_BYTES,
        },
        documentPath,
      ),
    );
  }

  const segments = value.split("/");
  if (segments.length > MAX_REPOSITORY_PATH_SEGMENTS) {
    diagnostics.push(
      diagnostic(
        "path.segment_count",
        pointer,
        "Repository paths must not exceed 256 segments.",
        "portableRelativePath",
        {
          actualSegments: segments.length,
          maximumSegments: MAX_REPOSITORY_PATH_SEGMENTS,
        },
        documentPath,
      ),
    );
  }
  const oversizedSegmentIndexes = segments
    .map((segment, index) => ({
      index,
      bytes: pathEncoder.encode(segment).byteLength,
    }))
    .filter(({ bytes }) => bytes > MAX_REPOSITORY_SEGMENT_BYTES);
  if (oversizedSegmentIndexes.length > 0) {
    diagnostics.push(
      diagnostic(
        "path.segment_byte_length",
        pointer,
        "Repository path segments must not exceed 255 UTF-8 bytes.",
        "portableRelativePath",
        {
          segments: oversizedSegmentIndexes,
          maximumBytes: MAX_REPOSITORY_SEGMENT_BYTES,
        },
        documentPath,
      ),
    );
  }
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
    (segment) =>
      portableRepositorySegmentIdentity(segment) !==
      portableRepositoryPathIdentity(segment),
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
  const pathIdentity = portableRepositoryPathIdentity(path);
  const rootIdentity = portableRepositoryPathIdentity(root);
  return (
    pathIdentity === rootIdentity ||
    pathIdentity.startsWith(`${rootIdentity}/`)
  );
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
  validateReservedHostIntegrationUse(
    manuscriptPath,
    "/manuscript",
    "manuscript",
    diagnostics,
    manifestPath,
  );
  if (assetsPath !== undefined) {
    validateReservedHostIntegrationUse(
      assetsPath,
      "/assets",
      "workAssets",
      diagnostics,
      manifestPath,
    );
  }

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
      validateReservedHostIntegrationUse(
        sourceRoot,
        `/boundaries/sourceRoots/${index}`,
        "sourceRoot",
        diagnostics,
      );
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
      validateReservedHostIntegrationUse(
        outputRoot,
        `/boundaries/outputRoots/${index}`,
        "outputRoot",
        diagnostics,
      );
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
    validateReservedHostIntegrationUse(
      source.path,
      source.pointer,
      source.role,
      diagnostics,
    );
    validateSourceContainment(
      source.path,
      source.pointer,
      sourceRoots,
      diagnostics,
      { role: source.role },
    );
  }

  layout.works.manifests.forEach((reference) => {
    const pointer = `${reference.referencePointer}${
      publication.works[reference.referenceIndex]?.manifest ===
      undefined
        ? "/id"
        : "/manifest"
    }`;
    validateReservedHostIntegrationUse(
      reference.manifestPath,
      pointer,
      "workManifest",
      diagnostics,
    );
    validateSourceContainment(
      reference.manifestPath,
      pointer,
      sourceRoots,
      diagnostics,
      { kind: "workManifest", id: reference.id },
    );
  });
  layout.collections.manifests.forEach((reference) => {
    const pointer = `${reference.referencePointer}${
      publication.collections?.[reference.referenceIndex]?.manifest ===
      undefined
        ? "/id"
        : "/manifest"
    }`;
    validateReservedHostIntegrationUse(
      reference.manifestPath,
      pointer,
      "collectionManifest",
      diagnostics,
    );
    validateSourceContainment(
      reference.manifestPath,
      pointer,
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
      validateReservedHostIntegrationUse(
        publication.audio.catalog,
        "/audio/catalog",
        "audioCatalog",
        diagnostics,
      );
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
    const pathIdentity = portableRepositoryPathIdentity(
      reference.manifestPath,
    );
    const first = firstByPath.get(pathIdentity);
    if (first === undefined) {
      firstByPath.set(pathIdentity, {
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

export function validatePublicationResourceLimits(
  publication: PublicationManifest,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const limits = [
    {
      actual: publication.works.length,
      maximum: PUBLICATION_PROTOCOL_LIMITS.maximumWorks,
      path: "/works",
      resource: "works",
    },
    {
      actual: publication.collections?.length ?? 0,
      maximum: PUBLICATION_PROTOCOL_LIMITS.maximumCollections,
      path: "/collections",
      resource: "collections",
    },
    {
      actual: publication.extensions?.length ?? 0,
      maximum: PUBLICATION_PROTOCOL_LIMITS.maximumExtensions,
      path: "/extensions",
      resource: "extensions",
    },
    {
      actual: publication.continuity?.redirects.length ?? 0,
      maximum: PUBLICATION_PROTOCOL_LIMITS.maximumRedirects,
      path: "/continuity/redirects",
      resource: "redirects",
    },
    {
      actual: publication.boundaries.sourceRoots.length,
      maximum: PUBLICATION_PROTOCOL_LIMITS.maximumSourceRoots,
      path: "/boundaries/sourceRoots",
      resource: "sourceRoots",
    },
    {
      actual: publication.boundaries.outputRoots.length,
      maximum: PUBLICATION_PROTOCOL_LIMITS.maximumOutputRoots,
      path: "/boundaries/outputRoots",
      resource: "outputRoots",
    },
  ] as const;
  for (const limit of limits) {
    if (limit.actual <= limit.maximum) {
      continue;
    }
    diagnostics.push(
      diagnostic(
        "publication.resource_limit",
        limit.path,
        `Publication ${limit.resource} exceed the protocol limit of ${limit.maximum.toLocaleString("en-US")}.`,
        "maxItems",
        {
          resource: limit.resource,
          actualItems: limit.actual,
          maximumItems: limit.maximum,
        },
        CANONICAL_PUBLICATION_MANIFEST_PATH,
      ),
    );
  }
  return immutableSnapshot(sortDiagnostics(diagnostics));
}

export function resolvePublicationLayout(
  publication: PublicationManifest,
): ValidationResult<ResolvedPublicationLayout> {
  const resourceDiagnostics =
    validatePublicationResourceLimits(publication);
  if (resourceDiagnostics.length > 0) {
    return immutableSnapshot({
      valid: false,
      diagnostics: resourceDiagnostics,
    });
  }
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
