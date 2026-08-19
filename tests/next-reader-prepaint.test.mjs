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
import vm from "node:vm";

import {
  createReaderPreferencesStorageKey,
  serializeReaderPreferences,
} from "../packages/reader/dist/preferences.js";
import {
  createPublisherReaderPrepaintSource,
} from "../packages/next/dist/client/reader-prepaint.js";

function executePrepaint({
  publicationId = "prepaint-proof",
  stored,
} = {}) {
  const attributes = Object.create(null);
  const properties = Object.create(null);
  const requestedKeys = [];
  const source = createPublisherReaderPrepaintSource(
    publicationId,
    Object.freeze([
      Object.freeze({
        id: "serif",
        label: "Serif",
        family: "Charter, serif",
      }),
      Object.freeze({
        id: "field-sans",
        label: "Field sans",
        family: "Avenir Next, sans-serif",
      }),
    ]),
  );
  vm.runInNewContext(source, {
    TextEncoder,
    document: {
      documentElement: {
        dataset: new Proxy(attributes, {
          set(target, key, value) {
            target[key] = value;
            return true;
          },
        }),
        style: {
          setProperty(key, value) {
            properties[key] = value;
          },
        },
      },
    },
    localStorage: {
      getItem(key) {
        requestedKeys.push(key);
        return stored ?? null;
      },
    },
  });
  return { attributes, properties, requestedKeys, source };
}

test("Reader prepaint applies one fully valid publication scoped preference document", () => {
  const publicationId = "prepaint-proof";
  const stored = serializeReaderPreferences(
    {
      schemaVersion: 1,
      fontScale: 120,
      fontFamilyId: "field-sans",
      colorScheme: "black",
      motion: "reduced",
      highlights: false,
      focus: "strong",
    },
    {
      defaultFontFamilyId: "serif",
      fontFamilyIds: ["serif", "field-sans"],
    },
  );
  const result = executePrepaint({ publicationId, stored });

  assert.deepEqual(result.requestedKeys, [
    createReaderPreferencesStorageKey(publicationId),
  ]);
  assert.deepEqual({ ...result.attributes }, {
    publisherReaderScheme: "black",
    publisherReaderMotion: "reduced",
    publisherReaderFocus: "strong",
    publisherReaderHighlights: "off",
  });
  assert.deepEqual({ ...result.properties }, {
    "--publisher-reader-font-scale": "1.2",
    "--publisher-reader-font-family": "Avenir Next, sans-serif",
  });
  assert.doesNotMatch(result.source, /prepaint-proof.*<|<.*prepaint-proof/u);
});

test("Reader prepaint fails closed before changing the document", () => {
  const candidates = [
    null,
    "not json",
    JSON.stringify({
      schemaVersion: 1,
      fontScale: 500,
      fontFamilyId: "serif",
      colorScheme: "black",
      motion: "reduced",
      highlights: false,
      focus: "strong",
    }),
    JSON.stringify({
      schemaVersion: 1,
      fontScale: 120,
      fontFamilyId: "author-controlled-font",
      colorScheme: "black",
      motion: "reduced",
      highlights: false,
      focus: "strong",
    }),
    "x".repeat(16_385),
  ];

  for (const stored of candidates) {
    const result = executePrepaint({ stored });
    assert.deepEqual({ ...result.attributes }, {});
    assert.deepEqual({ ...result.properties }, {});
  }
});
