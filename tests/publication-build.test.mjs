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
  existsSync,
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
  compileMarkdownWork,
} from "../packages/content/dist/index.js";
import {
  compileLoadedPublicationContent,
} from "../packages/publisher/dist/node.js";
import {
  projectPublicationReader,
} from "../packages/reader/dist/index.js";
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

test("declared Markdown structure preserves durable hierarchy, routes, and continuity", async () => {
  const publicationRoot = join(fixtureRoot, "canonical-structured-essay");
  const first = await buildPublicationReader({
    publicationRoot,
    audience: "public",
  });
  const second = await buildPublicationReader({
    publicationRoot,
    audience: "public",
  });
  assert.ok(first.valid, diagnosticsText(first));
  assert.ok(second.valid, diagnosticsText(second));
  assert.equal(first.value.text, second.value.text);

  const work = first.value.content.works[0];
  assert.ok(work);
  assert.equal(work.source.adapter.id, "structured-markdown");
  assert.deepEqual(
    work.sections.map(({ id, parentId }) => ({ id, parentId })),
    [
      { id: "tidal-ledger-root", parentId: null },
      {
        id: "tidal-ledger-low-water",
        parentId: "tidal-ledger-root",
      },
      {
        id: "tidal-ledger-arithmetic",
        parentId: "tidal-ledger-root",
      },
    ],
  );
  assert.equal(work.sections[0].blocks.some(({ text }) => text === "Low water"), false);
  assert.equal(work.sections[1].blocks[0].text, "Low water");
  assert.equal(work.sections[2].blocks[0].text, "Arithmetic");
  assert.deepEqual(work.sections[0].childIds, [
    "tidal-ledger-low-water",
    "tidal-ledger-arithmetic",
  ]);
  assert.deepEqual(work.sections[1].continuity, {
    id: "tidal-ledger-low-water",
    legacyIds: ["tidal-ledger-ebb"],
    progressGroups: [["tidal-ledger-low-water", "tidal-ledger-ebb"]],
    historicalSectionIds: ["tidal-ledger-ebb"],
  });
  assert.deepEqual(
    first.value.reader.routes.active
      .filter(({ target }) => target.kind === "section")
      .map(({ path }) => path),
    ["/readings/low-water", "/readings/arithmetic"],
  );
});

test("a stale declared section boundary refuses the build and names the manuscript", async (t) => {
  const publicationRoot = scratchFixture(t, "canonical-structured-essay");
  const manifestPath = join(
    publicationRoot,
    "publication",
    "works",
    "tidal-ledger",
    "work.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.sections[1].start.text = "A heading that is not present";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const result = await buildPublicationReader({
    publicationRoot,
    audience: "public",
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code, documentPath }) =>
        code === "build.section_start_missing" &&
        documentPath?.endsWith("manuscript.md"),
    ),
    diagnosticsText(result),
  );
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

// ------------------------------------- a section can have its own URL

test("a section route becomes an active server route", async (t) => {
  // Pinned because I got this wrong twice in opposite directions. I first reported
  // that the build path collapses sections, which is true. I then "corrected" that
  // to a claim the route model cannot express a section URL at all, which is false,
  // on the strength of a probe that set routes and readerLocation but never
  // activeRouteNames. A section route only becomes an active server route if its
  // name appears in activeRouteNames, so the refusal I read as "there is no way to
  // make one active" actually meant "you did not make this one active".
  //
  // Coherence addresses 3,300 sections at their own paths. This test is the
  // evidence that the protocol already allows it, so the remaining work is in the
  // build path rather than in the route model.
  const publicationRoot = join(fixtureRoot, "canonical-tide-tables");
  const loaded = await loadPublicationCompilationSources({ publicationRoot });
  assert.ok(loaded.valid, diagnosticsText(loaded));
  const manuscript = loaded.value.sources.find(
    (source) => source.role === "manuscript",
  );
  assert.ok(manuscript);

  const whole = compileMarkdownWork({
    workId: "first-light",
    sectionId: "first-light-root",
    title: "First Light on the Mudflats",
    sourcePath: manuscript.path,
    markdown: manuscript.contents,
  });
  assert.ok(whole.valid, JSON.stringify(whole.diagnostics));
  const base = whole.value.work.sections[0];
  const blocks = base.blocks;
  const half = Math.ceil(blocks.length / 2);

  const content = compileLoadedPublicationContent({
    loaded: loaded.value,
    works: [
      {
        ...whole.value.work,
        sections: [
          {
            ...base,
            id: "first-light-root",
            blocks: blocks.slice(0, half),
            continuity: {
              id: "first-light-root",
              legacyIds: [],
              progressGroups: [["first-light-root"]],
              historicalSectionIds: [],
            },
          },
          {
            ...base,
            id: "low-water",
            title: "Low water",
            parentId: "first-light-root",
            blocks: blocks.slice(half),
            activeRouteNames: ["canonical"],
            routes: { canonical: { path: "/works/first-light/low-water" } },
            readerLocation: { kind: "route", routeName: "canonical" },
            navigable: true,
            continuity: {
              id: "low-water",
              legacyIds: [],
              progressGroups: [["low-water"]],
              historicalSectionIds: [],
            },
          },
        ],
      },
    ],
    extensions: [],
  });
  assert.ok(content.valid, diagnosticsText(content));

  const reader = projectPublicationReader(content.value, {
    audience: "public",
  });
  assert.ok(reader.valid, diagnosticsText(reader));

  const routed = reader.value.routes.active.find(
    (route) => route.path === "/works/first-light/low-water",
  );
  assert.ok(
    routed,
    `expected a section route, got ${reader.value.routes.active
      .map((route) => route.path)
      .join(" ")}`,
  );
  assert.equal(routed.target.kind, "section");
  assert.equal(routed.target.sectionId, "low-water");

  // And the work keeps its own address, so the two coexist rather than colliding.
  assert.ok(
    reader.value.routes.active.some(
      (route) =>
        route.path === "/works/first-light" && route.target.kind === "work",
    ),
  );
});

