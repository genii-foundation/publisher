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
  PublicationReaderEnvelope,
  ReaderWork,
  Sha256Digest,
} from "@genii-foundation/publisher-schema/reader";
import {
  readerNarrationTimingHref,
  type ReaderNarrationEnvelope,
} from "./narration.js";

export const READER_OFFLINE_CATALOG_SCHEMA_VERSION = 1 as const;
export const READER_OFFLINE_CATALOG_ARTIFACT_KIND =
  "publication-reader-offline";
export const READER_OFFLINE_CATALOG_ARTIFACT_MEDIA_TYPE =
  "application/vnd.genii.publisher.reader-offline+json";
export const READER_OFFLINE_CATALOG_ARTIFACT_RELATIVE_PATH =
  "reader/publication-reader-offline.json";
export const MAXIMUM_READER_OFFLINE_CATALOG_SERIALIZED_BYTES = 67_108_864;
export const MAXIMUM_READER_OFFLINE_PACKAGES = 4_999;
export const MAXIMUM_READER_OFFLINE_RESOURCES_PER_PACKAGE = 100_000;
export const MAXIMUM_READER_OFFLINE_RESOURCES = 250_000;

export type ReaderOfflineResourceKind =
  | "document"
  | "data"
  | "asset"
  | "audio"
  | "timing";

export interface ReaderOfflineResourceInput {
  readonly href: string;
  readonly kind: ReaderOfflineResourceKind;
  readonly byteSize?: number;
}

export interface ReaderOfflineResource extends ReaderOfflineResourceInput {}

export interface ReaderOfflinePackageVersion {
  readonly readerBuildId: Sha256Digest;
  readonly rendererBuildId: Sha256Digest;
  readonly workContentHash: Sha256Digest;
  readonly narrationCatalogHash: Sha256Digest | null;
}

export interface ReaderOfflinePackage {
  readonly workId: string;
  readonly title: string;
  readonly route: string;
  readonly version: ReaderOfflinePackageVersion;
  readonly sectionCount: number;
  readonly audioClipCount: number;
  readonly resourceCount: number;
  readonly declaredByteSize: number;
  readonly unknownByteSizeCount: number;
  readonly resources: readonly ReaderOfflineResource[];
}

export interface ReaderOfflineCatalog {
  readonly schemaVersion: typeof READER_OFFLINE_CATALOG_SCHEMA_VERSION;
  readonly kind: typeof READER_OFFLINE_CATALOG_ARTIFACT_KIND;
  readonly mediaType: typeof READER_OFFLINE_CATALOG_ARTIFACT_MEDIA_TYPE;
  readonly relativePath: typeof READER_OFFLINE_CATALOG_ARTIFACT_RELATIVE_PATH;
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly rendererBuildId: Sha256Digest;
  readonly catalogHref: string;
  readonly packages: readonly ReaderOfflinePackage[];
}

export interface ReaderOfflineCatalogIdentity {
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly rendererBuildId: Sha256Digest;
}

export interface CreateReaderOfflineCatalogInput {
  readonly reader: PublicationReaderEnvelope;
  readonly rendererBuildId: Sha256Digest;
  readonly catalogHref: string;
  readonly sharedResources: readonly ReaderOfflineResourceInput[];
  readonly narration?: {
    readonly catalogHash: Sha256Digest;
    readonly envelope: ReaderNarrationEnvelope;
  };
}

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const RESOURCE_KINDS = new Set<ReaderOfflineResourceKind>([
  "document",
  "data",
  "asset",
  "audio",
  "timing",
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > MAXIMUM_READER_OFFLINE_CATALOG_SERIALIZED_BYTES) return bytes;
  }
  return bytes;
}

function plainRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return null;
  }
}

function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(record);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => allowed.has(key));
}

function validStableId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    STABLE_ID.test(value);
}

function validTitle(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 4_096 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function validDigest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && SHA256_DIGEST.test(value);
}

function validByteSize(value: unknown): value is number {
  return Number.isSafeInteger(value) &&
    typeof value === "number" &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER;
}

function validCount(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) &&
    typeof value === "number" &&
    value >= 0 &&
    value <= maximum;
}

function safeResourceHref(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 8_192 ||
    /[\\\u0000-\u0020\u007f]/u.test(value) ||
    value.includes("#")
  ) return false;
  try {
    const parsed = new URL(value, "https://publisher.invalid");
    if (parsed.username !== "" || parsed.password !== "") return false;
    if (value.startsWith("/")) {
      return !value.startsWith("//") &&
        parsed.origin === "https://publisher.invalid" &&
        `${parsed.pathname}${parsed.search}` === value;
    }
    return parsed.protocol === "https:" &&
      parsed.origin !== "null" &&
      parsed.href === value;
  } catch {
    return false;
  }
}

