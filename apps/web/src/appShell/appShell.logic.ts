/**
 * The hosted client's app-shell worker decides here, and only here, what it answers.
 *
 * The hosted client (zerops.yml `prod`/`staging`: static nginx behind Cloudflare) asks the origin
 * for its page on every load (network first, `no-cache`), so the first load after a deploy runs
 * the deploy. The page the worker kept answers only when the origin cannot: offline, or an origin
 * that fails. The bundle's own files (`/assets/*`, named by their content) come from a cache first,
 * so a tab running an older page still loads its chunks after a deploy removed them.
 *
 * **A page is kept only with its files.** The build lists in each page what it boots and warms
 * from (`appShellBuild.logic.ts`); the worker fetches every listed file into the asset cache and
 * only then keeps the page. A deploy that lands between a page's fetch and its files leaves the
 * previous page kept, so a kept page always boots, however many deploys later.
 *
 * Every decision is a pure function of the request or a list of entries; the worker
 * (`appShellWorker.ts`) only carries them out with the Cache API.
 *
 * The names below are a contract between builds, not a version: an open tab running an older
 * bundle still asks the newest worker for its chunks, so a cache is never renamed casually, and the
 * worker deletes only caches of its prefix it does not know.
 */

import { isDevProxiedPath } from "@t3tools/shared/devProxy";

/** Every cache the worker owns starts with this; the retiring worker clears them all. */
export const APP_SHELL_CACHE_PREFIX = "mate-app-";
/** One entry: the page, kept under {@link SHELL_CACHE_KEY_PATH}. */
export const SHELL_CACHE = `${APP_SHELL_CACHE_PREFIX}shell-v1`;
/** The bundle's content-named files: the kept build's and the one before it ({@link assetsToEvict}). */
export const ASSET_CACHE = `${APP_SHELL_CACHE_PREFIX}assets-v1`;
export const KNOWN_CACHES: ReadonlySet<string> = new Set([SHELL_CACHE, ASSET_CACHE]);

/** The page is the same document at every app address (the host's SPA fallback): kept once. */
export const SHELL_CACHE_KEY_PATH = "/";

/** The element of the page that lists its files (`embedShellFiles`). */
export const SHELL_FILES_ELEMENT_ID = "app-shell-files";

/** How many listed files the worker fetches at once while it keeps a page. */
export const PRECACHE_CONCURRENCY = 6;

/**
 * How long the worker leaves the network to a page that just began loading before it fetches the
 * files it keeps for it: a first visit, or the first load after a deploy, keeps about 300 files
 * (5.5 MB on the wire), which otherwise download beside the chunks and data the person waits on.
 * Past the page's own first seconds (`SETTLE_MS`, `lib/appChunks.ts`).
 */
export const PRECACHE_CALM_MS = 6_000;

/** Paths the origin serves itself or that belong to a backend, never the app's page. */
const NEVER_THE_PAGE_PREFIXES = ["/mate", "/assets", "/fonts"] as const;

export type AppShellRoute = "shell" | "asset" | "pass";

export interface AppShellRequest {
  readonly method: string;
  readonly url: string;
  readonly mode: RequestMode;
  readonly destination: RequestDestination;
  /** Whether the request asks for a byte range; ranges are the network's. */
  readonly ranged: boolean;
  /** The worker's registration scope; the worker only answers at an origin root. */
  readonly scope: string;
}

function hasPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** A path whose last segment names a file (`manifest.webmanifest`, `sw.js`, `favicon.svg`). */
function namesAFile(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return last.includes(".");
}

/**
 * What the worker does with a request: answer the app's page, answer a bundle file, or leave it to
 * the network untouched (`pass`: the worker never calls `respondWith`).
 *
 * Only an origin-root scope is served: the same bundle under a Mate's `/mate/` never registers a
 * worker, and one that somehow did answers nothing. Other origins (Zerops API, HQ, Mates, storage,
 * avatars) always pass. A dotted last segment passes even when it is an app address: the network
 * is the safe direction.
 */
export function routeRequest(request: AppShellRequest): AppShellRoute {
  if (request.method !== "GET" || request.ranged) return "pass";
  let url: URL;
  let scope: URL;
  try {
    url = new URL(request.url);
    scope = new URL(request.scope);
  } catch {
    return "pass";
  }
  if (scope.pathname !== "/" || url.origin !== scope.origin) return "pass";
  const { pathname } = url;
  if (request.mode === "navigate") {
    if (request.destination !== "document") return "pass";
    if (isDevProxiedPath(pathname)) return "pass";
    if (NEVER_THE_PAGE_PREFIXES.some((prefix) => hasPrefix(pathname, prefix))) return "pass";
    if (namesAFile(pathname)) return "pass";
    return "shell";
  }
  if (pathname.startsWith("/assets/") && pathname.length > "/assets/".length) return "asset";
  return "pass";
}

