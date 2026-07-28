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
  JSONValue,
  ValidationResult,
} from "@genii-foundation/publisher-schema";
import unicodeLetter from "@unicode/unicode-15.1.0/General_Category/Letter/regex.js";
import unicodeNumber from "@unicode/unicode-15.1.0/General_Category/Number/regex.js";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

import { canonicalizeJson } from "./canonical-json.js";
import { sha256 } from "./hashing.js";
import { immutableSnapshot } from "./immutability.js";
import {
  CONTENT_COMPILER_VERSION,
  type ContentAdapterIdentity,
  type CompiledMarkdownWorkInput,
  type MarkdownBlockInput,
} from "./types.js";
import {
  EXACT_SEMVER,
  sortDiagnostics,
  validateContentId,
  validatePackageName,
  validateRoute,
  validateStableId,
  validateUrlFragment,
} from "./validation.js";

export const CONTENT_UNICODE_VERSION = "15.1.0";
const UNREADABLE_FIELD = Symbol("unreadable Markdown adapter field");

function isWordCharacter(value: string): boolean {
  return unicodeLetter.test(value) || unicodeNumber.test(value);
}

export function normalizeTextNewlines(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function countWords(value: string): number {
  let count = 0;
  let insideWord = false;
  let pendingApostrophe = false;

  for (const character of value) {
    if (isWordCharacter(character)) {
      if (!insideWord) {
        count += 1;
      }
      insideWord = true;
      pendingApostrophe = false;
      continue;
    }
    if (
      (character === "'" || character === "’") &&
      insideWord &&
      !pendingApostrophe
    ) {
      pendingApostrophe = true;
      continue;
    }
    insideWord = false;
    pendingApostrophe = false;
  }
  return count;
}

export function calculateReadingMinutes(
  wordCount: number,
  wordsPerMinute: number,
): number {
  if (
    !Number.isInteger(wordCount) ||
    wordCount < 0 ||
    !Number.isInteger(wordsPerMinute) ||
    wordsPerMinute < 1
  ) {
    throw new TypeError(
      "Reading time requires non-negative integer words and a positive integer rate.",
    );
  }
  return wordCount === 0 ? 0 : Math.ceil(wordCount / wordsPerMinute);
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  params: Readonly<Record<string, unknown>>,
): Diagnostic {
  return {
    code,
    severity: "error",
    path,
    message,
    keyword: "markdown",
    params,
  };
}

function actualType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: Diagnostic[],
  pathPrefix = "",
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    return undefined;
  }
  if (!("value" in descriptor)) {
    diagnostics.push(
      diagnostic(
        "markdown.input.unreadable",
        `${pathPrefix}/${key}`,
        "Markdown adapter fields must be plain data properties.",
        {},
      ),
    );
    return UNREADABLE_FIELD;
  }
  return descriptor.value;
}

function requiredString(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
  allowEmpty = false,
): string | undefined {
  if (value === UNREADABLE_FIELD) {
    return undefined;
  }
  if (typeof value !== "string") {
    diagnostics.push(
      diagnostic(
        "markdown.input.invalid_type",
        path,
        "The Markdown adapter field must be a string.",
        { actualType: actualType(value), expectedType: "string" },
      ),
    );
    return undefined;
  }
  if (!allowEmpty && value.length === 0) {
    diagnostics.push(
      diagnostic(
        "markdown.input.empty_string",
        path,
        "The Markdown adapter field must not be empty.",
        {},
      ),
    );
  }
  return value;
}

function optionalString(
  value: unknown,
  path: string,
  diagnostics: Diagnostic[],
): string | undefined {
  return value === undefined
    ? undefined
    : requiredString(value, path, diagnostics);
}

function cloneMetadata(
  value: unknown,
  diagnostics: Diagnostic[],
): Readonly<Record<string, JSONValue>> | undefined {
  if (value === undefined || value === UNREADABLE_FIELD) {
    return undefined;
  }
  if (!isPlainRecord(value)) {
    diagnostics.push(
      diagnostic(
        "markdown.input.invalid_type",
        "/sectionMetadata",
        "Section metadata must be a plain JSON object.",
        { actualType: actualType(value), expectedType: "object" },
      ),
    );
    return undefined;
  }
  try {
    return JSON.parse(canonicalizeJson(value as JSONValue)) as Readonly<
      Record<string, JSONValue>
    >;
  } catch {
    diagnostics.push(
      diagnostic(
        "markdown.metadata.invalid",
        "/sectionMetadata",
        "Section metadata must contain only acyclic JSON values.",
        {},
      ),
    );
    return undefined;
  }
}

