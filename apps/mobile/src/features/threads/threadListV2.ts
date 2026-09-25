import {
  canSnooze,
  effectiveSettled,
  effectiveSnoozed,
  hasQueuedTurnStart,
  QUEUED_TURN_START_GRACE_MS,
  resolveSnoozePresets,
  snoozeWakeLabel,
} from "@t3tools/client-runtime/state/thread-settled";
import type {
  ChangeRequestSettleSource,
  SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { statusLabel } from "@t3tools/client-runtime/zerops/statusPresentation";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import {
  activeThreadAnchorTimestampMs,
  sortPinnedThreadsByOrderKey,
} from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  resolveThreadStatus,
  type ThreadStatus,
  type ThreadStatusToneId,
} from "@t3tools/shared/threadStatus";

import { relativeTime } from "../../lib/time";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";

export { snoozeWakeLabel };

export type ThreadListV2SwipeAction = "archive" | "settle" | "unsettle" | "snooze" | "unsnooze";

export type ThreadListV2ChangeRequestState = ChangeRequestSettleSource;

export function resolveThreadListV2ChangeRequestState(input: {
  readonly state: ChangeRequestSettleSource["state"] | null;
  readonly updatedAt: string | null;
}): ThreadListV2ChangeRequestState | null {
  if (input.state === null) return null;
  return {
    state: input.state,
    updatedAt: input.updatedAt,
  };
}

export function resolveThreadListV2SnoozeMenuSelection(input: {
  readonly event: string;
  readonly displayedPresets: ReadonlyArray<SnoozePreset>;
  readonly now: Date;
}):
  | { readonly _tag: "selected"; readonly preset: SnoozePreset }
  | { readonly _tag: "expired" }
  | { readonly _tag: "not-snooze" } {
  if (!input.event.startsWith("snooze:")) return { _tag: "not-snooze" };

  const currentPreset = resolveSnoozePresets(input.now).find(
    (candidate) => input.event === `snooze:${candidate.id}`,
  );
  if (currentPreset) return { _tag: "selected", preset: currentPreset };

  const displayedPreset = input.displayedPresets.find(
    (candidate) => input.event === `snooze:${candidate.id}`,
  );
  if (displayedPreset && Date.parse(displayedPreset.snoozedUntil) > input.now.getTime()) {
    return { _tag: "selected", preset: displayedPreset };
  }
  return { _tag: "expired" };
}

export function resolveThreadListV2SwipeActions(input: {
  readonly variant: "card" | "slim";
  readonly settlementSupported: boolean;
  readonly snoozeSupported: boolean;
  readonly snoozable: boolean;
  /** Row is on the snoozed shelf. */
  readonly snoozed?: boolean;
}): {
  readonly primary: Exclude<ThreadListV2SwipeAction, "snooze">;
  readonly secondary: "snooze" | null;
} {
  if (input.snoozed === true) {
    return { primary: "unsnooze", secondary: null };
  }
  const primary = input.settlementSupported
    ? input.variant === "slim"
      ? "unsettle"
      : "settle"
    : "archive";
  return {
    primary,
    secondary: input.snoozeSupported && input.snoozable ? "snooze" : null,
  };
}

/**
 * The point at which a queued-turn snooze guard expires on its own. Rows arm
 * a one-shot timer for this boundary so Snooze appears without waiting for an
 * unrelated render. User-blocked threads return null because only fresh
 * server data can make them snoozable.
 */
export function resolveThreadListV2SnoozeGateExpiryMs(
  thread: Pick<
    EnvironmentThreadShell,
    "hasPendingApprovals" | "hasPendingUserInput" | "latestUserMessageAt" | "latestTurn" | "session"
  >,
  options: { readonly now: string },
): number | null {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return null;
  if (!hasQueuedTurnStart(thread, options)) return null;
  const messageAtMs = Date.parse(thread.latestUserMessageAt ?? "");
  if (Number.isNaN(messageAtMs)) return null;
  return messageAtMs + QUEUED_TURN_START_GRACE_MS;
}

