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
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolvePublicationLayout,
  validateCollectionShape,
  validatePublicationSemantics,
  validatePublicationShape,
  validateReaderEnvelopeShape,
  validateWorkShape,
} from "../schemas/dist/index.js";
import {
  compileMarkdownWork,
  compilePublicationContent,
  hashCanonicalJson,
  sha256,
} from "../packages/content/dist/index.js";
import {
  createPublicationReaderArtifact,
  projectPublicationReader,
  serializePublicationReaderEnvelope,
  validatePublicationReaderEnvelope,
} from "../packages/reader/dist/index.js";
import {
  createPublicationReaderRuntime,
} from "../packages/reader/dist/runtime.js";

const repositoryRoot = new URL("../", import.meta.url);
const repositoryRootPath = fileURLToPath(repositoryRoot);
const textEncoder = new TextEncoder();
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;

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

async function readFixtureText(fixtureRoot, repositoryPath) {
  return readFile(
    await resolveFixtureFile(fixtureRoot, repositoryPath),
    "utf8",
  );
}

function manifestText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function loadCompilationInput(directory, options = {}) {
  const fixtureRoot = resolve(repositoryRootPath, "fixtures", directory);
  const rawPublication = JSON.parse(
    await readFixtureText(fixtureRoot, "publication.json"),
  );
  const publicationValue =
    options.transformPublication?.(structuredClone(rawPublication)) ??
    rawPublication;
  const publication = assertValid(
    validatePublicationShape(publicationValue),
  );
  const publicationText = manifestText(publicationValue);
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
    const rawManifest = JSON.parse(
      await readFixtureText(fixtureRoot, reference.manifestPath),
    );
    const manifestValue =
      options.transformWorkManifest?.(
        structuredClone(rawManifest),
      ) ?? rawManifest;
    const manifest = assertValid(validateWorkShape(manifestValue));
    const text = manifestText(manifestValue);
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
    const rawManifest = JSON.parse(
      await readFixtureText(fixtureRoot, reference.manifestPath),
    );
    const manifestValue =
      options.transformCollectionManifest?.(
        structuredClone(rawManifest),
      ) ?? rawManifest;
    const manifest = assertValid(
      validateCollectionShape(manifestValue),
    );
    const text = manifestText(manifestValue);
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
    const originalMarkdown = await readFixtureText(
      fixtureRoot,
      workSource.manuscriptPath,
    );
    const markdown =
      options.transformMarkdown?.(
        workSource.workId,
        originalMarkdown,
      ) ?? originalMarkdown;
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
    works.push(
      options.transformWorkContent?.(
        structuredClone(compiled.work),
        workSource,
      ) ?? compiled.work,
    );
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
    const contents = await readFixtureText(fixtureRoot, assetPath);
    input.sources.push({
      path: assetPath,
      role: "asset",
      entityId: "rain-gauge",
      mediaType: "text/plain; charset=utf-8",
      contents,
      rawBytes: textBytes(contents),
    });
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
          blockId: works[0].sections[0].blocks[0].id,
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

function rehashContentEnvelope(envelope) {
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

function project(input, audience) {
  return assertValid(
    projectPublicationReader(compile(input), { audience }),
  );
}

function readerContentHashTree(envelope) {
  return envelope.works.map((work) => ({
    id: work.id,
    contentHash: work.contentHash,
    sections: work.sections.map((section) => ({
      id: section.id,
      contentHash: section.contentHash,
      blocks: section.blocks.map((block) => ({
        id: block.id,
        contentHash: block.contentHash,
      })),
    })),
  }));
}

function rehashReaderEnvelope(envelope) {
  envelope.buildId = hashCanonicalJson({
    schemaVersion: envelope.schemaVersion,
    publicationId: envelope.publicationId,
    engineVersion: envelope.engineVersion,
    readerVersion: envelope.readerVersion,
    source: envelope.source,
    artifact: envelope.artifact,
    audience: envelope.audience,
    textProfile: envelope.textProfile,
    publication: envelope.publication,
    works: envelope.works,
    collections: envelope.collections,
    assets: envelope.assets,
    links: envelope.links,
    routes: envelope.routes,
    statistics: envelope.statistics,
  });
  return envelope;
}

function replaceWorkContent(input, workId, transform) {
  return {
    ...input,
    works: input.works.map((work) =>
      work.workId === workId ? transform(work) : work,
    ),
  };
}

function createCompositeWorkInput(input, sectionAnchors) {
  const composite = replaceWorkContent(
    input,
    "rain-gauge",
    (work) => {
    const root = work.sections[0];
    assert.ok(root);
    assert.ok(root.blocks.length >= sectionAnchors.length);
    return {
      ...work,
      sections: sectionAnchors.map((anchor, index) => {
        const id = `rain-gauge-part-${index + 1}`;
        return {
          id,
          role: "section",
          title: `Reading ${index + 1}`,
          routes: {
            reader: {
              path: input.sourceGraph.works[0].manifest.route,
              anchor,
            },
          },
          activeRouteNames: [],
          readerLocation: {
            kind: "route",
            routeName: "reader",
          },
          continuity: {
            id,
            legacyIds: [],
            progressGroups: [[id]],
            historicalSectionIds: [],
          },
          navigable: true,
          blocks: [root.blocks[index]],
        };
      }),
    };
    },
  );
  return {
    ...composite,
    links: (composite.links ?? []).map((link) =>
      link.source.workId === "rain-gauge"
        ? {
            ...link,
            source: {
              ...link.source,
              sectionId: "rain-gauge-part-1",
            },
          }
        : link,
    ),
  };
}

function addProjectedSectionRoute(
  envelope,
  sectionIndex,
  routeName,
  anchor,
) {
  const replacement = structuredClone(envelope);
  const section = replacement.works[0].sections[sectionIndex];
  assert.ok(section);
  assert.notEqual(section.readerAddress, null);
  section.routes[routeName] = {
    path: section.readerAddress.path,
    anchor,
  };
  return replacement;
}

function assertProjectionOmitsAuthoringState(envelope) {
  assert.equal(Object.hasOwn(envelope, "sourceAuthority"), false);
  assert.equal(Object.hasOwn(envelope, "sources"), false);
  assert.equal(Object.hasOwn(envelope, "extensions"), false);
  assert.equal(Object.hasOwn(envelope, "payloads"), false);
  for (const work of envelope.works) {
    assert.equal(Object.hasOwn(work, "source"), false);
    assert.equal(Object.hasOwn(work, "metadata"), false);
    for (const section of work.sections) {
      assert.equal(Object.hasOwn(section, "metadata"), false);
      for (const block of section.blocks) {
        assert.equal(Object.hasOwn(block, "metadata"), false);
        assert.equal(Object.hasOwn(block, "provenance"), false);
        assert.equal(Object.hasOwn(block, "anchor"), false);
      }
    }
  }
  for (const collection of envelope.collections) {
    assert.equal(Object.hasOwn(collection, "manifestPath"), false);
    assert.equal(Object.hasOwn(collection, "metadata"), false);
  }
  for (const asset of envelope.assets) {
    assert.equal(Object.hasOwn(asset, "sourcePath"), false);
    assert.equal(Object.hasOwn(asset, "metadata"), false);
  }
  for (const link of envelope.links) {
    assert.equal(Object.hasOwn(link, "metadata"), false);
  }
}

test("both fixture publications project into deterministic public reader artifacts", async () => {
  const cases = [
    {
      directory: "canonical-field-notes",
      publicationId: "rain-gauge-journal",
      workIds: ["rain-gauge"],
      collectionIds: ["weather-observations"],
      // Route targets now carry the stable Updates view identity. That changes
      // the Reader bytes and every identity derived from them, deliberately.
      buildId:
        "sha256:67206ed8deb83193076a6d113558a6c291fc015aa956342f890837223efba09c",
      byteLength: 6010,
      artifactHash:
        "sha256:bab751a20b34b5c1d909f3b0b5b560c647f14c3ffaa87bf2a2ac56e685f0d5bc",
    },
    {
      directory: "declared-night-dispatch",
      publicationId: "night-dispatch",
      workIds: ["signal-lantern", "platform-bell"],
      collectionIds: ["after-dark"],
      buildId:
        "sha256:9dec0414fcd327d0bee8cdc6a55fe651f174d8cf5c33e293ad0be31f9b1e6a6b",
      byteLength: 8746,
      artifactHash:
        "sha256:96c770607d7f0c47dc23647e9ea1a53fa540d5f860279bf9ec11990669b98099",
    },
  ];

  for (const fixture of cases) {
    const content = compile(
      await loadCompilationInput(fixture.directory),
    );
    assert.ok(content.extensions.length > 0);
    assert.ok(
      content.extensions.every(
        (extension) => extension.capabilities.length > 0,
      ),
    );
    const first = assertValid(
      projectPublicationReader(content, { audience: "public" }),
    );
    const second = assertValid(
      projectPublicationReader(content, { audience: "public" }),
    );
    const text = serializePublicationReaderEnvelope(first);
    const artifact = createPublicationReaderArtifact(first);

    assert.equal(first.publicationId, fixture.publicationId);
    assert.deepEqual(
      first.works.map(({ id }) => id),
      fixture.workIds,
    );
    assert.deepEqual(
      first.collections.map(({ id }) => id),
      fixture.collectionIds,
    );
    assert.deepEqual(first, second);
    assert.equal(first.buildId, fixture.buildId);
    assert.equal(
      textEncoder.encode(text).byteLength,
      fixture.byteLength,
    );
    assert.equal(artifact.hash, fixture.artifactHash);
    assert.equal(
      first.buildId,
      hashCanonicalJson({
        schemaVersion: first.schemaVersion,
        publicationId: first.publicationId,
        engineVersion: first.engineVersion,
        readerVersion: first.readerVersion,
        source: first.source,
        artifact: first.artifact,
        audience: first.audience,
        textProfile: first.textProfile,
        publication: first.publication,
        works: first.works,
        collections: first.collections,
        assets: first.assets,
        links: first.links,
        routes: first.routes,
        statistics: first.statistics,
      }),
    );
    assert.equal(text.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(text), first);
    assert.equal(artifact.text, text);
    assert.equal(artifact.hash, sha256(text));
    assert.deepEqual(artifact.envelope, first);
    assert.notEqual(artifact.envelope, first);
    assert.equal(Object.isFrozen(artifact), true);
    assert.equal(Object.isFrozen(artifact.envelope), true);
    assert.equal(
      artifact.relativePath,
      "reader/publication-reader.json",
    );
    assert.equal(
      artifact.mediaType,
      "application/vnd.genii.publisher.reader+json",
    );
    assert.deepEqual(first.source, {
      kind: "publication-content",
      schemaVersion: content.schemaVersion,
      publicationId: content.publicationId,
      engineVersion: content.engineVersion,
      compilerVersion: content.compilerVersion,
      buildId: content.buildId,
      contentHash: content.hashes.content,
    });
    assertProjectionOmitsAuthoringState(first);
    for (const forbidden of [
      "@example/margin-notes-extension",
      "@example/station-index-extension",
      "@example/sync-adapter",
      "content.project",
      "renderer.slot",
      "north-garden",
      "publication/works/",
      "archive/texts/",
    ]) {
      assert.equal(
        text.includes(forbidden),
        false,
        `${fixture.directory} leaked ${forbidden}`,
      );
    }
  }
});

test("reader projection remains valid when a publication declares no extensions", async () => {
  const input = await loadCompilationInput("canonical-field-notes", {
    transformPublication(publication) {
      delete publication.extensions;
      return publication;
    },
  });
  assert.deepEqual(input.extensions, []);

  const content = compile(input);
  assert.deepEqual(content.extensions, []);
  const reader = assertValid(
    projectPublicationReader(content, { audience: "public" }),
  );
  assertProjectionOmitsAuthoringState(reader);
});

test("serialization and artifacts use one detached validated snapshot under stateful input", async () => {
  const reader = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const expectedText =
    serializePublicationReaderEnvelope(reader);

  function createStatefulProxy(triggerAt) {
    const target = structuredClone(reader);
    const originalPublication = target.publication;
    const poisonedPublication = {
      ...originalPublication,
      title: "State changed after snapshot capture",
    };
    let publicationDescriptorReads = 0;
    let mutationObserved = false;
    const proxy = new Proxy(target, {
      getOwnPropertyDescriptor(current, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(
          current,
          key,
        );
        if (
          key === "publication" &&
          descriptor !== undefined &&
          "value" in descriptor
        ) {
          publicationDescriptorReads += 1;
          if (publicationDescriptorReads === triggerAt) {
            const capturedDescriptor = {
              ...descriptor,
              value: originalPublication,
            };
            current.publication = poisonedPublication;
            mutationObserved = true;
            return capturedDescriptor;
          }
        }
        return descriptor;
      },
    });
    return {
      proxy,
      target,
      get descriptorReads() {
        return publicationDescriptorReads;
      },
      get mutationObserved() {
        return mutationObserved;
      },
    };
  }

  const probe = createStatefulProxy(Number.POSITIVE_INFINITY);
  assertValid(validatePublicationReaderEnvelope(probe.proxy));
  assert.ok(probe.descriptorReads >= 1);

  const serializationInput = createStatefulProxy(
    probe.descriptorReads,
  );
  const serialized = serializePublicationReaderEnvelope(
    serializationInput.proxy,
  );
  assert.equal(serializationInput.mutationObserved, true);
  assert.equal(
    serializationInput.target.publication.title,
    "State changed after snapshot capture",
  );
  assert.equal(serialized, expectedText);

  const artifactInput = createStatefulProxy(
    probe.descriptorReads,
  );
  const artifact = createPublicationReaderArtifact(
    artifactInput.proxy,
  );
  assert.equal(artifactInput.mutationObserved, true);
  assert.equal(artifact.text, expectedText);
  assert.deepEqual(JSON.parse(artifact.text), artifact.envelope);
  assert.deepEqual(artifact.envelope, reader);
  assert.notEqual(artifact.envelope, artifactInput.target);

  const accessorInput = structuredClone(reader);
  const title = accessorInput.publication.title;
  Object.defineProperty(accessorInput.publication, "title", {
    enumerable: true,
    get() {
      return title;
    },
  });
  const accessorValidation =
    validatePublicationReaderEnvelope(accessorInput);
  assert.equal(accessorValidation.valid, false);
  assert.throws(
    () => serializePublicationReaderEnvelope(accessorInput),
    /invalid reader envelope/i,
  );
  assert.throws(
    () => createPublicationReaderArtifact(accessorInput),
    /invalid reader envelope/i,
  );
});

test("reader content hashes change only with public reading semantics", async () => {
  const baselineInput = await loadCompilationInput(
    "canonical-field-notes",
  );
  const baselineContent = compile(baselineInput);
  const baselineReader = assertValid(
    projectPublicationReader(baselineContent, {
      audience: "public",
    }),
  );
  const expectedHashTree = readerContentHashTree(baselineReader);

  const metadataContent = compile(
    await loadCompilationInput("canonical-field-notes", {
      transformWorkManifest(manifest) {
        return {
          ...manifest,
          metadata: {
            ...manifest.metadata,
            editorialMarker: "metadata-only-change",
          },
        };
      },
    }),
  );

  const metricInput = await loadCompilationInput(
    "canonical-field-notes",
  );
  const compiledWorkById = new Map(
    baselineContent.works.map((work) => [work.id, work]),
  );
  metricInput.works = metricInput.works.map((work) => {
    const compiledWork = compiledWorkById.get(work.workId);
    assert.ok(compiledWork);
    return {
      ...work,
      adapter: {
        ...work.adapter,
        version: "9.9.9",
      },
      metrics: {
        id: "test-reader-metrics",
        package: "@example/test-reader-metrics",
        version: "9.9.9",
        profileVersion: "2.0.0",
      },
      sections: work.sections.map((section) => {
        const compiledSection = compiledWork.sections.find(
          ({ id }) => id === section.id,
        );
        assert.ok(compiledSection);
        return {
          ...section,
          blocks: section.blocks.map((block) => {
            const compiledBlock = compiledSection.blocks.find(
              ({ id }) => id === block.id,
            );
            assert.ok(compiledBlock);
            return {
              ...block,
              wordCount: compiledBlock.wordCount,
            };
          }),
        };
      }),
    };
  });
  const metricContent = compile(metricInput);

  const relocatedContent = structuredClone(baselineContent);
  const relocatedWork = relocatedContent.works[0];
  const originalPath = relocatedWork.source.manuscriptPath;
  const relocatedPath =
    "publication/works/rain-gauge/relocated.md";
  relocatedWork.source.manuscriptPath = relocatedPath;
  for (const section of relocatedWork.sections) {
    for (const block of section.blocks) {
      assert.equal(block.provenance.sourcePath, originalPath);
      block.provenance.sourcePath = relocatedPath;
    }
  }
  const manuscriptSource = relocatedContent.sources.find(
    ({ path, role }) =>
      path === originalPath && role === "manuscript",
  );
  assert.ok(manuscriptSource);
  manuscriptSource.path = relocatedPath;
  relocatedContent.sources.sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  rehashContentEnvelope(relocatedContent);

  for (const [label, content] of [
    ["metadata", metadataContent],
    ["adapter and metric", metricContent],
    ["source location", relocatedContent],
  ]) {
    assert.notEqual(
      content.buildId,
      baselineContent.buildId,
      `${label} variant did not alter source content identity.`,
    );
    const reader = assertValid(
      projectPublicationReader(content, {
        audience: "public",
      }),
    );
    assert.deepEqual(
      readerContentHashTree(reader),
      expectedHashTree,
      `${label} leaked into public reader content hashes.`,
    );
  }

  const visibleContent = compile(
    await loadCompilationInput("canonical-field-notes", {
      transformMarkdown(workId, markdown) {
        assert.equal(workId, "rain-gauge");
        return markdown.replace("twelve", "thirteen");
      },
    }),
  );
  const visibleReader = assertValid(
    projectPublicationReader(visibleContent, {
      audience: "public",
    }),
  );
  const baselineWork = baselineReader.works[0];
  const visibleWork = visibleReader.works[0];
  const baselineSection = baselineWork.sections[0];
  const visibleSection = visibleWork.sections[0];
  const baselineBlock = baselineSection.blocks.find(({ markdown }) =>
    markdown.includes("twelve"),
  );
  const visibleBlock = visibleSection.blocks.find(({ markdown }) =>
    markdown.includes("thirteen"),
  );

  assert.ok(baselineBlock);
  assert.ok(visibleBlock);
  assert.notEqual(
    visibleBlock.contentHash,
    baselineBlock.contentHash,
  );
  assert.notEqual(
    visibleSection.contentHash,
    baselineSection.contentHash,
  );
  assert.notEqual(visibleWork.contentHash, baselineWork.contentHash);
});

test("public projection filters drafts while preview retains them and redirect ownership follows the audience", async () => {
  const input = await loadCompilationInput(
    "declared-night-dispatch",
    {
      transformWorkManifest(manifest) {
        return manifest.id === "platform-bell"
          ? { ...manifest, publicationState: "draft" }
          : manifest;
      },
      transformCollectionManifest(manifest) {
        const result = { ...manifest };
        delete result.publicationState;
        return result;
      },
    },
  );
  const signal = input.works.find(
    ({ workId }) => workId === "signal-lantern",
  );
  assert.ok(signal);
  input.links = [
    {
      id: "related-draft",
      source: {
        kind: "semantic",
        workId: "signal-lantern",
        sectionId: "signal-lantern-root",
        blockId: signal.sections[0].blocks[0].id,
      },
      target: {
        kind: "work",
        workId: "platform-bell",
      },
      href: "/dispatch/platform-bell",
      relation: "related",
    },
  ];
  const content = compile(input);
  const publicReader = assertValid(
    projectPublicationReader(content, { audience: "public" }),
  );
  const previewReader = assertValid(
    projectPublicationReader(content, { audience: "preview" }),
  );

  assert.deepEqual(
    publicReader.works.map(({ id }) => id),
    ["signal-lantern"],
  );
  assert.deepEqual(
    previewReader.works.map(({ id }) => id),
    ["signal-lantern", "platform-bell"],
  );
  assert.deepEqual(publicReader.collections, [
    {
      id: "after-dark",
      title: "After Dark",
      description:
        "Two brief records from the example station archive.",
      publicationState: "published",
      route: "/sequences/after-dark",
      workIds: ["signal-lantern"],
    },
  ]);
  assert.deepEqual(
    previewReader.collections[0].workIds,
    ["signal-lantern", "platform-bell"],
  );
  assert.deepEqual(publicReader.links, []);
  assert.deepEqual(
    previewReader.links.map(({ id }) => id),
    ["related-draft"],
  );
  assert.deepEqual(
    publicReader.routes.redirects.map(({ from }) => from),
    ["/stories/lantern"],
  );
  assert.deepEqual(
    previewReader.routes.redirects.map(({ from }) => from),
    ["/stories/lantern", "/platform"],
  );
  assert.equal(publicReader.statistics.workCount, 1);
  assert.equal(previewReader.statistics.workCount, 2);
});

test("projection snapshots one strict audience data property before filtering", async () => {
  const content = compile(
    await loadCompilationInput("declared-night-dispatch", {
      transformWorkManifest(manifest) {
        return manifest.id === "platform-bell"
          ? { ...manifest, publicationState: "draft" }
          : manifest;
      },
    }),
  );
  const assertInvalidAudience = (options) => {
    const result = projectPublicationReader(content, options);
    assert.equal(result.valid, false);
    assert.ok(
      diagnosticCodes(result).has("reader.audience.invalid"),
      validationMessage(result),
    );
  };

  let accessorReads = 0;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, "audience", {
    configurable: true,
    enumerable: true,
    get() {
      accessorReads += 1;
      return accessorReads % 2 === 1 ? "preview" : "public";
    },
  });
  assertInvalidAudience(accessorOptions);
  assert.equal(accessorReads, 0);

  const hiddenOptions = {};
  Object.defineProperty(hiddenOptions, "audience", {
    configurable: true,
    enumerable: false,
    value: "preview",
  });
  assertInvalidAudience(hiddenOptions);
  assertInvalidAudience(Object.create({ audience: "preview" }));
  assertInvalidAudience({
    audience: "preview",
    [Symbol("audience")]: "public",
  });

  const inconsistentOptions = new Proxy(
    { audience: "preview" },
    {
      has(target, key) {
        return key === "audience" ? false : Reflect.has(target, key);
      },
    },
  );
  assertInvalidAudience(inconsistentOptions);

  const trappedOptions = new Proxy(
    { audience: "preview" },
    {
      getOwnPropertyDescriptor(target, key) {
        if (key === "audience") {
          throw new Error("hostile audience descriptor");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  assertInvalidAudience(trappedOptions);

  let proxyReads = 0;
  let descriptorReads = 0;
  const statefulOptions = new Proxy(
    { audience: "preview" },
    {
      get(target, key, receiver) {
        if (key === "audience") {
          proxyReads += 1;
          return proxyReads % 2 === 1 ? "preview" : "public";
        }
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === "audience") {
          descriptorReads += 1;
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  const preview = assertValid(
    projectPublicationReader(content, statefulOptions),
  );
  assert.equal(preview.audience, "preview");
  assert.deepEqual(
    preview.works.map(({ id }) => id),
    ["signal-lantern", "platform-bell"],
  );
  assert.equal(proxyReads, 0);
  assert.equal(descriptorReads, 1);
});

test("a public collection defaults to published and may become empty after draft filtering", async () => {
  const input = await loadCompilationInput(
    "declared-night-dispatch",
    {
      transformWorkManifest(manifest) {
        return { ...manifest, publicationState: "draft" };
      },
      transformCollectionManifest(manifest) {
        const result = { ...manifest };
        delete result.publicationState;
        return result;
      },
    },
  );
  const reader = project(input, "public");

  assert.deepEqual(reader.works, []);
  assert.deepEqual(reader.collections, [
    {
      id: "after-dark",
      title: "After Dark",
      description:
        "Two brief records from the example station archive.",
      publicationState: "published",
      route: "/sequences/after-dark",
      workIds: [],
    },
  ]);
  assert.deepEqual(reader.assets, []);
  assert.deepEqual(reader.links, []);
  assert.deepEqual(reader.routes.redirects, []);
  assert.equal(reader.statistics.workCount, 0);
  assert.equal(reader.statistics.collectionCount, 1);
  assert.equal(reader.statistics.sectionCount, 0);
  assert.equal(reader.statistics.blockCount, 0);
  assert.equal(reader.statistics.wordCount, 0);
  assert.equal(reader.statistics.readingMinutes, 0);
});

test("an all-draft publication has a valid empty public content result", async () => {
  const input = await loadCompilationInput(
    "declared-night-dispatch",
    {
      transformWorkManifest(manifest) {
        return { ...manifest, publicationState: "draft" };
      },
      transformCollectionManifest(manifest) {
        return { ...manifest, publicationState: "draft" };
      },
    },
  );
  const reader = project(input, "public");

  assert.deepEqual(reader.works, []);
  assert.deepEqual(reader.collections, []);
  assert.deepEqual(reader.assets, []);
  assert.deepEqual(reader.links, []);
  assert.deepEqual(reader.routes.redirects, []);
  assert.deepEqual(
    reader.routes.active.map(({ target }) => target.kind),
    ["home", "updates"],
  );
  assert.deepEqual(reader.statistics, {
    workCount: 0,
    collectionCount: 0,
    sectionCount: 0,
    blockCount: 0,
    wordCount: 0,
    readingMinutes: 0,
    wordsPerMinute: 220,
  });
});

test("section and block reader addresses derive exact DOM identities on simple and composite pages", async () => {
  const simpleReader = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const simpleSection = simpleReader.works[0].sections[0];

  assert.deepEqual(simpleSection.readerAddress, {
    path: "/works/rain-gauge",
  });
  assert.equal(simpleSection.domId, null);
  for (const block of simpleSection.blocks) {
    assert.deepEqual(block.readerAddress, {
      path: "/works/rain-gauge",
      anchor: block.domId,
    });
    assert.match(block.domId, /^b-[a-f0-9]{64}(?:-\d+)?$/);
  }

  const compositeInput = createCompositeWorkInput(
    await loadCompilationInput("canonical-field-notes"),
    ["first", "second"],
  );
  const compositeReader = project(compositeInput, "public");
  const [first, second] = compositeReader.works[0].sections;

  assert.deepEqual(first.readerAddress, {
    path: "/works/rain-gauge",
    anchor: "first",
  });
  assert.equal(first.domId, "first");
  assert.deepEqual(first.blocks[0].readerAddress, {
    path: "/works/rain-gauge",
    anchor: `first-${first.blocks[0].domId.slice("first-".length)}`,
  });
  assert.equal(
    first.blocks[0].domId,
    `first-${compositeInput.works[0].sections[0].blocks[0].anchor}`,
  );
  assert.equal(second.domId, "second");
  assert.equal(
    second.blocks[0].domId,
    `second-${compositeInput.works[0].sections[1].blocks[0].anchor}`,
  );
});

test("qualified block addresses preserve the full 256 plus 256 content-ID boundary", async () => {
  const sectionAnchor = "s".repeat(256);
  const blockAnchor = "b".repeat(256);
  const input = createCompositeWorkInput(
    await loadCompilationInput("canonical-field-notes"),
    [sectionAnchor],
  );
  input.works[0].sections[0].blocks[0] = {
    ...input.works[0].sections[0].blocks[0],
    anchor: blockAnchor,
  };

  const reader = project(input, "public");
  const section = reader.works[0].sections[0];
  const block = section.blocks[0];
  const compositeAnchor =
    `${sectionAnchor}-${blockAnchor}`;

  assert.equal(section.readerAddress.anchor.length, 256);
  assert.equal(section.domId.length, 256);
  assert.equal(compositeAnchor.length, 513);
  assert.equal(block.readerAddress.anchor, compositeAnchor);
  assert.equal(block.domId, compositeAnchor);
  assertValid(validateReaderEnvelopeShape(reader));
  assertValid(validatePublicationReaderEnvelope(reader));
  assertValid(createPublicationReaderRuntime(reader));
});

test("reader shape rejects overlong or malformed section and composite block identities", async () => {
  const sectionAnchor = "s".repeat(256);
  const blockAnchor = "b".repeat(256);
  const input = createCompositeWorkInput(
    await loadCompilationInput("canonical-field-notes"),
    [sectionAnchor],
  );
  input.works[0].sections[0].blocks[0] = {
    ...input.works[0].sections[0].blocks[0],
    anchor: blockAnchor,
  };
  const reader = project(input, "public");
  const compositeAnchor =
    reader.works[0].sections[0].blocks[0].domId;
  assert.equal(compositeAnchor.length, 513);

  const cases = [
    {
      label: "overlong section address",
      path: "/works/0/sections/0/readerAddress/anchor",
      mutate(value) {
        value.works[0].sections[0].readerAddress.anchor =
          "s".repeat(257);
      },
    },
    {
      label: "overlong section DOM ID",
      path: "/works/0/sections/0/domId",
      mutate(value) {
        value.works[0].sections[0].domId = "s".repeat(257);
      },
    },
    {
      label: "overlong block address",
      path: "/works/0/sections/0/blocks/0/readerAddress/anchor",
      mutate(value) {
        value.works[0].sections[0].blocks[0].readerAddress.anchor =
          `${compositeAnchor}b`;
      },
    },
    {
      label: "overlong block DOM ID",
      path: "/works/0/sections/0/blocks/0/domId",
      mutate(value) {
        value.works[0].sections[0].blocks[0].domId =
          `${compositeAnchor}b`;
      },
    },
    {
      label: "malformed block address",
      path: "/works/0/sections/0/blocks/0/readerAddress/anchor",
      mutate(value) {
        value.works[0].sections[0].blocks[0].readerAddress.anchor =
          `${sectionAnchor}--${blockAnchor}`;
      },
    },
    {
      label: "malformed block DOM ID",
      path: "/works/0/sections/0/blocks/0/domId",
      mutate(value) {
        value.works[0].sections[0].blocks[0].domId =
          `${sectionAnchor}+${blockAnchor}`;
      },
    },
    {
      label: "missing block address anchor",
      path: "/works/0/sections/0/blocks/0/readerAddress/anchor",
      mutate(value) {
        delete value.works[0].sections[0].blocks[0].readerAddress
          .anchor;
      },
    },
  ];

  for (const shapeCase of cases) {
    const candidate = structuredClone(reader);
    shapeCase.mutate(candidate);
    const result = validateReaderEnvelopeShape(candidate);
    assert.equal(
      result.valid,
      false,
      `${shapeCase.label} unexpectedly passed shape validation.`,
    );
    assert.ok(
      result.diagnostics.some(
        ({ path }) => path === shapeCase.path,
      ),
      `${shapeCase.label}: ${validationMessage(result)}`,
    );
  }
});

test("runtime rejects a qualified-length block identity on an unanchored section", async () => {
  const reader = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const forged = structuredClone(reader);
  const unqualifiedAnchor = "b".repeat(513);
  const block = forged.works[0].sections[0].blocks[0];
  assert.equal(
    forged.works[0].sections[0].readerAddress.anchor,
    undefined,
  );
  block.readerAddress.anchor = unqualifiedAnchor;
  block.domId = unqualifiedAnchor;
  assertValid(validateReaderEnvelopeShape(forged));

  const result = createPublicationReaderRuntime(forged);
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code, path }) =>
        code === "reader.runtime.block_reader_anchor_invalid" &&
        path ===
          "/works/0/sections/0/blocks/0/readerAddress/anchor",
    ),
    validationMessage(result),
  );
});

test("runtime rejects a cross-owner unanchored section address", async () => {
  const reader = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const forged = structuredClone(reader);
  forged.works[0].sections[0].routes.foreign = { path: "/" };
  assertValid(validateReaderEnvelopeShape(forged));

  const result = createPublicationReaderRuntime(forged);
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code, path }) =>
        code ===
          "reader.runtime.unanchored_address_owner_mismatch" &&
        path === "/works/0/sections/0/routes/foreign",
    ),
    validationMessage(result),
  );
});

