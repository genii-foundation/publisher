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

import {
  resolvePublicationLayout,
  validatePublicationSemantics,
} from "../schemas/dist/index.js";
import {
  compileMarkdownWork,
  compilePublicationContent,
} from "../packages/content/dist/index.js";
import {
  projectPublicationReader,
  validatePublicationReaderEnvelope,
} from "../packages/reader/dist/index.js";

const encoder = new TextEncoder();

export const FIXTURE_ROUTES = Object.freeze({
  archivedCollection: "/collections/retired",
  archivedWork: "/works/old-record",
  externalRedirect: "/depart",
  home: "/",
  legacyRedirect: "/legacy/(cafe)+story",
  publishedCollection: "/collections/field-notes",
  publishedWork: "/works/caf%C3%A9+notes",
  sectionOne: "/readings/caf%C3%A9+one",
  sectionTwo: "/readings/plus+two",
  unlistedWork: "/works/quiet-draft",
  updates: "/updates",
});

function assertValid(result) {
  assert.equal(
    result.valid,
    true,
    JSON.stringify(result.diagnostics, null, 2),
  );
  return result.value;
}

function jsonSource(path, role, value, entityId) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  return {
    path,
    role,
    ...(entityId === undefined ? {} : { entityId }),
    mediaType: "application/json",
    contents,
    rawBytes: encoder.encode(contents),
  };
}

function createPublication(
  includeUpdates,
  homeRoute,
  externalRedirectTarget,
  publishedWorkRoute,
  publicationLanguage,
) {
  return {
    $schema:
      "https://publisher.genii.foundation/schemas/publication.schema.json",
    schemaVersion: "1.0",
    publication: {
      id: "renderer-proof",
      title: "Renderer Proof",
      description:
        "A synthetic publication that proves the official renderer contract.",
      language: publicationLanguage,
      canonicalUrl: "https://renderer-proof.example",
      publisher: {
        name: "Example Press",
        url: "https://example-press.example",
      },
    },
    engine: {
      compatibility: ">=1.0.0 <2.0.0",
    },
    layout: {
      mode: "canonical",
    },
    works: [
      { id: "published-notes" },
      { id: "unlisted-notes" },
      { id: "archived-notes" },
    ],
    collections: [
      { id: "field-notes" },
      { id: "retired-notes" },
    ],
    routes: {
      home: homeRoute,
      work: "/works/{workId}",
      collection: "/collections/{collectionId}",
      ...(includeUpdates
        ? { updates: FIXTURE_ROUTES.updates }
        : {}),
    },
    continuity: {
      redirects: [
        {
          from: FIXTURE_ROUTES.legacyRedirect,
          to: publishedWorkRoute,
          status: 308,
        },
        {
          from: FIXTURE_ROUTES.externalRedirect,
          to: externalRedirectTarget,
          status: 307,
        },
      ],
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
      sourceCodeUrl:
        "https://github.com/genii-foundation/publisher",
    },
  };
}

function createWorkManifests(
  archivedWorkRoute,
  publishedWorkRoute,
  publishedWorkLanguage,
) {
  return [
    {
      $schema:
        "https://publisher.genii.foundation/schemas/work.schema.json",
      schemaVersion: "1.0",
      id: "published-notes",
      title: "Café + Field Notes",
      summary: "Two readings used to prove section navigation.",
      language: publishedWorkLanguage,
      publicationState: "published",
      publishedAt: "2026-07-01T12:00:00Z",
      route: publishedWorkRoute,
      manuscript: "manuscript.md",
    },
    {
      $schema:
        "https://publisher.genii.foundation/schemas/work.schema.json",
      schemaVersion: "1.0",
      id: "unlisted-notes",
      title: "Quiet Draft",
      summary: "Directly addressable, but absent from the home catalog.",
      language: "en",
      publicationState: "unlisted",
      route: FIXTURE_ROUTES.unlistedWork,
      manuscript: "manuscript.md",
    },
    {
      $schema:
        "https://publisher.genii.foundation/schemas/work.schema.json",
      schemaVersion: "1.0",
      id: "archived-notes",
      title: "Old Record",
      summary: "Archived and still directly addressable.",
      language: "en",
      publicationState: "archived",
      route: archivedWorkRoute,
      manuscript: "manuscript.md",
    },
  ];
}

