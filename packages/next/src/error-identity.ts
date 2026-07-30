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

import {
  REQUIRED_ATTRIBUTION,
} from "@genii-foundation/publisher-schema/attribution";
import {
  inspectAbsoluteHttpUrl,
  inspectCanonicalRoutePath,
} from "@genii-foundation/publisher-schema/routes";
import type {
  Diagnostic,
  ReaderPublicationIdentity,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import type {
  PublisherNextThemeInstance,
} from "./types.js";
import {
  validatePublisherNextThemeInstance,
} from "./theme/validation.js";

declare const validatedErrorIdentity: unique symbol;

export interface PublisherNextErrorIdentity {
  readonly [validatedErrorIdentity]: true;
  readonly homePath: string;
  readonly publication: {
    readonly title: string;
    readonly language: string;
    readonly attribution: typeof REQUIRED_ATTRIBUTION & {
      readonly sourceCodeUrl: string;
    };
  };
  readonly theme: PublisherNextThemeInstance;
}

export interface CreatePublisherNextErrorIdentityInput {
  readonly homePath: string;
  readonly publication: ReaderPublicationIdentity;
  readonly theme: PublisherNextThemeInstance;
}

interface InspectedRecord {
  readonly descriptors: Readonly<Record<string, PropertyDescriptor>>;
}

function diagnostic(
  path: string,
  message: string,
  issue: string,
): Diagnostic {
  return Object.freeze({
    code: "next.error_identity.invalid",
    severity: "error",
    path,
    message,
    keyword: "publicErrorIdentity",
    params: Object.freeze({ issue }),
  });
}

function failure(
  path: string,
  message: string,
  issue: string,
): ValidationResult<never> {
  return Object.freeze({
    valid: false,
    diagnostics: Object.freeze([
      diagnostic(path, message, issue),
    ]),
  });
}

function inspectRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): InspectedRecord | null {
  try {
    if (value === null || typeof value !== "object") {
      return null;
    }
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(
      value,
    ) as Record<string, PropertyDescriptor>;
    const allowedKeys = new Set([
      ...requiredKeys,
      ...optionalKeys,
    ]);
    if (
      Reflect.ownKeys(value).some(
        (key) =>
          typeof key !== "string" ||
          !allowedKeys.has(key),
      ) ||
      requiredKeys.some(
        (key) => !Object.hasOwn(descriptors, key),
      ) ||
      Object.values(descriptors).some(
        (descriptor) =>
          !descriptor.enumerable || !("value" in descriptor),
      )
    ) {
      return null;
    }
    return Object.freeze({
      descriptors: Object.freeze(descriptors),
    });
  } catch {
    return null;
  }
}

function valueOf(
  inspected: InspectedRecord,
  key: string,
): unknown {
  const descriptor = inspected.descriptors[key];
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

export function createPublisherNextErrorIdentity(
  input: unknown,
): ValidationResult<PublisherNextErrorIdentity> {
  const identity = inspectRecord(
    input,
    ["homePath", "publication", "theme"],
  );
  if (identity === null) {
    return failure(
      "",
      "The public error identity must use its closed data shape.",
      "identityShape",
    );
  }

  const homePath = inspectCanonicalRoutePath(
    valueOf(identity, "homePath"),
  );
  if (!homePath.valid) {
    return failure(
      "/homePath",
      "The public error identity requires one canonical home route.",
      homePath.issue,
    );
  }

  const publication = inspectRecord(
    valueOf(identity, "publication"),
    ["title", "language", "attribution"],
    ["canonicalUrl", "description", "id", "publisher"],
  );
  if (publication === null) {
    return failure(
      "/publication",
      "The public error publication identity must use its closed data shape.",
      "publicationShape",
    );
  }
  const title = valueOf(publication, "title");
  if (
    typeof title !== "string" ||
    title.length < 1 ||
    title.length > 512
  ) {
    return failure(
      "/publication/title",
      "The public error identity requires a bounded publication title.",
      "title",
    );
  }
  const language = valueOf(publication, "language");
  if (
    typeof language !== "string" ||
    !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(language)
  ) {
    return failure(
      "/publication/language",
      "The public error identity requires a valid publication language.",
      "language",
    );
  }

  const attribution = inspectRecord(
    valueOf(publication, "attribution"),
    [
      "placement",
      "copyright",
      "text",
      "url",
      "sourceCodeUrl",
    ],
  );
  if (attribution === null) {
    return failure(
      "/publication/attribution",
      "The public error identity requires the complete attribution contract.",
      "attributionShape",
    );
  }
  for (const [key, expected] of Object.entries(
    REQUIRED_ATTRIBUTION,
  )) {
    if (valueOf(attribution, key) !== expected) {
      return failure(
        `/publication/attribution/${key}`,
        "The renderer-owned GENII Publisher attribution cannot be changed.",
        "fixedAttribution",
      );
    }
  }
  const sourceCodeUrl = inspectAbsoluteHttpUrl(
    valueOf(attribution, "sourceCodeUrl"),
  );
  if (!sourceCodeUrl.valid) {
    return failure(
      "/publication/attribution/sourceCodeUrl",
      "The public error identity requires an absolute HTTP publication source URL.",
      sourceCodeUrl.issue,
    );
  }

  const theme = validatePublisherNextThemeInstance(
    valueOf(identity, "theme"),
  );
  if (!theme.valid) {
    return theme;
  }

  const value = Object.freeze({
    homePath: homePath.value,
    publication: Object.freeze({
      title,
      language,
      attribution: Object.freeze({
        ...REQUIRED_ATTRIBUTION,
        sourceCodeUrl: sourceCodeUrl.value,
      }),
    }),
    theme: theme.value,
  }) as PublisherNextErrorIdentity;
  return Object.freeze({
    valid: true,
    value,
    diagnostics: Object.freeze([]),
  });
}
