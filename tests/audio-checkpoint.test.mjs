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

import assert from "node:assert/strict";
import test from "node:test";

import {
  hashCanonicalJson,
  validateAudioCheckpoint,
} from "@genii-foundation/publisher-content";
import {
  validateAudioCheckpointShape,
} from "@genii-foundation/publisher-schema";

const digest = (character) => `sha256:${character.repeat(64)}`;

function checkpoint() {
  const units = [
    {
      sectionId: "opening",
      audioVersionId: "opening.abc123",
      spokenTextSha256: digest("1"),
      durationSeconds: 12.5,
      exactWordCount: 20,
      interpolatedWordCount: 1,
      timingSource: "whisper-large-v3-turbo",
      audioFormat: "opus",
      audio: {
        objectKey: "audiobook/checkpoint/calm/opening.abc123.opus",
        byteSize: 1_000,
        sha256: digest("2"),
      },
      timings: {
        objectKey: "audiobook/checkpoint/calm/opening.abc123.timings.json",
        byteSize: 250,
        sha256: digest("3"),
      },
    },
    {
      sectionId: "returning",
      audioVersionId: "returning.def456",
      spokenTextSha256: digest("4"),
      durationSeconds: 8.25,
      exactWordCount: 12,
      interpolatedWordCount: 0,
      timingSource: "provider",
      audioFormat: "mp3",
      audio: {
        objectKey: "audiobook/checkpoint/calm/returning.def456.mp3",
        byteSize: 750,
        sha256: digest("5"),
      },
      timings: {
        objectKey: "audiobook/checkpoint/calm/returning.def456.timings.json",
        byteSize: 180,
        sha256: digest("6"),
      },
    },
  ];
  return {
    $schema:
      "https://publisher.genii.foundation/schemas/audio-checkpoint.schema.json",
    schemaVersion: "1.0",
    publicationId: "field-notes",
    checkpointId: "2026-08-19-release-1",
    source: {
      readerBuildId: digest("a"),
      sourceRevision: "ec49b11639fa9978ad388d7ced3a153111af09e3",
      catalogSha256: digest("b"),
      settingsSha256: digest("c"),
    },
    pipeline: {
      adapter: {
        package: "@example/narration-pipeline",
        version: "1.2.3",
      },
      runId: "release-1",
      provider: "example-audio",
      model: "narrator-2",
    },
    voice: {
      id: "calm",
      label: "Calm",
      referenceId: "voice-reference-17",
    },
    recordedAt: "2026-08-19T01:00:00.000Z",
    remoteVerifiedAt: "2026-08-19T01:05:00.000Z",
    statistics: {
      unitCount: 2,
      objectCount: 4,
      durationSeconds: 20.75,
      audioBytes: 1_750,
      timingsBytes: 430,
    },
    unitsSha256: hashCanonicalJson(units),
    units,
  };
}

test("audio checkpoints bind immutable source, model, object, and timing evidence", () => {
  const value = checkpoint();
  const shape = validateAudioCheckpointShape(value);
  assert.equal(shape.valid, true, JSON.stringify(shape.diagnostics));
  const result = validateAudioCheckpoint(value);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.units), true);
  assert.equal(Object.isFrozen(result.value.units[0].audio), true);
  assert.equal(result.value.source.readerBuildId, digest("a"));
  assert.equal(result.value.pipeline.model, "narrator-2");
});

test("audio checkpoint shape rejects unknown or incomplete evidence", () => {
  const extra = { ...checkpoint(), surprise: true };
  assert.equal(validateAudioCheckpointShape(extra).valid, false);
  const missing = checkpoint();
  delete missing.units[0].spokenTextSha256;
  assert.equal(validateAudioCheckpointShape(missing).valid, false);
});

test("audio checkpoint semantics reject drift and unsafe alignment claims", () => {
  const cases = [
    (value) => { value.unitsSha256 = digest("f"); },
    (value) => { value.statistics.audioBytes = 1; },
    (value) => { value.units[0].timings.objectKey = "other.timings.json"; },
    (value) => {
      value.units[0].exactWordCount = 1;
      value.units[0].interpolatedWordCount = 20;
      value.unitsSha256 = hashCanonicalJson(value.units);
    },
    (value) => {
      value.units.reverse();
      value.unitsSha256 = hashCanonicalJson(value.units);
    },
    (value) => { value.remoteVerifiedAt = "2026-08-18T23:00:00.000Z"; },
    (value) => { value.recordedAt = "2026-08-19T01:00:00Z"; },
  ];
  for (const mutate of cases) {
    const value = checkpoint();
    mutate(value);
    assert.equal(validateAudioCheckpoint(value).valid, false);
  }
});
