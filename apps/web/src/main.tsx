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

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

if (isElectron) {
  syncDocumentElectronPlatformClasses(navigator.platform);
  syncDocumentWindowControlsOverlayClass();
}

// A lazy chunk a deploy removed, met outside any route (Vite's preload says so): the new build.
window.addEventListener("vite:preloadError", (event) => {
  staleChunkRecovery.recover(event.payload);
});

const root = document.getElementById("root") as HTMLElement;
// index.html's first frame stands until the app draws into #root.
keepBootFrame(root);

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppRoot router={router} />
  </React.StrictMode>,
);
