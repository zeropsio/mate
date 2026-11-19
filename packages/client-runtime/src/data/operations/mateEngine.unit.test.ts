import { expect, it } from "@effect/vitest";
import type { EngineCallResult, RunRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { engineFactId } from "../families/mateEngine.ts";
import type { Row } from "../reducer.ts";
import { makeAccountStore } from "../store.ts";
import { engineRun } from "../__fixtures__/mateEngine.ts";
import {
  makeMateEngineOperations,
  type EngineCallError,
  type EngineCommand,
} from "./executors/mateEngine.ts";

const target = { environmentId: "env-ada", conversationId: "thread-ada" };
const accepted: EngineCallResult = {
  _tag: "Accepted",
  seq: 16,
  runId: "thread-ada/r/2",
  itemId: "thread-ada/r/2/i/1",
} as EngineCallResult;
const lost = new Error("socket closed mid-call") as unknown as EngineCallError;

function rig(answers: ReadonlyArray<Effect.Effect<EngineCallResult, EngineCallError>>) {
  const store = makeAccountStore(AtomRegistry.make());
  const calls: EngineCommand[] = [];
  let ids = 0;
  const operations = makeMateEngineOperations({
    store,
    makeId: () => `op-${++ids}`,
    wire: {
      call: (_environmentId, command) => {
        calls.push(command);
        return answers[calls.length - 1] ?? Effect.succeed(accepted);
      },
      receipt: () => Effect.succeed({ _tag: "None" }),
    },
  });
  return { store, operations, calls, record: () => store.state().operations.get("op-1") };
}

const scope = "mate:engine-x:engine-run" as const;
const deliver = (store: ReturnType<typeof makeAccountStore>, rows: ReadonlyArray<Row>) =>
  store.dispatch({
    kind: "delivery",
    via: "mate-direct",
    scopes: [
      { scope, generation: 0 },
      { scope: "mate:engine-x:engine-item", generation: 0 },
      { scope: "mate:engine-x:engine-request", generation: 0 },
    ],
    reset: false,
    rows,
    removals: [],
  });
const runRow = (run: RunRecord, seq: number): Row => ({
  family: "mateEngineRun",
  id: engineFactId("env-ada", run.id),
  value: { ...run, environmentId: "env-ada" },
  revision: { kind: "mate-conversation", environmentId: "env-ada", epoch: 1, seq },
});

// witness: packages/client-runtime/src/data/operations/executors/mateEngine.ts | attempt(requestId, intent, command, false) → attempt(requestId, intent, { ...command, commandId: options.makeId() }, false)
it.effect(
  "OP50: A message whose answer was lost and that the engine never took goes again once, under the same command id",
  () =>
    Effect.gen(function* () {
      const r = rig([Effect.fail(lost), Effect.succeed(accepted)]);
      yield* r.operations.send({ ...target, text: "Hi" });
      expect(r.calls.map((call) => call.commandId)).toEqual(["op-1", "op-1"]);
      expect(r.record()?.submission).toBe("answered");
    }),
);

// witness: packages/client-runtime/src/data/operations/mateEngine.ts | if (run !== null) return run.state === "ended" ? { kind: "succeeded" } : null; → if (run !== null) return { kind: "succeeded" };
it.effect("OP51: A stop ends when its run's record ends, never at its acceptance", () =>
  Effect.gen(function* () {
    const r = rig([
      Effect.succeed({
        _tag: "Accepted",
        seq: 20,
        runId: "thread-ada/r/2",
      } as EngineCallResult),
    ]);
    const running = engineRun("thread-ada", 2, { state: "running", end: null, endedAt: null });
    deliver(r.store, [runRow(running, 19)]);
    yield* r.operations.stop({ ...target, runId: "thread-ada/r/2" });
    expect(r.record()?.receipt?.outcome.kind).toBe("pending");
    deliver(r.store, [
      runRow(
        {
          ...running,
          state: "ended",
          end: { kind: "stopped", by: { kind: "person", subject: "u" } },
        } as RunRecord,
        21,
      ),
    ]);
    expect(r.record()?.receipt?.outcome.kind).toBe("succeeded");
  }),
);

// witness: packages/client-runtime/src/data/operations/executors/mateEngine.ts | kind: "mate-engine-answer", → ...target, kind: "mate-engine-answer",
it.effect("OP52: An answer's record keeps only its summary, never the words it carries", () =>
  Effect.gen(function* () {
    const r = rig([Effect.succeed(accepted)]);
    yield* r.operations.answer({
      ...target,
      requestId: "thread-ada/r/2/q/1",
      answer: { kind: "input", answers: { token: "s3cret" } },
      summary: "Answered: token",
    });
    expect(r.record()?.intent).toEqual({
      kind: "mate-engine-answer",
      ...target,
      requestId: "thread-ada/r/2/q/1",
      summary: "Answered: token",
    });
    expect(r.calls[0]).toMatchObject({ answer: { kind: "input", answers: { token: "s3cret" } } });
  }),
);
