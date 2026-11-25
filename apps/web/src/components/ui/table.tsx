import * as React from "react";

import { cn } from "~/lib/utils";

type TableSize = "sm" | "md";

const TableSizeContext = React.createContext<TableSize>("sm");

/**
 * A table scrolls sideways in its own box when it is wider than its place. One whose header sticks
 * (`<TableHeader sticky>`) gives that box up and scrolls with the box it sits in, both ways, so the
 * header can hold that box's top.
 *
 * `size`: `sm` is a dense table of facts, its words and its column names in caption type; `md` is
 * a table of people or places, its rows 44 px tall in body type, its column names muted caption
 * words standing on the rows' rule.
 *
 * What sticks (a header, a first column) stands on the table's ground, `--color-table-ground`: the
 * card's, unless the surface the table sits in sets `--table-ground` to its own.
 */
function Table({
  className,
  size = "sm",
  ...props
}: React.ComponentProps<"table"> & { readonly size?: TableSize }) {
  return (
    <TableSizeContext value={size}>
      <div
        data-slot="table-container"
        className="relative w-full overflow-x-auto overscroll-x-contain has-[>table>[data-sticky]]:contents"
      >
        <table
          data-slot="table"
          data-size={size}
          className={cn(
            size === "md"
              ? "w-full caption-bottom text-body"
              : "w-full caption-bottom text-caption",
            className,
          )}
          {...props}
        />
      </div>
    </TableSizeContext>
  );
}

/**
 * The column names. `sticky` keeps them at the top of the scrolling box the table sits in, on the
 * table's ground so the rows pass under them.
 */
function TableHeader({
  className,
  sticky = false,
  ...props
}: React.ComponentProps<"thead"> & { readonly sticky?: boolean }) {
  return (
    <thead
      data-slot="table-header"
      data-sticky={sticky || undefined}
      className={cn("[&_tr]:border-b", sticky && "sticky top-0 z-10 bg-table-ground", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

/**
 * A row. In an `sm` table it lights under the pointer; an `md` table's rows hold their own presses
 * (a person's menu, a level's), so the row itself stays still.
 */
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  const size = React.use(TableSizeContext);
  return (
    <tr
      data-slot="table-row"
      className={cn(
        size === "md"
          ? "border-b"
          : "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

/** A first column that stays in view as the rest scrolls sideways under it, on the table's ground. */
const STICKY_COLUMN = "sticky start-0 z-1 bg-table-ground";

/**
 * A column's name, or a row's (`scope="row"`). `sticky` holds it at the scrolling box's start, so
 * the column it heads stays in view as the others scroll sideways under it: put it on the first
 * cell of every row, the header's included.
 */
function TableHead({
  className,
  sticky = false,
  ...props
}: React.ComponentProps<"th"> & { readonly sticky?: boolean }) {
  const size = React.use(TableSizeContext);
  return (
    <th
      data-slot="table-head"
      data-sticky={sticky || undefined}
      className={cn(
        size === "md"
          ? "h-8 px-2 pb-1.5 text-left align-bottom font-medium whitespace-nowrap text-caption text-muted-foreground in-[tbody]:h-11 in-[tbody]:pb-0 in-[tbody]:align-middle in-[tbody]:font-normal in-[tbody]:text-body in-[tbody]:text-foreground"
          : "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        sticky && STICKY_COLUMN,
        className,
      )}
      {...props}
    />
  );
}

/** A cell. `sticky` holds it at the scrolling box's start, as its column's `TableHead sticky`. */
function TableCell({
  className,
  sticky = false,
  ...props
}: React.ComponentProps<"td"> & { readonly sticky?: boolean }) {
  const size = React.use(TableSizeContext);
  return (
    <td
      data-slot="table-cell"
      data-sticky={sticky || undefined}
      className={cn(
        size === "md"
          ? "h-11 px-2 align-middle whitespace-nowrap"
          : "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        sticky && STICKY_COLUMN,
        className,
      )}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell };
