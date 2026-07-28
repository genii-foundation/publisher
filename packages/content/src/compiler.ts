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

import {
  CONTENT_ARTIFACT_MEDIA_TYPE,
  CONTENT_ARTIFACT_RELATIVE_PATH,
  CONTENT_ENVELOPE_SCHEMA_URL,
  CONTENT_SCHEMA_VERSION,
  EXTENSION_CAPABILITIES,
  isPathWithinRoot,
  resolvePublicationSourcesForContentCompilation,
  validateContentEnvelopeShape,
  validateRepositoryRelativePath,
  type CompiledCollection,
  type CompiledContentPayload,
  type CompiledExtension,
  type CompiledPublication,
  type CompiledSection,
  type CompiledWork,
  type ContentAddress,
  type ContentContinuity,
  type ContentLocation,
  type ContentRoute,
  type Diagnostic,
  type ExtensionCapability,
  type JSONValue,
  type MarkdownContentBlock,
  type PublicationContentEnvelope,
  type ResolvedContentAsset,
  type ResolvedContentLink,
  type Sha256Digest,
  type SourcePoint,
  type SourceProvenance,
  type SourceSpan,
  type ValidationResult,
} from "@genii-foundation/publisher-schema";

import { canonicalizeJson } from "./canonical-json.js";
import { hashCanonicalJson, sha256 } from "./hashing.js";
import { immutableSnapshot } from "./immutability.js";
import {
  calculateReadingMinutes,
  CONTENT_UNICODE_VERSION,
  countWords,
  normalizeTextNewlines,
} from "./markdown.js";
import {
  CONTENT_COMPILER_VERSION,
  DEFAULT_WORDS_PER_MINUTE,
  type CompilationSourceInput,
  type CompilePublicationContentInput,
  type PublicationContentArtifact,
  type ResolvedContentAssetInput,
  type ResolvedContentLinkInput,
  type SectionContentInput,
  type WorkContentInput,
} from "./types.js";
import {
  EXACT_SEMVER,
  diagnostic,
  sortDiagnostics,
  validateAbsoluteHttpUrl,
  validateContentId,
  validatePackageName,
  validateResolvedHref,
  validateRoute,
  validateStableId,
  validateUrlFragment,
} from "./validation.js";

interface NormalizedSource {
  readonly path: string;
  readonly role: SourceProvenance["role"];
  readonly entityId?: string;
  readonly mediaType: string;
  readonly contents: string | Uint8Array;
  readonly provenance: SourceProvenance;
  readonly lineStarts?: readonly number[];
}

interface ExpectedSource {
  readonly role: SourceProvenance["role"];
  readonly entityId?: string;
  readonly manifest?: unknown;
}

interface ContentIndexes {
  readonly workById: ReadonlyMap<string, CompiledWork>;
  readonly collectionById: ReadonlyMap<string, CompiledCollection>;
  readonly sectionByWorkAndId: ReadonlyMap<string, CompiledSection>;
  readonly blockByLocation: ReadonlyMap<string, MarkdownContentBlock>;
  readonly sectionRouteByLocationAndName: ReadonlyMap<string, string>;
}

const CORE_METRICS_IDENTITY = Object.freeze({
  id: "unicode-word-count",
  package: "@genii-foundation/publisher-content",
  version: CONTENT_COMPILER_VERSION,
  profileVersion: CONTENT_UNICODE_VERSION,
});
const EMPTY_CONTENT_HASH = sha256(new Uint8Array());
const EXTENSION_CAPABILITY_SET: ReadonlySet<string> = new Set(
  EXTENSION_CAPABILITIES,
);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function asJson(value: unknown): JSONValue {
  return value as JSONValue;
}

function hashValue(value: unknown): Sha256Digest {
  return hashCanonicalJson(asJson(value));
}

function blockHashBasis(block: {
  readonly kind: string;
  readonly markdown: string;
  readonly text: string;
  readonly wordCount: number;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}): JSONValue {
  return {
    kind: block.kind,
    markdown: block.markdown,
    text: block.text,
    wordCount: block.wordCount,
    ...(block.metadata === undefined
      ? {}
      : { metadata: block.metadata }),
  };
}

function sectionHashBasis(section: {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly depth: number;
  readonly order: number;
  readonly routes: Readonly<Record<string, ContentAddress>>;
  readonly activeRouteNames: readonly string[];
  readonly readerAddress: ContentAddress | null;
  readonly continuity: ContentContinuity;
  readonly navigable: boolean;
  readonly blocks: readonly {
    readonly id: string;
    readonly anchor: string;
    readonly contentHash: Sha256Digest;
  }[];
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}): JSONValue {
  return asJson({
    id: section.id,
    role: section.role,
    title: section.title,
    parentId: section.parentId,
    childIds: section.childIds,
    depth: section.depth,
    order: section.order,
    routes: section.routes,
    activeRouteNames: section.activeRouteNames,
    readerAddress: section.readerAddress,
    continuity: section.continuity,
    navigable: section.navigable,
    blocks: section.blocks.map((block) => ({
      id: block.id,
      anchor: block.anchor,
      contentHash: block.contentHash,
    })),
    ...(section.metadata === undefined
      ? {}
      : { metadata: section.metadata }),
  });
}

function workHashBasis(work: {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly summary?: string;
  readonly language: string;
  readonly publicationState: string;
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly route: string;
  readonly source: {
    readonly adapter: {
      readonly id: string;
      readonly package: string;
      readonly version: string;
    };
    readonly metrics: {
      readonly id: string;
      readonly package: string;
      readonly version: string;
      readonly profileVersion: string;
    };
  };
  readonly rootSectionIds: readonly string[];
  readonly sections: readonly {
    readonly id: string;
    readonly contentHash: Sha256Digest;
  }[];
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}): JSONValue {
  return asJson({
    id: work.id,
    title: work.title,
    ...(work.subtitle === undefined ? {} : { subtitle: work.subtitle }),
    ...(work.summary === undefined ? {} : { summary: work.summary }),
    language: work.language,
    publicationState: work.publicationState,
    ...(work.publishedAt === undefined
      ? {}
      : { publishedAt: work.publishedAt }),
    ...(work.updatedAt === undefined
      ? {}
      : { updatedAt: work.updatedAt }),
    route: work.route,
    adapter: work.source.adapter,
    metrics: work.source.metrics,
    rootSectionIds: work.rootSectionIds,
    sections: work.sections.map((section) => ({
      id: section.id,
      contentHash: section.contentHash,
    })),
    ...(work.metadata === undefined ? {} : { metadata: work.metadata }),
  });
}

function envelopeContentHashBasis(
  envelope: Pick<
    PublicationContentEnvelope,
    | "assets"
    | "collections"
    | "extensions"
    | "links"
    | "payloads"
    | "publication"
    | "routes"
    | "sourceAuthority"
    | "statistics"
    | "works"
  >,
): JSONValue {
  return asJson({
    publication: envelope.publication,
    sourceAuthority: envelope.sourceAuthority,
    works: envelope.works,
    collections: envelope.collections,
    extensions: envelope.extensions,
    payloads: envelope.payloads,
    assets: envelope.assets,
    links: envelope.links,
    routes: envelope.routes,
    statistics: envelope.statistics,
  });
}

function contentPayloadHashBasis(
  payload: Pick<
    CompiledContentPayload,
    "data" | "extensionId" | "id" | "schema" | "sourcePaths"
  >,
): JSONValue {
  return asJson({
    id: payload.id,
    extensionId: payload.extensionId,
    schema: payload.schema,
    sourcePaths: payload.sourcePaths,
    data: payload.data,
  });
}

function envelopeBuildHashBasis(
  envelope: Pick<
    PublicationContentEnvelope,
    | "artifact"
    | "compilerVersion"
    | "engineVersion"
    | "hashes"
    | "publicationId"
    | "schemaVersion"
  >,
): JSONValue {
  return asJson({
    schemaVersion: envelope.schemaVersion,
    publicationId: envelope.publicationId,
    engineVersion: envelope.engineVersion,
    compilerVersion: envelope.compilerVersion,
    artifact: envelope.artifact,
    hashes: envelope.hashes,
  });
}

function cloneJsonObject(
  value: Readonly<Record<string, JSONValue>> | undefined,
  path: string,
  diagnostics: Diagnostic[],
): Readonly<Record<string, JSONValue>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(canonicalizeJson(value)) as Readonly<
      Record<string, JSONValue>
    >;
  } catch {
    diagnostics.push(
      diagnostic(
        "content.metadata.invalid",
        path,
        "Content metadata must contain only acyclic JSON values.",
        "jsonValue",
        { reason: "invalidJsonValue" },
      ),
    );
    return undefined;
  }
}

function cloneJsonValue(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): JSONValue | undefined {
  try {
    return JSON.parse(canonicalizeJson(value as JSONValue)) as JSONValue;
  } catch {
    diagnostics.push(
      diagnostic(
        "content.payload.data_invalid",
        path,
        "Content payload data must contain only acyclic JSON values.",
        "jsonValue",
        {},
      ),
    );
    return undefined;
  }
}

function textLineStarts(value: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function pointAt(
  value: string,
  lineStarts: readonly number[],
  offset: number,
): SourcePoint {
  let low = 0;
  let high = lineStarts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = lineStarts[middle] ?? 0;
    if (candidate <= offset) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const lineStart = lineStarts[low] ?? 0;
  return {
    line: low + 1,
    column: offset - lineStart + 1,
    offset,
  };
}

function splitsSurrogatePair(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) {
    return false;
  }
  const previous = value.charCodeAt(offset - 1);
  const current = value.charCodeAt(offset);
  return (
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff
  );
}

function firstUnpairedSurrogate(value: string): number | undefined {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return index;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return index;
    }
  }
  return undefined;
}

function normalizeSource(
  source: CompilationSourceInput,
  diagnostics: Diagnostic[],
  index: number,
): NormalizedSource | undefined {
  const sourcePath = `/sources/${index}/path`;
  diagnostics.push(
    ...validateRepositoryRelativePath(source.path, sourcePath),
  );
  if (
    typeof source.mediaType !== "string" ||
    source.mediaType.length === 0 ||
    source.mediaType.length > 256
  ) {
    diagnostics.push(
      diagnostic(
        "content.source.media_type_invalid",
        `/sources/${index}/mediaType`,
        "A source media type must contain between 1 and 256 characters.",
        "mediaType",
        { mediaType: source.mediaType },
      ),
    );
  }

  let rawBytes: Uint8Array;
  let contents: string | Uint8Array;
  if (typeof source.contents === "string") {
    if (!(source.rawBytes instanceof Uint8Array)) {
      diagnostics.push(
        diagnostic(
          "content.source.raw_bytes_required",
          `/sources/${index}/rawBytes`,
          "Text sources must include the exact UTF-8 bytes decoded into contents.",
          "sourceBytes",
          { sourcePath: source.path },
          source.path,
        ),
      );
      return undefined;
    }
    rawBytes = new Uint8Array(source.rawBytes);
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(rawBytes);
    } catch {
      diagnostics.push(
        diagnostic(
          "content.source.utf8_invalid",
          `/sources/${index}/rawBytes`,
          "Text source bytes must be well-formed UTF-8.",
          "utf8",
          { sourcePath: source.path },
          source.path,
        ),
      );
      return undefined;
    }
    if (decoded !== source.contents) {
      diagnostics.push(
        diagnostic(
          "content.source.decoding_mismatch",
          `/sources/${index}`,
          "Text source contents must exactly match a fatal UTF-8 decode of rawBytes.",
          "sourceBytes",
          { sourcePath: source.path },
          source.path,
        ),
      );
      return undefined;
    }
    contents = normalizeTextNewlines(source.contents);
    const invalidOffset = firstUnpairedSurrogate(contents);
    if (invalidOffset !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.source.unpaired_surrogate",
          `/sources/${index}/contents`,
          "Text sources must contain well-formed Unicode.",
          "wellFormedUnicode",
          { sourcePath: source.path, offset: invalidOffset },
          source.path,
        ),
      );
      return undefined;
    }
  } else if (source.contents instanceof Uint8Array) {
    if (source.rawBytes !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.source.raw_bytes_unexpected",
          `/sources/${index}/rawBytes`,
          "Binary source contents already carry their exact bytes.",
          "sourceBytes",
          { sourcePath: source.path },
          source.path,
        ),
      );
    }
    rawBytes = new Uint8Array(source.contents);
    contents = new Uint8Array(source.contents);
  } else {
    diagnostics.push(
      diagnostic(
        "content.source.contents_invalid",
        `/sources/${index}/contents`,
        "Source contents must be text or a byte array.",
        "sourceContents",
        { actualType: typeof source.contents },
      ),
    );
    return undefined;
  }

  const rawByteLength = rawBytes.byteLength;
  const normalizedByteLength =
    typeof contents === "string"
      ? new TextEncoder().encode(contents).byteLength
      : contents.byteLength;
  const provenance: SourceProvenance = {
    path: source.path,
    role: source.role,
    ...(source.entityId === undefined
      ? {}
      : { entityId: source.entityId }),
    mediaType: source.mediaType,
    rawByteLength,
    rawHash: sha256(rawBytes),
    normalizedByteLength,
    normalizedHash: sha256(contents),
    ...(typeof contents === "string"
      ? {
          kind: "text" as const,
          encoding: "utf-8" as const,
          normalizedCodeUnitLength: contents.length,
          normalizedLineStarts: textLineStarts(contents),
        }
      : { kind: "binary" as const }),
  };
  return {
    path: source.path,
    role: source.role,
    ...(source.entityId === undefined
      ? {}
      : { entityId: source.entityId }),
    mediaType: source.mediaType,
    contents,
    provenance,
    ...(typeof contents === "string"
      ? { lineStarts: textLineStarts(contents) }
      : {}),
  };
}

function expectedSources(
  input: CompilePublicationContentInput,
): ReadonlyMap<string, ExpectedSource> {
  const expected = new Map<string, ExpectedSource>();
  expected.set(input.sourceGraph.layout.publicationManifestPath, {
    role: "publication-manifest",
    manifest: input.publication,
  });
  for (const work of input.sourceGraph.works) {
    expected.set(work.manifestPath, {
      role: "work-manifest",
      entityId: work.workId,
      manifest: work.manifest,
    });
    expected.set(work.manuscriptPath, {
      role: "manuscript",
      entityId: work.workId,
    });
  }
  for (const collection of input.sourceGraph.collections) {
    expected.set(collection.manifestPath, {
      role: "collection-manifest",
      entityId: collection.collectionId,
      manifest: collection.manifest,
    });
  }
  for (const payload of input.payloads ?? []) {
    for (const sourcePath of payload.sourcePaths) {
      if (!expected.has(sourcePath)) {
        expected.set(sourcePath, {
          role: "extension",
          entityId: payload.extensionId,
        });
      }
    }
  }
  return expected;
}

function compareManifestSource(
  source: NormalizedSource,
  expected: unknown,
  diagnostics: Diagnostic[],
): void {
  if (typeof source.contents !== "string") {
    diagnostics.push(
      diagnostic(
        "content.source.manifest_not_text",
        "",
        `Manifest source "${source.path}" must be injected as text.`,
        "textManifest",
        { sourcePath: source.path },
        source.path,
      ),
    );
    return;
  }

  try {
    const parsed = JSON.parse(source.contents) as JSONValue;
    if (
      canonicalizeJson(parsed) !==
      canonicalizeJson(asJson(expected))
    ) {
      diagnostics.push(
        diagnostic(
          "content.source.manifest_mismatch",
          "",
          `Injected manifest text at "${source.path}" does not match the validated manifest.`,
          "sourceSnapshot",
          { sourcePath: source.path },
          source.path,
        ),
      );
    }
  } catch {
    diagnostics.push(
      diagnostic(
        "content.source.manifest_invalid_json",
        "",
        `Manifest source "${source.path}" is not valid JSON.`,
        "json",
        {
          sourcePath: source.path,
          reason: "invalidJson",
        },
        source.path,
      ),
    );
  }
}

function compileSources(
  input: CompilePublicationContentInput,
  diagnostics: Diagnostic[],
): {
  readonly byPath: ReadonlyMap<string, NormalizedSource>;
  readonly provenance: readonly SourceProvenance[];
} {
  const expected = expectedSources(input);
  const byPath = new Map<string, NormalizedSource>();

  input.sources.forEach((source, index) => {
    const normalized = normalizeSource(source, diagnostics, index);
    if (normalized === undefined) {
      return;
    }
    const first = byPath.get(source.path);
    if (first !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.source.duplicate_path",
          `/sources/${index}/path`,
          `Source path "${source.path}" is injected more than once.`,
          "uniqueSourcePath",
          { sourcePath: source.path },
        ),
      );
      return;
    }
    byPath.set(source.path, normalized);

    for (const outputRoot of input.publication.boundaries.outputRoots) {
      if (isPathWithinRoot(source.path, outputRoot)) {
        diagnostics.push(
          diagnostic(
            "content.source.inside_output",
            `/sources/${index}/path`,
            `Source "${source.path}" is inside disposable output root "${outputRoot}".`,
            "sourceOutputSeparation",
            { sourcePath: source.path, outputRoot },
          ),
        );
      }
    }

    const required = expected.get(source.path);
    if (required === undefined) {
      if (source.role !== "asset") {
        diagnostics.push(
          diagnostic(
            "content.source.unexpected",
            `/sources/${index}/path`,
            `Source "${source.path}" is not part of the resolved publication graph.`,
            "resolvedSourceGraph",
            { sourcePath: source.path, role: source.role },
          ),
        );
      }
      return;
    }
    if (
      source.role !== required.role ||
      source.entityId !== required.entityId
    ) {
      diagnostics.push(
        diagnostic(
          "content.source.identity_mismatch",
          `/sources/${index}`,
          `Source "${source.path}" has the wrong role or entity identity.`,
          "sourceIdentity",
          {
            sourcePath: source.path,
            actualRole: source.role,
            expectedRole: required.role,
            actualEntityId: source.entityId,
            expectedEntityId: required.entityId,
          },
        ),
      );
    }
    if (required.manifest !== undefined) {
      compareManifestSource(normalized, required.manifest, diagnostics);
    }
  });

  for (const [path, required] of expected) {
    if (!byPath.has(path)) {
      diagnostics.push(
        diagnostic(
          "content.source.missing",
          "/sources",
          `Required ${required.role} source "${path}" was not injected.`,
          "requiredSource",
          {
            sourcePath: path,
            role: required.role,
            entityId: required.entityId,
          },
        ),
      );
    }
  }

  const provenance = [...byPath.values()]
    .map((source) => source.provenance)
    .sort(
      (left, right) =>
        compareText(left.path, right.path) ||
        compareText(left.role, right.role) ||
        compareText(left.entityId ?? "", right.entityId ?? ""),
    );
  return { byPath, provenance };
}

function addActiveRoute(
  active: ContentRoute[],
  ownerByPath: Map<string, ContentRoute>,
  route: ContentRoute,
  pointer: string,
  diagnostics: Diagnostic[],
): void {
  if (!validateRoute(route.path, pointer, diagnostics)) {
    return;
  }
  const first = ownerByPath.get(route.path);
  if (first !== undefined) {
    diagnostics.push(
      diagnostic(
        "content.route.collision",
        pointer,
        `Active route "${route.path}" has more than one owner.`,
        "uniqueActiveRoute",
        { route: route.path, firstTarget: first.target, target: route.target },
      ),
    );
    return;
  }
  ownerByPath.set(route.path, route);
  active.push(route);
}

