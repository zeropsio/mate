import { describe, expect, it } from "@effect/vitest";

import { wakesToRenew } from "./crewLead.ts";
import type { CrewAssignmentRow } from "./CrewStore.ts";

const AT = "2026-09-28T07:00:00.000Z";

const task = (
  assignment: string,
  state: CrewAssignmentRow["state"],
  attempt = 1,
): Pick<CrewAssignmentRow, "assignment" | "state" | "attempt" | "updatedAt"> => ({
  assignment,
  state,
  attempt,
  updatedAt: AT,
});

describe("wakesToRenew", () => {
  it.each([
    [
      "a review whose wake ended",
      [task("t-16", "review")],
      ["review:t-16:1"],
      [],
      undefined,
      ["review:t-16:1"],
    ],
    [
      "a review the lead's running turn serves",
      [task("t-16", "review")],
      ["review:t-16:1"],
      [],
      "review:t-16:1",
      [],
    ],
    ["a review never woken for", [task("t-16", "review")], [], [], undefined, []],
    [
      "an earlier attempt's review",
      [task("t-16", "review", 2)],
      ["review:t-16:1"],
      [],
      undefined,
      [],
    ],
    [
      "a question whose wake ended",
      [task("t-4", "blocked")],
      [`question:t-4:${AT}`],
      [],
      undefined,
      [`question:t-4:${AT}`],
    ],
    [
      "a question the lead passed on to the person",
      [task("t-4", "blocked")],
      [`question:t-4:${AT}`],
      [`question:t-4:${AT}`],
      undefined,
      [],
    ],
    ["a task that moved on", [task("t-16", "ready")], ["review:t-16:1"], [], undefined, []],
  ] as const)("%s", (_, tasks, woken, escalated, serving, renewed) => {
    expect(wakesToRenew(tasks, new Set(woken), new Set(escalated), serving)).toEqual(renewed);
  });
});
