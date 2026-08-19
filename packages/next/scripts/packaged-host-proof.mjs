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
import {
  spawn,
  spawnSync,
} from "node:child_process";
import {
  createHash,
} from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  sep,
} from "node:path";
import {
  createServer,
} from "node:net";
import {
  tmpdir,
} from "node:os";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";
import {
  deflateSync,
} from "node:zlib";
import {
  createReaderBookmarksStorageKey,
} from "../../reader/dist/bookmarks.js";
import {
  createReaderSearchIndex,
  serializeReaderSearchIndex,
} from "../../reader/dist/search.js";
import {
  createReaderProgressCatalog,
  serializeReaderProgressCatalog,
} from "../../reader/dist/progress-catalog.js";
import {
  createReaderNarrationSectionTextProfile,
} from "../../reader/dist/narration.js";
import {
  hashCanonicalJson,
} from "../../content/dist/index.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);
const npmExecPath = process.env.npm_execpath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${options.label ?? basename(command)} exited with status ${result.status ?? "unknown"}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

function runExpectFailure(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status === 0) {
    throw new Error(
      `${options.label ?? basename(command)} unexpectedly succeeded.`,
    );
  }
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

/**
 * Whether npm failed because it could not reach the registry.
 *
 * A dependency audit that cannot talk to the registry and an audit that found a
 * vulnerability both exit nonzero, and reporting them the same way sends the reader
 * to the wrong place. This happened: a registry 400 was reported as "packed Next
 * production dependency audit exited with status 1" and read as a regression in the
 * change under test, on one runtime out of three, because the actual cause was
 * buried in the dumped output.
 *
 * A real finding is never accompanied by a registry transport error, so requiring
 * one of these markers cannot hide a vulnerability.
 */
function looksLikeRegistryFailure(output) {
  if (typeof output !== "string" || output.length === 0) {
    return false;
  }
  const mentionsRegistry =
    output.includes("registry.npmjs.org") ||
    output.includes("/-/npm/v1/security/audits");
  if (!mentionsRegistry) {
    return false;
  }
  return [
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "ECONNRESET",
    "EAI_AGAIN",
    "ERR_SOCKET",
    "network",
    "Bad Request",
    "Service Unavailable",
    "Gateway Time-out",
    "Too Many Requests",
    "socket hang up",
  ].some((marker) => output.includes(marker));
}

function runNpm(args, options = {}) {
  if (npmExecPath === undefined || npmExecPath.length === 0) {
    throw new Error(
      "The packaged host proof must run through the repository npm CLI.",
    );
  }
  try {
    return run(process.execPath, [npmExecPath, ...args], {
      ...options,
      label: options.label ?? `npm ${args[0] ?? ""}`.trim(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (looksLikeRegistryFailure(message)) {
      throw new Error(
        `The npm registry could not be reached, so ${
          options.label ?? `npm ${args[0] ?? ""}`.trim()
        } could not complete. This is a network failure rather than a finding about this package.\n${message}`,
      );
    }
    throw error;
  }
}

function withoutFocusMarkup(html) {
  let normalized = html;
  let previous;
  do {
    previous = normalized;
    normalized = normalized.replace(
      /<span(?=[^>]*class="[^"]*publisher-(?:focus|narration)-)[^>]*>([^<]*)<\/span>/gu,
      "$1",
    );
  } while (normalized !== previous);
  return normalized;
}

function packagePath(value) {
  return value.split(sep).join("/");
}

function writeJson(path, value) {
  return writeFile(
    path,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function packPackage(root, destination) {
  const packed = JSON.parse(
    runNpm(
      [
        "pack",
        "--silent",
        "--json",
        "--pack-destination",
        destination,
        root,
      ],
      {
        cwd: destination,
        label: `pack ${basename(root)}`,
      },
    ),
  );
  assert.equal(packed.length, 1);
  return join(destination, packed[0].filename);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const port = address.port;
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error === undefined) {
        resolvePromise();
      } else {
        rejectPromise(error);
      }
    });
  });
  return port;
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function withTimeout(promise, milliseconds, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolvePromise, rejectPromise) => {
        void resolvePromise;
        timeout = setTimeout(() => {
          rejectPromise(
            new Error(
              `${label} timed out after ${milliseconds} milliseconds.`,
            ),
          );
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function stopBrowser(child) {
  const hasExited = () =>
    child.exitCode !== null || child.signalCode !== null;
  if (child.pid === undefined || hasExited()) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => {
      child.once("exit", resolvePromise);
    }),
    wait(5000),
  ]);
  if (!hasExited()) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolvePromise) => {
        child.once("exit", resolvePromise);
      }),
      wait(5000),
    ]);
  }
  if (!hasExited()) {
    throw new Error(
      "Headless Chrome did not terminate after SIGKILL.",
    );
  }
}

async function startBrowser(browserExecutable, temporaryRoot) {
  if (typeof WebSocket !== "function") {
    throw new Error(
      "The Chrome hydration proof requires the Node.js built-in WebSocket client.",
    );
  }
  const profileRoot = join(temporaryRoot, "chrome-profile");
  await mkdir(profileRoot);
  const args = [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-gpu",
    "--disable-sync",
    "--headless=new",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-first-run",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileRoot}`,
    "about:blank",
  ];
  if (process.platform === "linux") {
    args.unshift("--no-sandbox");
  }
  const child = spawn(browserExecutable, args, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let launchError;
  let output = "";
  child.once("error", (error) => {
    launchError = error;
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  try {
    const activePortPath = join(
      profileRoot,
      "DevToolsActivePort",
    );
    let debugOrigin;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (launchError !== undefined) {
        throw launchError;
      }
      if (
        child.exitCode !== null ||
        child.signalCode !== null
      ) {
        throw new Error(
          `Headless Chrome exited before DevTools became ready.\n${output}`,
        );
      }
      try {
        const [portLine] = (
          await readFile(activePortPath, "utf8")
        ).trim().split("\n");
        const port = Number(portLine);
        if (
          Number.isSafeInteger(port) &&
          port > 0 &&
          port <= 65535
        ) {
          const candidate = `http://127.0.0.1:${port}`;
          const response = await fetch(
            `${candidate}/json/version`,
          );
          if (response.ok) {
            debugOrigin = candidate;
            break;
          }
        }
      } catch {
        await wait(100);
      }
    }
    if (debugOrigin === undefined) {
      throw new Error(
        `Headless Chrome did not expose DevTools.\n${output}`,
      );
    }
    return Object.freeze({
      child,
      debugOrigin,
      output: () => output,
    });
  } catch (error) {
    await stopBrowser(child);
    throw error;
  }
}

async function openDevToolsPage(browser) {
  const response = await fetch(
    `${browser.debugOrigin}/json/new?${encodeURIComponent("about:blank")}`,
    {
      method: "PUT",
    },
  );
  if (response.status !== 200) {
    throw new Error(
      `Chrome refused a DevTools page.\n${await response.text()}`,
    );
  }
  const target = await response.json();
  assert.equal(typeof target.webSocketDebuggerUrl, "string");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await withTimeout(
    new Promise((resolvePromise, rejectPromise) => {
      socket.addEventListener("open", resolvePromise, {
        once: true,
      });
      socket.addEventListener(
        "error",
        () => {
          rejectPromise(
            new Error(
              "Chrome DevTools WebSocket failed to open.",
            ),
          );
        },
        { once: true },
      );
    }),
    10000,
    "Chrome DevTools WebSocket",
  );

  let commandId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof message.id !== "number") {
      return;
    }
    const command = pending.get(message.id);
    if (command === undefined) {
      return;
    }
    pending.delete(message.id);
    if (message.error !== undefined) {
      command.reject(
        new Error(
          `Chrome DevTools command failed: ${JSON.stringify(message.error)}`,
        ),
      );
    } else {
      command.resolve(message.result);
    }
  });
  socket.addEventListener("close", () => {
    for (const command of pending.values()) {
      command.reject(
        new Error(
          "Chrome DevTools WebSocket closed before the command completed.",
        ),
      );
    }
    pending.clear();
  });

  const send = async (method, params = {}) => {
    commandId += 1;
    const id = commandId;
    const responsePromise = new Promise(
      (resolvePromise, rejectPromise) => {
        pending.set(id, {
          reject: rejectPromise,
          resolve: resolvePromise,
        });
      },
    );
    socket.send(
      JSON.stringify({
        id,
        method,
        params,
      }),
    );
    return withTimeout(
      responsePromise,
      10000,
      `Chrome DevTools ${method}`,
    );
  };

  await Promise.all([
    send("Page.enable"),
    send("Runtime.enable"),
  ]);
  return Object.freeze({
    close: () => {
      socket.close();
    },
    send,
  });
}

async function readHydratedAttribution(
  page,
  sourceCodeUrl,
  secret,
) {
  const expression = [
    "(() => {",
    '  const bodyText = document.body?.innerText ?? "";',
    "  const documentHtml = document.documentElement?.outerHTML ?? \"\";",
    "  const sourceCodeUrl =",
    `    ${JSON.stringify(sourceCodeUrl)};`,
    "  const sourceLink = Array.from(document.querySelectorAll(\"a\")).find((link) =>",
    "    link.getAttribute(\"href\") === sourceCodeUrl || link.href === sourceCodeUrl,",
    "  );",
    "  const sourceLinkStyle = sourceLink === undefined",
    "    ? undefined",
    "    : getComputedStyle(sourceLink);",
    "  const sourceLinkRect = sourceLink?.getBoundingClientRect();",
    "  return {",
    '    attributionCount: document.querySelectorAll(\'[data-publisher-attribution="required"]\').length,',
    '    hasPublishedCredit: bodyText.includes("Published with GENII Publisher"),',
    "    hasVisibleSourceLink:",
    "      (sourceLink?.innerText.trim().length ?? 0) > 0 &&",
    "      (sourceLinkRect?.width ?? 0) > 0 &&",
    "      (sourceLinkRect?.height ?? 0) > 0 &&",
    '      sourceLinkStyle?.display !== "none" &&',
    '      sourceLinkStyle?.visibility === "visible" &&',
    '      sourceLinkStyle?.opacity !== "0",',
    `    hasThrownSecret: documentHtml.includes(${JSON.stringify(secret)}),`,
    "    readyState: document.readyState,",
    "    visibleText: bodyText.slice(0, 2000),",
    "  };",
    "})()",
  ].join("\n");
  const evaluated = await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails !== undefined) {
    throw new Error(
      `Chrome DOM evaluation failed: ${JSON.stringify(evaluated.exceptionDetails)}`,
    );
  }
  return evaluated.result?.value;
}

async function assertHydratedErrorAttribution({
  browser,
  label,
  secret,
  sourceCodeUrl,
  url,
}) {
  const page = await openDevToolsPage(browser);
  try {
    const navigation = await page.send("Page.navigate", {
      url,
    });
    assert.equal(
      navigation.errorText,
      undefined,
      `${label} navigation failed: ${navigation.errorText}`,
    );
    let state;
    let evaluationError;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        state = await readHydratedAttribution(
          page,
          sourceCodeUrl,
          secret,
        );
        evaluationError = undefined;
        if (
          state?.readyState === "complete" &&
          state.attributionCount > 0 &&
          state.hasPublishedCredit === true &&
          state.hasVisibleSourceLink === true
        ) {
          await wait(250);
          state = await readHydratedAttribution(
            page,
            sourceCodeUrl,
            secret,
          );
          break;
        }
      } catch (error) {
        evaluationError = error;
      }
      await wait(100);
    }
    assert.notEqual(
      state,
      undefined,
      `${label} never exposed a DOM.\n${evaluationError instanceof Error ? evaluationError.message : ""}\n${browser.output()}`,
    );
    assert.equal(
      state.readyState,
      "complete",
      `${label} did not finish loading.`,
    );
    assert.ok(
      state.attributionCount > 0,
      `${label} omitted data-publisher-attribution=required.\n${state.visibleText}`,
    );
    assert.equal(
      state.hasPublishedCredit,
      true,
      `${label} omitted Published with GENII Publisher.\n${state.visibleText}`,
    );
    assert.equal(
      state.hasVisibleSourceLink,
      true,
      `${label} omitted a visibly rendered publication source link.\n${state.visibleText}`,
    );
    assert.equal(
      state.hasThrownSecret,
      false,
      `${label} exposed its thrown secret.`,
    );
  } finally {
    page.close();
  }
}

function createCrossTabBookmarkProof(reader, sectionPath) {
  const route = reader.routes.active.find(
    ({ path, target }) =>
      path === sectionPath && target.kind === "section",
  );
  assert.notEqual(route, undefined);
  const work = reader.works.find(
    (candidate) => candidate.id === route.target.workId,
  );
  assert.notEqual(work, undefined);
  const section = work.sections.find(
    (candidate) => candidate.id === route.target.sectionId,
  );
  assert.notEqual(section, undefined);
  const block = section.blocks.find(
    (candidate) => candidate.text.length > 0,
  );
  assert.notEqual(block, undefined);
  const quote = block.text.slice(0, Math.min(16, block.text.length));
  const point = (offset) => ({
    workId: work.id,
    sectionContinuityId: section.continuity.id,
    blockId: block.id,
    blockContentHash: block.contentHash,
    offset,
  });
  const now = Date.now();
  const bookmark = (id, note) => ({
    id,
    createdAt: now,
    updatedAt: now,
    workId: work.id,
    sectionContinuityId: section.continuity.id,
    href: sectionPath,
    quote,
    prefix: "",
    suffix: "",
    note,
    range: {
      start: point(0),
      end: point(quote.length),
    },
  });
  return Object.freeze({
    quote,
    storageKey: createReaderBookmarksStorageKey(reader.publicationId),
    state: {
      schemaVersion: 1,
      publicationId: reader.publicationId,
      bookmarks: {
        "cross-tab-proof": bookmark(
          "cross-tab-proof",
          "Cross-tab bookmark note.",
        ),
        "cross-tab-proof-second": bookmark(
          "cross-tab-proof-second",
          "Second cross-tab bookmark note.",
        ),
      },
    },
  });
}

