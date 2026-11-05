/**
 * The app-shell worker's behaviour over the Cache API and `fetch`, with every decision taken by
 * `appShell.logic.ts`. `sw.ts` binds it to the worker's events; tests bind it to fakes.
 *
 * It can never brick the app: any exception answers with the plain network request, a request it
 * does not route is never answered at all (`respondWith` is not called), and a page becomes the
 * kept one only once every file it lists is in the asset cache (`keepShell`).
 */

import {
  ASSET_CACHE,
  assetsToEvict,
  cachesToDelete,
  isKeepable,
  LISTED_FILES_HEADER,
  outcomeOf,
  planShell,
  PRECACHE_CONCURRENCY,
  readShellFiles,
  readStoredAt,
  routeRequest,
  SHELL_CACHE,
  SHELL_CACHE_KEY_PATH,
  stampResponse,
  type ResponseFacts,
} from "./appShell.logic";

export interface AppShellWorkerHost {
  readonly caches: CacheStorage;
  readonly fetch: (input: Request | string, init?: RequestInit) => Promise<Response>;
  readonly now: () => number;
  /** The worker's registration scope (`self.registration.scope`). */
  readonly scope: string;
}

/** Work that outlives the answer (`event.waitUntil`). */
export type KeepAlive = (work: Promise<unknown>) => void;

function factsOf(response: Response): ResponseFacts {
  return {
    status: response.status,
    type: response.type,
    redirected: response.redirected,
    url: response.url,
    contentType: response.headers.get("content-type"),
  };
}

function keptPlanInput(kept: Response | undefined) {
  if (kept === undefined) return undefined;
  return {
    storedAt: readStoredAt(kept.headers),
    listed: kept.headers.has(LISTED_FILES_HEADER),
  };
}

