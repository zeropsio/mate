import type { CrewCommand } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { CrewWorld, OPTIONS, OTHER, home, lead, newTask, writer } from "./crewDecideFixture.ts";
import { doorLogins } from "./decide.ts";

const EVA = "claudeAgent_eva";
const EVAS = "Only Eva runs her login.";

/** A crew whose writer runs on Eva's login, with one task on its board. */
const crew = () => {
  const w = new CrewWorld();
  w.apply(home(lead(), writer("backend", { login: EVA, run: "npm run dev" })));
  newTask(w, "backend", "Paginate");
  return w;
};

describe("the crew's door", () => {
  const presses: ReadonlyArray<
    readonly [string, (taskId: string) => CrewCommand, ReadonlyArray<string>]
  > = [
    [
      "a message",
      () => ({ _tag: "message", handle: "backend", text: "More", attachments: [] }),
      [EVA],
    ],
    [
      "a new task",
      () => ({
        _tag: "taskCreate",
        owner: "backend",
        title: "Queue it",
        brief: "",
        doneWhen: "",
        dependsOn: [],
      }),
      [EVA],
    ],
    ["a discard", (taskId) => ({ _tag: "discard", taskId }), [EVA]],
    ["an edit", (taskId) => ({ _tag: "taskEdit", taskId, title: "Renamed" }), [EVA]],
    ["a landing", (taskId) => ({ _tag: "land", taskId }), [EVA]],
    ["Start fresh", () => ({ _tag: "startFresh", handle: "backend" }), [EVA]],
    [
      "a removal",
      () => ({ _tag: "removeCrewmate", handle: "backend", discardUnlanded: true }),
      [EVA],
    ],
    ["its app", () => ({ _tag: "appRun", handle: "backend" }), [EVA]],
    ["a run's start", () => ({ _tag: "start", ...OPTIONS }), ["claudeAgent", EVA]],
  ];

  it.each(presses)(
    "judges each press on the logins it reaches, and refuses the ones Eva's login runs: %s",
    (_, press, logins) => {
      const w = crew();
      const command = press(w.task(1).id);
      const before = w.state;
      w.refusedAtDoor(command, EVAS);
      expect([doorLogins(w.state, command), w.rejection(), w.rejectionDetail(), w.state]).toEqual([
        logins,
        "not-allowed",
        EVAS,
        before,
      ]);
    },
  );

  it("lets a colleague who may run no login pause and stop a running crew, its turns interrupted, and nothing more", () => {
    const w = crew();
    w.press({ _tag: "start", ...OPTIONS });
    w.quiet();
    w.start("backend");
    const runId = w.state.run!.id;
    w.tell({ _tag: "Press", press: { _tag: "pause", runId }, door: { refusal: EVAS } }, OTHER);
    const paused = [w.state.run?.state, w.controls("backend").at(-1)];
    w.tell({ _tag: "Press", press: { _tag: "stop", runId }, door: { refusal: EVAS } }, OTHER);
    w.tell({ _tag: "Press", press: { _tag: "resume", runId }, door: { refusal: EVAS } }, OTHER);
    expect([paused, w.state.run?.state, w.rejection()]).toEqual([
      ["paused", "Stop"],
      "stopped",
      "not-allowed",
    ]);
  });
});
