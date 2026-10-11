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
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PREVIEW_CANDIDATE_IDENTITY_VERSION,
  capturePreviewCandidateIdentity,
  parsePreviewCandidateIdentity,
  verifyPreviewCandidateIdentity,
} from "../packages/publisher/dist/node.js";

const executable = fileURLToPath(
  new URL("../packages/publisher/bin/genii-publisher.mjs", import.meta.url),
);

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "preview@example.test",
      GIT_AUTHOR_NAME: "Preview",
      GIT_COMMITTER_EMAIL: "preview@example.test",
      GIT_COMMITTER_NAME: "Preview",
    },
  }).trim();
}

function repository(t, { commit = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "publisher-preview-")));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  writeFileSync(join(root, ".gitignore"), "ignored/\n", "utf8");
  writeFileSync(join(root, "manuscript.md"), "One exact tide.\n", "utf8");
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "notes.txt"), "Measured twice.\n", "utf8");
  if (commit) {
    git(root, ["add", "-A"]);
    git(root, ["commit", "--quiet", "-m", "initial"]);
  }
  return root;
}

function run(root, args) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

test("preview identity binds a clean worktree, branch, commit, and exact bytes", async (t) => {
  const root = repository(t);
  const first = await capturePreviewCandidateIdentity({ hostRoot: root });
  const second = await capturePreviewCandidateIdentity({ hostRoot: root });

  assert.equal(first.schemaVersion, PREVIEW_CANDIDATE_IDENTITY_VERSION);
  assert.equal(first.worktreeRoot, root);
  assert.equal(first.branch, "main");
  assert.equal(first.commit, git(root, ["rev-parse", "HEAD"]));
  assert.equal(first.dirty, false);
  assert.match(first.candidate.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(first.identityDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(first, second);
  assert.deepEqual(
    await capturePreviewCandidateIdentity({ hostRoot: join(root, "nested") }),
    first,
  );
  assert.deepEqual(
    first.candidate.entries.map(({ path }) => path),
    [".gitignore", "manuscript.md", "nested/notes.txt"],
  );
  assert.equal(
    first.candidate.byteCount,
    first.candidate.entries.reduce((sum, entry) => sum + entry.bytes, 0),
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.candidate), true);
  assert.equal(Object.isFrozen(first.candidate.entries), true);
  assert.deepEqual(parsePreviewCandidateIdentity(JSON.parse(JSON.stringify(first))), first);

  const verified = await verifyPreviewCandidateIdentity({
    hostRoot: root,
    expected: first,
  });
  assert.equal(verified.matches, true);
  assert.deepEqual(verified.mismatches, []);
});

test("tracked edits, untracked files, and deletions make saved evidence stale", async (t) => {
  const root = repository(t);
  const clean = await capturePreviewCandidateIdentity({ hostRoot: root });

  writeFileSync(join(root, "manuscript.md"), "A different tide.\n", "utf8");
  const edited = await capturePreviewCandidateIdentity({ hostRoot: root });
  assert.equal(edited.dirty, true);
  assert.notEqual(edited.candidate.digest, clean.candidate.digest);
  let verification = await verifyPreviewCandidateIdentity({
    hostRoot: root,
    expected: clean,
  });
  assert.equal(verification.matches, false);
  assert.deepEqual(verification.mismatches, ["dirty", "candidate", "identity"]);

  writeFileSync(join(root, "scratch.txt"), "untracked but previewable\n", "utf8");
  const untracked = await capturePreviewCandidateIdentity({ hostRoot: root });
  assert.notEqual(untracked.candidate.digest, edited.candidate.digest);
  assert.ok(untracked.candidate.entries.some(({ path }) => path === "scratch.txt"));

  unlinkSync(join(root, "nested", "notes.txt"));
  const deleted = await capturePreviewCandidateIdentity({ hostRoot: root });
  assert.notEqual(deleted.candidate.digest, untracked.candidate.digest);
  assert.equal(
    deleted.candidate.entries.some(({ path }) => path === "nested/notes.txt"),
    false,
  );
});

test("ignored files are outside the exact Git candidate claim", async (t) => {
  const root = repository(t);
  const first = await capturePreviewCandidateIdentity({ hostRoot: root });
  mkdirSync(join(root, "ignored"));
  writeFileSync(join(root, "ignored", "credential.txt"), "not evidence\n", "utf8");
  const second = await capturePreviewCandidateIdentity({ hostRoot: root });
  assert.deepEqual(second, first);
});

test("symbolic-link evidence hashes its target spelling without following it", {
  skip: process.platform === "win32",
}, async (t) => {
  const root = repository(t);
  mkdirSync(join(root, "ignored"));
  writeFileSync(join(root, "ignored", "first.txt"), "secret one\n", "utf8");
  writeFileSync(join(root, "ignored", "second.txt"), "secret two\n", "utf8");
  symlinkSync("ignored/first.txt", join(root, "pointer"));
  const first = await capturePreviewCandidateIdentity({ hostRoot: root });
  const pointer = first.candidate.entries.find(({ path }) => path === "pointer");
  assert.equal(pointer?.kind, "symbolic-link");
  assert.equal(pointer?.bytes, Buffer.byteLength("ignored/first.txt"));

  writeFileSync(join(root, "ignored", "first.txt"), "changed secret\n", "utf8");
  const targetBytesChanged = await capturePreviewCandidateIdentity({ hostRoot: root });
  assert.equal(targetBytesChanged.candidate.digest, first.candidate.digest);

  unlinkSync(join(root, "pointer"));
  symlinkSync("ignored/second.txt", join(root, "pointer"));
  const targetSpellingChanged = await capturePreviewCandidateIdentity({ hostRoot: root });
  assert.notEqual(targetSpellingChanged.candidate.digest, first.candidate.digest);
});

test("detached worktrees remain distinguishable and fail cross-worktree verification", async (t) => {
  const root = repository(t);
  const secondRoot = join(dirname(root), `${basename(root)}-worktree`);
  t.after(() => rmSync(secondRoot, { force: true, recursive: true }));
  git(root, ["worktree", "add", "--quiet", "--detach", secondRoot, "HEAD"]);
  const canonicalSecond = realpathSync(secondRoot);
  const detached = await capturePreviewCandidateIdentity({ hostRoot: canonicalSecond });
  assert.equal(detached.branch, null);
  assert.equal(detached.worktreeRoot, canonicalSecond);

  const result = await verifyPreviewCandidateIdentity({
    hostRoot: root,
    expected: detached,
  });
  assert.equal(result.matches, false);
  assert.ok(result.mismatches.includes("worktree"));
  assert.ok(result.mismatches.includes("branch"));
  assert.ok(result.mismatches.includes("identity"));
});

test("malformed and internally inconsistent saved evidence is refused", async (t) => {
  const root = repository(t);
  const identity = await capturePreviewCandidateIdentity({ hostRoot: root });
  const tampered = JSON.parse(JSON.stringify(identity));
  tampered.candidate.entries[0].sha256 = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => parsePreviewCandidateIdentity(tampered),
    /digest does not authenticate its entries/u,
  );

  const extra = JSON.parse(JSON.stringify(identity));
  extra.surprise = true;
  assert.throws(
    () => parsePreviewCandidateIdentity(extra),
    /must contain exactly/u,
  );

  const malformedUnicode = JSON.parse(JSON.stringify(identity));
  malformedUnicode.candidate.entries[0].path = "bad\ud800";
  assert.throws(
    () => parsePreviewCandidateIdentity(malformedUnicode),
    /unpaired Unicode surrogate/u,
  );
});

