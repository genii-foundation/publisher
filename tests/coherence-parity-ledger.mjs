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

// Every narration and synchronization capability a working publication has, and
// where each one lives after this engine takes over.
//
// This exists because "no functionality is lost" is a claim, and a claim about
// dozens of features is worth nothing unless something enumerates them. The
// enumeration is the point. A capability nobody wrote down is a capability nobody
// notices the absence of until a reader does.
//
// The inventory was taken from a deployed publication with narration and
// cross-device synchronization in production. It records capabilities rather than
// files, because a file that moves is not a loss and a feature that quietly stops
// working is.
//
// Nothing here depends on that repository existing. Each entry names its own
// evidence inside this one, and the test beside this file checks that the evidence
// is real.
//
// `home` says who owns the capability now:
//
//   engine    this engine implements it
//   provider  the reference provider package implements it
//   host      the author's own application keeps it, unchanged
//   author    an author's own tooling, outside any published package
//
// `status` says what happened to it:
//
//   preserved  works as before, wherever it now lives
//   upgraded   works better than before, and `why` says how
//   added      did not exist before
//   blocked    cannot work yet, and `blockedBy` names the decision it waits on
//
// A `host` home is not a euphemism for lost. Playback, word highlighting, and
// offline caching are client code an author owns, and moving them into the engine
// would take control away from the author for no benefit. What matters is that the
// engine supplies what that code needs, which is what the `engineProvides` field
// records.

/** @typedef {"engine" | "provider" | "host" | "author"} ParityHome */
/** @typedef {"preserved" | "upgraded" | "added" | "blocked"} ParityStatus */

export const AUDIO_PARITY = Object.freeze([
  {
    id: "audio.catalog.contract",
    capability: "A clip catalog naming voices and per-section recordings",
    home: "engine",
    status: "upgraded",
    why: "The published catalog had a TypeScript type and no schema, so a malformed one failed at a reader. It now has a contract, and the deployed 551 clip catalog validates against it unchanged apart from one section identifier that exceeds the engine's bound.",
    evidence: { schema: "audio-catalog.schema.json" },
  },
  {
    id: "audio.catalog.delivery",
    capability: "The catalog reaching a client as one fetchable file",
    home: "engine",
    status: "preserved",
    why: "Fetched once and lazily, exactly as before. The engine materializes it under the renderer's declared public path instead of a copy step.",
    evidence: { export: "buildAudioEnvelope" },
  },
  {
    id: "audio.catalog.cross_check",
    capability: "Catalog entries agreeing with the publication",
    home: "engine",
    status: "added",
    why: "Nothing checked this before. A clip for a renamed or removed section was silently ignored at read time; it is now a build diagnostic naming the section.",
    evidence: { export: "resolvePublicationAudio" },
  },
  {
    id: "audio.catalog.staleness",
    capability: "Noticing that the published catalog no longer matches the build",
    home: "engine",
    status: "added",
    why: "The catalog was copied into the public directory with no binding to a build, so a stale one was indistinguishable from a current one. It now carries the reader artifact's build identity and its own source digest, and build --check fails on either going stale.",
    evidence: { schema: "audio-envelope.schema.json" },
  },
  {
    id: "audio.pipeline.provenance",
    capability: "Knowing which tool produced a narration run",
    home: "engine",
    status: "added",
    why: "The adapter was required by the schema and read by nothing. It is now recorded in the audio envelope with its configuration, so a run can be reproduced without guessing.",
    evidence: { schema: "audio-envelope.schema.json" },
  },
  {
    id: "audio.timings.sidecar",
    capability: "Per-word timings fetched only when a clip plays",
    home: "host",
    status: "preserved",
    engineProvides:
      "the presence and byte size of each sidecar, with its URL derived from the clip href rather than carried",
    why: "Carrying a sidecar URL per clip measured about 88 KB on a document every page fetches. The published design avoided that and the engine keeps the avoidance.",
    evidence: { schemaProperty: "timingsByteSize" },
  },
  {
    id: "audio.timings.alignment",
    capability: "Aligning recognizer output to source words",
    home: "author",
    status: "preserved",
    why: "A generation concern, not a publishing one. The engine never sees a recognizer.",
  },
  {
    id: "audio.anchors.words",
    capability: "Deriving word anchors from rendered text",
    home: "host",
    status: "preserved",
    engineProvides: "the rendered section text the anchors are computed over",
    why: "Computed on the client, so no per-word data is transmitted at all. Nothing about that needs the engine.",
  },
  {
    id: "audio.playback.engine",
    capability: "Play, pause, seek, rate, and queue across sections",
    home: "host",
    status: "preserved",
    engineProvides: "the resolved clip list per voice, in reader order",
    why: "Client behaviour an author owns. Moving it into the engine would take control away for no benefit.",
  },
  {
    id: "audio.voices.selection",
    capability: "Choosing a voice and remembering the choice",
    home: "host",
    status: "preserved",
    engineProvides: "voices in declared order, each with a label, provider, and model",
    why: "A preference stored locally. The engine supplies the list and takes no view on which a reader wants.",
  },
  {
    id: "audio.offline.cache",
    capability: "Caching clips for offline listening",
    home: "host",
    status: "preserved",
    engineProvides: "stable clip URLs and byte sizes, so a cache can budget before fetching",
    why: "A client storage concern. The engine's contribution is that the sizes are in the catalog.",
  },
  {
    id: "audio.statistics.duration",
    capability: "Total and per-section recorded duration",
    home: "host",
    status: "preserved",
    engineProvides: "durationSeconds per clip, plus narrated and unnarrated section counts per voice",
    why: "Aggregation over the catalog. The engine now also reports coverage at build time, which the publication had to compute for itself.",
  },
  {
    id: "audio.navigation.event",
    capability: "Navigating to a section and starting playback there",
    home: "host",
    status: "preserved",
    why: "A cross-component event inside the author's own client code. The engine has no part in it.",
  },
  {
    id: "audio.generation.pipeline",
    capability: "Generating narration, resuming a run, publishing clips",
    home: "author",
    status: "preserved",
    why: "Author tooling. The engine ingests what it produces and never runs it, which is why the adapter is recorded rather than executed.",
  },
]);

