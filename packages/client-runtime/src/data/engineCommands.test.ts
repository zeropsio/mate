import type { EngineCallResult } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry } from "effect/reactivity";

import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import {
  engineModeChange,
  engineUpdateMetadata,
  engineDismissUserInput,
  engineInterruptTurn,
  engineRespondToApproval,
  engineRespondToUserInput,
  engineStartTurn,
  viaEngine,
} from "./engineCommands.ts";
import { mateEngineHostAtom, mateEngineReaderAtom, type MateEngineHost } from "./engineHost.ts";
import { makeMateEngineOperations, type EngineCommand } from "./operations/executors/mateEngine.ts";
import { makeAccountStore } from "./store.ts";
import {
  engineConversationId,
  engineConversationScopes,
  engineFactId,
} from "./families/mateEngine.ts";
import { engineHeader, engineRun } from "./__fixtures__/mateEngine.ts";

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
  /** The conversation the account holds, with these runs (and its header so patched). */
  const runs = (
    held: ReadonlyArray<ReturnType<typeof engineRun>>,
    headerPatch: Parameters<typeof engineHeader>[1] = {},
  ) => {
    const key = { environmentId: ENV, conversationId: "thread-ada" };
    header(headerPatch);
    store.dispatch({
      kind: "delivery",
      via: "mate-direct",
      scopes: Object.values(engineConversationScopes(key)).map((scope) => ({
        scope,
        generation: 0,
      })),
      reset: false,
      rows: held.map((run) => ({
        family: "mateEngineRun" as const,
        id: engineFactId(ENV, run.id),
        value: { ...run, environmentId: ENV },
        revision: {
          kind: "mate-conversation" as const,
          environmentId: ENV,
          epoch: 1,
          seq: run.rev,
        },
      })),
      removals: [],
    });
  };
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
  return { registry, calls, v1, v1Calls, run, header, runs };
}

