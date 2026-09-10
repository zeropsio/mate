/**
 * The Data panel's row detail: every column of one grid row as label/value,
 * primary keys first (`rowRecord`, client-runtime), plus the two hand-offs
 * that are the point of the surface — copy the row as JSON, or attach it to
 * the composer so the agent can be asked about it.
 *
 * NOT a protected root (design-system.md R2): it issues no RPC — the row is
 * already fetched, and both actions are local (clipboard, composer draft).
 *
 * Layout is the caller's decision, handed in as `layout`: in `wide` this is
 * a pane beside the grid, in `narrow` a full-panel overlay whose Back button
 * is the only way out besides Esc. The keyboard close is wired here rather
 * than in the panel because this component owns the focusable container the
 * key lands on.
 *
 * `expandedColumn` — set when the drawer was opened from a cell expander
 * rather than a row click — scrolls that column's full value to the top of
 * the list, which is what the click asked for.
 *
 * `addressable` — `false` for a row from a key-less page (a view-only
 * family: ClickHouse, Qdrant): the drawer still shows every column's value,
 * but says plainly that this row has no key to address rather than leaving
 * the reader to notice the omission on their own.
 */
import { describeCell, rowRecord } from "@t3tools/client-runtime/zerops/dataConsole";
import type { ZeropsDataConsoleColumn } from "@t3tools/contracts";
import { ChevronLeftIcon, CopyIcon, MessageSquarePlusIcon } from "lucide-react";

import { Button } from "../ui/button";
import { FlatCard, MicroLabel } from "./primitives";

export interface ZeropsDataRowDrawerProps {
  readonly columns: ReadonlyArray<ZeropsDataConsoleColumn>;
  readonly row: ReadonlyArray<unknown>;
  readonly layout: "narrow" | "wide";
  readonly onClose: () => void;
  readonly onCopyJson: () => void;
  readonly onExplain: () => void;
  readonly expandedColumn?: string | undefined;
  readonly addressable?: boolean;
}

export function ZeropsDataRowDrawer({
  columns,
  row,
  layout,
  onClose,
  onCopyJson,
  onExplain,
  expandedColumn,
  addressable = true,
}: ZeropsDataRowDrawerProps) {
  const record = rowRecord(columns, row);
  const names = Object.keys(record);
  const ordered =
    expandedColumn !== undefined && names.includes(expandedColumn)
      ? [expandedColumn, ...names.filter((name) => name !== expandedColumn)]
      : names;

  return (
    <FlatCard
      className={
        layout === "narrow"
          ? "absolute inset-0 z-10 space-y-3 overflow-auto p-3"
          : "w-72 shrink-0 space-y-3 overflow-auto p-3"
      }
      data-zerops-data-row-drawer={layout}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      tabIndex={-1}
    >
      <div className="flex items-center justify-between gap-2">
        <MicroLabel>Row</MicroLabel>
        <Button
          aria-label="Close row"
          data-zerops-data-row-close
          onClick={onClose}
          size="icon-xs"
          variant="ghost"
        >
          <ChevronLeftIcon />
        </Button>
      </div>

      {addressable ? null : (
        <p className="text-muted-foreground text-xs" data-zerops-data-row-unaddressable>
          This row can&rsquo;t be addressed.
        </p>
      )}

      <dl className="space-y-2" data-zerops-data-row-fields>
        {ordered.map((name) => {
          const detail = describeCell(record[name]);
          return (
            <div className="space-y-0.5" key={name}>
              <dt className="text-muted-foreground text-xs" data-zerops-data-row-field={name}>
                {name}
              </dt>
              <dd>
                {detail.kind === "json" || detail.detail.includes("\n") ? (
                  <pre
                    className="overflow-x-auto whitespace-pre-wrap break-words text-xs"
                    data-zerops-data-row-value={name}
                  >
                    {detail.detail}
                  </pre>
                ) : (
                  <p className="break-words text-xs" data-zerops-data-row-value={name}>
                    {detail.detail}
                  </p>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button data-zerops-data-row-copy onClick={onCopyJson} size="xs" variant="outline">
          <CopyIcon />
          Copy as JSON
        </Button>
        <Button data-zerops-data-row-explain onClick={onExplain} size="xs" variant="outline">
          <MessageSquarePlusIcon />
          Explain this row
        </Button>
      </div>
    </FlatCard>
  );
}
