import {
  projectMateLimit,
  projectLimitError,
} from "../../../../packages/client-runtime/src/data/projections/mateLimit.ts";
/**
 * The overview a Mate sends up its link to HQ (`@t3tools/shared/mateLink`, step A): what every
 * surface that draws this Mate without opening it reads — its main chat as the shell fields a menu
 * row reads, a digest of its other chats, its logins and its crew — and who it is.
 *
 * An engine Mate also sends its own rows (`conversations`) beside the shell fields, which an HQ
 * from before them drops; a V1 Mate sends none.
 *
 * Pure: the caller reads the thread shells, the agent-auth snapshot and the crew's.
 *
 * @module zeropsHqOverview
 */
import type {
  ConversationRow,
  CrewSnapshot,
  OrchestrationThreadShell,
  ThreadLiveCall,
  ThreadLiveStep,
  ZeropsAgentAuthSnapshot,
  ZeropsLoginState,
} from "@t3tools/contracts";
import {
  MATE_CREW_BOUNDS,
  linkFrameBytes,
  MATE_LINK_FRAME_MAX,
  MATE_LINK_TEXT_MAX,
  MATE_LIVE_STEP_BOUNDS,
  MATE_LOGINS_MAX,
  MATE_OVERVIEW_CONVERSATIONS_MAX,
  MATE_OVERVIEW_THREADS_MAX,
  MATE_TITLE_MAX,
  type MateOverview,
  type MateThreadKind,
  type OverviewConversations,
  type OverviewCrew,
  type OverviewIdentity,
  type OverviewLogins,
  type OverviewMain,
  type OverviewThreads,
  type ThreadDigest,
} from "@t3tools/shared/mateLink";
import { maskSecrets } from "@t3tools/shared/messagePreview";
import { resolvePrimaryConversation } from "@t3tools/shared/primaryConversation";
import { resolveThreadStatus } from "@t3tools/shared/threadStatus";

import { extraLoginAgent } from "./zeropsLoginIds.ts";

export interface MateOverviewInput {
  readonly identity: OverviewIdentity;
  /** The thread shells of the project at the workspace root. */
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  /** The agent-auth snapshot the client reads, combined (`combineAgentAuth`). */
  readonly auth: ZeropsAgentAuthSnapshot;
  /** Display history from the server, separate from current credential authority. */
  readonly lastSigners?: Readonly<Record<string, string>>;
  /** The crew engine's snapshot; none before its first. */
  readonly crew: CrewSnapshot | undefined;
  /** An engine Mate's own rows of its person's conversations; none on a V1 Mate. */
  readonly conversations?: ReadonlyArray<ConversationRow>;
}

/** `text` cut to `max` characters, the last of them an ellipsis where it was longer. */
const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/**
 * A text as the overview carries it: its credentials masked — it sits in HQ's database and its
 * backups — trimmed and cut to `max`; none where nothing is left.
 */
function textOf(value: string | null | undefined, max = MATE_LINK_TEXT_MAX): string | null {
  const text = maskSecrets(value ?? "").trim();
  return text.length === 0 ? null : cut(text, max);
}

/** A thread's title, which the contract never lets be empty. */
const titleOf = (title: string): string => textOf(title, MATE_TITLE_MAX) ?? "…";

type LiveStep = NonNullable<OverviewMain["liveStep"]>;
type LiveCall = Extract<LiveStep, { readonly kind: "calls" }>["calls"][number];

/** A call of a running turn, each of its words cut to what a row shows (`MATE_LIVE_STEP_BOUNDS`). */
function liveCallOf(call: ThreadLiveCall): LiveCall {
  const detail = textOf(call.detail);
  const toolName = textOf(call.toolName);
  const command = textOf(call.command, MATE_LIVE_STEP_BOUNDS.command);
  const imagePath = textOf(call.imagePath);
  const files = (call.files ?? [])
    .flatMap((file) => textOf(file) ?? [])
    .slice(0, MATE_LIVE_STEP_BOUNDS.files);
  return {
    id: call.id,
    activityKind: call.activityKind,
    itemType: call.itemType,
    title: textOf(call.title) ?? "…",
    ...(detail === null ? {} : { detail }),
    ...(toolName === null ? {} : { toolName }),
    ...(command === null ? {} : { command }),
    ...(call.input === undefined
      ? {}
      : {
          input: Object.fromEntries(
            Object.entries(call.input)
              .slice(0, MATE_LIVE_STEP_BOUNDS.inputs)
              .map(([key, value]) => [key, cut(maskSecrets(value), MATE_LIVE_STEP_BOUNDS.input)]),
          ),
        }),
    ...(imagePath === null ? {} : { imagePath }),
    ...(call.files === undefined ? {} : { files }),
    startedAt: call.startedAt,
  };
}