async function assertHydratedReaderTools({
  bookmarkProof,
  browser,
  url,
}) {
  const page = await openDevToolsPage(browser);
  try {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const navigation = await page.send("Page.navigate", { url });
    assert.equal(
      navigation.errorText,
      undefined,
      `Reader tools navigation failed: ${navigation.errorText}`,
    );
    let ready;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const rail = document.querySelector(".publisher-reader-rail");',
          "  const rect = rail?.getBoundingClientRect();",
          "  return {",
          '    complete: document.readyState === "complete",',
          "    controls: rail?.querySelectorAll(\"button\").length ?? 0,",
          "    inViewport: rect !== undefined && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,",
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      ready = evaluated.result?.value;
      if (
        ready?.complete === true &&
        ready.controls === 8 &&
        ready.inViewport === true
      ) {
        break;
      }
      await wait(100);
    }
    assert.deepEqual(
      ready,
      { complete: true, controls: 8, inViewport: true },
      "The hydrated Reader rail was not reachable inside the mobile viewport.",
    );
    const progressRequestsBeforeOpen = await page.send("Runtime.evaluate", {
      expression:
        'performance.getEntriesByType("resource").filter((entry) => entry.name.includes("publication-reader-progress.json")).length',
      returnByValue: true,
    });
    assert.equal(
      progressRequestsBeforeOpen.result?.value,
      0,
      "The progress catalog loaded before its interface opened.",
    );
    const narrationRequestsBeforeOpen = await page.send("Runtime.evaluate", {
      expression:
        'performance.getEntriesByType("resource").filter((entry) => entry.name.includes("publication-audio.json")).length',
      returnByValue: true,
    });
    assert.equal(
      narrationRequestsBeforeOpen.result?.value,
      0,
      "Narration loaded before its interface opened.",
    );
    const timingRequestsBeforeOpen = await page.send("Runtime.evaluate", {
      expression:
        'performance.getEntriesByType("resource").filter((entry) => entry.name.includes("proof.timings.json")).length',
      returnByValue: true,
    });
    assert.equal(
      timingRequestsBeforeOpen.result?.value,
      0,
      "Narration timings loaded before playback started.",
    );

    const focusMarkup = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const word = document.querySelector(".publisher-manuscript .publisher-focus-word");',
        '  const block = word?.closest("[data-publisher-block]");',
        "  globalThis.__publisherFocusProof = {",
        '    wordText: word?.textContent ?? "",',
        '    blockText: block?.textContent ?? "",',
        '    manuscriptText: document.querySelector(".publisher-manuscript")?.textContent ?? "",',
        "  };",
        "  return {",
        '    wordText: word?.textContent ?? "",',
        '    blockText: block?.textContent ?? "",',
        '    emphasisCount: word?.querySelectorAll(".publisher-focus-emphasis").length ?? 0,',
        '    excludedCount: document.querySelectorAll(".publisher-manuscript code .publisher-focus-word, .publisher-manuscript pre .publisher-focus-word, .publisher-manuscript strong .publisher-focus-word").length,',
        '    narrationAnchorCount: document.querySelectorAll("[data-publisher-narration-word=true]").length,',
        "  };",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.ok(focusMarkup.result?.value?.wordText.length > 0);
    assert.ok(focusMarkup.result?.value?.blockText.length > 0);
    assert.ok(focusMarkup.result?.value?.emphasisCount > 0);
    assert.equal(focusMarkup.result?.value?.excludedCount, 0);
    assert.ok(focusMarkup.result?.value?.narrationAnchorCount > 0);

    const openedContents = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
        '    .find((candidate) => candidate.textContent?.includes("Contents"));',
        "  button?.click();",
        "  return button !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(openedContents.result?.value, true);
    let contentsContext;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "({",
          '  currentPath: document.querySelector(".publisher-reader-breadcrumbs [aria-current=page]")?.textContent ?? "",',
          '  currentOutline: document.querySelector(".publisher-reader-outline [aria-current=page]")?.textContent ?? "",',
          "})",
        ].join("\n"),
        returnByValue: true,
      });
      contentsContext = evaluated.result?.value;
      if (contentsContext?.currentPath.length > 0) break;
      await wait(50);
    }
    assert.ok(contentsContext?.currentPath.length > 0);
    assert.equal(
      contentsContext?.currentOutline,
      contentsContext?.currentPath,
    );

    const opened = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const buttons = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"));',
        '  const search = buttons.find((button) => button.textContent?.includes("Search"));',
        "  search?.click();",
        "  return search !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(opened.result?.value, true);

    let searchState;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const panel = document.querySelector(".publisher-reader-panel");',
          '  const input = panel?.querySelector("input[type=search]");',
          "  const rect = panel?.getBoundingClientRect();",
          "  return {",
          "    failed: panel?.querySelector('[role=alert]') !== null,",
          "    hasInput: input !== null && input !== undefined,",
          "    inViewport: rect !== undefined && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,",
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      searchState = evaluated.result?.value;
      if (searchState?.hasInput === true && searchState.failed === false) {
        break;
      }
      await wait(100);
    }
    assert.deepEqual(
      searchState,
      { failed: false, hasInput: true, inViewport: true },
      "The hydrated search panel was not usable inside the mobile viewport.",
    );

    const focused = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const input = document.querySelector(".publisher-reader-search input");',
        "  if (!(input instanceof HTMLInputElement)) return false;",
        "  input.focus();",
        "  return true;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(focused.result?.value, true);
    for (const character of "opening") {
      await page.send("Input.dispatchKeyEvent", {
        type: "char",
        text: character,
        unmodifiedText: character,
      });
    }
    let resultCount = 0;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "({",
          '  count: document.querySelectorAll(".publisher-reader-search-results a").length,',
          '  failed: document.querySelector(".publisher-reader-search [role=alert]") !== null,',
          '  query: document.querySelector(".publisher-reader-search input")?.value ?? "",',
          "})",
        ].join("\n"),
        returnByValue: true,
      });
      const state = evaluated.result?.value;
      assert.equal(
        state?.failed,
        false,
        "The hydrated Reader search rejected its generated artifact.",
      );
      assert.equal(state?.query, "opening");
      resultCount = state?.count ?? 0;
      if (resultCount > 0) break;
      await wait(100);
    }
    assert.ok(
      resultCount > 0,
      "The hydrated Reader search returned no result for a known section title.",
    );

    const openedProgress = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const buttons = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"));',
        '  const progress = buttons.find((button) => button.textContent?.includes("Progress"));',
        "  progress?.click();",
        '  window.dispatchEvent(new Event("scroll"));',
        '  window.dispatchEvent(new Event("scroll"));',
        "  return progress !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(openedProgress.result?.value, true);
    let renderedProgress;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const rows = Array.from(document.querySelectorAll(".publisher-reader-progress-panel dl div"));',
          "  const values = Object.fromEntries(rows.map((row) => [",
          '    row.querySelector("dt")?.textContent ?? "",',
          '    row.querySelector("dd")?.textContent ?? "",',
          "  ]));",
          '  const key = Object.keys(localStorage).find((candidate) => candidate.includes("reader.progress"));',
          "  const state = key === undefined ? null : JSON.parse(localStorage.getItem(key));",
          "  const entry = state === null ? null : Object.values(state.entries ?? {})[0] ?? null;",
          "  return {",
          '    heading: document.querySelector(".publisher-reader-progress-panel h3")?.textContent ?? "",',
          '    aggregate: document.querySelector(".publisher-reader-progress-summary")?.textContent ?? "",',
          '    mapCount: document.querySelectorAll(".publisher-reader-progress-map li").length,',
          '    requestCount: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("publication-reader-progress.json")).length,',
          '    panelInViewport: (() => { const rect = document.querySelector(".publisher-reader-panel")?.getBoundingClientRect(); return rect !== undefined && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; })(),',
          "    openCount: entry?.openCount ?? 0,",
          "    readingTimeMs: entry?.readingTimeMs ?? 0,",
          "    status: values.Status ?? \"\",",
          "    visits: values.Visits ?? \"\",",
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      renderedProgress = evaluated.result?.value;
      if (renderedProgress?.readingTimeMs > 0 && renderedProgress.mapCount > 0) break;
      await wait(100);
    }
    assert.equal(renderedProgress?.openCount, 1);
    assert.equal(renderedProgress?.visits, "1");
    assert.ok(renderedProgress?.heading.length > 0);
    assert.match(renderedProgress?.aggregate ?? "", /% complete across/u);
    assert.ok(renderedProgress?.mapCount > 0);
    assert.equal(renderedProgress?.requestCount, 1);
    assert.equal(renderedProgress?.panelInViewport, true);
    assert.ok(renderedProgress?.status.length > 0);
    assert.ok(
      renderedProgress?.readingTimeMs > 0,
      "The default Reader did not accumulate visible active reading time.",
    );

    const openedNarration = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
        '    .find((candidate) => candidate.textContent?.includes("Listen"));',
        "  button?.click();",
        "  return button !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(openedNarration.result?.value, true, "Listen button was unavailable.");
    let narrationState;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const panel = document.querySelector(".publisher-reader-narration");',
          '  const now = panel?.querySelector(".publisher-reader-narration-now strong")?.textContent ?? "";',
          "  return {",
          '    alert: panel?.querySelector("[role=alert]")?.textContent ?? "",',
          '    audioRequestCount: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("publication-audio.json")).length,',
          '    now,',
          '    queue: panel?.querySelector(".publisher-reader-narration-now small")?.textContent ?? "",',
          '    selects: panel?.querySelectorAll("select").length ?? 0,',
          '    summary: panel?.querySelector(".publisher-reader-narration-summary")?.textContent ?? "",',
          '    inViewport: (() => { const rect = document.querySelector(".publisher-reader-panel")?.getBoundingClientRect(); return rect !== undefined && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; })(),',
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      narrationState = evaluated.result?.value;
      if (narrationState?.now.length > 0 && narrationState.selects === 2) break;
      await wait(50);
    }
    assert.equal(narrationState?.alert, "");
    assert.equal(narrationState?.audioRequestCount, 1);
    assert.ok(narrationState?.now.length > 0);
    assert.match(narrationState?.queue ?? "", /of 2 recordings/u);
    assert.equal(narrationState?.selects, 2);
    assert.match(narrationState?.summary ?? "", /recorded across 2 timed clips/u);
    assert.equal(narrationState?.inViewport, true, "Listen panel escaped the viewport.");
    const timingRequestsBeforePlayback = await page.send("Runtime.evaluate", {
      expression:
        'performance.getEntriesByType("resource").filter((entry) => entry.name.includes("proof.timings.json")).length',
      returnByValue: true,
    });
    assert.equal(
      timingRequestsBeforePlayback.result?.value,
      0,
      "Narration timings loaded before the recording played.",
    );

    const playCenter = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const button = Array.from(document.querySelectorAll(".publisher-reader-narration-controls button"))',
        '    .find((candidate) => candidate.textContent === "Play");',
        "  const rect = button?.getBoundingClientRect();",
        "  return rect === undefined ? null : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.ok(playCenter.result?.value);
    await page.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      x: playCenter.result.value.x,
      y: playCenter.result.value.y,
    });
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      x: playCenter.result.value.x,
      y: playCenter.result.value.y,
    });
    let playbackStarted = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression:
          '(() => { const audio = document.querySelector(".publisher-reader-audio-host > audio"); return audio instanceof HTMLAudioElement && !audio.paused && audio.currentTime > 0; })()',
        returnByValue: true,
      });
      playbackStarted = evaluated.result?.value === true;
      if (playbackStarted) break;
      await wait(25);
    }
    assert.equal(playbackStarted, true, "The default narration player did not start its recording.");
    const soughtNarration = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const audio = document.querySelector(".publisher-reader-audio-host > audio");',
        "  if (!(audio instanceof HTMLAudioElement)) return false;",
        "  audio.currentTime = 4;",
        '  audio.dispatchEvent(new Event("timeupdate"));',
        "  return true;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(soughtNarration.result?.value, true, "Persistent audio element was unavailable for timing proof.");

    const refusedNarrationIntent = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const link = document.querySelector(".publisher-reader-narration-now a");',
        "  if (!(link instanceof HTMLAnchorElement)) return null;",
        '  const event = new CustomEvent("genii:publisher-reader-narration-navigation", {',
        "    cancelable: true,",
        "    detail: {",
        '      publicationId: "renderer-proof",',
        '      sectionId: document.querySelector("[data-publisher-section]")?.getAttribute("data-publisher-section") ?? "",',
        '      href: "/wrong-destination",',
        "    },",
        "  });",
        "  window.dispatchEvent(event);",
        "  return event.defaultPrevented;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(refusedNarrationIntent.result?.value, false);

    let timingState;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const activeWord = document.querySelector(".publisher-narration-word-current");',
          "  return {",
          '    activeWord: activeWord?.textContent ?? "",',
          '    audioCurrentTime: document.querySelector(".publisher-reader-audio-host > audio")?.currentTime ?? -1,',
          '    audioPaused: document.querySelector(".publisher-reader-audio-host > audio")?.paused ?? true,',
          '    narrationAnchorCount: document.querySelectorAll("[data-publisher-narration-word=true]").length,',
          '    manuscriptUnchanged: (document.querySelector(".publisher-manuscript")?.textContent ?? "") === globalThis.__publisherFocusProof.manuscriptText,',
          '    requestCount: performance.getEntriesByType("resource").filter((entry) => entry.name.includes("proof.timings.json")).length,',
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      timingState = evaluated.result?.value;
      if (timingState?.activeWord.length > 0) break;
      await wait(25);
    }
    assert.equal(timingState?.requestCount, 1);
    assert.ok(
      timingState?.activeWord.length > 0,
      JSON.stringify(timingState),
    );
    assert.equal(timingState?.manuscriptUnchanged, true, "Narration changed manuscript text.");

    const sameSectionNavigation = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const link = document.querySelector(".publisher-reader-narration-now a");',
        "  if (!(link instanceof HTMLAnchorElement)) return null;",
        '  globalThis.__publisherNarrationNavigationHandled = false;',
        '  window.addEventListener("genii:publisher-reader-narration-navigation", (event) => {',
        '    globalThis.__publisherNarrationNavigationHandled = event.defaultPrevented;',
        "  }, { once: true });",
        '  globalThis.__publisherNarrationNavigationTarget = `${new URL(link.href).pathname}${new URL(link.href).hash}`;',
        "  link.click();",
        "  return globalThis.__publisherNarrationNavigationTarget;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(typeof sameSectionNavigation.result?.value, "string");
    let sameSectionNavigationState;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const audio = document.querySelector(".publisher-reader-audio-host > audio");',
          "  return {",
          '    handled: globalThis.__publisherNarrationNavigationHandled === true,',
          '    playing: audio instanceof HTMLAudioElement && !audio.paused,',
          '    route: `${location.pathname}${location.hash}`,',
          '    target: globalThis.__publisherNarrationNavigationTarget ?? "",',
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      sameSectionNavigationState = evaluated.result?.value;
      if (
        sameSectionNavigationState?.handled === true &&
        sameSectionNavigationState.playing === true &&
        sameSectionNavigationState.route === sameSectionNavigationState.target
      ) break;
      await wait(25);
    }
    assert.deepEqual(sameSectionNavigationState, {
      handled: true,
      playing: true,
      route: sameSectionNavigation.result.value,
      target: sameSectionNavigation.result.value,
    });

    const queueAdvanced = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const buttons = Array.from(document.querySelectorAll(".publisher-reader-narration-controls button"));',
        '  const button = buttons.find((candidate) => !candidate.disabled && (candidate.textContent === "Next" || candidate.textContent === "Previous"));',
        '  const before = document.querySelector(".publisher-reader-narration-now strong")?.textContent ?? "";',
        "  button?.click();",
        "  return { before, moved: button !== undefined };",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(queueAdvanced.result?.value?.moved, true, "Narration queue could not move.");
    let advancedTitle = queueAdvanced.result?.value?.before ?? "";
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression:
          'document.querySelector(".publisher-reader-narration-now strong")?.textContent ?? ""',
        returnByValue: true,
      });
      advancedTitle = evaluated.result?.value ?? "";
      if (advancedTitle !== queueAdvanced.result?.value?.before) break;
      await wait(25);
    }
    assert.notEqual(advancedTitle, queueAdvanced.result?.value?.before);

    const crossRouteNavigation = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const link = document.querySelector(".publisher-reader-narration-now a");',
        "  if (!(link instanceof HTMLAnchorElement)) return null;",
        '  globalThis.__publisherNarrationCrossRouteTarget = `${new URL(link.href).pathname}${new URL(link.href).hash}`;',
        '  globalThis.__publisherNarrationCrossRouteTitle = document.querySelector(".publisher-reader-narration-now strong")?.textContent ?? "";',
        "  link.click();",
        "  return globalThis.__publisherNarrationCrossRouteTarget;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(typeof crossRouteNavigation.result?.value, "string");
    assert.notEqual(
      crossRouteNavigation.result.value,
      sameSectionNavigation.result.value,
    );
    let crossRouteNavigationState;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const audio = document.querySelector(".publisher-reader-audio-host > audio");',
          "  return {",
          '    panelOpen: document.querySelector(".publisher-reader-narration") !== null,',
          '    playing: audio instanceof HTMLAudioElement && !audio.paused,',
          '    route: `${location.pathname}${location.hash}`,',
          '    target: globalThis.__publisherNarrationCrossRouteTarget ?? "",',
          '    title: document.querySelector(".publisher-reader-narration-now strong")?.textContent ?? "",',
          '    targetTitle: globalThis.__publisherNarrationCrossRouteTitle ?? "",',
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      crossRouteNavigationState = evaluated.result?.value;
      if (
        crossRouteNavigationState?.panelOpen === true &&
        crossRouteNavigationState.playing === true &&
        crossRouteNavigationState.route === crossRouteNavigationState.target &&
        crossRouteNavigationState.title === crossRouteNavigationState.targetTitle
      ) break;
      await wait(25);
    }
    assert.deepEqual(crossRouteNavigationState, {
      panelOpen: true,
      playing: true,
      route: crossRouteNavigation.result.value,
      target: crossRouteNavigation.result.value,
      title: advancedTitle,
      targetTitle: advancedTitle,
    });
    await page.send("Runtime.evaluate", {
      expression: "history.back()",
    });
    let originalNarrationRouteRestored = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => ({",
          '  manuscript: (document.querySelector(".publisher-manuscript")?.textContent ?? "") === globalThis.__publisherFocusProof.manuscriptText,',
          '  route: `${location.pathname}${location.hash}` === globalThis.__publisherNarrationNavigationTarget,',
          "}))()",
        ].join("\n"),
        returnByValue: true,
      });
      originalNarrationRouteRestored =
        evaluated.result?.value?.manuscript === true &&
        evaluated.result.value.route === true;
      if (originalNarrationRouteRestored) break;
      await wait(25);
    }
    assert.equal(
      originalNarrationRouteRestored,
      true,
      "The packed proof could not restore its original manuscript route.",
    );

    const narrationPreference = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const selects = document.querySelectorAll(".publisher-reader-narration select");',
        "  const voice = selects[0];",
        "  const speed = selects[1];",
        "  if (!(voice instanceof HTMLSelectElement) || !(speed instanceof HTMLSelectElement)) return null;",
        '  voice.value = "bright";',
        '  voice.dispatchEvent(new Event("change", { bubbles: true }));',
        '  speed.value = "1.5";',
        '  speed.dispatchEvent(new Event("change", { bubbles: true }));',
        '  const key = Object.keys(localStorage).find((candidate) => candidate.endsWith(".narration"));',
        "  return key === undefined ? null : { key, value: JSON.parse(localStorage.getItem(key)) };",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    let savedNarrationPreference = narrationPreference.result?.value;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        savedNarrationPreference?.value?.selectedVoiceId === "bright" &&
        savedNarrationPreference?.value?.playbackRate === 1.5
      ) break;
      await wait(25);
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const key = Object.keys(localStorage).find((candidate) => candidate.endsWith(".narration"));',
          "  return key === undefined ? null : { key, value: JSON.parse(localStorage.getItem(key)) };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      savedNarrationPreference = evaluated.result?.value;
    }
    assert.equal(savedNarrationPreference?.value?.selectedVoiceId, "bright");
    assert.equal(savedNarrationPreference?.value?.playbackRate, 1.5);

    const openedSettings = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
        '    .find((candidate) => candidate.textContent?.includes("Settings"));',
        "  button?.click();",
        "  return button !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(openedSettings.result?.value, true);
    let settingsReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression:
          'document.querySelectorAll(".publisher-reader-settings select").length === 5 && document.querySelector(".publisher-reader-settings input[type=checkbox]") !== null',
        returnByValue: true,
      });
      settingsReady = evaluated.result?.value === true;
      if (settingsReady) break;
      await wait(50);
    }
    assert.equal(settingsReady, true, "The default settings panel omitted a Reader preference.");
    await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const labels = Array.from(document.querySelectorAll(".publisher-reader-settings label"));',
        '  const select = labels.find((label) => label.textContent?.includes("Color"))?.querySelector("select");',
        "  if (!(select instanceof HTMLSelectElement)) return false;",
        '  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;',
        '  setter?.call(select, "dark");',
        '  select.dispatchEvent(new Event("change", { bubbles: true }));',
        "  return true;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    let darkPreference = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const key = Object.keys(localStorage).find((candidate) => candidate.includes("reader.preferences"));',
          "  const saved = key === undefined ? null : JSON.parse(localStorage.getItem(key));",
          '  return document.documentElement.dataset.publisherReaderScheme === "dark" && saved?.colorScheme === "dark";',
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      darkPreference = evaluated.result?.value === true;
      if (darkPreference) break;
      await wait(50);
    }
    assert.equal(darkPreference, true, "The default settings interface did not persist and apply color.");

    const changedFocus = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const labels = Array.from(document.querySelectorAll(".publisher-reader-settings label"));',
        '  const select = labels.find((label) => label.textContent?.includes("Focus"))?.querySelector("select");',
        "  if (!(select instanceof HTMLSelectElement)) return false;",
        '  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;',
        '  setter?.call(select, "strong");',
        '  select.dispatchEvent(new Event("change", { bubbles: true }));',
        "  return true;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(changedFocus.result?.value, true);
    let strongFocus;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const key = Object.keys(localStorage).find((candidate) => candidate.includes("reader.preferences"));',
          "  const saved = key === undefined ? null : JSON.parse(localStorage.getItem(key));",
          '  const word = document.querySelector(".publisher-manuscript .publisher-focus-word");',
          '  const block = word?.closest("[data-publisher-block]");',
          '  const emphasis = word?.querySelector(".publisher-focus-emphasis");',
          "  return {",
          '    applied: document.documentElement.dataset.publisherReaderFocus === "strong",',
          '    persisted: saved?.focus === "strong",',
          '    weight: emphasis === null || emphasis === undefined ? "" : getComputedStyle(emphasis).fontWeight,',
          '    wordPreserved: word?.textContent === globalThis.__publisherFocusProof?.wordText,',
          '    blockPreserved: block?.textContent === globalThis.__publisherFocusProof?.blockText,',
          '    excludedCount: document.querySelectorAll(".publisher-manuscript code .publisher-focus-word, .publisher-manuscript pre .publisher-focus-word, .publisher-manuscript strong .publisher-focus-word").length,',
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      strongFocus = evaluated.result?.value;
      if (strongFocus?.applied === true && strongFocus.persisted === true) break;
      await wait(50);
    }
    assert.deepEqual(strongFocus, {
      applied: true,
      persisted: true,
      weight: "650",
      wordPreserved: true,
      blockPreserved: true,
      excludedCount: 0,
    });

    const openedSync = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const buttons = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"));',
        '  const sync = buttons.find((button) => button.textContent?.includes("Sync"));',
        "  sync?.click();",
        "  return sync !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(openedSync.result?.value, true);
    let signedOutReady = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression:
          'document.querySelector(".publisher-reader-sync input[type=email]") !== null',
        returnByValue: true,
      });
      signedOutReady = evaluated.result?.value === true;
      if (signedOutReady) break;
      await wait(100);
    }
    assert.equal(signedOutReady, true, "The sync panel did not reach its signed-out state.");
    const emailFocused = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const input = document.querySelector(".publisher-reader-sync input[type=email]");',
        "  if (!(input instanceof HTMLInputElement)) return false;",
        "  input.focus();",
        "  return true;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(emailFocused.result?.value, true);
    for (const character of "reader@example.com") {
      await page.send("Input.dispatchKeyEvent", {
        type: "char",
        text: character,
        unmodifiedText: character,
      });
    }
    const submittedEmail = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const button = Array.from(document.querySelectorAll(".publisher-reader-sync button"))',
        '    .find((candidate) => candidate.textContent?.includes("Sign in to sync"));',
        "  button?.click();",
        "  return button !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(submittedEmail.result?.value, true);
    const continued = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const button = Array.from(document.querySelectorAll(".publisher-reader-sync-consent button"))',
        '    .find((candidate) => candidate.textContent?.includes("Continue"));',
        "  button?.click();",
        "  return button !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(continued.result?.value, true);
    let consentState;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const code = document.querySelector(".publisher-reader-sync input[autocomplete=one-time-code]");',
          "  const key = Object.keys(localStorage).find((candidate) => candidate.includes(\"sync-consent\"));",
          "  return { hasCode: code !== null, consent: key === undefined ? null : JSON.parse(localStorage.getItem(key)) };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      consentState = evaluated.result?.value;
      if (consentState?.hasCode === true) break;
      await wait(100);
    }
    assert.equal(consentState?.consent?.granted, true);
    assert.equal(consentState?.consent?.copyVersion, "1.0");
    const codeFocused = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const input = document.querySelector(".publisher-reader-sync input[autocomplete=one-time-code]");',
        "  if (!(input instanceof HTMLInputElement)) return false;",
        "  input.focus();",
        "  return true;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(codeFocused.result?.value, true);
    for (const character of "12345678") {
      await page.send("Input.dispatchKeyEvent", {
        type: "char",
        text: character,
        unmodifiedText: character,
      });
    }
    await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const button = Array.from(document.querySelectorAll(".publisher-reader-sync button"))',
        '    .find((candidate) => candidate.textContent?.includes("Verify code"));',
        "  button?.click();",
        "})()",
      ].join("\n"),
    });
    let signedIn = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression:
          'document.querySelector(".publisher-reader-sync-account")?.textContent?.includes("reader@example.com") === true',
        returnByValue: true,
      });
      signedIn = evaluated.result?.value === true;
      if (signedIn) break;
      await wait(100);
    }
    assert.equal(signedIn, true, "The default sync controls did not complete code sign-in.");
    let synchronizedState;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          "  const read = (fragment) => {",
          "    const key = Object.keys(localStorage).find((candidate) => candidate.includes(fragment));",
          "    return key === undefined ? null : JSON.parse(localStorage.getItem(key));",
          "  };",
          '  const progress = read("reader.progress");',
          '  const bookmarks = read("reader.bookmarks");',
          '  const consent = read("reader.sync-consent");',
          '  const engagement = read("reader.engagement");',
          "  return {",
          '    message: document.querySelector(".publisher-reader-sync [role=status]")?.textContent ?? "",',
          "    progressEntries: progress === null ? 0 : Object.keys(progress.entries ?? {}).length,",
          "    bookmarksSchemaVersion: bookmarks?.schemaVersion ?? null,",
          "    consentGranted: consent?.granted === true,",
          "    acknowledgedEvents: engagement?.events?.filter((event) => Number.isSafeInteger(event.syncedAt)).length ?? 0,",
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      synchronizedState = evaluated.result?.value;
      if (
        synchronizedState?.message === "Reading data synced." &&
        synchronizedState.acknowledgedEvents > 0
      ) break;
      await wait(100);
    }
    assert.deepEqual(
      synchronizedState,
      {
        message: "Reading data synced.",
        progressEntries: 2,
        bookmarksSchemaVersion: null,
        consentGranted: true,
        acknowledgedEvents: 3,
      },
      "The default Reader did not complete and acknowledge its routed local-first synchronization transfer.",
    );
    const peerPage = await openDevToolsPage(browser);
    try {
      await peerPage.send("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      const peerNavigation = await peerPage.send("Page.navigate", { url });
      assert.equal(
        peerNavigation.errorText,
        undefined,
        `Peer Reader navigation failed: ${peerNavigation.errorText}`,
      );
      let peerReady = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const evaluated = await peerPage.send("Runtime.evaluate", {
          expression: [
            "({",
            '  complete: document.readyState === "complete",',
            '  controls: document.querySelectorAll(".publisher-reader-rail-actions button").length,',
            "})",
          ].join("\n"),
          returnByValue: true,
        });
        peerReady =
          evaluated.result?.value?.complete === true &&
          evaluated.result.value.controls === 8;
        if (peerReady) break;
        await wait(100);
      }
      assert.equal(peerReady, true, "The peer Reader tab did not hydrate.");
      const peerWrite = await peerPage.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          `  localStorage.setItem(${JSON.stringify(bookmarkProof.storageKey)}, JSON.stringify(${JSON.stringify(bookmarkProof.state)}));`,
          "  return true;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(peerWrite.result?.value, true);

      let crossTabQuote = "";
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
            '    .find((candidate) => candidate.textContent?.includes("Bookmarks"));',
            "  if (button?.getAttribute(\"aria-expanded\") !== \"true\") button?.click();",
            '  return document.querySelector(".publisher-reader-bookmarks q")?.textContent ?? "";',
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        crossTabQuote = evaluated.result?.value ?? "";
        if (crossTabQuote === bookmarkProof.quote) break;
        await wait(100);
      }
      assert.equal(
        crossTabQuote,
        bookmarkProof.quote,
        "The first Reader tab did not render bookmark state written by its peer tab.",
      );
      const bookmarkInSearch = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const searchButton = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
          '    .find((candidate) => candidate.textContent?.includes("Search"));',
          "  searchButton?.click();",
          "  return searchButton !== undefined;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(bookmarkInSearch.result?.value, true);
      let bookmarkSearchInputReady = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const input = document.querySelector(".publisher-reader-search input[type=search]");',
            "  if (!(input instanceof HTMLInputElement)) return false;",
            '  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;',
            `  setter?.call(input, ${JSON.stringify(bookmarkProof.quote)});`,
            '  input.dispatchEvent(new Event("input", { bubbles: true }));',
            "  return true;",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        bookmarkSearchInputReady = evaluated.result?.value === true;
        if (bookmarkSearchInputReady) break;
        await wait(50);
      }
      assert.equal(bookmarkSearchInputReady, true);
      let bookmarkSearchQuote = "";
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression:
            'document.querySelector(".publisher-reader-search-bookmarks q")?.textContent ?? ""',
          returnByValue: true,
        });
        bookmarkSearchQuote = evaluated.result?.value ?? "";
        if (bookmarkSearchQuote === bookmarkProof.quote) break;
        await wait(50);
      }
      assert.equal(
        bookmarkSearchQuote,
        bookmarkProof.quote,
        "The publication search did not include the reactive saved-passage state.",
      );
      const openedBookmarkProgress = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
          '    .find((candidate) => candidate.textContent?.includes("Progress"));',
          "  button?.click();",
          "  return button !== undefined;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(openedBookmarkProgress.result?.value, true);
      let bookmarkProgressReady = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const summary = document.querySelector(".publisher-reader-progress-overview")?.textContent ?? "";',
            '  const saved = document.querySelector(".publisher-reader-progress-map small")?.textContent ?? "";',
            '  return summary.includes("1 section with saved passages") && saved.includes("saved passage");',
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        bookmarkProgressReady = evaluated.result?.value === true;
        if (bookmarkProgressReady) break;
        await wait(50);
      }
      assert.equal(
        bookmarkProgressReady,
        true,
        "The progress surface did not react to bookmark state written by its peer tab.",
      );
      await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
          '    .find((candidate) => candidate.textContent?.includes("Bookmarks"));',
          "  button?.click();",
          "})()",
        ].join("\n"),
      });
      let bookmarkPanelReady = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression:
            'document.querySelector(".publisher-reader-bookmark-tools input[type=search]") !== null',
          returnByValue: true,
        });
        bookmarkPanelReady = evaluated.result?.value === true;
        if (bookmarkPanelReady) break;
        await wait(50);
      }
      assert.equal(bookmarkPanelReady, true);
      const setBookmarkQuery = async (value) => page.send("Runtime.evaluate", {
        expression: [
          "((value) => {",
          '  const input = document.querySelector(".publisher-reader-bookmark-tools input[type=search]");',
          "  if (!(input instanceof HTMLInputElement)) return false;",
          '  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;',
          "  setter?.call(input, value);",
          '  input.dispatchEvent(new Event("input", { bubbles: true }));',
          "  return true;",
          `})(${JSON.stringify(value)})`,
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(
        (await setBookmarkQuery(bookmarkProof.quote.slice(0, 5))).result?.value,
        true,
      );
      let filteredQuote = "";
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression:
            'document.querySelector(".publisher-reader-bookmarks q")?.textContent ?? ""',
          returnByValue: true,
        });
        filteredQuote = evaluated.result?.value ?? "";
        if (filteredQuote === bookmarkProof.quote) break;
        await wait(50);
      }
      assert.equal(filteredQuote, bookmarkProof.quote);
      assert.equal((await setBookmarkQuery("no such saved passage")).result?.value, true);
      let emptySearch = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression:
            'document.querySelector(".publisher-reader-bookmark-panel")?.textContent?.includes("No saved passages match this search.") === true',
          returnByValue: true,
        });
        emptySearch = evaluated.result?.value === true;
        if (emptySearch) break;
        await wait(50);
      }
      assert.equal(emptySearch, true, "The default bookmark query did not render its empty state.");
      assert.equal((await setBookmarkQuery("")).result?.value, true);
      const exported = await page.send("Runtime.evaluate", {
        expression: [
          "(async () => {",
          "  let captured;",
          "  const original = URL.createObjectURL.bind(URL);",
          "  URL.createObjectURL = (blob) => { captured = blob; return original(blob); };",
          '  const button = Array.from(document.querySelectorAll(".publisher-reader-bookmark-tools button"))',
          '    .find((candidate) => candidate.textContent?.includes("Export saved passages"));',
          "  button?.click();",
          '  return captured instanceof Blob ? await captured.text() : "";',
          "})()",
        ].join("\n"),
        awaitPromise: true,
        returnByValue: true,
      });
      const exportedText = exported.result?.value ?? "";
      assert.match(exportedText, /GENII Publisher saved passages/u);
      assert.ok(exportedText.includes(bookmarkProof.quote));
      assert.match(exportedText, /Cross-tab bookmark note\./u);
      assert.ok(exportedText.includes(bookmarkProof.state.bookmarks["cross-tab-proof"].href));
      const requestSingleRemoval = async () => page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const button = document.querySelector(".publisher-reader-bookmarks li button");',
          "  button?.click();",
          "  return button !== null;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal((await requestSingleRemoval()).result?.value, true);
      const singleConfirmation = await page.send("Runtime.evaluate", {
        expression: [
          "({",
          '  dialog: document.querySelector(".publisher-reader-bookmark-delete")?.textContent ?? "",',
          '  focused: document.activeElement?.textContent ?? "",',
          "})",
        ].join("\n"),
        returnByValue: true,
      });
      assert.match(singleConfirmation.result?.value?.dialog ?? "", /Remove this saved passage\?/u);
      assert.equal(singleConfirmation.result?.value?.focused, "Remove");
      const cancelled = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const button = Array.from(document.querySelectorAll(".publisher-reader-bookmark-delete button"))',
          '    .find((candidate) => candidate.textContent === "Cancel");',
          "  button?.click();",
          '  return document.querySelectorAll(".publisher-reader-bookmarks li").length;',
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(cancelled.result?.value, 2);
      assert.equal((await requestSingleRemoval()).result?.value, true);
      await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const button = Array.from(document.querySelectorAll(".publisher-reader-bookmark-delete button"))',
          '    .find((candidate) => candidate.textContent === "Remove");',
          "  button?.click();",
          "})()",
        ].join("\n"),
      });
      let remainingBookmarks = 2;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression:
            'document.querySelectorAll(".publisher-reader-bookmarks li").length',
          returnByValue: true,
        });
        remainingBookmarks = evaluated.result?.value ?? 2;
        if (remainingBookmarks === 1) break;
        await wait(50);
      }
      assert.equal(remainingBookmarks, 1);
      const requestedBulkRemoval = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const button = Array.from(document.querySelectorAll(".publisher-reader-bookmark-tools button"))',
          '    .find((candidate) => candidate.textContent?.includes("Remove all saved passages"));',
          "  button?.click();",
          "  return button !== undefined;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(requestedBulkRemoval.result?.value, true);
      const bulkConfirmation = await page.send("Runtime.evaluate", {
        expression:
          'document.querySelector(".publisher-reader-bookmark-delete")?.textContent ?? ""',
        returnByValue: true,
      });
      assert.match(bulkConfirmation.result?.value ?? "", /Remove all saved passages\?/u);
      await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const button = Array.from(document.querySelectorAll(".publisher-reader-bookmark-delete button"))',
          '    .find((candidate) => candidate.textContent === "Remove");',
          "  button?.click();",
          "})()",
        ].join("\n"),
      });
      let deletionState;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            `  const state = JSON.parse(localStorage.getItem(${JSON.stringify(bookmarkProof.storageKey)}));`,
            "  const entries = Object.values(state.bookmarks ?? {});",
            "  return {",
            "    live: entries.filter((bookmark) => bookmark.deletedAt === undefined).length,",
            "    tombstones: entries.filter((bookmark) => Number.isSafeInteger(bookmark.deletedAt)).length,",
            '    empty: document.querySelector(".publisher-reader-panel")?.textContent?.includes("No saved passages yet") === true,',
            "  };",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        deletionState = evaluated.result?.value;
        if (deletionState?.live === 0 && deletionState.tombstones === 2) break;
        await wait(50);
      }
      assert.deepEqual(deletionState, { live: 0, tombstones: 2, empty: true });
      const selectedPassage = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const block = document.querySelector(".publisher-manuscript [data-publisher-block]");',
          "  if (!(block instanceof HTMLElement)) return null;",
          '  block.scrollIntoView({ block: "center" });',
          '  const match = /\\S{4,}/u.exec(block.textContent ?? "");',
          "  if (match === null || match.index === undefined) return null;",
          "  const startOffset = match.index;",
          "  const endOffset = match.index + Math.min(match[0].length, 12);",
          "  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);",
          "  let consumed = 0;",
          "  let startNode = null;",
          "  let startNodeOffset = 0;",
          "  let endNode = null;",
          "  let endNodeOffset = 0;",
          "  let node = walker.nextNode();",
          "  while (node instanceof Text) {",
          "    const length = node.data.length;",
          "    if (startNode === null && startOffset >= consumed && startOffset <= consumed + length) {",
          "      startNode = node;",
          "      startNodeOffset = startOffset - consumed;",
          "    }",
          "    if (endOffset >= consumed && endOffset <= consumed + length) {",
          "      endNode = node;",
          "      endNodeOffset = endOffset - consumed;",
          "      break;",
          "    }",
          "    consumed += length;",
          "    node = walker.nextNode();",
          "  }",
          "  if (!(startNode instanceof Text) || !(endNode instanceof Text)) return null;",
          "  const range = document.createRange();",
          "  range.setStart(startNode, startNodeOffset);",
          "  range.setEnd(endNode, endNodeOffset);",
          "  const selection = window.getSelection();",
          "  selection?.removeAllRanges();",
          "  selection?.addRange(range);",
          '  document.dispatchEvent(new Event("selectionchange"));',
          "  return { blockId: block.dataset.publisherBlock, quote: range.toString() };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.ok(selectedPassage.result?.value?.quote.length >= 4);
      let selectionAction;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const button = document.querySelector(".publisher-reader-selection-action");',
            "  const rect = button?.getBoundingClientRect();",
            "  return {",
            "    visible: button !== null && rect !== undefined && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,",
            '    text: button?.textContent ?? "",',
            "  };",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        selectionAction = evaluated.result?.value;
        if (selectionAction?.text === "Save passage") break;
        await wait(50);
      }
      assert.deepEqual(selectionAction, { visible: true, text: "Save passage" });
      await page.send("Runtime.evaluate", {
        expression:
          'document.querySelector(".publisher-reader-selection-action")?.click()',
      });
      let selectionEditor;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const editor = document.querySelector(".publisher-reader-selection-editor");',
            '  const note = editor?.querySelector("textarea");',
            "  const rect = editor?.getBoundingClientRect();",
            "  return {",
            "    focused: document.activeElement === note,",
            "    visible: editor !== null && rect !== undefined && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,",
            "  };",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        selectionEditor = evaluated.result?.value;
        if (selectionEditor?.focused === true) break;
        await wait(50);
      }
      assert.deepEqual(selectionEditor, { focused: true, visible: true });
      const selectionNote = "Return to this selected passage.";
      const enteredSelectionNote = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const note = document.querySelector(".publisher-reader-selection-editor textarea");',
          "  if (!(note instanceof HTMLTextAreaElement)) return false;",
          '  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;',
          `  setter?.call(note, ${JSON.stringify("Return to this selected passage.")});`,
          '  note.dispatchEvent(new Event("input", { bubbles: true }));',
          '  note.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "e" }));',
          "  return true;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(enteredSelectionNote.result?.value, true);
      await wait(250);
      const retainedSelectionNote = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const editor = document.querySelector(".publisher-reader-selection-editor");',
          '  const note = editor?.querySelector("textarea");',
          '  return editor !== null && note?.value === ' + JSON.stringify(selectionNote) + ";",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(retainedSelectionNote.result?.value, true);
      const savedSelectionNote = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const save = Array.from(document.querySelectorAll(".publisher-reader-selection-editor button"))',
          '    .find((button) => button.textContent === "Save");',
          "  save?.click();",
          "  return save !== undefined;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(savedSelectionNote.result?.value, true);
      let capturedSelection;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            `  const state = JSON.parse(localStorage.getItem(${JSON.stringify(bookmarkProof.storageKey)}));`,
            "  const live = Object.values(state.bookmarks ?? {}).filter((bookmark) => bookmark.deletedAt === undefined);",
            "  return {",
            "    count: live.length,",
            "    quote: live[0]?.quote ?? \"\",",
            "    note: live[0]?.note ?? \"\",",
            "    startBlockId: live[0]?.range?.start?.blockId ?? \"\",",
            '    status: document.querySelector(".publisher-reader-selection-status")?.textContent ?? "",',
            "  };",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        capturedSelection = evaluated.result?.value;
        if (capturedSelection?.count === 1) break;
        await wait(50);
      }
      assert.deepEqual(capturedSelection, {
        count: 1,
        quote: selectedPassage.result.value.quote,
        note: selectionNote,
        startBlockId: selectedPassage.result.value.blockId,
        status: "Saved passage.",
      });
      let bookmarkMarker;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const marker = document.querySelector(".publisher-reader-bookmark-marker");',
            '  const line = marker?.querySelector(".publisher-reader-bookmark-marker-line");',
            '  const blockId = marker?.getAttribute("data-publisher-start-block");',
            '  const block = blockId === null || blockId === undefined ? null : document.querySelector(`[data-publisher-block="${CSS.escape(blockId)}"]`);',
            "  const markerBox = marker?.getBoundingClientRect();",
            "  const lineBox = line?.getBoundingClientRect();",
            "  const blockBox = block?.getBoundingClientRect();",
            "  return {",
            "    background: marker === null ? \"\" : getComputedStyle(marker).backgroundColor,",
            "    hasIcon: marker?.querySelector(\"svg\") !== null,",
            "    height: markerBox?.height ?? 0,",
            "    insideViewport: markerBox !== undefined && markerBox.left >= 0 && markerBox.right <= innerWidth && markerBox.top >= 0 && markerBox.bottom <= innerHeight,",
            "    lineBeforeProse: lineBox !== undefined && blockBox !== undefined && lineBox.right <= blockBox.left,",
            '    manuscriptMarkerCount: document.querySelectorAll(".publisher-manuscript .publisher-reader-bookmark-marker").length,',
            '    quote: marker?.getAttribute("aria-label") ?? "",',
            "  };",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        bookmarkMarker = evaluated.result?.value;
        if (bookmarkMarker?.quote.startsWith("Saved passage:")) break;
        await wait(50);
      }
      const bookmarkMarkerContext = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          `  const state = JSON.parse(localStorage.getItem(${JSON.stringify(bookmarkProof.storageKey)}));`,
          "  const live = Object.values(state.bookmarks ?? {}).filter((bookmark) => bookmark.deletedAt === undefined);",
          "  const startBlockId = live[0]?.range?.start?.blockId ?? \"\";",
          "  return {",
          '    highlights: document.documentElement.dataset.publisherReaderHighlights ?? "",',
          "    liveBookmarks: live.length,",
          '    matchingBlocks: startBlockId.length === 0 ? 0 : document.querySelectorAll(`[data-publisher-block="${CSS.escape(startBlockId)}"]`).length,',
          '    sections: document.querySelectorAll("[data-publisher-section]").length,',
          "    startBlockId,",
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.deepEqual(bookmarkMarkerContext.result?.value, {
        highlights: "on",
        liveBookmarks: 1,
        matchingBlocks: 1,
        sections: 1,
        startBlockId: selectedPassage.result.value.blockId,
      });
      assert.deepEqual(bookmarkMarker, {
        background: "rgba(0, 0, 0, 0)",
        hasIcon: true,
        height: 44,
        insideViewport: true,
        lineBeforeProse: true,
        manuscriptMarkerCount: 0,
        quote: `Saved passage: ${selectedPassage.result.value.quote.slice(0, 80)}`,
      });
      const openedMarkerBookmark = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const marker = document.querySelector(".publisher-reader-bookmark-marker");',
          "  marker?.click();",
          "  return marker !== null;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(openedMarkerBookmark.result?.value, true);
      let markerDestination;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const input = document.querySelector(".publisher-reader-bookmark-tools input[type=search]");',
            "  return {",
            "    focused: document.activeElement === input,",
            '    query: input instanceof HTMLInputElement ? input.value : "",',
            '    quote: document.querySelector(".publisher-reader-bookmarks q")?.textContent ?? "",',
            "  };",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        markerDestination = evaluated.result?.value;
        if (markerDestination?.focused === true) break;
        await wait(50);
      }
      assert.deepEqual(markerDestination, {
        focused: true,
        query: selectedPassage.result.value.quote,
        quote: selectedPassage.result.value.quote,
      });
      const openedMarkerSettings = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const settings = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
          '    .find((button) => button.textContent?.includes("Settings"));',
          "  settings?.click();",
          "  return settings !== undefined;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(openedMarkerSettings.result?.value, true);
      let hidBookmarkMarkers = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const toggle = document.querySelector(".publisher-reader-settings input[type=checkbox]");',
            "  if (!(toggle instanceof HTMLInputElement) || !toggle.checked) return false;",
            "  toggle.click();",
            "  return true;",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        hidBookmarkMarkers = evaluated.result?.value === true;
        if (hidBookmarkMarkers) break;
        await wait(50);
      }
      assert.equal(hidBookmarkMarkers, true);
      let hiddenMarkerCount = -1;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression:
            'document.querySelectorAll(".publisher-reader-bookmark-marker").length',
          returnByValue: true,
        });
        hiddenMarkerCount = evaluated.result?.value ?? -1;
        if (hiddenMarkerCount === 0) break;
        await wait(50);
      }
      assert.equal(hiddenMarkerCount, 0);
      const fullCollectionTemplate = bookmarkProof.state.bookmarks["cross-tab-proof"];
      const wroteFullBookmarkCollection = await peerPage.send("Runtime.evaluate", {
        expression: [
          "((key, publicationId, template) => {",
          "  const bookmarks = {};",
          "  const now = Date.now();",
          "  for (let index = 0; index < 1000; index += 1) {",
          '    const id = `stress-${String(index).padStart(4, "0")}`;',
          "    bookmarks[id] = {",
          "      ...template,",
          "      id,",
          "      createdAt: now - index,",
          "      updatedAt: now - index,",
          '      quote: `Full collection passage ${index + 1}: ${template.quote}`,',
          '      ...(index % 3 === 0 ? { note: `Private note ${index + 1}` } : {}),',
          "    };",
          "  }",
          "  localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, publicationId, bookmarks }));",
          "  return Object.keys(bookmarks).length;",
          `})(${JSON.stringify(bookmarkProof.storageKey)}, ${JSON.stringify(bookmarkProof.state.publicationId)}, ${JSON.stringify(fullCollectionTemplate)})`,
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(wroteFullBookmarkCollection.result?.value, 1000);
      const openedFullBookmarkCollection = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const bookmarks = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
          '    .find((button) => button.textContent?.includes("Bookmarks"));',
          "  bookmarks?.click();",
          "  return bookmarks !== undefined;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(openedFullBookmarkCollection.result?.value, true);
      let clearedFullCollectionQuery = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const input = document.querySelector(".publisher-reader-bookmark-tools input[type=search]");',
            "  if (!(input instanceof HTMLInputElement)) return false;",
            '  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;',
            '  setter?.call(input, "");',
            '  input.dispatchEvent(new Event("input", { bubbles: true }));',
            "  return true;",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        clearedFullCollectionQuery = evaluated.result?.value === true;
        if (clearedFullCollectionQuery) break;
        await wait(50);
      }
      assert.equal(clearedFullCollectionQuery, true);
      let fullCollectionGeometry;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const panel = document.querySelector(".publisher-reader-panel");',
            '  const scroll = document.querySelector(".publisher-reader-bookmark-scroll");',
            '  const list = document.querySelector(".publisher-reader-bookmark-virtual-list");',
            '  const rows = document.querySelectorAll(".publisher-reader-bookmark-virtual-list > li");',
            "  const panelBox = panel?.getBoundingClientRect();",
            "  const scrollBox = scroll?.getBoundingClientRect();",
            "  return {",
            '    summary: document.querySelector(".publisher-reader-bookmark-summary")?.textContent ?? "",',
            "    renderedRows: rows.length,",
            "    totalHeight: list?.getBoundingClientRect().height ?? 0,",
            "    scrollHeight: scroll?.scrollHeight ?? 0,",
            "    clientHeight: scroll?.clientHeight ?? 0,",
            "    contained: panelBox !== undefined && scrollBox !== undefined && scrollBox.left >= panelBox.left && scrollBox.right <= panelBox.right && scrollBox.top >= panelBox.top && scrollBox.bottom <= panelBox.bottom,",
            '    rowPosition: rows[0] === undefined ? "" : getComputedStyle(rows[0]).position,',
            "  };",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        fullCollectionGeometry = evaluated.result?.value;
        if (fullCollectionGeometry?.summary === "1,000 saved passages") break;
        await wait(50);
      }
      assert.equal(fullCollectionGeometry?.summary, "1,000 saved passages");
      assert.ok(fullCollectionGeometry.renderedRows > 0);
      assert.ok(fullCollectionGeometry.renderedRows < 100);
      assert.equal(fullCollectionGeometry.totalHeight, 160000);
      assert.ok(fullCollectionGeometry.scrollHeight > fullCollectionGeometry.clientHeight);
      assert.ok(fullCollectionGeometry.clientHeight > 0 && fullCollectionGeometry.clientHeight <= 384);
      assert.equal(fullCollectionGeometry.contained, true);
      assert.equal(fullCollectionGeometry.rowPosition, "absolute");
      const scrolledFullBookmarkCollection = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const scroll = document.querySelector(".publisher-reader-bookmark-scroll");',
          "  if (!(scroll instanceof HTMLElement)) return false;",
          "  scroll.scrollTop = scroll.scrollHeight;",
          '  scroll.dispatchEvent(new Event("scroll", { bubbles: true }));',
          "  return true;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(scrolledFullBookmarkCollection.result?.value, true);
      let finalVirtualBookmark;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => {",
            '  const rows = Array.from(document.querySelectorAll(".publisher-reader-bookmark-virtual-list > li"));',
            '  const row = rows.find((candidate) => candidate.textContent?.includes("Full collection passage 1000"));',
            "  return {",
            '    position: row?.getAttribute("aria-posinset") ?? "",',
            '    quote: row?.querySelector("q")?.textContent ?? "",',
            '    setSize: row?.getAttribute("aria-setsize") ?? "",',
            "  };",
            "})()",
          ].join("\n"),
          returnByValue: true,
        });
        finalVirtualBookmark = evaluated.result?.value;
        if (finalVirtualBookmark?.position === "1000") break;
        await wait(50);
      }
      assert.deepEqual(finalVirtualBookmark, {
        position: "1000",
        quote: `Full collection passage 1000: ${fullCollectionTemplate.quote}`,
        setSize: "1000",
      });
    } finally {
      peerPage.close();
    }
  } finally {
    page.close();
  }
}

