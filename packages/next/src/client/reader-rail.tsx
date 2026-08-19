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
  READER_BOOKMARKS_SCHEMA_VERSION,
  addReaderBookmark,
  createEmptyReaderBookmarksState,
  createReaderBookmarksExportFileName,
  createReaderBookmarksStorageKey,
  createReaderBookmarksTextExport,
  listLiveReaderBookmarks,
  parseReaderBookmarksState,
  queryReaderBookmarks,
  removeReaderBookmark,
  serializeReaderBookmarksState,
  type ReaderBookmark,
  type ReaderBookmarksState,
} from "@genii-foundation/publisher-reader/bookmarks";
import {
  createDefaultReaderPreferences,
  createReaderPreferencesStorageKey,
  parseReaderPreferences,
  READER_COLOR_SCHEMES,
  READER_FOCUS_LEVELS,
  READER_FONT_SCALES,
  READER_MOTION_PREFERENCES,
  serializeReaderPreferences,
  updateReaderPreferences,
  type ReaderPreferences,
  type ReaderPreferencesUpdate,
} from "@genii-foundation/publisher-reader/preferences";
import {
  READER_PROGRESS_SCHEMA_VERSION,
  createEmptyReaderProgressState,
  createReaderProgressStorageKey,
  parseReaderProgressState,
  recordReaderSectionProgress,
  resolveReaderSectionProgress,
  serializeReaderProgressState,
  type ReaderProgressState,
} from "@genii-foundation/publisher-reader/progress";
import {
  acknowledgeReaderEngagementEvents,
  addReaderEngagementEvent,
  beginReaderSyncAttempt,
  completeReaderSyncAttempt,
  createEmptyReaderEngagementState,
  createReaderEngagementStorageKey,
  createReaderSyncConsent,
  createReaderSyncConsentStorageKey,
  createReaderSyncCoordinatorState,
  grantReaderSyncConsent,
  noteReaderSyncChange,
  parseReaderEngagementState,
  parseReaderSyncConsent,
  readerEngagementEventsForTransfer,
  reconcileReaderSyncState,
  revokeReaderSyncConsent,
  serializeReaderEngagementState,
  serializeReaderSyncConsent,
  setReaderSyncOnline,
  type ReaderEngagementState,
  type ReaderSyncConsent,
  type ReaderSyncCoordinatorState,
  type ReaderSyncRemoteDocument,
  type ReaderSyncRemoteState,
} from "@genii-foundation/publisher-reader/sync";
import {
  parseReaderSearchIndex,
  searchReaderIndex,
  type ReaderSearchIndex,
} from "@genii-foundation/publisher-reader/search";
import {
  createReaderProgressOverview,
} from "@genii-foundation/publisher-reader/progress-overview";
import type {
  ReaderSection,
  Sha256Digest,
} from "@genii-foundation/publisher-schema/reader";
import type { SyncEnvelope } from "@genii-foundation/publisher-schema";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { PublisherReaderBookmarkList } from "./reader-bookmark-list.js";
import { PublisherReaderBookmarkMarkers } from "./reader-bookmark-markers.js";
import { usePublisherReaderNarration } from "./reader-narration-provider.js";
import {
  createPublisherReaderStore,
  usePublisherReaderStore,
} from "./reader-store.js";
import {
  readPublisherReaderSelection,
  type PublisherReaderSelection,
} from "./reader-selection.js";

export interface PublisherReaderOutlineEntry {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly depth: number;
}

export interface PublisherReaderRailProps {
  readonly breadcrumbs: readonly PublisherReaderOutlineEntry[];
  readonly publicationId: string;
  readonly publicationTitle: string;
  readonly readerBuildId: Sha256Digest;
  readonly audioPath: string;
  readonly progressPath: string;
  readonly searchPath: string;
  readonly outline: readonly PublisherReaderOutlineEntry[];
  readonly currentSection?: ReaderSection;
  readonly currentWorkId?: string;
  readonly sync: SyncEnvelope | null;
}

type ReaderPanel = "outline" | "progress" | "search" | "bookmarks" | "settings" | "sync";
type ReaderSyncState = "idle" | "loading" | "signed-out" | "signed-in" | "unavailable";
type ReaderBookmarkDeletion =
  | { readonly kind: "all" }
  | { readonly kind: "one"; readonly id: string };

const SYNC_CONSENT_COPY_VERSION = "1.0";
const SYNC_PUMP_INTERVAL_MS = 200;
const READING_TIME_SAMPLE_INTERVAL_MS = 5_000;
const READING_TIME_IDLE_THRESHOLD_MS = 45_000;
const MAXIMUM_READING_TIME_SAMPLE_MS = 10_000;

const DEFAULT_FONT_POLICY = Object.freeze({
  defaultFontFamilyId: "serif",
  fontFamilyIds: Object.freeze(["serif"]),
});

function safeLocalRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private reading state remains useful in memory when storage is unavailable.
  }
}

function applyPreferences(preferences: ReaderPreferences): void {
  const root = document.documentElement;
  root.dataset.publisherReaderScheme = preferences.colorScheme;
  root.dataset.publisherReaderMotion = preferences.motion;
  root.dataset.publisherReaderFocus = preferences.focus;
  root.dataset.publisherReaderHighlights = preferences.highlights ? "on" : "off";
  root.style.setProperty(
    "--publisher-reader-font-scale",
    String(preferences.fontScale / 100),
  );
}

