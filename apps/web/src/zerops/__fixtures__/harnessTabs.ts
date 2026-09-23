/**
 * The account harness's tabs as web renderers (DESIGN §11.1): each mounted
 * tab is its own window, its own document and its own module graph, so
 * module-level state such as the account lifetime is per tab, the way two
 * browser tabs keep it.
 *
 * The tabs share one JavaScript realm, so `window`, `document`, `history`
 * and `fetch` are the globals of one tab at a time. The fixture points them at a tab for
 * each piece of that tab's code it starts — mounting, `run`, delivering a
 * browser signal, a reload — and a signal or a reload gives them back to the
 * tab that had them when it is done, so the tab whose `run` caused it keeps
 * its own. Code that resumes on its own later (a promise continuation, an
 * effect React flushes after the fixture's turn) reads whichever tab holds
 * the globals then: a test that needs a tab's own globals there starts that
 * code with the tab's `run`. The client's `fetch` is bound when the session
 * provider builds it, so session calls always reach their own tab's network.
 *
 * A reload unmounts the page, drops what it held and mounts a fresh module
 * graph over the same storage.
 */
import type {
  AccountHarness,
  BrowserSignal,
  HarnessTab,
} from "@t3tools/client-runtime/zerops/testing";
import { act, createElement, Fragment, useEffect, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vite-plus/test";

import type { ZeropsSessionValue } from "../ZeropsSessionProvider";
import { TestNode } from "./testDom";

/** Real task boundaries, even when a test fakes the timers. */
const nextTask = () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

/** The origin every harness tab is served from. */
const ORIGIN = "https://mate.example.test";

/** A page that reloads itself this often in one test is in a loop. */
const RELOAD_LOOP = 10;

const mounted = new Set<MountedTab>();
const reloading = new Set<Promise<void>>();
/** Points the globals at the tab that holds them now; `null` before any tab opens. */
let active: (() => void) | null = null;

interface TabGraph {
  readonly ZeropsSessionProvider: typeof import("../ZeropsSessionProvider").ZeropsSessionProvider;
  readonly useZeropsSession: typeof import("../ZeropsSessionProvider").useZeropsSession;
  readonly currentAccountId: typeof import("../accountLifetime").currentAccountId;
}

async function loadTabGraph(): Promise<TabGraph> {
  vi.resetModules();
  const [session, lifetime] = await Promise.all([
    import("../ZeropsSessionProvider"),
    import("../accountLifetime"),
  ]);
  return {
    ZeropsSessionProvider: session.ZeropsSessionProvider,
    useZeropsSession: session.useZeropsSession,
    currentAccountId: lifetime.currentAccountId,
  };
}

export interface MountedTab {
  readonly tab: HarnessTab;
  /** The session value the tab's page last rendered. */
  readonly session: () => ZeropsSessionValue;
  /** The account lifetime this tab's page has open, or `null`. */
  readonly accountId: () => string | null;
  /** What a person reads on the tab's page. */
  readonly text: () => string;
  /** The page's root node, to find a control on it. */
  readonly container: () => TestNode;
  /** Where the tab's page is. */
  readonly location: () => {
    readonly pathname: string;
    readonly search: string;
    readonly hash: string;
  };
  /**
   * Every navigation the tab's code asked the browser for, in order. The
   * fixture records them and leaves the tab where it is.
   */
  readonly navigations: () => ReadonlyArray<TabNavigation>;
  /** Runs page code (a session call, a click) in this tab, inside React's act. */
  readonly run: <T>(work: () => T | Promise<T>) => Promise<T>;
  readonly unmount: () => Promise<void>;
}

export interface TabNavigation {
  readonly via: "assign" | "replace" | "href" | "pushState" | "replaceState";
  readonly url: string;
}

/**
 * What the tab's page is. Either is built on every open, after the tab's
 * module graph is reset, so it imports what it renders itself.
 */
export type MountTabOptions = {
  /** The path the page opens at. */
  readonly path?: string;
} & (
  | {
      /** The page below the fixture's session provider, over the tab's storage. */
      readonly page?: () => Promise<ReactNode>;
      readonly app?: never;
    }
  | {
      /**
       * The whole page, bringing its own session provider (`AppRoot`, say).
       * It places `Probe` inside that provider wherever the session should be
       * read; `session()` is what a probe last rendered.
       */
      readonly app: (Probe: ComponentType) => Promise<ReactNode>;
      readonly page?: never;
    }
);

/**
 * A URL path as `location` splits it. Split by hand rather than by `URL`,
 * which would read `//host/path` as another origin where a browser keeps it
 * as this origin's pathname.
 */
function splitPath(path: string) {
  const [beforeHash, ...afterHash] = path.split("#");
  const [pathname, ...afterQuery] = beforeHash!.split("?");
  return {
    pathname: pathname!,
    search: afterQuery.length === 0 ? "" : `?${afterQuery.join("?")}`,
    hash: afterHash.length === 0 ? "" : `#${afterHash.join("#")}`,
  };
}

function tabWindow(
  tab: HarnessTab,
  path: string,
  reload: () => void,
  navigations: TabNavigation[],
) {
  const document = new TestNode("#document", null, 9);
  Object.defineProperty(document, "visibilityState", {
    get: () => tab.signals.state().visibilityState,
  });
  const at = splitPath(path);
  const navigate = (via: TabNavigation["via"]) => (url: string | URL | null | undefined) => {
    navigations.push({ via, url: String(url) });
  };
  const location = {
    ...at,
    origin: ORIGIN,
    get href() {
      return `${ORIGIN}${at.pathname}${at.search}${at.hash}`;
    },
    set href(url: string) {
      navigate("href")(url);
    },
    assign: navigate("assign"),
    replace: navigate("replace"),
    reload,
  };
  const history = {
    scrollRestoration: "auto",
    pushState: (_state: unknown, _unused: string, url?: string | URL | null) =>
      navigate("pushState")(url),
    replaceState: (_state: unknown, _unused: string, url?: string | URL | null) =>
      navigate("replaceState")(url),
  };
  const window = Object.assign(new EventTarget(), {
    document,
    location,
    history,
    localStorage: tab.localStorage,
    sessionStorage: tab.sessionStorage,
    navigator: { locks: tab.locks },
    BroadcastChannel: tab.BroadcastChannel,
    HTMLIFrameElement: TestNode,
    scrollX: 0,
    scrollY: 0,
    scrollTo: () => undefined,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
  return window;
}

/**
 * Opens `tab`'s page over the harness platform: a `ZeropsSessionProvider` over
 * the tab's storage with `page` below it, or `app` as the whole page.
 */
export async function mountTab(
  harness: AccountHarness,
  tab: HarnessTab,
  options: MountTabOptions = {},
): Promise<MountedTab> {
  let root: Root | null = null;
  let graph: TabGraph | null = null;
  let session: ZeropsSessionValue | null = null;
  let container: TestNode | null = null;
  const navigations: TabNavigation[] = [];
  const window = tabWindow(
    tab,
    options.path ?? "/zerops",
    () => {
      if (tab.reloads >= RELOAD_LOOP) throw new Error(`${tab.id} reloads in a loop.`);
      const reload = reloadPage().finally(() => reloading.delete(reload));
      reloading.add(reload);
    },
    navigations,
  );

  const activate = () => {
    vi.stubGlobal("window", window);
    vi.stubGlobal("self", window);
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("history", window.history);
    vi.stubGlobal("addEventListener", window.addEventListener.bind(window));
    vi.stubGlobal("removeEventListener", window.removeEventListener.bind(window));
    vi.stubGlobal("scrollX", window.scrollX);
    vi.stubGlobal("scrollY", window.scrollY);
    vi.stubGlobal("scrollTo", window.scrollTo);
    vi.stubGlobal("fetch", harness.rest.fetchFor(tab));
    vi.stubGlobal("HTMLIFrameElement", TestNode);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    active = activate;
  };

  /** Runs the tab's `work` on its globals, then gives them back to the tab that had them. */
  async function visit(work: () => void | Promise<void>) {
    const previous = active;
    activate();
    try {
      await work();
    } finally {
      previous?.();
    }
  }

  const deliver = (signal: BrowserSignal) => {
    const previous = active;
    activate();
    const { type, ...detail } = signal;
    const event = Object.assign(new Event(type), detail);
    if (type === "visibilitychange" || type === "freeze" || type === "resume")
      window.document.dispatchEvent(event);
    else window.dispatchEvent(event);
    previous?.();
  };

  async function openPage() {
    activate();
    graph = await loadTabGraph();
    const { ZeropsSessionProvider, useZeropsSession } = graph;
    function Probe() {
      const value = useZeropsSession();
      useEffect(() => {
        session = value;
      }, [value]);
      return null;
    }
    const content =
      options.app === undefined
        ? createElement(ZeropsSessionProvider, {
            storage: tab.zeropsStorage,
            children: createElement(
              Fragment,
              null,
              createElement(Probe),
              options.page === undefined ? null : await options.page(),
            ),
          })
        : await options.app(Probe);
    tab.signals.subscribe(deliver);
    activate();
    container = new TestNode("div", window.document);
    root = createRoot(container as never);
    await act(async () => {
      root!.render(content);
    });
  }

  async function closePage() {
    const closing = root;
    root = null;
    session = null;
    if (closing !== null) await act(async () => closing.unmount());
  }

  async function reloadPage() {
    await nextTask();
    await visit(async () => {
      await closePage();
      tab.reload();
      await openPage();
    });
  }

  await openPage();
  await settle();

  const page: MountedTab = {
    tab,
    session: () => {
      if (session === null) throw new Error(`${tab.id} has no page.`);
      return session;
    },
    accountId: () => graph?.currentAccountId() ?? null,
    text: () => page.container().textContent,
    container: () => {
      if (container === null) throw new Error(`${tab.id} has no page.`);
      return container;
    },
    location: () => window.location,
    navigations: () => [...navigations],
    run: async (work) => {
      activate();
      let result!: Awaited<ReturnType<typeof work>>;
      await act(async () => {
        result = await work();
      });
      await settle();
      return result;
    },
    unmount: async () => {
      mounted.delete(page);
      await visit(closePage);
    },
  };
  mounted.add(page);
  return page;
}

/** Closes every mounted tab's page; for `afterEach`. */
export async function unmountTabs(): Promise<void> {
  await Promise.all(reloading);
  for (const page of mounted) await page.unmount();
  active = null;
}

/**
 * Lets every tab's pending work run: fetches answer, storage events arrive,
 * reloads remount. A fixed number of task turns, each inside React's act.
 */
export async function settle(turns = 20): Promise<void> {
  do {
    for (let turn = 0; turn < turns; turn++)
      await act(async () => {
        await nextTask();
      });
    await Promise.all(reloading);
  } while (reloading.size > 0);
}