function validateAdapter(
  value: unknown,
  diagnostics: Diagnostic[],
): ContentAdapterIdentity | undefined {
  if (value === UNREADABLE_FIELD) {
    return undefined;
  }
  if (value === undefined) {
    return {
      id: "markdown",
      package: "@genii-foundation/publisher-content",
      version: CONTENT_COMPILER_VERSION,
    };
  }
  if (!isPlainRecord(value)) {
    diagnostics.push(
      diagnostic(
        "markdown.input.invalid_type",
        "/adapter",
        "The adapter identity must be a plain object.",
        { actualType: actualType(value), expectedType: "object" },
      ),
    );
    return undefined;
  }

  const id = requiredString(
    dataField(value, "id", diagnostics, "/adapter"),
    "/adapter/id",
    diagnostics,
  );
  const version = requiredString(
    dataField(value, "version", diagnostics, "/adapter"),
    "/adapter/version",
    diagnostics,
  );
  const packageName = requiredString(
    dataField(value, "package", diagnostics, "/adapter"),
    "/adapter/package",
    diagnostics,
  );
  if (id !== undefined) {
    validateStableId(id, "/adapter/id", diagnostics);
  }
  if (version !== undefined && !EXACT_SEMVER.test(version)) {
    diagnostics.push(
      diagnostic(
        "markdown.adapter.version_invalid",
        "/adapter/version",
        "The adapter version must be an exact semantic version.",
        { version },
      ),
    );
  }
  if (packageName !== undefined) {
    validatePackageName(packageName, "/adapter/package", diagnostics);
  }

  return id === undefined || packageName === undefined || version === undefined
    ? undefined
    : { id, package: packageName, version };
}

function invalidResult(
  diagnostics: readonly Diagnostic[],
): ValidationResult<CompiledMarkdownWorkInput> {
  return immutableSnapshot({
    valid: false,
    diagnostics: sortDiagnostics(diagnostics),
  });
}

function blockKind(nodeType: string): string {
  return nodeType.replaceAll(/[A-Z]/g, (character) =>
    `-${character.toLowerCase()}`,
  );
}

/**
 * Creates the neutral one-section Markdown adapter input. The caller supplies
 * the durable work and section IDs. Content-addressed block IDs are projection
 * identities, not a substitute for durable author-declared section identity.
 */
export function compileMarkdownWork(
  input: unknown,
): ValidationResult<CompiledMarkdownWorkInput> {
  try {
    return compileMarkdownWorkInput(input);
  } catch {
    return invalidResult([
      diagnostic(
        "markdown.input.unreadable",
        "",
        "The Markdown adapter input could not be read as plain data.",
        {},
      ),
    ]);
  }
}

