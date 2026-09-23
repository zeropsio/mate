import {
  ADD_PRODUCTION_LABEL,
  groupFlow,
  type GroupFlowStop,
  type FlowPullRequest,
  type GroupFlow,
  type GroupFlowInput,
  type GroupNextStepKind,
} from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import {
  containersSummary,
  groupFlowInputOf,
  groupMetaLine,
  lastMergedCode,
  mainCell,
  productionCell,
  pullRequestsLine,
  stopLine,
  foldGroups,
  foldUngrouped,
  nextStepAwaitsSomebody,
  nextStepCell,
  nextStepTone,
  orderByNextStep,
  parseProjectsSearch,
  stripColumns,
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
    mergeable: true,
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
  addProduction: flowOf({
    mainHasCode: true,
    productionAddable: true,
    missing: [{ tier: "production" }],
  }),
} as const;

describe("parseProjectsSearch", () => {
  const cases: ReadonlyArray<
    [string, Record<string, unknown>, ReturnType<typeof parseProjectsSearch>]
  > = [
    ["no view is the Overview", {}, {}],
    ["view=projects opens the Projects view", { view: "projects" }, { view: "projects" }],
    [
      "a group scrolls the Projects view to its card",
      { view: "projects", group: "g1" },
      { view: "projects", group: "g1" },
    ],
    ["an unknown view is the Overview", { view: "table" }, {}],
    ["an empty group names none", { view: "projects", group: "" }, { view: "projects" }],
    ["a group that is not a string names none", { group: 7 }, {}],
    ["a group without a view is kept", { group: "g1" }, { group: "g1" }],
  ];
  for (const [name, raw, expected] of cases) {
    it(name, () => {
      expect(parseProjectsSearch(raw)).toEqual(expected);
    });
  }
});

describe("orderByNextStep", () => {
  it("puts the steps first, worst first, and keeps the tree's order among equals", () => {
    const entries = [
      { id: "none", flow: FLOWS.none },
      { id: "release", flow: FLOWS.release },
      { id: "first-task", flow: FLOWS.firstTask },
      { id: "merge-a", flow: FLOWS.merge },
      { id: "answer", flow: FLOWS.answer },
      { id: "merge-b", flow: FLOWS.merge },
      { id: "add-production", flow: FLOWS.addProduction },
    ];
    expect(orderByNextStep(entries).map((entry) => entry.id)).toEqual([
      "answer",
      "merge-a",
      "merge-b",
      "release",
      "add-production",
      "first-task",
      "none",
    ]);
  });
});

describe("foldGroups", () => {
  const STAGE = { ...PRODUCTION, projectId: "p-stage", name: "stage", tier: "stage" as const };
  const cases: ReadonlyArray<
    [string, { readonly flow: GroupFlow; readonly read: boolean }, "active" | "early", boolean]
  > = [
    [
      "a group with only a Mate nobody has spoken to folds into a tile",
      { flow: FLOWS.firstTask, read: true },
      "early",
      false,
    ],
    [
      "a group whose flow is not read yet stays a row: unread is not empty",
      { flow: FLOWS.firstTask, read: false },
      "active",
      false,
    ],
    [
      "a group with a stage is more than a Mate",
      { flow: flowOf({ mates: [{ ...MATE, talked: false }], stops: [STAGE] }), read: true },
      "active",
      false,
    ],
    [
      "a group whose Mate was spoken to has work on it",
      { flow: FLOWS.none, read: true },
      "active",
      false,
    ],
    ["a merge waits in the strip", { flow: FLOWS.merge, read: true }, "active", true],
    ["a release waits in the strip", { flow: FLOWS.release, read: true }, "active", true],
    ["a Mate waiting waits in the strip", { flow: FLOWS.answer, read: true }, "active", true],
    [
      "adding production waits in the strip",
      { flow: FLOWS.addProduction, read: true },
      "active",
      true,
    ],
  ];
  for (const [name, entry, place, waits] of cases) {
    it(name, () => {
      const folded = foldGroups([entry]);
      expect(folded.active.includes(entry)).toBe(place === "active");
      expect(folded.early.includes(entry)).toBe(place === "early");
      expect(folded.nextSteps.includes(entry)).toBe(waits);
    });
  }
});

