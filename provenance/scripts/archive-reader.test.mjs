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
import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  promises as fileSystemPromises,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  ARCHIVE_LIMITS,
  PACKED_MANIFEST_PATH,
  createRawTarAuditor,
  decodeTarNumericField,
  maximumArchiveBytes,
  maximumArchiveEntries,
  parsePackedManifestJson,
  readPackageArchive,
  sha256,
} from "./archive-reader.mjs";
import {
  inspectPackageArchive,
} from "./package-artifacts.mjs";

// --------------------------------------------------------------- fixtures

const blockBytes = 512;

function zeroBlock(fill = 0) {
  return Buffer.alloc(blockBytes, fill);
}

function checksum(block) {
  let sum = 8 * 32;
  for (let index = 0; index < 148; index += 1) {
    sum += block[index];
  }
  for (let index = 156; index < blockBytes; index += 1) {
    sum += block[index];
  }
  return sum;
}

function octalField(value, width) {
  const text = value.toString(8);
  return (
    "0".repeat(Math.max(0, width - 1 - text.length)) + text + "\0"
  );
}

// A hand-built ustar header. Every adversarial case needs byte-level control,
// which `tar-stream`'s own packer deliberately refuses to give.
function tarHeader({
  name,
  size = 0,
  typeFlag = "0",
  linkName = "",
  mode = 0o644,
  prefix = "",
  magic = "ustar\0",
  version = "00",
  nameBytes,
}) {
  const block = zeroBlock();
  if (nameBytes === undefined) {
    block.write(name, 0, 100, "utf8");
  } else {
    nameBytes.copy(block, 0, 0, Math.min(nameBytes.length, 100));
  }
  block.write(octalField(mode, 8), 100, 8, "ascii");
  block.write(octalField(0, 8), 108, 8, "ascii");
  block.write(octalField(0, 8), 116, 8, "ascii");
  block.write(octalField(size, 12), 124, 12, "ascii");
  block.write(octalField(0, 12), 136, 12, "ascii");
  block.write("        ", 148, 8, "ascii");
  block.write(typeFlag, 156, 1, "ascii");
  if (linkName !== "") {
    block.write(linkName, 157, 100, "utf8");
  }
  block.write(magic, 257, 6, "ascii");
  block.write(version, 263, 2, "ascii");
  if (prefix !== "") {
    block.write(prefix, 345, 155, "ascii");
  }
  block.write(octalField(checksum(block), 8), 148, 8, "ascii");
  return block;
}

function padded(body, padFill = 0) {
  const remainder = body.length % blockBytes;
  if (remainder === 0) {
    return body;
  }
  return Buffer.concat([
    body,
    Buffer.alloc(blockBytes - remainder, padFill),
  ]);
}

function member(options) {
  const body =
    options.body === undefined
      ? Buffer.alloc(0)
      : Buffer.isBuffer(options.body)
        ? options.body
        : Buffer.from(options.body, "utf8");
  const declaredSize =
    options.size === undefined ? body.length : options.size;
  const header = tarHeader({ ...options, size: declaredSize });
  if (body.length === 0) {
    return header;
  }
  return Buffer.concat([
    header,
    padded(body, options.padFill ?? 0),
  ]);
}

const validManifest = JSON.stringify({
  name: "@genii-foundation/probe",
  version: "1.0.0",
  repository: { directory: "packages/probe" },
});

// A minimal well-formed archive: one manifest member plus the two end blocks.
function wellFormedTar(extraMembers = []) {
  return Buffer.concat([
    ...extraMembers,
    member({
      name: PACKED_MANIFEST_PATH,
      body: validManifest,
    }),
    zeroBlock(),
    zeroBlock(),
  ]);
}

// Windows without developer mode, and some mounted filesystems, refuse link
// creation outright. The link-rejection tests are the reason this suite runs in
// the cross-platform matrix, so they skip on the exact capability codes rather
// than failing the platform.
const linkCapabilityUnavailableCodes = Object.freeze({
  hardLink: new Set([
    "EACCES",
    "EMLINK",
    "ENOSYS",
    "ENOTSUP",
    "EOPNOTSUPP",
    "EPERM",
  ]),
  symbolicLink: new Set([
    "EACCES",
    "ENOSYS",
    "ENOTSUP",
    "EOPNOTSUPP",
    "EPERM",
  ]),
});

function unavailableCapabilityCode(capability, error) {
  const code = error?.code;
  return typeof code === "string" &&
    linkCapabilityUnavailableCodes[capability].has(code)
    ? code
    : undefined;
}

function requireSymbolicLink(t, target, path, type) {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (error) {
    const code = unavailableCapabilityCode(
      "symbolicLink",
      error,
    );
    if (code === undefined) {
      throw error;
    }
    t.skip(`Symbolic links are unavailable (${code}).`);
    return false;
  }
}

function requireHardLink(t, existingPath, newPath) {
  try {
    linkSync(existingPath, newPath);
    return true;
  } catch (error) {
    const code = unavailableCapabilityCode("hardLink", error);
    if (code === undefined) {
      throw error;
    }
    t.skip(`Hard links are unavailable (${code}).`);
    return false;
  }
}

let workspaceCounter = 0;

function workspace(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "publisher-archive-reader-")),
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

// Writes raw TAR bytes as a gzipped archive and returns its absolute path.
function writeArchive(root, tarBytes, { gzip = true, name } = {}) {
  workspaceCounter += 1;
  const fileName =
    name ?? `candidate-${workspaceCounter}.tgz`;
  const path = join(root, fileName);
  writeFileSync(path, gzip ? gzipSync(tarBytes) : tarBytes);
  return path;
}

async function rejects(t, tarBytes, pattern, options = {}) {
  const root = options.root ?? workspace(t);
  const archivePath = writeArchive(root, tarBytes, options);
  await assert.rejects(
    async () =>
      readPackageArchive({
        archivePath,
        captureFile: () => true,
        ...options.readerOptions,
      }),
    pattern,
  );
}

// ------------------------------------------------------------ happy paths

test("a well formed archive reports exact identity and inventory", async (t) => {
  const root = workspace(t);
  const tarBytes = wellFormedTar([
    member({ name: "package/dist/index.js", body: "export const x = 1;\n" }),
  ]);
  const archivePath = writeArchive(root, tarBytes);
  const bytes = await fileSystemPromises.readFile(archivePath);

  const archive = await readPackageArchive({
    archivePath,
    captureFile: () => true,
  });

  assert.equal(archive.archivePath, archivePath);
  assert.equal(archive.candidateDirectory, root);
  assert.equal(archive.size, bytes.length);
  assert.equal(archive.sha256, sha256(bytes));
  assert.equal(
    archive.shasum,
    createHash("sha1").update(bytes).digest("hex"),
  );
  assert.equal(
    archive.integrity,
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  );
  assert.equal(archive.fileCount, archive.files.length);
  assert.equal(archive.fileCount, 2);
  assert.deepEqual(archive.files, [
    "package/dist/index.js",
    PACKED_MANIFEST_PATH,
  ]);
  assert.deepEqual(
    [...archive.files],
    [...archive.files].sort(),
    "files must be sorted by UTF-16 code unit order",
  );
  assert.ok(Object.isFrozen(archive));
  assert.ok(Object.isFrozen(archive.entries));
  assert.ok(Object.isFrozen(archive.entries[0]));

  const manifest = archive.entries.find(
    ({ path }) => path === PACKED_MANIFEST_PATH,
  );
  assert.equal(manifest.type, "file");
  assert.equal(manifest.size, Buffer.byteLength(validManifest));
  assert.equal(
    manifest.sha256,
    sha256(Buffer.from(validManifest, "utf8")),
  );
  assert.equal(
    manifest.bytes.toString("utf8"),
    validManifest,
  );
});

