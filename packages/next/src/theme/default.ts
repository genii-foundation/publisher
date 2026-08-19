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

import {
  PUBLISHER_NEXT_THEME_API_VERSION,
  PUBLISHER_NEXT_VERSION,
} from "../types.js";
import type {
  PublisherNextJsonObject,
  PublisherNextTheme,
  PublisherNextThemeInstance,
  PublisherNextThemeTokens,
  ResolvedPublisherNextTheme,
} from "../types.js";
import {
  validatePublisherNextThemeInstance,
} from "./validation.js";

const LIGHT_TOKENS: PublisherNextThemeTokens = Object.freeze({
  color: Object.freeze({
    canvas: "#F5F7F4",
    surface: "#FCFDFB",
    text: "#162225",
    mutedText: "#526166",
    accent: "#18586C",
    focus: "#9A4E00",
    border: "#C8D0CF",
  }),
  typography: Object.freeze({
    bodyFamily:
      "Charter, Bitstream Charter, Sitka Text, Cambria, serif",
    headingFamily:
      "Avenir Next, Avenir, Segoe UI, Helvetica Neue, sans-serif",
    monoFamily:
      "SFMono-Regular, Consolas, Liberation Mono, monospace",
    baseSize: "1.0625rem",
    lineHeight: 1.72,
    defaultReaderFontFamilyId: "serif",
    readerFontFamilies: Object.freeze([
      Object.freeze({
        id: "serif",
        label: "Serif",
        family:
          "Charter, Bitstream Charter, Sitka Text, Cambria, serif",
      }),
      Object.freeze({
        id: "sans-serif",
        label: "Sans serif",
        family:
          "Avenir Next, Avenir, Segoe UI, Helvetica Neue, sans-serif",
      }),
    ]),
  }),
  layout: Object.freeze({
    readingMeasure: "68ch",
    pageGutter: "1.25rem",
    sectionGap: "3rem",
    controlRadius: "0.375rem",
  }),
});

const DARK_TOKENS: PublisherNextThemeTokens = Object.freeze({
  color: Object.freeze({
    canvas: "#11191B",
    surface: "#182326",
    text: "#F1F4EF",
    mutedText: "#B8C3C4",
    accent: "#86D0E0",
    focus: "#F0AE54",
    border: "#3D5055",
  }),
  typography: LIGHT_TOKENS.typography,
  layout: LIGHT_TOKENS.layout,
});

function invalidConfig(message: string): ValidationResult<never> {
  const item: Diagnostic = Object.freeze({
    code: "next.theme.default_config.invalid",
    severity: "error",
    path: "/theme/config",
    message,
    keyword: "properties",
    params: Object.freeze({}),
  });
  return Object.freeze({
    valid: false,
    diagnostics: Object.freeze([item]),
  });
}

function configureDefaultTheme(
  config: PublisherNextJsonObject,
): ValidationResult<PublisherNextThemeInstance> {
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    if (
      config === null ||
      typeof config !== "object" ||
      (Object.getPrototypeOf(config) !== Object.prototype &&
        Object.getPrototypeOf(config) !== null) ||
      Object.getOwnPropertySymbols(config).length > 0
    ) {
      return invalidConfig(
        "The default theme configuration must be one plain data object.",
      );
    }
    descriptors = Object.getOwnPropertyDescriptors(config);
  } catch {
    return invalidConfig(
      "The default theme configuration could not be safely inspected.",
    );
  }
  const keys = Object.keys(descriptors).sort();
  if (
    keys.some((key) => key !== "accent" && key !== "mode") ||
    keys.some((key) => {
      const descriptor = descriptors[key];
      return (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    return invalidConfig(
      "The default theme accepts only mode and accent.",
    );
  }
  const mode = descriptors.mode?.value ?? "light";
  if (mode !== "light" && mode !== "dark") {
    return invalidConfig(
      "The default theme mode must be light or dark.",
    );
  }
  const base = mode === "dark" ? DARK_TOKENS : LIGHT_TOKENS;
  const accent = descriptors.accent?.value ?? base.color.accent;
  if (typeof accent !== "string") {
    return invalidConfig(
      "The default theme accent must be a color string.",
    );
  }
  return validatePublisherNextThemeInstance({
    tokens: {
      ...base,
      color: {
        ...base.color,
        accent,
      },
    },
  });
}

export const defaultPublisherNextTheme: PublisherNextTheme =
  Object.freeze({
    kind: "genii.publisher.next-theme",
    apiVersion: PUBLISHER_NEXT_THEME_API_VERSION,
    configure: configureDefaultTheme,
  });

export function resolveDefaultPublisherNextTheme(
  config: PublisherNextJsonObject = Object.freeze({}),
): ResolvedPublisherNextTheme {
  return Object.freeze({
    package: "@genii-foundation/publisher-next",
    version: PUBLISHER_NEXT_VERSION,
    rendererCompatibility:
      ">=0.1.0-alpha.0 <0.2.0",
    config,
    implementation: defaultPublisherNextTheme,
  });
}
