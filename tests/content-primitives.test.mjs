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
  calculateReadingMinutes,
  canonicalizeJson,
  compileMarkdownWork,
  CONTENT_UNICODE_VERSION,
  countWords,
  normalizeTextNewlines,
  sha256,
} from "../packages/content/dist/index.js";
import {
  validateResolvedHref,
  validateRoute,
  validateStableId,
} from "../packages/content/dist/validation.js";

test("canonical JSON uses deterministic RFC 8785 ordering and scalars", () => {
  assert.equal(
    canonicalizeJson({
      z: 0,
      a: [true, false, null, -0, 1.5],
      "\u20ac": "Euro",
      "\r": "control",
      "😀": "astral",
    }),
    '{"\\r":"control","a":[true,false,null,0,1.5],"z":0,"€":"Euro","😀":"astral"}',
  );
  assert.equal(
    sha256("abc"),
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("canonical JSON rejects values outside the interoperable JSON domain", () => {
  const cycle = {};
  cycle.self = cycle;
  const sparse = [];
  sparse.length = 1;
  const accessor = {};
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get: () => 1,
  });
  const symbolKey = { safe: true };
  symbolKey[Symbol("hidden")] = true;
  const extraArrayProperty = [];
  extraArrayProperty.extra = true;

  for (const value of [
    cycle,
    sparse,
    accessor,
    symbolKey,
    extraArrayProperty,
    { value: Number.POSITIVE_INFINITY },
    { value: undefined },
    { value: new Map() },
    { value: "\ud800" },
    { "\udc00": "bad key" },
  ]) {
    assert.throws(() => canonicalizeJson(value), TypeError);
  }
});

test("Markdown normalization changes only line endings", () => {
  assert.equal(
    normalizeTextNewlines("  first\r\nsecond\rthird  "),
    "  first\nsecond\nthird  ",
  );

  const base = {
    workId: "field-note",
    sectionId: "field-note-root",
    title: "Field Note",
    sourcePath: "publication/works/field-note/manuscript.md",
  };
  const lf = compileMarkdownWork({
    ...base,
    markdown: "# Field Note\n\nA reading.",
  });
  const crlf = compileMarkdownWork({
    ...base,
    markdown: "# Field Note\r\n\r\nA reading.",
  });
  assert.equal(lf.valid, true, JSON.stringify(lf.diagnostics));
  assert.equal(crlf.valid, true, JSON.stringify(crlf.diagnostics));
  assert.deepEqual(crlf.value.work, lf.value.work);
  assert.equal(
    crlf.value.source.contents,
    "# Field Note\r\n\r\nA reading.",
  );
});

test("the neutral Markdown adapter preserves CommonMark block boundaries", () => {
  const markdown = [
    "# Field Note",
    "",
    "A paragraph with **weight**.",
    "",
    "```text",
    "first",
    "",
    "second",
    "```",
    "",
  ].join("\n");
  const result = compileMarkdownWork({
    workId: "field-note",
    sectionId: "field-note-root",
    title: "Field Note",
    sourcePath: "publication/works/field-note/manuscript.md",
    markdown,
  });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    result.value.work.sections[0].blocks.map(({ kind }) => kind),
    ["heading", "paragraph", "code"],
  );
  assert.equal(
    result.value.work.sections[0].blocks[2].markdown,
    "```text\nfirst\n\nsecond\n```",
  );
  assert.equal(result.value.work.sections[0].blocks[1].text, "A paragraph with weight.");
  assert.deepEqual(result.value.work.sections[0].continuity, {
    id: "field-note-root",
    legacyIds: [],
    progressGroups: [["field-note-root"]],
    historicalSectionIds: [],
  });
  assert.equal(result.value.work.sections[0].role, "section");
  assert.equal(result.value.work.sections[0].navigable, true);
});

test("the Markdown adapter rejects malformed runtime input without throwing", () => {
  for (const input of [undefined, null, 42, "markdown", []]) {
    let result;
    assert.doesNotThrow(() => {
      result = compileMarkdownWork(input);
    });
    assert.equal(result.valid, false);
    assert.equal(result.diagnostics[0].code, "markdown.input.invalid_type");
  }

  const missing = compileMarkdownWork({});
  assert.equal(missing.valid, false);
  assert.deepEqual(
    missing.diagnostics.map(({ path }) => path),
    ["/markdown", "/sectionId", "/sourcePath", "/title", "/workId"],
  );

  const wrongTypes = compileMarkdownWork({
    workId: 1,
    sectionId: [],
    title: null,
    sourcePath: {},
    markdown: Symbol("markdown"),
  });
  assert.equal(wrongTypes.valid, false);
  assert.deepEqual(
    wrongTypes.diagnostics.map(({ code }) => code),
    Array(5).fill("markdown.input.invalid_type"),
  );

  const cyclicMetadata = {};
  cyclicMetadata.self = cyclicMetadata;
  const invalidMetadata = compileMarkdownWork({
    workId: "field-note",
    sectionId: "field-note-root",
    title: "Field Note",
    sourcePath: "publication/works/field-note/manuscript.md",
    markdown: "# Field Note",
    sectionMetadata: cyclicMetadata,
  });
  assert.equal(invalidMetadata.valid, false);
  assert.equal(
    invalidMetadata.diagnostics[0].code,
    "markdown.metadata.invalid",
  );

  const unreadable = {
    sectionId: "field-note-root",
    title: "Field Note",
    sourcePath: "publication/works/field-note/manuscript.md",
    markdown: "# Field Note",
  };
  Object.defineProperty(unreadable, "workId", {
    enumerable: true,
    get() {
      throw new Error("must not escape the adapter");
    },
  });
  const unreadableResult = compileMarkdownWork(unreadable);
  assert.equal(unreadableResult.valid, false);
  assert.equal(
    unreadableResult.diagnostics[0].code,
    "markdown.input.unreadable",
  );
});

