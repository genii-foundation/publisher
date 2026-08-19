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
  canonicalizeJson,
  hashCanonicalJson,
  sha256,
} from "@genii-foundation/publisher-content";
import {
  validatePublicationReaderEnvelope,
} from "@genii-foundation/publisher-reader";
import {
  createReaderOfflineCatalog,
  serializeReaderOfflineCatalog,
} from "@genii-foundation/publisher-reader/offline";
import {
  parseReaderNarrationEnvelope,
  type ReaderNarrationEnvelope,
} from "@genii-foundation/publisher-reader/narration";
import {
  applyReaderLinksToMarkdown,
  type ReaderBlockMarkdownLink,
} from "@genii-foundation/publisher-reader/markdown";
import type {
  ContentRoute,
  Diagnostic,
  ExtensionCapability,
  JSONValue,
  PublicationReaderEnvelope,
  ReaderBlock,
  ReaderCollection,
  ReaderSection,
  ReaderWork,
  Sha256Digest,
  ValidationResult,
} from "@genii-foundation/publisher-schema";
import {
  validateAudioEnvelopeShape,
  validateSyncEnvelopeShape,
  validateUpdatesEnvelopeShape,
} from "@genii-foundation/publisher-schema";
import type { SyncEnvelope } from "@genii-foundation/publisher-schema";
import type { Metadata, NextConfig } from "next";
import { notFound } from "next/navigation.js";
import {
  satisfies,
  valid,
  validRange,
} from "semver";
import type {
  ReactElement,
} from "react";

import {
  PublisherNotFoundView,
  PublisherPageView,
} from "../components/pages.js";
import {
  PublisherReaderNarrationProvider,
} from "../client/reader-narration-provider.js";
import {
  PublisherReaderOfflineProvider,
} from "../client/reader-offline-provider.js";
import type {
  PublisherNextMarkdownForBlock,
} from "../components/pages.js";
import {
  createPublisherNextConfig,
} from "../config.js";
import {
  createPublisherNextErrorIdentity,
} from "../error-identity.js";
import {
  createPublisherNextContinuityHandler,
} from "../continuity.js";
import type {
  PublisherNextContinuityHandler,
} from "../continuity.js";
import {
  createPublisherNextRoutePlan,
  type PublisherNextRoutePlan,
} from "../routes.js";
import {
  resolveDefaultPublisherNextTheme,
} from "../theme/default.js";
import { publisherNextThemeStyle } from "../theme/style.js";
import {
  validatePublisherNextThemeInstance,
} from "../theme/validation.js";
import {
  PUBLISHER_NEXT_APPLICATION_ARTIFACT_KIND,
  PUBLISHER_NEXT_APPLICATION_ARTIFACT_MEDIA_TYPE,
  PUBLISHER_NEXT_APPLICATION_ARTIFACT_RELATIVE_PATH,
  PUBLISHER_NEXT_APPLICATION_SCHEMA_URL,
  PUBLISHER_NEXT_APPLICATION_SCHEMA_VERSION,
  PUBLISHER_NEXT_EXTENSION_API_VERSION,
  PUBLISHER_NEXT_EXTENSION_SLOTS,
  PUBLISHER_NEXT_THEME_API_VERSION,
  PUBLISHER_NEXT_UPDATES_API_VERSION,
  PUBLISHER_NEXT_VERSION,
} from "../types.js";
import type {
  CreatePublicationNextApplicationOptions,
  PublicationNextApplication,
  PublisherNextApplicationArtifact,
  PublisherNextApplicationManifest,
  PublisherNextExtensionPageContext,
  PublisherNextExtensionRenderer,
  PublisherNextExtensionSlot,
  PublisherNextJsonObject,
  PublisherNextPage,
  PublisherNextRouteResolution,
  PublisherNextRootLayoutProps,
  PublisherNextThemeInstance,
  PublisherNextUpdatesEntry,
  PublisherNextUpdatesInstance,
  PublisherNextUpdatesPage,
  PublisherNextUpdatesView,
  ResolvedPublisherNextTheme,
  ResolvedPublisherNextUpdates,
} from "../types.js";

const PACKAGE_NAME =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const UPDATE_ID = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,127}$/u;
const UPDATE_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const UPDATE_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
interface InspectedRecord {
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
}

interface ResolvedThemeState {
  readonly identity: {
    readonly package: string;
    readonly version: string;
    readonly rendererCompatibility: string;
  };
  readonly config: PublisherNextJsonObject;
  readonly configHash: ReturnType<typeof hashCanonicalJson>;
  readonly instance: PublisherNextThemeInstance;
  readonly tokensHash: ReturnType<typeof hashCanonicalJson>;
}

interface ConfiguredUpdatesState {
  readonly identity: {
    readonly package: string;
    readonly version: string;
    readonly rendererCompatibility: string;
  };
  readonly config: PublisherNextJsonObject;
  readonly configHash: ReturnType<typeof hashCanonicalJson>;
  readonly instance: PublisherNextUpdatesInstance;
}

interface ResolvedUpdatesState extends ConfiguredUpdatesState {
  readonly views: ReadonlyMap<string, PublisherNextUpdatesView>;
  readonly viewHash: ReturnType<typeof hashCanonicalJson>;
}

interface ResolvedExtensionEntry {
  readonly id: string;
  readonly package: string;
  readonly version: string;
  readonly capabilities: readonly ExtensionCapability[];
  readonly projectionHash: Sha256Digest;
  readonly renderer: PublisherNextExtensionRenderer | null;
  readonly serverData?: JSONValue;
}

interface ResolvedExtensionsState {
  readonly schemaVersion: "1.0";
  readonly buildId: Sha256Digest;
  readonly entries: readonly ResolvedExtensionEntry[];
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>> = {},
): Diagnostic {
  return Object.freeze({
    code,
    severity: "error",
    path,
    message,
    keyword,
    params: Object.freeze({ ...params }),
  });
}

function failure<T>(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>> = {},
): ValidationResult<T> {
  return Object.freeze({
    valid: false,
    diagnostics: Object.freeze([
      diagnostic(code, path, message, keyword, params),
    ]),
  });
}

function success<T>(value: T): ValidationResult<T> {
  return Object.freeze({
    valid: true,
    value,
    diagnostics: Object.freeze([]),
  });
}

function readerBlockKey(
  workId: string,
  sectionId: string,
  blockId: string,
): string {
  return JSON.stringify([workId, sectionId, blockId]);
}

