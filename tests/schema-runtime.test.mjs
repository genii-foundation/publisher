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
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import test from "node:test";

import {
  inspectCanonicalRoutePath,
  isCanonicalRoutePath,
  REQUIRED_ATTRIBUTION,
  resolvePublicationSourcesForContentCompilation,
  resolvePublicationLayout,
  validateCollectionShape,
  validatePublicationSemantics,
  validatePublicationShape,
  validateRepositoryRelativePath,
  validateWorkShape,
} from "../schemas/dist/index.js";

const repositoryRoot = new URL("../", import.meta.url);
const repositoryRootPath = fileURLToPath(repositoryRoot);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
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

function snapshotFixture(fixture) {
  return {
    publication: fixture.publication,
    layout: fixture.layout,
    workManifests: [...fixture.workManifests.entries()],
    collectionManifests: [...fixture.collectionManifests.entries()],
  };
}

async function loadFixture(directory) {
  const fixtureRoot = resolve(repositoryRootPath, "fixtures", directory);
  const rawPublication = await readJson(
    await resolveFixtureFile(fixtureRoot, "publication.json"),
  );
  const publicationResult = validatePublicationShape(rawPublication);
  assert.equal(
    publicationResult.valid,
    true,
    JSON.stringify(publicationResult.diagnostics, null, 2),
  );

  const layoutResult = resolvePublicationLayout(publicationResult.value);
  assert.equal(
    layoutResult.valid,
    true,
    JSON.stringify(layoutResult.diagnostics, null, 2),
  );

  const workManifests = new Map();
  for (const reference of layoutResult.value.works.manifests) {
    const rawWork = await readJson(
      await resolveFixtureFile(fixtureRoot, reference.manifestPath),
    );
    const workResult = validateWorkShape(rawWork);
    assert.equal(
      workResult.valid,
      true,
      JSON.stringify(workResult.diagnostics, null, 2),
    );
    workManifests.set(reference.manifestPath, workResult.value);
  }

  const collectionManifests = new Map();
  for (const reference of layoutResult.value.collections.manifests) {
    const rawCollection = await readJson(
      await resolveFixtureFile(fixtureRoot, reference.manifestPath),
    );
    const collectionResult = validateCollectionShape(rawCollection);
    assert.equal(
      collectionResult.valid,
      true,
      JSON.stringify(collectionResult.diagnostics, null, 2),
    );
    collectionManifests.set(reference.manifestPath, collectionResult.value);
  }

  return {
    fixtureRoot,
    publication: publicationResult.value,
    layout: layoutResult.value,
    workManifests,
    collectionManifests,
  };
}

function validateFixtureSemantics(fixture, overrides = {}) {
  return validatePublicationSemantics({
    publication: overrides.publication ?? fixture.publication,
    engineVersion: overrides.engineVersion ?? "1.0.0",
    workManifests: overrides.workManifests ?? fixture.workManifests,
    collectionManifests:
      overrides.collectionManifests ?? fixture.collectionManifests,
  });
}

