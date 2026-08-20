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
import test from "node:test";

import {
  canonicalizeJson,
  hashCanonicalJson,
  sha256,
} from "@genii-foundation/publisher-content";
import {
  createElement,
} from "react";
import {
  renderToStaticMarkup,
} from "react-dom/server";
import {
  createReaderBookmarksStorageKey,
} from "../packages/reader/dist/bookmarks.js";
import {
  createReaderNarrationPreferencesStorageKey,
} from "../packages/reader/dist/narration.js";
import {
  createReaderPreferencesStorageKey,
} from "../packages/reader/dist/preferences.js";
import {
  createReaderProgressStorageKey,
} from "../packages/reader/dist/progress.js";
import {
  createReaderEngagementStorageKey,
  createReaderSyncConsentStorageKey,
} from "../packages/reader/dist/sync.js";

import {
  createPublicationNextApplication,
} from "../packages/next/dist/server/application.js";
import {
  createPublisherReaderStateBootstrapSource,
} from "../packages/next/dist/client/reader-prepaint.js";
import {
  resolveDefaultPublisherNextTheme,
} from "../packages/next/dist/theme/default.js";
import {
  PublisherMarkdownBlock,
  PublisherMarkdownInline,
  publisherMarkdownUrlTransform,
} from "../packages/next/dist/components/markdown.js";
import {
  PublisherNextErrorPage,
  PublisherNextFrameworkErrorPage,
  PublisherNextGlobalErrorPage,
} from "../packages/next/dist/client/error.js";
import {
  createPublisherNextErrorIdentity,
} from "../packages/next/dist/error-identity.js";
import {
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_CONTAINERS,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_DEPTH,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_ENTRIES,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SCRIPT_BYTES,
  PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_STATIC_SCRIPT_BYTES,
} from "../packages/next/dist/index.js";

import {
  createFixtureReader,
  FIXTURE_ROUTES,
} from "./next-fixture.mjs";

function assertValid(result) {
  assert.equal(
    result.valid,
    true,
    JSON.stringify(result.diagnostics, null, 2),
  );
  return result.value;
}

function createUpdates(config = {}, loadOverride) {
  return {
    package: "@example/updates-renderer",
    version: "1.2.3",
    rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
    config,
    implementation: {
      kind: "genii.publisher.next-updates",
      apiVersion: "1.0",
      configure(snapshot) {
        return {
          valid: true,
          value: {
            load(page) {
              if (loadOverride !== undefined) {
                return loadOverride(page, snapshot);
              }
              return {
                title: "Publication Updates",
                description:
                  snapshot.label ?? "Stable history",
                entries: [
                  {
                    id: "release-1",
                    title: "Initial release",
                    summary: `Recorded at ${page.path}`,
                    publishedAt: "2026-07-28",
                    href: FIXTURE_ROUTES.publishedWork,
                  },
                ],
              };
            },
          },
          diagnostics: [],
        };
      },
    },
  };
}

function createReaderStateBootstrap({
  config = {},
  createProjection,
  createSource = () =>
    'return { schemaVersion: "1.0", copied: [], refused: [] };',
  implementation = {},
} = {}) {
  return {
    package: "@example/reader-state-bootstrap",
    version: "1.2.3",
    rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
    config,
    implementation: {
      kind: "genii.publisher.next-reader-state-bootstrap",
      apiVersion: "1.1",
      configure(snapshot) {
        return {
          valid: true,
          value: {
            ...(createProjection === undefined
              ? {}
              : {
                  createProjection(context) {
                    return {
                      valid: true,
                      value: createProjection(context, snapshot),
                      diagnostics: [],
                    };
                  },
                }),
            createSource(context) {
              return {
                valid: true,
                value: createSource(context, snapshot),
                diagnostics: [],
              };
            },
          },
          diagnostics: [],
        };
      },
      ...implementation,
    },
  };
}

async function createApplication(options = {}) {
  const reader =
    options.reader ??
    (await createFixtureReader({
      includeUpdates: options.includeUpdates ?? true,
    }));
  const includeUpdates = reader.routes.active.some(
    ({ target }) => target.kind === "updates",
  );
  return assertValid(
    await createPublicationNextApplication({
      reader,
      ...(options.readerStateBootstrap === undefined
        ? {}
        : {
            readerStateBootstrap:
              options.readerStateBootstrap,
          }),
      ...(options.syncData === undefined ? {} : { syncData: options.syncData }),
      theme:
        options.theme ?? resolveDefaultPublisherNextTheme(),
      ...(options.omitUpdates || !includeUpdates
        ? {}
        : { updates: options.updates ?? createUpdates() }),
    }),
  );
}

async function renderResolved(application, segments) {
  const resolution = application.resolveRoute(segments);
  assert.equal(
    resolution.status,
    "resolved",
    JSON.stringify(resolution),
  );
  return renderToStaticMarkup(
    await application.renderPage(resolution.page),
  );
}

function headingOutline(html) {
  return [...html.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/gu)].map(
    ([, level, contents]) => ({
      level: Number(level),
      text: contents.replace(/<[^>]+>/gu, ""),
    }),
  );
}

function withoutFocusMarkup(html) {
  let normalized = html;
  let previous;
  do {
    previous = normalized;
    normalized = normalized.replace(
      /<span(?=[^>]*class="[^"]*publisher-(?:focus|narration)-)[^>]*>([^<]*)<\/span>/gu,
      "$1",
    );
  } while (normalized !== previous);
  return normalized;
}

test("home catalogs expose only published works and collections", async () => {
  const application = await createApplication();
  const resolution = application.resolveRoute(undefined);
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.page.kind, "home");
  assert.deepEqual(
    resolution.page.works.map(({ id }) => id),
    ["published-notes"],
  );
  assert.deepEqual(
    resolution.page.collections.map(({ id }) => id),
    ["field-notes"],
  );

  const html = await renderResolved(application, undefined);
  assert.match(html, /Café \+ Field Notes/);
  assert.match(html, /Field Notes/);
  assert.match(html, /class="publisher-reader-rail"/u);
  assert.match(html, /aria-label="Reader tools"/u);
  assert.match(html, />Contents</u);
  assert.match(html, />Search</u);
  assert.match(html, />Bookmarks</u);
  assert.match(html, />Settings</u);
  assert.doesNotMatch(html, />Sync</u);
  assert.doesNotMatch(html, /Quiet Draft/);
  assert.doesNotMatch(html, /Old Record/);
  assert.doesNotMatch(html, /Retired Notes/);
  assert.deepEqual(headingOutline(html), [
    { level: 1, text: "Renderer Proof" },
    { level: 2, text: "Works" },
    { level: 3, text: "Café + Field Notes" },
    { level: 2, text: "Collections" },
    { level: 3, text: "Field Notes" },
  ]);
});

test("a matching synchronization artifact enables only the progressive account surface", async () => {
  const reader = await createFixtureReader({ includeUpdates: false });
  const syncData = {
    $schema: "https://publisher.genii.foundation/schemas/sync-envelope.schema.json",
    schemaVersion: "1.0",
    publicationId: reader.publicationId,
    engineVersion: reader.engineVersion,
    buildId: reader.buildId,
    provider: { package: "@example/provider" },
    consent: "opt-in",
    localFallback: true,
    capabilities: ["account-deletion", "progress"],
  };
  const application = await createApplication({ reader, syncData });
  const html = await renderResolved(application, undefined);
  assert.match(html, />Sync</u);
  assert.doesNotMatch(html, /provider|supabase|service-role/ui);
  assert.deepEqual(application.manifest.sync, {
    schemaVersion: "1.0",
    buildId: reader.buildId,
    providerPackage: "@example/provider",
    consent: "opt-in",
    localFallback: true,
    capabilities: ["account-deletion", "progress"],
  });
  const localOnly = await createApplication({ reader });
  assert.notEqual(application.manifest.buildId, localOnly.manifest.buildId);

  const mismatched = await createPublicationNextApplication({
    reader,
    syncData: { ...syncData, buildId: `sha256:${"b".repeat(64)}` },
  });
  assert.equal(mismatched.valid, false);
  assert.equal(mismatched.diagnostics[0].code, "next.sync.identity_mismatch");
});