test("a section route without activeRouteNames is refused, and says why", async () => {
  // The exact mistake that misled me, kept so the refusal stays legible.
  const publicationRoot = join(fixtureRoot, "canonical-tide-tables");
  const loaded = await loadPublicationCompilationSources({ publicationRoot });
  const manuscript = loaded.value.sources.find(
    (source) => source.role === "manuscript",
  );
  const whole = compileMarkdownWork({
    workId: "first-light",
    sectionId: "first-light-root",
    title: "First Light on the Mudflats",
    sourcePath: manuscript.path,
    markdown: manuscript.contents,
  });
  const base = whole.value.work.sections[0];
  const half = Math.ceil(base.blocks.length / 2);

  const content = compileLoadedPublicationContent({
    loaded: loaded.value,
    works: [
      {
        ...whole.value.work,
        sections: [
          {
            ...base,
            blocks: base.blocks.slice(0, half),
            continuity: {
              id: "first-light-root",
              legacyIds: [],
              progressGroups: [["first-light-root"]],
              historicalSectionIds: [],
            },
          },
          {
            ...base,
            id: "low-water",
            title: "Low water",
            parentId: "first-light-root",
            blocks: base.blocks.slice(half),
            // activeRouteNames deliberately omitted.
            routes: { canonical: { path: "/works/first-light/low-water" } },
            readerLocation: { kind: "route", routeName: "canonical" },
            navigable: true,
            continuity: {
              id: "low-water",
              legacyIds: [],
              progressGroups: [["low-water"]],
              historicalSectionIds: [],
            },
          },
        ],
      },
    ],
    extensions: [],
  });
  assert.equal(content.valid, false);
  const codes = new Set(content.diagnostics.map((item) => item.code));
  assert.ok(
    codes.has("content.reader_address.base_route_unresolved"),
    [...codes].join(","),
  );
});

// -------------------------- what the guide says a manuscript becomes

test("a manuscript with headings compiles to one addressable unit", async () => {
  // The guide now tells authors this outright, because it surprises people and
  // nothing said it. Pinned so the guide and the engine cannot drift apart.
  const built = await buildPublicationReader({
    publicationRoot: join(fixtureRoot, "canonical-tide-tables"),
    audience: "public",
  });
  assert.ok(built.valid, diagnosticsText(built));
  const work = built.value.reader.works[0];

  assert.equal(work.sections.length, 1);
  assert.ok(
    work.sections[0].blocks.some((block) => block.kind === "heading"),
    "the fixture manuscript is supposed to contain a heading",
  );
  // The heading is content inside the one page, not a route of its own.
  assert.equal(
    built.value.reader.routes.active.filter(
      (route) => route.target.kind === "section",
    ).length,
    0,
  );
});

