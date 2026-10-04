import {
  groupFlow,
  type GroupFlowStop,
  type FlowPullRequest,
  type GroupFlow,
  type GroupFlowInput,
  type GroupNextStepKind,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "~/zerops/agentActivity";

import {
  comingMateLine,
  containersSummary,
  flowStepsAwaiting,
  groupFlowInputOf,
  groupMemberFactsOf,
  lastMergedCode,
  stopLine,
  nextStepAwaitsSomebody,
  parseProjectsSearch,
  productionMark,
  projectRowLine,
  risenFirst,
  rowRises,
} from "./projectsView.logic";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "app",
    number: 1,
    title: "Greet with a fuller line",
    kind: "code",
    mateProjectId: "p-wren",
    author: "mate-p-wren",
    url: undefined,
    checks: "none",
    checkWord: undefined,
    mergeability: "mergeable",
    merged: false,
    mergedAt: undefined,
    headSha: "abc",
    baseBranch: "main",
    line: "app #1",
    updatedAt: undefined,
    ...over,
  };
}

const MATE = {
  projectId: "p-wren",
  name: "Wren",
  preview: undefined,
  waiting: false,
  talked: true,
};

function flowOf(over: Partial<GroupFlowInput> = {}): GroupFlow {
  return groupFlow({
    groupId: "g",
    mates: [MATE],
    pullRequests: [],
    merged: [],
    stops: [],
    missing: [],
    release: {
      gate: { allowed: false, reason: "Nothing is merged to release." },
      suggestion: "v0.1.0",
      waiting: 0,
    },
    mainHasCode: undefined,
    mainHead: undefined,
    productionAddable: false,
    pending: [],
    ...over,
  });
}

const PRODUCTION = {
  projectId: "p-prod",
  name: "production",
  tier: "production" as const,
  row: undefined,
  deployment: undefined,
  route: undefined,
};

const FLOWS = {
  none: flowOf(),
  firstTask: flowOf({ mates: [{ ...MATE, talked: false }] }),
  merge: flowOf({ pullRequests: [pull()] }),
  release: flowOf({
    stops: [PRODUCTION],
    release: { gate: { allowed: true }, suggestion: "v0.1.0", waiting: 1 },
  }),
  answer: flowOf({ mates: [{ ...MATE, waiting: true }] }),
  stopped: flowOf({ mates: [{ ...MATE, waiting: true, failed: true }] }),
  addProduction: flowOf({
    mainHasCode: true,
    productionAddable: true,
    missing: [{ tier: "production" }],
  }),
} as const;

// A project's pull requests and main are Gitea's changes half: until it answers they claim
// nothing, whatever the deploy half says (the owner, 2026-09-30: three projects read "None yet" /
// "Nothing merged" beside their deploys while their changes were being read again).
describe("flowStepsAwaiting — which steps hold a skeleton while a read is out", () => {
  it.each([
    {
      case: "nothing answered",
      read: false,
      changesKnown: false,
      changesFailed: false,
      readOut: true,
      steps: true,
      changes: true,
    },
    {
      case: "the deploy half alone",
      read: true,
      changesKnown: false,
      changesFailed: false,
      readOut: true,
      steps: false,
      changes: true,
    },
    {
      case: "both halves",
      read: true,
      changesKnown: true,
      changesFailed: false,
      readOut: true,
      steps: false,
      changes: false,
    },
    // A Gitea read that never answered (a 403 on the org, the broker down at load) is no read
    // out: the steps say it failed rather than wait forever.
    {
      case: "the changes' read failed",
      read: true,
      changesKnown: false,
      changesFailed: true,
      readOut: true,
      steps: false,
      changes: false,
    },
    {
      case: "no read out: what is known is said",
      read: true,
      changesKnown: false,
      changesFailed: false,
      readOut: false,
      steps: false,
      changes: false,
    },
    {
      case: "nothing read and none out",
      read: false,
      changesKnown: false,
      changesFailed: false,
      readOut: false,
      steps: false,
      changes: false,
    },
  ])("$case", ({ read, changesKnown, changesFailed, readOut, steps, changes }) => {
    expect(flowStepsAwaiting({ read, changesKnown, changesFailed, readOut })).toEqual({
      steps,
      changes,
    });
  });
});

