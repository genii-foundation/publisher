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

// Build order against the real dependency graph.
//
// Each package compiles against its dependencies' emitted declarations, so a
// package listed before something it depends on fails with "cannot find module",
// which reads like a missing install rather than a wrong order.
//
// The order is written down in two places, and the first version of this test
// only checked one. The package scripts were fixed, this test passed, and the
// identical failure then landed in the workflow, which builds packages with its
// own sequence of steps. So both are checked here. A guard that covers one of two
// places is worse than no guard, because it is believed.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function manifestAt(path) {
  return JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
}

/** Every workspace package, by package name, with its build script location. */
function workspacePackages() {
  const packages = new Map();
  const roots = ["schemas", ...readdirSync(join(repositoryRoot, "packages"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`)];

  for (const root of roots) {
    let manifest;
    try {
      manifest = manifestAt(join(root, "package.json"));
    } catch {
      continue;
    }
    packages.set(manifest.name, {
      root,
      dependencies: Object.keys({
        ...manifest.dependencies,
        ...manifest.peerDependencies,
      }),
    });
  }
  return packages;
}

/** The order the build script actually runs, as package roots. */
function scriptedOrder(script) {
  const order = [];
  for (const match of script.matchAll(
    /node ((?:packages\/[a-z0-9-]+|schemas)\/scripts\/build\.mjs)/gu,
  )) {
    order.push(match[1].replace("/scripts/build.mjs", ""));
  }
  return order;
}

/**
 * Every place a package build order is written down.
 *
 * Package scripts chain build.mjs invocations. Workflows run per-package build
 * steps. Both are an order, and both break the same way.
 */
function orderedSources() {
  const sources = [];

  const manifest = manifestAt("package.json");
  for (const [name, value] of Object.entries(manifest.scripts)) {
    if (value.includes("/scripts/build.mjs")) {
      sources.push({
        name: `package.json script "${name}"`,
        order: scriptedOrder(value),
      });
    }
  }

  const workflowDirectory = join(repositoryRoot, ".github", "workflows");
  if (existsSync(workflowDirectory)) {
    for (const entry of readdirSync(workflowDirectory)) {
      if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) {
        continue;
      }
      const text = readFileSync(join(workflowDirectory, entry), "utf8");
      // Jobs run independently, so an order only means something within one job.
      // Splitting on the job key keeps a later job's steps from appearing to
      // satisfy an earlier job's dependency.
      for (const [index, job] of text.split(/^  [a-z0-9-]+:$/mu).entries()) {
        const order = workflowOrder(job);
        if (order.length > 0) {
          sources.push({
            name: `.github/workflows/${entry} job ${index}`,
            order,
          });
        }
      }
    }
  }

  return sources;
}

/** Package roots built by per-package steps, in the order they appear. */
function workflowOrder(text) {
  const order = [];
  for (const match of text.matchAll(
    /npm --prefix ((?:packages\/[a-z0-9-]+|schemas)) run build/gu,
  )) {
    order.push(match[1]);
  }
  return order;
}

const buildSources = orderedSources();

test("every place that compiles packages compiles them in dependency order", () => {
  const packages = workspacePackages();
  const rootOf = new Map(
    [...packages].map(([name, entry]) => [name, entry.root]),
  );

  assert.ok(
    buildSources.length > 1,
    "expected both package scripts and workflow steps to be inspected",
  );
  assert.ok(
    buildSources.some((source) => source.name.startsWith(".github/")),
    "expected at least one workflow to be inspected, or this guard has the same blind spot it was written to close",
  );

  for (const { name: scriptName, order } of buildSources) {
    const position = new Map(
      order.map((root, index) => [root, index]),
    );

    for (const [name, entry] of packages) {
      const at = position.get(entry.root);
      if (at === undefined) {
        // Not every workspace package needs compiling in every script.
        continue;
      }
      for (const dependency of entry.dependencies) {
        const dependencyRoot = rootOf.get(dependency);
        if (dependencyRoot === undefined) {
          // An external dependency, which npm resolves rather than this order.
          continue;
        }
        const dependencyAt = position.get(dependencyRoot);
        assert.notEqual(
          dependencyAt,
          undefined,
          `${scriptName} compiles ${name} but never compiles its workspace dependency ${dependency}`,
        );
        assert.ok(
          dependencyAt < at,
          `${scriptName} compiles ${name} at position ${at} before its dependency ${dependency} at position ${dependencyAt}. ` +
            `${name} reads ${dependency}'s emitted declarations, so the dependency must come first.`,
        );
      }
    }
  }
});

test("the dependency graph has no cycle, so an order exists at all", () => {
  const packages = workspacePackages();
  const visiting = new Set();
  const done = new Set();

  const walk = (name, trail) => {
    if (done.has(name)) {
      return;
    }
    assert.ok(
      !visiting.has(name),
      `workspace dependency cycle: ${[...trail, name].join(" -> ")}`,
    );
    visiting.add(name);
    for (const dependency of packages.get(name)?.dependencies ?? []) {
      if (packages.has(dependency)) {
        walk(dependency, [...trail, name]);
      }
    }
    visiting.delete(name);
    done.add(name);
  };

  for (const name of packages.keys()) {
    walk(name, []);
  }
});
