/**
 * The one fake inside a scenario Mate: a provider driver whose agent is played by the test. Each
 * turn it receives runs the next scripted list of steps — say, call a tool, ask, hit a usage
 * limit, fail — through the canonical events an adapter emits, so everything above the
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
  type ServerProviderUsageLimits,
  TextGenerationError,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
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
import { applyUsageLimitsUpdate } from "../src/provider/providerUsageLimits.ts";
import type { ProviderAdapterShape } from "../src/provider/Services/ProviderAdapter.ts";

/** Authored canonical adapter evidence; ids are provider ids, never engine ids. */
export type ScriptedEvent = ProviderRuntimeEvent extends infer E
  ? E extends ProviderRuntimeEvent
    ? Omit<E, "eventId" | "provider" | "providerInstanceId" | "threadId" | "createdAt">
    : never
  : never;

/** One thing the agent does in its turn, in order. */
export type ScriptedStep =
  | { readonly kind: "event"; readonly event: ScriptedEvent }
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

// An agent Mate signs nobody in to, as the fake Mate reports (`runsWithoutSignIn`): a case about
// sign-in scripts the login itself.

const MODEL = "gpt-5.4";

interface Session {
  session: ProviderSession;
  fiber?: Fiber.Fiber<void>;
  turns: number;
}

