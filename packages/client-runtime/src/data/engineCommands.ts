/**
 * The thread commands a conversation's view already sends — start a turn, interrupt it, answer an
 * approval or a question, dismiss a question, set the model, effort, agent, runtime or plan
 * mode — routed per Mate: through the account's engine operations when the
 * Mate's door named an engine protocol this build speaks, else unchanged over V1. The view keeps
 * its calls; the Mate decides the wire.
 *
 * @module data/engineCommands
 */
import {
  ChatFileAttachment,
  ChatImageAttachment,
  OrchestrationDispatchCommandError,
  type ConversationHeader,
  type ClientOrchestrationCommand,
  type DispatchResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { AtomRegistry } from "effect/reactivity";

import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { EnvironmentRpcUnavailableError } from "../rpc/client.ts";
import {
  MateEngineUnsupported,
  engineRouteOf,
  mateEngineHostAtom,
  mateEngineReaderAtom,
  type MateEngineHost,
} from "./engineHost.ts";
import { NATIVE_ENGINE_WORDS } from "../state/threadState.ts";
import { engineConversationId } from "./families/mateEngine.ts";
import { EngineOperationFailed } from "./operations/executors/mateEngine.ts";
import type { EngineAcceptance } from "./operations/mateEngine.ts";
import {
  ENGINE_UPDATE_WORDS,
  NATIVE_UPDATE_WORDS,
  engineStopTarget,
} from "./projections/mateEngine.ts";
import { readsOfState } from "./store.ts";

type Command<T extends ClientOrchestrationCommand["type"]> = Omit<
  Extract<ClientOrchestrationCommand, { readonly type: T }>,
  "type" | "commandId" | "createdAt"
>;

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
  E | OrchestrationDispatchCommandError | EnvironmentRpcUnavailableError | MateEngineUnsupported,
  R | EnvironmentSupervisor
> {
  return Effect.gen(function* () {
    const supervisor = yield* EnvironmentSupervisor;
    const prepared = yield* SubscriptionRef.get(supervisor.prepared);
    if (Option.isNone(prepared)) return yield* v1;
    const route = engineRouteOf(prepared.value);
    if (route.kind === "v1" || route.kind === "unknown") return yield* v1;
    const native = registry.get(mateEngineReaderAtom) === "none";
    if (route.kind === "update")
      return yield* Effect.fail(
        new MateEngineUnsupported({ message: native ? NATIVE_UPDATE_WORDS : ENGINE_UPDATE_WORDS }),
      );
    if (native)
      return yield* Effect.fail(new MateEngineUnsupported({ message: NATIVE_ENGINE_WORDS }));
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

/**
 * A picture already in the Mate's asset store, or a file already uploaded: the engine takes
 * pictures by reference and files by their upload id only.
 */
const isReferenced = Schema.is(Schema.Union([ChatImageAttachment, ChatFileAttachment]));

const PICTURES_BY_REFERENCE =
  "Pictures reach this Mate once they are uploaded; send the words, then the pictures again.";

/**
 * A turn's start as the engine's send: the message's own id is the command id, its files and
 * pictures go with it, and its interaction mode with it (the engine keeps no thread-wide mode).
 */
export const engineStartTurn =
  (environmentId: string, input: Command<"thread.turn.start">) => (host: MateEngineHost) => {
    const attachments = input.message.attachments.filter(isReferenced);
    if (attachments.length !== input.message.attachments.length)
      return Effect.fail(
        new EngineOperationFailed({ outcome: "refused", message: PICTURES_BY_REFERENCE }),
      );
    return host.operations.send({
      environmentId,
      conversationId: input.threadId,
      text: input.message.text,
      attachments,
      ...(input.interactionMode === "plan" ? { interactionMode: "plan" as const } : {}),
      commandId: input.message.messageId,
    });
  };

/** Stop names the turn the view draws (a card); the engine stops the run that works on it. */
export const engineInterruptTurn =
  (environmentId: string, input: Command<"thread.turn.interrupt">) => (host: MateEngineHost) =>
    host.operations.stop({
      environmentId,
      conversationId: input.threadId,
      ...(input.turnId === undefined
        ? {}
        : {
            runId: engineStopTarget(
              readsOfState(host.store.state()),
              { environmentId, conversationId: input.threadId },
              input.turnId,
            ),
          }),
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

/** A question's answer: its words and the pictures attached to each question, by reference. */
export const engineRespondToUserInput =
  (environmentId: string, input: Command<"thread.user-input.respond">) => (host: MateEngineHost) =>
    host.operations.answer({
      environmentId,
      conversationId: input.threadId,
      requestId: input.requestId,
      answer: {
        kind: "input",
        answers: input.answers,
        ...(input.attachmentsByQuestionId === undefined
          ? {}
          : { attachmentsByQuestionId: input.attachmentsByQuestionId }),
      },
      summary: "Answered",
    });

/** A question closed unanswered: the engine takes it only when its agent does not wait on it. */
export const engineDismissUserInput =
  (environmentId: string, input: Command<"thread.user-input.dismiss">) => (host: MateEngineHost) =>
    host.operations.dismiss({
      environmentId,
      conversationId: input.threadId,
      requestId: input.requestId,
    });

const refused = (message: string) =>
  Effect.fail(new EngineOperationFailed({ outcome: "refused", message }));

const sameOptions = (left: unknown, right: unknown) =>
  JSON.stringify(left ?? []) === JSON.stringify(right ?? []);

/**
 * A thread's metadata on an engine conversation: its title is never sent (the engine generates
 * none; the menu's subject is the person's latest message), another agent goes as the engine's
 * agent pick (the engine refuses one it cannot run the conversation on, in V1's words), a model or
 * effort change on the agent it runs as the engine's model switch with its options, and a branch
 * or worktree — which the engine does not take — is refused in words.
 */
export const engineUpdateMetadata =
  (environmentId: string, input: Command<"thread.meta.update">) =>
  (host: MateEngineHost): Effect.Effect<EngineAcceptance, EngineOperationFailed> => {
    if (
      input.branch !== undefined ||
      input.worktreePath !== undefined ||
      input.expectedBranch !== undefined ||
      input.expectedWorktreePath !== undefined ||
      input.linkedPullRequest !== undefined
    )
      return refused("A branch or worktree is not something this Mate's engine takes yet.");
    const selection = input.modelSelection;
    if (selection === undefined) return Effect.succeed({ seq: 0 });
    const conversation = host.store
      .state()
      .facts.get(
        `mateEngineConversation:${engineConversationId({ environmentId, conversationId: input.threadId })}`,
      )?.content;
    if (conversation?.kind !== "value")
      return refused("Open this conversation before changing its model.");
    const { header } = conversation.value as { readonly header: ConversationHeader };
    const agent = header.agent;
    const options = selection.options === undefined ? {} : { options: selection.options };
    if (agent === null || selection.instanceId !== agent.instanceId)
      return host.operations.assignAgent({
        environmentId,
        conversationId: input.threadId,
        instanceId: selection.instanceId,
        model: selection.model,
        ...options,
      });
    if (
      selection.model === (header.model ?? agent.model ?? null) &&
      sameOptions(selection.options, agent.options)
    )
      return Effect.succeed({ seq: 0 });
    return host.operations.switchModel({
      environmentId,
      conversationId: input.threadId,
      model: selection.model,
      ...options,
    });
  };

/** How freely the agent works, set on the engine conversation: it applies from the next run on. */
export const engineSetRuntimeMode =
  (environmentId: string, input: Command<"thread.runtime-mode.set">) => (host: MateEngineHost) =>
    host.operations.setRuntimeMode({
      environmentId,
      conversationId: input.threadId,
      runtimeMode: input.runtimeMode,
    });

/**
 * Plan mode on an engine conversation goes with each message (`engineStartTurn`): there is no
 * thread-wide mode to set, so nothing is sent and nothing is lost.
 */
export const engineSetInteractionMode = () => Effect.succeed<EngineAcceptance>({ seq: 0 });
