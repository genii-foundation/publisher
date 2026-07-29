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
import {
  applyHostUpgrade,
  planHostUpgrade,
} from "../dist/node/lifecycle/upgrade.js";
import {
  applyHostRollback,
  planHostRollback,
} from "../dist/node/lifecycle/rollback.js";
import {
  buildPublicationReader,
} from "../dist/node/build.js";
import {
  resolvePublicationProtectedRoots,
} from "../dist/node/protected-roots.js";
import {
  checkReaderArtifact,
  resolveArtifactDestination,
  writeReaderArtifact,
} from "../dist/node/materialize.js";

const defaultRenderer = "@genii-foundation/publisher-next";
const journalDirectoryName = join(".publisher", "transaction");

const usage = `genii-publisher <command>

Commands
  init plan       Report what initializing this host would change. Writes nothing.
  init apply      Apply a reviewed plan. Requires a clean Git tree.
  upgrade plan    Report what moving to the installed contract would change.
  upgrade apply   Apply a reviewed upgrade. Requires a clean Git tree.
  rollback plan   Report what undoing the last apply would restore.
  rollback apply  Undo the last apply, restoring its recorded baseline.
  build           Compile the publication and write the reader artifact.
  recover         Restore the baseline left by an interrupted apply.

Options
  --host <dir>            Host root. Defaults to the working directory.
  --layout <mode>         canonical or declared. Defaults to canonical.
  --renderer <package>    Renderer owning the host contract.
                          Defaults to ${defaultRenderer}.
  --protected-root <dir>  An extra root nothing may be written into. Repeatable.
                          The publication manifest's declared source roots are
                          always protected without being named here.
  --plan <hash>           Required by every apply. The plan hash you reviewed.
  --acknowledge-manual-steps
                          Confirms you have read the manual steps an upgrade
                          reports. Required when it reports any.
  --publication <dir>     Publication root holding publication.json.
                          Defaults to the host root.
  --audience <mode>       public or preview. Defaults to public.
  --check                 Report whether the artifact on disk is current and
                          exit nonzero if it is not. Writes nothing.
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
    publication: null,
    audience: "public",
    check: false,
    acknowledgeManualSteps: false,
    json: false,
    help: false,
    version: false,
  };
  const valued = new Map([
    ["--host", "host"],
    ["--layout", "layout"],
    ["--renderer", "renderer"],
    ["--plan", "plan"],
    ["--publication", "publication"],
    ["--audience", "audience"],
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
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--acknowledge-manual-steps") {
      options.acknowledgeManualSteps = true;
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
  assertAudience(options.audience);
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

/**
 * Reads the renderer's host contract migration registry.
 *
 * Required rather than defaulted to empty. Absent and empty would otherwise be
 * indistinguishable, so a renderer that misnamed the export would upgrade with
 * no route and skip the manual steps an edge exists to announce. A renderer with
 * nothing to migrate exports an empty array.
 */
function migrationEdgesFrom(module, renderer) {
  const edges = module.PUBLISHER_NEXT_HOST_MIGRATIONS;
  if (!Array.isArray(edges)) {
    throw new CommandError(
      `${renderer}/host does not export a host contract migration registry.\n` +
        "A renderer with nothing to migrate exports an empty array, so that a\n" +
        "missing registry is never mistaken for having no migrations.",
    );
  }
  return edges;
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
    protectedRoots: protectedRootsFor(hostRoot, options),
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
    protectedRoots: protectedRootsFor(hostRoot, options),
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

function upgradePlanFor(hostRoot, options, template, module) {
  return planHostUpgrade({
    hostRoot,
    template,
    migrationEdges: migrationEdgesFrom(module, options.renderer),
    enginePackages: enginePackagesFor(template),
    protectedRoots: protectedRootsFor(hostRoot, options),
  });
}

/**
 * Labels one path in a plan listing.
 *
 * A conflict outranks a removal. A file can be both, and reporting the removal
 * would hide the only line telling an author which file blocked the plan, while
 * the summary counted it. That is worse than saying nothing.
 */
function labelFor(entry, removing, symbol) {
  if (entry.state === "conflicted") {
    return symbol.conflicted;
  }
  return removing.includes(entry.path) ? "remove " : symbol[entry.state];
}

function describeUpgradePlan(plan, hostRoot) {
  const lines = [];
  lines.push(`Host        ${hostRoot}`);
  lines.push(`Renderer    ${plan.renderer} ${plan.rendererVersion}`);
  lines.push(
    `Contract    ${plan.fromContractVersion} to ${plan.toContractVersion}`,
  );
  lines.push(`Plan        ${plan.planHash}`);
  lines.push("");
  const symbol = {
    pending: "write  ",
    applied: "current",
    conflicted: "CONFLICT",
  };
  for (const entry of plan.classifications) {
    lines.push(`  ${labelFor(entry, plan.removed, symbol)}  ${entry.path}`);
  }
  if (plan.migrationPath.edges.length > 0) {
    lines.push("");
    lines.push("Route");
    for (const edge of plan.migrationPath.edges) {
      lines.push(`  ${edge.from} to ${edge.to}  ${edge.summary}`);
    }
  }
  if (plan.manualSteps.length > 0) {
    lines.push("");
    lines.push("Manual steps this tooling will not perform:");
    for (const step of plan.manualSteps) {
      lines.push(`  ${step}`);
    }
  }
  lines.push("");
  if (plan.outcome === "alreadyCurrent") {
    lines.push("Already on the installed contract. Nothing to apply.");
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
      `  genii-publisher upgrade apply --host ${hostRoot} --plan ${plan.planHash}` +
        (plan.manualSteps.length > 0
          ? " \\\n    --acknowledge-manual-steps"
          : ""),
    );
  }
  return lines.join("\n");
}

async function runUpgradePlan(options) {
  const hostRoot = resolveHostRoot(options.host);
  const { create, module } = await loadHostTemplate(
    hostRoot,
    options.renderer,
  );
  const plan = upgradePlanFor(
    hostRoot,
    options,
    create(hostTemplateInput(hostRoot)),
    module,
  );
  if (options.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    process.stdout.write(`${describeUpgradePlan(plan, hostRoot)}\n`);
  }
  return plan.outcome === "conflicted" ? 1 : 0;
}

async function runUpgradeApply(options) {
  if (options.plan === null) {
    throw new CommandError(
      "upgrade apply requires --plan <hash>, the plan hash reported by upgrade plan.\n" +
        "Passing it is what proves you are applying the plan you reviewed.",
    );
  }
  const hostRoot = resolveHostRoot(options.host);
  const { create, module } = await loadHostTemplate(
    hostRoot,
    options.renderer,
  );
  const plan = upgradePlanFor(
    hostRoot,
    options,
    create(hostTemplateInput(hostRoot)),
    module,
  );
  const result = applyHostUpgrade({
    hostRoot,
    plan,
    journalDirectory: join(hostRoot, journalDirectoryName),
    expectedPlanHash: options.plan,
    ...(options.acknowledgeManualSteps
      ? { acknowledgedManualSteps: true }
      : {}),
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (result.outcome === "alreadyApplied") {
    process.stdout.write("Already on the installed contract. Nothing changed.\n");
    return 0;
  }
  process.stdout.write(
    `Upgraded ${hostRoot}\n` +
      `Contract ${result.fromContractVersion} to ${result.toContractVersion}\n` +
      `${result.changed.length} file(s) written.\n` +
      `Baseline commit ${result.baselineCommit}\n` +
      `Review the change and commit it, including ${PUBLISHER_HOST_STATE_PATH}.\n` +
      "Undo it with:\n" +
      `  genii-publisher rollback plan --host ${hostRoot}\n`,
  );
  return 0;
}

function describeRollbackPlan(plan, hostRoot) {
  const lines = [];
  lines.push(`Host        ${hostRoot}`);
  if (plan.receipt === null) {
    lines.push("");
    lines.push("No recorded apply to roll back.");
    return lines.join("\n");
  }
  lines.push(`Undoing     ${plan.receipt.operation} ${plan.receipt.planHash}`);
  lines.push(`Baseline    ${plan.receipt.baselineCommit}`);
  lines.push(`Plan        ${plan.planHash}`);
  lines.push("");
  const symbol = {
    pending: "restore",
    applied: "current",
    conflicted: "CONFLICT",
  };
  for (const entry of plan.classifications) {
    lines.push(`  ${labelFor(entry, plan.removing, symbol)}  ${entry.path}`);
  }
  lines.push("");
  if (plan.outcome === "nothingToRollBack") {
    lines.push("Every recorded file already matches the baseline.");
  } else if (plan.outcome === "conflicted") {
    lines.push(
      `${plan.conflicts.length} file(s) have changed since the apply, so rolling`,
    );
    lines.push("back would discard that work. Nothing has been written.");
  } else {
    lines.push("Apply with:");
    lines.push(
      `  genii-publisher rollback apply --host ${hostRoot} --plan ${plan.planHash}`,
    );
  }
  return lines.join("\n");
}

function runRollbackPlan(options) {
  const hostRoot = resolveHostRoot(options.host);
  const plan = planHostRollback({ hostRoot });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    process.stdout.write(`${describeRollbackPlan(plan, hostRoot)}\n`);
  }
  return plan.outcome === "conflicted" ? 1 : 0;
}

function runRollbackApply(options) {
  if (options.plan === null) {
    throw new CommandError(
      "rollback apply requires --plan <hash>, the plan hash reported by rollback plan.\n" +
        "Passing it is what proves you are applying the plan you reviewed.",
    );
  }
  const hostRoot = resolveHostRoot(options.host);
  const plan = planHostRollback({ hostRoot });
  const result = applyHostRollback({
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
    process.stdout.write("Nothing to roll back.\n");
    return 0;
  }
  process.stdout.write(
    `Rolled ${hostRoot} back to ${result.baselineCommit}\n` +
      `${result.restored.length} file(s) restored.\n` +
      "The recorded apply is no longer in the tree, so review and commit this too.\n",
  );
  return 0;
}

async function runBuild(options) {
  const hostRoot = resolveHostRoot(options.host);
  const publicationRoot = resolveHostRoot(
    options.publication ?? hostRoot,
  );
  const { create } = await loadHostTemplate(hostRoot, options.renderer);
  const template = create(hostTemplateInput(hostRoot));

  const built = await buildPublicationReader({
    publicationRoot,
    audience: assertAudience(options.audience),
  });
  if (!built.valid) {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ valid: false, diagnostics: built.diagnostics }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(
        `${publicationRoot} did not compile.\n${describeDiagnostics(built.diagnostics)}\n`,
      );
    }
    return 1;
  }

  const destination = resolveArtifactDestination({
    hostRoot,
    readerDataPath: template.readerDataPath,
    rendererManagedPaths: template.files.map((file) => file.path),
    protectedRoots: protectedRootsFor(hostRoot, options),
  });

  if (options.check) {
    const checked = checkReaderArtifact({
      destination,
      text: built.value.text,
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(checked, null, 2)}\n`);
    } else {
      process.stdout.write(
        `${describeCheck(checked, hostRoot, publicationRoot)}\n`,
      );
    }
    return checked.outcome === "current" ? 0 : 1;
  }

  const written = writeReaderArtifact({
    destination,
    text: built.value.text,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(written, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(
    `Publication  ${publicationRoot}\n` +
      `Artifact     ${written.hostRelativePath}\n` +
      `Digest       ${written.sha256}\n` +
      `Size         ${written.bytes.toLocaleString("en-US")} bytes\n` +
      (written.outcome === "current"
        ? "Already current. Nothing written.\n"
        : "Written.\n"),
  );
  return 0;
}

function describeDiagnostics(diagnostics) {
  const shown = diagnostics.slice(0, 20);
  const lines = shown.map((item) => {
    const where = item.documentPath ?? "";
    const at = item.path === "" ? "" : ` ${item.path}`;
    return `  ${item.code}  ${where}${at}\n    ${item.message}`;
  });
  if (diagnostics.length > shown.length) {
    lines.push(`  and ${diagnostics.length - shown.length} more`);
  }
  return lines.join("\n");
}

function describeCheck(checked, hostRoot, publicationRoot) {
  const lines = [];
  lines.push(`Host         ${hostRoot}`);
  lines.push(`Publication  ${publicationRoot}`);
  lines.push(`Artifact     ${checked.hostRelativePath}`);
  lines.push(`Expected     ${checked.expected}`);
  lines.push(`On disk      ${checked.actual ?? "absent"}`);
  lines.push("");
  if (checked.outcome === "current") {
    lines.push("The artifact on disk matches this publication.");
  } else if (checked.outcome === "missing") {
    lines.push("No artifact on disk. Run build to produce it.");
  } else {
    lines.push(
      "The artifact on disk was built from different sources. Run build.",
    );
  }
  return lines.join("\n");
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

/**
 * The roots nothing may be written into, for one command invocation.
 *
 * The manifest is the authority. The flag adds to what it declares rather than
 * replacing it, so forgetting the flag cannot leave a publication unprotected.
 */
function protectedRootsFor(hostRoot, options) {
  const publicationRoot = resolveHostRoot(
    options.publication ?? hostRoot,
  );
  return resolvePublicationProtectedRoots({
    hostRoot,
    publicationRoot,
    additional: options.protectedRoots,
  });
}

function assertAudience(value) {
  if (value !== "public" && value !== "preview") {
    throw new CommandError(
      `--audience must be public or preview, not ${JSON.stringify(value)}.`,
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
    case "upgrade plan":
      return await runUpgradePlan(options);
    case "upgrade apply":
      return await runUpgradeApply(options);
    case "rollback plan":
      return runRollbackPlan(options);
    case "rollback apply":
      return runRollbackApply(options);
    case "build":
      return await runBuild(options);
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
