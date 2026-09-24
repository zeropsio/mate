import { describe, expect, it } from "vite-plus/test";

import type { Deployment } from "./flow/deployment.ts";
import {
  groupFlow,
  pairPreviewRoute,
  type GroupFlowInput,
  type GroupFlowStopInput,
} from "./groupFlow.ts";
import { deployedVersion, environmentRow } from "./groupRows.ts";
import type { Shown } from "./knowledge/known.ts";
import type { FlowPullRequest } from "./projectFlow.ts";

const MAIN_SHA = "055a7e8f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f";
const STAGE_SHA = "e014b0e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d1";

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

const known = (value: Deployment): Shown<Deployment> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "live" },
});
const NOTHING_RUNS = known({ kind: "none" });
const runs = (sha: string): Shown<Deployment> =>
  known({ kind: "running", activatedAt: null, version: deployedVersion(sha) });

/** A declared stop's row as the deploy half reads it: the version name and the broker's status. */
function declared(input: {
  readonly projectId: string;
  readonly name: string;
  readonly tier: "stage" | "production";
  readonly appVersionName?: string;
  readonly status?: "success" | "failure" | "pending";
}): GroupFlowStopInput["row"] {
  const environment = input.tier;
  return environmentRow({
    projectId: input.projectId,
    name: input.name,
    tier: input.tier,
    sources: input.tier === "production" ? "release" : ["main"],
    environment,
    services: [
      {
        hostname: "app",
        ...(input.appVersionName === undefined ? {} : { appVersionName: input.appVersionName }),
        ...(input.status === undefined
          ? {}
          : { statuses: [{ context: `mate/deploy/${environment}/app`, state: input.status }] }),
      },
    ],
  });
}

const CLOSED = { allowed: false, reason: "Nothing is merged to release." } as const;

function group(over: Partial<GroupFlowInput>): GroupFlowInput {
  return {
    groupId: "g",
    mates: [],
    pullRequests: [],
    merged: [],
    stops: [],
    missing: [],
    release: { gate: CLOSED, suggestion: "v0.1.0", waiting: 0 },
    mainHasCode: undefined,
    mainHead: undefined,
    productionAddable: true,
    ...over,
  };
}

/** `fsadfdasfsa`: a production that runs nothing, and #4 merged to main and not live. */
const FSADFDASFSA = group({
  groupId: "fsadfdasfsa",
  mates: [{ projectId: "p-juno", name: "Juno", preview: undefined, waiting: false, talked: true }],
  merged: [pull({ number: 4, title: "Mate: weatherdev", merged: true, mateProjectId: "p-juno" })],
  stops: [
    {
      projectId: "p-prod",
      name: "production",
      tier: "production",
      // The deploy half's REST read names a commit; the platform says nothing is active.
      row: declared({
        projectId: "p-prod",
        name: "production",
        tier: "production",
        appVersionName: MAIN_SHA,
      }),
      deployment: NOTHING_RUNS,
      route: undefined,
    },
  ],
  release: { gate: { allowed: true }, suggestion: "v0.1.0", waiting: 1 },
  mainHasCode: true,
  mainHead: MAIN_SHA,
});

/** `sm-fixture`: #1 mergeable with no checks, a stage on e014b0e, no production, code on main. */
const SM_FIXTURE = group({
  groupId: "sm-fixture",
  mates: [{ projectId: "p-wren", name: "Wren", preview: undefined, waiting: false, talked: false }],
  pullRequests: [pull()],
  stops: [
    {
      projectId: "p-stage",
      name: "stage",
      tier: "stage",
      row: declared({
        projectId: "p-stage",
        name: "stage",
        tier: "stage",
        appVersionName: STAGE_SHA,
        status: "success",
      }),
      deployment: runs(STAGE_SHA),
      route: "https://app-31f4-3000.prg1.zerops.app",
    },
  ],
  missing: [{ tier: "production" }],
  mainHasCode: true,
});

/** `testzcp`: one Mate that talked, nothing opened, nothing merged. */
const TESTZCP = group({
  groupId: "testzcp",
  mates: [
    {
      projectId: "p-rune",
      name: "Rune",
      preview: "https://appstage-1a2b-3000.prg1.zerops.app",
      waiting: false,
      talked: true,
    },
  ],
  missing: [{ tier: "stage" }, { tier: "production" }],
  mainHasCode: false,
});

/** `sm-birth-1`: one Mate nobody has spoken to yet. */
const SM_BIRTH_1 = group({
  groupId: "sm-birth-1",
  mates: [{ projectId: "p-uma", name: "Uma", preview: undefined, waiting: false, talked: false }],
});

