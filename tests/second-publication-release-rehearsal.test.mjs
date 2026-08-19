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
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  relative,
  sep,
} from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  preparePackageArchives,
  resolveExactNpmInvocation,
  verifyPreparedPackageArchives,
} from "../provenance/scripts/package-artifacts.mjs";
import {
  discoverPublishablePackageRoots,
} from "../provenance/scripts/prepare-release.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const publicationFixture = join(
  repositoryRoot,
  "fixtures",
  "canonical-field-notes",
);
const npmExecPath = process.env.npm_execpath;
if (npmExecPath === undefined || npmExecPath.length === 0) {
  throw new Error(
    "The second-publication rehearsal must run through the exact npm CLI.",
  );
}

function run(command, arguments_, options = Object.freeze({})) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${options.label ?? basename(command)} exited with status ${result.status ?? "unknown"}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

function runNpm(arguments_, options = Object.freeze({})) {
  return run(process.execPath, [npmExecPath, ...arguments_], {
    ...options,
    label: options.label ?? `npm ${arguments_[0] ?? ""}`.trim(),
  });
}

function packagePath(path) {
  return path.split(sep).join("/");
}

function localDependency(fromRoot, archivePath) {
  return `file:${packagePath(relative(fromRoot, archivePath))}`;
}

function git(cwd, arguments_) {
  return run("git", arguments_, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "rehearsal@example.test",
      GIT_AUTHOR_NAME: "Release Rehearsal",
      GIT_COMMITTER_EMAIL: "rehearsal@example.test",
      GIT_COMMITTER_NAME: "Release Rehearsal",
    },
    label: `git ${arguments_[0] ?? ""}`.trim(),
  });
}

async function hashTree(paths) {
  const hash = createHash("sha256");
  async function visit(path, label) {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      const entryLabel = `${label}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(entryPath, entryLabel);
      } else if (entry.isFile()) {
        hash.update(entryLabel);
        hash.update("\0");
        hash.update(await readFile(entryPath));
        hash.update("\0");
      } else {
        throw new Error(`Unexpected publication source entry ${entryPath}.`);
      }
    }
  }
  for (const path of paths) {
    const statLabel = basename(path);
    if (statLabel === "publication.json") {
      hash.update(statLabel);
      hash.update("\0");
      hash.update(await readFile(path));
      hash.update("\0");
    } else {
      await visit(path, statLabel);
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

function packPackage(root, destination) {
  const result = JSON.parse(
    runNpm(
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--silent",
        "--pack-destination",
        destination,
        root,
      ],
      {
        cwd: destination,
        label: `pack ${basename(root)}`,
      },
    ),
  );
  assert.equal(result.length, 1);
  return join(destination, result[0].filename);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const port = address.port;
  await new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error === undefined) resolvePromise();
      else reject(error);
    });
  });
  return port;
}

async function startHost(hostRoot, environment) {
  const port = await availablePort();
  const child = spawn(
    process.execPath,
    [
      join(hostRoot, "node_modules", "next", "dist", "bin", "next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: hostRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`Second-publication host stopped early.\n${output}`);
    }
    try {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status > 0) {
        return { child, origin, output: () => output };
      }
    } catch {
      // The server is still starting.
    }
    if (Date.now() >= deadline) {
      child.kill("SIGTERM");
      throw new Error(`Second-publication host did not start.\n${output}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
}

async function stopHost(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) =>
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolvePromise();
      }, 10_000),
    ),
  ]);
}

async function removeOwnedTemporaryRoot(path) {
  const realTemporaryRoot = await realpath(tmpdir());
  const realTarget = await realpath(path);
  if (
    dirname(realTarget) !== realTemporaryRoot ||
    !basename(realTarget).startsWith("genii-publisher-release-rehearsal-")
  ) {
    throw new Error(`Refusing to remove unexpected path ${realTarget}.`);
  }
  await rm(realTarget, {
    force: true,
    maxRetries: 50,
    recursive: true,
    retryDelay: 100,
  });
}