function prepareReaderMarkdown(
  reader: PublicationReaderEnvelope,
): ValidationResult<PublisherNextMarkdownForBlock> {
  const linksByBlock = new Map<
    string,
    ReaderBlockMarkdownLink[]
  >();
  for (const link of reader.links) {
    if (link.source.kind !== "block-markdown") {
      continue;
    }
    const key = readerBlockKey(
      link.source.workId,
      link.source.sectionId,
      link.source.blockId,
    );
    const grouped = linksByBlock.get(key) ?? [];
    grouped.push(link as ReaderBlockMarkdownLink);
    linksByBlock.set(key, grouped);
  }

  const linkedMarkdown = new Map<string, string>();
  const visitedKeys = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  reader.works.forEach((work, workIndex) => {
    work.sections.forEach((section, sectionIndex) => {
      section.blocks.forEach((block, blockIndex) => {
        const key = readerBlockKey(
          work.id,
          section.id,
          block.id,
        );
        const links = linksByBlock.get(key);
        if (links === undefined) {
          return;
        }
        visitedKeys.add(key);
        const applied = applyReaderLinksToMarkdown(
          block,
          links,
        );
        if (!applied.valid) {
          diagnostics.push(
            diagnostic(
              "next.markdown.reader_link_unrepresentable",
              `/works/${workIndex}/sections/${sectionIndex}/blocks/${blockIndex}/markdown`,
              "The renderer cannot apply this block's source-backed ReaderLinks without changing its Markdown meaning.",
              "representableReaderLinks",
              {
                blockId: block.id,
                linkIds: links.map(({ id }) => id),
                readerDiagnosticCodes: applied.diagnostics.map(
                  ({ code }) => code,
                ),
                sectionId: section.id,
                workId: work.id,
              },
            ),
          );
          return;
        }
        linkedMarkdown.set(key, applied.value);
      });
    });
  });
  for (const [key, links] of linksByBlock) {
    if (visitedKeys.has(key)) {
      continue;
    }
    diagnostics.push(
      diagnostic(
        "next.markdown.reader_link_block_missing",
        "/links",
        "A source-backed ReaderLink does not resolve to a rendered block.",
        "readerBlock",
        {
          blockKey: key,
          linkIds: links.map(({ id }) => id),
        },
      ),
    );
  }
  if (diagnostics.length > 0) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze(diagnostics),
    });
  }

  const markdownForBlock: PublisherNextMarkdownForBlock = (
    workId: string,
    sectionId: string,
    block: ReaderBlock,
  ) =>
    linkedMarkdown.get(
      readerBlockKey(workId, sectionId, block.id),
    ) ?? block.markdown;
  return success(markdownForBlock);
}

function decodeNextRouteSegments(segments: unknown): unknown {
  try {
    if (segments === undefined || !Array.isArray(segments)) {
      return segments;
    }
    return segments.map((segment) =>
      typeof segment === "string"
        ? decodeURIComponent(segment)
        : segment,
    );
  } catch {
    return null;
  }
}

function inspectRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): InspectedRecord | null {
  try {
    if (value === null || typeof value !== "object") {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return null;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as Record<string, PropertyDescriptor>;
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    for (const key of Object.keys(descriptors)) {
      const descriptor = descriptors[key];
      if (
        !allowed.has(key) ||
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return null;
      }
    }
    if (
      requiredKeys.some(
        (key) => !Object.hasOwn(descriptors, key),
      )
    ) {
      return null;
    }
    return Object.freeze({
      descriptors: Object.freeze(descriptors),
    });
  } catch {
    return null;
  }
}

function inspectArray(
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors.length;
    const lengthValue =
      lengthDescriptor !== undefined &&
      "value" in lengthDescriptor
        ? lengthDescriptor.value
        : undefined;
    if (
      typeof lengthValue !== "number" ||
      !Number.isSafeInteger(lengthValue) ||
      lengthValue < 0 ||
      lengthValue > maximumLength
    ) {
      return null;
    }
    const length = lengthValue;
    const snapshot: unknown[] = [];
    for (const key of Object.keys(descriptors)) {
      if (key === "length") {
        continue;
      }
      const descriptor = descriptors[key];
      const index = Number(key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= length ||
        String(index) !== key
      ) {
        return null;
      }
    }
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return null;
      }
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function valueOf(
  inspected: InspectedRecord,
  key: string,
): unknown {
  return inspected.descriptors[key]?.value;
}

function freezeJson<T extends JSONValue>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const pending: object[] = [value];
  const visited = new WeakSet<object>();
  const ordered: object[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);
    ordered.push(current);
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object") {
        pending.push(child);
      }
    }
  }
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    Object.freeze(ordered[index]);
  }
  return value;
}

function snapshotJsonObject(
  value: unknown,
  path: string,
): ValidationResult<PublisherNextJsonObject> {
  try {
    const text = canonicalizeJson(value as JSONValue);
    const parsed = JSON.parse(text) as JSONValue;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return failure(
        "next.adapter.config_invalid",
        path,
        "Adapter configuration must be one plain JSON object.",
        "type",
      );
    }
    return success(
      freezeJson(parsed) as PublisherNextJsonObject,
    );
  } catch {
    return failure(
      "next.adapter.config_invalid",
      path,
      "Adapter configuration must be finite, acyclic plain JSON data.",
      "json",
    );
  }
}

const EXTENSION_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SUPPORTED_EXTENSION_CAPABILITIES = Object.freeze([
  "content.project",
  "renderer.slot",
] as const);

function snapshotExtensionData(
  value: unknown,
): ValidationResult<Readonly<Record<string, JSONValue>>> {
  try {
    const parsed = JSON.parse(
      canonicalizeJson(value as JSONValue),
    ) as JSONValue;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new TypeError("not an object");
    }
    return success(
      freezeJson(parsed) as Readonly<Record<string, JSONValue>>,
    );
  } catch {
    return failure(
      "next.extension.data_invalid",
      "/extensionData",
      "Extension data must be one finite canonical JSON object.",
      "json",
    );
  }
}