test("unlisted and archived works remain directly readable", async () => {
  const application = await createApplication();
  const cases = [
    {
      segments: ["works", "quiet-draft"],
      kind: "work",
      state: "unlisted",
      title: "Quiet Draft",
    },
    {
      segments: ["works", "old-record"],
      kind: "work",
      state: "archived",
      title: "Old Record",
    },
    {
      segments: ["collections", "retired"],
      kind: "collection",
      state: "archived",
      title: "Retired Notes",
    },
  ];

  for (const item of cases) {
    const resolution = application.resolveRoute(item.segments);
    assert.equal(resolution.status, "resolved");
    assert.equal(resolution.page.kind, item.kind);
    const entity =
      resolution.page.kind === "work"
        ? resolution.page.work
        : resolution.page.collection;
    assert.equal(entity.publicationState, item.state);
    const html = renderToStaticMarkup(
      await application.renderPage(resolution.page),
    );
    assert.match(withoutFocusMarkup(html), new RegExp(item.title));
    if (resolution.page.kind === "work") {
      assert.deepEqual(headingOutline(html), [
        { level: 1, text: item.title },
      ]);
    }
  }
});

test("collection catalogs do not advertise direct-only works", async () => {
  const application = await createApplication();
  const resolution = application.resolveRoute([
    "collections",
    "field-notes",
  ]);
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.page.kind, "collection");
  assert.deepEqual(
    resolution.page.collection.workIds,
    [
      "published-notes",
      "unlisted-notes",
      "archived-notes",
    ],
  );
  assert.deepEqual(
    resolution.page.works.map(({ id }) => id),
    ["published-notes"],
  );
  const html = renderToStaticMarkup(
    await application.renderPage(resolution.page),
  );
  assert.match(html, /Café \+ Field Notes/);
  assert.doesNotMatch(html, /Quiet Draft/);
  assert.doesNotMatch(html, /Old Record/);
});

