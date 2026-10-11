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

// Resolving a clip catalog against the publication it claims to narrate.
//
// The property this file exists to protect is what the engine does NOT do.
//
// `audioVersionId` is opaque. A working pipeline builds it by appending its own
// digest of the section text to the section identifier: sha256 over newline
// normalized body text, truncated to sixteen characters. The engine hashes
// compiled blocks and canonical JSON instead, because it hashes for different
// reasons, so the two never agree. An engine that derived this token itself would
// judge every clip in an existing catalog stale on its first run, and the remedy
// would be regenerating real narration. So staleness stays a pipeline decision and
// the opacity is asserted below rather than left as a comment.
//
// The other decision recorded here: a catalog is not a content source. The
// compiler refuses a source outside the resolved publication graph, correctly,
// and nothing in the reader artifact derives from narration. Discovering that took
// wiring it the wrong way first and reading the refusal.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAudioEnvelope,
  resolvePublicationAudio,
} from "../packages/publisher/dist/node.js";
import {
  buildFixturePublicationReader as buildPublicationReader,
} from "./extension-fixture.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const narratedFixture = join(repositoryRoot, "fixtures", "canonical-narrated-tides");
const silentFixture = join(repositoryRoot, "fixtures", "canonical-tide-tables");

/** The section identity the engine gives a single-manuscript work. */
const sectionId = "first-light-root";
const catalogPath = "publication/audio/catalog.json";

function clip(overrides = {}) {
  return {
    sectionId,
    audioVersionId: `${sectionId}-19f0907742968693`,
    href: `https://clips.example.test/${sectionId}.opus`,
    format: "opus",
    durationSeconds: 78.94,
    ...overrides,
  };
}

function catalogOf(voices) {
  return { version: 1, voices };
}

function resolveWith(voices, sectionIds = [sectionId]) {
  return resolvePublicationAudio({
    catalog: catalogOf(voices),
    declaredCatalogPath: catalogPath,
    sectionIds,
  });
}

function voice(id, clips) {
  return { id, label: id, sections: clips };
}

// ------------------------------------------------------------ end to end

