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

import contentEnvelopeSchema from "../schemas/content-envelope.schema.json" with {
  type: "json",
};
import {
  CONTENT_ARTIFACT_MEDIA_TYPE,
  CONTENT_ARTIFACT_RELATIVE_PATH,
  CONTENT_ENVELOPE_SCHEMA_URL,
  CONTENT_SCHEMA_VERSION,
  validateContentEnvelopeShape,
} from "../schemas/dist/index.js";

const DIGEST = `sha256:${"0".repeat(64)}`;
const COHERENCE_STYLE_CONTENT_ID =
  "after-the-frontier-why-coherence-must-become-collective-practice-before-civilization-can-reliably-cross-from-fragmentation-into-shared-meaning";

function createMinimalEnvelope() {
  const envelope = {
    $schema: CONTENT_ENVELOPE_SCHEMA_URL,
    schemaVersion: CONTENT_SCHEMA_VERSION,
    publicationId: "field-notes",
    engineVersion: "1.0.0",
    compilerVersion: "0.1.0-alpha.0",
    buildId: DIGEST,
    artifact: {
      kind: "publication-content",
      mediaType: CONTENT_ARTIFACT_MEDIA_TYPE,
      outputRoot: ".publisher",
      relativePath: CONTENT_ARTIFACT_RELATIVE_PATH,
    },
    hashes: {
      sourceSet: DIGEST,
      content: DIGEST,
    },
    publication: {
      id: "field-notes",
      title: "Field Notes",
      language: "en",
      publisher: {
        name: "Example Field Station",
      },
      attribution: {
        placement: "footer",
        copyright: "Copyright 2026 GENII Foundation",
        text: "Published with GENII Publisher",
        url: "https://publisher.genii.foundation",
        sourceCodeUrl: "https://example.test/source",
      },
    },
    sourceAuthority: {
      publicationManifestPath: "publication.json",
      sourceRoots: ["publication"],
      outputRoots: [".publisher"],
      sharedAssetsRoot: "publication/assets",
    },
    sources: [],
    extensions: [],
    payloads: [],
    works: [
      {
        id: "rain-gauge",
        title: "Rain Gauge",
        language: "en",
        publicationState: "draft",
        route: "/works/rain-gauge",
        source: {
          manifestPath: "publication/works/rain-gauge/work.json",
          manuscriptPath: "publication/works/rain-gauge/manuscript.md",
          adapter: {
            id: "markdown",
            package: "@genii-foundation/publisher-content",
            version: "1.0.0",
          },
          metrics: {
            id: "unicode-word-count",
            package: "@genii-foundation/publisher-content",
            version: "0.1.0-alpha.0",
            profileVersion: "15.1.0",
          },
        },
        rootSectionIds: [],
        sections: [],
        wordCount: 0,
        readingMinutes: 0,
        contentHash: DIGEST,
      },
    ],
    collections: [],
    assets: [],
    links: [],
    routes: {
      active: [
        {
          path: "/",
          target: {
            kind: "home",
          },
        },
        {
          path: "/works/rain-gauge",
          target: {
            kind: "work",
            workId: "rain-gauge",
          },
        },
      ],
      redirects: [],
    },
    statistics: {
      workCount: 1,
      collectionCount: 0,
      sectionCount: 0,
      blockCount: 0,
      wordCount: 0,
      readingMinutes: 0,
      wordsPerMinute: 238,
    },
  };
  addCompiledSection(envelope);
  return envelope;
}

