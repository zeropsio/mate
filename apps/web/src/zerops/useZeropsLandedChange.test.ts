import { HqError, type HqApi } from "@t3tools/client-runtime/zerops/hq";
import type { ChangeDetailResponse, HqChange } from "@t3tools/shared/hqChanges";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  LANDED_CHANGE_RETRY_MS,
  useZeropsLandedChange,
  type ZeropsLandedChangeState,
} from "./useZeropsLandedChange";

/**
 * What HQ answers each read of the change, in order — the last answer repeats — and whether the
 * organization's official HQ is known yet.
 */
type Answer = "change" | "unpushed" | "absent" | "unavailable" | "forbidden";
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

/**
 * A change a Mate links to that the flow does not carry: HQ is asked for it on its own. Whatever
 * the first read met, the link settles on the change within a minute — never on the bare url until
 * the page is reloaded.
 */
const settles: ReadonlyArray<{
  readonly name: string;
  /** Whether the official HQ is known when the link is first drawn. */
  readonly officialAtFirst: boolean;
  readonly answers: ReadonlyArray<Answer>;
}> = [
  {
    name: "an HQ anchor resolved after the link is drawn",
    officialAtFirst: false,
    answers: ["change"],
  },
  { name: "a read HQ did not answer", officialAtFirst: true, answers: ["unavailable", "change"] },
  {
    name: "a first read that did not find it",
    officialAtFirst: true,
    answers: ["absent", "change"],
  },
];

const LINK = { appId: "g1", repo: "zitdev", number: 31 };

describe("useZeropsLandedChange", () => {
  afterEach(() => {
    hq.official = false;
    hq.answers = [];
    hq.reads = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** The states drawn while the link is read, `officialAtFirst` turning true on the second render. */
  async function settle(link: typeof LINK, officialAtFirst: boolean) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    hq.official = officialAtFirst;
    const seen: Array<ZeropsLandedChangeState> = [];
    function Probe(_props: { readonly render: number }) {
      seen.push(useZeropsLandedChange(link));
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { render: 0 }));
    });
    hq.official = true;
    await act(async () => {
      root.render(createElement(Probe, { render: 1 }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    await act(async () => {
      root.unmount();
    });
    return seen;
  }

  it.each(settles)("reads the change after $name", async ({ officialAtFirst, answers }) => {
    hq.answers = [...answers];
    const seen = await settle(LINK, officialAtFirst);
    expect(seen.at(-1)).toMatchObject({
      kind: "read",
      pull: { number: 31, merged: true, url: `${HQ_ADDRESS}/changes/g1/zitdev/31` },
    });
  });

  it("stops asking once HQ keeps saying the change is not there", async () => {
    hq.answers = ["absent"];
    const seen = await settle({ ...LINK, number: 999 }, true);
    expect(seen.at(-1)).toEqual({ kind: "gone" });
    expect(hq.reads).toBe(1 + LANDED_CHANGE_RETRY_MS.length);
  });

  it("draws no change no push reached, as nothing else does", async () => {
    hq.answers = ["unpushed"];
    const seen = await settle(LINK, true);
    expect(seen.at(-1)).toEqual({ kind: "gone" });
  });

  it("says why when HQ will not let the person read it", async () => {
    hq.answers = ["forbidden"];
    const seen = await settle(LINK, true);
    expect(seen.at(-1)).toEqual({ kind: "failed", reason: "HQ refused this (forbidden)." });
  });
});