test("canonical route inspection uses one ASCII serialized spelling", () => {
  assert.deepEqual(inspectCanonicalRoutePath(null), {
    valid: false,
    issue: "type",
  });
  assert.equal(isCanonicalRoutePath(null), false);

  const longestCanonicalRoute = `/${"a".repeat(2_047)}`;
  const validRoutes = [
    "/",
    "/caf%C3%A9",
    "/%E6%9D%B1%E4%BA%AC/",
    "/%F0%9F%98%80",
    "/x",
    "/x/",
    longestCanonicalRoute,
  ];

  assert.equal(longestCanonicalRoute.length, 2_048);
  for (const route of validRoutes) {
    assert.deepEqual(inspectCanonicalRoutePath(route), {
      valid: true,
      value: route,
    });
    assert.equal(isCanonicalRoutePath(route), true);
    assert.equal(
      new URL(route, "https://reader.example").pathname,
      route,
    );
  }

  const invalidRoutes = [
    ["/café", "raw-non-ascii"],
    ["/hello world", "whitespace"],
    ["/caf%c3%a9", "percent-encoding-case"],
    ["/hello%20world", "percent-encoded-ascii"],
    ["/x%2Fy", "percent-encoded-ascii"],
    ["/%2E%2E/x", "percent-encoded-ascii"],
    ["/%", "percent-encoding-syntax"],
    ["/%ZZ", "percent-encoding-syntax"],
    ["/%E9", "percent-encoding-utf8"],
    ["/%C0%AF", "percent-encoding-utf8"],
    ["/e%CC%81", "unicode-normalization"],
    ["/%C2%85", "control-character"],
    ["/%E2%80%83", "whitespace"],
    ["/a\u0000b", "control-character"],
    ["/./x", "dot-segment"],
    ["/a//b", "empty-segment"],
    ["/square[bracket]", "character"],
    [`/${"a".repeat(2_048)}`, "length"],
  ];

  for (const [route, issue] of invalidRoutes) {
    assert.deepEqual(
      inspectCanonicalRoutePath(route),
      { valid: false, issue },
      route,
    );
    assert.equal(isCanonicalRoutePath(route), false, route);
  }
});

test("schema package manifest declares runtime, schemas, and legal artifacts", async () => {
  const packageManifest = await readJson(
    new URL("schemas/package.json", repositoryRoot),
  );

  assert.equal(packageManifest.license, "CPAL-1.0");
  assert.equal(
    packageManifest.engines.node,
    ">=22.12.0 <23 || >=24.0.0 <25 || >=26.0.0 <27",
  );
  assert.deepEqual(packageManifest.files, [
    "CHANGES.md",
    "LEGAL",
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "SOURCE-NOTICE",
    "dist",
    "scripts",
    "src",
    "tsconfig.json",
    "*.schema.json",
  ]);
  assert.equal(
    packageManifest.exports["./publication.schema.json"],
    "./publication.schema.json",
  );
  assert.equal(
    packageManifest.exports["./work.schema.json"],
    "./work.schema.json",
  );
  assert.equal(
    packageManifest.exports["./collection.schema.json"],
    "./collection.schema.json",
  );
  assert.deepEqual(packageManifest.exports["./routes"], {
    types: "./dist/routes.d.ts",
    import: "./dist/routes.js",
  });

  const legalArtifacts = [
    "CHANGES.md",
    "LEGAL",
    "LICENSE",
    "NOTICE.md",
    "SOURCE-NOTICE",
  ];
  for (const artifact of legalArtifacts) {
    const [repositoryCopy, packageCopy] = await Promise.all([
      readFile(new URL(artifact, repositoryRoot), "utf8"),
      readFile(new URL(`schemas/${artifact}`, repositoryRoot), "utf8"),
    ]);
    assert.equal(packageCopy, repositoryCopy, artifact);
  }
});

test("canonical fixture resolves and passes semantic validation", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const before = JSON.stringify(snapshotFixture(fixture));
  const result = validatePublicationSemantics({
    publication: fixture.publication,
    engineVersion: "1.2.0",
    workManifests: fixture.workManifests,
    collectionManifests: fixture.collectionManifests,
  });

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(
    fixture.layout.works.manifests[0]?.manifestPath,
    "publication/works/rain-gauge/work.json",
  );
  assert.equal(
    fixture.layout.collections.manifests[0]?.manifestPath,
    "publication/collections/weather-observations/collection.json",
  );
  const [resolvedWork] = result.value.works;
  assert.ok(resolvedWork);
  assert.equal(
    resolvedWork.manuscriptPath,
    "publication/works/rain-gauge/manuscript.md",
  );
  assert.equal(
    resolvedWork.assetsPath,
    "publication/works/rain-gauge/assets",
  );
  const manuscript = await readFile(
    await resolveFixtureFile(
      fixture.fixtureRoot,
      resolvedWork.manuscriptPath,
    ),
    "utf8",
  );
  assert.ok(manuscript.length > 0);
  await resolveFixtureFile(
    fixture.fixtureRoot,
    resolvedWork.assetsPath,
  );
  assert.equal(JSON.stringify(snapshotFixture(fixture)), before);
});

