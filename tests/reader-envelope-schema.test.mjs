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
import { performance } from "node:perf_hooks";
import test from "node:test";

import contentEnvelopeSchema from "../schemas/content-envelope.schema.json" with {
  type: "json",
};
import readerEnvelopeSchema from "../schemas/reader-envelope.schema.json" with {
  type: "json",
};
import {
  READER_ARTIFACT_KIND,
  READER_ARTIFACT_MEDIA_TYPE,
  READER_ARTIFACT_RELATIVE_PATH,
  READER_ENVELOPE_SCHEMA_URL,
  READER_SCHEMA_VERSION,
  READER_TEXT_PROFILE,
  inspectAbsoluteHttpUrl,
  inspectCanonicalUrlFragment,
  isAbsoluteHttpUrl,
  isCanonicalUrlFragment,
  validateReaderEnvelopeShape,
} from "../schemas/dist/reader.js";
import {
  inspectAbsoluteHttpUrl as inspectRouteSubpathAbsoluteHttpUrl,
  inspectCanonicalUrlFragment as inspectRouteSubpathFragment,
} from "../schemas/dist/routes.js";
import {
  inspectAbsoluteHttpUrl as inspectRootAbsoluteHttpUrl,
} from "../schemas/dist/index.js";
import {
  createPublicationReaderRuntime,
} from "../packages/reader/dist/runtime.js";

const DIGEST = `sha256:${"0".repeat(64)}`;

function createReaderEnvelope() {
  return {
    $schema: READER_ENVELOPE_SCHEMA_URL,
    schemaVersion: READER_SCHEMA_VERSION,
    publicationId: "field-notes",
    engineVersion: "1.0.0",
    readerVersion: "0.1.0-alpha.0",
    buildId: DIGEST,
    source: {
      kind: "publication-content",
      schemaVersion: "1.0",
      publicationId: "field-notes",
      engineVersion: "1.0.0",
      compilerVersion: "0.1.0-alpha.0",
      buildId: DIGEST,
      contentHash: DIGEST,
    },
    artifact: {
      kind: READER_ARTIFACT_KIND,
      mediaType: READER_ARTIFACT_MEDIA_TYPE,
      relativePath: READER_ARTIFACT_RELATIVE_PATH,
    },
    audience: "public",
    textProfile: { ...READER_TEXT_PROFILE },
    publication: {
      id: "field-notes",
      title: "Field Notes",
      description: "Observations from an invented field station.",
      language: "en",
      canonicalUrl: "https://example.test",
      publisher: {
        name: "Example Field Station",
        url: "https://example.test",
      },
      attribution: {
        placement: "footer",
        copyright: "Copyright 2026 GENII Foundation",
        text: "Published with GENII Publisher",
        url: "https://publisher.genii.foundation",
        sourceCodeUrl: "https://example.test/source",
      },
    },
    works: [
      {
        id: "rain-gauge",
        title: "Rain Gauge",
        summary: "A compact field note.",
        language: "en",
        publicationState: "published",
        route: "/works/rain-gauge/",
        rootSectionIds: ["first-reading"],
        sections: [
          {
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
            domId: "first-reading",
            continuity: {
              id: "first-reading",
              legacyIds: ["opening-reading"],
              progressGroups: [["first-reading", "opening-reading"]],
              historicalSectionIds: ["historical-opening"],
            },
            navigable: true,
            blocks: [
              {
                id: "opening-block",
                kind: "paragraph",
                markdown: "First [reading](/works/rain-gauge/).",
                text: "First reading.",
                readerAddress: {
                  path: "/reader/",
                  anchor: "first-reading-p-h0123456789abcdef",
                },
                domId: "first-reading-p-h0123456789abcdef",
                wordCount: 2,
                contentHash: DIGEST,
              },
            ],
            previousId: null,
            nextId: null,
            wordCount: 2,
            readingMinutes: 1,
            contentHash: DIGEST,
          },
        ],
        wordCount: 2,
        readingMinutes: 1,
        contentHash: DIGEST,
      },
    ],
    collections: [
      {
        id: "weather-observations",
        title: "Weather Observations",
        publicationState: "published",
        route: "/collections/weather-observations/",
        workIds: ["rain-gauge"],
      },
    ],
    assets: [
      {
        id: "rain-gauge-cover",
        workId: "rain-gauge",
        href: "/assets/rain-gauge/cover.jpg",
        mediaType: "image/jpeg",
        hash: DIGEST,
      },
    ],
    links: [
      {
        id: "rain-gauge-link",
        source: {
          kind: "block-markdown",
          workId: "rain-gauge",
          sectionId: "first-reading",
          blockId: "opening-block",
          range: {
            start: 6,
            end: 38,
          },
        },
        target: {
          kind: "work",
          workId: "rain-gauge",
        },
        href: "/works/rain-gauge/",
        label: "reading",
      },
      {
        id: "semantic-related-work",
        source: {
          kind: "semantic",
          workId: "rain-gauge",
          sectionId: "first-reading",
        },
        target: {
          kind: "work",
          workId: "rain-gauge",
        },
        href: "/works/rain-gauge/",
        relation: "related",
      },
    ],
    routes: {
      active: [
        {
          path: "/",
          target: {
            kind: "home",
          },
        },
        {
          path: "/works/rain-gauge/",
          target: {
            kind: "work",
            workId: "rain-gauge",
          },
        },
        {
          path: "/collections/weather-observations/",
          target: {
            kind: "collection",
            collectionId: "weather-observations",
          },
        },
        {
          path: "/works/rain-gauge/first-reading/",
          target: {
            kind: "section",
            workId: "rain-gauge",
            sectionId: "first-reading",
            routeName: "canonical",
          },
        },
      ],
      redirects: [
        {
          from: "/old-rain-gauge/",
          to: "/works/rain-gauge/",
          status: 308,
        },
      ],
    },
    statistics: {
      workCount: 1,
      collectionCount: 1,
      sectionCount: 1,
      blockCount: 1,
      wordCount: 2,
      readingMinutes: 1,
      wordsPerMinute: 238,
    },
  };
}

