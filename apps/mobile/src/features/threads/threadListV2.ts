import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { statusLabel } from "@t3tools/client-runtime/zerops/statusPresentation";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { activeThreadAnchorTimestampMs } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  resolveThreadStatus,
  type ThreadStatus,
  type ThreadStatusToneId,
} from "@t3tools/shared/threadStatus";

import { relativeTime } from "../../lib/time";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";

const THREAD_LIST_V2_TONE_CLASS: Record<ThreadStatusToneId, string> = {
  attention: "text-adaptive-amber-700-300",
  input: "text-adaptive-indigo-600-300",
  active: "text-adaptive-sky-600-400",
  danger: "text-adaptive-red-700-300",
  plan: "text-adaptive-violet-700-300",
  success: "text-adaptive-emerald-700-300",
  neutral: "text-foreground-tertiary",
};

export function threadListV2StatusPresentation(status: ThreadStatus) {
  return {
    label: statusLabel(status.kind),
    className: THREAD_LIST_V2_TONE_CLASS[status.toneId],
  };
}

export function threadListV2FailureDetail(
  resolvedStatus: ThreadStatus,
  lastError: string | null | undefined,
): string | null {
  return resolvedStatus.kind === "failed" ? (lastError ?? null) : null;
}

/**
 * v2 sort: static order, newest anchor on top. Activity NEVER reorders the
 * list — a row holds its position between lifecycle transitions. The anchor
 * is creation time until an un-settle re-anchors it (see
 * activeThreadAnchorTimestampMs), so an un-settled thread surfaces at the
 * top instead of sinking back to its creation-order slot. Mirrors web's
 * sortThreadsForSidebar.
 */
export function sortThreadsForListV2<
  T extends {
    readonly id: string;
    readonly createdAt: string;
    readonly unsettledAt?: string | null | undefined;
  },
>(threads: readonly T[]): T[] {
  // .sort() on a copy, not .toSorted(): Hermes doesn't ship the ES2023
  // change-by-copy array methods.
  return [...threads].sort(
    (left, right) =>
      activeThreadAnchorTimestampMs(right) - activeThreadAnchorTimestampMs(left) ||
      left.id.localeCompare(right.id),
  );
}

export interface ThreadListV2Item {
  readonly thread: EnvironmentThreadShell;
  readonly isLast: boolean;
}

export interface ThreadListV2Layout {
  readonly items: ThreadListV2Item[];
}

export interface ThreadListV2ThreadListItem {
  readonly type: "v2-thread";
  readonly key: string;
  readonly item: ThreadListV2Item;
  /** Row timestamp precomputed against the parent clock so the recycler's
      equality only sees a change on rows that actually draw a time. Blank
      while the row renders a status label instead. */
  readonly timeLabel: string;
  /** Inset hairline drawn under the row. Precomputed from the final order so
      a neighbour change (e.g. the queued block appearing) updates the row
      through recycled-list equality instead of leaving a stale divider. */
  readonly showTrailingDivider: boolean;
  /** A message for this thread is waiting in the outbox. Carried on the item
      so an outbox write (which never touches the thread shell) reaches the
      row through recycled-list equality instead of leaving a stale icon. */
  readonly hasQueuedMessages: boolean;
}

export interface ThreadListV2PendingListItem {
  readonly type: "v2-pending";
  readonly key: string;
  readonly pendingTask: PendingNewTask;
  /** First queued row after the active block draws the PENDING divider. */
  readonly showPendingDivider: boolean;
  /** Same rule as the thread rows: a hairline unless the next row carries its
      own section rule or none follows. */
  readonly showTrailingDivider: boolean;
}

export type ThreadListV2ListItem = ThreadListV2ThreadListItem | ThreadListV2PendingListItem;

/** Narrows a wider list-item union (e.g. the sidebar's legacy + v2 mix) to
    the v2 item kinds the shared equality understands. */
export function isThreadListV2ListItem(value: {
  readonly type: string;
}): value is ThreadListV2ListItem {
  return value.type === "v2-thread" || value.type === "v2-pending";
}

/** Recycled-list equality for the flat v2 list (Home + iPad sidebar).
    Item objects are rebuilt on every minute tick; without this the lists
    would consider every mounted row changed and re-render all of them.
    Thread references are stable across rebuilds. */
