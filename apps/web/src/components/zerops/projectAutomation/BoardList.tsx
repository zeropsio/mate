/**
 * The Board's tasks as rows: each two lines — its title across the row's whole width, and under it
 * one quiet line (`rowMeta`) — led by who has it wearing its state, else the task's own mark
 * (`rowLead`), and ended by the reader's one press, if any (`taskVerbs`). On the Board's page the
 * rows stand in their lanes, Waiting for you first, as one list the keyboard walks (↑ ↓ or j k,
 * Enter opens a task's panel); on the project page the few that need the reader stand alone over
 * the way to the Board.
 */
import { OPEN_TAKEN_LABEL } from "@t3tools/client-runtime/zerops";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { BoardFace } from "~/zerops/useBoardTasks";
import { cn } from "~/lib/utils";

import { Button } from "../../ui/button";
import { Dot } from "../../ui/dot";
import { Failure } from "../../ui/failure";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Row } from "../../ui/row";
import { SectionHeader } from "../../ui/section";
import { Skeleton } from "../../ui/skeleton";
import { Text } from "../../ui/text";
import { MateFace, PersonAvatar } from "../primitives";
import { SectionAction } from "../system";
import { TaskGlyph } from "../board/TaskGlyph";
import { useRowMotion } from "./useRowMotion";
import type { BoardVerbs, BoardView } from "./boardView";
import type { RowPress } from "./projectAutomation.logic";
import {
  LANES,
  RECENT_SHOWN,
  rowLead,
  rowMeta,
  taskVerbs,
  type BoardRow,
  type MetaPart,
  type RowLead,
  type TaskVerb,
} from "./taskBoard.logic";

const RESTS: RowPress = { kind: "idle" };

/** Who has a task, wearing its state, or the task's own mark, in a lead of `size`. */
export function TaskLead({
  lead,
  face,
  size = 24,
}: {
  readonly lead: RowLead;
  readonly face: BoardFace | undefined;
  readonly size?: 20 | 24;
}) {
  if (lead.kind === "glyph") return <TaskGlyph glyph={lead.glyph} />;
  if (lead.kind === "person") return <PersonAvatar name={lead.name} size={size} />;
  return (
    <MateFace shape={face?.shape} size={size} state={lead.state} tint={face?.tint ?? "slate"} />
  );
}

/** The face of whoever has a task: a pool Mate's from the pool, else a person's own Mate's. */
export function faceOfRow(
  row: Pick<BoardRow, "holder">,
  board: Pick<BoardView, "faceOf">,
): BoardFace | undefined {
  const projectId = row.holder?.projectId;
  return projectId === undefined ? undefined : board.faceOf?.(projectId);
}

/** The name a task's Mate goes by: its face's, else what HQ named it. */
export function holderName(row: Pick<BoardRow, "holder">, face: BoardFace | undefined) {
  return row.holder?.kind === "pool" ? (face?.name ?? row.holder.name) : (row.holder?.mate ?? null);
}

/** The line under a title, its parts one after another. */
function metaWords(parts: ReadonlyArray<MetaPart>, row: BoardRow): string {
  return parts
    .map((part) =>
      part.kind === "words"
        ? part.words
        : part.kind === "origin"
          ? row.origin.words
          : (row.change?.label ?? ""),
    )
    .filter((said) => said !== "")
    .join(" · ");
}

/**
 * **Take**: into the reader's one Mate in the application at once; where they have several, a
 * choice of which, each by its name.
 */
