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
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  compileMarkdownWork,
  serializePublicationContentEnvelope,
  validatePublicationContentEnvelope,
} from "../packages/content/dist/index.js";
import {
  PUBLISHER_VERSION,
} from "../packages/publisher/dist/index.js";
import {
  compileLoadedPublicationContent,
  loadPublicationCompilationSources,
} from "../packages/publisher/dist/node.js";
import {
  nodePublicationFileSystem,
} from "../packages/publisher/dist/node/filesystem-identity.js";
import {
  loadPublicationCompilationSourcesWithFileSystem,
} from "../packages/publisher/dist/node/loader.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtureRoot = join(repositoryRoot, "fixtures");
const textEncoder = new TextEncoder();

function validationMessage(result) {
  return JSON.stringify(result.diagnostics, null, 2);
}

function assertValid(result) {
  assert.equal(result.valid, true, validationMessage(result));
  return result.value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceIdentities(sources) {
  return sources
    .map(({ path, role, entityId }) => ({
      path,
      role,
      ...(entityId === undefined ? {} : { entityId }),
    }))
    .sort(
      (left, right) =>
        compareText(left.path, right.path) ||
        compareText(left.role, right.role) ||
        compareText(left.entityId ?? "", right.entityId ?? ""),
    );
}

function resolvedExtensions(publication) {
  return (publication.extensions ?? []).map((extension) => ({
    id: extension.id,
    package: extension.package,
    version: PUBLISHER_VERSION,
    capabilities: extension.capabilities,
  }));
}

function deriveMinimalWorkInputs(loaded) {
  const manuscriptByWorkId = new Map(
    loaded.sources
      .filter(({ role }) => role === "manuscript")
      .map((source) => [source.entityId, source]),
  );

  return loaded.sourceGraph.works.map((work) => {
    const manuscript = manuscriptByWorkId.get(work.workId);
    assert.ok(manuscript, `Missing manuscript for ${work.workId}.`);
    assert.equal(typeof manuscript.contents, "string");
    assert.equal(manuscript.path, work.manuscriptPath);

    const derived = assertValid(
      compileMarkdownWork({
        workId: work.workId,
        sectionId: `${work.workId}-root`,
        title: work.manifest.title,
        sourcePath: work.manuscriptPath,
        markdown: manuscript.contents,
      }),
    );
    assert.equal(derived.source.path, manuscript.path);
    assert.equal(derived.source.contents, manuscript.contents);
    assert.deepEqual(derived.source.rawBytes, manuscript.rawBytes);
    return derived.work;
  });
}

async function loadAndCompile(publicationRoot) {
  const loaded = assertValid(
    await loadPublicationCompilationSources({ publicationRoot }),
  );
  const works = deriveMinimalWorkInputs(loaded);
  const compileInput = {
    loaded,
    works,
    extensions: resolvedExtensions(loaded.publication),
  };

  assert.strictEqual(compileInput.loaded, loaded);

  const envelope = assertValid(
    compileLoadedPublicationContent(compileInput),
  );
  assertValid(validatePublicationContentEnvelope(envelope));
  const serialized = serializePublicationContentEnvelope(envelope);
  return {
    envelope,
    loaded,
    serialized,
    bytes: textEncoder.encode(serialized),
  };
}

test("public compilation accepts only the exact loader-issued snapshot and installed version", async () => {
  const publicationRoot = join(fixtureRoot, "canonical-field-notes");
  const loaded = assertValid(
    await loadPublicationCompilationSources({ publicationRoot }),
  );
  const works = deriveMinimalWorkInputs(loaded);
  const extensions = resolvedExtensions(loaded.publication);

  const copied = compileLoadedPublicationContent({
    loaded: structuredClone(loaded),
    works,
    extensions,
  });
  assert.equal(copied.valid, false);
  assert.deepEqual(
    copied.diagnostics.map(({ code, path }) => [code, path]),
    [["publisher.snapshot.untrusted", "/loaded"]],
  );

  const versionOverride = compileLoadedPublicationContent({
    loaded,
    works,
    extensions,
    engineVersion: "9.9.9",
  });
  assert.equal(versionOverride.valid, false);
  assert.deepEqual(
    versionOverride.diagnostics.map(({ code, path, params }) => [
      code,
      path,
      params.reason,
    ]),
    [
      [
        "publisher.compile_input.invalid",
        "/engineVersion",
        "unexpectedProperty",
      ],
    ],
  );

  for (const forbiddenKey of [
    "publication",
    "sourceGraph",
    "sources",
    "assets",
    "payloads",
  ]) {
    const forbidden = compileLoadedPublicationContent({
      loaded,
      works,
      extensions,
      [forbiddenKey]: [],
    });
    assert.equal(forbidden.valid, false);
    assert.deepEqual(
      forbidden.diagnostics.map(({ code, path, params }) => [
        code,
        path,
        params.reason,
      ]),
      [
        [
          "publisher.compile_input.invalid",
          `/${forbiddenKey}`,
          "unexpectedProperty",
        ],
      ],
    );
  }

  const compiled = assertValid(
    compileLoadedPublicationContent({
      loaded,
      works,
      extensions,
    }),
  );
  assert.equal(compiled.engineVersion, PUBLISHER_VERSION);
});

test("the injected filesystem seam cannot mint a trusted compilation snapshot", async () => {
  const publicationRoot = join(fixtureRoot, "canonical-field-notes");
  const seamLoaded = assertValid(
    await loadPublicationCompilationSourcesWithFileSystem(
      { publicationRoot },
      nodePublicationFileSystem,
    ),
  );
  const result = compileLoadedPublicationContent({
    loaded: seamLoaded,
    works: deriveMinimalWorkInputs(seamLoaded),
    extensions: resolvedExtensions(seamLoaded.publication),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, path }) => [code, path]),
    [["publisher.snapshot.untrusted", "/loaded"]],
  );
});

