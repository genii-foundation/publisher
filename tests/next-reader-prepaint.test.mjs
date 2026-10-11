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
import test from "node:test";
import vm from "node:vm";

import {
  createReaderPreferencesStorageKey,
  serializeReaderPreferences,
} from "../packages/reader/dist/preferences.js";
import {
  createPublisherReaderPrepaintSource,
  createPublisherReaderStateBootstrapSource,
} from "../packages/next/dist/client/reader-prepaint.js";

function executeStateBootstrap(
  source,
  initial = {},
  projectionText = null,
) {
  const storage = new Map(Object.entries(initial));
  const attributes = Object.create(null);
  const writes = [];
  const context = Object.freeze({
    publicationId: "prepaint-proof",
    reportStorageKey:
      "genii.publisher.reader-state-bootstrap.v1.prepaint-proof",
    targetStorageKeys: Object.freeze({
      bookmarks: "publisher.bookmarks",
      engagement: "publisher.engagement",
      narrationPreferences: "publisher.narration",
      preferences: "publisher.preferences",
      progress: "publisher.progress",
      syncConsent: "publisher.consent",
    }),
  });
  const compiled = createPublisherReaderStateBootstrapSource({
    package: "@example/legacy-state",
    version: "1.0.0",
    sourceHash: `sha256:${"a".repeat(64)}`,
    source,
    context,
    projectionText,
  });
  const sandbox = {
    document: {
      documentElement: {
        dataset: new Proxy(attributes, {
          set(target, key, value) {
            target[key] = value;
            return true;
          },
        }),
        setAttribute(name, value) {
          if (name === "data-publisher-reader-state-bootstrap") {
            attributes.publisherReaderStateBootstrap = value;
          }
        },
      },
    },
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        writes.push([key, value]);
        storage.set(key, value);
      },
    },
  };
  vm.runInNewContext(compiled, sandbox);
  return {
    attributes,
    compiled,
    context,
    sandbox,
    storage,
    writes,
  };
}

function executePrepaint({
  publicationId = "prepaint-proof",
  stored,
} = {}) {
  const attributes = Object.create(null);
  const properties = Object.create(null);
  const requestedKeys = [];
  const source = createPublisherReaderPrepaintSource(
    publicationId,
    Object.freeze([
      Object.freeze({
        id: "serif",
        label: "Serif",
        family: "Charter, serif",
      }),
      Object.freeze({
        id: "field-sans",
        label: "Field sans",
        family: "Avenir Next, sans-serif",
      }),
    ]),
  );
  vm.runInNewContext(source, {
    TextEncoder,
    document: {
      documentElement: {
        dataset: new Proxy(attributes, {
          set(target, key, value) {
            target[key] = value;
            return true;
          },
        }),
        style: {
          setProperty(key, value) {
            properties[key] = value;
          },
        },
      },
    },
    localStorage: {
      getItem(key) {
        requestedKeys.push(key);
        return stored ?? null;
      },
    },
  });
  return { attributes, properties, requestedKeys, source };
}

test("Reader prepaint applies one fully valid publication scoped preference document", () => {
  const publicationId = "prepaint-proof";
  const stored = serializeReaderPreferences(
    {
      schemaVersion: 1,
      fontScale: 120,
      fontFamilyId: "field-sans",
      colorScheme: "black",
      motion: "reduced",
      highlights: false,
      focus: "strong",
    },
    {
      defaultFontFamilyId: "serif",
      fontFamilyIds: ["serif", "field-sans"],
    },
  );
  const result = executePrepaint({ publicationId, stored });

  assert.deepEqual(result.requestedKeys, [
    createReaderPreferencesStorageKey(publicationId),
  ]);
  assert.deepEqual({ ...result.attributes }, {
    publisherReaderScheme: "black",
    publisherReaderMotion: "reduced",
    publisherReaderFocus: "strong",
    publisherReaderHighlights: "off",
  });
  assert.deepEqual({ ...result.properties }, {
    "--publisher-reader-font-scale": "1.2",
    "--publisher-reader-font-family": "Avenir Next, sans-serif",
  });
  assert.doesNotMatch(result.source, /prepaint-proof.*<|<.*prepaint-proof/u);
});

