import { assert, describe, it } from "@effect/vitest";
import type { CrewRunState, CrewTaskState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { drainMateUpdate, joinUpdateIdleFacts } from "../../mateUpdateDrain.ts";
import { write } from "../testing/crewGitFixture.ts";
import { applied, CREW_WORLDS, firstTurn } from "../testing/crewWorld.ts";
import type { UpdateIdleFacts } from "../../../update/MateUpdateDrain.ts";
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

/**
 * The engine's facts less the two its world's scripted provider cannot give: it keeps no receipt
 * boundary and resumes no session natively. Those are the provider's, not the crew's or the record's.
 */
const ownFacts = (facts: UpdateIdleFacts): UpdateIdleFacts => {
  const blockers = facts.blockers.filter(
    (reason) =>
      !reason.endsWith("provider event receipt boundary unavailable") &&
      !reason.endsWith("native resume is unsupported"),
  );
  return { idle: blockers.length === 0, blockers };
};

describe("an update's drain over the engine crew", () => {
  // The engine world whatever `CREW_WORLD` names: the drain joins the engine's own facts and the
  // engine crew's, as the server's update route does.
  it.live("an update waits for a crewmate at work and goes ahead once the crew is idle", () =>
    CREW_WORLDS.engine!(
      [
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            const crew = yield* world.service;
            const engine = (yield* world.engineUpdateDrain!)!;
            const thread = yield* firstTurn(world, () =>
              write(world.root, ".crew/backend/ok.txt", "ok\n"),
            );
            yield* Effect.scoped(
              Effect.gen(function* () {
                const changed = yield* Queue.unbounded<void>();
                for (const subscribe of [crew.subscribeUpdateChanges!, engine.subscribeChanges!])
                  yield* (yield* subscribe).changes.pipe(
                    Stream.runForEach(() => Queue.offer(changed, undefined)),
                    Effect.forkScoped,
                  );
                const facts = Effect.map(
                  Effect.all([Effect.map(engine.facts, ownFacts), crew.updateFacts!]),
                  (owners) => joinUpdateIdleFacts(...owners),
                );
                const drain = yield* drainMateUpdate(
                  {
                    allowed: Effect.succeed(true),
                    begin: engine.begin,
                    cancel: engine.cancel,
                    facts,
                    quiesce: Effect.map(
                      Effect.all([Effect.map(engine.quiesce, ownFacts), crew.updateFacts!]),
                      (owners) => joinUpdateIdleFacts(...owners),
                    ),
                    changed: Queue.take(changed),
                  },
                  "20 seconds",
                ).pipe(Effect.forkScoped);
                yield* Effect.sleep("500 millis");
                const waiting = yield* facts;
                assert.isUndefined(
                  drain.pollUnsafe(),
                  "the update went ahead under a working crew",
                );
                assert.include(waiting.blockers, "crew turn or continuation");
                yield* world.report(thread, { status: "done", summary: "Wrote ok.txt." });
                yield* world.turnEnds(thread);
                yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "ready");
                const drained = yield* Fiber.join(drain);
                assert.isTrue(drained, `the update never went ahead: ${(yield* facts).blockers}`);
              }),
            );
          }),
      ],
      {},
    ),
  );
});