function assertInvalid(input, expected) {
  const result = validateReaderEnvelopeShape(input);
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code, path }) =>
        code === expected.code && path === expected.path,
    ),
    JSON.stringify(result.diagnostics, null, 2),
  );
}

test("reader schema URL, constants, and package exports agree", async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL("../schemas/package.json", import.meta.url), "utf8"),
  );

  assert.equal(readerEnvelopeSchema.$id, READER_ENVELOPE_SCHEMA_URL);
  assert.equal(
    READER_ENVELOPE_SCHEMA_URL,
    "https://publisher.genii.foundation/schemas/reader-envelope.schema.json",
  );
  assert.equal(READER_SCHEMA_VERSION, "1.0");
  assert.equal(READER_ARTIFACT_KIND, "publication-reader");
  assert.equal(
    READER_ARTIFACT_MEDIA_TYPE,
    "application/vnd.genii.publisher.reader+json",
  );
  assert.equal(
    READER_ARTIFACT_RELATIVE_PATH,
    "reader/publication-reader.json",
  );
  assert.deepEqual(READER_TEXT_PROFILE, {
    id: "genii-reader-block-markdown",
    version: "1.0",
    representation: "markdown",
    normalization: "none",
    offsetUnit: "utf-16-code-unit",
    rangeScope: "block",
    endBoundary: "exclusive",
  });
  assert.equal(Object.isFrozen(READER_TEXT_PROFILE), true);
  assert.deepEqual(packageManifest.exports["./reader"], {
    types: "./dist/reader.d.ts",
    import: "./dist/reader.js",
  });
  assert.equal(
    packageManifest.exports["./reader-envelope.schema.json"],
    "./reader-envelope.schema.json",
  );
});

