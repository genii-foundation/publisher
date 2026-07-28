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

export type JSONPrimitive = boolean | null | number | string;

export type JSONValue =
  | JSONPrimitive
  | { readonly [key: string]: JSONValue }
  | readonly JSONValue[];

export type PublicationState =
  | "archived"
  | "draft"
  | "published"
  | "unlisted";

export interface CatalogReference {
  readonly id: string;
  readonly manifest?: string;
}

export interface PublisherIdentity {
  readonly name: string;
  readonly url?: string;
}

export interface PublicationIdentity {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly language: string;
  readonly canonicalUrl?: string;
  readonly publisher: PublisherIdentity;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export interface EngineCompatibility {
  readonly compatibility: string;
}

export interface CanonicalLayout {
  readonly mode: "canonical";
}

export interface WorkLayoutOverride {
  readonly root?: string;
  readonly manifestTemplate?: string;
}

export interface CollectionLayoutOverride {
  readonly root?: string;
  readonly manifestTemplate?: string;
}

export interface LayoutOverrides {
  readonly works?: WorkLayoutOverride;
  readonly collections?: CollectionLayoutOverride;
  readonly assets?: string;
  readonly continuity?: string;
}

export interface DeclaredLayout {
  readonly mode: "declared";
  readonly overrides: LayoutOverrides;
}

export type PublicationLayout = CanonicalLayout | DeclaredLayout;

export interface PackageReference {
  readonly package: string;
  readonly config?: Readonly<Record<string, JSONValue>>;
}

export interface ExtensionReference {
  readonly id: string;
  readonly package: string;
  readonly config?: Readonly<Record<string, JSONValue>>;
}

export interface AudioConfiguration {
  readonly adapter: PackageReference;
  readonly catalog?: string;
}

export interface SyncConfiguration {
  readonly provider: PackageReference;
  readonly consent: "opt-in";
  readonly localFallback: true;
  readonly capabilities: readonly string[];
}

export interface PublicationRoutes {
  readonly home: string;
  readonly work: string;
  readonly collection?: string;
  readonly updates?: string;
}

export type RedirectStatus = 301 | 302 | 307 | 308;

export interface ContinuityRedirect {
  readonly from: string;
  readonly to: string;
  readonly status: RedirectStatus;
}

export interface ContinuityConfiguration {
  readonly redirects: readonly ContinuityRedirect[];
}

export interface PublicationBoundaries {
  readonly sourceRoots: readonly string[];
  readonly outputRoots: readonly string[];
}

export interface PublisherAttribution {
  readonly placement: "footer";
  readonly copyright: "Copyright 2026 GENII Foundation";
  readonly text: "Published with GENII Publisher";
  readonly url: "https://publisher.genii.foundation";
  readonly sourceCodeUrl: string;
}

export interface PublicationManifest {
  readonly $schema?:
    "https://publisher.genii.foundation/schemas/publication.schema.json";
  readonly schemaVersion: string;
  readonly publication: PublicationIdentity;
  readonly engine: EngineCompatibility;
  readonly layout: PublicationLayout;
  readonly works: readonly CatalogReference[];
  readonly collections?: readonly CatalogReference[];
  readonly theme?: PackageReference;
  readonly extensions?: readonly ExtensionReference[];
  readonly audio?: AudioConfiguration;
  readonly sync?: SyncConfiguration;
  readonly routes: PublicationRoutes;
  readonly continuity?: ContinuityConfiguration;
  readonly boundaries: PublicationBoundaries;
  readonly attribution: PublisherAttribution;
}

export interface RepositoryRelativePath {
  readonly path: string;
  readonly relativeTo: "repository";
}

export type SourcePath = string | RepositoryRelativePath;

export interface WorkManifest {
  readonly $schema?:
    "https://publisher.genii.foundation/schemas/work.schema.json";
  readonly schemaVersion: string;
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly summary?: string;
  readonly language: string;
  readonly publicationState: PublicationState;
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly route?: string;
  readonly manuscript: SourcePath;
  readonly assets?: SourcePath;
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export interface CollectionManifest {
  readonly $schema?:
    "https://publisher.genii.foundation/schemas/collection.schema.json";
  readonly schemaVersion: string;
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly publicationState?: PublicationState;
  readonly route?: string;
  readonly workIds: readonly string[];
  readonly metadata?: Readonly<Record<string, JSONValue>>;
}

export type ManifestKind = "collection" | "publication" | "work";

export interface ManifestByKind {
  readonly collection: CollectionManifest;
  readonly publication: PublicationManifest;
  readonly work: WorkManifest;
}

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly documentPath?: string;
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly schemaPath?: string;
}

export type ValidationResult<T> =
  | {
      readonly valid: true;
      readonly value: T;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly valid: false;
      readonly diagnostics: readonly Diagnostic[];
    };
