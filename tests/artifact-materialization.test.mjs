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

// Where a renderer is allowed to put the reader artifact.
//
// The renderer declares this path, and a renderer is a third-party package. So
// every case here is the same question asked differently: can a declared path
// reach something it should not. The interesting ones are not traversal, which
// the shared resolver already refuses, but the two that an allowlist cannot see.
//
// A renderer that names one of its own contract files gets every build silently
// overwriting that file, because a path in an allowlist is allowed by
// construction. And on a case-insensitive filesystem a different spelling of the
// same file is a different string, so the check has to fold.

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ArtifactDestinationError,
  checkReaderArtifact,
  hashArtifactText,
  resolveArtifactDestination,
  stagedArtifactPathFor,
  writeReaderArtifact,
} from "../packages/publisher/dist/node.js";
import {
  PUBLISHER_HOST_STATE_PATH,
} from "../packages/publisher/dist/node/lifecycle/host-state.js";

const contractPaths = Object.freeze([
  "package.json",
  "next.config.mjs",
  "app/page.tsx",
  "app/layout.tsx",
]);

function host(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-artifact-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function destination(hostRoot, readerDataPath, extra = {}) {
  return resolveArtifactDestination({
    hostRoot,
    readerDataPath,
    rendererManagedPaths: contractPaths,
    ...extra,
  });
}

// ------------------------------------------------------- accepted paths

test("a plain host-root path is accepted", (t) => {
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "publication-reader.json");
  assert.equal(resolved.hostRelativePath, "publication-reader.json");
  assert.equal(
    resolved.absolutePath,
    join(hostRoot, "publication-reader.json"),
  );
});

test("a nested path is accepted and its directory is created on write", (t) => {
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "generated/reader/data.json");
  const written = writeReaderArtifact({
    destination: resolved,
    text: '{"a":1}\n',
  });
  assert.equal(written.outcome, "written");
  assert.equal(
    readFileSync(join(hostRoot, "generated", "reader", "data.json"), "utf8"),
    '{"a":1}\n',
  );
});

// ------------------------------------------------------- refused paths

test("a renderer cannot point the artifact at its own contract file", (t) => {
  const hostRoot = host(t);
  for (const managed of contractPaths) {
    assert.throws(
      () => destination(hostRoot, managed),
      (error) => {
        assert.ok(error instanceof ArtifactDestinationError);
        assert.match(error.message, /the renderer's host contract owns/u);
        // The author has to be told what the consequence would be, or the
        // refusal reads as pedantry.
        assert.match(error.message, /Every build would overwrite it/u);
        return true;
      },
      `${managed} must not be usable as the artifact path`,
    );
  }
});

test("a different spelling of a contract file is still refused", (t) => {
  const hostRoot = host(t);
  // On a case-insensitive filesystem this is app/page.tsx. On a sensitive one it
  // is a different file, and refusing it there costs a renderer nothing.
  for (const spelling of ["App/Page.tsx", "APP/PAGE.TSX", "Package.json"]) {
    assert.throws(
      () => destination(hostRoot, spelling),
      ArtifactDestinationError,
      `${spelling} must not slip past the collision check`,
    );
  }
});

test("a renderer cannot point the artifact at the engine state file", (t) => {
  const hostRoot = host(t);
  assert.throws(
    () => destination(hostRoot, PUBLISHER_HOST_STATE_PATH),
    (error) => {
      assert.match(error.message, /engine's own host state file/u);
      return true;
    },
  );
});

test("a renderer cannot point the artifact at the reserved config path", (t) => {
  const hostRoot = host(t);
  // Refused by the shared mutation policy rather than by the collision check.
  // The policy denies this path in every role, which is the stronger place for it
  // to live, so this asserts the policy's own wording.
  assert.throws(
    () => destination(hostRoot, "publisher.config.ts"),
    (error) => {
      assert.ok(error instanceof ArtifactDestinationError);
      assert.match(error.message, /host configuration is author-owned code/u);
      return true;
    },
  );
});

test("hard denied roots are refused even though the path is declared", (t) => {
  const hostRoot = host(t);
  // These are named in the engine allowlist by resolveArtifactDestination itself,
  // which is exactly the case the policy's ordering exists for: declaring a path
  // must not grant authority over it.
  for (const hostile of [
    ".git/config",
    ".git/hooks/pre-commit",
    ".publisher/last-apply.json",
    "node_modules/.bin/anything",
    ".env",
    ".env.local",
  ]) {
    assert.throws(
      () => destination(hostRoot, hostile),
      ArtifactDestinationError,
      `${hostile} must be refused`,
    );
  }
});

test("paths that escape or are not relative POSIX are refused", (t) => {
  const hostRoot = host(t);
  for (const hostile of [
    "../outside.json",
    "a/../../outside.json",
    "/etc/passwd",
    "",
    "a//b.json",
    "a/./b.json",
    "reader\\data.json",
    "trailing./data.json",
    "trailing /data.json",
    `reader${"\0"}.json`,
  ]) {
    assert.throws(
      () => destination(hostRoot, hostile),
      (error) => {
        assert.ok(
          error instanceof Error,
          `${JSON.stringify(hostile)} must be refused with an error`,
        );
        return true;
      },
      `${JSON.stringify(hostile)} must be refused`,
    );
  }
});

test("a protected root refuses the artifact even when declared", (t) => {
  const hostRoot = host(t);
  assert.throws(
    () =>
      destination(hostRoot, "editorial/reader.json", {
        protectedRoots: ["editorial"],
      }),
    ArtifactDestinationError,
  );
  // The same path outside the protected root is fine, so the refusal is about
  // the root rather than the name.
  assert.ok(destination(hostRoot, "generated/reader.json", {
    protectedRoots: ["editorial"],
  }));
});

test("a symlinked ancestor is refused rather than followed", (t) => {
  const hostRoot = host(t);
  const outside = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-artifact-outside-")),
  );
  t.after(() => {
    rmSync(outside, { recursive: true, force: true });
  });
  try {
    symlinkSync(outside, join(hostRoot, "generated"), "dir");
  } catch {
    t.skip("this filesystem does not support creating symbolic links");
    return;
  }
  assert.throws(
    () => destination(hostRoot, "generated/reader.json"),
    /symbolic link/u,
  );
  assert.equal(
    readdirSync(outside).length,
    0,
    "nothing may be written through the link",
  );
});

// ------------------------------------------------------------- writing

test("an identical artifact is not rewritten", (t) => {
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "publication-reader.json");
  const text = '{"reader":true}\n';

  const first = writeReaderArtifact({ destination: resolved, text });
  assert.equal(first.outcome, "written");
  const stamp = statSync(resolved.absolutePath).mtimeMs;

  const second = writeReaderArtifact({ destination: resolved, text });
  assert.equal(second.outcome, "current");
  // Not an optimization. A rewritten byte-identical file restarts a watching
  // build tool, which then triggers another build.
  assert.equal(statSync(resolved.absolutePath).mtimeMs, stamp);
  assert.equal(first.sha256, second.sha256);
});