test("section pages preserve adjacency and render Markdown safely", async () => {
  const application = await createApplication();
  const workHtml = await renderResolved(application, [
    "works",
    "café+notes",
  ]);
  const semanticWorkHtml = withoutFocusMarkup(workHtml);
  assert.deepEqual(headingOutline(workHtml), [
    { level: 1, text: "Café + Field Notes" },
    { level: 2, text: "Opening" },
    { level: 2, text: "Next" },
  ]);
  assert.match(
    semanticWorkHtml,
    /<a href="\/readings\/plus\+two">First<\/a>/u,
  );
  assert.doesNotMatch(workHtml, /Semantic navigation only/u);
  const first = application.resolveRoute([
    "readings",
    "café+one",
  ]);
  assert.equal(first.status, "resolved");
  assert.equal(first.page.kind, "section");
  assert.equal(first.page.previous, null);
  assert.equal(first.page.next?.id, "published-closing");

  const firstHtml = renderToStaticMarkup(
    await application.renderPage(first.page),
  );
  const semanticFirstHtml = withoutFocusMarkup(firstHtml);
  assert.deepEqual(headingOutline(firstHtml), [
    { level: 1, text: "Opening" },
  ]);
  assert.match(firstHtml, /class="publisher-breadcrumbs"/u);
  assert.match(firstHtml, /aria-label="Breadcrumb"/u);
  assert.match(firstHtml, /aria-current="page">Opening<\/span>/u);
  assert.match(firstHtml, /aria-label="Copy link to Opening"/u);
  assert.match(firstHtml, /class="publisher-heading-action"[^>]*hidden=""/u);
  assert.match(semanticFirstHtml, /<em>safe<\/em>/);
  assert.match(
    semanticFirstHtml,
    /<a href="\/readings\/plus\+two">First<\/a>/u,
  );
  assert.doesNotMatch(firstHtml, /Semantic navigation only/u);
  assert.match(
    semanticFirstHtml,
    /href="https:\/\/example\.com">good link<\/a>/u,
  );
  for (const block of first.page.section.blocks) {
    assert.notEqual(block.domId, null);
    assert.match(
      firstHtml,
      new RegExp(`id="${block.domId}"`),
    );
  }
  for (const section of first.page.work.sections) {
    for (const block of section.blocks) {
      assert.equal(
        workHtml.includes(`id="${block.domId}"`),
        false,
      );
    }
  }
  assert.match(
    firstHtml,
    new RegExp(
      `href="${FIXTURE_ROUTES.sectionTwo.replaceAll("+", "\\+")}"`,
    ),
  );

  const second = application.resolveRoute([
    "readings",
    "plus+two",
  ]);
  assert.equal(second.status, "resolved");
  assert.equal(second.page.kind, "section");
  assert.equal(second.page.previous?.id, "published-opening");
  assert.equal(second.page.next, null);
  const secondHtml = renderToStaticMarkup(
    await application.renderPage(second.page),
  );
  assert.doesNotMatch(secondHtml, /<script[\s>]/iu);
  assert.doesNotMatch(secondHtml, /href="javascript:/iu);
  assert.doesNotMatch(secondHtml, /<a[^>]*>unsafe link<\/a>/iu);
  assert.doesNotMatch(secondHtml, /onerror=/iu);
  assert.match(secondHtml, /class="publisher-table-region"/u);
  assert.match(secondHtml, /role="region"/u);
  assert.match(secondHtml, /tabindex="0"/u);
  assert.match(secondHtml, /Reading window/u);
  assert.match(secondHtml, /Tide height/u);
  assert.equal(secondHtml.match(/scope="col"/gu)?.length, 2);
  assert.match(
    secondHtml,
    new RegExp(
      `href="${FIXTURE_ROUTES.sectionOne.replaceAll("+", "\\+")}"`,
    ),
  );
});

test("paragraph-first sections retain normalized section headings", async () => {
  const application = await createApplication({
    reader: await createFixtureReader({
      paragraphFirstPublishedSection: true,
    }),
  });
  const html = await renderResolved(application, [
    "works",
    "café+notes",
  ]);
  assert.deepEqual(headingOutline(html), [
    { level: 1, text: "Café + Field Notes" },
    { level: 2, text: "Opening" },
    { level: 2, text: "Next" },
  ]);
  assert.match(
    withoutFocusMarkup(html),
    /<a href="\/readings\/plus\+two">First<\/a> <em>safe<\/em> line/u,
  );
});

test("source-backed heading links survive normalized work and section outlines", async () => {
  const application = await createApplication({
    reader: await createFixtureReader({
      headingReaderLink: true,
    }),
  });
  const workHtml = await renderResolved(application, [
    "works",
    "café+notes",
  ]);
  assert.match(
    withoutFocusMarkup(workHtml),
    /<h2[^>]*><a href="\/readings\/plus\+two">Opening<\/a><\/h2>/u,
  );
  assert.deepEqual(headingOutline(workHtml), [
    { level: 1, text: "Café + Field Notes" },
    { level: 2, text: "Opening" },
    { level: 2, text: "Next" },
  ]);

  const sectionHtml = await renderResolved(application, [
    "readings",
    "café+one",
  ]);
  assert.match(
    withoutFocusMarkup(sectionHtml),
    /<h1[^>]*><a href="\/readings\/plus\+two">Opening<\/a><\/h1>/u,
  );
  assert.deepEqual(headingOutline(sectionHtml), [
    { level: 1, text: "Opening" },
  ]);
  assert.doesNotMatch(sectionHtml, /Semantic navigation only/u);
});

test("authored work languages and English renderer chrome are scoped", async () => {
  const frenchPublication = await createApplication({
    reader: await createFixtureReader({
      publicationLanguage: "fr",
      publishedWorkLanguage: "en",
    }),
  });
  const root = renderToStaticMarkup(
    frenchPublication.RootLayout({
      children: await frenchPublication.RootPage(),
    }),
  );
  assert.match(root, /<html lang="fr">/u);
  assert.match(root, /data-publisher-reader-prepaint=""/u);
  assert.match(
    root,
    /genii\.publisher\.reader\.preferences\.v1\.renderer-proof/u,
  );
  assert.ok(
    root.indexOf("data-publisher-reader-prepaint") <
      root.indexOf("<body>"),
  );
  assert.match(root, /<h2 id="publisher-works-heading" lang="en">/u);
  assert.match(root, /class="publisher-skip-link"[^>]*lang="en"/u);

  const englishPublication = await createApplication({
    reader: await createFixtureReader({
      publicationLanguage: "en",
      publishedWorkLanguage: "fr",
    }),
  });
  const work = await renderResolved(englishPublication, undefined);
  assert.match(
    work,
    /<li lang="fr"><h3><a href="\/works\/caf%C3%A9\+notes">/u,
  );
  assert.match(
    work,
    /class="publisher-reading-stat" lang="en"/u,
  );
});

test("Reader state bootstrap is ordered, frozen, and bound to application identity", async () => {
  let receivedContext;
  let receivedConfig;
  const source = [
    'const legacy = localStorage.getItem("legacy.preferences");',
    "if (legacy !== null && localStorage.getItem(context.targetStorageKeys.preferences) === null) {",
    "  localStorage.setItem(context.targetStorageKeys.preferences, legacy);",
    '  return { schemaVersion: "1.0", copied: ["preferences"], refused: [] };',
    "}",
    'return { schemaVersion: "1.0", copied: [], refused: [] };',
  ].join("\n");
  const application = await createApplication({
    readerStateBootstrap: createReaderStateBootstrap({
      config: { legacyPrefix: "legacy" },
      createSource(context, config) {
        receivedContext = context;
        receivedConfig = config;
        return source;
      },
    }),
  });

  assert.equal(Object.isFrozen(receivedContext), true);
  assert.equal(Object.isFrozen(receivedContext.targetStorageKeys), true);
  assert.equal(Object.isFrozen(receivedConfig), true);
  assert.equal(receivedContext.publicationId, "renderer-proof");
  assert.equal(
    receivedContext.targetStorageKeys.preferences,
    "genii.publisher.reader.preferences.v1.renderer-proof",
  );
  assert.equal(
    receivedContext.targetStorageKeys.progress,
    "genii.publisher.reader.progress.v1.renderer-proof",
  );
  assert.equal(
    receivedContext.targetStorageKeys.bookmarks,
    "genii.publisher.reader.bookmarks.v1.renderer-proof",
  );
  assert.equal(
    receivedContext.targetStorageKeys.syncConsent,
    "genii.publisher.reader.sync-consent.v1.renderer-proof",
  );
  assert.equal(
    receivedContext.targetStorageKeys.engagement,
    "genii.publisher.reader.engagement.v1.renderer-proof",
  );
  assert.equal(
    receivedContext.targetStorageKeys.narrationPreferences,
    "genii.publisher.reader.renderer-proof.narration",
  );
  assert.deepEqual(application.manifest.readerStateBootstrap, {
    package: "@example/reader-state-bootstrap",
    version: "1.2.3",
    rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
    apiVersion: "1.1",
    configHash: hashCanonicalJson({ legacyPrefix: "legacy" }),
    sourceHash: sha256(source),
    projection: null,
  });
  assert.equal(application.manifest.schemaVersion, "1.2");

  const root = renderToStaticMarkup(
    application.RootLayout({ children: "proof" }),
  );
  assert.match(root, /data-publisher-reader-state-bootstrap=""/u);
  assert.ok(
    root.indexOf("data-publisher-reader-state-bootstrap") <
      root.indexOf("data-publisher-reader-prepaint"),
  );
  assert.ok(
    root.indexOf("data-publisher-reader-prepaint") <
      root.indexOf("<body>"),
  );
  assert.match(
    root,
    /genii\.publisher\.reader-state-bootstrap\.v1\.renderer-proof/u,
  );

  const changed = await createApplication({
    readerStateBootstrap: createReaderStateBootstrap({
      config: { legacyPrefix: "changed" },
      createSource: () => source,
    }),
  });
  assert.notEqual(
    changed.manifest.readerStateBootstrap.configHash,
    application.manifest.readerStateBootstrap.configHash,
  );
  assert.notEqual(
    changed.manifest.buildId,
    application.manifest.buildId,
  );
});

test("Reader state bootstrap snapshots a public projection and binds its exact envelope", async () => {
  let projectionCalls = 0;
  let sourceCalls = 0;
  const invocationOrder = [];
  let projectionContext;
  let sourceContext;
  const projectionData = JSON.parse(
    '{"zeta":[{"value":"proof"}],"__proto__":{"safe":true},"alpha":1}',
  );
  projectionData.special = 'line\n"\\💡';
  const source = [
    "if (projection === null || !Object.isFrozen(projection) || !Object.isFrozen(projection.data) || !Object.isFrozen(projection.data.zeta[0])) throw new Error(\"projection not frozen\");",
    'return { schemaVersion: "1.0", copied: [], refused: [] };',
  ].join("\n");
  const application = await createApplication({
    readerStateBootstrap: createReaderStateBootstrap({
      createProjection(context) {
        projectionCalls += 1;
        invocationOrder.push("projection");
        projectionContext = context;
        return projectionData;
      },
      createSource(context) {
        sourceCalls += 1;
        invocationOrder.push("source");
        sourceContext = context;
        return source;
      },
    }),
  });
  const expectedEnvelope = {
    buildId: application.reader.buildId,
    data: projectionData,
    engineVersion: application.reader.engineVersion,
    publicationId: "renderer-proof",
    schemaVersion: "1.0",
  };
  const expectedText = canonicalizeJson(expectedEnvelope);
  assert.equal(projectionCalls, 1);
  assert.equal(sourceCalls, 1);
  assert.deepEqual(invocationOrder, ["projection", "source"]);
  assert.equal(projectionContext, sourceContext);
  assert.equal(Object.isFrozen(projectionContext), true);
  assert.deepEqual(application.manifest.readerStateBootstrap.projection, {
    schemaVersion: "1.0",
    byteSize: new TextEncoder().encode(expectedText).length,
    hash: sha256(expectedText),
  });

  projectionData.alpha = 99;
  projectionData.zeta[0].value = "mutated";
  const root = renderToStaticMarkup(
    application.RootLayout({ children: "proof" }),
  );
  const expectedScript = createPublisherReaderStateBootstrapSource({
    package: "@example/reader-state-bootstrap",
    version: "1.2.3",
    sourceHash: sha256(source),
    source,
    context: sourceContext,
    projectionText: expectedText,
  });
  assert.match(root, /projectionText/u);
  assert.equal(root.includes(expectedScript), true);
  assert.doesNotMatch(root, /mutated/u);

  const reordered = await createApplication({
    readerStateBootstrap: createReaderStateBootstrap({
      createProjection: () => JSON.parse(
        '{"special":"line\\n\\"\\\\💡","alpha":1,"__proto__":{"safe":true},"zeta":[{"value":"proof"}]}',
      ),
      createSource: () => source,
    }),
  });
  assert.deepEqual(
    reordered.manifest.readerStateBootstrap.projection,
    application.manifest.readerStateBootstrap.projection,
  );
  assert.equal(reordered.manifest.buildId, application.manifest.buildId);

  const changed = await createApplication({
    readerStateBootstrap: createReaderStateBootstrap({
      createProjection: () => ({ alpha: 2 }),
      createSource: () => source,
    }),
  });
  assert.notEqual(
    changed.manifest.readerStateBootstrap.projection.hash,
    application.manifest.readerStateBootstrap.projection.hash,
  );
  assert.notEqual(changed.manifest.buildId, application.manifest.buildId);
});

test("Reader state bootstrap projection callbacks cannot replace trusted serialization", async () => {
  const originalStringify = JSON.stringify;
  const marker = "publisherProjectionSerializerWasReplaced";
  const projectionData = new Proxy({ proof: "stable" }, {
    getPrototypeOf(target) {
      JSON.stringify = (value, ...args) => {
        if (
          value !== null &&
          typeof value === "object" &&
          Object.hasOwn(value, "projectionText") &&
          Object.hasOwn(value, "reportSchemaVersion")
        ) {
          return `(()=>{globalThis.${marker}=true;return ${originalStringify(value, ...args)}})()`;
        }
        return originalStringify(value, ...args);
      };
      return Object.getPrototypeOf(target);
    },
  });
  try {
    const application = await createApplication({
      readerStateBootstrap: createReaderStateBootstrap({
        createProjection: () => projectionData,
      }),
    });
    const expectedText = canonicalizeJson({
      buildId: application.reader.buildId,
      data: { proof: "stable" },
      engineVersion: application.reader.engineVersion,
      publicationId: application.reader.publicationId,
      schemaVersion: "1.0",
    });
    assert.deepEqual(
      application.manifest.readerStateBootstrap.projection,
      {
        schemaVersion: "1.0",
        byteSize: new TextEncoder().encode(expectedText).length,
        hash: sha256(expectedText),
      },
    );
    const root = renderToStaticMarkup(
      application.RootLayout({ children: "proof" }),
    );
    assert.doesNotMatch(root, new RegExp(marker, "u"));
  } finally {
    JSON.stringify = originalStringify;
  }
});

test("Reader state bootstrap projection enforces exact independent resource limits", async () => {
  const reader = await createFixtureReader({ includeUpdates: false });
  const createResult = (data) =>
    createPublicationNextApplication({
      reader,
      readerStateBootstrap: createReaderStateBootstrap({
        createProjection: () => data,
      }),
    });
  const nested = (depth) => {
    let value = {};
    for (let index = 1; index < depth; index += 1) {
      value = { child: value };
    }
    return value;
  };

  assert.equal((await createResult(
    nested(PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_DEPTH),
  )).valid, true);
  let result = await createResult(
    nested(PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_DEPTH + 1),
  );
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code,
    "next.reader_state_bootstrap.projection_too_deep");
  assert.deepEqual(result.diagnostics[0].params, {
    actualDepth:
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_DEPTH + 1,
    maximumDepth:
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_DEPTH,
  });

  const acceptedContainers = {
    values: Array(
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_CONTAINERS - 2,
    ).fill(Object.freeze({})),
  };
  assert.equal((await createResult(acceptedContainers)).valid, true);
  acceptedContainers.values.push({});
  result = await createResult(acceptedContainers);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code,
    "next.reader_state_bootstrap.projection_too_many_containers");

  const acceptedEntries = {
    values: Array.from(
      {
        length:
          PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_ENTRIES - 1,
      },
      () => 0,
    ),
  };
  assert.equal((await createResult(acceptedEntries)).valid, true);
  acceptedEntries.values.push(0);
  result = await createResult(acceptedEntries);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code,
    "next.reader_state_bootstrap.projection_too_many_entries");
  assert.deepEqual(result.diagnostics[0].params, {
    actualItems:
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_ENTRIES + 1,
    maximumItems:
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_ENTRIES,
  });

  let overLimitArrayOwnKeysCalled = false;
  const overLimitArray = new Proxy(
    Array(
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_ENTRIES,
    ),
    {
      ownKeys() {
        overLimitArrayOwnKeysCalled = true;
        throw new Error("private ownKeys trap");
      },
    },
  );
  result = await createResult({ values: overLimitArray });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code,
    "next.reader_state_bootstrap.projection_too_many_entries");
  assert.equal(overLimitArrayOwnKeysCalled, false);

  let overDepthPrototypeCalled = false;
  let overDepthValue = new Proxy({}, {
    getPrototypeOf() {
      overDepthPrototypeCalled = true;
      throw new Error("private prototype trap");
    },
  });
  for (
    let index = 0;
    index < PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_DEPTH;
    index += 1
  ) {
    overDepthValue = { child: overDepthValue };
  }
  result = await createResult(overDepthValue);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code,
    "next.reader_state_bootstrap.projection_too_deep");
  assert.equal(overDepthPrototypeCalled, false);

  const emptyEnvelopeBytes = new TextEncoder().encode(
    canonicalizeJson({
      buildId: reader.buildId,
      data: { payload: "" },
      engineVersion: reader.engineVersion,
      publicationId: "renderer-proof",
      schemaVersion: "1.0",
    }),
  ).length;
  const acceptedBytes = {
    payload: "x".repeat(
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES -
        emptyEnvelopeBytes,
    ),
  };
  result = await createResult(acceptedBytes);
  assert.equal(result.valid, true,
    JSON.stringify(result.diagnostics, null, 2));
  assert.equal(
    result.value.manifest.readerStateBootstrap.projection.byteSize,
    PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES,
  );
  acceptedBytes.payload += "x";
  result = await createResult(acceptedBytes);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code,
    "next.reader_state_bootstrap.projection_too_large");
  assert.equal(
    result.diagnostics[0].params.maximumBytes,
    PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES,
  );

  result = await createResult({
    prefix: "p".repeat(1_000_000),
    value: "v".repeat(7_500_000),
  });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code,
    "next.reader_state_bootstrap.projection_too_large");
  assert.deepEqual(result.diagnostics[0].params, {
    actualBytes:
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES + 1,
    maximumBytes:
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_PROJECTION_BYTES,
  });

  result = await createResult({ payload: "<".repeat(3_000_000) });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code,
    "next.reader_state_bootstrap.script_too_large");
  assert.equal(
    result.diagnostics[0].params.maximumBytes,
    16_777_216,
  );

  const staticTransport = await createPublicationNextApplication({
    reader: await createFixtureReader({ includeUpdates: true }),
    readerStateBootstrap: createReaderStateBootstrap({
      createProjection: () => ({ payload: "<".repeat(2_600_000) }),
    }),
    theme: resolveDefaultPublisherNextTheme(),
    updates: createUpdates(),
  });
  assert.equal(staticTransport.valid, false);
  assert.equal(
    staticTransport.diagnostics[0].code,
    "next.reader_state_bootstrap.static_script_too_large",
  );
  assert.equal(
    staticTransport.diagnostics[0].params.maximumBytes,
    PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_STATIC_SCRIPT_BYTES,
  );
  assert.equal(staticTransport.diagnostics[0].params.documentCount, 9);

  const boundarySource =
    'return { schemaVersion: "1.0", copied: [], refused: [] };';
  const boundaryContext = Object.freeze({
    publicationId: reader.publicationId,
    reportStorageKey:
      `genii.publisher.reader-state-bootstrap.v1.${reader.publicationId}`,
    targetStorageKeys: Object.freeze({
      bookmarks: createReaderBookmarksStorageKey(reader.publicationId),
      engagement: createReaderEngagementStorageKey(reader.publicationId),
      narrationPreferences:
        createReaderNarrationPreferencesStorageKey(reader.publicationId),
      preferences: createReaderPreferencesStorageKey(reader.publicationId),
      progress: createReaderProgressStorageKey(reader.publicationId),
      syncConsent: createReaderSyncConsentStorageKey(reader.publicationId),
    }),
  });
  const scriptBytesFor = (data) => {
    const projectionText = canonicalizeJson({
      buildId: reader.buildId,
      data,
      engineVersion: reader.engineVersion,
      publicationId: reader.publicationId,
      schemaVersion: "1.0",
    });
    return new TextEncoder().encode(
      createPublisherReaderStateBootstrapSource({
        package: "@example/reader-state-bootstrap",
        version: "1.2.3",
        sourceHash: sha256(boundarySource),
        source: boundarySource,
        context: boundaryContext,
        projectionText,
      }),
    ).length;
  };
  const boundaryBase = { escaped: "", filler: "" };
  const remainingScriptBytes =
    PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SCRIPT_BYTES -
    scriptBytesFor(boundaryBase);
  const boundaryData = {
    escaped: "<".repeat(Math.floor(remainingScriptBytes / 6)),
    filler: "x".repeat(remainingScriptBytes % 6),
  };
  assert.equal(
    scriptBytesFor(boundaryData),
    PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SCRIPT_BYTES,
  );
  result = await createResult(boundaryData);
  assert.equal(result.valid, true,
    JSON.stringify(result.diagnostics, null, 2));
  boundaryData.filler += "x";
  assert.equal(
    scriptBytesFor(boundaryData),
    PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SCRIPT_BYTES + 1,
  );
  result = await createResult(boundaryData);
  assert.equal(result.valid, false);
  assert.equal(
    result.diagnostics[0].code,
    "next.reader_state_bootstrap.script_too_large",
  );
  assert.deepEqual(result.diagnostics[0].params, {
    actualBytes:
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SCRIPT_BYTES + 1,
    maximumBytes:
      PUBLISHER_NEXT_READER_STATE_BOOTSTRAP_MAXIMUM_SCRIPT_BYTES,
  });
});

