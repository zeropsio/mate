/**
 * The Data panel's grid: renders a fetched `DataConsoleTableModel`
 * (client-runtime, `table`/`query` responses share this shape) read-only.
 * Used for a selected `tabular` tree node, for a filtered table, and for a
 * query result.
 *
 * NOT a protected root (design-system.md R2): a sort click and "Load more"
 * issue a read-only request directly from the user's own click, and nothing
 * here mutates — there is no agent-mutates-only boundary to keep.
 *
 * Row count is on-demand only (`onRequestCount`), never fetched
 * automatically — a `COUNT(*)` can be expensive on a large table; a query
 * result (no row-addressable table to count) omits it and the button never
 * appears.
 *
 * No state of its own. Sort, the hidden-column set and the focused row all
 * live in `ZeropsDataPanel`: the sort has to be merged into every subsequent
 * page request, hiding a column must survive a "Load more", and the focused
 * row is what Enter opens in the panel's drawer. Column visibility itself is
 * `visibleColumns`/`toggleHiddenColumn` (client-runtime) — a primary key is
 * never hidden, so the checkbox for one renders checked and disabled.
 *
 * Keyboard handling lives on the grid container (`tabIndex=0`) rather than
 * on each row: a roving `aria-selected` marks the focused row, and ↑/↓,
 * Enter, Esc and `/` are one handler on the element that actually holds
 * focus.
 */
import { visibleColumns } from "@t3tools/client-runtime/zerops/dataConsole";
import type {
  DataConsoleTableModel,
  SortDirection,
} from "@t3tools/client-runtime/zerops/dataConsole";
import { formatCell } from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleColumn } from "@t3tools/contracts";
import { Columns3Icon, CopyIcon, MessageSquarePlusIcon } from "lucide-react";
import type { KeyboardEvent } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { MicroLabel } from "./primitives";
import { ZeropsDataCell } from "./ZeropsDataCell";

export interface ZeropsDataTableSort {
  readonly column: string;
  readonly direction: SortDirection;
}

export interface ZeropsDataTableProps {
  readonly model: DataConsoleTableModel;
  readonly onLoadMore: () => void;
  readonly onSort: (column: ZeropsDataConsoleColumn, direction: SortDirection) => void;
  readonly onRequestCount?: () => void;
  readonly count?: number;
  readonly sort?: ZeropsDataTableSort;
  readonly loadMorePending?: boolean;
  /** Column names the user hid; a primary key in the set is ignored (`visibleColumns`). */
  readonly hiddenColumns?: ReadonlySet<string>;
  /** Present when the column picker should render at all. */
  readonly onToggleColumn?: ((name: string) => void) | undefined;
  /** Whether the column picker is open — panel state, so it survives a page append. */
  readonly columnsOpen?: boolean;
  readonly onToggleColumnsOpen?: (() => void) | undefined;
  readonly onOpenRow?: ((rowIndex: number) => void) | undefined;
  readonly onExpandCell?: ((rowIndex: number, columnName: string) => void) | undefined;
  readonly focusedRowIndex?: number | undefined;
  readonly onFocusRow?: ((rowIndex: number) => void) | undefined;
  readonly onEscape?: (() => void) | undefined;
  readonly onFocusFilter?: (() => void) | undefined;
  readonly onAskAboutTable?: (() => void) | undefined;
  readonly onCopyPageJson?: (() => void) | undefined;
  /** Marks the grid as showing a filtered statement's result rather than the plain table. */
  readonly filtered?: boolean;
}

/**
 * A row-addressable table (`rowKeyCols` non-empty, e.g. a selected `tabular`
 * node) keys each row by its own key-column values, stable across a
 * "Load more" append. A view-only query result (`rowKeyCols` empty) has no
 * business key to key by — the row index is the only candidate there, same
 * as the column position is for a cell.
 */
function rowKey(
  model: Pick<DataConsoleTableModel, "columns" | "rowKeyCols">,
  row: ReadonlyArray<unknown>,
  rowIndex: number,
): string {
  if (model.rowKeyCols.length === 0) return String(rowIndex);
  return model.rowKeyCols
    .map((columnName) => {
      const columnIndex = model.columns.findIndex((column) => column.name === columnName);
      return columnIndex >= 0 ? formatCell(row[columnIndex], model.columns[columnIndex]!) : "";
    })
    .join("␟");
}

const NO_HIDDEN_COLUMNS: ReadonlySet<string> = new Set();

