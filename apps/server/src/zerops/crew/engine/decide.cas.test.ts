import { describe, expect, it } from "@effect/vitest";

import {
  CrewWorld,
  OPTIONS,
  OTHER,
  finish,
  home,
  lead,
  newTask,
  writer,
} from "./crewDecideFixture.ts";

/**
 * One writer decides every step against the crew as stored, so a verdict or an edit can only
 * meet the task as it stands: what V1 guarded with a compare-and-swap is the actor's own order.
 */
const inReview = (w: CrewWorld) => {
  w.apply(home(lead(), writer("backend")));
  w.press({ _tag: "start", ...OPTIONS, landing: "lead" }, OTHER);
  w.quiet();
  newTask(w, "backend", "First");
  w.start("backend");
  finish(w, "backend");
  w.run("lead");
};

describe("a step writes only over the task as it stands", () => {
  it.each([
    {
      sentence: "a lead's reject read in review never writes rework over a landing since",
      journey: (w: CrewWorld) => {
        inReview(w);
        w.press({ _tag: "land", taskId: w.task(1).id });
        w.settle("crew.land", "backend", { _tag: "landed", commit: "c".repeat(40) });
        w.tool("lead", { tool: "review", input: { task: 1, verdict: "reject", note: "No." } });
        return [w.reply(), w.task(1).state];
      },
      expected: [{ text: "#1 is not in review (landed).", isError: true }, "landed"],
    },
    {
      sentence: "a step on the state as stored is written",
      journey: (w: CrewWorld) => {
        inReview(w);
        w.tool("lead", { tool: "review", input: { task: 1, verdict: "reject", note: "No." } });
        // Written as rework, and the running run sends it back to its crewmate at once.
        return [w.task(1).review?.verdict, w.task(1).counters.reworks, w.turns("backend")];
      },
      expected: ["reject", 1, ["task", "rework"]],
    },
    {
      sentence: "an edit read in review never writes review back over a lead's accept since",
      journey: (w: CrewWorld) => {
        inReview(w);
        w.tool("lead", { tool: "review", input: { task: 1, verdict: "accept", note: "" } });
        w.press({ _tag: "taskEdit", taskId: w.task(1).id, title: "Renamed" });
        return [w.task(1).state, w.task(1).title, w.task(1).review?.verdict];
      },
      expected: ["landing", "Renamed", "accept"],
    },
  ])("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
