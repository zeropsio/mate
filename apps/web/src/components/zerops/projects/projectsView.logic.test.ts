import {
  groupFlow,
  type GroupFlowStop,
  type FlowPullRequest,
  type GroupFlow,
  type GroupFlowInput,
  type GroupNextStepKind,
  type ZeropsGroup,
  type ZeropsProject,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsAgentActivity } from "~/zerops/agentActivity";

import {
  changeRowVerb,
  changesUnknownOf,
  comingMateLine,
  containersSummary,
  flowStepsAwaiting,
  groupFlowInputOf,
  groupMemberFactsOf,
  lastMergedCode,
  stopLine,
  nextStepAwaitsSomebody,
  parseProjectsSearch,
  tiersAddable,
  rowMateActivitiesOf,
  risenFirst,
  productionMark,
  projectRowLine,
  withoutOfficialHq,
  shownUngrouped,
} from "./projectsView.logic";

/** One comparison HQ answered for `appdev`: what a release would put live. */
const compared = (commits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>) => ({
  repository: "appdev",
  services: ["app"],
  commits: commits.map((commit) => ({
    ...commit,
    authorName: "Juno",
    at: "2026-10-02T10:00:00.000Z",
    change: null,
  })),
  total: commits.length,
  truncated: false,
});

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "app",
    number: 1,
    title: "Greet with a fuller line",
    kind: "code",
    mateProjectId: "p-wren",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
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
    release: {
      gate: { allowed: false, reason: "Nothing is merged to release." },
      suggestion: "v0.1.0",
      waiting: 0,
      waitingAtLeast: false,
      untold: [],
    },
    mainHasCode: undefined,
    mainHead: undefined,
    pending: [],
    ...over,
  });
}

const PRODUCTION = {
  projectId: "p-prod",
  name: "production",
  tier: "production" as const,
  row: undefined,
  deployment: {
    state: "known" as const,
    value: { kind: "none" as const },
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete" as const,
    freshness: { kind: "live" as const },
  },
  route: undefined,
};

const FLOWS = {
  none: flowOf(),
  firstTask: flowOf({ mates: [{ ...MATE, talked: false }] }),
  merge: flowOf({ pullRequests: [pull()] }),
  release: flowOf({
    stops: [PRODUCTION],
    release: {
      gate: { allowed: true },
      suggestion: "v0.1.0",
      waiting: 1,
      waitingAtLeast: false,
      untold: [],
    },
  }),
  stopped: flowOf({ mates: [{ ...MATE, waiting: true, failed: true }] }),
} as const;

// A project's pull requests and main are HQ's changes half: until it answers they claim
// nothing, whatever the deploy half says (the owner, 2026-09-30: three projects read "None yet" /
// "Nothing merged" beside their deploys while their changes were being read again).
describe("flowStepsAwaiting — which steps hold a skeleton while a read is out", () => {
  it.each([
    {
      case: "nothing answered",
      read: false,
      changesKnown: false,
      changesUnknown: undefined,
      readOut: true,
      steps: true,
      changes: true,
    },
    {
      case: "the deploy half alone",
      read: true,
      changesKnown: false,
      changesUnknown: undefined,
      readOut: true,
      steps: false,
      changes: true,
    },
    {
      case: "both halves",
      read: true,
      changesKnown: true,
      changesUnknown: undefined,
      readOut: true,
      steps: false,
      changes: false,
    },
    // A read HQ never answered is no read out: the steps say it failed rather than wait forever.
    {
      case: "the changes' read failed",
      read: true,
      changesKnown: false,
      changesUnknown: "failed",
      readOut: true,
      steps: false,
      changes: false,
    },
    // HQ's rule shows this person the project and not its changes: nothing will answer for them,
    // so they wait for nothing, whatever the deploy half has.
    {
      case: "the person may not see its changes",
      read: false,
      changesKnown: false,
      changesUnknown: "unseen",
      readOut: true,
      steps: true,
      changes: false,
    },
    {
      case: "no read out: what is known is said",
      read: true,
      changesKnown: false,
      changesUnknown: undefined,
      readOut: false,
      steps: false,
      changes: false,
    },
    {
      case: "nothing read and none out",
      read: false,
      changesKnown: false,
      changesUnknown: undefined,
      readOut: false,
      steps: false,
      changes: false,
    },
  ] as const)("$case", ({ read, changesKnown, changesUnknown, readOut, steps, changes }) => {
    expect(flowStepsAwaiting({ read, changesKnown, changesUnknown, readOut })).toEqual({
      steps,
      changes,
    });
  });
});

