import type { EngineCallResult } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry } from "effect/unstable/reactivity";

import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import {
  engineModeChange,
  engineUpdateMetadata,
  engineDismissUserInput,
  engineRespondToApproval,
  engineRespondToUserInput,
  engineStartTurn,
  viaEngine,
} from "./engineCommands.ts";
import { mateEngineHostAtom, mateEngineReaderAtom, type MateEngineHost } from "./engineHost.ts";
import { makeMateEngineOperations, type EngineCommand } from "./operations/executors/mateEngine.ts";
import { makeAccountStore } from "./store.ts";
import { engineConversationId, engineConversationScopes } from "./families/mateEngine.ts";
import { engineHeader } from "./__fixtures__/mateEngine.ts";

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
  /** The conversation the account holds: its agent and model, as the engine's header says. */
  const header = (patch: Parameters<typeof engineHeader>[1] = {}) => {
    const key = { environmentId: ENV, conversationId: "thread-ada" };
    store.dispatch({
      kind: "delivery",
      via: "mate-direct",
      scopes: Object.values(engineConversationScopes(key)).map((scope) => ({
        scope,
        generation: 0,
      })),
      reset: true,
      rows: [
        {
          family: "mateEngineConversation",
          id: engineConversationId(key),
          value: {
            environmentId: ENV,
            header: engineHeader("thread-ada", patch),
            window: { oldestOrdinal: null, earlier: false },
          },
          revision: { kind: "mate-conversation", environmentId: ENV, epoch: 1, seq: 1 },
        },
      ],
      removals: [],
    });
  };
  return { registry, calls, v1, v1Calls, run, header };
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

  it.effect("an answer carrying pictures is refused in words, never sent without them", () =>
    Effect.gen(function* () {
      const r = rig(1);
      const failure = yield* Effect.flip(
        r.run(
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
        ),
      );
      expect(failure.message).toMatch(/pictures/);
      expect(r.calls).toEqual([]);
    }),
  );

  it.effect("dismissing a question on the engine is refused in words, never sent over V1", () =>
    Effect.gen(function* () {
      const r = rig(1);
      const failure = yield* Effect.flip(
        r.run(viaEngine(r.registry, ENV, engineDismissUserInput(), r.v1)),
      );
      expect(failure.message).toMatch(/Answer the question/);
      expect(r.v1Calls).toEqual([]);
    }),
  );

  it.effect("a first message's title is never sent to an engine Mate, nor over V1", () =>
    Effect.gen(function* () {
      const r = rig(1);
      r.header();
      yield* r.run(
        viaEngine(
          r.registry,
          ENV,
          engineUpdateMetadata(ENV, { threadId: "thread-ada", title: "Deploy the api" } as never),
          r.v1,
        ),
      );
      expect(r.calls).toEqual([]);
      expect(r.v1Calls).toEqual([]);
    }),
  );

  it.effect("a model change on the conversation's agent goes as the engine's model switch", () =>
    Effect.gen(function* () {
      const r = rig(1);
      r.header();
      yield* r.run(
        viaEngine(
          r.registry,
          ENV,
          engineUpdateMetadata(ENV, {
            threadId: "thread-ada",
            title: "Deploy",
            modelSelection: { instanceId: "claudeAgent", model: "claude-opus-4-1" },
          } as never),
          r.v1,
        ),
      );
      expect(r.calls).toEqual([
        {
          kind: "switch-model",
          conversationId: "thread-ada",
          commandId: "op-1",
          model: "claude-opus-4-1",
        },
      ]);
      expect(r.v1Calls).toEqual([]);
    }),
  );

  it.effect("the same model again sends nothing", () =>
    Effect.gen(function* () {
      const r = rig(1);
      r.header();
      yield* r.run(
        viaEngine(
          r.registry,
          ENV,
          engineUpdateMetadata(ENV, {
            threadId: "thread-ada",
            modelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-4-5" },
          } as never),
          r.v1,
        ),
      );
      expect(r.calls).toEqual([]);
    }),
  );

  it.effect.each([
    {
      name: "another agent",
      input: { modelSelection: { instanceId: "codex", model: "gpt-5.4" } },
      words: /one agent/,
    },
    {
      name: "a changed effort",
      input: {
        modelSelection: {
          instanceId: "claudeAgent",
          model: "claude-sonnet-4-5",
          options: [{ id: "effort", value: "high" }],
        },
      },
      words: /effort/,
    },
    { name: "a branch", input: { branch: "feature" }, words: /branch/ },
  ])("$name for an engine conversation is refused in words, sending nothing", ({ input, words }) =>
    Effect.gen(function* () {
      const r = rig(1);
      r.header();
      const failure = yield* Effect.flip(
        r.run(
          viaEngine(
            r.registry,
            ENV,
            engineUpdateMetadata(ENV, { threadId: "thread-ada", ...input } as never),
            r.v1,
          ),
        ),
      );
      expect(failure.message).toMatch(words);
      expect(r.calls).toEqual([]);
      expect(r.v1Calls).toEqual([]);
    }),
  );

  it.effect.each(["runtime", "interaction"] as const)(
    "a %s mode change for an engine conversation is refused in words, never sent over V1",
    (mode) =>
      Effect.gen(function* () {
        const r = rig(1);
        const failure = yield* Effect.flip(
          r.run(viaEngine(r.registry, ENV, engineModeChange(mode), r.v1)),
        );
        expect(failure.message).toMatch(/mode/);
        expect(r.v1Calls).toEqual([]);
      }),
  );

  it.effect(
    "a client that reads no engine conversation refuses an engine Mate's command at once, never to retry",
    () =>
      Effect.gen(function* () {
        const r = rig(1);
        r.registry.set(mateEngineHostAtom, null);
        r.registry.set(mateEngineReaderAtom, "none");
        const failure = yield* Effect.flip(
          r.run(viaEngine(r.registry, ENV, engineStartTurn(ENV, turn()), r.v1)),
        );
        expect(failure._tag).toBe("MateEngineUnsupported");
        expect(failure.message).toMatch(/Update the app/);
        expect(r.v1Calls).toEqual([]);
      }),
  );
});