test("a block identifier is derived from that block's own content", async () => {
  // Measured rather than assumed, and it is the substance of the guide's warning:
  // renaming a heading breaks a link to it, while editing elsewhere does not. It is
  // also evidence for the open decision about declaring section boundaries, since
  // heading derived identity is already unstable here.
  const anchorFor = (markdown) => {
    const compiled = compileMarkdownWork({
      workId: "w",
      sectionId: "s",
      title: "T",
      sourcePath: "publication/works/w/manuscript.md",
      markdown,
    });
    assert.ok(compiled.valid, JSON.stringify(compiled.diagnostics));
    const heading = compiled.value.work.sections[0].blocks.find(
      (block) => block.kind === "heading",
    );
    assert.ok(heading, "expected a heading block");
    return heading.anchor;
  };

  const original = anchorFor("Intro.\n\n## Low water\n\nBody.\n");
  const retitled = anchorFor("Intro.\n\n## Low water at dawn\n\nBody.\n");
  const neighbourEdited = anchorFor("Intro, revised.\n\n## Low water\n\nBody.\n");

  assert.notEqual(
    retitled,
    original,
    "renaming a heading must change its identifier, which is why a link to it breaks",
  );
  assert.equal(
    neighbourEdited,
    original,
    "editing a neighbouring block must not move a heading's identifier",
  );
  // Derived, not a readable slug. An author expecting #low-water will not find it.
  assert.match(original, /^b-[0-9a-f]{64}$/u);
});

// ------------------ the migration audit's engine claims stay true

test("the audit's engine side claims match the schema and the code", async () => {
  // The migration audit is the document someone reads to decide how Updates and
  // section boundaries should work, so its numbers had better be right. Its counts
  // of the Coherence repository cannot be checked here, because nothing in this
  // repository may depend on that one existing, and they are dated to a revision in
  // the document instead. Everything it says about this engine is checkable, so it
  // is checked.
  const audit = readFileSync(
    join(repositoryRoot, "docs", "migration", "coherence-readiness.md"),
    "utf8",
  );
  const schema = JSON.parse(
    readFileSync(
      join(repositoryRoot, "schemas", "publication.schema.json"),
      "utf8",
    ),
  );

  // Caps the audit quotes when reasoning about whether Coherence fits.
  assert.equal(schema.properties.works.maxItems, 4999);
  assert.ok(
    audit.includes("4,999"),
    "the audit no longer quotes the works cap, so this check is idle",
  );
  assert.equal(
    schema.$defs.continuity.properties.redirects.maxItems,
    10000,
  );
  assert.ok(
    audit.includes("10,000"),
    "the audit no longer quotes the redirect cap, so this check is idle",
  );

  // Audio and sync were both reported here as schema definitions with nothing
  // behind them, and this block asserted that they stayed that way. They are being
  // implemented now, so the tripwire is replaced by checks of what the audit
  // currently claims. An audit nobody checks decays into folklore, and this one has
  // already been wrong three times.

  // The audit says audio has a contract now. A schema file that is not registered
  // with the validator build validates nothing while still looking present.
  const catalogSchemaPath = join(
    repositoryRoot,
    "schemas",
    "audio-catalog.schema.json",
  );
  assert.ok(
    existsSync(catalogSchemaPath),
    "the audit says the catalog has a contract and the schema file is missing",
  );
  assert.match(
    readFileSync(
      join(repositoryRoot, "schemas", "scripts", "build.mjs"),
      "utf8",
    ),
    /audioCatalogValidator/u,
    "the catalog schema is not compiled, so the audit overstates what exists",
  );

  // The correction this audit records: timing data does not enter the reader
  // artifact. Checking it against the envelope schema is what stops the decision
  // from being quietly reversed by whoever next needs word timings on a page.
  const readerEnvelope = JSON.parse(
    readFileSync(
      join(repositoryRoot, "schemas", "reader-envelope.schema.json"),
      "utf8",
    ),
  );
  assert.ok(
    audit.includes("does not belong in the reader artifact"),
    "the audit no longer records the timing decision, so this check is idle",
  );
  assert.equal(
    /\b(charStart|startSeconds|wordTimings|timings)\b/u.test(
      JSON.stringify(readerEnvelope),
    ),
    false,
    "per-word timing data has entered the reader envelope, reversing a recorded decision",
  );

  // The generic section identifier bound remains an engine contract. Historical
  // Coherence measurements belonged to the superseded audit and are deliberately
  // not kept alive as current migration claims.
  assert.equal(schema.$defs.stableId.maxLength, 128);
  assert.ok(
    audit.includes("7e50161cecc0ce6039c36e4738d8c9fc90710e62"),
    "the audit must name the exact Coherence ref its current measurements use",
  );
});
