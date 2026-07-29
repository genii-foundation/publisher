#!/usr/bin/env node
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

// The author lifecycle command.
//
// Every decision this file makes is about presentation and argument handling.
// Authority lives in the mutation policy, safety in the transaction, and the
// baseline requirement in the Git gate, so a mistake here cannot widen what the
// engine is permitted to do.
//
// The renderer's host contract is resolved from the author's own installation
// rather than imported statically, because the application package must not
// depend on a renderer. That also means a third-party renderer shipping the same
// export works with no change here.

import { createRequire } from "node:module";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  PUBLISHER_HOST_STATE_PATH,
} from "../dist/node/lifecycle/host-state.js";
import {
  applyHostInitialization,
  planHostInitialization,
} from "../dist/node/lifecycle/init.js";
import {
  recoverHostTransaction,
} from "../dist/node/lifecycle/transaction.js";

const defaultRenderer = "@genii-foundation/publisher-next";
const journalDirectoryName = join(".publisher", "transaction");

const usage = `genii-publisher <command>

Commands
  init plan     Report what initializing this host would change. Writes nothing.
  init apply    Apply a reviewed plan. Requires a clean Git tree.
  recover       Restore the baseline left by an interrupted apply.

Options
  --host <dir>            Host root. Defaults to the working directory.
  --layout <mode>         canonical or declared. Defaults to canonical.
  --renderer <package>    Renderer owning the host contract.
                          Defaults to ${defaultRenderer}.
  --protected-root <dir>  A root holding publication sources or durable state.
                          Repeatable. Nothing inside one is ever written.
  --plan <hash>           Required by init apply. The plan hash you reviewed.
  --json                  Emit machine readable output.
  --help                  Show this text.
  --version               Show the application package version.
`;

class CommandError extends Error {
  constructor(message) {
    super(message);
    this.name = "CommandError";
  }
}

function parseArguments(argv) {
  const options = {
    command: [],
    host: process.cwd(),
    layout: "canonical",
    renderer: defaultRenderer,
    protectedRoots: [],
    plan: null,
    json: false,
    help: false,
    version: false,
  };
  const valued = new Map([
    ["--host", "host"],
    ["--layout", "layout"],
    ["--renderer", "renderer"],
    ["--plan", "plan"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--version") {
      options.version = true;
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--protected-root") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CommandError("--protected-root requires a value.");
      }
      options.protectedRoots.push(value);
      index += 1;
      continue;
    }
    const field = valued.get(argument);
    if (field !== undefined) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CommandError(`${argument} requires a value.`);
      }
      options[field] = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new CommandError(
        `Unknown option ${JSON.stringify(argument)}.`,
      );
    }
    options.command.push(argument);
  }
  // Argument shape is checked here, before any filesystem access or module
  // resolution. Reporting a bad option only after failing to resolve a renderer
  // tells the author about the wrong problem.
  assertLayout(options.layout);
  return options;
}

function applicationVersion() {
  return JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).version;
}

function resolveHostRoot(value) {
  const requested = resolve(value);
  if (!isAbsolute(requested)) {
    throw new CommandError("The host root must resolve to an absolute path.");
  }
  if (!existsSync(requested)) {
    throw new CommandError(`The host root does not exist: ${requested}`);
  }
  const canonical = realpathSync(requested);
  if (canonical !== requested) {
    // Everything downstream requires a canonical root, so resolve it here and
    // say so, rather than letting a lower layer report a path the author did not
    // type.
    return canonical;
  }
  return requested;
}

/**
 * Loads the renderer's host contract from the author's installation.
 *
 * A genuinely empty directory has no renderer installed, which is the common
 * first-run mistake, so it gets an instruction rather than a resolution failure.
 */
async function loadHostTemplate(hostRoot, renderer) {
  const require = createRequire(
    pathToFileURL(join(hostRoot, "package.json")),
  );
  let resolved;
  try {
    resolved = require.resolve(`${renderer}/host`);
  } catch {
    throw new CommandError(
      `Could not resolve ${renderer}/host from ${hostRoot}.\n` +
        `Install the renderer into this host first, for example:\n` +
        `  npm install --save-dev ${renderer}`,
    );
  }
  const module = await import(pathToFileURL(resolved).href);
  const create = module.createPublisherNextHostTemplate;
  if (typeof create !== "function") {
    throw new CommandError(
      `${renderer}/host does not export a host contract factory.`,
    );
  }
  return { create, module };
}