function addCompiledSection(envelope) {
  const existing = envelope.works[0].sections[0];
  if (existing !== undefined) {
    return existing;
  }
  const section = {
    id: "first-reading",
    role: "section",
    title: "First Reading",
    parentId: null,
    childIds: [],
    depth: 0,
    order: 0,
    routes: {
      canonical: {
        path: "/works/rain-gauge/first-reading/",
      },
      reader: {
        path: "/reader/",
        anchor: "first-reading",
      },
    },
    activeRouteNames: ["canonical"],
    readerAddress: {
      path: "/reader/",
      anchor: "first-reading",
    },
    continuity: {
      id: "first-reading",
      legacyIds: ["opening-reading"],
      progressGroups: [["first-reading", "opening-reading"]],
      historicalSectionIds: ["historical-opening"],
    },
    navigable: true,
    blocks: [],
    previousId: null,
    nextId: null,
    wordCount: 0,
    readingMinutes: 0,
    contentHash: DIGEST,
  };

  envelope.works[0].rootSectionIds = [section.id];
  envelope.works[0].sections = [section];
  envelope.routes.active.push({
    path: section.routes.canonical.path,
    target: {
      kind: "section",
      workId: envelope.works[0].id,
      sectionId: section.id,
      routeName: "canonical",
    },
  });
  envelope.statistics.sectionCount = 1;
  return section;
}

function createSourceSpan() {
  return {
    sourcePath: "publication/works/rain-gauge/manuscript.md",
    start: {
      line: 1,
      column: 1,
      offset: 0,
    },
    end: {
      line: 1,
      column: 6,
      offset: 5,
    },
  };
}

function assertInvalid(input, expected) {
  const result = validateContentEnvelopeShape(input);
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code, path }) =>
        code === expected.code && path === expected.path,
    ),
    JSON.stringify(result.diagnostics, null, 2),
  );
  return result;
}

test("content envelope schema URL, package export, and constants agree", async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL("../schemas/package.json", import.meta.url), "utf8"),
  );

  assert.equal(contentEnvelopeSchema.$id, CONTENT_ENVELOPE_SCHEMA_URL);
  assert.equal(
    CONTENT_ENVELOPE_SCHEMA_URL,
    "https://publisher.genii.foundation/schemas/content-envelope.schema.json",
  );
  assert.equal(CONTENT_SCHEMA_VERSION, "1.0");
  assert.equal(
    CONTENT_ARTIFACT_MEDIA_TYPE,
    "application/vnd.genii.publisher.content+json",
  );
  assert.equal(
    CONTENT_ARTIFACT_RELATIVE_PATH,
    "content/publication-content.json",
  );
  assert.equal(
    packageManifest.exports["./content-envelope.schema.json"],
    "./content-envelope.schema.json",
  );
  assert.equal(typeof validateContentEnvelopeShape, "function");
});

test("a minimal content envelope satisfies the public schema", () => {
  const envelope = createMinimalEnvelope();
  const result = validateContentEnvelopeShape(envelope);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.value, envelope);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.diagnostics), true);
});

test("source authority and metric identity retain their exact fields", () => {
  const movedManifest = createMinimalEnvelope();
  movedManifest.sourceAuthority.publicationManifestPath =
    "outside/publication.json";
  assertInvalid(movedManifest, {
    code: "schema.const",
    path: "/sourceAuthority/publicationManifestPath",
  });

  const missingMetricProfile = createMinimalEnvelope();
  delete missingMetricProfile.works[0].source.metrics.profileVersion;
  assertInvalid(missingMetricProfile, {
    code: "schema.required",
    path: "/works/0/source/metrics/profileVersion",
  });
});

test("content envelope digests use lowercase SHA-256 syntax", () => {
  const envelope = createMinimalEnvelope();
  envelope.buildId = "sha256:not-a-digest";

  assertInvalid(envelope, {
    code: "schema.pattern",
    path: "/buildId",
  });
});

test("content envelope attribution is fixed", () => {
  const envelope = createMinimalEnvelope();
  envelope.publication.attribution.text = "Powered by Something Else";

  assertInvalid(envelope, {
    code: "schema.const",
    path: "/publication/attribution/text",
  });
});