function resolvedWorkRoute(
  input: CompilePublicationContentInput,
  workId: string,
  explicitRoute: string | undefined,
): string {
  return (
    explicitRoute ??
    input.publication.routes.work.replaceAll("{workId}", workId)
  );
}

function resolvedCollectionRoute(
  input: CompilePublicationContentInput,
  collectionId: string,
  explicitRoute: string | undefined,
): string {
  const template = input.publication.routes.collection;
  return (
    explicitRoute ??
    (template === undefined
      ? `/collections/${collectionId}`
      : template.replaceAll("{collectionId}", collectionId))
  );
}

function formatContentAddress(address: ContentAddress): string {
  return address.anchor === undefined
    ? address.path
    : `${address.path}#${address.anchor}`;
}

function contentAddressOwnershipKey(address: ContentAddress): string {
  if (address.anchor === undefined) {
    return JSON.stringify([address.path]);
  }
  let decodedAnchor = address.anchor;
  try {
    decodedAnchor = decodeURIComponent(address.anchor);
  } catch {
    // Fragment validation reports the malformed encoding. Retain a total key
    // here so one invalid address cannot suppress the remaining diagnostics.
  }
  return JSON.stringify([address.path, decodedAnchor]);
}

function ownContentAddress(
  routes: Readonly<Record<string, ContentAddress>>,
  routeName: string,
): ContentAddress | undefined {
  return Object.hasOwn(routes, routeName)
    ? routes[routeName]
    : undefined;
}

function normalizeSectionRoutes(
  section: SectionContentInput,
  pointer: string,
  diagnostics: Diagnostic[],
): {
  readonly routes: Readonly<Record<string, ContentAddress>>;
  readonly activeRouteNames: readonly string[];
} {
  const routes: Record<string, ContentAddress> = {};
  for (const [routeName, candidate] of Object.entries(section.routes ?? {}).sort(
    ([left], [right]) => compareText(left, right),
  )) {
    validateStableId(
      routeName,
      `${pointer}/routes/${routeName}`,
      diagnostics,
    );
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      typeof candidate.path !== "string"
    ) {
      diagnostics.push(
        diagnostic(
          "content.address.invalid",
          `${pointer}/routes/${routeName}`,
          "A content address must contain a concrete origin-relative path.",
          "contentAddress",
          { routeName },
        ),
      );
      continue;
    }
    validateRoute(
      candidate.path,
      `${pointer}/routes/${routeName}/path`,
      diagnostics,
    );
    if (candidate.anchor !== undefined) {
      validateUrlFragment(
        candidate.anchor,
        `${pointer}/routes/${routeName}/anchor`,
        diagnostics,
      );
    }
    routes[routeName] = {
      path: candidate.path,
      ...(candidate.anchor === undefined
        ? {}
        : { anchor: candidate.anchor }),
    };
  }

  const activeRouteNames =
    section.activeRouteNames === undefined
      ? Object.entries(routes)
          .filter(([, address]) => address.anchor === undefined)
          .map(([name]) => name)
      : [...section.activeRouteNames];
  const firstActiveIndexByName = new Map<string, number>();
  activeRouteNames.forEach((name, index) => {
    validateStableId(
      name,
      `${pointer}/activeRouteNames/${index}`,
      diagnostics,
    );
    const firstIndex = firstActiveIndexByName.get(name);
    if (firstIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.section.active_route_duplicate",
          `${pointer}/activeRouteNames/${index}`,
          `Active route name "${name}" is declared more than once.`,
          "uniqueItems",
          { name, firstIndex, duplicateIndex: index },
        ),
      );
      return;
    }
    firstActiveIndexByName.set(name, index);
    const address = ownContentAddress(routes, name);
    if (address === undefined) {
      diagnostics.push(
        diagnostic(
          "content.section.active_route_unknown",
          `${pointer}/activeRouteNames/${index}`,
          `Active route name "${name}" has no matching section address.`,
          "knownRouteName",
          { name },
        ),
      );
    } else if (address.anchor !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.section.active_route_anchored",
          `${pointer}/activeRouteNames/${index}`,
          `Anchored address "${name}" cannot own a server route.`,
          "serverRoute",
          { name, address },
        ),
      );
    }
  });

  return { routes, activeRouteNames };
}

function resolveSectionReaderAddress(
  section: SectionContentInput,
  routes: Readonly<Record<string, ContentAddress>>,
  workRoute: string,
  navigable: boolean,
  pointer: string,
  diagnostics: Diagnostic[],
): ContentAddress | null {
  const location = section.readerLocation;
  if (
    location === null ||
    typeof location !== "object" ||
    Array.isArray(location)
  ) {
    diagnostics.push(
      diagnostic(
        "content.section.reader_location_invalid",
        `${pointer}/readerLocation`,
        "Every section must declare a reader location.",
        "readerLocation",
        { actualType: location === null ? "null" : typeof location },
      ),
    );
    return null;
  }

  if (location.kind === "none") {
    if (navigable) {
      diagnostics.push(
        diagnostic(
          "content.section.reader_location_required",
          `${pointer}/readerLocation`,
          "A navigable section must declare a public reader location.",
          "navigableReaderLocation",
          { sectionId: section.id },
        ),
      );
    }
    return null;
  }

  if (location.kind === "work") {
    return { path: workRoute };
  }

  if (location.kind === "route") {
    if (
      !validateStableId(
        location.routeName,
        `${pointer}/readerLocation/routeName`,
        diagnostics,
      )
    ) {
      return null;
    }
    const address = ownContentAddress(routes, location.routeName);
    if (address === undefined) {
      diagnostics.push(
        diagnostic(
          "content.section.reader_route_unknown",
          `${pointer}/readerLocation/routeName`,
          `Reader route "${location.routeName}" has no matching section address.`,
          "knownRouteName",
          { routeName: location.routeName, sectionId: section.id },
        ),
      );
      return null;
    }
    if (address.anchor !== undefined) {
      validateContentId(
        address.anchor,
        `${pointer}/routes/${location.routeName}/anchor`,
        diagnostics,
      );
    }
    return {
      path: address.path,
      ...(address.anchor === undefined ? {} : { anchor: address.anchor }),
    };
  }

  diagnostics.push(
    diagnostic(
      "content.section.reader_location_kind_unknown",
      `${pointer}/readerLocation/kind`,
      "A reader location kind must be work, route, or none.",
      "readerLocationKind",
      { kind: (location as { readonly kind?: unknown }).kind },
    ),
  );
  return null;
}

function normalizeSectionContinuity(
  sectionId: string,
  continuity: ContentContinuity | undefined,
  pointer: string,
  diagnostics: Diagnostic[],
): ContentContinuity {
  const normalized: ContentContinuity = continuity === undefined
    ? {
        id: sectionId,
        legacyIds: [],
        progressGroups: [[sectionId]],
        historicalSectionIds: [],
      }
    : {
        id: continuity.id,
        legacyIds: [...continuity.legacyIds],
        progressGroups: continuity.progressGroups.map((group) => [...group]),
        historicalSectionIds: [...continuity.historicalSectionIds],
      };
  validateContentId(normalized.id, `${pointer}/continuity/id`, diagnostics);

  const continuityIds = new Set<string>([normalized.id]);
  normalized.legacyIds.forEach((id, index) => {
    validateContentId(
      id,
      `${pointer}/continuity/legacyIds/${index}`,
      diagnostics,
    );
    if (continuityIds.has(id)) {
      diagnostics.push(
        diagnostic(
          "content.continuity.duplicate_id",
          `${pointer}/continuity/legacyIds/${index}`,
          `Continuity ID "${id}" is repeated within one section lineage.`,
          "uniqueContinuityId",
          { id },
        ),
      );
    }
    continuityIds.add(id);
  });

  const historicalIds = new Set<string>();
  normalized.historicalSectionIds.forEach((id, index) => {
    validateContentId(
      id,
      `${pointer}/continuity/historicalSectionIds/${index}`,
      diagnostics,
    );
    if (historicalIds.has(id)) {
      diagnostics.push(
        diagnostic(
          "content.continuity.historical_id_duplicate",
          `${pointer}/continuity/historicalSectionIds/${index}`,
          `Historical section ID "${id}" is repeated.`,
          "uniqueItems",
          { id },
        ),
      );
    }
    historicalIds.add(id);
  });

  if (normalized.progressGroups.length === 0) {
    diagnostics.push(
      diagnostic(
        "content.continuity.progress_groups_empty",
        `${pointer}/continuity/progressGroups`,
        "A section lineage must declare at least one progress group.",
        "minItems",
        {},
      ),
    );
  }
  const usedProgressIds = new Set<string>();
  normalized.progressGroups.forEach((group, groupIndex) => {
    if (group.length === 0) {
      diagnostics.push(
        diagnostic(
          "content.continuity.progress_group_empty",
          `${pointer}/continuity/progressGroups/${groupIndex}`,
          "Progress groups must not be empty.",
          "minItems",
          { groupIndex },
        ),
      );
    }
    group.forEach((id, idIndex) => {
      validateContentId(
        id,
        `${pointer}/continuity/progressGroups/${groupIndex}/${idIndex}`,
        diagnostics,
      );
      if (!continuityIds.has(id)) {
        diagnostics.push(
          diagnostic(
            "content.continuity.progress_id_unowned",
            `${pointer}/continuity/progressGroups/${groupIndex}/${idIndex}`,
            `Progress ID "${id}" is not owned by this section lineage.`,
            "ownedContinuityId",
            { id },
          ),
        );
      }
      if (usedProgressIds.has(id)) {
        diagnostics.push(
          diagnostic(
            "content.continuity.progress_id_duplicate",
            `${pointer}/continuity/progressGroups/${groupIndex}/${idIndex}`,
            `Progress ID "${id}" appears in more than one position.`,
            "uniqueProgressId",
            { id },
          ),
        );
      }
      usedProgressIds.add(id);
    });
  });
  if (!usedProgressIds.has(normalized.id)) {
    diagnostics.push(
      diagnostic(
        "content.continuity.primary_progress_missing",
        `${pointer}/continuity/progressGroups`,
        `Primary continuity ID "${normalized.id}" must appear in a progress group.`,
        "primaryProgressId",
        { id: normalized.id },
      ),
    );
  }

  return normalized;
}

function compileBlock(
  block: SectionContentInput["blocks"][number],
  source: NormalizedSource | undefined,
  pointer: string,
  customMetrics: boolean,
  diagnostics: Diagnostic[],
): MarkdownContentBlock | undefined {
  const validIdentity = [
    validateContentId(block.id, `${pointer}/id`, diagnostics),
    validateContentId(block.anchor, `${pointer}/anchor`, diagnostics),
    validateStableId(block.kind, `${pointer}/kind`, diagnostics),
  ].every(Boolean);
  if (!validIdentity) {
    return undefined;
  }

  if (
    !Number.isInteger(block.provenance.startOffset) ||
    !Number.isInteger(block.provenance.endOffset) ||
    block.provenance.startOffset < 0 ||
    block.provenance.endOffset <= block.provenance.startOffset
  ) {
    diagnostics.push(
      diagnostic(
        "content.block.range_invalid",
        `${pointer}/provenance`,
        "Block source offsets must be increasing non-negative integers.",
        "sourceRange",
        {
          startOffset: block.provenance.startOffset,
          endOffset: block.provenance.endOffset,
        },
        block.provenance.sourcePath,
      ),
    );
    return undefined;
  }
  if (source === undefined || typeof source.contents !== "string") {
    diagnostics.push(
      diagnostic(
        "content.block.source_unavailable",
        `${pointer}/provenance/sourcePath`,
        `Block source "${block.provenance.sourcePath}" is not an injected text source.`,
        "textSource",
        { sourcePath: block.provenance.sourcePath },
        block.provenance.sourcePath,
      ),
    );
    return undefined;
  }

  const { startOffset, endOffset } = block.provenance;
  if (
    endOffset > source.contents.length ||
    splitsSurrogatePair(source.contents, startOffset) ||
    splitsSurrogatePair(source.contents, endOffset)
  ) {
    diagnostics.push(
      diagnostic(
        "content.block.range_outside_source",
        `${pointer}/provenance`,
        "Block source offsets fall outside the source or split a Unicode surrogate pair.",
        "sourceRange",
        {
          startOffset,
          endOffset,
          sourceLength: source.contents.length,
        },
        source.path,
      ),
    );
    return undefined;
  }

  const markdown = normalizeTextNewlines(block.markdown);
  const sourceMarkdown = source.contents.slice(startOffset, endOffset);
  if (markdown !== sourceMarkdown) {
    diagnostics.push(
      diagnostic(
        "content.block.source_mismatch",
        `${pointer}/markdown`,
        "Block Markdown does not equal its declared source range.",
        "sourceSnapshot",
        { sourcePath: source.path, startOffset, endOffset },
        source.path,
      ),
    );
  }

  const text = normalizeTextNewlines(block.text);
  let wordCount = countWords(text);
  if (customMetrics) {
    if (!Number.isInteger(block.wordCount) || (block.wordCount ?? -1) < 0) {
      diagnostics.push(
        diagnostic(
          "content.block.word_count_required",
          `${pointer}/wordCount`,
          "A custom metric producer must supply a non-negative integer word count for every block.",
          "customMetrics",
          { wordCount: block.wordCount },
        ),
      );
    } else {
      wordCount = block.wordCount as number;
    }
  } else if (block.wordCount !== undefined) {
    diagnostics.push(
      diagnostic(
        "content.block.word_count_unexpected",
        `${pointer}/wordCount`,
        "The core metric profile derives word counts and does not accept overrides.",
        "coreMetrics",
        { wordCount: block.wordCount },
      ),
    );
  }
  const metadata = cloneJsonObject(
    block.metadata,
    `${pointer}/metadata`,
    diagnostics,
  );
  const lineStarts = source.lineStarts ?? [0];
  const provenance = {
    sourcePath: source.path,
    start: pointAt(source.contents, lineStarts, startOffset),
    end: pointAt(source.contents, lineStarts, endOffset),
  };
  const contentHash = hashValue(blockHashBasis({
    kind: block.kind,
    markdown,
    text,
    wordCount,
    ...(metadata === undefined ? {} : { metadata }),
  }));

  return {
    id: block.id,
    anchor: block.anchor,
    kind: block.kind,
    markdown,
    text,
    provenance,
    wordCount,
    contentHash,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function compileWork(
  input: CompilePublicationContentInput,
  workSource: CompilePublicationContentInput["sourceGraph"]["works"][number],
  workInput: WorkContentInput | undefined,
  sources: ReadonlyMap<string, NormalizedSource>,
  wordsPerMinute: number,
  activeRoutes: ContentRoute[],
  routeOwnerByPath: Map<string, ContentRoute>,
  diagnostics: Diagnostic[],
): CompiledWork | undefined {
  if (workInput === undefined) {
    return undefined;
  }
  const workIndex = workSource.referenceIndex;
  const workPointer = `/works/${workIndex}`;
  validateStableId(workInput.adapter.id, `${workPointer}/adapter/id`, diagnostics);
  validatePackageName(
    workInput.adapter.package,
    `${workPointer}/adapter/package`,
    diagnostics,
  );
  if (!EXACT_SEMVER.test(workInput.adapter.version)) {
    diagnostics.push(
      diagnostic(
        "content.adapter.version_invalid",
        `${workPointer}/adapter/version`,
        `Adapter version "${workInput.adapter.version}" is not canonical SemVer.`,
        "semver",
        { version: workInput.adapter.version },
      ),
    );
  }
  const metrics = workInput.metrics ?? CORE_METRICS_IDENTITY;
  validateStableId(metrics.id, `${workPointer}/metrics/id`, diagnostics);
  validatePackageName(
    metrics.package,
    `${workPointer}/metrics/package`,
    diagnostics,
  );
  if (!EXACT_SEMVER.test(metrics.version)) {
    diagnostics.push(
      diagnostic(
        "content.metrics.version_invalid",
        `${workPointer}/metrics/version`,
        `Metric version "${metrics.version}" is not canonical SemVer.`,
        "semver",
        { version: metrics.version },
      ),
    );
  }
  if (!EXACT_SEMVER.test(metrics.profileVersion)) {
    diagnostics.push(
      diagnostic(
        "content.metrics.profile_version_invalid",
        `${workPointer}/metrics/profileVersion`,
        `Metric profile version "${metrics.profileVersion}" is not canonical SemVer.`,
        "semver",
        { profileVersion: metrics.profileVersion },
      ),
    );
  }
  const customMetrics = !equalJson(metrics, CORE_METRICS_IDENTITY);
  if (workInput.sections.length === 0) {
    diagnostics.push(
      diagnostic(
        "content.work.sections_empty",
        `${workPointer}/sections`,
        `Work "${workSource.workId}" must contain at least one stable section.`,
        "minItems",
        { workId: workSource.workId },
      ),
    );
  }

  const workRoute = resolvedWorkRoute(
    input,
    workSource.workId,
    workSource.manifest.route,
  );
  addActiveRoute(
    activeRoutes,
    routeOwnerByPath,
    {
      path: workRoute,
      target: { kind: "work", workId: workSource.workId },
    },
    `${workPointer}/route`,
    diagnostics,
  );

  const sectionIndexById = new Map<string, number>();
  const childIdsByParent = new Map<string, string[]>();
  workInput.sections.forEach((section, sectionIndex) => {
    const pointer = `${workPointer}/sections/${sectionIndex}/id`;
    validateContentId(section.id, pointer, diagnostics);
    const firstIndex = sectionIndexById.get(section.id);
    if (firstIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.section.duplicate_id",
          pointer,
          `Section ID "${section.id}" is duplicated in work "${workSource.workId}".`,
          "uniqueSectionId",
          { workId: workSource.workId, firstIndex, duplicateIndex: sectionIndex },
        ),
      );
    } else {
      sectionIndexById.set(section.id, sectionIndex);
    }
    if (section.parentId !== undefined) {
      const children = childIdsByParent.get(section.parentId) ?? [];
      children.push(section.id);
      childIdsByParent.set(section.parentId, children);
    }
  });

  const compiledSections: CompiledSection[] = [];
  const depthById = new Map<string, number>();
  const allRanges: {
    readonly blockId: string;
    readonly end: number;
    readonly sectionId: string;
    readonly start: number;
  }[] = [];
  const manuscript = sources.get(workSource.manuscriptPath);
  if (manuscript !== undefined && typeof manuscript.contents !== "string") {
    diagnostics.push(
      diagnostic(
        "content.work.manuscript_not_text",
        workPointer,
        `Manuscript "${workSource.manuscriptPath}" must be injected as text.`,
        "textManuscript",
        { workId: workSource.workId, sourcePath: workSource.manuscriptPath },
        workSource.manuscriptPath,
      ),
    );
  }

  const navigableSectionIds = workInput.sections
    .filter((section) => section.navigable ?? true)
    .map((section) => section.id);
  const navigationBySectionId = new Map<
    string,
    { readonly previousId: string | null; readonly nextId: string | null }
  >();
  navigableSectionIds.forEach((sectionId, index) => {
    navigationBySectionId.set(sectionId, {
      previousId:
        index === 0 ? null : (navigableSectionIds[index - 1] ?? null),
      nextId:
        index === navigableSectionIds.length - 1
          ? null
          : (navigableSectionIds[index + 1] ?? null),
    });
  });

  workInput.sections.forEach((section, sectionIndex) => {
    const pointer = `${workPointer}/sections/${sectionIndex}`;
    const role = section.role ?? "section";
    validateStableId(role, `${pointer}/role`, diagnostics);
    const navigable = section.navigable ?? true;
    const parentIndex =
      section.parentId === undefined
        ? undefined
        : sectionIndexById.get(section.parentId);
    if (
      section.parentId !== undefined &&
      (parentIndex === undefined || parentIndex >= sectionIndex)
    ) {
      diagnostics.push(
        diagnostic(
          "content.section.parent_invalid",
          `${pointer}/parentId`,
          `Parent "${section.parentId}" must exist earlier in preorder within work "${workSource.workId}".`,
          "preorderParent",
          {
            workId: workSource.workId,
            sectionId: section.id,
            parentId: section.parentId,
            parentIndex,
            sectionIndex,
          },
        ),
      );
    }
    const parentDepth =
      section.parentId === undefined
        ? undefined
        : depthById.get(section.parentId);
    const depth = parentDepth === undefined ? 0 : parentDepth + 1;
    if (depth > 64) {
      diagnostics.push(
        diagnostic(
          "content.section.depth_exceeded",
          `${pointer}/parentId`,
          "Content hierarchy depth must not exceed 64.",
          "maximum",
          { depth, maximum: 64 },
        ),
      );
    }
    depthById.set(section.id, depth);

    const { routes, activeRouteNames } = normalizeSectionRoutes(
      section,
      pointer,
      diagnostics,
    );
    const readerAddress = resolveSectionReaderAddress(
      section,
      routes,
      workRoute,
      navigable,
      pointer,
      diagnostics,
    );
    for (const routeName of activeRouteNames) {
      const address = ownContentAddress(routes, routeName);
      if (address === undefined || address.anchor !== undefined) {
        continue;
      }
      addActiveRoute(
        activeRoutes,
        routeOwnerByPath,
        {
          path: address.path,
          target: {
            kind: "section",
            workId: workSource.workId,
            sectionId: section.id,
            routeName,
          },
        },
        `${pointer}/routes/${routeName}`,
        diagnostics,
      );
    }
    const continuity = normalizeSectionContinuity(
      section.id,
      section.continuity,
      pointer,
      diagnostics,
    );

    const blockIdFirstIndex = new Map<string, number>();
    const blockAnchorFirstIndex = new Map<string, number>();
    const blocks: MarkdownContentBlock[] = [];
    section.blocks.forEach((block, blockIndex) => {
      const blockPointer = `${pointer}/blocks/${blockIndex}`;
      const firstIndex = blockIdFirstIndex.get(block.id);
      if (firstIndex !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.block.duplicate_id",
            `${blockPointer}/id`,
            `Block ID "${block.id}" is duplicated in section "${section.id}".`,
            "uniqueBlockId",
            {
              workId: workSource.workId,
              sectionId: section.id,
              firstIndex,
              duplicateIndex: blockIndex,
            },
          ),
        );
      } else {
        blockIdFirstIndex.set(block.id, blockIndex);
      }
      const firstAnchorIndex = blockAnchorFirstIndex.get(block.anchor);
      if (firstAnchorIndex !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.block.duplicate_anchor",
            `${blockPointer}/anchor`,
            `Public block anchor "${block.anchor}" is duplicated in section "${section.id}".`,
            "uniqueBlockAnchor",
            {
              workId: workSource.workId,
              sectionId: section.id,
              firstIndex: firstAnchorIndex,
              duplicateIndex: blockIndex,
            },
          ),
        );
      } else {
        blockAnchorFirstIndex.set(block.anchor, blockIndex);
      }
      if (block.provenance.sourcePath !== workSource.manuscriptPath) {
        diagnostics.push(
          diagnostic(
            "content.block.wrong_manuscript",
            `${blockPointer}/provenance/sourcePath`,
            `Block source must be the resolved manuscript for work "${workSource.workId}".`,
            "resolvedManuscript",
            {
              actual: block.provenance.sourcePath,
              expected: workSource.manuscriptPath,
            },
            block.provenance.sourcePath,
          ),
        );
      }
      const compiled = compileBlock(
        block,
        sources.get(block.provenance.sourcePath),
        blockPointer,
        customMetrics,
        diagnostics,
      );
      if (compiled !== undefined) {
        blocks.push(compiled);
        allRanges.push({
          blockId: block.id,
          sectionId: section.id,
          start: block.provenance.startOffset,
          end: block.provenance.endOffset,
        });
      }
    });

    const metadata = cloneJsonObject(
      section.metadata,
      `${pointer}/metadata`,
      diagnostics,
    );
    const wordCount = blocks.reduce(
      (total, block) => total + block.wordCount,
      0,
    );
    const sectionForHash = {
      id: section.id,
      role,
      title: section.title,
      parentId: section.parentId ?? null,
      childIds: childIdsByParent.get(section.id) ?? [],
      depth,
      order: sectionIndex,
      routes,
      activeRouteNames,
      readerAddress,
      continuity,
      navigable,
      blocks: blocks.map((block) => ({
        id: block.id,
        anchor: block.anchor,
        contentHash: block.contentHash,
      })),
      ...(metadata === undefined ? {} : { metadata }),
    };
    const navigation = navigationBySectionId.get(section.id) ?? {
      previousId: null,
      nextId: null,
    };
    compiledSections.push({
      ...sectionForHash,
      blocks,
      previousId: navigation.previousId,
      nextId: navigation.nextId,
      wordCount,
      readingMinutes: calculateReadingMinutes(wordCount, wordsPerMinute),
      contentHash: hashValue(sectionHashBasis(sectionForHash)),
    });
  });

  allRanges.sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      compareText(left.sectionId, right.sectionId) ||
      compareText(left.blockId, right.blockId),
  );
  for (let index = 1; index < allRanges.length; index += 1) {
    const previous = allRanges[index - 1];
    const current = allRanges[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.start < previous.end
    ) {
      diagnostics.push(
        diagnostic(
          "content.block.range_overlap",
          workPointer,
          `Blocks "${previous.blockId}" and "${current.blockId}" claim overlapping manuscript ranges.`,
          "nonOverlappingSourceRanges",
          {
            workId: workSource.workId,
            previous,
            current,
          },
          workSource.manuscriptPath,
        ),
      );
    }
  }

  const workMetadata = cloneJsonObject(
    workSource.manifest.metadata,
    `${workPointer}/metadata`,
    diagnostics,
  );
  const wordCount = compiledSections.reduce(
    (total, section) => total + section.wordCount,
    0,
  );
  const rootSectionIds = compiledSections
    .filter((section) => section.parentId === null)
    .map((section) => section.id);
  const source = {
    manifestPath: workSource.manifestPath,
    manuscriptPath: workSource.manuscriptPath,
    ...(workSource.assetsPath === undefined
      ? {}
      : { assetsPath: workSource.assetsPath }),
    adapter: {
      id: workInput.adapter.id,
      package: workInput.adapter.package,
      version: workInput.adapter.version,
    },
    metrics: {
      id: metrics.id,
      package: metrics.package,
      version: metrics.version,
      profileVersion: metrics.profileVersion,
    },
  };
  const workForHash = {
    id: workSource.workId,
    title: workSource.manifest.title,
    ...(workSource.manifest.subtitle === undefined
      ? {}
      : { subtitle: workSource.manifest.subtitle }),
    ...(workSource.manifest.summary === undefined
      ? {}
      : { summary: workSource.manifest.summary }),
    language: workSource.manifest.language,
    publicationState: workSource.manifest.publicationState,
    ...(workSource.manifest.publishedAt === undefined
      ? {}
      : { publishedAt: workSource.manifest.publishedAt }),
    ...(workSource.manifest.updatedAt === undefined
      ? {}
      : { updatedAt: workSource.manifest.updatedAt }),
    route: workRoute,
    adapter: source.adapter,
    rootSectionIds,
    sections: compiledSections.map((section) => ({
      id: section.id,
      contentHash: section.contentHash,
    })),
    ...(workMetadata === undefined ? {} : { metadata: workMetadata }),
  };

  return {
    id: workSource.workId,
    title: workSource.manifest.title,
    ...(workSource.manifest.subtitle === undefined
      ? {}
      : { subtitle: workSource.manifest.subtitle }),
    ...(workSource.manifest.summary === undefined
      ? {}
      : { summary: workSource.manifest.summary }),
    language: workSource.manifest.language,
    publicationState: workSource.manifest.publicationState,
    ...(workSource.manifest.publishedAt === undefined
      ? {}
      : { publishedAt: workSource.manifest.publishedAt }),
    ...(workSource.manifest.updatedAt === undefined
      ? {}
      : { updatedAt: workSource.manifest.updatedAt }),
    route: workRoute,
    source,
    rootSectionIds,
    sections: compiledSections,
    wordCount,
    readingMinutes: calculateReadingMinutes(wordCount, wordsPerMinute),
    contentHash: hashValue(workHashBasis({
      ...workForHash,
      source,
      sections: compiledSections,
    })),
    ...(workMetadata === undefined ? {} : { metadata: workMetadata }),
  };
}

