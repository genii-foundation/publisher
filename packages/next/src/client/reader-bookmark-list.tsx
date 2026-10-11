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

import type { ReaderBookmark } from "@genii-foundation/publisher-reader/bookmarks";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";

const BOOKMARK_ROW_HEIGHT_PX = 160;
const BOOKMARK_OVERSCAN_ROWS = 4;
const BOOKMARK_MAX_VIEWPORT_HEIGHT_PX = 384;

export interface PublisherReaderBookmarkListProps {
  readonly bookmarks: readonly ReaderBookmark[];
  readonly queryKey: string;
  readonly onRemove: (
    bookmark: ReaderBookmark,
    trigger: HTMLButtonElement,
  ) => void;
}

export function PublisherReaderBookmarkList({
  bookmarks,
  queryKey,
  onRemove,
}: PublisherReaderBookmarkListProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(
    BOOKMARK_MAX_VIEWPORT_HEIGHT_PX,
  );
  const totalHeight = bookmarks.length * BOOKMARK_ROW_HEIGHT_PX;
  const renderedViewportHeight = Math.min(
    totalHeight,
    BOOKMARK_MAX_VIEWPORT_HEIGHT_PX,
  );
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / BOOKMARK_ROW_HEIGHT_PX) - BOOKMARK_OVERSCAN_ROWS,
  );
  const endIndex = Math.min(
    bookmarks.length,
    Math.ceil((scrollTop + viewportHeight) / BOOKMARK_ROW_HEIGHT_PX) +
      BOOKMARK_OVERSCAN_ROWS,
  );
  const visibleBookmarks = useMemo(
    () => bookmarks.slice(startIndex, endIndex),
    [bookmarks, endIndex, startIndex],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const measure = (): void => setViewportHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    element.scrollTop = 0;
    setScrollTop(0);
  }, [queryKey]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const maximum = Math.max(0, totalHeight - element.clientHeight);
    if (element.scrollTop <= maximum) return;
    element.scrollTop = maximum;
    setScrollTop(maximum);
  }, [totalHeight]);

  return (
    <div
      ref={scrollRef}
      className="publisher-reader-bookmark-scroll"
      aria-label="Saved passages"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{ height: renderedViewportHeight }}
      tabIndex={0}
    >
      <ol
        className="publisher-reader-bookmarks publisher-reader-bookmark-virtual-list"
        style={{ height: totalHeight }}
      >
        {visibleBookmarks.map((bookmark, relativeIndex) => {
          const index = startIndex + relativeIndex;
          return (
            <li
              key={bookmark.id}
              aria-posinset={index + 1}
              aria-setsize={bookmarks.length}
              data-publisher-bookmark-index={index}
              style={{
                "--publisher-bookmark-row-top": `${index * BOOKMARK_ROW_HEIGHT_PX}px`,
              } as CSSProperties}
            >
              <a href={bookmark.href}><q>{bookmark.quote}</q></a>
              {bookmark.note === undefined ? null : <p>{bookmark.note}</p>}
              <button
                className="publisher-reader-secondary-action"
                aria-label={`Remove saved passage: ${bookmark.quote.slice(0, 80)}`}
                onClick={(event) => onRemove(bookmark, event.currentTarget)}
                type="button"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
