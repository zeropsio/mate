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
  children,
}: {
  readonly projectId: string;
  /** Open: the selected band lights it, so it paints nothing of its own. */
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "menu-unit group/mate flex flex-col transition-colors",
        !active && "hover:bg-sidebar-row-hover has-[[data-popup-open]]:bg-sidebar-row-hover",
      )}
      data-zerops-mate-unit={projectId}
    >
      {children}
    </div>
  );
}
