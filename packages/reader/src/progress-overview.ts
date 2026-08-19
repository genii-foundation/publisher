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
  listLiveReaderBookmarks,
  type ReaderBookmarksState,
} from "./bookmarks.js";
import {
  calculateReaderAggregateProgress,
  resolveReaderSectionProgress,
  type ReaderAggregateProgress,
  type ReaderProgressSection,
  type ReaderProgressState,
  type ReaderSectionProgressStatus,
} from "./progress.js";

export interface ReaderProgressOverviewSection extends ReaderProgressSection {
  readonly workId: string;
  readonly workTitle: string;
  readonly title: string;
  readonly href: string;
  readonly order: number;
}

export interface ReaderProgressOverviewItem {
  readonly workId: string;
  readonly workTitle: string;
  readonly sectionId: string;
  readonly continuityId: string;
  readonly title: string;
  readonly href: string;
  readonly order: number;
  readonly wordCount: number;
  readonly percent: number;
  readonly status: ReaderSectionProgressStatus;
  readonly bookmarked: boolean;
  readonly lastReadAt: number | null;
}

export interface ReaderProgressRecommendation {
  readonly sectionId: string;
  readonly title: string;
  readonly href: string;
  readonly reason: "continue" | "updated";
  readonly bookmarked: boolean;
}

export interface ReaderRecentlyReadSection {
  readonly sectionId: string;
  readonly title: string;
  readonly href: string;
  readonly readAt: number;
  readonly bookmarked: boolean;
}

export interface ReaderProgressOverview {
  readonly aggregate: ReaderAggregateProgress;
  readonly bookmarkedSectionCount: number;
  readonly sections: readonly ReaderProgressOverviewItem[];
  readonly recommendations: readonly ReaderProgressRecommendation[];
  readonly recentlyRead: readonly ReaderRecentlyReadSection[];
}

export interface ReaderProgressOverviewOptions {
  readonly recommendationLimit?: number;
  readonly recentlyReadLimit?: number;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 4;
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(100, value);
}

function compareSections(
  left: ReaderProgressOverviewSection,
  right: ReaderProgressOverviewSection,
): number {
  if (left.order !== right.order) return left.order - right.order;
  if (left.workId !== right.workId) return left.workId < right.workId ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function createReaderProgressOverview(
  progress: ReaderProgressState,
  bookmarks: ReaderBookmarksState,
  sections: readonly ReaderProgressOverviewSection[],
  options: ReaderProgressOverviewOptions = {},
): ReaderProgressOverview {
  if (progress.publicationId !== bookmarks.publicationId) {
    throw new TypeError("Reader progress and bookmarks must belong to one publication.");
  }
  const bookmarkContinuityIds = new Set(
    listLiveReaderBookmarks(bookmarks).map(
      (bookmark) => bookmark.sectionContinuityId,
    ),
  );
  const orderedSections = [...sections].sort(compareSections);
  const items = orderedSections.map((section) => {
    const resolved = resolveReaderSectionProgress(progress, section);
    const bookmarked = resolved.identity.aliases.some((identity) =>
      bookmarkContinuityIds.has(identity)
    );
    return Object.freeze({
      workId: section.workId,
      workTitle: section.workTitle,
      sectionId: section.id,
      continuityId: resolved.identity.continuityId,
      title: section.title,
      href: section.href,
      order: section.order,
      wordCount: section.wordCount,
      percent: resolved.progress?.percent ?? 0,
      status: resolved.status,
      bookmarked,
      lastReadAt: resolved.progress?.lastReadAt ?? null,
    });
  });
  const recommendationLimit = boundedLimit(options.recommendationLimit);
  const recentlyReadLimit = boundedLimit(options.recentlyReadLimit);
  const recommendations = [
    ...items.filter((item) => item.status === "updated"),
    ...items.filter((item) => item.status !== "read"),
  ];
  const recommendationIds = new Set<string>();
  const selectedRecommendations: ReaderProgressRecommendation[] = [];
  if (recommendationLimit > 0) {
    for (const item of recommendations) {
      if (recommendationIds.has(item.sectionId)) continue;
      recommendationIds.add(item.sectionId);
      selectedRecommendations.push(Object.freeze({
        sectionId: item.sectionId,
        title: item.title,
        href: item.href,
        reason: item.status === "updated" ? "updated" : "continue",
        bookmarked: item.bookmarked,
      }));
      if (selectedRecommendations.length >= recommendationLimit) break;
    }
  }
  const recentlyRead = items
    .flatMap((item) => item.lastReadAt === null ? [] : [Object.freeze({
      sectionId: item.sectionId,
      title: item.title,
      href: item.href,
      readAt: item.lastReadAt,
      bookmarked: item.bookmarked,
    })])
    .sort((left, right) =>
      right.readAt - left.readAt ||
      (left.sectionId < right.sectionId ? -1 : left.sectionId > right.sectionId ? 1 : 0)
    )
    .slice(0, recentlyReadLimit);
  return Object.freeze({
    aggregate: calculateReaderAggregateProgress(progress, orderedSections),
    bookmarkedSectionCount: items.filter((item) => item.bookmarked).length,
    sections: Object.freeze(items),
    recommendations: Object.freeze(selectedRecommendations),
    recentlyRead: Object.freeze(recentlyRead),
  });
}