describe("parseProjectsSearch", () => {
  const cases: ReadonlyArray<
    [string, Record<string, unknown>, ReturnType<typeof parseProjectsSearch>]
  > = [
    ["nothing named", {}, {}],
    ["a group opens its row", { group: "g1" }, { group: "g1" }],
    ["an empty group names none", { group: "" }, {}],
    ["a group that is not a string names none", { group: 7 }, {}],
  ];
  for (const [name, raw, expected] of cases) {
    it(name, () => {
      expect(parseProjectsSearch(raw)).toEqual(expected);
    });
  }
});

describe("nextStepAwaitsSomebody", () => {
  // Every kind, so a new one fails typecheck until it is placed.
  const AWAITS: Record<GroupNextStepKind, boolean> = {
    "answer-mate": true,
    "fix-mate": true,
    "fix-deploy": true,
    merge: true,
    unblock: true,
    release: true,
    // A project needs no production (the owner, 2026-09-28: "production not
    // required, this shouldn't be there"): the page offers it, nothing nags.
    "add-production": false,
    // The Mate is the way in to a first task; nothing waits on anybody.
    "first-task": false,
    none: false,
  };
  it.each(Object.entries(AWAITS))("says %s awaits somebody: %s", (kind, awaits) => {
    expect(nextStepAwaitsSomebody(kind as GroupNextStepKind)).toBe(awaits);
  });
});

describe("the ungrouped containers' one line", () => {
  const cases: ReadonlyArray<
    [string, ReadonlyArray<Parameters<typeof containersSummary>[0][number]>, string, number]
  > = [
    [
      "counts each state once and offers a re-probe for the ones not answering",
      ["open", "open", "retry-probe", "start", "open", "retry-probe", "start", "start"],
      "Not in a project · 3 ready · 2 not answering · 3 stopped",
      2,
    ],
    ["says nothing of a state no container is in", ["open"], "Not in a project · 1 ready", 0],
    [
      "a container on its way up is coming up",
      ["pending", "open"],
      "Not in a project · 1 ready · 1 coming up",
      0,
    ],
    [
      // One folded group holds every project no group does: a project without a Mate is one.
      "a project without a Mate is counted as one",
      ["open", "set-up-mate", "set-up-mate"],
      "Not in a project · 1 ready · 2 without a Mate",
      0,
    ],
    [
      "the rest need a look — enable, remove, nothing to do",
      ["enable", "remove", "none"],
      "Not in a project · 3 need a look",
      0,
    ],
  ];
  for (const [name, kinds, line, retry] of cases) {
    it(name, () => {
      expect(containersSummary(kinds)).toEqual({ line, retry });
    });
  }
});

describe("lastMergedCode", () => {
  it("is the newest landed code change, never a recipe change", () => {
    const merged = [
      pull({ number: 2, merged: true, mergedAt: "2026-09-20T10:00:00Z" }),
      pull({ number: 4, merged: true, mergedAt: "2026-09-22T10:00:00Z" }),
      pull({ number: 6, kind: "recipe", merged: true, mergedAt: "2026-09-23T10:00:00Z" }),
    ];
    expect(lastMergedCode(merged)?.number).toBe(4);
    expect(lastMergedCode([])).toBeUndefined();
  });
});

describe("a Mate being created", () => {
  it("reads as coming up while its press holds it", () => {
    expect(comingMateLine({})).toBe("Coming up. A few minutes.");
  });

  it("whose creation stopped before the platform took it says so", () => {
    expect(comingMateLine({ failed: true })).toBe("Could not be set up.");
  });
});

describe("a stop's line", () => {
  const version = {
    name: undefined,
    commit: "e014b0e",
    sha: undefined,
    taggedBy: undefined,
    label: "e014b0e",
  };
  const stop = (over: Partial<GroupFlowStop>): GroupFlowStop => ({
    projectId: "p-stage",
    name: "stage",
    state: "deployed",
    version,
    source: "main",
    route: undefined,
    ...over,
  });
  it.each([
    [{ state: "deployed" }, { word: "Deployed", version: "e014b0e", tone: "ok" }],
    [{ state: "deploying" }, { word: "Deploying…", version: "e014b0e", tone: "busy" }],
    [{ state: "failed" }, { word: "Failed", version: "e014b0e", tone: "failed" }],
    [
      { state: "empty", version: undefined },
      { word: "Nothing deployed yet", version: undefined, tone: "off" },
    ],
    [
      { state: "checking", version: undefined },
      { word: "Checking what runs here…", version: undefined, tone: "off" },
    ],
    [
      { state: "empty", version: undefined, firstDeploy: { kind: "failed" } },
      { word: "First deploy failed", version: undefined, tone: "failed" },
    ],
    [
      { state: "empty", version: undefined, firstDeploy: { kind: "on-its-way" } },
      { word: "First deploy on its way", version: undefined, tone: "busy" },
    ],
    [
      { state: "empty", version: undefined, firstDeploy: { kind: "runner", why: "not-started" } },
      {
        word: "Waiting for the runner · it hasn’t started",
        version: undefined,
        tone: "off",
      },
    ],
  ] as const)("reads %j as %j", (over, expected) => {
    expect(stopLine(stop(over))).toEqual(expected);
  });
});

