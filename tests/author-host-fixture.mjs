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

// A host repository arranged the way an author's actually is.
//
// Shared because two suites needed the same thing and the arrangement is not
// incidental. A host has Git, because apply and rollback require it. It has a
// renderer in node_modules, because the engine resolves the host contract from
// the author's own installation rather than importing a renderer. It has a
// publication, because the manifest declares which paths hold sources. And it is
// initialized, because an uninitialized host has nothing that reads a reader
// artifact.
//
// Tests that skip any of those are testing an arrangement no author has.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const executable = fileURLToPath(
  new URL(
    "../packages/publisher/bin/genii-publisher.mjs",
    import.meta.url,
  ),
);

export const fixtureRoot = fileURLToPath(
  new URL("../fixtures/", import.meta.url),
);

/** Absolute path to a fixture publication by name. */
export const publicationFixture = (name) => join(fixtureRoot, name);

export function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Probe",
      GIT_AUTHOR_EMAIL: "probe@example.test",
      GIT_COMMITTER_NAME: "Probe",
      GIT_COMMITTER_EMAIL: "probe@example.test",
    },
  }).trim();
}

/** Runs the real executable in a host and returns its status and output. */
export function runPublisher(cwd, args) {
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

/**
 * Installs a renderer package into a host's node_modules.
 *
 * The artifact path and the generated file are both named after the renderer, so
 * a host acting through the wrong renderer produces an artifact its own generated
 * code does not import. That is what makes a mismatch observable rather than
 * merely wrong.
 */
export function installRenderer(
  hostRoot,
  name,
  {
    contractVersion = "0.1.0",
    version = "1.0.0",
    readerDataPath,
    searchDataPath,
    omitSearchDataPath = false,
    audioDataPath,
    omitAudioDataPath = false,
    syncDataPath,
    omitSyncDataPath = false,
    files,
    migrations = [],
    omitMigrations = false,
    capabilities = {
      routeKinds: ["collection", "home", "section", "updates", "work"],
      dataArtifacts: ["audio", "search", "sync"],
    },
    omitCapabilities = false,
  } = {},
) {
  const short = name.split("/").pop();
  const artifactPath = readerDataPath ?? `${short}-reader.json`;
  const searchPath = omitSearchDataPath
    ? undefined
    : (searchDataPath ?? `public/${short}-search.json`);
  // A stub renderer claims support for narration by default, so it needs a place
  // to put it. Declaring the capability without a path is a renderer defect the
  // engine refuses, and omitAudioDataPath exists so that case stays testable.
  const audioPath = omitAudioDataPath
    ? undefined
    : (audioDataPath ?? `public/${short}-audio.json`);
  const syncPath = omitSyncDataPath
    ? undefined
    : (syncDataPath ?? `public/${short}-sync.json`);
  const declared =
    files ??
    [
      {
        path: `${short}-app.js`,
        contents: `import reader from "./${artifactPath}" with { type: "json" };\n`,
      },
    ];
  const packageRoot = join(hostRoot, "node_modules", ...name.split("/"));
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    `${JSON.stringify(
      { name, version, type: "module", exports: { "./host": "./host.js" } },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    join(packageRoot, "host.js"),
    [
      `export const PUBLISHER_NEXT_HOST_CONTRACT_VERSION = ${JSON.stringify(
        contractVersion,
      )};`,
      // A stub renderer serves nothing, so it claims everything the fixture
      // publications contain. A real renderer's claim is checked against its own
      // behaviour in tests/pipeline-render.test.mjs.
      omitCapabilities
        ? "// capability set deliberately absent"
        : `export const PUBLISHER_NEXT_HOST_CAPABILITIES = ${JSON.stringify(
            capabilities,
          )};`,
      omitMigrations
        ? "// registry deliberately absent"
        : `export const PUBLISHER_NEXT_HOST_MIGRATIONS = ${JSON.stringify(
            migrations,
          )};`,
      "export function createPublisherNextHostTemplate(input) {",
      "  return {",
      "    contractVersion: PUBLISHER_NEXT_HOST_CONTRACT_VERSION,",
      `    renderer: ${JSON.stringify(name)},`,
      `    rendererVersion: ${JSON.stringify(version)},`,
      `    readerDataPath: ${JSON.stringify(artifactPath)},`,
      ...(searchPath === undefined
        ? []
        : [`    searchDataPath: ${JSON.stringify(searchPath)},`]),
      // Omitted entirely when the caller gives none, so a renderer with no place
      // for narration is expressible. Declaring it as undefined would be a
      // different claim from not declaring it at all.
      ...(audioPath === undefined
        ? []
        : [`    audioDataPath: ${JSON.stringify(audioPath)},`]),
      ...(syncPath === undefined
        ? []
        : [`    syncDataPath: ${JSON.stringify(syncPath)},`]),
      "    files: [",
      '      { path: "package.json", contents: JSON.stringify({ name: input.hostPackageName }, null, 2) + "\\n" },',
      `      ...${JSON.stringify(declared)},`,
      "    ],",
      "  };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    artifactPath,
    searchDataPath: searchPath,
    audioDataPath: audioPath,
    syncDataPath: syncPath,
    generatedPath: `${short}-app.js`,
  };
}

export function planHashFrom(stdout) {
  const match = /^Plan\s+(sha256:[a-f0-9]{64})$/mu.exec(stdout);
  assert.ok(match, `expected a plan hash in:\n${stdout}`);
  return match[1];
}

/** Initializes a host through the real commands and commits the result. */
export function initializeHost(hostRoot, renderer) {
  const planned = runPublisher(hostRoot, [
    "init",
    "plan",
    "--renderer",
    renderer,
  ]);
  assert.equal(planned.status, 0, planned.stderr);
  const applied = runPublisher(hostRoot, [
    "init",
    "apply",
    "--renderer",
    renderer,
    "--plan",
    planHashFrom(planned.stdout),
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "initialize"]);
  return applied;
}

/**
 * Creates a host repository and returns its root.
 *
 * Pass `initialize: false` only to test what an uninitialized host does.
 */
export function authorHost(
  t,
  {
    renderers = ["@example/alpha"],
    rendererOptions = {},
    publication = "canonical-field-notes",
    initialize = true,
    initializeWith,
  } = {},
) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-host-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const hostRoot = join(root, "host");
  mkdirSync(hostRoot);
  git(hostRoot, ["init", "--quiet", "--initial-branch=main"]);
  writeFileSync(
    join(hostRoot, ".gitignore"),
    "node_modules/\n.publisher/\n",
    "utf8",
  );
  if (publication !== null) {
    cpSync(publicationFixture(publication), hostRoot, { recursive: true });
  }
  const installed = new Map();
  for (const renderer of renderers) {
    installed.set(
      renderer,
      installRenderer(hostRoot, renderer, rendererOptions[renderer] ?? {}),
    );
  }
  git(hostRoot, ["add", "-A"]);
  git(hostRoot, ["commit", "--quiet", "-m", "the publication"]);

  if (initialize) {
    initializeHost(hostRoot, initializeWith ?? renderers[0]);
  }
  return { hostRoot, installed };
}