// Settled-tail paging: recent history is the common lookup; the deep tail
// stays behind an explicit Show more. Shared by the compact Home list and
// the iPad sidebar so both page identically.
export const THREAD_LIST_V2_SETTLED_INITIAL_COUNT = 10;
export const THREAD_LIST_V2_SETTLED_PAGE_COUNT = 25;

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

/** NaN-safe Date.parse for sort comparators: a malformed timestamp must not
    poison the whole ordering, so it sinks to the epoch instead. */
function parseTimestampMs(isoDate: string): number {
  const parsed = Date.parse(isoDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** First VALID timestamp wins: a present-yet-malformed string falls through
    to the next candidate rather than sinking the row to the epoch. */
function firstValidTimestampMs(...candidates: ReadonlyArray<string | null | undefined>): number {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
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
  readonly variant: "card" | "slim";
  /** Snoozed-shelf row: shows the wake countdown and offers Wake. */
  readonly snoozed: boolean;
  /** Pinned-block row: renders the pin glyph and offers Unpin. */
  readonly pinned: boolean;
  readonly isLast: boolean;
}

export interface ThreadListV2Layout {
  readonly items: ThreadListV2Item[];
  /** Settled threads beyond the render limit (behind "Show more"). */
  readonly hiddenSettledCount: number;
  /** Snoozed threads matching the current filters. */
  readonly snoozedCount: number;
  /** Index in `items` where the Snoozed shelf header belongs. The header is
      still rendered when the shelf is collapsed and no snoozed rows exist. */
  readonly snoozedShelfHeaderIndex: number | null;
  /** Total settled threads in scope, including rows hidden by collapse/paging. */
  readonly settledCount: number;
  /** Index in `items` where the Settled shelf header belongs. */
  readonly settledShelfHeaderIndex: number | null;
  /** Soonest wake time among snoozed threads, or null. Callers arm
      a timeout at this boundary so the list re-partitions the moment a
      snooze expires instead of on the next minute tick. */
  readonly nextSnoozeWakeAt: string | null;
}

export interface ThreadListV2ThreadListItem {
  readonly type: "v2-thread";
  readonly key: string;
  readonly item: ThreadListV2Item;
  /** Precomputed so recycled-list equality can see a minute-tick change. */
  readonly snoozeWakeLabelText: string | undefined;
  /** Row timestamp precomputed against the parent clock so the recycler's
      equality only sees a change on rows that actually draw a time. Blank
      while the row renders a status label or the wake countdown instead. */
  readonly timeLabel: string;
  /** Minute clock feeding the row's native snooze menu, carried only on rows
      whose menu holds snooze presets (capability-gated cards the user may
      snooze). Keeping it out of the list's `extraData` means the minute tick
      re-renders just these rows instead of every visible one. */
  readonly snoozePresetMinute: string | undefined;
  /** Inset hairline drawn under the row. Precomputed from the final order so
      a neighbour change (e.g. the queued block appearing) updates the row
      through recycled-list equality instead of leaving a stale divider. */
  readonly showTrailingDivider: boolean;
  /** A message for this thread is waiting in the outbox. Carried on the item
      so an outbox write (which never touches the thread shell) reaches the
      row through recycled-list equality instead of leaving a stale icon. */
  readonly hasQueuedMessages: boolean;
  /** Move up/down availability in the pinned block. Carried on the item for
      the same reason: a pinned reorder changes menu availability without
      changing the row's shell. */
  readonly canMovePinnedUp: boolean;
  readonly canMovePinnedDown: boolean;
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

export interface ThreadListV2SnoozedShelfListItem {
  readonly type: "v2-snoozed-shelf";
  readonly key: "v2-snoozed-shelf";
  readonly count: number;
  readonly expanded: boolean;
  /** Shelf preferences still loading: the toggle is disabled until they
      arrive. Carried on the item because a recycled cell ignores the render
      closure — without it the header would stay visibly disabled (or enabled
      too early) after the preference load lands. */
  readonly disabled: boolean;
}

export interface ThreadListV2SettledShelfListItem {
  readonly type: "v2-settled-shelf";
  readonly key: "v2-settled-shelf";
  readonly count: number;
  readonly expanded: boolean;
  /** See the snoozed shelf header's field. */
  readonly disabled: boolean;
}

export type ThreadListV2ListItem =
  | ThreadListV2ThreadListItem
  | ThreadListV2PendingListItem
  | ThreadListV2SnoozedShelfListItem
  | ThreadListV2SettledShelfListItem;

/** Narrows a wider list-item union (e.g. the sidebar's legacy + v2 mix) to
    the v2 item kinds the shared equality understands. */
export function isThreadListV2ListItem(value: {
  readonly type: string;
}): value is ThreadListV2ListItem {
  return (
    value.type === "v2-thread" ||
    value.type === "v2-pending" ||
    value.type === "v2-snoozed-shelf" ||
    value.type === "v2-settled-shelf"
  );
}

/** Recycled-list equality for the flat v2 list (Home + iPad sidebar).
    Item objects are rebuilt on every minute tick and every partition run;
    without this the lists would consider every mounted row changed and
    re-render all of them (each carrying a swipeable + a PR subscription).
    The clock-derived fields are per-row precomputed text, so a minute tick
    only flips equality on rows whose visible text (or snooze menu) actually
    moved. Thread references are stable across rebuilds. */
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
        previous.item.variant === item.item.variant &&
        previous.item.snoozed === item.item.snoozed &&
        previous.item.pinned === item.item.pinned &&
        previous.snoozeWakeLabelText === item.snoozeWakeLabelText &&
        previous.timeLabel === item.timeLabel &&
        previous.snoozePresetMinute === item.snoozePresetMinute &&
        previous.showTrailingDivider === item.showTrailingDivider &&
        previous.hasQueuedMessages === item.hasQueuedMessages &&
        previous.canMovePinnedUp === item.canMovePinnedUp &&
        previous.canMovePinnedDown === item.canMovePinnedDown
      );
    case "v2-pending":
      return (
        previous.type === "v2-pending" &&
        previous.key === item.key &&
        previous.pendingTask === item.pendingTask &&
        previous.showPendingDivider === item.showPendingDivider &&
        previous.showTrailingDivider === item.showTrailingDivider
      );
    case "v2-snoozed-shelf":
      return (
        previous.type === "v2-snoozed-shelf" &&
        previous.count === item.count &&
        previous.expanded === item.expanded &&
        previous.disabled === item.disabled
      );
    case "v2-settled-shelf":
      return (
        previous.type === "v2-settled-shelf" &&
        previous.count === item.count &&
        previous.expanded === item.expanded &&
        previous.disabled === item.disabled
      );
  }
}

