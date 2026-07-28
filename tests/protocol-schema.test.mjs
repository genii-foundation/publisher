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

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const repositoryRoot = new URL("../", import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(relativePath, repositoryRoot), "utf8"),
  );
}

const [
  publicationSchema,
  workSchema,
  collectionSchema,
  contentEnvelopeSchema,
] = await Promise.all([
  readJson("schemas/publication.schema.json"),
  readJson("schemas/work.schema.json"),
  readJson("schemas/collection.schema.json"),
  readJson("schemas/content-envelope.schema.json"),
]);

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

const validatePublication = ajv.compile(publicationSchema);
const validateWork = ajv.compile(workSchema);
const validateCollection = ajv.compile(collectionSchema);

const canonicalPublication = {
  $schema: publicationSchema.$id,
  schemaVersion: "1.0",
  publication: {
    id: "field-notes",
    title: "Field Notes",
    language: "en",
    canonicalUrl: "https://notes.example.org",
    publisher: {
      name: "Example Press",
      url: "https://example.org",
    },
  },
  engine: {
    compatibility: ">=1.0.0 <2.0.0",
  },
  layout: {
    mode: "canonical",
  },
  works: [{ id: "first-essay" }],
  collections: [{ id: "essays" }],
  routes: {
    home: "/",
    work: "/works/{workId}",
    collection: "/collections/{collectionId}",
  },
  boundaries: {
    sourceRoots: ["publication"],
    outputRoots: [".publisher"],
  },
  attribution: {
    placement: "footer",
    copyright: "Copyright 2026 GENII Foundation",
    text: "Published with GENII Publisher",
    url: "https://publisher.genii.foundation",
    sourceCodeUrl: "https://github.com/example/field-notes",
  },
};

const canonicalWork = {
  $schema: workSchema.$id,
  schemaVersion: "1.0",
  id: "first-essay",
  title: "First Essay",
  language: "en",
  publicationState: "published",
  manuscript: "manuscript.md",
  assets: "assets",
};

const canonicalCollection = {
  $schema: collectionSchema.$id,
  schemaVersion: "1.0",
  id: "essays",
  title: "Essays",
  workIds: ["first-essay"],
};

function clone(value) {
  return structuredClone(value);
}

function validationMessage(validator) {
  return ajv.errorsText(validator.errors, { separator: "\n" });
}

test("canonical source manifests satisfy all three schemas", () => {
  assert.equal(
    validatePublication(canonicalPublication),
    true,
    validationMessage(validatePublication),
  );
  assert.equal(
    validateWork(canonicalWork),
    true,
    validationMessage(validateWork),
  );
  assert.equal(
    validateCollection(canonicalCollection),
    true,
    validationMessage(validateCollection),
  );
});

test("current schemas reject unsupported protocol versions", () => {
  const publication = clone(canonicalPublication);
  publication.schemaVersion = "999.0";
  assert.equal(validatePublication(publication), false);

  const work = clone(canonicalWork);
  work.schemaVersion = "847.3";
  assert.equal(validateWork(work), false);

  const collection = clone(canonicalCollection);
  collection.schemaVersion = "42.0";
  assert.equal(validateCollection(collection), false);
});

test("declared layout supports roots, templates, and irregular manifests", () => {
  const publication = clone(canonicalPublication);
  publication.layout = {
    mode: "declared",
    overrides: {
      works: {
        root: "archive/records",
        manifestTemplate: "{workId}/entry.json",
      },
      collections: {
        root: "catalog/groups",
        manifestTemplate: "{collectionId}/listing.json",
      },
      assets: "shared/media",
      continuity: "history/routes",
    },
  };
  publication.works.push({
    id: "legacy-preface",
    manifest: "archive/preface/metadata.json",
  });
  publication.boundaries.sourceRoots = [
    "archive",
    "catalog",
    "history",
    "legacy",
    "shared",
  ];

  assert.equal(
    validatePublication(publication),
    true,
    validationMessage(validatePublication),
  );
});

test("work paths distinguish manifest-relative and repository-relative input", () => {
  const work = clone(canonicalWork);
  work.manuscript = {
    path: "archive/manuscripts/first-essay.md",
    relativeTo: "repository",
  };

  assert.equal(validateWork(work), true, validationMessage(validateWork));
});

test("fixed attribution cannot be removed or rewritten", () => {
  const publication = clone(canonicalPublication);
  publication.attribution.text = "Powered by something else";

  assert.equal(validatePublication(publication), false);
});

test("declared manifest templates require their semantic ID token", () => {
  const publication = clone(canonicalPublication);
  publication.layout = {
    mode: "declared",
    overrides: {
      works: {
        root: "content",
        manifestTemplate: "work.json",
      },
    },
  };

  assert.equal(validatePublication(publication), false);
});

test("repository paths reject unsafe or ambiguous syntax", () => {
  for (const manuscript of [
    "/private/manuscript.md",
    "../manuscript.md",
    "content/../manuscript.md",
    String.raw`content\manuscript.md`,
    "content/%2e%2e/manuscript.md",
    "content/%2Fmanuscript.md",
    "content/manuscript.md?draft",
    "content/manuscript.md#section",
    "content/\u0000manuscript.md",
    "content/con/manuscript.md",
    "content/PRN.txt/manuscript.md",
    "content/com1.log/manuscript.md",
    "content/bad:name/manuscript.md",
    "content/bad<name>/manuscript.md",
    "content/bad\"name/manuscript.md",
    "content/bad|name/manuscript.md",
    "content/bad*name/manuscript.md",
    "content/trailing./manuscript.md",
    "content/trailing /manuscript.md",
  ]) {
    const work = clone(canonicalWork);
    work.manuscript = manuscript;
    assert.equal(validateWork(work), false, manuscript);
  }
});