test("Reader state bootstrap projection rejects hostile values and private failures", async () => {
  const reader = await createFixtureReader({ includeUpdates: false });
  const accessor = {};
  Object.defineProperty(accessor, "private", {
    enumerable: true,
    get() {
      return "private projection value";
    },
  });
  const cyclic = {};
  cyclic.self = cyclic;
  const sparse = [];
  sparse.length = 1;
  const candidates = [
    accessor,
    cyclic,
    { sparse },
    { custom: Object.create({ inherited: true }) },
    { invalid: Number.POSITIVE_INFINITY },
    { invalid: "\ud800" },
    new Proxy({}, {
      ownKeys() {
        throw new Error("private projection proxy trap");
      },
    }),
  ];
  for (const data of candidates) {
    const result = await createPublicationNextApplication({
      reader,
      readerStateBootstrap: createReaderStateBootstrap({
        createProjection: () => data,
      }),
    });
    assert.equal(result.valid, false);
    assert.equal(
      result.diagnostics[0].code,
      "next.reader_state_bootstrap.projection_json_invalid",
    );
    assert.doesNotMatch(
      JSON.stringify(result.diagnostics),
      /private projection value/u,
    );
  }

  for (const data of [null, [], "not an object"]) {
    const result = await createPublicationNextApplication({
      reader,
      readerStateBootstrap: createReaderStateBootstrap({
        createProjection: () => data,
      }),
    });
    assert.equal(result.valid, false);
    assert.equal(
      result.diagnostics[0].code,
      "next.reader_state_bootstrap.projection_root_invalid",
    );
  }

  let thrownSourceCalls = 0;
  const thrown = await createPublicationNextApplication({
    reader,
    readerStateBootstrap: createReaderStateBootstrap({
      createProjection() {
        throw new Error("private projection throw");
      },
      createSource() {
        thrownSourceCalls += 1;
        return 'return { schemaVersion: "1.0", copied: [], refused: [] };';
      },
    }),
  });
  assert.equal(thrown.valid, false);
  assert.equal(
    thrown.diagnostics[0].code,
    "next.reader_state_bootstrap.projection_threw",
  );
  assert.doesNotMatch(JSON.stringify(thrown.diagnostics), /private/u);
  assert.equal(thrownSourceCalls, 0);

  for (const [projectionResult, code] of [
    [
      { valid: false, diagnostics: [{ private: "private rejection" }] },
      "next.reader_state_bootstrap.projection_rejected",
    ],
    [
      { valid: true, diagnostics: [] },
      "next.reader_state_bootstrap.projection_result_invalid",
    ],
  ]) {
    let invalidSourceCalls = 0;
    const result = await createPublicationNextApplication({
      reader,
      readerStateBootstrap: createReaderStateBootstrap({
        implementation: {
          configure() {
            return {
              valid: true,
              diagnostics: [],
              value: {
                createProjection() {
                  return projectionResult;
                },
                createSource() {
                  invalidSourceCalls += 1;
                  return {
                    valid: true,
                    diagnostics: [],
                    value:
                      'return { schemaVersion: "1.0", copied: [], refused: [] };',
                  };
                },
              },
            };
          },
        },
      }),
    });
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, code);
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /private/u);
    assert.equal(invalidSourceCalls, 0);
  }

  let accessorCalls = 0;
  const invalidInstances = [
    {
      createProjection: "not a function",
      createSource() {},
    },
    (() => {
      const instance = { createSource() {} };
      Object.defineProperty(instance, "createProjection", {
        enumerable: true,
        get() {
          accessorCalls += 1;
          throw new Error("private projection accessor");
        },
      });
      return instance;
    })(),
  ];
  for (const instance of invalidInstances) {
    const result = await createPublicationNextApplication({
      reader,
      readerStateBootstrap: createReaderStateBootstrap({
        implementation: {
          configure() {
            return {
              valid: true,
              diagnostics: [],
              value: instance,
            };
          },
        },
      }),
    });
    assert.equal(result.valid, false);
    assert.equal(
      result.diagnostics[0].code,
      "next.reader_state_bootstrap.instance_invalid",
    );
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /private/u);
  }
  assert.equal(accessorCalls, 0);
});

