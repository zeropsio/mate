/**
 * ZeropsBootstrapModel - which provider the auto-bootstrapped first thread
 * opens on inside a Zerops project container.
 *
 * Upstream hardcodes Codex for the thread the server creates from the CWD on
 * first boot. That holds on a laptop, where Codex is the CLI most users have
 * logged in. It does not hold in a Zerops container: the image ships several
 * agent CLIs and the one the user actually signed into is usually Claude Code,
 * so the very first screen greets them with "Codex is unauthenticated" and a
 * thread that cannot take a turn until they change the model by hand.
 *
 * The rule here is deliberately a pure function over the provider snapshots
 * the registry already publishes, so it is decided by observable state
 * (`status` / `auth` / `models`) rather than by guessing from the environment.
 * When nothing is ready it returns `undefined` and the caller keeps upstream's
 * value - the thread still exists and shows that provider's own sign-in
 * banner, which is a better landing than no thread at all.
 *
 * The agent a Mate's main conversation is given for a person
 * (`mainConversationAgent`) is the same question's: the stand-up and zcp's
 * failed verdict both give it by this one function.
 *
 * Scope: this module is only consulted inside a Zerops container
 * (`isZeropsEnvironment`). Everywhere else the upstream default is returned
 * byte-identical.
 *
 * @module ZeropsBootstrapModel
 */
