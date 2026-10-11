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

// The audio catalog schema, checked against the shape published catalogs are
// already in.
//
// This schema was written against a real published catalog of 551 clips rather
// than from the type declaration that described it, and the two disagreed. Four
// of that catalog's audioVersionId values exceeded the 128 character stableId
// bound, the longest reaching 159, because a pipeline composes that token by
// appending a digest to a section identifier. Reusing stableId for a derived
// token was the error; a separate bound is the fix, and the case below is the
// regression guard for it.
//
// The section identifier bound is deliberately NOT loosened the same way. A
// catalog must not be able to name a section the engine cannot hold, so the
// 128 character bound stays and a longer identifier is a migration item rather
// than a schema question. The refusal is pinned here so that nobody quietly
// relaxes it to make one publication import.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateAudioCatalogShape } from "../schemas/dist/schema-validation.js";
import { audioCatalogValidator } from "../schemas/dist/generated-validators.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaFileName = "audio-catalog.schema.json";
const schemaId =
  "https://publisher.genii.foundation/schemas/audio-catalog.schema.json";

/**
 * A catalog in the exact shape a publishing pipeline emits.
 *
 * Field names, and the choice to record only `timingsByteSize` rather than a
 * sidecar URL, come from a catalog already in production. Values here are
 * synthetic so that this repository does not depend on any particular
 * publication existing, but the lengths and composition are drawn from measured
 * ones.
 */
function publishedCatalog() {
  return {
    version: 1,
    generatedAt: "2026-07-25T18:13:00.000Z",
    voices: [
      {
        id: "high-quality-1",
        label: "High Quality 1",
        provider: "fish-audio",
        model: "s2.1-pro-free",
        sections: [
          {
            sectionId: "v01-orientation",
            audioVersionId: "v01-orientation-19f0907742968693",
            href: "https://clips.example.test/audiobook/v1/high-quality-1/v01-orientation-19f0907742968693.opus",
            format: "opus",
            byteSize: 2668193,
            durationSeconds: 78.94,
            timingsByteSize: 27943,
          },
        ],
      },
    ],
  };
}

/** The catalog with one clip whose fields are replaced. */
function withClip(overrides) {
  const catalog = publishedCatalog();
  return {
    ...catalog,
    voices: [
      {
        ...catalog.voices[0],
        sections: [{ ...catalog.voices[0].sections[0], ...overrides }],
      },
    ],
  };
}

test("a catalog in the published shape validates", () => {
  const result = validateAudioCatalogShape(publishedCatalog());
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
});

test("the precompiled validator is registered, not only the schema file", () => {
  // A schema that is not in the build script's validator list compiles nowhere
  // and validates nothing, while still looking present in the repository.
  assert.equal(typeof audioCatalogValidator, "function");
  const buildScript = readFileSync(
    join(repositoryRoot, "schemas", "scripts", "build.mjs"),
    "utf8",
  );
  assert.match(
    buildScript,
    /audioCatalogValidator/u,
    "the schema is not registered with the standalone validator build",
  );
  assert.match(buildScript, new RegExp(schemaFileName.replace(".", "\\."), "u"));
});

test("the schema file is exported, so its $id can be fetched by consumers", () => {
  // The $id is a promise that a published package points somewhere real. An
  // unexported schema file makes that promise unkeepable from an install.
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, "schemas", "package.json"), "utf8"),
  );
  assert.equal(
    manifest.exports[`./${schemaFileName}`],
    `./${schemaFileName}`,
    "the schema is not reachable from an installed package",
  );
  const schema = JSON.parse(
    readFileSync(join(repositoryRoot, "schemas", schemaFileName), "utf8"),
  );
  assert.equal(schema.$id, schemaId);
});

/**
 * A valid stableId of an exact length, built from heading-shaped words.
 *
 * Exact length matters because the property under test is a boundary, and my
 * first attempt at this fixture silently produced an 86 character token while
 * claiming to test one past 128. The length assertions below are what caught it.
 */
function stableIdOfLength(length) {
  const words =
    "that-heart-rate-variability-indexes-a-regulated-nervous-system-and-tracks-emotional-and-cognitive-self-regulation".split(
      "-",
    );
  let id = "v03-ii";
  for (const word of words) {
    if (id.length + 1 + word.length > length) {
      break;
    }
    id = `${id}-${word}`;
  }
  // Pad the trailing segment, which keeps it a single alphanumeric run.
  return id.length < length ? `${id}${"x".repeat(length - id.length)}` : id;
}

