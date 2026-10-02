import type { HalfMadeGroupEnvironment, ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AddGroupEnvironmentOutcome } from "./addGroupEnvironment";
import {
  RECONCILE_RETRY_MS,
  useZeropsGroupEnvironmentReconcile,
} from "./useZeropsGroupEnvironmentReconcile";

/** The repairs run, and how the next one goes. */
const repairs = vi.hoisted(() => ({
  run: [] as Array<{ readonly projectId: string }>,
  /** While set, a repair waits for it before it answers. */
  hold: null as Promise<void> | null,
  /** The next repair's outcome fails a step the page cannot fix by itself. */
  failNext: false,
}));

vi.mock("./addGroupEnvironment", () => ({
  addGroupEnvironment: async (input: { readonly environment: { readonly project: string } }) => {
    repairs.run.push({ projectId: input.environment.project });
    if (repairs.hold !== null) await repairs.hold;
    if (repairs.failNext) {
      repairs.failNext = false;
      return {
        done: ["registry"],
        failed: { step: "deploy-token", reason: "HQ is not answering right now." },
      } satisfies AddGroupEnvironmentOutcome;
    }
    return {
      done: ["registry", "deploy-token"],
      failed: undefined,
    } satisfies AddGroupEnvironmentOutcome;
  },
}));

const HALF_MADE: ReadonlyArray<HalfMadeGroupEnvironment> = [
  { groupId: "g1", projectId: "p-stage", tier: "stage" },
];
const ZEROPS = {} as ZeropsApiClient;
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
    repairs.run = [];
    repairs.hold = null;
    repairs.failNext = false;
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
        clientId: "org-1",
        hq: HQ,
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

  it("a cold load with a half-made environment repairs it once, and settles", async () => {
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
    expect(repairs.run).toHaveLength(1);
    expect(outcomes.map((outcome) => outcome.failed)).toEqual([undefined]);
    await page.unmount();
  });

  it("runs a repair once however often the page's loading flips while it runs", async () => {
    const outcomes: Array<AddGroupEnvironmentOutcome> = [];
    const page = await mount((outcome) => outcomes.push(outcome));
    let answer = () => undefined as void;
    repairs.hold = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await page.render(true);
    // A cold load: the inventory's loading flips the repair's gate three times over.
    for (let flip = 0; flip < 3; flip++) {
      await page.render(false);
      await page.render(true);
    }
    repairs.hold = null;
    await act(async () => answer());
    for (let flip = 0; flip < 3; flip++) {
      await page.render(false);
      await page.render(true);
    }
    expect(repairs.run).toHaveLength(1);
    expect(outcomes.map((outcome) => outcome.failed)).toEqual([undefined]);
    await page.unmount();
  });

  it("tries a failed repair again only after its backoff", async () => {
    vi.useFakeTimers();
    const outcomes: Array<AddGroupEnvironmentOutcome> = [];
    const page = await mount((outcome) => outcomes.push(outcome));
    repairs.failNext = true;
    await page.render(true);
    expect(repairs.run).toHaveLength(1);
    await page.render(false);
    await page.render(true);
    expect(repairs.run).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_RETRY_MS[0]!);
    });
    expect(repairs.run).toHaveLength(2);
    expect(outcomes.map((outcome) => outcome.failed === undefined)).toEqual([false, true]);
    await page.unmount();
  });
});