export function makeAppShellWorker(host: AppShellWorkerHost) {
  const origin = new URL(host.scope).origin;
  const shellKey = new URL(SHELL_CACHE_KEY_PATH, origin).href;
  const absolute = (path: string) => new URL(path, origin).href;

  /** Keeps one bundle file unless it is already kept; rejects when it cannot be kept. */
  const keepFile = async (assets: Cache, url: string) => {
    if ((await assets.match(url, { ignoreVary: true })) !== undefined) return;
    const response = await host.fetch(url, { credentials: "same-origin" });
    if (!isKeepable("asset", factsOf(response), origin)) {
      throw new Error(`${url} is not a bundle file the worker may keep`);
    }
    await assets.put(url, stampResponse(response, host.now()));
  };

  /** Whether every file is kept, fetching the missing ones a few at a time. */
  const keepFiles = async (assets: Cache, urls: readonly string[]) => {
    let next = 0;
    let complete = true;
    const lane = async () => {
      while (complete && next < urls.length) {
        const url = urls[next++]!;
        if ((await outcomeOf(keepFile(assets, url))) === "failed") complete = false;
      }
    };
    await Promise.all(Array.from({ length: PRECACHE_CONCURRENCY }, lane));
    return complete;
  };

  /**
   * Keeps `response` as the page once every file it lists is kept; rejects otherwise, leaving the
   * page kept before. A new page is a deploy: the asset cache then holds the new page's files and
   * the replaced page's, for tabs still running it.
   */
  const keepShell = async (shells: Cache, response: Response, previous: Response | undefined) => {
    if (!isKeepable("shell", factsOf(response), origin)) {
      throw new Error("The origin's answer is not a page the worker may keep");
    }
    const body = await response.text();
    const files = readShellFiles(body);
    if (files === undefined) throw new Error("The page lists no files to boot from");
    const assets = await host.caches.open(ASSET_CACHE);
    const urls = files.map(absolute);
    if (!(await keepFiles(assets, urls))) {
      throw new Error("A file the page boots from could not be kept");
    }
    const previousBody = await previous?.text();
    const headers = new Headers(response.headers);
    headers.set(LISTED_FILES_HEADER, String(files.length));
    await shells.put(
      shellKey,
      stampResponse(new Response(body, { status: response.status, headers }), host.now()),
    );
    if (previousBody === body) return;
    const keep = new Set([...urls, ...(readShellFiles(previousBody ?? "") ?? []).map(absolute)]);
    const cached = (await assets.keys()).map((key) => key.url);
    await Promise.all(assetsToEvict(cached, keep).map((url) => assets.delete(url)));
  };

  /**
   * Asks the origin for the page behind a kept one, for the next load. Offline, a failing origin
   * or a file that cannot be kept leaves the kept page, and the next load asks again. `no-store`
   * keeps it out of the HTTP cache: Chrome lets one request at a time write a URL's entry, so a
   * revalidation stuck on a slow origin would hold a network-first reload behind it (measured:
   * 5.1 s instead of 3 s on a 3 s origin). The page is ~30 KB.
   */
  const refreshShell = (shells: Cache, kept: Response | undefined) =>
    outcomeOf(
      host
        .fetch(shellKey, { cache: "no-store", credentials: "same-origin" })
        .then((response) => keepShell(shells, response, kept)),
    );

  const serveShell = async (request: Request, keepAlive: KeepAlive) => {
    const shells = await host.caches.open(SHELL_CACHE);
    const kept = await shells.match(shellKey);
    if (planShell(keptPlanInput(kept), host.now()) === "cached" && kept !== undefined) {
      keepAlive(refreshShell(shells, kept.clone()));
      return kept;
    }
    let response: Response;
    try {
      response = await host.fetch(request);
    } catch (error) {
      // Offline with a page too old (or forgotten) to answer at once: it beats no page.
      if (kept !== undefined) return kept;
      throw error;
    }
    if (!response.ok && kept !== undefined) return kept;
    keepAlive(outcomeOf(keepShell(shells, response.clone(), kept?.clone())));
    return response;
  };

  const serveAsset = async (request: Request, keepAlive: KeepAlive) => {
    const assets = await host.caches.open(ASSET_CACHE);
    const kept = await assets.match(request.url, { ignoreVary: true });
    if (kept !== undefined) return kept;
    const response = await host.fetch(request);
    if (isKeepable("asset", factsOf(response), origin)) {
      keepAlive(outcomeOf(assets.put(request.url, stampResponse(response.clone(), host.now()))));
    }
    return response;
  };

  return {
    /**
     * The answer for a request, or `undefined` to leave it to the network. A failure anywhere in
     * the worker's own path answers with the request sent as it came.
     */
    answer(request: Request, keepAlive: KeepAlive): Promise<Response> | undefined {
      const route = routeRequest({
        method: request.method,
        url: request.url,
        mode: request.mode,
        destination: request.destination,
        ranged: request.headers.has("range"),
        scope: host.scope,
      });
      if (route === "pass") return undefined;
      const served =
        route === "shell" ? serveShell(request, keepAlive) : serveAsset(request, keepAlive);
      return served.catch(() => host.fetch(request));
    },
    /**
     * On install: keep the origin's page with its files (from the HTTP cache after the first
     * visit's own load), so the next load already paints at once. A failure never fails the
     * install: the first navigation the worker answers asks the origin and keeps its page instead.
     */
    install() {
      return outcomeOf(
        host.caches.open(SHELL_CACHE).then(async (shells) => {
          const kept = await shells.match(shellKey);
          const fresh = planShell(keptPlanInput(kept), host.now()) === "cached";
          return fresh ? "done" : refreshShell(shells, kept);
        }),
      );
    },
    /**
     * On activation: drop caches no build knows. The asset cache is bounded when a page is kept,
     * not here: an update must not take files from tabs running the page kept before.
     */
    async activate() {
      const names = await host.caches.keys();
      await Promise.all(cachesToDelete(names).map((name) => host.caches.delete(name)));
    },
  };
}
