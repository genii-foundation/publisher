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
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  resolvePublicationLayout,
  validateCollectionShape,
  validateContentEnvelopeShape,
  validatePublicationSemantics,
  validatePublicationShape,
  validateWorkShape,
} from "../schemas/dist/index.js";
import {
  compileMarkdownWork,
  compilePublicationContent,
  CONTENT_COMPILER_VERSION,
  CONTENT_UNICODE_VERSION,
  createPublicationContentArtifact,
  hashCanonicalJson,
  serializePublicationContentEnvelope,
  sha256,
  validatePublicationContentEnvelope,
} from "../packages/content/dist/index.js";

const repositoryRoot = new URL("../", import.meta.url);
const repositoryRootPath = fileURLToPath(repositoryRoot);
const textEncoder = new TextEncoder();
const COHERENCE_STYLE_CONTENT_ID =
  "after-the-frontier-why-coherence-must-become-collective-practice-before-civilization-can-reliably-cross-from-fragmentation-into-shared-meaning";

function textBytes(value) {
  return textEncoder.encode(value);
}

function validationMessage(result) {
  return JSON.stringify(result.diagnostics, null, 2);
}

function assertValid(result) {
  assert.equal(result.valid, true, validationMessage(result));
  return result.value;
}

function diagnosticCodes(result) {
  return new Set(result.diagnostics.map(({ code }) => code));
}

function rehashEnvelope(envelope) {
  envelope.hashes.sourceSet = hashCanonicalJson(envelope.sources);
  envelope.hashes.content = hashCanonicalJson({
    publication: envelope.publication,
    sourceAuthority: envelope.sourceAuthority,
    works: envelope.works,
    collections: envelope.collections,
    extensions: envelope.extensions,
    payloads: envelope.payloads,
    assets: envelope.assets,
    links: envelope.links,
    routes: envelope.routes,
    statistics: envelope.statistics,
  });
  envelope.buildId = hashCanonicalJson({
    schemaVersion: envelope.schemaVersion,
    publicationId: envelope.publicationId,
    engineVersion: envelope.engineVersion,
    compilerVersion: envelope.compilerVersion,
    artifact: envelope.artifact,
    hashes: envelope.hashes,
  });
  return envelope;
}

function rehashWorkHierarchy(envelope, workIndex, sectionIndex, blockIndex) {
  const work = envelope.works[workIndex];
  const section = work.sections[sectionIndex];
  const block = section.blocks[blockIndex];
  block.contentHash = hashCanonicalJson({
    kind: block.kind,
    markdown: block.markdown,
    text: block.text,
    wordCount: block.wordCount,
    ...(block.metadata === undefined
      ? {}
      : { metadata: block.metadata }),
  });
  section.contentHash = hashCanonicalJson({
    id: section.id,
    role: section.role,
    title: section.title,
    parentId: section.parentId,
    childIds: section.childIds,
    depth: section.depth,
    order: section.order,
    routes: section.routes,
    activeRouteNames: section.activeRouteNames,
    readerAddress: section.readerAddress,
    continuity: section.continuity,
    navigable: section.navigable,
    blocks: section.blocks.map(({ id, anchor, contentHash }) => ({
      id,
      anchor,
      contentHash,
    })),
    ...(section.metadata === undefined
      ? {}
      : { metadata: section.metadata }),
  });
  work.contentHash = hashCanonicalJson({
    id: work.id,
    title: work.title,
    ...(work.subtitle === undefined ? {} : { subtitle: work.subtitle }),
    ...(work.summary === undefined ? {} : { summary: work.summary }),
    language: work.language,
    publicationState: work.publicationState,
    ...(work.publishedAt === undefined
      ? {}
      : { publishedAt: work.publishedAt }),
    ...(work.updatedAt === undefined
      ? {}
      : { updatedAt: work.updatedAt }),
    route: work.route,
    adapter: work.source.adapter,
    metrics: work.source.metrics,
    rootSectionIds: work.rootSectionIds,
    sections: work.sections.map(({ id, contentHash }) => ({
      id,
      contentHash,
    })),
    ...(work.metadata === undefined
      ? {}
      : { metadata: work.metadata }),
  });
  return rehashEnvelope(envelope);
}

async function resolveFixtureFile(fixtureRoot, repositoryPath) {
  const [realFixtureRoot, realCandidate] = await Promise.all([
    realpath(fixtureRoot),
    realpath(resolve(fixtureRoot, repositoryPath)),
  ]);
  const relativeCandidate = relative(realFixtureRoot, realCandidate);
  assert.equal(
    relativeCandidate.startsWith("..") || isAbsolute(relativeCandidate),
    false,
    `${repositoryPath} escapes its fixture root`,
  );
  return realCandidate;
}

async function readFixtureText(fixtureRoot, repositoryPath, crlf) {
  const value = await readFile(
    await resolveFixtureFile(fixtureRoot, repositoryPath),
    "utf8",
  );
  return crlf ? value.replaceAll("\n", "\r\n") : value;
}

async function loadCompilationInput(directory, options = {}) {
  const crlf = options.crlf ?? false;
  const fixtureRoot = resolve(repositoryRootPath, "fixtures", directory);
  const publicationText = await readFixtureText(
    fixtureRoot,
    "publication.json",
    crlf,
  );
  const publication = assertValid(
    validatePublicationShape(JSON.parse(publicationText)),
  );
  const layout = assertValid(resolvePublicationLayout(publication));
  const sources = [
    {
      path: layout.publicationManifestPath,
      role: "publication-manifest",
      mediaType: "application/json",
      contents: publicationText,
      rawBytes: textBytes(publicationText),
    },
  ];
  const workManifests = new Map();
  for (const reference of layout.works.manifests) {
    const text = await readFixtureText(
      fixtureRoot,
      reference.manifestPath,
      crlf,
    );
    const manifest = assertValid(validateWorkShape(JSON.parse(text)));
    workManifests.set(reference.manifestPath, manifest);
    sources.push({
      path: reference.manifestPath,
      role: "work-manifest",
      entityId: reference.id,
      mediaType: "application/json",
      contents: text,
      rawBytes: textBytes(text),
    });
  }

  const collectionManifests = new Map();
  for (const reference of layout.collections.manifests) {
    const text = await readFixtureText(
      fixtureRoot,
      reference.manifestPath,
      crlf,
    );
    const manifest = assertValid(validateCollectionShape(JSON.parse(text)));
    collectionManifests.set(reference.manifestPath, manifest);
    sources.push({
      path: reference.manifestPath,
      role: "collection-manifest",
      entityId: reference.id,
      mediaType: "application/json",
      contents: text,
      rawBytes: textBytes(text),
    });
  }

  const sourceGraph = assertValid(
    validatePublicationSemantics({
      publication,
      engineVersion: "1.0.0",
      workManifests,
      collectionManifests,
    }),
  );
  const works = [];
  for (const workSource of sourceGraph.works) {
    const markdown = await readFixtureText(
      fixtureRoot,
      workSource.manuscriptPath,
      crlf,
    );
    const compiled = assertValid(
      compileMarkdownWork({
        workId: workSource.workId,
        sectionId: `${workSource.workId}-root`,
        title: workSource.manifest.title,
        sourcePath: workSource.manuscriptPath,
        markdown,
      }),
    );
    sources.push(compiled.source);
    works.push(compiled.work);
  }

  const input = {
    engineVersion: "1.0.0",
    publication,
    sourceGraph,
    sources,
    works,
    extensions: (publication.extensions ?? []).map((extension) => ({
      id: extension.id,
      package: extension.package,
      version: "1.0.0",
      capabilities: extension.capabilities,
    })),
  };

  if (directory === "canonical-field-notes") {
    const assetPath =
      "publication/works/rain-gauge/assets/gauge-scale.txt";
    const assetSource = {
      path: assetPath,
      role: "asset",
      entityId: "rain-gauge",
      mediaType: "text/plain; charset=utf-8",
      contents: await readFixtureText(fixtureRoot, assetPath, crlf),
    };
    assetSource.rawBytes = textBytes(assetSource.contents);
    const firstBlockId = works[0].sections[0].blocks[0].id;
    input.sources.push(assetSource);
    input.assets = [
      {
        id: "gauge-scale",
        workId: "rain-gauge",
        sourcePath: assetPath,
        href: "/assets/gauge-scale.txt",
        mediaType: "text/plain",
      },
    ];
    input.links = [
      {
        id: "gauge-scale-link",
        source: {
          kind: "semantic",
          workId: "rain-gauge",
          sectionId: "rain-gauge-root",
          blockId: firstBlockId,
        },
        target: {
          kind: "asset",
          assetId: "gauge-scale",
        },
        href: "/assets/gauge-scale.txt",
        label: "Gauge scale",
      },
    ];
  }

  return input;
}