function compileCollections(
  input: CompilePublicationContentInput,
  activeRoutes: ContentRoute[],
  routeOwnerByPath: Map<string, ContentRoute>,
  diagnostics: Diagnostic[],
): readonly CompiledCollection[] {
  return input.sourceGraph.collections.map((collection) => {
    const pointer = `/collections/${collection.referenceIndex}`;
    const route = resolvedCollectionRoute(
      input,
      collection.collectionId,
      collection.manifest.route,
    );
    addActiveRoute(
      activeRoutes,
      routeOwnerByPath,
      {
        path: route,
        target: {
          kind: "collection",
          collectionId: collection.collectionId,
        },
      },
      `${pointer}/route`,
      diagnostics,
    );
    const metadata = cloneJsonObject(
      collection.manifest.metadata,
      `${pointer}/metadata`,
      diagnostics,
    );
    return {
      id: collection.collectionId,
      title: collection.manifest.title,
      ...(collection.manifest.description === undefined
        ? {}
        : { description: collection.manifest.description }),
      ...(collection.manifest.publicationState === undefined
        ? {}
        : { publicationState: collection.manifest.publicationState }),
      route,
      manifestPath: collection.manifestPath,
      workIds: [...collection.manifest.workIds],
      ...(metadata === undefined ? {} : { metadata }),
    };
  });
}

function validateContinuityOwnership(
  works: readonly CompiledWork[],
  diagnostics: Diagnostic[],
): void {
  const ownerByIdentity = new Map<
    string,
    { readonly workId: string; readonly sectionId: string }
  >();
  for (const [workIndex, work] of works.entries()) {
    for (const [sectionIndex, section] of work.sections.entries()) {
      const owner = { workId: work.id, sectionId: section.id };
      const identities = new Set([
        section.id,
        section.continuity.id,
        ...section.continuity.legacyIds,
        ...section.continuity.historicalSectionIds,
      ]);
      for (const identity of identities) {
        const first = ownerByIdentity.get(identity);
        if (
          first !== undefined &&
          (first.workId !== owner.workId ||
            first.sectionId !== owner.sectionId)
        ) {
          diagnostics.push(
            diagnostic(
              "content.continuity.identity_collision",
              `/works/${workIndex}/sections/${sectionIndex}/continuity`,
              `Continuity identity "${identity}" is owned by more than one section.`,
              "uniqueContinuityOwner",
              { identity, first, duplicate: owner },
            ),
          );
        } else {
          ownerByIdentity.set(identity, owner);
        }
      }
    }
  }
}

function validateCompiledRedirects(
  redirects: readonly {
    readonly from: string;
    readonly to: string;
    readonly status: number;
  }[],
  activeRouteOwnerByPath: ReadonlyMap<string, ContentRoute>,
  diagnostics: Diagnostic[],
): void {
  interface RedirectRecord {
    readonly from: string;
    readonly to: string;
    readonly index: number;
    readonly internalTarget: boolean;
    readonly validSource: boolean;
    readonly validTarget: boolean;
  }
  type Resolution =
    | { readonly kind: "active"; readonly terminal: string }
    | { readonly kind: "cycle"; readonly terminal: string }
    | { readonly kind: "external"; readonly terminal: string }
    | { readonly kind: "unresolved"; readonly terminal: string };

  const records: RedirectRecord[] = [];
  const firstBySource = new Map<string, RedirectRecord>();
  redirects.forEach((redirect, index) => {
    const pointer = `/routes/redirects/${index}`;
    const validSource = validateRoute(
      redirect.from,
      `${pointer}/from`,
      diagnostics,
    );
    const internalTarget =
      typeof redirect.to === "string" && redirect.to.startsWith("/");
    const validTarget = internalTarget
      ? validateRoute(redirect.to, `${pointer}/to`, diagnostics)
      : typeof redirect.to === "string" &&
        validateAbsoluteHttpUrl(redirect.to);
    if (!internalTarget && !validTarget) {
      diagnostics.push(
        diagnostic(
          "content.redirect.external_target_invalid",
          `${pointer}/to`,
          "External redirect targets must be credential-free HTTP or HTTPS URLs.",
          "absoluteHttpUrl",
          { target: redirect.to },
        ),
      );
    }
    if (![301, 302, 307, 308].includes(redirect.status)) {
      diagnostics.push(
        diagnostic(
          "content.redirect.status_invalid",
          `${pointer}/status`,
          "Redirect status must be 301, 302, 307, or 308.",
          "enum",
          { status: redirect.status },
        ),
      );
    }
    const record = {
      from: redirect.from,
      to: redirect.to,
      index,
      internalTarget,
      validSource,
      validTarget,
    };
    records.push(record);
    const first = firstBySource.get(redirect.from);
    if (first !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.redirect.duplicate_source",
          `${pointer}/from`,
          `Redirect source "${redirect.from}" is declared more than once.`,
          "uniqueRedirectSource",
          {
            source: redirect.from,
            firstIndex: first.index,
            duplicateIndex: index,
          },
        ),
      );
    } else if (validSource) {
      firstBySource.set(redirect.from, record);
    }
    if (validSource && activeRouteOwnerByPath.has(redirect.from)) {
      diagnostics.push(
        diagnostic(
          "content.redirect.active_route_source",
          `${pointer}/from`,
          `Redirect source "${redirect.from}" collides with an active route.`,
          "inactiveRedirectSource",
          {
            source: redirect.from,
            activeRoute: activeRouteOwnerByPath.get(redirect.from),
          },
        ),
      );
    }
  });

  const resolutionByRoute = new Map<string, Resolution>();
  const resolve = (start: string): Resolution => {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let cursor = start;
    let resolution: Resolution | undefined;
    while (resolution === undefined) {
      if (activeRouteOwnerByPath.has(cursor)) {
        resolution = { kind: "active", terminal: cursor };
        break;
      }
      const memoized = resolutionByRoute.get(cursor);
      if (memoized !== undefined) {
        resolution = memoized;
        break;
      }
      const repeatedAt = pathIndex.get(cursor);
      if (repeatedAt !== undefined) {
        const cycle = path.slice(repeatedAt);
        const closedCycle = [...cycle, cycle[0] ?? cursor];
        const indexes = cycle
          .map((route) => firstBySource.get(route)?.index)
          .filter((index): index is number => index !== undefined);
        const diagnosticIndex =
          indexes.length === 0 ? 0 : Math.min(...indexes);
        diagnostics.push(
          diagnostic(
            "content.redirect.loop",
            `/routes/redirects/${diagnosticIndex}/to`,
            `Redirects form a loop: ${closedCycle.join(" -> ")}.`,
            "acyclicRedirects",
            { routes: closedCycle },
          ),
        );
        resolution = {
          kind: "cycle",
          terminal: cycle[0] ?? cursor,
        };
        break;
      }
      pathIndex.set(cursor, path.length);
      path.push(cursor);
      const redirect = firstBySource.get(cursor);
      if (redirect === undefined || !redirect.validTarget) {
        resolution = { kind: "unresolved", terminal: cursor };
      } else if (!redirect.internalTarget) {
        resolution = { kind: "external", terminal: redirect.to };
      } else {
        cursor = redirect.to;
      }
    }
    for (const route of path) {
      resolutionByRoute.set(route, resolution);
    }
    return resolution;
  };

  for (const source of firstBySource.keys()) {
    resolve(source);
  }
  for (const record of records) {
    if (
      !record.validSource ||
      !record.validTarget ||
      !record.internalTarget
    ) {
      continue;
    }
    const resolution = resolve(record.to);
    if (resolution.kind === "unresolved") {
      diagnostics.push(
        diagnostic(
          "content.redirect.internal_target_unresolved",
          `/routes/redirects/${record.index}/to`,
          `Internal redirect chain from "${record.from}" does not terminate at an active route or external URL.`,
          "activeRedirectTarget",
          {
            source: record.from,
            target: record.to,
            terminalRoute: resolution.terminal,
          },
        ),
      );
    }
  }
}