async function assertAccessibleManuscriptExtensions({
  browser,
  url,
}) {
  const page = await openDevToolsPage(browser);
  try {
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: [
        "Object.defineProperty(navigator, 'clipboard', {",
        "  configurable: true,",
        "  value: { writeText: async (text) => { globalThis.__publisherCopiedHeadingHref = text; } },",
        "});",
      ].join("\n"),
    });
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    const navigation = await page.send("Page.navigate", { url });
    assert.equal(
      navigation.errorText,
      undefined,
      `Accessible manuscript navigation failed: ${navigation.errorText}`,
    );
    let ready;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const action = document.querySelector(".publisher-heading-action");',
          '  const region = document.querySelector(".publisher-table-region");',
          "  return {",
          '    actionReady: action instanceof HTMLButtonElement && !action.hidden,',
          '    regionReady: region instanceof HTMLElement,',
          '    complete: document.readyState === "complete",',
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      ready = evaluated.result?.value;
      if (
        ready?.complete === true &&
        ready.actionReady === true &&
        ready.regionReady === true
      ) {
        break;
      }
      await wait(100);
    }
    assert.deepEqual(ready, {
      actionReady: true,
      regionReady: true,
      complete: true,
    });

    const before = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const action = document.querySelector(".publisher-heading-action");',
        '  const heading = action?.closest(".publisher-linkable-heading")?.querySelector("h1, h2, h3, h4, h5, h6");',
        '  const region = document.querySelector(".publisher-table-region");',
        '  const table = region?.querySelector("table");',
        "  if (!(action instanceof HTMLButtonElement) || !(heading instanceof HTMLElement) || !(region instanceof HTMLElement) || !(table instanceof HTMLTableElement)) return null;",
        "  action.focus();",
        "  const target = action.dataset.publisherHeadingHref ?? '';",
        "  action.click();",
        "  region.focus();",
        "  return {",
        '    actionLabel: action.getAttribute("aria-label") ?? "",',
        '    activeRegion: document.activeElement === region,',
        '    caption: table.querySelector("caption")?.textContent ?? "",',
        '    columnHeaders: table.querySelectorAll("th[scope=col]").length,',
        '    headingText: heading.textContent ?? "",',
        '    regionLabelledBy: region.getAttribute("aria-labelledby") ?? "",',
        '    regionRole: region.getAttribute("role") ?? "",',
        '    regionTabIndex: region.tabIndex,',
        "    scrollContained: region.getBoundingClientRect().left >= 0 && region.getBoundingClientRect().right <= innerWidth + 1,",
        "    scrollable: region.scrollWidth > region.clientWidth,",
        "    target: new URL(target, location.origin).href,",
        "  };",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.notEqual(before.result?.value, null);
    assert.match(before.result.value.actionLabel, /^Copy link to /u);
    assert.equal(before.result.value.activeRegion, true);
    assert.ok(before.result.value.caption.startsWith("Table in "));
    assert.equal(before.result.value.columnHeaders, 2);
    assert.ok(before.result.value.headingText.length > 0);
    assert.ok(before.result.value.regionLabelledBy.length > 0);
    assert.equal(before.result.value.regionRole, "region");
    assert.equal(before.result.value.regionTabIndex, 0);
    assert.equal(before.result.value.scrollContained, true);
    assert.equal(before.result.value.scrollable, true);

    let copied;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "({",
          '  copied: globalThis.__publisherCopiedHeadingHref ?? "",',
          '  headingText: document.querySelector(".publisher-linkable-heading h1, .publisher-linkable-heading h2, .publisher-linkable-heading h3, .publisher-linkable-heading h4, .publisher-linkable-heading h5, .publisher-linkable-heading h6")?.textContent ?? "",',
          '  status: document.querySelector(".publisher-heading-status")?.textContent ?? "",',
          "})",
        ].join("\n"),
        returnByValue: true,
      });
      copied = evaluated.result?.value;
      if (copied?.status === "Link copied") break;
      await wait(50);
    }
    assert.equal(copied?.copied, before.result.value.target);
    assert.equal(copied?.headingText, before.result.value.headingText);
    assert.equal(copied?.status, "Link copied");
  } finally {
    page.close();
  }
}