test("Reader prepaint fails closed before changing the document", () => {
  const candidates = [
    null,
    "not json",
    JSON.stringify({
      schemaVersion: 1,
      fontScale: 500,
      fontFamilyId: "serif",
      colorScheme: "black",
      motion: "reduced",
      highlights: false,
      focus: "strong",
    }),
    JSON.stringify({
      schemaVersion: 1,
      fontScale: 120,
      fontFamilyId: "author-controlled-font",
      colorScheme: "black",
      motion: "reduced",
      highlights: false,
      focus: "strong",
    }),
    "x".repeat(16_385),
  ];

  for (const stored of candidates) {
    const result = executePrepaint({ stored });
    assert.deepEqual({ ...result.attributes }, {});
    assert.deepEqual({ ...result.properties }, {});
  }
});

test("Reader state bootstrap copies once, preserves legacy state, and reports deterministically", () => {
  const source = [
    'const legacy = localStorage.getItem("legacy.preferences");',
    "if (legacy !== null && localStorage.getItem(context.targetStorageKeys.preferences) === null) {",
    "  localStorage.setItem(context.targetStorageKeys.preferences, legacy);",
    '  return { schemaVersion: "1.0", copied: ["preferences"], refused: [] };',
    "}",
    'return { schemaVersion: "1.0", copied: [], refused: [] };',
  ].join("\n");
  const first = executeStateBootstrap(source, {
    "legacy.preferences": "accepted legacy bytes",
  });
  assert.equal(
    first.storage.get("legacy.preferences"),
    "accepted legacy bytes",
  );
  assert.equal(
    first.storage.get("publisher.preferences"),
    "accepted legacy bytes",
  );
  assert.equal(
    first.attributes.publisherReaderStateBootstrap,
    "completed",
  );
  assert.deepEqual(
    JSON.parse(first.storage.get(first.context.reportStorageKey)),
    {
      schemaVersion: "1.0",
      adapter: {
        package: "@example/legacy-state",
        version: "1.0.0",
        sourceHash: `sha256:${"a".repeat(64)}`,
      },
      status: "completed",
      copied: ["preferences"],
      refused: [],
    },
  );

  const second = executeStateBootstrap(source, {
    "legacy.preferences": "newer legacy bytes",
    "publisher.preferences": "accepted legacy bytes",
  });
  assert.equal(
    second.storage.get("publisher.preferences"),
    "accepted legacy bytes",
  );
  assert.deepEqual(
    JSON.parse(second.storage.get(second.context.reportStorageKey)).copied,
    [],
  );
});

test("Reader state bootstrap contains throws and invalid reports", () => {
  const thrown = executeStateBootstrap(
    'throw new Error("private legacy value");',
  );
  assert.equal(
    thrown.attributes.publisherReaderStateBootstrap,
    "failed",
  );
  assert.doesNotMatch(
    thrown.storage.get(thrown.context.reportStorageKey),
    /private legacy value/u,
  );

  const invalid = executeStateBootstrap(
    'return { schemaVersion: "1.0", copied: ["not valid id"], refused: [] };',
  );
  assert.equal(
    invalid.attributes.publisherReaderStateBootstrap,
    "invalid-report",
  );
  assert.deepEqual(
    JSON.parse(invalid.storage.get(invalid.context.reportStorageKey)).copied,
    [],
  );
});

test("Reader state bootstrap terminates a trailing line comment before its wrapper", () => {
  const result = executeStateBootstrap(
    'return { schemaVersion: "1.0", copied: [], refused: [] }; // sourceURL=legacy-bootstrap',
  );
  assert.equal(
    result.attributes.publisherReaderStateBootstrap,
    "completed",
  );
});

test("Reader state bootstrap uses the same ordinary function grammar it validates", () => {
  const result = executeStateBootstrap([
    "if (new.target !== undefined) throw new Error(\"constructed\");",
    'return { schemaVersion: "1.0", copied: [], refused: [] };',
  ].join("\n"));
  assert.equal(
    result.attributes.publisherReaderStateBootstrap,
    "completed",
  );
});

