/**
 * What each Mate is up to, by its project: the one answer the menu's rows, its folded headings,
 * the waiting faces, the projects screen and a conversation's panel read.
 *
 * A Mate that publishes its attention (`matesAttention`) is read off it: whether it works, waits
 * on its person — and on what — or finished something the person has not seen (HQ counts that from
 * the person's acknowledgements), and whether that word is of now. Neither a clock nor which path
 * brought the word decides it: the store already holds the newest by the Mate's own revision. The
 * words a row shows — the task, the last reply, the step, the question — are the attention's chat's
 * own, found by its id: in the chat's shell where this page follows it — the Mate's socket stands —,
 * else in the engine's own row of it where HQ relays an engine Mate's rows, else in HQ's overview
 * of the Mate's main chat, else in the shell this page held when it last followed it; a chat HQ's
 * overview does not name yet reads without words until it does. A shell this page stopped
 * following stays where the run was when the person left (a row read "Thinking" through a 49-step
 * run): HQ's live word of the same chat outranks it.
 *
 * A Mate from before the attention value is read as it always was, off its socket's reading while
 * that socket stands, else off HQ's overview of it, live while HQ holds its link (`legacyActivity`);
 * that path goes with the old overview shape.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
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
  /**
   * The conversation open and visible on this page, by its scoped key: every result it shows is
   * seen, whatever HQ still counts unseen or the visit marked so far (`useThreadOnScreen`).
   */
  readonly onScreen?: string | null | undefined;
}

/**
 * A visit no completion is later than: the conversation on screen's, so a result that lands while
 * the person looks at it never reads unseen before its visit is marked.
 */
const SEEN_ON_SCREEN = "9999-12-31T23:59:59.999Z";

/** The visits as this read takes them: the conversation on screen seen through its last result. */
const visitsOf = (
  input: Pick<MatesActivityInput, "lastVisitedAtById" | "onScreen">,
): Readonly<Record<string, string>> =>
  input.onScreen == null
    ? input.lastVisitedAtById
    : { ...input.lastVisitedAtById, [input.onScreen]: SEEN_ON_SCREEN };

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
  const lastVisitedAtById = visitsOf(input);
  const sockets = deriveZeropsAgentActivity(input.threads, lastVisitedAtById, input.limits);
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
        ? legacyActivity({
            ...input,
            lastVisitedAtById,
            environmentId,
            overview,
            socket: sockets.get(environmentId),
          })
        : attentionActivity({
            attention: said,
            live: read.live,
            unseen: read.unseen,
            environmentId,
            overview,
            shells,
            followed: input.standing.has(environmentId),
            lastVisitedAtById,
            limits: input.limits,
          });
    if (entry !== undefined) activity.set(projectId, entry);
  }
  return activity;
}

/** The kinds a chat is on its way in: what an agent at work is doing. */
const UNDER_WAY: ReadonlySet<ThreadStatusKind> = new Set(["connecting", "working", "monitoring"]);