test("source-backed links become exact block-local UTF-16 Markdown ranges", async () => {
  const input = await loadCompilationInput(
    "canonical-field-notes",
    {
      transformMarkdown(workId, markdown) {
        assert.equal(workId, "rain-gauge");
        return markdown.replace("At seven", "At 🧭 seven");
      },
    },
  );
  const work = input.works[0];
  const section = work.sections[0];
  const block = section.blocks.find(({ markdown }) =>
    markdown.includes("twelve"),
  );
  assert.ok(block);
  const start = block.markdown.indexOf("twelve");
  const end = start + "twelve".length;
  assert.equal(block.markdown.indexOf("🧭") < start, true);
  assert.equal("🧭".length, 2);
  input.links = [
    {
      id: "embedded-gauge-link",
      source: {
        kind: "source",
        workId: work.workId,
        sectionId: section.id,
        blockId: block.id,
        occurrence: {
          sourcePath: block.provenance.sourcePath,
          startOffset: block.provenance.startOffset + start,
          endOffset: block.provenance.startOffset + end,
        },
      },
      target: {
        kind: "asset",
        assetId: "gauge-scale",
      },
      href: "/assets/gauge-scale.txt",
      label: "twelve",
    },
  ];

  const reader = project(input, "public");
  const link = reader.links[0];
  const readerBlock = reader.works[0].sections[0].blocks.find(
    ({ id }) => id === block.id,
  );

  assert.ok(readerBlock);
  assert.deepEqual(link.source, {
    kind: "block-markdown",
    workId: "rain-gauge",
    sectionId: "rain-gauge-root",
    blockId: block.id,
    range: { start, end },
  });
  assert.equal(
    readerBlock.markdown.slice(
      link.source.range.start,
      link.source.range.end,
    ),
    "twelve",
  );
  assert.deepEqual(reader.textProfile, {
    id: "genii-reader-block-markdown",
    version: "1.0",
    representation: "markdown",
    normalization: "none",
    offsetUnit: "utf-16-code-unit",
    rangeScope: "block",
    endBoundary: "exclusive",
  });
});