test("section addresses separate server paths from optional anchors", () => {
  const envelope = createMinimalEnvelope();
  const section = addCompiledSection(envelope);
  const result = validateContentEnvelopeShape(envelope);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(section.routes.reader, {
    path: "/reader/",
    anchor: "first-reading",
  });

  section.routes.reader.path = "/reader/#first-reading";
  assertInvalid(envelope, {
    code: "schema.pattern",
    path: "/works/0/sections/0/routes/reader/path",
  });

  const legacyEnvelope = createMinimalEnvelope();
  const legacySection = addCompiledSection(legacyEnvelope);
  legacySection.routes.reader = "/reader/#first-reading";
  assertInvalid(legacyEnvelope, {
    code: "schema.type",
    path: "/works/0/sections/0/routes/reader",
  });
});

test("section hierarchy, navigation, and continuity fields are required", () => {
  for (const field of [
    "role",
    "activeRouteNames",
    "readerAddress",
    "continuity",
    "navigable",
  ]) {
    const envelope = createMinimalEnvelope();
    const section = addCompiledSection(envelope);
    delete section[field];

    assertInvalid(envelope, {
      code: "schema.required",
      path: `/works/0/sections/0/${field}`,
    });
  }
});

test("reader and block anchors use portable public identities", () => {
  const envelope = createMinimalEnvelope();
  const section = addCompiledSection(envelope);
  section.blocks = [
    {
      id: "opening-block",
      anchor: "p-h0123456789abcdef",
      kind: "paragraph",
      markdown: "First",
      text: "First",
      provenance: createSourceSpan(),
      wordCount: 1,
      contentHash: DIGEST,
    },
  ];

  let result = validateContentEnvelopeShape(envelope);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));

  delete section.blocks[0].anchor;
  assertInvalid(envelope, {
    code: "schema.required",
    path: "/works/0/sections/0/blocks/0/anchor",
  });

  const percentEncoded = createMinimalEnvelope();
  addCompiledSection(percentEncoded).readerAddress.anchor =
    "chapter%2Fpart";
  assertInvalid(percentEncoded, {
    code: "schema.pattern",
    path: "/works/0/sections/0/readerAddress/anchor",
  });

  const uppercaseBlock = createMinimalEnvelope();
  const uppercaseSection = addCompiledSection(uppercaseBlock);
  uppercaseSection.blocks = [
    {
      id: "opening-block",
      anchor: "UPPERCASE",
      kind: "paragraph",
      markdown: "First",
      text: "First",
      provenance: createSourceSpan(),
      wordCount: 1,
      contentHash: DIGEST,
    },
  ];
  assertInvalid(uppercaseBlock, {
    code: "schema.pattern",
    path: "/works/0/sections/0/blocks/0/anchor",
  });
});

test("section continuity rejects empty progress groups", () => {
  const envelope = createMinimalEnvelope();
  const section = addCompiledSection(envelope);
  section.continuity.progressGroups = [[]];

  assertInvalid(envelope, {
    code: "schema.min_items",
    path: "/works/0/sections/0/continuity/progressGroups/0",
  });
});

test("section and continuity IDs support long Coherence-style slugs", () => {
  assert.equal(COHERENCE_STYLE_CONTENT_ID.length, 142);

  const envelope = createMinimalEnvelope();
  const section = addCompiledSection(envelope);
  section.id = COHERENCE_STYLE_CONTENT_ID;
  section.continuity.id = COHERENCE_STYLE_CONTENT_ID;
  section.continuity.progressGroups = [[COHERENCE_STYLE_CONTENT_ID]];
  envelope.works[0].rootSectionIds = [COHERENCE_STYLE_CONTENT_ID];
  envelope.routes.active.at(-1).target.sectionId =
    COHERENCE_STYLE_CONTENT_ID;
  envelope.links.push(
    {
      id: "long-source-block-link",
      source: {
        kind: "source",
        workId: "rain-gauge",
        sectionId: COHERENCE_STYLE_CONTENT_ID,
        blockId: COHERENCE_STYLE_CONTENT_ID,
        occurrence: createSourceSpan(),
      },
      target: {
        kind: "work",
        workId: "rain-gauge",
      },
      href: "/works/rain-gauge",
    },
    {
      id: "long-semantic-block-link",
      source: {
        kind: "semantic",
        workId: "rain-gauge",
        sectionId: COHERENCE_STYLE_CONTENT_ID,
        blockId: COHERENCE_STYLE_CONTENT_ID,
      },
      target: {
        kind: "work",
        workId: "rain-gauge",
      },
      href: "/works/rain-gauge",
    },
  );

  const result = validateContentEnvelopeShape(envelope);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
});

