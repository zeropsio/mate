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

const inReview = (w: CrewWorld) => {
  w.apply(home(lead(), writer("backend")));
  w.press({ _tag: "start", ...OPTIONS, landing: "lead" }, OTHER);
  w.quiet();
  newTask(w, "backend", "First");
  w.start("backend");
  finish(w, "backend");
  w.run("lead");
};

describe("stepTask writes only over the state it read", () => {
  it("a lead's reject read in review never writes rework over a landing since", () => {
    const w = new CrewWorld();
    inReview(w);
    w.press({ _tag: "land", taskId: w.task(1).id });
    w.settle("crew.land", "backend", { _tag: "landed", commit: "c".repeat(40) });
    w.tool("lead", { tool: "review", input: { task: 1, verdict: "reject", note: "No." } });
    expect([w.reply(), w.task(1).state]).toEqual([
      { text: "#1 is not in review (landed).", isError: true },
      "landed",
    ]);
  });

  it("a step on the state as stored is written", () => {
    const w = new CrewWorld();
    inReview(w);
    w.tool("lead", { tool: "review", input: { task: 1, verdict: "reject", note: "No." } });
    // Written as rework, and the running run sends it back to its crewmate at once.
    expect([w.task(1).review?.verdict, w.task(1).counters.reworks, w.turns("backend")]).toEqual([
      "reject",
      1,
      ["task", "rework"],
    ]);
  });
});

/**
 * A person edits a task from the board they saw: the edit carries the task's state and attempt
 * as shown there, and the crew refuses it once the task moved since — a status move, a rework,
 * another device — rather than write over what the person never saw.
 */
describe("an edit writes only over the task it read", () => {
  it("an edit read in review never writes review back over a lead's accept since", () => {
    const w = new CrewWorld();
    inReview(w);
    const seen = { state: w.task(1).state, attempts: 1 };
    // The lead accepts between the person's read and their edit.
    w.tool("lead", { tool: "review", input: { task: 1, verdict: "accept", note: "" } });
    w.tell({
      _tag: "Press",
      press: { _tag: "taskEdit", taskId: w.task(1).id, title: "Renamed" },
      door: { refusal: null },
      seen,
    });
    expect([w.rejection(), w.task(1).state, w.task(1).title]).toEqual([
      "wrong-state",
      "landing",
      "First",
    ]);
  });
});
