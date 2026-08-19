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
  JSONValue,
  PublicationReaderEnvelope,
  ReaderAsset,
  ReaderCollection,
  ReaderLink,
  ReaderSection,
  ReaderWork,
  Sha256Digest,
  SyncEnvelope,
  ValidationResult,
} from "@genii-foundation/publisher-schema";
import type {
  ReaderOfflineCatalog,
} from "@genii-foundation/publisher-reader/offline";
import type { Metadata, NextConfig } from "next";
import type {
  ComponentType,
  ReactElement,
  ReactNode,
} from "react";

import type {
  PublisherNextErrorIdentity,
} from "./error-identity.js";

export const PUBLISHER_NEXT_VERSION = "0.1.0-alpha.0";
export const PUBLISHER_NEXT_APPLICATION_SCHEMA_VERSION = "1.0";
export const PUBLISHER_NEXT_APPLICATION_SCHEMA_URL =
  "https://publisher.genii.foundation/schemas/next-application-manifest.schema.json";
export const PUBLISHER_NEXT_APPLICATION_ARTIFACT_KIND =
  "publisher-next-application";
export const PUBLISHER_NEXT_APPLICATION_ARTIFACT_MEDIA_TYPE =
  "application/vnd.genii.publisher.next-application+json";
export const PUBLISHER_NEXT_APPLICATION_ARTIFACT_RELATIVE_PATH =
  "renderers/next/application.json";
export const PUBLISHER_NEXT_THEME_API_VERSION = "2.0";
export const PUBLISHER_NEXT_UPDATES_API_VERSION = "1.0";
export const PUBLISHER_NEXT_EXTENSION_API_VERSION = "1.0";
export const PUBLISHER_NEXT_EXTENSION_HOST_API_VERSION = "1.0";
export const PUBLISHER_NEXT_EXTENSION_HANDLER_MAXIMUM_BODY_BYTES =
  1_048_576;
export const PUBLISHER_NEXT_EXTENSION_HANDLER_METHODS = Object.freeze([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
] as const);
export const PUBLISHER_NEXT_EXTENSION_SLOTS = Object.freeze([
  "page.before-main",
  "page.after-main",
] as const);
export const PUBLISHER_NEXT_EXTENSION_CLIENT_MOUNT =
  "page.client" as const;
export const PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES =
  Object.freeze({
    "next@16.2.12": Object.freeze({
      nanoid: "3.3.18",
      postcss: "8.5.24",
      sharp: "0.35.3",
    }),
  });

export type PublisherNextJsonObject = Readonly<
  Record<string, JSONValue>
>;

export type PublisherNextExtensionSlot =
  typeof PUBLISHER_NEXT_EXTENSION_SLOTS[number];

export type PublisherNextExtensionHandlerMethod =
  typeof PUBLISHER_NEXT_EXTENSION_HANDLER_METHODS[number];

export interface PublisherNextExtensionPageContext {
  readonly kind: PublisherNextPage["kind"];
  readonly path: string;
  readonly publication: {
    readonly id: string;
    readonly title: string;
    readonly language: string;
  };
  readonly work?: {
    readonly id: string;
    readonly title: string;
  };
  readonly section?: {
    readonly id: string;
    readonly title: string;
  };
  readonly extension?: {
    readonly id: string;
    readonly routeId: string;
  };
}

export interface PublisherNextExtensionRenderInput {
  readonly slot: PublisherNextExtensionSlot;
  readonly page: PublisherNextExtensionPageContext;
  readonly serverData?: JSONValue;
}

export interface PublisherNextExtensionClientProps {
  readonly mount:
    typeof PUBLISHER_NEXT_EXTENSION_CLIENT_MOUNT;
  readonly page: PublisherNextExtensionPageContext;
  readonly clientData?: JSONValue;
}

