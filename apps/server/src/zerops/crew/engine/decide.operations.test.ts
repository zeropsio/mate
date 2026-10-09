import { describe, expect, it } from "@effect/vitest";

import { CrewWorld, OPTIONS, OTHER, home, lead, newTask, writer } from "./crewDecideFixture.ts";
import { EMPTY_VIEW, crewSnapshotOf } from "./project.ts";

/**
 * Work the crew could not finish on its own stands as an operation: a check whose setup failed,
 * a task its restart could not carry on, a person's turn a restart cut. Continue takes it up
 * again from where it stood; Drop it lets it go.
 */
interface Journey {
  readonly sentence: string;
  readonly journey: (w: CrewWorld) => unknown;
  readonly expected: unknown;
}

const CUT = { kind: "cut-by-restart", continuedBy: null } as const;

const restarted = (w: CrewWorld) =>
  w.tell({ _tag: "Recovered", bootId: "boot-2" as never }, { kind: "engine" });

const operationsOf = (w: CrewWorld) =>
  (crewSnapshotOf(w.state, { ...EMPTY_VIEW, nowMs: w.now }).operations ?? []).map((row) => [
    row.kind,
    row.status,
    row.confirmedStage,
    row.handle,
  ]);

const rowsOf = (w: CrewWorld) =>
  crewSnapshotOf(w.state, { ...EMPTY_VIEW, nowMs: w.now })
    .attention.filter((row) => row.kind === "interrupted")
    .map((row) => [row.handle, row.text, row.operation?.id === row.id]);

const journeys: ReadonlyArray<Journey> = [
  {
    sentence: "a failed setup ends its check operation before the check command starts",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "Fix it");
      w.start("backend");
      w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
      w.end("backend");
      w.checkpoint("backend");
      w.settle("crew.mergeIn", "backend", { _tag: "merged", head: "h".repeat(40) });
      w.settle("crew.check", "backend", { _tag: "setup-failed" });
      const failed = [w.task(1).state, operationsOf(w)];
      const id = crewSnapshotOf(w.state, { ...EMPTY_VIEW, nowMs: w.now }).operations![0]!.id;
      w.press({ _tag: "operationContinue", handle: "backend", operationId: id });
      return [failed, w.task(1).state, w.pending("crew.check", "backend") !== undefined];
    },
    expected: [["parked", [["check", "failed", "setting-up", "backend"]]], "checking", true],
  },
  {
    sentence:
      "Drop it cancels a task its restart could not carry on, its saved work left in its copy",
    journey: (w) => {
      w.apply(home(writer("backend")));
      newTask(w, "backend", "Fix it");
      w.start("backend");
      restarted(w);
      w.end("backend", CUT);
      w.checkpoint("backend");
      // The boot sweep saved what the restart left as a commit on the copy.
      w.settle("crew.sweep", "backend", {
        swept: true,
        copy: { _tag: "committed", commit: "c".repeat(40), paths: ["dirty.txt"] },
      });
      w.quiet();
      w.refuse("backend", "not the login's signer");
      const rows = rowsOf(w);
      const id = crewSnapshotOf(w.state, { ...EMPTY_VIEW, nowMs: w.now }).attention.find(
        (row) => row.kind === "interrupted",
      )!.id;
      w.press({ _tag: "operationDiscard", handle: "backend", operationId: id });
      return [rows, w.task(1).state, w.pending("crew.lane.reset", "backend") === undefined];
    },
    expected: [[["backend", "not the login's signer", true]], "discarded", true],
  },
  {
    sentence: "a person's own turn to the lead in a run keeps its row after a restart",
    journey: (w) => {
      w.apply(home(lead(), writer("backend")));
      w.press({ _tag: "start", ...OPTIONS }, OTHER);
      w.quiet();
      w.press({ _tag: "message", handle: "lead", text: "Plan it", attachments: [] });
      w.run("lead");
      restarted(w);
      w.end("lead", CUT);
      const rows = rowsOf(w);
      const id = crewSnapshotOf(w.state, { ...EMPTY_VIEW, nowMs: w.now }).attention.find(
        (row) => row.kind === "interrupted",
      )!.id;
      w.press({ _tag: "operationContinue", handle: "lead", operationId: id });
      return [rows.length, rows[0]?.[0], w.turns("lead")];
    },
    expected: [1, "lead", ["message", "message"]],
  },
];

describe("crew operations", () => {
  it.each(journeys)("$sentence", ({ journey, expected }) => {
    expect(journey(new CrewWorld())).toEqual(expected);
  });
});
