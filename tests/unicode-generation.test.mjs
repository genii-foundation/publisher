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
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizePortableRepositoryText,
} from "../schemas/dist/index.js";
import {
  verifyUnicodeDataSnapshot,
} from "../schemas/scripts/generate-case-folding.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("UnicodeData verification accepts an exact derived snapshot", () => {
  const source = [
    "0041;LATIN CAPITAL LETTER A;Lu;0;L;;;;;N;;;;0061;",
    "00C0;LATIN CAPITAL LETTER A WITH GRAVE;Lu;0;L;0041 0300;;;;N;LATIN CAPITAL LETTER A GRAVE;;;00E0;",
    "0300;COMBINING GRAVE ACCENT;Mn;230;NSM;;;;;N;NON-SPACING GRAVE ACCENT;;;;",
    "",
  ].join("\n");
  const sourceMetadata = {
    sha256: sha256(source),
    url: "https://example.test/UnicodeData.txt",
  };
  const expected = {
    unicodeVersion: "15.1.0",
    source: sourceMetadata,
    canonicalCombiningClasses: [
      [
        0x0300,
        230,
      ],
    ],
    canonicalDecompositions: [
      [
        0x00c0,
        [
          0x0041,
          0x0300,
        ],
      ],
    ],
  };
  const snapshot = `${JSON.stringify(expected)}\n`;

  assert.deepEqual(
    verifyUnicodeDataSnapshot(
      source,
      snapshot,
      sourceMetadata,
    ),
    expected,
  );
});

test("UnicodeData verification rejects stale derived data and source mismatches", () => {
  const source =
    "0300;COMBINING GRAVE ACCENT;Mn;230;NSM;;;;;N;NON-SPACING GRAVE ACCENT;;;;\n";
  const sourceMetadata = {
    sha256: sha256(source),
    url: "https://example.test/UnicodeData.txt",
  };
  const stale = `${JSON.stringify({
    unicodeVersion: "15.1.0",
    source: sourceMetadata,
    canonicalCombiningClasses: [
      [
        0x0300,
        220,
      ],
    ],
    canonicalDecompositions: [],
  })}\n`;

  assert.throws(
    () =>
      verifyUnicodeDataSnapshot(
        source,
        stale,
        sourceMetadata,
      ),
    /stale or does not derive/u,
  );
  assert.throws(
    () =>
      verifyUnicodeDataSnapshot(
        `${source}\n`,
        stale,
        sourceMetadata,
      ),
    /checksum .* does not match pinned/u,
  );
});

test("the compiled public normalizer passes every official Unicode 15.1 NFC conformance case", async () => {
  const source = await readFile(
    new URL(
      "../schemas/third-party-data/NormalizationTest-15.1.0.txt",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(
    sha256(source),
    "871238e37e3be0696ec2bd0891119a041b052da1a84485eda05a5438724b223e",
  );

  function sequence(field) {
    return field
      .trim()
      .split(/ +/u)
      .map((codePoint) =>
        String.fromCodePoint(Number.parseInt(codePoint, 16))
      )
      .join("");
  }

  let caseCount = 0;
  for (const line of source.split(/\r?\n/u)) {
    const content = line.split("#", 1)[0].trim();
    if (content.length === 0 || content.startsWith("@")) {
      continue;
    }
    const fields = content
      .split(";")
      .slice(0, 5)
      .map(sequence);
    assert.equal(fields.length, 5);
    const [c1, c2, c3, c4, c5] = fields;
    assert.equal(normalizePortableRepositoryText(c1), c2);
    assert.equal(normalizePortableRepositoryText(c2), c2);
    assert.equal(normalizePortableRepositoryText(c3), c2);
    assert.equal(normalizePortableRepositoryText(c4), c4);
    assert.equal(normalizePortableRepositoryText(c5), c4);
    caseCount += 1;
  }
  assert.ok(caseCount > 19_000);
});
