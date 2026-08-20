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

import type { ReaderBookmarkInput } from "@genii-foundation/publisher-reader/bookmarks";
import type { ReaderBlock, ReaderSection } from "@genii-foundation/publisher-schema/reader";
import {
  publisherReaderTextContent,
  publisherReaderTextOffset,
} from "./reader-dom-text.js";

export interface PublisherReaderSelection {
  readonly input: Omit<ReaderBookmarkInput, "id">;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

function owningElement(node: Node | null): Element | null {
  if (node === null) return null;
  return node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
}

function bookmarkHref(block: ReaderBlock, fallbackPath: string): string {
  if (block.readerAddress === null) return fallbackPath;
  return `${block.readerAddress.path}${
    block.readerAddress.anchor === undefined
      ? ""
      : `#${block.readerAddress.anchor}`
  }`;
}

export function readPublisherReaderSelection(
  selection: Selection | null,
  workId: string,
  section: ReaderSection,
  fallbackPath: string,
): PublisherReaderSelection | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const selector = `[data-publisher-section="${CSS.escape(section.id)}"]`;
  const prose = owningElement(range.startContainer)?.closest<HTMLElement>(selector) ?? null;
  if (
    prose === null ||
    owningElement(range.endContainer)?.closest(selector) !== prose
  ) {
    return null;
  }
  const startElement = owningElement(range.startContainer)?.closest<HTMLElement>(
    "[data-publisher-block]",
  ) ?? null;
  const endElement = owningElement(range.endContainer)?.closest<HTMLElement>(
    "[data-publisher-block]",
  ) ?? null;
  if (startElement === null || endElement === null) return null;
  const byId = new Map(section.blocks.map((block) => [block.id, block]));
  const blockElements = Array.from(
    prose.querySelectorAll<HTMLElement>("[data-publisher-block]"),
  ).filter((element) => {
    const id = element.dataset.publisherBlock;
    const block = id === undefined ? undefined : byId.get(id);
    return block !== undefined &&
      publisherReaderTextContent(element) === block.text;
  });
  const startIndex = blockElements.indexOf(startElement);
  const endIndex = blockElements.indexOf(endElement);
  if (startIndex < 0 || endIndex < startIndex) return null;
  const rawStart = publisherReaderTextOffset(
    startElement,
    range.startContainer,
    range.startOffset,
  );
  const rawEnd = publisherReaderTextOffset(
    endElement,
    range.endContainer,
    range.endOffset,
  );
  if (rawStart === null || rawEnd === null) return null;
  const selectedElements = blockElements.slice(startIndex, endIndex + 1);
  const parts = selectedElements.map((element, index) => {
    const text = publisherReaderTextContent(element);
    const start = index === 0 ? rawStart : 0;
    const end = index === selectedElements.length - 1 ? rawEnd : text.length;
    return text.slice(start, end);
  });
  const first = parts.findIndex((part) => /\S/u.test(part));
  if (first < 0) return null;
  let last = parts.length - 1;
  while (last >= first && !/\S/u.test(parts[last] ?? "")) last -= 1;
  const leading = (parts[first] ?? "").length - (parts[first] ?? "").trimStart().length;
  const trailing = (parts[last] ?? "").length - (parts[last] ?? "").trimEnd().length;
  const selectedStartElement = selectedElements[first];
  const selectedEndElement = selectedElements[last];
  if (selectedStartElement === undefined || selectedEndElement === undefined) return null;
  const startId = selectedStartElement.dataset.publisherBlock;
  const endId = selectedEndElement.dataset.publisherBlock;
  const startBlock = startId === undefined ? undefined : byId.get(startId);
  const endBlock = endId === undefined ? undefined : byId.get(endId);
  if (startBlock === undefined || endBlock === undefined) return null;
  const startOffset = (first === 0 ? rawStart : 0) + leading;
  const endOffset = (
    last === selectedElements.length - 1
      ? rawEnd
      : endBlock.text.length
  ) - trailing;
  const quoteParts = parts.slice(first, last + 1);
  quoteParts[0] = quoteParts[0]?.trimStart() ?? "";
  quoteParts[quoteParts.length - 1] =
    quoteParts[quoteParts.length - 1]?.trimEnd() ?? "";
  const quote = quoteParts.join("\n");
  if (quote.length < 1 || quote.length > 2_000) return null;
  const bounds = range.getBoundingClientRect();
  const unclampedTop = bounds.top + window.scrollY + bounds.height + 8;
  const unclampedLeft = bounds.left + window.scrollX + bounds.width / 2;
  return Object.freeze({
    input: Object.freeze({
      workId,
      sectionContinuityId: section.continuity.id,
      href: bookmarkHref(startBlock, fallbackPath),
      quote,
      prefix: startBlock.text
        .slice(Math.max(0, startOffset - 80), startOffset)
        .trimStart(),
      suffix: endBlock.text.slice(endOffset, endOffset + 80).trimEnd(),
      range: Object.freeze({
        start: Object.freeze({
          workId,
          sectionContinuityId: section.continuity.id,
          blockId: startBlock.id,
          blockContentHash: startBlock.contentHash,
          offset: startOffset,
        }),
        end: Object.freeze({
          workId,
          sectionContinuityId: section.continuity.id,
          blockId: endBlock.id,
          blockContentHash: endBlock.contentHash,
          offset: endOffset,
        }),
      }),
    }),
    top: Math.max(
      window.scrollY + 8,
      Math.min(window.scrollY + window.innerHeight - 56, unclampedTop),
    ),
    left: Math.max(
      window.scrollX + 72,
      Math.min(window.scrollX + window.innerWidth - 72, unclampedLeft),
    ),
    width: bounds.width,
    height: bounds.height,
  });
}
