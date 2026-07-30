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

// One bounded, trusted package archive parser.
//
// The provenance scanner used to shell out to whichever `tar` executable
// appeared first on PATH: once to list an archive and once more per member to
// extract it. A real Content candidate holds 8,307 members inside 947,253
// compressed bytes, so an all-package audit spent over a minute of CPU without
// producing a result. Process-per-member was therefore both a machine-time
// denial of service and an untrusted dependency that lost exact member types,
// mangled newline-bearing names, and hashed archive bytes separately from the
// pathnames it later parsed.
//
// This module replaces all of that with a single streamed pass over one opened
// file descriptor. Compressed bytes are hashed as they leave that descriptor,
// decompressed once, structurally audited block by block, and parsed exactly
// once by the pinned `tar-stream` dependency. Every ceiling is fixed, every
// rejected shape fails closed, and no external process participates.
//
// `tar-stream` alone is not sufficient custody. Measured against 3.2.0, it
// accepts an archive with no end-of-archive blocks, accepts a single end block,
// parses and yields members smuggled after the end blocks, discards member
// padding without proving it is zero, treats the eight checksum bytes of an
// otherwise zero block as ignorable, emits symbolic links, hard links, devices,
// FIFOs, contiguous files, and unknown type flags as ordinary entries, keeps a
// non-empty `linkname` on a member that declares itself a regular file, and
// decodes member names with lossy UTF-8 so invalid bytes become U+FFFD. It also
// emits a directory member without skipping a non-zero declared body, which
// desynchronizes the parser from the byte stream. `createRawTarAuditor` closes
// the structural half of that list before bytes ever reach the parser, and the
// entry policy below closes the semantic half.

import { createHash } from "node:crypto";
import {
  constants as fileSystemConstants,
  promises as fileSystemPromises,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, crc32 } from "node:zlib";

import { extract as extractTar } from "tar-stream";

const kibibyte = 1024;
const mebibyte = 1024 * 1024;

// Fixed ceilings. Raising any of these requires new measured evidence and new
// adversarial tests, exactly as the source snapshot boundary requires.
export const ARCHIVE_LIMITS = Object.freeze({
  // One compressed archive.
  compressedBytes: 256 * mebibyte,
  // Decompressed TAR bytes, including headers, padding, and any PAX data.
  decompressedBytes: 512 * mebibyte,
  // Semantic members.
  entries: 100000,
  // One resolved member path.
  memberPathBytes: 4 * kibibyte,
  // Aggregate resolved member paths.
  aggregateMemberPathBytes: 16 * mebibyte,
  // One member body, captured or not. This deliberately tightens the previous
  // effective bound, which was whatever the external `tar` process would buffer
  // (256 MiB). The largest member across every current candidate is 2,625,136
  // bytes, so 64 MiB leaves ample headroom. The separate 16 MiB ceiling on
  // decoded text is not enforced here: it belongs to the scanner's `decodeText`,
  // which already owns the declared-binary bypass and the pinned message text.
  memberBytes: 64 * mebibyte,
  // The packed manifest specifically.
  manifestBytes: 1 * mebibyte,
  // Aggregate member payload.
  aggregatePayloadBytes: 384 * mebibyte,
  // Wall time for one archive.
  milliseconds: 60000,
});

// Named aliases for the two ceilings that package preparation also range
// checks against its own retained descriptors.
export const maximumArchiveBytes = ARCHIVE_LIMITS.compressedBytes;
export const maximumArchiveEntries = ARCHIVE_LIMITS.entries;

const packedRootPrefix = "package/";
export const PACKED_MANIFEST_PATH = "package/package.json";

const blockBytes = 512;
const readChunkBytes = 64 * kibibyte;
const gzipMagic = Object.freeze([0x1f, 0x8b]);
const gzipTrailerBytes = 8;

// The only member type flags a package archive may contain, as raw header bytes:
// a regular file in its modern and historic spellings, and a directory.
//
// This is an allowlist rather than a list of banned metadata flags. A blocklist
// has to enumerate every flag `tar-stream` gives meaning to, and missing one is
// silent: `toType` maps both 28 and 30 to `gnu-long-path`, so header bytes 0x4c
// and 0x4e are equivalent, and banning only 0x4c leaves the ban bypassable by a
// single byte. Refusing everything not explicitly allowed removes that class of
// mistake, and costs nothing: a measured pack of every current package produced
// 8,442 members with no PAX header, no GNU long path, and no directory entry.
const allowedTypeFlagBytes = new Set([0x00, 0x30, 0x35]);

// Names for the flags worth naming in a diagnostic. Anything absent is reported
// by its byte value, which is still enough to explain the rejection.
const typeFlagNames = new Map([
  [0x31, "hard link"],
  [0x32, "symbolic link"],
  [0x33, "character device"],
  [0x34, "block device"],
  [0x36, "FIFO"],
  [0x37, "contiguous file"],
  [0x44, "GNU directory dump"],
  [0x4b, "GNU long link path"],
  [0x4c, "GNU long path"],
  [0x4d, "GNU multi-volume continuation"],
  [0x4e, "GNU long path"],
  [0x53, "GNU sparse file"],
  [0x56, "GNU volume header"],
  [0x67, "PAX global header"],
  [0x78, "PAX extended header"],
]);

// The only two member shapes a package archive may contain.
const allowedMemberTypes = new Set(["file", "directory"]);