test("a complete reader projection satisfies the public shape contract", () => {
  const envelope = createReaderEnvelope();
  const result = validateReaderEnvelopeShape(envelope);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.value, envelope);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.diagnostics), true);
});

test("reader and content route grammar definitions cannot drift", () => {
  for (const definitionName of [
    "routePath",
    "urlFragment",
    "contentAddress",
    "originRelativeAnchoredHref",
    "absoluteHttpUrl",
    "resolvedHref",
  ]) {
    assert.deepEqual(
      readerEnvelopeSchema.$defs[definitionName],
      contentEnvelopeSchema.$defs[definitionName],
      definitionName,
    );
  }
});

test("absolute HTTP URL inspection is exported consistently", () => {
  const cases = [
    ["https://example.test", { valid: true, value: "https://example.test" }],
    [
      "http://localhost:3000/read?mode=quiet#start",
      {
        valid: true,
        value: "http://localhost:3000/read?mode=quiet#start",
      },
    ],
    [
      "https://[2001:db8::1]:8443/%E2%9C%93",
      {
        valid: true,
        value: "https://[2001:db8::1]:8443/%E2%9C%93",
      },
    ],
    ["ftp://example.test", { valid: false, issue: "protocol" }],
    ["https://.", { valid: false, issue: "host" }],
    [
      "https://reader:secret@example.test",
      { valid: false, issue: "credentials" },
    ],
    [
      `https://example.test/${"\ud800"}`,
      { valid: false, issue: "unicode-scalar" },
    ],
    [
      `https://example.test/${"\udc00"}`,
      { valid: false, issue: "unicode-scalar" },
    ],
    [
      " https://example.test",
      { valid: false, issue: "serialization" },
    ],
    [
      "https://example.test ",
      { valid: false, issue: "serialization" },
    ],
    [
      "https://example.test/\nreader",
      { valid: false, issue: "serialization" },
    ],
    [
      String.raw`https://example.test\@evil.test`,
      { valid: false, issue: "serialization" },
    ],
    [
      "https://example.test/é",
      { valid: false, issue: "serialization" },
    ],
    [
      "https://example.test/%ZZ",
      { valid: false, issue: "serialization" },
    ],
    [
      "https://example.test/a[b]",
      { valid: false, issue: "serialization" },
    ],
    ["/reader", { valid: false, issue: "syntax" }],
    [42, { valid: false, issue: "type" }],
  ];

  for (const [value, expected] of cases) {
    assert.deepEqual(inspectAbsoluteHttpUrl(value), expected);
    assert.deepEqual(
      inspectRouteSubpathAbsoluteHttpUrl(value),
      expected,
    );
    assert.deepEqual(inspectRootAbsoluteHttpUrl(value), expected);
    assert.equal(isAbsoluteHttpUrl(value), expected.valid);
  }
});

test("reader URL shape and semantic inspection reject browser-repaired input", () => {
  const cases = [
    " https://example.test",
    "https://example.test ",
    "https://example.test/\nreader",
    String.raw`https://example.test\@evil.test`,
    "https://example.test/é",
    "https://example.test/%ZZ",
    "https://example.test/a[b]",
  ];

  for (const value of cases) {
    assert.deepEqual(inspectAbsoluteHttpUrl(value), {
      valid: false,
      issue: "serialization",
    });
    const envelope = createReaderEnvelope();
    envelope.publication.publisher.url = value;
    const result = validateReaderEnvelopeShape(envelope);
    assert.equal(result.valid, false, value);
    assert.ok(
      result.diagnostics.some(
        ({ path }) => path === "/publication/publisher/url",
      ),
      `${value}: ${JSON.stringify(result.diagnostics, null, 2)}`,
    );
  }
});

