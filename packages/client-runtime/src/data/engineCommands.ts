/**
 * The thread commands a conversation's view already sends — start a turn, interrupt it, answer an
 * approval or a question, dismiss a question — routed per Mate: through the account's engine operations when the
 * Mate's door named an engine protocol this build speaks, else unchanged over V1. The view keeps
 * its calls; the Mate decides the wire.
 *
 * @module data/engineCommands
 */
import {
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
import { EFFORT_OPTION_IDS } from "@t3tools/shared/zeropsEffort";
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
  engineSteerTarget,
  engineStopTarget,
} from "./projections/mateEngine.ts";
import { readsOfState } from "./store.ts";

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

/** A picture already in the Mate's asset store: the engine takes pictures by reference only. */
const isReferencedPicture = Schema.is(ChatImageAttachment);

const PICTURES_BY_REFERENCE =
  "Pictures reach this Mate once they are uploaded; send the words, then the pictures again.";

/** A turn's start as the engine's send or steer: the message's own id is the command id. */
export const engineStartTurn =
  (environmentId: string, input: Command<"thread.turn.start">) => (host: MateEngineHost) => {
    const attachments = input.message.attachments.filter(isReferencedPicture);
    if (attachments.length !== input.message.attachments.length)
      return Effect.fail(
        new EngineOperationFailed({ outcome: "refused", message: PICTURES_BY_REFERENCE }),
      );
    const target = { environmentId, conversationId: input.threadId };
    // Into the run that works, as V1 sends a message into its running turn; pictures go as the
    // next run, since a steer carries words only.
    const steered =
      attachments.length === 0 ? engineSteerTarget(readsOfState(host.store.state()), target) : null;
    if (steered !== null)
      return host.operations.steer({
        ...target,
        runId: steered,
        text: input.message.text,
        commandId: input.message.messageId,
      });
    return host.operations.send({
      ...target,
      text: input.message.text,
      attachments,
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

/** What an option is called to a person: any agent's effort is its effort, else its own label. */
const optionWords = (id: string, descriptor: ProviderOptionDescriptor | undefined) =>
  EFFORT_OPTION_IDS.has(id) ? "effort" : (descriptor?.label ?? id);

/** An option left out is the driver's default: a select's default choice, a switch off. */
const defaultOf = (descriptor: ProviderOptionDescriptor): string | boolean | undefined =>
  descriptor.type === "boolean"
    ? (descriptor.currentValue ?? false)
    : (descriptor.currentValue ?? descriptor.options.find((choice) => choice.isDefault)?.id);

/**
 * The options a selection really changes on the agent a conversation runs, in words: an option
 * either side leaves out is the driver's default for the model, and their order means nothing.
 * Without the model's capabilities only what both sides spell out can be judged the same.
 */
export function changedModelOptions(
  capabilities: ModelCapabilities | null | undefined,
  current: ReadonlyArray<ProviderOptionSelection> | undefined,
  next: ReadonlyArray<ProviderOptionSelection> | undefined,
): ReadonlyArray<string> {
  const descriptors = capabilities?.optionDescriptors ?? [];
  const valuesOf = (options: ReadonlyArray<ProviderOptionSelection> | undefined) => {
    const values = new Map<string, string | boolean | undefined>(
      descriptors.map((descriptor) => [descriptor.id, defaultOf(descriptor)]),
    );
    for (const option of options ?? []) values.set(option.id, option.value);
    return values;
  };
  const before = valuesOf(current);
  const after = valuesOf(next);
  const ids = [...new Set([...before.keys(), ...after.keys()])];
  return ids
    .filter((id) => before.get(id) !== after.get(id))
    .map((id) =>
      optionWords(
        id,
        descriptors.find((descriptor) => descriptor.id === id),
      ),
    )
    .filter((words, index, all) => all.indexOf(words) === index);
}

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

/** The refusal for an options change the engine does not take yet, naming what changed. */
const optionsChangeWords = (changed: ReadonlyArray<string>) => {
  const named = changed.join(" or ");
  const article = /^[aeiou]/i.test(named) ? "an" : "a";
  const kept = named === "effort" ? "the effort" : named;
  return `This Mate's engine does not take ${article} ${named} change yet; keep ${kept} as it was.`;
};

/**
 * A thread's metadata on an engine conversation: its title is never sent (the engine generates
 * none; the menu's subject is the person's latest message), a model change on the agent the
 * conversation runs goes as the engine's model switch, and anything the engine does not take —
 * another agent, a model option really changed, a branch or worktree — is refused in words.
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
    if (agent !== null && selection.instanceId !== agent.instanceId)
      return refused(
        "This Mate's engine runs one agent per conversation; switch the model, not the agent.",
      );
    const changed =
      agent === null
        ? []
        : changedModelOptions(capabilitiesOf(selection), agent.options, selection.options);
    if (changed.length > 0) return refused(optionsChangeWords(changed));
    if (selection.model === (header.model ?? agent?.model ?? null))
      return Effect.succeed({ seq: 0 });
    return host.operations.switchModel({
      environmentId,
      conversationId: input.threadId,
      model: selection.model,
    });
  };

/** The engine takes neither mode: the workspace sets the runtime mode, and there is no plan mode. */
export const engineModeChange = (mode: "runtime" | "interaction") => () =>
  refused(
    mode === "runtime"
      ? "This Mate's engine takes its runtime mode from its workspace; it cannot be changed here."
      : "This Mate's engine has no plan mode yet; send the message as it is.",
  );
