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

// The reference provider's schema, held to every hardening it carries.
//
// This exists because the dangerous failure mode for this package is not a crash. It
// is a future edit that recreates these tables while dropping one protection, leaving
// something with an identical interface that is quietly a downgrade. Row level
// security removed, a trigger's search_path unpinned, a size bound deleted because a
// reader hit it, or the bookmark merge's revocations rolled back as though they were
// harmless permissions.
//
// Every property below was written down because it is load-bearing, and asserted
// because prose in a README protects nothing.
//
// These are static assertions over SQL text, not a live database. They cannot prove
// the schema behaves correctly; they prove that a protection has not been deleted.
// That is the failure this package is most likely to suffer, and it is worth catching
// cheaply.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PUBLISHER_SYNC_PROVIDER } from "../packages/sync-supabase/provider.mjs";
import { SYNC_CAPABILITIES } from "../schemas/dist/index.js";

const packageRoot = fileURLToPath(
  new URL("../packages/sync-supabase/", import.meta.url),
);
const migrationRoot = join(packageRoot, "migrations");

const migrationNames = readdirSync(migrationRoot).sort();
const migrations = new Map(
  migrationNames.map((name) => [
    name,
    readFileSync(join(migrationRoot, name), "utf8"),
  ]),
);
/** Every migration concatenated, for properties that span files. */
const allSql = migrationNames
  .map((name) => migrations.get(name))
  .join("\n");

/** Tables holding reader-owned rows. */
const readerTables = [
  "reader_sync_consent",
  "reader_progress",
  "reader_bookmarks",
  "reader_engagement_events",
];

// ------------------------------------------------- the declaration is honest

test("the provider serves every capability the engine defines", () => {
  // A vocabulary entry with no provider is a capability an author can declare and
  // never receive. If the engine adds one, this fails until something implements it.
  for (const capability of SYNC_CAPABILITIES) {
    assert.ok(
      PUBLISHER_SYNC_PROVIDER.capabilities.includes(capability),
      `the engine defines ${capability} and this provider does not serve it`,
    );
  }
});

test("the provider claims no capability the engine does not define", () => {
  for (const capability of PUBLISHER_SYNC_PROVIDER.capabilities) {
    assert.ok(
      SYNC_CAPABILITIES.includes(capability),
      `${capability} is not in the engine's vocabulary`,
    );
  }
});

test("every declared migration exists, and every migration is declared", () => {
  // A migration on disk that the descriptor omits never gets applied by anything
  // reading the descriptor, which is the quietest way to lose a protection.
  assert.deepEqual(
    [...PUBLISHER_SYNC_PROVIDER.migrations],
    migrationNames,
    "the declared migration list and the directory disagree",
  );
  assert.ok(migrationNames.length > 0);
});

test("every capability's table is created by a migration", () => {
  for (const [capability, table] of Object.entries(
    PUBLISHER_SYNC_PROVIDER.tables,
  )) {
    if (table === null) {
      continue;
    }
    assert.match(
      allSql,
      new RegExp(`create table if not exists public\\.${table}\\b`, "u"),
      `${capability} names table ${table} and no migration creates it`,
    );
  }
  assert.match(
    allSql,
    new RegExp(
      `create table if not exists public\\.${PUBLISHER_SYNC_PROVIDER.consentTable}\\b`,
      "u",
    ),
  );
});

test("every declared function is defined", () => {
  for (const name of Object.values(PUBLISHER_SYNC_PROVIDER.functions)) {
    assert.match(
      allSql,
      new RegExp(`create or replace function public\\.${name}\\b`, "u"),
      `the descriptor names function ${name} and no migration defines it`,
    );
  }
});

// -------------------------------------------------------- ownership holds

test("row level security is enabled on every reader table", () => {
  // Without it, the public anonymous key reaches every row in the table.
  for (const table of readerTables) {
    assert.match(
      allSql,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "u",
      ),
      `${table} does not enable row level security`,
    );
  }
});

