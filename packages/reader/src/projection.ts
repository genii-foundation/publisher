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
  READER_ARTIFACT_KIND,
  READER_ARTIFACT_MEDIA_TYPE,
  READER_ARTIFACT_RELATIVE_PATH,
  READER_ENVELOPE_SCHEMA_URL,
  READER_SCHEMA_VERSION,
  READER_TEXT_PROFILE,
  type CompiledSection,
  type CompiledWork,
  type ContentAddress,
  type ContentLinkTarget,
  type ContentRoute,
  type Diagnostic,
  type PublicationContentEnvelope,
  type PublicationReaderEnvelope,
  type ReaderBlock,
  type ReaderCollection,
  type ReaderLink,
  type ReaderLinkLocation,
  type ReaderSection,
  type ReaderWork,
  type ResolvedContentLink,
  type ValidationResult,
} from "@genii-foundation/publisher-schema";
import {
  canonicalizeJson,
  sha256,
  validatePublicationContentEnvelope,
} from "@genii-foundation/publisher-content";

import { diagnostic, sortDiagnostics } from "./diagnostics.js";
import {
  calculateReaderBlockContentHash,
  calculateReaderBuildId,
  calculateReaderSectionContentHash,
  calculateReaderWorkContentHash,
} from "./identity.js";
import { immutableSnapshot } from "./immutability.js";
import {
  READER_PROJECTOR_VERSION,
  type ProjectPublicationReaderOptions,
  type PublicationReaderArtifact,
} from "./types.js";
import { validatePublicationReaderEnvelope } from "./validation.js";

const EMPTY_DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";

function cloneAddress(address: ContentAddress): ContentAddress {
  return {
    path: address.path,
    ...(address.anchor === undefined
      ? {}
      : { anchor: address.anchor }),
  };
}

function cloneTarget(target: ContentLinkTarget): ContentLinkTarget {
  switch (target.kind) {
    case "asset":
      return { kind: "asset", assetId: target.assetId };
    case "collection":
      return { kind: "collection", collectionId: target.collectionId };
    case "external":
      return { kind: "external", url: target.url };
    case "section":
      return {
        kind: "section",
        workId: target.workId,
        sectionId: target.sectionId,
        routeName: target.routeName,
      };
    case "work":
      return { kind: "work", workId: target.workId };
  }
}

function cloneRoute(route: ContentRoute): ContentRoute {
  switch (route.target.kind) {
    case "home":
      return { path: route.path, target: { kind: "home" } };
    case "updates":
      return { path: route.path, target: { kind: "updates" } };
    case "work":
      return {
        path: route.path,
        target: {
          kind: "work",
          workId: route.target.workId,
        },
      };
    case "collection":
      return {
        path: route.path,
        target: {
          kind: "collection",
          collectionId: route.target.collectionId,
        },
      };
    case "section":
      return {
        path: route.path,
        target: {
          kind: "section",
          workId: route.target.workId,
          sectionId: route.target.sectionId,
          routeName: route.target.routeName,
        },
      };
  }
}

function projectBlock(
  sectionAddress: ContentAddress | null,
  block: CompiledSection["blocks"][number],
): ReaderBlock {
  const readerAddress =
    sectionAddress === null
      ? null
      : {
          path: sectionAddress.path,
          anchor:
            sectionAddress.anchor === undefined
              ? block.anchor
              : `${sectionAddress.anchor}-${block.anchor}`,
        };
  return {
    id: block.id,
    kind: block.kind,
    markdown: block.markdown,
    text: block.text,
    readerAddress,
    domId: readerAddress?.anchor ?? null,
    wordCount: block.wordCount,
    contentHash: calculateReaderBlockContentHash(block),
  };
}