test("captureFile selects arbitrary members and unselected bodies are still hashed", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(
    root,
    wellFormedTar([
      member({ name: "package/dist/node-path.txt", body: "/usr/bin/node\n" }),
      member({ name: "package/dist/other.txt", body: "ignored\n" }),
    ]),
  );

  const archive = await readPackageArchive({
    archivePath,
    captureFile: ({ path }) =>
      path === "package/dist/node-path.txt",
  });

  const selected = archive.entries.find(
    ({ path }) => path === "package/dist/node-path.txt",
  );
  const unselected = archive.entries.find(
    ({ path }) => path === "package/dist/other.txt",
  );

  assert.equal(
    selected.bytes.toString("utf8").trim(),
    "/usr/bin/node",
  );
  assert.equal(unselected.bytes, undefined);
  assert.equal(
    unselected.sha256,
    sha256(Buffer.from("ignored\n", "utf8")),
    "an unselected member is still read in full and hashed",
  );
  assert.equal(
    archive.entries.find(
      ({ path }) => path === PACKED_MANIFEST_PATH,
    ).bytes,
    undefined,
  );
});

test("captureFile receives the member path, type, and declared size", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(
    root,
    wellFormedTar([
      member({ name: "package/a.txt", body: "abc" }),
      member({ name: "package/lib/", typeFlag: "5" }),
    ]),
  );
  const observed = [];
  await readPackageArchive({
    archivePath,
    captureFile: (entry) => {
      observed.push(entry);
      return false;
    },
  });
  assert.deepEqual(
    observed.sort((left, right) =>
      left.path < right.path ? -1 : 1,
    ),
    [
      { path: "package/a.txt", type: "file", size: 3 },
      {
        path: PACKED_MANIFEST_PATH,
        type: "file",
        size: Buffer.byteLength(validManifest),
      },
    ],
    "captureFile is consulted for regular files only",
  );
});

test("directory members keep the listing separator while entries keep the logical path", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(
    root,
    wellFormedTar([
      member({ name: "package/", typeFlag: "5" }),
      member({ name: "package/dist/", typeFlag: "5" }),
      member({ name: "package/dist/index.js", body: "x" }),
    ]),
  );
  const archive = await readPackageArchive({ archivePath });

  assert.deepEqual(archive.files, [
    "package/",
    "package/dist/",
    "package/dist/index.js",
    PACKED_MANIFEST_PATH,
  ]);
  assert.equal(archive.fileCount, 4);
  const directories = archive.entries
    .filter(({ type }) => type === "directory")
    .map(({ path }) => path);
  assert.deepEqual(
    directories,
    ["package", "package/dist"],
    "entries carry the logical path with no trailing separator",
  );
});

test("a member body that is not valid UTF-8 is hashed without being decoded", async (t) => {
  const root = workspace(t);
  const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x41]);
  const archivePath = writeArchive(
    root,
    wellFormedTar([
      member({ name: "package/image.png", body: binary }),
    ]),
  );
  const archive = await readPackageArchive({
    archivePath,
    captureFile: () => true,
  });
  const entry = archive.entries.find(
    ({ path }) => path === "package/image.png",
  );
  assert.equal(entry.sha256, sha256(binary));
  assert.deepEqual([...entry.bytes], [...binary]);
});

test("a zero byte member is accepted and hashed as empty", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(
    root,
    wellFormedTar([member({ name: "package/empty.txt", body: "" })]),
  );
  const archive = await readPackageArchive({
    archivePath,
    captureFile: () => true,
  });
  const entry = archive.entries.find(
    ({ path }) => path === "package/empty.txt",
  );
  assert.equal(entry.size, 0);
  assert.equal(entry.bytes.length, 0);
  assert.equal(entry.sha256, sha256(Buffer.alloc(0)));
});

test("extra zero blocks after the end marker are tolerated for a blocking factor", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(
    root,
    Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      zeroBlock(),
      zeroBlock(),
      zeroBlock(),
      zeroBlock(),
      zeroBlock(),
    ]),
  );
  const archive = await readPackageArchive({ archivePath });
  assert.equal(archive.fileCount, 1);
});

// --------------------------------------------------------- member policy

test("every disallowed member type is rejected", async (t) => {
  const cases = [
    ["symlink", "2", "package/link", "package/package.json"],
    ["hard link", "1", "package/hard", "package/package.json"],
    ["character device", "3", "package/chr", ""],
    ["block device", "4", "package/blk", ""],
    ["FIFO", "6", "package/fifo", ""],
    ["contiguous file", "7", "package/contig", ""],
    ["unknown type flag", "Z", "package/unknown", ""],
  ];
  for (const [label, typeFlag, name, linkName] of cases) {
    await rejects(
      t,
      wellFormedTar([member({ name, typeFlag, linkName })]),
      /unsupported/u,
      { name: `type-${typeFlag}.tgz` },
    );
    assert.ok(label);
  }
});

test("a regular file that also declares a link target is rejected", async (t) => {
  await rejects(
    t,
    Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
        linkName: "../../etc/passwd",
      }),
      zeroBlock(),
      zeroBlock(),
    ]),
    /declares a link target/u,
  );
});

test("archive metadata members are refused before the parser sees them", async (t) => {
  for (const [label, typeFlag] of [
    ["PAX extended header", "x"],
    ["PAX global header", "g"],
    ["GNU long path", "L"],
    ["GNU long link path", "K"],
  ]) {
    await rejects(
      t,
      wellFormedTar([
        member({
          name: "././@LongLink",
          typeFlag,
          body: "package/whatever\0",
        }),
      ]),
      new RegExp(`unsupported ${label} member`, "u"),
    );
  }
});

test("a directory member declaring a body is rejected before it can desynchronize the parser", async (t) => {
  // tar-stream emits a directory entry without skipping a declared body, so the
  // next 512 bytes would be parsed as a header. The raw auditor refuses first.
  await rejects(
    t,
    Buffer.concat([
      tarHeader({ name: "package/lib/", typeFlag: "5", size: 512 }),
      zeroBlock(0x41),
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      zeroBlock(),
      zeroBlock(),
    ]),
    /directory member declares a nonzero body size/u,
  );
});

test("a member declaring more bytes than the per member ceiling is rejected", async (t) => {
  await rejects(
    t,
    Buffer.concat([
      tarHeader({
        name: "package/huge.bin",
        size: ARCHIVE_LIMITS.memberBytes + 1,
      }),
      zeroBlock(),
      zeroBlock(),
    ]),
    /above the 67108864 byte member ceiling/u,
  );
});

// ----------------------------------------------------------- path policy