test("every reader table has an ownership policy on both sides", () => {
  // `using` governs reads and `with check` governs writes. A policy with only the
  // first lets a reader write rows belonging to somebody else.
  for (const table of readerTables) {
    // indexOf returns -1 when absent, and slice(-1) yields the last character, so
    // the obvious length guard could never fail. Checked explicitly instead.
    const start = allSql.indexOf(`on public.${table}\nfor all`);
    assert.notEqual(
      start,
      -1,
      `${table} has no for-all ownership policy`,
    );
    const clause = allSql.slice(start, start + 200);
    assert.match(
      clause,
      /using \(auth\.uid\(\) = user_id\)/u,
      `${table} does not restrict reads to the owner`,
    );
    assert.match(
      clause,
      /with check \(auth\.uid\(\) = user_id\)/u,
      `${table} does not restrict writes to the owner`,
    );
  }
});

test("every synchronized row is scoped by publication as well as reader", () => {
  const scoped = migrations.get("0007_publication_scope.sql") ?? "";
  for (const table of readerTables) {
    assert.match(
      scoped,
      new RegExp(`alter table public\\.${table}\\s+add column if not exists publication_id text`, "u"),
      `${table} never gains publication identity`,
    );
    assert.match(
      scoped,
      new RegExp(`alter table public\\.${table}\\s+alter column publication_id set not null`, "u"),
      `${table} permits an unscoped new row`,
    );
    assert.match(
      scoped,
      new RegExp(`add constraint ${table}_publication_id\\b`, "u"),
      `${table} does not bound publication identity`,
    );
  }
  for (const table of [
    "reader_sync_consent",
    "reader_progress",
    "reader_bookmarks",
  ]) {
    assert.match(
      scoped,
      new RegExp(`add constraint ${table}_pkey\\s+primary key \\(user_id, publication_id\\)`, "u"),
      `${table} is not keyed by reader and publication`,
    );
  }
  assert.match(
    scoped,
    /unique \(user_id, publication_id, client_event_id\)/u,
  );
});

test("legacy unscoped rows are preserved but excluded from new writes", () => {
  const scoped = migrations.get("0007_publication_scope.sql") ?? "";
  for (const table of readerTables) {
    assert.match(
      scoped,
      new RegExp(`update public\\.${table}\\s+set publication_id = '__legacy_unscoped__'\\s+where publication_id is null`, "u"),
      `${table} discards or guesses the owner of a legacy row`,
    );
  }
  assert.match(
    scoped,
    /incoming_publication_id = '__legacy_unscoped__'/u,
    "the live merge accepts the reserved legacy marker",
  );
  assert.match(
    scoped,
    /drop function if exists public\.merge_reader_bookmarks\(jsonb, integer\)/u,
    "the old unscoped merge remains callable",
  );
});

test("publication scoping can be reviewed and rerun without duplicate keys", () => {
  const scoped = migrations.get("0007_publication_scope.sql") ?? "";
  for (const constraint of [
    "reader_sync_consent_pkey",
    "reader_progress_pkey",
    "reader_bookmarks_pkey",
    "reader_engagement_events_user_publication_event_key",
  ]) {
    assert.match(
      scoped,
      new RegExp(`drop constraint if exists ${constraint}\\b`, "u"),
      `${constraint} is recreated without removing its prior reviewed version`,
    );
  }
  assert.match(
    scoped,
    /drop index if exists public\.reader_engagement_events_user_publication_event_at_idx/u,
  );
});

test("anonymous access is revoked from every reader table", () => {
  // Row level security is not trusted alone. When automatic table exposure is off
  // the API still needs privileges, and an unauthenticated reader is kept out by
  // revocation rather than by the absence of a policy.
  for (const table of readerTables) {
    assert.match(
      allSql,
      new RegExp(`revoke all on table public\\.${table} from anon`, "u"),
      `${table} does not revoke anonymous access`,
    );
  }
  assert.match(
    allSql,
    /revoke all on sequence public\.reader_engagement_events_id_seq from anon/u,
    "the event log's sequence is still reachable anonymously",
  );
});

test("the event log grants no update, so history cannot be rewritten", () => {
  // A client that could rewrite entries could rewrite its own retention.
  //
  // Parsed as whole statements rather than by slicing around an offset. The first
  // version of this happened to work by finding the right text through two index
  // lookups, which is the kind of test that stops meaning anything after an
  // unrelated edit moves a line.
  const statements = allSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(
      (statement) =>
        /^grant\b/u.test(statement) &&
        // On the table, not the sequence. The sequence grant names the table too,
        // because the sequence is named after it, and matching both found two
        // statements where the test expected one.
        statement.includes("on table public.reader_engagement_events") &&
        statement.includes("to authenticated"),
    );
  assert.equal(
    statements.length,
    1,
    `expected exactly one grant on the event log, found ${statements.length}`,
  );
  const [grant] = statements;
  assert.match(grant, /\bselect\b/u);
  assert.match(grant, /\binsert\b/u);
  assert.match(grant, /\bdelete\b/u);
  assert.equal(
    /\bupdate\b/u.test(grant),
    false,
    `the event log grants update: ${grant}`,
  );
});