function resolveExtensions(
  extensionDataInput: unknown,
  registrationsInput: unknown,
  reader: PublicationReaderEnvelope,
): ValidationResult<ResolvedExtensionsState | null> {
  if (extensionDataInput === undefined) {
    if (registrationsInput === undefined) {
      return success(null);
    }
    const registrations = inspectArray(registrationsInput, 1_000);
    return registrations !== null && registrations.length === 0
      ? success(null)
      : failure(
          "next.extension.data_required",
          "/extensionData",
          "Explicit extension registrations require the matching build-bound extension artifact.",
          "required",
        );
  }
  const snapshot = snapshotExtensionData(extensionDataInput);
  if (!snapshot.valid) {
    return snapshot;
  }
  const data = snapshot.value;
  const inspected = inspectRecord(
    data,
    [
      "schemaVersion",
      "publicationId",
      "engineVersion",
      "readerBuildId",
      "extensions",
      "buildId",
    ],
  );
  if (inspected === null) {
    return failure(
      "next.extension.data_shape_invalid",
      "/extensionData",
      "The extension artifact must use its closed build-bound shape.",
      "properties",
    );
  }
  const schemaVersion = valueOf(inspected, "schemaVersion");
  const publicationId = valueOf(inspected, "publicationId");
  const engineVersion = valueOf(inspected, "engineVersion");
  const readerBuildId = valueOf(inspected, "readerBuildId");
  const buildId = valueOf(inspected, "buildId");
  if (
    schemaVersion !== "1.0" ||
    publicationId !== reader.publicationId ||
    engineVersion !== reader.engineVersion ||
    readerBuildId !== reader.buildId ||
    typeof buildId !== "string" ||
    !SHA256_DIGEST.test(buildId)
  ) {
    return failure(
      "next.extension.data_identity_mismatch",
      "/extensionData",
      "The extension artifact does not belong to this exact Reader build.",
      "identity",
    );
  }
  const basis = Object.freeze({
    schemaVersion,
    publicationId,
    engineVersion,
    readerBuildId,
    extensions: valueOf(inspected, "extensions") as JSONValue,
  });
  if (hashCanonicalJson(basis as JSONValue) !== buildId) {
    return failure(
      "next.extension.data_hash_mismatch",
      "/extensionData/buildId",
      "The extension artifact build identity does not match its canonical data.",
      "hash",
    );
  }
  const dataEntries = inspectArray(
    valueOf(inspected, "extensions"),
    1_000,
  );
  const registrations = inspectArray(registrationsInput, 1_000);
  if (
    dataEntries === null ||
    registrations === null ||
    dataEntries.length === 0 ||
    registrations.length !== dataEntries.length
  ) {
    return failure(
      "next.extension.registration_set_invalid",
      "/extensions",
      "The author registry must match every build-bound extension in declaration order.",
      "extensionRegistration",
    );
  }
  const entries: ResolvedExtensionEntry[] = [];
  for (let index = 0; index < dataEntries.length; index += 1) {
    const path = `/extensionData/extensions/${index}`;
    const entryValue = dataEntries[index];
    const entry = inspectRecord(
      entryValue,
      ["id", "package", "version", "capabilities", "config"],
      ["serverData", "clientData"],
    );
    const registration = inspectRecord(
      registrations[index],
      [
        "id",
        "package",
        "version",
        "engineCompatibility",
        "capabilities",
        "implementation",
      ],
      ["renderer"],
    );
    if (entry === null || registration === null) {
      return failure(
        "next.extension.registration_invalid",
        path,
        "Extension data and registration must use their closed shapes.",
        "properties",
      );
    }
    const id = valueOf(entry, "id");
    const packageName = valueOf(entry, "package");
    const version = valueOf(entry, "version");
    const entryCapabilities = inspectArray(
      valueOf(entry, "capabilities"),
      5,
    );
    const supportedCapabilities = inspectArray(
      valueOf(registration, "capabilities"),
      5,
    );
    const engineCompatibility = valueOf(
      registration,
      "engineCompatibility",
    );
    if (
      typeof id !== "string" ||
      !EXTENSION_ID.test(id) ||
      typeof packageName !== "string" ||
      !PACKAGE_NAME.test(packageName) ||
      typeof version !== "string" ||
      valid(version) !== version ||
      valueOf(registration, "id") !== id ||
      valueOf(registration, "package") !== packageName ||
      valueOf(registration, "version") !== version ||
      typeof engineCompatibility !== "string" ||
      validRange(engineCompatibility) === null ||
      !satisfies(reader.engineVersion, engineCompatibility, {
        includePrerelease: true,
      }) ||
      entryCapabilities === null ||
      supportedCapabilities === null ||
      entryCapabilities.length === 0 ||
      entryCapabilities.some(
        (capability, capabilityIndex) =>
          typeof capability !== "string" ||
          entryCapabilities.indexOf(capability) !== capabilityIndex ||
          !SUPPORTED_EXTENSION_CAPABILITIES.includes(
            capability as typeof SUPPORTED_EXTENSION_CAPABILITIES[number],
          ) ||
          !supportedCapabilities.includes(capability),
      )
    ) {
      return failure(
        "next.extension.identity_invalid",
        path,
        "Extension identity, compatibility, and granted capabilities must match the explicit registry.",
        "extensionIdentity",
      );
    }
    if (valueOf(entry, "clientData") !== undefined) {
      return failure(
        "next.extension.client_unsupported",
        `${path}/clientData`,
        "The official renderer does not invoke renderer.client extensions yet.",
        "extensionCapability",
      );
    }
    const granted = Object.freeze(
      [...entryCapabilities] as ExtensionCapability[],
    );
    const rendererValue = valueOf(registration, "renderer");
    let renderer: PublisherNextExtensionRenderer | null = null;
    if (granted.includes("renderer.slot")) {
      const inspectedRenderer = inspectRecord(
        rendererValue,
        ["kind", "apiVersion", "rendererCompatibility", "renderSlot"],
      );
      const rendererCompatibility = inspectedRenderer === null
        ? undefined
        : valueOf(inspectedRenderer, "rendererCompatibility");
      if (
        inspectedRenderer === null ||
        valueOf(inspectedRenderer, "kind") !==
          "genii.publisher.next-extension" ||
        valueOf(inspectedRenderer, "apiVersion") !==
          PUBLISHER_NEXT_EXTENSION_API_VERSION ||
        typeof rendererCompatibility !== "string" ||
        validRange(rendererCompatibility) === null ||
        !satisfies(PUBLISHER_NEXT_VERSION, rendererCompatibility, {
          includePrerelease: true,
        }) ||
        typeof valueOf(inspectedRenderer, "renderSlot") !== "function"
      ) {
        return failure(
          "next.extension.renderer_invalid",
          `/extensions/${index}/renderer`,
          "A renderer.slot grant requires one compatible official Next renderer adapter.",
          "extensionRenderer",
        );
      }
      renderer = Object.freeze({
        kind: "genii.publisher.next-extension" as const,
        apiVersion: PUBLISHER_NEXT_EXTENSION_API_VERSION,
        rendererCompatibility,
        renderSlot: valueOf(
          inspectedRenderer,
          "renderSlot",
        ) as PublisherNextExtensionRenderer["renderSlot"],
      });
    }
    entries.push(Object.freeze({
      id,
      package: packageName,
      version,
      capabilities: granted,
      projectionHash: hashCanonicalJson(entryValue as JSONValue),
      renderer,
      ...(valueOf(entry, "serverData") === undefined
        ? {}
        : { serverData: valueOf(entry, "serverData") as JSONValue }),
    }));
  }
  return success(Object.freeze({
    schemaVersion: "1.0" as const,
    buildId: buildId as Sha256Digest,
    entries: Object.freeze(entries),
  }));
}

function extensionPageContext(
  page: PublisherNextPage,
): PublisherNextExtensionPageContext {
  const work = page.kind === "work" || page.kind === "section"
    ? Object.freeze({ id: page.work.id, title: page.work.title })
    : undefined;
  const section = page.kind === "section"
    ? Object.freeze({ id: page.section.id, title: page.section.title })
    : undefined;
  return Object.freeze({
    kind: page.kind,
    path: page.path,
    publication: Object.freeze({
      id: page.publication.id,
      title: page.publication.title,
      language: page.publication.language,
    }),
    ...(work === undefined ? {} : { work }),
    ...(section === undefined ? {} : { section }),
  });
}

async function renderExtensionSlot(
  extensions: ResolvedExtensionsState | null,
  slot: PublisherNextExtensionSlot,
  page: PublisherNextPage,
): Promise<ReactElement[]> {
  if (!PUBLISHER_NEXT_EXTENSION_SLOTS.includes(slot)) {
    throw new TypeError("Unknown Publisher extension slot.");
  }
  const context = extensionPageContext(page);
  const rendered: ReactElement[] = [];
  for (const extension of extensions?.entries ?? []) {
    if (
      !extension.capabilities.includes("renderer.slot") ||
      extension.renderer === null
    ) {
      continue;
    }
    let body;
    try {
      body = await extension.renderer.renderSlot(Object.freeze({
        slot,
        page: context,
        ...(extension.serverData === undefined
          ? {}
          : { serverData: extension.serverData }),
      }));
    } catch {
      throw new TypeError(
        `Extension ${JSON.stringify(extension.id)} threw while rendering ${slot}.`,
      );
    }
    rendered.push(
      <aside
        data-publisher-extension={extension.id}
        data-publisher-slot={slot}
        key={`${slot}:${extension.id}`}
      >
        {body}
      </aside>,
    );
  }
  return rendered;
}

function updateText(
  value: unknown,
  path: string,
  maximumLength: number,
): ValidationResult<string> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.includes("\u0000")
  ) {
    return failure(
      "next.updates.view_text_invalid",
      path,
      `Updates text must contain between 1 and ${maximumLength.toLocaleString()} characters and no null character.`,
      "type",
    );
  }
  return success(value);
}

function updatePublishedAt(
  value: unknown,
  path: string,
): ValidationResult<string> {
  if (typeof value === "string" && UPDATE_DATE.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    ) {
      return success(value);
    }
  }
  if (typeof value === "string" && UPDATE_INSTANT.test(value)) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.valueOf())) {
      const canonical = parsed.toISOString();
      if (
        canonical === value ||
        canonical.replace(".000Z", "Z") === value
      ) {
        return success(value);
      }
    }
  }
  return failure(
    "next.updates.view_date_invalid",
    path,
    "An Updates publication date must be an ISO date or canonical UTC instant.",
    "format",
  );
}