test("unsafe member paths are rejected", async (t) => {
  const cases = [
    ["absolute", { name: "/package/x" }, /is absolute|outside the exact/u],
    ["outside the prefix", { name: "other/x" }, /outside the exact/u],
    ["dot segment", { name: "package/./x" }, /dot or dot-dot segment/u],
    ["dot dot segment", { name: "package/../x" }, /dot or dot-dot segment/u],
    ["empty segment", { name: "package//x" }, /empty segment/u],
    ["backslash", { name: "package/a\\b" }, /reserved character/u],
    ["colon", { name: "package/a:b" }, /reserved character/u],
    ["asterisk", { name: "package/a*b" }, /reserved character/u],
    ["pipe", { name: "package/a|b" }, /reserved character/u],
    ["question mark", { name: "package/a?b" }, /reserved character/u],
    ["less than", { name: "package/a<b" }, /reserved character/u],
    ["quote", { name: 'package/a"b' }, /reserved character/u],
    ["trailing dot", { name: "package/a." }, /ends with a dot or a space/u],
    ["trailing space", { name: "package/a " }, /ends with a dot or a space/u],
    [
      "trailing dot on a middle segment",
      { name: "package/a./b" },
      /ends with a dot or a space/u,
    ],
    [
      "non-ASCII",
      { name: "package/café.txt" },
      /non-ASCII character/u,
    ],
  ];
  for (const [label, options, pattern] of cases) {
    await rejects(
      t,
      wellFormedTar([member({ ...options, body: "x" })]),
      pattern,
    );
    assert.ok(label);
  }
});

test("a member name carrying invalid UTF-8 is rejected as a replacement character", async (t) => {
  // tar-stream decodes names with lossy UTF-8, so invalid bytes arrive as U+FFFD.
  const nameBytes = Buffer.concat([
    Buffer.from("package/", "utf8"),
    Buffer.from([0xff, 0xfe]),
  ]);
  await rejects(
    t,
    wellFormedTar([member({ name: "unused", nameBytes, body: "x" })]),
    /replacement character, so the archive carried an invalid UTF-8 member name/u,
  );
});

test("a member name carrying a control character is rejected", async (t) => {
  const nameBytes = Buffer.from("package/a\nb", "utf8");
  await rejects(
    t,
    wellFormedTar([member({ name: "unused", nameBytes, body: "x" })]),
    /control character/u,
  );
});

test("duplicate member paths are rejected", async (t) => {
  await rejects(
    t,
    wellFormedTar([
      member({ name: "package/a.txt", body: "one" }),
      member({ name: "package/a.txt", body: "two" }),
    ]),
    /declares "package\/a\.txt" twice/u,
  );
});

test("paths colliding only by case are rejected under portable identity", async (t) => {
  await rejects(
    t,
    wellFormedTar([
      member({ name: "package/README.md", body: "one" }),
      member({ name: "package/readme.md", body: "two" }),
    ]),
    /collide under portable path identity/u,
  );
});

test("a path declared as both a file and a directory is rejected", async (t) => {
  await rejects(
    t,
    wellFormedTar([
      member({ name: "package/lib", body: "file" }),
      member({ name: "package/lib/", typeFlag: "5" }),
    ]),
    /as both a file and a directory/u,
  );
});

test("a member nested under a file is rejected", async (t) => {
  await rejects(
    t,
    wellFormedTar([
      member({ name: "package/lib", body: "file" }),
      member({ name: "package/lib/deep.js", body: "nested" }),
    ]),
    /nests .* under the file/u,
  );
});

test("a member nested under a file whose case differs is rejected", async (t) => {
  // The ancestor check must fold case like every other collision rule. With an
  // exact-case lookup this archive is accepted, and on a case-insensitive
  // filesystem `tar -xzf` then fails with "Not a directory", leaving an attested
  // member absent from disk.
  await rejects(
    t,
    wellFormedTar([
      member({ name: "package/Foo", body: "outer file\n" }),
      member({ name: "package/foo/bar", body: "nested\n" }),
    ]),
    /nests "package\/foo\/bar" under the file "package\/Foo"/u,
  );
  // Order independence: the conflict is resolved after every member is read.
  await rejects(
    t,
    wellFormedTar([
      member({ name: "package/foo/bar", body: "nested\n" }),
      member({ name: "package/Foo", body: "outer file\n" }),
    ]),
    /nests "package\/foo\/bar" under the file "package\/Foo"/u,
  );
  // The same escape through the ustar prefix field.
  await rejects(
    t,
    wellFormedTar([
      member({ name: "package/Lib", body: "outer file\n" }),
      member({
        name: "i.js",
        prefix: "package/lib",
        body: "nested\n",
      }),
    ]),
    /nests "package\/lib\/i\.js" under the file "package\/Lib"/u,
  );
});

test("reserved Windows device names are rejected in any segment", async (t) => {
  for (const name of [
    "package/nul",
    "package/NUL",
    "package/nul.txt",
    "package/con",
    "package/aux.js",
    "package/prn",
    "package/com1",
    "package/lpt9.log",
    "package/aux/index.js",
  ]) {
    await rejects(
      t,
      wellFormedTar([member({ name, body: "swallowed\n" })]),
      /is a reserved Windows device name/u,
    );
  }
});

test("names that merely resemble reserved device names are accepted", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(
    root,
    wellFormedTar([
      member({ name: "package/console.js", body: "a" }),
      member({ name: "package/nullable.ts", body: "b" }),
      member({ name: "package/com.js", body: "c" }),
      member({ name: "package/com10.js", body: "d" }),
      member({ name: "package/auxiliary/index.js", body: "e" }),
      member({ name: "package/lpt0", body: "f" }),
    ]),
  );
  const archive = await readPackageArchive({ archivePath });
  assert.equal(archive.fileCount, 7);
});

test("a ustar prefix is joined into the member path", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(
    root,
    wellFormedTar([
      member({
        name: "deep.js",
        prefix: "package/nested",
        body: "prefixed",
      }),
    ]),
  );
  const archive = await readPackageArchive({ archivePath });
  assert.ok(
    archive.files.includes("package/nested/deep.js"),
    `expected the prefix to be joined, saw ${JSON.stringify(archive.files)}`,
  );
});

// -------------------------------------------------------- manifest policy

test("an archive without the packed manifest is rejected", async (t) => {
  await rejects(
    t,
    Buffer.concat([
      member({ name: "package/only.txt", body: "x" }),
      zeroBlock(),
      zeroBlock(),
    ]),
    /omits package\/package\.json/u,
  );
});

test("an archive declaring the packed manifest twice is rejected", async (t) => {
  // Two manifests would also trip duplicate detection, so this proves the
  // manifest count is checked on its own terms.
  await rejects(
    t,
    Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      zeroBlock(),
      zeroBlock(),
    ]),
    /declares "package\/package\.json" twice|declares package\/package\.json 2 times/u,
  );
});

test("a packed manifest above its own ceiling is rejected", async (t) => {
  await rejects(
    t,
    Buffer.concat([
      tarHeader({
        name: PACKED_MANIFEST_PATH,
        size: ARCHIVE_LIMITS.manifestBytes + 1,
      }),
      zeroBlock(),
      zeroBlock(),
    ]),
    /above the 1048576 byte ceiling/u,
  );
});

// ------------------------------------------------------ stream structure

