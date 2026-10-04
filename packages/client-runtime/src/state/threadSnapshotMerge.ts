import type { OrchestrationThread, OrchestrationThreadDetailSnapshot } from "@t3tools/contracts";

import { activityOrder } from "./threadReducer.ts";
import type { EnvironmentThreadPageState } from "./threadState.ts";

/**
 * A fresh first page (a reconnect, a resume the server couldn't serve) holds
 * the newest turns only. The older turns the client already holds stay below
 * it, whole, instead of leaving the screen: the server's next older page
 * would serve them as they are. They go only when the snapshot proves they
 * changed — a checkpoint the client held is gone, so a revert rewrote
 * history while it was away — or when the snapshot holds the whole thread.
 *
 * "Older" is older than the page's oldest message: a page holds whole turns,
 * each from its ask on, so a row before that belongs to a turn below it.
 */
export function mergeFirstPageSnapshot(input: {
  readonly held: OrchestrationThread | null;
  readonly heldPage: EnvironmentThreadPageState | null;
  readonly snapshot: OrchestrationThreadDetailSnapshot;
}): { readonly thread: OrchestrationThread; readonly page: EnvironmentThreadPageState | null } {
  const { held, heldPage, snapshot } = input;
  const fresh = snapshot.thread;
  const freshPage =
    snapshot.page === undefined
      ? null
      : {
          beforeCursor: snapshot.page.beforeCursor,
          hasMore: snapshot.page.hasMore,
          loadingOlder: false,
        };
  const replace = { thread: fresh, page: freshPage };
  if (held === null || held.id !== fresh.id || snapshot.page?.hasMore !== true) return replace;

  const standing = new Set(fresh.checkpoints.map((entry) => entry.turnId));
  if (held.checkpoints.some((entry) => !standing.has(entry.turnId))) return replace;

  const boundary = fresh.messages.reduce<string | null>(
    (oldest, entry) => (oldest === null || entry.createdAt < oldest ? entry.createdAt : oldest),
    null,
  );
  if (boundary === null) return replace;
  const pageTurns = new Set<string>(
    [...fresh.messages, ...fresh.activities].flatMap((entry) =>
      entry.turnId === null ? [] : [entry.turnId],
    ),
  );
  const isOlder = (entry: { readonly createdAt: string; readonly turnId: string | null }) =>
    entry.createdAt < boundary && (entry.turnId === null || !pageTurns.has(entry.turnId));

  const freshMessageIds = new Set(fresh.messages.map((entry) => entry.id));
  const olderMessages = held.messages.filter(
    (entry) => isOlder(entry) && !freshMessageIds.has(entry.id),
  );
  if (olderMessages.length === 0) return replace;
  const freshActivityIds = new Set(fresh.activities.map((entry) => entry.id));
  const olderActivities = held.activities.filter(
    (entry) => isOlder(entry) && !freshActivityIds.has(entry.id),
  );

  return {
    thread: {
      ...fresh,
      messages: [...olderMessages, ...fresh.messages],
      activities: [...olderActivities, ...fresh.activities].sort(activityOrder),
    },
    page: heldPage === null ? freshPage : { ...heldPage, loadingOlder: false },
  };
}