function updateHref(
  value: unknown,
  path: string,
  allowedInternalHrefs: ReadonlySet<string>,
): ValidationResult<string> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    /[\u0000-\u0020\u007f\\]/u.test(value) ||
    /[^\u0000-\u007f]/u.test(value)
  ) {
    return failure(
      "next.updates.view_href_invalid",
      path,
      "An Updates link must be one safe internal path or absolute HTTPS URL.",
      "format",
    );
  }
  if (allowedInternalHrefs.has(value)) {
    return success(value);
  }
  try {
    const parsed = new URL(value);
    const external =
      value.startsWith("https://") &&
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.href === value;
    if (!external) {
      throw new TypeError("unsafe URL");
    }
  } catch {
    return failure(
      "next.updates.view_href_invalid",
      path,
      "An Updates link must be one safe internal path or absolute HTTPS URL.",
      "format",
    );
  }
  return success(value);
}

function validateUpdatesEntry(
  value: unknown,
  index: number,
  allowedInternalHrefs: ReadonlySet<string>,
): ValidationResult<PublisherNextUpdatesEntry> {
  const path = `/updates/view/entries/${index}`;
  const inspected = inspectRecord(
    value,
    ["id", "title"],
    ["href", "publishedAt", "summary"],
  );
  if (inspected === null) {
    return failure(
      "next.updates.view_entry_invalid",
      path,
      "Each Updates entry must use the closed plain-data entry shape.",
      "properties",
    );
  }
  const id = valueOf(inspected, "id");
  if (typeof id !== "string" || !UPDATE_ID.test(id)) {
    return failure(
      "next.updates.view_id_invalid",
      `${path}/id`,
      "Each Updates entry id must be a stable identifier of at most 128 characters.",
      "pattern",
    );
  }
  const title = updateText(
    valueOf(inspected, "title"),
    `${path}/title`,
    300,
  );
  if (!title.valid) {
    return title;
  }
  const summaryValue = valueOf(inspected, "summary");
  const summary =
    summaryValue === undefined
      ? undefined
      : updateText(summaryValue, `${path}/summary`, 10_000);
  if (summary !== undefined && !summary.valid) {
    return summary;
  }
  const publishedAtValue = valueOf(inspected, "publishedAt");
  const publishedAt =
    publishedAtValue === undefined
      ? undefined
      : updatePublishedAt(
          publishedAtValue,
          `${path}/publishedAt`,
        );
  if (publishedAt !== undefined && !publishedAt.valid) {
    return publishedAt;
  }
  const hrefValue = valueOf(inspected, "href");
  const href =
    hrefValue === undefined
      ? undefined
      : updateHref(
          hrefValue,
          `${path}/href`,
          allowedInternalHrefs,
        );
  if (href !== undefined && !href.valid) {
    return href;
  }
  return success(
    Object.freeze({
      id,
      title: title.value,
      ...(summary === undefined
        ? {}
        : { summary: summary.value }),
      ...(publishedAt === undefined
        ? {}
        : { publishedAt: publishedAt.value }),
      ...(href === undefined ? {} : { href: href.value }),
    }),
  );
}

function validateUpdatesView(
  value: unknown,
  allowedInternalHrefs: ReadonlySet<string>,
): ValidationResult<PublisherNextUpdatesView> {
  const inspected = inspectRecord(
    value,
    ["entries", "title"],
    ["description", "emptyMessage"],
  );
  if (inspected === null) {
    return failure(
      "next.updates.view_invalid",
      "/updates/view",
      "The Updates adapter must load the closed plain-data view shape.",
      "properties",
    );
  }
  const title = updateText(
    valueOf(inspected, "title"),
    "/updates/view/title",
    300,
  );
  if (!title.valid) {
    return title;
  }
  const descriptionValue = valueOf(inspected, "description");
  const description =
    descriptionValue === undefined
      ? undefined
      : updateText(
          descriptionValue,
          "/updates/view/description",
          10_000,
        );
  if (description !== undefined && !description.valid) {
    return description;
  }
  const emptyMessageValue = valueOf(inspected, "emptyMessage");
  const emptyMessage =
    emptyMessageValue === undefined
      ? undefined
      : updateText(
          emptyMessageValue,
          "/updates/view/emptyMessage",
          1_000,
        );
  if (emptyMessage !== undefined && !emptyMessage.valid) {
    return emptyMessage;
  }
  const entries = inspectArray(
    valueOf(inspected, "entries"),
    10_000,
  );
  if (entries === null) {
    return failure(
      "next.updates.view_entries_invalid",
      "/updates/view/entries",
      "Updates entries must be one dense plain array with at most 10,000 entries.",
      "type",
    );
  }
  const ids = new Set<string>();
  const entrySnapshots: PublisherNextUpdatesEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = validateUpdatesEntry(
      entries[index],
      index,
      allowedInternalHrefs,
    );
    if (!entry.valid) {
      return entry;
    }
    if (ids.has(entry.value.id)) {
      return failure(
        "next.updates.view_id_duplicate",
        `/updates/view/entries/${index}/id`,
        "Updates entry ids must be unique within the loaded view.",
        "uniqueItems",
      );
    }
    ids.add(entry.value.id);
    entrySnapshots.push(entry.value);
  }
  return success(
    Object.freeze({
      title: title.value,
      ...(description === undefined
        ? {}
        : { description: description.value }),
      ...(emptyMessage === undefined
        ? {}
        : { emptyMessage: emptyMessage.value }),
      entries: Object.freeze(entrySnapshots),
    }),
  );
}

async function loadUpdatesView(
  instance: PublisherNextUpdatesInstance,
  page: PublisherNextUpdatesPage,
  allowedInternalHrefs: ReadonlySet<string>,
): Promise<ValidationResult<PublisherNextUpdatesView>> {
  let loaded: unknown;
  try {
    loaded = await Reflect.apply(instance.load, instance, [page]);
  } catch {
    return failure(
      "next.updates.load_threw",
      "/updates/view",
      "The Updates adapter threw while loading its plain-data view.",
      "adapter",
    );
  }
  return validateUpdatesView(loaded, allowedInternalHrefs);
}

function updatesInternalHrefs(
  reader: PublicationReaderEnvelope,
): ReadonlySet<string> {
  const hrefs = new Set<string>();
  for (const route of reader.routes.active) {
    hrefs.add(route.path);
  }
  for (const redirect of reader.routes.redirects) {
    hrefs.add(redirect.from);
  }
  for (const asset of reader.assets) {
    hrefs.add(asset.href);
  }
  for (const work of reader.works) {
    for (const section of work.sections) {
      if (section.readerAddress !== null) {
        hrefs.add(
          `${section.readerAddress.path}${
            section.readerAddress.anchor === undefined
              ? ""
              : `#${section.readerAddress.anchor}`
          }`,
        );
      }
      for (const block of section.blocks) {
        if (block.readerAddress !== null) {
          hrefs.add(
            `${block.readerAddress.path}#${block.readerAddress.anchor}`,
          );
        }
      }
    }
  }
  return hrefs;
}

