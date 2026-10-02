import { releaseInFlight, releaseMessage, type GiteaClient } from "@t3tools/client-runtime/zerops";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  GROUP_FORGE_REFRESH_MS,
  readForge,
  useZeropsGroupForge,
  type ZeropsGroupForge,
  type ZeropsGroupForgeState,
} from "./useZeropsGroupForge";

/**
 * Whether this tab can read Gitea now, how often the group repo's tags were listed, whether the
 * next listing meets a 401 whose reacquire fails — the session loses its token mid-pass — and
 * whether it meets a 401 that outlasts the request's wait while the reacquire goes on to succeed.
 */
const gitea = vi.hoisted(() => ({
  readable: true,
  listings: 0,
  loseTokenOnRead: false,
  outwaitReacquireOnRead: false,
}));

vi.mock("./accountGiteaSessions", () => ({
  giteaClientFor: (_origin: string, onUnauthorized?: () => void) =>
    gitea.readable
      ? {
          listTags: async () => {
            gitea.listings += 1;
            if (gitea.loseTokenOnRead) {
              gitea.readable = false;
              onUnauthorized?.();
              throw new Error("You are not signed in to Gitea.");
            }
            if (gitea.outwaitReacquireOnRead) {
              gitea.outwaitReacquireOnRead = false;
              onUnauthorized?.();
              throw new Error("Gitea answered 401.");
            }
            return [];
          },
          listCommitStatuses: async () => [],
        }
      : null,
}));

/** A group repo whose every call is recorded; its tags can refuse. */
function forge(refusing = false) {
  const calls: string[] = [];
  const client = {
    listCommitStatuses: async (owner: string, repo: string, sha: string) => {
      calls.push(`statuses ${owner}/${repo}@${sha}`);
      return [];
    },
    listTags: async (owner: string, repo: string) => {
      calls.push(`tags ${owner}/${repo}`);
      if (refusing) throw new Error("Gitea did not answer");
      return [];
    },
  } as unknown as GiteaClient;
  return { client, calls };
}

async function readAll(client: GiteaClient): Promise<ZeropsGroupForgeState> {
  const update = await readForge(client, "harbor", "group");
  const state = update(undefined);
  if (state === undefined) throw new Error("the first read answered nothing");
  return state;
}

describe("readForge", () => {
  it("says why the releases are missing when the tags never answered", async () => {
    const update = await readForge(forge(true).client, "harbor", "group");
    expect(update(undefined)?.released).toEqual({ failure: "Gitea did not answer" });
  });

  it("keeps the releases it read, and says why, when the tags do not answer again", async () => {
    const held = await readAll(forge().client);
    const update = await readForge(forge(true).client, "harbor", "group");
    const stale = update(held);
    expect(stale?.released).toEqual({ ...held.released, failure: "Gitea did not answer" });
    // The tags answering again is what takes the failure back.
    const again = await readForge(forge().client, "harbor", "group");
    expect(again(stale)?.released).toEqual(held.released);
  });

  it("a failed tag-date read keeps Release available", async () => {
    const MERGED = "2".repeat(40);
    const client = {
      ...forge().client,
      listTags: async () => [
        {
          name: "v0.1.1",
          id: "t1",
          message: releaseMessage([{ service: "app", commit: MERGED }]),
          commit: { sha: "c1" },
        },
      ],
      tagDate: async () => {
        throw new Error("Gitea did not answer");
      },
    } as unknown as GiteaClient;
    const state = await readAll(client);
    expect(state.released).not.toHaveProperty("failure");
    const newest = "newest" in state.released ? state.released.newest : undefined;
    expect(newest).toMatchObject({ tag: "v0.1.1", taggedAt: undefined });
    expect(
      releaseInFlight({ newest, production: new Map(), failed: new Map(), nowMs: Date.now() }),
    ).toBeUndefined();
  });

  it("carries what every release lists, and when the newest alone was tagged", async () => {
    const NEW = "3".repeat(40);
    const OLD = "4".repeat(40);
    const dated: Array<string> = [];
    const client = {
      ...forge().client,
      listTags: async () => [
        {
          name: "v0.1.1",
          id: "t1",
          message: releaseMessage([{ service: "app", commit: OLD }]),
          commit: { sha: "c1" },
        },
        {
          name: "v0.1.2",
          id: "t2",
          message: releaseMessage([{ service: "app", commit: NEW }]),
          commit: { sha: "c2" },
        },
      ],
      tagDate: async (_owner: string, _repo: string, id: string) => {
        dated.push(id);
        return "2026-09-25T07:00:00Z";
      },
    } as unknown as GiteaClient;
    const state = await readAll(client);
    const releases = "releases" in state.released ? state.released.releases : [];
    expect(releases).toMatchObject([
      {
        tag: "v0.1.2",
        entries: [{ service: "app", commit: NEW }],
        taggedAt: "2026-09-25T07:00:00Z",
      },
      { tag: "v0.1.1", entries: [{ service: "app", commit: OLD }], taggedAt: undefined },
    ]);
    // The newest's date is read once, for its row and for what `releaseInFlight` reads alike.
    expect(dated).toEqual(["t2"]);
    expect("newest" in state.released ? state.released.newest?.taggedAt : undefined).toBe(
      "2026-09-25T07:00:00Z",
    );
  });

  it("reads a release's tags alone after a release", async () => {
    const { client, calls } = forge();
    const held = await readAll(client);
    calls.length = 0;
    const update = await readForge(client, "harbor", { kind: "tags" });
    expect(calls).toEqual(["tags harbor/group"]);
    expect(update(held)?.released).toEqual(held.released);
  });
});

const GROUPS = [{ groupId: "g1", slug: "harbor" }] as const;

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

describe("useZeropsGroupForge", () => {
  afterEach(() => {
    gitea.readable = true;
    gitea.listings = 0;
    gitea.loseTokenOnRead = false;
    gitea.outwaitReacquireOnRead = false;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps what it read when a 401 and a failed reacquire land inside one pass", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGroupForge> = [];

    function Probe() {
      seen.push(
        useZeropsGroupForge({
          giteaOrigin: "https://gitea.example.test",
          groups: GROUPS,
          enabled: true,
          readable: true,
        }),
      );
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.at(-1)?.forges.get("g1")?.released).toEqual({ releases: [], tags: [] });

    // The clock's pass starts with a token; its first read meets the 401 and the reacquire fails.
    gitea.loseTokenOnRead = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_FORGE_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);
    expect(seen.at(-1)?.forges.get("g1")?.released).toEqual({ releases: [], tags: [] });
    expect(seen.at(-1)?.failures.get("g1")).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps what it read when a read's 401 outlasts its wait, though the token is back by the pass's end", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGroupForge> = [];

    function Probe() {
      seen.push(
        useZeropsGroupForge({
          giteaOrigin: "https://gitea.example.test",
          groups: GROUPS,
          enabled: true,
          readable: true,
        }),
      );
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.at(-1)?.forges.get("g1")?.released).toEqual({ releases: [], tags: [] });

    // The listing gives up on the reacquire and answers Gitea's 401; the token lands afterwards.
    gitea.outwaitReacquireOnRead = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_FORGE_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);
    expect(seen.at(-1)?.forges.get("g1")?.released).toEqual({ releases: [], tags: [] });
    expect(seen.at(-1)?.failures.get("g1")).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
  });
});