function RailIcon({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function panelLabel(panel: ReaderPanel): string {
  switch (panel) {
    case "outline": return "Contents";
    case "progress": return "Reading progress";
    case "search": return "Search";
    case "bookmarks": return "Bookmarks";
    case "settings": return "Reading settings";
    case "sync": return "Sync and account";
  }
}

function progressStatusLabel(status: ReturnType<typeof resolveReaderSectionProgress>["status"]): string {
  switch (status) {
    case "unread": return "Not started";
    case "partial": return "In progress";
    case "read": return "Read";
    case "updated": return "Updated since you read it";
  }
}

function formatReadingTime(readingTimeMs: number): string {
  const minutes = Math.floor(readingTimeMs / 60_000);
  if (minutes < 1) return "Less than a minute";
  return `${new Intl.NumberFormat().format(minutes)} minute${minutes === 1 ? "" : "s"}`;
}

interface ReaderSyncReadResponse extends ReaderSyncRemoteState {
  readonly consent: unknown;
}

interface ReaderSyncTransferResponse {
  readonly state: ReaderSyncReadResponse;
  readonly uploadedEventIds: readonly string[];
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRemoteDocument(value: unknown): ReaderSyncRemoteDocument | null {
  if (value === null) return null;
  if (
    !isPlainRecord(value) ||
    !Number.isSafeInteger(value.schemaVersion) ||
    (value.schemaVersion as number) < 1
  ) {
    throw new TypeError("The synchronization response contains an invalid document.");
  }
  return Object.freeze({
    value: value.value,
    schemaVersion: value.schemaVersion as number,
  });
}

function parseSyncReadResponse(value: unknown): ReaderSyncReadResponse {
  if (!isPlainRecord(value)) {
    throw new TypeError("The synchronization response is invalid.");
  }
  return Object.freeze({
    progress: parseRemoteDocument(value.progress),
    bookmarks: parseRemoteDocument(value.bookmarks),
    consent: value.consent,
  });
}

function parseSyncTransferResponse(value: unknown): ReaderSyncTransferResponse {
  if (
    !isPlainRecord(value) ||
    !Array.isArray(value.uploadedEventIds) ||
    value.uploadedEventIds.length > 256
  ) {
    throw new TypeError("The synchronization transfer response is invalid.");
  }
  const uploadedEventIds = value.uploadedEventIds;
  if (uploadedEventIds.some((candidate) =>
    typeof candidate !== "string" ||
    candidate.length < 1 ||
    candidate.length > 128)) {
    throw new TypeError("The synchronization acknowledgements are invalid.");
  }
  return Object.freeze({
    state: parseSyncReadResponse(value.state),
    uploadedEventIds: Object.freeze([...uploadedEventIds]) as readonly string[],
  });
}

function createClientEventId(now: number): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const entropy = new Uint32Array(4);
  crypto.getRandomValues(entropy);
  return `event-${now.toString(36)}-${[...entropy]
    .map((value) => value.toString(36))
    .join("-")}`;
}

export function PublisherReaderRail({
  breadcrumbs,
  publicationId,
  publicationTitle,
  readerBuildId,
  searchPath,
  outline,
  currentSection,
  currentWorkId,
  sync,
}: PublisherReaderRailProps): ReactElement {
  const panelId = useId();
  const narration = usePublisherReaderNarration();
  const { progressCatalog, progressCatalogState } = narration;
  const syncEmailRef = useRef<HTMLInputElement>(null);
  const consentContinueRef = useRef<HTMLButtonElement>(null);
  const bookmarkQueryRef = useRef<HTMLInputElement>(null);
  const bookmarkDeleteConfirmRef = useRef<HTMLButtonElement>(null);
  const bookmarkDeleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectionNoteRef = useRef<HTMLTextAreaElement>(null);
  const preferencesKey = useMemo(
    () => createReaderPreferencesStorageKey(publicationId),
    [publicationId],
  );
  const progressKey = useMemo(
    () => createReaderProgressStorageKey(publicationId),
    [publicationId],
  );
  const bookmarksKey = useMemo(
    () => createReaderBookmarksStorageKey(publicationId),
    [publicationId],
  );
  const consentKey = useMemo(
    () => createReaderSyncConsentStorageKey(publicationId),
    [publicationId],
  );
  const engagementKey = useMemo(
    () => createReaderEngagementStorageKey(publicationId),
    [publicationId],
  );
  const progressStore = useMemo(() => createPublisherReaderStore({
    storageKey: progressKey,
    parse: (serialized: string | null) => parseReaderProgressState(serialized, {
      publicationId,
      now: Date.now(),
      ...(currentSection === undefined ? {} : { sections: [currentSection] }),
    }),
    serialize: (value: ReaderProgressState) => serializeReaderProgressState(
      value,
      {
        publicationId,
        now: Date.now(),
        ...(currentSection === undefined ? {} : { sections: [currentSection] }),
      },
    ),
    empty: () => createEmptyReaderProgressState(publicationId),
  }), [currentSection, progressKey, publicationId]);
  const bookmarksStore = useMemo(() => createPublisherReaderStore({
    storageKey: bookmarksKey,
    parse: (serialized: string | null) => parseReaderBookmarksState(
      serialized,
      { publicationId, now: Date.now() },
    ),
    serialize: (value: ReaderBookmarksState) => serializeReaderBookmarksState(
      value,
      { publicationId, now: Date.now() },
    ),
    empty: () => createEmptyReaderBookmarksState(publicationId),
  }), [bookmarksKey, publicationId]);
  const progress = usePublisherReaderStore(progressStore);
  const bookmarkState = usePublisherReaderStore(bookmarksStore);
  const [openPanel, setOpenPanel] = useState<ReaderPanel | null>(null);
  const [preferences, setPreferences] = useState<ReaderPreferences>(() =>
    createDefaultReaderPreferences(DEFAULT_FONT_POLICY));
  const [query, setQuery] = useState("");
  const [bookmarkQuery, setBookmarkQuery] = useState("");
  const [bookmarkDeletePending, setBookmarkDeletePending] = useState<ReaderBookmarkDeletion | null>(null);
  const [readerSelection, setReaderSelection] = useState<PublisherReaderSelection | null>(null);
  const [selectionEditing, setSelectionEditing] = useState(false);
  const [selectionNote, setSelectionNote] = useState("");
  const [selectionMessage, setSelectionMessage] = useState("");
  const [searchIndex, setSearchIndex] = useState<ReaderSearchIndex | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [syncState, setSyncState] = useState<ReaderSyncState>("idle");
  const [syncEmail, setSyncEmail] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [syncCode, setSyncCode] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [consentPending, setConsentPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const progressRef = useRef<ReaderProgressState>(progress);
  const bookmarksRef = useRef<ReaderBookmarksState>(bookmarkState);
  const consentRef = useRef<ReaderSyncConsent>(
    createReaderSyncConsent(publicationId, SYNC_CONSENT_COPY_VERSION),
  );
  const engagementRef = useRef<ReaderEngagementState>(
    createEmptyReaderEngagementState(publicationId),
  );
  const coordinatorRef = useRef<ReaderSyncCoordinatorState>(
    createReaderSyncCoordinatorState(publicationId),
  );
  const syncExecutingRef = useRef(false);
  const syncAbortRef = useRef<AbortController | null>(null);
  const signedInRef = useRef(false);
  const noteSyncChangeRef = useRef<(now: number) => void>(() => undefined);
  const recordedSectionRef = useRef<string | null>(null);
  const openedProgressSectionRef = useRef<string | null>(null);
  const canSyncProgress = sync?.capabilities.includes("progress") === true;
  const canSyncBookmarks = sync?.capabilities.includes("bookmarks") === true;
  const canSyncEngagement = sync?.capabilities.includes("engagement") === true;
  const allBookmarks = useMemo(
    () => listLiveReaderBookmarks(bookmarkState),
    [bookmarkState],
  );
  const bookmarks = useMemo(() => {
    const text = bookmarkQuery.trim();
    return text.length === 0
      ? allBookmarks
      : queryReaderBookmarks(bookmarkState, { text });
  }, [allBookmarks, bookmarkQuery, bookmarkState]);

  progressRef.current = progress;
  bookmarksRef.current = bookmarkState;
  noteSyncChangeRef.current = (now: number): void => {
    if (!signedInRef.current || !consentRef.current.granted) return;
    coordinatorRef.current = noteReaderSyncChange(coordinatorRef.current, now);
  };

  useEffect(() => {
    const unsubscribeProgress = progressStore.subscribeChanges((source) => {
      progressRef.current = progressStore.getSnapshot();
      if (source !== "remote") noteSyncChangeRef.current(Date.now());
    });
    const unsubscribeBookmarks = bookmarksStore.subscribeChanges((source) => {
      bookmarksRef.current = bookmarksStore.getSnapshot();
      if (source !== "remote") noteSyncChangeRef.current(Date.now());
    });
    return () => {
      unsubscribeProgress();
      unsubscribeBookmarks();
    };
  }, [bookmarksStore, progressStore]);

  useEffect(() => {
    signedInRef.current = false;
    syncAbortRef.current?.abort();
    coordinatorRef.current = createReaderSyncCoordinatorState(
      publicationId,
      navigator.onLine,
    );
    recordedSectionRef.current = null;
    openedProgressSectionRef.current = null;
    setSyncState("idle");
  }, [publicationId]);

  useEffect(() => {
    const loaded = parseReaderPreferences(
      safeLocalRead(preferencesKey),
      DEFAULT_FONT_POLICY,
    );
    setPreferences(loaded);
    applyPreferences(loaded);
    const now = Date.now();
    consentRef.current = parseReaderSyncConsent(
      safeLocalRead(consentKey),
      publicationId,
      SYNC_CONSENT_COPY_VERSION,
    );
    let engagement = parseReaderEngagementState(
      safeLocalRead(engagementKey),
      publicationId,
    );
    if (
      currentSection !== undefined &&
      recordedSectionRef.current !== currentSection.id
    ) {
      engagement = addReaderEngagementEvent(engagement, {
        clientEventId: createClientEventId(now),
        eventType: "section_opened",
        eventAt: now,
        sectionId: currentSection.id,
        contentHash: currentSection.contentHash,
        route: `${window.location.pathname}${window.location.search}`.slice(0, 512),
      });
      recordedSectionRef.current = currentSection.id;
      safeLocalWrite(
        engagementKey,
        serializeReaderEngagementState(engagement),
      );
    }
    engagementRef.current = engagement;
  }, [
    consentKey,
    currentSection,
    engagementKey,
    preferencesKey,
    publicationId,
  ]);

  useEffect(() => {
    const updateOnlineState = (): void => {
      coordinatorRef.current = setReaderSyncOnline(
        coordinatorRef.current,
        navigator.onLine,
        Date.now(),
      );
    };
    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, [publicationId]);

  useEffect(() => {
    if (sync === null) return;
    let active = true;

    const applyRemoteState = (
      remote: ReaderSyncRemoteState,
      now: number,
    ) => {
      const reconciled = reconcileReaderSyncState(
        progressRef.current,
        bookmarksRef.current,
        remote,
        { publicationId, now },
      );
      progressRef.current = reconciled.progress;
      bookmarksRef.current = reconciled.bookmarks;
      progressStore.write(reconciled.progress, "remote");
      bookmarksStore.write(reconciled.bookmarks, "remote");
      return reconciled;
    };
    const finishAttempt = (
      revision: number,
      succeeded: boolean,
      now: number,
    ): void => {
      if (coordinatorRef.current.inFlightRevision !== revision) return;
      coordinatorRef.current = completeReaderSyncAttempt(
        coordinatorRef.current,
        revision,
        succeeded,
        now,
      );
    };
    const pump = async (): Promise<void> => {
      if (
        !active ||
        syncExecutingRef.current ||
        !signedInRef.current ||
        !consentRef.current.granted
      ) return;
      const attempt = beginReaderSyncAttempt(coordinatorRef.current, Date.now());
      if (attempt === null) return;
      coordinatorRef.current = attempt.state;
      syncExecutingRef.current = true;
      const abort = new AbortController();
      syncAbortRef.current = abort;
      try {
        const readResponse = await fetch("/api/sync", {
          credentials: "same-origin",
          signal: abort.signal,
        });
        if (!readResponse.ok) throw new Error("Synchronization read failed.");
        const readState = parseSyncReadResponse(await readResponse.json());
        const first = applyRemoteState(readState, Date.now());
        const consent = consentRef.current;
        const events = canSyncEngagement
          ? readerEngagementEventsForTransfer(engagementRef.current)
          : [];
        const transfer: Record<string, unknown> = {
          consent: {
            version: consent.schemaVersion,
            copyVersion: consent.copyVersion,
            granted: consent.granted,
            grantedAt: consent.grantedAt,
            revokedAt: consent.revokedAt,
          },
          ...(canSyncProgress && first.transferProgress !== null ? {
            progress: {
              value: first.transferProgress,
              schemaVersion: READER_PROGRESS_SCHEMA_VERSION,
            },
          } : {}),
          ...(canSyncBookmarks && first.transferBookmarks !== null ? {
            bookmarks: {
              value: first.transferBookmarks,
              schemaVersion: READER_BOOKMARKS_SCHEMA_VERSION,
            },
          } : {}),
          ...(events.length === 0 ? {} : { events }),
        };
        const transferResponse = await fetch("/api/sync", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(transfer),
          signal: abort.signal,
        });
        if (!transferResponse.ok) throw new Error("Synchronization transfer failed.");
        const transferred = parseSyncTransferResponse(await transferResponse.json());
        const second = applyRemoteState(transferred.state, Date.now());
        const sentEventIds = new Set(events.map((event) => event.clientEventId));
        const acknowledgedEventIds = transferred.uploadedEventIds.filter((id) =>
          sentEventIds.has(id));
        if (canSyncEngagement && acknowledgedEventIds.length > 0) {
          const acknowledged = acknowledgeReaderEngagementEvents(
            engagementRef.current,
            acknowledgedEventIds,
            Date.now(),
          );
          engagementRef.current = acknowledged;
          safeLocalWrite(
            engagementKey,
            serializeReaderEngagementState(acknowledged),
          );
        }
        finishAttempt(attempt.revision, true, Date.now());
        if (
          (canSyncProgress && second.transferProgress !== null) ||
          (canSyncBookmarks && second.transferBookmarks !== null) ||
          (canSyncEngagement &&
            readerEngagementEventsForTransfer(engagementRef.current).length > 0)
        ) {
          noteSyncChangeRef.current(Date.now());
        }
        if (active && signedInRef.current) {
          setSyncMessage(
            first.progressStatus === "schema-ahead" ||
            first.bookmarksStatus === "schema-ahead" ||
            second.progressStatus === "schema-ahead" ||
            second.bookmarksStatus === "schema-ahead"
              ? "Newer synchronized data was left untouched. Local reading remains available."
              : "Reading data synced.",
          );
        }
      } catch (error) {
        finishAttempt(attempt.revision, false, Date.now());
        if (
          active &&
          signedInRef.current &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setSyncMessage("Sync paused. Local reading is safe and will retry.");
        }
      } finally {
        if (syncAbortRef.current === abort) syncAbortRef.current = null;
        syncExecutingRef.current = false;
      }
    };

    const timer = window.setInterval(() => void pump(), SYNC_PUMP_INTERVAL_MS);
    void pump();
    return () => {
      active = false;
      window.clearInterval(timer);
      syncAbortRef.current?.abort();
    };
  }, [
    bookmarksStore,
    canSyncBookmarks,
    canSyncEngagement,
    canSyncProgress,
    engagementKey,
    progressStore,
    publicationId,
    sync,
  ]);

  useEffect(() => {
    if (currentSection === undefined) return;
    const openingIdentity = `${currentSection.id}:${currentSection.contentHash}`;
    if (openedProgressSectionRef.current === openingIdentity) return;
    openedProgressSectionRef.current = openingIdentity;
    const now = Date.now();
    progressStore.update((current) => {
      try {
        return recordReaderSectionProgress(current, currentSection, {
          now,
          opened: true,
          navigationSource: "direct",
        });
      } catch {
        return current;
      }
    });
  }, [currentSection, progressStore]);

  useEffect(() => {
    if (currentSection === undefined) return;
    let lastSampleAt = Date.now();
    let lastActivityAt = lastSampleAt;
    let wasVisible = document.visibilityState === "visible";
    let uncommittedActiveMs = 0;

    const sample = (now: number): void => {
      if (wasVisible && now >= lastSampleAt) {
        const activeUntil = Math.min(
          now,
          lastActivityAt + READING_TIME_IDLE_THRESHOLD_MS,
        );
        const activeMs = Math.max(0, activeUntil - lastSampleAt);
        uncommittedActiveMs += Math.min(
          activeMs,
          MAXIMUM_READING_TIME_SAMPLE_MS,
        );
      }
      lastSampleAt = now;
      wasVisible = document.visibilityState === "visible";
    };
    const commit = (now: number): void => {
      const activeMs = Math.floor(uncommittedActiveMs);
      if (activeMs < 1) return;
      uncommittedActiveMs -= activeMs;
      progressStore.update((current) => {
        const existing = resolveReaderSectionProgress(
          current,
          currentSection,
        ).progress;
        try {
          return recordReaderSectionProgress(current, currentSection, {
            now,
            readingTimeMs: (existing?.readingTimeMs ?? 0) + activeMs,
          });
        } catch {
          return current;
        }
      });
    };
    const sampleAndCommit = (): void => {
      const now = Date.now();
      sample(now);
      commit(now);
    };
    const markActivity = (): void => {
      const now = Date.now();
      sample(now);
      lastActivityAt = now;
    };
    const noteVisibility = (): void => {
      const now = Date.now();
      sample(now);
      if (document.visibilityState === "visible") lastActivityAt = now;
      commit(now);
    };

    window.addEventListener("scroll", markActivity, { passive: true });
    window.addEventListener("pointerdown", markActivity, { passive: true });
    window.addEventListener("keydown", markActivity);
    window.addEventListener("focus", markActivity);
    document.addEventListener("visibilitychange", noteVisibility);
    const interval = window.setInterval(
      sampleAndCommit,
      READING_TIME_SAMPLE_INTERVAL_MS,
    );
    return () => {
      sampleAndCommit();
      window.clearInterval(interval);
      window.removeEventListener("scroll", markActivity);
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("focus", markActivity);
      document.removeEventListener("visibilitychange", noteVisibility);
    };
  }, [currentSection, progressStore]);

  useEffect(() => {
    if (currentSection === undefined) return;
    let frame = 0;
    const record = (): void => {
      frame = 0;
      const manuscript = document.querySelector<HTMLElement>(
        `[data-publisher-section="${CSS.escape(currentSection.id)}"]`,
      );
      if (manuscript === null) return;
      const bounds = manuscript.getBoundingClientRect();
      const viewport = window.innerHeight;
      const traversed = Math.max(0, Math.min(bounds.height, viewport - bounds.top));
      const percent = bounds.height <= 0 ? 0 : Math.round(100 * traversed / bounds.height);
      const now = Date.now();
      progressStore.update((current) => {
        let next: ReaderProgressState;
        try {
          next = recordReaderSectionProgress(current, currentSection, {
            now,
            percent,
            scrollPercent: percent,
            ...(percent >= 95 ? { read: "automatic" as const } : {}),
          });
        } catch {
          return current;
        }
        const context = {
          publicationId,
          now,
          sections: [currentSection],
        };
        const serialized = serializeReaderProgressState(next, context);
        if (serialized === serializeReaderProgressState(current, context)) {
          return current;
        }
        progressRef.current = next;
        return next;
      });
    };
    const schedule = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(record);
    };
    record();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [currentSection, progressStore, publicationId]);

  useEffect(() => {
    narration.setCurrentSectionId(currentSection?.id);
  }, [currentSection?.id, narration.setCurrentSectionId]);

  useEffect(() => {
    if (openPanel === "progress") narration.ensureProgressCatalog();
  }, [narration.ensureProgressCatalog, openPanel]);

  useEffect(() => {
    if (openPanel !== "search" || searchState !== "idle") return;
    setSearchState("loading");
    void fetch(searchPath, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("Search artifact request failed.");
        return response.text();
      })
      .then((serialized) => {
        const parsed = parseReaderSearchIndex(serialized, {
          publicationId,
          readerBuildId,
        });
        if (parsed === null) throw new Error("Search artifact identity mismatch.");
        setSearchIndex(parsed);
        setSearchState("ready");
      })
      .catch(() => {
        setSearchState("failed");
      });
  }, [openPanel, publicationId, readerBuildId, searchPath]);

  useEffect(() => {
    if (
      sync === null ||
      syncState !== "idle" ||
      (openPanel !== "sync" && !consentRef.current.granted)
    ) return;
    setSyncState("loading");
    void fetch("/api/session", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session request failed.");
        return response.json() as Promise<{ authenticated?: unknown; email?: unknown }>;
      })
      .then((session) => {
        if (session.authenticated === true) {
          signedInRef.current = true;
          setSyncEmail(typeof session.email === "string" ? session.email : "");
          setSyncState("signed-in");
          noteSyncChangeRef.current(Date.now());
        } else if (session.authenticated === false) {
          signedInRef.current = false;
          setSyncState("signed-out");
        } else {
          signedInRef.current = false;
          setSyncState("unavailable");
        }
      })
      .catch(() => {
        signedInRef.current = false;
        setSyncState("unavailable");
      });
  }, [openPanel, sync, syncState]);

  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (bookmarkDeletePending !== null) {
        setBookmarkDeletePending(null);
        bookmarkDeleteTriggerRef.current?.focus();
      } else if (consentPending) {
        setConsentPending(false);
        syncEmailRef.current?.focus();
      } else {
        setOpenPanel(null);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [bookmarkDeletePending, consentPending]);

  useEffect(() => {
    if (consentPending) consentContinueRef.current?.focus();
  }, [consentPending]);

  useEffect(() => {
    if (bookmarkDeletePending !== null) {
      bookmarkDeleteConfirmRef.current?.focus();
    }
  }, [bookmarkDeletePending]);

  useEffect(() => {
    if (currentSection === undefined || currentWorkId === undefined) {
      setReaderSelection(null);
      return;
    }
    let timer = 0;
    let pointerDown = false;
    const clearTimer = (): void => {
      if (timer !== 0) window.clearTimeout(timer);
      timer = 0;
    };
    const actionHasFocus = (): boolean =>
      document.activeElement instanceof Element &&
      document.activeElement.closest(".publisher-reader-selection-action") !== null;
    const read = (): void => {
      clearTimer();
      if (pointerDown || actionHasFocus()) return;
      const captured = readPublisherReaderSelection(
        window.getSelection(),
        currentWorkId,
        currentSection,
        window.location.pathname,
      );
      if (captured !== null) setSelectionMessage("");
      setSelectionEditing(false);
      setSelectionNote("");
      setReaderSelection(captured);
    };
    const schedule = (delay: number): void => {
      clearTimer();
      timer = window.setTimeout(read, delay);
    };
    const insideAction = (event: Event): boolean =>
      event.target instanceof Element &&
      event.target.closest(".publisher-reader-selection-action") !== null;
    const onPointerDown = (event: Event): void => {
      if (insideAction(event)) return;
      pointerDown = true;
      setReaderSelection(null);
    };
    const onPointerUp = (event: Event): void => {
      if (insideAction(event)) return;
      pointerDown = false;
      schedule(0);
    };
    const onSelectionChange = (): void => {
      if (actionHasFocus()) return;
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed) {
        clearTimer();
        setReaderSelection(null);
      } else {
        schedule(200);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setReaderSelection(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keyup", read);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown);
    schedule(0);
    return () => {
      clearTimer();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keyup", read);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [currentSection, currentWorkId]);

  useEffect(() => {
    if (selectionEditing) selectionNoteRef.current?.focus();
  }, [selectionEditing]);

  useEffect(() => {
    if (openPanel === "bookmarks") bookmarkQueryRef.current?.focus();
  }, [bookmarkQuery, openPanel]);

  const currentProgress = currentSection === undefined
    ? null
    : resolveReaderSectionProgress(progress, currentSection);
  const progressOverview = useMemo(
    () => progressCatalog === null
      ? null
      : createReaderProgressOverview(
          progress,
          bookmarkState,
          progressCatalog.entries,
        ),
    [bookmarkState, progress, progressCatalog],
  );
  const normalizedQuery = query.trim();
  const results = searchIndex === null || normalizedQuery.length < 2
    ? []
    : searchReaderIndex(searchIndex, query, { limit: 12, snippetCodeUnits: 180 });
  const bookmarkSearchResults = normalizedQuery.length < 2 || normalizedQuery.length > 280
    ? []
    : queryReaderBookmarks(bookmarkState, { text: normalizedQuery }).slice(0, 12);

  const updatePreference = (update: ReaderPreferencesUpdate): void => {
    const next = updateReaderPreferences(preferences, update, DEFAULT_FONT_POLICY);
    setPreferences(next);
    applyPreferences(next);
    safeLocalWrite(
      preferencesKey,
      serializeReaderPreferences(next, DEFAULT_FONT_POLICY),
    );
  };

  const markCurrentSectionRead = (): void => {
    if (currentSection === undefined) return;
    const now = Date.now();
    progressStore.update((current) => {
      try {
        return recordReaderSectionProgress(current, currentSection, {
          now,
          percent: 100,
          read: "manual",
        });
      } catch {
        return current;
      }
    });
  };

  const downloadBookmarks = (): void => {
    if (allBookmarks.length === 0) return;
    const now = Date.now();
    const exported = createReaderBookmarksTextExport(
      bookmarkState,
      { publicationId, now },
      { publicationTitle, origin: window.location.origin },
    );
    const url = URL.createObjectURL(new Blob([exported], {
      type: "text/plain;charset=utf-8",
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = createReaderBookmarksExportFileName(publicationId);
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const saveReaderSelection = (): void => {
    const captured = readerSelection;
    if (captured === null || currentSection === undefined) return;
    const now = Date.now();
    let saved = false;
    bookmarksStore.update((current) => {
      try {
        const note = selectionNote.trim();
        const next = addReaderBookmark(
          current,
          {
            id: createClientEventId(now),
            ...captured.input,
            ...(note.length === 0 ? {} : { note }),
          },
          { publicationId, now },
        );
        saved = next !== current;
        return next;
      } catch {
        return current;
      }
    });
    if (!saved) {
      setSelectionMessage("This passage could not be saved. Remove an older bookmark and try again.");
      return;
    }
    const event = addReaderEngagementEvent(engagementRef.current, {
      clientEventId: createClientEventId(now + 1),
      eventType: "bookmark_added",
      eventAt: now,
      sectionId: currentSection.id,
      contentHash: currentSection.contentHash,
      route: `${window.location.pathname}${window.location.search}`.slice(0, 512),
      payload: {
        startBlockId: captured.input.range.start.blockId,
        startOffset: captured.input.range.start.offset,
        endBlockId: captured.input.range.end.blockId,
        endOffset: captured.input.range.end.offset,
      },
    });
    engagementRef.current = event;
    safeLocalWrite(engagementKey, serializeReaderEngagementState(event));
    setReaderSelection(null);
    setSelectionEditing(false);
    setSelectionNote("");
    setSelectionMessage("Saved passage.");
    window.getSelection()?.removeAllRanges();
  };

  const cancelBookmarkDeletion = (): void => {
    setBookmarkDeletePending(null);
    bookmarkDeleteTriggerRef.current?.focus();
  };

  const confirmBookmarkDeletion = (): void => {
    const pending = bookmarkDeletePending;
    if (pending === null) return;
    const now = Date.now();
    bookmarksStore.update((current) => {
      if (pending.kind === "one") {
        return removeReaderBookmark(current, pending.id, { publicationId, now });
      }
      return allBookmarks.reduce(
        (next, bookmark) => removeReaderBookmark(
          next,
          bookmark.id,
          { publicationId, now },
        ),
        current,
      );
    });
    setBookmarkDeletePending(null);
    bookmarkQueryRef.current?.focus();
  };

  const toggle = (panel: ReaderPanel): void => {
    narration.close();
    setOpenPanel((current) => current === panel ? null : panel);
  };

  const toggleNarration = (): void => {
    setOpenPanel(null);
    if (narration.active) narration.close();
    else narration.open();
  };

  const beginAuthentication = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const email = syncEmail.trim();
    if (email.length === 0) return;
    setSyncMessage("");
    setConsentPending(true);
  };

  const confirmAuthentication = async (): Promise<void> => {
    const email = syncEmail.trim();
    if (email.length === 0 || syncBusy) return;
    setSyncBusy(true);
    setSyncMessage("");
    const consent = grantReaderSyncConsent(consentRef.current, Date.now());
    consentRef.current = consent;
    safeLocalWrite(consentKey, serializeReaderSyncConsent(consent));
    try {
      const response = await fetch("/api/auth/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          next: `${window.location.pathname}${window.location.search}`,
        }),
      });
      if (!response.ok) throw new Error("Authentication could not start.");
      setPendingEmail(email);
      setSyncCode("");
      setConsentPending(false);
      setSyncMessage("Check your email for a link or one-time code.");
    } catch {
      setSyncMessage("Sign in could not start. Try again.");
    } finally {
      setSyncBusy(false);
    }
  };

  const verifyAuthentication = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const code = syncCode.replace(/\s+/gu, "");
    if (pendingEmail.length === 0 || code.length === 0 || syncBusy) return;
    setSyncBusy(true);
    setSyncMessage("");
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: pendingEmail, code }),
      });
      if (!response.ok) throw new Error("Authentication failed.");
      const session = await response.json() as { authenticated?: unknown; email?: unknown };
      if (session.authenticated !== true) throw new Error("Authentication failed.");
      setSyncEmail(typeof session.email === "string" ? session.email : pendingEmail);
      setPendingEmail("");
      setSyncCode("");
      signedInRef.current = true;
      setSyncState("signed-in");
      setSyncMessage("Signed in. Local reading remains available if sync is interrupted.");
      noteSyncChangeRef.current(Date.now());
    } catch {
      setSyncMessage("Code sign in failed. Request a fresh email and try again.");
    } finally {
      setSyncBusy(false);
    }
  };

  const signOut = async (): Promise<void> => {
    if (syncBusy) return;
    signedInRef.current = false;
    syncAbortRef.current?.abort();
    setSyncBusy(true);
    setSyncMessage("");
    try {
      const response = await fetch("/api/session", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Sign out failed.");
      setSyncState("signed-out");
      setSyncMessage("Signed out. Local progress and bookmarks are still saved.");
    } catch {
      signedInRef.current = true;
      setSyncMessage("Sign out failed. Try again.");
    } finally {
      setSyncBusy(false);
    }
  };

  const deleteAccount = async (): Promise<void> => {
    if (syncBusy || !deletePending) return;
    signedInRef.current = false;
    syncAbortRef.current?.abort();
    setSyncBusy(true);
    setSyncMessage("");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Account deletion failed.");
      const consent = revokeReaderSyncConsent(consentRef.current, Date.now());
      consentRef.current = consent;
      safeLocalWrite(consentKey, serializeReaderSyncConsent(consent));
      setDeletePending(false);
      setSyncState("signed-out");
      setSyncEmail("");
      setSyncMessage("Account deleted. Local progress and bookmarks remain in this browser.");
    } catch {
      signedInRef.current = true;
      setSyncMessage("Account deletion failed. Try again.");
    } finally {
      setSyncBusy(false);
    }
  };

  const portalTarget = typeof document === "undefined"
    ? null
    : document.querySelector<HTMLElement>(".publisher-root");

  const openBookmarkFromMarker = (bookmark: ReaderBookmark): void => {
    setBookmarkDeletePending(null);
    setBookmarkQuery(bookmark.quote.slice(0, 280));
    setOpenPanel("bookmarks");
  };

  return (
    <>
    {currentSection === undefined || currentWorkId === undefined ? null : (
      <PublisherReaderBookmarkMarkers
        bookmarks={bookmarkState}
        enabled={preferences.highlights}
        onOpenBookmark={openBookmarkFromMarker}
        portalTarget={portalTarget}
        section={currentSection}
        workId={currentWorkId}
      />
    )}
    <aside className="publisher-reader-rail" aria-label="Reader tools">
      <div className="publisher-reader-rail-progress" aria-label={
        currentProgress === null
          ? "Publication tools"
          : `${currentProgress.progress?.percent ?? 0}% read`
      }>
        <span aria-hidden="true">{currentProgress?.progress?.percent ?? "§"}</span>
      </div>
      <div className="publisher-reader-rail-actions">
        <button aria-controls={panelId} aria-expanded={openPanel === "outline"} onClick={() => toggle("outline")} type="button">
          <RailIcon><path d="M5 6h14M5 12h14M5 18h14" /></RailIcon><span>Contents</span>
        </button>
        <button aria-controls={panelId} aria-expanded={openPanel === "progress"} onClick={() => toggle("progress")} type="button">
          <RailIcon><path d="M12 3a9 9 0 1 1-9 9" /><path d="M12 7v5l3 2" /></RailIcon><span>Progress</span>
        </button>
        <button aria-controls={narration.panelId} aria-expanded={narration.active} onClick={toggleNarration} type="button">
          <RailIcon><path d="M5 10v4h3l4 3V7L8 10Z" /><path d="M16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></RailIcon><span>Listen</span>
        </button>
        <button aria-controls={panelId} aria-expanded={openPanel === "search"} onClick={() => toggle("search")} type="button">
          <RailIcon><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></RailIcon><span>Search</span>
        </button>
        <button aria-controls={panelId} aria-expanded={openPanel === "bookmarks"} onClick={() => toggle("bookmarks")} type="button">
          <RailIcon><path d="M7 4h10v16l-5-3-5 3Z" /></RailIcon><span>Bookmarks</span>
        </button>
        <button aria-controls={panelId} aria-expanded={openPanel === "settings"} onClick={() => toggle("settings")} type="button">
          <RailIcon><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6" /></RailIcon><span>Settings</span>
        </button>
        {sync === null ? null : (
          <button aria-controls={panelId} aria-expanded={openPanel === "sync"} onClick={() => toggle("sync")} type="button">
            <RailIcon><path d="M7 17a4 4 0 0 1 0-8 5 5 0 0 1 9.6 1.4A3.5 3.5 0 1 1 17.5 17Z" /></RailIcon><span>Sync</span>
          </button>
        )}
      </div>

      {openPanel === null ? null : (
        <section className="publisher-reader-panel" id={panelId} aria-label={panelLabel(openPanel)}>
          <header>
            <h2>{panelLabel(openPanel)}</h2>
            <button onClick={() => setOpenPanel(null)} type="button" aria-label="Close reader tools">Close</button>
          </header>

          {openPanel === "outline" ? (
            <div className="publisher-reader-contents">
              {breadcrumbs.length === 0 ? null : (
                <nav className="publisher-reader-breadcrumbs" aria-label="Current section path">
                  <ol>
                    {breadcrumbs.map((entry, index) => (
                      <li key={entry.id}>
                        {index === breadcrumbs.length - 1 ? <span aria-current="page">{entry.title}</span> : <a href={entry.href}>{entry.title}</a>}
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
              {outline.length === 0 ? <p>This page has no section outline.</p> : (
                <ol className="publisher-reader-outline">
                  {outline.map((entry) => (
                    <li key={entry.id} style={{ "--publisher-outline-depth": entry.depth } as React.CSSProperties}>
                      <a href={entry.href} aria-current={currentSection?.id === entry.id ? "page" : undefined}>{entry.title}</a>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : null}

          {openPanel === "progress" ? (
            currentProgress === null || currentSection === undefined ? (
              <p>Open a section to view reading progress.</p>
            ) : (
              <div className="publisher-reader-progress-panel">
                {progressCatalogState === "loading" ? <p role="status">Loading publication progress…</p> : null}
                {progressCatalogState === "failed" ? <p role="alert">Publication progress could not load. Current section progress remains available.</p> : null}
                {progressOverview === null ? null : (
                  <section className="publisher-reader-progress-overview" aria-labelledby={`${panelId}-publication-progress`}>
                    <h3 id={`${panelId}-publication-progress`}>Publication</h3>
                    <p className="publisher-reader-progress-summary">
                      <strong>{progressOverview.aggregate.percent}%</strong> complete across {new Intl.NumberFormat().format(progressOverview.aggregate.sectionCount)} sections
                    </p>
                    <p>{new Intl.NumberFormat().format(progressOverview.bookmarkedSectionCount)} section{progressOverview.bookmarkedSectionCount === 1 ? "" : "s"} with saved passages</p>
                    <ol className="publisher-reader-progress-map" aria-label="Section progress">
                      {progressOverview.sections.map((section) => (
                        <li key={`${section.workId}:${section.sectionId}`} data-status={section.status}>
                          <a href={section.href} aria-current={currentSection.id === section.sectionId ? "page" : undefined}>
                            <span>{section.title}</span>
                            <small>{progressStatusLabel(section.status)}, {section.percent}%{section.bookmarked ? ", saved passage" : ""}</small>
                          </a>
                        </li>
                      ))}
                    </ol>
                    {progressOverview.recommendations.length === 0 ? null : (
                      <div className="publisher-reader-progress-list">
                        <h4>Continue reading</h4>
                        <ol>
                          {progressOverview.recommendations.map((item) => (
                            <li key={item.sectionId}>
                              <a href={item.href}>{item.title}</a>
                              <small>{item.reason === "updated" ? "Updated since you read it" : "Continue here"}{item.bookmarked ? ", saved passage" : ""}</small>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {progressOverview.recentlyRead.length === 0 ? null : (
                      <div className="publisher-reader-progress-list">
                        <h4>Recently read</h4>
                        <ol>
                          {progressOverview.recentlyRead.map((item) => (
                            <li key={item.sectionId}>
                              <a href={item.href}>{item.title}</a>
                              {item.bookmarked ? <small>Saved passage</small> : null}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </section>
                )}
                <h3>Current section: {currentSection.title}</h3>
                <dl>
                  <div><dt>Status</dt><dd>{progressStatusLabel(currentProgress.status)}</dd></div>
                  <div><dt>Complete</dt><dd>{currentProgress.progress?.percent ?? 0}%</dd></div>
                  <div><dt>Reading time</dt><dd>{formatReadingTime(currentProgress.progress?.readingTimeMs ?? 0)}</dd></div>
                  <div><dt>Visits</dt><dd>{new Intl.NumberFormat().format(currentProgress.progress?.openCount ?? 0)}</dd></div>
                  <div><dt>Returns</dt><dd>{new Intl.NumberFormat().format(Math.max(0, (currentProgress.progress?.openCount ?? 0) - 1))}</dd></div>
                </dl>
                {currentProgress.status === "read" ? null : (
                  <button className="publisher-reader-primary-action" type="button" onClick={markCurrentSectionRead}>Mark current version as read</button>
                )}
              </div>
            )
          ) : null}

          {openPanel === "search" ? (
            <div className="publisher-reader-search">
              <label htmlFor={`${panelId}-query`}>Search this publication</label>
              <input id={`${panelId}-query`} maxLength={280} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Title, phrase, saved passage, or note" type="search" value={query} />
              {searchState === "loading" ? <p role="status">Loading search index…</p> : null}
              {searchState === "failed" ? <p role="alert">Search could not load. Reload the page and try again.</p> : null}
              {searchState === "ready" && normalizedQuery.length >= 2 && results.length === 0 && bookmarkSearchResults.length === 0 ? <p>No matching passages.</p> : null}
              {bookmarkSearchResults.length === 0 ? null : (
                <div className="publisher-reader-search-bookmarks">
                  <h3>Saved passages</h3>
                  <ol>
                    {bookmarkSearchResults.map((bookmark) => (
                      <li key={bookmark.id}>
                        <a href={bookmark.href}><q>{bookmark.quote}</q></a>
                        {bookmark.note === undefined ? null : <p>{bookmark.note}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <ol className="publisher-reader-search-results">
                {results.map((result) => (
                  <li key={`${result.entry.workId}:${result.entry.sectionId}`}>
                    <a href={result.entry.href}>
                      <strong>{result.entry.sectionTitle}</strong>
                      <span>{result.entry.workTitle}</span>
                      <small>{result.snippet}</small>
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {openPanel === "bookmarks" ? (
            allBookmarks.length === 0 ? (
              <p>No saved passages yet. Passage selection controls arrive in the next Reader slice.</p>
            ) : (
              <div className="publisher-reader-bookmark-panel">
                <div className="publisher-reader-bookmark-tools">
                  <label htmlFor={`${panelId}-bookmark-query`}>Search saved passages</label>
                  <input ref={bookmarkQueryRef} id={`${panelId}-bookmark-query`} maxLength={280} onChange={(event) => setBookmarkQuery(event.currentTarget.value)} type="search" value={bookmarkQuery} />
                  <button className="publisher-reader-secondary-action" onClick={downloadBookmarks} type="button">Export saved passages</button>
                  <button className="publisher-reader-secondary-action" onClick={(event) => { bookmarkDeleteTriggerRef.current = event.currentTarget; setBookmarkDeletePending({ kind: "all" }); }} type="button">Remove all saved passages</button>
                </div>
                {bookmarks.length === 0 ? <p>No saved passages match this search.</p> : (
                  <>
                    <p className="publisher-reader-bookmark-summary">{new Intl.NumberFormat().format(bookmarks.length)} saved passage{bookmarks.length === 1 ? "" : "s"}</p>
                    <PublisherReaderBookmarkList
                      bookmarks={bookmarks}
                      queryKey={bookmarkQuery}
                      onRemove={(bookmark, trigger) => {
                        bookmarkDeleteTriggerRef.current = trigger;
                        setBookmarkDeletePending({ kind: "one", id: bookmark.id });
                      }}
                    />
                  </>
                )}
                {bookmarkDeletePending === null ? null : (
                  <section className="publisher-reader-bookmark-delete" role="dialog" aria-modal="true" aria-label="Confirm saved passage removal">
                    <h3>{bookmarkDeletePending.kind === "all" ? "Remove all saved passages?" : "Remove this saved passage?"}</h3>
                    <p>{bookmarkDeletePending.kind === "all" ? `This removes ${new Intl.NumberFormat().format(allBookmarks.length)} saved passage${allBookmarks.length === 1 ? "" : "s"} from this browser and any connected synchronization account.` : "This removes the selected passage from this browser and any connected synchronization account."}</p>
                    <div>
                      <button type="button" onClick={cancelBookmarkDeletion}>Cancel</button>
                      <button ref={bookmarkDeleteConfirmRef} className="publisher-reader-primary-action" type="button" onClick={confirmBookmarkDeletion}>Remove</button>
                    </div>
                  </section>
                )}
              </div>
            )
          ) : null}

          {openPanel === "settings" ? (
            <div className="publisher-reader-settings">
              <label>Text size
                <select value={preferences.fontScale} onChange={(event) => updatePreference({ fontScale: Number(event.currentTarget.value) as ReaderPreferences["fontScale"] })}>
                  {READER_FONT_SCALES.map((scale) => <option key={scale} value={scale}>{scale}%</option>)}
                </select>
              </label>
              <label>Font
                <select value={preferences.fontFamilyId} onChange={(event) => updatePreference({ fontFamilyId: event.currentTarget.value })}>
                  {DEFAULT_FONT_POLICY.fontFamilyIds.map((font) => <option key={font} value={font}>{font}</option>)}
                </select>
              </label>
              <label>Color
                <select value={preferences.colorScheme} onChange={(event) => updatePreference({ colorScheme: event.currentTarget.value as ReaderPreferences["colorScheme"] })}>
                  {READER_COLOR_SCHEMES.map((scheme) => <option key={scheme} value={scheme}>{scheme}</option>)}
                </select>
              </label>
              <label>Focus
                <select value={preferences.focus} onChange={(event) => updatePreference({ focus: event.currentTarget.value as ReaderPreferences["focus"] })}>
                  {READER_FOCUS_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
              <label>Motion
                <select value={preferences.motion} onChange={(event) => updatePreference({ motion: event.currentTarget.value as ReaderPreferences["motion"] })}>
                  {READER_MOTION_PREFERENCES.map((motion) => <option key={motion} value={motion}>{motion}</option>)}
                </select>
              </label>
              <label className="publisher-reader-toggle">
                <input checked={preferences.highlights} onChange={(event) => updatePreference({ highlights: event.currentTarget.checked })} type="checkbox" />
                Show saved highlights
              </label>
            </div>
          ) : null}

          {openPanel === "sync" && sync !== null ? (
            <div className="publisher-reader-sync">
              <p>Reading progress and bookmarks stay in this browser unless you explicitly choose to sync them.</p>
              {syncState === "loading" ? <p role="status">Checking account status…</p> : null}
              {syncState === "unavailable" ? <p role="alert">Sync is unavailable. Local reading is unaffected.</p> : null}
              {syncState === "signed-out" ? (
                <>
                  <form onSubmit={beginAuthentication}>
                    <label htmlFor={`${panelId}-email`}>Email</label>
                    <input ref={syncEmailRef} id={`${panelId}-email`} type="email" autoComplete="email" value={syncEmail} onChange={(event) => setSyncEmail(event.currentTarget.value)} required />
                    <button type="submit" disabled={syncBusy}>Sign in to sync</button>
                  </form>
                  {consentPending ? (
                    <section className="publisher-reader-sync-consent" role="dialog" aria-modal="true" aria-label="Confirm synchronization">
                      <h3>Sync progress and bookmarks?</h3>
                      <p>If you continue, this publication may store your reading progress, saved passages, and notes with its configured account provider so they can be shared between your devices.</p>
                      <div>
                        <button type="button" onClick={() => { setConsentPending(false); syncEmailRef.current?.focus(); }} disabled={syncBusy}>Cancel</button>
                        <button ref={consentContinueRef} type="button" onClick={() => void confirmAuthentication()} disabled={syncBusy}>Continue</button>
                      </div>
                    </section>
                  ) : null}
                  {pendingEmail.length > 0 ? (
                    <form onSubmit={(event) => void verifyAuthentication(event)}>
                      <label htmlFor={`${panelId}-code`}>One-time code</label>
                      <input id={`${panelId}-code`} type="text" inputMode="numeric" autoComplete="one-time-code" value={syncCode} onChange={(event) => setSyncCode(event.currentTarget.value)} required />
                      <button type="submit" disabled={syncBusy}>Verify code</button>
                    </form>
                  ) : null}
                </>
              ) : null}
              {syncState === "signed-in" ? (
                <div className="publisher-reader-sync-account">
                  <p><strong>Signed in</strong>{syncEmail.length === 0 ? null : <> as {syncEmail}</>}</p>
                  <button type="button" onClick={() => void signOut()} disabled={syncBusy}>Sign out</button>
                  {sync.capabilities.includes("account-deletion") ? (
                    <div className="publisher-reader-sync-delete">
                      <label>
                        <input type="checkbox" checked={deletePending} onChange={(event) => setDeletePending(event.currentTarget.checked)} />
                        I understand this permanently deletes the synchronization account. Local reading data in this browser is retained.
                      </label>
                      <button type="button" onClick={() => void deleteAccount()} disabled={!deletePending || syncBusy}>Delete sync account</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {syncMessage.length === 0 ? null : <p role="status" aria-live="polite">{syncMessage}</p>}
            </div>
          ) : null}
        </section>
      )}
    </aside>
    {readerSelection === null || portalTarget === null ? null : createPortal(
      selectionEditing ? (
        <div
          className="publisher-reader-selection-action publisher-reader-selection-editor"
          style={{
            top: Math.max(
              window.scrollY + 8,
              Math.min(readerSelection.top, window.scrollY + window.innerHeight - 220),
            ),
            left: window.scrollX + window.innerWidth / 2,
          }}
          role="dialog"
          aria-label="Save selected passage"
        >
          <label>Optional note
            <textarea ref={selectionNoteRef} maxLength={280} value={selectionNote} onChange={(event) => setSelectionNote(event.currentTarget.value)} />
          </label>
          <div>
            <button type="button" onClick={() => { setSelectionEditing(false); setSelectionNote(""); }}>Cancel</button>
            <button type="button" onClick={saveReaderSelection}>Save</button>
          </div>
        </div>
      ) : (
        <button
          className="publisher-reader-selection-action"
          style={{ top: readerSelection.top, left: readerSelection.left }}
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setSelectionEditing(true)}
        >
          Save passage
        </button>
      ),
      portalTarget,
    )}
    {selectionMessage.length === 0 || portalTarget === null ? null : createPortal(
      <div className="publisher-reader-selection-status" role="status" aria-live="polite">
        {selectionMessage}
      </div>,
      portalTarget,
    )}
    </>
  );
}
