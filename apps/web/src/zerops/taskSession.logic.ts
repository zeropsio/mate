/**
 * A task's session, as its conversation's header draws it: where the task stands in one word, what
 * it cost and how long it worked as its Mate last reported, the change and pull request it made,
 * and whether a person can stop it now. The Mate's latest task is read from HQ's navigation (live);
 * a task before it from the task's own record (`HqAppTask`, the application's task board).
 */
import type { TaskStopAction } from "@t3tools/client-runtime/data";
import type { MateTaskSource } from "@t3tools/contracts";
import type { HqPullRequest } from "@t3tools/shared/hqGithub";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";

import { taskChain } from "./automatedMate.logic";
import { isLiveStatus, isStoppableStatus, recordStatus, type TaskStatus } from "./taskStatus";

export interface TaskSessionInput {
  /** The task the conversation's first message brought. */
  readonly source: MateTaskSource;
  /** HQ's id of the conversation's task (`mateTaskIdOfConversation`); `null` where it names none. */
  readonly taskId: string | null;
  /** Its Mate's latest task (`HqNavigationMate.task`): `undefined` while not read. */
  readonly current: HqNavigationMateTask | null | undefined;
  /** Its Mate is at work now. */
  readonly working: boolean;
  /** The task's own record on its application's board, by its id (`recordOf`), when read. */
  readonly record: HqAppTask | undefined;
  /** The person may stop it: an Owner or Admin, as HQ's `keep_intake` asks. */
  readonly canStop: boolean;
  /** Where this account's stop of it stands (`appTaskStops`); absent: none asked. */
  readonly stop?: TaskStopAction | undefined;
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

/**
 * Where the Mate's latest task stands, as navigation says it, while it is this one. HQ says a task
 * its Mate finished, whose change still waits for review (`done`); one navigation names without
 * `ended` or `done` is live — an older HQ says neither, so its record says which; a pull request
 * open says it is up for review; else it is at work, between its runs. `undefined`: it is not
 * this one, or not read.
 */
function fromNavigation(input: TaskSessionInput): TaskStatus | undefined {
  const chain = taskChain(input.source, input.current, input.working, input.taskId);
  switch (chain.kind) {
    case "unknown":
    case "earlier":
      return undefined;
    case "ended":
      // Done, with a pull request it left open: up for review.
      return chain.ended === "done" && chain.pullRequest !== undefined
        ? chain.pullRequest.state === "open"
          ? "review"
          : chain.pullRequest.state
        : chain.ended;
    case "working":
    case "waiting":
    case "stopping":
      return chain.kind;
    case "pull-request":
      return chain.pullRequest.state === "open" ? "review" : chain.pullRequest.state;
    case "done":
      return chain.pullRequest === undefined || chain.pullRequest.state === "open"
        ? "review"
        : chain.pullRequest.state;
    case "at-rest": {
      const recorded = input.record === undefined ? undefined : recordStatus(input.record);
      if (recorded === "review" || recorded === "starting") return recorded;
      // Its Mate holds it: never queued, and not over while navigation says it is not.
      return "working";
    }
  }
}

/** The conversation's task on its application's board, by HQ's id. `undefined`: none, or not read. */
export function recordOf(
  taskId: string | null,
  tasks: ReadonlyArray<HqAppTask> | null,
): HqAppTask | undefined {
  if (taskId === null) return undefined;
  return tasks?.find((task) => task.id === taskId);
}

export function taskSession(input: TaskSessionInput): TaskSession {
  const { current, record } = input;
  const said = fromNavigation(input);
  // HQ's record says a stop was taken before navigation does: it is stopping.
  const live =
    said !== undefined && isStoppableStatus(said) && record?.state === "stopping"
      ? "stopping"
      : said;
  const mine = live === undefined ? undefined : (current ?? undefined);
  const status = live ?? (record === undefined ? undefined : recordStatus(record));
  if (status === undefined) return UNKNOWN;
  // A stop sent and not yet shown in what HQ says: it is stopping from the press on.
  const pressed = input.stop?.kind === "working" && isLiveStatus(status);
  const shown: TaskStatus = pressed ? "stopping" : status;
  const taskId = input.taskId ?? mine?.id ?? record?.id ?? null;
  const recordPr = record?.pullRequest ?? null;
  return {
    status: shown,
    taskId,
    stoppable: input.canStop && taskId !== null && isStoppableStatus(shown),
    workedMs: mine?.workedMs ?? record?.workedMs ?? null,
    spentUsd: mine?.spentUsd ?? record?.spentUsd ?? null,
    change: record?.change ?? null,
    pullRequest:
      mine?.pullRequest ??
      (recordPr === null
        ? null
        : {
            ...recordPr,
            state:
              record?.state === "merged"
                ? "merged"
                : record?.state === "closed"
                  ? "closed"
                  : "open",
          }),
  };
}

/** What a task cost in US dollars, to the cent: "$0.42", "<$0.01". */
export function spentWords(usd: number): string {
  if (usd > 0 && usd < 0.005) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}