/** What the running turn is on, its newest calls kept (`MATE_LIVE_STEP_BOUNDS`). */
function liveStepOf(step: ThreadLiveStep | null | undefined): LiveStep | null {
  if (step === null || step === undefined) return null;
  if (step.kind !== "calls") return step;
  return {
    kind: "calls",
    since: step.since,
    calls: step.calls.slice(-MATE_LIVE_STEP_BOUNDS.calls).map(liveCallOf),
  };
}

function mainOf(thread: OrchestrationThreadShell): OverviewMain {
  const error = textOf(thread.session?.lastError?.split("\n")[0]);
  const limit = projectMateLimit(thread, Date.parse(thread.updatedAt));
  return {
    id: thread.id,
    title: titleOf(thread.title),
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
    hasActionableProposedPlan: thread.hasActionableProposedPlan,
    interactionMode: thread.interactionMode,
    backgroundLiveness: thread.backgroundLiveness ?? null,
    session:
      thread.session === null
        ? null
        : {
            status: thread.session.status,
            interruption: thread.session.interruption,
            lastError: projectLimitError(error) === null ? error : null,
          },
    latestTurn:
      thread.latestTurn === null
        ? null
        : {
            turnId: thread.latestTurn.turnId,
            state: thread.latestTurn.state,
            requestedAt: thread.latestTurn.requestedAt,
            startedAt: thread.latestTurn.startedAt,
            completedAt: thread.latestTurn.completedAt,
          },
    latestUserMessageAt: thread.latestUserMessageAt,
    updatedAt: thread.updatedAt,
    latestUserMessagePreview: previewOf(thread.latestUserMessagePreview?.text),
    latestMessagePreview: messagePreviewOf(thread.latestMessagePreview),
    planProgress: withText(thread.planProgress?.step, (step) => ({ step })),
    pendingQuestion: textOf(thread.pendingQuestion),
    refusal:
      limit.kind === "none"
        ? null
        : {
            turnId: limit.turnId as NonNullable<OverviewMain["latestTurn"]>["turnId"] | null,
            provider: limit.provider,
            resetsAt: limit.resetsAt,
          },
    usagePause:
      limit.kind !== "none" && thread.usagePause != null
        ? { resetsAt: thread.usagePause.resetsAt }
        : null,
    liveStep: liveStepOf(thread.liveStep),
  };
}

/** `make` over a text that is there, none where it is not. */
function withText<A>(value: string | null | undefined, make: (text: string) => A): A | null {
  const text = textOf(value);
  return text === null ? null : make(text);
}

const previewOf = (value: string | null | undefined) => withText(value, (text) => ({ text }));

const messagePreviewOf = (
  preview: OrchestrationThreadShell["latestMessagePreview"],
): OverviewMain["latestMessagePreview"] =>
  preview === null || preview === undefined
    ? null
    : withText(preview.text, (text) => ({ role: preview.role, text }));

/**
 * A thread's kind as this Mate resolves it, without a visit. A shell carries no visit and no wake,
 * so `done` and `woke` — the reader's (`viewerThreadKind`) — never come out; were they to, they
 * would be the reader's to finish from `idle`.
 */
function mateKindOf(thread: OrchestrationThreadShell): MateThreadKind {
  const { kind } = resolveThreadStatus(
    thread,
    projectMateLimit(thread, Date.parse(thread.updatedAt)).kind,
  );
  return kind === "done" || kind === "woke" ? "idle" : kind;
}

function digestOf(thread: OrchestrationThreadShell): ThreadDigest {
  return {
    id: thread.id,
    title: titleOf(thread.title),
    kind: mateKindOf(thread),
    turnId: thread.latestTurn?.turnId ?? null,
    turnState: thread.latestTurn?.state ?? null,
    completedAt: thread.latestTurn?.completedAt ?? null,
  };
}

/** The person's chats: neither archived nor a crewmate's, which speaks through the crew. */
const isPersonsChat = (thread: OrchestrationThreadShell) =>
  thread.archivedAt === null && thread.crew === undefined;

