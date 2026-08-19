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
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import type {
  PublisherNextReaderFontFamily,
  PublisherNextThemeInstance,
  PublisherNextThemeTokens,
} from "../types.js";

const COLOR = /^#[0-9A-Fa-f]{6}$/u;
const FONT_FAMILY = /^[^;{}\\\u0000-\u001f\u007f]{1,160}$/u;
const DIMENSION =
  /^(?:0|[0-9]+(?:\.[0-9]+)?)(?:ch|px|rem)$/u;
const BASE_SIZE =
  /^(?:0|[0-9]+(?:\.[0-9]+)?)(?:px|rem)$/u;
const READER_FONT_ID =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const READER_FONT_LABEL = /^[^\u0000-\u001f\u007f]{1,80}$/u;
const DANGEROUS_READER_FONT_IDS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const MAXIMUM_READER_FONT_FAMILIES = 8;

function diagnostic(
  code: string,
  path: string,
  message: string,
  keyword: string,
  params: Readonly<Record<string, unknown>> = {},
): Diagnostic {
  return Object.freeze({
    code,
    severity: "error",
    path,
    message,
    keyword,
    params: Object.freeze({ ...params }),
  });
}

function plainDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
):
  | {
      readonly valid: true;
      readonly descriptors: Readonly<
        Record<string, PropertyDescriptor>
      >;
    }
  | {
      readonly valid: false;
      readonly issue: string;
    } {
  try {
    if (
      value === null ||
      typeof value !== "object" ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    ) {
      return { valid: false, issue: "type" };
    }
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length > 0) {
      return { valid: false, issue: "symbol" };
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    const expected = [...requiredKeys].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected)) {
      return { valid: false, issue: "properties" };
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return { valid: false, issue: "descriptor" };
      }
    }
    return {
      valid: true,
      descriptors: Object.freeze(descriptors),
    };
  } catch {
    return { valid: false, issue: "uninspectable" };
  }
}

function descriptorValue(
  descriptors: Readonly<Record<string, PropertyDescriptor>>,
  key: string,
): unknown {
  return descriptors[key]?.value;
}

function plainDataArray(
  value: unknown,
  maximumLength: number,
):
  | { readonly valid: true; readonly values: readonly unknown[] }
  | { readonly valid: false; readonly issue: string } {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      return { valid: false, issue: "type" };
    }
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      string,
      PropertyDescriptor
    >;
    const lengthDescriptor = descriptors.length;
    const lengthValue = lengthDescriptor?.value;
    if (
      lengthDescriptor === undefined ||
      typeof lengthValue !== "number" ||
      !Number.isSafeInteger(lengthValue) ||
      lengthValue < 1 ||
      lengthValue > maximumLength
    ) {
      return { valid: false, issue: "length" };
    }
    const length = lengthValue;
    const expectedKeys = [
      ...Array.from({ length }, (_, index) => String(index)),
      "length",
    ].sort();
    if (
      JSON.stringify(Object.keys(descriptors).sort()) !==
      JSON.stringify(expectedKeys)
    ) {
      return { valid: false, issue: "properties" };
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return { valid: false, issue: "descriptor" };
      }
      values.push(descriptor.value);
    }
    return { valid: true, values: Object.freeze(values) };
  } catch {
    return { valid: false, issue: "uninspectable" };
  }
}

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return (
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue)
  );
}