// ------------------------------------------------ functions cannot be hijacked

test("every function pins an empty search_path", () => {
  // A function resolving unqualified names through a caller-controlled search path
  // can be made to call something other than what it names.
  const definitions = [
    ...allSql.matchAll(
      /create or replace function public\.(\w+)\([\s\S]*?\$\$;/gu,
    ),
  ];
  assert.ok(
    definitions.length >= Object.keys(PUBLISHER_SYNC_PROVIDER.functions).length,
    "fewer function definitions found than the descriptor declares",
  );
  for (const [body, name] of definitions.map((match) => [match[0], match[1]])) {
    assert.match(
      body,
      /set search_path = ''/u,
      `public.${name} does not pin an empty search_path`,
    );
  }
});

test("privileged functions are revoked from anonymous callers", () => {
  for (const name of ["merge_reader_bookmarks", "delete_reader_sync_data"]) {
    const revocation = new RegExp(
      `revoke all\\s+on function public\\.${name}\\([^)]*\\)\\s+from public, anon`,
      "u",
    );
    assert.match(allSql, revocation, `public.${name} is callable anonymously`);
    assert.match(
      allSql,
      new RegExp(
        `grant execute\\s+on function public\\.${name}\\([^)]*\\)\\s+to authenticated`,
        "u",
      ),
      `public.${name} is not executable by an authenticated reader`,
    );
  }
});

// ----------------------------------------------------------- bounds hold

test("every reader-controlled blob and text column is bounded", () => {
  // A self-registered account reaches these tables with the public anonymous key,
  // so the client's own caps are not a security boundary.
  //
  // Every numeric bound is anchored with a word boundary. Without it, `<= 262144`
  // matches inside `<= 262144000000`, so raising a limit to a useless value passed
  // this test. Two of these were vacuous exactly that way, found by loosening the
  // bounds and watching nothing fail. Raising a limit because a reader hit it is the
  // most likely real regression here, so it is the one that must not slip through.
  const bounds = [
    ["reader_progress_size", /pg_column_size\(progress\) <= 262144\b/u],
    ["reader_bookmarks_size", /pg_column_size\(bookmarks\) <= 4194304\b/u],
    [
      "reader_engagement_events_payload_size",
      /pg_column_size\(payload\) <= 8192\b/u,
    ],
    ["reader_engagement_events_event_type_len", /char_length\(event_type\)/u],
    [
      "reader_engagement_events_client_event_id_len",
      /char_length\(client_event_id\)/u,
    ],
    ["reader_engagement_events_section_id_len", /char_length\(section_id\)/u],
    ["reader_engagement_events_content_hash_len", /char_length\(content_hash\)/u],
    ["reader_engagement_events_route_len", /char_length\(route\)/u],
    ["reader_sync_consent_copy_version_len", /char_length\(copy_version\)/u],
  ];
  for (const [constraint, check] of bounds) {
    assert.match(
      allSql,
      new RegExp(`add constraint ${constraint}\\b`, "u"),
      `the ${constraint} bound is gone`,
    );
    assert.match(allSql, check, `the ${constraint} bound no longer checks anything`);
  }
});

test("the bookmark document's shape is constrained", () => {
  // The merge function indexes into `bookmarks -> 'bookmarks'`. A row that is not
  // that shape would make it fail on read rather than on write.
  assert.match(allSql, /add constraint reader_bookmarks_document_shape\b/u);
  assert.match(allSql, /jsonb_typeof\(bookmarks -> 'bookmarks'\) = 'object'/u);
});

test("the event log is capped per reader and publication", () => {
  const pruning = migrations.get("0007_publication_scope.sql") ?? "";
  assert.match(pruning, /max_events constant integer := 5000\b/u);
  assert.match(pruning, /publication_id = new\.publication_id/u);
  assert.match(
    pruning,
    /order by event_at desc\s+limit max_events/u,
    "retention no longer keeps the newest events",
  );
});

// ------------------------------------------- the merge is actually the only path

test("the merge takes a row lock", () => {
  // Without the lock this is an upsert with extra steps, and two devices lose one
  // another's bookmarks.
  const merge = migrations.get("0007_publication_scope.sql") ?? "";
  assert.match(
    merge,
    /from public\.reader_bookmarks\s+where reader_bookmarks\.user_id = requester\s+and reader_bookmarks\.publication_id = incoming_publication_id\s+for update/u,
    "the merge no longer locks the row it is about to rewrite",
  );
});

test("direct writes to bookmarks are revoked, so the merge cannot be bypassed", () => {
  // Half the fix, and the easier half to omit. With insert and update still granted,
  // a client can write the row directly and the race is exactly as reachable.
  const merge = migrations.get("0005_atomic_bookmark_merge.sql") ?? "";
  assert.match(
    merge,
    /revoke insert, update\s+on table public\.reader_bookmarks\s+from authenticated/u,
    "a client can still bypass the merge with a direct write",
  );
  // Select and delete must survive: hydration and reader-data deletion need them.
  assert.match(
    allSql,
    /grant select, insert, update, delete\s+on table public\.reader_bookmarks\s+to authenticated/u,
    "the base grant this migration narrows is missing",
  );
});

test("a tombstone wins over a timestamp", () => {
  // The subtle rule. Bookmark identifiers are never reused, so a live record
  // carrying a deleted identifier cannot be a legitimate resurrection whatever its
  // clock says. Comparing timestamps first would let a skewed device undelete
  // somebody's bookmark.
  const merge = migrations.get("0007_publication_scope.sql") ?? "";
  const removedAtBranch = merge.indexOf("? 'removedAt') <> (");
  const timestampBranch = merge.indexOf("incoming_updated_at > current_updated_at");
  assert.ok(removedAtBranch > 0, "the tombstone comparison is gone");
  assert.ok(timestampBranch > 0, "the timestamp comparison is gone");
  assert.ok(
    removedAtBranch < timestampBranch,
    "timestamps are compared before tombstones, which allows an undelete",
  );
});

test("the merge refuses a document written by a newer client", () => {
  const merge = migrations.get("0007_publication_scope.sql") ?? "";
  assert.match(merge, /current_schema_version > incoming_schema_version/u);
  assert.match(merge, /is newer than client version/u);
});

test("the merge validates each incoming record against its own key", () => {
  // A record whose id disagrees with its key would be stored under one identity and
  // claim another.
  const merge = migrations.get("0007_publication_scope.sql") ?? "";
  assert.match(merge, /incoming_record ->> 'id' is distinct from bookmark_id/u);
});

test("both privileged functions refuse an unauthenticated caller", () => {
  for (const name of [
    "0007_publication_scope.sql",
    "0006_reader_data_deletion.sql",
  ]) {
    const sql = migrations.get(name) ?? "";
    assert.match(sql, /requester uuid := auth\.uid\(\)/u);
    assert.match(sql, /Authentication is required/u, `${name} does not refuse anonymous callers`);
    assert.match(sql, /errcode = '42501'/u);
  }
});

test("reader data deletion removes every table a reader owns", () => {
  // Four separate client statements can fail part way and leave a reader who asked
  // to be forgotten partly remembered.
  const deletion = migrations.get("0006_reader_data_deletion.sql") ?? "";
  for (const table of readerTables) {
    assert.match(
      deletion,
      new RegExp(`delete from public\\.${table} where user_id = requester`, "u"),
      `deletion leaves rows in ${table}`,
    );
  }
});

// --------------------------------------------- the package says what it is not

test("the package remains private until its complete release gate is closed", () => {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  assert.equal(manifest.private, true);
  assert.deepEqual(manifest.dependencies, {
    "@supabase/ssr": "0.12.0",
    "@supabase/supabase-js": "2.110.0",
  });
  const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
  assert.match(readme, /Why this is still private/u);
});

test("the descriptor names the complete server-only host integration", () => {
  assert.deepEqual(PUBLISHER_SYNC_PROVIDER.hostIntegration, {
    configPath: "publisher.config.ts",
    serverExport: "@genii-foundation/publisher-sync-supabase/server",
    environment: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
  });
});