const newestFirst = (left: { readonly updatedAt: string }, right: { readonly updatedAt: string }) =>
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt);

/**
 * The chats an overview lists: every one that is not idle, then the newest, up to
 * {@link MATE_OVERVIEW_THREADS_MAX}; `omitted` counts the rest. A thread leaves the list only
 * while it rests, and comes back the moment it does not.
 */
function threadsOf(threads: ReadonlyArray<OrchestrationThreadShell>): OverviewThreads {
  const chats = threads.filter(isPersonsChat);
  const resting = (thread: OrchestrationThreadShell) => mateKindOf(thread) === "idle";
  const ranked = [
    ...chats.filter((thread) => !resting(thread)).toSorted(newestFirst),
    ...chats.filter(resting).toSorted(newestFirst),
  ];
  const list = ranked.slice(0, MATE_OVERVIEW_THREADS_MAX).map(digestOf);
  return { list, omitted: ranked.length - list.length };
}

/** A row's free text as the overview carries it: masked, cut; its words as they were else. */
const rowText = (value: string): string => cut(maskSecrets(value).trim(), MATE_LINK_TEXT_MAX);

/** A row with every text it carries masked and cut: its wait's words, its error, its run's end. */
function linkRowOf(row: ConversationRow): ConversationRow {
  const { state } = row;
  const end = row.latestRun?.end ?? null;
  return {
    ...row,
    state:
      state.kind === "failed"
        ? { ...state, errorLine: rowText(state.errorLine) }
        : state.kind === "waiting" && state.words !== null
          ? { ...state, words: rowText(state.words) }
          : state,
    latestRun:
      row.latestRun === null || end === null
        ? row.latestRun
        : {
            ...row.latestRun,
            end: Object.fromEntries(
              Object.entries(end).map(([key, value]) => [
                key,
                key !== "kind" && typeof value === "string" ? rowText(value) : value,
              ]),
            ) as typeof end,
          },
  };
}

const restingRow = (row: ConversationRow) => row.state.kind === "idle";

/**
 * The rows an overview carries, as its chats: every one that is not idle, then the newest, up to
 * {@link MATE_OVERVIEW_CONVERSATIONS_MAX}.
 */
function conversationsOf(rows: ReadonlyArray<ConversationRow>): OverviewConversations {
  const newest = (left: ConversationRow, right: ConversationRow) => right.at - left.at;
  return [
    ...rows.filter((row) => !restingRow(row)).toSorted(newest),
    ...rows.filter(restingRow).toSorted(newest),
  ]
    .slice(0, MATE_OVERVIEW_CONVERSATIONS_MAX)
    .map(linkRowOf);
}

/**
 * Whether the person lands finished work themselves: always without a run on, else as the run's
 * landing option says — the client's `crewPersonLands` (`client-runtime/zerops/crew/phrases.ts`).
 */
const personLands = (run: CrewSnapshot["run"]): boolean =>
  run === null ||
  (run.state !== "running" && run.state !== "paused") ||
  run.options.landing === "person";

/**
 * The key a login's signer goes by (`zeropsLoginIds.ts`): the agent id for an agent's own login,
 * the login's id for any other.
 */
const loginKeyOf = (login: {
  readonly id: string;
  readonly agent?: string | undefined;
}): string | null => (extraLoginAgent(login.id) === undefined ? (login.agent ?? null) : login.id);

/**
 * The crew as the Mate's menu and its line read it: its status — crew mode off until the engine is
 * heard from — and, once a crew is applied, its digest as the sidebar draws it.
 */
function crewOf(
  crew: CrewSnapshot | undefined,
  threads: ReadonlyArray<OrchestrationThreadShell>,
): OverviewCrew {
  if (crew === undefined) return { status: "off" };
  if (crew.status !== "applied") return { status: crew.status };
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  return {
    status: "applied",
    crewmates: crew.crewmates.slice(0, MATE_CREW_BOUNDS.crewmates).map((mate) => {
      const thread = mate.currentThreadId === null ? undefined : byId.get(mate.currentThreadId);
      return {
        handle: mate.handle,
        displayName: mate.displayName,
        tint: mate.tint,
        lead: mate.kind === "lead",
        threadId: mate.currentThreadId,
        threadKind: thread === undefined ? null : mateKindOf(thread),
        loginKey: loginKeyOf(mate.login),
      };
    }),
    attention: crew.attention
      .slice(0, MATE_CREW_BOUNDS.attention)
      .map((row) => ({ id: row.id, kind: row.kind, handle: row.handle })),
    readyTasks: crew.board.tasks
      .filter((task) => task.state === "ready")
      .slice(0, MATE_CREW_BOUNDS.readyTasks)
      .map((task) => ({ id: task.id, owner: task.owner })),
    personLands: personLands(crew.run),
  };
}

