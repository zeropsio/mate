import {
  EngineWireError,
  EnvironmentAuthorizationError,
  type EngineCallResult,
  type EngineReceiptResult,
  type Item,
  type Request,
  type RunRecord,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { EnvironmentRpcUnavailableError } from "../../../rpc/client.ts";
import { engineFactId } from "../../families/mateEngine.ts";
import type { Row } from "../../reducer.ts";
import { makeAccountStore, readsOfState } from "../../store.ts";
import { engineRequest, engineRun, personItem } from "../../__fixtures__/mateEngine.ts";
import { mateEngineAnswer, mateEngineDismiss, mateEngineSend } from "../mateEngine.ts";
import {
  makeMateEngineOperations,
  type EngineCallError,
  type EngineCommand,
} from "./mateEngine.ts";

const target = { environmentId: "env-ada", conversationId: "thread-ada" };
const accepted: EngineCallResult = {
  _tag: "Accepted",
  seq: 16,
  runId: "thread-ada/r/2",
  itemId: "thread-ada/r/2/i/1",
} as EngineCallResult;
const lost = new Error("socket closed mid-call") as unknown as EngineCallError;

function rig(options: {
  readonly answers: ReadonlyArray<Effect.Effect<EngineCallResult, EngineCallError>>;
  readonly receipts?: ReadonlyArray<Effect.Effect<EngineReceiptResult, EngineCallError>>;
}) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const calls: EngineCommand[] = [];
  const receipts: string[] = [];
  let ids = 0;
  const operations = makeMateEngineOperations({
    store,
    makeId: () => `op-${++ids}`,
    wire: {
      call: (_environmentId, command) => {
        calls.push(command);
        return options.answers[calls.length - 1] ?? Effect.succeed(accepted);
      },
      receipt: (_environmentId, _conversationId, commandId) => {
        receipts.push(commandId);
        return options.receipts?.[receipts.length - 1] ?? Effect.succeed({ _tag: "None" });
      },
    },
  });
  const record = (id = "op-1") => store.state().operations.get(id);
  return { store, operations, calls, receipts, record };
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

describe("what a person does to an engine conversation", () => {
  it.effect("a send is confirmed when the engine accepts it, under its own command id", () =>
    Effect.gen(function* () {
      const r = rig({ answers: [Effect.succeed(accepted)] });
      const result = yield* r.operations.send({ ...target, text: "And the worker" });
      expect(result).toMatchObject({ requestId: "op-1", runId: "thread-ada/r/2" });
      expect(r.calls).toEqual([
        {
          kind: "send",
          conversationId: "thread-ada",
          commandId: "op-1",
          text: "And the worker",
          attachments: [],
        },
      ]);
      expect(r.record()).toMatchObject({
        submission: "answered",
        intent: { kind: "mate-engine-send", text: "And the worker" },
        receipt: { acceptance: { kind: "accepted" }, outcome: { kind: "succeeded" } },
      });
    }),
  );

  it.effect("the engine's refusal is the answer, in words, with its reason", () =>
    Effect.gen(function* () {
      const r = rig({
        answers: [
          Effect.succeed({
            _tag: "Rejected",
            rejection: { reason: "archived" },
          } as EngineCallResult),
        ],
      });
      const failure = yield* Effect.flip(r.operations.send({ ...target, text: "Hi" }));
      expect(failure).toMatchObject({ outcome: "refused", code: "archived" });
      expect(r.record()?.receipt?.acceptance).toEqual({
        kind: "refused",
        reason: "This conversation is archived.",
        code: "archived",
      });
    }),
  );

  it.effect("a Mate serving another protocol refuses with the update route", () =>
    Effect.gen(function* () {
      const r = rig({
        answers: [
          Effect.succeed({
            _tag: "Unserved",
            unserved: {
              type: "unserved",
              reason: "protocol",
              protocols: [2],
              message: "Update Zerops Mate to keep talking to it.",
            },
          } as EngineCallResult),
        ],
      });
      const failure = yield* Effect.flip(r.operations.send({ ...target, text: "Hi" }));
      expect(failure).toMatchObject({ outcome: "refused", code: "update" });
    }),
  );

  it.effect.each([
    {
      name: "a socket that is down",
      error: new EnvironmentRpcUnavailableError({
        environmentId: "env-ada" as never,
        message: "Ada is not connected.",
      }),
    },
    {
      name: "an engine that could not write its record",
      error: new EngineWireError({ message: "busy" }),
    },
  ])("a send that never arrived stays unsent, asking nothing: $name", ({ error }) =>
    Effect.gen(function* () {
      const r = rig({ answers: [Effect.fail(error as EngineCallError)] });
      const failure = yield* Effect.flip(r.operations.send({ ...target, text: "Hi" }));
      expect(failure).toMatchObject({ outcome: "unsent" });
      expect(r.record()?.submission).toBe("unsent");
      expect(r.receipts).toEqual([]);
    }),
  );

  it.effect(
    "a lost answer is asked of the engine by its command id, and its stored receipt settles it",
    () =>
      Effect.gen(function* () {
        const r = rig({
          answers: [Effect.fail(lost)],
          receipts: [Effect.succeed({ _tag: "Found", result: accepted } as EngineReceiptResult)],
        });
        const result = yield* r.operations.send({ ...target, text: "Hi" });
        expect(result.itemId).toBe("thread-ada/r/2/i/1");
        expect(r.receipts).toEqual(["op-1"]);
        expect(r.calls).toHaveLength(1);
        expect(r.record()?.receipt?.outcome.kind).toBe("succeeded");
      }),
  );

  it.effect("a lost answer the engine never took goes again once, under the same command id", () =>
    Effect.gen(function* () {
      const r = rig({
        answers: [Effect.fail(lost), Effect.succeed(accepted)],
        receipts: [Effect.succeed({ _tag: "None" })],
      });
      yield* r.operations.send({ ...target, text: "Hi" });
      expect(r.calls.map((call) => call.commandId)).toEqual(["op-1", "op-1"]);
      expect(r.record()?.submission).toBe("answered");
    }),
  );

  it.effect(
    "a lost answer the engine cannot be asked about stays unresolved, naming the next action",
    () =>
      Effect.gen(function* () {
        const r = rig({ answers: [Effect.fail(lost)], receipts: [Effect.fail(lost)] });
        const failure = yield* Effect.flip(r.operations.send({ ...target, text: "Hi" }));
        expect(failure).toMatchObject({ outcome: "unresolved" });
        expect(r.calls).toHaveLength(1);
        expect(r.record()).toMatchObject({
          submission: "uncertain-unasked",
          unresolved: {
            nextActor: "you",
            nextAction: "Read the conversation before trying again.",
          },
        });
      }),
  );

  it.effect("a stop ends when its run's record ends, never at its acceptance", () =>
    Effect.gen(function* () {
      const r = rig({
        answers: [
          Effect.succeed({
            _tag: "Accepted",
            seq: 20,
            runId: "thread-ada/r/2",
          } as EngineCallResult),
        ],
      });
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

  it.effect("an answer keeps only its summary, never the words it carries", () =>
    Effect.gen(function* () {
      const r = rig({ answers: [Effect.succeed(accepted)] });
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
});

describe("a call the Mate refuses for want of authority", () => {
  it.effect("is refused in its words, never asked about or sent again", () =>
    Effect.gen(function* () {
      const refused = new EnvironmentAuthorizationError({
        message: "Your answer was refused. Sign in and retry.",
        requiredScope: "orchestration:operate",
      }) as unknown as EngineCallError;
      const r = rig({ answers: [Effect.fail(refused)] });
      const failure = yield* Effect.flip(
        r.operations.answer({
          ...target,
          requestId: "thread-ada/r/2/q/1",
          answer: { kind: "input", answers: { target: "stage" } },
          summary: "Answered",
        }),
      );
      expect(failure).toMatchObject({
        outcome: "refused",
        message: "Your answer was refused. Sign in and retry.",
      });
      expect(r.calls).toHaveLength(1);
      expect(r.receipts).toEqual([]);
      expect(r.record()?.receipt).toMatchObject({ acceptance: { kind: "refused" } });
    }),
  );
});

describe("a question's answer and its dismissal", () => {
  it.effect("an answer's pictures go with its words, and its record keeps neither", () =>
    Effect.gen(function* () {
      const r = rig({ answers: [Effect.succeed(accepted)] });
      const answer = {
        kind: "input" as const,
        answers: { target: "Inspect the preview" },
        attachmentsByQuestionId: {
          target: [
            {
              type: "image" as const,
              id: "img-1",
              name: "preview.png",
              mimeType: "image/png",
              sizeBytes: 2048,
            },
          ],
        },
      };
      yield* r.operations.answer({
        ...target,
        requestId: "thread-ada/r/2/q/1",
        answer: answer as never,
        summary: "Answered",
      });
      expect(r.calls[0]).toMatchObject({ kind: "answer", answer });
      expect(r.record()?.intent).toEqual({
        kind: "mate-engine-answer",
        ...target,
        requestId: "thread-ada/r/2/q/1",
        summary: "Answered",
      });
    }),
  );

  it.effect("a dismissal goes under its own command id, naming the request it closes", () =>
    Effect.gen(function* () {
      const r = rig({ answers: [Effect.succeed(accepted)] });
      const result = yield* r.operations.dismiss({ ...target, requestId: "thread-ada/r/2/q/1" });
      expect(result).toMatchObject({ requestId: "op-1" });
      expect(r.calls).toEqual([
        {
          kind: "dismiss",
          conversationId: "thread-ada",
          commandId: "op-1",
          requestId: "thread-ada/r/2/q/1",
        },
      ]);
      expect(r.record()).toMatchObject({
        intent: { kind: "mate-engine-dismiss", requestId: "thread-ada/r/2/q/1" },
        receipt: { acceptance: { kind: "accepted" }, outcome: { kind: "succeeded" } },
      });
    }),
  );

  it.effect("a dismissal the engine refuses is the answer, in words", () =>
    Effect.gen(function* () {
      const r = rig({
        answers: [
          Effect.succeed({
            _tag: "Rejected",
            rejection: { reason: "not-dismissible" },
          } as EngineCallResult),
        ],
      });
      const failure = yield* Effect.flip(
        r.operations.dismiss({ ...target, requestId: "thread-ada/r/2/q/1" }),
      );
      expect(failure).toMatchObject({ outcome: "refused", code: "not-dismissible" });
      expect(failure.message).toMatch(/needs an answer/);
    }),
  );
});

describe("when an engine operation shows in the conversation", () => {
  const receipt = {
    requestId: "op-1",
    operationId: "op-1",
    executor: "mate" as const,
    affected: [],
    handles: [],
    acceptance: { kind: "accepted" as const, result: { seq: 16, itemId: "thread-ada/r/2/i/1" } },
    outcome: { kind: "pending" as const },
  };

  it("a send shows once the item the engine made for it is held", () => {
    const r = rig({ answers: [] });
    const intent = { kind: "mate-engine-send" as const, ...target, text: "Hi", pictures: 0 };
    expect(mateEngineSend.reflected(readsOfState(r.store.state()), intent, receipt)).toBe(false);
    const item: Item = personItem("thread-ada/r/2", 1, "Hi", { sendId: "op-1" as never });
    deliver(r.store, [
      {
        family: "mateEngineItem",
        id: engineFactId("env-ada", item.id),
        value: { ...item, environmentId: "env-ada" },
        revision: { kind: "mate-conversation", environmentId: "env-ada", epoch: 1, seq: 16 },
      },
    ]);
    expect(mateEngineSend.reflected(readsOfState(r.store.state()), intent, receipt)).toBe(true);
  });

  it("an answer shows once its request is no longer open", () => {
    const r = rig({ answers: [] });
    const intent = {
      kind: "mate-engine-answer" as const,
      ...target,
      requestId: "thread-ada/r/2/q/1",
      summary: "Yes",
    };
    const request = (state: Request["state"], seq: number): Row => {
      const value = engineRequest(
        "thread-ada/r/2",
        1,
        { kind: "approval", requestKind: "command", detail: "ls" },
        { state },
      );
      return {
        family: "mateEngineRequest",
        id: engineFactId("env-ada", value.id),
        value: { ...value, environmentId: "env-ada" },
        revision: { kind: "mate-conversation", environmentId: "env-ada", epoch: 1, seq },
      };
    };
    deliver(r.store, [request("open", 3)]);
    expect(mateEngineAnswer.reflected(readsOfState(r.store.state()), intent, receipt)).toBe(false);
    deliver(r.store, [request("answered", 4)]);
    expect(mateEngineAnswer.reflected(readsOfState(r.store.state()), intent, receipt)).toBe(true);
  });

  it("a dismissal shows once its request is no longer open", () => {
    const r = rig({ answers: [] });
    const intent = {
      kind: "mate-engine-dismiss" as const,
      ...target,
      requestId: "thread-ada/r/2/q/1",
    };
    const request = (state: Request["state"], seq: number): Row => {
      const value = engineRequest(
        "thread-ada/r/2",
        1,
        { kind: "question", questions: [], dismissible: true },
        { state },
      );
      return {
        family: "mateEngineRequest",
        id: engineFactId("env-ada", value.id),
        value: { ...value, environmentId: "env-ada" },
        revision: { kind: "mate-conversation", environmentId: "env-ada", epoch: 1, seq },
      };
    };
    deliver(r.store, [request("open", 3)]);
    expect(mateEngineDismiss.reflected(readsOfState(r.store.state()), intent, receipt)).toBe(false);
    deliver(r.store, [request("dismissed", 4)]);
    expect(mateEngineDismiss.reflected(readsOfState(r.store.state()), intent, receipt)).toBe(true);
  });
});
