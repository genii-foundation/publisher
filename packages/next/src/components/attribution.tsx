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
  GENII_PUBLISHER_SOURCE_CODE_URL,
  REQUIRED_ATTRIBUTION,
} from "@genii-foundation/publisher-schema/attribution";
import {
  inspectAbsoluteHttpUrl,
} from "@genii-foundation/publisher-schema/routes";
import type { ReactElement } from "react";

export interface PublisherAttributionProps {
  readonly sourceCodeUrl: unknown;
}

export function PublisherAttribution({
  sourceCodeUrl,
}: PublisherAttributionProps): ReactElement {
  const inspectedSourceCodeUrl =
    inspectAbsoluteHttpUrl(sourceCodeUrl);
  const linkedSourceCodeUrl = inspectedSourceCodeUrl.valid
    ? inspectedSourceCodeUrl.value
    : GENII_PUBLISHER_SOURCE_CODE_URL;
  return (
    <footer
      className="publisher-attribution"
      data-publisher-attribution="required"
      lang="en"
    >
      <p>{REQUIRED_ATTRIBUTION.copyright}</p>
      <p>
        <a href={REQUIRED_ATTRIBUTION.url}>
          {REQUIRED_ATTRIBUTION.text}
        </a>
      </p>
      <p>
        <a href={linkedSourceCodeUrl}>Publication source code</a>
      </p>
    </footer>
  );
}