describe("groupMemberFactsOf — whether a Mate was spoken to", () => {
  const mate = (group: ZeropsCandidate["group"]): ZeropsCandidate =>
    ({
      key: "p-wren:zcp",
      project: { id: "p-wren", name: "p-wren", status: "ACTIVE", tagList: ["mate", "mate:g:g"] },
      group,
      environmentId: "env-wren" as EnvironmentId,
      service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    }) as ZeropsCandidate;
  const activity = (subject: string | undefined): ZeropsAgentActivity => ({
    threadId: "thread-1" as ZeropsAgentActivity["threadId"],
    kind: "idle",
    status: null,
    face: "idle",
    subject,
    at: "2026-09-24T10:00:00.000Z",
    snippet: undefined,
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread",
    task: undefined,
  });
  const cases: ReadonlyArray<
    [
      string,
      ZeropsCandidate["group"],
      ZeropsAgentActivity | undefined,
      boolean,
      boolean | undefined,
    ]
  > = [
    ["a Mate not connected is unknown", "ready", undefined, false, undefined],
    [
      "a Mate not connected is unknown, even with a cached read",
      "ready",
      activity("Fix it"),
      true,
      undefined,
    ],
    ["a connected Mate with a subject was spoken to", "connected", activity("Fix it"), true, true],
    [
      "a connected Mate whose conversation has no subject was not",
      "connected",
      activity(undefined),
      true,
      false,
    ],
    [
      "a connected Mate with no conversation, its conversations read, was not",
      "connected",
      undefined,
      true,
      false,
    ],
    [
      "a connected Mate whose conversations have not arrived is unknown",
      "connected",
      undefined,
      false,
      undefined,
    ],
  ];
  for (const [name, group, found, conversationsRead, talked] of cases) {
    it(name, () => {
      const [facts] = groupMemberFactsOf(
        [{ item: mate(group), role: "dev" }],
        () => found,
        () => conversationsRead,
        undefined,
      );
      expect(facts?.mate?.talked).toBe(talked);
    });
  }

  // A Mate asking waits on the viewer only when it is theirs (`mateIsViewers`): the overview's
  // "is waiting on an answer" step says what the group's detail and the menu say.
  it.each([
    { case: "own Mate asking", signer: "u-petra", waiting: true },
    { case: "a colleague's Mate asking", signer: "u-karlos", waiting: false },
    { case: "nobody's Mate asking", signer: undefined, waiting: false },
  ])("$case waits on the viewer: $waiting", ({ signer, waiting }) => {
    const asking = mate("connected");
    const item = {
      ...asking,
      project: {
        ...asking.project,
        tagList: [
          ...(asking.project.tagList ?? []),
          ...(signer === undefined ? [] : [`mate:signer:claude-code:${signer}`]),
        ],
      },
    } as ZeropsCandidate;
    const [facts] = groupMemberFactsOf(
      [{ item, role: "dev" }],
      () => ({ ...activity("Which port?"), kind: "input", face: "needs" }),
      () => true,
      "u-petra",
    );
    expect(facts?.mate?.waiting).toBe(waiting);
  });

  it("feeds an unknown talk to the flow as not spoken to", () => {
    const members = groupMemberFactsOf(
      [{ item: mate("ready"), role: "dev" }],
      () => undefined,
      () => false,
      undefined,
    );
    const input = groupFlowInputOf({
      groupId: "g",
      members,
      flow: undefined,
      deployments: new Map(),
      productionAddable: false,
      pending: [],
    });
    expect(input.mates.map((entry) => entry.talked)).toEqual([false]);
  });
});

