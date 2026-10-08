import { describe, expect, it } from "@effect/vitest";

import {
  CrewWorld,
  OPTIONS,
  OTHER,
  finish,
  home,
  lead,
  newTask,
  reader,
  writer,
} from "./crewDecideFixture.ts";
import { LEAD_WAKE_SPACING_MS, leadWakesToRenew } from "./decide.ts";
import type { TaskRecord } from "./state.ts";

const LEAD_LANDS = { ...OPTIONS, landing: "lead" } as const;

/** A reader's task through its turn to a report: done goes to review in a run the lead lands. */
const reported = (w: CrewWorld, handle: string, title: string) => {
  newTask(w, handle, title);
  w.run(handle);
  w.tool(handle, { tool: "report", input: { status: "done", summary: `${title} done.` } });
  w.end(handle);
};

const asks = (w: CrewWorld, handle: string, question: string) =>
  w.tool(handle, { tool: "report", input: { status: "blocked", summary: "?", question } });

interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const journeys: ReadonlyArray<Journey> = [
  {
    sentence: "the lead's wakes stand at least two minutes apart",
    journey: (w) => {
      w.apply(home(lead(), reader("a"), reader("b")));
      w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
      reported(w, "a", "First");
      const woken = w.now;
      w.run("lead");
      w.end("lead");
      w.advance(30_000);
      reported(w, "b", "Second");
      const before = [w.turns("lead"), w.armed("lead-wake").map((wake) => wake.dueAt - woken)];
      w.advance(LEAD_WAKE_SPACING_MS - 30_000);
      w.fire("lead-wake", w.armed("lead-wake")[0]!.key);
      return [before, w.turns("lead")];
    },
    expected: [
      [["review"], [LEAD_WAKE_SPACING_MS]],
      ["review", "review"],
    ],
  },
  {
    sentence: "a crewmate's question goes to the lead first; the lead's reply is its answer",
    journey: (w) => {
      w.apply(home(lead(), reader("reviewer")));
      w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
      newTask(w, "reviewer", "Prices");
      w.run("reviewer");
      asks(w, "reviewer", "CZK or EUR?");
      w.end("reviewer");
      w.run("lead");
      w.says("lead", "EUR.");
      w.end("lead");
      const answer = w.delivered.findLast((entry) => entry.handle === "reviewer");
      return [
        w.turns("lead"),
        w.turns("reviewer"),
        answer?.command._tag === "Send" ? answer.command.card?.why : undefined,
        w.task(1).state,
      ];
    },
    expected: [["question"], ["task", "answer"], "EUR.", "working"],
  },
  {
    sentence:
      "a question the lead passes on reaches you at once; the next one waits on the lead again",
    journey: (w) => {
      w.apply(home(lead(), reader("reviewer")));
      w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
      newTask(w, "reviewer", "Prices");
      w.run("reviewer");
      asks(w, "reviewer", "CZK or EUR?");
      w.end("reviewer");
      w.run("lead");
      asks(w, "lead", "CZK or EUR?");
      w.end("lead");
      const passed = Object.keys(w.state.lead.escalated).length;
      w.press({ _tag: "answer", handle: "reviewer", taskId: w.task(1).id, text: "EUR." });
      w.run("reviewer");
      w.advance(1_000);
      asks(w, "reviewer", "And the VAT?");
      w.end("reviewer");
      w.advance(LEAD_WAKE_SPACING_MS);
      w.fire("lead-wake", w.armed("lead-wake")[0]?.key ?? "none");
      return [passed, w.turns("reviewer"), w.turns("lead")];
    },
    expected: [1, ["task", "answer"], ["question", "question"]],
  },
  {
    sentence: "the lead's own question waits on you, and your answer reaches the lead",
    journey: (w) => {
      w.apply(home(lead(), reader("reviewer")));
      w.press({ _tag: "message", handle: "lead", text: "Plan the shop", attachments: [] });
      w.run("lead");
      asks(w, "lead", "Which payment provider?");
      w.end("lead");
      const waiting = w.state.lead.questions.lead?.text;
      w.press({ _tag: "answer", handle: "lead", taskId: null, text: "Stripe." });
      return [waiting, w.state.lead.questions, w.turns("lead")];
    },
    expected: ["Which payment provider?", {}, ["message", "message"]],
  },
  {
    sentence: "in a run the lead lands, a passed check wakes the lead; its accept lands the task",
    journey: (w) => {
      w.apply(home(lead(), writer("backend")));
      w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
      w.quiet();
      newTask(w, "backend", "First");
      w.start("backend");
      finish(w, "backend");
      const review = [w.task(1).state, w.turns("lead")];
      w.run("lead");
      w.tool("lead", { tool: "review", input: { task: 1, verdict: "accept", note: "" } });
      const said = w.reply()?.text;
      w.settle("crew.land", "backend", { _tag: "landed", commit: "c".repeat(40) });
      return [review, said, w.task(1).state, w.task(1).review?.by];
    },
    expected: [["review", ["review"]], "Accepted — landing…", "landed", "lead"],
  },
  {
    sentence: "the lead's reject sends the task back to its crewmate with the note",
    journey: (w) => {
      w.apply(home(lead(), writer("backend")));
      w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
      w.quiet();
      newTask(w, "backend", "First");
      w.start("backend");
      finish(w, "backend");
      w.run("lead");
      w.tool("lead", {
        tool: "review",
        input: { task: 1, verdict: "reject", note: "Name the file hud.ts." },
      });
      const said = w.reply()?.text;
      w.end("lead");
      const rework = w.delivered.findLast((entry) => entry.handle === "backend");
      return [
        said,
        w.task(1).state,
        rework?.command._tag === "Send"
          ? [rework.command.card?.kind, rework.command.card?.why]
          : [],
      ];
    },
    expected: [
      "#1 goes back to @backend with your note.",
      "working",
      ["rework", "Name the file hud.ts."],
    ],
  },
  {
    sentence: "Resume wakes the lead again for the review its pause interrupted",
    journey: (w) => {
      w.apply(home(lead(), reader("reviewer")));
      w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
      reported(w, "reviewer", "First");
      w.run("lead");
      w.press({ _tag: "pause", runId: w.state.run!.id });
      w.end("lead", { kind: "stopped", by: { kind: "person", subject: "user-1" } });
      const paused = w.turns("lead");
      w.advance(10_000);
      w.press({ _tag: "resume", runId: w.state.run!.id });
      return [paused, w.turns("lead")];
    },
    expected: [["review"], ["review", "review"]],
  },
  {
    sentence:
      "a restart wakes the lead again for a pending review only two minutes after its last wake",
    journey: (w) => {
      w.apply(home(lead(), reader("reviewer")));
      w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
      reported(w, "reviewer", "First");
      const woken = w.now;
      w.run("lead");
      w.advance(20_000);
      w.end("lead", { kind: "cut-by-restart", continuedBy: null });
      w.tell({ _tag: "Recovered", bootId: "boot-2" as never }, { kind: "engine" });
      const right = [
        w.turns("lead").length,
        w.armed("lead-wake").map((wake) => wake.dueAt - woken),
      ];
      w.advance(LEAD_WAKE_SPACING_MS);
      w.fire("lead-wake", w.armed("lead-wake")[0]!.key);
      return [right, w.turns("lead")];
    },
    expected: [
      [1, [LEAD_WAKE_SPACING_MS]],
      ["review", "review"],
    ],
  },
  {
    sentence: "a task back from rework is reviewed afresh, its earlier accept gone",
    journey: (w) => {
      w.apply(home(lead(), writer("backend")));
      w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
      w.quiet();
      newTask(w, "backend", "First");
      w.start("backend");
      finish(w, "backend");
      w.run("lead");
      w.tool("lead", { tool: "review", input: { task: 1, verdict: "accept", note: "" } });
      w.end("lead");
      w.settle("crew.land", "backend", { _tag: "head-moved" });
      w.settle("crew.mergeIn", "backend", {
        _tag: "conflict",
        head: "h".repeat(40),
        paths: ["hud.ts"],
      });
      w.run("backend");
      const accept = w.task(1).review;
      w.advance(LEAD_WAKE_SPACING_MS);
      finish(w, "backend");
      return [accept, w.task(1).state, w.turns("backend"), w.turns("lead")];
    },
    expected: [null, "review", ["task", "resolve"], ["review", "review"]],
  },
  {
    sentence:
      "without a run a review left waiting names itself in Waiting on you; Land it myself lands it",
    journey: (w) => {
      w.apply(home(lead(), writer("backend")));
      w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
      w.quiet();
      newTask(w, "backend", "First");
      w.start("backend");
      finish(w, "backend");
      w.press({ _tag: "stop", runId: w.state.run!.id });
      w.quiet();
      w.press({ _tag: "land", taskId: w.task(1).id });
      w.settle("crew.land", "backend", { _tag: "landed", commit: "c".repeat(40) });
      return [w.task(1).state, w.task(1).review];
    },
    expected: ["landed", { verdict: "accept", note: "", by: null }],
  },
  {
    sentence: "crew_finish ends the run",
    journey: (w) => {
      w.apply(home(lead(), reader("reviewer")));
      w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
      w.press({ _tag: "message", handle: "lead", text: "Are we done?", attachments: [] });
      w.run("lead");
      w.tool("lead", { tool: "finish" });
      const said = w.reply();
      w.tool("lead", { tool: "finish" });
      return [said, w.state.run?.state, w.reply()];
    },
    expected: [
      { text: "The run is finished.", isError: false },
      "finished",
      { text: "No run is on.", isError: true },
    ],
  },
];

