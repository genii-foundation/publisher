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

"use client";

import {
  queryReaderBookmarks,
  resolveReaderBookmark,
  type ReaderBookmark,
  type ReaderBookmarksState,
} from "@genii-foundation/publisher-reader/bookmarks";
import type { ReaderBlock, ReaderSection } from "@genii-foundation/publisher-schema/reader";
import { useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";

interface PublisherReaderBookmarkMarker {
  readonly bookmark: ReaderBookmark;
  readonly endBlockId: string;
  readonly height: number;
  readonly left: number;
  readonly startBlockId: string;
  readonly top: number;
}

export interface PublisherReaderBookmarkMarkersProps {
  readonly bookmarks: ReaderBookmarksState;
  readonly enabled: boolean;
  readonly onOpenBookmark: (bookmark: ReaderBookmark) => void;
  readonly portalTarget: HTMLElement | null;
  readonly section: ReaderSection;
  readonly workId: string;
}

function textPointForOffset(
  block: HTMLElement,
  offset: number,
): { readonly node: Node; readonly offset: number } | null {
  const walker = block.ownerDocument.createTreeWalker(
    block,
    NodeFilter.SHOW_TEXT,
  );
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

function canonicalBlockElements(
  root: HTMLElement,
  blocks: readonly ReaderBlock[],
): ReadonlyMap<string, HTMLElement> {
  const canonical = new Map(blocks.map((block) => [block.id, block]));
  const elements = new Map<string, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>("[data-publisher-block]")) {
    const id = element.dataset.publisherBlock;
    const block = id === undefined ? undefined : canonical.get(id);
    if (block === undefined || element.textContent !== block.text || elements.has(block.id)) {
      continue;
    }
    elements.set(block.id, element);
  }
  return elements;
}

function measureBookmarkMarker(
  bookmark: ReaderBookmark,
  blocks: readonly ReaderBlock[],
  elements: ReadonlyMap<string, HTMLElement>,
  sectionRoot: HTMLElement,
): PublisherReaderBookmarkMarker | null {
  const resolution = resolveReaderBookmark(bookmark, blocks);
  if (!("range" in resolution)) return null;
  const startElement = elements.get(resolution.range.start.blockId);
  const endElement = elements.get(resolution.range.end.blockId);
  if (startElement === undefined || endElement === undefined) return null;
  const start = textPointForOffset(startElement, resolution.range.start.offset);
  const end = textPointForOffset(endElement, resolution.range.end.offset);
  if (start === null || end === null) return null;
  try {
    const range = sectionRoot.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (range.collapsed) return null;
    const boxes = Array.from(range.getClientRects()).filter(
      (box) => box.width > 0 && box.height > 0,
    );
    if (boxes.length === 0) return null;
    const sectionBox = sectionRoot.getBoundingClientRect();
    const top = Math.min(...boxes.map((box) => box.top));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    return Object.freeze({
      bookmark,
      endBlockId: resolution.range.end.blockId,
      height: Math.max(44, bottom - top + 4),
      left: Math.max(2, sectionBox.left - 24) + window.scrollX,
      startBlockId: resolution.range.start.blockId,
      top: Math.max(0, top - 2) + window.scrollY,
    });
  } catch {
    return null;
  }
}

export function PublisherReaderBookmarkMarkers({
  bookmarks,
  enabled,
  onOpenBookmark,
  portalTarget,
  section,
  workId,
}: PublisherReaderBookmarkMarkersProps): ReactElement | null {
  const [markers, setMarkers] = useState<readonly PublisherReaderBookmarkMarker[]>([]);

  useEffect(() => {
    if (!enabled || typeof CSS.escape !== "function") {
      setMarkers([]);
      return;
    }
    const sectionRoot = document.querySelector<HTMLElement>(
      `[data-publisher-section="${CSS.escape(section.id)}"]`,
    );
    if (sectionRoot === null) {
      setMarkers([]);
      return;
    }
    let frame = 0;
    let disposed = false;
    const elements = canonicalBlockElements(sectionRoot, section.blocks);
    const measure = (): void => {
      if (disposed) return;
      const candidates = queryReaderBookmarks(bookmarks, {
        workId,
        sectionContinuityId: section.continuity.id,
      });
      const next = candidates.flatMap((bookmark) => {
        const marker = measureBookmarkMarker(
          bookmark,
          section.blocks,
          elements,
          sectionRoot,
        );
        return marker === null ? [] : [marker];
      });
      setMarkers(Object.freeze(next));
    };
    const requestMeasure = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", requestMeasure);
    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") measure();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const resizeObserver = new ResizeObserver(requestMeasure);
    resizeObserver.observe(sectionRoot);
    for (const element of elements.values()) resizeObserver.observe(element);
    const rootObserver = new MutationObserver(requestMeasure);
    rootObserver.observe(document.documentElement, {
      attributeFilter: [
        "data-publisher-reader-focus",
        "data-publisher-reader-scheme",
        "style",
      ],
    });
    let layoutShiftObserver: PerformanceObserver | null = null;
    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes.includes("layout-shift")
    ) {
      layoutShiftObserver = new PerformanceObserver(requestMeasure);
      layoutShiftObserver.observe({ type: "layout-shift", buffered: true });
    }
    const handleFontSettle = (): void => requestMeasure();
    document.fonts?.addEventListener("loadingdone", handleFontSettle);
    document.fonts?.addEventListener("loadingerror", handleFontSettle);
    void document.fonts?.ready.then(requestMeasure);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", requestMeasure);
      document.removeEventListener("visibilitychange", handleVisibility);
      resizeObserver.disconnect();
      rootObserver.disconnect();
      layoutShiftObserver?.disconnect();
      document.fonts?.removeEventListener("loadingdone", handleFontSettle);
      document.fonts?.removeEventListener("loadingerror", handleFontSettle);
    };
  }, [bookmarks, enabled, section, workId]);

  if (!enabled || markers.length === 0 || portalTarget === null) return null;
  return createPortal(
    <>
      {markers.map((marker) => (
        <button
          key={marker.bookmark.id}
          type="button"
          className="publisher-reader-bookmark-marker"
          aria-label={`Saved passage: ${marker.bookmark.quote.slice(0, 80)}`}
          data-publisher-bookmark-marker={marker.bookmark.id}
          data-publisher-start-block={marker.startBlockId}
          data-publisher-end-block={marker.endBlockId}
          onClick={() => onOpenBookmark(marker.bookmark)}
          style={{
            height: marker.height,
            left: marker.left,
            top: marker.top,
          }}
        >
          <span className="publisher-reader-bookmark-marker-line" aria-hidden="true" />
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 4h10v16l-5-3-5 3Z" />
          </svg>
        </button>
      ))}
    </>,
    portalTarget,
  );
}
