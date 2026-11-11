export type ResponsiveSidebarState = "expanded" | "collapsed";

/**
 * Where the menu's toggle keeps whether it was left open (`"false"` closed), read again on reload
 * and by the first frame (index.html). Local storage, not a cookie: inside a cross-site frame a
 * cookie never sticks, and the frame's storage still keeps it.
 */
export const SIDEBAR_STATE_STORAGE_KEY = "mate:sidebar-state";

export function resolveSidebarState(input: {
  isMobile: boolean;
  open: boolean;
  openMobile: boolean;
}): ResponsiveSidebarState {
  return (input.isMobile ? input.openMobile : input.open) ? "expanded" : "collapsed";
}

/**
 * Where the closed menu's opener stands. On a phone the composer is the
 * screen's last thing, so the opener takes the top bar's start corner — the
 * place the open sheet's own control stands. Wider, the corner keeps the mark
 * and the opener the foot of the column the menu had. Open, the menu carries
 * its own controls.
 */
export function resolveSidebarOpenerPlacement(input: {
  isMobile: boolean;
  state: ResponsiveSidebarState;
}): "top" | "foot" | "none" {
  if (input.state === "expanded") return "none";
  return input.isMobile ? "top" : "foot";
}