test("bytes outside the single gzip member are refused rather than attested unexamined", async (t) => {
  // Hashing every byte proves what the artifact contains. It does not prove
  // every byte was examined. `createGunzip` decompresses the first member and
  // discards trailing input, treating a leading zero byte as padding, so a file
  // shaped [benign member][0x00][second member] yields only the benign tar. The
  // auditor never sees the tail, the inventory omits it, the leak scan never
  // decodes it, and a consumer still recovers it with `gunzip`.
  const root = workspace(t);
  const benignTar = wellFormedTar([
    member({ name: "package/index.js", body: "export const ok = 1;\n" }),
  ]);
  const benign = gzipSync(benignTar);
  const smuggled = gzipSync(
    wellFormedTar([
      member({
        name: "package/PROPRIETARY-SOURCE.ts",
        body: 'const LICENCE_KEY = "leaked";\n'.repeat(500),
      }),
    ]),
  );

  // The clean article still reads.
  const cleanPath = join(root, "clean.tgz");
  writeFileSync(cleanPath, benign);
  const clean = await readPackageArchive({
    archivePath: cleanPath,
    captureFile: () => true,
  });
  assert.equal(clean.fileCount, 2);

  const trailerPattern =
    /carries bytes outside its single gzip member/u;
  for (const [label, tail, pattern] of [
    [
      "a second gzip member behind a padding byte",
      Buffer.concat([Buffer.from([0]), smuggled]),
      trailerPattern,
    ],
    [
      "arbitrary bytes behind a padding byte",
      Buffer.concat([
        Buffer.from([0]),
        Buffer.alloc(32768, 0xaa),
      ]),
      trailerPattern,
    ],
    [
      "a long run of padding",
      Buffer.alloc(64 * 1024, 0),
      trailerPattern,
    ],
    [
      "arbitrary bytes with no padding byte",
      Buffer.alloc(16, 0xaa),
      /incorrect header check|carries bytes outside its single gzip member/u,
    ],
    [
      "a directly concatenated second member",
      smuggled,
      /data after its end-of-archive blocks|carries bytes outside its single gzip member/u,
    ],
  ]) {
    const archivePath = join(
      root,
      `tail-${label.replace(/[^a-z0-9]+/giu, "-")}.tgz`,
    );
    writeFileSync(archivePath, Buffer.concat([benign, tail]));
    await assert.rejects(
      async () =>
        readPackageArchive({
          archivePath,
          captureFile: () => true,
        }),
      pattern,
      `expected ${label} to be refused`,
    );
  }
});

test("an archive that does not begin with a gzip member is refused", async (t) => {
  const root = workspace(t);
  const archivePath = join(root, "not-gzip.tgz");
  // A valid deflate stream with no gzip wrapper reaches the decoder but carries
  // no magic and no trailer.
  writeFileSync(archivePath, Buffer.from("PK not a gzip member"));
  await assert.rejects(
    async () => readPackageArchive({ archivePath }),
    /does not begin with a gzip member|could not be decompressed and parsed/u,
  );
});

test("a corrupt gzip stream is rejected", async (t) => {
  await rejects(
    t,
    Buffer.from("this is definitely not gzip"),
    /incorrect header check|unknown compression method/u,
    { gzip: false },
  );
});

test("a truncated archive is rejected", async (t) => {
  await rejects(
    t,
    Buffer.concat([
      tarHeader({ name: PACKED_MANIFEST_PATH, size: 600 }),
      Buffer.alloc(100, 0x7b),
    ]),
    /Unexpected end of data|ends with a partial 512 byte block|ends inside a member body/u,
  );
});

test("an archive with no end of archive blocks is rejected", async (t) => {
  await rejects(
    t,
    member({
      name: PACKED_MANIFEST_PATH,
      body: validManifest,
    }),
    /omits the two required end-of-archive blocks/u,
  );
});

test("an archive with a single end of archive block is rejected", async (t) => {
  await rejects(
    t,
    Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      zeroBlock(),
    ]),
    /omits the two required end-of-archive blocks/u,
  );
});

test("a member smuggled after the end of archive blocks is rejected", async (t) => {
  // tar-stream parses and yields this member, so nothing downstream would
  // notice that it sits outside the archive proper.
  await rejects(
    t,
    Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      zeroBlock(),
      zeroBlock(),
      member({ name: "package/smuggled.txt", body: "gotcha" }),
      zeroBlock(),
      zeroBlock(),
    ]),
    /data after its end-of-archive blocks/u,
  );
});

test("nonzero member padding is rejected", async (t) => {
  await rejects(
    t,
    Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
        padFill: 0x41,
      }),
      zeroBlock(),
      zeroBlock(),
    ]),
    /padding contains nonzero bytes/u,
  );
});

test("an end of archive block carrying data in its checksum field is rejected", async (t) => {
  // tar-stream's checksum routine skips bytes 148 through 155, so an otherwise
  // zero block with data there reads as an end block and the data is invisible.
  const smuggled = zeroBlock();
  smuggled.write("DEADBEEF", 148, 8, "ascii");
  await rejects(
    t,
    Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      smuggled,
      zeroBlock(),
    ]),
    /carries data in its checksum field/u,
  );
});

test("a stream that is not a multiple of 512 bytes is rejected", async (t) => {
  await rejects(
    t,
    Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      zeroBlock(),
      zeroBlock(),
      Buffer.alloc(7, 0),
    ]),
    /partial 512 byte block/u,
  );
});

test("a corrupt header checksum is rejected", async (t) => {
  const broken = tarHeader({
    name: PACKED_MANIFEST_PATH,
    size: 0,
  });
  broken.write("00000000", 148, 8, "ascii");
  await rejects(
    t,
    Buffer.concat([broken, zeroBlock(), zeroBlock()]),
    /Invalid tar header/u,
  );
});

test("an unknown archive format is rejected", async (t) => {
  await rejects(
    t,
    Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
        magic: "xxxxx\0",
      }),
      zeroBlock(),
      zeroBlock(),
    ]),
    /unknown format/u,
  );
});

// tar-stream's own numeric field decoder, transcribed verbatim from
// node_modules/tar-stream/headers.js so it can serve as a differential oracle.
// If a dependency update changes it, this copy and the real one diverge and the
// test below fails, which is the point.
function parserIndexOf(block, num, offset, end) {
  for (; offset < end; offset += 1) {
    if (block[offset] === num) {
      return offset;
    }
  }
  return end;
}

function parserClamp(index, length, defaultValue) {
  if (typeof index !== "number") {
    return defaultValue;
  }
  index = ~~index;
  if (index >= length) {
    return length;
  }
  if (index >= 0) {
    return index;
  }
  index += length;
  if (index >= 0) {
    return index;
  }
  return 0;
}

function parserParse256(buf) {
  let positive;
  if (buf[0] === 0x80) {
    positive = true;
  } else if (buf[0] === 0xff) {
    positive = false;
  } else {
    return null;
  }
  const tuple = [];
  for (let index = buf.length - 1; index > 0; index -= 1) {
    const byte = buf[index];
    tuple.push(positive ? byte : 0xff - byte);
  }
  let sum = 0;
  for (let index = 0; index < tuple.length; index += 1) {
    sum += tuple[index] * Math.pow(256, index);
  }
  return positive ? sum : -1 * sum;
}

