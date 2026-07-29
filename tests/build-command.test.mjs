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

// The build command, end to end.
//
// Driving the real executable against a real fixture publication and a renderer
// installed into node_modules. The library tests cover each layer; this proves
// the command joins them, reports what it did, and exits with a status a script
// can act on.
//
// The renderer is a third-party one, not the Next package, so a passing suite
// says the host contract boundary works rather than that the engine can talk to
// itself.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const executable = fileURLToPath(
  new URL(
    "../packages/publisher/bin/genii-publisher.mjs",
    import.meta.url,
  ),
);
const fixtureRoot = fileURLToPath(new URL("../fixtures/", import.meta.url));

const rendererName = "@example/renderer";

function run(cwd, args) {
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

function installRenderer(hostRoot, { readerDataPath = "publication-reader.json" } = {}) {
  const packageRoot = join(
    hostRoot,
    "node_modules",
    ...rendererName.split("/"),
  );
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: rendererName,
        version: "1.0.0",
        type: "module",
        exports: { "./host": "./host.js" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(packageRoot, "host.js"),
    [
      'export const PUBLISHER_NEXT_HOST_CONTRACT_VERSION = "0.1.0";',
      "export const PUBLISHER_NEXT_HOST_MIGRATIONS = [];",
      "export function createPublisherNextHostTemplate(input) {",
      "  return {",
      "    contractVersion: PUBLISHER_NEXT_HOST_CONTRACT_VERSION,",
      `    renderer: ${JSON.stringify(rendererName)},`,
      '    rendererVersion: "1.0.0",',
      `    readerDataPath: ${JSON.stringify(readerDataPath)},`,
      "    files: [",
      "      {",
      '        path: "package.json",',
      "        contents:",
      "          JSON.stringify({ name: input.hostPackageName }, null, 2) +",
      '          "\\n",',
      "      },",
      '      { path: "app/page.tsx", contents: "export default null;\\n" },',
      "    ],",
      "  };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}

function host(t, options = {}) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-build-cmd-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const hostRoot = join(root, "host");
  mkdirSync(hostRoot);
  installRenderer(hostRoot, options);
  return hostRoot;
}

const publication = (name) => join(fixtureRoot, name);

// -------------------------------------------------------------- building

for (const fixture of ["canonical-field-notes", "declared-night-dispatch"]) {
  test(`build writes the artifact for ${fixture}`, (t) => {
    const hostRoot = host(t);
    const built = run(hostRoot, [
      "build",
      "--renderer",
      rendererName,
      "--publication",
      publication(fixture),
    ]);
    assert.equal(built.status, 0, built.stderr);
    assert.match(built.stdout, /Artifact\s+publication-reader\.json/u);
    assert.match(built.stdout, /Digest\s+sha256:[a-f0-9]{64}/u);
    assert.match(built.stdout, /^Written\.$/mu);

    const artifact = join(hostRoot, "publication-reader.json");
    assert.ok(existsSync(artifact));
    const parsed = JSON.parse(readFileSync(artifact, "utf8"));
    assert.equal(typeof parsed.publicationId, "string");
    assert.ok(parsed.works.length > 0);
    // Size is reported with digit grouping, the same as every other user-facing
    // number in this project.
    assert.match(built.stdout, /Size\s+[\d,]+ bytes/u);
  });
}

test("a second build of unchanged sources reports it is already current", (t) => {
  const hostRoot = host(t);
  const args = [
    "build",
    "--renderer",
    rendererName,
    "--publication",
    publication("canonical-field-notes"),
  ];
  assert.equal(run(hostRoot, args).status, 0);
  const second = run(hostRoot, args);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Already current\. Nothing written\./u);
});

test("build emits machine readable output on request", (t) => {
  const hostRoot = host(t);
  const built = run(hostRoot, [
    "build",
    "--json",
    "--renderer",
    rendererName,
    "--publication",
    publication("canonical-field-notes"),
  ]);
  assert.equal(built.status, 0, built.stderr);
  const report = JSON.parse(built.stdout);
  assert.equal(report.outcome, "written");
  assert.equal(report.hostRelativePath, "publication-reader.json");
  assert.match(report.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(typeof report.bytes, "number");
});

test("the artifact a build writes is byte identical across hosts", (t) => {
  const first = host(t);
  const second = host(t);
  const args = (root) => [
    "build",
    "--renderer",
    rendererName,
    "--publication",
    publication("declared-night-dispatch"),
  ];
  assert.equal(run(first, args(first)).status, 0);
  assert.equal(run(second, args(second)).status, 0);
  // The artifact must not carry anything about where it was built, or a committed
  // artifact would differ between an author's machine and a build server.
  assert.equal(
    readFileSync(join(first, "publication-reader.json"), "utf8"),
    readFileSync(join(second, "publication-reader.json"), "utf8"),
  );
});

// -------------------------------------------------------------- checking

test("check reports missing, then current, and exits accordingly", (t) => {
  const hostRoot = host(t);
  const base = [
    "--renderer",
    rendererName,
    "--publication",
    publication("canonical-field-notes"),
  ];

  const missing = run(hostRoot, ["build", "--check", ...base]);
  assert.equal(missing.status, 1, "a missing artifact must not exit zero");
  assert.match(missing.stdout, /No artifact on disk/u);
  assert.equal(
    existsSync(join(hostRoot, "publication-reader.json")),
    false,
    "check must write nothing",
  );

  assert.equal(run(hostRoot, ["build", ...base]).status, 0);
  const current = run(hostRoot, ["build", "--check", ...base]);
  assert.equal(current.status, 0, current.stdout);
  assert.match(current.stdout, /matches this publication/u);
});

test("check reports a stale artifact and exits nonzero", (t) => {
  const hostRoot = host(t);
  const base = [
    "--renderer",
    rendererName,
    "--publication",
    publication("canonical-field-notes"),
  ];
  assert.equal(run(hostRoot, ["build", ...base]).status, 0);
  writeFileSync(
    join(hostRoot, "publication-reader.json"),
    '{"stale":true}\n',
    "utf8",
  );

  const stale = run(hostRoot, ["build", "--check", ...base]);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /built from different sources/u);
  // This is the whole point of check in a repository that commits its artifact,
  // so the stale content must survive for the author to inspect.
  assert.equal(
    readFileSync(join(hostRoot, "publication-reader.json"), "utf8"),
    '{"stale":true}\n',
  );
});

// -------------------------------------------------------------- refusals

test("a renderer aiming the artifact at its own contract file is refused", (t) => {
  const hostRoot = host(t, { readerDataPath: "app/page.tsx" });
  // The file has to already exist, with content worth losing. Asserting that a
  // file which never existed still does not exist proves nothing, and the whole
  // point of the refusal is that this content survives.
  mkdirSync(join(hostRoot, "app"), { recursive: true });
  const original = "export default null; // the renderer's own page\n";
  writeFileSync(join(hostRoot, "app", "page.tsx"), original, "utf8");

  const built = run(hostRoot, [
    "build",
    "--renderer",
    rendererName,
    "--publication",
    publication("canonical-field-notes"),
  ]);
  assert.equal(built.status, 1);
  assert.match(built.stderr, /Every build would overwrite it/u);
  assert.equal(
    readFileSync(join(hostRoot, "app", "page.tsx"), "utf8"),
    original,
    "the contract file must be untouched",
  );
});

test("a renderer aiming the artifact outside the host is refused", (t) => {
  const hostRoot = host(t, { readerDataPath: "../escaped.json" });
  const built = run(hostRoot, [
    "build",
    "--renderer",
    rendererName,
    "--publication",
    publication("canonical-field-notes"),
  ]);
  assert.equal(built.status, 1);
  assert.equal(
    readdirSync(join(hostRoot, "..")).sort().join(","),
    "host",
    "nothing may be written beside the host root",
  );
});

test("declared source roots protect the tree with no flag passed", (t) => {
  const hostRoot = host(t, {
    readerDataPath: "publication/works/rain-gauge/reader.json",
  });
  // The publication lives inside the host, which is the ordinary arrangement and
  // the one where the hole was live. A publication outside the host is already
  // unreachable, because the path resolver refuses to write outside it.
  cpSync(publication("canonical-field-notes"), hostRoot, { recursive: true });

  const built = run(hostRoot, ["build", "--renderer", rendererName]);
  assert.equal(built.status, 1, `writing into a declared source root must fail:\n${built.stdout}`);
  assert.match(built.stderr, /inside the declared root publication/u);
  assert.equal(
    existsSync(join(hostRoot, "publication", "works", "rain-gauge", "reader.json")),
    false,
    "nothing may be written into the author's source tree",
  );
  // No flag was passed. The manifest is what protected the tree.
  assert.equal(built.stderr.includes("--protected-root"), false);
});

test("build reports an unreadable manifest through the loader", (t) => {
  const hostRoot = host(t);
  writeFileSync(join(hostRoot, "publication.json"), "{ not json\n", "utf8");
  const built = run(hostRoot, ["build", "--renderer", rendererName]);
  assert.equal(built.status, 1);
  // The loader gets there first and its diagnostic is the better one, naming the
  // manifest and the protocol rule. The protected-roots refusal is the operative
  // guard for init and upgrade, which never load the publication.
  assert.match(built.stderr, /loader\.manifest\.json_invalid/u);
  assert.match(built.stderr, /publication\.json/u);
  assert.equal(existsSync(join(hostRoot, "publication-reader.json")), false);
});

test("init refuses an unreadable manifest rather than dropping protection", (t) => {
  const hostRoot = host(t);
  writeFileSync(join(hostRoot, "publication.json"), "{ not json\n", "utf8");
  // init never loads the publication, so nothing else would notice. Proceeding
  // would initialize a host with no idea which paths hold the author's sources.
  const planned = run(hostRoot, ["init", "plan", "--renderer", rendererName]);
  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /which paths hold your sources/u);
  assert.match(
    planned.stderr,
    /rather than treating your publication as unprotected/u,
  );
  assert.equal(existsSync(join(hostRoot, "publisher.host.json")), false);
});

test("a publication that does not compile fails with named diagnostics", (t) => {
  const hostRoot = host(t);
  const broken = join(hostRoot, "broken-publication");
  mkdirSync(broken);
  writeFileSync(
    join(broken, "publication.json"),
    '{"schemaVersion":"1.0"}\n',
    "utf8",
  );

  const built = run(hostRoot, [
    "build",
    "--renderer",
    rendererName,
    "--publication",
    broken,
  ]);
  assert.equal(built.status, 1);
  assert.match(built.stderr, /did not compile/u);
  // A code per problem, so an author can search for it rather than reading prose.
  assert.match(built.stderr, /^\s{2}\S+\s/mu);
  assert.equal(existsSync(join(hostRoot, "publication-reader.json")), false);
});

test("an invalid audience is reported before anything is resolved", (t) => {
  const hostRoot = host(t);
  const built = run(hostRoot, [
    "build",
    "--audience",
    "everyone",
    "--renderer",
    rendererName,
    "--publication",
    publication("canonical-field-notes"),
  ]);
  assert.equal(built.status, 1);
  assert.match(built.stderr, /--audience must be public or preview/u);
});

test("preview and public audiences produce different artifacts", (t) => {
  const publicHost = host(t);
  const previewHost = host(t);
  const base = (audience) => [
    "build",
    "--audience",
    audience,
    "--renderer",
    rendererName,
    "--publication",
    publication("declared-night-dispatch"),
  ];
  assert.equal(run(publicHost, base("public")).status, 0);
  assert.equal(run(previewHost, base("preview")).status, 0);

  const asPublic = JSON.parse(
    readFileSync(join(publicHost, "publication-reader.json"), "utf8"),
  );
  const asPreview = JSON.parse(
    readFileSync(join(previewHost, "publication-reader.json"), "utf8"),
  );
  assert.equal(asPublic.audience, "public");
  assert.equal(asPreview.audience, "preview");
});
