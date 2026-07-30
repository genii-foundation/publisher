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

// The author guide against the real command surface.
//
// A guide is a promise about what the software does, and an unchecked promise
// rots. The specific rot that matters is a documented command or flag that no
// longer exists, because an author following it gets an error from the one
// document that was supposed to prevent errors.
//
// So the check runs both ways. Every command and flag the guide shows must be one
// the executable accepts, and every command and flag the executable offers must
// appear in the guide. The second direction is the one that catches a feature
// shipped without documentation, which is how a guide becomes a partial guide
// nobody trusts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";

import test from "node:test";
import { fileURLToPath } from "node:url";

const executable = fileURLToPath(
  new URL(
    "../packages/publisher/bin/genii-publisher.mjs",
    import.meta.url,
  ),
);
const guidePath = fileURLToPath(
  new URL(
    "../docs/guides/publishing-a-publication.md",
    import.meta.url,
  ),
);

const guide = readFileSync(guidePath, "utf8");

const usage = (() => {
  const result = spawnSync(process.execPath, [executable, "--help"], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
})();

/** Command names the executable lists, such as "init plan" or "build". */
function commandsFromUsage() {
  const section = usage.slice(
    usage.indexOf("Commands"),
    usage.indexOf("Options"),
  );
  const commands = new Set();
  for (const line of section.split("\n").slice(1)) {
    const match = /^ {2}([a-z]+(?: [a-z]+)?) {2,}\S/u.exec(line);
    if (match !== null) {
      commands.add(match[1]);
    }
  }
  return commands;
}

/** Long options the executable lists. */
function optionsFromUsage() {
  const options = new Set();
  for (const match of usage
    .slice(usage.indexOf("Options"))
    .matchAll(/^ {2}(--[a-z-]+)/gmu)) {
    options.add(match[1]);
  }
  return options;
}

/**
 * Every invocation the guide shows, from fenced bash blocks and inline code.
 *
 * Inline code counts. A guide that mentions a flag in prose is making the same
 * promise as one that shows it in a block.
 */
function invocationsFromGuide() {
  const invocations = [];
  for (const match of guide.matchAll(
    /genii-publisher ([^\n`|]*)/gu,
  )) {
    const text = match[1].trim();
    if (text.length > 0) {
      invocations.push(text);
    }
  }
  assert.ok(
    invocations.length > 10,
    `expected the guide to show commands, found ${invocations.length}`,
  );
  return invocations;
}

const usageCommands = commandsFromUsage();
const usageOptions = optionsFromUsage();
const invocations = invocationsFromGuide();

test("the executable's usage is parseable, or this whole file proves nothing", () => {
  // Guarding the guard. If the usage format changes and these parsers silently
  // return nothing, every assertion below passes vacuously.
  assert.ok(
    usageCommands.size >= 8,
    `expected to parse several commands out of usage, got ${[...usageCommands]}`,
  );
  assert.ok(
    usageOptions.size >= 6,
    `expected to parse several options out of usage, got ${[...usageOptions]}`,
  );
  for (const required of ["init plan", "build", "status", "recover"]) {
    assert.ok(
      usageCommands.has(required),
      `usage parsing missed ${required}`,
    );
  }
});

test("every command the guide shows is one the executable accepts", () => {
  for (const invocation of invocations) {
    const words = invocation
      .split(/\s+/u)
      .filter((word) => !word.startsWith("-") && word !== "\\");
    if (words.length === 0) {
      continue;
    }
    const two = words.slice(0, 2).join(" ");
    const one = words[0];
    assert.ok(
      usageCommands.has(two) || usageCommands.has(one),
      `the guide shows "genii-publisher ${invocation}" but the executable lists no such command`,
    );
  }
});

test("every flag the guide shows is one the executable accepts", () => {
  for (const invocation of invocations) {
    for (const word of invocation.split(/\s+/u)) {
      if (!word.startsWith("--")) {
        continue;
      }
      const flag = word.split("=")[0];
      assert.ok(
        usageOptions.has(flag),
        `the guide shows ${flag} but the executable lists no such option`,
      );
    }
  }
});

test("every command the executable offers appears in the guide", () => {
  for (const command of usageCommands) {
    assert.ok(
      guide.includes(`genii-publisher ${command}`) ||
        guide.includes(`\`${command}\``),
      `the executable offers "${command}" and the guide never mentions it`,
    );
  }
});

test("every flag the executable offers appears in the guide", () => {
  // --help and --version are conventional enough to omit from a guide about
  // publishing. Everything that changes what a command does is not.
  const conventional = new Set(["--help", "--version"]);
  for (const option of usageOptions) {
    if (conventional.has(option)) {
      continue;
    }
    assert.ok(
      guide.includes(option),
      `the executable offers ${option} and the guide never mentions it`,
    );
  }
});

test("the guide's command table covers every command", () => {
  const table = guide.slice(guide.indexOf("| Command |"));
  assert.ok(table.length > 0, "expected a command summary table");
  for (const command of usageCommands) {
    assert.ok(
      table.includes(`\`${command}\``) ||
        table.includes(`\`${command} --check\``),
      `the command summary table omits ${command}`,
    );
  }
});

test("the guide does not use dashes that read as machine written", () => {
  // A house rule, and cheap to enforce where prose is checked in.
  for (const forbidden of ["—", "–"]) {
    assert.equal(
      guide.includes(forbidden),
      false,
      `the guide contains ${JSON.stringify(forbidden)}`,
    );
  }
});

test("every digest the guide prints is one the engine produces", async () => {
  // The guide opens by promising every value in it came from running the commands.
  // While regenerating its transcripts I wrote a digest whose first thirty two
  // characters matched a pinned value and invented the rest, in exactly the document
  // that makes that promise. Nothing would have caught it.
  //
  // So every sha256 the guide prints in full is checked against what the engine
  // actually produces for the publication the guide tells authors to copy.
  const { buildPublicationReader } = await import(
    "../packages/publisher/dist/node.js"
  );
  const built = await buildPublicationReader({
    publicationRoot: realpathSync(
      fileURLToPath(
        new URL("../fixtures/canonical-tide-tables", import.meta.url),
      ),
    ),
    audience: "public",
  });
  assert.ok(built.valid, JSON.stringify(built.diagnostics, null, 2));
  const real = `sha256:${createHash("sha256")
    .update(built.value.text, "utf8")
    .digest("hex")}`;
  const realBytes = Buffer.byteLength(built.value.text, "utf8").toLocaleString(
    "en-US",
  );

  // Full length digests only. Truncated ones ending in an ellipsis are deliberate
  // abbreviations of a plan hash, which varies with the renderer version.
  const full = [...guide.matchAll(/sha256:[0-9a-f]{64}/gu)].map(
    ([value]) => value,
  );
  assert.ok(full.length > 0, "expected the guide to print at least one digest");

  // Only the lines showing the artifact as built from the committed fixture. The
  // Expected line in the check example is deliberately the digest after an edit the
  // guide describes making, so it must differ from this one.
  const artifactDigests = full.filter((value) => guideMentionsAsArtifact(value));
  assert.ok(
    artifactDigests.length > 0,
    "expected the guide to print the artifact digest somewhere",
  );
  for (const value of artifactDigests) {
    assert.equal(
      value,
      real,
      `the guide prints an artifact digest the engine does not produce`,
    );
  }

  // And the size beside it.
  const sizes = [...guide.matchAll(/^Size\s+([\d,]+) bytes$/gmu)].map(
    ([, value]) => value,
  );
  for (const size of sizes) {
    assert.equal(
      size,
      realBytes,
      "the guide prints an artifact size the engine does not produce",
    );
  }
});

/** Whether a digest appears where the guide is showing the artifact's own hash. */
function guideMentionsAsArtifact(digest) {
  const index = guide.indexOf(digest);
  const line = guide.slice(guide.lastIndexOf("\n", index) + 1, index);
  return /^(Digest|On disk)\s+$/u.test(line);
}
