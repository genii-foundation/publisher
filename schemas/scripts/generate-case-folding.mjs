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

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const packageManifestPath = join(packageRoot, "package.json");
const sourceNoticePath = join(packageRoot, "SOURCE-NOTICE");
const generatedPath = join(
  packageRoot,
  "src",
  "generated-unicode-case-folding.ts",
);
const normalizationDataPath = join(
  packageRoot,
  "third-party-data",
  "unicode-normalization-15.1.0.json",
);
const unicodeDataPath = join(
  packageRoot,
  "third-party-data",
  "UnicodeData-15.1.0.txt",
);
const normalizationTestPath = join(
  packageRoot,
  "third-party-data",
  "NormalizationTest-15.1.0.txt",
);
const unicodePackageName = "@unicode/unicode-15.1.0";
const unicodeVersion = "15.1.0";
const unicodeDataSource = Object.freeze({
  sha256:
    "2fc713e6a31a87c4850a37fe2caffa4218180fadb5de86b43a143ddb4581fb86",
  url: "https://www.unicode.org/Public/15.1.0/ucd/UnicodeData.txt",
});
const normalizationTestSource = Object.freeze({
  sha256:
    "871238e37e3be0696ec2bd0891119a041b052da1a84485eda05a5438724b223e",
  url: "https://www.unicode.org/Public/15.1.0/ucd/NormalizationTest.txt",
});

function assertArguments(arguments_) {
  const valid =
    arguments_.length === 0 ||
    (arguments_.length === 1 && arguments_[0] === "--write") ||
    (arguments_.length === 2 &&
      (
        arguments_[0] === "--check-unicode-data" ||
        arguments_[0] === "--import-unicode-data"
      ));
  if (!valid) {
    throw new Error(
      "Usage: node scripts/generate-case-folding.mjs [--write | --check-unicode-data <UnicodeData.txt> | --import-unicode-data <UnicodeData.txt>]",
    );
  }
}

function assertMapping(label, mapping) {
  if (!(mapping instanceof Map) || mapping.size === 0) {
    throw new Error(`${label} must be a nonempty Map.`);
  }
  for (const [source, target] of mapping) {
    if (
      typeof source !== "string" ||
      [...source].length !== 1 ||
      typeof target !== "string" ||
      [...target].length === 0
    ) {
      throw new Error(`${label} contains an invalid case-fold mapping.`);
    }
  }
}