function inspectIdentity(
  packageName: unknown,
  version: unknown,
  rendererCompatibility: unknown,
  path: string,
): ValidationResult<{
  readonly package: string;
  readonly version: string;
  readonly rendererCompatibility: string;
}> {
  if (
    typeof packageName !== "string" ||
    packageName.length > 214 ||
    !PACKAGE_NAME.test(packageName)
  ) {
    return failure(
      "next.adapter.package_invalid",
      `${path}/package`,
      "The adapter package must be a canonical npm package name.",
      "pattern",
    );
  }
  if (
    typeof version !== "string" ||
    valid(version) !== version
  ) {
    return failure(
      "next.adapter.version_invalid",
      `${path}/version`,
      "The adapter version must be one exact SemVer version.",
      "semver",
    );
  }
  if (
    typeof rendererCompatibility !== "string" ||
    validRange(rendererCompatibility) === null ||
    !satisfies(
      PUBLISHER_NEXT_VERSION,
      rendererCompatibility,
      { includePrerelease: true },
    )
  ) {
    return failure(
      "next.adapter.renderer_incompatible",
      `${path}/rendererCompatibility`,
      "The adapter compatibility range must include this renderer version.",
      "semver",
      { rendererVersion: PUBLISHER_NEXT_VERSION },
    );
  }
  return success(
    Object.freeze({
      package: packageName,
      version,
      rendererCompatibility,
    }),
  );
}

function configuredValue(
  result: unknown,
  path: string,
): ValidationResult<unknown> {
  const inspected = inspectRecord(
    result,
    ["diagnostics", "valid"],
    ["value"],
  );
  if (inspected === null) {
    return failure(
      "next.adapter.result_invalid",
      path,
      "The adapter configure function returned an invalid result.",
      "type",
    );
  }
  const validValue = valueOf(inspected, "valid");
  if (validValue === false) {
    return failure(
      "next.adapter.configuration_failed",
      path,
      "The adapter rejected its configuration.",
      "adapter",
    );
  }
  if (
    validValue !== true ||
    !Object.hasOwn(inspected.descriptors, "value")
  ) {
    return failure(
      "next.adapter.result_invalid",
      path,
      "The adapter configure function returned an invalid result.",
      "type",
    );
  }
  return success(valueOf(inspected, "value"));
}

function resolveTheme(
  resolved: ResolvedPublisherNextTheme,
): ValidationResult<ResolvedThemeState> {
  const inspected = inspectRecord(resolved, [
    "config",
    "implementation",
    "package",
    "rendererCompatibility",
    "version",
  ]);
  if (inspected === null) {
    return failure(
      "next.theme.resolution_invalid",
      "/theme",
      "The resolved theme must use the complete closed adapter shape.",
      "properties",
    );
  }
  const identity = inspectIdentity(
    valueOf(inspected, "package"),
    valueOf(inspected, "version"),
    valueOf(inspected, "rendererCompatibility"),
    "/theme",
  );
  if (!identity.valid) {
    return identity;
  }
  const config = snapshotJsonObject(
    valueOf(inspected, "config"),
    "/theme/config",
  );
  if (!config.valid) {
    return config;
  }
  const implementation = inspectRecord(
    valueOf(inspected, "implementation"),
    ["apiVersion", "configure", "kind"],
  );
  if (
    implementation === null ||
    valueOf(implementation, "kind") !==
      "genii.publisher.next-theme" ||
    valueOf(implementation, "apiVersion") !==
      PUBLISHER_NEXT_THEME_API_VERSION ||
    typeof valueOf(implementation, "configure") !== "function"
  ) {
    return failure(
      "next.theme.implementation_invalid",
      "/theme/implementation",
      "The theme implementation does not match the renderer theme API.",
      "apiVersion",
    );
  }
  let configured: unknown;
  try {
    configured = Reflect.apply(
      valueOf(implementation, "configure") as (
        config: PublisherNextJsonObject,
      ) => unknown,
      valueOf(inspected, "implementation"),
      [config.value],
    );
  } catch {
    return failure(
      "next.theme.configuration_threw",
      "/theme/config",
      "The theme configure function threw while resolving its tokens.",
      "adapter",
    );
  }
  const configuredTheme = configuredValue(
    configured,
    "/theme/config",
  );
  if (!configuredTheme.valid) {
    return configuredTheme;
  }
  const validatedTheme = validatePublisherNextThemeInstance(
    configuredTheme.value,
  );
  if (!validatedTheme.valid) {
    return validatedTheme;
  }
  return success(
    Object.freeze({
      identity: identity.value,
      config: config.value,
      configHash: hashCanonicalJson(config.value),
      instance: validatedTheme.value,
      tokensHash: hashCanonicalJson(
        validatedTheme.value.tokens as unknown as JSONValue,
      ),
    }),
  );
}

function resolveUpdates(
  resolved: ResolvedPublisherNextUpdates,
): ValidationResult<ConfiguredUpdatesState> {
  const inspected = inspectRecord(resolved, [
    "config",
    "implementation",
    "package",
    "rendererCompatibility",
    "version",
  ]);
  if (inspected === null) {
    return failure(
      "next.updates.resolution_invalid",
      "/updates",
      "The resolved Updates adapter must use the complete closed adapter shape.",
      "properties",
    );
  }
  const identity = inspectIdentity(
    valueOf(inspected, "package"),
    valueOf(inspected, "version"),
    valueOf(inspected, "rendererCompatibility"),
    "/updates",
  );
  if (!identity.valid) {
    return identity;
  }
  const config = snapshotJsonObject(
    valueOf(inspected, "config"),
    "/updates/config",
  );
  if (!config.valid) {
    return config;
  }
  const implementation = inspectRecord(
    valueOf(inspected, "implementation"),
    ["apiVersion", "configure", "kind"],
  );
  if (
    implementation === null ||
    valueOf(implementation, "kind") !==
      "genii.publisher.next-updates" ||
    valueOf(implementation, "apiVersion") !==
      PUBLISHER_NEXT_UPDATES_API_VERSION ||
    typeof valueOf(implementation, "configure") !== "function"
  ) {
    return failure(
      "next.updates.implementation_invalid",
      "/updates/implementation",
      "The Updates implementation does not match the renderer Updates API.",
      "apiVersion",
    );
  }
  let configured: unknown;
  try {
    configured = Reflect.apply(
      valueOf(implementation, "configure") as (
        config: PublisherNextJsonObject,
      ) => unknown,
      valueOf(inspected, "implementation"),
      [config.value],
    );
  } catch {
    return failure(
      "next.updates.configuration_threw",
      "/updates/config",
      "The Updates configure function threw while resolving.",
      "adapter",
    );
  }
  const configuredUpdates = configuredValue(
    configured,
    "/updates/config",
  );
  if (!configuredUpdates.valid) {
    return configuredUpdates;
  }
  const instance = inspectRecord(
    configuredUpdates.value,
    ["load"],
  );
  if (
    instance === null ||
    typeof valueOf(instance, "load") !== "function"
  ) {
    return failure(
      "next.updates.instance_invalid",
      "/updates",
      "The Updates adapter must return exactly one load function.",
      "properties",
    );
  }
  const load = valueOf(instance, "load") as
    PublisherNextUpdatesInstance["load"];
  const snapshot: PublisherNextUpdatesInstance = Object.freeze({
    load,
  });
  return success(
    Object.freeze({
      identity: identity.value,
      config: config.value,
      configHash: hashCanonicalJson(config.value),
      instance: snapshot,
    }),
  );
}

