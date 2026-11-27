import type { CrewRun } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { crewRunAskState } from "./crewRunAsk.logic";

const runOf = (state: CrewRun["state"], ask?: string) =>
  ({ state, ...(ask === undefined ? {} : { ask }) }) as CrewRun;

const stateOf = (status: "off" | "none" | "applied" | null, run: CrewRun | null) =>
  crewRunAskState({ status, run }, "card-a", "Fen");

// witness: apps/web/src/components/ask/crewRunAsk.logic.ts | if (run?.ask === key) { → if (run !== null) {
it("AK4: A crew run card says it started the crew only once the crew's latest run names that card, and then what became of that run; another run under way took its place, and a Mate with no crew, or crews off, has nothing to start; breaks: a card nobody pressed says the crew is on it, or a card offers Start while another run works", () => {
  expect(
    [
      stateOf("applied", runOf("running", "card-a")),
      stateOf("applied", runOf("finished", "card-a")),
      stateOf("applied", runOf("running", "card-b")),
      stateOf("applied", runOf("paused")),
      stateOf("applied", runOf("stopped", "card-b")),
      stateOf("applied", null),
      stateOf(null, null),
      stateOf("none", null),
      stateOf("off", null),
    ].map((state) => ("words" in state ? `${state.kind}: ${state.words}` : state.kind)),
  ).toEqual([
    "done: The crew is on it",
    "done: The crew's run is over",
    "replaced: The crew is already at work",
    "replaced: The crew is already at work",
    "waiting",
    "waiting",
    "waiting",
    "failed: Fen has no crew yet.",
    "failed: Crews are turned off for Fen.",
  ]);
});
