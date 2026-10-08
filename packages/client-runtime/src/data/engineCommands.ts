/**
 * The thread commands a conversation's view already sends — start a turn, interrupt it, answer an
 * approval or a question — routed per Mate: through the account's engine operations when the
 * Mate's door named an engine protocol this build speaks, else unchanged over V1. The view keeps
 * its calls; the Mate decides the wire.
 *
 * @module data/engineCommands
 */
import {
  ChatImageAttachment,
  OrchestrationDispatchCommandError,
  type ClientOrchestrationCommand,
  type DispatchResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { AtomRegistry } from "effect/unstable/reactivity";

import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { EnvironmentRpcUnavailableError } from "../rpc/client.ts";
import { engineRouteOf, mateEngineHostAtom, type MateEngineHost } from "./engineHost.ts";
import { EngineOperationFailed } from "./operations/executors/mateEngine.ts";
import type { EngineAcceptance } from "./operations/mateEngine.ts";
import { ENGINE_UPDATE_WORDS } from "./projections/mateEngine.ts";

type Command<T extends ClientOrchestrationCommand["type"]> = Omit<
  Extract<ClientOrchestrationCommand, { readonly type: T }>,
  "type" | "commandId" | "createdAt"
>;

const refuse = (message: string) => Effect.fail(new OrchestrationDispatchCommandError({ message }));

/**
 * `v1` unless the Mate's prepared connection names an engine protocol: then the engine's
 * operation, its acceptance answered as the dispatch the view awaits.
 */
export function viaEngine<E, R>(
  registry: AtomRegistry.AtomRegistry,
  environmentId: string,
  engine: (host: MateEngineHost) => Effect.Effect<EngineAcceptance, EngineOperationFailed>,
  v1: Effect.Effect<DispatchResult, E, R>,
): Effect.Effect<
  DispatchResult,
  E | OrchestrationDispatchCommandError | EnvironmentRpcUnavailableError,
  R | EnvironmentSupervisor
> {
  return Effect.gen(function* () {
    const supervisor = yield* EnvironmentSupervisor;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared)) return yield* v1;
    const route = engineRouteOf(prepared.value);
    if (route.kind === "v1" || route.kind === "unknown") return yield* v1;
    if (route.kind === "update") return yield* refuse(ENGINE_UPDATE_WORDS);
    const host = registry.get(mateEngineHostAtom);
    if (host === null)
      return yield* Effect.fail(
        new EnvironmentRpcUnavailableError({
          environmentId: environmentId as never,
          message: "This account is not ready to talk to the Mate yet.",
        }),
      );
    const accepted = yield* engine(host).pipe(
      Effect.mapError((failure) =>
        failure.outcome === "unsent"
          ? new EnvironmentRpcUnavailableError({
              environmentId: environmentId as never,
              message: failure.message,
            })
          : new OrchestrationDispatchCommandError({ message: failure.message }),
      ),
    );
    return { sequence: accepted.seq } as DispatchResult;
  });
}

/** A picture already in the Mate's asset store: the engine takes pictures by reference only. */
const isReferencedPicture = Schema.is(ChatImageAttachment);

const PICTURES_BY_REFERENCE =
  "Pictures reach this Mate once they are uploaded; send the words, then the pictures again.";

/** A turn's start as the engine's send: the message's own id is the command id. */
export const engineStartTurn =
  (environmentId: string, input: Command<"thread.turn.start">) => (host: MateEngineHost) => {
    const attachments = input.message.attachments.filter(isReferencedPicture);
    if (attachments.length !== input.message.attachments.length)
      return Effect.fail(
        new EngineOperationFailed({ outcome: "refused", message: PICTURES_BY_REFERENCE }),
      );
    return host.operations.send({
      environmentId,
      conversationId: input.threadId,
      text: input.message.text,
      attachments,
      commandId: input.message.messageId,
    });
  };

export const engineInterruptTurn =
  (environmentId: string, input: Command<"thread.turn.interrupt">) => (host: MateEngineHost) =>
    host.operations.stop({
      environmentId,
      conversationId: input.threadId,
      ...(input.turnId === undefined ? {} : { runId: input.turnId }),
    });

const DECISION_WORDS: Readonly<Record<string, string>> = {
  accept: "Approved",
  acceptForSession: "Approved for this session",
  decline: "Declined",
  cancel: "Cancelled",
};

export const engineRespondToApproval =
  (environmentId: string, input: Command<"thread.approval.respond">) => (host: MateEngineHost) =>
    host.operations.answer({
      environmentId,
      conversationId: input.threadId,
      requestId: input.requestId,
      answer: { kind: "approval", decision: input.decision },
      summary: DECISION_WORDS[input.decision] ?? input.decision,
    });

export const engineRespondToUserInput =
  (environmentId: string, input: Command<"thread.user-input.respond">) => (host: MateEngineHost) =>
    host.operations.answer({
      environmentId,
      conversationId: input.threadId,
      requestId: input.requestId,
      answer: { kind: "input", answers: input.answers },
      summary: "Answered",
    });
