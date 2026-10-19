/**
 * A project's task board, in words: what its automated Mates are on (at work), what waits for
 * them by its place (queued), and what ended (recent) — each row's status in the one vocabulary
 * every surface says it in (`taskStatus`), how long a live task worked and what it cost (from
 * HQ's navigation, which says each report, where it names the task), and when an ended one ended;
 * and where each opens. Above it, the pool as one line and the organization's spend this month
 * against its budget.
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

import { pullRequestName } from "~/zerops/automatedMate.logic";
import {
  endedWords,
  isLiveStatus,
  recordStatus,
  workedWords,
  type TaskStatus,
} from "~/zerops/taskStatus";

/** How many ended tasks the board shows; HQ answers more. */
export const RECENT_SHOWN = 5;

export interface AtWorkRow {
  readonly id: string;
  readonly title: string;
  readonly mate: HqAppTask["mate"];
  readonly status: TaskStatus;
  /** How long it worked, as its Mate last reported (`workedWords`); "—" where none. */
  readonly worked: string;
  readonly cost: string;
  /** Its conversation in Mate, as an in-app path; `null` while none. */
  readonly route: string | null;
}

export interface QueuedRow {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  /** Where it came from, as its source names it (`acme/tea-shop#12`), and its address there. */
  readonly source: string;
  readonly url: string | null;
  /** How long it has waited. */
  readonly waited: string;
}

export interface RecentRow {
  readonly id: string;
  readonly outcome: TaskStatus;
  readonly title: string;
  readonly mate: string | null;
  /** When it ended (`endedWords`): "3h ago"; "—" where not known. */
  readonly when: string;
  readonly cost: string;
  /** Its pull request on GitHub, else its change in Mate; `null` where it made none. */
  readonly change: {
    readonly label: string;
    readonly href: string;
    readonly external: boolean;
  } | null;
  readonly route: string | null;
  /** Why it failed or stopped, for its tooltip. */
  readonly detail: string | null;
}

/** A Mate HQ hands no task while the change of its last one waits for review. */
export interface BlockedMate {
  readonly projectId: string;
  /** Its change in Mate, else its pull request on GitHub. */
  readonly change: NonNullable<RecentRow["change"]>;
}

/** A free Mate whose finished tasks' changes wait for review: how many. */
export interface ReviewingMate {
  readonly projectId: string;
  readonly count: number;
}

export interface Board {
  readonly atWork: ReadonlyArray<AtWorkRow>;
  /**
   * Its Mates HQ holds on their last task's open change (`heldOnItsChange`): HQ gives them no task
   * until it is merged or closed.
   */
  readonly blocked: ReadonlyArray<BlockedMate>;
  /** Its Mates HQ does not hold whose changes wait for review: free, each with how many. */
  readonly reviewing: ReadonlyArray<ReviewingMate>;
  readonly queued: ReadonlyArray<QueuedRow>;
  readonly recent: ReadonlyArray<RecentRow>;
  /** How many more ended than `recent` shows. */
  readonly recentMore: number;
}

