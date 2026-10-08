import { describe, expect, it } from "@effect/vitest";

import { CrewWorld, OPTIONS, OTHER, home, newTask, reader } from "./crewDecideFixture.ts";
import { sessionBudgetUsd } from "./state.ts";

const HOUR = 3_600_000;

/** A reader working a task inside a run started by OTHER with these options. */
const inRun = (w: CrewWorld, options: Partial<typeof OPTIONS> = {}) => {
  w.apply(home(reader("reviewer")));
  w.press({ _tag: "start", ...OPTIONS, ...options }, OTHER);
  w.quiet();
  newTask(w, "reviewer", "Read it");
  w.run("reviewer");
};

const spends = (w: CrewWorld, costUsd: number) => {
  w.end("reviewer", { kind: "completed" }, { costUsd });
};

interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const journeys: ReadonlyArray<Journey> = [
  {
    sentence: "a run's sessions get what its budget has left; reaching it pauses the run",
    journey: (w) => {
      inRun(w, { budgetUsd: 20 });
      const first = sessionBudgetUsd(w.state);
      spends(w, 12);
      const left = sessionBudgetUsd(w.state);
      w.quiet();
      w.run("reviewer");
      spends(w, 9);
      return [first, left, w.state.run?.state, w.state.run?.reason, sessionBudgetUsd(w.state)];
    },
    expected: [20, 8, "paused", "budget", 0],
  },
  {
    sentence:
      "Resume on a spent budget is refused by name; a raised budget runs on with the new remainder",
    journey: (w) => {
      inRun(w, { budgetUsd: 20 });
      spends(w, 21);
      const runId = w.state.run!.id;
      w.press({ _tag: "resume", runId });
      const refused = w.rejectionDetail();
      w.press({ _tag: "resume", runId, budgetUsd: 30 });
      return [refused, w.state.run?.state, sessionBudgetUsd(w.state)];
    },
    expected: [
      "The run has spent its $20 budget — raise it or choose No limit to resume",
      "running",
      9,
    ],
  },
  {
    sentence: "spend counts each turn's own cost, once, from a session's cumulative totals",
    journey: (w) => {
      inRun(w, { budgetUsd: 20 });
      spends(w, 2.5);
      w.replay("reviewer");
      return w.state.run?.spentUsd;
    },
    expected: 2.5,
  },
  {
    sentence: "a run with No limit sets no session budget and still meters the spend",
    journey: (w) => {
      inRun(w);
      spends(w, 4);
      return [sessionBudgetUsd(w.state), w.state.run?.spentUsd, w.state.run?.state];
    },
    expected: [null, 4, "running"],
  },
  {
    sentence:
      "Pause interrupts the crew's running turns; Resume carries them on; Stop ends the run",
    journey: (w) => {
      inRun(w);
      const runId = w.state.run!.id;
      w.press({ _tag: "pause", runId });
      const stop = w.controls("reviewer").at(-1);
      w.end("reviewer", { kind: "stopped", by: { kind: "person", subject: "user-1" } });
      const why = w.task(1).midway?.why;
      w.quiet();
      w.press({ _tag: "resume", runId });
      const carried = [w.turns("reviewer"), w.lastTurnAs("reviewer")];
      w.run("reviewer");
      w.press({ _tag: "stop", runId });
      return [stop, why, carried, w.state.run?.state, w.controls("reviewer").at(-1)];
    },
    expected: [
      "Stop",
      "when you stopped it",
      [["task", "continue"], { kind: "crew", startedBy: "user-2" }],
      "stopped",
      "Stop",
    ],
  },
  {
    sentence: "the usage window at the run's stop pauses it, and the section reads the window",
    journey: (w) => {
      inRun(w, { stopAtUsagePercent: 80 });
      w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: 79 });
      const below = w.state.run?.state;
      w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: 85 });
      return [below, w.state.run?.state, w.state.run?.reason, w.controls("reviewer").at(-1)];
    },
    expected: ["running", "paused", "usage", "Stop"],
  },
  {
    sentence: "a run's time is the time its crew works: sitting idle never reaches the limit",
    journey: (w) => {
      inRun(w, { timeLimitHours: 1 });
      w.advance(HOUR / 2);
      w.tool("reviewer", { tool: "report", input: { status: "done", summary: "Read." } });
      spends(w, 0);
      w.advance(2 * HOUR);
      w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: 1 });
      const idle = [w.state.run?.state, w.armed("run-time").length];
      w.press({ _tag: "message", handle: "reviewer", text: "Go on.", attachments: [] });
      w.run("reviewer");
      const due = w.armed("run-time")[0]!.dueAt - w.now;
      w.advance(due);
      w.fire("run-time", w.state.run!.id);
      return [idle, due, w.state.run?.state, w.state.run?.reason];
    },
    expected: [["running", 0], HOUR / 2, "paused", "time"],
  },
];

describe("crew run limits", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
