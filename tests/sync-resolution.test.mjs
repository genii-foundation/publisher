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

// What a publication offers to synchronize.
//
// The sync block sat in the schema from the beginning with nothing reading it, and
// its capability list accepted any identifier. A publication could declare a
// capability no provider implements and learn about it from a reader whose data
// never arrived. The vocabulary is closed now and the declaration reaches an
// artifact, because a declaration nothing reads is decoration.
//
// The property this file guards hardest is the one that would be a real incident:
// provider configuration must never reach the published artifact. It is
// author-supplied and may hold a project reference, an endpoint, or a key nobody
// meant to publish. The schema has no field for it and refuses additional
// properties, so the mistake is unavailable rather than discouraged, and the tests
// below try to make it anyway.

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildSyncEnvelope,
  resolvePublicationSync,
} from "../packages/publisher/dist/node.js";
import { SYNC_CAPABILITIES } from "../schemas/dist/index.js";
import {
  authorHost,
  publicationFixture as publication,
  runPublisher as run,
} from "./author-host-fixture.mjs";

const rendererName = "@example/alpha";
const syncing = "declared-night-dispatch";
const plain = "canonical-tide-tables";
const syncDataPath = "public/alpha-sync.json";
const digest = `sha256:${"a".repeat(64)}`;

function declaration(overrides = {}) {
  return {
    provider: { package: "@example/sync-adapter", config: { namespace: "n" } },
    consent: "opt-in",
    localFallback: true,
    capabilities: ["progress"],
    ...overrides,
  };
}

function host(t, rendererOptions = {}) {
  return authorHost(t, {
    renderers: [rendererName],
    rendererOptions: { [rendererName]: rendererOptions },
  }).hostRoot;
}

function build(hostRoot, fixture, extra = []) {
  return run(hostRoot, [
    "build",
    "--renderer",
    rendererName,
    "--publication",
    publication(fixture),
    ...extra,
  ]);
}

// ------------------------------------------------- the vocabulary is closed

test("the engine publishes exactly the capabilities it recognizes", () => {
  // Pinned so that adding one is a deliberate act with a provider behind it,
  // rather than a string somebody typed into a manifest.
  assert.deepEqual([...SYNC_CAPABILITIES], [
    "account-deletion",
    "bookmarks",
    "engagement",
    "progress",
  ]);
});

test("consent is not a capability", () => {
  // It is a precondition, not a feature. `consent` is pinned to opt-in for every
  // synchronizing publication, so offering it as a choice would misdescribe it.
  assert.equal(SYNC_CAPABILITIES.includes("consent"), false);
  const result = resolvePublicationSync(
    declaration({ capabilities: ["consent"] }),
  );
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "sync.capability.unknown");
});

test("an unrecognized capability is refused and the message lists the real ones", () => {
  const result = resolvePublicationSync(
    declaration({ capabilities: ["telepathy"] }),
  );
  assert.equal(result.valid, false);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, "sync.capability.unknown");
  for (const capability of SYNC_CAPABILITIES) {
    assert.match(
      diagnostic.message,
      new RegExp(capability, "u"),
      "an author told their capability is wrong should be told which are right",
    );
  }
});

test("every recognized capability resolves", () => {
  const result = resolvePublicationSync(
    declaration({ capabilities: [...SYNC_CAPABILITIES] }),
  );
  assert.ok(result.valid, JSON.stringify(result.diagnostics, null, 2));
});

// ------------------------------------------------- the privacy default holds

test("consent other than opt-in is refused", () => {
  // Enforced here as well as by the schema constant. The constant protects a
  // manifest read from disk; this protects every other route into the engine.
  const result = resolvePublicationSync(declaration({ consent: "opt-out" }));
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "sync.consent.not_opt_in");
  assert.match(result.diagnostics[0].message, /private until they ask/u);
});

test("losing the local fallback is refused", () => {
  const result = resolvePublicationSync(declaration({ localFallback: false }));
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "sync.local_fallback.required");
  assert.match(result.diagnostics[0].message, /still reads/u);
});