test("an audioVersionId longer than a stableId is accepted", () => {
  // Measured, not hypothetical: four clips in a 551 clip production catalog
  // exceeded 128 characters here, because the token is a section identifier with
  // a digest appended. Refusing them would refuse a catalog that already exists.
  // A 120 character section identifier plus a hyphen and a 16 character digest
  // reaches 137, which is the length actually observed.
  const sectionId = stableIdOfLength(120);
  const audioVersionId = `${sectionId}-cb67687b407c68ae`;
  assert.equal(sectionId.length, 120);
  assert.equal(audioVersionId.length, 137);
  assert.ok(
    sectionId.length <= 128,
    `the section identifier must stay inside the stableId bound, got ${sectionId.length}`,
  );
  assert.ok(
    audioVersionId.length > 128,
    `this case is pointless unless the composed token exceeds 128, got ${audioVersionId.length}`,
  );
  const result = validateAudioCatalogShape(
    withClip({ sectionId, audioVersionId }),
  );
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
});

test("a section identifier past the stableId bound is refused by path", () => {
  // Pins the migration constraint. One identifier in a measured publication
  // reached 142 characters, and because a section identifier reaches a public
  // URL, silently truncating or accepting it is worse than refusing it.
  const result = validateAudioCatalogShape(
    withClip({ sectionId: `v03-${"a".repeat(140)}` }),
  );
  assert.equal(result.valid, false);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "schema.max_length");
  assert.match(
    diagnostic.path,
    /sectionId$/u,
    `the diagnostic must name the offending field, got ${diagnostic.path}`,
  );
});

test("an audioVersionId past its own bound is still refused", () => {
  const result = validateAudioCatalogShape(
    withClip({ audioVersionId: `v01-${"a".repeat(300)}` }),
  );
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "schema.max_length");
});

/**
 * Inputs the schema must refuse, each with the reason refusing it matters.
 *
 * Without these the schema could be vacuously permissive and every acceptance
 * test above would still pass.
 */
const refusals = Object.freeze([
  [
    "plain http clip",
    { href: "http://clips.example.test/a.opus" },
    "mixed content fails silently on an https page",
  ],
  [
    "protocol-relative clip",
    { href: "//clips.example.test/a.opus" },
    "a protocol-relative href inherits whatever scheme the page had",
  ],
  [
    "traversal in a host-served clip",
    { href: "/audio/../../etc/passwd" },
    "a clip path must not escape the directory the host serves",
  ],
  [
    "host-served clip ending in a slash",
    { href: "/audio/" },
    "a directory is not a clip",
  ],
  [
    "unknown clip field",
    { timingsHref: "/audio/a.timings.json" },
    "carrying a sidecar URL per clip is the size mistake the schema exists to prevent",
  ],
  [
    "uppercase section identifier",
    { sectionId: "V01-Orientation" },
    "identifiers reach case-insensitive filesystems and URLs",
  ],
  [
    "zero duration",
    { durationSeconds: 0 },
    "a clip of no length is a failed generation, not a clip",
  ],
  [
    "negative duration",
    { durationSeconds: -1 },
    "a negative duration would compute a negative playback position",
  ],
  [
    "unknown container",
    { format: "flac" },
    "advertising a codec no pipeline emits claims untested support",
  ],
]);

for (const [name, overrides, why] of refusals) {
  test(`the schema refuses ${name}`, () => {
    const result = validateAudioCatalogShape(withClip(overrides));
    assert.equal(result.valid, false, why);
  });
}

test("a clip missing its href is refused", () => {
  const catalog = publishedCatalog();
  delete catalog.voices[0].sections[0].href;
  assert.equal(validateAudioCatalogShape(catalog).valid, false);
});

test("a catalog of the wrong contract version is refused", () => {
  assert.equal(
    validateAudioCatalogShape({ ...publishedCatalog(), version: 2 }).valid,
    false,
    "a future catalog contract must not be read as though it were this one",
  );
});

test("an unknown top-level field is refused", () => {
  assert.equal(
    validateAudioCatalogShape({ ...publishedCatalog(), buildId: "sha256:0" })
      .valid,
    false,
    "build identity belongs to the engine's audio envelope, not to a source catalog",
  );
});

test("a catalog with no voices is accepted", () => {
  // A publication part way through generating narration is a legitimate state.
  // Judging it belongs in semantic validation, where the diagnostic can say what
  // is missing, rather than in a structural refusal.
  const result = validateAudioCatalogShape({ version: 1, voices: [] });
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
});