async function assertOfflineReaderTools({
  browser,
  destinationUrl,
  excludedSearchText,
  includedSearchText,
  initialUrl,
  workId,
}) {
  const page = await openDevToolsPage(browser);
  try {
    await page.send("Network.enable");
    const navigation = await page.send("Page.navigate", {
      url: initialUrl,
    });
    assert.equal(
      navigation.errorText,
      undefined,
      `Offline package setup navigation failed: ${navigation.errorText}`,
    );
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
          '    .find((candidate) => candidate.textContent?.includes("Offline"));',
          '  return document.readyState === "complete" && button !== undefined;',
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      ready = evaluated.result?.value === true;
      if (ready) break;
      await wait(50);
    }
    assert.equal(ready, true, "The offline Reader control did not hydrate.");

    const opened = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
        '    .find((candidate) => candidate.textContent?.includes("Offline"));',
        "  button?.click();",
        "  return button !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(opened.result?.value, true);

    let packageReady = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          `  const item = document.querySelector('[data-work-id=${JSON.stringify(workId)}]');`,
          '  const button = item?.querySelector("button");',
          "  return item !== null && button !== null && !button.disabled;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      packageReady = evaluated.result?.value === true;
      if (packageReady) break;
      await wait(50);
    }
    assert.equal(packageReady, true, `Offline package ${workId} did not load.`);

    const started = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        `  const item = document.querySelector('[data-work-id=${JSON.stringify(workId)}]');`,
        '  const button = item?.querySelector("button");',
        "  button?.click();",
        "  return button !== null;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(started.result?.value, true);

    let installed;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          `  const item = document.querySelector('[data-work-id=${JSON.stringify(workId)}]');`,
          "  return {",
          '    alert: item?.querySelector("[role=alert]")?.textContent ?? "",',
          '    installed: item?.getAttribute("data-installed") === "true",',
          '    label: item?.querySelector("button")?.textContent?.trim() ?? "",',
          "  };",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      installed = evaluated.result?.value;
      if (installed?.installed === true) break;
      if ((installed?.alert ?? "").length > 0) break;
      await wait(50);
    }
    assert.deepEqual(installed, {
      alert: "",
      installed: true,
      label: "Available offline",
    });

    const workerReady = await page.send("Runtime.evaluate", {
      expression: "navigator.serviceWorker.ready.then(() => true)",
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(workerReady.result?.value, true, "The installed offline worker never became ready.");
    await page.send("Page.reload", { ignoreCache: false });
    let controlled = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression:
          'document.readyState === "complete" && navigator.serviceWorker.controller !== null',
        returnByValue: true,
      });
      controlled = evaluated.result?.value === true;
      if (controlled) break;
      await wait(50);
    }
    assert.equal(controlled, true, "The offline service worker did not control the Reader.");

    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: [
        'Object.defineProperty(Navigator.prototype, "onLine", {',
        "  configurable: true,",
        "  get: () => false,",
        "});",
      ].join("\n"),
    });
    await page.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: "none",
    });
    await page.send("Network.overrideNetworkState", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
      connectionType: "none",
    });
    const offlineNavigation = await page.send("Page.navigate", {
      url: destinationUrl,
    });
    assert.equal(
      offlineNavigation.errorText,
      undefined,
      `Cold offline navigation failed: ${offlineNavigation.errorText}`,
    );
    let offlineDocument;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => ({",
          '  complete: document.readyState === "complete",',
          '  controlled: navigator.serviceWorker.controller !== null,',
          "  offline: navigator.onLine === false,",
          '  prose: document.querySelector(".publisher-manuscript")?.textContent?.trim().length ?? 0,',
          "}))()",
        ].join("\n"),
        returnByValue: true,
      });
      offlineDocument = evaluated.result?.value;
      if (
        offlineDocument?.complete === true &&
        offlineDocument.controlled === true &&
        offlineDocument.offline === true &&
        offlineDocument.prose > 0
      ) break;
      await wait(50);
    }
    assert.ok(
      offlineDocument?.complete === true &&
      offlineDocument.controlled === true &&
      offlineDocument.offline === true &&
      offlineDocument.prose > 0,
      `Cold offline document state: ${JSON.stringify(offlineDocument)}`,
    );

    const search = async (value) => {
      await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
          '    .find((candidate) => candidate.textContent?.includes("Search"));',
          '  if (document.querySelector(".publisher-reader-search") === null) button?.click();',
          "  return button !== undefined;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      let inputReady = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression:
            'document.querySelector(".publisher-reader-search input[type=search]") instanceof HTMLInputElement',
          returnByValue: true,
        });
        inputReady = evaluated.result?.value === true;
        if (inputReady) break;
        await wait(25);
      }
      assert.equal(inputReady, true, "Offline search panel did not open.");
      const changed = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const input = document.querySelector(".publisher-reader-search input[type=search]");',
          "  if (!(input instanceof HTMLInputElement)) return false;",
          '  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;',
          `  setter?.call(input, ${JSON.stringify(value)});`,
          '  input.dispatchEvent(new Event("input", { bubbles: true }));',
          "  return true;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      assert.equal(changed.result?.value, true, "Offline search input was unavailable.");
      let state;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const evaluated = await page.send("Runtime.evaluate", {
          expression: [
            "(() => ({",
            '  alert: document.querySelector(".publisher-reader-search [role=alert]")?.textContent ?? "",',
            '  label: document.querySelector(".publisher-reader-search label")?.textContent ?? "",',
            '  loading: document.querySelector(".publisher-reader-search [role=status]") !== null,',
            '  results: document.querySelectorAll(".publisher-reader-search-results li").length,',
            "}))()",
          ].join("\n"),
          returnByValue: true,
        });
        state = evaluated.result?.value;
        if (state?.loading === false) break;
        await wait(50);
      }
      return state;
    };
    const included = await search(includedSearchText);
    assert.equal(included?.alert, "");
    assert.equal(included?.label, "Search downloaded works");
    assert.ok(included?.results > 0, JSON.stringify(included));
    const excluded = await search(excludedSearchText);
    assert.equal(excluded?.alert, "");
    assert.equal(excluded?.label, "Search downloaded works");
    assert.equal(excluded?.results, 0);

    const openedNarration = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
        '    .find((candidate) => candidate.textContent?.includes("Listen"));',
        "  button?.click();",
        "  return button !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(openedNarration.result?.value, true, "Offline Listen control was unavailable.");
    let narrationReady = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression:
          'document.querySelector(".publisher-reader-narration-now strong")?.textContent?.trim().length > 0',
        returnByValue: true,
      });
      narrationReady = evaluated.result?.value === true;
      if (narrationReady) break;
      await wait(50);
    }
    assert.equal(narrationReady, true, "Saved narration did not load offline.");
    const selectedTimedVoice = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const select = document.querySelector(".publisher-reader-narration select");',
        "  if (!(select instanceof HTMLSelectElement)) return false;",
        '  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;',
        '  setter?.call(select, "calm");',
        '  select.dispatchEvent(new Event("change", { bubbles: true }));',
        "  return true;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(selectedTimedVoice.result?.value, true);
    let timedVoiceReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const key = Object.keys(localStorage).find((candidate) => candidate.endsWith(".narration"));',
          "  const saved = key === undefined ? null : JSON.parse(localStorage.getItem(key));",
          '  return document.querySelector(".publisher-reader-narration select")?.value === "calm" &&',
          '    saved?.selectedVoiceId === "calm";',
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      timedVoiceReady = evaluated.result?.value === true;
      if (timedVoiceReady) break;
      await wait(25);
    }
    assert.equal(timedVoiceReady, true, "The timed narration voice was not selected.");
    let cachedAudioReady = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() => {",
          '  const audio = document.querySelector(".publisher-reader-audio-host > audio");',
          "  return audio instanceof HTMLAudioElement &&",
          '    audio.currentSrc.startsWith("blob:") &&',
          "    audio.readyState >= HTMLMediaElement.HAVE_METADATA;",
          "})()",
        ].join("\n"),
        returnByValue: true,
      });
      cachedAudioReady = evaluated.result?.value === true;
      if (cachedAudioReady) break;
      await wait(25);
    }
    assert.equal(cachedAudioReady, true, "The saved recording bytes were not media-ready.");
    const requestedOfflinePlayback = await page.send("Runtime.evaluate", {
      expression: [
        "(async () => {",
        '  const audio = document.querySelector(".publisher-reader-audio-host > audio");',
        "  if (!(audio instanceof HTMLAudioElement)) return false;",
        "  try {",
        "    await audio.play();",
        "    return true;",
        "  } catch {",
        "    return false;",
        "  }",
        "})()",
      ].join("\n"),
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(requestedOfflinePlayback.result?.value, true);
    let playbackStarted = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression:
          '(() => { const audio = document.querySelector(".publisher-reader-audio-host > audio"); return audio instanceof HTMLAudioElement && !audio.paused && audio.currentTime > 0; })()',
        returnByValue: true,
      });
      playbackStarted = evaluated.result?.value === true;
      if (playbackStarted) break;
      await wait(50);
    }
    assert.equal(playbackStarted, true, "Saved narration did not play offline.");
    await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const audio = document.querySelector(".publisher-reader-audio-host > audio");',
        "  if (!(audio instanceof HTMLAudioElement)) return false;",
        "  audio.currentTime = 4;",
        '  audio.dispatchEvent(new Event("timeupdate"));',
        "  return true;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    let timingVisible = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression:
          'document.querySelector(".publisher-narration-word-current") !== null',
        returnByValue: true,
      });
      timingVisible = evaluated.result?.value === true;
      if (timingVisible) break;
      await wait(25);
    }
    assert.equal(timingVisible, true, "Saved narration timings did not load offline.");

    const bookmarksOpened = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        '  const button = Array.from(document.querySelectorAll(".publisher-reader-rail-actions button"))',
        '    .find((candidate) => candidate.textContent?.includes("Bookmarks"));',
        "  button?.click();",
        "  return button !== undefined;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(bookmarksOpened.result?.value, true, "Offline bookmarks did not open.");
    let bookmarksReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression:
          'document.querySelector("[aria-label=Bookmarks]") !== null',
        returnByValue: true,
      });
      bookmarksReady = evaluated.result?.value === true;
      if (bookmarksReady) break;
      await wait(25);
    }
    assert.equal(bookmarksReady, true, "Offline bookmarks panel did not render.");

    const destination = new URL(destinationUrl);
    const fullNavigation = await page.send("Runtime.evaluate", {
      expression: [
        "(() => {",
        `  const target = ${JSON.stringify(destination.origin + "/home")};`,
        '  const link = Array.from(document.querySelectorAll("a[href]"))',
        "    .find((candidate) => candidate.href === target);",
        "  if (!(link instanceof HTMLAnchorElement)) return false;",
        "  globalThis.__publisherOfflineDocumentMarker = true;",
        "  link.click();",
        "  return true;",
        "})()",
      ].join("\n"),
      returnByValue: true,
    });
    assert.equal(fullNavigation.result?.value, true, "The cached home link was unavailable.");
    let reloaded = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const evaluated = await page.send("Runtime.evaluate", {
        expression: [
          "(() =>",
          '  location.pathname === "/home" &&',
          "  globalThis.__publisherOfflineDocumentMarker !== true &&",
          '  document.readyState === "complete" &&',
          "  navigator.onLine === false",
          ")()",
        ].join("\n"),
        returnByValue: true,
      });
      reloaded = evaluated.result?.value === true;
      if (reloaded) break;
      await wait(50);
    }
    assert.equal(reloaded, true, "Offline link navigation did not load a fresh document.");
  } finally {
    page.close();
  }
}

