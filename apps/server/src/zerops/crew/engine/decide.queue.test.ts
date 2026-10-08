import { describe, expect, it } from "@effect/vitest";

import {
  CrewWorld,
  OPTIONS,
  OTHER,
  PERSON,
  finish,
  home,
  landIt,
  lead,
  newTask,
  reader,
  writer,
} from "./crewDecideFixture.ts";

interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const journeys: ReadonlyArray<Journey> = [
  {
    sentence: "a task for a busy crewmate queues and starts as its creator when the first lands",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First", OTHER);
      w.start("backend");
      newTask(w, "backend", "Second", PERSON);
      const queued = w.task(2).state;
      finish(w, "backend");
      landIt(w, 1, OTHER);
      w.start("backend");
      return [queued, w.task(1).state, w.task(2).state, w.lastTurnAs("backend")];
    },
    expected: ["queued", "landed", "working", PERSON],
  },
  {
    sentence: "a queued task admission refuses stays queued with a Can't start row",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.refuse("reviewer", "not the login's signer");
      w.advance(60_000).tell({ _tag: "Gauge", login: "other", usagePercent: 3 });
      const task = w.task(1);
      return [task.state, task.cantStart?.text, w.turns("reviewer").length];
    },
    expected: ["queued", "not the login's signer", 1],
  },
  {
    sentence: "Try again is only for a queued task admission refused",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Busy");
      w.run("reviewer");
      newTask(w, "reviewer", "Waiting");
      w.press({ _tag: "taskRetry", taskId: w.task(2).id });
      const plain = w.rejection();
      w.end("reviewer");
      w.press({ _tag: "discard", taskId: w.task(1).id });
      w.refuse("reviewer", "not the login's signer");
      w.press({ _tag: "taskRetry", taskId: w.task(2).id });
      const refused = w.rejection();
      w.run("reviewer");
      return [plain, refused, w.task(2).state, w.task(2).cantStart];
    },
    expected: ["wrong-state", undefined, "working", null],
  },
  {
    sentence: "a refused queued task waits through another login's sign-in",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.refuse("reviewer", "not the login's signer");
      w.tell({ _tag: "LoginsChanged", logins: ["codex"] });
      return [w.task(1).cantStart?.text, w.turns("reviewer").length];
    },
    expected: ["not the login's signer", 1],
  },
  {
    sentence: "a refused queued task starts again once a login's sign-in changes",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.refuse("reviewer", "not the login's signer");
      w.tell({ _tag: "LoginsChanged", logins: ["claudeAgent"] });
      w.run("reviewer");
      return [w.task(1).state, w.task(1).cantStart, w.turns("reviewer")];
    },
    expected: ["working", null, ["task", "task"]],
  },
  {
    sentence:
      "a run dispatches queued work as its starter; admission refusing it pauses the run with its words",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      newTask(w, "backend", "Second");
      w.press({ _tag: "start", ...OPTIONS }, OTHER);
      w.quiet();
      finish(w, "backend");
      landIt(w, 1);
      w.quiet();
      w.settle("crew.lane.reset", "backend", { _tag: "ready", resetTo: null });
      const as = w.lastTurnAs("backend");
      w.refuse("backend", "not the login's signer");
      return [as, w.state.run?.state, w.state.run?.reason, w.state.run?.reasonDetail];
    },
    expected: [
      { kind: "crew", startedBy: "user-2" },
      "paused",
      "refused",
      "not the login's signer",
    ],
  },
  {
    sentence: "Tell the crew: one mention a task, none refused",
    journey: (w) => {
      w.apply(home(writer("backend"), reader("reviewer")));
      w.press({
        _tag: "tell",
        text: "@reviewer read the README",
        mentions: [{ handle: "reviewer" }],
      });
      const one = Object.values(w.state.tasks).map((task) => [task.owner, task.title]);
      w.press({ _tag: "tell", text: "anyone?", mentions: [] });
      return [one, w.rejection(), Object.keys(w.state.tasks).length];
    },
    expected: [[["reviewer", "@reviewer read the README"]], "no-mention", 1],
  },
  {
    sentence: "Tell the crew to a busy crewmate is refused and creates nothing",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
      w.end("backend");
      w.press({ _tag: "tell", text: "@backend also this", mentions: [{ handle: "backend" }] });
      return [w.rejection(), Object.keys(w.state.tasks).length];
    },
    expected: ["wrong-state", 1],
  },
  {
    sentence: "a discard while the check runs is refused as busy, and the check is not undone",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
      w.end("backend");
      w.checkpoint("backend");
      w.settle("crew.mergeIn", "backend", { _tag: "merged", head: "h".repeat(40) });
      w.press({ _tag: "discard", taskId: w.task(1).id });
      const refused = w.rejection();
      w.settle("crew.check", "backend", { _tag: "passed", tail: "ok", tip: null });
      return [refused, w.task(1).state];
    },
    expected: ["wrong-state", "ready"],
  },
  {
    sentence: "a queued task whose dependency was discarded names itself; Drop the wait starts it",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      newTask(w, "backend", "Second", PERSON, [w.task(1).id]);
      w.end("backend");
      w.checkpoint("backend");
      w.press({ _tag: "discard", taskId: w.task(1).id });
      w.settle("crew.lane.keep", "backend", { _tag: "kept" });
      const held = [w.task(1).state, w.task(2).state, w.pending("crew.lane.reset", "backend")];
      w.edit(2, { dependsOn: [] }, OTHER);
      w.start("backend");
      return [held, w.task(2).state, w.lastTurnAs("backend")];
    },
    expected: [["discarded", "queued", undefined], "working", OTHER],
  },
  {
    sentence: "crew_propose puts a plan on the board; Start queues it and only a run starts it",
    journey: (w) => {
      w.apply(home(lead(), reader("reviewer")));
      w.press({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
      w.run("lead");
      w.tool("lead", {
        tool: "propose",
        plan: [{ owner: "reviewer", title: "Read the code", brief: "Read it all." }],
      });
      const proposed = w.task(1).state;
      w.end("lead");
      w.press({ _tag: "planAccept", taskIds: [w.task(1).id] });
      const accepted = [w.task(1).state, w.turns("reviewer").length];
      w.press({ _tag: "start", ...OPTIONS }, OTHER);
      w.quiet();
      w.run("reviewer");
      return [proposed, accepted, w.task(1).state, w.task(1).createdBy];
    },
    expected: ["proposed", ["queued", 0], "working", "user-1"],
  },
  {
    sentence: "a run that lets the lead start tasks queues its plan and starts it",
    journey: (w) => {
      w.apply(home(lead(), reader("reviewer")));
      w.press({ _tag: "start", ...OPTIONS, leadMayStart: true }, OTHER);
      w.press({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
      w.run("lead");
      w.tool("lead", {
        tool: "propose",
        plan: [{ owner: "reviewer", title: "Read the code", brief: "Read it all." }],
      });
      w.run("reviewer");
      return [w.task(1).state, w.task(1).createdBy, w.lastTurnAs("reviewer")];
    },
    expected: ["working", "user-2", { kind: "crew", startedBy: "user-2" }],
  },
  {
    sentence: "Try again on a stopped task queues it for its next attempt and starts it",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      newTask(w, "reviewer", "Read it");
      w.run("reviewer");
      w.end("reviewer", { kind: "failed", reason: "api_error", next: null });
      w.run("reviewer");
      w.end("reviewer", { kind: "failed", reason: "api_error", next: null });
      const stopped = [w.task(1).state, w.task(1).counters.attempt];
      w.press({ _tag: "taskRetry", taskId: w.task(1).id }, OTHER);
      w.run("reviewer");
      return [stopped, w.task(1).state, w.task(1).counters.attempt, w.lastTurnAs("reviewer")];
    },
    expected: [["parked", 2], "working", 3, OTHER],
  },
];

describe("crew queue", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
