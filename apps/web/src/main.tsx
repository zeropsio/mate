import React from "react";
import ReactDOM from "react-dom/client";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "./index.css";

import { isElectron } from "./env";
import { getRouter } from "./router";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { AppRoot } from "./AppRoot";
import { keepBootFrame } from "./zerops/bootFrame";
import { staleChunkRecovery } from "./lib/staleChunk";
import { warmAppChunksAfterSettling } from "./lib/appChunks";
import { pressesInFlight } from "./zerops/matePress";
import { captureZeropsHqSignIn } from "./zerops/hqSignIn";
import { appBasePath } from "./basePath";
import { preloadChatView } from "./components/ChatViewBoundary";
import { addressOpensConversation } from "./routes/-environmentRoute";

// HQ's card sign-in leaves the address before the router reads it (`zerops/hqSignIn.ts`).
captureZeropsHqSignIn();

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

// A reload on a conversation's address fetches the conversation's code beside its data.
if (
  addressOpensConversation(
    isElectron
      ? window.location.hash.replace(/^#/u, "").split("?")[0] || "/"
      : window.location.pathname,
    isElectron ? "" : appBasePath(),
  )
) {
  preloadChatView();
}

if (isElectron) {
  syncDocumentElectronPlatformClasses(navigator.platform);
  syncDocumentWindowControlsOverlayClass();
}

// A lazy chunk a deploy removed, met outside any route (Vite's preload says so): the new build.
window.addEventListener("vite:preloadError", (event) => {
  staleChunkRecovery.recover(event.payload);
});

// The app's surfaces load once the page settles: a later deploy never strands a click
// (`appChunks.ts`). A desktop window's bundle is its own files, never replaced under it; the
// design kit is a maintainer's page.
if (!isElectron) {
  warmAppChunksAfterSettling(
    Object.values(router.routesById)
      .filter((route) => route.id !== "/kit")
      .map((route) => () => router.loadRouteChunk(route) ?? Promise.resolve()),
  );
}

// A Mate's setup runs in the tab that pressed it and stops with the page: leaving asks first. Not
// in Electron, where a prevented unload keeps the window from closing without asking.
if (!isElectron) {
  window.addEventListener("beforeunload", (event) => {
    if (pressesInFlight.read()) event.preventDefault();
  });
}

const root = document.getElementById("root") as HTMLElement;
// index.html's first frame stands until the app draws into #root.
keepBootFrame(root);

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppRoot router={router} />
  </React.StrictMode>,
);