function documentHref(value: string): string {
  const fragment = value.indexOf("#");
  return fragment < 0 ? value : value.slice(0, fragment);
}

function freezeResource(
  resource: ReaderOfflineResourceInput,
): ReaderOfflineResource {
  return Object.freeze({
    href: resource.href,
    kind: resource.kind,
    ...(resource.byteSize === undefined
      ? {}
      : { byteSize: resource.byteSize }),
  });
}

function assertResourceInput(
  resource: ReaderOfflineResourceInput,
): ReaderOfflineResource {
  if (
    !safeResourceHref(resource.href) ||
    !RESOURCE_KINDS.has(resource.kind) ||
    (resource.byteSize !== undefined && !validByteSize(resource.byteSize))
  ) {
    throw new TypeError("An offline resource is invalid.");
  }
  return freezeResource(resource);
}

function addResource(
  resources: Map<string, ReaderOfflineResource>,
  input: ReaderOfflineResourceInput,
): void {
  const resource = assertResourceInput(input);
  const previous = resources.get(resource.href);
  if (previous === undefined) {
    resources.set(resource.href, resource);
    return;
  }
  if (
    previous.kind !== resource.kind ||
    previous.byteSize !== resource.byteSize
  ) {
    throw new TypeError(
      `Offline resource ${resource.href} has conflicting declarations.`,
    );
  }
}

function workDocumentHrefs(
  reader: PublicationReaderEnvelope,
  work: ReaderWork,
): Set<string> {
  const hrefs = new Set<string>([work.route]);
  for (const route of reader.routes.active) {
    if (
      (route.target.kind === "work" && route.target.workId === work.id) ||
      (route.target.kind === "section" && route.target.workId === work.id)
    ) hrefs.add(route.path);
    if (route.target.kind === "collection") {
      const collectionId = route.target.collectionId;
      if (reader.collections.some((collection) =>
        collection.id === collectionId && collection.workIds.includes(work.id))) {
        hrefs.add(route.path);
      }
    }
    if (route.target.kind === "home") hrefs.add(route.path);
  }

  const redirectByFrom = new Map(
    reader.routes.redirects.map((redirect) => [redirect.from, redirect.to]),
  );
  for (const redirect of reader.routes.redirects) {
    let target = redirect.to;
    const visited = new Set([redirect.from]);
    while (redirectByFrom.has(target) && !visited.has(target)) {
      visited.add(target);
      target = redirectByFrom.get(target)!;
    }
    if (hrefs.has(target)) hrefs.add(redirect.from);
  }
  return hrefs;
}

function packageNarrationResources(
  work: ReaderWork,
  narration: CreateReaderOfflineCatalogInput["narration"],
): { readonly clips: number; readonly resources: readonly ReaderOfflineResource[] } {
  if (narration === undefined) {
    return Object.freeze({ clips: 0, resources: Object.freeze([]) });
  }
  const sectionIds = new Set(work.sections.map((section) => section.id));
  const resources = new Map<string, ReaderOfflineResource>();
  let clips = 0;
  for (const voice of narration.envelope.voices) {
    for (const clip of voice.clips) {
      if (!sectionIds.has(clip.sectionId)) continue;
      clips += 1;
      addResource(resources, {
        href: clip.href,
        kind: "audio",
        ...(clip.byteSize === undefined ? {} : { byteSize: clip.byteSize }),
      });
      const timingHref = readerNarrationTimingHref(clip);
      if (timingHref !== null) {
        addResource(resources, {
          href: timingHref,
          kind: "timing",
          byteSize: clip.timingsByteSize!,
        });
      }
    }
  }
  return Object.freeze({
    clips,
    resources: Object.freeze([...resources.values()]),
  });
}

/**
 * Projects one immutable offline package per work. It plans resources only and
 * has no cache, network, DOM, storage, clock, random, or service worker authority.
 */