const isResting = (digest: ThreadDigest) => digest.kind === "idle";

/**
 * Whether a login beyond the agents' own holds a credential, by its state — the client's
 * `AGENT_ROW_FOR_STATE` (`client-runtime/zerops/logins.ts`), which reads it as an agent row.
 */
const LOGIN_PRESENT: Readonly<Record<ZeropsLoginState, boolean>> = {
  authorized: true,
  registering: true,
  "needs-reauth": true,
  reconnect: false,
  "not-authorized": false,
};

/**
 * Whose each login is and what its lock reads, by the key its signer goes by: the agents' own
 * rows first, then every other login, {@link MATE_LOGINS_MAX} at most.
 */
function loginsOf(
  auth: ZeropsAgentAuthSnapshot,
  lastSigners?: Readonly<Record<string, string>>,
): OverviewLogins {
  const agents = auth.agents.map(
    (agent) =>
      [
        agent.agentId,
        {
          signedInBy: agent.authorizedBy?.subject ?? null,
          ...(lastSigners === undefined
            ? {}
            : { lastSignedInBy: lastSigners[agent.agentId] ?? null }),
          present: agent.credPresent,
          token: agent.flagToken,
        },
      ] as const,
  );
  const others = (auth.logins ?? [])
    .filter((login) => !login.default)
    .map(
      (login) =>
        [
          login.id,
          {
            signedInBy: login.signedInBy ?? null,
            ...(lastSigners === undefined ? {} : { lastSignedInBy: lastSigners[login.id] ?? null }),
            present: LOGIN_PRESENT[login.state],
            token: login.token,
          },
        ] as const,
    );
  return Object.fromEntries([...agents, ...others].slice(0, MATE_LOGINS_MAX));
}

/** The bytes the link sends `overview` in, whole: the bound counts UTF-8 bytes. */
const wholeFrameBytes = (overview: MateOverview): number =>
  linkFrameBytes(JSON.stringify({ type: "overview", full: true, overview }));

/**
 * The overview within `maxBytes` sent whole: resting chats go, the oldest first, counted in
 * `omitted`; then an engine Mate's resting rows, the oldest first. The main chat and its row, the
 * chats and rows that are not idle, and the crew are never dropped.
 */
function fitted(overview: MateOverview, maxBytes: number): MateOverview {
  let { list, omitted } = overview.threads;
  let rows = overview.conversations;
  const sized = (): MateOverview => ({
    ...overview,
    threads: { list, omitted },
    ...(rows === undefined ? {} : { conversations: rows }),
  });
  const within = () => wholeFrameBytes(sized()) <= maxBytes;
  for (let oldest = list.findLastIndex(isResting); !within() && oldest >= 0;) {
    list = list.toSpliced(oldest, 1);
    omitted += 1;
    oldest = list.findLastIndex(isResting);
  }
  const droppable = (row: ConversationRow) =>
    restingRow(row) && (row.conversationId as string) !== overview.main?.id;
  for (let oldest = rows?.findLastIndex(droppable) ?? -1; !within() && oldest >= 0;) {
    rows = rows?.toSpliced(oldest, 1);
    oldest = rows?.findLastIndex(droppable) ?? -1;
  }
  return sized();
}

/** The Mate's overview, within `maxBytes` (the link's frame bound) when it is sent whole. */
export function mateOverviewOf(
  input: MateOverviewInput,
  maxBytes: number = MATE_LINK_FRAME_MAX,
): MateOverview {
  const { primary } = resolvePrimaryConversation(input.threads);
  return fitted(
    {
      identity: input.identity,
      main: primary === undefined ? null : mainOf(primary),
      threads: threadsOf(input.threads),
      logins: loginsOf(input.auth, input.lastSigners),
      crew: crewOf(input.crew, input.threads),
      ...(input.conversations === undefined
        ? {}
        : { conversations: conversationsOf(input.conversations) }),
    },
    maxBytes,
  );
}
