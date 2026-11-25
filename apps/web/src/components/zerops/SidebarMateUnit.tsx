import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * A Mate and its crew's line, one thing in the menu (the owner, 2026-09-29:
 * "why isn't crew included in the hover?"): one surface in the row's inset
 * and corners, lit under the pointer anywhere on it and while a menu of its
 * is open — its row's hover, so its menu takes the time's slot there too —
 * and, open, by the list's one band, which measures it
 * (`SidebarSelectedBand`). Its changes stand after it, rows of their own
 * with their own hover. With no crew it is its row alone, to the pixel.
 */
export function MateUnit({
  projectId,
  active,
  kid = false,
  children,
}: {
  readonly projectId: string;
  /** Open: the selected band lights it, so it paints nothing of its own. */
  readonly active: boolean;
  /**
   * A Mate under its open group's row: its whole unit 18 px in, so the group's Mates read as its
   * and its band and hover start where it does.
   */
  readonly kid?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        UNIT,
        kid && "ms-4.5",
        !active && "hover:bg-sidebar-row-hover has-[[data-popup-open]]:bg-sidebar-row-hover",
      )}
      data-zerops-mate-unit={projectId}
    >
      {children}
    </div>
  );
}

/**
 * The row's corners, which its hover and the selected band paint it in, and the ground under its
 * faces that a cluster's rings and "+N" are cut in (`--menu-ground`): the menu's, the row's hover,
 * or the band's while the row is the open one — the band's own from the press, lit at once while
 * the band comes under it (`data-band-arriving`). A row's line is never what a press lands on: its
 * words are replaced as they change, and an element replaced between press and release leaves no
 * click.
 */
const UNIT =
  "group/mate flex flex-col rounded-card transition-colors [--menu-ground:var(--color-sidebar)] hover:[--menu-ground:var(--color-sidebar-row-hover)] has-data-popup-open:[--menu-ground:var(--color-sidebar-row-hover)] has-[[aria-current=true]]:bg-transparent! has-[[aria-current=true]]:[--menu-ground:var(--color-sidebar-row-active)] data-band-arriving:bg-sidebar-row-active! data-band-arriving:transition-none! data-band-arriving:[--menu-ground:var(--color-sidebar-row-active)] [&_[data-zerops-row]_[data-slot=row-line]]:pointer-events-none";
