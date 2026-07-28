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

const repositoryRoot = new URL("../", import.meta.url);

function read(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), "utf8");
}

const [license, notice, sourceNotice, schemaSourceNotice, packageText, readme] =
  await Promise.all([
    read("LICENSE"),
    read("NOTICE.md"),
    read("SOURCE-NOTICE"),
    read("schemas/SOURCE-NOTICE"),
    read("package.json"),
    read("README.md"),
  ]);

const packageManifest = JSON.parse(packageText);
const sourceNoticeBody = sourceNotice.split("\n").slice(2).join("\n").trim();

test("package metadata identifies CPAL 1.0", () => {
  assert.equal(packageManifest.license, "CPAL-1.0");
});

test("license retains the attribution and network use sections", () => {
  assert.match(license, /14\. ADDITIONAL TERM: ATTRIBUTION/);
  assert.match(license, /15\. ADDITIONAL TERM: NETWORK USE/);
  assert.match(
    license,
    /Display of Attribution Information is required in Larger Works/,
  );
});

test("populated Exhibit A is the reusable source notice", () => {
  assert.ok(license.includes(sourceNoticeBody));
  assert.equal(schemaSourceNotice, sourceNotice);
});

test("Exhibit B and public notices preserve the fixed credit", () => {
  for (const text of [license, notice, readme]) {
    assert.match(text, /Copyright 2026 GENII Foundation/);
    assert.match(text, /Published with GENII Publisher/);
    assert.match(text, /https:\/\/publisher\.genii\.foundation/);
  }
});

test("public documentation identifies the canonical source repository", () => {
  assert.match(
    readme,
    /https:\/\/github\.com\/genii-foundation\/publisher/,
  );
  assert.match(
    notice,
    /https:\/\/github\.com\/genii-foundation\/publisher/,
  );
});