test("stable publication and work IDs remain capped at 128 characters", () => {
  const overlongStableId = "a".repeat(129);
  const cases = [
    {
      path: "/publicationId",
      mutate(envelope) {
        envelope.publicationId = overlongStableId;
      },
    },
    {
      path: "/publication/id",
      mutate(envelope) {
        envelope.publication.id = overlongStableId;
      },
    },
    {
      path: "/works/0/id",
      mutate(envelope) {
        envelope.works[0].id = overlongStableId;
      },
    },
  ];

  for (const { mutate, path } of cases) {
    const envelope = createMinimalEnvelope();
    mutate(envelope);
    assertInvalid(envelope, {
      code: "schema.max_length",
      path,
    });
  }
});

test("URL fragments accept RFC characters and Unicode but reject malformed syntax", () => {
  const acceptedFragments = [
    "UPPERCASE",
    "chapter%2Fpart",
    "A._~!$&'()*+,;=:@/?-",
    "修行-Δ-🧭",
  ];
  for (const anchor of acceptedFragments) {
    const envelope = createMinimalEnvelope();
    const section = addCompiledSection(envelope);
    section.routes.reader.anchor = anchor;

    const result = validateContentEnvelopeShape(envelope);
    assert.equal(
      result.valid,
      true,
      `${JSON.stringify(anchor)}: ${JSON.stringify(result.diagnostics, null, 2)}`,
    );
  }

  const rejectedFragments = [
    "%",
    "%2",
    "%GG",
    "chapter%2Z",
    "chapter one",
    "chapter\u00a0one",
    "chapter#one",
    "chapter\u0000one",
    "chapter\u001fone",
    "chapter\u007fone",
  ];
  for (const anchor of rejectedFragments) {
    const envelope = createMinimalEnvelope();
    const section = addCompiledSection(envelope);
    section.routes.reader.anchor = anchor;

    assertInvalid(envelope, {
      code: "schema.pattern",
      path: "/works/0/sections/0/routes/reader/anchor",
    });
  }
});

test("source provenance distinguishes raw and normalized bytes", () => {
  const envelope = createMinimalEnvelope();
  envelope.sources.push({
    path: "publication/works/rain-gauge/manuscript.md",
    role: "manuscript",
    entityId: "rain-gauge",
    kind: "text",
    encoding: "utf-8",
    mediaType: "text/markdown",
    rawByteLength: 7,
    rawHash: DIGEST,
    normalizedByteLength: 6,
    normalizedHash: DIGEST,
    normalizedCodeUnitLength: 6,
    normalizedLineStarts: [0],
  });

  const result = validateContentEnvelopeShape(envelope);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));

  delete envelope.sources[0].rawHash;
  envelope.sources[0].hash = DIGEST;
  assertInvalid(envelope, {
    code: "schema.required",
    path: "/sources/0/rawHash",
  });
});

