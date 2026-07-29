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

import { immutableSnapshot } from "./immutability.js";
import type {
  Diagnostic,
  JSONValue,
  ValidationResult,
} from "./types.js";

export interface StrictJsonLimits {
  readonly maximumCodeUnits: number;
  readonly maximumDepth: number;
  readonly maximumTokens: number;
}

export const STRICT_JSON_LIMITS = Object.freeze<StrictJsonLimits>({
  maximumCodeUnits: 1024 * 1024,
  maximumDepth: 128,
  maximumTokens: 100_000,
});

export const STRICT_JSON_DIAGNOSTIC_CODES = Object.freeze({
  depthExceeded: "json.depth_exceeded",
  duplicateMember: "json.duplicate_member",
  inputType: "json.input_type",
  invalid: "json.invalid",
  numberOutOfRange: "json.number_out_of_range",
  sizeExceeded: "json.size_exceeded",
  tokenLimitExceeded: "json.token_limit_exceeded",
  unpairedSurrogate: "json.unpaired_surrogate",
});

function escapeJsonPointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function appendJsonPointerToken(path: string, token: string): string {
  return `${path}/${escapeJsonPointerToken(token)}`;
}

function jsonDiagnostic(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>>,
): Diagnostic {
  return {
    code,
    severity: "error",
    path,
    message,
    keyword,
    params,
  };
}

class StrictJsonFailure {
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    this.diagnostic = diagnostic;
  }
}

function invalidResult(
  diagnostic: Diagnostic,
): ValidationResult<JSONValue> {
  return immutableSnapshot({
    valid: false as const,
    diagnostics: [diagnostic],
  });
}

function isJsonWhitespace(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    code === 0x20
  );
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function hexValue(code: number): number | undefined {
  if (code >= 0x30 && code <= 0x39) {
    return code - 0x30;
  }
  if (code >= 0x41 && code <= 0x46) {
    return code - 0x41 + 10;
  }
  if (code >= 0x61 && code <= 0x66) {
    return code - 0x61 + 10;
  }
  return undefined;
}

class StrictJsonParser {
  private index = 0;
  private tokenCount = 0;

  constructor(private readonly source: string) {}

