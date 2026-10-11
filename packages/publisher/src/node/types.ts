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
  AudioClipCatalog,
  PublicationManifest,
  ResolvedPublicationSourceGraph,
  ValidationResult,
} from "@genii-foundation/publisher-schema";
import {
  PUBLICATION_PROTOCOL_LIMITS,
} from "@genii-foundation/publisher-schema";
import type {
  CompilationSourceInput,
} from "@genii-foundation/publisher-content";

declare const loadedPublicationCompilationSourcesBrand: unique symbol;

/** A loaded clip catalog, with the exact text it was parsed from. */
export interface LoadedAudioCatalog {
  /** The path the publication manifest declared, as declared. */
  readonly path: string;
  readonly catalog: AudioClipCatalog;
  /**
   * Exact text as loaded, so a downstream artifact can bind this catalog by
   * hash rather than by trusting that the parsed value round-trips.
   */
  readonly text: string;
}

export interface LoadPublicationCompilationSourcesInput {
  readonly publicationRoot: string;
}

export interface LoadedPublicationCompilationSources {
  readonly [loadedPublicationCompilationSourcesBrand]: true;
  readonly publication: PublicationManifest;
  readonly sourceGraph: ResolvedPublicationSourceGraph;
  readonly sources: readonly CompilationSourceInput[];
  /**
   * The published clip catalog, when the publication declares one.
   *
   * Loaded here rather than read later by the build path so that it inherits
   * source containment and the byte ceilings. A file the engine reads behind the
   * loader's back is a file with no provenance.
   *
   * Deliberately not part of `sources`. Those are the documents the content
   * compiler consumes, and the compiler refuses a source that is not in the
   * resolved publication graph, correctly: a catalog is narration metadata and
   * nothing in the reader artifact derives from it. Its own text is carried here
   * so that the artifact that does depend on it can bind it by hash.
   */
  readonly audioCatalog?: LoadedAudioCatalog;
}

export interface PublicationSourceLoaderLimits {
  readonly maximumCollectionWorkReferences: number;
  readonly maximumDirectoryEntries: number;
  readonly maximumDirectoryEntriesTotal: number;
  readonly maximumDirectoryNameBytes: number;
  readonly maximumDirectoryNameBytesTotal: number;
  readonly maximumDirectoryPathBytesTotal: number;
  readonly maximumDirectorySnapshots: number;
  readonly maximumAudioCatalogBytes: number;
  readonly maximumManifestBytes: number;
  readonly maximumManuscriptBytes: number;
  readonly maximumSourceFiles: number;
  readonly maximumTotalBytes: number;
}

export const PUBLISHER_SOURCE_LOADER_LIMITS =
  Object.freeze<PublicationSourceLoaderLimits>({
    maximumCollectionWorkReferences:
      PUBLICATION_PROTOCOL_LIMITS.maximumCollectionWorkReferences,
    maximumDirectoryEntries: 20_000,
    maximumDirectoryEntriesTotal: 100_000,
    maximumDirectoryNameBytes: 4 * 1024 * 1024,
    maximumDirectoryNameBytesTotal: 16 * 1024 * 1024,
    maximumDirectoryPathBytesTotal: 4 * 1024 * 1024,
    maximumDirectorySnapshots: 20_000,
    // A catalog is one document covering every narrated section, so it outgrows
    // the manifest ceiling long before it is unreasonable. A measured catalog of
    // 551 clips is 278 KB, about 505 bytes per clip, so this admits roughly
    // 16,000 clips. The total snapshot ceiling binds before the structural cap in
    // the schema does, which is the same ordering every other source has.
    maximumAudioCatalogBytes: 8 * 1024 * 1024,
    maximumManifestBytes: 1024 * 1024,
    maximumManuscriptBytes: 16 * 1024 * 1024,
    maximumSourceFiles:
      PUBLICATION_PROTOCOL_LIMITS.maximumCompilationSources,
    maximumTotalBytes: 32 * 1024 * 1024,
  });

export type LoadPublicationCompilationSourcesResult =
  ValidationResult<LoadedPublicationCompilationSources>;
