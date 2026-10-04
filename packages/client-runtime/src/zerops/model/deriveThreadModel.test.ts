import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity, ZeropsLifecycle } from "@t3tools/contracts";

import type { Known } from "../knowledge/index.ts";
import { weatherdashFirstDeploy } from "../operations/__fixtures__/index.ts";
import type { DeployBuildRead } from "../activity/deployBuild.ts";
import { deriveZeropsThreadModel } from "./deriveThreadModel.ts";

describe("deriveZeropsThreadModel", () => {
  it("composes calls, entries, zeropsActivityIds, session and running from one real thread", () => {
    const model = deriveZeropsThreadModel({
      activities: weatherdashFirstDeploy.activities,
    });

    expect(model.calls.length).toBeGreaterThan(0);
    expect(
      model.entries.map((e) => (e.kind === "operation" ? e.operation.kind : "generic")),
    ).toEqual(expect.arrayContaining(["bootstrap", "deploy", "verify"]));
    expect(model.running).toBeUndefined(); // the thread has settled
    expect(model.zeropsActivityIds.size).toBeGreaterThan(0);
    // every zerops_* activity row is excluded from the transcript
    for (const call of model.calls) {
      for (const rowId of call.rowIds) {
        expect(model.zeropsActivityIds.has(rowId)).toBe(true);
      }
    }
  });

  it("entries are sorted by anchor order, matching the calls' own anchor order for per-call operations", () => {
    const model = deriveZeropsThreadModel({
      activities: weatherdashFirstDeploy.activities,
    });
    const anchors = model.entries.map((e) => e.anchorAt);
    const sorted = [...anchors].sort();
    expect(anchors).toEqual(sorted);
  });

  it("reports the running operation when the thread has an in-flight call on the running turn", () => {
    const runningTurnId = "turn-running";
    const activities = [
      {
        id: "a1",
        tone: "tool",
        kind: "tool.started",
        summary: "Tool call started",
        turnId: runningTurnId,
        createdAt: "2026-09-01T00:00:00.000Z",
        payload: {
          toolCallId: "call-1",
          status: "inProgress",
          data: { toolName: "mcp__zerops__zerops_deploy", input: { targetService: "app" } },
        },
      },
    ] as never;
    const model = deriveZeropsThreadModel({ activities, runningTurnId });
    expect(model.running?.kind).toBe("deploy");
    expect(model.running?.phase).toBe("running");
  });

  it("a running stand-up carries the newest progress its Mate relayed, an older Mate's none", () => {
    const runningTurnId = "turn-running";
    const started = {
      id: "a1",
      tone: "tool",
      kind: "tool.started",
      summary: "Tool call started",
      turnId: runningTurnId,
      createdAt: "2026-09-01T00:00:00.000Z",
      payload: {
        toolCallId: "call-1",
        status: "inProgress",
        data: { toolName: "mcp__zerops__zerops_standup", input: {} },
      },
    };
    const progress = (createdAt: string, state: string) => ({
      id: `progress-${createdAt}`,
      tone: "info",
      kind: "tool.progress",
      summary: "Stand-up progress",
      turnId: runningTurnId,
      createdAt,
      payload: {
        toolCallId: "call-1",
        zeropsStandUp: {
          phase: "development",
          state: "running",
          services: [{ hostname: "api", step: "build", state, processId: "", at: "" }],
        },
      },
    });
    const derive = (activities: ReadonlyArray<unknown>) =>
      deriveZeropsThreadModel({ activities: activities as never, runningTurnId }).running;
    expect(derive([started])?.standUpProgress).toBeUndefined();
    const running = derive([
      started,
      progress("2026-09-01T00:00:09.000Z", "done"),
      progress("2026-09-01T00:00:05.000Z", "running"),
    ]);
    expect(running?.kind).toBe("standup");
    expect(running?.standUpProgress?.services).toEqual([
      { hostname: "api", step: "build", state: "done", processId: "", at: "" },
    ]);
  });

  it("composes the session from a known lifecycle's envelope, stale or not, and from nothing else", () => {
    const envelope = {
      phase: "develop-active",
      environment: "container",
      project: { id: "proj-1", name: "z3-eval" },
      services: [],
      generated: "2026-08-28T10:00:00Z",
    };
    const known = (
      freshness: Extract<Known<ZeropsLifecycle>, { state: "known" }>["freshness"],
    ): Known<ZeropsLifecycle> => ({
      state: "known",
      value: { threadId: "thread-1", recentTools: [], envelope } as unknown as ZeropsLifecycle,
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness,
    });

    const live = deriveZeropsThreadModel({
      activities: [],
      lifecycle: known({ kind: "live" }),
    });
    const stale = deriveZeropsThreadModel({
      activities: [],
      lifecycle: known({
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: null },
        sinceMs: 0,
      }),
    });
    const unread = deriveZeropsThreadModel({
      activities: [],
      lifecycle: { state: "unread", waitingFor: "mate-session" },
    });

    expect(live.session.phase).toBe("develop-active");
    expect(stale.session.phase).toBe("develop-active");
    expect(unread.session).toEqual({});
  });
});

