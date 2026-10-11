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

// The parity ledger, checked rather than believed.
//
// "No functionality is lost" is the kind of claim that decays the moment it is
// written, because nothing tests prose. This file makes each entry carry its own
// evidence and then verifies the evidence exists: a capability claimed for the
// engine names an export or a schema that is really there, a capability claimed for
// the provider names a migration or a function that is really there, and a
// capability that cannot work yet names the decision it waits on.
//
// What this cannot check is the two homes outside this repository. A capability the
// author's application keeps is verified by that application, and author tooling by
// its own tests. What this file does insist on is that such an entry says what the
// engine supplies to make it possible, so "the host keeps it" is never a place to
// hide something the engine failed to provide.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as publisherNode from "../packages/publisher/dist/node.js";
import { PUBLISHER_SYNC_PROVIDER } from "../packages/sync-supabase/provider.mjs";
import {
  AUDIO_PARITY,
  PARITY_HOMES,
  PARITY_LEDGER,
  PARITY_STATUSES,
  SYNC_PARITY,
} from "./coherence-parity-ledger.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const schemaRoot = join(repositoryRoot, "schemas");
const migrationRoot = join(
  repositoryRoot,
  "packages",
  "sync-supabase",
  "migrations",
);
const migrationSql = readdirSync(migrationRoot)
  .sort()
  .map((name) => readFileSync(join(migrationRoot, name), "utf8"))
  .join("\n");

// ------------------------------------------------------- the ledger is well formed

test("the ledger covers both subsystems and is not empty", () => {
  assert.ok(AUDIO_PARITY.length >= 10, `only ${AUDIO_PARITY.length} audio entries`);
  assert.ok(SYNC_PARITY.length >= 10, `only ${SYNC_PARITY.length} sync entries`);
  assert.equal(PARITY_LEDGER.length, AUDIO_PARITY.length + SYNC_PARITY.length);
});

test("every entry has a unique identifier", () => {
  const ids = PARITY_LEDGER.map((entry) => entry.id);
  assert.deepEqual(
    ids,
    [...new Set(ids)],
    "two entries share an identifier, so one of them is invisible",
  );
});

test("every entry declares a home and a status from the closed vocabularies", () => {
  // An entry with an unrecognized home is an entry nobody owns, which is exactly
  // the state this ledger exists to make impossible.
  for (const entry of PARITY_LEDGER) {
    assert.ok(
      PARITY_HOMES.includes(entry.home),
      `${entry.id} has home ${JSON.stringify(entry.home)}`,
    );
    assert.ok(
      PARITY_STATUSES.includes(entry.status),
      `${entry.id} has status ${JSON.stringify(entry.status)}`,
    );
    assert.ok(
      typeof entry.capability === "string" && entry.capability.length > 0,
      `${entry.id} does not say what the capability is`,
    );
  }
});

test("nothing is lost, dropped, or unowned", () => {
  // The headline claim, stated as an assertion rather than a sentence. There is no
  // "lost" status in the vocabulary, so this checks the thing that would represent
  // one: an entry with no home.
  const unowned = PARITY_LEDGER.filter((entry) => !entry.home);
  assert.deepEqual(unowned, [], "some capability has no owner");
});

// -------------------------------------------------- claims about the engine hold

test("every engine capability names evidence that exists", () => {
  const engineEntries = PARITY_LEDGER.filter((entry) => entry.home === "engine");
  assert.ok(engineEntries.length > 0, "no engine entries, so this checks nothing");
  for (const entry of engineEntries) {
    assert.ok(
      entry.evidence,
      `${entry.id} claims the engine implements it and names no evidence`,
    );
    if (entry.evidence.schema !== undefined) {
      assert.ok(
        existsSync(join(schemaRoot, entry.evidence.schema)),
        `${entry.id} names schema ${entry.evidence.schema}, which does not exist`,
      );
    }
    if (entry.evidence.export !== undefined) {
      assert.equal(
        typeof publisherNode[entry.evidence.export],
        "function",
        `${entry.id} names export ${entry.evidence.export}, which the engine does not export`,
      );
    }
    if (entry.evidence.schemaProperty !== undefined) {
      const found = readdirSync(schemaRoot)
        .filter((name) => name.endsWith(".schema.json"))
        .some((name) =>
          readFileSync(join(schemaRoot, name), "utf8").includes(
            `"${entry.evidence.schemaProperty}"`,
          ),
        );
      assert.ok(
        found,
        `${entry.id} names property ${entry.evidence.schemaProperty}, which no schema declares`,
      );
    }
  }
});

// ------------------------------------------------ claims about the provider hold

