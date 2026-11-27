import { expect, it } from "vite-plus/test";

import { crewRunStanding } from "./crew/CrewHead.logic";

const MINUTE = 60_000;
const READ_AT = Date.parse("2026-11-27T10:00:00Z");

// witness: apps/web/src/components/zerops/crew/CrewHead.logic.ts | const working = input.workingCount > 0 || run.countingFrom != null; → const working = atWork(input);
it("MN+1: A running crew is at work only while a crewmate's turn runs, its clock running on from when its Mate read it; with no turn running, a task left midway included, it waits on the person when something does, its clock standing; breaks: the Crew tab says the crew works on its own while it waits on the person and its clock stands still", () => {
  const run = { elapsedMs: 12 * MINUTE, countingFrom: "2026-11-27T10:00:00.000Z" };
  const standing = { ...run, countingFrom: null };
  const later = READ_AT + 5 * MINUTE;
  expect([
    crewRunStanding(run, {
      workingCount: 1,
      tasks: [{ state: "working" }],
      waitsOnYou: true,
      nowMs: later,
    }),
    crewRunStanding(standing, {
      workingCount: 0,
      tasks: [{ state: "working" }],
      waitsOnYou: true,
      nowMs: later,
    }),
    crewRunStanding(standing, {
      workingCount: 0,
      tasks: [{ state: "checking" }],
      waitsOnYou: false,
      nowMs: later,
    }),
  ]).toEqual([
    { at: "working", elapsedMs: 17 * MINUTE },
    { at: "waiting-on-you", elapsedMs: 12 * MINUTE },
    { at: "between", elapsedMs: 12 * MINUTE },
  ]);
});
