import { CheckpointRef, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TurnDiffSummary } from "../types";
import { runChangesSeen, turnDiffSummariesOf } from "./turnDiffSummaries.logic";

const turn = (count: number, files: ReadonlyArray<string>): TurnDiffSummary => ({
  turnId: TurnId.make(`turn-${count}`),
  checkpointTurnCount: count,
  checkpointRef: CheckpointRef.make(`refs/t3/checkpoints/${count}`),
  status: "ready",
  files: files.map((path) => ({ path, kind: "modified", additions: 1, deletions: 0 })),
  assistantMessageId: null,
  completedAt: `2026-10-15T10:0${count}:00.000Z`,
});

describe("the turns the Diff page offers", () => {
  it("the Diff page offers each run of a Mate's that changed its workspace as a turn", () => {
    const runs = [turn(1, ["appdev/src/recipes.ts"]), turn(3, ["appdev/src/auth.ts"])];
    expect(turnDiffSummariesOf([], runs).map((summary) => summary.checkpointTurnCount)).toEqual([
      1, 3,
    ]);
  });

  it("a run's own record stands over an older record of the same turn", () => {
    const older = turn(2, []);
    const run = turn(2, ["appdev/src/routes.ts"]);
    expect(turnDiffSummariesOf([turn(1, ["a.ts"]), older], [run])).toEqual([
      turn(1, ["a.ts"]),
      run,
    ]);
  });

  it("a conversation whose runs are not read yet offers what its own record holds", () => {
    expect(turnDiffSummariesOf([turn(1, ["a.ts"])], null)).toEqual([turn(1, ["a.ts"])]);
  });

  it.each([
    { latest: null, seen: "none" },
    {
      latest: {
        turnId: TurnId.make("run-4"),
        state: "running" as const,
        requestedAt: "2026-10-15T10:00:00.000Z",
        startedAt: "2026-10-15T10:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      seen: "run-4:running",
    },
    {
      latest: {
        turnId: TurnId.make("run-4"),
        state: "completed" as const,
        requestedAt: "2026-10-15T10:00:00.000Z",
        startedAt: "2026-10-15T10:00:00.000Z",
        completedAt: "2026-10-15T10:06:33.000Z",
        assistantMessageId: null,
      },
      seen: "run-4:2026-10-15T10:06:33.000Z",
    },
  ])("reads a Mate's run changes again once a run starts or ends ($seen)", ({ latest, seen }) => {
    expect(runChangesSeen(latest)).toBe(seen);
  });
});
