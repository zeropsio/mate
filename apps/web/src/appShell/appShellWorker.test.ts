import { describe, expect, it } from "vite-plus/test";

import {
  ASSET_CACHE,
  embedShellFiles,
  SHELL_CACHE,
  SHELL_MAX_AGE_MS,
  STORED_AT_HEADER,
} from "./appShell.logic";
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

/** What build `n` lists: its entry, a route the warmer loads, and a chunk every build shares. */
const filesOf = (build: number) => [
  `/assets/entry-${build}.js`,
  `/assets/route-${build}.js`,
  "/assets/shared.js",
];
const pageOf = (build: number) =>
  embedShellFiles(`<html><head></head><body>build ${build}</body></html>`, filesOf(build));
/** Which build a page is, or what a bundle file is, as the browser got it. */
const buildOf = (text: string | undefined) => /build \d+(?: \w+)?/u.exec(text ?? "")?.[0] ?? text;

/** A browser with the worker installed, an origin it can redeploy, take down or stall. */
function browser() {
  const { storage, stores } = memoryCaches();
  let now = 1_000_000_000;
  const origin = {
    page: pageOf(1),
    assets: new Map<string, string>(),
    state: "up" as "up" | "offline" | "stalled",
  };
  /** A deploy replaces the whole bundle; `missing` files never reached the origin. */
  const deploy = (build: number, missing: readonly string[] = []) => {
    origin.page = pageOf(build);
    origin.assets = new Map(
      filesOf(build)
        .filter((file) => !missing.includes(file))
        .map((file) => [
          file,
          file === "/assets/shared.js"
            ? "shared"
            : `build ${build} ${file.slice(8, -5).split("-")[0]}`,
        ]),
    );
  };
  deploy(1);
  const fetch = async (input: Request | string) => {
    const url = new URL(typeof input === "string" ? input : input.url);
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
  const answer = async (path: string, kind: "navigation" | "script") => {
    const answered = worker.answer(request(path, kind), (work) => void pending.push(work));
    return answered === undefined ? undefined : (await answered).text();
  };
  /** A load: the page, then every file it lists (its boot and the warmer), as the page asks. */
  const load = async (path = "/") => {
    const page = await answer(path, "navigation");
    const files = /id="app-shell-files">([^<]*)</u.exec(page ?? "")?.[1];
    const booted = await Promise.all(
      (JSON.parse(files ?? "[]") as string[]).map(async (file) =>
        buildOf(await answer(file, "script")),
      ),
    );
    return { page: buildOf(page), booted };
  };
  /** Lets work the worker kept alive (refreshes, stores) finish. */
  const settle = async () => {
    while (pending.length > 0) await pending.shift();
  };
  const cachedAssets = async () =>
    [...(stores.get(ASSET_CACHE)?.keys() ?? [])].map((url) => new URL(url).pathname).toSorted();
  return {
    origin,
    worker,
    storage,
    stores,
    answer,
    load,
    settle,
    deploy,
    cachedAssets,
    later: (ms: number) => {
      now += ms;
    },
  };
}

const boots = (build: number) => ({
  page: `build ${build}`,
  booted: [`build ${build} entry`, `build ${build} route`, "shared"],
});

describe("a reload of the hosted client", () => {
  it("asks the origin on the first load and keeps its page for the next one", async () => {
    const tab = browser();
    expect(await tab.load("/")).toEqual(boots(1));
    await tab.settle();
    tab.origin.state = "offline";
    expect(await tab.load("/env-1/thread-1")).toEqual(boots(1));
  });

  it("keeps the page with its files as the worker installs, so the next load paints at once", async () => {
    const tab = browser();
    await tab.worker.install();
    tab.origin.state = "offline";
    expect(await tab.load("/")).toEqual(boots(1));
  });

  it("paints the kept page at once while the origin stalls", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.settle();
    tab.origin.state = "stalled";
    const waited = new Promise((resolve) => setTimeout(() => resolve("still waiting"), 1000));
    expect(await Promise.race([tab.answer("/", "navigation").then(buildOf), waited])).toBe(
      "build 1",
    );
  });

  it("runs a deploy's page on the load after the one that found it", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.settle();
    tab.deploy(2);
    expect(await tab.load("/")).toEqual(boots(1));
    await tab.settle();
    expect(await tab.load("/")).toEqual(boots(2));
  });

  it("keeps a page only once every file it boots from is kept: after two deploys the next load still boots", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.settle();
    tab.deploy(2);
    // Build 1 runs; behind it the worker keeps page 2, which this browser never ran.
    await tab.answer("/", "navigation");
    await tab.settle();
    tab.deploy(3);
    expect(await tab.load("/")).toEqual(boots(2));
  });

  it("keeps the page before when a file the new page boots from cannot be kept", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.settle();
    tab.deploy(2, ["/assets/route-2.js"]);
    await tab.load("/");
    await tab.settle();
    expect(await tab.load("/")).toEqual(boots(1));
  });

  it("loads every surface the warmer asks for from a kept page after the deploy that removed them, so it never reloads itself", async () => {
    const tab = browser();
    await tab.worker.install();
    tab.deploy(2);
    const opened = await tab.load("/");
    expect(opened.booted).not.toContain("build 2 route");
    expect(opened).toEqual(boots(1));
  });

  it("keeps the files of the kept build and of the one before it, and drops older builds'", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.settle();
    for (const build of [2, 3]) {
      tab.deploy(build);
      await tab.load("/");
      await tab.settle();
    }
    expect(await tab.cachedAssets()).toEqual([
      "/assets/entry-2.js",
      "/assets/entry-3.js",
      "/assets/route-2.js",
      "/assets/route-3.js",
      "/assets/shared.js",
    ]);
  });

  it("asks the origin first for a page an earlier worker kept without its files", async () => {
    const tab = browser();
    const shells = await tab.storage.open(SHELL_CACHE);
    await shells.put(
      `${ORIGIN}/`,
      new Response("<html><body>build 0</body></html>", {
        headers: { "content-type": "text/html", [STORED_AT_HEADER]: String(1_000_000_000) },
      }),
    );
    expect((await tab.load("/")).page).toBe("build 1");
  });

  it("asks the origin first for a page kept longer than its bound, and paints it offline", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.settle();
    tab.deploy(2);
    tab.later(SHELL_MAX_AGE_MS);
    expect(await tab.load("/")).toEqual(boots(2));
    await tab.settle();
    tab.later(SHELL_MAX_AGE_MS);
    tab.origin.state = "offline";
    expect(await tab.load("/")).toEqual(boots(2));
  });

  it("gets the origin's page after a stale chunk made the page forget the kept one", async () => {
    const tab = browser();
    await tab.load("/");
    await tab.settle();
    tab.deploy(2);
    await forgetCachedShell(tab.storage, ORIGIN);
    expect(await tab.load("/")).toEqual(boots(2));
  });

  it("never keeps a missing bundle file the host answered with the page", async () => {
    const tab = browser();
    expect(buildOf(await tab.answer("/assets/gone-1.js", "script"))).toBe("build 1");
    await tab.settle();
    expect(await tab.cachedAssets()).toEqual([]);
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
    expect((await tab.load("/")).page).toBe("build 1");
  });

  it("drops the caches no build knows when it activates", async () => {
    const tab = browser();
    await tab.storage.open("mate-app-shell-v0");
    await tab.storage.open(SHELL_CACHE);
    await tab.worker.activate();
    expect(await tab.storage.keys()).toEqual([SHELL_CACHE]);
  });
});
