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

// The seam between what the pipeline builds and what the renderer serves.
//
// Every other test in this repository sits on one side of it. The renderer tests
// feed the application a hand-authored envelope. The pipeline tests stop at the
// artifact. Nothing put a real artifact, from a real publication tree, into the
// real application, which is exactly why that is where the defect was: a
// publication declaring an Updates route built cleanly and produced a host that
// threw on boot, because the generated application is created with the reader
// alone and has no Updates adapter to give.
//
// The capability declaration that now prevents it is only worth having if it is
// true. So the tests below check it against the renderer's actual behaviour in
// both directions: every kind it claims must really work, and the kind it
// disclaims must really fail.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import {
  assertHostCanServe,
  findUnsupportedHostFeatures,
  readHostCapabilities,
} from "../packages/publisher/dist/node.js";
import {
  buildFixturePublicationReader as buildPublicationReader,
  extensionRegistrationsForBuild,
} from "./extension-fixture.mjs";
import {
  PUBLISHER_NEXT_HOST_CAPABILITIES,
} from "../packages/next/dist/host.js";
import * as nextHostModule from "../packages/next/dist/host.js";
import {
  createPublicationNextApplication,
} from "../packages/next/dist/server/application.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures/", import.meta.url));

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), "publisher-render-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

/** A fixture publication copied so a test can edit its manifest. */
function editablePublication(t, name, edit) {
  const root = join(scratch(t), name);
  cpSync(join(fixtureRoot, name), root, { recursive: true });
  const path = join(root, "publication.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  edit(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return root;
}

async function build(publicationRoot) {
  const built = await buildPublicationReader({
    publicationRoot,
    audience: "public",
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  return built.value.reader;
}

async function buildOutput(publicationRoot) {
  const built = await buildPublicationReader({
    publicationRoot,
    audience: "public",
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  return built.value;
}

/** Exactly what the generated host does: bound artifacts, with no authoring code. */
async function createAsGeneratedHostDoes(built) {
  return await createPublicationNextApplication({
    reader: built.reader,
    ...(built.extensions === undefined
      ? {}
      : {
          extensionData: built.extensions.envelope,
          extensions: extensionRegistrationsForBuild(built),
        }),
    ...(built.updates === undefined
      ? {}
      : { updatesData: built.updates.envelope }),
  });
}

// -------------------------------------------------- the declaration is true

test("every route kind the contract claims is one the application really serves", async (t) => {
  const publicationRoot = join(fixtureRoot, "canonical-field-notes");
  const built = await buildOutput(publicationRoot);
  const reader = built.reader;

  const kinds = new Set(
    reader.routes.active.map((route) => route.target.kind),
  );
  for (const kind of kinds) {
    assert.ok(
      PUBLISHER_NEXT_HOST_CAPABILITIES.routeKinds.includes(kind),
      `the artifact contains a ${kind} route the contract does not claim`,
    );
  }

  const created = await createAsGeneratedHostDoes(built);
  assert.ok(
    created.valid,
    `the contract claims these kinds work: ${JSON.stringify(created.diagnostics)}`,
  );
});

test("the Updates kind the contract claims is served from bound data", async () => {
  // Without this, the declaration could quietly become a lie in the safe
  // direction: disclaiming something that actually works, and refusing builds
  // for no reason.
  const built = await buildOutput(join(fixtureRoot, "canonical-field-notes"));
  const reader = built.reader;
  assert.ok(
    reader.routes.active.some(({ target }) => target.kind === "updates"),
    "this fixture is supposed to declare an Updates route",
  );
  assert.equal(
    PUBLISHER_NEXT_HOST_CAPABILITIES.routeKinds.includes("updates"),
    true,
  );

  const created = await createAsGeneratedHostDoes(built);
  assert.ok(created.valid, JSON.stringify(created.diagnostics));
});

test("named Updates views expand declared pagination into static pages", async () => {
  const built = await buildOutput(
    join(fixtureRoot, "declared-night-dispatch"),
  );
  const created = await createAsGeneratedHostDoes(built);
  assert.ok(created.valid, JSON.stringify(created.diagnostics));
  const application = created.value;
  const pageTwo = application.resolveRoute(["dispatch-log", "2"]);
  assert.equal(pageTwo.status, "resolved");
  assert.equal(pageTwo.page.kind, "updates");
  assert.equal(pageTwo.page.viewId, "all");
  assert.equal(pageTwo.page.pageNumber, 2);
  const html = renderToStaticMarkup(
    await application.renderPage(pageTwo.page),
  );
  assert.match(html, /Signal Lantern published/u);
  assert.doesNotMatch(html, /Platform Bell published/u);
  assert.match(html, /href="\/dispatch-log"/u);
  const metadata = await application.generateMetadata({
    params: Promise.resolve({
      segments: ["dispatch-log", "2"],
    }),
  });
  assert.equal(metadata.title, "Dispatch log, page 2 | Night Dispatch");

  const literaryPageTwo = application.resolveRoute([
    "dispatch-log",
    "literary",
    "2",
  ]);
  assert.equal(literaryPageTwo.status, "resolved");
  assert.equal(literaryPageTwo.page.viewId, "literary");
});

test("the renderer rejects stale and ambiguous Updates artifacts", async () => {
  const built = await buildOutput(
    join(fixtureRoot, "declared-night-dispatch"),
  );
  const stale = structuredClone(built.updates.envelope);
  stale.buildId = `sha256:${"0".repeat(64)}`;
  const staleResult = await createPublicationNextApplication({
    reader: built.reader,
    updatesData: stale,
  });
  assert.equal(staleResult.valid, false);
  assert.equal(staleResult.diagnostics[0].code, "next.updates.data_stale");

  const duplicate = structuredClone(built.updates.envelope);
  duplicate.views.push(structuredClone(duplicate.views[0]));
  const duplicateResult = await createPublicationNextApplication({
    reader: built.reader,
    updatesData: duplicate,
  });
  assert.equal(duplicateResult.valid, false);
  assert.equal(
    duplicateResult.diagnostics[0].code,
    "next.updates.view_duplicate",
  );
});

// ------------------------------------------------------- the check catches it

for (const fixture of ["canonical-field-notes", "declared-night-dispatch"]) {
  test(`${fixture} is accepted with materialized Updates data`, async () => {
    const reader = await build(join(fixtureRoot, fixture));
    const decision = assertHostCanServe({
      reader,
      capabilities: readHostCapabilities(nextHostModule),
      renderer: "@genii-foundation/publisher-next",
    });
    assert.ok(decision.valid, JSON.stringify(decision.diagnostics));
  });
}

test("a publication the host can serve is accepted", async (t) => {
  const publicationRoot = editablePublication(
    t,
    "declared-night-dispatch",
    (manifest) => {
      delete manifest.routes.updates;
      delete manifest.updates;
      delete manifest.continuity;
    },
  );
  const built = await buildOutput(publicationRoot);
  const reader = built.reader;
  const decision = assertHostCanServe({
    reader,
    capabilities: readHostCapabilities(nextHostModule),
    renderer: "@genii-foundation/publisher-next",
  });
  assert.ok(decision.valid, JSON.stringify(decision.diagnostics, null, 2));

  // And the application really does start, which is the claim the check is
  // standing in for.
  const created = await createAsGeneratedHostDoes(built);
  assert.ok(created.valid, JSON.stringify(created.diagnostics));
});

// ----------------------------------------------------- reading a declaration

test("a renderer declaring no capabilities is refused, not assumed capable", async () => {
  const reader = await build(join(fixtureRoot, "canonical-field-notes"));
  for (const module of [
    {},
    { PUBLISHER_NEXT_HOST_CAPABILITIES: null },
    { PUBLISHER_NEXT_HOST_CAPABILITIES: "everything" },
    { PUBLISHER_NEXT_HOST_CAPABILITIES: {} },
    { PUBLISHER_NEXT_HOST_CAPABILITIES: { routeKinds: "home" } },
    { PUBLISHER_NEXT_HOST_CAPABILITIES: { routeKinds: [7] } },
    { PUBLISHER_NEXT_HOST_CAPABILITIES: { routeKinds: [""] } },
  ]) {
    assert.equal(
      readHostCapabilities(module),
      null,
      `${JSON.stringify(module)} must not read as a capability set`,
    );
    const decision = assertHostCanServe({
      reader,
      capabilities: readHostCapabilities(module),
      renderer: "@example/renderer",
    });
    assert.equal(decision.valid, false);
    assert.equal(
      decision.diagnostics[0].code,
      "host.capabilities_missing",
    );
    // Absent and "serves everything" are different claims, and only one of them
    // is safe to guess at.
    assert.match(decision.diagnostics[0].message, /different claims/u);
  }
});

test("a renderer claiming everything is accepted", async () => {
  const reader = await build(join(fixtureRoot, "canonical-field-notes"));
  const kinds = [
    ...new Set(reader.routes.active.map((route) => route.target.kind)),
  ];
  const decision = assertHostCanServe({
    reader,
    capabilities: readHostCapabilities({
      PUBLISHER_NEXT_HOST_CAPABILITIES: { routeKinds: kinds },
    }),
    renderer: "@example/renderer",
  });
  assert.ok(decision.valid, JSON.stringify(decision.diagnostics));
});

test("every unsupported kind is reported, not just the first", async () => {
  const reader = await build(join(fixtureRoot, "canonical-field-notes"));
  const unsupported = findUnsupportedHostFeatures({
    reader,
    capabilities: { routeKinds: ["home"] },
  });
  const features = unsupported.map((entry) => entry.feature).sort();
  assert.deepEqual(features, [
    "collection route",
    "updates route",
    "work route",
  ]);
  for (const entry of unsupported) {
    assert.ok(
      entry.paths.length > 0,
      `${entry.feature} must name the routes that carry it`,
    );
  }
});

// -------------------------------------------- resolving the real renderer

const executable = fileURLToPath(
  new URL(
    "../packages/publisher/bin/genii-publisher.mjs",
    import.meta.url,
  ),
);
const nextPackageRoot = fileURLToPath(
  new URL("../packages/next/", import.meta.url),
);

function runPublisher(cwd, args) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

test("the engine's own renderer resolves, with its import-only exports", (t) => {
  // This is the case that was broken and that no fixture covered. Every fixture
  // renderer in this repository exports "./host" as a bare string, which resolves
  // under any condition. The real renderer declares conditions, only "import",
  // and the previous resolver applied "require" and reported the package missing.
  const root = scratch(t);
  const hostRoot = join(root, "host");
  mkdirSync(join(hostRoot, "node_modules", "@genii-foundation"), {
    recursive: true,
  });
  cpSync(
    join(nextPackageRoot, "package.json"),
    join(hostRoot, "node_modules", "@genii-foundation", "publisher-next", "package.json"),
    { recursive: false, force: true },
  );
  // The whole package, so the declared subpath target really exists on disk.
  rmSync(join(hostRoot, "node_modules", "@genii-foundation", "publisher-next"), {
    recursive: true,
    force: true,
  });
  cpSync(
    nextPackageRoot,
    join(hostRoot, "node_modules", "@genii-foundation", "publisher-next"),
    { recursive: true },
  );

  const declared = JSON.parse(
    readFileSync(join(nextPackageRoot, "package.json"), "utf8"),
  ).exports["./host"];
  assert.equal(
    typeof declared,
    "object",
    "this test is about a conditions object; a bare string would not exercise it",
  );
  assert.equal(
    Object.hasOwn(declared, "require"),
    false,
    "and specifically about one with no require condition",
  );

  // No publication and no Git, so this stops at renderer resolution, which is
  // exactly what is under test.
  const planned = runPublisher(hostRoot, ["init", "plan"]);
  assert.equal(
    planned.stderr.includes("Could not find"),
    false,
    `the renderer must resolve:\n${planned.stderr}`,
  );
  assert.match(planned.stdout, /Renderer\s+@genii-foundation\/publisher-next/u);
  assert.match(planned.stdout, /Contract\s+0\.15\.0/u);
});

test("a genuinely missing renderer says where it looked", (t) => {
  const root = scratch(t);
  const hostRoot = join(root, "host");
  mkdirSync(hostRoot, { recursive: true });
  const planned = runPublisher(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/absent",
  ]);
  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /Could not find @example\/absent/u);
  assert.match(planned.stderr, /npm install --save-dev @example\/absent/u);
  // A resolver that cannot say where it looked leaves an author guessing about
  // which node_modules was consulted.
  assert.match(planned.stderr, /Looked in:/u);
  assert.match(planned.stderr, /node_modules/u);
});

test("a renderer with no host subpath is refused by name", (t) => {
  const root = scratch(t);
  const hostRoot = join(root, "host");
  const packageRoot = join(hostRoot, "node_modules", "@example", "hostless");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify(
      { name: "@example/hostless", version: "1.0.0", type: "module", exports: { ".": "./index.js" } },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const planned = runPublisher(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/hostless",
  ]);
  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /does not export a "\.\/host" subpath/u);
});

test("a host subpath pointing at a missing file is refused", (t) => {
  const root = scratch(t);
  const hostRoot = join(root, "host");
  const packageRoot = join(hostRoot, "node_modules", "@example", "unbuilt");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "@example/unbuilt",
        version: "1.0.0",
        type: "module",
        exports: { "./host": { import: "./dist/host.js" } },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const planned = runPublisher(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/unbuilt",
  ]);
  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /does not exist/u);
  assert.match(planned.stderr, /may need building or reinstalling/u);
});

