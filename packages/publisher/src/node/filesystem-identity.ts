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
  constants,
} from "node:fs";
import {
  type FileHandle,
  lstat,
  open,
  opendir,
  realpath,
} from "node:fs/promises";
import type {
  BigIntStats,
} from "node:fs";

export type FileSystemNodeKind =
  | "directory"
  | "file"
  | "other"
  | "symbolic-link";

export interface FileSystemNodeIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly nlink: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  readonly kind: FileSystemNodeKind;
}

export interface OpenedPublicationFile {
  readonly close: () => Promise<void>;
  readonly readFile: (
    maximumBytes: number,
    expectedBytes: number,
  ) => Promise<Uint8Array>;
  readonly stat: () => Promise<FileSystemNodeIdentity>;
}

export type DirectoryNameReadResult =
  | {
      readonly complete: true;
      readonly names: readonly Uint8Array[];
    }
  | {
      readonly complete: false;
    };

export interface PublicationFileSystem {
  readonly lstat: (
    absolutePath: string,
  ) => Promise<FileSystemNodeIdentity>;
  readonly openReadOnlyNoFollow: (
    absolutePath: string,
  ) => Promise<OpenedPublicationFile>;
  readonly readDirectoryNames: (
    absolutePath: string,
    maximumEntries: number,
    maximumNameBytes: number,
  ) => Promise<DirectoryNameReadResult>;
  readonly realpath: (absolutePath: string) => Promise<string>;
}

function nodeKind(stat: BigIntStats): FileSystemNodeKind {
  if (stat.isSymbolicLink()) {
    return "symbolic-link";
  }
  if (stat.isDirectory()) {
    return "directory";
  }
  if (stat.isFile()) {
    return "file";
  }
  return "other";
}

function nodeIdentity(stat: BigIntStats): FileSystemNodeIdentity {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
    kind: nodeKind(stat),
  });
}

function openedFile(handle: FileHandle): OpenedPublicationFile {
  return Object.freeze({
    close: () => handle.close(),
    readFile: async (
      maximumBytes: number,
      expectedBytes: number,
    ) => {
      const capacity = Math.min(
        maximumBytes + 1,
        expectedBytes + 1,
      );
      const result = new Uint8Array(capacity);
      let totalBytes = 0;
      while (totalBytes < capacity) {
        const { bytesRead } = await handle.read(
          result,
          totalBytes,
          capacity - totalBytes,
          totalBytes,
        );
        if (bytesRead === 0) {
          break;
        }
        totalBytes += bytesRead;
      }
      return result.subarray(0, totalBytes);
    },
    stat: async () =>
      nodeIdentity(await handle.stat({ bigint: true })),
  });
}

const noFollowFlag =
  typeof constants.O_NOFOLLOW === "number"
    ? constants.O_NOFOLLOW
    : 0;
const nonblockingFlag =
  typeof constants.O_NONBLOCK === "number"
    ? constants.O_NONBLOCK
    : 0;

export const nodePublicationFileSystem: PublicationFileSystem =
  Object.freeze({
    lstat: async (absolutePath: string) =>
      nodeIdentity(await lstat(absolutePath, { bigint: true })),
    openReadOnlyNoFollow: async (absolutePath: string) =>
      openedFile(
        await open(
          absolutePath,
          constants.O_RDONLY | noFollowFlag | nonblockingFlag,
        ),
      ),
    readDirectoryNames: async (
      absolutePath: string,
      maximumEntries: number,
      maximumNameBytes: number,
    ) => {
      const directory = await opendir(absolutePath, {
        encoding: "buffer" as BufferEncoding,
      });
      const names: Uint8Array[] = [];
      let nameBytes = 0;
      for await (const entry of directory) {
        if (names.length >= maximumEntries) {
          return Object.freeze({
            complete: false as const,
          });
        }
        const entryName = entry.name as unknown;
        if (!(entryName instanceof Uint8Array)) {
          throw new TypeError(
            "Directory enumeration did not return byte names.",
          );
        }
        const name = new Uint8Array(entryName);
        if (nameBytes + name.byteLength > maximumNameBytes) {
          return Object.freeze({
            complete: false as const,
          });
        }
        names.push(name);
        nameBytes += name.byteLength;
      }
      return Object.freeze({
        complete: true as const,
        names: Object.freeze(names),
      });
    },
    realpath,
  });

export function sameDirectoryIdentity(
  left: FileSystemNodeIdentity,
  right: FileSystemNodeIdentity,
): boolean {
  return (
    left.kind === "directory" &&
    right.kind === "directory" &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

export function sameFileIdentity(
  left: FileSystemNodeIdentity,
  right: FileSystemNodeIdentity,
): boolean {
  return (
    left.kind === "file" &&
    right.kind === "file" &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

export function filesystemIdentityKey(
  identity: FileSystemNodeIdentity,
): string {
  return `${identity.dev.toString()}:${identity.ino.toString()}`;
}
