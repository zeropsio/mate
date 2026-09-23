import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useZeropsGroupOrganizations } from "./useZeropsGroupOrganizations";

const gitea = vi.hoisted(() => ({
  answers: [] as ReadonlyArray<"made" | "not-made" | "refused">,
  asked: [] as string[],
}));

vi.mock("./accountGiteaSessions", () => ({
  giteaClientFor: () => ({
    getOrganization: (slug: string) => {
      const answer = gitea.answers[Math.min(gitea.asked.length, gitea.answers.length - 1)];
      gitea.asked.push(slug);
      if (answer === "refused") return Promise.reject(new Error("no"));
      return Promise.resolve(answer === "made" ? { id: 1, username: slug } : undefined);
    },
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

/** Longer than one wait between asks, so a scheduled ask has happened. */
const PAST_ONE_RETRY = 11_000;

afterEach(() => {
  gitea.answers = [];
  gitea.asked = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderProbe(seen: Array<ReadonlyMap<string, boolean>>) {
  const { createRoot } = await import("react-dom/client");

  function Probe() {
    seen.push(
      useZeropsGroupOrganizations({
        giteaOrigin: "https://gitea.example.test",
        slugs: ["links"],
        enabled: true,
      }),
    );
    return null;
  }

  const root = createRoot(document.createElement("div") as unknown as Element);
  await act(async () => {
    root.render(<Probe />);
  });
  return root;
}

describe("useZeropsGroupOrganizations", () => {
  it("asks again until the broker has made the org, then leaves it alone", async () => {
    gitea.answers = ["not-made", "made"];
    vi.useFakeTimers();
    installTestDom();
    const seen: Array<ReadonlyMap<string, boolean>> = [];

    const root = await renderProbe(seen);
    expect(gitea.asked).toEqual(["links"]);
    expect(seen.at(-1)?.get("links")).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_ONE_RETRY);
    });
    expect(gitea.asked).toEqual(["links", "links"]);
    expect(seen.at(-1)?.get("links")).toBe(true);

    // An org that exists is not asked about again: the line is gone and there
    // is nothing left to wait for.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_ONE_RETRY * 3);
    });
    expect(gitea.asked).toEqual(["links", "links"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("asks once about a Gitea that refuses, because a refusal is not an answer", async () => {
    gitea.answers = ["refused"];
    vi.useFakeTimers();
    installTestDom();
    const seen: Array<ReadonlyMap<string, boolean>> = [];

    const root = await renderProbe(seen);
    expect(gitea.asked).toEqual(["links"]);
    expect(seen.at(-1)?.has("links")).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAST_ONE_RETRY * 3);
    });
    expect(gitea.asked).toEqual(["links"]);

    await act(async () => {
      root.unmount();
    });
  });
});