function compile(input) {
  return assertValid(compilePublicationContent(input));
}

function replaceWork(input, workId, transform) {
  return {
    ...input,
    works: input.works.map((work) =>
      work.workId === workId ? transform(work) : work,
    ),
  };
}

function replacePublication(input, transform) {
  const publication = transform(structuredClone(input.publication));
  return {
    ...input,
    publication,
    sources: input.sources.map((source) =>
      source.role === "publication-manifest"
        ? (() => {
            const contents = `${JSON.stringify(publication, null, 2)}\n`;
            return {
              ...source,
              contents,
              rawBytes: textBytes(contents),
            };
          })()
        : source,
    ),
  };
}

async function replaceManuscript(input, workId, replaceText) {
  const workSource = input.sourceGraph.works.find(
    (candidate) => candidate.workId === workId,
  );
  const workInput = input.works.find((candidate) => candidate.workId === workId);
  assert.ok(workSource);
  assert.ok(workInput);
  const manuscriptSource = input.sources.find(
    (source) =>
      source.role === "manuscript" && source.entityId === workId,
  );
  assert.ok(manuscriptSource);
  assert.equal(typeof manuscriptSource.contents, "string");
  const compiled = assertValid(
    compileMarkdownWork({
      workId,
      sectionId: workInput.sections[0].id,
      title: workInput.sections[0].title,
      sourcePath: workSource.manuscriptPath,
      markdown: replaceText(manuscriptSource.contents),
      adapter: workInput.adapter,
    }),
  );
  return {
    ...input,
    sources: input.sources.map((source) =>
      source === manuscriptSource ? compiled.source : source,
    ),
    works: input.works.map((work) =>
      work.workId === workId ? compiled.work : work,
    ),
  };
}

test("canonical content compiles with exact schema, assets, and links", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const envelope = compile(input);

  assert.equal(envelope.schemaVersion, "1.0");
  assert.equal(envelope.publicationId, "rain-gauge-journal");
  assert.deepEqual(envelope.works.map(({ id }) => id), ["rain-gauge"]);
  assert.deepEqual(envelope.collections.map(({ id }) => id), [
    "weather-observations",
  ]);
  assert.equal(envelope.assets[0].id, "gauge-scale");
  assert.equal(envelope.links[0].target.kind, "asset");
  assert.equal(envelope.links[0].href, envelope.assets[0].href);
  assert.deepEqual(envelope.works[0].sections[0].readerAddress, {
    path: envelope.works[0].route,
  });
  assert.ok(
    envelope.works[0].sections[0].blocks.every(
      ({ anchor, id }) =>
        anchor.startsWith("b-") &&
        id.startsWith("markdown-block-") &&
        anchor !== id,
    ),
  );
  assert.deepEqual(envelope.works[0].source.metrics, {
    id: "unicode-word-count",
    package: "@genii-foundation/publisher-content",
    version: CONTENT_COMPILER_VERSION,
    profileVersion: CONTENT_UNICODE_VERSION,
  });
  assert.equal(
    envelope.sourceAuthority.publicationManifestPath,
    "publication.json",
  );
  assert.deepEqual(
    envelope.sources.map(({ path }) => path),
    [...envelope.sources.map(({ path }) => path)].sort(),
  );

  assertValid(validateContentEnvelopeShape(envelope));
  assertValid(validatePublicationContentEnvelope(envelope));
  const wrongVersion = structuredClone(envelope);
  wrongVersion.schemaVersion = "2.0";
  const invalid = validateContentEnvelopeShape(wrongVersion);
  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.diagnostics.some(
      ({ path, keyword }) =>
        path === "/schemaVersion" && keyword === "const",
    ),
  );
});

test("declared content compiles without canonical path assumptions", async () => {
  const input = await loadCompilationInput("declared-night-dispatch");
  const envelope = compile(input);

  assert.deepEqual(envelope.works.map(({ id }) => id), [
    "signal-lantern",
    "platform-bell",
  ]);
  assert.deepEqual(
    envelope.works.map(({ source }) => source.manuscriptPath),
    [
      "archive/texts/signal-lantern/text.md",
      "archive/pages/platform-bell.md",
    ],
  );
  assert.deepEqual(envelope.collections[0].workIds, [
    "signal-lantern",
    "platform-bell",
  ]);
  assert.deepEqual(
    envelope.routes.active.map(({ path }) => path),
    [
      "/",
      "/dispatch-log",
      "/dispatch/signal-lantern",
      "/dispatch/platform-bell",
      "/sequences/after-dark",
    ],
  );
  assertValid(validateContentEnvelopeShape(envelope));
});

test("source and work input ordering do not affect deterministic output", async () => {
  const input = await loadCompilationInput("declared-night-dispatch");
  const baseline = compile(input);
  const reordered = compile({
    ...input,
    sources: [...input.sources].reverse(),
    works: [...input.works].reverse(),
  });

  assert.deepEqual(reordered, baseline);
  assert.equal(
    serializePublicationContentEnvelope(reordered),
    serializePublicationContentEnvelope(baseline),
  );
});

test("resolved extensions and source-backed payloads participate in identity", async () => {
  const input = await loadCompilationInput("declared-night-dispatch");
  const sourcePath = "shared/editorial/coherence-voice.json";
  const contents = `${JSON.stringify({
    voice: "coherence",
    register: "public",
  })}\n`;
  const extended = {
    ...input,
    sources: [
      ...input.sources,
      {
        path: sourcePath,
        role: "extension",
        entityId: "margin-notes",
        mediaType: "application/json",
        contents,
        rawBytes: textBytes(contents),
      },
    ],
    payloads: [
      {
        id: "coherence-editorial-voice",
        extensionId: "margin-notes",
        schema: "https://example.test/schemas/editorial-voice.json",
        sourcePaths: [sourcePath],
        data: {
          voice: "coherence",
          register: "public",
        },
      },
    ],
  };
  const envelope = compile(extended);

  assert.deepEqual(envelope.extensions, [
    {
      id: "margin-notes",
      package: "@example/margin-notes-extension",
      version: "1.0.0",
      capabilities: ["content.project", "renderer.slot"],
      config: {
        placement: "after-work",
      },
      payloadIds: ["coherence-editorial-voice"],
    },
  ]);
  assert.equal(
    envelope.payloads[0].contentHash.startsWith("sha256:"),
    true,
  );
  assert.equal(
    envelope.sources.find(({ path }) => path === sourcePath)?.role,
    "extension",
  );

  const versionChanged = compile({
    ...extended,
    extensions: extended.extensions.map((extension) => ({
      ...extension,
      version: "1.0.1",
    })),
  });
  assert.notEqual(versionChanged.hashes.content, envelope.hashes.content);
  assert.notEqual(versionChanged.buildId, envelope.buildId);

  const reorderedGrantsInput = replacePublication(
    extended,
    (publication) => {
      publication.extensions[0].capabilities.reverse();
      return publication;
    },
  );
  reorderedGrantsInput.extensions =
    reorderedGrantsInput.extensions.map((extension) => ({
      ...extension,
      capabilities: [...extension.capabilities].reverse(),
    }));
  const reorderedGrants = compile(reorderedGrantsInput);
  assert.deepEqual(reorderedGrants.extensions[0].capabilities, [
    "renderer.slot",
    "content.project",
  ]);
  assert.notEqual(
    reorderedGrants.hashes.content,
    envelope.hashes.content,
  );
  assert.notEqual(reorderedGrants.buildId, envelope.buildId);

  const forged = structuredClone(envelope);
  forged.payloads[0].data.register = "private";
  const validation = validatePublicationContentEnvelope(forged);
  assert.equal(validation.valid, false);
  assert.ok(
    diagnosticCodes(validation).has(
      "content.envelope.derived_value_mismatch",
    ),
    validationMessage(validation),
  );
});

