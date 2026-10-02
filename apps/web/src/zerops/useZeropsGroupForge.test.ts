import {
  flowPullRequest,
  GiteaApiError,
  releaseInFlight,
  releaseMessage,
  type GiteaClient,
  type GiteaPullRequest,
} from "@t3tools/client-runtime/zerops";
import { flowVerbInvalidations } from "@t3tools/client-runtime/zerops/flow";
import {
  createForgeReads,
  createMergeabilityTracker,
  GATE_FRESH_MS,
  PULL_WATCH_MS,
  TAGS_MAX_AGE_MS,
  type MergeabilityTracker,
} from "@t3tools/client-runtime/zerops/forge";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  checkingRepositories,
  GROUP_FORGE_REFRESH_MS,
  UNMERGEABLE_MAX_AGE_MS,
  readForge,
  useZeropsGroupForge,
  useForgeReads,
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
  /** Whether `app` has its pull request open; its merge, in another window, closes it. */
  open: true,
  /** Every commit whose statuses were read, as `repo@sha`. */
  statusReads: [] as Array<string>,
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
            return [
              {
                name: "app",
                updated_at: gitea.open ? "2026-10-01T08:00:00Z" : "2026-10-01T08:30:00Z",
                open_pr_counter: gitea.open ? 1 : 0,
              },
            ];
          },
          listPullRequests: async (_owner: string, _repo: string, query: { state: string }) =>
            query.state === "open" && gitea.open
              ? [{ number: 7, title: "Stage follows main", head: { sha: "abc" } }]
              : [],
          listCommitStatuses: async (_owner: string, repo: string, sha: string) => {
            gitea.statusReads.push(`${repo}@${sha}`);
            return [{ context: "ci", state: "success" }];
          },
          listTags: async () => [{ name: "v0.1.0", commit: { sha: "r1" } }],
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

