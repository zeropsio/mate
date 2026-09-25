import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity, ZeropsLifecycle } from "@t3tools/contracts";

import type { Known } from "../knowledge/index.ts";
import { weatherdashFirstDeploy } from "../operations/__fixtures__/index.ts";
import { deriveZeropsThreadModel } from "./deriveThreadModel.ts";

/** No thread in this block holds a triggered build, so the clock never moves a card. */
const NOW_MS = Date.parse("2026-09-23T00:00:00.000Z");

describe("deriveZeropsThreadModel", () => {
  it("composes calls, entries, zeropsActivityIds, session and running from one real thread", () => {
    const model = deriveZeropsThreadModel({
      activities: weatherdashFirstDeploy.activities,
      nowMs: NOW_MS,
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
      nowMs: NOW_MS,
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
    const model = deriveZeropsThreadModel({ activities, runningTurnId, nowMs: NOW_MS });
    expect(model.running?.kind).toBe("deploy");
    expect(model.running?.phase).toBe("running");
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
      nowMs: NOW_MS,
      lifecycle: known({ kind: "live" }),
    });
    const stale = deriveZeropsThreadModel({
      activities: [],
      nowMs: NOW_MS,
      lifecycle: known({
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: null },
        sinceMs: 0,
      }),
    });
    const unread = deriveZeropsThreadModel({
      activities: [],
      nowMs: NOW_MS,
      lifecycle: { state: "unread", waitingFor: "mate-session" },
    });

    expect(live.session.phase).toBe("develop-active");
    expect(stale.session.phase).toBe("develop-active");
    expect(unread.session).toEqual({});
  });
});

describe("deriveZeropsThreadModel — a deploy past its cap", () => {
  const SETTLED_AT = "2026-09-23T10:00:00.000Z";
  const settledMs = Date.parse(SETTLED_AT);
  const TEN_MINUTES_MS = 10 * 60 * 1000;

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
    nowMs: number,
    activities: ReadonlyArray<OrchestrationThreadActivity>,
    lifecycle?: Known<ZeropsLifecycle>,
  ) => {
    const model = deriveZeropsThreadModel({
      activities,
      runningTurnId: null,
      nowMs,
      ...(lifecycle !== undefined ? { lifecycle } : {}),
    });
    const entry = model.entries[0];
    return { model, deploy: entry?.kind === "operation" ? entry.operation : undefined };
  };

  const buildTriggered = deployActivities("completed", { status: "BUILD_TRIGGERED" });

  it("a deploy call settled 10 min ago with no terminal process reads uncertain, with one affordance", () => {
    const { model, deploy } = deployAt(
      settledMs + TEN_MINUTES_MS,
      buildTriggered,
      lifecycleWithProject,
    );

    expect(deploy?.phase).toBe("uncertain");
    expect(deploy?.statusWord).toBe("Unconfirmed");
    expect(deploy?.closing).toBe("No result from the build. Check it in Zerops.");
    expect(deploy?.links).toEqual([
      { label: "Open in Zerops", url: "https://app.zerops.io/project/proj-1" },
    ]);
    expect(deploy?.settledAt).toBe(SETTLED_AT);
    expect(model.running).toBeUndefined();
  });

  it("an uncertain deploy with no known envelope states the cause and offers no link", () => {
    const { deploy } = deployAt(settledMs + TEN_MINUTES_MS, buildTriggered, {
      state: "unread",
      waitingFor: "mate-session",
    });

    expect(deploy?.phase).toBe("uncertain");
    expect(deploy?.closing).toBe("No result from the build. Check it in Zerops.");
    expect(deploy?.links).toEqual([]);
  });

  it("a triggered build short of the cap is still running", () => {
    const { model, deploy } = deployAt(
      settledMs + TEN_MINUTES_MS - 1,
      buildTriggered,
      lifecycleWithProject,
    );

    expect(deploy?.phase).toBe("running");
    expect(deploy?.statusWord).toBe("Build triggered");
    expect(deploy?.links).toEqual([]);
    expect(model.running?.key).toBe(deploy?.key);
  });

  it.each([
    ["deployed", deployActivities("completed", { status: "DEPLOYED" })],
    ["build failed", deployActivities("completed", { status: "BUILD_FAILED" })],
    ["a failed call", deployActivities("failed", { error: "Build failed." })],
  ] as const)(
    "a terminal process before the cap never reads uncertain (%s)",
    (_label, activities) => {
      const atSettle = deployAt(settledMs, activities, lifecycleWithProject).deploy;
      const hourLater = deployAt(
        settledMs + 6 * TEN_MINUTES_MS,
        activities,
        lifecycleWithProject,
      ).deploy;

      expect(hourLater?.phase).not.toBe("uncertain");
      expect(hourLater).toEqual(atSettle);
    },
  );
});