test("link source evidence is discriminated from semantic relationships", () => {
  const sourceEnvelope = createMinimalEnvelope();
  const section = addCompiledSection(sourceEnvelope);
  sourceEnvelope.links.push({
    id: "first-link",
    source: {
      kind: "source",
      workId: "rain-gauge",
      sectionId: section.id,
      occurrence: createSourceSpan(),
    },
    target: {
      kind: "section",
      workId: "rain-gauge",
      sectionId: section.id,
      routeName: "reader",
    },
    href: "/reader/#first-reading",
  });

  const sourceResult = validateContentEnvelopeShape(sourceEnvelope);
  assert.equal(
    sourceResult.valid,
    true,
    JSON.stringify(sourceResult.diagnostics, null, 2),
  );

  delete sourceEnvelope.links[0].source.occurrence;
  assertInvalid(sourceEnvelope, {
    code: "schema.required",
    path: "/links/0/source/occurrence",
  });

  const semanticEnvelope = createMinimalEnvelope();
  const semanticSection = addCompiledSection(semanticEnvelope);
  semanticEnvelope.links.push({
    id: "semantic-link",
    source: {
      kind: "semantic",
      workId: "rain-gauge",
      sectionId: semanticSection.id,
    },
    target: {
      kind: "work",
      workId: "rain-gauge",
    },
    href: "/works/rain-gauge",
  });
  const semanticResult = validateContentEnvelopeShape(semanticEnvelope);
  assert.equal(
    semanticResult.valid,
    true,
    JSON.stringify(semanticResult.diagnostics, null, 2),
  );

  semanticEnvelope.links[0].source.occurrence = createSourceSpan();
  assertInvalid(semanticEnvelope, {
    code: "schema.additional_property",
    path: "/links/0/source/occurrence",
  });
});

test("anchored hrefs use canonical routes with independent length limits", () => {
  const createEnvelopeWithAnchoredLink = (href) => {
    const envelope = createMinimalEnvelope();
    const section = addCompiledSection(envelope);
    envelope.links.push({
      id: "anchored-link",
      source: {
        kind: "semantic",
        workId: "rain-gauge",
        sectionId: section.id,
      },
      target: {
        kind: "section",
        workId: "rain-gauge",
        sectionId: section.id,
        routeName: "reader",
      },
      href,
    });
    return envelope;
  };

  const maximumRoute = `/${"a".repeat(2_047)}`;
  const maximumFragment = "b".repeat(2_048);
  for (const href of [
    "/caf%C3%A9/#anchor",
    "/%E6%9D%B1%E4%BA%AC/#修行",
    `${maximumRoute}#${maximumFragment}`,
  ]) {
    const envelope = createEnvelopeWithAnchoredLink(href);
    const result = validateContentEnvelopeShape(envelope);
    assert.equal(
      result.valid,
      true,
      `${href.slice(0, 80)}: ${JSON.stringify(result.diagnostics, null, 2)}`,
    );
  }

  const invalidHrefs = [
    ["raw Unicode path", "/café/#anchor"],
    ["encoded ASCII path", "/caf%65/#anchor"],
    ["lowercase UTF-8 path", "/caf%c3%a9/#anchor"],
    ["truncated UTF-8 path", "/%E9/#anchor"],
    ["overlong UTF-8 path", "/%C0%AF/#anchor"],
    ["overlong route", `/${"a".repeat(2_048)}#anchor`],
    ["overlong fragment", `/#${"a".repeat(2_049)}`],
  ];
  for (const [label, href] of invalidHrefs) {
    const envelope = createEnvelopeWithAnchoredLink(href);
    const result = validateContentEnvelopeShape(envelope);
    assert.equal(result.valid, false, label);
    assert.ok(
      result.diagnostics.some(
        ({ code, path }) =>
          code === "schema.pattern" && path === "/links/0/href",
      ),
      `${label}: ${JSON.stringify(result.diagnostics, null, 2)}`,
    );
  }
});

