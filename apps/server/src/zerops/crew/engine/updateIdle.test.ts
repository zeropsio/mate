import { assert, describe, it } from "@effect/vitest";
import type { CrewRunState, CrewTaskState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import { write } from "../testing/crewGitFixture.ts";
import { applied, CREW_WORLDS, firstTurn } from "../testing/crewWorld.ts";
import { crewEngineUpdateFacts } from "./updateIdle.ts";

type Row = readonly [
  sentence: string,
  input: {
    readonly effects?: number;
    readonly running?: boolean;
    readonly carryOn?: boolean;
    readonly run?: CrewRunState;
    readonly task?: CrewTaskState;
    readonly operation?: "running" | "failed";
  },
  blockers: ReadonlyArray<string>,
];

const member = (running: boolean, carryOn: boolean) => ({
  active: running ? {} : null,
  carryOn: carryOn ? { why: "a restart", as: null } : null,
});

describe("the engine crew's update facts", () => {
  it.each<Row>([
    ["a crew with nothing to do lets an update go", {}, []],
    [
      "a finished run with its tasks landed lets an update go",
      { run: "finished", task: "landed" },
      [],
    ],
    ["a crewmate mid-turn holds an update", { running: true }, ["crew turn or continuation"]],
    [
      "a task the crew carries on once it can holds an update",
      { carryOn: true },
      ["crew turn or continuation"],
    ],
    ["a crew effect in flight holds an update", { effects: 2 }, ["crew process or callback"]],
    ["a running crew run holds an update", { run: "running" }, ["active crew run"]],
    ["a task at work holds an update", { task: "checking" }, ["accepted crew task"]],
    ["a question to the person holds an update", { task: "waiting-on-you" }, ["open crew request"]],
    ["a running operation holds an update", { operation: "running" }, ["crew operation running"]],
    ["a failed operation waits on the person, not the update", { operation: "failed" }, []],
  ])("%s", (_, input, blockers) => {
    const facts = crewEngineUpdateFacts(
      {
        effects: Object.fromEntries(
          Array.from({ length: input.effects ?? 0 }, (_, i) => [`e${i}`, {}]),
        ),
        members: { backend: member(input.running ?? false, input.carryOn ?? false) },
      },
      {
        run: input.run === undefined ? null : { state: input.run },
        board: { tasks: input.task === undefined ? [] : [{ state: input.task }] },
        operations: input.operation === undefined ? [] : [{ status: input.operation }],
      },
    );
    assert.deepStrictEqual(facts, { idle: blockers.length === 0, blockers });
  });
});

describe("an update's drain over the engine crew", () => {
  // The engine world whatever `CREW_WORLD` names: the facts are the engine crew's own.
  it.live("an update waits for a crewmate at work and goes ahead once the crew is idle", () =>
    CREW_WORLDS.engine!(
      [
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            const crew = yield* world.service;
            const facts = crew.updateFacts!;
            assert.isTrue((yield* facts).idle, "a crew with nothing to do");
            const thread = yield* firstTurn(world, () =>
              write(world.root, ".crew/backend/ok.txt", "ok\n"),
            );
            const working = yield* facts;
            assert.isFalse(working.idle);
            assert.include(working.blockers, "crew turn or continuation");
            yield* Effect.scoped(
              Effect.gen(function* () {
                const { changes } = yield* crew.subscribeUpdateChanges!;
                // The drain hears the crew settle, and reads it idle then.
                const idle = yield* changes.pipe(
                  Stream.mapEffect(() => facts),
                  Stream.filter((read) => read.idle),
                  Stream.runHead,
                  Effect.forkScoped,
                );
                yield* world.report(thread, { status: "done", summary: "Wrote ok.txt." });
                yield* world.turnEnds(thread);
                yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "ready");
                const heard = yield* Fiber.join(idle).pipe(Effect.timeout("5 seconds"));
                assert.deepStrictEqual(heard._tag === "Some" ? heard.value : heard, {
                  idle: true,
                  blockers: [],
                });
              }),
            );
          }),
      ],
      {},
    ),
  );
});
