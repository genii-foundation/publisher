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
  normalizePortableRepositoryText,
} from "@genii-foundation/publisher-schema";
import {
  GENII_PUBLISHER_SOURCE_CODE_URL,
  REQUIRED_ATTRIBUTION,
} from "@genii-foundation/publisher-schema/attribution";
import {
  inspectAbsoluteHttpUrl,
} from "@genii-foundation/publisher-schema/routes";
import type {
  PublicationReaderEnvelope,
} from "@genii-foundation/publisher-schema";

import type {
  PublisherNextRoutePlan,
} from "./routes.js";

interface RedirectTarget {
  readonly status: 301 | 302 | 307 | 308;
  readonly to: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function canonicalSegmentKey(path: string): string | null {
  try {
    if (path === "/") {
      return "[]";
    }
    const terminalIndex = path.endsWith("/")
      ? path.length - 1
      : path.length;
    const segments = path
      .slice(1, terminalIndex)
      .split("/")
      .map((segment) => decodeURIComponent(segment));
    if (
      segments.some(
        (segment) =>
          segment.length === 0 ||
          segment.includes("/") ||
          segment !== normalizePortableRepositoryText(segment),
      )
    ) {
      return null;
    }
    return JSON.stringify(segments);
  } catch {
    return null;
  }
}

function attributedNotFoundResponse(
  reader: PublicationReaderEnvelope,
): Response {
  const publication = reader.publication;
  const title = escapeHtml(publication.title);
  const language = escapeHtml(publication.language);
  const inspectedSourceCodeUrl = inspectAbsoluteHttpUrl(
    publication.attribution.sourceCodeUrl,
  );
  const sourceCodeUrl = inspectedSourceCodeUrl.valid
    ? inspectedSourceCodeUrl.value
    : GENII_PUBLISHER_SOURCE_CODE_URL;
  const html = [
    "<!doctype html>",
    `<html lang="${language}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Not Found | ${title}</title>`,
    "</head>",
    "<body>",
    '<div class="publisher-root" data-publisher-page="not-found">',
    '<main id="publisher:main" lang="en">',
    "<h1>Page not found</h1>",
    "<p>This publication has no page at this address.</p>",
    "</main>",
    '<footer class="publisher-attribution" data-publisher-attribution="required" lang="en">',
    `<p>${escapeHtml(REQUIRED_ATTRIBUTION.copyright)}</p>`,
    `<p><a href="${escapeHtml(REQUIRED_ATTRIBUTION.url)}">${escapeHtml(REQUIRED_ATTRIBUTION.text)}</a></p>`,
    `<p><a href="${escapeHtml(sourceCodeUrl)}">Publication source code</a></p>`,
    "</footer>",
    "</div>",
    "</body>",
    "</html>",
  ].join("");
  return new Response(html, {
    status: 404,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export interface PublisherNextContinuityHandler {
  readonly explicitRedirectCount: number;
  readonly canonicalSlashRedirectCount: number;
  readonly handleRequest: (
    request: Request,
  ) => Response | undefined;
}

export function createPublisherNextContinuityHandler(
  reader: PublicationReaderEnvelope,
  routePlan: PublisherNextRoutePlan,
): PublisherNextContinuityHandler {
  const redirects = new Map<string, RedirectTarget>();
  const activePaths = new Set<string>();
  const activePathsBySegmentKey = new Map<string, string>();
  for (const route of reader.routes.active) {
    activePaths.add(route.path);
    const key = canonicalSegmentKey(route.path);
    if (key !== null) {
      activePathsBySegmentKey.set(key, route.path);
    }
  }
  for (const redirect of reader.routes.redirects) {
    redirects.set(
      redirect.from,
      Object.freeze({
        status: redirect.status,
        to: redirect.to,
      }),
    );
  }

  let canonicalSlashRedirectCount = 0;
  for (const route of reader.routes.active) {
    if (route.path === "/") {
      continue;
    }
    const alias = route.path.endsWith("/")
      ? route.path.slice(0, -1)
      : `${route.path}/`;
    if (!redirects.has(alias)) {
      redirects.set(
        alias,
        Object.freeze({
          status: 308,
          to: route.path,
        }),
      );
      canonicalSlashRedirectCount += 1;
    }
  }

  return Object.freeze({
    explicitRedirectCount: reader.routes.redirects.length,
    canonicalSlashRedirectCount,
    handleRequest(request: Request): Response | undefined {
      try {
        if (
          request === null ||
          typeof request !== "object" ||
          typeof request.url !== "string"
        ) {
          return undefined;
        }
        const requestUrl = new URL(request.url);
        const redirect = redirects.get(requestUrl.pathname);
        if (redirect !== undefined) {
          const location = redirect.to.startsWith("/")
            ? new URL(
                `${redirect.to}${requestUrl.search}`,
                requestUrl.origin,
              ).href
            : redirect.to;
          return new Response(null, {
            status: redirect.status,
            headers: {
              location,
            },
          });
        }
        if (activePaths.has(requestUrl.pathname)) {
          return undefined;
        }
        const decodedKey = canonicalSegmentKey(
          requestUrl.pathname,
        );
        if (
          decodedKey !== null &&
          activePathsBySegmentKey.has(decodedKey)
        ) {
          return attributedNotFoundResponse(reader);
        }
        return undefined;
      } catch {
        return undefined;
      }
    },
  });
}