test("Reader state bootstrap rejects incompatible, unsafe, invalid, and oversized source", async () => {
  const reader = await createFixtureReader({ includeUpdates: false });
  const candidates = [
    {
      adapter: createReaderStateBootstrap({
        implementation: { apiVersion: "2.0" },
      }),
      code: "next.reader_state_bootstrap.implementation_invalid",
    },
    {
      adapter: createReaderStateBootstrap({
        createSource: () => 'return "</script>";',
      }),
      code: "next.reader_state_bootstrap.source_unsafe",
    },
    {
      adapter: createReaderStateBootstrap({
        createSource: () => 'return "<ſcript>";',
      }),
      code: "next.reader_state_bootstrap.source_unsafe",
    },
    {
      adapter: createReaderStateBootstrap({
        createSource: () => 'return "-->";',
      }),
      code: "next.reader_state_bootstrap.source_unsafe",
    },
    {
      adapter: createReaderStateBootstrap({
        createSource: () => "return {",
      }),
      code: "next.reader_state_bootstrap.source_invalid",
    },
    {
      adapter: createReaderStateBootstrap({
        createSource: () => "x".repeat(32_769),
      }),
      code: "next.reader_state_bootstrap.source_too_large",
    },
  ];
  for (const { adapter, code } of candidates) {
    const result = await createPublicationNextApplication({
      reader,
      readerStateBootstrap: adapter,
    });
    assert.equal(result.valid, false);
    assert.equal(
      result.diagnostics.some((diagnostic) => diagnostic.code === code),
      true,
      JSON.stringify(result.diagnostics, null, 2),
    );
  }
});

test("every page carries fixed linked attribution and source credit", async () => {
  const application = await createApplication();
  const routes = [
    undefined,
    ["works", "café+notes"],
    ["collections", "field-notes"],
    ["readings", "café+one"],
    ["updates"],
  ];

  for (const segments of routes) {
    const html = await renderResolved(application, segments);
    assert.match(
      html,
      /data-publisher-attribution="required"/,
    );
    assert.match(html, /Copyright 2026 GENII Foundation/);
    assert.match(
      html,
      /href="https:\/\/publisher\.genii\.foundation">Published with GENII Publisher<\/a>/,
    );
    assert.match(
      html,
      /href="https:\/\/github\.com\/genii-foundation\/publisher">Publication source code<\/a>/,
    );
  }
});

test("the engine-owned not-found page preserves attribution", async () => {
  const application = await createApplication();
  const html = renderToStaticMarkup(
    application.NotFoundPage(),
  );
  assert.match(html, /data-publisher-page="not-found"/u);
  assert.match(html, /Page not found/u);
  assert.match(
    html,
    /data-publisher-attribution="required"/u,
  );
  assert.match(html, /id="publisher:main"/u);
  assert.doesNotMatch(html, /id="publisher-main"/u);
});

test("client-safe error boundaries preserve attribution without leaking errors", async () => {
  const application = await createApplication();
  const identityResult = createPublisherNextErrorIdentity({
    homePath: "/",
    publication: application.reader.publication,
    theme: application.theme,
  });
  const identity = assertValid(identityResult);
  assert.deepEqual(identity, application.errorIdentity);
  const error = Object.assign(
    new Error("private rendering detail"),
    { digest: "private-digest" },
  );
  const props = {
    error,
    identity,
    reset() {},
  };
  for (const element of [
    PublisherNextErrorPage(props),
    PublisherNextFrameworkErrorPage({ identity }),
    PublisherNextGlobalErrorPage(props),
  ]) {
    const html = renderToStaticMarkup(element);
    assert.match(html, /data-publisher-page="error"/u);
    assert.match(
      html,
      /data-publisher-attribution="required"/u,
    );
    assert.match(
      html,
      /href="https:\/\/github\.com\/genii-foundation\/publisher"/u,
    );
    assert.doesNotMatch(html, /private rendering detail/u);
    assert.doesNotMatch(html, /private-digest/u);
  }
});

