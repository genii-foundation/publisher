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
  validateAudioCatalogShape,
  type AudioCatalogVoice,
  type AudioCheckpoint,
  type AudioCheckpointUnit,
  type AudioClip,
  type AudioClipCatalog,
  type Diagnostic,
  type Sha256Digest,
  type ValidationResult,
} from "@genii-foundation/publisher-schema";

import { validateAudioCheckpoint } from "./audio-checkpoint.js";
import {
  audioCatalogSha256,
  isPublicAudioObjectBaseUrl,
  publicAudioObjectHref,
} from "./audio-evidence.js";
import { immutableSnapshot } from "./immutability.js";

const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const OPAQUE_ID = STABLE_ID;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface ChangedSpokenUnit {
  readonly sectionId: string;
  readonly audioVersionId: string;
  readonly spokenTextSha256: Sha256Digest;
}

export interface AudioPublicationEvidenceMatch {
  readonly sectionId: string;
  readonly audioVersionId: string;
  readonly voiceId: string;
  readonly checkpointId: string;
}

export interface AudioPublicationGuardReport {
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly baseCatalogSha256: Sha256Digest;
  readonly candidateCatalogSha256: Sha256Digest;
  readonly changedSectionIds: readonly string[];
  readonly checkedVoiceIds: readonly string[];
  readonly evidenceMatches: readonly AudioPublicationEvidenceMatch[];
}

export interface AudioPublicationGuardInput {
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly baseCatalog: unknown;
  readonly expectedBaseCatalogSha256: Sha256Digest;
  readonly candidateCatalog: unknown;
  readonly expectedCandidateCatalogSha256: Sha256Digest;
  readonly changedUnits: readonly ChangedSpokenUnit[];
  readonly checkpoints: readonly unknown[];
  readonly publicObjectBaseUrl: string;
}

interface CapturedAudioPublicationGuardInput {
  readonly publicationId: unknown;
  readonly readerBuildId: unknown;
  readonly baseCatalog: unknown;
  readonly expectedBaseCatalogSha256: unknown;
  readonly candidateCatalog: unknown;
  readonly expectedCandidateCatalogSha256: unknown;
  readonly changedUnits: unknown;
  readonly checkpoints: unknown;
  readonly publicObjectBaseUrl: unknown;
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  params: Readonly<Record<string, unknown>> = {},
): Diagnostic {
  return Object.freeze({
    code,
    severity: "error",
    documentPath: "audio-publication-guard.json",
    path,
    message,
    keyword: "semantic",
    params: Object.freeze({ ...params }),
  });
}

function invalid(diagnostics: readonly Diagnostic[]): ValidationResult<never> {
  return immutableSnapshot({ valid: false, diagnostics });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function captureInput(
  input: AudioPublicationGuardInput,
): CapturedAudioPublicationGuardInput | null {
  try {
    return {
      publicationId: input.publicationId,
      readerBuildId: input.readerBuildId,
      baseCatalog: input.baseCatalog,
      expectedBaseCatalogSha256: input.expectedBaseCatalogSha256,
      candidateCatalog: input.candidateCatalog,
      expectedCandidateCatalogSha256:
        input.expectedCandidateCatalogSha256,
      changedUnits: input.changedUnits,
      checkpoints: input.checkpoints,
      publicObjectBaseUrl: input.publicObjectBaseUrl,
    };
  } catch {
    return null;
  }
}

function copiedArray(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  try {
    return [...value];
  } catch {
    return null;
  }
}

function changedUnit(
  value: unknown,
  index: number,
  diagnostics: Diagnostic[],
): ChangedSpokenUnit | null {
  let snapshot: unknown;
  try {
    snapshot = immutableSnapshot(value);
  } catch {
    diagnostics.push(diagnostic(
      "audio_publication.changed_unit.uninspectable",
      `/changedUnits/${index}`,
      "The changed spoken unit could not be inspected safely.",
    ));
    return null;
  }
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    diagnostics.push(diagnostic(
      "audio_publication.changed_unit.invalid",
      `/changedUnits/${index}`,
      "Every changed spoken unit must be a plain record.",
    ));
    return null;
  }
  const record = snapshot as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareText);
  if (
    keys.length !== 3 ||
    keys[0] !== "audioVersionId" ||
    keys[1] !== "sectionId" ||
    keys[2] !== "spokenTextSha256"
  ) {
    diagnostics.push(diagnostic(
      "audio_publication.changed_unit.properties",
      `/changedUnits/${index}`,
      "A changed spoken unit must contain only sectionId, audioVersionId, and spokenTextSha256.",
    ));
    return null;
  }
  if (
    typeof record.sectionId !== "string" ||
    record.sectionId.length > 128 ||
    !STABLE_ID.test(record.sectionId) ||
    typeof record.audioVersionId !== "string" ||
    record.audioVersionId.length > 256 ||
    !OPAQUE_ID.test(record.audioVersionId) ||
    typeof record.spokenTextSha256 !== "string" ||
    !SHA256_DIGEST.test(record.spokenTextSha256)
  ) {
    diagnostics.push(diagnostic(
      "audio_publication.changed_unit.identity_invalid",
      `/changedUnits/${index}`,
      "Changed spoken unit identities must satisfy the public section, audio version, and SHA-256 contracts.",
    ));
    return null;
  }
  return record as unknown as ChangedSpokenUnit;
}

