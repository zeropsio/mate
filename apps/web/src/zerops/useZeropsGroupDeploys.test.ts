import {
  buildGroupEnvironmentRows,
  GiteaApiError,
  type GiteaClient,
} from "@t3tools/client-runtime/zerops";
import { createGroupAnswers, flowVerbInvalidations } from "@t3tools/client-runtime/zerops/flow";
import { createForgeReads, GATE_FRESH_MS } from "@t3tools/client-runtime/zerops/forge";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  deployGroupKey,
  GROUP_DEPLOYS_REFRESH_MS,
  readGroupDeploys,
  useZeropsGroupDeploys,
  type ZeropsDeployGroup,
  type ZeropsGroupDeployAnswers,
  type ZeropsGroupDeployState,
} from "./useZeropsGroupDeploys";
import { useForgeReads, useZeropsGroupForge, type ZeropsGroupForge } from "./useZeropsGroupForge";

/**
 * Whether this tab holds a Gitea token now, how often the org was listed and the group repo's
 * pulls were read, whether the next listing — every pass's first read — meets a 401 whose
 * reacquire fails — the session loses its token mid-pass — and whether it meets a 401 that
 * outlasts the request's wait while the reacquire goes on to succeed. A client handed out earlier
 * answers 401 once the token is gone.
 */
const gitea = vi.hoisted(() => ({
  readable: true,
  listings: 0,
  pullReads: 0,
  statusReads: 0,
  /** The group repo declares a stage, so what it runs is read. */
  declares: false,
  loseTokenOnRead: false,
  outwaitReacquireOnRead: false,
  /** The next listing answers Gitea's 401 to whichever pass's client sends it. */
  listingRefusedOnce: false,
}));

vi.mock("./accountGiteaSessions", () => ({
  giteaClientFor: (_origin: string, onUnauthorized?: () => void) => {
    if (!gitea.readable) return null;
    const refuse = () => {
      onUnauthorized?.();
      return Promise.reject(new Error("Gitea answered 401."));
    };
    return {
      listOrganizationRepositories: async () => {
        if (!gitea.readable) return refuse();
        gitea.listings += 1;
        if (gitea.loseTokenOnRead) {
          gitea.readable = false;
          onUnauthorized?.();
          throw new Error("You are not signed in to Gitea.");
        }
        if (gitea.outwaitReacquireOnRead) {
          gitea.outwaitReacquireOnRead = false;
          return refuse();
        }
        if (gitea.listingRefusedOnce) {
          gitea.listingRefusedOnce = false;
          onUnauthorized?.();
          throw new GiteaApiError("You are not signed in to Gitea.", 401);
        }
        return LISTED;
      },
      listDirectory: async () =>
        gitea.readable ? (gitea.declares ? ["environments.yaml"] : undefined) : refuse(),
      readFile: async (_owner: string, _repo: string, path: string) =>
        gitea.readable
          ? gitea.declares && path === "environments.yaml"
            ? { content: DECLARED_STAGE }
            : undefined
          : refuse(),
      listPullRequests: async () => {
        if (!gitea.readable) return refuse();
        gitea.pullReads += 1;
        return [{ number: 7, title: "Stage follows main" }];
      },
      listCommitStatuses: async () => {
        if (!gitea.readable) return refuse();
        gitea.statusReads += 1;
        return [{ context: "deploy", state: "success" }];
      },
      getBranch: async () => (gitea.readable ? undefined : refuse()),
      listTags: async () => (gitea.readable ? [] : refuse()),
    };
  },
}));

const SHA = "3f9c1b2000000000000000000000000000000000";

/** The org's listing: two repositories nobody pushed to since long before the test. */
const LISTED = [
  { name: "group", updated_at: "2026-09-01T08:00:00Z", open_pr_counter: 1 },
  { name: "app", updated_at: "2026-09-01T08:00:00Z", open_pr_counter: 0 },
];

const DECLARED_STAGE = `version: 1
environments:
  stage:
    tier: stage
    project: p-stage
    sources: [main]
    deploy: on-push
`;

const GROUP: ZeropsDeployGroup = {
  groupId: "g1",
  slug: "harbor",
  projects: [
    {
      projectId: "p-stage",
      name: "Harbor - stage",
      services: [{ serviceId: "s1", hostname: "app" }],
    },
  ],
};

const NEIGHBOUR: ZeropsDeployGroup = {
  groupId: "g2",
  slug: "links",
  projects: [{ projectId: "p-links", name: "Links - stage", services: [] }],
};