test("route primitives are total and preserve trailing-slash routes", () => {
  for (const value of [undefined, null, 42, Symbol("route"), {}]) {
    const idDiagnostics = [];
    const routeDiagnostics = [];
    assert.doesNotThrow(() => {
      assert.equal(
        validateStableId(value, "/id", idDiagnostics),
        false,
      );
      assert.equal(
        validateRoute(value, "/route", routeDiagnostics),
        false,
      );
    });
    assert.equal(idDiagnostics[0].code, "content.id.invalid");
    assert.equal(routeDiagnostics[0].code, "content.route.invalid");
  }

  assert.equal(validateRoute("/", "/route", []), true);
  assert.equal(validateRoute("/works/field-note/", "/route", []), true);
  for (const route of [
    "/works/field-note/?mode=reader",
    "/works/field-note/#field-note-root",
    "/works//field-note/",
  ]) {
    assert.equal(validateRoute(route, "/route", []), false);
  }

  const result = compileMarkdownWork({
    workId: "field-note",
    sectionId: "field-note-root",
    title: "Field Note",
    sourcePath: "publication/works/field-note/manuscript.md",
    markdown: "# Field Note",
    route: "/works/field-note/",
  });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.value.work.sections[0].routes, {
    canonical: { path: "/works/field-note/" },
  });
  assert.deepEqual(
    result.value.work.sections[0].activeRouteNames,
    ["canonical"],
  );
});

test("route anchors create structured non-active addresses", () => {
  const result = compileMarkdownWork({
    workId: "field-note",
    sectionId: "field-note-root",
    title: "Field Note",
    sourcePath: "publication/works/field-note/manuscript.md",
    markdown: "# Field Note",
    route: "/reader/",
    routeAnchor: "field-note-root",
  });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.value.work.sections[0].routes, {
    canonical: {
      path: "/reader/",
      anchor: "field-note-root",
    },
  });
  assert.deepEqual(result.value.work.sections[0].activeRouteNames, []);

  for (const input of [
    {
      workId: "field-note",
      sectionId: "field-note-root",
      title: "Field Note",
      sourcePath: "publication/works/field-note/manuscript.md",
      markdown: "# Field Note",
      routeAnchor: "field-note-root",
    },
    {
      workId: "field-note",
      sectionId: "field-note-root",
      title: "Field Note",
      sourcePath: "publication/works/field-note/manuscript.md",
      markdown: "# Field Note",
      route: "/reader/",
      routeAnchor: "Field Note",
    },
  ]) {
    const invalid = compileMarkdownWork(input);
    assert.equal(invalid.valid, false);
  }
});

test("resolved internal hrefs may carry one portable URL fragment", () => {
  for (const href of [
    "/reader/#field-note-root",
    "/reader#field-note-root",
    "/#field-note-root",
    "/reader/#Field-Note",
  ]) {
    assert.equal(validateResolvedHref(href, "/href", []), true);
  }

  for (const href of [
    "/reader/?mode=reader#field-note-root",
    "/reader/#",
    "/reader/#Field Note",
    "/reader/#field-note-root#second",
  ]) {
    assert.equal(validateResolvedHref(href, "/href", []), false);
  }
});

test("word and reading-time primitives have explicit edge behavior", () => {
  assert.equal(CONTENT_UNICODE_VERSION, "15.1.0");
  assert.equal(countWords("Don't count naïve punctuation twice: 42."), 6);
  assert.equal(countWords("𑼂"), 1);
  assert.equal(countWords("\u{1C89}"), 0);
  assert.equal(countWords("one''two"), 2);
  assert.equal(calculateReadingMinutes(0, 220), 0);
  assert.equal(calculateReadingMinutes(1, 220), 1);
  assert.equal(calculateReadingMinutes(221, 220), 2);
  assert.throws(() => calculateReadingMinutes(-1, 220), TypeError);
  assert.throws(() => calculateReadingMinutes(1, 0), TypeError);
});