export interface PublisherNextExtensionRenderer {
  readonly kind: "genii.publisher.next-extension";
  readonly apiVersion: typeof PUBLISHER_NEXT_EXTENSION_API_VERSION;
  readonly rendererCompatibility: string;
  readonly renderSlot?: (
    input: PublisherNextExtensionRenderInput,
  ) => ReactNode | Promise<ReactNode>;
  readonly Client?: ComponentType<PublisherNextExtensionClientProps>;
}

export interface PublisherNextExtensionHost {
  readonly kind: "genii.publisher.next-host-extension";
  readonly apiVersion:
    typeof PUBLISHER_NEXT_EXTENSION_HOST_API_VERSION;
  readonly rendererCompatibility: string;
  readonly renderRoute?: (
    input: PublisherNextExtensionRouteRenderInput,
  ) => ReactNode | Promise<ReactNode>;
  readonly handleRequest?: (
    input: PublisherNextExtensionHandlerInput,
  ) => Response | Promise<Response>;
}

export interface PublisherNextExtensionRouteRenderInput {
  readonly page: PublisherNextExtensionRoutePage;
  readonly serverData?: JSONValue;
}

export interface PublisherNextExtensionHandlerDescriptor {
  readonly id: string;
  readonly path: string;
  readonly methods: readonly PublisherNextExtensionHandlerMethod[];
  readonly data?: JSONValue;
}

export interface PublisherNextExtensionHandlerInput {
  readonly handler: PublisherNextExtensionHandlerDescriptor;
  readonly request: Request;
  readonly serverData?: JSONValue;
}

export interface PublisherNextThemeTokens {
  readonly color: {
    readonly canvas: string;
    readonly surface: string;
    readonly text: string;
    readonly mutedText: string;
    readonly accent: string;
    readonly focus: string;
    readonly border: string;
  };
  readonly typography: {
    readonly bodyFamily: string;
    readonly headingFamily: string;
    readonly monoFamily: string;
    readonly baseSize: string;
    readonly lineHeight: number;
    readonly defaultReaderFontFamilyId: string;
    readonly readerFontFamilies: readonly PublisherNextReaderFontFamily[];
  };
  readonly layout: {
    readonly readingMeasure: string;
    readonly pageGutter: string;
    readonly sectionGap: string;
    readonly controlRadius: string;
  };
}

export interface PublisherNextReaderFontFamily {
  readonly id: string;
  readonly label: string;
  readonly family: string;
}

export interface PublisherNextThemeInstance {
  readonly tokens: PublisherNextThemeTokens;
}

export interface PublisherNextTheme {
  readonly kind: "genii.publisher.next-theme";
  readonly apiVersion: typeof PUBLISHER_NEXT_THEME_API_VERSION;
  readonly configure: (
    config: PublisherNextJsonObject,
  ) => ValidationResult<PublisherNextThemeInstance>;
}

export interface ResolvedPublisherNextTheme {
  readonly package: string;
  readonly version: string;
  readonly rendererCompatibility: string;
  readonly config: PublisherNextJsonObject;
  readonly implementation: PublisherNextTheme;
}

export interface PublisherNextPageBase {
  readonly path: string;
  readonly publication: PublicationReaderEnvelope["publication"];
}

export interface PublisherNextHomePage
  extends PublisherNextPageBase {
  readonly kind: "home";
  readonly works: readonly ReaderWork[];
  readonly collections: readonly ReaderCollection[];
}

export interface PublisherNextWorkPage
  extends PublisherNextPageBase {
  readonly kind: "work";
  readonly work: ReaderWork;
  readonly assets: readonly ReaderAsset[];
  readonly links: readonly ReaderLink[];
}

export interface PublisherNextCollectionPage
  extends PublisherNextPageBase {
  readonly kind: "collection";
  readonly collection: ReaderCollection;
  readonly works: readonly ReaderWork[];
}

export interface PublisherNextSectionPage
  extends PublisherNextPageBase {
  readonly kind: "section";
  readonly work: ReaderWork;
  readonly section: ReaderSection;
  readonly assets: readonly ReaderAsset[];
  readonly links: readonly ReaderLink[];
  readonly previous: ReaderSection | null;
  readonly next: ReaderSection | null;
}

