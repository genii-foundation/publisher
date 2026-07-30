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
  parseJsonWithUniqueObjectKeys,
  STRICT_JSON_DIAGNOSTIC_CODES,
  STRICT_JSON_LIMITS,
} from "../schemas/dist/index.js";

function assertInvalid(input, expectedCode) {
  const result = parseJsonWithUniqueObjectKeys(input);
  assert.equal(result.valid, false, JSON.stringify(result, null, 2));
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, expectedCode);
  return result.diagnostics[0];
}

function assertDeeplyFrozen(value) {
  if (value === null || typeof value !== "object") {
    return;
  }
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    assertDeeplyFrozen(child);
  }
}

test("strict JSON parses every JSON value and preserves repeated array values", () => {
  const result = parseJsonWithUniqueObjectKeys(
    '{"values":["same","same",{"label":"same"}],"truth":true,"nothing":null,"number":-1.25e2}',
  );
  assert.equal(result.valid, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.value, {
    values: ["same", "same", { label: "same" }],
    truth: true,
    nothing: null,
    number: -125,
  });
  assertDeeplyFrozen(result);

  for (const [text, value] of [
    ['"text"', "text"],
    ["0", 0],
    ["-0", -0],
    ["false", false],
    ["null", null],
    ["[]", []],
    ["{}", {}],
  ]) {
    const scalar = parseJsonWithUniqueObjectKeys(text);
    assert.equal(scalar.valid, true, text);
    assert.deepEqual(scalar.value, value, text);
  }
});

test("strict JSON rejects nested and escaped-equivalent duplicate object members", () => {
  const nested = assertInvalid(
    '{"outer":{"id":"first","id":"second"}}',
    STRICT_JSON_DIAGNOSTIC_CODES.duplicateMember,
  );
  assert.equal(nested.path, "/outer/id");
  assert.equal(nested.keyword, "uniqueObjectMember");
  assert.equal(typeof nested.params.firstOffset, "number");
  assert.equal(typeof nested.params.duplicateOffset, "number");
  assert.ok(
    nested.params.duplicateOffset > nested.params.firstOffset,
  );

  const escaped = assertInvalid(
    '{"id":"first","\\u0069d":"second"}',
    STRICT_JSON_DIAGNOSTIC_CODES.duplicateMember,
  );
  assert.equal(escaped.path, "/id");

  const astral = assertInvalid(
    '{"😀":1,"\\ud83d\\ude00":2}',
    STRICT_JSON_DIAGNOSTIC_CODES.duplicateMember,
  );
  assert.equal(astral.path, "/😀");
});

test("strict JSON rejects lone surrogates and preserves astral pairs", () => {
  const highSurrogate = String.fromCharCode(0xd83d);
  const lowSurrogate = String.fromCharCode(0xde00);
  for (const [label, text, surrogateKind] of [
    [
      "raw high surrogate",
      `{"value":"${highSurrogate}"}`,
      "high",
    ],
    [
      "raw low surrogate",
      `{"value":"${lowSurrogate}"}`,
      "low",
    ],
    ["escaped high surrogate", '{"value":"\\ud83d"}', "high"],
    ["escaped low surrogate", '{"value":"\\ude00"}', "low"],
  ]) {
    const diagnostic = assertInvalid(
      text,
      STRICT_JSON_DIAGNOSTIC_CODES.unpairedSurrogate,
    );
    assert.equal(diagnostic.path, "/value", label);
    assert.equal(diagnostic.keyword, "wellFormedUnicode", label);
    assert.equal(
      diagnostic.params.decodedCodeUnitOffset,
      0,
      label,
    );
    assert.equal(
      diagnostic.params.surrogateKind,
      surrogateKind,
      label,
    );
  }

  for (const [label, text] of [
    ["raw pair", '{"value":"😀"}'],
    ["escaped pair", '{"value":"\\ud83d\\ude00"}'],
    [
      "raw high and escaped low",
      `{"value":"${highSurrogate}\\ude00"}`,
    ],
    [
      "escaped high and raw low",
      `{"value":"\\ud83d${lowSurrogate}"}`,
    ],
  ]) {
    const result = parseJsonWithUniqueObjectKeys(text);
    assert.equal(result.valid, true, `${label}: ${JSON.stringify(result)}`);
    assert.equal(result.value.value, "😀", label);
  }
});

test("strict JSON rejects malformed syntax and non-finite numeric conversion deterministically", () => {
  for (const text of [
    "",
    "{\"unterminated\":",
    '{"trailing":true,}',
    "[1,]",
    '"bad\\xescape"',
    "01",
    "1.",
    "1e",
    "true false",
  ]) {
    const diagnostic = assertInvalid(
      text,
      STRICT_JSON_DIAGNOSTIC_CODES.invalid,
    );
    assert.equal(diagnostic.keyword, "jsonSyntax", text);
    assert.equal(typeof diagnostic.params.reason, "string", text);
    assert.equal(typeof diagnostic.params.offset, "number", text);
  }

  const overflow = assertInvalid(
    "1e400",
    STRICT_JSON_DIAGNOSTIC_CODES.numberOutOfRange,
  );
  assert.equal(overflow.path, "");
});

test("strict JSON enforces fixed input, depth, token, and text limits", () => {
  assertInvalid(
    null,
    STRICT_JSON_DIAGNOSTIC_CODES.inputType,
  );

  const exactDepth =
    "[".repeat(STRICT_JSON_LIMITS.maximumDepth) +
    "0" +
    "]".repeat(STRICT_JSON_LIMITS.maximumDepth);
  const exactDepthResult =
    parseJsonWithUniqueObjectKeys(exactDepth);
  assert.equal(
    exactDepthResult.valid,
    true,
    JSON.stringify(exactDepthResult, null, 2),
  );

  const tooDeep =
    "[".repeat(STRICT_JSON_LIMITS.maximumDepth + 1) +
    "0" +
    "]".repeat(STRICT_JSON_LIMITS.maximumDepth + 1);
  const depth = assertInvalid(
    tooDeep,
    STRICT_JSON_DIAGNOSTIC_CODES.depthExceeded,
  );
  assert.equal(
    depth.params.maximumDepth,
    STRICT_JSON_LIMITS.maximumDepth,
  );

  const tooManyTokens =
    "[" +
    "0,".repeat(STRICT_JSON_LIMITS.maximumTokens) +
    "0]";
  const tokens = assertInvalid(
    tooManyTokens,
    STRICT_JSON_DIAGNOSTIC_CODES.tokenLimitExceeded,
  );
  assert.equal(
    tokens.params.maximumTokens,
    STRICT_JSON_LIMITS.maximumTokens,
  );

  const tooLarge = `"${"x".repeat(
    STRICT_JSON_LIMITS.maximumCodeUnits,
  )}"`;
  const size = assertInvalid(
    tooLarge,
    STRICT_JSON_DIAGNOSTIC_CODES.sizeExceeded,
  );
  assert.equal(
    size.params.maximumCodeUnits,
    STRICT_JSON_LIMITS.maximumCodeUnits,
  );
});
