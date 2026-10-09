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
  type ModelCapabilities,
  type ModelSelection,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
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
  engineResendId,
  engineSteerTarget,
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
 * A turn's start as the engine's send or steer: the message's own id is the command id. A send
 * carries its files and pictures, and its interaction mode with it (the engine keeps no
 * thread-wide mode).
 */
export const engineStartTurn =
  (environmentId: string, input: Command<"thread.turn.start">) => (host: MateEngineHost) => {
    const attachments = input.message.attachments.filter(isReferenced);
    if (attachments.length !== input.message.attachments.length)
      return Effect.fail(
        new EngineOperationFailed({ outcome: "refused", message: PICTURES_BY_REFERENCE }),
      );
    const target = { environmentId, conversationId: input.threadId };
    const send = (commandId: string) =>
      host.operations.send({
        ...target,
        text: input.message.text,
        attachments,
        ...(input.interactionMode === "plan" ? { interactionMode: "plan" as const } : {}),
        commandId,
      });
    // Into the run that works, as V1 sends a message into its running turn; files, pictures and a
    // plan go as the next run, since a steer carries words only (the run keeps the mode it began in).
    const steered =
      attachments.length === 0 && input.interactionMode !== "plan"
        ? engineSteerTarget(readsOfState(host.store.state()), target)
        : null;
    if (steered === null) return send(input.message.messageId);
    return host.operations
      .steer({
        ...target,
        runId: steered,
        text: input.message.text,
        commandId: input.message.messageId,
      })
      .pipe(
        // The run ended (or its session changed) before the steer arrived: as V1 starts a new turn,
        // the message goes as the next run — never refused as if it were a Stop.
        Effect.catchIf(
          (failure) => failure.outcome === "refused" && STEER_MISSED.has(failure.code ?? ""),
          () => send(engineResendId(input.message.messageId)),
        ),
      );
  };

/** The engine's refusals of a steer that mean the run it aimed at no longer takes one. */
const STEER_MISSED: ReadonlySet<string> = new Set(["run-not-running", "steer-unsupported"]);

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

export const engineSetArchived =
  (
    environmentId: string,
    input: Command<"thread.archive"> | Command<"thread.unarchive">,
    archived: boolean,
  ) =>
  (host: MateEngineHost) =>
    host.operations.setArchived({ environmentId, conversationId: input.threadId, archived });

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

/** An option left out is the driver's default: a select's default choice, a switch off. */
const defaultOf = (descriptor: ProviderOptionDescriptor): string | boolean | undefined =>
  descriptor.type === "boolean"
    ? (descriptor.currentValue ?? false)
    : (descriptor.currentValue ?? descriptor.options.find((choice) => choice.isDefault)?.id);

type OptionValue = ProviderOptionSelection["value"];

/** Each option's value as the agent runs it: one left out is the driver's default for the model. */
const optionValuesOf = (
  capabilities: ModelCapabilities | null | undefined,
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
) => {
  const values = new Map<string, OptionValue | undefined>(
    (capabilities?.optionDescriptors ?? []).map((descriptor) => [
      descriptor.id,
      defaultOf(descriptor),
    ]),
  );
  for (const option of options ?? []) values.set(option.id, option.value);
  return values;
};

/**
 * The option ids a selection really changes on the agent a conversation runs: an option either
 * side leaves out is the driver's default for the model, and their order means nothing. Without
 * the model's capabilities only what both sides spell out can be judged the same.
 */
export function changedModelOptionIds(
  capabilities: ModelCapabilities | null | undefined,
  current: ReadonlyArray<ProviderOptionSelection> | undefined,
  next: ReadonlyArray<ProviderOptionSelection> | undefined,
): ReadonlyArray<string> {
  const before = optionValuesOf(capabilities, current);
  const after = optionValuesOf(capabilities, next);
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (id) => before.get(id) !== after.get(id),
  );
}

/** The current options with the changed ones set to the values the next selection runs. */
const withChanges = (
  capabilities: ModelCapabilities | null | undefined,
  current: ReadonlyArray<ProviderOptionSelection> | undefined,
  next: ReadonlyArray<ProviderOptionSelection> | undefined,
  changed: ReadonlyArray<string>,
): ReadonlyArray<ProviderOptionSelection> => {
  const after = optionValuesOf(capabilities, next);
  return [
    ...(current ?? []).filter((option) => !changed.includes(option.id)),
    ...changed.flatMap((id) => {
      const value = after.get(id);
      return value === undefined ? [] : [{ id, value }];
    }),
  ];
};

/** What a selection's model takes, as the Mate's providers report it; null until they are read. */
export function modelCapabilitiesIn(
  providers: ReadonlyArray<ServerProvider> | null,
  selection: ModelSelection,
): ModelCapabilities | null {
  const provider = providers?.find((candidate) => candidate.instanceId === selection.instanceId);
  if (provider === undefined) return null;
  const slug = resolveSelectableModel(provider.driver, selection.model, provider.models);
  return provider.models.find((model) => model.slug === slug)?.capabilities ?? null;
}

/**
 * A thread's metadata on an engine conversation: its title is never sent (the engine generates
 * none; the menu's subject is the person's latest message), another agent goes as the engine's
 * agent pick (the engine refuses one it cannot run the conversation on, in V1's words), a model or
 * an option really changed on the agent it runs as the engine's model switch, and a branch or
 * worktree — which the engine does not take — is refused in words. An option either side leaves
 * out is the driver's default: an unchanged selection sends nothing.
 */
export const engineUpdateMetadata =
  (
    environmentId: string,
    input: Command<"thread.meta.update">,
    capabilitiesOf: (selection: ModelSelection) => ModelCapabilities | null = () => null,
  ) =>
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
    if (agent === null || selection.instanceId !== agent.instanceId)
      return host.operations.assignAgent({
        environmentId,
        conversationId: input.threadId,
        instanceId: selection.instanceId,
        model: selection.model,
        ...(selection.options === undefined ? {} : { options: selection.options }),
      });
    const capabilities = capabilitiesOf(selection);
    const changed = changedModelOptionIds(capabilities, agent.options, selection.options);
    if (selection.model === (header.model ?? agent.model ?? null) && changed.length === 0)
      return Effect.succeed({ seq: 0 });
    return host.operations.switchModel({
      environmentId,
      conversationId: input.threadId,
      model: selection.model,
      // The conversation's options with only what really changed: the engine's session never
      // reopens for an option the person left as it was.
      ...(changed.length === 0
        ? {}
        : { options: withChanges(capabilities, agent.options, selection.options, changed) }),
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
