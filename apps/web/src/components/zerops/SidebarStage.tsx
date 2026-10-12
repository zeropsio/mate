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
  const { open } = useSidebar();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const state = useRef<PeekState>(PEEK_AT_REST);
  const timer = useRef<number | undefined>(undefined);
  const [shown, setShown] = useState(false);
  // The column steps over the page while the menu stands out, and until it is back in the rail;
  // its resize handle steps aside (`Sidebar`'s `layered`). Kept here, so a peek renders the stage
  // alone and never the menu under it.
  const [raised, setRaised] = useState(false);

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
              apply({ kind: "due", held: holdsPeek(stageRef.current) });
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
  useEffect(() => {
    if (peeking) {
      setRaised(true);
      return;
    }
    const settle = window.setTimeout(() => setRaised(false), PEEK_CLOSE_MS);
    return () => window.clearTimeout(settle);
  }, [peeking]);

  // Peeked, the pointer is followed on the whole page: a menu opened from the peek stands in a
  // portal, and once it closes nothing on the stage hears the pointer leave.
  useEffect(() => {
    if (!peeking) return;
    const onMove = (event: PointerEvent) => {
      const inside = event.target instanceof Node && stageRef.current?.contains(event.target);
      send(
        inside
          ? {
              kind: "enter",
              pointer: event.pointerType,
              x: event.clientX,
              y: event.clientY,
              on: "surface",
            }
          : { kind: "leave" },
      );
    };
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) send({ kind: "leave" });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) send({ kind: "close" });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerout", onOut);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [peeking, send]);

  if (rail === null) return children;
  const menu = open ? "docked" : peeking ? "peek" : "rest";
  const at = (kind: "enter" | "move") => (event: ReactPointerEvent) => {
    send({
      kind,
      pointer: event.pointerType,
      x: event.clientX,
      y: event.clientY,
      on:
        event.target instanceof Element && event.target.closest(RAIL_CONTROL)
          ? "control"
          : "surface",
    });
  };
  return (
    <div
      className="menu-stage"
      data-menu={menu}
      data-menu-raised={raised ? "" : undefined}
      data-zerops-surface="sidebar-stage"
      onPointerDownCapture={() => send({ kind: "press" })}
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

/** The rail's controls: a rest on one keeps its own hover and click, and never peeks. */
const RAIL_CONTROL = "a, button, input, [role='button']";

/**
 * Whether something inside the peek needs it to stay: a menu opened from it (a Mate's ···, the
 * account), or a field being typed in (a rename).
 */
function holdsPeek(stage: HTMLElement | null): boolean {
  if (stage === null) return false;
  if (stage.querySelector("[data-popup-open]") !== null) return true;
  const focused = document.activeElement;
  return (
    focused instanceof HTMLElement &&
    stage.contains(focused) &&
    (focused.matches("input, textarea") || focused.isContentEditable)
  );
}

/** Whether the open menu is out — docked or peeking — rather than waiting under the rail. */
export function sidebarMenuShown(): boolean {
  return document.querySelector('[data-zerops-surface="sidebar-menu"][inert]') === null;
}
