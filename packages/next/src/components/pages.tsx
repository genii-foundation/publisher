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
  ReaderPublicationIdentity,
  ReaderSection,
  SyncEnvelope,
  ReaderWork,
  Sha256Digest,
} from "@genii-foundation/publisher-schema";
import {
  createReaderNarrationSectionTextProfile,
} from "@genii-foundation/publisher-reader/narration";
import {
  createElement,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  PublisherReaderRail,
  type PublisherReaderOutlineEntry,
} from "../client/reader-rail.js";
import type {
  PublisherNextPage,
  PublisherNextThemeInstance,
  PublisherNextUpdatesPage,
  PublisherNextUpdatesView,
} from "../types.js";
import { PublisherAttribution } from "./attribution.js";
import {
  PublisherLinkableHeading,
  PublisherMarkdownBlock,
  PublisherMarkdownInline,
} from "./markdown.js";
import {
  publisherNextThemeStyle,
} from "../theme/style.js";

export type PublisherNextMarkdownForBlock = (
  workId: string,
  sectionId: string,
  block: ReaderBlock,
) => string;

function PublicationHeader({
  homePath,
  title,
}: {
  readonly homePath: string;
  readonly title: string;
}): ReactElement {
  return (
    <header className="publisher-site-header">
      <a className="publisher-site-title" href={homePath}>
        {title}
      </a>
    </header>
  );
}

function WorkSummary({
  headingLevel,
  work,
}: {
  readonly headingLevel: 2 | 3;
  readonly work: ReaderWork;
}): ReactElement {
  const number = new Intl.NumberFormat("en");
  const minuteUnit =
    new Intl.PluralRules("en").select(
      work.readingMinutes,
    ) === "one"
      ? "minute"
      : "minutes";
  return (
    <li lang={work.language}>
      {createElement(
        `h${headingLevel}`,
        null,
        <a href={work.route}>{work.title}</a>,
      )}
      {work.subtitle === undefined ? null : <p>{work.subtitle}</p>}
      {work.summary === undefined ? null : <p>{work.summary}</p>}
      <p className="publisher-reading-stat" lang="en">
        {number.format(work.wordCount)} words,{" "}
        {number.format(work.readingMinutes)} {minuteUnit} read
      </p>
    </li>
  );
}

function owningHeading(
  section: ReaderSection,
): ReaderBlock | null {
  const first = section.blocks[0];
  return first?.kind === "heading" &&
    first.text === section.title
    ? first
    : null;
}

