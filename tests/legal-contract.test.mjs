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
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

function read(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), "utf8");
}

const packageDefinitions = [
  {
    label: "workspace",
    root: "",
    manifestPath: "package.json",
  },
  {
    label: "schema",
    root: "schemas/",
    manifestPath: "schemas/package.json",
  },
  {
    label: "content",
    root: "packages/content/",
    manifestPath: "packages/content/package.json",
  },
  {
    label: "reader",
    root: "packages/reader/",
    manifestPath: "packages/reader/package.json",
  },
  {
    label: "next",
    root: "packages/next/",
    manifestPath: "packages/next/package.json",
  },
];

const packages = await Promise.all(
  packageDefinitions.map(async (definition) => {
    const [license, legal, notice, readme, sourceNotice, packageText] =
      await Promise.all([
        read(`${definition.root}LICENSE`),
        read(`${definition.root}LEGAL`),
        read(`${definition.root}NOTICE.md`),
        read(`${definition.root}README.md`),
        read(`${definition.root}SOURCE-NOTICE`),
        read(definition.manifestPath),
      ]);

    return {
      ...definition,
      license,
      legal,
      notice,
      readme,
      sourceNotice,
      manifest: JSON.parse(packageText),
    };
  }),
);

const [
  workspacePackage,
  schemaPackage,
  contentPackage,
  readerPackage,
  nextPackage,
] = packages;
assert.ok(workspacePackage);
assert.ok(schemaPackage);
assert.ok(contentPackage);
assert.ok(readerPackage);
assert.ok(nextPackage);

const sourceNoticeBody = workspacePackage.sourceNotice
  .split("\n")
  .slice(2)
  .join("\n")
  .trim();

test("workspace and public package metadata identify CPAL 1.0", () => {
  for (const packageDefinition of packages) {
    assert.equal(
      packageDefinition.manifest.license,
      "CPAL-1.0",
      packageDefinition.label,
    );
  }

  const requiredPackageArtifacts = [
    "CHANGES.md",
    "LEGAL",
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "SOURCE-NOTICE",
  ];
  for (const packageDefinition of [
    schemaPackage,
    contentPackage,
    readerPackage,
    nextPackage,
  ]) {
    for (const artifact of requiredPackageArtifacts) {
      assert.ok(
        packageDefinition.manifest.files.includes(artifact),
        `${packageDefinition.label} package omits ${artifact}`,
      );
    }
    assert.equal(packageDefinition.manifest.publishConfig.access, "public");
    assert.equal(packageDefinition.manifest.publishConfig.provenance, true);
  }
});

test("every license retains attribution and network source sharing", () => {
  for (const packageDefinition of packages) {
    assert.match(
      packageDefinition.license,
      /14\. ADDITIONAL TERM: ATTRIBUTION/,
      packageDefinition.label,
    );
    assert.match(
      packageDefinition.license,
      /15\. ADDITIONAL TERM: NETWORK USE/,
      packageDefinition.label,
    );
    assert.match(
      packageDefinition.license,
      /Display of Attribution Information is required in Larger Works/,
      packageDefinition.label,
    );
  }
});

test("public packages carry exact license, legal, and source notice copies", () => {
  for (const packageDefinition of packages) {
    assert.equal(
      packageDefinition.license,
      workspacePackage.license,
      `${packageDefinition.label} LICENSE`,
    );
    assert.equal(
      packageDefinition.legal,
      workspacePackage.legal,
      `${packageDefinition.label} LEGAL`,
    );
    assert.equal(
      packageDefinition.sourceNotice,
      workspacePackage.sourceNotice,
      `${packageDefinition.label} SOURCE-NOTICE`,
    );
    assert.ok(
      packageDefinition.license.includes(sourceNoticeBody),
      packageDefinition.label,
    );
  }
});

test("Exhibit B and every public package preserve the fixed credit", () => {
  for (const packageDefinition of packages) {
    for (const [artifact, text] of [
      ["LICENSE", packageDefinition.license],
      ["NOTICE.md", packageDefinition.notice],
    ]) {
      assert.match(
        text,
        /Copyright 2026 GENII Foundation/,
        `${packageDefinition.label} ${artifact}`,
      );
      assert.match(
        text,
        /Published with GENII Publisher/,
        `${packageDefinition.label} ${artifact}`,
      );
      assert.match(
        text,
        /https:\/\/publisher\.genii\.foundation/,
        `${packageDefinition.label} ${artifact}`,
      );
    }

    assert.match(
      packageDefinition.readme,
      /Copyright 2026 GENII Foundation/,
      `${packageDefinition.label} README.md`,
    );
    assert.match(
      packageDefinition.readme,
      /Published with GENII Publisher/,
      `${packageDefinition.label} README.md`,
    );
  }
});