describe("deployGroupKey", () => {
  it("is stable while nothing the group's reads depend on has changed", () => {
    expect(deployGroupKey(GROUP)).toBe(deployGroupKey({ ...GROUP }));
  });

  it("moves when a project's role appears, which is what fills a tier", () => {
    const withRole: ZeropsDeployGroup = {
      ...GROUP,
      projects: [{ ...GROUP.projects[0]!, role: "stage" }],
    };
    expect(deployGroupKey(withRole)).not.toBe(deployGroupKey(GROUP));
  });

  it("moves when the platform pushes a new active deploy, so the version is read again", () => {
    const running = (activeDeploy: string): ZeropsDeployGroup => ({
      ...GROUP,
      projects: [
        {
          ...GROUP.projects[0]!,
          services: [{ serviceId: "s1", hostname: "app", activeDeploy }],
        },
      ],
    });
    const before = running("2026-09-20T10:00:00Z v1.4.0");
    expect(deployGroupKey(before)).toBe(deployGroupKey(running("2026-09-20T10:00:00Z v1.4.0")));
    expect(deployGroupKey(running("2026-09-21T08:00:00Z v1.5.0"))).not.toBe(deployGroupKey(before));
  });

  it("Key change creates a fact; neighbours unchanged", async () => {
    const reads: string[] = [];
    const published: string[] = [];
    const answers = createGroupAnswers<ZeropsDeployGroup, never, string>({
      pass: "deploys",
      idOf: (group) => group.groupId,
      keyOf: deployGroupKey,
      read: async (group) => {
        reads.push(group.groupId);
        return () => `${group.groupId}@${reads.length}`;
      },
      publish: (groupId) => {
        published.push(groupId);
      },
      forget: () => {},
      failure: () => {},
    });
    answers.setGroups([GROUP, NEIGHBOUR]);
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    // One project of the group resolves its services: the group is read again
    // on its own, and its neighbour is neither read nor published again.
    answers.setGroups([
      { ...GROUP, projects: [{ ...GROUP.projects[0]!, role: "stage" }] },
      NEIGHBOUR,
    ]);
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    expect(reads).toEqual(["g1", "g2", "g1"]);
    expect(published).toEqual(["g1", "g2", "g1"]);
    answers.dispose();
  });
});

/** The group repo declares one stage; the version read is the caller's. */
function groupRepo() {
  return {
    listOrganizationRepositories: async () => LISTED,
    listDirectory: async () => ["environments.yaml", "README.md"],
    readFile: async (_owner: string, _repo: string, path: string) =>
      path === "environments.yaml"
        ? {
            content: `version: 1
environments:
  stage:
    tier: stage
    project: p-stage
    sources: [main]
    deploy: on-push
`,
          }
        : undefined,
    listPullRequests: async () => [],
    listCommitStatuses: async () => [],
    getBranch: async () => undefined,
  } as unknown as GiteaClient;
}