function validateSectionAddressAuthority(
  works: readonly CompiledWork[],
  activeRouteOwnerByPath: ReadonlyMap<string, ContentRoute>,
  diagnostics: Diagnostic[],
): void {
  const ownerByAddress = new Map<
    string,
    {
      readonly workId: string;
      readonly sectionId: string;
      readonly routeName: string;
    }
  >();
  const hasAuthorizedUnanchoredOwner = (
    work: CompiledWork,
    section: CompiledSection,
    address: ContentAddress,
  ): boolean => {
    if (address.anchor !== undefined || address.path === work.route) {
      return true;
    }
    const routeOwner = activeRouteOwnerByPath.get(address.path);
    return (
      routeOwner?.target.kind === "section" &&
      routeOwner.target.workId === work.id &&
      routeOwner.target.sectionId === section.id
    );
  };
  works.forEach((work, workIndex) => {
    work.sections.forEach((section, sectionIndex) => {
      for (const [routeName, address] of Object.entries(section.routes)) {
        const addressKey = contentAddressOwnershipKey(address);
        const addressDisplay = formatContentAddress(address);
        const firstOwner = ownerByAddress.get(addressKey);
        if (
          firstOwner !== undefined &&
          (firstOwner.workId !== work.id ||
            firstOwner.sectionId !== section.id)
        ) {
          diagnostics.push(
            diagnostic(
              "content.address.collision",
              `/works/${workIndex}/sections/${sectionIndex}/routes/${routeName}`,
              `Section address "${addressDisplay}" is owned by more than one section.`,
              "uniqueContentAddress",
              {
                address,
                firstOwner,
                duplicateOwner: {
                  routeName,
                  sectionId: section.id,
                  workId: work.id,
                },
              },
            ),
          );
        } else if (firstOwner === undefined) {
          ownerByAddress.set(addressKey, {
            workId: work.id,
            sectionId: section.id,
            routeName,
          });
        }
        const ownsServerRoute =
          address.anchor === undefined &&
          section.activeRouteNames.includes(routeName);
        if (
          !ownsServerRoute &&
          !activeRouteOwnerByPath.has(address.path)
        ) {
          diagnostics.push(
            diagnostic(
              "content.address.base_route_unresolved",
              `/works/${workIndex}/sections/${sectionIndex}/routes/${routeName}/path`,
              `Section address "${routeName}" uses a base path with no active server route.`,
              "activeAddressBase",
              {
                address,
                routeName,
                sectionId: section.id,
                workId: work.id,
              },
            ),
          );
        }
        if (!hasAuthorizedUnanchoredOwner(work, section, address)) {
          diagnostics.push(
            diagnostic(
              "content.address.unanchored_owner_mismatch",
              `/works/${workIndex}/sections/${sectionIndex}/routes/${routeName}`,
              `Unanchored section address "${routeName}" does not use its own work route or a server route owned by that section.`,
              "ownedUnanchoredAddress",
              {
                address,
                routeName,
                routeOwner: activeRouteOwnerByPath.get(address.path) ?? null,
                sectionId: section.id,
                workId: work.id,
              },
            ),
          );
        }
      }
      if (section.readerAddress !== null) {
        const addressKey = contentAddressOwnershipKey(
          section.readerAddress,
        );
        const addressDisplay = formatContentAddress(
          section.readerAddress,
        );
        const firstOwner = ownerByAddress.get(addressKey);
        if (
          firstOwner !== undefined &&
          (firstOwner.workId !== work.id ||
            firstOwner.sectionId !== section.id)
        ) {
          diagnostics.push(
            diagnostic(
              "content.reader_address.collision",
              `/works/${workIndex}/sections/${sectionIndex}/readerAddress`,
              `Reader address "${addressDisplay}" is owned by more than one section.`,
              "uniqueReaderAddress",
              {
                address: section.readerAddress,
                firstOwner,
                duplicateOwner: {
                  sectionId: section.id,
                  workId: work.id,
                },
              },
            ),
          );
        } else if (firstOwner === undefined) {
          ownerByAddress.set(addressKey, {
            workId: work.id,
            sectionId: section.id,
            routeName: "$reader",
          });
        }
        if (!activeRouteOwnerByPath.has(section.readerAddress.path)) {
          diagnostics.push(
            diagnostic(
              "content.reader_address.base_route_unresolved",
              `/works/${workIndex}/sections/${sectionIndex}/readerAddress/path`,
              "A reader address must use an active server route as its base path.",
              "activeReaderAddressBase",
              {
                address: section.readerAddress,
                sectionId: section.id,
                workId: work.id,
              },
            ),
          );
        }
        if (
          !hasAuthorizedUnanchoredOwner(
            work,
            section,
            section.readerAddress,
          )
        ) {
          diagnostics.push(
            diagnostic(
              "content.reader_address.unanchored_owner_mismatch",
              `/works/${workIndex}/sections/${sectionIndex}/readerAddress`,
              "An unanchored reader address must use its own work route or a server route owned by that section.",
              "ownedUnanchoredAddress",
              {
                address: section.readerAddress,
                routeOwner:
                  activeRouteOwnerByPath.get(
                    section.readerAddress.path,
                  ) ?? null,
                sectionId: section.id,
                workId: work.id,
              },
            ),
          );
        }
        for (const [blockIndex, block] of section.blocks.entries()) {
          const blockAddress: ContentAddress = {
            path: section.readerAddress.path,
            anchor:
              section.readerAddress.anchor === undefined
                ? block.anchor
                : `${section.readerAddress.anchor}-${block.anchor}`,
          };
          validateUrlFragment(
            blockAddress.anchor,
            `/works/${workIndex}/sections/${sectionIndex}/blocks/${blockIndex}/anchor`,
            diagnostics,
          );
          const blockAddressKey = contentAddressOwnershipKey(blockAddress);
          const blockAddressDisplay = formatContentAddress(blockAddress);
          const firstBlockAddressOwner = ownerByAddress.get(blockAddressKey);
          if (firstBlockAddressOwner !== undefined) {
            diagnostics.push(
              diagnostic(
                "content.block_address.collision",
                `/works/${workIndex}/sections/${sectionIndex}/blocks/${blockIndex}/anchor`,
                `Public block address "${blockAddressDisplay}" collides with another content address.`,
                "uniqueBlockAddress",
                {
                  address: blockAddress,
                  firstOwner: firstBlockAddressOwner,
                  duplicateOwner: {
                    blockId: block.id,
                    sectionId: section.id,
                    workId: work.id,
                  },
                },
              ),
            );
          } else {
            ownerByAddress.set(blockAddressKey, {
              workId: work.id,
              sectionId: section.id,
              routeName: `$block:${block.id}`,
            });
          }
        }
      }
    });
  });
}

function validateAssetRedirectAuthority(
  assets: readonly ResolvedContentAsset[],
  redirects: readonly {
    readonly from: string;
    readonly to: string;
    readonly status: number;
  }[],
  diagnostics: Diagnostic[],
): void {
  const assetIndexByHref = new Map(
    assets.map((asset, index) => [asset.href, index]),
  );
  redirects.forEach((redirect, index) => {
    const assetIndex = assetIndexByHref.get(redirect.from);
    if (assetIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.redirect.asset_source_collision",
          `/routes/redirects/${index}/from`,
          `Redirect source "${redirect.from}" collides with a public asset.`,
          "disjointPublicTargets",
          { assetIndex, source: redirect.from },
        ),
      );
    }
  });
}

function createIndexes(
  works: readonly CompiledWork[],
  collections: readonly CompiledCollection[],
): ContentIndexes {
  const workById = new Map(works.map((work) => [work.id, work]));
  const collectionById = new Map(
    collections.map((collection) => [collection.id, collection]),
  );
  const sectionByWorkAndId = new Map<string, CompiledSection>();
  const blockByLocation = new Map<string, MarkdownContentBlock>();
  const sectionRouteByLocationAndName = new Map<string, string>();
  for (const work of works) {
    for (const section of work.sections) {
      sectionByWorkAndId.set(`${work.id}\u0000${section.id}`, section);
      for (const block of section.blocks) {
        blockByLocation.set(
          `${work.id}\u0000${section.id}\u0000${block.id}`,
          block,
        );
      }
      for (const [name, route] of Object.entries(section.routes)) {
        sectionRouteByLocationAndName.set(
          `${work.id}\u0000${section.id}\u0000${name}`,
          formatContentAddress(route),
        );
      }
    }
  }
  return {
    workById,
    collectionById,
    sectionByWorkAndId,
    blockByLocation,
    sectionRouteByLocationAndName,
  };
}

function compileAssets(
  input: CompilePublicationContentInput,
  assets: readonly ResolvedContentAssetInput[],
  sources: ReadonlyMap<string, NormalizedSource>,
  indexes: ContentIndexes,
  activeRouteOwnerByPath: ReadonlyMap<string, ContentRoute>,
  diagnostics: Diagnostic[],
): readonly ResolvedContentAsset[] {
  const firstIndexById = new Map<string, number>();
  const firstIndexByHref = new Map<string, number>();
  return [...assets]
    .sort((left, right) => compareText(left.id, right.id))
    .map((asset, index) => {
      validateStableId(asset.id, `/assets/${index}/id`, diagnostics);
      const firstIndex = firstIndexById.get(asset.id);
      if (firstIndex !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.asset.duplicate_id",
            `/assets/${index}/id`,
            `Asset ID "${asset.id}" is duplicated.`,
            "uniqueAssetId",
            { id: asset.id, firstIndex, duplicateIndex: index },
          ),
        );
      } else {
        firstIndexById.set(asset.id, index);
      }
      const owningWork =
        asset.workId === undefined
          ? undefined
          : indexes.workById.get(asset.workId);
      if (asset.workId !== undefined && owningWork === undefined) {
        diagnostics.push(
          diagnostic(
            "content.asset.unknown_work",
            `/assets/${index}/workId`,
            `Asset "${asset.id}" belongs to unknown work "${asset.workId}".`,
            "knownWork",
            { assetId: asset.id, workId: asset.workId },
          ),
        );
      }
      validateRoute(asset.href, `/assets/${index}/href`, diagnostics);
      const firstHrefIndex = firstIndexByHref.get(asset.href);
      if (firstHrefIndex !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.asset.href_collision",
            `/assets/${index}/href`,
            `Public asset href "${asset.href}" is assigned more than once.`,
            "uniqueAssetHref",
            {
              href: asset.href,
              firstIndex: firstHrefIndex,
              duplicateIndex: index,
            },
          ),
        );
      } else {
        firstIndexByHref.set(asset.href, index);
      }
      if (activeRouteOwnerByPath.has(asset.href)) {
        diagnostics.push(
          diagnostic(
            "content.asset.route_collision",
            `/assets/${index}/href`,
            `Public asset href "${asset.href}" collides with an active publication route.`,
            "disjointPublicTargets",
            { href: asset.href, route: activeRouteOwnerByPath.get(asset.href) },
          ),
        );
      }
      const source = sources.get(asset.sourcePath);
      if (source === undefined || source.role !== "asset") {
        diagnostics.push(
          diagnostic(
            "content.asset.source_missing",
            `/assets/${index}/sourcePath`,
            `Asset "${asset.id}" has no injected asset source at "${asset.sourcePath}".`,
            "assetSource",
            { assetId: asset.id, sourcePath: asset.sourcePath },
          ),
        );
      } else {
        const expectedRoot =
          owningWork?.source.assetsPath ??
          (asset.workId === undefined
            ? input.sourceGraph.layout.assetsRoot
            : undefined);
        if (
          expectedRoot === undefined ||
          !isPathWithinRoot(source.path, expectedRoot)
        ) {
          diagnostics.push(
            diagnostic(
              "content.asset.source_outside_owner_root",
              `/assets/${index}/sourcePath`,
              `Asset "${asset.id}" is outside its declared owner asset root.`,
              "assetOwnership",
              {
                assetId: asset.id,
                sourcePath: source.path,
                workId: asset.workId,
                expectedRoot,
              },
            ),
          );
        }
        if (source.entityId !== asset.workId) {
          diagnostics.push(
            diagnostic(
              "content.asset.source_owner_mismatch",
              `/assets/${index}/sourcePath`,
              `Asset "${asset.id}" source identity does not match its declared owner.`,
              "assetOwnership",
              {
                assetId: asset.id,
                workId: asset.workId,
                sourceEntityId: source.entityId,
              },
            ),
          );
        }
        const sourceMediaType = source.mediaType
          .split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        const assetMediaType =
          typeof asset.mediaType === "string"
            ? asset.mediaType.split(";", 1)[0]?.trim().toLowerCase()
            : undefined;
        if (
          sourceMediaType === undefined ||
          sourceMediaType.length === 0 ||
          assetMediaType === undefined ||
          assetMediaType.length === 0 ||
          sourceMediaType !== assetMediaType
        ) {
          diagnostics.push(
            diagnostic(
              "content.asset.media_type_mismatch",
              `/assets/${index}/mediaType`,
              `Asset "${asset.id}" media type does not match its injected source.`,
              "mediaType",
              {
                assetId: asset.id,
                mediaType: asset.mediaType,
                sourceMediaType: source.mediaType,
              },
            ),
          );
        }
      }
      const metadata = cloneJsonObject(
        asset.metadata,
        `/assets/${index}/metadata`,
        diagnostics,
      );
      return {
        id: asset.id,
        ...(asset.workId === undefined ? {} : { workId: asset.workId }),
        sourcePath: asset.sourcePath,
        href: asset.href,
        mediaType: asset.mediaType,
        hash: source?.provenance.rawHash ?? sha256(new Uint8Array()),
        ...(metadata === undefined ? {} : { metadata }),
      };
    });
}

function validateLinkSource(
  link: ResolvedContentLinkInput,
  index: number,
  indexes: ContentIndexes,
  diagnostics: Diagnostic[],
): void {
  const sectionKey = `${link.source.workId}\u0000${link.source.sectionId}`;
  if (!indexes.sectionByWorkAndId.has(sectionKey)) {
    diagnostics.push(
      diagnostic(
        "content.link.source_unknown",
        `/links/${index}/source`,
        `Link "${link.id}" has an unknown source section.`,
        "knownContentLocation",
        { id: link.id, source: link.source },
      ),
    );
    return;
  }
  if (
    link.source.blockId !== undefined &&
    !indexes.blockByLocation.has(
      `${sectionKey}\u0000${link.source.blockId}`,
    )
  ) {
    diagnostics.push(
      diagnostic(
        "content.link.source_block_unknown",
        `/links/${index}/source/blockId`,
        `Link "${link.id}" has an unknown source block.`,
        "knownContentLocation",
        { id: link.id, source: link.source },
      ),
    );
  }
}

function compileLinkOccurrence(
  link: ResolvedContentLinkInput,
  index: number,
  indexes: ContentIndexes,
  sources: ReadonlyMap<string, NormalizedSource>,
  diagnostics: Diagnostic[],
): SourceSpan | undefined {
  if (link.source.kind !== "source") {
    return undefined;
  }
  const pointer = `/links/${index}/source/occurrence`;
  const range = link.source.occurrence;
  if (
    range === undefined ||
    typeof range.sourcePath !== "string" ||
    !Number.isInteger(range.startOffset) ||
    !Number.isInteger(range.endOffset) ||
    range.startOffset < 0 ||
    range.endOffset <= range.startOffset
  ) {
    diagnostics.push(
      diagnostic(
        "content.link.occurrence_invalid",
        pointer,
        `Link "${link.id}" must carry an increasing source occurrence range.`,
        "sourceRange",
        { id: link.id, occurrence: range },
      ),
    );
    return undefined;
  }

  const work = indexes.workById.get(link.source.workId);
  if (
    work !== undefined &&
    range.sourcePath !== work.source.manuscriptPath
  ) {
    diagnostics.push(
      diagnostic(
        "content.link.occurrence_wrong_source",
        `${pointer}/sourcePath`,
        `Link "${link.id}" occurrence must use its work manuscript source.`,
        "resolvedManuscript",
        {
          id: link.id,
          actual: range.sourcePath,
          expected: work.source.manuscriptPath,
        },
        range.sourcePath,
      ),
    );
  }
  const source = sources.get(range.sourcePath);
  if (source === undefined || typeof source.contents !== "string") {
    diagnostics.push(
      diagnostic(
        "content.link.occurrence_source_unavailable",
        `${pointer}/sourcePath`,
        `Link "${link.id}" occurrence source is not an injected text source.`,
        "textSource",
        { id: link.id, sourcePath: range.sourcePath },
        range.sourcePath,
      ),
    );
    return undefined;
  }
  if (
    range.endOffset > source.contents.length ||
    splitsSurrogatePair(source.contents, range.startOffset) ||
    splitsSurrogatePair(source.contents, range.endOffset)
  ) {
    diagnostics.push(
      diagnostic(
        "content.link.occurrence_outside_source",
        pointer,
        `Link "${link.id}" occurrence falls outside its source or splits a Unicode surrogate pair.`,
        "sourceRange",
        {
          id: link.id,
          startOffset: range.startOffset,
          endOffset: range.endOffset,
          sourceLength: source.contents.length,
        },
        range.sourcePath,
      ),
    );
    return undefined;
  }

  const section = indexes.sectionByWorkAndId.get(
    `${link.source.workId}\u0000${link.source.sectionId}`,
  );
  const candidateBlocks =
    link.source.blockId === undefined
      ? (section?.blocks ?? [])
      : [
          indexes.blockByLocation.get(
            `${link.source.workId}\u0000${link.source.sectionId}\u0000${link.source.blockId}`,
          ),
        ].filter(
          (block): block is MarkdownContentBlock => block !== undefined,
        );
  const containingBlock = candidateBlocks.find(
    (block) =>
      block.provenance.sourcePath === range.sourcePath &&
      range.startOffset >= block.provenance.start.offset &&
      range.endOffset <= block.provenance.end.offset,
  );
  if (containingBlock === undefined) {
    diagnostics.push(
      diagnostic(
        "content.link.occurrence_outside_block",
        pointer,
        `Link "${link.id}" occurrence must fall within its source section or declared block.`,
        "contentOccurrence",
        {
          id: link.id,
          workId: link.source.workId,
          sectionId: link.source.sectionId,
          blockId: link.source.blockId,
        },
        range.sourcePath,
      ),
    );
  }

  const lineStarts = source.lineStarts ?? [0];
  return {
    sourcePath: range.sourcePath,
    start: pointAt(source.contents, lineStarts, range.startOffset),
    end: pointAt(source.contents, lineStarts, range.endOffset),
  };
}

function expectedLinkHref(
  link: { readonly target: ResolvedContentLinkInput["target"] },
  indexes: ContentIndexes,
  assetsById: ReadonlyMap<string, ResolvedContentAsset>,
): string | undefined {
  switch (link.target.kind) {
    case "asset":
      return assetsById.get(link.target.assetId)?.href;
    case "collection":
      return indexes.collectionById.get(link.target.collectionId)?.route;
    case "external":
      return link.target.url;
    case "section":
      return indexes.sectionRouteByLocationAndName.get(
        `${link.target.workId}\u0000${link.target.sectionId}\u0000${link.target.routeName}`,
      );
    case "work":
      return indexes.workById.get(link.target.workId)?.route;
  }
}

function compileLinks(
  links: readonly ResolvedContentLinkInput[],
  indexes: ContentIndexes,
  assets: readonly ResolvedContentAsset[],
  sources: ReadonlyMap<string, NormalizedSource>,
  diagnostics: Diagnostic[],
): readonly ResolvedContentLink[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const firstIndexById = new Map<string, number>();
  return [...links]
    .sort((left, right) => compareText(left.id, right.id))
    .map((link, index): ResolvedContentLink | undefined => {
      validateStableId(link.id, `/links/${index}/id`, diagnostics);
      const firstIndex = firstIndexById.get(link.id);
      if (firstIndex !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.link.duplicate_id",
            `/links/${index}/id`,
            `Link ID "${link.id}" is duplicated.`,
            "uniqueLinkId",
            { id: link.id, firstIndex, duplicateIndex: index },
          ),
        );
      } else {
        firstIndexById.set(link.id, index);
      }
      validateLinkSource(link, index, indexes, diagnostics);
      const occurrence = compileLinkOccurrence(
        link,
        index,
        indexes,
        sources,
        diagnostics,
      );
      validateResolvedHref(link.href, `/links/${index}/href`, diagnostics);
      if (
        link.target.kind === "external" &&
        !validateAbsoluteHttpUrl(link.target.url)
      ) {
        diagnostics.push(
          diagnostic(
            "content.link.external_url_invalid",
            `/links/${index}/target/url`,
            `External link target "${link.target.url}" is not a credential-free HTTP URL.`,
            "absoluteHttpUrl",
            { id: link.id, url: link.target.url },
          ),
        );
      }
      const expectedHref = expectedLinkHref(link, indexes, assetsById);
      if (expectedHref === undefined) {
        diagnostics.push(
          diagnostic(
            "content.link.target_unknown",
            `/links/${index}/target`,
            `Link "${link.id}" has an unknown target.`,
            "knownLinkTarget",
            { id: link.id, target: link.target },
          ),
        );
      } else if (expectedHref !== link.href) {
        diagnostics.push(
          diagnostic(
            "content.link.href_mismatch",
            `/links/${index}/href`,
            `Resolved link "${link.id}" does not match its target route or URL.`,
            "resolvedLink",
            { id: link.id, actual: link.href, expected: expectedHref },
          ),
        );
      }
      const metadata = cloneJsonObject(
        link.metadata,
        `/links/${index}/metadata`,
        diagnostics,
      );
      const source: ContentLocation | undefined =
        link.source.kind === "semantic"
          ? {
              kind: "semantic",
              workId: link.source.workId,
              sectionId: link.source.sectionId,
              ...(link.source.blockId === undefined
                ? {}
                : { blockId: link.source.blockId }),
            }
          : occurrence === undefined
            ? undefined
            : {
                kind: "source",
                workId: link.source.workId,
                sectionId: link.source.sectionId,
                ...(link.source.blockId === undefined
                  ? {}
                  : { blockId: link.source.blockId }),
                occurrence,
              };
      if (source === undefined) {
        return undefined;
      }
      return {
        id: link.id,
        source,
        target: link.target,
        href: link.href,
        ...(link.label === undefined ? {} : { label: link.label }),
        ...(link.relation === undefined ? {} : { relation: link.relation }),
        ...(metadata === undefined ? {} : { metadata }),
      };
    })
    .filter(
      (link): link is ResolvedContentLink => link !== undefined,
    );
}