function compareCodePoint(left, right) {
  return left.codePointAt(0) - right.codePointAt(0);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function codePointToSymbol(codePoint) {
  if (
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    throw new Error(`Invalid Unicode scalar U+${codePoint.toString(16)}.`);
  }
  return String.fromCodePoint(codePoint);
}

function parseCodePoint(value) {
  if (!/^[0-9A-F]{4,6}$/u.test(value)) {
    throw new Error(`Invalid UnicodeData code point: ${value}`);
  }
  return Number.parseInt(value, 16);
}

function parseUnicodeData(
  source,
  sourceMetadata = unicodeDataSource,
) {
  const actualChecksum = sha256(source);
  if (actualChecksum !== sourceMetadata.sha256) {
    throw new Error(
      `UnicodeData.txt checksum ${actualChecksum} does not match pinned Unicode 15.1 source ${sourceMetadata.sha256}.`,
    );
  }

  const canonicalCombiningClasses = [];
  const canonicalDecompositions = [];
  for (const [lineIndex, line] of source.split(/\r?\n/u).entries()) {
    if (line.length === 0) {
      continue;
    }
    const fields = line.split(";");
    if (fields.length !== 15) {
      throw new Error(
        `UnicodeData.txt line ${lineIndex + 1} does not contain 15 fields.`,
      );
    }
    const codePoint = parseCodePoint(fields[0]);
    const combiningClass = Number.parseInt(fields[3], 10);
    if (
      !Number.isInteger(combiningClass) ||
      combiningClass < 0 ||
      combiningClass > 255
    ) {
      throw new Error(
        `UnicodeData.txt line ${lineIndex + 1} has an invalid canonical combining class.`,
      );
    }
    if (combiningClass !== 0) {
      canonicalCombiningClasses.push([codePoint, combiningClass]);
    }

    const decomposition = fields[5];
    if (decomposition.length === 0 || decomposition.startsWith("<")) {
      continue;
    }
    const mapping = decomposition.split(" ").map(parseCodePoint);
    if (mapping.length === 0) {
      throw new Error(
        `UnicodeData.txt line ${lineIndex + 1} has an empty canonical decomposition.`,
      );
    }
    canonicalDecompositions.push([codePoint, mapping]);
  }

  return Object.freeze({
    unicodeVersion,
    source: sourceMetadata,
    canonicalCombiningClasses,
    canonicalDecompositions,
  });
}

export function verifyUnicodeDataSnapshot(
  source,
  bundledSnapshot,
  sourceMetadata = unicodeDataSource,
) {
  const derived = parseUnicodeData(source, sourceMetadata);
  const expected = `${JSON.stringify(derived)}\n`;
  if (bundledSnapshot !== expected) {
    throw new Error(
      "The bundled Unicode normalization data is stale or does not derive from the pinned UnicodeData.txt source.",
    );
  }
  return derived;
}

function validateNormalizationData(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    value.unicodeVersion !== unicodeVersion ||
    value.source?.url !== unicodeDataSource.url ||
    value.source?.sha256 !== unicodeDataSource.sha256 ||
    !Array.isArray(value.canonicalCombiningClasses) ||
    !Array.isArray(value.canonicalDecompositions)
  ) {
    throw new Error(
      "The bundled normalization data does not identify the pinned Unicode 15.1 source.",
    );
  }

  let previousCombiningCodePoint = -1;
  for (const entry of value.canonicalCombiningClasses) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !Number.isInteger(entry[0]) ||
      entry[0] <= previousCombiningCodePoint ||
      !Number.isInteger(entry[1]) ||
      entry[1] < 1 ||
      entry[1] > 255
    ) {
      throw new Error(
        "The bundled canonical combining-class data is malformed or unsorted.",
      );
    }
    codePointToSymbol(entry[0]);
    previousCombiningCodePoint = entry[0];
  }

  let previousDecompositionCodePoint = -1;
  for (const entry of value.canonicalDecompositions) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !Number.isInteger(entry[0]) ||
      entry[0] <= previousDecompositionCodePoint ||
      !Array.isArray(entry[1]) ||
      entry[1].length === 0
    ) {
      throw new Error(
        "The bundled canonical decomposition data is malformed or unsorted.",
      );
    }
    codePointToSymbol(entry[0]);
    for (const codePoint of entry[1]) {
      codePointToSymbol(codePoint);
    }
    previousDecompositionCodePoint = entry[0];
  }
  return value;
}

function normalizationTables(
  normalizationData,
  fullCompositionExclusions,
) {
  const rawDecompositions = new Map(
    normalizationData.canonicalDecompositions,
  );
  const expandedDecompositions = new Map();
  const pending = new Set();

  function expand(codePoint) {
    const cached = expandedDecompositions.get(codePoint);
    if (cached !== undefined) {
      return cached;
    }
    const raw = rawDecompositions.get(codePoint);
    if (raw === undefined) {
      return [codePoint];
    }
    if (pending.has(codePoint)) {
      throw new Error(
        `Canonical decomposition cycle at U+${codePoint.toString(16).toUpperCase()}.`,
      );
    }
    pending.add(codePoint);
    const expanded = raw.flatMap(expand);
    pending.delete(codePoint);
    expandedDecompositions.set(codePoint, expanded);
    return expanded;
  }

  for (const codePoint of rawDecompositions.keys()) {
    expand(codePoint);
  }

  const exclusionSet = new Set(fullCompositionExclusions);
  const compositions = [];
  for (const [composite, decomposition] of rawDecompositions) {
    if (decomposition.length !== 2 || exclusionSet.has(composite)) {
      continue;
    }
    compositions.push([
      decomposition.map(codePointToSymbol).join(""),
      codePointToSymbol(composite),
    ]);
  }
  compositions.sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  return Object.freeze({
    canonicalCombiningClasses:
      normalizationData.canonicalCombiningClasses.map(
        ([codePoint, combiningClass]) => [
          codePointToSymbol(codePoint),
          combiningClass,
        ],
      ),
    canonicalCompositions: compositions,
    canonicalDecompositions: [...expandedDecompositions]
      .sort(([left], [right]) => left - right)
      .map(([codePoint, decomposition]) => [
        codePointToSymbol(codePoint),
        decomposition.map(codePointToSymbol).join(""),
      ]),
  });
}

