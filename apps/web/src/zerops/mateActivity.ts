/**
 * What each Mate is up to, by its project: the one answer the menu's rows, its folded headings,
 * the waiting faces, the projects screen and a conversation's panel read.
 *
 * A Mate that publishes its attention (`matesAttention`) is read off it: whether it works, waits
 * on its person — and on what — or finished something the person has not seen (HQ counts that from
 * the person's acknowledgements), and whether that word is of now. Neither a clock nor which path
 * brought the word decides it: the store already holds the newest by the Mate's own revision. The
 * words a row shows — the task, the last reply, the step, the question — are the attention's chat's
 * own, found by its id: in the chat's shell where this page holds it, else in the engine's own row of
 * it where HQ relays an engine Mate's rows, else in HQ's overview of the Mate's main chat; a chat
 * HQ's overview does not name yet reads without words until it does.
 *
 * A Mate from before the attention value is read as it always was, off its socket's reading while
 * that socket stands, else off HQ's overview of it, live while HQ holds its link (`legacyActivity`);
 * that path goes with the old overview shape.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { MateLimit } from "@t3tools/client-runtime/data";
import type { MateAttentionRead } from "@t3tools/client-runtime/data";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, MateAttention, ThreadId } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { shareEqual } from "@t3tools/shared/structuralSharing";
import {
  mateMarkStateForThread,
  toneIdForKind,
  type ThreadStatusKind,
} from "@t3tools/shared/threadStatus";

import { threadStatusPill } from "../components/Sidebar.logic";
import {
  deriveZeropsAgentActivity,
  overviewAgentActivity,
  restingActivity,
  rowAgentActivity,
  threadAgentActivity,
  type AgentActivityThread,
  type ZeropsAgentActivity,
} from "./agentActivity";

export interface MatesActivityInput {
  readonly limits?: ReadonlyMap<string, MateLimit>;
  /** The Mates to read, by project. */
  readonly projectIds: ReadonlyArray<string>;
  readonly attention: Readonly<Record<string, MateAttentionRead>>;
  /** HQ's record of each Mate it places, by project; its overview words, its presence. */
  readonly overviews: ReadonlyMap<string, MateLiveView> | null;
  /** HQ relays them now (`hqMatesAtom.current`). */
  readonly hqCurrent: boolean;
  /** The chats this page holds, of every Mate it has open. */
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  /** The environment of each Mate this page has a socket to, by project. */
  readonly sockets: ReadonlyMap<string, EnvironmentId>;
  /** The environments whose socket stands: up, or only blinking. */
  readonly standing: ReadonlySet<EnvironmentId>;
  readonly lastVisitedAtById: Readonly<Record<string, string>>;
}

/** The environment a Mate runs in: as its attention, HQ's overview, or this page's socket names it. */
export function mateEnvironmentOf(
  input: Pick<MatesActivityInput, "attention" | "overviews" | "sockets">,
  projectId: string,
): EnvironmentId | undefined {
  return (
    input.attention[projectId]?.attention?.source.environmentId ??
    input.overviews?.get(projectId)?.identity?.environmentId ??
    input.sockets.get(projectId)
  );
}

/**
 * Every Mate's activity, by project. Given the previous reading, each Mate whose activity reads
 * the same keeps its entry, and a reading with no Mate changed is the previous one: a streaming
 * chat's shell changes on every event, mostly where no row reads it, and each row redraws only
 * when its own entry is new.
 */
export function matesActivityOf(
  input: MatesActivityInput,
  previous?: ReadonlyMap<string, ZeropsAgentActivity>,
  nowMs = Date.now(),
): ReadonlyMap<string, ZeropsAgentActivity> {
  const next = readMatesActivity(input);
  for (const [projectId, entry] of next) {
    const runSince = runClockSince(previous?.get(projectId), entry, nowMs);
    if (runSince !== undefined) next.set(projectId, { ...entry, runSince });
  }
  return previous === undefined ? next : shareActivities(previous, next);
}

/** The kinds a run is on in: at work, or waiting on its person within it. */
const ON_A_RUN: ReadonlySet<ThreadStatusKind> = new Set([
  "connecting",
  "working",
  "monitoring",
  "approval",
  "input",
  "planReady",
]);

const laterOf = (at: string, other: string | undefined): string =>
  other !== undefined && Date.parse(other) > Date.parse(at) ? other : at;

/**
 * Where a Mate's menu clock counts from: this run's start, and only forward. It is set where the
 * reading first sees the run at work — never before the person's ask, nor before the moment this
 * page watched the run begin — and held through the waits within the run, whatever date a later
 * reading brings (the queue's, the provider's start, a relay's, the previous turn's end). Gone once
 * the run ends.
 */