function createCollectionManifests() {
  return [
    {
      $schema:
        "https://publisher.genii.foundation/schemas/collection.schema.json",
      schemaVersion: "1.0",
      id: "field-notes",
      title: "Field Notes",
      description: "The public collection.",
      publicationState: "published",
      route: FIXTURE_ROUTES.publishedCollection,
      workIds: [
        "published-notes",
        "unlisted-notes",
        "archived-notes",
      ],
    },
    {
      $schema:
        "https://publisher.genii.foundation/schemas/collection.schema.json",
      schemaVersion: "1.0",
      id: "retired-notes",
      title: "Retired Notes",
      publicationState: "archived",
      route: FIXTURE_ROUTES.archivedCollection,
      workIds: ["archived-notes"],
    },
  ];
}

function markdownFor(workId) {
  switch (workId) {
    case "published-notes":
      return [
        "# Opening",
        "",
        "First *safe* line with a [good link](https://example.com).",
        "",
        "## Next",
        "",
        "Second [unsafe link](javascript:alert(1)) with <script>alert(2)</script> text.",
        "",
        "| Reading window | Tide height |",
        "| :--- | ---: |",
        "| First light | 1.4 m |",
        "| Late morning | 0.8 m |",
      ].join("\n");
    case "unlisted-notes":
      return "# Quiet Draft\n\nThis route exists without a catalog card.";
    case "archived-notes":
      return "# Old Record\n\nThe archive remains readable at its canonical route.";
    default:
      throw new TypeError(`Unknown fixture work ${workId}.`);
  }
}

function createTwoSectionWork(
  compiledWork,
  paragraphFirstSection,
) {
  const root = compiledWork.sections[0];
  assert.ok(root);
  assert.equal(root.blocks.length, 5);
  const tableBlock = root.blocks[4];
  assert.ok(tableBlock);
  assert.match(tableBlock.markdown, /^\| Reading window \|/u);
  const classifiedTableBlock = {
    ...tableBlock,
    kind: "table",
    text: "Reading window Tide height First light 1.4 m Late morning 0.8 m",
  };
  return {
    ...compiledWork,
    sections: [
      {
        id: "published-opening",
        role: "section",
        title: "Opening",
        routes: {
          reader: {
            path: FIXTURE_ROUTES.sectionOne,
          },
        },
        activeRouteNames: ["reader"],
        readerLocation: {
          kind: "route",
          routeName: "reader",
        },
        continuity: {
          id: "published-opening",
          legacyIds: [],
          progressGroups: [["published-opening"]],
          historicalSectionIds: [],
        },
        navigable: true,
        blocks: paragraphFirstSection
          ? root.blocks.slice(1, 2)
          : root.blocks.slice(0, 2),
      },
      {
        id: "published-closing",
        role: "section",
        title: "Next",
        routes: {
          reader: {
            path: FIXTURE_ROUTES.sectionTwo,
          },
        },
        activeRouteNames: ["reader"],
        readerLocation: {
          kind: "route",
          routeName: "reader",
        },
        continuity: {
          id: "published-closing",
          legacyIds: [],
          progressGroups: [["published-closing"]],
          historicalSectionIds: [],
        },
        navigable: true,
        blocks: [
          ...root.blocks.slice(2, 4),
          classifiedTableBlock,
        ],
      },
    ],
  };
}

function createWorkRouteSection(compiledWork) {
  const root = compiledWork.sections[0];
  assert.ok(root);
  return {
    ...compiledWork,
    sections: [
      {
        ...root,
        activeRouteNames: [],
        readerLocation: {
          kind: "work",
        },
      },
    ],
  };
}

