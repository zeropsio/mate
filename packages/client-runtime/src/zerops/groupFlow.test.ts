import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { Deployment } from "./flow/deployment.ts";
import {
  groupFlow,
  pairPreviewRoute,
  type GroupFlowInput,
  type GroupFlowPending,
  type GroupFlowStopInput,
} from "./groupFlow.ts";
import { deployedVersion, environmentRow, type EnvironmentRow } from "./groupRows.ts";
import type { Shown } from "./knowledge/known.ts";
import { nameStopByRelease } from "./release.ts";
import type { FlowPullRequest } from "./projectFlow.ts";
import { jobInFlight, type HqJob } from "./hq/environments.ts";

/** HQ's job of a deploy in `state`. */
const deployRecord = (state: HqJob["state"]): HqJob => ({
  id: "1",
  kind: "deploy",
  service: "app",
  sha: "0000000000000000000000000000000000000000",
  state,
  cause: "merge",
  ref: null,
  reason: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
  at: "2026-10-02T10:00:00.000Z",
  endedAt: jobInFlight({ state }) ? null : "2026-10-02T10:04:00.000Z",
  supersededBy: null,
});

const MAIN_SHA = "055a7e8f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f";
const STAGE_SHA = "e014b0e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d1";

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

/** A declared stop's row as the deploy half reads it: the version name and its deploy's status. */
function declared(input: {
  readonly projectId: string;
  readonly name: string;
  readonly tier: "stage" | "production";
  readonly appVersionName?: string;
  readonly status?: HqJob["state"];
}): EnvironmentRow {
  return environmentRow({
    projectId: input.projectId,
    name: input.name,
    tier: input.tier,
    sources: input.tier === "production" ? "release" : ["main"],
    services: [
      {
        hostname: "app",
        ...(input.appVersionName === undefined ? {} : { appVersionName: input.appVersionName }),
        ...(input.status === undefined
          ? {}
          : { deploy: { latest: deployRecord(input.status), live: null } }),
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
    release: { gate: CLOSED, suggestion: "v0.1.0", waiting: 0, waitingAtLeast: false, untold: [] },
    mainHasCode: undefined,
    mainHead: undefined,
    pending: [],
    ...over,
  };
}

/** A creation under way in the group, as its birth knows it. */
function creating(over: Partial<GroupFlowPending> = {}): GroupFlowPending {
  return {
    projectId: "p-new",
    kind: "mate",
    name: "Todo - Vera",
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
  release: {
    gate: { allowed: true },
    suggestion: "v0.1.0",
    waiting: 1,
    waitingAtLeast: false,
    untold: [],
  },
  mainHasCode: true,
  mainHead: MAIN_SHA,
});

/** `sm-fixture`: #1 mergeable, a stage on e014b0e, no production, code on main. */
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
        status: "live",
      }),
      deployment: runs(STAGE_SHA),
      route: "https://app-31f4-3000.prg1.zerops.app",
    },
  ],
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
  it("says how many at least are not live where HQ stopped counting", () => {
    const flow = groupFlow({
      ...FSADFDASFSA,
      release: { ...FSADFDASFSA.release, waiting: 10000, waitingAtLeast: true },
    });
    expect(flow.main.notLiveAtLeast).toBe(true);
    expect(flow.nextStep.text).toBe("10000+ changes waiting for production");
  });

  it("offers the release where production runs nothing and one change is merged (fsadfdasfsa)", () => {
    const flow = groupFlow(FSADFDASFSA);
    expect(flow.production).toMatchObject({
      kind: "ready-to-release",
      candidate: { tag: "v0.1.0", waiting: 1 },
      line: "Nothing deployed yet",
      stop: { projectId: "p-prod", state: "empty", version: undefined },
    });
    expect(flow.main).toEqual({
      head: "055a7e8",
      hasCode: true,
      notLive: 1,
      notLiveAtLeast: false,
    });
    expect(flow.nextStep).toEqual({
      kind: "release",
      text: "1 change waiting for production",
      verb: "Review release",
      target: { kind: "release", tag: "v0.1.0" },
    });
  });

  it.each(["mergeable", "conflicting"] as const)(
    "keeps a recipe change in the shared flow and its %s next step",
    (mergeability) => {
      const recipe = pull({ repository: "group", kind: "recipe", number: 3, mergeability });
      const flow = groupFlow({ ...SM_FIXTURE, pullRequests: [recipe] });
      expect(flow.pullRequests.map(({ pull: change }) => change)).toEqual([recipe]);
      expect(flow.nextStep.kind).toBe(mergeability === "mergeable" ? "merge" : "unblock");
      expect(flow.nextStep.target).toEqual({ kind: "change", repository: "group", number: 3 });
    },
  );

  it("asks for the merge first, and adds production once it has landed (sm-fixture)", () => {
    const flow = groupFlow(SM_FIXTURE);
    expect(flow.nextStep).toEqual({
      kind: "merge",
      text: "Change #1 waits for your merge",
      verb: "Review",
      target: { kind: "change", repository: "app", number: 1 },
    });
    expect(flow.pullRequests).toEqual([
      { pull: pull(), blocked: null, state: { word: "Ready to merge", tone: "off" }, review: true },
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
    expect(flow.production).toEqual({ kind: "absent" });

    const merged = groupFlow({
      ...SM_FIXTURE,
      pullRequests: [],
      merged: [pull({ merged: true })],
    });
    // A merge with no production asks nothing: a missing environment is a slot, never a step.
    expect(merged.production).toEqual({ kind: "absent" });
    expect(merged.nextStep.kind).toBe("none");
  });

  it("says nothing of production while main is empty (testzcp)", () => {
    const flow = groupFlow(TESTZCP);
    expect(flow.production).toEqual({ kind: "absent" });
    expect(flow.main).toEqual({
      head: undefined,
      hasCode: false,
      notLive: 0,
      notLiveAtLeast: false,
    });
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
    expect(flow.production).toEqual({ kind: "absent" });
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
        status: "failed",
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
          status: "failed",
        }),
        deployment: runs(STAGE_SHA),
        route: undefined,
      },
    ],
  };

  const WREN_FAILED = {
    ...SM_FIXTURE,
    mates: [
      {
        projectId: "p-wren",
        name: "Wren",
        preview: undefined,
        waiting: true,
        failed: true,
        talked: true,
      },
    ],
  };

  it.each([
    {
      // Its face waits like a question's, but it asks nothing: the step is
      // the failure it stopped on, in the failure's own tone.
      case: "a Mate stopped on an error is the step, ahead of the merge",
      input: WREN_FAILED,
      step: {
        kind: "fix-mate",
        text: "Wren stopped on an error",
        verb: "Open",
        target: { kind: "mate", projectId: "p-wren" },
      },
    },
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
      // A failed stage is a failed stop like production's (owner,
      // 2026-09-25): the heading's one step is fixing it, ahead of a merge.
      case: "a failed stage is the deploy to fix, ahead of the merge",
      input: STAGE_FAILED,
      step: {
        kind: "fix-deploy",
        text: "The last deploy to stage failed",
        verb: "See the build",
        target: { kind: "stop", projectId: "p-stage" },
      },
    },
    {
      case: "a failed stage is the deploy to fix, ahead of a release",
      input: STAGE_FAILED_WITH_RELEASE,
      step: {
        kind: "fix-deploy",
        text: "The last deploy to stage failed",
        verb: "See the build",
        target: { kind: "stop", projectId: "p-stage" },
      },
    },
    {
      case: "a change that cannot land is the Mate's to fix",
      input: {
        ...SM_FIXTURE,
        pullRequests: [pull({ mergeability: "conflicting" })],
      },
      step: {
        kind: "unblock",
        text: "#1 conflicts with main",
        verb: "Ask Wren",
        target: { kind: "change", repository: "app", number: 1 },
      },
    },
    {
      case: "a merge the person can make outranks one that cannot land",
      input: {
        ...SM_FIXTURE,
        pullRequests: [pull({ number: 2, mergeability: "conflicting" }), pull()],
      },
      step: {
        kind: "merge",
        text: "Change #1 waits for your merge",
        verb: "Review",
        target: { kind: "change", repository: "app", number: 1 },
      },
    },
    {
      case: "a merge outranks a release",
      input: { ...FSADFDASFSA, pullRequests: [pull({ number: 5, mateProjectId: "p-juno" })] },
      step: {
        kind: "merge",
        text: "Change #5 waits for your merge",
        verb: "Review",
        target: { kind: "change", repository: "app", number: 5 },
      },
    },
    {
      case: "a recipe change waits for review before a release",
      input: {
        ...FSADFDASFSA,
        pullRequests: [pull({ repository: "group", kind: "recipe", number: 6 })],
      },
      step: {
        kind: "merge",
        text: "Change #6 waits for your merge",
        verb: "Review",
        target: { kind: "change", repository: "group", number: 6 },
      },
    },
  ])("takes the worst step first: $case", ({ input, step }) => {
    expect(groupFlow(input).nextStep).toEqual(step);
  });

  // A change asks for the merge only once its Mate described it at its head, and never while its
  // Mate still works: the description would trail what it does.
  it.each([
    ["a change described at its head, its Mate at rest", SM_FIXTURE, "merge"],
    ["a draft", { ...SM_FIXTURE, pullRequests: [pull({ ready: false })] }, "none"],
    [
      "a described change whose Mate still works",
      { ...SM_FIXTURE, mates: SM_FIXTURE.mates.map((mate) => ({ ...mate, working: true })) },
      "none",
    ],
    [
      "another Mate works",
      {
        ...SM_FIXTURE,
        mates: [
          ...SM_FIXTURE.mates,
          {
            projectId: "p-juno",
            name: "Juno",
            preview: undefined,
            waiting: false,
            talked: false,
            working: true,
          },
        ],
      },
      "merge",
    ],
  ] as const)("asks for a merge only of a change ready for it: %s", (_case, input, kind) => {
    const flow = groupFlow(input);
    expect(flow.nextStep.kind).toBe(kind);
    // Its row shows Review by the rule the next step reads (`changeShowsReview`).
    expect(flow.pullRequests.map((entry) => entry.review)).toEqual([kind === "merge"]);
  });

  const productionOf = (
    over: Partial<GroupFlowStopInput>,
    release: GroupFlowInput["release"] = {
      gate: CLOSED,
      suggestion: "v0.1.1",
      waiting: 0,
      waitingAtLeast: false,
      untold: [],
    },
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
          status: "live",
        }),
        deployment: runs(MAIN_SHA),
      }),
      expected: { kind: "live", line: "v0.1.0", stop: { state: "deployed" } },
    },
    {
      case: "live under the release every service runs, over the first service's own tag",
      production: productionOf({
        row: nameStopByRelease(
          declared({
            projectId: "p-prod",
            name: "production",
            tier: "production",
            appVersionName: released,
            status: "live",
          }),
          "v0.1.4",
        ),
        deployment: runs(MAIN_SHA),
      }),
      expected: {
        kind: "live",
        line: "v0.1.4",
        stop: { state: "deployed", version: { label: "v0.1.4", commit: MAIN_SHA.slice(0, 7) } },
      },
    },
    {
      case: "live under what the platform runs, over a row read at an older release",
      production: productionOf({
        row: declared({
          projectId: "p-prod",
          name: "production",
          tier: "production",
          appVersionName: released,
          status: "live",
        }),
        deployment: known({
          kind: "running",
          activatedAt: null,
          version: deployedVersion(`${STAGE_SHA} v0.1.1 ada`),
        }),
      }),
      expected: {
        kind: "live",
        line: "v0.1.1",
        stop: { state: "deployed", version: { label: "v0.1.1", commit: STAGE_SHA.slice(0, 7) } },
      },
    },
    {
      case: "deploy-failed: the release's deploy failed on production, whatever is waiting",
      production: productionOf(
        {
          row: declared({
            projectId: "p-prod",
            name: "production",
            tier: "production",
            appVersionName: released,
            status: "failed",
          }),
          deployment: runs(MAIN_SHA),
        },
        {
          gate: { allowed: true },
          suggestion: "v0.1.1",
          waiting: 2,
          waitingAtLeast: false,
          untold: [],
        },
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
      expected: { kind: "empty", line: "Nothing deployed yet", stop: { state: "empty" } },
    },
    ...(
      [
        { deployment: { state: "unread", waitingFor: null }, line: "Checking what runs here…" },
        {
          deployment: {
            state: "failed",
            failure: { kind: "transport", detail: "closed" },
            atMs: 0,
            attempt: 1,
            retryAtMs: null,
          },
          line: "Couldn't read what runs here. Zerops didn't answer.",
        },
      ] as const
    ).map(({ deployment, line }) => ({
      case: `the flow's version stands while unread, but the runtime failure stays visible: ${deployment.state}`,
      production: productionOf({
        row: declared({
          projectId: "p-prod",
          name: "production",
          tier: "production",
          appVersionName: released,
          status: "live",
        }),
        deployment,
      }),
      expected:
        deployment.state === "unread"
          ? { kind: "live", line: "v0.1.0", stop: { state: "deployed" } }
          : {
              kind: "checking",
              line,
              stop: { state: "checking", version: undefined, readFailed: true },
            },
    })),
    {
      case: "checking: the platform has not answered and the row names nothing",
      production: productionOf({
        row: declared({ projectId: "p-prod", name: "production", tier: "production" }),
        deployment: { state: "unread", waitingFor: null },
      }),
      expected: { kind: "checking", line: "Checking what runs here…", stop: { state: "checking" } },
    },
    {
      case: "checking: access to it is still being verified, which is no failed read",
      production: productionOf({
        row: declared({ projectId: "p-prod", name: "production", tier: "production" }),
        deployment: { state: "withheld", reason: "access-unverified", cause: null },
      }),
      expected: {
        kind: "checking",
        line: "Checking your access to this project…",
        stop: expect.not.objectContaining({ readFailed: true }),
      },
    },
    {
      case: "live: the platform runs the release a pending status was read on before it went active",
      production: productionOf({
        row: declared({
          projectId: "p-prod",
          name: "production",
          tier: "production",
          appVersionName: released,
          status: "building",
        }),
        deployment: runs(MAIN_SHA),
      }),
      expected: { kind: "live", line: "v0.1.0", stop: { state: "deployed" } },
    },
    {
      case: "deploying: the platform's build runs on it, whatever the row read before",
      production: productionOf({
        row: declared({
          projectId: "p-prod",
          name: "production",
          tier: "production",
          appVersionName: released,
          status: "live",
        }),
        deployment: known({
          kind: "deploying",
          version: deployedVersion(MAIN_SHA),
          previous: { kind: "running", activatedAt: null, version: deployedVersion(released) },
        }),
      }),
      expected: { kind: "deploying", line: "Deploying…", stop: { state: "deploying" } },
    },
    {
      case: "the flow's name stands for a deploy while the platform answer is on its way",
      production: productionOf({ deployment: undefined }),
      expected: { kind: "live", line: "055a7e8", stop: { state: "deployed" } },
    },
  ])("reads production as $case", ({ production, expected }) => {
    expect(production).toMatchObject(expected);
  });

  // A production service whose commit cannot be told counts nothing, and is no proof that nothing
  // waits: the release stays offered.
  it("offers the release where what production runs cannot be told, though nothing is counted", () => {
    const flow = groupFlow({
      ...FSADFDASFSA,
      release: {
        gate: { allowed: true },
        suggestion: "v0.1.0",
        waiting: 0,
        waitingAtLeast: false,
        untold: ["app"],
      },
    });
    expect(flow.production).toMatchObject({
      kind: "ready-to-release",
      candidate: { tag: "v0.1.0", waiting: 0 },
    });
  });

  it("says a release is on its way and offers no Release while one is in flight", () => {
    const flow = groupFlow({
      ...FSADFDASFSA,
      release: {
        gate: { allowed: false, reason: "Releasing v0.1.0…" },
        suggestion: "v0.1.1",
        waiting: 1,
        waitingAtLeast: false,
        untold: [],
        inFlight: "v0.1.0",
      },
    });
    expect(flow.production).toMatchObject({ kind: "releasing", tag: "v0.1.0" });
    expect(flow.nextStep.kind).not.toBe("release");
  });

  it("still ranks a failed production above the release", () => {
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
            status: "failed",
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

  it("names production's failure before a stage's, and keeps the release a failed stage does not block", () => {
    const [production] = FSADFDASFSA.stops;
    const flow = groupFlow({
      ...STAGE_FAILED_WITH_RELEASE,
      stops: [
        ...STAGE_FAILED_WITH_RELEASE.stops.filter((stop) => stop.tier === "stage"),
        {
          ...production!,
          row: declared({
            projectId: "p-prod",
            name: "production",
            tier: "production",
            appVersionName: MAIN_SHA,
            status: "failed",
          }),
          deployment: runs(MAIN_SHA),
        },
      ],
    });
    expect(flow.nextStep.target).toEqual({ kind: "stop", projectId: "p-prod" });
    // D28: the stage's failure takes the heading's step, never the release.
    expect(groupFlow(STAGE_FAILED_WITH_RELEASE).production).toMatchObject({
      kind: "ready-to-release",
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

  // P2 (2026-10-05): an environment nobody added is a quiet slot, never a step, a dot or a count —
  // whatever main holds.
  it.each([
    { case: "main has code", input: LANDED },
    {
      case: "main was not read and a code change landed",
      input: { ...LANDED, mainHasCode: undefined, merged: [pull({ merged: true })] },
    },
    { case: "main was not read and nothing landed", input: { ...LANDED, mainHasCode: undefined } },
    { case: "main is empty", input: { ...LANDED, mainHasCode: false } },
  ])("asks nothing about an absent production where $case", ({ input }) => {
    const flow = groupFlow(input);
    expect(flow.production).toEqual({ kind: "absent" });
    expect(flow.nextStep.kind).toBe("none");
  });
});

describe("groupFlow — creations under way", () => {
  const LANDED = {
    ...SM_FIXTURE,
    mates: [
      { projectId: "p-wren", name: "Wren", preview: undefined, waiting: false, talked: true },
    ],
    pullRequests: [],
  };

  it("draws a Mate being created after the listed ones, as coming and never asked anything", () => {
    const flow = groupFlow({
      ...SM_BIRTH_1,
      pending: [creating()],
    });
    expect(flow.mates).toEqual([
      { projectId: "p-uma", name: "Uma", preview: undefined, waiting: false, talked: false },
      {
        projectId: "p-new",
        name: "Todo - Vera",
        preview: undefined,
        waiting: false,
        talked: false,
        coming: {},
      },
    ]);
    // The first task is still the listed Mate's: one being created cannot take one yet.
    expect(flow.nextStep.target).toEqual({ kind: "mate", projectId: "p-uma" });
  });

  it("draws a Mate being created in the face its person picked", () => {
    const flow = groupFlow({
      ...SM_BIRTH_1,
      pending: [{ ...creating(), face: { tint: "sky", shape: "flower" } }],
    });
    expect(flow.mates.find((mate) => mate.projectId === "p-new")?.coming).toEqual({
      face: { tint: "sky", shape: "flower" },
    });
  });

  it("draws a Mate whose creation stopped before the platform took it as stopped", () => {
    const flow = groupFlow({
      ...SM_BIRTH_1,
      pending: [{ ...creating(), failed: true }],
    });
    expect(flow.mates.find((mate) => mate.projectId === "p-new")?.coming).toEqual({
      failed: true,
    });
  });

  it("draws a listed Mate once, whatever creation still names it", () => {
    const flow = groupFlow({ ...SM_BIRTH_1, pending: [creating({ projectId: "p-uma" })] });
    expect(flow.mates.map((mate) => mate.projectId)).toEqual(["p-uma"]);
  });

  it.each([
    {
      case: "production being created is setting up",
      input: { ...LANDED, pending: [creating({ kind: "production", name: "Todo - production" })] },
      production: {
        kind: "creating",
        line: "Setting up production…",
        creation: creating({ kind: "production", name: "Todo - production" }),
      },
      next: "none",
    },
    {
      case: "a production the listing holds is read from its stop, not its creation",
      input: {
        ...FSADFDASFSA,
        pending: [creating({ projectId: "p-prod", kind: "production" })],
      },
      production: { kind: "ready-to-release" },
      next: "release",
    },
    {
      case: "a stage or a Mate being created leaves production absent",
      input: { ...LANDED, pending: [creating(), creating({ projectId: "p-st", kind: "stage" })] },
      production: { kind: "absent" },
      next: "none",
    },
  ])("$case", ({ input, production, next }) => {
    const flow = groupFlow(input);
    expect(flow.production).toMatchObject(production);
    expect(flow.nextStep.kind).toBe(next);
  });

  it("offers no release to a production still being created", () => {
    const flow = groupFlow({
      ...LANDED,
      merged: [pull({ merged: true })],
      release: {
        gate: { allowed: true },
        suggestion: "v0.1.0",
        waiting: 1,
        waitingAtLeast: false,
        untold: [],
      },
      pending: [creating({ kind: "production" })],
    });
    expect(flow.production.kind).toBe("creating");
    expect(flow.nextStep.kind).toBe("none");
  });

  it("carries a stage being created beside the listed stages, until the listing holds it", () => {
    const stage = creating({ projectId: "p-new-stage", kind: "stage", name: "Todo - stage" });
    const flow = groupFlow({ ...SM_FIXTURE, pending: [stage, creating()] });
    expect(flow.creatingStages).toEqual([stage]);
    expect(flow.stages.map((entry) => entry.projectId)).toEqual(["p-stage"]);

    const listed = groupFlow({
      ...SM_FIXTURE,
      pending: [creating({ projectId: "p-stage", kind: "stage" })],
    });
    expect(listed.creatingStages).toEqual([]);
  });
});

describe("groupFlow — a stage's first deploy, while it runs nothing (run 4)", () => {
  const NOW = Date.parse("2026-10-02T12:00:00.000Z");
  const MINUTE = 60_000;
  const at = (msAgo: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - msAgo));
  const stageStop = (over: Partial<GroupFlowStopInput> = {}): GroupFlowStopInput => ({
    projectId: "p-pantry-stage",
    name: "Pantry - stage",
    tier: "stage",
    projectStatus: "ACTIVE",
    row: declared({ projectId: "p-pantry-stage", name: "Pantry - stage", tier: "stage" }),
    deployment: NOTHING_RUNS,
    route: undefined,
    ...over,
  });
  /** The stage's row with HQ's newest job of each of its services, asked for `msAgo`. */
  const withDeploys = (
    ...deploys: ReadonlyArray<
      Partial<HqJob> & { readonly state: HqJob["state"]; readonly msAgo: number }
    >
  ): EnvironmentRow =>
    environmentRow({
      projectId: "p-pantry-stage",
      name: "Pantry - stage",
      tier: "stage",
      sources: ["main"],
      services: deploys.map(({ state, msAgo, ...over }, index) => {
        const latest: HqJob = { ...deployRecord(state), at: at(msAgo), ...over };
        return { hostname: `app${String(index)}`, deploy: { latest, live: null } };
      }),
    });
  it.each([
    { keyHeld: false, keyInvalid: false, keyGap: true },
    { keyHeld: true, keyInvalid: true, keyGap: true },
    { keyHeld: true, keyInvalid: false, keyGap: false },
  ])("reads HQ's key, held $keyHeld and invalid $keyInvalid, as a gap: $keyGap", (key) => {
    const row = environmentRow({
      projectId: "p-pantry-stage",
      name: "Pantry - stage",
      tier: "stage",
      sources: ["main"],
      services: [],
      keyHeld: key.keyHeld,
      keyInvalid: key.keyInvalid,
    });
    expect(row.keyGap).toBe(key.keyGap);
  });

  it.each([
    {
      case: "HQ queued its first deploy: on its way",
      row: withDeploys({ state: "queued", msAgo: MINUTE }),
      first: { kind: "on-its-way" },
    },
    {
      case: "HQ building one service, another queued: on its way",
      row: withDeploys({ state: "building", msAgo: MINUTE }, { state: "queued", msAgo: MINUTE }),
      first: { kind: "on-its-way" },
    },
    {
      case: "HQ says its build failed: the first deploy failed, however long ago",
      row: withDeploys({ state: "failed", msAgo: 60 * MINUTE }),
      first: { kind: "failed" },
    },
    {
      case: "HQ refused it, nothing tried twice: the first deploy failed",
      row: withDeploys({ state: "refused", msAgo: MINUTE }),
      first: { kind: "failed" },
    },
    {
      case: "HQ holds no deploy key for it: held for the key",
      row: { ...withDeploys({ state: "queued", msAgo: MINUTE }), keyGap: true },
      first: { kind: "held" },
    },
    {
      case: "a job HQ still follows, however long ago it was asked: on its way",
      row: withDeploys({ state: "building", msAgo: 60 * MINUTE }),
      first: { kind: "on-its-way" },
    },
    {
      case: "a job superseded, none after it: nothing promised",
      row: withDeploys({ state: "superseded", msAgo: MINUTE }),
      first: undefined,
    },
  ])("$case", ({ row, first }) => {
    const flow = groupFlow(group({ stops: [stageStop({ row })] }));
    expect(flow.stages[0]?.firstDeploy).toEqual(first);
  });

  const queued = withDeploys({ state: "queued", msAgo: MINUTE });
  it.each([
    {
      case: "HQ records no deploy of it: nothing promised",
      over: {},
      first: undefined,
    },
    {
      case: "not declared: nothing asked for",
      over: { row: undefined },
      first: undefined,
    },
    {
      case: "what runs there unread: nothing said of its first deploy",
      over: { row: queued, deployment: undefined },
      first: undefined,
    },
    {
      case: "its project still being made (run 5): the import first, never the runner",
      over: { projectStatus: "CREATING", services: [] },
      mainHasCode: true,
      first: { kind: "setting-up", step: "project" },
    },
    {
      case: "its app still being added: the import first, never the runner",
      over: { services: [{ hostname: "app", status: "CREATING", runtime: true }] },
      mainHasCode: true,
      first: { kind: "setting-up", step: "app" },
    },
    {
      case: "its app being added, what runs there unread: setting up, never Checking",
      over: {
        services: [{ hostname: "app", status: "NEW", runtime: true }],
        deployment: undefined,
      },
      mainHasCode: true,
      first: { kind: "setting-up", step: "app" },
    },
    {
      case: "its import done: the runner",
      over: { services: [{ hostname: "app", status: "ACTIVE", runtime: true }] },
      mainHasCode: true,
      first: undefined,
    },
    {
      case: "running a deploy: none to wait for",
      over: { row: queued, deployment: runs(STAGE_SHA) },
      first: undefined,
    },
  ])("$case", ({ over, first }) => {
    const flow = groupFlow(group({ stops: [stageStop(over)] }));
    expect(flow.stages[0]?.firstDeploy).toEqual(first);
  });

  // A first deploy's end is its owner's to say: HQ's job for a build HQ made, Zerops' end of the
  // process for one it did not — never how long nothing has run.
  const failedBuild = (processId: string): Shown<Deployment> =>
    known({
      kind: "none",
      failedBuild: { processId, reason: "Zerops reports its build failed" },
    });
  it.each([
    {
      case: "HQ says live and Zerops shows nothing running, however long: not failed",
      over: { row: withDeploys({ state: "live", msAgo: 20 * 1_000 }), deployment: NOTHING_RUNS },
      first: undefined,
    },
    {
      case: "a build HQ did not make that Zerops ended failed: failed, in Zerops' words",
      over: { row: queued, deployment: failedBuild("process-manual") },
      first: { kind: "failed", reason: "Zerops reports its build failed" },
    },
    {
      case: "a build HQ made that Zerops ended failed: HQ's job says where it stands",
      over: {
        row: withDeploys({ state: "building", msAgo: MINUTE, processId: "process-hq" }),
        deployment: failedBuild("process-hq"),
      },
      first: { kind: "on-its-way" },
    },
  ])("$case", ({ over, first }) => {
    const flow = groupFlow(group({ stops: [stageStop(over)] }));
    expect(flow.stages[0]?.firstDeploy).toEqual(first);
  });

  it("reports HQ's failed job with its words after the import, and the import first", () => {
    const row = withDeploys({ state: "failed", reason: "the build exited with 1", msAgo: MINUTE });
    const first = (over: Partial<GroupFlowStopInput>) =>
      groupFlow(group({ stops: [stageStop({ row, ...over })] })).stages[0]?.firstDeploy;
    expect(first({})).toEqual({ kind: "failed", reason: "the build exited with 1" });
    expect(first({ services: [{ hostname: "app", status: "CREATING", runtime: true }] })).toEqual({
      kind: "setting-up",
      step: "app",
    });
  });

  it("is setting up while its own import runs, and only then", () => {
    const settingUp = (over: Partial<GroupFlowStopInput>) =>
      groupFlow(group({ stops: [stageStop(over)], mainHasCode: true })).stages[0]?.firstDeploy
        ?.kind === "setting-up"
        ? true
        : undefined;
    const making = { hostname: "app", status: "NEW", runtime: true };
    expect(settingUp({ projectStatus: "CREATING", services: [] })).toBe(true);
    expect(settingUp({ services: [making] })).toBe(true);
    expect(settingUp({ services: [making], deployment: undefined })).toBe(true);
    // Done, unread or long ago: what it runs says it.
    expect(settingUp({ services: [{ ...making, status: "ACTIVE" }] })).toBeUndefined();
    expect(settingUp({ services: undefined })).toBeUndefined();
    // Its project's own status first: one being made is set up whatever its services say.
    expect(settingUp({ projectStatus: "CREATING", services: undefined })).toBe(true);
    expect(settingUp({ projectStatus: "DELETING", services: [making] })).toBeUndefined();
    // Past what the platform says it makes, only while HQ still brings it up (H2) — never by age.
    const born = (ended: boolean) => ({
      ...declared({ projectId: "p-pantry-stage", name: "Pantry - stage", tier: "stage" }),
      birth: { ended },
    });
    expect(settingUp({ services: [], row: born(false) })).toBe(true);
    expect(settingUp({ services: [], row: born(true) })).toBeUndefined();
    expect(settingUp({ services: [] })).toBeUndefined();
    // Something runs there: never setting up again.
    expect(settingUp({ services: [making], deployment: runs(STAGE_SHA) })).toBeUndefined();
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