test("serialized content routes use the canonical ASCII grammar", () => {
  for (const route of [
    "/",
    "/works/rain-gauge",
    "/works/rain-gauge/",
    "/caf%C3%A9",
    "/caf%C3%A9/",
    "/%E6%9D%B1%E4%BA%AC",
    "/%E6%9D%B1%E4%BA%AC/",
    "/~reader:@v1!$&'()*+,;=",
  ]) {
    const envelope = createMinimalEnvelope();
    envelope.works[0].route = route;
    envelope.routes.active[1].path = route;
    const result = validateContentEnvelopeShape(envelope);
    assert.equal(
      result.valid,
      true,
      `${route}: ${JSON.stringify(result.diagnostics, null, 2)}`,
    );
  }

  const invalidRoutes = [
    ["network path", "//evil.example"],
    ["leading dot segment", "/./admin"],
    ["nested dot segment", "/notes/../admin"],
    ["empty segment", "/notes//admin"],
    ["backslash", String.raw`/notes\admin`],
    ["query", "/notes?draft=true"],
    ["fragment", "/notes#draft"],
    ["template braces", "/works/{workId}"],
    ["raw Unicode", "/café"],
    ["raw space", "/hello world"],
    ["lowercase escape", "/caf%c3%a9"],
    ["mixed case escape", "/caf%C3%a9"],
    ["encoded ASCII", "/hello%20world"],
    ["encoded slash", "/x%2Fy"],
    ["encoded dot segment", "/%2E%2E/admin"],
    ["bare percent", "/notes%"],
    ["nonhex escape", "/notes%GG"],
    ["truncated UTF-8", "/%E9"],
    ["overlong UTF-8", "/%C0%AF"],
    ["UTF-8 surrogate", "/%ED%A0%80"],
    ["UTF-8 above Unicode", "/%F4%90%80%80"],
    ["stray UTF-8 continuation", "/%80"],
    ["encoded C1 control", "/%C2%85"],
    ["encoded no-break space", "/%C2%A0"],
    ["encoded em space", "/%E2%80%83"],
    ["encoded byte-order mark", "/%EF%BB%BF"],
    ["square brackets", "/notes[1]"],
    ["backtick", "/notes`draft"],
    ["caret", "/notes^draft"],
    ["pipe", "/notes|draft"],
    ["quotation mark", "/notes\"draft"],
    ["control character", "/notes/\u0000admin"],
  ];
  for (const [label, route] of invalidRoutes) {
    const workEnvelope = createMinimalEnvelope();
    workEnvelope.works[0].route = route;
    const workResult = validateContentEnvelopeShape(workEnvelope);
    assert.equal(workResult.valid, false, `work route ${label}`);
    assert.ok(
      workResult.diagnostics.some(
        ({ code, path }) =>
          code === "schema.pattern" && path === "/works/0/route",
      ),
      `${label}: ${JSON.stringify(workResult.diagnostics, null, 2)}`,
    );

    const routeTableEnvelope = createMinimalEnvelope();
    routeTableEnvelope.routes.active[1].path = route;
    const routeTableResult = validateContentEnvelopeShape(routeTableEnvelope);
    assert.equal(routeTableResult.valid, false, `route table ${label}`);
    assert.ok(
      routeTableResult.diagnostics.some(
        ({ code, path }) =>
          code === "schema.pattern" && path === "/routes/active/1/path",
      ),
      `${label}: ${JSON.stringify(routeTableResult.diagnostics, null, 2)}`,
    );
  }
});

test("content route shape leaves decoded NFC normalization to full validation", () => {
  const envelope = createMinimalEnvelope();
  envelope.works[0].route = "/e%CC%81";
  envelope.routes.active[1].path = "/e%CC%81";
  const result = validateContentEnvelopeShape(envelope);
  assert.equal(
    result.valid,
    true,
    JSON.stringify(result.diagnostics, null, 2),
  );
});