export function runClockSince(
  previous: ZeropsAgentActivity | undefined,
  next: ZeropsAgentActivity,
  nowMs: number,
): string | undefined {
  if (!ON_A_RUN.has(next.kind)) return undefined;
  if (
    previous?.runSince !== undefined &&
    previous.threadKey === next.threadKey &&
    ON_A_RUN.has(previous.kind)
  )
    return previous.runSince;
  if (!UNDER_WAY.has(next.kind)) return undefined;
  const asked = laterOf(next.at, next.askedAt);
  const watched = previous !== undefined && previous.remembered !== true;
  return watched ? laterOf(asked, new Date(nowMs).toISOString()) : asked;
}

function shareActivities(
  previous: ReadonlyMap<string, ZeropsAgentActivity>,
  next: Map<string, ZeropsAgentActivity>,
): ReadonlyMap<string, ZeropsAgentActivity> {
  let same = previous.size === next.size;
  for (const [projectId, entry] of next) {
    const before = previous.get(projectId);
    const shared = before === undefined ? entry : shareEqual(before, entry);
    if (shared !== before) same = false;
    next.set(projectId, shared);
  }
  return same ? previous : next;
}

function readMatesActivity(input: MatesActivityInput): Map<string, ZeropsAgentActivity> {
  const shellsByEnvironment = new Map<EnvironmentId, EnvironmentThreadShell[]>();
  for (const thread of input.threads) {
    const shells = shellsByEnvironment.get(thread.environmentId);
    if (shells === undefined) shellsByEnvironment.set(thread.environmentId, [thread]);
    else shells.push(thread);
  }
  const sockets = deriveZeropsAgentActivity(input.threads, input.lastVisitedAtById, input.limits);
  const activity = new Map<string, ZeropsAgentActivity>();
  for (const projectId of input.projectIds) {
    const read = input.attention[projectId];
    const overview = input.overviews?.get(projectId);
    const said = read?.attention ?? null;
    const environmentId = mateEnvironmentOf(input, projectId);
    if (environmentId === undefined) continue;
    const shells = shellsByEnvironment.get(environmentId) ?? [];
    const entry =
      said === null || read === undefined
        ? legacyActivity({ ...input, environmentId, overview, socket: sockets.get(environmentId) })
        : attentionActivity({
            attention: said,
            live: read.live,
            unseen: read.unseen,
            environmentId,
            overview,
            shells,
            lastVisitedAtById: input.lastVisitedAtById,
            limits: input.limits,
          });
    if (entry !== undefined) activity.set(projectId, entry);
  }
  return activity;
}

/** The kinds a chat is on its way in: what an agent at work is doing. */
const UNDER_WAY: ReadonlySet<ThreadStatusKind> = new Set(["connecting", "working", "monitoring"]);

/**
 * A Mate's activity off its attention: its chat's words, under the attention's own word of what it
 * does — what it waits on its person for first, else whether it works, else whether the person has
 * a result of it not seen — at rest unless that word is of now.
 */