test("Reader state bootstrap refuses labels claimed by both outcomes", () => {
  const result = executeStateBootstrap(
    'return { schemaVersion: "1.0", copied: ["preferences"], refused: ["preferences"] };',
  );
  assert.equal(
    result.attributes.publisherReaderStateBootstrap,
    "invalid-report",
  );
});

test("Reader state bootstrap snapshots data properties and refuses accessors", () => {
  const reportAccessor = executeStateBootstrap([
    "const report = { schemaVersion: \"1.0\", refused: [] };",
    "Object.defineProperty(report, \"copied\", {",
    "  enumerable: true,",
    '  get() { return ["private-value"]; },',
    "});",
    "return report;",
  ].join("\n"));
  assert.equal(
    reportAccessor.attributes.publisherReaderStateBootstrap,
    "invalid-report",
  );
  assert.doesNotMatch(
    reportAccessor.storage.get(reportAccessor.context.reportStorageKey),
    /private-value/u,
  );

  const arrayAccessor = executeStateBootstrap([
    "const copied = [];",
    "Object.defineProperty(copied, \"0\", {",
    "  enumerable: true,",
    '  get() { return "private-value"; },',
    "});",
    "copied.length = 1;",
    'return { schemaVersion: "1.0", copied, refused: [] };',
  ].join("\n"));
  assert.equal(
    arrayAccessor.attributes.publisherReaderStateBootstrap,
    "invalid-report",
  );
  assert.doesNotMatch(
    arrayAccessor.storage.get(arrayAccessor.context.reportStorageKey),
    /private-value/u,
  );
});

test("Reader state bootstrap receives one deeply frozen projection without global exposure", () => {
  const projectionText = JSON.stringify({
    buildId: `sha256:${"b".repeat(64)}`,
    data: JSON.parse(
      '{"__proto__":{"safe":true},"nested":{"values":["proof"]}}',
    ),
    engineVersion: "1.0.0",
    publicationId: "prepaint-proof",
    schemaVersion: "1.0",
  });
  const result = executeStateBootstrap([
    "if (projection === null || !Object.isFrozen(projection) || !Object.isFrozen(projection.data) || !Object.isFrozen(projection.data.nested) || !Object.isFrozen(projection.data.nested.values)) throw new Error(\"not frozen\");",
    "if (!Object.hasOwn(projection.data, \"__proto__\") || Object.getPrototypeOf(projection.data) !== Object.prototype || Object.getPrototypeOf({}).safe !== undefined) throw new Error(\"prototype changed\");",
    "try { projection.data.nested.values[0] = \"mutated\"; } catch {}",
    "if (projection.data.nested.values[0] !== \"proof\") throw new Error(\"projection mutated\");",
    'return { schemaVersion: "1.0", copied: ["projection-proof"], refused: [] };',
  ].join("\n"), {}, projectionText);

  assert.equal(
    result.attributes.publisherReaderStateBootstrap,
    "completed",
  );
  assert.deepEqual(
    JSON.parse(result.storage.get(result.context.reportStorageKey)).copied,
    ["projection-proof"],
  );
  assert.equal(Object.hasOwn(result.sandbox, "projection"), false);
  assert.equal(Object.getPrototypeOf({}).safe, undefined);
});

test("Reader state projection script encoding contains HTML and line separator data", () => {
  const privateValue = "</script><!-- -->\u2028\u2029";
  const projectionText = JSON.stringify({
    buildId: `sha256:${"b".repeat(64)}`,
    data: { privateValue },
    engineVersion: "1.0.0",
    publicationId: "prepaint-proof",
    schemaVersion: "1.0",
  });
  const result = executeStateBootstrap([
    "if (projection.data.privateValue.length === 0) throw new Error(\"missing\");",
    'return { schemaVersion: "1.0", copied: [], refused: [] };',
  ].join("\n"), {}, projectionText);
  assert.equal(
    result.attributes.publisherReaderStateBootstrap,
    "completed",
  );
  assert.doesNotMatch(result.compiled, /<\/script|<!--|-->/u);
  assert.doesNotMatch(result.compiled, /[\u2028\u2029]/u);
  assert.equal(Object.hasOwn(result.sandbox, "projection"), false);
  assert.doesNotMatch(
    result.storage.get(result.context.reportStorageKey),
    /script|privateValue/u,
  );
});