function projectSection(section: CompiledSection): ReaderSection {
  const readerAddress =
    section.readerAddress === null
      ? null
      : cloneAddress(section.readerAddress);
  const blocks = section.blocks.map((block) =>
    projectBlock(readerAddress, block),
  );
  return {
    id: section.id,
    role: section.role,
    title: section.title,
    parentId: section.parentId,
    childIds: [...section.childIds],
    depth: section.depth,
    order: section.order,
    routes: Object.fromEntries(
      Object.entries(section.routes).map(([name, address]) => [
        name,
        cloneAddress(address),
      ]),
    ),
    activeRouteNames: [...section.activeRouteNames],
    readerAddress,
    domId: readerAddress?.anchor ?? null,
    continuity: {
      id: section.continuity.id,
      legacyIds: [...section.continuity.legacyIds],
      progressGroups: section.continuity.progressGroups.map(
        (group) => [...group],
      ),
      historicalSectionIds: [
        ...section.continuity.historicalSectionIds,
      ],
    },
    navigable: section.navigable,
    blocks,
    previousId: section.previousId,
    nextId: section.nextId,
    wordCount: section.wordCount,
    readingMinutes: section.readingMinutes,
    contentHash: calculateReaderSectionContentHash({
      role: section.role,
      title: section.title,
      blocks,
    }),
  };
}

function projectWork(work: CompiledWork): ReaderWork {
  const sections = work.sections.map(projectSection);
  return {
    id: work.id,
    title: work.title,
    ...(work.subtitle === undefined
      ? {}
      : { subtitle: work.subtitle }),
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
    rootSectionIds: [...work.rootSectionIds],
    sections,
    wordCount: work.wordCount,
    readingMinutes: work.readingMinutes,
    contentHash: calculateReaderWorkContentHash({
      title: work.title,
      ...(work.subtitle === undefined
        ? {}
        : { subtitle: work.subtitle }),
      ...(work.summary === undefined
        ? {}
        : { summary: work.summary }),
      language: work.language,
      sections,
    }),
  };
}

type ProjectionAudienceInspection =
  | {
      readonly valid: true;
      readonly audience: ProjectPublicationReaderOptions["audience"];
    }
  | {
      readonly valid: false;
      readonly observed: unknown;
    };

function inspectProjectionAudience(
  value: unknown,
): ProjectionAudienceInspection {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, observed: undefined };
  }
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      return { valid: false, observed: undefined };
    }
    const hasOwnAudience = ownKeys.includes("audience");
    const descriptor = Reflect.getOwnPropertyDescriptor(value, "audience");
    const hasAudience = Reflect.has(value, "audience");
    if (
      !hasOwnAudience ||
      !hasAudience ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return {
        valid: false,
        observed:
          descriptor !== undefined && "value" in descriptor
            ? descriptor.value
            : undefined,
      };
    }
    const audience = descriptor.value;
    return audience === "public" || audience === "preview"
      ? { valid: true, audience }
      : { valid: false, observed: audience };
  } catch {
    return { valid: false, observed: undefined };
  }
}

function shouldRetainState(
  state: CompiledWork["publicationState"],
  audience: ProjectPublicationReaderOptions["audience"],
): boolean {
  return audience === "preview" || state !== "draft";
}

function shouldRetainRoute(
  route: ContentRoute,
  retainedWorkIds: ReadonlySet<string>,
  retainedCollectionIds: ReadonlySet<string>,
): boolean {
  switch (route.target.kind) {
    case "home":
    case "updates":
      return true;
    case "work":
    case "section":
      return retainedWorkIds.has(route.target.workId);
    case "collection":
      return retainedCollectionIds.has(route.target.collectionId);
  }
}

function validateRetainedAddressBases(
  works: readonly ReaderWork[],
  retainedActivePaths: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): void {
  works.forEach((work, workIndex) => {
    work.sections.forEach((section, sectionIndex) => {
      const addresses = [
        ...Object.entries(section.routes).map(([name, address]) => ({
          name,
          address,
          path: `/works/${workIndex}/sections/${sectionIndex}/routes/${name}/path`,
        })),
        ...(section.readerAddress === null
          ? []
          : [
              {
                name: "readerAddress",
                address: section.readerAddress,
                path: `/works/${workIndex}/sections/${sectionIndex}/readerAddress/path`,
              },
            ]),
      ];
      for (const item of addresses) {
        if (!retainedActivePaths.has(item.address.path)) {
          diagnostics.push(
            diagnostic(
              "reader.address.base_route_excluded",
              item.path,
              `Retained section address "${item.name}" depends on an excluded base route.`,
              "retainedActiveRoute",
              {
                route: item.address.path,
                sectionId: section.id,
                workId: work.id,
              },
            ),
          );
        }
      }
    });
  });
}

