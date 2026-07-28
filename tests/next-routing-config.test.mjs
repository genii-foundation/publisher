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
  createPublisherNextConfig,
} from "../packages/next/dist/config.js";
import {
  createPublisherNextRoutePlan,
} from "../packages/next/dist/routes.js";

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

test("the route plan preserves exact decoded segments", async () => {
  const reader = await createFixtureReader();
  const plan = assertValid(createPublisherNextRoutePlan(reader));

  assert.equal(plan.slashPolicy, "no-trailing");
  assert.deepEqual(plan.resolve(undefined), {
    status: "resolved",
    route: {
      path: "/",
      target: { kind: "home" },
    },
  });
  assert.deepEqual(plan.resolve([]), plan.resolve(undefined));
  assert.deepEqual(plan.resolve(["works", "café+notes"]), {
    status: "resolved",
    route: {
      path: FIXTURE_ROUTES.publishedWork,
      target: {
        kind: "work",
        workId: "published-notes",
      },
    },
  });
  assert.deepEqual(plan.resolve(["readings", "café+one"]), {
    status: "resolved",
    route: {
      path: FIXTURE_ROUTES.sectionOne,
      target: {
        kind: "section",
        workId: "published-notes",
        sectionId: "published-opening",
        routeName: "reader",
      },
    },
  });
  assert.deepEqual(plan.resolve(["readings", "plus+two"]), {
    status: "resolved",
    route: {
      path: FIXTURE_ROUTES.sectionTwo,
      target: {
        kind: "section",
        workId: "published-notes",
        sectionId: "published-closing",
        routeName: "reader",
      },
    },
  });
  assert.deepEqual(plan.resolve(["missing"]), {
    status: "not-found",
  });
  for (const input of [
    "works",
    null,
    [""],
    ["bad/segment"],
    ["cafe\u0301"],
    new Array(1025).fill("x"),
    ["é".repeat(1024)],
    new Array(1),
  ]) {
    const resolution = plan.resolve(input);
    assert.equal(
      resolution.status,
      "invalid",
      JSON.stringify(input),
    );
  }
  let propertyReads = 0;
  const inertPropertyTrap = new Proxy([], {
    get() {
      propertyReads += 1;
      throw new Error("must not execute");
    },
  });
  assert.deepEqual(
    plan.resolve(inertPropertyTrap),
    plan.resolve(undefined),
  );
  assert.equal(propertyReads, 0);
  const hostile = new Proxy([], {
    getOwnPropertyDescriptor() {
      throw new Error("hostile input");
    },
  });
  assert.deepEqual(plan.resolve(hostile), {
    status: "invalid",
    issue: "uninspectable",
  });
  const accessor = ["x"];
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    get() {
      throw new Error("must not execute");
    },
  });
  assert.deepEqual(plan.resolve(accessor), {
    status: "invalid",
    issue: "segment",
  });
  const customIterator = ["works"];
  Object.defineProperty(
    customIterator,
    Symbol.iterator,
    {
      value() {
        throw new Error("must not execute");
      },
    },
  );
  assert.deepEqual(plan.resolve(customIterator), {
    status: "invalid",
    issue: "shape",
  });
  assert.deepEqual(plan.resolve(["a".repeat(2047)]), {
    status: "not-found",
  });

  assert.deepEqual(plan.staticParams[0], {});
  assert.equal(
    plan.staticParams.some(
      ({ segments }) =>
        JSON.stringify(segments) ===
        JSON.stringify(["works", "café+notes"]),
    ),
    true,
  );
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.staticParams), true);
  assert.equal(Object.isFrozen(plan.staticParams[0]), true);
});

test("mixed non-root trailing slash policies remain route specific", async () => {
  const reader = await createFixtureReader();
  const mixed = structuredClone(reader);
  const publishedWorkRoute = mixed.routes.active.find(
    ({ target }) =>
      target.kind === "work" &&
      target.workId === "published-notes",
  );
  assert.ok(publishedWorkRoute);
  publishedWorkRoute.path = `${publishedWorkRoute.path}/`;

  const plan = assertValid(createPublisherNextRoutePlan(mixed));
  assert.equal(plan.slashPolicy, "mixed");
  assert.deepEqual(
    plan.resolve(["works", "café+notes"]),
    {
      status: "resolved",
      route: publishedWorkRoute,
    },
  );
});

test("one trailing slash policy is preserved for every active route", async () => {
  const reader = await createFixtureReader();
  const slashed = structuredClone(reader);
  for (const route of slashed.routes.active) {
    if (route.path !== "/") {
      route.path = `${route.path}/`;
    }
  }
  const plan = assertValid(
    createPublisherNextRoutePlan(slashed),
  );
  assert.equal(plan.slashPolicy, "trailing");
  assert.deepEqual(
    plan.resolve(["works", "café+notes"]),
    {
      status: "resolved",
      route: {
        path: "/works/caf%C3%A9+notes/",
        target: {
          kind: "work",
          workId: "published-notes",
        },
      },
    },
  );
});

test("Next configuration reserves exact continuity for Proxy", async () => {
  const reader = await createFixtureReader();
  const plan = assertValid(createPublisherNextRoutePlan(reader));
  const config = createPublisherNextConfig(plan, {
    experimental: {
      serverActions: {
        bodySizeLimit: "1mb",
      },
      useTypeScriptCli: true,
    },
    reactStrictMode: true,
    skipProxyUrlNormalize: true,
    skipTrailingSlashRedirect: true,
  });

  assert.equal(config.reactStrictMode, true);
  assert.equal(config.trailingSlash, undefined);
  assert.deepEqual(config.experimental, {
    serverActions: {
      bodySizeLimit: "1mb",
    },
    useTypeScriptCli: true,
  });
  assert.equal(config.skipProxyUrlNormalize, true);
  assert.equal(config.skipTrailingSlashRedirect, true);
  assert.equal(config.redirects, undefined);
});

test("base configuration cannot reinterpret canonical routes", async () => {
  const reader = await createFixtureReader();
  const plan = assertValid(createPublisherNextRoutePlan(reader));

  for (const [baseConfig, pattern] of [
    [{ trailingSlash: true }, /trailingSlash/],
    [
      { skipTrailingSlashRedirect: false },
      /skipTrailingSlashRedirect/,
    ],
    [{ skipProxyUrlNormalize: false }, /skipProxyUrlNormalize/],
    [
      { skipMiddlewareUrlNormalize: true },
      /skipMiddlewareUrlNormalize/,
    ],
    [
      { experimental: { useTypeScriptCli: false } },
      /useTypeScriptCli/,
    ],
    [{ basePath: "/reader" }, /basePath/],
    [
      { i18n: { locales: ["en"], defaultLocale: "en" } },
      /i18n/,
    ],
    [{ output: "export" }, /static export/],
    [
      {
        async redirects() {
          return [];
        },
      },
      /config redirects run before Publisher continuity/,
    ],
    [
      {
        async rewrites() {
          return [];
        },
      },
      /config rewrites can steal canonical publication routes/,
    ],
  ]) {
    assert.throws(
      () => createPublisherNextConfig(plan, baseConfig),
      pattern,
    );
  }
});
