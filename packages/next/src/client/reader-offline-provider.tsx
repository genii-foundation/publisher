/*
No alternative license is selected for GENII Publisher Original Code. The alternative-license fields in the required Exhibit A notice below are intentionally unpopulated.

“The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/cpal-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is GENII Publisher.
The Original Developer is not the Initial Developer and is __________. If left blank, the Original Developer is the Initial Developer.
The Initial Developer of the Original Code is GENII Foundation. All portions of the code written by GENII Foundation are Copyright (c) 2026 GENII Foundation. All Rights Reserved.
Contributor ______________________.
Alternatively, the contents of this file may be used under the terms of the _____ license (the [___] License), in which case the provisions of [______] License are applicable instead of those above.
If you wish to allow use of your version of this file only under the terms of the [____] License and not to allow others to use your version under the CPAL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the [___] License. If you do not delete the provisions above, a recipient may use your version of this file under either the CPAL or the [___] License.”
*/

"use client";

import {
  parseReaderOfflineCatalog,
  type ReaderOfflineCatalog,
} from "@genii-foundation/publisher-reader/offline";
import type { Sha256Digest } from "@genii-foundation/publisher-schema/reader";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  inspectPublisherReaderOfflinePackage,
  installPublisherReaderOfflinePackage,
  publisherReaderOfflineWorkIds,
  type PublisherReaderOfflinePackageProgress,
  type PublisherReaderOfflinePackageStatus,
} from "./reader-offline-cache.js";

export type PublisherReaderOfflineCatalogState =
  | "idle"
  | "loading"
  | "ready"
  | "failed";

export type PublisherReaderOfflineInstalledState =
  | "loading"
  | "ready";

interface PublisherReaderOfflineContextValue {
  readonly catalog: ReaderOfflineCatalog | null;
  readonly catalogState: PublisherReaderOfflineCatalogState;
  readonly ensureCatalog: () => void;
  readonly errors: ReadonlyMap<string, string>;
  readonly install: (workId: string) => Promise<void>;
  readonly installedState: PublisherReaderOfflineInstalledState;
  readonly installedWorkIds: ReadonlySet<string>;
  readonly online: boolean;
  readonly progress: ReadonlyMap<string, PublisherReaderOfflinePackageProgress>;
  readonly statuses: ReadonlyMap<string, PublisherReaderOfflinePackageStatus>;
  readonly supported: boolean;
}

const inactiveOfflineContext: PublisherReaderOfflineContextValue =
  Object.freeze({
    catalog: null,
    catalogState: "idle",
    ensureCatalog: () => undefined,
    errors: new Map<string, string>(),
    install: async () => undefined,
    installedState: "loading",
    installedWorkIds: new Set<string>(),
    online: true,
    progress: new Map<string, PublisherReaderOfflinePackageProgress>(),
    statuses: new Map<string, PublisherReaderOfflinePackageStatus>(),
    supported: false,
  });

const PublisherReaderOfflineContext = createContext(
  inactiveOfflineContext,
);

export function usePublisherReaderOffline():
PublisherReaderOfflineContextValue {
  return useContext(PublisherReaderOfflineContext);
}

function canRegisterServiceWorker(): boolean {
  if (!("serviceWorker" in navigator)) return false;
  return window.location.protocol === "https:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
}