test("declared fixture resolves templates and irregular manifests", async () => {
  const fixture = await loadFixture("declared-night-dispatch");
  const result = validatePublicationSemantics({
    publication: fixture.publication,
    engineVersion: "1.9.4",
    workManifests: fixture.workManifests,
    collectionManifests: fixture.collectionManifests,
  });

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(
    fixture.layout.works.manifests.map(({ manifestPath }) => manifestPath),
    [
      "archive/texts/signal-lantern/record.json",
      "oddities/platform-card.json",
    ],
  );
  assert.equal(
    fixture.layout.collections.manifests[0]?.manifestPath,
    "lists/after-dark/index.json",
  );
  assert.deepEqual(
    result.value.works.map(({ manuscriptPath }) => manuscriptPath),
    [
      "archive/texts/signal-lantern/text.md",
      "archive/pages/platform-bell.md",
    ],
  );
  for (const work of result.value.works) {
    const manuscript = await readFile(
      await resolveFixtureFile(fixture.fixtureRoot, work.manuscriptPath),
      "utf8",
    );
    assert.ok(manuscript.length > 0, work.manuscriptPath);
  }
});

test("declared layouts inherit every unspecified canonical role", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const publication = structuredClone(fixture.publication);
  publication.layout = {
    mode: "declared",
    overrides: {
      assets: "publication/shared-assets",
    },
  };

  const result = resolvePublicationLayout(publication);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.value.works.root, "publication/works");
  assert.equal(
    result.value.works.manifestTemplate,
    "{workId}/work.json",
  );
  assert.equal(result.value.collections.root, "publication/collections");
  assert.equal(
    result.value.collections.manifestTemplate,
    "{collectionId}/collection.json",
  );
  assert.equal(result.value.assetsRoot, "publication/shared-assets");
  assert.equal(result.value.continuityRoot, "publication/continuity");
});

test("semantic validation reports incompatible engines", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const result = validatePublicationSemantics({
    publication: fixture.publication,
    engineVersion: "2.0.0",
    workManifests: fixture.workManifests,
    collectionManifests: fixture.collectionManifests,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code, path }) =>
        code === "engine.compatibility.unsatisfied" &&
        path === "/engine/compatibility",
    ),
  );
});

test("semantic validation catches cross-file and collection drift", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const workPath = fixture.layout.works.manifests[0]?.manifestPath;
  const collectionPath =
    fixture.layout.collections.manifests[0]?.manifestPath;
  assert.ok(workPath);
  assert.ok(collectionPath);

  const mismatchedWorks = new Map(fixture.workManifests);
  mismatchedWorks.set(workPath, {
    ...mismatchedWorks.get(workPath),
    id: "another-work",
  });
  const invalidCollections = new Map(fixture.collectionManifests);
  invalidCollections.set(collectionPath, {
    ...invalidCollections.get(collectionPath),
    workIds: ["missing-work"],
  });

  const result = validatePublicationSemantics({
    publication: fixture.publication,
    engineVersion: "1.0.0",
    workManifests: mismatchedWorks,
    collectionManifests: invalidCollections,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(({ code }) => code === "work.id_mismatch"),
  );
  assert.ok(
    result.diagnostics.some(
      ({ code }) => code === "collection.unknown_work_id",
    ),
  );
});

test("semantic validation rejects route loops and boundary overlap", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const publication = structuredClone(fixture.publication);
  publication.continuity.redirects = [
    { from: "/a", to: "/b", status: 308 },
    { from: "/b", to: "/a", status: 308 },
  ];
  publication.boundaries.outputRoots = ["publication/generated"];

  const result = validatePublicationSemantics({
    publication,
    engineVersion: "1.0.0",
    workManifests: fixture.workManifests,
    collectionManifests: fixture.collectionManifests,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code }) => code === "continuity.redirect.loop",
    ),
  );
  assert.ok(
    result.diagnostics.some(
      ({ code }) => code === "boundary.source_output_overlap",
    ),
  );
});

