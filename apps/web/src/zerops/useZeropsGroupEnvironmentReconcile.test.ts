import type {
  HalfMadeGroupEnvironment,
  ZeropsApiClient,
  ZeropsRegistry,
} from "@t3tools/client-runtime/zerops";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AddGroupEnvironmentOutcome } from "./addGroupEnvironment";
import { useZeropsGroupEnvironmentReconcile } from "./useZeropsGroupEnvironmentReconcile";

/**
 * Whether this tab can read Gitea now, the repairs run, and whether the next one loses the Gitea
 * token part-way — a 401 whose reacquire fails.
 */
const gitea = vi.hoisted(() => ({
  readable: true,
  repairs: [] as Array<{ readonly gitea: unknown }>,
  loseTokenOnRepair: false,
}));

vi.mock("./accountGiteaSessions", () => ({
  giteaClientFor: () => (gitea.readable ? { readFile: async () => undefined } : null),
}));

vi.mock("./addGroupEnvironment", () => ({
  addGroupEnvironment: async (input: { readonly gitea: unknown }) => {
    gitea.repairs.push({ gitea: input.gitea });
    if (gitea.loseTokenOnRepair) {
      gitea.readable = false;
      return {
        done: ["registry", "broker-grant", "deploy-token"],
        failed: {
          step: "environments-document",
          reason: "You are not signed in to Gitea.",
        },
        pullRequest: undefined,
      } satisfies AddGroupEnvironmentOutcome;
    }
    return {
      done: ["registry", "broker-grant", "deploy-token", "environments-document"],
      failed: undefined,
      pullRequest: undefined,
    } satisfies AddGroupEnvironmentOutcome;
  },
}));

const HALF_MADE: ReadonlyArray<HalfMadeGroupEnvironment> = [
  { groupId: "g1", projectId: "p-stage", displayName: "Harbor stage", tier: "stage" },
];
const REGISTRY = { groups: [] } as unknown as ZeropsRegistry;
const ZEROPS = {} as ZeropsApiClient;

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

describe("useZeropsGroupEnvironmentReconcile", () => {
  afterEach(() => {
    gitea.readable = true;
    gitea.repairs = [];
    gitea.loseTokenOnRepair = false;
    vi.unstubAllGlobals();
  });

  async function mount(onOutcome: (outcome: AddGroupEnvironmentOutcome) => void) {
    installTestDom();
    const { createRoot } = await import("react-dom/client");

    function Probe({ enabled }: { readonly enabled: boolean }) {
      useZeropsGroupEnvironmentReconcile({
        enabled,
        client: ZEROPS,
        clientId: "org-1",
        giteaOrigin: "https://gitea.example.test",
        giteaProjectId: "gitea-project",
        registry: REGISTRY,
        refreshRegistry: () => undefined,
        halfMade: HALF_MADE,
        onOutcome: (_entry, outcome) => onOutcome(outcome),
      });
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const render = async (enabled: boolean) => {
      await act(async () => {
        root.render(createElement(Probe, { enabled }));
      });
    };
    return {
      render,
      unmount: () =>
        act(async () => {
          root.unmount();
        }),
    };
  }

  it("starts no repair while Gitea has no token to declare it with", async () => {
    const outcomes: Array<AddGroupEnvironmentOutcome> = [];
    const page = await mount((outcome) => outcomes.push(outcome));
    gitea.readable = false;
    await page.render(true);
    expect(gitea.repairs).toEqual([]);

    // The token is back, and the page enables the repair again: it runs, with a client.
    gitea.readable = true;
    await page.render(false);
    await page.render(true);
    expect(gitea.repairs).toHaveLength(1);
    expect(gitea.repairs[0]?.gitea).not.toBeNull();
    expect(outcomes.map((outcome) => outcome.failed)).toEqual([undefined]);
    await page.unmount();
  });

  it("gives a repair that lost its Gitea token part-way back, unreported, for the next run", async () => {
    const outcomes: Array<AddGroupEnvironmentOutcome> = [];
    const page = await mount((outcome) => outcomes.push(outcome));
    gitea.loseTokenOnRepair = true;
    await page.render(true);
    expect(gitea.repairs).toHaveLength(1);
    expect(outcomes).toEqual([]);

    gitea.loseTokenOnRepair = false;
    gitea.readable = true;
    await page.render(false);
    await page.render(true);
    expect(gitea.repairs).toHaveLength(2);
    expect(outcomes.map((outcome) => outcome.failed)).toEqual([undefined]);
    await page.unmount();
  });
});
