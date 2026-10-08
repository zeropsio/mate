import { describe, expect, it } from "@effect/vitest";

import { CrewWorld, OTHER, PERSON, home, newTask, reader, writer } from "./crewDecideFixture.ts";

/**
 * A crewmate talks in one conversation; clearing it, a rotation and a job save are new sessions
 * in it, each a boundary the record shows — never a new conversation behind a link.
 */
interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const NEW_JOB = "backend owns the HUD now.";

const journeys: ReadonlyArray<Journey> = [
  {
    sentence: "Apply opens each crewmate's first conversation, without a turn",
    journey: (w) => {
      w.press({ _tag: "apply" }, PERSON, home(writer("backend"), reader("reviewer")));
      return [
        w.controls("backend"),
        w.controls("reviewer"),
        w.turns("backend").length + w.turns("reviewer").length,
        w.state.members.backend!.conversationId,
        w.state.members.backend!.session.count,
      ];
    },
    expected: [["AssignAgent"], ["AssignAgent"], 0, "crew-main-backend-1", 1],
  },
  {
    sentence:
      "a message to an idle crewmate opens one implicit task and a session; a second steers it",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      w.press({ _tag: "message", handle: "reviewer", text: "Read the README", attachments: [] });
      w.run("reviewer");
      w.press({ _tag: "message", handle: "reviewer", text: "And the docs", attachments: [] });
      const tasks = Object.values(w.state.tasks).map((task) => [task.source, task.title]);
      return [tasks, w.turns("reviewer"), w.state.members.reviewer!.session.count];
    },
    expected: [[["message", "Read the README"]], ["task", "message"], 1],
  },
  {
    sentence:
      "a message a saved job's new session takes carries its task's card and why the session is new",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      w.end("backend");
      w.checkpoint("backend");
      w.press(
        { _tag: "jobSave", handle: "backend", apply: "nextTurn" },
        PERSON,
        home(writer("backend", { job: NEW_JOB })),
      );
      w.quiet();
      w.press({ _tag: "message", handle: "backend", text: "Go on.", attachments: [] });
      w.quiet();
      const words = w.delivered.flatMap(({ command }) =>
        command._tag === "Seam" ? [command.words] : command._tag === "Send" ? [command.text] : [],
      );
      return words.slice(-2);
    },
    expected: [
      "Its job changed — from its next message",
      "[Crew task card]\n#1 First · continues\nIts job changed\n\nGo on.",
    ],
  },
  {
    sentence: "a message to a crewmate whose turn runs joins that turn, as V1 steers it",
    journey: (w) => {
      w.apply(home(reader("reviewer")));
      w.press({ _tag: "message", handle: "reviewer", text: "Read the README", attachments: [] });
      const runId = w.run("reviewer");
      w.press({ _tag: "message", handle: "reviewer", text: "And the docs", attachments: [] });
      const sent = w.delivered.at(-1)!.command;
      return sent._tag === "Send" ? [sent.text, sent.steer === runId] : sent._tag;
    },
    expected: ["And the docs", true],
  },
  {
    sentence: "a job saved for the next turn rotates the session before that turn",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      w.end("backend");
      w.checkpoint("backend");
      w.press(
        { _tag: "jobSave", handle: "backend", apply: "nextTurn" },
        PERSON,
        home(writer("backend", { job: NEW_JOB })),
      );
      const saved = [w.controls("backend").slice(1), w.state.members.backend!.session.count];
      w.quiet();
      w.press({ _tag: "message", handle: "backend", text: "Go on.", attachments: [] });
      w.quiet();
      w.run("backend");
      const backend = w.state.members.backend!;
      return [saved, w.controls("backend").slice(1), backend.session, backend.jobVersion];
    },
    expected: [
      [["Seam"], 1],
      ["Seam", "RotateSession"],
      {
        count: 2,
        lastReason: "job",
        running: { brief: 1, job: 2 },
        principal: "user-1",
        login: "claudeAgent",
        compactions: 0,
        startedAt: Date.parse("2026-10-08T10:00:00.000Z"),
        costKept: 0,
      },
      2,
    ],
  },
  {
    sentence:
      "Start fresh rotates between turns; Save and apply now interrupts, rotates and continues",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "First");
      w.start("backend");
      // Not during a turn: V1's rule, which the crew's journeys hold on both engines.
      w.press({ _tag: "startFresh", handle: "backend" });
      const waits = [w.rejection(), w.rejectionDetail(), w.controls("backend").slice(1)];
      w.end("backend");
      w.checkpoint("backend");
      w.press({ _tag: "startFresh", handle: "backend" });
      const fresh = [w.controls("backend").slice(1), w.state.members.backend!.session.lastReason];
      w.quiet();
      w.press({ _tag: "message", handle: "backend", text: "Go on.", attachments: [] });
      w.run("backend");
      w.press(
        { _tag: "jobSave", handle: "backend", apply: "now" },
        OTHER,
        home(writer("backend", { job: NEW_JOB })),
      );
      const interrupted = w.controls("backend").slice(1);
      w.quiet();
      w.end("backend", { kind: "stopped", by: OTHER });
      w.checkpoint("backend");
      return [
        waits,
        fresh,
        interrupted,
        w.controls("backend").slice(1),
        w.turns("backend"),
        w.lastTurnAs("backend"),
      ];
    },
    expected: [
      ["wrong-state", "@backend's turn is running", []],
      [["RotateSession"], "cleared"],
      ["RotateSession", "Seam", "Stop"],
      ["RotateSession", "Seam", "Stop", "RotateSession"],
      ["task", "message", "continue"],
      { kind: "crew", startedBy: "user-2" },
    ],
  },
  {
    sentence: "a changed login saves only as fresh; the section names it by its label",
    journey: (w) => {
      w.apply(home(writer("backend")));
      const work = home(writer("backend", { login: "claudeWork" }));
      w.press({ _tag: "jobSave", handle: "backend", apply: "nextTurn" }, PERSON, work);
      const refused = w.rejection();
      w.press({ _tag: "jobSave", handle: "backend", apply: "fresh" }, PERSON, work);
      const backend = w.state.members.backend!;
      return [refused, backend.login, backend.session.lastReason, w.controls("backend")];
    },
    expected: [
      "wrong-state",
      "claudeWork",
      "login",
      ["AssignAgent", "AssignAgent", "Seam", "RotateSession"],
    ],
  },
];

describe("a crewmate's sessions in its one conversation", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
