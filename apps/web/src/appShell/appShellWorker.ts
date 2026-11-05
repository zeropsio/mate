/**
 * The app-shell worker's behaviour over the Cache API and `fetch`, with every decision taken by
 * `appShell.logic.ts`. `sw.ts` binds it to the worker's events; tests bind it to fakes.
 *
 * It can never brick the app: any exception answers with the plain network request, and a request
 * it does not route is never answered at all (`respondWith` is not called).
 */

import {
  ASSET_CACHE,
  assetsToEvict,
  cachesToDelete,
  isKeepable,
  outcomeOf,
  planShell,
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

export function makeAppShellWorker(host: AppShellWorkerHost) {
  const origin = new URL(host.scope).origin;
  const shellKey = new URL(SHELL_CACHE_KEY_PATH, origin).href;

  const pruneAssets = async () => {
    const cache = await host.caches.open(ASSET_CACHE);
    const keys = await cache.keys();
    const entries = await Promise.all(
      keys.map(async (key) => ({
        url: key.url,
        storedAt: readStoredAt((await cache.match(key))?.headers ?? new Headers()),
      })),
    );
    await Promise.all(assetsToEvict(entries).map((url) => cache.delete(url)));
  };

  /** Keeps `response` as the page when it may be; a new page means a deploy: prune the assets. */
  const keepShell = async (cache: Cache, response: Response, previous: Response | undefined) => {
    if (!isKeepable("shell", factsOf(response), origin)) return;
    const body = await response.text();
    const changed = previous === undefined || (await previous.text()) !== body;
    await cache.put(
      shellKey,
      stampResponse(
        new Response(body, { status: response.status, headers: response.headers }),
        host.now(),
      ),
    );
    if (changed) await pruneAssets();
  };

  /**
   * Asks the origin for the page behind a kept one, for the next load. Offline or a failing
   * origin leaves the kept page, and the next load asks again. `no-store` keeps it out of the HTTP
   * cache: Chrome lets one request at a time write a URL's entry, so a revalidation stuck on a slow
   * origin would hold a network-first reload behind it (measured: 5.1 s instead of 3 s on a 3 s
   * origin). The page is ~28 KB.
   */
  const refreshShell = (cache: Cache, kept: Response | undefined) =>
    outcomeOf(
      host
        .fetch(shellKey, { cache: "no-store", credentials: "same-origin" })
        .then((response) => keepShell(cache, response, kept)),
    );

  const serveShell = async (request: Request, keepAlive: KeepAlive) => {
    const cache = await host.caches.open(SHELL_CACHE);
    const kept = await cache.match(shellKey);
    if (kept !== undefined && planShell(readStoredAt(kept.headers), host.now()) === "cached") {
      keepAlive(refreshShell(cache, kept.clone()));
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
    keepAlive(outcomeOf(keepShell(cache, response.clone(), kept?.clone())));
    return response;
  };

  const serveAsset = async (request: Request, keepAlive: KeepAlive) => {
    const cache = await host.caches.open(ASSET_CACHE);
    const kept = await cache.match(request.url, { ignoreVary: true });
    if (kept !== undefined) return kept;
    const response = await host.fetch(request);
    if (isKeepable("asset", factsOf(response), origin)) {
      keepAlive(outcomeOf(cache.put(request.url, stampResponse(response.clone(), host.now()))));
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
     * On install: keep the origin's page, so the load after the first visit already paints at
     * once (the first visit's own page came before the worker). A failure never fails the install:
     * the first navigation the worker answers asks the origin and keeps its page instead.
     */
    install() {
      return outcomeOf(
        host.caches.open(SHELL_CACHE).then(async (cache) => {
          const kept = await cache.match(shellKey);
          const fresh =
            kept !== undefined && planShell(readStoredAt(kept.headers), host.now()) === "cached";
          return fresh ? "done" : refreshShell(cache, kept);
        }),
      );
    },
    /** On activation: drop caches no build knows and bound the assets. */
    async activate() {
      const names = await host.caches.keys();
      await Promise.all(cachesToDelete(names).map((name) => host.caches.delete(name)));
      await pruneAssets();
    },
  };
}