import {
  agentIdForProviderInstance,
  type ConversationAgent,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  defaultInstanceIdForAgent,
  driverKindForAgent,
  type ModelSelection,
  type OrchestrationThreadShell,
  ProviderInstanceId,
  type ServerProvider,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import { standsInForSignIn } from "@t3tools/shared/openCodeKeyProviders";
import { selectionWithPreferredEffort } from "@t3tools/shared/zeropsEffort";

/**
 * The model the bootstrap thread opens on for one instance.
 *
 * The manifest default wins when the live snapshot actually offers it, so a
 * Zerops container lands on the same model upstream would pick for that
 * provider. Otherwise the snapshot decides - its own `isDefault` flag first,
 * then whatever it lists first - because a slug the CLI does not serve is
 * worse than a second-choice one it does.
 */
export const resolveBootstrapModelSlug = (snapshot: ServerProvider): string => {
  const manifestDefault = DEFAULT_MODEL_BY_PROVIDER[snapshot.driver];
  if (manifestDefault !== undefined && snapshot.models.some((m) => m.slug === manifestDefault)) {
    return manifestDefault;
  }
  const flagged = snapshot.models.find((m) => m.isDefault === true);
  if (flagged !== undefined) {
    return flagged.slug;
  }
  return snapshot.models[0]?.slug ?? manifestDefault ?? DEFAULT_MODEL;
};

/**
 * The ready instance of an agent Mate signs nobody in to that stands in for the person's sign-in
 * (`standsInForSignIn`: OpenCode on a key they set, or on its free models only once they chose
 * them as `defaultModel`): `current`, the conversation's own, when it is one of them, else the
 * first in the registry's order; `undefined` when none is. The agents people sign in to never
 * answer here: on a Zerops project their sign-in is the feed's to say, and the person's (D6).
 */
export const pickReadyAgentWithoutSignIn = (
  providers: ReadonlyArray<ServerProvider>,
  /** The Mate's default model (its settings' `defaultModelSelection`). */
  defaultModel: ModelSelection | null,
  current?: ProviderInstanceId,
): ServerProvider | undefined => {
  const ready = providers.filter((provider) => standsInForSignIn(provider, defaultModel));
  return ready.find((snapshot) => snapshot.instanceId === current) ?? ready[0];
};

/**
 * The model a conversation runs on for an agent the person signed in: the conversation's own when
 * it is on that agent, else the project's default on that agent, else that agent's default model —
 * what the person's composer would send.
 */
const selectionOnAgent = (
  agentId: ZeropsAgentId,
  thread: Pick<OrchestrationThreadShell, "modelSelection"> | undefined,
  projectDefault: ModelSelection | null,
): ModelSelection => {
  if (
    thread !== undefined &&
    agentIdForProviderInstance(thread.modelSelection.instanceId) === agentId
  ) {
    return thread.modelSelection;
  }
  if (
    projectDefault !== null &&
    agentIdForProviderInstance(projectDefault.instanceId) === agentId
  ) {
    return projectDefault;
  }
  return {
    instanceId: defaultInstanceIdForAgent(agentId),
    model: DEFAULT_MODEL_BY_PROVIDER[driverKindForAgent(agentId)] ?? DEFAULT_MODEL,
  };
};

/**
 * The model a conversation runs on when it runs on a ready agent Mate signs nobody in to: the
 * conversation's own when it is on that instance, else the project's default there, else the
 * model a new conversation would open on it (`resolveBootstrapModelSlug`).
 */
const selectionOnInstance = (
  provider: ServerProvider,
  thread: Pick<OrchestrationThreadShell, "modelSelection"> | undefined,
  projectDefault: ModelSelection | null,
): ModelSelection => {
  if (thread !== undefined && thread.modelSelection.instanceId === provider.instanceId) {
    return thread.modelSelection;
  }
  if (projectDefault !== null && projectDefault.instanceId === provider.instanceId) {
    return projectDefault;
  }
  return { instanceId: provider.instanceId, model: resolveBootstrapModelSlug(provider) };
};

/**
 * What the choice reads of a conversation (the engine's view of it): its agent, and whether it ran
 * or holds anything.
 */
export interface ConversationFacts {
  readonly agent: ConversationAgent | null;
  readonly activeRun: object | null;
  readonly lastEnded: object | null;
  readonly queued: ReadonlyArray<object>;
}

/** The model a conversation runs on, where its agent names one. */
export const conversationSelection = (
  view: Pick<ConversationFacts, "agent"> | undefined,
): Pick<OrchestrationThreadShell, "modelSelection"> | undefined =>
  view?.agent === null || view?.agent === undefined || view.agent.model === null
    ? undefined
    : {
        modelSelection: {
          instanceId: ProviderInstanceId.make(view.agent.instanceId),
          model: view.agent.model,
          ...(view.agent.options === undefined ? {} : { options: view.agent.options }),
        },
      };

/** The Mate's agent on a selection: the instance, its driver, the model and its options. */
const mateAgentOn = (
  selection: ModelSelection,
  providers: ReadonlyArray<ServerProvider>,
): ConversationAgent => {
  const options = Array.isArray(selection.options) ? selection.options : undefined;
  return {
    instanceId: selection.instanceId,
    driver:
      providers.find((provider) => provider.instanceId === selection.instanceId)?.driver ??
      selection.instanceId,
    model: selection.model,
    ...(options === undefined || options.length === 0 ? {} : { options }),
    profile: { kind: "mate" },
  };
};

/**
 * The agent the Mate's main conversation is given for a person, whether or not it exists yet: the
 * first agent they may run (`standUpAgents`, in its order), else `ready`, a ready agent
 * Mate signs nobody in to; on the conversation's own model where it is on that agent, else the
 * project's default there, else the agent's default — an automated Mate's on its organization's
 * model. A conversation that has run nothing starts on Extra High unless its model names an effort
 * (D10). None where the person has no agent to run.
 */
export const mainConversationAgent = (input: {
  /** The conversation, where it exists. */
  readonly conversation: ConversationFacts | undefined;
  /** The agents the person may run, the one to choose first (`standUpAgents`). */
  readonly agents: ReadonlyArray<ZeropsAgentId>;
  /** A ready agent Mate signs nobody in to (`pickReadyAgentWithoutSignIn`), where one stands in. */
  readonly ready: ServerProvider | undefined;
  /** The project's default model, where a V1 project still holds one. */
  readonly projectDefault: ModelSelection | null;
  /** An automated Mate's organization's model; none on an ordinary Mate. */
  readonly automatedModel: ModelSelection | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
}): ConversationAgent | undefined => {
  const { conversation, projectDefault, automatedModel, providers } = input;
  const thread = conversationSelection(conversation);
  const agentId = input.agents[0];
  const chosen =
    agentId !== undefined
      ? (automatedModel ?? selectionOnAgent(agentId, thread, projectDefault))
      : input.ready !== undefined
        ? (automatedModel ?? selectionOnInstance(input.ready, thread, projectDefault))
        : undefined;
  if (chosen === undefined) return undefined;
  const unstarted =
    conversation === undefined ||
    (conversation.activeRun === null &&
      conversation.lastEnded === null &&
      conversation.queued.length === 0);
  return mateAgentOn(
    unstarted ? selectionWithPreferredEffort(providers, chosen) : chosen,
    providers,
  );
};
