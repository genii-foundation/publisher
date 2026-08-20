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

import {
  inspectAbsoluteHttpUrl,
  inspectCanonicalUrlFragment,
  type Diagnostic,
  type ReaderBlock,
  type ReaderLink,
  type ValidationResult,
} from "@genii-foundation/publisher-schema/reader";
import { inspectCanonicalRoutePath } from "@genii-foundation/publisher-schema/routes";
import { fromMarkdown } from "mdast-util-from-markdown";

import { diagnostic, sortDiagnostics } from "./diagnostics.js";
import { immutableSnapshot } from "./immutability.js";

export type ReaderBlockMarkdownLink = ReaderLink & {
  readonly source: Extract<
    ReaderLink["source"],
    { readonly kind: "block-markdown" }
  >;
};

interface MarkdownPoint {
  readonly offset?: number;
}

interface MarkdownPosition {
  readonly start: MarkdownPoint;
  readonly end: MarkdownPoint;
}

interface MarkdownNode {
  readonly type: string;
  readonly children?: readonly MarkdownNode[];
  readonly position?: MarkdownPosition;
  readonly [key: string]: unknown;
}

interface NodeRecord {
  readonly node: MarkdownNode;
  readonly ancestors: readonly MarkdownNode[];
  readonly start: number;
  readonly end: number;
}

interface PreparedLink {
  readonly href: string;
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

interface ExpectedInjectedLink {
  readonly href: string;
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

type NormalizedNode = Readonly<Record<string, unknown>>;

const EMPTY_DIAGNOSTICS: readonly Diagnostic[] = Object.freeze([]);
const FORMATTING_NODE_TYPES: ReadonlySet<string> = new Set([
  "emphasis",
  "strong",
]);
const FORBIDDEN_NODE_TYPES: ReadonlySet<string> = new Set([
  "code",
  "html",
  "image",
  "imageReference",
  "inlineCode",
  "link",
  "linkReference",
]);

function validResult(value: string): ValidationResult<string> {
  return Object.freeze({
    valid: true,
    value,
    diagnostics: EMPTY_DIAGNOSTICS,
  });
}

function invalidResult(
  diagnostics: readonly Diagnostic[],
): ValidationResult<string> {
  return immutableSnapshot({
    valid: false,
    diagnostics: sortDiagnostics(diagnostics),
  });
}

function splitsSurrogatePair(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) {
    return false;
  }
  const previous = value.charCodeAt(offset - 1);
  const current = value.charCodeAt(offset);
  return (
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff
  );
}

function nodeRange(
  node: MarkdownNode,
): { readonly start: number; readonly end: number } | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return Number.isInteger(start) &&
    Number.isInteger(end) &&
    (start ?? -1) >= 0 &&
    (end ?? -1) >= (start ?? 0)
    ? { start: start as number, end: end as number }
    : undefined;
}

