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
  planAudioCheckpointPromotion,
} from "@genii-foundation/publisher-content";
import {
  validateAudioCatalogShape,
} from "@genii-foundation/publisher-schema";

const digest = (character) => `sha256:${character.repeat(64)}`;

function catalog() {
  return {
    $schema:
      "https://publisher.genii.foundation/schemas/audio-catalog.schema.json",
    version: 1,
    generatedAt: "2026-08-19T01:00:00.000Z",
    voices: [
      {
        id: "calm",
        label: "Calm",
        provider: "example-audio",
        model: "narrator-2",
        sections: [
          {
            sectionId: "opening",
            audioVersionId: "opening.old",
            href: "https://media.example.test/old/opening.old.opus",
            format: "opus",
            byteSize: 900,
            timingsByteSize: 200,
            durationSeconds: 11,
          },
          {
            sectionId: "middle",
            audioVersionId: "middle.unchanged",
            href: "https://media.example.test/old/middle.unchanged.opus",
            format: "opus",
            byteSize: 800,
            timingsByteSize: 190,
            durationSeconds: 10,
          },
          {
            sectionId: "returning",
            audioVersionId: "returning.old",
            href: "https://media.example.test/old/returning.old.mp3",
            format: "mp3",
            byteSize: 700,
            timingsByteSize: 170,
            durationSeconds: 8,
          },
        ],
      },
      {
        id: "bright",
        label: "Bright",
        provider: "example-audio",
        model: "narrator-1",
        sections: [
          {
            sectionId: "opening",
            audioVersionId: "opening.bright",
            href: "https://media.example.test/bright/opening.bright.opus",
          },
        ],
      },
    ],
  };
}

function checkpoint() {
  const units = [
    {
      sectionId: "opening",
      audioVersionId: "opening.new",
      spokenTextSha256: digest("1"),
      durationSeconds: 12.5,
      exactWordCount: 20,
      interpolatedWordCount: 1,
      timingSource: "whisper-large-v3-turbo",
      audioFormat: "opus",
      audio: {
        objectKey: "audiobook/release/calm/opening.new.opus",
        byteSize: 1_000,
        sha256: digest("2"),
      },
      timings: {
        objectKey: "audiobook/release/calm/opening.new.timings.json",
        byteSize: 250,
        sha256: digest("3"),
      },
    },
    {
      sectionId: "returning",
      audioVersionId: "returning.new",
      spokenTextSha256: digest("4"),
      durationSeconds: 8.25,
      exactWordCount: 12,
      interpolatedWordCount: 0,
      timingSource: "provider",
      audioFormat: "mp3",
      audio: {
        objectKey: "audiobook/release/calm/returning.new.mp3",
        byteSize: 750,
        sha256: digest("5"),
      },
      timings: {
        objectKey: "audiobook/release/calm/returning.new.timings.json",
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
    checkpointId: "2026-08-19-release-2",
    source: {
      readerBuildId: digest("a"),
      sourceRevision: "b23f8aa7aefc6d099f7404a276ba32cb0d3d7e17",
      catalogSha256: digest("b"),
      settingsSha256: digest("c"),
    },
    pipeline: {
      adapter: {
        package: "@example/narration-pipeline",
        version: "1.2.3",
      },
      runId: "release-2",
      provider: "example-audio",
      model: "narrator-2",
    },
    voice: {
      id: "calm",
      label: "Calm",
    },
    recordedAt: "2026-08-19T01:04:00.000Z",
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

function planInput(overrides = {}) {
  const baseCatalog = catalog();
  return {
    catalog: baseCatalog,
    checkpoint: checkpoint(),
    selectedSectionIds: ["returning", "opening"],
    publicObjectBaseUrl: "https://media.example.test/public/audio",
    expectedBaseCatalogSha256: hashCanonicalJson(baseCatalog),
    ...overrides,
  };
}

function diagnosticCodes(result) {
  return result.diagnostics.map(({ code }) => code);
}

test("selective audio promotion returns an exact-base immutable dry run", () => {
  const input = planInput();
  const original = structuredClone(input);
  const result = planAudioCheckpointPromotion(input);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));

  assert.equal(result.value.baseCatalogSha256, input.expectedBaseCatalogSha256);
  assert.equal(
    result.value.candidateCatalogSha256,
    hashCanonicalJson(result.value.candidateCatalog),
  );
  assert.equal(result.value.checkpointId, "2026-08-19-release-2");
  assert.equal(result.value.voiceId, "calm");
  assert.deepEqual(result.value.selectedSectionIds, ["opening", "returning"]);
  assert.equal(
    result.value.candidateCatalog.generatedAt,
    "2026-08-19T01:05:00.000Z",
  );

  const [calm, bright] = result.value.candidateCatalog.voices;
  assert.deepEqual(calm.sections[0], {
    sectionId: "opening",
    audioVersionId: "opening.new",
    href: "https://media.example.test/public/audio/audiobook/release/calm/opening.new.opus",
    format: "opus",
    byteSize: 1_000,
    timingsByteSize: 250,
    durationSeconds: 12.5,
  });
  assert.deepEqual(calm.sections[1], result.value.baseCatalog.voices[0].sections[1]);
  assert.strictEqual(calm.sections[1], result.value.baseCatalog.voices[0].sections[1]);
  assert.strictEqual(bright, result.value.baseCatalog.voices[1]);
  assert.equal(calm.sections[2].audioVersionId, "returning.new");
  assert.equal(validateAudioCatalogShape(result.value.candidateCatalog).valid, true);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.candidateCatalog), true);
  assert.deepEqual(input, original, "planning must not mutate caller input");
  assert.equal(Object.isFrozen(input.catalog), false);
});

