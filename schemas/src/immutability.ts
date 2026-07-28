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

type SnapshotContainer = Record<string, unknown> | unknown[];

function createContainer(value: object): SnapshotContainer {
  if (Array.isArray(value)) {
    return [];
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(
      "Immutable snapshots accept only plain records, arrays, and immutable primitives.",
    );
  }

  return {};
}

function assertSnapshotPrimitive(value: unknown): void {
  const valueType = typeof value;
  if (
    value === null ||
    valueType === "string" ||
    valueType === "boolean" ||
    valueType === "undefined" ||
    (valueType === "number" && Number.isFinite(value))
  ) {
    return;
  }

  throw new TypeError(
    "Immutable snapshots accept only plain records, arrays, and immutable primitives.",
  );
}

function defineSnapshotProperty(
  snapshot: SnapshotContainer,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(snapshot, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Detaches public result objects from caller-owned input and recursively
 * freezes the snapshot. Public runtime results only contain structured-clone
 * compatible records, arrays, and primitives.
 */
export function immutableSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const sourceRoot = value as object;
  const snapshotRoot = createContainer(sourceRoot);
  const snapshotBySource = new WeakMap<object, SnapshotContainer>([
    [sourceRoot, snapshotRoot],
  ]);
  const pending = [{ source: sourceRoot, snapshot: snapshotRoot }];
  const snapshots: SnapshotContainer[] = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    snapshots.push(current.snapshot);

    for (const key of Object.keys(current.source)) {
      const child = (current.source as Readonly<Record<string, unknown>>)[key];
      if (child === null || typeof child !== "object") {
        assertSnapshotPrimitive(child);
        defineSnapshotProperty(current.snapshot, key, child);
        continue;
      }

      let childSnapshot = snapshotBySource.get(child);
      if (childSnapshot === undefined) {
        childSnapshot = createContainer(child);
        snapshotBySource.set(child, childSnapshot);
        pending.push({ source: child, snapshot: childSnapshot });
      }
      defineSnapshotProperty(current.snapshot, key, childSnapshot);
    }
  }

  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    Object.freeze(snapshots[index]);
  }

  return snapshotRoot as T;
}
