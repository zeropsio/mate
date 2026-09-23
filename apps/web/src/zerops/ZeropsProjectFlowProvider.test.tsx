import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useZeropsProjectFlow, type ZeropsProjectFlowValue } from "./projectFlowContext";
import { ZeropsProjectFlowProvider } from "./ZeropsProjectFlowProvider";

const GITEA = "https://gitea.example.test";

/**
 * The flows stand through a failed reacquire: signed in, and no token to act with until
 * `readable` turns; `trouble` is the cause the session names. `origin` is whether the account has
 * a Gitea at all.
 */
const gitea = vi.hoisted(() => ({
  readable: false,
  origin: true,
  trouble: null as string | null,
}));

vi.mock("./accountGiteaSessions", () => ({
  useGiteaSession: () => ({ signedIn: true, readable: gitea.readable, trouble: gitea.trouble }),
  giteaClientFor: () => null,
}));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: "signed-in",
    activeOrganization: { id: "org-1", roleCode: "OWNER" },
    client: {},
  }),
}));
vi.mock("./ZeropsInventoryProvider", () => ({
  useZeropsInventory: () => ({ projects: [], services: new Map(), projectRefs: new Map() }),
}));
vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({ runtime: { reads: { servicesOf: () => null } } }),
  useZeropsAtomSelections: () => new Map(),
  stabilizeZeropsAtom: (atom: unknown) => atom,
  zeropsKnowledgeArraysEqual: () => true,
}));
vi.mock("./useNowMs", () => ({ useNowMs: () => 0 }));
vi.mock("./giteaProject", () => ({
  findAccountGitea: () =>
    gitea.origin
      ? {
          projectId: "gitea-project",
          state: { url: GITEA, brokerUrl: "https://broker.example.test" },
        }
      : undefined,
}));
vi.mock("./useZeropsRegistry", () => ({
  useZeropsRegistry: () => ({ registry: { groups: [{ groupId: "g1", slug: "harbor" }] } }),
}));
vi.mock("./useZeropsDeployedVersion", () => ({
  useZeropsDeployedVersionReader: () => async () => undefined,
}));
vi.mock("./useZeropsGroupDeploys", () => ({
  useZeropsGroupDeploys: () => ({ deploys: new Map(), failures: new Map(), invalidate: () => {} }),
}));
vi.mock("./useZeropsGroupForge", () => ({
  useZeropsGroupForge: () => ({
    forges: new Map([
      [
        "g1",
        {
          repositories: [],
          pullRequests: [],
          merged: [],
          released: { releases: [], tags: [] },
        },
      ],
    ]),
    failures: new Map(),
    invalidate: () => {},
  }),
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

describe("ZeropsProjectFlowProvider", () => {
  afterEach(() => {
    gitea.readable = false;
    gitea.origin = true;
    gitea.trouble = null;
    vi.unstubAllGlobals();
  });

  it("a Gitea that stops answering keeps the flows and names the cause where the verbs are", async () => {
    gitea.trouble = "Gitea isn't answering.";
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsProjectFlowValue> = [];

    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    expect([...(seen.at(-1)?.flows.keys() ?? [])]).toEqual(["g1"]);
    expect(seen.at(-1)?.trouble).toBe("Gitea isn't answering.");

    await act(async () => {
      root.unmount();
    });
  });

  it("a verb pressed while no Gitea token is held says why nothing happened", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsProjectFlowValue> = [];

    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    expect(seen.at(-1)?.readable).toBe(false);
    expect(seen.at(-1)?.trouble).toBeNull();

    await act(async () => {
      await seen.at(-1)?.mergePullRequest("harbor", { repository: "app", number: 7 });
    });
    expect(seen.at(-1)?.trouble).toBe("Signing in to Gitea again. Try it again in a moment.");

    await act(async () => {
      root.unmount();
    });
  });

  it("stops saying it is signing in again once the token is back", async () => {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsProjectFlowValue> = [];

    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    await act(async () => {
      await seen.at(-1)?.mergePullRequest("harbor", { repository: "app", number: 7 });
    });
    expect(seen.at(-1)?.trouble).toBe("Signing in to Gitea again. Try it again in a moment.");

    gitea.readable = true;
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    expect(seen.at(-1)?.trouble).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("a verb pressed with no Gitea on the account claims no sign-in", async () => {
    gitea.origin = false;
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsProjectFlowValue> = [];

    function Probe() {
      seen.push(useZeropsProjectFlow());
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(ZeropsProjectFlowProvider, null, createElement(Probe)));
    });
    await act(async () => {
      await seen.at(-1)?.mergePullRequest("harbor", { repository: "app", number: 7 });
    });
    expect(seen.at(-1)?.trouble).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
