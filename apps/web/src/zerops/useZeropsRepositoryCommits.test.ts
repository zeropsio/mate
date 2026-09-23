import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  useZeropsChangeCommits,
  useZeropsRepositoryCommits,
  type ZeropsCommitsState,
} from "./useZeropsRepositoryCommits";

/**
 * Whether this tab can read Gitea now, and whether its reads meet a 401 that no token recovered —
 * the reacquire failed, or outlasted the request's wait.
 */
const gitea = vi.hoisted(() => ({ readable: false, unauthorizedOnRead: false }));

vi.mock("./accountGiteaSessions", () => ({
  useGiteaReadable: () => gitea.readable,
  giteaClientFor: (_origin: string, onUnauthorized?: () => void) => {
    const read = async <T>(answer: T): Promise<T> => {
      if (gitea.unauthorizedOnRead) {
        onUnauthorized?.();
        throw new Error("You are not signed in to Gitea.");
      }
      return answer;
    };
    return gitea.readable
      ? {
          listCommits: () => read([{ sha: "abc123", subject: "Stage follows main" }]),
          listTags: () => read([]),
          compareCommits: () => read([{ sha: "def456", subject: "Add the stage" }]),
        }
      : null;
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

describe("useZeropsRepositoryCommits", () => {
  afterEach(() => {
    gitea.readable = false;
    gitea.unauthorizedOnRead = false;
    vi.unstubAllGlobals();
  });

  it("reads the history once a Gitea token is there, having said there was none", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsCommitsState> = [];
    const request = { giteaOrigin: "https://gitea.example.test", owner: "harbor", repo: "app" };

    function Probe(_props: { readonly render: number }) {
      seen.push(useZeropsRepositoryCommits(request));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { render: 0 }));
    });
    expect(seen.at(-1)?.kind).toBe("no-gitea");

    // The session's token comes back: the surface that asked reads, without being opened again.
    gitea.readable = true;
    await act(async () => {
      root.render(createElement(Probe, { render: 1 }));
    });
    expect(seen.at(-1)?.kind).toBe("read");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps a history it read while the token is gone and while it is read again (§4.6)", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsCommitsState> = [];
    const request = { giteaOrigin: "https://gitea.example.test", owner: "harbor", repo: "app" };

    function Probe(_props: { readonly render: number }) {
      seen.push(useZeropsRepositoryCommits(request));
      return null;
    }

    gitea.readable = true;
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { render: 0 }));
    });
    expect(seen.at(-1)?.kind).toBe("read");
    const readAt = seen.length - 1;

    // A 401's reacquire fails: no request can go out, and what was read still stands.
    gitea.readable = false;
    await act(async () => {
      root.render(createElement(Probe, { render: 1 }));
    });
    // The token comes back: the history is read again behind what it shows.
    gitea.readable = true;
    await act(async () => {
      root.render(createElement(Probe, { render: 2 }));
    });

    expect(seen.slice(readAt).map((state) => state.kind)).toEqual(
      seen.slice(readAt).map(() => "read"),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps a history it read when the re-read meets a 401 that no token recovered (§4.6)", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsCommitsState> = [];
    const request = { giteaOrigin: "https://gitea.example.test", owner: "harbor", repo: "app" };

    function Probe(_props: { readonly render: number }) {
      seen.push(useZeropsRepositoryCommits(request));
      return null;
    }

    gitea.readable = true;
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { render: 0 }));
    });
    expect(seen.at(-1)?.kind).toBe("read");
    const readAt = seen.length - 1;

    gitea.readable = false;
    await act(async () => {
      root.render(createElement(Probe, { render: 1 }));
    });
    // The token is back, and the re-read's own 401 is not recovered in its wait.
    gitea.readable = true;
    gitea.unauthorizedOnRead = true;
    await act(async () => {
      root.render(createElement(Probe, { render: 2 }));
    });

    expect(seen.slice(readAt).map((state) => state.kind)).toEqual(
      seen.slice(readAt).map(() => "read"),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("says there is no Gitea for a history opened on another repository while the token is gone", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsCommitsState> = [];

    function Probe(props: { readonly repo: string }) {
      seen.push(
        useZeropsRepositoryCommits({
          giteaOrigin: "https://gitea.example.test",
          owner: "harbor",
          repo: props.repo,
        }),
      );
      return null;
    }

    gitea.readable = true;
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { repo: "app" }));
    });
    expect(seen.at(-1)?.kind).toBe("read");

    gitea.readable = false;
    await act(async () => {
      root.render(createElement(Probe, { repo: "api" }));
    });
    expect(seen.at(-1)?.kind).toBe("no-gitea");

    await act(async () => {
      root.unmount();
    });
  });
});

describe("useZeropsChangeCommits", () => {
  afterEach(() => {
    gitea.readable = false;
    gitea.unauthorizedOnRead = false;
    vi.unstubAllGlobals();
  });

  it("keeps a change's commits it read while the token is gone (§4.6)", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsCommitsState> = [];
    const request = {
      giteaOrigin: "https://gitea.example.test",
      owner: "harbor",
      repo: "app",
      base: "main",
      head: "stage",
    };

    function Probe(_props: { readonly render: number }) {
      seen.push(useZeropsChangeCommits(request));
      return null;
    }

    gitea.readable = true;
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { render: 0 }));
    });
    expect(seen.at(-1)?.kind).toBe("read");
    const readAt = seen.length - 1;

    gitea.readable = false;
    await act(async () => {
      root.render(createElement(Probe, { render: 1 }));
    });

    expect(seen.slice(readAt).map((state) => state.kind)).toEqual(
      seen.slice(readAt).map(() => "read"),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps a change's commits it read when the re-read meets a 401 that no token recovered (§4.6)", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsCommitsState> = [];
    const request = {
      giteaOrigin: "https://gitea.example.test",
      owner: "harbor",
      repo: "app",
      base: "main",
      head: "stage",
    };

    function Probe(_props: { readonly render: number }) {
      seen.push(useZeropsChangeCommits(request));
      return null;
    }

    gitea.readable = true;
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { render: 0 }));
    });
    expect(seen.at(-1)?.kind).toBe("read");
    const readAt = seen.length - 1;

    gitea.readable = false;
    await act(async () => {
      root.render(createElement(Probe, { render: 1 }));
    });
    gitea.readable = true;
    gitea.unauthorizedOnRead = true;
    await act(async () => {
      root.render(createElement(Probe, { render: 2 }));
    });

    expect(seen.slice(readAt).map((state) => state.kind)).toEqual(
      seen.slice(readAt).map(() => "read"),
    );

    await act(async () => {
      root.unmount();
    });
  });
});
