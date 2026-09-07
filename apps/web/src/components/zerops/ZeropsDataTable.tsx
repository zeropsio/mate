/**
 * The Data panel's table view: renders a fetched `DataConsoleTableModel`
 * (client-runtime, `table`/`query` responses share this shape) read-only.
 * Used both for a selected `tabular` tree node and for a query result.
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
 * Sort state is NOT local: this component renders whatever `sort` its
 * caller (`ZeropsDataPanel`) passes, one column-in-play at a time, so the
 * panel can merge the same sort into every "Load more" page request and
 * reset the arrow the moment it replaces the model wholesale (a new
 * selection, a new query run).
 */
import type {
  DataConsoleTableModel,
  SortDirection,
} from "@t3tools/client-runtime/zerops/dataConsole";
import { formatCell } from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleColumn } from "@t3tools/contracts";

import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { MicroLabel } from "./primitives";

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

export function ZeropsDataTable({
  model,
  onLoadMore,
  onSort,
  onRequestCount,
  count,
  sort,
  loadMorePending = false,
}: ZeropsDataTableProps) {
  const handleSortClick = (column: ZeropsDataConsoleColumn) => {
    if (!column.sortable) return;
    const direction: SortDirection =
      sort?.column === column.name && sort.direction === "asc" ? "desc" : "asc";
    onSort(column, direction);
  };

  return (
    <div className="space-y-2" data-zerops-data-table>
      <Table>
        <TableHeader>
          <TableRow>
            {model.columns.map((column) =>
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
                <TableHead data-zerops-data-table-column={column.name} key={column.name}>
                  {column.name}
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.rows.map((row, rowIndex) => (
            <TableRow data-zerops-data-table-row key={rowKey(model, row, rowIndex)}>
              {row.map((cell, cellIndex) => (
                <TableCell key={model.columns[cellIndex]?.name ?? cellIndex}>
                  {formatCell(cell, model.columns[cellIndex] ?? { dataType: "" })}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

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
