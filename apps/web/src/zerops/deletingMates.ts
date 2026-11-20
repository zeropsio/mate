/**
 * The Mates this tab asked the platform to delete, from its yes until neither the listing nor HQ
 * holds them.
 *
 * The platform answers a delete at once and takes the project off a few seconds later; between
 * the two the listing still holds it — as it was, then `DELETING`. Meanwhile its row in the menu
 * says so and does not open, its menu offers nothing, and the menu remembers nothing of it for
 * the next reload. The listing drops the project before HQ retires its Mate, and HQ's placement
 * keeps the row drawn until then, so a Mate is let go here only once neither the listing nor HQ
 * holds it. The platform's own `DELETING` speaks for a delete this tab never asked for — another
 * tab's, a colleague's.
 *
 * In memory only, per tab, and gone with the account: a reload reads the platform's word again.
 */
import { useSyncExternalStore } from "react";

import { PROJECT_GOING_STATUSES } from "@t3tools/client-runtime/zerops";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";

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

/** Every project still held as read now (`deletingHeldBy`): a Mate held by none is gone. */
export function settleDeletingMates(listed: ReadonlySet<string>): void {
  const kept = [...deleting].filter((projectId) => listed.has(projectId));
  if (kept.length === deleting.size) return;
  publish(new Set(kept));
}

/**
 * The projects that still hold a Mate: those the complete listing holds, and those HQ places
 * with a row (a press's unregistered record draws none). Unknown placements add nothing.
 */
export function deletingHeldBy(
  listed: ReadonlySet<string>,
  placements: ReadonlyMap<string, HqPlacement> | null,
): ReadonlySet<string> {
  if (placements === null) return listed;
  const placed = [...placements].flatMap(([projectId, placement]) =>
    "unregistered" in placement && placement.unregistered === true ? [] : [projectId],
  );
  return new Set([...listed, ...placed]);
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
