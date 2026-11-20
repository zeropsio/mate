import { expect, it } from "vite-plus/test";
import { arrivalRow } from "../../zerops/mateArrival.ts";

// witness: apps/web/src/zerops/mateArrival.ts | (fact.state === "done" ? [] : [fact.startedAt]) → [fact.startedAt]
it("MN12: An existing Mate's arrival counts from the start of the step it is on, never from a done step's; breaks: a restarting Mate's page counts the hours since its project was made (559 h, 2026-11-20)", () => {
  const row = arrivalRow(
    [
      { id: "project", label: "Its project is made", state: "done" },
      { id: "container", label: "Its computer starts", state: "active" },
    ],
    [
      {
        id: "project",
        label: "Project",
        state: "done",
        startedAt: "2026-10-28T13:00:00Z",
        endedAt: "2026-10-28T13:00:40Z",
      },
      { id: "container", label: "Container", state: "active", startedAt: "2026-11-20T20:01:00Z" },
    ],
  );
  expect(row.startedAtMs).toBe(Date.parse("2026-11-20T20:01:00Z"));
});
