/**
 * One grid cell of the Data panel's table view.
 *
 * NOT a protected root (design-system.md R2): it issues no RPC at all —
 * the expander only asks its caller (`ZeropsDataTable` → `ZeropsDataPanel`)
 * to open the row drawer on this column, which renders an already-fetched
 * value.
 *
 * The inline text is always `describeCell(value).oneLine` (client-runtime,
 * UI-free per R1), so a long string, a JSON container and a byte buffer all
 * collapse to one line with an explicit "…" rather than being silently cut
 * by CSS. A value the one-liner could not show whole (`hasMore`) or a JSON
 * container gets the expander, which is the only way to the full text.
 */
import { describeCell } from "@t3tools/client-runtime/zerops/dataConsole";
import { Maximize2Icon } from "lucide-react";

export interface ZeropsDataCellProps {
  readonly value: unknown;
  readonly onExpand?: (() => void) | undefined;
}

/** `true` when the inline one-liner is not the whole value, so the cell needs its expander. */
export function cellNeedsExpander(value: unknown): boolean {
  const detail = describeCell(value);
  return detail.hasMore || detail.kind === "json";
}

export function ZeropsDataCell({ value, onExpand }: ZeropsDataCellProps) {
  const detail = describeCell(value);
  const expandable = cellNeedsExpander(value);

  return (
    <span className="inline-flex max-w-full items-center gap-1" data-zerops-data-cell={detail.kind}>
      <span className="truncate">{detail.oneLine}</span>
      {expandable && onExpand !== undefined ? (
        <button
          aria-label="Expand value"
          className="text-muted-foreground hover:text-foreground"
          data-zerops-data-cell-expand
          onClick={(event) => {
            event.stopPropagation();
            onExpand();
          }}
          type="button"
        >
          <Maximize2Icon className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
