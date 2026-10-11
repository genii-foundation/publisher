/*
No alternative license is selected for GENII Publisher Original Code. The alternative-license fields in the required Exhibit A notice below are intentionally unpopulated.

“The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/license/cpal-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
The Original Code is GENII Publisher.
The Original Developer is not the Initial Developer and is __________. If left blank, the Original Developer is the Initial Developer.
The Initial Developer of the Original Code is GENII Foundation. All portions of the code written by GENII Foundation are Copyright (c) 2026 GENII Foundation. All Rights Reserved.
Contributor ______________________.
Alternatively, the contents of this file may be used under the terms of the _____ license (the [___] License), in which case the provisions of [______] License are applicable instead of those above.
If you wish to allow use of your version of this file only under the terms of the [____] License and not to allow others to use your version under the CPAL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the [___] License. If you do not delete the provisions above, a recipient may use your version under either the CPAL or the [___] License.”
*/

"use client";

import { useSyncExternalStore } from "react";

const READER_STORE_EVENT = "genii.publisher.reader.store";

export type PublisherReaderStoreChangeSource =
  | "external"
  | "local"
  | "remote";

export interface PublisherReaderStoreSignal {
  readonly storageKey: string | null;
  readonly serialized: string | null;
}

export interface PublisherReaderStoreEnvironment {
  readonly read: (storageKey: string) => string | null;
  readonly write: (storageKey: string, serialized: string) => void;
  readonly publish: (signal: PublisherReaderStoreSignal) => void;
  readonly subscribe: (
    listener: (signal: PublisherReaderStoreSignal) => void,
  ) => () => void;
}

export interface PublisherReaderStore<T> {
  readonly getServerSnapshot: () => T;
  readonly getSnapshot: () => T;
  readonly read: () => T;
  readonly subscribe: (listener: () => void) => () => void;
  readonly subscribeChanges: (
    listener: (source: PublisherReaderStoreChangeSource) => void,
  ) => () => void;
  readonly update: (updater: (current: T) => T) => T;
  readonly write: (
    value: T,
    source?: Exclude<PublisherReaderStoreChangeSource, "external">,
  ) => T;
}

export interface CreatePublisherReaderStoreOptions<T> {
  readonly storageKey: string;
  readonly parse: (serialized: string | null) => T;
  readonly serialize: (value: T) => string;
  readonly empty: () => T;
  readonly environment?: PublisherReaderStoreEnvironment;
}

const browserEnvironment: PublisherReaderStoreEnvironment = Object.freeze({
  read(storageKey: string): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(storageKey);
  },
  write(storageKey: string, serialized: string): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, serialized);
  },
  publish(signal: PublisherReaderStoreSignal): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(READER_STORE_EVENT, {
      detail: signal,
    }));
  },
  subscribe(
    listener: (signal: PublisherReaderStoreSignal) => void,
  ): () => void {
    if (typeof window === "undefined") return () => undefined;
    const storageListener = (event: StorageEvent): void => {
      listener({
        storageKey: event.key,
        serialized: event.newValue,
      });
    };
    const sameTabListener = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      let signal: PublisherReaderStoreSignal;
      try {
        const detail = event.detail as Partial<PublisherReaderStoreSignal> | null;
        if (
          detail === null ||
          !(detail.storageKey === null || typeof detail.storageKey === "string") ||
          !(detail.serialized === null || typeof detail.serialized === "string")
        ) return;
        signal = {
          storageKey: detail.storageKey,
          serialized: detail.serialized,
        };
      } catch {
        // Uninspectable same-tab signals cannot alter Reader state.
        return;
      }
      listener(signal);
    };
    window.addEventListener("storage", storageListener);
    window.addEventListener(READER_STORE_EVENT, sameTabListener);
    return () => {
      window.removeEventListener("storage", storageListener);
      window.removeEventListener(READER_STORE_EVENT, sameTabListener);
    };
  },
});