describe("where a group's next step sits", () => {
  const failing = (tier: "stage" | "production") =>
    flowOf({
      stops: [
        {
          ...PRODUCTION,
          projectId: `p-${tier}`,
          name: tier,
          tier,
          row: {
            kind: "environment",
            projectId: `p-${tier}`,
            name: tier,
            tier,
            source: tier === "stage" ? "main" : "release",
            commit: "e014b0e",
            version: {
              name: undefined,
              commit: "e014b0e",
              sha: undefined,
              taggedBy: undefined,
              label: "e014b0e",
            },
            versionRepository: undefined,
            line: "",
            tone: "bad",
          },
        },
      ],
    });
  const cases: ReadonlyArray<
    [string, GroupFlow, ReturnType<typeof nextStepCell>, ReturnType<typeof nextStepTone>]
  > = [
    ["a Mate waiting is answered in the Mates' cell", FLOWS.answer, "mates", "attention"],
    // The Mate itself is the way in to a first task: no verb in any cell.
    ["a first task gives no cell a verb", FLOWS.firstTask, undefined, "off"],
    ["a merge is the pull request's", FLOWS.merge, "pull-requests", "attention"],
    ["a release is production's", FLOWS.release, "production", "busy"],
    ["adding production is production's", FLOWS.addProduction, "production", "busy"],
    ["a failed production deploy is production's", failing("production"), "production", "failed"],
    // A stage is never what anything downstream waits behind (D28): its own
    // failure stays on its own row and is nobody's next step.
    ["a failed stage deploy is nobody's next step", failing("stage"), undefined, "off"],
    ["nothing to do sits nowhere", FLOWS.none, undefined, "off"],
  ];
  for (const [name, flow, cell, tone] of cases) {
    it(name, () => {
      expect(nextStepCell(flow)).toBe(cell);
      expect(nextStepTone(flow.nextStep.kind)).toBe(tone);
    });
  }
});

describe("nextStepAwaitsSomebody", () => {
  // Every kind, so a new one fails typecheck until it is placed.
  const AWAITS: Record<GroupNextStepKind, boolean> = {
    "answer-mate": true,
    "fix-deploy": true,
    merge: true,
    unblock: true,
    release: true,
    "add-production": true,
    // The Mate is the way in to a first task; nothing waits on anybody.
    "first-task": false,
    none: false,
  };
  it.each(Object.entries(AWAITS))("says %s awaits somebody: %s", (kind, awaits) => {
    expect(nextStepAwaitsSomebody(kind as GroupNextStepKind)).toBe(awaits);
  });
});

describe("stripColumns", () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 2],
    [5, 3],
    [6, 3],
    [7, 3],
  ] as const)(
    "lays %i steps out in %i columns, the rows as even as three columns allow",
    (count, columns) => {
      expect(stripColumns(count)).toBe(columns);
    },
  );
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

describe("foldUngrouped", () => {
  it("keeps a project with no Mate container out of the containers, for its own quiet line", () => {
    const rows = [
      { id: "a", action: "open" as const },
      { id: "ads", action: "set-up-mate" as const },
      { id: "b", action: "retry-probe" as const },
    ];
    const folded = foldUngrouped(rows);
    expect(folded.containers.map((row) => row.id)).toEqual(["a", "b"]);
    expect(folded.withoutMate.map((row) => row.id)).toEqual(["ads"]);
  });
});

