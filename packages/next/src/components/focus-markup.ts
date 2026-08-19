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

type FocusTier = "light" | "normal" | "strong";

interface HastText {
  readonly type: "text";
  readonly value: string;
}

interface HastParent {
  readonly type: string;
  readonly tagName?: string;
  children: HastNode[];
}

interface HastElement extends HastParent {
  readonly type: "element";
  readonly tagName: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

type HastNode = HastText | HastParent;

export interface PublisherFocusMarkupOptions {
  readonly narrationWords?: boolean;
}

const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'’·ˈ]*/gu;
const FOCUS_WORD_PATTERN = /^\p{L}[\p{L}'’]*$/u;
const EXCLUDED_ELEMENTS = new Set(["code", "pre", "strong"]);

function textNode(value: string): HastText {
  return { type: "text", value };
}

function elementNode(
  classNames: readonly string[],
  children: HastNode[],
  properties: Readonly<Record<string, unknown>> = {},
): HastElement {
  return {
    type: "element",
    tagName: "span",
    properties: { ...properties, className: [...classNames] },
    children,
  };
}

function focusSegments(word: string): HastNode[] {
  const codePoints = Array.from(word);
  const boundaries: readonly {
    readonly end: number;
    readonly tier: FocusTier;
  }[] = [
    { end: Math.ceil(codePoints.length * 0.15), tier: "light" },
    { end: Math.ceil(codePoints.length * 0.25), tier: "normal" },
    { end: Math.ceil(codePoints.length * 0.35), tier: "strong" },
  ];
  const segments: HastNode[] = [];
  let offset = 0;
  for (const boundary of boundaries) {
    if (boundary.end <= offset) continue;
    segments.push(elementNode([
      "publisher-focus-emphasis",
      `publisher-focus-emphasis-${boundary.tier}`,
    ], [textNode(codePoints.slice(offset, boundary.end).join(""))]));
    offset = boundary.end;
  }
  if (offset < codePoints.length) {
    segments.push(textNode(codePoints.slice(offset).join("")));
  }
  return segments;
}

function focusText(value: string, narrationWords: boolean): HastNode[] {
  const nodes: HastNode[] = [];
  let offset = 0;
  WORD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_PATTERN.exec(value)) !== null) {
    if (match.index > offset) nodes.push(textNode(value.slice(offset, match.index)));
    const word = match[0];
    const focusWord = FOCUS_WORD_PATTERN.test(word);
    nodes.push(
      focusWord || narrationWords
        ? elementNode(
            [
              ...(focusWord ? ["publisher-focus-word"] : []),
              ...(narrationWords ? ["publisher-narration-word"] : []),
            ],
            focusWord ? focusSegments(word) : [textNode(word)],
            narrationWords
              ? { dataPublisherNarrationWord: "true" }
              : {},
          )
        : textNode(word),
    );
    offset = match.index + word.length;
  }
  if (offset < value.length) nodes.push(textNode(value.slice(offset)));
  return nodes;
}

function isParent(node: HastNode): node is HastParent {
  return Array.isArray((node as Partial<HastParent>).children);
}

function isText(node: HastNode): node is HastText {
  return node.type === "text" && "value" in node;
}

function transform(
  parent: HastParent,
  eligible: boolean,
  narrationWords: boolean,
): void {
  const next: HastNode[] = [];
  for (const child of parent.children) {
    if (isText(child)) {
      next.push(...(
        eligible || narrationWords
          ? focusText(child.value, narrationWords)
          : [child]
      ));
      continue;
    }
    if (isParent(child)) {
      const childEligible = eligible && !(
        child.type === "element" &&
        typeof child.tagName === "string" &&
        EXCLUDED_ELEMENTS.has(child.tagName)
      );
      transform(child, childEligible, narrationWords);
    }
    next.push(child);
  }
  parent.children = next;
}

export function publisherFocusMarkupPlugin(
  options: PublisherFocusMarkupOptions = {},
): (tree: unknown) => void {
  return (tree: unknown): void => {
    if (
      tree === null ||
      typeof tree !== "object" ||
      !Array.isArray((tree as Partial<HastParent>).children)
    ) {
      return;
    }
    transform(tree as HastParent, true, options.narrationWords === true);
  };
}
