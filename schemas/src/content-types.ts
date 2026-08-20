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
  ContinuityRedirect,
  ExtensionCapability,
  JSONValue,
  PublicationState,
  PublisherAttribution,
  PublisherIdentity,
} from "./types.js";

export const CONTENT_ENVELOPE_SCHEMA_URL =
  "https://publisher.genii.foundation/schemas/content-envelope.schema.json";
export const CONTENT_SCHEMA_VERSION = "1.0";
export const CONTENT_ARTIFACT_MEDIA_TYPE =
  "application/vnd.genii.publisher.content+json";
export const CONTENT_ARTIFACT_RELATIVE_PATH =
  "content/publication-content.json";

export type Sha256Digest = `sha256:${string}`;

export interface CompiledPublication {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly language: string;
  readonly canonicalUrl?: string;
  readonly publisher: PublisherIdentity;
  readonly attribution: PublisherAttribution;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

interface SourceProvenanceBase {
  readonly path: string;
  readonly role:
    | "asset"
    | "collection-manifest"
    | "extension"
    | "manuscript"
    | "publication-manifest"
    | "work-manifest";
  readonly entityId?: string;
  readonly mediaType: string;
  readonly rawByteLength: number;
  readonly rawHash: Sha256Digest;
  readonly normalizedByteLength: number;
  readonly normalizedHash: Sha256Digest;
}

export type SourceProvenance =
  | (SourceProvenanceBase & {
      readonly kind: "text";
      readonly encoding: "utf-8";
      readonly normalizedCodeUnitLength: number;
      readonly normalizedLineStarts: readonly number[];
    })
  | (SourceProvenanceBase & {
      readonly kind: "binary";
    });

export interface SourcePoint {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface SourceSpan {
  readonly sourcePath: string;
  readonly start: SourcePoint;
  readonly end: SourcePoint;
}

export interface MarkdownContentBlock {
  readonly id: string;
  readonly anchor: string;
  readonly kind: string;
  readonly markdown: string;
  readonly text: string;
  readonly provenance: SourceSpan;
  readonly wordCount: number;
  readonly contentHash: Sha256Digest;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export interface ContentAddress {
  readonly path: string;
  readonly anchor?: string;
}

export interface ContentContinuity {
  readonly id: string;
  readonly legacyIds: readonly string[];
  readonly progressGroups: readonly (readonly string[])[];
  readonly historicalSectionIds: readonly string[];
}

export interface CompiledSection {
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
  readonly blocks: readonly MarkdownContentBlock[];
  readonly previousId: string | null;
  readonly nextId: string | null;
  readonly wordCount: number;
  readonly readingMinutes: number;
  readonly contentHash: Sha256Digest;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export interface CompiledWork {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly summary?: string;
  readonly language: string;
  readonly publicationState: PublicationState;
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly route: string;
  readonly source: {
    readonly manifestPath: string;
    readonly manuscriptPath: string;
    readonly assetsPath?: string;
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
  readonly sections: readonly CompiledSection[];
  readonly wordCount: number;
  readonly readingMinutes: number;
  readonly contentHash: Sha256Digest;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export interface CompiledCollection {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly publicationState?: PublicationState;
  readonly route: string;
  readonly manifestPath: string;
  readonly workIds: readonly string[];
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export type ContentRoute =
  | {
      readonly path: string;
      readonly target: { readonly kind: "home" };
    }
  | {
      readonly path: string;
      readonly target: {
        readonly kind: "updates";
        readonly viewId: string;
        readonly pagination?: {
          readonly path: string;
          readonly pageSize: number;
        };
      };
    }
  | {
      readonly path: string;
      readonly target: {
        readonly kind: "work";
        readonly workId: string;
      };
    }
  | {
      readonly path: string;
      readonly target: {
        readonly kind: "collection";
        readonly collectionId: string;
      };
    }
  | {
      readonly path: string;
      readonly target: {
        readonly kind: "section";
        readonly workId: string;
        readonly sectionId: string;
        readonly routeName: string;
      };
    };

export interface ResolvedContentAsset {
  readonly id: string;
  readonly workId?: string;
  readonly sourcePath: string;
  readonly href: string;
  readonly mediaType: string;
  readonly hash: Sha256Digest;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

interface ContentLocationBase {
  readonly workId: string;
  readonly sectionId: string;
  readonly blockId?: string;
}

export type ContentLocation =
  | (ContentLocationBase & {
      readonly kind: "semantic";
    })
  | (ContentLocationBase & {
      readonly kind: "source";
      readonly occurrence: SourceSpan;
    });

export type ContentLinkTarget =
  | {
      readonly kind: "asset";
      readonly assetId: string;
    }
  | {
      readonly kind: "collection";
      readonly collectionId: string;
    }
  | {
      readonly kind: "external";
      readonly url: string;
    }
  | {
      readonly kind: "section";
      readonly workId: string;
      readonly sectionId: string;
      readonly routeName: string;
    }
  | {
      readonly kind: "work";
      readonly workId: string;
    };

export interface ResolvedContentLink {
  readonly id: string;
  readonly source: ContentLocation;
  readonly target: ContentLinkTarget;
  readonly href: string;
  readonly label?: string;
  readonly relation?: string;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export interface CompiledExtension {
  readonly id: string;
  readonly package: string;
  readonly version: string;
  readonly capabilities: readonly ExtensionCapability[];
  readonly config?: Readonly<Record<string, JSONValue>>;
  readonly payloadIds: readonly string[];
}

export interface CompiledContentPayload {
  readonly id: string;
  readonly extensionId: string;
  readonly schema: string;
  readonly sourcePaths: readonly string[];
  readonly data: JSONValue;
  readonly contentHash: Sha256Digest;
}

export interface CompiledSourceAuthority {
  readonly publicationManifestPath: string;
  readonly sourceRoots: readonly string[];
  readonly outputRoots: readonly string[];
  readonly sharedAssetsRoot: string;
}

export interface PublicationContentEnvelope {
  readonly $schema: typeof CONTENT_ENVELOPE_SCHEMA_URL;
  readonly schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  readonly publicationId: string;
  readonly engineVersion: string;
  readonly compilerVersion: string;
  readonly buildId: Sha256Digest;
  readonly artifact: {
    readonly kind: "publication-content";
    readonly mediaType: typeof CONTENT_ARTIFACT_MEDIA_TYPE;
    readonly outputRoot: string;
    readonly relativePath: typeof CONTENT_ARTIFACT_RELATIVE_PATH;
  };
  readonly hashes: {
    readonly sourceSet: Sha256Digest;
    readonly content: Sha256Digest;
  };
  readonly publication: CompiledPublication;
  readonly sourceAuthority: CompiledSourceAuthority;
  readonly sources: readonly SourceProvenance[];
  readonly extensions: readonly CompiledExtension[];
  readonly payloads: readonly CompiledContentPayload[];
  readonly works: readonly CompiledWork[];
  readonly collections: readonly CompiledCollection[];
  readonly assets: readonly ResolvedContentAsset[];
  readonly links: readonly ResolvedContentLink[];
  readonly routes: {
    readonly active: readonly ContentRoute[];
    readonly redirects: readonly ContinuityRedirect[];
  };
  readonly statistics: {
    readonly workCount: number;
    readonly collectionCount: number;
    readonly sectionCount: number;
    readonly blockCount: number;
    readonly wordCount: number;
    readonly readingMinutes: number;
    readonly wordsPerMinute: number;
  };
}
