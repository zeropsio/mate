/**
 * What the left menu's Mate rows decide on their own: how long a Mate has been
 * at it, when one has gone quiet, and what a key does on its row.
 */

/**
 * How long a working Mate has been at it, as its row's clock reads: minutes
 * and seconds for the first hour, then hours and minutes. It ticks, so it
 * counts up from the turn's start rather than saying how long ago that was.
 */
export function formatWorkingTime(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 3600)
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
  const minutes = Math.floor(seconds / 60);
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** A week: a Mate untouched for longer folds into its project's quiet Mates. */
export const QUIET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a Mate has gone quiet: resting for more than a week, nothing
 * unread, nothing waiting — and not the one whose conversation is open. A
 * Mate nobody can date (no conversation read yet) never folds: it may be
 * the busiest one there is.
 */
export function isQuietMate(
  activity:
    | {
        readonly face: string;
        readonly at: string;
        readonly unread: boolean;
      }
    | undefined,
  nowMs: number,
  active: boolean,
): boolean {
  if (activity === undefined || active || activity.unread) return false;
  if (activity.face !== "idle" && activity.face !== "done") return false;
  const at = Date.parse(activity.at);
  return Number.isFinite(at) && nowMs - at > QUIET_AFTER_MS;
}

/** What a key does on a Mate's row: j and k move, x stops it, e marks it read or unread. */
export type SidebarMateKeyAction = "next" | "previous" | "stop" | "unread";

export function sidebarMateKey(input: {
  readonly key: string;
  readonly modified: boolean;
}): SidebarMateKeyAction | undefined {
  if (input.modified) return undefined;
  switch (input.key) {
    case "j":
      return "next";
    case "k":
      return "previous";
    case "x":
    case "X":
      return "stop";
    case "e":
    case "E":
      return "unread";
    default:
      return undefined;
  }
}
