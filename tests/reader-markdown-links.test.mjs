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

import { fromMarkdown } from "mdast-util-from-markdown";

import {
  applyReaderLinksToMarkdown,
} from "../packages/reader/dist/markdown.js";

const DIGEST = `sha256:${"0".repeat(64)}`;

function block(markdown, overrides = {}) {
  return {
    id: "opening",
    kind: "paragraph",
    markdown,
    text: markdown,
    readerAddress: null,
    domId: null,
    wordCount: 1,
    contentHash: DIGEST,
    ...overrides,
  };
}

function link(start, end, overrides = {}) {
  return {
    id: `link-${start}-${end}`,
    source: {
      kind: "block-markdown",
      workId: "work",
      sectionId: "section",
      blockId: "opening",
      range: { start, end },
    },
    target: {
      kind: "external",
      url: "https://example.com/",
    },
    href: "/target",
    ...overrides,
  };
}

function rangeOf(markdown, selection) {
  const start = markdown.indexOf(selection);
  assert.notEqual(start, -1, selection);
  return [start, start + selection.length];
}

function assertInvalid(result, code) {
  assert.equal(result.valid, false);
  assert.ok(
    result.diagnostics.some((item) => item.code === code),
    JSON.stringify(result.diagnostics, null, 2),
  );
}

function visibleText(node) {
  if (node.type === "text") {
    return node.value;
  }
  return (node.children ?? []).map(visibleText).join("");
}

test("source-backed ReaderLinks apply in reverse range order with UTF-16 emoji offsets", () => {
  const markdown = "Alpha 🌀 beta and gamma.";
  const [emojiStart, emojiEnd] = rangeOf(markdown, "🌀");
  const [gammaStart, gammaEnd] = rangeOf(markdown, "gamma");
  assert.equal(emojiEnd - emojiStart, 2);

  const emojiLink = link(emojiStart, emojiEnd, {
    id: "symbol",
    href: "/symbols",
  });
  const gammaLink = link(gammaStart, gammaEnd, {
    id: "ending",
    href: "https://example.com/a(b)?x=1&y=2",
  });
  const forward = applyReaderLinksToMarkdown(
    block(markdown),
    [emojiLink, gammaLink],
  );
  const reverse = applyReaderLinksToMarkdown(
    block(markdown),
    [gammaLink, emojiLink],
  );

  assert.equal(forward.valid, true, JSON.stringify(forward.diagnostics));
  assert.equal(reverse.valid, true, JSON.stringify(reverse.diagnostics));
  const expected =
    "Alpha [🌀](</symbols>) beta and " +
    "[gamma](<https://example.com/a(b)?x=1&y=2>).";
  assert.equal(forward.value, expected);
  assert.equal(reverse.value, expected);
  assert.equal(
    visibleText(fromMarkdown(forward.value)),
    visibleText(fromMarkdown(markdown)),
  );
});

test("complete formatting containers and complete character references remain representable", () => {
  for (const [markdown, selection, expected] of [
    [
      "**bold _inside_**",
      "**bold _inside_**",
      "[**bold _inside_**](</target>)",
    ],
    [
      "A\\*B &amp; C",
      "&amp;",
      "A\\*B [&amp;](</target>) C",
    ],
  ]) {
    const [start, end] = rangeOf(markdown, selection);
    const result = applyReaderLinksToMarkdown(
      block(markdown),
      [link(start, end)],
    );
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    assert.equal(result.value, expected);
  }
});

test("a source-backed link may select part of one emphasis text node", () => {
  const markdown = "one *two* three";
  const result = applyReaderLinksToMarkdown(block(markdown), [
    link(...rangeOf(markdown, "two")),
  ]);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.value, "one *[two](</target>)* three");
});

test("a source-backed link may leave punctuation inside one strong container", () => {
  const markdown = "The **Cardinal Scale.** remains.";
  const result = applyReaderLinksToMarkdown(block(markdown), [
    link(...rangeOf(markdown, "Cardinal Scale")),
  ]);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(
    result.value,
    "The **[Cardinal Scale](</target>).** remains.",
  );
});

test("two disjoint source-backed links may share one emphasis container", () => {
  const markdown = "*First soil, then flower.*";
  const soilLink = link(...rangeOf(markdown, "soil"), {
    id: "soil",
    href: "/soil",
  });
  const flowerLink = link(...rangeOf(markdown, "flower"), {
    id: "flower",
    href: "/flower",
  });
  const forward = applyReaderLinksToMarkdown(
    block(markdown),
    [soilLink, flowerLink],
  );
  const reverse = applyReaderLinksToMarkdown(
    block(markdown),
    [flowerLink, soilLink],
  );

  const expected =
    "*First [soil](</soil>), then [flower](</flower>).*";
  assert.equal(forward.valid, true, JSON.stringify(forward.diagnostics));
  assert.equal(reverse.valid, true, JSON.stringify(reverse.diagnostics));
  assert.equal(forward.value, expected);
  assert.equal(reverse.value, expected);
});

