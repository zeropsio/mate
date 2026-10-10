/**
 * The engine conversation's one write boundary: send, stop, answer, dismiss, steer and the
 * conversation's settings (model and options, runtime mode, agent), each recorded before it leaves
 * under the engine command id it carries. The engine's receipt is the answer; a call that never
 * left stays unsent (Send again re-sends under the same id); a lost answer is asked of the engine
 * by that id — its stored receipt settles it, its absence lets the same id go once more (the
 * engine applies a command once), and an engine that cannot be asked leaves the operation
 * unresolved with the next action named. Nothing is decided by a clock.
 *
 * @module data/operations/executors/mateEngine
 */
import {
  EngineWireError,
  EnvironmentAuthorizationError,
  MATE_ENGINE_PROTOCOLS,
  WS_METHODS,
  type CommandResult,
  type EngineAnswer,
  type EngineCallResult,
  type EngineReceiptResult,
  type EnvironmentId,
  type ChatFileAttachment,
  type ChatImageAttachment,
  type ProviderInteractionMode,
  type ProviderOptionSelection,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  EnvironmentNotRegisteredError,
  type EnvironmentRegistry,
} from "../../../connection/registry.ts";
import {
  EnvironmentRpcUnavailableError,
  request,
  type EnvironmentRpcFailure,
} from "../../../rpc/client.ts";
import type { OperationIntent } from "../../model.ts";
import { readsOfState, type AccountStore } from "../../store.ts";
import {
  mateEngineStop,
  stopObservable,
  type EngineAcceptance,
  type EngineOperationTarget,
} from "../mateEngine.ts";

export class EngineOperationFailed extends Schema.TaggedError<EngineOperationFailed>()(
  "EngineOperationFailed",
  {
    /** `refused`: the engine (or the Mate's protocol) said no; `unsent`: it never arrived; `unresolved`: unknown. */
    outcome: Schema.Literals(["refused", "unsent", "unresolved"]),
    message: Schema.String,
    code: Schema.optionalKey(Schema.String),
  },
) {}

/** How an engine call can fail: the socket, the Mate's registration, or the engine's own error. */
export type EngineCallError =
  | EnvironmentRpcFailure<typeof WS_METHODS.engineSend>
  | EnvironmentRpcUnavailableError
  | EnvironmentNotRegisteredError;

/** The engine's calls as this boundary makes them; the wire adds the protocol it speaks. */
export interface EngineCallWire {
  readonly call: (
    environmentId: string,
    command:
      | {
          readonly kind: "send";
          readonly conversationId: string;
          readonly commandId: string;
          readonly text: string;
          readonly attachments: ReadonlyArray<ChatImageAttachment | ChatFileAttachment>;
          readonly interactionMode?: ProviderInteractionMode;
        }
      | {
          readonly kind: "stop";
          readonly conversationId: string;
          readonly commandId: string;
          readonly runId: string | null;
        }
      | {
          readonly kind: "continue";
          readonly conversationId: string;
          readonly commandId: string;
        }
      | {
          readonly kind: "answer";
          readonly conversationId: string;
          readonly commandId: string;
          readonly requestId: string;
          readonly answer: EngineAnswer;
          readonly summary: string;
        }
      | {
          readonly kind: "dismiss";
          readonly conversationId: string;
          readonly commandId: string;
          readonly requestId: string;
        }
      | {
          readonly kind: "steer";
          readonly conversationId: string;
          readonly commandId: string;
          readonly runId: string;
          readonly text: string;
        }
      | {
          readonly kind: "switch-model";
          readonly conversationId: string;
          readonly commandId: string;
          readonly model: string;
          readonly options?: ReadonlyArray<ProviderOptionSelection>;
        }
      | {
          readonly kind: "set-archived";
          readonly conversationId: string;
          readonly commandId: string;
          readonly archived: boolean;
        }
      | {
          readonly kind: "set-runtime-mode";
          readonly conversationId: string;
          readonly commandId: string;
          readonly runtimeMode: RuntimeMode;
        }
      | {
          readonly kind: "assign-agent";
          readonly conversationId: string;
          readonly commandId: string;
          readonly instanceId: string;
          readonly model: string;
          readonly options?: ReadonlyArray<ProviderOptionSelection>;
        },
  ) => Effect.Effect<EngineCallResult, EngineCallError>;
  readonly receipt: (
    environmentId: string,
    conversationId: string,
    commandId: string,
  ) => Effect.Effect<EngineReceiptResult, EngineCallError>;
}
export type EngineCommand = Parameters<EngineCallWire["call"]>[1];