test("extension resolution rejects unknown, duplicate, and inexact capability grants", async () => {
  const input = await loadCompilationInput("declared-night-dispatch");
  const cases = [
    {
      label: "unknown",
      capabilities: ["content.project", "renderer.everything"],
      code: "content.extension.capability_unknown",
      path: "/extensions/0/capabilities/1",
    },
    {
      label: "duplicate",
      capabilities: ["content.project", "content.project"],
      code: "content.extension.capability_duplicate",
      path: "/extensions/0/capabilities/1",
    },
    {
      label: "missing",
      capabilities: ["content.project"],
      code: "content.extension.capability_resolution_mismatch",
      path: "/extensions/0/capabilities",
      reason: "missing",
    },
    {
      label: "extra",
      capabilities: [
        "content.project",
        "renderer.slot",
        "host.route",
      ],
      code: "content.extension.capability_resolution_mismatch",
      path: "/extensions/0/capabilities",
      reason: "extra",
    },
    {
      label: "reordered",
      capabilities: ["renderer.slot", "content.project"],
      code: "content.extension.capability_resolution_mismatch",
      path: "/extensions/0/capabilities",
      reason: "reordered",
    },
    {
      label: "mismatched",
      capabilities: ["content.project", "renderer.client"],
      code: "content.extension.capability_resolution_mismatch",
      path: "/extensions/0/capabilities",
      reason: "mismatched",
    },
  ];

  for (const testCase of cases) {
    const result = compilePublicationContent({
      ...input,
      extensions: input.extensions.map((extension) => ({
        ...extension,
        capabilities: testCase.capabilities,
      })),
    });
    assert.equal(result.valid, false, testCase.label);
    assert.ok(
      result.diagnostics.some(
        ({ code, path, params }) =>
          code === testCase.code &&
          path === testCase.path &&
          (testCase.reason === undefined ||
            params.reason === testCase.reason),
      ),
      `${testCase.label}: ${validationMessage(result)}`,
    );
  }
});

test("invalid manifest grants cannot disappear before exact resolution comparison", async () => {
  const input = await loadCompilationInput("declared-night-dispatch");
  const cases = [
    {
      label: "mixed valid and unknown",
      capabilities: ["content.project", "renderer.everything"],
      code: "content.extension.declared_capability_unknown",
      path: "/publication/extensions/0/capabilities/1",
    },
    {
      label: "mixed valid and non-string",
      capabilities: ["content.project", 7],
      code: "content.extension.declared_capability_type_invalid",
      path: "/publication/extensions/0/capabilities/1",
    },
  ];

  for (const testCase of cases) {
    const invalidInput = replacePublication(
      input,
      (publication) => {
        publication.extensions[0].capabilities =
          testCase.capabilities;
        return publication;
      },
    );
    invalidInput.extensions = invalidInput.extensions.map(
      (extension) => ({
        ...extension,
        capabilities: ["content.project"],
      }),
    );

    const result = compilePublicationContent(invalidInput);
    assert.equal(result.valid, false, testCase.label);
    assert.equal(Object.hasOwn(result, "value"), false, testCase.label);
    assert.ok(
      result.diagnostics.some(
        ({ code, path }) =>
          code === testCase.code && path === testCase.path,
      ),
      `${testCase.label}: ${validationMessage(result)}`,
    );
    assert.ok(
      result.diagnostics.some(
        ({ code, params }) =>
          code ===
            "content.extension.capability_resolution_mismatch" &&
          params.reason === "mismatched" &&
          params.declaredValid === false &&
          params.resolvedValid === true,
      ),
      `${testCase.label}: ${validationMessage(result)}`,
    );
  }
});

test("custom metric producers preserve legacy counts and exact identity", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const customMetrics = {
    id: "coherence-word-count",
    package: "@genii-foundation/coherence-editorial",
    version: "1.0.0",
    profileVersion: "1.0.0",
  };
  const withCustomMetrics = replaceWork(
    input,
    "rain-gauge",
    (work) => ({
      ...work,
      metrics: customMetrics,
      sections: work.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block, index) => ({
          ...block,
          wordCount: 40 + index,
        })),
      })),
    }),
  );
  const envelope = compile(withCustomMetrics);
  const compiledWork = envelope.works[0];
  const expectedWordCount = compiledWork.sections[0].blocks.reduce(
    (total, block) => total + block.wordCount,
    0,
  );

  assert.deepEqual(compiledWork.source.metrics, customMetrics);
  assert.equal(compiledWork.wordCount, expectedWordCount);

  const nextProducer = compile(
    replaceWork(withCustomMetrics, "rain-gauge", (work) => ({
      ...work,
      metrics: {
        ...customMetrics,
        version: "1.0.1",
      },
    })),
  );
  assert.notEqual(
    nextProducer.works[0].contentHash,
    compiledWork.contentHash,
  );

  const nextProfile = compile(
    replaceWork(withCustomMetrics, "rain-gauge", (work) => ({
      ...work,
      metrics: {
        ...customMetrics,
        profileVersion: "1.0.1",
      },
    })),
  );
  assert.notEqual(
    nextProfile.works[0].contentHash,
    compiledWork.contentHash,
  );

  const missingCounts = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      metrics: customMetrics,
    })),
  );
  assert.equal(missingCounts.valid, false);
  assert.ok(
    diagnosticCodes(missingCounts).has(
      "content.block.word_count_required",
    ),
    validationMessage(missingCounts),
  );
});

test("CRLF and LF preserve normalized content while retaining raw identity", async () => {
  const [lfInput, crlfInput] = await Promise.all([
    loadCompilationInput("canonical-field-notes"),
    loadCompilationInput("canonical-field-notes", { crlf: true }),
  ]);
  const lf = compile(lfInput);
  const crlf = compile(crlfInput);

  assert.deepEqual(crlf.works, lf.works);
  assert.deepEqual(crlf.collections, lf.collections);
  assert.deepEqual(crlf.routes, lf.routes);
  assert.deepEqual(crlf.statistics, lf.statistics);
  assert.deepEqual(
    crlf.sources.map(
      ({ path, normalizedByteLength, normalizedHash }) => ({
        path,
        normalizedByteLength,
        normalizedHash,
      }),
    ),
    lf.sources.map(
      ({ path, normalizedByteLength, normalizedHash }) => ({
        path,
        normalizedByteLength,
        normalizedHash,
      }),
    ),
  );
  assert.notEqual(crlf.hashes.sourceSet, lf.hashes.sourceSet);
  assert.notEqual(crlf.buildId, lf.buildId);
  assert.notEqual(
    serializePublicationContentEnvelope(crlf),
    serializePublicationContentEnvelope(lf),
  );
});

test("text source custody requires exact well-formed UTF-8 bytes", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const manuscript = input.sources.find(
    ({ role }) => role === "manuscript",
  );
  assert.ok(manuscript);

  const malformed = compilePublicationContent({
    ...input,
    sources: input.sources.map((source) =>
      source === manuscript
        ? { ...source, rawBytes: new Uint8Array([0xff]) }
        : source,
    ),
  });
  assert.equal(malformed.valid, false);
  assert.ok(
    diagnosticCodes(malformed).has("content.source.utf8_invalid"),
    validationMessage(malformed),
  );

  const mismatched = compilePublicationContent({
    ...input,
    sources: input.sources.map((source) =>
      source === manuscript
        ? {
            ...source,
            rawBytes: textBytes(`${source.contents}changed`),
          }
        : source,
    ),
  });
  assert.equal(mismatched.valid, false);
  assert.ok(
    diagnosticCodes(mismatched).has(
      "content.source.decoding_mismatch",
    ),
    validationMessage(mismatched),
  );
});

test("long Coherence IDs and historical-only lineage survive compilation", async () => {
  assert.equal(COHERENCE_STYLE_CONTENT_ID.length, 142);
  const input = await loadCompilationInput("canonical-field-notes");
  const workRoute = input.sourceGraph.works[0].manifest.route;
  const migrated = replaceWork(input, "rain-gauge", (work) => ({
    ...work,
    sections: [
      {
        ...work.sections[0],
        id: COHERENCE_STYLE_CONTENT_ID,
        blocks: work.sections[0].blocks.map((block, index) => ({
          ...block,
          id:
            index === 0
              ? COHERENCE_STYLE_CONTENT_ID
              : block.id,
        })),
        routes: {
          reader: {
            path: workRoute,
            anchor: COHERENCE_STYLE_CONTENT_ID,
          },
        },
        activeRouteNames: [],
        readerLocation: {
          kind: "route",
          routeName: "reader",
        },
        continuity: {
          id: COHERENCE_STYLE_CONTENT_ID,
          legacyIds: [],
          progressGroups: [[COHERENCE_STYLE_CONTENT_ID]],
          historicalSectionIds: ["retired-section-lineage"],
        },
      },
    ],
  }));
  const envelope = compile({
    ...migrated,
    links: migrated.links.map((link) => ({
      ...link,
      source: {
        ...link.source,
        blockId: COHERENCE_STYLE_CONTENT_ID,
        sectionId: COHERENCE_STYLE_CONTENT_ID,
      },
    })),
  });
  const section = envelope.works[0].sections[0];

  assert.equal(section.id, COHERENCE_STYLE_CONTENT_ID);
  assert.equal(section.blocks[0].id, COHERENCE_STYLE_CONTENT_ID);
  assert.equal(
    envelope.links[0].source.blockId,
    COHERENCE_STYLE_CONTENT_ID,
  );
  assert.equal(
    section.routes.reader.anchor,
    COHERENCE_STYLE_CONTENT_ID,
  );
  assert.deepEqual(section.readerAddress, section.routes.reader);
  assert.deepEqual(section.continuity.historicalSectionIds, [
    "retired-section-lineage",
  ]);
});

