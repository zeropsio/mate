/**
 * An application's Board, in words: its tasks in five lanes — Queued (by place, then the tasks that
 * wait for others, saying for which), In progress (a
 * pool Mate on it, or a person's own Mate since they took it), Waiting for you (it asks a person, or
 * a task it needs ended without its work),
 * Up for review (its change waits), Done — each row saying where the task came from, who has it,
 * its state in the one vocabulary every surface says it in (`taskStatus`), how long a live task
 * worked and what it cost (from HQ's navigation, which says each report), and when an ended one
 * ended; and where each opens. Above it, the pool as one line and the organization's spend this
 * month against its budget. What the reader may do with each task is not decided here
 * (`boardOffers`).
 */
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { changeRoutePath } from "@t3tools/shared/hqChanges";
import {
  TASK_CHANGES_SINCE,
  type HqAppTask,
  type HqTaskLimitsView,
} from "@t3tools/shared/hqIntake";
import { compareSemverVersions } from "@t3tools/shared/semver";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";
import type {
  BoardTaskOffer,
  TaskSourceWrite,
  TaskWriteAction,
} from "@t3tools/client-runtime/data";
import { OPENING_TAKEN_WORDS } from "@t3tools/client-runtime/zerops";
import type { BoardSource, ConversationSource } from "@t3tools/contracts";

import { pullRequestName } from "~/zerops/automatedMate.logic";
import {
  endedWords,
  recordStatus,
  TASK_STATUS_WORDS,
  taskStatusTone,
  workedWords,
  type TaskStatus,
  type TaskTone,
} from "~/zerops/taskStatus";

import type { RowPress } from "./projectAutomation.logic";

/** How many tasks Done shows until the rest are asked for; HQ answers more. */
export const RECENT_SHOWN = 5;

/** The Board's lanes. */
export type Lane = "queued" | "progress" | "waiting" | "review" | "done";

/**
 * The lanes in the order the Board draws them: what waits for the reader first, then what is under
 * way and what waits for their review, then what is next in line, then what ended.
 */
export const LANES: ReadonlyArray<{ readonly id: Lane; readonly name: string }> = [
  { id: "waiting", name: "Waiting for you" },
  { id: "progress", name: "In progress" },
  { id: "review", name: "Up for review" },
  { id: "queued", name: "Queued" },
  { id: "done", name: "Done" },
];

const LANE_NAME = Object.fromEntries(LANES.map((lane) => [lane.id, lane.name])) as Readonly<
  Record<Lane, string>
>;

/** The lane a status stands in. */
export function laneOf(status: TaskStatus): Lane {
  switch (status) {
    case "held":
    case "queued":
      return "queued";
    case "taken":
    case "starting":
    case "working":
    case "stopping":
      return "progress";
    case "waiting":
      return "waiting";
    case "review":
      return "review";
    case "merged":
    case "closed":
    case "done":
    case "failed":
    case "stopped":
      return "done";
  }
}

/** Who has a task: a Mate of the pool, or a person and their own Mate. */
export type BoardHolder =
  | { readonly kind: "pool"; readonly projectId: string; readonly name: string | null }
  | {
      readonly kind: "person";
      readonly userId: string;
      /** What every surface calls them; "you" for the reader. */
      readonly name: string;
      /** Their name as the member list says it, for their face; `null` where it says none. */
      readonly called: string | null;
      readonly projectId: string;
      /** Their Mate's name, where the reader's list holds it. */
      readonly mate: string | null;
    };

/** Where a task came from, as its row says it, and the way there where there is one. */
export interface BoardOrigin {
  readonly words: string;
  /** Who put it, for a person's Put on board or New task: "you", their name; `null` otherwise. */
  readonly putBy: string | null;
  /** Whose chat it was put from, where the reader's list holds that Mate: its name; else `null`. */
  readonly chat: string | null;
  /** Said in full where there is room, and to a screen reader: whose chat a Put on board came from. */
  readonly full: string;
  /** Its address outside Mate (an issue, a webhook's page). */
  readonly url: string | null;
  /** The conversation it was put from, where the reader can open its Mate. */
  readonly conversation: {
    readonly mateProjectId: string;
    readonly conversationId: string;
  } | null;
}

/** One task a row's task needs, as its row says it. */
export interface BoardNeed {
  readonly taskId: string;
  /** Its title as HQ names it, else as the Board's read holds it; `null` where neither does. */
  readonly title: string | null;
  readonly state: "waiting" | "met" | "broken";
  /** How a broken one ended, in a word ("failed", "stopped", "closed"); `null` otherwise. */
  readonly ended: string | null;
}

/** A task the Board names beside another: one that waits for it. */
export interface BoardTaskRef {
  readonly taskId: string;
  readonly title: string;
}

/** One moment of a task, as its history says it: what happened, and how long ago. */
export interface BoardEvent {
  readonly kind: "put" | "taken" | "handed" | "asked" | "answered" | "ready" | "ended";
  readonly words: string;
  /** "4m ago", "2d ago". */
  readonly at: string;
}

