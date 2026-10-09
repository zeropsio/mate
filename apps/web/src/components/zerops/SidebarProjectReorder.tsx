/**
 * Arranging the left menu's projects by hand, in the *Custom* order.
 *
 * A project heading wears a grip, on hover, first of its verbs: inside its
 * band and clear of the band's rounded ends, so the name never moves to make
 * room and the grip is never squeezed into a corner. Dragging it
 * draws one line in the gap the project would land in — never a gap opening
 * up, which would push every project under it about while the pointer is
 * still deciding — and a small copy of the name follows the pointer. The drop
 * is the only moment anything moves.
 *
 * The same arrangement is the keyboard's too: the grip moves its project one
 * place with the arrow keys, and the project's menu has *Move up* and *Move
 * down* from any order. Every move is said out loud for a screen reader.
 */
import { GripVerticalIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

/** A drawn project: what a drag needs to know of it. */
export interface ReorderableProject {
  readonly groupId: string;
  readonly name: string;
}

/**
 * Where a project dropped at `pointerY` lands, among the drawn sections other
 * than its own: in front of the first whose middle lies below the pointer,
 * else last. Pure over the sections' boxes, so it is tested without a DOM.
 */
export function dropTarget(
  sections: ReadonlyArray<{
    readonly groupId: string;
    readonly top: number;
    readonly height: number;
  }>,
  pointerY: number,
): string | null {
  const hit = sections.find((section) => pointerY < section.top + section.height / 2);
  return hit === undefined ? null : hit.groupId;
}

/** The project a keyboard move lands in front of: one place up, or one place down. */
export function keyboardTarget(
  visible: ReadonlyArray<string>,
  groupId: string,
  direction: "up" | "down",
): string | null | undefined {
  const at = visible.indexOf(groupId);
  if (at === -1) return undefined;
  if (direction === "up") return at === 0 ? undefined : visible[at - 1];
  if (at === visible.length - 1) return undefined;
  return visible[at + 2] ?? null;
}

/** "Notes moved to 2 of 5." — what a move says, to whoever cannot see it. */
export function movedAnnouncement(name: string, position: number, total: number): string {
  return `${name} moved to ${String(position)} of ${String(total)}.`;
}

interface DragState {
  readonly groupId: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** In front of which project it would land; `undefined` before the pointer moves. */
  readonly before: string | null | undefined;
  /** The drop line's top, in the tree's own box. */
  readonly lineTop: number | undefined;
}

/** The nearest ancestor that scrolls, so a drag can carry the list along. */
function scrollParentOf(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node !== null) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** The room a project keeps above itself; the first keeps none, so its line takes 16px. */
function roomAbove(section: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(section).marginTop) || 16;
}

function drawnSections(tree: HTMLElement, except: string) {
  const sections = Array.from(tree.querySelectorAll<HTMLElement>("section[data-zerops-group]"));
  const source = sections.find((section) => section.dataset.zeropsGroup === except);
  return sections.filter(
    (section) =>
      section.dataset.zeropsGroup !== except &&
      section.dataset.zeropsProjectSection === source?.dataset.zeropsProjectSection,
  );
}

export interface ProjectReorder {
  /** The project being dragged, drawn faded where it still stands. */
  readonly dragging: string | null;
  readonly startDrag: (
    project: ReorderableProject,
    event: ReactPointerEvent<HTMLElement>,
    commit: (groupId: string, before: string | null) => void,
  ) => void;
  /** Says a finished move out loud. */
  readonly announce: (message: string) => void;
  /** The line, the name under the pointer and the spoken word; mounted inside the tree. */
  readonly overlay: ReactNode;
}

