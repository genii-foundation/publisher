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
  createPublicationNextApplication,
} from "../packages/next/dist/server/application.js";
import {
  resolveDefaultPublisherNextTheme,
} from "../packages/next/dist/theme/default.js";
import {
  publisherMarkdownUrlTransform,
} from "../packages/next/dist/components/markdown.js";
import {
  PublisherNextErrorPage,
  PublisherNextFrameworkErrorPage,
  PublisherNextGlobalErrorPage,
} from "../packages/next/dist/client/error.js";

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
    assert.match(html, new RegExp(item.title));
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
  assert.deepEqual(headingOutline(workHtml), [
    { level: 1, text: "Café + Field Notes" },
    { level: 2, text: "Opening" },
    { level: 2, text: "Next" },
  ]);
  assert.match(
    workHtml,
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
  assert.deepEqual(headingOutline(firstHtml), [
    { level: 1, text: "Opening" },
  ]);
  assert.match(firstHtml, /<em>safe<\/em>/);
  assert.match(
    firstHtml,
    /<a href="\/readings\/plus\+two">First<\/a>/u,
  );
  assert.doesNotMatch(firstHtml, /Semantic navigation only/u);
  assert.match(
    firstHtml,
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
    html,
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
    workHtml,
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
    sectionHtml,
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
  const identity = {
    homePath: "/",
    publication: application.reader.publication,
    theme: application.theme,
  };
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
  assert.equal(metadata.title, "Updates | Renderer Proof");
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
  assert.match(rootHtml, /Old Record/);
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
  const internal = application.handleRequest(
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

  const external = application.handleRequest(
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

  const slash = application.handleRequest(
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
    application.handleRequest(
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
    const rejected = application.handleRequest(
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
    application.handleRequest(
      new Request("https://reader.example/unknown"),
    ),
    undefined,
  );
  assert.equal(application.handleRequest({}), undefined);
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

test("static route functions remain server rendered without client state", async () => {
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