function resolveUpdatesData(
  value: unknown,
  reader: PublicationReaderEnvelope,
): ValidationResult<ConfiguredUpdatesState> {
  const validated = validateUpdatesEnvelopeShape(value);
  if (!validated.valid) {
    return validated;
  }
  const envelope = validated.value;
  if (
    envelope.publicationId !== reader.publicationId ||
    envelope.buildId !== reader.buildId
  ) {
    return failure(
      "next.updates.data_stale",
      "/updatesData",
      "The Updates artifact is not bound to this Reader build.",
      "identity",
    );
  }
  const views = new Map(
    envelope.views.map(({ id, ...view }) => [
      id,
      Object.freeze(view),
    ] as const),
  );
  const config = Object.freeze({
    buildId: envelope.buildId,
    catalogSha256: envelope.source.catalogSha256,
  });
  const instance: PublisherNextUpdatesInstance = Object.freeze({
    load(page: PublisherNextUpdatesPage) {
      const view = views.get(page.viewId);
      if (view === undefined) {
        throw new TypeError(
          `No Updates view is bound to route "${page.viewId}".`,
        );
      }
      return view;
    },
  });
  return success(
    Object.freeze({
      identity: Object.freeze({
        package: "@genii-foundation/publisher-next",
        version: PUBLISHER_NEXT_VERSION,
        rendererCompatibility: PUBLISHER_NEXT_VERSION,
      }),
      config,
      configHash: hashCanonicalJson(config),
      instance,
    }),
  );
}

function pageResolver(
  reader: PublicationReaderEnvelope,
  routePlan: PublisherNextRoutePlan,
): {
  readonly homePath: string;
  readonly owns: (page: unknown) => page is PublisherNextPage;
  readonly resolve: (
    segments: unknown,
  ) => PublisherNextRouteResolution;
} {
  const workById = new Map<string, ReaderWork>(
    reader.works.map((work) => [work.id, work]),
  );
  const collectionById = new Map<string, ReaderCollection>(
    reader.collections.map((collection) => [
      collection.id,
      collection,
    ]),
  );
  const sectionByLocation = new Map<string, ReaderSection>();
  const issuedPages = new WeakSet<object>();
  for (const work of reader.works) {
    for (const section of work.sections) {
      sectionByLocation.set(
        JSON.stringify([work.id, section.id]),
        section,
      );
    }
  }
  const homePath =
    reader.routes.active.find(
      ({ target }) => target.kind === "home",
    )?.path ?? "/";
  const assetsForWork = (workId: string) =>
    Object.freeze(
      reader.assets.filter(
        ({ workId: ownerId }) =>
          ownerId === undefined || ownerId === workId,
      ),
    );
  const linksForWork = (workId: string) =>
    Object.freeze(
      reader.links.filter(
        ({ source }) => source.workId === workId,
      ),
    );

  const toPage = (
    route: ContentRoute & {
      readonly target: ContentRoute["target"] & {
        readonly pageNumber?: number;
        readonly previousPath?: string;
        readonly nextPath?: string;
      };
    },
  ): PublisherNextPage | null => {
    const base = {
      path: route.path,
      publication: reader.publication,
    };
    let page: PublisherNextPage | null;
    switch (route.target.kind) {
      case "home":
        page = Object.freeze({
          ...base,
          kind: "home",
          works: Object.freeze(
            reader.works.filter(
              ({ publicationState }) =>
                publicationState === "published",
            ),
          ),
          collections: Object.freeze(
            reader.collections.filter(
              ({ publicationState }) =>
                publicationState === "published",
            ),
          ),
        });
        break;
      case "updates":
        page = Object.freeze({
          ...base,
          kind: "updates",
          viewId: route.target.viewId,
          pageNumber: route.target.pageNumber ?? 1,
          ...(route.target.pagination === undefined
            ? {}
            : { pageSize: route.target.pagination.pageSize }),
          ...(route.target.previousPath === undefined
            ? {}
            : { previousPath: route.target.previousPath }),
          ...(route.target.nextPath === undefined
            ? {}
            : { nextPath: route.target.nextPath }),
        });
        break;
      case "work": {
        const work = workById.get(route.target.workId);
        page = work === undefined
          ? null
          : Object.freeze({
              ...base,
              kind: "work",
              work,
              assets: assetsForWork(work.id),
              links: linksForWork(work.id),
            });
        break;
      }
      case "collection": {
        const collection = collectionById.get(
          route.target.collectionId,
        );
        if (collection === undefined) {
          return null;
        }
        page = Object.freeze({
          ...base,
          kind: "collection",
          collection,
          works: Object.freeze(
            collection.workIds.flatMap((id) => {
              const work = workById.get(id);
              return work?.publicationState === "published"
                ? [work]
                : [];
            }),
          ),
        });
        break;
      }
      case "section": {
        const work = workById.get(route.target.workId);
        const section = sectionByLocation.get(
          JSON.stringify([
            route.target.workId,
            route.target.sectionId,
          ]),
        );
        if (work === undefined || section === undefined) {
          return null;
        }
        const previous =
          section.previousId === null
            ? null
            : (
                sectionByLocation.get(
                  JSON.stringify([
                    work.id,
                    section.previousId,
                  ]),
                ) ?? null
              );
        const next =
          section.nextId === null
            ? null
            : (
                sectionByLocation.get(
                  JSON.stringify([work.id, section.nextId]),
                ) ?? null
              );
        page = Object.freeze({
          ...base,
          kind: "section",
          work,
          section,
          assets: assetsForWork(work.id),
          links: Object.freeze(
            linksForWork(work.id).filter(
              ({ source }) =>
                source.sectionId === section.id,
            ),
          ),
          previous,
          next,
        });
        break;
      }
    }
    if (page !== null) {
      issuedPages.add(page);
    }
    return page;
  };

  return Object.freeze({
    homePath,
    owns(page: unknown): page is PublisherNextPage {
      return (
        page !== null &&
        typeof page === "object" &&
        issuedPages.has(page)
      );
    },
    resolve(segments: unknown): PublisherNextRouteResolution {
      const resolved = routePlan.resolve(segments);
      if (resolved.status !== "resolved") {
        return resolved;
      }
      const page = toPage(resolved.route);
      return page === null
        ? Object.freeze({
            status: "invalid",
            issue: "target",
          })
        : Object.freeze({
            status: "resolved",
            page,
          });
    },
  });
}

function metadataForPage(
  page: PublisherNextPage,
  updatesView?: PublisherNextUpdatesView,
): Metadata {
  let title: string;
  let description: string | undefined;
  switch (page.kind) {
    case "home":
      title = page.publication.title;
      description = page.publication.description;
      break;
    case "work":
      title = `${page.work.title} | ${page.publication.title}`;
      description = page.work.summary ?? page.publication.description;
      break;
    case "collection":
      title = `${page.collection.title} | ${page.publication.title}`;
      description =
        page.collection.description ?? page.publication.description;
      break;
    case "section":
      title = `${page.section.title} | ${page.work.title}`;
      description = page.work.summary ?? page.publication.description;
      break;
    case "updates":
      title = `${updatesView?.title ?? "Updates"}${
        page.pageNumber === 1 ? "" : `, page ${page.pageNumber}`
      } | ${page.publication.title}`;
      description =
        updatesView?.description ?? page.publication.description;
      break;
  }
  const canonical =
    page.publication.canonicalUrl === undefined
      ? undefined
      : new URL(
          page.path,
          page.publication.canonicalUrl,
        ).toString();
  return {
    title,
    ...(description === undefined ? {} : { description }),
    ...(canonical === undefined
      ? {}
      : { alternates: { canonical } }),
  };
}

