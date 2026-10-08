import { describe, expect, it } from "@effect/vitest";

import {
  CrewWorld,
  OPTIONS,
  OTHER,
  PERSON,
  home,
  newTask,
  reader,
  writer,
} from "./crewDecideFixture.ts";

const CUT = { kind: "cut-by-restart", continuedBy: null } as const;

const restarted = (w: CrewWorld) =>
  w.tell({ _tag: "Recovered", bootId: "boot-2" as never }, { kind: "engine" });

interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const journeys: ReadonlyArray<Journey> = [
  {
    sentence: "in a run, a turn that ends without a report gets one nudge",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      w.press({ _tag: "start", ...OPTIONS }, OTHER);
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.end("reviewer");
      w.run("reviewer");
      w.end("reviewer");
      return [w.turns("reviewer"), w.task(1).midway?.why];
    },
    expected: [["task", "nudge"], "its turn ended without a report"],
  },
  {
    sentence:
      "a turn that leaves its task working ends the attempt, how and when; its next turn opens it again",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.advance(60_000);
      w.end("reviewer");
      const ended = w.task(1).midway;
      w.press({ _tag: "message", handle: "reviewer", text: "Go on.", attachments: [] });
      w.run("reviewer");
      return [ended, w.task(1).state, w.task(1).midway, w.task(1).counters.attempt];
    },
    expected: [
      { since: Date.parse("2026-10-08T10:01:00.000Z"), why: "its turn ended without a report" },
      "working",
      null,
      1,
    ],
  },
  {
    sentence: "a run's pause ends the attempt of the turn it interrupts, in the run's words",
    journey: (w) => {
      w.apply(home(reader("reviewer"), reader("writer2")));
      w.press({ _tag: "start", ...OPTIONS, budgetUsd: 20 }, OTHER);
      newTask(w, "reviewer", "Read it");
      newTask(w, "writer2", "Read more");
      w.run("reviewer");
      w.run("writer2");
      w.end("writer2", { kind: "completed" }, { costUsd: 21 });
      w.end("reviewer", { kind: "stopped", by: { kind: "engine" } });
      return [w.state.run?.reason, w.task(1).midway?.why];
    },
    expected: ["budget", "when the $20 ran out"],
  },
  {
    sentence:
      "the rig: a working task with no turn stops its queue; the next run carries it on as its starter",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "First");
      w.run("reviewer");
      w.end("reviewer");
      newTask(w, "reviewer", "Second");
      const waiting = [w.task(2).state, w.turns("reviewer")];
      w.press({ _tag: "start", ...OPTIONS }, OTHER);
      return [waiting, w.turns("reviewer"), w.lastTurnAs("reviewer"), w.task(2).state];
    },
    expected: [
      ["queued", ["task"]],
      ["task", "continue"],
      { kind: "crew", startedBy: "user-2" },
      "queued",
    ],
  },
  {
    sentence: "a restart sends no turn into a run the person paused; Resume carries the task on",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      w.press({ _tag: "start", ...OPTIONS }, OTHER);
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.press({ _tag: "pause", runId: w.state.run!.id });
      w.quiet();
      w.end("reviewer", CUT);
      restarted(w);
      const held = w.turns("reviewer");
      w.press({ _tag: "resume", runId: w.state.run!.id });
      return [held, w.turns("reviewer")];
    },
    expected: [["task"], ["task", "continue"]],
  },
  {
    sentence: "a restart after a finished run carries a died turn on: a finished run holds nothing",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      w.press({ _tag: "start", ...OPTIONS }, OTHER);
      w.press({ _tag: "finish", runId: w.state.run!.id });
      newTask(w, "reviewer", "Read it", PERSON);
      w.run("reviewer");
      w.end("reviewer", CUT);
      restarted(w);
      return [w.state.run?.state, w.turns("reviewer"), w.lastTurnAs("reviewer")];
    },
    expected: ["finished", ["task", "continue"], PERSON],
  },
  {
    sentence: "a task card a restart cut off before it went out is sent, not a Continue",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.run("reviewer", false);
      w.end("reviewer", CUT);
      return w.turns("reviewer");
    },
    expected: ["task", "task"],
  },
  {
    sentence: "a restart merges and checks a task whose turn-end save it cut off after a report",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
      w.end("backend", CUT);
      restarted(w);
      w.checkpoint("backend");
      w.mergeAndCheck("backend");
      return [w.task(1).state, w.turns("backend")];
    },
    expected: ["ready", ["task"]],
  },
];

describe("crew turn endings", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