const PROTOCOL = Math.max(...MATE_ENGINE_PROTOCOLS);

/** The engine's calls over the Mate's own socket. */
export function makeEngineCallWire(registry: EnvironmentRegistry["Service"]): EngineCallWire {
  return {
    call: (environmentId, command) => {
      const id = environmentId as EnvironmentId;
      const base = {
        protocol: PROTOCOL,
        conversationId: command.conversationId as never,
        commandId: command.commandId as never,
      };
      switch (command.kind) {
        case "send":
          return registry.run(
            id,
            request(WS_METHODS.engineSend, {
              ...base,
              text: command.text,
              ...(command.attachments.length === 0 ? {} : { attachments: command.attachments }),
              ...(command.interactionMode === undefined
                ? {}
                : { interactionMode: command.interactionMode }),
            }),
          );
        case "stop":
          return registry.run(
            id,
            request(WS_METHODS.engineStop, {
              ...base,
              ...(command.runId === null ? {} : { runId: command.runId as never }),
            }),
          );
        case "continue":
          return registry.run(id, request(WS_METHODS.engineContinue, base));
        case "answer":
          return registry.run(
            id,
            request(WS_METHODS.engineAnswer, {
              ...base,
              requestId: command.requestId as never,
              answer: command.answer,
              summary: command.summary,
            }),
          );
        case "dismiss":
          return registry.run(
            id,
            request(WS_METHODS.engineDismiss, {
              ...base,
              requestId: command.requestId as never,
            }),
          );
        case "steer":
          return registry.run(
            id,
            request(WS_METHODS.engineSteer, {
              ...base,
              runId: command.runId as never,
              text: command.text,
            }),
          );
        case "switch-model":
          return registry.run(
            id,
            request(WS_METHODS.engineSwitchModel, {
              ...base,
              model: command.model,
              ...(command.options === undefined ? {} : { options: command.options }),
            }),
          );
        case "set-archived":
          return registry.run(
            id,
            request(WS_METHODS.engineSetArchived, {
              ...base,
              archived: command.archived,
            }),
          );
        case "set-runtime-mode":
          return registry.run(
            id,
            request(WS_METHODS.engineSetRuntimeMode, {
              ...base,
              runtimeMode: command.runtimeMode,
            }),
          );
        case "assign-agent":
          return registry.run(
            id,
            request(WS_METHODS.engineAssignAgent, {
              ...base,
              instanceId: command.instanceId,
              model: command.model,
              ...(command.options === undefined ? {} : { options: command.options }),
            }),
          );
      }
    },
    receipt: (environmentId, conversationId, commandId) =>
      registry.run(
        environmentId as EnvironmentId,
        request(WS_METHODS.engineReceipt, {
          protocol: PROTOCOL,
          conversationId: conversationId as never,
          commandId: commandId as never,
        }),
      ),
  };
}

const isUnavailable = Schema.is(EnvironmentRpcUnavailableError);
const isUnregistered = Schema.is(EnvironmentNotRegisteredError);
const isWireError = Schema.is(EngineWireError);
const isUnauthorized = Schema.is(EnvironmentAuthorizationError);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A refusal's words for a person, by the engine's reason. */
const REFUSALS: Readonly<Record<string, string>> = {
  archived: "This conversation is archived.",
  "unknown-request": "That question is no longer open.",
  "not-answerable": "That question can no longer be answered.",
  "not-dismissible": "The agent waits on this question: it needs an answer, or stop the work.",
  "run-not-running": "Nothing is running to stop.",
  "run-ended": "That work has already ended.",
  "stop-already-asked": "Stop was already asked.",
  "steer-unsupported": "This agent cannot take a message while it works.",
  "background-work":
    "The agent is still running background work, and this change needs a new session that would end it.",
  "agent-locked": "This conversation started on another agent; start a new one to use this agent.",
};