function collectNodeRecords(
  root: MarkdownNode,
):
  | { readonly valid: true; readonly records: readonly NodeRecord[] }
  | { readonly valid: false; readonly nodeType: string } {
  const records: NodeRecord[] = [];
  const pending: {
    readonly node: MarkdownNode;
    readonly ancestors: readonly MarkdownNode[];
  }[] = [{ node: root, ancestors: [] }];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    const range = nodeRange(current.node);
    if (range === undefined) {
      return { valid: false, nodeType: current.node.type };
    }
    records.push({
      node: current.node,
      ancestors: current.ancestors,
      ...range,
    });
    const children = current.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push({
          node: child,
          ancestors: [...current.ancestors, current.node],
        });
      }
    }
  }
  return { valid: true, records };
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function inspectCanonicalHref(
  href: unknown,
):
  | { readonly valid: true; readonly value: string }
  | { readonly valid: false; readonly issue: string } {
  if (typeof href !== "string") {
    return { valid: false, issue: "type" };
  }
  if (!href.startsWith("/")) {
    return inspectAbsoluteHttpUrl(href);
  }

  const separator = href.indexOf("#");
  const route = separator < 0 ? href : href.slice(0, separator);
  const routeInspection = inspectCanonicalRoutePath(route);
  if (!routeInspection.valid) {
    return {
      valid: false,
      issue: `route:${routeInspection.issue}`,
    };
  }
  if (separator < 0) {
    return { valid: true, value: href };
  }
  const fragmentInspection = inspectCanonicalUrlFragment(
    href.slice(separator + 1),
  );
  return fragmentInspection.valid
    ? { valid: true, value: href }
    : {
        valid: false,
        issue: `fragment:${fragmentInspection.issue}`,
      };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function parseMarkdown(markdown: string): MarkdownNode | undefined {
  try {
    return fromMarkdown(markdown) as unknown as MarkdownNode;
  } catch {
    return undefined;
  }
}

function prepareLinks(
  block: ReaderBlock,
  links: readonly ReaderLink[],
  diagnostics: Diagnostic[],
): readonly PreparedLink[] {
  const prepared: PreparedLink[] = [];

  links.forEach((link, index) => {
    const path = `/links/${index}`;
    if (!isPlainRecord(link)) {
      diagnostics.push(
        diagnostic(
          "reader.markdown.link_invalid",
          path,
          "A Markdown link must be a validated ReaderLink record.",
          "validatedReaderLink",
          {},
        ),
      );
      return;
    }
    if (!isPlainRecord(link.source)) {
      diagnostics.push(
        diagnostic(
          "reader.markdown.link_source_invalid",
          `${path}/source`,
          "A Markdown link source must be a plain block-markdown location.",
          "blockMarkdownSource",
          {},
        ),
      );
      return;
    }
    if (link.source.kind === "semantic") {
      diagnostics.push(
        diagnostic(
          "reader.markdown.link_source_semantic",
          `${path}/source/kind`,
          "Semantic ReaderLinks cannot be attached to Markdown source text.",
          "blockMarkdownSource",
          {},
        ),
      );
      return;
    }
    if (link.source.kind !== "block-markdown") {
      diagnostics.push(
        diagnostic(
          "reader.markdown.link_source_invalid",
          `${path}/source/kind`,
          "A Markdown link source must use the block-markdown profile.",
          "blockMarkdownSource",
          { kind: link.source.kind },
        ),
      );
      return;
    }
    if (link.source.blockId !== block.id) {
      diagnostics.push(
        diagnostic(
          "reader.markdown.link_block_mismatch",
          `${path}/source/blockId`,
          "A Markdown link source must identify the supplied reader block.",
          "blockIdentity",
          {
            actualBlockId: link.source.blockId,
            expectedBlockId: block.id,
          },
        ),
      );
    }

    const range = link.source.range;
    if (!isPlainRecord(range)) {
      diagnostics.push(
        diagnostic(
          "reader.markdown.link_range_invalid",
          `${path}/source/range`,
          "A Markdown link source requires one valid UTF-16 range.",
          "blockMarkdownRange",
          { reason: "shape" },
        ),
      );
      return;
    }
    const { start, end } = range;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      (start as number) < 0 ||
      (end as number) <= (start as number) ||
      (end as number) > block.markdown.length ||
      splitsSurrogatePair(block.markdown, start as number) ||
      splitsSurrogatePair(block.markdown, end as number)
    ) {
      diagnostics.push(
        diagnostic(
          "reader.markdown.link_range_invalid",
          `${path}/source/range`,
          "A Markdown link source must occupy a complete, nonempty UTF-16 range in the supplied block.",
          "blockMarkdownRange",
          {
            end,
            markdownLength: block.markdown.length,
            start,
          },
        ),
      );
      return;
    }

    const hrefInspection = inspectCanonicalHref(link.href);
    if (!hrefInspection.valid) {
      diagnostics.push(
        diagnostic(
          "reader.markdown.link_href_invalid",
          `${path}/href`,
          "A Markdown link href must retain its canonical reader serialization.",
          "canonicalHref",
          { issue: hrefInspection.issue },
        ),
      );
      return;
    }

    prepared.push({
      href: hrefInspection.value,
      index,
      start: start as number,
      end: end as number,
    });
  });

  const ordered = [...prepared].sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.index - right.index,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (
      previous.start === current.start &&
      previous.end === current.end
    ) {
      diagnostics.push(
        diagnostic(
          "reader.markdown.link_range_duplicate",
          `/links/${current.index}/source/range`,
          "Two ReaderLinks cannot claim the same Markdown source range.",
          "uniqueBlockMarkdownRange",
          { firstLinkIndex: previous.index },
        ),
      );
    } else if (current.start < previous.end) {
      diagnostics.push(
        diagnostic(
          "reader.markdown.link_range_overlap",
          `/links/${current.index}/source/range`,
          "ReaderLink Markdown source ranges cannot overlap.",
          "disjointBlockMarkdownRanges",
          { overlappingLinkIndex: previous.index },
        ),
      );
    }
  }
  return ordered;
}

