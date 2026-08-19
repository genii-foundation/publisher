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
  return Object.freeze({
    quote,
    storageKey: createReaderBookmarksStorageKey(reader.publicationId),
    state: {
      schemaVersion: 1,
      publicationId: reader.publicationId,
      bookmarks: {
        "cross-tab-proof": {
          id: "cross-tab-proof",
          createdAt: now,
          updatedAt: now,
          workId: work.id,
          sectionContinuityId: section.continuity.id,
          href: sectionPath,
          quote,
          prefix: "",
          suffix: "",
          range: {
            start: point(0),
            end: point(quote.length),
          },
        },
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
        ready.controls === 5 &&
        ready.inViewport === true
      ) {
        break;
      }
      await wait(100);
    }
    assert.deepEqual(
      ready,
      { complete: true, controls: 5, inViewport: true },
      "The hydrated Reader rail was not reachable inside the mobile viewport.",
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
        progressEntries: 1,
        bookmarksSchemaVersion: null,
        consentGranted: true,
        acknowledgedEvents: 1,
      },
      "The default Reader did not complete and acknowledge its sparse local-first synchronization transfer.",
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
          evaluated.result.value.controls === 5;
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
    } finally {
      peerPage.close();
    }
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
  const [rootApi, defaultThemeApi, hostApi] = await Promise.all([
    import(
      new URL(
        `../dist/index.js?proof=${encodeURIComponent(nextManifest.version)}`,
        import.meta.url,
      )
    ),
    import(
      new URL(
        `../dist/theme/default.js?proof=${encodeURIComponent(nextManifest.version)}`,
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
  const configuredTheme =
    defaultThemeApi.defaultPublisherNextTheme.configure(
      Object.freeze({}),
    );
  assert.equal(
    configuredTheme.valid,
    true,
    JSON.stringify(configuredTheme.diagnostics),
  );
  const homeRoute = reader.routes.active.find(
    ({ target }) => target.kind === "home",
  );
  assert.notEqual(homeRoute, undefined);
  const errorIdentity = Object.freeze({
    homePath: homeRoute.path,
    publication: reader.publication,
    theme: configuredTheme.value,
  });

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "genii-publisher-next-host-"),
  );
  let browser;
  try {
    const packRoot = join(temporaryRoot, "pack");
    const hostRoot = join(temporaryRoot, "host");
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
      mkdir(routeRoot, { recursive: true }),
      mkdir(boundaryProofRoot, { recursive: true }),
      mkdir(runtimeErrorRoot, { recursive: true }),
      mkdir(globalErrorRoot, { recursive: true }),
      mkdir(publicRoot, { recursive: true }),
      mkdir(pagesRoot, { recursive: true }),
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
      errorIdentity,
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
      `app/${basename(runtimeErrorRoot)}/page.tsx`,
      `app/${basename(globalErrorRoot)}/page.tsx`,
      `app/${basename(boundaryProofRoot)}/page.tsx`,
      "public/proof.png",
      hostTemplate.readerDataPath,
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

    await Promise.all([
      writeJson(
        join(hostRoot, hostTemplate.readerDataPath),
        reader,
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
          'import { createPublisherNextErrorIdentity, PublisherNextErrorPage, PublisherNextFrameworkErrorPage, PublisherNextGlobalErrorPage, type PublisherNextErrorIdentity } from "@genii-foundation/publisher-next/client";',
          'import { createPublisherNextConfig } from "@genii-foundation/publisher-next/config";',
          'import { defaultPublisherNextTheme, validatePublisherNextThemeInstance } from "@genii-foundation/publisher-next/theme";',
          'import { defaultPublisherNextTheme as directDefaultTheme } from "@genii-foundation/publisher-next/theme/default";',
          "",
          "declare const application: PublicationNextApplication;",
          "declare const errorIdentity: PublisherNextErrorIdentity;",
          "void application;",
          "void errorIdentity;",
          "void PUBLISHER_NEXT_REQUIRED_HOST_OVERRIDES;",
          "void PUBLISHER_NEXT_VERSION;",
          "void PublisherNextErrorPage;",
          "void PublisherNextFrameworkErrorPage;",
          "void PublisherNextGlobalErrorPage;",
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
        'assert.equal(postcssManifest.version, "8.5.24");',
        'assert.equal(nanoidManifest.version, "3.3.18");',
        'assert.equal(sharp.versions.sharp, "0.35.3");',
        'assert.equal(typeof sharp.versions.vips, "string");',
        "process.stdout.write(JSON.stringify({ nanoidVersion: nanoidManifest.version, postcssVersion: postcssManifest.version, sharpVersion: sharp.versions.sharp, vipsVersion: sharp.versions.vips }));",
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
    let readerToolsHydrationVerified = false;
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
      ]) {
        assert.ok(
          html.includes(expected),
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