function createNfcNormalizer(tables) {
  const combiningClasses = new Map(
    tables.canonicalCombiningClasses,
  );
  const compositions = new Map(tables.canonicalCompositions);
  const decompositions = new Map(
    tables.canonicalDecompositions,
  );
  const hangulSyllableBase = 0xac00;
  const hangulLeadingBase = 0x1100;
  const hangulVowelBase = 0x1161;
  const hangulTrailingBase = 0x11a7;
  const hangulLeadingCount = 19;
  const hangulVowelCount = 21;
  const hangulTrailingCount = 28;
  const hangulSyllablesPerLeading =
    hangulVowelCount * hangulTrailingCount;
  const hangulSyllableCount =
    hangulLeadingCount * hangulSyllablesPerLeading;

  function combiningClass(character) {
    return combiningClasses.get(character) ?? 0;
  }

  function appendCanonicalOrder(output, character) {
    const characterClass = combiningClass(character);
    output.push(character);
    if (characterClass === 0) {
      return;
    }
    let position = output.length - 1;
    while (position > 0) {
      const previous = output[position - 1];
      if (combiningClass(previous) <= characterClass) {
        break;
      }
      output[position] = previous;
      position -= 1;
    }
    output[position] = character;
  }

  function appendCanonicalDecomposition(output, character) {
    const codePoint = character.codePointAt(0);
    const syllableIndex = codePoint - hangulSyllableBase;
    if (
      syllableIndex >= 0 &&
      syllableIndex < hangulSyllableCount
    ) {
      appendCanonicalOrder(
        output,
        String.fromCodePoint(
          hangulLeadingBase +
            Math.floor(
              syllableIndex / hangulSyllablesPerLeading,
            ),
        ),
      );
      appendCanonicalOrder(
        output,
        String.fromCodePoint(
          hangulVowelBase +
            Math.floor(
              (syllableIndex % hangulSyllablesPerLeading) /
                hangulTrailingCount,
            ),
        ),
      );
      const trailingIndex = syllableIndex % hangulTrailingCount;
      if (trailingIndex !== 0) {
        appendCanonicalOrder(
          output,
          String.fromCodePoint(
            hangulTrailingBase + trailingIndex,
          ),
        );
      }
      return;
    }
    const decomposition = decompositions.get(character);
    if (decomposition === undefined) {
      appendCanonicalOrder(output, character);
      return;
    }
    for (const decomposedCharacter of decomposition) {
      appendCanonicalOrder(output, decomposedCharacter);
    }
  }

  function composeHangul(starter, character) {
    const starterCodePoint = starter.codePointAt(0);
    const characterCodePoint = character.codePointAt(0);
    const leadingIndex = starterCodePoint - hangulLeadingBase;
    const vowelIndex = characterCodePoint - hangulVowelBase;
    if (
      leadingIndex >= 0 &&
      leadingIndex < hangulLeadingCount &&
      vowelIndex >= 0 &&
      vowelIndex < hangulVowelCount
    ) {
      return String.fromCodePoint(
        hangulSyllableBase +
          (leadingIndex * hangulVowelCount + vowelIndex) *
            hangulTrailingCount,
      );
    }
    const syllableIndex = starterCodePoint - hangulSyllableBase;
    const trailingIndex =
      characterCodePoint - hangulTrailingBase;
    if (
      syllableIndex >= 0 &&
      syllableIndex < hangulSyllableCount &&
      syllableIndex % hangulTrailingCount === 0 &&
      trailingIndex > 0 &&
      trailingIndex < hangulTrailingCount
    ) {
      return String.fromCodePoint(
        starterCodePoint + trailingIndex,
      );
    }
    return undefined;
  }

  return (value) => {
    const ordered = [];
    for (const character of value) {
      appendCanonicalDecomposition(ordered, character);
    }
    const first = ordered[0];
    if (first === undefined) {
      return "";
    }
    const composed = [first];
    let starter = first;
    let starterPosition = 0;
    let previousClass = 0;
    for (let index = 1; index < ordered.length; index += 1) {
      const character = ordered[index];
      const characterClass = combiningClass(character);
      const composite =
        previousClass === 0 || previousClass < characterClass
          ? composeHangul(starter, character) ??
            compositions.get(`${starter}${character}`)
          : undefined;
      if (composite !== undefined) {
        composed[starterPosition] = composite;
        starter = composite;
        continue;
      }
      if (characterClass === 0) {
        starter = character;
        starterPosition = composed.length;
      }
      composed.push(character);
      previousClass = characterClass;
    }
    return composed.join("");
  };
}

