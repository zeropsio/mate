import { describe, expect, it } from "vite-plus/test";

import { ASSET_CACHE, SHELL_CACHE, SHELL_MAX_AGE_MS } from "./appShell.logic";
import { forgetCachedShell } from "./appShellClient";
import { makeAppShellWorker } from "./appShellWorker";

const ORIGIN = "https://mate.example.test";

interface StoredEntry {
  readonly body: string;
  readonly status: number;
  readonly headers: [string, string][];
}

/** The Cache API in memory: each match hands out a fresh response, as the real one does. */
function memoryCaches() {
  const stores = new Map<string, Map<string, StoredEntry>>();
  const revive = (entry: StoredEntry) =>
    new Response(entry.body, { status: entry.status, headers: entry.headers });
  const cacheOf = (store: Map<string, StoredEntry>) =>
    ({
      match: async (key: RequestInfo | URL) => {
        const entry = store.get(
          typeof key === "string" ? key : String((key as Request).url ?? key),
        );
        return entry === undefined ? undefined : revive(entry);
      },
      put: async (key: RequestInfo | URL, response: Response) => {
        store.set(String(key), {
          body: await response.text(),
          status: response.status,
          headers: [...response.headers.entries()],
        });
      },
      delete: async (key: RequestInfo | URL) => store.delete(String(key)),
      keys: async () => [...store.keys()].map((url) => new Request(url)),
    }) as unknown as Cache;
  const storage = {
    open: async (name: string) => {
      let store = stores.get(name);
      if (store === undefined) stores.set(name, (store = new Map()));
      return cacheOf(store);
    },
    has: async (name: string) => stores.has(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  } as unknown as CacheStorage;
  return { storage, stores };
}

/** What the origin answers, as a browser reports it (`basic`, its URL), clones included. */
function asServed(response: Response, url: string): Response {
  const clone = response.clone.bind(response);
  return Object.defineProperties(response, {
    type: { value: "basic" },
    url: { value: url },
    clone: { value: () => asServed(clone(), url) },
  });
}

function served(body: string, url: string, contentType: string, status = 200) {
  return asServed(new Response(body, { status, headers: { "content-type": contentType } }), url);
}

function request(path: string, kind: "navigation" | "script" = "navigation") {
  const value = new Request(`${ORIGIN}${path}`);
  Object.defineProperties(value, {
    mode: { value: kind === "navigation" ? "navigate" : "cors" },
    destination: { value: kind === "navigation" ? "document" : "script" },
  });
  return value;
}

/** A browser with the worker installed, an origin it can redeploy, take down or stall. */
function browser() {
  const { storage, stores } = memoryCaches();
  let now = 1_000_000_000;
  const origin = {
    page: "<html>build 1</html>",
    assets: new Map<string, string>([["/assets/entry-1.js", "build 1"]]),
    state: "up" as "up" | "offline" | "stalled",
    requests: [] as string[],
  };
  const fetch = async (input: Request | string) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    origin.requests.push(url.pathname);
    if (origin.state === "offline") throw new TypeError("Failed to fetch");
    if (origin.state === "stalled") return new Promise<Response>(() => {});
    if (url.origin !== ORIGIN) return served("elsewhere", url.href, "text/plain");
    const asset = origin.assets.get(url.pathname);
    if (asset !== undefined) return served(asset, url.href, "text/javascript");
    // The host's SPA fallback: any other path is the page.
    return served(origin.page, url.href, "text/html");
  };
  const pending: Promise<unknown>[] = [];
  const worker = makeAppShellWorker({
    caches: storage,
    fetch,
    now: () => now,
    scope: `${ORIGIN}/`,
  });
  const load = async (path: string, kind: "navigation" | "script" = "navigation") => {
    const answer = worker.answer(request(path, kind), (work) => void pending.push(work));
    if (answer === undefined) return undefined;
    return (await answer).text();
  };
  /** Lets work the worker kept alive (refreshes, stores) finish. */
  const settle = async () => {
    while (pending.length > 0) await pending.shift();
  };
  return {
    origin,
    worker,
    storage,
    stores,
    load,
    settle,
    later: (ms: number) => {
      now += ms;
    },
    deploy: (build: number) => {
      origin.page = `<html>build ${build}</html>`;
      origin.assets = new Map([[`/assets/entry-${build}.js`, `build ${build}`]]);
    },
  };
}