test("a manuscript edit changes the complete deterministic hash cascade", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const baseline = compile(input);
  const changedInput = await replaceManuscript(
    input,
    "rain-gauge",
    (markdown) => markdown.replace("twelve millimeters", "thirteen millimeters"),
  );
  const changed = compile(changedInput);

  const baselineBlocks = baseline.works[0].sections[0].blocks;
  const changedBlocks = changed.works[0].sections[0].blocks;
  assert.ok(
    baselineBlocks.some(
      (block, index) =>
        block.contentHash !== changedBlocks[index]?.contentHash,
    ),
  );
  assert.notEqual(
    changed.works[0].sections[0].contentHash,
    baseline.works[0].sections[0].contentHash,
  );
  assert.notEqual(changed.works[0].contentHash, baseline.works[0].contentHash);
  assert.notEqual(changed.hashes.sourceSet, baseline.hashes.sourceSet);
  assert.notEqual(changed.hashes.content, baseline.hashes.content);
  assert.notEqual(changed.buildId, baseline.buildId);
  assert.notEqual(
    createPublicationContentArtifact(changed).hash,
    createPublicationContentArtifact(baseline).hash,
  );
});

test("public block anchors are independent from content-only block hashes", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const baseline = compile(input);
  const renamed = compile(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: work.sections.map((section, sectionIndex) => ({
        ...section,
        blocks: section.blocks.map((block, blockIndex) =>
          sectionIndex === 0 && blockIndex === 0
            ? { ...block, anchor: "reviewed-opening-anchor" }
            : block,
        ),
      })),
    })),
  );

  assert.equal(
    renamed.works[0].sections[0].blocks[0].contentHash,
    baseline.works[0].sections[0].blocks[0].contentHash,
  );
  assert.notEqual(
    renamed.works[0].sections[0].contentHash,
    baseline.works[0].sections[0].contentHash,
  );
  assert.notEqual(
    renamed.works[0].contentHash,
    baseline.works[0].contentHash,
  );
  assert.notEqual(renamed.hashes.content, baseline.hashes.content);
  assert.notEqual(renamed.buildId, baseline.buildId);

  const repeatedInput = await replaceManuscript(
    input,
    "rain-gauge",
    () => "Same observation.\n\nSame observation.\n",
  );
  const repeated = compile({ ...repeatedInput, links: [] });
  const [first, second] = repeated.works[0].sections[0].blocks;
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.anchor, second.anchor);
  assert.equal(first.contentHash, second.contentHash);
});

test("reader locations are explicit, owned, and collision checked", async () => {
  const input = await loadCompilationInput("canonical-field-notes");

  const duplicateBlockAnchor = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: work.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block, index) =>
          index === 1
            ? { ...block, anchor: section.blocks[0].anchor }
            : block,
        ),
      })),
    })),
  );
  assert.equal(duplicateBlockAnchor.valid, false);
  assert.ok(
    diagnosticCodes(duplicateBlockAnchor).has(
      "content.block.duplicate_anchor",
    ),
    validationMessage(duplicateBlockAnchor),
  );

  const missingBlockAnchor = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: work.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block, index) =>
          index === 0 ? { ...block, anchor: undefined } : block,
        ),
      })),
    })),
  );
  assert.equal(missingBlockAnchor.valid, false);
  assert.ok(
    diagnosticCodes(missingBlockAnchor).has("content.id.invalid"),
    validationMessage(missingBlockAnchor),
  );
  assert.equal(
    diagnosticCodes(missingBlockAnchor).has("content.input.unreadable"),
    false,
    validationMessage(missingBlockAnchor),
  );

  const missing = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: work.sections.map((section) => ({
        ...section,
        readerLocation: undefined,
      })),
    })),
  );
  assert.equal(missing.valid, false);
  assert.ok(
    diagnosticCodes(missing).has("content.section.reader_location_invalid"),
    validationMessage(missing),
  );

  const unknown = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: work.sections.map((section) => ({
        ...section,
        readerLocation: {
          kind: "route",
          routeName: "missing",
        },
      })),
    })),
  );
  assert.equal(unknown.valid, false);
  assert.ok(
    diagnosticCodes(unknown).has("content.section.reader_route_unknown"),
    validationMessage(unknown),
  );

  const inheritedRouteName = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: work.sections.map((section) => ({
        ...section,
        routes: {},
        activeRouteNames: ["constructor"],
        readerLocation: {
          kind: "route",
          routeName: "constructor",
        },
      })),
    })),
  );
  assert.equal(inheritedRouteName.valid, false);
  assert.ok(
    diagnosticCodes(inheritedRouteName).has(
      "content.section.reader_route_unknown",
    ),
    validationMessage(inheritedRouteName),
  );
  assert.ok(
    diagnosticCodes(inheritedRouteName).has(
      "content.section.active_route_unknown",
    ),
    validationMessage(inheritedRouteName),
  );
  assert.equal(
    diagnosticCodes(inheritedRouteName).has("content.input.unreadable"),
    false,
    validationMessage(inheritedRouteName),
  );

  const unknownKind = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: work.sections.map((section) => ({
        ...section,
        readerLocation: { kind: "guess" },
      })),
    })),
  );
  assert.equal(unknownKind.valid, false);
  assert.ok(
    diagnosticCodes(unknownKind).has(
      "content.section.reader_location_kind_unknown",
    ),
    validationMessage(unknownKind),
  );

  const encodedReaderAnchor = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: work.sections.map((section) => ({
        ...section,
        routes: {
          encoded: {
            path: input.sourceGraph.works[0].manifest.route,
            anchor: "%61",
          },
        },
        activeRouteNames: [],
        readerLocation: {
          kind: "route",
          routeName: "encoded",
        },
      })),
    })),
  );
  assert.equal(encodedReaderAnchor.valid, false);
  assert.ok(
    diagnosticCodes(encodedReaderAnchor).has("content.id.invalid"),
    validationMessage(encodedReaderAnchor),
  );

  for (const anchor of [
    "section:~:text=phrase",
    "section%3A~%3Atext=phrase",
  ]) {
    const fragmentDirective = compilePublicationContent(
      replaceWork(input, "rain-gauge", (work) => ({
        ...work,
        sections: work.sections.map((section) => ({
          ...section,
          routes: {
            legacy: {
              path: input.sourceGraph.works[0].manifest.route,
              anchor,
            },
          },
          activeRouteNames: [],
          readerLocation: { kind: "none" },
          navigable: false,
        })),
      })),
    );
    assert.equal(fragmentDirective.valid, false);
    assert.ok(
      diagnosticCodes(fragmentDirective).has("content.fragment.invalid"),
      validationMessage(fragmentDirective),
    );
  }

  const none = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: work.sections.map((section) => ({
        ...section,
        readerLocation: { kind: "none" },
      })),
    })),
  );
  assert.equal(none.valid, false);
  assert.ok(
    diagnosticCodes(none).has("content.section.reader_location_required"),
    validationMessage(none),
  );

  const workRoute = input.sourceGraph.works[0].manifest.route;
  const duplicateWorkOwner = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: [
        ...work.sections,
        {
          id: "rain-gauge-second",
          role: "section",
          title: "Second Reading",
          readerLocation: { kind: "work" },
          navigable: true,
          blocks: [],
        },
      ],
    })),
  );
  assert.equal(duplicateWorkOwner.valid, false);
  assert.ok(
    diagnosticCodes(duplicateWorkOwner).has(
      "content.reader_address.collision",
    ),
    validationMessage(duplicateWorkOwner),
  );

  const firstAnchor = input.works[0].sections[0].blocks[0].anchor;
  const blockAddressCollision = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: [
        ...work.sections,
        {
          id: "rain-gauge-collision",
          role: "section",
          title: "Colliding Reading",
          routes: {
            reader: {
              path: workRoute,
              anchor: firstAnchor,
            },
          },
          activeRouteNames: [],
          readerLocation: {
            kind: "route",
            routeName: "reader",
          },
          navigable: true,
          blocks: [],
        },
      ],
    })),
  );
  assert.equal(blockAddressCollision.valid, false);
  assert.ok(
    diagnosticCodes(blockAddressCollision).has("content.address.collision"),
    validationMessage(blockAddressCollision),
  );
});