export function PublisherReaderOfflineProvider({
  catalogPath,
  children,
  publicationId,
  readerBuildId,
  rendererBuildId,
}: {
  readonly catalogPath: string;
  readonly children: ReactNode;
  readonly publicationId: string;
  readonly readerBuildId: Sha256Digest;
  readonly rendererBuildId: Sha256Digest;
}): ReactElement {
  const [supported, setSupported] = useState(false);
  const [online, setOnline] = useState(true);
  const [catalogRequested, setCatalogRequested] = useState(false);
  const [catalog, setCatalog] = useState<ReaderOfflineCatalog | null>(null);
  const [catalogState, setCatalogState] =
    useState<PublisherReaderOfflineCatalogState>("idle");
  const [installedState, setInstalledState] =
    useState<PublisherReaderOfflineInstalledState>("loading");
  const [installedWorkIds, setInstalledWorkIds] =
    useState<ReadonlySet<string>>(new Set());
  const [statuses, setStatuses] =
    useState<ReadonlyMap<string, PublisherReaderOfflinePackageStatus>>(new Map());
  const [progress, setProgress] =
    useState<ReadonlyMap<string, PublisherReaderOfflinePackageProgress>>(new Map());
  const [errors, setErrors] =
    useState<ReadonlyMap<string, string>>(new Map());
  const ensureCatalog = useCallback(() => setCatalogRequested(true), []);

  const refreshInstalledWorkIds = useCallback(async (): Promise<void> => {
    const workIds = await publisherReaderOfflineWorkIds(publicationId);
    setInstalledWorkIds(new Set(workIds));
    setInstalledState("ready");
  }, [publicationId]);

  useEffect(() => {
    const available = "caches" in globalThis &&
      "fetch" in globalThis &&
      canRegisterServiceWorker();
    setSupported(available);
    if (available) void refreshInstalledWorkIds();
    else setInstalledState("ready");
  }, [refreshInstalledWorkIds]);

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const ensureOfflineWorker = useCallback(async (): Promise<void> => {
    if (!canRegisterServiceWorker()) {
      throw new Error("Offline downloads are not supported at this address.");
    }
    await navigator.serviceWorker.register("/offline-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  }, []);

  useEffect(() => {
    const navigateOffline = (event: MouseEvent): void => {
      if (
        navigator.onLine ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        anchor === null ||
        anchor.download !== "" ||
        (anchor.target !== "" && anchor.target !== "_self")
      ) return;
      const href = new URL(anchor.href, window.location.href);
      if (href.origin !== window.location.origin) return;
      event.preventDefault();
      window.location.assign(href.href);
    };
    document.addEventListener("click", navigateOffline, true);
    return () => document.removeEventListener("click", navigateOffline, true);
  }, []);

  useEffect(() => {
    if (!catalogRequested || catalogState !== "idle") return;
    setCatalogState("loading");
    void fetch(catalogPath, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) throw new Error("Offline catalog request failed.");
        return response.text();
      })
      .then(async (serialized) => {
        const parsed = parseReaderOfflineCatalog(serialized, {
          publicationId,
          readerBuildId,
          rendererBuildId,
        });
        if (parsed === null) {
          throw new Error("Offline catalog identity mismatch.");
        }
        const inspected = await Promise.all(parsed.packages.map(async (item) => [
          item.workId,
          await inspectPublisherReaderOfflinePackage(publicationId, item),
        ] as const));
        setCatalog(parsed);
        setStatuses(new Map(inspected));
        setCatalogState("ready");
        await refreshInstalledWorkIds();
      })
      .catch(() => setCatalogState("failed"));
  }, [
    catalogPath,
    catalogRequested,
    catalogState,
    publicationId,
    readerBuildId,
    refreshInstalledWorkIds,
    rendererBuildId,
  ]);

  const install = useCallback(async (workId: string): Promise<void> => {
    const offlinePackage = catalog?.packages.find((item) => item.workId === workId);
    if (offlinePackage === undefined) return;
    setErrors((current) => {
      const next = new Map(current);
      next.delete(workId);
      return next;
    });
    try {
      await ensureOfflineWorker();
      const status = await installPublisherReaderOfflinePackage(
        publicationId,
        offlinePackage,
        (nextProgress) => {
          setProgress((current) => new Map(current).set(workId, nextProgress));
        },
      );
      setStatuses((current) => new Map(current).set(workId, status));
      await refreshInstalledWorkIds();
    } catch (error) {
      setErrors((current) => new Map(current).set(
        workId,
        error instanceof Error
          ? error.message
          : "This work could not be downloaded.",
      ));
    } finally {
      setProgress((current) => {
        const next = new Map(current);
        next.delete(workId);
        return next;
      });
    }
  }, [catalog, ensureOfflineWorker, publicationId, refreshInstalledWorkIds]);

  const value = useMemo<PublisherReaderOfflineContextValue>(() => ({
    catalog,
    catalogState,
    ensureCatalog,
    errors,
    install,
    installedState,
    installedWorkIds,
    online,
    progress,
    statuses,
    supported,
  }), [
    catalog,
    catalogState,
    ensureCatalog,
    errors,
    install,
    installedState,
    installedWorkIds,
    online,
    progress,
    statuses,
    supported,
  ]);

  return (
    <PublisherReaderOfflineContext.Provider value={value}>
      {children}
    </PublisherReaderOfflineContext.Provider>
  );
}