// Characters no portable package member path may contain. Windows reserves
// `<>:"|?*`, treats `\` as a separator, and forbids control characters
// outright. U+FFFD is refused because `tar-stream` decodes member names with
// lossy UTF-8, so a replacement character means the archive carried bytes that
// were not valid UTF-8 rather than that the author typed U+FFFD.
const forbiddenPathCharacters = new Set([
  ...'\\<>:"|?*',
  "\u{FFFD}",
]);

// Win32 reserves these names in every directory, with or without an extension,
// because they resolve to character devices. A member named `nul` cannot be
// written as an ordinary file, so an extractor would silently discard its body
// and the receipt would attest an inventory Windows cannot reproduce.
const reservedWindowsDeviceNames = new Set([
  "aux",
  "con",
  "nul",
  "prn",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

// Portable identity. Member paths are restricted to printable ASCII, so a
// locale-independent ASCII lower casing is the exact case fold and NFC is the
// identity function.
function foldPortablePath(value) {
  return value.replace(/[A-Z]/gu, (letter) =>
    String.fromCharCode(letter.charCodeAt(0) + 32),
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// The one definition of the archive digest format every consumer pins. The
// streaming digests inside `readPackageArchive` cannot call this, because they
// never hold the whole archive, so the format strings appear there too and the
// test suite compares both against an independent computation.
export function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

// Decodes and parses the packed manifest out of archive bytes.
//
// `Buffer.prototype.toString("utf8")` is lossy, so invalid UTF-8 in a packed
// manifest would silently become U+FFFD and then parse as ordinary text. A
// fatal decoder refuses instead. Duplicate object keys are refused as well:
// `JSON.parse` keeps the last occurrence, so a manifest carrying two `name`
// values would present one identity to this scanner and possibly another to a
// different reader.
//
// The schema package owns a richer strict JSON facility, but provenance tooling
// deliberately depends on nothing but Node builtins, `ajv`, and its own sibling
// scripts. Importing the schema build output would make `provenance:validate`
// require a prior compile and would place manifest parsing outside the bytes
// the scanner identity attests.
export function parsePackedManifestJson(bytes, label) {
  const where = label === undefined ? "" : ` in ${label}`;
  // `TextDecoder` silently strips a leading UTF-8 byte order mark, and JSON text
  // must not carry one, so the raw bytes are checked before decoding. A UTF-16
  // byte order mark is not special cased because it cannot survive a fatal UTF-8
  // decode.
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw new Error(
      `Packed manifest${where} begins with a byte order mark.`,
    );
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(
      `Packed manifest${where} is not valid UTF-8.`,
      { cause: error },
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Packed manifest${where} is not valid JSON.`,
      { cause: error },
    );
  }
  assertUniqueObjectKeys(text, where);
  return parsed;
}

// Walks already valid JSON text and refuses any object that declares one key
// twice. Runs after `JSON.parse` has proven the syntax, so the scan only has to
// track structure, never recover from it.
function assertUniqueObjectKeys(text, where) {
  const keysByDepth = [];
  const containers = [];
  let expectKey = false;
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    if (
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r"
    ) {
      index += 1;
      continue;
    }
    if (character === "{") {
      containers.push("object");
      keysByDepth.push(new Set());
      if (containers.length > maximumManifestDepth) {
        throw new Error(
          `Packed manifest${where} nests more than ${maximumManifestDepth} levels.`,
        );
      }
      expectKey = true;
      index += 1;
      continue;
    }
    if (character === "[") {
      containers.push("array");
      keysByDepth.push(null);
      if (containers.length > maximumManifestDepth) {
        throw new Error(
          `Packed manifest${where} nests more than ${maximumManifestDepth} levels.`,
        );
      }
      expectKey = false;
      index += 1;
      continue;
    }
    if (character === "}" || character === "]") {
      containers.pop();
      keysByDepth.pop();
      expectKey = false;
      index += 1;
      continue;
    }
    if (character === ",") {
      expectKey =
        containers[containers.length - 1] === "object";
      index += 1;
      continue;
    }
    if (character === ":") {
      expectKey = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (text[cursor] === '"') {
          break;
        }
        cursor += 1;
      }
      if (expectKey) {
        // The literal is already valid JSON, so reusing the JSON decoder gives
        // the exact key including every escape form.
        const key = JSON.parse(
          text.slice(index, cursor + 1),
        );
        const keys = keysByDepth[keysByDepth.length - 1];
        if (keys.has(key)) {
          throw new Error(
            `Packed manifest${where} declares the key ${JSON.stringify(key)} twice.`,
          );
        }
        keys.add(key);
        expectKey = false;
      }
      index = cursor + 1;
      continue;
    }
    index += 1;
  }
}

const maximumManifestDepth = 128;

function overflow(size) {
  const remainder = size % blockBytes;
  return remainder === 0 ? 0 : blockBytes - remainder;
}

/**
 * Decodes a TAR numeric header field exactly as `tar-stream`'s `decodeOct` does.
 *
 * Exact agreement is a security property, not a nicety. The auditor and the
 * parser walk the same bytes independently, so if they ever compute different
 * sizes for one member, one of them resynchronizes on attacker-chosen bytes and
 * every invariant the auditor enforces goes unchecked inside that window.
 *
 * The rule this must obey: either return the same number `tar-stream` returns,
 * or return a value that fails the caller's range check so the archive is
 * refused. Never return a different number. An earlier version terminated the
 * field at the first NUL, while `tar-stream` terminates only at the first space
 * and then skips leading NULs, so a size field of `00 00 '1' '0' '0' '0'` read as
 * 0 here and 512 there.
 *
 * Exported so a differential test can compare it against the parser's own
 * algorithm over an adversarial corpus, which is the only way to keep the two in
 * lockstep across dependency updates.
 */
export function decodeTarNumericField(block, offset, length) {
  const field = block.subarray(offset, offset + length);
  if ((field[0] & 0x80) !== 0) {
    // Base-256. `tar-stream` returns null for any other prefix, which its caller
    // turns into a rejection, so NaN here reaches the same outcome.
    if (field[0] !== 0x80 && field[0] !== 0xff) {
      return Number.NaN;
    }
    const positive = field[0] === 0x80;
    let sum = 0;
    for (let index = 1; index < field.length; index += 1) {
      const byte = positive ? field[index] : 0xff - field[index];
      sum = sum * 256 + byte;
    }
    return positive ? sum : -sum;
  }
  let start = 0;
  while (start < field.length && field[start] === 0x20) {
    start += 1;
  }
  // Terminate at the first space only, matching the parser.
  let end = start;
  while (end < field.length && field[end] !== 0x20) {
    end += 1;
  }
  while (start < end && field[start] === 0x00) {
    start += 1;
  }
  if (start === end) {
    return 0;
  }
  // `tar-stream` finishes with `parseInt(text, 8)`, which consumes the leading
  // run of octal digits and ignores whatever follows. Reproducing that prefix
  // behaviour is what keeps the two decoders equal on a field carrying trailing
  // NULs or other padding.
  let digits = start;
  while (
    digits < end &&
    field[digits] >= 0x30 &&
    field[digits] <= 0x37
  ) {
    digits += 1;
  }
  if (digits === start) {
    return Number.NaN;
  }
  return Number.parseInt(
    field.subarray(start, digits).toString("latin1"),
    8,
  );
}

// `tar-stream` promotes a type flag 0 member whose name ends in `/` to a
// directory and then emits it without consuming a declared body. Replicating
// that promotion here is what keeps the auditor's block cursor aligned with the
// parser's.
function headerDeclaresDirectory(block) {
  const typeFlag = block[156] === 0 ? 0 : block[156] - 0x30;
  if (typeFlag === 5) {
    return true;
  }
  if (typeFlag !== 0) {
    return false;
  }
  let nameEnd = 0;
  while (nameEnd < 100 && block[nameEnd] !== 0) {
    nameEnd += 1;
  }
  if (nameEnd === 0) {
    // An empty name field with a ustar prefix resolves to `prefix + "/"`.
    return block[345] !== 0;
  }
  return block[nameEnd - 1] === 0x2f;
}

function allZero(bytes) {
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) {
      return false;
    }
  }
  return true;
}

class ArchiveRejection extends Error {
  constructor(message, archivePath) {
    super(
      archivePath === undefined
        ? message
        : `${message}: ${archivePath}`,
    );
    this.name = "ArchiveRejection";
  }
}

/**
 * Streams every decompressed byte through unchanged while proving the
 * structural invariants `tar-stream` does not check.
 *
 * Enforces 512-byte alignment, zero member padding, at least two
 * end-of-archive blocks, only zero bytes after the archive ends, fully zero end
 * blocks including their checksum field, no archive metadata members, and no
 * declared body on a directory member.
 */
export function createRawTarAuditor({
  archivePath,
  maximumBytes = ARCHIVE_LIMITS.decompressedBytes,
}) {
  let pending = Buffer.alloc(0);
  let remainingBody = 0;
  let remainingPadding = 0;
  let endBlocks = 0;
  let totalBytes = 0;
  const state = { totalBytes: 0, blocks: 0 };

  function reject(message) {
    return new ArchiveRejection(message, archivePath);
  }

  function consume(chunk) {
    let cursor = 0;
    while (cursor < chunk.length) {
      if (remainingBody > 0) {
        const take = Math.min(remainingBody, chunk.length - cursor);
        remainingBody -= take;
        cursor += take;
        continue;
      }
      if (remainingPadding > 0) {
        const take = Math.min(remainingPadding, chunk.length - cursor);
        if (!allZero(chunk.subarray(cursor, cursor + take))) {
          throw reject(
            "TAR member padding contains nonzero bytes",
          );
        }
        remainingPadding -= take;
        cursor += take;
        continue;
      }
      const available = chunk.length - cursor;
      if (available < blockBytes) {
        pending = Buffer.from(chunk.subarray(cursor));
        return;
      }
      const block = chunk.subarray(cursor, cursor + blockBytes);
      cursor += blockBytes;
      state.blocks += 1;

      if (endBlocks > 0) {
        // The archive already ended. Trailing blocks may exist for a blocking
        // factor, but every byte of them must be zero.
        if (!allZero(block)) {
          throw reject(
            "TAR archive contains data after its end-of-archive blocks",
          );
        }
        endBlocks += 1;
        continue;
      }
      if (allZero(block)) {
        endBlocks = 1;
        continue;
      }
      // A block whose only nonzero bytes sit in the checksum field would be
      // treated as an end-of-archive block by `tar-stream`, because its
      // checksum routine skips bytes 148 through 155. Refuse that channel.
      const withoutChecksum = Buffer.concat([
        block.subarray(0, 148),
        block.subarray(156),
      ]);
      if (allZero(withoutChecksum)) {
        throw reject(
          "TAR end-of-archive block carries data in its checksum field",
        );
      }

      const typeFlagByte = block[156];
      if (!allowedTypeFlagBytes.has(typeFlagByte)) {
        const named = typeFlagNames.get(typeFlagByte);
        throw reject(
          named === undefined
            ? `TAR archive contains a member with the unsupported type flag 0x${typeFlagByte
                .toString(16)
                .padStart(2, "0")}`
            : `TAR archive contains an unsupported ${named} member`,
        );
      }

      const size = decodeTarNumericField(block, 124, 12);
      if (!Number.isSafeInteger(size) || size < 0) {
        throw reject("TAR header declares an unreadable member size");
      }
      if (size > ARCHIVE_LIMITS.memberBytes) {
        throw reject(
          `TAR member declares ${size} bytes, above the ${ARCHIVE_LIMITS.memberBytes} byte member ceiling`,
        );
      }
      if (headerDeclaresDirectory(block)) {
        if (size !== 0) {
          throw reject(
            "TAR directory member declares a nonzero body size",
          );
        }
        continue;
      }
      remainingBody = size;
      remainingPadding = overflow(size);
    }
  }

  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.length;
      state.totalBytes = totalBytes;
      if (totalBytes > maximumBytes) {
        callback(
          reject(
            `TAR stream exceeds the ${maximumBytes} decompressed byte ceiling`,
          ),
        );
        return;
      }
      try {
        consume(
          pending.length === 0
            ? bytes
            : ((joined) => {
                pending = Buffer.alloc(0);
                return joined;
              })(Buffer.concat([pending, bytes])),
        );
      } catch (error) {
        callback(error);
        return;
      }
      callback(null, bytes);
    },
    flush(callback) {
      if (pending.length !== 0) {
        callback(
          reject(
            "TAR stream ends with a partial 512 byte block",
          ),
        );
        return;
      }
      if (remainingBody > 0 || remainingPadding > 0) {
        callback(reject("TAR stream ends inside a member body"));
        return;
      }
      if (totalBytes % blockBytes !== 0) {
        callback(
          reject("TAR stream is not a multiple of 512 bytes"),
        );
        return;
      }
      if (endBlocks < 2) {
        callback(
          reject(
            "TAR stream omits the two required end-of-archive blocks",
          ),
        );
        return;
      }
      callback(null);
    },
  });

  transform.auditState = state;
  return transform;
}

// ------------------------------------------------------------------ paths

function validateMemberPath(rawPath, type, archivePath) {
  function reject(message) {
    return new ArchiveRejection(
      `${message} (${JSON.stringify(rawPath)})`,
      archivePath,
    );
  }
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw reject("TAR member has an empty name");
  }
  const pathBytes = Buffer.byteLength(rawPath, "utf8");
  if (pathBytes > ARCHIVE_LIMITS.memberPathBytes) {
    throw reject(
      `TAR member path exceeds ${ARCHIVE_LIMITS.memberPathBytes} UTF-8 bytes`,
    );
  }
  for (const character of rawPath) {
    const codePoint = character.codePointAt(0);
    if (codePoint === 0) {
      throw reject("TAR member path contains NUL");
    }
    if (codePoint < 0x20 || codePoint === 0x7f) {
      throw reject(
        "TAR member path contains a control character",
      );
    }
    if (character === "\u{FFFD}") {
      // `tar-stream` decodes member names with lossy UTF-8, so a replacement
      // character means the header carried bytes that were not valid UTF-8.
      throw reject(
        "TAR member path contains a replacement character, so the archive carried an invalid UTF-8 member name",
      );
    }
    if (codePoint > 0x7e) {
      // Every measured member path across every current package candidate is
      // printable ASCII. Restricting engine package members to that set makes
      // portable identity exact without a Unicode table, and keeps this
      // provenance scanner independent of the schema build output.
      throw reject(
        "TAR member path contains a non-ASCII character",
      );
    }
    if (forbiddenPathCharacters.has(character)) {
      throw reject(
        `TAR member path contains the reserved character ${JSON.stringify(character)}`,
      );
    }
  }
  if (rawPath.startsWith("/")) {
    throw reject("TAR member path is absolute");
  }

  const hadTrailingSlash = rawPath.endsWith("/");
  const logicalPath = hadTrailingSlash
    ? rawPath.slice(0, -1)
    : rawPath;
  if (hadTrailingSlash && type !== "directory") {
    throw reject(
      "TAR member path ends with a separator but is not a directory",
    );
  }
  if (logicalPath.length === 0 || logicalPath.endsWith("/")) {
    throw reject("TAR member path has an empty final segment");
  }

  const segments = logicalPath.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw reject("TAR member path has an empty segment");
    }
    if (segment === "." || segment === "..") {
      throw reject(
        "TAR member path contains a dot or dot-dot segment",
      );
    }
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      // Win32 silently drops trailing dots and spaces from a path component,
      // so two members differing only there collide on extraction.
      throw reject(
        "TAR member path segment ends with a dot or a space",
      );
    }
    const deviceCandidate = foldPortablePath(
      segment.split(".")[0],
    );
    if (reservedWindowsDeviceNames.has(deviceCandidate)) {
      throw reject(
        `TAR member path segment ${JSON.stringify(segment)} is a reserved Windows device name`,
      );
    }
  }

  if (segments[0] !== "package") {
    throw reject(
      `TAR member path is outside the exact ${packedRootPrefix} prefix`,
    );
  }
  if (segments.length === 1 && type !== "directory") {
    throw reject(
      `TAR member path is exactly ${JSON.stringify("package")} but is not the root directory`,
    );
  }

  return {
    logicalPath,
    segments,
    portableKey: foldPortablePath(logicalPath),
  };
}

function assertNoPortableConflicts(records, archivePath) {
  const files = new Map();
  const directories = new Map();
  const portableKeys = new Map();

  function reject(message) {
    return new ArchiveRejection(message, archivePath);
  }

  // Ancestors are resolved by case-folded key rather than by exact spelling.
  // Every other rule here folds, so an exact-case ancestor lookup would accept
  // `package/Foo` beside `package/foo/bar`: neither is a duplicate, and their
  // folded keys differ, yet on a case-insensitive filesystem one of the two
  // cannot be extracted and an attested member never reaches disk.
  const filesByPortableKey = new Map();

  for (const record of records) {
    const target = record.type === "directory" ? directories : files;
    if (target.has(record.logicalPath)) {
      throw reject(
        `TAR archive declares ${JSON.stringify(record.path)} twice`,
      );
    }
    target.set(record.logicalPath, record);
    if (record.type !== "directory") {
      filesByPortableKey.set(record.portableKey, record);
    }
  }

  for (const logicalPath of files.keys()) {
    if (directories.has(logicalPath)) {
      throw reject(
        `TAR archive declares ${JSON.stringify(logicalPath)} as both a file and a directory`,
      );
    }
  }

  // Every ancestor of a member is a directory by construction, so a member
  // whose ancestor is declared as a file cannot be extracted.
  for (const record of records) {
    // Ancestors are built incrementally. Slicing and rejoining the segment list
    // at every depth would make this quadratic in path depth, which at the
    // aggregate path ceiling and maximal ustar depth is measurable work for an
    // archive that is about to be refused anyway.
    let ancestor = record.segments[0];
    for (
      let depth = 1;
      depth < record.segments.length;
      depth += 1
    ) {
      const conflicting = filesByPortableKey.get(
        foldPortablePath(ancestor),
      );
      if (conflicting !== undefined) {
        throw reject(
          `TAR archive nests ${JSON.stringify(record.logicalPath)} under the file ${JSON.stringify(conflicting.logicalPath)}`,
        );
      }
      ancestor = `${ancestor}/${record.segments[depth]}`;
    }
  }

  for (const record of records) {
    const existing = portableKeys.get(record.portableKey);
    if (
      existing !== undefined &&
      existing.logicalPath !== record.logicalPath
    ) {
      throw reject(
        `TAR archive members ${JSON.stringify(existing.logicalPath)} and ${JSON.stringify(record.logicalPath)} collide under portable path identity`,
      );
    }
    portableKeys.set(record.portableKey, record);
  }
}

// --------------------------------------------------------------- identity

function sameFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function fileIdentity(stat) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    nlink: stat.nlink,
    size: stat.size,
    mode: stat.mode,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  });
}

function assertExpectedIdentity(expected, actual, archivePath) {
  if (expected === undefined || expected === null) {
    return;
  }
  if (typeof expected !== "object") {
    throw new ArchiveRejection(
      "expectedIdentity must be an archive descriptor object",
      archivePath,
    );
  }
  const comparable = [
    "size",
    "sha256",
    "integrity",
    "shasum",
    "fileCount",
  ];
  for (const field of comparable) {
    if (expected[field] === undefined) {
      continue;
    }
    if (expected[field] !== actual[field]) {
      throw new ArchiveRejection(
        `Archive ${field} ${JSON.stringify(actual[field])} does not match the expected retained identity ${JSON.stringify(expected[field])}`,
        archivePath,
      );
    }
  }
  if (Array.isArray(expected.files)) {
    const same =
      expected.files.length === actual.files.length &&
      expected.files.every(
        (value, index) => value === actual.files[index],
      );
    if (!same) {
      throw new ArchiveRejection(
        "Archive member inventory does not match the expected retained identity",
        archivePath,
      );
    }
  }
}

// ----------------------------------------------------------------- reader

/**
 * Reads one gzipped package archive in a single bounded streamed pass.
 *
 * Opens exactly one read-only, no-follow descriptor, hashes the compressed
 * bytes leaving that descriptor, decompresses them once, structurally audits
 * the TAR stream, parses its members once, hashes every member body, and
 * captures only the bodies `captureFile` selects. Descriptor and pathname
 * identity are checked before the first byte and again before the result is
 * accepted, all inside one wall-clock deadline.
 *
 * @param {object} options
 * @param {string} options.archivePath Absolute path to the archive.
 * @param {(entry: {path: string, type: string, size: number}) => boolean} [options.captureFile]
 *   Selects which member bodies are retained. Defaults to retaining none.
 * @param {object} [options.expectedIdentity] A descriptor previously returned
 *   for the same bytes. Any mismatch rejects the archive, which removes the
 *   need to hash a retained candidate and then reopen it.
 * @param {number} [options.deadlineMilliseconds] Tightens the wall-clock
 *   deadline. It can only lower the fixed ceiling, never raise it, so a caller
 *   cannot buy itself more time than the limit allows.
 */
export async function readPackageArchive({
  archivePath,
  captureFile,
  expectedIdentity,
  deadlineMilliseconds,
} = {}) {
  if (
    typeof archivePath !== "string" ||
    archivePath.length === 0 ||
    !isAbsolute(archivePath)
  ) {
    throw new ArchiveRejection(
      "readPackageArchive requires one absolute archivePath",
      typeof archivePath === "string" ? archivePath : undefined,
    );
  }
  if (
    captureFile !== undefined &&
    typeof captureFile !== "function"
  ) {
    throw new ArchiveRejection(
      "captureFile must be a function",
      archivePath,
    );
  }
  const select = captureFile ?? (() => false);
  const requestedPath = resolve(archivePath);

  const deadline =
    deadlineMilliseconds === undefined
      ? ARCHIVE_LIMITS.milliseconds
      : Math.min(
          ARCHIVE_LIMITS.milliseconds,
          Math.max(1, Math.trunc(deadlineMilliseconds)),
        );
  const startedAt = process.hrtime.bigint();
  const deadlineNanoseconds = BigInt(deadline) * 1000000n;
  function elapsedMilliseconds() {
    return Number(
      (process.hrtime.bigint() - startedAt) / 1000000n,
    );
  }
  function assertWithinDeadline() {
    if (
      process.hrtime.bigint() - startedAt >
      deadlineNanoseconds
    ) {
      throw new ArchiveRejection(
        `Archive inspection exceeded its ${deadline} ms deadline`,
        requestedPath,
      );
    }
  }

  // Pathname identity before the descriptor exists.
  const walked = await fileSystemPromises.lstat(requestedPath);
  if (walked.isSymbolicLink() || !walked.isFile()) {
    throw new ArchiveRejection(
      "Package archive must be a regular file",
      requestedPath,
    );
  }
  // Callers must present the lexically canonical, fully resolved spelling. A
  // symbolic link anywhere in the chain could be repointed between the walk and
  // the open, so the reader refuses to canonicalize on the caller's behalf.
  const resolvedPath = realpathSync(requestedPath);
  if (resolvedPath !== requestedPath) {
    throw new ArchiveRejection(
      `Package archive path must not traverse a symbolic link and must already be canonical (resolves to ${resolvedPath})`,
      requestedPath,
    );
  }

  const openFlags =
    fileSystemConstants.O_RDONLY |
    (fileSystemConstants.O_NOFOLLOW ?? 0) |
    (fileSystemConstants.O_NONBLOCK ?? 0);
  const handle = await fileSystemPromises.open(
    resolvedPath,
    openFlags,
  );

  const timers = [];
  try {
    const openedStat = await handle.stat();
    const before = fileIdentity(openedStat);
    if (!openedStat.isFile()) {
      throw new ArchiveRejection(
        "Opened package archive descriptor must be a regular file",
        resolvedPath,
      );
    }
    if (before.nlink !== 1) {
      throw new ArchiveRejection(
        `Package archive must have exactly one hard link but has ${before.nlink}`,
        resolvedPath,
      );
    }
    if (before.dev !== walked.dev || before.ino !== walked.ino) {
      throw new ArchiveRejection(
        "Package archive changed identity between the path walk and the open",
        resolvedPath,
      );
    }
    if (before.size < 1) {
      throw new ArchiveRejection(
        "Package archive is empty",
        resolvedPath,
      );
    }
    if (before.size > ARCHIVE_LIMITS.compressedBytes) {
      throw new ArchiveRejection(
        `Package archive holds ${before.size} bytes, above the ${ARCHIVE_LIMITS.compressedBytes} byte ceiling`,
        resolvedPath,
      );
    }
    // Fail before decompressing anything when the descriptor already disagrees
    // with the identity the caller retained.
    if (
      expectedIdentity !== undefined &&
      expectedIdentity !== null &&
      typeof expectedIdentity === "object" &&
      expectedIdentity.size !== undefined &&
      expectedIdentity.size !== before.size
    ) {
      throw new ArchiveRejection(
        `Archive holds ${before.size} bytes but the expected retained identity declares ${expectedIdentity.size}`,
        resolvedPath,
      );
    }
    assertWithinDeadline();

    const controller = new AbortController();
    let timedOut = false;
    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, deadline);
    timers.push(deadlineTimer);

    const sha1Digest = createHash("sha1");
    const sha256Digest = createHash("sha256");
    const sha512Digest = createHash("sha512");
    let compressedBytes = 0;
    // The gzip magic and the final eight bytes are retained so the container's
    // own framing can be proven to cover the entire file. See the trailer check
    // after the pipeline for why that matters.
    let compressedPrefix = Buffer.alloc(0);
    let compressedTail = Buffer.alloc(0);

    const compressedMeter = new Transform({
      transform(chunk, _encoding, callback) {
        const bytes = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk);
        compressedBytes += bytes.length;
        if (compressedBytes > ARCHIVE_LIMITS.compressedBytes) {
          callback(
            new ArchiveRejection(
              `Package archive exceeds the ${ARCHIVE_LIMITS.compressedBytes} compressed byte ceiling`,
              resolvedPath,
            ),
          );
          return;
        }
        if (compressedPrefix.length < gzipMagic.length) {
          compressedPrefix = Buffer.concat([
            compressedPrefix,
            bytes,
          ]).subarray(0, gzipMagic.length);
        }
        compressedTail = Buffer.concat([
          compressedTail,
          bytes,
        ]).subarray(-gzipTrailerBytes);
        sha1Digest.update(bytes);
        sha256Digest.update(bytes);
        sha512Digest.update(bytes);
        callback(null, bytes);
      },
    });

    // One pass over the decompressed bytes, for the gzip trailer check only. The
    // structural audit is a separate stage so each stage has one job.
    let decompressedBytes = 0;
    let decompressedCrc = 0;
    const decompressedMeter = new Transform({
      transform(chunk, _encoding, callback) {
        const bytes = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk);
        decompressedBytes += bytes.length;
        decompressedCrc = crc32(bytes, decompressedCrc);
        callback(null, bytes);
      },
    });

    const auditor = createRawTarAuditor({
      archivePath: resolvedPath,
    });
    const parser = extractTar();

    const records = [];
    let aggregatePathBytes = 0;
    let aggregatePayloadBytes = 0;
    let capturedBytes = 0;
    let manifestSeen = 0;

    let consumerError = null;
    const consumer = (async () => {
      for await (const entry of parser) {
        const header = entry.header;
        assertWithinDeadline();

        if (records.length + 1 > ARCHIVE_LIMITS.entries) {
          throw new ArchiveRejection(
            `Package archive declares more than ${ARCHIVE_LIMITS.entries} members`,
            resolvedPath,
          );
        }
        if (header.pax !== null && header.pax !== undefined) {
          throw new ArchiveRejection(
            "Package archive member carries PAX extended attributes",
            resolvedPath,
          );
        }
        if (!allowedMemberTypes.has(header.type)) {
          throw new ArchiveRejection(
            `Package archive contains an unsupported ${JSON.stringify(header.type)} member ${JSON.stringify(header.name)}`,
            resolvedPath,
          );
        }
        if (
          header.linkname !== null &&
          header.linkname !== undefined &&
          header.linkname !== ""
        ) {
          // A regular file or directory that also names a link target is
          // asking two different extractors to disagree.
          throw new ArchiveRejection(
            `Package archive member ${JSON.stringify(header.name)} declares a link target`,
            resolvedPath,
          );
        }

        const identity = validateMemberPath(
          header.name,
          header.type,
          resolvedPath,
        );
        aggregatePathBytes += Buffer.byteLength(
          identity.logicalPath,
          "utf8",
        );
        if (
          aggregatePathBytes >
          ARCHIVE_LIMITS.aggregateMemberPathBytes
        ) {
          throw new ArchiveRejection(
            `Package archive member paths exceed ${ARCHIVE_LIMITS.aggregateMemberPathBytes} aggregate bytes`,
            resolvedPath,
          );
        }

        const declaredSize = header.size ?? 0;
        if (header.type === "directory" && declaredSize !== 0) {
          throw new ArchiveRejection(
            `Package archive directory ${JSON.stringify(header.name)} declares a body`,
            resolvedPath,
          );
        }
        if (declaredSize > ARCHIVE_LIMITS.memberBytes) {
          throw new ArchiveRejection(
            `Package archive member ${JSON.stringify(header.name)} declares ${declaredSize} bytes, above the ${ARCHIVE_LIMITS.memberBytes} byte ceiling`,
            resolvedPath,
          );
        }
        aggregatePayloadBytes += declaredSize;
        if (
          aggregatePayloadBytes >
          ARCHIVE_LIMITS.aggregatePayloadBytes
        ) {
          throw new ArchiveRejection(
            `Package archive payload exceeds ${ARCHIVE_LIMITS.aggregatePayloadBytes} aggregate bytes`,
            resolvedPath,
          );
        }

        const isManifest =
          identity.logicalPath === PACKED_MANIFEST_PATH;
        if (isManifest) {
          manifestSeen += 1;
          if (declaredSize > ARCHIVE_LIMITS.manifestBytes) {
            throw new ArchiveRejection(
              `Packed manifest declares ${declaredSize} bytes, above the ${ARCHIVE_LIMITS.manifestBytes} byte ceiling`,
              resolvedPath,
            );
          }
        }

        const wanted =
          header.type === "file" &&
          select({
            path: identity.logicalPath,
            type: header.type,
            size: declaredSize,
          }) === true;
        const capturedCeiling = isManifest
          ? ARCHIVE_LIMITS.manifestBytes
          : ARCHIVE_LIMITS.memberBytes;
        if (wanted && declaredSize > capturedCeiling) {
          throw new ArchiveRejection(
            `Requested capture of ${JSON.stringify(header.name)} needs ${declaredSize} bytes, above the ${capturedCeiling} byte capture ceiling`,
            resolvedPath,
          );
        }

        // Every member body is read in full, both to keep the parser aligned
        // with the byte stream and to hash the member. Only selected bodies are
        // retained.
        const memberDigest = createHash("sha256");
        const retained = wanted ? [] : null;
        let observedSize = 0;
        for await (const chunk of entry) {
          const bytes = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk);
          observedSize += bytes.length;
          if (observedSize > declaredSize) {
            throw new ArchiveRejection(
              `Package archive member ${JSON.stringify(header.name)} streamed more bytes than its header declared`,
              resolvedPath,
            );
          }
          memberDigest.update(bytes);
          if (retained !== null) {
            capturedBytes += bytes.length;
            if (
              capturedBytes >
              ARCHIVE_LIMITS.aggregatePayloadBytes
            ) {
              throw new ArchiveRejection(
                `Captured member bodies exceed ${ARCHIVE_LIMITS.aggregatePayloadBytes} aggregate bytes`,
                resolvedPath,
              );
            }
            retained.push(bytes);
          }
        }
        if (observedSize !== declaredSize) {
          throw new ArchiveRejection(
            `Package archive member ${JSON.stringify(header.name)} streamed ${observedSize} bytes but declared ${declaredSize}`,
            resolvedPath,
          );
        }
        assertWithinDeadline();

        records.push({
          path: identity.logicalPath,
          logicalPath: identity.logicalPath,
          segments: identity.segments,
          portableKey: identity.portableKey,
          type: header.type,
          size: declaredSize,
          sha256: `sha256:${memberDigest.digest("hex")}`,
          bytes:
            retained === null
              ? undefined
              : Buffer.concat(retained),
        });
      }
    })().catch((error) => {
      consumerError = error;
      controller.abort();
    });

    let transportError = null;
    const transport = pipeline(
      handle.createReadStream({
        autoClose: false,
        start: 0,
        highWaterMark: readChunkBytes,
      }),
      compressedMeter,
      createGunzip(),
      decompressedMeter,
      auditor,
      parser,
      { signal: controller.signal },
    ).catch((error) => {
      transportError = error;
    });

    await Promise.all([transport, consumer]);
    clearTimeout(deadlineTimer);

    if (timedOut) {
      throw new ArchiveRejection(
        `Archive inspection exceeded its ${deadline} ms deadline after ${elapsedMilliseconds()} ms`,
        resolvedPath,
      );
    }
    for (const error of [consumerError, transportError]) {
      if (error === null || error === undefined) {
        continue;
      }
      if (error.name === "AbortError") {
        continue;
      }
      if (error instanceof ArchiveRejection) {
        throw error;
      }
      // zlib and tar-stream report a bare condition with no idea which archive
      // produced it. An audit inspects several candidates, so the failure has to
      // name one.
      throw new ArchiveRejection(
        `Package archive could not be decompressed and parsed (${error.message})`,
        resolvedPath,
      );
    }
    if (consumerError !== null || transportError !== null) {
      // A backstop. Every current abort path either sets `timedOut` or records
      // the originating error, both of which are thrown above, so this branch is
      // unreachable today. It stays because the alternative to an unreachable
      // rejection here is an abort that silently returns a result.
      throw new ArchiveRejection(
        "Archive inspection was aborted",
        resolvedPath,
      );
    }

    if (compressedBytes !== before.size) {
      throw new ArchiveRejection(
        `Package archive streamed ${compressedBytes} bytes but reported ${before.size}`,
        resolvedPath,
      );
    }

    // Hashing every byte of the file proves what the artifact contains. It does
    // NOT prove that every byte was examined. `createGunzip` decompresses the
    // first gzip member and then discards trailing input, treating a leading zero
    // byte as ignorable padding, so a file shaped as
    // [benign member][0x00][second member] decompresses to the benign tar alone.
    // The structural auditor never sees the tail, the member inventory omits it,
    // and the leak scan never decodes it, yet the receipt attests the digests of
    // the whole file and a consumer recovers the payload with `gunzip`.
    //
    // The gzip trailer closes this. A member ends with the CRC-32 and the
    // modulo-2^32 length of its own uncompressed data, so requiring the last
    // eight bytes of the FILE to describe everything that was decompressed proves
    // the file is exactly one member ending at end of file. Trailing padding,
    // trailing garbage, and concatenated members all fail it.
    if (
      compressedPrefix.length < gzipMagic.length ||
      compressedPrefix[0] !== gzipMagic[0] ||
      compressedPrefix[1] !== gzipMagic[1]
    ) {
      throw new ArchiveRejection(
        "Package archive does not begin with a gzip member",
        resolvedPath,
      );
    }
    if (compressedTail.length !== gzipTrailerBytes) {
      throw new ArchiveRejection(
        "Package archive is too short to carry a gzip trailer",
        resolvedPath,
      );
    }
    const declaredCrc = compressedTail.readUInt32LE(0);
    const declaredSize = compressedTail.readUInt32LE(4);
    const observedCrc = decompressedCrc >>> 0;
    const observedSize = decompressedBytes % 4294967296;
    if (
      declaredCrc !== observedCrc ||
      declaredSize !== observedSize
    ) {
      throw new ArchiveRejection(
        `Package archive carries bytes outside its single gzip member, so its trailer does not describe everything it holds (trailer declares ${declaredSize} bytes with checksum ${declaredCrc}, decompression produced ${observedSize} bytes with checksum ${observedCrc})`,
        resolvedPath,
      );
    }
    if (manifestSeen !== 1) {
      throw new ArchiveRejection(
        manifestSeen === 0
          ? `Package archive omits ${PACKED_MANIFEST_PATH}`
          : `Package archive declares ${PACKED_MANIFEST_PATH} ${manifestSeen} times`,
        resolvedPath,
      );
    }
    if (records.length > ARCHIVE_LIMITS.entries) {
      throw new ArchiveRejection(
        `Package archive declares more than ${ARCHIVE_LIMITS.entries} members`,
        resolvedPath,
      );
    }
    assertNoPortableConflicts(records, resolvedPath);

    // Descriptor and pathname identity again, before anything is accepted.
    const after = fileIdentity(await handle.stat());
    if (!sameFileIdentity(before, after)) {
      throw new ArchiveRejection(
        "Package archive changed while it was being read",
        resolvedPath,
      );
    }
    const walkedAgain = await fileSystemPromises.lstat(
      requestedPath,
    );
    if (
      walkedAgain.dev !== before.dev ||
      walkedAgain.ino !== before.ino ||
      realpathSync(requestedPath) !== resolvedPath
    ) {
      throw new ArchiveRejection(
        "Package archive path changed while it was being read",
        resolvedPath,
      );
    }
    assertWithinDeadline();

    const entries = Object.freeze(
      records
        .map((record) =>
          Object.freeze({
            path: record.path,
            type: record.type,
            size: record.size,
            sha256: record.sha256,
            bytes: record.bytes,
          }),
        )
        .sort((left, right) =>
          compareText(left.path, right.path),
        ),
    );
    const files = Object.freeze(
      records
        .map((record) =>
          record.type === "directory"
            ? `${record.path}/`
            : record.path,
        )
        .sort(compareText),
    );

    const result = Object.freeze({
      archivePath: resolvedPath,
      candidateDirectory: dirname(resolvedPath),
      entries,
      fileCount: files.length,
      files,
      integrity: `sha512-${sha512Digest.digest("base64")}`,
      sha256: `sha256:${sha256Digest.digest("hex")}`,
      shasum: sha1Digest.digest("hex"),
      size: compressedBytes,
    });

    assertExpectedIdentity(expectedIdentity, result, resolvedPath);
    return result;
  } finally {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    await handle.close().catch(() => {});
  }
}