describe("crew lead", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});

describe("the wakes a Start, a Resume or a restart takes up again", () => {
  const AT = Date.parse("2026-09-28T07:00:00.000Z");
  /** A crew whose one task stands in `state` at `attempt`, the lead woken as given. */
  const arranged = (
    state: TaskRecord["state"],
    attempt: number,
    wakes: { woken: ReadonlyArray<string>; escalated: ReadonlyArray<string>; serving?: string },
  ) => {
    const w = new CrewWorld();
    w.apply(home(lead(), reader("reviewer")));
    newTask(w, "reviewer", "Prices");
    const task = w.task(1);
    const keys = (list: ReadonlyArray<string>) =>
      Object.fromEntries(list.map((key) => [key, true as const]));
    w.state = {
      ...w.state,
      tasks: {
        [task.id]: {
          ...task,
          state,
          askedAt: AT,
          counters: { ...task.counters, attempt },
        },
      },
      lead: {
        ...w.state.lead,
        woken: keys(wakes.woken),
        escalated: keys(wakes.escalated),
        serving:
          wakes.serving === undefined
            ? null
            : { key: wakes.serving, kind: "review", taskId: task.id },
      },
      members:
        wakes.serving === undefined
          ? w.state.members
          : {
              ...w.state.members,
              lead: {
                ...w.state.members.lead!,
                active: {
                  runId: "r" as never,
                  principal: { kind: "engine" },
                  delivery: null,
                  taskId: task.id,
                  purpose: "lead-wake",
                  admitted: true,
                  reached: true,
                  since: AT,
                },
              },
            },
    };
    return w;
  };
  const question = `question:task-1:${AT}`;

  it.each([
    [
      "a review whose wake ended",
      "review",
      1,
      ["review:task-1:1"],
      [],
      undefined,
      ["review:task-1:1"],
    ],
    [
      "a review the lead's running turn serves",
      "review",
      1,
      ["review:task-1:1"],
      [],
      "review:task-1:1",
      [],
    ],
    ["a review never woken for", "review", 1, [], [], undefined, []],
    ["an earlier attempt's review", "review", 2, ["review:task-1:1"], [], undefined, []],
    ["a question whose wake ended", "blocked", 1, [question], [], undefined, [question]],
    [
      "a question the lead passed on to the person",
      "blocked",
      1,
      [question],
      [question],
      undefined,
      [],
    ],
    ["a task that moved on", "ready", 1, ["review:task-1:1"], [], undefined, []],
  ] as const)("%s", (_, state, attempt, woken, escalated, serving, renewed) => {
    const w = arranged(state, attempt, {
      woken,
      escalated,
      ...(serving === undefined ? {} : { serving }),
    });
    expect(leadWakesToRenew(w.state)).toEqual(renewed);
  });
});
