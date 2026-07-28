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

import {
  resolvePublicationLayout,
  validatePublicationSemantics,
  validatePublicationShape,
  validateWorkShape,
} from "../schemas/dist/index.js";

const fixtureRoot = new URL(
  "../fixtures/canonical-field-notes/",
  import.meta.url,
);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, fixtureRoot), "utf8"));
}

async function loadCanonicalInput() {
  const publication = await readJson("publication.json");
  const layoutResult = resolvePublicationLayout(publication);
  assert.equal(
    layoutResult.valid,
    true,
    JSON.stringify(layoutResult.diagnostics, null, 2),
  );

  const workManifests = new Map();
  for (const reference of layoutResult.value.works.manifests) {
    workManifests.set(
      reference.manifestPath,
      await readJson(reference.manifestPath),
    );
  }

  const collectionManifests = new Map();
  for (const reference of layoutResult.value.collections.manifests) {
    collectionManifests.set(
      reference.manifestPath,
      await readJson(reference.manifestPath),
    );
  }

  return {
    publication,
    workManifests,
    collectionManifests,
  };
}

function validate(input) {
  return validatePublicationSemantics({
    ...input,
    engineVersion: "1.0.0",
  });
}

test("network URLs reject executable schemes and embedded credentials", async () => {
  const input = await loadCanonicalInput();
  const executableScheme = structuredClone(input.publication);
  executableScheme.publication.publisher.url = "javascript:alert(1)";
  const shapeResult = validatePublicationShape(executableScheme);
  assert.equal(shapeResult.valid, false);
  assert.ok(
    shapeResult.diagnostics.some(
      ({ path }) => path === "/publication/publisher/url",
    ),
  );

  const credentialed = structuredClone(input.publication);
  credentialed.publication.publisher.url =
    "https://publisher:secret@example.test";
  credentialed.attribution.sourceCodeUrl =
    "https://reader:secret@example.test/source";
  credentialed.continuity.redirects = [
    {
      from: "/credentialed-target",
      to: "https://reader:secret@example.test/archive",
      status: 308,
    },
  ];

  const result = validate({ ...input, publication: credentialed });
  assert.equal(result.valid, false);
  assert.deepEqual(
    [
      "attribution.source_code_url.invalid",
      "continuity.redirect.external_target_invalid",
      "publication.publisher_url.invalid",
    ].map((code) =>
      result.diagnostics.some((diagnostic) => diagnostic.code === code),
    ),
    [true, true, true],
  );
});

test("shape validation rejects values outside the JSON data model", async () => {
  const originalWork = await readJson(
    "publication/works/rain-gauge/work.json",
  );
  const invalidValues = [
    ["map", new Map([["key", "value"]])],
    ["date", new Date("2026-07-28T00:00:00.000Z")],
    ["function", () => "value"],
    ["undefined", undefined],
    ["symbol", Symbol("value")],
    ["bigint", 1n],
    ["infinity", Number.POSITIVE_INFINITY],
    ["sparse-array", Array(2)],
  ];

  for (const [label, value] of invalidValues) {
    const work = structuredClone(originalWork);
    work.metadata = { value };
    const result = validateWorkShape(work);
    assert.equal(result.valid, false, label);
    assert.ok(
      result.diagnostics.some(
        ({ code, path }) =>
          code === "schema.non_json_value" &&
          (path === "/metadata/value" ||
            path.startsWith("/metadata/value/")),
      ),
      label,
    );
  }

  const cyclicMetadata = {};
  cyclicMetadata.self = cyclicMetadata;
  const cyclicWork = structuredClone(originalWork);
  cyclicWork.metadata = cyclicMetadata;
  const cyclicResult = validateWorkShape(cyclicWork);
  assert.equal(cyclicResult.valid, false);
  assert.ok(
    cyclicResult.diagnostics.some(
      ({ code, path, params }) =>
        code === "schema.non_json_value" &&
        path === "/metadata/self" &&
        params.reason === "cyclicReference",
    ),
  );

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const revokedResult = validateWorkShape(revoked.proxy);
  assert.equal(revokedResult.valid, false);
  assert.ok(
    revokedResult.diagnostics.some(
      ({ code, params }) =>
        code === "schema.non_json_value" &&
        params.reason === "uninspectableValue",
    ),
  );
});

test("generated concrete routes retain the 2048 character limit", async () => {
  const input = await loadCanonicalInput();
  const astralWorkManifests = new Map(input.workManifests);
  const [astralWorkPath, originalWork] =
    astralWorkManifests.entries().next().value;
  const astralWork = {
    ...originalWork,
    route: `/${"😀".repeat(1_100)}`,
  };
  const astralShapeResult = validateWorkShape(astralWork);
  assert.equal(
    astralShapeResult.valid,
    true,
    JSON.stringify(astralShapeResult.diagnostics, null, 2),
  );
  astralWorkManifests.set(astralWorkPath, astralWork);
  const astralPublication = structuredClone(input.publication);
  astralPublication.continuity.redirects = [];
  const astralResult = validate({
    ...input,
    publication: astralPublication,
    workManifests: astralWorkManifests,
  });
  assert.equal(
    astralResult.valid,
    true,
    JSON.stringify(astralResult.diagnostics, null, 2),
  );

  const publication = structuredClone(input.publication);
  publication.routes.work = `/${"a".repeat(2038)}/{workId}`;
  assert.equal(publication.routes.work.length, 2048);

  const shapeResult = validatePublicationShape(publication);
  assert.equal(
    shapeResult.valid,
    true,
    JSON.stringify(shapeResult.diagnostics, null, 2),
  );

  const workManifests = new Map(input.workManifests);
  const [workPath, work] = workManifests.entries().next().value;
  const workWithoutRoute = structuredClone(work);
  delete workWithoutRoute.route;
  workManifests.set(workPath, workWithoutRoute);

  const result = validate({ ...input, publication, workManifests });
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some(
      ({ code, path }) =>
        code === "route.length" && path === "/routes/work",
    ),
  );
});