export function createPublisherReaderStore<T>({
  storageKey,
  parse,
  serialize,
  empty,
  environment = browserEnvironment,
}: CreatePublisherReaderStoreOptions<T>): PublisherReaderStore<T> {
  const serverSnapshot = empty();
  const snapshotListeners = new Set<() => void>();
  const changeListeners = new Set<(
    source: PublisherReaderStoreChangeSource,
  ) => void>();
  let cached = serverSnapshot;
  let cachedSerialized: string | undefined;
  let cachedReady = false;
  let writingInternally = false;
  let unsubscribeEnvironment: (() => void) | null = null;

  const parseSafely = (serialized: string | null): T => {
    try {
      return parse(serialized);
    } catch {
      return empty();
    }
  };
  const readPersisted = (): T => {
    try {
      return parseSafely(environment.read(storageKey));
    } catch {
      return empty();
    }
  };
  const serializeSafely = (value: T): string | undefined => {
    try {
      return serialize(value);
    } catch {
      return undefined;
    }
  };
  const notify = (source: PublisherReaderStoreChangeSource): void => {
    for (const listener of [...snapshotListeners]) listener();
    for (const listener of [...changeListeners]) listener(source);
  };
  const handleEnvironmentSignal = (
    signal: PublisherReaderStoreSignal,
  ): void => {
    if (writingInternally) return;
    if (signal.storageKey !== null && signal.storageKey !== storageKey) return;
    const next = signal.storageKey === storageKey
      ? parseSafely(signal.serialized)
      : readPersisted();
    const nextSerialized = serializeSafely(next);
    if (
      cachedReady &&
      nextSerialized !== undefined &&
      nextSerialized === cachedSerialized
    ) return;
    cached = next;
    cachedSerialized = nextSerialized;
    cachedReady = true;
    notify("external");
  };
  const connect = (): void => {
    if (unsubscribeEnvironment !== null) return;
    unsubscribeEnvironment = environment.subscribe(handleEnvironmentSignal);
  };
  const disconnectIfUnused = (): void => {
    if (
      unsubscribeEnvironment === null ||
      snapshotListeners.size > 0 ||
      changeListeners.size > 0
    ) return;
    unsubscribeEnvironment();
    unsubscribeEnvironment = null;
  };
  const getSnapshot = (): T => {
    if (!cachedReady) {
      cached = readPersisted();
      cachedSerialized = serializeSafely(cached);
      cachedReady = true;
    }
    return cached;
  };
  const write = (
    value: T,
    source: Exclude<PublisherReaderStoreChangeSource, "external"> = "local",
  ): T => {
    const serialized = serialize(value);
    if (cachedReady && serialized === cachedSerialized) return cached;
    cached = value;
    cachedSerialized = serialized;
    cachedReady = true;
    try {
      environment.write(storageKey, serialized);
    } catch {
      // The in-memory Reader remains usable when browser persistence is unavailable.
    }
    writingInternally = true;
    try {
      environment.publish({ storageKey, serialized });
    } finally {
      writingInternally = false;
    }
    notify(source);
    return value;
  };
  const update = (updater: (current: T) => T): T => {
    const current = getSnapshot();
    const next = updater(current);
    return next === current ? current : write(next);
  };
  const subscribe = (listener: () => void): (() => void) => {
    snapshotListeners.add(listener);
    connect();
    return () => {
      snapshotListeners.delete(listener);
      disconnectIfUnused();
    };
  };
  const subscribeChanges = (
    listener: (source: PublisherReaderStoreChangeSource) => void,
  ): (() => void) => {
    changeListeners.add(listener);
    connect();
    return () => {
      changeListeners.delete(listener);
      disconnectIfUnused();
    };
  };

  return Object.freeze({
    getServerSnapshot: () => serverSnapshot,
    getSnapshot,
    read: getSnapshot,
    subscribe,
    subscribeChanges,
    update,
    write,
  });
}

export function usePublisherReaderStore<T>(
  store: PublisherReaderStore<T>,
): T {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}