test("semantic validation enforces collection routes and attribution", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const publication = structuredClone(fixture.publication);
  delete publication.routes.collection;
  publication.attribution = {
    ...publication.attribution,
    text: "A different credit",
  };

  const result = validatePublicationSemantics({
    publication,
    engineVersion: "1.0.0",
    workManifests: fixture.workManifests,
    collectionManifests: fixture.collectionManifests,
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code }) => code === "route.collection.required",
    ),
  );
  assert.ok(
    result.diagnostics.some(
      ({ code }) => code === "attribution.fixed_value",
    ),
  );
  assert.equal(REQUIRED_ATTRIBUTION.text, "Published with GENII Publisher");
});

test("semantic validation rejects unsupported source versions with document paths", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const publication = structuredClone(fixture.publication);
  publication.schemaVersion = "999.0";

  const workManifests = new Map(fixture.workManifests);
  const [workPath, work] = workManifests.entries().next().value;
  workManifests.set(workPath, { ...work, schemaVersion: "847.3" });

  const collectionManifests = new Map(fixture.collectionManifests);
  const [collectionPath, collection] =
    collectionManifests.entries().next().value;
  collectionManifests.set(collectionPath, {
    ...collection,
    schemaVersion: "42.0",
  });

  const result = validateFixtureSemantics(fixture, {
    publication,
    workManifests,
    collectionManifests,
  });

  assert.equal(result.valid, false);
  const versionDiagnostics = result.diagnostics.filter(
    ({ code }) => code === "schema_version.unsupported",
  );
  assert.deepEqual(
    versionDiagnostics.map(({ documentPath, path }) => ({
      documentPath,
      path,
    })),
    [
      { documentPath: "publication.json", path: "/schemaVersion" },
      { documentPath: collectionPath, path: "/schemaVersion" },
      { documentPath: workPath, path: "/schemaVersion" },
    ].sort((left, right) =>
      left.documentPath.localeCompare(right.documentPath),
    ),
  );
});

test("semantic validation requires canonical installed-engine SemVer", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  for (const engineVersion of ["v1.0.0", " 1.0.0 "]) {
    const result = validateFixtureSemantics(fixture, { engineVersion });
    assert.equal(result.valid, false, engineVersion);
    assert.ok(
      result.diagnostics.some(
        ({ code }) => code === "engine.version.invalid",
      ),
      engineVersion,
    );
  }
});

test("layout resolution rejects encoded escapes and duplicate manifest paths before loading", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const encoded = structuredClone(fixture.publication);
  encoded.layout = {
    mode: "declared",
    overrides: {
      works: {
        root: "publication/%2e%2e",
      },
    },
  };
  const encodedResult = resolvePublicationLayout(encoded);
  assert.equal(encodedResult.valid, false);
  assert.ok(
    encodedResult.diagnostics.some(
      ({ code }) => code === "path.percent_encoding",
    ),
  );

  const duplicated = structuredClone(fixture.publication);
  duplicated.works.push({
    id: "second-work",
    manifest: "publication/works/rain-gauge/work.json",
  });
  const duplicateResult = resolvePublicationLayout(duplicated);
  assert.equal(duplicateResult.valid, false);
  assert.ok(
    duplicateResult.diagnostics.some(
      ({ code }) => code === "layout.manifest_path_duplicate",
    ),
  );

  const crossKind = structuredClone(fixture.publication);
  crossKind.collections[0].manifest =
    "publication/works/rain-gauge/work.json";
  const crossKindResult = resolvePublicationLayout(crossKind);
  assert.equal(crossKindResult.valid, false);
  assert.ok(
    crossKindResult.diagnostics.some(
      ({ code }) => code === "layout.manifest_path_duplicate",
    ),
  );
});