test("qualified block addresses support composite pages and reject ambiguity", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const workRoute = input.sourceGraph.works[0].manifest.route;
  const compositeInput = replaceWork(input, "rain-gauge", (work) => {
    const root = work.sections[0];
    return {
      ...work,
      sections: [
        {
          ...root,
          routes: {
            reader: {
              path: workRoute,
              anchor: "first",
            },
          },
          activeRouteNames: [],
          readerLocation: {
            kind: "route",
            routeName: "reader",
          },
          blocks: [{ ...root.blocks[0], anchor: "p-habc" }],
        },
        {
          id: "rain-gauge-second",
          role: "section",
          title: "Second Reading",
          routes: {
            reader: {
              path: workRoute,
              anchor: "second",
            },
          },
          activeRouteNames: [],
          readerLocation: {
            kind: "route",
            routeName: "reader",
          },
          navigable: true,
          blocks: [{ ...root.blocks[1], anchor: "p-habc" }],
        },
      ],
    };
  });
  const composite = compile(compositeInput);
  const [first, second] = composite.works[0].sections;
  assert.deepEqual(first.readerAddress, {
    path: workRoute,
    anchor: "first",
  });
  assert.deepEqual(second.readerAddress, {
    path: workRoute,
    anchor: "second",
  });
  assert.equal(
    `${first.readerAddress.anchor}-${first.blocks[0].anchor}`,
    "first-p-habc",
  );
  assert.equal(
    `${second.readerAddress.anchor}-${second.blocks[0].anchor}`,
    "second-p-habc",
  );

  const ambiguous = compilePublicationContent(
    replaceWork(compositeInput, "rain-gauge", (work) => ({
      ...work,
      sections: work.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              routes: {},
              activeRouteNames: [],
              readerLocation: { kind: "work" },
              blocks: [
                {
                  ...section.blocks[0],
                  anchor: "second-p-habc",
                },
              ],
            }
          : section,
      ),
    })),
  );
  assert.equal(ambiguous.valid, false);
  assert.ok(
    diagnosticCodes(ambiguous).has("content.block_address.collision"),
    validationMessage(ambiguous),
  );

  const encodedAliasCollision = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => {
      const root = work.sections[0];
      return {
        ...work,
        sections: [
          {
            ...root,
            blocks: [
              {
                ...root.blocks[0],
                anchor: "b-one",
              },
              ...root.blocks.slice(1),
            ],
          },
          {
            id: "rain-gauge-encoded-alias",
            role: "section",
            title: "Encoded Alias",
            routes: {
              legacy: {
                path: workRoute,
                anchor: "%62-one",
              },
            },
            activeRouteNames: [],
            readerLocation: { kind: "none" },
            navigable: false,
            blocks: [],
          },
        ],
      };
    }),
  );
  assert.equal(encodedAliasCollision.valid, false);
  assert.ok(
    diagnosticCodes(encodedAliasCollision).has(
      "content.address.collision",
    ),
    validationMessage(encodedAliasCollision),
  );

  const selected = (reverse) =>
    compile(
      replaceWork(input, "rain-gauge", (work) => ({
        ...work,
        sections: work.sections.map((section) => ({
          ...section,
          routes: Object.fromEntries(
            (reverse
              ? [
                  ["selected", { path: workRoute, anchor: "selected" }],
                  ["alias", { path: workRoute, anchor: "alias" }],
                ]
              : [
                  ["alias", { path: workRoute, anchor: "alias" }],
                  ["selected", { path: workRoute, anchor: "selected" }],
                ]),
          ),
          activeRouteNames: [],
          readerLocation: {
            kind: "route",
            routeName: "selected",
          },
        })),
      })),
    );
  const forward = selected(false);
  const reversed = selected(true);
  assert.deepEqual(
    forward.works[0].sections[0].readerAddress,
    reversed.works[0].sections[0].readerAddress,
  );
  assert.equal(forward.buildId, reversed.buildId);
});

test("compiled envelopes and artifacts are detached immutable snapshots", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const before = JSON.stringify(input);
  const envelope = compile(input);
  const artifact = createPublicationContentArtifact(envelope);

  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.works), true);
  assert.equal(Object.isFrozen(envelope.works[0].sections[0].blocks[0]), true);
  assert.throws(() => {
    envelope.works[0].title = "Mutated";
  }, TypeError);
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(Object.isFrozen(artifact.envelope), true);
  assert.throws(() => {
    artifact.envelope.statistics.wordCount = 0;
  }, TypeError);
});

test("missing work content is rejected", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const result = compilePublicationContent({ ...input, works: [] });

  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).has("content.work.input_missing"));
});

test("a section parent must exist earlier in preorder", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const invalidInput = replaceWork(input, "rain-gauge", (work) => ({
    ...work,
    sections: [
      {
        ...work.sections[0],
        parentId: "missing-parent",
      },
    ],
  }));
  const result = compilePublicationContent(invalidInput);

  assert.equal(result.valid, false);
  assert.ok(
    diagnosticCodes(result).has("content.section.parent_invalid"),
    validationMessage(result),
  );
});

test("block Markdown must match its exact source range", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const invalidInput = replaceWork(input, "rain-gauge", (work) => ({
    ...work,
    sections: [
      {
        ...work.sections[0],
        blocks: work.sections[0].blocks.map((block, index) =>
          index === 0
            ? { ...block, markdown: `${block.markdown} changed` }
            : block,
        ),
      },
    ],
  }));
  const result = compilePublicationContent(invalidInput);

  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).has("content.block.source_mismatch"));
});

test("overlapping block source ranges are rejected", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const invalidInput = replaceWork(input, "rain-gauge", (work) => {
    const firstBlock = work.sections[0].blocks[0];
    return {
      ...work,
      sections: [
        {
          ...work.sections[0],
          blocks: [
            ...work.sections[0].blocks,
            {
              ...firstBlock,
              id: "overlapping-block",
            },
          ],
        },
      ],
    };
  });
  const result = compilePublicationContent(invalidInput);

  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).has("content.block.range_overlap"));
});

test("section routes cannot collide with an existing active route", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const workRoute = input.sourceGraph.works[0].manifest.route;
  assert.ok(workRoute);
  const invalidInput = replaceWork(input, "rain-gauge", (work) => ({
    ...work,
    sections: [
      {
        ...work.sections[0],
        routes: { canonical: { path: workRoute } },
        activeRouteNames: ["canonical"],
      },
    ],
  }));
  const result = compilePublicationContent(invalidInput);

  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).has("content.route.collision"));
});

test("structured addresses preserve trailing routes and use active anchor bases", async () => {
  const input = replacePublication(
    await loadCompilationInput("canonical-field-notes"),
    (publication) => ({
      ...publication,
      routes: {
        ...publication.routes,
        updates: "/reader/%E6%9D%B1%E4%BA%AC/",
      },
    }),
  );
  const routed = replaceWork(input, "rain-gauge", (work) => ({
    ...work,
    sections: [
      {
        ...work.sections[0],
        routes: {
          canonical: { path: "/reading/caf%C3%A9/" },
          reader: {
            path: "/reader/%E6%9D%B1%E4%BA%AC/",
            anchor: "rain-gauge-root",
          },
        },
        activeRouteNames: ["canonical"],
        readerLocation: {
          kind: "route",
          routeName: "reader",
        },
      },
    ],
  }));
  const envelope = compile(routed);
  const section = envelope.works[0].sections[0];

  assert.deepEqual(section.routes.reader, {
    path: "/reader/%E6%9D%B1%E4%BA%AC/",
    anchor: "rain-gauge-root",
  });
  assert.deepEqual(section.readerAddress, section.routes.reader);
  assert.ok(
    envelope.routes.active.some(
      ({ path }) => path === "/reading/caf%C3%A9/",
    ),
  );
  assert.equal(
    envelope.routes.active.some(
      ({ path }) => path === "/reader/%E6%9D%B1%E4%BA%AC/",
    ),
    true,
  );
});