async function readAll(
  client: GiteaClient,
  tracker: MergeabilityTracker = createMergeabilityTracker(),
): Promise<ZeropsGroupForgeState> {
  const update = await readForge(client, "harbor", "group", tracker);
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
    const update = await readForge(client, "harbor", scope!, createMergeabilityTracker());
    expect(calls).toEqual(["pulls harbor/appdev open", "pulls harbor/appdev closed"]);

    const next = update(held);
    expect(next?.pullRequests.map((row) => row.number)).toEqual([7]);
    // The other repository's rows are the ones already held, not a new read of them.
    expect(next?.pullRequests[0]).toBe(held.pullRequests[1]);
    expect(next?.released).toBe(held.released);
  });

  it("a row's mergeability is its reads', never one false Gitea sends after a push", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.parse("2026-09-23T10:00:00Z"));
      const { client, open } = forge();
      open.set("appdev", [{ ...pull(4), mergeable: false, base: { ref: "main", sha: "b1" } }]);
      const tracker = createMergeabilityTracker();
      const first = await readAll(client, tracker);
      expect(first.pullRequests.find((row) => row.number === 4)?.mergeability).toBe("checking");
      vi.setSystemTime(Date.parse("2026-09-23T10:00:05Z"));
      const second = await readAll(client, tracker);
      expect(second.pullRequests.find((row) => row.number === 4)?.mergeability).toBe("conflicting");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed forge read keeps the last PR rows", async () => {
    const healthy = forge();
    const held = await readAll(healthy.client);
    const { client } = forge(new Set(["appdev"]));

    const update = await readForge(client, "harbor", "group", createMergeabilityTracker());
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
    const update = await readForge(client, "harbor", "group", createMergeabilityTracker());
    const state = update(undefined);
    // appdev is not among what the answer read, so nothing says it has no pull requests.
    expect(state?.repositories).toEqual(["apidev"]);
    expect(state?.pullRequests.map((row) => [row.repository, row.number])).toEqual([["apidev", 7]]);
  });

  // Live, 2026-10-02: a project made a moment ago is read at once now, before the broker has made
  // its group's org (its `404` is "not made yet", `ForgeReads.organizations`) — nothing to read
  // there, and nothing failed.
  it("reads a group whose org the broker has not made yet as nothing yet, never a failure", async () => {
    const client = {
      listOrganizationRepositories: async () => {
        throw new GiteaApiError("Gitea answered 404.", 404);
      },
    } as unknown as GiteaClient;
    const update = await readForge(client, "harbor", "group", createMergeabilityTracker());
    expect(update(undefined)).toEqual({
      repositories: [],
      pullRequests: [],
      merged: [],
      released: { releases: [], tags: [] },
    });
  });

  it("fails the read of an org it listed before that answers 404 now, keeping what it held", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
      const reads = createForgeReads();
      const { client } = forge();
      await readForge(client, "harbor", "group", createMergeabilityTracker(), reads);
      vi.advanceTimersByTime(GATE_FRESH_MS + 1);
      const gone = {
        ...client,
        listOrganizationRepositories: async () => {
          throw new GiteaApiError("Gitea answered 404.", 404);
        },
      } as unknown as GiteaClient;
      await expect(
        readForge(gone, "harbor", "group", createMergeabilityTracker(), reads),
      ).rejects.toThrow("404");
      // And on the next refresh too: the first 404 does not make it "not made yet".
      vi.advanceTimersByTime(GATE_FRESH_MS + 1);
      await expect(
        readForge(gone, "harbor", "group", createMergeabilityTracker(), reads),
      ).rejects.toThrow("404");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the pull requests, and why the releases are missing, when the tags never answered", async () => {
    const { client } = forge(new Set(["group"]));
    const update = await readForge(client, "harbor", "group", createMergeabilityTracker());
    const state = update(undefined);
    expect(state?.pullRequests.map((row) => row.number)).toEqual([4, 7]);
    expect(state?.released).toEqual({ failure: "Gitea did not answer" });
  });

  it("keeps the releases it read, and says why, when the tags do not answer again", async () => {
    const held = await readAll(forge().client);
    const update = await readForge(
      forge(new Set(["group"])).client,
      "harbor",
      "group",
      createMergeabilityTracker(),
    );
    const stale = update(held);
    expect(stale?.released).toEqual({ ...held.released, failure: "Gitea did not answer" });
    // The tags answering again is what takes the failure back.
    const again = await readForge(forge().client, "harbor", "group", createMergeabilityTracker());
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

  it("asks about a commit once however many release tags point at it", async () => {
    const SHARED = "5".repeat(40);
    const { client: base, calls } = forge();
    const client = {
      ...base,
      listOrganizationRepositories: async () => [
        { name: "group", updated_at: "2026-09-01T08:00:00Z", open_pr_counter: 0 },
      ],
      listTags: async () =>
        Array.from({ length: 30 }, (_, index) => ({
          name: `v0.1.${String(index)}`,
          commit: { sha: SHARED },
        })),
      listCommitStatuses: async (owner: string, repo: string, sha: string) => {
        calls.push(`statuses ${owner}/${repo}@${sha}`);
        return repo === "group" ? [{ context: "deploy", state: "success" }] : [];
      },
    } as unknown as GiteaClient;
    const reads = createForgeReads();
    const tracker = createMergeabilityTracker();
    await readForge(client, "harbor", "group", tracker, reads);
    await readForge(client, "harbor", "group", tracker, reads);
    expect(calls.filter((call) => call.startsWith("statuses harbor/group@"))).toEqual([
      `statuses harbor/group@${SHARED}`,
    ]);
  });

  it("reads a release's tags alone after a release", async () => {
    const { client, calls } = forge();
    const held = await readAll(client);
    calls.length = 0;
    const update = await readForge(client, "harbor", { kind: "tags" }, createMergeabilityTracker());
    expect(calls).toEqual(["tags harbor/group"]);
    expect(update(held)?.pullRequests).toBe(held.pullRequests);
  });
});

