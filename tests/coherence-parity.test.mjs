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
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as publisherNode from "../packages/publisher/dist/node.js";
import { PUBLISHER_SYNC_PROVIDER } from "../packages/sync-supabase/provider.mjs";
import {
  AUDIO_PARITY,
  COHERENCE_PARITY_SOURCE,
  PARITY_HOMES,
  PARITY_LEDGER,
  PARITY_STATUSES,
  RECENT_COHERENCE_APPLICATION_COMMITS,
  READER_PARITY,
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

test("the ledger covers Reader, narration, and synchronization", () => {
  assert.ok(READER_PARITY.length >= 30, `only ${READER_PARITY.length} Reader entries`);
  assert.ok(AUDIO_PARITY.length >= 10, `only ${AUDIO_PARITY.length} audio entries`);
  assert.ok(SYNC_PARITY.length >= 10, `only ${SYNC_PARITY.length} sync entries`);
  assert.equal(
    PARITY_LEDGER.length,
    READER_PARITY.length + AUDIO_PARITY.length + SYNC_PARITY.length,
  );
});

test("the Reader inventory is pinned to the current audited Coherence ref", () => {
  assert.match(COHERENCE_PARITY_SOURCE.ref, /^[0-9a-f]{40}$/u);
  assert.equal(
    COHERENCE_PARITY_SOURCE.ref,
    "20740657f5cc8fbec934c1df609d7e7e0d95fc32",
  );
  assert.equal(COHERENCE_PARITY_SOURCE.observedThrough, "2026-08-26");
  for (const entry of READER_PARITY) {
    assert.ok(
      Array.isArray(entry.sourcePaths) && entry.sourcePaths.length > 0,
      `${entry.id} names no observed Coherence source path`,
    );
    for (const path of entry.sourcePaths) {
      assert.equal(typeof path, "string", `${entry.id} has a non-string source path`);
      assert.equal(path.startsWith("/"), false, `${entry.id} uses an absolute source path`);
      assert.equal(
        path.split("/").includes(".."),
        false,
        `${entry.id} uses a parent source path`,
      );
    }
  }
});

test("every recent Coherence application commit has an explicit parity disposition", () => {
  const expectedRefs = [
    "c74fa0bb1707b1da79f81565619b1ff858a46198",
    "d250a760b51a071037af0c18ac73cc3131312f09",
    "b001d42e50a95c6a2f6a4d67bd6b0879bed9cf89",
    "7cc32c1dd7421678e01f2df213df75c7e0a3656f",
    "6ed21e5bc48f747989d3cd580d5bcd24daec686f",
    "cf60f3dd07a66b11e442cb9ceaa02cdadbf9d239",
    "618a98bf3811d5b5839b98d9e01516cdb7f3f7f1",
    "3af5fed1e48f6888c8628169b6fb09d6c1bb33d5",
    "7e50161cecc0ce6039c36e4738d8c9fc90710e62",
    "c60aa2bca5aa3cc7abf0d9bd661538a247315f59",
    "3de08c7987737743b41a2c4253721a2b39472af7",
    "61c5764f073f161a62d858e80c46b4f4139ef338",
    "d9da3927b3fc8bed84cb7325e76e37d8f7b49f2c",
    "f7d9320c75143bcd212d421beafb01558a5e562e",
    "9397348f9aa3f36e56c6147a1bda5df53dea71b7",
    "29ac0f92c261f3673f42d5fbac388c20de105cf6",
    "744e2b5444ec62b34298932bb29e1bb1e06d2955",
    "688ef31110d3dfa272a5a230b28cf1125196857d",
    "0e730e803406dc9aca7dc507485099913354d92c",
    "e24451b9f48480e8c69a1334f44a2ee0b0064627",
    "6166ec5e4330eebfb2e97182cc4920886378ebbe",
    "654a2c36ba825ee191e67ded3b193ff4e0acde24",
    "87ff7cf7e55c8059e3f85f73fa8d149cf91a2ce9",
    "8303fe0c1269d45224257bc4550c407b9a0cb23c",
    "e51e570f3d7d74d1164daf6ea2703e9bf6e79313",
    "4d7cbd82d1b4daeb8ce46bb1150c2198c847bfc8",
    "ee7bb3e5fd6474023225d7b05c6fa8a71c7a9024",
    "c126678226e9ff367c173042959a63f8004a7ce7",
    "ea9135084dfb1f2c168bf746087d2d1f10c67883",
    "e4f02c45c324bc5f9f5920203268130f64f7a425",
    "c784377c003456674927e4ec2c14aa383423a2ea",
  ];
  assert.deepEqual(
    RECENT_COHERENCE_APPLICATION_COMMITS.map((entry) => entry.ref),
    expectedRefs,
  );
  assert.equal(
    RECENT_COHERENCE_APPLICATION_COMMITS.filter(
      (entry) => entry.disposition === "author-owned",
    ).length,
    5,
  );
  assert.equal(
    RECENT_COHERENCE_APPLICATION_COMMITS.filter(
      (entry) => entry.disposition === "mixed",
    ).length,
    4,
  );
  const capabilityIds = new Set(PARITY_LEDGER.map((entry) => entry.id));
  for (const entry of RECENT_COHERENCE_APPLICATION_COMMITS) {
    assert.match(entry.ref, /^[0-9a-f]{40}$/u);
    assert.ok(
      entry.disposition === "engine-parity" ||
        entry.disposition === "author-owned" ||
        entry.disposition === "mixed",
      `${entry.ref} has an unknown disposition`,
    );
    if (entry.disposition === "author-owned") {
      assert.ok(
        typeof entry.reason === "string" && entry.reason.length > 0,
        `${entry.ref} has no author-owned reason`,
      );
      assert.equal(entry.capabilityIds, undefined);
      continue;
    }
    if (entry.disposition === "mixed") {
      assert.ok(
        typeof entry.reason === "string" && entry.reason.length > 0,
        `${entry.ref} has no author-owned remainder`,
      );
    } else {
      assert.equal(entry.reason, undefined);
    }
    assert.ok(
      Array.isArray(entry.capabilityIds) && entry.capabilityIds.length > 0,
      `${entry.ref} names no Publisher capability`,
    );
    assert.equal(
      new Set(entry.capabilityIds).size,
      entry.capabilityIds.length,
      `${entry.ref} repeats a Publisher capability`,
    );
    for (const capabilityId of entry.capabilityIds) {
      assert.ok(
        capabilityIds.has(capabilityId),
        `${entry.ref} names missing capability ${capabilityId}`,
      );
    }
  }
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

test("every implemented engine or renderer capability names evidence that exists", () => {
  const engineEntries = PARITY_LEDGER.filter(
    (entry) =>
      (entry.home === "engine" || entry.home === "renderer") &&
      entry.status !== "blocked" &&
      entry.status !== "planned",
  );
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
    if (entry.evidence.file !== undefined) {
      assert.ok(
        existsSync(join(repositoryRoot, entry.evidence.file)),
        `${entry.id} names file ${entry.evidence.file}, which does not exist`,
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
    (entry) =>
      entry.home === "provider" &&
      entry.status !== "blocked" &&
      entry.status !== "planned",
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
    if (entry.status === "blocked" || entry.status === "planned") {
      continue;
    }
    const table = entry.evidence?.table;
    if (table !== undefined) {
      assert.match(
        migrationSql,
        new RegExp(`create table if not exists\\s+public\\.${table}\\b`, "u"),
        `${entry.id} names table ${table}, which no migration creates`,
      );
    }
    const routine = entry.evidence?.function;
    if (routine !== undefined) {
      assert.match(
        migrationSql,
        new RegExp(`create or replace function\\s+public\\.${routine}\\b`, "u"),
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

test("every planned capability names its accepted architecture decision", () => {
  const planned = PARITY_LEDGER.filter((entry) => entry.status === "planned");
  for (const entry of planned) {
    assert.match(
      entry.plannedBy ?? "",
      /^docs\/architecture\/\d{4}-[a-z0-9-]+\.md$/u,
      `${entry.id} is planned and names no accepted architecture record`,
    );
    assert.ok(
      existsSync(join(repositoryRoot, entry.plannedBy)),
      `${entry.id} names missing plan ${entry.plannedBy}`,
    );
  }
});

test("nothing claims to be implemented while carrying a blocker or plan", () => {
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
    if (entry.plannedBy !== undefined) {
      assert.equal(
        entry.status,
        "planned",
        `${entry.id} names a plan and claims status ${entry.status}`,
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

test("the Coherence adoption plan pins authority and rollback boundaries", () => {
  const plan = readFileSync(
    join(repositoryRoot, "docs", "migration", "coherence-adoption-plan.md"),
    "utf8",
  );
  assert.match(
    plan,
    /Publisher repository checkpoint: `47275264f5cee67e6e83995a6bc6b60b2c456055`/u,
  );
  assert.match(
    plan,
    /Publisher package candidate: `47275264f5cee67e6e83995a6bc6b60b2c456055`/u,
  );
  assert.match(
    plan,
    /Coherence source baseline: `20740657f5cc8fbec934c1df609d7e7e0d95fc32`/u,
  );
  assert.match(
    plan,
    /Coherence migration candidate: `b2bbe1320593fbd1b3aec25f8253f9c7c41d55a9`/u,
  );
  assert.match(
    plan,
    /Coherence executable proof checkpoint: `20980d155909850710ad95253e3eaf83a14e4c98`/u,
  );
  assert.match(
    plan,
    /No second Coherence Vercel\s+project may be created\./u,
  );
  assert.match(plan, /No database\s+migration is part of this adoption plan\./u);
  assert.match(
    plan,
    /The final migration cannot merge under this plan without fresh explicit approval\./u,
  );
  assert.match(
    plan,
    /@genii-foundation\/publisher-sync-supabase` is a public prerelease candidate at\s+version `0\.1\.0-alpha\.0`/u,
  );
  assert.match(
    plan,
    /separately bounded, immutable, build-bound projection/u,
  );
  assert.doesNotMatch(plan, /\.\.\/(?:publisher|coherence-thesis)/u);
  for (let gate = 1; gate <= 14; gate += 1) {
    assert.match(
      plan,
      new RegExp(`^${gate}\\. `, "mu"),
      `the adoption plan is missing acceptance gate ${gate}`,
    );
  }
});
