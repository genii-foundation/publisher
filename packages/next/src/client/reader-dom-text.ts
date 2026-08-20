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

export const PUBLISHER_READER_TRANSIENT_UI_ATTRIBUTE =
  "data-publisher-reader-transient-ui";

const TRANSIENT_READER_UI_SELECTOR =
  `[${PUBLISHER_READER_TRANSIENT_UI_ATTRIBUTE}='true']`;

function transientReaderUiAncestor(node: Node): Element | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return element?.closest(TRANSIENT_READER_UI_SELECTOR) ?? null;
}

export function createPublisherReaderTextWalker(root: Node): TreeWalker {
  const document = root.ownerDocument;
  if (document === null) {
    throw new TypeError("Reader text must belong to a document.");
  }
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return transientReaderUiAncestor(node) === null
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
}

export function publisherReaderTextContent(root: Node): string {
  const walker = createPublisherReaderTextWalker(root);
  const parts: string[] = [];
  let node = walker.nextNode();
  while (node !== null) {
    parts.push(node.textContent ?? "");
    node = walker.nextNode();
  }
  return parts.join("");
}

export function publisherReaderTextPointForOffset(
  root: Node,
  offset: number,
): { readonly node: Node; readonly offset: number } | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  const walker = createPublisherReaderTextWalker(root);
  let consumed = 0;
  let node = walker.nextNode();
  while (node !== null) {
    const length = node.textContent?.length ?? 0;
    if (consumed + length >= offset) {
      return Object.freeze({ node, offset: offset - consumed });
    }
    consumed += length;
    node = walker.nextNode();
  }
  return null;
}

export function publisherReaderTextOffset(
  root: Node,
  container: Node,
  offset: number,
): number | null {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    transientReaderUiAncestor(container) !== null
  ) return null;
  const document = root.ownerDocument;
  if (document === null) return null;
  try {
    const before = document.createRange();
    before.selectNodeContents(root);
    before.setEnd(container, offset);
    const fragment = before.cloneContents();
    for (const transient of fragment.querySelectorAll(
      TRANSIENT_READER_UI_SELECTOR,
    )) {
      transient.remove();
    }
    return fragment.textContent?.length ?? 0;
  } catch {
    return null;
  }
}

export function publisherReaderTextClientRects(range: Range): readonly DOMRect[] {
  if (range.startContainer === range.endContainer) {
    return Object.freeze(Array.from(range.getClientRects()));
  }
  const walker = createPublisherReaderTextWalker(range.commonAncestorContainer);
  const boxes: DOMRect[] = [];
  let collecting = false;
  let node = walker.nextNode();
  while (node !== null) {
    if (node === range.startContainer) collecting = true;
    if (collecting) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer
        ? range.endOffset
        : (node.textContent?.length ?? 0);
      if (end > start) {
        const textRange = node.ownerDocument?.createRange();
        if (textRange !== undefined) {
          textRange.setStart(node, start);
          textRange.setEnd(node, end);
          boxes.push(...Array.from(textRange.getClientRects()));
        }
      }
    }
    if (node === range.endContainer) break;
    node = walker.nextNode();
  }
  return Object.freeze(boxes);
}
