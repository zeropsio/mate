import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  GITEA_OVERVIEW_REFRESH_MS,
  useZeropsGiteaOverview,
  type ZeropsGiteaOverviewState,
} from "./useZeropsGiteaOverview";

/**
 * Whether this tab can read Gitea now, whether the next reads meet a 401 that no token recovered —
 * the reacquire failed, or outlasted the request's wait — what Gitea answers the pull request
 * search instead of a list, and how many times the repositories were listed.
 */
const gitea = vi.hoisted(() => ({
  readable: true,
  unauthorizedOnRead: false,
  searchFails: null as string | null,
  listings: 0,
}));

vi.mock("./accountGiteaSessions", () => ({
  useGiteaReadable: () => gitea.readable,
  giteaClientFor: (_origin: string, onUnauthorized?: () => void) => {
    if (!gitea.readable) return null;
    const read = async <T>(answer: T): Promise<T> => {
      if (gitea.unauthorizedOnRead) {
        onUnauthorized?.();
        throw new Error("You are not signed in to Gitea.");
      }
      return answer;
    };
    return {
      listUserRepositories: () => {
        gitea.listings += 1;
        return read([
          { full_name: "harbor/app", html_url: "https://gitea.example.test/harbor/app" },
        ]);
      },
      searchPullRequests: () =>
        gitea.searchFails === null
          ? read([
              { number: 7, title: "Stage follows main", repository: { full_name: "harbor/app" } },
            ])
          : Promise.reject(new Error(gitea.searchFails)),
    };
  },
}));

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  readonly nodeName: string;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};

  constructor(
    name: string,
    readonly ownerDocument: TestNode | null = null,
    readonly nodeType = 1,
  ) {
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
  }

  set textContent(_value: string) {
    this.childNodes = [];
  }

  appendChild(child: TestNode) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }

  createElement(name: string) {
    return new TestNode(name, this);
  }

  get activeElement(): null {
    return null;
  }

  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
}

function installTestDom(): void {
  const document = new TestNode("#document", null, 9);
  const window = {
    document,
    HTMLIFrameElement: TestNode,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLIFrameElement", window.HTMLIFrameElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

describe("useZeropsGiteaOverview", () => {
  afterEach(() => {
    gitea.readable = true;
    gitea.unauthorizedOnRead = false;
    gitea.searchFails = null;
    gitea.listings = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps what it read when a re-read meets a 401 that no token recovered (§4.6)", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGiteaOverviewState> = [];

    function Probe() {
      seen.push(
        useZeropsGiteaOverview({ giteaOrigin: "https://gitea.example.test", enabled: true }),
      );
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.at(-1)?.owners.map((owner) => owner.openPulls)).toEqual([1]);

    gitea.unauthorizedOnRead = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GITEA_OVERVIEW_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);
    expect(seen.at(-1)?.owners.map((owner) => owner.openPulls)).toEqual([1]);

    await act(async () => {
      root.unmount();
    });
  });

  it("reads as soon as the session is readable again, not on the next minute (§4.6)", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGiteaOverviewState> = [];

    function Probe(_props: { readonly render: number }) {
      seen.push(
        useZeropsGiteaOverview({ giteaOrigin: "https://gitea.example.test", enabled: true }),
      );
      return null;
    }

    gitea.readable = false;
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { render: 0 }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.at(-1)?.read).toBe(false);

    // The token arrives: the overview reads now.
    gitea.readable = true;
    await act(async () => {
      root.render(createElement(Probe, { render: 1 }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gitea.listings).toBe(1);
    expect(seen.at(-1)?.owners.map((owner) => owner.openPulls)).toEqual([1]);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps what it read when a re-read fails, and names the cause beside it until one answers", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGiteaOverviewState> = [];

    function Probe() {
      seen.push(
        useZeropsGiteaOverview({ giteaOrigin: "https://gitea.example.test", enabled: true }),
      );
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.at(-1)?.failure).toBeNull();

    // Only the pull request search fails: nothing read turns into "no pull requests".
    gitea.searchFails = "Gitea answered 500.";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GITEA_OVERVIEW_REFRESH_MS);
    });
    expect(seen.at(-1)).toMatchObject({ read: true, failure: "Gitea answered 500." });
    expect(seen.at(-1)?.owners.map((owner) => owner.openPulls)).toEqual([1]);

    gitea.searchFails = null;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GITEA_OVERVIEW_REFRESH_MS);
    });
    expect(seen.at(-1)).toMatchObject({ read: true, failure: null });

    await act(async () => {
      root.unmount();
    });
  });
});
