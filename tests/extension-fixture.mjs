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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";

import {
  buildPublicationReader,
} from "../packages/publisher/dist/node.js";

function fixtureRegistration(extension) {
  return Object.freeze({
    id: extension.id,
    package: extension.package,
    version: extension.version ?? "1.0.0",
    engineCompatibility: ">=0.1.0-alpha.0 <0.2.0",
    capabilities: Object.freeze([...extension.capabilities]),
    implementation: Object.freeze({
      kind: "genii.publisher.extension",
      apiVersion: "1.0",
      project({ content, config }) {
        return Object.freeze({
          valid: true,
          value: Object.freeze({
            serverData: Object.freeze({
              extensionId: extension.id,
              publicationId: content.publicationId,
              config,
            }),
          }),
          diagnostics: Object.freeze([]),
        });
      },
    }),
    ...(extension.capabilities.includes("renderer.slot")
      ? {
          renderer: Object.freeze({
            kind: "genii.publisher.next-extension",
            apiVersion: "1.0",
            rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
            renderSlot({ slot, serverData }) {
              return createElement(
                "p",
                { "data-fixture-extension": extension.id },
                `${slot}:${serverData?.extensionId ?? extension.id}`,
              );
            },
          }),
        }
      : {}),
  });
}

export function extensionRegistrationsFor(publicationRoot) {
  let publication;
  try {
    publication = JSON.parse(
      readFileSync(join(publicationRoot, "publication.json"), "utf8"),
    );
  } catch {
    return Object.freeze([]);
  }
  return Object.freeze(
    (publication.extensions ?? []).map(fixtureRegistration),
  );
}

export function extensionRegistrationsForBuild(built) {
  return Object.freeze(
    built.content.extensions.map(fixtureRegistration),
  );
}

export function buildFixturePublicationReader(input) {
  return buildPublicationReader({
    ...input,
    extensions: extensionRegistrationsFor(input.publicationRoot),
  });
}