function validateRepresentableRange(
  link: PreparedLink,
  records: readonly NodeRecord[],
  hasHtml: boolean,
  diagnostics: Diagnostic[],
): void {
  const path = `/links/${link.index}/source/range`;
  if (hasHtml) {
    diagnostics.push(
      diagnostic(
        "reader.markdown.link_context_forbidden",
        path,
        "ReaderLinks cannot be attached in a Markdown block containing raw HTML.",
        "safeMarkdownContext",
        { context: "html" },
      ),
    );
    return;
  }

  const forbidden = records.find(
    (record) =>
      FORBIDDEN_NODE_TYPES.has(record.node.type) &&
      rangesOverlap(link.start, link.end, record.start, record.end),
  );
  if (forbidden !== undefined) {
    diagnostics.push(
      diagnostic(
        "reader.markdown.link_context_forbidden",
        path,
        `ReaderLinks cannot be attached inside an existing ${forbidden.node.type} Markdown context.`,
        "safeMarkdownContext",
        { context: forbidden.node.type },
      ),
    );
    return;
  }

  const exactFormatting = records.find(
    (record) =>
      FORMATTING_NODE_TYPES.has(record.node.type) &&
      record.start === link.start &&
      record.end === link.end,
  );
  const containingText = records.find(
    (record) =>
      record.node.type === "text" &&
      record.start <= link.start &&
      link.end <= record.end,
  );
  const candidate = exactFormatting ?? containingText;
  if (candidate === undefined) {
    diagnostics.push(
      diagnostic(
        "reader.markdown.link_range_crosses_nodes",
        path,
        "A ReaderLink range must stay within one text node or exactly enclose one formatting container.",
        "singleMarkdownNode",
        {},
      ),
    );
    return;
  }
}

function injectionKey(start: number, end: number): string {
  return `${start}:${end}`;
}

function mergeAdjacentText(
  nodes: readonly NormalizedNode[],
): readonly NormalizedNode[] {
  const merged: NormalizedNode[] = [];
  for (const node of nodes) {
    const previous = merged[merged.length - 1];
    if (
      previous?.type === "text" &&
      node.type === "text" &&
      typeof previous.value === "string" &&
      typeof node.value === "string"
    ) {
      merged[merged.length - 1] = {
        ...previous,
        value: `${previous.value}${node.value}`,
      };
    } else {
      merged.push(node);
    }
  }
  return merged;
}

function normalizeNode(
  node: MarkdownNode,
  expectedLinks: ReadonlyMap<string, ExpectedInjectedLink>,
  consumedLinks: Set<string>,
): NormalizedNode {
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    if (key === "children" || key === "position") {
      continue;
    }
    const value = node[key];
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  const children = normalizeChildren(
    node.children ?? [],
    expectedLinks,
    consumedLinks,
  );
  if (node.children !== undefined) {
    normalized.children = children;
  }
  return normalized;
}

function normalizeChildren(
  children: readonly MarkdownNode[],
  expectedLinks: ReadonlyMap<string, ExpectedInjectedLink>,
  consumedLinks: Set<string>,
): readonly NormalizedNode[] {
  const normalized: NormalizedNode[] = [];
  for (const child of children) {
    const range = nodeRange(child);
    const key =
      range === undefined
        ? undefined
        : injectionKey(range.start, range.end);
    const expected =
      child.type === "link" && key !== undefined
        ? expectedLinks.get(key)
        : undefined;
    if (
      expected !== undefined &&
      child.url === expected.href &&
      child.title === null
    ) {
      consumedLinks.add(expected.key);
      normalized.push(
        ...normalizeChildren(
          child.children ?? [],
          expectedLinks,
          consumedLinks,
        ),
      );
    } else {
      normalized.push(
        normalizeNode(child, expectedLinks, consumedLinks),
      );
    }
  }
  return mergeAdjacentText(normalized);
}

function applyPreparedLinks(
  markdown: string,
  links: readonly PreparedLink[],
): {
  readonly markdown: string;
  readonly expected: ReadonlyMap<string, ExpectedInjectedLink>;
} {
  let output = markdown;
  const descending = [...links].sort(
    (left, right) =>
      right.start - left.start ||
      right.end - left.end ||
      right.index - left.index,
  );
  for (const link of descending) {
    const selected = output.slice(link.start, link.end);
    output =
      `${output.slice(0, link.start)}[${selected}](<${link.href}>)` +
      output.slice(link.end);
  }

  const expected = new Map<string, ExpectedInjectedLink>();
  for (const link of links) {
    let precedingGrowth = 0;
    for (const other of links) {
      if (other.start < link.start) {
        precedingGrowth += other.href.length + 6;
      }
    }
    const start = link.start + precedingGrowth;
    const end =
      start + (link.end - link.start) + link.href.length + 6;
    const key = injectionKey(start, end);
    expected.set(key, {
      href: link.href,
      key,
      start,
      end,
    });
  }
  return { markdown: output, expected };
}

