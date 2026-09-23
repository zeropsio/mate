/**
 * The account harness's tabs as web renderers (DESIGN §11.1): each mounted
 * tab is its own window, its own document and its own module graph, so
 * module-level state such as the account lifetime is per tab, the way two
 * browser tabs keep it.
 *
 * A tab's code runs with the globals of that tab: the fixture points
 * `window`, `document` and `fetch` at the tab before mounting it and before
 * delivering a browser signal to it. A reload unmounts the page, drops what
 * it held and mounts a fresh module graph over the same storage.
 */
import type {
  AccountHarness,
  BrowserSignal,
  HarnessTab,
} from "@t3tools/client-runtime/zerops/testing";
import { act, createElement, Fragment, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vite-plus/test";

import type { ZeropsSessionValue } from "../ZeropsSessionProvider";
import { TestNode } from "./testDom";

/** Real task boundaries, even when a test fakes the timers. */
const nextTask = () => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

/** A page that reloads itself this often in one test is in a loop. */
const RELOAD_LOOP = 10;

const mounted = new Set<MountedTab>();
const reloading = new Set<Promise<void>>();

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
  /** Runs page code (a session call, a click) in this tab, inside React's act. */
  readonly run: <T>(work: () => T | Promise<T>) => Promise<T>;
  readonly unmount: () => Promise<void>;
}

export interface MountTabOptions {
  /** The path the page opens at. */
  readonly path?: string;
  /**
   * The page below the session provider. It is built on every open, after
   * the tab's module graph is reset, so it imports what it renders itself.
   */
  readonly page?: () => Promise<ReactNode>;
}

function tabWindow(tab: HarnessTab, path: string, reload: () => void) {
  const document = new TestNode("#document", null, 9);
  Object.defineProperty(document, "visibilityState", {
    get: () => tab.signals.state().visibilityState,
  });
  const window = Object.assign(new EventTarget(), {
    document,
    location: { pathname: path, search: "", hash: "", reload },
    localStorage: tab.localStorage,
    sessionStorage: tab.sessionStorage,
    navigator: { locks: tab.locks },
    BroadcastChannel: tab.BroadcastChannel,
    HTMLIFrameElement: TestNode,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
  return window;
}

/**
 * Opens `tab`'s page: a `ZeropsSessionProvider` over the tab's storage and the
 * harness platform, with `page` below it.
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
  const window = tabWindow(tab, options.path ?? "/zerops", () => {
    if (tab.reloads >= RELOAD_LOOP) throw new Error(`${tab.id} reloads in a loop.`);
    const reload = reloadPage().finally(() => reloading.delete(reload));
    reloading.add(reload);
  });

  const activate = () => {
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("fetch", harness.rest.fetchFor(tab));
    vi.stubGlobal("HTMLIFrameElement", TestNode);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  };

  const deliver = (signal: BrowserSignal) => {
    activate();
    const { type, ...detail } = signal;
    const event = Object.assign(new Event(type), detail);
    if (type === "visibilitychange" || type === "freeze" || type === "resume")
      window.document.dispatchEvent(event);
    else window.dispatchEvent(event);
  };

  async function openPage() {
    activate();
    graph = await loadTabGraph();
    const below = options.page === undefined ? null : await options.page();
    const { ZeropsSessionProvider, useZeropsSession } = graph;
    function Probe() {
      const value = useZeropsSession();
      useEffect(() => {
        session = value;
      }, [value]);
      return null;
    }
    tab.signals.subscribe(deliver);
    activate();
    container = new TestNode("div", window.document);
    root = createRoot(container as never);
    await act(async () => {
      root!.render(
        createElement(ZeropsSessionProvider, {
          storage: tab.zeropsStorage,
          children: createElement(Fragment, null, createElement(Probe), below),
        }),
      );
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
    await closePage();
    tab.reload();
    await openPage();
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
      await closePage();
    },
  };
  mounted.add(page);
  return page;
}

/** Closes every mounted tab's page; for `afterEach`. */
export async function unmountTabs(): Promise<void> {
  await Promise.all(reloading);
  for (const page of mounted) await page.unmount();
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
