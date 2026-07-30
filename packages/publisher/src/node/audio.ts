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

// Cross-checking a published clip catalog against the publication it claims to
// narrate.
//
// The important decision here is what this module refuses to do.
//
// `audioVersionId` is opaque. A working pipeline composes it by appending a
// digest of the section text to the section identifier, and that digest is the
// pipeline's own: sha256 over newline-normalized body text, truncated. The engine
// computes different hashes, over compiled blocks and canonical JSON, because it
// hashes for different reasons. If the engine imposed its own derivation, then
// every clip in an existing catalog would be judged stale the first time it ran,
// and the remedy would be regenerating real narration. An engine that invents a
// reason to discard a publication's audio is worse than an engine with no audio
// support.
//
// So staleness stays a pipeline decision, and this module checks only what can be
// checked without assuming a derivation:
//
//   - a clip names a section the publication actually contains
//   - a voice does not claim two different recordings of one section
//   - a clip is not listed twice
//   - a voice identifier is not reused
//   - the catalog is within its declared ceilings
//
// Coverage is reported as data rather than as a diagnostic. A publication part
// way through generating narration is a normal state, and an engine that refuses
// to build until every section is narrated would make the first run impossible.

import { createHash } from "node:crypto";

import { canonicalizeJson } from "@genii-foundation/publisher-content";
import {
  PUBLICATION_PROTOCOL_LIMITS,
  validateAudioEnvelopeShape,
} from "@genii-foundation/publisher-schema";
import type {
  AudioClip,
  AudioClipCatalog,
  AudioEnvelope,
  AudioEnvelopeAdapterRecord,
  Diagnostic,
  JSONValue,
  ValidationResult,
} from "@genii-foundation/publisher-schema";

import {
  loaderDiagnostic,
  sortAndFreezeDiagnostics,
} from "./diagnostics.js";
import {
  PUBLISHER_VERSION,
} from "../index.js";

const AUDIO_ENVELOPE_SCHEMA_URL =
  "https://publisher.genii.foundation/schemas/audio-envelope.schema.json" as const;
const AUDIO_ENVELOPE_SCHEMA_VERSION = "1.0" as const;

/** One voice's clips, after cross-checking, with its coverage recorded. */
export interface ResolvedAudioVoice {
  readonly id: string;
  readonly label: string;
  readonly provider?: string;
  readonly model?: string;
  readonly clips: readonly AudioClip[];
  /** Sections this voice has narration for. */
  readonly narratedSectionCount: number;
  /** Sections in the publication with no narration from this voice. */
  readonly unnarratedSectionCount: number;
}

export interface ResolvedPublicationAudio {
  readonly declaredCatalogPath: string;
  readonly generatedAt?: string;
  readonly voices: readonly ResolvedAudioVoice[];
  readonly clipCount: number;
  /** Sections in the publication, whether narrated or not. */
  readonly sectionCount: number;
}

export interface ResolvePublicationAudioInput {
  readonly catalog: AudioClipCatalog;
  readonly declaredCatalogPath: string;
  /** Every section identity the built publication contains. */
  readonly sectionIds: readonly string[];
}

function audioDiagnostic(
  code: string,
  path: string,
  message: string,
  params: Readonly<Record<string, unknown>>,
  documentPath: string,
): Diagnostic {
  return loaderDiagnostic(code, path, message, "audio", params, documentPath);
}

/**
 * Cross-checks a catalog against the sections a publication actually has.
 *
 * Reports every problem rather than the first. A catalog is generated, so when it
 * disagrees with the publication it usually disagrees in bulk, and learning that
 * one clip is wrong per run would be useless.
 */