describe("a reload of the hosted client", () => {
  it("asks the origin on the first load and keeps its page for the next one", async () => {
    const tab = browser();
    expect(await tab.load("/")).toBe("<html>build 1</html>");
    await tab.settle();
    tab.origin.requests.length = 0;
    tab.origin.state = "offline";
    expect(await tab.load("/env-1/thread-1")).toBe("<html>build 1</html>");
  });

  it("keeps the page as the worker installs, so the load after the first visit paints at once", async () => {
    const tab = browser();
    await tab.worker.install();
    tab.origin.state = "offline";
    expect(await tab.load("/")).toBe("<html>build 1</html>");
  });

  it("paints the kept page at once while the origin stalls", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.settle();
    tab.origin.state = "stalled";
    const waited = new Promise((resolve) => setTimeout(() => resolve("still waiting"), 1000));
    expect(await Promise.race([tab.load("/"), waited])).toBe("<html>build 1</html>");
  });

  it("runs a deploy's page on the load after the one that found it", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.load("/assets/entry-1.js", "script");
    await tab.settle();
    tab.deploy(2);
    expect(await tab.load("/")).toBe("<html>build 1</html>");
    expect(await tab.load("/assets/entry-1.js", "script")).toBe("build 1");
    await tab.settle();
    expect(await tab.load("/")).toBe("<html>build 2</html>");
  });

  it("asks the origin first for a page kept longer than its bound, and paints it offline", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.settle();
    tab.deploy(2);
    tab.later(SHELL_MAX_AGE_MS);
    expect(await tab.load("/")).toBe("<html>build 2</html>");
    await tab.settle();
    tab.later(SHELL_MAX_AGE_MS);
    tab.origin.state = "offline";
    expect(await tab.load("/")).toBe("<html>build 2</html>");
  });

  it("gets the origin's page after a stale chunk made the page forget the kept one", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.settle();
    tab.deploy(2);
    await forgetCachedShell(tab.storage, ORIGIN);
    expect(await tab.load("/")).toBe("<html>build 2</html>");
  });

  it("never keeps a missing bundle file the host answered with the page", async () => {
    const tab = browser();
    expect(await tab.load("/assets/gone-1.js", "script")).toBe("<html>build 1</html>");
    await tab.settle();
    expect(tab.stores.get(ASSET_CACHE)?.size ?? 0).toBe(0);
  });

  it("leaves requests to other origins and to backend paths to the network", async () => {
    const tab = browser();
    expect(tab.worker.answer(request("/api/auth/session", "script"), () => {})).toBeUndefined();
    expect(tab.worker.answer(request("/manifest.webmanifest"), () => {})).toBeUndefined();
    const elsewhere = new Request("https://hq.example.test/api/mates");
    expect(tab.worker.answer(elsewhere, () => {})).toBeUndefined();
  });

  it("answers with the plain network request when its own cache fails", async () => {
    const tab = browser();
    const broken = makeAppShellWorker({
      caches: {
        open: () => Promise.reject(new Error("QuotaExceededError")),
      } as unknown as CacheStorage,
      fetch: async (input) =>
        served("from the network", typeof input === "string" ? input : input.url, "text/html"),
      now: () => 0,
      scope: `${ORIGIN}/`,
    });
    expect(await (await broken.answer(request("/"), () => {}))?.text()).toBe("from the network");
    expect(await tab.load("/")).toBe("<html>build 1</html>");
  });

  it("drops the caches no build knows when it activates", async () => {
    const tab = browser();
    await tab.storage.open("mate-app-shell-v0");
    await tab.storage.open(SHELL_CACHE);
    await tab.worker.activate();
    expect(await tab.storage.keys()).toEqual([SHELL_CACHE, ASSET_CACHE]);
  });
});
