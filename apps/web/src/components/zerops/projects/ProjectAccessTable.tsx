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
import { ADD_TROUBLE, AccessBadge, AddAccess, type AccessPick } from "./ProjectAccessChips";
import { LEVEL_MEANING, selfLowerWords } from "./projectPeople.logic";

/** The key a cell's write is held under while it saves, and its refusal said by. */
export const cellKey = (row: Pick<AccessRow, "key">, projectId: string): string =>
  `${row.key}:${projectId}`;

/** The id a column's header carries: a place's page links to it (`#access-<projectId>`). */
export const columnAnchor = (projectId: string): string => `access-${projectId}`;

export interface ProjectAccessTableProps {
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
    <section aria-label={label} className="ov-sec" data-zerops-surface="access-table">
      <h3 className="ov-sec-name">{label}</h3>
      {view.kind === "reading" ? (
        <p className="ov-sec-empty">Reading who has access…</p>
      ) : view.kind === "unreadable" ? (
        <p className="ov-sec-empty">{view.line}</p>
      ) : phone ? (
        <ul aria-label={label} className="ov-acc-stack">
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
        <p className="ov-acc-legend">
          Plain: what the organization gives. Highlighted: set for this place.
        </p>
      ) : null}
      {said.map(({ key, line }) => (
        <p className="ov-sec-empty" data-tone="failed" key={key} role="alert">
          {line}
        </p>
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
    <div className="ov-acc-scroll" ref={scroller}>
      <table aria-label={label} className="ov-acc">
        <thead>
          <tr>
            <th className="ov-acc-who" scope="col">
              <span className="sr-only">Person</span>
            </th>
            {columns.map((column) => (
              <th
                data-focus={focus === column.projectId || undefined}
                data-kind={column.kind}
                id={columnAnchor(column.projectId)}
                key={column.projectId}
                scope="col"
              >
                <ColumnHead column={column} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr data-pending={row.pending || undefined} key={row.key}>
              <th className="ov-acc-who" scope="row">
                <span className="ov-acc-person">
                  <Who linked={personPage?.(row.key) === true} row={row} />
                  <RowMenu busy={saving?.has(row.key) === true} handlers={handlers} row={row} />
                </span>
              </th>
              {row.cells.map((cell, index) => {
                const column = columns[index]!;
                return (
                  <td data-focus={focus === column.projectId || undefined} key={cell.projectId}>
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
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A column's head: the place's word, or a Mate's name with its owner's face. */
function ColumnHead({ column }: { readonly column: AccessColumn }) {
  if (column.kind !== "mate" || column.owner === null)
    return (
      <span className="ov-acc-head">
        <span data-part="label">{column.label}</span>
      </span>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="ov-acc-head" />}>
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
      <span className="ov-acc-name">
        <span data-part="name">{row.you ? `${row.short} (you)` : row.short}</span>
        {row.pending ? <span className="ov-acc-note">Invited</span> : null}
      </span>
    </>
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          linked ? (
            <Link
              className="ov-acc-face"
              params={{ clientUserId: row.key }}
              to="/settings/team/$clientUserId"
            />
          ) : (
            <span className="ov-acc-face" />
          )
        }
      >
        {inner}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <span className="ov-chip-card">
          <span className="ov-chip-card-name">{row.name}</span>
          {row.email === null || row.email === row.name ? null : (
            <span className="ov-chip-card-line">{row.email}</span>
          )}
          <span className="ov-chip-card-line">
            {[row.role, ...(row.pending ? ["invited, not joined yet"] : [])].join(" · ")}
          </span>
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
      <span className="ov-acc-level" data-muted="">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{CELL_WORDS[cell.level]}</span>
      </span>
    );
  if (cell.byDefault)
    return (
      <span className="ov-acc-level" data-muted="">
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
        <TooltipTrigger render={<span className="ov-acc-cell" />}>
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
              render={<button className="ov-acc-cell" data-editable="" type="button" />}
            />
          }
        >
          <Level busy={busy} cell={cell} />
          <ChevronDownIcon aria-hidden="true" className="ov-acc-caret" />
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
    <li
      className="ov-acc-stack-row"
      data-open={open || undefined}
      data-pending={row.pending || undefined}
    >
      <span className="ov-acc-person">
        <button
          aria-expanded={open}
          className="ov-acc-open"
          onClick={() => setOpen(!open)}
          type="button"
        >
          <PersonAvatar name={row.name} picture={row.avatarUrl} size={24} />
          <span className="ov-acc-name">
            <span data-part="name">{row.you ? `${row.short} (you)` : row.short}</span>
            <span className="ov-acc-note">
              {[...(row.pending ? ["Invited"] : []), rowSummary(row, columns)].join(" · ")}
            </span>
          </span>
          <ChevronDownIcon aria-hidden="true" className="ov-acc-caret" />
        </button>
        <RowMenu busy={saving?.has(row.key) === true} handlers={handlers} row={row} />
      </span>
      {open ? (
        <dl className="ov-acc-places">
          {linked ? (
            <Link
              className="ov-acc-note"
              params={{ clientUserId: row.key }}
              to="/settings/team/$clientUserId"
            >
              {row.name}’s Team page
            </Link>
          ) : null}
          {row.cells.map((cell, index) => {
            const column = columns[index]!;
            return (
              <div key={cell.projectId}>
                <dt>{column.label}</dt>
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
    </li>
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

/**
 * Who reaches one place, read only: faces with their level there, and the way to change it on the
 * app's page — a place's own page, a Mate's *Access*.
 */
export function PlaceAccessSummary({
  summary,
  line,
  change,
}: {
  /** The column's people; `null` while they are read or can't be. */
  readonly summary: ReturnType<typeof columnPeople>;
  /** What stands for them while there are none to show: reading, unreadable. */
  readonly line: string | null;
  /** The link to the column on the app's page. */
  readonly change: ReactNode;
}) {
  return (
    <section aria-label="Who has access" className="ov-access" data-zerops-surface="place-access">
      {summary === null ? (
        line === null ? null : (
          <p className="ov-sec-empty">{line}</p>
        )
      ) : summary.people.length === 0 ? (
        <p className="ov-sec-empty">Nobody has access yet.</p>
      ) : (
        <ul aria-label="Who has access" className="ov-reach">
          {summary.people.map((person) => (
            <Tooltip key={person.key}>
              <TooltipTrigger render={<li data-pending={person.pending || undefined} />}>
                <PersonAvatar name={person.name} picture={person.avatarUrl} size={20} />
                <span data-part="name">{person.short}</span>
                <span
                  className="ov-acc-level"
                  data-muted={person.byDefault || undefined}
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