/** The timestamp a row renders: its latest activity. Blank for cards that
    show a status label and snoozed rows with a wake countdown — those never
    draw a time, so their minute tick must not invalidate the cell. */
function resolveThreadListV2ItemTimeLabel(
  item: ThreadListV2Item,
  showSnoozeWakeLabel: boolean,
): string {
  const { thread, variant } = item;
  if (variant === "slim" && showSnoozeWakeLabel) return "";
  if (variant === "card" && threadListV2StatusPresentation(resolveThreadStatus(thread)).label) {
    return "";
  }
  return relativeTime(thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt);
}

/**
 * Builds the shared mobile order: active → pending → snoozed shelf → settled.
 * Pending tasks are waiting rather than asking, and parked work remains
 * reachable without competing with either the inbox or settled history.
 */
export function buildThreadListV2ListItems(input: {
  readonly items: ReadonlyArray<ThreadListV2Item>;
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  readonly snoozedCount?: number;
  readonly snoozedShelfExpanded?: boolean;
  readonly snoozedShelfHeaderIndex?: number | null;
  readonly settledCount?: number;
  readonly settledShelfExpanded?: boolean;
  readonly settledShelfHeaderIndex?: number | null;
  readonly snoozeLabelNow?: string;
  /** Environments whose server supports thread.snooze. Rows on other
      environments never carry the minute clock that feeds the snooze menu.
      Absent = no gating (tests). */
  readonly snoozeEnvironmentIds?: ReadonlySet<EnvironmentId>;
  /** Thread keys (`environmentId:threadId`) with a message waiting in the
      outbox; stamped onto the matching rows as `hasQueuedMessages`. */
  readonly queuedThreadKeys?: ReadonlySet<string>;
  /** The pinned block's order as `environmentId:threadId` keys; stamps Move
      up/down availability onto pinned rows, since a recycled cell ignores the
      render closure. Absent = never available (tests). */
  readonly pinnedOrderKeys?: ReadonlyArray<string>;
  /** True while the shelf expansion preferences are still loading; stamped
      onto both shelf headers so the disabled state reaches recycled cells. */
  readonly shelfPreferencesLoading?: boolean;
}): ThreadListV2ListItem[] {
  const threadItems = input.items.map((item): ThreadListV2ListItem => {
    const snoozeWakeLabelText =
      item.snoozed && item.thread.snoozedUntil != null && input.snoozeLabelNow !== undefined
        ? snoozeWakeLabel(item.thread.snoozedUntil, { now: input.snoozeLabelNow })
        : undefined;
    // The minute clock belongs on the item, not the list's extraData, so the
    // recycler's equality can confine the per-minute re-render to rows whose
    // snooze menu actually shows preset times. The swipe-revealed snooze menu
    // exists on slim rows too (the variant only swaps the primary action),
    // so the gate follows actual snooze availability, not the variant.
    const snoozePresetMinute =
      !item.snoozed &&
      input.snoozeLabelNow !== undefined &&
      (input.snoozeEnvironmentIds?.has(item.thread.environmentId) ?? true) &&
      canSnooze(item.thread, { now: input.snoozeLabelNow })
        ? input.snoozeLabelNow
        : undefined;
    const pinnedIndex = item.pinned
      ? (input.pinnedOrderKeys?.indexOf(`${item.thread.environmentId}:${item.thread.id}`) ?? -1)
      : -1;
    return {
      type: "v2-thread",
      key: `v2-thread:${item.thread.environmentId}:${item.thread.id}`,
      item,
      snoozeWakeLabelText,
      timeLabel: resolveThreadListV2ItemTimeLabel(item, snoozeWakeLabelText !== undefined),
      snoozePresetMinute,
      showTrailingDivider: false,
      hasQueuedMessages:
        input.queuedThreadKeys?.has(`${item.thread.environmentId}:${item.thread.id}`) === true,
      canMovePinnedUp: pinnedIndex > 0,
      canMovePinnedDown:
        pinnedIndex !== -1 && pinnedIndex < (input.pinnedOrderKeys?.length ?? 0) - 1,
    };
  });
  const pendingItems = input.pendingTasks.map((pendingTask, index): ThreadListV2ListItem => ({
    type: "v2-pending",
    key: `v2-${pendingTask.key}`,
    pendingTask,
    showPendingDivider: index === 0,
    showTrailingDivider: false,
  }));
  const snoozedCount = input.snoozedCount ?? 0;
  const snoozedShelfHeaderIndex = input.snoozedShelfHeaderIndex ?? null;
  const settledCount = input.settledCount ?? 0;
  const settledShelfHeaderIndex = input.settledShelfHeaderIndex ?? null;
  const activeEnd = snoozedShelfHeaderIndex ?? settledShelfHeaderIndex ?? threadItems.length;
  const snoozedEnd = settledShelfHeaderIndex ?? threadItems.length;
  const result: ThreadListV2ListItem[] = [...threadItems.slice(0, activeEnd), ...pendingItems];
  const shelfDisabled = input.shelfPreferencesLoading === true;
  if (snoozedShelfHeaderIndex !== null && snoozedCount > 0) {
    result.push({
      type: "v2-snoozed-shelf",
      key: "v2-snoozed-shelf",
      count: snoozedCount,
      expanded: input.snoozedShelfExpanded === true,
      disabled: shelfDisabled,
    });
    result.push(...threadItems.slice(snoozedShelfHeaderIndex, snoozedEnd));
  }
  if (settledShelfHeaderIndex !== null && settledCount > 0) {
    result.push({
      type: "v2-settled-shelf",
      key: "v2-settled-shelf",
      count: settledCount,
      expanded: input.settledShelfExpanded !== false,
      disabled: shelfDisabled,
    });
    result.push(...threadItems.slice(settledShelfHeaderIndex));
  }
  // Hairlines depend on the final neighbour, so they are stamped after the
  // splice: a recycled cell only re-renders when its divider actually flips.
  return result.map((entry, index) => {
    if (entry.type !== "v2-thread" && entry.type !== "v2-pending") return entry;
    const next = result[index + 1];
    const showTrailingDivider =
      next?.type === "v2-thread" || (next?.type === "v2-pending" && !next.showPendingDivider);
    return showTrailingDivider === entry.showTrailingDivider
      ? entry
      : { ...entry, showTrailingDivider };
  });
}