export function attentionActivity(input: {
  readonly limits?: ReadonlyMap<string, MateLimit> | undefined;
  readonly attention: MateAttention;
  readonly live: boolean;
  readonly unseen: number | null;
  readonly environmentId: EnvironmentId;
  readonly overview: MateLiveView | undefined;
  readonly shells: ReadonlyArray<EnvironmentThreadShell>;
  readonly lastVisitedAtById: Readonly<Record<string, string>>;
}): ZeropsAgentActivity | undefined {
  const { attention, environmentId } = input;
  const restartQuestion =
    attention.questions[0]?.interruption === undefined ? undefined : attention.questions[0];
  const threadId = restartQuestion?.threadId ?? attention.mainThreadId ?? attention.lastThreadId;
  if (threadId === null) return undefined;
  const main = input.overview?.main ?? null;
  const visited = input.lastVisitedAtById[scopedThreadKey(scopeThreadRef(environmentId, threadId))];
  const shell = input.shells.find((each) => each.id === threadId);
  // An engine Mate's own row of the chat, where HQ relays its rows; else its main chat's fields.
  const row =
    shell === undefined
      ? input.overview?.conversations?.find((each) => (each.conversationId as string) === threadId)
      : undefined;
  const words: AgentActivityThread | undefined =
    row !== undefined
      ? undefined
      : (shell ??
        (main === null
          ? undefined
          : main.id === threadId
            ? { ...main, environmentId }
            : wordlessChat(threadId, environmentId, main.updatedAt)));
  const heldWords =
    words ??
    (restartQuestion?.interruption?.restart.at == null
      ? undefined
      : wordlessChat(threadId, environmentId, restartQuestion.interruption.restart.at));
  const limit = input.limits?.get(scopedThreadKey(scopeThreadRef(environmentId, threadId)));
  const read =
    row !== undefined
      ? rowAgentActivity(row, environmentId, visited, undefined, limit, main)
      : heldWords === undefined
        ? undefined
        : threadAgentActivity(heldWords, visited, undefined, limit);
  if (read === undefined) return undefined;
  const unread = input.unseen === null ? read.unread : input.unseen > 0;
  const question = attention.questions.find(
    (question) =>
      !(
        question.kind === "failed" &&
        question.threadId === read.threadId &&
        read.limit?.kind === "expired"
      ),
  );
  const kind: ThreadStatusKind =
    read.limit?.kind === "limited" || read.limit?.kind === "expired"
      ? read.kind
      : question !== undefined
        ? question.kind
        : // Its run's helpers and background commands are not runs the attention counts.
          attention.working > 0 || read.waitsOnHelpers === true
          ? UNDER_WAY.has(read.kind)
            ? read.kind
            : "working"
          : unread
            ? "done"
            : "idle";
  const {
    liveStep,
    waitsOnHelpers,
    question: asked,
    errorLine,
    interruption: _interruption,
    ...rest
  } = read;
  const activity: ZeropsAgentActivity = {
    ...rest,
    interruption: question?.interruption,
    kind,
    status: threadStatusPill({ kind, toneId: toneIdForKind(kind) }),
    face: mateMarkStateForThread(
      kind,
      read.usageLimited === true || read.pausedUntil !== undefined,
    ),
    unread,
    // The words only true of the kind the attention says.
    ...(UNDER_WAY.has(kind) && liveStep !== undefined ? { liveStep } : {}),
    ...(UNDER_WAY.has(kind) && waitsOnHelpers === true ? { waitsOnHelpers } : {}),
    ...(kind === "input" && asked !== undefined ? { question: asked } : {}),
    ...((kind === "failed" || read.usageLimited === true) && errorLine !== undefined
      ? { errorLine }
      : {}),
  };
  return input.live
    ? activity
    : restingActivity(activity, words === undefined ? read.at : words.updatedAt);
}

/**
 * A chat the attention names before HQ's overview does (a new one, the overview a beat behind): no
 * words of it yet, dated at HQ's last word of the Mate — the attention alone says what it does.
 */
function wordlessChat(
  id: ThreadId,
  environmentId: EnvironmentId,
  updatedAt: string,
): AgentActivityThread {
  return {
    id,
    environmentId,
    title: "",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    backgroundLiveness: null,
    latestUserMessageAt: null,
    updatedAt,
    session: null,
    latestTurn: null,
  };
}

/**
 * A Mate from before the attention value: its socket's reading of its main chat while the socket
 * stands, else HQ's overview of it — live while HQ holds its link — else that reading, at rest.
 */
function legacyActivity(input: {
  readonly limits?: ReadonlyMap<string, MateLimit>;
  readonly environmentId: EnvironmentId;
  readonly overview: MateLiveView | undefined;
  readonly socket: ZeropsAgentActivity | undefined;
  readonly hqCurrent: boolean;
  readonly standing: ReadonlySet<EnvironmentId>;
  readonly lastVisitedAtById: Readonly<Record<string, string>>;
}): ZeropsAgentActivity | undefined {
  const { overview, socket } = input;
  if (overview?.identity !== undefined && overview.main !== undefined) {
    const live = input.hqCurrent && overview.presence.overview === "live";
    if (live || socket === undefined)
      return overviewAgentActivity(overview, live, input.lastVisitedAtById, input.limits);
  }
  if (socket === undefined) return undefined;
  return input.standing.has(input.environmentId) ? socket : restingActivity(socket);
}

/**
 * The results of a Mate the person has seen: each whose chat they visited since its turn ended —
 * what HQ is told, so it counts the person's unseen from what they saw on any device.
 */
export function seenResultsOf(
  attention: MateAttention,
  lastVisitedAtById: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  const environmentId = attention.source.environmentId;
  return attention.results.flatMap((result) => {
    const visitedAt =
      lastVisitedAtById[scopedThreadKey(scopeThreadRef(environmentId, result.threadId))];
    return visitedAt !== undefined && Date.parse(visitedAt) >= Date.parse(result.completedAt)
      ? [result.turnId]
      : [];
  });
}