export function useProjectReorder(treeRef: RefObject<HTMLElement | null>): ProjectReorder {
  const [drag, setDrag] = useState<DragState | null>(null);
  // The drag as the pointer last left it, and what a drop does: read by the
  // window's listeners, which outlive any one render.
  const live = useRef<{
    drag: DragState | null;
    commit: ((groupId: string, before: string | null) => void) | null;
  }>({ drag: null, commit: null });
  const [spoken, setSpoken] = useState("");

  const update = useCallback((next: DragState | null) => {
    live.current.drag = next;
    setDrag(next);
  }, []);

  const startDrag = useCallback(
    (
      project: ReorderableProject,
      event: ReactPointerEvent<HTMLElement>,
      commit: (groupId: string, before: string | null) => void,
    ) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      live.current.commit = commit;
      update({
        groupId: project.groupId,
        name: project.name,
        x: event.clientX,
        y: event.clientY,
        before: undefined,
        lineTop: undefined,
      });
    },
    [update],
  );

  const draggingId = drag?.groupId ?? null;
  useEffect(() => {
    if (draggingId === null) return;
    const tree = treeRef.current;
    const scroller = scrollParentOf(tree);
    const onMove = (event: PointerEvent) => {
      const current = live.current.drag;
      if (tree === null || current === null) return;
      if (scroller !== null) {
        const box = scroller.getBoundingClientRect();
        if (event.clientY < box.top + 36) scroller.scrollTop -= 12;
        else if (event.clientY > box.bottom - 36) scroller.scrollTop += 12;
      }
      const sections = drawnSections(tree, draggingId);
      const before = dropTarget(
        sections.map((section) => {
          const box = section.getBoundingClientRect();
          return { groupId: section.dataset.zeropsGroup ?? "", top: box.top, height: box.height };
        }),
        event.clientY,
      );
      // The line sits in the middle of the room above the project it lands
      // before: a full breath between projects, a sliver in a run of
      // collapsed ones.
      const landing = sections.find((section) => section.dataset.zeropsGroup === before);
      const last = sections.at(-1);
      const lineTop =
        landing !== undefined
          ? landing.offsetTop - Math.round(roomAbove(landing) / 2) - 1
          : last !== undefined
            ? last.offsetTop + last.offsetHeight + 7
            : undefined;
      update({ ...current, x: event.clientX, y: event.clientY, before, lineTop });
    };
    const onUp = () => {
      const current = live.current.drag;
      update(null);
      if (current !== null && current.before !== undefined) {
        live.current.commit?.(current.groupId, current.before);
      }
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      update(null);
    };
    const onCancel = () => {
      update(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [draggingId, treeRef, update]);

  const overlay = (
    <>
      {drag === null || drag.lineTop === undefined ? null : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-ring before:absolute before:-start-0.5 before:-top-[3px] before:size-2 before:rounded-full before:border-2 before:border-ring before:bg-sidebar"
          data-zerops-surface="sidebar-project-drop-line"
          style={{ top: drag.lineTop }}
        />
      )}
      {drag === null || drag.before === undefined ? null : (
        <span
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded-lg border border-border bg-popover px-3 py-1 text-base font-semibold tracking-tight whitespace-nowrap text-popover-foreground shadow-lg"
          data-zerops-surface="sidebar-project-drag-name"
          style={{ left: drag.x + 12, top: drag.y - 16 }}
        >
          {drag.name}
        </span>
      )}
      <span aria-live="polite" className="sr-only" role="status">
        {spoken}
      </span>
    </>
  );

  return { dragging: draggingId, startDrag, announce: setSpoken, overlay };
}

/**
 * The grip on a heading in the *Custom* order: a 28 px verb before + and ⋯,
 * in their slot, so it shows whenever they do — under the pointer, while a
 * menu of the heading's is open, on focus, and always to a finger — and the
 * name never moves for it.
 */
export function ProjectGrip({
  name,
  groupId,
  onPointerDown,
  onMove,
}: {
  readonly name: string;
  readonly groupId: string;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onMove: (direction: "up" | "down") => void;
}) {
  return (
    <button
      aria-label={`Move ${name}: drag, or use the arrow keys`}
      className="inline-flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      data-zerops-grip={groupId}
      data-zerops-surface="sidebar-project-grip"
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onMove(event.key === "ArrowUp" ? "up" : "down");
      }}
      onPointerDown={onPointerDown}
      type="button"
    >
      <GripVerticalIcon aria-hidden="true" className="size-3.5" />
    </button>
  );
}