test("required publication membership arrays cannot be empty", () => {
  const cases = [
    {
      path: "/works",
      mutate(envelope) {
        envelope.works = [];
      },
    },
    {
      path: "/works/0/rootSectionIds",
      mutate(envelope) {
        envelope.works[0].rootSectionIds = [];
      },
    },
    {
      path: "/works/0/sections",
      mutate(envelope) {
        envelope.works[0].sections = [];
      },
    },
    {
      path: "/collections/0/workIds",
      mutate(envelope) {
        envelope.collections.push({
          id: "field-readings",
          title: "Field Readings",
          route: "/collections/field-readings",
          manifestPath: "publication/collections/field-readings.json",
          workIds: [],
        });
      },
    },
  ];

  for (const { mutate, path } of cases) {
    const envelope = createMinimalEnvelope();
    mutate(envelope);
    assertInvalid(envelope, {
      code: "schema.min_items",
      path,
    });
  }
});

test("HTTP URLs carrying credentials are rejected", () => {
  for (const canonicalUrl of [
    "https://reader:secret@example.test/book",
    "http://reader@example.test/book",
  ]) {
    const envelope = createMinimalEnvelope();
    envelope.publication.canonicalUrl = canonicalUrl;

    assertInvalid(envelope, {
      code: "schema.pattern",
      path: "/publication/canonicalUrl",
    });
  }
});

test("server route paths reject template braces", () => {
  for (const route of [
    "/works/{workId}",
    "/works/rain-gauge/{section}",
  ]) {
    const envelope = createMinimalEnvelope();
    envelope.works[0].route = route;

    assertInvalid(envelope, {
      code: "schema.pattern",
      path: "/works/0/route",
    });
  }
});

test("asset hrefs are plain routes, never external or anchored URLs", () => {
  const createEnvelopeWithAsset = () => {
    const envelope = createMinimalEnvelope();
    envelope.assets.push({
      id: "rain-gauge-cover",
      workId: "rain-gauge",
      sourcePath: "publication/works/rain-gauge/assets/cover.jpg",
      href: "/assets/rain-gauge/cover.jpg",
      mediaType: "image/jpeg",
      hash: DIGEST,
    });
    return envelope;
  };

  const validEnvelope = createEnvelopeWithAsset();
  const validResult = validateContentEnvelopeShape(validEnvelope);
  assert.equal(
    validResult.valid,
    true,
    JSON.stringify(validResult.diagnostics, null, 2),
  );

  for (const href of [
    "https://example.test/cover.jpg",
    "/assets/rain-gauge/cover.jpg#full",
  ]) {
    const envelope = createEnvelopeWithAsset();
    envelope.assets[0].href = href;
    assertInvalid(envelope, {
      code: "schema.pattern",
      path: "/assets/0/href",
    });
  }
});

test("content envelopes reject undeclared properties", () => {
  const envelope = {
    ...createMinimalEnvelope(),
    unexpected: true,
  };

  assertInvalid(envelope, {
    code: "schema.additional_property",
    path: "/unexpected",
  });
});

test("content envelopes reject values outside the JSON data model", () => {
  const envelope = createMinimalEnvelope();
  envelope.publication.metadata = {
    invalid: new Map([["key", "value"]]),
  };

  assertInvalid(envelope, {
    code: "schema.non_json_value",
    path: "/publication/metadata/invalid",
  });
});

test("invalid content envelope diagnostics are deeply immutable", () => {
  const envelope = {
    ...createMinimalEnvelope(),
    unexpected: true,
  };
  const result = assertInvalid(envelope, {
    code: "schema.additional_property",
    path: "/unexpected",
  });
  const [diagnostic] = result.diagnostics;

  assert.ok(diagnostic);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.diagnostics), true);
  assert.equal(Object.isFrozen(diagnostic), true);
  assert.equal(Object.isFrozen(diagnostic.params), true);
  assert.throws(() => {
    result.diagnostics.push(diagnostic);
  }, TypeError);
  assert.throws(() => {
    diagnostic.params.additionalProperty = "changed";
  }, TypeError);
});
