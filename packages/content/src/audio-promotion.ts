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
  type AudioCheckpoint,
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

const CANONICAL_UTC_TIMESTAMP =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface AudioPromotionPlanInput {
  readonly catalog: unknown;
  readonly checkpoint: unknown;
  readonly selectedSectionIds: readonly string[];
  readonly publicObjectBaseUrl: string;
  readonly expectedBaseCatalogSha256: Sha256Digest;
}

export interface AudioPromotionPlan {
  readonly baseCatalogSha256: Sha256Digest;
  readonly candidateCatalogSha256: Sha256Digest;
  readonly checkpointId: string;
  readonly voiceId: string;
  readonly selectedSectionIds: readonly string[];
  readonly baseCatalog: AudioClipCatalog;
  readonly candidateCatalog: AudioClipCatalog;
}

interface CapturedAudioPromotionPlanInput {
  readonly catalog: unknown;
  readonly checkpoint: unknown;
  readonly selectedSectionIds: unknown;
  readonly publicObjectBaseUrl: unknown;
  readonly expectedBaseCatalogSha256: unknown;
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
    documentPath: "audio-promotion-plan.json",
    path,
    message,
    keyword: "semantic",
    params: Object.freeze({ ...params }),
  });
}

function invalid(diagnostics: readonly Diagnostic[]): ValidationResult<never> {
  return immutableSnapshot({ valid: false, diagnostics });
}