describe("deriveZeropsThreadModel — a triggered build reads its own end", () => {
  const SETTLED_AT = "2026-09-23T10:00:00.000Z";

  const deployActivities = (
    status: "completed" | "failed",
    result: Record<string, unknown>,
  ): ReadonlyArray<OrchestrationThreadActivity> =>
    [
      {
        id: "d1",
        tone: "tool",
        kind: "tool.completed",
        summary: "Tool call",
        turnId: "t1",
        createdAt: SETTLED_AT,
        payload: {
          toolCallId: "call-d1",
          status,
          data: {
            toolName: "zerops_deploy",
            input: { targetService: "appdev" },
            zerops: {
              toolName: "zerops_deploy",
              resultText: JSON.stringify({ targetService: "appdev", ...result }),
            },
          },
        },
      },
    ] as unknown as ReadonlyArray<OrchestrationThreadActivity>;

  const lifecycleWithProject: Known<ZeropsLifecycle> = {
    state: "known",
    value: {
      threadId: "thread-1",
      recentTools: [],
      envelope: {
        phase: "develop-active",
        environment: "container",
        project: { id: "proj-1", name: "z3-eval" },
        services: [],
        generated: SETTLED_AT,
      },
    } as unknown as ZeropsLifecycle,
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  };

  const deployAt = (
    activities: ReadonlyArray<OrchestrationThreadActivity>,
    build?: DeployBuildRead,
    lifecycle?: Known<ZeropsLifecycle>,
  ) => {
    const asked: string[] = [];
    const model = deriveZeropsThreadModel({
      activities,
      runningTurnId: null,
      ...(build !== undefined
        ? {
            builds: (appVersionId: string) => {
              asked.push(appVersionId);
              return build;
            },
          }
        : {}),
      ...(lifecycle !== undefined ? { lifecycle } : {}),
    });
    const entry = model.entries[0];
    return { model, asked, deploy: entry?.kind === "operation" ? entry.operation : undefined };
  };

  /** zcp's poll gave up on it while it builds, naming the build it followed. */
  const gaveUp = deployActivities("completed", {
    status: "BUILD_TRIGGERED",
    timedOut: true,
    appVersionId: "av-1",
    message: "Build triggered from appdev to appdev via SSH",
  });

  it.each([
    { build: "unread", phase: "running", word: "Build triggered" },
    { build: "running", phase: "running", word: "Build triggered" },
    { build: "finished", phase: "done", word: "Deployed" },
    { build: "failed", phase: "failed", word: "Failed" },
    { build: "unobservable", phase: "uncertain", word: "Unconfirmed" },
  ] as const)(
    "its build $build: $phase, asked by the appVersion it named",
    ({ build, phase, word }) => {
      const { model, asked, deploy } = deployAt(gaveUp, build, lifecycleWithProject);

      expect([deploy?.phase, deploy?.statusWord]).toEqual([phase, word]);
      expect(asked).toContain("av-1");
      expect(model.running?.key).toBe(phase === "running" ? deploy?.key : undefined);
    },
  );

  it("an ended build speaks for itself, not in zcp's words from before it ended", () => {
    const failed = deployAt(gaveUp, "failed", lifecycleWithProject).deploy;
    const done = deployAt(gaveUp, "finished", lifecycleWithProject).deploy;

    expect(failed?.closing).toBe("Failed.");
    expect(done?.explanation).toBeUndefined();
  });

  it("one it cannot ask about reads uncertain, with one affordance", () => {
    const { model, deploy } = deployAt(gaveUp, "unobservable", lifecycleWithProject);

    expect(deploy?.closing).toBe("No result from the build. Check it in Zerops.");
    expect(deploy?.links).toEqual([
      { label: "Open in Zerops", url: "https://app.zerops.io/project/proj-1" },
    ]);
    expect(deploy?.settledAt).toBe(SETTLED_AT);
    expect(model.running).toBeUndefined();
  });

  it("an uncertain deploy with no known envelope states the cause and offers no link", () => {
    const { deploy } = deployAt(gaveUp, "unobservable", {
      state: "unread",
      waitingFor: "mate-session",
    });

    expect(deploy?.phase).toBe("uncertain");
    expect(deploy?.closing).toBe("No result from the build. Check it in Zerops.");
    expect(deploy?.links).toEqual([]);
  });

  it.each([
    ["no read of the platform given", undefined],
    ["a build read that would say it runs", "running"],
  ] as const)(
    "a triggered build that names no build has no handle: uncertain (%s)",
    (_label, build) => {
      const { deploy } = deployAt(
        deployActivities("completed", { status: "BUILD_TRIGGERED", timedOut: true }),
        build,
        lifecycleWithProject,
      );

      expect(deploy?.phase).toBe("uncertain");
    },
  );

  it("no read of the platform given, a build it named is not one it can ask about", () => {
    expect(deployAt(gaveUp, undefined, lifecycleWithProject).deploy?.phase).toBe("uncertain");
  });

  it.each([
    ["deployed", deployActivities("completed", { status: "DEPLOYED", appVersionId: "av-1" })],
    [
      "build failed",
      deployActivities("completed", { status: "BUILD_FAILED", appVersionId: "av-1" }),
    ],
    ["a failed call", deployActivities("failed", { error: "Build failed." })],
    // An older zcp named no build on the results it ended itself: its terminal word stands.
    [
      "deployed, by a zcp that named no build",
      deployActivities("completed", { status: "DEPLOYED" }),
    ],
    [
      "build failed, by a zcp that named no build",
      deployActivities("completed", { status: "BUILD_FAILED", failedPhase: "build" }),
    ],
  ] as const)(
    "a result that settled its build is the verdict, whatever a read says (%s)",
    (_label, activities) => {
      const settled = deployAt(activities, "running", lifecycleWithProject);
      const unobservable = deployAt(activities, "unobservable", lifecycleWithProject);

      expect(settled.deploy?.phase).not.toBe("running");
      expect(settled.deploy?.phase).not.toBe("uncertain");
      expect(deployAt(activities).deploy?.phase).toBe(settled.deploy?.phase);
      expect(settled.asked).toEqual([]);
      expect(settled.deploy).toEqual(unobservable.deploy);
    },
  );
});
