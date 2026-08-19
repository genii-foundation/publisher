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
  createSpokenInputIdentity,
} from "@genii-foundation/publisher-content";
import {
  createReaderNarrationSectionTextProfile,
} from "../packages/reader/dist/narration.js";

function codes(result) {
  return result.diagnostics.map(({ code }) => code);
}

test("spoken input identity matches the renderer's closed narration profile", () => {
  const input = {
    sectionId: "opening",
    title: "  A Quiet Opening  ",
    spokenBody: " First   light.\nWater\treturns. ",
  };
  const original = structuredClone(input);
  const result = createSpokenInputIdentity(input);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.value, {
    sectionId: "opening",
    title: "A Quiet Opening",
    spokenBody: "First light. Water returns.",
    spokenText: "A Quiet Opening\n\nFirst light. Water returns.",
    spokenTextSha256:
      "sha256:dbbb911dec3fb5ecd9cc6cd8393c57fed8af686cfbb52401a57d5ffda4f07960",
    textCharacters: 44,
  });
  const rendererProfile = createReaderNarrationSectionTextProfile({
    title: input.title,
    blocks: [
      { kind: "heading", text: input.title },
      { kind: "paragraph", text: " First   light. " },
      { kind: "paragraph", text: "Water returns." },
    ],
  });
  assert.equal(result.value.spokenText, rendererProfile.text);
  assert.equal(result.value.textCharacters, rendererProfile.textCharacters);
  assert.equal(Object.isFrozen(result.value), true);
  assert.deepEqual(input, original);
});

test("presentation whitespace does not change spoken identity", () => {
  const compact = createSpokenInputIdentity({
    sectionId: "opening",
    title: "A Quiet Opening",
    spokenBody: "First light. Water returns.",
  });
  const formatted = createSpokenInputIdentity({
    sectionId: "opening",
    title: "  A Quiet Opening  ",
    spokenBody: "\nFirst\t light.\n\nWater   returns.\n",
  });
  assert.equal(compact.valid, true);
  assert.equal(formatted.valid, true);
  assert.equal(
    compact.value.spokenTextSha256,
    formatted.value.spokenTextSha256,
  );
});

test("spoken title and body changes invalidate the identity", () => {
  const original = createSpokenInputIdentity({
    sectionId: "opening",
    title: "First title",
    spokenBody: "The body remains unchanged.",
  });
  const renamed = createSpokenInputIdentity({
    sectionId: "opening",
    title: "Second title",
    spokenBody: "The body remains unchanged.",
  });
  const revised = createSpokenInputIdentity({
    sectionId: "opening",
    title: "First title",
    spokenBody: "The body has changed.",
  });
  assert.equal(original.valid, true);
  assert.equal(renamed.valid, true);
  assert.equal(revised.valid, true);
  assert.notEqual(
    original.value.spokenTextSha256,
    renamed.value.spokenTextSha256,
  );
  assert.notEqual(
    original.value.spokenTextSha256,
    revised.value.spokenTextSha256,
  );
});

test("spoken input identity rejects malformed and ambiguous text", () => {
  for (const [input, expectedCode] of [
    [null, "spoken_input.invalid"],
    [{ sectionId: "Opening", title: "Title", spokenBody: "Body" },
      "spoken_input.section_id.invalid"],
    [{ sectionId: "opening", title: " ", spokenBody: "Body" },
      "spoken_input.title.invalid"],
    [{ sectionId: "opening", title: "Title", spokenBody: "\ud800" },
      "spoken_input.body.invalid"],
    [{ sectionId: "opening", title: "Title", spokenBody: "Body", extra: true },
      "spoken_input.properties"],
  ]) {
    const result = createSpokenInputIdentity(input);
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes(expectedCode), JSON.stringify(result.diagnostics));
  }

  const hostile = createSpokenInputIdentity(new Proxy({}, {
    ownKeys() {
      throw new Error("uninspectable");
    },
  }));
  assert.equal(hostile.valid, false);
  assert.ok(codes(hostile).includes("spoken_input.uninspectable"));
});
