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
  createReaderNarrationPreferences,
  createReaderNarrationPreferencesStorageKey,
  createReaderNarrationSectionTextProfile,
  parseReaderNarrationEnvelope,
  parseReaderNarrationPreferences,
  parseReaderNarrationTimingDocument,
  readerNarrationTimingHref,
  readerNarrationTimingIndexForSeconds,
  serializeReaderNarrationPreferences,
} from "../packages/reader/dist/narration.js";

const buildId = `sha256:${"a".repeat(64)}`;
const catalogSha256 = `sha256:${"b".repeat(64)}`;
const identity = { publicationId: "narrated-tides", readerBuildId: buildId };

function envelope() {
  return {
    $schema: "https://publisher.genii.foundation/schemas/audio-envelope.schema.json",
    schemaVersion: "1.0",
    publicationId: "narrated-tides",
    engineVersion: "0.1.0-alpha.0",
    buildId,
    source: {
      adapter: {
        package: "@example/narrator",
        config: { voice: "calm", nested: [true, 2, null] },
      },
      catalogPath: "publication/audio/catalog.json",
      catalogSha256,
      generatedAt: "2026-08-19T00:00:00Z",
    },
    voices: [
      {
        id: "calm",
        label: "Calm",
        provider: "example",
        model: "steady-1",
        clips: [
          {
            sectionId: "opening",
            audioVersionId: "opening.abc123",
            href: "/audio/opening.mp3",
            format: "mp3",
            byteSize: 1234,
            timingsByteSize: 234,
            durationSeconds: 42.5,
          },
          {
            sectionId: "closing",
            audioVersionId: "closing.def456",
            href: "https://media.example.org/closing.opus",
            format: "opus",
            durationSeconds: 31,
          },
        ],
        narratedSectionCount: 2,
        unnarratedSectionCount: 1,
      },
    ],
    statistics: { voiceCount: 1, clipCount: 2, sectionCount: 3 },
  };
}

test("fetched narration is parsed into an immutable build bound projection", () => {
  const parsed = parseReaderNarrationEnvelope(JSON.stringify(envelope()), identity);
  assert.ok(parsed);
  assert.equal(parsed.voices[0].clips[0].durationSeconds, 42.5);
  assert.equal(parsed.statistics.clipCount, 2);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.voices), true);
  assert.equal(Object.isFrozen(parsed.voices[0].clips[0]), true);
});

test("narration refuses stale identity, unknown fields, and unsafe clip URLs", () => {
  assert.equal(parseReaderNarrationEnvelope(
    JSON.stringify({ ...envelope(), buildId: `sha256:${"c".repeat(64)}` }),
    identity,
  ), null);
  assert.equal(parseReaderNarrationEnvelope(
    JSON.stringify({ ...envelope(), surprise: true }),
    identity,
  ), null);
  const unsafe = envelope();
  unsafe.voices[0].clips[0].href = "javascript:alert(1)";
  assert.equal(parseReaderNarrationEnvelope(JSON.stringify(unsafe), identity), null);
  const repaired = envelope();
  repaired.voices[0].clips[0].href = "/audio/a recording.mp3";
  assert.equal(parseReaderNarrationEnvelope(JSON.stringify(repaired), identity), null);
  const nullConfig = envelope();
  nullConfig.source.adapter.config = null;
  assert.equal(parseReaderNarrationEnvelope(JSON.stringify(nullConfig), identity), null);
});

test("narration refuses duplicate coverage and statistics that drift", () => {
  const duplicate = envelope();
  duplicate.voices[0].clips.push({ ...duplicate.voices[0].clips[0] });
  duplicate.voices[0].narratedSectionCount = 3;
  duplicate.statistics.clipCount = 3;
  assert.equal(parseReaderNarrationEnvelope(JSON.stringify(duplicate), identity), null);

  const drifted = envelope();
  drifted.statistics.sectionCount = 4;
  assert.equal(parseReaderNarrationEnvelope(JSON.stringify(drifted), identity), null);
});