export interface PublisherNextUpdatesPage
  extends PublisherNextPageBase {
  readonly kind: "updates";
  readonly viewId: string;
  readonly pageNumber: number;
  readonly pageSize?: number;
  readonly previousPath?: string;
  readonly nextPath?: string;
}

export interface PublisherNextExtensionRoutePage
  extends PublisherNextPageBase {
  readonly kind: "extension";
  readonly extensionId: string;
  readonly routeId: string;
  readonly title: string;
  readonly description?: string;
  readonly data?: JSONValue;
}

export interface PublisherNextUpdatesEntry {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly publishedAt?: string;
  readonly href?: string;
}

export interface PublisherNextUpdatesView {
  readonly title: string;
  readonly description?: string;
  readonly emptyMessage?: string;
  readonly entries: readonly PublisherNextUpdatesEntry[];
}

export type PublisherNextPage =
  | PublisherNextHomePage
  | PublisherNextWorkPage
  | PublisherNextCollectionPage
  | PublisherNextSectionPage
  | PublisherNextUpdatesPage
  | PublisherNextExtensionRoutePage;

export interface PublisherNextUpdatesInstance {
  readonly load: (
    page: PublisherNextUpdatesPage,
  ) => PublisherNextUpdatesView | Promise<PublisherNextUpdatesView>;
}

export interface PublisherNextUpdates {
  readonly kind: "genii.publisher.next-updates";
  readonly apiVersion: typeof PUBLISHER_NEXT_UPDATES_API_VERSION;
  readonly configure: (
    config: PublisherNextJsonObject,
  ) => ValidationResult<PublisherNextUpdatesInstance>;
}

export interface ResolvedPublisherNextUpdates {
  readonly package: string;
  readonly version: string;
  readonly rendererCompatibility: string;
  readonly config: PublisherNextJsonObject;
  readonly implementation: PublisherNextUpdates;
}

export interface PublisherNextApplicationManifest {
  readonly $schema: typeof PUBLISHER_NEXT_APPLICATION_SCHEMA_URL;
  readonly schemaVersion:
    typeof PUBLISHER_NEXT_APPLICATION_SCHEMA_VERSION;
  readonly publicationId: string;
  readonly engineVersion: string;
  readonly rendererVersion: typeof PUBLISHER_NEXT_VERSION;
  readonly buildId: Sha256Digest;
  readonly artifact: {
    readonly kind:
      typeof PUBLISHER_NEXT_APPLICATION_ARTIFACT_KIND;
    readonly mediaType:
      typeof PUBLISHER_NEXT_APPLICATION_ARTIFACT_MEDIA_TYPE;
    readonly relativePath:
      typeof PUBLISHER_NEXT_APPLICATION_ARTIFACT_RELATIVE_PATH;
  };
  readonly source: {
    readonly readerSchemaVersion: string;
    readonly readerBuildId: Sha256Digest;
    readonly audience: PublicationReaderEnvelope["audience"];
  };
  readonly theme: {
    readonly package: string;
    readonly version: string;
    readonly rendererCompatibility: string;
    readonly apiVersion:
      typeof PUBLISHER_NEXT_THEME_API_VERSION;
    readonly configHash: Sha256Digest;
    readonly tokensHash: Sha256Digest;
  };
  readonly updates: {
    readonly package: string;
    readonly version: string;
    readonly rendererCompatibility: string;
    readonly apiVersion:
      typeof PUBLISHER_NEXT_UPDATES_API_VERSION;
    readonly configHash: Sha256Digest;
    readonly viewHash: Sha256Digest;
  } | null;
  readonly extensions: {
    readonly schemaVersion: "1.0";
    readonly buildId: Sha256Digest;
    readonly entries: readonly {
      readonly id: string;
      readonly package: string;
      readonly version: string;
      readonly capabilities: readonly string[];
      readonly projectionHash: Sha256Digest;
      readonly rendererApiVersion:
        typeof PUBLISHER_NEXT_EXTENSION_API_VERSION | null;
      readonly rendererCompatibility: string | null;
      readonly hostApiVersion:
        typeof PUBLISHER_NEXT_EXTENSION_HOST_API_VERSION | null;
      readonly hostCompatibility: string | null;
    }[];
  } | null;
  readonly sync: {
    readonly schemaVersion: SyncEnvelope["schemaVersion"];
    readonly buildId: Sha256Digest;
    readonly providerPackage: string;
    readonly consent: "opt-in";
    readonly localFallback: true;
    readonly capabilities: readonly SyncEnvelope["capabilities"][number][];
  } | null;
  readonly continuity: {
    readonly mode: "proxy";
    readonly explicitRedirectCount: number;
    readonly canonicalSlashRedirectCount: number;
  };
}

