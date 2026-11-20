import { ProjectId, ProviderInstanceId, RunId, type EngineCallResult } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AtomRegistry } from "effect/reactivity";

import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import {
  engineInterruptTurn,
  engineRespondToUserInput,
  engineSetInteractionMode,
  engineStartTurn,
  engineUpdateMetadata,
  viaEngine,
} from "./engineCommands.ts";
import { mateEngineHostAtom, type MateEngineHost } from "./engineHost.ts";
import { makeMateEngineOperations, type EngineCommand } from "./operations/executors/mateEngine.ts";
import { makeAccountStore } from "./store.ts";
import {
  engineConversationId,
  engineConversationScopes,
  engineFactId,
} from "./families/mateEngine.ts";
import { engineHeader, engineRun } from "./__fixtures__/mateEngine.ts";
import { vaultChangesSince, vaultNote } from "./projections/vaultChanges.ts";
import type { VaultView } from "./projections/vaultModel.ts";

const ENV = "env-ada";
const turn = (attachments: ReadonlyArray<unknown> = []) =>
  ({
    threadId: "thread-ada",
    message: { messageId: "message-7", role: "user", text: "And the worker", attachments },
    runtimeMode: "full-access",
    interactionMode: "default",
  }) as unknown as Parameters<typeof engineStartTurn>[1];

const ACCEPTED = { _tag: "Accepted", seq: 16, itemId: "x" } as EngineCallResult;

function rig(
  mateEngine: number | undefined,
  /** How the Mate's engine answers each command: accepted unless said otherwise. */
  answer: (command: EngineCommand) => EngineCallResult = () => ACCEPTED,
) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const calls: EngineCommand[] = [];
  const operations = makeMateEngineOperations({
    store,
    makeId: () => "op-1",
    wire: {
      call: (_environmentId, command) => {
        calls.push(command);
        return Effect.succeed(answer(command));
      },
      receipt: () => Effect.succeed({ _tag: "None" }),
    },
  });
  registry.set(mateEngineHostAtom, { store, operations } as unknown as MateEngineHost);
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const prepared = yield* SubscriptionRef.make(
        Option.some(mateEngine === undefined ? {} : { mateEngine }),
      );
      return yield* effect.pipe(
        Effect.provideService(EnvironmentSupervisor, {
          target: { environmentId: ENV },
          prepared,
        } as never),
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
  return { registry, store, calls, run, header, runs };
}

const SESSION = (steer: boolean, active = true, steerAttachments?: boolean) => ({
  activeRunId: active ? RunId.make("thread-ada/r/2") : null,
  latestRunId: RunId.make(active ? "thread-ada/r/2" : "thread-ada/r/1"),
  runStatus: active ? ("running" as const) : ("ready" as const),
  session: {
    driver: "claudeAgent",
    model: "claude-sonnet-4-5",
    steer,
    ...(steerAttachments === undefined ? {} : { steerAttachments }),
  },
});
const working = (state: "running" | "waiting" | "admitted") =>
  engineRun("thread-ada", 2, { state, end: null, endedAt: null } as never);

const picture = {
  type: "image",
  id: "img-1",
  name: "a.png",
  mimeType: "image/png",
  sizeBytes: 3,
} as const;
const file = {
  type: "file",
  id: "file-1",
  name: "spec.pdf",
  mimeType: "application/pdf",
  sizeBytes: 9,
} as const;

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

