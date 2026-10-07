/**
 * The dark launch's façade (coexist §4.2): a conversation the Mate engine holds, as the V1 thread
 * shell HQ's overview and the Mate's attention already read — its run mapped onto V1's literals
 * and nothing else — so HQ needs no change while a Mate runs the engine. In mate mode these shells
 * are the only chats the link and the attention read: a thread V1 left running at the flip is not
 * among them, so it never shows working.
 *
 * Pure: the caller reads the engine's views.
 *
 * @module engineOverview
 */
import {
  ConversationId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationLatestTurn,
  type OrchestrationSession,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  brokeOffLine,
  type ConversationView,
  type MateEngineService,
  type ViewRun,
} from "../engine/MateEngine.ts";

/** The project an engine conversation's shell names: the engine keeps no V1 project. */
export const ENGINE_PROJECT_ID = ProjectId.make("mate-engine");

const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

/** A text a shell holds, which the contract never lets be empty: its first line, trimmed. */
const lineOf = (text: string | undefined): string | null => {
  const line = text
    ?.split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line === undefined ? null : line;
};

/** The run a shell's latest turn is: the one on, else the next queued, else the last that ended. */
const latestRunOf = (view: ConversationView): ViewRun | null =>
  view.activeRun ?? view.queued[0] ?? view.lastEnded;

const BEFORE_START: ReadonlySet<string> = new Set(["queued", "admitted", "sending"]);

/** A run's turn in V1's literals: on (`running`), or how it ended. */
const turnOf = (run: ViewRun): OrchestrationLatestTurn => {
  const turn = {
    turnId: TurnId.make(run.id),
    requestedAt: iso(run.queuedAt),
    startedAt: run.startedAt === null ? null : iso(run.startedAt),
    assistantMessageId: null,
  };
  if (run.end === null) return { ...turn, state: "running", completedAt: null };
  const completedAt = run.endedAt === null ? null : iso(run.endedAt);
  switch (run.end.kind) {
    case "completed":
      return { ...turn, state: "completed", completedAt };
    case "failed":
    case "crashed":
      return { ...turn, state: "error", completedAt };
    default:
      return { ...turn, state: "interrupted", completedAt };
  }
};

/** The session in V1's literals: starting until sent, running while on, ready or error after. */
const sessionOf = (view: ConversationView, run: ViewRun, at: string): OrchestrationSession => {
  const base = {
    threadId: ThreadId.make(view.conversationId),
    providerName: view.agent?.driver ?? null,
    ...(view.agent === null
      ? {}
      : { providerInstanceId: ProviderInstanceId.make(view.agent.instanceId) }),
    runtimeMode: "full-access" as const,
    activeTurnId: view.activeRun === null ? null : TurnId.make(view.activeRun.id),
    updatedAt: at,
  };
  if (run.end === null) {
    return {
      ...base,
      status: BEFORE_START.has(run.state) ? "starting" : "running",
      lastError: null,
    };
  }
  const brokeOff = lineOf(brokeOffLine(run.end) ?? undefined);
  return brokeOff === null
    ? { ...base, status: "ready", lastError: null }
    : { ...base, status: "error", lastError: brokeOff };
};

/** The engine conversation as a V1 thread shell, for HQ's overview and the Mate's attention. */
export const engineShellOf = (view: ConversationView): OrchestrationThreadShell => {
  const at = iso(view.updatedAt);
  const run = latestRunOf(view);
  const asked = view.openRequests.filter((request) => request.runId === view.activeRun?.id);
  const question = asked.find((request) => request.ask.kind === "question");
  const firstQuestion =
    question?.ask.kind === "question"
      ? (question.ask.questions[0] as { readonly question?: unknown } | undefined)?.question
      : undefined;
  const person = view.lastPerson;
  const agent = view.lastAgent;
  const personLine = lineOf(person?.text);
  const agentText = agent?.text.trim() ?? "";
  const latest =
    agent !== null && agentText !== "" && (person === null || agent.at >= person.at)
      ? { role: "assistant" as const, text: agentText, createdAt: iso(agent.at) }
      : person !== null && person.text.trim() !== ""
        ? { role: "user" as const, text: person.text.trim(), createdAt: iso(person.at) }
        : null;
  const call = view.liveCall;
  return {
    id: ThreadId.make(view.conversationId),
    projectId: ENGINE_PROJECT_ID,
    title: personLine ?? "New thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make(view.agent?.instanceId ?? "claudeAgent"),
      model: view.agent?.model ?? DEFAULT_MODEL,
    },
    runtimeMode: "full-access",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: run === null ? null : turnOf(run),
    createdAt: iso(view.createdAt),
    updatedAt: at,
    archivedAt: view.archived ? at : null,
    settledOverride: null,
    settledAt: null,
    session: run === null ? null : sessionOf(view, run, at),
    latestUserMessageAt: person === null ? null : iso(person.at),
    latestMessagePreview: latest,
    latestUserMessagePreview:
      person === null || person.text.trim() === ""
        ? null
        : { role: "user", text: person.text.trim(), createdAt: iso(person.at) },
    hasPendingApprovals: asked.some((request) => request.ask.kind === "approval"),
    hasPendingUserInput: asked.some((request) => request.ask.kind !== "approval"),
    hasActionableProposedPlan: false,
    backgroundLiveness: view.activeRun === null ? view.background : null,
    pendingQuestion: typeof firstQuestion === "string" ? lineOf(firstQuestion) : null,
    usagePause:
      typeof view.pausedUntil === "number"
        ? {
            resetsAt: iso(view.pausedUntil),
            window: "usage",
            held: 0,
            pausedAt: iso(view.lastEnded?.endedAt ?? view.updatedAt),
            autoResume: true,
          }
        : null,
    ...(call === null || view.activeRun?.state !== "running"
      ? {}
      : {
          liveStep: {
            kind: "calls" as const,
            since: iso(call.at),
            calls: [
              {
                id: `${view.activeRun.id}.call`,
                activityKind: "tool.updated",
                itemType: "dynamic_tool_call",
                title: lineOf(call.words ?? undefined) ?? call.tool,
                toolName: call.tool,
                startedAt: iso(call.at),
              },
            ],
          },
        }),
  };
};

/** Where HQ's overview and the attention read the Mate's chats, and learn that they moved. */
export interface ChatsSource<E> {
  readonly threads: Effect.Effect<ReadonlyArray<OrchestrationThreadShell>, E>;
  readonly domainEvents: Stream.Stream<unknown>;
}

/**
 * The Mate's chats: the engine's conversations, and their commits, while the engine owns the
 * conversation; V1's otherwise, exactly as before.
 */
export const chatsSource = <E>(engine: MateEngineService, v1: ChatsSource<E>): ChatsSource<E> =>
  engine.live
    ? {
        threads: Effect.map(engine.conversations, (views) => views.map(engineShellOf)),
        domainEvents: engine.changes,
      }
    : v1;

/**
 * The attention's reads over the engine: its conversations as one project's chats, each read
 * again when its record moves.
 */
export const engineAttentionReads = (engine: MateEngineService) => ({
  project: Effect.succeed(Option.some(ENGINE_PROJECT_ID)),
  threadsOf: () => Effect.map(engine.conversations, (views) => views.map(engineShellOf)),
  thread: (id: ThreadId) =>
    Effect.map(engine.conversation(ConversationId.make(id)), (view) =>
      view === undefined || view.archived ? Option.none() : Option.some(engineShellOf(view)),
    ),
  domainEvents: Stream.map(engine.changes, (conversation) => ({
    aggregateKind: "thread" as const,
    aggregateId: ThreadId.make(conversation),
  })),
});