test("browser fragment inspection validates and decodes exactly once", () => {
  const validFragments = [
    ["a", "a"],
    ["%61", "a"],
    ["+", "+"],
    ["%2F", "/"],
    ["caf%C3%A9", "café"],
    ["修行-Δ-🧭", "修行-Δ-🧭"],
  ];
  for (const [value, decoded] of validFragments) {
    assert.deepEqual(inspectCanonicalUrlFragment(value), {
      valid: true,
      value,
      decoded,
    });
    assert.deepEqual(
      inspectRouteSubpathFragment(value),
      inspectCanonicalUrlFragment(value),
    );
    assert.equal(isCanonicalUrlFragment(value), true);
  }

  const invalidFragments = [
    ["", "length"],
    ["%", "percent-encoding-syntax"],
    ["%GG", "percent-encoding-syntax"],
    ["%E9", "percent-encoding-utf8"],
    ["chapter one", "whitespace"],
    ["chapter%20one", "whitespace"],
    ["%00", "control-character"],
    ["%C2%85", "control-character"],
    ["e%CC%81", "unicode-normalization"],
    ["%2561", "character"],
    ["chapter:~:text=x", "fragment-directive"],
    ["chapter%3A~%3Atext=x", "fragment-directive"],
    ["#chapter", "character"],
    ["\ud800", "unicode-scalar"],
    ["\udc00", "unicode-scalar"],
  ];
  for (const [value, issue] of invalidFragments) {
    assert.deepEqual(
      inspectCanonicalUrlFragment(value),
      { valid: false, issue },
      value,
    );
    assert.equal(isCanonicalUrlFragment(value), false, value);
  }
});

test("content and reader fragment schemas reject only unpaired surrogates", () => {
  for (const schema of [contentEnvelopeSchema, readerEnvelopeSchema]) {
    const fragmentPattern = new RegExp(
      schema.$defs.urlFragment.pattern,
      "u",
    );
    const anchoredHrefPattern = new RegExp(
      schema.$defs.originRelativeAnchoredHref.pattern,
      "u",
    );

    assert.equal(fragmentPattern.test("chapter-🧭"), true);
    assert.equal(fragmentPattern.test(`chapter-${"\ud800"}`), false);
    assert.equal(fragmentPattern.test(`chapter-${"\udc00"}`), false);
    assert.equal(
      anchoredHrefPattern.test("/reader/#chapter-🧭"),
      true,
    );
    assert.equal(
      anchoredHrefPattern.test(`/reader/#chapter-${"\ud800"}`),
      false,
    );
    assert.equal(
      anchoredHrefPattern.test(`/reader/#chapter-${"\udc00"}`),
      false,
    );
  }

  for (const fragment of ["\ud800", "\udc00"]) {
    const envelope = createReaderEnvelope();
    envelope.works[0].sections[0].routes.reader.anchor = fragment;
    assertInvalid(envelope, {
      code: "schema.pattern",
      path: "/works/0/sections/0/routes/reader/anchor",
    });

    const anchoredHref = createReaderEnvelope();
    anchoredHref.links[0].href =
      `/works/rain-gauge/#chapter-${fragment}`;
    assertInvalid(anchoredHref, {
      code: "schema.pattern",
      path: "/links/0/href",
    });
  }
});

test("exact SemVer schemas stay linear on oversized invalid prereleases", () => {
  assert.deepEqual(
    readerEnvelopeSchema.$defs.exactSemver,
    contentEnvelopeSchema.$defs.exactSemver,
  );
  const pattern = new RegExp(
    readerEnvelopeSchema.$defs.exactSemver.pattern,
    "u",
  );
  for (const version of [
    "0.0.0",
    "1.2.3-alpha",
    "1.2.3-0",
    "1.2.3-01alpha",
    "1.2.3-alpha.1+build.02",
  ]) {
    assert.equal(pattern.test(version), true, version);
  }
  for (const version of [
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-01",
    "1.2.3-",
    "1.2.3-alpha.",
    "1.2.3+build..2",
  ]) {
    assert.equal(pattern.test(version), false, version);
  }

  const hostileVersion = `1.2.3-${"a".repeat(50_000)}!`;
  const startedAt = performance.now();
  const envelope = createReaderEnvelope();
  envelope.engineVersion = hostileVersion;
  const result = validateReaderEnvelopeShape(envelope);
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code, path }) =>
        code === "schema.max_length" && path === "/engineVersion",
    ),
  );
  assert.ok(
    result.diagnostics.some(
      ({ code, path }) =>
        code === "schema.pattern" && path === "/engineVersion",
    ),
  );
  assert.ok(
    performance.now() - startedAt < 5_000,
    "Reader SemVer shape validation exceeded the 5 second safety bound.",
  );
});