describe("readGroupDeploys", () => {
  it("Merge re-reads only that repository's main on the deploy side", async () => {
    const calls: string[] = [];
    const client = {
      getBranch: async (owner: string, repo: string, branch: string) => {
        calls.push(`branch ${owner}/${repo} ${branch}`);
        return { commit: { id: "c0ffee0000000000000000000000000000000000" } };
      },
      commitDetail: async (owner: string, repo: string, sha: string) => {
        calls.push(`commit ${owner}/${repo}@${sha.slice(0, 7)}`);
        return { sha, subject: "Add the cart" };
      },
      compareCommits: async () => {
        calls.push("compare");
        return [];
      },
    } as unknown as GiteaClient;
    const apiContents = { service: "api", commits: [{ sha: "a1", subject: "Earlier" }] };
    const held: ZeropsGroupDeployState = {
      declarations: [],
      environments: [],
      groupHead: undefined,
      pullRequests: [],
      missing: [],
      mainHeadRepositories: new Map([
        ["app", "appdev"],
        ["api", "apidev"],
      ]),
      mainHeads: new Map([
        ["app", SHA],
        ["api", "a1"],
      ]),
      releaseContents: [
        { service: "app", commits: [{ sha: SHA, subject: "Before the merge" }] },
        apiContents,
      ],
    };
    const update = await readGroupDeploys({
      client,
      group: GROUP,
      scope: { kind: "main-head", repository: "appdev" },
      readVersion: () => Promise.reject(new Error("not read on a merge")),
      held,
      signal: new AbortController().signal,
    });
    expect(calls).toEqual(["branch harbor/appdev main", "commit harbor/appdev@c0ffee0"]);
    const next = update(held);
    expect(next?.mainHeads).toEqual(
      new Map([
        ["app", "c0ffee0000000000000000000000000000000000"],
        ["api", "a1"],
      ]),
    );
    // The other repository's release contents are the ones already held.
    expect(next?.releaseContents).toEqual([
      {
        service: "app",
        commits: [{ sha: "c0ffee0000000000000000000000000000000000", subject: "Add the cart" }],
      },
      apiContents,
    ]);
    expect(next?.releaseContents[1]).toBe(apiContents);
    expect(next?.environments).toBe(held.environments);
  });

  it("a merge into the group repo reads its declarations again", async () => {
    const read: string[] = [];
    const repo = groupRepo();
    const client = {
      ...repo,
      readFile: (owner: string, repository: string, path: string, ref: string) => {
        read.push(`${repository}/${path}@${ref}`);
        return repo.readFile(owner, repository, path, ref);
      },
    } as unknown as GiteaClient;
    const held: ZeropsGroupDeployState = {
      declarations: [],
      environments: [],
      groupHead: undefined,
      pullRequests: [],
      missing: [],
      mainHeadRepositories: new Map([["app", "appdev"]]),
      mainHeads: new Map(),
      releaseContents: [],
    };
    const { deploys } = flowVerbInvalidations({
      kind: "merge",
      slug: "harbor",
      repository: "group",
      number: 2,
    });
    if (deploys === null) throw new Error("a recipe merge changes the deploy half");
    const update = await readGroupDeploys({
      client,
      group: GROUP,
      scope: deploys,
      readVersion: async () => SHA,
      held,
      signal: new AbortController().signal,
    });
    expect(read).toContain("group/environments.yaml@main");
    expect(update(held)?.declarations.map((declaration) => declaration.name)).toEqual(["stage"]);
  });

  it("a group whose main has no environments.yaml never asks for it: no 404 on every load", async () => {
    const read: string[] = [];
    const repo = groupRepo();
    const client = {
      ...repo,
      listDirectory: async (_owner: string, repository: string, path: string, ref: string) => {
        read.push(`list ${repository}/${path}@${ref}`);
        return ["README.md", "3 — Stage"];
      },
      readFile: (owner: string, repository: string, path: string, ref: string) => {
        read.push(`${repository}/${path}@${ref}`);
        return repo.readFile(owner, repository, path, ref);
      },
    } as unknown as GiteaClient;
    const held: ZeropsGroupDeployState = {
      declarations: [],
      environments: [],
      groupHead: undefined,
      pullRequests: [],
      missing: [],
      mainHeadRepositories: new Map([["app", "appdev"]]),
      mainHeads: new Map(),
      releaseContents: [],
    };
    const { deploys } = flowVerbInvalidations({
      kind: "merge",
      slug: "harbor",
      repository: "group",
      number: 2,
    });
    if (deploys === null) throw new Error("a recipe merge changes the deploy half");
    const update = await readGroupDeploys({
      client,
      group: GROUP,
      scope: deploys,
      readVersion: async () => SHA,
      held,
      signal: new AbortController().signal,
    });
    expect(read).toContain("list group/@main");
    expect(read).not.toContain("group/environments.yaml@main");
    expect(update(held)?.declarations).toEqual([]);
  });

  it("asks about a settled deploy's checks once across reads inside a minute", async () => {
    const asked: string[] = [];
    const client = {
      ...groupRepo(),
      listCommitStatuses: async (owner: string, repo: string, sha: string) => {
        asked.push(`${owner}/${repo}@${sha}`);
        return [{ context: "deploy", state: "success" }];
      },
    } as unknown as GiteaClient;
    const reads = createForgeReads();
    for (let pass = 0; pass < 3; pass += 1) {
      await readGroupDeploys({
        client,
        group: GROUP,
        scope: "group",
        readVersion: async () => SHA,
        held: undefined,
        signal: new AbortController().signal,
        reads,
      });
    }
    expect(asked).toEqual([`harbor/app@${SHA}`]);
  });

  it("keeps the version the group last read when reading it again fails", async () => {
    const client = groupRepo();
    const first = await readGroupDeploys({
      client,
      group: GROUP,
      scope: "group",
      readVersion: async () => SHA,
      held: undefined,
      signal: new AbortController().signal,
    });
    const held = first(undefined) as ZeropsGroupDeployState;
    expect(held.environments[0]?.services[0]?.appVersionName).toBe(SHA);

    const again = await readGroupDeploys({
      client,
      group: GROUP,
      scope: "group",
      readVersion: () => Promise.reject(new Error("the platform refused the read")),
      held,
      signal: new AbortController().signal,
    });
    expect(again(held)?.environments[0]?.services[0]?.appVersionName).toBe(SHA);
  });

  it("asks what each of an environment's services runs at once, so they are read together", async () => {
    let inFlight = 0;
    let most = 0;
    const update = await readGroupDeploys({
      client: groupRepo(),
      group: {
        ...GROUP,
        projects: [
          {
            projectId: "p-stage",
            name: "Harbor - stage",
            services: ["app", "api", "web"].map((hostname) => ({
              serviceId: `s-${hostname}`,
              hostname,
            })),
          },
        ],
      },
      scope: "group",
      readVersion: async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return SHA;
      },
      held: undefined,
      signal: new AbortController().signal,
    });

    expect(most).toBe(3);
    expect(
      update(undefined)?.environments[0]?.services.map((service) => service.appVersionName),
    ).toEqual([SHA, SHA, SHA]);
  });

  it("answers that a group repo declaring nothing declares nothing, from its first read", async () => {
    const client = { ...groupRepo(), readFile: async () => undefined } as unknown as GiteaClient;
    const update = await readGroupDeploys({
      client,
      group: GROUP,
      scope: "group",
      readVersion: async () => SHA,
      held: undefined,
      signal: new AbortController().signal,
    });
    expect(update(undefined)).toMatchObject({ declarations: [], environments: [], missing: [] });
  });

  it("fails the group's read when the group repo does not answer, rather than declaring nothing", async () => {
    const client = {
      ...groupRepo(),
      readFile: () => Promise.reject(new Error("Gitea did not answer")),
    } as unknown as GiteaClient;
    await expect(
      readGroupDeploys({
        client,
        group: GROUP,
        scope: "group",
        readVersion: async () => SHA,
        held: undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Gitea did not answer");
  });
});

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

/** Long before any test: a push this old is trusted at once. */
const PUSHED = "2026-09-01T08:00:00Z";

/** The group repo of {@link groupRepo}, listed with what moves on a push; every ask recorded. */
function listedGroupRepo() {
  const calls: string[] = [];
  const listed = new Map([
    ["group", { updated_at: PUSHED, open_pr_counter: 0 }],
    ["app", { updated_at: PUSHED, open_pr_counter: 0 }],
  ]);
  const repo = groupRepo();
  const client = {
    listOrganizationRepositories: async () => {
      calls.push("repos");
      return [...listed].map(([name, fields]) => ({ name, default_branch: "main", ...fields }));
    },
    listDirectory: async (owner: string, name: string, path: string, ref: string) => {
      calls.push(`list ${name}/${path}`);
      return repo.listDirectory(owner, name, path, ref);
    },
    readFile: async (owner: string, name: string, path: string, ref: string) => {
      calls.push(`read ${name}/${path}`);
      return repo.readFile(owner, name, path, ref);
    },
    listPullRequests: async (_owner: string, name: string) => {
      calls.push(`pulls ${name}`);
      return [];
    },
    getBranch: async (_owner: string, name: string, branch: string) => {
      calls.push(`branch ${name}/${branch}`);
      return undefined;
    },
    listCommitStatuses: async (_owner: string, name: string, sha: string) => {
      calls.push(`statuses ${name}@${sha.slice(0, 7)}`);
      return [{ context: "deploy", state: "success" }];
    },
  } as unknown as GiteaClient;
  return { client, calls, listed };
}

const GROUP_REPO_READ = [
  "list group/",
  "read group/environments.yaml",
  "pulls group",
  "read group/3 — Stage/import.yaml",
  "read group/4 — Small Production/import.yaml",
  "branch group/main",
];

describe("readGroupDeploys on the org's listing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  type Listed = ReturnType<typeof listedGroupRepo>["listed"];

  it.each([
    { name: "nothing moved: the listing alone", move: () => undefined, asked: ["repos"] },
    {
      name: "a pull request opened on the group repo: its pull requests only",
      move: (listed: Listed) => listed.set("group", { updated_at: PUSHED, open_pr_counter: 1 }),
      asked: ["repos", "pulls group"],
    },
    {
      name: "the group repo was pushed: what it declares, its pull requests and its head",
      move: (listed: Listed) =>
        listed.set("group", { updated_at: "2026-09-02T08:00:00Z", open_pr_counter: 0 }),
      asked: ["repos", ...GROUP_REPO_READ],
    },
    {
      name: "app was pushed: its deploy's checks",
      move: (listed: Listed) =>
        listed.set("app", { updated_at: "2026-09-02T08:00:00Z", open_pr_counter: 0 }),
      asked: ["repos", "statuses app@3f9c1b2"],
    },
  ])("a refresh where $name", async ({ move, asked }) => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
    const { client, calls, listed } = listedGroupRepo();
    const reads = createForgeReads();
    const read = async (held: ZeropsGroupDeployState | undefined) =>
      (
        await readGroupDeploys({
          client,
          group: GROUP,
          scope: "group",
          readVersion: async () => SHA,
          held,
          signal: new AbortController().signal,
          reads,
        })
      )(held);
    let first = await read(undefined);
    expect(calls).toEqual(["repos", ...GROUP_REPO_READ, "statuses app@3f9c1b2"]);
    // A refresh a minute until the deploy's checks are between rungs of their back-off (0, 1, 3, 8).
    for (let minute = 1; minute < 9; minute += 1) {
      vi.advanceTimersByTime(GROUP_DEPLOYS_REFRESH_MS);
      first = await read(first);
    }
    calls.length = 0;
    vi.advanceTimersByTime(GROUP_DEPLOYS_REFRESH_MS);
    move(listed);
    const next = await read(first);
    expect(calls).toEqual(asked);
    // What the screen shows is the same answer, read or kept.
    expect(next).toEqual(first);
  });
});