test("Reader state projection parse failure is contained and privately reported", () => {
  const result = executeStateBootstrap(
    'return { schemaVersion: "1.0", copied: [], refused: [] };',
    {},
    "private invalid projection",
  );
  assert.equal(
    result.attributes.publisherReaderStateBootstrap,
    "failed",
  );
  assert.doesNotMatch(
    result.storage.get(result.context.reportStorageKey),
    /private invalid projection/u,
  );
});

test("Reader state bootstrap cannot corrupt renderer report locals", () => {
  const privateValue = "private_report_sentinel";
  const result = executeStateBootstrap([
    'const privateValue = localStorage.getItem("legacy.private");',
    "try { i.adapter.package = privateValue; } catch {}",
    "try { copied = [privateValue]; } catch {}",
    "try { refused = [privateValue]; } catch {}",
    "try { status = privateValue; } catch {}",
    "Object.prototype.toJSON = () => privateValue;",
    "JSON.stringify = () => privateValue;",
    "RegExp.prototype.test = () => true;",
    "return new Proxy({}, {",
    "  getPrototypeOf() {",
    "    try { copied = [privateValue]; } catch {}",
    "    throw new Error(privateValue);",
    "  },",
    "});",
  ].join("\n"), {
    "legacy.private": privateValue,
  });
  const reportText = result.storage.get(result.context.reportStorageKey);
  assert.equal(
    result.attributes.publisherReaderStateBootstrap,
    "failed",
  );
  assert.doesNotMatch(reportText, new RegExp(privateValue, "u"));
  assert.deepEqual(JSON.parse(reportText), {
    schemaVersion: "1.0",
    adapter: {
      package: "@example/legacy-state",
      version: "1.0.0",
      sourceHash: `sha256:${"a".repeat(64)}`,
    },
    status: "failed",
    copied: [],
    refused: [],
  });

  const labelBypass = executeStateBootstrap([
    "String.prototype.charCodeAt = () => 97;",
    'return { schemaVersion: "1.0", copied: [localStorage.getItem("legacy.private")], refused: [] };',
  ].join("\n"), {
    "legacy.private": "PRIVATE VALUE WITH SPACES",
  });
  const bypassReport = labelBypass.storage.get(
    labelBypass.context.reportStorageKey,
  );
  assert.equal(
    labelBypass.attributes.publisherReaderStateBootstrap,
    "invalid-report",
  );
  assert.doesNotMatch(bypassReport, /PRIVATE VALUE WITH SPACES/u);

  const arrayIndexPoison = executeStateBootstrap([
    'const privateValue = localStorage.getItem("legacy.private");',
    'Object.defineProperty(Array.prototype, "0", {',
    "  configurable: true,",
    "  get() { return privateValue; },",
    "  set() {},",
    "});",
    'return { schemaVersion: "1.0", copied: ["valid-label"], refused: [] };',
  ].join("\n"), {
    "legacy.private": privateValue,
  });
  const indexPoisonReport = arrayIndexPoison.storage.get(
    arrayIndexPoison.context.reportStorageKey,
  );
  assert.equal(
    arrayIndexPoison.attributes.publisherReaderStateBootstrap,
    "completed",
  );
  assert.deepEqual(JSON.parse(indexPoisonReport).copied, ["valid-label"]);
  assert.doesNotMatch(indexPoisonReport, new RegExp(privateValue, "u"));

  const iteratorPoison = executeStateBootstrap([
    "Array.prototype[Symbol.iterator] = function* empty() {};",
    'return { schemaVersion: "1.0", copied: ["same"], refused: ["same"] };',
  ].join("\n"));
  assert.equal(
    iteratorPoison.attributes.publisherReaderStateBootstrap,
    "invalid-report",
  );

  const stringConstructorPoison = executeStateBootstrap([
    "let stringCalls = 0;",
    "globalThis.String = () => {",
    "  stringCalls += 1;",
    '  return stringCalls <= 3 ? "0" : "length";',
    "};",
    'return { schemaVersion: "1.0", copied: ["valid-label"], refused: [] };',
  ].join("\n"));
  assert.equal(
    stringConstructorPoison.attributes.publisherReaderStateBootstrap,
    "completed",
  );
  assert.deepEqual(
    JSON.parse(stringConstructorPoison.storage.get(
      stringConstructorPoison.context.reportStorageKey,
    )).copied,
    ["valid-label"],
  );

  const proxyPoison = executeStateBootstrap([
    'const privateValue = localStorage.getItem("legacy.private");',
    "const report = {",
    '  schemaVersion: "1.0",',
    "  copied: [privateValue],",
    "  refused: [],",
    "};",
    "return new Proxy(report, {",
    "  getPrototypeOf() {",
    "    String.prototype.charCodeAt = () => 97;",
    '    Object.defineProperty(Array.prototype, "0", {',
    "      configurable: true,",
    "      get() { return privateValue; },",
    "      set() {},",
    "    });",
    "    return Object.prototype;",
    "  },",
    "});",
  ].join("\n"), {
    "legacy.private": "PRIVATE PROXY VALUE WITH SPACES",
  });
  const proxyPoisonReport = proxyPoison.storage.get(
    proxyPoison.context.reportStorageKey,
  );
  assert.equal(
    proxyPoison.attributes.publisherReaderStateBootstrap,
    "invalid-report",
  );
  assert.doesNotMatch(proxyPoisonReport, /PRIVATE PROXY VALUE WITH SPACES/u);

  for (const poisonedGlobal of ["Object", "JSON"]) {
    const globalReceiverPoison = executeStateBootstrap([
      'const privateValue = localStorage.getItem("legacy.private");',
      "const defineGlobal = Object.defineProperty;",
      "const objectPrototype = Object.prototype;",
      "const report = {",
      '  schemaVersion: "1.0",',
      '  copied: ["valid-label"],',
      "  refused: [],",
      "};",
      "return new Proxy(report, {",
      "  getPrototypeOf() {",
      `    defineGlobal(globalThis, "${poisonedGlobal}", {`,
      "      configurable: true,",
      "      get() { throw new Error(privateValue); },",
      "    });",
      "    return objectPrototype;",
      "  },",
      "});",
    ].join("\n"), {
      "legacy.private": privateValue,
    });
    const globalReceiverReport = globalReceiverPoison.storage.get(
      globalReceiverPoison.context.reportStorageKey,
    );
    assert.equal(
      globalReceiverPoison.attributes.publisherReaderStateBootstrap,
      "completed",
    );
    assert.deepEqual(
      JSON.parse(globalReceiverReport).copied,
      ["valid-label"],
    );
    assert.doesNotMatch(
      globalReceiverReport,
      new RegExp(privateValue, "u"),
    );
  }

  const documentRedirect = executeStateBootstrap([
    'const privateValue = localStorage.getItem("legacy.private");',
    "const defineGlobal = Object.defineProperty;",
    "const objectPrototype = Object.prototype;",
    "const realDataset = document.documentElement.dataset;",
    "const report = {",
    '  schemaVersion: "1.0",',
    '  copied: ["valid-label"],',
    "  refused: [],",
    "};",
    "return new Proxy(report, {",
    "  getPrototypeOf() {",
    "    realDataset.publisherReaderStateBootstrap = privateValue;",
    '    defineGlobal(globalThis, "document", {',
    "      configurable: true,",
    "      get() { return { documentElement: { dataset: {} } }; },",
    "    });",
    "    return objectPrototype;",
    "  },",
    "});",
  ].join("\n"), {
    "legacy.private": "PRIVATE STATUS SENTINEL",
  });
  const documentRedirectReport = documentRedirect.storage.get(
    documentRedirect.context.reportStorageKey,
  );
  assert.equal(
    documentRedirect.attributes.publisherReaderStateBootstrap,
    "completed",
  );
  assert.deepEqual(
    JSON.parse(documentRedirectReport).copied,
    ["valid-label"],
  );
  assert.doesNotMatch(documentRedirectReport, /PRIVATE STATUS SENTINEL/u);
});