describe("groupFlowInputOf", () => {
  const route = (service: string) => ({
    service,
    port: 3000,
    url: `https://${service}-1.prg1.zerops.app`,
    host: `${service}-1.prg1.zerops.app`,
  });
  const members = [
    {
      projectId: "p-wren",
      role: "dev" as const,
      name: "sm-fixture",
      mate: { name: "Wren", waiting: false, talked: true },
      routes: [route("appdev"), route("appstage")],
      hostnames: ["appdev", "appstage"],
    },
    {
      projectId: "p-stage",
      role: "stage" as const,
      name: "sm-fixture - stage",
      mate: undefined,
      routes: [route("app")],
      hostnames: ["app"],
    },
    {
      projectId: "p-dev-bare",
      role: "dev" as const,
      name: "sm-fixture - dev",
      mate: undefined,
      routes: [],
      hostnames: [],
    },
  ];

  it("takes the Mates, their previews and every stop from what the page holds", () => {
    const input = groupFlowInputOf({
      groupId: "g",
      members,
      flow: undefined,
      deployments: new Map(),
      productionAddable: false,
      pending: [],
    });
    expect(input.mates).toEqual([
      {
        projectId: "p-wren",
        name: "Wren",
        preview: "https://appstage-1.prg1.zerops.app",
        waiting: false,
        talked: true,
      },
    ]);
    expect(input.stops.map((stop) => [stop.projectId, stop.tier, stop.route])).toEqual([
      ["p-stage", "stage", "https://app-1.prg1.zerops.app"],
    ]);
    // Unread: nothing waits, and no release is offered.
    expect(input.pullRequests).toEqual([]);
    expect(input.release.gate.allowed).toBe(false);
    expect(input.release.waiting).toBe(0);
    expect(input.mainHasCode).toBeUndefined();
  });

  it("reads the flow's pull requests, rows and release where it was read", () => {
    const row = {
      kind: "environment" as const,
      projectId: "p-stage",
      name: "stage",
      tier: "stage" as const,
      source: "main",
      commit: "e014b0e",
      version: {
        name: undefined,
        commit: "e014b0e",
        sha: undefined,
        taggedBy: undefined,
        label: "e014b0e",
      },
      versionRepository: "app",
      line: "",
      tone: "good" as const,
    };
    const input = groupFlowInputOf({
      groupId: "g",
      members,
      flow: {
        environments: [row],
        pullRequests: [pull()],
        merged: [pull({ number: 4, merged: true })],
        missing: [
          { kind: "missing-environment", tier: "production", name: "Production", line: "" },
        ],
        release: {
          gate: { allowed: true },
          suggestion: "v0.1.1",
          contents: [
            {
              commits: [
                { sha: "a", subject: "one" },
                { sha: "b", subject: "two" },
              ],
            },
            { commits: [{ sha: "a", subject: "one" }] },
          ],
        },
      },
      deployments: new Map(),
      productionAddable: true,
      pending: [],
    });
    expect(input.stops[0]?.row).toBe(row);
    expect(input.stops[0]?.name).toBe("stage");
    expect(input.pullRequests.map((entry) => entry.number)).toEqual([1]);
    expect(input.merged.map((entry) => entry.number)).toEqual([4]);
    expect(input.missing).toEqual([
      { kind: "missing-environment", tier: "production", name: "Production", line: "" },
    ]);
    expect(input.release).toEqual({ gate: { allowed: true }, suggestion: "v0.1.1", waiting: 2 });
    expect(input.productionAddable).toBe(true);
  });

  it("hands the group's creations under way to the flow as they are", () => {
    const pending = [
      {
        projectId: "p-new",
        kind: "mate" as const,
        name: "Vera",
        startedAt: 5,
      },
    ];
    const input = groupFlowInputOf({
      groupId: "g",
      members,
      flow: undefined,
      deployments: new Map(),
      productionAddable: false,
      pending,
    });
    expect(input.pending).toEqual(pending);
  });
});