test("unanchored section addresses cannot claim another route owner", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const workRoute = input.sourceGraph.works[0].manifest.route;
  assert.ok(workRoute);

  const sameWorkRoot = replaceWork(input, "rain-gauge", (work) => ({
    ...work,
    sections: [
      {
        ...work.sections[0],
        routes: { root: { path: workRoute } },
        activeRouteNames: [],
        readerLocation: { kind: "route", routeName: "root" },
      },
    ],
  }));
  assert.deepEqual(
    compile(sameWorkRoot).works[0].sections[0].readerAddress,
    { path: workRoute },
  );

  const crossOwnerInput = replaceWork(input, "rain-gauge", (work) => ({
    ...work,
    sections: [
      {
        ...work.sections[0],
        routes: { foreign: { path: "/" } },
        activeRouteNames: [],
        readerLocation: { kind: "route", routeName: "foreign" },
      },
    ],
  }));
  const compileResult = compilePublicationContent(crossOwnerInput);
  assert.equal(compileResult.valid, false);
  assert.ok(
    diagnosticCodes(compileResult).has(
      "content.address.unanchored_owner_mismatch",
    ),
    validationMessage(compileResult),
  );

  const forged = structuredClone(compile(input));
  forged.works[0].sections[0].routes.foreign = { path: "/" };
  rehashWorkHierarchy(forged, 0, 0, 0);
  const validation = validatePublicationContentEnvelope(forged);
  assert.equal(validation.valid, false);
  assert.ok(
    diagnosticCodes(validation).has(
      "content.address.unanchored_owner_mismatch",
    ),
    validationMessage(validation),
  );

  const forgedReaderAddress = structuredClone(compile(input));
  forgedReaderAddress.works[0].sections[0].readerAddress = {
    path: "/",
  };
  rehashWorkHierarchy(forgedReaderAddress, 0, 0, 0);
  const readerAddressValidation = validatePublicationContentEnvelope(
    forgedReaderAddress,
  );
  assert.equal(readerAddressValidation.valid, false);
  assert.ok(
    readerAddressValidation.diagnostics.some(
      ({ code, path }) =>
        code ===
          "content.reader_address.unanchored_owner_mismatch" &&
        path === "/works/0/sections/0/readerAddress",
    ),
    validationMessage(readerAddressValidation),
  );
});

test("compiler rejects non-canonical serialized section routes", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const invalidRoutes = [
    ["raw-unicode", "/café", "raw-non-ascii"],
    ["raw-space", "/hello world", "whitespace"],
    ["lowercase-escape", "/caf%c3%a9", "percent-encoding-case"],
    ["encoded-space", "/hello%20world", "percent-encoded-ascii"],
    ["encoded-slash", "/x%2Fy", "percent-encoded-ascii"],
    ["encoded-dot", "/%2E%2E/x", "percent-encoded-ascii"],
    ["bare-percent", "/%", "percent-encoding-syntax"],
    ["nonhex-escape", "/%ZZ", "percent-encoding-syntax"],
    ["incomplete-utf8", "/%E9", "percent-encoding-utf8"],
    ["overlong-utf8", "/%C0%AF", "percent-encoding-utf8"],
    ["decoded-nfd", "/e%CC%81", "unicode-normalization"],
    ["decoded-control", "/%C2%85", "control-character"],
    ["decoded-space", "/%E2%80%83", "whitespace"],
    ["raw-control", "/a\u0000b", "control-character"],
    ["dot-segment", "/./x", "dot-segment"],
    ["empty-segment", "/a//b", "empty-segment"],
    ["non-pchar-ascii", "/square[bracket]", "character"],
    ["serialized-too-long", `/${"a".repeat(2_048)}`, "length"],
  ];
  const invalidInput = replaceWork(input, "rain-gauge", (work) => ({
    ...work,
    sections: [
      {
        ...work.sections[0],
        routes: Object.fromEntries(
          invalidRoutes.map(([name, path]) => [name, { path }]),
        ),
        activeRouteNames: [],
      },
    ],
  }));
  const result = compilePublicationContent(invalidInput);

  assert.equal(result.valid, false);
  for (const [name, , expectedIssue] of invalidRoutes) {
    assert.ok(
      result.diagnostics.some(
        ({ code, params, path }) =>
          code === "content.route.invalid" &&
          params.issue === expectedIssue &&
          path === `/works/0/sections/0/routes/${name}/path`,
      ),
      `${name} should report ${expectedIssue}: ${validationMessage(result)}`,
    );
  }
});

test("navigation skips structural sections without flattening hierarchy", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const expanded = replaceWork(input, "rain-gauge", (work) => {
    const root = work.sections[0];
    return {
      ...work,
      sections: [
        root,
        {
          id: "rain-gauge-part",
          role: "part",
          title: "Measurements",
          parentId: root.id,
          navigable: false,
          readerLocation: { kind: "none" },
          blocks: [],
        },
        {
          id: "rain-gauge-afterword",
          role: "afterword",
          title: "Afterword",
          parentId: root.id,
          navigable: true,
          routes: {
            reader: {
              path: input.sourceGraph.works[0].manifest.route,
              anchor: "rain-gauge-afterword",
            },
          },
          activeRouteNames: [],
          readerLocation: {
            kind: "route",
            routeName: "reader",
          },
          blocks: [],
        },
      ],
    };
  });
  const envelope = compile(expanded);
  const sections = envelope.works[0].sections;

  assert.equal(sections[0].nextId, "rain-gauge-afterword");
  assert.equal(sections[1].previousId, null);
  assert.equal(sections[1].nextId, null);
  assert.equal(sections[2].previousId, "rain-gauge-root");
  assert.deepEqual(sections[0].childIds, [
    "rain-gauge-part",
    "rain-gauge-afterword",
  ]);
});

test("redirects resolve through adapter routes and reject final collisions", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const routed = replaceWork(input, "rain-gauge", (work) => ({
    ...work,
    sections: [
      {
        ...work.sections[0],
        routes: { canonical: { path: "/reading/rain-gauge/" } },
        activeRouteNames: ["canonical"],
      },
    ],
  }));
  const redirected = replacePublication(routed, (publication) => ({
    ...publication,
    continuity: {
      redirects: [
        {
          from: "/old-reading/",
          to: "/reading/rain-gauge/",
          status: 308,
        },
      ],
    },
  }));
  const envelope = compile(redirected);
  assert.deepEqual(envelope.routes.redirects, [
    {
      from: "/old-reading/",
      to: "/reading/rain-gauge/",
      status: 308,
    },
  ]);

  const collision = replacePublication(routed, (publication) => ({
    ...publication,
    continuity: {
      redirects: [
        {
          from: "/reading/rain-gauge/",
          to: "/works/rain-gauge",
          status: 308,
        },
      ],
    },
  }));
  const result = compilePublicationContent(collision);
  assert.equal(result.valid, false);
  assert.ok(
    diagnosticCodes(result).has("content.redirect.active_route_source"),
    validationMessage(result),
  );
});

test("redirect loops and unresolved internal targets are rejected after compilation", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const looped = replacePublication(input, (publication) => ({
    ...publication,
    continuity: {
      redirects: [
        { from: "/old-a/", to: "/old-b/", status: 308 },
        { from: "/old-b/", to: "/old-a/", status: 308 },
        { from: "/orphan/", to: "/missing/", status: 308 },
      ],
    },
  }));
  const result = compilePublicationContent(looped);

  assert.equal(result.valid, false);
  assert.ok(diagnosticCodes(result).has("content.redirect.loop"));
  assert.ok(
    diagnosticCodes(result).has(
      "content.redirect.internal_target_unresolved",
    ),
  );
});

test("continuity identities have one publication-wide owner", async () => {
  const input = await loadCompilationInput("declared-night-dispatch");
  const firstContinuityId = input.works[0].sections[0].continuity.id;
  const invalid = replaceWork(input, "platform-bell", (work) => ({
    ...work,
    sections: [
      {
        ...work.sections[0],
        continuity: {
          ...work.sections[0].continuity,
          legacyIds: [firstContinuityId],
        },
      },
    ],
  }));
  const result = compilePublicationContent(invalid);

  assert.equal(result.valid, false);
  assert.ok(
    diagnosticCodes(result).has("content.continuity.identity_collision"),
    validationMessage(result),
  );
});

test("asset ownership, media type, and public href authority are enforced", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const asset = input.assets[0];
  const assetSource = input.sources.find(
    (source) => source.path === asset.sourcePath,
  );
  assert.ok(assetSource);
  const invalid = {
    ...input,
    sources: input.sources.map((source) =>
      source === assetSource
        ? {
            ...source,
            entityId: "wrong-work",
            mediaType: "image/png",
          }
        : source,
    ),
    assets: [
      {
        ...asset,
        href: input.sourceGraph.works[0].manifest.route,
      },
    ],
  };
  const result = compilePublicationContent(invalid);

  assert.equal(result.valid, false);
  const codes = diagnosticCodes(result);
  assert.ok(codes.has("content.asset.source_owner_mismatch"));
  assert.ok(codes.has("content.asset.media_type_mismatch"));
  assert.ok(codes.has("content.asset.route_collision"));
});

