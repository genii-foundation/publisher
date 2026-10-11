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

import type {
  Diagnostic,
  Sha256Digest,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import { sha256 } from "./hashing.js";
import { immutableSnapshot } from "./immutability.js";

const STABLE_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MAXIMUM_SECTION_ID_CODE_UNITS = 128;
const MAXIMUM_TITLE_CODE_UNITS = 512;
const MAXIMUM_SPOKEN_TEXT_CODE_UNITS = 16_777_216;

export interface SpokenInputIdentityInput {
  readonly sectionId: string;
  readonly title: string;
  /** Presentation-free text. Markdown removal belongs to the source adapter. */
  readonly spokenBody: string;
}

export interface SpokenInputIdentity {
  readonly sectionId: string;
  readonly title: string;
  readonly spokenBody: string;
  readonly spokenText: string;
  readonly spokenTextSha256: Sha256Digest;
  readonly textCharacters: number;
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  params: Readonly<Record<string, unknown>> = {},
): Diagnostic {
  return Object.freeze({
    code,
    severity: "error",
    documentPath: "spoken-input.json",
    path,
    message,
    keyword: "semantic",
    params: Object.freeze({ ...params }),
  });
}

function invalid(diagnostics: readonly Diagnostic[]): ValidationResult<never> {
  return immutableSnapshot({ valid: false, diagnostics });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Derives the exact spoken bytes and their identity from presentation-free text.
 *
 * The title is trimmed. Body whitespace is collapsed to one ordinary space.
 * Markdown parsing and repository discovery remain adapter responsibilities.
 */
export function createSpokenInputIdentity(
  input: SpokenInputIdentityInput,
): ValidationResult<SpokenInputIdentity> {
  let snapshot: unknown;
  try {
    snapshot = immutableSnapshot(input);
  } catch {
    return invalid([diagnostic(
      "spoken_input.uninspectable",
      "",
      "The spoken input could not be inspected safely.",
    )]);
  }
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return invalid([diagnostic(
      "spoken_input.invalid",
      "",
      "The spoken input must be a plain record.",
    )]);
  }

  const record = snapshot as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareText);
  if (
    keys.length !== 3 ||
    keys[0] !== "sectionId" ||
    keys[1] !== "spokenBody" ||
    keys[2] !== "title"
  ) {
    return invalid([diagnostic(
      "spoken_input.properties",
      "",
      "Spoken input must contain only sectionId, title, and spokenBody.",
    )]);
  }

  const diagnostics: Diagnostic[] = [];
  const sectionId = typeof record.sectionId === "string" ? record.sectionId : "";
  if (
    sectionId.length === 0 ||
    sectionId.length > MAXIMUM_SECTION_ID_CODE_UNITS ||
    !STABLE_ID.test(sectionId)
  ) {
    diagnostics.push(diagnostic(
      "spoken_input.section_id.invalid",
      "/sectionId",
      "sectionId must satisfy the public stable identity contract.",
    ));
  }

  const rawTitle = typeof record.title === "string" ? record.title : "";
  const title = rawTitle.trim();
  if (
    title.length === 0 ||
    rawTitle.length > MAXIMUM_TITLE_CODE_UNITS ||
    hasUnpairedSurrogate(rawTitle)
  ) {
    diagnostics.push(diagnostic(
      "spoken_input.title.invalid",
      "/title",
      "The spoken title must be nonempty, valid Unicode within 512 UTF-16 code units.",
    ));
  }

  const rawBody =
    typeof record.spokenBody === "string" ? record.spokenBody : "";
  if (
    typeof record.spokenBody !== "string" ||
    rawBody.length > MAXIMUM_SPOKEN_TEXT_CODE_UNITS ||
    hasUnpairedSurrogate(rawBody)
  ) {
    diagnostics.push(diagnostic(
      "spoken_input.body.invalid",
      "/spokenBody",
      "The spoken body must be valid Unicode within the fixed text limit.",
    ));
  }

  if (diagnostics.length > 0) return invalid(diagnostics);
  const spokenBody = rawBody.replace(/\s+/gu, " ").trim();
  const spokenText = `${title}\n\n${spokenBody}`.trim();
  if (spokenText.length > MAXIMUM_SPOKEN_TEXT_CODE_UNITS) {
    return invalid([diagnostic(
      "spoken_input.text.too_long",
      "",
      "The normalized spoken text exceeds the fixed character limit.",
      {
        actualCharacters: spokenText.length,
        maximumCharacters: MAXIMUM_SPOKEN_TEXT_CODE_UNITS,
      },
    )]);
  }

  return immutableSnapshot({
    valid: true,
    value: {
      sectionId,
      title,
      spokenBody,
      spokenText,
      spokenTextSha256: sha256(spokenText),
      textCharacters: spokenText.length,
    },
    diagnostics: [],
  });
}