export interface BoardRow {
  readonly id: string;
  readonly lane: Lane;
  readonly status: TaskStatus;
  readonly title: string;
  readonly origin: BoardOrigin;
  readonly holder: BoardHolder | null;
  /** Its place in the queue while queued. */
  readonly position: number | null;
  /** Its state in words where the lane does not say it ("Taken by Ana", "Merged"); `null`: none. */
  readonly state: string | null;
  /** Whom its Mate asks while it waits on a person: "you", or the person who put it. */
  readonly asks: string | null;
  /** Whose and how long or when (`time`): "Sol · 12m", "Lark · 6d", "Pim · 3h ago", "4m". */
  readonly who: string;
  /**
   * How long or when alone: queued for "4m", its holder has had it for "12m", it ended "3h ago";
   * empty where not known.
   */
  readonly time: string;
  /** How long its pool Mate reports it worked ("9m"), which is not how long it has had it; `null`: none. */
  readonly worked: string | null;
  readonly cost: string;
  /** Its conversation in Mate, as an in-app path; `null` while none. */
  readonly route: string | null;
  /** Its pull request on GitHub, else its change in Mate; `null` where it made none. */
  readonly change: {
    readonly label: string;
    readonly href: string;
    readonly external: boolean;
  } | null;
  /** Why it failed or stopped, as its Mate or the person who stopped it said; `null`: not said. */
  readonly why: string | null;
  /** What its Mate asks, while it waits on a person's answer; `null`: it asks nothing. */
  readonly question: string | null;
  /**
   * Its putter answers it here, in its row: a task put on the Board itself, which has no chat. A
   * task put from a conversation is answered on its card in that chat, never here.
   */
  readonly answeredHere: boolean;
  /** The tasks it needs, each with where that need stands; none for most. */
  readonly needs: ReadonlyArray<BoardNeed>;
  /** Its needs that broke: what Drop the need offers to drop. */
  readonly broken: ReadonlyArray<BoardNeed>;
  /** The Board's tasks that wait for this one. */
  readonly waiters: ReadonlyArray<BoardTaskRef>;
  /** Its brief, as its Mate gets it; `null` where HQ answered none. */
  readonly brief: string | null;
  /** What happened to it so far, oldest first (`historyOf`). */
  readonly history: ReadonlyArray<BoardEvent>;
}

/** A Mate HQ hands no task while the change of its last one waits for review. */
export interface BlockedMate {
  readonly projectId: string;
  /** Its change in Mate, else its pull request on GitHub. */
  readonly change: NonNullable<BoardRow["change"]>;
}

export interface Board {
  /** Each lane's rows: Queued by place, Done the latest first (the board shows the first few). */
  readonly lanes: Readonly<Record<Lane, ReadonlyArray<BoardRow>>>;
  /**
   * Its Mates HQ holds on their last task's open change (`heldOnItsChange`): HQ gives them no task
   * until it is merged or closed.
   */
  readonly blocked: ReadonlyArray<BlockedMate>;
}

