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
  compilePublicationContent,
} from "@genii-foundation/publisher-content";
import type {
  CompilePublicationContentInput,
} from "@genii-foundation/publisher-content";
import type {
  PublicationContentEnvelope,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import {
  PUBLISHER_VERSION,
} from "../index.js";
import {
  invalidResult,
  loaderDiagnostic,
} from "./diagnostics.js";
import {
  isTrustedLoadedPublicationSnapshot,
} from "./loader.js";
import type {
  LoadedPublicationCompilationSources,
} from "./types.js";

export type CompileLoadedPublicationContentInput = Readonly<{
  loaded: LoadedPublicationCompilationSources;
}> &
  Pick<
    CompilePublicationContentInput,
    "extensions" | "links" | "wordsPerMinute" | "works"
  >;

const requiredInputKeys = Object.freeze([
  "loaded",
  "works",
] as const);
const allowedInputKeys = new Set<string>([
  ...requiredInputKeys,
  "extensions",
  "links",
  "wordsPerMinute",
]);

function inputDiagnostic(
  path: string,
  message: string,
  reason: string,
): ValidationResult<PublicationContentEnvelope> {
  return invalidResult([
    loaderDiagnostic(
      "publisher.compile_input.invalid",
      path,
      message,
      "inputShape",
      { reason },
    ),
  ]);
}

function inspectInput(
  input: unknown,
):
  | Readonly<Record<string, unknown>>
  | ValidationResult<PublicationContentEnvelope> {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return inputDiagnostic(
      "",
      "Publication compilation input must be one plain object.",
      "notPlainObject",
    );
  }

  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(input);
    keys = Reflect.ownKeys(input);
  } catch {
    return inputDiagnostic(
      "",
      "Publication compilation input cannot be inspected safely.",
      "uninspectable",
    );
  }

  const stringKeys = keys
    .filter((key): key is string => typeof key === "string")
    .sort();
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    stringKeys.length !== keys.length
  ) {
    return inputDiagnostic(
      "",
      "Publication compilation input must be one plain object with string keys.",
      "notPlainObject",
    );
  }

  const unexpectedKey = stringKeys.find(
    (key) => !allowedInputKeys.has(key),
  );
  if (unexpectedKey !== undefined) {
    return inputDiagnostic(
      `/${unexpectedKey}`,
      `Publication compilation input must not contain "${unexpectedKey}".`,
      "unexpectedProperty",
    );
  }

  const missingKey = requiredInputKeys.find(
    (key) => !stringKeys.includes(key),
  );
  if (missingKey !== undefined) {
    return inputDiagnostic(
      `/${missingKey}`,
      `Publication compilation input must contain "${missingKey}".`,
      "missingProperty",
    );
  }

  const values: Record<string, unknown> = {};
  try {
    for (const key of stringKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return inputDiagnostic(
          `/${key}`,
          "Publication compilation properties must be enumerable data properties.",
          "nonDataProperty",
        );
      }
      values[key] = descriptor.value;
    }
  } catch {
    return inputDiagnostic(
      "",
      "Publication compilation input cannot be inspected safely.",
      "uninspectable",
    );
  }

  return Object.freeze(values);
}

function isInvalidInspection(
  value:
    | Readonly<Record<string, unknown>>
    | ValidationResult<PublicationContentEnvelope>,
): value is ValidationResult<PublicationContentEnvelope> {
  return Object.hasOwn(value, "valid");
}

export function compileLoadedPublicationContent(
  input: CompileLoadedPublicationContentInput,
): ValidationResult<PublicationContentEnvelope> {
  const inspected = inspectInput(input);
  if (isInvalidInspection(inspected)) {
    return inspected;
  }

  const loaded = inspected.loaded;
  if (!isTrustedLoadedPublicationSnapshot(loaded)) {
    return invalidResult([
      loaderDiagnostic(
        "publisher.snapshot.untrusted",
        "/loaded",
        "Publication compilation requires the exact snapshot returned by this installed Publisher loader.",
        "trustedSnapshot",
        { reason: "notLoaderIssued" },
      ),
    ]);
  }

  const optionalInput = {
    ...(inspected.extensions === undefined
      ? {}
      : { extensions: inspected.extensions }),
    ...(inspected.links === undefined
      ? {}
      : { links: inspected.links }),
    ...(inspected.wordsPerMinute === undefined
      ? {}
      : { wordsPerMinute: inspected.wordsPerMinute }),
  };

  return compilePublicationContent({
    engineVersion: PUBLISHER_VERSION,
    publication: loaded.publication,
    sourceGraph: loaded.sourceGraph,
    sources: loaded.sources,
    works: inspected.works,
    ...optionalInput,
  } as CompilePublicationContentInput);
}
