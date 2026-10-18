/**
 * Automated work in Usage: an automated Mate's tasks (what each cost, how long it worked) as HQ's
 * task records hold them, and the month's automated spend against the organization's budget.
 *
 * @module usageAutomated.logic
 */
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import type { HqAppTask, HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import { formatUsd } from "@t3tools/shared/usageFormat";

import { formatWorkDuration } from "../chat/conversation.logic";

/** Where a task is followed: in this app where HQ links to it, else where HQ says. */
export type UsageTaskTarget =
  | { readonly kind: "conversation"; readonly environmentId: string; readonly threadId: string }
  | { readonly kind: "mate"; readonly projectId: string }
  | { readonly kind: "external"; readonly href: string };

/** HQ links a task to the hosted app (`mateTaskLink`): its own routes, followed in this app. */
export function usageTaskTarget(link: string | null): UsageTaskTarget | null {
  if (link === null) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.origin !== new URL(DEFAULT_HOSTED_APP_URL).origin)
    return { kind: "external", href: link };
  const [first, second, ...rest] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (first === undefined || second === undefined || rest.length > 0)
    return { kind: "external", href: link };
  return first === "mate"
    ? { kind: "mate", projectId: second }
    : { kind: "conversation", environmentId: first, threadId: second };
}

export interface UsageTaskRow {
  readonly id: string;
  readonly title: string;
  /** Where to follow it in Mate; null where HQ names none. */
  readonly target: UsageTaskTarget | null;
  readonly state: string;
  /** Null where its Mate never reported one: never a made-up zero. */
  readonly cost: string | null;
  readonly worked: string | null;
}

const STATE_WORDS: Readonly<Record<HqAppTask["state"], string>> = {
  queued: "Queued",
  assigned: "Starting",
  working: "Working",
  waiting: "Waiting",
  stopping: "Stopping",
  done: "Done",
  merged: "Merged",
  closed: "Closed",
  failed: "Failed",
  stopped: "Stopped",
  declined: "Declined",
};

/**
 * The tasks one automated Mate worked on in the report's period, newest first: one that started
 * before the period counts while it was still at work in it.
 */
export function usageMateTasks(input: {
  readonly tasks: ReadonlyArray<HqAppTask>;
  readonly mateProjectId: string;
  /** The report's period; `since` null: from the start. */
  readonly since: string | null;
  readonly until: string;
}): ReadonlyArray<UsageTaskRow> {
  const since = input.since === null ? -Infinity : Date.parse(input.since);
  const until = Date.parse(input.until);
  return input.tasks
    .flatMap((task) => {
      if (task.mate?.projectId !== input.mateProjectId || task.startedAt === null) return [];
      const started = Date.parse(task.startedAt);
      const ended = task.endedAt === null ? Infinity : Date.parse(task.endedAt);
      return started < until && ended >= since ? [{ task, started }] : [];
    })
    .toSorted((left, right) => right.started - left.started)
    .map(({ task }) => ({
      id: task.id,
      title: task.title,
      target: usageTaskTarget(task.link),
      state: STATE_WORDS[task.state],
      cost: task.spentUsd === null ? null : formatUsd(task.spentUsd),
      worked: task.workedMs === null ? null : formatWorkDuration(task.workedMs),
    }));
}

/** How many ended tasks of an application HQ lists, newest first (`ENDED_SHOWN` in HQ's board). */
const HQ_ENDED_LISTED = 20;

/** In place of "no tasks" where HQ's list may leave out some of the period's. */
export const USAGE_TASKS_CUT_WORDS =
  "Older tasks are not listed here; they are in the totals above.";

/**
 * Whether the period reaches back past the oldest ended task HQ's list holds, while that list is
 * full: a task of the period may then be missing from it. The totals come from the usage ledger
 * and stay whole either way.
 */
export function usageTaskListCut(input: {
  readonly tasks: ReadonlyArray<HqAppTask>;
  readonly since: string | null;
}): boolean {
  const ended = input.tasks.flatMap((task) =>
    task.endedAt === null ? [] : [Date.parse(task.endedAt)],
  );
  if (ended.length < HQ_ENDED_LISTED) return false;
  const since = input.since === null ? -Infinity : Date.parse(input.since);
  return since < Math.min(...ended);
}

export interface AutomatedBudget {
  readonly spent: string;
  readonly budget: string;
  /** Of the budget, capped at 1. */
  readonly share: number;
  readonly reached: boolean;
}

/** The month's automated spend against the budget; null while none is set. */
export function automatedBudget(limits: HqTaskLimitsView | null): AutomatedBudget | null {
  const budget = limits?.monthlyBudgetUsd;
  if (budget == null || limits?.spentThisMonthUsd === undefined) return null;
  const spent = limits.spentThisMonthUsd;
  return {
    spent: formatUsd(spent),
    budget: formatUsd(budget),
    share: budget <= 0 ? 1 : Math.min(1, spent / budget),
    reached: spent >= budget,
  };
}
