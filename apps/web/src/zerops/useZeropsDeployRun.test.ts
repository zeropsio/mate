import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useZeropsDeployRun, type ZeropsDeployRunState } from "./useZeropsDeployRun";

/** Whether this tab can read Gitea now. */
const gitea = vi.hoisted(() => ({ readable: false }));

vi.mock("./accountGiteaSessions", () => ({
  useGiteaReadable: () => gitea.readable,
  giteaClientFor: () =>
    gitea.readable
      ? {
          listActionRuns: async () => [{ id: 4, run_number: 12, head_sha: "abc123" }],
          listActionJobs: async () => [],
        }
      : null,
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

describe("useZeropsDeployRun", () => {
  afterEach(() => {
    gitea.readable = false;
    vi.unstubAllGlobals();
  });

  it("reads the build once a Gitea token is there, having said there was none", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsDeployRunState> = [];
    const request = {
      giteaOrigin: "https://gitea.example.test",
      owner: "harbor",
      repo: "app",
      sha: "abc123",
    };

    function Probe(_props: { readonly render: number }) {
      seen.push(useZeropsDeployRun(request).state);
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { render: 0 }));
    });
    expect(seen.at(-1)?.kind).toBe("no-gitea");

    // The session's token comes back: the pane that asked reads, without being opened again.
    gitea.readable = true;
    await act(async () => {
      root.render(createElement(Probe, { render: 1 }));
    });
    expect(seen.at(-1)).toEqual({ kind: "read", runId: 4, runNumber: 12, jobs: [] });

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps a build it read while the token is gone and while it is read again (§4.6)", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsDeployRunState> = [];
    const request = {
      giteaOrigin: "https://gitea.example.test",
      owner: "harbor",
      repo: "app",
      sha: "abc123",
    };

    function Probe(_props: { readonly render: number }) {
      seen.push(useZeropsDeployRun(request).state);
      return null;
    }

    gitea.readable = true;
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { render: 0 }));
    });
    expect(seen.at(-1)?.kind).toBe("read");
    const readAt = seen.length - 1;

    // A 401's reacquire fails: no request can go out, and the build still stands.
    gitea.readable = false;
    await act(async () => {
      root.render(createElement(Probe, { render: 1 }));
    });
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
});