function exactCatalogHash(
  catalog: AudioClipCatalog,
  expected: unknown,
  path: string,
  diagnostics: Diagnostic[],
): Sha256Digest {
  const actual = audioCatalogSha256(catalog);
  if (typeof expected !== "string" || !SHA256_DIGEST.test(expected)) {
    diagnostics.push(diagnostic(
      "audio_publication.catalog_hash.invalid",
      path,
      "An expected catalog hash must be a lowercase SHA-256 digest.",
    ));
  } else if (expected !== actual) {
    diagnostics.push(diagnostic(
      "audio_publication.catalog_hash.mismatch",
      path,
      "The audio catalog does not match the exact reviewed hash.",
      { actual, expected },
    ));
  }
  return actual;
}

function duplicateVoiceDiagnostics(
  catalog: AudioClipCatalog,
  catalogPath: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const [index, voice] of catalog.voices.entries()) {
    if (seen.has(voice.id)) {
      diagnostics.push(diagnostic(
        "audio_publication.voice.duplicate",
        `${catalogPath}/voices/${index}/id`,
        "Each narrator may appear only once in an audio catalog.",
        { voiceId: voice.id },
      ));
    }
    seen.add(voice.id);
  }
  return diagnostics;
}

function clipMatchesCheckpoint(
  clip: AudioClip,
  unit: AudioCheckpointUnit,
  publicObjectBaseUrl: string,
): boolean {
  return (
    clip.sectionId === unit.sectionId &&
    clip.audioVersionId === unit.audioVersionId &&
    clip.href === publicAudioObjectHref(
      publicObjectBaseUrl,
      unit.audio.objectKey,
    ) &&
    clip.format === unit.audioFormat &&
    clip.byteSize === unit.audio.byteSize &&
    clip.timingsByteSize === unit.timings.byteSize &&
    clip.durationSeconds === unit.durationSeconds
  );
}

function checkpointSupportsClip(
  checkpoint: AudioCheckpoint,
  publicationId: string,
  readerBuildId: string,
  voice: AudioCatalogVoice,
  changed: ChangedSpokenUnit,
  clip: AudioClip,
  publicObjectBaseUrl: string,
): boolean {
  if (
    checkpoint.publicationId !== publicationId ||
    checkpoint.source.readerBuildId !== readerBuildId ||
    checkpoint.voice.id !== voice.id ||
    checkpoint.voice.label !== voice.label ||
    checkpoint.pipeline.provider !== voice.provider ||
    checkpoint.pipeline.model !== voice.model
  ) {
    return false;
  }
  const unit = checkpoint.units.find(
    (candidate) =>
      candidate.sectionId === changed.sectionId &&
      candidate.audioVersionId === changed.audioVersionId &&
      candidate.spokenTextSha256 === changed.spokenTextSha256,
  );
  return unit !== undefined && clipMatchesCheckpoint(
    clip,
    unit,
    publicObjectBaseUrl,
  );
}

