export type ResponsiveSidebarState = "expanded" | "collapsed";

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