test("public error identity rejects attribution bypasses and the renderer fails closed to GENII credit", async () => {
  const application = await createApplication();
  const validInput = {
    homePath: "/",
    publication: application.reader.publication,
    theme: application.theme,
  };
  const cases = [
    {
      label: "rewritten attribution",
      mutate(input) {
        input.publication.attribution.text = "Removed";
      },
    },
    {
      label: "missing source",
      mutate(input) {
        delete input.publication.attribution.sourceCodeUrl;
      },
    },
    {
      label: "unsafe source",
      mutate(input) {
        input.publication.attribution.sourceCodeUrl =
          "javascript:removed";
      },
    },
    {
      label: "malformed home route",
      mutate(input) {
        input.homePath = "//removed.example";
      },
    },
    {
      label: "invalid theme",
      mutate(input) {
        input.theme.tokens.color.canvas = "transparent";
      },
    },
  ];
  for (const { label, mutate } of cases) {
    const input = structuredClone(validInput);
    mutate(input);
    const result = createPublisherNextErrorIdentity(input);
    assert.equal(result.valid, false, label);
  }

  const forged = structuredClone(validInput);
  forged.publication.title = "Removed";
  forged.publication.attribution = {
    placement: "footer",
    copyright: "Removed",
    text: "Removed",
    url: "https://example.test/removed",
  };
  const html = renderToStaticMarkup(
    PublisherNextFrameworkErrorPage({
      identity: forged,
    }),
  );
  assert.match(html, /Copyright 2026 GENII Foundation/u);
  assert.match(html, />Published with GENII Publisher</u);
  assert.match(
    html,
    /href="https:\/\/publisher\.genii\.foundation"/u,
  );
  assert.match(
    html,
    /href="https:\/\/github\.com\/genii-foundation\/publisher"/u,
  );
  assert.doesNotMatch(html, />Removed</u);
});

test("Updates configuration is required exactly when its route exists", async () => {
  const readerWithUpdates = await createFixtureReader();
  const missing = await createPublicationNextApplication({
    reader: readerWithUpdates,
    theme: resolveDefaultPublisherNextTheme(),
  });
  assert.equal(missing.valid, false);
  assert.equal(
    missing.diagnostics.some(
      ({ code }) => code === "next.updates.required",
    ),
    true,
  );

  const readerWithoutUpdates = await createFixtureReader({
    includeUpdates: false,
  });
  const absent = await createPublicationNextApplication({
    reader: readerWithoutUpdates,
    theme: resolveDefaultPublisherNextTheme(),
  });
  assert.equal(absent.valid, true);

  const unexpected = await createPublicationNextApplication({
    reader: readerWithoutUpdates,
    theme: resolveDefaultPublisherNextTheme(),
    updates: createUpdates(),
  });
  assert.equal(unexpected.valid, false);
  assert.equal(
    unexpected.diagnostics.some(
      ({ code }) => code === "next.updates.unexpected",
    ),
    true,
  );
});

test("the renderer refuses a theme written for API 1.0", async () => {
  const reader = await createFixtureReader({ includeUpdates: false });
  const current = resolveDefaultPublisherNextTheme();
  const result = await createPublicationNextApplication({
    reader,
    theme: {
      ...current,
      implementation: {
        ...current.implementation,
        apiVersion: "1.0",
      },
    },
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.diagnostics.some(
      ({ code }) => code === "next.theme.implementation_invalid",
    ),
    true,
  );
});

test("Updates content stays inside the engine owned page shell", async () => {
  const application = await createApplication({
    updates: createUpdates({ label: "Recorded releases" }),
  });
  const html = await renderResolved(application, ["updates"]);
  assert.match(html, /data-publisher-update="release-1"/);
  assert.match(html, /Recorded at \/updates/);
  assert.match(html, /Recorded releases/);
  assert.match(html, /data-publisher-attribution="required"/);
  assert.ok(
    html.indexOf("data-publisher-update") <
      html.indexOf("data-publisher-attribution"),
  );
  const metadata = await application.generateMetadata({
    params: Promise.resolve({ segments: ["updates"] }),
  });
  assert.equal(metadata.title, "Publication Updates | Renderer Proof");
});

test("Updates load once and bind their snapshot to application identity", async () => {
  let loads = 0;
  const application = await createApplication({
    updates: createUpdates({}, () => {
      loads += 1;
      return {
        title: `Snapshot ${loads}`,
        entries: [],
      };
    }),
  });
  assert.equal(loads, 1);
  assert.match(application.manifest.updates.viewHash, /^sha256:/u);
  const first = await renderResolved(application, ["updates"]);
  const second = await renderResolved(application, ["updates"]);
  assert.equal(loads, 1);
  assert.equal(second, first);
  assert.match(first, /Snapshot 1/u);

  const changed = await createApplication({
    updates: createUpdates({}, () => ({
      title: "Different snapshot",
      entries: [],
    })),
  });
  assert.notEqual(
    changed.manifest.updates.viewHash,
    application.manifest.updates.viewHash,
  );
  assert.notEqual(
    changed.manifest.buildId,
    application.manifest.buildId,
  );
});

test("Updates internal links must resolve inside publication authority", async () => {
  for (const href of [
    FIXTURE_ROUTES.publishedWork,
    FIXTURE_ROUTES.legacyRedirect,
    "https://example.com/releases/1",
  ]) {
    const application = await createApplication({
      updates: createUpdates({}, () => ({
        title: "Linked updates",
        entries: [
          {
            id: "linked",
            title: "Linked release",
            href,
          },
        ],
      })),
    });
    assert.match(
      await renderResolved(application, ["updates"]),
      new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}"`),
    );
  }

  for (const href of [
    "/updates/initial-release",
    "/works/../updates",
    "//example.com/release",
  ]) {
    const result = await createPublicationNextApplication({
      reader: await createFixtureReader(),
      theme: resolveDefaultPublisherNextTheme(),
      updates: createUpdates({}, () => ({
        title: "Invalid links",
        entries: [
          {
            id: "invalid-link",
            title: "Invalid",
            href,
          },
        ],
      })),
    });
    assert.equal(result.valid, false);
    assert.equal(
      result.diagnostics.some(
        ({ code }) =>
          code === "next.updates.view_href_invalid",
      ),
      true,
    );
  }
});

test("Updates adapters cannot inject executable or styled markup", async () => {
  const literalMarkup = await createApplication({
    updates: createUpdates({}, () => ({
      title:
        "<style>.publisher-attribution{display:none}</style>",
      description: "<script>globalThis.compromised=true</script>",
      entries: [
        {
          id: "escaped-entry",
          title: "<script>alert('no')</script>",
          summary:
            "<style>.publisher-root{visibility:hidden}</style>",
        },
      ],
    })),
  });
  const escapedHtml = await renderResolved(
    literalMarkup,
    ["updates"],
  );
  assert.doesNotMatch(escapedHtml, /<script>/iu);
  assert.doesNotMatch(escapedHtml, /<style>/iu);
  assert.match(escapedHtml, /&lt;script&gt;/u);
  assert.match(escapedHtml, /&lt;style&gt;/u);
  assert.match(
    escapedHtml,
    /data-publisher-attribution="required"/u,
  );

  const hostileViews = [
    createElement(
      "style",
      null,
      ".publisher-attribution{display:none}",
    ),
    {
      title: "Extra style field",
      entries: [],
      style: ".publisher-attribution{display:none}",
    },
    {
      title: "React entry",
      entries: [
        {
          id: "react-entry",
          title: createElement("script", null, "alert('no')"),
        },
      ],
    },
    {
      title: "Unsafe link",
      entries: [
        {
          id: "unsafe-link",
          title: "Unsafe",
          href: "javascript:alert('no')",
        },
      ],
    },
    {
      title: "Invalid date",
      entries: [
        {
          id: "invalid-date",
          title: "Impossible",
          publishedAt: "2026-02-29T12:00:00Z",
        },
      ],
    },
  ];
  const reader = await createFixtureReader();
  for (const hostileView of hostileViews) {
    const result = await createPublicationNextApplication({
      reader,
      theme: resolveDefaultPublisherNextTheme(),
      updates: createUpdates({}, () => hostileView),
    });
    assert.equal(result.valid, false);
    assert.equal(
      result.diagnostics.some(({ code }) =>
        code.startsWith("next.updates.view_"),
      ),
      true,
    );
  }
});

