/**
 * The closed menu on a desktop and the open one, as one surface: the rail rests over the open
 * menu, which stays drawn — its rows, its scroll — however the menu stands.
 *
 * - Closed, the menu waits clipped to the rail's edge, hidden and out of the keyboard's way. A
 *   pointer resting on the rail never shows it (the owner, 2026-10-12: "it stems from the reveal..
 *   we should do tiles and just not do reveal").
 * - Opened — from the rail or ⌘B — the menu grows out of the rail's edge and docks, and only the
 *   page slides, its edge travelling with the menu's (`Sidebar`'s `layered`). Closing reverses it.
 */
import type { ReactNode } from "react";

import { useSidebar } from "../ui/sidebar";

export function SidebarStage({
  rail,
  children,
}: {
  /** The closed menu; none on a phone, where the menu is a sheet. */
  readonly rail: ReactNode | null;
  /** The open menu. */
  readonly children: ReactNode;
}) {
  const { open } = useSidebar();
  if (rail === null) return children;
  return (
    <div
      className="menu-stage"
      data-menu={open ? "docked" : "rest"}
      data-zerops-surface="sidebar-stage"
    >
      <div className="menu-stage-rail" inert={open}>
        {rail}
      </div>
      <div className="menu-stage-menu" data-zerops-surface="sidebar-menu" inert={!open}>
        <div className="menu-stage-body">{children}</div>
      </div>
    </div>
  );
}

/** Whether the open menu is out rather than waiting under the rail. */
export function sidebarMenuShown(): boolean {
  return document.querySelector('[data-zerops-surface="sidebar-menu"][inert]') === null;
}