function captureInput(
  input: AudioPromotionPlanInput,
): CapturedAudioPromotionPlanInput | null {
  try {
    return {
      catalog: input.catalog,
      checkpoint: input.checkpoint,
      selectedSectionIds: input.selectedSectionIds,
      publicObjectBaseUrl: input.publicObjectBaseUrl,
      expectedBaseCatalogSha256: input.expectedBaseCatalogSha256,
    };
  } catch {
    return null;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function replacementClip(
  baseUrl: string,
  unit: AudioCheckpoint["units"][number],
): AudioClip {
  return {
    sectionId: unit.sectionId,
    audioVersionId: unit.audioVersionId,
    href: publicAudioObjectHref(baseUrl, unit.audio.objectKey),
    format: unit.audioFormat,
    byteSize: unit.audio.byteSize,
    timingsByteSize: unit.timings.byteSize,
    durationSeconds: unit.durationSeconds,
  };
}

/**
 * Plans one selective narration promotion from exact immutable evidence.
 *
 * This function has no storage, filesystem, clock, credential, or write
 * authority. A later author workflow may persist the candidate only after
 * independently proving that the exact base hash still names the live catalog.
 */
export function planAudioCheckpointPromotion(
  input: AudioPromotionPlanInput,
): ValidationResult<AudioPromotionPlan> {
  const captured = captureInput(input);
  if (captured === null) {
    return invalid([diagnostic(
      "audio_promotion.input.uninspectable",
      "",
      "The promotion input could not be inspected safely.",
    )]);
  }
  const catalogResult = validateAudioCatalogShape(captured.catalog);
  if (!catalogResult.valid) return catalogResult;
  const checkpointResult = validateAudioCheckpoint(captured.checkpoint);
  if (!checkpointResult.valid) return checkpointResult;

  const catalog = catalogResult.value;
  const checkpoint = checkpointResult.value;
  const diagnostics: Diagnostic[] = [];
  const baseCatalogSha256 = audioCatalogSha256(catalog);

  if (
    typeof captured.expectedBaseCatalogSha256 !== "string" ||
    !SHA256_DIGEST.test(captured.expectedBaseCatalogSha256)
  ) {
    diagnostics.push(diagnostic(
      "audio_promotion.base_hash.invalid",
      "/expectedBaseCatalogSha256",
      "The expected base catalog hash must be a lowercase SHA-256 digest.",
    ));
  } else if (captured.expectedBaseCatalogSha256 !== baseCatalogSha256) {
    diagnostics.push(diagnostic(
      "audio_promotion.base_hash.mismatch",
      "/expectedBaseCatalogSha256",
      "The catalog does not match the exact base selected for promotion.",
      {
        actual: baseCatalogSha256,
        expected: captured.expectedBaseCatalogSha256,
      },
    ));
  }

  const publicObjectBaseUrl =
    typeof captured.publicObjectBaseUrl === "string"
      ? captured.publicObjectBaseUrl
      : "";
  if (!isPublicAudioObjectBaseUrl(publicObjectBaseUrl)) {
    diagnostics.push(diagnostic(
      "audio_promotion.public_base.invalid",
      "/publicObjectBaseUrl",
      "The public object base must be a canonical HTTPS URL without credentials, query, fragment, or trailing slash.",
    ));
  }

  if (!Array.isArray(captured.selectedSectionIds)) {
    diagnostics.push(diagnostic(
      "audio_promotion.selection.invalid",
      "/selectedSectionIds",
      "selectedSectionIds must be an array.",
    ));
  }
  let selectedSectionIds: unknown[] = [];
  if (Array.isArray(captured.selectedSectionIds)) {
    try {
      selectedSectionIds = [...captured.selectedSectionIds];
    } catch {
      diagnostics.push(diagnostic(
        "audio_promotion.selection.uninspectable",
        "/selectedSectionIds",
        "The selected section identities could not be inspected safely.",
      ));
    }
  }
  const selectedSet = new Set<string>();
  for (const [index, sectionId] of selectedSectionIds.entries()) {
    if (typeof sectionId !== "string" || sectionId.length === 0) {
      diagnostics.push(diagnostic(
        "audio_promotion.selection.member_invalid",
        `/selectedSectionIds/${index}`,
        "Every selected section identity must be a nonempty string.",
      ));
      continue;
    }
    if (selectedSet.has(sectionId)) {
      diagnostics.push(diagnostic(
        "audio_promotion.selection.duplicate",
        `/selectedSectionIds/${index}`,
        "Each section may be selected only once.",
        { sectionId },
      ));
    }
    selectedSet.add(sectionId);
  }
  const normalizedSelectedSectionIds = [...selectedSet].sort(compareText);

  const checkpointSectionIds = checkpoint.units.map((unit) => unit.sectionId);
  if (
    normalizedSelectedSectionIds.length !== checkpointSectionIds.length ||
    normalizedSelectedSectionIds.some(
      (sectionId, index) => sectionId !== checkpointSectionIds[index],
    )
  ) {
    diagnostics.push(diagnostic(
      "audio_promotion.selection.checkpoint_mismatch",
      "/selectedSectionIds",
      "The selection must exactly cover every unit in the checkpoint and no others.",
      { checkpointSectionIds },
    ));
  }

  const matchingVoices = catalog.voices.filter(
    (voice) => voice.id === checkpoint.voice.id,
  );
  if (matchingVoices.length !== 1) {
    diagnostics.push(diagnostic(
      "audio_promotion.voice.match_count",
      "/catalog/voices",
      "The catalog must contain exactly one voice matching the checkpoint.",
      { actual: matchingVoices.length, voiceId: checkpoint.voice.id },
    ));
  }
  const voice = matchingVoices[0];
  if (
    voice !== undefined &&
    (
      voice.label !== checkpoint.voice.label ||
      voice.provider !== checkpoint.pipeline.provider ||
      voice.model !== checkpoint.pipeline.model
    )
  ) {
    diagnostics.push(diagnostic(
      "audio_promotion.voice.identity_mismatch",
      "/catalog/voices",
      "The catalog voice label, provider, and model must match the checkpoint.",
      { voiceId: checkpoint.voice.id },
    ));
  }

  if (voice !== undefined) {
    for (const sectionId of checkpointSectionIds) {
      const matches = voice.sections.filter(
        (clip) => clip.sectionId === sectionId,
      );
      if (matches.length !== 1) {
        diagnostics.push(diagnostic(
          "audio_promotion.section.match_count",
          "/catalog/voices",
          "Every selected section must identify exactly one current clip in the matching voice.",
          { actual: matches.length, sectionId, voiceId: voice.id },
        ));
      }
    }
  }

  if (
    catalog.generatedAt !== undefined &&
    !CANONICAL_UTC_TIMESTAMP.test(catalog.generatedAt)
  ) {
    diagnostics.push(diagnostic(
      "audio_promotion.catalog_time.noncanonical",
      "/catalog/generatedAt",
      "A catalog selected for promotion must use a canonical UTC generatedAt timestamp.",
    ));
  } else if (
    catalog.generatedAt !== undefined &&
    checkpoint.remoteVerifiedAt < catalog.generatedAt
  ) {
    diagnostics.push(diagnostic(
      "audio_promotion.checkpoint.stale",
      "/checkpoint/remoteVerifiedAt",
      "A checkpoint verified before the current catalog was generated cannot be promoted.",
      { catalogGeneratedAt: catalog.generatedAt },
    ));
  }

  if (diagnostics.length > 0 || voice === undefined) {
    return invalid(diagnostics);
  }

  const unitsBySectionId = new Map(
    checkpoint.units.map((unit) => [unit.sectionId, unit] as const),
  );
  const candidateCatalog: AudioClipCatalog = {
    ...(catalog.$schema === undefined ? {} : { $schema: catalog.$schema }),
    version: 1,
    generatedAt: checkpoint.remoteVerifiedAt,
    voices: catalog.voices.map((catalogVoice) =>
      catalogVoice === voice
        ? {
            ...catalogVoice,
            sections: catalogVoice.sections.map((clip) => {
              const unit = unitsBySectionId.get(clip.sectionId);
              return unit === undefined
                ? clip
                : replacementClip(publicObjectBaseUrl, unit);
            }),
          }
        : catalogVoice,
    ),
  };
  const candidateResult = validateAudioCatalogShape(candidateCatalog);
  if (!candidateResult.valid) return candidateResult;
  const candidateCatalogSha256 = audioCatalogSha256(candidateCatalog);

  return immutableSnapshot({
    valid: true,
    value: {
      baseCatalogSha256,
      candidateCatalogSha256,
      checkpointId: checkpoint.checkpointId,
      voiceId: checkpoint.voice.id,
      selectedSectionIds: normalizedSelectedSectionIds,
      baseCatalog: catalog,
      candidateCatalog,
    },
    diagnostics: [],
  });
}