test("an exports target reaching outside the package is refused", (t) => {
  // A regression I introduced. The resolver that replaced createRequire().resolve()
  // checked only that the target began with "./", so "./../../planted.js" passed
  // and the engine imported and executed a file outside the renderer package. Node
  // refuses the same target with ERR_PACKAGE_PATH_NOT_EXPORTED, so the hand rolled
  // resolver was more permissive than the specification it replaced.
  //
  // A renderer is code the author installed and this command runs it, so the
  // package is trusted. Reaching outside it is a different claim, and the package
  // boundary is what exports exists to describe.
  const root = scratch(t);
  const hostRoot = join(root, "host");
  const packageRoot = join(hostRoot, "node_modules", "@example", "sneaky");
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(join(hostRoot, "planted"), { recursive: true });

  const marker = join(root, "executed.txt");
  writeFileSync(
    join(hostRoot, "planted", "outside.js"),
    `import { writeFileSync } from "node:fs";\n` +
      `writeFileSync(${JSON.stringify(marker)}, "ran\\n");\n` +
      `export const PUBLISHER_NEXT_HOST_CONTRACT_VERSION = "0.1.0";\n`,
    "utf8",
  );

  for (const target of [
    "./../../../planted/outside.js",
    "./dist/../../../planted/outside.js",
    "../planted/outside.js",
  ]) {
    writeFileSync(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "@example/sneaky",
        version: "1.0.0",
        type: "module",
        exports: { "./host": { import: target } },
      })}\n`,
      "utf8",
    );
    const planned = runPublisher(hostRoot, [
      "init",
      "plan",
      "--renderer",
      "@example/sneaky",
    ]);
    assert.equal(planned.status, 1, `${target} must be refused`);
    assert.match(planned.stderr, /reaches outside the package/u);
    assert.equal(
      existsSync(marker),
      false,
      `${target} executed code outside the renderer package`,
    );
  }
});

test("a nested exports target inside the package still resolves", (t) => {
  // The refusal above is only worth having if the ordinary shape works, and the
  // shipped renderer uses exactly this one.
  const root = scratch(t);
  const hostRoot = join(root, "host");
  const packageRoot = join(hostRoot, "node_modules", "@example", "ok");
  mkdirSync(join(packageRoot, "dist"), { recursive: true });
  writeFileSync(
    join(packageRoot, "dist", "host.js"),
    [
      'export const PUBLISHER_NEXT_HOST_CONTRACT_VERSION = "0.1.0";',
      "export const PUBLISHER_NEXT_HOST_MIGRATIONS = [];",
      'export const PUBLISHER_NEXT_HOST_CAPABILITIES = { routeKinds: ["home"] };',
      "export function createPublisherNextHostTemplate(input) {",
      '  return { contractVersion: "0.1.0", renderer: "@example/ok", rendererVersion: "1.0.0",',
      '    readerDataPath: "publication-reader.json",',
      '    files: [{ path: "package.json", contents: JSON.stringify({ name: input.hostPackageName }, null, 2) + "\\n" }] };',
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify({
      name: "@example/ok",
      version: "1.0.0",
      type: "module",
      exports: { "./host": { import: "./dist/host.js" } },
    })}\n`,
    "utf8",
  );
  const planned = runPublisher(hostRoot, [
    "init",
    "plan",
    "--renderer",
    "@example/ok",
  ]);
  assert.equal(
    planned.stderr.includes("reaches outside"),
    false,
    planned.stderr,
  );
  assert.match(planned.stdout, /Renderer\s+@example\/ok/u);
});