function TakePress({
  verbs,
  row,
  size,
  variant,
}: {
  readonly verbs: BoardVerbs;
  readonly row: BoardRow;
  readonly size: "sm" | "md";
  readonly variant: "primary" | "secondary";
}) {
  const into = verbs.offerOf(row.id)?.takeInto ?? [];
  const mates = into.map((projectId) => ({ projectId, name: verbs.mateName(projectId) }));
  const [only] = mates;
  if (mates.length === 1 && only !== undefined)
    return (
      <Button
        aria-label={`Take “${row.title}” into ${only.name}`}
        onClick={() => {
          verbs.onTake(row.id, only.projectId);
        }}
        size={size}
        variant={variant}
      >
        Take
      </Button>
    );
  return (
    <Menu>
      <MenuTrigger
        render={<Button aria-label={`Take “${row.title}” into…`} size={size} variant={variant} />}
      >
        Take
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end" width="sm">
        <MenuGroup>
          <MenuGroupLabel>Take it into</MenuGroupLabel>
          {mates.map((mate) => (
            <MenuItem
              key={mate.projectId}
              onClick={() => {
                verbs.onTake(row.id, mate.projectId);
              }}
            >
              {mate.name}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * **Drop the need**: a held task's one need that broke, dropped at once; where several broke, a
 * choice of which, each by the task it names.
 */
function DropNeedPress({
  verbs,
  row,
  size,
  variant,
}: {
  readonly verbs: BoardVerbs;
  readonly row: BoardRow;
  readonly size: "sm" | "md";
  readonly variant: "primary" | "secondary";
}) {
  const [only] = row.broken;
  if (row.broken.length === 1 && only !== undefined)
    return (
      <Button
        aria-label={`Drop what “${row.title}” waits for`}
        onClick={() => {
          verbs.onDropNeed(row.id, only.taskId);
        }}
        size={size}
        variant={variant}
      >
        Drop the need
      </Button>
    );
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label={`Drop what “${row.title}” waits for…`}
            size={size}
            variant={variant}
          />
        }
      >
        Drop the need
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end" width="sm">
        <MenuGroup>
          <MenuGroupLabel>Stop waiting for</MenuGroupLabel>
          {row.broken.map((need) => (
            <MenuItem
              key={need.taskId}
              onClick={() => {
                verbs.onDropNeed(row.id, need.taskId);
              }}
            >
              {need.title ?? "A task that ended"}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/** A press that opens a page in Mate by its in-app path: its address is a link's, its press goes in place. */
export function OpenPress({
  href,
  label,
  onOpen,
  size,
  variant,
}: {
  readonly href: string;
  readonly label: string;
  readonly onOpen: (route: string) => void;
  readonly size: "sm" | "md";
  readonly variant: "primary" | "secondary";
}) {
  return (
    <Button
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onOpen(href);
      }}
      render={<a href={href} />}
      size={size}
      variant={variant}
    >
      {label}
    </Button>
  );
}

/** One of the reader's presses on a task, as its row and its panel draw it. */
export function VerbPress({
  verb,
  row,
  board,
  verbs,
  size = "sm",
  variant,
}: {
  readonly verb: TaskVerb;
  readonly row: BoardRow;
  readonly board: BoardView;
  readonly verbs: BoardVerbs;
  readonly size?: "sm" | "md";
  readonly variant: "primary" | "secondary";
}) {
  switch (verb) {
    case "open":
      return (
        <Button
          onClick={() => {
            verbs.onOpenTaken(row.id);
          }}
          size={size}
          variant={variant}
        >
          {OPEN_TAKEN_LABEL}
        </Button>
      );
    case "drop":
      return <DropNeedPress row={row} size={size} variant={variant} verbs={verbs} />;
    case "take":
      return <TakePress row={row} size={size} variant={variant} verbs={verbs} />;
    case "done":
      return (
        <Button
          onClick={() => {
            verbs.onDone(row.id);
          }}
          size={size}
          variant={variant}
        >
          Done
        </Button>
      );
    case "review": {
      const { change } = row;
      if (change === null) return null;
      return change.external ? (
        <Button
          render={<a href={change.href} rel="noreferrer" target="_blank" />}
          size={size}
          variant={variant}
        >
          Review
        </Button>
      ) : (
        <OpenPress
          href={change.href}
          label="Review"
          onOpen={board.onOpen}
          size={size}
          variant={variant}
        />
      );
    }
    case "answer":
      // Answered on the Board: its panel, its field focused; else in its conversation.
      return row.answeredHere && board.onPick !== undefined ? (
        <Button
          onClick={() => {
            board.onPick?.(row.id, true);
          }}
          size={size}
          variant={variant}
        >
          Answer
        </Button>
      ) : row.route === null ? null : (
        <OpenPress
          href={row.route}
          label="Answer"
          onOpen={board.onOpen}
          size={size}
          variant={variant}
        />
      );
  }
}

/**
 * One task of the Board: a press across the row that picks it (its panel), and the reader's one
 * press at its end — Answer in the primary ink, every other in the secondary.
 */
function TaskRow({
  row,
  board,
  picked,
  option,
}: {
  readonly row: BoardRow;
  readonly board: BoardView;
  readonly picked: boolean;
  /** On the Board's page the row is an option of its list, the keyboard's stop while `0`. */
  readonly option?: { readonly tabIndex: 0 | -1; readonly onFocus: () => void } | undefined;
}) {
  const { verbs } = board;
  const face = faceOfRow(row, board);
  const press = verbs?.pressOf(row.id) ?? RESTS;
  const meta = rowMeta(row, press, holderName(row, face));
  const { primary } = taskVerbs({
    row,
    offer: verbs?.offerOf(row.id),
    press,
    stranded: verbs?.strandedOf(row.id) === true,
  });
  const href = board.pickHref?.(row.id);
  const pick = board.onPick;
  const pressing = {
    columns: true,
    "data-picked": picked ? "" : undefined,
    "data-press": "",
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (pick === undefined) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      pick(row.id);
    },
    picked,
    pressable: pick !== undefined,
  } as const;
  const cells = (
    <>
      <span className={LEAD}>
        <TaskLead face={face} lead={rowLead(row)} />
      </span>
      <span className={TEXT}>
        <span className={TITLE}>{row.title}</span>
        <span
          className={cn(
            META,
            meta.tone === "attention" && "text-status-attention-text",
            meta.tone === "failed" && "text-status-failed-text",
          )}
          role={meta.tone === "failed" ? "alert" : undefined}
        >
          {metaWords(meta.parts, row)}
        </span>
      </span>
    </>
  );
  return (
    <li
      className={ROW}
      data-state={`${row.lane}:${row.status}`}
      data-zerops-task={row.id}
      role={option === undefined ? undefined : "none"}
    >
      {option !== undefined ? (
        <Row
          {...pressing}
          aria-selected={picked}
          className={PRESS}
          onFocus={option.onFocus}
          render={<div />}
          role="option"
          tabIndex={option.tabIndex}
        >
          {cells}
        </Row>
      ) : href !== undefined ? (
        <Row {...pressing} className={PRESS} render={<a href={href} />}>
          {cells}
        </Row>
      ) : pick !== undefined ? (
        <Row {...pressing} className={PRESS} render={<button type="button" />}>
          {cells}
        </Row>
      ) : (
        <Row {...pressing} className={PRESS}>
          {cells}
        </Row>
      )}
      {verbs === undefined || primary === null ? null : (
        <span className={SEAT}>
          <VerbPress
            board={board}
            row={row}
            variant={primary === "answer" ? "primary" : "secondary"}
            verb={primary}
            verbs={verbs}
          />
        </span>
      )}
    </li>
  );
}

/** Rows held while the Board reads: as many as navigation says will land, at a row's height. */
function Placeholders({ count }: { readonly count: number }) {
  return (
    <ul aria-hidden="true" className={ROWS}>
      {Array.from({ length: count }, (_, at) => (
        <li className={ROW} key={at}>
          <Row className={PRESS} columns>
            <span className={LEAD}>
              <Skeleton className="size-5" surface="card" />
            </span>
            <span className={cn(TEXT, "gap-2 py-0.5")}>
              <Skeleton className="h-3.5 w-1/2" surface="card" />
              <Skeleton className="h-3 w-1/3" surface="card" />
            </span>
          </Row>
        </li>
      ))}
    </ul>
  );
}

/** The Board's read failed: HQ's words, and the way to read again. */
function ReadFailed({ board, words }: { readonly board: BoardView; readonly words: string }) {
  return (
    <div className={LINE}>
      <Failure cause={words} className="min-w-0 flex-1" role="alert" size="line" />
      <Button onClick={board.onReadAgain} size="sm" variant="ghost">
        Try again
      </Button>
    </div>
  );
}

/** A Board with no task: the New task above it is theirs, and who takes it. */
function NoTasks({ waitsFor }: { readonly waitsFor: ReadonlyArray<string> | undefined }) {
  if (waitsFor === undefined) return null;
  return (
    <Text className="m-0 px-2.5 pt-2 pb-1.5" render={<p />} variant="description">
      No tasks yet. Put one on the Board above, and{" "}
      {waitsFor.length === 1
        ? `${waitsFor[0] ?? "its automated Mate"} takes it.`
        : "an automated Mate takes it."}
    </Text>
  );
}

/** A lane's heading: its name and count; Waiting for you's carries the attention dot while it holds a task. */
export function LaneHeading({
  id,
  name,
  count,
  attention = false,
  action,
}: {
  readonly id?: string | undefined;
  readonly name: string;
  readonly count?: number | undefined;
  readonly attention?: boolean;
  /** Its one action, at the end of its line (the sources' *Add*). */
  readonly action?: ReactNode;
}) {
  return (
    // Sticky in the Board page's scroll, on the card's own ground, so the rows pass under it.
    <div className={LANE_HEADING} data-zerops-lane={name}>
      <SectionHeader
        action={action}
        count={
          count === undefined ? undefined : attention ? (
            <span className="inline-flex items-center gap-2">
              {count}
              <Dot size="sm" tone="warning" />
            </span>
          ) : (
            count
          )
        }
        id={id}
        level={3}
        size="panel"
        title={name}
      />
    </div>
  );
}

/**
 * Every lane of the Board, Waiting for you first, each led by its sticky heading: one list of
 * options the keyboard walks — ↑ ↓ or j k from row to row across the lanes, Enter or Space opens
 * the task's panel. Done shows its latest few until the rest are asked for, in place. While the
 * Board reads, each lane holds the rows navigation says will land.
 */
export function BoardLanes({
  board,
  waitsFor,
}: {
  readonly board: BoardView;
  /** The pool's Mates by name: an empty Board says who takes a new task. */
  readonly waitsFor: ReadonlyArray<string> | undefined;
}) {
  const { read } = board;
  const [all, setAll] = useState(false);
  // The row the keyboard stands on: the task picked, else the one focused last, else the first.
  const [cursor, setCursor] = useState<string | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const ids = useId();
  useRowMotion(list, read.state === "known");
  if (read.state === "none") return null;
  if (read.state === "failed") return <ReadFailed board={board} words={read.words} />;
  if (read.state === "reading") {
    const { predicted } = read;
    if (LANES.every((lane) => predicted[lane.id] === 0)) return null;
    return (
      <div className={LANES_CLASS} data-zerops-surface="project-automation-board">
        {LANES.map((lane) =>
          predicted[lane.id] === 0 ? null : (
            <div className={LANE} data-zerops-board={lane.name} key={lane.id}>
              <LaneHeading name={lane.name} />
              <Placeholders count={predicted[lane.id]} />
              {lane.id === "done" && predicted.doneMore === true ? (
                <div aria-hidden="true" className={MORE} />
              ) : null}
            </div>
          ),
        )}
      </div>
    );
  }
  const { lanes } = read.board;
  if (LANES.every((lane) => lanes[lane.id].length === 0)) return <NoTasks waitsFor={waitsFor} />;
  const shownOf = (lane: (typeof LANES)[number]) =>
    lane.id === "done" && !all ? lanes.done.slice(0, RECENT_SHOWN) : lanes[lane.id];
  const shown = LANES.flatMap((lane) => shownOf(lane).map((row) => row.id));
  const stop =
    (board.selected != null && shown.includes(board.selected) ? board.selected : null) ??
    (cursor !== null && shown.includes(cursor) ? cursor : null) ??
    shown[0];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = [...(list.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
    const at = options.findIndex((option) => option === document.activeElement);
    if (at === -1) return;
    const step =
      event.key === "ArrowDown" || event.key === "j"
        ? 1
        : event.key === "ArrowUp" || event.key === "k"
          ? -1
          : 0;
    if (step !== 0) {
      event.preventDefault();
      options[Math.min(options.length - 1, Math.max(0, at + step))]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const id = options[at]?.closest<HTMLElement>("[data-zerops-task]")?.dataset.zeropsTask;
      if (id !== undefined) board.onPick?.(id);
    }
  };
  return (
    <div
      aria-label="Tasks"
      className={LANES_CLASS}
      data-zerops-surface="project-automation-board"
      onKeyDown={onKeyDown}
      ref={list}
      role="listbox"
    >
      {LANES.map((lane) => {
        const rows = lanes[lane.id];
        if (rows.length === 0) return null;
        const heading = `${ids}-${lane.id}`;
        return (
          <div
            aria-labelledby={heading}
            className={LANE}
            data-zerops-board={lane.name}
            key={lane.id}
            role="group"
          >
            <LaneHeading
              attention={lane.id === "waiting"}
              count={rows.length}
              id={heading}
              name={lane.name}
            />
            <ul className={ROWS} role="none">
              {shownOf(lane).map((row) => (
                <TaskRow
                  board={board}
                  key={row.id}
                  option={{
                    tabIndex: row.id === stop ? 0 : -1,
                    onFocus: () => {
                      setCursor(row.id);
                    },
                  }}
                  picked={row.id === board.selected}
                  row={row}
                />
              ))}
            </ul>
            {lane.id === "done" && rows.length > RECENT_SHOWN ? (
              // Done past its latest few: opened in place, on the titles' edge.
              <div className={MORE}>
                <SectionAction
                  onClick={() => {
                    setAll(!all);
                  }}
                >
                  {all ? "Show fewer" : `Show all ${String(rows.length)}`}
                </SectionAction>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The project page's Board: the few rows that need the reader (`compactRows`), each opening the
 * Board's page at its task, then the way to the Board with its totals (`boardTotals`).
 */
export function CompactBoard({
  board,
  rows,
  totals,
  waitsFor,
  onOpenBoard,
  boardHref,
}: {
  readonly board: BoardView;
  /** The rows it shows, or how many will land while the Board reads. */
  readonly rows: ReadonlyArray<BoardRow> | number;
  /** The whole Board in one line; `null` while it reads. */
  readonly totals: string | null;
  readonly waitsFor: ReadonlyArray<string> | undefined;
  readonly onOpenBoard: (() => void) | undefined;
  readonly boardHref: string | undefined;
}) {
  const { read } = board;
  const list = useRef<HTMLDivElement | null>(null);
  useRowMotion(list, read.state === "known");
  if (read.state === "none") return null;
  if (read.state === "failed") return <ReadFailed board={board} words={read.words} />;
  if (read.state === "known" && LANES.every((lane) => read.board.lanes[lane.id].length === 0))
    return <NoTasks waitsFor={waitsFor} />;
  return (
    <div
      className="relative grid min-w-0"
      data-zerops-surface="project-automation-board"
      ref={list}
    >
      {typeof rows === "number" ? (
        rows === 0 ? null : (
          <Placeholders count={rows} />
        )
      ) : rows.length === 0 ? null : (
        <ul className={ROWS}>
          {rows.map((row) => (
            <TaskRow board={board} key={row.id} picked={false} row={row} />
          ))}
        </ul>
      )}
      <OpenBoard href={boardHref} onOpen={onOpenBoard} totals={totals} />
    </div>
  );
}

/** "Open the Board", across the card's foot, with the whole Board's totals at its end. */
function OpenBoard({
  href,
  onOpen,
  totals,
}: {
  readonly href: string | undefined;
  readonly onOpen: (() => void) | undefined;
  readonly totals: string | null;
}): ReactNode {
  const words = (
    <>
      <Text className="col-span-2 col-start-1 min-w-0" render={<span />} truncate variant="heading">
        Open the Board
      </Text>
      <span className="col-start-3 flex items-center gap-1.5 ps-3 text-line text-muted-foreground tabular-nums">
        {totals}
        <ChevronRightIcon aria-hidden="true" className="size-4" />
      </span>
    </>
  );
  return (
    <div className={cn(ROWS, "mt-0.5")}>
      <div className={ROW}>
        {href === undefined ? (
          <Row
            className={FOOT}
            columns
            data-zerops-surface="project-board-open"
            onClick={onOpen}
            pressable={onOpen !== undefined}
            render={<button type="button" />}
          >
            {words}
          </Row>
        ) : (
          <Row
            className={FOOT}
            columns
            data-zerops-surface="project-board-open"
            onClick={(event) => {
              if (onOpen === undefined) return;
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onOpen();
            }}
            pressable={onOpen !== undefined}
            render={<a href={href} />}
          >
            {words}
          </Row>
        )}
      </div>
    </div>
  );
}

/**
 * A lane's rows: one grid whose columns run down it — the lead, the words, the press — every row
 * 2 px from the next, no rule between them: the lane's heading parts the groups.
 */
const ROWS =
  "m-0 grid min-w-0 list-none grid-cols-[auto_minmax(0,1fr)_auto] gap-y-0.5 p-0 [--row-pad-x:--spacing(2.5)] [--row-pad-y:--spacing(2.5)]";

/**
 * A row: its press across it, its one press at its end over it. It stays lit while its press is
 * pointed at, unless it stands picked.
 */
const ROW =
  "group/task relative col-span-full grid min-w-0 grid-cols-subgrid [&:hover>[data-press]:not([data-picked])]:bg-item-hover";
const PRESS = "row-start-1 items-center";
const FOOT = "row-start-1 min-h-11 items-center";

/** Who has it, or its mark: one 24 px slot, so every title starts on one edge. */
const LEAD = "col-start-1 row-start-1 me-3 grid size-6 place-items-center";

/** The title, and its one line under it. */
const TEXT = "col-start-2 row-start-1 grid min-w-0";
const TITLE =
  "truncate text-body leading-5 font-medium text-foreground max-sm:line-clamp-2 max-sm:whitespace-normal";
const META = "truncate text-line leading-4.5 text-muted-foreground tabular-nums";

/** The reader's one press, on the row's end, inside its ground. */
const SEAT = "z-1 col-start-3 row-start-1 ms-3 me-2.5 self-center justify-self-end";

/** The lanes: each a group, 20 px under the last. */
const LANES_CLASS = "relative grid min-w-0 grid-cols-[minmax(0,1fr)]";
const LANE = "grid min-w-0 [&+&]:mt-5";
/** A lane's heading on the titles' edge, 6 px over its first row, held at the top as its rows scroll. */
const LANE_HEADING = "sticky top-0 z-2 bg-card px-2.5 pt-1 pb-1.5";

/** Done past its latest few, and its stand-in while read. */
const MORE = "flex min-h-8 items-center ps-11.5 pe-2.5 pt-0.5";

/** A line in the card: the read that failed. */
const LINE = "flex min-h-10 items-center gap-2 px-2.5 py-1.5";

/** The rows' anatomy, for the Board's other lists (its sources) to stand on the same edges. */
export const BOARD_ROW = {
  rows: ROWS,
  row: ROW,
  lead: LEAD,
  text: TEXT,
  title: TITLE,
  meta: META,
  seat: SEAT,
  lane: LANE,
  line: LINE,
} as const;
