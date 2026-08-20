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
  createReaderBookmarksStorageKey,
} from "@genii-foundation/publisher-reader/bookmarks";
import {
  createReaderPreferencesStorageKey,
} from "@genii-foundation/publisher-reader/preferences";
import {
  createReaderProgressStorageKey,
} from "@genii-foundation/publisher-reader/progress";
import {
  createReaderEngagementStorageKey,
  createReaderSyncConsentStorageKey,
} from "@genii-foundation/publisher-reader/sync";
import {
  createReaderNarrationPreferencesStorageKey,
  parseReaderNarrationEnvelope,
  type ReaderNarrationEnvelope,
} from "@genii-foundation/publisher-reader/narration";
import {
  applyReaderLinksToMarkdown,
  type ReaderBlockMarkdownLink,
} from "@genii-foundation/publisher-reader/markdown";
import type {
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
import {
  inspectCanonicalRoutePath,
} from "@genii-foundation/publisher-schema/routes";
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
  PublisherNextExtensionClientBoundary,
} from "../client/extension-boundary.js";
import {
  PublisherReaderNarrationProvider,
} from "../client/reader-narration-provider.js";
import {
  PublisherReaderOfflineProvider,
} from "../client/reader-offline-provider.js";
import {
  PublisherReaderPrepaint,
} from "../client/reader-prepaint.js";
import {
  createPublisherReaderStateBootstrapSource,
} from "../reader-state-bootstrap-source.js";
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
  type PublisherNextPlannedRoute,
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
  PUBLISHER_NEXT_EXTENSION_CLIENT_MOUNT,
  PUBLISHER_NEXT_EXTENSION_HOST_API_VERSION,
  PUBLISHER_NEXT_EXTENSION_HANDLER_MAXIMUM_BODY_BYTES,
  PUBLISHER_NEXT_EXTENSION_HANDLER_METHODS,
  PUBLISHER_NEXT_EXTENSION_SLOTS,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_API_VERSION,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_CONTAINERS,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_DEPTH,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_ENTRIES,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SCRIPT_BYTES,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_STATIC_SCRIPT_BYTES,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SOURCE_BYTES,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_PROJECTION_SCHEMA_VERSION,
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
  PublisherNextExtensionHandlerDescriptor,
  PublisherNextExtensionHandlerMethod,
  PublisherNextExtensionHost,
  PublisherNextExtensionRenderer,
  PublisherNextExtensionSlot,
  PublisherNextJsonObject,
  PublisherNextPage,
  PublisherNextReaderStateBootstrapContext,
  PublisherNextReaderStateBootstrapInstance,
  PublisherNextReaderStateBootstrapProjectionDescriptor,
  PublisherNextRouteResolution,
  PublisherNextRootLayoutProps,
  PublisherNextThemeInstance,
  PublisherNextUpdatesEntry,
  PublisherNextUpdatesInstance,
  PublisherNextUpdatesPage,
  PublisherNextUpdatesView,
  ResolvedPublisherNextTheme,
  ResolvedPublisherNextReaderStateBootstrap,
  ResolvedPublisherNextUpdates,
} from "../types.js";

const PACKAGE_NAME =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const UPDATE_ID = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,127}$/u;
const UPDATE_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const UPDATE_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const READER_STATE_PROJECTION_ARRAY_IS_ARRAY = Array.isArray;
const READER_STATE_PROJECTION_ARRAY_JOIN = Array.prototype.join;
const READER_STATE_PROJECTION_ARRAY_PROTOTYPE = Array.prototype;
const READER_STATE_PROJECTION_ARRAY_SORT = Array.prototype.sort;
const READER_STATE_PROJECTION_FUNCTION = Function;
const READER_STATE_PROJECTION_JSON_STRINGIFY = JSON.stringify;
const READER_STATE_PROJECTION_NUMBER = Number;
const READER_STATE_PROJECTION_NUMBER_IS_FINITE = Number.isFinite;
const READER_STATE_PROJECTION_NUMBER_IS_SAFE_INTEGER =
  Number.isSafeInteger;
const READER_STATE_PROJECTION_OBJECT_CREATE = Object.create;
const READER_STATE_PROJECTION_OBJECT_DEFINE_PROPERTY =
  Object.defineProperty;
const READER_STATE_PROJECTION_OBJECT_FREEZE = Object.freeze;
const READER_STATE_PROJECTION_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR =
  Object.getOwnPropertyDescriptor;
const READER_STATE_PROJECTION_OBJECT_GET_PROTOTYPE_OF =
  Object.getPrototypeOf;
const READER_STATE_PROJECTION_OBJECT_PROTOTYPE = Object.prototype;
const READER_STATE_PROJECTION_REGEXP_EXEC = RegExp.prototype.exec;
const READER_STATE_PROJECTION_REFLECT_APPLY = Reflect.apply;
const READER_STATE_PROJECTION_REFLECT_OWN_KEYS = Reflect.ownKeys;
const READER_STATE_PROJECTION_STRING = String;
const READER_STATE_PROJECTION_STRING_CHAR_CODE_AT =
  String.prototype.charCodeAt;
const READER_STATE_PROJECTION_TEXT_ENCODER = new TextEncoder();
const READER_STATE_PROJECTION_TEXT_ENCODE =
  TextEncoder.prototype.encode;
const READER_STATE_PROJECTION_WEAK_SET = WeakSet;
const READER_STATE_PROJECTION_WEAK_SET_ADD = WeakSet.prototype.add;
const READER_STATE_PROJECTION_WEAK_SET_DELETE =
  WeakSet.prototype.delete;
const READER_STATE_PROJECTION_WEAK_SET_HAS = WeakSet.prototype.has;
const READER_STATE_PROJECTION_UNSAFE_SOURCE =
  /<\/?script|<!--|-->/iu;
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

interface ResolvedReaderStateBootstrapState {
  readonly identity: {
    readonly package: string;
    readonly version: string;
    readonly rendererCompatibility: string;
  };
  readonly configHash: ReturnType<typeof hashCanonicalJson>;
  readonly context: PublisherNextReaderStateBootstrapContext;
  readonly projection: {
    readonly text: string;
    readonly descriptor:
      PublisherNextReaderStateBootstrapProjectionDescriptor;
  } | null;
  readonly script: string;
  readonly scriptBytes: number;
  readonly source: string;
  readonly sourceHash: ReturnType<typeof sha256>;
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
  readonly host: PublisherNextExtensionHost | null;
  readonly handlers: readonly PublisherNextExtensionHandlerDescriptor[];
  readonly clientData?: JSONValue;
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
  return READER_STATE_PROJECTION_OBJECT_FREEZE({
    code,
    severity: "error",
    path,
    message,
    keyword,
    params: READER_STATE_PROJECTION_OBJECT_FREEZE({ ...params }),
  });
}