function compilePublication(
  input: CompilePublicationContentInput,
  diagnostics: Diagnostic[],
): CompiledPublication {
  const metadata = cloneJsonObject(
    input.publication.publication.metadata,
    "/publication/metadata",
    diagnostics,
  );
  return {
    id: input.publication.publication.id,
    title: input.publication.publication.title,
    ...(input.publication.publication.description === undefined
      ? {}
      : { description: input.publication.publication.description }),
    language: input.publication.publication.language,
    ...(input.publication.publication.canonicalUrl === undefined
      ? {}
      : { canonicalUrl: input.publication.publication.canonicalUrl }),
    publisher: {
      name: input.publication.publication.publisher.name,
      ...(input.publication.publication.publisher.url === undefined
        ? {}
        : { url: input.publication.publication.publisher.url }),
    },
    attribution: {
      ...input.publication.attribution,
    },
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function isExtensionCapability(
  value: unknown,
): value is ExtensionCapability {
  return (
    typeof value === "string" &&
    EXTENSION_CAPABILITY_SET.has(value)
  );
}

function cloneResolvedExtensionCapabilities(
  value: unknown,
  pointer: string,
  diagnostics: Diagnostic[],
): readonly ExtensionCapability[] {
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic(
        "content.extension.capabilities_invalid",
        pointer,
        "Resolved extension capabilities must be an array.",
        "type",
        { expected: "array" },
      ),
    );
    return [];
  }

  const capabilities: ExtensionCapability[] = [];
  const firstIndexByCapability = new Map<string, number>();
  value.forEach((capability, index) => {
    const capabilityPointer = `${pointer}/${index}`;
    if (!isExtensionCapability(capability)) {
      diagnostics.push(
        diagnostic(
          "content.extension.capability_unknown",
          capabilityPointer,
          "Resolved extension capabilities must use the closed protocol vocabulary.",
          "extensionCapability",
          {
            capability,
            supported: EXTENSION_CAPABILITIES,
          },
        ),
      );
      return;
    }

    const firstIndex = firstIndexByCapability.get(capability);
    if (firstIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.extension.capability_duplicate",
          capabilityPointer,
          `Resolved extension capability "${capability}" appears more than once.`,
          "uniqueItems",
          { capability, firstIndex, duplicateIndex: index },
        ),
      );
    } else {
      firstIndexByCapability.set(capability, index);
    }
    capabilities.push(capability);
  });
  return capabilities;
}

function capabilityResolutionMismatchReason(
  declared: readonly ExtensionCapability[],
  resolved: readonly ExtensionCapability[],
): "extra" | "mismatched" | "missing" | "reordered" {
  if (resolved.length < declared.length) {
    return "missing";
  }
  if (resolved.length > declared.length) {
    return "extra";
  }
  const sameMembers =
    declared.every((capability) => resolved.includes(capability)) &&
    resolved.every((capability) => declared.includes(capability));
  return sameMembers ? "reordered" : "mismatched";
}

function compileExtensionsAndPayloads(
  input: CompilePublicationContentInput,
  diagnostics: Diagnostic[],
): {
  readonly extensions: readonly CompiledExtension[];
  readonly payloads: readonly CompiledContentPayload[];
} {
  const declaredExtensions = input.publication.extensions ?? [];
  const resolvedExtensions = input.extensions ?? [];
  const extensionById = new Map<string, CompiledExtension>();

  if (resolvedExtensions.length !== declaredExtensions.length) {
    diagnostics.push(
      diagnostic(
        "content.extension.resolution_count_mismatch",
        "/extensions",
        "Every declared extension must have one resolved exact version in manifest order.",
        "extensionResolution",
        {
          declared: declaredExtensions.length,
          resolved: resolvedExtensions.length,
        },
      ),
    );
  }

  const extensions = declaredExtensions.map(
    (declared, index): CompiledExtension => {
      const resolved = resolvedExtensions[index];
      const declaredCapabilities = Array.isArray(declared.capabilities)
        ? declared.capabilities.filter(isExtensionCapability)
        : [];
      const resolvedCapabilities =
        cloneResolvedExtensionCapabilities(
          resolved?.capabilities,
          `/extensions/${index}/capabilities`,
          diagnostics,
        );
      validateStableId(declared.id, `/extensions/${index}/id`, diagnostics);
      validatePackageName(
        declared.package,
        `/extensions/${index}/package`,
        diagnostics,
      );
      if (
        resolved === undefined ||
        resolved.id !== declared.id ||
        resolved.package !== declared.package
      ) {
        diagnostics.push(
          diagnostic(
            "content.extension.resolution_mismatch",
            `/extensions/${index}`,
            `Resolved extension ${index + 1} does not match the declared extension identity.`,
            "extensionResolution",
            {
              declaredId: declared.id,
              declaredPackage: declared.package,
              resolvedId: resolved?.id,
              resolvedPackage: resolved?.package,
            },
          ),
        );
      }
      const capabilitiesMatch =
        declaredCapabilities.length === resolvedCapabilities.length &&
        declaredCapabilities.every(
          (capability, capabilityIndex) =>
            capability === resolvedCapabilities[capabilityIndex],
        );
      if (!capabilitiesMatch) {
        const reason = capabilityResolutionMismatchReason(
          declaredCapabilities,
          resolvedCapabilities,
        );
        diagnostics.push(
          diagnostic(
            "content.extension.capability_resolution_mismatch",
            `/extensions/${index}/capabilities`,
            `Resolved extension ${index + 1} capability grants do not exactly match the manifest.`,
            "extensionCapabilityResolution",
            {
              reason,
              declared: declaredCapabilities,
              resolved: resolvedCapabilities,
            },
          ),
        );
      }
      const version = resolved?.version ?? "0.0.0-invalid";
      if (!EXACT_SEMVER.test(version)) {
        diagnostics.push(
          diagnostic(
            "content.extension.version_invalid",
            `/extensions/${index}/version`,
            "Resolved extension versions must be canonical SemVer.",
            "semver",
            { version },
          ),
        );
      }
      const config = cloneJsonObject(
        declared.config,
        `/extensions/${index}/config`,
        diagnostics,
      );
      const extension: CompiledExtension = {
        id: declared.id,
        package: declared.package,
        version,
        capabilities: resolvedCapabilities,
        ...(config === undefined ? {} : { config }),
        payloadIds: [],
      };
      const first = extensionById.get(extension.id);
      if (first !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.extension.id_duplicate",
            `/extensions/${index}/id`,
            `Extension ID "${extension.id}" is declared more than once.`,
            "uniqueExtensionId",
            { id: extension.id },
          ),
        );
      } else {
        extensionById.set(extension.id, extension);
      }
      return extension;
    },
  );

  const payloadIdFirstIndex = new Map<string, number>();
  const sourceOwnerByPath = new Map<string, string>();
  const payloads = [...(input.payloads ?? [])]
    .sort((left, right) => compareText(left.id, right.id))
    .map((payload, index): CompiledContentPayload | undefined => {
      const pointer = `/payloads/${index}`;
      validateStableId(payload.id, `${pointer}/id`, diagnostics);
      validateStableId(
        payload.extensionId,
        `${pointer}/extensionId`,
        diagnostics,
      );
      const firstIndex = payloadIdFirstIndex.get(payload.id);
      if (firstIndex !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.payload.id_duplicate",
            `${pointer}/id`,
            `Content payload ID "${payload.id}" appears more than once.`,
            "uniquePayloadId",
            { firstIndex, duplicateIndex: index },
          ),
        );
      } else {
        payloadIdFirstIndex.set(payload.id, index);
      }
      if (!extensionById.has(payload.extensionId)) {
        diagnostics.push(
          diagnostic(
            "content.payload.extension_unknown",
            `${pointer}/extensionId`,
            `Content payload "${payload.id}" names an unknown extension.`,
            "knownExtension",
            { extensionId: payload.extensionId },
          ),
        );
      }
      if (!validateAbsoluteHttpUrl(payload.schema)) {
        diagnostics.push(
          diagnostic(
            "content.payload.schema_invalid",
            `${pointer}/schema`,
            "Content payload schemas must use an absolute credential-free HTTP URL.",
            "absoluteHttpUrl",
            { schema: payload.schema },
          ),
        );
      }

      const sourcePaths = [...payload.sourcePaths].sort(compareText);
      const firstSourceIndex = new Map<string, number>();
      sourcePaths.forEach((sourcePath, sourceIndex) => {
        diagnostics.push(
          ...validateRepositoryRelativePath(
            sourcePath,
            `${pointer}/sourcePaths/${sourceIndex}`,
          ),
        );
        const first = firstSourceIndex.get(sourcePath);
        if (first !== undefined) {
          diagnostics.push(
            diagnostic(
              "content.payload.source_duplicate",
              `${pointer}/sourcePaths/${sourceIndex}`,
              `Content payload "${payload.id}" repeats source "${sourcePath}".`,
              "uniqueItems",
              { firstIndex: first, duplicateIndex: sourceIndex },
            ),
          );
        } else {
          firstSourceIndex.set(sourcePath, sourceIndex);
        }
        const firstOwner = sourceOwnerByPath.get(sourcePath);
        if (
          firstOwner !== undefined &&
          firstOwner !== payload.extensionId
        ) {
          diagnostics.push(
            diagnostic(
              "content.payload.source_owner_collision",
              `${pointer}/sourcePaths/${sourceIndex}`,
              `Extension source "${sourcePath}" is claimed by more than one extension.`,
              "uniqueSourceOwner",
              {
                firstExtensionId: firstOwner,
                duplicateExtensionId: payload.extensionId,
              },
            ),
          );
        } else {
          sourceOwnerByPath.set(sourcePath, payload.extensionId);
        }
      });
      const data = cloneJsonValue(
        payload.data,
        `${pointer}/data`,
        diagnostics,
      );
      if (data === undefined) {
        return undefined;
      }
      const basis = {
        id: payload.id,
        extensionId: payload.extensionId,
        schema: payload.schema,
        sourcePaths,
        data,
      };
      return {
        ...basis,
        contentHash: hashValue(contentPayloadHashBasis(basis)),
      };
    })
    .filter(
      (payload): payload is CompiledContentPayload =>
        payload !== undefined,
    );

  const payloadIdsByExtension = new Map<string, string[]>();
  for (const payload of payloads) {
    const ids = payloadIdsByExtension.get(payload.extensionId) ?? [];
    ids.push(payload.id);
    payloadIdsByExtension.set(payload.extensionId, ids);
  }

  return {
    extensions: extensions.map((extension) => ({
      ...extension,
      payloadIds: payloadIdsByExtension.get(extension.id) ?? [],
    })),
    payloads,
  };
}

function validateWorkInputs(
  input: CompilePublicationContentInput,
  diagnostics: Diagnostic[],
): ReadonlyMap<string, WorkContentInput> {
  const byId = new Map<string, WorkContentInput>();
  input.works.forEach((work, index) => {
    const first = byId.get(work.workId);
    if (first !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.work.duplicate_input",
          `/workInputs/${index}/workId`,
          `Work content for "${work.workId}" is injected more than once.`,
          "uniqueWorkInput",
          { workId: work.workId },
        ),
      );
      return;
    }
    byId.set(work.workId, work);
  });
  const known = new Set(
    input.sourceGraph.works.map((work) => work.workId),
  );
  for (const work of input.sourceGraph.works) {
    if (!byId.has(work.workId)) {
      diagnostics.push(
        diagnostic(
          "content.work.input_missing",
          "/workInputs",
          `Resolved work "${work.workId}" has no content input.`,
          "requiredWorkInput",
          { workId: work.workId },
        ),
      );
    }
  }
  for (const [workId] of byId) {
    if (!known.has(workId)) {
      diagnostics.push(
        diagnostic(
          "content.work.input_unexpected",
          "/workInputs",
          `Content input "${workId}" is not a resolved publication work.`,
          "resolvedWork",
          { workId },
        ),
      );
    }
  }
  return byId;
}

function validateSourceGraph(
  input: CompilePublicationContentInput,
  diagnostics: Diagnostic[],
): void {
  const semanticResult =
    resolvePublicationSourcesForContentCompilation({
    publication: input.publication,
    engineVersion: input.engineVersion,
    workManifests: new Map(
      input.sourceGraph.works.map((work) => [
        work.manifestPath,
        work.manifest,
      ]),
    ),
    collectionManifests: new Map(
      input.sourceGraph.collections.map((collection) => [
        collection.manifestPath,
        collection.manifest,
      ]),
    ),
  });
  if (!semanticResult.valid) {
    diagnostics.push(
      ...semanticResult.diagnostics.map((item) => ({
        ...item,
        code: `content.input.${item.code}`,
      })),
    );
    return;
  }
  if (
    canonicalizeJson(asJson(semanticResult.value)) !==
    canonicalizeJson(asJson(input.sourceGraph))
  ) {
    diagnostics.push(
      diagnostic(
        "content.input.source_graph_mismatch",
        "/sourceGraph",
        "The injected source graph does not match a fresh semantic resolution of the publication manifests.",
        "resolvedSourceGraph",
        {},
      ),
    );
  }
}

function compilePublicationContentInternal(
  input: CompilePublicationContentInput,
): ValidationResult<PublicationContentEnvelope> {
  const diagnostics: Diagnostic[] = [];
  if (!EXACT_SEMVER.test(input.engineVersion)) {
    diagnostics.push(
      diagnostic(
        "content.engine_version.invalid",
        "/engineVersion",
        `Engine version "${input.engineVersion}" is not canonical SemVer.`,
        "semver",
        { engineVersion: input.engineVersion },
      ),
    );
  }
  validateSourceGraph(input, diagnostics);
  const { extensions, payloads } = compileExtensionsAndPayloads(
    input,
    diagnostics,
  );
  const wordsPerMinute =
    input.wordsPerMinute ?? DEFAULT_WORDS_PER_MINUTE;
  if (
    !Number.isInteger(wordsPerMinute) ||
    wordsPerMinute < 1 ||
    wordsPerMinute > 2000
  ) {
    diagnostics.push(
      diagnostic(
        "content.reading_rate.invalid",
        "/wordsPerMinute",
        "Reading rate must be an integer from 1 through 2,000 words per minute.",
        "readingRate",
        { wordsPerMinute },
      ),
    );
  }

  const sources = compileSources(input, diagnostics);
  const workInputs = validateWorkInputs(input, diagnostics);
  const activeRoutes: ContentRoute[] = [];
  const routeOwnerByPath = new Map<string, ContentRoute>();
  addActiveRoute(
    activeRoutes,
    routeOwnerByPath,
    {
      path: input.publication.routes.home,
      target: { kind: "home" },
    },
    "/routes/home",
    diagnostics,
  );
  if (input.publication.routes.updates !== undefined) {
    addActiveRoute(
      activeRoutes,
      routeOwnerByPath,
      {
        path: input.publication.routes.updates,
        target: { kind: "updates" },
      },
      "/routes/updates",
      diagnostics,
    );
  }

  const effectiveWordsPerMinute =
    Number.isInteger(wordsPerMinute) &&
    wordsPerMinute >= 1 &&
    wordsPerMinute <= 2000
      ? wordsPerMinute
      : DEFAULT_WORDS_PER_MINUTE;
  const works = input.sourceGraph.works
    .map((workSource) =>
      compileWork(
        input,
        workSource,
        workInputs.get(workSource.workId),
        sources.byPath,
        effectiveWordsPerMinute,
        activeRoutes,
        routeOwnerByPath,
        diagnostics,
      ),
    )
    .filter((work): work is CompiledWork => work !== undefined);
  const collections = compileCollections(
    input,
    activeRoutes,
    routeOwnerByPath,
    diagnostics,
  );
  validateContinuityOwnership(works, diagnostics);
  const indexes = createIndexes(works, collections);
  const assets = compileAssets(
    input,
    input.assets ?? [],
    sources.byPath,
    indexes,
    routeOwnerByPath,
    diagnostics,
  );
  const links = compileLinks(
    input.links ?? [],
    indexes,
    assets,
    sources.byPath,
    diagnostics,
  );

  const referencedAssetPaths = new Set(
    (input.assets ?? []).map((asset) => asset.sourcePath),
  );
  for (const source of sources.byPath.values()) {
    if (source.role === "asset" && !referencedAssetPaths.has(source.path)) {
      diagnostics.push(
        diagnostic(
          "content.source.unreferenced_asset",
          "/sources",
          `Injected asset source "${source.path}" has no resolved asset record.`,
          "resolvedAsset",
          { sourcePath: source.path },
        ),
      );
    }
    if (
      source.role === "manuscript" ||
      source.role === "asset" ||
      source.role === "extension" ||
      source.role === "work-manifest" ||
      source.role === "collection-manifest"
    ) {
      const insideSourceRoot =
        input.publication.boundaries.sourceRoots.some((root) =>
          isPathWithinRoot(source.path, root),
        );
      if (!insideSourceRoot) {
        diagnostics.push(
          diagnostic(
            "content.source.outside_boundary",
            "/sources",
            `Source "${source.path}" is outside every declared source root.`,
            "sourceBoundary",
            {
              sourcePath: source.path,
              sourceRoots: input.publication.boundaries.sourceRoots,
            },
          ),
        );
      }
    }
  }

  const publication = compilePublication(input, diagnostics);
  const sourceAuthority = {
    publicationManifestPath:
      input.sourceGraph.layout.publicationManifestPath,
    sourceRoots: [...input.publication.boundaries.sourceRoots],
    outputRoots: [...input.publication.boundaries.outputRoots],
    sharedAssetsRoot: input.sourceGraph.layout.assetsRoot,
  };
  const sectionCount = works.reduce(
    (total, work) => total + work.sections.length,
    0,
  );
  const blockCount = works.reduce(
    (total, work) =>
      total +
      work.sections.reduce(
        (sectionTotal, section) =>
          sectionTotal + section.blocks.length,
        0,
      ),
    0,
  );
  const wordCount = works.reduce(
    (total, work) => total + work.wordCount,
    0,
  );
  const statistics = {
    workCount: works.length,
    collectionCount: collections.length,
    sectionCount,
    blockCount,
    wordCount,
    readingMinutes: calculateReadingMinutes(
      wordCount,
      effectiveWordsPerMinute,
    ),
    wordsPerMinute: effectiveWordsPerMinute,
  };
  const redirects = (input.publication.continuity?.redirects ?? []).map(
    (redirect) => ({ ...redirect }),
  );
  validateCompiledRedirects(
    redirects,
    routeOwnerByPath,
    diagnostics,
  );
  validateSectionAddressAuthority(
    works,
    routeOwnerByPath,
    diagnostics,
  );
  validateAssetRedirectAuthority(assets, redirects, diagnostics);
  const routes = { active: activeRoutes, redirects };

  if (diagnostics.length > 0) {
    return immutableSnapshot({
      valid: false,
      diagnostics: sortDiagnostics(diagnostics),
    });
  }

  const artifact = {
    kind: "publication-content" as const,
    mediaType: CONTENT_ARTIFACT_MEDIA_TYPE,
    outputRoot: input.sourceGraph.layout.outputRoot,
    relativePath: CONTENT_ARTIFACT_RELATIVE_PATH,
  } as const;
  const sourceSet = hashValue(sources.provenance);
  const content = hashValue(envelopeContentHashBasis({
    publication,
    sourceAuthority,
    works,
    collections,
    extensions,
    payloads,
    assets,
    links,
    routes,
    statistics,
  }));
  const buildId = hashValue(envelopeBuildHashBasis({
    schemaVersion: CONTENT_SCHEMA_VERSION,
    publicationId: input.publication.publication.id,
    engineVersion: input.engineVersion,
    compilerVersion: CONTENT_COMPILER_VERSION,
    artifact,
    hashes: { sourceSet, content },
  }));
  const envelope: PublicationContentEnvelope = {
    $schema: CONTENT_ENVELOPE_SCHEMA_URL,
    schemaVersion: CONTENT_SCHEMA_VERSION,
    publicationId: input.publication.publication.id,
    engineVersion: input.engineVersion,
    compilerVersion: CONTENT_COMPILER_VERSION,
    buildId,
    artifact,
    hashes: { sourceSet, content },
    publication,
    sourceAuthority,
    sources: sources.provenance,
    extensions,
    payloads,
    works,
    collections,
    assets,
    links,
    routes,
    statistics,
  };
  const envelopeResult = validatePublicationContentEnvelope(envelope);
  if (!envelopeResult.valid) {
    return immutableSnapshot({
      valid: false,
      diagnostics: sortDiagnostics(
        envelopeResult.diagnostics.map((item) => ({
          ...item,
          code: `content.output.${item.code}`,
        })),
      ),
    });
  }

  return immutableSnapshot({
    valid: true,
    value: envelope,
    diagnostics: [],
  });
}

function equalJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(asJson(left)) === canonicalizeJson(asJson(right));
}

function expectDerivedValue(
  actual: unknown,
  expected: unknown,
  path: string,
  subject: string,
  diagnostics: Diagnostic[],
): void {
  if (equalJson(actual, expected)) {
    return;
  }
  diagnostics.push(
    diagnostic(
      "content.envelope.derived_value_mismatch",
      path,
      `${subject} does not match the value derived from the envelope.`,
      "derivedValue",
      { actual, expected },
    ),
  );
}

function validateEnvelopeSources(
  envelope: PublicationContentEnvelope,
  diagnostics: Diagnostic[],
): ReadonlyMap<string, SourceProvenance> {
  const sourceByPath = new Map<string, SourceProvenance>();
  envelope.sources.forEach((source, index) => {
    const first = sourceByPath.get(source.path);
    if (first !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.source_path_duplicate",
          `/sources/${index}/path`,
          `Source path "${source.path}" appears more than once.`,
          "uniqueSourcePath",
          { path: source.path },
        ),
      );
    } else {
      sourceByPath.set(source.path, source);
    }
    if (
      (source.rawByteLength === 0 &&
        source.rawHash !== EMPTY_CONTENT_HASH) ||
      (source.normalizedByteLength === 0 &&
        source.normalizedHash !== EMPTY_CONTENT_HASH)
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.empty_source_hash_invalid",
          `/sources/${index}`,
          `Empty source identity for "${source.path}" must use the SHA-256 digest of zero bytes.`,
          "sourceByteGeometry",
          {
            emptyHash: EMPTY_CONTENT_HASH,
            normalizedByteLength: source.normalizedByteLength,
            normalizedHash: source.normalizedHash,
            rawByteLength: source.rawByteLength,
            rawHash: source.rawHash,
          },
        ),
      );
    }
    if (source.kind === "text") {
      const roleRequiresText =
        source.role === "publication-manifest" ||
        source.role === "work-manifest" ||
        source.role === "collection-manifest" ||
        source.role === "manuscript";
      const starts = source.normalizedLineStarts;
      const invalidStartIndex = starts.findIndex(
        (start, startIndex) =>
          start < 0 ||
          start > source.normalizedCodeUnitLength ||
          (startIndex > 0 && start <= (starts[startIndex - 1] ?? -1)),
      );
      const normalizedLengthEmptyMismatch =
        (source.normalizedByteLength === 0) !==
        (source.normalizedCodeUnitLength === 0);
      const normalizedLineBreakCount = Math.max(
        0,
        source.normalizedLineStarts.length - 1,
      );
      const maximumNormalizedByteLength =
        normalizedLineBreakCount +
        3 *
          (source.normalizedCodeUnitLength -
            normalizedLineBreakCount);
      const normalizedLengthExceedsUtf8Maximum =
        source.normalizedByteLength >
        maximumNormalizedByteLength;
      if (
        starts[0] !== 0 ||
        invalidStartIndex !== -1 ||
        source.normalizedByteLength <
          source.normalizedCodeUnitLength ||
        normalizedLengthEmptyMismatch ||
        normalizedLengthExceedsUtf8Maximum
      ) {
        diagnostics.push(
          diagnostic(
            "content.envelope.source_text_geometry_invalid",
            `/sources/${index}`,
            `Text source "${source.path}" has invalid normalized text geometry.`,
            "sourceGeometry",
            {
              invalidStartIndex,
              normalizedByteLength: source.normalizedByteLength,
              normalizedCodeUnitLength: source.normalizedCodeUnitLength,
              maximumNormalizedByteLength,
              normalizedLengthEmptyMismatch,
              normalizedLengthExceedsUtf8Maximum,
            },
          ),
        );
      }
      if (source.rawByteLength < source.normalizedByteLength) {
        diagnostics.push(
          diagnostic(
            "content.envelope.source_raw_length_invalid",
            `/sources/${index}/rawByteLength`,
            `Text source "${source.path}" has a raw byte length smaller than its normalized byte length.`,
            "sourceByteGeometry",
            {
              normalizedByteLength: source.normalizedByteLength,
              rawByteLength: source.rawByteLength,
            },
          ),
        );
      }
      if (
        source.normalizedCodeUnitLength > 0 &&
        source.rawByteLength === 0
      ) {
        diagnostics.push(
          diagnostic(
            "content.envelope.source_raw_identity_empty",
            `/sources/${index}/rawByteLength`,
            `Non-empty text source "${source.path}" cannot claim an empty raw source.`,
            "sourceByteGeometry",
            {
              normalizedCodeUnitLength:
                source.normalizedCodeUnitLength,
              rawByteLength: source.rawByteLength,
            },
          ),
        );
      }
      if (
        source.rawByteLength >
        source.normalizedByteLength + normalizedLineBreakCount
      ) {
        diagnostics.push(
          diagnostic(
            "content.envelope.source_raw_normalization_delta_invalid",
            `/sources/${index}/rawByteLength`,
            `Text source "${source.path}" claims more removed raw bytes than newline normalization permits.`,
            "sourceByteGeometry",
            {
              normalizedByteLength: source.normalizedByteLength,
              normalizedLineBreakCount,
              rawByteLength: source.rawByteLength,
            },
          ),
        );
      }
      if (
        normalizedLineBreakCount === 0 &&
        source.rawByteLength === source.normalizedByteLength &&
        source.rawHash !== source.normalizedHash
      ) {
        diagnostics.push(
          diagnostic(
            "content.envelope.source_identity_without_normalization_invalid",
            `/sources/${index}/normalizedHash`,
            `Text source "${source.path}" claims distinct identities although no newline normalization could have changed its bytes.`,
            "sourceByteGeometry",
            {
              normalizedByteLength: source.normalizedByteLength,
              normalizedLineBreakCount,
              rawByteLength: source.rawByteLength,
            },
          ),
        );
      }
      if (
        roleRequiresText &&
        (source.role === "publication-manifest" ||
          source.role === "work-manifest" ||
          source.role === "collection-manifest") &&
        mediaTypeEssence(source.mediaType) !== "application/json"
      ) {
        diagnostics.push(
          diagnostic(
            "content.envelope.manifest_media_type_invalid",
            `/sources/${index}/mediaType`,
            `Manifest source "${source.path}" must use application/json.`,
            "manifestMediaType",
            { mediaType: source.mediaType, role: source.role },
          ),
        );
      }
    } else if (
      source.rawByteLength !== source.normalizedByteLength ||
      source.rawHash !== source.normalizedHash
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.binary_source_normalized",
          `/sources/${index}`,
          `Binary source "${source.path}" cannot have a distinct normalized identity.`,
          "binaryIdentity",
          {},
        ),
      );
    } else if (
      source.role === "publication-manifest" ||
      source.role === "work-manifest" ||
      source.role === "collection-manifest" ||
      source.role === "manuscript"
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.required_text_source_binary",
          `/sources/${index}/kind`,
          `Source "${source.path}" must be represented as normalized text.`,
          "textSource",
          { role: source.role },
        ),
      );
    }
  });
  const sorted = [...envelope.sources].sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.role, right.role) ||
      compareText(left.entityId ?? "", right.entityId ?? ""),
  );
  expectDerivedValue(
    envelope.sources,
    sorted,
    "/sources",
    "Source provenance order",
    diagnostics,
  );
  expectDerivedValue(
    envelope.hashes.sourceSet,
    hashValue(envelope.sources),
    "/hashes/sourceSet",
    "Source-set hash",
    diagnostics,
  );
  return sourceByPath;
}

function sourcePointFromProvenance(
  source: Extract<SourceProvenance, { readonly kind: "text" }>,
  offset: number,
): SourcePoint {
  return pointAt("", source.normalizedLineStarts, offset);
}

function validateEnvelopeSourceSpan(
  span: SourceSpan,
  pointer: string,
  sourceByPath: ReadonlyMap<string, SourceProvenance>,
  diagnostics: Diagnostic[],
  expectedText?: string,
): void {
  const source = sourceByPath.get(span.sourcePath);
  if (source === undefined || source.kind !== "text") {
    diagnostics.push(
      diagnostic(
        "content.envelope.span_source_not_text",
        `${pointer}/sourcePath`,
        `Source span "${span.sourcePath}" does not reference a known text source.`,
        "textSource",
        { sourcePath: span.sourcePath },
      ),
    );
    return;
  }

  const start = span.start;
  const end = span.end;
  const validOffsets =
    start.offset >= 0 &&
    end.offset > start.offset &&
    end.offset <= source.normalizedCodeUnitLength;
  if (!validOffsets) {
    diagnostics.push(
      diagnostic(
        "content.envelope.source_span_bounds_invalid",
        pointer,
        `Source span "${span.sourcePath}" is outside normalized text bounds.`,
        "sourceSpan",
        {
          startOffset: start.offset,
          endOffset: end.offset,
          normalizedCodeUnitLength: source.normalizedCodeUnitLength,
        },
      ),
    );
    return;
  }

  expectDerivedValue(
    start,
    sourcePointFromProvenance(source, start.offset),
    `${pointer}/start`,
    "Source span start point",
    diagnostics,
  );
  expectDerivedValue(
    end,
    sourcePointFromProvenance(source, end.offset),
    `${pointer}/end`,
    "Source span end point",
    diagnostics,
  );
  if (
    expectedText !== undefined &&
    end.offset - start.offset !== expectedText.length
  ) {
    diagnostics.push(
      diagnostic(
        "content.envelope.source_span_length_mismatch",
        pointer,
        "Source span length does not match its normalized content.",
        "sourceSpan",
        {
          actual: end.offset - start.offset,
          expected: expectedText.length,
        },
      ),
    );
  }
  if (expectedText !== undefined) {
    const expectedLineStarts: number[] = [];
    for (let index = 0; index < expectedText.length; index += 1) {
      if (expectedText[index] === "\n") {
        expectedLineStarts.push(start.offset + index + 1);
      }
    }
    const actualLineStarts = source.normalizedLineStarts.filter(
      (lineStart) =>
        lineStart > start.offset && lineStart <= end.offset,
    );
    if (!equalJson(actualLineStarts, expectedLineStarts)) {
      diagnostics.push(
        diagnostic(
          "content.envelope.source_span_line_geometry_mismatch",
          pointer,
          "Source span line geometry does not match its normalized content.",
          "sourceSpan",
          { actualLineStarts, expectedLineStarts },
        ),
      );
    }
  }
}

function validateEnvelopeBlock(
  block: MarkdownContentBlock,
  blockIndex: number,
  sectionPointer: string,
  manuscriptPath: string,
  coreMetrics: boolean,
  sourceByPath: ReadonlyMap<string, SourceProvenance>,
  diagnostics: Diagnostic[],
): void {
  const pointer = `${sectionPointer}/blocks/${blockIndex}`;
  validateContentId(block.id, `${pointer}/id`, diagnostics);
  validateContentId(block.anchor, `${pointer}/anchor`, diagnostics);
  validateStableId(block.kind, `${pointer}/kind`, diagnostics);
  if (coreMetrics) {
    expectDerivedValue(
      block.wordCount,
      countWords(block.text),
      `${pointer}/wordCount`,
      "Block word count",
      diagnostics,
    );
  }
  expectDerivedValue(
    block.contentHash,
    hashValue(blockHashBasis(block)),
    `${pointer}/contentHash`,
    "Block content hash",
    diagnostics,
  );
  if (block.provenance.sourcePath !== manuscriptPath) {
    diagnostics.push(
      diagnostic(
        "content.envelope.block_source_mismatch",
        `${pointer}/provenance/sourcePath`,
        `Block "${block.id}" does not point to its work manuscript.`,
        "resolvedManuscript",
        {
          actual: block.provenance.sourcePath,
          expected: manuscriptPath,
        },
      ),
    );
  }
  const source = sourceByPath.get(block.provenance.sourcePath);
  if (
    source === undefined ||
    source.role !== "manuscript"
  ) {
    diagnostics.push(
      diagnostic(
        "content.envelope.block_source_unknown",
        `${pointer}/provenance/sourcePath`,
        `Block "${block.id}" references an unknown manuscript source.`,
        "knownSource",
        { sourcePath: block.provenance.sourcePath },
      ),
    );
  }
  validateEnvelopeSourceSpan(
    block.provenance,
    `${pointer}/provenance`,
    sourceByPath,
    diagnostics,
    block.markdown,
  );
}

function validateEnvelopeWork(
  work: CompiledWork,
  workIndex: number,
  wordsPerMinute: number,
  sourceByPath: ReadonlyMap<string, SourceProvenance>,
  diagnostics: Diagnostic[],
): void {
  const pointer = `/works/${workIndex}`;
  validateStableId(work.id, `${pointer}/id`, diagnostics);
  validateStableId(
    work.source.adapter.id,
    `${pointer}/source/adapter/id`,
    diagnostics,
  );
  validatePackageName(
    work.source.adapter.package,
    `${pointer}/source/adapter/package`,
    diagnostics,
  );
  if (!EXACT_SEMVER.test(work.source.adapter.version)) {
    diagnostics.push(
      diagnostic(
        "content.envelope.adapter_version_invalid",
        `${pointer}/source/adapter/version`,
        "Adapter versions must be canonical SemVer.",
        "semver",
        { version: work.source.adapter.version },
      ),
    );
  }
  validateStableId(
    work.source.metrics.id,
    `${pointer}/source/metrics/id`,
    diagnostics,
  );
  validatePackageName(
    work.source.metrics.package,
    `${pointer}/source/metrics/package`,
    diagnostics,
  );
  if (!EXACT_SEMVER.test(work.source.metrics.version)) {
    diagnostics.push(
      diagnostic(
        "content.envelope.metrics_version_invalid",
        `${pointer}/source/metrics/version`,
        "Metric versions must be canonical SemVer.",
        "semver",
        { version: work.source.metrics.version },
      ),
    );
  }
  if (!EXACT_SEMVER.test(work.source.metrics.profileVersion)) {
    diagnostics.push(
      diagnostic(
        "content.envelope.metrics_profile_version_invalid",
        `${pointer}/source/metrics/profileVersion`,
        "Metric profile versions must be canonical SemVer.",
        "semver",
        { profileVersion: work.source.metrics.profileVersion },
      ),
    );
  }
  const coreMetrics = equalJson(
    work.source.metrics,
    CORE_METRICS_IDENTITY,
  );
  validateRoute(work.route, `${pointer}/route`, diagnostics);

  const manifestSource = sourceByPath.get(work.source.manifestPath);
  if (
    manifestSource?.role !== "work-manifest" ||
    manifestSource.entityId !== work.id
  ) {
    diagnostics.push(
      diagnostic(
        "content.envelope.work_manifest_source_mismatch",
        `${pointer}/source/manifestPath`,
        `Work "${work.id}" has no matching manifest provenance.`,
        "sourceIdentity",
        { source: manifestSource, workId: work.id },
      ),
    );
  }
  const manuscriptSource = sourceByPath.get(work.source.manuscriptPath);
  if (
    manuscriptSource?.role !== "manuscript" ||
    manuscriptSource.entityId !== work.id
  ) {
    diagnostics.push(
      diagnostic(
        "content.envelope.work_manuscript_source_mismatch",
        `${pointer}/source/manuscriptPath`,
        `Work "${work.id}" has no matching manuscript provenance.`,
        "sourceIdentity",
        { source: manuscriptSource, workId: work.id },
      ),
    );
  }

  const sectionIndexById = new Map<string, number>();
  const childrenByParentId = new Map<string, string[]>();
  work.sections.forEach((section, sectionIndex) => {
    const firstIndex = sectionIndexById.get(section.id);
    if (firstIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.section_id_duplicate",
          `${pointer}/sections/${sectionIndex}/id`,
          `Section ID "${section.id}" appears more than once in work "${work.id}".`,
          "uniqueSectionId",
          { firstIndex, duplicateIndex: sectionIndex },
        ),
      );
    } else {
      sectionIndexById.set(section.id, sectionIndex);
    }
    if (section.parentId !== null) {
      const children = childrenByParentId.get(section.parentId) ?? [];
      children.push(section.id);
      childrenByParentId.set(section.parentId, children);
    }
  });

  const depthById = new Map<string, number>();
  const navigableIds = work.sections
    .filter((section) => section.navigable)
    .map((section) => section.id);
  const blockRanges: {
    readonly start: number;
    readonly end: number;
    readonly blockId: string;
  }[] = [];
  work.sections.forEach((section, sectionIndex) => {
    const sectionPointer = `${pointer}/sections/${sectionIndex}`;
    validateContentId(section.id, `${sectionPointer}/id`, diagnostics);
    validateStableId(section.role, `${sectionPointer}/role`, diagnostics);
    expectDerivedValue(
      section.order,
      sectionIndex,
      `${sectionPointer}/order`,
      "Section order",
      diagnostics,
    );
    const parentIndex =
      section.parentId === null
        ? undefined
        : sectionIndexById.get(section.parentId);
    if (
      section.parentId !== null &&
      (parentIndex === undefined || parentIndex >= sectionIndex)
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.section_parent_invalid",
          `${sectionPointer}/parentId`,
          `Section "${section.id}" does not have an earlier preorder parent.`,
          "preorderParent",
          { parentId: section.parentId, parentIndex, sectionIndex },
        ),
      );
    }
    const expectedDepth =
      section.parentId === null
        ? 0
        : (depthById.get(section.parentId) ?? -1) + 1;
    depthById.set(section.id, expectedDepth);
    expectDerivedValue(
      section.depth,
      expectedDepth,
      `${sectionPointer}/depth`,
      "Section depth",
      diagnostics,
    );
    expectDerivedValue(
      section.childIds,
      childrenByParentId.get(section.id) ?? [],
      `${sectionPointer}/childIds`,
      "Section child IDs",
      diagnostics,
    );

    const routeCheck = normalizeSectionRoutes(
      {
        id: section.id,
        role: section.role,
        title: section.title,
        routes: section.routes,
        activeRouteNames: section.activeRouteNames,
        readerLocation: { kind: "none" },
        continuity: section.continuity,
        navigable: section.navigable,
        blocks: [],
      },
      sectionPointer,
      diagnostics,
    );
    if (section.readerAddress === null) {
      if (section.navigable) {
        diagnostics.push(
          diagnostic(
            "content.envelope.reader_address_required",
            `${sectionPointer}/readerAddress`,
            `Navigable section "${section.id}" has no public reader address.`,
            "navigableReaderAddress",
            { sectionId: section.id, workId: work.id },
          ),
        );
      }
    } else {
      validateRoute(
        section.readerAddress.path,
        `${sectionPointer}/readerAddress/path`,
        diagnostics,
      );
      if (section.readerAddress.anchor !== undefined) {
        validateContentId(
          section.readerAddress.anchor,
          `${sectionPointer}/readerAddress/anchor`,
          diagnostics,
        );
      }
      const usesWorkRoute =
        section.readerAddress.anchor === undefined &&
        section.readerAddress.path === work.route;
      const usesNamedAddress = Object.values(section.routes).some((address) =>
        equalJson(address, section.readerAddress)
      );
      if (!usesWorkRoute && !usesNamedAddress) {
        diagnostics.push(
          diagnostic(
            "content.envelope.reader_address_unowned",
            `${sectionPointer}/readerAddress`,
            `Reader address for section "${section.id}" is neither its work route nor one of its named section addresses.`,
            "ownedReaderAddress",
            {
              readerAddress: section.readerAddress,
              sectionId: section.id,
              workId: work.id,
            },
          ),
        );
      }
    }
    expectDerivedValue(
      section.routes,
      routeCheck.routes,
      `${sectionPointer}/routes`,
      "Section addresses",
      diagnostics,
    );
    normalizeSectionContinuity(
      section.id,
      section.continuity,
      sectionPointer,
      diagnostics,
    );

    const blockIdFirstIndex = new Map<string, number>();
    const blockAnchorFirstIndex = new Map<string, number>();
    section.blocks.forEach((block, blockIndex) => {
      const firstIndex = blockIdFirstIndex.get(block.id);
      if (firstIndex !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.envelope.block_id_duplicate",
            `${sectionPointer}/blocks/${blockIndex}/id`,
            `Block ID "${block.id}" appears more than once in section "${section.id}".`,
            "uniqueBlockId",
            { firstIndex, duplicateIndex: blockIndex },
          ),
        );
      } else {
        blockIdFirstIndex.set(block.id, blockIndex);
      }
      const firstAnchorIndex = blockAnchorFirstIndex.get(block.anchor);
      if (firstAnchorIndex !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.envelope.block_anchor_duplicate",
            `${sectionPointer}/blocks/${blockIndex}/anchor`,
            `Public block anchor "${block.anchor}" appears more than once in section "${section.id}".`,
            "uniqueBlockAnchor",
            {
              firstIndex: firstAnchorIndex,
              duplicateIndex: blockIndex,
            },
          ),
        );
      } else {
        blockAnchorFirstIndex.set(block.anchor, blockIndex);
      }
      validateEnvelopeBlock(
        block,
        blockIndex,
        sectionPointer,
        work.source.manuscriptPath,
        coreMetrics,
        sourceByPath,
        diagnostics,
      );
      blockRanges.push({
        start: block.provenance.start.offset,
        end: block.provenance.end.offset,
        blockId: block.id,
      });
    });
    const expectedWordCount = section.blocks.reduce(
      (total, block) => total + block.wordCount,
      0,
    );
    expectDerivedValue(
      section.wordCount,
      expectedWordCount,
      `${sectionPointer}/wordCount`,
      "Section word count",
      diagnostics,
    );
    expectDerivedValue(
      section.readingMinutes,
      calculateReadingMinutes(expectedWordCount, wordsPerMinute),
      `${sectionPointer}/readingMinutes`,
      "Section reading time",
      diagnostics,
    );
    const navigationIndex = navigableIds.indexOf(section.id);
    const expectedPrevious =
      section.navigable && navigationIndex > 0
        ? (navigableIds[navigationIndex - 1] ?? null)
        : null;
    const expectedNext =
      section.navigable &&
      navigationIndex >= 0 &&
      navigationIndex < navigableIds.length - 1
        ? (navigableIds[navigationIndex + 1] ?? null)
        : null;
    expectDerivedValue(
      section.previousId,
      expectedPrevious,
      `${sectionPointer}/previousId`,
      "Previous navigable section",
      diagnostics,
    );
    expectDerivedValue(
      section.nextId,
      expectedNext,
      `${sectionPointer}/nextId`,
      "Next navigable section",
      diagnostics,
    );
    expectDerivedValue(
      section.contentHash,
      hashValue(sectionHashBasis(section)),
      `${sectionPointer}/contentHash`,
      "Section content hash",
      diagnostics,
    );
  });

  blockRanges.sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      compareText(left.blockId, right.blockId),
  );
  for (let index = 1; index < blockRanges.length; index += 1) {
    const previous = blockRanges[index - 1];
    const current = blockRanges[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.start < previous.end
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.block_range_overlap",
          pointer,
          `Blocks "${previous.blockId}" and "${current.blockId}" overlap.`,
          "nonOverlappingSourceRanges",
          { previous, current },
        ),
      );
    }
  }

  const expectedRoots = work.sections
    .filter((section) => section.parentId === null)
    .map((section) => section.id);
  expectDerivedValue(
    work.rootSectionIds,
    expectedRoots,
    `${pointer}/rootSectionIds`,
    "Work root section IDs",
    diagnostics,
  );
  const expectedWordCount = work.sections.reduce(
    (total, section) => total + section.wordCount,
    0,
  );
  expectDerivedValue(
    work.wordCount,
    expectedWordCount,
    `${pointer}/wordCount`,
    "Work word count",
    diagnostics,
  );
  expectDerivedValue(
    work.readingMinutes,
    calculateReadingMinutes(expectedWordCount, wordsPerMinute),
    `${pointer}/readingMinutes`,
    "Work reading time",
    diagnostics,
  );
  expectDerivedValue(
    work.contentHash,
    hashValue(workHashBasis(work)),
    `${pointer}/contentHash`,
    "Work content hash",
    diagnostics,
  );
}

