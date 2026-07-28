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
  defaultPublisherNextTheme,
  resolveDefaultPublisherNextTheme,
  validatePublisherNextThemeInstance,
} from "../packages/next/dist/theme/index.js";

function assertValid(result) {
  assert.equal(
    result.valid,
    true,
    JSON.stringify(result.diagnostics, null, 2),
  );
  return result.value;
}

function diagnosticCodes(result) {
  return result.diagnostics.map(({ code }) => code);
}

function validThemeInput() {
  return structuredClone(
    assertValid(defaultPublisherNextTheme.configure({})),
  );
}

test("the default theme resolves a closed immutable token snapshot", () => {
  const resolved = resolveDefaultPublisherNextTheme({
    mode: "dark",
  });
  assert.deepEqual(
    {
      package: resolved.package,
      version: resolved.version,
      rendererCompatibility: resolved.rendererCompatibility,
      kind: resolved.implementation.kind,
      apiVersion: resolved.implementation.apiVersion,
    },
    {
      package: "@genii-foundation/publisher-next",
      version: "0.1.0-alpha.0",
      rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
      kind: "genii.publisher.next-theme",
      apiVersion: "1.0",
    },
  );

  const configured = assertValid(
    resolved.implementation.configure(resolved.config),
  );
  assert.equal(configured.tokens.color.canvas, "#11181A");
  assert.equal(Object.isFrozen(configured), true);
  assert.equal(Object.isFrozen(configured.tokens), true);
  assert.equal(Object.isFrozen(configured.tokens.color), true);
  assert.equal(Object.isFrozen(configured.tokens.typography), true);
  assert.equal(Object.isFrozen(configured.tokens.layout), true);
});

test("theme validation rejects extra properties and unsafe CSS values", () => {
  const extra = validThemeInput();
  extra.tokens.extra = {};
  const extraResult = validatePublisherNextThemeInstance(extra);
  assert.equal(extraResult.valid, false);
  assert.deepEqual(diagnosticCodes(extraResult), [
    "next.theme.tokens.invalid",
  ]);

  const fontInjection = validThemeInput();
  fontInjection.tokens.typography.bodyFamily =
    "serif; display: none";
  const fontResult =
    validatePublisherNextThemeInstance(fontInjection);
  assert.equal(fontResult.valid, false);
  assert.deepEqual(diagnosticCodes(fontResult), [
    "next.theme.font.invalid",
  ]);

  const calculatedDimension = validThemeInput();
  calculatedDimension.tokens.layout.pageGutter =
    "calc(100vw)";
  const dimensionResult = validatePublisherNextThemeInstance(
    calculatedDimension,
  );
  assert.equal(dimensionResult.valid, false);
  assert.deepEqual(diagnosticCodes(dimensionResult), [
    "next.theme.dimension.invalid",
  ]);

  const characterBaseSize = validThemeInput();
  characterBaseSize.tokens.typography.baseSize = "1ch";
  const baseSizeResult = validatePublisherNextThemeInstance(
    characterBaseSize,
  );
  assert.equal(baseSizeResult.valid, false);
  assert.deepEqual(diagnosticCodes(baseSizeResult), [
    "next.theme.base_size.invalid",
  ]);
});

test("theme validation enforces readable color contrast", () => {
  const text = validThemeInput();
  text.tokens.color.text = "#F7F4EC";
  const textResult = validatePublisherNextThemeInstance(text);
  assert.equal(textResult.valid, false);
  assert.deepEqual(diagnosticCodes(textResult), [
    "next.theme.color.contrast",
  ]);

  const surface = validThemeInput();
  surface.tokens.color.surface = "#182326";
  const surfaceResult =
    validatePublisherNextThemeInstance(surface);
  assert.equal(surfaceResult.valid, false);
  assert.deepEqual(diagnosticCodes(surfaceResult), [
    "next.theme.surface.contrast",
  ]);

  const malformed = validThemeInput();
  malformed.tokens.color.accent = "transparent";
  const malformedResult =
    validatePublisherNextThemeInstance(malformed);
  assert.equal(malformedResult.valid, false);
  assert.deepEqual(diagnosticCodes(malformedResult), [
    "next.theme.color.invalid",
  ]);

  for (const key of ["mutedText", "accent", "focus"]) {
    const surfaceCollision = validThemeInput();
    surfaceCollision.tokens.color.canvas = "#FFFFFF";
    surfaceCollision.tokens.color.surface = "#000000";
    surfaceCollision.tokens.color.text = "#767676";
    surfaceCollision.tokens.color.mutedText = "#767676";
    surfaceCollision.tokens.color.accent = "#767676";
    surfaceCollision.tokens.color.focus = "#767676";
    surfaceCollision.tokens.color[key] = "#000000";
    const result = validatePublisherNextThemeInstance(
      surfaceCollision,
    );
    assert.equal(result.valid, false, key);
    assert.deepEqual(diagnosticCodes(result), [
      "next.theme.surface_color.contrast",
    ]);
  }
});

test("theme validation never invokes accessors", () => {
  const input = validThemeInput();
  let getterCalls = 0;
  Object.defineProperty(input.tokens.color, "text", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "#182326";
    },
  });

  const result = validatePublisherNextThemeInstance(input);
  assert.equal(result.valid, false);
  assert.equal(getterCalls, 0);
  assert.deepEqual(diagnosticCodes(result), [
    "next.theme.token_group.invalid",
  ]);
});

test("theme validation contains hostile reflective traps", () => {
  for (const trap of [
    "getOwnPropertyDescriptor",
    "getOwnPropertyDescriptors",
    "getOwnPropertySymbols",
    "getPrototypeOf",
    "ownKeys",
  ]) {
    const hostile = new Proxy(
      {},
      {
        [trap]() {
          throw new Error(`hostile ${trap}`);
        },
      },
    );
    let result;
    assert.doesNotThrow(() => {
      result = validatePublisherNextThemeInstance(hostile);
    });
    assert.equal(result.valid, false);
    assert.deepEqual(diagnosticCodes(result), [
      "next.theme.instance.invalid",
    ]);
  }
});

test("default theme configuration rejects unknown and unreadable values", () => {
  for (const config of [
    { unexpected: true },
    { mode: "sepia" },
    { accent: "red" },
    { accent: "#F7F4EC" },
  ]) {
    const result = defaultPublisherNextTheme.configure(config);
    assert.equal(result.valid, false);
  }
  for (const hostile of [
    Object.defineProperty({}, "mode", {
      enumerable: true,
      get() {
        throw new Error("hostile getter");
      },
    }),
    new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("hostile reflection");
        },
      },
    ),
  ]) {
    let result;
    assert.doesNotThrow(() => {
      result = defaultPublisherNextTheme.configure(hostile);
    });
    assert.equal(result.valid, false);
  }
});

test("validated tokens are detached from mutable caller input", () => {
  const input = validThemeInput();
  const result = assertValid(
    validatePublisherNextThemeInstance(input),
  );
  const original = result.tokens.color.text;
  input.tokens.color.text = "#000000";
  input.tokens.layout.pageGutter = "99rem";

  assert.equal(result.tokens.color.text, original);
  assert.notEqual(
    result.tokens.layout.pageGutter,
    input.tokens.layout.pageGutter,
  );
});
