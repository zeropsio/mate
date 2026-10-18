/**
 * A project's task board, in words: what its automated Mates are on (at work), what waits for
 * them by its place (queued), and what ended (recent) — each row's status as one short word with
 * its tone for the dot, its time and its cost as the numbers column shows them, and where it opens.
 * Above it, the pool as one line and the organization's spend this month against its budget.
 */
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { changeRoutePath } from "@t3tools/shared/hqChanges";
import type { HqAppTask, HqTaskLimitsView } from "@t3tools/shared/hqIntake";

import { pullRequestName } from "~/zerops/automatedMate.logic";

/** How many ended tasks the board shows; HQ answers more. */
export const RECENT_SHOWN = 5;

/** A status dot's meaning: its colour is the component's. */
export type BoardTone =
  | "starting"
  | "working"
  | "waiting"
  | "review"
  | "done"
  | "merged"
  | "failed"
  | "stopped";

export interface BoardStatus {
  readonly word: string;
  readonly tone: BoardTone;
}

export interface AtWorkRow {
  readonly id: string;
  readonly title: string;
  readonly mate: HqAppTask["mate"];
  readonly status: BoardStatus;
  /** Since its Mate took it (or was handed it), as a short age. */
  readonly elapsed: string;
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
  readonly outcome: BoardStatus;
  readonly title: string;
  readonly mate: string | null;
  /** Since it ended. */
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

export interface Board {
  readonly atWork: ReadonlyArray<AtWorkRow>;
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

const AT_WORK: Partial<Record<HqAppTask["state"], BoardStatus>> = {
  assigned: { word: "Starting", tone: "starting" },
  working: { word: "Working", tone: "working" },
  waiting: { word: "Needs an answer", tone: "waiting" },
};

function outcomeOf(task: HqAppTask): BoardStatus {
  switch (task.state) {
    case "done":
      return task.change === null
        ? { word: "Done", tone: "done" }
        : { word: "Up for review", tone: "review" };
    case "merged":
      return { word: "Merged", tone: "merged" };
    case "failed":
      return { word: "Failed", tone: "failed" };
    case "declined":
      return { word: "Declined", tone: "stopped" };
    default:
      return { word: "Stopped", tone: "stopped" };
  }
}

/** Where a task's link opens inside Mate: its path, where it was made for Mate's own address. */
export function taskRoute(link: string | null): string | null {
  if (link === null || !link.startsWith(`${DEFAULT_HOSTED_APP_URL}/`)) return null;
  return link.slice(DEFAULT_HOSTED_APP_URL.length);
}

/** The board's rows from HQ's tasks of the application, as of `nowMs`. */
export function boardOf(tasks: ReadonlyArray<HqAppTask>, nowMs: number, appId = ""): Board {
  const atWork: Array<AtWorkRow> = [];
  const queued: Array<QueuedRow> = [];
  const ended: Array<RecentRow> = [];
  for (const task of tasks) {
    const route = taskRoute(task.link);
    const live = AT_WORK[task.state];
    if (task.state === "queued") {
      queued.push({
        id: task.id,
        position: task.position ?? queued.length + 1,
        title: task.title,
        source: task.label,
        url: task.url,
        waited: shortAge(task.createdAt, nowMs),
      });
    } else if (live !== undefined) {
      atWork.push({
        id: task.id,
        title: task.title,
        mate: task.mate,
        status: live,
        elapsed: shortAge(task.startedAt ?? task.createdAt, nowMs),
        cost: costWords(task.spentUsd),
        route,
      });
    } else {
      ended.push({
        id: task.id,
        outcome: outcomeOf(task),
        title: task.title,
        mate: task.mate?.name ?? null,
        when: shortAge(task.endedAt, nowMs),
        cost: costWords(task.spentUsd),
        change:
          task.pullRequest !== null
            ? {
                label: pullRequestName(task.pullRequest),
                href: task.pullRequest.url,
                external: true,
              }
            : task.change !== null
              ? {
                  label: `Change #${String(task.change.number)}`,
                  href: changeRoutePath(appId, task.change.repo, task.change.number),
                  external: false,
                }
              : null,
        route,
        detail: task.state === "failed" || task.state === "stopped" ? task.detail : null,
      });
    }
  }
  queued.sort((a, b) => a.position - b.position);
  return {
    atWork,
    queued,
    recent: ended.slice(0, RECENT_SHOWN),
    recentMore: Math.max(0, ended.length - RECENT_SHOWN),
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
