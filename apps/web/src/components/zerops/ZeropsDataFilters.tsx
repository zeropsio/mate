/**
 * The Data panel's filter bar for a tabular node on a SQL service: chips of
 * column/operator/value plus a raw `WHERE` escape hatch, compiled by the
 * caller into one read-only `SELECT` (`buildFilteredTableStatement`,
 * client-runtime — all SQL text generation is UI-free per R1, none of it
 * happens here).
 *
 * NOT a protected root (design-system.md R2): Apply issues a read-only
 * `query` request from the user's own click, through the caller.
 *
 * Rendered twice, once per `slot`, because its two halves belong to two rows
 * of the panel's content column: `"toolbar"` is the button group that shares
 * the grid's own toolbar row (`+ Filter`, `WHERE…`, and — only when they
 * apply — `Apply` and `Clear`), `"rows"` is the chips line and the raw input
 * under it. Splitting by prop rather than into two components keeps one
 * owner for the whole filter vocabulary and one prop set for the caller.
 *
 * Purely controlled: the draft filters and the raw clause live in
 * `ZeropsDataPanel`, because applying them replaces the grid's model and
 * every subsequent sort and "Load more" has to rebuild the same statement.
 * `dirty` is likewise the caller's verdict (`filtersDirty`, client-runtime):
 * only a draft that differs from what is applied has anything to apply.
 * `valueInputRef` is handed down so the grid's `/` shortcut can focus the
 * first value input without this component owning a keyboard listener.
 */
import type {
  DataConsoleFilter,
  DataConsoleFilterOp,
} from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleColumn } from "@t3tools/contracts";
import { FilterIcon } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

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

/** Borderless inside the chip: the chip's own border is the group's outline. */
interface ZeropsDataFiltersProps {
  /** Which half to render: the toolbar button group, or the chips and raw input under it. */
  readonly slot: "toolbar" | "rows";
  readonly columns: ReadonlyArray<ZeropsDataConsoleColumn>;
  readonly filters: ReadonlyArray<DataConsoleFilter>;
  readonly rawWhere: string;
  /** Whether the raw `WHERE` input is revealed. */
  readonly rawOpen: boolean;
  /** Whether the draft still differs from what is applied (`filtersDirty`). */
  readonly dirty: boolean;
  readonly canClear: boolean;
  /** Chip index whose value input takes focus on this render — the one just added. */
  readonly autoFocusIndex?: number | undefined;
  readonly onChangeFilters: (filters: ReadonlyArray<DataConsoleFilter>) => void;
  readonly onChangeRawWhere?: (rawWhere: string) => void;
  readonly onToggleRaw?: () => void;
  readonly onApply: () => void;
  readonly onClear: () => void;
  readonly valueInputRef?: RefObject<HTMLInputElement | null> | undefined;
}

export function ZeropsDataFilters({
  slot,
  columns,
  filters,
  rawWhere,
  rawOpen,
  dirty,
  canClear,
  autoFocusIndex,
  onChangeFilters,
  onChangeRawWhere,
  onToggleRaw,
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

  const applyOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    onApply();
  };

  if (slot === "toolbar") {
    return (
      <div className="flex items-center gap-1" data-zerops-data-filters="toolbar">
        <Button
          data-zerops-data-filter-add
          disabled={columns.length === 0}
          onClick={addFilter}
          size="sm"
          variant="ghost"
        >
          <FilterIcon />
          Filter
        </Button>
        {onToggleRaw ? (
          <Button
            data-zerops-data-filter-raw-toggle
            onClick={onToggleRaw}
            size="sm"
            variant={rawOpen ? "secondary" : "ghost"}
          >
            WHERE…
          </Button>
        ) : null}
        {dirty ? (
          <Button data-zerops-data-filter-apply onClick={onApply} size="sm" variant="secondary">
            Apply
          </Button>
        ) : null}
        {canClear ? (
          <Button data-zerops-data-filter-clear onClick={onClear} size="sm" variant="ghost">
            Clear
          </Button>
        ) : null}
      </div>
    );
  }

  if (filters.length === 0 && !rawOpen) return null;

  return (
    <div className="flex flex-col gap-1" data-zerops-data-filters="rows">
      {filters.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1">
          {filters.map((filter, index) => (
            <div
              className="inline-flex items-center gap-0.5 rounded-control border border-border text-caption"
              key={`${index}-${filter.column}-${filter.op}`}
            >
              <Select
                onValueChange={(column) => {
                  if (column !== null) replaceFilter(index, { ...filter, column });
                }}
                value={filter.column}
              >
                <SelectTrigger
                  aria-label="Filter column"
                  data-zerops-data-filter-column={String(index)}
                  size="xs"
                  variant="ghost"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {columns.map((column) => (
                    <SelectItem key={column.name} value={column.name}>
                      {column.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Select
                onValueChange={(op) => {
                  if (op !== null) replaceFilter(index, { ...filter, op });
                }}
                value={filter.op}
              >
                <SelectTrigger
                  aria-label="Filter operator"
                  data-zerops-data-filter-op={String(index)}
                  size="xs"
                  variant="ghost"
                >
                  <SelectValue>
                    {OPERATOR_LABELS.find((entry) => entry.op === filter.op)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {OPERATOR_LABELS.map((entry) => (
                    <SelectItem key={entry.op} value={entry.op}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {VALUELESS_OPS.has(filter.op) ? null : (
                <Input
                  aria-label="Filter value"
                  autoFocus={autoFocusIndex === index}
                  className="w-24"
                  data-zerops-data-filter-value={String(index)}
                  onChange={(event) =>
                    replaceFilter(index, { ...filter, value: event.target.value })
                  }
                  onKeyDown={applyOnEnter}
                  placeholder="value"
                  size="compact"
                  unstyled
                  value={filter.value ?? ""}
                  {...(index === 0 && valueInputRef ? { ref: valueInputRef } : {})}
                />
              )}
              <Button
                aria-label="Remove filter"
                data-zerops-data-filter-remove={String(index)}
                onClick={() => onChangeFilters(filters.filter((_, i) => i !== index))}
                size="icon-sm"
                variant="ghost"
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
      {rawOpen ? (
        <Input
          aria-label="Raw WHERE clause"
          data-zerops-data-filter-raw
          onChange={(event) => onChangeRawWhere?.(event.target.value)}
          onKeyDown={applyOnEnter}
          placeholder="status = 'paid' AND total > 100"
          size="compact"
          value={rawWhere}
        />
      ) : null}
    </div>
  );
}