async function startHost(
  hostRoot,
  environment,
  readiness = Object.freeze({
    path: "/",
    status: 200,
  }),
) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const nextExecutable = join(
    hostRoot,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const child = spawn(
    process.execPath,
    [
      nextExecutable,
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: hostRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error(
          `Packed host exited before readiness.\n${output}`,
        );
      }
      try {
        const response = await fetch(`${origin}${readiness.path}`, {
          redirect: "manual",
        });
        if (response.status === readiness.status) {
          return {
            child,
            origin,
            output: () => output,
          };
        }
      } catch {
        await wait(100);
      }
    }
    throw new Error(
      `Packed host did not become ready.\n${output}`,
    );
  } catch (error) {
    await stopHost(child);
    throw error;
  }
}

async function stopHost(child) {
  const hasExited = () =>
    child.exitCode !== null || child.signalCode !== null;
  if (child.pid === undefined || hasExited()) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => {
      child.once("exit", resolvePromise);
    }),
    wait(5000),
  ]);
  if (!hasExited()) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolvePromise) => {
        child.once("exit", resolvePromise);
      }),
      wait(5000),
    ]);
  }
  if (!hasExited()) {
    throw new Error(
      "Packed Next host did not terminate after SIGKILL.",
    );
  }
}

async function listHtmlFiles(root) {
  const files = [];
  const entries = await readdir(root, {
    withFileTypes: true,
  });
  entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listHtmlFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(path);
    }
  }
  return files;
}