export interface ResponseFacts {
  readonly status: number;
  readonly type: ResponseType;
  readonly redirected: boolean;
  readonly url: string;
  readonly contentType: string | null;
}

/**
 * What may be kept: a plain 200 from this origin, never redirected, never opaque. The page must be
 * HTML; a bundle file must not be, since the host answers a missing file with the page.
 */
export function isKeepable(kind: "shell" | "asset", response: ResponseFacts, origin: string) {
  if (response.status !== 200 || response.type !== "basic" || response.redirected) return false;
  try {
    if (response.url !== "" && new URL(response.url).origin !== origin) return false;
  } catch {
    return false;
  }
  const html = (response.contentType ?? "").toLowerCase().startsWith("text/html");
  return kind === "shell" ? html : !html;
}

/**
 * A fetched response's headers, as stored: the body a fetch hands over is already decoded, so the
 * transfer's encoding and length no longer describe it.
 */
export function storedHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return headers;
}

/** The same response, ready to store. Consumes `response`'s body. */
export function storable(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: storedHeaders(response),
  });
}

/**
 * The asset entries to drop when a new page is kept: everything but the files the new page and the
 * page it replaces list. The replaced page's files stay for tabs still running it; anything else
 * (an older build's, or a file fetched on use) comes back from the origin or the HTTP cache on its
 * next request while its build is live.
 */
export function assetsToEvict(cachedUrls: readonly string[], keep: ReadonlySet<string>): string[] {
  return cachedUrls.filter((url) => !keep.has(url));
}

/** The page with its file list embedded, before `</head>` (the build's last step). */
export function embedShellFiles(html: string, files: readonly string[]): string {
  const json = JSON.stringify(files).replaceAll("<", "\\u003c");
  const element = `<script type="application/json" id="${SHELL_FILES_ELEMENT_ID}">${json}</script>`;
  const at = html.indexOf("</head>");
  if (at === -1) throw new Error("The page has no </head> to list its files before");
  return `${html.slice(0, at)}${element}\n  ${html.slice(at)}`;
}

const SHELL_FILES_PATTERN = new RegExp(
  `<script type="application/json" id="${SHELL_FILES_ELEMENT_ID}">([^<]*)</script>`,
  "u",
);

/** The files a page lists, or `undefined` for a page that lists none or an unreadable list. */
export function readShellFiles(html: string): string[] | undefined {
  const match = SHELL_FILES_PATTERN.exec(html);
  if (match === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const files = parsed.filter(
    (file): file is string => typeof file === "string" && file.startsWith("/assets/"),
  );
  return files.length === parsed.length && files.length > 0 ? files : undefined;
}

/** A static route the browser applies before waking the worker (the Static Routing API). */
export interface AppShellStaticRoute {
  readonly condition:
    | { readonly urlPattern: Readonly<Record<string, string>> }
    | { readonly requestMode: "navigate" };
  readonly source: "fetch-event" | "network";
}

/**
 * What wakes the worker at all: this origin's bundle files and navigations reach its fetch
 * handler; every other request of a controlled tab (Zerops API, HQ, Mates, avatars, this origin's
 * fonts) goes straight to the network, so a request after the worker went idle never waits for it
 * to start. The handler still decides (`routeRequest`): these routes only keep requests away from
 * it. Browsers without the API ignore it and send everything to the handler, which passes.
 */
export function staticRoutes(scope: string): AppShellStaticRoute[] {
  const { protocol, hostname, port } = new URL(scope);
  const thisOrigin = { protocol: protocol.replace(/:$/u, ""), hostname, port };
  return [
    { condition: { urlPattern: { ...thisOrigin, pathname: "/assets/*" } }, source: "fetch-event" },
    { condition: { requestMode: "navigate" }, source: "fetch-event" },
    { condition: { urlPattern: {} }, source: "network" },
  ];
}

/** Caches of the worker's prefix that no build of it knows: a renamed cache, left behind. */
export function cachesToDelete(names: readonly string[]): string[] {
  return names.filter((name) => name.startsWith(APP_SHELL_CACHE_PREFIX) && !KNOWN_CACHES.has(name));
}

/** How a step the worker runs behind an answer ended; a failed one is retried by the next load. */
export type StepOutcome = "done" | "failed";

/** The outcome of background work, which never rejects: nothing waits on it to show an error. */
export function outcomeOf(work: Promise<unknown>): Promise<StepOutcome> {
  return work.then(
    () => "done" as const,
    () => "failed" as const,
  );
}