function contrast(left: string, right: string): number {
  const [lighter, darker] = [
    luminance(left),
    luminance(right),
  ].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function dimensionNumber(value: string): number {
  return Number.parseFloat(value);
}

function isValidBaseSize(value: string): boolean {
  if (!BASE_SIZE.test(value)) {
    return false;
  }
  const number = dimensionNumber(value);
  return value.endsWith("rem")
    ? number >= 0.75 && number <= 2
    : number >= 12 && number <= 32;
}

function isValidLayoutDimension(
  key: string,
  value: string,
): boolean {
  if (!DIMENSION.test(value)) {
    return false;
  }
  const number = dimensionNumber(value);
  if (key === "readingMeasure") {
    return (
      (value.endsWith("ch") && number >= 40 && number <= 100) ||
      (value.endsWith("rem") && number >= 35 && number <= 75) ||
      (value.endsWith("px") && number >= 560 && number <= 1200)
    );
  }
  if (key === "pageGutter") {
    return (
      (value.endsWith("rem") && number >= 0.5 && number <= 4) ||
      (value.endsWith("px") && number >= 8 && number <= 64)
    );
  }
  if (key === "sectionGap") {
    return (
      (value.endsWith("rem") && number >= 1 && number <= 8) ||
      (value.endsWith("px") && number >= 16 && number <= 128)
    );
  }
  return (
    key === "controlRadius" &&
    ((value.endsWith("rem") && number >= 0 && number <= 2) ||
      (value.endsWith("px") && number >= 0 && number <= 32))
  );
}

export function validatePublisherNextThemeInstance(
  value: unknown,
): ValidationResult<PublisherNextThemeInstance> {
  const instance = plainDataRecord(value, ["tokens"]);
  if (!instance.valid) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.theme.instance.invalid",
          "/theme",
          "A theme must return one plain data object containing only tokens.",
          instance.issue,
        ),
      ]),
    });
  }
  const tokensValue = descriptorValue(
    instance.descriptors,
    "tokens",
  );
  const tokens = plainDataRecord(tokensValue, [
    "color",
    "layout",
    "typography",
  ]);
  if (!tokens.valid) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.theme.tokens.invalid",
          "/theme/tokens",
          "Theme tokens must use the complete closed token contract.",
          tokens.issue,
        ),
      ]),
    });
  }

  const colorValue = descriptorValue(tokens.descriptors, "color");
  const typographyValue = descriptorValue(
    tokens.descriptors,
    "typography",
  );
  const layoutValue = descriptorValue(tokens.descriptors, "layout");
  const colors = plainDataRecord(colorValue, [
    "accent",
    "border",
    "canvas",
    "focus",
    "mutedText",
    "surface",
    "text",
  ]);
  const typography = plainDataRecord(typographyValue, [
    "baseSize",
    "bodyFamily",
    "defaultReaderFontFamilyId",
    "headingFamily",
    "lineHeight",
    "monoFamily",
    "readerFontFamilies",
  ]);
  const layout = plainDataRecord(layoutValue, [
    "controlRadius",
    "pageGutter",
    "readingMeasure",
    "sectionGap",
  ]);
  if (!colors.valid || !typography.valid || !layout.valid) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.theme.token_group.invalid",
          "/theme/tokens",
          "Every theme token group must use its complete closed shape.",
          "properties",
        ),
      ]),
    });
  }

  const colorEntries = Object.fromEntries(
    Object.keys(colors.descriptors).map((key) => [
      key,
      descriptorValue(colors.descriptors, key),
    ]),
  );
  for (const [key, color] of Object.entries(colorEntries)) {
    if (typeof color !== "string" || !COLOR.test(color)) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.theme.color.invalid",
            `/theme/tokens/color/${key}`,
            "Theme colors must be opaque six-digit hexadecimal values.",
            "pattern",
            { value: color },
          ),
        ]),
      });
    }
  }

  const canvas = colorEntries.canvas as string;
  for (const [key, minimum] of [
    ["text", 4.5],
    ["mutedText", 4.5],
    ["accent", 4.5],
    ["focus", 3],
  ] as const) {
    const ratio = contrast(canvas, colorEntries[key] as string);
    if (ratio < minimum) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.theme.color.contrast",
            `/theme/tokens/color/${key}`,
            "Theme colors must preserve readable contrast against the canvas.",
            "contrast",
            { minimum, ratio },
          ),
        ]),
      });
    }
  }
  if (
    contrast(
      colorEntries.surface as string,
      colorEntries.text as string,
    ) < 4.5
  ) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.theme.surface.contrast",
          "/theme/tokens/color/surface",
          "The theme surface must preserve readable text contrast.",
          "contrast",
          { minimum: 4.5 },
        ),
      ]),
    });
  }
  const surface = colorEntries.surface as string;
  for (const [key, minimum] of [
    ["mutedText", 4.5],
    ["accent", 4.5],
    ["focus", 3],
  ] as const) {
    const ratio = contrast(surface, colorEntries[key] as string);
    if (ratio < minimum) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.theme.surface_color.contrast",
            `/theme/tokens/color/${key}`,
            "Theme colors used on surfaces must preserve visible contrast.",
            "contrast",
            {
              background: "surface",
              minimum,
              ratio,
            },
          ),
        ]),
      });
    }
  }

  const bodyFamily = descriptorValue(
    typography.descriptors,
    "bodyFamily",
  );
  const headingFamily = descriptorValue(
    typography.descriptors,
    "headingFamily",
  );
  const monoFamily = descriptorValue(
    typography.descriptors,
    "monoFamily",
  );
  for (const [key, family] of [
    ["bodyFamily", bodyFamily],
    ["headingFamily", headingFamily],
    ["monoFamily", monoFamily],
  ] as const) {
    if (typeof family !== "string" || !FONT_FAMILY.test(family)) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.theme.font.invalid",
            `/theme/tokens/typography/${key}`,
            "Font stacks must be bounded CSS family values without control or declaration characters.",
            "pattern",
          ),
        ]),
      });
    }
  }

  const defaultReaderFontFamilyId = descriptorValue(
    typography.descriptors,
    "defaultReaderFontFamilyId",
  );
  const readerFontFamiliesValue = descriptorValue(
    typography.descriptors,
    "readerFontFamilies",
  );
  const readerFontFamilyArray = plainDataArray(
    readerFontFamiliesValue,
    MAXIMUM_READER_FONT_FAMILIES,
  );
  if (!readerFontFamilyArray.valid) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.theme.reader_fonts.invalid",
          "/theme/tokens/typography/readerFontFamilies",
          "Reader font choices must be one bounded dense plain data array.",
          readerFontFamilyArray.issue,
        ),
      ]),
    });
  }
  const readerFontFamilies: PublisherNextReaderFontFamily[] = [];
  const readerFontIds = new Set<string>();
  for (const [index, candidate] of readerFontFamilyArray.values.entries()) {
    const inspected = plainDataRecord(candidate, [
      "family",
      "id",
      "label",
    ]);
    if (!inspected.valid) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.theme.reader_font.invalid",
            `/theme/tokens/typography/readerFontFamilies/${index}`,
            "Every Reader font choice must use the complete closed data shape.",
            inspected.issue,
          ),
        ]),
      });
    }
    const id = descriptorValue(inspected.descriptors, "id");
    const label = descriptorValue(inspected.descriptors, "label");
    const family = descriptorValue(inspected.descriptors, "family");
    if (
      typeof id !== "string" ||
      id.length > 128 ||
      !READER_FONT_ID.test(id) ||
      DANGEROUS_READER_FONT_IDS.has(id) ||
      readerFontIds.has(id)
    ) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.theme.reader_font_id.invalid",
            `/theme/tokens/typography/readerFontFamilies/${index}/id`,
            "Reader font IDs must be unique portable stable identifiers.",
            "identity",
          ),
        ]),
      });
    }
    if (
      typeof label !== "string" ||
      label !== label.trim() ||
      !READER_FONT_LABEL.test(label)
    ) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.theme.reader_font_label.invalid",
            `/theme/tokens/typography/readerFontFamilies/${index}/label`,
            "Reader font labels must be bounded visible text.",
            "pattern",
          ),
        ]),
      });
    }
    if (typeof family !== "string" || !FONT_FAMILY.test(family)) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.theme.reader_font_family.invalid",
            `/theme/tokens/typography/readerFontFamilies/${index}/family`,
            "Reader font stacks must be bounded CSS family values without control or declaration characters.",
            "pattern",
          ),
        ]),
      });
    }
    readerFontIds.add(id);
    readerFontFamilies.push(Object.freeze({ id, label, family }));
  }
  if (
    !readerFontIds.has("serif") ||
    typeof defaultReaderFontFamilyId !== "string" ||
    !readerFontIds.has(defaultReaderFontFamilyId)
  ) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.theme.reader_font_default.invalid",
          "/theme/tokens/typography/defaultReaderFontFamilyId",
          "Reader font choices must include serif and name one declared default.",
          "identity",
        ),
      ]),
    });
  }

  const baseSize = descriptorValue(
    typography.descriptors,
    "baseSize",
  );
  const lineHeight = descriptorValue(
    typography.descriptors,
    "lineHeight",
  );
  if (
    typeof baseSize !== "string" ||
    !isValidBaseSize(baseSize)
  ) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.theme.base_size.invalid",
          "/theme/tokens/typography/baseSize",
          "The base size must be a bounded rem or pixel dimension.",
          "range",
        ),
      ]),
    });
  }
  if (
    typeof lineHeight !== "number" ||
    !Number.isFinite(lineHeight) ||
    lineHeight < 1.2 ||
    lineHeight > 2.2
  ) {
    return Object.freeze({
      valid: false,
      diagnostics: Object.freeze([
        diagnostic(
          "next.theme.line_height.invalid",
          "/theme/tokens/typography/lineHeight",
          "The line height must be between 1.2 and 2.2.",
          "range",
        ),
      ]),
    });
  }

  const dimensions = Object.fromEntries(
    Object.keys(layout.descriptors).map((key) => [
      key,
      descriptorValue(layout.descriptors, key),
    ]),
  );
  for (const [key, dimension] of Object.entries(dimensions)) {
    if (
      typeof dimension !== "string" ||
      !isValidLayoutDimension(key, dimension)
    ) {
      return Object.freeze({
        valid: false,
        diagnostics: Object.freeze([
          diagnostic(
            "next.theme.dimension.invalid",
            `/theme/tokens/layout/${key}`,
            "Layout tokens must be bounded pixel, rem, or character dimensions.",
            "range",
          ),
        ]),
      });
    }
  }

  const snapshot: PublisherNextThemeTokens = Object.freeze({
    color: Object.freeze({
      canvas,
      surface: colorEntries.surface as string,
      text: colorEntries.text as string,
      mutedText: colorEntries.mutedText as string,
      accent: colorEntries.accent as string,
      focus: colorEntries.focus as string,
      border: colorEntries.border as string,
    }),
    typography: Object.freeze({
      bodyFamily: bodyFamily as string,
      headingFamily: headingFamily as string,
      monoFamily: monoFamily as string,
      baseSize,
      lineHeight,
      defaultReaderFontFamilyId,
      readerFontFamilies: Object.freeze(readerFontFamilies),
    }),
    layout: Object.freeze({
      readingMeasure: dimensions.readingMeasure as string,
      pageGutter: dimensions.pageGutter as string,
      sectionGap: dimensions.sectionGap as string,
      controlRadius: dimensions.controlRadius as string,
    }),
  });

  return Object.freeze({
    valid: true,
    value: Object.freeze({ tokens: snapshot }),
    diagnostics: Object.freeze([]),
  });
}
