import { describe, expect, it } from "vite-plus/test";

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
});