/** Long before any test: a push this old is trusted at once. */
const PUSHED = "2026-09-01T08:00:00Z";

/**
 * An org listed with what moves when something is pushed or opened, a pull request on appdev and
 * one release; every ask of Gitea recorded.
 */
function listedOrg() {
  const calls: string[] = [];
  const listed = new Map([
    ["appdev", { updated_at: PUSHED, open_pr_counter: 1 }],
    ["group", { updated_at: PUSHED, open_pr_counter: 0 }],
  ]);
  const tags = [{ name: "v0.1.0", commit: { sha: "r1" } }];
  const client = {
    listOrganizationRepositories: async () => {
      calls.push("repos");
      return [...listed].map(([name, fields]) => ({ name, default_branch: "main", ...fields }));
    },
    listPullRequests: async (_owner: string, repo: string, options: { readonly state: string }) => {
      calls.push(`pulls ${repo} ${options.state}`);
      return options.state === "open" && repo === "appdev" ? [{ ...pull(4), mergeable: true }] : [];
    },
    listCommitStatuses: async (_owner: string, repo: string, sha: string) => {
      calls.push(`statuses ${repo}@${sha}`);
      return repo === "group"
        ? tags.map((tag) => ({ context: `mate/release/${tag.name}`, state: "success" }))
        : [{ context: "ci", state: "success" }];
    },
    listTags: async () => {
      calls.push("tags");
      return tags;
    },
  } as unknown as GiteaClient;
  return { client, calls, listed, tags };
}

/**
 * Minutes of a refresh a minute after a first read, so the measured one starts with every kept
 * check between rungs of its back-off (read at 0, 1, 3 and 8) and the tags between their reads.
 */
const SETTLED_MINUTES = 9;