test("public compilation inspects its authority-bearing input without invoking accessors", () => {
  let accessorInvoked = false;
  const accessorInput = {
    works: [],
    get loaded() {
      accessorInvoked = true;
      throw new Error("must not execute");
    },
  };
  const accessorResult =
    compileLoadedPublicationContent(accessorInput);
  assert.equal(accessorResult.valid, false);
  assert.equal(accessorInvoked, false);
  assert.deepEqual(
    accessorResult.diagnostics.map(({ code, path, params }) => [
      code,
      path,
      params.reason,
    ]),
    [
      [
        "publisher.compile_input.invalid",
        "/loaded",
        "nonDataProperty",
      ],
    ],
  );

  const proxyResult = compileLoadedPublicationContent(
    new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("must be contained");
        },
      },
    ),
  );
  assert.equal(proxyResult.valid, false);
  assert.deepEqual(
    proxyResult.diagnostics.map(({ code, path, params }) => [
      code,
      path,
      params.reason,
    ]),
    [["publisher.compile_input.invalid", "", "uninspectable"]],
  );
});

for (const fixture of [
  {
    name: "canonical-field-notes",
    expectedWorkIds: ["rain-gauge"],
    expectedCollectionIds: ["weather-observations"],
  },
  {
    name: "declared-night-dispatch",
    expectedWorkIds: ["signal-lantern", "platform-bell"],
    expectedCollectionIds: ["after-dark"],
  },
]) {
  test(`loader output compiles directly and repeatably for ${fixture.name}`, async () => {
    const publicationRoot = join(fixtureRoot, fixture.name);
    const first = await loadAndCompile(publicationRoot);
    const second = await loadAndCompile(publicationRoot);

    assert.deepEqual(
      first.envelope.works.map(({ id }) => id),
      fixture.expectedWorkIds,
    );
    assert.deepEqual(
      first.envelope.collections.map(({ id }) => id),
      fixture.expectedCollectionIds,
    );
    assert.deepEqual(
      sourceIdentities(first.envelope.sources),
      sourceIdentities(first.loaded.sources),
    );
    assert.equal(first.envelope.engineVersion, PUBLISHER_VERSION);
    assert.equal(first.serialized, second.serialized);
    assert.deepEqual(first.bytes, second.bytes);
    assert.equal(first.envelope.buildId, second.envelope.buildId);
    assert.equal(
      first.envelope.hashes.sourceSet,
      second.envelope.hashes.sourceSet,
    );
    assert.equal(
      first.envelope.hashes.content,
      second.envelope.hashes.content,
    );
  });
}
