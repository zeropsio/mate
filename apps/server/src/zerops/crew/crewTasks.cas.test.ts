import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import type { CrewCore } from "./crewCore.ts";
import type { CrewAssignmentRow } from "./CrewStore.ts";
import { stepTask } from "./crewTasks.ts";

const row = (overrides: Partial<CrewAssignmentRow> = {}): CrewAssignmentRow => ({
  assignment: "task-1",
  run: null,
  crew: "main",
  member: "backend",
  number: 1,
  title: "First",
  source: "you",
  createdBy: "user-a",
  card: null,
  pending: null,
  dependsOn: [],
  fresh: false,
  state: "review",
  attempt: 1,
  reworks: 0,
  remerges: 0,
  mergedHead: null,
  check: null,
  review: null,
  report: null,
  waiting: null,
  landedCommit: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  ...overrides,
});

/** Only what a task's step reads and writes: its store and its clock. */
const coreOver = (stored: Map<string, CrewAssignmentRow>) =>
  ({
    store: {
      getAssignment: (id: string) => Effect.succeed(Option.fromNullishOr(stored.get(id))),
      putAssignment: (next: CrewAssignmentRow) =>
        Effect.sync(() => void stored.set(next.assignment, next)),
    },
    stepping: Semaphore.makeUnsafe(1),
    now: Effect.succeed("2026-10-01T10:05:00.000Z"),
  }) as unknown as CrewCore;

describe("stepTask writes only over the state it read", () => {
  it.effect("a lead's reject read in review never writes rework over a landing since", () =>
    Effect.gen(function* () {
      const stored = new Map([["task-1", row({ state: "landed" })]]);
      const refused = yield* Effect.flip(
        stepTask(coreOver(stored), row({ state: "review" }), { type: "review-rejected" }),
      );
      assert.deepStrictEqual(
        [refused.reason, stored.get("task-1")?.state],
        ["wrong-state", "landed"],
      );
    }),
  );

  it.effect("a step on the state as stored is written", () =>
    Effect.gen(function* () {
      const stored = new Map([["task-1", row({ state: "review" })]]);
      yield* stepTask(coreOver(stored), row({ state: "review" }), { type: "review-rejected" });
      assert.strictEqual(stored.get("task-1")?.state, "rework");
    }),
  );
});