describe("a listing that does not answer", () => {
  it("leaves the deploy half reading the group repo itself, as it did before the listing", async () => {
    const { client: base, calls } = listedGroupRepo();
    const client = {
      ...base,
      listOrganizationRepositories: async () => {
        calls.push("repos");
        throw new GiteaApiError("Gitea answered 500.", 500);
      },
    } as unknown as GiteaClient;
    const update = await readGroupDeploys({
      client,
      group: GROUP,
      scope: "group",
      readVersion: async () => SHA,
      held: undefined,
      signal: new AbortController().signal,
      reads: createForgeReads(),
    });
    expect(calls).toEqual(["repos", ...GROUP_REPO_READ, "statuses app@3f9c1b2"]);
    expect(update(undefined)?.declarations.map((declaration) => declaration.name)).toEqual([
      "stage",
    ]);
  });
});

// Live, 2026-10-02 (pass 32 review): a project made a moment ago is read at once, before the
// broker has made its group's org — there is no group repo to read yet, and nothing failed.
describe("a group whose org the broker has not made yet", () => {
  it("declares nothing and asks nothing more than the listing", async () => {
    const { client: base, calls } = listedGroupRepo();
    const client = {
      ...base,
      listOrganizationRepositories: async () => {
        calls.push("repos");
        throw new GiteaApiError("Gitea answered 404.", 404);
      },
    } as unknown as GiteaClient;
    const update = await readGroupDeploys({
      client,
      group: GROUP,
      scope: "group",
      readVersion: async () => SHA,
      held: undefined,
      signal: new AbortController().signal,
      reads: createForgeReads(),
    });
    expect(calls).toEqual(["repos"]);
    expect(update(undefined)?.declarations).toEqual([]);
  });
});