/**
 * Partitions visible threads into the active card block (creation order) and
 * the settled recency tail, matching the web v2 list. Mobile stores these
 * auto-settle preferences per device.
 */
export function buildThreadListV2Items(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environmentId: EnvironmentId | null;
  readonly projectRefs?: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }> | null;
  readonly searchQuery: string;
  readonly matchedThreadKeys?: ReadonlySet<string>;
  /** Per-row PR reported up by visible rows ("env:threadId" keys). */
  readonly changeRequestByKey?: ReadonlyMap<string, ThreadListV2ChangeRequestState>;
  /** Environments whose server supports thread.settle/unsettle. Threads on
      other environments never classify as settled — the user could neither
      un-settle nor pin them. Absent = no gating (tests). */
  readonly settlementEnvironmentIds?: ReadonlySet<EnvironmentId>;
  /** Environments whose server supports thread.snooze/unsnooze. Same
      contract as settlementEnvironmentIds. */
  readonly snoozeEnvironmentIds?: ReadonlySet<EnvironmentId>;
  readonly autoSettleAfterDays?: number;
  readonly autoSettleOnMerge?: boolean;
  /** Max settled rows to render; the rest are counted, not built. */
  readonly settledLimit?: number;
  /** Injectable for tests; defaults to now. */
  readonly now?: string;
  /** Second-precise clock for snooze classification. Callers pass a
      minute-quantized `now` for memoization; snooze wake times are
      second-precise, so classifying with the floored minute would hold a
      woken thread hidden for up to a minute. Defaults to `now`. */
  readonly snoozeNow?: string;
  /** Expands the snoozed shelf into rows. Collapsed is the default. */
  readonly snoozedShelfExpanded?: boolean;
  /** Expands the settled shelf into rows. Expanded is the default. */
  readonly settledShelfExpanded?: boolean;
  /** The selected thread remains visible on an otherwise collapsed shelf so
      a split-view detail can never lose its navigation row. */
  readonly selectedThreadKey?: string | null;
  /** Thread keys (`environmentId:threadId`) with a message waiting in the
      outbox. Such a thread has work the user is waiting on, so it stays in
      the active block even when the server has settled it. */
  readonly queuedThreadKeys?: ReadonlySet<string>;
}): ThreadListV2Layout {
  const now = input.now ?? new Date().toISOString();
  const snoozeNow = input.snoozeNow ?? now;
  const autoSettleAfterDays = input.autoSettleAfterDays ?? 3;
  const autoSettleOnMerge = input.autoSettleOnMerge ?? true;
  const query = input.searchQuery.trim().toLocaleLowerCase();
  const projectKeys = input.projectRefs
    ? new Set(input.projectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`))
    : null;

  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const settled: EnvironmentThreadShell[] = [];
  const snoozed: EnvironmentThreadShell[] = [];
  let nextSnoozeWakeAt: string | null = null;
  for (const thread of input.threads) {
    // Callers pass live (unarchived) shells; settled threads are among them
    // and partition into the tail via effectiveSettled.
    if (input.environmentId !== null && thread.environmentId !== input.environmentId) continue;
    if (projectKeys !== null && !projectKeys.has(`${thread.environmentId}:${thread.projectId}`)) {
      continue;
    }
    if (
      query.length > 0 &&
      !thread.title.toLocaleLowerCase().includes(query) &&
      input.matchedThreadKeys?.has(
        threadSearchMatchKey({
          environmentId: thread.environmentId,
          threadId: thread.id,
        }),
      ) !== true
    ) {
      continue;
    }
    const supportsSettlement = input.settlementEnvironmentIds?.has(thread.environmentId) ?? true;
    const supportsSnooze = input.snoozeEnvironmentIds?.has(thread.environmentId) ?? true;
    const changeRequest =
      thread.linkedPullRequest == null
        ? (input.changeRequestByKey?.get(`${thread.environmentId}:${thread.id}`) ?? null)
        : null;
    // Snooze outranks settlement and pinning until the thread wakes.
    if (supportsSnooze && effectiveSnoozed(thread, { now: snoozeNow })) {
      snoozed.push(thread);
      if (
        thread.snoozedUntil != null &&
        (nextSnoozeWakeAt === null ||
          parseTimestampMs(thread.snoozedUntil) < parseTimestampMs(nextSnoozeWakeAt))
      ) {
        nextSnoozeWakeAt = thread.snoozedUntil;
      }
      continue;
    }
    const hasQueuedMessages =
      input.queuedThreadKeys?.has(`${thread.environmentId}:${thread.id}`) === true;
    if (
      supportsSettlement &&
      !hasQueuedMessages &&
      effectiveSettled(thread, {
        now,
        autoSettleAfterDays,
        autoSettleOnMerge,
        changeRequest,
      })
    ) {
      settled.push(thread);
    } else if (thread.pinnedAt != null) {
      pinned.push(thread);
    } else {
      active.push(thread);
    }
  }

  const orderedActive = sortThreadsForListV2(active);
  const orderedSnoozed = [...snoozed].sort(
    (left, right) =>
      parseTimestampMs(left.snoozedUntil ?? "") - parseTimestampMs(right.snoozedUntil ?? ""),
  );
  const selectedThreadKey = input.selectedThreadKey ?? null;
  const visibleSnoozed =
    input.snoozedShelfExpanded === true
      ? orderedSnoozed
      : orderedSnoozed.filter(
          (thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey,
        );
  const orderedSettled = [...settled].sort(
    (left, right) =>
      firstValidTimestampMs(right.latestUserMessageAt, right.updatedAt) -
      firstValidTimestampMs(left.latestUserMessageAt, left.updatedAt),
  );
  const settledLimit = input.settledLimit ?? Number.POSITIVE_INFINITY;
  const pagedSettled =
    orderedSettled.length > settledLimit ? orderedSettled.slice(0, settledLimit) : orderedSettled;
  const selectedSettled = orderedSettled
    .slice(pagedSettled.length)
    .find((thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey);
  if (selectedSettled !== undefined) pagedSettled.push(selectedSettled);
  const visibleSettled =
    input.settledShelfExpanded !== false
      ? pagedSettled
      : pagedSettled.filter(
          (thread) => `${thread.environmentId}:${thread.id}` === selectedThreadKey,
        );

  const items: ThreadListV2Item[] = [];
  for (const thread of sortPinnedThreadsByOrderKey(pinned)) {
    items.push({
      thread,
      variant: "card",
      snoozed: false,
      pinned: true,
      isLast: false,
    });
  }
  for (const thread of orderedActive) {
    items.push({
      thread,
      variant: "card",
      snoozed: false,
      pinned: false,
      isLast: false,
    });
  }
  const snoozedShelfHeaderIndex = orderedSnoozed.length > 0 ? items.length : null;
  for (const thread of visibleSnoozed) {
    items.push({
      thread,
      variant: "slim",
      snoozed: true,
      pinned: false,
      isLast: false,
    });
  }
  const settledShelfHeaderIndex = orderedSettled.length > 0 ? items.length : null;
  for (const thread of visibleSettled) {
    items.push({
      thread,
      variant: "slim",
      snoozed: false,
      pinned: false,
      isLast: false,
    });
  }
  const last = items.at(-1);
  if (last) {
    items[items.length - 1] = { ...last, isLast: true };
  }
  return {
    items,
    hiddenSettledCount: orderedSettled.length - pagedSettled.length,
    snoozedCount: orderedSnoozed.length,
    snoozedShelfHeaderIndex,
    settledCount: orderedSettled.length,
    settledShelfHeaderIndex,
    nextSnoozeWakeAt,
  };
}
