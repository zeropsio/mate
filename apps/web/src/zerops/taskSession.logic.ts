/**
 * A task's session, as its conversation's header draws it: where the task stands in one word, what
 * it cost and how long it worked as its Mate last reported, the change and pull request it made,
 * and whether a person can stop it now. The Mate's latest task is read from HQ's navigation (live);
 * a task before it from the task's own record (`HqAppTask`, the application's task board).
 */
import type { MateTaskSource } from "@t3tools/contracts";
import type { HqPullRequest } from "@t3tools/shared/hqGithub";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";

import { taskChain, type TaskChain } from "./automatedMate.logic";

export type TaskStatus =
  | "queued"
  | "working"
  | "waiting"
  | "stopping"
  | "review"
  | "merged"
  | "closed"
  | "done"
  | "failed"
  | "stopped"
  | "declined";

/** Each status in a word or two, as the header says it beside its dot. */
export const TASK_STATUS_WORDS: Record<TaskStatus, string> = {
  queued: "Queued",
  working: "Working",
  waiting: "Waiting for you",
  stopping: "Stopping",
  review: "Up for review",
  merged: "Merged",
  closed: "Closed",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  declined: "Not taken",
};

export interface TaskSessionInput {
  /** The task the conversation's first message brought. */
  readonly source: MateTaskSource;
  /** Its Mate's latest task (`HqNavigationMate.task`): `undefined` while not read. */
  readonly current: HqNavigationMateTask | null | undefined;
  /** Its Mate is at work now. */
  readonly working: boolean;
  /** The task's own record on its application's board, when read. */
  readonly record: HqAppTask | undefined;
  /** The person asked HQ to stop it, and HQ took the stop. */
  readonly stopAsked: boolean;
}

export interface TaskSession {
  /** Not known: nothing is said. */
  readonly status: TaskStatus | null;
  /** HQ's task, to stop it by. */
  readonly taskId: string | null;
  readonly stoppable: boolean;
  readonly workedMs: number | null;
  readonly spentUsd: number | null;
  readonly change: { readonly repo: string; readonly number: number } | null;
  readonly pullRequest: HqPullRequest | null;
}

const UNKNOWN: TaskSession = {
  status: null,
  taskId: null,
  stoppable: false,
  workedMs: null,
  spentUsd: null,
  change: null,
  pullRequest: null,
};

const LIVE: ReadonlySet<TaskStatus> = new Set(["queued", "working", "waiting"]);

/** A finished task by its pull request: merged or closed say so; open is up for review. */
function finished(pullRequest: HqPullRequest | undefined | null, reviewable: boolean): TaskStatus {
  if (pullRequest?.state === "merged") return "merged";
  if (pullRequest?.state === "closed") return "closed";
  return pullRequest != null || reviewable ? "review" : "done";
}

/** Where the Mate's latest task stands (`taskChain`); `undefined`: it is not this one, or unread. */
function fromChain(chain: TaskChain): TaskStatus | undefined {
  switch (chain.kind) {
    case "unknown":
    case "earlier":
      return undefined;
    case "ended":
      return chain.ended === "done" ? finished(chain.pullRequest, false) : chain.ended;
    case "working":
    case "waiting":
    case "review":
      return chain.kind;
    case "pull-request":
      return finished(chain.pullRequest, true);
  }
}

function fromRecord(task: HqAppTask): TaskStatus {
  switch (task.state) {
    case "queued":
    case "assigned":
      return "queued";
    case "done":
      return finished(
        task.pullRequest === null ? null : { ...task.pullRequest, state: "open" },
        task.change !== null,
      );
    default:
      return task.state;
  }
}

export function taskSession(input: TaskSessionInput): TaskSession {
  const { current, record } = input;
  const fromNavigation = fromChain(taskChain(input.source, current, input.working));
  const mine = fromNavigation === undefined ? undefined : (current ?? undefined);
  const status = fromNavigation ?? (record === undefined ? undefined : fromRecord(record));
  if (status === undefined) return UNKNOWN;
  const live = LIVE.has(status);
  const recordPr = record?.pullRequest ?? null;
  return {
    status: live && input.stopAsked ? "stopping" : status,
    taskId: mine?.id ?? record?.id ?? null,
    stoppable: live && !input.stopAsked,
    workedMs: mine?.workedMs ?? record?.workedMs ?? null,
    spentUsd: mine?.spentUsd ?? record?.spentUsd ?? null,
    change: record?.change ?? null,
    pullRequest:
      mine?.pullRequest ??
      (recordPr === null
        ? null
        : { ...recordPr, state: record?.state === "merged" ? "merged" : "open" }),
  };
}

/** How long a task worked, at the minute its Mate reports it: "<1m", "12m", "1h 04m". */
export function workedWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** What a task cost in US dollars, to the cent: "$0.42", "<$0.01". */
export function spentWords(usd: number): string {
  if (usd > 0 && usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}
