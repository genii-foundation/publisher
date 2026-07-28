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
  PublicationState,
  PublisherAttribution,
  PublisherIdentity,
} from "./types.js";
import type {
  ContentAddress,
  ContentContinuity,
  ContentLinkTarget,
  ContentRoute,
  Sha256Digest,
} from "./content-types.js";

export const READER_ENVELOPE_SCHEMA_URL =
  "https://publisher.genii.foundation/schemas/reader-envelope.schema.json";
export const READER_SCHEMA_VERSION = "1.0";
export const READER_ARTIFACT_KIND = "publication-reader";
export const READER_ARTIFACT_MEDIA_TYPE =
  "application/vnd.genii.publisher.reader+json";
export const READER_ARTIFACT_RELATIVE_PATH =
  "reader/publication-reader.json";

export const READER_TEXT_PROFILE = Object.freeze({
  id: "genii-reader-block-markdown",
  version: "1.0",
  representation: "markdown",
  normalization: "none",
  offsetUnit: "utf-16-code-unit",
  rangeScope: "block",
  endBoundary: "exclusive",
} as const);

export type ReaderAudience = "preview" | "public";

export interface ReaderContentSourceIdentity {
  readonly kind: "publication-content";
  readonly schemaVersion: "1.0";
  readonly publicationId: string;
  readonly engineVersion: string;
  readonly compilerVersion: string;
  readonly buildId: Sha256Digest;
  readonly contentHash: Sha256Digest;
}

export interface ReaderPublicationIdentity {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly language: string;
  readonly canonicalUrl?: string;
  readonly publisher: PublisherIdentity;
  readonly attribution: PublisherAttribution;
}

export interface ReaderSectionAddress extends ContentAddress {
  readonly anchor?: string;
}

export interface ReaderBlockAddress extends ContentAddress {
  readonly anchor: string;
}

export interface ReaderBlock {
  readonly id: string;
  readonly kind: string;
  readonly markdown: string;
  readonly text: string;
  readonly readerAddress: ReaderBlockAddress | null;
  readonly domId: string | null;
  readonly wordCount: number;
  readonly contentHash: Sha256Digest;
}

export interface ReaderSection {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly depth: number;
  readonly order: number;
  readonly routes: Readonly<Record<string, ContentAddress>>;
  readonly activeRouteNames: readonly string[];
  readonly readerAddress: ReaderSectionAddress | null;
  readonly domId: string | null;
  readonly continuity: ContentContinuity;
  readonly navigable: boolean;
  readonly blocks: readonly ReaderBlock[];
  readonly previousId: string | null;
  readonly nextId: string | null;
  readonly wordCount: number;
  readonly readingMinutes: number;
  readonly contentHash: Sha256Digest;
}

export interface ReaderWork {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly summary?: string;
  readonly language: string;
  readonly publicationState: PublicationState;
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly route: string;
  readonly rootSectionIds: readonly string[];
  readonly sections: readonly ReaderSection[];
  readonly wordCount: number;
  readonly readingMinutes: number;
  readonly contentHash: Sha256Digest;
}

export interface ReaderCollection {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly publicationState: PublicationState;
  readonly route: string;
  readonly workIds: readonly string[];
}

export interface ReaderAsset {
  readonly id: string;
  readonly workId?: string;
  readonly href: string;
  readonly mediaType: string;
  readonly hash: Sha256Digest;
}

export interface ReaderBlockMarkdownRange {
  readonly start: number;
  readonly end: number;
}

interface ReaderLinkLocationBase {
  readonly workId: string;
  readonly sectionId: string;
}

export type ReaderLinkLocation =
  | (ReaderLinkLocationBase & {
      readonly kind: "semantic";
      readonly blockId?: string;
    })
  | (ReaderLinkLocationBase & {
      readonly kind: "block-markdown";
      readonly blockId: string;
      readonly range: ReaderBlockMarkdownRange;
    });

export interface ReaderLink {
  readonly id: string;
  readonly source: ReaderLinkLocation;
  readonly target: ContentLinkTarget;
  readonly href: string;
  readonly label?: string;
  readonly relation?: string;
}

export interface ReaderStatistics {
  readonly workCount: number;
  readonly collectionCount: number;
  readonly sectionCount: number;
  readonly blockCount: number;
  readonly wordCount: number;
  readonly readingMinutes: number;
  readonly wordsPerMinute: number;
}

export interface PublicationReaderEnvelope {
  readonly $schema: typeof READER_ENVELOPE_SCHEMA_URL;
  readonly schemaVersion: typeof READER_SCHEMA_VERSION;
  readonly publicationId: string;
  readonly engineVersion: string;
  readonly readerVersion: string;
  readonly buildId: Sha256Digest;
  readonly source: ReaderContentSourceIdentity;
  readonly artifact: {
    readonly kind: typeof READER_ARTIFACT_KIND;
    readonly mediaType: typeof READER_ARTIFACT_MEDIA_TYPE;
    readonly relativePath: typeof READER_ARTIFACT_RELATIVE_PATH;
  };
  readonly audience: ReaderAudience;
  readonly textProfile: typeof READER_TEXT_PROFILE;
  readonly publication: ReaderPublicationIdentity;
  readonly works: readonly ReaderWork[];
  readonly collections: readonly ReaderCollection[];
  readonly assets: readonly ReaderAsset[];
  readonly links: readonly ReaderLink[];
  readonly routes: {
    readonly active: readonly ContentRoute[];
    readonly redirects: readonly {
      readonly from: string;
      readonly to: string;
      readonly status: 301 | 302 | 307 | 308;
    }[];
  };
  readonly statistics: ReaderStatistics;
}