export function resolvePublicationAudio(
  input: ResolvePublicationAudioInput,
): ValidationResult<ResolvedPublicationAudio> {
  const { catalog, declaredCatalogPath } = input;
  const sections = new Set(input.sectionIds);
  const diagnostics: Diagnostic[] = [];
  const voices: ResolvedAudioVoice[] = [];
  const seenVoiceIds = new Set<string>();
  let clipCount = 0;

  if (catalog.voices.length > PUBLICATION_PROTOCOL_LIMITS.maximumAudioVoices) {
    diagnostics.push(
      audioDiagnostic(
        "audio.catalog.too_many_voices",
        "/voices",
        `The catalog declares ${catalog.voices.length} voices and the limit is ${PUBLICATION_PROTOCOL_LIMITS.maximumAudioVoices}.`,
        {
          actualItems: catalog.voices.length,
          maximumItems: PUBLICATION_PROTOCOL_LIMITS.maximumAudioVoices,
        },
        declaredCatalogPath,
      ),
    );
  }

  for (const [voiceIndex, voice] of catalog.voices.entries()) {
    const voicePointer = `/voices/${voiceIndex}`;
    if (seenVoiceIds.has(voice.id)) {
      diagnostics.push(
        audioDiagnostic(
          "audio.voice.duplicate",
          `${voicePointer}/id`,
          `Voice "${voice.id}" is declared more than once, so which recording a reader hears would depend on iteration order.`,
          { voiceId: voice.id },
          declaredCatalogPath,
        ),
      );
      continue;
    }
    seenVoiceIds.add(voice.id);

    const clips: AudioClip[] = [];
    // Keyed by section, holding the version already accepted for it. A second
    // version for one section is the ambiguity worth refusing: nothing in the
    // catalog says which of two recordings is current.
    const versionBySection = new Map<string, string>();
    const seenClips = new Set<string>();

    for (const [clipIndex, clip] of voice.sections.entries()) {
      const clipPointer = `${voicePointer}/sections/${clipIndex}`;
      clipCount += 1;

      if (!sections.has(clip.sectionId)) {
        diagnostics.push(
          audioDiagnostic(
            "audio.clip.unknown_section",
            `${clipPointer}/sectionId`,
            `Voice "${voice.id}" has a clip for section "${clip.sectionId}", which this publication does not contain. A renamed or removed section leaves its narration behind in the catalog.`,
            { voiceId: voice.id, sectionId: clip.sectionId },
            declaredCatalogPath,
          ),
        );
        continue;
      }

      const clipKey = `${clip.sectionId} ${clip.audioVersionId}`;
      if (seenClips.has(clipKey)) {
        diagnostics.push(
          audioDiagnostic(
            "audio.clip.duplicate",
            clipPointer,
            `Voice "${voice.id}" lists section "${clip.sectionId}" at version "${clip.audioVersionId}" more than once.`,
            {
              voiceId: voice.id,
              sectionId: clip.sectionId,
              audioVersionId: clip.audioVersionId,
            },
            declaredCatalogPath,
          ),
        );
        continue;
      }
      seenClips.add(clipKey);

      const existingVersion = versionBySection.get(clip.sectionId);
      if (
        existingVersion !== undefined &&
        existingVersion !== clip.audioVersionId
      ) {
        diagnostics.push(
          audioDiagnostic(
            "audio.clip.ambiguous_version",
            `${clipPointer}/audioVersionId`,
            `Voice "${voice.id}" has two recordings of section "${clip.sectionId}", at versions "${existingVersion}" and "${clip.audioVersionId}", and nothing says which is current. Publish one clip per section per voice.`,
            {
              voiceId: voice.id,
              sectionId: clip.sectionId,
              versions: [existingVersion, clip.audioVersionId],
            },
            declaredCatalogPath,
          ),
        );
        continue;
      }
      versionBySection.set(clip.sectionId, clip.audioVersionId);
      clips.push(clip);
    }

    voices.push(
      Object.freeze({
        id: voice.id,
        label: voice.label,
        ...(voice.provider === undefined ? {} : { provider: voice.provider }),
        ...(voice.model === undefined ? {} : { model: voice.model }),
        clips: Object.freeze(clips),
        narratedSectionCount: versionBySection.size,
        unnarratedSectionCount: sections.size - versionBySection.size,
      }),
    );
  }

  if (clipCount > PUBLICATION_PROTOCOL_LIMITS.maximumAudioClips) {
    diagnostics.push(
      audioDiagnostic(
        "audio.catalog.too_many_clips",
        "/voices",
        `The catalog declares ${clipCount} clips and the limit is ${PUBLICATION_PROTOCOL_LIMITS.maximumAudioClips}.`,
        {
          actualItems: clipCount,
          maximumItems: PUBLICATION_PROTOCOL_LIMITS.maximumAudioClips,
        },
        declaredCatalogPath,
      ),
    );
  }

  if (diagnostics.length > 0) {
    return Object.freeze({
      valid: false as const,
      diagnostics: sortAndFreezeDiagnostics(diagnostics),
    });
  }

  return Object.freeze({
    valid: true as const,
    value: Object.freeze({
      declaredCatalogPath,
      ...(catalog.generatedAt === undefined
        ? {}
        : { generatedAt: catalog.generatedAt }),
      voices: Object.freeze(voices),
      clipCount,
      sectionCount: sections.size,
    }),
    diagnostics: Object.freeze([]),
  });
}

export interface BuildAudioEnvelopeInput {
  readonly audio: ResolvedPublicationAudio;
  /**
   * The pipeline the publication declared, recorded rather than executed.
   *
   * The schema requires an adapter and nothing resolved it, so a publication
   * could name a package that does not exist and build cleanly. It still is not
   * executed, because the renderer has no audio surface at all and there is
   * nothing for the engine to call. What it now does is reach the envelope, so a
   * narration run can be traced to the tool that produced it.
   */
  readonly adapter: AudioEnvelopeAdapterRecord;
  readonly publicationId: string;
  /**
   * The reader artifact's build identity, carried verbatim rather than recomputed.
   *
   * Recomputing it would produce a second identity for one build, and two
   * artifacts that cannot be checked against each other are worse than one.
   */
  readonly buildId: string;
  /** Exact catalog text, so the envelope records what it was derived from. */
  readonly catalogText: string;
}

