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

export {
  buildPublicationReader,
  derivePublicationWorkInputs,
  rootSectionIdFor,
} from "./node/build.js";
export type {
  BuildPublicationReaderInput,
  BuiltPublicationReader,
} from "./node/build.js";
export {
  buildAudioEnvelope,
  resolvePublicationAudio,
} from "./node/audio.js";
export type {
  BuildAudioEnvelopeInput,
  BuiltAudioEnvelope,
  ResolvedAudioVoice,
  ResolvedPublicationAudio,
  ResolvePublicationAudioInput,
} from "./node/audio.js";
export {
  SYNC_DATA_ARTIFACT,
  buildSyncEnvelope,
  resolvePublicationSync,
} from "./node/sync.js";
export {
  buildUpdatesEnvelope,
  resolvePublicationUpdates,
} from "./node/updates.js";
export type {
  BuildUpdatesEnvelopeInput,
  BuiltUpdatesEnvelope,
  ResolvedPublicationUpdates,
  ResolvePublicationUpdatesInput,
} from "./node/updates.js";
export type {
  BuildSyncEnvelopeInput,
  BuiltSyncEnvelope,
  ResolvedPublicationSync,
} from "./node/sync.js";
export {
  compileLoadedPublicationContent,
} from "./node/compile.js";
export {
  AUDIO_DATA_ARTIFACT,
  EXTENSION_DATA_ARTIFACT,
  PROGRESS_DATA_ARTIFACT,
  PUBLIC_IDENTITY_DATA_ARTIFACT,
  SEARCH_DATA_ARTIFACT,
  UPDATES_DATA_ARTIFACT,
  assertHostCanCarryDataArtifact,
  assertHostCanServe,
  findUnsupportedHostFeatures,
  readHostCapabilities,
} from "./node/host-capabilities.js";
export {
  PUBLISHER_EXTENSION_API_VERSION,
  PUBLISHER_EXTENSION_DATA_SCHEMA_VERSION,
  PUBLISHER_EXTENSION_HANDLER_METHODS,
  projectPublisherExtensions,
  resolvePublisherExtensions,
} from "./node/extensions.js";
export type {
  PublisherExtensionDataEntry,
  PublisherExtensionDataEnvelope,
  PublisherExtensionImplementation,
  PublisherExtensionHandlerMethod,
  PublisherExtensionHandlerProjectInput,
  PublisherExtensionHandlerProjection,
  PublisherExtensionProjectInput,
  PublisherExtensionProjection,
  PublisherExtensionRouteProjectInput,
  PublisherExtensionRouteProjection,
  PublisherExtensionRegistration,
  ResolvedPublisherExtensions,
} from "./node/extensions.js";
export type {
  HostCapabilities,
  UnsupportedHostFeature,
} from "./node/host-capabilities.js";
export {
  PUBLICATION_MANIFEST_FILENAME,
  ProtectedRootsError,
  resolvePublicationProtectedRoots,
} from "./node/protected-roots.js";
export {
  ArtifactDestinationError,
  checkHostArtifact,
  hashArtifactText,
  resolveArtifactDestination,
  stagedArtifactPathFor,
  writeHostArtifact,
} from "./node/materialize.js";
export type {
  ArtifactCheckResult,
  ArtifactDestination,
  ArtifactDestinationInput,
  ArtifactWriteResult,
} from "./node/materialize.js";
export {
  loadPublicationCompilationSources,
} from "./node/loader.js";
export {
  PUBLISHER_SOURCE_LOADER_LIMITS,
} from "./node/types.js";
export type {
  CompileLoadedPublicationContentInput,
} from "./node/compile.js";
export type {
  LoadedPublicationCompilationSources,
  LoadedUpdatesCatalog,
  LoadPublicationCompilationSourcesInput,
  LoadPublicationCompilationSourcesResult,
  PublicationSourceLoaderLimits,
} from "./node/types.js";
export {
  PREVIEW_CANDIDATE_IDENTITY_VERSION,
  PREVIEW_CANDIDATE_LIMITS,
  PreviewCandidateIdentityError,
  capturePreviewCandidateIdentity,
  parsePreviewCandidateIdentity,
  verifyPreviewCandidateIdentity,
} from "./node/preview-candidate.js";
export type {
  CapturePreviewCandidateIdentityInput,
  PreviewCandidateEntry,
  PreviewCandidateEntryKind,
  PreviewCandidateIdentity,
  PreviewCandidateMismatch,
  PreviewCandidateVerification,
  VerifyPreviewCandidateIdentityInput,
} from "./node/preview-candidate.js";