/** "4m", "3h", "2d": an age as the board's numbers column shows it. */
function shortAge(fromIso: string | null, nowMs: number): string {
  const from = fromIso === null ? Number.NaN : Date.parse(fromIso);
  if (!Number.isFinite(from)) return "—";
  const minutes = Math.max(0, Math.floor((nowMs - from) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d`;
}

const DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A cost as the board says it; "—" where its Mate reported none. */
export function costWords(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd > 0 && usd < 0.005) return "<$0.01";
  return DOLLARS.format(usd);
}

/** Where a task's link opens inside Mate: its path, where it was made for Mate's own address. */
export function taskRoute(link: string | null): string | null {
  if (link === null || !link.startsWith(`${DEFAULT_HOSTED_APP_URL}/`)) return null;
  return link.slice(DEFAULT_HOSTED_APP_URL.length);
}

/**
 * Where a task's conversation opens inside Mate, as an in-app path. A task a person took: the
 * conversation of their Mate that carries it, where this page holds it — HQ's link for it leads to
 * the Mate, whose newest conversation may be another task's; else, and for every other task, where
 * HQ's link leads (`taskRoute`).
 */
export function taskConversationRoute(
  task: Pick<HqAppTask, "link" | "taker">,
  carried: TakenConversationAt | undefined,
): string | null {
  if (task.taker?.kind === "person" && carried !== undefined)
    return `/${encodeURIComponent(carried.environmentId)}/${encodeURIComponent(carried.conversationId)}`;
  return taskRoute(task.link);
}

/**
 * A task's change, as the board links it: its pull request on GitHub, else its change in Mate, else
 * the latest change a person's Mate linked to the task it took.
 */
function changeLink(task: HqAppTask, appId: string): BoardRow["change"] {
  if (task.pullRequest !== null)
    return { label: pullRequestName(task.pullRequest), href: task.pullRequest.url, external: true };
  const change = task.change ?? task.changes?.at(-1) ?? null;
  if (change !== null)
    return {
      label: `Change #${String(change.number)}`,
      href: changeRoutePath(appId, change.repo, change.number),
      external: false,
    };
  return null;
}

/**
 * Whether HQ holds a Mate on its last task's open change: only a Mate older than HQ's change per
 * task (`TASK_CHANGES_SINCE`) is, its one working copy holding that work; a newer one, or one
 * whose version nothing says, takes tasks meanwhile.
 */
export function heldOnItsChange(version: string | undefined): boolean {
  return version !== undefined && compareSemverVersions(version, TASK_CHANGES_SINCE) < 0;
}

/** Where a live task stands, with what HQ's navigation says of it (a stop taken, a question). */
function liveStatus(task: HqAppTask, live: HqNavigationMateTask | undefined): TaskStatus {
  if (live?.stopping === true || task.state === "stopping") return "stopping";
  if (live?.waiting === true) return "waiting";
  return recordStatus(task);
}

/** What the Board reads besides HQ's tasks: the names it says and what HQ's navigation says now. */
export interface BoardContext {
  readonly appId?: string;
  /** What navigation says of the tasks the pool is on now, by id. */
  readonly live?: ReadonlyMap<string, HqNavigationMateTask>;
  /** Whether HQ holds a Mate, by its project, on its open change (`heldOnItsChange`). */
  readonly held?: (projectId: string) => boolean;
  /** The reader's Zerops user id: a task they put or took says "you". */
  readonly viewerId?: string | undefined;
  /** What every surface calls a person, by their Zerops user id. */
  readonly personName?: (userId: string) => string | undefined;
  /** A Mate the reader's list holds, by its project: its name; `undefined` where it holds none. */
  readonly mateName?: (projectId: string) => string | undefined;
  /**
   * The conversation a task the reader took was opened for, by the task (`takenConversationsAtom`):
   * the Mate's rows this page holds say it; `undefined` where none does.
   */
  readonly takenConversation?: (taskId: string) => TakenConversationAt | undefined;
}

/** A conversation in Mate, in the environment of the Mate it is in. */
export interface TakenConversationAt {
  readonly environmentId: string;
  readonly conversationId: string;
}

const nobody = () => undefined;

/** "you", their name, or "someone" where the member list does not name them. */
function personWords(userId: string, context: BoardContext): string {
  if (userId === context.viewerId) return "you";
  return (context.personName ?? nobody)(userId) ?? "someone";
}

/**
 * Where a task came from, in the reader's words: an issue, a channel, a schedule as its source
 * names it, linked out where it has an address; a person's Put on board by who put it, linked back
 * to the chat it came from (whose, said in full) only where the reader's list holds that Mate, and
 * a New task put on the Board itself by who put it, with no way back: it came from nowhere else.
 */
export function originOf(task: HqAppTask, context: BoardContext): BoardOrigin {
  const source = task.source;
  if (source?.kind !== "conversation" && source?.kind !== "board")
    return {
      words: task.label,
      putBy: null,
      chat: null,
      full: task.label,
      url: task.url,
      conversation: null,
    };
  return putOrigin(source, context);
}

/** A person's Put on board, as every surface says where the task came from (`originOf`). */
export function putOrigin(
  source: ConversationSource | BoardSource,
  context: BoardContext,
): BoardOrigin {
  const putBy = personWords(source.putBy, context);
  const words = `Put on board by ${putBy}`;
  if (source.kind === "board")
    return { words, putBy, chat: null, full: words, url: null, conversation: null };
  const mate = (context.mateName ?? nobody)(source.mateProjectId);
  return {
    words,
    putBy,
    chat: mate ?? null,
    full: mate === undefined ? words : `${words} in ${mate}’s chat`,
    url: null,
    conversation:
      mate === undefined
        ? null
        : { mateProjectId: source.mateProjectId, conversationId: source.conversationId },
  };
}

/** Who has a task: the person who took it, else the pool's Mate HQ handed it to. */
function holderOf(task: HqAppTask, context: BoardContext): BoardHolder | null {
  const taker = task.taker;
  if (taker?.kind === "person")
    return {
      kind: "person",
      userId: taker.userId,
      name: personWords(taker.userId, context),
      called: (context.personName ?? nobody)(taker.userId) ?? null,
      projectId: taker.mateProjectId,
      mate: (context.mateName ?? nobody)(taker.mateProjectId) ?? null,
    };
  if (taker?.kind === "pool")
    return {
      kind: "pool",
      projectId: taker.mateProjectId,
      name: task.mate?.projectId === taker.mateProjectId ? task.mate.name : null,
    };
  return task.mate === null
    ? null
    : { kind: "pool", projectId: task.mate.projectId, name: task.mate.name };
}

/** "Sol · 12m": whose, and how long or when; either alone where the other is not known. */
const whoWords = (name: string | null, time: string): string =>
  [name, time === "—" ? null : time].filter((part) => part !== null).join(" · ");

/** "Taken by you", "Taken by Ana": a taken task's state, beside its Mate and how long it is held. */
const takenWords = (holder: BoardHolder | null): string =>
  holder?.kind === "person" ? `Taken by ${holder.name}` : TASK_STATUS_WORDS.taken;

/**
 * A row's state in words, where its lane does not already say it: a pool task's start or stop, who
 * took it; whom a person's put asks; how an ended task ended. A working pool task says nothing (its
 * face does), nor a queued, waiting or up-for-review one beyond its lane.
 */
function stateOf(
  status: TaskStatus,
  holder: BoardHolder | null,
  task: HqAppTask,
  context: BoardContext,
): string | null {
  switch (status) {
    case "taken":
      return takenWords(holder);
    case "starting":
    case "stopping":
      return TASK_STATUS_WORDS[status];
    case "waiting":
      return `Asks ${askedOf(task, context)}`;
    case "review":
      return holder?.kind === "person" ? takenWords(holder) : null;
    case "merged":
    case "closed":
    case "done":
    case "failed":
    case "stopped":
      return TASK_STATUS_WORDS[status];
    case "held":
    case "queued":
    case "working":
      return null;
  }
}

/** Whom a waiting task's Mate asks: the person who put it, else the reader. */
function askedOf(task: HqAppTask, context: BoardContext): string {
  return task.source?.kind === "conversation" || task.source?.kind === "board"
    ? personWords(task.source.putBy, context)
    : "you";
}

/**
 * The Board's rows from HQ's tasks of the application, as of `nowMs`, each in its lane: a live
 * pool task's cost, time and state from HQ's navigation (`context.live`), so they move as each
 * report lands without the Board read again; a taken task's time since it was taken.
 */
export function boardOf(
  tasks: ReadonlyArray<HqAppTask>,
  nowMs: number,
  context: BoardContext,
): Board {
  const lanes: Record<Lane, Array<BoardRow>> = {
    queued: [],
    progress: [],
    waiting: [],
    review: [],
    done: [],
  };
  const blocked: Array<BlockedMate> = [];
  const live = context.live ?? new Map<string, HqNavigationMateTask>();
  const held = context.held ?? (() => false);
  const byId = new Map(tasks.map((task) => [task.id, task] as const));
  const waiters = waitersOf(tasks, byId);
  for (const task of tasks) {
    const now = live.get(task.id);
    const status = liveStatus(task, now);
    const needs = needsOf(task, byId);
    const broken = status === "held" ? needs.filter((need) => need.state === "broken") : [];
    // A held task whose need broke waits on a person: drop that need, or stop the task.
    const lane = broken.length > 0 ? "waiting" : laneOf(status);
    const holder = holderOf(task, context);
    const change = changeLink(task, context.appId ?? "");
    const workedMs = now?.workedMs ?? task.workedMs;
    const time =
      lane === "queued"
        ? shortAge(task.createdAt, nowMs)
        : lane === "done"
          ? (endedWords(task.endedAt, nowMs) ?? "—")
          : // How long its holder has had it, on the history's clock: since a person took it, or
            // since HQ handed it to a pool Mate.
            shortAge((holder?.kind === "person" ? task.takenAt : task.startedAt) ?? null, nowMs);
    const holderName = holder?.kind === "person" ? holder.mate : (holder?.name ?? null);
    // Done with its change open: a Mate HQ holds waits for it while navigation still names it.
    if (status === "review" && holder?.kind === "pool" && change !== null) {
      if (held(holder.projectId) && now !== undefined)
        blocked.push({ projectId: holder.projectId, change });
    }
    lanes[lane].push({
      id: task.id,
      lane,
      status,
      title: task.title,
      origin: originOf(task, context),
      holder,
      position:
        lane === "queued" && status !== "held" ? (task.position ?? lanes.queued.length + 1) : null,
      // Its putter drops the need or stops it (an owner or admin may too).
      state:
        broken.length > 0
          ? task.source?.kind === "conversation"
            ? `Waits on ${personWords(task.source.putBy, context)}`
            : "Waits on a person"
          : stateOf(status, holder, task, context),
      asks: lane === "waiting" && broken.length === 0 ? askedOf(task, context) : null,
      who: whoWords(holderName, time),
      time: time === "—" ? "" : time,
      // A pool Mate's own count of the minutes it worked, which its panel says as such.
      worked: holder?.kind === "pool" && workedMs != null ? workedWords(workedMs) : null,
      // Nothing spent while queued; a person's own Mate spends their subscription, never the
      // organization's budget.
      cost:
        lane === "queued" || holder?.kind === "person"
          ? ""
          : costWords(now?.spentUsd ?? task.spentUsd),
      route: taskConversationRoute(task, context.takenConversation?.(task.id)),
      change,
      why: task.state === "failed" || task.state === "stopped" ? task.detail : null,
      // A task whose need broke asks nothing: it waits on its putter to drop the need or stop it.
      question: lane === "waiting" && broken.length === 0 ? task.detail : null,
      answeredHere: task.source?.kind === "board",
      needs,
      broken,
      waiters: waiters.get(task.id) ?? [],
      brief: task.brief ?? null,
      history: historyOf(task, status, holder, holderName, nowMs, context),
    });
  }
  // A held task stands after every task the queue hands out, in the order HQ answered them.
  const placeOf = (row: BoardRow) => row.position ?? Number.MAX_SAFE_INTEGER;
  lanes.queued.sort((a, b) => placeOf(a) - placeOf(b));
  return { lanes, blocked };
}

/**
 * How many of the application's tasks wait for the reader, as every *Board* door counts them: the
 * ones Waiting for you, in the lane the Board stands each in (`live` as `boardOf` reads it). A
 * queued task waits for a Mate, not a person: the door never counts it.
 */
export function boardWaitingCount(
  tasks: ReadonlyArray<HqAppTask>,
  live: ReadonlyMap<string, HqNavigationMateTask>,
): number {
  let count = 0;
  for (const task of tasks) {
    if (laneOf(liveStatus(task, live.get(task.id))) === "waiting") count += 1;
  }
  return count;
}

/** How many rows the project page's Board shows: the ones that need the reader first. */
export const COMPACT_SHOWN = 6;

/** The lanes the project page's Board shows rows of, in its order. */
const COMPACT_LANES: ReadonlyArray<Lane> = ["waiting", "review"];

/**
 * The rows the project page's Board shows: what waits for the reader, then what waits for their
 * review, at most {@link COMPACT_SHOWN}; the rest are on the Board's page, its totals beside its way
 * there (`boardTotals`).
 */
export function compactRows(board: Board): ReadonlyArray<BoardRow> {
  return COMPACT_LANES.flatMap((lane) => board.lanes[lane]).slice(0, COMPACT_SHOWN);
}

/**
 * The project page's Board, read: the rows it shows (`compactRows`); what it says where it shows
 * none — that the Board holds no task yet, or that none of its tasks waits on the reader; and the
 * rest of the Board's totals beside the way to its page (`boardTotals`), none while it holds no
 * task. The way to the Board's page always ends it: its sources and its history are there.
 */
export function compactBoard(board: Board): {
  readonly rows: ReadonlyArray<BoardRow>;
  readonly quiet: "no-tasks" | "nothing-waits" | null;
  readonly totals: string | null;
} {
  const rows = compactRows(board);
  if (LANES.every((lane) => board.lanes[lane.id].length === 0))
    return { rows, quiet: "no-tasks", totals: null };
  return { rows, quiet: rows.length === 0 ? "nothing-waits" : null, totals: boardTotals(board) };
}

/** How many of the Board's tasks are open, every lane's but Done's: the count beside its page's title. */
export function openCount(board: Board): number {
  return LANES.reduce(
    (count, lane) => (lane.id === "done" ? count : count + board.lanes[lane.id].length),
    0,
  );
}

/** How many rows the project page's Board will show while the Board reads (`compactRows`). */
export function compactPredicted(predicted: PredictedBoard): number {
  return Math.min(
    COMPACT_SHOWN,
    COMPACT_LANES.reduce((count, lane) => count + predicted[lane], 0),
  );
}

/**
 * The rest of the Board in one line, beside its way there on the project page: what is under way,
 * queued and done — "3 in progress · 3 queued · 3 done" — or how many tasks it holds where none is.
 */
export function boardTotals(board: Board): string {
  const { progress, queued, done } = board.lanes;
  const parts = [
    ...(progress.length > 0 ? [`${String(progress.length)} in progress`] : []),
    ...(queued.length > 0 ? [`${String(queued.length)} queued`] : []),
    ...(done.length > 0 ? [`${String(done.length)} done`] : []),
  ];
  if (parts.length > 0) return parts.join(" · ");
  const all = LANES.reduce((count, lane) => count + board.lanes[lane.id].length, 0);
  return counted(all, "task", "tasks");
}

/** A task's own mark, where no face carries its state. */
export type TaskGlyph = "queued" | "held" | "done" | "failed" | "stopped" | "closed";

/**
 * What leads a row: the Mate that has it, wearing the task's state — at work, asking, or at rest —
 * a pool Mate or the Mate a person took it into (the work is the Mate's: the person is said in
 * words); and where no Mate has it now (queued, waiting for others, ended), the task's glyph.
 */
export type RowLead =
  | {
      readonly kind: "mate";
      readonly projectId: string;
      readonly state: "working" | "needs" | "idle";
    }
  | { readonly kind: "glyph"; readonly glyph: TaskGlyph };

/** The lead of a row (`RowLead`). */
export function rowLead(row: Pick<BoardRow, "lane" | "status" | "holder">): RowLead {
  if (row.lane === "done") return { kind: "glyph", glyph: endedGlyph(row.status) };
  const { holder } = row;
  if (holder !== null && row.lane !== "queued")
    return {
      kind: "mate",
      projectId: holder.projectId,
      state:
        row.lane === "waiting"
          ? "needs"
          : row.status === "working" || row.status === "taken"
            ? "working"
            : "idle",
    };
  if (row.status === "held") return { kind: "glyph", glyph: "held" };
  return { kind: "glyph", glyph: row.lane === "review" ? "done" : "queued" };
}

/** How an ended task's glyph says it ended. */
function endedGlyph(status: TaskStatus): TaskGlyph {
  switch (status) {
    case "failed":
    case "stopped":
    case "closed":
      return status;
    default:
      return "done";
  }
}

/** What each lane's word means, as the surfaces that head a task draw it beside its dot. */
const LANE_TONE: Readonly<Record<Exclude<Lane, "done">, TaskTone>> = {
  waiting: "needs",
  progress: "working",
  review: "review",
  queued: "quiet",
};

/**
 * Where a task stands, as every surface that heads it says it — its panel on the Board, its card
 * and bar in its conversation: the name of the lane the Board stands it in, in that lane's tone,
 * so a task under Up for review says Up for review wherever it is drawn, whoever has it (who does
 * is a fact of its own). Done holds every ended task, so there it says how it ended; and a stop
 * under way says Stopping, the one answer the reader's own Stop gets.
 */
export function laneState(
  lane: Lane,
  status: TaskStatus,
): { readonly words: string; readonly tone: TaskTone } {
  if (lane === "done" || status === "stopping")
    return { words: TASK_STATUS_WORDS[status], tone: taskStatusTone(status) };
  return { words: LANE_NAME[lane], tone: LANE_TONE[lane] };
}

/**
 * The lead of a task named beside another (a need, a task waiting on it): its row's where the
 * Board holds it, else its mark from where that need stands — met is done, waiting is queued, and
 * broken says how it ended.
 */
export function refLead(
  need: { readonly state?: BoardNeed["state"]; readonly ended?: string | null },
  row: BoardRow | undefined,
): RowLead {
  if (row !== undefined) return rowLead(row);
  if (need.state === "met") return { kind: "glyph", glyph: "done" };
  if (need.state === "broken")
    return {
      kind: "glyph",
      glyph: need.ended === "stopped" ? "stopped" : need.ended === "failed" ? "failed" : "closed",
    };
  return { kind: "glyph", glyph: "queued" };
}

/** One part of a row's line under its title: words, where the task came from, or its change. */
export type MetaPart =
  | { readonly kind: "words"; readonly words: string }
  | { readonly kind: "origin" }
  | { readonly kind: "change" };

/** A row's line under its title: its parts, said one after another, and the ink they are in. */
export interface RowMeta {
  readonly tone: "attention" | "failed" | null;
  readonly parts: ReadonlyArray<MetaPart>;
}

const words = (said: string): MetaPart => ({ kind: "words", words: said });

/**
 * The line under a row's title. Where it matters, one thing in place of the rest: the reader's
 * write under way or refused; a need that broke; what its Mate asks (`asker`, its name); what it
 * waits for; why it failed or stopped; that it waits for review and its change, where no lane's
 * heading says it waits (`inLane`), else its change, who has it and its cost. Else where it came
 * from, its state, who has it and for how long, and its cost — an ended task saying how it ended
 * first.
 */
export function rowMeta(
  row: BoardRow,
  press: RowPress,
  asker: string | null,
  /** The row stands under its lane's heading, which says what its state's words would. */
  inLane: boolean,
): RowMeta {
  if (press.kind === "refused") return { tone: "failed", parts: [words(press.words)] };
  if (press.kind === "working") return { tone: null, parts: [words(press.words ?? "…")] };
  if (row.broken.length > 0) return { tone: "attention", parts: [words(brokenWords(row.broken))] };
  if (row.lane === "waiting") {
    const mate = asker ?? "Its Mate";
    const whom = row.asks === null || row.asks === "you" ? "" : ` ${row.asks}`;
    return {
      tone: "attention",
      parts: [
        words(
          row.question === null
            ? `${mate} asks ${row.asks ?? "you"}`
            : `${mate} asks${whom}: ${row.question}`,
        ),
      ],
    };
  }
  if (row.status === "held") {
    const waiting = row.needs.filter((need) => need.state === "waiting");
    const [first] = waiting;
    return {
      tone: null,
      parts: [
        words(
          first === undefined
            ? TASK_STATUS_WORDS.held
            : `Waits for ${quoted(first.title)}${waiting.length > 1 ? ` and ${String(waiting.length - 1)} more` : ""}`,
        ),
      ],
    };
  }
  if (row.status === "failed")
    return {
      tone: "failed",
      parts: [words(row.why === null ? TASK_STATUS_WORDS.failed : `Failed: ${row.why}`)],
    };
  if (row.status === "stopped" && row.why !== null)
    return { tone: null, parts: [words(`Stopped: ${row.why}`)] };
  const said = (text: string | null): ReadonlyArray<MetaPart> =>
    text === null || text === "" ? [] : [words(text)];
  const change: ReadonlyArray<MetaPart> = row.change === null ? [] : [{ kind: "change" }];
  if (row.lane === "review")
    return {
      tone: null,
      parts: inLane
        ? [...change, ...said(row.who), ...said(row.cost)]
        : [words(TASK_STATUS_WORDS.review), ...change],
    };
  if (row.lane === "done")
    return {
      tone: null,
      parts: [...said(row.state), ...change, ...said(row.who), ...said(row.cost)],
    };
  return {
    tone: null,
    parts: [{ kind: "origin" }, ...said(row.state), ...said(row.who), ...said(row.cost)],
  };
}

/**
 * What broke of a held task's needs, as its row and its panel say it: “Store balances” was
 * stopped, “A” failed and “B” was closed unmerged.
 */
export function brokenWords(broken: ReadonlyArray<BoardNeed>): string {
  return listed(
    broken.map((need) => {
      const what = quoted(need.title);
      switch (need.ended) {
        case "failed":
          return `${what} failed`;
        case "stopped":
          return `${what} was stopped`;
        case "closed unmerged":
          return `${what} was closed unmerged`;
        default:
          return `${what} ended`;
      }
    }),
  );
}

/** “A”, “A and B”, “A, B and C”. */
function listed(said: ReadonlyArray<string>): string {
  if (said.length <= 1) return said.join("");
  return `${said.slice(0, -1).join(", ")} and ${said.at(-1) ?? ""}`;
}

/**
 * The row the keyboard stands on, among the rows shown in order: the one it was moved to last,
 * else the task open in its panel, else the first; `step` moves it one row down (1) or up (-1),
 * held at the list's ends. Enter opens this row, never another.
 */
export function activeTask(
  shown: ReadonlyArray<string>,
  cursor: string | null,
  selected: string | null,
  step: -1 | 0 | 1 = 0,
): string | null {
  const at = [cursor, selected].find((id): id is string => id !== null && shown.includes(id));
  const from = at === undefined ? 0 : shown.indexOf(at);
  return shown[Math.min(shown.length - 1, Math.max(0, from + step))] ?? null;
}

/**
 * A taken task's presses, in the words every surface that offers them says — its Board row, its
 * panel, its conversation's header: Mark done, and Put back (on the Board's queue, for another).
 */
export const TAKEN_TASK_PRESSES = {
  done: "Mark done",
  release: "Put back",
  /** Put back's accessible name: where it goes. */
  releaseName: "Put back on the Board",
} as const;

/** A press the reader makes on a task. */
export type TaskVerb = "open" | "drop" | "take" | "review" | "done" | "answer";

/**
 * What the reader may do with a task, as its row and its panel offer it: the one press that is
 * their next act (`primary`, the row's only press) — open a Take whose conversation did not open,
 * drop a need that broke, Take, Review its change, Mark done, Answer its Mate — and beside it in
 * the panel, the rest the rules let them: Put back, Mark done, Stop, and opening its conversation. A
 * write under way offers nothing until it lands.
 */
export function taskVerbs(input: {
  readonly row: BoardRow;
  /** The task's verbs as the rules offer them (`boardOffers`); `undefined`: none. */
  readonly offer: BoardTaskOffer | undefined;
  readonly press: RowPress;
  /** HQ took it for the reader, but none of their Mate's conversations carries it. */
  readonly stranded: boolean;
}): {
  readonly primary: TaskVerb | null;
  readonly release: boolean;
  readonly done: boolean;
  readonly stop: boolean;
  readonly conversation: boolean;
} {
  const { row, offer, press, stranded } = input;
  if (offer === undefined || press.kind === "working")
    return {
      primary: null,
      release: false,
      done: false,
      stop: false,
      conversation: row.route !== null,
    };
  const answersHere = row.answeredHere && row.question !== null && offer.answer;
  const primary: TaskVerb | null = stranded
    ? "open"
    : offer.dropNeed && row.broken.length > 0
      ? "drop"
      : offer.takeInto.length > 0
        ? "take"
        : row.lane === "review" && row.change !== null
          ? "review"
          : offer.done
            ? "done"
            : answersHere ||
                (row.lane === "waiting" && row.broken.length === 0 && row.route !== null)
              ? "answer"
              : null;
  return {
    primary,
    release: offer.release,
    done: offer.done && primary !== "done",
    stop: offer.stop && row.status !== "stopping",
    // Answer opens its conversation already where its Mate is answered there.
    conversation: row.route !== null && !(primary === "answer" && !answersHere),
  };
}

/** How a task ended, in the word a broken need says it with; `null` while it has not. */
function endedWord(task: HqAppTask | undefined): string | null {
  if (task === undefined) return null;
  switch (task.state) {
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    case "closed":
      return "closed unmerged";
    default:
      return null;
  }
}

/** A task's needs in the Board's words: each task it needs by title, as HQ names it or the read holds it. */
function needsOf(task: HqAppTask, byId: ReadonlyMap<string, HqAppTask>): ReadonlyArray<BoardNeed> {
  return (task.needs ?? []).map((need) => {
    const needed = byId.get(need.taskId);
    return {
      taskId: need.taskId,
      title: need.title ?? needed?.title ?? null,
      state: need.state,
      ended: need.state === "broken" ? endedWord(needed) : null,
    };
  });
}

/** The tasks that wait for each task, by its id: every task whose need on it is not met yet. */
function waitersOf(
  tasks: ReadonlyArray<HqAppTask>,
  byId: ReadonlyMap<string, HqAppTask>,
): ReadonlyMap<string, ReadonlyArray<BoardTaskRef>> {
  const waiting = new Map<string, Array<BoardTaskRef>>();
  for (const task of tasks)
    for (const need of task.needs ?? [])
      if (need.state === "waiting" && byId.has(need.taskId)) {
        const those = waiting.get(need.taskId) ?? [];
        those.push({ taskId: task.id, title: task.title });
        waiting.set(need.taskId, those);
      }
  return waiting;
}

/**
 * What happened to a task so far, from what the Board's read carries, oldest first: where it came
 * from, its needs met, a person taking it or HQ handing it to a pool Mate, each question its Mate
 * asked and each answer its putter gave (who, never what), and how it ended.
 */
export function historyOf(
  task: HqAppTask,
  status: TaskStatus,
  holder: BoardHolder | null,
  holderName: string | null,
  nowMs: number,
  context: BoardContext,
): ReadonlyArray<BoardEvent> {
  const events: Array<{ readonly event: BoardEvent; readonly ms: number }> = [];
  const add = (kind: BoardEvent["kind"], words: string, iso: string | null | undefined) => {
    const at = endedWords(iso ?? null, nowMs);
    if (at === null || iso == null) return;
    events.push({ event: { kind, words, at }, ms: Date.parse(iso) });
  };
  const source = task.source;
  add(
    "put",
    source?.kind === "conversation" || source?.kind === "board"
      ? `Put on board by ${personWords(source.putBy, context)}`
      : `Came from ${task.label}`,
    task.createdAt,
  );
  if (holder?.kind === "person")
    add(
      "taken",
      `Taken by ${holder.name}${holder.mate === null ? "" : ` into ${holder.mate}`}`,
      task.takenAt,
    );
  else if (task.startedAt !== null)
    add("handed", `Handed to ${holderName ?? "a Mate"}`, task.startedAt);
  const putter =
    source?.kind === "conversation" || source?.kind === "board"
      ? personWords(source.putBy, context)
      : "someone";
  for (const event of task.history ?? []) {
    if (event === undefined) continue;
    if (event.kind === "asked")
      add("asked", `${task.mate?.name ?? "Its Mate"} asked: ${event.question}`, event.at);
    else if (event.kind === "answered")
      add("answered", `${putter.charAt(0).toUpperCase()}${putter.slice(1)} answered`, event.at);
    else add("ready", "Its needs were met", event.at);
  }
  add(
    "ended",
    status === "review" ? "Done, up for review" : TASK_STATUS_WORDS[status],
    task.endedAt,
  );
  // Oldest first; moments at one time keep the order they happen in (a stable sort).
  return [...events].sort((a, b) => a.ms - b.ms).map(({ event }) => event);
}

/** “Set up the database”, or “a task that ended” where the read no longer holds it. */
const quoted = (title: string | null) => (title === null ? "a task that ended" : `“${title}”`);

/** How many rows each lane will hold while the Board reads; a lane that will hold none, none. */
export type PredictedBoard = Readonly<Record<Lane, number>>;

/**
 * How many rows each lane will hold, from HQ's navigation while the Board reads, so it keeps its
 * height when the read lands: In progress and Waiting, a row per Mate on a live task (asking or
 * not), and per task its people took; Queued, its waiting tasks; Done, the tasks navigation says
 * ended, up to what it shows. Up for review is not predicted: navigation does not say it.
 */
export function predictedBoard(
  tasks: ReadonlyArray<HqNavigationMateTask | null | undefined>,
  waiting: number,
  taken = 0,
): PredictedBoard {
  const known = tasks.filter((task) => task != null);
  const live = known.filter((task) => task.ended === undefined);
  const asking = live.filter((task) => task.waiting === true).length;
  return {
    queued: Math.max(0, waiting),
    progress: live.length - asking + taken,
    waiting: asking,
    review: 0,
    done: Math.min(RECENT_SHOWN, known.length - live.length),
  };
}

/** What a write to a task under way says in its row. */
const UNDER_WAY: Readonly<Partial<Record<TaskSourceWrite["kind"], string>>> = {
  "task-stop": "Stopping…",
  "task-need-drop": "Dropping the need…",
  "task-take": "Taking it…",
  "task-release": "Releasing…",
  "task-done": "Marking it done…",
};

/**
 * Where a row's press stands: its Stop asking in the row, this account's write to the task under
 * way (in words) or its Take's conversation opening, refused in HQ's words or the Take stranded in
 * its own; else at rest.
 */
export function taskRowPress(input: {
  readonly taskId: string;
  /** The row whose Stop asks now; `null`: none. */
  readonly asking: string | null;
  /** This account's latest write to the task (`appTaskWrites`); absent: none. */
  readonly action: TaskWriteAction | undefined;
  /**
   * Where its Take's conversation stands: this tab opening it (`useTakeOpenings`), or stranded,
   * none of its Mate's conversations carrying it (`strandedTakes`); absent: neither.
   */
  readonly opening?:
    | { readonly kind: "opening" }
    | { readonly kind: "stranded"; readonly words: string }
    | undefined;
}): RowPress {
  if (input.asking === input.taskId) return { kind: "asking" };
  const { action, opening } = input;
  if (opening?.kind === "opening") return { kind: "working", words: OPENING_TAKEN_WORDS };
  if (opening?.kind === "stranded") return { kind: "refused", words: opening.words };
  if (action?.kind === "working") return { kind: "working", words: UNDER_WAY[action.verb] ?? "…" };
  if (action?.kind === "failed" || action?.kind === "unresolved")
    return { kind: "refused", words: action.words };
  return { kind: "idle" };
}

const counted = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/**
 * The pool in one line, for the section's masthead: how many automated Mates, then what they are
 * doing — at work, asking the person, held by HQ on a change that waits for review (`held`, by
 * project) — or that they are free.
 */
export function poolSummary(
  pool: ReadonlyArray<{
    readonly projectId: string;
    readonly automation: {
      readonly task: {
        readonly waiting?: true | undefined;
        readonly done?: true | undefined;
      } | null;
    };
  }>,
  held: ReadonlySet<string> = new Set(),
): string {
  if (pool.length === 0) return "No automated Mates yet";
  let atWork = 0;
  let asking = 0;
  let waiting = 0;
  for (const { projectId, automation } of pool) {
    if (held.has(projectId)) waiting += 1;
    else if (automation.task?.waiting === true) asking += 1;
    else if (automation.task != null && automation.task.done !== true) atWork += 1;
  }
  const doing = [
    ...(atWork > 0 ? [`${String(atWork)} at work`] : []),
    ...(asking > 0 ? [counted(asking, "asks you", "ask you")] : []),
    ...(waiting > 0 ? [counted(waiting, "waits for review", "wait for review")] : []),
  ];
  const free = pool.length === 1 ? "free" : pool.length === 2 ? "both free" : "all free";
  return [
    counted(pool.length, "automated Mate", "automated Mates"),
    ...(doing.length > 0 ? doing : [free]),
  ].join(" · ");
}

/** What the organization's automated Mates spent this month, against its budget where it set one. */
export function spendLine(limits: HqTaskLimitsView): string {
  const spent = costWords(limits.spentThisMonthUsd);
  const budget = limits.monthlyBudgetUsd;
  if (budget == null) return `${spent} this month`;
  const cap = Number.isInteger(budget) ? `$${String(budget)}` : costWords(budget);
  return `${spent} of ${cap} this month${limits.spentThisMonthUsd >= budget ? " · spent" : ""}`;
}
