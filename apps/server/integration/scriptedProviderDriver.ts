/**
 * The one fake inside a scenario Mate: a provider driver whose agent is played by the test. Each
 * turn it receives runs the next scripted list of steps — say, call a tool, ask, hit a usage
 * limit, fail — through the canonical events a Codex adapter emits, so everything above the
 * adapter (ProviderService, SPI bus, pump, engine, store, outbox) is the real Mate.
 *
 * It owns provider session/turn/request ids only. A send with no scripted turn, and every adapter
 * operation no script supports, fails explicitly instead of inventing a plausible success.
 */
import {
  type ApprovalRequestId,
  EventId,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderUserInputAnswers,
  type ServerProvider,
  TextGenerationError,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../src/provider/Errors.ts";
import {
  type AnyProviderDriver,
  defaultProviderContinuationIdentity,
} from "../src/provider/ProviderDriver.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../src/provider/providerMaintenance.ts";
import type { ProviderAdapterShape } from "../src/provider/Services/ProviderAdapter.ts";

/** One thing the agent does in its turn, in order. */
export type ScriptedStep =
  | { readonly kind: "say"; readonly text: string }
  | { readonly kind: "tool"; readonly title: string; readonly detail?: string }
  | { readonly kind: "ask"; readonly question: string; readonly options?: ReadonlyArray<string> }
  | { readonly kind: "approval"; readonly detail: string }
  /** The turn waits here until the test releases it. */
  | { readonly kind: "wait"; readonly until: Deferred.Deferred<void> }
  /** The usage window refuses: the turn ends failed, typed as a usage limit. */
  | { readonly kind: "limit"; readonly message: string }
  /** The native boundary fails: the turn ends failed with these words. */
  | { readonly kind: "fail"; readonly message: string };

/** A turn the provider received, exactly as the engine sent it. */
export interface ScriptedSend {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly input: ProviderSendTurnInput;
}

/** What the agent was answered, by request. */
export interface ScriptedAnswer {
  readonly requestId: ApprovalRequestId;
  readonly answer: ProviderApprovalDecision | ProviderUserInputAnswers;
}

const DRIVER_KIND = ProviderDriverKind.make("codex");
const MODEL = "gpt-5.4";

interface Session {
  readonly session: ProviderSession;
  turns: number;
}

export const makeScriptedProvider = () =>
  Effect.gen(function* () {
    const turns: Array<ReadonlyArray<ScriptedStep>> = [];
    const sends: Array<ScriptedSend> = [];
    const received = yield* Queue.unbounded<ScriptedSend>();
    const answers: Array<ScriptedAnswer> = [];
    const pending = new Map<string, Deferred.Deferred<void>>();

    const driver: AnyProviderDriver<never> = {
      driverKind: DRIVER_KIND,
      metadata: { displayName: "Codex", supportsMultipleInstances: false },
      configSchema: Schema.Unknown,
      defaultConfig: () => ({}),
      create: ({ instanceId, displayName, accentColor, enabled }) =>
        Effect.gen(function* () {
          const scope = yield* Effect.scope;
          const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
          const sessions = new Map<ThreadId, Session>();
          let eventCount = 0;
          let requestCount = 0;
          const now = Effect.map(DateTime.now, DateTime.formatIso);

          const emit = (
            type: string,
            threadId: ThreadId,
            fields: Record<string, unknown> = {},
          ): Effect.Effect<void> =>
            Effect.flatMap(now, (createdAt) =>
              Queue.offer(events, {
                type,
                eventId: EventId.make(`scripted-${++eventCount}`),
                provider: DRIVER_KIND,
                threadId,
                createdAt,
                payload: {},
                ...fields,
              } as unknown as ProviderRuntimeEvent),
            );

          const invalid = (operation: string, issue: string) =>
            new ProviderAdapterValidationError({ provider: DRIVER_KIND, operation, issue });

          const answered = (requestId: string, answer: ScriptedAnswer["answer"]) =>
            Effect.gen(function* () {
              const waiting = pending.get(requestId);
              if (waiting === undefined) {
                return yield* invalid("respond", `No open scripted request ${requestId}.`);
              }
              pending.delete(requestId);
              answers.push({ requestId: requestId as ApprovalRequestId, answer });
              yield* Deferred.succeed(waiting, undefined);
            });

          const ask = (threadId: ThreadId, turnId: TurnId, type: string, payload: object) =>
            Effect.gen(function* () {
              const requestId = `scripted-request-${++requestCount}`;
              const reply = yield* Deferred.make<void>();
              pending.set(requestId, reply);
              yield* emit(type, threadId, { turnId, requestId, payload });
              yield* Deferred.await(reply);
              return requestId;
            });

          const run = (threadId: ThreadId, turnId: TurnId, steps: ReadonlyArray<ScriptedStep>) =>
            Effect.gen(function* () {
              let item = 0;
              for (const step of steps) {
                const itemId = `${turnId}-item-${++item}`;
                switch (step.kind) {
                  case "say":
                    yield* emit("item.started", threadId, {
                      turnId,
                      itemId,
                      payload: { itemType: "assistant_message", status: "inProgress" },
                    });
                    yield* emit("content.delta", threadId, {
                      turnId,
                      itemId,
                      payload: { streamKind: "assistant_text", delta: step.text },
                    });
                    yield* emit("item.completed", threadId, {
                      turnId,
                      itemId,
                      payload: { itemType: "assistant_message", status: "completed" },
                    });
                    break;
                  case "tool": {
                    const fields = {
                      title: step.title,
                      ...(step.detail ? { detail: step.detail } : {}),
                    };
                    yield* emit("item.started", threadId, {
                      turnId,
                      itemId,
                      payload: { itemType: "command_execution", status: "inProgress", ...fields },
                    });
                    yield* emit("item.completed", threadId, {
                      turnId,
                      itemId,
                      payload: { itemType: "command_execution", status: "completed", ...fields },
                    });
                    break;
                  }
                  case "ask": {
                    const requestId = yield* ask(threadId, turnId, "user-input.requested", {
                      questions: [
                        {
                          id: "0",
                          header: "Question",
                          question: step.question,
                          options: (step.options ?? []).map((label) => ({
                            label,
                            description: label,
                          })),
                          allowCustomAnswer: true,
                          multiSelect: false,
                        },
                      ],
                    });
                    yield* emit("user-input.resolved", threadId, {
                      turnId,
                      requestId,
                      payload: {},
                    });
                    break;
                  }
                  case "approval": {
                    const requestId = yield* ask(threadId, turnId, "request.opened", {
                      requestType: "command_execution_approval",
                      detail: step.detail,
                    });
                    yield* emit("request.resolved", threadId, {
                      turnId,
                      requestId,
                      payload: { requestType: "command_execution_approval" },
                    });
                    break;
                  }
                  case "wait":
                    yield* Deferred.await(step.until);
                    break;
                  case "limit":
                    yield* emit("runtime.error", threadId, {
                      turnId,
                      payload: { message: step.message, class: "usage_limit" },
                    });
                    return yield* emit("turn.completed", threadId, {
                      turnId,
                      payload: {
                        state: "failed",
                        errorMessage: step.message,
                        terminalReason: "usage_limit",
                      },
                    });
                  case "fail":
                    yield* emit("runtime.error", threadId, {
                      turnId,
                      payload: { message: step.message, class: "provider_error" },
                    });
                    return yield* emit("turn.completed", threadId, {
                      turnId,
                      payload: { state: "failed", errorMessage: step.message },
                    });
                }
              }
              yield* emit("turn.completed", threadId, { turnId, payload: { state: "completed" } });
            });

          const sessionOf = (threadId: ThreadId) => {
            const session = sessions.get(threadId);
            return session === undefined
              ? Effect.fail(
                  new ProviderAdapterSessionNotFoundError({ provider: DRIVER_KIND, threadId }),
                )
              : Effect.succeed(session);
          };

          const unsupported = (operation: string) =>
            Effect.fail(invalid(operation, `The scripted provider does not support ${operation}.`));

          const adapter: ProviderAdapterShape<ProviderAdapterError> = {
            provider: DRIVER_KIND,
            capabilities: { sessionModelSwitch: "in-session" },
            startSession: (input) =>
              Effect.gen(function* () {
                const createdAt = yield* now;
                const session: ProviderSession = {
                  provider: DRIVER_KIND,
                  providerInstanceId: instanceId,
                  status: "ready",
                  runtimeMode: input.runtimeMode,
                  threadId: input.threadId,
                  cwd: input.cwd,
                  model: input.modelSelection?.model ?? MODEL,
                  resumeCursor: input.resumeCursor ?? { threadId: input.threadId },
                  createdAt,
                  updatedAt: createdAt,
                };
                sessions.set(input.threadId, {
                  session,
                  turns: sessions.get(input.threadId)?.turns ?? 0,
                });
                yield* emit("session.started", input.threadId);
                return session;
              }),
            sendTurn: (input) =>
              Effect.gen(function* () {
                const session = yield* sessionOf(input.threadId);
                const steps = turns.shift();
                if (steps === undefined) {
                  return yield* invalid("sendTurn", `No scripted turn for ${input.threadId}.`);
                }
                session.turns += 1;
                const turnId = TurnId.make(`scripted-turn-${session.turns}`);
                const send = { threadId: input.threadId, turnId, input };
                sends.push(send);
                yield* Queue.offer(received, send);
                yield* emit("turn.started", input.threadId, { turnId });
                yield* Effect.forkIn(run(input.threadId, turnId, steps), scope);
                return { threadId: input.threadId, turnId };
              }),
            interruptTurn: () => unsupported("interruptTurn"),
            respondToRequest: (_threadId, requestId, decision) => answered(requestId, decision),
            respondToUserInput: (_threadId, requestId, answer) => answered(requestId, answer),
            stopSession: (threadId) => Effect.sync(() => void sessions.delete(threadId)),
            listSessions: () => Effect.sync(() => [...sessions.values()].map((s) => s.session)),
            hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
            readThread: () => unsupported("readThread"),
            rollbackThread: () => unsupported("rollbackThread"),
            stopAll: () => Effect.sync(() => sessions.clear()),
            streamEvents: Stream.fromQueue(events),
          };

          const snapshotValue = Effect.map(now, (checkedAt): ServerProvider => ({
            instanceId,
            driver: DRIVER_KIND,
            enabled,
            installed: true,
            version: "1.0.0",
            status: "ready",
            auth: { status: "authenticated" },
            checkedAt,
            models: [
              {
                slug: MODEL,
                name: "GPT-5.4",
                isCustom: false,
                isDefault: true,
                capabilities: null,
              },
            ],
            slashCommands: [],
            skills: [],
          }));
          const noText = (operation: string) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "The scripted provider writes no text.",
              }),
            );

          return {
            instanceId,
            driverKind: DRIVER_KIND,
            continuationIdentity: defaultProviderContinuationIdentity({
              driverKind: DRIVER_KIND,
              instanceId,
            }),
            displayName,
            accentColor,
            enabled,
            snapshot: {
              resolveMaintenance: () =>
                Effect.succeed(
                  makeManualOnlyProviderMaintenanceCapabilities({
                    provider: DRIVER_KIND,
                    packageName: null,
                  }),
                ),
              getSnapshot: snapshotValue,
              refresh: snapshotValue,
              streamChanges: Stream.empty,
              applyUsageLimits: () => Effect.void,
            },
            adapter,
            textGeneration: {
              generateCommitMessage: () => noText("generateCommitMessage"),
              generatePrContent: () => noText("generatePrContent"),
              generateBranchName: () => noText("generateBranchName"),
              generateThreadTitle: () => noText("generateThreadTitle"),
            },
          };
        }),
    };

    return {
      driver,
      /** Script the next turn the provider receives; turns are taken in order. */
      turn: (steps: ReadonlyArray<ScriptedStep>) => Effect.sync(() => void turns.push(steps)),
      /** The next turn the provider receives, as it arrives. */
      received: Queue.take(received),
      sends: sends as ReadonlyArray<ScriptedSend>,
      answers: answers as ReadonlyArray<ScriptedAnswer>,
      /** Scripted turns no send has taken yet. */
      unsent: () => turns.length,
    };
  });

export type ScriptedProvider = Effect.Success<ReturnType<typeof makeScriptedProvider>>;
export type { ProviderInstanceId };
