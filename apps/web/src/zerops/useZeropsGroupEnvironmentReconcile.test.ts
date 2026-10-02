import type { HalfMadeGroupEnvironment, ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AddGroupEnvironmentOutcome } from "./addGroupEnvironment";
import {
  RECONCILE_RETRY_MS,
  useZeropsGroupEnvironmentReconcile,
} from "./useZeropsGroupEnvironmentReconcile";

/**
 * Whether this tab can read Gitea now, the repairs run, whether the next one loses the Gitea
 * token part-way — a 401 whose reacquire fails — and whether its Gitea request meets a 401 that
 * outlasts the request's wait while the reacquire goes on to succeed.
 */
const gitea = vi.hoisted(() => ({
  readable: true,
  repairs: [] as Array<{ readonly gitea: unknown }>,
  loseTokenOnRepair: false,
  outwaitReacquireOnRepair: false,
  /** While set, a repair waits for it before it answers. */
  hold: null as Promise<void> | null,
  /** The next repair's outcome fails a step the page cannot fix by itself. */
  failNext: false,
  /** Each registry read the page asked for after a repair. */
  refreshes: 0,
}));

/** The fake client's side door: its request ended in a 401 no token recovered. */
interface FakeGitea {
  readonly unauthorized: () => void;
}

vi.mock("./accountGiteaSessions", () => ({
  giteaClientFor: (_origin: string, onUnauthorized: () => void = () => undefined) =>
    gitea.readable
      ? ({ readFile: async () => undefined, unauthorized: onUnauthorized } as FakeGitea)
      : null,
}));

vi.mock("./addGroupEnvironment", () => ({
  addGroupEnvironment: async (input: { readonly gitea: FakeGitea | null }) => {
    gitea.repairs.push({ gitea: input.gitea });
    if (gitea.hold !== null) await gitea.hold;
    if (gitea.failNext) {
      gitea.failNext = false;
      return {
        done: ["registry"],
        failed: { step: "broker-grant", reason: "The broker did not answer." },
        pullRequest: undefined,
      } satisfies AddGroupEnvironmentOutcome;
    }
    if (gitea.loseTokenOnRepair || gitea.outwaitReacquireOnRepair) {
      if (gitea.loseTokenOnRepair) gitea.readable = false;
      input.gitea?.unauthorized();
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
const ZEROPS = {} as ZeropsApiClient;
/** The repairs are mocked whole: the runtime they would grant the broker with is never called. */
const DATA = { runtime: {} } as unknown as Parameters<
  typeof useZeropsGroupEnvironmentReconcile
>[0]["data"];
const HQ = { projectId: "hq-1", address: "https://hq-1-8080.prg1.zerops.app" } as const;

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
    gitea.outwaitReacquireOnRepair = false;
    gitea.hold = null;
    gitea.failNext = false;
    gitea.refreshes = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function mount(onOutcome: (outcome: AddGroupEnvironmentOutcome) => void) {
    installTestDom();
    const { createRoot } = await import("react-dom/client");

    function Probe({ enabled }: { readonly enabled: boolean }) {
      useZeropsGroupEnvironmentReconcile({
        enabled,
        client: ZEROPS,
        data: DATA,
        clientId: "org-1",
        hq: HQ,
        giteaOrigin: "https://gitea.example.test",
        giteaProjectId: "gitea-project",
        refreshRegistry: () => {
          gitea.refreshes += 1;
        },
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

  it.each([
    ["lost its Gitea token part-way", "loseTokenOnRepair"],
    ["met a Gitea 401 that outlasted its wait", "outwaitReacquireOnRepair"],
  ] as const)(
    "a repair that %s is given back unreported, and tried again after its backoff, never on a loading flip",
    async (_label, failure) => {
      vi.useFakeTimers();
      const outcomes: Array<AddGroupEnvironmentOutcome> = [];
      const page = await mount((outcome) => outcomes.push(outcome));
      gitea[failure] = true;
      await page.render(true);
      expect(gitea.repairs).toHaveLength(1);
      expect(outcomes).toEqual([]);

      gitea[failure] = false;
      gitea.readable = true;
      // A cold load's loading flips: none of them starts the repair over.
      for (let flip = 0; flip < 3; flip++) {
        await page.render(false);
        await page.render(true);
      }
      expect(gitea.repairs).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RECONCILE_RETRY_MS[0]!);
      });
      expect(gitea.repairs).toHaveLength(2);
      expect(outcomes.map((outcome) => outcome.failed)).toEqual([undefined]);
      await page.unmount();
    },
  );

  it("a cold load with a half-made environment repairs it once, reads the registry once, and settles", async () => {
    vi.useFakeTimers();
    const outcomes: Array<AddGroupEnvironmentOutcome> = [];
    const page = await mount((outcome) => outcomes.push(outcome));
    for (let flip = 0; flip < 5; flip++) {
      await page.render(true);
      await page.render(false);
    }
    await page.render(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(gitea.repairs).toHaveLength(1);
    expect(gitea.refreshes).toBe(1);
    expect(outcomes.map((outcome) => outcome.failed)).toEqual([undefined]);
    await page.unmount();
  });

  it("runs a repair once however often the page's loading flips while it runs", async () => {
    const outcomes: Array<AddGroupEnvironmentOutcome> = [];
    const page = await mount((outcome) => outcomes.push(outcome));
    let answer = () => undefined as void;
    gitea.hold = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.render(true);
    // A cold load: the inventory's loading flips the repair's gate three times over.
    for (let flip = 0; flip < 3; flip++) {
      await page.render(false);
      await page.render(true);
    }
    gitea.hold = null;
    await act(async () => answer());
    for (let flip = 0; flip < 3; flip++) {
      await page.render(false);
      await page.render(true);
    }
    expect(gitea.repairs).toHaveLength(1);
    expect(outcomes.map((outcome) => outcome.failed)).toEqual([undefined]);
    await page.unmount();
  });

  it("tries a failed repair again only after its backoff", async () => {
    vi.useFakeTimers();
    const outcomes: Array<AddGroupEnvironmentOutcome> = [];
    const page = await mount((outcome) => outcomes.push(outcome));
    gitea.failNext = true;
    await page.render(true);
    expect(gitea.repairs).toHaveLength(1);
    await page.render(false);
    await page.render(true);
    expect(gitea.repairs).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_RETRY_MS[0]!);
    });
    expect(gitea.repairs).toHaveLength(2);
    expect(outcomes.map((outcome) => outcome.failed === undefined)).toEqual([false, true]);
    await page.unmount();
  });
});