describe("projectRowLine — a project row's second line", () => {
  const quiet = { lastMerged: undefined, activities: [], settled: true } as const;
  const RUNE_WORKING = {
    name: "Wren",
    working: true,
    subject: "Add a health check",
    at: "2026-10-03T10:00:00Z",
  };
  const RUNE_IDLE = { ...RUNE_WORKING, working: false };
  const MERGED = pull({
    number: 4,
    title: "Ship the archive page",
    merged: true,
    mergedAt: "2026-10-02T10:00:00Z",
  });
  it.each([
    [
      "a pull request waits: the sentence, with its title, and the verb",
      { flow: FLOWS.merge },
      {
        kind: "needs-you",
        text: "Pull request #1 waits for your merge",
        detail: "Greet with a fuller line",
        tone: "attention",
      },
    ],
    [
      "a Mate stopped on an error: said even before the reads answer",
      { flow: FLOWS.stopped, settled: false },
      { kind: "needs-you", text: "Wren stopped on an error", tone: "failed" },
    ],
    [
      "a release waits",
      { flow: FLOWS.release },
      { kind: "needs-you", text: FLOWS.release.nextStep.text, tone: "busy" },
    ],
    [
      "the reads are out: nothing is claimed yet",
      { flow: FLOWS.merge, settled: false },
      { kind: "pending" },
    ],
    [
      "a Mate works: what it is on, its face says the rest",
      { flow: FLOWS.none, activities: [RUNE_WORKING] },
      { kind: "mate", mate: "Wren", text: "Add a health check" },
    ],
    [
      "quiet: the change that landed last",
      { flow: FLOWS.none, lastMerged: MERGED },
      { kind: "change", text: "Merged #4 Ship the archive page", at: "2026-10-02T10:00:00Z" },
    ],
    [
      "quiet: the Mate's last task when it is newer than the last merge",
      { flow: FLOWS.none, lastMerged: MERGED, activities: [RUNE_IDLE] },
      { kind: "mate", mate: "Wren", text: "Add a health check", at: "2026-10-03T10:00:00Z" },
    ],
    [
      "a Mate nobody has spoken to: its first task",
      { flow: FLOWS.firstTask },
      { kind: "first-task", text: "Give Wren a first task" },
    ],
    ["nothing known: no line at all", { flow: FLOWS.none }, { kind: "none" }],
    [
      // Production is the person's to add from the menu: never a step that waits.
      "production could be added: not a thing that needs you",
      {
        flow: flowOf({
          merged: [MERGED],
          productionAddable: true,
          missing: [{ tier: "production" }],
        }),
        lastMerged: MERGED,
      },
      { kind: "change", text: "Merged #4 Ship the archive page", at: "2026-10-02T10:00:00Z" },
    ],
  ] as const)("%s", (_name, over, expected) => {
    expect(projectRowLine({ ...quiet, ...over })).toEqual(expected);
  });

  it("a pull request open and not yet the person's: its title and where its checks stand", () => {
    const flow = flowOf({
      pullRequests: [
        pull({
          number: 9,
          title: "Make the design system",
          mergeability: "checking",
          checkWord: "Running",
        }),
      ],
    });
    expect(projectRowLine({ ...quiet, flow })).toEqual({
      kind: "change",
      text: "#9 Make the design system",
      detail: "Running",
    });
  });
});

describe("productionMark — production's version, only where production exists", () => {
  it("no production: nothing at all", () => {
    expect(productionMark(FLOWS.none)).toBeUndefined();
  });
  it("production runs a version: the version and its tone", () => {
    const flow = {
      ...FLOWS.none,
      production: {
        kind: "live",
        line: "v0.1.59",
        stop: {
          projectId: "p-prod",
          name: "production",
          state: "deployed",
          version: { label: "v0.1.59" },
          source: "release",
          route: undefined,
        },
      },
    } as unknown as GroupFlow;
    expect(productionMark(flow)).toEqual({ version: "v0.1.59", tone: "ok" });
  });
  it("production runs nothing yet: nothing to show", () => {
    const flow = {
      ...FLOWS.none,
      production: {
        kind: "empty",
        line: "Nothing deployed",
        stop: {
          projectId: "p-prod",
          name: "production",
          state: "empty",
          version: undefined,
          source: "release",
          route: undefined,
        },
      },
    } as unknown as GroupFlow;
    expect(productionMark(flow)).toBeUndefined();
  });
});

describe("risenFirst — the rows that need the person rise, the custom order kept within", () => {
  it.each([
    ["none rise: the order as given", [false, false, false], ["a", "b", "c"]],
    ["one rises", [false, true, false], ["b", "a", "c"]],
    ["two rise: their own order kept", [false, true, true], ["b", "c", "a"]],
  ] as const)("%s", (_name, rises, expected) => {
    const rows = ["a", "b", "c"];
    expect(risenFirst(rows, (row) => rises[rows.indexOf(row)] === true)).toEqual(expected);
  });
});

describe("rowRises — a row whose answer is out stays where it was drawn", () => {
  it.each([
    ["needs you", { kind: "needs-you", text: "x", tone: "attention" }, undefined, true],
    ["quiet", { kind: "none" }, true, false],
    ["pending, last drawn risen", { kind: "pending" }, true, true],
    ["pending, never drawn", { kind: "pending" }, undefined, false],
  ] as const)("%s", (_name, line, remembered, expected) => {
    expect(rowRises(line, remembered)).toBe(expected);
  });
});