test("voice and speed preferences are bounded and deterministic", () => {
  const defaults = createReaderNarrationPreferences();
  assert.deepEqual(defaults, {
    schemaVersion: 1,
    selectedVoiceId: null,
    playbackRate: 1,
  });
  const chosen = {
    schemaVersion: 1,
    selectedVoiceId: "calm",
    playbackRate: 1.5,
  };
  assert.deepEqual(
    parseReaderNarrationPreferences(serializeReaderNarrationPreferences(chosen)),
    chosen,
  );
  assert.deepEqual(
    parseReaderNarrationPreferences(JSON.stringify({ ...chosen, playbackRate: 20 })),
    defaults,
  );
  assert.equal(
    createReaderNarrationPreferencesStorageKey("narrated-tides"),
    "genii.publisher.reader.narrated-tides.narration",
  );
});

test("section narration text and timing hrefs follow one closed profile", () => {
  const profile = createReaderNarrationSectionTextProfile({
    title: "  A Quiet Opening  ",
    blocks: [
      { kind: "heading", text: "  A Quiet Opening  " },
      { kind: "paragraph", text: " First   light. " },
      { kind: "paragraph", text: "Water returns." },
    ],
  });
  assert.deepEqual(profile, {
    text: "A Quiet Opening\n\nFirst light. Water returns.",
    textCharacters: 44,
    titleWordCount: 3,
    bodyWordCount: 4,
  });
  assert.equal(readerNarrationTimingHref({
    href: "/audio/opening.mp3",
    timingsByteSize: 234,
  }), "/audio/opening.timings.json");
  assert.equal(readerNarrationTimingHref({
    href: "https://media.example.org/opening.opus",
    timingsByteSize: 234,
  }), "https://media.example.org/opening.timings.json");
  assert.equal(readerNarrationTimingHref({
    href: "/audio/opening",
    timingsByteSize: 234,
  }), null);
});

function timingFixture(overrides = {}) {
  const text = "A Quiet Opening\n\nFirst light. Water returns.";
  const words = Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’·ˈ]*/gu))
    .map((match, index) => ({
      charStart: match.index,
      charEnd: match.index + match[0].length,
      startSeconds: index * 0.5,
      endSeconds: index * 0.5 + 0.4,
      match: "exact",
    }));
  return {
    version: 1,
    sectionId: "opening",
    audioVersionId: "opening.abc123",
    voiceId: "calm",
    textCharacters: text.length,
    durationSeconds: words.length * 0.5,
    exactWordCount: words.length,
    interpolatedWordCount: 0,
    words,
    ...overrides,
  };
}

function parseTiming(value, expected = {}) {
  const serialized = JSON.stringify(value);
  return parseReaderNarrationTimingDocument(serialized, {
    sectionId: "opening",
    audioVersionId: "opening.abc123",
    voiceId: "calm",
    textCharacters: 44,
    timingsByteSize: Buffer.byteLength(serialized),
    ...expected,
  });
}

test("timing sidecars are immutable, clip bound, and searchable by media time", () => {
  const parsed = parseTiming(timingFixture());
  assert.ok(parsed);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.words), true);
  assert.equal(Object.isFrozen(parsed.words[0]), true);
  assert.equal(readerNarrationTimingIndexForSeconds(parsed, 0.7), 1);
  assert.equal(readerNarrationTimingIndexForSeconds(parsed, 1.45), 2);
  assert.equal(readerNarrationTimingIndexForSeconds(parsed, Number.NaN), null);
});

test("timing sidecars refuse byte, identity, shape, and alignment drift", () => {
  assert.equal(parseTiming(timingFixture(), { timingsByteSize: 1 }), null);
  assert.equal(parseTiming(timingFixture({ voiceId: "bright" })), null);
  assert.equal(parseTiming(timingFixture({ surprise: true })), null);
  const badCharacters = timingFixture();
  badCharacters.words[0].charEnd = 1_000;
  assert.equal(parseTiming(badCharacters), null);
  const weakAlignment = timingFixture();
  weakAlignment.words = weakAlignment.words.map((word, index) => ({
    ...word,
    match: index < 4 ? "interpolated" : "exact",
  }));
  weakAlignment.exactWordCount = 3;
  weakAlignment.interpolatedWordCount = 4;
  assert.equal(parseTiming(weakAlignment), null);
});