export const makeScriptedProvider = (
  options: {
    readonly driverKind?: ProviderDriverKind;
    readonly usageLimits?: ServerProviderUsageLimits;
  } = {},
) =>
  Effect.gen(function* () {
    const DRIVER_KIND = options.driverKind ?? ProviderDriverKind.make("opencode");
    const turns: Array<ReadonlyArray<ScriptedStep>> = [];
    const sends: Array<ScriptedSend> = [];
    const received = yield* Queue.unbounded<ScriptedSend>();
    const emitters = new Map<ThreadId, (event: ScriptedEvent) => Effect.Effect<void>>();
    const answers: Array<ScriptedAnswer> = [];
    const pending = new Map<string, Deferred.Deferred<void>>();
    let sessionsStarted = 0;

    const driver: AnyProviderDriver<never> = {
      driverKind: DRIVER_KIND,
      metadata: { displayName: "OpenCode", supportsMultipleInstances: false },
      configSchema: Schema.Unknown,
      defaultConfig: () => ({}),
      create: ({ instanceId, displayName, accentColor, enabled }) =>
        Effect.gen(function* () {
          const scope = yield* Effect.scope;
          const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
          const sessions = new Map<ThreadId, Session>();
          const snapshots = yield* PubSub.unbounded<ServerProvider>();
          let usageLimits = options.usageLimits;
          let eventCount = 0;
          let requestCount = 0;
          const now = Effect.map(DateTime.now, DateTime.formatIso);

          const emit = (
            type: string,
            threadId: ThreadId,
            fields: Record<string, unknown> = {},
          ): Effect.Effect<void> =>
            Effect.flatMap(now, (createdAt) => {
              const session = sessions.get(threadId);
              if (session && type === "turn.started" && typeof fields.turnId === "string")
                session.session = {
                  ...session.session,
                  activeTurnId: TurnId.make(fields.turnId),
                  status: "running",
                  updatedAt: createdAt,
                };
              if (
                session &&
                (type === "turn.completed" || type === "turn.aborted") &&
                fields.turnId === session.session.activeTurnId
              )
                session.session = {
                  ...session.session,
                  activeTurnId: undefined,
                  status: "ready",
                  updatedAt: createdAt,
                };
              return Queue.offer(events, {
                type,
                eventId: EventId.make(`scripted-${++eventCount}`),
                provider: DRIVER_KIND,
                threadId,
                createdAt,
                payload: {},
                ...fields,
              } as unknown as ProviderRuntimeEvent);
            });

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
              yield* Deferred.await(reply).pipe(
                Effect.ensuring(Effect.sync(() => pending.delete(requestId))),
              );
              return requestId;
            });

          const run = (threadId: ThreadId, turnId: TurnId, steps: ReadonlyArray<ScriptedStep>) =>
            Effect.gen(function* () {
              let item = 0;
              for (const step of steps) {
                const itemId = `${turnId}-item-${++item}`;
                switch (step.kind) {
                  case "event":
                    yield* emit(step.event.type, threadId, { turnId, ...step.event });
                    if (step.event.type === "turn.completed" || step.event.type === "turn.aborted")
                      return;
                    break;
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
                sessionsStarted += 1;
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
                const publish = (event: ScriptedEvent) =>
                  emit(event.type, input.threadId, {
                    turnId: sessions.get(input.threadId)?.session.activeTurnId,
                    ...event,
                  });
                emitters.set(input.threadId, publish);
                yield* Scope.addFinalizer(
                  scope,
                  Effect.sync(() => {
                    if (emitters.get(input.threadId) === publish) emitters.delete(input.threadId);
                  }),
                );
                yield* emit("session.started", input.threadId);
                return session;
              }),
            sendTurn: (input) =>
              Effect.gen(function* () {
                const session = yield* sessionOf(input.threadId);
                const active = session.session.activeTurnId;
                if (active !== undefined) {
                  const send = { threadId: input.threadId, turnId: active, input };
                  sends.push(send);
                  yield* Queue.offer(received, send);
                  return { threadId: input.threadId, turnId: active };
                }
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
                const armed = yield* Deferred.make<void>();
                session.fiber = yield* Effect.forkIn(
                  Deferred.await(armed).pipe(Effect.andThen(run(input.threadId, turnId, steps))),
                  scope,
                );
                yield* Deferred.succeed(armed, undefined);
                return { threadId: input.threadId, turnId };
              }),
            interruptTurn: (threadId, requestedTurn) =>
              Effect.gen(function* () {
                const session = yield* sessionOf(threadId);
                const turnId = session.session.activeTurnId;
                if (turnId === undefined) return;
                if (requestedTurn !== undefined && requestedTurn !== turnId)
                  return yield* invalid("interruptTurn", "The named scripted turn is not running.");
                if (session.fiber !== undefined) yield* Fiber.interrupt(session.fiber);
                if (session.session.activeTurnId === turnId)
                  yield* emit("turn.completed", threadId, {
                    turnId,
                    payload: { state: "interrupted" },
                  });
                if (DRIVER_KIND === "claudeAgent") yield* adapter.stopSession(threadId);
              }),
            respondToRequest: (_threadId, requestId, decision) => answered(requestId, decision),
            respondToUserInput: (_threadId, requestId, answer) => answered(requestId, answer),
            stopSession: (threadId) =>
              Effect.gen(function* () {
                const session = sessions.get(threadId);
                if (session?.fiber !== undefined) yield* Fiber.interrupt(session.fiber);
                sessions.delete(threadId);
                emitters.delete(threadId);
                yield* emit("session.exited", threadId, {
                  payload: { reason: "Stopped", exitKind: "graceful" },
                });
              }),
            listSessions: () => Effect.sync(() => [...sessions.values()].map((s) => s.session)),
            hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
            readThread: () => unsupported("readThread"),
            rollbackThread: () => unsupported("rollbackThread"),
            stopAll: () =>
              Effect.forEach([...sessions.keys()], (threadId) => adapter.stopSession(threadId), {
                discard: true,
              }),
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
            ...(usageLimits === undefined ? {} : { usageLimits }),
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
              streamChanges: Stream.fromPubSub(snapshots),
              applyUsageLimits: (update) =>
                Effect.gen(function* () {
                  usageLimits = applyUsageLimitsUpdate({
                    previous: usageLimits,
                    update,
                    checkedAt: update.checkedAt,
                  });
                  yield* PubSub.publish(snapshots, yield* snapshotValue);
                }),
            },
            adapter,
            textGeneration: {
              generateCommitMessage: () => noText("generateCommitMessage"),
              generatePrContent: () => noText("generatePrContent"),
              generateBranchName: () => noText("generateBranchName"),
              generateThreadTitle: () => noText("generateThreadTitle"),
              generateCrewProposal: () => noText("generateCrewProposal"),
            },
          };
        }),
    };

    return {
      driver,
      /** A spontaneous external fact (e.g. a helper finishing or the agent waking itself). */
      event: (threadId: ThreadId, event: ScriptedEvent) =>
        Effect.suspend(() => {
          const publish = emitters.get(threadId);
          return publish === undefined
            ? Effect.fail(
                new ProviderAdapterSessionNotFoundError({ provider: DRIVER_KIND, threadId }),
              )
            : publish(event);
        }),
      /** Script the next turn the provider receives; turns are taken in order. */
      turn: (steps: ReadonlyArray<ScriptedStep>) => Effect.sync(() => void turns.push(steps)),
      /** The next turn the provider receives, as it arrives. */
      received: Queue.take(received),
      sends: sends as ReadonlyArray<ScriptedSend>,
      answers: answers as ReadonlyArray<ScriptedAnswer>,
      /** Scripted turns no send has taken yet. */
      unsent: () => turns.length,
      /** How many provider sessions the engine has opened so far. */
      sessionsStarted: () => sessionsStarted,
    };
  });

export type ScriptedProvider = Effect.Success<ReturnType<typeof makeScriptedProvider>>;
export type { ProviderInstanceId };