describe("a late check on a deploy's commit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is seen within five minutes, though nothing was pushed and nothing deployed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
    const { client: base } = listedGroupRepo();
    let statuses = [{ context: "ci", state: "success" }];
    const client = { ...base, listCommitStatuses: async () => statuses } as unknown as GiteaClient;
    const reads = createForgeReads();
    let held: ZeropsGroupDeployState | undefined;
    const read = async () => {
      held = (
        await readGroupDeploys({
          client,
          group: GROUP,
          scope: "group",
          readVersion: async () => SHA,
          held,
          signal: new AbortController().signal,
          reads,
        })
      )(held);
      return held?.environments[0]?.services[0];
    };
    await read();
    for (let minute = 0; minute < 10; minute += 1) {
      vi.advanceTimersByTime(GROUP_DEPLOYS_REFRESH_MS);
      await read();
    }
    // A failed deploy posts to the commit long after its checks settled.
    statuses = [{ context: "deploy", state: "failure" }, ...statuses];
    vi.advanceTimersByTime(5 * GROUP_DEPLOYS_REFRESH_MS);
    const service = await read();
    expect(JSON.stringify(service)).toContain("failure");
  });
});

describe("useZeropsGroupDeploys", () => {
  afterEach(() => {
    gitea.readable = true;
    gitea.listings = 0;
    gitea.listingRefusedOnce = false;
    gitea.pullReads = 0;
    gitea.statusReads = 0;
    gitea.declares = false;
    gitea.loseTokenOnRead = false;
    gitea.outwaitReacquireOnRead = false;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks about a running commit again at once when the platform pushes a new deploy", async () => {
    vi.useFakeTimers();
    installTestDom();
    gitea.declares = true;
    const { createRoot } = await import("react-dom/client");
    const running = (activeDeploy: string): ReadonlyArray<ZeropsDeployGroup> => [
      {
        ...GROUP,
        projects: [
          { ...GROUP.projects[0]!, services: [{ serviceId: "s1", hostname: "app", activeDeploy }] },
        ],
      },
    ];
    const readVersion = async () => SHA;
    function Probe({ groups }: { readonly groups: ReadonlyArray<ZeropsDeployGroup> }) {
      useZeropsGroupDeploys({
        groups,
        giteaOrigin: "https://gitea.example.test",
        readVersion,
        enabled: true,
        readable: true,
        reads: useForgeReads("https://gitea.example.test"),
      });
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { groups: running("d1") }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(gitea.statusReads).toBe(1);
    // Production took the stage's commit: same sha, a status of its own on its way.
    await act(async () => {
      root.render(createElement(Probe, { groups: running("d2") }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gitea.statusReads).toBe(2);
    await act(async () => {
      root.unmount();
    });
  });

  it("keeps what it read while the Gitea session has no token to read with", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGroupDeployAnswers> = [];
    const groups: ReadonlyArray<ZeropsDeployGroup> = [
      { groupId: "g1", slug: "harbor", projects: [] },
    ];
    const readVersion = async () => undefined;

    function Probe() {
      seen.push(
        useZeropsGroupDeploys({
          groups,
          giteaOrigin: "https://gitea.example.test",
          readVersion,
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
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.at(-1)?.deploys.get("g1")?.pullRequests).toHaveLength(1);

    // A 401's reacquire failed once: the clock's next pass meets the 401, and the facts stand.
    gitea.readable = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_DEPLOYS_REFRESH_MS);
    });
    expect(seen.at(-1)?.deploys.get("g1")?.pullRequests).toHaveLength(1);
    expect(gitea.pullReads).toBe(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("a 401 the shared listing met through the other pass's client fails neither pass", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<{ forge: ZeropsGroupForge; deploys: ZeropsGroupDeployAnswers }> = [];
    const groups: ReadonlyArray<ZeropsDeployGroup> = [
      { groupId: "g1", slug: "harbor", projects: [] },
    ];
    const readVersion = async () => undefined;

    function Probe() {
      const reads = useForgeReads("https://gitea.example.test");
      // The forge pass first: its clock ticks first, and its client sends the shared listing.
      const forge = useZeropsGroupForge({
        giteaOrigin: "https://gitea.example.test",
        groups,
        enabled: true,
        readable: true,
        reads,
      });
      const deploys = useZeropsGroupDeploys({
        groups,
        giteaOrigin: "https://gitea.example.test",
        readVersion,
        enabled: true,
        readable: true,
        reads,
      });
      seen.push({ forge, deploys });
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(gitea.listings).toBe(1);
    expect(seen.at(-1)?.deploys.deploys.get("g1")?.pullRequests).toHaveLength(1);

    gitea.listingRefusedOnce = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_DEPLOYS_REFRESH_MS);
    });
    expect(gitea.listingRefusedOnce).toBe(false);
    expect(seen.at(-1)?.forge.failures.get("g1")).toBeUndefined();
    expect(seen.at(-1)?.deploys.failures.get("g1")).toBeUndefined();
    expect(seen.at(-1)?.deploys.deploys.get("g1")?.pullRequests).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps what it read when a 401 and a failed reacquire land inside one pass", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGroupDeployAnswers> = [];
    const groups: ReadonlyArray<ZeropsDeployGroup> = [
      { groupId: "g1", slug: "harbor", projects: [] },
    ];
    const readVersion = async () => undefined;

    function Probe() {
      seen.push(
        useZeropsGroupDeploys({
          groups,
          giteaOrigin: "https://gitea.example.test",
          readVersion,
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
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.at(-1)?.deploys.get("g1")?.pullRequests).toHaveLength(1);

    // The clock's pass starts with a token; its listing meets the 401 and the reacquire fails.
    gitea.loseTokenOnRead = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_DEPLOYS_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);
    expect(seen.at(-1)?.deploys.get("g1")?.pullRequests).toHaveLength(1);
    expect(seen.at(-1)?.failures.get("g1")).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps what it read when a read's 401 outlasts its wait, though the token is back by the pass's end", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGroupDeployAnswers> = [];
    const groups: ReadonlyArray<ZeropsDeployGroup> = [
      { groupId: "g1", slug: "harbor", projects: [] },
    ];
    const readVersion = async () => undefined;

    function Probe() {
      seen.push(
        useZeropsGroupDeploys({
          groups,
          giteaOrigin: "https://gitea.example.test",
          readVersion,
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
    expect(seen.at(-1)?.deploys.get("g1")?.pullRequests).toHaveLength(1);

    // The listing gives up on the reacquire and answers Gitea's 401; the token lands afterwards.
    gitea.outwaitReacquireOnRead = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GROUP_DEPLOYS_REFRESH_MS);
    });
    expect(gitea.listings).toBe(2);
    expect(seen.at(-1)?.deploys.get("g1")?.pullRequests).toHaveLength(1);
    expect(seen.at(-1)?.failures.get("g1")).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
  });

  it("reads again the moment the token is back, not on the next tick", async () => {
    vi.useFakeTimers();
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const seen: Array<ZeropsGroupDeployAnswers> = [];
    const groups: ReadonlyArray<ZeropsDeployGroup> = [
      { groupId: "g1", slug: "harbor", projects: [] },
    ];
    const readVersion = async () => undefined;

    function Probe({ readable }: { readonly readable: boolean }) {
      seen.push(
        useZeropsGroupDeploys({
          groups,
          giteaOrigin: "https://gitea.example.test",
          readVersion,
          enabled: true,
          readable,
          reads: useForgeReads("https://gitea.example.test"),
        }),
      );
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    const render = async (readable: boolean) => {
      gitea.readable = readable;
      await act(async () => {
        root.render(createElement(Probe, { readable }));
        await vi.advanceTimersByTimeAsync(0);
      });
    };
    await render(true);
    expect(gitea.listings).toBe(1);

    // Back after longer than one listing answers for, and well before the clock's next tick.
    await render(false);
    expect(seen.at(-1)?.deploys.get("g1")?.pullRequests).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GATE_FRESH_MS);
    });
    await render(true);
    expect(gitea.listings).toBe(2);

    await act(async () => {
      root.unmount();
    });
  });
});

// Run 5 (2–3 Oct 2026): a stage's first deploy failed in the group's workflow before it asked the
// broker for its grant, and said so only on `main`'s head — "on its way" stood for 4.3 min.
describe("a stage's first deploy on main's head", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const HEAD = "4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5";
  const STAGE_TIER = `services:
  - hostname: app
    type: nodejs@22
    buildFromGit: https://gitea.test/harbor/appdev
`;

  /** The group repo of {@link listedGroupRepo}, its stage tier building `app` from `appdev`. */
  function stageRepo(options: { readonly declares?: boolean | undefined } = {}) {
    const { client: base, calls, listed } = listedGroupRepo();
    listed.set("appdev", { updated_at: PUSHED, open_pr_counter: 0 });
    const head = {
      statuses: [] as Array<{ context: string; state: string; created_at?: string }>,
    };
    const client = {
      ...base,
      listDirectory: async (owner: string, name: string, path: string, ref: string) =>
        options.declares === false
          ? (calls.push(`list ${name}/${path}`), [])
          : base.listDirectory(owner, name, path, ref),
      readFile: async (owner: string, name: string, path: string, ref: string) => {
        if (path === "3 — Stage/import.yaml") {
          calls.push(`read ${name}/${path}`);
          return { content: STAGE_TIER };
        }
        return base.readFile(owner, name, path, ref);
      },
      getBranch: async (_owner: string, name: string, branch: string) => {
        calls.push(`branch ${name}/${branch}`);
        return name === "appdev" ? { name: "main", commit: { id: HEAD } } : undefined;
      },
      listCommitStatuses: async (_owner: string, name: string, sha: string) => {
        calls.push(`statuses ${name}@${sha.slice(0, 7)}`);
        return head.statuses;
      },
    } as unknown as GiteaClient;
    return { client, calls, head };
  }

  /** Reads the group once a minute for `minutes`, as the reader's clock does. */
  async function everyMinute(
    client: GiteaClient,
    readVersion: () => Promise<string | undefined>,
    minutes: number,
    between: (minute: number) => void = () => undefined,
  ) {
    const reads = createForgeReads();
    let held: ZeropsGroupDeployState | undefined;
    const rows: Array<ZeropsGroupDeployState | undefined> = [];
    for (let minute = 0; minute < minutes; minute += 1) {
      if (minute > 0) vi.advanceTimersByTime(GROUP_DEPLOYS_REFRESH_MS);
      between(minute);
      held = (
        await readGroupDeploys({
          client,
          group: GROUP,
          scope: "group",
          readVersion,
          held,
          signal: new AbortController().signal,
          reads,
        })
      )(held);
      rows.push(held);
    }
    return rows;
  }

  const failureOf = (state: ZeropsGroupDeployState | undefined) =>
    buildGroupEnvironmentRows({
      owner: "harbor",
      declarations: state?.declarations ?? [],
      projectNames: new Map(),
      services: [{ projectId: "p-stage", serviceId: "s1", hostname: "app" }],
      versions: new Map(),
      statuses: new Map(),
      heads: new Map(
        (state?.environments ?? []).flatMap((environment) =>
          environment.services.flatMap((service) =>
            service.head === undefined
              ? []
              : [[`${environment.projectId}/${service.hostname}`, service.head] as const],
          ),
        ),
      ),
    })[0]?.firstDeployFailure;

  it("says the failure from the read after it is posted, at most a read a minute while it waits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T22:10:00Z"));
    const { client, calls, head } = stageRepo();
    head.statuses = [
      { context: "mate/deploy/stage/app", state: "pending", created_at: "2026-10-02T22:09:30Z" },
    ];
    const rows = await everyMinute(
      client,
      async () => undefined,
      12,
      (minute) => {
        if (minute === 4)
          head.statuses = [
            {
              context: "Zerops deploy / deploy (push)",
              state: "failure",
              created_at: new Date(Date.now()).toISOString(),
            },
            ...head.statuses,
          ];
      },
    );
    expect(rows.slice(0, 4).map(failureOf)).toEqual([undefined, undefined, undefined, undefined]);
    expect(failureOf(rows[4])).toMatchObject({ reason: undefined });
    expect(failureOf(rows[11])).toMatchObject({ reason: undefined });
    const statusReads = calls.filter((call) => call.startsWith("statuses appdev"));
    // Minutes 0–4 while it waits (one a minute at most), and nothing once it failed.
    expect(statusReads.length).toBeLessThanOrEqual(5);
    expect(statusReads.length).toBeGreaterThanOrEqual(3);
    expect(calls.filter((call) => call === "branch appdev/main")).toHaveLength(1);
  });

  it("falls to a read every five minutes once the head is quiet past the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T22:10:00Z"));
    const { client, calls, head } = stageRepo();
    head.statuses = [
      { context: "mate/deploy/stage/app", state: "pending", created_at: "2026-10-02T22:09:30Z" },
    ];
    const reads = () => calls.filter((call) => call.startsWith("statuses appdev")).length;
    let quietFrom = 0;
    await everyMinute(
      client,
      async () => undefined,
      40,
      (minute) => {
        if (minute === 20) quietFrom = reads();
      },
    );
    // A read a minute while a job may run there; then one every five minutes.
    expect(quietFrom).toBeLessThanOrEqual(20);
    expect(reads() - quietFrom).toBeLessThanOrEqual(4);
  });

  it.each([
    { name: "whose stage runs a deploy", readVersion: async () => `main ${SHA.slice(0, 7)}` },
    { name: "that declares no stage", readVersion: async () => undefined, declares: false },
  ])("asks nothing of main's head for a group $name", async ({ readVersion, declares }) => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T22:10:00Z"));
    const { client, calls } = stageRepo({ declares });
    await everyMinute(client, readVersion, 5);
    expect(
      calls.filter((call) => call === "branch appdev/main" || call === "statuses appdev@4e5f6a7"),
    ).toEqual([]);
  });
});