export interface PublisherNextApplicationArtifact {
  readonly relativePath:
    typeof PUBLISHER_NEXT_APPLICATION_ARTIFACT_RELATIVE_PATH;
  readonly mediaType:
    typeof PUBLISHER_NEXT_APPLICATION_ARTIFACT_MEDIA_TYPE;
  readonly text: string;
  readonly hash: Sha256Digest;
  readonly manifest: PublisherNextApplicationManifest;
}

export interface PublisherNextRouteParams {
  readonly segments?: readonly string[];
}

export interface PublisherNextPageProps {
  readonly params: Promise<PublisherNextRouteParams>;
}

export type PublisherNextRouteResolution =
  | {
      readonly status: "resolved";
      readonly page: PublisherNextPage;
    }
  | {
      readonly status: "not-found";
    }
  | {
      readonly status: "invalid";
      readonly issue: string;
    };

export interface PublisherNextRootLayoutProps {
  readonly children: ReactNode;
}

export interface PublicationNextApplication {
  readonly reader: PublicationReaderEnvelope;
  readonly manifest: PublisherNextApplicationManifest;
  readonly artifact: PublisherNextApplicationArtifact;
  readonly offlineCatalog: ReaderOfflineCatalog;
  readonly offlineCatalogText: string;
  readonly theme: PublisherNextThemeInstance;
  readonly errorIdentity: PublisherNextErrorIdentity;
  readonly slashPolicy:
    | "none"
    | "no-trailing"
    | "trailing"
    | "mixed";
  readonly staticParams: readonly PublisherNextRouteParams[];
  readonly resolveRoute: (
    segments: unknown,
  ) => PublisherNextRouteResolution;
  readonly renderPage: (
    page: PublisherNextPage,
  ) => Promise<ReactElement>;
  readonly RootPage: () => Promise<ReactElement>;
  readonly NotFoundPage: () => ReactElement;
  readonly Page: (
    props: PublisherNextPageProps,
  ) => Promise<ReactElement>;
  readonly RootLayout: (
    props: PublisherNextRootLayoutProps,
  ) => ReactElement;
  readonly generateStaticParams: () =>
    PublisherNextRouteParams[];
  readonly generateRootMetadata: () => Promise<Metadata>;
  readonly generateMetadata: (
    props: PublisherNextPageProps,
  ) => Promise<Metadata>;
  readonly handleRequest: (
    request: Request,
  ) => Promise<Response | undefined>;
  readonly createNextConfig: (
    baseConfig?: NextConfig,
  ) => NextConfig;
}

export interface CreatePublicationNextApplicationOptions {
  readonly reader: unknown;
  readonly audioData?: unknown;
  readonly extensionData?: unknown;
  readonly extensions?: unknown;
  readonly syncData?: unknown;
  readonly theme?: ResolvedPublisherNextTheme;
  readonly updates?: ResolvedPublisherNextUpdates;
  readonly updatesData?: unknown;
}