function compileMarkdownWorkInput(
  input: unknown,
): ValidationResult<CompiledMarkdownWorkInput> {
  if (!isPlainRecord(input)) {
    return invalidResult([
      diagnostic(
        "markdown.input.invalid_type",
        "",
        "The Markdown adapter input must be a plain object.",
        { actualType: actualType(input), expectedType: "object" },
      ),
    ]);
  }

  const diagnostics: Diagnostic[] = [];
  const workId = requiredString(
    dataField(input, "workId", diagnostics),
    "/workId",
    diagnostics,
  );
  const sectionId = requiredString(
    dataField(input, "sectionId", diagnostics),
    "/sectionId",
    diagnostics,
  );
  const title = requiredString(
    dataField(input, "title", diagnostics),
    "/title",
    diagnostics,
  );
  const sourcePath = requiredString(
    dataField(input, "sourcePath", diagnostics),
    "/sourcePath",
    diagnostics,
  );
  const markdown = requiredString(
    dataField(input, "markdown", diagnostics),
    "/markdown",
    diagnostics,
    true,
  );
  const route = optionalString(
    dataField(input, "route", diagnostics),
    "/route",
    diagnostics,
  );
  const routeAnchor = optionalString(
    dataField(input, "routeAnchor", diagnostics),
    "/routeAnchor",
    diagnostics,
  );
  const sectionMetadata = cloneMetadata(
    dataField(input, "sectionMetadata", diagnostics),
    diagnostics,
  );
  const adapter = validateAdapter(
    dataField(input, "adapter", diagnostics),
    diagnostics,
  );

  if (workId !== undefined) {
    validateStableId(workId, "/workId", diagnostics);
  }
  if (sectionId !== undefined) {
    validateContentId(sectionId, "/sectionId", diagnostics);
  }
  if (route !== undefined) {
    validateRoute(route, "/route", diagnostics);
  }
  if (routeAnchor !== undefined) {
    validateUrlFragment(routeAnchor, "/routeAnchor", diagnostics);
    if (route === undefined) {
      diagnostics.push(
        diagnostic(
          "markdown.route_anchor.without_route",
          "/routeAnchor",
          "A route anchor requires a route path.",
          {},
        ),
      );
    }
  }

  if (
    diagnostics.length > 0 ||
    workId === undefined ||
    sectionId === undefined ||
    title === undefined ||
    sourcePath === undefined ||
    markdown === undefined ||
    adapter === undefined
  ) {
    return invalidResult(diagnostics);
  }

  const normalizedMarkdown = normalizeTextNewlines(markdown);
  let root: ReturnType<typeof fromMarkdown>;
  try {
    root = fromMarkdown(normalizedMarkdown);
  } catch {
    return invalidResult([
      diagnostic(
        "markdown.parse_failed",
        "/markdown",
        "The Markdown source could not be parsed.",
        { reason: "parserRejectedInput" },
      ),
    ]);
  }

  const occurrenceByDigest = new Map<string, number>();
  const blocks: MarkdownBlockInput[] = [];
  for (const [index, node] of root.children.entries()) {
    const startOffset = node.position?.start.offset;
    const endOffset = node.position?.end.offset;
    if (startOffset === undefined || endOffset === undefined) {
      return immutableSnapshot({
        valid: false,
        diagnostics: [
          diagnostic(
            "markdown.position_missing",
            `/markdown/blocks/${index}`,
            "The Markdown parser did not provide an exact source range.",
            { index, nodeType: node.type },
          ),
        ],
      });
    }

    const markdown = normalizedMarkdown.slice(startOffset, endOffset);
    const digest = sha256(markdown);
    const occurrence = (occurrenceByDigest.get(digest) ?? 0) + 1;
    occurrenceByDigest.set(digest, occurrence);
    const hash = digest.slice("sha256:".length);
    const id =
      occurrence === 1
        ? `markdown-block-${hash}`
        : `markdown-block-${hash}-${occurrence}`;

    blocks.push({
      id,
      kind: blockKind(node.type),
      markdown,
      text: toString(node),
      provenance: {
        sourcePath,
        startOffset,
        endOffset,
      },
    });
  }

  const routes =
    route === undefined
      ? {}
      : {
          canonical: {
            path: route,
            ...(routeAnchor === undefined
              ? {}
              : { anchor: routeAnchor }),
          },
        };
  const section = {
    id: sectionId,
    role: "section",
    title,
    routes,
    activeRouteNames:
      route === undefined || routeAnchor !== undefined
        ? []
        : ["canonical"],
    continuity: {
      id: sectionId,
      legacyIds: [],
      progressGroups: [[sectionId]],
      historicalSectionIds: [],
    },
    navigable: true,
    blocks,
    ...(sectionMetadata === undefined
      ? {}
      : { metadata: sectionMetadata }),
  };

  const work = immutableSnapshot({
    workId,
    adapter,
    sections: [section],
  });
  const source = Object.freeze({
    path: sourcePath,
    role: "manuscript" as const,
    entityId: workId,
    mediaType: "text/markdown; charset=utf-8",
    contents: markdown,
    // Uint8Array instances cannot be frozen on supported Node runtimes. The
    // adapter still returns a detached copy, and the compiler copies it again
    // before hashing so later caller mutation cannot change an envelope.
    rawBytes: new TextEncoder().encode(markdown),
  });
  return Object.freeze({
    valid: true,
    value: Object.freeze({ source, work }),
    diagnostics: Object.freeze([]),
  });
}
