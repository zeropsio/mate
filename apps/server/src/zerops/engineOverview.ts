/**
 * The dark launch's façade (coexist §4.2): a conversation the Mate engine holds, as the V1 thread
 * shell HQ's overview and the Mate's attention already read — its run mapped onto V1's literals
 * and nothing else — so HQ needs no change. These shells are the only chats the link and the
 * attention read: a thread V1 left running at the flip is not among them, so it never shows
 * working.
 *
 * Pure: the caller reads the engine's views.
 *
 * @module engineOverview
 */
import {
  ConversationId,
  DEFAULT_MODEL,
  isCardAsk,
  MATE_ENGINE_PROTOCOLS,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ConversationRow,
  type OrchestrationLatestTurn,
  type OrchestrationSession,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { messagePreviewText } from "@t3tools/shared/messagePreview";
import { userAskPreviewText } from "@t3tools/shared/userAsk";

import {
  brokeOffLine,
  conversationRowOf,
  rowStateOf,
  type ConversationView,
  type MateEngineService,
  type ViewRun,
} from "../engine/MateEngine.ts";
import { TASKS_CONVERSATION_ID, taskIdOfConversation, taskQuestionOf } from "./ZeropsTasks.ts";

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

/**
 * What a conversation is called: the person's first line that has words once its markdown is read,
 * as plain words (`messagePreviewText`), as the engine's row says its subject. A raw line put
 * backticks in the menu's subject (Milo's stress run 5).
 */
const titleOf = (text: string | undefined): string | null => {
  for (const line of text?.split("\n") ?? []) {
    const words = messagePreviewText(line);
    if (words !== null) return words;
  }
  return null;
};

/**
 * The run a shell's latest turn is: the one on; while a usage limit holds the queue, the run it
 * ended (a held message is not working); else the next queued, else the last that ended.
 */
const latestRunOf = (view: ConversationView): ViewRun | null =>
  view.activeRun ??
  (view.pausedUntil !== null ? view.lastEnded : (view.queued[0] ?? view.lastEnded));

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
  if (run.end.kind === "cut-by-restart") {
    return { ...base, status: "ready", lastError: null };
  }
  const brokeOff = lineOf(brokeOffLine(run.end) ?? undefined);
  return brokeOff === null
    ? { ...base, status: "ready", lastError: null }
    : { ...base, status: "error", lastError: brokeOff };
};

/** The engine conversation as a V1 thread shell, for HQ's overview and the Mate's attention. */
/** The row waits on an ask on a card (`rowStateOf`): the one rule for needs you. */
const waitsOnCard = (view: ConversationView): boolean => {
  const state = rowStateOf(view);
  return state.kind === "waiting" && isCardAsk(state.on);
};

/** Whether the run is a task's: in the tasks' one conversation, its runs' principal says so. */
const isTaskRun = (run: ViewRun | null): boolean => run?.principal.kind === "task";

/**
 * The agent's words as a summary: a task's agent asking a person ends on a `QUESTION:` line the
 * task's source shows; a summary drops it, or reads the question alone when nothing came before.
 * In the tasks' one conversation the words are a task's when its latest run is.
 */