function createApplicationArtifact(
  reader: PublicationReaderEnvelope,
  theme: ResolvedThemeState,
  updates: ResolvedUpdatesState | null,
  extensions: ResolvedExtensionsState | null,
  sync: SyncEnvelope | null,
  continuity: PublisherNextContinuityHandler,
): PublisherNextApplicationArtifact {
  const artifactDescriptor = Object.freeze({
    kind: PUBLISHER_NEXT_APPLICATION_ARTIFACT_KIND,
    mediaType: PUBLISHER_NEXT_APPLICATION_ARTIFACT_MEDIA_TYPE,
    relativePath: PUBLISHER_NEXT_APPLICATION_ARTIFACT_RELATIVE_PATH,
  });
  const source = Object.freeze({
    readerSchemaVersion: reader.schemaVersion,
    readerBuildId: reader.buildId,
    audience: reader.audience,
  });
  const themeIdentity = Object.freeze({
    ...theme.identity,
    apiVersion: PUBLISHER_NEXT_THEME_API_VERSION,
    configHash: theme.configHash,
    tokensHash: theme.tokensHash,
  });
  const updatesIdentity =
    updates === null
      ? null
      : Object.freeze({
          ...updates.identity,
          apiVersion: PUBLISHER_NEXT_UPDATES_API_VERSION,
          configHash: updates.configHash,
          viewHash: updates.viewHash,
        });
  const continuityIdentity = Object.freeze({
    mode: "proxy" as const,
    explicitRedirectCount: continuity.explicitRedirectCount,
    canonicalSlashRedirectCount:
      continuity.canonicalSlashRedirectCount,
  });
  const syncIdentity = sync === null
    ? null
    : Object.freeze({
        schemaVersion: sync.schemaVersion,
        buildId: reader.buildId,
        providerPackage: sync.provider.package,
        consent: sync.consent,
        localFallback: sync.localFallback,
        capabilities: Object.freeze([...sync.capabilities]),
      });
  const extensionIdentity = extensions === null
    ? null
    : Object.freeze({
        schemaVersion: extensions.schemaVersion,
        buildId: extensions.buildId,
        entries: Object.freeze(
          extensions.entries.map((extension) => Object.freeze({
            id: extension.id,
            package: extension.package,
            version: extension.version,
            capabilities: Object.freeze([...extension.capabilities]),
            projectionHash: extension.projectionHash,
            rendererApiVersion: extension.renderer?.apiVersion ?? null,
            rendererCompatibility:
              extension.renderer?.rendererCompatibility ?? null,
          })),
        ),
      });
  const basis = Object.freeze({
    schemaVersion: PUBLISHER_NEXT_APPLICATION_SCHEMA_VERSION,
    publicationId: reader.publicationId,
    engineVersion: reader.engineVersion,
    rendererVersion: PUBLISHER_NEXT_VERSION,
    artifact: artifactDescriptor,
    source,
    theme: themeIdentity,
    updates: updatesIdentity,
    extensions: extensionIdentity,
    sync: syncIdentity,
    continuity: continuityIdentity,
  });
  const buildId = hashCanonicalJson(
    basis as unknown as JSONValue,
  );
  const manifest: PublisherNextApplicationManifest = Object.freeze({
    $schema: PUBLISHER_NEXT_APPLICATION_SCHEMA_URL,
    ...basis,
    buildId,
  });
  const text = `${canonicalizeJson(
    manifest as unknown as JSONValue,
  )}\n`;
  return Object.freeze({
    relativePath: PUBLISHER_NEXT_APPLICATION_ARTIFACT_RELATIVE_PATH,
    mediaType: PUBLISHER_NEXT_APPLICATION_ARTIFACT_MEDIA_TYPE,
    text,
    hash: sha256(text),
    manifest,
  });
}

