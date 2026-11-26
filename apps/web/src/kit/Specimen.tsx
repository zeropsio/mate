import { useRef, useState, type ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { specimenLabel } from "./specimenLabel";

/**
 * One caption line, cut to one line; hovering a cut line shows it whole. A line that fits opens
 * nothing, so a short label never echoes itself.
 */
function CaptionLine({
  text,
  className,
  code = true,
}: {
  readonly text: string;
  readonly className: string;
  readonly code?: boolean;
}) {
  const line = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      onOpenChange={(next) => {
        const element = line.current;
        setOpen(next && element !== null && element.scrollWidth > element.clientWidth);
      }}
      open={open}
    >
      <TooltipTrigger
        render={
          code ? (
            <code className={className} ref={line} />
          ) : (
            <span className={className} ref={line} />
          )
        }
      >
        {text}
      </TooltipTrigger>
      <TooltipPopup variant={code ? "code" : "default"}>{text}</TooltipPopup>
    </Tooltip>
  );
}

const STAGE_ALIGN = {
  center: "items-center justify-center",
  start: "items-start justify-start",
} as const;

/**
 * One rendered thing on a tile: a stage it stands on, centred, and a caption strip under it with
 * the exact props it rendered with (`specimenLabel` spells an object), a plain-words note where the
 * props alone do not say what it is, and the file that draws it when that is not the section's own.
 * The stage is transparent, so the canvas's ground shows through.
 */
export function Specimen({
  label,
  note,
  source,
  span,
  align = "center",
  children,
}: {
  /** The props as written in source: `variant="ghost" size="sm"`. */
  readonly label?: string;
  /** What it is, in plain words, when the props alone do not say: "A dialog's footer". */
  readonly note?: string;
  readonly source?: string;
  /** `row` takes the grid's whole row: a table, a stack of cards, a page. */
  readonly span?: "row";
  /** `start` stands it at the stage's top left, where centring would misrepresent it. */
  readonly align?: keyof typeof STAGE_ALIGN;
  readonly children: ReactNode;
}) {
  return (
    <figure
      className={`m-0 flex min-w-0 flex-col overflow-hidden rounded-card border border-border/70 ${span === "row" ? "col-span-full" : ""}`}
      data-kit-specimen=""
    >
      <div className={`flex min-h-28 min-w-0 flex-1 p-6 ${STAGE_ALIGN[align]}`}>{children}</div>
      <figcaption className="flex min-w-0 flex-col gap-0.5 border-border/70 border-t px-4 py-2.5">
        {note ? (
          <CaptionLine className="truncate text-caption text-foreground" code={false} text={note} />
        ) : null}
        {label ? (
          <CaptionLine className="truncate font-mono text-2xs text-muted-foreground" text={label} />
        ) : null}
        {source ? (
          <CaptionLine
            className="truncate font-mono text-3xs text-muted-foreground/70"
            text={source}
          />
        ) : null}
      </figcaption>
    </figure>
  );
}

/** How narrow a grid's tiles may get before a column folds away. */
const GRID_COLUMNS = {
  sm: "grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))]",
  md: "grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))]",
  lg: "grid-cols-[repeat(auto-fill,minmax(min(100%,26rem),1fr))]",
  xl: "grid-cols-[repeat(auto-fill,minmax(min(100%,36rem),1fr))]",
  page: "grid-cols-[repeat(auto-fill,minmax(min(100%,51rem),1fr))]",
} as const;

/** Specimens as tiles on a regular grid; its columns fill the canvas at the tile size given. */
export function SpecimenGrid({
  size = "sm",
  children,
}: {
  /** The narrowest a tile gets: `sm` for a press or a mark, up to `page` for a page-sized state. */
  readonly size?: keyof typeof GRID_COLUMNS;
  readonly children: ReactNode;
}) {
  return <div className={`grid gap-4 ${GRID_COLUMNS[size]}`}>{children}</div>;
}

/** A section's blocks, one under the other, each far enough from the next to read as its own. */
export function Specimens({ children }: { readonly children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-12">{children}</div>;
}

/** A titled group of specimens inside a section: "Sizes", "Tones and forms", "States". */
export function SpecimenBlock({
  title,
  note,
  children,
}: {
  readonly title: string;
  /** One muted line under the heading: what to look for. */
  readonly note?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header className="flex min-w-0 flex-col gap-0.5">
        <h3 className="m-0 font-medium text-emphasis text-foreground">{title}</h3>
        {note ? <p className="m-0 text-body text-muted-foreground">{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

/**
 * Every row value against every column value of two props, as a table: its headers carry the
 * exact props, so a cell's label is its row's plus its column's. Every column is as wide as its
 * widest cell, so cells are one size; wider than the canvas, it scrolls sideways in its frame.
 */
export function SpecimenMatrix<Row extends string, Column extends string>({
  rowProp,
  rows,
  columnProp,
  columns,
  rowLabel,
  columnLabel,
  stretch = false,
  render,
}: {
  readonly rowProp: string;
  readonly rows: readonly Row[];
  readonly columnProp: string;
  readonly columns: readonly Column[];
  /** A header that is not `prop="value"`: a state written as the attribute that sets it. */
  readonly rowLabel?: (row: Row) => string;
  readonly columnLabel?: (column: Column) => string;
  /** Cells hold something as wide as their column (an alert, a field) rather than centring it. */
  readonly stretch?: boolean;
  readonly render: (row: Row, column: Column) => ReactNode;
}) {
  const rowHeader = rowLabel ?? ((row: Row) => specimenLabel({ [rowProp]: row }));
  const columnHeader = columnLabel ?? ((column: Column) => specimenLabel({ [columnProp]: column }));
  return (
    <div
      className={`max-w-full overflow-x-auto overflow-y-hidden rounded-card border border-border/70 ${stretch ? "" : "w-fit"}`}
    >
      <div
        className={`grid ${stretch ? "min-w-full" : "w-max"}`}
        role="table"
        style={{
          gridTemplateColumns: `max-content repeat(${columns.length}, minmax(${stretch ? "16rem" : "6rem"}, 1fr))`,
        }}
      >
        <div className="contents" role="row">
          <span className="border-border/70 border-b" role="columnheader" />
          {columns.map((column) => (
            <code
              className="border-border/70 border-b px-4 py-2.5 text-center font-mono text-2xs text-muted-foreground"
              key={column}
              role="columnheader"
            >
              {columnHeader(column)}
            </code>
          ))}
        </div>
        {rows.map((row, index) => (
          <div className="contents" key={row} role="row">
            <code
              className={`flex items-center py-3 ps-4 pe-6 font-mono text-2xs text-muted-foreground ${index === 0 ? "" : "border-border/40 border-t"}`}
              role="rowheader"
            >
              {rowHeader(row)}
            </code>
            {columns.map((column) => (
              <div
                className={`flex min-h-16 min-w-0 items-center px-4 py-3 ${stretch ? "" : "justify-center"} ${index === 0 ? "" : "border-border/40 border-t"}`}
                key={column}
                role="cell"
              >
                {render(row, column)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