export function createReaderOfflineCatalog(
  input: CreateReaderOfflineCatalogInput,
): ReaderOfflineCatalog {
  if (
    !validDigest(input.rendererBuildId) ||
    !safeResourceHref(input.catalogHref) ||
    !input.catalogHref.startsWith("/") ||
    input.reader.works.length > MAXIMUM_READER_OFFLINE_PACKAGES
  ) throw new TypeError("Offline catalog identity is invalid.");
  if (
    input.narration !== undefined &&
    (!validDigest(input.narration.catalogHash) ||
      input.narration.envelope.publicationId !== input.reader.publicationId ||
      input.narration.envelope.readerBuildId !== input.reader.buildId)
  ) throw new TypeError("Offline narration identity does not match the Reader.");

  const shared = new Map<string, ReaderOfflineResource>();
  addResource(shared, { href: input.catalogHref, kind: "data" });
  for (const resource of input.sharedResources) addResource(shared, resource);

  const packages = input.reader.works.map((work) => {
    const resources = new Map(shared);
    for (const href of workDocumentHrefs(input.reader, work)) {
      addResource(resources, { href: documentHref(href), kind: "document" });
    }
    for (const asset of input.reader.assets) {
      if (asset.workId === undefined || asset.workId === work.id) {
        addResource(resources, { href: asset.href, kind: "asset" });
      }
    }
    const narration = packageNarrationResources(work, input.narration);
    for (const resource of narration.resources) addResource(resources, resource);
    if (resources.size > MAXIMUM_READER_OFFLINE_RESOURCES_PER_PACKAGE) {
      throw new TypeError("An offline package has too many resources.");
    }
    const list = Object.freeze([...resources.values()]);
    const declaredByteSize = list.reduce(
      (total, resource) => total + (resource.byteSize ?? 0),
      0,
    );
    if (!Number.isSafeInteger(declaredByteSize)) {
      throw new TypeError("An offline package byte size exceeds the safe range.");
    }
    return Object.freeze({
      workId: work.id,
      title: work.title,
      route: work.route,
      version: Object.freeze({
        readerBuildId: input.reader.buildId,
        rendererBuildId: input.rendererBuildId,
        workContentHash: work.contentHash,
        narrationCatalogHash: input.narration?.catalogHash ?? null,
      }),
      sectionCount: work.sections.length,
      audioClipCount: narration.clips,
      resourceCount: list.length,
      declaredByteSize,
      unknownByteSizeCount: list.filter(
        (resource) => resource.byteSize === undefined,
      ).length,
      resources: list,
    });
  });
  const resourceCount = packages.reduce(
    (total, offlinePackage) => total + offlinePackage.resourceCount,
    0,
  );
  if (resourceCount > MAXIMUM_READER_OFFLINE_RESOURCES) {
    throw new TypeError("The offline catalog has too many resources.");
  }
  return Object.freeze({
    schemaVersion: READER_OFFLINE_CATALOG_SCHEMA_VERSION,
    kind: READER_OFFLINE_CATALOG_ARTIFACT_KIND,
    mediaType: READER_OFFLINE_CATALOG_ARTIFACT_MEDIA_TYPE,
    relativePath: READER_OFFLINE_CATALOG_ARTIFACT_RELATIVE_PATH,
    publicationId: input.reader.publicationId,
    readerBuildId: input.reader.buildId,
    rendererBuildId: input.rendererBuildId,
    catalogHref: input.catalogHref,
    packages: Object.freeze(packages),
  });
}

export function serializeReaderOfflineCatalog(
  catalog: ReaderOfflineCatalog,
): string {
  return JSON.stringify(catalog);
}

function parseResource(value: unknown): ReaderOfflineResource | null {
  const record = plainRecord(value);
  if (
    record === null ||
    !hasExactKeys(record, ["href", "kind"], ["byteSize"]) ||
    !safeResourceHref(record.href) ||
    typeof record.kind !== "string" ||
    !RESOURCE_KINDS.has(record.kind as ReaderOfflineResourceKind) ||
    (record.byteSize !== undefined && !validByteSize(record.byteSize))
  ) return null;
  return freezeResource({
    href: record.href,
    kind: record.kind as ReaderOfflineResourceKind,
    ...(record.byteSize === undefined ? {} : { byteSize: record.byteSize }),
  });
}

function parseVersion(
  value: unknown,
  expected: ReaderOfflineCatalogIdentity,
): ReaderOfflinePackageVersion | null {
  const record = plainRecord(value);
  if (
    record === null ||
    !hasExactKeys(record, [
      "readerBuildId",
      "rendererBuildId",
      "workContentHash",
      "narrationCatalogHash",
    ]) ||
    record.readerBuildId !== expected.readerBuildId ||
    record.rendererBuildId !== expected.rendererBuildId ||
    !validDigest(record.workContentHash) ||
    (record.narrationCatalogHash !== null &&
      !validDigest(record.narrationCatalogHash))
  ) return null;
  return Object.freeze({
    readerBuildId: expected.readerBuildId,
    rendererBuildId: expected.rendererBuildId,
    workContentHash: record.workContentHash,
    narrationCatalogHash: record.narrationCatalogHash,
  });
}

