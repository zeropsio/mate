/**
 * The Data panel's filter bar for a tabular node on a SQL service: a row of
 * column/operator/value chips plus a raw `WHERE` escape hatch, compiled by
 * the caller into one read-only `SELECT` (`buildFilteredTableStatement`,
 * client-runtime — all SQL text generation is UI-free per R1, none of it
 * happens here).
 *
 * NOT a protected root (design-system.md R2): Apply issues a read-only
 * `query` request from the user's own click, through the caller.
 *
 * Purely controlled: the draft filters and the raw clause live in
 * `ZeropsDataPanel`, because applying them replaces the grid's model and
 * every subsequent sort and "Load more" has to rebuild the same statement.
 * `valueInputRef` is handed down so the grid's `/` shortcut can focus the
 * first value input without this component owning a keyboard listener.
 */
import type {
  DataConsoleFilter,
  DataConsoleFilterOp,
} from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleColumn } from "@t3tools/contracts";
import { FilterIcon } from "lucide-react";
import type { RefObject } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { MicroLabel } from "./primitives";

const OPERATOR_LABELS: ReadonlyArray<{ readonly op: DataConsoleFilterOp; readonly label: string }> =
  [
    { op: "eq", label: "=" },
    { op: "neq", label: "≠" },
    { op: "lt", label: "<" },
    { op: "lte", label: "≤" },
    { op: "gt", label: ">" },
    { op: "gte", label: "≥" },
    { op: "contains", label: "contains" },
    { op: "startsWith", label: "starts with" },
    { op: "isNull", label: "is empty" },
    { op: "notNull", label: "is not empty" },
  ];

/** The two operators that carry no operand, so their chip hides its value input. */
const VALUELESS_OPS: ReadonlySet<DataConsoleFilterOp> = new Set(["isNull", "notNull"]);

export interface ZeropsDataFiltersProps {
  readonly columns: ReadonlyArray<ZeropsDataConsoleColumn>;
  readonly filters: ReadonlyArray<DataConsoleFilter>;
  readonly rawWhere: string;
  readonly canClear: boolean;
  readonly onChangeFilters: (filters: ReadonlyArray<DataConsoleFilter>) => void;
  readonly onChangeRawWhere: (rawWhere: string) => void;
  readonly onApply: () => void;
  readonly onClear: () => void;
  readonly valueInputRef?: RefObject<HTMLInputElement | null> | undefined;
}

export function ZeropsDataFilters({
  columns,
  filters,
  rawWhere,
  canClear,
  onChangeFilters,
  onChangeRawWhere,
  onApply,
  onClear,
  valueInputRef,
}: ZeropsDataFiltersProps) {
  const replaceFilter = (index: number, next: DataConsoleFilter) => {
    onChangeFilters(filters.map((filter, i) => (i === index ? next : filter)));
  };

  const addFilter = () => {
    const first = columns[0];
    if (first === undefined) return;
    onChangeFilters([...filters, { column: first.name, op: "eq", value: "" }]);
  };

  return (
    <div className="space-y-2" data-zerops-data-filters>
      <div className="flex items-center gap-2">
        <FilterIcon className="size-3 text-muted-foreground" />
        <MicroLabel>Filters</MicroLabel>
      </div>

      {filters.map((filter, index) => (
        <div
          className="flex flex-wrap items-center gap-1"
          key={`${index}-${filter.column}-${filter.op}`}
        >
          <select
            aria-label="Filter column"
            className="rounded-[var(--control-radius)] border border-border bg-background px-1 py-0.5 text-xs"
            data-zerops-data-filter-column={String(index)}
            onChange={(event) => replaceFilter(index, { ...filter, column: event.target.value })}
            value={filter.column}
          >
            {columns.map((column) => (
              <option key={column.name} value={column.name}>
                {column.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter operator"
            className="rounded-[var(--control-radius)] border border-border bg-background px-1 py-0.5 text-xs"
            data-zerops-data-filter-op={String(index)}
            onChange={(event) =>
              replaceFilter(index, {
                ...filter,
                op: event.target.value as DataConsoleFilterOp,
              })
            }
            value={filter.op}
          >
            {OPERATOR_LABELS.map((entry) => (
              <option key={entry.op} value={entry.op}>
                {entry.label}
              </option>
            ))}
          </select>
          {VALUELESS_OPS.has(filter.op) ? null : (
            <Input
              aria-label="Filter value"
              data-zerops-data-filter-value={String(index)}
              onChange={(event) => replaceFilter(index, { ...filter, value: event.target.value })}
              placeholder="value"
              size="sm"
              value={filter.value ?? ""}
              {...(index === 0 && valueInputRef ? { ref: valueInputRef } : {})}
            />
          )}
          <Button
            aria-label="Remove filter"
            data-zerops-data-filter-remove={String(index)}
            onClick={() => onChangeFilters(filters.filter((_, i) => i !== index))}
            size="micro"
            variant="ghost"
          >
            Remove
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-zerops-data-filter-add
          disabled={columns.length === 0}
          onClick={addFilter}
          size="xs"
          variant="outline"
        >
          Add filter
        </Button>
        <Input
          aria-label="Raw WHERE clause"
          data-zerops-data-filter-raw
          onChange={(event) => onChangeRawWhere(event.target.value)}
          placeholder="raw WHERE, e.g. status = 'paid'"
          size="sm"
          value={rawWhere}
        />
        <Button data-zerops-data-filter-apply onClick={onApply} size="xs" variant="secondary">
          Apply
        </Button>
        {canClear ? (
          <Button data-zerops-data-filter-clear onClick={onClear} size="xs" variant="ghost">
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
