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
  outcomeOf,
  PRECACHE_CONCURRENCY,
  readShellFiles,
  routeRequest,
  SHELL_CACHE,
  SHELL_CACHE_KEY_PATH,
  staticRoutes,
  storable,
  storedHeaders,
  type ResponseFacts,
  type StepOutcome,
} from "./appShell.logic";

export interface AppShellWorkerHost {
  readonly caches: CacheStorage;
  readonly fetch: (input: Request | string, init?: RequestInit) => Promise<Response>;
  /** The worker's registration scope (`self.registration.scope`). */
  readonly scope: string;
  /**
   * Settles once a page that just began loading has had the network to itself
   * (`PRECACHE_CALM_MS`): the files kept for it are fetched after, never beside its boot. Absent:
   * they are fetched at once.
   */
  readonly calm?: () => Promise<void>;
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
  const absolute = (path: string) => new URL(path, origin).href;

  /** How keeping one bundle file ended: `no-room` when the cache refused to store it. */
  type FileOutcome = "kept" | "unavailable" | "no-room";

  /** Keeps one bundle file unless it is already kept. */
  const keepFile = async (assets: Cache, url: string): Promise<FileOutcome> => {
    if ((await assets.match(url, { ignoreVary: true })) !== undefined) return "kept";
    let fetched: Response;
    try {
      fetched = await host.fetch(url, { credentials: "same-origin" });
    } catch {
      return "unavailable";
    }
    if (!isKeepable("asset", factsOf(fetched), origin)) return "unavailable";
    const stored = await outcomeOf(assets.put(url, storable(fetched)));
    return stored === "done" ? "kept" : "no-room";
  };

  /** Whether every file is kept, fetching the missing ones a few at a time. */
  const keepFiles = async (assets: Cache, urls: readonly string[]): Promise<FileOutcome> => {
    let next = 0;
    let outcome: FileOutcome = "kept";
    const lane = async () => {
      while (outcome === "kept" && next < urls.length) {
        const kept = await keepFile(assets, urls[next++]!);
        if (kept !== "kept") outcome = kept;
      }
    };
    await Promise.all(Array.from({ length: PRECACHE_CONCURRENCY }, lane));
    return outcome;
  };

  /** Drops every asset entry outside `keep`. */
  const evictAllBut = async (assets: Cache, keep: ReadonlySet<string>) => {
    const cached = (await assets.keys()).map((key) => key.url);
    await Promise.all(assetsToEvict(cached, keep).map((url) => assets.delete(url)));
  };

  /** The files a page lists, as the absolute URLs the asset cache is keyed by. */
  const listedUrls = (body: string | undefined) => (readShellFiles(body ?? "") ?? []).map(absolute);

  /**
   * Keeps a page once every file it lists is kept; rejects otherwise, leaving the page kept
   * before. A new page is a deploy: the asset cache then holds the new page's files and those of
   * the page it replaced (read right before, for tabs still running it), and nothing else. A cache
   * out of room drops everything neither page lists and tries once more.
   */
  const keepPage = async (shells: Cache, body: string, headers: Headers) => {
    const assets = await host.caches.open(ASSET_CACHE);
    const urls = listedUrls(body);
    const keptBefore = async () => (await shells.match(shellKey))?.text();
    let outcome = await keepFiles(assets, urls);
    if (outcome === "no-room") {
      await evictAllBut(assets, new Set([...urls, ...listedUrls(await keptBefore())]));
      outcome = await keepFiles(assets, urls);
    }
    if (outcome !== "kept") throw new Error(`A file the page boots from was ${outcome}`);
    const replaced = await keptBefore();
    await shells.put(shellKey, new Response(body, { status: 200, headers }));
    if (replaced === body) return;
    await evictAllBut(assets, new Set([...urls, ...listedUrls(replaced)]));
  };

  /**
   * Keeps run one at a time, so two pages kept across a deploy never drop each other's files, and
   * one page is kept once however many navigations ask for it at the same time.
   */
  let keeping: Promise<unknown> = Promise.resolve();
  const inFlight = new Map<string, Promise<void>>();