test("a changed artifact replaces the old one and reports its digest", (t) => {
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "publication-reader.json");
  writeReaderArtifact({ destination: resolved, text: '{"v":1}\n' });
  const second = writeReaderArtifact({
    destination: resolved,
    text: '{"v":2}\n',
  });
  assert.equal(second.outcome, "written");
  assert.equal(readFileSync(resolved.absolutePath, "utf8"), '{"v":2}\n');
  assert.equal(second.sha256, hashArtifactText('{"v":2}\n'));
  assert.equal(second.bytes, Buffer.byteLength('{"v":2}\n', "utf8"));
});

test("a failed write leaves the previous artifact intact and no debris", (t) => {
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "publication-reader.json");
  writeReaderArtifact({ destination: resolved, text: '{"v":1}\n' });
  assert.deepEqual(readdirSync(hostRoot), ["publication-reader.json"]);

  // Make the destination directory unwritable so staging the replacement fails.
  // Read permission is kept so the comparison read still succeeds and the write
  // is genuinely attempted rather than short-circuited as already current.
  try {
    chmodSync(hostRoot, 0o500);
  } catch {
    t.skip("this filesystem does not support changing directory permissions");
    return;
  }
  t.after(() => {
    try {
      chmodSync(hostRoot, 0o700);
    } catch {
      // Cleanup only. The directory is removed by the fixture either way.
    }
  });

  let threw = false;
  try {
    writeReaderArtifact({ destination: resolved, text: '{"v":2}\n' });
  } catch {
    threw = true;
  }
  chmodSync(hostRoot, 0o700);

  if (!threw) {
    // Running as a user the mode does not restrain, such as root in a container.
    // Skipping is honest; asserting would pass for the wrong reason.
    t.skip("directory permissions do not restrain this user");
    return;
  }

  assert.equal(
    readFileSync(resolved.absolutePath, "utf8"),
    '{"v":1}\n',
    "the previous artifact must survive a failed write",
  );
  assert.deepEqual(
    readdirSync(hostRoot),
    ["publication-reader.json"],
    "a failed write must not leave a staged file behind",
  );
});

// ------------------------------------------------------------ checking

test("checking reports missing, stale, and current distinctly", (t) => {
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "publication-reader.json");
  const text = '{"v":1}\n';

  const missing = checkReaderArtifact({ destination: resolved, text });
  assert.equal(missing.outcome, "missing");
  assert.equal(missing.actual, null);
  assert.equal(missing.expected, hashArtifactText(text));

  writeFileSync(resolved.absolutePath, '{"v":0}\n', "utf8");
  const stale = checkReaderArtifact({ destination: resolved, text });
  assert.equal(stale.outcome, "stale");
  assert.equal(stale.actual, hashArtifactText('{"v":0}\n'));
  assert.notEqual(stale.actual, stale.expected);

  writeReaderArtifact({ destination: resolved, text });
  assert.equal(
    checkReaderArtifact({ destination: resolved, text }).outcome,
    "current",
  );
});