const summaryOf = (view: ConversationView, text: string): string => {
  const ofTask =
    taskIdOfConversation(view.conversationId) !== undefined ||
    (view.conversationId === TASKS_CONVERSATION_ID && isTaskRun(latestRunOf(view)));
  if (!ofTask) return text;
  const { question, rest } = taskQuestionOf(text);
  return question === undefined || rest !== "" ? rest : question;
};

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
  // Its title, from what the person typed: a page's request for them never names it. The tasks'
  // one conversation is named by the task at work (its brief's first line), and Tasks between.
  const personLine =
    view.conversationId === TASKS_CONVERSATION_ID
      ? view.activeRun !== null || view.queued.length > 0
        ? (titleOf(view.lastAsked?.text) ?? "Tasks")
        : "Tasks"
      : titleOf(view.lastAsked?.text);
  // Each message as V1's shell previews it (`threadMessagePreviewFromSource`).
  const agentText = agent === null ? null : messagePreviewText(summaryOf(view, agent.text));
  const personText = person === null ? null : userAskPreviewText(person);
  const latest =
    agent !== null && agentText !== null && (person === null || agent.at >= person.at)
      ? { role: "assistant" as const, text: agentText, createdAt: iso(agent.at) }
      : person !== null && personText !== null
        ? { role: "user" as const, text: personText, createdAt: iso(person.at) }
        : null;
  const call = view.liveCall;
  // A crewmate's conversation is its crew's: it speaks through the crew, never as a chat of the
  // person's (`crew-<crew>-<handle>-<n>`).
  const profile = view.agent?.profile;
  const crewmate = profile?.kind === "crewmate" ? profile : undefined;
  return {
    ...(crewmate === undefined
      ? {}
      : {
          crew: {
            crew: view.conversationId.split("-")[1] ?? "main",
            crewmate: crewmate.id,
            stint: 1,
          } as OrchestrationThreadShell["crew"],
        }),
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
    // The pool container its agent leased: never its worktree, which T3 removes with the thread.
    lease: view.lease ?? null,
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
      person === null || personText === null
        ? null
        : { role: "user", text: personText, createdAt: iso(person.at) },
    hasPendingApprovals: asked.some((request) => request.ask.kind === "approval"),
    // An ask on a card outlives the turn that asked: the row waits on it, and so does every face
    // and list read off this shell, until the person answers it.
    hasPendingUserInput:
      asked.some((request) => request.ask.kind !== "approval") || waitsOnCard(view),
    hasActionableProposedPlan: false,
    // Nothing on, but the work goes on: its helpers or jobs, or a turn due at once (a finished
    // job's, an answered value's): the row's word, so the attention never counts it at rest
    // between the two (Milo's recheck: the face read idle for 27 ms after a Vault answer).
    backgroundLiveness:
      view.activeRun !== null
        ? null
        : (view.background ?? (rowStateOf(view).kind === "working" ? "working" : null)),
    pendingQuestion: typeof firstQuestion === "string" ? lineOf(firstQuestion) : null,
    usagePause:
      typeof view.pausedUntil === "number"
        ? {
            resetsAt: iso(view.pausedUntil),
            window: "usage",
            held: view.queued.length,
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

/** The archive's shell format, including the project Settings uses to group its rows. */
export const engineArchiveSnapshotOf = (
  archived: Effect.Success<ReturnType<MateEngineService["wire"]["readArchived"]>>,
  workspaceRoot: string,
): OrchestrationShellSnapshot => {
  const threads = archived.map(({ view, archivedAt }) => ({
    ...engineShellOf(view),
    archivedAt,
  }));
  const updatedAt = threads.reduce(
    (latest, thread) => (thread.updatedAt > latest ? thread.updatedAt : latest),
    "1970-01-01T00:00:00.000Z",
  );
  return {
    snapshotSequence: 0,
    projects:
      threads.length === 0
        ? []
        : [
            {
              id: ENGINE_PROJECT_ID,
              title: "Mate",
              workspaceRoot,
              defaultModelSelection: null,
              scripts: [],
              createdAt: threads.reduce(
                (earliest, thread) => (thread.createdAt < earliest ? thread.createdAt : earliest),
                updatedAt,
              ),
              updatedAt,
            },
          ],
    threads,
    updatedAt,
  };
};

/** Where HQ's overview and the attention read the Mate's chats, and learn that they moved. */
export interface ChatsSource<E> {
  readonly threads: Effect.Effect<ReadonlyArray<OrchestrationThreadShell>, E>;
  readonly domainEvents: Stream.Stream<unknown>;
  /** The engine's own rows of the person's conversations. */
  readonly conversations: Effect.Effect<ReadonlyArray<ConversationRow>, E>;
  /** The engine the rows are of, by the protocol they speak. */
  readonly engine: { readonly protocol: number; readonly taskAssignments?: 1 };
}

/** The Mate's environment and this start's epoch: the revision every engine row carries. */
export type RowRevision = { readonly environmentId: string; readonly epoch: number };

/**
 * The Mate's chats: the engine's conversations, and their commits — as the façade's thread shells
 * and as the engine's own rows at `revision`.
 */
export const chatsSource = (
  engine: MateEngineService,
  revision: Effect.Effect<RowRevision>,
): ChatsSource<never> => ({
  threads: Effect.map(engine.conversations, (list) => list.views.map(engineShellOf)),
  domainEvents: engine.changes,
  // The person's conversations, as the shells' list reads them: a crewmate's speaks through
  // the crew, an archived one is gone.
  conversations: Effect.gen(function* () {
    const { environmentId, epoch } = yield* revision;
    const { views } = yield* engine.conversations;
    return views
      .filter((view) => !view.archived && view.agent?.profile.kind !== "crewmate")
      .map((view) => conversationRowOf(view, { environmentId, epoch }));
  }),
  engine: { protocol: Math.max(...MATE_ENGINE_PROTOCOLS), taskAssignments: 1 },
});

/**
 * The attention's reads over the engine: its conversations as one project's chats, each read
 * again when its record moves.
 */
export const engineAttentionReads = (engine: MateEngineService) => ({
  project: Effect.succeed(Option.some(ENGINE_PROJECT_ID)),
  threadsOf: () => Effect.map(engine.conversations, (list) => list.views.map(engineShellOf)),
  thread: (id: ThreadId) =>
    Effect.map(engine.conversation(ConversationId.make(id)), (view) =>
      view === undefined || view.archived ? Option.none() : Option.some(engineShellOf(view)),
    ),
  domainEvents: Stream.map(engine.changes, (conversation) => ({
    aggregateKind: "thread" as const,
    aggregateId: ThreadId.make(conversation),
  })),
});