  parse(): JSONValue {
    this.skipWhitespace();
    if (this.index === this.source.length) {
      this.failInvalid("", "emptyDocument", this.index);
    }
    const value = this.parseValue(0, "");
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      this.failInvalid("", "unexpectedTrailingContent", this.index);
    }
    return value;
  }

  private skipWhitespace(): void {
    while (
      this.index < this.source.length &&
      isJsonWhitespace(this.source.charCodeAt(this.index))
    ) {
      this.index += 1;
    }
  }

  private consumeToken(
    path: string,
    kind: "container" | "memberName" | "scalar",
    offset: number,
  ): void {
    this.tokenCount += 1;
    if (this.tokenCount > STRICT_JSON_LIMITS.maximumTokens) {
      throw new StrictJsonFailure(
        jsonDiagnostic(
          STRICT_JSON_DIAGNOSTIC_CODES.tokenLimitExceeded,
          path,
          "The JSON document contains more tokens than the fixed parser limit.",
          "maximumTokens",
          {
            kind,
            maximumTokens: STRICT_JSON_LIMITS.maximumTokens,
            offset,
          },
        ),
      );
    }
  }

  private assertContainerDepth(path: string, depth: number): void {
    if (depth > STRICT_JSON_LIMITS.maximumDepth) {
      throw new StrictJsonFailure(
        jsonDiagnostic(
          STRICT_JSON_DIAGNOSTIC_CODES.depthExceeded,
          path,
          "The JSON document is nested more deeply than the fixed parser limit.",
          "maximumDepth",
          {
            maximumDepth: STRICT_JSON_LIMITS.maximumDepth,
            offset: this.index,
          },
        ),
      );
    }
  }

  private parseValue(containerDepth: number, path: string): JSONValue {
    this.skipWhitespace();
    const offset = this.index;
    const code = this.source.charCodeAt(this.index);

    if (code === 0x7b) {
      this.consumeToken(path, "container", offset);
      this.assertContainerDepth(path, containerDepth + 1);
      return this.parseObject(containerDepth + 1, path);
    }
    if (code === 0x5b) {
      this.consumeToken(path, "container", offset);
      this.assertContainerDepth(path, containerDepth + 1);
      return this.parseArray(containerDepth + 1, path);
    }
    if (code === 0x22) {
      this.consumeToken(path, "scalar", offset);
      return this.parseString(path);
    }
    if (code === 0x74) {
      this.consumeToken(path, "scalar", offset);
      this.parseLiteral("true", path);
      return true;
    }
    if (code === 0x66) {
      this.consumeToken(path, "scalar", offset);
      this.parseLiteral("false", path);
      return false;
    }
    if (code === 0x6e) {
      this.consumeToken(path, "scalar", offset);
      this.parseLiteral("null", path);
      return null;
    }
    if (code === 0x2d || isDigit(code)) {
      this.consumeToken(path, "scalar", offset);
      return this.parseNumber(path);
    }

    this.failInvalid(path, "expectedValue", offset);
  }

  private parseObject(
    containerDepth: number,
    path: string,
  ): Readonly<Record<string, JSONValue>> {
    const result: Record<string, JSONValue> = {};
    const memberOffsets = new Map<string, number>();
    this.index += 1;
    this.skipWhitespace();
    if (this.source.charCodeAt(this.index) === 0x7d) {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      if (this.source.charCodeAt(this.index) !== 0x22) {
        this.failInvalid(path, "expectedObjectMember", this.index);
      }
      const memberOffset = this.index;
      this.consumeToken(path, "memberName", memberOffset);
      const memberName = this.parseString(path);
      const memberPath = appendJsonPointerToken(path, memberName);
      const firstOffset = memberOffsets.get(memberName);
      if (firstOffset !== undefined) {
        throw new StrictJsonFailure(
          jsonDiagnostic(
            STRICT_JSON_DIAGNOSTIC_CODES.duplicateMember,
            memberPath,
            "A JSON object member name appears more than once.",
            "uniqueObjectMember",
            {
              duplicateOffset: memberOffset,
              firstOffset,
            },
          ),
        );
      }
      memberOffsets.set(memberName, memberOffset);

      this.skipWhitespace();
      if (this.source.charCodeAt(this.index) !== 0x3a) {
        this.failInvalid(memberPath, "expectedColon", this.index);
      }
      this.index += 1;
      const value = this.parseValue(containerDepth, memberPath);
      Object.defineProperty(result, memberName, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });

      this.skipWhitespace();
      const delimiter = this.source.charCodeAt(this.index);
      if (delimiter === 0x7d) {
        this.index += 1;
        return result;
      }
      if (delimiter !== 0x2c) {
        this.failInvalid(path, "expectedObjectDelimiter", this.index);
      }
      this.index += 1;
      this.skipWhitespace();
    }

    this.failInvalid(path, "unterminatedObject", this.index);
  }

  private parseArray(
    containerDepth: number,
    path: string,
  ): readonly JSONValue[] {
    const result: JSONValue[] = [];
    this.index += 1;
    this.skipWhitespace();
    if (this.source.charCodeAt(this.index) === 0x5d) {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      result.push(
        this.parseValue(
          containerDepth,
          appendJsonPointerToken(path, String(result.length)),
        ),
      );
      this.skipWhitespace();
      const delimiter = this.source.charCodeAt(this.index);
      if (delimiter === 0x5d) {
        this.index += 1;
        return result;
      }
      if (delimiter !== 0x2c) {
        this.failInvalid(path, "expectedArrayDelimiter", this.index);
      }
      this.index += 1;
      this.skipWhitespace();
    }

    this.failInvalid(path, "unterminatedArray", this.index);
  }

  private parseString(path: string): string {
    this.index += 1;
    let segmentStart = this.index;
    const segments: string[] = [];

    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code === 0x22) {
        const finalSegment = this.source.slice(
          segmentStart,
          this.index,
        );
        this.index += 1;
        let value = finalSegment;
        if (segments.length > 0) {
          segments.push(finalSegment);
          value = segments.join("");
        }
        this.assertWellFormedString(value, path);
        return value;
      }
      if (code < 0x20) {
        this.failInvalid(
          path,
          "unescapedControlCharacter",
          this.index,
        );
      }
      if (code !== 0x5c) {
        this.index += 1;
        continue;
      }

      segments.push(this.source.slice(segmentStart, this.index));
      const escapeOffset = this.index;
      this.index += 1;
      const escapeCode = this.source.charCodeAt(this.index);
      if (escapeCode === 0x22) {
        segments.push("\"");
        this.index += 1;
      } else if (escapeCode === 0x5c) {
        segments.push("\\");
        this.index += 1;
      } else if (escapeCode === 0x2f) {
        segments.push("/");
        this.index += 1;
      } else if (escapeCode === 0x62) {
        segments.push("\b");
        this.index += 1;
      } else if (escapeCode === 0x66) {
        segments.push("\f");
        this.index += 1;
      } else if (escapeCode === 0x6e) {
        segments.push("\n");
        this.index += 1;
      } else if (escapeCode === 0x72) {
        segments.push("\r");
        this.index += 1;
      } else if (escapeCode === 0x74) {
        segments.push("\t");
        this.index += 1;
      } else if (escapeCode === 0x75) {
        let decodedCodeUnit = 0;
        for (let digitIndex = 1; digitIndex <= 4; digitIndex += 1) {
          const value = hexValue(
            this.source.charCodeAt(this.index + digitIndex),
          );
          if (value === undefined) {
            this.failInvalid(
              path,
              "invalidUnicodeEscape",
              escapeOffset,
            );
          }
          decodedCodeUnit = decodedCodeUnit * 16 + value;
        }
        segments.push(String.fromCharCode(decodedCodeUnit));
        this.index += 5;
      } else {
        this.failInvalid(path, "invalidEscape", escapeOffset);
      }
      segmentStart = this.index;
    }

    this.failInvalid(path, "unterminatedString", this.index);
  }

  private assertWellFormedString(value: string, path: string): void {
    for (
      let decodedCodeUnitOffset = 0;
      decodedCodeUnitOffset < value.length;
      decodedCodeUnitOffset += 1
    ) {
      const code = value.charCodeAt(decodedCodeUnitOffset);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(decodedCodeUnitOffset + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          decodedCodeUnitOffset += 1;
          continue;
        }
        throw new StrictJsonFailure(
          jsonDiagnostic(
            STRICT_JSON_DIAGNOSTIC_CODES.unpairedSurrogate,
            path,
            "A JSON string contains an unpaired UTF-16 surrogate.",
            "wellFormedUnicode",
            {
              decodedCodeUnitOffset,
              surrogateKind: "high",
            },
          ),
        );
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        throw new StrictJsonFailure(
          jsonDiagnostic(
            STRICT_JSON_DIAGNOSTIC_CODES.unpairedSurrogate,
            path,
            "A JSON string contains an unpaired UTF-16 surrogate.",
            "wellFormedUnicode",
            {
              decodedCodeUnitOffset,
              surrogateKind: "low",
            },
          ),
        );
      }
    }
  }

  private parseLiteral(literal: string, path: string): void {
    if (!this.source.startsWith(literal, this.index)) {
      this.failInvalid(path, "invalidLiteral", this.index);
    }
    this.index += literal.length;
  }

  private parseNumber(path: string): number {
    const start = this.index;
    if (this.source.charCodeAt(this.index) === 0x2d) {
      this.index += 1;
    }

    const firstDigit = this.source.charCodeAt(this.index);
    if (firstDigit === 0x30) {
      this.index += 1;
      if (isDigit(this.source.charCodeAt(this.index))) {
        this.failInvalid(path, "leadingZero", this.index);
      }
    } else if (firstDigit >= 0x31 && firstDigit <= 0x39) {
      this.index += 1;
      while (isDigit(this.source.charCodeAt(this.index))) {
        this.index += 1;
      }
    } else {
      this.failInvalid(path, "expectedNumberDigit", this.index);
    }

    if (this.source.charCodeAt(this.index) === 0x2e) {
      this.index += 1;
      if (!isDigit(this.source.charCodeAt(this.index))) {
        this.failInvalid(path, "expectedFractionDigit", this.index);
      }
      while (isDigit(this.source.charCodeAt(this.index))) {
        this.index += 1;
      }
    }

    const exponent = this.source.charCodeAt(this.index);
    if (exponent === 0x45 || exponent === 0x65) {
      this.index += 1;
      const exponentSign = this.source.charCodeAt(this.index);
      if (exponentSign === 0x2b || exponentSign === 0x2d) {
        this.index += 1;
      }
      if (!isDigit(this.source.charCodeAt(this.index))) {
        this.failInvalid(path, "expectedExponentDigit", this.index);
      }
      while (isDigit(this.source.charCodeAt(this.index))) {
        this.index += 1;
      }
    }

    const value = Number(this.source.slice(start, this.index));
    if (!Number.isFinite(value)) {
      throw new StrictJsonFailure(
        jsonDiagnostic(
          STRICT_JSON_DIAGNOSTIC_CODES.numberOutOfRange,
          path,
          "A JSON number is outside the finite numeric range supported by the protocol.",
          "finiteNumber",
          { offset: start },
        ),
      );
    }
    return value;
  }

  private failInvalid(
    path: string,
    reason: string,
    offset: number,
  ): never {
    throw new StrictJsonFailure(
      jsonDiagnostic(
        STRICT_JSON_DIAGNOSTIC_CODES.invalid,
        path,
        "The document is not valid JSON.",
        "jsonSyntax",
        { offset, reason },
      ),
    );
  }
}