/** Whether a chat of this kind is on its way: its agent at work. */
export const underWay = (kind: ThreadStatusKind): boolean => UNDER_WAY.has(kind);

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
  /**
   * This page follows the Mate's chats now — its socket stands —, so a shell it holds is current;
   * otherwise one it holds is where the chat was when this page last followed it.
   */
  readonly followed: boolean;
  readonly lastVisitedAtById: Readonly<Record<string, string>>;
}): ZeropsAgentActivity | undefined {
  const { attention, environmentId } = input;
  const restartQuestion =
    attention.questions[0]?.interruption === undefined ? undefined : attention.questions[0];
  const threadId = restartQuestion?.threadId ?? attention.mainThreadId ?? attention.lastThreadId;
  if (threadId === null) return undefined;
  const main = input.overview?.main ?? null;
  const visited = input.lastVisitedAtById[scopedThreadKey(scopeThreadRef(environmentId, threadId))];
  const held = input.shells.find((each) => each.id === threadId);
  // An engine Mate's own row of the chat, where HQ relays its rows; else its main chat's fields.
  const engineRow = input.overview?.conversations?.find(
    (each) => (each.conversationId as string) === threadId,
  );
  // A shell this page no longer follows gives way to HQ's word of the same chat.
  const shell =
    held !== undefined && (input.followed || (engineRow === undefined && main?.id !== threadId))
      ? held
      : undefined;
  const row = shell === undefined ? engineRow : undefined;
  const words: AgentActivityThread | undefined =
    row !== undefined
      ? undefined
      : (shell ??
        (main === null
          ? undefined
          : main.id === threadId
            ? { ...main, environmentId }
            : wordlessChat(threadId, environmentId, main.updatedAt, attention)));
  const heldWords =
    words ??
    (restartQuestion?.interruption?.restart.at == null
      ? undefined
      : wordlessChat(threadId, environmentId, restartQuestion.interruption.restart.at, attention));
  const limit = input.limits?.get(scopedThreadKey(scopeThreadRef(environmentId, threadId)));
  const read =
    row !== undefined
      ? rowAgentActivity(row, environmentId, visited, undefined, limit, main)
      : heldWords === undefined
        ? undefined
        : threadAgentActivity(heldWords, visited, undefined, limit);
  if (read === undefined) return undefined;
  const question = attention.questions.find(
    (question) =>
      !(
        question.kind === "failed" &&
        question.threadId === read.threadId &&
        read.limit?.kind === "expired"
      ),
  );
  const unreadNow = mateUnread({
    endedAt:
      row !== undefined
        ? row.state.kind === "working" || row.state.kind === "queued"
          ? null
          : (row.latestRun?.endedAt ?? null)
        : heldWords?.latestTurn?.state === "running"
          ? null
          : (heldWords?.latestTurn?.completedAt ?? null),
    visitedAt: visited,
    unseen: input.unseen,
    failed:
      read.kind === "failed" ||
      (question?.kind === "failed" && question.threadId === read.threadId),
  });
  const kind: ThreadStatusKind =
    read.limit?.kind === "limited" || read.limit?.kind === "expired"
      ? read.kind
      : question !== undefined
        ? question.kind
        : // Its run's helpers and background commands are not runs the attention counts, and an
          // engine Mate's own row goes on into a queued run — a restart's continuation — before
          // HQ's count of it comes: either says it works, so the face never passes through idle.
          attention.working > 0 ||
            read.waitsOnHelpers === true ||
            (row !== undefined && UNDER_WAY.has(read.kind))
          ? UNDER_WAY.has(read.kind)
            ? read.kind
            : "working"
          : unreadNow
            ? "done"
            : "idle";
  const unread = unreadNow && !UNDER_WAY.has(kind);
  const {
    liveStep,
    waitsOnHelpers,
    backgroundWork,
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
    ...(UNDER_WAY.has(kind) && waitsOnHelpers === true
      ? { waitsOnHelpers, ...(backgroundWork === undefined ? {} : { backgroundWork }) }
      : {}),
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
 * words of it yet — the attention alone says what it does — dated by its own last result where
 * the attention lists one, else at HQ's last word of the Mate.
 */
function wordlessChat(
  id: ThreadId,
  environmentId: EnvironmentId,
  updatedAt: string,
  attention: MateAttention,
): AgentActivityThread {
  const result = attention.results.find((each) => each.threadId === id);
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
    latestTurn:
      result === undefined
        ? null
        : {
            turnId: result.turnId,
            state: "completed",
            requestedAt: result.completedAt,
            startedAt: result.completedAt,
            completedAt: result.completedAt,
          },
  };
}

/**
 * Whether a Mate's own socket stands: up, or only blinking. Replaced on a wake (a page restored
 * from the back/forward cache, a long background), a socket that stood connects afresh, and it
 * still stands until its replacement answers or fails: its row never rests for the swap.
 */
export function socketStands(phase: EnvironmentConnectionPhase, stoodBefore: boolean): boolean {
  return (
    phase === "connected" || phase === "reconnecting" || (phase === "connecting" && stoodBefore)
  );
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
 * Whether a Mate is unread: its main chat's latest result — a run finished, failed or cut — is
 * newer than what this person has seen. The one rule of every surface that draws it (its menu
 * row's dot and name, the rail, the overview's cards, its folded group's line):
 *
 * | this device's visit                       | HQ's count  | unread           |
 * | ----------------------------------------- | ----------- | ---------------- |
 * | its conversation is on screen             | any         | no               |
 * | marked unread here (`markThreadUnread`)   | any         | yes              |
 * | since the result ended                    | any         | no — ahead of HQ |
 * | before it, on a failed run                | —           | yes              |
 * | before it, or never                       | said        | HQ's count > 0   |
 * | before it                                 | not said    | yes              |
 * | never                                     | not said    | no               |
 *
 * HQ counts what the person saw on any device, of finished runs only: a failure waits on its
 * person as a question there, so this device's visit is the only word of it having been seen. A
 * chat never opened here while HQ says nothing — HQ not answered yet on a reload, or not counting
 * for this person — reads seen: a reload paints nothing it takes back, and a new browser does not
 * light every Mate it has never opened.
 */
export function mateUnread(input: {
  /** When its latest result ended; null while a run is on, or where none is known. */
  readonly endedAt: string | number | null;
  readonly visitedAt: string | undefined;
  /** HQ's count of the Mate's results the person has not seen; null while HQ has not said. */
  readonly unseen: number | null;
  /** That result is a failure, which HQ does not count. */
  readonly failed: boolean;
}): boolean {
  if (input.visitedAt === SEEN_ON_SCREEN) return false;
  const local = localSeen(input.endedAt, input.visitedAt);
  if (local === "marked") return true;
  if (local === "seen") return false;
  if (input.failed) return local === "unseen";
  if (input.unseen !== null) return input.unseen > 0;
  return local === "unseen";
}

/** This device's word of one result: seen since it ended, marked unread, seen before it, or none. */
function localSeen(
  endedAt: string | number | null,
  visitedAt: string | undefined,
): "seen" | "marked" | "unseen" | "unknown" {
  if (endedAt === null || visitedAt === undefined) return "unknown";
  const ended = typeof endedAt === "number" ? endedAt : Date.parse(endedAt);
  const visited = Date.parse(visitedAt);
  if (Number.isNaN(ended) || Number.isNaN(visited)) return "unknown";
  if (visited >= ended) return "seen";
  // `markThreadUnread` sets the visit a millisecond before the result it marks.
  return visited === ended - 1 ? "marked" : "unseen";
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