/** `zerops-mate`: two Mates, a stage project with no services in it, no production. */
const ZEROPS_MATE = group({
  groupId: "zerops-mate",
  mates: [
    { projectId: "p-pia", name: "Pia", preview: undefined, waiting: false, talked: true },
    { projectId: "p-cleo", name: "Cleo", preview: undefined, waiting: false, talked: false },
  ],
  stops: [
    {
      projectId: "p-zm-stage",
      name: "zerops-mate - stage",
      tier: "stage",
      row: undefined,
      deployment: NOTHING_RUNS,
      route: undefined,
    },
  ],
  mainHasCode: false,
});

describe("groupFlow", () => {
  it("offers the release where production runs nothing and one change is merged (fsadfdasfsa)", () => {
    const flow = groupFlow(FSADFDASFSA);
    expect(flow.production).toMatchObject({
      kind: "ready-to-release",
      candidate: { tag: "v0.1.0", waiting: 1 },
      line: "Nothing live yet",
      stop: { projectId: "p-prod", state: "empty", version: undefined },
    });
    expect(flow.main).toEqual({ head: "055a7e8", hasCode: true, notLive: 1 });
    expect(flow.nextStep).toEqual({
      kind: "release",
      text: "1 change is merged and not live",
      verb: "Release v0.1.0",
      target: { kind: "release", tag: "v0.1.0" },
    });
  });

  it("asks for the merge first, and adds production once it has landed (sm-fixture)", () => {
    const flow = groupFlow(SM_FIXTURE);
    expect(flow.nextStep).toEqual({
      kind: "merge",
      text: "Pull request #1 waits for your merge",
      verb: "Merge",
      target: { kind: "change", repository: "app", number: 1 },
    });
    expect(flow.pullRequests).toEqual([
      { pull: pull(), blocked: null, state: { word: "Unchecked", tone: "off" } },
    ]);
    expect(flow.stages).toEqual([
      {
        projectId: "p-stage",
        name: "stage",
        state: "deployed",
        version: deployedVersion(STAGE_SHA),
        source: "main",
        route: "https://app-31f4-3000.prg1.zerops.app",
      },
    ]);
    expect(flow.production).toEqual({ kind: "absent", line: "Not set up", addable: true });

    const merged = groupFlow({
      ...SM_FIXTURE,
      pullRequests: [],
      merged: [pull({ merged: true })],
    });
    expect(merged.nextStep).toEqual({
      kind: "add-production",
      text: "main has code, no production yet",
      verb: "Add production",
      target: { kind: "add-production" },
    });
  });

  it("reads production as after the first merge while main is empty (testzcp)", () => {
    const flow = groupFlow(TESTZCP);
    expect(flow.production).toEqual({
      kind: "absent",
      line: "After the first merge",
      addable: false,
    });
    expect(flow.main).toEqual({ head: undefined, hasCode: false, notLive: 0 });
    expect(flow.mates[0]?.preview).toBe("https://appstage-1a2b-3000.prg1.zerops.app");
    expect(flow.nextStep).toEqual({
      kind: "none",
      text: "Nothing needs you here.",
      verb: undefined,
      target: undefined,
    });
  });

  it("asks for a first task where no Mate has been spoken to (sm-birth-1)", () => {
    expect(groupFlow(SM_BIRTH_1).nextStep).toEqual({
      kind: "first-task",
      text: "Give Uma a first task",
      verb: "Open Uma",
      target: { kind: "mate", projectId: "p-uma" },
    });
  });

  it("draws an empty stage as empty and asks nothing of two Mates, one of them working (zerops-mate)", () => {
    const flow = groupFlow(ZEROPS_MATE);
    expect(flow.stages).toEqual([
      {
        projectId: "p-zm-stage",
        name: "zerops-mate - stage",
        state: "empty",
        version: undefined,
        source: undefined,
        route: undefined,
      },
    ]);
    expect(flow.production).toEqual({
      kind: "absent",
      line: "After the first merge",
      addable: false,
    });
    expect(flow.nextStep.kind).toBe("none");
  });

  const WREN_WAITING = {
    ...SM_FIXTURE,
    mates: [{ projectId: "p-wren", name: "Wren", preview: undefined, waiting: true, talked: true }],
  };
  const STAGE_FAILED = {
    ...SM_FIXTURE,
    stops: SM_FIXTURE.stops.map((stop) => ({
      ...stop,
      row: declared({
        projectId: "p-stage",
        name: "stage",
        tier: "stage",
        appVersionName: STAGE_SHA,
        status: "failure",
      }),
    })),
  };
  /** `fsadfdasfsa` with its stage failing: nothing waits on it but a release. */
  const STAGE_FAILED_WITH_RELEASE = {
    ...FSADFDASFSA,
    stops: [
      ...FSADFDASFSA.stops,
      {
        projectId: "p-stage",
        name: "stage",
        tier: "stage" as const,
        row: declared({
          projectId: "p-stage",
          name: "stage",
          tier: "stage",
          appVersionName: STAGE_SHA,
          status: "failure",
        }),
        deployment: runs(STAGE_SHA),
        route: undefined,
      },
    ],
  };

  it.each([
    {
      case: "a Mate waiting on an answer outranks the merge",
      input: WREN_WAITING,
      step: {
        kind: "answer-mate",
        text: "Wren is waiting on an answer",
        verb: "Open",
        target: { kind: "mate", projectId: "p-wren" },
      },
    },
    {
      // A stage is never what a release, or anything else, waits behind
      // (D28): its own failure stays on its own row and never becomes the
      // one next step.
      case: "a failed stage never becomes the next step, and does not outrank the merge",
      input: STAGE_FAILED,
      step: {
        kind: "merge",
        text: "Pull request #1 waits for your merge",
        verb: "Merge",
        target: { kind: "change", repository: "app", number: 1 },
      },
    },
    {
      case: "a failed stage does not hide a release either (D28)",
      input: STAGE_FAILED_WITH_RELEASE,
      step: {
        kind: "release",
        text: "1 change is merged and not live",
        verb: "Release v0.1.0",
        target: { kind: "release", tag: "v0.1.0" },
      },
    },
    {
      case: "a change that cannot land is the Mate's to fix",
      input: {
        ...SM_FIXTURE,
        pullRequests: [pull({ mergeability: "conflicting", checks: "failing" })],
      },
      step: {
        kind: "unblock",
        text: "#1 checks failed",
        verb: "Ask Wren",
        target: { kind: "change", repository: "app", number: 1 },
      },
    },
    {
      case: "a merge the person can make outranks one that cannot land",
      input: {
        ...SM_FIXTURE,
        pullRequests: [pull({ number: 2, mergeability: "conflicting", checks: "failing" }), pull()],
      },
      step: {
        kind: "merge",
        text: "Pull request #1 waits for your merge",
        verb: "Merge",
        target: { kind: "change", repository: "app", number: 1 },
      },
    },
    {
      case: "a merge outranks a release",
      input: { ...FSADFDASFSA, pullRequests: [pull({ number: 5, mateProjectId: "p-juno" })] },
      step: {
        kind: "merge",
        text: "Pull request #5 waits for your merge",
        verb: "Merge",
        target: { kind: "change", repository: "app", number: 5 },
      },
    },
    {
      case: "a recipe change is not the flow's merge",
      input: {
        ...FSADFDASFSA,
        pullRequests: [pull({ repository: "group", kind: "recipe", number: 6 })],
      },
      step: {
        kind: "release",
        text: "1 change is merged and not live",
        verb: "Release v0.1.0",
        target: { kind: "release", tag: "v0.1.0" },
      },
    },
  ])("takes the worst step first: $case", ({ input, step }) => {
    expect(groupFlow(input).nextStep).toEqual(step);
  });

  const productionOf = (
    over: Partial<GroupFlowStopInput>,
    release: GroupFlowInput["release"] = { gate: CLOSED, suggestion: "v0.1.1", waiting: 0 },
  ) => {
    const [stop] = FSADFDASFSA.stops;
    return groupFlow({
      ...FSADFDASFSA,
      release,
      stops: stop === undefined ? [] : [{ ...stop, ...over }],
    }).production;
  };
  const released = `${MAIN_SHA} v0.1.0 ada`;

  it.each([
    {
      case: "live: it runs the release and nothing is waiting",
      production: productionOf({
        row: declared({
          projectId: "p-prod",
          name: "production",
          tier: "production",
          appVersionName: released,
          status: "success",
        }),
        deployment: runs(MAIN_SHA),
      }),
      expected: { kind: "live", line: "v0.1.0", stop: { state: "deployed" } },
    },
    {
      case: "deploy-failed: the broker's status on the release failed, whatever is waiting",
      production: productionOf(
        {
          row: declared({
            projectId: "p-prod",
            name: "production",
            tier: "production",
            appVersionName: released,
            status: "failure",
          }),
          deployment: runs(MAIN_SHA),
        },
        { gate: { allowed: true }, suggestion: "v0.1.1", waiting: 2 },
      ),
      // The failure does not swallow the release that might clear it (D28):
      // a broken production still carries the candidate a new tag would cut.
      expected: {
        kind: "deploy-failed",
        line: "v0.1.0",
        stop: { state: "failed" },
        candidate: { tag: "v0.1.1", waiting: 2 },
      },
    },
    {
      case: "empty: it runs nothing and there is nothing to release",
      production: productionOf({}),
      expected: { kind: "empty", line: "Nothing live yet", stop: { state: "empty" } },
    },
    {
      case: "checking: the platform has not answered and the row names nothing",
      production: productionOf({
        row: declared({ projectId: "p-prod", name: "production", tier: "production" }),
        deployment: { state: "unread", waitingFor: null },
      }),
      expected: { kind: "checking", line: "Checking what runs here…", stop: { state: "checking" } },
    },
    {
      case: "the row's name stands for a deploy while the platform's answer is on its way",
      production: productionOf({ deployment: undefined }),
      expected: { kind: "live", line: "055a7e8", stop: { state: "deployed" } },
    },
  ])("reads production as $case", ({ production, expected }) => {
    expect(production).toMatchObject(expected);
  });

  it("says a release is on its way and offers no Release while one is in flight", () => {
    const flow = groupFlow({
      ...FSADFDASFSA,
      release: {
        gate: { allowed: false, reason: "Releasing v0.1.0…" },
        suggestion: "v0.1.1",
        waiting: 1,
        inFlight: "v0.1.0",
      },
    });
    expect(flow.production).toMatchObject({ kind: "releasing", tag: "v0.1.0" });
    expect(flow.nextStep.kind).not.toBe("release");
  });

  it("still ranks a failed production above the release, unlike a failed stage", () => {
    const flow = groupFlow({
      ...FSADFDASFSA,
      stops: [
        {
          ...FSADFDASFSA.stops[0]!,
          row: declared({
            projectId: "p-prod",
            name: "production",
            tier: "production",
            appVersionName: MAIN_SHA,
            status: "failure",
          }),
          deployment: runs(MAIN_SHA),
        },
      ],
    });
    expect(flow.nextStep).toEqual({
      kind: "fix-deploy",
      text: "The last deploy to production failed",
      verb: "See the build",
      target: { kind: "stop", projectId: "p-prod" },
    });
    expect(flow.production).toMatchObject({
      kind: "deploy-failed",
      candidate: { tag: "v0.1.0", waiting: 1 },
    });
  });

  // Wren has been spoken to, so an empty flow asks for no first task.
  const LANDED = {
    ...SM_FIXTURE,
    mates: [
      { projectId: "p-wren", name: "Wren", preview: undefined, waiting: false, talked: true },
    ],
    pullRequests: [],
  };

  it.each([
    { case: "main has code and the recipe's production is on main", input: LANDED, addable: true },
    {
      case: "the person may not add one",
      input: { ...LANDED, productionAddable: false },
      addable: false,
    },
    {
      case: "the recipe's production tier is not on main yet",
      input: { ...LANDED, missing: [] },
      addable: false,
    },
    {
      case: "main was not read and nothing landed",
      input: { ...LANDED, mainHasCode: undefined },
      addable: false,
    },
    {
      case: "main was not read and a code change landed",
      input: { ...LANDED, mainHasCode: undefined, merged: [pull({ merged: true })] },
      addable: true,
    },
    {
      case: "main was not read and only a recipe change landed",
      input: {
        ...LANDED,
        mainHasCode: undefined,
        merged: [pull({ repository: "group", kind: "recipe", merged: true })],
      },
      addable: false,
    },
  ])("offers Add production only where $case → $addable", ({ input, addable }) => {
    const flow = groupFlow(input);
    expect(flow.production).toEqual({ kind: "absent", line: "Not set up", addable });
    expect(flow.nextStep.kind).toBe(addable ? "add-production" : "none");
  });
});

describe("pairPreviewRoute", () => {
  const route = (service: string) => ({
    service,
    port: 3000,
    url: `https://${service}-1a2b-3000.prg1.zerops.app`,
    host: `${service}-1a2b-3000.prg1.zerops.app`,
  });

  it.each([
    {
      case: "the stage half beside its dev half",
      routes: [route("appdev"), route("appstage")],
      hostnames: ["appdev", "appstage", "zcp"],
      preview: "appstage",
    },
    {
      case: "the stage half of a pair grown from one service",
      routes: [route("todoapp"), route("todoappstage")],
      hostnames: ["todoapp", "todoappstage"],
      preview: "todoappstage",
    },
    {
      case: "nothing, where only the dev half is public",
      routes: [route("appdev")],
      hostnames: ["appdev", "appstage"],
      preview: undefined,
    },
    {
      case: "nothing, for a service merely named like a stage half",
      routes: [route("backstage")],
      hostnames: ["backstage"],
      preview: undefined,
    },
  ])("is $case", ({ routes, hostnames, preview }) => {
    expect(pairPreviewRoute(routes, hostnames)?.service).toBe(preview);
  });
});
