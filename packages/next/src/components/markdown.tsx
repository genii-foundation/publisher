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
  ReaderBlock,
} from "@genii-foundation/publisher-schema";
import {
  inspectAbsoluteHttpUrl,
  inspectCanonicalUrlFragment,
} from "@genii-foundation/publisher-schema/reader";
import {
  inspectCanonicalRoutePath,
} from "@genii-foundation/publisher-schema/routes";
import {
  Fragment,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, {
  type Components,
} from "react-markdown";
import { publisherFocusMarkupPlugin } from "./focus-markup.js";

function isSafeOriginRelativeUrl(value: string): boolean {
  if (value.startsWith("#")) {
    return inspectCanonicalUrlFragment(value.slice(1)).valid;
  }
  if (!value.startsWith("/")) {
    return false;
  }
  const separator = value.indexOf("#");
  const path =
    separator < 0 ? value : value.slice(0, separator);
  if (!inspectCanonicalRoutePath(path).valid) {
    return false;
  }
  return (
    separator < 0 ||
    inspectCanonicalUrlFragment(
      value.slice(separator + 1),
    ).valid
  );
}

export function publisherMarkdownUrlTransform(
  value: string,
): string {
  return isSafeOriginRelativeUrl(value) ||
    inspectAbsoluteHttpUrl(value).valid
    ? value
    : "";
}

export interface PublisherMarkdownBlockProps {
  readonly assetHrefs: ReadonlySet<string>;
  readonly block: ReaderBlock;
  readonly markdown: string;
  readonly narrationWords?: boolean;
  readonly renderedPath: string;
}

function safeMarkdownComponents(
  assetHrefs: ReadonlySet<string>,
): Components {
  return {
    a({ children, href, title }) {
      return typeof href === "string" && href.length > 0 ? (
        <a href={href} title={title}>
          {children}
        </a>
      ) : (
        <Fragment>{children}</Fragment>
      );
    },
    img({ alt, src, title }) {
      return typeof src === "string" &&
        assetHrefs.has(src) ? (
        <img alt={alt ?? ""} src={src} title={title} />
      ) : (
        <span className="publisher-missing-asset">
          {alt ?? ""}
        </span>
      );
    },
  };
}

function InlineHeading({
  children,
}: {
  readonly children?: ReactNode;
}): ReactElement {
  return <Fragment>{children}</Fragment>;
}

export function PublisherMarkdownInline({
  assetHrefs,
  markdown,
}: {
  readonly assetHrefs: ReadonlySet<string>;
  readonly markdown: string;
}): ReactElement {
  return (
    <ReactMarkdown
      components={{
        ...safeMarkdownComponents(assetHrefs),
        h1: InlineHeading,
        h2: InlineHeading,
        h3: InlineHeading,
        h4: InlineHeading,
        h5: InlineHeading,
        h6: InlineHeading,
      }}
      rehypePlugins={[publisherFocusMarkupPlugin]}
      skipHtml
      urlTransform={publisherMarkdownUrlTransform}
    >
      {markdown}
    </ReactMarkdown>
  );
}

export function PublisherMarkdownBlock({
  assetHrefs,
  block,
  markdown,
  narrationWords = false,
  renderedPath,
}: PublisherMarkdownBlockProps): ReactElement {
  const ownedDomId =
    block.readerAddress?.path === renderedPath
      ? block.domId
      : null;
  return (
    <div
      className="publisher-markdown"
      data-publisher-block={block.id}
      {...(ownedDomId === null ? {} : { id: ownedDomId })}
    >
      <ReactMarkdown
        components={safeMarkdownComponents(assetHrefs)}
        rehypePlugins={[
          [publisherFocusMarkupPlugin, { narrationWords }],
        ]}
        skipHtml
        urlTransform={publisherMarkdownUrlTransform}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
