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

import type { NextConfig } from "next";

import {
  createPublisherNextRoutePlan,
} from "./routes.js";
import type {
  PublisherNextRoutePlan,
} from "./routes.js";

export {
  createPublisherNextRoutePlan,
};
export type {
  PublisherNextRoutePlan,
};

function assertCompatibleBaseConfig(
  baseConfig: NextConfig,
): void {
  if (baseConfig.trailingSlash !== undefined) {
    throw new TypeError(
      "Next.js trailingSlash is a site-wide policy and cannot represent Publisher publications with per-route slash authority.",
    );
  }
  if (baseConfig.skipTrailingSlashRedirect === false) {
    throw new TypeError(
      "skipTrailingSlashRedirect cannot be disabled because Publisher owns canonical slash redirects.",
    );
  }
  if (baseConfig.skipProxyUrlNormalize === false) {
    throw new TypeError(
      "skipProxyUrlNormalize cannot be disabled because Publisher continuity compares exact request paths.",
    );
  }
  if (baseConfig.skipMiddlewareUrlNormalize !== undefined) {
    throw new TypeError(
      "The deprecated skipMiddlewareUrlNormalize option cannot be combined with the Publisher Proxy.",
    );
  }
  if (baseConfig.experimental?.useTypeScriptCli === false) {
    throw new TypeError(
      "experimental.useTypeScriptCli cannot be disabled because the verified renderer toolchain uses TypeScript 7.",
    );
  }
  if (
    typeof baseConfig.basePath === "string" &&
    baseConfig.basePath.length > 0
  ) {
    throw new TypeError(
      "basePath is incompatible with origin-root Publisher routes.",
    );
  }
  if (baseConfig.i18n !== undefined && baseConfig.i18n !== null) {
    throw new TypeError(
      "Next.js i18n routing cannot reinterpret Publisher route identity.",
    );
  }
  if (baseConfig.redirects !== undefined) {
    throw new TypeError(
      "Next.js config redirects run before Publisher continuity. Declare publication redirects in the publication manifest.",
    );
  }
  if (baseConfig.rewrites !== undefined) {
    throw new TypeError(
      "Next.js config rewrites can steal canonical publication routes. Extensions must use governed Publisher route capabilities.",
    );
  }
  if (baseConfig.output === "export") {
    throw new TypeError(
      "Next.js static export cannot execute the Publisher continuity Proxy.",
    );
  }
}

export function createPublisherNextConfig(
  routePlan: PublisherNextRoutePlan,
  baseConfig: NextConfig = {},
): NextConfig {
  assertCompatibleBaseConfig(baseConfig);
  if (
    routePlan === null ||
    typeof routePlan !== "object" ||
    ![
      "none",
      "no-trailing",
      "trailing",
      "mixed",
    ].includes(routePlan.slashPolicy)
  ) {
    throw new TypeError(
      "A validated Publisher route plan is required to configure Next.js.",
    );
  }
  return {
    ...baseConfig,
    experimental: {
      ...baseConfig.experimental,
      useTypeScriptCli: true,
    },
    skipProxyUrlNormalize: true,
    skipTrailingSlashRedirect: true,
  };
}
