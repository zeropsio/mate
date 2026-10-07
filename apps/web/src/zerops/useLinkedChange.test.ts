import { HqError, type HqApi } from "@t3tools/client-runtime/zerops/hq";
import type { ChangeDetailResponse, HqChange } from "@t3tools/shared/hqChanges";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { RegistryContext } from "@effect/atom-react";
import { AccountDataContext } from "./ZeropsAccountData";
import { reviewAccount } from "./__fixtures__/reviewAccount";
import { useLinkedChange, type LinkedChangeState } from "./useLinkedChange";

/**
 * What HQ answers each read of the change, in order — the last answer repeats — and whether the
 * organization's official HQ is known yet.
 */
const hq = vi.hoisted(() => ({
  official: false,
  answers: [] as Array<"change" | "unpushed" | "absent" | "unavailable" | "forbidden">,
  reads: 0,
}));

const HQ_ADDRESS = "https://hq.example.test";

const CHANGE: HqChange = {
  appId: "g1",
  repo: "zitdev",
  number: 31,
  mateProjectId: "mate-1",
  title: "Cache the link previews",
  body: "",
  state: "merged",
  head: "abc123",
  mergedSha: "def456",
  landedHead: "abc123",
  openedAt: "2026-10-02T09:00:00.000Z",
  mergedAt: "2026-10-02T10:00:00.000Z",
  closedAt: null,
  updatedAt: "2026-10-02T09:00:00.000Z",
  mergeability: "clean",
  behind: false,
  ready: true,
  comments: 0,
};

const refusal = (status: number, code: string, message: string) =>
  new HqError({ kind: "refused", code, status, message });

const api: Pick<HqApi, "change"> = {
  change: async () => {
    const answer = hq.answers[Math.min(hq.reads, hq.answers.length - 1)];
    hq.reads += 1;
    if (answer === "absent") throw refusal(404, "not_found", "HQ has no such change.");
    if (answer === "forbidden") throw refusal(403, "forbidden", "HQ refused this (forbidden).");
    if (answer === "unavailable") {
      throw new HqError({
        kind: "unavailable",
        code: "network",
        message: "HQ could not be reached.",
      });
    }
    if (answer === "unpushed") {
      return { change: { ...CHANGE, state: "open", head: null } } as ChangeDetailResponse;
    }
    return { change: CHANGE } as ChangeDetailResponse;
  },
};
const official = { address: HQ_ADDRESS, api };

vi.mock("./accountHq", () => ({
  useOfficialHq: () => (hq.official ? official : null),
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

const LINK = { appId: "g1", repo: "zitdev", number: 31 };

describe("useLinkedChange", () => {
  afterEach(() => {
    hq.official = false;
    hq.answers = [];
    hq.reads = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The states drawn while the link is read, `officialAtFirst` turning true on the second render. */
  async function settle(
    link: typeof LINK,
    officialAtFirst: boolean,
    expected?: { readonly kind: string },
  ) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    hq.official = officialAtFirst;
    const seen: Array<LinkedChangeState> = [];
    function Probe(_props: { readonly render: number }) {
      seen.push(useLinkedChange(link));
      return null;
    }
    const account = reviewAccount(({ link, snapshot }) => api.change(link, undefined, snapshot));
    const renderProbe = (render: number) =>
      createElement(
        RegistryContext.Provider,
        { value: account.registry },
        createElement(
          AccountDataContext.Provider,
          { value: account.data },
          createElement(Probe, { render }),
        ),
      );
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(renderProbe(0));
    });
    hq.official = true;
    await act(async () => {
      root.render(renderProbe(1));
    });
    if (expected !== undefined) expect(seen.at(-1)).toMatchObject(expected);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    await act(async () => {
      root.unmount();
    });
    return seen;
  }

  it("reads once when the official HQ becomes known", async () => {
    hq.answers = ["change"];
    const seen = await settle(LINK, false);
    expect(seen.at(-1)).toMatchObject({ kind: "read", pull: { number: 31, merged: true } });
    expect(hq.reads).toBe(1);
  });

  it.each([
    ["absent", { kind: "gone" }],
    ["unpushed", { kind: "gone" }],
    ["unavailable", { kind: "unavailable", reason: "HQ could not be reached." }],
    ["forbidden", { kind: "refused", reason: "HQ refused this (forbidden)." }],
    ["change", { kind: "read" }],
  ] as const)("publishes %s immediately after one read", async (answer, expected) => {
    hq.answers = [answer, "change"];
    // Fake timers remain still until after the first result is asserted.
    const seen = await settle(LINK, true, expected);
    expect(seen.at(-1)).toMatchObject(expected);
    expect(hq.reads).toBe(1);
  });
});