export interface BuiltAudioEnvelope {
  readonly envelope: AudioEnvelope;
  /** Canonical JSON text, exactly as it would be written. */
  readonly text: string;
}

/**
 * Builds the narration artifact a client fetches.
 *
 * Separate from the reader artifact because it is fetched separately, lazily, and
 * usually not at all. A measured catalog is 278 KB for 551 clips, which is
 * unremarkable as a file requested when a reader presses play and unacceptable
 * inside a document every page loads.
 *
 * Validated before it is returned. The engine writes this one, so a shape error
 * here is the engine's own, and refusing it at the build is better than serving it
 * to a browser.
 */
export function buildAudioEnvelope(
  input: BuildAudioEnvelopeInput,
): ValidationResult<BuiltAudioEnvelope> {
  const { audio } = input;

  // Guarded rather than assumed, because this module returns diagnostics and
  // never throws, and a caller reaching in with a malformed input used to get a
  // TypeError naming an internal field. Found by a test that failed for the wrong
  // reason, which is the only way this kind of gap surfaces.
  if (
    input.adapter === null ||
    typeof input.adapter !== "object" ||
    typeof input.adapter.package !== "string" ||
    input.adapter.package.length === 0
  ) {
    return Object.freeze({
      valid: false as const,
      diagnostics: sortAndFreezeDiagnostics([
        audioDiagnostic(
          "audio.envelope.adapter_missing",
          "/source/adapter",
          "An audio envelope requires the declared adapter, which is recorded for provenance even though it is never executed.",
          { reason: "missingAdapter" },
          audio.declaredCatalogPath,
        ),
      ]),
    });
  }
  const envelope = {
    $schema: AUDIO_ENVELOPE_SCHEMA_URL,
    schemaVersion: AUDIO_ENVELOPE_SCHEMA_VERSION,
    publicationId: input.publicationId,
    engineVersion: PUBLISHER_VERSION,
    buildId: input.buildId,
    source: {
      adapter: {
        package: input.adapter.package,
        ...(input.adapter.config === undefined
          ? {}
          : { config: input.adapter.config }),
      },
      catalogPath: audio.declaredCatalogPath,
      catalogSha256: `sha256:${createHash("sha256")
        .update(input.catalogText, "utf8")
        .digest("hex")}`,
      ...(audio.generatedAt === undefined
        ? {}
        : { generatedAt: audio.generatedAt }),
    },
    voices: audio.voices.map((voice) => ({
      id: voice.id,
      label: voice.label,
      ...(voice.provider === undefined ? {} : { provider: voice.provider }),
      ...(voice.model === undefined ? {} : { model: voice.model }),
      // Named `sections` in the catalog and `clips` here. The catalog keeps the
      // name published pipelines already emit; the envelope is the engine's own
      // document and calls them what they are.
      clips: voice.clips.map((clip) => ({ ...clip })),
      narratedSectionCount: voice.narratedSectionCount,
      unnarratedSectionCount: voice.unnarratedSectionCount,
    })),
    statistics: {
      voiceCount: audio.voices.length,
      clipCount: audio.clipCount,
      sectionCount: audio.sectionCount,
    },
  };

  const validated = validateAudioEnvelopeShape(envelope);
  if (!validated.valid) {
    return Object.freeze({
      valid: false as const,
      diagnostics: sortAndFreezeDiagnostics([
        ...validated.diagnostics.map((diagnostic) =>
          Object.freeze({
            ...diagnostic,
            documentPath: audio.declaredCatalogPath,
          }),
        ),
      ]),
    });
  }

  let text: string;
  try {
    // Canonical, and the same canonicalizer the content and reader envelopes use.
    // Byte stability across runtimes is what lets a check compare digests rather
    // than parse and compare structures.
    text = `${canonicalizeJson(envelope as unknown as JSONValue)}\n`;
  } catch (error) {
    return Object.freeze({
      valid: false as const,
      diagnostics: sortAndFreezeDiagnostics([
        audioDiagnostic(
          "audio.envelope.unserializable",
          "",
          `The audio envelope could not be serialized: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { reason: "unserializableEnvelope" },
          audio.declaredCatalogPath,
        ),
      ]),
    });
  }

  return Object.freeze({
    valid: true as const,
    value: Object.freeze({ envelope: validated.value, text }),
    diagnostics: Object.freeze([]),
  });
}