test("anchored addresses, assets, and redirects have one public authority", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const unresolvedAddress = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => ({
      ...work,
      sections: [
        {
          ...work.sections[0],
          routes: {
            reader: {
              path: "/missing-reader",
              anchor: "rain-gauge-root",
            },
          },
          activeRouteNames: [],
        },
      ],
    })),
  );
  assert.equal(unresolvedAddress.valid, false);
  assert.ok(
    diagnosticCodes(unresolvedAddress).has(
      "content.address.base_route_unresolved",
    ),
    validationMessage(unresolvedAddress),
  );

  const assetRedirectCollision = compilePublicationContent(
    replacePublication(input, (publication) => ({
      ...publication,
      continuity: {
        redirects: [
          {
            from: input.assets[0].href,
            to: input.sourceGraph.works[0].manifest.route,
            status: 308,
          },
        ],
      },
    })),
  );
  assert.equal(assetRedirectCollision.valid, false);
  assert.ok(
    diagnosticCodes(assetRedirectCollision).has(
      "content.redirect.asset_source_collision",
    ),
    validationMessage(assetRedirectCollision),
  );

  const duplicateAddress = compilePublicationContent(
    replaceWork(input, "rain-gauge", (work) => {
      const root = work.sections[0];
      return {
        ...work,
        sections: [
          {
            ...root,
            routes: {
              reader: {
                path: input.sourceGraph.works[0].manifest.route,
                anchor: "same-anchor",
              },
            },
            activeRouteNames: [],
          },
          {
            id: "rain-gauge-afterword",
            role: "afterword",
            title: "Afterword",
            parentId: root.id,
            navigable: true,
            blocks: [],
            routes: {
              reader: {
                path: input.sourceGraph.works[0].manifest.route,
                anchor: "same-anchor",
              },
            },
            activeRouteNames: [],
          },
        ],
      };
    }),
  );
  assert.equal(duplicateAddress.valid, false);
  assert.ok(
    diagnosticCodes(duplicateAddress).has("content.address.collision"),
    validationMessage(duplicateAddress),
  );
});

test("shared assets remain inside the attested shared asset root", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const sourcePath = "publication/assets/shared-note.txt";
  const contents = "Shared publication asset.\n";
  const shared = {
    ...input,
    sources: [
      ...input.sources,
      {
        path: sourcePath,
        role: "asset",
        mediaType: "text/plain",
        contents,
        rawBytes: textBytes(contents),
      },
    ],
    assets: [
      ...input.assets,
      {
        id: "shared-note",
        sourcePath,
        href: "/assets/shared-note.txt",
        mediaType: "text/plain",
      },
    ],
  };
  const envelope = compile(shared);
  assert.equal(
    envelope.sourceAuthority.sharedAssetsRoot,
    "publication/assets",
  );

  const misplaced = compilePublicationContent({
    ...shared,
    sources: shared.sources.map((source) =>
      source.path === sourcePath
        ? {
            ...source,
            path: "publication/works/shared-note.txt",
          }
        : source,
    ),
    assets: shared.assets.map((asset) =>
      asset.id === "shared-note"
        ? {
            ...asset,
            sourcePath: "publication/works/shared-note.txt",
          }
        : asset,
    ),
  });
  assert.equal(misplaced.valid, false);
  assert.ok(
    diagnosticCodes(misplaced).has(
      "content.asset.source_outside_owner_root",
    ),
    validationMessage(misplaced),
  );
});

test("source-backed links retain exact occurrence spans", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const block = input.works[0].sections[0].blocks[0];
  const linked = {
    ...input,
    links: [
      {
        ...input.links[0],
        source: {
          kind: "source",
          workId: "rain-gauge",
          sectionId: "rain-gauge-root",
          blockId: block.id,
          occurrence: {
            sourcePath: block.provenance.sourcePath,
            startOffset: block.provenance.startOffset,
            endOffset: block.provenance.startOffset + 10,
          },
        },
      },
    ],
  };
  const envelope = compile(linked);
  const source = envelope.links[0].source;

  assert.equal(source.kind, "source");
  assert.equal(source.occurrence.start.offset, block.provenance.startOffset);
  assert.equal(
    source.occurrence.end.offset,
    block.provenance.startOffset + 10,
  );
});

test("semantic envelope validation rejects forged derived state", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const envelope = compile(input);
  const forged = structuredClone(envelope);
  const zeroHash = `sha256:${"0".repeat(64)}`;
  forged.works[0].sections[0].blocks[0].wordCount = 0;
  forged.works[0].sections[0].blocks[0].contentHash = zeroHash;
  forged.works[0].sections[0].contentHash = zeroHash;
  forged.works[0].contentHash = zeroHash;
  forged.hashes.sourceSet = zeroHash;
  forged.hashes.content = zeroHash;
  forged.buildId = zeroHash;

  assertValid(validateContentEnvelopeShape(forged));
  const validation = validatePublicationContentEnvelope(forged);
  assert.equal(validation.valid, false);
  assert.ok(
    diagnosticCodes(validation).has(
      "content.envelope.derived_value_mismatch",
    ),
    validationMessage(validation),
  );
  assert.throws(
    () => serializePublicationContentEnvelope(forged),
    /invalid content envelope/i,
  );

  const forgedReaderAddress = structuredClone(envelope);
  forgedReaderAddress.works[0].sections[0].readerAddress = { path: "/" };
  rehashWorkHierarchy(forgedReaderAddress, 0, 0, 0);
  const readerAddressValidation = validatePublicationContentEnvelope(
    forgedReaderAddress,
  );
  assert.equal(readerAddressValidation.valid, false);
  assert.ok(
    diagnosticCodes(readerAddressValidation).has(
      "content.envelope.reader_address_unowned",
    ),
    validationMessage(readerAddressValidation),
  );

  const missingReaderAddress = structuredClone(envelope);
  missingReaderAddress.works[0].sections[0].readerAddress = null;
  rehashWorkHierarchy(missingReaderAddress, 0, 0, 0);
  const missingReaderValidation = validatePublicationContentEnvelope(
    missingReaderAddress,
  );
  assert.equal(missingReaderValidation.valid, false);
  assert.ok(
    diagnosticCodes(missingReaderValidation).has(
      "content.envelope.reader_address_required",
    ),
    validationMessage(missingReaderValidation),
  );
});

