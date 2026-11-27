/**
 * An application's Board, in words: its tasks in five lanes — Queued (by place), In progress (a
 * pool Mate on it, or a person's own Mate since they took it), Waiting for you (it asks a person),
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
import type { TaskSourceWrite, TaskWriteAction } from "@t3tools/client-runtime/data";
import type { ConversationSource } from "@t3tools/contracts";

import { pullRequestName } from "~/zerops/automatedMate.logic";
import {
  endedWords,
  recordStatus,
  TASK_STATUS_WORDS,
  workedWords,
  type TaskStatus,
} from "~/zerops/taskStatus";

import type { RowPress } from "./projectAutomation.logic";

/** How many tasks Done shows until the rest are asked for; HQ answers more. */
export const RECENT_SHOWN = 5;

/** The Board's lanes, in the order a task moves through them. */
export type Lane = "queued" | "progress" | "waiting" | "review" | "done";

export const LANES: ReadonlyArray<{ readonly id: Lane; readonly name: string }> = [
  { id: "queued", name: "Queued" },
  { id: "progress", name: "In progress" },
  { id: "waiting", name: "Waiting for you" },
  { id: "review", name: "Up for review" },
  { id: "done", name: "Done" },
];

/** The lane a status stands in. */
export function laneOf(status: TaskStatus): Lane {
  switch (status) {
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
  /** A state that needs a person ("Asks you") or one that failed. */
  readonly tone: "attention" | "failed" | null;
  /** Whose and how long or when: "Sol · 12m", "Lark · 6d", "Pim · 3h ago", "4m". */
  readonly who: string;
  readonly cost: string;
  /** Its conversation in Mate, as an in-app path; `null` while none. */
  readonly route: string | null;
  /** Its pull request on GitHub, else its change in Mate; `null` where it made none. */
  readonly change: {
    readonly label: string;
    readonly href: string;
    readonly external: boolean;
  } | null;
  /** Why it failed or stopped, said under its title. */
  readonly detail: string | null;
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
 * to the chat it came from (whose, said in full) only where the reader's list holds that Mate.
 */
export function originOf(task: HqAppTask, context: BoardContext): BoardOrigin {
  const source = task.source;
  if (source?.kind !== "conversation")
    return { words: task.label, full: task.label, url: task.url, conversation: null };
  return putOrigin(source, context);
}

/** A person's Put on board, as every surface says where the task came from (`originOf`). */
export function putOrigin(source: ConversationSource, context: BoardContext): BoardOrigin {
  const words = `Put on board by ${personWords(source.putBy, context)}`;
  const mate = (context.mateName ?? nobody)(source.mateProjectId);
  return {
    words,
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
 * What a row says in its state column, where its lane does not already: a pool task's start or
 * stop, who took it; whom a conversation's task asks; how an ended task ended. A working pool task
 * says nothing (its face does), nor a queued, waiting or up-for-review one beyond its lane.
 */
function stateOf(
  status: TaskStatus,
  holder: BoardHolder | null,
  task: HqAppTask,
  context: BoardContext,
): Pick<BoardRow, "state" | "tone"> {
  switch (status) {
    case "taken":
      return { state: takenWords(holder), tone: null };
    case "starting":
    case "stopping":
      return { state: TASK_STATUS_WORDS[status], tone: null };
    case "waiting":
      return {
        state:
          task.source?.kind === "conversation"
            ? `Asks ${personWords(task.source.putBy, context)}`
            : "Asks you",
        tone: "attention",
      };
    case "review":
      return holder?.kind === "person"
        ? { state: takenWords(holder), tone: null }
        : { state: null, tone: null };
    case "failed":
      return { state: TASK_STATUS_WORDS.failed, tone: "failed" };
    case "merged":
    case "closed":
    case "done":
    case "stopped":
      return { state: TASK_STATUS_WORDS[status], tone: null };
    case "queued":
    case "working":
      return { state: null, tone: null };
  }
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
  for (const task of tasks) {
    const now = live.get(task.id);
    const status = liveStatus(task, now);
    const lane = laneOf(status);
    const holder = holderOf(task, context);
    const change = changeLink(task, context.appId ?? "");
    const workedMs = now?.workedMs ?? task.workedMs;
    const time =
      lane === "queued"
        ? shortAge(task.createdAt, nowMs)
        : lane === "done"
          ? (endedWords(task.endedAt, nowMs) ?? "—")
          : holder?.kind === "person"
            ? shortAge(task.takenAt ?? null, nowMs)
            : workedMs == null
              ? "—"
              : workedWords(workedMs);
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
      position: lane === "queued" ? (task.position ?? lanes.queued.length + 1) : null,
      ...stateOf(status, holder, task, context),
      who: whoWords(holderName, time),
      // Nothing spent while queued; a person's own Mate spends their subscription, never the
      // organization's budget.
      cost:
        lane === "queued" || holder?.kind === "person"
          ? ""
          : costWords(now?.spentUsd ?? task.spentUsd),
      route: taskRoute(task.link),
      change,
      detail: task.state === "failed" || task.state === "stopped" ? task.detail : null,
    });
  }
  lanes.queued.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return { lanes, blocked };
}

/**
 * How many of the application's tasks wait, as the page's *Board* counts them: the ones Queued and
 * the ones Waiting for you, each in the lane the Board stands it in (`live` as `boardOf` reads it).
 */
export function boardWaitingCount(
  tasks: ReadonlyArray<HqAppTask>,
  live: ReadonlyMap<string, HqNavigationMateTask>,
): number {
  let count = 0;
  for (const task of tasks) {
    const lane = laneOf(liveStatus(task, live.get(task.id)));
    if (lane === "queued" || lane === "waiting") count += 1;
  }
  return count;
}

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
  /** Where its Take's conversation stands (`TakeOpening`); absent: none was taken here. */
  readonly opening?:
    | { readonly kind: "opening" }
    | { readonly kind: "stranded"; readonly words: string }
    | undefined;
}): RowPress {
  if (input.asking === input.taskId) return { kind: "asking" };
  const { action, opening } = input;
  if (opening?.kind === "opening") return { kind: "working", words: "Opening its conversation…" };
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