function projectRedirects(
  envelope: PublicationContentEnvelope,
  retainedActivePaths: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): PublicationReaderEnvelope["routes"]["redirects"] {
  const activePaths = new Set(
    envelope.routes.active.map(({ path }) => path),
  );
  const redirectBySource = new Map(
    envelope.routes.redirects.map((redirect) => [
      redirect.from,
      redirect,
    ]),
  );
  const memo = new Map<
    string,
    { readonly kind: "active" | "external"; readonly terminal: string } | null
  >();

  const resolveTerminal = (
    source: string,
  ): { readonly kind: "active" | "external"; readonly terminal: string } | null => {
    const cached = memo.get(source);
    if (cached !== undefined) {
      return cached;
    }
    const seen = new Set<string>();
    const visited: string[] = [];
    let cursor = source;
    let resolution:
      | { readonly kind: "active" | "external"; readonly terminal: string }
      | null = null;
    while (resolution === null) {
      if (activePaths.has(cursor)) {
        resolution = { kind: "active", terminal: cursor };
        break;
      }
      if (seen.has(cursor)) {
        diagnostics.push(
          diagnostic(
            "reader.redirect.resolution_invalid",
            "/routes/redirects",
            "A redirect chain contains a cycle after content validation.",
            "acyclicRedirects",
            { source },
          ),
        );
        break;
      }
      seen.add(cursor);
      visited.push(cursor);
      const redirect = redirectBySource.get(cursor);
      if (redirect === undefined) {
        diagnostics.push(
          diagnostic(
            "reader.redirect.resolution_invalid",
            "/routes/redirects",
            "A redirect chain has no active or external terminal after content validation.",
            "resolvedRedirect",
            { source, terminal: cursor },
          ),
        );
        break;
      }
      if (!redirect.to.startsWith("/")) {
        resolution = { kind: "external", terminal: redirect.to };
        break;
      }
      cursor = redirect.to;
    }
    for (const visitedSource of visited) {
      memo.set(visitedSource, resolution);
    }
    return resolution;
  };

  return envelope.routes.redirects
    .filter((redirect) => {
      const terminal = resolveTerminal(redirect.from);
      return (
        terminal?.kind === "external" ||
        (terminal?.kind === "active" &&
          retainedActivePaths.has(terminal.terminal))
      );
    })
    .map((redirect) => ({
      from: redirect.from,
      to: redirect.to,
      status: redirect.status,
    }));
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

function projectSourceLinkLocation(
  envelope: PublicationContentEnvelope,
  link: ResolvedContentLink,
  linkIndex: number,
  diagnostics: Diagnostic[],
): ReaderLinkLocation | undefined {
  if (link.source.kind === "semantic") {
    return {
      kind: "semantic",
      workId: link.source.workId,
      sectionId: link.source.sectionId,
      ...(link.source.blockId === undefined
        ? {}
        : { blockId: link.source.blockId }),
    };
  }

  const work = envelope.works.find(
    ({ id }) => id === link.source.workId,
  );
  const section = work?.sections.find(
    ({ id }) => id === link.source.sectionId,
  );
  const occurrence = link.source.occurrence;
  const candidates =
    section?.blocks.filter(
      (block) =>
        (link.source.blockId === undefined ||
          block.id === link.source.blockId) &&
        block.provenance.sourcePath === occurrence.sourcePath &&
        occurrence.start.offset >= block.provenance.start.offset &&
        occurrence.end.offset <= block.provenance.end.offset,
    ) ?? [];
  if (candidates.length === 0) {
    diagnostics.push(
      diagnostic(
        "reader.link.occurrence_block_missing",
        `/links/${linkIndex}/source/occurrence`,
        "A source-backed link occurrence is not contained by one projected Markdown block.",
        "containingMarkdownBlock",
        {
          linkId: link.id,
          sectionId: link.source.sectionId,
          workId: link.source.workId,
        },
      ),
    );
    return undefined;
  }
  if (candidates.length !== 1) {
    diagnostics.push(
      diagnostic(
        "reader.link.occurrence_block_ambiguous",
        `/links/${linkIndex}/source/occurrence`,
        "A source-backed link occurrence is contained by more than one projected Markdown block.",
        "uniqueContainingMarkdownBlock",
        {
          blockIds: candidates.map(({ id }) => id),
          linkId: link.id,
        },
      ),
    );
    return undefined;
  }

  const block = candidates[0];
  if (block === undefined) {
    return undefined;
  }
  const start =
    occurrence.start.offset - block.provenance.start.offset;
  const end = occurrence.end.offset - block.provenance.start.offset;
  if (
    start < 0 ||
    end <= start ||
    end > block.markdown.length ||
    splitsSurrogatePair(block.markdown, start) ||
    splitsSurrogatePair(block.markdown, end)
  ) {
    diagnostics.push(
      diagnostic(
        "reader.link.occurrence_range_invalid",
        `/links/${linkIndex}/source/occurrence`,
        "A source-backed link occurrence does not form a valid UTF-16 range in the projected block Markdown.",
        "blockMarkdownRange",
        {
          blockId: block.id,
          end,
          linkId: link.id,
          markdownLength: block.markdown.length,
          start,
        },
      ),
    );
    return undefined;
  }
  return {
    kind: "block-markdown",
    workId: link.source.workId,
    sectionId: link.source.sectionId,
    blockId: block.id,
    range: { start, end },
  };
}

function targetIsRetained(
  target: ContentLinkTarget,
  retainedWorkIds: ReadonlySet<string>,
  retainedCollectionIds: ReadonlySet<string>,
  retainedAssetIds: ReadonlySet<string>,
): boolean {
  switch (target.kind) {
    case "external":
      return true;
    case "asset":
      return retainedAssetIds.has(target.assetId);
    case "collection":
      return retainedCollectionIds.has(target.collectionId);
    case "work":
    case "section":
      return retainedWorkIds.has(target.workId);
  }
}

function projectLinks(
  envelope: PublicationContentEnvelope,
  retainedWorkIds: ReadonlySet<string>,
  retainedCollectionIds: ReadonlySet<string>,
  retainedAssetIds: ReadonlySet<string>,
  diagnostics: Diagnostic[],
): readonly ReaderLink[] {
  const projected: ReaderLink[] = [];
  envelope.links.forEach((link, linkIndex) => {
    if (!retainedWorkIds.has(link.source.workId)) {
      return;
    }
    if (
      !targetIsRetained(
        link.target,
        retainedWorkIds,
        retainedCollectionIds,
        retainedAssetIds,
      )
    ) {
      if (link.source.kind === "source") {
        diagnostics.push(
          diagnostic(
            "reader.link.target_excluded",
            `/links/${linkIndex}/target`,
            "A link embedded in retained Markdown targets content excluded from this audience.",
            "retainedLinkTarget",
            {
              linkId: link.id,
              targetKind: link.target.kind,
            },
          ),
        );
      }
      return;
    }
    const source = projectSourceLinkLocation(
      envelope,
      link,
      linkIndex,
      diagnostics,
    );
    if (source === undefined) {
      return;
    }
    projected.push({
      id: link.id,
      source,
      target: cloneTarget(link.target),
      href: link.href,
      ...(link.label === undefined ? {} : { label: link.label }),
      ...(link.relation === undefined
        ? {}
        : { relation: link.relation }),
    });
  });
  return projected;
}

function mapInputDiagnostics(
  prefix: "output" | "source",
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return diagnostics.map((item) => ({
    ...item,
    code: `reader.${prefix}.${item.code}`,
  }));
}

function projectPublicationReaderInternal(
  value: unknown,
  options: ProjectPublicationReaderOptions,
): ValidationResult<PublicationReaderEnvelope> {
  const sourceValidation = validatePublicationContentEnvelope(value);
  if (!sourceValidation.valid) {
    return immutableSnapshot({
      valid: false,
      diagnostics: sortDiagnostics(
        mapInputDiagnostics("source", sourceValidation.diagnostics),
      ),
    });
  }
  const audienceInspection = inspectProjectionAudience(options);
  if (!audienceInspection.valid) {
    return immutableSnapshot({
      valid: false,
      diagnostics: [
        diagnostic(
          "reader.audience.invalid",
          "/audience",
          'Reader projection audience must be exactly "public" or "preview".',
          "enum",
          { audience: audienceInspection.observed },
        ),
      ],
    });
  }
  const { audience } = audienceInspection;

  const source = sourceValidation.value;
  const retainedWorks = source.works.filter(({ publicationState }) =>
    shouldRetainState(publicationState, audience),
  );
  const retainedWorkIds = new Set(retainedWorks.map(({ id }) => id));
  const retainedCollections = source.collections.filter(
    ({ publicationState }) =>
      shouldRetainState(
        publicationState ?? "published",
        audience,
      ),
  );
  const retainedCollectionIds = new Set(
    retainedCollections.map(({ id }) => id),
  );
  const works = retainedWorks.map(projectWork);
  const collections: readonly ReaderCollection[] =
    retainedCollections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      ...(collection.description === undefined
        ? {}
        : { description: collection.description }),
      publicationState: collection.publicationState ?? "published",
      route: collection.route,
      workIds: collection.workIds.filter((workId) =>
        retainedWorkIds.has(workId),
      ),
    }));
  const assets = source.assets
    .filter(
      ({ workId }) =>
        workId === undefined || retainedWorkIds.has(workId),
    )
    .map((asset) => ({
      id: asset.id,
      ...(asset.workId === undefined
        ? {}
        : { workId: asset.workId }),
      href: asset.href,
      mediaType: asset.mediaType,
      hash: asset.hash,
    }));
  const retainedAssetIds = new Set(assets.map(({ id }) => id));
  const activeRoutes = source.routes.active
    .filter((route) =>
      shouldRetainRoute(
        route,
        retainedWorkIds,
        retainedCollectionIds,
      ),
    )
    .map(cloneRoute);
  const retainedActivePaths = new Set(
    activeRoutes.map(({ path }) => path),
  );
  const diagnostics: Diagnostic[] = [];
  validateRetainedAddressBases(
    works,
    retainedActivePaths,
    diagnostics,
  );
  const redirects = projectRedirects(
    source,
    retainedActivePaths,
    diagnostics,
  );
  const links = projectLinks(
    source,
    retainedWorkIds,
    retainedCollectionIds,
    retainedAssetIds,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return immutableSnapshot({
      valid: false,
      diagnostics: sortDiagnostics(diagnostics),
    });
  }

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
  const wordsPerMinute = source.statistics.wordsPerMinute;
  const readingMinutes =
    wordCount === 0 ? 0 : Math.ceil(wordCount / wordsPerMinute);
  const draft: PublicationReaderEnvelope = {
    $schema: READER_ENVELOPE_SCHEMA_URL,
    schemaVersion: READER_SCHEMA_VERSION,
    publicationId: source.publicationId,
    engineVersion: source.engineVersion,
    readerVersion: READER_PROJECTOR_VERSION,
    buildId: EMPTY_DIGEST,
    source: {
      kind: "publication-content",
      schemaVersion: source.schemaVersion,
      publicationId: source.publicationId,
      engineVersion: source.engineVersion,
      compilerVersion: source.compilerVersion,
      buildId: source.buildId,
      contentHash: source.hashes.content,
    },
    artifact: {
      kind: READER_ARTIFACT_KIND,
      mediaType: READER_ARTIFACT_MEDIA_TYPE,
      relativePath: READER_ARTIFACT_RELATIVE_PATH,
    },
    audience,
    textProfile: READER_TEXT_PROFILE,
    publication: {
      id: source.publication.id,
      title: source.publication.title,
      ...(source.publication.description === undefined
        ? {}
        : { description: source.publication.description }),
      language: source.publication.language,
      ...(source.publication.canonicalUrl === undefined
        ? {}
        : { canonicalUrl: source.publication.canonicalUrl }),
      publisher: {
        name: source.publication.publisher.name,
        ...(source.publication.publisher.url === undefined
          ? {}
          : { url: source.publication.publisher.url }),
      },
      attribution: {
        placement: source.publication.attribution.placement,
        copyright: source.publication.attribution.copyright,
        text: source.publication.attribution.text,
        url: source.publication.attribution.url,
        sourceCodeUrl:
          source.publication.attribution.sourceCodeUrl,
      },
    },
    works,
    collections,
    assets,
    links,
    routes: {
      active: activeRoutes,
      redirects,
    },
    statistics: {
      workCount: works.length,
      collectionCount: collections.length,
      sectionCount,
      blockCount,
      wordCount,
      readingMinutes,
      wordsPerMinute,
    },
  };
  const envelope: PublicationReaderEnvelope = {
    ...draft,
    buildId: calculateReaderBuildId(draft),
  };
  const outputValidation =
    validatePublicationReaderEnvelope(envelope);
  if (!outputValidation.valid) {
    return immutableSnapshot({
      valid: false,
      diagnostics: sortDiagnostics(
        mapInputDiagnostics(
          "output",
          outputValidation.diagnostics,
        ),
      ),
    });
  }
  return outputValidation;
}