test("semantic results are detached immutable snapshots", async () => {
  const input = await loadCanonicalInput();
  const originalTitle = input.workManifests.values().next().value.title;
  const result = validate(input);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));

  const resolvedWork = result.value.works[0];
  const inputWork = input.workManifests.values().next().value;
  assert.notEqual(resolvedWork.manifest, inputWork);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.layout.works.manifests), true);
  assert.equal(Object.isFrozen(resolvedWork.manifest), true);
  assert.throws(() => {
    resolvedWork.manifest.title = "Mutated result";
  }, TypeError);
  assert.equal(inputWork.title, originalTitle);

  const metadataWithProtoKey = JSON.parse(
    '{"__proto__":{"polluted":"yes"},"safe":true}',
  );
  const protoWorks = new Map(input.workManifests);
  const [protoWorkPath, protoWork] = protoWorks.entries().next().value;
  protoWorks.set(protoWorkPath, {
    ...protoWork,
    metadata: metadataWithProtoKey,
  });
  const protoShapeResult = validateWorkShape(protoWorks.get(protoWorkPath));
  assert.equal(
    protoShapeResult.valid,
    true,
    JSON.stringify(protoShapeResult.diagnostics, null, 2),
  );
  const protoResult = validate({ ...input, workManifests: protoWorks });
  assert.equal(protoResult.valid, true);
  const protoSnapshot = protoResult.value.works[0].manifest.metadata;
  assert.equal(Object.hasOwn(protoSnapshot, "__proto__"), true);
  assert.equal(protoSnapshot.__proto__.polluted, "yes");
  assert.equal(Object.getPrototypeOf(protoSnapshot), Object.prototype);
  assert.equal(protoSnapshot.polluted, undefined);

  const invalidWorks = new Map(input.workManifests);
  const [workPath, work] = invalidWorks.entries().next().value;
  invalidWorks.set(workPath, {
    ...work,
    manuscript: {
      path: "outside/manuscript.md",
      relativeTo: "repository",
    },
  });
  const invalid = validate({ ...input, workManifests: invalidWorks });
  assert.equal(invalid.valid, false);
  const boundaryDiagnostic = invalid.diagnostics.find(
    ({ code }) => code === "boundary.source_outside_root",
  );
  assert.ok(boundaryDiagnostic);
  assert.notEqual(
    boundaryDiagnostic.params.sourceRoots,
    input.publication.boundaries.sourceRoots,
  );
  assert.equal(Object.isFrozen(invalid.diagnostics), true);
  assert.equal(Object.isFrozen(boundaryDiagnostic.params), true);
  assert.equal(Object.isFrozen(boundaryDiagnostic.params.sourceRoots), true);
  assert.throws(() => {
    boundaryDiagnostic.params.sourceRoots.push("another-root");
  }, TypeError);

  let deepMetadata = { leaf: true };
  const metadataDepth = 3_000;
  for (let depth = 0; depth < metadataDepth; depth += 1) {
    deepMetadata = { next: deepMetadata };
  }
  const deepWorks = new Map(input.workManifests);
  const [deepWorkPath, deepWork] = deepWorks.entries().next().value;
  deepWorks.set(deepWorkPath, { ...deepWork, metadata: deepMetadata });
  const deepResult = validate({ ...input, workManifests: deepWorks });
  assert.equal(deepResult.valid, true);

  let metadataCursor = deepResult.value.works[0].manifest.metadata;
  for (let depth = 0; depth < metadataDepth; depth += 1) {
    assert.equal(Object.isFrozen(metadataCursor), true);
    metadataCursor = metadataCursor.next;
  }
  assert.deepEqual(metadataCursor, { leaf: true });
});

test("redirect validation resolves long chains and cycles without recursion", async () => {
  const input = await loadCanonicalInput();
  const publication = structuredClone(input.publication);
  const redirectCount = 4_000;
  publication.continuity.redirects = Array.from(
    { length: redirectCount },
    (_, index) => ({
      from: `/legacy-${index}`,
      to:
        index === redirectCount - 1
          ? "/works/rain-gauge"
          : `/legacy-${index + 1}`,
      status: 308,
    }),
  );

  const result = validate({ ...input, publication });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics, null, 2));

  const cyclicPublication = structuredClone(input.publication);
  cyclicPublication.continuity.redirects = Array.from(
    { length: redirectCount },
    (_, index) => ({
      from: `/cycle-${index}`,
      to: `/cycle-${(index + 1) % redirectCount}`,
      status: 308,
    }),
  );
  const cyclicResult = validate({
    ...input,
    publication: cyclicPublication,
  });
  assert.equal(cyclicResult.valid, false);
  const loopDiagnostics = cyclicResult.diagnostics.filter(
    ({ code }) => code === "continuity.redirect.loop",
  );
  assert.equal(loopDiagnostics.length, 1);
  assert.equal(loopDiagnostics[0].params.routes.length, redirectCount + 1);
});