function parserDecodeOct(value, offset, length) {
  value = value.subarray(offset, offset + length);
  offset = 0;
  if (value[offset] & 0x80) {
    return parserParse256(value);
  }
  while (offset < value.length && value[offset] === 32) {
    offset += 1;
  }
  const end = parserClamp(
    parserIndexOf(value, 32, offset, value.length),
    value.length,
    value.length,
  );
  while (offset < end && value[offset] === 0) {
    offset += 1;
  }
  if (end === offset) {
    return 0;
  }
  return Number.parseInt(
    value.subarray(offset, end).toString("latin1"),
    8,
  );
}

test("the size decoder never disagrees with the parser about a member size", async () => {
  // The auditor and the parser walk the same bytes independently. Returning a
  // DIFFERENT number than the parser desynchronizes the two and lets an attacker
  // choose bytes the auditor will treat as a header. Returning a value that
  // fails the range check is safe, because the archive is then refused. So the
  // contract is: equal, or refused. Never different.
  const fields = [];
  const push = (bytes) => {
    const field = Buffer.alloc(12);
    Buffer.from(bytes).copy(field, 0);
    fields.push(field);
  };

  // Hand-picked shapes, including the exact case that was wrong.
  push([0x00, 0x00, 0x31, 0x30, 0x30, 0x30]);
  push([0x00, 0x34, 0x30, 0x30, 0x30]);
  push([0x20, 0x00, 0x31, 0x30, 0x30, 0x30]);
  push([0x31, 0x30, 0x30, 0x30, 0x00]);
  push([0x31, 0x30, 0x30, 0x30, 0x20]);
  push([0x31, 0x30, 0x00, 0x37]);
  push([0x20, 0x20, 0x20, 0x31, 0x30]);
  push([0x30, 0x38]);
  push([0x38, 0x39]);
  push([0x2d, 0x31, 0x30]);
  push([0x2b, 0x31, 0x30]);
  push([]);
  push([0x20]);
  push([0x80, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0]);
  push([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  push([0x81, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  push([0x37, 0x37, 0x37, 0x37, 0x37, 0x37, 0x37, 0x37, 0x37, 0x37, 0x37, 0x37]);

  // Deterministic adversarial corpus over the bytes that actually matter.
  const alphabet = [0x00, 0x20, 0x30, 0x31, 0x37, 0x38, 0x39, 0x41, 0x80, 0xff];
  let seed = 1;
  const nextByte = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return alphabet[seed % alphabet.length];
  };
  for (let index = 0; index < 4000; index += 1) {
    const length = 1 + (index % 12);
    const bytes = [];
    for (let position = 0; position < length; position += 1) {
      bytes.push(nextByte());
    }
    push(bytes);
  }

  // The only unsafe outcome is that both decoders accept a field and disagree
  // about its value, because then the two cursors diverge while both keep
  // walking. If either side refuses, the archive is refused and nothing is
  // smuggled, so a decoder that is merely stricter than the parser is safe.
  let agreed = 0;
  let strictHere = 0;
  for (const field of fields) {
    const block = Buffer.alloc(512);
    field.copy(block, 124);
    const mine = decodeTarNumericField(block, 124, 12);
    const theirs = parserDecodeOct(block, 124, 12);

    const iAccept = Number.isSafeInteger(mine) && mine >= 0;
    const theyAccept =
      theirs !== null &&
      Number.isSafeInteger(theirs) &&
      theirs >= 0;

    if (iAccept && theyAccept) {
      assert.equal(
        mine,
        theirs,
        `size disagreement on ${JSON.stringify([...field])}, which would desynchronize the auditor from the parser`,
      );
      agreed += 1;
      continue;
    }
    if (!iAccept) {
      strictHere += 1;
    }
  }
  assert.ok(
    agreed > 1000,
    `expected a meaningful number of agreeing comparisons, saw ${agreed}`,
  );
  assert.ok(
    strictHere > 0,
    "expected at least one field the auditor refuses outright",
  );
});

test("a size field with a leading NUL does not desynchronize the auditor from the parser", async (t) => {
  // The parser terminates the numeric field at the first space and then skips
  // leading NULs, so this field is 512 bytes to it. An auditor that read it as 0
  // would treat the following block as a header and skip whatever body that
  // block declared, leaving an attacker-chosen run of the archive unaudited.
  //
  // With the two decoders in agreement this archive is simply a valid one whose
  // single member happens to contain 512 bytes that look like a header. The
  // assertion is therefore agreement, not rejection: the member is reported once,
  // its body is those exact bytes, and every block is accounted for.
  const forked = tarHeader({ name: "package/decoy", size: 0 });
  forked.fill(0, 124, 136);
  Buffer.from([0x00, 0x00, 0x31, 0x30, 0x30, 0x30]).copy(
    forked,
    124,
  );
  forked.write("        ", 148, 8, "ascii");
  forked.write(octalField(checksum(forked), 8), 148, 8, "ascii");

  // The block a desynchronized auditor would have parsed as a header, claiming a
  // body large enough to hide the rest of the archive.
  const phantom = tarHeader({
    name: "package/phantom",
    size: 1536,
  });

  const root = workspace(t);
  const archivePath = writeArchive(
    root,
    Buffer.concat([
      forked,
      phantom,
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      zeroBlock(),
      zeroBlock(),
    ]),
  );
  const archive = await readPackageArchive({
    archivePath,
    captureFile: () => true,
  });

  assert.deepEqual(archive.files, [
    "package/decoy",
    PACKED_MANIFEST_PATH,
  ]);
  const decoy = archive.entries.find(
    ({ path }) => path === "package/decoy",
  );
  assert.equal(
    decoy.size,
    512,
    "the auditor must read the same size the parser reads",
  );
  assert.equal(
    decoy.sha256,
    sha256(phantom),
    "the phantom header block must be attested as ordinary file content",
  );
  assert.ok(
    !archive.files.includes("package/phantom"),
    "the phantom header must never become a member of its own",
  );
});

test("every GNU long path type flag spelling is refused", async (t) => {
  // tar-stream maps type flag values 28 and 30 to gnu-long-path, so header bytes
  // 0x4c and 0x4e are equivalent to it. Banning only one leaves the ban
  // bypassable by a single byte, which is why the auditor allowlists instead.
  for (const [label, typeFlag] of [
    ["L", "L"],
    ["N", "N"],
  ]) {
    await rejects(
      t,
      Buffer.concat([
        member({
          name: PACKED_MANIFEST_PATH,
          body: validManifest,
        }),
        member({
          name: "package/ignore-me",
          typeFlag,
          body:
            "package/lib/renamed-by-a-header-the-auditor-must-refuse.js\0",
        }),
        member({ name: "package/innocent.js", body: "hi\n" }),
        zeroBlock(),
        zeroBlock(),
      ]),
      /unsupported GNU long path member/u,
      { name: `long-path-${label}.tgz` },
    );
  }
});

test("no unlisted type flag reaches the parser", async (t) => {
  // Sweep every byte value that is not an allowed type flag and confirm the raw
  // auditor refuses it, so a future tar-stream release cannot give a new meaning
  // to a flag this boundary never considered.
  const allowed = new Set([0x00, 0x30, 0x35]);
  for (let byte = 0; byte < 256; byte += 1) {
    if (allowed.has(byte)) {
      continue;
    }
    const header = tarHeader({ name: "package/probe", size: 0 });
    header[156] = byte;
    header.write("        ", 148, 8, "ascii");
    header.write(octalField(checksum(header), 8), 148, 8, "ascii");
    const root = workspace(t);
    const archivePath = writeArchive(
      root,
      Buffer.concat([
        header,
        member({
          name: PACKED_MANIFEST_PATH,
          body: validManifest,
        }),
        zeroBlock(),
        zeroBlock(),
      ]),
    );
    await assert.rejects(
      async () => readPackageArchive({ archivePath }),
      /unsupported/u,
      `type flag byte 0x${byte.toString(16)} must be refused`,
    );
  }
});

test("the raw auditor reaches the same verdict at every chunk size", async () => {
  // The auditor carries a partial block across chunk boundaries. If that carry
  // were wrong, a header split across two chunks could be mis-parsed, and the
  // auditor's cursor would drift from the parser's. Every structural case must
  // therefore produce an identical verdict regardless of how the bytes arrive.
  const cases = [
    ["valid", wellFormedTar([
      member({ name: "package/a.txt", body: "x".repeat(700) }),
    ]), true],
    ["nonzero padding", Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
        padFill: 0x41,
      }),
      zeroBlock(),
      zeroBlock(),
    ]), false],
    ["smuggled after the end", Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      zeroBlock(),
      zeroBlock(),
      member({ name: "package/evil.txt", body: "boo" }),
      zeroBlock(),
      zeroBlock(),
    ]), false],
    ["single end block", Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      zeroBlock(),
    ]), false],
    ["directory declaring a body", Buffer.concat([
      tarHeader({
        name: "package/lib/",
        typeFlag: "5",
        size: blockBytes,
      }),
      zeroBlock(0x41),
      zeroBlock(),
      zeroBlock(),
    ]), false],
    ["trailing partial block", Buffer.concat([
      member({
        name: PACKED_MANIFEST_PATH,
        body: validManifest,
      }),
      zeroBlock(),
      zeroBlock(),
      Buffer.alloc(9),
    ]), false],
  ];

  const chunkSizes = [
    1,
    2,
    3,
    7,
    63,
    511,
    512,
    513,
    1023,
    1024,
    1025,
    4096,
  ];

  async function audit(parts) {
    const auditor = createRawTarAuditor({
      archivePath: "/probe.tgz",
    });
    await pipeline(
      Readable.from(parts),
      auditor,
      async function* drain(source) {
        for await (const chunk of source) {
          void chunk;
        }
      },
    );
  }

  for (const [label, bytes, shouldPass] of cases) {
    const verdicts = new Set();
    const chunkings = [[bytes]];
    for (const size of chunkSizes) {
      const parts = [];
      for (let start = 0; start < bytes.length; start += size) {
        parts.push(
          bytes.subarray(
            start,
            Math.min(start + size, bytes.length),
          ),
        );
      }
      chunkings.push(parts);
    }
    for (const parts of chunkings) {
      try {
        await audit(parts);
        verdicts.add("accepted");
      } catch (error) {
        verdicts.add(`refused:${error.message.split(":")[0]}`);
      }
    }
    assert.equal(
      verdicts.size,
      1,
      `${label} produced chunk-dependent verdicts: ${JSON.stringify([...verdicts])}`,
    );
    assert.equal(
      [...verdicts][0] === "accepted",
      shouldPass,
      `${label} reached the wrong verdict: ${JSON.stringify([...verdicts])}`,
    );
  }
});

