/**
 * An application's Board on its own page, `/group/$groupId/board`: the whole Board using the width
 * (`BoardAutomation`), and the task picked (`?task=<id>`, so a task can be linked and survives a
 * reload) open in its panel beside it (`TaskPanel`). The page stands in the project page's column,
 * centred at its width, so its trail and title stay where the project page's were; with room for
 * both (1280 px of content) the panel stands beside the list and the column widens to hold the two,
 * still centred, easing aside as it does; with less, a sheet over it; on a phone, from the foot.
 * Esc closes it and gives the keyboard back to its row.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { MOTION } from "@t3tools/shared/brand";

import { useIsMobile } from "~/hooks/useMediaQuery";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { useProjectFlows } from "~/zerops/projectFlows";
import { cn } from "~/lib/utils";

import { Card } from "../../ui/card";
import { PageHeader } from "../../ui/page-header";
import { Sheet, SheetPopup } from "../../ui/sheet";
import { ZeropsHostedFrame } from "../landing/ZeropsHostedFrame";
import { PageTrail, usePageTrail } from "../system";
import { useGroupName } from "../ZeropsGroupDetail";
import type { BoardView } from "./boardView";
import { BoardAutomation, useAppBoard } from "./ProjectAutomation";
import { LANES, openCount, type BoardRow } from "./taskBoard.logic";
import { TaskPanel } from "./TaskPanel";

/**
 * How wide the page's content must be for the panel to stand beside the list: the panel's 440 px,
 * the 16 px between them and a list of at least 824 px (it runs to the column's 848 where there is
 * room).
 */
const PANE_ROOM = 1280;

/**
 * The page's column: the project page's (`Page`'s `page` width less its gutters), and with the
 * panel beside the list, that and the panel's 440 px and the 16 px between them.
 */
const COLUMN = "max-w-[calc(var(--container-4xl)_-_3rem)]";
const COLUMN_SPLIT = "max-w-[calc(var(--container-4xl)_-_3rem_+_456px)]";

export function BoardPage({
  groupId,
  task,
  onTask,
}: {
  readonly groupId: string;
  /** The task picked, from the address; `null`: none. */
  readonly task: string | null;
  /** Picks a task, or none, in the address. */
  readonly onTask: (task: string | null) => void;
}) {
  const name = useGroupName(groupId);
  const trail = usePageTrail({ project: { groupId, name }, here: "Board" });
  const { flows } = useProjectFlows(useMemo(() => [groupId], [groupId]));
  const flow = flows.get(groupId);
  const { board, pool, onOpenMate, addMate } = useAppBoard(groupId);
  const view: BoardView = { ...board, selected: task, onPick: (id) => onTask(id) };
  return (
    <ZeropsHostedFrame bar={false} width="full">
      <BoardPageView
        board={view}
        list={
          <BoardAutomation
            addMate={addMate}
            board={view}
            groupId={groupId}
            name={name}
            onOpenMate={onOpenMate}
            pool={pool}
            repos={flow?.codeRepos ?? flow?.repos}
          />
        }
        onClose={() => {
          onTask(null);
        }}
        trail={<PageTrail trail={trail} />}
      />
    </ZeropsHostedFrame>
  );
}

/** Every row of the Board, by its task. */
function rowsOf(board: BoardView): ReadonlyMap<string, BoardRow> {
  if (board.read.state !== "known") return new Map();
  const { lanes } = board.read.board;
  return new Map(LANES.flatMap((lane) => lanes[lane.id].map((row) => [row.id, row] as const)));
}

