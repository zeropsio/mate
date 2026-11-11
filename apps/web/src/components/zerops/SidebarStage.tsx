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
import { memo, type ReactNode } from "react";

import { useSidebar } from "../ui/sidebar";

export function SidebarStage({
  rail,
  railHolds,
  children,
}: {
  /** The closed menu; none on a phone, where the menu is a sheet. */
  readonly rail: ReactNode | null;
  /** How many tiles the rail holds: covered, it is drawn again only when that changes. */
  readonly railHolds?: number;
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
        <RailUnderMenu covered={open} holds={railHolds}>
          {rail}
        </RailUnderMenu>
      </div>
      <div className="menu-stage-menu" data-zerops-surface="sidebar-menu" inert={!open}>
        <div className="menu-stage-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * The rail while the open menu covers it — unseen and inert — keeps its last drawing: its tiles,
 * their faces and tips are not drawn again for every Mate opened or word streamed. A tile coming
 * or going draws it, so its tiles are there to show; and it is drawn anew in the render that
 * closes the menu, before it shows.
 */
const RailUnderMenu = memo(
  function RailUnderMenu({
    children,
  }: {
    readonly covered: boolean;
    readonly holds: number | undefined;
    readonly children: ReactNode;
  }) {
    return children;
  },
  (previous, next) => previous.covered && next.covered && previous.holds === next.holds,
);

/** Whether the open menu is out rather than waiting under the rail. */
export function sidebarMenuShown(): boolean {
  return document.querySelector('[data-zerops-surface="sidebar-menu"][inert]') === null;
}
