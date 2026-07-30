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

// Protected roots come from the manifest.
//
// This exists because of a demonstrated hole. The mutation policy always accepted
// protected roots and its own reasoning said they come from the publication's
// declared roots, but nothing read the manifest. The only way to get the
// protection was a command line flag repeating what the manifest already said, so
// an author who did not pass it got none, and a renderer aiming its artifact into
// a manuscript directory was obeyed and reported success.
//
// The last test in this file is that exploit, kept as a regression.

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ProtectedRootsError,
  resolveArtifactDestination,
  resolvePublicationProtectedRoots,
} from "../packages/publisher/dist/node.js";

function scratch(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-protected-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function writeManifest(root, boundaries) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "publication.json"),
    `${JSON.stringify(
      boundaries === undefined ? { schemaVersion: "1.0" } : { boundaries },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

// -------------------------------------------------------- reading roots

test("declared source roots become protected roots", (t) => {
  const root = scratch(t);
  writeManifest(root, {
    sourceRoots: ["publication"],
    outputRoots: [".publisher"],
  });
  assert.deepEqual(
    resolvePublicationProtectedRoots({
      hostRoot: root,
      publicationRoot: root,
    }),
    ["publication"],
  );
});

test("several declared roots are all protected, sorted", (t) => {
  const root = scratch(t);
  writeManifest(root, {
    sourceRoots: ["shared", "archive", "lists"],
    outputRoots: [".publisher"],
  });
  assert.deepEqual(
    resolvePublicationProtectedRoots({
      hostRoot: root,
      publicationRoot: root,
    }),
    ["archive", "lists", "shared"],
  );
});

test("the flag adds to what the manifest declares", (t) => {
  const root = scratch(t);
  writeManifest(root, { sourceRoots: ["publication"] });
  assert.deepEqual(
    resolvePublicationProtectedRoots({
      hostRoot: root,
      publicationRoot: root,
      additional: ["editorial", "audio/"],
    }),
    ["audio", "editorial", "publication"],
  );
});

test("a publication nested inside the host is translated onto the host", (t) => {
  const root = scratch(t);
  const publicationRoot = join(root, "content", "book");
  writeManifest(publicationRoot, { sourceRoots: ["publication", "assets"] });
  assert.deepEqual(
    resolvePublicationProtectedRoots({
      hostRoot: root,
      publicationRoot,
    }),
    ["content/book/assets", "content/book/publication"],
  );
});

test("a publication outside the host contributes nothing", (t) => {
  const hostRoot = scratch(t);
  const publicationRoot = scratch(t);
  writeManifest(publicationRoot, { sourceRoots: ["publication"] });
  // Nothing the manifest names is inside the host, and the path resolver already
  // refuses writes outside it, so there is nothing left to protect.
  assert.deepEqual(
    resolvePublicationProtectedRoots({ hostRoot, publicationRoot }),
    [],
  );
  // The flag still applies, because it is about the host.
  assert.deepEqual(
    resolvePublicationProtectedRoots({
      hostRoot,
      publicationRoot,
      additional: ["editorial"],
    }),
    ["editorial"],
  );
});

test("an absent manifest is not an error", (t) => {
  const root = scratch(t);
  // Initializing a host before authoring anything is ordinary, and there are no
  // sources to protect yet.
  assert.deepEqual(
    resolvePublicationProtectedRoots({
      hostRoot: root,
      publicationRoot: root,
    }),
    [],
  );
});

// ------------------------------------------------------------- refusals

test("a manifest that cannot be understood is refused, not treated as empty", (t) => {
  const cases = [
    { name: "invalid JSON", write: (root) => writeFileSync(join(root, "publication.json"), "{ not json\n", "utf8") },
    { name: "not an object", write: (root) => writeFileSync(join(root, "publication.json"), "[]\n", "utf8") },
    { name: "no boundaries", write: (root) => writeManifest(root, undefined) },
    { name: "empty sourceRoots", write: (root) => writeManifest(root, { sourceRoots: [] }) },
    { name: "non-string root", write: (root) => writeManifest(root, { sourceRoots: [7] }) },
    { name: "absolute root", write: (root) => writeManifest(root, { sourceRoots: ["/etc"] }) },
    { name: "climbing root", write: (root) => writeManifest(root, { sourceRoots: ["../elsewhere"] }) },
    { name: "dot segment", write: (root) => writeManifest(root, { sourceRoots: ["a/./b"] }) },
    { name: "windows separator", write: (root) => writeManifest(root, { sourceRoots: ["a\\b"] }) },
    { name: "NUL", write: (root) => writeManifest(root, { sourceRoots: ["a\u0000b"] }) },
    { name: "only separators", write: (root) => writeManifest(root, { sourceRoots: ["///"] }) },
  ];
  for (const entry of cases) {
    const root = scratch(t);
    entry.write(root);
    assert.throws(
      () =>
        resolvePublicationProtectedRoots({
          hostRoot: root,
          publicationRoot: root,
        }),
      ProtectedRootsError,
      `${entry.name} must be refused rather than silently unprotected`,
    );
  }
});

test("the refusal explains why it is not proceeding", (t) => {
  const root = scratch(t);
  writeFileSync(join(root, "publication.json"), "{ not json\n", "utf8");
  assert.throws(
    () =>
      resolvePublicationProtectedRoots({
        hostRoot: root,
        publicationRoot: root,
      }),
    (error) => {
      assert.match(error.message, /which paths hold your sources/u);
      assert.match(error.message, /rather than treating your publication as unprotected/u);
      return true;
    },
  );
});

// ------------------------------------------------------------ regression

test("a renderer cannot aim its artifact into a declared source root", (t) => {
  const root = scratch(t);
  writeManifest(root, {
    sourceRoots: ["publication"],
    outputRoots: [".publisher"],
  });
  const protectedRoots = resolvePublicationProtectedRoots({
    hostRoot: root,
    publicationRoot: root,
  });

  // The exploit, verbatim. Before the manifest was read, this wrote a generated
  // file into the author's manuscript directory and reported success.
  assert.throws(
    () =>
      resolveArtifactDestination({
        hostRoot: root,
        declaredArtifactPath: "publication/works/first-light/reader.json",
        rendererManagedPaths: ["package.json", "app/page.tsx"],
        protectedRoots,
      }),
    (error) => {
      assert.match(error.message, /inside the declared root publication/u);
      return true;
    },
  );

  // A path outside the declared roots is still fine, so the refusal is about the
  // root rather than about generated output in general.
  assert.ok(
    resolveArtifactDestination({
      hostRoot: root,
      declaredArtifactPath: "publication-reader.json",
      rendererManagedPaths: ["package.json", "app/page.tsx"],
      protectedRoots,
    }),
  );
});
