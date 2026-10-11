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
  parseReaderProgressCatalog,
  type ReaderProgressCatalog,
} from "@genii-foundation/publisher-reader/progress-catalog";
import type { Sha256Digest } from "@genii-foundation/publisher-schema/reader";
import type { PublisherNextThemeStyle } from "../theme/style.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { PublisherReaderNarration } from "./reader-narration.js";

export type PublisherReaderProgressCatalogState =
  | "idle"
  | "loading"
  | "ready"
  | "failed";

interface PublisherReaderNarrationContextValue {
  readonly active: boolean;
  readonly close: () => void;
  readonly ensureProgressCatalog: () => void;
  readonly open: () => void;
  readonly panelId: string;
  readonly progressCatalog: ReaderProgressCatalog | null;
  readonly progressCatalogState: PublisherReaderProgressCatalogState;
  readonly setCurrentSectionId: (sectionId: string | undefined) => void;
}

const inactiveNarrationContext: PublisherReaderNarrationContextValue =
  Object.freeze({
    active: false,
    close: () => undefined,
    ensureProgressCatalog: () => undefined,
    open: () => undefined,
    panelId: "publisher-reader-narration",
    progressCatalog: null,
    progressCatalogState: "idle",
    setCurrentSectionId: () => undefined,
  });

const PublisherReaderNarrationContext = createContext(
  inactiveNarrationContext,
);

export function usePublisherReaderNarration():
PublisherReaderNarrationContextValue {
  return useContext(PublisherReaderNarrationContext);
}

export function PublisherReaderNarrationProvider({
  audioPath,
  children,
  progressPath,
  publicationId,
  readerBuildId,
  themeStyle,
}: {
  readonly audioPath: string;
  readonly children: ReactNode;
  readonly progressPath: string;
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly themeStyle: PublisherNextThemeStyle;
}): ReactElement {
  const panelId = useId();
  const [active, setActive] = useState(false);
  const [catalogRequested, setCatalogRequested] = useState(false);
  const [currentSectionId, setCurrentSectionId] = useState<string>();
  const [progressCatalog, setProgressCatalog] =
    useState<ReaderProgressCatalog | null>(null);
  const [progressCatalogState, setProgressCatalogState] =
    useState<PublisherReaderProgressCatalogState>("idle");
  const close = useCallback(() => setActive(false), []);
  const ensureProgressCatalog = useCallback(
    () => setCatalogRequested(true),
    [],
  );
  const open = useCallback(() => {
    setActive(true);
    setCatalogRequested(true);
  }, []);

  useEffect(() => {
    if (!catalogRequested || progressCatalogState !== "idle") return;
    setProgressCatalogState("loading");
    void fetch(progressPath, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("Progress artifact request failed.");
        return response.text();
      })
      .then((serialized) => {
        const parsed = parseReaderProgressCatalog(serialized, {
          publicationId,
          readerBuildId,
        });
        if (parsed === null) {
          throw new Error("Progress artifact identity mismatch.");
        }
        setProgressCatalog(parsed);
        setProgressCatalogState("ready");
      })
      .catch(() => setProgressCatalogState("failed"));
  }, [
    catalogRequested,
    progressCatalogState,
    progressPath,
    publicationId,
    readerBuildId,
  ]);

  const value = useMemo<PublisherReaderNarrationContextValue>(() => ({
    active,
    close,
    ensureProgressCatalog,
    open,
    panelId,
    progressCatalog,
    progressCatalogState,
    setCurrentSectionId,
  }), [
    active,
    close,
    ensureProgressCatalog,
    open,
    panelId,
    progressCatalog,
    progressCatalogState,
  ]);

  return (
    <PublisherReaderNarrationContext.Provider value={value}>
      {children}
      <div className="publisher-reader-audio-host" style={themeStyle}>
        <PublisherReaderNarration
          active={active}
          audioPath={audioPath}
          {...(currentSectionId === undefined ? {} : { currentSectionId })}
          panelId={panelId}
          progressCatalog={progressCatalog}
          publicationId={publicationId}
          readerBuildId={readerBuildId}
          onClose={close}
          onOpen={open}
        />
      </div>
    </PublisherReaderNarrationContext.Provider>
  );
}
