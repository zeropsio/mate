import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * A project's row moved by hand in the *Custom* order (`useProjectReorder`): pressed and pulled
 * more than a few px up or down, it starts the drag; a press that does not travel is the row's own
 * press. The press a drag ended in opens nothing.
 */
export function useRowDrag(
  onDragStart: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined,
) {
  const start = useRef<{ readonly y: number; readonly x: number; readonly id: number } | null>(
    null,
  );
  const dragged = useRef(false);
  return {
    /** Whether the press that just ended was a drag: its click is swallowed once. */
    swallowClick: () => {
      if (!dragged.current) return false;
      dragged.current = false;
      return true;
    },
    handlers:
      onDragStart === undefined
        ? {}
        : {
            onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
              dragged.current = false;
              if (event.pointerType !== "mouse" || event.button !== 0) return;
              // A press on one of the row's own controls is that control's.
              if ((event.target as HTMLElement).closest("[data-row-control]") !== null) return;
              start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
            },
            onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
              const from = start.current;
              if (from === null || from.id !== event.pointerId) return;
              if (Math.abs(event.clientY - from.y) < DRAG_FROM_PX) return;
              start.current = null;
              dragged.current = true;
              onDragStart(event);
            },
            onPointerUp: () => {
              start.current = null;
              // The click a drag ends in is swallowed — or, the pointer held by the drag, never
              // reaches the row's button — and the next press is the row's own either way.
              if (dragged.current) {
                setTimeout(() => {
                  dragged.current = false;
                }, 0);
              }
            },
          },
  };
}

/** How far a press travels before it is a drag of its project's row. */
const DRAG_FROM_PX = 5;