function validateEnvelopeCollections(
  envelope: PublicationContentEnvelope,
  indexes: ContentIndexes,
  sourceByPath: ReadonlyMap<string, SourceProvenance>,
  diagnostics: Diagnostic[],
): void {
  const firstIndexById = new Map<string, number>();
  envelope.collections.forEach((collection, index) => {
    const pointer = `/collections/${index}`;
    const firstIndex = firstIndexById.get(collection.id);
    if (firstIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.collection_id_duplicate",
          `${pointer}/id`,
          `Collection ID "${collection.id}" appears more than once.`,
          "uniqueCollectionId",
          { firstIndex, duplicateIndex: index },
        ),
      );
    } else {
      firstIndexById.set(collection.id, index);
    }
    validateStableId(collection.id, `${pointer}/id`, diagnostics);
    validateRoute(collection.route, `${pointer}/route`, diagnostics);
    const source = sourceByPath.get(collection.manifestPath);
    if (
      source?.role !== "collection-manifest" ||
      source.entityId !== collection.id
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.collection_manifest_source_mismatch",
          `${pointer}/manifestPath`,
          `Collection "${collection.id}" has no matching manifest provenance.`,
          "sourceIdentity",
          { source, collectionId: collection.id },
        ),
      );
    }
    const firstWorkIndex = new Map<string, number>();
    collection.workIds.forEach((workId, workIndex) => {
      const first = firstWorkIndex.get(workId);
      if (first !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.envelope.collection_work_duplicate",
            `${pointer}/workIds/${workIndex}`,
            `Collection "${collection.id}" repeats work "${workId}".`,
            "uniqueItems",
            { workId, firstIndex: first, duplicateIndex: workIndex },
          ),
        );
      } else {
        firstWorkIndex.set(workId, workIndex);
      }
      if (!indexes.workById.has(workId)) {
        diagnostics.push(
          diagnostic(
            "content.envelope.collection_work_unknown",
            `${pointer}/workIds/${workIndex}`,
            `Collection "${collection.id}" references unknown work "${workId}".`,
            "knownWork",
            { workId },
          ),
        );
      }
    });
  });
}

function mediaTypeEssence(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function validateEnvelopeAssets(
  envelope: PublicationContentEnvelope,
  indexes: ContentIndexes,
  sourceByPath: ReadonlyMap<string, SourceProvenance>,
  activeRouteOwnerByPath: ReadonlyMap<string, ContentRoute>,
  diagnostics: Diagnostic[],
): void {
  const firstIndexById = new Map<string, number>();
  const firstIndexByHref = new Map<string, number>();
  envelope.assets.forEach((asset, index) => {
    const pointer = `/assets/${index}`;
    validateStableId(asset.id, `${pointer}/id`, diagnostics);
    const firstIdIndex = firstIndexById.get(asset.id);
    if (firstIdIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.asset_id_duplicate",
          `${pointer}/id`,
          `Asset ID "${asset.id}" appears more than once.`,
          "uniqueAssetId",
          { firstIndex: firstIdIndex, duplicateIndex: index },
        ),
      );
    } else {
      firstIndexById.set(asset.id, index);
    }
    validateRoute(asset.href, `${pointer}/href`, diagnostics);
    const firstHrefIndex = firstIndexByHref.get(asset.href);
    if (firstHrefIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.asset_href_duplicate",
          `${pointer}/href`,
          `Asset href "${asset.href}" appears more than once.`,
          "uniqueAssetHref",
          { firstIndex: firstHrefIndex, duplicateIndex: index },
        ),
      );
    } else {
      firstIndexByHref.set(asset.href, index);
    }
    if (activeRouteOwnerByPath.has(asset.href)) {
      diagnostics.push(
        diagnostic(
          "content.envelope.asset_route_collision",
          `${pointer}/href`,
          `Asset href "${asset.href}" collides with an active route.`,
          "disjointPublicTargets",
          { route: activeRouteOwnerByPath.get(asset.href) },
        ),
      );
    }
    const source = sourceByPath.get(asset.sourcePath);
    if (
      source?.role !== "asset" ||
      source.entityId !== asset.workId
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.asset_source_mismatch",
          `${pointer}/sourcePath`,
          `Asset "${asset.id}" has no matching source identity.`,
          "assetOwnership",
          { source, workId: asset.workId },
        ),
      );
    } else {
      expectDerivedValue(
        asset.hash,
        source.rawHash,
        `${pointer}/hash`,
        "Asset source hash",
        diagnostics,
      );
      if (mediaTypeEssence(source.mediaType) !== mediaTypeEssence(asset.mediaType)) {
        diagnostics.push(
          diagnostic(
            "content.envelope.asset_media_type_mismatch",
            `${pointer}/mediaType`,
            `Asset "${asset.id}" media type does not match its source.`,
            "mediaType",
            {
              mediaType: asset.mediaType,
              sourceMediaType: source.mediaType,
            },
          ),
        );
      }
    }
    if (asset.workId !== undefined) {
      const work = indexes.workById.get(asset.workId);
      if (work === undefined) {
        diagnostics.push(
          diagnostic(
            "content.envelope.asset_work_unknown",
            `${pointer}/workId`,
            `Asset "${asset.id}" references unknown work "${asset.workId}".`,
            "knownWork",
            { workId: asset.workId },
          ),
        );
      } else if (
        work.source.assetsPath === undefined ||
        !isPathWithinRoot(asset.sourcePath, work.source.assetsPath)
      ) {
        diagnostics.push(
          diagnostic(
            "content.envelope.asset_outside_work_root",
            `${pointer}/sourcePath`,
            `Asset "${asset.id}" is outside its work asset root.`,
            "assetOwnership",
            {
              sourcePath: asset.sourcePath,
              assetsPath: work.source.assetsPath,
            },
          ),
        );
      }
    } else if (
      !isPathWithinRoot(
        asset.sourcePath,
        envelope.sourceAuthority.sharedAssetsRoot,
      )
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.asset_outside_shared_root",
          `${pointer}/sourcePath`,
          `Shared asset "${asset.id}" is outside the declared shared asset root.`,
          "assetOwnership",
          {
            sourcePath: asset.sourcePath,
            sharedAssetsRoot:
              envelope.sourceAuthority.sharedAssetsRoot,
          },
        ),
      );
    }
  });
}

function spanContains(outer: SourceSpan, inner: SourceSpan): boolean {
  return (
    outer.sourcePath === inner.sourcePath &&
    inner.start.offset >= outer.start.offset &&
    inner.end.offset <= outer.end.offset
  );
}

function validateEnvelopeLinks(
  envelope: PublicationContentEnvelope,
  indexes: ContentIndexes,
  sourceByPath: ReadonlyMap<string, SourceProvenance>,
  diagnostics: Diagnostic[],
): void {
  const assetsById = new Map(
    envelope.assets.map((asset) => [asset.id, asset]),
  );
  const firstIndexById = new Map<string, number>();
  envelope.links.forEach((link, index) => {
    const pointer = `/links/${index}`;
    validateStableId(link.id, `${pointer}/id`, diagnostics);
    const firstIndex = firstIndexById.get(link.id);
    if (firstIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.link_id_duplicate",
          `${pointer}/id`,
          `Link ID "${link.id}" appears more than once.`,
          "uniqueLinkId",
          { firstIndex, duplicateIndex: index },
        ),
      );
    } else {
      firstIndexById.set(link.id, index);
    }
    const sectionKey = `${link.source.workId}\u0000${link.source.sectionId}`;
    const section = indexes.sectionByWorkAndId.get(sectionKey);
    if (section === undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.link_source_unknown",
          `${pointer}/source`,
          `Link "${link.id}" references an unknown source section.`,
          "knownContentLocation",
          { source: link.source },
        ),
      );
    }
    const block =
      link.source.blockId === undefined
        ? undefined
        : indexes.blockByLocation.get(
            `${sectionKey}\u0000${link.source.blockId}`,
          );
    if (link.source.blockId !== undefined && block === undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.link_source_block_unknown",
          `${pointer}/source/blockId`,
          `Link "${link.id}" references an unknown source block.`,
          "knownContentLocation",
          { blockId: link.source.blockId },
        ),
      );
    }
    if (link.source.kind === "source") {
      const occurrence = link.source.occurrence;
      validateEnvelopeSourceSpan(
        occurrence,
        `${pointer}/source/occurrence`,
        sourceByPath,
        diagnostics,
      );
      const candidates =
        block === undefined ? (section?.blocks ?? []) : [block];
      if (
        !candidates.some((candidate) =>
          spanContains(candidate.provenance, occurrence),
        )
      ) {
        diagnostics.push(
          diagnostic(
            "content.envelope.link_occurrence_outside_block",
            `${pointer}/source/occurrence`,
            `Link "${link.id}" occurrence is outside its declared content location.`,
            "contentOccurrence",
            { source: link.source },
          ),
        );
      }
    }
    validateResolvedHref(link.href, `${pointer}/href`, diagnostics);
    if (
      link.target.kind === "external" &&
      !validateAbsoluteHttpUrl(link.target.url)
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.external_link_invalid",
          `${pointer}/target/url`,
          `Link "${link.id}" has an invalid external target.`,
          "absoluteHttpUrl",
          { url: link.target.url },
        ),
      );
    }
    const expectedHref = expectedLinkHref(link, indexes, assetsById);
    if (expectedHref === undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.link_target_unknown",
          `${pointer}/target`,
          `Link "${link.id}" references an unknown target.`,
          "knownLinkTarget",
          { target: link.target },
        ),
      );
    } else {
      expectDerivedValue(
        link.href,
        expectedHref,
        `${pointer}/href`,
        "Resolved link href",
        diagnostics,
      );
    }
  });
}

function validateEnvelopeActiveRoutes(
  envelope: PublicationContentEnvelope,
  diagnostics: Diagnostic[],
): ReadonlyMap<string, ContentRoute> {
  const ownerByPath = new Map<string, ContentRoute>();
  envelope.routes.active.forEach((route, index) => {
    addActiveRoute(
      [],
      ownerByPath,
      route,
      `/routes/active/${index}/path`,
      diagnostics,
    );
  });

  const homeRoutes = envelope.routes.active.filter(
    (route) => route.target.kind === "home",
  );
  if (homeRoutes.length !== 1) {
    diagnostics.push(
      diagnostic(
        "content.envelope.home_route_count",
        "/routes/active",
        "A content envelope must contain exactly one home route.",
        "routeCardinality",
        { actual: homeRoutes.length, expected: 1 },
      ),
    );
  }
  const updateRoutes = envelope.routes.active.filter(
    (route) => route.target.kind === "updates",
  );
  if (updateRoutes.length > 1) {
    diagnostics.push(
      diagnostic(
        "content.envelope.updates_route_count",
        "/routes/active",
        "A content envelope may contain at most one Updates route.",
        "routeCardinality",
        { actual: updateRoutes.length, maximum: 1 },
      ),
    );
  }

  const expected: ContentRoute[] = [];
  if (homeRoutes[0] !== undefined) {
    expected.push(homeRoutes[0]);
  }
  if (updateRoutes[0] !== undefined) {
    expected.push(updateRoutes[0]);
  }
  for (const work of envelope.works) {
    expected.push({
      path: work.route,
      target: { kind: "work", workId: work.id },
    });
    for (const section of work.sections) {
      for (const routeName of section.activeRouteNames) {
        const address = ownContentAddress(section.routes, routeName);
        if (address === undefined || address.anchor !== undefined) {
          continue;
        }
        expected.push({
          path: address.path,
          target: {
            kind: "section",
            workId: work.id,
            sectionId: section.id,
            routeName,
          },
        });
      }
    }
  }
  for (const collection of envelope.collections) {
    expected.push({
      path: collection.route,
      target: {
        kind: "collection",
        collectionId: collection.id,
      },
    });
  }
  expectDerivedValue(
    envelope.routes.active,
    expected,
    "/routes/active",
    "Active route registry",
    diagnostics,
  );
  return ownerByPath;
}