test("repositories without a commit and repositories with submodules are refused", async (t) => {
  const noRepository = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-preview-no-git-")),
  );
  t.after(() => rmSync(noRepository, { force: true, recursive: true }));
  await assert.rejects(
    capturePreviewCandidateIdentity({ hostRoot: noRepository }),
    /Git rev-parse failed/u,
  );

  const empty = repository(t, { commit: false });
  await assert.rejects(
    capturePreviewCandidateIdentity({ hostRoot: empty }),
    /rev-parse failed|HEAD/u,
  );

  const root = repository(t);
  const commit = git(root, ["rev-parse", "HEAD"]);
  git(root, ["update-index", "--add", "--cacheinfo", `160000,${commit},vendor`]);
  await assert.rejects(
    capturePreviewCandidateIdentity({ hostRoot: root }),
    /does not guess the bytes behind Git submodule/u,
  );
});

test("an unmerged index is refused instead of selecting one conflict stage", async (t) => {
  const root = repository(t);
  git(root, ["switch", "--quiet", "-c", "other"]);
  writeFileSync(join(root, "manuscript.md"), "Other branch.\n", "utf8");
  git(root, ["add", "manuscript.md"]);
  git(root, ["commit", "--quiet", "-m", "other"]);
  git(root, ["switch", "--quiet", "main"]);
  writeFileSync(join(root, "manuscript.md"), "Main branch.\n", "utf8");
  git(root, ["add", "manuscript.md"]);
  git(root, ["commit", "--quiet", "-m", "main"]);
  const merged = spawnSync("git", ["merge", "other"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "preview@example.test",
      GIT_AUTHOR_NAME: "Preview",
      GIT_COMMITTER_EMAIL: "preview@example.test",
      GIT_COMMITTER_NAME: "Preview",
    },
  });
  assert.equal(merged.status, 1);
  await assert.rejects(
    capturePreviewCandidateIdentity({ hostRoot: root }),
    /cannot be captured from an unmerged Git index/u,
  );
});

test("a candidate path passing through a symbolic-link parent is refused", {
  skip: process.platform === "win32",
}, async (t) => {
  const root = repository(t);
  const outside = join(dirname(root), `${basename(root)}-outside`);
  t.after(() => rmSync(outside, { force: true, recursive: true }));
  mkdirSync(outside);
  writeFileSync(join(outside, "notes.txt"), "outside\n", "utf8");
  rmSync(join(root, "nested"), { recursive: true });
  symlinkSync(outside, join(root, "nested"));
  await assert.rejects(
    capturePreviewCandidateIdentity({ hostRoot: root }),
    /passes through a non-directory or symbolic-link parent/u,
  );
});

test("the CLI emits evidence, verifies it, and exits nonzero after byte drift", async (t) => {
  const root = repository(t);
  const evidencePath = join(root, "ignored", "preview.json");
  mkdirSync(dirname(evidencePath));
  const captured = run(root, ["preview", "identity", "--host", root, "--json"]);
  assert.equal(captured.status, 0, captured.stderr);
  const identity = JSON.parse(captured.stdout);
  assert.equal(identity.worktreeRoot, root);
  writeFileSync(evidencePath, captured.stdout, "utf8");

  const current = run(root, [
    "preview",
    "verify",
    "--host",
    root,
    "--identity",
    evidencePath,
  ]);
  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stdout, /Preview identity matches/u);

  writeFileSync(join(root, "manuscript.md"), "Drift.\n", "utf8");
  const stale = run(root, [
    "preview",
    "verify",
    "--host",
    root,
    "--identity",
    evidencePath,
    "--json",
  ]);
  assert.equal(stale.status, 1, stale.stderr);
  assert.equal(JSON.parse(stale.stdout).matches, false);

  const missing = run(root, ["preview", "verify", "--host", root]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /requires --identity/u);
});
