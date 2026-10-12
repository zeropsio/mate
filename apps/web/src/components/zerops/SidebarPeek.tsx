/**
 * The closed menu on a desktop and the open one, as one surface (`SidebarPeek.logic.ts`): the rail
 * rests over the open menu, which stays drawn — its rows, its scroll — however the menu stands.
 *
 * - At rest the menu is clipped to the rail's edge, hidden and out of the keyboard's way.
 * - A pointer resting on the rail peeks: the menu grows out of the rail's edge over the page, at
 *   the person's menu width, and nothing under it moves.
 * - Opened — from the rail, the peek or ⌘B — the menu docks where it stands, and only the page
 *   slides, its edge travelling with the menu's (`Sidebar`'s `layered`). Closing reverses it.
 *
 * The owner, 2026-10-12: "imo I'd go for peek, but it needs to be smooth and fully smoothly
 * connected to the open state".
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { useSidebar } from "../ui/sidebar";
import {
  PEEK_AT_REST,
  peekShown,
  peekStep,
  type PeekInput,
  type PeekState,
} from "./SidebarPeek.logic";

/** How long the menu takes to shrink back into the rail (`.menu-stage-menu`). */
const PEEK_CLOSE_MS = 180;

export function SidebarPeekStage({
  rail,
  children,
}: {
  /** The closed menu; none on a phone, where the menu is a sheet. */
  readonly rail: ReactNode | null;
  /** The open menu. */
  readonly children: ReactNode;
}) {
  const { open, setPeek } = useSidebar();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const state = useRef<PeekState>(PEEK_AT_REST);
  const timer = useRef<number | undefined>(undefined);
  const [shown, setShown] = useState(false);

  const send = useCallback((input: PeekInput) => {
    const apply = (next: PeekInput) => {
      const step = peekStep(state.current, next);
      state.current = step.state;
      setShown(peekShown(step.state));
      if (step.wait === "keep") return;
      window.clearTimeout(timer.current);
      timer.current =
        step.wait === null
          ? undefined
          : window.setTimeout(() => {
              // A menu opened from inside the peek (a Mate's ···, the account) holds it open.
              apply({
                kind: "due",
                held: stageRef.current?.querySelector("[data-popup-open]") != null,
              });
            }, step.wait);
    };
    apply(input);
  }, []);

  // Docked, the menu stands where the peek stood; closed, it waits for the pointer to come again.
  useEffect(() => {
    send({ kind: open ? "dock" : "close" });
  }, [open, send]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const peeking = shown && !open;
  // The column steps over the page while the menu stands out, and until it is back in the rail.
  useEffect(() => {
    if (peeking) {
      setPeek(true);
      return;
    }
    const settle = window.setTimeout(() => setPeek(false), PEEK_CLOSE_MS);
    return () => window.clearTimeout(settle);
  }, [peeking, setPeek]);

  useEffect(() => {
    if (!peeking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) send({ kind: "close" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [peeking, send]);

  if (rail === null) return children;
  const menu = open ? "docked" : peeking ? "peek" : "rest";
  const at = (kind: "enter" | "move") => (event: ReactPointerEvent) => {
    send({ kind, pointer: event.pointerType, x: event.clientX, y: event.clientY });
  };
  return (
    <div
      className="menu-stage"
      data-menu={menu}
      data-zerops-surface="sidebar-stage"
      onPointerEnter={at("enter")}
      onPointerLeave={() => send({ kind: "leave" })}
      onPointerMove={at("move")}
      ref={stageRef}
    >
      <div className="menu-stage-rail" inert={menu !== "rest"}>
        {rail}
      </div>
      <div className="menu-stage-menu" data-zerops-surface="sidebar-menu" inert={menu === "rest"}>
        <div className="menu-stage-body">{children}</div>
      </div>
    </div>
  );
}
