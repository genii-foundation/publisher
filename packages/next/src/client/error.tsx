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

"use client";

import type {
  ReaderPublicationIdentity,
} from "@genii-foundation/publisher-schema";
import type { ReactElement } from "react";

import { PublisherAttribution } from "../components/attribution.js";
import {
  publisherNextThemeStyle,
} from "../theme/style.js";
import type {
  PublisherNextThemeInstance,
} from "../types.js";

export interface PublisherNextErrorIdentity {
  readonly homePath: string;
  readonly publication: ReaderPublicationIdentity;
  readonly theme: PublisherNextThemeInstance;
}

export interface PublisherNextErrorBoundaryProps {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}

export interface PublisherNextErrorPageProps
  extends PublisherNextErrorBoundaryProps {
  readonly identity: PublisherNextErrorIdentity;
}

export interface PublisherNextFrameworkErrorPageProps {
  readonly identity: PublisherNextErrorIdentity;
}

interface PublisherErrorShellProps {
  readonly identity: PublisherNextErrorIdentity;
  readonly reset: () => void;
}

function PublisherErrorShell({
  identity,
  reset,
}: PublisherErrorShellProps): ReactElement {
  return (
    <div
      className="publisher-root"
      data-publisher-page="error"
      style={publisherNextThemeStyle(identity.theme)}
    >
      <a
        className="publisher-skip-link"
        href="#publisher:main"
        lang="en"
      >
        Skip to content
      </a>
      <header className="publisher-site-header">
        <a
          className="publisher-site-title"
          href={identity.homePath}
          lang={identity.publication.language}
        >
          {identity.publication.title}
        </a>
      </header>
      <main id="publisher:main" lang="en">
        <h1>Publication unavailable</h1>
        <p>The publication could not render this page.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </main>
      <PublisherAttribution publication={identity.publication} />
    </div>
  );
}

function reloadPage(): void {
  window.location.reload();
}

export function PublisherNextErrorPage(
  props: PublisherNextErrorPageProps,
): ReactElement {
  void props.error;
  return <PublisherErrorShell {...props} />;
}

export function PublisherNextFrameworkErrorPage({
  identity,
}: PublisherNextFrameworkErrorPageProps): ReactElement {
  return (
    <PublisherErrorShell
      identity={identity}
      reset={reloadPage}
    />
  );
}

export function PublisherNextGlobalErrorPage(
  props: PublisherNextErrorPageProps,
): ReactElement {
  void props.error;
  return (
    <html lang={props.identity.publication.language}>
      <body>
        <title>{`Publication error | ${props.identity.publication.title}`}</title>
        <PublisherErrorShell {...props} />
      </body>
    </html>
  );
}
