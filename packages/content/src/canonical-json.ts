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

import type { JSONValue } from "@genii-foundation/publisher-schema";

type CanonicalFrame =
  | { readonly kind: "leave"; readonly value: object }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "value"; readonly value: unknown };

function jsonString(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(
          "Canonical JSON rejects unpaired Unicode surrogates.",
        );
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError(
        "Canonical JSON rejects unpaired Unicode surrogates.",
      );
    }
  }
  return JSON.stringify(value);
}

/**
 * Serializes the JSON data model with lexicographically ordered object keys.
 * Number and string serialization follow the ECMAScript behavior required by
 * RFC 8785. Values outside the JSON data model are rejected.
 */
export function canonicalizeJson(value: JSONValue): string {
  const output: string[] = [];
  const active = new WeakSet<object>();
  const stack: CanonicalFrame[] = [{ kind: "value", value }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      break;
    }

    if (frame.kind === "text") {
      output.push(frame.value);
      continue;
    }
    if (frame.kind === "leave") {
      active.delete(frame.value);
      continue;
    }

    const current = frame.value;
    if (current === null) {
      output.push("null");
      continue;
    }
    if (typeof current === "string") {
      output.push(jsonString(current));
      continue;
    }
    if (typeof current === "boolean") {
      output.push(current ? "true" : "false");
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError("Canonical JSON rejects non-finite numbers.");
      }
      output.push(JSON.stringify(current));
      continue;
    }
    if (typeof current !== "object") {
      throw new TypeError("Canonical JSON accepts only JSON values.");
    }
    if (active.has(current)) {
      throw new TypeError("Canonical JSON rejects cyclic values.");
    }

    const array = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "Canonical JSON accepts only arrays and plain records.",
      );
    }

    active.add(current);
    stack.push({ kind: "leave", value: current });

    if (array) {
      const values = current as readonly unknown[];
      for (const key of Reflect.ownKeys(values)) {
        if (key === "length") {
          continue;
        }
        if (
          typeof key !== "string" ||
          !/^(?:0|[1-9][0-9]*)$/.test(key) ||
          Number(key) >= values.length
        ) {
          throw new TypeError(
            "Canonical JSON rejects non-index array properties.",
          );
        }
        const descriptor = Object.getOwnPropertyDescriptor(values, key);
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          throw new TypeError(
            "Canonical JSON rejects accessors and non-data properties.",
          );
        }
      }
      output.push("[");
      stack.push({ kind: "text", value: "]" });
      for (let index = values.length - 1; index >= 0; index -= 1) {
        if (!Object.hasOwn(values, index)) {
          throw new TypeError("Canonical JSON rejects sparse arrays.");
        }
        stack.push({ kind: "value", value: values[index] });
        if (index > 0) {
          stack.push({ kind: "text", value: "," });
        }
      }
      continue;
    }

    const record = current as Readonly<Record<string, unknown>>;
    for (const key of Reflect.ownKeys(record)) {
      if (typeof key !== "string") {
        throw new TypeError("Canonical JSON rejects symbol keys.");
      }
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new TypeError(
          "Canonical JSON rejects accessors and non-data properties.",
        );
      }
    }
    const keys = Object.keys(record).sort();
    output.push("{");
    stack.push({ kind: "text", value: "}" });
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        throw new TypeError(
          "Canonical JSON rejects accessors and non-data properties.",
        );
      }
      stack.push({ kind: "value", value: descriptor.value });
      stack.push({ kind: "text", value: `${jsonString(key)}:` });
      if (index > 0) {
        stack.push({ kind: "text", value: "," });
      }
    }
  }

  return output.join("");
}
