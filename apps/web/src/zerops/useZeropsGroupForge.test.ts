import type { GiteaClient, GiteaPullRequest } from "@t3tools/client-runtime/zerops";
import { flowVerbInvalidations } from "@t3tools/client-runtime/zerops/flow";
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
 * Whether this tab can read Gitea now, how often the org's repositories were listed, whether the
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
          listOrganizationRepositories: async () => {
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
            return [{ name: "app" }];
          },
          listPullRequests: async (_owner: string, _repo: string, query: { state: string }) =>
            query.state === "open"
              ? [{ number: 7, title: "Stage follows main", head: { sha: "abc" } }]
              : [],
          listCommitStatuses: async () => [],
          listTags: async () => [],
        }
      : null,
}));

const pull = (number: number, merged = false): GiteaPullRequest => ({
  number,
  title: `Change ${number}`,
  state: merged ? "closed" : "open",
  merged,
  head: { ref: `mate/p${number}`, sha: `sha${number}` },
});

/**
 * A Gitea org with two code repositories; every call is recorded, and a
 * repository — or the group repo's tags, as `group` — can refuse.
 */
function forge(refusing: ReadonlySet<string> = new Set()) {
  const calls: string[] = [];
  const open = new Map([
    ["appdev", [pull(4)]],
    ["apidev", [pull(7)]],
  ]);
  const client = {
    listOrganizationRepositories: async (org: string) => {
      calls.push(`repos ${org}`);
      return [{ name: "appdev" }, { name: "apidev" }];
    },
    listPullRequests: async (
      owner: string,
      repo: string,
      options: { readonly state: "open" | "closed" },
    ) => {
      calls.push(`pulls ${owner}/${repo} ${options.state}`);
      if (refusing.has(repo)) throw new Error("Gitea did not answer");
      return options.state === "open" ? (open.get(repo) ?? []) : [pull(1, true)];
    },
    listCommitStatuses: async (owner: string, repo: string, sha: string) => {
      calls.push(`statuses ${owner}/${repo}@${sha}`);
      return [];
    },
    listTags: async (owner: string, repo: string) => {
      calls.push(`tags ${owner}/${repo}`);
      if (refusing.has(repo)) throw new Error("Gitea did not answer");
      return [];
    },
  } as unknown as GiteaClient;
  return { client, calls, open };
}

async function readAll(client: GiteaClient): Promise<ZeropsGroupForgeState> {
  const update = await readForge(client, "harbor", "group");
  const state = update(undefined);
  if (state === undefined) throw new Error("the first read answered nothing");
  return state;
}

describe("readForge", () => {
  it("Merge re-reads only that repo", async () => {
    const { client, calls, open } = forge();
    const held = await readAll(client);
    calls.length = 0;
    open.set("appdev", []);

    const { forge: scope } = flowVerbInvalidations({
      kind: "merge",
      slug: "harbor",
      repository: "appdev",
      number: 4,
    });
    const update = await readForge(client, "harbor", scope!);
    expect(calls).toEqual(["pulls harbor/appdev open", "pulls harbor/appdev closed"]);

    const next = update(held);
    expect(next?.pullRequests.map((row) => row.number)).toEqual([7]);
    // The other repository's rows are the ones already held, not a new read of them.
    expect(next?.pullRequests[0]).toBe(held.pullRequests[1]);
    expect(next?.released).toBe(held.released);
  });

  it("a failed forge read keeps the last PR rows", async () => {
    const healthy = forge();
    const held = await readAll(healthy.client);
    const { client } = forge(new Set(["appdev"]));

    const update = await readForge(client, "harbor", "group");
    const next = update(held);
    // appdev did not answer: its row stays; apidev answered and is read afresh.
    expect(next?.pullRequests.map((row) => [row.repository, row.number])).toEqual([
      ["appdev", 4],
      ["apidev", 7],
    ]);
    expect(next?.pullRequests[0]).toBe(held.pullRequests[0]);
  });

  it("shows the repositories that answered, and holds only them, while another never has", async () => {
    const { client } = forge(new Set(["appdev"]));
    const update = await readForge(client, "harbor", "group");
    const state = update(undefined);
    // appdev is not among what the answer read, so nothing says it has no pull requests.
    expect(state?.repositories).toEqual(["apidev"]);
    expect(state?.pullRequests.map((row) => [row.repository, row.number])).toEqual([["apidev", 7]]);
  });

  it("shows the pull requests, and why the releases are missing, when the tags never answered", async () => {
    const { client } = forge(new Set(["group"]));
    const update = await readForge(client, "harbor", "group");
    const state = update(undefined);
    expect(state?.pullRequests.map((row) => row.number)).toEqual([4, 7]);
    expect(state?.released).toEqual({ failure: "Gitea did not answer" });
  });

  it("keeps the releases it read, and says why, when the tags do not answer again", async () => {
    const held = await readAll(forge().client);
    const update = await readForge(forge(new Set(["group"])).client, "harbor", "group");
    const stale = update(held);
    expect(stale?.released).toEqual({ ...held.released, failure: "Gitea did not answer" });
    // The tags answering again is what takes the failure back.
    const again = await readForge(forge().client, "harbor", "group");
    expect(again(stale)?.released).toEqual(held.released);
  });

  it("reads a release's tags alone after a release", async () => {
    const { client, calls } = forge();
    const held = await readAll(client);
    calls.length = 0;
    const update = await readForge(client, "harbor", { kind: "tags" });
    expect(calls).toEqual(["tags harbor/group"]);
    expect(update(held)?.pullRequests).toBe(held.pullRequests);
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
    expect(seen.at(-1)?.forges.get("g1")?.pullRequests).toHaveLength(1);

    // The clock's pass starts with a token; its first read meets the 401 and the reacquire fails.
    gitea.loseTokenOnRead = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_FORGE_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);
    expect(seen.at(-1)?.forges.get("g1")?.pullRequests).toHaveLength(1);
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
    expect(seen.at(-1)?.forges.get("g1")?.pullRequests).toHaveLength(1);

    // The listing gives up on the reacquire and answers Gitea's 401; the token lands afterwards.
    gitea.outwaitReacquireOnRead = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_FORGE_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);
    expect(seen.at(-1)?.forges.get("g1")?.pullRequests).toHaveLength(1);
    expect(seen.at(-1)?.failures.get("g1")).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
  });
});