function sectionHref(
  workRoute: string,
  section: ReaderSection,
): string {
  if (section.readerAddress === null) {
    return workRoute;
  }
  return `${section.readerAddress.path}${
    section.readerAddress.anchor === undefined
      ? ""
      : `#${section.readerAddress.anchor}`
  }`;
}

function readerOutline(page: PublisherNextPage): readonly PublisherReaderOutlineEntry[] {
  const work = page.kind === "work" || page.kind === "section"
    ? page.work
    : null;
  if (work === null) return Object.freeze([]);
  return Object.freeze(
    work.sections
      .filter((section) => section.navigable)
      .map((section) => Object.freeze({
        id: section.id,
        title: section.title,
        href: sectionHref(work.route, section),
        depth: section.depth,
      })),
  );
}

function readerSectionTrail(
  work: ReaderWork,
  section: ReaderSection,
): readonly ReaderSection[] {
  const byId = new Map(work.sections.map((candidate) => [candidate.id, candidate]));
  const reversed: ReaderSection[] = [];
  const seen = new Set<string>();
  let current: ReaderSection | undefined = section;
  while (current !== undefined && !seen.has(current.id)) {
    reversed.push(current);
    seen.add(current.id);
    current = current.parentId === null
      ? undefined
      : byId.get(current.parentId);
  }
  return Object.freeze(reversed.reverse());
}

function readerBreadcrumbs(page: PublisherNextPage): readonly PublisherReaderOutlineEntry[] {
  if (page.kind !== "section") return Object.freeze([]);
  return Object.freeze(readerSectionTrail(page.work, page.section).map((section) =>
    Object.freeze({
      id: section.id,
      title: section.title,
      href: sectionHref(page.work.route, section),
      depth: section.depth,
    })
  ));
}

function SectionContent({
  assetHrefs,
  headingLevel,
  markdownForBlock,
  renderedPath,
  section,
  skipBlockId,
  workId,
}: {
  readonly assetHrefs: ReadonlySet<string>;
  readonly headingLevel?: number;
  readonly markdownForBlock: PublisherNextMarkdownForBlock;
  readonly renderedPath: string;
  readonly section: ReaderSection;
  readonly skipBlockId?: string;
  readonly workId: string;
}): ReactElement {
  const ownedDomId =
    section.readerAddress?.path === renderedPath
      ? section.domId
      : null;
  const headingBlock =
    headingLevel === undefined ? null : owningHeading(section);
  const headingBlockDomId =
    headingBlock?.readerAddress?.path === renderedPath
      ? headingBlock.domId
      : null;
  const omittedBlockId = skipBlockId ?? headingBlock?.id;
  const narrationProfile = createReaderNarrationSectionTextProfile(section);
  return (
    <section
      className="publisher-manuscript-section"
      data-publisher-section={section.id}
      data-publisher-narration-body-words={narrationProfile.bodyWordCount}
      data-publisher-narration-text-characters={narrationProfile.textCharacters}
      data-publisher-narration-title-words={narrationProfile.titleWordCount}
      {...(ownedDomId === null ? {} : { id: ownedDomId })}
    >
      {headingLevel === undefined
        ? null
        : (
            <PublisherLinkableHeading
              block={headingBlock}
              className="publisher-section-title"
              level={
                Math.min(6, Math.max(2, headingLevel)) as
                  2 | 3 | 4 | 5 | 6
              }
              {...(headingBlockDomId === null
                ? {}
                : { id: headingBlockDomId })}
            >
              {headingBlock === null ? (
                section.title
              ) : (
                <PublisherMarkdownInline
                  assetHrefs={assetHrefs}
                  markdown={markdownForBlock(
                    workId,
                    section.id,
                    headingBlock,
                  )}
                />
              )}
            </PublisherLinkableHeading>
          )}
      {section.blocks.flatMap((block) =>
        block.id === omittedBlockId
          ? []
          : [
              <PublisherMarkdownBlock
                assetHrefs={assetHrefs}
                block={block}
                key={block.id}
                markdown={markdownForBlock(
                  workId,
                  section.id,
                  block,
                )}
                narrationWords
                renderedPath={renderedPath}
              />,
            ],
      )}
    </section>
  );
}

function HomePage({
  page,
}: {
  readonly page: Extract<PublisherNextPage, { kind: "home" }>;
}): ReactElement {
  return (
    <>
      <h1>{page.publication.title}</h1>
      {page.publication.description === undefined ? null : (
        <p className="publisher-publication-description">
          {page.publication.description}
        </p>
      )}
      {page.works.length === 0 ? null : (
        <section aria-labelledby="publisher-works-heading">
          <h2 id="publisher-works-heading" lang="en">
            Works
          </h2>
          <ol className="publisher-catalog">
            {page.works.map((work) => (
              <WorkSummary
                headingLevel={3}
                key={work.id}
                work={work}
              />
            ))}
          </ol>
        </section>
      )}
      {page.collections.length === 0 ? null : (
        <section aria-labelledby="publisher-collections-heading">
          <h2 id="publisher-collections-heading" lang="en">
            Collections
          </h2>
          <ol className="publisher-catalog">
            {page.collections.map((collection) => (
              <li key={collection.id}>
                <h3>
                  <a href={collection.route}>{collection.title}</a>
                </h3>
                {collection.description === undefined ? null : (
                  <p>{collection.description}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

function WorkPage({
  markdownForBlock,
  page,
}: {
  readonly markdownForBlock: PublisherNextMarkdownForBlock;
  readonly page: Extract<PublisherNextPage, { kind: "work" }>;
}): ReactElement {
  const assetHrefs = new Set(
    page.assets.flatMap(({ href, mediaType }) =>
      mediaType.startsWith("image/") ? [href] : [],
    ),
  );
  const titleSection =
    page.work.rootSectionIds.length === 1
      ? (page.work.sections.find(
          ({ id, title }) =>
            id === page.work.rootSectionIds[0] &&
            title === page.work.title,
        ) ?? null)
      : null;
  const titleBlock =
    titleSection === null ? null : owningHeading(titleSection);
  const titleBlockDomId =
    titleBlock?.readerAddress?.path === page.path
      ? titleBlock.domId
      : null;
  return (
    <article
      data-publisher-work={page.work.id}
      lang={page.work.language}
    >
      <header>
        <PublisherLinkableHeading
          block={titleBlock}
          level={1}
          {...(titleBlockDomId === null
            ? {}
            : { id: titleBlockDomId })}
        >
          {titleBlock === null || titleSection === null ? (
            page.work.title
          ) : (
            <PublisherMarkdownInline
              assetHrefs={assetHrefs}
              markdown={markdownForBlock(
                page.work.id,
                titleSection.id,
                titleBlock,
              )}
            />
          )}
        </PublisherLinkableHeading>
        {page.work.subtitle === undefined ? null : (
          <p className="publisher-work-subtitle">{page.work.subtitle}</p>
        )}
        {page.work.summary === undefined ? null : (
          <p>{page.work.summary}</p>
        )}
      </header>
      <div className="publisher-manuscript">
        {page.work.sections.map((section) => (
          <SectionContent
            assetHrefs={assetHrefs}
            {...(section.id === titleSection?.id
              ? {}
              : { headingLevel: section.depth + 2 })}
            key={section.id}
            markdownForBlock={markdownForBlock}
            renderedPath={page.path}
            section={section}
            {...(section.id === titleSection?.id &&
            titleBlock !== null
              ? { skipBlockId: titleBlock.id }
              : {})}
            workId={page.work.id}
          />
        ))}
      </div>
    </article>
  );
}

function CollectionPage({
  page,
}: {
  readonly page: Extract<
    PublisherNextPage,
    { kind: "collection" }
  >;
}): ReactElement {
  return (
    <article data-publisher-collection={page.collection.id}>
      <h1>{page.collection.title}</h1>
      {page.collection.description === undefined ? null : (
        <p>{page.collection.description}</p>
      )}
      <ol className="publisher-catalog">
        {page.works.map((work) => (
          <WorkSummary
            headingLevel={2}
            key={work.id}
            work={work}
          />
        ))}
      </ol>
    </article>
  );
}

function SectionPage({
  markdownForBlock,
  page,
}: {
  readonly markdownForBlock: PublisherNextMarkdownForBlock;
  readonly page: Extract<PublisherNextPage, { kind: "section" }>;
}): ReactElement {
  const previousHref =
    page.previous === null ? null : sectionHref(page.work.route, page.previous);
  const nextHref = page.next === null
    ? null
    : sectionHref(page.work.route, page.next);
  const headingBlock = owningHeading(page.section);
  const headingDomId =
    headingBlock?.readerAddress?.path === page.path
      ? headingBlock.domId
      : null;
  const assetHrefs = new Set(
    page.assets.flatMap(({ href, mediaType }) =>
      mediaType.startsWith("image/") ? [href] : [],
    ),
  );
  return (
    <article
      data-publisher-work={page.work.id}
      lang={page.work.language}
    >
      <header>
        <nav className="publisher-breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li><a href={page.work.route}>{page.work.title}</a></li>
            {readerSectionTrail(page.work, page.section).map((section) => (
              <li key={section.id}>
                {section.id === page.section.id ? (
                  <span aria-current="page">{section.title}</span>
                ) : (
                  <a href={sectionHref(page.work.route, section)}>{section.title}</a>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <PublisherLinkableHeading
          block={headingBlock}
          level={1}
          {...(headingDomId === null
            ? {}
            : { id: headingDomId })}
        >
          {headingBlock === null ? (
            page.section.title
          ) : (
            <PublisherMarkdownInline
              assetHrefs={assetHrefs}
              markdown={markdownForBlock(
                page.work.id,
                page.section.id,
                headingBlock,
              )}
            />
          )}
        </PublisherLinkableHeading>
      </header>
      <div className="publisher-manuscript">
        <SectionContent
          assetHrefs={assetHrefs}
          markdownForBlock={markdownForBlock}
          renderedPath={page.path}
          section={page.section}
          {...(headingBlock === null
            ? {}
            : { skipBlockId: headingBlock.id })}
          workId={page.work.id}
        />
      </div>
      {previousHref === null && nextHref === null ? null : (
        <nav
          aria-label="Section navigation"
          className="publisher-section-navigation"
          lang="en"
        >
          {previousHref === null ? <span /> : (
            <a href={previousHref}>
              Previous:{" "}
              <span lang={page.work.language}>
                {page.previous?.title}
              </span>
            </a>
          )}
          {nextHref === null ? null : (
            <a href={nextHref}>
              Next:{" "}
              <span lang={page.work.language}>
                {page.next?.title}
              </span>
            </a>
          )}
        </nav>
      )}
    </article>
  );
}

function UpdatesPage({
  updates,
  page,
}: {
  readonly updates: PublisherNextUpdatesView;
  readonly page: PublisherNextUpdatesPage;
}): ReactElement {
  return (
    <section className="publisher-updates">
      <header>
        <h1>{updates.title}</h1>
        {updates.description === undefined ? null : (
          <p>{updates.description}</p>
        )}
      </header>
      {updates.entries.length === 0 ? (
        <p>
          {updates.emptyMessage ?? (
            <span lang="en">No updates have been published.</span>
          )}
        </p>
      ) : (
        <ol className="publisher-catalog">
          {updates.entries.map((entry) => (
            <li key={entry.id}>
              <article data-publisher-update={entry.id}>
                <h2>
                  {entry.href === undefined ? (
                    entry.title
                  ) : (
                    <a href={entry.href}>{entry.title}</a>
                  )}
                </h2>
                {entry.publishedAt === undefined ? null : (
                  <p>
                    <time dateTime={entry.publishedAt}>
                      {entry.publishedAt}
                    </time>
                  </p>
                )}
                {entry.summary === undefined ? null : (
                  <p>{entry.summary}</p>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
      {page.previousPath === undefined && page.nextPath === undefined ? null : (
        <nav aria-label="Updates pagination">
          {page.previousPath === undefined ? null : (
            <a href={page.previousPath}>Previous updates</a>
          )}
          {page.nextPath === undefined ? null : (
            <a href={page.nextPath}>Next updates</a>
          )}
        </nav>
      )}
    </section>
  );
}

async function PageBody({
  extensionRouteBody,
  markdownForBlock,
  page,
  updates,
}: {
  readonly extensionRouteBody?: ReactNode;
  readonly markdownForBlock: PublisherNextMarkdownForBlock;
  readonly page: PublisherNextPage;
  readonly updates: PublisherNextUpdatesView | null;
}): Promise<ReactNode> {
  switch (page.kind) {
    case "home":
      return <HomePage page={page} />;
    case "work":
      return (
        <WorkPage
          markdownForBlock={markdownForBlock}
          page={page}
        />
      );
    case "collection":
      return <CollectionPage page={page} />;
    case "section":
      return (
        <SectionPage
          markdownForBlock={markdownForBlock}
          page={page}
        />
      );
    case "updates":
      if (updates === null) {
        throw new TypeError(
          "The Updates route has no configured renderer.",
        );
      }
      return <UpdatesPage updates={updates} page={page} />;
    case "extension":
      if (extensionRouteBody === undefined) {
        throw new TypeError(
          "The extension route has no configured host renderer.",
        );
      }
      return (
        <section data-publisher-extension-route={page.routeId}>
          <h1>{page.title}</h1>
          {page.description === undefined ? null : (
            <p>{page.description}</p>
          )}
          {extensionRouteBody}
        </section>
      );
  }
}

export interface PublisherPageViewProps {
  readonly afterMain?: ReactNode;
  readonly beforeMain?: ReactNode;
  readonly clientExtensions?: ReactNode;
  readonly extensionRouteBody?: ReactNode;
  readonly homePath: string;
  readonly markdownForBlock: PublisherNextMarkdownForBlock;
  readonly page: PublisherNextPage;
  readonly readerBuildId: Sha256Digest;
  readonly sync: SyncEnvelope | null;
  readonly theme: PublisherNextThemeInstance;
  readonly updates: PublisherNextUpdatesView | null;
}

interface PublisherPageShellProps {
  readonly afterMain?: ReactNode;
  readonly beforeMain?: ReactNode;
  readonly clientExtensions?: ReactNode;
  readonly body: ReactNode;
  readonly homePath: string;
  readonly pageKind: PublisherNextPage["kind"] | "not-found";
  readonly reader?: {
    readonly buildId: Sha256Digest;
    readonly breadcrumbs: readonly PublisherReaderOutlineEntry[];
    readonly currentSection?: ReaderSection;
    readonly currentWorkId?: string;
    readonly outline: readonly PublisherReaderOutlineEntry[];
    readonly sync: SyncEnvelope | null;
  };
  readonly publication: ReaderPublicationIdentity;
  readonly theme: PublisherNextThemeInstance;
}

function PublisherPageShell({
  afterMain,
  beforeMain,
  clientExtensions,
  body,
  homePath,
  pageKind,
  reader,
  publication,
  theme,
}: PublisherPageShellProps): ReactElement {
  return (
    <div
      className="publisher-root"
      data-publisher-page={pageKind}
      style={publisherNextThemeStyle(theme)}
    >
      <a
        className="publisher-skip-link"
        href="#publisher:main"
        lang="en"
      >
        Skip to content
      </a>
      <PublicationHeader
        homePath={homePath}
        title={publication.title}
      />
      {reader === undefined ? null : (
        <PublisherReaderRail
          {...(reader.currentSection === undefined
            ? {}
            : {
                currentSection: reader.currentSection,
                currentWorkId: reader.currentWorkId,
              })}
          outline={reader.outline}
          breadcrumbs={reader.breadcrumbs}
          publicationId={publication.id}
          publicationTitle={publication.title}
          readerBuildId={reader.buildId}
          defaultReaderFontFamilyId={
            theme.tokens.typography.defaultReaderFontFamilyId
          }
          readerFontFamilies={
            theme.tokens.typography.readerFontFamilies
          }
          audioPath="/publication-audio.json"
          progressPath="/publication-reader-progress.json"
          searchPath="/publication-reader-search.json"
          sync={reader.sync}
        />
      )}
      <main id="publisher:main">
        {beforeMain}
        {body}
        {afterMain}
        {clientExtensions}
      </main>
      <PublisherAttribution
        sourceCodeUrl={publication.attribution.sourceCodeUrl}
      />
    </div>
  );
}

export async function PublisherPageView({
  afterMain,
  beforeMain,
  clientExtensions,
  extensionRouteBody,
  homePath,
  markdownForBlock,
  page,
  readerBuildId,
  sync,
  theme,
  updates,
}: PublisherPageViewProps): Promise<ReactElement> {
  const body = await PageBody({
    extensionRouteBody,
    markdownForBlock,
    page,
    updates,
  });
  return (
    <PublisherPageShell
      afterMain={afterMain}
      beforeMain={beforeMain}
      clientExtensions={clientExtensions}
      body={body}
      homePath={homePath}
      pageKind={page.kind}
      publication={page.publication}
      reader={{
        buildId: readerBuildId,
        ...(page.kind === "section"
          ? { currentSection: page.section, currentWorkId: page.work.id }
          : {}),
        outline: readerOutline(page),
        breadcrumbs: readerBreadcrumbs(page),
        sync,
      }}
      theme={theme}
    />
  );
}

export function PublisherNotFoundView({
  homePath,
  publication,
  theme,
}: {
  readonly homePath: string;
  readonly publication: ReaderPublicationIdentity;
  readonly theme: PublisherNextThemeInstance;
}): ReactElement {
  return (
    <PublisherPageShell
      body={
        <div lang="en">
          <h1>Page not found</h1>
          <p>This publication has no page at this address.</p>
        </div>
      }
      homePath={homePath}
      pageKind="not-found"
      publication={publication}
      theme={theme}
    />
  );
}
