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
  ContentAddress,
  ContentContinuity,
  ContentLinkTarget,
  ExtensionCapability,
  JSONValue,
  PublicationContentEnvelope,
  PublicationManifest,
  ResolvedPublicationSourceGraph,
  SourceProvenance,
} from "@genii-foundation/publisher-schema";

export const CONTENT_COMPILER_VERSION = "0.1.0-alpha.0";
export const DEFAULT_WORDS_PER_MINUTE = 220;

interface CompilationSourceInputBase {
  readonly path: string;
  readonly role: SourceProvenance["role"];
  readonly entityId?: string;
  readonly mediaType: string;
}

export type CompilationSourceInput =
  | (CompilationSourceInputBase & {
      readonly contents: string;
      readonly rawBytes: Uint8Array;
    })
  | (CompilationSourceInputBase & {
      readonly contents: Uint8Array;
      readonly rawBytes?: never;
    });

export interface CompilationSourceRange {
  readonly sourcePath: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface MarkdownBlockInput {
  readonly id: string;
  readonly anchor: string;
  readonly kind: string;
  readonly markdown: string;
  readonly text: string;
  readonly wordCount?: number;
  readonly provenance: CompilationSourceRange;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export type SectionReaderLocationInput =
  | {
      readonly kind: "none";
    }
  | {
      readonly kind: "route";
      readonly routeName: string;
    }
  | {
      readonly kind: "work";
    };

export interface SectionContentInput {
  readonly id: string;
  readonly role?: string;
  readonly title: string;
  readonly parentId?: string;
  readonly routes?: Readonly<Record<string, ContentAddress>>;
  readonly activeRouteNames?: readonly string[];
  readonly readerLocation: SectionReaderLocationInput;
  readonly continuity?: ContentContinuity;
  readonly navigable?: boolean;
  readonly blocks: readonly MarkdownBlockInput[];
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export interface ContentAdapterIdentity {
  readonly id: string;
  readonly package: string;
  readonly version: string;
}

export interface ContentMetricsIdentity {
  readonly id: string;
  readonly package: string;
  readonly version: string;
  readonly profileVersion: string;
}

export interface WorkContentInput {
  readonly workId: string;
  readonly adapter: ContentAdapterIdentity;
  readonly metrics?: ContentMetricsIdentity;
  readonly sections: readonly SectionContentInput[];
}

export interface ResolvedExtensionInput {
  readonly id: string;
  readonly package: string;
  readonly version: string;
  readonly capabilities: readonly ExtensionCapability[];
}

export interface ContentPayloadInput {
  readonly id: string;
  readonly extensionId: string;
  readonly schema: string;
  readonly sourcePaths: readonly string[];
  readonly data: JSONValue;
}

export interface ResolvedContentAssetInput {
  readonly id: string;
  readonly workId?: string;
  readonly sourcePath: string;
  readonly href: string;
  readonly mediaType: string;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

interface ResolvedContentLinkLocationBase {
  readonly workId: string;
  readonly sectionId: string;
  readonly blockId?: string;
}

export type ResolvedContentLinkLocationInput =
  | (ResolvedContentLinkLocationBase & {
      readonly kind: "semantic";
    })
  | (ResolvedContentLinkLocationBase & {
      readonly kind: "source";
      readonly occurrence: CompilationSourceRange;
    });

export interface ResolvedContentLinkInput {
  readonly id: string;
  readonly source: ResolvedContentLinkLocationInput;
  readonly target: ContentLinkTarget;
  readonly href: string;
  readonly label?: string;
  readonly relation?: string;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export interface CompilePublicationContentInput {
  readonly engineVersion: string;
  readonly publication: PublicationManifest;
  readonly sourceGraph: ResolvedPublicationSourceGraph;
  readonly sources: readonly CompilationSourceInput[];
  readonly works: readonly WorkContentInput[];
  readonly extensions?: readonly ResolvedExtensionInput[];
  readonly payloads?: readonly ContentPayloadInput[];
  readonly assets?: readonly ResolvedContentAssetInput[];
  readonly links?: readonly ResolvedContentLinkInput[];
  readonly wordsPerMinute?: number;
}

export interface CompileMarkdownWorkInput {
  readonly workId: string;
  readonly sectionId: string;
  readonly title: string;
  readonly sourcePath: string;
  readonly markdown: string;
  readonly route?: string;
  readonly routeAnchor?: string;
  readonly sectionMetadata?: Readonly<Record<string, JSONValue>>;
  readonly adapter?: ContentAdapterIdentity;
}

export interface CompiledMarkdownWorkInput {
  readonly source: CompilationSourceInput;
  readonly work: WorkContentInput;
}

export interface PublicationContentArtifact {
  readonly outputRoot: string;
  readonly relativePath: "content/publication-content.json";
  readonly mediaType: "application/vnd.genii.publisher.content+json";
  readonly text: string;
  readonly hash: `sha256:${string}`;
  readonly envelope: PublicationContentEnvelope;
}