describe("the pull requests' cell with none open", () => {
  it.each([
    ["None yet", flowOf()],
    ["None open", flowOf({ merged: [pull({ merged: true })] })],
  ] as const)("reads %s", (line, flow) => {
    expect(pullRequestsLine(flow)).toBe(line);
  });
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

describe("main's cell", () => {
  const MAIN_SHA = "055a7e8f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f";
  const landed = pull({ number: 4, title: "Mate: weatherdev", merged: true });
  const cases: ReadonlyArray<
    [string, GroupFlow, FlowPullRequest | undefined, ReturnType<typeof mainCell>]
  > = [
    [
      "nothing merged and nothing read is an empty step",
      flowOf(),
      undefined,
      { empty: true, head: undefined, title: undefined, state: "Nothing merged" },
    ],
    [
      "a change merged and not live names the change and how many wait",
      flowOf({
        merged: [landed],
        mainHasCode: true,
        mainHead: MAIN_SHA,
        stops: [PRODUCTION],
        release: { gate: { allowed: true }, suggestion: "v0.1.0", waiting: 1 },
      }),
      landed,
      { empty: false, head: "055a7e8", title: "Mate: weatherdev (#4)", state: "1 change not live" },
    ],
    [
      "code on main with nothing waiting says so",
      flowOf({ mainHasCode: true, mainHead: MAIN_SHA }),
      undefined,
      { empty: false, head: "055a7e8", title: undefined, state: "Nothing waiting to release" },
    ],
    [
      "several waiting are counted",
      flowOf({
        merged: [landed],
        stops: [PRODUCTION],
        release: { gate: { allowed: true }, suggestion: "v0.1.0", waiting: 3 },
      }),
      landed,
      {
        empty: false,
        head: undefined,
        title: "Mate: weatherdev (#4)",
        state: "3 changes not live",
      },
    ],
  ];
  for (const [name, flow, merged, expected] of cases) {
    it(name, () => {
      expect(mainCell(flow, merged)).toEqual(expected);
    });
  }
});

describe("groupMetaLine", () => {
  it.each([
    ["1 Mate", flowOf()],
    [
      "2 Mates · 1 open pull request",
      flowOf({ mates: [MATE, { ...MATE, projectId: "p-2", name: "Ada" }], pullRequests: [pull()] }),
    ],
    ["2 open pull requests", flowOf({ mates: [], pullRequests: [pull(), pull({ number: 2 })] })],
    ["No Mate yet", flowOf({ mates: [] })],
  ] as const)("reads %s", (line, flow) => {
    expect(groupMetaLine(flow)).toBe(line);
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
    [{ state: "deploying" }, { word: "Deploying", version: "e014b0e", tone: "busy" }],
    [{ state: "failed" }, { word: "Failed", version: "e014b0e", tone: "failed" }],
    [
      { state: "empty", version: undefined },
      { word: "Nothing deployed yet", version: undefined, tone: "off" },
    ],
    [
      { state: "checking", version: undefined },
      { word: "Checking what runs here…", version: undefined, tone: "off" },
    ],
  ] as const)("reads %j as %j", (over, expected) => {
    expect(stopLine(stop(over))).toEqual(expected);
  });
});

describe("production's cell", () => {
  it("before the first merge reads so, with nothing to press", () => {
    expect(productionCell(flowOf({ mainHasCode: false }))).toEqual({
      empty: true,
      line: "After the first merge",
      detail: undefined,
      tone: "off",
    });
  });

  it("is one line where production is not set up: whose it is to add is the verb's to say", () => {
    expect(productionCell(FLOWS.addProduction)).toEqual({
      empty: true,
      line: "Not set up",
      detail: undefined,
      tone: "off",
    });
    expect(FLOWS.addProduction.nextStep.verb).toBe(ADD_PRODUCTION_LABEL);
  });

  it("names the release that would go, not how much it carries: main's line already counts it", () => {
    expect(productionCell(FLOWS.release)).toEqual({
      empty: false,
      line: "Checking what runs here…",
      detail: "v0.1.0 ready",
      tone: "busy",
    });
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
});
