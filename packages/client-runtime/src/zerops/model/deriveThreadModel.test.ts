import { describe, expect, it } from "vite-plus/test";
import type { ZeropsLifecycle } from "@t3tools/contracts";

import type { Known } from "../knowledge/index.ts";
import { weatherdashFirstDeploy } from "../operations/__fixtures__/index.ts";
import { deriveZeropsThreadModel } from "./deriveThreadModel.ts";

describe("deriveZeropsThreadModel", () => {
  it("composes calls, entries, zeropsActivityIds, session and running from one real thread", () => {
    const model = deriveZeropsThreadModel({ activities: weatherdashFirstDeploy.activities });

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
    const model = deriveZeropsThreadModel({ activities: weatherdashFirstDeploy.activities });
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

    const live = deriveZeropsThreadModel({ activities: [], lifecycle: known({ kind: "live" }) });
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
