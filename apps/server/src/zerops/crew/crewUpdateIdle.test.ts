import { assert, describe, it } from "@effect/vitest";
import type { CrewRunState, CrewTaskState } from "@t3tools/contracts";
import { crewUpdateBlockers } from "./crewUpdateIdle.ts";

describe("crew update idle", () => {
  it.each([
    ["idle", 0, "stopped", "parked", true],
    ["running between turns", 0, "running", "ready", false],
    ["finishing run", 0, "finishing", "ready", false],
    ["detached check", 1, "stopped", "ready", false],
    ["queued task outside a run", 0, "stopped", "queued", false],
    ["waiting question", 0, "paused", "blocked", false],
    ["review request", 0, "paused", "review", false],
    ["completed", 0, "finished", "landed", true],
  ] as ReadonlyArray<readonly [string, number, CrewRunState, CrewTaskState, boolean]>)(
    "%s",
    (_, active, run, state, idle) => {
      assert.strictEqual(
        crewUpdateBlockers({ active, run, tasks: [{ state }], operations: [] }).length === 0,
        idle,
      );
    },
  );
});