/**
 * Projects one validated content snapshot into an audience-specific reader
 * envelope. The function performs no filesystem, network, Git, environment,
 * process, clock, or randomness access.
 */
export function projectPublicationReader(
  value: unknown,
  options: ProjectPublicationReaderOptions,
): ValidationResult<PublicationReaderEnvelope> {
  try {
    return projectPublicationReaderInternal(value, options);
  } catch {
    return immutableSnapshot({
      valid: false,
      diagnostics: [
        diagnostic(
          "reader.projection_failed",
          "",
          "Reader projection could not safely inspect the supplied input.",
          "projection",
          { reason: "uninspectableInput" },
        ),
      ],
    });
  }
}

function requireValidReaderEnvelope(
  envelope: PublicationReaderEnvelope,
): PublicationReaderEnvelope {
  const validation = validatePublicationReaderEnvelope(envelope);
  if (!validation.valid) {
    throw new TypeError(
      `Cannot serialize an invalid reader envelope: ${validation.diagnostics
        .map((item) => `${item.path || "/"} ${item.message}`)
        .join("; ")}`,
    );
  }
  return validation.value;
}

function serializeValidatedReaderEnvelope(
  envelope: PublicationReaderEnvelope,
): string {
  return `${canonicalizeJson(
    envelope as unknown as Parameters<typeof canonicalizeJson>[0],
  )}\n`;
}

export function serializePublicationReaderEnvelope(
  envelope: PublicationReaderEnvelope,
): string {
  return serializeValidatedReaderEnvelope(
    requireValidReaderEnvelope(envelope),
  );
}

export function createPublicationReaderArtifact(
  envelope: PublicationReaderEnvelope,
): PublicationReaderArtifact {
  const validatedEnvelope = requireValidReaderEnvelope(envelope);
  const text = serializeValidatedReaderEnvelope(validatedEnvelope);
  return Object.freeze({
    relativePath: validatedEnvelope.artifact.relativePath,
    mediaType: validatedEnvelope.artifact.mediaType,
    text,
    hash: sha256(text),
    envelope: validatedEnvelope,
  });
}
