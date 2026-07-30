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
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PORTABLE_REPOSITORY_CASE_FOLDING_VERSION,
  PORTABLE_REPOSITORY_NORMALIZATION_VERSION,
  PUBLICATION_PROTOCOL_LIMITS,
  isPathWithinRoot,
  isReservedHostIntegrationPath,
  normalizePortableRepositoryText,
  portableRepositoryPathIdentity,
  portableRepositorySegmentIdentity,
  resolvePublicationLayout,
  validatePublicationResourceLimits,
  validatePublicationSemantics,
  validatePublicationShape,
  validateRepositoryRelativePath,
  validateWorkShape,
} from "../schemas/dist/index.js";

const fixturePath = fileURLToPath(
  new URL(
    "../fixtures/canonical-field-notes/publication.json",
    import.meta.url,
  ),
);
const contentEnvelopeSchemaPath = fileURLToPath(
  new URL("../schemas/content-envelope.schema.json", import.meta.url),
);

async function fixturePublication() {
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

function diagnosticCodes(result) {
  return new Set(result.diagnostics.map(({ code }) => code));
}

test("repository paths use the versioned Unicode full default case-fold identity", () => {
  assert.equal(PORTABLE_REPOSITORY_CASE_FOLDING_VERSION, "15.1.0");
  assert.equal(
    portableRepositoryPathIdentity("Publication/Works/A.JSON"),
    "publication/works/a.json",
  );
  assert.equal(
    portableRepositoryPathIdentity("Werke/Straße.md"),
    portableRepositoryPathIdentity("WERKE/STRASSE.MD"),
  );
  for (const sigma of ["Σ", "σ", "ς"]) {
    assert.equal(
      portableRepositoryPathIdentity(`κείμενα/${sigma}.md`),
      "κείμενα/σ.md",
    );
  }
  assert.equal(
    portableRepositoryPathIdentity("Café.md"),
    portableRepositoryPathIdentity("Cafe\u0301.md"),
  );
  assert.equal(
    portableRepositorySegmentIdentity("WORK.JSON.  "),
    "work.json",
  );
  assert.equal(
    isPathWithinRoot(
      "Publication/Generated/catalog.json",
      "publication",
    ),
    true,
  );
  assert.equal(
    isReservedHostIntegrationPath("PUBLISHER.CONFIG.TS"),
    true,
  );
  assert.equal(
    isPathWithinRoot("出版/作品/第一章.md", "出版"),
    true,
  );
});

test("repository path normalization is pinned to Unicode 15.1 across supported Node majors", () => {
  assert.equal(PORTABLE_REPOSITORY_NORMALIZATION_VERSION, "15.1.0");
  assert.equal(
    normalizePortableRepositoryText("Cafe\u0301"),
    "Café",
  );
  assert.equal(
    normalizePortableRepositoryText("a\u0315\u0300"),
    "à\u0315",
  );
  assert.equal(normalizePortableRepositoryText("\u1100\u1161"), "가");
  assert.equal(
    normalizePortableRepositoryText("\u1100\u1161\u11a8"),
    "각",
  );

  // U+1ACF is unassigned in Unicode 15.1, but later host Unicode tables
  // assign it a combining class and reorder the following dot below.
  const unicodeVersionDrift = "q\u{1ACF}\u0323";
  const laterHostOrder = "q\u0323\u{1ACF}";
  assert.equal(
    normalizePortableRepositoryText(unicodeVersionDrift),
    unicodeVersionDrift,
  );
  assert.equal(
    portableRepositoryPathIdentity(unicodeVersionDrift),
    unicodeVersionDrift,
  );
  assert.equal(
    portableRepositoryPathIdentity(laterHostOrder),
    laterHostOrder,
  );
  assert.notEqual(
    portableRepositoryPathIdentity(unicodeVersionDrift),
    portableRepositoryPathIdentity(laterHostOrder),
  );
  assert.deepEqual(
    validateRepositoryRelativePath(
      `publication/${unicodeVersionDrift}.md`,
      "/path",
    ),
    [],
  );
});

test("repository paths accept NFC native-script names and reject malformed or decomposed Unicode", () => {
  for (const path of [
    "出版/作品/第一章.md",
    "लेख/अध्याय.md",
    "publication/\ufffd.json",
  ]) {
    assert.deepEqual(
      validateRepositoryRelativePath(path, "/path"),
      [],
      path,
    );
  }

  const decomposed = validateRepositoryRelativePath(
    "publication/Cafe\u0301.md",
    "/path",
  );
  assert.equal(
    decomposed.some(({ code }) => code === "path.not_nfc"),
    true,
  );

  for (const path of [
    "publication/\ud800.json",
    "publication/\udc00.json",
  ]) {
    const diagnostics = validateRepositoryRelativePath(path, "/path");
    assert.equal(
      diagnostics.some(
        ({ code }) => code === "path.invalid_unicode",
      ),
      true,
    );
    assert.equal(
      diagnostics.some(({ code }) => code === "path.not_nfc"),
      false,
    );
  }
});

test("repository paths enforce the 1,024 Unicode-scalar ceiling", () => {
  const atLimit = [
    "a".repeat(255),
    "b".repeat(255),
    "c".repeat(255),
    "d".repeat(254),
    "😀",
  ].join("/");
  assert.equal([...atLimit].length, 1_024);
  assert.deepEqual(
    validateRepositoryRelativePath(atLimit, "/path"),
    [],
  );

  const atLimitWork = validateWorkShape({
    schemaVersion: "1.0",
    id: "path-scalar-limit",
    title: "Path scalar limit",
    language: "en",
    publicationState: "draft",
    manuscript: atLimit,
  });
  assert.equal(
    atLimitWork.valid,
    true,
    JSON.stringify(atLimitWork.diagnostics),
  );

  const overLimit = `${atLimit}e`;
  assert.equal([...overLimit].length, 1_025);
  const pathDiagnostics = validateRepositoryRelativePath(
    overLimit,
    "/path",
  );
  assert.equal(
    pathDiagnostics.some(
      ({ code }) => code === "path.scalar_length",
    ),
    true,
  );

  const overLimitWork = validateWorkShape({
    schemaVersion: "1.0",
    id: "path-over-scalar-limit",
    title: "Path over scalar limit",
    language: "en",
    publicationState: "draft",
    manuscript: overLimit,
  });
  assert.equal(overLimitWork.valid, false);
  assert.equal(
    overLimitWork.diagnostics.some(
      ({ keyword, path }) =>
        keyword === "maxLength" && path === "/manuscript",
    ),
    true,
  );
});

test("repository paths reject explicit display controls while preserving orthographic joiners", () => {
  for (const path of [
    "اردو/می\u200cں.md",
    "देवनागरी/क्\u200dष.md",
  ]) {
    assert.deepEqual(
      validateRepositoryRelativePath(path, "/path"),
      [],
      path,
    );
  }

  for (const control of [
    "\u061c",
    "\u200e",
    "\u200f",
    "\u202a",
    "\u202b",
    "\u202c",
    "\u202d",
    "\u202e",
    "\u2066",
    "\u2067",
    "\u2068",
    "\u2069",
  ]) {
    const diagnostics = validateRepositoryRelativePath(
      `publication/a${control}b.md`,
      "/path",
    );
    assert.equal(
      diagnostics.some(({ code }) => code === "path.bidi_control"),
      true,
      `Expected U+${control.codePointAt(0).toString(16)} to fail.`,
    );
  }

  for (const separator of ["\u2028", "\u2029"]) {
    const diagnostics = validateRepositoryRelativePath(
      `publication/a${separator}b.md`,
      "/path",
    );
    assert.equal(
      diagnostics.some(
        ({ code }) => code === "path.unicode_line_separator",
      ),
      true,
    );
  }
});

test("publication, work, and content relative-path schemas admit native scripts without admitting display controls", async () => {
  const publication = await fixturePublication();
  publication.works[0].manifest = "出版/作品/第一章/work.json";
  publication.boundaries.sourceRoots = ["出版"];
  const publicationShape = validatePublicationShape(publication);
  assert.equal(
    publicationShape.valid,
    true,
    JSON.stringify(publicationShape.diagnostics),
  );

  const validWork = validateWorkShape({
    schemaVersion: "1.0",
    id: "first-reading",
    title: "第一章",
    language: "ja",
    publicationState: "draft",
    manuscript: "原稿/第一章.md",
  });
  assert.equal(validWork.valid, true, JSON.stringify(validWork.diagnostics));

  const invalidWork = validateWorkShape({
    schemaVersion: "1.0",
    id: "hidden-direction",
    title: "Hidden direction",
    language: "en",
    publicationState: "draft",
    manuscript: "draft/\u202ereversed.md",
  });
  assert.equal(invalidWork.valid, false);

  const contentEnvelopeSchema = JSON.parse(
    await readFile(contentEnvelopeSchemaPath, "utf8"),
  );
  const relativePathPattern = new RegExp(
    contentEnvelopeSchema.$defs.relativePath.pattern,
    "u",
  );
  assert.equal(relativePathPattern.test("出版/作品/第一章.md"), true);
  assert.equal(relativePathPattern.test("देवनागरी/क्\u200dष.md"), true);
  assert.equal(relativePathPattern.test("draft/\u202ereversed.md"), false);
  assert.equal(relativePathPattern.test("draft/\ud800.md"), false);
});

test("case variants cannot hide source-output overlap or duplicate manifest ownership", async () => {
  const overlap = await fixturePublication();
  overlap.boundaries.sourceRoots = ["Publication"];
  overlap.boundaries.outputRoots = [
    "publication/generated",
    ".publisher",
  ];
  const overlapResult = resolvePublicationLayout(overlap);
  assert.equal(overlapResult.valid, false);
  assert.equal(
    diagnosticCodes(overlapResult).has(
      "boundary.source_output_overlap",
    ),
    true,
  );

  const duplicate = await fixturePublication();
  duplicate.layout = {
    mode: "declared",
    overrides: {
      works: {
        root: "publication/works",
        manifestTemplate: "{workId}/work.json",
      },
    },
  };
  duplicate.works = [
    {
      id: "first",
      manifest: "publication/works/First/work.json",
    },
    {
      id: "second",
      manifest: "publication/works/first/WORK.JSON",
    },
  ];
  const duplicateResult = resolvePublicationLayout(duplicate);
  assert.equal(duplicateResult.valid, false);
  assert.equal(
    diagnosticCodes(duplicateResult).has(
      "layout.manifest_path_duplicate",
    ),
    true,
  );
});

test("manifest schemas and direct layout callers share finite resource limits", async () => {
  assert.equal(
    PUBLICATION_PROTOCOL_LIMITS.maximumCollectionWorkReferences,
    100_000,
  );
  const maximumRequiredTextSources =
    1 +
    PUBLICATION_PROTOCOL_LIMITS.maximumWorks * 2 +
    PUBLICATION_PROTOCOL_LIMITS.maximumCollections;
  assert.equal(maximumRequiredTextSources, 19_996);
  assert.ok(
    maximumRequiredTextSources <=
      PUBLICATION_PROTOCOL_LIMITS.maximumCompilationSources,
    "The maximum shape-valid catalog must fit the shared compilation-source ceiling.",
  );

  const publication = await fixturePublication();
  publication.works = Array.from(
    {
      length: PUBLICATION_PROTOCOL_LIMITS.maximumWorks + 1,
    },
    (_, index) => ({ id: `work-${index}` }),
  );

  const shape = validatePublicationShape(publication);
  assert.equal(shape.valid, false);
  assert.equal(
    shape.diagnostics.some(
      ({ keyword, path }) =>
        keyword === "maxItems" && path === "/works",
    ),
    true,
  );

  const resourceDiagnostics =
    validatePublicationResourceLimits(publication);
  assert.equal(
    resourceDiagnostics.some(
      ({ code, path }) =>
        code === "publication.resource_limit" &&
        path === "/works",
    ),
    true,
  );
  const layout = resolvePublicationLayout(publication);
  assert.equal(layout.valid, false);
  assert.equal(
    diagnosticCodes(layout).has("publication.resource_limit"),
    true,
  );
});

test("structural validation fails fast while semantic validation caps adversarial diagnostics", async () => {
  const publication = await fixturePublication();
  publication.works = Array.from(
    { length: 400 },
    () => ({}),
  );
  const shape = validatePublicationShape(publication);
  assert.equal(shape.valid, false);
  assert.equal(shape.diagnostics.length, 1);
  assert.equal(
    shape.diagnostics.some(
      ({ code }) => code === "schema.diagnostics_truncated",
    ),
    false,
  );

  publication.works = Array.from(
    { length: 400 },
    (_, index) => ({ id: `work-${index}` }),
  );
  publication.collections = [];
  const semantic = validatePublicationSemantics({
    publication,
    engineVersion: "1.0.0",
    workManifests: new Map(),
    collectionManifests: new Map(),
  });
  assert.equal(semantic.valid, false);
  assert.equal(semantic.diagnostics.length, 256);
  assert.equal(
    semantic.diagnostics.some(
      ({ code }) =>
        code === "validation.diagnostics_truncated",
    ),
    true,
  );
});

test("fail-fast structural diagnostics are independent of object insertion order", async () => {
  const entries = Array.from({ length: 400 }, (_, index) => [
    `unexpected_${String(index).padStart(3, "0")}`,
    index,
  ]);
  const validateWithEntries = async (orderedEntries) => {
    const publication = await fixturePublication();
    Object.assign(publication, Object.fromEntries(orderedEntries));
    return validatePublicationShape(publication);
  };

  const forward = await validateWithEntries(entries);
  const reverse = await validateWithEntries([...entries].reverse());
  assert.equal(forward.valid, false);
  assert.equal(reverse.valid, false);
  assert.equal(forward.diagnostics.length, 1);
  assert.deepEqual(forward.diagnostics, reverse.diagnostics);
  assert.equal(forward.diagnostics[0]?.path, "/unexpected_000");
});