describe("the thread commands a view sends, by its Mate's wire", () => {
  // Catches a Stop sent to the card a continuing run draws on: the engine refuses an ended run, and
  // the run that works goes on (a usage-limit resume, an agent's own turn, a restart's continuation).
  const SESSION = (steer: boolean) => ({
    session: { driver: "claudeAgent", model: "claude-sonnet-4-5", steer },
  });
  const working = (state: "running" | "waiting" | "admitted") =>
    engineRun("thread-ada", 2, { state, end: null, endedAt: null } as never);

  it.effect.each(["running", "waiting"] as const)(
    "a message sent while the conversation's run is %s steers that run, as V1's mid-turn send does",
    (state) =>
      Effect.gen(function* () {
        const r = rig(1);
        r.runs([engineRun("thread-ada", 1), working(state)], SESSION(true));
        yield* r.run(viaEngine(r.registry, ENV, engineStartTurn(ENV, turn()), r.v1));
        expect(r.calls).toEqual([
          {
            kind: "steer",
            conversationId: "thread-ada",
            commandId: "message-7",
            runId: "thread-ada/r/2",
            text: "And the worker",
          },
        ]);
        expect(r.v1Calls).toEqual([]);
      }),
  );

  it.effect.each([
    { name: "no run works", runs: [engineRun("thread-ada", 1)], steer: true, pictures: false },
    {
      name: "the run is not started yet",
      runs: [working("admitted")],
      steer: true,
      pictures: false,
    },
    { name: "its session cannot steer", runs: [working("running")], steer: false, pictures: false },
    { name: "it carries pictures", runs: [working("running")], steer: true, pictures: true },
  ])("a message sent when $name goes as the conversation's next run", ({ runs, steer, pictures }) =>
    Effect.gen(function* () {
      const r = rig(1);
      r.runs(runs, SESSION(steer));
      const picture = {
        type: "image",
        id: "img-1",
        name: "a.png",
        mimeType: "image/png",
        sizeBytes: 3,
      };
      yield* r.run(
        viaEngine(r.registry, ENV, engineStartTurn(ENV, turn(pictures ? [picture] : [])), r.v1),
      );
      expect(r.calls.map((call) => call.kind)).toEqual(["send"]);
    }),
  );

  it.effect("a Stop on a run that continues another stops the run that works, not its card", () =>
    Effect.gen(function* () {
      const r = rig(1);
      r.runs([
        engineRun("thread-ada", 1),
        engineRun("thread-ada", 2, {
          joins: "thread-ada/r/1" as never,
          trigger: { kind: "wake", cause: "self", wakeId: null } as never,
          state: "running",
          end: null,
          endedAt: null,
        }),
      ]);
      yield* Effect.forkChild(
        r.run(
          viaEngine(
            r.registry,
            ENV,
            engineInterruptTurn(ENV, {
              type: "thread.turn.interrupt",
              commandId: "stop-1",
              threadId: "thread-ada",
              turnId: "thread-ada/r/1",
              createdAt: "2026-10-08T00:00:00.000Z",
            } as never),
            r.v1,
          ),
        ),
      );
      yield* Effect.yieldNow;
      expect(r.calls).toMatchObject([{ kind: "stop", runId: "thread-ada/r/2" }]);
    }),
  );

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

  it.effect.each([
    {
      reader: "engine",
      words:
        "This Mate speaks a newer conversation protocol. Reload or update this app to keep talking to it.",
    },
    {
      reader: "none",
      words:
        "This Mate speaks a newer conversation protocol. Update the app to keep talking to it.",
    },
  ] as const)(
    "a Mate serving only a newer protocol refuses with its app's way out: a reload or update on the web and desktop, an update on the phone (reader $reader)",
    ({ reader, words }) =>
      Effect.gen(function* () {
        const r = rig(2);
        r.registry.set(mateEngineReaderAtom, reader);
        const failure = yield* Effect.flip(
          r.run(viaEngine(r.registry, ENV, engineStartTurn(ENV, turn()), r.v1)),
        );
        expect(failure.message).toBe(words);
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

  /** Claude's options as its model reports them: an effort, a context window, Fast Mode. */
  const CLAUDE = {
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium", isDefault: true },
          { id: "high", label: "High" },
          { id: "xhigh", label: "Extra High" },
        ],
      },
      { id: "fastMode", label: "Fast Mode", type: "boolean" },
      {
        id: "contextWindow",
        label: "Context Window",
        type: "select",
        options: [
          { id: "200k", label: "200k" },
          { id: "1m", label: "1M", isDefault: true },
        ],
      },
    ],
  } as const;
  const DEFAULTS = [
    { id: "effort", value: "medium" },
    { id: "fastMode", value: false },
    { id: "contextWindow", value: "1m" },
  ];

  it.effect.each([
    { name: "the composer's spelled-out defaults", runs: undefined, picked: DEFAULTS },
    {
      name: "the same options in another order",
      runs: [
        { id: "contextWindow", value: "200k" },
        { id: "effort", value: "xhigh" },
      ],
      picked: [
        { id: "effort", value: "xhigh" },
        { id: "fastMode", value: false },
        { id: "contextWindow", value: "200k" },
      ],
    },
    { name: "no options against the defaults it runs on", runs: DEFAULTS, picked: undefined },
  ])("$name on the conversation's model change nothing and send nothing", ({ runs, picked }) =>
    Effect.gen(function* () {
      const r = rig(1);
      r.header({
        agent: {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          model: "claude-sonnet-4-5",
          ...(runs === undefined ? {} : { options: runs }),
          profile: { kind: "mate" },
        },
      } as never);
      yield* r.run(
        viaEngine(
          r.registry,
          ENV,
          engineUpdateMetadata(
            ENV,
            {
              threadId: "thread-ada",
              modelSelection: {
                instanceId: "claudeAgent",
                model: "claude-sonnet-4-5",
                ...(picked === undefined ? {} : { options: picked }),
              },
            } as never,
            () => CLAUDE as never,
          ),
          r.v1,
        ),
      );
      expect(r.calls).toEqual([]);
      expect(r.v1Calls).toEqual([]);
    }),
  );

  it.effect.each([
    { name: "an effort", option: { id: "effort", value: "xhigh" }, words: /effort/, not: null },
    {
      name: "Fast Mode",
      option: { id: "fastMode", value: true },
      words: /Fast Mode/,
      not: /effort/,
    },
    {
      name: "a context window",
      option: { id: "contextWindow", value: "200k" },
      words: /Context Window/,
      not: /effort/,
    },
  ])("a change to $name is refused in words naming what changed", ({ option, words, not }) =>
    Effect.gen(function* () {
      const r = rig(1);
      r.header();
      const failure = yield* Effect.flip(
        r.run(
          viaEngine(
            r.registry,
            ENV,
            engineUpdateMetadata(
              ENV,
              {
                threadId: "thread-ada",
                modelSelection: {
                  instanceId: "claudeAgent",
                  model: "claude-sonnet-4-5",
                  options: DEFAULTS.map((each) => (each.id === option.id ? option : each)),
                },
              } as never,
              () => CLAUDE as never,
            ),
            r.v1,
          ),
        ),
      );
      expect(failure.message).toMatch(words);
      if (not !== null) expect(failure.message).not.toMatch(not);
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
