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

// Writing narration into a host, through the command an author actually runs.
//
// Two artifacts now come out of one build, and the case worth protecting is the
// one where they disagree: prose current, narration stale. A check that reported
// only the reader artifact would exit zero there, and the host would ship correct
// text beside narration of text that no longer exists. That is worse than a plain
// failure, because nothing looks wrong.
//
// The other property here is that a renderer with nowhere to put narration is
// refused before anything is written. Absent support and declared support are
// different claims, and only one of them is safe to act on.

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  authorHost,
  publicationFixture as publication,
  runPublisher as run,
} from "./author-host-fixture.mjs";

const rendererName = "@example/alpha";
const narrated = "canonical-narrated-tides";
const silent = "canonical-tide-tables";
const audioDataPath = "public/alpha-audio.json";

/** An initialized host whose renderer declares where narration belongs. */
function host(t, rendererOptions = {}) {
  return authorHost(t, {
    renderers: [rendererName],
    rendererOptions: {
      [rendererName]: { audioDataPath, ...rendererOptions },
    },
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

// ------------------------------------------------------------------- writing

test("a narrated publication writes both artifacts", (t) => {
  const hostRoot = host(t);
  const built = build(hostRoot, narrated);
  assert.equal(built.status, 0, built.stderr);

  assert.ok(existsSync(join(hostRoot, "alpha-reader.json")));
  const envelopePath = join(hostRoot, audioDataPath);
  assert.ok(
    existsSync(envelopePath),
    `narration was not written to ${audioDataPath}`,
  );

  assert.match(built.stdout, /Narration\s+public\/alpha-audio\.json/u);
  assert.match(built.stdout, /Voices\s+2/u);
  assert.match(built.stdout, /Clips\s+2/u);
});

test("the narration report states coverage per voice", (t) => {
  // Coverage is reported rather than enforced, so this line is the only place an
  // author learns how far through generating narration they are.
  const hostRoot = host(t);
  const built = build(hostRoot, narrated);
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /Coverage\s+low-water 1\/1, spring-tide 1\/1/u);
});

test("the written envelope carries the reader artifact's build identity", (t) => {
  const hostRoot = host(t);
  assert.equal(build(hostRoot, narrated).status, 0);
  const reader = JSON.parse(
    readFileSync(join(hostRoot, "alpha-reader.json"), "utf8"),
  );
  const envelope = JSON.parse(
    readFileSync(join(hostRoot, audioDataPath), "utf8"),
  );
  assert.equal(envelope.buildId, reader.buildId);
  assert.equal(envelope.publicationId, reader.publicationId);
});

test("a publication with no narration writes Reader and search but no audio", (t) => {
  const hostRoot = host(t);
  const built = build(hostRoot, silent);
  assert.equal(built.status, 0, built.stderr);
  assert.equal(existsSync(join(hostRoot, audioDataPath)), false);
  assert.equal(
    /Narration/u.test(built.stdout),
    false,
    "a publication with no narration must not report any",
  );
});

// -------------------------------------------------------------------- checking

test("check passes when both artifacts are current", (t) => {
  const hostRoot = host(t);
  assert.equal(build(hostRoot, narrated).status, 0);
  const checked = build(hostRoot, narrated, ["--check"]);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});

test("check fails when narration is stale even though prose is current", (t) => {
  // The case this file exists for. Reporting only the reader artifact would exit
  // zero here and let a host ship narration of text that no longer exists.
  const hostRoot = host(t);
  assert.equal(build(hostRoot, narrated).status, 0);
  const envelopePath = join(hostRoot, audioDataPath);
  const envelope = JSON.parse(readFileSync(envelopePath, "utf8"));
  envelope.statistics.clipCount = 99;
  writeFileSync(envelopePath, JSON.stringify(envelope), "utf8");

  const checked = build(hostRoot, narrated, ["--check"]);
  assert.equal(
    checked.status,
    1,
    "a stale narration artifact must fail the check",
  );
  // The reader artifact is untouched, so the report has to say so rather than
  // blaming the whole build.
  assert.match(checked.stdout, /matches this publication/u);
  assert.match(checked.stdout, /built from different sources/u);
});

test("check fails when narration is missing", (t) => {
  const hostRoot = host(t);
  const checked = build(hostRoot, narrated, ["--check"]);
  assert.equal(checked.status, 1);
  assert.match(checked.stdout, /No artifact on disk/u);
});

test("check reports both artifacts separately in JSON", (t) => {
  const hostRoot = host(t);
  assert.equal(build(hostRoot, narrated).status, 0);
  const checked = build(hostRoot, narrated, ["--check", "--json"]);
  assert.equal(checked.status, 0, checked.stderr);
  const parsed = JSON.parse(checked.stdout);
  // The reader artifact's fields stay at the top level and narration is additive,
  // so a consumer reading `outcome` works whether or not a publication narrates.
  assert.equal(parsed.outcome, "current");
  assert.equal(parsed.hostRelativePath, "alpha-reader.json");
  assert.equal(parsed.audio.outcome, "current");
  assert.equal(parsed.audio.hostRelativePath, audioDataPath);
});

test("a publication with no narration keeps audio absent from the additive JSON shape", (t) => {
  // Adding optional audio must not reshape the base output for publications
  // that omit it. A consumer reading `outcome` should keep working.
  const hostRoot = host(t);
  assert.equal(build(hostRoot, silent).status, 0);
  const checked = build(hostRoot, silent, ["--check", "--json"]);
  const parsed = JSON.parse(checked.stdout);
  assert.equal(parsed.outcome, "current");
  assert.equal(parsed.audio, undefined);
});

// ------------------------------------------------------------------- refusals

test("a renderer declaring search but no narration support is refused by name", (t) => {
  // Required search is supported so this isolates the optional narration claim.
  const hostRoot = authorHost(t, {
    renderers: [rendererName],
    rendererOptions: {
      [rendererName]: {
        capabilities: {
          routeKinds: ["collection", "home", "section", "updates", "work"],
          dataArtifacts: ["search"],
        },
      },
    },
  }).hostRoot;
  const built = build(hostRoot, narrated);
  assert.equal(built.status, 1);
  assert.match(built.stderr, /cannot carry this publication's narration/u);
  assert.match(built.stderr, /host\.data_artifact_unsupported/u);
  assert.match(built.stderr, /does not declare that it can carry the audio/u);
});

test("a renderer claiming support but naming no path is refused", (t) => {
  // The half-declared case. Claiming the capability without a destination is a
  // renderer defect, and guessing a path for it would be the engine inventing
  // part of a third-party contract.
  const hostRoot = authorHost(t, {
    renderers: [rendererName],
    rendererOptions: { [rendererName]: { omitAudioDataPath: true } },
  }).hostRoot;
  const built = build(hostRoot, narrated);
  assert.equal(built.status, 1);
  assert.match(built.stderr, /names no path for it/u);
});

test("nothing is written when narration is refused", (t) => {
  // The refusal has to come before the reader artifact is written, or a failed
  // build leaves a host half updated.
  const hostRoot = authorHost(t, {
    renderers: [rendererName],
    rendererOptions: { [rendererName]: { omitAudioDataPath: true } },
  }).hostRoot;
  assert.equal(build(hostRoot, narrated).status, 1);
  assert.equal(
    existsSync(join(hostRoot, "alpha-reader.json")),
    false,
    "the reader artifact was written despite the build being refused",
  );
});

test("a renderer aiming narration at its own contract file is refused", (t) => {
  // The same collision the reader artifact is protected from. A renderer whose
  // narration path is one of its own generated files would have every build
  // overwrite that file, and the allowlist cannot catch it because the path is in
  // the allowlist by construction.
  const hostRoot = host(t, { audioDataPath: "alpha-app.js" });
  const built = build(hostRoot, narrated);
  assert.equal(built.status, 1);
  assert.match(built.stderr, /alpha-app\.js/u);
});

test("a refused narration path is refused in check mode too", (t) => {
  // Resolution happens whether or not this run would write, because a check that
  // passed on a host a build would refuse tells an author the opposite of the
  // truth.
  const hostRoot = host(t, { audioDataPath: "alpha-app.js" });
  const checked = build(hostRoot, narrated, ["--check"]);
  assert.notEqual(checked.status, 0);
});
