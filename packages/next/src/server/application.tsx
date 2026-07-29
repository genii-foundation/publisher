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
  applyReaderLinksToMarkdown,
  type ReaderBlockMarkdownLink,
} from "@genii-foundation/publisher-reader/markdown";
import type {
  ContentRoute,
  Diagnostic,
  JSONValue,
  PublicationReaderEnvelope,
  ReaderBlock,
  ReaderCollection,
  ReaderSection,
  ReaderWork,
  ValidationResult,
} from "@genii-foundation/publisher-schema";
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
import {
  validatePublisherNextThemeInstance,
} from "../theme/validation.js";
import {
  PUBLISHER_NEXT_APPLICATION_ARTIFACT_KIND,
  PUBLISHER_NEXT_APPLICATION_ARTIFACT_MEDIA_TYPE,
  PUBLISHER_NEXT_APPLICATION_ARTIFACT_RELATIVE_PATH,
  PUBLISHER_NEXT_APPLICATION_SCHEMA_URL,
  PUBLISHER_NEXT_APPLICATION_SCHEMA_VERSION,
  PUBLISHER_NEXT_THEME_API_VERSION,
  PUBLISHER_NEXT_UPDATES_API_VERSION,
  PUBLISHER_NEXT_VERSION,
} from "../types.js";
import type {
  CreatePublicationNextApplicationOptions,
  PublicationNextApplication,
  PublisherNextApplicationArtifact,
  PublisherNextApplicationManifest,
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
  readonly view: PublisherNextUpdatesView;
  readonly viewHash: ReturnType<typeof hashCanonicalJson>;
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
    route: ContentRoute,
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
        page = Object.freeze({ ...base, kind: "updates" });
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

function metadataForPage(page: PublisherNextPage): Metadata {
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
      title = `Updates | ${page.publication.title}`;
      description = page.publication.description;
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
  const basis = Object.freeze({
    schemaVersion: PUBLISHER_NEXT_APPLICATION_SCHEMA_VERSION,
    publicationId: reader.publicationId,
    engineVersion: reader.engineVersion,
    rendererVersion: PUBLISHER_NEXT_VERSION,
    artifact: artifactDescriptor,
    source,
    theme: themeIdentity,
    updates: updatesIdentity,
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
      ["theme", "updates"],
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
    const markdownResult = prepareReaderMarkdown(reader);
    if (!markdownResult.valid) {
      return markdownResult;
    }
    const markdownForBlock = markdownResult.value;
    const routePlanResult = createPublisherNextRoutePlan(reader);
    if (!routePlanResult.valid) {
      return routePlanResult;
    }
    const routePlan = routePlanResult.value;
    const hasUpdatesRoute = reader.routes.active.some(
      ({ target }) => target.kind === "updates",
    );
    const suppliedUpdates = valueOf(inspectedOptions, "updates");
    if (hasUpdatesRoute && suppliedUpdates === undefined) {
      return failure(
        "next.updates.required",
        "/updates",
        "The publication declares an Updates route but no Updates adapter was supplied.",
        "required",
      );
    }
    if (!hasUpdatesRoute && suppliedUpdates !== undefined) {
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
      const updatesRouteIndex = reader.routes.active.findIndex(
        ({ target }) => target.kind === "updates",
      );
      const updatesParams =
        routePlan.staticParams[updatesRouteIndex];
      const updatesPage =
        updatesParams === undefined
          ? Object.freeze({
              status: "invalid" as const,
              issue: "updates-route",
            })
          : resolver.resolve(updatesParams.segments);
      if (
        updatesPage.status !== "resolved" ||
        updatesPage.page.kind !== "updates"
      ) {
        return failure(
          "next.updates.route_invalid",
          "/routes/active",
          "The declared Updates route could not resolve to its closed page model.",
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
      updatesState = Object.freeze({
        ...configuredUpdates,
        view: loaded.value,
        viewHash: hashCanonicalJson(
          loaded.value as unknown as JSONValue,
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
      continuity,
    );

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
          ? (updatesState?.view ?? null)
          : null;
      return PublisherPageView({
        homePath: resolver.homePath,
        markdownForBlock,
        page,
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
      return metadataForPage(resolved.page);
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
            <body>{children}</body>
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