// HQ's refusal decides first: where it shows this person the project and not its changes, an HQ
// that did not answer them changes nothing they would see. Nothing said, or HQ not answering,
// refuses nothing.
describe("changesUnknownOf — why a project's changes are not known", () => {
  it.each([
    { case: "seen and told", refused: false, failed: false, want: undefined },
    { case: "seen, and HQ did not answer", refused: false, failed: true, want: "failed" },
    { case: "refused", refused: true, failed: false, want: "unseen" },
    { case: "refused, and HQ did not answer", refused: true, failed: true, want: "unseen" },
    { case: "nothing said yet", refused: undefined, failed: false, want: undefined },
    { case: "nothing said, HQ did not answer", refused: undefined, failed: true, want: "failed" },
  ] as const)("$case", ({ refused, failed, want }) => {
    expect(
      changesUnknownOf({
        offers: refused === undefined ? undefined : { readRefused: refused },
        changesFailure: failed ? "HQ is not answering right now." : undefined,
      }),
    ).toBe(want);
  });
});

// Main A21/A23: a merge pressed in the review shows on the change's row while it runs, and until
// HQ's stream brings the change merged (`flowVerbKey`'s held key).
describe("changeRowVerb — what a change's row offers", () => {
  const change = { repository: "app", number: 7 } as const;
  it.each([
    ["Review, with nothing under way", new Set<string>(), "Review"],
    ["Merging… while its merge runs or is held", new Set(["merge g1/app#7"]), "Merging…"],
    ["Review, another change's merge under way", new Set(["merge g1/app#8"]), "Review"],
    [
      "Review while it closes: a close says so in its review",
      new Set(["close g1/app#7"]),
      "Review",
    ],
  ] as const)("%s", (_case, pending, label) => {
    expect(changeRowVerb(pending, "g1", change)).toBe(label);
  });
});

describe("parseProjectsSearch", () => {
  const cases: ReadonlyArray<
    [string, Record<string, unknown>, ReturnType<typeof parseProjectsSearch>]
  > = [
    ["no group is the list as it stands", {}, {}],
    ["a group opens its row", { group: "g1" }, { group: "g1" }],
    // The two views were one list's (pass 39): an old link's view is no longer read.
    ["an old view is not read", { view: "projects", group: "g1" }, { group: "g1" }],
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
    [
      "containers of another system are outside this HQ, never coming up",
      ["not-in-hq", "not-in-hq"],
      "Not in a project · 2 not in this HQ",
      0,
    ],
    ["says nothing of a state no container is in", ["open"], "Not in a project · 1 ready", 0],
    [
      "a container on its way up is coming up",
      ["pending", "open"],
      "Not in a project · 1 ready · 1 coming up",
      0,
    ],
    [
      "a project with no Mate container is counted among them",
      ["set-up-mate", "open"],
      "Not in a project · 1 ready · 1 without a Mate",
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
      { state: "empty", version: undefined, firstDeploy: { kind: "held" } },
      { word: "Stage awaits a deploy key", version: undefined, tone: "off" },
    ],
  ] as const)("reads %j as %j", (over, expected) => {
    expect(stopLine(stop(over))).toEqual(expected);
  });
});