function parseNormalizationSequence(value, lineNumber) {
  const codePoints = value.trim().split(/ +/u);
  if (
    codePoints.length === 0 ||
    codePoints.some((codePoint) => codePoint.length === 0)
  ) {
    throw new Error(
      `NormalizationTest.txt line ${lineNumber} contains an empty sequence.`,
    );
  }
  return codePoints
    .map(parseCodePoint)
    .map(codePointToSymbol)
    .join("");
}

export function verifyNormalizationConformance(
  source,
  tables,
  sourceMetadata = normalizationTestSource,
) {
  const actualChecksum = sha256(source);
  if (actualChecksum !== sourceMetadata.sha256) {
    throw new Error(
      `NormalizationTest.txt checksum ${actualChecksum} does not match pinned Unicode 15.1 source ${sourceMetadata.sha256}.`,
    );
  }
  const normalize = createNfcNormalizer(tables);
  let caseCount = 0;
  for (const [lineIndex, line] of source.split(/\r?\n/u).entries()) {
    const content = line.split("#", 1)[0].trim();
    if (content.length === 0 || content.startsWith("@")) {
      continue;
    }
    const fields = content
      .split(";")
      .map((field) => field.trim());
    if (fields.length !== 6 || fields[5] !== "") {
      throw new Error(
        `NormalizationTest.txt line ${lineIndex + 1} does not contain five test columns.`,
      );
    }
    const [c1, c2, c3, c4, c5] = fields
      .slice(0, 5)
      .map((field) =>
        parseNormalizationSequence(field, lineIndex + 1)
      );
    const assertions = [
      [c1, c2, "NFC(c1)=c2"],
      [c2, c2, "NFC(c2)=c2"],
      [c3, c2, "NFC(c3)=c2"],
      [c4, c4, "NFC(c4)=c4"],
      [c5, c4, "NFC(c5)=c4"],
    ];
    for (const [input, expected, invariant] of assertions) {
      if (normalize(input) !== expected) {
        throw new Error(
          `Unicode 15.1 normalization conformance failed at line ${lineIndex + 1}: ${invariant}.`,
        );
      }
    }
    caseCount += 1;
  }
  if (caseCount === 0) {
    throw new Error(
      "NormalizationTest.txt does not contain any conformance cases.",
    );
  }
  return Object.freeze({
    caseCount,
    source: sourceMetadata,
  });
}