function createReaderLinkFixtures(
  works,
  headingReaderLink,
  unrepresentableReaderLink,
) {
  const work = works.find(
    ({ workId }) => workId === "published-notes",
  );
  const section = work?.sections.find(
    ({ id }) => id === "published-opening",
  );
  const block = section?.blocks.find(({ markdown }) =>
    headingReaderLink
      ? markdown === "# Opening"
      : markdown.includes("First *safe* line"),
  );
  assert.ok(work);
  assert.ok(section);
  assert.ok(block);
  const selected = headingReaderLink
    ? "Opening"
    : unrepresentableReaderLink
      ? "good link"
      : "First";
  const start = block.markdown.indexOf(selected);
  assert.notEqual(start, -1);

  return [
    {
      id: "opening-source-link",
      source: {
        kind: "source",
        workId: work.workId,
        sectionId: section.id,
        blockId: block.id,
        occurrence: {
          sourcePath: block.provenance.sourcePath,
          startOffset: block.provenance.startOffset + start,
          endOffset:
            block.provenance.startOffset +
            start +
            selected.length,
        },
      },
      target: {
        kind: "section",
        workId: work.workId,
        sectionId: "published-closing",
        routeName: "reader",
      },
      href: FIXTURE_ROUTES.sectionTwo,
      label: selected,
    },
    {
      id: "opening-semantic-link",
      source: {
        kind: "semantic",
        workId: work.workId,
        sectionId: section.id,
        blockId: block.id,
      },
      target: {
        kind: "section",
        workId: work.workId,
        sectionId: "published-closing",
        routeName: "reader",
      },
      href: FIXTURE_ROUTES.sectionTwo,
      label: "Semantic navigation only",
    },
  ];
}

export async function createFixtureReader(options = {}) {
  const includeUpdates = options.includeUpdates ?? true;
  const audience = options.audience ?? "public";
  const homeRoute = options.homeRoute ?? FIXTURE_ROUTES.home;
  const archivedWorkRoute =
    options.archivedWorkRoute ?? FIXTURE_ROUTES.archivedWork;
  const externalRedirectTarget =
    options.externalRedirectTarget ??
    "https://continuity.example/new-home?source=archive";
  const publishedWorkRoute =
    options.publishedWorkRoute ?? FIXTURE_ROUTES.publishedWork;
  const publicationLanguage =
    options.publicationLanguage ?? "en";
  const publishedWorkLanguage =
    options.publishedWorkLanguage ?? "en";
  const publication = createPublication(
    includeUpdates,
    homeRoute,
    externalRedirectTarget,
    publishedWorkRoute,
    publicationLanguage,
  );
  const workManifests = createWorkManifests(
    archivedWorkRoute,
    publishedWorkRoute,
    publishedWorkLanguage,
  );
  const collectionManifests = createCollectionManifests();
  const layout = assertValid(resolvePublicationLayout(publication));
  const workManifestMap = new Map();
  const collectionManifestMap = new Map();
  const sources = [
    jsonSource(
      layout.publicationManifestPath,
      "publication-manifest",
      publication,
    ),
  ];

  for (const reference of layout.works.manifests) {
    const manifest = workManifests.find(
      ({ id }) => id === reference.id,
    );
    assert.ok(manifest);
    workManifestMap.set(reference.manifestPath, manifest);
    sources.push(
      jsonSource(
        reference.manifestPath,
        "work-manifest",
        manifest,
        reference.id,
      ),
    );
  }
  for (const reference of layout.collections.manifests) {
    const manifest = collectionManifests.find(
      ({ id }) => id === reference.id,
    );
    assert.ok(manifest);
    collectionManifestMap.set(reference.manifestPath, manifest);
    sources.push(
      jsonSource(
        reference.manifestPath,
        "collection-manifest",
        manifest,
        reference.id,
      ),
    );
  }

  const sourceGraph = assertValid(
    validatePublicationSemantics({
      publication,
      engineVersion: "1.0.0",
      workManifests: workManifestMap,
      collectionManifests: collectionManifestMap,
    }),
  );
  const works = [];
  for (const source of sourceGraph.works) {
    const compiled = assertValid(
      compileMarkdownWork({
        workId: source.workId,
        sectionId: `${source.workId}-root`,
        title: source.manifest.title,
        sourcePath: source.manuscriptPath,
        route: source.manifest.route,
        markdown: markdownFor(source.workId),
      }),
    );
    sources.push(compiled.source);
    works.push(
      source.workId === "published-notes"
        ? createTwoSectionWork(
            compiled.work,
            options.paragraphFirstPublishedSection ?? false,
          )
        : createWorkRouteSection(compiled.work),
    );
  }

  const content = assertValid(
    compilePublicationContent({
      engineVersion: "1.0.0",
      publication,
      sourceGraph,
      sources,
      works,
      links:
        options.includeReaderLinks === false
          ? []
          : createReaderLinkFixtures(
              works,
              options.headingReaderLink ?? false,
              options.unrepresentableReaderLink ?? false,
            ),
    }),
  );
  const reader = assertValid(
    projectPublicationReader(content, { audience }),
  );
  assertValid(validatePublicationReaderEnvelope(reader));
  return reader;
}
