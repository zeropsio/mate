import type { ClosedView, ClosedViewEntry } from "./closedViewStore";
import { type ThreadRightPanelState, useRightPanelStore } from "./rightPanelStore";

export interface ReopenOwnerState {
  /** Whether the tab's conversation still exists here. */
  ownerExists: boolean;
  /** A live list that lacks the conversation means it is gone; a stale one may just be behind. */
  shellLive: boolean;
  panel: ThreadRightPanelState;
}

/**
 * Picks the history entry the next reopen press restores, newest first. Entries whose tab
 * is already open are dropped. A conversation missing from a live list is skipped but kept;
 * anything not yet knowable stops the scan with no restore.
 */
export function planNextReopen(
  entries: readonly ClosedViewEntry[],
  ownerState: (entry: ClosedViewEntry) => ReopenOwnerState,
): { drop: ClosedViewEntry[]; restore: ClosedViewEntry | null } {
  const drop: ClosedViewEntry[] = [];
  for (const entry of entries) {
    const owner = ownerState(entry);
    if (!owner.ownerExists) {
      if (owner.shellLive) continue;
      break;
    }
    if (owner.panel.isOpen && owner.panel.surfaces.some((s) => s.id === entry.surface.id)) {
      drop.push(entry);
      continue;
    }
    return { drop, restore: entry };
  }
  return { drop, restore: null };
}

/**
 * Puts a closed tab back in its conversation's panel exactly as it was, and shows it.
 * A file tab needs the workspace it reads from.
 */
export function reopenClosedView(
  view: ClosedView,
  options: { readonly workspaceAvailable: boolean },
): boolean {
  const { surface } = view;
  if (!options.workspaceAvailable && (surface.kind === "files" || surface.kind === "file")) {
    return false;
  }
  useRightPanelStore.getState().restoreSurface(view.threadRef, surface);
  return true;
}