test("the raw auditor enforces its decompressed byte ceiling", async (t) => {
  const auditor = createRawTarAuditor({
    archivePath: "/probe.tgz",
    maximumBytes: 1024,
  });
  const failure = new Promise((resolve) => {
    auditor.on("error", resolve);
  });
  auditor.resume();
  auditor.end(Buffer.alloc(2048, 0));
  const error = await failure;
  assert.match(
    error.message,
    /exceeds the 1024 decompressed byte ceiling/u,
  );
});

// ------------------------------------------------------- filesystem gates

test("a symbolic link to a real candidate is rejected", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(root, wellFormedTar());
  const linked = join(root, "linked.tgz");
  if (!requireSymbolicLink(t, archivePath, linked, "file")) {
    return;
  }
  await assert.rejects(
    async () => readPackageArchive({ archivePath: linked }),
    /must be a regular file/u,
  );
});

test("a multiply linked candidate is rejected", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(root, wellFormedTar());
  const hardLinked = join(root, "hard-linked.tgz");
  if (!requireHardLink(t, archivePath, hardLinked)) {
    return;
  }
  await assert.rejects(
    async () => readPackageArchive({ archivePath: hardLinked }),
    /exactly one hard link/u,
  );
});

test("a non canonical path is rejected rather than canonicalized", async (t) => {
  const root = workspace(t);
  const real = join(root, "real");
  mkdirSync(real);
  const archivePath = writeArchive(real, wellFormedTar());
  const linkedDirectory = join(root, "linked");
  if (
    !requireSymbolicLink(t, real, linkedDirectory, "dir")
  ) {
    return;
  }
  await assert.rejects(
    async () =>
      readPackageArchive({
        archivePath: join(
          linkedDirectory,
          archivePath.slice(real.length + 1),
        ),
      }),
    /must not traverse a symbolic link and must already be canonical/u,
  );
});

test("a relative path is refused", async () => {
  await assert.rejects(
    async () =>
      readPackageArchive({ archivePath: "relative/candidate.tgz" }),
    /requires one absolute archivePath/u,
  );
});

test("an empty candidate is refused", async (t) => {
  const root = workspace(t);
  const archivePath = join(root, "empty.tgz");
  writeFileSync(archivePath, Buffer.alloc(0));
  await assert.rejects(
    async () => readPackageArchive({ archivePath }),
    /is empty/u,
  );
});

test("a directory is refused", async (t) => {
  const root = workspace(t);
  await assert.rejects(
    async () => readPackageArchive({ archivePath: root }),
    /must be a regular file/u,
  );
});

test("a read only candidate is still readable", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(root, wellFormedTar());
  chmodSync(archivePath, 0o400);
  const archive = await readPackageArchive({ archivePath });
  assert.equal(archive.fileCount, 1);
});

// ------------------------------------------------------- single pass proof

test("exactly one descriptor is opened and read once per inspection", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(
    root,
    wellFormedTar([
      member({ name: "package/a.txt", body: "a".repeat(5000) }),
    ]),
  );

  const realOpen = fileSystemPromises.open;
  let opens = 0;
  let streams = 0;
  fileSystemPromises.open = async (...args) => {
    opens += 1;
    const handle = await realOpen(...args);
    const create = handle.createReadStream.bind(handle);
    handle.createReadStream = (...streamArgs) => {
      streams += 1;
      return create(...streamArgs);
    };
    return handle;
  };
  t.after(() => {
    fileSystemPromises.open = realOpen;
  });

  const archive = await readPackageArchive({
    archivePath,
    captureFile: () => true,
  });

  assert.equal(archive.fileCount, 2);
  assert.equal(opens, 1, "the archive must be opened exactly once");
  assert.equal(
    streams,
    1,
    "the single descriptor must be streamed exactly once",
  );
});