function sourceText(
  sourceNotice,
  caseFoldingEntries,
  normalizationData,
  tables,
) {
  const noticeBody = sourceNotice.endsWith("\n")
    ? sourceNotice
    : `${sourceNotice}\n`;
  const caseFolding = JSON.stringify(
    Object.fromEntries(caseFoldingEntries),
  );
  const combiningClasses = JSON.stringify(
    Object.fromEntries(tables.canonicalCombiningClasses),
  );
  const compositions = JSON.stringify(
    Object.fromEntries(tables.canonicalCompositions),
  );
  const decompositions = JSON.stringify(
    Object.fromEntries(tables.canonicalDecompositions),
  );
  return `/*
${noticeBody}*/

/*
The Unicode case-fold mapping data in this generated file derives from
@unicode/unicode-15.1.0 version 1.6.17 and remains available under the MIT
license reproduced in third-party-licenses/unicode-15.1.0-LICENSE-MIT.txt.
The canonical normalization data derives from Unicode 15.1.0 UnicodeData.txt,
source SHA-256 ${normalizationData.source.sha256}, and remains available under
the Unicode License V3 reproduced in
third-party-licenses/unicode-data-LICENSE.txt.
The generator and runtime wrapper are GENII Publisher Original Code.
*/

export const UNICODE_DEFAULT_CASE_FOLDING_VERSION = ${JSON.stringify(unicodeVersion)};
export const UNICODE_NFC_VERSION = ${JSON.stringify(unicodeVersion)};

const fullDefaultCaseFolding = Object.freeze(${caseFolding}) as Readonly<
  Record<string, string>
>;
const canonicalCombiningClasses = Object.freeze(${combiningClasses}) as Readonly<
  Record<string, number>
>;
const canonicalCompositions = Object.freeze(${compositions}) as Readonly<
  Record<string, string>
>;
const canonicalDecompositions = Object.freeze(${decompositions}) as Readonly<
  Record<string, string>
>;

const HANGUL_SYLLABLE_BASE = 0xac00;
const HANGUL_LEADING_BASE = 0x1100;
const HANGUL_VOWEL_BASE = 0x1161;
const HANGUL_TRAILING_BASE = 0x11a7;
const HANGUL_LEADING_COUNT = 19;
const HANGUL_VOWEL_COUNT = 21;
const HANGUL_TRAILING_COUNT = 28;
const HANGUL_SYLLABLES_PER_LEADING =
  HANGUL_VOWEL_COUNT * HANGUL_TRAILING_COUNT;
const HANGUL_SYLLABLE_COUNT =
  HANGUL_LEADING_COUNT * HANGUL_SYLLABLES_PER_LEADING;

export function unicodeFullDefaultCaseFold(value: string): string {
  let folded = "";
  for (const character of value) {
    folded += fullDefaultCaseFolding[character] ?? character;
  }
  return folded;
}

function canonicalCombiningClass(character: string): number {
  return canonicalCombiningClasses[character] ?? 0;
}

function appendCanonicalOrder(
  output: string[],
  character: string,
): void {
  const characterClass = canonicalCombiningClass(character);
  output.push(character);
  if (characterClass === 0) {
    return;
  }

  let position = output.length - 1;
  while (position > 0) {
    const previous = output[position - 1];
    if (
      previous === undefined ||
      canonicalCombiningClass(previous) <= characterClass
    ) {
      break;
    }
    output[position] = previous;
    position -= 1;
  }
  output[position] = character;
}

function appendCanonicalDecomposition(
  output: string[],
  character: string,
): void {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) {
    return;
  }
  const syllableIndex = codePoint - HANGUL_SYLLABLE_BASE;
  if (
    syllableIndex >= 0 &&
    syllableIndex < HANGUL_SYLLABLE_COUNT
  ) {
    appendCanonicalOrder(
      output,
      String.fromCodePoint(
        HANGUL_LEADING_BASE +
          Math.floor(
            syllableIndex / HANGUL_SYLLABLES_PER_LEADING,
          ),
      ),
    );
    appendCanonicalOrder(
      output,
      String.fromCodePoint(
        HANGUL_VOWEL_BASE +
          Math.floor(
            (syllableIndex % HANGUL_SYLLABLES_PER_LEADING) /
              HANGUL_TRAILING_COUNT,
          ),
      ),
    );
    const trailingIndex = syllableIndex % HANGUL_TRAILING_COUNT;
    if (trailingIndex !== 0) {
      appendCanonicalOrder(
        output,
        String.fromCodePoint(HANGUL_TRAILING_BASE + trailingIndex),
      );
    }
    return;
  }

  const decomposition = canonicalDecompositions[character];
  if (decomposition === undefined) {
    appendCanonicalOrder(output, character);
    return;
  }
  for (const decomposedCharacter of decomposition) {
    appendCanonicalOrder(output, decomposedCharacter);
  }
}

function composeHangul(
  starter: string,
  character: string,
): string | undefined {
  const starterCodePoint = starter.codePointAt(0);
  const characterCodePoint = character.codePointAt(0);
  if (
    starterCodePoint === undefined ||
    characterCodePoint === undefined
  ) {
    return undefined;
  }

  const leadingIndex = starterCodePoint - HANGUL_LEADING_BASE;
  const vowelIndex = characterCodePoint - HANGUL_VOWEL_BASE;
  if (
    leadingIndex >= 0 &&
    leadingIndex < HANGUL_LEADING_COUNT &&
    vowelIndex >= 0 &&
    vowelIndex < HANGUL_VOWEL_COUNT
  ) {
    return String.fromCodePoint(
      HANGUL_SYLLABLE_BASE +
        (leadingIndex * HANGUL_VOWEL_COUNT + vowelIndex) *
          HANGUL_TRAILING_COUNT,
    );
  }

  const syllableIndex = starterCodePoint - HANGUL_SYLLABLE_BASE;
  const trailingIndex = characterCodePoint - HANGUL_TRAILING_BASE;
  if (
    syllableIndex >= 0 &&
    syllableIndex < HANGUL_SYLLABLE_COUNT &&
    syllableIndex % HANGUL_TRAILING_COUNT === 0 &&
    trailingIndex > 0 &&
    trailingIndex < HANGUL_TRAILING_COUNT
  ) {
    return String.fromCodePoint(starterCodePoint + trailingIndex);
  }
  return undefined;
}

function canonicalComposition(
  starter: string,
  character: string,
): string | undefined {
  return (
    composeHangul(starter, character) ??
    canonicalCompositions[\`\${starter}\${character}\`]
  );
}

export function unicode15_1Nfc(value: string): string {
  const ordered: string[] = [];
  for (const character of value) {
    appendCanonicalDecomposition(ordered, character);
  }
  const first = ordered[0];
  if (first === undefined) {
    return "";
  }

  const composed = [first];
  let starter = first;
  let starterPosition = 0;
  let previousClass = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const character = ordered[index];
    if (character === undefined) {
      continue;
    }
    const characterClass = canonicalCombiningClass(character);
    const composite =
      previousClass === 0 || previousClass < characterClass
        ? canonicalComposition(starter, character)
        : undefined;
    if (composite !== undefined) {
      composed[starterPosition] = composite;
      starter = composite;
      continue;
    }
    if (characterClass === 0) {
      starter = character;
      starterPosition = composed.length;
    }
    composed.push(character);
    previousClass = characterClass;
  }
  return composed.join("");
}
`;
}