export async function createPublicationNextApplication(
  options: CreatePublicationNextApplicationOptions,
): Promise<ValidationResult<PublicationNextApplication>> {
  try {
    const inspectedOptions = inspectRecord(
      options,
      ["reader"],
      [
        "audioData",
        "extensionData",
        "extensions",
        "syncData",
        "theme",
        "updates",
        "updatesData",
      ],
    );
    if (inspectedOptions === null) {
      return failure(
        "next.application.options_invalid",
        "",
        "Application options must use the closed renderer input shape.",
        "properties",
      );
    }
    const readerResult = validatePublicationReaderEnvelope(
      valueOf(inspectedOptions, "reader"),
    );
    if (!readerResult.valid) {
      return readerResult;
    }
    const reader = readerResult.value;
    const extensionsResult = resolveExtensions(
      valueOf(inspectedOptions, "extensionData"),
      valueOf(inspectedOptions, "extensions"),
      reader,
    );
    if (!extensionsResult.valid) {
      return extensionsResult;
    }
    const extensions = extensionsResult.value;
    const suppliedAudioData = valueOf(inspectedOptions, "audioData");
    let narration: ReaderNarrationEnvelope | null = null;
    let narrationCatalogHash: Sha256Digest | null = null;
    if (suppliedAudioData !== undefined) {
      const audioResult = validateAudioEnvelopeShape(suppliedAudioData);
      if (!audioResult.valid) return audioResult;
      if (
        audioResult.value.publicationId !== reader.publicationId ||
        audioResult.value.buildId !== reader.buildId
      ) {
        return failure(
          "next.audio.identity_mismatch",
          "/audioData",
          "The narration artifact does not belong to this Reader build.",
          "identity",
        );
      }
      narration = parseReaderNarrationEnvelope(JSON.stringify(audioResult.value), {
        publicationId: reader.publicationId,
        readerBuildId: reader.buildId,
      });
      if (narration === null) {
        return failure(
          "next.audio.projection_invalid",
          "/audioData",
          "The narration artifact cannot be projected into the browser Reader contract.",
          "format",
        );
      }
      narrationCatalogHash = audioResult.value.source.catalogSha256 as Sha256Digest;
    }
    const suppliedSyncData = valueOf(inspectedOptions, "syncData");
    let sync: SyncEnvelope | null = null;
    if (suppliedSyncData !== undefined) {
      const syncResult = validateSyncEnvelopeShape(suppliedSyncData);
      if (!syncResult.valid) return syncResult;
      if (
        syncResult.value.publicationId !== reader.publicationId ||
        syncResult.value.buildId !== reader.buildId
      ) {
        return failure(
          "next.sync.identity_mismatch",
          "/syncData",
          "The synchronization artifact does not belong to this Reader build.",
          "identity",
        );
      }
      sync = syncResult.value;
    }
    const markdownResult = prepareReaderMarkdown(reader);
    if (!markdownResult.valid) {
      return markdownResult;
    }
    const markdownForBlock = markdownResult.value;
    const suppliedUpdatesData = valueOf(
      inspectedOptions,
      "updatesData",
    );
    const routePlanResult = createPublisherNextRoutePlan(
      reader,
      suppliedUpdatesData,
    );
    if (!routePlanResult.valid) {
      return routePlanResult;
    }
    const routePlan = routePlanResult.value;
    const hasUpdatesRoute = reader.routes.active.some(
      ({ target }) => target.kind === "updates",
    );
    const suppliedUpdates = valueOf(inspectedOptions, "updates");
    if (
      suppliedUpdates !== undefined &&
      suppliedUpdatesData !== undefined
    ) {
      return failure(
        "next.updates.ambiguous",
        "/updates",
        "Supply either an Updates adapter or a materialized Updates artifact, not both.",
        "oneOf",
      );
    }
    if (
      hasUpdatesRoute &&
      suppliedUpdates === undefined &&
      suppliedUpdatesData === undefined
    ) {
      return failure(
        "next.updates.required",
        "/updates",
        "The publication declares an Updates route but no Updates adapter was supplied.",
        "required",
      );
    }
    if (
      !hasUpdatesRoute &&
      (suppliedUpdates !== undefined ||
        suppliedUpdatesData !== undefined)
    ) {
      return failure(
        "next.updates.unexpected",
        "/updates",
        "An Updates adapter cannot be supplied without a declared Updates route.",
        "route",
      );
    }
    const themeResult = resolveTheme(
      (valueOf(inspectedOptions, "theme") ??
        resolveDefaultPublisherNextTheme()) as ResolvedPublisherNextTheme,
    );
    if (!themeResult.valid) {
      return themeResult;
    }
    let configuredUpdates: ConfiguredUpdatesState | null = null;
    if (suppliedUpdates !== undefined) {
      const updatesResult = resolveUpdates(
        suppliedUpdates as ResolvedPublisherNextUpdates,
      );
      if (!updatesResult.valid) {
        return updatesResult;
      }
      configuredUpdates = updatesResult.value;
    } else if (suppliedUpdatesData !== undefined) {
      const updatesResult = resolveUpdatesData(
        suppliedUpdatesData,
        reader,
      );
      if (!updatesResult.valid) {
        return updatesResult;
      }
      configuredUpdates = updatesResult.value;
    }
    const resolver = pageResolver(reader, routePlan);
    const errorIdentityResult =
      createPublisherNextErrorIdentity({
        homePath: resolver.homePath,
        publication: reader.publication,
        theme: themeResult.value.instance,
      });
    if (!errorIdentityResult.valid) {
      return errorIdentityResult;
    }
    let updatesState: ResolvedUpdatesState | null = null;
    if (configuredUpdates !== null) {
      const views = new Map<string, PublisherNextUpdatesView>();
      for (const route of reader.routes.active) {
        if (route.target.kind !== "updates") {
          continue;
        }
        const updatesPage = resolver.resolve(
          route.path === "/"
            ? undefined
            : route.path
                .slice(1, route.path.endsWith("/") ? -1 : undefined)
                .split("/")
                .map(decodeURIComponent),
        );
        if (
          updatesPage.status !== "resolved" ||
          updatesPage.page.kind !== "updates"
        ) {
          return failure(
            "next.updates.route_invalid",
            "/routes/active",
            "A declared Updates route could not resolve to its closed page model.",
            "route",
          );
        }
        const loaded = await loadUpdatesView(
          configuredUpdates.instance,
          updatesPage.page,
          updatesInternalHrefs(reader),
        );
        if (!loaded.valid) {
          return loaded;
        }
        views.set(updatesPage.page.viewId, loaded.value);
      }
      updatesState = Object.freeze({
        ...configuredUpdates,
        views,
        viewHash: hashCanonicalJson(
          Object.fromEntries(views) as unknown as JSONValue,
        ),
      });
    }
    const continuity = createPublisherNextContinuityHandler(
      reader,
      routePlan,
    );
    const artifact = createApplicationArtifact(
      reader,
      themeResult.value,
      updatesState,
      extensions,
      sync,
      continuity,
    );
    const offlineCatalog = createReaderOfflineCatalog({
      reader,
      rendererBuildId: artifact.manifest.buildId,
      catalogHref: `/publication-reader-offline.json?rendererBuildId=${encodeURIComponent(artifact.manifest.buildId)}`,
      sharedResources: Object.freeze([
        Object.freeze({
          href: "/publication-reader-search.json",
          kind: "data" as const,
        }),
        Object.freeze({
          href: "/publication-reader-progress.json",
          kind: "data" as const,
        }),
        ...(narration === null
          ? []
          : [Object.freeze({
              href: "/publication-audio.json",
              kind: "data" as const,
            })]),
      ]),
      ...(narration === null || narrationCatalogHash === null
        ? {}
        : {
            narration: {
              catalogHash: narrationCatalogHash,
              envelope: narration,
            },
          }),
    });
    const offlineCatalogText = serializeReaderOfflineCatalog(offlineCatalog);

    const renderPage = async (
      page: PublisherNextPage,
    ): Promise<ReactElement> => {
      if (!resolver.owns(page)) {
        throw new TypeError(
          "renderPage accepts only a page issued by this application's resolveRoute.",
        );
      }
      const updatesView =
        page.kind === "updates"
          ? (() => {
              const view = updatesState?.views.get(page.viewId);
              if (view === undefined) {
                return null;
              }
              if (page.pageSize === undefined) {
                return view;
              }
              const start = (page.pageNumber - 1) * page.pageSize;
              return Object.freeze({
                ...view,
                entries: Object.freeze(
                  view.entries.slice(start, start + page.pageSize),
                ),
              });
            })()
          : null;
      const beforeMain = await renderExtensionSlot(
        extensions,
        "page.before-main",
        page,
      );
      const afterMain = await renderExtensionSlot(
        extensions,
        "page.after-main",
        page,
      );
      return PublisherPageView({
        afterMain,
        beforeMain,
        homePath: resolver.homePath,
        markdownForBlock,
        page,
        readerBuildId: reader.buildId,
        sync,
        theme: themeResult.value.instance,
        updates: updatesView,
      });
    };

    const Page = async ({
      params,
    }: {
      readonly params: Promise<{
        readonly segments?: readonly string[];
      }>;
    }): Promise<ReactElement> => {
      const { segments } = await params;
      const resolved = resolver.resolve(
        decodeNextRouteSegments(segments),
      );
      if (resolved.status !== "resolved") {
        notFound();
      }
      return renderPage(resolved.page);
    };

    const generateMetadata = async ({
      params,
    }: {
      readonly params: Promise<{
        readonly segments?: readonly string[];
      }>;
    }): Promise<Metadata> => {
      const { segments } = await params;
      const resolved = resolver.resolve(
        decodeNextRouteSegments(segments),
      );
      if (resolved.status !== "resolved") {
        notFound();
      }
      return metadataForPage(
        resolved.page,
        resolved.page.kind === "updates"
          ? updatesState?.views.get(resolved.page.viewId)
          : undefined,
      );
    };
    const rootProps = Object.freeze({
      params: Promise.resolve(Object.freeze({})),
    });
    const staticParams = Object.freeze(
      routePlan.staticParams.filter(
        ({ segments }) => segments !== undefined,
      ),
    );

    const application: PublicationNextApplication = Object.freeze({
      reader,
      manifest: artifact.manifest,
      artifact,
      offlineCatalog,
      offlineCatalogText,
      theme: themeResult.value.instance,
      errorIdentity: errorIdentityResult.value,
      slashPolicy: routePlan.slashPolicy,
      staticParams,
      resolveRoute: resolver.resolve,
      renderPage,
      RootPage: () => Page(rootProps),
      NotFoundPage: () =>
        PublisherNotFoundView({
          homePath: resolver.homePath,
          publication: reader.publication,
          theme: themeResult.value.instance,
        }),
      Page,
      RootLayout({
        children,
      }: PublisherNextRootLayoutProps): ReactElement {
        return (
          <html lang={reader.publication.language}>
            <body>
              <PublisherReaderOfflineProvider
                catalogPath={offlineCatalog.catalogHref}
                publicationId={reader.publicationId}
                readerBuildId={reader.buildId}
                rendererBuildId={artifact.manifest.buildId}
              >
                <PublisherReaderNarrationProvider
                  audioPath="/publication-audio.json"
                  progressPath="/publication-reader-progress.json"
                  publicationId={reader.publicationId}
                  readerBuildId={reader.buildId}
                  themeStyle={publisherNextThemeStyle(themeResult.value.instance)}
                >
                  {children}
                </PublisherReaderNarrationProvider>
              </PublisherReaderOfflineProvider>
            </body>
          </html>
        );
      },
      generateStaticParams: () =>
        staticParams.flatMap(({ segments }) =>
          segments === undefined
            ? []
            : [{ segments: [...segments] }],
        ),
      generateRootMetadata: () => generateMetadata(rootProps),
      generateMetadata,
      handleRequest: continuity.handleRequest,
      createNextConfig: (baseConfig?: NextConfig) =>
        createPublisherNextConfig(routePlan, baseConfig),
    });
    return success(application);
  } catch {
    return failure(
      "next.application.creation_failed",
      "",
      "The Next.js application could not safely inspect its inputs.",
      "semanticValidation",
    );
  }
}
