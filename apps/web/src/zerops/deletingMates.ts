/**
 * The Mates this tab asked the platform to delete, from its yes until the listing lets them go.
 *
 * The platform answers a delete at once and takes the project off a few seconds later; between
 * the two the listing still holds it — as it was, then `DELETING`. Meanwhile its row in the menu
 * says so and does not open, its menu offers nothing, and the menu remembers nothing of it for
 * the next reload. A Mate the listing no longer holds is let go here; the platform's own
 * `DELETING` speaks for a delete this tab never asked for — another tab's, a colleague's.
 *
 * In memory only, per tab, and gone with the account: a reload reads the platform's word again.
 */
import { useSyncExternalStore } from "react";

import { PROJECT_GOING_STATUSES } from "~/components/zerops/ZeropsDeleteMateDialog.logic";

import { onAccountLifetimeClose } from "./accountLifetime";

let deleting: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>): void {
  deleting = next;
  for (const listener of listeners) listener();
}

/** The projects of the Mates this tab is deleting. */
export function deletingMates(): ReadonlySet<string> {
  return deleting;
}

/** The platform accepted this Mate's delete. */
export function markMateDeleting(projectId: string): void {
  if (deleting.has(projectId)) return;
  publish(new Set([...deleting, projectId]));
}

/** The listing as read now, complete: a Mate it no longer holds is gone. */
export function settleDeletingMates(listed: ReadonlySet<string>): void {
  const kept = [...deleting].filter((projectId) => listed.has(projectId));
  if (kept.length === deleting.size) return;
  publish(new Set(kept));
}

export function subscribeDeletingMates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The projects of the Mates this tab is deleting, for a surface that draws them. */
export function useDeletingMates(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeDeletingMates, deletingMates, deletingMates);
}

/** Whether a Mate is on its way off Zerops: this tab asked, or the platform says so. */
export function mateDeleting(
  project: { readonly id: string; readonly status: string },
  asked: ReadonlySet<string>,
): boolean {
  return asked.has(project.id) || PROJECT_GOING_STATUSES.has(project.status);
}

onAccountLifetimeClose(() => {
  if (deleting.size > 0) publish(new Set());
});
