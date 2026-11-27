import type { CrewRun } from "@t3tools/contracts";
import { CREW_REPORT_OPENER } from "@t3tools/shared/userAsk";
import { expect, it } from "vite-plus/test";

import { crewReportOf, crewRunAskState, crewRunTell } from "./crewRunAsk.logic";

const runOf = (state: CrewRun["state"], ask?: string) =>
  ({ state, ...(ask === undefined ? {} : { ask }) }) as CrewRun;

const stateOf = (status: "off" | "none" | "applied" | null, run: CrewRun | null) =>
  crewRunAskState({ status, run, hasLead: true }, "card-a", "Fen");

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

// witness: apps/web/src/components/ask/crewRunAsk.logic.ts | if (crew.hasLead === false) { → if (crew.hasLead === null) {
it("AK5: A crew run card's Start tells the crew's lead to plan the new goal once the run is on, and a crew with no lead has nobody to plan it, so its card offers no Start; breaks: the run starts and nobody works, its clock never moving", () => {
  const ask = { goal: "Show one quiet line above the form.\n\n## Done when\n- It shows." };
  const lead = (hasLead: boolean | null) =>
    crewRunAskState({ status: "applied", run: null, hasLead }, "card-a", "Fen");
  expect([crewRunTell(ask), lead(true), lead(false), lead(null)]).toEqual([
    {
      _tag: "tell",
      text: "Plan and run the crew's new goal: Show one quiet line above the form",
      mentions: [],
    },
    { kind: "waiting" },
    { kind: "failed", words: "Fen's crew has no lead to plan it." },
    { kind: "waiting" },
  ]);
});

// witness: apps/web/src/components/ask/crewRunAsk.logic.ts | return text.trimStart().slice(CREW_REPORT_OPENER.length).trim(); → return text.trimStart().trim();
it("AK+1: The crew's report on a run a card started reads as the crew's words alone, its opener left out, and a person's message, one that only mentions the opener included, is no report; breaks: the report shows as the person's own message, or with the crew's bookkeeping in front of its words", () => {
  const words = "The crew's run finished. Landed: “Sign-in form”.";
  expect([
    crewReportOf(`${CREW_REPORT_OPENER}\n${words}`),
    crewReportOf(words),
    crewReportOf(`Look at the ${CREW_REPORT_OPENER} above.`),
  ]).toEqual([words, null, null]);
});
