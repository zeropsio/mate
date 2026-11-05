/**
 * The hosted client's app-shell worker decides here, and only here, what it answers.
 *
 * The hosted client (zerops.yml `prod`/`staging`: static nginx behind Cloudflare) asks for its page
 * on every load, `no-cache`: a reload waited 150–470 ms for the page's first byte, and once 10.8 s
 * on a stalled origin with a blank screen. The worker answers a reload with the page it kept and
 * asks the origin for a newer one beside it (stale-while-revalidate): the next load runs what the
 * origin served this time. The bundle's own files (`/assets/*`, named by their content) come from a
 * cache first, so a kept page's chunks still load after a deploy removed them.
 *
 * **A page is kept only with its files.** The build lists in each page what it boots and warms
 * from (`appShellBuild.logic.ts`); the worker fetches every listed file into the asset cache and
 * only then keeps the page. A deploy that lands between a page's fetch and its files leaves the
 * previous page kept, so a kept page always boots, however many deploys later.
 *
 * Every decision is a pure function of the request, a stored time or a list of entries; the worker
 * (`appShellWorker.ts`) only carries them out with the Cache API. The page reads the same names to
 * forget its kept page before a stale-chunk reload (`appShellClient.ts`).
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

/** When the worker stored an entry, ms since the epoch, on the stored response itself. */
export const STORED_AT_HEADER = "x-mate-app-shell-stored-at";

/**
 * On a kept page: how many files it listed, all kept before it was. A page kept without it (an
 * earlier worker's) is not answered at once.
 */
export const LISTED_FILES_HEADER = "x-mate-app-shell-files";

/** The element of the page that lists its files (`embedShellFiles`). */
export const SHELL_FILES_ELEMENT_ID = "app-shell-files";

/** How many listed files the worker fetches at once while it keeps a page. */
export const PRECACHE_CONCURRENCY = 6;

/**
 * A kept page this old is not answered at once: the origin is asked first (falling back to the
 * kept page only when it cannot answer). A week means someone who has not opened Mate for a week
 * waits for one round trip instead of running a week-old build for one load; every load that does
 * reach the origin refreshes the time, so daily use never meets the bound.
 */
export const SHELL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

/** `cached`: answer the kept page now and refresh it behind; `network`: ask the origin first. */
export type ShellPlan = "cached" | "network";

/**
 * A kept page is answered at once while it is younger than {@link SHELL_MAX_AGE_MS} and was kept
 * with its files. None kept, one kept without its files (an earlier worker's), one the page forgot
 * (stored at 0, `forgetCachedShell`), one past the bound, or one stored in the future (the clock
 * went back) asks the origin first.
 */
export function planShell(
  kept: { readonly storedAt: number | undefined; readonly listed: boolean } | undefined,
  now: number,
): ShellPlan {
  if (kept === undefined || !kept.listed) return "network";
  const { storedAt } = kept;
  if (storedAt === undefined || !Number.isFinite(storedAt) || storedAt <= 0) return "network";
  const age = now - storedAt;
  return age >= 0 && age < SHELL_MAX_AGE_MS ? "cached" : "network";
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

/** When an entry was stored, from its header; `undefined` when it carries none. */
export function readStoredAt(headers: Pick<Headers, "get">): number | undefined {
  const raw = headers.get(STORED_AT_HEADER);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The same response, carrying when it was stored. Consumes `response`'s body. The body a fetch
 * hands over is already decoded, so the transfer's encoding and length no longer describe it.
 */
export function stampResponse(response: Response, storedAt: number): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.set(STORED_AT_HEADER, String(storedAt));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
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
