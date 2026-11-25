/**
 * An app's access as one table: people down, the app's places across — Production, each Stage,
 * then each Mate with its owner's face. A cell is a person's level on one place; an organization
 * owner or admin picks another from it, one place at a time, or the same for every place from the
 * person's *Same everywhere…*. A level from the organization's role alone is muted, marked as the
 * organization default; a Mate's owner is its Owner and stays so.
 *
 * With many places the table scrolls sideways inside its card, the people column standing still;
 * on a phone each person is a row that opens to their places. *Add access* under it stays as the
 * chips have it. A place's own page and a Mate's *Access* show one column of it, read only
 * (`PlaceAccessSummary`), linked back here.
 *
 * A pure view: the table (`accessTable.logic.ts`) and what is being changed arrive; each choice
 * goes back to the caller, which writes it.
 */
import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, EyeOffIcon, MoreHorizontalIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useIsMobile } from "~/hooks/useMediaQuery";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Collapsible, CollapsibleTrigger } from "../../ui/collapsible";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../../ui/menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { PersonAvatar } from "../primitives";
import {
  CELL_WORDS,
  rowSummary,
  type AccessCell,
  type AccessColumn,
  type AccessRow,
  type AccessTableView,
  type CellChoice,
  type CellLevel,
  type columnPeople,
} from "./accessTable.logic";
import {
  ADD_TROUBLE,
  AccessBadge,
  AddAccess,
  CARD_SECTION,
  type AccessPick,
} from "./ProjectAccessChips";
import { cn } from "~/lib/utils";
import { LEVEL_MEANING, selfLowerWords } from "./projectPeople.logic";
import { Loading } from "~/components/ui/loading";
import { SectionLabel } from "../system/SectionLabel";
import { EmptyState } from "~/components/ui/empty";
import { Failure } from "~/components/ui/failure";
import { Text } from "~/components/ui/text";

/** The key a cell's write is held under while it saves, and its refusal said by. */
export const cellKey = (row: Pick<AccessRow, "key">, projectId: string): string =>
  `${row.key}:${projectId}`;

/** The id a column's header carries: a place's page links to it (`#access-<projectId>`). */
const columnAnchor = (projectId: string): string => `access-${projectId}`;

interface ProjectAccessTableProps {
  readonly view: AccessTableView;
  readonly label?: string;
  /** Cells (`cellKey`) and rows (their key) being written now. */
  readonly saving?: ReadonlySet<string>;
  /** What a refusal said, by cell or row key; `add` for adding people. */
  readonly troubles?: Readonly<Record<string, string>>;
  readonly onCell?: (row: AccessRow, column: AccessColumn, choice: CellChoice) => void;
  readonly onEverywhere?: (row: AccessRow, choice: CellChoice) => void;
  readonly onWithdraw?: (row: AccessRow) => void;
  readonly onAdd?: (picks: ReadonlyArray<AccessPick>) => void;
  readonly adding?: boolean;
  /** Whether a person's face leads to their Team page. */
  readonly personPage?: (clientUserId: string) => boolean;
  /** The column a place's page linked to: brought into view and marked. */
  readonly focus?: string | undefined;
  /** Drawn as rows that open, whatever the window: the harness's phone. */
  readonly stacked?: boolean;
}

/** A pending choice that gives up the viewer's own full access, asked first. */
interface Asking {
  readonly row: AccessRow;
  readonly column: AccessColumn | null;
  readonly choice: CellChoice;
}

const lowersOwn = (row: AccessRow, choice: CellChoice, cells: ReadonlyArray<AccessCell>) =>
  row.self &&
  (choice === "read" || choice === "none") &&
  cells.some(({ level }) => level === "full" || level === "owner");

