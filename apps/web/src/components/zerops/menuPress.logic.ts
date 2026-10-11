/**
 * The Mate a press in the menu opens, lit from the press itself (the owner, 2026-10-12: "when I
 * click on a mate the bg should extremely smoothly immediately move to the new item, right now it
 * waits until the mate is fully loaded"). The menu reads the open Mate off the route, which
 * commits only once the conversation's guard and code have loaded; until then the press stands
 * for it. Its route arriving hands over, and another Mate or the overview opening takes it back.
 */

export interface MenuPress {
  readonly projectId: string;
  /** The Mate open when it was pressed. */
  readonly from: string | null;
  /** The overview was open when it was pressed. */
  readonly fromOverview: boolean;
}

/** What the route has open now. */
export interface MenuRouteNow {
  readonly active: string | null;
  readonly overviewOpen: boolean;
}

/** The press still stands for the open Mate: its route has not arrived, and nothing else opened. */
export function menuPressHeld(press: MenuPress, now: MenuRouteNow): boolean {
  if (now.active === press.projectId) return false;
  if (now.active !== null && now.active !== press.from) return false;
  return !(now.overviewOpen && !press.fromOverview);
}

/** The Mate the menu lights: the one pressed while its route is on its way, else the open one. */
export function menuLitMate(press: MenuPress | null, now: MenuRouteNow): string | null {
  return press !== null && menuPressHeld(press, now) ? press.projectId : now.active;
}
