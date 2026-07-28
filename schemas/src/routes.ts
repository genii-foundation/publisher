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

export type CanonicalRoutePathIssue =
  | "backslash"
  | "character"
  | "control-character"
  | "dot-segment"
  | "empty-segment"
  | "length"
  | "origin-relative"
  | "percent-encoded-ascii"
  | "percent-encoding-case"
  | "percent-encoding-syntax"
  | "percent-encoding-utf8"
  | "raw-non-ascii"
  | "type"
  | "unicode-normalization"
  | "whitespace";

export type CanonicalRoutePathInspection =
  | {
      readonly valid: true;
      readonly value: string;
    }
  | {
      readonly valid: false;
      readonly issue: CanonicalRoutePathIssue;
    };

const RAW_ROUTE_CHARACTER = /^[A-Za-z0-9._~!$&'()*+,;=:@/-]$/;
const UPPERCASE_HEX_DIGIT = /^[0-9A-F]$/;
const ASCII_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const C1_CONTROL_CHARACTER = /[\u0080-\u009f]/u;
const UNICODE_WHITESPACE = /\s/u;

function invalid(
  issue: CanonicalRoutePathIssue,
): CanonicalRoutePathInspection {
  return { valid: false, issue };
}

/**
 * Checks the one serialized route form used by manifests, artifacts,
 * runtimes, browsers, and hosts.
 *
 * Non-ASCII characters use uppercase UTF-8 percent encoding. ASCII octets
 * are never percent encoded, so browser-equivalent paths have one spelling.
 */
export function inspectCanonicalRoutePath(
  value: unknown,
): CanonicalRoutePathInspection {
  if (typeof value !== "string") {
    return invalid("type");
  }
  if (value.length < 1 || value.length > 2048) {
    return invalid("length");
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return invalid("origin-relative");
  }
  if (value === "/") {
    return { valid: true, value };
  }
  if (value.slice(1).includes("//")) {
    return invalid("empty-segment");
  }
  const segments = value.split("/").slice(1);
  if (segments.includes(".") || segments.includes("..")) {
    return invalid("dot-segment");
  }

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined) {
      break;
    }
    if (character === "%") {
      const first = value[index + 1];
      const second = value[index + 2];
      if (
        first === undefined ||
        second === undefined ||
        !/^[0-9A-Fa-f]$/.test(first) ||
        !/^[0-9A-Fa-f]$/.test(second)
      ) {
        return invalid("percent-encoding-syntax");
      }
      if (
        !UPPERCASE_HEX_DIGIT.test(first) ||
        !UPPERCASE_HEX_DIGIT.test(second)
      ) {
        return invalid("percent-encoding-case");
      }
      const byte = Number.parseInt(`${first}${second}`, 16);
      if (byte < 0x80) {
        return invalid("percent-encoded-ascii");
      }
      index += 2;
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint > 0x7f) {
      return invalid("raw-non-ascii");
    }
    if (character === "\\") {
      return invalid("backslash");
    }
    if (ASCII_CONTROL_CHARACTER.test(character)) {
      return invalid("control-character");
    }
    if (UNICODE_WHITESPACE.test(character)) {
      return invalid("whitespace");
    }
    if (!RAW_ROUTE_CHARACTER.test(character)) {
      return invalid("character");
    }
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return invalid("percent-encoding-utf8");
  }
  if (decoded.normalize("NFC") !== decoded) {
    return invalid("unicode-normalization");
  }
  for (const character of decoded) {
    if (
      ASCII_CONTROL_CHARACTER.test(character) ||
      C1_CONTROL_CHARACTER.test(character)
    ) {
      return invalid("control-character");
    }
    if (UNICODE_WHITESPACE.test(character)) {
      return invalid("whitespace");
    }
  }

  return { valid: true, value };
}

export function isCanonicalRoutePath(value: unknown): value is string {
  return inspectCanonicalRoutePath(value).valid;
}