export function ProjectAccessTable({
  view,
  label = "People",
  saving,
  troubles,
  onCell,
  onEverywhere,
  onWithdraw,
  onAdd,
  adding = false,
  personPage,
  focus,
  stacked = false,
}: ProjectAccessTableProps) {
  const phone = useIsMobile() || stacked;
  const [asking, setAsking] = useState<Asking | null>(null);
  const rows = view.kind === "table" ? view.rows : [];
  const columns = view.kind === "table" ? view.columns : [];

  const chooseCell = (row: AccessRow, column: AccessColumn, choice: CellChoice) => {
    const cell = row.cells.find(({ projectId }) => projectId === column.projectId);
    if (cell !== undefined && lowersOwn(row, choice, [cell])) setAsking({ row, column, choice });
    else onCell?.(row, column, choice);
  };
  const chooseEverywhere = (row: AccessRow, choice: CellChoice) => {
    if (lowersOwn(row, choice, row.cells)) setAsking({ row, column: null, choice });
    else onEverywhere?.(row, choice);
  };
  const handlers: RowHandlers = {
    ...(onCell === undefined ? {} : { onCell: chooseCell }),
    ...(onEverywhere === undefined ? {} : { onEverywhere: chooseEverywhere }),
    ...(onWithdraw === undefined ? {} : { onWithdraw }),
  };

  const said = Object.entries(troubles ?? {}).flatMap(([key, line]) => {
    if (key === ADD_TROUBLE) return [{ key, line }];
    const row = rows.find((one) => key === one.key || key.startsWith(`${one.key}:`));
    if (row === undefined) return [];
    const column = columns.find(({ projectId }) => key === cellKey(row, projectId));
    return [
      { key, line: `${row.name}${column === undefined ? "" : ` · ${column.label}`}: ${line}` },
    ];
  });
  const addable =
    view.kind === "table" && view.invite && onAdd !== undefined && view.candidates.length > 0
      ? { candidates: view.candidates, onAdd }
      : null;
  const lower = selfLowerWords("ADMIN");

  return (
    <section aria-label={label} className={CARD_SECTION} data-zerops-surface="access-table">
      <SectionLabel level={3}>{label}</SectionLabel>
      {view.kind === "reading" ? (
        <Loading count={3} label="Who has access" shape="rows" />
      ) : view.kind === "unreadable" ? (
        <Failure cause={view.line} size="line" />
      ) : phone ? (
        // A phone's table: each person a row that opens to their places.
        <ul aria-label={label} className="-mx-1.5 mt-0.5 grid text-body leading-4.5">
          {rows.map((row) => (
            <StackedRow
              columns={columns}
              handlers={handlers}
              key={row.key}
              linked={personPage?.(row.key) === true}
              row={row}
              saving={saving}
            />
          ))}
        </ul>
      ) : (
        <AccessGrid
          columns={columns}
          focus={focus}
          handlers={handlers}
          label={label}
          personPage={personPage}
          rows={rows}
          saving={saving}
        />
      )}
      {view.kind === "table" && rows.length > 0 ? (
        <Text render={<p />} variant="note">
          Plain: what the organization gives. Highlighted: set for this place.
        </Text>
      ) : null}
      {said.map(({ key, line }) => (
        <Failure cause={line} key={key} role="alert" size="line" />
      ))}
      {addable === null ? null : (
        <span className="-ms-2.5 flex items-center gap-1">
          <AddAccess adding={adding} candidates={addable.candidates} onAdd={addable.onAdd} />
        </span>
      )}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        open={asking !== null}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{lower.title}</AlertDialogTitle>
            <AlertDialogDescription>{lower.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>Cancel</AlertDialogClose>
            <Button
              onClick={() => {
                if (asking !== null) {
                  if (asking.column === null) onEverywhere?.(asking.row, asking.choice);
                  else onCell?.(asking.row, asking.column, asking.choice);
                }
                setAsking(null);
              }}
              variant="destructive"
            >
              Give it up
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </section>
  );
}

interface RowHandlers {
  readonly onCell?: (row: AccessRow, column: AccessColumn, choice: CellChoice) => void;
  readonly onEverywhere?: (row: AccessRow, choice: CellChoice) => void;
  readonly onWithdraw?: (row: AccessRow) => void;
}

/** The table proper: sticky people column, one column per place, scrolling inside its card. */
function AccessGrid({
  rows,
  columns,
  handlers,
  saving,
  label,
  personPage,
  focus,
}: {
  readonly rows: ReadonlyArray<AccessRow>;
  readonly columns: ReadonlyArray<AccessColumn>;
  readonly handlers: RowHandlers;
  readonly saving: ReadonlySet<string> | undefined;
  readonly label: string;
  readonly personPage: ((clientUserId: string) => boolean) | undefined;
  readonly focus: string | undefined;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // A place's page linked to its column: bring it into view once, where the person asked for it.
  useEffect(() => {
    if (focus === undefined) return;
    scroller.current
      ?.querySelector(`#${CSS.escape(columnAnchor(focus))}`)
      ?.scrollIntoView({ block: "center", inline: "center" });
  }, [focus]);
  return (
    // It scrolls sideways inside its card, reaching out so its words stand on the section's edge;
    // it holds its own screen-reader words, which would otherwise widen the page. The column a
    // place's page linked to is lit.
    <div
      className="relative -mx-2 mt-0.5 max-w-full [&_[data-focus]]:bg-item-picked [&_thead_th[data-focus]]:text-foreground"
      ref={scroller}
    >
      <Table aria-label={label} size="md">
        <TableHeader>
          <TableRow>
            <TableHead className="w-px min-w-55" scope="col" sticky>
              <span className="sr-only">Person</span>
            </TableHead>
            {columns.map((column) => (
              <TableHead
                className="min-w-28"
                data-focus={focus === column.projectId || undefined}
                data-kind={column.kind}
                id={columnAnchor(column.projectId)}
                key={column.projectId}
                scope="col"
              >
                <ColumnHead column={column} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableHead className="w-px min-w-55" scope="row" sticky>
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <Who linked={personPage?.(row.key) === true} row={row} />
                  <RowMenu busy={saving?.has(row.key) === true} handlers={handlers} row={row} />
                </span>
              </TableHead>
              {row.cells.map((cell, index) => {
                const column = columns[index]!;
                return (
                  <TableCell
                    data-focus={focus === column.projectId || undefined}
                    key={cell.projectId}
                  >
                    <Cell
                      busy={
                        saving?.has(row.key) === true ||
                        saving?.has(cellKey(row, cell.projectId)) === true
                      }
                      cell={cell}
                      column={column}
                      {...(handlers.onCell === undefined
                        ? {}
                        : {
                            onChoose: (choice: CellChoice) =>
                              handlers.onCell?.(row, column, choice),
                          })}
                      row={row}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** A column's head: the place's word, or a Mate's name with its owner's face. */
const COLUMN_HEAD = "inline-flex max-w-45 items-center gap-1.5 overflow-hidden text-ellipsis";

/** A person's face and words, a press to their Team page where they have one. */
const FACE = "grid min-w-0 cursor-default grid-cols-[24px_minmax(0,1fr)] items-center gap-x-2.5";

function ColumnHead({ column }: { readonly column: AccessColumn }) {
  if (column.kind !== "mate" || column.owner === null)
    return (
      <span className={COLUMN_HEAD}>
        <span data-part="label">{column.label}</span>
      </span>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={COLUMN_HEAD} />}>
        <PersonAvatar name={column.owner.name} picture={column.owner.avatarUrl} size={16} />
        <span data-part="label">{column.label}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {column.label} is {column.owner.name}’s Mate
      </TooltipPopup>
    </Tooltip>
  );
}

/** A person: face, name, and an invitation said as one. */
function Who({ row, linked }: { readonly row: AccessRow; readonly linked: boolean }) {
  const inner = (
    <>
      <PersonAvatar name={row.name} picture={row.avatarUrl} size={24} />
      <span className="grid min-w-0">
        <span
          className="overflow-hidden font-medium text-ellipsis text-foreground underline-offset-2 group-hover/face:underline"
          data-part="name"
        >
          {row.you ? `${row.short} (you)` : row.short}
        </span>
        {row.pending ? (
          <span className="overflow-hidden text-caption leading-4 text-ellipsis text-muted-foreground">
            Invited
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          linked ? (
            <Link
              className={cn(FACE, "group/face cursor-pointer", row.pending && "opacity-55")}
              params={{ clientUserId: row.key }}
              to="/settings/team/$clientUserId"
            />
          ) : (
            <span className={cn(FACE, row.pending && "opacity-55")} />
          )
        }
      >
        {inner}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <span className="grid min-w-45 gap-0.5 px-0.5 py-1 text-left">
          <span className="text-body leading-4.5 font-semibold">{row.name}</span>
          {row.email === null || row.email === row.name ? null : (
            <Text variant="note">{row.email}</Text>
          )}
          <Text variant="meta">
            {[row.role, ...(row.pending ? ["invited, not joined yet"] : [])].join(" · ")}
          </Text>
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}

/** *Same everywhere…*: a level for every place but their own Mates; withdrawing an invitation. */
function RowMenu({
  row,
  busy,
  handlers,
}: {
  readonly row: AccessRow;
  readonly busy: boolean;
  readonly handlers: RowHandlers;
}) {
  const { onEverywhere, onWithdraw } = handlers;
  const everywhere = onEverywhere === undefined ? [] : row.everywhere;
  const withdraw = row.withdraw && onWithdraw !== undefined;
  if (everywhere.length === 0 && !withdraw) return null;
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Same everywhere for ${row.name}…`}
        disabled={busy}
        render={<Button size="icon-sm" variant="ghost" />}
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start">
        {everywhere.length === 0 ? null : (
          <MenuGroup>
            <MenuGroupLabel>Same everywhere…</MenuGroupLabel>
            {everywhere.map(({ choice, label }) => (
              <MenuItem key={choice} onClick={() => onEverywhere?.(row, choice)}>
                {label}
              </MenuItem>
            ))}
          </MenuGroup>
        )}
        {withdraw ? (
          <>
            {everywhere.length === 0 ? null : <MenuSeparator />}
            <MenuItem onClick={() => onWithdraw?.(row)} variant="destructive">
              Withdraw invite
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/** A cell's level as words: set ones as a badge, the organization's default muted, none a dash. */
function Level({ cell, busy }: { readonly cell: AccessCell; readonly busy: boolean }) {
  if (busy) return <AccessBadge busy level="read" />;
  // A place kept from someone whose role reaches it: set, so said as a badge.
  if (cell.level === "none" && !cell.byDefault)
    return (
      <Badge data-part="badge" tone="neutral">
        <EyeOffIcon aria-hidden="true" />
        {CELL_WORDS.none}
      </Badge>
    );
  if (cell.level === "none" || cell.level === "unknown")
    return (
      <span className="text-caption leading-5 font-normal text-muted-foreground">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{CELL_WORDS[cell.level]}</span>
      </span>
    );
  if (cell.byDefault)
    return (
      <span className="text-caption leading-5 font-normal text-muted-foreground">
        {CELL_WORDS[cell.level]}
        <span className="sr-only">, organization default</span>
      </span>
    );
  return <AccessBadge level={cell.level} />;
}

/** What a level means, in one line: owner and unknown cells say why they stand as they do. */
const meaningOf = (level: CellLevel): string | null =>
  level === "owner" || level === "unknown" ? null : LEVEL_MEANING[level];

/**
 * What a cell says when hovered: its level and what it lets them do, then where it comes from —
 * the organization, by their role, or this place — and why it's fixed.
 */
const cellTip = (cell: AccessCell, column: AccessColumn, row: AccessRow): string => {
  const meaning = meaningOf(cell.level);
  if (meaning === null) return cell.fixed ?? `${column.label} is ${row.name}’s Mate.`;
  return [
    `${CELL_WORDS[cell.level]} on ${column.label}: ${meaning}`,
    cell.byDefault ? `From the organization (${row.role}).` : "Set for this place.",
    ...(cell.fixed === null ? [] : [cell.fixed]),
  ].join(" ");
};

function Cell({
  row,
  column,
  cell,
  busy,
  onChoose,
}: {
  readonly row: AccessRow;
  readonly column: AccessColumn;
  readonly cell: AccessCell;
  readonly busy: boolean;
  readonly onChoose?: (choice: CellChoice) => void;
}) {
  const tip = cellTip(cell, column, row);
  if (cell.choices.length === 0 || onChoose === undefined)
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="-ms-1.5 inline-flex min-h-7 cursor-default items-center gap-0.5 rounded-control ps-1.5 pe-1" />
          }
        >
          <Level busy={busy} cell={cell} />
        </TooltipTrigger>
        <TooltipPopup side="top">{tip}</TooltipPopup>
      </Tooltip>
    );
  const held = cell.choices.find(({ checked }) => checked)?.choice ?? "";
  return (
    <Menu>
      <Tooltip>
        <MenuTrigger
          aria-label={`${row.name} on ${column.label}: ${CELL_WORDS[cell.level]}${cell.byDefault ? ", organization default" : ""}. Change`}
          disabled={busy}
          render={
            <TooltipTrigger
              render={<Button className="group/cell -ms-2.5" size="sm" variant="ghost" />}
            />
          }
        >
          <Level busy={busy} cell={cell} />
          <ChevronDownIcon
            aria-hidden="true"
            className="size-3.5 text-muted-foreground opacity-0 transition-opacity duration-150 ease-out-strong group-hover/cell:opacity-100 group-focus-visible/cell:opacity-100 group-data-popup-open/cell:opacity-100"
          />
        </MenuTrigger>
        <TooltipPopup side="top">{tip}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start">
        <MenuGroup>
          <MenuGroupLabel>
            {row.short} on {column.label}
          </MenuGroupLabel>
          <MenuRadioGroup
            onValueChange={(value) => {
              if (value !== held) onChoose(value as CellChoice);
            }}
            value={held}
          >
            {cell.choices.map((entry) => (
              <MenuRadioItem key={entry.choice} value={entry.choice} variant="check">
                {entry.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/** A phone's person: a row saying their levels in one line, opening to each place's. */
function StackedRow({
  row,
  columns,
  handlers,
  saving,
  linked,
}: {
  readonly row: AccessRow;
  readonly columns: ReadonlyArray<AccessColumn>;
  readonly handlers: RowHandlers;
  readonly saving: ReadonlySet<string> | undefined;
  readonly linked: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      className="border-t border-border/60 first:border-t-0"
      onOpenChange={setOpen}
      open={open}
      render={<li />}
    >
      <span className="flex min-h-13 min-w-0 items-center justify-between gap-2 px-1.5">
        <CollapsibleTrigger className="grid min-w-0 flex-1 grid-cols-[24px_minmax(0,1fr)_14px] items-center gap-x-2.5 py-1.5 text-start">
          <PersonAvatar
            className={row.pending ? "opacity-55" : undefined}
            name={row.name}
            picture={row.avatarUrl}
            size={24}
          />
          <span className={cn("grid min-w-0", row.pending && "opacity-55")}>
            <span
              className="overflow-hidden font-medium text-ellipsis text-foreground"
              data-part="name"
            >
              {row.you ? `${row.short} (you)` : row.short}
            </span>
            <span className="overflow-hidden text-caption leading-4 text-ellipsis text-muted-foreground">
              {[...(row.pending ? ["Invited"] : []), rowSummary(row, columns)].join(" · ")}
            </span>
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-150 ease-out-strong motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        <RowMenu busy={saving?.has(row.key) === true} handlers={handlers} row={row} />
      </span>
      {open ? (
        <dl className="grid gap-0.5 ps-10 pe-1.5 pb-2.5">
          {linked ? (
            <Link
              className="overflow-hidden text-caption leading-4 text-ellipsis text-muted-foreground"
              params={{ clientUserId: row.key }}
              to="/settings/team/$clientUserId"
            >
              {row.name}’s Team page
            </Link>
          ) : null}
          {row.cells.map((cell, index) => {
            const column = columns[index]!;
            return (
              <div
                className="flex min-h-8 items-center justify-between gap-3 text-body"
                key={cell.projectId}
              >
                <dt className="truncate text-muted-foreground">{column.label}</dt>
                <dd>
                  <Cell
                    busy={
                      saving?.has(row.key) === true ||
                      saving?.has(cellKey(row, cell.projectId)) === true
                    }
                    cell={cell}
                    column={column}
                    {...(handlers.onCell === undefined
                      ? {}
                      : {
                          onChoose: (choice: CellChoice) => handlers.onCell?.(row, column, choice),
                        })}
                    row={row}
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </Collapsible>
  );
}

/** A face's hover on a place's page: what their level lets them do, and where it comes from. */
function summaryTip(
  person: NonNullable<ReturnType<typeof columnPeople>>["people"][number],
  label: string,
): string {
  const meaning = meaningOf(person.level);
  if (meaning === null) return `${label} is ${person.name}’s Mate.`;
  return [
    `${person.name}, ${CELL_WORDS[person.level]}: ${meaning}`,
    person.byDefault ? `From the organization (${person.role}).` : "Set for this place.",
  ].join(" ");
}

/** What stands for a place's people while they are read, or where they can't be. */
export function AccessUnread({ view }: { readonly view: AccessTableView }) {
  if (view.kind === "reading") return <Loading label="Reading who has access" shape="words" />;
  if (view.kind === "unreadable") return <Failure cause={view.line} size="line" />;
  return null;
}

/**
 * Who reaches one place, read only: faces with their level there, and the way to change it on the
 * app's page — a place's own page, a Mate's *Access*.
 */
export function PlaceAccessSummary({
  summary,
  unread,
  change,
}: {
  /** The column's people; `null` while they are read or can't be. */
  readonly summary: ReturnType<typeof columnPeople>;
  /** What stands for them while they are read or can't be (`AccessUnread`). */
  readonly unread: ReactNode;
  /** The link to the column on the app's page. */
  readonly change: ReactNode;
}) {
  return (
    <section
      aria-label="Who has access"
      className="grid gap-1.5 pb-3"
      data-zerops-surface="place-access"
    >
      {summary === null ? (
        unread
      ) : summary.people.length === 0 ? (
        <EmptyState size="line">Nobody has access yet.</EmptyState>
      ) : (
        <ul aria-label="Who has access" className="flex flex-wrap gap-x-4 gap-y-2">
          {summary.people.map((person) => (
            <Tooltip key={person.key}>
              <TooltipTrigger
                render={<li className="inline-flex items-center gap-1.5 text-body leading-4.5" />}
              >
                <PersonAvatar
                  className={person.pending ? "opacity-55" : undefined}
                  name={person.name}
                  picture={person.avatarUrl}
                  size={20}
                />
                <span className={person.pending ? "opacity-55" : undefined} data-part="name">
                  {person.short}
                </span>
                <span
                  className={
                    person.byDefault
                      ? "text-caption leading-4.5 font-normal text-muted-foreground"
                      : "text-caption leading-4.5 font-medium text-foreground"
                  }
                  data-part="level"
                >
                  {CELL_WORDS[person.level]}
                  {person.byDefault ? (
                    <span className="sr-only">, organization default</span>
                  ) : null}
                </span>
              </TooltipTrigger>
              <TooltipPopup side="top">{summaryTip(person, summary.label)}</TooltipPopup>
            </Tooltip>
          ))}
        </ul>
      )}
      {change}
    </section>
  );
}