test("every provider capability names a migration that exists", () => {
  const providerEntries = PARITY_LEDGER.filter(
    (entry) => entry.home === "provider",
  );
  assert.ok(providerEntries.length > 0, "no provider entries");
  for (const entry of providerEntries) {
    assert.ok(
      entry.evidence?.migration,
      `${entry.id} claims the provider implements it and names no migration`,
    );
    assert.ok(
      existsSync(join(migrationRoot, entry.evidence.migration)),
      `${entry.id} names migration ${entry.evidence.migration}, which does not exist`,
    );
  }
});

test("every table and function a provider entry names is really created", () => {
  for (const entry of PARITY_LEDGER) {
    const table = entry.evidence?.table;
    if (table !== undefined) {
      assert.match(
        migrationSql,
        new RegExp(`create table if not exists public\\.${table}\\b`, "u"),
        `${entry.id} names table ${table}, which no migration creates`,
      );
    }
    const routine = entry.evidence?.function;
    if (routine !== undefined) {
      assert.match(
        migrationSql,
        new RegExp(`create or replace function public\\.${routine}\\b`, "u"),
        `${entry.id} names function ${routine}, which no migration defines`,
      );
    }
  }
});

test("every capability the provider claims appears in the ledger", () => {
  // The reverse direction. A provider serving something the ledger never mentions
  // means the inventory is incomplete, which is the failure mode a ledger has.
  const mentioned = PARITY_LEDGER.map((entry) => entry.id).join(" ");
  for (const capability of PUBLISHER_SYNC_PROVIDER.capabilities) {
    const key = capability === "account-deletion" ? "deletion" : capability;
    assert.match(
      mentioned,
      new RegExp(key.replace(/-/gu, "_"), "u"),
      `the provider serves ${capability} and no ledger entry covers it`,
    );
  }
});

// --------------------------------------------- host claims cannot hide a gap

test("a host capability says what the engine supplies for it", () => {
  // "The host keeps it" must not become a place to put something the engine failed
  // to provide. Any entry that needs engine data to be possible has to say what
  // that data is, or explain why it needs none.
  for (const entry of PARITY_LEDGER.filter((item) => item.home === "host")) {
    const explained =
      typeof entry.engineProvides === "string" ||
      typeof entry.why === "string";
    assert.ok(
      explained,
      `${entry.id} is left to the host with no account of what makes that possible`,
    );
  }
});

// ------------------------------------------------------- blocked means blocked

test("every blocked capability names the decision it waits on", () => {
  const blocked = PARITY_LEDGER.filter((entry) => entry.status === "blocked");
  assert.ok(blocked.length > 0, "no blocked entries, so this checks nothing");
  for (const entry of blocked) {
    assert.match(
      entry.blockedBy ?? "",
      /^#\d+$/u,
      `${entry.id} is blocked and names no issue`,
    );
    assert.ok(
      typeof entry.why === "string" && entry.why.length > 0,
      `${entry.id} is blocked and does not say why`,
    );
  }
});

test("nothing claims to be preserved while being blocked", () => {
  // The failure this ledger is most likely to suffer: an entry described as
  // preserved that in fact cannot run.
  for (const entry of PARITY_LEDGER) {
    if (entry.blockedBy !== undefined) {
      assert.equal(
        entry.status,
        "blocked",
        `${entry.id} names a blocker and claims status ${entry.status}`,
      );
    }
  }
});

test("an upgraded or added capability says how it is better", () => {
  for (const entry of PARITY_LEDGER) {
    if (entry.status === "upgraded" || entry.status === "added") {
      assert.ok(
        typeof entry.why === "string" && entry.why.length > 20,
        `${entry.id} claims to be ${entry.status} without saying how`,
      );
    }
  }
});

// -------------------------------------------------------------- the summary

test("the readiness audit quotes the ledger's real totals", () => {
  // So the human-readable summary and the machine-checked data cannot drift. This
  // repository has already had one document go stale while its subject moved.
  const counts = Object.fromEntries(
    PARITY_STATUSES.map((status) => [
      status,
      PARITY_LEDGER.filter((entry) => entry.status === status).length,
    ]),
  );
  const audit = readFileSync(
    join(repositoryRoot, "docs", "migration", "coherence-readiness.md"),
    "utf8",
  );
  assert.match(
    audit,
    new RegExp(`${PARITY_LEDGER.length} capabilities`, "u"),
    `the audit does not quote the ledger's total of ${PARITY_LEDGER.length}`,
  );
  for (const [status, count] of Object.entries(counts)) {
    assert.match(
      audit,
      new RegExp(`${count} ${status}`, "u"),
      `the audit does not quote ${count} ${status}`,
    );
  }
});