export function ZeropsDataTable({
  model,
  onLoadMore,
  onSort,
  onRequestCount,
  count,
  sort,
  loadMorePending = false,
  hiddenColumns = NO_HIDDEN_COLUMNS,
  onToggleColumn,
  columnsOpen = false,
  onToggleColumnsOpen,
  onOpenRow,
  onExpandCell,
  focusedRowIndex,
  onFocusRow,
  onEscape,
  onFocusFilter,
  onAskAboutTable,
  onCopyPageJson,
  filtered = false,
}: ZeropsDataTableProps) {
  const shown = visibleColumns(model.columns, hiddenColumns);

  const handleSortClick = (column: ZeropsDataConsoleColumn) => {
    if (!column.sortable) return;
    const direction: SortDirection =
      sort?.column === column.name && sort.direction === "asc" ? "desc" : "asc";
    onSort(column, direction);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rowCount = model.rows.length;
    if (event.key === "ArrowDown" && rowCount > 0) {
      event.preventDefault();
      const next = focusedRowIndex === undefined ? 0 : Math.min(focusedRowIndex + 1, rowCount - 1);
      onFocusRow?.(next);
      return;
    }
    if (event.key === "ArrowUp" && rowCount > 0) {
      event.preventDefault();
      const next = focusedRowIndex === undefined ? 0 : Math.max(focusedRowIndex - 1, 0);
      onFocusRow?.(next);
      return;
    }
    if (event.key === "Enter" && focusedRowIndex !== undefined) {
      event.preventDefault();
      onOpenRow?.(focusedRowIndex);
      return;
    }
    if (event.key === "Escape") {
      onEscape?.();
      return;
    }
    if (event.key === "/" && onFocusFilter !== undefined) {
      event.preventDefault();
      onFocusFilter();
    }
  };

  return (
    <div className="space-y-2" data-zerops-data-table>
      <div className="flex flex-wrap items-center gap-2">
        {filtered ? (
          <MicroLabel className="text-muted-foreground" data-zerops-data-table-filtered>
            Filtered
          </MicroLabel>
        ) : null}
        {onToggleColumnsOpen !== undefined ? (
          <Button
            data-zerops-data-table-columns
            onClick={onToggleColumnsOpen}
            size="xs"
            variant="ghost"
          >
            <Columns3Icon />
            Columns
          </Button>
        ) : null}
        {onAskAboutTable !== undefined ? (
          <Button data-zerops-data-table-ask onClick={onAskAboutTable} size="xs" variant="ghost">
            <MessageSquarePlusIcon />
            Ask about this table
          </Button>
        ) : null}
        {onCopyPageJson !== undefined ? (
          <Button data-zerops-data-table-copy onClick={onCopyPageJson} size="xs" variant="ghost">
            <CopyIcon />
            Copy as JSON
          </Button>
        ) : null}
      </div>

      {columnsOpen && onToggleColumn !== undefined ? (
        <div
          className="flex flex-wrap gap-2 rounded-[var(--zerops-card-radius)] border border-border p-2"
          data-zerops-data-table-column-picker
        >
          {model.columns.map((column) => (
            <label className="flex items-center gap-1 text-xs" key={column.name}>
              <input
                checked={column.pk || !hiddenColumns.has(column.name)}
                data-zerops-data-table-column-toggle={column.name}
                disabled={column.pk}
                onChange={() => onToggleColumn(column.name)}
                type="checkbox"
              />
              {column.name}
            </label>
          ))}
        </div>
      ) : null}

      <div
        className="outline-none"
        data-zerops-data-table-grid
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {shown.map((column) =>
                column.sortable ? (
                  <TableHead
                    className="cursor-pointer select-none"
                    data-zerops-data-table-sort={column.name}
                    key={column.name}
                    onClick={() => handleSortClick(column)}
                  >
                    {column.name}
                    {sort?.column === column.name ? (sort.direction === "asc" ? " ↑" : " ↓") : null}
                  </TableHead>
                ) : (
                  <TableHead
                    data-zerops-data-table-column={column.name}
                    key={column.name}
                    title={column.sortReason === "" ? undefined : column.sortReason}
                  >
                    {column.name}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={Math.max(shown.length, 1)} data-zerops-data-table-empty>
                  No rows
                </TableCell>
              </TableRow>
            ) : null}
            {model.rows.map((row, rowIndex) => (
              <TableRow
                aria-selected={focusedRowIndex === rowIndex}
                className={cn(focusedRowIndex === rowIndex && "bg-accent")}
                data-zerops-data-table-row={String(rowIndex)}
                key={rowKey(model, row, rowIndex)}
                onClick={() => onOpenRow?.(rowIndex)}
              >
                {shown.map((column) => {
                  const cellIndex = model.columns.indexOf(column);
                  return (
                    <TableCell key={column.name}>
                      <ZeropsDataCell
                        onExpand={
                          onExpandCell === undefined
                            ? undefined
                            : () => onExpandCell(rowIndex, column.name)
                        }
                        value={row[cellIndex]}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-3">
        {model.nextCursor !== undefined ? (
          <Button
            data-zerops-data-table-load-more
            disabled={loadMorePending}
            onClick={onLoadMore}
            size="sm"
            variant="outline"
          >
            Load more
          </Button>
        ) : null}

        {count === undefined ? (
          onRequestCount !== undefined ? (
            <Button
              data-zerops-data-table-request-count
              onClick={onRequestCount}
              size="sm"
              variant="ghost"
            >
              Count rows
            </Button>
          ) : null
        ) : (
          <MicroLabel className="text-muted-foreground" data-zerops-data-table-count>
            {`${count.toLocaleString()} rows${model.bestEffort ? " (approximate)" : ""}`}
          </MicroLabel>
        )}
      </div>
    </div>
  );
}
