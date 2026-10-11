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
  validateAudioCheckpointShape,
  type AudioCheckpoint,
  type Diagnostic,
  type JSONValue,
  type ValidationResult,
} from "@genii-foundation/publisher-schema";

import { hashCanonicalJson } from "./hashing.js";
import { immutableSnapshot } from "./immutability.js";

const MINIMUM_EXACT_TIMING_RATIO = 0.6;
const CANONICAL_UTC_TIMESTAMP =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/;

function diagnostic(
  code: string,
  path: string,
  message: string,
  params: Readonly<Record<string, unknown>> = {},
): Diagnostic {
  return Object.freeze({
    code,
    severity: "error",
    documentPath: "audio-checkpoint.json",
    path,
    message,
    keyword: "semantic",
    params: Object.freeze({ ...params }),
  });
}

function canonicalTimestamp(value: string): boolean {
  return CANONICAL_UTC_TIMESTAMP.test(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Validates immutable narration evidence without contacting its object store.
 * Remote existence and hashes are facts the author pipeline records before this
 * artifact is accepted. Promotion remains a separate, explicit operation.
 */
export function validateAudioCheckpoint(
  input: unknown,
): ValidationResult<AudioCheckpoint> {
  const shape = validateAudioCheckpointShape(input);
  if (!shape.valid) return shape;
  const checkpoint = shape.value;
  const diagnostics: Diagnostic[] = [];

  if (!canonicalTimestamp(checkpoint.recordedAt)) {
    diagnostics.push(diagnostic(
      "audio_checkpoint.recorded_at.noncanonical",
      "/recordedAt",
      "recordedAt must be a canonical UTC timestamp.",
    ));
  }
  if (!canonicalTimestamp(checkpoint.remoteVerifiedAt)) {
    diagnostics.push(diagnostic(
      "audio_checkpoint.remote_verified_at.noncanonical",
      "/remoteVerifiedAt",
      "remoteVerifiedAt must be a canonical UTC timestamp.",
    ));
  }
  if (checkpoint.remoteVerifiedAt < checkpoint.recordedAt) {
    diagnostics.push(diagnostic(
      "audio_checkpoint.remote_verification.precedes_recording",
      "/remoteVerifiedAt",
      "Remote verification cannot precede recording.",
    ));
  }

  const sectionIds = new Set<string>();
  const audioVersionIds = new Set<string>();
  let previousSectionId = "";
  for (const [index, unit] of checkpoint.units.entries()) {
    const path = `/units/${index}`;
    if (sectionIds.has(unit.sectionId)) {
      diagnostics.push(diagnostic(
        "audio_checkpoint.section.duplicate",
        `${path}/sectionId`,
        "Each section may appear only once in a voice checkpoint.",
        { sectionId: unit.sectionId },
      ));
    }
    sectionIds.add(unit.sectionId);
    if (audioVersionIds.has(unit.audioVersionId)) {
      diagnostics.push(diagnostic(
        "audio_checkpoint.audio_version.duplicate",
        `${path}/audioVersionId`,
        "Each audio version identity may appear only once in a checkpoint.",
        { audioVersionId: unit.audioVersionId },
      ));
    }
    audioVersionIds.add(unit.audioVersionId);
    if (index > 0 && compareText(previousSectionId, unit.sectionId) >= 0) {
      diagnostics.push(diagnostic(
        "audio_checkpoint.units.unsorted",
        `${path}/sectionId`,
        "Checkpoint units must be sorted by sectionId.",
      ));
    }
    previousSectionId = unit.sectionId;

    const audioSuffix = `.${unit.audioFormat}`;
    const expectedTimingsKey = unit.audio.objectKey.endsWith(audioSuffix)
      ? `${unit.audio.objectKey.slice(0, -audioSuffix.length)}.timings.json`
      : null;
    if (expectedTimingsKey === null) {
      diagnostics.push(diagnostic(
        "audio_checkpoint.audio.format_mismatch",
        `${path}/audio/objectKey`,
        "The audio object extension must match audioFormat.",
      ));
    } else if (unit.timings.objectKey !== expectedTimingsKey) {
      diagnostics.push(diagnostic(
        "audio_checkpoint.timings.object_mismatch",
        `${path}/timings/objectKey`,
        "The timing object must sit beside its audio object with the derived name.",
        { expected: expectedTimingsKey },
      ));
    }

    const wordCount = unit.exactWordCount + unit.interpolatedWordCount;
    if (unit.exactWordCount / wordCount < MINIMUM_EXACT_TIMING_RATIO) {
      diagnostics.push(diagnostic(
        "audio_checkpoint.timings.alignment_weak",
        `${path}/exactWordCount`,
        "At least 60 percent of checkpoint timing words must be exact.",
      ));
    }
  }

  const durationSeconds = checkpoint.units.reduce(
    (total, unit) => total + unit.durationSeconds,
    0,
  );
  const audioBytes = checkpoint.units.reduce(
    (total, unit) => total + unit.audio.byteSize,
    0,
  );
  const timingsBytes = checkpoint.units.reduce(
    (total, unit) => total + unit.timings.byteSize,
    0,
  );
  const expectedStatistics = {
    unitCount: checkpoint.units.length,
    objectCount: checkpoint.units.length * 2,
    durationSeconds,
    audioBytes,
    timingsBytes,
  };
  if (
    checkpoint.statistics.unitCount !== expectedStatistics.unitCount ||
    checkpoint.statistics.objectCount !== expectedStatistics.objectCount ||
    Math.abs(
      checkpoint.statistics.durationSeconds -
      expectedStatistics.durationSeconds,
    ) > 0.000001 ||
    checkpoint.statistics.audioBytes !== expectedStatistics.audioBytes ||
    checkpoint.statistics.timingsBytes !== expectedStatistics.timingsBytes
  ) {
    diagnostics.push(diagnostic(
      "audio_checkpoint.statistics.mismatch",
      "/statistics",
      "Checkpoint statistics must exactly summarize the recorded units.",
      expectedStatistics,
    ));
  }

  const unitsSha256 = hashCanonicalJson(
    checkpoint.units as unknown as JSONValue,
  );
  if (checkpoint.unitsSha256 !== unitsSha256) {
    diagnostics.push(diagnostic(
      "audio_checkpoint.units_hash.mismatch",
      "/unitsSha256",
      "unitsSha256 must bind the canonical checkpoint unit array.",
      { expected: unitsSha256 },
    ));
  }

  return diagnostics.length === 0
    ? immutableSnapshot({ valid: true, value: checkpoint, diagnostics: [] })
    : immutableSnapshot({ valid: false, diagnostics });
}
