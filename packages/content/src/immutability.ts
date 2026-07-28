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
      "Immutable snapshots accept only plain records and arrays.",
    );
  }
  return {};
}

function defineProperty(
  target: SnapshotContainer,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Detaches and freezes JSON-shaped output without recursive call-stack limits.
 */
export function immutableSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const root = value as object;
  const snapshotRoot = createContainer(root);
  const snapshots = new WeakMap<object, SnapshotContainer>([
    [root, snapshotRoot],
  ]);
  const pending = [{ source: root, target: snapshotRoot }];
  const created: SnapshotContainer[] = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    created.push(current.target);

    for (const key of Object.keys(current.source)) {
      const descriptor = Object.getOwnPropertyDescriptor(current.source, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new TypeError(
          "Immutable snapshots reject accessors and non-data properties.",
        );
      }

      const child = descriptor.value;
      if (child === null || typeof child !== "object") {
        const childType = typeof child;
        if (
          childType === "undefined" ||
          childType === "function" ||
          childType === "symbol" ||
          childType === "bigint" ||
          (childType === "number" && !Number.isFinite(child))
        ) {
          throw new TypeError("Immutable snapshots accept only JSON values.");
        }
        defineProperty(current.target, key, child);
        continue;
      }

      let childSnapshot = snapshots.get(child);
      if (childSnapshot === undefined) {
        childSnapshot = createContainer(child);
        snapshots.set(child, childSnapshot);
        pending.push({ source: child, target: childSnapshot });
      }
      defineProperty(current.target, key, childSnapshot);
    }
  }

  for (let index = created.length - 1; index >= 0; index -= 1) {
    Object.freeze(created[index]);
  }
  return snapshotRoot as T;
}