test("a candidate whose descriptor identity changes while it is read is rejected", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(root, wellFormedTar());

  const realOpen = fileSystemPromises.open;
  let statCalls = 0;
  fileSystemPromises.open = async (...args) => {
    const handle = await realOpen(...args);
    const stat = handle.stat.bind(handle);
    handle.stat = async (...statArgs) => {
      const result = await stat(...statArgs);
      statCalls += 1;
      if (statCalls === 1) {
        return result;
      }
      // Report a changed file on the closing identity check only, which is what
      // a same-path replacement between the open and the last check looks like
      // from inside the reader.
      //
      // The mutated fields have to be provably distinguishable on every
      // platform. An earlier version bumped `ino` by one, which Windows did not
      // report as a change, so the reader correctly saw no difference and the
      // test failed there for a reason that had nothing to do with the reader.
      // Size and modification time are plain numbers everywhere.
      return {
        dev: result.dev,
        ino: result.ino,
        nlink: result.nlink,
        size: result.size + 1,
        mode: result.mode,
        mtimeMs: result.mtimeMs + 1000,
        ctimeMs: result.ctimeMs,
        isFile: () => true,
      };
    };
    return handle;
  };
  t.after(() => {
    fileSystemPromises.open = realOpen;
  });

  await assert.rejects(
    async () => readPackageArchive({ archivePath }),
    /changed while it was being read/u,
  );
  // Proves the interception itself worked, so a future platform where the patch
  // silently misses reports that rather than a bare missing rejection.
  assert.ok(
    statCalls >= 2,
    `expected the reader to check descriptor identity at least twice, saw ${statCalls}`,
  );
});