test("Updates adapters cannot restore the removed React or metadata hooks", async () => {
  const reader = await createFixtureReader();
  const retiredInstances = [
    {
      render() {
        return createElement("article");
      },
    },
    {
      load() {
        return {
          title: "Updates",
          entries: [],
        };
      },
      metadata() {
        return { title: "Injected metadata" };
      },
    },
  ];
  for (const retiredInstance of retiredInstances) {
    const updates = createUpdates();
    updates.implementation.configure = () => ({
      valid: true,
      value: retiredInstance,
      diagnostics: [],
    });
    const result = await createPublicationNextApplication({
      reader,
      theme: resolveDefaultPublisherNextTheme(),
      updates,
    });
    assert.equal(result.valid, false);
    assert.equal(
      result.diagnostics.some(
        ({ code }) => code === "next.updates.instance_invalid",
      ),
      true,
    );
  }
});

test("framework route params decode once after Proxy preserves raw authority", async () => {
  const application = await createApplication();
  const element = await application.Page({
    params: Promise.resolve({
      segments: ["works", "caf%C3%A9%2Bnotes"],
    }),
  });
  const html = renderToStaticMarkup(element);
  assert.match(html, /Café \+ Field Notes/);

  const metadata = await application.generateMetadata({
    params: Promise.resolve({
      segments: ["readings", "caf%C3%A9%2Bone"],
    }),
  });
  assert.equal(
    metadata.title,
    "Opening | Café + Field Notes",
  );
  assert.match(
    renderToStaticMarkup(await application.RootPage()),
    /Renderer Proof/,
  );
  assert.equal(
    (await application.generateRootMetadata()).title,
    "Renderer Proof",
  );
});

test("origin root helpers do not assume the declared home route", async () => {
  const application = await createApplication({
    reader: await createFixtureReader({
      archivedWorkRoute: "/",
      homeRoute: "/home",
    }),
  });
  const rootHtml = renderToStaticMarkup(
    await application.RootPage(),
  );
  assert.match(withoutFocusMarkup(rootHtml), /Old Record/);
  assert.doesNotMatch(rootHtml, /data-publisher-page="home"/);
  assert.equal(
    (await application.generateRootMetadata()).title,
    "Old Record | Renderer Proof",
  );

  const home = application.resolveRoute(["home"]);
  assert.equal(home.status, "resolved");
  assert.equal(home.page.kind, "home");
  const generated = application.generateStaticParams();
  assert.equal(
    generated.some(
      ({ segments }) =>
        JSON.stringify(segments) === JSON.stringify(["home"]),
    ),
    true,
  );
  assert.equal(
    generated.some(({ segments }) => segments === undefined),
    false,
  );
});

test("application identity is deterministic, immutable, and content bound", async () => {
  const reader = await createFixtureReader();
  const first = await createApplication({ reader });
  const second = await createApplication({ reader });
  assert.deepEqual(first.manifest, second.manifest);
  assert.match(
    first.manifest.buildId,
    /^sha256:[0-9a-f]{64}$/,
  );
  assert.equal(Object.isFrozen(first.manifest), true);
  assert.equal(Object.isFrozen(first.manifest.source), true);
  assert.equal(Object.isFrozen(first.manifest.theme), true);
  assert.equal(Object.isFrozen(first.artifact), true);
  assert.equal(Object.isFrozen(first.offlineCatalog), true);
  assert.equal(Object.isFrozen(first.reader), true);
  assert.equal(
    first.manifest.source.readerBuildId,
    reader.buildId,
  );
  assert.deepEqual(first.manifest.continuity, {
    mode: "proxy",
    explicitRedirectCount: 2,
    canonicalSlashRedirectCount: 8,
  });

  const {
    $schema: ignoredSchema,
    buildId: ignoredBuildId,
    ...identity
  } = first.manifest;
  void [ignoredSchema, ignoredBuildId];
  assert.equal(first.manifest.buildId, hashCanonicalJson(identity));
  assert.deepEqual(
    JSON.parse(first.artifact.text),
    first.manifest,
  );
  assert.equal(first.artifact.hash, sha256(first.artifact.text));
  assert.deepEqual(
    JSON.parse(first.offlineCatalogText),
    first.offlineCatalog,
  );
  assert.equal(
    first.offlineCatalog.rendererBuildId,
    first.manifest.buildId,
  );
  assert.equal(
    first.offlineCatalog.catalogHref,
    `/publication-reader-offline.json?rendererBuildId=${encodeURIComponent(first.manifest.buildId)}`,
  );
  assert.equal(
    first.artifact.relativePath,
    "renderers/next/application.json",
  );

  const config = { accent: "#004B5A" };
  const themed = await createApplication({
    reader,
    theme: resolveDefaultPublisherNextTheme(config),
  });
  config.accent = "#000000";
  assert.notEqual(
    themed.manifest.theme.configHash,
    first.manifest.theme.configHash,
  );
  assert.notEqual(
    themed.manifest.buildId,
    first.manifest.buildId,
  );
  assert.equal(themed.theme.tokens.color.accent, "#004B5A");
});

test("request continuity preserves exact paths and query boundaries", async () => {
  const application = await createApplication();
  const internal = await application.handleRequest(
    new Request(
      "https://reader.example/legacy/(cafe)+story?edition=morning&view=wide",
    ),
  );
  assert.ok(internal instanceof Response);
  assert.equal(internal.status, 308);
  assert.equal(
    internal.headers.get("location"),
    "https://reader.example/works/caf%C3%A9+notes?edition=morning&view=wide",
  );

  const external = await application.handleRequest(
    new Request(
      "https://reader.example/depart?private=do-not-leak",
    ),
  );
  assert.ok(external instanceof Response);
  assert.equal(external.status, 307);
  assert.equal(
    external.headers.get("location"),
    "https://continuity.example/new-home?source=archive",
  );

  const slash = await application.handleRequest(
    new Request(
      "https://reader.example/works/caf%C3%A9+notes/?from=alias",
    ),
  );
  assert.ok(slash instanceof Response);
  assert.equal(slash.status, 308);
  assert.equal(
    slash.headers.get("location"),
    "https://reader.example/works/caf%C3%A9+notes?from=alias",
  );

  assert.equal(
    await application.handleRequest(
      new Request(
        "https://reader.example/legacy/%28cafe%29%2Bstory",
      ),
    ),
    undefined,
  );
  for (const alias of [
    "/works/caf%C3%A9%2Bnotes",
    "/works/caf%c3%a9+notes",
    "/works/%63af%C3%A9+notes",
  ]) {
    const rejected = await application.handleRequest(
      new Request(`https://reader.example${alias}`),
    );
    assert.ok(rejected instanceof Response);
    assert.equal(rejected.status, 404);
    assert.match(
      await rejected.text(),
      /data-publisher-attribution="required"/u,
    );
  }
  assert.equal(
    await application.handleRequest(
      new Request("https://reader.example/unknown"),
    ),
    undefined,
  );
  assert.equal(await application.handleRequest({}), undefined);
});

test("invalid and hostile application inputs return diagnostics", async () => {
  const reader = await createFixtureReader();
  const forged = structuredClone(reader);
  forged.publication.title = "Forged without a new reader build";
  const invalid = await createPublicationNextApplication({
    reader: forged,
    theme: resolveDefaultPublisherNextTheme(),
    updates: createUpdates(),
  });
  assert.equal(invalid.valid, false);

  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("hostile input");
      },
    },
  );
  let result;
  await assert.doesNotReject(async () => {
    result = await createPublicationNextApplication({
      reader: hostile,
    });
  });
  assert.equal(result.valid, false);
});

