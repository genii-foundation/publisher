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
  validateAudioPublicationGuard,
} from "@genii-foundation/publisher-content";

const digest = (character) => `sha256:${character.repeat(64)}`;
const publicBase = "https://media.example.test/public/audio";
const readerBuildId = digest("a");
const spokenTextSha256 = digest("1");

const voiceDefinitions = Object.freeze([
  {
    id: "calm",
    label: "Calm",
    provider: "example-audio",
    model: "narrator-2",
    format: "opus",
    byteSize: 1_000,
    timingsByteSize: 250,
    durationSeconds: 12.5,
    audioDigest: "2",
    timingsDigest: "3",
  },
  {
    id: "bright",
    label: "Bright",
    provider: "example-audio",
    model: "narrator-1",
    format: "mp3",
    byteSize: 900,
    timingsByteSize: 225,
    durationSeconds: 11.75,
    audioDigest: "4",
    timingsDigest: "5",
  },
]);

function clip(voice, audioVersionId) {
  const objectKey =
    `audiobook/release/${voice.id}/${audioVersionId}.${voice.format}`;
  return {
    sectionId: "opening",
    audioVersionId,
    href: `${publicBase}/${objectKey}`,
    format: voice.format,
    byteSize: voice.byteSize,
    timingsByteSize: voice.timingsByteSize,
    durationSeconds: voice.durationSeconds,
  };
}

function catalog(audioVersionId) {
  return {
    $schema:
      "https://publisher.genii.foundation/schemas/audio-catalog.schema.json",
    version: 1,
    generatedAt:
      audioVersionId === "opening.new"
        ? "2026-08-19T02:00:00.000Z"
        : "2026-08-19T01:00:00.000Z",
    voices: voiceDefinitions.map((voice) => ({
      id: voice.id,
      label: voice.label,
      provider: voice.provider,
      model: voice.model,
      sections: [
        clip(voice, audioVersionId),
        {
          sectionId: "middle",
          audioVersionId: `middle.${voice.id}`,
          href: `${publicBase}/audiobook/release/${voice.id}/middle.${voice.id}.${voice.format}`,
          format: voice.format,
          byteSize: 800,
          timingsByteSize: 200,
          durationSeconds: 10,
        },
      ],
    })),
  };
}

function checkpoint(voice) {
  const audioVersionId = "opening.new";
  const audioObjectKey =
    `audiobook/release/${voice.id}/${audioVersionId}.${voice.format}`;
  const units = [
    {
      sectionId: "opening",
      audioVersionId,
      spokenTextSha256,
      durationSeconds: voice.durationSeconds,
      exactWordCount: 20,
      interpolatedWordCount: 1,
      timingSource: "whisper-large-v3-turbo",
      audioFormat: voice.format,
      audio: {
        objectKey: audioObjectKey,
        byteSize: voice.byteSize,
        sha256: digest(voice.audioDigest),
      },
      timings: {
        objectKey: audioObjectKey.replace(
          `.${voice.format}`,
          ".timings.json",
        ),
        byteSize: voice.timingsByteSize,
        sha256: digest(voice.timingsDigest),
      },
    },
  ];
  return {
    $schema:
      "https://publisher.genii.foundation/schemas/audio-checkpoint.schema.json",
    schemaVersion: "1.0",
    publicationId: "field-notes",
    checkpointId: `2026-08-19-${voice.id}`,
    source: {
      readerBuildId,
      sourceRevision: "de334bcde80eeba062d9ed152bd9507f15d4ce0d",
      catalogSha256: digest("b"),
      settingsSha256: digest("c"),
    },
    pipeline: {
      adapter: {
        package: "@example/narration-pipeline",
        version: "1.2.3",
      },
      runId: `release-${voice.id}`,
      provider: voice.provider,
      model: voice.model,
    },
    voice: {
      id: voice.id,
      label: voice.label,
    },
    recordedAt: "2026-08-19T01:50:00.000Z",
    remoteVerifiedAt: "2026-08-19T01:55:00.000Z",
    statistics: {
      unitCount: 1,
      objectCount: 2,
      durationSeconds: voice.durationSeconds,
      audioBytes: voice.byteSize,
      timingsBytes: voice.timingsByteSize,
    },
    unitsSha256: hashCanonicalJson(units),
    units,
  };
}

function guardInput(overrides = {}) {
  const baseCatalog = catalog("opening.old");
  const candidateCatalog = catalog("opening.new");
  return {
    publicationId: "field-notes",
    readerBuildId,
    baseCatalog,
    expectedBaseCatalogSha256: hashCanonicalJson(baseCatalog),
    candidateCatalog,
    expectedCandidateCatalogSha256: hashCanonicalJson(candidateCatalog),
    changedUnits: [
      {
        sectionId: "opening",
        audioVersionId: "opening.new",
        spokenTextSha256,
      },
    ],
    checkpoints: voiceDefinitions.map(checkpoint),
    publicObjectBaseUrl: publicBase,
    ...overrides,
  };
}

function codes(result) {
  return result.diagnostics.map(({ code }) => code);
}

function withCandidateMutation(mutate) {
  const input = guardInput();
  mutate(input.candidateCatalog);
  input.expectedCandidateCatalogSha256 = hashCanonicalJson(
    input.candidateCatalog,
  );
  return input;
}

