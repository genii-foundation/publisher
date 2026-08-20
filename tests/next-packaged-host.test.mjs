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
  runPackagedHostProof,
} from "../packages/next/scripts/packaged-host-proof.mjs";
import {
  createFixtureReader,
} from "./next-fixture.mjs";

test("the packed renderer builds a thin host with server rendered prose", async () => {
  const reader = await createFixtureReader({
    archivedWorkRoute: "/",
    externalRedirectTarget:
      "https://EXAMPLE.com:443/archive/../new-home?source=%2f",
    homeRoute: "/home",
    includeUpdates: false,
    publishedWorkRoute: "/works/caf%C3%A9+notes/",
  });
  const browserExecutable =
    process.env.PUBLISHER_NEXT_BROWSER_EXECUTABLE?.trim() ||
    undefined;
  const result = await runPackagedHostProof(reader, {
    browserExecutable,
  });
  assert.equal(
    result.browserHydrationVerified,
    browserExecutable !== undefined,
  );
  assert.equal(
    result.readerToolsHydrationVerified,
    browserExecutable !== undefined,
  );
  assert.equal(
    result.readerPrepaintVerified,
    browserExecutable !== undefined,
  );
  assert.equal(
    result.extensionClientHydrationVerified,
    browserExecutable !== undefined,
  );
  assert.equal(result.extensionHandlerVerified, true);
  assert.equal(
    result.manuscriptExtensionsVerified,
    browserExecutable !== undefined,
  );
  assert.equal(
    result.offlineReaderVerified,
    browserExecutable !== undefined,
  );
  assert.equal(result.nextVersion, "16.3.1");
  assert.equal(result.postcssVersion, "8.5.24");
  assert.equal(result.nanoidVersion, "3.3.18");
  assert.equal(result.sharpVersion, "0.35.3");
  assert.equal(
    result.extensionPackage,
    "@example/packed-publication-extension@1.0.0",
  );
  assert.equal(
    result.themePackage,
    "@example/packed-publication-theme@1.0.0",
  );
  assert.equal(typeof result.vipsVersion, "string");
  assert.equal(result.auditVulnerabilities, 0);
  assert.equal(result.imageContentType, "image/webp");
  assert.equal(result.runtimeErrorStatus, 500);
  assert.equal(result.globalErrorStatus, 500);
  assert.deepEqual(result.frameworkErrorStatuses, [404, 500]);
  assert.deepEqual(
    result.renderedRoutes,
    [
      ...reader.routes.active.map(({ path }) => path),
      "/extension-field-station",
    ],
  );
  assert.ok(result.renderedRoutes.includes("/"));
  assert.ok(result.renderedRoutes.includes("/home"));
  assert.ok(
    result.renderedRoutes.includes("/works/caf%C3%A9+notes/"),
  );
  assert.ok(result.renderedRoutes.includes("/extension-field-station"));
  assert.deepEqual(result.htmlFiles, [
    "_not-found.html",
    "collections/field-notes.html",
    "collections/retired.html",
    "extension-field-station.html",
    "home.html",
    "index.html",
    "readings/café+one.html",
    "readings/plus+two.html",
    "works/café+notes.html",
    "works/quiet-draft.html",
  ]);
  assert.deepEqual(result.redirectStatuses, [308, 307, 308]);
});