function failure<T>(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>> = {},
): ValidationResult<T> {
  return READER_STATE_PROJECTION_OBJECT_FREEZE({
    valid: false,
    diagnostics: READER_STATE_PROJECTION_OBJECT_FREEZE([
      diagnostic(code, path, message, keyword, params),
    ]),
  });
}

function success<T>(value: T): ValidationResult<T> {
  return READER_STATE_PROJECTION_OBJECT_FREEZE({
    valid: true,
    value,
    diagnostics: READER_STATE_PROJECTION_OBJECT_FREEZE([]),
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
    const prototype =
      READER_STATE_PROJECTION_OBJECT_GET_PROTOTYPE_OF(value);
    if (
      prototype !== READER_STATE_PROJECTION_OBJECT_PROTOTYPE &&
      prototype !== null
    ) {
      return null;
    }
    const keys = READER_STATE_PROJECTION_REFLECT_OWN_KEYS(value);
    const descriptors = READER_STATE_PROJECTION_OBJECT_CREATE(
      null,
    ) as Record<string, PropertyDescriptor>;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex];
      if (typeof key !== "string") {
        return null;
      }
      let allowed = false;
      for (
        let requiredIndex = 0;
        requiredIndex < requiredKeys.length;
        requiredIndex += 1
      ) {
        if (requiredKeys[requiredIndex] === key) {
          allowed = true;
          break;
        }
      }
      if (!allowed) {
        for (
          let optionalIndex = 0;
          optionalIndex < optionalKeys.length;
          optionalIndex += 1
        ) {
          if (optionalKeys[optionalIndex] === key) {
            allowed = true;
            break;
          }
        }
      }
      const descriptor =
        READER_STATE_PROJECTION_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
          value,
          key,
        );
      if (
        !allowed ||
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return null;
      }
      READER_STATE_PROJECTION_OBJECT_DEFINE_PROPERTY(
        descriptors,
        key,
        {
          value: descriptor,
          enumerable: true,
          configurable: false,
          writable: false,
        },
      );
    }
    for (
      let requiredIndex = 0;
      requiredIndex < requiredKeys.length;
      requiredIndex += 1
    ) {
      if (descriptors[requiredKeys[requiredIndex] ?? ""] === undefined) {
        return null;
      }
    }
    return READER_STATE_PROJECTION_OBJECT_FREEZE({
      descriptors:
        READER_STATE_PROJECTION_OBJECT_FREEZE(descriptors),
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
  "renderer.client",
  "host.route",
  "host.handler",
] as const);