test("no external archive process participates in an inspection", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(root, wellFormedTar());
  const fakeBin = join(root, "fake-bin");
  mkdirSync(fakeBin);
  const sentinel = join(root, "tar-was-executed");
  for (const name of ["tar", "gtar", "bsdtar", "gzip", "gunzip"]) {
    const executable = join(fakeBin, name);
    writeFileSync(
      executable,
      `#!/bin/sh\ntouch ${JSON.stringify(sentinel)}\nexit 0\n`,
    );
    chmodSync(executable, 0o755);
  }

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${originalPath}`;
  t.after(() => {
    process.env.PATH = originalPath;
  });

  const archive = await readPackageArchive({
    archivePath,
    captureFile: () => true,
  });

  assert.equal(archive.fileCount, 1);
  await assert.rejects(
    async () => fileSystemPromises.lstat(sentinel),
    /ENOENT/u,
    "a fake archive executable first on PATH must never be executed",
  );
});

// ------------------------------------------------------ expected identity

test("every content identity field is bound by expectedIdentity", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(
    root,
    wellFormedTar([member({ name: "package/a.txt", body: "a" })]),
  );
  const good = await readPackageArchive({ archivePath });

  const replayed = await readPackageArchive({
    archivePath,
    expectedIdentity: good,
  });
  assert.equal(replayed.sha256, good.sha256);

  const mutations = [
    ["sha256", { sha256: "sha256:00" }, /sha256 .* does not match/u],
    ["shasum", { shasum: "00" }, /shasum .* does not match/u],
    [
      "integrity",
      { integrity: "sha512-00" },
      /integrity .* does not match/u,
    ],
    ["fileCount", { fileCount: 1 }, /fileCount .* does not match/u],
    [
      "files",
      { files: ["package/nope"] },
      /member inventory does not match/u,
    ],
    [
      "size",
      { size: good.size + 1 },
      /but the expected retained identity declares/u,
    ],
  ];
  for (const [label, mutation, pattern] of mutations) {
    await assert.rejects(
      async () =>
        readPackageArchive({
          archivePath,
          expectedIdentity: { ...good, ...mutation },
        }),
      pattern,
      `expected the ${label} mismatch to reject`,
    );
  }
});

test("expectedIdentity tolerates the extra fields a package descriptor carries", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(root, wellFormedTar());
  const good = await readPackageArchive({ archivePath });

  // promoteArchives reads a freshly copied path while asserting the identity of
  // the descriptor it copied from, so archivePath and candidateDirectory must
  // never participate in the comparison.
  const archive = await readPackageArchive({
    archivePath,
    expectedIdentity: {
      ...good,
      archivePath: "/somewhere/else.tgz",
      candidateDirectory: "/somewhere",
      name: "@genii-foundation/unrelated",
      version: "9.9.9",
      root: "packages/unrelated",
      packageFiles: ["nope"],
    },
  });
  assert.equal(archive.sha256, good.sha256);
});

test("a size mismatch is refused before the archive is decompressed", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(root, wellFormedTar());
  const realOpen = fileSystemPromises.open;
  let streams = 0;
  fileSystemPromises.open = async (...args) => {
    const handle = await realOpen(...args);
    const create = handle.createReadStream.bind(handle);
    handle.createReadStream = (...streamArgs) => {
      streams += 1;
      return create(...streamArgs);
    };
    return handle;
  };
  t.after(() => {
    fileSystemPromises.open = realOpen;
  });

  await assert.rejects(
    async () =>
      readPackageArchive({
        archivePath,
        expectedIdentity: { size: 1 },
      }),
    /but the expected retained identity declares 1/u,
  );
  assert.equal(
    streams,
    0,
    "a stale size must fail before any byte is decompressed",
  );
});

test("a non object expectedIdentity is refused", async (t) => {
  const root = workspace(t);
  const archivePath = writeArchive(root, wellFormedTar());
  await assert.rejects(
    async () =>
      readPackageArchive({
        archivePath,
        expectedIdentity: "sha256:00",
      }),
    /must be an archive descriptor object/u,
  );
});

// ------------------------------------------------------------- ceilings

test("the wall clock deadline can only be tightened and it fails closed", async (t) => {
  const root = workspace(t);
  const members = [];
  for (let index = 0; index < 4000; index += 1) {
    members.push(
      member({
        name: `package/dist/module-${String(index).padStart(5, "0")}.js`,
        body: "x".repeat(400),
      }),
    );
  }
  const archivePath = writeArchive(root, wellFormedTar(members));

  await assert.rejects(
    async () =>
      readPackageArchive({
        archivePath,
        captureFile: () => true,
        deadlineMilliseconds: 1,
      }),
    /exceeded its 1 ms deadline/u,
  );

  const clamped = await readPackageArchive({
    archivePath,
    deadlineMilliseconds: ARCHIVE_LIMITS.milliseconds * 100,
  });
  assert.equal(
    clamped.fileCount,
    4001,
    "a caller cannot raise the fixed ceiling, only lower it",
  );
});

test("a many member archive is read well inside its deadline", async (t) => {
  const root = workspace(t);
  const members = [];
  for (let index = 0; index < 10000; index += 1) {
    members.push(
      member({
        name: `package/node_modules/pkg-${String(index).padStart(5, "0")}/index.js`,
        body: `module.exports = ${index};\n`,
      }),
    );
  }
  const archivePath = writeArchive(root, wellFormedTar(members));

  const started = process.hrtime.bigint();
  const archive = await readPackageArchive({
    archivePath,
    captureFile: () => true,
  });
  const elapsed =
    Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(archive.fileCount, 10001);
  assert.equal(archive.fileCount, archive.files.length);
  assert.ok(
    elapsed < ARCHIVE_LIMITS.milliseconds / 4,
    `expected a 10001 member archive to read well inside the deadline, took ${elapsed.toFixed(1)} ms`,
  );
});

test("an archive above the member ceiling is rejected", async (t) => {
  // The ceiling is checked as members arrive, so the archive does not need to
  // carry a full extra member past the limit.
  const members = [];
  for (let index = 0; index <= ARCHIVE_LIMITS.entries; index += 1) {
    members.push(
      member({
        name: `package/m/${String(index).padStart(7, "0")}`,
      }),
    );
  }
  await rejects(
    t,
    wellFormedTar(members),
    /declares more than 100000 members/u,
  );
});

test("the published ceilings are pinned", () => {
  assert.deepEqual(
    { ...ARCHIVE_LIMITS },
    {
      compressedBytes: 268435456,
      decompressedBytes: 536870912,
      entries: 100000,
      memberPathBytes: 4096,
      aggregateMemberPathBytes: 16777216,
      memberBytes: 67108864,
      manifestBytes: 1048576,
      aggregatePayloadBytes: 402653184,
      milliseconds: 60000,
    },
  );
  assert.ok(Object.isFrozen(ARCHIVE_LIMITS));
  assert.equal(maximumArchiveBytes, ARCHIVE_LIMITS.compressedBytes);
  assert.equal(maximumArchiveEntries, ARCHIVE_LIMITS.entries);
  // The receipt schema allows 10000 member paths per archive and 500 characters
  // per path. The reader is deliberately more permissive so it never rejects an
  // archive a valid receipt could describe, and the real structural bound is
  // narrower still: refusing PAX and GNU long path members caps a ustar member
  // path at 255 bytes.
  assert.ok(ARCHIVE_LIMITS.entries > 10000);
  assert.ok(ARCHIVE_LIMITS.memberPathBytes > 500);
});

// ------------------------------------------------------ manifest parsing

test("the packed manifest parser refuses invalid UTF-8", () => {
  assert.throws(
    () =>
      parsePackedManifestJson(
        Buffer.concat([
          Buffer.from('{"name":"', "utf8"),
          Buffer.from([0xff, 0xfe]),
          Buffer.from('"}', "utf8"),
        ]),
        "probe.tgz",
      ),
    /is not valid UTF-8/u,
  );
});

test("the packed manifest parser refuses duplicate object keys", () => {
  assert.throws(
    () =>
      parsePackedManifestJson(
        Buffer.from(
          '{"name":"a","version":"1.0.0","name":"b"}',
          "utf8",
        ),
        "probe.tgz",
      ),
    /declares the key "name" twice/u,
  );
});

test("the packed manifest parser refuses a duplicate key written as an escape", () => {
  assert.throws(
    () =>
      parsePackedManifestJson(
        Buffer.from('{"name":"a","\\u006eame":"b"}', "utf8"),
        "probe.tgz",
      ),
    /declares the key "name" twice/u,
  );
});

test("the packed manifest parser refuses a duplicate key nested in an array", () => {
  assert.throws(
    () =>
      parsePackedManifestJson(
        Buffer.from(
          '{"a":[{"b":1},{"c":2,"c":3}]}',
          "utf8",
        ),
        "probe.tgz",
      ),
    /declares the key "c" twice/u,
  );
});

test("the packed manifest parser refuses a byte order mark", () => {
  assert.throws(
    () =>
      parsePackedManifestJson(
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from("{}", "utf8"),
        ]),
        "probe.tgz",
      ),
    /begins with a byte order mark/u,
  );
});

test("the packed manifest parser refuses malformed JSON", () => {
  assert.throws(
    () =>
      parsePackedManifestJson(
        Buffer.from('{"name":}', "utf8"),
        "probe.tgz",
      ),
    /is not valid JSON/u,
  );
});

test("the packed manifest parser accepts a real manifest and repeated keys across sibling objects", () => {
  const parsed = parsePackedManifestJson(
    Buffer.from(
      JSON.stringify({
        name: "@genii-foundation/probe",
        version: "1.0.0",
        repository: { directory: "packages/probe" },
        exports: {
          ".": { types: "./dist/index.d.ts" },
          "./reader": { types: "./dist/reader.d.ts" },
        },
        keywords: ["a", "a"],
      }),
      "utf8",
    ),
    "probe.tgz",
  );
  assert.equal(parsed.name, "@genii-foundation/probe");
  assert.equal(
    parsed.exports["./reader"].types,
    "./dist/reader.d.ts",
    "the same key in two sibling objects is not a duplicate",
  );
  assert.deepEqual(
    parsed.keywords,
    ["a", "a"],
    "repeated array values are not object keys",
  );
});

test("a string value that looks like a key is not treated as one", () => {
  const parsed = parsePackedManifestJson(
    Buffer.from('{"a":"a","b":"a"}', "utf8"),
    "probe.tgz",
  );
  assert.deepEqual(parsed, { a: "a", b: "a" });
});

test("every packed manifest rejection names the archive it refused", async (t) => {
  // An audit inspects several candidates in one run, so a diagnostic that omits
  // the archive, or that blames a trusted caller argument for attacker-supplied
  // manifest content, is not usable evidence.
  const cases = [
    ["null", "null", /is not a JSON object/u],
    ["a number", "42", /is not a JSON object/u],
    ["a string", '"hello"', /is not a JSON object/u],
    ["an array", "[]", /is not a JSON object/u],
    ["an empty object", "{}", /lacks a valid name or version/u],
    [
      "a non-string name",
      '{"name":7,"version":"1.0.0"}',
      /lacks a valid name or version/u,
    ],
    [
      "a shorthand repository",
      '{"name":"a","version":"1.0.0","repository":"github:x/y"}',
      /does not declare a repository directory/u,
    ],
    [
      "an array repository",
      '{"name":"a","version":"1.0.0","repository":["packages/x"]}',
      /does not declare a repository directory/u,
    ],
    [
      "a null repository",
      '{"name":"a","version":"1.0.0","repository":null}',
      /does not declare a repository directory/u,
    ],
    [
      "a repository whose directory arrives only through __proto__",
      '{"name":"a","version":"1.0.0","repository":{"__proto__":{"directory":"packages/x"}}}',
      /does not declare a repository directory/u,
    ],
    [
      "an absolute repository directory",
      '{"name":"a","version":"1.0.0","repository":{"directory":"/packages/x"}}',
      /declares an unusable repository directory/u,
    ],
  ];

  for (const [label, body, pattern] of cases) {
    const root = workspace(t);
    const archivePath = writeArchive(
      root,
      Buffer.concat([
        member({ name: PACKED_MANIFEST_PATH, body }),
        zeroBlock(),
        zeroBlock(),
      ]),
    );
    let observed;
    try {
      await inspectPackageArchive({
        archivePath,
        root: "packages/probe",
      });
      observed = undefined;
    } catch (error) {
      observed = error;
    }
    assert.ok(
      observed !== undefined,
      `a manifest of ${label} must be refused`,
    );
    assert.equal(
      observed.name,
      "Error",
      `a manifest of ${label} must fail as a stated rejection rather than a ${observed.name}`,
    );
    assert.match(observed.message, pattern);
    assert.match(
      observed.message,
      /candidate-\d+\.tgz/u,
      `the rejection for ${label} must name the archive`,
    );
  }
});

test("the hash helpers emit the formats every consumer pins", () => {
  const bytes = Buffer.from("probe", "utf8");
  assert.match(sha256(bytes), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(
    sha256(bytes),
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  );
});