/**
 * Attaches source-backed ReaderLinks to one validated block without changing
 * its visible Markdown meaning. Semantic links belong to renderer navigation
 * and are intentionally rejected by this source application boundary.
 */
export function applyReaderLinksToMarkdown(
  block: ReaderBlock,
  links: readonly ReaderBlockMarkdownLink[],
): ValidationResult<string> {
  let input: {
    readonly block: ReaderBlock;
    readonly links: readonly ReaderBlockMarkdownLink[];
  };
  try {
    input = immutableSnapshot({ block, links });
  } catch {
    return invalidResult([
      diagnostic(
        "reader.markdown.input_uninspectable",
        "/",
        "ReaderLink Markdown application requires plain immutable data.",
        "plainData",
        {},
      ),
    ]);
  }

  if (
    !isPlainRecord(input.block) ||
    !Array.isArray(input.links)
  ) {
    return invalidResult([
      diagnostic(
        "reader.markdown.input_invalid",
        "/",
        "ReaderLink Markdown application requires one validated reader block and its source-backed links.",
        "validatedReaderData",
        {},
      ),
    ]);
  }
  if (
    typeof input.block.id !== "string" ||
    typeof input.block.markdown !== "string"
  ) {
    return invalidResult([
      diagnostic(
        "reader.markdown.input_invalid",
        "/block",
        "ReaderLink Markdown application requires one validated reader block.",
        "validatedReaderBlock",
        {},
      ),
    ]);
  }
  if (input.links.length === 0) {
    return validResult(input.block.markdown);
  }

  const diagnostics: Diagnostic[] = [];
  const prepared = prepareLinks(
    input.block,
    input.links,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return invalidResult(diagnostics);
  }

  const parsed = parseMarkdown(input.block.markdown);
  if (parsed === undefined) {
    return invalidResult([
      diagnostic(
        "reader.markdown.parse_failed",
        "/block/markdown",
        "The reader block Markdown could not be parsed with the pinned CommonMark parser.",
        "commonMark",
        {},
      ),
    ]);
  }
  const collected = collectNodeRecords(parsed);
  if (!collected.valid) {
    return invalidResult([
      diagnostic(
        "reader.markdown.parser_position_missing",
        "/block/markdown",
        "The pinned CommonMark parser omitted a source position required for safe link application.",
        "sourcePosition",
        { nodeType: collected.nodeType },
      ),
    ]);
  }

  const hasHtml = collected.records.some(
    (record) => record.node.type === "html",
  );
  for (const link of prepared) {
    validateRepresentableRange(
      link,
      collected.records,
      hasHtml,
      diagnostics,
    );
  }
  if (diagnostics.length > 0) {
    return invalidResult(diagnostics);
  }

  const applied = applyPreparedLinks(
    input.block.markdown,
    prepared,
  );
  const reparsed = parseMarkdown(applied.markdown);
  if (reparsed === undefined) {
    return invalidResult([
      diagnostic(
        "reader.markdown.output_unrepresentable",
        "/block/markdown",
        "The selected ranges cannot be represented as CommonMark links without changing the block.",
        "semanticEquivalence",
        { reason: "parseFailed" },
      ),
    ]);
  }
  const consumed = new Set<string>();
  const originalNormalized = normalizeNode(
    parsed,
    new Map(),
    new Set(),
  );
  const outputNormalized = normalizeNode(
    reparsed,
    applied.expected,
    consumed,
  );
  if (
    consumed.size !== applied.expected.size ||
    JSON.stringify(originalNormalized) !==
      JSON.stringify(outputNormalized)
  ) {
    return invalidResult([
      diagnostic(
        "reader.markdown.output_unrepresentable",
        "/block/markdown",
        "The selected ranges cannot be represented as CommonMark links without changing visible prose or formatting.",
        "semanticEquivalence",
        {
          appliedLinkCount: consumed.size,
          expectedLinkCount: applied.expected.size,
        },
      ),
    ]);
  }

  return validResult(applied.markdown);
}
