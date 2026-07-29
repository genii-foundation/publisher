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

import assert from "node:assert/strict";
import test from "node:test";

import {
  RESERVED_HOST_CONFIG_PATH,
  assertHostMutationsPermitted,
  createHostMutationAuthority,
} from "../packages/publisher/dist/node/lifecycle/policy.js";

function authority(overrides = {}) {
  return createHostMutationAuthority({
    rendererManagedPaths: [
      "app/page.tsx",
      "package.json",
      "pages/_app.tsx",
    ],
    engineManagedPaths: ["publisher.host.json"],
    manifestPaths: ["publication.json", "works/one/work.json"],
    protectedRoots: [
      "editorial",
      "publishing/",
      "public/downloads",
      "supabase",
    ],
    ...overrides,
  });
}

test("a declared path is permitted in its own role only", () => {
  const policy = authority();
  assert.equal(
    policy.authorize("app/page.tsx", "rendererManaged").allowed,
    true,
  );
  // The same path claimed in another role is not writable, because each
  // allowlist answers for exactly one kind of authority.
  assert.equal(
    policy.authorize("app/page.tsx", "manifest").allowed,
    false,
  );
  assert.equal(
    policy.authorize("publisher.host.json", "engineManaged").allowed,
    true,
  );
  assert.equal(
    policy.authorize("publication.json", "manifest").allowed,
    true,
  );
});

test("anything not declared is refused, because the shape is default-deny", () => {
  const policy = authority();
  for (const path of [
    "app/unexpected.tsx",
    "README.md",
    "scripts/deploy.sh",
    "vercel.json",
    "works/two/work.json",
  ]) {
    const decision = policy.authorize(path, "rendererManaged");
    assert.equal(decision.allowed, false, `${path} must be refused`);
    assert.match(decision.reason, /not declared as|never writable/u);
  }
});

test("declaring a hard-denied path does not buy authority over it", () => {
  // The point of the ordering: a future migration that named these as
  // renderer-managed must still be refused.
  const policy = authority({
    rendererManagedPaths: [
      ".git/config",
      ".env",
      ".env.production",
      "node_modules/next/package.json",
      ".publisher/plans/current.json",
      "editorial/sources/volumes/one/manuscript.md",
      RESERVED_HOST_CONFIG_PATH,
    ],
  });
  for (const path of [
    ".git/config",
    ".env",
    ".env.production",
    "node_modules/next/package.json",
    ".publisher/plans/current.json",
    "editorial/sources/volumes/one/manuscript.md",
    RESERVED_HOST_CONFIG_PATH,
  ]) {
    const decision = policy.authorize(path, "rendererManaged");
    assert.equal(
      decision.allowed,
      false,
      `${path} must remain refused even when declared`,
    );
    assert.equal(decision.role, null);
  }
});

test("everything beneath a declared root is refused", () => {
  const policy = authority();
  for (const path of [
    "editorial/sources/volumes/one/manuscript.md",
    "editorial/voice-card.md",
    "publishing/updates/snapshot.json",
    "public/downloads/volume-one.pdf",
    "supabase/migrations/0001.sql",
    // The root itself, not only its contents.
    "editorial",
    "supabase",
  ]) {
    const decision = policy.authorize(path, "manifest");
    assert.equal(decision.allowed, false, `${path} must be refused`);
    assert.match(
      decision.reason,
      /inside the declared root|not declared as/u,
    );
  }
});

test("a trailing separator on a declared root does not change its meaning", () => {
  const policy = authority();
  // "publishing/" was declared with a separator and "editorial" without.
  assert.equal(
    policy.authorize("publishing/updates/snapshot.json", "manifest")
      .allowed,
    false,
  );
  assert.equal(
    policy.authorize("editorial/notes.md", "manifest").allowed,
    false,
  );
});

test("a protected root does not refuse a path that merely shares its prefix", () => {
  const policy = authority({
    rendererManagedPaths: ["publishing-config.json"],
    protectedRoots: ["publishing"],
  });
  // "publishing-config.json" is not inside "publishing/".
  assert.equal(
    policy.authorize("publishing-config.json", "rendererManaged")
      .allowed,
    true,
  );
});

test("structurally unusable paths are refused before any allowlist is consulted", () => {
  const policy = authority({
    rendererManagedPaths: [
      "/absolute.txt",
      "../escape.txt",
      "app//page.tsx",
      "app/./page.tsx",
      "trailing.",
      "trailing ",
      "back\\slash.txt",
      "",
    ],
  });
  for (const path of [
    "/absolute.txt",
    "../escape.txt",
    "app//page.tsx",
    "app/./page.tsx",
    "trailing.",
    "trailing ",
    "back\\slash.txt",
    "",
  ]) {
    const decision = policy.authorize(path, "rendererManaged");
    assert.equal(
      decision.allowed,
      false,
      `${JSON.stringify(path)} must be refused`,
    );
    assert.match(decision.reason, /^Refused because the path|^Refused because a path/u);
  }
});

test("an unknown role is refused rather than defaulting to anything", () => {
  const policy = authority();
  const decision = policy.authorize("app/page.tsx", "somethingElse");
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /is not a mutation role/u);
});

test("a refused set reports every refusal at once", () => {
  const policy = authority();
  assert.throws(
    () =>
      assertHostMutationsPermitted(policy, [
        { path: "app/page.tsx", role: "rendererManaged" },
        { path: "editorial/manuscript.md", role: "rendererManaged" },
        { path: ".env", role: "rendererManaged" },
        { path: "undeclared.txt", role: "rendererManaged" },
      ]),
    (error) => {
      assert.equal(error.name, "HostMutationPolicyError");
      assert.equal(
        error.refusals.length,
        3,
        "an operator should learn every refusal from one run",
      );
      assert.deepEqual(
        error.refusals.map(({ path }) => path).sort(),
        [".env", "editorial/manuscript.md", "undeclared.txt"],
      );
      return true;
    },
  );
});

test("a fully permitted set passes", () => {
  const policy = authority();
  assertHostMutationsPermitted(policy, [
    { path: "app/page.tsx", role: "rendererManaged" },
    { path: "package.json", role: "rendererManaged" },
    { path: "publisher.host.json", role: "engineManaged" },
    { path: "publication.json", role: "manifest" },
  ]);
});

test("an authority with no declared paths permits nothing", () => {
  const policy = createHostMutationAuthority({
    rendererManagedPaths: [],
    engineManagedPaths: [],
  });
  for (const role of [
    "rendererManaged",
    "engineManaged",
    "manifest",
  ]) {
    assert.equal(
      policy.authorize("anything.txt", role).allowed,
      false,
    );
  }
});