function extensionHandlers(
  value: unknown,
  extensionId: string,
  path: string,
  ownedPaths: Set<string>,
): ValidationResult<readonly PublisherNextExtensionHandlerDescriptor[]> {
  const handlers = inspectArray(value, 1_000);
  if (handlers === null) {
    return failure(
      "next.extension.handlers_invalid",
      path,
      "Extension handlers must be one bounded descriptor array.",
      "type",
    );
  }
  const result: PublisherNextExtensionHandlerDescriptor[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  const namespace = `/api/extensions/${extensionId}`;
  for (let index = 0; index < handlers.length; index += 1) {
    const handlerPath = `${path}/${index}`;
    const handler = inspectRecord(
      handlers[index],
      ["id", "path", "methods"],
      ["data"],
    );
    const id = handler === null ? undefined : valueOf(handler, "id");
    const publicPath = handler === null
      ? undefined
      : valueOf(handler, "path");
    const methods = handler === null
      ? null
      : inspectArray(
          valueOf(handler, "methods"),
          PUBLISHER_NEXT_EXTENSION_HANDLER_METHODS.length,
        );
    if (
      handler === null ||
      typeof id !== "string" ||
      id.length > 128 ||
      !EXTENSION_ID.test(id) ||
      ids.has(id) ||
      typeof publicPath !== "string" ||
      !inspectCanonicalRoutePath(publicPath).valid ||
      (publicPath !== namespace && !publicPath.startsWith(`${namespace}/`)) ||
      publicPath.endsWith("/") ||
      methods === null ||
      methods.length === 0 ||
      methods.some(
        (method, methodIndex) =>
          typeof method !== "string" ||
          !PUBLISHER_NEXT_EXTENSION_HANDLER_METHODS.includes(
            method as PublisherNextExtensionHandlerMethod,
          ) ||
          methods.indexOf(method) !== methodIndex,
      ) ||
      paths.has(publicPath) ||
      ownedPaths.has(publicPath)
    ) {
      return failure(
        "next.extension.handler_invalid",
        handlerPath,
        "Extension handlers require a unique ID, an owned API path, and a nonempty unique method list.",
        "handler",
      );
    }
    ids.add(id);
    paths.add(publicPath);
    ownedPaths.add(publicPath);
    const data = valueOf(handler, "data");
    result.push(Object.freeze({
      id,
      path: publicPath,
      methods: Object.freeze(
        [...methods] as PublisherNextExtensionHandlerMethod[],
      ),
      ...(data === undefined ? {} : { data: data as JSONValue }),
    }));
  }
  return success(Object.freeze(result));
}

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
  const extensionIds = new Set<string>();
  const ownedHandlerPaths = new Set<string>([
    ...reader.routes.active.map(({ path }) => path),
    ...reader.routes.redirects.map(({ from }) => from),
  ]);
  for (const entryValue of dataEntries) {
    if (
      entryValue === null ||
      typeof entryValue !== "object" ||
      Array.isArray(entryValue)
    ) {
      continue;
    }
    const routes = (entryValue as Readonly<Record<string, unknown>>).routes;
    if (!Array.isArray(routes)) continue;
    for (const route of routes) {
      const routePath = route !== null && typeof route === "object"
        ? (route as Readonly<Record<string, unknown>>).path
        : undefined;
      if (
        route !== null &&
        typeof route === "object" &&
        !Array.isArray(route) &&
        typeof routePath === "string"
      ) {
        ownedHandlerPaths.add(routePath);
      }
    }
  }
  for (let index = 0; index < dataEntries.length; index += 1) {
    const path = `/extensionData/extensions/${index}`;
    const entryValue = dataEntries[index];
    const entry = inspectRecord(
      entryValue,
      ["id", "package", "version", "capabilities", "config"],
      ["serverData", "clientData", "routes", "handlers"],
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
      ["renderer", "host"],
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
      id.length > 128 ||
      !EXTENSION_ID.test(id) ||
      extensionIds.has(id) ||
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
    extensionIds.add(id);
    const clientData = valueOf(entry, "clientData");
    const routeData = valueOf(entry, "routes");
    const handlerData = valueOf(entry, "handlers");
    if (
      clientData !== undefined &&
      !entryCapabilities.includes("renderer.client")
    ) {
      return failure(
        "next.extension.client_data_ungranted",
        `${path}/clientData`,
        "Browser data requires the renderer.client grant.",
        "extensionCapability",
      );
    }
    if (
      (entryCapabilities.includes("host.handler") &&
        !Array.isArray(handlerData)) ||
      (!entryCapabilities.includes("host.handler") &&
        handlerData !== undefined)
    ) {
      return failure(
        "next.extension.handler_data_ungranted",
        `${path}/handlers`,
        "Declarative handler data requires the host.handler grant, and every host.handler grant requires handler data.",
        "extensionCapability",
      );
    }
    const handlersResult = entryCapabilities.includes("host.handler")
      ? extensionHandlers(
          handlerData,
          id,
          `${path}/handlers`,
          ownedHandlerPaths,
        )
      : success(Object.freeze([]));
    if (!handlersResult.valid) {
      return handlersResult;
    }
    if (
      (entryCapabilities.includes("host.route") &&
        !Array.isArray(routeData)) ||
      (!entryCapabilities.includes("host.route") &&
        routeData !== undefined)
    ) {
      return failure(
        "next.extension.route_data_ungranted",
        `${path}/routes`,
        "Declarative route data requires the host.route grant, and every host.route grant requires route data.",
        "extensionCapability",
      );
    }
    const granted = Object.freeze(
      [...entryCapabilities] as ExtensionCapability[],
    );
    const rendererValue = valueOf(registration, "renderer");
    let renderer: PublisherNextExtensionRenderer | null = null;
    if (
      granted.includes("renderer.slot") ||
      granted.includes("renderer.client")
    ) {
      const inspectedRenderer = inspectRecord(
        rendererValue,
        ["kind", "apiVersion", "rendererCompatibility"],
        ["Client", "renderSlot"],
      );
      const rendererCompatibility = inspectedRenderer === null
        ? undefined
        : valueOf(inspectedRenderer, "rendererCompatibility");
      const renderSlot = inspectedRenderer === null
        ? undefined
        : valueOf(inspectedRenderer, "renderSlot");
      const Client = inspectedRenderer === null
        ? undefined
        : valueOf(inspectedRenderer, "Client");
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
        (granted.includes("renderer.slot") &&
          typeof renderSlot !== "function") ||
        (granted.includes("renderer.client") &&
          typeof Client !== "function")
      ) {
        return failure(
          "next.extension.renderer_invalid",
          `/extensions/${index}/renderer`,
          "Renderer grants require one compatible official Next adapter with every granted entry point.",
          "extensionRenderer",
        );
      }
      renderer = Object.freeze({
        kind: "genii.publisher.next-extension" as const,
        apiVersion: PUBLISHER_NEXT_EXTENSION_API_VERSION,
        rendererCompatibility,
        ...(granted.includes("renderer.slot")
          ? {
              renderSlot: renderSlot as NonNullable<
                PublisherNextExtensionRenderer["renderSlot"]
              >,
            }
          : {}),
        ...(granted.includes("renderer.client")
          ? {
              Client: Client as NonNullable<
                PublisherNextExtensionRenderer["Client"]
              >,
            }
          : {}),
      });
    }
    const hostValue = valueOf(registration, "host");
    let host: PublisherNextExtensionHost | null = null;
    if (
      granted.includes("host.route") ||
      granted.includes("host.handler")
    ) {
      const inspectedHost = inspectRecord(
        hostValue,
        ["kind", "apiVersion", "rendererCompatibility"],
        ["renderRoute", "handleRequest"],
      );
      const hostCompatibility = inspectedHost === null
        ? undefined
        : valueOf(inspectedHost, "rendererCompatibility");
      const renderRoute = inspectedHost === null
        ? undefined
        : valueOf(inspectedHost, "renderRoute");
      const handleRequest = inspectedHost === null
        ? undefined
        : valueOf(inspectedHost, "handleRequest");
      if (
        inspectedHost === null ||
        valueOf(inspectedHost, "kind") !==
          "genii.publisher.next-host-extension" ||
        valueOf(inspectedHost, "apiVersion") !==
          PUBLISHER_NEXT_EXTENSION_HOST_API_VERSION ||
        typeof hostCompatibility !== "string" ||
        validRange(hostCompatibility) === null ||
        !satisfies(PUBLISHER_NEXT_VERSION, hostCompatibility, {
          includePrerelease: true,
        }) ||
        (granted.includes("host.route") &&
          typeof renderRoute !== "function") ||
        (granted.includes("host.handler") &&
          typeof handleRequest !== "function")
      ) {
        return failure(
          "next.extension.host_invalid",
          `/extensions/${index}/host`,
          "Host grants require one compatible official Next host adapter with every granted entry point.",
          "extensionHost",
        );
      }
      host = Object.freeze({
        kind: "genii.publisher.next-host-extension" as const,
        apiVersion: PUBLISHER_NEXT_EXTENSION_HOST_API_VERSION,
        rendererCompatibility: hostCompatibility,
        ...(granted.includes("host.route")
          ? {
              renderRoute: renderRoute as NonNullable<
                PublisherNextExtensionHost["renderRoute"]
              >,
            }
          : {}),
        ...(granted.includes("host.handler")
          ? {
              handleRequest: handleRequest as NonNullable<
                PublisherNextExtensionHost["handleRequest"]
              >,
            }
          : {}),
      });
    }
    entries.push(Object.freeze({
      id,
      package: packageName,
      version,
      capabilities: granted,
      projectionHash: hashCanonicalJson(entryValue as JSONValue),
      renderer,
      host,
      handlers: handlersResult.value,
      ...(clientData === undefined
        ? {}
        : { clientData: clientData as JSONValue }),
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

const EXTENSION_HANDLER_FORBIDDEN_RESPONSE_HEADER_PREFIXES =
  Object.freeze([
    "x-middleware-",
    "x-nextjs-",
  ] as const);

function extensionHandlerErrorResponse(
  status: number,
  message: string,
  headers?: HeadersInit,
): Response {
  return new Response(`${message}\n`, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

async function boundedExtensionHandlerRequest(
  request: Request,
): Promise<Request | Response> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    /^\d+$/u.test(contentLength) &&
    Number(contentLength) >
      PUBLISHER_NEXT_EXTENSION_HANDLER_MAXIMUM_BODY_BYTES
  ) {
    return extensionHandlerErrorResponse(
      413,
      "Extension request body is too large.",
    );
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (
    request.body !== null &&
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    const reader = request.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (
        totalBytes >
          PUBLISHER_NEXT_EXTENSION_HANDLER_MAXIMUM_BODY_BYTES
      ) {
        await reader.cancel().catch(() => undefined);
        return extensionHandlerErrorResponse(
          413,
          "Extension request body is too large.",
        );
      }
      chunks.push(chunk.value);
    }
  }
  const body = totalBytes === 0
    ? undefined
    : (() => {
        const snapshot = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          snapshot.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return snapshot;
      })();
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: new Headers(request.headers),
    redirect: "manual",
    ...(body === undefined ? {} : { body, duplex: "half" as const }),
  };
  return new Request(request.url, init);
}

function createExtensionRequestHandler(
  extensions: ResolvedExtensionsState | null,
): (request: Request) => Promise<Response | undefined> {
  const handlers = new Map<string, {
    readonly extension: ResolvedExtensionEntry;
    readonly handler: PublisherNextExtensionHandlerDescriptor;
  }>();
  for (const extension of extensions?.entries ?? []) {
    for (const handler of extension.handlers) {
      handlers.set(handler.path, Object.freeze({ extension, handler }));
    }
  }
  return async (request: Request): Promise<Response | undefined> => {
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return undefined;
    }
    const target = handlers.get(pathname);
    if (target === undefined) return undefined;
    if (
      !target.handler.methods.includes(
        request.method as PublisherNextExtensionHandlerMethod,
      )
    ) {
      return extensionHandlerErrorResponse(
        405,
        "Method not allowed.",
        { allow: target.handler.methods.join(", ") },
      );
    }
    try {
      const detached = await boundedExtensionHandlerRequest(request);
      if (detached instanceof Response) return detached;
      const response = await target.extension.host?.handleRequest?.(
        Object.freeze({
          handler: target.handler,
          request: detached,
          ...(target.extension.serverData === undefined
            ? {}
            : { serverData: target.extension.serverData }),
        }),
      );
      if (!(response instanceof Response)) {
        throw new TypeError("invalid extension handler response");
      }
      for (const [name] of response.headers) {
        if (
          EXTENSION_HANDLER_FORBIDDEN_RESPONSE_HEADER_PREFIXES.some(
            (prefix) => name.startsWith(prefix),
          )
        ) {
          throw new TypeError("forbidden extension handler response header");
        }
      }
      return response;
    } catch {
      return extensionHandlerErrorResponse(
        500,
        "Extension request failed.",
      );
    }
  };
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
  const extension = page.kind === "extension"
    ? Object.freeze({ id: page.extensionId, routeId: page.routeId })
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
    ...(extension === undefined ? {} : { extension }),
  });
}

async function renderExtensionRoute(
  extensions: ResolvedExtensionsState | null,
  page: Extract<PublisherNextPage, { readonly kind: "extension" }>,
) {
  const extension = extensions?.entries.find(
    ({ id }) => id === page.extensionId,
  );
  const renderRoute = extension?.host?.renderRoute;
  if (
    extension === undefined ||
    !extension.capabilities.includes("host.route") ||
    renderRoute === undefined
  ) {
    throw new TypeError(
      `Extension route ${JSON.stringify(page.routeId)} has no compatible host adapter.`,
    );
  }
  try {
    return await renderRoute(Object.freeze({
      page,
      ...(extension.serverData === undefined
        ? {}
        : { serverData: extension.serverData }),
    }));
  } catch {
    throw new TypeError(
      `Extension ${JSON.stringify(extension.id)} threw while rendering route ${JSON.stringify(page.routeId)}.`,
    );
  }
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
    const renderSlot = extension.renderer?.renderSlot;
    if (
      !extension.capabilities.includes("renderer.slot") ||
      renderSlot === undefined
    ) {
      continue;
    }
    let body;
    try {
      body = await renderSlot(Object.freeze({
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

function renderExtensionClients(
  extensions: ResolvedExtensionsState | null,
  page: PublisherNextPage,
): ReactElement[] {
  const context = extensionPageContext(page);
  const rendered: ReactElement[] = [];
  for (const extension of extensions?.entries ?? []) {
    const Client = extension.renderer?.Client;
    if (
      !extension.capabilities.includes("renderer.client") ||
      Client === undefined
    ) {
      continue;
    }
    rendered.push(
      <div
        data-publisher-client={PUBLISHER_NEXT_EXTENSION_CLIENT_MOUNT}
        data-publisher-extension={extension.id}
        key={`${PUBLISHER_NEXT_EXTENSION_CLIENT_MOUNT}:${extension.id}`}
      >
        <PublisherNextExtensionClientBoundary
          extensionId={extension.id}
        >
          <Client
            mount={PUBLISHER_NEXT_EXTENSION_CLIENT_MOUNT}
            page={context}
            {...(extension.clientData === undefined
              ? {}
              : { clientData: extension.clientData })}
          />
        </PublisherNextExtensionClientBoundary>
      </div>,
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

function createReaderStateBootstrapContext(
  publicationId: string,
): PublisherNextReaderStateBootstrapContext {
  return Object.freeze({
    publicationId,
    reportStorageKey:
      `genii.publisher.reader-state-bootstrap.v1.${publicationId}`,
    targetStorageKeys: Object.freeze({
      bookmarks: createReaderBookmarksStorageKey(publicationId),
      engagement: createReaderEngagementStorageKey(publicationId),
      narrationPreferences:
        createReaderNarrationPreferencesStorageKey(publicationId),
      preferences: createReaderPreferencesStorageKey(publicationId),
      progress: createReaderProgressStorageKey(publicationId),
      syncConsent: createReaderSyncConsentStorageKey(publicationId),
    }),
  });
}

function readerStateBootstrapSourceValue(
  result: unknown,
): ValidationResult<string> {
  const inspected = inspectRecord(
    result,
    ["diagnostics", "valid"],
    ["value"],
  );
  if (inspected === null) {
    return failure(
      "next.reader_state_bootstrap.source_result_invalid",
      "/readerStateBootstrap",
      "The Reader state bootstrap returned an invalid source result.",
      "type",
    );
  }
  if (valueOf(inspected, "valid") === false) {
    return failure(
      "next.reader_state_bootstrap.source_rejected",
      "/readerStateBootstrap",
      "The Reader state bootstrap refused to create browser source.",
      "adapter",
    );
  }
  const source = valueOf(inspected, "value");
  if (
    valueOf(inspected, "valid") !== true ||
    typeof source !== "string" ||
    source.length === 0
  ) {
    return failure(
      "next.reader_state_bootstrap.source_result_invalid",
      "/readerStateBootstrap",
      "The Reader state bootstrap must return one nonempty JavaScript function body.",
      "type",
    );
  }
  return success(source);
}

type ReaderStateBootstrapProjectionFailure =
  | "bytes"
  | "containers"
  | "depth"
  | "entries"
  | "json";

class ReaderStateBootstrapProjectionError extends Error {
  readonly kind: ReaderStateBootstrapProjectionFailure;
  readonly actual: number | null;
  readonly maximum: number | null;

  constructor(
    kind: ReaderStateBootstrapProjectionFailure,
    actual: number | null = null,
    maximum: number | null = null,
  ) {
    super(kind);
    this.kind = kind;
    this.actual = actual;
    this.maximum = maximum;
  }
}

interface ReaderStateBootstrapProjectionSnapshot {
  readonly text: string;
  readonly descriptor:
    PublisherNextReaderStateBootstrapProjectionDescriptor;
}

function canonicalJsonStringByteSize(
  value: string,
  initialByteSize: number,
): number {
  let byteSize = initialByteSize + 2;
  if (
    byteSize >
    PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES
  ) {
    throw new ReaderStateBootstrapProjectionError(
      "bytes",
      byteSize,
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = READER_STATE_PROJECTION_REFLECT_APPLY(
      READER_STATE_PROJECTION_STRING_CHAR_CODE_AT,
      value,
      [index],
    );
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = READER_STATE_PROJECTION_REFLECT_APPLY(
        READER_STATE_PROJECTION_STRING_CHAR_CODE_AT,
        value,
        [index + 1],
      );
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new ReaderStateBootstrapProjectionError("json");
      }
      byteSize += 4;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new ReaderStateBootstrapProjectionError("json");
    } else if (unit === 0x22 || unit === 0x5c) {
      byteSize += 2;
    } else if (unit < 0x20) {
      byteSize +=
        unit === 0x08 ||
        unit === 0x09 ||
        unit === 0x0a ||
        unit === 0x0c ||
        unit === 0x0d
          ? 2
          : 6;
    } else if (unit < 0x80) {
      byteSize += 1;
    } else if (unit < 0x800) {
      byteSize += 2;
    } else {
      byteSize += 3;
    }
    if (
      byteSize >
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES
    ) {
      throw new ReaderStateBootstrapProjectionError(
        "bytes",
        byteSize,
        PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES,
      );
    }
  }
  return byteSize;
}

function snapshotReaderStateBootstrapProjection(
  data: unknown,
  reader: PublicationReaderEnvelope,
): ReaderStateBootstrapProjectionSnapshot {
  if (
    data === null ||
    typeof data !== "object" ||
    READER_STATE_PROJECTION_ARRAY_IS_ARRAY(data)
  ) {
    throw new ReaderStateBootstrapProjectionError("json");
  }

  const output: string[] = [];
  let outputLength = 0;
  const active = new READER_STATE_PROJECTION_WEAK_SET<object>();
  let byteSize = 0;
  let containerCount = 0;
  let entryCount = 0;

  const appendOutput = (value: string): void => {
    READER_STATE_PROJECTION_OBJECT_DEFINE_PROPERTY(
      output,
      READER_STATE_PROJECTION_STRING(outputLength),
      {
        value,
        enumerable: true,
        configurable: false,
        writable: false,
      },
    );
    outputLength += 1;
  };

  const appendAscii = (value: string): void => {
    byteSize += value.length;
    if (
      byteSize >
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES
    ) {
      throw new ReaderStateBootstrapProjectionError(
        "bytes",
        byteSize,
        PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES,
      );
    }
    appendOutput(value);
  };
  const appendString = (value: string): void => {
    byteSize = canonicalJsonStringByteSize(value, byteSize);
    const serialized = READER_STATE_PROJECTION_JSON_STRINGIFY(value);
    if (typeof serialized !== "string") {
      throw new ReaderStateBootstrapProjectionError("json");
    }
    appendOutput(serialized);
  };
  const enterEntries = (count: number): void => {
    entryCount += count;
    if (
      entryCount >
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_ENTRIES
    ) {
      throw new ReaderStateBootstrapProjectionError(
        "entries",
        entryCount,
        PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_ENTRIES,
      );
    }
  };

  const writeValue = (value: unknown, depth: number): void => {
    if (value === null) {
      appendAscii("null");
      return;
    }
    if (typeof value === "string") {
      appendString(value);
      return;
    }
    if (typeof value === "boolean") {
      appendAscii(value ? "true" : "false");
      return;
    }
    if (typeof value === "number") {
      if (!READER_STATE_PROJECTION_NUMBER_IS_FINITE(value)) {
        throw new ReaderStateBootstrapProjectionError("json");
      }
      const serialized = READER_STATE_PROJECTION_JSON_STRINGIFY(value);
      if (typeof serialized !== "string") {
        throw new ReaderStateBootstrapProjectionError("json");
      }
      appendAscii(serialized);
      return;
    }
    if (typeof value !== "object") {
      throw new ReaderStateBootstrapProjectionError("json");
    }
    if (
      depth >
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_DEPTH
    ) {
      throw new ReaderStateBootstrapProjectionError(
        "depth",
        depth,
        PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_DEPTH,
      );
    }
    containerCount += 1;
    if (
      containerCount >
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_CONTAINERS
    ) {
      throw new ReaderStateBootstrapProjectionError(
        "containers",
        containerCount,
        PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_CONTAINERS,
      );
    }
    if (
      READER_STATE_PROJECTION_REFLECT_APPLY(
        READER_STATE_PROJECTION_WEAK_SET_HAS,
        active,
        [value],
      )
    ) {
      throw new ReaderStateBootstrapProjectionError("json");
    }

    const array = READER_STATE_PROJECTION_ARRAY_IS_ARRAY(value);
    let prototype: object | null;
    try {
      prototype = READER_STATE_PROJECTION_OBJECT_GET_PROTOTYPE_OF(
        value,
      );
    } catch {
      throw new ReaderStateBootstrapProjectionError("json");
    }
    if (
      (!array &&
        prototype !== READER_STATE_PROJECTION_OBJECT_PROTOTYPE &&
        prototype !== null) ||
      (array &&
        prototype !== READER_STATE_PROJECTION_ARRAY_PROTOTYPE)
    ) {
      throw new ReaderStateBootstrapProjectionError("json");
    }

    READER_STATE_PROJECTION_REFLECT_APPLY(
      READER_STATE_PROJECTION_WEAK_SET_ADD,
      active,
      [value],
    );
    try {
      if (array) {
        let lengthDescriptor: PropertyDescriptor | undefined;
        try {
          lengthDescriptor =
            READER_STATE_PROJECTION_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
            value,
            "length",
          );
        } catch {
          throw new ReaderStateBootstrapProjectionError("json");
        }
        const length =
          lengthDescriptor !== undefined &&
          "value" in lengthDescriptor
            ? lengthDescriptor.value
            : undefined;
        if (
          typeof length !== "number" ||
          !READER_STATE_PROJECTION_NUMBER_IS_SAFE_INTEGER(length) ||
          length < 0
        ) {
          throw new ReaderStateBootstrapProjectionError("json");
        }
        enterEntries(length);
        let keys: readonly PropertyKey[];
        try {
          keys = READER_STATE_PROJECTION_REFLECT_OWN_KEYS(value);
        } catch {
          throw new ReaderStateBootstrapProjectionError("json");
        }
        if (keys.length !== length + 1) {
          throw new ReaderStateBootstrapProjectionError("json");
        }
        for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
          const key = keys[keyIndex];
          if (key === "length") continue;
          if (
            typeof key !== "string" ||
            READER_STATE_PROJECTION_STRING(
              READER_STATE_PROJECTION_NUMBER(key),
            ) !== key ||
            READER_STATE_PROJECTION_NUMBER(key) >= length
          ) {
            throw new ReaderStateBootstrapProjectionError("json");
          }
        }
        appendAscii("[");
        for (let index = 0; index < length; index += 1) {
          let descriptor: PropertyDescriptor | undefined;
          try {
            descriptor =
              READER_STATE_PROJECTION_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
              value,
              READER_STATE_PROJECTION_STRING(index),
            );
          } catch {
            throw new ReaderStateBootstrapProjectionError("json");
          }
          if (
            descriptor === undefined ||
            !descriptor.enumerable ||
            !("value" in descriptor)
          ) {
            throw new ReaderStateBootstrapProjectionError("json");
          }
          if (index > 0) appendAscii(",");
          writeValue(descriptor.value, depth + 1);
        }
        appendAscii("]");
        return;
      }

      let keys: PropertyKey[];
      try {
        keys = READER_STATE_PROJECTION_REFLECT_OWN_KEYS(value);
      } catch {
        throw new ReaderStateBootstrapProjectionError("json");
      }
      enterEntries(keys.length);
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        if (typeof keys[keyIndex] !== "string") {
          throw new ReaderStateBootstrapProjectionError("json");
        }
      }
      const stringKeys = keys as string[];
      READER_STATE_PROJECTION_REFLECT_APPLY(
        READER_STATE_PROJECTION_ARRAY_SORT,
        stringKeys,
        [],
      );
      appendAscii("{");
      for (let index = 0; index < stringKeys.length; index += 1) {
        const key = stringKeys[index];
        if (key === undefined) continue;
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor =
            READER_STATE_PROJECTION_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
              value,
              key,
            );
        } catch {
          throw new ReaderStateBootstrapProjectionError("json");
        }
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          throw new ReaderStateBootstrapProjectionError("json");
        }
        if (index > 0) appendAscii(",");
        appendString(key);
        appendAscii(":");
        writeValue(descriptor.value, depth + 1);
      }
      appendAscii("}");
    } finally {
      READER_STATE_PROJECTION_REFLECT_APPLY(
        READER_STATE_PROJECTION_WEAK_SET_DELETE,
        active,
        [value],
      );
    }
  };

  appendAscii("{");
  appendString("buildId");
  appendAscii(":");
  appendString(reader.buildId);
  appendAscii(",");
  appendString("data");
  appendAscii(":");
  writeValue(data, 1);
  appendAscii(",");
  appendString("engineVersion");
  appendAscii(":");
  appendString(reader.engineVersion);
  appendAscii(",");
  appendString("publicationId");
  appendAscii(":");
  appendString(reader.publicationId);
  appendAscii(",");
  appendString("schemaVersion");
  appendAscii(":");
  appendString(
    PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_PROJECTION_SCHEMA_VERSION,
  );
  appendAscii("}");

  const text = READER_STATE_PROJECTION_REFLECT_APPLY(
    READER_STATE_PROJECTION_ARRAY_JOIN,
    output,
    [""],
  );
  return READER_STATE_PROJECTION_OBJECT_FREEZE({
    text,
    descriptor: READER_STATE_PROJECTION_OBJECT_FREEZE({
      schemaVersion:
        PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_PROJECTION_SCHEMA_VERSION,
      byteSize,
      hash: sha256(text),
    }),
  });
}

function readerStateBootstrapProjectionValue(
  result: unknown,
  reader: PublicationReaderEnvelope,
): ValidationResult<ReaderStateBootstrapProjectionSnapshot> {
  const inspected = inspectRecord(
    result,
    ["diagnostics", "valid"],
    ["value"],
  );
  if (inspected === null) {
    return failure(
      "next.reader_state_bootstrap.projection_result_invalid",
      "/readerStateBootstrap",
      "The Reader state bootstrap returned an invalid projection result.",
      "type",
    );
  }
  if (valueOf(inspected, "valid") === false) {
    return failure(
      "next.reader_state_bootstrap.projection_rejected",
      "/readerStateBootstrap",
      "The Reader state bootstrap refused to create a state projection.",
      "adapter",
    );
  }
  if (
    valueOf(inspected, "valid") !== true ||
    !Object.hasOwn(inspected.descriptors, "value")
  ) {
    return failure(
      "next.reader_state_bootstrap.projection_result_invalid",
      "/readerStateBootstrap",
      "The Reader state bootstrap returned an invalid projection result.",
      "type",
    );
  }
  const value = valueOf(inspected, "value");
  if (
    value === null ||
    typeof value !== "object" ||
    READER_STATE_PROJECTION_ARRAY_IS_ARRAY(value)
  ) {
    return failure(
      "next.reader_state_bootstrap.projection_root_invalid",
      "/readerStateBootstrap",
      "Reader state projection data must be one plain JSON object.",
      "type",
    );
  }
  try {
    return success(
      snapshotReaderStateBootstrapProjection(value, reader),
    );
  } catch (error) {
    const kind =
      error instanceof ReaderStateBootstrapProjectionError
        ? error.kind
        : "json";
    const details = {
      bytes: [
        "next.reader_state_bootstrap.projection_too_large",
        "Reader state projection exceeds the renderer byte limit.",
        "maxLength",
      ],
      containers: [
        "next.reader_state_bootstrap.projection_too_many_containers",
        "Reader state projection exceeds the renderer container limit.",
        "maxItems",
      ],
      depth: [
        "next.reader_state_bootstrap.projection_too_deep",
        "Reader state projection exceeds the renderer depth limit.",
        "maxDepth",
      ],
      entries: [
        "next.reader_state_bootstrap.projection_too_many_entries",
        "Reader state projection exceeds the renderer entry limit.",
        "maxItems",
      ],
      json: [
        "next.reader_state_bootstrap.projection_json_invalid",
        "Reader state projection must be finite, acyclic plain JSON data.",
        "json",
      ],
    } as const;
    const detail = details[kind];
    const code = detail[0];
    const message = detail[1];
    const rule = detail[2];
    const params =
      error instanceof ReaderStateBootstrapProjectionError &&
      error.actual !== null &&
      error.maximum !== null
        ? kind === "bytes"
          ? {
              actualBytes: error.actual,
              maximumBytes: error.maximum,
            }
          : kind === "depth"
            ? {
                actualDepth: error.actual,
                maximumDepth: error.maximum,
              }
            : {
                actualItems: error.actual,
                maximumItems: error.maximum,
              }
        : {};
    return failure(
      code,
      "/readerStateBootstrap",
      message,
      rule,
      params,
    );
  }
}

function resolveReaderStateBootstrap(
  resolved: ResolvedPublisherNextReaderStateBootstrap,
  reader: PublicationReaderEnvelope,
): ValidationResult<ResolvedReaderStateBootstrapState> {
  const inspected = inspectRecord(resolved, [
    "config",
    "implementation",
    "package",
    "rendererCompatibility",
    "version",
  ]);
  if (inspected === null) {
    return failure(
      "next.reader_state_bootstrap.resolution_invalid",
      "/readerStateBootstrap",
      "The resolved Reader state bootstrap must use the complete closed adapter shape.",
      "properties",
    );
  }
  const identity = inspectIdentity(
    valueOf(inspected, "package"),
    valueOf(inspected, "version"),
    valueOf(inspected, "rendererCompatibility"),
    "/readerStateBootstrap",
  );
  if (!identity.valid) return identity;
  const config = snapshotJsonObject(
    valueOf(inspected, "config"),
    "/readerStateBootstrap/config",
  );
  if (!config.valid) return config;
  const configHash = hashCanonicalJson(config.value);
  const context = createReaderStateBootstrapContext(
    reader.publicationId,
  );
  const implementation = inspectRecord(
    valueOf(inspected, "implementation"),
    ["apiVersion", "configure", "kind"],
  );
  if (
    implementation === null ||
    valueOf(implementation, "kind") !==
      "genii.publisher.next-reader-state-bootstrap" ||
    valueOf(implementation, "apiVersion") !==
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_API_VERSION ||
    typeof valueOf(implementation, "configure") !== "function"
  ) {
    return failure(
      "next.reader_state_bootstrap.implementation_invalid",
      "/readerStateBootstrap/implementation",
      "The Reader state bootstrap does not match the renderer bootstrap API.",
      "apiVersion",
    );
  }
  let configured: unknown;
  try {
    configured = READER_STATE_PROJECTION_REFLECT_APPLY(
      valueOf(implementation, "configure") as (
        config: PublisherNextJsonObject,
      ) => unknown,
      valueOf(inspected, "implementation"),
      [config.value],
    );
  } catch {
    return failure(
      "next.reader_state_bootstrap.configuration_threw",
      "/readerStateBootstrap/config",
      "The Reader state bootstrap threw while configuring.",
      "adapter",
    );
  }
  const configuredBootstrap = configuredValue(
    configured,
    "/readerStateBootstrap/config",
  );
  if (!configuredBootstrap.valid) return configuredBootstrap;
  const instance = inspectRecord(
    configuredBootstrap.value,
    ["createSource"],
    ["createProjection"],
  );
  const createProjection =
    instance === null
      ? undefined
      : valueOf(instance, "createProjection");
  if (
    instance === null ||
    typeof valueOf(instance, "createSource") !== "function" ||
    (createProjection !== undefined &&
      typeof createProjection !== "function")
  ) {
    return failure(
      "next.reader_state_bootstrap.instance_invalid",
      "/readerStateBootstrap",
      "The Reader state bootstrap must return createSource and may return createProjection.",
      "properties",
    );
  }
  let projection: ReaderStateBootstrapProjectionSnapshot | null = null;
  if (typeof createProjection === "function") {
    let projectionResult: unknown;
    try {
      projectionResult = READER_STATE_PROJECTION_REFLECT_APPLY(
        createProjection as
          NonNullable<
            PublisherNextReaderStateBootstrapInstance["createProjection"]
          >,
        configuredBootstrap.value,
        [context],
      );
    } catch {
      return failure(
        "next.reader_state_bootstrap.projection_threw",
        "/readerStateBootstrap",
        "The Reader state bootstrap threw while creating a state projection.",
        "adapter",
      );
    }
    const projectionValue = readerStateBootstrapProjectionValue(
      projectionResult,
      reader,
    );
    if (!projectionValue.valid) return projectionValue;
    projection = projectionValue.value;
  }
  let sourceResult: unknown;
  try {
    sourceResult = READER_STATE_PROJECTION_REFLECT_APPLY(
      valueOf(instance, "createSource") as
        PublisherNextReaderStateBootstrapInstance["createSource"],
      configuredBootstrap.value,
      [context],
    );
  } catch {
    return failure(
      "next.reader_state_bootstrap.source_threw",
      "/readerStateBootstrap",
      "The Reader state bootstrap threw while creating browser source.",
      "adapter",
    );
  }
  const source = readerStateBootstrapSourceValue(sourceResult);
  if (!source.valid) return source;
  const sourceBytes = READER_STATE_PROJECTION_REFLECT_APPLY(
    READER_STATE_PROJECTION_TEXT_ENCODE,
    READER_STATE_PROJECTION_TEXT_ENCODER,
    [source.value],
  ).length;
  if (
    sourceBytes >
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SOURCE_BYTES
  ) {
    return failure(
      "next.reader_state_bootstrap.source_too_large",
      "/readerStateBootstrap",
      "The Reader state bootstrap source exceeds the renderer byte limit.",
      "maxLength",
      {
        actualBytes: sourceBytes,
        maximumBytes:
          PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SOURCE_BYTES,
      },
    );
  }
  if (
    READER_STATE_PROJECTION_REFLECT_APPLY(
      READER_STATE_PROJECTION_REGEXP_EXEC,
      READER_STATE_PROJECTION_UNSAFE_SOURCE,
      [source.value],
    ) !== null
  ) {
    return failure(
      "next.reader_state_bootstrap.source_unsafe",
      "/readerStateBootstrap",
      "The Reader state bootstrap source contains an unsafe HTML script sequence.",
      "content",
    );
  }
  try {
    READER_STATE_PROJECTION_FUNCTION(
      "context",
      "projection",
      `"use strict";\n${source.value}`,
    );
  } catch {
    return failure(
      "next.reader_state_bootstrap.source_invalid",
      "/readerStateBootstrap",
      "The Reader state bootstrap source is not a valid synchronous JavaScript function body.",
      "syntax",
    );
  }
  const sourceHash = sha256(source.value);
  const script = createPublisherReaderStateBootstrapSource({
    package: identity.value.package,
    version: identity.value.version,
    sourceHash,
    source: source.value,
    context,
    projectionText: projection?.text ?? null,
  });
  const scriptBytes = READER_STATE_PROJECTION_REFLECT_APPLY(
    READER_STATE_PROJECTION_TEXT_ENCODE,
    READER_STATE_PROJECTION_TEXT_ENCODER,
    [script],
  ).length;
  if (
    scriptBytes >
    PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SCRIPT_BYTES
  ) {
    return failure(
      "next.reader_state_bootstrap.script_too_large",
      "/readerStateBootstrap",
      "The generated Reader state bootstrap script exceeds the renderer byte limit.",
      "maxLength",
      {
        actualBytes: scriptBytes,
        maximumBytes:
          PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SCRIPT_BYTES,
      },
    );
  }
  return success(READER_STATE_PROJECTION_OBJECT_FREEZE({
    identity: identity.value,
    configHash,
    context,
    projection,
    script,
    scriptBytes,
    source: source.value,
    sourceHash,
  }));
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
    route: PublisherNextPlannedRoute,
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
          pageNumber: "pageNumber" in route.target
            ? route.target.pageNumber
            : 1,
          ...(route.target.pagination === undefined
            ? {}
            : { pageSize: route.target.pagination.pageSize }),
          ...(!("previousPath" in route.target) ||
              route.target.previousPath === undefined
            ? {}
            : { previousPath: route.target.previousPath }),
          ...(!("nextPath" in route.target) ||
              route.target.nextPath === undefined
            ? {}
            : { nextPath: route.target.nextPath }),
        });
        break;
      case "extension":
        page = Object.freeze({
          ...base,
          kind: "extension",
          extensionId: route.target.extensionId,
          routeId: route.target.routeId,
          title: route.target.title,
          ...(route.target.description === undefined
            ? {}
            : { description: route.target.description }),
          ...(route.target.data === undefined
            ? {}
            : { data: route.target.data }),
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
    case "extension":
      title = `${page.title} | ${page.publication.title}`;
      description = page.description ?? page.publication.description;
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
  readerStateBootstrap: ResolvedReaderStateBootstrapState | null,
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
  const readerStateBootstrapIdentity =
    readerStateBootstrap === null
      ? null
      : Object.freeze({
          ...readerStateBootstrap.identity,
          apiVersion:
            PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_API_VERSION,
          configHash: readerStateBootstrap.configHash,
          sourceHash: readerStateBootstrap.sourceHash,
          projection:
            readerStateBootstrap.projection?.descriptor ?? null,
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
            hostApiVersion: extension.host?.apiVersion ?? null,
            hostCompatibility:
              extension.host?.rendererCompatibility ?? null,
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
    readerStateBootstrap: readerStateBootstrapIdentity,
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
        "readerStateBootstrap",
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
    const suppliedReaderStateBootstrap = valueOf(
      inspectedOptions,
      "readerStateBootstrap",
    );
    let readerStateBootstrap:
      ResolvedReaderStateBootstrapState | null = null;
    if (suppliedReaderStateBootstrap !== undefined) {
      const bootstrapResult = resolveReaderStateBootstrap(
        suppliedReaderStateBootstrap as
          ResolvedPublisherNextReaderStateBootstrap,
        reader,
      );
      if (!bootstrapResult.valid) return bootstrapResult;
      readerStateBootstrap = bootstrapResult.value;
    }
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
      valueOf(inspectedOptions, "extensionData"),
    );
    if (!routePlanResult.valid) {
      return routePlanResult;
    }
    const routePlan = routePlanResult.value;
    if (readerStateBootstrap !== null) {
      const documentCount = routePlan.staticParams.length;
      const totalScriptBytes =
        readerStateBootstrap.scriptBytes * documentCount;
      if (
        totalScriptBytes >
        PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_STATIC_SCRIPT_BYTES
      ) {
        return failure(
          "next.reader_state_bootstrap.static_script_too_large",
          "/readerStateBootstrap",
          "The Reader state bootstrap would exceed the renderer total static HTML byte limit.",
          "maxLength",
          {
            actualBytes: totalScriptBytes,
            documentCount,
            maximumBytes:
              PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_STATIC_SCRIPT_BYTES,
            scriptBytes: readerStateBootstrap.scriptBytes,
          },
        );
      }
    }
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
    const extensionRequestHandler = createExtensionRequestHandler(
      extensions,
    );
    const artifact = createApplicationArtifact(
      reader,
      themeResult.value,
      updatesState,
      readerStateBootstrap,
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
      const clientExtensions = renderExtensionClients(
        extensions,
        page,
      );
      const extensionRouteBody = page.kind === "extension"
        ? await renderExtensionRoute(extensions, page)
        : undefined;
      return PublisherPageView({
        afterMain,
        beforeMain,
        clientExtensions,
        ...(extensionRouteBody === undefined
          ? {}
          : { extensionRouteBody }),
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
          <html
            lang={reader.publication.language}
            suppressHydrationWarning
          >
            <head>
              <PublisherReaderPrepaint
                publicationId={reader.publicationId}
                {...(readerStateBootstrap === null
                  ? {}
                  : {
                      readerStateBootstrapSource:
                        readerStateBootstrap.script,
                    })}
                readerFontFamilies={
                  themeResult.value.instance.tokens.typography
                    .readerFontFamilies
                }
              />
            </head>
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
      handleRequest: async (request: Request) =>
        continuity.handleRequest(request) ??
        extensionRequestHandler(request),
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