test("progress-group uniqueness is enforced linearly by the reader runtime", () => {
  for (const schema of [contentEnvelopeSchema, readerEnvelopeSchema]) {
    const progressGroups =
      schema.$defs.contentContinuity.properties.progressGroups;
    assert.equal("uniqueItems" in progressGroups, false);
    assert.equal("uniqueItems" in progressGroups.items, false);
  }

  const cases = [
    {
      name: "within one group",
      groups: [
        ["first-reading", "opening-reading", "first-reading"],
      ],
      path:
        "/works/0/sections/0/continuity/progressGroups/0/2",
    },
    {
      name: "across groups",
      groups: [
        ["first-reading"],
        ["opening-reading", "first-reading"],
      ],
      path:
        "/works/0/sections/0/continuity/progressGroups/1/1",
    },
  ];

  for (const testCase of cases) {
    const envelope = createReaderEnvelope();
    envelope.works[0].sections[0].continuity.progressGroups =
      testCase.groups;
    const shape = validateReaderEnvelopeShape(envelope);
    assert.equal(
      shape.valid,
      true,
      `${testCase.name}: ${JSON.stringify(shape.diagnostics, null, 2)}`,
    );

    const result = createPublicationReaderRuntime(envelope);
    assert.equal(result.valid, false, testCase.name);
    assert.ok(
      result.diagnostics.some(
        ({ code, path }) =>
          code === "reader.runtime.continuity_progress_id_duplicate" &&
          path === testCase.path,
      ),
      `${testCase.name}: ${JSON.stringify(result.diagnostics, null, 2)}`,
    );
  }

  const largeEnvelope = createReaderEnvelope();
  largeEnvelope.works[0].sections[0].continuity.progressGroups =
    Array.from(
      { length: 20_000 },
      (_, index) => [`progress-${index}`],
    );
  const startedAt = performance.now();
  const largeShape = validateReaderEnvelopeShape(largeEnvelope);
  const elapsed = performance.now() - startedAt;
  assert.equal(
    largeShape.valid,
    true,
    JSON.stringify(largeShape.diagnostics, null, 2),
  );
  assert.ok(
    elapsed < 5_000,
    `Large progress-group shape validation took ${elapsed.toFixed(1)} ms.`,
  );
});

test("reader shape fixes its source, artifact, audience, and text profile", () => {
  const cases = [
    {
      path: "/source/kind",
      mutate(envelope) {
        envelope.source.kind = "publication-reader";
      },
    },
    {
      path: "/source/contentHash",
      mutate(envelope) {
        delete envelope.source.contentHash;
      },
      code: "schema.required",
    },
    {
      path: "/artifact/relativePath",
      mutate(envelope) {
        envelope.artifact.relativePath = "public/reader.json";
      },
    },
    {
      path: "/audience",
      mutate(envelope) {
        envelope.audience = "private";
      },
      code: "schema.enum",
    },
    {
      path: "/textProfile/representation",
      mutate(envelope) {
        envelope.textProfile.representation = "text";
      },
    },
    {
      path: "/textProfile/normalization",
      mutate(envelope) {
        envelope.textProfile.normalization = "nfc";
      },
    },
    {
      path: "/textProfile/endBoundary",
      mutate(envelope) {
        envelope.textProfile.endBoundary = "inclusive";
      },
    },
  ];

  for (const testCase of cases) {
    const envelope = createReaderEnvelope();
    testCase.mutate(envelope);
    assertInvalid(envelope, {
      code: testCase.code ?? "schema.const",
      path: testCase.path,
    });
  }

  for (const audience of ["public", "preview"]) {
    const envelope = createReaderEnvelope();
    envelope.audience = audience;
    const result = validateReaderEnvelopeShape(envelope);
    assert.equal(result.valid, true, audience);
  }
});

