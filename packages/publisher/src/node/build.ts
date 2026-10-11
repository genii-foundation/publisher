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

// Building the reader artifact.
//
// Four steps already existed separately: the loader reads a publication tree,
// the compiler turns it into a content envelope, the projector turns that into a
// reader envelope, and the renderer's host declares where the artifact belongs.
// Nothing joined them, so the only thing that had ever run the whole pipeline was
// a test helper with assertions in it.
//
// That helper is the reason this module exists rather than being a few lines in
// the command. It derived work inputs by asserting, which is correct for a test
// and useless for an author: an assertion tells you the process died, not which
// work in which manifest is missing which manuscript. Every failure here is a
// diagnostic naming the document.
//
// One decision worth naming. A section needs an identity, the caller supplies it,
// and nothing in the protocol says what it should be. It is internal: routes come
// from each work's declared route, so a section identity never reaches a URL. So
// the engine owns it, derives it from the work, and this module is the only place
// that decides. A publication with multi-section works will add siblings to the
// root section rather than renaming it.

import {
  compileMarkdownWork,
} from "@genii-foundation/publisher-content";
import type {
  ResolvedExtensionInput,
  WorkContentInput,
} from "@genii-foundation/publisher-content";
import {
  projectPublicationReader,
  serializePublicationReaderEnvelope,
} from "@genii-foundation/publisher-reader";
import type {
  AudioEnvelope,
  Diagnostic,
  ExtensionReference,
  PublicationContentEnvelope,
  PublicationManifest,
  PublicationReaderEnvelope,
  ReaderAudience,
  SyncEnvelope,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import {
  PUBLISHER_VERSION,
} from "../index.js";
import {
  buildAudioEnvelope,
  resolvePublicationAudio,
} from "./audio.js";
import type {
  ResolvedPublicationAudio,
} from "./audio.js";
import {
  buildSyncEnvelope,
  resolvePublicationSync,
} from "./sync.js";
import type {
  ResolvedPublicationSync,
} from "./sync.js";
import {
  compileLoadedPublicationContent,
} from "./compile.js";
import {
  invalidResult,
  loaderDiagnostic,
  sortAndFreezeDiagnostics,
} from "./diagnostics.js";
import {
  loadPublicationCompilationSources,
} from "./loader.js";
import type {
  LoadedPublicationCompilationSources,
} from "./types.js";

/**
 * The identity the engine gives a work's single markdown section.
 *
 * Internal. It participates in route ownership and link resolution but is never
 * part of a URL, so changing it cannot break a published address.
 */
export function rootSectionIdFor(workId: string): string {
  return `${workId}-root`;
}

function buildDiagnostic(
  code: string,
  path: string,
  message: string,
  params: Readonly<Record<string, unknown>>,
  documentPath?: string,
): Diagnostic {
  return loaderDiagnostic(
    code,
    path,
    message,
    "build",
    params,
    documentPath,
  );
}

/**
 * Turns loaded sources into the work inputs the compiler requires.
 *
 * Reports every problem rather than the first. An author with three works
 * missing manuscripts should learn that once, not across three runs.
 */
export function derivePublicationWorkInputs(
  loaded: LoadedPublicationCompilationSources,
): ValidationResult<readonly WorkContentInput[]> {
  const manuscripts = new Map<
    string,
    { readonly path: string; readonly contents?: unknown }
  >();
  for (const source of loaded.sources) {
    // A manuscript with no entity identity cannot be attributed to a work, so it
    // is left out and the work it belonged to is reported as missing one. Keying
    // the map on undefined would attribute it to whichever work asked first.
    if (source.role === "manuscript" && source.entityId !== undefined) {
      manuscripts.set(source.entityId, source);
    }
  }

  const diagnostics: Diagnostic[] = [];
  const works: WorkContentInput[] = [];

  for (const [index, work] of loaded.sourceGraph.works.entries()) {
    const pointer = `/works/${index}`;
    const manuscript = manuscripts.get(work.workId);
    if (manuscript === undefined) {
      diagnostics.push(
        buildDiagnostic(
          "build.manuscript_missing",
          pointer,
          `Work "${work.workId}" declares a manuscript at ${work.manuscriptPath} but the loader produced no manuscript source for it.`,
          { workId: work.workId, manuscriptPath: work.manuscriptPath },
          work.manuscriptPath,
        ),
      );
      continue;
    }
    // The loader is trusted, so a disagreement here is an engine defect rather
        // than an author mistake. It still has to be reported instead of compiling
    // one work's text under another work's identity.
    if (manuscript.path !== work.manuscriptPath) {
      diagnostics.push(
        buildDiagnostic(
          "build.manuscript_path_mismatch",
          `${pointer}/manuscriptPath`,
          `Work "${work.workId}" resolved a manuscript at ${manuscript.path} while its graph entry declares ${work.manuscriptPath}.`,
          {
            workId: work.workId,
            declared: work.manuscriptPath,
            resolved: manuscript.path,
          },
          work.manuscriptPath,
        ),
      );
      continue;
    }
    if (typeof manuscript.contents !== "string") {
      diagnostics.push(
        buildDiagnostic(
          "build.manuscript_not_text",
          `${pointer}/manuscript`,
          `The manuscript for work "${work.workId}" did not load as text.`,
          { workId: work.workId, manuscriptPath: work.manuscriptPath },
          work.manuscriptPath,
        ),
      );
      continue;
    }

    const compiled = compileMarkdownWork({
      workId: work.workId,
      sectionId: rootSectionIdFor(work.workId),
      title: work.manifest.title,
      sourcePath: work.manuscriptPath,
      markdown: manuscript.contents,
      // No section route. A work's declared route is a work-level address, and
      // the publication's route templates already give the work that path.
      // Handing the same path to the root section makes two owners of one route,
      // which the compiler correctly refuses. Sections earn their own addresses
      // only when a work has more than one of them.
      ...(work.manifest.metadata === undefined
        ? {}
        : { sectionMetadata: work.manifest.metadata }),
    });
    if (!compiled.valid) {
      // The work's own manuscript is the document an author would open, so the
      // markdown compiler's paths are rewritten onto it rather than left
      // pointing at a pointer with no file.
      for (const item of compiled.diagnostics) {
        diagnostics.push(
          Object.freeze({
            ...item,
            documentPath: work.manuscriptPath,
          }),
        );
      }
      continue;
    }
    works.push(compiled.value.work);
  }

  if (diagnostics.length > 0) {
    return invalidResult(diagnostics);
  }
  return Object.freeze({
    valid: true as const,
    value: Object.freeze(works),
    diagnostics: sortAndFreezeDiagnostics([]),
  });
}

/**
 * Extension identities, stamped with the engine version that resolved them.
 *
 * A manifest declares which extension it wants, not which build resolved it, so
 * the version is the engine's own. Reading a version out of the manifest would
 * let a publication claim an extension build that never ran.
 */
function resolveExtensions(
  publication: PublicationManifest,
): readonly ResolvedExtensionInput[] {
  const declared: readonly ExtensionReference[] =
    publication.extensions ?? [];
  return Object.freeze(
    declared.map((extension) =>
      Object.freeze({
        id: extension.id,
        package: extension.package,
        version: PUBLISHER_VERSION,
        capabilities: Object.freeze([...extension.capabilities]),
      }),
    ),
  );
}

export interface BuildPublicationReaderInput {
  /** Absolute path to the publication root holding the manifest. */
  readonly publicationRoot: string;
  /** Which audience the projection is for. */
  readonly audience: ReaderAudience;
  readonly wordsPerMinute?: number;
}

export interface BuiltPublicationReader {
  readonly content: PublicationContentEnvelope;
  readonly reader: PublicationReaderEnvelope;
  /** Canonical JSON text, exactly as it would be written. */
  readonly text: string;
  /**
   * Cross-checked narration and its artifact, when the publication declares a
   * catalog.
   *
   * Absent when it declares none, rather than present and empty, so that a
   * publication with no narration cannot be confused with one whose catalog
   * resolved to nothing.
   *
   * The envelope text is produced here rather than by the caller. A caller that
   * had to re-read the catalog to build it could read a different file than the
   * one this build cross-checked, and the digest binding the two would then
   * certify the wrong thing.
   */
  readonly audio?: {
    readonly resolved: ResolvedPublicationAudio;
    readonly envelope: AudioEnvelope;
    /** Canonical JSON text, exactly as it would be written. */
    readonly text: string;
  };
  /**
   * What this publication offers to synchronize, when it declares any.
   *
   * Absent when it declares none. Nothing here carries provider configuration:
   * the artifact is served publicly and a config is author-supplied.
   */
  readonly sync?: {
    readonly resolved: ResolvedPublicationSync;
    readonly envelope: SyncEnvelope;
    /** Canonical JSON text, exactly as it would be written. */
    readonly text: string;
  };
}

/**
 * Runs the whole pipeline for one publication and returns the artifact text.
 *
 * Writes nothing. Where the text belongs is the renderer's decision and the
 * caller's to carry out, so this stays a pure function of the source tree.
 */
export async function buildPublicationReader(
  input: BuildPublicationReaderInput,
): Promise<ValidationResult<BuiltPublicationReader>> {
  const loaded = await loadPublicationCompilationSources({
    publicationRoot: input.publicationRoot,
  });
  if (!loaded.valid) {
    return invalidResult(loaded.diagnostics);
  }

  const works = derivePublicationWorkInputs(loaded.value);
  if (!works.valid) {
    return invalidResult(works.diagnostics);
  }

  const content = compileLoadedPublicationContent({
    loaded: loaded.value,
    works: works.value,
    extensions: resolveExtensions(loaded.value.publication),
    ...(input.wordsPerMinute === undefined
      ? {}
      : { wordsPerMinute: input.wordsPerMinute }),
  });
  if (!content.valid) {
    return invalidResult(content.diagnostics);
  }

  const reader = projectPublicationReader(content.value, {
    audience: input.audience,
  });
  if (!reader.valid) {
    return invalidResult(reader.diagnostics);
  }

  // Cross-checked against every section the publication compiled, not against
  // the audience projection. A catalog describes the publication, so narration
  // for a section this audience does not see is still narration of a section that
  // exists, and reporting it as unknown would be a false alarm on every public
  // build of a publication with drafts.
  let audio: BuiltPublicationReader["audio"];
  const declaredAudio = loaded.value.publication.audio;
  const catalog = loaded.value.audioCatalog;

  // Both directions in one place, because the two variables carry one invariant
  // and splitting them left it unprovable. The loader reads a catalog only because
  // the manifest declared one, so a disagreement either way is worth a name.
  if (declaredAudio === undefined) {
    if (catalog !== undefined) {
      // An engine defect rather than an author mistake, reported instead of
      // assumed away.
      return invalidResult([
        buildDiagnostic(
          "build.audio_catalog_undeclared",
          "/audio/catalog",
          "A clip catalog was loaded for a publication whose manifest declares none.",
          {},
        ),
      ]);
    }
  } else if (catalog === undefined) {
    // Declared narration with no catalog produced no narration and said nothing,
    // which is the worst of the three possible behaviours. The adapter is recorded
    // rather than executed, so a catalog is the only route by which clips reach the
    // engine, and an author who declared audio and got silence deserves to be told
    // why rather than left to infer it.
    return invalidResult([
      buildDiagnostic(
        "build.audio_catalog_missing",
        "/audio/catalog",
        `This publication declares audio through ${declaredAudio.adapter.package} but names no catalog. The adapter is recorded for provenance and never executed, so a catalog is the only way narration reaches a build. Add audio.catalog, or remove the audio block.`,
        { adapterPackage: declaredAudio.adapter.package },
      ),
    ]);
  } else {
    const resolved = resolvePublicationAudio({
      catalog: catalog.catalog,
      declaredCatalogPath: catalog.path,
      sectionIds: works.value.flatMap((work) =>
        work.sections.map((section) => section.id),
      ),
    });
    if (!resolved.valid) {
      return invalidResult(resolved.diagnostics);
    }
    const envelope = buildAudioEnvelope({
      audio: resolved.value,
      adapter: {
        package: declaredAudio.adapter.package,
        ...(declaredAudio.adapter.config === undefined
          ? {}
          : { config: declaredAudio.adapter.config }),
      },
      publicationId: reader.value.publicationId,
      // The reader artifact's identity, carried rather than recomputed, so both
      // artifacts of one build agree and a client can tell which is stale.
      buildId: reader.value.buildId,
      catalogText: catalog.text,
    });
    if (!envelope.valid) {
      return invalidResult(envelope.diagnostics);
    }
    audio = Object.freeze({
      resolved: resolved.value,
      envelope: envelope.value.envelope,
      text: envelope.value.text,
    });
  }

  let sync: BuiltPublicationReader["sync"];
  const declaredSync = loaded.value.publication.sync;
  if (declaredSync !== undefined) {
    const resolvedSync = resolvePublicationSync(declaredSync);
    if (!resolvedSync.valid) {
      return invalidResult(resolvedSync.diagnostics);
    }
    const envelope = buildSyncEnvelope({
      sync: resolvedSync.value,
      publicationId: reader.value.publicationId,
      buildId: reader.value.buildId,
    });
    if (!envelope.valid) {
      return invalidResult(envelope.diagnostics);
    }
    sync = Object.freeze({
      resolved: resolvedSync.value,
      envelope: envelope.value.envelope,
      text: envelope.value.text,
    });
  }

  let text: string;
  try {
    text = serializePublicationReaderEnvelope(reader.value);
  } catch (error) {
    return invalidResult([
      buildDiagnostic(
        "build.serialization_failed",
        "",
        `The projected reader envelope could not be serialized: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { reason: "unserializableEnvelope" },
      ),
    ]);
  }

  return Object.freeze({
    valid: true as const,
    value: Object.freeze({
      content: content.value,
      reader: reader.value,
      text,
      ...(audio === undefined ? {} : { audio }),
      ...(sync === undefined ? {} : { sync }),
    }),
    diagnostics: sortAndFreezeDiagnostics([]),
  });
}