function describePlan(plan, hostRoot) {
  const lines = [];
  lines.push(`Host        ${hostRoot}`);
  lines.push(`Renderer    ${plan.renderer} ${plan.rendererVersion}`);
  lines.push(`Contract    ${plan.hostContractVersion}`);
  lines.push(`Layout      ${plan.layout}`);
  lines.push(`Plan        ${plan.planHash}`);
  lines.push("");
  const symbol = {
    pending: "write  ",
    applied: "current",
    conflicted: "CONFLICT",
  };
  for (const entry of plan.classifications) {
    lines.push(`  ${symbol[entry.state]}  ${entry.path}`);
  }
  lines.push("");
  if (plan.outcome === "alreadyInitialized") {
    lines.push("Already initialized. Nothing to apply.");
  } else if (plan.outcome === "conflicted") {
    lines.push(
      `${plan.conflicts.length} file(s) differ from what the engine last wrote.`,
    );
    lines.push(
      "Review them and either restore them or record the change deliberately.",
    );
    lines.push("Nothing has been written.");
  } else {
    const pending = plan.classifications.filter(
      (entry) => entry.state === "pending",
    ).length;
    lines.push(`${pending} file(s) would be written. Nothing has been yet.`);
    lines.push("Apply with:");
    lines.push(
      `  genii-publisher init apply --host ${hostRoot} --plan ${plan.planHash}`,
    );
  }
  return lines.join("\n");
}

async function runInitPlan(options) {
  const hostRoot = resolveHostRoot(options.host);
  const { create } = await loadHostTemplate(hostRoot, options.renderer);
  const template = create(hostTemplateInput(hostRoot));
  const plan = planHostInitialization({
    hostRoot,
    template,
    layout: assertLayout(options.layout),
    enginePackages: enginePackagesFor(template),
    ...(options.protectedRoots.length === 0
      ? {}
      : { protectedRoots: options.protectedRoots }),
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    process.stdout.write(`${describePlan(plan, hostRoot)}\n`);
  }
  // A conflicted plan is a refusal, so it must not look like success to a script.
  return plan.outcome === "conflicted" ? 1 : 0;
}

async function runInitApply(options) {
  if (options.plan === null) {
    throw new CommandError(
      "init apply requires --plan <hash>, the plan hash reported by init plan.\n" +
        "Passing it is what proves you are applying the plan you reviewed.",
    );
  }
  const hostRoot = resolveHostRoot(options.host);
  const { create } = await loadHostTemplate(hostRoot, options.renderer);
  const template = create(hostTemplateInput(hostRoot));
  const plan = planHostInitialization({
    hostRoot,
    template,
    layout: assertLayout(options.layout),
    enginePackages: enginePackagesFor(template),
    ...(options.protectedRoots.length === 0
      ? {}
      : { protectedRoots: options.protectedRoots }),
  });
  const result = applyHostInitialization({
    hostRoot,
    plan,
    journalDirectory: join(hostRoot, journalDirectoryName),
    expectedPlanHash: options.plan,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (result.outcome === "alreadyApplied") {
    process.stdout.write("Already initialized. Nothing changed.\n");
    return 0;
  }
  process.stdout.write(
    `Initialized ${hostRoot}\n` +
      `${result.changed.length} file(s) written.\n` +
      `Baseline commit ${result.baselineCommit}\n` +
      `Review the change and commit it, including ${PUBLISHER_HOST_STATE_PATH}.\n`,
  );
  return 0;
}

function runRecover(options) {
  const hostRoot = resolveHostRoot(options.host);
  const result = recoverHostTransaction({
    journalDirectory: join(hostRoot, journalDirectoryName),
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (!result.recovered) {
    process.stdout.write("No interrupted apply to recover.\n");
    return 0;
  }
  process.stdout.write(
    `Restored the baseline for ${result.restored.length} file(s).\n` +
      "Rerun init apply when ready.\n",
  );
  return 0;
}

function assertLayout(value) {
  if (value !== "canonical" && value !== "declared") {
    throw new CommandError(
      `--layout must be canonical or declared, not ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function hostTemplateInput(hostRoot) {
  // Enough for the contract to produce a host. An existing host keeps its own
  // package name so initializing twice does not rename it.
  let hostPackageName = "publication-host";
  const manifestPath = join(hostRoot, "package.json");
  if (existsSync(manifestPath)) {
    try {
      const name = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ).name;
      if (typeof name === "string" && name.length > 0) {
        hostPackageName = name;
      }
    } catch {
      // A manifest that cannot be read is left to the renderer contract's own
      // defaults rather than guessed at.
    }
  }
  return {
    hostPackageName,
    dependencies: {},
    devDependencies: {},
    overrides: {},
    errorIdentity: {},
  };
}

function enginePackagesFor(template) {
  return { [template.renderer]: template.rendererVersion };
}

async function main(argv) {
  const options = parseArguments(argv);
  if (options.help || options.command.length === 0) {
    process.stdout.write(usage);
    return options.command.length === 0 && !options.help ? 1 : 0;
  }
  if (options.version) {
    process.stdout.write(`${applicationVersion()}\n`);
    return 0;
  }

  const command = options.command.join(" ");
  switch (command) {
    case "init plan":
      return await runInitPlan(options);
    case "init apply":
      return await runInitApply(options);
    case "recover":
      return runRecover(options);
    default:
      throw new CommandError(
        `Unknown command ${JSON.stringify(command)}.\n\n${usage}`,
      );
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const named =
    error instanceof Error && typeof error.name === "string"
      ? error.name
      : "Error";
  process.stderr.write(
    `${named === "CommandError" ? "" : `${named}: `}${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
}