test("reader projection carries complete fixed attribution", () => {
  for (const field of [
    "placement",
    "copyright",
    "text",
    "url",
    "sourceCodeUrl",
  ]) {
    const envelope = createReaderEnvelope();
    delete envelope.publication.attribution[field];
    assertInvalid(envelope, {
      code: "schema.required",
      path: `/publication/attribution/${field}`,
    });
  }

  const rewritten = createReaderEnvelope();
  rewritten.publication.attribution.text = "Powered by Another Engine";
  assertInvalid(rewritten, {
    code: "schema.const",
    path: "/publication/attribution/text",
  });
});

test("sections and blocks require explicit nullable reader addresses and DOM IDs", () => {
  const sectionPath = "/works/0/sections/0";
  const blockPath = `${sectionPath}/blocks/0`;
  for (const [entity, path] of [
    [createReaderEnvelope().works[0].sections[0], sectionPath],
    [createReaderEnvelope().works[0].sections[0].blocks[0], blockPath],
  ]) {
    for (const field of ["readerAddress", "domId"]) {
      const envelope = createReaderEnvelope();
      const selected =
        path === sectionPath
          ? envelope.works[0].sections[0]
          : envelope.works[0].sections[0].blocks[0];
      delete selected[field];
      assertInvalid(envelope, {
        code: "schema.required",
        path: `${path}/${field}`,
      });
    }
    void entity;
  }

  const unaddressed = createReaderEnvelope();
  const section = unaddressed.works[0].sections[0];
  section.readerAddress = null;
  section.domId = null;
  section.blocks[0].readerAddress = null;
  section.blocks[0].domId = null;
  const result = validateReaderEnvelopeShape(unaddressed);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));

  const invalidDomId = createReaderEnvelope();
  invalidDomId.works[0].sections[0].domId = "First Reading";
  assertInvalid(invalidDomId, {
    code: "schema.pattern",
    path: "/works/0/sections/0/domId",
  });
});

test("collections retain their required effective publication state", () => {
  const envelope = createReaderEnvelope();
  delete envelope.collections[0].publicationState;
  assertInvalid(envelope, {
    code: "schema.required",
    path: "/collections/0/publicationState",
  });
});

test("a retained collection may be empty after draft work filtering", () => {
  const envelope = createReaderEnvelope();
  envelope.collections[0].workIds = [];

  const result = validateReaderEnvelopeShape(envelope);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
});

test("link locations discriminate semantic links from block-local Markdown ranges", () => {
  const missingRange = createReaderEnvelope();
  delete missingRange.links[0].source.range;
  assertInvalid(missingRange, {
    code: "schema.required",
    path: "/links/0/source/range",
  });

  const missingBlock = createReaderEnvelope();
  delete missingBlock.links[0].source.blockId;
  assertInvalid(missingBlock, {
    code: "schema.required",
    path: "/links/0/source/blockId",
  });

  const semanticWithRange = createReaderEnvelope();
  semanticWithRange.links[1].source.range = {
    start: 0,
    end: 1,
  };
  assertInvalid(semanticWithRange, {
    code: "schema.additional_property",
    path: "/links/1/source/range",
  });

  const invalidOffset = createReaderEnvelope();
  invalidOffset.links[0].source.range.start = -1;
  assertInvalid(invalidOffset, {
    code: "schema.invalid",
    path: "/links/0/source/range/start",
  });
});