describe("groupMemberFactsOf — whether a Mate was spoken to", () => {
  const mate = (group: ZeropsCandidate["group"]): ZeropsCandidate =>
    ({
      key: "p-wren:zcp",
      project: {
        id: "p-wren",
        name: "p-wren",
        status: "ACTIVE",
        tagList: ["mate"],
        hq: { appId: "g", appName: "G", kind: "mate", mate: { name: "Wren", face: "" } },
      },
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
      "a Mate not connected is unknown, even with a word at rest",
      "ready",
      { ...activity("Fix it"), remembered: true },
      true,
      undefined,
    ],
    [
      "a Mate HQ holds live, no socket to it, was spoken to",
      "ready",
      activity("Fix it"),
      true,
      true,
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
        () => false,
      );
      expect(facts?.mate?.talked).toBe(talked);
    });
  }

  // A Mate asking waits on the viewer only when HQ says it does (`waitsOnViewer`): the overview's
  // "is waiting on an answer" step says what the group's detail and the menu say.
  it.each([
    { case: "a Mate HQ says waits on the viewer, asking", waitsOnViewer: true, waiting: true },
    { case: "a Mate HQ says waits on someone else, asking", waitsOnViewer: false, waiting: false },
  ])("$case: $waiting", ({ waitsOnViewer, waiting }) => {
    const item = mate("connected");
    const [facts] = groupMemberFactsOf(
      [{ item, role: "dev" }],
      () => ({ ...activity("Which port?"), kind: "input", face: "needs" }),
      () => true,
      (projectId) => projectId === item.project.id && waitsOnViewer,
    );
    expect(facts?.mate?.waiting).toBe(waiting);
  });

  // Its changes ask for nothing while it works: the group's next step waits until it rests.
  it.each([
    { case: "a Mate at work", group: "connected", face: "working", working: [true] },
    { case: "a Mate at rest", group: "connected", face: "idle", working: [undefined] },
    {
      case: "a word at rest says nothing of now",
      group: "ready",
      face: "working",
      remembered: true,
      working: [undefined],
    },
  ] as const)("feeds $case to the flow", ({ group, face, working, ...rest }) => {
    const members = groupMemberFactsOf(
      [{ item: mate(group), role: "dev" }],
      () => ({ ...activity("Fix it"), face, ...rest }),
      () => true,
      () => false,
    );
    const input = groupFlowInputOf({
      groupId: "g",
      members,
      flow: undefined,
      deployments: new Map(),
      pending: [],
    });
    expect(input.mates.map((entry) => entry.working)).toEqual(working);
  });

  it("feeds an unknown talk to the flow as not spoken to", () => {
    const members = groupMemberFactsOf(
      [{ item: mate("ready"), role: "dev" }],
      () => undefined,
      () => false,
      () => false,
    );
    const input = groupFlowInputOf({
      groupId: "g",
      members,
      flow: undefined,
      deployments: new Map(),
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
      deploys: [],
      keyGap: false,
    };
    const input = groupFlowInputOf({
      groupId: "g",
      members,
      flow: {
        environments: [row],
        pullRequests: [pull()],
        merged: [pull({ number: 4, merged: true })],
        release: {
          gate: { allowed: true },
          suggestion: "v0.1.1",
          untold: [],
          contents: [
            compared([
              { sha: "a", subject: "one" },
              { sha: "b", subject: "two" },
            ]),
            compared([{ sha: "a", subject: "one" }]),
          ],
        },
      },
      deployments: new Map(),
      pending: [],
    });
    expect(input.stops[0]?.row).toBe(row);
    expect(input.stops[0]?.name).toBe("stage");
    expect(input.pullRequests.map((entry) => entry.number)).toEqual([1]);
    expect(input.merged.map((entry) => entry.number)).toEqual([4]);
    expect(input.release).toEqual({
      gate: { allowed: true },
      suggestion: "v0.1.1",
      waiting: 2,
      waitingAtLeast: false,
      untold: [],
    });
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
      pending,
    });
    expect(input.pending).toEqual(pending);
  });
});

describe("withoutOfficialHq — the page's projects, never the organization's HQ", () => {
  const row = (id: string, name: string) => ({ project: { id, name } });
  const ROWS = [row("hq-1", "Headquarters"), row("old-hq", "Headquarters"), row("shop", "Shop")];
  const OFFICIAL = {
    kind: "official",
    projectId: "hq-1",
    address: "https://hq-1.prg1-zerops.zone",
  } as const;

  it.each([
    {
      case: "leaves out the project the anchor names, whatever it is called",
      hq: OFFICIAL,
      ids: ["old-hq", "shop"],
    },
    {
      case: "keeps a project merely named Headquarters that no anchor names",
      hq: { ...OFFICIAL, projectId: "elsewhere" },
      ids: ["hq-1", "old-hq", "shop"],
    },
    {
      case: "leaves nothing out while the anchor is unknown, and guesses by no name",
      hq: { kind: "none" } as const,
      ids: ["hq-1", "old-hq", "shop"],
    },
    {
      case: "leaves nothing out where two anchors leave the HQ unclear",
      hq: { kind: "unclear", projectIds: ["hq-1", "old-hq"] } as const,
      ids: ["hq-1", "old-hq", "shop"],
    },
  ])("$case", ({ hq, ids }) => {
    expect(withoutOfficialHq(ROWS, hq).map(({ project }) => project.id)).toEqual(ids);
  });
});