async function listJavaScriptFiles(root) {
  const files = [];
  const entries = await readdir(root, {
    withFileTypes: true,
  });
  entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJavaScriptFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(path);
    }
  }
  return files;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        (crc >>> 1) ^
        (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, contents) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(contents.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(
    crc32(Buffer.concat([typeBuffer, contents])),
  );
  return Buffer.concat([
    length,
    typeBuffer,
    contents,
    checksum,
  ]);
}

function createProofPng() {
  const width = 96;
  const height = 64;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 3);
    rows[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 3;
      rows[pixelOffset] = (x * 17 + y * 3) % 256;
      rows[pixelOffset + 1] = (x * 5 + y * 19) % 256;
      rows[pixelOffset + 2] = (x * 13 + y * 11) % 256;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createProofWav(durationSeconds = 8) {
  const sampleRate = 8_000;
  const sampleCount = sampleRate * durationSeconds;
  const dataSize = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(
      Math.sin(2 * Math.PI * 220 * index / sampleRate) * 2_000,
    );
    wav.writeInt16LE(sample, 44 + index * 2);
  }
  return wav;
}

// Host-relative POSIX paths of every source file, so the written host can be
// compared against the renderer contract plus declared proof scaffolding.
async function listHostSourcePaths(root) {
  const paths = [];

  async function visit(directory) {
    const entries = await readdir(directory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (entry.name === ".next" ||
          entry.name === "node_modules")
      ) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        paths.push(packagePath(relative(root, path)));
      } else {
        throw new Error(
          `Unexpected non-file host source entry: ${path}`,
        );
      }
    }
  }

  await visit(root);
  return paths;
}

async function hashHostSources(root) {
  const hash = createHash("sha256");

  async function visit(directory) {
    const entries = await readdir(directory, {
      withFileTypes: true,
    });
    entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (entry.name === ".next" ||
          entry.name === "node_modules")
      ) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const sourcePath = packagePath(relative(root, path));
        hash.update(sourcePath);
        hash.update("\0");
        hash.update(await readFile(path));
        hash.update("\0");
      } else {
        throw new Error(
          `Unexpected non-file host source entry: ${path}`,
        );
      }
    }
  }

  await visit(root);
  return hash.digest("hex");
}

async function removeOwnedTemporaryRoot(targetPath) {
  const realTempRoot = await realpath(tmpdir());
  const realTarget = await realpath(targetPath);
  if (
    dirname(realTarget) !== realTempRoot ||
    !basename(realTarget).startsWith(
      "genii-publisher-next-host-",
    )
  ) {
    throw new Error(
      `Refusing to remove unexpected path: ${realTarget}`,
    );
  }
  await rm(realTarget, {
    force: true,
    maxRetries: 50,
    recursive: true,
    retryDelay: 100,
  });
}

