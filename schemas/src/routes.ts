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

import { normalizePortableRepositoryText } from "./portable-unicode.js";

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

export type CanonicalUrlFragmentIssue =
  | "character"
  | "control-character"
  | "fragment-directive"
  | "length"
  | "percent-encoding-syntax"
  | "percent-encoding-utf8"
  | "type"
  | "unicode-normalization"
  | "unicode-scalar"
  | "whitespace";

export type CanonicalUrlFragmentInspection =
  | {
      readonly valid: true;
      readonly value: string;
      readonly decoded: string;
    }
  | {
      readonly valid: false;
      readonly issue: CanonicalUrlFragmentIssue;
    };

export type AbsoluteHttpUrlIssue =
  | "credentials"
  | "host"
  | "protocol"
  | "serialization"
  | "syntax"
  | "type"
  | "unicode-scalar";

export type AbsoluteHttpUrlInspection =
  | {
      readonly valid: true;
      readonly value: string;
    }
  | {
      readonly valid: false;
      readonly issue: AbsoluteHttpUrlIssue;
    };

const RAW_ROUTE_CHARACTER = /^[A-Za-z0-9._~!$&'()*+,;=:@/-]$/;
const RAW_FRAGMENT_ASCII_CHARACTER = /^[A-Za-z0-9._~!$&'()*+,;=:@/?-]$/;
const ABSOLUTE_HTTP_URL_CHARACTERS =
  /^[A-Za-z0-9._~!$&'()*+,;=:@/?#[\]%-]+$/;
const HEX_DIGIT = /^[0-9A-Fa-f]$/;
const UPPERCASE_HEX_DIGIT = /^[0-9A-F]$/;
const ASCII_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const C1_CONTROL_CHARACTER = /[\u0080-\u009f]/u;
const UNICODE_WHITESPACE = /\s/u;

function invalid(
  issue: CanonicalRoutePathIssue,
): CanonicalRoutePathInspection {
  return { valid: false, issue };
}

function invalidFragment(
  issue: CanonicalUrlFragmentIssue,
): CanonicalUrlFragmentInspection {
  return { valid: false, issue };
}

function invalidAbsoluteHttpUrl(
  issue: AbsoluteHttpUrlIssue,
): AbsoluteHttpUrlInspection {
  return { valid: false, issue };
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
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
  if (normalizePortableRepositoryText(decoded) !== decoded) {
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

/**
 * Checks and decodes the portable fragment form shared by content artifacts
 * and browser runtimes.
 *
 * Percent escapes are decoded exactly once. The returned decoded value is the
 * only value callers should use for address ownership and lookup.
 */
export function inspectCanonicalUrlFragment(
  value: unknown,
): CanonicalUrlFragmentInspection {
  if (typeof value !== "string") {
    return invalidFragment("type");
  }
  if (hasUnpairedSurrogate(value)) {
    return invalidFragment("unicode-scalar");
  }
  const scalarLength = [...value].length;
  if (scalarLength < 1 || scalarLength > 2048) {
    return invalidFragment("length");
  }

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const character = String.fromCodePoint(codePoint);
    if (character.length === 2) {
      index += 1;
    }
    if (character === "%") {
      const first = value[index + 1];
      const second = value[index + 2];
      if (
        first === undefined ||
        second === undefined ||
        !HEX_DIGIT.test(first) ||
        !HEX_DIGIT.test(second)
      ) {
        return invalidFragment("percent-encoding-syntax");
      }
      index += 2;
      continue;
    }
    if (
      ASCII_CONTROL_CHARACTER.test(character) ||
      C1_CONTROL_CHARACTER.test(character)
    ) {
      return invalidFragment("control-character");
    }
    if (UNICODE_WHITESPACE.test(character)) {
      return invalidFragment("whitespace");
    }
    if (
      codePoint <= 0x7f &&
      !RAW_FRAGMENT_ASCII_CHARACTER.test(character)
    ) {
      return invalidFragment("character");
    }
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return invalidFragment("percent-encoding-utf8");
  }
  if (normalizePortableRepositoryText(decoded) !== decoded) {
    return invalidFragment("unicode-normalization");
  }
  if (decoded.includes(":~:")) {
    return invalidFragment("fragment-directive");
  }
  for (const character of decoded) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      ASCII_CONTROL_CHARACTER.test(character) ||
      C1_CONTROL_CHARACTER.test(character)
    ) {
      return invalidFragment("control-character");
    }
    if (UNICODE_WHITESPACE.test(character)) {
      return invalidFragment("whitespace");
    }
    if (
      codePoint <= 0x7f &&
      !RAW_FRAGMENT_ASCII_CHARACTER.test(character)
    ) {
      return invalidFragment("character");
    }
  }

  return { valid: true, value, decoded };
}

export function isCanonicalUrlFragment(value: unknown): value is string {
  return inspectCanonicalUrlFragment(value).valid;
}

/**
 * Checks the browser-safe absolute URL contract used by publication,
 * content, and reader artifacts.
 */
export function inspectAbsoluteHttpUrl(
  value: unknown,
): AbsoluteHttpUrlInspection {
  if (typeof value !== "string") {
    return invalidAbsoluteHttpUrl("type");
  }
  if (hasUnpairedSurrogate(value)) {
    return invalidAbsoluteHttpUrl("unicode-scalar");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidAbsoluteHttpUrl("syntax");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return invalidAbsoluteHttpUrl("protocol");
  }
  if (
    parsed.hostname.length === 0 ||
    /^\.+$/.test(parsed.hostname)
  ) {
    return invalidAbsoluteHttpUrl("host");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return invalidAbsoluteHttpUrl("credentials");
  }
  if (
    !value.startsWith(`${parsed.protocol}//`) ||
    !ABSOLUTE_HTTP_URL_CHARACTERS.test(value)
  ) {
    return invalidAbsoluteHttpUrl("serialization");
  }
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "%") {
      continue;
    }
    const first = value[index + 1];
    const second = value[index + 2];
    if (
      first === undefined ||
      second === undefined ||
      !HEX_DIGIT.test(first) ||
      !HEX_DIGIT.test(second)
    ) {
      return invalidAbsoluteHttpUrl("serialization");
    }
    index += 2;
  }
  const authorityStart = value.indexOf("//") + 2;
  const authorityEndCandidates = [
    value.indexOf("/", authorityStart),
    value.indexOf("?", authorityStart),
    value.indexOf("#", authorityStart),
  ].filter((index) => index >= 0);
  const authorityEnd =
    authorityEndCandidates.length === 0
      ? value.length
      : Math.min(...authorityEndCandidates);
  const remainder = value.slice(authorityEnd);
  if (remainder.includes("[") || remainder.includes("]")) {
    return invalidAbsoluteHttpUrl("serialization");
  }
  return { valid: true, value };
}

export function isAbsoluteHttpUrl(value: unknown): value is string {
  return inspectAbsoluteHttpUrl(value).valid;
}
