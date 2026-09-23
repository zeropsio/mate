import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useZeropsRepositoryCommits, type ZeropsCommitsState } from "./useZeropsRepositoryCommits";

/** Whether this tab can read Gitea now. */
const gitea = vi.hoisted(() => ({ readable: false }));

vi.mock("./accountGiteaSessions", () => ({
  useGiteaReadable: () => gitea.readable,
  giteaClientFor: () =>
    gitea.readable
      ? {
          listCommits: async () => [{ sha: "abc123", subject: "Stage follows main" }],
          listTags: async () => [],
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

describe("useZeropsRepositoryCommits", () => {
  afterEach(() => {
    gitea.readable = false;
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
});