test("semantic validation resolves collection overrides and rejects source escapes", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const publication = structuredClone(fixture.publication);
  const [originalCollectionPath, collection] =
    fixture.collectionManifests.entries().next().value;
  const overriddenCollectionPath =
    "publication/custom/weather-observations.json";
  publication.collections[0].manifest = overriddenCollectionPath;
  const collectionManifests = new Map([
    [overriddenCollectionPath, collection],
  ]);

  const validResult = validateFixtureSemantics(fixture, {
    publication,
    collectionManifests,
  });
  assert.equal(
    validResult.valid,
    true,
    JSON.stringify(validResult.diagnostics, null, 2),
  );
  assert.equal(
    validResult.value.collections[0]?.manifestPath,
    overriddenCollectionPath,
  );
  assert.notEqual(overriddenCollectionPath, originalCollectionPath);

  const workManifests = new Map(fixture.workManifests);
  const [workPath, work] = workManifests.entries().next().value;
  workManifests.set(workPath, {
    ...work,
    manuscript: {
      path: "outside/manuscript.md",
      relativeTo: "repository",
    },
  });
  const escapedResult = validateFixtureSemantics(fixture, { workManifests });
  assert.equal(escapedResult.valid, false);
  assert.ok(
    escapedResult.diagnostics.some(
      ({ code, documentPath, path }) =>
        code === "boundary.source_outside_root" &&
        documentPath === workPath &&
        path === "/manuscript",
    ),
  );
});

test("route and continuity validation rejects collisions but accepts external termination", async () => {
  const fixture = await loadFixture("canonical-field-notes");

  const invalidPublication = structuredClone(fixture.publication);
  invalidPublication.routes.work = "/works/{workId}/{workId}";
  invalidPublication.continuity.redirects = [
    { from: "/", to: "/works/rain-gauge", status: 308 },
    { from: "/unknown", to: "/not-active", status: 308 },
  ];
  const invalidResult = validateFixtureSemantics(fixture, {
    publication: invalidPublication,
  });
  assert.equal(invalidResult.valid, false);
  for (const code of [
    "route.template_token_invalid",
    "continuity.redirect.active_route_source",
    "continuity.redirect.internal_target_unresolved",
  ]) {
    assert.ok(
      invalidResult.diagnostics.some(
        (diagnostic) => diagnostic.code === code,
      ),
      code,
    );
  }

  const externalPublication = structuredClone(fixture.publication);
  externalPublication.continuity.redirects = [
    { from: "/older", to: "/offsite", status: 308 },
    {
      from: "/offsite",
      to: "https://archive.example/rain-gauge",
      status: 308,
    },
  ];
  const externalResult = validateFixtureSemantics(fixture, {
    publication: externalPublication,
  });
  assert.equal(
    externalResult.valid,
    true,
    JSON.stringify(externalResult.diagnostics, null, 2),
  );

  const collidingWorks = new Map(fixture.workManifests);
  const [workPath, work] = collidingWorks.entries().next().value;
  collidingWorks.set(workPath, { ...work, route: "/" });
  const collisionResult = validateFixtureSemantics(fixture, {
    workManifests: collidingWorks,
  });
  assert.equal(collisionResult.valid, false);
  assert.ok(
    collisionResult.diagnostics.some(
      ({ code }) => code === "route.active_collision",
    ),
  );
});