test("a publication declaring narration resolves it through the build", async () => {
  const built = await buildPublicationReader({
    publicationRoot: narratedFixture,
    audience: "public",
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  const audio = built.value.audio?.resolved;
  assert.ok(audio, "the build resolved no audio for a publication that declares it");
  assert.equal(audio.declaredCatalogPath, catalogPath);
  assert.equal(audio.clipCount, 2);
  assert.equal(audio.sectionCount, 1);
  assert.deepEqual(
    audio.voices.map((entry) => entry.id),
    ["low-water", "spring-tide"],
    "voices must keep the order the catalog declared, which is the order a reader is offered them",
  );
});

test("both a hosted clip and a host-served clip resolve", async () => {
  // The fixture carries one of each on purpose. A catalog that only ever holds
  // absolute URLs would not exercise the root-relative branch of the schema, and
  // a publication serving its own audio is the case with no third party involved.
  const built = await buildPublicationReader({
    publicationRoot: narratedFixture,
    audience: "public",
  });
  assert.ok(built.valid);
  const hrefs = built.value.audio.resolved.voices.flatMap((entry) =>
    entry.clips.map((item) => item.href),
  );
  assert.equal(hrefs.filter((href) => href.startsWith("https://")).length, 1);
  assert.equal(hrefs.filter((href) => href.startsWith("/")).length, 1);
});

test("a clip without timings resolves, and says so by omission", async () => {
  // Presence of timingsByteSize is the only signal that a sidecar exists. A
  // partially timestamped catalog is a normal state and must not be refused.
  const built = await buildPublicationReader({
    publicationRoot: narratedFixture,
    audience: "public",
  });
  assert.ok(built.valid);
  const [withTimings, withoutTimings] = built.value.audio.resolved.voices;
  assert.equal(typeof withTimings.clips[0].timingsByteSize, "number");
  assert.equal(withoutTimings.clips[0].timingsByteSize, undefined);
});

test("a publication declaring no narration resolves none, rather than an empty one", async () => {
  // Absent and empty must not look alike. Empty would mean a catalog resolved to
  // nothing, which is a failure, and absent means there is no narration, which is
  // not.
  const built = await buildPublicationReader({
    publicationRoot: silentFixture,
    audience: "public",
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  assert.equal(built.value.audio, undefined);
  assert.equal("audio" in built.value, false);
});

test("the catalog stays out of content provenance", async () => {
  // Wiring it into the compiler's sources is what I did first, and the compiler
  // refused it by name: a source outside the resolved publication graph. It was
  // right. Nothing in the reader artifact derives from narration, so a catalog in
  // content provenance would claim a dependency that does not exist.
  const built = await buildPublicationReader({
    publicationRoot: narratedFixture,
    audience: "public",
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  const paths = built.value.content.sources.map((source) => source.path);
  assert.equal(
    paths.includes(catalogPath),
    false,
    `the catalog entered content provenance: ${paths.join(", ")}`,
  );
  assert.ok(paths.length > 0, "the source list is empty, so this proves nothing");
});

test("the reader artifact does not carry narration", async () => {
  // The corrected design decision, asserted against the artifact rather than
  // described in a document. Timing data and clip URLs stay out; what a reader
  // needs arrives from a separate catalog fetched on demand.
  const built = await buildPublicationReader({
    publicationRoot: narratedFixture,
    audience: "public",
  });
  assert.ok(built.valid);
  // The adapter name is included deliberately. It is recorded in the audio
  // envelope and must not reach the reader artifact, which is the boundary this
  // whole arrangement rests on. That coverage used to live on a fixture that
  // declared an adapter and had no narration, which was the wrong place for it.
  for (const marker of [
    "audioVersionId",
    "timingsByteSize",
    "clips.narrated-tides",
    "publisher-audio-clips",
  ]) {
    assert.equal(
      built.value.text.includes(marker),
      false,
      `the reader artifact carries ${marker}, which belongs in the audio catalog`,
    );
  }
});

// ------------------------------------------------------- opacity of the version

test("an audioVersionId unrelated to any engine hash still resolves", () => {
  // The load-bearing case. These tokens are the pipeline's, not the engine's, and
  // the engine must not require them to look like anything in particular.
  for (const audioVersionId of [
    `${sectionId}-19f0907742968693`,
    `${sectionId}-cb67687b407c68ae`,
    "an.opaque.token-99",
    sectionId,
  ]) {
    const result = resolveWith([voice("low-water", [clip({ audioVersionId })])]);
    assert.ok(
      result.valid,
      `${audioVersionId} was refused: ${JSON.stringify(result.diagnostics)}`,
    );
  }
});

// ------------------------------------------------------------- cross-checks

test("a clip for a section the publication does not contain is refused by name", () => {
  const result = resolveWith([
    voice("low-water", [clip({ sectionId: "a-section-that-was-renamed" })]),
  ]);
  assert.equal(result.valid, false);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "audio.clip.unknown_section");
  assert.match(diagnostic.message, /a-section-that-was-renamed/u);
  assert.equal(diagnostic.documentPath, catalogPath);
});

test("two recordings of one section by one voice are refused as ambiguous", () => {
  // Nothing in a catalog says which of two versions is current, so picking one
  // would be picking by iteration order.
  const result = resolveWith([
    voice("low-water", [
      clip({ audioVersionId: `${sectionId}-aaaaaaaaaaaaaaaa` }),
      clip({ audioVersionId: `${sectionId}-bbbbbbbbbbbbbbbb` }),
    ]),
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "audio.clip.ambiguous_version");
  assert.match(result.diagnostics[0].message, /which is current/u);
});

test("the same clip listed twice is refused", () => {
  const result = resolveWith([voice("low-water", [clip(), clip()])]);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "audio.clip.duplicate");
});

test("a voice declared twice is refused", () => {
  const result = resolveWith([
    voice("low-water", [clip()]),
    voice("low-water", [clip()]),
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "audio.voice.duplicate");
});

test("two voices may narrate the same section", () => {
  // The case the ambiguity check must not catch. One recording per voice per
  // section is the rule, not one recording per section.
  const result = resolveWith([
    voice("low-water", [clip()]),
    voice("spring-tide", [clip()]),
  ]);
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.value.clipCount, 2);
});

test("every problem is reported, not the first", () => {
  // A catalog is generated, so when it disagrees with the publication it usually
  // disagrees in bulk. Learning about one clip per run would be useless.
  const result = resolveWith([
    voice("low-water", [
      clip({ sectionId: "gone-one" }),
      clip({ sectionId: "gone-two" }),
      clip({ sectionId: "gone-three" }),
    ]),
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.length, 3);
  for (const diagnostic of result.diagnostics) {
    assert.equal(diagnostic.code, "audio.clip.unknown_section");
  }
});

// ------------------------------------------------------------- coverage

test("coverage is reported as data, not as a refusal", () => {
  // A publication part way through generating narration is normal. An engine that
  // refused to build until every section were narrated would make the first run
  // impossible.
  const result = resolveWith(
    [voice("low-water", [clip()])],
    [sectionId, "second-root", "third-root"],
  );
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.value.sectionCount, 3);
  assert.equal(result.value.voices[0].narratedSectionCount, 1);
  assert.equal(result.value.voices[0].unnarratedSectionCount, 2);
});

test("a catalog with no voices at all resolves", () => {
  const result = resolveWith([]);
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.value.clipCount, 0);
  assert.deepEqual(result.value.voices, []);
});

// ------------------------------------------------------------- the envelope

async function narratedEnvelope() {
  const built = await buildPublicationReader({
    publicationRoot: narratedFixture,
    audience: "public",
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  const catalogText = readFileSync(
    join(narratedFixture, catalogPath),
    "utf8",
  );
  // Produced by the build itself, not rebuilt here. A caller that re-read the
  // catalog to build the envelope could read a different file than the build
  // cross-checked, and the digest binding the two would certify the wrong thing.
  return { built, catalogText, envelope: built.value.audio };
}

test("the envelope carries the reader artifact's build identity verbatim", async () => {
  // The property the whole design turns on. Two artifacts of one build agree on
  // this, so a client holding two that disagree knows one is stale without having
  // to diff them. Recomputing it here would produce a second identity for one
  // build, which is worse than having none.
  const { built, envelope } = await narratedEnvelope();
  assert.equal(envelope.envelope.buildId, built.value.reader.buildId);
  assert.match(envelope.envelope.buildId, /^sha256:[0-9a-f]{64}$/u);
});

test("the envelope binds the exact catalog it came from", async () => {
  // A catalog is not a content source, so it does not reach the reader artifact's
  // identity. This digest is the only thing binding the two, and without it a
  // catalog could be swapped with nothing downstream noticing.
  const { catalogText, envelope } = await narratedEnvelope();
  assert.equal(
    envelope.envelope.source.catalogSha256,
    `sha256:${createHash("sha256").update(catalogText, "utf8").digest("hex")}`,
  );
  assert.equal(envelope.envelope.source.catalogPath, catalogPath);
});

test("the envelope is canonical, so a check can compare digests", async () => {
  const { envelope } = await narratedEnvelope();
  const keys = [...envelope.text.matchAll(/"(\$?[a-zA-Z]+)":/gu)].map(
    (match) => match[1],
  );
  const topLevel = keys.slice(0, 4);
  assert.deepEqual(
    topLevel,
    [...topLevel].sort(),
    `top-level keys are not sorted, so the text is not canonical: ${topLevel.join(", ")}`,
  );
  assert.ok(envelope.text.endsWith("\n"), "the artifact must end with a newline");
  // Rebuilding from the same inputs must produce the same bytes, or a check that
  // compares digests would report a stale artifact on every run.
  const again = await narratedEnvelope();
  assert.equal(again.envelope.text, envelope.text);
});

test("the envelope records coverage so a client need not hold the reader artifact", async () => {
  const { envelope } = await narratedEnvelope();
  assert.deepEqual(envelope.envelope.statistics, {
    voiceCount: 2,
    clipCount: 2,
    sectionCount: 1,
  });
});

test("the envelope calls them clips, and the catalog still calls them sections", async () => {
  // Deliberate divergence. The catalog keeps the name published pipelines already
  // emit so existing catalogs stay valid; the envelope is the engine's own
  // document and names them for what they are.
  const { catalogText, envelope } = await narratedEnvelope();
  assert.ok(JSON.parse(catalogText).voices[0].sections);
  const envelopeVoice = envelope.envelope.voices[0];
  assert.ok(envelopeVoice.clips);
  assert.equal(envelopeVoice.sections, undefined);
  assert.deepEqual(Object.keys(envelopeVoice).sort(), [
    "clips",
    "id",
    "label",
    "model",
    "narratedSectionCount",
    "provider",
    "unnarratedSectionCount",
  ]);
});

test("a build identity that is not a digest is refused", () => {
  // The envelope is the engine's own output, so a shape error here is the
  // engine's. Refusing it at the build beats serving it to a browser.
  const resolved = resolveWith([voice("low-water", [clip()])]);
  assert.ok(resolved.valid);
  const result = buildAudioEnvelope({
    audio: resolved.value,
    adapter: { package: "@example/clips" },
    publicationId: "narrated-tides",
    buildId: "not-a-digest",
    catalogText: "{}",
  });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].documentPath, catalogPath);
});

test("a missing adapter is a diagnostic, not an exception", () => {
  // This module returns diagnostics and never throws. A caller reaching in without
  // an adapter used to get a TypeError naming an internal field, which is how this
  // guard was found: a test failed for the wrong reason.
  const resolved = resolveWith([voice("low-water", [clip()])]);
  assert.ok(resolved.valid);
  const result = buildAudioEnvelope({
    audio: resolved.value,
    publicationId: "narrated-tides",
    buildId: `sha256:${"a".repeat(64)}`,
    catalogText: "{}",
  });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "audio.envelope.adapter_missing");
});

// ------------------------------------------------------------ the adapter

test("the declared adapter is recorded in the envelope", async () => {
  const { envelope } = await narratedEnvelope();
  const manifest = JSON.parse(
    readFileSync(join(narratedFixture, "publication.json"), "utf8"),
  );
  assert.equal(
    envelope.envelope.source.adapter.package,
    manifest.audio.adapter.package,
  );
});

test("the adapter is recorded, not resolved", async () => {
  // The load-bearing case, and the fixture is the proof: it names
  // @genii-foundation/publisher-audio-clips, which does not exist anywhere. The
  // schema requires an adapter, the renderer has no audio surface at all, and so
  // there is nothing for the engine to call. Recording it rather than resolving it
  // is the decision; a build failing here would mean somebody started executing
  // it.
  const manifest = JSON.parse(
    readFileSync(join(narratedFixture, "publication.json"), "utf8"),
  );
  const declared = manifest.audio.adapter.package;
  assert.equal(
    existsSync(join(repositoryRoot, "node_modules", ...declared.split("/"))),
    false,
    `${declared} is now installed, so this test no longer proves the adapter goes unresolved`,
  );
  const built = await buildPublicationReader({
    publicationRoot: narratedFixture,
    audience: "public",
  });
  assert.ok(
    built.valid,
    "naming an uninstallable adapter must not fail a build that never executes it",
  );
});

test("audio declared with no catalog is refused, and says why", async (t) => {
  // Before this, the combination produced no narration and reported nothing, so an
  // author who configured audio got silence with no explanation.
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-audio-nocatalog-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  cpSync(narratedFixture, root, { recursive: true });
  const manifestPath = join(root, "publication.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  delete manifest.audio.catalog;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const built = await buildPublicationReader({
    publicationRoot: root,
    audience: "public",
  });
  assert.equal(built.valid, false);
  const [diagnostic] = built.diagnostics;
  assert.equal(diagnostic.code, "build.audio_catalog_missing");
  assert.match(diagnostic.message, /never executed/u);
  assert.match(diagnostic.message, /Add audio\.catalog, or remove the audio block/u);
});

// -------------------------------------------------- the fixture is what it claims

test("the narrated fixture declares a catalog inside a declared source root", () => {
  // Source containment applies to a catalog like any other source. If the fixture
  // stopped declaring it, every end-to-end test above would silently become a
  // test of a publication with no audio.
  const manifest = JSON.parse(
    readFileSync(join(narratedFixture, "publication.json"), "utf8"),
  );
  assert.equal(manifest.audio.catalog, catalogPath);
  assert.ok(
    manifest.boundaries.sourceRoots.some((root) =>
      catalogPath.startsWith(`${root}/`),
    ),
    "the catalog is outside every declared source root",
  );
  assert.equal(
    resolve(narratedFixture, catalogPath).startsWith(narratedFixture),
    true,
  );
});