function validateEnvelopeExtensions(
  envelope: PublicationContentEnvelope,
  sourceByPath: ReadonlyMap<string, SourceProvenance>,
  diagnostics: Diagnostic[],
): void {
  const extensionById = new Map<string, CompiledExtension>();
  envelope.extensions.forEach((extension, index) => {
    const pointer = `/extensions/${index}`;
    validateStableId(extension.id, `${pointer}/id`, diagnostics);
    validatePackageName(extension.package, `${pointer}/package`, diagnostics);
    if (!EXACT_SEMVER.test(extension.version)) {
      diagnostics.push(
        diagnostic(
          "content.envelope.extension_version_invalid",
          `${pointer}/version`,
          "Compiled extension versions must be canonical SemVer.",
          "semver",
          { version: extension.version },
        ),
      );
    }
    const first = extensionById.get(extension.id);
    if (first !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.extension_id_duplicate",
          `${pointer}/id`,
          `Extension ID "${extension.id}" appears more than once.`,
          "uniqueExtensionId",
          { id: extension.id },
        ),
      );
    } else {
      extensionById.set(extension.id, extension);
    }
  });

  expectDerivedValue(
    envelope.payloads.map((payload) => payload.id),
    [...envelope.payloads]
      .map((payload) => payload.id)
      .sort(compareText),
    "/payloads",
    "Content payload order",
    diagnostics,
  );

  const firstPayloadIndexById = new Map<string, number>();
  const sourceOwnerByPath = new Map<string, string>();
  const payloadIdsByExtension = new Map<string, string[]>();
  envelope.payloads.forEach((payload, index) => {
    const pointer = `/payloads/${index}`;
    validateStableId(payload.id, `${pointer}/id`, diagnostics);
    validateStableId(
      payload.extensionId,
      `${pointer}/extensionId`,
      diagnostics,
    );
    const firstPayloadIndex = firstPayloadIndexById.get(payload.id);
    if (firstPayloadIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.payload_id_duplicate",
          `${pointer}/id`,
          `Content payload ID "${payload.id}" appears more than once.`,
          "uniquePayloadId",
          { firstIndex: firstPayloadIndex, duplicateIndex: index },
        ),
      );
    } else {
      firstPayloadIndexById.set(payload.id, index);
    }
    if (!extensionById.has(payload.extensionId)) {
      diagnostics.push(
        diagnostic(
          "content.envelope.payload_extension_unknown",
          `${pointer}/extensionId`,
          `Content payload "${payload.id}" names an unknown extension.`,
          "knownExtension",
          { extensionId: payload.extensionId },
        ),
      );
    }
    if (!validateAbsoluteHttpUrl(payload.schema)) {
      diagnostics.push(
        diagnostic(
          "content.envelope.payload_schema_invalid",
          `${pointer}/schema`,
          "Content payload schemas must use an absolute credential-free HTTP URL.",
          "absoluteHttpUrl",
          { schema: payload.schema },
        ),
      );
    }
    expectDerivedValue(
      payload.sourcePaths,
      [...payload.sourcePaths].sort(compareText),
      `${pointer}/sourcePaths`,
      "Content payload source path order",
      diagnostics,
    );

    const firstSourceIndexByPath = new Map<string, number>();
    payload.sourcePaths.forEach((sourcePath, sourceIndex) => {
      const sourcePointer = `${pointer}/sourcePaths/${sourceIndex}`;
      const firstSourceIndex = firstSourceIndexByPath.get(sourcePath);
      if (firstSourceIndex !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.envelope.payload_source_duplicate",
            sourcePointer,
            `Content payload "${payload.id}" repeats source "${sourcePath}".`,
            "uniqueItems",
            { firstIndex: firstSourceIndex, duplicateIndex: sourceIndex },
          ),
        );
      } else {
        firstSourceIndexByPath.set(sourcePath, sourceIndex);
      }
      const firstOwner = sourceOwnerByPath.get(sourcePath);
      if (
        firstOwner !== undefined &&
        firstOwner !== payload.extensionId
      ) {
        diagnostics.push(
          diagnostic(
            "content.envelope.payload_source_owner_collision",
            sourcePointer,
            `Extension source "${sourcePath}" is claimed by more than one extension.`,
            "uniqueSourceOwner",
            {
              firstExtensionId: firstOwner,
              duplicateExtensionId: payload.extensionId,
            },
          ),
        );
      } else {
        sourceOwnerByPath.set(sourcePath, payload.extensionId);
      }
      const source = sourceByPath.get(sourcePath);
      if (
        source?.role !== "extension" ||
        source.entityId !== payload.extensionId
      ) {
        diagnostics.push(
          diagnostic(
            "content.envelope.payload_source_mismatch",
            sourcePointer,
            `Content payload "${payload.id}" has no matching extension source provenance.`,
            "sourceIdentity",
            {
              sourcePath,
              extensionId: payload.extensionId,
              source,
            },
          ),
        );
      }
    });
    expectDerivedValue(
      payload.contentHash,
      hashValue(contentPayloadHashBasis(payload)),
      `${pointer}/contentHash`,
      "Content payload hash",
      diagnostics,
    );
    const payloadIds =
      payloadIdsByExtension.get(payload.extensionId) ?? [];
    payloadIds.push(payload.id);
    payloadIdsByExtension.set(payload.extensionId, payloadIds);
  });

  envelope.extensions.forEach((extension, index) => {
    expectDerivedValue(
      extension.payloadIds,
      payloadIdsByExtension.get(extension.id) ?? [],
      `/extensions/${index}/payloadIds`,
      `Payload IDs for extension "${extension.id}"`,
      diagnostics,
    );
  });
}

function validateEnvelopeSourceCoverage(
  envelope: PublicationContentEnvelope,
  diagnostics: Diagnostic[],
): void {
  const referencedByPath = new Map<
    string,
    { readonly role: SourceProvenance["role"]; readonly entityId?: string }
  >();
  referencedByPath.set(
    envelope.sourceAuthority.publicationManifestPath,
    { role: "publication-manifest" },
  );
  for (const work of envelope.works) {
    referencedByPath.set(work.source.manifestPath, {
      role: "work-manifest",
      entityId: work.id,
    });
    referencedByPath.set(work.source.manuscriptPath, {
      role: "manuscript",
      entityId: work.id,
    });
  }
  for (const collection of envelope.collections) {
    referencedByPath.set(collection.manifestPath, {
      role: "collection-manifest",
      entityId: collection.id,
    });
  }
  for (const asset of envelope.assets) {
    referencedByPath.set(asset.sourcePath, {
      role: "asset",
      ...(asset.workId === undefined ? {} : { entityId: asset.workId }),
    });
  }
  for (const payload of envelope.payloads) {
    for (const sourcePath of payload.sourcePaths) {
      referencedByPath.set(sourcePath, {
        role: "extension",
        entityId: payload.extensionId,
      });
    }
  }

  let publicationManifestCount = 0;
  let declaredPublicationSourceCount = 0;
  envelope.sources.forEach((source, index) => {
    if (source.role === "publication-manifest") {
      publicationManifestCount += 1;
      if (
        source.path ===
        envelope.sourceAuthority.publicationManifestPath
      ) {
        declaredPublicationSourceCount += 1;
      } else {
        diagnostics.push(
          diagnostic(
            "content.envelope.publication_source_path_mismatch",
            `/sources/${index}/path`,
            "Publication manifest provenance must use the declared publication manifest path.",
            "sourceIdentity",
            {
              actual: source.path,
              expected:
                envelope.sourceAuthority.publicationManifestPath,
            },
          ),
        );
      }
      if (source.entityId !== undefined) {
        diagnostics.push(
          diagnostic(
            "content.envelope.publication_source_entity",
            `/sources/${index}/entityId`,
            "Publication manifest provenance must not carry an entity ID.",
            "sourceIdentity",
            { entityId: source.entityId },
          ),
        );
      }
    }
    const expected = referencedByPath.get(source.path);
    if (
      expected === undefined ||
      expected.role !== source.role ||
      expected.entityId !== source.entityId
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.source_unreferenced",
          `/sources/${index}`,
          `Source "${source.path}" is not owned by an envelope entity.`,
          "sourceOwnership",
          { source, expected },
        ),
      );
    }
  });
  if (publicationManifestCount !== 1) {
    diagnostics.push(
      diagnostic(
        "content.envelope.publication_source_count",
        "/sources",
        "A content envelope must contain exactly one publication manifest source.",
        "sourceCardinality",
        { actual: publicationManifestCount, expected: 1 },
      ),
    );
  }
  if (declaredPublicationSourceCount !== 1) {
    diagnostics.push(
      diagnostic(
        "content.envelope.declared_publication_source_count",
        "/sources",
        "A content envelope must contain exactly one publication manifest source at its declared path.",
        "sourceCardinality",
        {
          actual: declaredPublicationSourceCount,
          expected: 1,
          publicationManifestPath:
            envelope.sourceAuthority.publicationManifestPath,
        },
      ),
    );
  }
}

function validateEnvelopePublicationUrls(
  envelope: PublicationContentEnvelope,
  diagnostics: Diagnostic[],
): void {
  for (const [path, value] of [
    ["/publication/canonicalUrl", envelope.publication.canonicalUrl],
    ["/publication/publisher/url", envelope.publication.publisher.url],
    [
      "/publication/attribution/sourceCodeUrl",
      envelope.publication.attribution.sourceCodeUrl,
    ],
  ] as const) {
    if (value !== undefined && !validateAbsoluteHttpUrl(value)) {
      diagnostics.push(
        diagnostic(
          "content.envelope.publication_url_invalid",
          path,
          "Publication URLs must be absolute credential-free HTTP URLs.",
          "absoluteHttpUrl",
          { value },
        ),
      );
    }
  }
}

function validateEnvelopeSourceAuthority(
  envelope: PublicationContentEnvelope,
  diagnostics: Diagnostic[],
): void {
  const {
    outputRoots,
    publicationManifestPath,
    sharedAssetsRoot,
    sourceRoots,
  } = envelope.sourceAuthority;
  diagnostics.push(
    ...validateRepositoryRelativePath(
      publicationManifestPath,
      "/sourceAuthority/publicationManifestPath",
    ),
    ...validateRepositoryRelativePath(
      sharedAssetsRoot,
      "/sourceAuthority/sharedAssetsRoot",
    ),
  );
  const firstSourceRootIndex = new Map<string, number>();
  sourceRoots.forEach((sourceRoot, index) => {
    const firstIndex = firstSourceRootIndex.get(sourceRoot);
    if (firstIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.source_root_duplicate",
          `/sourceAuthority/sourceRoots/${index}`,
          `Source root "${sourceRoot}" appears more than once.`,
          "uniqueItems",
          { firstIndex, duplicateIndex: index },
        ),
      );
    } else {
      firstSourceRootIndex.set(sourceRoot, index);
    }
  });
  const firstOutputRootIndex = new Map<string, number>();
  outputRoots.forEach((outputRoot, index) => {
    const firstIndex = firstOutputRootIndex.get(outputRoot);
    if (firstIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.output_root_duplicate",
          `/sourceAuthority/outputRoots/${index}`,
          `Output root "${outputRoot}" appears more than once.`,
          "uniqueItems",
          { firstIndex, duplicateIndex: index },
        ),
      );
    } else {
      firstOutputRootIndex.set(outputRoot, index);
    }
    sourceRoots.forEach((sourceRoot, sourceIndex) => {
      if (
        isPathWithinRoot(sourceRoot, outputRoot) ||
        isPathWithinRoot(outputRoot, sourceRoot)
      ) {
        diagnostics.push(
          diagnostic(
            "content.envelope.source_output_root_overlap",
            `/sourceAuthority/outputRoots/${index}`,
            `Source root "${sourceRoot}" overlaps output root "${outputRoot}".`,
            "disjointSourceAndOutputRoots",
            { outputRoot, sourceIndex, sourceRoot },
          ),
        );
      }
    });
  });
  if (
    !sourceRoots.some((sourceRoot) =>
      isPathWithinRoot(sharedAssetsRoot, sourceRoot),
    )
  ) {
    diagnostics.push(
      diagnostic(
        "content.envelope.shared_assets_outside_source_roots",
        "/sourceAuthority/sharedAssetsRoot",
        "The shared asset root must be inside a declared source root.",
        "sourceBoundary",
        { sharedAssetsRoot, sourceRoots },
      ),
    );
  }
  if (!outputRoots.includes(envelope.artifact.outputRoot)) {
    diagnostics.push(
      diagnostic(
        "content.envelope.artifact_output_root_unknown",
        "/artifact/outputRoot",
        "The artifact output root must be one of the declared output roots.",
        "outputBoundary",
        {
          outputRoot: envelope.artifact.outputRoot,
          outputRoots,
        },
      ),
    );
  }
  envelope.works.forEach((work, index) => {
    const assetsPath = work.source.assetsPath;
    if (assetsPath === undefined) {
      return;
    }
    diagnostics.push(
      ...validateRepositoryRelativePath(
        assetsPath,
        `/works/${index}/source/assetsPath`,
      ),
    );
    if (
      !sourceRoots.some((sourceRoot) =>
        isPathWithinRoot(assetsPath, sourceRoot),
      )
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.work_assets_outside_source_roots",
          `/works/${index}/source/assetsPath`,
          `Work asset root "${assetsPath}" is outside every declared source root.`,
          "sourceBoundary",
          { assetsPath, sourceRoots, workId: work.id },
        ),
      );
    }
  });
  envelope.sources.forEach((source, index) => {
    if (
      !(
        source.role === "publication-manifest" &&
        source.path === publicationManifestPath
      ) &&
      !sourceRoots.some((sourceRoot) =>
        isPathWithinRoot(source.path, sourceRoot),
      )
    ) {
      diagnostics.push(
        diagnostic(
          "content.envelope.source_outside_boundary",
          `/sources/${index}/path`,
          `Source "${source.path}" is outside every declared source root.`,
          "sourceBoundary",
          { sourcePath: source.path, sourceRoots },
        ),
      );
    }
    const outputRoot = outputRoots.find((root) =>
      isPathWithinRoot(source.path, root),
    );
    if (outputRoot !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.source_inside_output",
          `/sources/${index}/path`,
          `Source "${source.path}" is inside output root "${outputRoot}".`,
          "sourceOutputSeparation",
          { outputRoot, sourcePath: source.path },
        ),
      );
    }
  });
}

function validateEnvelopeSemantics(
  envelope: PublicationContentEnvelope,
): ValidationResult<PublicationContentEnvelope> {
  const diagnostics: Diagnostic[] = [];
  if (!EXACT_SEMVER.test(envelope.engineVersion)) {
    diagnostics.push(
      diagnostic(
        "content.envelope.engine_version_invalid",
        "/engineVersion",
        "Envelope engine version must be canonical SemVer.",
        "semver",
        { version: envelope.engineVersion },
      ),
    );
  }
  if (!EXACT_SEMVER.test(envelope.compilerVersion)) {
    diagnostics.push(
      diagnostic(
        "content.envelope.compiler_version_invalid",
        "/compilerVersion",
        "Envelope compiler version must be canonical SemVer.",
        "semver",
        { version: envelope.compilerVersion },
      ),
    );
  }
  expectDerivedValue(
    envelope.publicationId,
    envelope.publication.id,
    "/publicationId",
    "Publication ID",
    diagnostics,
  );
  validateEnvelopePublicationUrls(envelope, diagnostics);
  validateEnvelopeSourceAuthority(envelope, diagnostics);
  const wordsPerMinute = envelope.statistics.wordsPerMinute;
  if (
    !Number.isInteger(wordsPerMinute) ||
    wordsPerMinute < 1 ||
    wordsPerMinute > 2000
  ) {
    diagnostics.push(
      diagnostic(
        "content.envelope.reading_rate_invalid",
        "/statistics/wordsPerMinute",
        "Envelope reading rate must be an integer from 1 through 2,000.",
        "readingRate",
        { wordsPerMinute },
      ),
    );
  }
  const effectiveWordsPerMinute =
    Number.isInteger(wordsPerMinute) &&
    wordsPerMinute >= 1 &&
    wordsPerMinute <= 2000
      ? wordsPerMinute
      : DEFAULT_WORDS_PER_MINUTE;

  const sourceByPath = validateEnvelopeSources(envelope, diagnostics);
  validateEnvelopeExtensions(envelope, sourceByPath, diagnostics);
  const firstWorkIndexById = new Map<string, number>();
  envelope.works.forEach((work, index) => {
    const firstIndex = firstWorkIndexById.get(work.id);
    if (firstIndex !== undefined) {
      diagnostics.push(
        diagnostic(
          "content.envelope.work_id_duplicate",
          `/works/${index}/id`,
          `Work ID "${work.id}" appears more than once.`,
          "uniqueWorkId",
          { firstIndex, duplicateIndex: index },
        ),
      );
    } else {
      firstWorkIndexById.set(work.id, index);
    }
    validateEnvelopeWork(
      work,
      index,
      effectiveWordsPerMinute,
      sourceByPath,
      diagnostics,
    );
  });
  validateContinuityOwnership(envelope.works, diagnostics);

  const indexes = createIndexes(envelope.works, envelope.collections);
  validateEnvelopeCollections(
    envelope,
    indexes,
    sourceByPath,
    diagnostics,
  );
  const activeRouteOwnerByPath = validateEnvelopeActiveRoutes(
    envelope,
    diagnostics,
  );
  validateCompiledRedirects(
    envelope.routes.redirects,
    activeRouteOwnerByPath,
    diagnostics,
  );
  validateSectionAddressAuthority(
    envelope.works,
    activeRouteOwnerByPath,
    diagnostics,
  );
  validateEnvelopeAssets(
    envelope,
    indexes,
    sourceByPath,
    activeRouteOwnerByPath,
    diagnostics,
  );
  validateAssetRedirectAuthority(
    envelope.assets,
    envelope.routes.redirects,
    diagnostics,
  );
  validateEnvelopeLinks(envelope, indexes, sourceByPath, diagnostics);
  validateEnvelopeSourceCoverage(envelope, diagnostics);

  const sectionCount = envelope.works.reduce(
    (total, work) => total + work.sections.length,
    0,
  );
  const blockCount = envelope.works.reduce(
    (total, work) =>
      total +
      work.sections.reduce(
        (sectionTotal, section) =>
          sectionTotal + section.blocks.length,
        0,
      ),
    0,
  );
  const wordCount = envelope.works.reduce(
    (total, work) => total + work.wordCount,
    0,
  );
  const expectedStatistics = {
    workCount: envelope.works.length,
    collectionCount: envelope.collections.length,
    sectionCount,
    blockCount,
    wordCount,
    readingMinutes: calculateReadingMinutes(
      wordCount,
      effectiveWordsPerMinute,
    ),
    wordsPerMinute: effectiveWordsPerMinute,
  };
  expectDerivedValue(
    envelope.statistics,
    expectedStatistics,
    "/statistics",
    "Publication statistics",
    diagnostics,
  );
  expectDerivedValue(
    envelope.hashes.content,
    hashValue(envelopeContentHashBasis(envelope)),
    "/hashes/content",
    "Envelope content hash",
    diagnostics,
  );
  expectDerivedValue(
    envelope.buildId,
    hashValue(envelopeBuildHashBasis(envelope)),
    "/buildId",
    "Envelope build ID",
    diagnostics,
  );

  if (diagnostics.length > 0) {
    return immutableSnapshot({
      valid: false,
      diagnostics: sortDiagnostics(diagnostics),
    });
  }
  return immutableSnapshot({
    valid: true,
    value: envelope,
    diagnostics: [],
  });
}

/**
 * Compiles one complete in-memory publication snapshot. The function performs
 * no filesystem, network, Git, environment, process, or clock access.
 */
export function compilePublicationContent(
  input: CompilePublicationContentInput,
): ValidationResult<PublicationContentEnvelope> {
  try {
    return compilePublicationContentInternal(input);
  } catch {
    return immutableSnapshot({
      valid: false,
      diagnostics: [
        diagnostic(
          "content.compile_failed",
          "",
          "Content compilation could not safely inspect the supplied input.",
          "compilation",
          { reason: "uninspectableInput" },
        ),
      ],
    });
  }
}

export function validatePublicationContentEnvelope(
  value: unknown,
): ValidationResult<PublicationContentEnvelope> {
  try {
    const shapeResult = validateContentEnvelopeShape(value);
    if (!shapeResult.valid) {
      return shapeResult;
    }
    return validateEnvelopeSemantics(shapeResult.value);
  } catch {
    return immutableSnapshot({
      valid: false,
      diagnostics: [
        diagnostic(
          "content.envelope.validation_failed",
          "",
          "Content envelope validation could not safely inspect the supplied value.",
          "semanticValidation",
          { reason: "uninspectableEnvelope" },
        ),
      ],
    });
  }
}

export function serializePublicationContentEnvelope(
  envelope: PublicationContentEnvelope,
): string {
  const validation = validatePublicationContentEnvelope(envelope);
  if (!validation.valid) {
    throw new TypeError(
      `Cannot serialize an invalid content envelope: ${validation.diagnostics
        .map((item) => `${item.path || "/"} ${item.message}`)
        .join("; ")}`,
    );
  }
  return `${canonicalizeJson(asJson(envelope))}\n`;
}

export function createPublicationContentArtifact(
  envelope: PublicationContentEnvelope,
): PublicationContentArtifact {
  const text = serializePublicationContentEnvelope(envelope);
  return immutableSnapshot({
    outputRoot: envelope.artifact.outputRoot,
    relativePath: envelope.artifact.relativePath,
    mediaType: envelope.artifact.mediaType,
    text,
    hash: sha256(text),
    envelope,
  });
}
