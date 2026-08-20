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
  createElement,
  Fragment,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, {
  type Components,
} from "react-markdown";
import {
  PublisherReaderHeadingAction,
} from "../client/reader-heading-action.js";
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

function headingHref(block: ReaderBlock): string | null {
  return block.readerAddress === null
    ? null
    : `${block.readerAddress.path}#${block.readerAddress.anchor}`;
}

function LinkableHeading({
  block,
  children,
  className,
  identifyBlock,
  id,
  level,
}: {
  readonly block: ReaderBlock | null;
  readonly children: ReactNode;
  readonly className?: string;
  readonly identifyBlock: boolean;
  readonly id?: string;
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
}): ReactElement {
  const heading = createElement(
    `h${level}`,
    {
      ...(className === undefined ? {} : { className }),
      ...(id === undefined ? {} : { id }),
      ...(identifyBlock && block !== null
        ? { "data-publisher-block": block.id }
        : {}),
    },
    children,
  );
  if (block === null) return heading;
  const href = headingHref(block);
  return href === null ? heading : (
    <div className="publisher-linkable-heading">
      {heading}
      <PublisherReaderHeadingAction
        href={href}
        title={block.text}
      />
    </div>
  );
}

export function PublisherLinkableHeading({
  block,
  children,
  className,
  id,
  level,
}: {
  readonly block: ReaderBlock | null;
  readonly children: ReactNode;
  readonly className?: string;
  readonly id?: string;
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
}): ReactElement {
  return (
    <LinkableHeading
      block={block}
      identifyBlock
      level={level}
      {...(className === undefined ? {} : { className })}
      {...(id === undefined ? {} : { id })}
    >
      {children}
    </LinkableHeading>
  );
}

function markdownHeadingComponents(
  block: ReaderBlock,
): Pick<
  Components,
  "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
> {
  const heading = (
    level: 1 | 2 | 3 | 4 | 5 | 6,
    children: ReactNode,
  ) => (
    <LinkableHeading
      block={block}
      identifyBlock={false}
      level={level}
    >
      {children}
    </LinkableHeading>
  );
  return {
    h1: ({ children }) => heading(1, children),
    h2: ({ children }) => heading(2, children),
    h3: ({ children }) => heading(3, children),
    h4: ({ children }) => heading(4, children),
    h5: ({ children }) => heading(5, children),
    h6: ({ children }) => heading(6, children),
  };
}

function InlineHeading({
  children,
}: {
  readonly children?: ReactNode;
}): ReactElement {
  return <Fragment>{children}</Fragment>;
}

type TableAlignment = "center" | "left" | "right" | undefined;

interface ParsedMarkdownTable {
  readonly alignments: readonly TableAlignment[];
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function tableCells(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return null;
  }
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function tableAlignment(cell: string): TableAlignment | null {
  if (!/^:?-{3,}:?$/u.test(cell)) return null;
  if (cell.startsWith(":")) {
    return cell.endsWith(":") ? "center" : "left";
  }
  return cell.endsWith(":") ? "right" : undefined;
}

function parseMarkdownTable(markdown: string): ParsedMarkdownTable | null {
  const lines = markdown.split("\n");
  if (lines.length < 2 || lines.length > 4_098) return null;
  const headers = tableCells(lines[0] ?? "");
  const separators = tableCells(lines[1] ?? "");
  if (
    headers === null ||
    separators === null ||
    headers.length < 1 ||
    headers.length > 128 ||
    separators.length !== headers.length
  ) {
    return null;
  }
  const alignments = separators.map(tableAlignment);
  if (alignments.some((alignment) => alignment === null)) {
    return null;
  }
  const rows: string[][] = [];
  for (const line of lines.slice(2)) {
    const cells = tableCells(line);
    if (cells === null || cells.length !== headers.length) {
      return null;
    }
    rows.push([...cells]);
  }
  return {
    alignments: alignments as readonly TableAlignment[],
    headers,
    rows,
  };
}

function PublisherMarkdownCell({
  assetHrefs,
  markdown,
  narrationWords,
}: {
  readonly assetHrefs: ReadonlySet<string>;
  readonly markdown: string;
  readonly narrationWords: boolean;
}): ReactElement {
  return (
    <ReactMarkdown
      components={{
        ...safeMarkdownComponents(assetHrefs),
        p: InlineHeading,
        h1: InlineHeading,
        h2: InlineHeading,
        h3: InlineHeading,
        h4: InlineHeading,
        h5: InlineHeading,
        h6: InlineHeading,
      }}
      rehypePlugins={[
        [publisherFocusMarkupPlugin, { narrationWords }],
      ]}
      skipHtml
      urlTransform={publisherMarkdownUrlTransform}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function PublisherMarkdownTable({
  assetHrefs,
  block,
  narrationWords,
  table,
}: {
  readonly assetHrefs: ReadonlySet<string>;
  readonly block: ReaderBlock;
  readonly narrationWords: boolean;
  readonly table: ParsedMarkdownTable;
}): ReactElement {
  const captionId = `publisher-table-${block.id}`;
  const caption = `Table in ${block.text.slice(0, 120)}`;
  return (
    <div
      aria-labelledby={captionId}
      className="publisher-table-region"
      role="region"
      tabIndex={0}
    >
      <table>
        <caption id={captionId}>{caption}</caption>
        <thead>
          <tr>
            {table.headers.map((cell, index) => (
              <th
                key={index}
                scope="col"
                style={{ textAlign: table.alignments[index] }}
              >
                <PublisherMarkdownCell
                  assetHrefs={assetHrefs}
                  markdown={cell}
                  narrationWords={narrationWords}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  style={{ textAlign: table.alignments[cellIndex] }}
                >
                  <PublisherMarkdownCell
                    assetHrefs={assetHrefs}
                    markdown={cell}
                    narrationWords={narrationWords}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
        p: InlineHeading,
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
  const table = block.kind === "table"
    ? parseMarkdownTable(markdown)
    : null;
  return (
    <div
      className="publisher-markdown"
      data-publisher-block={block.id}
      {...(ownedDomId === null ? {} : { id: ownedDomId })}
    >
      {table === null ? (
        <ReactMarkdown
          components={{
            ...safeMarkdownComponents(assetHrefs),
            ...(block.kind === "heading"
              ? markdownHeadingComponents(block)
              : {}),
          }}
          rehypePlugins={[
            [publisherFocusMarkupPlugin, { narrationWords }],
          ]}
          skipHtml
          urlTransform={publisherMarkdownUrlTransform}
        >
          {markdown}
        </ReactMarkdown>
      ) : (
        <PublisherMarkdownTable
          assetHrefs={assetHrefs}
          block={block}
          narrationWords={narrationWords}
          table={table}
        />
      )}
    </div>
  );
}