test("selective audio promotion refuses a stale exact base", () => {
  const result = planAudioCheckpointPromotion(
    planInput({ expectedBaseCatalogSha256: digest("f") }),
  );
  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).includes("audio_promotion.base_hash.mismatch"));
});

test("selective audio promotion requires exact checkpoint coverage", () => {
  for (const selectedSectionIds of [
    ["opening"],
    ["opening", "returning", "middle"],
    ["opening", "opening", "returning"],
  ]) {
    const result = planAudioCheckpointPromotion(
      planInput({ selectedSectionIds }),
    );
    assert.equal(result.valid, false);
    assert.ok(
      diagnosticCodes(result).includes(
        selectedSectionIds[0] === selectedSectionIds[1]
          ? "audio_promotion.selection.duplicate"
          : "audio_promotion.selection.checkpoint_mismatch",
      ),
    );
  }
});

test("selective audio promotion requires one matching current clip", () => {
  const baseCatalog = catalog();
  baseCatalog.voices[0].sections = baseCatalog.voices[0].sections.filter(
    ({ sectionId }) => sectionId !== "returning",
  );
  const result = planAudioCheckpointPromotion(planInput({
    catalog: baseCatalog,
    expectedBaseCatalogSha256: hashCanonicalJson(baseCatalog),
  }));
  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).includes("audio_promotion.section.match_count"));
});

test("selective audio promotion binds voice metadata", () => {
  const baseCatalog = catalog();
  baseCatalog.voices[0].model = "narrator-3";
  const result = planAudioCheckpointPromotion(planInput({
    catalog: baseCatalog,
    expectedBaseCatalogSha256: hashCanonicalJson(baseCatalog),
  }));
  assert.equal(result.valid, false);
  assert.ok(
    diagnosticCodes(result).includes("audio_promotion.voice.identity_mismatch"),
  );
});

test("selective audio promotion refuses stale checkpoints and unsafe bases", () => {
  const staleCheckpoint = checkpoint();
  staleCheckpoint.recordedAt = "2026-08-18T00:00:00.000Z";
  staleCheckpoint.remoteVerifiedAt = "2026-08-18T00:01:00.000Z";
  const stale = planAudioCheckpointPromotion(planInput({
    checkpoint: staleCheckpoint,
  }));
  assert.equal(stale.valid, false);
  assert.ok(diagnosticCodes(stale).includes("audio_promotion.checkpoint.stale"));

  for (const publicObjectBaseUrl of [
    "http://media.example.test/audio",
    "https://user:secret@media.example.test/audio",
    "https://media.example.test/audio/",
    "https://media.example.test/audio?voice=calm",
  ]) {
    const result = planAudioCheckpointPromotion(planInput({ publicObjectBaseUrl }));
    assert.equal(result.valid, false);
    assert.ok(
      diagnosticCodes(result).includes("audio_promotion.public_base.invalid"),
      publicObjectBaseUrl,
    );
  }
});

test("selective audio promotion fails closed on unsafe plan inputs", () => {
  for (const input of [
    null,
    new Proxy({}, {
      get() {
        throw new Error("uninspectable");
      },
    }),
  ]) {
    const result = planAudioCheckpointPromotion(input);
    assert.equal(result.valid, false);
    assert.ok(
      diagnosticCodes(result).includes("audio_promotion.input.uninspectable"),
    );
  }

  const unsafeBase = planAudioCheckpointPromotion(planInput({
    publicObjectBaseUrl: 42,
  }));
  assert.equal(unsafeBase.valid, false);
  assert.ok(
    diagnosticCodes(unsafeBase).includes("audio_promotion.public_base.invalid"),
  );

  const unsafeHash = planAudioCheckpointPromotion(planInput({
    expectedBaseCatalogSha256: 42,
  }));
  assert.equal(unsafeHash.valid, false);
  assert.ok(
    diagnosticCodes(unsafeHash).includes("audio_promotion.base_hash.invalid"),
  );
});
