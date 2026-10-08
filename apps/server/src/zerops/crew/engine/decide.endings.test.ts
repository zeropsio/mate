import { describe, expect, it } from "@effect/vitest";

import { AGENT_STOPPED_ITSELF } from "../../../engine/domain/decide.ts";

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
    sentence: "a graceful shutdown during a check leaves it for the next boot to carry on",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "Fix it");
      w.start("backend");
      w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
      w.end("backend");
      w.checkpoint("backend");
      w.settle("crew.mergeIn", "backend", { _tag: "merged", head: "h".repeat(40) });
      restarted(w);
      const [row] = w.task(1).attemptRows ?? [];
      w.settle("crew.check", "backend", { _tag: "passed", tail: "ok", tip: "t".repeat(40) });
      return [row?.ending, row?.endingDetail, w.task(1).state];
    },
    expected: ["interrupted", "Its turn had ended; the Mate restarted during its check.", "ready"],
  },
  {
    sentence: "a restart in a running run carries on a task its nudge left standing",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      w.press({ _tag: "start", ...OPTIONS }, OTHER);
      w.quiet();
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.end("reviewer");
      w.run("reviewer");
      w.end("reviewer");
      const before = w.turns("reviewer");
      restarted(w);
      w.quiet();
      return [before, w.turns("reviewer")];
    },
    expected: [
      ["task", "nudge"],
      ["task", "nudge", "continue"],
    ],
  },
  {
    sentence:
      "a turn its agent stopped on its own is interrupted, not broken: its task stays in its attempt",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.end("reviewer", { kind: "failed", reason: AGENT_STOPPED_ITSELF, next: null });
      const task = w.task(1);
      return [task.state, task.counters.attempt, task.midway?.ending, task.midway?.why];
    },
    expected: ["working", 1, "interrupted", "its turn was interrupted"],
  },
  {
    sentence: "each attempt keeps its row: how and when it ended, its words, what it cost",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      const running = w.task(1).attemptRows;
      w.advance(60_000);
      w.end("reviewer", { kind: "completed" }, { costUsd: 0.5 });
      const ended = w.task(1).attemptRows;
      w.quiet();
      w.press({ _tag: "message", handle: "reviewer", text: "Go on.", attachments: [] });
      return [running, ended, w.task(1).attemptRows];
    },
    expected: [
      [{ attempt: 1, ending: null, endingDetail: null, costUsd: 0, endedAt: null }],
      [
        {
          attempt: 1,
          ending: "no-report",
          endingDetail: "its turn ended without a report",
          costUsd: 0.5,
          endedAt: Date.parse("2026-10-08T10:01:00.000Z"),
        },
      ],
      [{ attempt: 1, ending: null, endingDetail: null, costUsd: 0.5, endedAt: null }],
    ],
  },
  {
    sentence: "a turn's end the crew read once is not taken in again when its record is read again",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      w.press({ _tag: "start", ...OPTIONS }, OTHER);
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.end("reviewer");
      const conversation = w.state.members.reviewer!.conversationId;
      const readUpTo = w.state.cursors[conversation];
      w.replay("reviewer");
      return [w.turns("reviewer"), readUpTo, w.recorded("ObservedUpTo")];
    },
    expected: [["task", "nudge"], 4, 2],
  },
  {
    sentence:
      "a batch that starts past the crew's cursor is refused, so no event of a record is skipped",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      const conversation = w.state.members.reviewer!.conversationId;
      const upTo = w.state.cursors[conversation]!;
      const decision = w.tell(
        {
          _tag: "Observed",
          conversationId: conversation,
          events: [
            {
              _tag: "RunAdmitted",
              v: 1,
              conversationId: conversation,
              seq: upTo + 2,
              at: 0,
              commandId: "after-a-lost-batch",
              runId: `${conversation}/r/9`,
            },
          ] as never,
        },
        { kind: "engine" },
      );
      return [decision._tag, w.state.cursors[conversation] === upTo];
    },
    expected: ["Reject", true],
  },
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
      {
        since: Date.parse("2026-10-08T10:01:00.000Z"),
        why: "its turn ended without a report",
        ending: "no-report",
      },
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
    // Carried on by the crew for the person it ran for, outside their session (V1's admission).
    expected: ["finished", ["task", "continue"], { kind: "crew", startedBy: "user-1" }],
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
  {
    sentence: "work a restart left uncommitted is saved and said in its crewmate's chat",
    journey: (w) => {
      w.apply(home(writer("backend")));
      restarted(w);
      w.settle("crew.sweep", "backend", {
        swept: true,
        copy: { _tag: "committed", commit: "s".repeat(40), paths: ["src/hud.ts"] },
      });
      return w.delivered.at(-1)?.command;
    },
    expected: {
      _tag: "Seam",
      seam: {
        seam: "swept",
        branch: "crew/backend",
        commit: "s".repeat(40),
        paths: ["src/hud.ts"],
      },
    },
  },
  {
    sentence: "edits a restart found on a checked copy stop its task; they never land",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
      w.end("backend");
      w.checkpoint("backend");
      w.mergeAndCheck("backend");
      restarted(w);
      const sweep = w.pending("crew.sweep", "backend")?.payload;
      w.settle("crew.sweep", "backend", { swept: false, copy: { _tag: "held" } });
      return [sweep?.kind === "crew.sweep" && sweep.checked, w.task(1).state];
    },
    expected: [true, "parked"],
  },
  {
    sentence: "a copy a restart found gone is brought back",
    journey: (w) => {
      w.apply(home(writer("backend")));
      restarted(w);
      w.settle("crew.sweep", "backend", { swept: false, copy: { _tag: "missing" } });
      const recover = w.pending("crew.recover", "appdev")?.payload;
      return [
        w.state.members.backend?.lane?.state,
        recover?.kind === "crew.recover" ? recover.handles : undefined,
      ];
    },
    expected: ["missing", ["backend"]],
  },
];

describe("crew turn endings", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