export async function runPackagedHostProof(
  reader,
  options = Object.freeze({}),
) {
  if (reader === null || typeof reader !== "object") {
    throw new TypeError(
      "The packaged host proof requires one reader envelope.",
    );
  }
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new TypeError(
      "The packaged host proof options must be an object.",
    );
  }
  const browserExecutable = options.browserExecutable;
  if (
    browserExecutable !== undefined &&
    (typeof browserExecutable !== "string" ||
      browserExecutable.trim().length === 0)
  ) {
    throw new TypeError(
      "browserExecutable must be a non-empty string when supplied.",
    );
  }
  const [
    workspaceManifest,
    schemaManifest,
    contentManifest,
    readerManifest,
    nextManifest,
  ] = await Promise.all([
    readFile(join(repositoryRoot, "package.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(
      join(repositoryRoot, "schemas", "package.json"),
      "utf8",
    ).then(JSON.parse),
    readFile(
      join(repositoryRoot, "packages", "content", "package.json"),
      "utf8",
    ).then(JSON.parse),
    readFile(
      join(repositoryRoot, "packages", "reader", "package.json"),
      "utf8",
    ).then(JSON.parse),
    readFile(join(packageRoot, "package.json"), "utf8").then(
      JSON.parse,
    ),
  ]);
  assert.equal(
    runNpm(["--version"], { label: "npm version check" }),
    workspaceManifest.engines.npm,
  );
  const [rootApi, hostApi] = await Promise.all([
    import(
      new URL(
        `../dist/index.js?proof=${encodeURIComponent(nextManifest.version)}`,
        import.meta.url,
      )
    ),
    import(
      new URL(
        `../dist/host.js?proof=${encodeURIComponent(nextManifest.version)}`,
        import.meta.url,
      )
    ),
  ]);
  assert.deepEqual(
    rootApi.PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES,
    nextManifest.publisherHostOverrides,
  );
  const homeRoute = reader.routes.active.find(
    ({ target }) => target.kind === "home",
  );
  assert.notEqual(homeRoute, undefined);
  const portableThemeAccent = "#6B3F84";
  const packedExtensionRenderSentinel =
    "PACKED_EXTENSION_SLOT_RENDERED";
  const packedExtensionServerSentinel =
    "PACKED_EXTENSION_SERVER_DATA_ONLY";

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "genii-publisher-next-host-"),
  );
  let browser;
  try {
    const packRoot = join(temporaryRoot, "pack");
    const hostRoot = join(temporaryRoot, "host");
    const themeRoot = join(temporaryRoot, "portable-theme");
    const extensionRoot = join(
      temporaryRoot,
      "portable-extension",
    );
    const appRoot = join(hostRoot, "app");
    const pagesRoot = join(hostRoot, "pages");
    const routeRoot = join(appRoot, "[...segments]");
    const boundaryProofRoot = join(
      appRoot,
      "server-boundary-proof",
    );
    const runtimeErrorRoot = join(
      appRoot,
      "runtime-error-proof",
    );
    const globalErrorRoot = join(
      appRoot,
      "global-error-proof",
    );
    const publicRoot = join(hostRoot, "public");
    await Promise.all([
      mkdir(packRoot),
      mkdir(themeRoot),
      mkdir(extensionRoot),
      mkdir(routeRoot, { recursive: true }),
      mkdir(boundaryProofRoot, { recursive: true }),
      mkdir(runtimeErrorRoot, { recursive: true }),
      mkdir(globalErrorRoot, { recursive: true }),
      mkdir(publicRoot, { recursive: true }),
      mkdir(pagesRoot, { recursive: true }),
    ]);

    await Promise.all([
      writeJson(join(themeRoot, "package.json"), {
        name: "@example/packed-publication-theme",
        version: "1.0.0",
        type: "module",
        exports: "./index.js",
      }),
      writeFile(
        join(themeRoot, "index.js"),
        [
          "const tokens = Object.freeze({",
          "  color: Object.freeze({",
          '    canvas: "#F7F4ED",',
          '    surface: "#FFFFFF",',
          '    text: "#182326",',
          '    mutedText: "#4C5A5E",',
          `    accent: "${portableThemeAccent}",`,
          '    focus: "#8A3500",',
          '    border: "#C5CDCE",',
          "  }),",
          "  typography: Object.freeze({",
          '    bodyFamily: "Charter, Cambria, serif",',
          '    headingFamily: "Avenir Next, Segoe UI, sans-serif",',
          '    monoFamily: "SFMono-Regular, Consolas, monospace",',
          '    baseSize: "1.0625rem",',
          "    lineHeight: 1.72,",
          "  }),",
          "  layout: Object.freeze({",
          '    readingMeasure: "68ch",',
          '    pageGutter: "1.25rem",',
          '    sectionGap: "3rem",',
          '    controlRadius: "0.375rem",',
          "  }),",
          "});",
          "",
          "export default Object.freeze({",
          '  package: "@example/packed-publication-theme",',
          '  version: "1.0.0",',
          '  rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",',
          "  config: Object.freeze({}),",
          "  implementation: Object.freeze({",
          '    kind: "genii.publisher.next-theme",',
          '    apiVersion: "1.0",',
          "    configure() {",
          "      return Object.freeze({",
          "        valid: true,",
          "        diagnostics: Object.freeze([]),",
          "        value: Object.freeze({ tokens }),",
          "      });",
          "    },",
          "  }),",
          "});",
          "",
        ].join("\n"),
        "utf8",
      ),
      writeJson(join(extensionRoot, "package.json"), {
        name: "@example/packed-publication-extension",
        version: "1.0.0",
        type: "module",
        exports: "./index.js",
      }),
      writeFile(
        join(extensionRoot, "index.js"),
        [
          "export default Object.freeze({",
          '  id: "packed-publication-extension",',
          '  package: "@example/packed-publication-extension",',
          '  version: "1.0.0",',
          '  engineCompatibility: ">=0.1.0-alpha.0 <2.0.0",',
          '  capabilities: Object.freeze(["content.project", "renderer.slot"]),',
          "  implementation: Object.freeze({",
          '    kind: "genii.publisher.extension",',
          '    apiVersion: "1.0",',
          "    project({ content, config }) {",
          "      return Object.freeze({",
          "        valid: true,",
          "        diagnostics: Object.freeze([]),",
          "        value: Object.freeze({",
          "          serverData: Object.freeze({",
          `            marker: "${packedExtensionServerSentinel}",`,
          "            publicationId: content.publicationId,",
          "            config,",
          "          }),",
          "        }),",
          "      });",
          "    },",
          "  }),",
          "  renderer: Object.freeze({",
          '    kind: "genii.publisher.next-extension",',
          '    apiVersion: "1.0",',
          '    rendererCompatibility: ">=0.1.0-alpha.0 <0.2.0",',
          "    renderSlot({ slot, serverData }) {",
          `      return \`${packedExtensionRenderSentinel}:\${slot}:\${serverData.marker}\`;`,
          "    },",
          "  }),",
          "});",
          "",
        ].join("\n"),
        "utf8",
      ),
    ]);

    const schemaTarball = packPackage(
      join(repositoryRoot, "schemas"),
      packRoot,
    );
    const contentTarball = packPackage(
      join(repositoryRoot, "packages", "content"),
      packRoot,
    );
    const readerTarball = packPackage(
      join(repositoryRoot, "packages", "reader"),
      packRoot,
    );
    const nextTarball = packPackage(packageRoot, packRoot);
    const themeTarball = packPackage(themeRoot, packRoot);
    const extensionTarball = packPackage(extensionRoot, packRoot);
    const localDependency = (tarball) =>
      `file:${packagePath(relative(hostRoot, tarball))}`;

    // The renderer owns the host contract. This proof applies exactly what an
    // author would receive, then layers its own scaffolding on top, so the two
    // cannot drift: a host file this proof writes that the template does not
    // declare is proof scaffolding by construction, and the assertion below
    // enforces that.
    const hostTemplate = hostApi.createPublisherNextHostTemplate({
      hostPackageName: "genii-publisher-next-host-proof",
      dependencies: {
        [schemaManifest.name]: localDependency(schemaTarball),
        [contentManifest.name]: localDependency(contentTarball),
        [readerManifest.name]: localDependency(readerTarball),
        [nextManifest.name]: localDependency(nextTarball),
        "@example/packed-publication-theme": localDependency(themeTarball),
        "@example/packed-publication-extension":
          localDependency(extensionTarball),
        next: nextManifest.peerDependencies.next,
        react: nextManifest.peerDependencies.react,
        "react-dom":
          nextManifest.peerDependencies["react-dom"],
      },
      devDependencies: {
        "@types/node":
          nextManifest.devDependencies["@types/node"],
        "@types/react":
          nextManifest.devDependencies["@types/react"],
        "@types/react-dom":
          nextManifest.devDependencies["@types/react-dom"],
        typescript: nextManifest.devDependencies.typescript,
      },
      overrides:
        rootApi.PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES,
    });
    assert.equal(
      hostTemplate.contractVersion,
      hostApi.PUBLISHER_NEXT_HOST_CONTRACT_VERSION,
    );
    assert.equal(
      hostTemplate.rendererVersion,
      nextManifest.version,
    );

    await Promise.all(
      hostTemplate.files.map(async (file) => {
        const target = join(
          hostRoot,
          ...file.path.split("/"),
        );
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.contents, "utf8");
      }),
    );

    // Proof scaffolding. `app/layout.tsx` deliberately replaces the template's
    // copy with one that throws on demand, which is how the global error
    // boundary is exercised; an author host must never carry that.
    // Replaced rather than added, so it must already exist in the contract.
    const proofOverriddenHostPaths = ["app/layout.tsx"];
    // Added beyond the contract. Reader and search artifacts are generated
    // publication data rather than template files, so they belong here too.
    const proofAddedHostPaths = [
      "declaration-probe.ts",
      "export-probe.mjs",
      "server-import-probe.mjs",
      "publisher.config.ts",
      "publisher.extensions.mjs",
      "publisher.theme.mjs",
      `app/${basename(runtimeErrorRoot)}/page.tsx`,
      `app/${basename(globalErrorRoot)}/page.tsx`,
      `app/${basename(boundaryProofRoot)}/page.tsx`,
      "public/proof.png",
      "public/proof.timings.json",
      "public/proof.wav",
      hostTemplate.readerDataPath,
      hostTemplate.audioDataPath,
      hostTemplate.extensionDataPath,
      hostTemplate.progressDataPath,
      hostTemplate.publicIdentityDataPath,
      hostTemplate.searchDataPath,
      hostTemplate.syncDataPath,
    ];
    for (const path of proofOverriddenHostPaths) {
      assert.ok(
        hostTemplate.files.some(
          (file) => file.path === path,
        ),
        `the proof overrides ${path}, which the renderer contract no longer declares`,
      );
    }

    const narratedSections = reader.works.flatMap((work) =>
      work.sections.filter((section) => section.navigable));
    assert.ok(narratedSections.length >= 2);
    const proofAudioDurationSeconds = 8;
    const timedSection = narratedSections[0];
    const timedSectionProfile = createReaderNarrationSectionTextProfile(
      timedSection,
    );
    const timingWords = Array.from(
      timedSectionProfile.text.matchAll(
        /[\p{L}\p{N}][\p{L}\p{N}'’·ˈ]*/gu,
      ),
    ).map((match, index, matches) => ({
      charStart: match.index,
      charEnd: match.index + match[0].length,
      startSeconds: Number(
        ((index * proofAudioDurationSeconds) / matches.length).toFixed(3),
      ),
      endSeconds: Number(
        (((index + 1) * proofAudioDurationSeconds) / matches.length).toFixed(3),
      ),
      match: "exact",
    }));
    const timingDocumentText = `${JSON.stringify({
      version: 1,
      sectionId: timedSection.id,
      audioVersionId: `${timedSection.id}.calm`,
      voiceId: "calm",
      textCharacters: timedSectionProfile.textCharacters,
      durationSeconds: proofAudioDurationSeconds,
      exactWordCount: timingWords.length,
      interpolatedWordCount: 0,
      words: timingWords,
    }, null, 2)}\n`;
    const narrationEnvelope = {
      $schema: "https://publisher.genii.foundation/schemas/audio-envelope.schema.json",
      schemaVersion: "1.0",
      publicationId: reader.publicationId,
      engineVersion: reader.engineVersion,
      buildId: reader.buildId,
      source: {
        adapter: { package: "@example/packed-narrator" },
        catalogPath: "publication/audio/catalog.json",
        catalogSha256: `sha256:${"d".repeat(64)}`,
      },
      voices: [
        {
          id: "calm",
          label: "Calm",
          clips: narratedSections.slice(0, 2).map((section, index) => ({
            sectionId: section.id,
            audioVersionId: `${section.id}.calm`,
            href: "/proof.wav",
            format: "wav",
            byteSize: createProofWav().byteLength,
            ...(index === 0
              ? { timingsByteSize: Buffer.byteLength(timingDocumentText) }
              : {}),
            durationSeconds: proofAudioDurationSeconds,
          })),
          narratedSectionCount: 2,
          unnarratedSectionCount: narratedSections.length - 2,
        },
        {
          id: "bright",
          label: "Bright",
          clips: narratedSections.slice(0, 1).map((section) => ({
            sectionId: section.id,
            audioVersionId: `${section.id}.bright`,
            href: "/proof.wav",
            format: "wav",
            byteSize: createProofWav().byteLength,
            durationSeconds: proofAudioDurationSeconds,
          })),
          narratedSectionCount: 1,
          unnarratedSectionCount: narratedSections.length - 1,
        },
      ],
      statistics: {
        voiceCount: 2,
        clipCount: 3,
        sectionCount: narratedSections.length,
      },
    };
    const extensionEntry = Object.freeze({
      id: "packed-publication-extension",
      package: "@example/packed-publication-extension",
      version: "1.0.0",
      capabilities: Object.freeze([
        "content.project",
        "renderer.slot",
      ]),
      config: Object.freeze({}),
      serverData: Object.freeze({
        marker: packedExtensionServerSentinel,
        publicationId: reader.publicationId,
        config: Object.freeze({}),
      }),
    });
    const extensionBasis = Object.freeze({
      schemaVersion: "1.0",
      publicationId: reader.publicationId,
      engineVersion: reader.engineVersion,
      readerBuildId: reader.buildId,
      extensions: Object.freeze([extensionEntry]),
    });
    const extensionEnvelope = Object.freeze({
      ...extensionBasis,
      buildId: hashCanonicalJson(extensionBasis),
    });

    await Promise.all([
      writeJson(
        join(hostRoot, hostTemplate.readerDataPath),
        reader,
      ),
      writeJson(
        join(hostRoot, hostTemplate.publicIdentityDataPath),
        {
          schemaVersion: "1.0",
          publicationId: reader.publicationId,
          engineVersion: reader.engineVersion,
          buildId: reader.buildId,
          homePath: homeRoute.path,
          publication: reader.publication,
        },
      ),
      writeJson(
        join(hostRoot, hostTemplate.extensionDataPath),
        extensionEnvelope,
      ),
      writeFile(
        join(hostRoot, hostTemplate.progressDataPath),
        serializeReaderProgressCatalog(createReaderProgressCatalog(reader)),
        "utf8",
      ),
      writeJson(
        join(hostRoot, hostTemplate.audioDataPath),
        narrationEnvelope,
      ),
      writeFile(
        join(hostRoot, hostTemplate.searchDataPath),
        serializeReaderSearchIndex(createReaderSearchIndex(reader)),
        "utf8",
      ),
      writeJson(
        join(hostRoot, hostTemplate.syncDataPath),
        {
          $schema: "https://publisher.genii.foundation/schemas/sync-envelope.schema.json",
          schemaVersion: "1.0",
          publicationId: reader.publicationId,
          engineVersion: reader.engineVersion,
          buildId: reader.buildId,
          provider: { package: "@example/packed-sync-provider" },
          consent: "opt-in",
          localFallback: true,
          capabilities: ["account-deletion", "bookmarks", "engagement", "progress"],
        },
      ),
      writeFile(
        join(hostRoot, "publisher.config.ts"),
        [
          'import { definePublisherNextHostConfig } from "@genii-foundation/publisher-next/server/sync";',
          "",
          "export default definePublisherNextHostConfig({",
          "  syncProvider: {",
          '    kind: "genii.publisher.sync-provider",',
          '    package: "@example/packed-sync-provider",',
          '    capabilities: ["account-deletion", "bookmarks", "engagement", "progress"],',
          "    async exchangeAuthCode({ code }) {",
          '      return code === "packed-proof-code";',
          "    },",
          "    async requestEmailAuthentication({ email }) {",
          '      return email === "reader@example.com";',
          "    },",
          "    async verifyEmailAuthentication({ email, code }) {",
          '      return email === "reader@example.com" && code === "12345678"',
          '        ? { authenticated: true, email }',
          "        : null;",
          "    },",
          "    async getSession() {",
          '      return { authenticated: false };',
          "    },",
          "    async signOut() {",
          "      return true;",
          "    },",
          "    async deleteAccount() {",
          '      return "deleted";',
          "    },",
          "    async readRemoteState() {",
          "      return { progress: null, bookmarks: null, consent: null };",
          "    },",
          "    async transferRemoteState({ transfer }) {",
          "      return {",
          "        state: {",
          "          progress: transfer.progress ?? null,",
          "          bookmarks: transfer.bookmarks ?? null,",
          "          consent: transfer.consent ?? null,",
          "        },",
          "        uploadedEventIds: transfer.events?.map((event) => event.clientEventId) ?? [],",
          "      };",
          "    },",
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(hostRoot, "publisher.extensions.mjs"),
        [
          'import extension from "@example/packed-publication-extension";',
          "",
          "export default Object.freeze([extension]);",
          "",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(hostRoot, "publisher.theme.mjs"),
        'export { default } from "@example/packed-publication-theme";\n',
        "utf8",
      ),
      writeFile(
        join(hostRoot, "public", "proof.wav"),
        createProofWav(),
      ),
      writeFile(
        join(hostRoot, "public", "proof.timings.json"),
        timingDocumentText,
        "utf8",
      ),
      writeFile(
        join(appRoot, "layout.tsx"),
        [
          'import "@genii-foundation/publisher-next/styles.css";',
          'import { application } from "../publisher-application.js";',
          "",
          "export default function RootLayout(",
          "  props: Parameters<typeof application.RootLayout>[0],",
          ") {",
          '  if (process.env.PUBLISHER_GLOBAL_ERROR_PROOF === "1") {',
          '    throw new Error("PACKAGED_GLOBAL_ERROR_SECRET");',
          "  }",
          "  return application.RootLayout(props);",
          "}",
          "",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(hostRoot, "declaration-probe.ts"),
        [
          'import { PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES, PUBLISHER_NEXT_VERSION } from "@genii-foundation/publisher-next";',
          'import { createPublisherNextRoutePlan, type PublicationNextApplication } from "@genii-foundation/publisher-next/server";',
          'import { createPublisherNextErrorIdentity, PublisherNextErrorPage, PublisherNextFrameworkErrorPage, PublisherNextGlobalErrorPage, requestPublisherReaderNarrationNavigation, type PublisherNextErrorIdentity, type ReaderNarrationNavigationIntent } from "@genii-foundation/publisher-next/client";',
          'import { createPublisherNextConfig } from "@genii-foundation/publisher-next/config";',
          'import { defaultPublisherNextTheme, validatePublisherNextThemeInstance } from "@genii-foundation/publisher-next/theme";',
          'import { defaultPublisherNextTheme as directDefaultTheme } from "@genii-foundation/publisher-next/theme/default";',
          "",
          "declare const application: PublicationNextApplication;",
          "declare const errorIdentity: PublisherNextErrorIdentity;",
          "declare const narrationIntent: ReaderNarrationNavigationIntent;",
          "void application;",
          "void errorIdentity;",
          "void narrationIntent;",
          "void PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES;",
          "void PUBLISHER_NEXT_VERSION;",
          "void PublisherNextErrorPage;",
          "void PublisherNextFrameworkErrorPage;",
          "void PublisherNextGlobalErrorPage;",
          "void requestPublisherReaderNarrationNavigation;",
          "void createPublisherNextErrorIdentity;",
          "void createPublisherNextConfig;",
          "void createPublisherNextRoutePlan;",
          "void defaultPublisherNextTheme;",
          "void directDefaultTheme;",
          "void validatePublisherNextThemeInstance;",
          "",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(hostRoot, "export-probe.mjs"),
        [
          'import assert from "node:assert/strict";',
          'import * as root from "@genii-foundation/publisher-next";',
          'import * as client from "@genii-foundation/publisher-next/client";',
          'import * as config from "@genii-foundation/publisher-next/config";',
          'import * as theme from "@genii-foundation/publisher-next/theme";',
          'import * as defaultTheme from "@genii-foundation/publisher-next/theme/default";',
          'import schema from "@genii-foundation/publisher-next/application-manifest.schema.json" with { type: "json" };',
          "",
          'assert.equal(Object.hasOwn(root, "createPublicationNextApplication"), false);',
          "assert.equal(typeof client.PublisherNextErrorPage, \"function\");",
          "assert.equal(typeof client.PublisherNextFrameworkErrorPage, \"function\");",
          "assert.equal(typeof client.PublisherNextGlobalErrorPage, \"function\");",
          "assert.equal(typeof client.createPublisherNextErrorIdentity, \"function\");",
          "assert.equal(typeof client.requestPublisherReaderNarrationNavigation, \"function\");",
          "assert.equal(typeof client.PUBLISHER_READER_NARRATION_NAVIGATION_EVENT, \"string\");",
          "assert.equal(typeof config.createPublisherNextConfig, \"function\");",
          "assert.equal(typeof config.createPublisherNextRoutePlan, \"function\");",
          "assert.equal(root.defaultPublisherNextTheme, theme.defaultPublisherNextTheme);",
          "assert.equal(theme.defaultPublisherNextTheme, defaultTheme.defaultPublisherNextTheme);",
          "assert.equal(schema.$id, root.PUBLISHER_NEXT_APPLICATION_SCHEMA_URL);",
          `assert.deepEqual(root.PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES, ${JSON.stringify(nextManifest.publisherHostOverrides)});`,
          "",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(hostRoot, "server-import-probe.mjs"),
        [
          'import "@genii-foundation/publisher-next/server";',
          "",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(runtimeErrorRoot, "page.tsx"),
        [
          'export const dynamic = "force-dynamic";',
          "",
          "export default function RuntimeErrorProof() {",
          '  throw new Error("PACKAGED_RUNTIME_ERROR_SECRET");',
          "}",
          "",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(globalErrorRoot, "page.tsx"),
        [
          'export const dynamic = "force-dynamic";',
          "",
          "export default function GlobalErrorProof() {",
          "  return <p>Global error proof route.</p>;",
          "}",
          "",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(boundaryProofRoot, "page.tsx"),
        [
          '"use client";',
          "",
          'import { createPublicationNextApplication } from "@genii-foundation/publisher-next/server";',
          "",
          "export default function ServerBoundaryProof() {",
          "  return (",
          "    <p>{typeof createPublicationNextApplication}</p>",
          "  );",
          "}",
          "",
        ].join("\n"),
        "utf8",
      ),
      writeFile(
        join(publicRoot, "proof.png"),
        createProofPng(),
      ),
    ]);

    // Every host file is either the renderer's or declared proof scaffolding.
    const writtenHostPaths = (await listHostSourcePaths(hostRoot)).sort();
    const declaredHostPaths = [
      ...hostTemplate.files.map(({ path }) => path),
      ...proofAddedHostPaths,
    ].sort();
    assert.deepEqual(
      writtenHostPaths,
      declaredHostPaths,
      "the proof host must contain exactly the renderer contract plus declared proof scaffolding",
    );

    const installEnvironment = {
      ...process.env,
      CI: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
      TZ: "UTC",
    };
    delete installEnvironment.NODE_ENV;
    const proofEnvironment = {
      ...installEnvironment,
      NODE_ENV: "production",
    };
    runNpm(
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd: hostRoot,
        env: installEnvironment,
        label: "clean packed Next host install",
      },
    );
    runNpm(
      [
        "ci",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd: hostRoot,
        env: installEnvironment,
        label: "frozen packed Next host install",
      },
    );
    const audit = JSON.parse(
      runNpm(["audit", "--omit=dev", "--json"], {
        cwd: hostRoot,
        env: installEnvironment,
        label: "packed Next production dependency audit",
      }),
    );
    assert.equal(
      audit.metadata?.vulnerabilities?.total,
      0,
      JSON.stringify(audit.vulnerabilities),
    );
    await writeFile(
      join(hostRoot, "dependency-probe.mjs"),
      [
        'import assert from "node:assert/strict";',
        'import { createRequire } from "node:module";',
        'import { readFile } from "node:fs/promises";',
        "",
        "const require = createRequire(import.meta.url);",
        'const nextManifestPath = require.resolve("next/package.json");',
        "const nextRequire = createRequire(nextManifestPath);",
        "const postcssManifest = JSON.parse(await readFile(nextRequire.resolve(\"postcss/package.json\"), \"utf8\"));",
        "const postcssRequire = createRequire(nextRequire.resolve(\"postcss/package.json\"));",
        "const nanoidManifest = JSON.parse(await readFile(postcssRequire.resolve(\"nanoid/package.json\"), \"utf8\"));",
        'const sharp = nextRequire("sharp");',
        'const extension = await import("@example/packed-publication-extension");',
        'assert.equal(postcssManifest.version, "8.5.24");',
        'assert.equal(nanoidManifest.version, "3.3.18");',
        'assert.equal(sharp.versions.sharp, "0.35.3");',
        'assert.equal(typeof sharp.versions.vips, "string");',
        'assert.equal(extension.default.version, "1.0.0");',
        "process.stdout.write(JSON.stringify({ extensionVersion: extension.default.version, nanoidVersion: nanoidManifest.version, postcssVersion: postcssManifest.version, sharpVersion: sharp.versions.sharp, vipsVersion: sharp.versions.vips }));",
        "",
      ].join("\n"),
      "utf8",
    );
    const dependencies = JSON.parse(
      run(process.execPath, ["dependency-probe.mjs"], {
        cwd: hostRoot,
        env: proofEnvironment,
        label: "clean packed Next dependency probe",
      }),
    );
    run(process.execPath, ["export-probe.mjs"], {
      cwd: hostRoot,
      env: proofEnvironment,
      label: "clean packed Next export probe",
    });
    const serverImportFailure = runExpectFailure(
      process.execPath,
      ["server-import-probe.mjs"],
      {
        cwd: hostRoot,
        env: proofEnvironment,
        label: "clean packed Next server-only import probe",
      },
    );
    assert.match(
      serverImportFailure,
      /Client Component|server-only|Server Component/iu,
    );
    run(
      process.execPath,
      [
        join(hostRoot, "node_modules", "typescript", "bin", "tsc"),
        "--ignoreConfig",
        "--noEmit",
        "--skipLibCheck",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--target",
        "ES2022",
        "declaration-probe.ts",
      ],
      {
        cwd: hostRoot,
        env: proofEnvironment,
        label: "clean packed Next declaration probe",
      },
    );
    const boundaryFailure = runExpectFailure(
      process.execPath,
      [npmExecPath, "run", "build"],
      {
        cwd: hostRoot,
        env: proofEnvironment,
        label: "server-only Client Component build probe",
      },
    );
    assert.match(boundaryFailure, /server-boundary-proof/iu);
    assert.match(
      boundaryFailure,
      /Client Component|server-only|Server Component/iu,
    );
    await Promise.all([
      rm(boundaryProofRoot, {
        force: true,
        recursive: true,
      }),
      rm(join(hostRoot, ".next"), {
        force: true,
        recursive: true,
      }),
    ]);
    const sourceHashBeforeBuild = await hashHostSources(hostRoot);
    const buildOutput = runNpm(["run", "build"], {
      cwd: hostRoot,
      env: proofEnvironment,
      label: "clean packed Next host build",
    });
    const sourceHashAfterBuild = await hashHostSources(hostRoot);
    assert.equal(
      sourceHashAfterBuild,
      sourceHashBeforeBuild,
      "next build mutated the thin host source tree.",
    );
    if (browserExecutable !== undefined) {
      browser = await startBrowser(
        browserExecutable,
        temporaryRoot,
      );
    }

    const htmlFiles = await listHtmlFiles(
      join(hostRoot, ".next", "server", "app"),
    );
    const prerenderManifest = await readFile(
      join(hostRoot, ".next", "prerender-manifest.json"),
      "utf8",
    );
    const [frameworkNotFoundHtml, frameworkServerErrorHtml] =
      await Promise.all([
        readFile(
          join(
            hostRoot,
            ".next",
            "server",
            "pages",
            "404.html",
          ),
          "utf8",
        ),
        readFile(
          join(
            hostRoot,
            ".next",
            "server",
            "pages",
            "500.html",
          ),
          "utf8",
        ),
      ]);
    const assertAttributedHtml = (html, label) => {
      for (const expected of [
        'data-publisher-attribution="required"',
        reader.publication.attribution.copyright,
        reader.publication.attribution.text,
        reader.publication.attribution.url,
        reader.publication.attribution.sourceCodeUrl,
      ]) {
        assert.ok(
          html.includes(expected),
          `${label} omitted ${expected}.\n${html.slice(0, 2000)}`,
        );
      }
    };
    assertAttributedHtml(
      frameworkNotFoundHtml,
      "Built framework 404 HTML",
    );
    assertAttributedHtml(
      frameworkServerErrorHtml,
      "Built framework 500 HTML",
    );
    for (const [html, label] of [
      [frameworkNotFoundHtml, "Built framework 404 HTML"],
      [frameworkServerErrorHtml, "Built framework 500 HTML"],
    ]) {
      assert.ok(
        html.includes(portableThemeAccent),
        `${label} omitted the separately packaged theme accent.`,
      );
    }
    const clientChunkFiles = await listJavaScriptFiles(
      join(hostRoot, ".next", "static"),
    );
    const clientChunks = (
      await Promise.all(
        clientChunkFiles.map((filePath) =>
          readFile(filePath, "utf8"),
        ),
      )
    ).join("\n");
    for (const errorBoundarySentinel of [
      "data-publisher-attribution",
      reader.publication.attribution.text,
      reader.publication.attribution.sourceCodeUrl,
    ]) {
      assert.ok(
        clientChunks.includes(errorBoundarySentinel),
        `Browser error boundary chunks omitted ${errorBoundarySentinel}.`,
      );
    }
    for (const manuscriptSentinel of [
      "published-notes",
      "unlisted-notes",
      "First *safe* line",
      "unsafe link",
      packedExtensionServerSentinel,
    ]) {
      assert.equal(
        clientChunks.includes(manuscriptSentinel),
        false,
        `Browser chunks contain manuscript sentinel ${manuscriptSentinel}.`,
      );
    }

    let host;
    let renderedRoutes;
    let redirectStatuses;
    let frameworkErrorStatuses;
    let runtimeErrorStatus;
    let imageContentType;
    let manuscriptExtensionsVerified = false;
    let readerToolsHydrationVerified = false;
    let offlineReaderVerified = false;
    try {
      host = await startHost(hostRoot, proofEnvironment);
    } catch (error) {
      throw new Error(
        [
          "Packed host startup failed after this build:",
          buildOutput,
          "Prerender manifest:",
          prerenderManifest,
          error instanceof Error ? error.message : String(error),
        ].join("\n"),
        { cause: error },
      );
    }
    try {
      renderedRoutes = reader.routes.active.map(
        ({ path }) => path,
      );
      const renderedResponses = await Promise.all(
        renderedRoutes.map((path) =>
          fetch(`${host.origin}${path}`, {
            redirect: "manual",
          }),
        ),
      );
      const failedRoutes = renderedRoutes.flatMap((path, index) =>
        renderedResponses[index].status === 200
          ? []
          : [`${path}: ${renderedResponses[index].status}`],
      );
      assert.deepEqual(
        failedRoutes,
        [],
        `Packed host route failures:\n${failedRoutes.join("\n")}`,
      );
      const html = (
        await Promise.all(
          renderedResponses.map((response) => response.text()),
        )
      ).join("\n");
      const semanticHtml = withoutFocusMarkup(html);
      assert.ok(
        semanticHtml.includes(portableThemeAccent),
        "Server HTML omitted the separately packaged theme accent.",
      );
      for (const expected of [
        "Renderer Proof",
        "Café + Field Notes",
        '<a href="/readings/plus+two">First</a> <em>safe</em> line',
        "Quiet Draft",
        "Old Record",
        "Copyright 2026 GENII Foundation",
        "Published with GENII Publisher",
        "https://publisher.genii.foundation",
        "https://github.com/genii-foundation/publisher",
        packedExtensionRenderSentinel,
        packedExtensionServerSentinel,
      ]) {
        assert.ok(
          semanticHtml.includes(expected),
          `Server HTML omitted ${expected}.`,
        );
      }
      assert.doesNotMatch(
        html,
        /<script>alert\(2\)<\/script>/u,
      );
      assert.doesNotMatch(html, /href="javascript:/iu);

      if (browser !== undefined) {
        const sectionPath = reader.routes.active.find(
          ({ target }) => target.kind === "section",
        )?.path;
        assert.equal(typeof sectionPath, "string");
        await assertHydratedReaderTools({
          bookmarkProof: createCrossTabBookmarkProof(reader, sectionPath),
          browser,
          url: `${host.origin}${sectionPath}`,
        });
        readerToolsHydrationVerified = true;
        const tableRoute = reader.routes.active.find(
          ({ target }) =>
            target.kind === "section" &&
            target.sectionId === "published-closing",
        );
        assert.notEqual(tableRoute, undefined);
        await assertAccessibleManuscriptExtensions({
          browser,
          url: `${host.origin}${tableRoute.path}`,
        });
        manuscriptExtensionsVerified = true;
        const timedRoute = reader.routes.active.find(
          ({ target }) =>
            target.kind === "section" &&
            target.sectionId === timedSection.id,
        );
        assert.notEqual(timedRoute, undefined);
        assert.equal(timedRoute.target.kind, "section");
        const setupRoute = reader.routes.active.find(
          ({ path, target }) =>
            path !== timedRoute.path &&
            target.kind === "section" &&
            target.workId === timedRoute.target.workId,
        ) ?? reader.routes.active.find(
          ({ target }) =>
            target.kind === "work" &&
            target.workId === timedRoute.target.workId,
        );
        assert.notEqual(setupRoute, undefined);
        await assertOfflineReaderTools({
          browser,
          destinationUrl: `${host.origin}${timedRoute.path}`,
          excludedSearchText: "Quiet Draft",
          includedSearchText: "safe",
          initialUrl: `${host.origin}${setupRoute.path}`,
          workId: timedRoute.target.workId,
        });
        offlineReaderVerified = true;
      }

      const internal = await fetch(
        `${host.origin}/legacy/(cafe)+story?edition=morning`,
        { redirect: "manual" },
      );
      const publishedWorkPath = reader.routes.active.find(
        ({ target }) =>
          target.kind === "work" &&
          target.workId === "published-notes",
      )?.path;
      assert.equal(typeof publishedWorkPath, "string");
      assert.equal(internal.status, 308);
      assert.equal(
        internal.headers.get("location"),
        `${publishedWorkPath}?edition=morning`,
      );
      assert.equal(
        internal.headers.get("location").includes("%2B"),
        false,
      );

      const external = await fetch(
        `${host.origin}/depart?private=do-not-leak`,
        { redirect: "manual" },
      );
      assert.equal(external.status, 307);
      const externalTarget = reader.routes.redirects.find(
        ({ from }) => from === "/depart",
      )?.to;
      assert.equal(typeof externalTarget, "string");
      assert.equal(
        external.headers.get("location"),
        new URL(externalTarget).href,
      );

      const slashAlias = publishedWorkPath.endsWith("/")
        ? publishedWorkPath.slice(0, -1)
        : `${publishedWorkPath}/`;
      const slash = await fetch(
        `${host.origin}${slashAlias}?from=alias`,
        { redirect: "manual" },
      );
      assert.equal(slash.status, 308);
      assert.equal(
        slash.headers.get("location"),
        `${publishedWorkPath}?from=alias`,
      );

      const canonicalAliases = [
        publishedWorkPath.replace("+", "%2B"),
        publishedWorkPath.replace("%C3%A9", "%c3%a9"),
        publishedWorkPath.replace("caf", "%63af"),
      ];
      for (const alias of canonicalAliases) {
        const rejected = await fetch(`${host.origin}${alias}`, {
          redirect: "manual",
        });
        assert.equal(rejected.status, 404);
        assert.match(
          await rejected.text(),
          /data-publisher-attribution="required"/u,
        );
      }

      const unknown = await fetch(
        `${host.origin}/unknown-publication-path`,
        { redirect: "manual" },
      );
      assert.equal(unknown.status, 404);
      assert.match(
        await unknown.text(),
        /data-publisher-attribution="required"/u,
      );
      const [
        configuredCallback,
        startedAuthentication,
        verifiedAuthentication,
        configuredSession,
        configuredSyncRead,
        configuredSyncTransfer,
        rejectedSyncTransfer,
        rejectedDeletion,
        configuredDeletion,
      ] = await Promise.all([
        fetch(
          `${host.origin}/auth/callback?code=packed-proof-code&next=https%3A%2F%2Fevil.example`,
          { redirect: "manual" },
        ),
        fetch(`${host.origin}/api/auth/start`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: host.origin,
          },
          body: JSON.stringify({
            email: "reader@example.com",
            next: "https://evil.example/private",
          }),
          redirect: "manual",
        }),
        fetch(`${host.origin}/api/auth/verify`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: host.origin,
          },
          body: JSON.stringify({
            email: "reader@example.com",
            code: "12345678",
          }),
          redirect: "manual",
        }),
        fetch(`${host.origin}/api/session`, { redirect: "manual" }),
        fetch(`${host.origin}/api/sync`, { redirect: "manual" }),
        fetch(`${host.origin}/api/sync`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: host.origin,
          },
          body: JSON.stringify({
            progress: {
              value: {
                schemaVersion: 1,
                publicationId: reader.publicationId,
                entries: {},
              },
              schemaVersion: 1,
            },
          }),
          redirect: "manual",
        }),
        fetch(`${host.origin}/api/sync`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://evil.example",
          },
          body: JSON.stringify({
            progress: { value: {}, schemaVersion: 1 },
          }),
          redirect: "manual",
        }),
        fetch(`${host.origin}/api/account`, {
          method: "DELETE",
          headers: { origin: "https://evil.example" },
          redirect: "manual",
        }),
        fetch(`${host.origin}/api/account`, {
          method: "DELETE",
          headers: { origin: host.origin },
          redirect: "manual",
        }),
      ]);
      assert.equal(configuredCallback.status, 302);
      assert.equal(configuredCallback.headers.get("location"), `${host.origin}/home`);
      assert.equal(startedAuthentication.status, 202);
      assert.deepEqual(await startedAuthentication.json(), { ok: true });
      assert.equal(verifiedAuthentication.status, 200);
      assert.deepEqual(await verifiedAuthentication.json(), {
        authenticated: true,
        email: "reader@example.com",
      });
      assert.equal(configuredSession.status, 200);
      assert.deepEqual(await configuredSession.json(), { authenticated: false });
      assert.equal(configuredSyncRead.status, 200);
      assert.deepEqual(await configuredSyncRead.json(), {
        progress: null,
        bookmarks: null,
        consent: null,
      });
      assert.equal(configuredSyncTransfer.status, 200);
      assert.equal(
        (await configuredSyncTransfer.json()).state.progress.value.publicationId,
        reader.publicationId,
      );
      assert.equal(rejectedSyncTransfer.status, 403);
      assert.deepEqual(await rejectedSyncTransfer.json(), { error: "Invalid origin." });
      assert.equal(rejectedDeletion.status, 403);
      assert.deepEqual(await rejectedDeletion.json(), { error: "Invalid origin." });
      assert.equal(configuredDeletion.status, 200);
      assert.deepEqual(await configuredDeletion.json(), { ok: true });
      const configuredSignOut = await fetch(`${host.origin}/api/session`, {
        method: "DELETE",
        headers: { origin: host.origin },
        redirect: "manual",
      });
      assert.equal(configuredSignOut.status, 200);
      assert.deepEqual(await configuredSignOut.json(), { ok: true });
      const [frameworkNotFound, frameworkServerError] =
        await Promise.all([
          fetch(`${host.origin}/404`, {
            redirect: "manual",
          }),
          fetch(`${host.origin}/500`, {
            redirect: "manual",
          }),
        ]);
      assert.equal(frameworkNotFound.status, 404);
      assert.equal(frameworkServerError.status, 500);
      assertAttributedHtml(
        await frameworkNotFound.text(),
        "Framework 404 response",
      );
      assertAttributedHtml(
        await frameworkServerError.text(),
        "Framework 500 response",
      );
      frameworkErrorStatuses = Object.freeze([
        frameworkNotFound.status,
        frameworkServerError.status,
      ]);
      const image = await fetch(
        `${host.origin}/_next/image?url=%2Fproof.png&w=64&q=75`,
        {
          headers: {
            accept: "image/webp",
          },
          redirect: "manual",
        },
      );
      assert.equal(image.status, 200);
      imageContentType = image.headers.get("content-type");
      assert.equal(imageContentType, "image/webp");
      assert.ok((await image.arrayBuffer()).byteLength > 0);

      const runtimeError = await fetch(
        `${host.origin}/runtime-error-proof`,
        {
          redirect: "manual",
        },
      );
      runtimeErrorStatus = runtimeError.status;
      assert.equal(runtimeErrorStatus, 500);
      const runtimeErrorHtml = await runtimeError.text();
      assert.equal(
        runtimeErrorHtml.includes(
          "PACKAGED_RUNTIME_ERROR_SECRET",
        ),
        false,
      );
      if (browser !== undefined) {
        await assertHydratedErrorAttribution({
          browser,
          label: "Hydrated runtime error page",
          secret: "PACKAGED_RUNTIME_ERROR_SECRET",
          sourceCodeUrl:
            reader.publication.attribution.sourceCodeUrl,
          url: `${host.origin}/runtime-error-proof`,
        });
      }
      redirectStatuses = Object.freeze([
        internal.status,
        external.status,
        slash.status,
      ]);
    } catch (error) {
      throw new Error(
        [
          "Packed host request proof failed.",
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
          `Rendered HTML files: ${JSON.stringify(htmlFiles)}`,
          "Prerender manifest:",
          prerenderManifest,
          host.output(),
        ].join("\n"),
        { cause: error },
      );
    } finally {
      await stopHost(host.child);
    }
    const globalEnvironment = {
      ...proofEnvironment,
      PUBLISHER_GLOBAL_ERROR_PROOF: "1",
    };
    let globalHost;
    let globalErrorStatus;
    try {
      globalHost = await startHost(
        hostRoot,
        globalEnvironment,
        Object.freeze({
          path: "/global-error-proof",
          status: 500,
        }),
      );
      const globalError = await fetch(
        `${globalHost.origin}/global-error-proof`,
        {
          redirect: "manual",
        },
      );
      globalErrorStatus = globalError.status;
      assert.equal(globalErrorStatus, 500);
      const globalRuntimeHtml = await globalError.text();
      assert.equal(
        globalRuntimeHtml.includes(
          "PACKAGED_GLOBAL_ERROR_SECRET",
        ),
        false,
      );
      if (browser !== undefined) {
        await assertHydratedErrorAttribution({
          browser,
          label: "Hydrated global error page",
          secret: "PACKAGED_GLOBAL_ERROR_SECRET",
          sourceCodeUrl:
            reader.publication.attribution.sourceCodeUrl,
          url: `${globalHost.origin}/global-error-proof`,
        });
      }
    } catch (error) {
      throw new Error(
        [
          "Packed host global error proof failed.",
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
          globalHost?.output() ?? "",
        ].join("\n"),
        { cause: error },
      );
    } finally {
      if (globalHost !== undefined) {
        await stopHost(globalHost.child);
      }
    }

    return Object.freeze({
      auditVulnerabilities:
        audit.metadata.vulnerabilities.total,
      browserHydrationVerified: browser !== undefined,
      manuscriptExtensionsVerified,
      offlineReaderVerified,
      readerToolsHydrationVerified,
      globalErrorStatus,
      frameworkErrorStatuses,
      htmlFiles: Object.freeze(
        htmlFiles.map((filePath) =>
          packagePath(
            relative(
              join(hostRoot, ".next", "server", "app"),
              filePath,
            ),
          ),
        ),
      ),
      imageContentType,
      nextVersion: nextManifest.peerDependencies.next,
      postcssVersion: dependencies.postcssVersion,
      nanoidVersion: dependencies.nanoidVersion,
      redirectStatuses,
      renderedRoutes: Object.freeze(renderedRoutes),
      runtimeErrorStatus,
      sharpVersion: dependencies.sharpVersion,
      extensionPackage:
        `@example/packed-publication-extension@${dependencies.extensionVersion}`,
      themePackage: "@example/packed-publication-theme@1.0.0",
      vipsVersion: dependencies.vipsVersion,
    });
  } finally {
    try {
      if (browser !== undefined) {
        await stopBrowser(browser.child);
      }
    } finally {
      await removeOwnedTemporaryRoot(temporaryRoot);
    }
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const readerPath = process.argv[2];
  if (readerPath === undefined) {
    throw new TypeError(
      "Pass the path to a serialized reader envelope.",
    );
  }
  const reader = JSON.parse(await readFile(readerPath, "utf8"));
  const result = await runPackagedHostProof(reader, {
    browserExecutable:
      process.env.PUBLISHER_NEXT_BROWSER_EXECUTABLE,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