/** Parses a fetched catalog and binds it to one exact Reader and renderer. */
export function parseReaderOfflineCatalog(
  value: unknown,
  expected: ReaderOfflineCatalogIdentity,
): ReaderOfflineCatalog | null {
  if (
    !validStableId(expected.publicationId) ||
    !validDigest(expected.readerBuildId) ||
    !validDigest(expected.rendererBuildId)
  ) return null;
  let parsed = value;
  if (typeof value === "string") {
    if (utf8ByteLength(value) > MAXIMUM_READER_OFFLINE_CATALOG_SERIALIZED_BYTES) {
      return null;
    }
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  const catalog = plainRecord(parsed);
  if (
    catalog === null ||
    !hasExactKeys(catalog, [
      "schemaVersion",
      "kind",
      "mediaType",
      "relativePath",
      "publicationId",
      "readerBuildId",
      "rendererBuildId",
      "catalogHref",
      "packages",
    ]) ||
    catalog.schemaVersion !== READER_OFFLINE_CATALOG_SCHEMA_VERSION ||
    catalog.kind !== READER_OFFLINE_CATALOG_ARTIFACT_KIND ||
    catalog.mediaType !== READER_OFFLINE_CATALOG_ARTIFACT_MEDIA_TYPE ||
    catalog.relativePath !== READER_OFFLINE_CATALOG_ARTIFACT_RELATIVE_PATH ||
    catalog.publicationId !== expected.publicationId ||
    catalog.readerBuildId !== expected.readerBuildId ||
    catalog.rendererBuildId !== expected.rendererBuildId ||
    !safeResourceHref(catalog.catalogHref) ||
    !catalog.catalogHref.startsWith("/") ||
    !Array.isArray(catalog.packages) ||
    catalog.packages.length > MAXIMUM_READER_OFFLINE_PACKAGES
  ) return null;

  const packages: ReaderOfflinePackage[] = [];
  const workIds = new Set<string>();
  let totalResources = 0;
  for (const value of catalog.packages) {
    const record = plainRecord(value);
    if (
      record === null ||
      !hasExactKeys(record, [
        "workId",
        "title",
        "route",
        "version",
        "sectionCount",
        "audioClipCount",
        "resourceCount",
        "declaredByteSize",
        "unknownByteSizeCount",
        "resources",
      ]) ||
      !validStableId(record.workId) ||
      workIds.has(record.workId) ||
      !validTitle(record.title) ||
      !safeResourceHref(record.route) ||
      !record.route.startsWith("/") ||
      !validCount(record.sectionCount, 50_000) ||
      !validCount(record.audioClipCount, 50_000) ||
      !validCount(record.resourceCount, MAXIMUM_READER_OFFLINE_RESOURCES_PER_PACKAGE) ||
      !validByteSize(record.declaredByteSize) ||
      !validCount(record.unknownByteSizeCount, MAXIMUM_READER_OFFLINE_RESOURCES_PER_PACKAGE) ||
      !Array.isArray(record.resources) ||
      record.resources.length !== record.resourceCount ||
      record.resources.length > MAXIMUM_READER_OFFLINE_RESOURCES_PER_PACKAGE
    ) return null;
    const version = parseVersion(record.version, expected);
    if (version === null) return null;
    const resources: ReaderOfflineResource[] = [];
    const hrefs = new Set<string>();
    let declaredByteSize = 0;
    let unknownByteSizeCount = 0;
    for (const resourceValue of record.resources) {
      const resource = parseResource(resourceValue);
      if (resource === null || hrefs.has(resource.href)) return null;
      hrefs.add(resource.href);
      resources.push(resource);
      if (resource.byteSize === undefined) unknownByteSizeCount += 1;
      else declaredByteSize += resource.byteSize;
      if (!Number.isSafeInteger(declaredByteSize)) return null;
    }
    if (
      !hrefs.has(catalog.catalogHref) ||
      !resources.some((resource) =>
        resource.kind === "document" && resource.href === record.route) ||
      declaredByteSize !== record.declaredByteSize ||
      unknownByteSizeCount !== record.unknownByteSizeCount
    ) return null;
    workIds.add(record.workId);
    totalResources += resources.length;
    if (totalResources > MAXIMUM_READER_OFFLINE_RESOURCES) return null;
    packages.push(Object.freeze({
      workId: record.workId,
      title: record.title,
      route: record.route,
      version,
      sectionCount: record.sectionCount,
      audioClipCount: record.audioClipCount,
      resourceCount: record.resourceCount,
      declaredByteSize: record.declaredByteSize,
      unknownByteSizeCount: record.unknownByteSizeCount,
      resources: Object.freeze(resources),
    }));
  }
  return Object.freeze({
    schemaVersion: READER_OFFLINE_CATALOG_SCHEMA_VERSION,
    kind: READER_OFFLINE_CATALOG_ARTIFACT_KIND,
    mediaType: READER_OFFLINE_CATALOG_ARTIFACT_MEDIA_TYPE,
    relativePath: READER_OFFLINE_CATALOG_ARTIFACT_RELATIVE_PATH,
    publicationId: expected.publicationId,
    readerBuildId: expected.readerBuildId,
    rendererBuildId: expected.rendererBuildId,
    catalogHref: catalog.catalogHref,
    packages: Object.freeze(packages),
  });
}