/** "4m", "3h", "2d": an age as the board's numbers column shows it. */
export function shortAge(fromIso: string | null, nowMs: number): string {
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

/** A task's change, as the board links it: its pull request on GitHub, else its change in Mate. */
function changeLink(task: HqAppTask, appId: string): RecentRow["change"] {
  if (task.pullRequest !== null)
    return { label: pullRequestName(task.pullRequest), href: task.pullRequest.url, external: true };
  if (task.change !== null)
    return {
      label: `Change #${String(task.change.number)}`,
      href: changeRoutePath(appId, task.change.repo, task.change.number),
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

/**
 * The board's rows from HQ's tasks of the application, as of `nowMs`; `live` is what HQ's
 * navigation says of the tasks its Mates are on now, by id: a live row's cost, time and state
 * come from there, so they move as each report lands without the board read again.
 */
export function boardOf(
  tasks: ReadonlyArray<HqAppTask>,
  nowMs: number,
  appId = "",
  live: ReadonlyMap<string, HqNavigationMateTask> = new Map(),
  /** Whether HQ holds a Mate, by its project, on its open change (`heldOnItsChange`). */
  held: (projectId: string) => boolean = () => false,
): Board {
  const atWork: Array<AtWorkRow> = [];
  const blocked: Array<BlockedMate> = [];
  const reviewing = new Map<string, number>();
  const queued: Array<QueuedRow> = [];
  const ended: Array<RecentRow> = [];
  for (const task of tasks) {
    const route = taskRoute(task.link);
    const now = live.get(task.id);
    const status = liveStatus(task, now);
    if (status === "queued") {
      queued.push({
        id: task.id,
        position: task.position ?? queued.length + 1,
        title: task.title,
        source: task.label,
        url: task.url,
        waited: shortAge(task.createdAt, nowMs),
      });
    } else if (isLiveStatus(status)) {
      const workedMs = now?.workedMs ?? task.workedMs;
      atWork.push({
        id: task.id,
        title: task.title,
        mate: task.mate,
        status,
        worked: workedMs == null ? "—" : workedWords(workedMs),
        cost: costWords(now?.spentUsd ?? task.spentUsd),
        route,
      });
    } else {
      // Done with its change open: a Mate HQ holds waits for it while navigation still names it;
      // any other is free, its change counted among those waiting for review.
      const change = changeLink(task, appId);
      if (status === "review" && task.mate !== null && change !== null) {
        const { projectId } = task.mate;
        if (!held(projectId)) reviewing.set(projectId, (reviewing.get(projectId) ?? 0) + 1);
        else if (now !== undefined) blocked.push({ projectId, change });
      }
      ended.push({
        id: task.id,
        outcome: status,
        title: task.title,
        mate: task.mate?.name ?? null,
        when: endedWords(task.endedAt, nowMs) ?? "—",
        cost: costWords(now?.spentUsd ?? task.spentUsd),
        change,
        route,
        detail: task.state === "failed" || task.state === "stopped" ? task.detail : null,
      });
    }
  }
  queued.sort((a, b) => a.position - b.position);
  return {
    atWork,
    blocked,
    reviewing: [...reviewing].map(([projectId, count]) => ({ projectId, count })),
    queued,
    recent: ended.slice(0, RECENT_SHOWN),
    recentMore: Math.max(0, ended.length - RECENT_SHOWN),
  };
}

/**
 * How many rows each block will hold, from HQ's navigation while the board reads, so it keeps its
 * height when the read lands: At work, a row per Mate on a live task and a line per Mate waiting
 * on its change (its pull request open), plus one line for those that wait for a task; Queued, its
 * waiting tasks or the line saying none; Recent, the tasks navigation says ended, up to what it
 * shows, or the line saying none.
 */
export function predictedBoard(
  tasks: ReadonlyArray<HqNavigationMateTask | null | undefined>,
  waiting: number,
): { readonly atWork: number; readonly queued: number; readonly recent: number } {
  const known = tasks.filter((task) => task != null);
  const live = known.filter((task) => task.ended === undefined).length;
  const free = tasks.length - live;
  return {
    atWork: Math.max(1, live + (free > 0 ? 1 : 0)),
    queued: Math.max(1, waiting),
    recent: Math.min(RECENT_SHOWN, Math.max(1, known.length - live)),
  };
}

/** The pool as one line: its Mates by name (three at most), and how many. */
export function poolLine(names: ReadonlyArray<string>): string {
  if (names.length === 0) return "No automated Mates yet";
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` +${String(names.length - 3)}` : "";
  const count = `${String(names.length)} automated Mate${names.length === 1 ? "" : "s"}`;
  return `${shown}${more} · ${count}`;
}

/**
 * What the organization's automated Mates spent this month, against its budget where it set one;
 * `null` where HQ does not say (an older HQ).
 */
export function spendLine(limits: HqTaskLimitsView): string | null {
  if (limits.spentThisMonthUsd === undefined) return null;
  const spent = costWords(limits.spentThisMonthUsd);
  const budget = limits.monthlyBudgetUsd;
  if (budget == null) return `${spent} this month`;
  const cap = Number.isInteger(budget) ? `$${String(budget)}` : costWords(budget);
  return `${spent} of ${cap} this month${limits.spentThisMonthUsd >= budget ? " · spent" : ""}`;
}
