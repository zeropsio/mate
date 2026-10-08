import type { CrewMemberSpec } from "@t3tools/shared/crewHome";
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
import { MOVED_AFTER_CHECK } from "../crewMachines.ts";

const COMMIT = "c".repeat(40);
const LANDED = { _tag: "landed", commit: COMMIT } as const;

/** A writer working its first task, its card admitted. */
const working = (w: CrewWorld, ...crew: ReadonlyArray<CrewMemberSpec>) => {
  w.apply(home(...(crew.length === 0 ? [writer("backend")] : crew)));
  newTask(w, "backend", "First");
  w.start("backend");
};

const checkFails = (w: CrewWorld) => {
  w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
  w.end("backend");
  w.checkpoint("backend");
  w.settle("crew.mergeIn", "backend", { _tag: "merged", head: "h".repeat(40) });
  w.settle("crew.check", "backend", { _tag: "failed", tail: "FAIL hud.test.ts\n1 failing" });
};

const conflicts = (w: CrewWorld) => {
  w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
  w.end("backend");
  w.checkpoint("backend");
  w.settle("crew.mergeIn", "backend", {
    _tag: "conflict",
    head: "h".repeat(40),
    paths: ["src/hud.ts"],
  });
};

const run = (w: CrewWorld, landing: "person" | "lead" | "check") => {
  w.press({ _tag: "start", ...OPTIONS, landing }, OTHER);
  w.quiet();
};

interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const journeys: ReadonlyArray<Journey> = [
  {
    sentence: "with Land when the check passes, a run lands a task without a press",
    journey: (w) => {
      working(w);
      run(w, "check");
      finish(w, "backend");
      w.settle("crew.land", "backend", LANDED);
      return [w.task(1).state, w.task(1).landedCommit];
    },
    expected: ["landed", COMMIT],
  },
  {
    sentence: "with I land everything, a run leaves a ready task for your Land",
    journey: (w) => {
      working(w);
      run(w, "person");
      finish(w, "backend");
      w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: 10 });
      return [w.task(1).state, w.pending("crew.land", "backend")];
    },
    expected: ["ready", undefined],
  },
  {
    sentence: "Start lands a ready task when the run's landing lands it",
    journey: (w) => {
      working(w);
      finish(w, "backend");
      const before = w.pending("crew.land", "backend");
      run(w, "check");
      w.settle("crew.land", "backend", LANDED);
      return [before, w.task(1).state];
    },
    expected: [undefined, "landed"],
  },
  {
    sentence: "a run's landing held by your working chat says so, in the crew log and the section",
    journey: (w) => {
      working(w);
      run(w, "check");
      w.mateTurn(true);
      finish(w, "backend");
      const held = [
        w.task(1).state,
        w.state.heldLandings[w.task(1).id],
        w.state.lastError,
        w.pending("crew.land", "backend"),
      ];
      w.mateTurn(false);
      w.settle("crew.land", "backend", LANDED);
      return [held, w.task(1).state];
    },
    expected: [
      [
        "ready",
        "a chat of this Mate is working; land between its turns",
        "#1 waits to land: a chat of this Mate is working; land between its turns",
        undefined,
      ],
      "landed",
    ],
  },
  {
    sentence: "a landing held for a reason is said once, in the log and as the last error",
    journey: (w) => {
      working(w);
      run(w, "check");
      w.mateTurn(true);
      finish(w, "backend");
      w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: 10 });
      w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: 20 });
      return [w.recorded("LandingHeld"), w.recorded("ErrorNoted")];
    },
    expected: [1, 1],
  },
  {
    sentence: "a ready task advanced again while its landing is queued is landed once",
    journey: (w) => {
      working(w);
      run(w, "check");
      finish(w, "backend");
      w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: 10 });
      w.tell({ _tag: "LoginsChanged", logins: ["claudeAgent"] });
      return w.effects.filter((effect) => effect.kind === "crew.land").length;
    },
    expected: 1,
  },
  {
    sentence: "a landing that finds its task landed meanwhile is a landing done, not a hold",
    journey: (w) => {
      working(w);
      finish(w, "backend");
      w.press({ _tag: "land", taskId: w.task(1).id });
      w.settle("crew.land", "backend", { _tag: "already-landed", commit: COMMIT });
      return [w.task(1).state, w.state.heldLandings, w.state.lastError];
    },
    expected: ["landed", {}, null],
  },
  {
    sentence:
      "an accepted task whose landing finds your tree moved merges again and lands, without a second review",
    journey: (w) => {
      working(w, lead(), writer("backend"));
      run(w, "lead");
      finish(w, "backend");
      w.run("lead");
      w.tool("lead", { tool: "review", input: { task: 1, verdict: "accept", note: "" } });
      w.end("lead");
      w.settle("crew.land", "backend", { _tag: "head-moved" });
      w.mergeAndCheck("backend");
      w.settle("crew.land", "backend", LANDED);
      return [w.task(1).state, w.turns("lead")];
    },
    expected: ["landed", ["review"]],
  },
  {
    sentence:
      "a landing that finds your tree moved says so in the crew log, merges again and lands",
    journey: (w) => {
      working(w);
      finish(w, "backend");
      w.press({ _tag: "land", taskId: w.task(1).id });
      w.settle("crew.land", "backend", { _tag: "head-moved" });
      const said = w.state.heldLandings[w.task(1).id];
      w.mergeAndCheck("backend");
      w.settle("crew.land", "backend", LANDED);
      return [said, w.task(1).state, w.task(1).counters.remerges];
    },
    expected: ["your tree moved since its check; it merges again", "landed", 1],
  },
  {
    sentence:
      "Land now on a crewmate that never reported: WIP, merge-in, check and land; its chat shows the landing",
    journey: (w) => {
      working(w);
      w.end("backend");
      w.checkpoint("backend");
      w.press({ _tag: "landNow", taskId: w.task(1).id }, OTHER);
      const wip = w.pending("crew.checkpoint", "backend")?.payload;
      w.checkpoint("backend");
      w.mergeAndCheck("backend");
      w.settle("crew.land", "backend", LANDED);
      return [
        wip !== undefined && "purpose" in wip ? wip.purpose : undefined,
        w.task(1).state,
        w.controls("backend").at(-1),
      ];
    },
    expected: ["land-now", "landed", "Seam"],
  },
  {
    sentence: "Land now takes a task back from rework as its copy stands",
    journey: (w) => {
      working(w);
      checkFails(w);
      const rework = w.task(1).state;
      w.press({ _tag: "landNow", taskId: w.task(1).id });
      w.checkpoint("backend");
      w.mergeAndCheck("backend");
      w.settle("crew.land", "backend", LANDED);
      return [rework, w.task(1).state];
    },
    expected: ["rework", "landed"],
  },
  {
    sentence:
      "a failed check goes back as rework; a landing refused by your edit waits on your tree",
    journey: (w) => {
      working(w);
      checkFails(w);
      const rework = [w.task(1).state, w.task(1).wait?.on];
      w.press({ _tag: "askFix", taskId: w.task(1).id });
      w.run("backend");
      finish(w, "backend");
      w.press({ _tag: "land", taskId: w.task(1).id });
      w.settle("crew.land", "backend", { _tag: "dirty-tree", paths: ["README.md"] });
      const waiting = [w.task(1).state, w.task(1).wait?.paths];
      w.press({ _tag: "land", taskId: w.task(1).id });
      w.mergeAndCheck("backend");
      w.settle("crew.land", "backend", LANDED);
      return [rework, waiting, w.task(1).state];
    },
    expected: [["rework", "check-failed"], ["waiting-on-you", ["README.md"]], "landed"],
  },
  {
    sentence: "in a run, a failed check goes back to its crewmate on its own",
    journey: (w) => {
      working(w);
      run(w, "person");
      checkFails(w);
      const fix = w.delivered.findLast((entry) => entry.handle === "backend")?.command;
      return [
        w.task(1).state,
        fix?._tag === "Send" ? [fix.card?.kind, fix.card?.why, fix.principal] : [],
      ];
    },
    expected: [
      "working",
      ["fix", "FAIL hud.test.ts\n1 failing", { kind: "crew", startedBy: "user-2" }],
    ],
  },
  {
    sentence: "in a run, a merge conflict goes back to its crewmate on its own",
    journey: (w) => {
      working(w);
      run(w, "person");
      conflicts(w);
      return [w.task(1).state, w.turns("backend")];
    },
    expected: ["working", ["task", "resolve"]],
  },
  {
    sentence:
      "a merge-in conflict goes back naming the files; Ask to resolve sends one turn as you",
    journey: (w) => {
      working(w);
      conflicts(w);
      const rework = [w.task(1).state, w.task(1).wait?.paths, w.turns("backend")];
      w.press({ _tag: "askResolve", taskId: w.task(1).id }, OTHER);
      return [rework, w.turns("backend"), w.lastTurnAs("backend")];
    },
    expected: [["rework", ["src/hud.ts"], ["task"]], ["task", "resolve"], OTHER],
  },
  {
    sentence:
      "the rig: an accepted review of a copy with nothing of its own closes the task, and the queue moves",
    journey: (w) => {
      working(w);
      newTask(w, "backend", "Second");
      finish(w, "backend");
      w.press({ _tag: "land", taskId: w.task(1).id });
      w.settle("crew.land", "backend", { _tag: "nothing" });
      w.quiet();
      w.start("backend");
      return [w.task(1).state, w.task(1).landedCommit, w.task(2).state];
    },
    expected: ["landed", null, "working"],
  },
  {
    sentence: "Land refuses a copy that moved after its check and lands nothing",
    journey: (w) => {
      working(w);
      finish(w, "backend");
      w.press({ _tag: "land", taskId: w.task(1).id });
      w.settle("crew.land", "backend", { _tag: "unchecked" });
      return [w.task(1).state, w.task(1).wait?.reason, w.task(1).landedCommit];
    },
    expected: ["parked", MOVED_AFTER_CHECK, null],
  },
  {
    sentence: "a turn's end never commits edits on a checked copy: its task stops",
    journey: (w) => {
      working(w);
      finish(w, "backend");
      w.selfRun("backend");
      w.end("backend");
      w.settle("crew.checkpoint", "backend", { _tag: "edited-after-check" });
      return [w.task(1).state, w.task(1).wait?.reason];
    },
    expected: [
      "parked",
      "its copy has edits made after its check; they stay in its copy and do not land",
    ],
  },
];

describe("crew landing", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
