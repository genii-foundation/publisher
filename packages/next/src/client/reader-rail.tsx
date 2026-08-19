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
  createReaderBookmarksStorageKey,
  listLiveReaderBookmarks,
  parseReaderBookmarksState,
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
  createEmptyReaderProgressState,
  createReaderProgressStorageKey,
  parseReaderProgressState,
  recordReaderSectionProgress,
  resolveReaderSectionProgress,
  serializeReaderProgressState,
  type ReaderProgressState,
} from "@genii-foundation/publisher-reader/progress";
import {
  parseReaderSearchIndex,
  searchReaderIndex,
  type ReaderSearchIndex,
} from "@genii-foundation/publisher-reader/search";
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

export interface PublisherReaderOutlineEntry {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly depth: number;
}

export interface PublisherReaderRailProps {
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly searchPath: string;
  readonly outline: readonly PublisherReaderOutlineEntry[];
  readonly currentSection?: ReaderSection;
  readonly sync: SyncEnvelope | null;
}

type ReaderPanel = "outline" | "search" | "bookmarks" | "settings" | "sync";
type ReaderSyncState = "idle" | "loading" | "signed-out" | "signed-in" | "unavailable";

const SYNC_CONSENT_COPY_VERSION = "1.0";

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
    case "search": return "Search";
    case "bookmarks": return "Bookmarks";
    case "settings": return "Reading settings";
    case "sync": return "Sync and account";
  }
}

function syncConsentKey(publicationId: string): string {
  return `genii.publisher.sync-consent.v1:${encodeURIComponent(publicationId)}`;
}

function writeSyncConsent(publicationId: string, granted: boolean): void {
  const now = new Date().toISOString();
  safeLocalWrite(syncConsentKey(publicationId), JSON.stringify({
    schemaVersion: 1,
    publicationId,
    copyVersion: SYNC_CONSENT_COPY_VERSION,
    granted,
    ...(granted ? { grantedAt: now } : { revokedAt: now }),
  }));
}

