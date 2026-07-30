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

// The whole pipeline, over both fixture publications.
//
// The loader, compiler, and projector each had their own tests. Nothing tested
// them joined, which is why the join was where the mistakes were: an invented
// manifest field, an invented section identity convention, and a build order that
// could not compile.
//
// Both fixtures matter. One uses the canonical layout, the other declares its own,
// and a pipeline that only works on the canonical one would pass a portability
// claim it has not earned.

import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildPublicationReader,
  derivePublicationWorkInputs,
  rootSectionIdFor,
} from "../packages/publisher/dist/node.js";
import {
  loadPublicationCompilationSources,
} from "../packages/publisher/dist/node/loader.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureRoot = join(repositoryRoot, "fixtures");

const fixtures = Object.freeze([
  { name: "canonical-field-notes", layout: "canonical" },
  { name: "declared-night-dispatch", layout: "declared" },
]);

function diagnosticsText(result) {
  return JSON.stringify(result.diagnostics, null, 2);
}

/** Copies a fixture so a test can damage it without touching the original. */
function scratchFixture(t, name) {
  const root = mkdtempSync(join(tmpdir(), "publisher-build-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const destination = join(root, name);
  cpSync(join(fixtureRoot, name), destination, { recursive: true });
  return destination;
}

// --------------------------------------------------------- happy path

for (const fixture of fixtures) {
  test(`${fixture.name} builds a valid reader artifact`, async () => {
    const result = await buildPublicationReader({
      publicationRoot: join(fixtureRoot, fixture.name),
      audience: "public",
    });
    assert.ok(result.valid, diagnosticsText(result));

    const { reader, content, text } = result.value;
    assert.equal(reader.artifact.mediaType.includes("reader+json"), true);
    assert.ok(reader.works.length > 0, "expected at least one work");
    assert.ok(
      reader.routes.active.length > 0,
      "expected at least one active route",
    );

    // Serialization is canonical JSON with a trailing newline, so the text is
    // byte-comparable across runs and can be committed and diffed.
    assert.equal(text.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(reader)));

    // The source roots the manifest declares survive the whole pipeline. A build
    // that quietly normalized them to the canonical layout would break every
    // adopted repository, so this compares against the manifest on disk rather
    // than against a constant in this file.
    const manifest = JSON.parse(
      readFileSync(
        join(fixtureRoot, fixture.name, "publication.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      [...content.sourceAuthority.sourceRoots],
      [...manifest.boundaries.sourceRoots],
    );
    assert.equal(manifest.layout.mode, fixture.layout);
  });

  test(`${fixture.name} builds deterministically`, async () => {
    const first = await buildPublicationReader({
      publicationRoot: join(fixtureRoot, fixture.name),
      audience: "public",
    });
    const second = await buildPublicationReader({
      publicationRoot: join(fixtureRoot, fixture.name),
      audience: "public",
    });
    assert.ok(first.valid, diagnosticsText(first));
    assert.ok(second.valid, diagnosticsText(second));
    // Byte equality, not deep equality. A build whose output shifts between runs
    // cannot be committed, cached, or verified against a published artifact.
    assert.equal(first.value.text, second.value.text);
  });
}

test("every work reaches the artifact with its declared route", async () => {
  const publicationRoot = join(fixtureRoot, "canonical-field-notes");
  const loaded = await loadPublicationCompilationSources({
    publicationRoot,
  });
  assert.ok(loaded.valid, diagnosticsText(loaded));

  const built = await buildPublicationReader({
    publicationRoot,
    audience: "public",
  });
  assert.ok(built.valid, diagnosticsText(built));

  const declared = loaded.value.sourceGraph.works;
  assert.equal(built.value.reader.works.length, declared.length);

  for (const work of declared) {
    const projected = built.value.reader.works.find(
      (entry) => entry.id === work.workId,
    );
    assert.ok(projected, `work ${work.workId} is missing from the artifact`);
    if (typeof work.manifest.route === "string") {
      const routed = built.value.reader.routes.active.some(
        (route) => route.path === work.manifest.route,
      );
      assert.ok(
        routed,
        `work ${work.workId} declares route ${work.manifest.route} but the artifact has no such route`,
      );
    }
  }
});

test("the section identity is derived from the work and is not a route", async () => {
  const built = await buildPublicationReader({
    publicationRoot: join(fixtureRoot, "canonical-field-notes"),
    audience: "public",
  });
  assert.ok(built.valid, diagnosticsText(built));

  for (const work of built.value.reader.works) {
    const expected = rootSectionIdFor(work.id);
    assert.ok(
      work.sections.some((section) => section.id === expected),
      `work ${work.id} has no section ${expected}`,
    );
    // The identity is internal. If it ever appears in a route path, changing it
    // becomes a breaking URL change, so this asserts the separation directly.
    for (const route of built.value.reader.routes.active) {
      assert.equal(
        route.path.includes(expected),
        false,
        `route ${route.path} embeds the internal section identity ${expected}`,
      );
    }
  }
});

// ----------------------------------------------------------- failures

test("a work whose manuscript is missing is named, not asserted away", async (t) => {
  const publicationRoot = scratchFixture(t, "canonical-field-notes");
  rmSync(
    join(publicationRoot, "publication", "works", "rain-gauge", "manuscript.md"),
    { force: true },
  );

  const result = await buildPublicationReader({
    publicationRoot,
    audience: "public",
  });
  assert.equal(result.valid, false);
  const codes = result.diagnostics.map((item) => item.code);
  assert.ok(
    codes.length > 0,
    "a missing manuscript must produce at least one diagnostic",
  );
  // Whichever layer catches it, the failure has to name the file an author would
  // open. A diagnostic with no document path sends them hunting.
  const named = result.diagnostics.some(
    (item) =>
      (item.documentPath ?? "").includes("manuscript.md") ||
      item.message.includes("manuscript"),
  );
  assert.ok(named, diagnosticsText(result));
});

test("a manuscript that is not valid UTF-8 is refused by name", async (t) => {
  const publicationRoot = scratchFixture(t, "canonical-field-notes");
  // Raw bytes, not a JavaScript string. Writing "\uD800" through writeFileSync
  // with the utf8 encoding substitutes the replacement character, so the file
  // would be perfectly valid and the test would prove nothing. It did, once.
  writeFileSync(
    join(publicationRoot, "publication", "works", "rain-gauge", "manuscript.md"),
    Buffer.from([0x23, 0x20, 0xed, 0xa0, 0x80, 0x0a]),
  );

  const result = await buildPublicationReader({
    publicationRoot,
    audience: "public",
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      (item) => item.code === "loader.source.utf8_invalid",
    ),
    diagnosticsText(result),
  );
});

test("derivation reports every broken work rather than the first", async (t) => {
  const publicationRoot = scratchFixture(t, "declared-night-dispatch");
  const loaded = await loadPublicationCompilationSources({
    publicationRoot,
  });
  assert.ok(loaded.valid, diagnosticsText(loaded));

  // Strip every manuscript from the loaded snapshot. Each work then has nothing
  // to compile, and an author should learn about all of them at once.
  const stripped = {
    ...loaded.value,
    sources: loaded.value.sources.filter(
      ({ role }) => role !== "manuscript",
    ),
  };
  Object.setPrototypeOf(stripped, Object.getPrototypeOf(loaded.value));
  for (const key of Object.getOwnPropertySymbols(loaded.value)) {
    stripped[key] = loaded.value[key];
  }

  const derived = derivePublicationWorkInputs(stripped);
  assert.equal(derived.valid, false);
  assert.equal(
    derived.diagnostics.length,
    loaded.value.sourceGraph.works.length,
    `expected one diagnostic per work, got ${diagnosticsText(derived)}`,
  );
  for (const item of derived.diagnostics) {
    assert.equal(item.code, "build.manuscript_missing");
    assert.equal(typeof item.documentPath, "string");
  }
});

test("an unreadable publication root fails without throwing", async () => {
  const result = await buildPublicationReader({
    publicationRoot: join(tmpdir(), "publisher-build-does-not-exist"),
    audience: "public",
  });
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.length > 0);
});