test("route templates receive complete canonical Unicode validation", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const validPublication = structuredClone(fixture.publication);
  validPublication.routes.work = "/works/caf%C3%A9/{workId}/";
  validPublication.routes.collection =
    "/collections/%E6%9D%B1%E4%BA%AC/{collectionId}/";
  const validResult = validateFixtureSemantics(fixture, {
    publication: validPublication,
  });
  assert.equal(
    validResult.valid,
    true,
    JSON.stringify(validResult.diagnostics, null, 2),
  );

  const neutralPlaceholderPublication = structuredClone(
    fixture.publication,
  );
  neutralPlaceholderPublication.routes.work = "/{workId}%CC%87";
  const neutralPlaceholderResult = validateFixtureSemantics(fixture, {
    publication: neutralPlaceholderPublication,
  });
  assert.equal(
    neutralPlaceholderResult.valid,
    true,
    JSON.stringify(neutralPlaceholderResult.diagnostics, null, 2),
  );

  const generatedCompositionWorks = new Map(fixture.workManifests);
  const [generatedWorkPath, generatedWork] =
    generatedCompositionWorks.entries().next().value;
  const generatedWorkWithoutRoute = structuredClone(generatedWork);
  delete generatedWorkWithoutRoute.route;
  generatedCompositionWorks.set(
    generatedWorkPath,
    generatedWorkWithoutRoute,
  );
  const generatedCompositionResult = validateFixtureSemantics(fixture, {
    publication: neutralPlaceholderPublication,
    workManifests: generatedCompositionWorks,
  });
  assert.equal(generatedCompositionResult.valid, false);
  assert.ok(
    generatedCompositionResult.diagnostics.some(
      ({ code, path }) =>
        code === "route.unicode_normalization" &&
        path === "/routes/work",
    ),
  );

  const nonNormalizedPublication = structuredClone(fixture.publication);
  nonNormalizedPublication.routes.work = "/works/e%CC%81/{workId}";
  const nonNormalizedResult = validateFixtureSemantics(fixture, {
    publication: nonNormalizedPublication,
  });
  assert.equal(nonNormalizedResult.valid, false);
  assert.ok(
    nonNormalizedResult.diagnostics.some(
      ({ code, path }) =>
        code === "route.unicode_normalization" &&
        path === "/routes/work",
    ),
  );

  const malformedTokenPublication = structuredClone(fixture.publication);
  malformedTokenPublication.routes.work = "/works/{workId}/{other}";
  const malformedTokenResult = validateFixtureSemantics(fixture, {
    publication: malformedTokenPublication,
  });
  assert.equal(malformedTokenResult.valid, false);
  assert.ok(
    malformedTokenResult.diagnostics.some(
      ({ code, path }) =>
        code === "route.template_token_invalid" &&
        path === "/routes/work",
    ),
  );
  assert.equal(
    malformedTokenResult.diagnostics.some(
      ({ code, path }) =>
        code === "route.character" && path === "/routes/work",
    ),
    false,
  );
});

test("pre-compilation source resolution defers only adapter terminal routes", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const unresolvedPublication = structuredClone(fixture.publication);
  unresolvedPublication.continuity.redirects = [
    {
      from: "/journal/legacy-section",
      to: "/reader/future-section",
      status: 308,
    },
  ];
  const unresolvedResult =
    resolvePublicationSourcesForContentCompilation({
      publication: unresolvedPublication,
      engineVersion: "1.0.0",
      workManifests: fixture.workManifests,
      collectionManifests: fixture.collectionManifests,
    });
  assert.equal(
    unresolvedResult.valid,
    true,
    JSON.stringify(unresolvedResult.diagnostics, null, 2),
  );

  const duplicatePublication = structuredClone(fixture.publication);
  duplicatePublication.continuity.redirects = [
    { from: "/legacy", to: "/reader/future-a", status: 308 },
    { from: "/legacy", to: "/reader/future-b", status: 308 },
  ];
  const duplicateResult =
    resolvePublicationSourcesForContentCompilation({
      publication: duplicatePublication,
      engineVersion: "1.0.0",
      workManifests: fixture.workManifests,
      collectionManifests: fixture.collectionManifests,
    });
  assert.equal(duplicateResult.valid, false);
  assert.ok(
    duplicateResult.diagnostics.some(
      ({ code }) => code === "continuity.redirect.duplicate_source",
    ),
  );

  const activeCollisionPublication =
    structuredClone(fixture.publication);
  activeCollisionPublication.continuity.redirects = [
    { from: "/", to: "/reader/future", status: 308 },
  ];
  const activeCollisionResult =
    resolvePublicationSourcesForContentCompilation({
      publication: activeCollisionPublication,
      engineVersion: "1.0.0",
      workManifests: fixture.workManifests,
      collectionManifests: fixture.collectionManifests,
    });
  assert.equal(activeCollisionResult.valid, false);
  assert.ok(
    activeCollisionResult.diagnostics.some(
      ({ code }) =>
        code === "continuity.redirect.active_route_source",
    ),
  );
});