/** The page drawn: its head, the list, and the picked task's panel where the Board holds it. */
export function BoardPageView({
  trail,
  list,
  board,
  onClose,
}: {
  readonly trail: ReactNode;
  /** The Board's list (`BoardAutomation`, or the harness's view of it). */
  readonly list: ReactNode;
  readonly board: BoardView;
  readonly onClose: () => void;
}) {
  const rows = rowsOf(board);
  const row = board.selected == null ? undefined : rows.get(board.selected);
  const page = useRef<HTMLDivElement | null>(null);
  const column = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const wide = useWide(page);
  const phone = useIsMobile();
  // The row the panel was opened from gets the keyboard back as it closes.
  const close = () => {
    const id = board.selected;
    onClose();
    if (id == null) return;
    requestAnimationFrame(() => {
      body.current
        ?.querySelector<HTMLElement>(`[data-zerops-task="${CSS.escape(id)}"] [role=option]`)
        ?.focus();
    });
  };
  useRevealPicked(body, row?.id);
  // What is still open: finished work is not counted as outstanding; none open, no count.
  const open = board.read.state === "known" ? openCount(board.read.board) : 0;
  const panel =
    row === undefined ? null : (
      <TaskPanel
        board={board}
        headingRef={heading}
        key={row.id}
        onClose={close}
        row={row}
        rows={rows}
      />
    );
  const split = wide && panel !== null;
  useColumnGlide(column, split);
  return (
    <div
      className="min-w-0"
      data-zerops-surface="board-page"
      ref={page}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || row === undefined || event.defaultPrevented) return;
        // Escape in a field or a menu is theirs.
        if (
          event.target instanceof HTMLElement &&
          event.target.closest("input, textarea, [role=menu]")
        )
          return;
        event.preventDefault();
        close();
      }}
    >
      <div
        className={cn("mx-auto flex w-full min-w-0 flex-col gap-6", split ? COLUMN_SPLIT : COLUMN)}
        ref={column}
      >
        <PageHeader count={open === 0 ? undefined : open} title="Board" trail={trail} />
        <div
          className={cn(
            "grid min-w-0 items-start gap-4",
            split ? "grid-cols-[minmax(0,1fr)_440px]" : "grid-cols-[minmax(0,1fr)]",
          )}
          ref={body}
        >
          <Card>{list}</Card>
          {split ? (
            // A pane beside the list, held in view as the list scrolls under the page's top.
            <div className="sticky top-6 flex max-h-[calc(100dvh-3rem)] min-w-0 flex-col motion-safe:animate-board-panel-in">
              <Card className="flex min-h-0 flex-col">{panel}</Card>
            </div>
          ) : null}
        </div>
      </div>
      {wide ? null : (
        <Sheet
          onOpenChange={(open) => {
            if (!open) close();
          }}
          open={panel !== null}
        >
          <SheetPopup
            initialFocus={heading}
            showCloseButton={false}
            side={phone ? "bottom" : "right"}
          >
            {panel}
          </SheetPopup>
        </Sheet>
      )}
    </div>
  );
}

/** Whether the element has room for the panel beside the list (`PANE_ROOM`), as it is resized. */
function useWide(element: React.RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const node = element.current;
    if (node === null) return;
    const measure = () => {
      setWide(node.getBoundingClientRect().width >= PANE_ROOM);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return wide;
}

/**
 * The column eases to where it stands as the panel opens beside the list or closes: centred, it
 * widens or narrows by both its sides, so it slides from where it stood (transform only, from
 * wherever a glide still under way had it), and under reduced motion it stands there at once.
 */
function useColumnGlide(element: React.RefObject<HTMLElement | null>, split: boolean) {
  const width = useRef<number | null>(null);
  useLayoutEffect(() => {
    const node = element.current;
    if (node === null) return;
    const measure = () => {
      width.current = node.getBoundingClientRect().width;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  const was = useRef(split);
  useLayoutEffect(() => {
    const node = element.current;
    if (node === null || was.current === split) return;
    was.current = split;
    const before = width.current;
    const after = node.getBoundingClientRect().width;
    width.current = after;
    if (before === null || prefersReducedMotion()) return;
    const under = new DOMMatrixReadOnly(getComputedStyle(node).transform).m41;
    for (const glide of node.getAnimations()) glide.cancel();
    const from = (after - before) / 2 + under;
    if (Math.abs(from) < 1) return;
    node.animate([{ transform: `translateX(${String(from)}px)` }, { transform: "none" }], {
      duration: MOTION.duration.base,
      easing: MOTION.easing.out,
    });
  }, [element, split]);
}

/** The picked task's row, brought into view once as the page opens at it (a link, a reload). */
function useRevealPicked(element: React.RefObject<HTMLElement | null>, id: string | undefined) {
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current || id === undefined) return;
    revealed.current = true;
    element.current
      ?.querySelector<HTMLElement>(`[data-zerops-task="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [element, id]);
}