export const SYNC_PARITY = Object.freeze([
  {
    id: "sync.progress",
    capability: "Reading position synchronized across devices",
    home: "provider",
    status: "preserved",
    engineProvides: "the progress capability in a closed vocabulary, published to the client",
    evidence: { migration: "0001_reader_sync_core.sql", table: "reader_progress" },
  },
  {
    id: "sync.bookmarks",
    capability: "Bookmarks synchronized across devices without losing edits",
    home: "provider",
    status: "preserved",
    why: "The merge function, its row lock, and the revocation of direct writes are all carried across. Without the revocation the lost-update race is fully reachable, which is the part easiest to drop.",
    evidence: {
      migration: "0005_atomic_bookmark_merge.sql",
      function: "merge_reader_bookmarks",
    },
  },
  {
    id: "sync.bookmarks.tombstones",
    capability: "A deletion travelling between devices instead of being resurrected",
    home: "provider",
    status: "preserved",
    why: "A tombstone is absorbing and is compared before timestamps, so a device with a skewed clock cannot undelete a bookmark.",
    evidence: { migration: "0005_atomic_bookmark_merge.sql" },
  },
  {
    id: "sync.consent",
    capability: "Recording an opt-in grant and its copy version",
    home: "provider",
    status: "preserved",
    engineProvides: "consent pinned to opt-in in the manifest, the engine, and the published artifact",
    why: "Not a capability a reader chooses. It is a precondition, so it is pinned rather than offered.",
    evidence: {
      migration: "0001_reader_sync_core.sql",
      table: "reader_sync_consent",
    },
  },
  {
    id: "sync.engagement",
    capability: "An append-only engagement log with per-reader retention",
    home: "provider",
    status: "preserved",
    why: "Retention, the size bounds, and the absence of an update grant are all carried across. A client that could rewrite entries could rewrite its own retention.",
    evidence: {
      migration: "0002_reader_engagement.sql",
      table: "reader_engagement_events",
    },
  },
  {
    id: "sync.ownership",
    capability: "A reader reaching only their own rows",
    home: "provider",
    status: "preserved",
    why: "Row level security with ownership on both the read and write side, plus explicit privileges with anonymous access revoked, because row level security is not trusted alone.",
    evidence: { migration: "0004_reader_sync_api_grants.sql" },
  },
  {
    id: "sync.bounds",
    capability: "Bounded storage per reader",
    home: "provider",
    status: "preserved",
    why: "A self-registered account reaches these tables with the public anonymous key, so a client cap is not a security boundary. Every reader-controlled blob and text column is bounded in the database.",
    evidence: { migration: "0003_reader_bookmarks.sql" },
  },
  {
    id: "sync.data_deletion",
    capability: "A reader removing every row they own",
    home: "provider",
    status: "upgraded",
    why: "Four separate client deletes became one function. Separate statements can fail part way and leave a reader who asked to be forgotten partly remembered.",
    evidence: {
      migration: "0006_reader_data_deletion.sql",
      function: "delete_reader_sync_data",
    },
  },
  {
    id: "sync.local_fallback",
    capability: "Reading unaffected when a reader declines or a provider is unreachable",
    home: "engine",
    status: "upgraded",
    why: "Previously a property of the client code. It is now pinned in the manifest, re-checked by the engine, and carried into the published artifact, so a client cannot be built against a publication that relaxed it.",
    evidence: { export: "resolvePublicationSync" },
  },
  {
    id: "sync.capability_declaration",
    capability: "A publication declaring what it synchronizes",
    home: "engine",
    status: "upgraded",
    why: "The declaration existed and reached nothing, and its list accepted any identifier. The vocabulary is closed and the declaration is published, so a manifest and an implementation cannot disagree silently.",
    evidence: { schema: "sync-envelope.schema.json" },
  },
  {
    id: "sync.config_containment",
    capability: "Provider configuration staying out of public files",
    home: "engine",
    status: "added",
    why: "Nothing enforced this before because nothing published a sync artifact. The envelope schema has no field for configuration and refuses additional properties, so the mistake is unavailable rather than discouraged.",
    evidence: { schema: "sync-envelope.schema.json" },
  },
  {
    id: "sync.auth.session",
    capability: "Signing in by emailed link or code, and holding a session",
    home: "host",
    status: "blocked",
    blockedBy: "#19",
    why: "Needs an authentication callback route. That determines a public URL, so it is the engine's to own, and how a host acquires it is undecided because init deliberately does not know the publication.",
  },
  {
    id: "sync.account_deletion",
    capability: "Deleting the authentication account itself",
    home: "host",
    status: "blocked",
    blockedBy: "#19",
    why: "Needs a route holding a privileged key. The database half is done and a reader can remove every row they own; removing the account is the part that waits.",
  },
]);

export const PARITY_LEDGER = Object.freeze([...AUDIO_PARITY, ...SYNC_PARITY]);

export const PARITY_HOMES = Object.freeze([
  "author",
  "engine",
  "host",
  "provider",
]);

export const PARITY_STATUSES = Object.freeze([
  "added",
  "blocked",
  "preserved",
  "upgraded",
]);