test("semantic envelope validation binds source geometry and authority", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const envelope = compile(input);

  const emptyRawIdentity = structuredClone(envelope);
  const manuscriptSource = emptyRawIdentity.sources.find(
    ({ role }) => role === "manuscript",
  );
  assert.ok(manuscriptSource);
  manuscriptSource.rawByteLength = 0;
  rehashEnvelope(emptyRawIdentity);
  const emptyRawResult =
    validatePublicationContentEnvelope(emptyRawIdentity);
  assert.equal(emptyRawResult.valid, false);
  assert.ok(
    diagnosticCodes(emptyRawResult).has(
      "content.envelope.source_raw_length_invalid",
    ),
    validationMessage(emptyRawResult),
  );

  const impossibleEmptyGeometry = structuredClone(envelope);
  const impossibleEmptySource = impossibleEmptyGeometry.sources.find(
    ({ role }) => role === "publication-manifest",
  );
  assert.ok(impossibleEmptySource);
  impossibleEmptySource.normalizedCodeUnitLength = 0;
  impossibleEmptySource.normalizedLineStarts = [0];
  rehashEnvelope(impossibleEmptyGeometry);
  const impossibleEmptyResult = validatePublicationContentEnvelope(
    impossibleEmptyGeometry,
  );
  assert.equal(impossibleEmptyResult.valid, false);
  assert.ok(
    diagnosticCodes(impossibleEmptyResult).has(
      "content.envelope.source_text_geometry_invalid",
    ),
    validationMessage(impossibleEmptyResult),
  );

  const impossibleUtf8Geometry = structuredClone(envelope);
  const impossibleUtf8Source = impossibleUtf8Geometry.sources.find(
    ({ role }) => role === "publication-manifest",
  );
  assert.ok(impossibleUtf8Source);
  impossibleUtf8Source.normalizedCodeUnitLength = 1;
  impossibleUtf8Source.normalizedByteLength = 1000;
  impossibleUtf8Source.rawByteLength = 1000;
  impossibleUtf8Source.normalizedLineStarts = [0];
  rehashEnvelope(impossibleUtf8Geometry);
  const impossibleUtf8Result = validatePublicationContentEnvelope(
    impossibleUtf8Geometry,
  );
  assert.equal(impossibleUtf8Result.valid, false);
  assert.ok(
    diagnosticCodes(impossibleUtf8Result).has(
      "content.envelope.source_text_geometry_invalid",
    ),
    validationMessage(impossibleUtf8Result),
  );

  const impossibleLineByteGeometry = structuredClone(envelope);
  const impossibleLineByteSource =
    impossibleLineByteGeometry.sources.find(
      ({ role }) => role === "publication-manifest",
    );
  assert.ok(impossibleLineByteSource);
  impossibleLineByteSource.normalizedCodeUnitLength = 10;
  impossibleLineByteSource.normalizedByteLength = 30;
  impossibleLineByteSource.rawByteLength = 30;
  impossibleLineByteSource.normalizedLineStarts = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ];
  impossibleLineByteSource.normalizedHash =
    impossibleLineByteSource.rawHash;
  rehashEnvelope(impossibleLineByteGeometry);
  const impossibleLineByteResult =
    validatePublicationContentEnvelope(impossibleLineByteGeometry);
  assert.equal(impossibleLineByteResult.valid, false);
  assert.ok(
    diagnosticCodes(impossibleLineByteResult).has(
      "content.envelope.source_text_geometry_invalid",
    ),
    validationMessage(impossibleLineByteResult),
  );

  const impossibleEmptyHash = structuredClone(envelope);
  const impossibleEmptyHashSource = impossibleEmptyHash.sources.find(
    ({ role }) => role === "publication-manifest",
  );
  assert.ok(impossibleEmptyHashSource);
  impossibleEmptyHashSource.rawByteLength = 0;
  impossibleEmptyHashSource.normalizedByteLength = 0;
  impossibleEmptyHashSource.normalizedCodeUnitLength = 0;
  impossibleEmptyHashSource.normalizedLineStarts = [0];
  impossibleEmptyHashSource.rawHash = `sha256:${"0".repeat(64)}`;
  impossibleEmptyHashSource.normalizedHash =
    impossibleEmptyHashSource.rawHash;
  rehashEnvelope(impossibleEmptyHash);
  const impossibleEmptyHashResult =
    validatePublicationContentEnvelope(impossibleEmptyHash);
  assert.equal(impossibleEmptyHashResult.valid, false);
  assert.ok(
    diagnosticCodes(impossibleEmptyHashResult).has(
      "content.envelope.empty_source_hash_invalid",
    ),
    validationMessage(impossibleEmptyHashResult),
  );

  const impossibleNormalizationDelta = structuredClone(envelope);
  const impossibleDeltaSource =
    impossibleNormalizationDelta.sources.find(
      ({ role }) => role === "publication-manifest",
    );
  assert.ok(impossibleDeltaSource);
  const normalizedLineBreakCount =
    impossibleDeltaSource.normalizedLineStarts.length - 1;
  impossibleDeltaSource.rawByteLength =
    impossibleDeltaSource.normalizedByteLength +
    normalizedLineBreakCount +
    1;
  rehashEnvelope(impossibleNormalizationDelta);
  const impossibleDeltaResult = validatePublicationContentEnvelope(
    impossibleNormalizationDelta,
  );
  assert.equal(impossibleDeltaResult.valid, false);
  assert.ok(
    diagnosticCodes(impossibleDeltaResult).has(
      "content.envelope.source_raw_normalization_delta_invalid",
    ),
    validationMessage(impossibleDeltaResult),
  );

  const impossibleDistinctIdentity = structuredClone(envelope);
  const impossibleDistinctSource =
    impossibleDistinctIdentity.sources.find(
      ({ role }) => role === "publication-manifest",
    );
  assert.ok(impossibleDistinctSource);
  impossibleDistinctSource.normalizedLineStarts = [0];
  impossibleDistinctSource.normalizedHash =
    `sha256:${"0".repeat(64)}`;
  rehashEnvelope(impossibleDistinctIdentity);
  const impossibleDistinctResult =
    validatePublicationContentEnvelope(impossibleDistinctIdentity);
  assert.equal(impossibleDistinctResult.valid, false);
  assert.ok(
    diagnosticCodes(impossibleDistinctResult).has(
      "content.envelope.source_identity_without_normalization_invalid",
    ),
    validationMessage(impossibleDistinctResult),
  );

  const binaryManifest = structuredClone(envelope);
  const publicationSource = binaryManifest.sources.find(
    ({ role }) => role === "publication-manifest",
  );
  assert.ok(publicationSource);
  delete publicationSource.encoding;
  delete publicationSource.normalizedCodeUnitLength;
  delete publicationSource.normalizedLineStarts;
  publicationSource.kind = "binary";
  publicationSource.normalizedByteLength =
    publicationSource.rawByteLength;
  publicationSource.normalizedHash = publicationSource.rawHash;
  rehashEnvelope(binaryManifest);
  const binaryManifestResult =
    validatePublicationContentEnvelope(binaryManifest);
  assert.equal(binaryManifestResult.valid, false);
  assert.ok(
    diagnosticCodes(binaryManifestResult).has(
      "content.envelope.required_text_source_binary",
    ),
    validationMessage(binaryManifestResult),
  );

  const movedPublication = structuredClone(envelope);
  movedPublication.sourceAuthority.publicationManifestPath =
    "outside/publication-copy.json";
  const movedPublicationSource = movedPublication.sources.find(
    ({ role }) => role === "publication-manifest",
  );
  assert.ok(movedPublicationSource);
  movedPublicationSource.path = "outside/publication-copy.json";
  rehashEnvelope(movedPublication);
  const movedPublicationResult =
    validatePublicationContentEnvelope(movedPublication);
  assert.equal(movedPublicationResult.valid, false);
  assert.ok(
    movedPublicationResult.diagnostics.some(
      ({ path }) =>
        path === "/sourceAuthority/publicationManifestPath",
    ),
    validationMessage(movedPublicationResult),
  );

  const misplacedWorkAssets = structuredClone(envelope);
  misplacedWorkAssets.works[0].source.assetsPath =
    "outside/rain-gauge-assets";
  rehashEnvelope(misplacedWorkAssets);
  const misplacedWorkAssetsResult =
    validatePublicationContentEnvelope(misplacedWorkAssets);
  assert.equal(misplacedWorkAssetsResult.valid, false);
  assert.ok(
    diagnosticCodes(misplacedWorkAssetsResult).has(
      "content.envelope.work_assets_outside_source_roots",
    ),
    validationMessage(misplacedWorkAssetsResult),
  );

  const forgedLineGeometry = structuredClone(envelope);
  const block = forgedLineGeometry.works[0].sections[0].blocks[0];
  const replaceIndex = block.markdown.indexOf(" ");
  assert.notEqual(replaceIndex, -1);
  block.markdown =
    `${block.markdown.slice(0, replaceIndex)}\n` +
    block.markdown.slice(replaceIndex + 1);
  rehashWorkHierarchy(forgedLineGeometry, 0, 0, 0);
  const forgedLineGeometryResult =
    validatePublicationContentEnvelope(forgedLineGeometry);
  assert.equal(forgedLineGeometryResult.valid, false);
  assert.ok(
    diagnosticCodes(forgedLineGeometryResult).has(
      "content.envelope.source_span_line_geometry_mismatch",
    ),
    validationMessage(forgedLineGeometryResult),
  );
});

test("artifact serialization is canonical, valid, and self-consistent", async () => {
  const input = await loadCompilationInput("canonical-field-notes");
  const envelope = compile(input);
  const text = serializePublicationContentEnvelope(envelope);
  const artifact = createPublicationContentArtifact(envelope);

  assert.equal(text.endsWith("\n"), true);
  assert.equal(text.startsWith('{"$schema":'), true);
  assert.equal(artifact.text, text);
  assert.equal(artifact.hash, sha256(text));
  assert.equal(artifact.outputRoot, ".publisher");
  assert.equal(
    artifact.relativePath,
    "content/publication-content.json",
  );
  assert.deepEqual(JSON.parse(text), envelope);
  assertValid(validateContentEnvelopeShape(JSON.parse(text)));
});

test("hostile accessors fail closed without leaking thrown secrets", () => {
  const secret = "do-not-leak-this-secret";
  const hostile = {};
  Object.defineProperty(hostile, "engineVersion", {
    enumerable: true,
    get() {
      throw new Error(secret);
    },
  });

  for (const result of [
    compilePublicationContent(hostile),
    validatePublicationContentEnvelope(hostile),
  ]) {
    assert.equal(result.valid, false);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});