test("both are carried into the artifact rather than left implicit", () => {
  // So a client cannot be built against a publication that quietly relaxed either.
  const resolved = resolvePublicationSync(declaration());
  assert.ok(resolved.valid);
  const built = buildSyncEnvelope({
    sync: resolved.value,
    publicationId: "night-dispatch",
    buildId: digest,
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  assert.equal(built.value.envelope.consent, "opt-in");
  assert.equal(built.value.envelope.localFallback, true);
});

// ---------------------------------------------- configuration cannot escape

test("provider configuration never reaches the envelope", () => {
  // The declaration carries a config. The artifact must not.
  const resolved = resolvePublicationSync(
    declaration({
      provider: {
        package: "@example/sync-adapter",
        config: { serviceKey: "a-secret-nobody-meant-to-publish" },
      },
    }),
  );
  assert.ok(resolved.valid);
  const built = buildSyncEnvelope({
    sync: resolved.value,
    publicationId: "night-dispatch",
    buildId: digest,
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  assert.equal(built.value.envelope.provider.package, "@example/sync-adapter");
  assert.equal(built.value.envelope.provider.config, undefined);
  assert.equal(
    built.value.text.includes("a-secret-nobody-meant-to-publish"),
    false,
    "provider configuration reached a publicly served artifact",
  );
  assert.equal(built.value.text.includes("serviceKey"), false);
});

test("the resolved value carries no configuration to carry", () => {
  // Belt and braces on the layer above: even a caller that tried to copy the
  // config forward has nothing to copy, because resolution drops it.
  const resolved = resolvePublicationSync(declaration());
  assert.ok(resolved.valid);
  assert.deepEqual(Object.keys(resolved.value).sort(), [
    "capabilities",
    "providerPackage",
  ]);
});

// ----------------------------------------------------------- the artifact

test("capabilities are sorted, so reordering a manifest changes nothing", () => {
  const forward = resolvePublicationSync(
    declaration({ capabilities: ["progress", "bookmarks"] }),
  );
  const reversed = resolvePublicationSync(
    declaration({ capabilities: ["bookmarks", "progress"] }),
  );
  assert.ok(forward.valid && reversed.valid);
  assert.deepEqual(forward.value.capabilities, reversed.value.capabilities);
});

test("a build identity that is not a digest is refused", () => {
  const resolved = resolvePublicationSync(declaration());
  assert.ok(resolved.valid);
  const built = buildSyncEnvelope({
    sync: resolved.value,
    publicationId: "night-dispatch",
    buildId: "not-a-digest",
  });
  assert.equal(built.valid, false);
});

// ------------------------------------------------------------- end to end

test("a synchronizing publication writes the sync envelope", (t) => {
  const hostRoot = host(t, { syncDataPath });
  const built = build(hostRoot, syncing);
  assert.equal(built.status, 0, built.stderr);
  const path = join(hostRoot, syncDataPath);
  assert.ok(existsSync(path), `no sync envelope at ${syncDataPath}`);

  const envelope = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(envelope.capabilities, ["bookmarks", "progress"]);
  assert.equal(envelope.provider.package, "@example/sync-adapter");
  assert.equal(envelope.consent, "opt-in");
  assert.equal(envelope.localFallback, true);

  // The fixture's provider config declares a namespace. The key must not travel.
  //
  // Asserted on the config KEY, not its value. My first version looked for the
  // value "night-dispatch", which is also this fixture's publicationId, so it
  // reported a leak that was not one. A marker that collides with a legitimate
  // field tests nothing except its own wording.
  const text = readFileSync(path, "utf8");
  assert.equal(text.includes("namespace"), false, "a config key leaked");
  assert.deepEqual(Object.keys(envelope.provider), ["package"]);
});

test("the report names the provider and what it may synchronize", (t) => {
  const hostRoot = host(t, { syncDataPath });
  const built = build(hostRoot, syncing);
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /Sync\s+public\/alpha-sync\.json/u);
  assert.match(built.stdout, /Provider\s+@example\/sync-adapter/u);
  assert.match(built.stdout, /Capabilities bookmarks, progress/u);
  assert.match(built.stdout, /Consent\s+opt-in/u);
});

test("a publication that does not synchronize writes no sync envelope", (t) => {
  const hostRoot = host(t, { syncDataPath });
  const built = build(hostRoot, plain);
  assert.equal(built.status, 0, built.stderr);
  assert.equal(existsSync(join(hostRoot, syncDataPath)), false);
  assert.equal(/^Sync /mu.test(built.stdout), false);
});

test("check fails when the sync envelope is stale", (t) => {
  const hostRoot = host(t, { syncDataPath });
  assert.equal(build(hostRoot, syncing).status, 0);
  const path = join(hostRoot, syncDataPath);
  const envelope = JSON.parse(readFileSync(path, "utf8"));
  envelope.capabilities = ["progress"];
  writeFileSync(path, JSON.stringify(envelope), "utf8");
  const checked = build(hostRoot, syncing, ["--check"]);
  assert.equal(checked.status, 1);
});

test("a renderer with nowhere to put synchronization is refused", (t) => {
  const hostRoot = host(t, { omitSyncDataPath: true });
  const built = build(hostRoot, syncing);
  assert.equal(built.status, 1);
  assert.match(built.stderr, /cannot carry this publication's synchronization/u);
  assert.match(built.stderr, /host\.data_artifact_unsupported/u);
});

test("nothing is written when synchronization is refused", (t) => {
  const hostRoot = host(t, { omitSyncDataPath: true });
  assert.equal(build(hostRoot, syncing).status, 1);
  assert.equal(existsSync(join(hostRoot, "alpha-reader.json")), false);
});

test("both extra artifacts appear as additive JSON keys", (t) => {
  // Narration and synchronization are separate keys beside the reader artifact's
  // own fields, so a consumer reading `outcome` keeps working either way.
  const hostRoot = host(t, { syncDataPath });
  assert.equal(build(hostRoot, syncing).status, 0);
  const checked = build(hostRoot, syncing, ["--check", "--json"]);
  const parsed = JSON.parse(checked.stdout);
  assert.equal(parsed.outcome, "current");
  assert.equal(parsed.sync.outcome, "current");
  assert.equal(parsed.sync.hostRelativePath, syncDataPath);
  assert.equal(parsed.audio, undefined, "this fixture has no narration");
});