  /** Keeps `response` as the page (`keepPage`) when it is one the worker may keep. */
  const keepShell = async (shells: Cache, response: Response) => {
    if (!isKeepable("shell", factsOf(response), origin)) {
      throw new Error("The origin's answer is not a page the worker may keep");
    }
    const body = await response.text();
    const files = readShellFiles(body);
    if (files === undefined) throw new Error("The page lists no files to boot from");
    const running = inFlight.get(body);
    if (running !== undefined) return running;
    const headers = storedHeaders(response);
    const run = keeping.then(() => host.calm?.()).then(() => keepPage(shells, body, headers));
    keeping = outcomeOf(run);
    inFlight.set(body, run);
    void outcomeOf(run).then(() => inFlight.delete(body));
    return run;
  };

  /**
   * Asks the origin for its page and keeps it as the worker installs. Offline, a failing origin
   * or a file that cannot be kept leaves the kept page, and the next load keeps one. `no-store`
   * keeps it out of the HTTP cache: Chrome lets one request at a time write a URL's entry, so a
   * fetch stuck on a slow origin would hold the next load's request behind it (measured: 5.1 s
   * instead of 3 s on a 3 s origin). The page is ~30 KB.
   */
  const refreshShell = (shells: Cache) =>
    outcomeOf(
      host
        .fetch(shellKey, { cache: "no-store", credentials: "same-origin" })
        .then((response) => keepShell(shells, response)),
    );

  /**
   * The origin's page whenever it answers, so a load after a deploy runs the deploy; the kept page
   * only when it cannot (offline, an error status). The answered page is kept behind it.
   */
  const serveShell = async (request: Request, keepAlive: KeepAlive) => {
    const shells = await host.caches.open(SHELL_CACHE);
    let response: Response;
    try {
      response = await host.fetch(request);
    } catch (error) {
      const kept = await shells.match(shellKey);
      if (kept !== undefined) return kept;
      throw error;
    }
    if (!response.ok) {
      const kept = await shells.match(shellKey);
      if (kept !== undefined) return kept;
    }
    keepAlive(outcomeOf(keepShell(shells, response.clone())));
    return response;
  };

  const serveAsset = async (request: Request, keepAlive: KeepAlive) => {
    const assets = await host.caches.open(ASSET_CACHE);
    const kept = await assets.match(request.url, { ignoreVary: true });
    if (kept !== undefined) return kept;
    const response = await host.fetch(request);
    if (isKeepable("asset", factsOf(response), origin)) {
      keepAlive(outcomeOf(assets.put(request.url, storable(response.clone()))));
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
     * visit's own load), so the next load already has one offline. A failure never fails the
     * install: the first navigation the worker answers keeps its page instead.
     */
    install() {
      return outcomeOf(host.caches.open(SHELL_CACHE).then(refreshShell));
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

/** The install event's Static Routing API, where the browser has it (Chrome 123+). */
export interface StaticRoutingHost {
  readonly addRoutes?: ((rules: readonly unknown[]) => Promise<void>) | undefined;
  readonly URLPattern?: (new (init: Readonly<Record<string, string>>) => unknown) | undefined;
}

/**
 * Registers `staticRoutes` with the browser, each URL pattern built as a `URLPattern`. Never
 * rejects, whatever the browser throws: the install's own work never waits on it to fail.
 */
export function installStaticRoutes(host: StaticRoutingHost, scope: string): Promise<StepOutcome> {
  return outcomeOf(
    (async () => {
      const { addRoutes, URLPattern: Pattern } = host;
      if (addRoutes === undefined || Pattern === undefined) return;
      const rules = staticRoutes(scope).map((route) =>
        "urlPattern" in route.condition
          ? { ...route, condition: { urlPattern: new Pattern(route.condition.urlPattern) } }
          : route,
      );
      await addRoutes(rules);
    })(),
  );
}