export function makeMateEngineOperations(options: {
  readonly store: AccountStore;
  readonly wire: EngineCallWire;
  readonly makeId: () => string;
}) {
  const { store, wire } = options;
  let closed = false;
  const stops = new Set<string>();
  /** A stop ends when its run's record ends: read whenever the store changes, never on a clock. */
  const settleStops = () => {
    if (closed || stops.size === 0) return;
    const read = readsOfState(store.state());
    for (const requestId of Array.from(stops)) {
      const record = store.state().operations.get(requestId);
      if (record?.intent.kind !== "mate-engine-stop" || record.receipt === null) continue;
      if (mateEngineStop.settledBy?.(read, record.intent, record.receipt) == null) {
        // Nothing here follows it any more (never opened, or forgotten): its end cannot be seen.
        if (!stopObservable(read, record.intent, record.receipt)) {
          stops.delete(requestId);
          store.dispatch({
            kind: "operation-exhausted",
            requestId,
            unobservable: {
              nextActor: "you",
              nextAction: "Open the conversation to see whether it stopped.",
              reason: "The Mate took the Stop; this view no longer follows that conversation.",
            },
          });
        }
        continue;
      }
      stops.delete(requestId);
      store.dispatch({
        kind: "operation-receipt",
        receipt: {
          ...record.receipt,
          outcome: { kind: "succeeded", evidence: "Its run ended." },
        },
      });
    }
  };
  const unlisten = store.subscribe(settleStops);

  const closedFailure = () =>
    new EngineOperationFailed({ outcome: "unsent", message: "This account has closed." });

  const settle = (
    requestId: string,
    intent: OperationIntent & EngineOperationTarget,
    result: EngineCallResult,
  ): Effect.Effect<EngineAcceptance, EngineOperationFailed> => {
    if (result._tag === "Accepted") {
      const accepted: EngineAcceptance = {
        seq: result.seq,
        ...(result.runId === undefined ? {} : { runId: result.runId }),
        ...(result.itemId === undefined ? {} : { itemId: result.itemId }),
        ...(result.requestId === undefined ? {} : { requestId: result.requestId }),
      };
      const pending = intent.kind === "mate-engine-stop";
      store.dispatch({
        kind: "operation-receipt",
        receipt: {
          requestId,
          operationId: requestId,
          executor: "mate",
          affected: [],
          handles: [accepted.itemId ?? accepted.runId ?? requestId],
          acceptance: { kind: "accepted", result: accepted },
          outcome: pending
            ? { kind: "pending" }
            : { kind: "succeeded", evidence: "The Mate's engine accepted it." },
        },
      });
      if (pending) {
        stops.add(requestId);
        // The run may have ended before the answer came.
        settleStops();
      }
      return Effect.succeed(accepted);
    }
    const refusal =
      result._tag === "Rejected"
        ? {
            reason:
              result.rejection.detail ??
              REFUSALS[result.rejection.reason] ??
              "The Mate's engine refused it.",
            code: result.rejection.reason,
          }
        : {
            reason: result.unserved.message,
            code: result.unserved.reason === "protocol" ? "update" : "not-on-engine",
          };
    return refuse(requestId, refusal.reason, refusal.code);
  };

  /** A refusal is the operation's answer: nothing was applied, nothing is asked again. */
  const refuse = (requestId: string, reason: string, code: string) => {
    store.dispatch({
      kind: "operation-receipt",
      receipt: {
        requestId,
        operationId: requestId,
        executor: "mate",
        affected: [],
        handles: [],
        acceptance: { kind: "refused", reason, code },
        outcome: { kind: "pending" },
      },
    });
    return Effect.fail(new EngineOperationFailed({ outcome: "refused", message: reason, code }));
  };

  const attempt = (
    requestId: string,
    intent: OperationIntent & EngineOperationTarget,
    command: EngineCommand,
    mayRepeat: boolean,
  ): Effect.Effect<EngineAcceptance, EngineOperationFailed> =>
    Effect.gen(function* () {
      const answer = yield* Effect.exit(wire.call(intent.environmentId, command));
      if (closed) return yield* Effect.fail(closedFailure());
      if (Exit.isSuccess(answer)) return yield* settle(requestId, intent, answer.value);
      const error = Cause.findErrorOption(answer.cause);
      // The Mate refused the caller before the engine saw the call: a refusal, never a doubt.
      if (Option.isSome(error) && isUnauthorized(error.value))
        return yield* refuse(requestId, error.value.message, "authorization");
      if (
        Option.isSome(error) &&
        (isUnavailable(error.value) || isUnregistered(error.value) || isWireError(error.value))
      ) {
        const message = messageOf(error.value);
        store.dispatch({ kind: "operation-unsent", requestId, reason: message });
        return yield* Effect.fail(new EngineOperationFailed({ outcome: "unsent", message }));
      }
      store.dispatch({
        kind: "operation-uncertain",
        requestId,
        reason: messageOf(Cause.squash(answer.cause)),
      });
      const looked = yield* Effect.exit(
        wire.receipt(intent.environmentId, intent.conversationId, requestId),
      );
      if (closed) return yield* Effect.fail(closedFailure());
      if (Exit.isSuccess(looked)) {
        switch (looked.value._tag) {
          case "Found":
            return yield* settle(requestId, intent, looked.value.result as CommandResult);
          case "Unserved":
            return yield* settle(requestId, intent, looked.value);
          case "None":
            store.dispatch({ kind: "operation-absent", requestId });
            if (mayRepeat) return yield* attempt(requestId, intent, command, false);
        }
      } else store.dispatch({ kind: "operation-lookup-failed", requestId });
      store.dispatch({
        kind: "operation-exhausted",
        requestId,
        unobservable: {
          nextActor: "you",
          nextAction: "Read the conversation before trying again.",
          reason: "The Mate did not answer, so whether it took this is not known.",
        },
      });
      return yield* Effect.fail(
        new EngineOperationFailed({
          outcome: "unresolved",
          message: "The Mate did not answer, so whether it took this is not known.",
        }),
      );
    });

  const execute = (
    intent: OperationIntent & EngineOperationTarget,
    command: (commandId: string) => EngineCommand,
    commandId?: string,
  ) =>
    Effect.suspend(() => {
      if (closed) return Effect.fail(closedFailure());
      const requestId = commandId ?? options.makeId();
      store.dispatch({ kind: "operation-recorded", requestId, intent });
      return attempt(requestId, intent, command(requestId), true).pipe(
        Effect.map((accepted) => ({ requestId, ...accepted })),
      );
    });

  return {
    send: (
      target: EngineOperationTarget & {
        readonly text: string;
        /** Pictures by reference, files by the id they were uploaded under. */
        readonly attachments?: ReadonlyArray<ChatImageAttachment | ChatFileAttachment>;
        /** `plan`: the agent plans the turn. Absent: default. */
        readonly interactionMode?: ProviderInteractionMode;
        /** The send's own id where its caller already gave it one (the message's id). */
        readonly commandId?: string;
      },
    ) =>
      execute(
        {
          kind: "mate-engine-send",
          environmentId: target.environmentId,
          conversationId: target.conversationId,
          text: target.text,
          pictures: target.attachments?.length ?? 0,
        },
        (commandId) => ({
          kind: "send",
          conversationId: target.conversationId,
          commandId,
          text: target.text,
          attachments: target.attachments ?? [],
          ...(target.interactionMode === undefined
            ? {}
            : { interactionMode: target.interactionMode }),
        }),
        target.commandId,
      ),
    stop: (target: EngineOperationTarget & { readonly runId?: string }) =>
      execute(
        {
          kind: "mate-engine-stop",
          environmentId: target.environmentId,
          conversationId: target.conversationId,
          runId: target.runId ?? null,
        },
        (commandId) => ({
          kind: "stop",
          conversationId: target.conversationId,
          commandId,
          runId: target.runId ?? null,
        }),
      ),
    continue: (target: EngineOperationTarget) =>
      execute(
        {
          kind: "mate-engine-continue",
          environmentId: target.environmentId,
          conversationId: target.conversationId,
        },
        (commandId) => ({ kind: "continue", conversationId: target.conversationId, commandId }),
      ),
    answer: (
      target: EngineOperationTarget & {
        readonly requestId: string;
        readonly answer: EngineAnswer;
        readonly summary: string;
      },
    ) =>
      execute(
        {
          kind: "mate-engine-answer",
          environmentId: target.environmentId,
          conversationId: target.conversationId,
          requestId: target.requestId,
          summary: target.summary,
        },
        (commandId) => ({
          kind: "answer",
          conversationId: target.conversationId,
          commandId,
          requestId: target.requestId,
          answer: target.answer,
          summary: target.summary,
        }),
      ),
    dismiss: (target: EngineOperationTarget & { readonly requestId: string }) =>
      execute(
        {
          kind: "mate-engine-dismiss",
          environmentId: target.environmentId,
          conversationId: target.conversationId,
          requestId: target.requestId,
        },
        (commandId) => ({
          kind: "dismiss",
          conversationId: target.conversationId,
          commandId,
          requestId: target.requestId,
        }),
      ),
    steer: (
      target: EngineOperationTarget & {
        readonly runId: string;
        readonly text: string;
        /** The steer's own id where its caller already gave it one (the message's id). */
        readonly commandId?: string;
      },
    ) =>
      execute(
        {
          kind: "mate-engine-steer",
          environmentId: target.environmentId,
          conversationId: target.conversationId,
          runId: target.runId,
          text: target.text,
        },
        (commandId) => ({
          kind: "steer",
          conversationId: target.conversationId,
          commandId,
          runId: target.runId,
          text: target.text,
        }),
        target.commandId,
      ),
    /** The conversation's next model and its options, on the agent it already runs. */
    switchModel: (
      target: EngineOperationTarget & {
        readonly model: string;
        readonly options?: ReadonlyArray<ProviderOptionSelection>;
      },
    ) =>
      execute(
        {
          kind: "mate-engine-switch-model",
          environmentId: target.environmentId,
          conversationId: target.conversationId,
          model: target.model,
          ...(target.options === undefined ? {} : { options: target.options }),
        },
        (commandId) => ({
          kind: "switch-model",
          conversationId: target.conversationId,
          commandId,
          model: target.model,
          ...(target.options === undefined ? {} : { options: target.options }),
        }),
      ),
    /** Archive or restore the conversation through its existing receipt path. */
    setArchived: (target: EngineOperationTarget & { readonly archived: boolean }) =>
      execute(
        {
          kind: "mate-engine-set-archived",
          environmentId: target.environmentId,
          conversationId: target.conversationId,
          archived: target.archived,
        },
        (commandId) => ({
          kind: "set-archived",
          conversationId: target.conversationId,
          commandId,
          archived: target.archived,
        }),
      ),
    /** How freely the agent works, from its next run on. */
    setRuntimeMode: (target: EngineOperationTarget & { readonly runtimeMode: RuntimeMode }) =>
      execute(
        {
          kind: "mate-engine-set-runtime-mode",
          environmentId: target.environmentId,
          conversationId: target.conversationId,
          runtimeMode: target.runtimeMode,
        },
        (commandId) => ({
          kind: "set-runtime-mode",
          conversationId: target.conversationId,
          commandId,
          runtimeMode: target.runtimeMode,
        }),
      ),
    /** The conversation's agent: another provider instance, as the engine allows it. */
    assignAgent: (
      target: EngineOperationTarget & {
        readonly instanceId: string;
        readonly model: string;
        readonly options?: ReadonlyArray<ProviderOptionSelection>;
      },
    ) =>
      execute(
        {
          kind: "mate-engine-assign-agent",
          environmentId: target.environmentId,
          conversationId: target.conversationId,
          instanceId: target.instanceId,
        },
        (commandId) => ({
          kind: "assign-agent",
          conversationId: target.conversationId,
          commandId,
          instanceId: target.instanceId,
          model: target.model,
          ...(target.options === undefined ? {} : { options: target.options }),
        }),
      ),
    close: () => {
      closed = true;
      unlisten();
      stops.clear();
    },
  };
}

export type MateEngineOperations = ReturnType<typeof makeMateEngineOperations>;