test("public documentation identifies the canonical source repository", () => {
  assert.match(
    workspacePackage.readme,
    /https:\/\/github\.com\/genii-foundation\/publisher/,
  );
  for (const packageDefinition of packages) {
    assert.match(
      packageDefinition.notice,
      /https:\/\/github\.com\/genii-foundation\/publisher/,
      packageDefinition.label,
    );
  }
});

test("content package includes notices for its third-party dependencies", async () => {
  assert.ok(
    contentPackage.manifest.files.includes("THIRD_PARTY_NOTICES.md"),
  );
  assert.ok(contentPackage.manifest.files.includes("third-party-licenses"));

  const [thirdPartyNotices, unicodeLicense] = await Promise.all([
    read("packages/content/THIRD_PARTY_NOTICES.md"),
    read(
      "packages/content/third-party-licenses/unicode-15.1.0-LICENSE-MIT.txt",
    ),
  ]);
  assert.match(thirdPartyNotices, /^# Third-party notices$/m);
  assert.match(thirdPartyNotices, /remain subject to their own license terms/);
  assert.match(thirdPartyNotices, /not GENII\s+Publisher Original Code/);
  assert.match(unicodeLicense, /^Copyright Mathias Bynens/m);
  assert.match(unicodeLicense, /Permission is hereby granted/);

  const internalPackagePrefix = "@genii-foundation/";
  const thirdPartyDependencies = Object.entries(
    contentPackage.manifest.dependencies,
  ).filter(([packageName]) => !packageName.startsWith(internalPackagePrefix));
  assert.ok(thirdPartyDependencies.length > 0);

  for (const [packageName, version] of thirdPartyDependencies) {
    assert.ok(
      thirdPartyNotices.includes(`\`${packageName}\``),
      packageName,
    );
    assert.ok(thirdPartyNotices.includes(version), version);
  }
});

test("reader package includes its CommonMark parser notice", async () => {
  assert.ok(
    readerPackage.manifest.files.includes("THIRD_PARTY_NOTICES.md"),
  );
  assert.ok(readerPackage.manifest.files.includes("third-party-licenses"));

  const [thirdPartyNotices, parserLicense] = await Promise.all([
    read("packages/reader/THIRD_PARTY_NOTICES.md"),
    read(
      "packages/reader/third-party-licenses/mdast-util-from-markdown-LICENSE-MIT.txt",
    ),
  ]);
  assert.match(thirdPartyNotices, /^# Third-party notices$/m);
  assert.match(thirdPartyNotices, /not GENII Publisher Original Code/);
  assert.match(
    thirdPartyNotices,
    /`mdast-util-from-markdown` \| 2\.0\.3 \| MIT/,
  );
  assert.equal(
    readerPackage.manifest.dependencies["mdast-util-from-markdown"],
    "2.0.3",
  );
  assert.match(parserLicense, /Copyright \(c\) Titus Wormer/);
  assert.match(parserLicense, /Permission is hereby granted/);
});

test("Next package includes notices for direct and peer dependencies", async () => {
  assert.ok(
    nextPackage.manifest.files.includes("THIRD_PARTY_NOTICES.md"),
  );
  assert.ok(nextPackage.manifest.files.includes("third-party-licenses"));

  const [
    thirdPartyNotices,
    nextLicense,
    reactLicense,
    markdownLicense,
    serverOnlyLicense,
    semverLicense,
  ] = await Promise.all([
    read("packages/next/THIRD_PARTY_NOTICES.md"),
    read("packages/next/third-party-licenses/next-LICENSE-MIT.txt"),
    read(
      "packages/next/third-party-licenses/react-and-react-dom-LICENSE-MIT.txt",
    ),
    read("packages/next/third-party-licenses/react-markdown-LICENSE-MIT.txt"),
    read("packages/next/third-party-licenses/server-only-LICENSE-MIT.txt"),
    read("packages/next/third-party-licenses/semver-LICENSE-ISC.txt"),
  ]);

  assert.match(thirdPartyNotices, /^# Third-party notices$/m);
  assert.match(thirdPartyNotices, /not GENII Publisher Original Code/);
  for (const [packageName, version] of Object.entries({
    ...nextPackage.manifest.dependencies,
    ...nextPackage.manifest.peerDependencies,
  }).filter(
    ([packageName]) => !packageName.startsWith("@genii-foundation/"),
  )) {
    assert.ok(thirdPartyNotices.includes(`\`${packageName}\``));
    assert.ok(thirdPartyNotices.includes(version));
  }
  assert.match(nextLicense, /Copyright \(c\) 2025 Vercel, Inc\./);
  assert.match(reactLicense, /Copyright \(c\) Meta Platforms/);
  assert.match(markdownLicense, /Copyright \(c\) Espen Hovlandsdal/);
  assert.match(serverOnlyLicense, /Copyright \(c\) Meta Platforms/);
  assert.match(serverOnlyLicense, /Permission is hereby granted/);
  assert.match(semverLicense, /The ISC License/);
});