/**
 * Refuses narration publication drift using only injected immutable evidence.
 *
 * Git comparison, checkpoint discovery, remote verification, and catalog writes
 * belong to the author workflow. This function has no authority for any of them.
 */
export function validateAudioPublicationGuard(
  input: AudioPublicationGuardInput,
): ValidationResult<AudioPublicationGuardReport> {
  const captured = captureInput(input);
  if (captured === null) {
    return invalid([diagnostic(
      "audio_publication.input.uninspectable",
      "",
      "The audio publication guard input could not be inspected safely.",
    )]);
  }

  const baseResult = validateAudioCatalogShape(captured.baseCatalog);
  if (!baseResult.valid) return baseResult;
  const candidateResult = validateAudioCatalogShape(captured.candidateCatalog);
  if (!candidateResult.valid) return candidateResult;

  const diagnostics: Diagnostic[] = [];
  const baseCatalog = baseResult.value;
  const candidateCatalog = candidateResult.value;
  const baseCatalogSha256 = exactCatalogHash(
    baseCatalog,
    captured.expectedBaseCatalogSha256,
    "/expectedBaseCatalogSha256",
    diagnostics,
  );
  const candidateCatalogSha256 = exactCatalogHash(
    candidateCatalog,
    captured.expectedCandidateCatalogSha256,
    "/expectedCandidateCatalogSha256",
    diagnostics,
  );

  const publicationId =
    typeof captured.publicationId === "string" ? captured.publicationId : "";
  if (
    publicationId.length === 0 ||
    publicationId.length > 128 ||
    !STABLE_ID.test(publicationId)
  ) {
    diagnostics.push(diagnostic(
      "audio_publication.publication_id.invalid",
      "/publicationId",
      "publicationId must satisfy the public stable identity contract.",
    ));
  }
  const readerBuildId =
    typeof captured.readerBuildId === "string" ? captured.readerBuildId : "";
  if (!SHA256_DIGEST.test(readerBuildId)) {
    diagnostics.push(diagnostic(
      "audio_publication.reader_build.invalid",
      "/readerBuildId",
      "readerBuildId must be a lowercase SHA-256 digest.",
    ));
  }
  const publicObjectBaseUrl = isPublicAudioObjectBaseUrl(
    captured.publicObjectBaseUrl,
  )
    ? captured.publicObjectBaseUrl
    : "";
  if (publicObjectBaseUrl.length === 0) {
    diagnostics.push(diagnostic(
      "audio_publication.public_base.invalid",
      "/publicObjectBaseUrl",
      "The public object base must be a canonical HTTPS URL without credentials, query, fragment, or trailing slash.",
    ));
  }

  const rawChangedUnits = copiedArray(captured.changedUnits);
  if (rawChangedUnits === null) {
    diagnostics.push(diagnostic(
      "audio_publication.changed_units.uninspectable",
      "/changedUnits",
      "changedUnits must be an inspectable array.",
    ));
  }
  const changedUnits = (rawChangedUnits ?? [])
    .map((value, index) => changedUnit(value, index, diagnostics))
    .filter((value): value is ChangedSpokenUnit => value !== null);
  const changedSectionIds = new Set<string>();
  for (const [index, changed] of changedUnits.entries()) {
    if (changedSectionIds.has(changed.sectionId)) {
      diagnostics.push(diagnostic(
        "audio_publication.changed_unit.duplicate",
        `/changedUnits/${index}/sectionId`,
        "Each changed section may appear only once.",
        { sectionId: changed.sectionId },
      ));
    }
    changedSectionIds.add(changed.sectionId);
  }
  changedUnits.sort((left, right) =>
    compareText(left.sectionId, right.sectionId)
  );

  const rawCheckpoints = copiedArray(captured.checkpoints);
  if (rawCheckpoints === null) {
    diagnostics.push(diagnostic(
      "audio_publication.checkpoints.uninspectable",
      "/checkpoints",
      "checkpoints must be an inspectable array.",
    ));
  }
  const checkpoints: AudioCheckpoint[] = [];
  for (const [index, checkpoint] of (rawCheckpoints ?? []).entries()) {
    const result = validateAudioCheckpoint(checkpoint);
    if (!result.valid) {
      diagnostics.push(diagnostic(
        "audio_publication.checkpoint.invalid",
        `/checkpoints/${index}`,
        "Every supplied checkpoint must satisfy the complete immutable evidence contract.",
        { diagnosticCodes: result.diagnostics.map(({ code }) => code) },
      ));
    } else {
      checkpoints.push(result.value);
    }
  }

  diagnostics.push(
    ...duplicateVoiceDiagnostics(baseCatalog, "/baseCatalog"),
    ...duplicateVoiceDiagnostics(candidateCatalog, "/candidateCatalog"),
  );

  if (changedUnits.length > 0) {
    const candidateVoiceIds = new Set(
      candidateCatalog.voices.map(({ id }) => id),
    );
    for (const voice of baseCatalog.voices) {
      if (voice.sections.length > 0 && !candidateVoiceIds.has(voice.id)) {
        diagnostics.push(diagnostic(
          "audio_publication.voice.removed",
          "/candidateCatalog/voices",
          "A previously published narrator cannot be removed to waive changed narration.",
          { voiceId: voice.id },
        ));
      }
    }
  }

  const evidenceMatches: AudioPublicationEvidenceMatch[] = [];
  for (const voice of candidateCatalog.voices) {
    for (const changed of changedUnits) {
      const clips = voice.sections.filter(
        ({ sectionId }) => sectionId === changed.sectionId,
      );
      const clip = clips[0];
      if (clips.length !== 1 || clip === undefined) {
        diagnostics.push(diagnostic(
          "audio_publication.clip.match_count",
          "/candidateCatalog/voices",
          "Every current narrator must contain exactly one clip for each changed spoken unit.",
          { actual: clips.length, sectionId: changed.sectionId, voiceId: voice.id },
        ));
        continue;
      }
      if (clip.audioVersionId !== changed.audioVersionId) {
        diagnostics.push(diagnostic(
          "audio_publication.clip.stale",
          "/candidateCatalog/voices",
          "A changed spoken unit must publish its exact current audio version for every narrator.",
          {
            actual: clip.audioVersionId,
            expected: changed.audioVersionId,
            sectionId: changed.sectionId,
            voiceId: voice.id,
          },
        ));
        continue;
      }
      const supporting = checkpoints
        .filter((checkpoint) => checkpointSupportsClip(
          checkpoint,
          publicationId,
          readerBuildId,
          voice,
          changed,
          clip,
          publicObjectBaseUrl,
        ))
        .sort((left, right) => compareText(
          left.checkpointId,
          right.checkpointId,
        ));
      const checkpoint = supporting[0];
      if (checkpoint === undefined) {
        diagnostics.push(diagnostic(
          "audio_publication.checkpoint.missing",
          "/checkpoints",
          "No validated checkpoint exactly supports the published clip and changed spoken text.",
          {
            audioVersionId: changed.audioVersionId,
            sectionId: changed.sectionId,
            voiceId: voice.id,
          },
        ));
        continue;
      }
      evidenceMatches.push({
        sectionId: changed.sectionId,
        audioVersionId: changed.audioVersionId,
        voiceId: voice.id,
        checkpointId: checkpoint.checkpointId,
      });
    }
  }

  if (diagnostics.length > 0) return invalid(diagnostics);
  evidenceMatches.sort((left, right) =>
    compareText(left.voiceId, right.voiceId) ||
    compareText(left.sectionId, right.sectionId) ||
    compareText(left.checkpointId, right.checkpointId)
  );
  return immutableSnapshot({
    valid: true,
    value: {
      publicationId,
      readerBuildId: readerBuildId as Sha256Digest,
      baseCatalogSha256,
      candidateCatalogSha256,
      changedSectionIds: [...changedSectionIds].sort(compareText),
      checkedVoiceIds: [
        ...new Set(candidateCatalog.voices.map(({ id }) => id)),
      ].sort(compareText),
      evidenceMatches,
    },
    diagnostics: [],
  });
}