export async function runGenerator(arguments_) {
  assertArguments(arguments_);

  if (arguments_[0] === "--import-unicode-data") {
    const sourcePath = arguments_[1];
    if (sourcePath === undefined) {
      throw new Error("UnicodeData.txt source path is required.");
    }
    const imported = parseUnicodeData(
      await readFile(sourcePath, "utf8"),
    );
    await mkdir(join(packageRoot, "third-party-data"), {
      recursive: true,
    });
    await writeFile(
      normalizationDataPath,
      `${JSON.stringify(imported)}\n`,
      "utf8",
    );
  }

  const [
    packageManifestText,
    sourceNotice,
    normalizationDataText,
    unicodeDataText,
    normalizationTestText,
  ] = await Promise.all([
    readFile(packageManifestPath, "utf8"),
    readFile(sourceNoticePath, "utf8"),
    readFile(normalizationDataPath, "utf8"),
    readFile(unicodeDataPath, "utf8"),
    readFile(normalizationTestPath, "utf8"),
  ]);
  verifyUnicodeDataSnapshot(
    unicodeDataText,
    normalizationDataText,
  );
  if (arguments_[0] === "--check-unicode-data") {
    const sourcePath = arguments_[1];
    if (sourcePath === undefined) {
      throw new Error("UnicodeData.txt source path is required.");
    }
    verifyUnicodeDataSnapshot(
      await readFile(sourcePath, "utf8"),
      normalizationDataText,
    );
  }

  const packageManifest = JSON.parse(packageManifestText);
  const expectedPackageVersion =
    packageManifest.devDependencies?.[unicodePackageName];
  const unicodePackageManifestPath = require.resolve(
    `${unicodePackageName}/package.json`,
  );
  const unicodePackageManifest = JSON.parse(
    await readFile(unicodePackageManifestPath, "utf8"),
  );
  if (
    typeof expectedPackageVersion !== "string" ||
    expectedPackageVersion !== unicodePackageManifest.version
  ) {
    throw new Error(
      `schemas/package.json must exactly pin installed ${unicodePackageName} ${unicodePackageManifest.version}.`,
    );
  }
  if (unicodePackageManifest.license !== "MIT") {
    throw new Error(
      `${unicodePackageName} must retain its expected MIT license.`,
    );
  }

  const commonMappings = require(
    `${unicodePackageName}/Case_Folding/C/symbols.js`,
  );
  const fullMappings = require(
    `${unicodePackageName}/Case_Folding/F/symbols.js`,
  );
  const fullCompositionExclusions = require(
    `${unicodePackageName}/Binary_Property/Full_Composition_Exclusion/code-points.js`,
  );
  assertMapping("Unicode CaseFolding status C", commonMappings);
  assertMapping("Unicode CaseFolding status F", fullMappings);
  if (
    !Array.isArray(fullCompositionExclusions) ||
    fullCompositionExclusions.length === 0
  ) {
    throw new Error(
      "Unicode Full_Composition_Exclusion must be a nonempty code-point array.",
    );
  }
  for (const source of fullMappings.keys()) {
    if (commonMappings.has(source)) {
      throw new Error(
        "Unicode CaseFolding status C and F mappings unexpectedly overlap.",
      );
    }
  }

  const entries = [...commonMappings, ...fullMappings].sort(
    ([left], [right]) => compareCodePoint(left, right),
  );
  const normalizationData = validateNormalizationData(
    JSON.parse(normalizationDataText),
  );
  const tables = normalizationTables(
    normalizationData,
    fullCompositionExclusions,
  );
  verifyNormalizationConformance(
    normalizationTestText,
    tables,
  );
  const expected = sourceText(
    sourceNotice,
    entries,
    normalizationData,
    tables,
  );

  if (
    arguments_[0] === "--write" ||
    arguments_[0] === "--import-unicode-data"
  ) {
    await writeFile(generatedPath, expected, "utf8");
    return;
  }

  let actual;
  try {
    actual = await readFile(generatedPath, "utf8");
  } catch {
    throw new Error(
      "The generated portable Unicode tables are missing. Run npm run portable-unicode:update.",
    );
  }
  if (actual !== expected) {
    throw new Error(
      "The generated portable Unicode tables are stale. Run npm run portable-unicode:update and review the protocol change.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runGenerator(process.argv.slice(2));
}