export function threadListV2ListItemsAreEqual(
  previous: ThreadListV2ListItem,
  item: ThreadListV2ListItem,
): boolean {
  switch (item.type) {
    case "v2-thread":
      return (
        previous.type === "v2-thread" &&
        previous.key === item.key &&
        previous.item.thread === item.item.thread &&
        previous.timeLabel === item.timeLabel &&
        previous.showTrailingDivider === item.showTrailingDivider &&
        previous.hasQueuedMessages === item.hasQueuedMessages
      );
    case "v2-pending":
      return (
        previous.type === "v2-pending" &&
        previous.key === item.key &&
        previous.pendingTask === item.pendingTask &&
        previous.showPendingDivider === item.showPendingDivider &&
        previous.showTrailingDivider === item.showTrailingDivider
      );
  }
}

/** The timestamp a row renders: its latest activity. Blank for rows that
    show a status label — those never draw a time, so their minute tick must
    not invalidate the cell. */
function resolveThreadListV2ItemTimeLabel(item: ThreadListV2Item): string {
  const { thread } = item;
  if (threadListV2StatusPresentation(resolveThreadStatus(thread)).label) return "";
  return relativeTime(thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt);
}

/** Builds the shared mobile order: the threads, then what waits to be sent. */
export function buildThreadListV2ListItems(input: {
  readonly items: ReadonlyArray<ThreadListV2Item>;
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  /** Thread keys (`environmentId:threadId`) with a message waiting in the
      outbox; stamped onto the matching rows as `hasQueuedMessages`. */
  readonly queuedThreadKeys?: ReadonlySet<string>;
}): ThreadListV2ListItem[] {
  const threadItems = input.items.map((item): ThreadListV2ListItem => ({
    type: "v2-thread",
    key: `v2-thread:${item.thread.environmentId}:${item.thread.id}`,
    item,
    timeLabel: resolveThreadListV2ItemTimeLabel(item),
    showTrailingDivider: false,
    hasQueuedMessages:
      input.queuedThreadKeys?.has(`${item.thread.environmentId}:${item.thread.id}`) === true,
  }));
  const pendingItems = input.pendingTasks.map((pendingTask, index): ThreadListV2ListItem => ({
    type: "v2-pending",
    key: `v2-${pendingTask.key}`,
    pendingTask,
    showPendingDivider: index === 0,
    showTrailingDivider: false,
  }));
  const result: ThreadListV2ListItem[] = [...threadItems, ...pendingItems];
  // Hairlines depend on the final neighbour, so they are stamped after the
  // splice: a recycled cell only re-renders when its divider actually flips.
  return result.map((entry, index) => {
    const next = result[index + 1];
    const showTrailingDivider =
      next?.type === "v2-thread" || (next?.type === "v2-pending" && !next.showPendingDivider);
    return showTrailingDivider === entry.showTrailingDivider
      ? entry
      : { ...entry, showTrailingDivider };
  });
}

/** The visible threads in creation order, matching the web list. */
export function buildThreadListV2Items(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environmentId: EnvironmentId | null;
  readonly projectRefs?: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }> | null;
  readonly searchQuery: string;
  readonly matchedThreadKeys?: ReadonlySet<string>;
}): ThreadListV2Layout {
  const query = input.searchQuery.trim().toLocaleLowerCase();
  const projectKeys = input.projectRefs
    ? new Set(input.projectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`))
    : null;
  const active = input.threads.filter((thread) => {
    // A crewmate's thread is the crew's, never a row of the person's list.
    if (thread.crew !== undefined) return false;
    if (input.environmentId !== null && thread.environmentId !== input.environmentId) return false;
    if (projectKeys !== null && !projectKeys.has(`${thread.environmentId}:${thread.projectId}`)) {
      return false;
    }
    return (
      query.length === 0 ||
      thread.title.toLocaleLowerCase().includes(query) ||
      input.matchedThreadKeys?.has(
        threadSearchMatchKey({ environmentId: thread.environmentId, threadId: thread.id }),
      ) === true
    );
  });
  const items: ThreadListV2Item[] = sortThreadsForListV2(active).map((thread) => ({
    thread,
    isLast: false,
  }));
  const last = items.at(-1);
  if (last) items[items.length - 1] = { ...last, isLast: true };
  return { items };
}