test("renderPage accepts only pages issued by its own resolver", async () => {
  const application = await createApplication();
  const otherApplication = await createApplication();
  const resolution = application.resolveRoute([
    "works",
    "café+notes",
  ]);
  assert.equal(resolution.status, "resolved");
  await assert.doesNotReject(() =>
    application.renderPage(resolution.page),
  );
  await assert.rejects(
    () =>
      application.renderPage(
        structuredClone(resolution.page),
      ),
    /issued by this application's resolveRoute/u,
  );
  await assert.rejects(
    () => otherApplication.renderPage(resolution.page),
    /issued by this application's resolveRoute/u,
  );
});

test("unrepresentable source-backed ReaderLinks fail application creation", async () => {
  const result = await createPublicationNextApplication({
    reader: await createFixtureReader({
      unrepresentableReaderLink: true,
    }),
    theme: resolveDefaultPublisherNextTheme(),
    updates: createUpdates(),
  });
  assert.equal(result.valid, false);
  assert.equal(
    result.diagnostics.some(
      ({ code }) =>
        code === "next.markdown.reader_link_unrepresentable",
    ),
    true,
  );
  assert.equal(
    result.diagnostics.some(({ params }) =>
      params.readerDiagnosticCodes?.includes(
        "reader.markdown.link_context_forbidden",
      ),
    ),
    true,
  );
});

test("Markdown URLs reject malformed UTF-8 percent escapes", () => {
  for (const value of [
    "/works/%C3%28",
    "/works/%ED%A0%80",
    "/cafe%CC%81",
    "/a|b",
    "/#:~:text=x",
  ]) {
    assert.equal(publisherMarkdownUrlTransform(value), "");
  }
  assert.equal(
    publisherMarkdownUrlTransform("/works/caf%C3%A9"),
    "/works/caf%C3%A9",
  );
  assert.equal(
    publisherMarkdownUrlTransform(
      "https://example.com/caf%C3%A9",
    ),
    "https://example.com/caf%C3%A9",
  );
  assert.equal(
    publisherMarkdownUrlTransform("/#caf%C3%A9"),
    "/#caf%C3%A9",
  );
  assert.equal(
    publisherMarkdownUrlTransform("https://example.com/%FF"),
    "https://example.com/%FF",
  );
  assert.equal(
    publisherMarkdownUrlTransform(
      "https://example.com/%F4%90%80%80",
    ),
    "https://example.com/%F4%90%80%80",
  );
});

test("Markdown focus markup preserves one text occurrence and existing emphasis", () => {
  const html = renderToStaticMarkup(
    createElement(PublisherMarkdownInline, {
      assetHrefs: new Set(),
      markdown: "Alpha, beta 123 and **strong words** with `code words`.",
    }),
  );
  assert.match(html, /publisher-focus-emphasis-light/);
  assert.match(html, /publisher-focus-emphasis-normal/);
  assert.match(html, /publisher-focus-emphasis-strong/);
  assert.doesNotMatch(html, /<strong>[^<]*publisher-focus/u);
  assert.doesNotMatch(html, /<code>[^<]*publisher-focus/u);
  assert.equal(
    html.replace(/<[^>]+>/gu, ""),
    "Alpha, beta 123 and strong words with code words.",
  );
});

test("Markdown headings add a copy action beside owned manuscript text", () => {
  const html = renderToStaticMarkup(
    createElement(PublisherMarkdownBlock, {
      assetHrefs: new Set(),
      block: {
        id: "low-water-heading",
        kind: "heading",
        text: "Low water",
        readerAddress: {
          path: "/works/first-light/",
          anchor: "low-water",
        },
        domId: "low-water",
      },
      markdown: "## Low water",
      renderedPath: "/works/first-light/",
    }),
  );
  const semanticHtml = withoutFocusMarkup(html);
  assert.match(html, /class="publisher-linkable-heading"/u);
  assert.match(semanticHtml, /<h2>Low water<\/h2>/u);
  assert.match(html, /aria-label="Copy link to Low water"/u);
  assert.match(
    html,
    /data-publisher-heading-href="\/works\/first-light\/#low-water"/u,
  );
  assert.match(html, /hidden=""/u);
  assert.equal(html.replace(/<[^>]+>/gu, ""), "Low water");
});

test("Markdown tables become labeled keyboard regions without changing cells", () => {
  const html = renderToStaticMarkup(
    createElement(PublisherMarkdownBlock, {
      assetHrefs: new Set(),
      block: {
        id: "tide-table",
        kind: "table",
        text: "Reading window Tide height First light 1.4 m",
        readerAddress: {
          path: "/works/first-light/",
          anchor: "tide-table",
        },
        domId: "tide-table",
      },
      markdown: [
        "| Reading window | Tide height |",
        "| :--- | ---: |",
        "| First *light* | 1.4 m |",
      ].join("\n"),
      narrationWords: true,
      renderedPath: "/works/first-light/",
    }),
  );
  assert.match(html, /class="publisher-table-region"/u);
  assert.match(html, /role="region"/u);
  assert.match(html, /tabindex="0"/u);
  assert.match(
    html,
    /aria-labelledby="publisher-table-tide-table"/u,
  );
  assert.match(html, /<caption id="publisher-table-tide-table">/u);
  assert.equal(html.match(/scope="col"/gu)?.length, 2);
  assert.match(html, /text-align:left/u);
  assert.match(html, /text-align:right/u);
  assert.match(withoutFocusMarkup(html), /<em>light<\/em>/u);
  assert.ok(
    (html.match(/data-publisher-narration-word="true"/gu)?.length ?? 0) > 0,
  );
});

test("malformed table syntax remains ordinary manuscript text", () => {
  const html = renderToStaticMarkup(
    createElement(PublisherMarkdownBlock, {
      assetHrefs: new Set(),
      block: {
        id: "not-a-table",
        kind: "table",
        text: "A B C",
        readerAddress: null,
        domId: null,
      },
      markdown: "| A | B |\n| --- |\n| C | D |",
      renderedPath: "/",
    }),
  );
  assert.doesNotMatch(html, /publisher-table-region/u);
  assert.match(withoutFocusMarkup(html), /\| A \| B \|/u);
});

test("pipe syntax requires an adapter-classified table block", () => {
  const html = renderToStaticMarkup(
    createElement(PublisherMarkdownBlock, {
      assetHrefs: new Set(),
      block: {
        id: "unclassified-table",
        kind: "paragraph",
        text: "A B C D",
        readerAddress: null,
        domId: null,
      },
      markdown: "| A | B |\n| --- | --- |\n| C | D |",
      renderedPath: "/",
    }),
  );
  assert.doesNotMatch(html, /publisher-table-region/u);
  assert.match(withoutFocusMarkup(html), /\| --- \| --- \|/u);
});

test("narration anchors share the spoken word profile", () => {
  const html = renderToStaticMarkup(
    createElement(PublisherMarkdownBlock, {
      assetHrefs: new Set(),
      block: { id: "pronunciation", kind: "paragraph", text: "ka·ra ˈtone" },
      markdown: "ka·ra ˈtone",
      narrationWords: true,
      renderedPath: "/works/pronunciation/",
    }),
  );
  assert.equal(
    html.match(/data-publisher-narration-word="true"/gu)?.length,
    2,
  );
  assert.equal(html.replace(/<[^>]+>/gu, ""), "ka·ra ˈtone");
});

test("static routes preserve server-rendered manuscript around client tools", async () => {
  const application = await createApplication();
  const generated = application.generateStaticParams();
  assert.deepEqual(generated, application.staticParams);
  assert.notEqual(generated, application.staticParams);
  assert.equal(
    generated.some(({ segments }) => segments === undefined),
    false,
  );
  assert.equal(Object.isFrozen(application.staticParams), true);
  assert.equal(Object.isFrozen(application.staticParams[0]), true);
  assert.equal(Object.isFrozen(generated), false);
  assert.equal(Object.isFrozen(generated[0]), false);

  const element = await application.Page({
    params: Promise.resolve({
      segments: ["works", "café+notes"],
    }),
  });
  const html = renderToStaticMarkup(element);
  assert.match(html, /Café \+ Field Notes/);
  assert.match(html, /data-publisher-attribution="required"/);

  await assert.rejects(
    () =>
      application.Page({
        params: Promise.resolve({
          segments: ["not-found"],
        }),
      }),
    (error) =>
      typeof error?.digest === "string" &&
      error.digest.includes("404"),
  );
});