export function PublisherReaderRail({
  publicationId,
  readerBuildId,
  searchPath,
  outline,
  currentSection,
  sync,
}: PublisherReaderRailProps): ReactElement {
  const panelId = useId();
  const syncEmailRef = useRef<HTMLInputElement>(null);
  const consentContinueRef = useRef<HTMLButtonElement>(null);
  const [openPanel, setOpenPanel] = useState<ReaderPanel | null>(null);
  const [preferences, setPreferences] = useState<ReaderPreferences>(() =>
    createDefaultReaderPreferences(DEFAULT_FONT_POLICY));
  const [progress, setProgress] = useState<ReaderProgressState>(() =>
    createEmptyReaderProgressState(publicationId));
  const [bookmarks, setBookmarks] = useState<ReturnType<typeof listLiveReaderBookmarks>>([]);
  const [query, setQuery] = useState("");
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

  useEffect(() => {
    const loaded = parseReaderPreferences(
      safeLocalRead(preferencesKey),
      DEFAULT_FONT_POLICY,
    );
    setPreferences(loaded);
    applyPreferences(loaded);
    const now = Date.now();
    setProgress(parseReaderProgressState(safeLocalRead(progressKey), {
      publicationId,
      now,
      ...(currentSection === undefined ? {} : { sections: [currentSection] }),
    }));
    const bookmarkState = parseReaderBookmarksState(
      safeLocalRead(bookmarksKey),
      { publicationId, now },
    );
    setBookmarks(listLiveReaderBookmarks(bookmarkState));
  }, [bookmarksKey, currentSection, preferencesKey, progressKey, publicationId]);

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
      setProgress((current) => {
        let next: ReaderProgressState;
        try {
          next = recordReaderSectionProgress(current, currentSection, {
            now,
            opened: true,
            navigationSource: "direct",
            percent,
            scrollPercent: percent,
            ...(percent >= 95 ? { read: "automatic" as const } : {}),
          });
        } catch {
          return current;
        }
        safeLocalWrite(progressKey, serializeReaderProgressState(next, {
          publicationId,
          now,
          sections: [currentSection],
        }));
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
  }, [currentSection, progressKey, publicationId]);

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
    if (sync === null || openPanel !== "sync" || syncState !== "idle") return;
    setSyncState("loading");
    void fetch("/api/session", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Session request failed.");
        return response.json() as Promise<{ authenticated?: unknown; email?: unknown }>;
      })
      .then((session) => {
        if (session.authenticated === true) {
          setSyncEmail(typeof session.email === "string" ? session.email : "");
          setSyncState("signed-in");
        } else if (session.authenticated === false) {
          setSyncState("signed-out");
        } else {
          setSyncState("unavailable");
        }
      })
      .catch(() => {
        setSyncState("unavailable");
      });
  }, [openPanel, sync]);

  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (consentPending) {
        setConsentPending(false);
        syncEmailRef.current?.focus();
      } else {
        setOpenPanel(null);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [consentPending]);

  useEffect(() => {
    if (consentPending) consentContinueRef.current?.focus();
  }, [consentPending]);

  const currentProgress = currentSection === undefined
    ? null
    : resolveReaderSectionProgress(progress, currentSection);
  const results = searchIndex === null || query.trim().length < 2
    ? []
    : searchReaderIndex(searchIndex, query, { limit: 12, snippetCodeUnits: 180 });

  const updatePreference = (update: ReaderPreferencesUpdate): void => {
    const next = updateReaderPreferences(preferences, update, DEFAULT_FONT_POLICY);
    setPreferences(next);
    applyPreferences(next);
    safeLocalWrite(
      preferencesKey,
      serializeReaderPreferences(next, DEFAULT_FONT_POLICY),
    );
  };

  const toggle = (panel: ReaderPanel): void => {
    setOpenPanel((current) => current === panel ? null : panel);
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
    writeSyncConsent(publicationId, true);
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
      setSyncState("signed-in");
      setSyncMessage("Signed in. Local reading remains available if sync is interrupted.");
    } catch {
      setSyncMessage("Code sign in failed. Request a fresh email and try again.");
    } finally {
      setSyncBusy(false);
    }
  };

  const signOut = async (): Promise<void> => {
    if (syncBusy) return;
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
      setSyncMessage("Sign out failed. Try again.");
    } finally {
      setSyncBusy(false);
    }
  };

  const deleteAccount = async (): Promise<void> => {
    if (syncBusy || !deletePending) return;
    setSyncBusy(true);
    setSyncMessage("");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Account deletion failed.");
      writeSyncConsent(publicationId, false);
      setDeletePending(false);
      setSyncState("signed-out");
      setSyncEmail("");
      setSyncMessage("Account deleted. Local progress and bookmarks remain in this browser.");
    } catch {
      setSyncMessage("Account deletion failed. Try again.");
    } finally {
      setSyncBusy(false);
    }
  };

  return (
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
            outline.length === 0 ? <p>This page has no section outline.</p> : (
              <ol className="publisher-reader-outline">
                {outline.map((entry) => (
                  <li key={entry.id} style={{ "--publisher-outline-depth": entry.depth } as React.CSSProperties}>
                    <a href={entry.href}>{entry.title}</a>
                  </li>
                ))}
              </ol>
            )
          ) : null}

          {openPanel === "search" ? (
            <div className="publisher-reader-search">
              <label htmlFor={`${panelId}-query`}>Search this publication</label>
              <input id={`${panelId}-query`} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Title, phrase, or idea" type="search" value={query} />
              {searchState === "loading" ? <p role="status">Loading search index…</p> : null}
              {searchState === "failed" ? <p role="alert">Search could not load. Reload the page and try again.</p> : null}
              {searchState === "ready" && query.trim().length >= 2 && results.length === 0 ? <p>No matching passages.</p> : null}
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
            bookmarks.length === 0 ? (
              <p>No saved passages yet. Passage selection controls arrive in the next Reader slice.</p>
            ) : (
              <ol className="publisher-reader-bookmarks">
                {bookmarks.map((bookmark) => (
                  <li key={bookmark.id}>
                    <a href={bookmark.href}><q>{bookmark.quote}</q></a>
                    {bookmark.note === undefined ? null : <p>{bookmark.note}</p>}
                  </li>
                ))}
              </ol>
            )
          ) : null}

          {openPanel === "settings" ? (
            <div className="publisher-reader-settings">
              <label>Text size
                <select value={preferences.fontScale} onChange={(event) => updatePreference({ fontScale: Number(event.currentTarget.value) as ReaderPreferences["fontScale"] })}>
                  {READER_FONT_SCALES.map((scale) => <option key={scale} value={scale}>{scale}%</option>)}
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
  );
}