test("semantic validation preserves configured trailing-slash routes", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const publication = structuredClone(fixture.publication);
  publication.routes.home = "/home/";
  publication.routes.updates = "/updates/";
  publication.routes.work = "/works/{workId}/";
  publication.routes.collection = "/collections/{collectionId}/";
  publication.continuity.redirects = [
    {
      from: "/journal/morning-reading/",
      to: "/works/rain-gauge/",
      status: 308,
    },
  ];

  const workManifests = new Map(fixture.workManifests);
  const [workPath, work] = workManifests.entries().next().value;
  workManifests.set(workPath, {
    ...work,
    route: "/works/rain-gauge/",
  });

  const collectionManifests = new Map(fixture.collectionManifests);
  const [collectionPath, collection] =
    collectionManifests.entries().next().value;
  collectionManifests.set(collectionPath, {
    ...collection,
    route: "/collections/weather-observations/",
  });

  const result = validateFixtureSemantics(fixture, {
    publication,
    workManifests,
    collectionManifests,
  });

  assert.equal(
    result.valid,
    true,
    JSON.stringify(result.diagnostics, null, 2),
  );
});

test("semantic diagnostics have deterministic public ordering", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const publication = structuredClone(fixture.publication);
  publication.schemaVersion = "2.0";
  publication.routes.home = "/invalid?draft=true";
  publication.attribution.text = "Missing credit";

  const first = validateFixtureSemantics(fixture, { publication });
  const second = validateFixtureSemantics(fixture, { publication });
  assert.equal(first.valid, false);
  assert.equal(second.valid, false);
  assert.deepEqual(first.diagnostics, second.diagnostics);

  const locations = first.diagnostics.map(
    ({ documentPath = "", path, code }) => `${documentPath}\0${path}\0${code}`,
  );
  assert.deepEqual(locations, [...locations].sort());
});

test("path validation is safe without prior shape validation", () => {
  const cases = [
    [".", "path.current_directory"],
    ["content/./work.json", "path.current_directory"],
    ["content/", "path.empty_segment"],
    ["../work.json", "path.traversal"],
    ["/work.json", "path.absolute"],
    [String.raw`content\work.json`, "path.backslash"],
    ["content/%2e%2e/work.json", "path.percent_encoding"],
    ["content/work.json?draft", "path.url_metacharacter"],
    ["content/\u0000work.json", "path.control_character"],
    ["content/con/work.json", "path.windows_reserved_name"],
    ["content/PRN.txt/work.json", "path.windows_reserved_name"],
    ["content/com¹/work.json", "path.windows_reserved_name"],
    ["content/bad:name/work.json", "path.windows_forbidden_character"],
    ["content/bad<name>/work.json", "path.windows_forbidden_character"],
    ["content/bad\"name/work.json", "path.windows_forbidden_character"],
    ["content/bad|name/work.json", "path.windows_forbidden_character"],
    ["content/bad*name/work.json", "path.windows_forbidden_character"],
    ["content/trailing./work.json", "path.windows_trailing_character"],
    ["content/trailing /work.json", "path.windows_trailing_character"],
  ];

  for (const [path, expectedCode] of cases) {
    assert.ok(
      validateRepositoryRelativePath(path, "/path").some(
        ({ code }) => code === expectedCode,
      ),
      `${path} should report ${expectedCode}`,
    );
  }
});

test("canonical IDs cannot resolve to Windows reserved manifest paths", async () => {
  const fixture = await loadFixture("canonical-field-notes");
  const publication = structuredClone(fixture.publication);
  publication.works[0].id = "con";

  const result = resolvePublicationLayout(publication);
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code, path }) =>
        code === "path.windows_reserved_name" && path === "/works/0/id",
    ),
  );
});
