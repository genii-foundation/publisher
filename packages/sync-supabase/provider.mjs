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

// What this provider implements, declared as data.
//
// Data rather than a function the engine calls, matching how host capabilities and
// migration edges are declared. The engine does not read this at build time and is
// not going to: resolving a provider package would make a build depend on a
// client-side dependency being installed, and an author building in continuous
// integration may not have it. What reads this is the test suite in this repository,
// which is what keeps the declaration honest.
//
// Every capability here maps to migrations that create its storage, its ownership
// policy, its privileges, and its bounds. A capability listed without those is a lie
// this package would be telling the engine.

export const PUBLISHER_SYNC_PROVIDER = Object.freeze({
  kind: "genii.publisher.sync-provider",
  package: "@genii-foundation/publisher-sync-supabase",

  /**
   * Capabilities this provider serves, from the engine's closed vocabulary.
   *
   * `account-deletion` includes both halves: the database function removes every
   * synchronized row the reader owns, and the server adapter authenticates the
   * reader before invoking the privileged authentication-user deletion.
   */
  capabilities: Object.freeze([
    "account-deletion",
    "bookmarks",
    "engagement",
    "progress",
  ]),

  /** Where each capability's storage lives, or null when it needs no table. */
  tables: Object.freeze({
    "account-deletion": null,
    bookmarks: "reader_bookmarks",
    engagement: "reader_engagement_events",
    progress: "reader_progress",
  }),

  /**
   * Consent is not a capability, and it has a table anyway.
   *
   * Every synchronizing publication is opt-in, so the grant is a precondition
   * rather than something a reader chooses to synchronize. It still has to be
   * recorded somewhere.
   */
  consentTable: "reader_sync_consent",

  /** Applied in filename order. Each is written to be re-runnable. */
  migrations: Object.freeze([
    "0001_reader_sync_core.sql",
    "0002_reader_engagement.sql",
    "0003_reader_bookmarks.sql",
    "0004_reader_sync_api_grants.sql",
    "0005_atomic_bookmark_merge.sql",
    "0006_reader_data_deletion.sql",
    "0007_publication_scope.sql",
  ]),

  /**
   * Functions this provider defines, and the only client write path for bookmarks.
   *
   * A direct upsert on the bookmarks table is revoked deliberately, so this is not
   * a convenience wrapper: it is the mechanism that stops two devices from losing
   * one another's changes.
   */
  functions: Object.freeze({
    mergeBookmarks: "merge_reader_bookmarks",
    deleteReaderData: "delete_reader_sync_data",
    setUpdatedAt: "set_updated_at",
    pruneEngagementEvents: "prune_reader_engagement_events",
  }),

  /** Server-only host integration required to activate this provider. */
  hostIntegration: Object.freeze({
    configPath: "publisher.config.ts",
    serverExport: "@genii-foundation/publisher-sync-supabase/server",
    environment: Object.freeze([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]),
  }),
});