test("exact release candidates build and serve a second canonical publication", async () => {
  const packageRoots = discoverPublishablePackageRoots();
  assert.deepEqual(packageRoots, [
    "packages/content/",
    "packages/next/",
    "packages/publisher/",
    "packages/reader/",
    "schemas/",
  ]);
  const npmInvocation = resolveExactNpmInvocation({ repositoryRoot });
  const preparation = await preparePackageArchives({
    repositoryRoot,
    packageRoots,
    npmInvocation,
  });
  const temporaryRoot = await realpath(
    await mkdtemp(
      join(tmpdir(), "genii-publisher-release-rehearsal-"),
    ),
  );
  let host;
  try {
    const archives = await verifyPreparedPackageArchives({
      repositoryRoot,
      expectedPackageRoots: packageRoots,
      npmInvocation,
      prepared: preparation,
    });
    assert.equal(archives.size, 5);
    for (const archive of archives.values()) {
      assert.equal(archive.name.toLowerCase().includes("coherence"), false);
      assert.equal(
        archive.packageFiles.some((path) =>
          path.toLowerCase().includes("coherence"),
        ),
        false,
      );
    }

    const hostRoot = join(temporaryRoot, "field-station");
    const overrideRoot = join(temporaryRoot, "overrides");
    const packedOverrideRoot = join(temporaryRoot, "packed-overrides");
    const themeRoot = join(overrideRoot, "rain-gauge-theme");
    const extensionRoot = join(overrideRoot, "station-index-extension");
    await Promise.all([
      mkdir(hostRoot),
      mkdir(themeRoot, { recursive: true }),
      mkdir(extensionRoot, { recursive: true }),
      mkdir(packedOverrideRoot),
    ]);
    await cp(publicationFixture, hostRoot, {
      recursive: true,
      verbatimSymlinks: true,
    });
    const sourcePaths = [
      join(hostRoot, "publication.json"),
      join(hostRoot, "publication"),
    ];
    const sourceHashBefore = await hashTree(sourcePaths);
    const portableAccent = "#315A72";
    const extensionSentinel = "SECOND_PUBLICATION_STATION_INDEX";
    await Promise.all([
      writeFile(
        join(themeRoot, "package.json"),
        `${JSON.stringify({
          name: "@example/rain-gauge-theme",
          version: "1.0.0",
          type: "module",
          exports: "./index.js",
        }, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        join(themeRoot, "index.js"),
        `const tokens = Object.freeze({
  color: Object.freeze({ canvas: "#F5F8F9", surface: "#FFFFFF", text: "#172126", mutedText: "#506168", accent: "${portableAccent}", focus: "#8A3500", border: "#B9C8CD" }),
  typography: Object.freeze({ bodyFamily: "Georgia, serif", headingFamily: "Trebuchet MS, sans-serif", monoFamily: "Consolas, monospace", baseSize: "1.0625rem", lineHeight: 1.7, defaultReaderFontFamilyId: "serif", readerFontFamilies: Object.freeze([Object.freeze({ id: "serif", label: "Weather serif", family: "Georgia, serif" }), Object.freeze({ id: "weather-sans", label: "Weather sans", family: "Trebuchet MS, sans-serif" })]) }),
  layout: Object.freeze({ readingMeasure: "66ch", pageGutter: "1.25rem", sectionGap: "3rem", controlRadius: "0.375rem" }),
});
export default Object.freeze({
  package: "@example/rain-gauge-theme",
  version: "1.0.0",
  rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",
  config: Object.freeze({ accent: "slate" }),
  implementation: Object.freeze({ kind: "genii.publisher.next-theme", apiVersion: "2.0", configure() { return Object.freeze({ valid: true, diagnostics: Object.freeze([]), value: Object.freeze({ tokens }) }); } }),
});
`,
        "utf8",
      ),
      writeFile(
        join(extensionRoot, "package.json"),
        `${JSON.stringify({
          name: "@example/station-index-extension",
          version: "1.0.0",
          type: "module",
          exports: "./index.js",
        }, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        join(extensionRoot, "index.js"),
        `export default Object.freeze({
  id: "station-index",
  package: "@example/station-index-extension",
  version: "1.0.0",
  engineCompatibility: ">=0.1.0-alpha.0 <0.2.0",
  capabilities: Object.freeze(["content.project"]),
  implementation: Object.freeze({
    kind: "genii.publisher.extension",
    apiVersion: "1.0",
    project({ content, config }) {
      return Object.freeze({ valid: true, diagnostics: Object.freeze([]), value: Object.freeze({ serverData: Object.freeze({ marker: "${extensionSentinel}", publicationId: content.publicationId, config }) }) });
    },
  }),
});
`,
        "utf8",
      ),
    ]);
    const themeTarball = packPackage(themeRoot, packedOverrideRoot);
    const extensionTarball = packPackage(
      extensionRoot,
      packedOverrideRoot,
    );
    const nextManifest = JSON.parse(
      await readFile(join(repositoryRoot, "packages", "next", "package.json"), "utf8"),
    );
    const workspaceManifest = JSON.parse(
      await readFile(join(repositoryRoot, "package.json"), "utf8"),
    );
    const dependencies = Object.fromEntries(
      [...archives.values()].map((archive) => [
        archive.name,
        localDependency(hostRoot, archive.archivePath),
      ]),
    );
    Object.assign(dependencies, {
      "@example/rain-gauge-theme": localDependency(hostRoot, themeTarball),
      "@example/station-index-extension": localDependency(
        hostRoot,
        extensionTarball,
      ),
      next: nextManifest.peerDependencies.next,
      react: nextManifest.peerDependencies.react,
      "react-dom": nextManifest.peerDependencies["react-dom"],
    });
    await Promise.all([
      writeFile(
        join(hostRoot, "package.json"),
        `${JSON.stringify({
          name: "rain-gauge-release-rehearsal",
          version: "1.0.0",
          private: true,
          type: "module",
          scripts: { build: "next build", start: "next start" },
          dependencies,
          devDependencies: {
            "@types/node": nextManifest.devDependencies["@types/node"],
            "@types/react": nextManifest.devDependencies["@types/react"],
            "@types/react-dom": nextManifest.devDependencies["@types/react-dom"],
            typescript: nextManifest.devDependencies.typescript,
          },
          overrides: workspaceManifest.overrides,
        }, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        join(hostRoot, ".gitignore"),
        ".next/\nnode_modules/\npublication-*.json\n",
        "utf8",
      ),
      writeFile(
        join(hostRoot, "publisher.theme.mjs"),
        'export { default } from "@example/rain-gauge-theme";\n',
        "utf8",
      ),
      writeFile(
        join(hostRoot, "publisher.extensions.mjs"),
        'import stationIndex from "@example/station-index-extension";\n\nexport default Object.freeze([stationIndex]);\n',
        "utf8",
      ),
    ]);

    const installEnvironment = {
      ...process.env,
      CI: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
      TZ: "UTC",
    };
    delete installEnvironment.NODE_ENV;
    assert.equal(
      runNpm(["--version"], { cwd: hostRoot }),
      workspaceManifest.engines.npm,
    );
    runNpm(
      ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      {
        cwd: hostRoot,
        env: installEnvironment,
        label: "second-publication candidate install",
      },
    );
    runNpm(
      ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
      {
        cwd: hostRoot,
        env: installEnvironment,
        label: "second-publication frozen offline install",
      },
    );
    for (const archive of archives.values()) {
      const installedManifest = JSON.parse(
        await readFile(
          join(hostRoot, "node_modules", ...archive.name.split("/"), "package.json"),
          "utf8",
        ),
      );
      assert.equal(installedManifest.version, archive.version);
    }

    git(hostRoot, ["init", "--quiet", "--initial-branch=main"]);
    git(hostRoot, ["add", "-A"]);
    git(hostRoot, ["commit", "--quiet", "-m", "neutral publication"]);
    const executable = join(
      hostRoot,
      "node_modules",
      "@genii-foundation",
      "publisher",
      "bin",
      "genii-publisher.mjs",
    );
    const runPublisher = (arguments_) =>
      run(process.execPath, [executable, ...arguments_], {
        cwd: hostRoot,
        env: { ...installEnvironment, NO_COLOR: "1" },
        label: `genii-publisher ${arguments_.join(" ")}`,
      });
    const plan = JSON.parse(runPublisher(["init", "plan", "--json"]));
    assert.equal(plan.layout, "canonical");
    assert.equal(plan.renderer, "@genii-foundation/publisher-next");
    assert.equal(plan.outcome, "initialize");
    const applied = JSON.parse(
      runPublisher([
        "init",
        "apply",
        "--plan",
        plan.planHash,
        "--json",
      ]),
    );
    assert.equal(applied.outcome, "applied");
    git(hostRoot, ["add", "-A"]);
    git(hostRoot, ["commit", "--quiet", "-m", "initialize publisher"]);
    runPublisher(["build"]);
    runPublisher(["build", "--check"]);
    const reader = JSON.parse(
      await readFile(join(hostRoot, "publication-reader.json"), "utf8"),
    );
    assert.equal(reader.publicationId, "rain-gauge-journal");
    assert.ok(
      reader.routes.active.some(({ path }) => path === "/works/rain-gauge"),
    );
    const extensionData = JSON.parse(
      await readFile(join(hostRoot, "publication-extensions.json"), "utf8"),
    );
    assert.equal(extensionData.extensions[0].serverData.marker, extensionSentinel);

    const productionEnvironment = {
      ...installEnvironment,
      NODE_ENV: "production",
    };
    runNpm(["run", "build"], {
      cwd: hostRoot,
      env: productionEnvironment,
      label: "second-publication production build",
    });
    assert.equal(await hashTree(sourcePaths), sourceHashBefore);

    host = await startHost(hostRoot, productionEnvironment);
    const routes = ["/", "/works/rain-gauge", "/updates"];
    const responses = await Promise.all(
      routes.map((path) => fetch(`${host.origin}${path}`, { redirect: "manual" })),
    );
    assert.deepEqual(
      responses.map(({ status }) => status),
      [200, 200, 200],
      host.output(),
    );
    const html = (
      await Promise.all(responses.map((response) => response.text()))
    ).join("\n");
    for (const expected of [
      "Rain Gauge Journal",
      "The Seven O&#x27;Clock Reading",
      "Published with GENII Publisher",
      "Copyright 2026 GENII Foundation",
      portableAccent,
    ]) {
      assert.ok(html.includes(expected), `Rendered publication omitted ${expected}.`);
    }
    await stopHost(host.child);
    host = undefined;

    const finalArchives = await verifyPreparedPackageArchives({
      repositoryRoot,
      expectedPackageRoots: packageRoots,
      npmInvocation,
      prepared: archives,
    });
    assert.deepEqual(
      [...finalArchives.values()].map(({ name, sha256 }) => [name, sha256]),
      [...archives.values()].map(({ name, sha256 }) => [name, sha256]),
    );
  } finally {
    if (host !== undefined) await stopHost(host.child);
    preparation.dispose();
    await removeOwnedTemporaryRoot(temporaryRoot);
  }
});
