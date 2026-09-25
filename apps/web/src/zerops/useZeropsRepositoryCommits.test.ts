import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  useZeropsChangeCommits,
  useZeropsRepositoriesCommits,
  useZeropsRepositoryCommits,
  type ZeropsCommitsState,
} from "./useZeropsRepositoryCommits";

/**
 * Whether this tab can read Gitea now, and whether its reads meet a 401 that no token recovered —
 * the reacquire failed, or outlasted the request's wait.
 */
const gitea = vi.hoisted(() => ({
  readable: false,
  unauthorizedOnRead: false,
  /** Repositories whose commits the forge will not read. */
  failing: new Set<string>(),
  /** The repositories each `listCommits` asked for, and how often tags were read. */
  commitReads: [] as Array<string>,
  tagReads: 0,
}));

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
          listCommits: (_owner: string, repo: string) => {
            gitea.commitReads.push(repo);
            return gitea.failing.has(repo)
              ? Promise.reject(new Error(`Gitea would not read ${repo}.`))
              : read([{ sha: "abc123", subject: "Stage follows main" }]);
          },
          listTags: () => {
            gitea.tagReads += 1;
            return read([]);
          },
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

describe("useZeropsRepositoriesCommits", () => {
  beforeEach(() => {
    gitea.commitReads.length = 0;
    gitea.tagReads = 0;
  });

  afterEach(() => {
    gitea.readable = false;
    gitea.unauthorizedOnRead = false;
    gitea.failing.clear();
    gitea.commitReads.length = 0;
    gitea.tagReads = 0;
    vi.unstubAllGlobals();
  });

  const kinds = (states: ReadonlyMap<string, ZeropsCommitsState> | undefined) =>
    Object.fromEntries(
      [...(states ?? new Map<string, ZeropsCommitsState>())].map(([repo, state]) => [
        repo,
        state.kind,
      ]),
    );

  async function mount(request: Parameters<typeof useZeropsRepositoriesCommits>[0]) {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ReadonlyMap<string, ZeropsCommitsState>> = [];
    function Probe(props: {
      readonly request: Parameters<typeof useZeropsRepositoriesCommits>[0];
    }) {
      seen.push(useZeropsRepositoriesCommits(props.request));
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    const render = async (next = request) => {
      await act(async () => {
        root.render(createElement(Probe, { request: next }));
      });
    };
    await render();
    return {
      seen,
      render,
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
      },
    };
  }

  const REQUEST = {
    giteaOrigin: "https://gitea.example.test",
    owner: "harbor",
    repositories: ["web", "api", "web"],
  };

  it("reads each repository once the token is there, and never the tags", async () => {
    const probe = await mount(REQUEST);
    expect(kinds(probe.seen.at(-1))).toEqual({ api: "no-gitea", web: "no-gitea" });

    gitea.readable = true;
    await probe.render({ ...REQUEST, repositories: [...REQUEST.repositories] });
    expect(kinds(probe.seen.at(-1))).toEqual({ api: "read", web: "read" });
    expect([...gitea.commitReads].sort()).toEqual(["api", "web"]);
    expect(gitea.tagReads).toBe(0);

    // A new array naming the same repositories is not a new request.
    await probe.render({ ...REQUEST, repositories: ["api", "web"] });
    expect(gitea.commitReads).toHaveLength(2);
    expect(probe.seen.at(-1)).toBe(probe.seen.at(-2));
    await probe.unmount();
  });

  it("leaves one repository read when another fails", async () => {
    gitea.readable = true;
    gitea.failing.add("api");
    const probe = await mount(REQUEST);
    const states = probe.seen.at(-1);
    expect(kinds(states)).toEqual({ api: "failed", web: "read" });
    const failed = states?.get("api");
    expect(failed?.kind === "failed" ? failed.reason : undefined).toContain("api");
    await probe.unmount();
  });

  it("keeps what it read across the token's loss and a re-read's 401 (§4.6)", async () => {
    gitea.readable = true;
    const probe = await mount(REQUEST);
    const readAt = probe.seen.length - 1;

    gitea.readable = false;
    await probe.render();
    gitea.readable = true;
    gitea.unauthorizedOnRead = true;
    await probe.render();

    for (const states of probe.seen.slice(readAt)) {
      expect(kinds(states)).toEqual({ api: "read", web: "read" });
    }
    await probe.unmount();
  });

  it.each([
    ["no request", null],
    ["no origin", { ...REQUEST, giteaOrigin: undefined }],
    ["no owner", { ...REQUEST, owner: undefined }],
    ["no repositories", { ...REQUEST, repositories: [] }],
  ] as const)("answers %s with nothing", async (_case, request) => {
    gitea.readable = true;
    const probe = await mount(request);
    expect(probe.seen.at(-1)?.size).toBe(0);
    expect(gitea.commitReads).toHaveLength(0);
    await probe.unmount();
  });
});