test("checking writes nothing", (t) => {
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "publication-reader.json");
  checkReaderArtifact({ destination: resolved, text: '{"v":1}\n' });
  assert.equal(existsSync(resolved.absolutePath), false);
  assert.deepEqual(readdirSync(hostRoot), []);
});

test("a directory where the artifact belongs reads as missing", (t) => {
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "publication-reader.json");
  mkdirSync(resolved.absolutePath);
  const checked = checkReaderArtifact({
    destination: resolved,
    text: '{"v":1}\n',
  });
  assert.equal(checked.outcome, "missing");
  assert.equal(checked.actual, null);
});

// ------------------------------------------- interrupted build cleanup

test("a staged artifact left by an interrupted build is cleared", (t) => {
  // A build killed between staging and renaming leaves this file. The catch that
  // would have removed it never runs on a signal, and nothing else knows the name.
  // It is untracked and not ignored, so the tree stays dirty and every later apply
  // and upgrade refuses over a file the author never created.
  //
  // This case passed before the fix as well, because a real write reuses the same
  // deterministic staged name and renames it away. It is kept to document that,
  // not as a guard. The test below it is the one that fails without the fix.
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "publication-reader.json");
  const staged = stagedArtifactPathFor(resolved);

  writeFileSync(staged, '{"partial":true}', "utf8");
  assert.ok(existsSync(staged));

  const written = writeReaderArtifact({
    destination: resolved,
    text: '{"v":1}\n',
  });
  assert.equal(written.outcome, "written");
  assert.equal(
    existsSync(staged),
    false,
    "a write must clear a staged file from an interrupted build",
  );
  assert.deepEqual(readdirSync(hostRoot), ["publication-reader.json"]);
});

test("the already current path clears it too", (t) => {
  // This is the case that matters most. An author whose build was killed runs build
  // again, and the second run usually finds the artifact already current. Before,
  // that shortcut returned before reaching any cleanup, so the file survived every
  // subsequent build and there was no way to get rid of it through the tool.
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "publication-reader.json");
  const text = '{"v":1}\n';
  assert.equal(
    writeReaderArtifact({ destination: resolved, text }).outcome,
    "written",
  );

  const staged = stagedArtifactPathFor(resolved);
  writeFileSync(staged, '{"partial":true}', "utf8");

  const second = writeReaderArtifact({ destination: resolved, text });
  assert.equal(second.outcome, "current", "the artifact is unchanged");
  assert.equal(
    existsSync(staged),
    false,
    "and the staged leftover is gone even though nothing was written",
  );
});

test("the staged path is derived from the destination, not guessed", (t) => {
  // status has to find this file without duplicating how the name is built, or the
  // two derivations drift and status stops noticing.
  const hostRoot = host(t);
  const resolved = destination(hostRoot, "generated/reader/data.json");
  const staged = stagedArtifactPathFor(resolved);
  assert.match(staged, /\.artifact\.tmp$/u);
  // Beside the artifact, because a rename across filesystems is a copy.
  assert.equal(
    staged.startsWith(join(hostRoot, "generated", "reader")),
    true,
    `staged file must sit beside the artifact, got ${staged}`,
  );
  // And distinct per destination, so two artifacts cannot collide on one staged
  // name.
  const other = stagedArtifactPathFor(
    destination(hostRoot, "publication-reader.json"),
  );
  assert.notEqual(staged, other);
});

test("ADR 0013 records the ordering that makes the cleanup work", () => {
  // The decision record described an identical artifact as not being rewritten,
  // which reads as nothing happening on that path. That reading is exactly how the
  // staged orphan defect was written: the already-current shortcut returned before
  // reaching any cleanup. The behaviour is guarded by the test above; this guards
  // the record, so a future reader does not optimise the ordering away on the
  // strength of a document that no longer explains it.
  // Whitespace flexible, because these phrases wrap across lines in the document
  // and a single line regex silently matched nothing. That is how the paragraph got
  // inserted twice: the guard said it was missing when it was there.
  const adr = readFileSync(
    fileURLToPath(
      new URL(
        "../docs/architecture/0013-reader-artifact-materialization.md",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  assert.match(
    adr,
    /before deciding the artifact is\s+already current/u,
    "ADR 0013 must record that cleanup precedes the already-current shortcut",
  );
  assert.match(
    adr,
    /declared source\s+roots rather than supplied by the caller/u,
    "ADR 0013 must record where protected roots come from now",
  );
});