test("the browser runtime rejects invalid block-Markdown UTF-16 ranges", async () => {
  const input = await loadCompilationInput(
    "canonical-field-notes",
    {
      transformMarkdown(workId, markdown) {
        assert.equal(workId, "rain-gauge");
        return markdown.replace("At seven", "At 🧭 seven");
      },
    },
  );
  const work = input.works[0];
  const section = work.sections[0];
  const block = section.blocks.find(({ markdown }) =>
    markdown.includes("twelve"),
  );
  assert.ok(block);
  const linkStart = block.markdown.indexOf("twelve");
  const emojiStart = block.markdown.indexOf("🧭");
  assert.notEqual(linkStart, -1);
  assert.notEqual(emojiStart, -1);
  input.links = [
    {
      id: "embedded-gauge-link",
      source: {
        kind: "source",
        workId: work.workId,
        sectionId: section.id,
        blockId: block.id,
        occurrence: {
          sourcePath: block.provenance.sourcePath,
          startOffset: block.provenance.startOffset + linkStart,
          endOffset:
            block.provenance.startOffset +
            linkStart +
            "twelve".length,
        },
      },
      target: {
        kind: "asset",
        assetId: "gauge-scale",
      },
      href: "/assets/gauge-scale.txt",
      label: "twelve",
    },
  ];

  const reader = project(input, "public");
  const readerBlock = reader.works[0].sections[0].blocks.find(
    ({ id }) => id === block.id,
  );
  assert.ok(readerBlock);
  const cases = [
    {
      name: "empty",
      range: { start: linkStart, end: linkStart },
    },
    {
      name: "past the block",
      range: {
        start: linkStart,
        end: readerBlock.markdown.length + 1,
      },
    },
    {
      name: "start splits a surrogate pair",
      range: {
        start: emojiStart + 1,
        end: emojiStart + "🧭".length,
      },
    },
    {
      name: "end splits a surrogate pair",
      range: {
        start: emojiStart,
        end: emojiStart + 1,
      },
    },
  ];

  for (const rangeCase of cases) {
    const forged = structuredClone(reader);
    forged.links[0].source.range = rangeCase.range;
    assertValid(validateReaderEnvelopeShape(forged));

    const result = createPublicationReaderRuntime(forged);
    assert.equal(
      result.valid,
      false,
      `${rangeCase.name}: ${validationMessage(result)}`,
    );
    assert.ok(
      result.diagnostics.some(
        ({ code, path }) =>
          code === "reader.runtime.link_markdown_range_invalid" &&
          path === "/links/0/source/range",
      ),
      `${rangeCase.name}: ${validationMessage(result)}`,
    );
  }
});