describe("the Overview's ungrouped projects", () => {
  it("leaves foreign environments without a Mate out of the collapsed containers and setup list", () => {
    const row = (id: string, tags: string[], container: boolean, placedMate = false) => ({
      item: {
        key: id,
        group: "unavailable" as const,
        project: {
          id,
          name: id,
          status: "ACTIVE",
          tagList: tags,
          // A Mate HQ holds in no application.
          ...(placedMate
            ? { hq: { appId: null, appName: null, kind: "mate" as const, mate: { face: "" } } }
            : {}),
        },
        ...(container ? { service: { id: "zcp", name: "zcp", status: "ACTIVE" } } : {}),
      },
      action: "none" as const,
    });
    const mate = row("foreign-mate", ["mate"], true);
    const lostMate = row("lost-mate", ["mate"], false, true);
    const markedOnly = row("marked-only", ["mate"], false);
    const production = row("foreign-prod", ["mate:g:foreign", "mate:role:prod"], false);
    const ordinary = row("central-prometheus", [], false);
    expect(shownUngrouped([production, ordinary, markedOnly, mate, lostMate])).toEqual([
      mate,
      lostMate,
    ]);
  });

  // The 09-05 offer: a plain project its viewer may bring a Mate into is listed with Set up Mate.
  it("lists a plain project its row offers Set up Mate", () => {
    const shop = {
      item: {
        key: "shop",
        group: "unavailable" as const,
        project: { id: "shop", name: "shop", status: "ACTIVE", tagList: [] },
      },
      action: "set-up-mate" as const,
    };
    expect(shownUngrouped([shop])).toEqual([shop]);
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
      "a change waits: the sentence, with its title, and the verb",
      { flow: FLOWS.merge },
      {
        kind: "needs-you",
        text: FLOWS.merge.nextStep.text,
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
    // An unknown read is not "nothing to do": a change may wait there unseen.
    [
      "HQ did not answer for its changes: it says so",
      { flow: FLOWS.none, lastMerged: MERGED, changesUnknown: "failed" },
      { kind: "unread", text: "HQ didn’t answer" },
    ],
    [
      "HQ's rule withholds its changes from this person: it says why",
      { flow: FLOWS.merge, changesUnknown: "unseen" },
      { kind: "unread", text: "Needs Basic user access" },
    ],
    [
      "its changes unknown, a Mate stopped on an error: the Mate first",
      { flow: FLOWS.stopped, changesUnknown: "failed" },
      { kind: "needs-you", text: "Wren stopped on an error", tone: "failed" },
    ],
    [
      // Production is the person's to add from the menu: never a step that waits.
      "production could be added: not a thing that needs you",
      {
        flow: flowOf({
          merged: [MERGED],
          mainHasCode: true,
        }),
        lastMerged: MERGED,
      },
      { kind: "change", text: "Merged #4 Ship the archive page", at: "2026-10-02T10:00:00Z" },
    ],
  ] as const)("%s", (_name, over, expected) => {
    expect(projectRowLine({ ...quiet, ...over })).toEqual(expected);
  });

  it("a change open and not yet the person's: its number and title", () => {
    const flow = flowOf({
      pullRequests: [
        pull({ number: 9, title: "Make the design system", mergeability: "checking" }),
      ],
    });
    expect(projectRowLine({ ...quiet, flow })).toEqual({
      kind: "change",
      text: "#9 Make the design system",
    });
  });

  it.each([
    ["a deploy runs on a stage", { state: "deploying" }, "Deploying fixture-stage…"],
  ] as const)("under way: %s", (_name, over, text) => {
    const stage: GroupFlowStop = {
      projectId: "fixture-stage",
      name: "fixture-stage",
      version: undefined,
      source: "main",
      route: undefined,
      ...over,
    };
    const flow: GroupFlow = { ...FLOWS.none, stages: [stage] };
    expect(projectRowLine({ ...quiet, flow })).toEqual({ kind: "under-way", text });
  });
});

describe("productionMark — production's version, only where production exists", () => {
  const production = (over: Partial<GroupFlowStop>): GroupFlow =>
    ({
      ...FLOWS.none,
      production: {
        kind: over.state === "deployed" ? "live" : "empty",
        line: "",
        stop: {
          projectId: "p-prod",
          name: "production",
          state: "empty",
          version: undefined,
          source: "release",
          route: undefined,
          ...over,
        },
      },
    }) as GroupFlow;
  it.each([
    ["no production: nothing at all", FLOWS.none, undefined],
    [
      "production runs a version: the version and its tone",
      production({ state: "deployed", version: { label: "v0.1.59" } as GroupFlowStop["version"] }),
      { version: "v0.1.59", tone: "ok" },
    ],
    ["production runs nothing yet: nothing to show", production({}), undefined],
  ] as const)("%s", (_name, flow, expected) => {
    expect(productionMark(flow)).toEqual(expected);
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

describe("a project row's Mates — what each is on", () => {
  const mate = (
    group: ZeropsCandidate["group"],
    linked: boolean,
  ): ZeropsCandidate & { readonly connection?: unknown } =>
    ({
      key: "p-wren:zcp",
      project: { id: "p-wren", name: "p-wren", status: "ACTIVE", tagList: [] },
      group,
      ...(group === "connected" ? { environmentId: "env-wren" as EnvironmentId } : {}),
      ...(linked
        ? { connection: { phase: group === "connected" ? "connected" : "connecting" } }
        : {}),
      service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    }) as ZeropsCandidate & { readonly connection?: unknown };
  const working: ZeropsAgentActivity = {
    threadId: "thread-1" as ZeropsAgentActivity["threadId"],
    kind: "working",
    status: null,
    face: "working",
    subject: "Add a health check",
    at: "2026-09-24T10:00:00.000Z",
    snippet: undefined,
    unread: false,
    pausedUntil: undefined,
    threadKey: "env:thread",
    task: undefined,
  };
  const resting: ZeropsAgentActivity = { ...working, remembered: true };

  it.each([
    [
      "of now: what it is on",
      working,
      [{ name: "Wren", working: true, subject: "Add a health check", at: working.at }],
    ],
    // HQ's last word of a Mate it holds no live link of: its last task, never that it works.
    [
      "at rest: its last task, never working",
      resting,
      [{ name: "Wren", working: false, subject: "Add a health check", at: working.at }],
    ],
    ["nothing told: nothing", undefined, []],
  ] as const)("%s", (_name, activity, expected) => {
    expect(
      rowMateActivitiesOf([{ item: mate("ready", false), name: "Wren" }], () => activity),
    ).toEqual(expected);
  });
});

describe("tiersAddable", () => {
  type Tier = "stage" | "production";
  const entry = (id: string, role: "dev" | "stage" | "prod" | "devstage") => ({
    project: { id, name: id, status: "ACTIVE" } as ZeropsProject,
    role,
  });
  const BOTH = { stage: true, production: true };
  const ask = (over: {
    offered?: { stage: boolean; production: boolean } | null;
    environments?: ReadonlyArray<{
      project: ZeropsProject;
      role: "dev" | "stage" | "prod" | "devstage";
    }>;
    pending?: ZeropsGroup["pending"];
    hq?: ReadonlyArray<{ id: string; tier: Tier }>;
    recipe?: { read: boolean; tiers: ReadonlyArray<Tier> };
  }) =>
    tiersAddable({
      offered: over.offered === undefined ? BOTH : over.offered,
      group: {
        environments: over.environments ?? [entry("dev", "dev")],
        pending: over.pending ?? [],
      },
      hq: over.hq ?? [],
      recipe: over.recipe ?? { read: true, tiers: ["stage", "production"] },
    });

  it.each<[string, Parameters<typeof ask>[0], ReadonlyArray<Tier>]>([
    ["HQ offers both, nothing added", {}, ["stage", "production"]],
    ["HQ has not said", { offered: null }, []],
    [
      "HQ offers only a production",
      { offered: { stage: false, production: true } },
      ["production"],
    ],
    ["the recipe not read", { recipe: { read: false, tiers: [] } }, []],
    [
      "a Mate that is also the stage: the stage is there",
      { environments: [entry("m", "dev"), entry("v", "devstage")] },
      ["production"],
    ],
    ["a stage held", { environments: [entry("s", "stage")] }, ["production"]],
    [
      "a production made as one, HQ not holding it",
      { environments: [entry("p", "prod")] },
      ["stage"],
    ],
    [
      "a production being created",
      { pending: [{ projectId: "n", kind: "production", name: "n", startedAt: 0 }] },
      ["stage"],
    ],
    [
      "a stage and a production HQ holds, counted once beside the projects",
      {
        environments: [entry("s", "stage"), entry("p", "prod")],
        hq: [
          { id: "s", tier: "stage" },
          { id: "p", tier: "production" },
        ],
      },
      [],
    ],
    ["the recipe holds only the stage", { recipe: { read: true, tiers: ["stage"] } }, ["stage"]],
  ])("%s", (_name, over, expected) => {
    expect(ask(over)).toEqual(expected);
  });
});

it("unknown placement is not claimed to be outside a project", () => {
  expect(containersSummary(["open"], "Placement not read — HQ is unavailable").line).toBe(
    "Placement not read — HQ is unavailable · 1 ready",
  );
});
