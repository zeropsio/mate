import type { GiteaPullRequest } from "@t3tools/client-runtime/zerops";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  LANDED_CHANGE_RETRY_MS,
  useZeropsLandedChange,
  type ZeropsLandedChangeState,
} from "./useZeropsLandedChange";

/**
 * What the forge answers each read of the change, in order — the last answer repeats — and
 * whether this tab holds a Gitea token.
 */
type Answer = "pull" | "absent" | "failed" | "unauthorized";
const gitea = vi.hoisted(() => ({
  readable: false,
  answers: [] as Array<"pull" | "absent" | "failed" | "unauthorized">,
  reads: 0,
}));

const PULL = {
  number: 31,
  title: "Cache the link previews",
  html_url: "https://gitea.example.test/zit/zitdev/pulls/31",
  merged: false,
  state: "open",
  head: { ref: "mate/work", sha: "abc123" },
  base: { ref: "main" },
} as unknown as GiteaPullRequest;

vi.mock("./accountGiteaSessions", () => ({
  useGiteaReadable: () => gitea.readable,
  giteaClientFor: (_origin: string, onUnauthorized?: () => void) =>
    gitea.readable
      ? {
          getPullRequest: async () => {
            const answer = gitea.answers[Math.min(gitea.reads, gitea.answers.length - 1)];
            gitea.reads += 1;
            if (answer === "absent") return undefined;
            if (answer === "failed") throw new Error("Gitea did not answer within 15 s.");
            if (answer === "unauthorized") {
              onUnauthorized?.();
              throw new Error("You are not signed in to Gitea.");
            }
            return PULL;
          },
          listCommitStatuses: async () => [],
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

/**
 * A change a Mate links to in a message it is still writing: it opened the change a moment
 * before, and the conversation asks the forge for it on its own. Whatever the first read met, the
 * link settles on the change within a minute — never on the bare url until the page is reloaded.
 */
const settles: ReadonlyArray<{
  readonly name: string;
  /** Whether the tab holds a Gitea token when the link is first drawn. */
  readonly readableAtFirst: boolean;
  readonly answers: ReadonlyArray<Answer>;
}> = [
  {
    name: "a token that arrives after the link is drawn",
    readableAtFirst: false,
    answers: ["pull"],
  },
  { name: "a read that failed", readableAtFirst: true, answers: ["failed", "pull"] },
  { name: "a first read that did not find it", readableAtFirst: true, answers: ["absent", "pull"] },
  {
    name: "a 401 no token recovered",
    readableAtFirst: true,
    answers: ["unauthorized", "failed", "pull"],
  },
];

describe("useZeropsLandedChange", () => {
  afterEach(() => {
    gitea.readable = false;
    gitea.answers = [];
    gitea.reads = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(settles)("reads the change after $name", async ({ readableAtFirst, answers }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    gitea.readable = readableAtFirst;
    gitea.answers = [...answers];
    const seen: Array<ZeropsLandedChangeState> = [];
    const request = {
      giteaOrigin: "https://gitea.example.test",
      owner: "zit",
      repository: "zitdev",
      number: 31,
    };

    function Probe(_props: { readonly render: number }) {
      seen.push(useZeropsLandedChange(request));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { render: 0 }));
    });
    gitea.readable = true;
    await act(async () => {
      root.render(createElement(Probe, { render: 1 }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(seen.at(-1)).toMatchObject({ kind: "read", pull: { number: 31 } });

    await act(async () => {
      root.unmount();
    });
  });

  it("stops asking once the forge keeps saying the change is not there", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    gitea.readable = true;
    gitea.answers = ["absent"];
    const seen: Array<ZeropsLandedChangeState> = [];
    const request = {
      giteaOrigin: "https://gitea.example.test",
      owner: "zit",
      repository: "zitdev",
      number: 999,
    };

    function Probe() {
      seen.push(useZeropsLandedChange(request));
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(seen.at(-1)).toEqual({ kind: "gone" });
    expect(gitea.reads).toBe(1 + LANDED_CHANGE_RETRY_MS.length);

    await act(async () => {
      root.unmount();
    });
  });
});