// witness: packages/client-runtime/src/data/engineCommands.ts | })(host); → })(host).pipe(Effect.ignore);
it.effect(
  "ST60: A fresh conversation whose agent or runtime mode the Mate refuses never admits its first run",
  () =>
    Effect.gen(function* () {
      for (const refused of ["assign-agent", "set-runtime-mode"] as const) {
        const r = rig(1, (command) =>
          command.kind === refused
            ? {
                _tag: "Rejected",
                rejection: { reason: "unknown", detail: "The agent cannot start." },
              }
            : ACCEPTED,
        );
        yield* Effect.addFinalizer(() => Effect.sync(() => r.registry.dispose()));
        const result = yield* Effect.exit(
          r.run(
            viaEngine(
              r.registry,
              ENV,
              engineStartTurn(ENV, {
                ...turn(),
                bootstrap: {
                  createThread: {
                    projectId: ProjectId.make("project-ada"),
                    title: "First ask",
                    createdAt: "2026-10-09T00:00:00.000Z",
                    modelSelection: {
                      instanceId: ProviderInstanceId.make("claude"),
                      model: "sonnet",
                    },
                    runtimeMode: "full-access",
                    interactionMode: "default",
                    branch: null,
                    worktreePath: null,
                  },
                },
              }),
            ),
          ),
        );
        expect(r.calls.map(({ kind }) => kind)).toEqual(
          refused === "assign-agent" ? ["assign-agent"] : ["assign-agent", "set-runtime-mode"],
        );
        expect(result._tag).toBe("Failure");
      }
    }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | runId: steered, → runId: input.threadId,
it.effect("ST61: A message sent while the conversation's run is running steers that run", () =>
  Effect.gen(function* () {
    for (const state of ["running", "waiting"] as const) {
      const r = rig(1);
      r.runs([engineRun("thread-ada", 1), working(state)], SESSION(true));
      yield* r.run(viaEngine(r.registry, ENV, engineStartTurn(ENV, turn())));
      expect(r.calls).toEqual([
        {
          kind: "steer",
          conversationId: "thread-ada",
          commandId: "message-7",
          runId: "thread-ada/r/2",
          text: "And the worker",
        },
      ]);
    }
  }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | engineSteerTarget(readsOfState(host.store.state()), target, attachments.length > 0) → ((row) => row.kind === "known" ? row.value.header.activeRunId : null)(readsOfState(host.store.state()).fact("mateEngineConversation", engineConversationId(target)))
it.effect(
  "ST62: A message sent when no run works, or the run has not started yet, goes as the conversation's next run",
  () =>
    Effect.gen(function* () {
      for (const { runs, steer, active, carries } of [
        {
          runs: [engineRun("thread-ada", 1)],
          steer: false,
          active: false,
          carries: [],
        },
        // The header carries current eligibility, not merely the session's capability.
        { runs: [working("admitted")], steer: false, carries: [] },
        { runs: [working("running")], steer: false, carries: [] },
        // An engine from before steers carried them: the picture never drops from a words-only steer.
        {
          runs: [working("running")],
          steer: true,
          carries: [picture],
        },
        {
          runs: [working("running")],
          steer: true,
          carries: [file],
        },
      ]) {
        const r = rig(1);
        r.runs(runs, SESSION(steer, active));
        yield* r.run(viaEngine(r.registry, ENV, engineStartTurn(ENV, turn(carries))));
        expect(r.calls.map((call) => call.kind)).toEqual(["send"]);
      }
    }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | send(engineResendId(input.message.messageId)) → send(input.message.messageId)
it.effect(
  "ST63: A message whose steer the engine refuses because the run ended, or its session can no longer steer, goes as the conversation's next run under its own id",
  () =>
    Effect.gen(function* () {
      for (const reason of ["run-not-running", "steer-unsupported"] as const) {
        const r = rig(1, (command) =>
          command.kind === "steer" ? { _tag: "Rejected", rejection: { reason } } : ACCEPTED,
        );
        r.runs([engineRun("thread-ada", 1), working("running")], SESSION(true));
        const result = yield* r.run(viaEngine(r.registry, ENV, engineStartTurn(ENV, turn())));
        expect(result).toEqual({ sequence: 16 });
        expect(r.calls).toMatchObject([
          { kind: "steer", commandId: "message-7" },
          { kind: "send", text: "And the worker", attachments: [] },
        ]);
        // The engine keeps the steer's refusal under the message's id: the send goes under its own.
        expect(r.calls[1]?.commandId).toBe("message-7#next");
      }
    }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | input.interactionMode !== "plan" → input.interactionMode !== undefined
it.effect("ST64: A plan sent while the run works goes as the next run, in plan mode", () =>
  Effect.gen(function* () {
    const r = rig(1);
    r.runs([engineRun("thread-ada", 1), working("running")], SESSION(true));
    yield* r.run(
      viaEngine(
        r.registry,
        ENV,
        engineStartTurn(ENV, { ...turn(), interactionMode: "plan" } as never),
      ),
    );
    expect(r.calls).toMatchObject([
      { kind: "send", commandId: "message-7", interactionMode: "plan" },
    ]);
  }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | .slice(0, ENGINE_SEND_CONTEXT_LIMITS.lines) → .slice(1, ENGINE_SEND_CONTEXT_LIMITS.lines)
it.effect(
  "ST65: A vault value never travels with a message: the agent hears only its key's name",
  () =>
    Effect.gen(function* () {
      const VALUE = ["synthetic", "billing", "secret"].join("-");
      const view = {
        status: "ready",
        complete: true,
        notLive: [],
        scopes: [
          {
            ref: { kind: "shared" },
            id: "shared",
            hostname: null,
            kind: "shared",
            serviceType: null,
            editable: true,
            reads: [],
            startedAt: null,
            values: [
              {
                id: "e-billing",
                key: "BILLING_KEY",
                value: VALUE,
                sensitive: false,
                createdAt: "2026-10-07T11:00:00Z",
                changedAt: "2026-10-07T11:00:00Z",
                madeByZerops: false,
                readers: [],
              },
            ],
          },
        ],
      } as unknown as VaultView;
      const note = vaultNote(vaultChangesSince(view, "2026-10-07T10:00:00Z", []));
      const r = rig(1);
      yield* r.run(
        viaEngine(
          r.registry,
          ENV,
          engineStartTurn(ENV, { ...turn(), agentNotes: [note!] } as never),
        ),
      );
      const sent = JSON.stringify(r.calls);
      expect(r.calls).toMatchObject([
        { kind: "send", context: [expect.stringContaining("BILLING_KEY")] },
      ]);
      expect(sent).not.toContain(VALUE);
    }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | runId: engineStopTarget( → runId: input.turnId ?? engineStopTarget(
it.effect(
  "ST66: A Stop on a run that continues another stops the run that works, not the one it continues",
  () =>
    Effect.gen(function* () {
      const r = rig(1);
      r.runs(
        [
          engineRun("thread-ada", 1),
          engineRun("thread-ada", 2, {
            joins: "thread-ada/r/1" as never,
            trigger: { kind: "wake", cause: "self", wakeId: null } as never,
            state: "running",
            end: null,
            endedAt: null,
          }),
        ],
        SESSION(true),
      );
      yield* r.run(
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
        ),
      );
      expect(r.calls).toMatchObject([{ kind: "stop", runId: "thread-ada/r/2" }]);
    }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | if (attachments.length !== input.message.attachments.length) → if (attachments.length > 0 && attachments.length !== input.message.attachments.length)
it.effect("ST67: A picture not yet in the Mate's asset store is refused, and nothing is sent", () =>
  Effect.gen(function* () {
    const r = rig(1);
    const result = yield* Effect.result(
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
        ),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "OrchestrationDispatchCommandError" },
    });
    expect(r.calls).toEqual([]);
  }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | attachmentsByQuestionId: input.attachmentsByQuestionId → attachmentsByQuestionId: { [input.requestId]: Object.values(input.attachmentsByQuestionId).flat() }
it.effect(
  "ST68: An answer carrying pictures goes to the engine with them, never without them",
  () =>
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
        ),
      );
      expect(r.calls).toMatchObject([
        {
          kind: "answer",
          requestId: "thread-ada/r/2/q/1",
          answer: {
            kind: "input",
            answers: { target: "Inspect the preview" },
            attachmentsByQuestionId: { target: [{ name: "preview.png" }] },
          },
        },
      ]);
    }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | if (selection === undefined) return Effect.succeed({ seq: 0 }); → if (selection === undefined) return input.title ? host.operations.send({ environmentId, conversationId: input.threadId, text: input.title }) : Effect.succeed({ seq: 0 });
it.effect("ST69: A first message's title is never sent to an engine Mate", () =>
  Effect.gen(function* () {
    const r = rig(1);
    r.header();
    yield* r.run(
      viaEngine(
        r.registry,
        ENV,
        engineUpdateMetadata(ENV, { threadId: "thread-ada", title: "Deploy the api" } as never),
      ),
    );
    expect(r.calls).toEqual([]);
  }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | && changed.length === 0) → && selection.options === undefined && changed.length === 0)
it.effect(
  "ST70: A model change that changes nothing sends nothing: the spelled-out defaults, the same options in another order, no options against the defaults it runs on",
  () =>
    Effect.gen(function* () {
      for (const { runs, picked } of [
        { runs: undefined, picked: DEFAULTS },
        {
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
        { runs: DEFAULTS, picked: undefined },
      ]) {
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
          ),
        );
        expect(r.calls).toEqual([]);
      }
    }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | options: withChanges(capabilities, agent.options, selection.options, changed) → options: selection.options ?? []
it.effect(
  "ST71: A change to an effort, Fast Mode or a context window goes as the engine's model switch carrying only what changed",
  () =>
    Effect.gen(function* () {
      for (const option of [
        { id: "effort", value: "xhigh" },
        { id: "fastMode", value: true },
        { id: "contextWindow", value: "200k" },
      ]) {
        const r = rig(1);
        r.header();
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
                  options: DEFAULTS.map((each) => (each.id === option.id ? option : each)),
                },
              } as never,
              () => CLAUDE as never,
            ),
          ),
        );
        expect(r.calls).toEqual([
          {
            kind: "switch-model",
            conversationId: "thread-ada",
            commandId: "op-1",
            model: "claude-sonnet-4-5",
            options: [option],
          },
        ]);
      }
    }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | { interactionMode: "plan" as const } → { interactionMode: "default" as const }
it.effect(
  "ST72: An interaction mode change is never sent on its own: the mode goes with the next message",
  () =>
    Effect.gen(function* () {
      const r = rig(1);
      yield* r.run(viaEngine(r.registry, ENV, engineSetInteractionMode));
      expect(r.calls).toEqual([]);
      yield* r.run(
        viaEngine(
          r.registry,
          ENV,
          engineStartTurn(ENV, { ...turn(), interactionMode: "plan" } as never),
        ),
      );
      expect(r.calls).toMatchObject([{ kind: "send", interactionMode: "plan" }]);
    }),
);

// witness: packages/client-runtime/src/data/engineCommands.ts | attachments, → attachments: attachments.filter((attachment) => attachment.type === "image"),
it.effect("ST73: A turn's files go to the engine with it, by the id they were uploaded under", () =>
  Effect.gen(function* () {
    const r = rig(1);
    yield* r.run(viaEngine(r.registry, ENV, engineStartTurn(ENV, turn([file]))));
    expect(r.calls).toMatchObject([{ kind: "send", attachments: [file] }]);
  }),
);