test("reader routes retain the exact canonical ASCII serialization", () => {
  for (const route of [
    "/",
    "/works/rain-gauge/",
    "/caf%C3%A9",
    "/%E6%9D%B1%E4%BA%AC/",
  ]) {
    const envelope = createReaderEnvelope();
    envelope.works[0].route = route;
    const result = validateReaderEnvelopeShape(envelope);
    assert.equal(
      result.valid,
      true,
      `${route}: ${JSON.stringify(result.diagnostics, null, 2)}`,
    );
  }

  for (const route of [
    "/café",
    "/hello world",
    "/caf%c3%a9",
    "/hello%20world",
    "/x%2Fy",
    "/%E9",
    "/%C0%AF",
    "/notes//draft",
  ]) {
    const envelope = createReaderEnvelope();
    envelope.works[0].route = route;
    assertInvalid(envelope, {
      code: "schema.pattern",
      path: "/works/0/route",
    });
  }
});

test("reader projection omits source, extension grants, provider, and arbitrary metadata", () => {
  const cases = [
    {
      path: "/publication/metadata",
      mutate(envelope) {
        envelope.publication.metadata = {};
      },
    },
    {
      path: "/works/0/source",
      mutate(envelope) {
        envelope.works[0].source = {
          manuscriptPath: "publication/manuscript.md",
        };
      },
    },
    {
      path: "/works/0/metadata",
      mutate(envelope) {
        envelope.works[0].metadata = {};
      },
    },
    {
      path: "/collections/0/manifestPath",
      mutate(envelope) {
        envelope.collections[0].manifestPath =
          "publication/collections/weather.json";
      },
    },
    {
      path: "/assets/0/sourcePath",
      mutate(envelope) {
        envelope.assets[0].sourcePath =
          "publication/assets/rain-gauge-cover.jpg";
      },
    },
    {
      path: "/links/0/metadata",
      mutate(envelope) {
        envelope.links[0].metadata = {};
      },
    },
    {
      path: "/extensions",
      mutate(envelope) {
        envelope.extensions = [];
      },
    },
    {
      path: "/sync",
      mutate(envelope) {
        envelope.sync = {};
      },
    },
  ];

  for (const testCase of cases) {
    const envelope = createReaderEnvelope();
    testCase.mutate(envelope);
    assertInvalid(envelope, {
      code: "schema.additional_property",
      path: testCase.path,
    });
  }
});

test("reader statistics are explicit even when the public audience is empty", () => {
  const envelope = createReaderEnvelope();
  envelope.works = [];
  envelope.collections = [];
  envelope.assets = [];
  envelope.links = [];
  envelope.routes.active = [
    {
      path: "/",
      target: {
        kind: "home",
      },
    },
  ];
  envelope.statistics = {
    workCount: 0,
    collectionCount: 0,
    sectionCount: 0,
    blockCount: 0,
    wordCount: 0,
    readingMinutes: 0,
    wordsPerMinute: 238,
  };

  const result = validateReaderEnvelopeShape(envelope);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));

  delete envelope.statistics.blockCount;
  assertInvalid(envelope, {
    code: "schema.required",
    path: "/statistics/blockCount",
  });
});

test("browser reader subpath does not load semantic validation or semver", async () => {
  const [readerSource, shapeSource] = await Promise.all([
    readFile(new URL("../schemas/dist/reader.js", import.meta.url), "utf8"),
    readFile(
      new URL("../schemas/dist/schema-validation.js", import.meta.url),
      "utf8",
    ),
  ]);
  const browserGraph = `${readerSource}\n${shapeSource}`;

  assert.doesNotMatch(browserGraph, /semantic-validation/);
  assert.doesNotMatch(browserGraph, /["']semver(?:\/|["'])/);
  assert.doesNotMatch(browserGraph, /["']node:/);
});
