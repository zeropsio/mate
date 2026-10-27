import { describe, expect, it } from "@effect/vitest";

import {
  CrewWorld,
  OPTIONS,
  OTHER,
  finish,
  home,
  newTask,
  reader,
  writer,
} from "./crewDecideFixture.ts";

const OVERFLOW = { kind: "failed", reason: "prompt_too_long", next: null } as const;
const BROKE_OFF = { kind: "failed", reason: "api_error", next: null } as const;

const goOn = (w: CrewWorld, handle: string) =>
  w.press({ _tag: "message", handle, text: "Go on.", attachments: [] });

const sessions = (w: CrewWorld, handle: string) =>
  w.controls(handle).filter((tag) => tag === "RotateSession").length;

interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const journeys: ReadonlyArray<Journey> = [
  {
    sentence:
      "a conversation that outgrows its context rotates at once; the third time the task stops",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.end("reviewer", OVERFLOW, { detail: "overflow" });
      const first = [w.task(1).state, sessions(w, "reviewer")];
      goOn(w, "reviewer");
      w.run("reviewer");
      w.end("reviewer", OVERFLOW, { detail: "overflow" });
      goOn(w, "reviewer");
      w.run("reviewer");
      w.end("reviewer", OVERFLOW, { detail: "overflow" });
      return [first, w.task(1).state, w.task(1).wait?.reason, sessions(w, "reviewer")];
    },
    expected: [["working", 1], "parked", "its conversation outgrew its context too often", 2],
  },
  {
    sentence: "in a run, a new conversation after an overflow carries the task on at once",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      w.press({ _tag: "start", ...OPTIONS }, OTHER);
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.end("reviewer", OVERFLOW, { detail: "overflow" });
      return [
        w.turns("reviewer"),
        w.state.members.reviewer!.session.lastReason,
        w.lastTurnAs("reviewer"),
      ];
    },
    expected: [["task", "continue"], "context", { kind: "crew", startedBy: "user-2" }],
  },
  {
    sentence: "a turn the provider broke off queues its task again once; the second time it stops",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.end("reviewer", BROKE_OFF, { detail: "provider-error" });
      const again = [w.task(1).state, w.turns("reviewer")];
      w.run("reviewer");
      w.end("reviewer", BROKE_OFF, { detail: "provider-error" });
      return [again, w.task(1).state, w.task(1).wait?.reason];
    },
    expected: [["queued", ["task", "task"]], "parked", "its turn broke off twice"],
  },
  {
    sentence: "Try again gives a task its one re-queue after a broken-off turn back",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.end("reviewer", BROKE_OFF);
      w.run("reviewer");
      w.end("reviewer", BROKE_OFF);
      w.press({ _tag: "taskRetry", taskId: w.task(1).id });
      w.run("reviewer");
      w.end("reviewer", BROKE_OFF);
      return [w.task(1).state, w.task(1).counters.requeues];
    },
    expected: ["queued", 1],
  },
  {
    sentence: "after rotateAfter compactions the conversation waits and rotates at the next task",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "First");
      w.run("reviewer");
      for (let n = 0; n < 3; n += 1) w.compacted("reviewer");
      w.tool("reviewer", { tool: "report", input: { status: "done", summary: "Read." } });
      w.end("reviewer");
      const waits = sessions(w, "reviewer");
      w.press({ _tag: "land", taskId: w.task(1).id });
      newTask(w, "reviewer", "Second");
      return [
        w.task(1).state,
        waits,
        sessions(w, "reviewer"),
        w.state.members.reviewer!.session.lastReason,
        w.task(2).counters.rotations,
      ];
    },
    expected: ["landed", 0, 1, "context", 1],
  },
  {
    sentence: "a rework past the cap parks",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
        w.end("backend");
        w.checkpoint("backend");
        w.settle("crew.mergeIn", "backend", { _tag: "merged", head: "h".repeat(40) });
        w.settle("crew.check", "backend", { _tag: "failed", tail: "1 failing" });
        w.press({ _tag: "askFix", taskId: w.task(1).id });
        if (attempt < 3) w.run("backend");
      }
      return [w.task(1).state, w.task(1).wait?.reason, w.turns("backend")];
    },
    expected: ["parked", "it came back for rework too often", ["task", "fix", "fix"]],
  },
  {
    sentence: "H moved past three re-merges is a rework",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      finish(w, "backend");
      w.press({ _tag: "land", taskId: w.task(1).id });
      for (let moved = 1; moved <= 3; moved += 1) {
        w.settle("crew.land", "backend", { _tag: "head-moved" });
        w.mergeAndCheck("backend");
      }
      w.settle("crew.land", "backend", { _tag: "head-moved" });
      return [w.task(1).state, w.task(1).counters.reworks, w.pending("crew.mergeIn", "backend")];
    },
    expected: ["rework", 1, undefined],
  },
];

describe("crew caps", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