test("stable IDs reject Windows reserved device basenames", () => {
  for (const id of ["con", "nul.txt", "com1", "lpt9.log"]) {
    const publication = clone(canonicalPublication);
    publication.works[0].id = id;
    assert.equal(validatePublication(publication), false, id);

    const work = clone(canonicalWork);
    work.id = id;
    assert.equal(validateWork(work), false, id);

    const collection = clone(canonicalCollection);
    collection.id = id;
    assert.equal(validateCollection(collection), false, id);
  }

  for (const id of ["conifer", "aux-notes", "com10", "lpt0", "nulled"]) {
    const work = clone(canonicalWork);
    work.id = id;
    assert.equal(validateWork(work), true, validationMessage(validateWork));
  }
});

test("concrete route schemas share one canonical ASCII serialization", () => {
  const concreteRoutePatterns = {
    publication: publicationSchema.$defs.nonRootRoutePath.pattern,
    work: workSchema.$defs.routePath.oneOf[1].pattern,
    collection: collectionSchema.$defs.routePath.oneOf[1].pattern,
    contentEnvelope:
      contentEnvelopeSchema.$defs.routePath.oneOf[1].pattern,
  };
  assert.equal(
    new Set(Object.values(concreteRoutePatterns)).size,
    1,
    JSON.stringify(concreteRoutePatterns, null, 2),
  );

  const validRoutes = [
    "/",
    "/notes",
    "/notes/",
    "/caf%C3%A9",
    "/caf%C3%A9/",
    "/%E6%9D%B1%E4%BA%AC",
    "/%E6%9D%B1%E4%BA%AC/",
    "/~reader:@v1!$&'()*+,;=",
  ];
  for (const route of validRoutes) {
    const publication = clone(canonicalPublication);
    publication.routes.home = route;
    assert.equal(
      validatePublication(publication),
      true,
      `publication ${route}: ${validationMessage(validatePublication)}`,
    );

    const work = clone(canonicalWork);
    work.route = route;
    assert.equal(
      validateWork(work),
      true,
      `work ${route}: ${validationMessage(validateWork)}`,
    );

    const collection = clone(canonicalCollection);
    collection.route = route;
    assert.equal(
      validateCollection(collection),
      true,
      `collection ${route}: ${validationMessage(validateCollection)}`,
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
    const publication = clone(canonicalPublication);
    publication.routes.home = route;
    assert.equal(validatePublication(publication), false, `publication ${label}`);

    const work = clone(canonicalWork);
    work.route = route;
    assert.equal(validateWork(work), false, `work ${label}`);

    const collection = clone(canonicalCollection);
    collection.route = route;
    assert.equal(validateCollection(collection), false, `collection ${label}`);
  }
});

test("route templates preserve only their one required literal token", () => {
  for (const [workRoute, collectionRoute] of [
    ["/works/{workId}", "/collections/{collectionId}"],
    ["/works/{workId}/", "/collections/{collectionId}/"],
    [
      "/caf%C3%A9/{workId}",
      "/%E6%9D%B1%E4%BA%AC/{collectionId}/",
    ],
  ]) {
    const publication = clone(canonicalPublication);
    publication.routes.work = workRoute;
    publication.routes.collection = collectionRoute;
    assert.equal(
      validatePublication(publication),
      true,
      validationMessage(validatePublication),
    );
  }

  for (const route of [
    "/works/workId",
    "/works/{collectionId}",
    "/works/{workId}/{workId}",
    "/works/{workId}/{sectionId}",
    "/works/{workid}",
    "/works/{workId",
    "/works/%7BworkId%7D",
    "/caf%c3%a9/{workId}",
    "/%E9/{workId}",
  ]) {
    const publication = clone(canonicalPublication);
    publication.routes.work = route;
    assert.equal(validatePublication(publication), false, route);
  }

  for (const route of [
    "/collections/collectionId",
    "/collections/{workId}",
    "/collections/{collectionId}/{collectionId}",
    "/collections/{collectionId}/{shelfId}",
    "/collections/{collectionid}",
    "/collections/{collectionId",
    "/collections/%7BcollectionId%7D",
    "/caf%c3%a9/{collectionId}",
    "/%E9/{collectionId}",
  ]) {
    const publication = clone(canonicalPublication);
    publication.routes.collection = route;
    assert.equal(validatePublication(publication), false, route);
  }
});

test("shape schemas leave decoded NFC normalization to semantic validation", () => {
  const decomposedRoute = "/e%CC%81";

  const publication = clone(canonicalPublication);
  publication.routes.home = decomposedRoute;
  assert.equal(
    validatePublication(publication),
    true,
    validationMessage(validatePublication),
  );

  const work = clone(canonicalWork);
  work.route = decomposedRoute;
  assert.equal(validateWork(work), true, validationMessage(validateWork));

  const collection = clone(canonicalCollection);
  collection.route = decomposedRoute;
  assert.equal(
    validateCollection(collection),
    true,
    validationMessage(validateCollection),
  );
});

test("catalog references cannot duplicate authoritative work metadata", () => {
  const publication = clone(canonicalPublication);
  publication.works[0].title = "Duplicated title";

  assert.equal(validatePublication(publication), false);
});

test("sync is opt in and preserves local fallback", () => {
  const publication = clone(canonicalPublication);
  publication.sync = {
    provider: {
      package: "@example/sync-provider",
    },
    consent: "opt-in",
    localFallback: true,
    capabilities: ["progress", "bookmarks"],
  };

  assert.equal(
    validatePublication(publication),
    true,
    validationMessage(validatePublication),
  );

  publication.sync.localFallback = false;
  assert.equal(validatePublication(publication), false);
});