describe("readForge on the org's listing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { name: "nothing moved: the listing alone", move: () => undefined, asked: ["repos"] },
    {
      name: "appdev's open counter moved: its pull requests only",
      move: (listed: ReturnType<typeof listedOrg>["listed"]) =>
        listed.set("appdev", { updated_at: PUSHED, open_pr_counter: 2 }),
      asked: ["repos", "pulls appdev open", "pulls appdev closed"],
    },
    {
      name: "appdev was pushed: its pull requests and their checks",
      move: (listed: ReturnType<typeof listedOrg>["listed"]) =>
        listed.set("appdev", { updated_at: "2026-09-02T08:00:00Z", open_pr_counter: 1 }),
      asked: ["repos", "pulls appdev open", "statuses appdev@sha4", "pulls appdev closed"],
    },
    {
      name: "the group repo was pushed: its pull requests, tags and their checks",
      move: (listed: ReturnType<typeof listedOrg>["listed"]) =>
        listed.set("group", { updated_at: "2026-09-02T08:00:00Z", open_pr_counter: 0 }),
      asked: ["repos", "pulls group open", "pulls group closed", "tags", "statuses group@r1"],
    },
  ])("a refresh where $name", async ({ move, asked }) => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
    const { client, calls, listed } = listedOrg();
    const reads = createForgeReads();
    const tracker = createMergeabilityTracker();
    let first = (await readForge(client, "harbor", "group", tracker, reads))(undefined);
    for (let minute = 1; minute < SETTLED_MINUTES; minute += 1) {
      vi.advanceTimersByTime(GROUP_FORGE_REFRESH_MS);
      first = (await readForge(client, "harbor", "group", tracker, reads))(first);
    }
    calls.length = 0;
    vi.advanceTimersByTime(GROUP_FORGE_REFRESH_MS);
    move(listed);
    const next = (await readForge(client, "harbor", "group", tracker, reads))(first);
    expect(calls).toEqual(asked);
    // What the screen shows is the same answer, read or kept.
    expect(next).toEqual(first);
  });

  it("reads the tags again every five minutes, and a settled check on a back-off up to five", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
    const { client, calls } = listedOrg();
    const reads = createForgeReads();
    const tracker = createMergeabilityTracker();
    for (let minute = 0; minute < 30; minute += 1) {
      await readForge(client, "harbor", "group", tracker, reads);
      vi.advanceTimersByTime(GROUP_FORGE_REFRESH_MS);
    }
    expect(calls.filter((call) => call === "repos")).toHaveLength(30);
    expect(calls.filter((call) => call === "tags")).toHaveLength(6);
    // Minutes 0, 1, 3, 8, 13, 18, 23 and 28: a check that lands late is seen within five.
    expect(calls.filter((call) => call === "statuses appdev@sha4")).toHaveLength(8);
    expect(calls.filter((call) => call === "statuses group@r1")).toHaveLength(8);
  });

  it("asks again now and then whether a pull request Gitea says does not merge merges now", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
    const { client: base, calls } = listedOrg();
    let mergeable = false;
    const client = {
      ...base,
      listPullRequests: async (
        owner: string,
        repo: string,
        options: { readonly state: "open" | "closed" },
      ) =>
        (await base.listPullRequests(owner, repo, options)).map((open) => ({
          ...open,
          mergeable,
          base: { ref: "main", sha: "b1" },
        })),
    } as unknown as GiteaClient;
    const reads = createForgeReads();
    const tracker = createMergeabilityTracker();
    const row = async () =>
      (await readForge(client, "harbor", "group", tracker, reads))(undefined)?.pullRequests[0];
    await row();
    // The hook's rechecks after a "no": the repository's pull requests are read again.
    vi.advanceTimersByTime(10_000);
    reads.forget("harbor", "appdev", new Set(["pulls"]));
    expect((await row())?.mergeability).toBe("conflicting");
    // Gitea's check ends late: nothing was pushed, so no listing moves.
    mergeable = true;
    calls.length = 0;
    for (let minute = 1; minute < UNMERGEABLE_MAX_AGE_MS / 60_000; minute += 1) {
      vi.advanceTimersByTime(GROUP_FORGE_REFRESH_MS);
      expect((await row())?.mergeability).toBe("conflicting");
    }
    vi.advanceTimersByTime(GROUP_FORGE_REFRESH_MS);
    expect((await row())?.mergeability).toBe("mergeable");
    expect(calls.filter((call) => call === "pulls appdev open")).toHaveLength(1);
  });

  it("shows the broker's refusal that lands after the release's own re-read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
    const { client: base } = listedOrg();
    // Thirty releases of one group head: the new tag shares the old ones' commit and successes.
    const tags = [{ name: "v0.1.0", commit: { sha: "g1" } }];
    let statuses = [{ context: "mate/release/v0.1.0", state: "success" }];
    const client = {
      ...base,
      listTags: async () => tags,
      listCommitStatuses: async () => statuses,
    } as unknown as GiteaClient;
    const reads = createForgeReads();
    const tracker = createMergeabilityTracker();
    const held = (await readForge(client, "harbor", "group", tracker, reads))(undefined);
    // Release: the tag lands, and the verb re-reads the tags before the broker has judged it.
    tags.unshift({ name: "v0.1.1", commit: { sha: "g1" } });
    reads.forget("harbor", "group", new Set(["code", "statuses"]));
    const after = (await readForge(client, "harbor", { kind: "tags" }, tracker, reads))(held);
    expect("newest" in (after?.released ?? {}) ? after?.released : undefined).toMatchObject({
      newest: { tag: "v0.1.1", verdict: "unknown" },
    });
    statuses = [{ context: "mate/release/v0.1.1", state: "failure" }, ...statuses];
    vi.advanceTimersByTime(GROUP_FORGE_REFRESH_MS);
    const next = (await readForge(client, "harbor", "group", tracker, reads))(after);
    expect("newest" in (next?.released ?? {}) ? next?.released : undefined).toMatchObject({
      newest: { tag: "v0.1.1", verdict: "refused" },
    });
  });

  it.each([
    { minutes: 10, atMost: 6 },
    { minutes: 60, atMost: 16 },
  ])(
    "asks a release the broker never judges about at most $atMost times in $minutes minutes",
    async ({ minutes, atMost }) => {
      vi.useFakeTimers();
      vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
      const { client: base } = listedOrg();
      let asked = 0;
      const client = {
        ...base,
        listTags: async () => [
          { name: "v0.1.1", commit: { sha: "g1" } },
          { name: "v0.1.0", commit: { sha: "g1" } },
        ],
        listCommitStatuses: async (_owner: string, repo: string) => {
          if (repo === "group") asked += 1;
          return [{ context: "mate/release/v0.1.0", state: "success" }];
        },
      } as unknown as GiteaClient;
      const reads = createForgeReads();
      const tracker = createMergeabilityTracker();
      for (let minute = 0; minute < minutes; minute += 1) {
        await readForge(client, "harbor", "group", tracker, reads);
        vi.advanceTimersByTime(GROUP_FORGE_REFRESH_MS);
      }
      expect(asked).toBeLessThanOrEqual(atMost);
    },
  );

  it("asks a release's commit again when a new tag points at it, though nothing was pushed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
    const { client, calls, tags } = listedOrg();
    const reads = createForgeReads();
    const tracker = createMergeabilityTracker();
    for (let minute = 0; minute < SETTLED_MINUTES; minute += 1) {
      await readForge(client, "harbor", "group", tracker, reads);
      vi.advanceTimersByTime(GROUP_FORGE_REFRESH_MS);
    }
    // Another tab releases through the API: no listing moves, and the tag shares the commit.
    tags.unshift({ name: "v0.1.1", commit: { sha: "r1" } });
    calls.length = 0;
    vi.advanceTimersByTime(2 * TAGS_MAX_AGE_MS - SETTLED_MINUTES * GROUP_FORGE_REFRESH_MS);
    const state = (await readForge(client, "harbor", "group", tracker, reads))(undefined);
    expect(calls).toEqual(["repos", "tags", "statuses group@r1"]);
    expect("tags" in (state?.released ?? {}) ? state?.released : undefined).toMatchObject({
      tags: ["v0.1.1", "v0.1.0"],
    });
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
    gitea.open = true;
    gitea.statusReads = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the checks it read while a pull request is rechecked for whether it merges", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    function Probe() {
      useZeropsGroupForge({
        giteaOrigin: "https://gitea.example.test",
        groups: GROUPS,
        enabled: true,
        readable: true,
        reads: useForgeReads("https://gitea.example.test"),
      });
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gitea.statusReads).toEqual(["app@abc", "group@r1"]);
    // Gitea says "checking" after a push: the pull request is read again at 2, 5 and 10 s, and
    // nothing about any commit's checks has changed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(gitea.statusReads).toEqual(["app@abc", "group@r1"]);
    await act(async () => {
      root.unmount();
    });
  });

  it("lists an org with nothing open once a refresh, nothing while the page is hidden, and once on coming back", async () => {
    vi.useFakeTimers();
    installTestDom();
    gitea.open = false;
    const page = document as unknown as {
      hidden: boolean;
      addEventListener: (type: string, listener: () => void) => void;
    };
    const shown: Array<() => void> = [];
    page.addEventListener = (type, listener) => {
      if (type === "visibilitychange") shown.push(listener);
    };
    const { createRoot } = await import("react-dom/client");
    function Probe() {
      useZeropsGroupForge({
        giteaOrigin: "https://gitea.example.test",
        groups: GROUPS,
        enabled: true,
        readable: true,
        reads: useForgeReads("https://gitea.example.test"),
      });
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_FORGE_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);

    page.hidden = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * GROUP_FORGE_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);

    page.hidden = false;
    await act(async () => {
      for (const listener of shown) listener();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gitea.listings).toBe(3);
    await act(async () => {
      root.unmount();
    });
  });

  it("looks at an org with a pull request open every watch tick, and reads its merge in another window within one", async () => {
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
          reads: useForgeReads("https://gitea.example.test"),
        }),
      );
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gitea.listings).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_FORGE_REFRESH_MS);
    });
    // One listing a watch tick, the minute's pass answered from them.
    expect(gitea.listings).toBe(1 + GROUP_FORGE_REFRESH_MS / PULL_WATCH_MS);
    expect(seen.at(-1)?.forges.get("g1")?.pullRequests).toHaveLength(1);

    // Merged elsewhere: the next look sees the counter drop, and the answer holds nothing open.
    gitea.open = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PULL_WATCH_MS);
    });
    expect(seen.at(-1)?.forges.get("g1")?.pullRequests).toEqual([]);

    // Nothing open: back to the minute's refresh.
    const before = gitea.listings;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_FORGE_REFRESH_MS);
    });
    expect(gitea.listings - before).toBeLessThanOrEqual(1);
    await act(async () => {
      root.unmount();
    });
  });

  it("keeps what it read when a 401 and a failed reacquire land inside one pass", async () => {
    vi.useFakeTimers();
    installTestDom();
    // Nothing open: the minute's pass lists the org itself, with no watch beside it.
    gitea.open = false;
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGroupForge> = [];

    function Probe() {
      seen.push(
        useZeropsGroupForge({
          giteaOrigin: "https://gitea.example.test",
          groups: GROUPS,
          enabled: true,
          readable: true,
          reads: useForgeReads("https://gitea.example.test"),
        }),
      );
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.at(-1)?.forges.get("g1")?.released).toMatchObject({ tags: ["v0.1.0"] });

    // The clock's pass starts with a token; its first read meets the 401 and the reacquire fails.
    gitea.loseTokenOnRead = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_FORGE_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);
    expect(seen.at(-1)?.forges.get("g1")?.released).toMatchObject({ tags: ["v0.1.0"] });
    expect(seen.at(-1)?.failures.get("g1")).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps what it read when a read's 401 outlasts its wait, though the token is back by the pass's end", async () => {
    vi.useFakeTimers();
    installTestDom();
    // Nothing open: the minute's pass lists the org itself, with no watch beside it.
    gitea.open = false;
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGroupForge> = [];

    function Probe() {
      seen.push(
        useZeropsGroupForge({
          giteaOrigin: "https://gitea.example.test",
          groups: GROUPS,
          enabled: true,
          readable: true,
          reads: useForgeReads("https://gitea.example.test"),
        }),
      );
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.at(-1)?.forges.get("g1")?.released).toMatchObject({ tags: ["v0.1.0"] });

    // The listing gives up on the reacquire and answers Gitea's 401; the token lands afterwards.
    gitea.outwaitReacquireOnRead = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_FORGE_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);
    expect(seen.at(-1)?.forges.get("g1")?.released).toMatchObject({ tags: ["v0.1.0"] });
    expect(seen.at(-1)?.failures.get("g1")).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
  });
});

describe("checkingRepositories", () => {
  const open = (repository: string, number: number, mergeability: "checking" | "mergeable") =>
    flowPullRequest({ repository, pull: pull(number), checks: [], mergeability });
  const state = (pullRequests: ZeropsGroupForgeState["pullRequests"]): ZeropsGroupForgeState => ({
    repositories: [...new Set(pullRequests.map((entry) => entry.repository))],
    pullRequests,
    merged: [],
    released: { releases: [], tags: [] },
  });

  it.each([
    {
      name: "nothing checking",
      forges: [["g1", state([open("appdev", 1, "mergeable")])]],
      want: [],
    },
    {
      name: "one repository per group, however many of its changes check",
      forges: [
        ["g1", state([open("group", 13, "checking"), open("group", 14, "checking")])],
        ["g2", state([open("appdev", 2, "mergeable"), open("apidev", 3, "checking")])],
      ],
      want: ["g1\u0000group", "g2\u0000apidev"],
    },
  ] as const)("$name", ({ forges, want }) => {
    expect(checkingRepositories(new Map(forges))).toEqual(want);
  });
});