test("an empty source-backed link list preserves exact Markdown bytes", () => {
  const markdown = "Literal [unfinished source and 🌀.";
  const result = applyReaderLinksToMarkdown(block(markdown), []);
  assert.deepEqual(result, {
    valid: true,
    value: markdown,
    diagnostics: [],
  });
});

test("semantic links remain outside Markdown source application", () => {
  const result = applyReaderLinksToMarkdown(block("Visible prose"), [
    {
      ...link(0, 7),
      source: {
        kind: "semantic",
        workId: "work",
        sectionId: "section",
      },
    },
  ]);
  assertInvalid(result, "reader.markdown.link_source_semantic");
});

test("link ranges must belong to the supplied block", () => {
  const result = applyReaderLinksToMarkdown(block("Visible prose"), [
    {
      ...link(0, 7),
      source: {
        ...link(0, 7).source,
        blockId: "another-block",
      },
    },
  ]);
  assertInvalid(result, "reader.markdown.link_block_mismatch");
});

test("malformed and surrogate-splitting UTF-16 ranges fail closed", () => {
  const markdown = "A 🌀 B";
  const emojiStart = markdown.indexOf("🌀");
  for (const range of [
    { start: -1, end: 1 },
    { start: 0, end: 0 },
    { start: 0.5, end: 1 },
    { start: 0, end: markdown.length + 1 },
    { start: emojiStart + 1, end: emojiStart + 2 },
    { start: emojiStart, end: emojiStart + 1 },
  ]) {
    const result = applyReaderLinksToMarkdown(block(markdown), [
      {
        ...link(0, 1),
        source: {
          ...link(0, 1).source,
          range,
        },
      },
    ]);
    assertInvalid(result, "reader.markdown.link_range_invalid");
  }
});

test("duplicate and overlapping source ranges are rejected deterministically", () => {
  const duplicate = applyReaderLinksToMarkdown(block("alpha beta"), [
    link(0, 5, { id: "first" }),
    link(0, 5, { id: "second", href: "/second" }),
  ]);
  assertInvalid(duplicate, "reader.markdown.link_range_duplicate");

  const overlapping = applyReaderLinksToMarkdown(block("alpha beta"), [
    link(0, 5, { id: "first" }),
    link(4, 10, { id: "second", href: "/second" }),
  ]);
  assertInvalid(overlapping, "reader.markdown.link_range_overlap");
});

test("ranges still cannot cross inline nodes", () => {
  const markdown = "one *two* three";
  const crossing = applyReaderLinksToMarkdown(block(markdown), [
    link(...rangeOf(markdown, "one *two*")),
  ]);
  assertInvalid(crossing, "reader.markdown.link_range_crosses_nodes");
});

test("existing link, code, image, and HTML contexts reject attachment", () => {
  for (const [markdown, selection, context] of [
    ["before [existing](/old) after", "existing", "link"],
    ["before `code` after", "code", "inlineCode"],
    ["    code block", "code", "code"],
    ["before ![image](/image.png) after", "image", "image"],
    ["before <span>inside</span> after", "inside", "html"],
  ]) {
    const result = applyReaderLinksToMarkdown(block(markdown), [
      link(...rangeOf(markdown, selection)),
    ]);
    assertInvalid(result, "reader.markdown.link_context_forbidden");
    assert.ok(
      result.diagnostics.some(
        (item) =>
          item.code === "reader.markdown.link_context_forbidden" &&
          item.params.context === context,
      ),
      JSON.stringify(result.diagnostics, null, 2),
    );
  }
});

test("unsafe partial escapes and character references cannot change visible prose", () => {
  const escaped = "A\\*B";
  assertInvalid(
    applyReaderLinksToMarkdown(block(escaped), [link(1, 2)]),
    "reader.markdown.output_unrepresentable",
  );

  const entity = "A &amp; B";
  const ampersand = entity.indexOf("&");
  assertInvalid(
    applyReaderLinksToMarkdown(
      block(entity),
      [link(ampersand, ampersand + 4)],
    ),
    "reader.markdown.output_unrepresentable",
  );
});

test("noncanonical internal and external hrefs fail before Markdown mutation", () => {
  for (const href of [
    "/target/%FF",
    "/target/%41",
    "/target#",
    "https://user:secret@example.com/",
  ]) {
    const result = applyReaderLinksToMarkdown(block("Visible"), [
      link(0, 7, { href }),
    ]);
    assertInvalid(result, "reader.markdown.link_href_invalid");
  }
});

test("uninspectable input records fail without invoking properties", () => {
  const hostile = new Proxy(link(0, 7), {
    ownKeys() {
      throw new Error("hostile");
    },
  });
  const result = applyReaderLinksToMarkdown(
    block("Visible"),
    [hostile],
  );
  assertInvalid(result, "reader.markdown.input_uninspectable");
});