/**
 * Parses one bounded JSON document and rejects duplicate object member names
 * after escape decoding. The fixed limits make raw protocol ingestion
 * deterministic even when callers do not use the filesystem loader.
 */
export function parseJsonWithUniqueObjectKeys(
  input: unknown,
): ValidationResult<JSONValue> {
  if (typeof input !== "string") {
    return invalidResult(
      jsonDiagnostic(
        STRICT_JSON_DIAGNOSTIC_CODES.inputType,
        "",
        "A JSON document must be supplied as text.",
        "type",
        {
          actualType: input === null ? "null" : typeof input,
          expectedType: "string",
        },
      ),
    );
  }
  if (input.length > STRICT_JSON_LIMITS.maximumCodeUnits) {
    return invalidResult(
      jsonDiagnostic(
        STRICT_JSON_DIAGNOSTIC_CODES.sizeExceeded,
        "",
        "The JSON document exceeds the fixed parser size limit.",
        "maximumCodeUnits",
        {
          actualCodeUnits: input.length,
          maximumCodeUnits: STRICT_JSON_LIMITS.maximumCodeUnits,
        },
      ),
    );
  }

  try {
    const value = new StrictJsonParser(input).parse();
    return immutableSnapshot({
      valid: true as const,
      value,
      diagnostics: [] as readonly Diagnostic[],
    });
  } catch (error) {
    if (error instanceof StrictJsonFailure) {
      return invalidResult(error.diagnostic);
    }
    return invalidResult(
      jsonDiagnostic(
        STRICT_JSON_DIAGNOSTIC_CODES.invalid,
        "",
        "The document could not be parsed safely as JSON.",
        "jsonSyntax",
        { reason: "parserFailure" },
      ),
    );
  }
}