test("an embedded link to excluded content fails closed while a semantic link is omitted", async () => {
  const createInput = () =>
    loadCompilationInput("declared-night-dispatch", {
      transformWorkManifest(manifest) {
        return manifest.id === "platform-bell"
          ? { ...manifest, publicationState: "draft" }
          : manifest;
      },
    });

  const semanticInput = await createInput();
  const signal = semanticInput.works.find(
    ({ workId }) => workId === "signal-lantern",
  );
  assert.ok(signal);
  const block = signal.sections[0].blocks[0];
  semanticInput.links = [
    {
      id: "semantic-draft-link",
      source: {
        kind: "semantic",
        workId: signal.workId,
        sectionId: signal.sections[0].id,
        blockId: block.id,
      },
      target: {
        kind: "work",
        workId: "platform-bell",
      },
      href: "/dispatch/platform-bell",
    },
  ];
  const semanticReader = project(semanticInput, "public");
  assert.deepEqual(semanticReader.links, []);

  const embeddedInput = await createInput();
  const embeddedSignal = embeddedInput.works.find(
    ({ workId }) => workId === "signal-lantern",
  );
  assert.ok(embeddedSignal);
  const embeddedBlock = embeddedSignal.sections[0].blocks[0];
  embeddedInput.links = [
    {
      id: "embedded-draft-link",
      source: {
        kind: "source",
        workId: embeddedSignal.workId,
        sectionId: embeddedSignal.sections[0].id,
        blockId: embeddedBlock.id,
        occurrence: {
          sourcePath: embeddedBlock.provenance.sourcePath,
          startOffset: embeddedBlock.provenance.startOffset,
          endOffset: embeddedBlock.provenance.startOffset + 1,
        },
      },
      target: {
        kind: "work",
        workId: "platform-bell",
      },
      href: "/dispatch/platform-bell",
    },
  ];
  const embeddedContent = compile(embeddedInput);
  const result = projectPublicationReader(embeddedContent, {
    audience: "public",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    [...diagnosticCodes(result)],
    ["reader.link.target_excluded"],
  );
  assert.equal(result.diagnostics[0].path, "/links/0/target");
});

test("the browser runtime rejects malformed absolute HTTP hosts at every public URL boundary", async () => {
  const reader = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const malformedUrl = "https://.";
  const cases = [
    {
      name: "publication canonical URL",
      paths: ["/publication/canonicalUrl"],
      mutate(value) {
        value.publication.canonicalUrl = malformedUrl;
      },
    },
    {
      name: "publisher URL",
      paths: ["/publication/publisher/url"],
      mutate(value) {
        value.publication.publisher.url = malformedUrl;
      },
    },
    {
      name: "attribution source URL",
      paths: ["/publication/attribution/sourceCodeUrl"],
      mutate(value) {
        value.publication.attribution.sourceCodeUrl = malformedUrl;
      },
    },
    {
      name: "external link target and resolved href",
      paths: ["/links/0/target/url", "/links/0/href"],
      mutate(value) {
        value.links[0].target = {
          kind: "external",
          url: malformedUrl,
        };
        value.links[0].href = malformedUrl;
      },
    },
    {
      name: "external redirect",
      paths: ["/routes/redirects/0/to"],
      mutate(value) {
        value.routes.redirects[0].to = malformedUrl;
      },
    },
  ];

  for (const urlCase of cases) {
    const forged = structuredClone(reader);
    urlCase.mutate(forged);
    assertValid(validateReaderEnvelopeShape(forged));

    const result = createPublicationReaderRuntime(forged);
    assert.equal(
      result.valid,
      false,
      `${urlCase.name}: ${validationMessage(result)}`,
    );
    for (const path of urlCase.paths) {
      assert.ok(
        result.diagnostics.some(
          ({ code, params, path: diagnosticPath }) =>
            code === "reader.runtime.absolute_http_url_invalid" &&
            diagnosticPath === path &&
            params.issue === "host",
        ),
        `${urlCase.name}: ${validationMessage(result)}`,
      );
    }
  }
});

test("reader URL shapes reject embedded credentials before runtime indexing", async () => {
  const reader = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const malformedUrl = "https://reader:secret@example.com";
  const cases = [
    (value) => {
      value.publication.canonicalUrl = malformedUrl;
    },
    (value) => {
      value.publication.publisher.url = malformedUrl;
    },
    (value) => {
      value.publication.attribution.sourceCodeUrl = malformedUrl;
    },
    (value) => {
      value.links[0].target = {
        kind: "external",
        url: malformedUrl,
      };
      value.links[0].href = malformedUrl;
    },
    (value) => {
      value.routes.redirects[0].to = malformedUrl;
    },
  ];

  for (const mutate of cases) {
    const forged = structuredClone(reader);
    mutate(forged);
    assert.equal(validateReaderEnvelopeShape(forged).valid, false);
    assert.equal(createPublicationReaderRuntime(forged).valid, false);
  }
});

test("Node validation rejects a forged reader build identity even though the browser runtime does not hash", async () => {
  const reader = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const forged = structuredClone(reader);
  forged.buildId = ZERO_DIGEST;

  const runtimeResult = createPublicationReaderRuntime(forged);
  assert.equal(
    runtimeResult.valid,
    true,
    validationMessage(runtimeResult),
  );

  const validation = validatePublicationReaderEnvelope(forged);
  assert.equal(validation.valid, false);
  assert.ok(
    diagnosticCodes(validation).has(
      "reader.envelope.build_id_mismatch",
    ),
    validationMessage(validation),
  );
  assert.throws(
    () => serializePublicationReaderEnvelope(forged),
    /invalid reader envelope/i,
  );
});

test("Node validation rejects forged block, section, and work public content hashes", async () => {
  const reader = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const cases = [
    {
      code: "reader.block.content_hash_mismatch",
      mutate(value) {
        value.works[0].sections[0].blocks[0].contentHash =
          ZERO_DIGEST;
      },
    },
    {
      code: "reader.section.content_hash_mismatch",
      mutate(value) {
        value.works[0].sections[0].contentHash = ZERO_DIGEST;
      },
    },
    {
      code: "reader.work.content_hash_mismatch",
      mutate(value) {
        value.works[0].contentHash = ZERO_DIGEST;
      },
    },
  ];

  for (const hashCase of cases) {
    const forged = structuredClone(reader);
    hashCase.mutate(forged);
    rehashReaderEnvelope(forged);
    assertValid(createPublicationReaderRuntime(forged));
    const result = validatePublicationReaderEnvelope(forged);
    assert.equal(result.valid, false);
    assert.ok(
      diagnosticCodes(result).has(hashCase.code),
      validationMessage(result),
    );
    assert.equal(
      diagnosticCodes(result).has(
        "reader.envelope.build_id_mismatch",
      ),
      false,
      validationMessage(result),
    );
  }
});

test("the browser runtime performs scoped lookups without first-match fallbacks", async () => {
  const input = createCompositeWorkInput(
    await loadCompilationInput("canonical-field-notes"),
    ["a-b", "second"],
  );
  input.works[0].sections[0].continuity.legacyIds.push(
    "legacy-first",
  );
  input.works[0].sections[0].continuity.progressGroups[0].push(
    "legacy-first",
  );
  const reader = project(input, "public");
  const runtime = assertValid(
    createPublicationReaderRuntime(reader),
  );
  const work = reader.works[0];
  const first = work.sections[0];
  const second = work.sections[1];
  const firstBlock = first.blocks[0];

  assert.deepEqual(runtime.lookupWork(work.id), {
    status: "found",
    value: work,
  });
  assert.deepEqual(runtime.lookupWork("missing-work"), {
    status: "not-found",
  });
  assert.deepEqual(runtime.lookupWork(""), {
    status: "invalid",
    reason: "reference",
  });
  assert.deepEqual(
    runtime.lookupSection({
      workId: work.id,
      sectionId: first.id,
    }),
    {
      status: "found",
      value: { work, section: first },
    },
  );
  assert.deepEqual(
    runtime.lookupSection({
      workId: "missing-work",
      sectionId: first.id,
    }),
    { status: "not-found" },
  );
  assert.deepEqual(
    runtime.lookupSection({
      workId: work.id,
      sectionId: "missing-section",
    }),
    { status: "not-found" },
  );
  assert.deepEqual(
    runtime.lookupSection({
      workId: "",
      sectionId: first.id,
    }),
    { status: "invalid", reason: "reference" },
  );
  assert.deepEqual(
    runtime.lookupBlock({
      workId: work.id,
      sectionId: first.id,
      blockId: firstBlock.id,
    }),
    {
      status: "found",
      value: { work, section: first, block: firstBlock },
    },
  );
  assert.deepEqual(
    runtime.lookupBlock({
      workId: work.id,
      sectionId: second.id,
      blockId: firstBlock.id,
    }),
    { status: "not-found" },
    "A block lookup must remain scoped to the requested section.",
  );
  assert.deepEqual(runtime.lookupContinuityOwner(first.id), {
    status: "found",
    value: { work, section: first },
  });
  assert.deepEqual(
    runtime.lookupContinuityOwner("legacy-first"),
    {
      status: "found",
      value: { work, section: first },
    },
  );
  assert.deepEqual(
    runtime.lookupContinuityOwner("missing-continuity"),
    { status: "not-found" },
  );
  assert.deepEqual(runtime.lookupCollection(""), {
    status: "invalid",
    reason: "reference",
  });
});

test("address resolution validates the path and decodes the browser fragment exactly once", async () => {
  const projected = project(
    createCompositeWorkInput(
      await loadCompilationInput("canonical-field-notes"),
      ["a-b", "second"],
    ),
    "public",
  );
  const literalFirst = addProjectedSectionRoute(
    addProjectedSectionRoute(
      projected,
      0,
      "browser-plus-literal",
      "a+b",
    ),
    0,
    "browser-plus-encoded",
    "a%2Bb",
  );
  const encodedFirst = addProjectedSectionRoute(
    addProjectedSectionRoute(
      projected,
      0,
      "browser-plus-encoded",
      "a%2Bb",
    ),
    0,
    "browser-plus-literal",
    "a+b",
  );
  assert.deepEqual(
    Object.keys(literalFirst.works[0].sections[0].routes).slice(-2),
    ["browser-plus-literal", "browser-plus-encoded"],
  );
  assert.deepEqual(
    Object.keys(encodedFirst.works[0].sections[0].routes).slice(-2),
    ["browser-plus-encoded", "browser-plus-literal"],
  );
  for (const candidate of [literalFirst, encodedFirst]) {
    const candidateRuntime = assertValid(
      createPublicationReaderRuntime(candidate),
    );
    for (const anchor of ["a+b", "a%2Bb"]) {
      const resolution = candidateRuntime.resolveAddress({
        path: candidate.works[0].route,
        anchor,
      });
      assert.equal(resolution.status, "resolved");
      assert.deepEqual(resolution.content.matchedAddress, {
        path: candidate.works[0].route,
        anchor,
      });
      assert.equal(
        resolution.content.match.section.id,
        candidate.works[0].sections[0].id,
      );
    }
  }

  const reader = literalFirst;
  const runtime = assertValid(
    createPublicationReaderRuntime(reader),
  );
  const work = reader.works[0];
  const section = work.sections[0];
  const block = section.blocks[0];
  assert.equal(section.readerAddress.anchor, "a-b");
  assert.deepEqual(section.routes["browser-plus-literal"], {
    path: work.route,
    anchor: "a+b",
  });
  const workRoute = reader.routes.active.find(
    ({ target }) => target.kind === "work",
  );
  assert.ok(workRoute);

  assert.deepEqual(
    runtime.resolveAddress({
      path: work.route,
      anchor: "a+b",
    }),
    {
      status: "resolved",
      requestedAddress: {
        path: work.route,
        anchor: "a+b",
      },
      route: workRoute,
      content: {
        kind: "section",
        match: { work, section },
        matchedAddress: {
          path: work.route,
          anchor: "a+b",
        },
      },
    },
  );
  assert.deepEqual(
    runtime.resolveAddress({
      path: work.route,
      anchor: "a%2Bb",
    }),
    {
      status: "resolved",
      requestedAddress: {
        path: work.route,
        anchor: "a%2Bb",
      },
      route: workRoute,
      content: {
        kind: "section",
        match: { work, section },
        matchedAddress: {
          path: work.route,
          anchor: "a%2Bb",
        },
      },
    },
    "Percent decoding must preserve + as data rather than form-space syntax.",
  );
  assert.deepEqual(
    runtime.resolveAddress(block.readerAddress),
    {
      status: "resolved",
      requestedAddress: block.readerAddress,
      route: workRoute,
      content: {
        kind: "block",
        match: { work, section, block },
        matchedAddress: block.readerAddress,
      },
    },
  );
  assert.deepEqual(runtime.resolveAddress({ path: work.route }), {
    status: "resolved",
    requestedAddress: { path: work.route },
    route: workRoute,
    content: null,
  });
  assert.deepEqual(
    runtime.resolveAddress({
      path: work.route,
      anchor: "unknown",
    }),
    {
      status: "not-found",
      requestedAddress: {
        path: work.route,
        anchor: "unknown",
      },
      baseRoute: workRoute,
    },
  );
  assert.deepEqual(
    runtime.resolveAddress({
      path: work.route,
      anchor: "a%252Bb",
    }),
    {
      status: "invalid",
      component: "anchor",
      issue: "character",
    },
    "A doubly encoded fragment must be rejected rather than decoded twice.",
  );
  assert.deepEqual(
    runtime.resolveAddress({ path: "/missing" }),
    {
      status: "not-found",
      requestedAddress: { path: "/missing" },
      baseRoute: null,
    },
  );

  for (const invalid of [
    {
      input: { path: "/bad path" },
      component: "path",
      issue: "whitespace",
    },
    {
      input: { path: work.route, anchor: "%" },
      component: "anchor",
      issue: "percent-encoding-syntax",
    },
    {
      input: {
        path: work.route,
        anchor: "a:~:text=forbidden",
      },
      component: "anchor",
      issue: "fragment-directive",
    },
  ]) {
    assert.deepEqual(runtime.resolveAddress(invalid.input), {
      status: "invalid",
      component: invalid.component,
      issue: invalid.issue,
    });
  }
});

test("runtime method arguments reject hidden, accessor, symbolic, inherited, and trapped properties", async () => {
  const reader = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const runtime = assertValid(
    createPublicationReaderRuntime(reader),
  );
  const work = reader.works[0];
  const section = work.sections[0];
  const block = section.blocks[0];

  for (const address of [
    { path: work.route },
    { path: work.route, anchor: undefined },
  ]) {
    const result = runtime.resolveAddress(address);
    assert.equal(result.status, "resolved");
    assert.deepEqual(result.requestedAddress, { path: work.route });
  }

  let getterReads = 0;
  const accessorAnchor = { path: work.route };
  Object.defineProperty(accessorAnchor, "anchor", {
    configurable: true,
    enumerable: true,
    get() {
      getterReads += 1;
      return section.domId;
    },
  });
  const hiddenAnchor = { path: work.route };
  Object.defineProperty(hiddenAnchor, "anchor", {
    configurable: true,
    enumerable: false,
    value: section.domId,
  });
  const inheritedAnchor = Object.create({ anchor: section.domId });
  Object.defineProperty(inheritedAnchor, "path", {
    configurable: true,
    enumerable: true,
    value: work.route,
  });
  const trappedAnchor = new Proxy(
    { path: work.route, anchor: section.domId },
    {
      getOwnPropertyDescriptor(target, key) {
        if (key === "anchor") {
          throw new Error("hostile anchor descriptor");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );
  const invalidDescriptorAnchor = new Proxy(
    { path: work.route, anchor: section.domId },
    {
      getOwnPropertyDescriptor(target, key) {
        if (key === "anchor") {
          return {
            configurable: true,
            enumerable: true,
            get() {
              return section.domId;
            },
            value: section.domId,
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    },
  );

  for (const address of [
    accessorAnchor,
    hiddenAnchor,
    inheritedAnchor,
    { path: work.route, anchor: Symbol("anchor") },
    trappedAnchor,
    invalidDescriptorAnchor,
  ]) {
    assert.deepEqual(runtime.resolveAddress(address), {
      status: "invalid",
      component: "anchor",
      issue: "type",
    });
  }
  assert.equal(getterReads, 0);

  const symbolicRecord = { path: work.route };
  symbolicRecord[Symbol("anchor")] = section.domId;
  assert.deepEqual(runtime.resolveAddress(symbolicRecord), {
    status: "invalid",
    component: "path",
    issue: "type",
  });

  const accessorSectionReference = {
    sectionId: section.id,
  };
  Object.defineProperty(accessorSectionReference, "workId", {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error("reference getter must not run");
    },
  });
  assert.deepEqual(runtime.lookupSection(accessorSectionReference), {
    status: "invalid",
    reason: "reference",
  });

  const hiddenBlockReference = {
    workId: work.id,
    sectionId: section.id,
  };
  Object.defineProperty(hiddenBlockReference, "blockId", {
    configurable: true,
    enumerable: false,
    value: block.id,
  });
  assert.deepEqual(runtime.lookupBlock(hiddenBlockReference), {
    status: "invalid",
    reason: "reference",
  });

  const trappedSectionReference = new Proxy(
    {
      workId: work.id,
      sectionId: section.id,
    },
    {
      ownKeys() {
        throw new Error("hostile reference keys");
      },
    },
  );
  assert.deepEqual(
    runtime.sectionNavigation(trappedSectionReference),
    { status: "invalid-reference" },
  );
  assert.deepEqual(
    runtime.collectionWorkNavigation({
      collectionId: reader.collections[0].id,
      workId: Symbol("work"),
    }),
    { status: "invalid-reference" },
  );

  const relocationQuery = {
    contentHash: block.contentHash,
  };
  Object.defineProperty(relocationQuery, "scope", {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error("scope getter must not run");
    },
  });
  assert.deepEqual(runtime.findBlockRelocations(relocationQuery), {
    status: "invalid",
    reason: "scope",
  });

  const shiftingRecord = (values, ownKeySequence) => {
    let ownKeysCall = 0;
    return new Proxy(
      {},
      {
        ownKeys() {
          const key =
            ownKeySequence[
              Math.min(ownKeysCall, ownKeySequence.length - 1)
            ];
          ownKeysCall += 1;
          return key === undefined ? [] : [key];
        },
        getOwnPropertyDescriptor(_target, key) {
          if (!Object.hasOwn(values, key)) {
            return undefined;
          }
          return {
            configurable: true,
            enumerable: true,
            value: values[key],
            writable: true,
          };
        },
        has(_target, key) {
          return Object.hasOwn(values, key);
        },
      },
    );
  };

  assert.deepEqual(
    runtime.resolveAddress(
      shiftingRecord(
        {
          path: work.route,
          anchor: block.readerAddress.anchor,
        },
        ["path", "anchor"],
      ),
    ),
    {
      status: "invalid",
      component: "anchor",
      issue: "type",
    },
  );
  assert.deepEqual(
    runtime.lookupSection(
      shiftingRecord(
        { workId: work.id, sectionId: section.id },
        ["workId", "sectionId"],
      ),
    ),
    { status: "invalid", reason: "reference" },
  );
  assert.deepEqual(
    runtime.lookupBlock(
      shiftingRecord(
        {
          workId: work.id,
          sectionId: section.id,
          blockId: block.id,
        },
        ["workId", "sectionId", "blockId"],
      ),
    ),
    { status: "invalid", reason: "reference" },
  );
  assert.deepEqual(
    runtime.collectionWorkNavigation(
      shiftingRecord(
        {
          collectionId: reader.collections[0].id,
          workId: work.id,
        },
        ["collectionId", "workId"],
      ),
    ),
    { status: "invalid-reference" },
  );
  assert.deepEqual(
    runtime.findBlockRelocations(
      shiftingRecord(
        {
          contentHash: block.contentHash,
          scope: { kind: "publication" },
        },
        ["contentHash", "scope"],
      ),
    ),
    { status: "invalid", reason: "scope" },
  );
  assert.deepEqual(
    runtime.findBlockRelocations({
      contentHash: block.contentHash,
      scope: shiftingRecord(
        { kind: "work", workId: work.id },
        ["kind", "workId"],
      ),
    }),
    { status: "invalid", reason: "scope" },
  );
});

test("runtime navigation stays within the work or explicit collection context", async () => {
  const compositeReader = project(
    createCompositeWorkInput(
      await loadCompilationInput("canonical-field-notes"),
      ["first", "second"],
    ),
    "public",
  );
  const compositeRuntime = assertValid(
    createPublicationReaderRuntime(compositeReader),
  );
  const work = compositeReader.works[0];
  const [first, second] = work.sections;

  assert.deepEqual(
    compositeRuntime.sectionNavigation({
      workId: work.id,
      sectionId: first.id,
    }),
    {
      status: "resolved",
      current: { work, section: first },
      previous: null,
      next: { work, section: second },
    },
  );
  assert.deepEqual(
    compositeRuntime.sectionNavigation({
      workId: work.id,
      sectionId: second.id,
    }),
    {
      status: "resolved",
      current: { work, section: second },
      previous: { work, section: first },
      next: null,
    },
  );
  assert.deepEqual(
    compositeRuntime.sectionNavigation({
      workId: work.id,
      sectionId: "missing-section",
    }),
    { status: "not-found" },
  );
  assert.deepEqual(
    compositeRuntime.sectionNavigation({
      workId: "",
      sectionId: first.id,
    }),
    { status: "invalid-reference" },
  );

  const notNavigableInput = createCompositeWorkInput(
    await loadCompilationInput("canonical-field-notes"),
    ["first", "second"],
  );
  notNavigableInput.works[0].sections[0].navigable = false;
  const notNavigableReader = project(
    notNavigableInput,
    "public",
  );
  const notNavigableRuntime = assertValid(
    createPublicationReaderRuntime(notNavigableReader),
  );
  assert.deepEqual(
    notNavigableRuntime.sectionNavigation({
      workId: notNavigableReader.works[0].id,
      sectionId: notNavigableReader.works[0].sections[0].id,
    }),
    { status: "not-navigable" },
  );

  const collectionReader = project(
    await loadCompilationInput("declared-night-dispatch"),
    "public",
  );
  const collectionRuntime = assertValid(
    createPublicationReaderRuntime(collectionReader),
  );
  const collection = collectionReader.collections[0];
  const [signal, platform] = collectionReader.works;

  assert.deepEqual(
    collectionRuntime.lookupCollection(collection.id),
    { status: "found", value: collection },
  );
  assert.deepEqual(
    collectionRuntime.lookupCollection("missing-collection"),
    { status: "not-found" },
  );
  assert.deepEqual(
    collectionRuntime.collectionWorkNavigation({
      collectionId: collection.id,
      workId: signal.id,
    }),
    {
      status: "resolved",
      collection,
      current: signal,
      previous: null,
      next: platform,
    },
  );
  assert.deepEqual(
    collectionRuntime.collectionWorkNavigation({
      collectionId: collection.id,
      workId: platform.id,
    }),
    {
      status: "resolved",
      collection,
      current: platform,
      previous: signal,
      next: null,
    },
  );
  assert.deepEqual(
    collectionRuntime.collectionWorkNavigation({
      collectionId: "missing-collection",
      workId: signal.id,
    }),
    { status: "collection-not-found" },
  );
  assert.deepEqual(
    collectionRuntime.collectionWorkNavigation({
      collectionId: collection.id,
      workId: "missing-work",
    }),
    { status: "work-not-found" },
  );
  assert.deepEqual(
    collectionRuntime.collectionWorkNavigation({
      collectionId: "",
      workId: signal.id,
    }),
    { status: "invalid-reference" },
  );

  const partialCollectionReader =
    structuredClone(collectionReader);
  partialCollectionReader.collections[0].workIds = [signal.id];
  const partialCollectionRuntime = assertValid(
    createPublicationReaderRuntime(partialCollectionReader),
  );
  assert.deepEqual(
    partialCollectionRuntime.collectionWorkNavigation({
      collectionId: collection.id,
      workId: platform.id,
    }),
    { status: "work-not-in-collection" },
  );
});

test("runtime validates a large navigation graph without rescanning the navigable ID list", async () => {
  const reader = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const largeReader = structuredClone(reader);
  const sectionCount = 6_000;
  const sectionIds = Array.from(
    { length: sectionCount },
    (_, index) => `bulk-section-${index}`,
  );
  const sections = sectionIds.map((id, index) => ({
    id,
    role: "section",
    title: `Bulk section ${index}`,
    parentId: index === 0 ? null : sectionIds[0],
    childIds: index === 0 ? sectionIds.slice(1) : [],
    depth: index === 0 ? 0 : 1,
    order: index,
    routes: {
      reader: {
        path: largeReader.works[0].route,
        anchor: id,
      },
    },
    activeRouteNames: [],
    readerAddress: {
      path: largeReader.works[0].route,
      anchor: id,
    },
    domId: id,
    continuity: {
      id,
      legacyIds: [],
      progressGroups: [[id]],
      historicalSectionIds: [],
    },
    navigable: true,
    blocks: [],
    previousId: index === 0 ? null : sectionIds[index - 1],
    nextId:
      index === sectionCount - 1 ? null : sectionIds[index + 1],
    wordCount: 0,
    readingMinutes: 0,
    contentHash: ZERO_DIGEST,
  }));
  largeReader.works[0].sections = sections;
  largeReader.works[0].rootSectionIds = [sectionIds[0]];
  largeReader.works[0].wordCount = 0;
  largeReader.works[0].readingMinutes = 0;
  largeReader.works[0].contentHash = ZERO_DIGEST;
  largeReader.links = [];
  largeReader.routes.active = largeReader.routes.active.filter(
    ({ target }) => target.kind !== "section",
  );
  largeReader.statistics.sectionCount = sectionCount;
  largeReader.statistics.blockCount = 0;
  largeReader.statistics.wordCount = 0;
  largeReader.statistics.readingMinutes = 0;
  assertValid(validateReaderEnvelopeShape(largeReader));

  const originalIndexOf = Array.prototype.indexOf;
  Array.prototype.indexOf = function guardedIndexOf(
    searchElement,
    fromIndex,
  ) {
    if (
      this.length === sectionCount &&
      this[0] === sectionIds[0] &&
      typeof searchElement === "string"
    ) {
      throw new Error(
        "Navigation validation rescanned the navigable ID list.",
      );
    }
    return originalIndexOf.call(this, searchElement, fromIndex);
  };

  let runtimeResult;
  try {
    runtimeResult = createPublicationReaderRuntime(largeReader);
  } finally {
    Array.prototype.indexOf = originalIndexOf;
  }
  const runtime = assertValid(runtimeResult);
  const middleIndex = Math.floor(sectionCount / 2);
  assert.deepEqual(
    runtime.sectionNavigation({
      workId: largeReader.works[0].id,
      sectionId: sectionIds[middleIndex],
    }),
    {
      status: "resolved",
      current: {
        work: runtime.envelope.works[0],
        section: runtime.envelope.works[0].sections[middleIndex],
      },
      previous: {
        work: runtime.envelope.works[0],
        section: runtime.envelope.works[0].sections[middleIndex - 1],
      },
      next: {
        work: runtime.envelope.works[0],
        section: runtime.envelope.works[0].sections[middleIndex + 1],
      },
    },
  );
});

test("content-hash relocation returns every scoped candidate in reader order", async () => {
  const input = await loadCompilationInput(
    "canonical-field-notes",
    {
      transformMarkdown(workId, markdown) {
        assert.equal(workId, "rain-gauge");
        return `${markdown}\n\nRepeated relocation text.\n\nRepeated relocation text.\n`;
      },
    },
  );
  const reader = project(input, "public");
  const runtime = assertValid(
    createPublicationReaderRuntime(reader),
  );
  const work = reader.works[0];
  const section = work.sections[0];
  const repeatedBlocks = section.blocks.filter(
    ({ markdown }) => markdown === "Repeated relocation text.",
  );
  assert.equal(repeatedBlocks.length, 2);
  assert.equal(
    repeatedBlocks[0].contentHash,
    repeatedBlocks[1].contentHash,
  );
  const expectedCandidates = repeatedBlocks.map((block) => ({
    work,
    section,
    block,
  }));
  const contentHash = repeatedBlocks[0].contentHash;

  for (const scope of [
    { kind: "publication" },
    { kind: "work", workId: work.id },
    {
      kind: "section",
      workId: work.id,
      sectionId: section.id,
    },
  ]) {
    assert.deepEqual(
      runtime.findBlockRelocations({ contentHash, scope }),
      {
        status: "found",
        candidates: expectedCandidates,
      },
    );
  }
  assert.deepEqual(
    runtime.findBlockRelocations({
      contentHash: ZERO_DIGEST,
      scope: { kind: "publication" },
    }),
    { status: "not-found" },
  );
  assert.deepEqual(
    runtime.findBlockRelocations({
      contentHash: "sha256:not-a-digest",
      scope: { kind: "publication" },
    }),
    { status: "invalid", reason: "hash" },
  );
  assert.deepEqual(
    runtime.findBlockRelocations({
      contentHash,
      scope: { kind: "work", workId: "" },
    }),
    { status: "invalid", reason: "scope" },
  );
});

test("the browser runtime snapshots its input and fails closed on adversarial values", async () => {
  const original = project(
    await loadCompilationInput("canonical-field-notes"),
    "public",
  );
  const supplied = structuredClone(original);
  const runtime = assertValid(
    createPublicationReaderRuntime(supplied),
  );
  const originalTitle = runtime.envelope.publication.title;
  supplied.publication.title = "Caller mutation";
  supplied.works[0].sections[0].blocks[0].markdown =
    "Caller mutation";

  assert.equal(runtime.envelope.publication.title, originalTitle);
  assert.notEqual(
    runtime.envelope.works[0].sections[0].blocks[0].markdown,
    "Caller mutation",
  );
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.envelope), true);
  assert.equal(Object.isFrozen(runtime.envelope.works), true);
  assert.equal(Object.isFrozen(runtime.lookupWork("rain-gauge")), true);
  assert.throws(
    () => runtime.envelope.works.push({}),
    TypeError,
  );

  const adversarialFactories = [
    ["null", () => null],
    ["array root", () => []],
    ["null prototype", () => Object.create(null)],
    [
      "throwing ownKeys",
      () =>
        new Proxy(original, {
          ownKeys() {
            throw new Error("hostile ownKeys");
          },
        }),
    ],
    [
      "cyclic record",
      () => {
        const value = structuredClone(original);
        value.publication.publisher.cycle =
          value.publication.publisher;
        return value;
      },
    ],
    [
      "sparse array",
      () => {
        const value = structuredClone(original);
        value.works = new Array(1);
        return value;
      },
    ],
    [
      "symbol property",
      () => {
        const value = structuredClone(original);
        value[Symbol("hidden")] = true;
        return value;
      },
    ],
    [
      "function value",
      () => {
        const value = structuredClone(original);
        value.publication.title = () => "hostile";
        return value;
      },
    ],
    [
      "bigint value",
      () => {
        const value = structuredClone(original);
        value.statistics.wordCount = 1n;
        return value;
      },
    ],
    [
      "non-finite number",
      () => {
        const value = structuredClone(original);
        value.statistics.wordCount = Infinity;
        return value;
      },
    ],
    [
      "exotic prototype",
      () => {
        const value = structuredClone(original);
        Object.setPrototypeOf(value.publication, {
          hostile: true,
        });
        return value;
      },
    ],
    [
      "non-enumerable property",
      () => {
        const value = structuredClone(original);
        Object.defineProperty(value, "hidden", {
          enumerable: false,
          value: true,
        });
        return value;
      },
    ],
    [
      "accessor property",
      () => {
        const value = structuredClone(original);
        Object.defineProperty(value.publication, "title", {
          enumerable: true,
          get() {
            throw new Error("hostile getter");
          },
        });
        return value;
      },
    ],
  ];
  for (const [label, createValue] of adversarialFactories) {
    let result;
    assert.doesNotThrow(
      () => {
        result = createPublicationReaderRuntime(createValue());
      },
      label,
    );
    assert.equal(result.valid, false);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.diagnostics), true);
  }

  const duplicate = structuredClone(original);
  duplicate.works.push(structuredClone(duplicate.works[0]));
  duplicate.statistics.workCount += 1;
  const duplicateResult =
    createPublicationReaderRuntime(duplicate);
  assert.equal(duplicateResult.valid, false);
  assert.ok(
    duplicateResult.diagnostics.some(({ code }) =>
      code.startsWith("reader.runtime."),
    ),
    validationMessage(duplicateResult),
  );

  assert.deepEqual(runtime.lookupSection(null), {
    status: "invalid",
    reason: "reference",
  });
  assert.deepEqual(runtime.lookupBlock({}), {
    status: "invalid",
    reason: "reference",
  });
  assert.deepEqual(runtime.sectionNavigation(null), {
    status: "invalid-reference",
  });
  assert.deepEqual(runtime.collectionWorkNavigation(null), {
    status: "invalid-reference",
  });
  assert.deepEqual(runtime.findBlockRelocations(null), {
    status: "invalid",
    reason: "hash",
  });
});

test("runtime derived-value checks ignore nested record insertion order", async () => {
  const reader = project(
    await loadCompilationInput("declared-night-dispatch"),
    "public",
  );
  const reordered = structuredClone(reader);
  reordered.statistics = {
    wordsPerMinute: reader.statistics.wordsPerMinute,
    readingMinutes: reader.statistics.readingMinutes,
    wordCount: reader.statistics.wordCount,
    blockCount: reader.statistics.blockCount,
    sectionCount: reader.statistics.sectionCount,
    collectionCount: reader.statistics.collectionCount,
    workCount: reader.statistics.workCount,
  };
  reordered.routes.active = reader.routes.active.map((route) => {
    const reversedTarget = Object.fromEntries(
      Object.entries(route.target).reverse(),
    );
    return {
      target: reversedTarget,
      path: route.path,
    };
  });

  const result = createPublicationReaderRuntime(reordered);
  const runtime = assertValid(result);
  assert.deepEqual(
    runtime.resolveAddress({
      path: reader.works[0].route,
    }),
    {
      status: "resolved",
      requestedAddress: {
        path: reader.works[0].route,
      },
      route: reordered.routes.active.find(
        ({ path }) => path === reader.works[0].route,
      ),
      content: {
        kind: "section",
        match: {
          work: reordered.works[0],
          section: reordered.works[0].sections[0],
        },
        matchedAddress:
          reordered.works[0].sections[0].readerAddress,
      },
    },
  );
});