test("the publication guard binds changed narration for every public voice", () => {
  const input = guardInput();
  const original = structuredClone(input);
  const result = validateAudioPublicationGuard(input);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.value.publicationId, "field-notes");
  assert.equal(result.value.readerBuildId, readerBuildId);
  assert.equal(
    result.value.baseCatalogSha256,
    input.expectedBaseCatalogSha256,
  );
  assert.equal(
    result.value.candidateCatalogSha256,
    input.expectedCandidateCatalogSha256,
  );
  assert.deepEqual(result.value.changedSectionIds, ["opening"]);
  assert.deepEqual(result.value.checkedVoiceIds, ["bright", "calm"]);
  assert.deepEqual(result.value.evidenceMatches, [
    {
      sectionId: "opening",
      audioVersionId: "opening.new",
      voiceId: "bright",
      checkpointId: "2026-08-19-bright",
    },
    {
      sectionId: "opening",
      audioVersionId: "opening.new",
      voiceId: "calm",
      checkpointId: "2026-08-19-calm",
    },
  ]);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.evidenceMatches), true);
  assert.deepEqual(input, original, "the guard must not mutate its inputs");
});

test("the publication guard allows a change set with no spoken changes", () => {
  const result = validateAudioPublicationGuard(guardInput({
    changedUnits: [],
    checkpoints: [],
  }));
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.value.changedSectionIds, []);
  assert.deepEqual(result.value.evidenceMatches, []);
});

test("the publication guard refuses missing and stale current clips", () => {
  const missing = validateAudioPublicationGuard(withCandidateMutation(
    (candidate) => {
      candidate.voices[0].sections = candidate.voices[0].sections.filter(
        ({ sectionId }) => sectionId !== "opening",
      );
    },
  ));
  assert.equal(missing.valid, false);
  assert.ok(codes(missing).includes("audio_publication.clip.match_count"));

  const stale = validateAudioPublicationGuard(withCandidateMutation(
    (candidate) => {
      candidate.voices[0].sections[0].audioVersionId = "opening.old";
    },
  ));
  assert.equal(stale.valid, false);
  assert.ok(codes(stale).includes("audio_publication.clip.stale"));
});

test("the publication guard refuses removing a published narrator", () => {
  const result = validateAudioPublicationGuard(withCandidateMutation(
    (candidate) => {
      candidate.voices = candidate.voices.filter(({ id }) => id !== "bright");
    },
  ));
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("audio_publication.voice.removed"));
});

test("the publication guard requires exact checkpoint evidence", () => {
  for (const input of [
    guardInput({ checkpoints: [] }),
    guardInput({ publicationId: "another-publication" }),
    guardInput({ readerBuildId: digest("f") }),
    withCandidateMutation((candidate) => {
      candidate.voices[0].sections[0].byteSize += 1;
    }),
    withCandidateMutation((candidate) => {
      candidate.voices[0].sections[0].href =
        "https://other.example.test/audiobook/release/calm/opening.new.opus";
    }),
  ]) {
    const result = validateAudioPublicationGuard(input);
    assert.equal(result.valid, false);
    assert.ok(
      codes(result).includes("audio_publication.checkpoint.missing"),
      JSON.stringify(result.diagnostics),
    );
  }
});

test("the publication guard rejects invalid checkpoints rather than ignoring them", () => {
  const invalidCheckpoint = checkpoint(voiceDefinitions[0]);
  invalidCheckpoint.units[0].spokenTextSha256 = digest("f");
  const result = validateAudioPublicationGuard(guardInput({
    checkpoints: [invalidCheckpoint, checkpoint(voiceDefinitions[1])],
  }));
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("audio_publication.checkpoint.invalid"));
  assert.ok(codes(result).includes("audio_publication.checkpoint.missing"));
});

test("the publication guard requires exact reviewed catalog hashes", () => {
  for (const override of [
    { expectedBaseCatalogSha256: digest("e") },
    { expectedCandidateCatalogSha256: digest("f") },
  ]) {
    const result = validateAudioPublicationGuard(guardInput(override));
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes("audio_publication.catalog_hash.mismatch"));
  }
});

test("the publication guard rejects duplicate and unsafe changed units", () => {
  const duplicate = guardInput().changedUnits[0];
  const result = validateAudioPublicationGuard(guardInput({
    changedUnits: [duplicate, { ...duplicate }],
  }));
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("audio_publication.changed_unit.duplicate"));

  const extra = validateAudioPublicationGuard(guardInput({
    changedUnits: [{ ...duplicate, title: "Opening" }],
  }));
  assert.equal(extra.valid, false);
  assert.ok(codes(extra).includes("audio_publication.changed_unit.properties"));
});

test("the publication guard fails closed on unsafe root inputs", () => {
  for (const input of [
    null,
    new Proxy({}, {
      get() {
        throw new Error("uninspectable");
      },
    }),
  ]) {
    const result = validateAudioPublicationGuard(input);
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes("audio_publication.input.uninspectable"));
  }

  const result = validateAudioPublicationGuard(guardInput({
    publicObjectBaseUrl: "http://media.example.test/public/audio",
  }));
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("audio_publication.public_base.invalid"));
});
