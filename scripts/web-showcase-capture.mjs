#!/usr/bin/env node

import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { app, BrowserWindow } from "electron";

import { APPEARANCE_ARGUMENT, matchesRequestedAppearance } from "./web-showcase-preload.mjs";

const BROWSER_SESSION_TIMEOUT_MS = 15_000;
const SHOWCASE_READY_CAP_MS = 5_000;
const PRELOAD_PATH = NodeURL.fileURLToPath(new URL("./web-showcase-preload.mjs", import.meta.url));

function optionValue(args, option) {
  const index = args.indexOf(option);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseNavigation(value) {
  const steps = JSON.parse(value);
  if (!Array.isArray(steps) || steps.length !== 2) {
    throw new Error("--navigation must contain the pair and deep-link steps.");
  }
  const [pair, deepLink] = steps;
  if (
    pair?.kind !== "redeem-browser-session" ||
    typeof pair.url !== "string" ||
    pair.method !== "POST" ||
    pair.pathname !== "/api/auth/browser-session" ||
    deepLink?.kind !== "navigate" ||
    typeof deepLink.url !== "string"
  ) {
    throw new Error("--navigation must redeem a browser session before the deep link.");
  }
  return steps;
}

function waitForBrowserSession(window, step) {
  const expectedOrigin = new URL(step.url).origin;
  const request = window.webContents.session.webRequest;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      request.onCompleted(null);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `The client did not complete ${step.method} ${step.pathname} within ${BROWSER_SESSION_TIMEOUT_MS}ms.`,
        ),
      );
    }, BROWSER_SESSION_TIMEOUT_MS);
    request.onCompleted({ urls: ["<all_urls>"] }, (details) => {
      const url = new URL(details.url);
      if (
        details.method !== step.method ||
        url.origin !== expectedOrigin ||
        url.pathname !== step.pathname
      ) {
        return;
      }
      cleanup();
      if (details.statusCode < 200 || details.statusCode >= 300) {
        reject(new Error(`${step.method} ${step.pathname} completed with ${details.statusCode}.`));
        return;
      }
      resolve();
    });
  });
}

async function executeNavigation(window, steps) {
  const [pair, deepLink] = steps;
  const browserSessionCompleted = waitForBrowserSession(window, pair);
  await Promise.all([window.loadURL(pair.url), browserSessionCompleted]);
  await window.loadURL(deepLink.url);
}

async function capture() {
  const args = NodeProcess.argv.slice(2);
  const navigation = parseNavigation(optionValue(args, "--navigation"));
  const width = parsePositiveInteger(optionValue(args, "--width"), "--width");
  const height = parsePositiveInteger(optionValue(args, "--height"), "--height");
  const appearance = optionValue(args, "--appearance");
  const outputPath = NodePath.resolve(optionValue(args, "--out"));
  const profileDirectory = NodePath.resolve(optionValue(args, "--profile"));
  if (appearance !== "light" && appearance !== "dark") {
    throw new Error("--appearance must be light or dark.");
  }

  app.setPath("userData", profileDirectory);
  await app.whenReady();
  const window = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    frame: false,
    show: false,
    backgroundColor: appearance === "light" ? "#ffffff" : "#0a0a0a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: PRELOAD_PATH,
      additionalArguments: [`${APPEARANCE_ARGUMENT}${appearance}`],
    },
  });

  const preloadFailure = new Promise((_, reject) => {
    window.webContents.on("preload-error", (_event, preloadPath, error) => {
      reject(new Error(`Unable to load preload script ${preloadPath}: ${error.message}`));
    });
  });
  const image = await Promise.race([
    (async () => {
      await executeNavigation(window, navigation);
      const readinessStartedAt = Date.now();
      await Promise.race([
        window.webContents.executeJavaScript("document.fonts.ready.then(() => true)"),
        delay(SHOWCASE_READY_CAP_MS),
      ]);
      const remaining = SHOWCASE_READY_CAP_MS - (Date.now() - readinessStartedAt);
      if (remaining > 0) await delay(remaining);

      const appearanceState = await window.webContents.executeJavaScript(`({
        appearance: localStorage.getItem("t3code:theme-appearance-mode"),
        followSystem: localStorage.getItem("t3code:theme-follow-system"),
        resolvedAppearance: document.documentElement.classList.contains("dark") ? "dark" : "light",
      })`);
      if (!matchesRequestedAppearance(appearanceState, appearance)) {
        throw new Error(
          `Requested ${appearance} appearance, but the page reported appearance=${JSON.stringify(appearanceState.appearance)}, followSystem=${JSON.stringify(appearanceState.followSystem)}, resolvedAppearance=${JSON.stringify(appearanceState.resolvedAppearance)}.`,
        );
      }
      return await window.webContents.capturePage();
    })(),
    preloadFailure,
  ]);
  const dimensions = image.getSize();
  if (dimensions.width !== width || dimensions.height !== height) {
    throw new Error(
      `Electron captured ${dimensions.width}×${dimensions.height}; expected ${width}×${height}.`,
    );
  }
  await NodeFSP.mkdir(NodePath.dirname(outputPath), { recursive: true });
  await NodeFSP.writeFile(outputPath, image.toPNG({ scaleFactor: 1 }));
  window.destroy();
  app.quit();
}

void capture().catch((error) => {
  NodeProcess.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  app.exit(1);
});
