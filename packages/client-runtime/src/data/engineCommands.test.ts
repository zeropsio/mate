import type { EngineCallResult } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry } from "effect/unstable/reactivity";

import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import {
  engineDismissUserInput,
  engineRespondToApproval,
  engineRespondToUserInput,
  engineStartTurn,
  viaEngine,
} from "./engineCommands.ts";
import { mateEngineHostAtom, type MateEngineHost } from "./engineHost.ts";
import { makeMateEngineOperations, type EngineCommand } from "./operations/executors/mateEngine.ts";
import { makeAccountStore } from "./store.ts";

const ENV = "env-ada";
const turn = (attachments: ReadonlyArray<unknown> = []) =>
  ({
    threadId: "thread-ada",
    message: { messageId: "message-7", role: "user", text: "And the worker", attachments },
    runtimeMode: "full-access",
    interactionMode: "default",
  }) as unknown as Parameters<typeof engineStartTurn>[1];

function rig(mateEngine: number | undefined) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const calls: EngineCommand[] = [];
  const operations = makeMateEngineOperations({
    store,
    makeId: () => "op-1",
    wire: {
      call: (_environmentId, command) => {
        calls.push(command);
        return Effect.succeed({ _tag: "Accepted", seq: 16, itemId: "x" } as EngineCallResult);
      },
      receipt: () => Effect.succeed({ _tag: "None" }),
    },
  });
  registry.set(mateEngineHostAtom, { store, operations } as unknown as MateEngineHost);
  const v1Calls: string[] = [];
  const v1 = Effect.sync(() => {
    v1Calls.push("dispatchCommand");
    return { sequence: 3 } as never;
  });
  const run = <A, E>(effect: Effect.Effect<A, E, EnvironmentSupervisor>) =>
    Effect.gen(function* () {
      const prepared = yield* SubscriptionRef.make(
        Option.some(mateEngine === undefined ? {} : { mateEngine }),
      );
      return yield* effect.pipe(
        Effect.provideService(EnvironmentSupervisor, { prepared } as never),
      );
    });
  return { registry, calls, v1, v1Calls, run };
}

describe("the thread commands a view sends, by its Mate's wire", () => {
  it.effect(
    "a turn on a Mate on the engine goes as the engine's send, under its message's id",
    () =>
      Effect.gen(function* () {
        const r = rig(1);
        const result = yield* r.run(viaEngine(r.registry, ENV, engineStartTurn(ENV, turn()), r.v1));
        expect(result).toEqual({ sequence: 16 });
        expect(r.calls).toEqual([
          {
            kind: "send",
            conversationId: "thread-ada",
            commandId: "message-7",
            text: "And the worker",
            attachments: [],
          },
        ]);
        expect(r.v1Calls).toEqual([]);
      }),
  );

  it.effect("a command on a V1 Mate goes over V1 unchanged", () =>
    Effect.gen(function* () {
      const r = rig(undefined);
      yield* r.run(viaEngine(r.registry, ENV, engineStartTurn(ENV, turn()), r.v1));
      expect(r.v1Calls).toEqual(["dispatchCommand"]);
      expect(r.calls).toEqual([]);
    }),
  );

  it.effect("a Mate serving only a newer protocol refuses with the update route", () =>
    Effect.gen(function* () {
      const r = rig(2);
      const failure = yield* Effect.flip(
        r.run(viaEngine(r.registry, ENV, engineStartTurn(ENV, turn()), r.v1)),
      );
      expect(failure.message).toMatch(/Update the app/);
      expect(r.calls).toEqual([]);
      expect(r.v1Calls).toEqual([]);
    }),
  );

  it.effect(
    "a picture not yet in the Mate's asset store is refused in words, sending nothing",
    () =>
      Effect.gen(function* () {
        const r = rig(1);
        const failure = yield* Effect.flip(
          r.run(
            viaEngine(
              r.registry,
              ENV,
              engineStartTurn(
                ENV,
                turn([
                  {
                    type: "image",
                    name: "a.png",
                    mimeType: "image/png",
                    sizeBytes: 3,
                    dataUrl: "data:image/png;base64,AAA",
                  },
                ]),
              ),
              r.v1,
            ),
          ),
        );
        expect(failure.message).toMatch(/Pictures/);
        expect(r.calls).toEqual([]);
      }),
  );

  it.effect("an approval's decision goes as the engine's answer, its words as the summary", () =>
    Effect.gen(function* () {
      const r = rig(1);
      yield* r.run(
        viaEngine(
          r.registry,
          ENV,
          engineRespondToApproval(ENV, {
            threadId: "thread-ada",
            requestId: "thread-ada/r/2/q/1",
            decision: "accept",
          } as never),
          r.v1,
        ),
      );
      expect(r.calls[0]).toMatchObject({
        kind: "answer",
        requestId: "thread-ada/r/2/q/1",
        answer: { kind: "approval", decision: "accept" },
        summary: "Approved",
      });
    }),
  );

  it.effect("an answer carrying pictures goes to the engine with them, never without them", () =>
    Effect.gen(function* () {
      const r = rig(1);
      yield* r.run(
        viaEngine(
          r.registry,
          ENV,
          engineRespondToUserInput(ENV, {
            threadId: "thread-ada",
            requestId: "thread-ada/r/2/q/1",
            answers: { target: "Inspect the preview" },
            attachmentsByQuestionId: { target: [{ name: "preview.png" }] },
          } as never),
          r.v1,
        ),
      );
      expect(r.calls[0]).toMatchObject({
        kind: "answer",
        requestId: "thread-ada/r/2/q/1",
        answer: {
          kind: "input",
          answers: { target: "Inspect the preview" },
          attachmentsByQuestionId: { target: [{ name: "preview.png" }] },
        },
      });
      expect(r.v1Calls).toEqual([]);
    }),
  );

  it.effect(
    "dismissing a question on the engine goes as the engine's dismissal, never over V1",
    () =>
      Effect.gen(function* () {
        const r = rig(1);
        yield* r.run(
          viaEngine(
            r.registry,
            ENV,
            engineDismissUserInput(ENV, {
              threadId: "thread-ada",
              requestId: "thread-ada/r/2/q/1",
            } as never),
            r.v1,
          ),
        );
        expect(r.calls).toEqual([
          {
            kind: "dismiss",
            conversationId: "thread-ada",
            commandId: "op-1",
            requestId: "thread-ada/r/2/q/1",
          },
        ]);
        expect(r.v1Calls).toEqual([]);
      }),
  );
});
