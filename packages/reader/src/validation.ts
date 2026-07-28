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
  PublicationReaderEnvelope,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import { diagnostic } from "./diagnostics.js";
import {
  calculateReaderBlockContentHash,
  calculateReaderBuildId,
  calculateReaderSectionContentHash,
  calculateReaderWorkContentHash,
} from "./identity.js";
import { immutableSnapshot } from "./immutability.js";
import { createPublicationReaderRuntime } from "./runtime.js";

/**
 * Performs browser-safe structural and relational validation, then verifies
 * the reader-owned SHA-256 build identity in the Node package root.
 */
export function validatePublicationReaderEnvelope(
  value: unknown,
): ValidationResult<PublicationReaderEnvelope> {
  try {
    const runtimeResult = createPublicationReaderRuntime(value);
    if (!runtimeResult.valid) {
      return runtimeResult;
    }
    const envelope = runtimeResult.value.envelope;
    const diagnostics: Diagnostic[] = [];
    envelope.works.forEach((work, workIndex) => {
      work.sections.forEach((section, sectionIndex) => {
        section.blocks.forEach((block, blockIndex) => {
          const expectedContentHash =
            calculateReaderBlockContentHash(block);
          if (block.contentHash !== expectedContentHash) {
            diagnostics.push(
              diagnostic(
                "reader.block.content_hash_mismatch",
                `/works/${workIndex}/sections/${sectionIndex}/blocks/${blockIndex}/contentHash`,
                "Reader block content hash does not match its public content semantics.",
                "derivedValue",
                {
                  actual: block.contentHash,
                  expected: expectedContentHash,
                },
              ),
            );
          }
        });
        const expectedContentHash =
          calculateReaderSectionContentHash(section);
        if (section.contentHash !== expectedContentHash) {
          diagnostics.push(
            diagnostic(
              "reader.section.content_hash_mismatch",
              `/works/${workIndex}/sections/${sectionIndex}/contentHash`,
              "Reader section content hash does not match its public content semantics.",
              "derivedValue",
              {
                actual: section.contentHash,
                expected: expectedContentHash,
              },
            ),
          );
        }
      });
      const expectedContentHash =
        calculateReaderWorkContentHash(work);
      if (work.contentHash !== expectedContentHash) {
        diagnostics.push(
          diagnostic(
            "reader.work.content_hash_mismatch",
            `/works/${workIndex}/contentHash`,
            "Reader work content hash does not match its public content semantics.",
            "derivedValue",
            {
              actual: work.contentHash,
              expected: expectedContentHash,
            },
          ),
        );
      }
    });
    const expectedBuildId = calculateReaderBuildId(envelope);
    if (envelope.buildId !== expectedBuildId) {
      diagnostics.push(
        diagnostic(
          "reader.envelope.build_id_mismatch",
          "/buildId",
          "Reader build ID does not match the canonical projected semantics.",
          "derivedValue",
          {
            actual: envelope.buildId,
            expected: expectedBuildId,
          },
        ),
      );
    }
    if (diagnostics.length > 0) {
      return immutableSnapshot({
        valid: false,
        diagnostics,
      });
    }
    return immutableSnapshot({
      valid: true,
      value: envelope,
      diagnostics: [],
    });
  } catch {
    return immutableSnapshot({
      valid: false,
      diagnostics: [
        diagnostic(
          "reader.envelope.validation_failed",
          "",
          "Reader envelope validation could not safely inspect the supplied value.",
          "semanticValidation",
          { reason: "uninspectableEnvelope" },
        ),
      ],
    });
  }
}
